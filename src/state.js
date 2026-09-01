import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve('data');
const FILE = path.join(DATA_DIR, 'state.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function deviceId() {
  ensureDir();
  const existing = loadState();
  if (existing.deviceId) return existing.deviceId;
  existing.deviceId = crypto.randomBytes(6).toString('hex').toUpperCase();
  saveState(existing);
  return existing.deviceId;
}

export function loadState() {
  ensureDir();
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

export function saveState(state) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}
