import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Hub } from './hub.js';
import { Client } from './client.js';
import { relayReceivedFiles } from './relay.js';
import { readClipboard, writeClipboard } from './clipboard.js';
import { dataDirectory, deviceId, loadState, saveState, atomicJson } from './state.js';
import { localIPv4s } from './net.js';
import { HistoryStore } from './history.js';
import { startInternetGateway } from './internet.js';
import { ensureCloudflared, QuickTunnel } from './tunnel.js';

async function openLocalFiles(files) {
  for (const file of files) await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [file], { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export async function control(command, args = [], dir = dataDirectory()) {
  const file = path.join(dir, 'service.json');
  if (!fs.existsSync(file)) throw new Error('Service not running. Run uc start first.');
  const { port, token } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => { try { const result = JSON.parse(data); if (result.error) reject(new Error(result.error)); else resolve(result.result); } catch (error) { reject(error); } });
    });
    if (command === 'status') req.setTimeout(2000, () => req.destroy());
    req.on('error', () => reject(new Error('Service not reachable. Run uc start.')));
    req.end(JSON.stringify({ command, args }));
  });
}
export async function startService({ dir = dataDirectory(), clipboard = { read: readClipboard, write: writeClipboard }, log = console.log, discoveryPort } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = deviceId(dir), state = loadState(dir);
  if (!state.role) throw new Error('Run uc setup first');
  if (fs.existsSync(path.join(dir, 'service.json'))) {
    try { await control('status', [], dir); throw new Error('ALREADY_RUNNING'); }
    catch (error) { if (error.message === 'ALREADY_RUNNING') throw new Error('Service already running. Use its existing terminal.'); }
  }
  state.name ||= os.hostname(); state.receiveDir ||= path.join(os.homedir(), 'Downloads', 'Universal Clipboard');
  const save = value => saveState(value, dir);
  let hub, endpoint, server, watchTimer, gateway, tunnel;
  let internetError = null;
  const token = crypto.randomBytes(32).toString('hex');
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true; clearInterval(watchTimer);
    await tunnel?.close(); await gateway?.close(); await endpoint?.close(); await hub?.close();
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    const serviceFile = path.join(dir, 'service.json');
    if (fs.existsSync(serviceFile) && JSON.parse(fs.readFileSync(serviceFile, 'utf8')).token === token) fs.unlinkSync(serviceFile);
  };
  try {
    const history = await new HistoryStore({ dir, partialDir: path.join(dir, 'incoming'), ...(state.historyBudgetBytes ? { budgetBytes: state.historyBudgetBytes } : {}) }).init();
    if (state.role === 'hub') {
      hub = new Hub({ state, save, port: state.port ?? 3000, discoveryPort });
      hub.on('warning', warning => log('[Hub] ' + warning));
      await hub.start();
      log('Hub: ' + localIPv4s().map(x => x.address + ':' + hub.port).join(', '));
      log('Pairing PIN: ' + state.pin);
    }
    endpoint = new Client({ url: hub ? undefined : state.hub.url, host: hub ? '127.0.0.1' : state.hub.host, port: hub ? hub.port : state.hub.port, pin: state.pin, pairing: hub ? undefined : state.pairing, onPaired: pairing => { state.pairing = pairing; save(state); }, id, name: state.name, dir, receiveDir: state.receiveDir, clipboard, history });
    await endpoint.store.ready;
    if (hub) relayReceivedFiles(endpoint, dir, log);
    endpoint.paused = !!state.paused;
    endpoint.on('connected', () => log('Connected. Clipboard sync ' + (endpoint.paused ? 'paused.' : 'ready.')));
    endpoint.on('disconnected', () => { if (!closing) log('Disconnected; reconnecting automatically unless access was rejected.'); });
    let lastProgress = 0, lastRetry = 0;
    endpoint.on('progress', progress => { if (Date.now() - lastProgress > 1000 || progress.bytes === progress.size) { log(progress.name + ': ' + Math.round(progress.bytes / progress.size * 100) + '%'); lastProgress = Date.now(); } });
    endpoint.on('retry', event => { if (Date.now() - lastRetry > 5000) { log(event.name + ': waiting to resume (' + event.message + ')'); lastRetry = Date.now(); } });
    endpoint.on('clipboard', kind => log('Received clipboard ' + kind));
    await endpoint.connect();
    save(state);
    const command = async (name, args) => {
      switch (name) {
        case 'status': return { id, name: state.name, role: state.role, connected: endpoint.ready, paused: endpoint.paused, autoFiles: state.autoFiles !== false, receiveDir: state.receiveDir, pendingTransfers: endpoint.jobs().length, internet: hub ? { enabled: !!state.internet, status: tunnel?.status || (internetError ? 'failed' : state.internet ? 'starting' : 'off'), url: tunnel?.url || null, error: internetError } : { transport: state.hub.url ? 'wss' : 'tcp', url: state.hub.url || null } };
        case 'auto-files': {
          if (!['on', 'off'].includes(args[0])) throw new Error('Use uc auto-files on|off');
          state.autoFiles = args[0] === 'on'; save(state); return { autoFiles: state.autoFiles };
        }
        case 'devices': return await endpoint.devices();
        case 'qr': {
          if (!hub) throw new Error('Run uc qr on the Host');
          if (args[1]) {
            if (!tunnel?.url || tunnel.status !== 'ready') throw new Error('Internet tunnel is not ready. Start uc host --internet and check uc status.');
            return hub.createInvitation(tunnel.url);
          }
          const addresses = localIPv4s().map(x => x.address);
          const address = args[0] || addresses[0];
          if (!addresses.includes(address)) throw new Error('Choose an IPv4 address belonging to this Host');
          return hub.createInvitation(address);
        }
        case 'send-clipboard': {
          const item = await clipboard.read();
          if (item?.kind !== 'files') throw new Error('Copy files in Explorer/File Manager first, then run uc send-clipboard');
          if (!item.files.length || item.files.length > 64) throw new Error('Select 1–64 files');
          for (const file of item.files) if (!(await fs.promises.stat(file)).isFile()) throw new Error('Folders are not supported: ' + file);
          return await endpoint.sendFiles(item.files, args[0]);
        }
        case 'push': return await endpoint.push(args[0], args[1]);
        case 'send-file': {
          const [files, to] = args;
          return await endpoint.sendFiles(files, to);
        }
        case 'history': {
          const [action = 'list', entryId, destination] = args;
          if (action === 'list') return await history.list();
          if (action === 'usage') return await history.usage();
          if (action === 'copy') { await endpoint.publishHistory(entryId, true); return { copied: entryId }; }
          if (action === 'save') { if (!destination) throw new Error('Use uc history save <entryId> <directory>'); return { saved: await history.save(entryId, destination) }; }
          if (action === 'open') {
            const entry = await history.get(entryId), owner = 'open:' + crypto.randomUUID();
            await history.pin(entryId, owner);
            try { await openLocalFiles(entry.payloads.map(value => value.path)); }
            catch (error) { await history.unpin(owner); throw error; }
            return { opened: entryId, note: 'Close all opened files before uc history release ' + entryId };
          }
          if (action === 'release') { await history.releaseOpen(entryId); return { released: entryId }; }
          if (action === 'budget') {
            const bytes = Number(entryId) * 1024 ** 2;
            if (!Number.isSafeInteger(bytes) || bytes < 1024 ** 2) throw new Error('Use uc history budget <MiB>, at least 1 MiB');
            const used = await history.usage();
            if (bytes < used.bytes + used.reservedBytes) throw new Error('New budget is below existing history, partials and reservations');
            history.budgetBytes = bytes; state.historyBudgetBytes = bytes; save(state); return await history.usage();
          }
          throw new Error('History actions: list, copy, open, save, release, usage, budget');
        }
        case 'resume': return await endpoint.resume();
        case 'transfers': return endpoint.jobs();
        case 'cancel': return await endpoint.cancel(args[0]);
        case 'pause': case 'unpause': endpoint.paused = name === 'pause'; state.paused = endpoint.paused; save(state); return { paused: endpoint.paused };
        case 'revoke': if (!hub) throw new Error('Only the Hub can revoke devices'); hub.revoke(args[0]); return { revoked: args[0] };
        case 'rename': {
          if (typeof args[0] !== 'string' || !args[0].trim() || args[0].length > 80) throw new Error('Name must be 1-80 characters');
          state.name = args[0]; endpoint.name = args[0]; save(state); endpoint.socket.destroy(); return { name: state.name };
        }
        case 'receive-dir': {
          const output = path.resolve(args[0]); fs.mkdirSync(output, { recursive: true });
          endpoint.store.receiveDir = output; state.receiveDir = output; save(state); return { receiveDir: output };
        }
        default: throw new Error('Unknown command');
      }
    };
    server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST' || req.url !== '/' || req.headers.origin || req.headers.authorization !== 'Bearer ' + token) { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); return; }
      try {
        let data = '';
        for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 1024 * 1024) throw new Error('Request too large'); }
        const body = JSON.parse(data);
        if (!Array.isArray(body.args)) throw new Error('Invalid arguments');
        res.end(JSON.stringify({ result: await command(body.command, body.args) }));
      } catch (error) { res.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    atomicJson(path.join(dir, 'service.json'), { port: server.address().port, token, pid: process.pid });
    let watching = false, clipboardWarning = 0;
    try { endpoint.lastHash = (await clipboard.read())?.hash; } catch (error) { log('Clipboard: ' + error.message + '. Run uc doctor.'); }
    watchTimer = setInterval(async () => {
      if (watching || endpoint.applying || endpoint.paused || !endpoint.ready) return;
      watching = true;
      try {
        const item = await clipboard.read();
        if (!item || item.hash === endpoint.lastHash || endpoint.applying) return;
        if (item.kind === 'files') {
          // Claim this selection before hashing/sending. Rejected or partially successful
          // batches must not be recreated on every poll; saved jobs remain resumable.
          endpoint.lastHash = item.hash;
          if (state.autoFiles === false) return;
          log('Copied files detected: ' + item.files.length + '. Checking and sending through Hub.');
          const results = await endpoint.sendFiles(item.files, 'all');
          for (const result of results) {
            if (result.error || result.clipboardError) log('Auto files to ' + result.to + ': ' + (result.error || result.clipboardError) + '. Check uc transfers / uc resume.');
            else log('Auto files delivered to ' + result.to);
          }
        }
        else if (item.kind === 'text') await endpoint.push(item.text);
        else {
          const imageDir = path.join(dir, 'images'); fs.mkdirSync(imageDir, { recursive: true });
          const file = path.join(imageDir, item.hash + '.png');
          fs.writeFileSync(file, item.bytes, { mode: 0o600 });
          endpoint.lastHash = item.hash;
          const results = await endpoint.sendFile(file, 'all', 'image');
          if (results.some(result => result.error || result.clipboardError)) log('Image not applied on every recipient. Check uc transfers; saved files remain available.');
          if (!results.some(result => result.error)) fs.rmSync(file, { force: true });
        }
      } catch (error) {
        if (Date.now() - clipboardWarning > 30000) { log('Clipboard: ' + error.message); clipboardWarning = Date.now(); }
      } finally { watching = false; }
    }, 500);
    log('Ready. Copied files auto-send through Hub: ' + (state.autoFiles !== false ? 'on' : 'off') + '. Use uc auto-files off to disable. Ctrl+C stops.');
    if (endpoint.jobs().length) log('Unfinished transfers found. Run uc resume to continue.');
    const internetReady = (async () => {
    if (hub && state.internet && !closing) {
      try {
        gateway = await startInternetGateway(hub);
        if (closing) { await gateway.close(); return; }
        const binary = await ensureCloudflared(dir, log);
        if (closing) return;
        tunnel = new QuickTunnel({ binary, port: gateway.port, configDir: path.join(dir, 'tools'), log });
        tunnel.on('url', url => { internetError = null; log('Internet Host: ' + url + '. Run uc qr --internet for a private invitation.'); });
        log('Opening Cloudflare Quick Tunnel. LAN remains available.');
        await tunnel.start();
      } catch (error) { internetError = error.message; log('Internet unavailable: ' + error.message + '. LAN remains available; restart Host to retry.'); }
    }
    })();
    return { endpoint, hub, close, command, internetReady };
  } catch (error) { await close(); throw error; }
}
