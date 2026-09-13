#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { dataDirectory, deviceId, loadState, saveState } from './state.js';
import { discover } from './client.js';
import { startService, control } from './service.js';
import { clipboardDoctor, readClipboard } from './clipboard.js';

const usage = [
'Universal Clipboard LAN',
'  uc setup                       Guided first-time setup',
'  uc start                       Start sync using saved settings',
'  uc host [--port 3000]           Create a Hub and start sync',
'  uc join <ip> <pin> [--port 3000] Pair and start sync',
'  uc discover                    Find Hubs on this LAN',
'  uc doctor                      Check native clipboard support',
'  uc status                      Show status (never prints PIN)',
'  uc devices                     List connected recipients',
'  uc push [text] [--to ID]        Send text (clipboard if omitted)',
'  uc send-file <paths...> [--to ID|all]',
'  uc transfers                   Show unfinished outgoing transfers',
'  uc resume                      Resume files from confirmed offsets',
'  uc cancel <transferId>         Remove an inactive unfinished transfer',
'  uc pause / uc unpause          Pause/resume clipboard sync',
'  uc rename <name>               Change device name',
'  uc receive-dir <path>          Choose where received files are saved',
'  uc revoke <deviceId>           Revoke a device (Hub)',
'  --data-dir <path>              Separate profile (testing/portable use)',
'Node.js 22+; keep the start/host/join terminal open.'
].join('\n');
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { to: { type: 'string' }, port: { type: 'string', default: '3000' }, 'data-dir': { type: 'string' }, help: { type: 'boolean' } } });
  if (values['data-dir']) process.env.UC_DATA_DIR = path.resolve(values['data-dir']);
  let [cmd, ...args] = positionals;
  if (values.help || cmd === 'help') { console.log(usage); return; }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1-65535');
  const dir = dataDirectory();
  if (!cmd) cmd = process.stdin.isTTY ? 'setup' : 'help';
  if (cmd === 'help') { console.log(usage); return; }
  if (cmd === 'doctor') { const result = await clipboardDoctor(); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return; }
  if (cmd === 'discover') { console.table(await discover()); return; }
  if (['setup', 'host', 'join'].includes(cmd)) {
    let active = false;
    try { await control('status'); active = true; } catch {}
    if (active) throw new Error('Stop the running service with Ctrl+C before changing its pairing.');
    deviceId(dir);
    const state = loadState(dir);
    state.name ||= os.hostname();
    state.receiveDir ||= path.join(os.homedir(), 'Downloads', 'Universal Clipboard');
    if (cmd === 'setup') {
      if (!process.stdin.isTTY) throw new Error('Use uc host or uc join <ip> <pin> in a non-interactive terminal');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        state.name = (await rl.question('Device name [' + state.name + ']: ')).trim() || state.name;
        const role = (await rl.question('Create a group (h) or join one (j)? [h]: ')).trim().toLowerCase() || 'h';
        if (!['h', 'j'].includes(role)) throw new Error('Choose h or j');
        if (role === 'h') { state.role = 'hub'; state.port = port; }
        else {
          const hubs = await discover();
          if (hubs.length) console.table(hubs.map((h, index) => ({ number: index + 1, name: h.name, address: h.address, port: h.port })));
          const answer = (await rl.question('Hub number or IP address: ')).trim();
          const selected = hubs[Number(answer) - 1];
          const pin = (await rl.question('6-digit PIN shown on the Hub: ')).trim();
          if (!/^\d{6}$/.test(pin)) throw new Error('PIN must contain 6 digits');
          state.role = 'client'; state.hub = { host: selected?.address || answer, port: selected?.port || port }; state.pin = pin;
        }
      } finally { rl.close(); }
    } else if (cmd === 'host') { state.role = 'hub'; state.port = port; }
    else {
      const [host, second, third] = args;
      const pin = third || second;
      const actualPort = third ? Number(second) : port;
      if (!host || !/^\d{6}$/.test(pin || '') || !Number.isInteger(actualPort) || actualPort < 1 || actualPort > 65535) throw new Error('Use uc join <ip> <6-digit-pin> [--port 3000]');
      state.role = 'client'; state.hub = { host, port: actualPort }; state.pin = pin;
    }
    saveState(state, dir); cmd = 'start';
  }
  if (cmd === 'start' || cmd === 'watch') {
    const service = await startService({ dir });
    const stop = async () => { await service.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (cmd === 'status') {
    try { console.log(JSON.stringify(await control('status'), null, 2)); }
    catch { const state = loadState(dir); console.log(JSON.stringify({ running: false, role: state.role || 'unconfigured', name: state.name, dataDir: dir }, null, 2)); }
    return;
  }
  let result;
  if (cmd === 'push') {
    const text = args.length ? args.join(' ') : (await readClipboard())?.text;
    if (typeof text !== 'string') throw new Error('Clipboard does not contain text');
    result = await control(cmd, [text, values.to]);
  } else if (cmd === 'send-file') {
    if (!args.length) throw new Error('Specify one or more file paths');
    result = await control(cmd, [args.map(x => path.resolve(x)), values.to]);
  } else if (['devices', 'transfers', 'resume', 'pause', 'unpause', 'revoke', 'rename', 'receive-dir', 'cancel'].includes(cmd)) {
    if (['revoke', 'rename', 'receive-dir', 'cancel'].includes(cmd) && !args.length) throw new Error('Missing argument');
    if (cmd === 'receive-dir') args[0] = path.resolve(args[0]);
    result = await control(cmd, args);
  } else throw new Error('Unknown command. Use uc --help');
  console.log(JSON.stringify(result, null, 2));
  const failed = value => value && typeof value === 'object' && (value.error || value.clipboardError || Object.values(value).some(failed));
  if (failed(result)) process.exitCode = 1;
}
main().catch(error => { console.error('Error: ' + error.message); process.exitCode = 1; });
