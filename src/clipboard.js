import clipboard from 'clipboardy';
import { execFileSync } from 'node:child_process';

function commandExists(name) {
  try {
    execFileSync(name, ['--help'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function getClipboard() {
  if (process.env.UC_CLIPBOARD_CMD) {
    return execFileSync(process.env.UC_CLIPBOARD_CMD, { encoding: 'utf8' });
  }
  return clipboard.readSync();
}

export function setClipboard(text) {
  if (process.env.UC_CLIPBOARD_SET_CMD) {
    execFileSync(process.env.UC_CLIPBOARD_SET_CMD, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    return;
  }
  clipboard.writeSync(text);
}

export function platformClipboardHint() {
  if (process.env.TERMUX_VERSION) return 'Termux';
  return process.platform;
}
