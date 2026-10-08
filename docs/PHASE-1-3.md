# ฟีเจอร์ 1–3: วิธีใช้งานและแกนที่ต้องเข้าใจ

รุ่น 0.4.0 ต่อจาก main commit 3788db4 งานชุดนี้ครอบคลุมแก้ฐานเดิม, QR จับคู่ และ Copy ไฟล์ทั่วไป

## เริ่มใช้งาน

ติดตั้ง desktop ด้วย `npm install -g ./universal-clipboard-lan-0.4.0.tgz` แล้วเรียก `uc host` หรือ `uc start` ตาม profile เดิม เปิดอีก terminal เรียก:

```sh
uc qr
# ถ้ามีหลาย network interfaces:
uc qr --address 192.168.1.10
```

Android APK 0.4.0: เปิดแอป → Scan QR → อนุญาตกล้อง → สแกน QR ใน terminal → อนุญาต notification หากถูกถาม → Join อัตโนมัติ ถ้าไม่ใช้กล้อง มีปุ่มเลือกภาพ QR และวางคำเชิญในหน้าสแกน IP/PIN เดิมยังใช้ได้กับ profile ที่จับคู่ด้วย PIN

QR หมดอายุสองนาที ให้สร้างใหม่เมื่อหมดอายุ ขยาย terminal ให้เห็น QR ครบและมีขอบ อย่าโพสต์ QR ที่ยังใช้ได้สู่สาธารณะ มือถือ/คอมควรตั้งเวลาอัตโนมัติ คำเชิญบน Host เป็นตัวตัดสินอายุจริง; ตัวสแกนเผื่อความคลาดเคลื่อนเวลาฝั่งมือถือที่เดินช้าสูงสุดหนึ่งนาที

จับคู่ด้วย QR แล้วเครื่องใช้ credential เฉพาะอุปกรณ์ อย่ากรอก PIN กลุ่มทับ profile นี้เพื่อ reconnect ใช้ `uc start` หรือ Android Join โดยเว้น PIN ตามสถานะ QR ได้เลย หากต้องจับคู่ใหม่หลังถูก revoke ต้องใช้ตัวตนอุปกรณ์ใหม่ที่ผู้ดูแลอนุญาตอย่างตั้งใจ รุ่นนี้ไม่มี UI reset identity

## Copy ไฟล์ทั่วไป

Windows: เลือกไฟล์ใน Explorer แล้ว Ctrl+C Linux X11: Copy จาก file manager ที่เขียน clipboard file list ให้ backend อ่านได้ แล้วสั่ง:

```sh
uc send-clipboard
uc send-clipboard --to DEVICE_ID
```

รองรับ 1–64 local files, ไฟล์ว่าง, Unicode filename และ binary ทุกชนิด ไม่รองรับโฟลเดอร์ ไม่อ่าน URL เป็นไฟล์ออนไลน์ ไม่ตีความ text ที่เป็น path ว่าเป็นไฟล์ ไม่มีการส่งไฟล์อัตโนมัติเมื่อ Copy ไฟล์ เส้นทางเดิม `uc send-file <path>` ยังใช้งานได้

ผู้รับได้ไฟล์ใน Downloads/Universal Clipboard หรือ receive-dir ที่ตั้งไว้ ชื่อซ้ำจะเปลี่ยนชื่อ ไม่เขียนทับ และไม่เปลี่ยน clipboard ผู้รับ รุ่นนี้ยังไม่มี Ctrl+V วางไฟล์ใน Explorer ฝั่งรับโดยตรง

Android: ต้องเป็นแอปต้นทางที่ Copy ไฟล์เข้า clipboard เป็น **content URI พร้อมสิทธิ์อ่าน** การ Copy ชื่อไฟล์หรือ path เป็นข้อความจะส่งเป็นข้อความเช่นเดิม หาก file manager ไม่มีคำสั่ง Copy to clipboard ที่เป็น URI จะยังส่งด้วยวิธีนี้ไม่ได้ รุ่นนี้ยังไม่ได้เพิ่ม Share Sheet/ตัวเลือกไฟล์มือถือ

มือถือส่งครั้งละหนึ่งไฟล์ สูงสุด 256 MiB และต้องเหลือพื้นที่ว่างเผื่อ 16 MiB แอปสำเนาไฟล์ไป private storage ก่อนส่ง ไม่ผูกงาน resume กับ URI ชั่วคราวของแอปต้นทาง จึง STOP/เปิด Join เพื่อส่งงานเดิมต่อได้ รูปภาพยังใช้เส้นทาง PNG เดิม; Generic URI ที่ MIME ไม่ใช่ image ส่งเป็นไฟล์และรักษา byte ต้นฉบับ

## แกนการทำงาน 4 จุด

1. **Clipboard เป็นส่วนของ OS:** desktop backend อ่าน file list; Android Activity อ่าน ClipData และ content URI เมื่อได้ focus การเชื่อมเครือข่ายไม่ได้ให้สิทธิ์อ่านไฟล์เอง
2. **QR เป็นข้อมูลจับคู่:** QR ไม่มีไฟล์และไม่มี PIN ถาวร ภายในมี Host IP/port, Hub ID และ secret สุ่ม 256-bit ของคำเชิญครั้งเดียว ใช้ HMAC challenge-response เดิม โดย secret เป็น input ของ scrypt แทน PIN
3. **Credential กับ invitation มีอายุต่างกัน:** Host ใช้ invitation ได้สองนาที เมื่อจับคู่ผ่านจะเก็บ derived authentication key ตาม device ID; Android เก็บ secret ผ่าน Keystore และลบ invitation ID หลังยืนยันสำเร็จ อุปกรณ์จึง reconnect ได้โดยไม่ต้องสแกนอีก การขอซ้ำด้วย ID/secret ที่จับคู่แล้วรองรับกรณี auth.ok หาย แต่ ID ใหม่ใช้ QR เดิมไม่ได้
4. **File transfer เป็นเส้นทางเดิม:** `file.offer → offset → file.chunk/ACK → file.finish → SHA-256 → publish` ส่วน clipboard file reader เพียงส่ง path หรือสำเนา private ให้เส้นทางนี้ QR ไม่เปลี่ยนการส่งก้อนและ framing

## แก้ resume งานเก่าอย่างไร

ก่อนหน้า metadata ไม่อัปเดตเมื่อรับ chunk และ cleanup ลบ `.json` กับ `.part` ทีละไฟล์ตาม mtime งานที่เพิ่งรับเพิ่มจึงอาจเสีย metadata เก่าเมื่อ restart

รุ่นนี้อัปเดต metadata หลังเขียน/flush chunk และ cleanup พิจารณา metadata กับ partial เป็นคู่: จะลบทั้งคู่เมื่อทั้งสองไม่มี activity เกินเจ็ดวัน จึงรักษางานเก่าที่เพิ่ง resume แม้ metadata จากรุ่นเดิมยังมีอายุเก่า ไม่ลบไฟล์ output ที่รับเสร็จ

## Build และการส่งมอบ

Android source อยู่ใน `android/` โดยตรง ไม่ต้องเปิด source zip เพื่อแก้ไข:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File android/build.ps1
```

SDK/JDK/Bouncy Castle ตาม android/README.md; ZXing 3.5.3 pinned jar อยู่ใน vendor และ script ตรวจ SHA-256 ก่อน build โหลด assembly `System.IO.Compression` แล้ว จึงแก้ build error เดิมได้ การ Bypass ในตัวอย่างมีผลเฉพาะโปรเซส build ไม่เปลี่ยน policy ของเครื่อง

Signing key ไม่รวมใน source export การสร้างใหม่ครั้งแรกจะสร้าง demo key ท้องถิ่น หาก key ต่างจาก APK เดิม Android จะไม่ให้ update ทับ ต้องให้ผู้ดูแลใช้ key เดิมโดยได้รับอนุญาต การถอนแอปทำให้ข้อมูล private/การตั้งค่า/งานค้างหาย จึงไม่ควรทำอัตโนมัติบนมือถือจริง

## ขอบเขตที่ยังต้องทดสอบบนอุปกรณ์จริง

Test Node ครอบคลุม TCP/QR auth/resume/files ส่วน Windows native smoke ตรวจ file list จริง Android instrumentation ใช้ emulator และ Node Host; กล้องจริง Nothing Phone 3a และ file manager ของคุณต้องตรวจอีกครั้ง รวมถึง Linux X11 distro ที่จะใช้ ยังไม่ได้ทำ history, VPN หรือ iOS ในงานชุดนี้
