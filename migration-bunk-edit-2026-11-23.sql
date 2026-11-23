-- ══════════════════════════════════════════════════════════════════════════
-- migration-bunk-edit-2026-11-23.sql — ออฟฟิศย้ายแผงข้ามบั้งได้เอง (23/11/2026)
--   รัน 1 ครั้งใน Supabase SQL Editor · รันซ้ำได้ (create or replace) · ไม่แก้ข้อมูลเดิม
--   ต้องรัน migration-container-plan-2026-11-23.sql ก่อน (ใช้ตาราง container_plan)
--
--   ผู้ใช้: "บั้งมีการแก้บ่อยมาก อยากให้ออฟฟิศแก้ง่าย ๆ ย้ายแผงไปแพ็กนี้ ย้ายแผง / บั้ง ไปชิปอื่น"
--   bunk_board       = บั้งทั้งหมดของโปรเจค + รายการแผงในบั้ง (ใบบั้ง) + ที่สแกนแพ็กแล้ว + ตู้ / shipment
--   bunk_move_units  = ย้ายแผงจากบั้งหนึ่งไปอีกบั้ง ในครั้งเดียว (ใบบั้ง + BOM + ยอดรวม ของทั้งสองบั้ง) — พลาดจุดเดียว = ไม่เปลี่ยนอะไรเลย
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.bunk_board(p_token uuid, p_project_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._require(p_token, 'office');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'pm_id', pm.id, 'part_no', pm.part_no,
             'bunk_no', coalesce(nullif(btrim(pm.pkg_meta->>'bunk_no'), ''), pm.part_no),
             'meta', coalesce(pm.pkg_meta, '{}'::jsonb),
             'manifest', case when jsonb_typeof(pm.pkg_manifest) = 'array' then pm.pkg_manifest else '[]'::jsonb end,
             'qr', u.qr_code, 'status', u.status,
             'packed', coalesce((
                select jsonb_agg(jsonb_build_object('part_no', x.part_no, 'qty', x.qty) order by x.part_no)
                  from (select cpm.part_no, sum(greatest(al.qty, 1))::int as qty
                          from public.part_units pu
                          join public.assembly_links al on al.parent_unit_id = pu.id
                          join public.part_units cu on cu.id = al.child_unit_id
                          join public.part_master cpm on cpm.id = cu.part_master_id
                         where pu.part_master_id = pm.id
                         group by cpm.part_no) x), '[]'::jsonb),
             'plan', (select jsonb_build_object('id', c.id, 'shipment', c.shipment, 'container_no', c.container_no, 'row_no', c.row_no, 'col_no', c.col_no, 'len_mm', c.len_mm, 'w_mm', c.w_mm, 'note', c.note)
                        from public.container_plan c
                       where c.project_id = pm.project_id
                         and upper(regexp_replace(c.bunk_no, '\s+', '', 'g')) = upper(regexp_replace(coalesce(nullif(btrim(pm.pkg_meta->>'bunk_no'), ''), pm.part_no), '\s+', '', 'g'))
                       limit 1))
           order by pm.part_no)
      from public.part_master pm
      left join lateral (select pu.qr_code, pu.status from public.part_units pu where pu.part_master_id = pm.id order by pu.unit_no limit 1) u on true
     where pm.project_id = p_project_id and pm.kind = 'package'
  ), '[]'::jsonb);
end $function$;

-- ย้ายแผง: p_moves = [{ "idx": ลำดับในใบบั้งต้นทาง (เริ่ม 0), "unit_no": "UA0315" }, …]
--   unit_no ต้องตรงกับแถวที่ idx (กันหน้าจอค้างข้อมูลเก่า → stale)
--   แผงที่สแกนแพ็กเข้าบั้งต้นทางไปแล้ว ย้ายไม่ได้จนกว่าจะเอาออกที่หน้าเครื่อง (→ packed)
create or replace function public.bunk_move_units(p_token uuid, p_project_id uuid, p_from uuid, p_to uuid, p_moves jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_from public.part_master; v_to public.part_master;
  v_src jsonb; v_dst jsonb; v_keep jsonb := '[]'::jsonb; v_moved jsonb := '[]'::jsonb;
  v_idx int[]; v_el jsonb; v_i int; v_m jsonb; v_pos text; v_unit text; v_need int; v_got int; v_pm uuid; v_seq int;
  v_target public.part_master; v_man jsonb;
begin
  perform public._require(p_token, 'office');
  if p_from is null or p_to is null or p_from = p_to or jsonb_typeof(coalesce(p_moves, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_moves) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  -- ล็อกทั้งสองบั้งตามลำดับ id (สองคนย้ายสวนกันไม่ค้าง)
  perform 1 from public.part_master where id in (p_from, p_to) order by id for update;
  select * into v_from from public.part_master where id = p_from;
  select * into v_to from public.part_master where id = p_to;
  if v_from.id is null or v_to.id is null or v_from.project_id is distinct from p_project_id or v_to.project_id is distinct from p_project_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_from.kind <> 'package' or v_to.kind <> 'package' then
    return jsonb_build_object('ok', false, 'reason', 'not_bunk');
  end if;
  v_src := case when jsonb_typeof(v_from.pkg_manifest) = 'array' then v_from.pkg_manifest else '[]'::jsonb end;
  v_dst := case when jsonb_typeof(v_to.pkg_manifest) = 'array' then v_to.pkg_manifest else '[]'::jsonb end;

  -- ตรวจรายการที่ขอย้าย
  for v_m in select * from jsonb_array_elements(p_moves) loop
    if coalesce(v_m->>'idx', '') !~ '^\d+$' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    v_i := (v_m->>'idx')::int;
    if v_i >= jsonb_array_length(v_src) or upper(btrim(coalesce(v_src->v_i->>'unit_no', ''))) <> upper(btrim(coalesce(v_m->>'unit_no', ''))) then
      return jsonb_build_object('ok', false, 'reason', 'stale', 'unit', v_m->>'unit_no');
    end if;
    if v_i = any(coalesce(v_idx, '{}')) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    v_idx := coalesce(v_idx, '{}') || v_i;
  end loop;

  -- แยกแถว: อยู่ต่อ / ย้าย · แถวที่ย้าย ตำแหน่งในบั้ง (A/B/C…) ชนกับของบั้งปลายทาง = ล้างตำแหน่ง ให้ออฟฟิศกำหนดใหม่
  for v_i in 0 .. jsonb_array_length(v_src) - 1 loop
    v_el := v_src->v_i;
    if v_i = any(v_idx) then
      v_pos := upper(btrim(coalesce(v_el->>'position', '')));
      if v_pos <> '' and exists (select 1 from jsonb_array_elements(v_dst || v_moved) d where upper(btrim(coalesce(d->>'position', ''))) = v_pos) then
        v_el := v_el || jsonb_build_object('position', '');
      end if;
      v_moved := v_moved || jsonb_build_array(v_el);
    else
      v_keep := v_keep || jsonb_build_array(v_el);
    end if;
  end loop;

  -- แผงที่แพ็กเข้าบั้งต้นทางแล้ว: หลังย้าย จำนวนที่ต้องใส่ต้องไม่น้อยกว่าที่สแกนไปแล้ว
  for v_unit in select distinct upper(btrim(coalesce(d->>'unit_no', ''))) from jsonb_array_elements(v_moved) d loop
    select coalesce(sum(greatest(coalesce(nullif(d->>'qty', '')::numeric, 1), 1)), 0)::int into v_need
      from jsonb_array_elements(v_keep) d where upper(btrim(coalesce(d->>'unit_no', ''))) = v_unit;
    select coalesce(sum(greatest(al.qty, 1)), 0)::int into v_got
      from public.part_units pu
      join public.assembly_links al on al.parent_unit_id = pu.id
      join public.part_units cu on cu.id = al.child_unit_id
      join public.part_master cpm on cpm.id = cu.part_master_id
     where pu.part_master_id = p_from and upper(btrim(cpm.part_no)) = v_unit;
    if v_got > v_need then
      return jsonb_build_object('ok', false, 'reason', 'packed', 'unit', v_unit, 'packed', v_got);
    end if;
  end loop;

  v_dst := v_dst || v_moved;
  -- เขียนใบบั้ง + BOM + ยอดรวม ของทั้งสองบั้ง
  for v_i in 1 .. 2 loop
    if v_i = 1 then v_target := v_from; v_man := v_keep; else v_target := v_to; v_man := v_dst; end if;
    -- เรียงเลขลำดับ (no) ใหม่ 1..n
    select coalesce(jsonb_agg(d.el || jsonb_build_object('no', d.ord) order by d.ord), '[]'::jsonb) into v_man
      from jsonb_array_elements(v_man) with ordinality as d(el, ord);
    delete from public.bom_components where parent_pm_id = v_target.id;
    v_seq := 0;
    for v_unit, v_need in
      select upper(btrim(coalesce(d->>'unit_no', ''))), sum(greatest(coalesce(nullif(d->>'qty', '')::numeric, 1), 1))::int
        from jsonb_array_elements(v_man) d where btrim(coalesce(d->>'unit_no', '')) <> '' group by 1 order by 1
    loop
      select pm.id into v_pm from public.part_master pm
       where pm.project_id = p_project_id and upper(btrim(pm.part_no)) = v_unit and pm.id <> v_target.id
       order by (pm.kind <> 'package') desc limit 1;
      if v_pm is null then raise exception 'bm_unit_not_found:%', v_unit; end if;
      v_seq := v_seq + 1;
      insert into public.bom_components (parent_pm_id, child_pm_id, qty, seq) values (v_target.id, v_pm, greatest(v_need, 1), v_seq);
    end loop;
    update public.part_master
       set pkg_manifest = v_man,
           pkg_meta = coalesce(pkg_meta, '{}'::jsonb) || jsonb_build_object(
             'total_qty', (select coalesce(sum(greatest(coalesce(nullif(d->>'qty', '')::numeric, 1), 1)), 0) from jsonb_array_elements(v_man) d),
             'total_weight', (select coalesce(sum(case when (d->>'weight') ~ '^-?\d+(\.\d+)?$' then (d->>'weight')::numeric else 0 end), 0) from jsonb_array_elements(v_man) d),
             'total_sqm', (select coalesce(sum(case when (d->>'sqm') ~ '^-?\d+(\.\d+)?$' then (d->>'sqm')::numeric else 0 end), 0) from jsonb_array_elements(v_man) d))
     where id = v_target.id;
  end loop;
  return jsonb_build_object('ok', true, 'moved', jsonb_array_length(v_moved), 'from_left', jsonb_array_length(v_keep), 'to_total', jsonb_array_length(v_dst));
exception
  when raise_exception then
    if sqlerrm like 'bm\_%' then
      return jsonb_build_object('ok', false, 'reason', split_part(substr(sqlerrm, 4), ':', 1), 'unit', split_part(sqlerrm, ':', 2));
    end if;
    raise;
end $function$;

revoke all on function public.bunk_board(uuid, uuid) from public;
revoke all on function public.bunk_move_units(uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.bunk_board(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.bunk_move_units(uuid, uuid, uuid, uuid, jsonb) to anon, authenticated, service_role;
