import net from 'node:net';
import { connectInternet } from './internet.js';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { deriveKey, proof, equalProof, sessionKey, encryptObject, decryptObject } from './crypto.js';
import { readFrames, writeFrame, hashText } from './protocol.js';
import { PROTOCOL, TCP_PORT, DISCOVERY_PORT, CHUNK_SIZE, MAX_FILE_SIZE } from './config.js';
import { TransferStore, fileHash, safeName, fileMime } from './transfers.js';
import { decodeImage } from './clipboard.js';
import { atomicJson } from './state.js';
import { localIPv4s } from './net.js';

export class Client extends EventEmitter {
  constructor({ host, url, socketFactory, port = TCP_PORT, pin, id, name, dir, receiveDir, clipboard, history, pairing, onPaired = () => {}, retryMs = 1000, requestTimeout = 15000 }) {
    super();
    Object.assign(this, { host, url, socketFactory, port, pin, id, name, dir, clipboard, history, pairing, onPaired, retryMs, requestTimeout });
    this.pending = new Map(); this.ready = false; this.stopped = false; this.paused = false;
    this.sending = new Map(); this.lastHash = null;
    this.clipboardQueue = Promise.resolve();
    this.jobsDir = path.join(dir, 'outgoing'); fs.mkdirSync(this.jobsDir, { recursive: true, mode: 0o700 });
    this.store = new TransferStore({ dir, receiveDir, storage: history, onComplete: history ? entry => this.receiveTransfer(entry) : undefined, onBatch: history ? batch => this.receiveBatch(batch) : undefined, onImage: async file => {
      if (this.paused) throw new Error('Clipboard sync paused; image saved only');
      await this.applyClipboard({ kind: 'image', path: file });
    } });
  }
  async connect() {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.stopped = false;
    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  open() {
    return new Promise((resolve, reject) => {
      const socket = this.socketFactory ? this.socketFactory() : this.url ? connectInternet(this.url) : net.createConnection({ host: this.host, port: this.port });
      this.socket = socket; let key, nonce;
      const timer = setTimeout(() => socket.destroy(new Error('Connection timed out')), 10000);
      const fail = error => { clearTimeout(timer); reject(error); };
      socket.setKeepAlive(true, 10000); socket.setTimeout(30000, () => socket.destroy(new Error('Hub timeout')));
      readFrames(socket, async msg => {
        if (msg.type === 'challenge') {
          if (msg.protocol !== PROTOCOL || typeof msg.salt !== 'string' || typeof msg.nonce !== 'string' || msg.nonce.length > 128) throw new Error('Unsupported Hub protocol');
          if (this.pairing && msg.hubId !== this.pairing.hubId) throw new Error('Invitation belongs to another Host');
          nonce = msg.nonce; key = deriveKey(this.pairing?.secret || this.pin, msg.salt);
          this.key = sessionKey(key, nonce); this.sendSeq = 0; this.recvSeq = 0;
          // A used invitation may have lost auth.ok: the same ID/secret first attempts its persisted credential.
          await writeFrame(socket, { type: 'auth', protocol: PROTOCOL, deviceId: this.id, name: this.name, ...(this.pairing?.id ? { inviteId: this.pairing.id } : {}), proof: proof(key, nonce + ':' + this.id) });
          return;
        }
        if (msg.type === 'error') {
          this.fatal = new Error(msg.code); fail(this.fatal); socket.destroy(); return;
        }
        if (msg.type === 'auth.ok') {
          if (!key || !equalProof(msg.proof, proof(key, 'hub:' + nonce))) throw new Error('Hub authentication failed');
          clearTimeout(timer); this.ready = true; this.fatal = null;
          if (this.pairing?.id) { delete this.pairing.id; this.onPaired(this.pairing); }
          this.heartbeat = setInterval(() => this.send({ type: 'ping' }).catch(() => socket.destroy()), 10000);
          resolve(); this.emit('connected'); return;
        }
        if (!this.ready || msg.type !== 'secure') throw new Error('Unexpected message');
        const payload = decryptObject(msg.envelope, this.key);
        if (payload.seq !== this.recvSeq++) throw new Error('Invalid message sequence');
        await this.handle(payload.body);
      }, fail);
      socket.on('error', fail);
      socket.on('close', () => {
        clearTimeout(timer); clearInterval(this.heartbeat); this.ready = false;
        fail(new Error('Disconnected'));
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Object.assign(new Error('Disconnected'), { retryable: true })); }
        this.pending.clear(); this.emit('disconnected');
        if (!this.stopped && !this.fatal) this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), this.retryMs);
      });
    });
  }
  send(body) {
    if (!this.ready) return Promise.reject(Object.assign(new Error('Disconnected'), { retryable: true }));
    return writeFrame(this.socket, { type: 'secure', envelope: encryptObject({ seq: this.sendSeq++, body }, this.key) });
  }
  request(body) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Object.assign(new Error('Request timed out'), { retryable: true }));
      }, this.requestTimeout);
      this.pending.set(requestId, { resolve, reject, timer, from: body.to || '@hub' });
      this.send({ ...body, requestId }).catch(error => { clearTimeout(timer); this.pending.delete(requestId); reject(Object.assign(error, { retryable: true })); });
    });
  }
  async handle(body) {
    if (body.replyTo) {
      const pending = this.pending.get(body.replyTo);
      if (!pending || pending.from !== body.from) return;
      clearTimeout(pending.timer); this.pending.delete(body.replyTo);
      if (body.error) pending.reject(Object.assign(new Error(body.error), { retryable: !!body.retryable }));
      else pending.resolve(body.result);
      return;
    }
    if (body.type === 'pong') return;
    if (!body.requestId || !body.from) return;
    let result, error;
    try {
      if (body.type.startsWith('file.')) result = await this.store.handle(body, body.from);
      else if (body.type === 'clipboard.text') {
        if (typeof body.text !== 'string' || Buffer.byteLength(body.text) > 512 * 1024 || hashText(body.text) !== body.hash) throw new Error('Invalid clipboard text');
        if (body.entryId !== undefined && (typeof body.entryId !== 'string' || !/^[a-f0-9]{64}$/.test(body.entryId))) throw new Error('Invalid text entry ID');
        let historyId;
        if (this.history) {
          const entry = await this.history.commit({ kind: 'text', text: body.text }, { sourceId: hashText(body.from + ':text:' + (body.entryId || body.requestId)), sender: { id: body.from, name: body.fromName } });
          historyId = entry.id;
          if (!this.paused && !entry.deduplicated) await this.publishHistory(entry.id);
        } else if (!this.paused && body.hash !== this.lastHash) await this.applyClipboard({ kind: 'text', text: body.text });
        result = { applied: !this.paused, ...(historyId ? { historyId } : {}) };
      } else throw new Error('Unsupported message');
    } catch (e) { error = e.message; }
    await this.send({ type: 'reply', to: body.from, replyTo: body.requestId, ...(error ? { error } : { result }) });
  }
  publishHistory(id, manual = false) {
    const task = this.clipboardQueue.then(() => this.publishHistoryOnce(id, manual));
    this.clipboardQueue = task.catch(() => {}); return task;
  }
  async publishHistoryOnce(id, manual) {
    if (this.paused && !manual) throw new Error('Clipboard sync paused; entry saved in history');
    const item = await this.history.item(id);
    await this.history.pin(id, 'clipboard-next');
    let applied = false;
    try {
      await this.applyClipboard(item);
      applied = true;
      await this.history.pin(id, 'clipboard');
      await this.history.unpin('clipboard-next');
    } catch (error) { if (!applied) await this.history.unpin('clipboard-next'); throw error; }
  }
  async receiveTransfer(value) {
    if (value.kind === 'image') decodeImage(await fsp.readFile(value.output));
    const item = value.kind === 'image' ? { kind: 'image', path: value.output, name: value.name, mime: value.mime }
      : { kind: 'files', files: [{ path: value.output, name: value.name, mime: value.mime }] };
    const entry = await this.history.commit(item, { sourceId: hashText(value.sender + ':file:' + value.transferId), sender: { id: value.sender, name: value.senderName } });
    let clipboardError;
    if (!entry.deduplicated) { try { await this.publishHistory(entry.id); } catch (error) { clipboardError = error.message; } }
    this.emit('history', entry);
    return { historyId: entry.id, ...(clipboardError ? { clipboardError } : {}) };
  }
  async receiveBatch(batch) {
    const entry = await this.history.commit({ kind: 'files', files: batch.members.map(value => ({ path: value.output, name: value.name, mime: value.mime })) }, { sourceId: hashText(batch.sender + ':batch:' + batch.batchId), batchId: batch.batchId, sender: { id: batch.sender, name: batch.senderName } });
    let clipboardError;
    if (!entry.deduplicated) { try { await this.publishHistory(entry.id); } catch (error) { clipboardError = error.message; } }
    this.emit('history', entry);
    return { historyId: entry.id, ...(clipboardError ? { clipboardError } : {}) };
  }
  async applyClipboard(item) {
    if (!this.clipboard) throw new Error('Clipboard unavailable');
    this.applying = true;
    try {
      await this.clipboard.write(item);
      // Native image encoders can normalize PNG bytes; remember the actual local representation.
      const current = await this.clipboard.read().catch(() => null);
      this.lastHash = current?.hash ?? (item.kind === 'text' ? hashText(item.text) : item.kind === 'files' ? hashText(JSON.stringify(item.files)) : null);
      this.emit('clipboard', item.kind);
    } finally { this.applying = false; }
  }
  devices() { return this.request({ type: 'devices' }); }
  async recipients(to) {
    const devices = (await this.devices()).filter(d => d.id !== this.id);
    if (to && to !== 'all') {
      const matches = devices.filter(d => d.id === to || d.name === to);
      if (matches.length !== 1) throw new Error('Recipient not found or name ambiguous; use device ID');
      return matches;
    }
    if (!devices.length) throw new Error('No other devices connected');
    return devices;
  }
  async push(text, to) {
    if (Buffer.byteLength(text) > 512 * 1024) throw new Error('Text exceeds 512 KiB');
    const hash = hashText(text);
    const results = [];
    const entryId = crypto.randomBytes(32).toString('hex');
    for (const peer of await this.recipients(to)) results.push({ id: peer.id, ...await this.request({ type: 'clipboard.text', to: peer.id, text, hash, entryId }) });
    this.lastHash = hash; return results;
  }
  async sendFile(file, to, kind = 'file') {
    file = path.resolve(file);
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) throw new Error('Expected a file up to 10 GiB');
    const name = safeName(path.basename(file));
    const hash = await fileHash(file);
    const results = [];
    for (const peer of await this.recipients(to)) {
      const job = { file, to: peer.id, name, size: stat.size, hash, kind, mime: kind === 'image' ? 'image/png' : fileMime(name), transferId: crypto.randomBytes(32).toString('hex') };
      atomicJson(path.join(this.jobsDir, job.transferId + '.json'), job);
      try { results.push(await this.runJob(job)); }
      catch (error) { results.push({ to: peer.id, transferId: job.transferId, error: error.message }); }
    }
    return results;
  }
  async sendFiles(files, to) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 64) throw new Error('Select 1–64 regular files');
    const members = [];
    for (const source of files) {
      const file = path.resolve(source), stat = await fsp.stat(file), name = safeName(path.basename(file));
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) throw new Error('Expected regular files up to 10 GiB; folders are not supported');
      members.push({ file, name, size: stat.size, hash: await fileHash(file), kind: 'file', mime: fileMime(name), transferId: crypto.randomBytes(32).toString('hex') });
    }
    const results = [];
    for (const peer of await this.recipients(to)) {
      const job = { batch: true, batchId: crypto.randomBytes(32).toString('hex'), to: peer.id, files: members.map(member => ({ ...member, transferId: crypto.randomBytes(32).toString('hex') })) };
      atomicJson(path.join(this.jobsDir, job.batchId + '.json'), job);
      try { results.push(await this.runJob(job)); } catch (error) { results.push({ to: peer.id, batchId: job.batchId, error: error.message }); }
    }
    return results;
  }
  async runJob(job) {
    const id = job.batch ? job.batchId : job.transferId;
    if (this.sending.has(id)) return this.sending.get(id);
    const task = (job.batch ? this.transferBatch(job) : this.transfer(job)).finally(() => this.sending.delete(id));
    this.sending.set(id, task); return task;
  }
  async transferBatch(job) {
    const deadline = Date.now() + 5 * 60_000;
    const manifest = job.files.map(({ file, ...metadata }) => metadata);
    while (!this.stopped) {
      try {
        const offered = await this.request({ type: 'file.batch.offer', to: job.to, batchId: job.batchId, count: manifest.length, files: manifest });
        if (offered.complete) { fs.rmSync(path.join(this.jobsDir, job.batchId + '.json'), { force: true }); return { ...offered, to: job.to, batchId: job.batchId }; }
        const members = [];
        for (const [index, member] of job.files.entries()) {
          if (await fileHash(member.file) !== member.hash) throw new Error('Source file changed: ' + member.file);
          members.push(await this.transfer({ ...member, to: job.to, batchId: job.batchId, index }));
        }
        const result = await this.request({ type: 'file.batch.finish', to: job.to, batchId: job.batchId });
        if (!result.complete) throw new Error('Receiver did not confirm batch completion');
        fs.rmSync(path.join(this.jobsDir, job.batchId + '.json'), { force: true });
        return { ...result, to: job.to, batchId: job.batchId, files: members };
      } catch (error) {
        if (!error.retryable || this.fatal || Date.now() > deadline || this.stopped) throw error;
        this.emit('retry', { name: 'File batch', message: error.message });
        await new Promise(resolve => setTimeout(resolve, this.retryMs));
      }
    }
    throw new Error('Stopped; batch saved for uc resume');
  }
  async transfer(job) {
    const deadline = Date.now() + 5 * 60_000;
    let resumed = 0;
    while (!this.stopped) {
      if (job.cancelled) throw new Error('Transfer cancelled');
      try {
        if (!this.ready) throw Object.assign(new Error('Disconnected'), { retryable: true });
        const offered = await this.request({ ...job, file: undefined, type: 'file.offer' });
        if (offered.complete) {
          if (!job.batchId) fs.rmSync(path.join(this.jobsDir, job.transferId + '.json'), { force: true });
          return { ...offered, to: job.to, resumedBytes: job.size };
        }
        let offset = offered.offset;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > job.size || (offset !== job.size && offset % CHUNK_SIZE)) throw new Error('Invalid resume offset');
        resumed = Math.max(resumed, offset);
        const file = await fsp.open(job.file, 'r');
        try {
          const buffer = Buffer.alloc(CHUNK_SIZE);
          while (offset < job.size) {
            if (job.cancelled || this.stopped) throw new Error('Transfer cancelled or stopped');
            const length = Math.min(CHUNK_SIZE, job.size - offset);
            const { bytesRead } = await file.read(buffer, 0, length, offset);
            if (bytesRead !== length) throw new Error('Source file changed');
            const reply = await this.request({ type: 'file.chunk', to: job.to, transferId: job.transferId, offset, sequence: offset / CHUNK_SIZE, data: buffer.subarray(0, bytesRead).toString('base64') });
            if (reply.offset !== offset + bytesRead) throw new Error('Invalid receiver acknowledgement');
            offset = reply.offset;
            this.emit('progress', { transferId: job.transferId, to: job.to, name: job.name, bytes: offset, size: job.size });
          }
        } finally { await file.close(); }
        const result = await this.request({ type: 'file.finish', transferId: job.transferId, to: job.to });
        if (!result.complete) throw new Error('Receiver did not confirm completion');
        if (!job.batchId) fs.rmSync(path.join(this.jobsDir, job.transferId + '.json'), { force: true });
        this.emit('sent', { name: job.name, to: job.to });
        return { ...result, to: job.to, resumedBytes: resumed };
      } catch (error) {
        if (!error.retryable || this.fatal || Date.now() > deadline || this.stopped) throw error;
        this.emit('retry', { name: job.name, message: error.message });
        await new Promise(resolve => setTimeout(resolve, this.retryMs));
      }
    }
    throw new Error('Stopped; transfer saved for uc resume');
  }
  jobs() {
    return fs.readdirSync(this.jobsDir).filter(x => x.endsWith('.json')).map(x => JSON.parse(fs.readFileSync(path.join(this.jobsDir, x), 'utf8')));
  }
  async resume() {
    const results = [];
    for (const job of this.jobs()) {
      try {
        for (const member of job.batch ? job.files : [job]) if (await fileHash(member.file) !== member.hash) throw new Error('Source file changed: ' + member.file);
        results.push(await this.runJob(job));
      } catch (error) { results.push({ to: job.to, ...(job.batch ? { batchId: job.batchId } : { transferId: job.transferId }), error: error.message }); }
    }
    return results;
  }
  async cancel(id) {
    const job = this.jobs().find(j => (j.batch ? j.batchId : j.transferId) === id);
    if (!job) throw new Error('Unknown outgoing transfer');
    if (this.sending.has(id)) throw new Error('Wait for the active transfer to finish or stop the process before cancelling');
    let remoteCleanupPending = false;
    try { await this.request(job.batch ? { type: 'file.batch.cancel', to: job.to, batchId: id } : { type: 'file.cancel', to: job.to, transferId: id }); }
    catch (error) { if (!error.retryable) throw error; remoteCleanupPending = true; }
    fs.rmSync(path.join(this.jobsDir, id + '.json'), { force: true });
    return { cancelled: true, remoteCleanupPending };
  }
  async close() {
    this.stopped = true; clearTimeout(this.reconnectTimer); clearInterval(this.heartbeat);
    this.socket?.destroy();
  }
}
export function discover(timeoutMs = 1800, port = DISCOVERY_PORT) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4'), found = new Map();
    let timer, finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); try { socket.close(); } catch {} resolve([...found.values()]); };
    socket.on('error', finish);
    socket.on('message', (buf, remote) => {
      try { const msg = JSON.parse(buf); if (msg.type === 'uc.hub' && msg.protocol === PROTOCOL && Number.isInteger(msg.port) && msg.port > 0 && msg.port <= 65535) found.set(msg.hubId, { ...msg, address: remote.address }); } catch {}
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      const packet = Buffer.from(JSON.stringify({ type: 'uc.discover', protocol: PROTOCOL }));
      for (const address of new Set(['255.255.255.255', ...localIPv4s().map(x => x.broadcast)])) socket.send(packet, port, address, () => {});
    });
    timer = setTimeout(finish, timeoutMs);
  });
}
