import { createClient } from "@supabase/supabase-js";
import {
  newClientId, cacheUnit, cacheUnitsBulk, getCachedUnit,
  setCachedProgress, getCachedProgress, setDaySnapshot, getDaySnapshot,
} from "./offline.js";

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
  // แบ่งหน้าเอง (page 1000) — กันเพดาน 1,000 แถวของ PostgREST ที่ตัดข้อมูลเงียบๆ (H5)
  const pageSize = 1000; let from = 0; let all = [];
  for (;;) {
    let q = supabase.from(table).select("*");
    if (filters) { for (const [col, val] of Object.entries(filters)) q = q.eq(col, val); }
    if (order) q = q.order(order, { ascending });
    q = q.range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) { console.warn("listRows error", table, error); return all; }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
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

// ลบพนักงาน (admin เท่านั้น) — ผ่าน RPC
//   คืน { ok:true, detached } เมื่อลบสำเร็จ
//   คืน { ok:false, reason:'has_records', count } เมื่อมีประวัติงาน (ยังไม่ยืนยัน)
//   คืน { ok:false, reason:'self' } เมื่อพยายามลบบัญชีตัวเอง
//   force=true = ยืนยันลบทั้งที่มีประวัติ (ประวัติงานยังอยู่ แต่ตัดชื่อผู้ทำออก)
export async function deleteEmployee(id, force = false) {
  const { data, error } = await supabase.rpc("authz_delete_employee", { p_token: authToken(), p_id: id, p_force: !!force });
  if (error) { console.warn("authz_delete_employee error", error); throw error; }
  return data || { ok: false, reason: "unknown" };
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

const UNIT_SELECT = "*, part_master(*, projects(code, name)), release:releases(*)";

// หา part_unit จาก QR code ที่สแกนได้ (ใช้บ่อยในหน้าสแกน)
// ออนไลน์ = ถามฐานข้อมูล + เก็บลงแคชไว้ใช้ออฟไลน์ · ออฟไลน์/เน็ตมีปัญหา = อ่านจากแคช
export async function findUnitByQr(qrCode) {
  const qr = String(qrCode || "").trim();
  if (!qr) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return await getCachedUnit(qr);                       // ออฟไลน์ → แคชอย่างเดียว
  }
  const { data, error } = await supabase
    .from("part_units").select(UNIT_SELECT).eq("qr_code", qr).maybeSingle();
  if (error) {
    console.warn("findUnitByQr error", error);
    return (await getCachedUnit(qr)) || null;             // เน็ตสะดุด → ลองแคช
  }
  if (data) cacheUnit(data);                              // เก็บไว้ใช้ตอนเน็ตหลุด
  return data;
}

// โหลดชิ้นงานล่วงหน้ามาเก็บในเครื่อง (เรียกตอนออนไลน์) เพื่อให้สแกนออฟไลน์เจอข้อมูล
// จำกัดจำนวนไว้กันหน่วง — ดึงล็อตล่าสุดก่อน (โอกาสถูกสแกนสูงสุด)
export async function prefetchUnitsForOffline(limit = 4000) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  const pageSize = 1000; let from = 0; let total = 0;
  for (; from < limit;) {
    const { data, error } = await supabase
      .from("part_units").select(UNIT_SELECT)
      .order("created_at", { ascending: false })
      .range(from, Math.min(from + pageSize, limit) - 1);
    if (error) { console.warn("prefetchUnits error", error); break; }
    if (!data || !data.length) break;
    await cacheUnitsBulk(data);
    total += data.length;
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return total;
}

// จำนวนที่บันทึกไปแล้วของล็อต/รีลีสนี้ (รวมทุกครั้งที่หน้าเครื่องกด SAVE)
// ใช้ทำ running number บนป้ายหน้าเครื่อง เช่น "101 OF 500"
//   ออนไลน์ = ยอดจริงจาก DB + งานที่ยังค้างคิว (ยังไม่ซิงค์) แล้ว snapshot ไว้
//   ออฟไลน์ = snapshot ล่าสุด + งานที่ค้างคิว
export async function getReleaseProgress(releaseId, operationId = null) {
  if (!releaseId) return 0;
  // นับ "แยกตามขั้นตอน (operation) ของเครื่องนี้" — เครื่องตัด/เจาะ/บาก มีตัวนับของตัวเอง
  // ยึดตามเครื่องจักรเป็นหลัก: เจาะไปกี่ชิ้น OF จำนวนสั่ง โดยไม่รวมยอดของขั้นตอนอื่น
  const key = releaseId + (operationId ? "|" + operationId : "");
  // สเตชันนี้ทำ operation เดียว → งานค้างคิวทั้งหมดคือ operation นี้อยู่แล้ว
  const queued = queuedQtyForRelease(releaseId);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return (await getCachedProgress(key)) + queued;
  }
  let q = supabase.from("machine_records").select("quantity").eq("release_id", releaseId);
  if (operationId) q = q.eq("operation_id", operationId);   // เฉพาะขั้นตอนของเครื่องนี้
  const { data, error } = await q;
  if (error) {
    console.warn("getReleaseProgress error", error);
    return (await getCachedProgress(key)) + queued;
  }
  const done = (data || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  setCachedProgress(key, done);                           // snapshot ไว้ใช้ออฟไลน์ (แยกตาม operation)
  return done + queued;
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

// ความคืบหน้า "แยกตามขั้นตอน" ต่อ Release (จากงานหน้าเครื่อง machine_records)
// คืน { <release_id>: [ {op, seq, done, finished}, ... ] } — ดู release_op_progress RPC
export async function getReleaseOpProgress(releaseIds) {
  if (!releaseIds || releaseIds.length === 0) return {};
  const { data, error } = await supabase.rpc("release_op_progress", { p_release_ids: releaseIds });
  if (error) { console.warn("release_op_progress error", error); return {}; }
  return data || {};
}

// ความคืบหน้า "เสร็จ" ต่อโปรเจค จากงานหน้าเครื่อง (ขั้นตอนสุดท้าย) — ดู migration 13
// คืน { <project_id>: { finished, weight } }
export async function getProjectStationProgress() {
  const { data, error } = await supabase.rpc("project_station_progress");
  if (error) { console.warn("project_station_progress error", error); return {}; }
  return data || {};
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
// เขียนคิวลง localStorage แบบ "ไม่โยน error" — ถ้าที่เก็บเต็ม (quota/โหมดส่วนตัว) จะ
// warn + แจ้ง event แทนที่จะทำให้ flush ค้าง (ดู B4 ในรายงานคุณภาพ) · คืน true=สำเร็จ
function qWrite(a) {
  try {
    localStorage.setItem(SCAN_Q_KEY, JSON.stringify(a));
    scanQListeners.forEach((f) => { try { f(a.length); } catch (_) {} });
    return true;
  } catch (e) {
    console.warn("qWrite failed (storage full?)", e);
    try { window.dispatchEvent(new CustomEvent("mls-storage-full")); } catch (_) { /* ignore */ }
    return false;
  }
}
export function scanQueueCount() { return qRead().length; }
export function onScanQueue(cb) { scanQListeners.add(cb); return () => scanQListeners.delete(cb); }
// รวมจำนวนชิ้นที่ค้างคิว (ยังไม่ซิงค์) ของ release หนึ่ง — ใช้ทำ running number ให้ตรงตอนออฟไลน์
function queuedQtyForRelease(releaseId) {
  if (!releaseId) return 0;
  return qRead().reduce((s, it) =>
    s + (it.release_id === releaseId ? (Number(it.machineWork?.p_quantity) || 0) : 0), 0);
}
function isNetworkErr(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|networkerror|load failed|timeout|fetch|connection/i.test(error?.message || "");
}

// ── คิว "ซิงค์ไม่สำเร็จถาวร" — งานที่ทำออฟไลน์แล้วพอจะซิงค์ กลับเจอว่า QR/ล็อตถูกลบ
//    หรือถูกแก้ฝั่งออฟฟิศ (not_found ฯลฯ) → ไม่ทิ้งเงียบ เก็บไว้ให้แจ้ง/ลองใหม่ได้
const REJECT_Q_KEY = "mls-scan-rejected";
const rejectListeners = new Set();
function rjRead() { try { return JSON.parse(localStorage.getItem(REJECT_Q_KEY)) || []; } catch { return []; } }
function rjWrite(a) { localStorage.setItem(REJECT_Q_KEY, JSON.stringify(a)); rejectListeners.forEach((f) => { try { f(a.length); } catch (_) {} }); }
function pushRejected(item, reason) {
  const a = rjRead();
  if (item.qid && a.some((r) => r.qid === item.qid)) return;   // กันซ้ำในคิว rejected (bug: overlapping flush)
  a.push({ ...item, reason, rejectedAt: Date.now() }); rjWrite(a);
}
export function rejectedQueueCount() { return rjRead().length; }
export function onRejectedQueue(cb) { rejectListeners.add(cb); return () => rejectListeners.delete(cb); }
export function listRejected() { return rjRead(); }
// เอากลับเข้าคิวลองซิงค์ใหม่ (เช่นหลังออฟฟิศกู้ล็อตคืน)
export function retryRejected() {
  const rj = rjRead(); if (!rj.length) return;
  const q = qRead();
  for (const it of rj) { const { reason, rejectedAt, ...orig } = it; q.push(orig); }
  qWrite(q); rjWrite([]); flushScanQueue();
}
export function clearRejected() { rjWrite([]); }

// สแกนด้วย QR (โหมดหน้าเครื่อง) — จบใน 1 round trip; ถ้าเน็ตหลุด เก็บเข้าคิวไว้ซิงค์ทีหลัง
export async function recordScanByQr(qr, { allowQueue = true } = {}) {
  const { data, error } = await supabase.rpc("record_scan_by_qr", { p_token: authToken(), p_qr: qr });
  if (error) {
    if (allowQueue && isNetworkErr(error)) {
      const a = qRead(); a.push({ qr, qid: newClientId(), ts: Date.now() });
      if (!qWrite(a)) return { ok: false, reason: "storage_full", message: "ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ" };
      return { ok: true, queued: true };
    }
    console.warn("record_scan_by_qr error", error);
    return { ok: false, reason: "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}

// พยายามส่งคิวที่ค้างขึ้น server (เรียกตอนเน็ตกลับ/เป็นระยะ)
// ⚠️ ปลอดภัยต่อการเรียกซ้อน: มี guard กันรันพร้อมกัน + เอาออกจากคิวตาม "qid" (ไม่ทับของ
//    ที่ถูก enqueue ระหว่างซิงค์) — กันงานออฟไลน์หายจากการเขียนทับคิว
let _flushing = false;
export async function flushScanQueue() {
  if (_flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  // ให้ทุก item มี qid (migrate ของเก่าที่ยังไม่มี) เพื่อเอาออกแบบเจาะจงตอนจบ
  let a = qRead();
  if (a.length === 0) return;
  let migrated = false;
  a = a.map((it) => (it.qid ? it : (migrated = true, { ...it, qid: newClientId() })));
  if (migrated) qWrite(a);

  _flushing = true;
  const done = new Set();          // qid ที่จัดการเสร็จแล้ว (สำเร็จ/ถูก reject) → เอาออกจากคิว
  const bumped = new Map();        // qid -> จำนวนครั้งที่ลองแล้วพลาด (นับเฉพาะ error รอบนี้)
  const rejects = [];
  const MAX_ATTEMPTS = 12;         // ~3 นาที (flush ทุก 15 วิ) ก่อนยอมแพ้ → ย้ายไป rejected (H3)
  try {
    for (const item of a) {
      let data, error;
      if (item.machineWork) {
        ({ data, error } = await supabase.rpc("record_machine_work", { ...item.machineWork, p_token: authToken() }));
      } else {
        ({ data, error } = await supabase.rpc("record_scan_by_qr", { p_token: authToken(), p_qr: item.qr }));
      }
      if (error) {
        // แยก "เน็ต/DB สะดุด" (retry) ออกจาก "พลาดถาวร" (วนไม่จบ) — H3
        if (typeof navigator !== "undefined" && navigator.onLine === false) continue; // ออฟไลน์ = ไม่ถือเป็นครั้ง
        const at = (Number(item.attempts) || 0) + 1;
        if (at >= MAX_ATTEMPTS) { rejects.push({ item, reason: "retry_exhausted" }); done.add(item.qid); }
        else bumped.set(item.qid, at);                            // ยังไม่ถึงเพดาน → คงไว้ retry (บันทึกจำนวนครั้ง)
        continue;
      }
      if (data && data.ok === false) {
        if (data.reason === "unauthorized") continue;             // token หมดอายุ → คงไว้รอ login
        rejects.push({ item, reason: data.reason });              // ลบ/แก้ฝั่งออฟฟิศ → rejected (ทั้ง machine/office)
        done.add(item.qid);
        continue;
      }
      done.add(item.qid);                                         // ok / deduped = สำเร็จ
    }
  } finally {
    // ★ ปลดล็อกก่อนเสมอ — กันค้างถาวรถ้าเขียน localStorage พลาด (B4)
    _flushing = false;
    try {
      // read-modify-write: อ่านคิวปัจจุบัน (อาจมีของใหม่ที่เพิ่งเข้ามา) แล้วเอาออกเฉพาะ qid ที่จัดการเสร็จ
      // + อัปเดตจำนวนครั้งที่ลองพลาด (attempts) ของ item ที่ยังคงอยู่
      const cur = qRead();
      qWrite(cur.filter((it) => !done.has(it.qid))
                .map((it) => (bumped.has(it.qid) ? { ...it, attempts: bumped.get(it.qid) } : it)));
      for (const r of rejects) pushRejected(r.item, r.reason);    // pushRejected กันซ้ำด้วย qid แล้ว
    } catch (e) { console.warn("flush finalize failed", e); }
  }
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

// ── สำรองข้อมูล (Backup / Export) ────────────────────────────────────────
// ดึงข้อมูล "ทุกตารางหลัก" ออกมาเป็นก้อน JSON เดียว เพื่อดาวน์โหลดเก็บเอง
// (สำรองอีกชั้นนอกเหนือจากแบ็คอัพอัตโนมัติของ Supabase) — อ่านอย่างเดียว ไม่แก้ข้อมูล
// หมายเหตุ: ไม่รวม employees — คอลัมน์ password_hash ถูกซ่อนจาก anon (security-hardening)
//   ทำให้ select * ล้มเหลว/ได้ 0 แถว และนำเข้ากลับก็ชน NOT NULL · จัดการพนักงานที่ Setup
export const BACKUP_TABLES = [
  "projects", "part_master", "releases", "part_units",
  "scan_logs", "machine_records", "operations", "machines",
  "machine_operations", "departments",
];

export async function exportAllData(onProgress) {
  const tables = {};
  const counts = {};
  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const t = BACKUP_TABLES[i];
    if (onProgress) onProgress({ table: t, index: i, total: BACKUP_TABLES.length });
    const rows = await listRows(t);
    tables[t] = rows;
    counts[t] = rows.length;
  }
  return {
    _meta: {
      app: "machining-line-system",
      version: 1,
      exportedAt: new Date().toISOString(),
      counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    tables,
  };
}

// ── จุดกู้คืนในแอป (Restore Points) — ผ่าน RPC (ตรวจ admin ฝั่ง DB) ─────────
export async function ensureDailyBackup() {
  const { data, error } = await supabase.rpc("ensure_daily_backup", { p_token: authToken() });
  if (error) { console.warn("ensure_daily_backup", error); return null; }
  return data;
}
export async function listBackups() {
  const { data, error } = await supabase.rpc("list_backups", { p_token: authToken() });
  if (error) { console.warn("list_backups", error); throw error; }
  return data || [];
}
export async function snapshotAllProjects(kind = "manual") {
  const { data, error } = await supabase.rpc("snapshot_all_projects", { p_token: authToken(), p_kind: kind });
  if (error) { console.warn("snapshot_all_projects", error); throw error; }
  return data;
}
export async function snapshotProject(projectId, kind = "manual") {
  const { data, error } = await supabase.rpc("snapshot_project", { p_token: authToken(), p_project_id: projectId, p_kind: kind });
  if (error) { console.warn("snapshot_project", error); throw error; }
  return data;
}
export async function restoreBackup(backupId, mode = "merge") {
  const { data, error } = await supabase.rpc("restore_backup", { p_token: authToken(), p_backup_id: backupId, p_mode: mode });
  if (error) { console.warn("restore_backup", error); throw error; }
  return data;
}
// นำเข้าไฟล์สำรอง (JSON ที่ดาวน์โหลดไว้) กลับเข้าระบบ — เติมเฉพาะที่หายไป (merge)
export async function importBackup(tables, mode = "merge") {
  const { data, error } = await supabase.rpc("import_backup", { p_token: authToken(), p_data: tables, p_mode: mode });
  if (error) { console.warn("import_backup", error); throw error; }
  return data;
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
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return offlineMachineDay();                           // ออฟไลน์ → snapshot + งานค้างคิว
  }
  const { data, error } = await supabase.rpc("machine_day", { p_token: authToken() });
  if (error) {
    console.warn("machine_day error", error);
    return offlineMachineDay();                           // เน็ตสะดุด → ใช้ snapshot แทนจอเปล่า
  }
  if (data && data.ok !== false) setDaySnapshot(data);    // เก็บ snapshot ล่าสุดไว้ใช้ออฟไลน์
  return data || { ok: false };
}

// รายการขั้นตอนที่เครื่องนี้ทำได้ (สำหรับปุ่มเลือกขั้นตอนบนหน้าเครื่อง)
// เก็บ cache ไว้ใช้ตอนออฟไลน์ด้วย (localStorage)
const MOPS_KEY = "mls-machine-ops";
export async function getMachineOps() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    try { return JSON.parse(localStorage.getItem(MOPS_KEY)) || []; } catch { return []; }
  }
  const { data, error } = await supabase.rpc("machine_ops", { p_token: authToken() });
  if (error) {
    console.warn("machine_ops error", error);
    try { return JSON.parse(localStorage.getItem(MOPS_KEY)) || []; } catch { return []; }
  }
  const list = data || [];
  try { localStorage.setItem(MOPS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

// สร้างภาพ "วันนี้" ตอนออฟไลน์ = snapshot ล่าสุด + งานที่ยังค้างคิว (ยังไม่ซิงค์)
async function offlineMachineDay() {
  const snap = (await getDaySnapshot()) || { ok: true, daily: { quantity: 0, weight: 0, process_seconds: 0 }, records: [] };
  const q = qRead().filter((it) => it.machineWork);
  if (!q.length) return { ...snap, offline: true };
  const daily = { ...(snap.daily || { quantity: 0, weight: 0, process_seconds: 0 }) };
  const records = Array.isArray(snap.records) ? [...snap.records] : [];
  let item = records.length;
  for (const it of q) {
    const mw = it.machineWork;
    daily.quantity = (Number(daily.quantity) || 0) + (Number(mw.p_quantity) || 0);
    daily.process_seconds = (Number(daily.process_seconds) || 0) + (Number(mw.p_process_seconds) || 0);
    records.push({
      id: "q-" + (it.ts || item), item: ++item,
      qty: Number(mw.p_quantity) || 0, status: mw.p_status,
      process_seconds: Number(mw.p_process_seconds) || 0,
      materials_length: mw.p_material_length, pending: true,   // ธง = ยังไม่ซิงค์
    });
  }
  return { ok: true, daily, records, offline: true };
}

// heartbeat: บอกเซิร์ฟเวอร์ว่าเครื่องนี้ยังใช้บัญชีอยู่ (กันเครื่องอื่นเข้าแทน) +
// เช็คว่าถูก superseded (โดนเข้าแทน) หรือยัง · fail-safe: error = ถือว่ายังปกติ
export async function sessionHeartbeat() {
  const t = authToken(); if (!t) return { ok: false };
  try {
    const { data, error } = await supabase.rpc("session_heartbeat", { p_token: t });
    if (error) return { ok: false };
    return data || { ok: false };
  } catch { return { ok: false }; }
}

// บันทึกงาน 1 ครั้งจากหน้าเครื่อง (atomic) — ถ้าเน็ตหลุด เก็บเข้าคิว localStorage ไว้ซิงค์ทีหลัง
// • p_client_id = UUID ต่อการบันทึก (สร้างครั้งเดียว) → กันข้อมูลซ้ำตอนซิงค์ (idempotency)
// • p_recorded_at = เวลาจริงบนเครื่องตอนกดบันทึก → ซิงค์ทีหลัง 5 วันก็ยังได้วัน/เวลาที่ทำจริง
// คืน { ok, reason?, message?, row?, daily? } หรือ { ok:true, queued:true }
export async function recordMachineWork(
  { qr, quantity, materialLengthMm, processSeconds, status, releaseId, clientId, recordedAt, operationId },
  { allowQueue = true } = {}
) {
  const payload = {
    p_token: authToken(),
    p_qr: String(qr || "").trim(),
    p_quantity: Number(quantity) || 0,
    p_material_length: materialLengthMm == null || materialLengthMm === "" ? null : Number(materialLengthMm),
    p_process_seconds: Number(processSeconds) || 0,
    p_status: status || "inprocess",
    p_client_id: clientId || newClientId(),               // idempotency key (คงเดิมทุกครั้งที่ลองซิงค์)
    p_recorded_at: recordedAt || new Date().toISOString(), // เวลาจริงตอนสแกน (เครื่องนี้)
    p_operation_id: operationId || null,                   // ขั้นตอนที่เลือกบนจอ (null = ใช้ของบัญชี)
  };
  const { data, error } = await supabase.rpc("record_machine_work", payload);
  if (error) {
    if (allowQueue && isNetworkErr(error)) {
      // เก็บ release_id ไว้นอก payload (RPC ไม่รับ) เพื่อคำนวณ running number ออฟไลน์
      const a = qRead(); a.push({ machineWork: payload, release_id: releaseId || null, qid: payload.p_client_id, ts: Date.now() });
      // ★ ถ้าเขียนคิวไม่ได้ (ที่เก็บเต็ม/โหมดส่วนตัว) อย่าบอกว่าสำเร็จ — งานจะหายเงียบ
      if (!qWrite(a)) return { ok: false, reason: "storage_full", message: "ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ" };
      return { ok: true, queued: true };
    }
    console.warn("record_machine_work error", error);
    return { ok: false, reason: "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
