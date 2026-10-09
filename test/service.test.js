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
import { PNG } from 'pngjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const memory = () => {
  let item = null;
  return { read: async () => item, write: async value => {
    const bytes = value.path ? fs.readFileSync(value.path) : value.bytes;
    item = value.kind === 'image' ? { kind: 'image', bytes, hash: hashText(bytes) } : { ...value, hash: hashText(value.kind === 'files' ? JSON.stringify(value.files) : value.text) };
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
  const png = PNG.sync.write(new PNG({ width: 2, height: 2 }));
  await bClip.write({ kind: 'image', bytes: png });
  await until(async () => (await aClip.read())?.kind === 'image');
  assert.deepEqual((await aClip.read()).bytes, png);
  await control('pause', [], aDir);
  assert.equal((await control('status', [], aDir)).paused, true);
  await control('unpause', [], aDir);
  const file = path.join(root, 'from-hub.bin'); fs.writeFileSync(file, crypto.randomBytes(100000));
  const [sent] = await control('send-file', [[file], b.endpoint.id], aDir);
  assert.equal(sent.error, undefined, JSON.stringify(sent));
  assert.equal(await fileHash(sent.files[0].path), await fileHash(file));
  const { port } = JSON.parse(fs.readFileSync(path.join(aDir, 'service.json')));
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST' }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(status, 403);
});


test('Host forwards direct files and batches once, excludes source and does not duplicate all-target sends', { timeout: 20000 }, async t => {
  const root = fs.mkdtempSync(path.resolve('.test-relay-'));
  const services = [];
  t.after(async () => { for (const service of services.reverse()) await service.close(); await sleep(100); fs.rmSync(root, { recursive: true, force: true }); });
  const hostDir = path.join(root, 'host');
  saveState({ deviceId: 'relay-host', name: 'Host', role: 'hub', port: 0, pin: '123456', receiveDir: path.join(hostDir, 'received') }, hostDir);
  const host = await startService({ dir: hostDir, clipboard: memory(), log: () => {}, discoveryPort: false }); services.push(host);
  for (const id of ['origin', 'recipient']) {
    const dir = path.join(root, id);
    saveState({ deviceId: 'relay-' + id, name: id, role: 'client', pin: '123456', hub: { host: '127.0.0.1', port: host.hub.port }, receiveDir: path.join(dir, 'received') }, dir);
    services.push(await startService({ dir, clipboard: memory(), log: () => {} }));
  }
  const origin = services[1].endpoint, recipient = services[2].endpoint;
  const one = path.join(root, 'one.bin'), empty = path.join(root, 'empty.txt');
  fs.writeFileSync(one, Buffer.from([0, 255, 42])); fs.writeFileSync(empty, '');
  const [sent] = await origin.sendFile(one, host.endpoint.id);
  assert.equal(sent.error, undefined);
  await until(() => fs.existsSync(path.join(root, 'recipient', 'received', 'one.bin')));
  assert.equal(await fileHash(path.join(root, 'recipient', 'received', 'one.bin')), await fileHash(one));
  assert.deepEqual(fs.readdirSync(path.join(root, 'origin', 'received')), []);
  await until(async () => (await recipient.history.list()).length === 1);
  const before = (await recipient.history.list()).length;
  const [batch] = await origin.sendFiles([one, empty], host.endpoint.id);
  assert.equal(batch.error, undefined);
  await until(async () => (await recipient.history.list()).length === before + 1);
  assert.ok(fs.existsSync(path.join(root, 'recipient', 'received', 'empty.txt')));
  await origin.request({ type: 'file.batch.finish', to: host.endpoint.id, batchId: batch.batchId });
  await sleep(200);
  assert.equal((await recipient.history.list()).length, before + 1);
  await origin.sendFiles([empty], 'all');
  await sleep(300);
  assert.equal((await recipient.history.list()).length, before + 2);
  assert.equal((await origin.history.list()).length, 0);
  // Android/older senders omit the optional flag entirely.
  const image = path.join(root, 'android.png');
  fs.writeFileSync(image, PNG.sync.write(new PNG({ width: 1, height: 1 })));
  const transferId = crypto.randomBytes(32).toString('hex');
  const job = { file: image, to: host.endpoint.id, transferId, name: 'android.png', size: fs.statSync(image).size, hash: await fileHash(image), kind: 'image', mime: 'image/png' };
  await origin.runJob(job);
  await until(async () => (await recipient.history.list()).length === before + 3);
  await origin.request({ type: 'file.finish', to: host.endpoint.id, transferId });
  await sleep(150);
  assert.equal((await recipient.history.list()).length, before + 3);
  assert.equal((await origin.history.list()).length, 0);

});
