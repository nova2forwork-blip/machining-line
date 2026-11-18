-- ══════════════════════════════════════════════════════════════════════════
-- migration-ro-key-2026-11-18.sql — จากชุดทดสอบ pytest (TC-DB-033) 18/11/2026
-- รันซ้ำได้ (create or replace) · ไม่แก้ข้อมูลเดิม
--
-- release_plan_save เดิมเทียบเลขใบซ้ำแบบ "ตัวสะกดตรงกัน" → มีใบ P-009 แล้วยังสร้าง P-9 ได้อีกใบ
-- หน้าจอเทียบแบบ "เลขเดียวกัน" อยู่แล้ว (releaseOrderKey ใน supabase.js · roKey ใน releaseCore.js)
-- → ให้ฐานข้อมูลใช้กติกาเดียวกัน: P-9 = P-09 = P-009 · ส่วนท้าย "(…)" ต้องตรงกัน · ไม่ใช่เลขใบ (DRAFT:… / LIB) = ตัดช่องว่างแล้วเทียบตรงตัว
-- ══════════════════════════════════════════════════════════════════════════

-- กุญแจเทียบเลขใบ (ต้องให้ผลเหมือน releaseOrderKey / roKey ฝั่งหน้าจอ)
create or replace function public._ro_key(p_raw text) returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  s text := upper(btrim(coalesce(p_raw, '')));
  m text[];
begin
  m := regexp_match(s, '^P\s*-?\s*0*(\d+)(?:\.0*(\d+))?\s*(\(.*\))?$');
  if m is null then return regexp_replace(s, '\s+', '', 'g'); end if;
  return 'P-' || (m[1]::numeric)::text
      || coalesce('.' || (m[2]::numeric)::text, '')
      || coalesce(regexp_replace(m[3], '\s+', '', 'g'), '');
end $function$;

create or replace function public.release_plan_save(
  p_token uuid, p_project_id uuid, p_release_order text, p_plan jsonb,
  p_id uuid default null, p_base_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emp uuid;
  v_id  uuid;
  v_at  timestamptz;
  v_cur timestamptz;
  v_by  text;
  v_ro  text := btrim(coalesce(p_release_order, ''));
begin
  perform public._require(p_token, 'office');
  select s.employee_id into v_emp from public.sessions s where s.token = p_token limit 1;
  if p_project_id is null or v_ro = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if p_id is null then
    -- ล็อกต่อ (โปรเจค, เลขใบ) จนจบ transaction → สองคนสร้างใบเลขเดียวกันพร้อมกัน คนที่สองรอแล้วเจอ duplicate
    perform pg_advisory_xact_lock(hashtextextended('relplan:' || p_project_id::text || ':' || public._ro_key(v_ro), 0));
    if exists (select 1 from public.release_plans
               where project_id = p_project_id and public._ro_key(release_order) = public._ro_key(v_ro)
                 and status <> 'cancelled') then
      return jsonb_build_object('ok', false, 'reason', 'duplicate');
    end if;
    insert into public.release_plans (project_id, release_order, plan, created_by, updated_by)
    values (p_project_id, v_ro, coalesce(p_plan, '{}'::jsonb), v_emp, v_emp)
    returning id, updated_at into v_id, v_at;
  else
    -- ล็อกแถวไว้ก่อนเทียบ (สองคนกดพร้อมกัน = คนที่สองรอแล้วเจอ conflict)
    select rp.updated_at, e.name into v_cur, v_by
      from public.release_plans rp left join public.employees e on e.id = rp.updated_by
     where rp.id = p_id and rp.project_id = p_project_id
       for update of rp;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if p_base_at is not null and v_cur is distinct from p_base_at then
      return jsonb_build_object('ok', false, 'reason', 'conflict', 'updated_at', v_cur, 'updated_by_name', v_by);
    end if;
    update public.release_plans
       set plan = coalesce(p_plan, plan), updated_by = v_emp, updated_at = clock_timestamp()
     where id = p_id
    returning id, updated_at into v_id, v_at;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'updated_at', v_at);
end $function$;

notify pgrst, 'reload schema';
