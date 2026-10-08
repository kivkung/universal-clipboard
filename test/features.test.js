import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hub } from '../src/hub.js';
import { Client } from '../src/client.js';
import { TransferStore, fileHash } from '../src/transfers.js';
import { hashText } from '../src/protocol.js';
import { newInvite, inviteUri, parseInvite } from '../src/pairing.js';
import { startService } from '../src/service.js';
import { saveState } from '../src/state.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
test('invitation validates version, duplicates, destination and expiry without including PIN', () => {
  const invite = newInvite('test-host-endpoint', '192.168.1.10', 3000);
  assert.deepEqual(parseInvite(inviteUri(invite)), invite);
  assert.ok(!inviteUri(invite).includes('pin'));
  assert.throws(() => parseInvite(inviteUri({ ...invite, expires: Date.now() - 1 })), /expired/);
  assert.throws(() => parseInvite(inviteUri(invite) + '&secret=bad'), /invitation/);
  assert.throws(() => parseInvite(inviteUri({ ...invite, host: '127.0.0.1' })), /Invalid/);
  assert.throws(() => parseInvite(inviteUri({ ...invite, secret: '123456' })), /Invalid/);
});

test('one-use pairing persists individual credential, survives reconnect/restart, rejects reuse and revocation', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.resolve('.test-pairing-'));
  const state = { deviceId: 'test-host-endpoint', name: 'Host', pin: '123456' };
  let hub = new Hub({ state, port: 0, bind: '127.0.0.1', discoveryPort: false });
  await hub.start(); const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); await hub.close(); await sleep(100); fs.rmSync(root, { recursive: true, force: true }); });
  const invite = hub.createInvitation('192.168.1.10');
  const make = (id, pairing, pin) => { const dir=path.join(root,id);const c=new Client({host:'127.0.0.1',port:hub.port,id,name:id,dir,receiveDir:path.join(dir,'received'),pairing,pin});clients.push(c);return c; };
  const pairing = { id: invite.id, secret: invite.secret, hubId: state.deviceId };
  const first=make('paired-device-one', { ...pairing }); await first.connect();
  assert.equal(first.pairing.id, undefined); assert.ok(state.peers[first.id].authKey);
  const reused=make('paired-device-two', { ...pairing }); await assert.rejects(reused.connect(), /INVITE_EXPIRED_OR_USED/);
  await first.close(); await sleep(100);
  const retry=make(first.id, { ...pairing }); await retry.connect(); // auth.ok loss / credential stored by Hub
  await retry.close(); await sleep(100);
  const stolenId=make(first.id, undefined, '123456'); await assert.rejects(stolenId.connect(), /BAD_PIN/);
  const expired=hub.createInvitation('192.168.1.10');expired.expires=Date.now()-1;
  const denied=make('expired-device-one', { id:expired.id,secret:expired.secret,hubId:state.deviceId });await assert.rejects(denied.connect(), /INVITE_EXPIRED_OR_USED/);
  const oldPort=hub.port; await hub.close(); hub=new Hub({state,port:oldPort,bind:'127.0.0.1',discoveryPort:false});await hub.start();
  const restored=make(first.id, { secret:invite.secret,hubId:state.deviceId });await restored.connect();
  hub.revoke(first.id); await restored.close();await sleep(100);
  await assert.rejects(make(first.id,{secret:invite.secret,hubId:state.deviceId}).connect(), /DEVICE_REVOKED/);
});

test('active old partial resumes after restart; expired metadata and partial are cleaned as a pair', async t => {
  const root=fs.mkdtempSync(path.resolve('.test-cleanup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={dir:root,receiveDir:path.join(root,'received')};let store=new TransferStore(options);
  const bytes=Buffer.alloc(131072,7),id='a'.repeat(64),sender='sender-device';
  const offer={type:'file.offer',transferId:id,name:'resume.bin',size:bytes.length,hash:hashText(bytes)};
  await store.handle(offer,sender);const files=store.paths(id,sender),old=new Date(Date.now()-8*86400000);
  fs.utimesSync(files.meta,old,old);
  await store.handle({type:'file.chunk',transferId:id,offset:0,sequence:0,data:bytes.subarray(0,65536).toString('base64')},sender);
  // Also verifies repair of legacy metadata that was not refreshed after a recent append.
  fs.utimesSync(files.meta,old,old);store=new TransferStore(options);assert.equal((await store.handle(offer,sender)).offset,65536);
  fs.utimesSync(files.meta,old,old);fs.utimesSync(files.part,old,old);store=new TransferStore(options);
  assert.ok(!fs.existsSync(files.meta)&&!fs.existsSync(files.part));assert.equal((await store.handle(offer,sender)).offset,0);
});

test('copied generic files require explicit send, preserve binary bytes, reject folders, leave clipboard unchanged', { timeout: 10000 }, async t => {
  const root=fs.mkdtempSync(path.resolve('.test-files-')),aDir=path.join(root,'a'),bDir=path.join(root,'b');
  const file=path.join(root,'report ไทย.bin'),empty=path.join(root,'empty.dat');fs.writeFileSync(file,crypto.randomBytes(150000));fs.writeFileSync(empty,'');
  let clip={kind:'files',files:[file,empty],hash:hashText('selection')};let bWrites=0;
  const aClip={read:async()=>clip,write:async value=>{clip=value;}},bClip={read:async()=>null,write:async()=>{bWrites++;}};
  saveState({deviceId:'files-host-device',name:'Host',role:'hub',pin:'123456',port:0,receiveDir:path.join(aDir,'received')},aDir);
  const a=await startService({dir:aDir,clipboard:aClip,discoveryPort:false,log:()=>{}});let b;
  t.after(async()=>{await b?.close();await a.close();await sleep(100);fs.rmSync(root,{recursive:true,force:true});});
  saveState({deviceId:'files-peer-device',name:'Peer',role:'client',pin:'123456',hub:{host:'127.0.0.1',port:a.hub.port},receiveDir:path.join(bDir,'received')},bDir);
  b=await startService({dir:bDir,clipboard:bClip,log:()=>{}});
  clip={...clip,hash:hashText('new file selection')};await sleep(650);
  assert.deepEqual(fs.readdirSync(b.endpoint.store.receiveDir),[]);
  const results=await a.command('send-clipboard',[b.endpoint.id]);
  assert.equal(results.length,2);
  for(const sent of results) assert.equal(await fileHash(sent.results[0].path),await fileHash(sent.file));
  assert.equal(bWrites,0);assert.equal(clip.kind,'files');
  clip={kind:'files',files:[root],hash:'folder'};await assert.rejects(a.command('send-clipboard',[b.endpoint.id]),/Folders/);
  clip={kind:'text',text:'hello'};await assert.rejects(a.command('send-clipboard',[]),/Copy files/);
});
