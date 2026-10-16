-- ═══════════════════════════════════════════════════════════════════════
-- เก็บตัวไฟล์ PDF แบบซับ/พาร์ท ของโปรเจค (หน้า "ซับ / พาร์ท ของโปรเจค")
--   ที่เก็บไฟล์ = Storage bucket "release-pdfs" (ไม่เปิดสาธารณะ — เปิดดูผ่านลิงก์ชั่วคราว 10 นาที)
--   รันซ้ำได้ (idempotent)
--   ⚠ ทดลอง: รันที่ Studio ของ local (http://127.0.0.1:54323) เท่านั้น · ขึ้นจริงค่อยรันที่ Supabase จริง
-- ═══════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('release-pdfs', 'release-pdfs', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists release_pdfs_select on storage.objects;
create policy release_pdfs_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'release-pdfs');

drop policy if exists release_pdfs_insert on storage.objects;
create policy release_pdfs_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'release-pdfs');

drop policy if exists release_pdfs_update on storage.objects;
create policy release_pdfs_update on storage.objects for update to anon, authenticated
  using (bucket_id = 'release-pdfs') with check (bucket_id = 'release-pdfs');
