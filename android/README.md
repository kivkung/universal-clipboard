# Universal Clipboard Android 0.4.0 demo

Native Android application (Java), Android 10+ / target API 35. No Node, Termux, keyboard replacement, overlay permission, accessibility service, or root needed on the phone.

## Use

1. Install the signed `../../releas/universal-clipboard-0.4.0.apk` on a test phone. A different signing key cannot update the old APK; preserve existing data and use the original key when authorized.
2. Run desktop UCP/2 Host 0.4.0 for QR pairing. Keep its terminal running. PIN pairing remains compatible with older UCP/2 Hosts.
3. Enter Host IPv4, its six-digit PIN, and the phone's device name. Port defaults to 3000; expand advanced settings only for a custom port.
4. Tap Join Host and allow notifications. Settings persist; the PIN is encrypted with Android Keystore and excluded from backups.
5. Copy text or an image, open notifications, tap SEND. A focused Activity captures a snapshot and closes itself; no second confirmation.
6. Notification progress remains visible for at least one second; success requires the Host's application acknowledgement. Image progress stays below 100% until verification/application completes.
7. STOP closes sockets, stops the foreground service, removes application tasks and terminates the application's own process. Nothing restarts automatically. Open the app and tap Join Host to use it again.

Host startup displays a QR automatically. Alternatively run `uc qr` in a second Host terminal, then tap **Scan QR**. Scanning only fills the form; review the IP/port/name and tap **เชื่อมต่อ · Join Host** to connect. No settings are saved and no new connection is started by scanning. Camera permission is requested only for scanning; selected QR images and pasted invitation text are supported. Join uses a two-minute one-use invitation and saves an encrypted per-device credential. No permanent group PIN is in the QR. Future joins use the saved credential. Re-scanning a fresh invitation for the same device replaces its credential after successful authentication; revoked IDs remain blocked.

Generic clipboard content URIs with readable grants can now be sent as files with SEND: one file at a time, up to 256 MiB and available private storage. They are copied into private storage before transfer for durable resume. Generic files are saved by the Host, not written to its clipboard. Copying a filename as text does not send the file. Multi-item clipboard selections are rejected explicitly. Folders and file-picker/share-sheet flows are not added in this phase.

The Host endpoint is selected from the authenticated connection's hub identity, not by name and not by broadcast. Android sends to the Host and now receives text and PNG clipboard images automatically from that same authenticated Host. Receiving writes the clipboard while the app is unfocused; it does not open an Activity or read the existing clipboard. Continuous background clipboard monitoring is not implemented.

## Transfers and lifecycle

- Text: UTF-8 up to 512 KiB. Images: readable clipboard content URI, converted to PNG, up to 32 MiB and 16 million pixels.
- Reads clipboard only in SendActivity.onWindowFocusChanged(true). Image bytes are copied into private storage while that Activity remains alive; transient clipboard URIs are not used as persistent sources.
- One persistent outgoing job at a time. A second SEND during transfer does not replace the snapshot.
- TCP reconnect/re-offer uses the same transfer ID, hash, recipient and immutable file. Source SHA-256 is checked before retry. The receiver chooses the resume offset.
- STOP retains an unfinished snapshot. Explicit Join Host resumes it. To discard it: STOP, open the app, tap the clear-pending link before joining.
- A pending transfer cannot silently move to a different Host. Clear the old job before changing destination.
- No boot receiver, sticky restart, alarms or persistent work scheduler. Android/OEM service termination may require opening the app and joining again.
- Android owns notification framing. Expanded view has device name, Host, SEND, STOP, state and progress; collapsed view has compact controls. The shade closes when launching the focused clipboard capture Activity.

## Build on Windows

Requirements: JDK 21, Android SDK platform android-36.1 and Build Tools 36.0.0, Bouncy Castle bcprov-jdk18on 1.79. This project uses platform APIs only and builds offline using aapt2, javac, D8, zipalign and apksigner; Gradle is not required.

```powershell
.\build.ps1 -Sdk 'C:\path\to\Android\Sdk' -Jdk 'C:\path\to\jdk' -BouncyCastle 'C:\path\to\bcprov-jdk18on-1.79.jar'
```

The script also detects default Android Studio and cached Bouncy Castle locations. Dependency: https://repo.maven.apache.org/maven2/org/bouncycastle/bcprov-jdk18on/1.79/

Output: `../../releas/universal-clipboard-0.4.0.apk`. A local `demo-signing.jks` is created on first build and excluded from Git/source exports. Keep it privately to sign compatible updates. Its demo password is `android`; this is not a production release key. The manifest is not debuggable. ZXing core 3.5.3 is pinned under vendor; its SHA-256 is verified by the build script. Required compression assemblies are loaded explicitly for Windows PowerShell.

## Source map

- `MainActivity.java`: setup, notification permission, Join, manual send, stop and discard-pending controls.
- `Config.java`: device identity and Keystore-encrypted saved PIN.
- `SendActivity.java`: focused clipboard capture; returns to the previous screen.
- `Jobs.java`: bounded image decode/PNG conversion and atomic private job persistence.
- `ClipboardService.java`: connected-device foreground service, reconnect loop, notifications and minimum progress duration.
- `Wire.java`: UCP/2 framing, scrypt, mutually checked PIN proof, AES-GCM and sequence checks. A dedicated reader handles incoming messages continuously while request replies are matched by ID and sender.
- `Transfer.java`: Host-only text and resumable chunked image delivery.
- `StopReceiver.java`: explicit whole-application shutdown.
- `res/layout/notification*.xml`: compact and expanded native notification controls.
- `test/`: separate test-only APK and Node test Host; never included in the shipped APK.

## Validation

The historical validation below describes 0.3.1. For 0.4.0 use the delivered test-results file and [phase guide](../docs/PHASE-1-3.md); physical Nothing Phone camera/Wi-Fi verification remains required.

Built, signed and installed on Android API 37 emulator (x86_64, 16 KiB page-size image). Instrumentation tests exercise the final APK against the real Node Hub/Client with an injected desktop clipboard adapter. Passed scrypt/HMAC/AES vectors, bad-tag rejection, bad PIN, Host-only text, forced disconnect after 65536 bytes, resume, completed re-offer, Keystore persistence, focused one-tap text/image capture and >=1 second progress.

Additional notification UI checks: real SEND PendingIntent, offline progress, reconnect delivery and STOP process/service termination. The physical Nothing Phone 3a and physical Wi-Fi environment have not been tested. Windows native clipboard had separate verification in the desktop work; Android interoperability tests use the injectable desktop adapter.

Test runner: start `node test/host.mjs`, build `test/build.ps1`, install both APKs (test APK needs `adb install -t`), grant notification permission, `adb reverse tcp:33030 tcp:33030`, then `adb shell am instrument -w com.kivkung.universalclipboard.test/com.kivkung.universalclipboard.Smoke`.

## Receiving added in 0.3.1

- `IncomingClipboard.java` accepts text and image transfers from the authenticated Host identity. Other peers are rejected; arbitrary files are not supported by this clipboard feature.
- Incoming text is size/hash checked and written with setPrimaryClip; no background getPrimaryClip call is made.
- Incoming PNG images are chunk-acknowledged after disk sync, checked for full SHA-256, PNG signature, successful decoding and <=16 million pixels before clipboard publication.
- Receiver state is keyed by authenticated sender + transfer ID. Partial files and completion records survive reconnect/restart, metadata changes are rejected, and incomplete trailing disk writes are discarded on re-offer.
- `ImageProvider.java` is non-exported, read-only, and allows per-URI grants so a separate app can paste the image. Local filenames are generated from transfer identity, never supplied network paths.
- Storage reserves at most 128 MiB / four unfinished images; old images may expire after seven days. The last published image is retained during cleanup. Completed re-offers do not reapply the image to the clipboard.
- Notification reports receiving progress, received text/image and errors. Existing SEND progress and STOP behavior remain.

Validation on API 37 emulator against the Node Host: QR decode, scan only fills the form without starting the service or saving new settings, explicit Join connects and stores the QR credential, background text receive, background PNG receive, reconnect resume at 65536 bytes, actual clipboard contents, pasting an image in a separate app through Android URI grants, rejection of non-Host sender/bad text hash/out-of-order chunks/non-PNG data. Outgoing text, image and generic content URI tests passed. Current APK versionCode=5 uses the local 0.4.0 signing key. Physical phone Wi-Fi connectivity remains unverified.
