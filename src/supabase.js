import { createClient } from "@supabase/supabase-js";

// ── ใส่ค่าจาก Supabase Project Settings → API ────────────────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error(
    "❌  ยังไม่ได้ตั้งค่า Supabase!\n" +
    "    สร้างไฟล์ .env.local แล้วใส่:\n" +
    "    VITE_SUPABASE_URL=...\n" +
    "    VITE_SUPABASE_ANON_KEY=..."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Generic table helpers ───────────────────────────────────────────────────
// เรียกใช้ตรงๆ เช่น listRows("machines"), insertRow("machines", {...})

export async function listRows(table, { order, ascending = true, filters } = {}) {
  let q = supabase.from(table).select("*");
  if (filters) {
    for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  }
  if (order) q = q.order(order, { ascending });
  const { data, error } = await q;
  if (error) {
    console.warn("listRows error", table, error);
    return [];
  }
  return data || [];
}

export async function insertRow(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) {
    console.warn("insertRow error", table, error);
    throw error;
  }
  return data;
}

export async function insertRows(table, rows) {
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (error) {
    console.warn("insertRows error", table, error);
    throw error;
  }
  return data || [];
}

export async function updateRow(table, id, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).select().single();
  if (error) {
    console.warn("updateRow error", table, error);
    throw error;
  }
  return data;
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.warn("deleteRow error", table, error);
    throw error;
  }
}

// หา part_unit จาก QR code ที่สแกนได้ (ใช้บ่อยในหน้าสแกน)
export async function findUnitByQr(qrCode) {
  const { data, error } = await supabase
    .from("part_units")
    .select("*, part_master(*, projects(code, name)), release:releases(*)")
    .eq("qr_code", qrCode.trim())
    .maybeSingle();
  if (error) {
    console.warn("findUnitByQr error", error);
    return null;
  }
  return data;
}

// ประวัติการสแกนทั้งหมดของชิ้นเดียว
export async function getUnitHistory(partUnitId) {
  const { data, error } = await supabase
    .from("scan_logs")
    .select("*, machine:machines(name,code), operation:operations(name), employee:employees(name,code)")
    .eq("part_unit_id", partUnitId)
    .order("scanned_at", { ascending: true });
  if (error) {
    console.warn("getUnitHistory error", error);
    return [];
  }
  return data || [];
}

// part_units ทั้งหมด พร้อม part_master + project (ใช้ทำ Finished Part / Parts / Projects summary)
export async function getAllUnitsFull(statusFilter) {
  let q = supabase
    .from("part_units")
    .select("*, part_master(part_no, part_name, unit_weight, default_length_mm, routing, project_id, projects(name))")
    .order("created_at", { ascending: false });
  if (statusFilter) q = q.eq("status", statusFilter);
  const { data, error } = await q;
  if (error) {
    console.warn("getAllUnitsFull error", error);
    return [];
  }
  return data || [];
}

// scan log ทั้งหมดในช่วงเวลา พร้อม join ที่ใช้ทำรายงาน
export async function getScanLogsBetween(fromIso, toIso) {
  const { data, error } = await supabase
    .from("scan_logs")
    .select("*, machine:machines(name,code), operation:operations(name), employee:employees(name), part_unit:part_units(unit_no, part_master_id, weight, length_mm, part_master(part_no, part_name, project_id, unit_weight, default_length_mm, routing, projects(name)))")
    .gte("scanned_at", fromIso)
    .lte("scanned_at", toIso)
    .order("scanned_at", { ascending: false });
  if (error) {
    console.warn("getScanLogsBetween error", error);
    return [];
  }
  return data || [];
}
