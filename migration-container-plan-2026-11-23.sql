-- ══════════════════════════════════════════════════════════════════════════
-- migration-container-plan-2026-11-23.sql — แผนลงตู้ (Container loading plan) 23/11/2026
--   รัน 1 ครั้งใน Supabase SQL Editor · รันซ้ำได้ · ไม่แตะตาราง / ข้อมูลเดิม
--
--   1 แถว = บั้ง 1 บั้ง (หรือของ 1 อย่างที่ลงตู้) อยู่ตู้ไหน shipment ไหน ตำแหน่งไหน
--   ผูกกับบั้งในระบบด้วย "เลขบั้ง" (part_master.part_no ของโปรเจคเดียวกัน · kind = package) — ลงแผนก่อนมีบั้งในระบบได้
--   อ่าน / เขียนผ่าน RPC เท่านั้น (ต้องมี token · สิทธิ์ office ขึ้นไป) — anon อ่านตารางตรงไม่ได้
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.container_plan (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  shipment     text not null default '',
  container_no text not null default '',
  bunk_no      text not null check (btrim(bunk_no) <> '' and length(bunk_no) <= 60),
  row_no       integer check (row_no between 1 and 99),
  col_no       integer check (col_no between 1 and 99),
  len_mm       numeric check (len_mm > 0 and len_mm <= 30000),
  w_mm         numeric check (w_mm > 0 and w_mm <= 30000),
  note         text,
  updated_by   uuid references public.employees(id) on delete set null,
  updated_at   timestamptz not null default now()
);
-- 1 โปรเจค: เลขบั้งเดียวอยู่ได้ตู้เดียว (ไม่สนตัวพิมพ์ / ช่องว่าง)
create unique index if not exists container_plan_project_bunk_uniq
  on public.container_plan (project_id, upper(regexp_replace(bunk_no, '\s+', '', 'g')));
create index if not exists container_plan_project_idx on public.container_plan (project_id, shipment, container_no);

alter table public.container_plan enable row level security;
revoke all on public.container_plan from anon;
revoke all on public.container_plan from authenticated;

-- รายการแผนลงตู้ของโปรเจค + สถานะบั้งในระบบ (มีบั้งไหม · แพ็กแล้วกี่ยูนิตจากกี่ยูนิต)
create or replace function public.container_plan_list(p_token uuid, p_project_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._require(p_token, 'office');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'shipment', c.shipment, 'container_no', c.container_no, 'bunk_no', c.bunk_no,
             'row_no', c.row_no, 'col_no', c.col_no, 'len_mm', c.len_mm, 'w_mm', c.w_mm, 'note', c.note,
             'updated_at', c.updated_at, 'updated_by_name', e.name,
             'bunk', b.info)
           order by c.shipment, c.container_no, c.row_no nulls last, c.col_no nulls last, c.bunk_no)
      from public.container_plan c
      left join public.employees e on e.id = c.updated_by
      left join lateral (
        select jsonb_build_object(
                 'pm_id', pm.id, 'kind', pm.kind,
                 'units', case when jsonb_typeof(pm.pkg_manifest) = 'array' then jsonb_array_length(pm.pkg_manifest) else null end,
                 'packed', (select coalesce(sum(greatest(al.qty, 1)), 0)
                              from public.part_units pu join public.assembly_links al on al.parent_unit_id = pu.id
                             where pu.part_master_id = pm.id),
                 'qr', (select pu.qr_code from public.part_units pu where pu.part_master_id = pm.id order by pu.unit_no limit 1),
                 'status', (select pu.status from public.part_units pu where pu.part_master_id = pm.id order by pu.unit_no limit 1)
               ) as info
          from public.part_master pm
         where pm.project_id = c.project_id
           and upper(regexp_replace(pm.part_no, '\s+', '', 'g')) = upper(regexp_replace(c.bunk_no, '\s+', '', 'g'))
         order by (pm.kind = 'package') desc
         limit 1
      ) b on true
     where c.project_id = p_project_id
  ), '[]'::jsonb);
end $function$;

-- บันทึกแผนลงตู้: p_rows = [{ id?, shipment, container_no, bunk_no, row_no, col_no, len_mm, w_mm, note }] · p_delete = [id…]
--   แถวมี id = แก้แถวนั้น · ไม่มี id = เพิ่ม (เลขบั้งมีอยู่แล้วในโปรเจค = แก้แถวเดิม)
--   ผิดพลาดแถวเดียว = ไม่บันทึกทั้งชุด → { ok:false, reason, bunk }
create or replace function public.container_plan_save(p_token uuid, p_project_id uuid, p_rows jsonb, p_delete jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_emp uuid;
  r     jsonb;
  v_id  uuid;
  v_bunk text;
  v_n   integer := 0;
  v_del integer := 0;
  v_num text;
begin
  perform public._require(p_token, 'office');
  select s.employee_id into v_emp from public.sessions s where s.token = p_token limit 1;
  if p_project_id is null or not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_object('ok', false, 'reason', 'bad_project');
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_delete, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  delete from public.container_plan c
   where c.project_id = p_project_id
     and c.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_delete, '[]'::jsonb)) x);
  get diagnostics v_del = row_count;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_bunk := upper(btrim(coalesce(r->>'bunk_no', '')));
    if v_bunk = '' or length(v_bunk) > 60 then
      raise exception 'cp_bad_bunk:%', v_bunk;
    end if;
    -- ตัวเลข: ค่าว่าง = null · ไม่ใช่ตัวเลข / นอกช่วง = ไม่บันทึกทั้งชุด
    foreach v_num in array array['row_no', 'col_no', 'len_mm', 'w_mm'] loop
      if coalesce(btrim(r->>v_num), '') <> '' and (r->>v_num) !~ '^\d+(\.\d+)?$' then
        raise exception 'cp_bad_number:%', v_bunk;
      end if;
    end loop;
    v_id := nullif(r->>'id', '')::uuid;
    begin
      if v_id is not null then
        update public.container_plan c
           set shipment = btrim(coalesce(r->>'shipment', '')), container_no = upper(btrim(coalesce(r->>'container_no', ''))), bunk_no = v_bunk,
               row_no = nullif(btrim(r->>'row_no'), '')::numeric::integer, col_no = nullif(btrim(r->>'col_no'), '')::numeric::integer,
               len_mm = nullif(btrim(r->>'len_mm'), '')::numeric, w_mm = nullif(btrim(r->>'w_mm'), '')::numeric,
               note = nullif(btrim(coalesce(r->>'note', '')), ''), updated_by = v_emp, updated_at = now()
         where c.id = v_id and c.project_id = p_project_id;
        if not found then raise exception 'cp_not_found:%', v_bunk; end if;
      else
        insert into public.container_plan (project_id, shipment, container_no, bunk_no, row_no, col_no, len_mm, w_mm, note, updated_by)
        values (p_project_id, btrim(coalesce(r->>'shipment', '')), upper(btrim(coalesce(r->>'container_no', ''))), v_bunk,
                nullif(btrim(r->>'row_no'), '')::numeric::integer, nullif(btrim(r->>'col_no'), '')::numeric::integer,
                nullif(btrim(r->>'len_mm'), '')::numeric, nullif(btrim(r->>'w_mm'), '')::numeric,
                nullif(btrim(coalesce(r->>'note', '')), ''), v_emp)
        on conflict (project_id, upper(regexp_replace(bunk_no, '\s+', '', 'g'))) do update
           set shipment = excluded.shipment, container_no = excluded.container_no, row_no = excluded.row_no, col_no = excluded.col_no,
               len_mm = excluded.len_mm, w_mm = excluded.w_mm, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
      end if;
    exception
      when unique_violation then raise exception 'cp_duplicate:%', v_bunk;
      when check_violation then raise exception 'cp_bad_number:%', v_bunk;
    end;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'saved', v_n, 'deleted', v_del);
exception
  when raise_exception then
    -- ข้อผิดพลาดของเราเอง (cp_…) → ย้อนทั้งชุด แล้วตอบ ok:false · อย่างอื่น (เช่น forbidden) ส่งต่อ
    if sqlerrm like 'cp\_%' then
      return jsonb_build_object('ok', false, 'reason', split_part(substr(sqlerrm, 4), ':', 1), 'bunk', split_part(sqlerrm, ':', 2));
    end if;
    raise;
end $function$;

revoke all on function public.container_plan_list(uuid, uuid) from public;
revoke all on function public.container_plan_save(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.container_plan_list(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.container_plan_save(uuid, uuid, jsonb, jsonb) to anon, authenticated, service_role;
