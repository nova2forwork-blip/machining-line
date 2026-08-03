-- ════════════════════════════════════════════════════════════
-- Migration: เพิ่มความถูกต้องของข้อมูล (project/part/release)
-- รันไฟล์นี้เฉพาะกรณีที่เคยสร้างฐานข้อมูลจาก supabase-schema.sql เวอร์ชันเก่าไปแล้ว
-- ถ้าเพิ่งสร้างโปรเจคใหม่และรัน supabase-schema.sql เวอร์ชันล่าสุด ไม่ต้องรันไฟล์นี้
--
-- วิธีใช้: Supabase Dashboard → SQL Editor → New Query → วางทั้งหมด → Run
-- ════════════════════════════════════════════════════════════

-- 1) รหัสโปรเจค (projects.code) ต้องไม่ซ้ำกัน
--    ถ้ามี code ซ้ำอยู่แล้ว คำสั่งนี้จะ error — ให้แก้ไข/รวมข้อมูลที่ซ้ำก่อน แล้วค่อยรันใหม่
alter table public.projects
  add constraint projects_code_key unique (code);

-- 2) รหัส Part (part_no) ต้องไม่ซ้ำกันภายในโปรเจคเดียวกัน (ต่างโปรเจคใช้รหัสซ้ำกันได้)
alter table public.part_master
  alter column project_id set not null,
  add constraint part_master_project_part_no_key unique (project_id, part_no);

-- 3) ทุก Release ต้องผูกกับ Part จริงเสมอ และจำนวนต้องมากกว่า 0
alter table public.releases
  alter column part_master_id set not null,
  add constraint releases_qty_check check (qty > 0);

-- 4) รองรับ "ไม่ต้องพิมพ์อะไรตอนสแกนหน้าเครื่อง": เก็บน้ำหนัก/ความยาวไว้ตั้งแต่ตอน
--    Release แล้วจ่ายลงทุกชิ้นใน part_units ทันที หน้าสแกนอ่านอย่างเดียว
alter table public.part_master add column if not exists default_length_mm numeric;
alter table public.releases    add column if not exists unit_weight numeric;
alter table public.releases    add column if not exists length_mm numeric;
alter table public.part_units  add column if not exists length_mm numeric;

-- 5) (ทางเลือก) เอาคอลัมน์ "ลูกค้า" ออก เพราะเป็นงานภายใน (Design สั่ง Production)
--    ไม่ใช่งานลูกค้าภายนอก — เอา comment ออกถ้าต้องการลบข้อมูลลูกค้าที่เคยกรอกไว้จริงๆ
-- alter table public.projects drop column if exists customer;
