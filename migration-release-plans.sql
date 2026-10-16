-- ══════════════════════════════════════════════════════════════════════════
-- migration-release-plans.sql — ปล่อยงานแบบใหม่: แผน Release + ปล่อยเป็นล็อต (2026-10-13)
--   รัน 1 ครั้งใน Supabase SQL Editor · รันซ้ำได้ (idempotent)
--
--   แผน Release (เช่น P-142) = หัวใบ + Address & Unit + BOM จาก PDF + งานของซับ / ใบงานของพาร์ท
--   ล็อต (P-142.1 / P-142.2 / … หรือ P-142 เอง) = แถวใน releases เดิม (release_order = เลขล็อต) — ไม่แตะตารางเดิม
--   ยอดคงเหลือ = ต้องใช้ (จากแผน) − ที่ปล่อยแล้ว (releases ของเลขล็อตในแผนนี้) — คิดที่หน้าเว็บ
--   อ่าน/เขียนผ่าน RPC เท่านั้น (ต้องมี token · สิทธิ์ office ขึ้นไป) — anon อ่านตารางตรงไม่ได้
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.release_plans (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  release_order text not null,
  plan          jsonb not null default '{}'::jsonb,
  status        text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  created_by    uuid references public.employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.employees(id) on delete set null,
  updated_at    timestamptz not null default now()
);
-- 1 โปรเจค 1 เลข Release (ไม่สนตัวพิมพ์/ช่องว่าง)
create unique index if not exists release_plans_project_ro_uniq
  on public.release_plans (project_id, upper(btrim(release_order)));

alter table public.release_plans enable row level security;
revoke all on public.release_plans from anon;
revoke all on public.release_plans from authenticated;

-- บันทึกแผนใหม่ (p_id = null) หรือแก้แผนเดิม (p_id) → { ok, id } | { ok:false, reason }
create or replace function public.release_plan_save(
  p_token uuid, p_project_id uuid, p_release_order text, p_plan jsonb, p_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_id  uuid;
  v_ro  text := btrim(coalesce(p_release_order, ''));
begin
  perform public._require(p_token, 'office');
  select s.employee_id into v_emp from public.sessions s where s.token = p_token limit 1;
  if p_project_id is null or v_ro = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if p_id is null then
    if exists (select 1 from public.release_plans
               where project_id = p_project_id and upper(btrim(release_order)) = upper(v_ro)) then
      return jsonb_build_object('ok', false, 'reason', 'duplicate');
    end if;
    insert into public.release_plans (project_id, release_order, plan, created_by, updated_by)
    values (p_project_id, v_ro, coalesce(p_plan, '{}'::jsonb), v_emp, v_emp)
    returning id into v_id;
  else
    update public.release_plans
       set plan = coalesce(p_plan, plan), updated_by = v_emp, updated_at = now()
     where id = p_id and project_id = p_project_id
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- รายการแผน (ทั้งหมด หรือเฉพาะโปรเจค) — ไม่รวมที่ยกเลิก
create or replace function public.release_plan_list(p_token uuid, p_project_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(p_token, 'office');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'project_id', p.project_id, 'release_order', p.release_order, 'status', p.status,
             'plan', p.plan, 'created_at', p.created_at, 'updated_at', p.updated_at, 'created_by_name', e.name)
           order by p.created_at desc)
      from public.release_plans p
      left join public.employees e on e.id = p.created_by
     where (p_project_id is null or p.project_id = p_project_id)
       and p.status <> 'cancelled'
  ), '[]'::jsonb);
end $$;

-- ปิด / ยกเลิกแผน (ไม่ลบล็อตที่ปล่อยไปแล้ว)
create or replace function public.release_plan_set_status(p_token uuid, p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  perform public._require(p_token, 'office');
  if p_status not in ('active', 'closed', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  select s.employee_id into v_emp from public.sessions s where s.token = p_token limit 1;
  update public.release_plans set status = p_status, updated_by = v_emp, updated_at = now() where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.release_plan_save(uuid, uuid, text, jsonb, uuid) to anon, authenticated;
grant execute on function public.release_plan_list(uuid, uuid) to anon, authenticated;
grant execute on function public.release_plan_set_status(uuid, uuid, text) to anon, authenticated;

-- ตรวจหลังรัน:
--   select count(*) from public.release_plans;                       -- 0 (ตารางพร้อม)
--   select has_table_privilege('anon', 'public.release_plans', 'select');  -- false (อ่านผ่าน RPC เท่านั้น)
