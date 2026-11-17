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

-- ── F9 ──  บัญชีค้าง session (ปิดเบราว์เซอร์ / แท็บเล็ตรีสตาร์ท โดยไม่กดออก) → "กำลังใช้งานอยู่ที่เครื่องอื่น" ต้องรอ 3 นาที
--   ปุ่ม "ใช้เครื่องนี้แทน" ที่หน้าล็อกอิน: ล็อกอินด้วยรหัสผ่านตามปกติ แล้วเรียกฟังก์ชันนี้ด้วย token ใหม่ → ตัด session อื่นของบัญชีเดียวกัน
--   (ต้องรู้รหัสผ่านอยู่แล้ว · เครื่องเดิมถูกตัด (superseded) ส่งงานค้างได้แล้วเด้งออกเอง) · ค่าเริ่มยังเป็น "เครื่องที่เข้าก่อนได้ใช้"
create or replace function public.session_takeover(p_token uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_emp uuid; n int;
begin
  select s.employee_id into v_emp from public.sessions s where s.token = p_token and s.expires_at > now();
  if v_emp is null then return jsonb_build_object('ok', false, 'reason', 'unauthorized'); end if;
  -- ไม่ลบ: ตั้ง superseded_at แบบเดียวกับ _mls_single_session / authz_force_logout → เครื่องเดิมยังส่งงานที่ค้างคิว (ออฟไลน์) ได้ แล้วขึ้น "ถูกใช้ที่เครื่องอื่น"
  update public.sessions set superseded_at = now()
   where employee_id = v_emp and token <> p_token and superseded_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'removed', n);
end $function$;
grant execute on function public.session_takeover(uuid) to anon, authenticated;
