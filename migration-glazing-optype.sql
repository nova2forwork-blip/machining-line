-- ════════════════════════════════════════════════════════════════════
-- migration-glazing-optype.sql  (2026-10-26)
-- แก้ "บันทึกไม่สำเร็จ: bad_type" ตอนติ๊กขั้นตอน "ติดกระจก" ที่ ตั้งค่า → เครื่อง/สถานี
--
-- สาเหตุ: ฟังก์ชัน create_operation / set_operation_type (จาก migration-op-type-fix.sql)
--   มีรายชื่อประเภทงานที่ยอมรับ (allow-list) ซึ่งทำไว้ก่อนมีหน้าติดกระจก → ไม่รู้จัก 'glazing'
-- วิธีแก้: อ่านโค้ดฟังก์ชันจริงจากฐานข้อมูล แล้วเติมประเภทที่ขาดลงในรายชื่อนั้น
--   ('glazing' + ถ้าขาด: 'panel', 'pack_panel', 'pack_site') — ไม่แตะส่วนอื่นของฟังก์ชัน
--
-- รันซ้ำได้ (ครบแล้ว = ไม่ทำอะไร) · รันใน Supabase › SQL Editor (ในเครื่อง: http://127.0.0.1:54323)
-- ถ้าหารายชื่อในฟังก์ชันไม่เจอ จะหยุดพร้อมข้อความ — ไม่เปลี่ยนอะไร
-- ════════════════════════════════════════════════════════════════════
do $mig$
declare
  want   text[] := array['machining','assembly','panel','packing','pack_panel','pack_site','glazing'];
  f      record;
  def    text;
  m      text[];
  whole  text;
  inner_ text;
  addl   text;
  w      text;
  found_ boolean;
  n_fix  int := 0;
  n_fn   int := 0;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_operation', 'set_operation_type')
  loop
    n_fn := n_fn + 1;
    def := pg_get_functiondef(f.oid);
    found_ := false;
    -- หา "รายการข้อความในวงเล็บ" ที่มี 'machining' หรือ 'assembly' เช่น in ('machining','assembly',…) หรือ array['machining',…]
    for m in
      select regexp_matches(def, '([\(\[]\s*''[a-z_]+''(?:\s*,\s*''[a-z_]+'')+\s*[\)\]])', 'g')
    loop
      whole := m[1];
      if whole !~ '''(machining|assembly)''' then continue; end if;
      found_ := true;
      addl := '';
      foreach w in array want loop
        if position('''' || w || '''' in whole) = 0 then addl := addl || ', ''' || w || ''''; end if;
      end loop;
      if addl <> '' then
        inner_ := regexp_replace(whole, '\s*([\)\]])$', addl || '\1');
        def := replace(def, whole, inner_);
      end if;
    end loop;
    if not found_ then
      -- รูปแบบอื่น (เช่น regex ~ '^(machining|assembly|…)$')
      if def ~ '\(machining\|' or def ~ '\|machining\)' or def ~ '\|machining\|' then
        foreach w in array want loop
          if def !~ ('[(|]' || w || '[|)]') then
            def := regexp_replace(def, '\(machining\|', '(machining|' || w || '|');
          end if;
        end loop;
        found_ := true;
      end if;
    end if;
    if not found_ then
      raise exception 'ไม่พบรายชื่อประเภทงานในฟังก์ชัน %(). ส่งผลของ: select pg_get_functiondef(''public.%''::regproc); มาให้ดู', f.proname, f.proname;
    end if;
    if def <> pg_get_functiondef(f.oid) then
      execute def;
      n_fix := n_fix + 1;
      raise notice 'แก้ % แล้ว (เพิ่มประเภทที่ขาด)', f.proname;
    else
      raise notice '% รู้จักครบทุกประเภทอยู่แล้ว', f.proname;
    end if;
  end loop;
  if n_fn = 0 then
    raise notice 'ไม่มีฟังก์ชัน create_operation / set_operation_type — ข้าม (ระบบนี้อาจไม่ได้ตรวจประเภทงาน)';
  end if;
  raise notice 'เสร็จ · แก้ % ฟังก์ชัน', n_fix;
end
$mig$;

notify pgrst, 'reload schema';

-- ตรวจ: ควรเห็น glazing ในทั้งสองฟังก์ชัน (true)
select p.proname, pg_get_functiondef(p.oid) like '%''glazing''%' or pg_get_functiondef(p.oid) like '%|glazing%' as knows_glazing
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('create_operation', 'set_operation_type');
