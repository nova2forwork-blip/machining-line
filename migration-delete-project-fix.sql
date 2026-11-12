-- ═══════════════════════════════════════════════════════════════════════
-- ★ 2026-11-12 แก้ "ลบโปรเจคไม่ได้"
--   อาการ: กด ลบโปรเจคนี้ → ลบไม่สำเร็จ: update or delete on table "part_master" violates foreign key
--          constraint "bom_components_child_pm_id_fkey" on table "bom_components"
--   สาเหตุ: authz_delete_project ลบ Part ของโปรเจคโดยไม่ลบของที่อ้างถึง Part / QR พวกนั้นก่อน
--     • bom_components.child_pm_id  (ลูกใน BOM ของซับ/แผง)        ON DELETE RESTRICT
--     • assembly_links.child_unit_id (QR ลูกที่ประกอบเข้าแผงแล้ว)   ON DELETE RESTRICT
--     • machine_records.(part_master_id | part_unit_id | release_id) (งานหน้าเครื่อง) NO ACTION
--   แก้: ลบตามลำดับลูก → แม่ ให้ครบ (ผู้ใช้ยืนยันด้วยการพิมพ์รหัสโปรเจคแล้ว และกล่องยืนยันบอกจำนวนงานหน้าเครื่องแล้ว)
--     • Part ของโปรเจคนี้ไปเป็นลูกใน BOM ของ "โปรเจคอื่น" → ไม่ลบ หยุดพร้อมบอกเบอร์ (กัน BOM ของโปรเจคอื่นเสีย)
--   รันซ้ำได้ (CREATE OR REPLACE)
--   ⚠ ทดลอง: รันที่ Studio ของ local (http://127.0.0.1:54323) ก่อน · ขึ้นจริงค่อยรันที่ Supabase จริง
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.authz_delete_project(p_token uuid, p_project_id uuid) returns void
  language plpgsql security definer
  set search_path to 'public'
  set statement_timeout to '20s'
as $$
declare v_parts uuid[]; v_rel uuid[]; v_units uuid[]; v_cross text;
begin
  perform public._require(p_token, 'admin');
  select array_agg(id) into v_parts from public.part_master where project_id = p_project_id;
  if v_parts is not null then
    -- Part ของโปรเจคนี้ถูกใช้เป็นลูกใน BOM ของ Part โปรเจคอื่น → หยุด (ไม่แตะ BOM ของโปรเจคอื่น)
    select string_agg(distinct c.part_no || ' (ใน ' || p.part_no || ')', ', ') into v_cross
      from public.bom_components b
      join public.part_master c on c.id = b.child_pm_id
      join public.part_master p on p.id = b.parent_pm_id
     where b.child_pm_id = any(v_parts) and not (b.parent_pm_id = any(v_parts));
    if v_cross is not null then
      raise exception 'ลบโปรเจคไม่ได้ — Part ของโปรเจคนี้เป็นลูกใน BOM ของโปรเจคอื่น: %', v_cross using errcode = 'P0001';
    end if;

    select array_agg(id) into v_rel from public.releases where part_master_id = any(v_parts);
    select array_agg(id) into v_units from public.part_units
     where part_master_id = any(v_parts) or (v_rel is not null and release_id = any(v_rel));

    -- งานหน้าเครื่อง (ไม่มี cascade)
    delete from public.machine_records
     where part_master_id = any(v_parts)
        or (v_rel is not null and release_id = any(v_rel))
        or (v_units is not null and part_unit_id = any(v_units));

    if v_units is not null then
      delete from public.assembly_links where child_unit_id = any(v_units) or parent_unit_id = any(v_units);
      delete from public.scan_logs where part_unit_id = any(v_units);
      delete from public.part_units where id = any(v_units);
    end if;
    if v_rel is not null then
      delete from public.releases where id = any(v_rel);
    end if;

    -- BOM ของโปรเจคนี้ (แม่หรือลูกเป็น Part ของโปรเจคนี้ — เช็คข้างบนแล้วว่าไม่มีของโปรเจคอื่น)
    delete from public.bom_components where parent_pm_id = any(v_parts) or child_pm_id = any(v_parts);
    delete from public.part_master where id = any(v_parts);
  end if;
  delete from public.projects where id = p_project_id;
end $$;
