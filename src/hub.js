import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import { TCP_PORT, DISCOVERY_PORT, PROTOCOL } from './config.js';
import { encryptObject, decryptObject, randomPin, randomSalt } from './crypto.js';
import { deviceId, loadState, saveState } from './state.js';
import { localIPv4s } from './net.js';
import { getClipboard, setClipboard } from './clipboard.js';
import {
  encodeFrame,
  encodeJsonFrame,
  decodeJsonFrame,
  decodeBinaryChunk,
  parseFrames,
  FRAME_JSON,
  FRAME_BINARY
} from './protocol.js';

export class Hub {
  constructor() {
    this.id = deviceId();

    this.state = loadState();

    this.state.role = 'hub';

    this.state.pin =
      this.state.pin ?? randomPin();

    this.state.salt =
      this.state.salt ?? randomSalt();

    // Existing v0.1.1 peer list
    this.state.peers =
      this.state.peers ?? {};

    // New:
    // Devices that were explicitly revoked.
    //
    // We keep revoked IDs separately instead of simply
    // deleting them from peers. Otherwise a revoked device
    // could join again with the correct PIN.
    this.state.revokedDevices =
      this.state.revokedDevices ?? [];

    saveState(this.state);

    this.sockets = new Map();

    this.fileTransfers = new Map();

    this.lastHash = null;

    this.server = null;

    this.discovery = null;
  }

  start() {
    this.server = net.createServer(socket => this.handleSocket(socket));
    this.server.listen(TCP_PORT, '0.0.0.0', () => {
      console.log('\nUniversal Clipboard LAN');
      console.log('ROLE: HUB + CLIENT');
      console.log(`DEVICE: ${this.id}`);
      console.log(`TCP: ${TCP_PORT}`);
      console.log(`DISCOVERY: UDP ${DISCOVERY_PORT}`);
      console.log(`PIN: ${this.state.pin}`);
      console.log('\nLAN addresses:');
      for (const x of localIPv4s()) console.log(`  ${x.name}: ${x.address}`);
      console.log('\nWaiting for devices...');
    });

    this.discovery = dgram.createSocket('udp4');
    this.discovery.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      this.discovery.setBroadcast(true);
    });
    this.discovery.on('message', (buf, rinfo) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'uc.discover') {
          const reply = Buffer.from(JSON.stringify({
            type: 'uc.hub', protocol: PROTOCOL, hubId: this.id,
            port: TCP_PORT, name: osName()
          }));
          this.discovery.send(reply, rinfo.port, rinfo.address);
        }
      } catch { }
    });
  }

  handleSocket(socket) {
    let buffer = Buffer.alloc(0);
    let peer = null;
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        const parsed = parseFrames(buffer);
        buffer = parsed.buffer;

        for (const frame of parsed.frames) {

          if (frame.type !== FRAME_JSON) {
            if (frame.type === FRAME_BINARY) {
              const chunk = decodeBinaryChunk(frame.payload);

              console.log(
                `[HUB RECV] binary chunk ` +
                `${chunk.transferId} #${chunk.sequence} ` +
                `${chunk.data.length} bytes`
              );

              if (!peer) {
                console.log(
                  '[REJECTED] Binary frame before authentication'
                );

                continue;
              }

              if (!this.fileTransfers.has(chunk.transferId)) {
                console.log(
                  `[REJECTED] Unknown transfer ${chunk.transferId}`
                );

                continue;
              }

              for (const [id, targetSocket] of this.sockets) {
                if (id === peer.id) continue;

                targetSocket.write(
                  encodeFrame(FRAME_BINARY, frame.payload)
                );
              }
            }

            continue;
          }

          const msg = decodeJsonFrame(frame.payload);

          if (msg.type === 'auth') {

            // ==================================================
            // Authentication
            // ==================================================

            if (msg.pin !== this.state.pin) {
              socket.write(
                encodeJsonFrame({
                  type: 'error',
                  code: 'BAD_PIN'
                })
              );

              socket.destroy();
              return;
            }

            if (!msg.deviceId) {
              socket.write(
                encodeJsonFrame({
                  type: 'error',
                  code: 'DEVICE_ID_REQUIRED'
                })
              );

              socket.destroy();
              return;
            }

            // ==================================================
            // Check revoked device
            // ==================================================

            if (this.state.revokedDevices.includes(msg.deviceId)) {

              console.log(
                `[REJECTED] Revoked device ${msg.deviceId}`
              );

              socket.write(
                encodeJsonFrame({
                  type: 'error',
                  code: 'DEVICE_REVOKED'
                })
              );

              socket.destroy();
              return;
            }

            // ==================================================
            // Trusted Device
            // ==================================================

            const existing =
              this.state.peers[msg.deviceId];

            const isTrusted =
              Boolean(existing?.trusted);

            peer = {
              id: msg.deviceId,
              socket,
              address: socket.remoteAddress
            };

            this.sockets.set(
              peer.id,
              socket
            );

            const now = Date.now();

            this.state.peers[peer.id] = {
              id: peer.id,
              name:
                msg.name ??
                existing?.name ??
                peer.id,

              address:
                socket.remoteAddress,

              trusted: true,

              firstSeen:
                existing?.firstSeen ??
                now,

              lastSeen:
                now
            };

            saveState(this.state);

            // ==================================================
            // Authentication success
            // ==================================================

            socket.write(
              encodeJsonFrame({
                type: 'auth.ok',
                protocol: PROTOCOL,
                hubId: this.id,
                salt: this.state.salt,
                trusted: true,
                reconnect: isTrusted
              })
            );

            if (isTrusted) {

              console.log(
                `\n[RECONNECT] Trusted device ${peer.id} ` +
                `from ${socket.remoteAddress}`
              );

            } else {

              console.log(
                `\n[PAIR] New trusted device ${peer.id} ` +
                `from ${socket.remoteAddress}`
              );

            }

          }

          // ====================================================
          // Receive encrypted application data from Client
          // ====================================================

          else if (msg.type === 'secure') {

            if (!peer) {
              console.log(
                '[REJECTED] Secure message before authentication'
              );

              socket.write(
                encodeJsonFrame({
                  type: 'error',
                  code: 'NOT_AUTHENTICATED'
                })
              );

              return;
            }

            try {

              console.log(
                `[HUB RECV] secure message from ${peer.id}`
              );

              const payload = decryptObject(
                msg.envelope,
                this.state.pin,
                this.state.salt
              );

              console.log(
                `[HUB DECRYPT] ${payload.type || 'unknown'}`
              );

              this.handleApplication(
                payload,
                peer.id
              );

            } catch (e) {

              console.error(
                `[HUB DECRYPT ERROR] ${e.message}`
              );

              socket.write(
                encodeJsonFrame({
                  type: 'error',
                  code: 'BAD_ENCRYPTED_MESSAGE'
                })
              );
            }

          }

        }
      } catch (e) {
        socket.write(encodeJsonFrame({ type: 'error', code: 'BAD_MESSAGE' }));
      }
    });
    socket.on('close', () => {
      if (peer) this.sockets.delete(peer.id);
    });
    socket.on('error', () => { });
  }



  handleApplication(payload, fromId) {
    if (
      payload.type !== 'clipboard.push' &&
      payload.type !== 'file.start' &&
      payload.type !== 'file.end') return;

    if (payload.type === 'file.start') {
      this.fileTransfers.set(
        payload.transferId,
        {
          senderId: fromId,
          name: payload.file.name,
          mime: payload.file.mime,
          size: payload.file.size,
          hash: payload.file.hash,
          iv: payload.iv
        }
      );

      console.log(
        `[FILE] START ${payload.transferId} ` +
        `${payload.file.name} (${payload.file.size} bytes)`
      );

      return;
    }

    if (payload.type === 'file.end') {
      const transfer = this.fileTransfers.get(
        payload.transferId
      );

      if (!transfer) {
        console.log(
          `[REJECTED] Unknown transfer ${payload.transferId}`
        );
        return;
      }

      console.log(
        `[FILE] END ${payload.transferId} ` +
        `${transfer.name}`
      );

      transfer.hash = payload.hash;
      transfer.authTag = payload.authTag;

      this.fileTransfers.delete(
        payload.transferId
      );

      return;
    }

    if (!payload.hash || payload.hash === this.lastHash) return;

    this.lastHash = payload.hash;
    console.log(`[CLIPBOARD] ${fromId} → ${payload.contentType} ${payload.content?.length ?? 0} bytes`);
    try { setClipboard(payload.content); } catch { }
    for (const [id, socket] of this.sockets) {
      if (id === fromId) continue;
      const envelope = encryptObject(payload, this.state.pin, this.state.salt);
      socket.write(encodeJsonFrame({ type: 'secure', envelope }));
    }
  }

  pushFromHub(payload) {
    if (!payload.hash) {
      console.log('[HUB SEND] No hash');
      return;
    }

    if (payload.hash === this.lastHash) {
      console.log('[HUB SEND] DUPLICATE HASH - NOT SENT');
      return;
    }

    this.lastHash = payload.hash;

    try {
      setClipboard(payload.content);
    } catch { }

    console.log(
      `[HUB SEND] ${payload.contentType} ${payload.content?.length ?? 0} bytes`
    );

    console.log(
      `[HUB SEND] Connected peers: ${this.sockets.size}`
    );

    for (const [id, socket] of this.sockets) {
      console.log(`[HUB SEND] → ${id}`);

      socket.write(
        encodeJsonFrame({
          type: 'secure',
          envelope: encryptObject(
            payload,
            this.state.pin,
            this.state.salt
          )
        })
      );
    }
  }

  devices() {
    return Object.values(
      this.state.peers ?? {}
    ).map(peer => ({
      ...peer,

      // Make sure CLI always has a clear status
      status: peer.trusted
        ? 'TRUSTED'
        : 'KNOWN'
    }));
  }

  revoke(id) {

    /*
    * IMPORTANT:
    *
    * Do NOT only delete the peer.
    *
    * If we only delete peers[id], the device can simply
    * join again because it still knows the PIN.
    *
    * Therefore we maintain a persistent revoked list.
    */

    if (!this.state.revokedDevices) {
      this.state.revokedDevices = [];
    }


    /*
    * Avoid duplicate IDs in revokedDevices.
    */

    if (
      !this.state.revokedDevices.includes(id)
    ) {
      this.state.revokedDevices.push(id);
    }


    /*
    * Remove from the currently trusted device list.
    */

    delete this.state.peers[id];


    /*
    * Persist BEFORE disconnecting.
    *
    * This guarantees that even if the client immediately
    * tries to reconnect, the Hub already knows it is revoked.
    */

    saveState(this.state);


    /*
    * Disconnect active session if it exists.
    */

    const socket =
      this.sockets.get(id);

    if (socket) {
      socket.destroy();
    }

    this.sockets.delete(id);


    console.log(
      `[REVOKE] Device ${id} has been revoked`
    );
  }
}

function osName() {
  return `UC-HUB-${os.hostname().slice(0, 8)}`;
}
