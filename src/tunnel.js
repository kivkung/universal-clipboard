import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { internetOrigin } from './internet.js';

// Official release assets, SHA-256 from GitHub's release metadata. No fetched scripts.
export const CLOUDFLARED_VERSION = '2026.10.0';
const assets = {
  'win32-x64': ['cloudflared-windows-amd64.exe', '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'],
  'linux-x64': ['cloudflared-linux-amd64', 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db'],
  'linux-arm64': ['cloudflared-linux-arm64', 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08']
};
async function digest(file) { const h = crypto.createHash('sha256'); for await (const b of fs.createReadStream(file)) h.update(b); return h.digest('hex'); }
export async function ensureCloudflared(dir, log = () => {}) {
  const asset = assets[process.platform + '-' + process.arch];
  if (!asset) throw new Error('Automatic cloudflared installation supports Windows x64 / Linux x64 / Linux arm64');
  const [name, expected] = asset, cache = path.join(dir, 'tools', CLOUDFLARED_VERSION), file = path.join(cache, name);
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  if (fs.existsSync(file) && await digest(file) === expected) return file;
  log('Downloading official cloudflared ' + CLOUDFLARED_VERSION + ' (first use; SHA-256 checked).');
  const response = await fetch('https://github.com/cloudflare/cloudflared/releases/download/' + CLOUDFLARED_VERSION + '/' + name, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error('cloudflared download failed: ' + response.status);
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const output = await fs.promises.open(temporary, 'wx', 0o700);
  try {
    let size = 0;
    for await (const bytes of response.body) { size += bytes.length; if (size > 100 * 1024 ** 2) throw new Error('cloudflared download too large'); await output.write(bytes); }
    await output.sync(); await output.close();
    if (await digest(temporary) !== expected) throw new Error('cloudflared checksum mismatch');
    await fs.promises.rename(temporary, file); await fs.promises.chmod(file, 0o700);
  } finally { await output.close().catch(() => {}); await fs.promises.rm(temporary, { force: true }); }
  return file;
}

export function parseTunnelUrl(text) { const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i); return match ? internetOrigin(match[0]) : null; }

export class QuickTunnel extends EventEmitter {
  constructor({ binary, port, configDir, log = () => {}, spawnProcess = spawn, timeoutMs = 60000 }) {
    super(); Object.assign(this, { binary, port, configDir, log, spawnProcess, timeoutMs }); this.status = 'stopped'; this.url = null; this.stopped = true;
  }
  async start() {
    this.stopped = false;
    fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    // Explicit empty config avoids the user's global named-tunnel config blocking Quick Tunnel.
    const config = path.join(this.configDir, 'quick-tunnel.yml'); fs.writeFileSync(config, '{}\n', { mode: 0o600 });
    this.status = 'starting'; this.url = null;
    return new Promise((resolve, reject) => {
      let settled = false, buffer = '';
      const child = this.spawnProcess(this.binary, ['tunnel', '--config', config, '--no-autoupdate', '--url', 'http://127.0.0.1:' + this.port], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      this.child = child;
      const fail = error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => { fail(new Error('Cloudflare Tunnel startup timed out')); child.kill(); }, this.timeoutMs);
      const output = data => {
        buffer = (buffer + data.toString()).slice(-8192); const url = parseTunnelUrl(buffer);
        if (url && !settled) { settled = true; clearTimeout(timer); this.url = url; this.status = 'ready'; this.emit('url', url); resolve(url); }
        // Keep bounded log for diagnostics without logging private invitation secrets.
        this.lastLog = buffer;
      };
      child.stdout.on('data', output); child.stderr.on('data', output);
      child.once('error', error => { this.status = 'failed'; fail(error); });
      child.once('exit', (code, signal) => {
        this.url = null; this.status = this.stopped ? 'stopped' : 'disconnected';
        fail(new Error('cloudflared exited (' + (code ?? signal) + ')'));
        if (!this.stopped) { this.log('Internet tunnel disconnected; LAN remains available. Retrying; Quick Tunnel URL may change.'); this.retry = setTimeout(() => this.start().catch(() => {}), 5000); }
      });
    });
  }
  async close() {
    this.stopped = true; clearTimeout(this.retry); this.status = 'stopped'; this.url = null;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode) return;
    await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill(); });
  }
}
