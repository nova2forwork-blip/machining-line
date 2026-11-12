# Artclad Production (machining-line) — กฎประจำโปรเจกต์

- ตอบและคุยเป็น **ภาษาไทย** ข้อความในหน้าแอปเป็นภาษาไทย (มี EN ผ่าน i18n)
- ทำงานบน branch **`local-test`** เท่านั้น
- **`main` = ใช้งานจริง (Vercel) ห้ามแตะ** จนกว่าผู้ใช้จะพิมพ์ว่า "ขึ้นจริง"
- ห้าม commit `package-lock.json`
- ห้าม commit `roles.sql`, `schema.sql`, `data.sql`, `.env*`, `.sim/` (ข้อมูลจริง)
- repo เป็น public — ห้ามใส่ข้อมูลลับ รหัสผ่าน อีเมล หรือข้อมูลลูกค้าในโค้ด/commit
- แก้เสร็จ → `npx vite build` ให้ผ่าน → commit + push ทันที
- `local-test` ต่อ Supabase ในเครื่อง (`supabase start`, ดู `vite.config.js`) ทดสอบกับข้อมูลในเครื่องได้เต็มที่
  ห้ามต่อ Supabase ตัวจริงบนเว็บ
- รายงานผู้ใช้: ข้อสรุปก่อน สั้นๆ และบอกชัดว่าอะไรทดสอบแล้ว / ยังไม่ได้ทดสอบ
- ไฟล์ migration ที่ต้องรันตอนขึ้นจริง: `migration-label-scope.sql`, `migration-delete-project-fix.sql`, `migration-critical-fixes-2026-11-12.sql`, `migration-office-rights-2026-11-12.sql`

## ทดสอบจำลอง
พิมพ์ `/sim-test` เพื่อเรียกทีมผู้ทดสอบ 6 คน (`.claude/agents/sim*.md`, กติกาใน `.claude/sim/SETUP.md`)
เช่น `/sim-test` (ฝั่ง office: SIM1 2 3 5 6) · `/sim-test 2 5` (เฉพาะ SIM2 กับ SIM5) · `/sim-test 4` (หน้าเครื่อง — พักไว้ก่อน)
