# Machining Line System — คู่มือ Deploy

ระบบบันทึกการทำงานเครื่องจักร (Release · QR ต่อชิ้น · สแกนหน้าเครื่อง · รายงาน)
Backend: Supabase | Hosting: Vercel | เวลาติดตั้ง: ~20 นาที

## สิ่งที่อัปเดตในเวอร์ชันนี้ (แก้ความถูกต้องของข้อมูล)

- 📐 **แยกการนับน้ำหนักให้ถูกต้อง** — "น้ำหนักรวม" เดิมนับซ้ำทุกครั้งที่สแกน ชิ้นที่ผ่านหลายขั้นตอนถูกนับเกินจริง ตอนนี้แยกเป็น **น้ำหนักวัสดุ** (นับต่อชิ้น) กับ **ปริมาณงานที่ประมวลผล** (นับต่อการสแกน) พร้อมป้ายกำกับชัดเจนในหน้า Report
- 🏭 **ความสามารถของเครื่องจักร (machine × operation)** — เครื่องหนึ่งทำได้หลายขั้นตอน ตั้งค่าที่ Setup > เครื่องจักร ระบบตรวจตอนสแกนว่าเครื่องทำขั้นตอนนั้นได้จริง และรายงานแยกน้ำหนักของเครื่องออกเป็นราย-ขั้นตอนได้
- 🛡️ **กันข้อมูลเพี้ยนตั้งแต่ต้นทาง** — กันสแกนขั้นตอนซ้ำในชิ้นเดียวกัน + ตรวจความสามารถของเครื่องก่อนบันทึก
- 🐛 **แก้บั๊กติดตั้ง** — เรียงลำดับตารางใน `supabase-schema.sql` ให้ FK ไม่พัง, เพิ่ม `jsqr` ที่ขาดใน dependencies (หน้าสแกนกล้องใช้งานได้จริง), เพิ่มไอคอนปุ่มสแกนใหม่, สร้าง `.env.local.example`

## สิ่งที่อัปเดตในเวอร์ชันก่อนหน้า

- 🎨 **ดีไซน์ใหม่ทั้งหมด** โทนอุตสาหกรรม (กราไฟต์ + ทองเหลือง/เหล็ก) แทนธีมฟ้าเดิม
- 📱 **รองรับมือถือเต็มรูปแบบ** — เมนูข้างจะกลายเป็นแถบด้านล่าง + เมนูลิ้นชักเมื่อหน้าจอแคบ
- 🎥 **หน้าสแกนแยกเต็มจอ** — กดปุ่ม "เริ่มสแกน" แล้วเข้าสู่โหมดสแกนแบบเต็มหน้าจอ สแกนต่อเนื่องได้เรื่อยๆ พร้อมนับจำนวนที่สแกนในรอบนั้น
- 🏷️ **หน้า "พิมพ์ QR / ป้าย" ใหม่** — ค้นหาล็อตที่เคย Release แล้วพิมพ์ป้ายซ้ำได้ทุกเมื่อ เลือกได้ว่าจะพิมพ์ชิ้นไหนบ้าง
- 📏 **พิมพ์ป้ายขนาดจริง** — ค่าเริ่มต้น 2×2 ซม. (เลือกขนาดอื่น หรือกำหนดเองเป็นมิลลิเมตรได้) พิมพ์เป็นตารางบนกระดาษ A4 หรือทีละดวงสำหรับเครื่องพิมพ์ป้ายม้วนก็ได้
- 🛤️ **แถบแสดงขั้นตอน (Routing Rail)** — เห็นลำดับขั้นตอนของชิ้นงานเป็นภาพชัดเจนทั้งตอนสแกนและตอนตั้งค่า Part

---

## ขั้นตอนที่ 1 — สร้าง Supabase Project (ฟรี)

1. ไปที่ [supabase.com](https://supabase.com) → **Start your project** → Sign up ด้วย GitHub
2. **New Project** → ตั้งชื่อ เช่น `machining-line` → ตั้ง Database Password → **Create**
3. รอ ~2 นาทีให้ project พร้อม

### สร้างตารางใน Supabase

4. ไปที่ **SQL Editor** → **New Query**
5. วาง SQL จากไฟล์ `supabase-schema.sql` ทั้งหมด → กด **Run**
   (สร้างตารางทั้งหมด + ตั้งค่าเริ่มต้น + สร้างผู้ใช้ admin ให้อัตโนมัติ)

   > **ถ้าเคยสร้างฐานข้อมูลจากเวอร์ชันเก่าไปแล้ว** ให้รัน `migration-machine-capability.sql`
   > เพิ่มเพื่อได้ตารางความสามารถของเครื่องจักร (machine × operation) และตัวนับความคืบหน้า

### เปิด Realtime (เตรียมไว้สำหรับอนาคต)

6. ไปที่ **Database → Replication** → เปิด toggle หน้า `scan_logs` และ `part_units`

   > หมายเหตุ: เวอร์ชันนี้หน้าจอยังโหลดข้อมูลตอนเปิดหน้า (กด refresh เพื่อดูล่าสุด)
   > การเปิด Replication เป็นการเตรียมโครงสร้างไว้ ยังไม่มีการอัปเดตสดอัตโนมัติในหน้าจอ

### คัดลอก API Keys

7. ไปที่ **Project Settings → API** → คัดลอก **Project URL** และ **anon / public key**

---

## ขั้นตอนที่ 2 — อัปโหลดโค้ดขึ้น GitHub

```bash
git init
git add .
git commit -m "first commit"
```
สร้าง repo ใหม่ที่ [github.com/new](https://github.com/new) แล้ว:
```bash
git remote add origin https://github.com/YOUR_USERNAME/machining-line.git
git push -u origin main
```

---

## ขั้นตอนที่ 3 — Deploy บน Vercel (ฟรี)

1. [vercel.com](https://vercel.com) → **Continue with GitHub** → **Add New Project** → เลือก repo นี้
2. หน้า Configure Project → **Environment Variables** ใส่:

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `eyJhbGci...` |

3. กด **Deploy** → รอ ~1 นาที → ได้ URL เช่น `https://machining-line.vercel.app`

แชร์ URL ให้พนักงานหน้าเครื่องเปิดผ่านมือถือได้เลย ไม่ต้องลงแอป

---

## การใช้งาน Local (Development)

```bash
npm install
cp .env.local.example .env.local
# แก้ไขใส่ค่า Supabase จริง
npm run dev
# เปิด http://localhost:5173
```

---

## เข้าสู่ระบบครั้งแรก

- รหัสพนักงาน: `admin`
- รหัสผ่าน: `admin123`

เข้าไปที่เมนู **Setup** เพื่อเพิ่ม เครื่องจักร / ขั้นตอนงาน / โปรเจค / Part + Routing / พนักงานจริง ก่อนเริ่มใช้งาน

ระบบจะ **ออกจากระบบอัตโนมัติทันทีที่ปิดแท็บ/เบราว์เซอร์** (ใช้ sessionStorage ไม่ใช่ localStorage)

---

## แนวคิดหลักของระบบ

- **1 QR = 1 ชิ้นงานจริง** สร้างตอน Release Production พิมพ์ป้ายติดไปกับชิ้นงานได้ทันที
- ทุกครั้งที่พนักงานสแกน QR ที่หน้าเครื่องจักร (มือถือ / เครื่องสแกนบาร์โค้ดที่พิมพ์คีย์เข้า input / พิมพ์เอง) ระบบจะบันทึกเป็นประวัติการทำงานของชิ้นนั้น
- สถานะ "ชิ้นนี้ถึงไหนแล้ว" คำนวณจากการเทียบขั้นตอนที่สแกนแล้ว กับ Routing ที่กำหนดไว้ใน Part Master
- รายงาน/สรุปทั้งหมด (Report, Machines/Projects/Parts Summary) ดึงจากประวัติการสแกนนี้โดยตรง

## โครงสร้างไฟล์

```
machining-line-system/
├── src/
│   ├── main.jsx          ← entry point
│   ├── App.jsx           ← หน้าจอทั้งหมด (Release, Scan, Report, Setup ฯลฯ)
│   ├── supabase.js       ← Supabase client + query helpers
│   └── auth.js           ← ล็อคอิน + session (sessionStorage)
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── supabase-schema.sql   ← SQL สำหรับ setup database
└── .env.local.example
```

## Features

- 🏷️ **Release Production** — ปล่อยงาน สร้าง QR ต่อชิ้น พร้อมพิมพ์ป้าย
- 📱 **Production Detail** — สแกน QR หน้าเครื่องจักรผ่านมือถือ/เครื่องสแกน/พิมพ์เอง
- ✅ **Finished Part** — รายชื่อชิ้นที่ผ่านครบทุกขั้นตอนตาม Routing
- 📊 **Report / Machines / Projects / Parts Summary** — สรุปวัน สัปดาห์ เดือน ปี
- 🔐 **ล็อคอิน + ออกจากระบบอัตโนมัติ** เมื่อปิดเว็บ (ชื่อ/รหัสพนักงาน/แผนก)
- ⚙️ **Setup** — จัดการเครื่องจักร ขั้นตอนงาน โปรเจค Part+Routing พนักงาน
