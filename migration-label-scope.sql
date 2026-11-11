-- ═══════════════════════════════════════════════════════════════════════
-- ชนิดป้าย QR ของแต่ละ Release (หน้า "พิมพ์ QR / ป้าย")
--   releases.label_scope = 'unit' (ป้ายรายชิ้น 1 OF N — 1 ใบแทน 1 ชิ้น)
--                        | 'lot'  (ป้ายรวมล็อต — ใบเดียวแทนทั้งล็อต)
--                        | null   (ยังไม่เคยพิมพ์หลังติดตั้งส่วนนี้ → แอปเดาจากจำนวนป้ายที่ถูกสแกนเหมือนเดิม)
--   บันทึกตอนกด "พิมพ์" — เปิดหน้าใหม่ก็จำได้ทุกเครื่อง + ใช้ตัดยอด "เสร็จ / สแปร์" ต่อป้ายได้แม่นขึ้น
--   รันซ้ำได้ (idempotent) · ไม่แตะข้อมูลเดิม (เพิ่มคอลัมน์ว่าง 1 คอลัมน์ + ฟังก์ชัน 1 ตัว)
--   ⚠ ทดลอง: รันที่ Studio ของ local (http://127.0.0.1:54323) ก่อน · ขึ้นจริงค่อยรันที่ Supabase จริง
-- ═══════════════════════════════════════════════════════════════════════
alter table public.releases add column if not exists label_scope text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'releases_label_scope_chk') then
    alter table public.releases add constraint releases_label_scope_chk check (label_scope is null or label_scope in ('unit', 'lot'));
  end if;
end $$;

-- p_scopes = { "<release_id>": "unit" | "lot", ... } · สิทธิ์เดียวกับการปล่อยงาน (office ขึ้นไป)
create or replace function public.release_set_label_scope(p_token uuid, p_scopes jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
begin
  perform public._require(p_token, 'office');
  if p_scopes is null or jsonb_typeof(p_scopes) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  update public.releases r
     set label_scope = e.value
    from jsonb_each_text(p_scopes) e
   where r.id::text = e.key
     and e.value in ('unit', 'lot')
     and r.label_scope is distinct from e.value;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end $$;

grant execute on function public.release_set_label_scope(uuid, jsonb) to anon, authenticated;
