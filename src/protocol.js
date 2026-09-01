import crypto from 'node:crypto';

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
