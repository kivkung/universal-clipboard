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
  await writeClipboard({kind:'files',files});
  const selection=await readClipboard();assert.equal(selection.kind,'files');assert.deepEqual(selection.files,files);
  console.log('Native copied file list (Unicode / multiple): PASS');
  const aDir=path.join(directory,'host'),bDir=path.join(directory,'peer');let host,peer;
  try {
    saveState({deviceId:'native-files-host',name:'Host',role:'hub',pin:'123456',port:0,autoFiles:false,receiveDir:path.join(aDir,'received')},aDir);
    host=await startService({dir:aDir,log:()=>{},discoveryPort:false});
    saveState({deviceId:'native-files-peer',name:'Peer',role:'client',pin:'123456',hub:{host:'127.0.0.1',port:host.hub.port},receiveDir:path.join(bDir,'received')},bDir);
    const published=[];let peerSelection=null;
    peer=await startService({dir:bDir,log:()=>{},clipboard:{read:async()=>peerSelection,write:async item=>{published.push(item);await writeClipboard(item);}}});
    const results=await host.command('send-clipboard',[peer.endpoint.id]);
    assert.equal(results.length,1);
    assert.equal(results[0].error,undefined,JSON.stringify(results));
    for(const [i,sent] of results[0].files.entries())assert.equal(await fileHash(sent.path),await fileHash(files[i]));
    assert.equal(published.filter(item=>item.kind==='files').length,1,'Received file batch publishes once');
    const received=await readClipboard();assert.equal(received.kind,'files');assert.equal(received.files.length,2);
    for(let i=0;i<2;i++)assert.equal(await fileHash(received.files[i]),await fileHash(files[i]));
    console.log('Native file-list clipboard → encrypted TCP → received file-list clipboard: PASS');
    // Capture a real Windows file selection for the source workstation. Keep its
    // clipboard separate from the receiving Host, since this test runs on one PC.
    await writeClipboard({kind:'files',files});peerSelection=await readClipboard();
    const deadline=Date.now()+5000;
    while((await host.command('history',[])).length!==1){if(Date.now()>deadline)throw Error('Automatic file copy did not reach Host');await new Promise(r=>setTimeout(r,50));}
    const automatic=await readClipboard();assert.equal(automatic.kind,'files');
    for(let i=0;i<2;i++)assert.equal(await fileHash(automatic.files[i]),await fileHash(files[i]));
    await new Promise(r=>setTimeout(r,700));
    assert.equal((await host.command('history',[])).length,1);
    assert.equal(peer.endpoint.jobs().length,0);
    console.log('Native copied file selection → automatic workstation watcher → Host clipboard (no repeat): PASS');
  }finally{await peer?.close();await host?.close();}
} finally {fs.rmSync(directory,{recursive:true,force:true});}
