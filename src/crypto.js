import crypto from 'node:crypto';
export function randomPin() { return String(crypto.randomInt(1_000_000)).padStart(6, '0'); }
export function randomSalt() { return crypto.randomBytes(16).toString('base64url'); }
export function deriveKey(pin, salt) { return crypto.scryptSync(pin, Buffer.from(salt, 'base64url'), 32, { N: 16384, r: 8, p: 1 }); }
export function proof(key, text) { return crypto.createHmac('sha256', key).update(text).digest('hex'); }
export function equalProof(a, b) { return typeof a === 'string' && /^[0-9a-f]{64}$/.test(a) && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
export function sessionKey(key, nonce) { return crypto.createHmac('sha256', key).update('session:' + nonce).digest(); }
export function encryptObject(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}
export function decryptObject(value, key) {
  if (!value || typeof value.iv !== 'string' || typeof value.tag !== 'string' || typeof value.data !== 'string') throw new Error('Invalid envelope');
  const iv = Buffer.from(value.iv, 'base64url'), tag = Buffer.from(value.tag, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid envelope');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64url')), cipher.final()]).toString('utf8'));
}
