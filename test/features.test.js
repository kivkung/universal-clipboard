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

test('a paired device can scan a fresh invitation without changing identity or bypassing revocation', async t => {
  const root=fs.mkdtempSync(path.resolve('.test-repairing-'));
  const state={deviceId:'repair-host-device',name:'Host',pin:'123456'};
  const hub=new Hub({state,port:0,bind:'127.0.0.1',discoveryPort:false});await hub.start();
  const clients=[];
  t.after(async()=>{for(const client of clients)await client.close();await hub.close();await sleep(100);fs.rmSync(root,{recursive:true,force:true});});
  const make=(id,invite)=>{const dir=path.join(root,id);const client=new Client({host:'127.0.0.1',port:hub.port,id,name:id,dir,receiveDir:path.join(dir,'received'),pairing:{id:invite.id,secret:invite.secret,hubId:state.deviceId}});clients.push(client);return client;};
  const firstInvite=hub.createInvitation('192.168.1.10');
  const first=make('repeat-phone-device',firstInvite);await first.connect();await first.close();await sleep(100);
  const oldKey=state.peers[first.id].authKey;
  const freshInvite=hub.createInvitation('192.168.1.10');
  const repaired=make(first.id,freshInvite);await repaired.connect();
  assert.notEqual(state.peers[first.id].authKey,oldKey);
  assert.equal(hub.invitations.has(freshInvite.id),false);
  await repaired.close();await sleep(100);
  await assert.rejects(make('different-phone-device',freshInvite).connect(),/INVITE_EXPIRED_OR_USED/);
  await assert.rejects(make(first.id,firstInvite).connect(),/BAD_PIN/);
  const retry=make(first.id,freshInvite);await retry.connect();
  hub.revoke(first.id);await retry.close();await sleep(100);
  await assert.rejects(make(first.id,hub.createInvitation('192.168.1.10')).connect(),/DEVICE_REVOKED/);
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

test('copied generic files require explicit send and publish one received batch to history and clipboard', { timeout: 10000 }, async t => {
  const root=fs.mkdtempSync(path.resolve('.test-files-')),aDir=path.join(root,'a'),bDir=path.join(root,'b');
  const file=path.join(root,'report ไทย.bin'),empty=path.join(root,'empty.dat');fs.writeFileSync(file,crypto.randomBytes(150000));fs.writeFileSync(empty,'');
  let clip={kind:'files',files:[file,empty],hash:hashText('selection')};let bWrites=0;
  const aClip={read:async()=>clip,write:async value=>{clip=value;}},bClip={read:async()=>null,write:async()=>{bWrites++;}};
  saveState({deviceId:'files-host-device',name:'Host',role:'hub',pin:'123456',port:0,autoFiles:false,receiveDir:path.join(aDir,'received')},aDir);
  const a=await startService({dir:aDir,clipboard:aClip,discoveryPort:false,log:()=>{}});let b;
  t.after(async()=>{await b?.close();await a.close();await sleep(100);fs.rmSync(root,{recursive:true,force:true});});
  saveState({deviceId:'files-peer-device',name:'Peer',role:'client',pin:'123456',hub:{host:'127.0.0.1',port:a.hub.port},receiveDir:path.join(bDir,'received')},bDir);
  b=await startService({dir:bDir,clipboard:bClip,log:()=>{}});
  clip={...clip,hash:hashText('new file selection')};await sleep(650);
  assert.deepEqual(fs.readdirSync(b.endpoint.store.receiveDir),[]);
  const results=await a.command('send-clipboard',[b.endpoint.id]);
  assert.equal(results.length,1);
  assert.equal(results[0].error, undefined, JSON.stringify(results[0]));
  assert.equal(results[0].files.length,2);
  for (const [index, sent] of results[0].files.entries()) assert.equal(await fileHash(sent.path),await fileHash([file,empty][index]));
  const entries = await b.command('history',['list']);
  assert.equal(entries.length,1);assert.equal(entries[0].payloads.length,2);
  assert.equal(bWrites,1);assert.equal(clip.kind,'files');
  clip={kind:'files',files:[root],hash:'folder'};await assert.rejects(a.command('send-clipboard',[b.endpoint.id]),/Folders/);
  clip={kind:'text',text:'hello'};await assert.rejects(a.command('send-clipboard',[]),/Copy files/);
});

test('workstation copy automatically fans out through Hub once, rejects folders, supports off and pause', { timeout: 12000 }, async t => {
  const root=fs.mkdtempSync(path.resolve('.test-auto-files-')),services=[],logs=[];
  const clipboard=()=>{let item=null,writes=0;return {read:async()=>item,write:async value=>{writes++;item={...value,hash:hashText(JSON.stringify(value.files))};},copy:files=>{item={kind:'files',files,hash:hashText(JSON.stringify(files))};},get writes(){return writes;}};};
  const clips=[clipboard(),clipboard(),clipboard()];
  t.after(async()=>{for(const service of services.reverse())await service.close();await sleep(100);fs.rmSync(root,{recursive:true,force:true});});
  for(let i=0;i<3;i++){
    const dir=path.join(root,String(i));saveState({deviceId:'auto-device-'+i,name:'Device '+i,role:i===0?'hub':'client',pin:'123456',port:0,...(i?{hub:{host:'127.0.0.1',port:services[0].hub.port}}:{}),receiveDir:path.join(dir,'received')},dir);
    services.push(await startService({dir,clipboard:clips[i],discoveryPort:false,log:message=>logs.push(message)}));
  }
  const files=[path.join(root,'copied.bin'),path.join(root,'empty.dat')];fs.writeFileSync(files[0],crypto.randomBytes(70000));fs.writeFileSync(files[1],'');
  clips[1].copy(files);
  const wait=async fn=>{const end=Date.now()+5000;while(!await fn()){if(Date.now()>end)throw Error('Auto files timed out: '+logs.join('\n'));await sleep(30);}};
  await wait(async()=>((await services[0].command('history',[])).length===1&&(await services[2].command('history',[])).length===1));
  await sleep(1200);
  assert.equal(clips[0].writes,1);assert.equal(clips[2].writes,1);assert.equal(clips[1].writes,0,'No received-file echo to origin');
  for(const index of [0,2]){const entry=(await services[index].command('history',[]))[0];assert.equal(entry.payloads.length,2);assert.equal(entry.sender.id,'auto-device-1');assert.equal(await fileHash(entry.payloads[0].path),await fileHash(files[0]));}
  assert.equal(services[1].endpoint.jobs().length,0);
  clips[1].copy([root]);await wait(()=>logs.some(message=>/folders are not supported/i.test(message)));assert.equal((await services[0].command('history',[])).length,1);
  await services[1].command('auto-files',['off']);assert.equal((await services[1].command('status',[])).autoFiles,false);
  clips[1].copy([files[0]]);await sleep(650);assert.equal((await services[0].command('history',[])).length,1);
  await services[1].command('pause',[]);await services[1].command('auto-files',['on']);clips[1].copy([files[1]]);await sleep(650);assert.equal((await services[0].command('history',[])).length,1);
  await services[1].command('unpause',[]);await wait(async()=>(await services[0].command('history',[])).length===2);
  await assert.rejects(services[1].command('auto-files',['invalid']),/on\|off/);
});
