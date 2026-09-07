import crypto from 'node:crypto';

const FRAME_HEADER_SIZE = 5;

export const FRAME_JSON = 0x01;
export const FRAME_BINARY = 0x02;

export function encodeFrame(type, payload) {
  if (!Buffer.isBuffer(payload)) {
    payload = Buffer.from(payload);
  }

  const header = Buffer.alloc(FRAME_HEADER_SIZE);

  header.writeUInt32BE(payload.length, 0);
  header.writeUInt8(type, 4);

  return Buffer.concat([header, payload]);
}

export function encodeJsonFrame(obj) {
  const payload = Buffer.from(
    JSON.stringify(obj),
    'utf8'
  );

  return encodeFrame(FRAME_JSON, payload);
}

export function decodeJsonFrame(payload) {
  return JSON.parse(
    payload.toString('utf8')
  );
}

export function parseFrames(buffer) {
  const frames = [];

  while (buffer.length >= FRAME_HEADER_SIZE) {
    const length = buffer.readUInt32BE(0);
    const type = buffer.readUInt8(4);

    if (buffer.length < FRAME_HEADER_SIZE + length) {
      break;
    }

    const start = FRAME_HEADER_SIZE;
    const end = start + length;

    const payload = buffer.subarray(start, end);

    frames.push({
      type,
      payload
    });

    buffer = buffer.subarray(end);
  }

  return {
    frames,
    buffer
  };
}

export function line(obj) {
  return JSON.stringify(obj) + '\n';
}

export function parseLines(buffer) {
  const messages = [];
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const raw = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!raw.trim()) continue;
    messages.push(JSON.parse(raw));
  }
  return { messages, buffer };
}

export function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function clipboardMessage({ senderId, text }) {
  return {
    type: 'clipboard.push',
    id: crypto.randomUUID(),
    senderId,
    contentType: 'text',
    content: text,
    hash: hashText(text),
    timestamp: Date.now()
  };
}

export function fileMessage({
  senderId,
  name,
  mime,
  size,
  hash
}) {
  return {
    type: 'clipboard.push',
    id: crypto.randomUUID(),
    senderId,
    contentType: 'file',

    file: {
      name,
      mime,
      size,
      hash
    },

    timestamp: Date.now()
  };
}
