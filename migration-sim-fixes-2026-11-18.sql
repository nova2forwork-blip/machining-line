-- ══════════════════════════════════════════════════════════════════════════
-- migration-sim-fixes-2026-11-18.sql — จากรอบทดสอบจำลองฝั่ง office 18/11/2026
-- รันซ้ำได้ (create or replace / drop if exists) · ไม่แก้ข้อมูลเดิม
--
-- 1) create_release_batch_checked — ปล่อยล็อตแบบตรวจยอดในฐานข้อมูล (กันสองหน้าต่างปล่อยเบอร์เดียวกันพร้อมกันจนเกินยอดต้องใช้)
--    หน้าจอตรวจให้อยู่แล้วก่อนสร้างล็อต แต่ยังมีช่องว่างระหว่าง "ตรวจ" กับ "สร้าง" → ฟังก์ชันนี้ล็อกต่อใบ (advisory lock)
--    แล้วตรวจ + สร้างใน transaction เดียว · โค้ดหน้าจอเรียกตัวนี้ ถ้ายังไม่ได้รัน migration จะถอยไปใช้ create_release_batch เดิม
-- 2) rel_units_follow — แก้น้ำหนัก/ชิ้น หรือความยาว ของแถวปล่อย (releases) แล้ว QR ทุกดวงของแถวนั้น (part_units) ตามด้วย
--    (เดิม: กด "อัปเดตความยาว · วัสดุ · น้ำหนัก" แก้แค่ releases — น้ำหนักบน QR ยังเป็นค่าเดิม / 0)
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1) ปล่อยล็อตแบบตรวจยอด ───────────────────────────────────────────────
--   p_plan_ro = เลขใบหลัก (เช่น P-002) · ล็อตของใบ = P-002 และ P-002.x
--   p_limits  = [{ "code": "MAL132-5001 A", "max": 8 }, …] ยอดต้องใช้ทั้งใบของเบอร์ที่กำลังจะปล่อย (ไม่ใส่เบอร์ไหน = ไม่ตรวจเบอร์นั้น)
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
  perform public._require(p_token, 'operator');
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

revoke all on function public.create_release_batch_checked(uuid, uuid, text, timestamptz, uuid, boolean, jsonb, text, jsonb) from public;
grant execute on function public.create_release_batch_checked(uuid, uuid, text, timestamptz, uuid, boolean, jsonb, text, jsonb) to anon, authenticated, service_role;

-- ── 2) น้ำหนัก / ความยาวของ QR ตามแถวปล่อย ───────────────────────────────
create or replace function public._rel_units_follow() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.unit_weight is distinct from old.unit_weight then
    update public.part_units set weight = new.unit_weight where release_id = new.id and weight is distinct from new.unit_weight;
  end if;
  if new.length_mm is distinct from old.length_mm then
    update public.part_units set length_mm = new.length_mm where release_id = new.id and length_mm is distinct from new.length_mm;
  end if;
  return new;
end $function$;

drop trigger if exists rel_units_follow on public.releases;
create trigger rel_units_follow after update of unit_weight, length_mm on public.releases
  for each row execute function public._rel_units_follow();

notify pgrst, 'reload schema';
