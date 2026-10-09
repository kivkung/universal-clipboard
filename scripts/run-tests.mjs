import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Keep test payloads outside synced checkouts. All test imports still use the
// real project source; OneDrive must not lock temporary atomic rename fixtures.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryRoot = fs.realpathSync(os.tmpdir());
const scratch = fs.mkdtempSync(path.join(temporaryRoot, 'uvc-tests-'));
const files = ['core', 'service', 'features', 'history', 'batch', 'internet'].map(name => path.join(root, 'test', name + '.test.js'));
const child = spawn(process.execPath, ['--test', ...files], { cwd: scratch, stdio: 'inherit', windowsHide: true, shell: false });
const stop = () => child.kill();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
let result;
try {
  result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))); });
} finally {
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  const resolved = fs.realpathSync(scratch);
  if (path.dirname(resolved).toLowerCase() !== temporaryRoot.toLowerCase() || !path.basename(resolved).startsWith('uvc-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
process.exitCode = result;
