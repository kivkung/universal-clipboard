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
Application requests require to=recipient ID. Hub overwrites from with authenticated sender ID. Recipient replies:
```json
{"type":"reply","to":"SENDER_ID","replyTo":"...","result":{}}
```
Or error="message" instead of result. Only accept replies matching both request ID and expected from. Hub marks offline-recipient errors retryable:true. Broadcast is sender-side fan-out to online devices, excluding self. Never trust an application senderId field.

## Clipboard text

```json
{"type":"clipboard.text","to":"...","requestId":"...","text":"...","hash":"..."}
```
Hash is lowercase SHA-256 over UTF-8 text, max 512 KiB. Verify hash, suppress duplicates, apply unless paused. Reply applied:true/false. Remember applied content to prevent echo. Android clipboard permission/lifecycle/background access belongs in the APK layer.

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

## Persistence

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
