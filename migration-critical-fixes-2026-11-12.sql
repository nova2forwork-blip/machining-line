-- ══ 2026-11-12 แก้ปัญหาร้ายแรงจากการทดสอบจำลอง (R1 R3 R4) ══
-- รันใน Supabase (SQL editor) ได้ซ้ำหลายครั้ง · ไม่ลบข้อมูล
--
-- R3  แก้หัวเอกสารล็อต (วันที่ / เลข RO) บันทึกไม่ได้ — "invalid input syntax for type uuid"
--     _mls_require_office() คืน void แต่ถูกเอาไปใส่ตัวแปร uuid → ใช้ perform แทน
-- R4  น้ำหนักวัสดุหน้า "โปรเจค" / "สรุป Part" เกินจริง — เบอร์ที่ยังไม่มีชิ้นงาน (QR) ถูกนับ unit_weight 1 ครั้ง (LEFT JOIN แถวว่าง)
--     → นับเฉพาะชิ้นงานที่มีจริง
-- R1  สองคนแก้ใบหลักเดียวกัน คนบันทึกทีหลังทับงานอีกคนเงียบ ๆ (และได้เลข M ซ้ำ)
--     → release_plan_save รับ p_base_at (updated_at ที่ client เห็นตอนโหลด) · ไม่ตรงกับในฐานข้อมูล = ไม่บันทึก คืน reason 'conflict'
--     · ไม่ส่ง p_base_at = ทำงานแบบเดิม (ร่าง / คลังซับ-พาร์ท / client เก่า) · คืน updated_at ใหม่ทุกครั้ง

-- ── R3 ──
create or replace function public.authz_update_release_header(p_token text, p_release_ids uuid[], p_release_order text, p_release_date timestamp with time zone, p_mdf_no text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_rel int := 0; v_pm int := 0;
begin
  perform public._mls_require_office(p_token::text);   -- ไม่ใช่ office / admin → raise

  if p_release_ids is null or array_length(p_release_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_ids');
  end if;

  update public.releases
     set release_order = p_release_order,
         release_date  = coalesce(p_release_date, release_date)
   where id = any(p_release_ids);
  get diagnostics v_rel = row_count;

  if p_mdf_no is not null and exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'part_master' and column_name = 'mdf_no'
     ) then
    update public.part_master
       set mdf_no = p_mdf_no
     where id in (select part_master_id from public.releases where id = any(p_release_ids));
    get diagnostics v_pm = row_count;
  end if;

  return jsonb_build_object('ok', true, 'releases', v_rel, 'parts', v_pm);
end $function$;

-- ── R4 ──
create or replace function public.project_summary()
 returns table(id uuid, code text, name text, total bigint, finished bigint, weight numeric)
 language sql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '20s'
as $function$
  select p.id, p.code, p.name,
         count(pu.id) as total,
         count(pu.id) filter (where pu.status = 'finished') as finished,
         coalesce(sum(coalesce(pu.weight, pm.unit_weight, 0)) filter (where pu.id is not null), 0) as weight
  from public.projects p
  left join public.part_master pm on pm.project_id = p.id
  left join public.part_units  pu on pu.part_master_id = pm.id
  group by p.id, p.code, p.name
  order by p.code;
$function$;

create or replace function public.part_summary()
 returns table(id uuid, part_no text, part_name text, total bigint, finished bigint, weight numeric)
 language sql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '20s'
as $function$
  select pm.id, pm.part_no, pm.part_name,
         count(pu.id) as total,
         count(pu.id) filter (where pu.status = 'finished') as finished,
         coalesce(sum(coalesce(pu.weight, pm.unit_weight, 0)) filter (where pu.id is not null), 0) as weight
  from public.part_master pm
  left join public.part_units pu on pu.part_master_id = pm.id
  group by pm.id, pm.part_no, pm.part_name
  order by count(pu.id) desc;
$function$;

-- ── R1 ──
drop function if exists public.release_plan_save(uuid, uuid, text, jsonb, uuid);
create or replace function public.release_plan_save(p_token uuid, p_project_id uuid, p_release_order text, p_plan jsonb, p_id uuid default null, p_base_at timestamptz default null)
 returns jsonb
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
    if exists (select 1 from public.release_plans
               where project_id = p_project_id and upper(btrim(release_order)) = upper(v_ro)
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
grant execute on function public.release_plan_save(uuid, uuid, text, jsonb, uuid, timestamptz) to anon, authenticated;
