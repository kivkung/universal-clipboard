import crypto from 'node:crypto';
import { MAX_FRAME_SIZE } from './config.js';
export const FRAME_JSON = 1;
export function encodeJsonFrame(value) {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > MAX_FRAME_SIZE) throw new Error('Frame too large');
  const header = Buffer.alloc(5);
  header.writeUInt32BE(data.length); header[4] = FRAME_JSON;
  return Buffer.concat([header, data]);
}
export function parseFrames(buffer) {
  const frames = [];
  while (buffer.length >= 5) {
    const length = buffer.readUInt32BE();
    if (length > MAX_FRAME_SIZE || length === 0 || buffer[4] !== FRAME_JSON) throw new Error('Invalid frame');
    if (buffer.length < length + 5) break;
    frames.push({ type: FRAME_JSON, payload: buffer.subarray(5, length + 5) });
    buffer = buffer.subarray(length + 5);
  }
  return { frames, buffer };
}
export function decodeJsonFrame(payload) { return JSON.parse(payload.toString('utf8')); }
export function hashText(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
export function readFrames(socket, handler, onError = () => {}) {
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  socket.on('data', chunk => {
    socket.pause();
    queue = queue.then(async () => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseFrames(buffer); buffer = parsed.buffer;
      for (const frame of parsed.frames) await handler(decodeJsonFrame(frame.payload));
    }).then(() => { if (!socket.destroyed) socket.resume(); }).catch(error => { onError(error); socket.destroy(); });
  });
}
export function writeFrame(socket, value) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.destroyed) return reject(new Error('Disconnected'));
    socket.write(encodeJsonFrame(value), error => error ? reject(error) : resolve());
  });
}
