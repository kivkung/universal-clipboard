import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Hub } from './hub.js';
import { Client } from './client.js';
import { readClipboard, writeClipboard } from './clipboard.js';
import { dataDirectory, deviceId, loadState, saveState, atomicJson } from './state.js';
import { localIPv4s } from './net.js';

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
  let hub, endpoint, server, watchTimer;
  const token = crypto.randomBytes(32).toString('hex');
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true; clearInterval(watchTimer);
    await endpoint?.close(); await hub?.close();
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    const serviceFile = path.join(dir, 'service.json');
    if (fs.existsSync(serviceFile) && JSON.parse(fs.readFileSync(serviceFile, 'utf8')).token === token) fs.unlinkSync(serviceFile);
  };
  try {
    if (state.role === 'hub') {
      hub = new Hub({ state, save, port: state.port ?? 3000, discoveryPort });
      hub.on('warning', warning => log('[Hub] ' + warning));
      await hub.start();
      log('Hub: ' + localIPv4s().map(x => x.address + ':' + hub.port).join(', '));
      log('Pairing PIN: ' + state.pin);
    }
    endpoint = new Client({ host: hub ? '127.0.0.1' : state.hub.host, port: hub ? hub.port : state.hub.port, pin: state.pin, id, name: state.name, dir, receiveDir: state.receiveDir, clipboard });
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
        case 'status': return { id, name: state.name, role: state.role, connected: endpoint.ready, paused: endpoint.paused, receiveDir: state.receiveDir, pendingTransfers: endpoint.jobs().length };
        case 'devices': return await endpoint.devices();
        case 'push': return await endpoint.push(args[0], args[1]);
        case 'send-file': {
          const [files, to] = args; const results = [];
          for (const file of files) {
            try { results.push({ file, results: await endpoint.sendFile(file, to) }); }
            catch (error) { results.push({ file, error: error.message }); }
          }
          return results;
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
        if (item.kind === 'text') await endpoint.push(item.text);
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
    log('Ready. Use another terminal for uc devices / uc send-file. Ctrl+C stops.');
    if (endpoint.jobs().length) log('Unfinished transfers found. Run uc resume to continue.');
    return { endpoint, hub, close, command };
  } catch (error) { await close(); throw error; }
}
