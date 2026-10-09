import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WebSocket } from 'ws';
import { Hub } from '../src/hub.js';
import { Client } from '../src/client.js';
import { newInvite, inviteUri, parseInvite } from '../src/pairing.js';
import { internetOrigin, websocketUrl, startInternetGateway, websocketSocket } from '../src/internet.js';
import { QuickTunnel, parseTunnelUrl } from '../src/tunnel.js';
import { fileHash } from '../src/transfers.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('v2 Internet invitation is strict, short-lived and preserves v1 LAN compatibility', () => {
  const invite = newInvite('internet-host-device', 'https://demo.trycloudflare.com', 3000);
  assert.deepEqual(parseInvite(inviteUri(invite)), invite);
  assert.equal(websocketUrl(invite.url), 'wss://demo.trycloudflare.com/uc');
  assert.equal(internetOrigin('wss://demo.trycloudflare.com/uc'), invite.url);
  assert.deepEqual(parseInvite(inviteUri(newInvite('internet-host-device', '192.168.1.10', 3000))).host, '192.168.1.10');
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?secret=x', 'https://example.com/other', 'https://example.com/#secret']) assert.throws(() => internetOrigin(url));
  assert.throws(() => parseInvite(inviteUri(invite) + '&url=https://other.example'));
  assert.throws(() => parseInvite(inviteUri({ ...invite, expires: Date.now() - 1 })));
});

test('Internet gateway authenticates invites, rejects public PIN, forwards encrypted text and binary files, resumes and revokes', { timeout: 20000 }, async t => {
  const root = fs.mkdtempSync(path.resolve('.test-internet-'));
  const state = { deviceId: 'internet-host-device', name: 'Host', pin: '123456' };
  const hub = new Hub({ state, port: 0, bind: '127.0.0.1', discoveryPort: false }); await hub.start();
  const gateway = await startInternetGateway(hub), clients = [];
  t.after(async () => { for (const client of clients) await client.close(); await gateway.close(); await hub.close(); await sleep(100); fs.rmSync(root, { force: true, recursive: true }); });
  let hostItem;
  const hostDir = path.join(root, 'host');
  const local = new Client({ host: '127.0.0.1', port: hub.port, pin: state.pin, id: state.deviceId, name: 'Host', dir: hostDir, receiveDir: path.join(hostDir, 'received'), clipboard: { read: async () => hostItem, write: async item => { hostItem = item; } } }); clients.push(local); await local.connect();
  const make = (id, pairing, pin) => { const dir = path.join(root, id); const c = new Client({ id, name: id, dir, receiveDir: path.join(dir, 'received'), pairing, pin, retryMs: 50, clipboard: { read: async () => c.received, write: async item => { c.received = item; } }, socketFactory: () => websocketSocket(new WebSocket('ws://127.0.0.1:' + gateway.port + '/uc', { perMessageDeflate: false })) }); clients.push(c); return c; };
  const pinOnly = make('public-pin-device', undefined, state.pin); await assert.rejects(pinOnly.connect(), /INVITATION_REQUIRED/);
  const invite = hub.createInvitation('https://demo.trycloudflare.com');
  const pairing = { id: invite.id, secret: invite.secret, hubId: state.deviceId };
  const remote = make('internet-client-device', { ...pairing }); await remote.connect();
  assert.equal(remote.pairing.id, undefined);
  await remote.push('Hello from Internet', state.deviceId); assert.equal(hostItem.text, 'Hello from Internet');
  await local.push('Reply from LAN', remote.id); assert.equal(remote.received.text, 'Reply from LAN');
  const file = path.join(root, 'binary.pdf'); fs.writeFileSync(file, crypto.randomBytes(400000));
  let cut = false;
  remote.on('progress', progress => { if (!cut && progress.bytes >= 65536) { cut = true; remote.socket.destroy(); } });
  const result = await remote.sendFile(file, local.id); assert.ok(cut); assert.equal(result[0].error, undefined); assert.ok(result[0].resumedBytes >= 65536); assert.equal(await fileHash(result[0].path), await fileHash(file));
  const second = await local.sendFile(file, remote.id); assert.equal(await fileHash(second[0].path), await fileHash(file));
  const reuse = make('invite-reuse-device', { ...pairing }); await assert.rejects(reuse.connect(), /INVITE_EXPIRED_OR_USED/);
  await remote.close(); await sleep(100);
  const restored = make(remote.id, { secret: invite.secret, hubId: state.deviceId }); await restored.connect();
  hub.revoke(remote.id); await restored.close(); await sleep(100);
  await assert.rejects(make(remote.id, { secret: invite.secret, hubId: state.deviceId }).connect(), /DEVICE_REVOKED/);
  const response = await fetch('http://127.0.0.1:' + gateway.port + '/', { method: 'POST', body: JSON.stringify({ command: 'status' }) });
  assert.ok(!(await response.text()).includes(state.pin));
});

test('Quick Tunnel parses split output, reports exit, closes only its owned child', async t => {
  const dir = fs.mkdtempSync(path.resolve('.test-tunnel-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let child;
  const tunnel = new QuickTunnel({ binary: 'test-cloudflared', port: 12345, configDir: dir, spawnProcess: (binary, args, options) => {
    assert.equal(options.shell, false); assert.ok(args.includes('http://127.0.0.1:12345'));
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.kill = () => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); };
    queueMicrotask(() => { child.stderr.write('https://hello-'); child.stderr.write('world.trycloudflare.com\n'); }); return child;
  } });
  assert.equal(await tunnel.start(), 'https://hello-world.trycloudflare.com'); assert.equal(tunnel.status, 'ready');
  await tunnel.close(); assert.equal(tunnel.url, null); assert.equal(tunnel.status, 'stopped'); assert.equal(tunnel.retry, undefined);
  assert.equal(parseTunnelUrl('random output'), null);
});
