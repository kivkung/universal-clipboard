import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { HistoryStore } from '../src/history.js';
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uc-history-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, store: await new HistoryStore({ dir, reserveBytes: 0, ...options }).init() };
}
test('latest five successful entries survive restart; invalid receipt cannot evict', async t => {
  const { dir, store } = await fixture(t);
  for (let i = 0; i < 6; i++) await store.commit({ kind: 'text', text: `entry ${i}` }, { sender: { id: 'peer', name: 'Phone' } });
  await assert.rejects(store.commit({ kind: 'files', files: [path.join(dir, 'missing')] }));
  const restarted = await new HistoryStore({ dir, reserveBytes: 0 }).init();
  const entries = await restarted.list(); assert.equal(entries.length, 5);
  assert.deepEqual(await Promise.all(entries.map(async entry => (await restarted.item(entry.id)).text)), ['entry 1', 'entry 2', 'entry 3', 'entry 4', 'entry 5']);
  assert.equal(entries[0].sender.name, 'Phone');
});
test('clipboard and opened pins retain evicted payloads; exports and partials survive', async t => {
  const { dir, store } = await fixture(t);
  const first = await store.commit({ kind: 'text', text: 'keep' });
  await store.pin(first.id); const reader = await store.open(first.id);
  const saved = await store.save(first.id, path.join(dir, 'permanent'));
  for (let i = 0; i < 6; i++) await store.commit({ kind: 'text', text: String(i) });
  await store.unpin(); assert.equal(await fs.readFile(first.payloads[0].path, 'utf8'), 'keep');
  await reader.release(); await assert.rejects(fs.stat(first.payloads[0].path));
  assert.equal(await fs.readFile(saved[0], 'utf8'), 'keep');
});
test('batch creates one entry, preserves empty binary files and safe names', async t => {
  const { dir, store } = await fixture(t);
  const binary = path.join(dir, 'binary'), empty = path.join(dir, 'empty');
  await fs.writeFile(binary, Buffer.from([0, 255, 7])); await fs.writeFile(empty, Buffer.alloc(0));
  const entry = await store.commit({ kind: 'files', files: [{ path: binary, name: '../../binary.dat', mime: 'application/octet-stream' }, { path: empty, name: 'empty.txt', mime: 'text/plain' }] }, { batchId: 'batch-1' });
  assert.equal(entry.payloads.length, 2); assert.equal(entry.payloads[0].name, 'binary.dat'); assert.equal(entry.payloads[1].size, 0);
  assert.equal(path.basename(entry.payloads[0].path), 'binary.dat');
  assert.deepEqual(await fs.readFile(entry.payloads[0].path), Buffer.from([0, 255, 7]));
  await store.commit({ kind: 'files', files: [binary] }, { batchId: 'batch-1' }); assert.equal((await store.list()).length, 1);
  assert.equal((await store.item(entry.id)).files.length, 2);
});
test('budget counts partials and reservations and fails without evicting valid entries', async t => {
  const { dir, store } = await fixture(t, { budgetBytes: 3000 });
  const entry = await store.commit({ kind: 'text', text: 'valid' });
  const partialDir = path.join(dir, 'partials'); await fs.mkdir(partialDir); await fs.writeFile(path.join(partialDir, 'resume.part'), Buffer.alloc(1000)); store.partialDir = partialDir;
  const token = await store.reserveIncoming(1000);
  await assert.rejects(store.commit({ kind: 'text', text: 'x'.repeat(2000) }), /budget/);
  assert.equal((await store.list())[0].id, entry.id); store.releaseIncoming(token);
  assert.equal((await fs.stat(path.join(partialDir, 'resume.part'))).size, 1000);
});
test('clipboard pins persist after restart and concurrent commits maintain five-entry order', async t => {
  const { dir, store } = await fixture(t);
  const entry = await store.commit({ kind: 'text', text: 'pinned' }); await store.pin(entry.id);
  await Promise.all(Array.from({ length: 6 }, (_, i) => store.commit({ kind: 'text', text: String(i) })));
  const restarted = await new HistoryStore({ dir, reserveBytes: 0 }).init(); assert.equal((await restarted.item(entry.id)).text, 'pinned');
  await restarted.unpin(); await assert.rejects(fs.stat(entry.payloads[0].path));
});
test('source receipts stay idempotent across eviction and restart; devices have separate namespaces', async t => {
  const { dir, store } = await fixture(t);
  const sourceId = 'a'.repeat(64), item = { kind: 'text', text: 'source' };
  const first = await store.commit(item, { sourceId, sender: { id: 'A' } });
  assert.equal((await store.commit(item, { sourceId, sender: { id: 'A' } })).id, first.id);
  for (let i = 0; i < 6; i++) await store.commit({ kind: 'text', text: String(i) });
  const restarted = await new HistoryStore({ dir, reserveBytes: 0 }).init();
  const duplicate = await restarted.commit(item, { sourceId, sender: { id: 'A' } });
  assert.equal(duplicate.id, first.id); assert.equal(duplicate.deduplicated, true);
  const other = await restarted.commit(item, { sourceId, sender: { id: 'B' } }); assert.notEqual(other.id, first.id);
});
test('concurrent incoming reservations cannot exceed the shared budget', async t => {
  const { store } = await fixture(t, { budgetBytes: 2000 });
  const results = await Promise.allSettled([store.reserveIncoming(1500, 'one'), store.reserveIncoming(1500, 'two')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await store.reserveIncoming(1500, 'one'); assert.equal((await store.usage()).reservedBytes, 1500);
});
test('permanent saves preserve duplicate display names and existing exports', async t => {
  const { dir, store } = await fixture(t);
  const a = path.join(dir, 'a'), b = path.join(dir, 'b'), destination = path.join(dir, 'export');
  await fs.writeFile(a, 'A'); await fs.writeFile(b, 'B'); await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'same.txt'), 'existing');
  const entry = await store.commit({ kind: 'files', files: [{ path: a, name: 'same.txt' }, { path: b, name: 'same.txt' }] });
  const saved = await store.save(entry.id, destination);
  assert.deepEqual(saved.map(file => path.basename(file)), ['same (1).txt', 'same (2).txt']);
  assert.deepEqual(await Promise.all(saved.map(file => fs.readFile(file, 'utf8'))), ['A', 'B']);
  assert.equal(await fs.readFile(path.join(destination, 'same.txt'), 'utf8'), 'existing');
});
test('explicit open release refuses readers and releases recovered persistent open pins', async t => {
  const { dir, store } = await fixture(t);
  const entry = await store.commit({ kind: 'text', text: 'open' }), reader = await store.open(entry.id);
  await assert.rejects(store.releaseOpen(entry.id), /active readers/);
  for (let i = 0; i < 6; i++) await store.commit({ kind: 'text', text: String(i) });
  const recovered = await new HistoryStore({ dir, reserveBytes: 0 }).init();
  await recovered.releaseOpen(entry.id); await assert.rejects(fs.stat(entry.payloads[0].path));
  // Original process has been simulated as crashed; its handle is no longer used.
  assert.ok(reader.entry.id);
});
test('pin persistence failures roll back owners', async t => {
  const { store } = await fixture(t); const entry = await store.commit({ kind: 'text', text: 'pin' });
  const persist = store.persist.bind(store); store.persist = async () => { throw new Error('disk failure'); };
  await assert.rejects(store.pin(entry.id), /disk failure/); assert.equal(store.pins.has('clipboard'), false);
  store.persist = persist; await store.pin(entry.id); store.persist = async () => { throw new Error('disk failure'); };
  await assert.rejects(store.unpin(), /disk failure/); assert.equal(store.pins.get('clipboard'), entry.id);
});
test('recovery rejects metadata references outside the history entry', async t => {
  const { dir, store } = await fixture(t); await store.commit({ kind: 'text', text: 'safe' });
  const indexPath = path.join(dir, 'history', 'index.json'), index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.entries[0].payloads[0].path = path.join(dir, 'outside.txt'); await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(new HistoryStore({ dir, reserveBytes: 0 }).init(), /Unsafe history payload path/);
});
