import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_HISTORY_BUDGET = 32 * 1024 ** 3;
export const DEFAULT_FREE_RESERVE = 256 * 1024 ** 2;
const safeName = name => {
  let cleaned = path.basename(String(name || 'file').replaceAll('\\', '/')).replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/, '') || 'file';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(cleaned)) cleaned = '_' + cleaned;
  return cleaned;
};
async function syncFile(file) { const handle = await fs.open(file, 'r+'); try { await handle.sync(); } finally { await handle.close(); } }
async function syncDirectory(dir) {
  // Windows does not permit opening directory handles through this Node API.
  if (process.platform === 'win32') return;
  const handle = await fs.open(dir, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function treeSize(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await treeSize(file);
    else if (entry.isFile()) total += (await fs.stat(file)).size;
  }
  return total;
}
/** Internal cache only: exported and pre-existing received files are never deleted. */
export class HistoryStore {
  constructor({ dir, budgetBytes = Number(process.env.UC_HISTORY_BUDGET_BYTES || DEFAULT_HISTORY_BUDGET), reserveBytes = DEFAULT_FREE_RESERVE, partialDir } = {}) {
    if (!dir || !Number.isSafeInteger(budgetBytes) || budgetBytes < 1) throw new Error('Invalid history directory or storage budget');
    this.dir = path.join(dir, 'history'); this.partialDir = partialDir;
    this.budgetBytes = budgetBytes; this.reserveBytes = reserveBytes;
    this.entries = []; this.retired = []; this.sources = {}; this.pins = new Map(); this.readers = new Map(); this.reservations = new Map(); this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    let index;
    try { index = JSON.parse(await fs.readFile(path.join(this.dir, 'index.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot recover clipboard history: ${error.message}`); }
    if (index) {
      if (index.version !== 1 || !Array.isArray(index.entries) || !Array.isArray(index.retired)) throw new Error('Invalid history index');
      for (const entry of [...index.entries, ...index.retired]) {
        if (!/^[0-9a-f-]{36}$/.test(entry.id) || !Array.isArray(entry.payloads)) throw new Error('Invalid history entry');
        const entryDir = path.join(this.dir, entry.id);
        for (const payload of entry.payloads) {
          const resolved = path.resolve(payload.path);
          if (!resolved.startsWith(entryDir + path.sep)) throw new Error('Unsafe history payload path');
          const relative = path.relative(entryDir, resolved).split(path.sep);
          let current = this.dir;
          for (const segment of [entry.id, ...relative]) {
            current = path.join(current, segment);
            if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Unsafe symbolic link in history payload');
          }
          if (!(await fs.stat(resolved)).isFile()) throw new Error('History payload is not a regular file');
        }
      }
      this.entries = index.entries; this.retired = index.retired; this.sources = index.sources || {};
      for (const [owner, id] of Object.entries(index.pins || {})) this.pins.set(owner, id);
    }
    // Staging directories and orphan payloads were never committed successfully.
    const known = new Set([...this.entries, ...this.retired].map(entry => entry.id));
    for (const item of await fs.readdir(this.dir, { withFileTypes: true })) if (item.isDirectory() && !known.has(item.name)) await fs.rm(path.join(this.dir, item.name), { recursive: true, force: true });
    await this.cleanup(); return this;
  }
  async persist() {
    const tmp = path.join(this.dir, `index.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify({ version: 1, entries: this.entries, retired: this.retired, sources: this.sources, pins: Object.fromEntries(this.pins) }), { mode: 0o600 });
    await syncFile(tmp);
    await fs.rename(tmp, path.join(this.dir, 'index.json'));
    await syncDirectory(this.dir);
  }
  async list() { return structuredClone(this.entries); }
  async get(id) { const entry = [...this.entries, ...this.retired].find(entry => entry.id === id); if (!entry) throw new Error('History entry not found'); return structuredClone(entry); }
  async item(id) {
    const entry = await this.get(id);
    if (entry.kind === 'text') return { kind: 'text', text: await fs.readFile(entry.payloads[0].path, 'utf8') };
    if (entry.kind === 'image') return { kind: 'image', path: entry.payloads[0].path };
    return { kind: 'files', files: entry.payloads.map(payload => payload.path) };
  }
  async usage() { return { bytes: await treeSize(this.dir) + (this.partialDir ? await treeSize(this.partialDir) : 0), reservedBytes: [...this.reservations.values()].reduce((a, b) => a + b, 0), budgetBytes: this.budgetBytes }; }
  async checkSpace(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid storage reservation size');
    const usage = await this.usage();
    if (usage.bytes + usage.reservedBytes + bytes > this.budgetBytes) throw new Error('Clipboard storage budget exceeded; save or release pinned history, or increase UC_HISTORY_BUDGET_BYTES');
    const disk = await fs.statfs(this.dir);
    if (disk.bavail * disk.bsize < bytes + this.reserveBytes) throw new Error('Insufficient disk space for clipboard data and free-space reserve');
  }
  reserveIncoming(bytes, token = crypto.randomUUID(), { existingBytes = 0 } = {}) { return this.serialized(async () => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(existingBytes) || existingBytes < 0 || existingBytes > bytes) throw new Error('Invalid incoming storage reservation');
    if (this.reservations.has(token)) {
      const remaining = bytes - existingBytes, previous = this.reservations.get(token);
      if (remaining > previous) await this.checkSpace(remaining - previous);
      this.reservations.set(token, remaining); return token;
    }
    await this.checkSpace(bytes - existingBytes); this.reservations.set(token, bytes - existingBytes); return token;
  }); }
  async ensureCapacity(bytes) { await this.checkSpace(bytes); }
  releaseIncoming(token) { this.reservations.delete(token); }
  serialized(action) { const result = this.queue.then(action); this.queue = result.catch(() => {}); return result; }
  pin(id, owner = 'clipboard') { return this.serialized(async () => { await this.get(id); const before = new Map(this.pins); this.pins.set(owner, id); try { await this.persist(); } catch (error) { this.pins = before; throw error; } await this.cleanup(); }); }
  unpin(owner = 'clipboard') { return this.serialized(async () => { const before = new Map(this.pins); this.pins.delete(owner); try { await this.persist(); } catch (error) { this.pins = before; throw error; } await this.cleanup(); }); }
  async open(id) {
    const entry = await this.get(id); this.readers.set(id, (this.readers.get(id) || 0) + 1);
    // Crash recovery conservatively retains an opened payload until explicitly released.
    const owner = `open:${crypto.randomUUID()}`; await this.pin(id, owner);
    let released = false;
    return { entry, release: async () => { if (released) return; released = true; this.readers.set(id, this.readers.get(id) - 1); await this.unpin(owner); } };
  }
  releaseOpen(id) { return this.serialized(async () => {
    await this.get(id);
    if (this.readers.get(id)) throw new Error('History entry still has active readers; close them before releasing');
    const before = new Map(this.pins);
    for (const [owner, pinnedId] of this.pins) if (pinnedId === id && owner.startsWith('open:')) this.pins.delete(owner);
    try { await this.persist(); } catch (error) { this.pins = before; throw error; } await this.cleanup();
  }); }
  async cleanup() {
    const removable = this.retired.filter(entry => ![...this.pins.values()].includes(entry.id) && !this.readers.get(entry.id));
    if (!removable.length) return;
    const previous = this.retired;
    this.retired = this.retired.filter(entry => !removable.includes(entry));
    try { await this.persist(); } catch (error) { this.retired = previous; throw error; }
    const deferred = [];
    for (const entry of removable) {
      try { await fs.rm(path.join(this.dir, entry.id), { recursive: true, force: true }); }
      catch (error) { deferred.push(entry); }
    }
    if (deferred.length) { this.retired.push(...deferred); await this.persist(); }
  }
  commit(item, metadata = {}) {
    return this.serialized(() => this.commitOnce(item, metadata));
  }
  async commitOnce(item, { sender = null, batchId = null, sourceId = null } = {}) {
    if (!['text', 'image', 'files'].includes(item.kind)) throw new Error('Unsupported history entry type');
    const sourceKey = sourceId ? JSON.stringify([sender?.id || '', sourceId]) : null;
    if (sourceKey && this.sources[sourceKey]) {
      const existing = [...this.entries, ...this.retired].find(entry => entry.id === this.sources[sourceKey]);
      return existing ? { ...structuredClone(existing), deduplicated: true } : { id: this.sources[sourceKey], deduplicated: true };
    }
    if (batchId && [...this.entries, ...this.retired].some(entry => entry.batchId === batchId && entry.sender?.id === sender?.id)) return { ...structuredClone([...this.entries, ...this.retired].find(entry => entry.batchId === batchId && entry.sender?.id === sender?.id)), deduplicated: true };
    const inputs = item.kind === 'text' ? [{ bytes: Buffer.from(item.text), name: 'clipboard.txt', mime: 'text/plain' }]
      : item.kind === 'image' ? [{ bytes: item.bytes, path: item.path, name: item.name || 'clipboard.png', mime: item.mime || 'image/png' }]
      : item.files.map(file => typeof file === 'string' ? { path: file, name: path.basename(file), mime: 'application/octet-stream' } : file);
    if (!inputs.length || inputs.length > 64) throw new Error('History requires 1–64 payloads');
    let total = 0;
    for (const input of inputs) { if (input.bytes) input.size = input.bytes.length; else { const stat = await fs.stat(input.path); if (!stat.isFile()) throw new Error('History payload must be a regular file'); input.size = stat.size; } total += input.size; }
    await this.cleanup();
    const id = crypto.randomUUID(), staging = path.join(this.dir, `.stage-${id}`), target = path.join(this.dir, id);
    await fs.mkdir(staging, { mode: 0o700 });
    const entry = { id, kind: item.kind, mime: item.mime || inputs[0].mime, timestamp: new Date().toISOString(), sender, batchId, sourceId, size: total, payloads: [] };
    const projectedPayloads = inputs.map((input, number) => { const name = safeName(input.name || path.basename(input.path)); return { name, mime: input.mime || 'application/octet-stream', size: input.size, path: path.join(target, String(number), name) }; });
    const projectedEntries = [...this.entries, { ...entry, payloads: projectedPayloads }];
    const projectedRetired = [...this.retired];
    while (projectedEntries.length > 5) projectedRetired.push(projectedEntries.shift());
    const projectedSources = { ...this.sources, ...(sourceKey ? { [sourceKey]: id } : {}) };
    // Account for the atomic replacement index existing alongside the previous index,
    // with headroom for subsequent pin metadata as clipboard publication completes.
    const metadataBytes = Buffer.byteLength(JSON.stringify({ version: 1, entries: projectedEntries, retired: projectedRetired, sources: projectedSources, pins: Object.fromEntries(this.pins) })) + 1024;
    try { await this.checkSpace(total + metadataBytes); } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
    try {
      for (const [number, input] of inputs.entries()) {
        const name = safeName(input.name || path.basename(input.path)), localName = path.join(String(number), name);
        await fs.mkdir(path.join(staging, String(number)), { mode: 0o700 });
        const file = path.join(staging, localName);
        if (input.bytes) await fs.writeFile(file, input.bytes, { mode: 0o600 }); else await fs.copyFile(input.path, file);
        if ((await fs.stat(file)).size !== input.size) throw new Error('History payload size changed while copying');
        await syncFile(file); await syncDirectory(path.dirname(file));
        entry.payloads.push({ name, mime: input.mime || 'application/octet-stream', size: input.size, path: path.join(target, localName) });
      }
      await syncDirectory(staging);
      await fs.rename(staging, target);
      await syncDirectory(this.dir);
      const previous = this.entries, retired = this.retired;
      this.entries = [...this.entries, entry]; this.retired = [...this.retired];
      while (this.entries.length > 5) this.retired.push(this.entries.shift());
      if (sourceKey) this.sources[sourceKey] = id;
      try { await this.persist(); } catch (error) { this.entries = previous; this.retired = retired; if (sourceKey) delete this.sources[sourceKey]; throw error; }
      await this.cleanup(); return structuredClone(entry);
    } catch (error) { await fs.rm(staging, { recursive: true, force: true }); if (!this.entries.some(current => current.id === id)) await fs.rm(target, { recursive: true, force: true }); throw error; }
  }
  async save(id, destination) {
    const resolved = path.resolve(destination);
    if (resolved === this.dir || resolved.startsWith(this.dir + path.sep)) throw new Error('Permanent exports must be outside history storage');
    const handle = await this.open(id);
    try {
      await fs.mkdir(resolved, { recursive: true }); const saved = [];
      for (const payload of handle.entry.payloads) {
        const extension = path.extname(payload.name), base = payload.name.slice(0, payload.name.length - extension.length);
        for (let attempt = 0; ; attempt++) {
          const name = attempt ? `${base} (${attempt})${extension}` : payload.name;
          const target = path.join(resolved, name);
          try { await fs.copyFile(payload.path, target, 1); saved.push(target); break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
      }
      return saved;
    }
    finally { await handle.release(); }
  }
}
