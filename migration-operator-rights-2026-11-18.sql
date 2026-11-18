-- ══════════════════════════════════════════════════════════════════════════
-- migration-operator-rights-2026-11-18.sql — จากรอบทดสอบจำลองฝั่งหน้าเครื่อง (SIM4) 18/11/2026
-- รันซ้ำได้ (create or replace) · ไม่แก้ข้อมูลเดิม
--
-- เดิม: บัญชีพนักงานหน้าเครื่อง (operator) เรียกฐานข้อมูลตรง ๆ แล้วสร้างโปรเจค / เบอร์ / Release / QR ได้
--       (หน้าจอซ่อนเมนูไว้ แต่ฐานข้อมูลตั้งสิทธิ์ขั้นต่ำของการ "เพิ่ม" 4 ตารางนี้ และฟังก์ชันปล่อยงาน ไว้ที่ operator)
-- ตอนนี้: การเพิ่ม projects / part_master / releases / part_units และการปล่อยงาน (create_release_batch · _checked)
--       ต้องเป็นระดับ supervisor ขึ้นไป (office = ระดับเดียวกับ supervisor · admin) — หน้าเครื่องไม่ได้ใช้ทางเหล่านี้
--       (หน้าเครื่องบันทึกงานผ่านฟังก์ชันของสถานีเอง ซึ่งไม่เปลี่ยน)
-- ══════════════════════════════════════════════════════════════════════════

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
      -- ★ 2026-11-18: สร้างโปรเจค / เบอร์ / แถวปล่อย / QR = งานของออฟฟิศ ไม่ใช่หน้าเครื่อง
      if r = 'operator' and p_act = 'insert' and p_tbl = any ('{projects,part_master,releases,part_units}'::text[]) then return 'supervisor'; end if;
      return r;
    end $function$;

create or replace function public.create_release_batch(
  p_token uuid, p_project_id uuid, p_release_order text, p_release_date timestamptz,
  p_released_by uuid, p_make_qr boolean, p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '20s'
as $function$
declare
  r jsonb; v_code text; v_qty int; v_uw numeric; v_len numeric;
  v_part_id uuid; v_release_id uuid; v_suffix text; v_part_no text;
  releases_created int := 0; parts_created int := 0; units_created int := 0;
begin
  perform public._require(p_token, 'supervisor');   -- ★ 2026-11-18 เดิม 'operator'
  for r in select * from jsonb_array_elements(p_rows) loop
    v_code := trim(r->>'code'); v_qty := coalesce((r->>'qty')::int, 0);
    if v_code = '' or v_qty <= 0 then continue; end if;
    v_uw := nullif(r->>'unit_weight','')::numeric; v_len := nullif(r->>'length_mm','')::numeric;

    select id into v_part_id from public.part_master
      where project_id = p_project_id and lower(trim(part_no)) = lower(v_code) limit 1;
    if v_part_id is null then
      insert into public.part_master (project_id, part_no, part_name, material, unit_weight, default_length_mm, routing)
      values (p_project_id, v_code, v_code, nullif(r->>'material',''), coalesce(v_uw,0), v_len, coalesce(r->'routing','[]'::jsonb))
      returning id into v_part_id;
      parts_created := parts_created + 1;
    end if;

    insert into public.releases (part_master_id, qty, unit_weight, length_mm, released_by, note, release_order, release_date)
    values (v_part_id, v_qty, v_uw, v_len, p_released_by, nullif(r->>'remark',''), nullif(p_release_order,''), coalesce(p_release_date, now()))
    returning id into v_release_id;
    releases_created := releases_created + 1;

    if p_make_qr then
      v_suffix := upper(substr(v_release_id::text, 1, 6));
      select part_no into v_part_no from public.part_master where id = v_part_id;
      insert into public.part_units (release_id, part_master_id, unit_no, qr_code, status, weight, length_mm)
      select v_release_id, v_part_id, g, v_part_no || '-' || v_suffix || '-' || lpad(g::text, 4, '0'), 'released', v_uw, v_len
      from generate_series(1, v_qty) as g;
      units_created := units_created + v_qty;
    end if;
  end loop;
  return jsonb_build_object('releasesCreated', releases_created, 'partsCreated', parts_created, 'unitsCreated', units_created);
end $function$;

create or replace function public.create_release_batch_checked(
  p_token uuid, p_project_id uuid, p_release_order text, p_release_date timestamptz,
  p_released_by uuid, p_make_qr boolean, p_rows jsonb, p_plan_ro text, p_limits jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '20s'
as $function$
declare
  l jsonb; v_code text; v_max numeric; v_had numeric; v_new numeric;
  v_base text := upper(btrim(coalesce(p_plan_ro, '')));
  v_over text := '';
begin
  perform public._require(p_token, 'supervisor');   -- ★ 2026-11-18 เดิม 'operator'
  if v_base <> '' and p_limits is not null and jsonb_typeof(p_limits) = 'array' then
    -- ล็อกต่อ (โปรเจค, ใบหลัก) จนจบ transaction → คนที่สองรอ แล้วเห็นยอดที่คนแรกเพิ่งปล่อย
    perform pg_advisory_xact_lock(hashtextextended('rellot:' || p_project_id::text || ':' || v_base, 0));
    for l in select * from jsonb_array_elements(p_limits) loop
      v_code := lower(btrim(coalesce(l->>'code', ''))); v_max := nullif(l->>'max', '')::numeric;
      if v_code = '' or v_max is null then continue; end if;
      select coalesce(sum(r.qty), 0) into v_had
        from public.releases r join public.part_master m on m.id = r.part_master_id
       where m.project_id = p_project_id and lower(btrim(m.part_no)) = v_code
         and r.mod_cancelled_at is null
         and (upper(btrim(r.release_order)) = v_base or left(upper(btrim(r.release_order)), length(v_base) + 1) = v_base || '.');
      select coalesce(sum(coalesce((x->>'qty')::int, 0)), 0) into v_new
        from jsonb_array_elements(p_rows) x where lower(btrim(coalesce(x->>'code', ''))) = v_code;
      if v_new > 0 and v_had + v_new > v_max then
        v_over := v_over || (l->>'code') || ' (ต้องใช้ ' || trim(to_char(v_max, 'FM999999990.##')) || ' · ปล่อยแล้ว ' || trim(to_char(v_had, 'FM999999990.##')) || ' · จะปล่อยอีก ' || trim(to_char(v_new, 'FM999999990.##')) || '); ';
      end if;
    end loop;
    if v_over <> '' then raise exception 'over_release: %', v_over using errcode = 'P0001'; end if;
  end if;
  return public.create_release_batch(p_token, p_project_id, p_release_order, p_release_date, p_released_by, p_make_qr, p_rows);
end $function$;

notify pgrst, 'reload schema';
