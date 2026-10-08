// Run on a disposable clipboard, or use the Windows wrapper which restores it.
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readClipboard, writeClipboard } from '../src/clipboard.js';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startService } from '../src/service.js';
import { saveState } from '../src/state.js';
import { fileHash } from '../src/transfers.js';
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
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'uc-native-files-'));
try {
  const files=['รายงาน.pdf','sample.zip'].map(name=>path.join(directory,name));
  for(const file of files)fs.writeFileSync(file,Buffer.from([0,1,2,255]));
  const native=await import('@crosscopy/clipboard');await native.setFiles(files);
  const selection=await readClipboard();assert.equal(selection.kind,'files');assert.deepEqual(selection.files,files);
  console.log('Native copied file list (Unicode / multiple): PASS');
  const aDir=path.join(directory,'host'),bDir=path.join(directory,'peer');let host,peer;
  try {
    saveState({deviceId:'native-files-host',name:'Host',role:'hub',pin:'123456',port:0,receiveDir:path.join(aDir,'received')},aDir);
    host=await startService({dir:aDir,log:()=>{},discoveryPort:false});
    saveState({deviceId:'native-files-peer',name:'Peer',role:'client',pin:'123456',hub:{host:'127.0.0.1',port:host.hub.port},receiveDir:path.join(bDir,'received')},bDir);
    peer=await startService({dir:bDir,log:()=>{},clipboard:{read:async()=>null,write:async()=>{throw new Error('Generic files must not replace clipboard');}}});
    const results=await host.command('send-clipboard',[peer.endpoint.id]);
    for(const sent of results)assert.equal(await fileHash(sent.results[0].path),await fileHash(sent.file));
    assert.equal(results.length,2);console.log('Native clipboard file selection → encrypted TCP → saved binary files: PASS');
  }finally{await peer?.close();await host?.close();}
} finally {fs.rmSync(directory,{recursive:true,force:true});}
