-- ════════════════════════════════════════════════════════════
-- Machining Line System — Supabase Schema
-- วิธีใช้: Supabase Dashboard → SQL Editor → New Query → วางทั้งหมด → Run
-- ════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- 1. แผนก
create table if not exists public.departments (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- 2. พนักงาน (ใช้ล็อคอินเข้าระบบ)
create table if not exists public.employees (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,          -- รหัสพนักงาน (ใช้ล็อคอิน)
  name           text not null,
  department_id  uuid references public.departments(id),
  password_hash  text not null,
  role           text not null default 'operator',  -- admin / supervisor / operator
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- 3. โปรเจค
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  name       text not null,
  customer   text,
  status     text not null default 'active',   -- active / closed
  created_at timestamptz not null default now()
);

-- 4. เครื่องจักร
create table if not exists public.machines (
  id     uuid primary key default gen_random_uuid(),
  code   text not null unique,
  name   text not null,
  type   text,                                  -- ตัด / เจาะ / บาก / ประกอบ ฯลฯ
  active boolean not null default true
);

-- 5. ขั้นตอนการทำงาน (master list เช่น ตัด เจาะ บาก ประกอบ)
create table if not exists public.operations (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  seq  int not null default 0
);

-- 6. Part master — กำหนด routing (ลำดับขั้นตอนที่ part นี้ต้องผ่าน)
create table if not exists public.part_master (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id),
  part_no     text not null,
  part_name   text not null,
  material    text,
  unit_weight numeric not null default 0,       -- น้ำหนักโดยประมาณต่อชิ้น (กก.)
  routing     jsonb not null default '[]',       -- เช่น ["ตัด","เจาะ","บาก","ประกอบ"]
  created_at  timestamptz not null default now()
);

-- 7. Release — การปล่อยงานแต่ละครั้ง
create table if not exists public.releases (
  id             uuid primary key default gen_random_uuid(),
  part_master_id uuid references public.part_master(id),
  qty            int not null,
  released_by    uuid references public.employees(id),
  release_date   timestamptz not null default now(),
  note           text
);

-- 8. Part units — 1 แถว = 1 ชิ้นจริง มี QR ของตัวเอง
create table if not exists public.part_units (
  id             uuid primary key default gen_random_uuid(),
  release_id     uuid references public.releases(id),
  part_master_id uuid references public.part_master(id),
  unit_no        int not null,                   -- ลำดับชิ้นในล็อต เช่น 1..50
  qr_code        text not null unique,            -- โค้ดที่พิมพ์ลงป้าย เช่น PRJ001-A12-0001
  status         text not null default 'released',-- released / in_progress / finished
  weight         numeric,                          -- น้ำหนักจริงถ้าชั่งตอนสแกน
  created_at     timestamptz not null default now()
);

-- 9. Scan logs — ทุกครั้งที่สแกน QR ที่หน้าเครื่องจักร
create table if not exists public.scan_logs (
  id            uuid primary key default gen_random_uuid(),
  part_unit_id  uuid references public.part_units(id),
  machine_id    uuid references public.machines(id),
  operation_id  uuid references public.operations(id),
  employee_id   uuid references public.employees(id),
  weight        numeric,
  note          text,
  scanned_at    timestamptz not null default now()
);

-- ── Row Level Security: เปิดใช้ anon key แบบ shared access (ทีมเดียวกัน) ──────
alter table public.departments enable row level security;
alter table public.employees   enable row level security;
alter table public.projects    enable row level security;
alter table public.machines    enable row level security;
alter table public.operations  enable row level security;
alter table public.part_master enable row level security;
alter table public.releases    enable row level security;
alter table public.part_units  enable row level security;
alter table public.scan_logs   enable row level security;

create policy "allow_all" on public.departments for all using (true) with check (true);
create policy "allow_all" on public.employees   for all using (true) with check (true);
create policy "allow_all" on public.projects    for all using (true) with check (true);
create policy "allow_all" on public.machines    for all using (true) with check (true);
create policy "allow_all" on public.operations  for all using (true) with check (true);
create policy "allow_all" on public.part_master for all using (true) with check (true);
create policy "allow_all" on public.releases    for all using (true) with check (true);
create policy "allow_all" on public.part_units  for all using (true) with check (true);
create policy "allow_all" on public.scan_logs   for all using (true) with check (true);

-- ── Realtime: ให้หน้าจอ dashboard อัปเดตสดเวลามีการสแกน ──────────────────────
-- (ต้องเปิดเพิ่มใน Dashboard: Database → Replication ด้วย)
alter publication supabase_realtime add table public.scan_logs;
alter publication supabase_realtime add table public.part_units;

-- ── Seed ข้อมูลเริ่มต้น ───────────────────────────────────────────────────────
insert into public.departments (name) values
  ('ผู้ดูแลระบบ'), ('ฝ่ายผลิต'), ('QC'), ('Planning')
on conflict do nothing;

insert into public.operations (name, seq) values
  ('ตัด', 1), ('เจาะ', 2), ('บาก', 3), ('พับ', 4), ('เชื่อม', 5), ('ประกอบ', 6)
on conflict do nothing;

-- default admin: code = admin, password = admin123 (SHA-256 hash ของ "admin123")
insert into public.employees (code, name, department_id, password_hash, role)
select 'admin', 'ผู้ดูแลระบบ', d.id,
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'admin'
from public.departments d where d.name = 'ผู้ดูแลระบบ'
on conflict (code) do nothing;
