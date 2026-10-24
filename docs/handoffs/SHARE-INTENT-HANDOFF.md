# Universal Clipboard 0.6.0 — Share Intent ส่งขึ้น Hub อัตโนมัติ

เอกสารส่งต่อสำหรับผู้ใช้และ agent อีกตัว — 24 ตุลาคม 2026

## สิ่งที่ทำแล้ว

มือถือแอนดรอยด์แชร์ข้อมูลจากแอปอื่นผ่าน share sheet ของระบบ (ACTION_SEND) แล้วแอปส่งขึ้น Host ทันทีโดยไม่ต้องคัดลอกลง clipboard ก่อน รองรับข้อความ/URL (EXTRA_TEXT), รูป (EXTRA_STREAM + MIME image/*) และไฟล์ทั่วไป (content URI อื่น) ใช้ข้อจำกัดเดิมของ Jobs: ข้อความ ≤512 KB, รูป ≤32 MiB / ≤16 ล้านพิกเซล, ไฟล์ ≤256 MiB, ครั้งละหนึ่งรายการ งาน history, batch, auto-files และ Internet mode ของ 0.5.0 ไม่ได้แก้

แอปยังไม่รองรับ ACTION_SEND_MULTIPLE (แชร์หลายรายการพร้อมกัน) ต้องแชร์ทีละรายการตามนโยบายเดิม

## ใช้งาน

1. จับคู่มือถือกับ Host ตามขั้นตอนเดิม (QR/PIN หรือคำเชิญ Internet) แล้วให้ foreground service ทำงานอยู่
2. ในแอปใดก็ได้ กด Share → เลือก **ส่งขึ้น Host** (Universal Clipboard)
3. หน้าต่างสั้น ๆ ขึ้นมา ("กำลังส่งขึ้น Host…") แล้วปิดเอง ความคืบหน้าอยู่ที่ notification เหมือน SEND ปกติ ข้อความไปวางบน clipboard ของ Host ส่วนไฟล์/รูปไปที่โฟลเดอร์รับของ Host

ถ้ายังไม่ได้จับคู่ แอปจะเปิดหน้าตั้งค่าให้ Join ก่อน ถ้ากำลังส่งงานอื่นอยู่จะแจ้งให้ดูความคืบหน้าใน notification แทน

## พฤติกรรมสำคัญ

- ไม่อ่าน/ไม่เขียน clipboard มือถือของผู้ส่งเลย — ข้อมูลมาจาก intent โดยตรง
- URI ที่แชร์มาต้องเป็น `content://` ที่ให้สิทธิ์อ่านชั่วคราวกับ Activity แอปคัดลอกไบต์เข้า private storage ก่อนปิด Activity จึง resume ต่อได้แม้ grant หมดอายุ
- Share ระหว่างมีงานค้าง (หยุดกลางคัน) จะแทนที่ job เก่าที่ยังไม่ได้ส่ง ส่วน SEND จาก clipboard เดิมยังยึด job เดิมไว้
- FLAG_GRANT_READ_URI_PERMISSION ใช้เฉพาะขณะ Activity มีชีวิต ไม่มี URI ชั่วคราวถูกเก็บเป็นแหล่ง resume

## ไฟล์ที่แก้ / เพิ่ม

- `android/src/com/kivkung/universalclipboard/ShareActivity.java` (ใหม่): รับ ACTION_SEND, ตรวจ config/busy, capture แล้วสั่ง SEND
- `android/src/com/kivkung/universalclipboard/Jobs.java`: แยก `capture(Context, CharSequence, Uri, boolean, Config)` ให้ clipboard path และ share path ใช้ logic เดียวกัน (decode PNG / generic file / text)
- `android/src/com/kivkung/universalclipboard/ClipboardService.java`: PREPARE รับ label เพิ่มเพื่อแยกข้อความสถานะ "กำลังอ่านข้อมูลที่แชร์…" จาก "กำลังอ่าน clipboard…"
- `android/AndroidManifest.xml`: ShareActivity exported พร้อม intent-filter SEND */* label "ส่งขึ้น Host", versionCode 8, versionName 0.6.0
- `package.json` / `package-lock.json`: version 0.6.0 ให้ build script ตรงกัน
- `android/test/Smoke.java`: shareTests ครอบคลุมแชร์ข้อความ (ยืนยันค่าที่ Host ได้รับจริงผ่าน test mode read), รูป, ไฟล์ทั่วไป และ intent ว่าง
- `android/test/host.mjs`: test mode `read` คืน clipboard ปัจจุบันของ Host endpoint เพื่อยืนยันเนื้อหา
- คู่มือ: `README.md`, `android/README.md` และเอกสารนี้

## ผลตรวจสอบ

- Desktop `npm test` 38/38 ผ่าน (การแก้ครั้งนี้ไม่แตะ src ฝั่ง Node)
- Android instrumentation tests ใหม่ (shareTests) เขียนแล้วแต่ยังต้องรันบน emulator ด้วยขั้นตอนเดิม: `node test/host.mjs`, build test APK, `adb install -t`, `adb reverse tcp:33030 tcp:33030`, `am instrument -w …/Smoke` — ยังไม่ได้รันจริงในสภาพแวดล้อมที่ไม่มี emulator/SDK ณ ที่ทำงาน
- ยังไม่ได้ทดสอบบนมือถือจริงและ share sheet ของแอปจริง (Chrome, Gallery, Files) ต้องตรวจบนอุปกรณ์จริงก่อนอ้างว่าใช้งานได้

## ข้อจำกัดและงานต่อ

- ไม่รองรับ ACTION_SEND_MULTIPLE และโฟลเดอร์
- แคปชันข้อความที่แนบมากับรูป (EXTRA_TEXT พร้อม EXTRA_STREAM) ถูกละเว้น ส่งเฉพาะไฟล์/รูป
- ถ้าระบบฆ่า Activity ก่อนคัดลอกไบต์เสร็จ (หายาก) จะเห็น error ใน toast ต้องแชร์ใหม่
- APK ต้อง build ด้วย key เดิมจึงอัปเดตทับได้ (ดูหมายเหตุ signing ใน INTERNET-TUNNEL-HANDOFF)
- Physical-device verification และ real share-sheet interop ยังเป็นงานต่อ

## ให้ agent อีกตัวอ่าน

อ่านเอกสารนี้, `INTERNET-TUNNEL-HANDOFF.md` และ `CLIPBOARD-HISTORY-HANDOFF.md` ก่อนแก้ อย่าเปลี่ยนพฤติกรรม resume/history/batch เดิม ตรวจ source ปัจจุบันเสมอ
