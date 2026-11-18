-- ══════════════════════════════════════════════════════════════════════════
-- migration-wrong-station-2026-11-18.sql — จากรอบทดสอบจำลองฝั่งหน้าเครื่อง (SIM4) 18/11/2026 · ผู้ใช้: "ข้อ 3: กัน"
-- รันซ้ำได้ (create or replace) · ไม่แก้ข้อมูลเดิม
--
-- record_machine_work: เพิ่มการกัน "แผง / แพ็ก บนเครื่องงานตัด-เจาะ" → คืน { ok:false, reason:'wrong_station' }
--   ส่วนอื่นของฟังก์ชันเหมือนเดิมทุกบรรทัด (คัดจากฐานข้อมูลหลังรัน migration ก่อนหน้าครบ)
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_machine_work(p_token text, p_qr text, p_quantity integer, p_material_length numeric, p_process_seconds integer, p_status text, p_client_id uuid DEFAULT NULL::uuid, p_recorded_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp   public.employees;
  v_unit  public.part_units;
  v_pm    public.part_master;
  v_rel   public.releases;
  v_cq    public.release_cancelled_qr;
  v_wpp   numeric;
  v_id    uuid;
  v_op    uuid;
  v_has_caps boolean;
  v_when  timestamptz := coalesce(p_recorded_at, now());
  v_daily jsonb;
  v_row   jsonb;
  v_process_cum numeric;
  v_lock_key   text;
  v_today date;
begin
  -- กันเวลาเครื่องผิด: อนาคตเกิน 5 นาที หรืออดีตเกิน 30 วัน = เชื่อไม่ได้ → ใช้ now()
  if v_when > now() + interval '5 minutes' or v_when < now() - interval '30 days' then
    v_when := now();
  end if;
  v_today := (v_when at time zone 'Asia/Bangkok')::date;
  v_emp := public._mls_session_employee(p_token);
  if v_emp.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthorized'); end if;
  if v_emp.machine_id is null then return jsonb_build_object('ok', false, 'reason', 'no_machine'); end if;

  -- ยอมรับจำนวน 0 (ขั้นตอนที่ติ๊กร่วม co-tick) · ยังกัน null และจำนวนติดลบ
  if p_quantity is null or p_quantity < 0 then return jsonb_build_object('ok', false, 'reason', 'bad_quantity'); end if;
  if p_status not in ('finished','inprocess') then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;

  -- เลือกขั้นตอนที่จะบันทึก
  if p_operation_id is not null then
    select exists(select 1 from public.machine_operations where machine_id = v_emp.machine_id) into v_has_caps;
    if v_has_caps then
      perform 1 from public.machine_operations
        where machine_id = v_emp.machine_id and operation_id = p_operation_id;
      if not found then return jsonb_build_object('ok', false, 'reason', 'machine_cannot'); end if;
    end if;
    v_op := p_operation_id;
  else
    v_op := v_emp.operation_id;
  end if;

  -- กันข้อมูลซ้ำ (idempotency) — งานที่บันทึกไปแล้ว ยังซิงค์ซ้ำได้
  if p_client_id is not null then
    perform 1 from public.machine_records where client_id = p_client_id limit 1;
    if found then return jsonb_build_object('ok', true, 'deduped', true); end if;
  end if;

  select * into v_unit from public.part_units where qr_code = btrim(p_qr) limit 1;
  if v_unit.id is null then
    -- ★ M1: QR ที่ถูกยกเลิกใน Modify → บอกให้ชัด (คิวออฟไลน์เข้า "งานค้างซิงค์" พร้อมเหตุผลนี้)
    select * into v_cq from public.release_cancelled_qr where qr_code = btrim(p_qr);
    if v_cq.qr_code is not null then
      return jsonb_build_object('ok', false, 'reason', 'qr_cancelled', 'version', v_cq.version, 'part_no', v_cq.part_no,
                                'message', format('QR นี้ถูกยกเลิกใน %s (%s) — ไม่ต้องทำชิ้นนี้ · แจ้งออฟฟิศถ้าทำไปแล้ว', v_cq.version, v_cq.why));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_pm from public.part_master where id = v_unit.part_master_id;

  -- กันบันทึกเข้าโปรเจกต์ที่ "ปิดแล้ว"
  if exists (select 1 from public.projects pj where pj.id = v_pm.project_id and pj.status = 'closed') then
    return jsonb_build_object('ok', false, 'reason', 'project_closed');
  end if;

  -- ★ 2026-11-18 sim-test SIM4: แผง / แพ็ก บันทึกที่เครื่องงานตัด-เจาะ (ขั้นตอนชนิด machining) ไม่ได้ — ต้องทำที่สเตชันแผง / แพ็ก
  --   (เดิมสแกน QR แผงบนเครื่องตัดแล้วบันทึกเป็นงาน "ตัด" ได้ ยอดปนกับสเตชันแผง) · พาร์ท / ซับ ไม่เปลี่ยน
  if coalesce(v_pm.kind, 'part') in ('panel', 'package')
     and exists (select 1 from public.operations o where o.id = v_op and coalesce(o.op_type, 'machining') = 'machining') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_station', 'part_no', v_pm.part_no, 'kind', v_pm.kind,
                              'message', format('%s เป็น%s — บันทึกที่เครื่องนี้ไม่ได้ · ใช้สเตชัน%s', v_pm.part_no,
                                                case v_pm.kind when 'panel' then 'แผง' else 'แพ็ก' end, case v_pm.kind when 'panel' then 'แผง' else 'แพ็ก' end));
  end if;

  -- ★ M2: Part ถูกยกเลิกใน Modify → ไม่รับงานเพิ่ม
  select * into v_rel from public.releases where id = v_unit.release_id;
  if v_rel.mod_cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'release_cancelled', 'version', v_rel.mod_version, 'part_no', v_pm.part_no,
                              'message', format('%s ถูกยกเลิกใน %s — หยุดทำ · บันทึกไม่ได้', v_pm.part_no, coalesce(v_rel.mod_version, 'Modify')));
  end if;

  -- advisory lock ต่อ (release + ขั้นตอน) — สแกนงานเดียวกันเข้าคิวทีละเครื่อง
  v_lock_key := coalesce(v_unit.release_id, v_unit.part_master_id)::text || ':' || coalesce(v_op::text, '');
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  v_wpp := coalesce(v_unit.weight, v_pm.unit_weight, 0);

  insert into public.machine_records(
    machine_id, operation_id, part_master_id, release_id, part_unit_id,
    quantity, material_length_mm, weight, process_seconds, status, employee_id,
    client_id, recorded_at
  ) values (
    v_emp.machine_id, v_op, v_unit.part_master_id, v_unit.release_id, v_unit.id,
    p_quantity, p_material_length, round(p_quantity * v_wpp, 3), coalesce(p_process_seconds,0), p_status, v_emp.id,
    p_client_id, v_when
  )
  on conflict (client_id) where client_id is not null do nothing
  returning id into v_id;

  if v_id is null then return jsonb_build_object('ok', true, 'deduped', true); end if;

  select jsonb_build_object(
           'quantity',        coalesce(sum(quantity), 0),
           'weight',          coalesce(sum(weight), 0),
           'process_seconds', coalesce(sum(process_seconds), 0))
    into v_daily
  from public.machine_records
  where machine_id = v_emp.machine_id
    and (recorded_at at time zone 'Asia/Bangkok')::date = v_today;

  select coalesce(sum(quantity), 0) into v_process_cum
  from public.machine_records
  where coalesce(release_id, part_master_id) = coalesce(v_unit.release_id, v_unit.part_master_id)
    and operation_id = v_op
    and recorded_at <= v_when;

  with rows as (
    select mr.*,
           row_number() over (order by mr.recorded_at) as item,
           coalesce(mr.snap_part_no, pm.part_no) as part_no,          -- ★ M3: ค่าที่แช่แข็งไว้ตอนบันทึก
           coalesce(mr.snap_mdf_no, pm.mdf_no)   as mdf_no,
           pm.rev,
           coalesce(mr.snap_inv, pm.material, pm.inventory_code) as inventory_code,
           pm.unit_weight,
           coalesce(pu.length_mm, pm.default_length_mm) as part_length_mm,
           op.seq as op_seq, rel.release_order,
           coalesce(mr.snap_req, rel.qty) as req
    from public.machine_records mr
    left join public.part_master pm on pm.id = mr.part_master_id
    left join public.part_units  pu on pu.id = mr.part_unit_id
    left join public.operations  op on op.id = mr.operation_id
    left join public.releases    rel on rel.id = mr.release_id
    where mr.machine_id = v_emp.machine_id
      and (mr.recorded_at at time zone 'Asia/Bangkok')::date = v_today
  )
  select jsonb_build_object(
           'id', id, 'item', item, 'mdf_no', mdf_no, 'rel_no', release_order,
           'part_no', part_no, 'rev', rev, 'qty', quantity, 'req', req,
           'process_cum', v_process_cum,
           'balance', case when req is not null then v_process_cum - req else null end,
           'length_mm', part_length_mm, 'weight', unit_weight,
           'materials_length', material_length_mm, 'inventory_code', inventory_code,
           'process_seconds', process_seconds, 'status', status, 'status_seq', op_seq)
    into v_row
  from rows where id = v_id;

  return jsonb_build_object('ok', true, 'row', v_row, 'daily', v_daily);
end;
$function$;

notify pgrst, 'reload schema';
