# 0.5.0 — Local + Internet (9 ตุลาคม 2026)

Desktop package/lockfile และ Android versionName ตรงกันเป็น **0.5.0**, Android versionCode **7**. ไฟล์ build ล่าสุดอยู่ใน directory นี้: `universal-clipboard-lan-0.5.0.tgz` และ `universal-clipboard-0.5.0.apk`. Android build ตรวจเวอร์ชัน desktop ให้ตรงกันก่อน build เพื่อป้องกัน release สลับรุ่น

รวม source ปัจจุบัน: Local + Internet ผ่าน TLS/WSS และ Cloudflare Quick Tunnel, QR invitation, history 5 รายการ, batch และ auto-files. เก็บการเปลี่ยนแปลงเดิมทั้งหมดไว้ รอบ build นี้ Node **38 tests** ผ่าน; การทดสอบ emulator/Internet เดิมอยู่ใน `../docs/handoffs/INTERNET-TUNNEL-HANDOFF.md` ไม่ใช่การทดสอบมือถือจริงรอบใหม่

APK canonical ใช้ demo key ใน workspace นี้ (key ที่ใช้กับ canonical 0.4.0) ซึ่งต่างจาก APK 0.5.0 ที่ build แยกในอีกแชต อัปเดตทับได้เฉพาะ APK ที่ลายเซ็นตรงกัน ไม่ถอนติดตั้งแอปบนมือถือจริง

```powershell
npm install -g ./releases/0.5.0/universal-clipboard-lan-0.5.0.tgz
```

## Release 0.4.0 เดิม — Received history และรับไฟล์บน Android

## เพิ่ม automatic file copy บน workstation

เมื่อ desktop service ทำงาน Copy ไฟล์ครั้งเดียวแล้ว watcher ตรวจไฟล์ปกติ/ชื่อ/ขนาดและส่งเป็นชุดผ่าน Hub ไปยังเครื่องอื่นที่เชื่อมต่ออยู่ เปิดเป็นค่าเริ่มต้น ปิดด้วย `uc auto-files off` เปิดด้วย `uc auto-files on`; `uc pause` พักการส่งอัตโนมัติด้วย กันไฟล์ที่รับมาแล้วส่งวน งานถูกปฏิเสธไม่สร้าง job ซ้ำทุก poll และผู้รับตรวจ storage/manifest ก่อนรับ bytes ใช้ Hub relay เดิม ส่งต่อผู้รับทีละชุด ไม่ใช่ upload ครั้งเดียวเก็บบน Host แล้วกระจายอิสระ การวางในแอปแชทยังขึ้นกับแอปปลายทาง

ตรวจรอบนี้ Node **35 tests** ผ่าน และ Windows native automatic-copy smoke ผ่าน (Android APK ไม่เปลี่ยนจาก build versionCode 6)

## History build

Build ล่าสุดใช้ Android versionCode **6** และ key เดิมของ 0.4.0 ใน workspace นี้ คงการสแกน QR ที่เติมฟอร์มแล้วต้องกด Join เอง

- เก็บ history ล่าสุด 5 รายการที่รับสำเร็จ: ข้อความ รูป และไฟล์; หลายไฟล์ในหนึ่งชุดนับเป็นหนึ่งรายการ หลังตรวจ SHA-256 ครบทุกไฟล์
- Android รับไฟล์ทั่วไป/ไฟล์ว่างได้ พร้อม read-only content URI และ metadata; มี History และ Open / Share / Save to Downloads จาก notification
- Desktop ใส่ไฟล์ที่รับแล้วลง file-list clipboard และมี `uc history` / `copy` / `open` / `save` / `release` / `budget`
- แยกงานค้างออกจาก history; ส่งซ้ำหลังหลุดไม่เพิ่มรายการหรือทับ clipboard ใหม่; เก็บไฟล์ที่ clipboard/reader อ้างอิงอยู่ และไม่ลบสำเนาถาวรใน Downloads/receive-dir
- งบพื้นที่ปรับได้: desktop เริ่ม 32 GiB, Android 1 GiB รวมงานค้างและไฟล์ที่ยังถูกอ้างอิง หากไม่พอจะปฏิเสธชัดเจน

ตรวจ build ล่าสุด: Node **34 tests**, Windows clipboard จริง (text/PNG/multiple files ผ่าน TCP) ผ่าน, Android API 37 emulator **57 Smoke checks + 27 History checks** ผ่าน รวมชุดไฟล์จาก Node และ Downloads exports มือถือจริงผ่าน Wi-Fi และ Linux ยังไม่ได้ทดสอบ

ต้องอัปเดตทั้ง Host และ APK เพื่อใช้ file batch ดูคำสั่งและนโยบาย storage ใน `../docs/HISTORY.md`

## การแก้ QR และการเชื่อมต่อเดิม

- Android APK: versionName `0.4.0` ใช้ signing key เดิมของ build 0.4.0 ใน workspace นี้
- Scan QR / เลือกภาพ QR / วางคำเชิญ จะเติม IP, Port และคำเชิญไว้ในฟอร์มเท่านั้น ต้องกด **เชื่อมต่อ · Join Host** ก่อนบันทึกและเชื่อมต่อ
- หากรอจน QR หมดอายุก่อนกดเชื่อมต่อ แอปแจ้งให้สร้างและสแกน QR ใหม่
- แก้ Host ที่ตรวจด้วย credential เก่าแม้มือถือเดิมสแกน QR ใหม่ ทำให้เกิด `BAD_PIN` คำเชิญใหม่ที่ยังใช้ได้เปลี่ยน credential หลังตรวจ proof สำเร็จ; การใช้ซ้ำโดยเครื่องอื่นและอุปกรณ์ที่ถูก revoke ยังถูกปฏิเสธ
- หน้า Join โหลด credential ที่บันทึกล่าสุดสำหรับ reconnect เพื่อไม่ใช้ invitation ID เก่าจากหน้าจอเดิม

ต้องอัปเดตทั้ง APK และ Host เพื่อใช้การแก้จับคู่ซ้ำ:

```powershell
# จาก root ของ workspace; หยุด Host เดิมด้วย Ctrl+C ก่อน
npm install -g ./releas/universal-clipboard-lan-0.4.0.tgz
uc host
```

ติดตั้ง `universal-clipboard-0.4.0.apk` แล้วสแกน QR ใหม่ ตรวจข้อมูลและกดเชื่อมต่อภายใน 2 นาที หากมีหลาย network interfaces ใช้ `uc host --address <IP ของ Wi-Fi/LAN ที่มือถือเข้าถึงได้>` และเปิด terminal ค้างไว้

การตรวจสอบ:
- ทำซ้ำบั๊กจับคู่ด้วย QR ใหม่ได้ก่อนแก้ (`BAD_PIN`)
- หลังแก้ `npm test` ผ่านครบ 19 tests
- Build APK และตรวจลายเซ็นผ่าน
- Android API 37 emulator เชื่อมกับ Node Host จริง: QR decode, ไม่เชื่อมต่อ/ไม่บันทึกเองหลัง scan, กด Join แล้วเชื่อมต่อ, ข้อความ/ภาพ/ไฟล์, resume และรับ clipboard ผ่าน
- ตอนตรวจเครื่องจริง ADB ไม่พบมือถือ และช่วงตรวจล่าสุดไม่มี listener ของ Host ที่ TCP 3000 จึงยังยืนยันการเชื่อมต่อผ่าน Wi-Fi ของมือถือจริงไม่ได้

Source Android: `../android`; Source Host: `../src`
