# Universal Clipboard LAN — Release 0.5.0

## โครงสร้างโปรเจกต์

```text
universal-clipboard/
├── src/                  Desktop CLI, Hub และ transport
├── android/              Android source, resources และ build
├── test/                 Desktop integration tests
├── scripts/              Build และ smoke tests
├── docs/                 คู่มือและ protocol
│   └── handoffs/          ขอบเขตงานและเอกสารส่งต่อ
├── releases/             ไฟล์ส่งมอบแยกตามเวอร์ชัน
│   ├── 0.4.0/
│   └── 0.5.0/
│       └── alternate-build/  Build เดิมที่ลายเซ็นต่างกัน
├── android_demo_apk/     Snapshot เก่า ใช้ศึกษา ไม่ใช่ source ปัจจุบัน
├── package.json
└── README.md
```

`build/`, `android/build/` และ `node_modules/` เป็นไฟล์ชั่วคราว/ผล build ที่ Git ไม่เก็บ
อ่าน [สารบัญเอกสาร](docs/README.md) และ [คู่มือ release](releases/README.md) สำหรับรายละเอียด

Build ทั้ง desktop/APK จาก root ของ repo บน Windows:

```powershell
npm run build:release
```

ผลอยู่ใน `releases/0.5.0/` ใช้เวอร์ชันจาก `package.json` และตรวจให้ตรงกับ Android/lockfile
ติดตั้งไฟล์จาก checkout ด้วย `npm install -g ./releases/0.5.0/universal-clipboard-lan-0.5.0.tgz`

## Local + Internet (0.5.0)

Run `uc host --local-only` for LAN, or `uc host --internet` for LAN + Cloudflare Quick Tunnel. New remote devices join with the private URI/QR from `uc qr --internet`, not group PIN. Desktop and Android use WSS with existing encrypted UCP/2 transfers. See [Internet setup, verification and agent handoff](docs/handoffs/INTERNET-TUNNEL-HANDOFF.md). Quick Tunnel URLs change; real-phone and separate-uplink verification remain required.

ซิงก์ข้อความ/รูปจาก clipboard และส่งไฟล์ระหว่าง Windows กับ Linux ใน LAN
เครื่องหนึ่งเป็น Hub และใช้ clipboard/ส่งไฟล์ได้เหมือนเครื่องอื่น
Android APK พร้อมซอร์สอยู่ใน `android/` ใช้ [โปรโตคอล](docs/PROTOCOL.md) เดียวกัน รุ่นนี้มี QR จับคู่ รับ/ส่งไฟล์ทั่วไป และ [history ล่าสุด 5 รายการ](docs/HISTORY.md) ดู [คู่มือฟีเจอร์ 1–3](docs/PHASE-1-3.md) สำหรับพื้นฐานเดิม

## ติดตั้งง่าย

ติดตั้ง Node.js 22 ขึ้นไป แล้วรับไฟล์ `universal-clipboard-lan-0.5.0.tgz` จากผู้ดูแล:

```sh
npm install -g ./universal-clipboard-lan-0.5.0.tgz
uc setup
```

ไม่ต้องแตก tgz หรือติดตั้ง Git, Rust, Python, Electron
npm ดาวน์โหลด native clipboard ให้ตรงระบบ จึงต้องมีอินเทอร์เน็ตตอนติดตั้ง หลังจากนั้นซิงก์ผ่าน LAN เท่านั้น
Windows: หาก PowerShell บล็อก npm.ps1/uc.ps1 ให้ใช้ `npm.cmd` / `uc.cmd` ไม่ต้องเปลี่ยนนโยบายเครื่อง
Linux: ใช้ npm global prefix ที่ผู้ใช้เขียนได้ หรือตัวจัดการเวอร์ชัน Node; ไม่ต้องรันแอปเป็น root

หลังนำรุ่นนี้เข้า main แล้ว ติดตั้งจาก GitHub โดยไม่ใช้ Git ได้:

```sh
npm install -g https://github.com/kivkung/universal-clipboard/archive/refs/heads/main.tar.gz
uc setup
```

คำสั่ง GitHub จะได้รุ่นบน main ในขณะนั้น ไม่ใช่แพ็กเกจที่ยังรอรีวิว

## เริ่มใช้

1. ให้ทั้งสองเครื่องอยู่ LAN เดียวกัน
2. เครื่องแรกใช้ `uc` หรือ `uc setup` เลือก `h` สร้างกลุ่ม จะเห็น IP, PIN และ QR สำหรับจับคู่ทันที มือถือเปิด Scan QR สแกนเพื่อตั้งค่า แล้วกด “เชื่อมต่อ · Join Host”
3. อีกเครื่อง `uc setup` เลือก `j` เลือก Hub หรือใส่ IP แล้วใส่ PIN
4. เปิด terminal ค้างไว้ คัดลอกข้อความ/รูป แล้ววางอีกเครื่อง
5. ครั้งต่อไปเรียก `uc start` ไม่ต้องจับคู่ใหม่

เมื่อเริ่ม Host ด้วย `uc host` หรือ `uc start` ของ profile Host จะแสดง QR ให้อัตโนมัติเช่นกัน QR ใช้ได้ 2 นาทีสำหรับหนึ่งอุปกรณ์ หากหมดอายุหรือจะจับคู่เครื่องถัดไป ให้เปิดอีก terminal แล้วใช้ `uc qr` ถ้ามีหลาย network interfaces ระบุ `--address <Host LAN IP>` ตอนเริ่ม Host หรือสร้าง QR ได้

หรือใช้คำสั่งตรง:

```sh
uc host
uc join 192.168.1.10 123456
```

ใช้ PIN ที่ Hub แสดงจริงแทนตัวอย่าง กำหนดพอร์ตเองด้วย `--port 3000` และ Ctrl+C เพื่อหยุด
ไม่ส่ง clipboard เดิมทันทีเมื่อเปิดโปรแกรม ต้องคัดลอกเนื้อหาใหม่ก่อน
หาก Windows Firewall ถาม ให้ยอมให้ Node สื่อสารบนเครือข่ายส่วนตัวที่ใช้เดโม
Hub ใช้ TCP 3000 และ UDP 3001 สำหรับค้นหา ถ้า UDP ถูกบล็อกให้ใส่ IP เอง
เครือข่าย guest Wi-Fi ที่แยกเครื่องออกจากกันจะใช้งานไม่ได้

## ฟีเจอร์

- ข้อความ/URL สองทิศทาง หลายเครื่อง ป้องกันส่งวน
- รูปจาก clipboard จริง เช่น screenshot หรือ Copy image ส่งเป็น PNG แล้วใส่ clipboard ผู้รับ
- ส่งไฟล์จากทุกเครื่อง รวมถึง Hub และหลายไฟล์ต่อคำสั่ง
- เลือกผู้รับด้วย ID หรือชื่อที่ไม่ซ้ำ; ค่าเริ่มต้นทุกเครื่องที่ออนไลน์
- บันทึกที่ Downloads/Universal Clipboard; ชื่อซ้ำเปลี่ยนเป็น name (1).ext
- ความคืบหน้า และผลสำเร็จหลังผู้รับตรวจ SHA-256/ขนาดแล้ว
- ทุกก้อนเข้ารหัส AES-256-GCM และตรวจสอบก่อนเขียน
- เชื่อมต่อใหม่/ส่งต่อจากจุดเดิมอัตโนมัติขณะโปรเซสยังเปิดอยู่
- ปิด/เปิดโปรแกรมใหม่แล้ว `uc resume` เพื่อส่งงานค้างต่อ
- Pause, เปลี่ยนชื่อเครื่อง/โฟลเดอร์รับ, เพิกถอนเครื่องจาก Hub
- คำสั่งอีก terminal คุยกับโปรเซสเดิม ไม่แย่ง connection ของเครื่องเดียวกัน

## คำสั่งใช้บ่อย

เปิดอีก terminal ขณะ `uc start` ทำงาน:

```sh
uc devices
uc qr
uc qr --address 192.168.1.10
uc send-clipboard --to DEVICE_ID
uc send-file "./report.pdf" "./photo.png"
uc send-file "./video.mp4" --to DEVICE_ID
uc push "สวัสดี" --to DEVICE_ID
uc pause
uc unpause
uc receive-dir "./received-files"
uc rename "My laptop"
uc status
uc transfers
uc resume
uc cancel TRANSFER_ID
uc revoke DEVICE_ID
uc doctor
```

`send-file` รูปจะบันทึกเป็นไฟล์ ส่วน Copy image จะบันทึกไฟล์และใส่รูปใน clipboard
เมื่อ service ทำงาน Copy ไฟล์ใน Explorer/File Manager แล้วระบบตรวจและส่งอัตโนมัติผ่าน Hub ไปยังเครื่องอื่นที่เชื่อมต่ออยู่ (1–64 ไฟล์ต่อชุด) รอรับครบและตรวจ hash แล้วจึงใส่ file-list clipboard ผู้รับและ history หนึ่งรายการ ใช้ `uc auto-files off` เพื่อปิด หรือ `uc auto-files on` เพื่อเปิด ยังสั่ง `uc send-clipboard` เองได้ ไม่รองรับโฟลเดอร์ แอปปลายทางต้องรองรับการวางไฟล์
Pause หยุดรับ/ส่ง clipboard; ไฟล์ยังรับได้ รูปที่ส่งมาจะบันทึกโดยไม่เปลี่ยน clipboard
ผลส่งแยกตามผู้รับ พร้อมผลของสมาชิกแต่ละไฟล์ในชุด; ถ้ามีข้อผิดพลาดคำสั่งออกด้วยรหัส 1
`clipboardError` หมายถึงบันทึกไฟล์สำเร็จแต่ใส่ clipboard ไม่สำเร็จ

## ส่งต่อหลังหลุด

ผู้รับบันทึกแต่ละก้อน 64 KiB ก่อนตอบรับ ผู้ส่งถาม offset ใหม่เมื่อเชื่อมต่อกลับมา
ไม่ต้องส่งก้อนที่รับแล้วซ้ำ และไฟล์สุดท้ายตรวจ SHA-256 อีกครั้ง
รอเครือข่ายกลับมาได้สูงสุด 5 นาทีต่อการส่ง หลังจากนั้นงานยังอยู่ใน `uc transfers`
หากปิดโปรแกรม ให้เปิด `uc start` ทั้งสองฝั่ง แล้ว `uc resume` จากฝั่งส่ง

อย่าย้าย/แก้ต้นฉบับ เปลี่ยน profile หรือจับคู่ไปกลุ่มอื่นขณะมีงานค้าง
ถ้ารับครบแต่ ACK หาย จะยืนยันไฟล์เดิม ไม่สร้างซ้ำ
ส่งไฟล์เดิมเป็นคำสั่งใหม่ถือเป็นงานใหม่และเปลี่ยนชื่อเมื่อชนกัน
ไฟล์บางส่วนอยู่ในพื้นที่ส่วนตัว และหมดอายุหลังไม่ใช้งาน 7 วัน (ล้างตอนเปิดโปรแกรม)
Cancel ใช้กับงานที่ไม่ได้กำลังส่ง; ผู้รับออฟไลน์จะลบงานฝั่งส่งและรอ cleanup ฝั่งรับตามอายุ

## ระบบที่รองรับ

| ระบบ | ขอบเขต |
|---|---|
| Windows x64 | npm ติดตั้ง native modules; ทดสอบข้อความ/PNG clipboard จริงแล้ว |
| Linux x64 glibc, X11 | มี native package และ workflow ทดสอบ Xvfb; ต้องตรวจบน distro เดโมจริง |
| Wayland + XWayland | ใช้ DISPLAY ของ XWayland; ต้องตรวจการวางรูปกับแอปที่ใช้จริง |
| Pure Wayland ไม่มี XWayland | ยังไม่รองรับ; doctor แนะนำ session X11 |
| Linux ARM/musl | reader ที่เลือกไม่มี binary ในแพ็กเกจนี้; ไม่อยู่ในขอบเขตเดโม |
| Android 10+ | APK 0.5.0: LAN หรือ Internet QR, SEND/STOP, ส่ง/รับข้อความ รูป และไฟล์ พร้อม History; ไม่ต้องมี Node |

`uc doctor` ตรวจโหลด backend/เข้าถึง desktop ไม่ได้พิสูจน์ว่าแอปทุกตัววางรูปได้
ยังไม่ได้เดโม Windows ↔ Linux สองเครื่องจริง หรือรัน GitHub Actions ของรุ่นนี้

## ขอบเขตเดโม

- Text 512 KiB, ไฟล์ 10 GiB, PNG 32 MiB / 16 megapixels
- ไฟล์บางส่วนสูงสุด 32 งานต่อ profile
- ส่งทีละก้อนรอ ACK เพื่อจำกัดหน่วยความจำ; ไม่ใช่โหมดเร่งความเร็วเต็มแบนด์วิดท์
- ต้องเผื่อพื้นที่ประมาณสองเท่าของไฟล์ ระหว่างคัดลอกจากพื้นที่ชั่วคราวไปโฟลเดอร์รับ
- เครื่องที่ออฟไลน์ตอนเริ่ม `all` ไม่อยู่ในรายการส่ง ให้เชื่อมต่อก่อนเริ่ม
- รับไฟล์/รูปอัตโนมัติจากสมาชิกที่จับคู่ไว้ ไม่มีกล่องถามรับทุกครั้ง
- Hub เป็นตัวกลางที่เชื่อถือได้ สามารถอ่านข้อความ/ไฟล์ระหว่าง relay
- PIN ไม่ส่งตรงบนสาย แต่ PIN 6 หลักยังถูกลองเดา offline จากข้อมูลที่ดักฟังได้ เหมาะกับ LAN เดโม
- Revoke บล็อก ID ที่ระบุ ผู้ที่รู้ PIN ยังเข้าด้วย ID ใหม่ได้
- ยังไม่มี cloud, Internet relay หรือบริการเริ่มตอนบูต; desktop เป็น CLI และ Android มี UI

## QR และไฟล์จาก clipboard

เปิด Host ตามเดิม แล้วอีก terminal รัน `uc qr` ให้ Android กด **Scan QR** สแกนจาก terminal (หรือเลือกภาพ QR) ชื่อมือถือใช้ค่าที่บันทึกไว้ รหัสเชิญหมดอายุใน 2 นาที ใช้กับอุปกรณ์ใหม่ได้ครั้งเดียว และไม่ฝัง PIN ถาวร จับคู่แล้วใช้สิทธิ์เฉพาะเครื่องเพื่อ reconnect ได้ คำสั่ง `uc qr --address <IP>` ใช้เลือก interface เมื่อมีหลาย IP

Windows/Linux: Copy ไฟล์ขณะ service ทำงานเพื่อส่งอัตโนมัติ หากต้องการเลือกผู้รับเองให้ปิดด้วย `uc auto-files off` แล้วใช้ `uc send-clipboard --to <ID>` Android: ถ้าแอปต้นทาง Copy ไฟล์เป็น content URI ที่อ่านได้ ให้กด SEND; สำเนาไฟล์เก็บในมือถือเพื่อ resume ได้ มือถือส่งครั้งละหนึ่งไฟล์ สูงสุด 256 MiB และขึ้นกับพื้นที่ว่าง ฝั่งรับมี clipboard/history พร้อม Open / Share / Save to Downloads

## History ล่าสุด 5 รายการ

เก็บเฉพาะข้อความ รูป และไฟล์ที่รับสำเร็จ หลายไฟล์ในหนึ่งชุดนับเป็นหนึ่งรายการ งานค้าง/ผิดพลาดไม่เพิ่ม history และไม่ลบรายการสำเร็จ Desktop ใช้ `uc history`, `uc history copy <id>`, `uc history open <id>` และ `uc history save <id> <directory>` Android เปิดปุ่ม **History** เพื่อ Copy / Open / Share / Save

ค่าเริ่มต้นพื้นที่ชั่วคราว desktop 32 GiB และ Android 1 GiB ปรับได้ ไฟล์ที่ clipboard หรือโปรแกรมอ่านอยู่จะคงไว้แม้พ้น 5 รายการแล้ว สำเนาถาวรใน receive-dir/Downloads ไม่ถูกลบ รายละเอียดคำสั่ง นโยบาย pin/reserve และ recovery อยู่ใน [docs/HISTORY.md](docs/HISTORY.md)

APK ที่สร้างใหม่อาจใช้ signing key ต่างจากรุ่นที่ติดตั้งอยู่ ห้ามถอนแอปบนมือถือโดยไม่สำรองการตั้งค่า/งานค้าง ถ้าต้องการอัปเดตทับ ให้ผู้ดูแลเซ็นด้วย key เดิมที่เก็บไว้เอง

## ที่เก็บข้อมูล

Windows: `%LOCALAPPDATA%/universal-clipboard`
Linux: `$XDG_STATE_HOME/universal-clipboard` หรือ `~/.local/state/universal-clipboard`
เรียกจากโฟลเดอร์ไหนก็ได้ ข้อมูลอยู่กับผู้ใช้
State มี PIN ไม่ควรส่งให้ผู้อื่น ใช้ `--data-dir <path>` เพื่อแยก profile ทดสอบ
รุ่นเก่าใช้ state ใต้โฟลเดอร์โปรเจคและ ucp/0.1 รุ่นนี้ ucp/2 ต้องอัปเดตทุกเครื่อง/จับคู่ใหม่ ไม่ย้าย state เก่าอัตโนมัติ

## พัฒนา/ทดสอบ

```sh
npm ci
npm test
npm run doctor
npm pack
```

ถ้า environment ห้าม test runner สร้างโปรเซสย่อย:

```sh
node --test --experimental-test-isolation=none
```

ทดสอบ Windows clipboard จริงพร้อมคืน clipboard เดิม:

```powershell
powershell.exe -STA -File scripts/clipboard-smoke.ps1
```

Linux บน display ทดสอบ:

```sh
xvfb-run -a node scripts/clipboard-smoke.mjs
```

อย่ารัน clipboard-smoke.mjs ตรงบน clipboard ที่ใช้อยู่ เพราะจะเขียนข้อความและรูปทดสอบ
ดู [แผนเดโม](docs/DEMO.md) และ [โปรโตคอล Android](docs/PROTOCOL.md)
