import crypto from 'node:crypto';
import { GROUP_SALT_BYTES } from './config.js';

export function randomPin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function randomSalt() {
  return crypto.randomBytes(GROUP_SALT_BYTES).toString('base64url');
}

function deriveKey(pin, saltString) {
  const salt = Buffer.from(saltString, 'base64url');
  return crypto.scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function encryptObject(obj, pin, saltString) {
  const key = deriveKey(pin, saltString);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: ciphertext.toString('base64url')
  };
}

export function decryptObject(envelope, pin, saltString) {
  const key = deriveKey(pin, saltString);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}
