import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
export function dataDirectory() {
  return path.resolve(process.env.UC_DATA_DIR || path.join(process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'universal-clipboard'));
}
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function loadState(dir = dataDirectory()) {
  const file = path.join(dir, 'state.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function saveState(state, dir = dataDirectory()) { atomicJson(path.join(dir, 'state.json'), state); }
export function deviceId(dir = dataDirectory()) {
  const state = loadState(dir);
  if (!state.deviceId) { state.deviceId = crypto.randomUUID(); saveState(state, dir); }
  return state.deviceId;
}
