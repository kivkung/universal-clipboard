// Real public tunnel test using only isolated random fixtures, never the user's clipboard.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Hub } from '../src/hub.js';
import { Client } from '../src/client.js';
import { startInternetGateway } from '../src/internet.js';
import { ensureCloudflared, QuickTunnel } from '../src/tunnel.js';
import { inviteUri } from '../src/pairing.js';
import { fileHash } from '../src/transfers.js';
const dir = path.resolve(process.env.UC_INTERNET_TEST_DIR || 'build/internet-smoke'); fs.mkdirSync(dir, { recursive: true });
const hold = process.argv.includes('--android');
const state = { deviceId: 'public-test-host', name: 'Public test Host', pin: '123456' };
const hub = new Hub({ state, port: 0, bind: '127.0.0.1', discoveryPort: false });
let gateway, tunnel, local, remote, lastItem, stopTimer;
async function close() { clearInterval(stopTimer); await remote?.close(); await local?.close(); await tunnel?.close(); await gateway?.close(); await hub.close(); }
process.once('SIGINT', () => close().then(() => process.exit())); process.once('SIGTERM', () => close().then(() => process.exit()));
try {
  await hub.start(); gateway = await startInternetGateway(hub);
  const binary = await ensureCloudflared(dir, console.log);
  tunnel = new QuickTunnel({ binary, port: gateway.port, configDir: path.join(dir, 'tools'), log: console.log });
  const url = await tunnel.start(); console.log('Public test endpoint: ' + url);
  local = new Client({ host: '127.0.0.1', port: hub.port, pin: state.pin, id: state.deviceId, name: state.name, dir: path.join(dir, 'host'), receiveDir: path.join(dir, 'received'), clipboard: { read: async () => lastItem, write: async item => { lastItem = item; } } }); await local.connect();
  let available=false;
  for(let n=0;n<60&&!available;n++){try{const response=await fetch(url,{signal:AbortSignal.timeout(5000)});available=response.ok;}catch{}if(!available)await new Promise(r=>setTimeout(r,2000));}
  assert.ok(available,'Cloudflare public HTTP origin becomes reachable');
  const invite = hub.createInvitation(url);
  let remoteItem;
  remote = new Client({ url, id: 'public-test-node', name: 'Public test workstation', dir: path.join(dir, 'node'), receiveDir: path.join(dir, 'remote-received'), clipboard: { read: async () => remoteItem, write: async item => { remoteItem = item; } }, pairing: { id: invite.id, secret: invite.secret, hubId: state.deviceId } });
  // URL is printed before the Cloudflare edge has necessarily finished routing.
  let connected = false;
  for (let n = 0; n < 12 && !connected; n++) { try { await remote.connect(); connected = true; } catch (error) { console.log('Public connect retry: ' + error.message); if (remote.fatal) throw error; await new Promise(r => setTimeout(r, 2000)); } }
  assert.ok(connected, 'public endpoint is reachable');
  await remote.push('Public WSS upload', state.deviceId); assert.equal(lastItem.text, 'Public WSS upload'); console.log('PASS real Cloudflare WSS text upload');
  await local.push('Public WSS download', remote.id); assert.equal(remoteItem.text, 'Public WSS download'); console.log('PASS real Cloudflare WSS text download');
  const fixture = path.join(dir, 'internet-binary.pdf'); fs.writeFileSync(fixture, crypto.randomBytes(200123));
  const upload = await remote.sendFile(fixture, local.id); assert.equal(upload[0].error, undefined); assert.equal(await fileHash(upload[0].path), await fileHash(fixture)); console.log('PASS real Cloudflare WSS binary upload SHA-256');
  const download = await local.sendFile(fixture, remote.id); assert.equal(download[0].error, undefined); assert.equal(await fileHash(download[0].path), await fileHash(fixture)); console.log('PASS real Cloudflare WSS binary download SHA-256');
  await remote.close();
  fs.writeFileSync(path.join(dir, 'node-result.json'), JSON.stringify({ passed: true, url, bytes: 200123, fixtureHash: await fileHash(fixture) }, null, 2));
  if (hold) {
    const received = new Map(), baseHandle = local.handle.bind(local), storeHandle = local.store.handle.bind(local.store);
    local.store.handle = async (body, from) => { const result = await storeHandle(body, from); if (body.type === 'file.finish' && result.complete) received.set(from, await fileHash(result.path)); return result; };
    local.handle = async body => {
      if (body.type !== 'test.internet') return baseHandle(body);
      // Never await requests to a peer inside its reader queue.
      (async () => {
        let result;
        if (body.mode === 'upload-check') result = { hash: received.get(body.from) };
        else if (body.mode === 'receive-text') result = { value: await local.push('Android received via public WSS', body.from) };
        else if (body.mode === 'receive-file') result = { value: await local.sendFile(fixture, body.from) };
        else throw new Error('Unknown fixture mode');
        await local.send({ type: 'reply', to: body.from, replyTo: body.requestId, result });
      })().catch(e => local.send({ type: 'reply', to: body.from, replyTo: body.requestId, error: e.message }).catch(() => {}));
    };
    const androidInvite = hub.createInvitation(url);
    fs.writeFileSync(path.join(dir, 'android-invite.txt'), inviteUri(androidInvite), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'fixture-hash.txt'), await fileHash(fixture));
    console.log('ANDROID PUBLIC TEST READY (private invitation file; valid 2 minutes)');
    await new Promise(resolve => { stopTimer = setInterval(() => { if (fs.existsSync(path.join(dir, 'android-done'))) resolve(); }, 500); setTimeout(resolve, 240000).unref(); });
  }
} finally { if(tunnel) fs.writeFileSync(path.join(dir, 'tunnel-diagnostic.log'), tunnel.lastLog || ''); await close(); }
