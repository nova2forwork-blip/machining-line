-- ══ 2026-11-17 แก้ปัญหาร้ายแรงจากการทดสอบหน้าเครื่อง (SIM4) ══
-- รันใน Supabase (SQL editor) ได้ซ้ำหลายครั้ง · ไม่ลบข้อมูล
--
-- F1  เปลี่ยนรหัสผ่านตัวเองไม่ได้ — "function crypt(text, text) does not exist"
--     change_my_password ตั้ง search_path = public อย่างเดียว แต่ crypt / gen_salt / digest อยู่ใน schema extensions
-- F2  หน้าแผง / ประกอบ / แพ็ก บันทึก assembly_links โดยไม่ใส่ child_pm_id (เบอร์ของลูก)
--     → get_assembly_state (หน้า "ตรวจงานประกอบ") จับคู่ด้วย child_pm_id ไม่เจอ → ขึ้น "ยังไม่สแกน" ทั้งที่ใส่ลูกแล้ว
--     แก้ที่ตาราง (trigger) — ทุกทางที่ insert ลูกเข้าแม่ได้ child_pm_id จากชิ้นลูกเอง + เติมแถวเก่าที่ว่าง

-- ── F1 ──
alter function public.change_my_password(text, text, text) set search_path = public, extensions;

-- ── F2 ──
create or replace function public._assembly_links_fill_pm()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.child_pm_id is null and new.child_unit_id is not null then
    select pu.part_master_id into new.child_pm_id from public.part_units pu where pu.id = new.child_unit_id;
  end if;
  return new;
end $function$;

drop trigger if exists trg_assembly_links_fill_pm on public.assembly_links;
create trigger trg_assembly_links_fill_pm
  before insert or update of child_unit_id on public.assembly_links
  for each row execute function public._assembly_links_fill_pm();

-- แถวเก่าที่บันทึกไปแล้วโดยไม่มี child_pm_id
update public.assembly_links l
   set child_pm_id = pu.part_master_id
  from public.part_units pu
 where pu.id = l.child_unit_id and l.child_pm_id is null;
