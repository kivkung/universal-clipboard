#!/usr/bin/env node
import { Hub } from './hub.js';
import { Client, discover } from './client.js';
import { loadState, saveState, deviceId } from './state.js';
import { getClipboard, setClipboard, platformClipboardHint } from './clipboard.js';
import { clipboardMessage } from './protocol.js';

const [cmd, ...args] = process.argv.slice(2);

function usage() {
  console.log(`
Universal Clipboard LAN

Commands:
  host                         Start Local Hub + clipboard endpoint
  discover                     Find Hub(s) on the LAN
  join <ip> <port> <pin>       Join a Hub
  status                       Show local configuration
  devices                      Show trusted/known devices (Hub only)
  revoke <deviceId>            Revoke a device (Hub only)
  push [text]                  Send text to the current Hub / Hub peers
  watch                        Watch local clipboard and sync changes
`);
}

async function main() {
  if (cmd === 'host') {
    const hub = new Hub();
    hub.start();
    await watchLoop(hub);
    return;
  }

  if (cmd === 'discover') {
    const hubs = await discover();
    if (!hubs.length) return console.log('No Hub found. Check that devices are on the same LAN and UDP broadcast is allowed.');
    for (const h of hubs) console.log(`Found Hub: ${h.name ?? h.hubId}\n  IP: ${h.address}\n  TCP: ${h.port}\n  Hub ID: ${h.hubId}\n`);
    return;
  }

  if (cmd === 'join') {
    if (args.length < 3) return usage();
    const [host, port, pin] = args;
    const client = new Client({ host, port, pin });
    await client.connect();
    console.log(`Device ID: ${client.id}`);
    console.log('Run `node src/cli.js watch` in this terminal to sync clipboard changes.');
    // Keep connection alive.
    await watchLoop(client);
    return;
  }

  if (cmd === 'status') {
    const s = loadState();
    console.log(JSON.stringify({
      deviceId: s.deviceId ?? deviceId(),
      role: s.role ?? 'unconfigured',
      hub: s.hub ?? null,
      platform: platformClipboardHint()
    }, null, 2));
    return;
  }

  if (cmd === 'devices') {

    const s = loadState();

    if (s.role !== 'hub') {
      return console.log(
        'This device is not configured as the Hub.'
      );
    }


    const peers =
      Object.values(s.peers ?? {});


    if (!peers.length) {

      console.log(
        'No trusted devices.'
      );

      return;
    }


    console.log(
      '\nTrusted Devices\n'
    );


    for (const peer of peers) {

      console.log(
        `ID:        ${peer.id}`
      );

      console.log(
        `Name:      ${peer.name}`
      );

      console.log(
        `Status:    ${peer.trusted ? 'TRUSTED' : 'KNOWN'}`
      );

      console.log(
        `Address:   ${peer.address}`
      );

      console.log(
        `First Seen:${new Date(peer.firstSeen).toISOString()}`
      );

      console.log(
        `Last Seen: ${new Date(peer.lastSeen).toISOString()}`
      );

      console.log(
        ''
      );
    }

    return;
  }

  if (cmd === 'revoke') {

    const id = args[0];

    if (!id) {
      return usage();
    }


    const s = loadState();

    if (s.role !== 'hub') {
      return console.log(
        'This device is not configured as the Hub.'
      );
    }


    /*
     * Check whether the device actually exists.
     */

    if (!s.peers?.[id]) {

      /*
       * It may already be revoked.
       */

      if (
        s.revokedDevices?.includes(id)
      ) {

        console.log(
          `Device ${id} is already revoked.`
        );

      } else {

        console.log(
          `Device ${id} not found.`
        );
      }

      return;
    }


    /*
     * Add device to persistent revoked list.
     */

    s.revokedDevices =
      s.revokedDevices ?? [];


    if (
      !s.revokedDevices.includes(id)
    ) {

      s.revokedDevices.push(id);
    }


    /*
     * Remove it from the trusted peer list.
     */

    delete s.peers[id];


    /*
     * Persist the change.
     */

    saveState(s);


    console.log(
      `Revoked ${id}.`
    );

    return;
  }

  if (cmd === 'push') {
    const text = args.length ? args.join(' ') : getClipboard();
    const s = loadState();
    if (s.role === 'hub') {
      // Reuse Hub in-process to send to connected peers.
      const hub = new Hub();
      hub.pushFromHub(clipboardMessage({ senderId: hub.id, text }));
      console.log('Hub push requires the Hub process to be running; use the host terminal or watch mode for the live session.');
      return;
    }
    if (!s.hub?.host) return console.log('No Hub configured. Use join first.');
    const client = new Client({ host: s.hub.host, port: s.hub.port, pin: s.pin });
    await client.connect();
    client.push(text);
    setTimeout(() => client.socket?.end(), 150);
    return;
  }

  if (cmd === 'watch') {
    const s = loadState();
    if (s.role === 'hub') {
      const hub = new Hub(); hub.start(); await watchLoop(hub); return;
    }
    if (!s.hub?.host || !s.pin) return console.log('No Hub configured. Use join first.');
    const client = new Client({ host: s.hub.host, port: s.hub.port, pin: s.pin });
    await client.connect(); await watchLoop(client); return;
  }

  usage();
}

async function watchLoop(node) {
  let last = '';
  try { last = getClipboard(); } catch { }
  console.log('Clipboard watcher running. Press Ctrl+C to stop.');
  setInterval(() => {
    try {
      const current = getClipboard();
      if (current !== last) {
        last = current;
        const payload = clipboardMessage({ senderId: node.id, text: current });
        if (node instanceof Hub) node.pushFromHub(payload);
        else node.push(current);
        console.log(`[LOCAL COPY] ${current.length} bytes`);
      }
    } catch (e) { }
  }, 500);
}

main().catch(err => { console.error(`[ERROR] ${err.message}`); process.exitCode = 1; });
