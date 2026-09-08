import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { TCP_PORT, DISCOVERY_PORT, PROTOCOL } from './config.js';
import {
  encryptObject,
  decryptObject,
  createFileEncryptor,
  createFileDecryptor
} from './crypto.js';
import { deviceId, loadState, saveState } from './state.js';
import { getClipboard, setClipboard } from './clipboard.js';
import { localIPv4s } from './net.js';
import {
  encodeBinaryChunk,
  decodeBinaryChunk,
  encodeJsonFrame,
  decodeJsonFrame,
  parseFrames,
  encodeFrame,
  clipboardMessage,
  fileMessage,
  fileStartMessage,
  FRAME_JSON,
  FRAME_BINARY
} from './protocol.js';

export class Client {
  constructor({ host, port = TCP_PORT, pin }) {
    this.id = deviceId();
    this.host = host;
    this.port = Number(port);
    this.pin = pin;

    this.state = loadState();
    this.state.role = 'client';
    this.state.hub = {
      host: this.host,
      port: this.port
    };
    this.state.pin = this.pin;

    saveState(this.state);

    this.socket = null;
    this.salt = null;
    this.buffer = Buffer.alloc(0);
    this.lastHash = null;
    this.fileTransfers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port
      });

      this.socket = socket;

      /*
       * TCP connection established.
       * Send authentication information to the Hub.
       */
      socket.on('connect', () => {
        console.log(
          `[CONNECT] Connected to ${this.host}:${this.port}`
        );

        socket.write(
          encodeJsonFrame({
            type: 'auth',
            protocol: PROTOCOL,
            deviceId: this.id,
            name: os.hostname(),
            pin: this.pin
          })
        );
      });

      /*
       * Receive TCP data from Hub.
       *
       * IMPORTANT:
       * The Hub sends clipboard data as:
       *
       * {
       *   type: "secure",
       *   envelope: "..."
       * }
       *
       * Therefore secure messages must be decrypted here
       * before being passed to handleApplication().
       */
      socket.on('data', chunk => {
        this.buffer = Buffer.concat([
          this.buffer,
          chunk
        ]);

        try {
          const parsed = parseFrames(this.buffer);
          this.buffer = parsed.buffer;

          for (const frame of parsed.frames) {
            if (frame.type === FRAME_JSON) {
              const msg = decodeJsonFrame(frame.payload);

              console.log(`[RECV] ${msg.type}`);

              if (msg.type === 'auth.ok') {
                this.salt = msg.salt;

                console.log(
                  `Connected to Hub ${msg.hubId} ` +
                  `at ${this.host}:${this.port}`
                );

                if (msg.trusted) {
                  if (msg.reconnect) {
                    console.log(
                      '[TRUSTED] Existing trusted device. Reconnected.'
                    );
                  } else {
                    console.log(
                      '[TRUSTED] Device paired and added to trusted devices.'
                    );
                  }
                }

                resolve();
              }

              else if (msg.type === 'secure') {
                console.log('[RECV] secure message');

                try {
                  const payload = decryptObject(
                    msg.envelope,
                    this.pin,
                    this.salt
                  );

                  console.log(
                    `[DECRYPT] ${payload.type || 'unknown'}`
                  );

                  this.handleApplication(payload);
                } catch (e) {
                  console.error(
                    `[DECRYPT ERROR] ${e.message}`
                  );
                }
              }

              else if (msg.type === 'error') {
                if (msg.code === 'DEVICE_REVOKED') {
                  reject(
                    new Error(
                      'This device has been revoked by the Hub.'
                    )
                  );
                } else {
                  reject(new Error(msg.code));
                }

                socket.destroy();
              }
            }

            else if (frame.type === FRAME_BINARY) {
              const chunk = decodeBinaryChunk(frame.payload);

              console.log(
                `[FILE] CHUNK ${chunk.transferId} #${chunk.sequence} ${chunk.data.length} bytes`
              );

              const transfer = this.fileTransfers.get(chunk.transferId);

              if (!transfer) {
                console.log(`[FILE] Unknown transfer ${chunk.transferId}`);
                continue;
              }

              const decrypted = transfer.decryptor.update(chunk.data);

              if (decrypted.length > 0) {
                fs.appendFileSync(
                  transfer.outputPath,
                  decrypted
                );
              }
            }

            else {
              console.warn(
                `[PROTOCOL] Unknown frame type: ${frame.type}`
              );
            }
          }
        } catch (e) {
          console.error(
            `[PROTOCOL ERROR] ${e.message}`
          );

          reject(e);
        }
      });

      socket.on('error', err => {
        console.error(
          `[CONNECTION ERROR] ${err.message}`
        );

        reject(err);
      });

      socket.on('close', () => {
        console.log('[CONNECTION] closed');
      });
    });
  }

  /*
   * Handle decrypted application messages.
   */
  handleApplication(payload) {
    if (payload.type === 'file.start') {
      console.log(
        `[FILE] START ${payload.file.name} (${payload.file.size} bytes)`
      );

      this.fileTransfers.set(payload.transferId, {
        name: payload.file.name,
        mime: payload.file.mime,
        size: payload.file.size,
        hash: payload.file.hash,
        iv: payload.iv,
        outputPath: path.join(
          process.cwd(),
          payload.file.name
        ),
        decryptor: createFileDecryptor(
          this.pin,
          this.salt,
          Buffer.from(payload.iv, 'base64url')
        ),
        chunks: []
      });

      return;
    }

    if (payload.type === 'file.end') {
      const transfer = this.fileTransfers.get(payload.transferId);

      if (!transfer) {
        console.log(`[FILE] Unknown transfer ${payload.transferId}`);
        return;
      }

      console.log(
        `[FILE] END ${transfer.name}`
      );

      transfer.hash = payload.hash;
      transfer.authTag = payload.authTag;

      transfer.decryptor.setAuthTag(
        Buffer.from(payload.authTag, 'base64url')
      );

      const finalData = transfer.decryptor.final();

      if (finalData.length > 0) {
        fs.appendFileSync(
          transfer.outputPath,
          finalData
        );
      }

      console.log(
        `[FILE] SAVED ${transfer.outputPath}`
      );

      this.fileTransfers.delete(payload.transferId);

      return;
    }

    if (payload.type !== 'clipboard.push') {

      /*
       * Ignore messages generated by this same device.
       */
      if (payload.senderId === this.id) {
        console.log('[SYNC] Ignored own message');
        return;
      }

      /*
       * Ignore duplicate clipboard content.
       */
      if (payload.hash === this.lastHash) {
        console.log('[SYNC] Ignored duplicate clipboard');
        return;
      }

      this.lastHash = payload.hash;

      /*
       * Currently support text clipboard.
       */
      if (payload.contentType === 'text') {
        try {
          setClipboard(payload.content);

          console.log(
            `[SYNC] received ${payload.content.length} bytes ` +
            `from ${payload.senderId}`
          );
        } catch (e) {
          console.error(
            `[CLIPBOARD ERROR] ${e.message}`
          );
        }
      } else {
        console.log(
          `[SYNC] Unsupported content type: ${payload.contentType}`
        );
      }
    }
  }

  sendFileStart(filePath) {
    if (!this.socket) {
      throw new Error('Not connected to hub');
    }

    if (!this.salt) {
      throw new Error('Not authenticated');
    }

    const stat = fs.statSync(filePath);

    if (!stat.isFile()) {
      throw new Error('Path is not a file');
    }

    const transferId = crypto.randomUUID();
    const name = path.basename(filePath);

    const { iv, cipher } =
      createFileEncryptor(
        this.pin,
        this.salt
      );

    const start = fileStartMessage({
      senderId: this.id,
      transferId,
      name,
      mime: 'application/octet-stream',
      size: stat.size,
      hash: null,
      iv: iv.toString('base64url')
    });

    const envelope = encryptObject(
      start,
      this.pin,
      this.salt
    );

    this.socket.write(
      encodeJsonFrame({
        type: 'secure',
        envelope
      })
    );

    console.log(
      `[FILE] START ${name} (${stat.size} bytes)`
    );

    return {
      filePath,
      transferId,
      cipher
    };
  }


  sendFile(filePath) {
    const start = this.sendFileStart(filePath);

    const result = this.sendFileData(
      start.filePath,
      start.transferId,
      start.cipher
    );

    return {
      transferId: start.transferId,
      filePath: start.filePath,
      hash: result.hash,
      authTag: result.authTag
    };
  }


  sendFileChunk(transferId, sequence, data) {
    if (!this.socket) {
      throw new Error('Not connected to hub');
    }

    const payload = encodeBinaryChunk({
      transferId,
      sequence,
      data
    });

    this.socket.write(
      encodeFrame(FRAME_BINARY, payload)
    );
  }


  sendFileData(filePath, transferId, cipher) {
    const CHUNK_SIZE = 64 * 1024;

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(CHUNK_SIZE);

    let sequence = 0;
    let position = 0;

    const hash = crypto.createHash('sha256');
    let authTag;

    try {
      while (true) {
        const bytesRead = fs.readSync(
          fd,
          buffer,
          0,
          CHUNK_SIZE,
          position
        );

        if (bytesRead === 0) {
          break;
        }

        const plaintext = buffer.subarray(0, bytesRead);
        const encrypted = cipher.update(plaintext);

        hash.update(plaintext);

        if (encrypted.length > 0) {
          this.sendFileChunk(
            transferId,
            sequence,
            encrypted
          );

          sequence++;
        }

        position += bytesRead;
      }

      const finalData = cipher.final();

      if (finalData.length > 0) {
        this.sendFileChunk(
          transferId,
          sequence,
          finalData
        );

        sequence++;
      }

      authTag = cipher.getAuthTag();

    } finally {
      fs.closeSync(fd);
    }

    const fileHash = hash.digest('hex');

    const result = {
      sequence,
      hash: fileHash,
      authTag: authTag.toString('base64url')
    };

    this.sendFileEnd({
      transferId,
      hash: result.hash,
      authTag: result.authTag
    });

    return result;
  }


  sendFileEnd({
    transferId,
    hash,
    authTag
  }) {
    const payload = {
      type: 'file.end',
      id: crypto.randomUUID(),
      senderId: this.id,
      transferId,
      hash,
      authTag,
      timestamp: Date.now()
    };

    this.socket.write(
      encodeJsonFrame({
        type: 'secure',
        envelope: encryptObject(
          payload,
          this.pin,
          this.salt
        )
      })
    );

    console.log(
      `[FILE] END ${transferId}`
    );
  }


  /*
   * Send local clipboard content to Hub.
   */
  push(text) {
    const payload = clipboardMessage({
      senderId: this.id,
      text
    });

    /*
     * Prevent sending the same clipboard content repeatedly.
     */
    if (payload.hash === this.lastHash) {
      return;
    }

    this.lastHash = payload.hash;

    this.socket.write(
      encodeJsonFrame({
        type: 'secure',
        envelope: encryptObject(
          payload,
          this.pin,
          this.salt
        )
      })
    );

    console.log(
      `[SEND] ${text.length} bytes`
    );
  }
}

/*
 * UDP Hub Discovery
 */
export async function discover(timeoutMs = 1800) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const found = new Map();

    let finished = false;

    const finish = () => {
      if (finished) return;

      finished = true;

      try {
        socket.close();
      } catch { }

      resolve([...found.values()]);
    };

    socket.on('error', err => {
      console.error(
        `[DISCOVERY] UDP error: ${err.message}`
      );

      finish();
    });

    socket.on('message', (buf, rinfo) => {
      try {
        const msg = JSON.parse(buf.toString());

        if (
          msg.type === 'uc.hub' &&
          msg.protocol === PROTOCOL
        ) {
          found.set(
            msg.hubId,
            {
              ...msg,
              address: rinfo.address
            }
          );
        }
      } catch { }
    });

    socket.bind(() => {
      socket.setBroadcast(true);

      const packet = Buffer.from(
        JSON.stringify({
          type: 'uc.discover',
          protocol: PROTOCOL
        })
      );

      /*
       * Broadcast once per active IPv4 interface.
       * This is important for Windows Hotspot / ICS networks.
       */
      const broadcasts = new Set([
        '255.255.255.255'
      ]);

      for (const nic of localIPv4s()) {
        if (nic.broadcast) {
          broadcasts.add(nic.broadcast);
        }
      }

      console.log(
        `[DISCOVERY] Searching for hubs for ${timeoutMs}ms...`
      );

      console.log(
        `[DISCOVERY] Broadcast targets: ` +
        `${[...broadcasts].join(', ')}`
      );

      for (const address of broadcasts) {
        socket.send(
          packet,
          DISCOVERY_PORT,
          address,
          err => {
            if (err) {
              console.error(
                `[DISCOVERY] Could not send to ${address}: ` +
                `${err.message}`
              );
            }
          }
        );
      }
    });

    setTimeout(finish, timeoutMs);
  });
}