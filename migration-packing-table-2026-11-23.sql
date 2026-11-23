-- ══════════════════════════════════════════════════════════════════════════
-- migration-packing-table-2026-11-23.sql — ตารางแพ็กกิ้ง (ลงข้อมูลแพ็กคล้ายหน้าปล่อยงาน) 23/11/2026
--   รัน 1 ครั้งใน Supabase SQL Editor · รันซ้ำได้ · ไม่แก้ข้อมูลเดิม
--   ต้องรัน migration-container-plan-2026-11-23.sql และ migration-bunk-edit-2026-11-23.sql ก่อน
--
--   ผู้ใช้: "ให้ลงไฟล์ pdf หรือ excel แล้วจะได้ตารางแพ็กกิ้งมา ให้แก้ตารางได้ แล้วเลือกว่าจะแก้เป็น modify หรือแก้ธรรมดา"
--   packing_box  = กล่อง / บั้ง 1 ใบ + รายการของข้างใน (items) — ของที่ไม่ใช่แผง (anchor, gasket, louvre …) ก็ลงได้
--   packing_mod  = บันทึก Modify (เลขที่ M · เหตุผล · สิ่งที่เปลี่ยน · ใคร · เมื่อไร) — เพิ่มอย่างเดียว ไม่มีทางแก้ / ลบผ่านระบบ
--   กล่องที่ "เป็นบั้งของหน้าเครื่อง" (มี package เลขเดียวกันในโปรเจค) ใช้ใบบั้งของหน้าเครื่องเป็นตัวจริงตัวเดียว:
--     อ่าน = รายการจากใบบั้ง · บันทึก = เขียนใบบั้ง + BOM ให้ด้วย (แผงที่สแกนแพ็กแล้วเอาออกไม่ได้ · เบอร์ต้องมีในโปรเจค)
--   ชิป / ตู้ ของกล่อง เก็บที่ container_plan (ตารางเดียวกับหน้าแผนลงตู้)
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.packing_box (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  box_no     text not null check (btrim(box_no) <> '' and length(box_no) <= 60),
  kind       text not null default 'loose' check (kind in ('panel', 'loose')),
  title      text not null default '',
  location   text not null default '',
  level      text not null default '',
  items      jsonb not null default '[]'::jsonb,
  updated_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists packing_box_project_no_uniq on public.packing_box (project_id, upper(regexp_replace(box_no, '\s+', '', 'g')));

create table if not exists public.packing_mod (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  mod_no     integer not null,
  reason     text not null,
  changes    jsonb not null default '[]'::jsonb,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, mod_no)
);

alter table public.packing_box enable row level security;
alter table public.packing_mod enable row level security;
revoke all on public.packing_box from anon;
revoke all on public.packing_box from authenticated;
revoke all on public.packing_mod from anon;
revoke all on public.packing_mod from authenticated;

-- ใบบั้งของหน้าเครื่อง (pkg_manifest) → รายการในตารางแพ็กกิ้ง
create or replace function public._pk_items_of_manifest(p_manifest jsonb) returns jsonb
language sql immutable set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item', upper(btrim(coalesce(m->>'unit_no', ''))), 'desc', coalesce(m->>'description', ''), 'pos', upper(btrim(coalesce(m->>'position', ''))),
           'addr', coalesce(m->>'address_seq', ''), 'len', null, 'w', m->'width', 'h', m->'height', 'unit', '',
           'qty', greatest(coalesce(nullif(m->>'qty', '')::numeric, 1), 1), 'wt', m->'weight') order by ord), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_manifest) = 'array' then p_manifest else '[]'::jsonb end) with ordinality as t(m, ord);
$function$;

-- เขียนใบบั้ง + BOM + ยอดรวม ของบั้งหน้าเครื่อง จากรายการในตารางแพ็กกิ้ง · คืน null = สำเร็จ · ไม่งั้นคืน 'เหตุผล:เบอร์'
create or replace function public._pk_apply_to_bunk(p_project_id uuid, p_pm uuid, p_items jsonb) returns text
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_man jsonb; v_unit text; v_need int; v_got int; v_pm uuid; v_seq int := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'no', ord, 'unit_no', upper(btrim(coalesce(i->>'item', ''))), 'position', upper(btrim(coalesce(i->>'pos', ''))), 'address_seq', coalesce(i->>'addr', ''),
           'description', coalesce(i->>'desc', ''), 'width', i->'w', 'height', i->'h',
           'sqm', case when (i->>'w') ~ '^\d+(\.\d+)?$' and (i->>'h') ~ '^\d+(\.\d+)?$' then round((i->>'w')::numeric * (i->>'h')::numeric / 1000000, 4) else null end,
           'qty', greatest(coalesce(nullif(i->>'qty', '')::numeric, 1), 1), 'weight', i->'wt') order by ord), '[]'::jsonb)
    into v_man
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord);
  -- ของที่สแกนแพ็กเข้าบั้งแล้ว ต้องยังอยู่ในใบบั้ง (จำนวนไม่น้อยกว่าที่สแกน)
  for v_unit, v_got in
    select upper(btrim(cpm.part_no)), sum(greatest(al.qty, 1))::int
      from public.part_units pu join public.assembly_links al on al.parent_unit_id = pu.id
      join public.part_units cu on cu.id = al.child_unit_id join public.part_master cpm on cpm.id = cu.part_master_id
     where pu.part_master_id = p_pm group by 1
  loop
    select coalesce(sum((d->>'qty')::numeric), 0)::int into v_need from jsonb_array_elements(v_man) d where d->>'unit_no' = v_unit;
    if v_got > v_need then return 'packed:' || v_unit; end if;
  end loop;
  delete from public.bom_components where parent_pm_id = p_pm;
  for v_unit, v_need in
    select d->>'unit_no', sum((d->>'qty')::numeric)::int from jsonb_array_elements(v_man) d where d->>'unit_no' <> '' group by 1 order by 1
  loop
    select pm.id into v_pm from public.part_master pm
     where pm.project_id = p_project_id and upper(btrim(pm.part_no)) = v_unit and pm.id <> p_pm order by (pm.kind <> 'package') desc limit 1;
    if v_pm is null then return 'unit_not_found:' || v_unit; end if;
    v_seq := v_seq + 1;
    insert into public.bom_components (parent_pm_id, child_pm_id, qty, seq) values (p_pm, v_pm, greatest(v_need, 1), v_seq);
  end loop;
  update public.part_master
     set pkg_manifest = v_man,
         pkg_meta = coalesce(pkg_meta, '{}'::jsonb) || jsonb_build_object(
           'total_qty', (select coalesce(sum((d->>'qty')::numeric), 0) from jsonb_array_elements(v_man) d),
           'total_weight', (select coalesce(sum(case when (d->>'weight') ~ '^-?\d+(\.\d+)?$' then (d->>'weight')::numeric else 0 end), 0) from jsonb_array_elements(v_man) d),
           'total_sqm', (select coalesce(sum(case when (d->>'sqm') ~ '^-?\d+(\.\d+)?$' then (d->>'sqm')::numeric else 0 end), 0) from jsonb_array_elements(v_man) d))
   where id = p_pm;
  return null;
end $function$;
revoke all on function public._pk_apply_to_bunk(uuid, uuid, jsonb) from public, anon, authenticated;

-- อ่านตารางแพ็กกิ้งของโปรเจค → { boxes: […], dates: {…}, mods: […] }
create or replace function public.packing_list(p_token uuid, p_project_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare v_boxes jsonb; v_mods jsonb; v_dates jsonb;
begin
  perform public._require(p_token, 'office');
  with pk as (   -- บั้งของหน้าเครื่อง
    select pm.id as pm_id, coalesce(nullif(btrim(pm.pkg_meta->>'bunk_no'), ''), pm.part_no) as no, pm.pkg_manifest, pm.pkg_meta,
           (select coalesce(sum(greatest(al.qty, 1)), 0)::int from public.part_units pu join public.assembly_links al on al.parent_unit_id = pu.id where pu.part_master_id = pm.id) as packed
      from public.part_master pm where pm.project_id = p_project_id and pm.kind = 'package'
  ), bx as (
    select b.id, b.box_no, b.kind, b.title, b.location, b.level, b.updated_at, pk.pm_id, pk.packed,
           case when pk.pm_id is not null then public._pk_items_of_manifest(pk.pkg_manifest) else b.items end as items
      from public.packing_box b
      left join pk on upper(regexp_replace(pk.no, '\s+', '', 'g')) = upper(regexp_replace(b.box_no, '\s+', '', 'g'))
     where b.project_id = p_project_id
    union all
    select null, pk.no, 'panel', '', coalesce(pk.pkg_meta->>'elevation', ''), coalesce(pk.pkg_meta->>'level', ''), null, pk.pm_id, pk.packed,
           public._pk_items_of_manifest(pk.pkg_manifest)
      from pk
     where not exists (select 1 from public.packing_box b where b.project_id = p_project_id
                         and upper(regexp_replace(b.box_no, '\s+', '', 'g')) = upper(regexp_replace(pk.no, '\s+', '', 'g')))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', bx.id, 'at', bx.updated_at, 'box_no', bx.box_no, 'kind', bx.kind, 'title', bx.title, 'location', bx.location, 'level', bx.level, 'items', bx.items,
           'has_bunk', bx.pm_id is not null, 'packed', coalesce(bx.packed, 0),
           'ship', coalesce(c.shipment, ''), 'cntr', coalesce(c.container_no, '')) order by bx.box_no), '[]'::jsonb)
    into v_boxes
    from bx
    left join public.container_plan c on c.project_id = p_project_id
          and upper(regexp_replace(c.bunk_no, '\s+', '', 'g')) = upper(regexp_replace(bx.box_no, '\s+', '', 'g'));
  select coalesce(jsonb_agg(jsonb_build_object('mod_no', m.mod_no, 'reason', m.reason, 'changes', m.changes, 'at', m.created_at, 'by', e.name) order by m.mod_no desc), '[]'::jsonb)
    into v_mods from public.packing_mod m left join public.employees e on e.id = m.created_by where m.project_id = p_project_id;
  select coalesce(jsonb_object_agg(s.shipment, to_char(s.load_date, 'YYYY-MM-DD')), '{}'::jsonb) into v_dates from public.container_shipment s where s.project_id = p_project_id;
  return jsonb_build_object('boxes', v_boxes, 'mods', v_mods, 'dates', v_dates);
end $function$;

-- บันทึกตารางแพ็กกิ้ง
--   p_boxes  = [{ id?, box_no, kind, title, location, level, ship, cntr, items: [{ item, desc, pos, addr, len, w, h, unit, qty, wt }] }]  (เฉพาะกล่องที่เปลี่ยน)
--   p_delete = [id…]   ·   p_mode = 'normal' | 'modify'   ·   modify ต้องมีเหตุผล และเก็บ p_changes ([{ type, box, text }]) เป็นบันทึก M ถัดไป
--   กล่องที่มี id ส่ง "at" (updated_at ตอนโหลด) มาด้วยได้ — ถ้ามีคนแก้กล่องนั้นไปก่อน = conflict
--   ผิดจุดเดียว = ไม่บันทึกอะไรเลย → { ok:false, reason, box, unit }
create or replace function public.packing_save(p_token uuid, p_project_id uuid, p_boxes jsonb, p_delete jsonb, p_mode text, p_reason text, p_changes jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_emp uuid; b jsonb; i jsonb; v_no text; v_id uuid; v_kind text; v_pm uuid; v_err text; v_n int := 0; v_del int := 0; v_mod int; v_f text;
  v_ship text; v_cntr text; v_at timestamptz;
begin
  perform public._require(p_token, 'office');
  select s.employee_id into v_emp from public.sessions s where s.token = p_token limit 1;
  if p_project_id is null or not exists (select 1 from public.projects where id = p_project_id) then return jsonb_build_object('ok', false, 'reason', 'bad_project'); end if;
  if jsonb_typeof(coalesce(p_boxes, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_delete, '[]'::jsonb)) <> 'array' or coalesce(p_mode, '') not in ('normal', 'modify') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if p_mode = 'modify' and btrim(coalesce(p_reason, '')) = '' then return jsonb_build_object('ok', false, 'reason', 'need_reason'); end if;
  if jsonb_array_length(coalesce(p_boxes, '[]'::jsonb)) > 3000 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;

  -- ลบกล่อง (แถวของตารางนี้ + ที่อยู่ชิป / ตู้ของกล่องนั้น) — บั้งของหน้าเครื่องไม่ถูกลบ
  delete from public.container_plan c using public.packing_box x
   where x.project_id = p_project_id and x.id in (select (d #>> '{}')::uuid from jsonb_array_elements(coalesce(p_delete, '[]'::jsonb)) d)
     and c.project_id = p_project_id and upper(regexp_replace(c.bunk_no, '\s+', '', 'g')) = upper(regexp_replace(x.box_no, '\s+', '', 'g'));
  delete from public.packing_box x where x.project_id = p_project_id and x.id in (select (d #>> '{}')::uuid from jsonb_array_elements(coalesce(p_delete, '[]'::jsonb)) d);
  get diagnostics v_del = row_count;

  for b in select * from jsonb_array_elements(coalesce(p_boxes, '[]'::jsonb)) loop
    v_no := upper(btrim(coalesce(b->>'box_no', '')));
    if v_no = '' or length(v_no) > 60 then raise exception 'pk_bad_box:%', v_no; end if;
    v_kind := case when b->>'kind' = 'panel' then 'panel' else 'loose' end;
    if jsonb_typeof(coalesce(b->'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(b->'items', '[]'::jsonb)) > 2000 then raise exception 'pk_bad_items:%', v_no; end if;
    for i in select * from jsonb_array_elements(coalesce(b->'items', '[]'::jsonb)) loop
      if btrim(coalesce(i->>'item', '')) = '' then raise exception 'pk_bad_item:%', v_no; end if;
      if coalesce(i->>'qty', '') !~ '^\d+(\.\d+)?$' or (i->>'qty')::numeric <= 0 or (i->>'qty')::numeric > 1000000 then raise exception 'pk_bad_qty:%:%', v_no, upper(btrim(i->>'item')); end if;
      foreach v_f in array array['len', 'w', 'h', 'wt'] loop
        if coalesce(i->>v_f, '') <> '' and ((i->>v_f) !~ '^\d+(\.\d+)?$' or (i->>v_f)::numeric > 1000000) then raise exception 'pk_bad_number:%:%', v_no, upper(btrim(i->>'item')); end if;
      end loop;
    end loop;
    v_id := nullif(b->>'id', '')::uuid;
    begin
      if v_id is not null then
        -- ★ สองคนเปิดตารางพร้อมกัน: กล่องนี้ถูกแก้หลังจากที่ผู้ส่งโหลดมา ("at" ไม่ตรง) → ไม่บันทึกทับ (ล็อกแถวก่อนเทียบ)
        select x.updated_at into v_at from public.packing_box x where x.id = v_id and x.project_id = p_project_id for update;
        if not found then raise exception 'pk_not_found:%', v_no; end if;
        if coalesce(b->>'at', '') <> '' and v_at is distinct from (b->>'at')::timestamptz then raise exception 'pk_conflict:%', v_no; end if;
        update public.packing_box x set box_no = v_no, kind = v_kind, title = btrim(coalesce(b->>'title', '')), location = btrim(coalesce(b->>'location', '')),
               level = btrim(coalesce(b->>'level', '')), items = coalesce(b->'items', '[]'::jsonb), updated_by = v_emp, updated_at = now()
         where x.id = v_id and x.project_id = p_project_id;
        if not found then raise exception 'pk_not_found:%', v_no; end if;
      else
        insert into public.packing_box (project_id, box_no, kind, title, location, level, items, updated_by)
        values (p_project_id, v_no, v_kind, btrim(coalesce(b->>'title', '')), btrim(coalesce(b->>'location', '')), btrim(coalesce(b->>'level', '')), coalesce(b->'items', '[]'::jsonb), v_emp)
        on conflict (project_id, upper(regexp_replace(box_no, '\s+', '', 'g'))) do update
           set kind = excluded.kind, title = excluded.title, location = excluded.location, level = excluded.level, items = excluded.items, updated_by = excluded.updated_by, updated_at = now();
      end if;
    exception when unique_violation then raise exception 'pk_duplicate:%', v_no;
    end;
    -- ชิป / ตู้ → container_plan (ตู้เปลี่ยน = ตำแหน่งแถว / ช่องเดิมใช้ไม่ได้แล้ว · ขนาดบั้งคงเดิม)
    v_ship := btrim(coalesce(b->>'ship', '')); v_cntr := upper(btrim(coalesce(b->>'cntr', '')));
    insert into public.container_plan (project_id, shipment, container_no, bunk_no, updated_by) values (p_project_id, v_ship, v_cntr, v_no, v_emp)
    on conflict (project_id, upper(regexp_replace(bunk_no, '\s+', '', 'g'))) do update
       set shipment = excluded.shipment,
           row_no = case when public.container_plan.container_no = excluded.container_no then public.container_plan.row_no else null end,
           col_no = case when public.container_plan.container_no = excluded.container_no then public.container_plan.col_no else null end,
           container_no = excluded.container_no, updated_by = excluded.updated_by, updated_at = now();
    -- กล่องนี้เป็นบั้งของหน้าเครื่อง → เขียนใบบั้ง + BOM ให้ตรงกัน
    select pm.id into v_pm from public.part_master pm
     where pm.project_id = p_project_id and pm.kind = 'package'
       and upper(regexp_replace(coalesce(nullif(btrim(pm.pkg_meta->>'bunk_no'), ''), pm.part_no), '\s+', '', 'g')) = upper(regexp_replace(v_no, '\s+', '', 'g'))
     limit 1;
    if v_pm is not null then
      v_err := public._pk_apply_to_bunk(p_project_id, v_pm, coalesce(b->'items', '[]'::jsonb));
      if v_err is not null then raise exception 'pk_%:%', split_part(v_err, ':', 1), v_no || ':' || split_part(v_err, ':', 2); end if;
    end if;
    v_n := v_n + 1;
  end loop;

  if p_mode = 'modify' then
    perform pg_advisory_xact_lock(hashtextextended('packmod:' || p_project_id::text, 0));
    select coalesce(max(mod_no), 0) + 1 into v_mod from public.packing_mod where project_id = p_project_id;
    insert into public.packing_mod (project_id, mod_no, reason, changes, created_by)
    values (p_project_id, v_mod, btrim(p_reason), case when jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) = 'array' then coalesce(p_changes, '[]'::jsonb) else '[]'::jsonb end, v_emp);
  end if;
  return jsonb_build_object('ok', true, 'saved', v_n, 'deleted', v_del, 'mod_no', v_mod);
exception
  when raise_exception then
    if sqlerrm like 'pk\_%' then
      return jsonb_build_object('ok', false, 'reason', split_part(substr(sqlerrm, 4), ':', 1), 'box', split_part(sqlerrm, ':', 2), 'unit', split_part(sqlerrm, ':', 3));
    end if;
    raise;
end $function$;

revoke all on function public.packing_list(uuid, uuid) from public;
revoke all on function public.packing_save(uuid, uuid, jsonb, jsonb, text, text, jsonb) from public;
grant execute on function public.packing_list(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.packing_save(uuid, uuid, jsonb, jsonb, text, text, jsonb) to anon, authenticated, service_role;
