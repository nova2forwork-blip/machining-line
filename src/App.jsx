-- ════════════════════════════════════════════════════════════════════════════
-- 2026-10-10 · ให้ "บางบัญชี" ล็อกอินได้หลายเครื่องพร้อมกัน (เลือกเปิดทีละบัญชี)
--   ค่าเริ่มต้น = ปิด (false) → ทุกบัญชีเดิมยังเป็น "1 บัญชีหน้าเครื่อง = 1 เครื่อง" เหมือนเดิม
--   เปิดแล้ว: (1) ล็อกอินเครื่องใหม่ไม่เตะเครื่องเก่า (_mls_single_session)
--             (2) ไม่ขึ้น "มีเครื่องอื่นใช้บัญชีนี้อยู่" (session_probe)
--   แอดมิน "บังคับออกจากระบบ" ยังใช้ได้ตามเดิม (เตะทุกเครื่องของบัญชีนั้น)
-- รันซ้ำได้ (idempotent) · ฟังก์ชันที่แทนที่ = ตัวจริงจาก DB (2026-10-10) + เพิ่มเงื่อนไขเดียว
-- ════════════════════════════════════════════════════════════════════════════

alter table public.employees add column if not exists multi_session boolean not null default false;

-- (1) ตัด session เก่า — ข้ามบัญชีที่เปิด multi_session
create or replace function public._mls_single_session()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_machine uuid; v_multi boolean;
begin
  select machine_id, coalesce(multi_session, false) into v_machine, v_multi
    from public.employees where id = new.employee_id;
  -- ตัด session เก่าเฉพาะบัญชีที่ผูกเครื่อง (กัน 2 เครื่องถือบัญชีเดียวกัน → กันสแกนชนกัน)
  -- บัญชีสำนักงาน/แอดมิน (machine_id = null) → ไม่ตัด ล็อกอินหลายที่/หลายแท็บพร้อมกันได้
  -- ★ 2026-10-10: บัญชีที่เปิด "ล็อกอินได้หลายเครื่อง" (multi_session) → ไม่ตัด
  if v_machine is not null and not v_multi then
    update public.sessions
       set superseded_at = now()
     where employee_id = new.employee_id
       and token is distinct from new.token
       and superseded_at is null;
  end if;
  return new;
end $function$;

-- (2) ตรวจก่อนล็อกอิน "มีเครื่องอื่นถือบัญชีนี้อยู่ไหม" — บัญชี multi_session = ไม่บล็อก
create or replace function public.session_probe(p_code text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object('ok', true, 'held', true, 'last_seen', s.last_seen)
       from public.sessions s
       join public.employees e on e.id = s.employee_id
      where e.code = btrim(p_code)
        and not coalesce(e.multi_session, false)          -- ★ 2026-10-10
        and s.superseded_at is null
        and coalesce(s.last_seen, now()) > now() - interval '3 minutes'
        and coalesce(s.expires_at, now() + interval '1 hour') > now()
      order by s.last_seen desc nulls last
      limit 1),
    jsonb_build_object('ok', true, 'held', false));
$function$;

-- (3) แอดมินเปิด/ปิด ต่อบัญชี (authz_update มี allow-list คอลัมน์ → ทำ RPC เฉพาะ)
create or replace function public.authz_set_employee_multi_session(p_token uuid, p_employee_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._require(p_token, 'admin');
  if p_employee_id is null then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  update public.employees set multi_session = coalesce(p_on, false) where id = p_employee_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'multi_session', coalesce(p_on, false));
end $function$;

-- (4) รายชื่อบัญชีที่เปิดไว้ (ให้หน้าตั้งค่าโชว์สถานะ)
create or replace function public.authz_list_multi_session(p_token uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  perform public._require(p_token, 'operator');   -- ข้อมูลไม่ลับ (แค่ id) · ต้องมี session
  return coalesce((select jsonb_agg(id) from public.employees where multi_session), '[]'::jsonb);
end $function$;

revoke all on function public.authz_set_employee_multi_session(uuid, uuid, boolean) from public;
revoke all on function public.authz_list_multi_session(uuid) from public;
grant execute on function public.authz_set_employee_multi_session(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.authz_list_multi_session(uuid) to anon, authenticated;

-- ตัวอย่าง: เปิดให้ DR-001 ด้วย SQL ตรงๆ (หรือติ๊กที่หน้า ตั้งค่า › พนักงาน › แก้ไข)
-- update public.employees set multi_session = true where code = 'DR-001';
-- ตรวจผล: select code, name, multi_session from public.employees where multi_session;
