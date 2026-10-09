# UCP/2 interoperability contract

UTF-8 JSON; decimal JSON numbers. UCP/2 replaces ucp/0.1. Android implements this directly, without Node or Termux.

## Topology

TCP Hub defaults to 3000. Every device, including the Hub's clipboard endpoint, opens one authenticated connection. Persist device IDs (8–64 ASCII letters/digits/hyphens); names have at most 80 characters. Desktop local command control is not part of this wire protocol. Hub is trusted and decrypts/re-encrypts relayed data.

## Discovery

UDP broadcast to 3001:
```json
{"type":"uc.discover","protocol":"ucp/2"}
```
Reply:
```json
{"type":"uc.hub","protocol":"ucp/2","hubId":"...","name":"...","port":3000}
```
Use the source IP of the datagram. Always allow manual IP. Discovery is unauthenticated; pairing must verify Hub proof.

## Framing

4-byte unsigned big-endian payload length, 1-byte type 0x01, UTF-8 JSON payload. Length 1..2097152. Buffer fragmented frames and split coalesced frames. All UCP/2 data uses JSON, including base64 chunks; no 0x02 frames. Close on invalid framing, decryption, or sequence.

## Pairing and encryption

0.4 extension: a Host-local `uc qr` creates a two-minute invitation URI (`uvc://join?v=1&host=...&port=...&hubId=...&id=...&secret=...&expires=...`). `id` is 16 random bytes in hex; `secret` is 32 random bytes in hex. QR contains no group PIN. On first authentication derive K from the secret string using the same scrypt/salt below and include `inviteId` in `auth`. Host validates expiry, proof, and identity, consumes the invitation, and persists K for that device ID. Client persists secret securely and stops including inviteId after auth.ok. Established IDs authenticate with their individual K, never fall back to group PIN. A retry by that same ID/K can recover a lost auth.ok even if its invitation has been consumed; other IDs cannot reuse it. Invitation state is ephemeral and cleared on Host restart; established credentials persist with Host state. All framing/session/encryption remains UCP/2. This does not add end-to-end encryption or change the existing manual-PIN limitations.

Hub sends:
```json
{"type":"challenge","protocol":"ucp/2","nonce":"...","salt":"...","hubId":"..."}
```
Nonce is 32 random bytes, salt is 16 persistent random bytes, both unpadded base64url.

K = scrypt(UTF8(PIN), decoded salt, N=16384, r=8, p=1, dkLen=32).
Client sends:
```json
{"type":"auth","protocol":"ucp/2","deviceId":"...","name":"...","proof":"..."}
```
Proof is lowercase hex HMAC-SHA256(K, UTF8(nonce + ":" + deviceId)). Here nonce is the original base64url string. Never send PIN as a field.

Hub sends auth.ok with proof = hex HMAC-SHA256(K, UTF8("hub:" + nonce)). Client must verify it.
Session key S = raw HMAC-SHA256(K, UTF8("session:" + nonce)), 32 bytes.

Subsequent frames:
```json
{"type":"secure","envelope":{"iv":"...","tag":"...","data":"..."}}
```
AES-256-GCM under S, fresh random 12-byte IV per envelope, 16-byte tag, no AAD. IV/tag/ciphertext use unpadded base64url. Encrypted plaintext:
```json
{"seq":0,"body":{}}
```
Each direction has an independent sequence starting at 0. Increment per frame and reject any other sequence. Fresh handshake/key/counters on reconnect. Hub separately sequences each session. Authenticate the whole envelope before writing any decrypted file bytes.

Authentication errors: type=error, code=BAD_PIN / DEVICE_REVOKED / DEVICE_ALREADY_CONNECTED / PROTOCOL_MISMATCH / BAD_IDENTITY; then disconnect.
One connection per device. Handshake timeout 10s. Send encrypted body {"type":"ping"} every 10s; receive {"type":"pong"}. Idle socket timeout 30s.

Six-digit PINs permit offline guessing from captured proofs. This is a controlled-LAN demo, not a production PAKE. Revoke blocks a known ID; a PIN-holder can use another ID.

## Requests and replies

Fresh UUID requestId per request. Desktop request timeout 15 seconds.
List devices (no to):
```json
{"type":"devices","requestId":"..."}
```
Reply:
```json
{"replyTo":"...","from":"@hub","result":[{"id":"...","name":"...","online":true}]}
```
Application requests require to=recipient ID. Hub overwrites from and fromName with authenticated sender ID/name. Recipient replies:
```json
{"type":"reply","to":"SENDER_ID","replyTo":"...","result":{}}
```
Or error="message" instead of result. Only accept replies matching both request ID and expected from. Hub marks offline-recipient errors retryable:true. Broadcast is sender-side fan-out to online devices, excluding self. Never trust an application senderId field.

## Clipboard text

```json
{"type":"clipboard.text","to":"...","requestId":"...","text":"...","hash":"..."}
```
Hash is lowercase SHA-256 over UTF-8 text, max 512 KiB. Optional entryId is a stable 64-character lowercase hex receipt identity, namespaced by authenticated sender; legacy messages fall back to requestId. Verify hash, persist a received history entry, suppress replay, apply unless paused. Reply applied:true/false and historyId. Remember applied content to prevent echo. Android clipboard permission/lifecycle/background access belongs in the APK layer.

## Files and images

Random 32-byte lowercase hex transferId, stable for one resumable job. Compute full file SHA-256 before offering:
```json
{"type":"file.offer","to":"...","requestId":"...","transferId":"64 hex","name":"photo.png","size":12345,"hash":"64 hex","kind":"file"}
```
Kind=file or image. Image means PNG applied to clipboard after verified completion. Desktop limits: file 10 GiB, image 32 MiB / 16 megapixels. Reject unsafe paths/reserved names. Receiver state is keyed by authenticated sender + transferId. Reject changed metadata.

Reply offset:0 or offset:65536. If already complete: complete:true, offset:total size, path:receiver-local-path. Never interpret that path as a local sender path/command. Offset must be a multiple of 65536 unless equal to total size.

Chunk:
```json
{"type":"file.chunk","to":"...","requestId":"...","transferId":"...","offset":0,"sequence":0,"data":"standard padded base64"}
```
Decoded length exactly min(65536,size-offset); sequence=offset/65536. Envelope authenticates ID, sequence, offset and bytes together. Verify expected offset/sequence, append to private temporary file, flush, reply next offset. Sender waits for ACK before next chunk. After lost ACK re-offer and use actual receiver offset; do not blindly resend old chunks.

Finish:
```json
{"type":"file.finish","to":"...","requestId":"...","transferId":"..."}
```
Check total size and full SHA-256, publish with exclusive filename, never overwrite. Reply complete:true, offset:size, path:output only after success. Image clipboard application failure adds clipboardError while preserving saved file. Persist completion so retried offer/finish does not duplicate files. On checksum failure delete partial/metadata; never publish.

Cancellation uses type=file.cancel, to/requestId/transferId, returns cancelled:true. Deletes unfinished data/metadata but not completed output.

## File batches and received history extension

UCP/2 framing and encryption are unchanged. A batch is scoped to authenticated
sender + random 64-hex batchId and contains 1–64 generic regular files:

```json
{"type":"file.batch.offer","to":"...","batchId":"64 hex","count":2,"files":[{"transferId":"64 hex","name":"report.pdf","size":123,"hash":"64 hex","kind":"file","mime":"application/pdf"},{"transferId":"different 64 hex","name":"empty.dat","size":0,"hash":"SHA256 of empty bytes","kind":"file","mime":"application/octet-stream"}]}
```

Include requestId as with other requests. Transfer IDs must be unique in the
manifest. Receiver validates the whole manifest and reserves storage before
acceptance. Member file.offer adds batchId and zero-based index; every member's
name/size/hash/kind/MIME must match its manifest position. Existing chunk/finish
messages use the member transferId. Member completion validates/persists bytes
but does not publish clipboard or add successful history yet.

`file.batch.finish {batchId}` verifies all members and commits one durable history
entry, then publishes the entire file-list clipboard. Reply includes complete:true,
historyId and optional clipboardError. Persist that response; repeated batch
offer/finish returns completion without another publication. A missing/invalid
member causes an error, with no successful history append or eviction.

`file.batch.cancel {batchId}` discards unfinished batch work. Desktop permanent
receive-dir outputs are preserved, including completed members of a failed batch;
Android uncommitted private batch payloads can be removed. Successful batch
history is not cancelled. Standalone file.offer remains interoperable, optionally
including MIME. Android limits each generic incoming member to 256 MiB; desktop
keeps 10 GiB. Full batches are subject to each platform's available storage budget.

Successful receipt history uses independent payload references and FIFO five-entry
logical retention. Pins can delay physical deletion. See [HISTORY.md](HISTORY.md)
for storage policies, recovery and export actions. Older receivers without this
extension reject batch messages; update both endpoints for explicit file batches.

## Transfer persistence

Persist outgoing source path/URI, target, metadata, transferId. Android should persist content-URI permission for restart. Receiver persists partial and metadata; resume offset comes from actual bytes on disk. Discard an incomplete trailing chunk after interrupted writes. On reconnect, authenticate with new session key and re-offer same metadata. After sender restart verify source hash still matches. Desktop retries network errors up to 5 minutes, then keeps jobs for uc resume; partials expire after 7 days on startup.

Use full PNG byte SHA-256 for transfer integrity. For local image echo suppression, desktop hashes UTF8(width + ":" + height + ":") concatenated with decoded RGBA pixels, independent of PNG encoding differences.

## Reference

- src/crypto.js: derivation and envelopes
- src/protocol.js: frames
- src/hub.js: identity/routing
- src/client.js: requests/reconnect/outgoing persistence
- src/transfers.js: receiving
- test/core.test.js: real TCP/resume/tampering tests
- docs/crypto-vector.json: deterministic test-only crypto values for Android


### Host file redistribution

After a verified single file/image or complete batch is committed, Host forwards it to other currently connected devices, excluding itself and the authenticated source. An optional boolean `distribute` on `file.offer` / `file.batch.offer` defaults to forwarding when omitted (Android compatibility). Desktop all-target sends and Host relay jobs set it to false to prevent duplicate deliveries. A targeted send to Host is redistributed; a targeted send to another client remains targeted. Batch members are forwarded together after batch completion. Host receipt ACK confirms local acceptance, not delivery to every peer. Durable relay tasks and outgoing jobs preserve pending work; failed outgoing transfers can be continued with `uc resume`. Devices offline before target selection are not queued. Original filenames and MIME types are preserved, and deterministic relay IDs make receipt retries idempotent.
