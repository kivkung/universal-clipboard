import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hub } from '../src/hub.js';
import { Client } from '../src/client.js';
import { TransferStore, fileHash } from '../src/transfers.js';
import { encodeJsonFrame, parseFrames, hashText } from '../src/protocol.js';
import { deriveKey, encryptObject, decryptObject } from '../src/crypto.js';
import { CHUNK_SIZE, MAX_FRAME_SIZE } from '../src/config.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('Condition timeout'); await sleep(20); }
}
function memoryClipboard() {
  let item = null, writes = 0;
  return {
    read: async () => item,
    write: async value => { writes++; const bytes = value.path ? fs.readFileSync(value.path) : value.bytes; item = value.kind === 'image' ? { kind: 'image', bytes, hash: hashText(bytes) } : { ...value, hash: hashText(value.text) }; },
    get item() { return item; }, get writes() { return writes; }
  };
}
test('framing handles fragmentation, coalescing and hostile headers', () => {
  const one = encodeJsonFrame({ text: 'สวัสดี' }), two = encodeJsonFrame({ number: 2 });
  let buffer = Buffer.alloc(0), messages = [];
  for (const byte of Buffer.concat([one, two])) {
    const parsed = parseFrames(Buffer.concat([buffer, Buffer.from([byte])]));
    messages.push(...parsed.frames.map(f => JSON.parse(f.payload))); buffer = parsed.buffer;
  }
  assert.deepEqual(messages, [{ text: 'สวัสดี' }, { number: 2 }]);
  const header = Buffer.alloc(5); header.writeUInt32BE(MAX_FRAME_SIZE + 1); header[4] = 1;
  assert.throws(() => parseFrames(header), /Invalid/);
  assert.throws(() => parseFrames(Buffer.from([0, 0, 0, 1, 9])), /Invalid/);
});
test('AES-GCM rejects modifications and wrong keys', () => {
  const key = deriveKey('123456', Buffer.alloc(16).toString('base64url'));
  const envelope = encryptObject({ text: 'private' }, key);
  assert.deepEqual(decryptObject(envelope, key), { text: 'private' });
  const data = Buffer.from(envelope.data, 'base64url'); data[0] ^= 1;
  assert.throws(() => decryptObject({ ...envelope, data: data.toString('base64url') }, key));
  assert.throws(() => decryptObject(envelope, crypto.randomBytes(32)));
});
test('real TCP integration', { timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.resolve('.test-work-'));
  const clients = [];
  const hub = new Hub({ state: { deviceId: 'hub-device', name: 'Hub', pin: '123456' }, port: 0, bind: '127.0.0.1', discoveryPort: false });
  await hub.start();
  t.after(async () => {
    for (const client of clients) await client.close();
    await hub.close(); await sleep(100);
    assert.ok(root.startsWith(path.resolve('.test-work-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function create(id, pin = '123456', existingDir) {
    const dir = existingDir || path.join(root, id);
    const clipboard = memoryClipboard();
    const client = new Client({ host: '127.0.0.1', port: hub.port, pin, id, name: id, dir, receiveDir: path.join(dir, 'received'), clipboard, retryMs: 30, requestTimeout: 1000 });
    clients.push(client); await client.connect(); return client;
  }
  const a = await create('device-aaaa'), b = await create('device-bbbb'), c = await create('device-cccc');
  await t.test('wrong PIN and duplicate session rejected', async () => {
    await assert.rejects(create('device-wrong', '000000'), /BAD_PIN/);
    await assert.rejects(create('device-aaaa'), /DEVICE_ALREADY_CONNECTED/);
    assert.equal((await a.devices()).length, 3);
  });
  await t.test('text routes to everyone, targeted recipient, deduplicates and pauses', async () => {
    await a.push('ข้อความทดสอบ 🌍');
    assert.equal(b.clipboard.item.text, 'ข้อความทดสอบ 🌍');
    assert.equal(c.clipboard.item.text, 'ข้อความทดสอบ 🌍');
    await a.push('ข้อความทดสอบ 🌍'); assert.equal(b.clipboard.writes, 1);
    await b.push('only A', a.id); assert.equal(a.clipboard.item.text, 'only A');
    assert.equal(c.clipboard.item.text, 'ข้อความทดสอบ 🌍');
    b.paused = true; await a.push('paused', b.id); assert.equal(b.clipboard.writes, 1); b.paused = false;
  });
  const source = path.join(root, 'ไฟล์ทดสอบ.bin');
  fs.writeFileSync(source, crypto.randomBytes(CHUNK_SIZE * 10 + 17));
  await t.test('binary file, collision, empty file and image reach receivers', async () => {
    const [result] = await a.sendFile(source, b.id);
    assert.equal(await fileHash(result.path), await fileHash(source));
    const [again] = await a.sendFile(source, b.id);
    assert.notEqual(again.path, result.path); assert.equal(await fileHash(again.path), await fileHash(source));
    const empty = path.join(root, 'empty.txt'); fs.writeFileSync(empty, '');
    const [zero] = await a.sendFile(empty, c.id); assert.equal(fs.statSync(zero.path).size, 0);
    const image = path.join(root, 'image.png'); fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
    await b.sendFile(image, a.id, 'image');
    assert.deepEqual(a.clipboard.item.bytes, fs.readFileSync(image));
  });
  await t.test('receiver disconnect resumes from persisted nonzero offset', async () => {
    let cut = false;
    const interrupt = progress => { if (!cut && progress.bytes >= CHUNK_SIZE * 2) { cut = true; b.socket.destroy(); } };
    a.on('progress', interrupt);
    const [result] = await a.sendFile(source, b.id);
    a.off('progress', interrupt);
    assert.ok(cut); assert.ok(result.resumedBytes >= CHUNK_SIZE * 2);
    assert.equal(await fileHash(result.path), await fileHash(source));
  });
  await t.test('sender disconnect resumes automatically', async () => {
    let cut = false;
    const interrupt = progress => { if (!cut && progress.bytes >= CHUNK_SIZE) { cut = true; a.socket.destroy(); } };
    a.on('progress', interrupt);
    const [result] = await a.sendFile(source, c.id);
    a.off('progress', interrupt);
    assert.ok(result.resumedBytes >= CHUNK_SIZE);
    assert.equal(await fileHash(result.path), await fileHash(source));
  });
  await t.test('lost final acknowledgement does not duplicate the saved file', async () => {
    const originalSend = b.send.bind(b);
    let dropped = false;
    b.send = body => {
      if (!dropped && body.type === 'reply' && body.result?.complete) { dropped = true; return Promise.resolve(); }
      return originalSend(body);
    };
    const before = fs.readdirSync(b.store.receiveDir).length;
    try {
      const [result] = await a.sendFile(source, b.id);
      assert.ok(dropped); assert.ok(result.complete);
      assert.equal(fs.readdirSync(b.store.receiveDir).length, before + 1);
    } finally { b.send = originalSend; }
  });
  await t.test('Hub restart reconnects all endpoints and preserves transfer bytes', async () => {
    let interrupted = false;
    const listener = progress => {
      if (!interrupted && progress.bytes >= CHUNK_SIZE) {
        interrupted = true;
        void hub.close().then(async () => { await sleep(100); await hub.start(); });
      }
    };
    a.on('progress', listener);
    try {
      const [result] = await a.sendFile(source, b.id);
      assert.ok(result.resumedBytes >= CHUNK_SIZE);
      assert.equal(await fileHash(result.path), await fileHash(source));
    } finally { a.off('progress', listener); }
  });
  await t.test('sender and receiver process replacement resumes saved job', async () => {
    const sender = await create('device-dddd'), receiver = await create('device-eeee');
    let cut = false;
    sender.on('progress', () => { if (!cut) { cut = true; void sender.close(); void receiver.close(); } });
    const [interrupted] = await sender.sendFile(source, receiver.id);
    assert.match(interrupted.error, /Disconnected|Stopped|stopped|cancelled/);
    await until(() => !hub.sessions.has(sender.id) && !hub.sessions.has(receiver.id));
    const nextSender = await create(sender.id, '123456', sender.dir);
    const nextReceiver = await create(receiver.id, '123456', receiver.dir);
    const [result] = await nextSender.resume();
    assert.ok(result.resumedBytes >= CHUNK_SIZE);
    assert.equal(await fileHash(result.path), await fileHash(source));
    assert.equal(nextSender.jobs().length, 0);
    await nextSender.close(); await nextReceiver.close();
  });
  await t.test('revocation disconnects and prevents same identity reconnect', async () => {
    hub.revoke(c.id); await until(() => !c.ready);
    await until(() => !!c.fatal);
    assert.match(c.fatal.message, /DEVICE_REVOKED/);
  });
});
test('receiver validates filenames, size, sequence, ownership and final hash', async () => {
  const root = fs.mkdtempSync(path.resolve('.test-store-'));
  try {
    const store = new TransferStore({ dir: root, receiveDir: path.join(root, 'received') });
    const sender = 'device-owner';
    const transferId = crypto.randomBytes(32).toString('hex');
    const offer = { type: 'file.offer', transferId, name: 'test.bin', size: 3, hash: hashText('abc') };
    for (const name of ['../escape', '..\\escape', 'CON', 'x:y', 'bad.']) await assert.rejects(store.handle({ ...offer, name }, sender), /filename/);
    await assert.rejects(store.handle({ ...offer, size: -1 }, sender), /metadata/);
    await store.handle(offer, sender);
    const chunk = { type: 'file.chunk', transferId, sequence: 0, offset: 0, data: Buffer.from('abc').toString('base64') };
    await assert.rejects(store.handle(chunk, 'other-device'), /Unknown/);
    await assert.rejects(store.handle({ ...chunk, sequence: 1 }, sender), /sequence/);
    await assert.rejects(store.handle({ type: 'file.finish', transferId }, sender), /incomplete/);
    await store.handle({ ...chunk, data: Buffer.from('bad').toString('base64') }, sender);
    await assert.rejects(store.handle({ type: 'file.finish', transferId }, sender), /SHA-256/);
    assert.equal(fs.readdirSync(path.join(root, 'received')).length, 0);
    assert.equal(fs.readdirSync(path.join(root, 'incoming')).length, 0);
  } finally { assert.ok(root.startsWith(path.resolve('.test-store-'))); fs.rmSync(root, { recursive: true, force: true }); }
});
