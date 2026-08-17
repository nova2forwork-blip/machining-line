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

// อ่าน session token (ออกโดย verify_login, เก็บโดย auth.setSession) — แนบไปกับทุก
// การเขียน เพื่อให้ DB ตรวจ token + role ก่อนอนุญาต (ดู migration-2-rls-lockdown.sql)
function authToken() {
  try { return JSON.parse(localStorage.getItem("mls-session") || sessionStorage.getItem("mls-session"))?.token || null; }
  catch { return null; }
}

// ── Generic table helpers ───────────────────────────────────────────────────
// อ่าน (listRows) = query ตรงได้ (RLS ยังให้ SELECT) · เขียน = ผ่าน authz_* RPC เท่านั้น
// (anon ถูกเพิกถอนสิทธิ์ INSERT/UPDATE/DELETE ตรงในตารางแล้ว)

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
  const { data, error } = await supabase.rpc("authz_insert", { p_token: authToken(), p_tbl: table, p_payload: row });
  if (error) { console.warn("insertRow error", table, error); throw error; }
  return data;
}

export async function insertRows(table, rows) {
  const { data, error } = await supabase.rpc("authz_insert_many", { p_token: authToken(), p_tbl: table, p_payload: rows });
  if (error) { console.warn("insertRows error", table, error); throw error; }
  return data || [];
}

export async function updateRow(table, id, patch) {
  const { data, error } = await supabase.rpc("authz_update", { p_token: authToken(), p_tbl: table, p_id: id, p_payload: patch });
  if (error) { console.warn("updateRow error", table, error); throw error; }
  return data;
}

// Bulk update: apply the same patch to every row matching the given filters.
// Used e.g. to propagate a release's edited weight/length down to all its part_units.
export async function updateRows(table, filters, patch) {
  const { data, error } = await supabase.rpc("authz_update_where", { p_token: authToken(), p_tbl: table, p_filters: filters, p_payload: patch });
  if (error) { console.warn("updateRows error", table, error); throw error; }
  return data || 0; // จำนวนแถวที่อัปเดต
}

export async function deleteRow(table, id) {
  const { error } = await supabase.rpc("authz_delete", { p_token: authToken(), p_tbl: table, p_id: id });
  if (error) { console.warn("deleteRow error", table, error); throw error; }
}

// Delete many rows by id in one call (e.g. removing part_units when shrinking a release's qty).
export async function deleteRows(table, ids) {
  if (!ids || ids.length === 0) return;
  const { error } = await supabase.rpc("authz_delete_many", { p_token: authToken(), p_tbl: table, p_ids: ids });
  if (error) { console.warn("deleteRows error", table, error); throw error; }
}

// ออกจากระบบ — ยกเลิก token ฝั่ง DB (เรียกก่อน clearSession)
export async function logoutSession() {
  const t = authToken();
  if (t) { try { await supabase.rpc("logout", { p_token: t }); } catch (_) { /* ignore */ } }
}

// เปิด/ปิดการใช้งานพนักงาน (admin เท่านั้น) — ผ่าน RPC
export async function setEmployeeActive(id, active) {
  const { error } = await supabase.rpc("set_employee_active", { p_token: authToken(), p_id: id, p_active: active });
  if (error) { console.warn("set_employee_active error", error); throw error; }
}

// Delete a release entirely, along with every part_unit it created and any
// scan_logs recorded against those units (FK constraints require deleting
// children before parents). Caller is responsible for warning the user first
// if any of those units have already been scanned — this does not check.
export async function deleteReleaseCascade(releaseId) {
  // cascade (scan_logs → part_units → releases) ทำใน RPC เดียว = atomic + ตรวจสิทธิ์
  const { error } = await supabase.rpc("authz_delete_release", { p_token: authToken(), p_release_id: releaseId });
  if (error) { console.warn("deleteReleaseCascade error", error); throw error; }
}

// ลบความสามารถของเครื่อง 1 คู่ (machine_id + operation_id) — composite key ผ่าน RPC
export async function deleteCap(machineId, operationId) {
  const { error } = await supabase.rpc("authz_delete_cap", { p_token: authToken(), p_machine_id: machineId, p_operation_id: operationId });
  if (error) { console.warn("deleteCap error", error); throw error; }
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

// จำนวนที่บันทึกไปแล้วของล็อต/รีลีสนี้ (รวมทุกครั้งที่หน้าเครื่องกด SAVE)
// ใช้ทำ running number บนป้ายหน้าเครื่อง เช่น "101 OF 500"
export async function getReleaseProgress(releaseId) {
  if (!releaseId) return 0;
  const { data, error } = await supabase
    .from("machine_records")
    .select("quantity")
    .eq("release_id", releaseId);
  if (error) { console.warn("getReleaseProgress error", error); return 0; }
  return (data || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
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
  // ดึงแบบแบ่งหน้า (page 1000) เพื่อไม่ให้ติดเพดาน 1,000 แถวของ PostgREST
  const pageSize = 1000; let from = 0; let all = [];
  for (;;) {
    let q = supabase
      .from("part_units")
      .select("*, part_master(part_no, part_name, unit_weight, default_length_mm, routing, project_id, projects(name))")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (statusFilter) q = q.eq("status", statusFilter);
    const { data, error } = await q;
    if (error) { console.warn("getAllUnitsFull error", error); break; }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// ลบทั้งโปรเจค พร้อม Part Master / Release / QR / ประวัติสแกนทั้งหมดที่อยู่ใต้โปรเจคนั้น
// (ลบจากลูกไปหาแม่ตามลำดับ FK: scan_logs → part_units → releases → part_master → projects)
// Caller ต้องแจ้งเตือนผู้ใช้ก่อนเสมอ — ฟังก์ชันนี้ไม่เช็คว่ามีการสแกนไปแล้วหรือยัง
export async function deleteProjectCascade(projectId) {
  // cascade (scan_logs → part_units → releases → part_master → projects) ใน RPC เดียว
  const { error } = await supabase.rpc("authz_delete_project", { p_token: authToken(), p_project_id: projectId });
  if (error) { console.warn("deleteProjectCascade error", error); throw error; }
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
    .select("*, part_master(part_no, part_name, routing, project_id, projects(code, name)), employee:employees(name, code)")
    .order("release_date", { ascending: false });
  if (error) {
    console.warn("getReleasesFull error", error);
    return [];
  }
  return data || [];
}

// สถิติ part_units (total / finished / in_progress) จัดกลุ่มตาม release_id
// ใช้ในหน้า Release Detail แสดงความคืบหน้าต่อ Part
export async function getUnitStatsByReleaseIds(releaseIds) {
  if (!releaseIds || releaseIds.length === 0) return {};
  // นับที่ฝั่ง DB (group by) — ไม่ติดเพดาน 1,000 แถวเหมือนการดึงมานับใน browser
  const { data, error } = await supabase.rpc("release_unit_stats", { p_release_ids: releaseIds });
  if (error) { console.warn("release_unit_stats error", error); return {}; }
  const stats = {};
  for (const r of data || []) {
    stats[r.release_id] = {
      total: Number(r.total) || 0,
      finished: Number(r.finished) || 0,
      inProgress: Number(r.in_progress) || 0,
    };
  }
  return stats;
}

// ดึงรายชื่อพนักงานแบบเลือกคอลัมน์ชัดเจน (ไม่รวม password_hash)
// จำเป็น เพราะ migration เพิกถอนสิทธิ์อ่านคอลัมน์ password_hash แล้ว — select * จะ error
export async function getEmployees() {
  const { data, error } = await supabase
    .from("employees")
    .select("id, code, name, role, active, department_id, machine_id, operation_id, created_at")
    .order("code", { ascending: true });
  if (error) { console.warn("getEmployees error", error); return []; }
  return data || [];
}

// ── RPC wrappers (atomic operations ฝั่ง DB — ดู migration-fixes.sql) ─────────

// บันทึกการสแกน 1 ครั้งแบบ atomic — เครื่อง/ขั้นตอน/พนักงาน ดึงจาก session token ฝั่ง DB
// (ปลอมไม่ได้) คืน { ok, reason?, finished?, out_of_order?, step?, total?, op?, part_no? }
export async function recordScan({ unitId }) {
  const { data, error } = await supabase.rpc("record_scan", { p_token: authToken(), p_unit_id: unitId });
  if (error) { console.warn("record_scan error", error); return { ok: false, reason: "error", message: error.message }; }
  return data || { ok: false, reason: "error" };
}

// ── Offline scan queue (localStorage) — โหมดหน้าเครื่องกันสแกนหายเมื่อเน็ตสะดุด ────
const SCAN_Q_KEY = "mls-scan-queue";
const scanQListeners = new Set();
function qRead() { try { return JSON.parse(localStorage.getItem(SCAN_Q_KEY)) || []; } catch { return []; } }
function qWrite(a) { localStorage.setItem(SCAN_Q_KEY, JSON.stringify(a)); scanQListeners.forEach((f) => { try { f(a.length); } catch (_) {} }); }
export function scanQueueCount() { return qRead().length; }
export function onScanQueue(cb) { scanQListeners.add(cb); return () => scanQListeners.delete(cb); }
function isNetworkErr(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|networkerror|load failed|timeout|fetch|connection/i.test(error?.message || "");
}

// สแกนด้วย QR (โหมดหน้าเครื่อง) — จบใน 1 round trip; ถ้าเน็ตหลุด เก็บเข้าคิวไว้ซิงค์ทีหลัง
export async function recordScanByQr(qr, { allowQueue = true } = {}) {
  const { data, error } = await supabase.rpc("record_scan_by_qr", { p_token: authToken(), p_qr: qr });
  if (error) {
    if (allowQueue && isNetworkErr(error)) {
      const a = qRead(); a.push({ qr, ts: Date.now() }); qWrite(a);
      return { ok: true, queued: true };
    }
    console.warn("record_scan_by_qr error", error);
    return { ok: false, reason: "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}

// พยายามส่งคิวที่ค้างขึ้น server (เรียกตอนเน็ตกลับ/เป็นระยะ)
export async function flushScanQueue() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const a = qRead();
  if (a.length === 0) return;
  const remaining = [];
  for (const item of a) {
    // คิวมี 2 ชนิด: สแกนต่อชิ้น (item.qr) และงานหน้าเครื่อง (item.machineWork)
    let data, error;
    if (item.machineWork) {
      // ใช้ token ปัจจุบันแทน token ที่บันทึกไว้ตอนออฟไลน์ (กัน token หมดอายุ)
      ({ data, error } = await supabase.rpc("record_machine_work", { ...item.machineWork, p_token: authToken() }));
    } else {
      ({ data, error } = await supabase.rpc("record_scan_by_qr", { p_token: authToken(), p_qr: item.qr }));
    }
    if (error) { remaining.push(item); continue; }               // เน็ต/DB ยังมีปัญหา เก็บไว้
    if (data && data.ok === false && data.reason === "unauthorized") { remaining.push(item); continue; } // token หมดอายุ รอ login ใหม่
    // อื่นๆ (ok / duplicate / not_found / machine_cannot / no_station) = จบ ไม่ต้อง retry
  }
  qWrite(remaining);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { flushScanQueue(); });
  setInterval(() => { if (qRead().length) flushScanQueue(); }, 15000);
}

// สร้าง release ทั้งใบ (หลาย Part) แบบ atomic — พังกลางคัน = rollback ทั้งใบ
// rows: [{ code, qty, unit_weight, length_mm, material, remark, routing:[] }]
// คืน { releasesCreated, partsCreated, unitsCreated }
export async function createReleaseBatch({ projectId, releaseOrder, releaseDate, releasedBy, makeQr, rows }) {
  const { data, error } = await supabase.rpc("create_release_batch", {
    p_token: authToken(),
    p_project_id: projectId,
    p_release_order: releaseOrder || null,
    p_release_date: releaseDate || null,
    p_released_by: releasedBy || null,
    p_make_qr: !!makeQr,
    p_rows: rows,
  });
  if (error) {
    console.warn("create_release_batch error", error);
    throw error;
  }
  return data || { releasesCreated: 0, partsCreated: 0, unitsCreated: 0 };
}

// สร้าง/แก้ไขพนักงาน + ตั้งรหัสผ่าน โดย client ไม่ต้องแตะ hash (DB hash ด้วย bcrypt)
// ส่ง id=null เพื่อสร้างใหม่, password="" เพื่อไม่เปลี่ยนรหัสตอนแก้ไข
export async function upsertEmployee(emp) {
  const { data, error } = await supabase.rpc("upsert_employee", {
    p_token: authToken(),
    p_id: emp.id || null,
    p_code: emp.code,
    p_name: emp.name,
    p_password: emp.password || "",
    p_role: emp.role || "operator",
    p_department_id: emp.department_id || null,
    p_machine_id: emp.machine_id || null,
    p_operation_id: emp.operation_id || null,
    p_active: emp.active ?? true,
  });
  if (error) {
    console.warn("upsert_employee error", error);
    throw error;
  }
  return data; // uuid
}

// คำนวณสถานะชิ้นงานย้อนหลังของ Part หนึ่ง (หลังตั้ง/แก้ Routing) — คืน { updated, finished }
export async function recalcPartStatus(partMasterId) {
  const { data, error } = await supabase.rpc("recalc_part_status", { p_token: authToken(), p_part_master_id: partMasterId });
  if (error) { console.warn("recalc_part_status error", error); throw error; }
  return data || { updated: 0, finished: 0 };
}

// รวมยอดฝั่ง DB — แทนการโหลด part_units ทุกแถวมาคำนวณใน browser
export async function getProjectSummary() {
  const { data, error } = await supabase.rpc("project_summary");
  if (error) { console.warn("project_summary error", error); return []; }
  return data || [];
}
export async function getPartSummary() {
  const { data, error } = await supabase.rpc("part_summary");
  if (error) { console.warn("part_summary error", error); return []; }
  return data || [];
}

// scan log ทั้งหมดในช่วงเวลา สำหรับรายงาน — รวม scan_logs (สำนักงาน) +
// machine_records (หน้าเครื่อง) ผ่าน RPC report_logs (ดู migration-station-report-merge.sql)
// คืน array รูปทรงเดียวกับ scan_logs เดิม (machine/operation/employee/part_unit ซ้อน) → metrics.js ใช้ต่อได้เลย
export async function getScanLogsBetween(fromIso, toIso) {
  const { data, error } = await supabase.rpc("report_logs", { p_from: fromIso, p_to: toIso });
  if (error) { console.warn("report_logs error", error); return []; }
  return data || [];
}

// ── หน้าเครื่อง (Machine Station) ────────────────────────────────────────
// ดึงบันทึกงานของ "เครื่องของ token นี้" เฉพาะวันนี้ + ยอดรวมประจำวัน (จาก DB)
// คืน { ok, daily:{quantity,weight,process_seconds}, records:[...] }
// (เครื่อง/พนักงานดึงจาก session token ฝั่ง DB — client ปลอมไม่ได้)
export async function getMachineDay() {
  const { data, error } = await supabase.rpc("machine_day", { p_token: authToken() });
  if (error) { console.warn("machine_day error", error); return { ok: false, message: error.message }; }
  return data || { ok: false };
}

// บันทึกงาน 1 ครั้งจากหน้าเครื่อง (atomic) — ถ้าเน็ตหลุด เก็บเข้าคิว localStorage ไว้ซิงค์ทีหลัง
// คืน { ok, reason?, message?, row?, daily? } หรือ { ok:true, queued:true }
export async function recordMachineWork({ qr, quantity, materialLengthMm, processSeconds, status }, { allowQueue = true } = {}) {
  const payload = {
    p_token: authToken(),
    p_qr: String(qr || "").trim(),
    p_quantity: Number(quantity) || 0,
    p_material_length: materialLengthMm == null || materialLengthMm === "" ? null : Number(materialLengthMm),
    p_process_seconds: Number(processSeconds) || 0,
    p_status: status || "inprocess",
  };
  const { data, error } = await supabase.rpc("record_machine_work", payload);
  if (error) {
    if (allowQueue && isNetworkErr(error)) {
      const a = qRead(); a.push({ machineWork: payload, ts: Date.now() }); qWrite(a);
      return { ok: true, queued: true };
    }
    console.warn("record_machine_work error", error);
    return { ok: false, reason: "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
