import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import { TCP_PORT, DISCOVERY_PORT, PROTOCOL } from './config.js';
import { encryptObject, decryptObject } from './crypto.js';
import { line, parseLines, clipboardMessage } from './protocol.js';
import { deviceId, loadState, saveState } from './state.js';
import { getClipboard, setClipboard } from './clipboard.js';
import { localIPv4s } from './net.js';

export class Client {
  constructor({ host, port = TCP_PORT, pin }) {
    this.id = deviceId();
    this.host = host;
    this.port = Number(port);
    this.pin = pin;
    this.state = loadState();
    this.state.role = 'client';
    this.state.hub = { host: this.host, port: this.port };
    this.state.pin = this.pin;
    saveState(this.state);
    this.socket = null;
    this.salt = null;
    this.buffer = '';
    this.lastHash = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        socket.write(line({ type: 'auth', protocol: PROTOCOL, deviceId: this.id, name: os.hostname(), pin: this.pin }));
      });
      socket.on('data', chunk => {
        this.buffer += chunk;
        try {
          const parsed = parseLines(this.buffer);
          this.buffer = parsed.buffer;
          for (const msg of parsed.messages) {
            if (msg.type === 'auth.ok') {
              this.salt = msg.salt;
              console.log(`Connected to Hub ${msg.hubId} at ${this.host}:${this.port}`);
              resolve();
            } else if (msg.type === 'error') {
              reject(new Error(msg.code));
              socket.destroy();
            } else if (msg.type === 'secure') {
              try {
                const payload = decryptObject(msg.envelope, this.pin, this.salt);
                this.handleApplication(payload);
              } catch { console.error('[ERROR] Could not decrypt incoming message'); }
            }
          }
        } catch (e) { reject(e); }
      });
      socket.on('error', err => reject(err));
      socket.on('close', () => console.log('[CONNECTION] closed'));
    });
  }

  handleApplication(payload) {
    if (payload.type !== 'clipboard.push') return;
    if (payload.senderId === this.id || payload.hash === this.lastHash) return;
    this.lastHash = payload.hash;
    if (payload.contentType === 'text') {
      setClipboard(payload.content);
      console.log(`[SYNC] received ${payload.content.length} bytes from ${payload.senderId}`);
    }
  }

  push(text) {
    const payload = clipboardMessage({ senderId: this.id, text });
    if (payload.hash === this.lastHash) return;
    this.lastHash = payload.hash;
    this.socket.write(line({ type: 'secure', envelope: encryptObject(payload, this.pin, this.salt) }));
    console.log(`[SEND] ${text.length} bytes`);
  }
}

export async function discover(timeoutMs = 1800) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const found = new Map();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch {}
      resolve([...found.values()]);
    };

    socket.on('error', err => {
      console.error(`[DISCOVERY] UDP error: ${err.message}`);
      finish();
    });

    socket.on('message', (buf, rinfo) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'uc.hub' && msg.protocol === PROTOCOL) {
          found.set(msg.hubId, { ...msg, address: rinfo.address });
        }
      } catch {}
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      const packet = Buffer.from(JSON.stringify({
        type: 'uc.discover',
        protocol: PROTOCOL
      }));

      // Broadcast once per active IPv4 interface. This is more reliable than
      // relying only on 255.255.255.255, especially on Windows Hotspot/ICS
      // networks such as 192.168.137.0/24.
      const broadcasts = new Set(['255.255.255.255']);
      for (const nic of localIPv4s()) {
        if (nic.broadcast) broadcasts.add(nic.broadcast);
      }

      console.log(`[DISCOVERY] Searching for hubs for ${timeoutMs}ms...`);
      console.log(`[DISCOVERY] Broadcast targets: ${[...broadcasts].join(', ')}`);

      for (const address of broadcasts) {
        socket.send(packet, DISCOVERY_PORT, address, err => {
          if (err) console.error(`[DISCOVERY] Could not send to ${address}: ${err.message}`);
        });
      }
    });

    setTimeout(finish, timeoutMs);
  });
}
