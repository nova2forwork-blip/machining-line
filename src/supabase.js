-- ════════════════════════════════════════════════════════════════════════
-- Migration 7 — ยืดอายุ session ของบัญชีเครื่องหน้างาน (รองรับออฟไลน์ข้ามวัน)
-- รันเมื่อไหร่ก็ได้ · รันซ้ำได้ (idempotent)
--
-- เดิม token อายุ 12 ชม. (ตั้งใน verify_login) → เครื่องที่ออฟไลน์ข้ามวัน พอกลับมา
-- ออนไลน์ token หมดอายุ ทำให้คิวซิงค์ไม่ผ่าน ต้องล็อกอินใหม่
--
-- แก้: trigger ยืด expires_at ของ "บัญชีที่ผูกเครื่อง (machine_id)" เป็น 30 วัน
--      โดยไม่ต้องแก้ verify_login · บัญชีสำนักงาน (ไม่มี machine_id) คงเดิม (ปลอดภัยกว่า)
--
-- ⚙️ อยากได้กี่วัน แก้เลข '30 days' ทั้ง 2 จุดด้านล่าง (แนะนำ 30 วัน — ดูเหตุผลใน chat)
-- ════════════════════════════════════════════════════════════════════════

create or replace function public._mls_extend_machine_session()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_machine uuid;
begin
  select machine_id into v_machine from public.employees where id = new.employee_id;
  if v_machine is not null then
    new.expires_at := now() + interval '30 days';   -- ← เครื่องหน้างาน: อายุ token
  end if;
  return new;
end $$;

drop trigger if exists mls_extend_machine_session on public.sessions;
create trigger mls_extend_machine_session
  before insert on public.sessions
  for each row execute function public._mls_extend_machine_session();

-- ยืด session ของบัญชีเครื่องที่ยัง active อยู่ตอนนี้ด้วย (กันหลุดกลางคัน)
update public.sessions s
   set expires_at = now() + interval '30 days'
  from public.employees e
 where e.id = s.employee_id
   and e.machine_id is not null
   and coalesce(s.expires_at, now()) > now();

-- ── ตรวจหลังรัน ──────────────────────────────────────────────────────────
--  [ ] ล็อกอินหน้าเครื่องใหม่ 1 ครั้ง → select expires_at from sessions ...  ≈ +30 วัน
--  [ ] บัญชีสำนักงาน (ไม่มี machine_id) → expires_at ยังเป็น 12 ชม.เหมือนเดิม
