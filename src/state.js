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

  // Device ID ต้อง persistent
  // เพื่อให้ Hub จำได้ว่า device เดิมกลับมาอีกครั้ง
  if (existing.deviceId) return existing.deviceId;

  existing.deviceId = crypto.randomBytes(6).toString('hex').toUpperCase();

  saveState(existing);
  return existing.deviceId;
}

export function loadState() {
  ensureDir();

  try {
    const state = JSON.parse(
      fs.readFileSync(FILE, 'utf8')
    );

    /*
     * Migration สำหรับ state.json รุ่นเก่า
     *
     * ถ้า state.json ของ v0.1.1 ยังไม่มี field ใหม่
     * เราสร้างค่า default ให้โดยไม่ทำลายข้อมูลเดิม
     */

    if (!state.peers) {
      state.peers = {};
    }

    if (!state.revokedDevices) {
      state.revokedDevices = [];
    }

    return state;

  } catch {
    return {};
  }
}

export function saveState(state) {
  ensureDir();

  fs.writeFileSync(
    FILE,
    JSON.stringify(state, null, 2)
  );
}