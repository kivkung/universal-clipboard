import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TransferStore } from '../src/transfers.js';
import { HistoryStore } from '../src/history.js';
import { hashText } from '../src/protocol.js';
import { Hub } from '../src/hub.js';
import { Client } from '../src/client.js';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.resolve('.test-batch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let history = await new HistoryStore({ dir, partialDir: path.join(dir, 'incoming'), reserveBytes: 0 }).init();
  let publications = 0;
  const options = () => ({ dir, receiveDir: path.join(dir, 'received'), storage: history,
    onBatch: async batch => { const entry = await history.commit({ kind: 'files', files: batch.members.map(m => ({ path: m.output, name: m.name, mime: m.mime })) }, { sender: { id: batch.sender }, sourceId: batch.batchId }); publications++; return { historyId: entry.id }; } });
  let store = new TransferStore(options()); await store.ready;
  return { dir, get store() { return store; }, get history() { return history; }, get publications() { return publications; }, async restart() { history = await new HistoryStore({ dir, partialDir: path.join(dir, 'incoming'), reserveBytes: 0 }).init(); store = new TransferStore(options()); await store.ready; } };
}
const member = (label, bytes) => ({ transferId: hashText(label), name: label + '.bin', size: bytes.length, hash: hashText(bytes), kind: 'file', mime: 'application/octet-stream' });
async function deliver(f, item, bytes, batchId, index, sender = 'sender-device') {
  const offer = { type: 'file.offer', ...item, batchId, index };
  const { offset } = await f.store.handle(offer, sender);
  for (let pos = offset; pos < bytes.length; pos += 65536) await f.store.handle({ type: 'file.chunk', transferId: item.transferId, offset: pos, sequence: pos / 65536, data: bytes.subarray(pos, pos + 65536).toString('base64') }, sender);
  return f.store.handle({ type: 'file.finish', transferId: item.transferId }, sender);
}

test('batch restart, binary and empty member, atomic history, finish replay and permanent export preservation', async t => {
  const f = await fixture(t), sender = 'sender-device', batchId = hashText('batch');
  const bytes = Buffer.alloc(150000, 19), first = member('binary', bytes), empty = member('empty', Buffer.alloc(0));
  const offer = { type: 'file.batch.offer', batchId, count: 2, files: [first, empty] };
  await f.store.handle(offer, sender);
  const received = await deliver(f, first, bytes, batchId, 0);
  assert.equal((await f.history.list()).length, 0);
  await assert.rejects(f.store.handle({ type: 'file.batch.finish', batchId }, sender), /incomplete/);
  await f.restart(); await f.store.handle(offer, sender);
  await deliver(f, empty, Buffer.alloc(0), batchId, 1);
  const done = await f.store.handle({ type: 'file.batch.finish', batchId }, sender);
  const entry = (await f.history.list())[0];
  assert.equal(entry.id, done.historyId); assert.equal(entry.payloads.length, 2); assert.equal(f.publications, 1);
  await f.store.handle({ type: 'file.offer', ...first, batchId, index: 0 }, sender);
  assert.equal((await f.history.usage()).reservedBytes, 0, 'Completed member replay cannot reinstate a batch reservation');
  assert.deepEqual(fs.readFileSync((await f.history.item(entry.id)).files[0]), bytes);
  await f.restart(); assert.deepEqual(await f.store.handle({ type: 'file.batch.finish', batchId }, sender), done);
  assert.equal(f.publications, 1);
  for (let i = 0; i < 6; i++) await f.history.commit({ kind: 'text', text: String(i) }, { sourceId: 'text-' + i });
  assert.equal((await f.history.list()).length, 5); assert.ok(fs.existsSync(received.path));
  assert.deepEqual(await f.store.handle({ type: 'file.batch.cancel', batchId }, sender), { cancelled: false, complete: true });
});

test('failed hashes and cancelled batches do not add history or delete completed permanent members', async t => {
  const f = await fixture(t), sender = 'sender-device', batchId = hashText('cancel');
  await f.history.commit({ kind: 'text', text: 'keep' });
  const bytes = Buffer.from('binary'), good = member('good', bytes), bad = { ...member('bad', bytes), hash: hashText('different') };
  await f.store.handle({ type: 'file.batch.offer', batchId, count: 2, files: [good, bad] }, sender);
  const received = await deliver(f, good, bytes, batchId, 0);
  await assert.rejects(deliver(f, bad, bytes, batchId, 1), /SHA-256/);
  assert.equal((await f.history.list()).length, 1);
  await f.store.handle({ type: 'file.batch.cancel', batchId }, sender);
  assert.ok(fs.existsSync(received.path)); assert.equal((await f.history.usage()).reservedBytes, 0);
  await assert.rejects(f.store.handle({ type: 'file.batch.finish', batchId }, sender), /cancelled/);
});

test('batch manifests reserve storage before acceptance and are isolated by authenticated sender', async t => {
  const f = await fixture(t), batchId = hashText('shared'), bytes = Buffer.alloc(10000), item = member('reserved', bytes);
  f.history.budgetBytes = 1000;
  const offer = { type: 'file.batch.offer', batchId, count: 1, files: [item] };
  await assert.rejects(f.store.handle(offer, 'one'), /budget/);
  assert.equal((await f.history.list()).length, 0);
  f.history.budgetBytes = 1000000;
  await f.store.handle(offer, 'one');
  await assert.rejects(f.store.handle({ type: 'file.batch.finish', batchId }, 'two'), /Unknown/);
  await f.store.handle(offer, 'two');
  assert.equal((await f.history.usage()).reservedBytes, 40000);
  await f.store.handle({ type: 'file.batch.cancel', batchId }, 'one');
  assert.equal((await f.history.usage()).reservedBytes, 20000);
});

test('encrypted batch lost acknowledgement and text replay preserve one receipt and newer clipboard', { timeout: 10000 }, async t => {
  const f = await fixture(t), clients = [];
  const hub = new Hub({ state: { deviceId: 'batch-host-device', name: 'Host', pin: '123456' }, port: 0, bind: '127.0.0.1', discoveryPort: false });
  await hub.start();
  t.after(async () => { for (const c of clients) await c.close(); await hub.close(); await new Promise(r => setTimeout(r, 100)); });
  let clipboard, writes = 0;
  const make = (id, history) => { const dir = path.join(f.dir, id); const c = new Client({ host: '127.0.0.1', port: hub.port, pin: '123456', id, name: id, dir, receiveDir: path.join(dir, 'received'), history, requestTimeout: 200, retryMs: 30, clipboard: { write: async item => { clipboard = item; writes++; }, read: async () => ({ ...clipboard, hash: clipboard?.kind === 'text' ? hashText(clipboard.text) : 'files-hash' }) } }); clients.push(c); return c; };
  const a = make('batch-sender-device'), b = make('batch-receiver-device', f.history);
  await a.connect(); await b.connect();
  const file = path.join(f.dir, 'network.bin'); fs.writeFileSync(file, Buffer.alloc(100000, 7));
  const send = b.send.bind(b); let dropped = false;
  b.send = body => { if (!dropped && body.type === 'reply' && body.result?.historyId && body.result.complete) { dropped = true; return Promise.resolve(); } return send(body); };
  const [result] = await a.sendFiles([file], b.id);
  assert.equal(result.error, undefined, JSON.stringify(result)); assert.ok(dropped); assert.equal(writes, 1);
  assert.equal((await f.history.list()).length, 1); assert.equal(a.jobs().length, 0);
  const entryId = hashText('stable-text-receipt'), message = { type: 'clipboard.text', to: b.id, text: 'old', hash: hashText('old'), entryId };
  await a.request(message); await a.push('new', b.id); await a.request(message);
  assert.equal(clipboard.text, 'new'); assert.equal((await f.history.list()).length, 3);
  b.paused = true; await a.push('paused', b.id); assert.equal(clipboard.text, 'new');
  const latest = (await f.history.list()).at(-1); await b.publishHistory(latest.id, true); assert.equal(clipboard.text, 'paused');
});
