-- ══════════════════════════════════════════════════════════════════════════
-- migration-login-probe-2026-11-19.sql — จากรอบทดสอบจำลองฝั่งหน้าเครื่อง รอบ 2 (SIM4) 19/11/2026
-- รันซ้ำได้ (create or replace) · ไม่แก้ข้อมูลเดิม
--
-- เดิม: หน้าล็อกอินถาม session_probe(รหัสพนักงาน) "ก่อน" ตรวจรหัสผ่าน → ใครก็รู้ได้ว่ารหัสพนักงานนี้มีจริง
--       และออนไลน์ล่าสุดเมื่อไร โดยไม่ต้องรู้รหัสผ่าน · การลองรหัสผ่านช่วงที่บัญชีมีคนใช้อยู่ไม่ถูกนับเข้าตัวล็อก
-- ตอนนี้:
--   1) session_probe_auth(รหัส, รหัสผ่าน) — ตรวจรหัสผ่านก่อน (ไม่สร้าง session · ไม่เตะเครื่องเดิม) ถูกแล้วจึงบอกว่ามีเครื่องอื่นใช้อยู่ไหม
--      รหัสผิด = นับเข้าตัวล็อกเหมือน verify_login (8 ครั้ง / 15 นาที → รอ 5 นาที) และไม่บอกอะไรเกี่ยวกับบัญชี
--   2) session_probe(รหัส) ตัวเดิม — ตอบ "ไม่มีใครใช้" เสมอ (ไม่เผยสถานะบัญชีอีก)
--      แอปรุ่นเก่าที่ยังค้างในเครื่องจึงไม่บล็อกล็อกอินซ้อนจนกว่าจะอัปเดต (การตัด session เดิมตอนล็อกอินใหม่ยังทำงานตามปกติ)
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.session_probe_auth(p_code text, p_password text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_lock timestamptz;
  emp    public.employees;
  ok     boolean := false;
  v_seen timestamptz;
begin
  select la.locked_until into v_lock from public.login_attempts la where la.code = v_code;
  if v_lock is not null and v_lock > now() then
    raise exception 'too_many_attempts: ลองรหัสผิดหลายครั้ง — รอ % นาที', greatest(1, ceil(extract(epoch from (v_lock - now())) / 60))::int;
  end if;

  select * into emp from public.employees where employees.code = btrim(p_code) and employees.active = true limit 1;
  if found then
    if emp.password_hash like '$2%' then
      ok := (emp.password_hash = crypt(p_password, emp.password_hash));
    else
      ok := (emp.password_hash = encode(digest(p_password, 'sha256'), 'hex'));
    end if;
  end if;
  if not ok then
    perform public._login_note(v_code, false);          -- นับครั้งที่ผิด (รหัสพนักงานไม่มี / ปิดใช้ / รหัสผ่านผิด ตอบเหมือนกัน)
    return jsonb_build_object('ok', true, 'auth', false);
  end if;

  if coalesce(emp.multi_session, false) then
    return jsonb_build_object('ok', true, 'auth', true, 'held', false);
  end if;
  select s.last_seen into v_seen
    from public.sessions s
   where s.employee_id = emp.id
     and s.superseded_at is null
     and coalesce(s.last_seen, now()) > now() - interval '3 minutes'
     and coalesce(s.expires_at, now() + interval '1 hour') > now()
   order by s.last_seen desc nulls last
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'auth', true, 'held', true, 'last_seen', v_seen);
  end if;
  return jsonb_build_object('ok', true, 'auth', true, 'held', false);
end $function$;

revoke all on function public.session_probe_auth(text, text) from public;
grant execute on function public.session_probe_auth(text, text) to anon, authenticated, service_role;

-- ตัวเดิม (ไม่ต้องใช้รหัสผ่าน): ไม่เผยสถานะบัญชีอีก
create or replace function public.session_probe(p_code text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('ok', true, 'held', false);
$function$;

notify pgrst, 'reload schema';
