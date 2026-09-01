import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import os from 'node:os';
import { TCP_PORT, DISCOVERY_PORT, PROTOCOL } from './config.js';
import { encryptObject, decryptObject, randomPin, randomSalt } from './crypto.js';
import { line, parseLines } from './protocol.js';
import { deviceId, loadState, saveState } from './state.js';
import { localIPv4s } from './net.js';
import { getClipboard, setClipboard } from './clipboard.js';

export class Hub {
  constructor() {
    this.id = deviceId();
    this.state = loadState();
    this.state.role = 'hub';
    this.state.pin = this.state.pin ?? randomPin();
    this.state.salt = this.state.salt ?? randomSalt();
    this.state.peers = this.state.peers ?? {};
    saveState(this.state);
    this.sockets = new Map();
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
      } catch {}
    });
  }

  handleSocket(socket) {
    let buffer = '';
    let peer = null;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      try {
        const parsed = parseLines(buffer);
        buffer = parsed.buffer;
        for (const msg of parsed.messages) {
          if (msg.type === 'auth') {
            if (msg.pin !== this.state.pin) {
              socket.write(line({ type: 'error', code: 'BAD_PIN' }));
              socket.destroy();
              return;
            }
            peer = { id: msg.deviceId, socket, address: socket.remoteAddress };
            this.sockets.set(peer.id, socket);
            this.state.peers[peer.id] = {
              id: peer.id, name: msg.name ?? peer.id,
              address: socket.remoteAddress, lastSeen: Date.now()
            };
            saveState(this.state);
            socket.write(line({
              type: 'auth.ok', protocol: PROTOCOL, hubId: this.id,
              salt: this.state.salt
            }));
            console.log(`\n[JOIN] ${peer.id} from ${socket.remoteAddress}`);
          } else if (msg.type === 'secure') {
            if (!peer) continue;
            try {
              const payload = decryptObject(msg.envelope, this.state.pin, this.state.salt);
              this.handleApplication(payload, peer.id);
            } catch (e) {
              socket.write(line({ type: 'error', code: 'DECRYPT_FAILED' }));
            }
          }
        }
      } catch (e) {
        socket.write(line({ type: 'error', code: 'BAD_MESSAGE' }));
      }
    });
    socket.on('close', () => {
      if (peer) this.sockets.delete(peer.id);
    });
    socket.on('error', () => {});
  }

  handleApplication(payload, fromId) {
    if (payload.type !== 'clipboard.push') return;
    if (!payload.hash || payload.hash === this.lastHash) return;
    this.lastHash = payload.hash;
    console.log(`[CLIPBOARD] ${fromId} → ${payload.contentType} ${payload.content?.length ?? 0} bytes`);
    try { setClipboard(payload.content); } catch {}
    for (const [id, socket] of this.sockets) {
      if (id === fromId) continue;
      const envelope = encryptObject(payload, this.state.pin, this.state.salt);
      socket.write(line({ type: 'secure', envelope }));
    }
  }

  pushFromHub(payload) {
    if (!payload.hash || payload.hash === this.lastHash) return;
    this.lastHash = payload.hash;
    try { setClipboard(payload.content); } catch {}
    for (const socket of this.sockets.values()) {
      socket.write(line({ type: 'secure', envelope: encryptObject(payload, this.state.pin, this.state.salt) }));
    }
  }

  devices() { return Object.values(this.state.peers ?? {}); }

  revoke(id) {
    delete this.state.peers[id];
    saveState(this.state);
    const socket = this.sockets.get(id);
    if (socket) socket.destroy();
    this.sockets.delete(id);
  }
}

function osName() {
  return `UC-HUB-${os.hostname().slice(0, 8)}`;
}
