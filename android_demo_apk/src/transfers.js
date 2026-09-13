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
export class TransferStore {
  constructor({ dir, receiveDir, onImage = async () => {} }) {
    this.dir = path.join(dir, 'incoming');
    this.receiveDir = path.resolve(receiveDir);
    this.onImage = onImage;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.receiveDir, { recursive: true });
    this.cleanup();
  }
  cleanup() {
    const cutoff = Date.now() - 7 * 86400_000;
    for (const name of fs.readdirSync(this.dir)) {
      const file = path.join(this.dir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  }
  paths(id, sender) {
    if (!validHash(id) || typeof sender !== 'string') throw new Error('Invalid transfer');
    const key = crypto.createHash('sha256').update(sender + ':' + id).digest('hex');
    return { meta: path.join(this.dir, key + '.json'), part: path.join(this.dir, key + '.part') };
  }
  async handle(message, sender) {
    const { transferId: id } = message;
    const p = this.paths(id, sender);
    let state = fs.existsSync(p.meta) ? JSON.parse(fs.readFileSync(p.meta, 'utf8')) : null;
    if (message.type === 'file.offer') {
      const { name, size, hash, kind = 'file' } = message;
      safeName(name);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE || !validHash(hash) || !['file', 'image'].includes(kind)) throw new Error('Invalid file metadata');
      if (kind === 'image' && size > MAX_IMAGE_SIZE) throw new Error('Image exceeds 32 MiB');
      if (state && (state.name !== name || state.size !== size || state.hash !== hash || state.kind !== kind)) throw new Error('Transfer metadata changed');
      if (!state) {
        const partials = fs.readdirSync(this.dir).filter(x => x.endsWith('.part'));
        if (partials.length >= 32) throw new Error('Too many unfinished transfers; cancel old transfers first');
        state = { name, size, hash, kind, sender, updated: Date.now() };
        // A crash between creating the part and its metadata leaves an orphan.
        if (fs.existsSync(p.part)) fs.unlinkSync(p.part);
        fs.writeFileSync(p.part, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
        atomicJson(p.meta, state);
      }
      if (state.complete) {
        if (fs.existsSync(state.output) && await fileHash(state.output) === hash) return { complete: true, offset: size, path: state.output, ...(state.clipboardError ? { clipboardError: state.clipboardError } : {}) };
        throw new Error('Previously received file was removed or changed; send as a new transfer');
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
      if (!state.complete) fs.rmSync(p.part, { force: true });
      fs.rmSync(p.meta, { force: true });
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
      return { offset: offset + data.length };
    }
    if (message.type !== 'file.finish') throw new Error('Unknown transfer message');
    if (state.complete) return { complete: true, path: state.output, offset: state.size, ...(state.clipboardError ? { clipboardError: state.clipboardError } : {}) };
    if (fs.statSync(p.part).size !== state.size) throw new Error('File incomplete');
    if (await fileHash(p.part) !== state.hash) {
      fs.rmSync(p.part, { force: true }); fs.rmSync(p.meta, { force: true });
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
    let clipboardError;
    if (state.kind === 'image') {
      try { await this.onImage(output); }
      catch (error) { clipboardError = error.message; }
    }
    if (clipboardError) { state.clipboardError = clipboardError; atomicJson(p.meta, state); }
    return { complete: true, offset: state.size, path: output, ...(clipboardError ? { clipboardError } : {}) };
  }
}
