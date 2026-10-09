import crypto from 'node:crypto';
import net from 'node:net';
import { internetOrigin } from './internet.js';
export const INVITE_TTL = 120_000;
export function newInvite(hubId, host, port, now = Date.now()) {
  if (host?.startsWith('https:') || host?.startsWith('wss:')) return { id: crypto.randomBytes(16).toString('hex'), secret: crypto.randomBytes(32).toString('hex'), expires: now + INVITE_TTL, hubId, url: internetOrigin(host) };
  if (!net.isIPv4(host) || host === '0.0.0.0' || host.startsWith('127.') || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose the Host LAN IPv4 address and a valid port');
  return { id: crypto.randomBytes(16).toString('hex'), secret: crypto.randomBytes(32).toString('hex'), expires: now + INVITE_TTL, hubId, host, port };
}
export function inviteUri(invite) {
  const url = new URL('uvc://join');
  for (const [key, value] of Object.entries({ v: invite.url ? 2 : 1, ...invite })) url.searchParams.set(key, String(value));
  return url.href;
}
export function parseInvite(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length > 2048) throw new Error('Invalid invitation');
  const url = new URL(text), p = url.searchParams;
  const remote = p.get('v') === '2';
  const keys = ['v', 'id', 'secret', 'expires', 'hubId', ...(remote ? ['url'] : ['host', 'port'])];
  if (url.protocol !== 'uvc:' || url.hostname !== 'join' || url.pathname || url.hash || url.username || url.password || [...p.keys()].some(k => !keys.includes(k)) || keys.some(k => p.getAll(k).length !== 1) || !['1', '2'].includes(p.get('v'))) throw new Error('Unsupported invitation');
  const invite = { id: p.get('id'), secret: p.get('secret'), expires: Number(p.get('expires')), hubId: p.get('hubId'), ...(remote ? { url: internetOrigin(p.get('url')) } : { host: p.get('host'), port: Number(p.get('port')) }) };
  if (!/^[a-f0-9]{32}$/.test(invite.id) || !/^[a-f0-9]{64}$/.test(invite.secret) || !/^[a-zA-Z0-9-]{8,64}$/.test(invite.hubId) || (!remote && (!net.isIPv4(invite.host) || invite.host === '0.0.0.0' || invite.host.startsWith('127.') || !Number.isInteger(invite.port) || invite.port < 1 || invite.port > 65535)) || !Number.isSafeInteger(invite.expires) || invite.expires <= now || invite.expires > now + INVITE_TTL + 60_000) throw new Error('Invalid or expired invitation; create a new QR on the Host');
  return invite;
}
