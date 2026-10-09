# Received clipboard history

This implementation follows [the approved handoff](handoffs/CLIPBOARD-HISTORY-HANDOFF.md).
History contains the latest **five successfully received entries**, across text,
PNG images and generic files. Locally copied or outgoing content does not add a
second receipt entry. A send of 1–64 files is one entry, published only after all
members match the batch manifest and pass SHA-256 verification. Zero-byte files
are supported; directories are rejected. Failed, cancelled and incomplete work
does not append or evict successful history.

## Desktop commands

Run the host/client with `uc start` (or `uc host`/`uc join`) before using control
commands from another terminal:

```powershell
uc history
uc history usage
uc history copy ENTRY_ID
uc history open ENTRY_ID
uc history save ENTRY_ID C:\Users\YOUR_NAME\Downloads\Clipboard
uc history release ENTRY_ID
uc history budget 32768
```

`copy` restores the text, image or entire file list. Explicit copying works while
automatic synchronization is paused. `open` starts the platform file opener and
pins the entry; close all applications reading those files **before** `release`.
External application lifetime cannot reliably be inferred, so these pins survive
service restarts until explicit release. `save` creates permanent copies without
overwriting existing files; duplicate names get numeric suffixes.

`uc send-file <files...>` and `uc send-clipboard` now use an explicit batch. On
Windows, received files are published as CF_HDROP; Linux uses the native library's
file-list clipboard formats. Desktop now auto-sends newly copied file selections
by default; `uc auto-files off` restores explicit sending only. A receiving application must
support the relevant paste format. Update both endpoints for batch support;
older receivers reject the new extension rather than silently accepting part of
a batch. Android still sends a single readable content URI per SEND operation.

## Automatic desktop file copy

With a running host/client, Copy 1–64 regular files in Explorer/File Manager.
The watcher checks every 500 ms, validates names/sizes, computes SHA-256 and sends
a batch to the other connected devices through the authenticated Hub relay.
It supports all file extensions; folders and files over 10 GiB are rejected.
Each receiver validates its own limits and storage before accepting its manifest
(Android: 256 MiB per member). This checks transport eligibility, not whether a
chat application supports pasting that file. No browser/application capability
detection is attempted.

`uc auto-files on|off` persists the setting; `uc status` reports it. `uc pause`
also suspends automatic file sending. Existing clipboard contents are ignored at
startup; identical file-list paths are not resent on every poll. To send the same
selection again explicitly, use `uc send-clipboard`. A rejected selection is
logged once, with no polling loop creating repeated jobs. Receiver-published
clipboard content is marked locally to suppress echo. Failed outgoing jobs remain
available in `uc transfers` / `uc resume`; offline devices not present at the
initial fan-out do not receive a queued copy automatically.

The current sender sends one recipient batch at a time through Hub; this is not a
single uploaded copy cached and independently redistributed by Host. Clipboard
changes while hashing/transferring are observed after that transfer finishes;
intermediate selections can be missed. Automatic sending still needs the service
running in a desktop session. Android's SEND behavior is unchanged.

## Android actions

Open **History** from the app. Each entry offers Copy, Open, Share and Save.
For a multi-file entry, Open lets you select one member; Share includes all members
with read-only URI grants. Save exports to `Downloads/Universal Clipboard` using
MediaStore. The received notification also offers Open / Share / Save. Text's
Open action uses the system text share chooser.

Files and images use a private read-only `.history` ContentProvider. Its URIs
carry original display filenames, MIME and sizes; the clipboard and share intents
grant readers access. Applications which cannot paste an attachment can use
Open or Share instead. URI grants do not grant write access.

## Storage and recovery policy

| Policy | Desktop | Android |
| --- | --- | --- |
| Default temporary storage budget | 32 GiB | 1 GiB |
| Configurable budget | `uc history budget <MiB>`; startup `UC_HISTORY_BUDGET_BYTES` | History's Storage budget button, 256–65536 MiB |
| Disk free-space reserve | 256 MiB | 16 MiB |
| Per generic file limit | 10 GiB | 256 MiB |
| PNG limit | 32 MiB | 32 MiB and 16 million pixels |
| Unfinished incoming limits | 8 batches / 32 partial members | 4 transfers or batches |

The budget includes internal history payloads, retired pinned payloads, metadata
and partial files. Offers reserve future bytes, including the whole batch manifest.
Desktop admission conservatively reserves up to twice the incoming size for
copying and history publication. Existing permanent desktop receive-dir files and
Downloads exports are outside the cache budget, but actual disk free space is
checked. Raising a budget does not create free disk space.

Entry six logically retires the oldest active entry. Physical deletion waits for
clipboard, reader or open pins to end. Android additionally retains opened/shared
entries for at least 24 hours from their last lease; its current clipboard pin is
persistent. Cleanup runs during later history/receipt activity, rather than at an
exact expiration instant. Five visible entries therefore do **not** mean only
five physical payloads or an immediate fixed disk bound. Under pressure, new work
is rejected clearly; successful history is not sacrificed to fit a failed offer.
Use permanent Save and close/release readers, cancel unfinished transfers, or
increase the budget if appropriate.

Desktop stores atomic history index metadata and separate entry directories;
Android stores atomic metadata per entry and unique private payloads. Partial
transfers remain separate, with persisted offsets for resume. Replay of a
completed transfer/batch returns its durable result and avoids creating another
entry or replacing a newer clipboard. Failed clipboard publication is reported
as `clipboardError`; validated history remains available for Copy again.

Neither eviction nor cancellation deletes permanent desktop receive-dir files,
Android Downloads exports, or previously received user files. Existing Android
`.images` provider behavior is preserved for older references. This change keeps
UCP/2 encryption, QR per-device credentials, manual PIN pairing, manual Join after
QR scan, focused SEND, progress timing and STOP behavior.

## Verification

`npm test` covers framing/authentication/resume plus history persistence, FIFO,
source replay, pinned cleanup, exports, budget reservations and batch failures.
`scripts/clipboard-smoke.ps1` checks actual Windows text/PNG/file-list publication
through encrypted TCP and restores the prior clipboard afterward. Android's
`Smoke` and `HistorySmoke` instrumentation exercise the actual app/provider,
separate reader app and encrypted Node interoperation. Emulator and Windows
results do not establish physical phone Wi-Fi or Linux compatibility.
