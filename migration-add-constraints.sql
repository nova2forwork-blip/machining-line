-- ════════════════════════════════════════════════════════════
-- Migration: ความสามารถของเครื่องจักร + ตัวนับความคืบหน้า
-- รองรับ: เครื่องหนึ่งทำได้หลายขั้นตอน, ตรวจตอนสแกนว่าเครื่องทำขั้นตอนนั้นได้จริง,
--          และแยกน้ำหนักของเครื่องออกเป็นราย-ขั้นตอนในรายงาน
--
-- วิธีใช้: Supabase Dashboard → SQL Editor → New Query → วางทั้งหมด → Run
-- (รันได้แม้เคย setup ฐานข้อมูลไปแล้ว — ใช้ if not exists ทั้งหมด)
-- ════════════════════════════════════════════════════════════

-- 1) ความสามารถของเครื่อง (many-to-many): เครื่อง 1 ตัว ทำได้หลายขั้นตอน /
--    ขั้นตอน 1 อย่าง ทำได้หลายเครื่อง
create table if not exists public.machine_operations (
  machine_id   uuid not null references public.machines(id)   on delete cascade,
  operation_id uuid not null references public.operations(id) on delete cascade,
  primary key (machine_id, operation_id)
);

alter table public.machine_operations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'machine_operations' and policyname = 'allow_all'
  ) then
    create policy "allow_all" on public.machine_operations for all using (true) with check (true);
  end if;
end $$;

-- 2) (ทางเลือกขั้นสูง) ตัวนับจำนวนขั้นตอนที่ชิ้นงานผ่านไปแล้ว
--    ใช้คำนวณ "น้ำหนักงานที่คืบหน้า" แบบถ่วงตามขั้นตอน (weightedProgress ใน metrics.js)
--    ชิ้น 10 กก. ทำ 2/4 ขั้น = งานคืบหน้า 5 กก.
alter table public.part_units add column if not exists steps_done int not null default 0;

-- เติมค่าย้อนหลังให้ชิ้นที่เสร็จแล้ว = จำนวนขั้นตอนใน routing ของ Part นั้น
update public.part_units pu
set steps_done = coalesce(jsonb_array_length(pm.routing), 0)
from public.part_master pm
where pu.part_master_id = pm.id
  and pu.status = 'finished'
  and pu.steps_done = 0;
