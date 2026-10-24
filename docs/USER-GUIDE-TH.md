# คู่มือใช้งาน Universal Clipboard LAN 0.6.0

ระบบส่ง clipboard และไฟล์ระหว่างคอมพิวเตอร์กับ Android ผ่าน Host กลาง ใช้ได้ทั้งใน LAN และผ่าน Internet เมื่อเปิด tunnel บน Host ต้องเปิด Host และอุปกรณ์ที่ต้องการรับไว้ระหว่างใช้งาน

## 1. ติดตั้งบนคอมพิวเตอร์

ติดตั้ง Node.js 22 ขึ้นไป จากนั้นเปิด CMD หรือ PowerShell:

```powershell
node --version
npm install -g universal-clipboard-lan@latest
npm list -g universal-clipboard-lan --depth=0
uc --help
uc doctor
```

เวอร์ชันสำหรับคู่มือนี้คือ `0.6.0` หากเครื่องยังติดตั้ง `0.0.0-stage` ให้ติดตั้งเวอร์ชันจริงโดยระบุให้ชัด:

```powershell
npm install -g universal-clipboard-lan@0.6.0 --registry=https://registry.npmjs.org/ --prefer-online
```

## 2. เปิด Host ใน LAN

ให้อุปกรณ์อยู่ในเครือข่ายเดียวกัน เปิด terminal บนเครื่องที่จะเป็น Host:

```powershell
uc host --local-only
```

Host จะแสดง IP, PIN และ QR ให้เก็บ terminal นี้เปิดไว้ หาก Windows Firewall ถามสิทธิ์ ให้อนุญาต Node.js สำหรับเครือข่าย Private ที่ใช้งานอยู่ ค่าเริ่มต้น TCP port คือ 3000

อีกวิธีคือรัน `uc` หรือ `uc setup` ตั้งชื่อเครื่อง เลือก `h` แล้วเลือกการเชื่อมต่อแบบ local

## 3. เชื่อมต่อคอมพิวเตอร์อีกเครื่อง

ใช้ IP และ PIN ที่ Host แสดงจริง ตัวเลขด้านล่างเป็นตัวอย่าง:

```powershell
uc join 192.168.1.10 123456
```

หรือใช้ `uc setup` เลือก `j` แล้วเลือก Host หรือกรอก IP และ PIN หากใช้พอร์ตอื่น ให้เพิ่ม `--port <พอร์ต>` ทั้ง Host และ client

เมื่อเชื่อมต่อแล้วเก็บ terminal ไว้ เปิด terminal อีกหน้าต่างเพื่อดูสถานะ:

```powershell
uc status
uc devices
```

ครั้งถัดไปใช้ `uc start` เพื่อเปิดด้วยค่าที่บันทึกไว้ หยุด service ด้วย Ctrl+C ก่อนเปลี่ยน Host หรือการจับคู่

## 4. เชื่อมต่อ Android

1. ติดตั้ง `releases/0.6.0/universal-clipboard-0.6.0.apk` บน Android 10 ขึ้นไป มือถือไม่ต้องติดตั้ง Node.js
2. เปิดแอป แล้วเลือก **Scan QR** สแกน QR จาก terminal ของ Host
3. การสแกนจะกรอกข้อมูลให้เท่านั้น ตรวจข้อมูลและกด **เชื่อมต่อ · Join Host** เอง
4. อนุญาต notifications เพื่อใช้ปุ่ม SEND และดูสถานะ
5. หากไม่ใช้ QR ให้กรอก IP, PIN และชื่อมือถือเอง แล้วกด Join Host

QR ใช้ได้ 2 นาทีและสำหรับอุปกรณ์ใหม่หนึ่งเครื่อง หากหมดอายุให้เปิด terminal อีกหน้าต่างบน Host แล้วรัน:

```powershell
uc qr
```

หาก Host มีหลาย IP ให้เลือก IP ที่มือถือเข้าถึงได้:

```powershell
uc qr --address 192.168.1.10
```

หาก Android แจ้งว่าติดตั้งอัปเดตไม่ได้ อาจเป็นเพราะ APK เดิมกับ APK ใหม่ลงนามคนละ key อย่าถอนแอปก่อนเก็บข้อมูลสำคัญ การติดตั้งผ่าน npm อัปเดตเฉพาะ desktop ไม่ได้อัปเดต APK ในมือถือ

## 5. ส่งข้อความ รูป และไฟล์

### คอมพิวเตอร์

ขณะ service ทำงาน การ copy ข้อความหรือรูปที่ clipboard รองรับจะถูกตรวจและส่งอัตโนมัติ เลือกไฟล์ใน Explorer แล้วกด Ctrl+C เพื่อส่งไฟล์อัตโนมัติ รองรับ 1–64 ไฟล์ต่อชุด ไฟล์ทั่วไปสูงสุด 10 GiB ต่อไฟล์และขึ้นกับพื้นที่ว่าง ไม่รองรับโฟลเดอร์

หากต้องการส่งเองหรือเลือกผู้รับ ให้เปิด terminal อีกหน้าต่าง:

```powershell
uc auto-files off
uc send-clipboard --to DEVICE_ID
uc send-file "C:\path\report.pdf" "C:\path\photo.jpg" --to all
uc push "ข้อความทดสอบ"
```

ดู DEVICE_ID ด้วย `uc devices` เปิดส่งไฟล์อัตโนมัติกลับด้วย `uc auto-files on` คำสั่งนี้ควบคุมเฉพาะการตรวจไฟล์ที่ copy บนเครื่อง ไม่ใช่การส่งต่อไฟล์ที่ Host รับสำเร็จ

### Android

Copy ข้อความ รูป หรือไฟล์จากแอปต้นทาง แล้วกด **SEND** ในแอปหรือ notification การอ่าน clipboard ต้องผ่านหน้าต่างที่มี focus จึงอาจเห็นหน้าจอ capture ชั่วครู่ รอสถานะยืนยันจาก Host

หรือใช้ **Share โดยตรง (0.6.0)**: ในแอปใดก็ได้กด Share แล้วเลือก **ส่งขึ้น Host** ข้อความ/รูป/ไฟล์จะถูกส่งขึ้น Host ทันทีโดยไม่ต้อง copy ลง clipboard ข้อจำกัดเดิม: ครั้งละหนึ่งรายการ แชร์หลายรายการพร้อมกันยังไม่รองรับ ขณะมีงานกำลังส่งอยู่จะแจ้งให้ดูความคืบหน้าใน notification

มือถือส่งไฟล์ทั่วไปครั้งละหนึ่งไฟล์ สูงสุด 256 MiB และขึ้นกับพื้นที่ว่าง แอปต้นทางต้องใส่ content URI ที่อ่านได้ลง clipboard การเลือกไฟล์ในทุกแอปไม่ได้หมายความว่าจะ copy เป็นไฟล์ที่ระบบนี้อ่านได้เสมอ การแชร์ผ่าน Share ใช้สิทธิ์อ่านชั่วคราวของระบบโดยตรงจึงตัดปัญหานี้ในหลายกรณี

### การกระจายต่อ

เมื่อ client ส่งไฟล์หรือรูปเข้า Host ตัว Host ตรวจ SHA-256 และบันทึกสำเร็จก่อนส่งต่อให้อุปกรณ์อื่นที่ออนไลน์ โดยไม่ส่งกลับต้นทาง หลายไฟล์จะส่งต่อเป็นชุดหลังรับครบ การส่งแบบ `all` จาก desktop ไม่สร้างการส่งต่อซ้ำ

ส่งแบบเจาะจงไปยัง client อื่นจะถึง client นั้น ส่วนส่งแบบเจาะจงเข้า Host จะถูกกระจายต่อ สถานะสำเร็จของผู้ส่งเข้า Host หมายถึง Host รับแล้ว ไม่ได้ยืนยันว่าอุปกรณ์อื่นได้รับครบทั้งหมด อุปกรณ์ที่ offline ก่อน Host เลือกผู้รับจะไม่ถูกเพิ่มเข้าคิว

ไฟล์ที่รับจะอยู่ใน receive directory และ clipboard/history การกด Ctrl+V ต้องใช้แอปที่รองรับรูปหรือไฟล์ชนิดนั้น บางเว็บหรือแอปแชทรับเฉพาะรูป หรือกำหนดประเภทและขนาดของไฟล์เอง

## 6. History และไฟล์ที่รับ

เก็บ history ล่าสุด 5 รายการที่รับสำเร็จ หลายไฟล์ในหนึ่งชุดนับเป็นหนึ่งรายการ ใช้ ID ที่แสดงจากคำสั่ง list:

```powershell
uc history
uc history copy ENTRY_ID
uc history open ENTRY_ID
uc history save ENTRY_ID "C:\Users\kivku\Downloads\Saved"
uc history usage
```

หลังปิดโปรแกรมที่เปิดไฟล์จาก history แล้ว ใช้ `uc history release ENTRY_ID` เพื่อปล่อยการเก็บไฟล์สำหรับรายการที่เปิดค้างไว้ Android ใช้ปุ่ม **History** แล้วเลือก Copy / Open / Share / Save

ค่ารับไฟล์เริ่มต้นบน Windows คือ `%USERPROFILE%\Downloads\Universal Clipboard` เปลี่ยนได้ขณะ service ทำงาน:

```powershell
uc receive-dir "C:\Users\kivku\Downloads\ClipboardFiles"
```

สำเนาถาวรใน receive directory ไม่ถูกลบเมื่อ history เกิน 5 รายการ

## 7. ใช้ข้ามเครือข่ายผ่าน Internet

เปิด Host ที่เชื่อมต่อ Internet:

```powershell
uc host --internet
```

รอข้อความ Internet Host ที่แสดง HTTPS URL แล้วเปิด terminal อีกหน้าต่าง:

```powershell
uc qr --internet
```

มือถือสแกน QR แล้วกด Join Host คอมพิวเตอร์ใหม่ใช้คำสั่ง `uc join "uvc://join?..."` ที่ Host แสดง โดยคัดลอก URI จริงทั้งชุด อุปกรณ์ใหม่ต้องใช้ private invitation แทน PIN ของกลุ่ม

Quick Tunnel URL เปลี่ยนได้เมื่อเริ่มใหม่ อุปกรณ์ desktop ที่จับคู่สำเร็จแล้วอัปเดตที่อยู่ด้วย `uc join "https://URL-ใหม่"` ส่วน Android กรอก URL ใหม่แล้วกด Join Host หรือใช้ invitation ใหม่ตามขั้นตอนจับคู่

## 8. แก้ปัญหา

| อาการ | วิธีตรวจและแก้ |
| --- | --- |
| `uc` ไม่เป็นที่รู้จัก | ตรวจ `npm list -g universal-clipboard-lan --depth=0` หากเป็น placeholder ให้ติดตั้ง 0.6.0 ใหม่ เปิด terminal ใหม่ แล้วตรวจ `where.exe uc` และ `npm prefix -g` โฟลเดอร์ prefix ต้องอยู่ใน PATH |
| PowerShell บล็อก `uc.ps1` | เรียก `uc.cmd --help` หรือใช้ CMD |
| มือถือเชื่อมต่อไม่ได้ | ตรวจ Host ยังเปิดอยู่, IP/port ถูกต้อง, Firewall และเครือข่ายไม่บล็อกการสื่อสารระหว่างอุปกรณ์ QR ใหม่ต้องยังไม่หมดอายุและไม่ถูกใช้แล้ว |
| รูปจากมือถือไม่ส่ง | ตรวจแอปต้นทาง copy รูปจริง แล้วกด SEND ดู error ใน notification และ log ของ Host ไม่ใช่อาศัยการ copy แล้วรออย่างเดียว |
| Host ได้ไฟล์ แต่ client อื่นไม่ได้ | ตรวจ Host ใช้แพ็กเกจที่รวมตัวแก้ relay และเปิด service ใหม่ ตรวจ `uc devices`, log ส่งต่อ และงานค้าง |
| ส่งไฟล์ค้างหรือหลุด | ใช้ `uc transfers` แล้ว `uc resume` ไฟล์ต้นฉบับสำหรับงานค้างต้องยังอยู่และไม่ถูกแก้ไข |
| ไม่อยากส่งสิ่งที่ copy ชั่วคราว | ใช้ `uc pause` แล้ว `uc unpause` เพื่อกลับมาซิงก์ รายการที่รับขณะ pause อาจยังถูกบันทึกใน history; pause ไม่ใช่การตัดการเชื่อมต่อ |
| Internet URL ยังไม่มา | อ่าน log tunnel ตรวจ Internet; LAN ยังใช้งานได้หาก tunnel ล้มเหลว |

ยกเลิกงานส่งที่ไม่ได้กำลังทำงานด้วย `uc cancel TRANSFER_ID` การยกเลิกไม่เรียกคืนไฟล์ที่ส่งสำเร็จแล้ว Android ใช้ **STOP** เพื่อหยุด เปิดแอปและกด Join Host ใหม่เมื่อจะใช้อีกครั้ง

## 9. อัปเดตและเผยแพร่สำหรับเจ้าของโปรเจกต์

ผู้ใช้ desktop หยุด service ก่อน แล้วอัปเดตและเปิดใหม่:

```powershell
npm install -g universal-clipboard-lan@latest
uc start
```

GitHub กับ npm เป็นคนละปลายทาง `git push` อัปเดต source ส่วน npm ต้องเผยแพร่ release ใหม่จึงเปลี่ยนสิ่งที่คนติดตั้งได้ ไม่จำเป็นต้องเผยแพร่ทุก commit เวอร์ชันที่เผยแพร่หรือ staged แล้วไม่ควรถูกใช้ซ้ำ

สำหรับโปรเจกต์นี้ให้ทำเวอร์ชันใน `package.json`, `package-lock.json` และ Android manifest ให้ตรงกัน เพิ่ม Android versionCode เมื่อปล่อย APK อัปเดต ทดสอบด้วย `npm test` และ build ด้วย `npm run build:release` จากโฟลเดอร์ `universal-clipboard`

ถ้า npm แจ้งว่าเวอร์ชันถูก staged ให้เข้า npmjs.com → **Staged Packages** → ตรวจเวอร์ชันและกด **Approve** พร้อม 2FA แทนการ publish ทับ ตรวจว่า release พร้อมติดตั้งด้วย `npm view universal-clipboard-lan version` ไม่แชร์ PIN, QR invitation, token หรือรหัส 2FA ให้ผู้อื่น

## 10. ทดลองก่อนนำเสนอ

เปิด Host และ client สองเครื่อง ตรวจ `uc devices` จากนั้นส่งข้อความ ส่งไฟล์เดี่ยว ส่งสองไฟล์เป็นชุด และส่งรูปจาก Android เข้า Host ทดสอบกด Share จากแอปอื่นบนมือถือแล้วเลือก **ส่งขึ้น Host** ตรวจว่า client อีกเครื่องได้รับโดยต้นทางไม่มีรายการย้อนกลับ ทดลองตัดการเชื่อมต่อระหว่างส่งแล้วใช้ `uc resume` ตรวจไฟล์ปลายทาง และทดลอง copy รายการจาก history อีกครั้ง

ชุด Node tests หลังแก้ relay ผ่าน 39 tests รวมเส้นทาง TCP ระหว่างสาม service การทดสอบนี้ไม่ได้ยืนยันโทรศัพท์จริงทุกยี่ห้อหรือ Linux ทุกระบบ ต้องทดสอบอุปกรณ์และเครือข่ายที่จะใช้เดโมจริงอีกครั้ง
