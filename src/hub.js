import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TCP_PORT, DISCOVERY_PORT, PROTOCOL } from './config.js';
import { deriveKey, proof, equalProof, sessionKey, encryptObject, decryptObject, randomPin, randomSalt } from './crypto.js';
import { readFrames, writeFrame } from './protocol.js';

export class Hub extends EventEmitter {
  constructor({ state = {}, save = () => {}, port = TCP_PORT, discoveryPort = DISCOVERY_PORT, bind = '0.0.0.0' } = {}) {
    super();
    this.state = state; this.save = save; this.port = port; this.discoveryPort = discoveryPort; this.bind = bind;
    state.pin ??= randomPin(); state.salt ??= randomSalt(); state.peers ??= {}; state.revokedDevices ??= [];
    this.key = deriveKey(state.pin, state.salt);
    this.sessions = new Map(); this.connections = new Set(); this.failures = new Map();
    save(state);
  }
  async start() {
    this.server = net.createServer(socket => this.accept(socket));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.bind, resolve); });
    this.port = this.server.address().port;
    this.server.on('error', error => this.emit('warning', error.message));
    if (this.discoveryPort !== false) {
      this.discovery = dgram.createSocket('udp4');
      this.discovery.on('error', error => this.emit('warning', 'Discovery: ' + error.message));
      this.discovery.on('message', (data, remote) => {
        if (data.length > 512) return;
        try {
          const msg = JSON.parse(data);
          if (msg.type !== 'uc.discover' || msg.protocol !== PROTOCOL) return;
          const response = { type: 'uc.hub', protocol: PROTOCOL, hubId: this.state.deviceId, name: this.state.name, port: this.port };
          this.discovery.send(Buffer.from(JSON.stringify(response)), remote.port, remote.address, () => {});
        } catch {}
      });
      this.discovery.bind(this.discoveryPort, this.bind);
    }
    return this.port;
  }
  accept(socket) {
    const ip = socket.remoteAddress;
    const fail = this.failures.get(ip);
    if (this.connections.size >= 64 || (fail && fail.count >= 5 && fail.until > Date.now())) { socket.destroy(); return; }
    this.connections.add(socket);
    socket.setKeepAlive(true, 10_000); socket.setTimeout(30_000, () => socket.destroy());
    const nonce = crypto.randomBytes(32).toString('base64url');
    let peer;
    const timer = setTimeout(() => socket.destroy(), 10_000);
    const failAuth = async code => {
      const old = this.failures.get(ip);
      this.failures.set(ip, { count: old && old.until > Date.now() ? old.count + 1 : 1, until: Date.now() + 60_000 });
      if (this.failures.size > 1024) this.failures.delete(this.failures.keys().next().value);
      await writeFrame(socket, { type: 'error', code }); socket.end();
    };
    writeFrame(socket, { type: 'challenge', protocol: PROTOCOL, nonce, salt: this.state.salt, hubId: this.state.deviceId }).catch(() => socket.destroy());
    readFrames(socket, async msg => {
      if (!peer) {
        if (msg.type !== 'auth' || msg.protocol !== PROTOCOL) return failAuth('PROTOCOL_MISMATCH');
        if (typeof msg.deviceId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(msg.deviceId) || typeof msg.name !== 'string' || msg.name.length > 80) return failAuth('BAD_IDENTITY');
        if (this.state.revokedDevices.includes(msg.deviceId)) return failAuth('DEVICE_REVOKED');
        if (!equalProof(msg.proof, proof(this.key, nonce + ':' + msg.deviceId))) return failAuth('BAD_PIN');
        // A second terminal must use local control rather than replacing the live receiver.
        if (this.sessions.has(msg.deviceId)) return failAuth('DEVICE_ALREADY_CONNECTED');
        peer = { id: msg.deviceId, name: msg.name, socket, key: sessionKey(this.key, nonce), sendSeq: 0, recvSeq: 0 };
        this.sessions.set(peer.id, peer); clearTimeout(timer);
        this.state.peers[peer.id] = { id: peer.id, name: peer.name, lastSeen: Date.now() }; this.save(this.state);
        await writeFrame(socket, { type: 'auth.ok', proof: proof(this.key, 'hub:' + nonce) });
        return;
      }
      if (msg.type !== 'secure') throw new Error('Expected encrypted message');
      const payload = decryptObject(msg.envelope, peer.key);
      if (payload.seq !== peer.recvSeq++) throw new Error('Invalid sequence');
      const body = payload.body;
      if (!body || typeof body.type !== 'string') throw new Error('Invalid message');
      if (body.type === 'ping') return this.send(peer, { type: 'pong' });
      if (body.type === 'devices') {
        return this.send(peer, { replyTo: body.requestId, from: '@hub', result: [...this.sessions.values()].map(p => ({ id: p.id, name: p.name, online: true })) });
      }
      if (typeof body.to !== 'string') throw new Error('Recipient required');
      const target = this.sessions.get(body.to);
      if (!target) {
        if (body.requestId) await this.send(peer, { replyTo: body.requestId, from: body.to, error: 'Recipient offline', retryable: true });
        return;
      }
      const forwarded = { ...body, from: peer.id }; delete forwarded.seq;
      try { await this.send(target, forwarded); }
      catch { target.socket.destroy(); }
    }, error => this.emit('warning', error.message));
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); this.connections.delete(socket); if (peer && this.sessions.get(peer.id) === peer) this.sessions.delete(peer.id); });
  }
  send(peer, body) { return writeFrame(peer.socket, { type: 'secure', envelope: encryptObject({ seq: peer.sendSeq++, body }, peer.key) }); }
  revoke(id) {
    if (id === this.state.deviceId) throw new Error('Cannot revoke the Hub endpoint');
    if (!this.state.revokedDevices.includes(id)) this.state.revokedDevices.push(id);
    delete this.state.peers[id]; this.save(this.state);
    this.sessions.get(id)?.socket.destroy();
  }
  async close() {
    for (const socket of this.connections) socket.destroy();
    if (this.discovery) { try { this.discovery.close(); } catch {} }
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
  }
}
