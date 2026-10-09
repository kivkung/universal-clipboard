import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson } from './state.js';
import { CHUNK_SIZE, MAX_FILE_SIZE, MAX_IMAGE_SIZE } from './config.js';

export async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function safeName(name) {
  if (typeof name !== 'string' || !name || name.length > 200 || /[\\/<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) || name === '.' || name === '..') throw new Error('Unsafe filename');
  return name;
}
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function fileMime(name) {
  return ({ '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.zip': 'application/zip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' })[path.extname(name).toLowerCase()] || 'application/octet-stream';
}
function metadata(message) {
  const { name, size, hash, kind = 'file', mime = kind === 'image' ? 'image/png' : fileMime(name || '') } = message;
  safeName(name);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE || !validHash(hash) || !['file', 'image'].includes(kind)) throw new Error('Invalid file metadata');
  if (kind === 'image' && size > MAX_IMAGE_SIZE) throw new Error('Image exceeds 32 MiB');
  if (typeof mime !== 'string' || mime.length > 100 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime)) throw new Error('Invalid MIME type');
  return { name, size, hash, kind, mime };
}
export class TransferStore {
  constructor({ dir, receiveDir, onImage = async () => {}, onComplete, onBatch, storage }) {
    this.dir = path.join(dir, 'incoming');
    this.receiveDir = path.resolve(receiveDir);
    this.onImage = onImage;
    this.onComplete = onComplete; this.onBatch = onBatch; this.storage = storage;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.receiveDir, { recursive: true });
    this.cleanup();
    this.ready = this.restoreReservations();
  }
  cleanup() {
    const cutoff = Date.now() - 7 * 86400_000;
    // Treat metadata and partial as one job: activity on either file keeps both alive.
    const keys = new Set(fs.readdirSync(this.dir).filter(n => /\.(json|part)$/.test(n)).map(n => n.replace(/\.(json|part)$/, '')));
    for (const key of keys) {
      const files = ['.json', '.part'].map(ext => path.join(this.dir, key + ext)).filter(file => fs.existsSync(file));
      if (files.every(file => fs.statSync(file).mtimeMs < cutoff)) for (const file of files) fs.unlinkSync(file);
    }
  }
  paths(id, sender) {
    if (!validHash(id) || typeof sender !== 'string') throw new Error('Invalid transfer');
    const key = crypto.createHash('sha256').update(sender + ':' + id).digest('hex');
    return { meta: path.join(this.dir, key + '.json'), part: path.join(this.dir, key + '.part') };
  }
  batchPath(id, sender) {
    return path.join(this.dir, 'batch-' + path.basename(this.paths(id, sender).meta));
  }
  load(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
  async reserveState(state, token) {
    if (!this.storage) return;
    const files = state.batch ? state.files : [{ transferId: state.transferId, size: state.size }];
    let existingBytes = 0;
    for (const item of files) {
      const part = state.batch ? this.paths(item.transferId, state.sender).part : path.join(this.dir, token.replace(/\.json$/, '.part'));
      const member = state.batch ? this.load(this.paths(item.transferId, state.sender).meta) : null;
      if (member?.complete) existingBytes += item.size;
      else if (fs.existsSync(part)) existingBytes += fs.statSync(part).size;
    }
    await this.storage.reserveIncoming(files.reduce((sum, item) => sum + item.size, 0) * 2, token, { existingBytes });
  }
  async restoreReservations() {
    if (!this.storage) return;
    for (const name of fs.readdirSync(this.dir).filter(x => x.endsWith('.json'))) {
      const state = this.load(path.join(this.dir, name));
      if (!state || state.complete || state.cancelled || state.batchId && !state.batch) continue;
      await this.reserveState(state, name);
    }
  }
  async batch(message, sender) {
    if (!validHash(message.batchId)) throw new Error('Invalid batch ID');
    const file = this.batchPath(message.batchId, sender), token = path.basename(file);
    let state = this.load(file);
    if (message.type === 'file.batch.offer') {
      if (message.distribute !== undefined && typeof message.distribute !== 'boolean') throw new Error('Invalid distribution flag');
      if (state && state.distribute !== message.distribute) throw new Error('Batch distribution changed');
      if (!Array.isArray(message.files) || message.files.length < 1 || message.files.length > 64 || message.count !== message.files.length) throw new Error('Batch requires 1–64 files and matching count');
      const files = message.files.map(item => {
        if (!item || !validHash(item.transferId)) throw new Error('Invalid batch transfer ID');
        const meta = metadata(item);
        if (meta.kind !== 'file') throw new Error('A file batch contains generic files only');
        return { transferId: item.transferId, ...meta };
      });
      if (new Set(files.map(item => item.transferId)).size !== files.length) throw new Error('Duplicate batch member');
      if (state && JSON.stringify(state.files) !== JSON.stringify(files)) throw new Error('Batch metadata changed');
      if (state?.cancelled) throw new Error('Batch cancelled; send as a new batch');
      if (!state) {
        const pending = fs.readdirSync(this.dir).filter(name => name.startsWith('batch-') && name.endsWith('.json')).map(name => this.load(path.join(this.dir, name))).filter(value => !value.complete && !value.cancelled);
        if (pending.length >= 8) throw new Error('Too many unfinished batches; cancel old batches first');
        await this.storage?.reserveIncoming(files.reduce((sum, item) => sum + item.size, 0) * 2, token);
        state = { distribute: message.distribute, batch: true, batchId: message.batchId, sender, senderName: message.fromName, files, updated: Date.now() };
        atomicJson(file, state);
      }
      return { complete: !!state.complete, ...(state.result || {}) };
    }
    if (!state) throw new Error('Unknown batch');
    if (message.type === 'file.batch.cancel') {
      if (state.complete) return { cancelled: false, complete: true };
      for (const item of state.files) {
        const p = this.paths(item.transferId, sender), member = this.load(p.meta);
        if (!member?.complete) { fs.rmSync(p.part, { force: true }); fs.rmSync(p.meta, { force: true }); }
      }
      state.cancelled = true; state.updated = Date.now(); atomicJson(file, state); this.storage?.releaseIncoming(token);
      return { cancelled: true };
    }
    if (message.type !== 'file.batch.finish') throw new Error('Unsupported batch message');
    if (state.cancelled) throw new Error('Batch cancelled');
    if (state.complete) return { complete: true, ...state.result };
    const members = [];
    for (const item of state.files) {
      const member = this.load(this.paths(item.transferId, sender).meta);
      if (!member?.complete || member.batchId !== message.batchId || member.hash !== item.hash || !fs.existsSync(member.output) || await fileHash(member.output) !== item.hash) throw new Error('Batch incomplete or file changed');
      members.push({ ...member });
    }
    // The receiver keeps permanent receive-dir files, and commits one history
    // entry only after every manifest member has passed full validation.
    this.storage?.releaseIncoming(token);
    const result = this.onBatch ? await this.onBatch({ ...state, members }) : {};
    state.complete = true; state.result = result; state.updated = Date.now(); atomicJson(file, state);
    return { complete: true, ...result };
  }
  async completed(state, p, id) {
    if (!fs.existsSync(state.output) || await fileHash(state.output) !== state.hash) throw new Error('Previously received file was removed or changed; send as a new transfer');
    if (!state.batchId && !state.deliveryDone) {
      this.storage?.releaseIncoming(path.basename(p.meta));
      if (this.onComplete) Object.assign(state, await this.onComplete({ ...state, transferId: id }));
      else if (state.kind === 'image') { try { await this.onImage(state.output); } catch (error) { state.clipboardError = error.message; } }
      state.deliveryDone = true; atomicJson(p.meta, state);
    }
    return { complete: true, offset: state.size, path: state.output, ...(state.historyId ? { historyId: state.historyId } : {}), ...(state.clipboardError ? { clipboardError: state.clipboardError } : {}) };
  }
  async handle(message, sender) {
    await this.ready;
    if (typeof message.type !== 'string') throw new Error('Invalid transfer message');
    if (message.type.startsWith('file.batch.')) return this.batch(message, sender);
    const { transferId: id } = message;
    const p = this.paths(id, sender);
    let state = fs.existsSync(p.meta) ? JSON.parse(fs.readFileSync(p.meta, 'utf8')) : null;
    if (message.type === 'file.offer') {
      if (message.distribute !== undefined && typeof message.distribute !== 'boolean') throw new Error('Invalid distribution flag');
      if (state && state.distribute !== message.distribute) throw new Error('Transfer distribution changed');
      const { name, size, hash, kind, mime } = metadata(message);
      if (message.batchId) {
        const batch = validHash(message.batchId) && this.load(this.batchPath(message.batchId, sender));
        if (!batch || batch.cancelled || !Number.isInteger(message.index) || message.index < 0 || JSON.stringify(batch.files[message.index]) !== JSON.stringify({ transferId: id, name, size, hash, kind, mime })) throw new Error('File does not match batch manifest');
        if (!batch.complete) await this.reserveState(batch, path.basename(this.batchPath(message.batchId, sender)));
      } else if (message.index !== undefined) throw new Error('Batch index requires batch ID');
      if (state && (state.name !== name || state.size !== size || state.hash !== hash || state.kind !== kind || (state.mime || mime) !== mime || state.batchId !== message.batchId || state.index !== message.index)) throw new Error('Transfer metadata changed');
      if (!state) {
        const partials = fs.readdirSync(this.dir).filter(x => x.endsWith('.part'));
        if (partials.length >= 32) throw new Error('Too many unfinished transfers; cancel old transfers first');
        if (!message.batchId) await this.storage?.reserveIncoming(size * 2, path.basename(p.meta));
        state = { distribute: message.distribute, name, size, hash, kind, mime, sender, senderName: message.fromName, ...(message.batchId ? { batchId: message.batchId, index: message.index } : {}), updated: Date.now() };
        // A crash between creating the part and its metadata leaves an orphan.
        if (fs.existsSync(p.part)) fs.unlinkSync(p.part);
        fs.writeFileSync(p.part, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
        atomicJson(p.meta, state);
      }
      if (state.complete) {
        return this.completed(state, p, id);
      }
      if (!fs.existsSync(p.part)) fs.writeFileSync(p.part, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      let offset = fs.statSync(p.part).size;
      if (offset > size) throw new Error('Invalid partial file; cancel this transfer');
      if (offset !== size && offset % CHUNK_SIZE !== 0) {
        // Only full chunks were acknowledged. Discard an interrupted disk write.
        offset -= offset % CHUNK_SIZE; fs.truncateSync(p.part, offset);
      }
      return { offset };
    }
    if (!state) throw new Error('Unknown transfer');
    if (message.type === 'file.cancel') {
      if (state.batchId) return this.batch({ type: 'file.batch.cancel', batchId: state.batchId }, sender);
      if (!state.complete) fs.rmSync(p.part, { force: true });
      fs.rmSync(p.meta, { force: true });
      this.storage?.releaseIncoming(path.basename(p.meta));
      return { cancelled: true };
    }
    if (message.type === 'file.chunk') {
      if (state.complete) return { offset: state.size };
      if (typeof message.data !== 'string' || message.data.length > Math.ceil(CHUNK_SIZE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw new Error('Invalid chunk');
      const data = Buffer.from(message.data, 'base64');
      const offset = fs.statSync(p.part).size;
      if (message.offset !== offset || message.sequence !== offset / CHUNK_SIZE || data.length !== Math.min(CHUNK_SIZE, state.size - offset) || !data.length) throw new Error('Invalid chunk offset, sequence or size');
      const file = await fsp.open(p.part, 'a');
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      state.updated = Date.now(); atomicJson(p.meta, state);
      if (state.batchId) { const batchFile = this.batchPath(state.batchId, sender); await this.reserveState(this.load(batchFile), path.basename(batchFile)); }
      else await this.reserveState(state, path.basename(p.meta));
      return { offset: offset + data.length };
    }
    if (message.type !== 'file.finish') throw new Error('Unknown transfer message');
    if (state.complete) return this.completed(state, p, id);
    if (fs.statSync(p.part).size !== state.size) throw new Error('File incomplete');
    if (await fileHash(p.part) !== state.hash) {
      fs.rmSync(p.part, { force: true }); fs.rmSync(p.meta, { force: true });
      if (state.batchId) { const batchFile = this.batchPath(state.batchId, sender); await this.reserveState(this.load(batchFile), path.basename(batchFile)); }
      else this.storage?.releaseIncoming(path.basename(p.meta));
      throw new Error('File SHA-256 mismatch; partial removed');
    }
    // Exclusive copy prevents overwriting existing files, including symlinks.
    let output;
    const ext = path.extname(state.name), stem = path.basename(state.name, ext);
    for (let i = 0; i < 10000; i++) {
      output = path.join(this.receiveDir, i ? stem + ' (' + i + ')' + ext : state.name);
      try { await fsp.copyFile(p.part, output, fs.constants.COPYFILE_EXCL); break; }
      catch (error) { if (error.code !== 'EEXIST' || i === 9999) throw error; }
    }
    state.output = output; state.complete = true;
    atomicJson(p.meta, state); fs.rmSync(p.part, { force: true });
    return this.completed(state, p, id);
  }
}
