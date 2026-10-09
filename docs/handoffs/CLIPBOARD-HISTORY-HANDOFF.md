# Universal Clipboard: approved implementation handoff

Date: 2026-10-08. User approved the following scope across the project and requested sharing it with the agent currently working in VS Code. This file records agreed requirements; it does not mean the implementation below is complete.

## Working repository

User delivery/working directory:
`C:\Users\kivku\OneDrive\Documents\2T1\SC362003 Introduction to Computer Networking\project\Universal-Clipboard-LAN\universal-clipboard`

Prepared 0.4.0 source also exists in this chat's workspace under `work/submission-review-2026-10-04`. Inspect current destination changes before editing; another agent may be working there. Preserve existing work and coordinate file ownership.

## Current baseline

- Node desktop CLI, TCP hub/client, PIN or terminal QR pairing, AES-256-GCM sessions, chunked transfers, SHA-256 validation and persistent resume.
- Desktop can send arbitrary regular files; copied file selections 1–64 files, maximum 10 GiB per file. No direct folders. Generic received files currently go to receive-dir, not a file-list clipboard.
- Android native Java app, configuration IP/PIN/device name/Join Host; SEND notification opens focused capture Activity; minimum progress display one second; STOP stops the app's own running service/work.
- Android sends clipboard text/images and a single readable content URI generic file (up to 256 MiB and available storage) to Host. No universal file-manager compatibility and no generic file-picker/share flow yet.
- Android currently receives Host text/images only. Generic incoming files and generic clipboard publication need implementation.
- Windows native transfer smoke passed; Node 18 tests passed; Android emulator 47 checks passed on delivered 0.4.0. These are prior results, rerun relevant checks after changes. Physical Nothing Phone 3a and Linux remain unverified.

## Newly approved requirements

1. Add generic incoming file support on Android. Receive bytes to local storage, validate complete hash, expose a local content URI via a read-only provider with correct MIME/filename/size and grants. Publish it to Android clipboard where appropriate.
2. Desktop receive: publish completed local file paths in the OS file-list clipboard, including Windows CF_HDROP / supported Linux file-list formats. Applications must support pasting those formats; do not promise every Android application can paste arbitrary attachments.
3. Add persistent history of the latest FIVE successful clipboard/transfer entries: text, image, generic files. A multi-file send counts as ONE entry (requires explicit batch identity/completion semantics; not one unrelated entry per file).
4. FIFO eviction: append only after successful receipt and validation; once entry six is committed remove oldest history entry. Use separate per-entry files; do not overwrite a shared payload path.
5. Keep in-progress/resumable partials separate from history and eviction. Failed/cancelled transfers must not create successful history entries or evict valid history.
6. Store metadata: stable entry ID, type/MIME, original display filename(s), sizes, timestamp, sender/device identity, local payload references. Persist atomically and recover after restart.
7. History actions as appropriate: Copy again, Open, Share (Android), Save permanently. Permanent user exports are outside temporary history storage and never deleted by history eviction. Do not turn existing user Downloads/receive-dir into an eviction cache or delete previously received user files.
8. Add an overall storage budget as well as five-entry limit. Exact defaults are NOT agreed yet; choose/document sensible configurable platform defaults preserving existing transfer limits where feasible, or clarify a conflict. Account for partials/pinned data/disk free space; reject clearly rather than silently corrupt/truncate files.
9. Protect clipboard-referenced and currently opened files. Logical history eviction and physical cleanup may differ; do not leave clipboard URIs/paths dangling. Handle delayed deletion/readers and crash recovery. Do not imply a fixed five-entry count guarantees an immediate hard disk bound when files are pinned; document policy.
10. Android received notification offers Open / Share / Save to Downloads so files remain usable when the target application has no attachment-paste support.

## Preserve project choices

- Simple setup: desktop Node/npm; mobile APK; no mandatory cloud server. Future remote connectivity is VPN; VPN and iOS are not implemented or part of this history task unless separately requested.
- Preserve QR per-device credentials, manual PIN compatibility, encryption, SHA-256, resume, focused Android clipboard capture, minimum one-second progress and STOP behavior.
- History UI must be understandable. Desktop can expose CLI history/list/copy/save actions to preserve CLI-first design; Android can have an in-app history screen.
- Do not access/copy/use the old APK private signing key without explicit user permission. Automatic approval previously rejected that action. Delivered 0.4.0 uses a new key and cannot update older differently signed APKs in place. Preserve existing keys; do not uninstall the user's physical-device app.
- Do not push GitHub without user authorization. Deliver important source/scripts/app artifacts in the requested working directory; user asked to omit ancillary release ZIPs/screenshots/test reports.

## Suggested acceptance checks

- Binary and zero-byte generic files arrive unchanged; safe names and MIME; malformed sizes/hash/path attempts rejected.
- Six successful entries retain latest five in correct order; failed transfer does not evict; restart preserves history; multi-file batch appears once and supports copying the full set.
- Clipboard publication points to local readable data; Windows Explorer paste and Android external-app URI read/grants tested.
- Eviction never removes user permanent exports, active clipboard payloads, open streams, or resumable partials. Storage pressure has an explicit policy.
- Test relevant Node/service/native clipboard and Android instrumentation paths. Report emulator vs physical-device coverage honestly.

## Coordination

Please read this file before implementation and report what files you will own. No history/generic-receive implementation was made in this chat yet. Both agents should use this document as the shared scope and update implementation status in project documentation, not assume that a proposed requirement is already implemented.
