import http from 'node:http';
import net from 'node:net';
import { WebSocket, WebSocketServer, createWebSocketStream } from 'ws';
import { MAX_FRAME_SIZE } from './config.js';

// Public invitations contain an HTTPS origin; the binary UCP stream uses /uc.
export function internetOrigin(value) {
  const url = new URL(value);
  if (!['https:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || !['', '/', '/uc'].includes(url.pathname)) throw new Error('Use an HTTPS Host URL without credentials, query or fragment');
  url.protocol = 'https:'; url.pathname = ''; return url.origin;
}
export function websocketUrl(value) {
  const url = new URL(internetOrigin(value)); url.protocol = 'wss:'; url.pathname = '/uc'; return url.href;
}
export function websocketSocket(ws, { remoteAddress = 'remote', publicTransport = false } = {}) {
  const stream = createWebSocketStream(ws, { encoding: undefined, highWaterMark: MAX_FRAME_SIZE + 5 });
  // Duplex EOF alone leaves the writable half open. Release Hub identity on
  // WebSocket close immediately, otherwise reconnect sees DEVICE_ALREADY_CONNECTED.
  ws.once('close', () => stream.destroy());
  ws.on('message', (_data, binary) => { if (!binary) stream.destroy(new Error('Expected binary WebSocket frames')); });
  stream.remoteAddress = remoteAddress; stream.publicTransport = publicTransport;
  stream.setKeepAlive = () => stream;
  stream.setTimeout = (ms, handler) => {
    clearTimeout(stream.inactivityTimer);
    if (handler) stream.once('timeout', handler);
    stream.timeoutMs = ms;
    const reset = () => { clearTimeout(stream.inactivityTimer); if (ms) stream.inactivityTimer = setTimeout(() => stream.emit('timeout'), ms); };
    if (!stream.timeoutListener) { stream.timeoutListener = () => { clearTimeout(stream.inactivityTimer); if (stream.timeoutMs) stream.inactivityTimer = setTimeout(() => stream.emit('timeout'), stream.timeoutMs); }; stream.on('data', stream.timeoutListener); }
    reset(); return stream;
  };
  stream.once('close', () => clearTimeout(stream.inactivityTimer));
  return stream;
}
export function connectInternet(value) {
  const ws = new WebSocket(websocketUrl(value), { perMessageDeflate: false, maxPayload: MAX_FRAME_SIZE + 5, handshakeTimeout: 10000, followRedirects: false });
  return websocketSocket(ws);
}
export async function startInternetGateway(hub) {
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.writeHead(req.url === '/' ? 200 : 404);
    res.end(req.url === '/' ? 'Universal Clipboard Host. Join using a private invitation in the app or CLI.\n' : 'Not found\n');
  });
  server.headersTimeout = 10000; server.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_FRAME_SIZE + 5 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/uc' || hub.connections.size >= 64) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      // Only cloudflared/local clients can access this loopback-only gateway.
      // Never expose the separate authenticated local CLI control server.
      const forwarded = req.headers['cf-connecting-ip'];
      const remoteAddress = typeof forwarded === 'string' && net.isIP(forwarded) ? forwarded : socket.remoteAddress;
      const stream = websocketSocket(ws, { remoteAddress, publicTransport: true });
      stream.on('error', () => {}); hub.accept(stream);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, close: async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
