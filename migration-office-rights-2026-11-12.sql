-- ══ 2026-11-12 สิทธิ์ office (ผู้ใช้: "ให้สิทธิ์ทุกอย่างในการแก้ เพิ่ม ลด แต่ห้ามลบทั้ง release กับโปรเจค") ══
-- รันใน Supabase (SQL editor) ได้ซ้ำหลายครั้ง · ไม่ลบข้อมูล
--
--  1) projects: office แก้ได้ (รหัส / ชื่อ / ปิด-เปิดโปรเจค) — เดิม admin · ลบโปรเจคยังเป็น admin (authz_delete_project)
--  2) authz_audit_record: office บันทึกประวัติการกระทำของตัวเองได้ (เดิม admin → office แก้ Material แล้ว audit หาย / 400 ใน console)
--  3) authz_delete_release (ยกเลิกการปล่อย / ลบเบอร์ในล็อต): office ทำได้ทีละบางเบอร์ ·
--     ลบแถวสุดท้ายของล็อต (= ลบทั้ง Release) → เฉพาะ admin
--  4) release_plan_set_status: ลบใบหลัก (status = cancelled) → เฉพาะ admin · ร่าง "ปล่อยงานใหม่" (DRAFT:) / คลัง (LIB) office ยังลบได้

-- ── 1 ──
create or replace function public._perm(p_tbl text, p_act text)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
    declare r text := public._perm_base(p_tbl, p_act);
    begin
      -- ★ office-release-rights (2026-10-08): ตารางของ Release ที่ยังเป็น admin → ให้ office (ไม่แตะการลบ)
      -- ★ 2026-11-12: + projects:update (แก้รหัส / ชื่อ / สถานะโปรเจค)
      if r = 'admin' and (p_tbl || ':' || p_act) = any ('{part_master:update,projects:update}'::text[]) then return 'office'; end if;
      return r;
    end $function$;

-- ── 2 ──
create or replace function public.authz_audit_record(p_token text, p_action text, p_entity text default null, p_entity_id text default null, p_detail jsonb default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_emp public.employees;
begin
  perform public._mls_require_office(p_token);   -- office / supervisor / admin
  v_emp := public._mls_session_employee(p_token);
  insert into public.audit_log (actor_id, actor_code, actor_name, action, entity, entity_id, detail)
  values (v_emp.id, v_emp.code, v_emp.name, p_action, p_entity, p_entity_id, p_detail);
  return jsonb_build_object('ok', true);
end $function$;

-- ── 3 ──
create or replace function public.authz_delete_release(p_token uuid, p_release_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare v_ids uuid[]; v_role text;
begin
  v_role := public._require(p_token, 'supervisor');
  if public._rank(v_role) < public._rank('admin') and not exists (
      select 1
        from public.releases r
        join public.part_master p  on p.id = r.part_master_id
        join public.part_master p2 on p2.project_id = p.project_id
        join public.releases r2    on r2.part_master_id = p2.id
       where r.id = p_release_id and r2.id <> r.id
         and upper(btrim(coalesce(r2.release_order, ''))) = upper(btrim(coalesce(r.release_order, '')))
         and r2.mod_cancelled_at is null) then
    raise exception 'forbidden: ลบทั้งล็อต (ไม่เหลือเบอร์ไหน) ได้เฉพาะแอดมิน — ยกเลิกได้ทีละบางเบอร์';
  end if;
  select array_agg(id) into v_ids from public.part_units where release_id = p_release_id;
  if v_ids is not null then
    delete from public.scan_logs where part_unit_id = any(v_ids);
    delete from public.part_units where id = any(v_ids);
  end if;
  delete from public.releases where id = p_release_id;
end $function$;

-- ── 4 ──
create or replace function public.release_plan_set_status(p_token uuid, p_id uuid, p_status text, p_keep_lots boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_emp  uuid;
  v_prj  uuid;
  v_num  text;
  v_ro   text;
  v_kind text;
  v_role text;
begin
  v_role := public._require(p_token, 'office');
  if p_status not in ('active', 'closed', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  select s.employee_id into v_emp from public.sessions s where s.token = p_token limit 1;
  if p_status = 'cancelled' then
    select p.project_id, substring(upper(btrim(p.release_order)) from '^P\s*-?\s*0*([0-9]+)'), upper(btrim(p.release_order)), coalesce(p.plan->>'kind', '')
      into v_prj, v_num, v_ro, v_kind
      from public.release_plans p where p.id = p_id;
    if v_prj is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    -- ★ 2026-11-12 ลบใบหลัก (Release) = แอดมินเท่านั้น · ร่าง (DRAFT:) / คลัง (LIB) ยังลบได้ตามเดิม
    if public._rank(v_role) < public._rank('admin') and v_kind not in ('draft', 'lib') and v_ro not like 'DRAFT:%' and v_ro <> 'LIB' then
      return jsonb_build_object('ok', false, 'reason', 'admin_only');
    end if;
    if not coalesce(p_keep_lots, false) and v_num is not null and exists (
         select 1 from public.releases r
           join public.part_master pm on pm.id = r.part_master_id
          where pm.project_id = v_prj
            and substring(upper(btrim(coalesce(r.release_order, ''))) from '^P\s*-?\s*0*([0-9]+)') = v_num) then
      return jsonb_build_object('ok', false, 'reason', 'has_lots');
    end if;
  end if;
  update public.release_plans set status = p_status, updated_by = v_emp, updated_at = now() where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $function$;
