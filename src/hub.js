import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import os from 'node:os';
import { TCP_PORT, DISCOVERY_PORT, PROTOCOL } from './config.js';
import { encryptObject, decryptObject, randomPin, randomSalt } from './crypto.js';
import { line, parseLines } from './protocol.js';
import { deviceId, loadState, saveState } from './state.js';
import { localIPv4s } from './net.js';
import { getClipboard, setClipboard } from './clipboard.js';

export class Hub {
  constructor() {
    this.id = deviceId();

    this.state = loadState();

    this.state.role = 'hub';

    this.state.pin =
      this.state.pin ?? randomPin();

    this.state.salt =
      this.state.salt ?? randomSalt();

    // Existing v0.1.1 peer list
    this.state.peers =
      this.state.peers ?? {};

    // New:
    // Devices that were explicitly revoked.
    //
    // We keep revoked IDs separately instead of simply
    // deleting them from peers. Otherwise a revoked device
    // could join again with the correct PIN.
    this.state.revokedDevices =
      this.state.revokedDevices ?? [];

    saveState(this.state);

    this.sockets = new Map();

    this.lastHash = null;

    this.server = null;

    this.discovery = null;
  }

  start() {
    this.server = net.createServer(socket => this.handleSocket(socket));
    this.server.listen(TCP_PORT, '0.0.0.0', () => {
      console.log('\nUniversal Clipboard LAN');
      console.log('ROLE: HUB + CLIENT');
      console.log(`DEVICE: ${this.id}`);
      console.log(`TCP: ${TCP_PORT}`);
      console.log(`DISCOVERY: UDP ${DISCOVERY_PORT}`);
      console.log(`PIN: ${this.state.pin}`);
      console.log('\nLAN addresses:');
      for (const x of localIPv4s()) console.log(`  ${x.name}: ${x.address}`);
      console.log('\nWaiting for devices...');
    });

    this.discovery = dgram.createSocket('udp4');
    this.discovery.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      this.discovery.setBroadcast(true);
    });
    this.discovery.on('message', (buf, rinfo) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'uc.discover') {
          const reply = Buffer.from(JSON.stringify({
            type: 'uc.hub', protocol: PROTOCOL, hubId: this.id,
            port: TCP_PORT, name: osName()
          }));
          this.discovery.send(reply, rinfo.port, rinfo.address);
        }
      } catch { }
    });
  }

  handleSocket(socket) {
    let buffer = '';
    let peer = null;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      try {
        const parsed = parseLines(buffer);
        buffer = parsed.buffer;
        for (const msg of parsed.messages) {
          if (msg.type === 'auth') {

            /*
             * ----------------------------------------------------
             * 1. Basic authentication
             * ----------------------------------------------------
             *
             * PIN remains our PSK.
             *
             * Trusted Device does NOT replace authentication.
             *
             * The client still has to prove that it knows the
             * group PIN.
             */

            if (msg.pin !== this.state.pin) {

              socket.write(
                line({
                  type: 'error',
                  code: 'BAD_PIN'
                })
              );

              socket.destroy();

              return;
            }


            /*
             * ----------------------------------------------------
             * 2. Validate Device ID
             * ----------------------------------------------------
             */

            if (!msg.deviceId) {

              socket.write(
                line({
                  type: 'error',
                  code: 'DEVICE_ID_REQUIRED'
                })
              );

              socket.destroy();

              return;
            }


            /*
             * ----------------------------------------------------
             * 3. Check revoked devices
             * ----------------------------------------------------
             *
             * This check MUST happen before accepting the device.
             *
             * Merely deleting the peer from state is not enough,
             * because the device may still know the correct PIN.
             */

            if (
              this.state.revokedDevices.includes(msg.deviceId)
            ) {

              console.log(
                `[REJECTED] Revoked device ${msg.deviceId}`
              );

              socket.write(
                line({
                  type: 'error',
                  code: 'DEVICE_REVOKED'
                })
              );

              socket.destroy();

              return;
            }


            /*
             * ----------------------------------------------------
             * 4. Determine whether this is a new or trusted device
             * ----------------------------------------------------
             */

            const existing =
              this.state.peers[msg.deviceId];

            const isTrusted =
              Boolean(existing?.trusted);


            /*
             * ----------------------------------------------------
             * 5. Create/update peer
             * ----------------------------------------------------
             *
             * Existing device:
             *     trusted = true
             *     update lastSeen
             *
             * New device:
             *     create peer
             *     trusted = true
             *
             * Therefore successful PIN pairing automatically
             * establishes trust.
             */

            peer = {
              id: msg.deviceId,
              socket,
              address: socket.remoteAddress
            };

            this.sockets.set(
              peer.id,
              socket
            );


            const now = Date.now();

            this.state.peers[peer.id] = {
              id: peer.id,

              name:
                msg.name ??
                existing?.name ??
                peer.id,

              address:
                socket.remoteAddress,

              trusted: true,

              // Preserve the original pairing time
              firstSeen:
                existing?.firstSeen ??
                now,

              // Update every successful connection
              lastSeen: now
            };


            saveState(this.state);


            /*
             * ----------------------------------------------------
             * 6. Tell client whether this was a new pairing
             *    or a trusted-device reconnect.
             * ----------------------------------------------------
             */

            socket.write(
              line({
                type: 'auth.ok',

                protocol: PROTOCOL,

                hubId: this.id,

                salt: this.state.salt,

                trusted: true,

                reconnect: isTrusted
              })
            );


            if (isTrusted) {

              console.log(
                `\n[RECONNECT] Trusted device ${peer.id} ` +
                `from ${socket.remoteAddress}`
              );

            } else {

              console.log(
                `\n[PAIR] New trusted device ${peer.id} ` +
                `from ${socket.remoteAddress}`
              );
            }
          }
        }
      } catch (e) {
        socket.write(line({ type: 'error', code: 'BAD_MESSAGE' }));
      }
    });
    socket.on('close', () => {
      if (peer) this.sockets.delete(peer.id);
    });
    socket.on('error', () => { });
  }

  handleApplication(payload, fromId) {
    if (payload.type !== 'clipboard.push') return;
    if (!payload.hash || payload.hash === this.lastHash) return;
    this.lastHash = payload.hash;
    console.log(`[CLIPBOARD] ${fromId} → ${payload.contentType} ${payload.content?.length ?? 0} bytes`);
    try { setClipboard(payload.content); } catch { }
    for (const [id, socket] of this.sockets) {
      if (id === fromId) continue;
      const envelope = encryptObject(payload, this.state.pin, this.state.salt);
      socket.write(line({ type: 'secure', envelope }));
    }
  }

  pushFromHub(payload) {
    if (!payload.hash || payload.hash === this.lastHash) return;
    this.lastHash = payload.hash;
    try { setClipboard(payload.content); } catch { }
    for (const socket of this.sockets.values()) {
      socket.write(line({ type: 'secure', envelope: encryptObject(payload, this.state.pin, this.state.salt) }));
    }
  }

  devices() {
    return Object.values(
      this.state.peers ?? {}
    ).map(peer => ({
      ...peer,

      // Make sure CLI always has a clear status
      status: peer.trusted
        ? 'TRUSTED'
        : 'KNOWN'
    }));
  }

  revoke(id) {

    /*
     * IMPORTANT:
     *
     * Do NOT only delete the peer.
     *
     * If we only delete peers[id], the device can simply
     * join again because it still knows the PIN.
     *
     * Therefore we maintain a persistent revoked list.
     */

    if (!this.state.revokedDevices) {
      this.state.revokedDevices = [];
    }


    /*
     * Avoid duplicate IDs in revokedDevices.
     */

    if (
      !this.state.revokedDevices.includes(id)
    ) {
      this.state.revokedDevices.push(id);
    }


    /*
     * Remove from the currently trusted device list.
     */

    delete this.state.peers[id];


    /*
     * Persist BEFORE disconnecting.
     *
     * This guarantees that even if the client immediately
     * tries to reconnect, the Hub already knows it is revoked.
     */

    saveState(this.state);


    /*
     * Disconnect active session if it exists.
     */

    const socket =
      this.sockets.get(id);

    if (socket) {
      socket.destroy();
    }

    this.sockets.delete(id);


    console.log(
      `[REVOKE] Device ${id} has been revoked`
    );
  }
}

function osName() {
  return `UC-HUB-${os.hostname().slice(0, 8)}`;
}
