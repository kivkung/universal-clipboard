import fs from 'node:fs/promises';
import { MAX_IMAGE_SIZE } from './config.js';
import { hashText } from './protocol.js';
import { PNG } from 'pngjs';
let native;
let imageWriter;
async function backend() { return native ??= await import('@crosscopy/clipboard'); }
export function decodeImage(bytes) {
  if (bytes.length > MAX_IMAGE_SIZE || bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Expected PNG image up to 32 MiB');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 16 * 1024 * 1024) throw new Error('Image exceeds 16 megapixels');
  return PNG.sync.read(bytes);
}
async function retryClipboard(action) {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (attempt >= 4 || !/clipboard|access is denied|OSError/i.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}
export function readClipboard() { return retryClipboard(readOnce); }
async function readOnce() {
  const cb = await backend();
  if (cb.hasImage()) {
    const bytes = Buffer.from(await cb.getImageBinary());
    if (bytes.length > MAX_IMAGE_SIZE) throw new Error('Clipboard image exceeds 32 MiB');
    const decoded = decodeImage(bytes);
    return { kind: 'image', bytes, hash: hashText(Buffer.concat([Buffer.from(decoded.width + ':' + decoded.height + ':'), decoded.data])) };
  }
  if (cb.hasText()) { const text = await cb.getText(); return { kind: 'text', text, hash: hashText(text) }; }
  return null;
}
export function writeClipboard(item) { return retryClipboard(() => writeOnce(item)); }
async function writeOnce(item) {
  const cb = await backend();
  if (item.kind === 'image') {
    const bytes = item.bytes || await fs.readFile(item.path);
    const decoded = decodeImage(bytes);
    // The CrossCopy Windows BMP path rejects very small images. Use raw RGBA
    // with arboard there, while retaining the PNG reader on every platform.
    if (process.platform === 'win32') {
      imageWriter ??= new (await import('@napi-rs/clipboard')).Clipboard();
      imageWriter.setImage(decoded.width, decoded.height, decoded.data);
    } else await cb.setImageBinary(Array.from(bytes));
  }
  else await cb.setText(item.text);
}
export async function clipboardDoctor() {
  if (process.platform === 'linux' && !process.env.DISPLAY) return { ok: false, error: 'This build requires an X11 or XWayland display.', hint: 'Choose an X11 desktop session for the demo. A pure Wayland session is not yet supported.' };
  try { const cb = await backend(); cb.availableFormats(); return { ok: true, platform: process.platform, session: process.env.XDG_SESSION_TYPE || 'desktop', ...(process.env.WAYLAND_DISPLAY ? { note: 'Using XWayland; test copy/paste with your target native Wayland applications before the demo.' } : {}) }; }
  catch (error) { return { ok: false, error: error.message, hint: 'Run in a desktop session. Linux requires a supported X11/Wayland clipboard backend; see README.' }; }
}
