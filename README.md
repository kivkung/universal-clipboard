# Universal Clipboard LAN — Terminal MVP

A terminal-first, local-only Universal Clipboard prototype for an Introduction to Computer Networking project.

## Architecture

```text
                         LOCAL LAN

                 ┌──────────────────────┐
                 │      HOST PC         │
                 │                      │
                 │  Clipboard Adapter  │
                 │        +             │
                 │  Local Hub/Server   │
                 └──────────┬───────────┘
                            │ TCP 3000
              ┌─────────────┼──────────────┐
              │             │              │
              ▼             ▼              ▼
           Windows        Linux         Android
           Client         Client         Termux
                                           ▲
                                           │
                                         Easer
                                       (trigger only)
```

The host is both a clipboard client and the local Hub/server. Other devices join a local clipboard group using a 6-digit PIN.

## Current MVP

- Local LAN only; no cloud or Internet dependency.
- Host PC acts as both Hub and local clipboard client.
- TCP application connection on port `3000`.
- UDP LAN discovery on port `3001`.
- 6-digit PIN for group authentication.
- AES-256-GCM encrypted application messages.
- PIN is converted to an encryption key with `scrypt`; the raw PIN is not used directly as an AES key.
- SHA-256 content hash for duplicate / echo-loop prevention.
- Multi-device 1 → N clipboard routing.
- Terminal CLI for discovery, joining, status, devices, revoke, and push.
- Text/URL clipboard first. Image/file transfer is intentionally left for the next phase.
- Android design: Easer should trigger a Termux command; Termux is the actual networking client.

## Why this is a good networking testbed

The MVP lets you observe:

1. LAN discovery (UDP broadcast)
2. TCP client/server connections
3. IPv4 addressing
4. TCP source/destination ports
5. Application-layer messages
6. Encryption overhead
7. Multi-device routing at the application layer
8. Failure/reconnect behavior

Use Wireshark to inspect the traffic. The application payload should not be readable on the wire because it is encrypted.

## Requirements

- Node.js 20+ recommended
- All devices on the same LAN for the first test
- Windows/Linux: Node.js and npm
- Android: Termux + Node.js for the client side

## 1. Install

```bash
npm install
```

## 2. Start a Host

On the machine that will be the Hub:

```bash
npm run host
```

The host will print its LAN addresses and a random 6-digit PIN.

Example:

```text
Universal Clipboard LAN
ROLE: HUB + CLIENT
TCP : 3000
DISCOVERY : UDP 3001
PIN : 483921

Waiting for devices...
```

Keep this terminal running.

## 3. Discover the Host

On another machine:

```bash
npm run discover
```

You should see something like:

```text
Found Hub: UC-HUB-AB12
IP: 192.168.1.37
TCP: 3000
```

If UDP broadcast is blocked on the network, use the host IP directly with `join`.

## 4. Join

```bash
npm run join -- 192.168.1.37 3000 483921
```

After successful pairing, the client stores its local state under `data/client.json`.

## 5. Watch Clipboard

On the host and each client:

```bash
node src/cli.js watch
```

Now copy text on one machine. Other connected devices should receive it.

For a first test, use simple text such as:

```text
Hello Networking
```

## 6. Useful Commands

```bash
node src/cli.js discover
node src/cli.js status
node src/cli.js devices
node src/cli.js push "Hello from CLI"
node src/cli.js watch
node src/cli.js revoke DEVICE_ID
```

On a joined client, `status` shows the configured Hub and local device ID.

## Android / Termux

The Android client is deliberately designed so that Easer is only a trigger. Termux owns the networking process.

Conceptual flow:

```text
Android Clipboard
      ↓
Easer trigger
      ↓
Termux command
      ↓
Universal Clipboard client
      ↓
TCP → Hub
```

For an initial Android networking test, first run the client manually in Termux. Once the network path works, connect Easer to the same command.

A typical Easer action can invoke a shell command equivalent to:

```bash
node ~/universal-clipboard/src/cli.js push "$(termux-clipboard-get)"
```

The exact Easer configuration is intentionally kept outside the core networking code because Android automation behavior depends on the device/ROM and installed plugins.

## Security model for the MVP

```text
6-digit PIN
    ↓
Pairing authentication
    ↓
PBKDF/scrypt derivation with group salt
    ↓
AES-256-GCM application encryption
```

The PIN is not a high-entropy secret. This MVP is intended for a controlled LAN/project demonstration, not production security.

## Important MVP limitations

- Text/URL is the primary clipboard type.
- Image and generic-file transfer are not implemented yet.
- Trusted-device persistence is intentionally lightweight; revoke removes a known device from the current Hub state.
- There is no cloud account, Internet relay, or iOS support.
- UDP discovery can fail on networks that block broadcast traffic.
- Clipboard polling is used for desktop testing; Android should use an automation trigger rather than relying on background clipboard polling.
- Large-file direct source → destination transfer is Phase 2.

## Suggested test plan

### Test A — Basic LAN

1. Start Hub.
2. Discover Hub from another machine.
3. Join with PIN.
4. Start `watch` on both sides.
5. Copy text.
6. Confirm the remote clipboard changes.

### Test B — Multi-device 1 → N

Join two or more clients and copy text on the Hub. Confirm all clients receive it.

### Test C — Wireshark

Capture TCP traffic while copying text. Record:

- Source IP
- Destination IP
- Source port
- Destination port
- TCP handshake
- Packet sizes
- Timing

The application payload should be encrypted.

### Test D — Discovery

Capture UDP discovery packets and explain broadcast behavior on the LAN.

### Test E — Failure

Try:

- Hub stopped
- Wrong PIN
- Wrong IP
- TCP port blocked
- Wi-Fi disconnected

Document symptom → hypothesis → test → result.

## Project direction

The intended story is:

```text
Clipboard
   ↓
Application Protocol
   ↓
TCP / Port
   ↓
IPv4
   ↓
LAN / ARP / MAC / Ethernet
   ↓
Physical / Wi-Fi
   ↓
Wireshark
   ↓
Measurement + Troubleshooting
```

Do not add direct large-file transfer until the text clipboard networking path is stable.

## Discovery troubleshooting

The client now sends discovery packets to both `255.255.255.255` and the calculated IPv4 broadcast address of each active interface. This is especially useful on Windows Mobile Hotspot / Internet Connection Sharing networks such as `192.168.137.0/24`, where the interface broadcast is normally `192.168.137.255`.

When running `npm run discover`, the CLI prints the broadcast targets it is using. If discovery still fails but `npm run join -- <hub-ip> 3000 <pin>` works, the TCP service is healthy and the remaining issue is specifically UDP discovery/firewall/AP isolation.

For Windows, allow inbound UDP port 3001 for testing:

```powershell
New-NetFirewallRule -DisplayName "Universal Clipboard UDP 3001" -Direction Inbound -Protocol UDP -LocalPort 3001 -Action Allow
```

