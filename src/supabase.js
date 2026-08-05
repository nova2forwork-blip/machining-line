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

// Bulk update: apply the same patch to every row matching the given filters.
// Used e.g. to propagate a release's edited weight/length down to all its part_units.
export async function updateRows(table, filters, patch) {
  let q = supabase.from(table).update(patch);
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  const { data, error } = await q.select();
  if (error) {
    console.warn("updateRows error", table, error);
    throw error;
  }
  return data || [];
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.warn("deleteRow error", table, error);
    throw error;
  }
}

// Delete many rows by id in one call (e.g. removing part_units when shrinking a release's qty).
export async function deleteRows(table, ids) {
  if (!ids || ids.length === 0) return;
  const { error } = await supabase.from(table).delete().in("id", ids);
  if (error) {
    console.warn("deleteRows error", table, error);
    throw error;
  }
}

// Delete a release entirely, along with every part_unit it created and any
// scan_logs recorded against those units (FK constraints require deleting
// children before parents). Caller is responsible for warning the user first
// if any of those units have already been scanned — this does not check.
export async function deleteReleaseCascade(releaseId) {
  const { data: units, error: unitsErr } = await supabase
    .from("part_units").select("id").eq("release_id", releaseId);
  if (unitsErr) throw unitsErr;
  const unitIds = (units || []).map((u) => u.id);
  if (unitIds.length > 0) {
    const { error: scanErr } = await supabase.from("scan_logs").delete().in("part_unit_id", unitIds);
    if (scanErr) throw scanErr;
    const { error: unitDelErr } = await supabase.from("part_units").delete().in("id", unitIds);
    if (unitDelErr) throw unitDelErr;
  }
  const { error: relErr } = await supabase.from("releases").delete().eq("id", releaseId);
  if (relErr) throw relErr;
}

// ลบความสามารถของเครื่อง 1 คู่ (machine_id + operation_id) — เป็น composite key
// ไม่มี id เดี่ยว จึงต้องลบด้วยสองเงื่อนไขพร้อมกัน
export async function deleteCap(machineId, operationId) {
  const { error } = await supabase
    .from("machine_operations")
    .delete()
    .eq("machine_id", machineId)
    .eq("operation_id", operationId);
  if (error) {
    console.warn("deleteCap error", error);
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

// ลบทั้งโปรเจค พร้อม Part Master / Release / QR / ประวัติสแกนทั้งหมดที่อยู่ใต้โปรเจคนั้น
// (ลบจากลูกไปหาแม่ตามลำดับ FK: scan_logs → part_units → releases → part_master → projects)
// Caller ต้องแจ้งเตือนผู้ใช้ก่อนเสมอ — ฟังก์ชันนี้ไม่เช็คว่ามีการสแกนไปแล้วหรือยัง
export async function deleteProjectCascade(projectId) {
  const { data: pm, error: pmErr } = await supabase
    .from("part_master").select("id").eq("project_id", projectId);
  if (pmErr) throw pmErr;
  const partIds = (pm || []).map((p) => p.id);

  if (partIds.length > 0) {
    const { data: rel, error: relErr } = await supabase
      .from("releases").select("id").in("part_master_id", partIds);
    if (relErr) throw relErr;
    const releaseIds = (rel || []).map((r) => r.id);

    if (releaseIds.length > 0) {
      const { data: units, error: unitsErr } = await supabase
        .from("part_units").select("id").in("release_id", releaseIds);
      if (unitsErr) throw unitsErr;
      const unitIds = (units || []).map((u) => u.id);

      if (unitIds.length > 0) {
        const { error: scanErr } = await supabase.from("scan_logs").delete().in("part_unit_id", unitIds);
        if (scanErr) throw scanErr;
        const { error: unitDelErr } = await supabase.from("part_units").delete().in("id", unitIds);
        if (unitDelErr) throw unitDelErr;
      }
      const { error: relDelErr } = await supabase.from("releases").delete().in("id", releaseIds);
      if (relDelErr) throw relDelErr;
    }
    const { error: pmDelErr } = await supabase.from("part_master").delete().in("id", partIds);
    if (pmDelErr) throw pmDelErr;
  }

  const { error: projErr } = await supabase.from("projects").delete().eq("id", projectId);
  if (projErr) throw projErr;
}

// ใช้ประเมินก่อนลบ/แก้ไขโปรเจค — บอกว่าใต้โปรเจคนี้มี Part/Release/QR ที่สแกนแล้วกี่ชิ้น
export async function getProjectImpact(projectId) {
  const { data: pm } = await supabase.from("part_master").select("id").eq("project_id", projectId);
  const partIds = (pm || []).map((p) => p.id);
  if (partIds.length === 0) return { partCount: 0, releaseCount: 0, unitCount: 0, scannedCount: 0 };

  const { data: rel } = await supabase.from("releases").select("id").in("part_master_id", partIds);
  const releaseIds = (rel || []).map((r) => r.id);
  if (releaseIds.length === 0) return { partCount: partIds.length, releaseCount: 0, unitCount: 0, scannedCount: 0 };

  const { data: units } = await supabase.from("part_units").select("status").in("release_id", releaseIds);
  const unitList = units || [];
  return {
    partCount: partIds.length,
    releaseCount: releaseIds.length,
    unitCount: unitList.length,
    scannedCount: unitList.filter((u) => u.status !== "released").length,
  };
}
export async function getReleasesFull() {
  const { data, error } = await supabase
    .from("releases")
    .select("*, part_master(part_no, part_name, project_id, projects(code, name)), employee:employees(name, code)")
    .order("release_date", { ascending: false });
  if (error) {
    console.warn("getReleasesFull error", error);
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
