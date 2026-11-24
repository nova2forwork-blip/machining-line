-- ═══════════════════════════════════════════════════════════════════════
-- 2026-11-24 ลบไฟล์ PDF แบบ (bucket "release-pdfs") ได้จากแอป
--   ผู้ใช้: "ตอนลบ release หรือตอนลบ project pdf ไม่ลบด้วย" — เดิม bucket นี้มีสิทธิ์ ดู / เพิ่ม / แก้ แต่ไม่มีสิทธิ์ลบ
--   → ลบโปรเจค = ลบไฟล์ PDF ของโปรเจค · ลบใบ Release (ไม่มีล็อตเหลือ) = ลบไฟล์ของเบอร์ที่ใบนั้นใช้ใบเดียว
--   ระดับสิทธิ์เท่ากับ เพิ่ม / แก้ ที่มีอยู่เดิม (anon, authenticated) · รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists release_pdfs_delete on storage.objects;
create policy release_pdfs_delete on storage.objects for delete to anon, authenticated
  using (bucket_id = 'release-pdfs');
