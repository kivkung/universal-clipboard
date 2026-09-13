import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { saveState } from '../src/state.js';
import { startService, control } from '../src/service.js';
import { hashText } from '../src/protocol.js';
import { fileHash } from '../src/transfers.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const memory = () => {
  let item = null;
  return { read: async () => item, write: async value => {
    const bytes = value.path ? fs.readFileSync(value.path) : value.bytes;
    item = value.kind === 'image' ? { kind: 'image', bytes, hash: hashText(bytes) } : { ...value, hash: hashText(value.text) };
  } };
};
async function until(fn) {
  const deadline = Date.now() + 5000;
  while (!await fn()) { if (Date.now() > deadline) throw new Error('Watcher did not sync'); await sleep(30); }
}
test('service controls live Hub, watches image/text, reconnects and rejects untrusted local callers', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.resolve('.test-service-'));
  const aDir = path.join(root, 'a'), bDir = path.join(root, 'b');
  const aClip = memory(), bClip = memory();
  saveState({ deviceId: 'hub-test-aaa', name: 'Hub', role: 'hub', port: 0, pin: '123456', receiveDir: path.join(aDir, 'received') }, aDir);
  const a = await startService({ dir: aDir, clipboard: aClip, log: () => {}, discoveryPort: false });
  let b;
  t.after(async () => { await b?.close(); await a.close(); await sleep(100); assert.ok(root.startsWith(path.resolve('.test-service-'))); fs.rmSync(root, { recursive: true, force: true }); });
  saveState({ deviceId: 'client-test-bbb', name: 'Client', role: 'client', pin: '123456', hub: { host: '127.0.0.1', port: a.hub.port }, receiveDir: path.join(bDir, 'received') }, bDir);
  b = await startService({ dir: bDir, clipboard: bClip, log: () => {} });
  assert.equal((await control('devices', [], aDir)).length, 2);
  await assert.rejects(startService({ dir: aDir, clipboard: aClip }), /already running/);
  await control('push', ['from live hub'], aDir);
  assert.equal((await bClip.read()).text, 'from live hub');
  await aClip.write({ kind: 'text', text: 'automatic watcher' });
  await until(async () => (await bClip.read())?.text === 'automatic watcher');
  const png = Buffer.from('image fixture bytes for transport', 'utf8');
  await bClip.write({ kind: 'image', bytes: png });
  await until(async () => (await aClip.read())?.kind === 'image');
  assert.deepEqual((await aClip.read()).bytes, png);
  await control('pause', [], aDir);
  assert.equal((await control('status', [], aDir)).paused, true);
  await control('unpause', [], aDir);
  const file = path.join(root, 'from-hub.bin'); fs.writeFileSync(file, crypto.randomBytes(100000));
  const [sent] = await control('send-file', [[file], b.endpoint.id], aDir);
  assert.equal(await fileHash(sent.results[0].path), await fileHash(file));
  const { port } = JSON.parse(fs.readFileSync(path.join(aDir, 'service.json')));
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST' }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(status, 403);
});
