# Demo acceptance checklist

Use two physical machines: Windows x64 and Linux x64 glibc in an X11 session. Install the same 0.2.0 tgz, run `uc doctor`, then create/join a group with `uc setup`. Keep service terminals open and use another terminal for commands.

1. Copy Thai/English text and a URL both ways; paste into an editor. Check no echo loop.
2. Copy an actual screenshot/image both ways; paste into an image-capable application. Check dimensions and appearance.
3. Send an empty file, PDF, PNG and large video with `uc send-file`. Send from the Hub too.
4. Compare source/received SHA-256 with PowerShell `Get-FileHash` or Linux `sha256sum`.
5. Send a filename twice; verify the first file is unchanged and the second is renamed.
6. With a third endpoint, test `--to ID` and `--to all`.
7. Disable receiver Wi-Fi briefly during a large transfer; re-enable. Expect nonzero resume offset and matching final hash.
8. Repeat with sender disconnect and Hub restart, using the same saved profiles.
9. Stop sender/receiver during transfer. Start both, run `uc resume`. Check nonzero `resumedBytes`.
10. Test `uc pause` / `uc unpause` with newly copied content.
11. Revoke a client from the Hub. Confirm disconnect and DEVICE_REVOKED on reconnect.
12. Wrong PIN, missing file and offline recipients must never report false completion.
13. A second `uc start` for the same profile must report already running without disrupting the first.
14. Restart from a different working folder; pairing and settings must persist.

## Verification performed during development

- Windows, Node 22.17.0: 14 tests passed using `node --test --experimental-test-isolation=none`.
- Real localhost TCP endpoints, independent identities/storage, injected clipboards.
- Receiver/sender disconnect, Hub restart, fresh endpoint objects using persisted data, final ACK loss, checksum rejection, traversal, malformed frames, wrong PIN, duplicate identity and revocation.
- Live service HTTP controls and automatic image/text polling.
- Native Windows clipboard: Thai/Unicode text and 2x2 PNG roundtrip passed, including stable repeated image reads. Original clipboard restored afterward.
- Native Linux and the physical Windows/Linux checklist still require the demo hardware.
- Supplied CI workflow has not been run remotely for this change.

Endpoint replacement tests model application restart, not power failure. Final SHA-256 prevents a damaged partial file from being reported as successful.
