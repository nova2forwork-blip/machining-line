-- ─── release_machine_progress: ความคืบหน้าของ Release "แยกตามเครื่องจักร" ──────────
-- ใช้ในป็อปอัป "ความคืบหน้า — <part>" (PartProgressModal) แทนการแยกตามขั้นตอนล้วน ๆ
-- ตอบว่า "พาร์ทเบอร์นี้ ทำจากเครื่องไหน · ขั้นตอนไหนบ้าง · เสร็จ/กำลังทำกี่ชิ้น"
--
-- v3: แสดง "ทุกขั้นตอนที่ติ๊กไว้หน้าเครื่อง" ให้ครบ
--     ปัญหาเดิม: หน้าเครื่องติ๊กหลายขั้นตอนในสแกนเดียว → ขั้นตอน "หลัก" ถือจำนวน (quantity)
--       ส่วนขั้นตอนที่ติ๊กร่วม (co-tick) ถูกบันทึกเป็น quantity 0 → v2 กรอง done=0 ทิ้ง เลยขึ้นแค่ขั้นตอนหลัก
--     แก้: คิดจำนวนราย "ชิ้น" (part_unit) แล้ว "กระจายจำนวนของชิ้นไปทุกขั้นตอนที่ชิ้นนั้นผ่าน"
--          → ทุกขั้นตอนที่ติ๊กจะโชว์ พร้อมจำนวนเท่าจำนวนชิ้นที่ผ่านขั้นตอนนั้นจริง
--
-- คืน jsonb: { "<release_id>": [ {
--     machine_id, code, name,
--     done, finished,                          -- ยอดรวมของเครื่อง (จำนวนชิ้นจริง ไม่คูณตามจำนวนขั้นตอน)
--     ops:  [ {name, seq, done, finished}, ... ],   -- แยกทุกขั้นตอนที่เครื่องนี้ทำ/ติ๊กกับพาร์ทนี้
--     caps: [ {name, seq}, ... ]               -- "ความสามารถที่แอดมินตั้ง" (machine_operations) ทั้งหมด
--   }, ... ] }
--   * จำนวนราย op ใช้ max(quantity) ต่อชิ้น (กัน co-tick 0 และกันนับซ้ำหลายสแกน) แล้วรวมข้ามชิ้น
--   * เรียงเครื่องที่ทำมากสุดก่อน · เรียง ops/caps ตาม seq
--
-- ปลอดภัย: STABLE SECURITY DEFINER + search_path=public (อ่านอย่างเดียว) · CREATE OR REPLACE รันซ้ำได้
-- รันครั้งเดียวที่ Supabase → SQL Editor (มี GRANT ให้ anon/authenticated ท้ายไฟล์)

CREATE OR REPLACE FUNCTION public.release_machine_progress(p_release_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pu as (                                     -- ต่อ (release, เครื่อง, ชิ้น): จำนวนตัวแทน + จำนวนที่เสร็จ
    select mr.release_id, mr.machine_id, mr.part_unit_id,
           max(mr.quantity)::int as qty,           -- max: กัน co-tick=0 · กันนับซ้ำหลายสแกนของชิ้นเดียว
           max(case when mr.status = 'finished' then mr.quantity else 0 end)::int as finq
    from public.machine_records mr
    where mr.release_id = any(p_release_ids)
      and mr.machine_id is not null
      and mr.part_unit_id is not null
    group by mr.release_id, mr.machine_id, mr.part_unit_id
  ),
  pu_ops as (                                      -- ต่อชิ้น: ทุกขั้นตอนที่ชิ้นนี้ผ่าน (รวม co-tick quantity 0)
    select distinct mr.release_id, mr.machine_id, mr.part_unit_id, mr.operation_id
    from public.machine_records mr
    where mr.release_id = any(p_release_ids)
      and mr.machine_id is not null
      and mr.part_unit_id is not null
      and mr.operation_id is not null
  ),
  base as (                                        -- ต่อ (release, เครื่อง, ขั้นตอน): รวมจำนวนของชิ้นที่ผ่านขั้นตอนนั้น
    select po.release_id, po.machine_id, po.operation_id,
           sum(pu.qty)::int  as done,
           sum(pu.finq)::int as finished
    from pu_ops po
    join pu on pu.release_id = po.release_id
           and pu.machine_id = po.machine_id
           and pu.part_unit_id = po.part_unit_id
    group by po.release_id, po.machine_id, po.operation_id
  ),
  mtot as (                                        -- ยอดรวมต่อ (release, เครื่อง) = จำนวนชิ้นจริง (ไม่คูณตามจำนวนขั้นตอน)
    select mr.release_id, mr.machine_id,
           sum(mr.quantity)::int as done,
           sum(case when mr.status = 'finished' then mr.quantity else 0 end)::int as finished
    from public.machine_records mr
    where mr.release_id = any(p_release_ids)
      and mr.machine_id is not null
    group by mr.release_id, mr.machine_id
  ),
  opagg as (                                       -- แยกรายขั้นตอน (ทุกขั้นตอนที่ทำ/ติ๊ก) เรียงตาม seq
    select b.release_id, b.machine_id,
           coalesce(jsonb_agg(
             jsonb_build_object('name', op.name, 'seq', op.seq, 'done', b.done, 'finished', b.finished)
             order by op.seq nulls last, op.name
           ) filter (where op.id is not null), '[]'::jsonb) as ops
    from base b
    left join public.operations op on op.id = b.operation_id
    group by b.release_id, b.machine_id
  ),
  caps as (                                        -- ความสามารถที่แอดมินตั้ง (ทั้งหมด)
    select mt.release_id, mt.machine_id,
           coalesce(jsonb_agg(
             jsonb_build_object('name', op.name, 'seq', op.seq)
             order by op.seq nulls last, op.name
           ) filter (where op.id is not null), '[]'::jsonb) as caps
    from mtot mt
    left join public.machine_operations mo on mo.machine_id = mt.machine_id
    left join public.operations op on op.id = mo.operation_id
    group by mt.release_id, mt.machine_id
  )
  select coalesce(jsonb_object_agg(rid, arr), '{}'::jsonb)
  from (
    select mt.release_id::text as rid,
           jsonb_agg(
             jsonb_build_object(
               'machine_id', mt.machine_id,
               'code', m.code,
               'name', m.name,
               'done', mt.done,
               'finished', mt.finished,
               'ops',  coalesce(oa.ops,  '[]'::jsonb),
               'caps', coalesce(c.caps, '[]'::jsonb)
             ) order by mt.done desc, m.code
           ) as arr
    from mtot mt
    left join public.machines m on m.id = mt.machine_id
    left join opagg oa on oa.release_id = mt.release_id and oa.machine_id = mt.machine_id
    left join caps  c  on c.release_id  = mt.release_id and c.machine_id  = mt.machine_id
    group by mt.release_id
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.release_machine_progress(uuid[]) TO anon, authenticated;

-- ── ตรวจผล (ทางเลือก) — ใส่ release_id จริงลงไป ──
-- select jsonb_pretty(public.release_machine_progress(array['<release-uuid>']::uuid[]));
