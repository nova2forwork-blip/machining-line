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

-- ── ลำดับขั้นตอนของพาร์ท = ตามลำดับที่สแกนจริง (ผู้ใช้ 2026-11-17: "ขั้นตอนของแต่ละพาร์ท คนงานจะรู้เอง ให้เรียงตามลำดับการสแกน") ──
--   release_op_progress: เพิ่ม first_at (เวลาที่ขั้นตอนนี้ถูกสแกนครั้งแรกของ release นั้น) + เรียงตาม first_at (เดิมเรียงตาม seq ที่ตั้งไว้)
--   ตัวเลข done / finished คิดเหมือนเดิมทุกอย่าง
create or replace function public.release_op_progress(p_release_ids uuid[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '20s'
as $function$
  with umo as (
    select mr.release_id, mr.part_unit_id, mr.machine_id, mr.operation_id,
           sum(coalesce(mr.quantity, 0))::int as q,
           bool_or(mr.status = 'finished')    as f
    from public.machine_records mr
    where coalesce(mr.release_id, mr.part_master_id) = any(p_release_ids)
      and mr.release_id = any(p_release_ids)
      and mr.part_unit_id is not null
      and mr.quantity > 0
    group by mr.release_id, mr.part_unit_id, mr.machine_id, mr.operation_id
  ),
  umw as (
    select umo.*, bool_or(f) over (partition by release_id, part_unit_id, machine_id) as mfin
    from umo
  ),
  uo as (                                          -- ★ v4 ต่อ (release, ป้าย, ขั้นตอน): รวมข้ามเครื่อง
    select release_id, part_unit_id, operation_id,
           sum(q)::int as q,
           sum(case when mfin then q else 0 end)::int as fq
    from umw
    group by release_id, part_unit_id, operation_id
  ),
  pu as (
    select release_id, part_unit_id, max(q)::int as qty, max(fq)::int as finq
    from uo
    group by release_id, part_unit_id
  ),
  pu_ops as (
    select mr.release_id, mr.part_unit_id, mr.operation_id, min(mr.recorded_at) as first_at
    from public.machine_records mr
    where coalesce(mr.release_id, mr.part_master_id) = any(p_release_ids)
      and mr.release_id = any(p_release_ids)
      and mr.part_unit_id is not null
      and mr.operation_id is not null
    group by mr.release_id, mr.part_unit_id, mr.operation_id
  ),
  base as (
    select po.release_id, po.operation_id,
           sum(pu.qty)::int  as done,
           sum(pu.finq)::int as finished,
           min(po.first_at)  as first_at
    from pu_ops po
    join pu on pu.release_id = po.release_id and pu.part_unit_id = po.part_unit_id
    group by po.release_id, po.operation_id
  )
  select coalesce(jsonb_object_agg(rid, ops), '{}'::jsonb) from (
    select b.release_id as rid,
      jsonb_agg(jsonb_build_object(
        'op',       coalesce(op.name, 'ไม่ระบุ'),
        'seq',      coalesce(op.seq, 999),
        'done',     b.done,
        'finished', b.finished,
        'first_at', b.first_at
      ) order by b.first_at nulls last, coalesce(op.seq, 999), op.name) as ops
    from base b
    left join public.operations op on op.id = b.operation_id
    group by b.release_id
  ) x;
$function$;
