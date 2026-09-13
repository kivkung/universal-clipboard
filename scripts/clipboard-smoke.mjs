// Run on a disposable clipboard, or use the Windows wrapper which restores it.
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readClipboard, writeClipboard } from '../src/clipboard.js';
import { PNG } from 'pngjs';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
const row = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]);
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0))]);
await writeClipboard({ kind: 'text', text: 'Universal Clipboard smoke test สวัสดี 🌍' });
assert.equal((await readClipboard()).text, 'Universal Clipboard smoke test สวัสดี 🌍');
await writeClipboard({ kind: 'image', bytes: png });
const image = await readClipboard();
assert.equal(image.kind, 'image');
assert.equal(image.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(image.bytes.readUInt32BE(16), 2);
assert.equal(image.bytes.readUInt32BE(20), 2);
assert.deepEqual(PNG.sync.read(image.bytes).data, PNG.sync.read(png).data, 'RGBA pixels must survive the clipboard');
await writeClipboard(image);
assert.equal((await readClipboard()).hash, image.hash, 'PNG representation must stabilize for echo suppression');
console.log('Native text and PNG clipboard roundtrip: PASS');
