import { createClient } from "@supabase/supabase-js";
import {
  newClientId, cacheUnit, cacheUnitsBulk, getCachedUnit, uncacheUnit, uncacheUnitsBulk,
  setCachedProgress, getCachedProgress, setDaySnapshot, getDaySnapshot,
  setCachedAsmState, getCachedAsmState,
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

// ★ รอบ 11 (B17): ทุกคำขอมี timeout — Wi-Fi ขึ้นแต่เน็ตค้าง (half-open) เดิมรอเป็นนาที ปุ่ม OK หมุนค้าง
//   คิวซิงค์ค้างทั้งเครื่อง · ครบเวลา = ยกเลิกคำขอ → supabase-js คืน error "AbortError" → isNetworkErr = เน็ตสะดุด
//   (หน้าเครื่องเก็บเข้าคิว · client_id กันบันทึกซ้ำถ้าจริงๆ แล้ว server รับไปแล้ว)
const FETCH_TIMEOUT_MS = 20000;          // REST / RPC
const FETCH_TIMEOUT_UPLOAD_MS = 90000;   // อัปโหลดรูป (Storage)
function fetchWithTimeout(input, init = {}) {
  if (typeof AbortController === "undefined" || typeof fetch === "undefined") return fetch(input, init);
  const url = typeof input === "string" ? input : (input && input.url) || "";
  const ms = /\/storage\/v1\//.test(url) ? FETCH_TIMEOUT_UPLOAD_MS : FETCH_TIMEOUT_MS;
  const ctl = new AbortController();
  const outer = init && init.signal;
  if (outer) {
    if (outer.aborted) ctl.abort();
    else { try { outer.addEventListener("abort", () => ctl.abort(), { once: true }); } catch { /* ignore */ } }
  }
  const timer = setTimeout(() => { try { ctl.abort(); } catch { /* ignore */ } }, ms);
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { fetch: fetchWithTimeout } });

// อ่าน session token (ออกโดย verify_login, เก็บโดย auth.setSession) — แนบไปกับทุก
// การเขียน เพื่อให้ DB ตรวจ token + role ก่อนอนุญาต (ดู migration-2-rls-lockdown.sql)
function authToken() {
  try {
    const raw = localStorage.getItem("mls-session") || sessionStorage.getItem("mls-session");
    // ★ คืนเฉพาะเมื่อ "เจอ token จริง" — ถ้า blob ใน storage ไม่มี token ให้ตกไป cookie/in-memory
    //   (เดิม return ...||null ทันที → getSession เห็น user จาก cookie แต่ authToken คืน null = เด้งออก)
    if (raw) { const tk = JSON.parse(raw)?.token; if (tk) return tk; }
  } catch { /* storage ถูกบล็อก (iPad private/kiosk/Block-All-Cookies) → ไป fallback */ }
  // ★ cookie (คีย์ "mls_session" — ตรงกับ auth.js) : iPad/Safari ที่บล็อก localStorage/sessionStorage
  //   ต้องอ่านชั้นนี้ด้วย ไม่งั้น getSession เห็น user (จาก cookie) แต่ authToken หา token ไม่เจอ → ยืนยันตัวตนพัง เด้งออก
  try {
    const m = (typeof document !== "undefined" ? (document.cookie || "") : "").match(/(?:^|; )mls_session=([^;]*)/);
    if (m) { const raw = decodeURIComponent(m[1]); if (raw) return JSON.parse(raw)?.token || null; }
  } catch { /* ignore */ }
  try { return globalThis.__mlsSession?.token || null; } catch { return null; }
}

// ผู้ใช้ที่ล็อกอินอยู่ (object เดียวกับ auth.getSession) — ใช้ติดป้าย "เจ้าของ" งานในคิวออฟไลน์
function sessionUser() {
  try {
    const raw = localStorage.getItem("mls-session") || sessionStorage.getItem("mls-session");
    if (raw) { const u = JSON.parse(raw); if (u && u.token) return u; }
  } catch { /* ignore */ }
  try {
    const m = (typeof document !== "undefined" ? (document.cookie || "") : "").match(/(?:^|; )mls_session=([^;]*)/);
    if (m) { const u = JSON.parse(decodeURIComponent(m[1])); if (u && u.token) return u; }
  } catch { /* ignore */ }
  try { return globalThis.__mlsSession || null; } catch { return null; }
}
// วันที่ไทย (YYYY-MM-DD) — ยอด "วันนี้" ของหน้าเครื่องตัดวันตามเวลาไทยเหมือน server
function bkkDay(d = new Date()) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
  catch { return new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10); }
}
function queueOwner() {
  const u = sessionUser();
  if (!u || !u.id) return null;
  return { emp: u.id, code: u.code || null, name: u.name || null, machine: u.machine?.id || null, machineCode: u.machine?.code || null };
}

// ── ตรวจ error ว่าเป็น "session หมดอายุ/ไม่ถูกต้อง" → ยิง event ให้แอปเด้งออกจากระบบ ──
// (RPC authz_* จะ raise 'unauthorized: invalid session' / 'forbidden: ...' เมื่อ token ใช้ไม่ได้)
export function isAuthError(error) {
  // แยก authentication (token เสีย/หมดอายุ → เด้งออก) ออกจาก authorization (forbidden: admin only → แค่ไม่มีสิทธิ์ ไม่ต้องเด้งออก)
  return /unauthorized|invalid session|not.*authenticated|jwt|account disabled/i.test(error?.message || error?.hint || "");
}
function flagAuth(error) {
  if (isAuthError(error)) { try { window.dispatchEvent(new Event("mls-session-invalid")); } catch (_) { /* ignore */ } }
}

// ── Generic table helpers ───────────────────────────────────────────────────
// อ่าน (listRows) = query ตรงได้ (RLS ยังให้ SELECT) · เขียน = ผ่าน authz_* RPC เท่านั้น
// (anon ถูกเพิกถอนสิทธิ์ INSERT/UPDATE/DELETE ตรงในตารางแล้ว)

const ID_TABLES = new Set(["projects", "part_master", "releases", "part_units", "machines", "operations", "employees", "materials", "machine_records", "scan_logs"]);
export async function listRows(table, { order, ascending = true, filters, strict = false } = {}) {
  // แบ่งหน้าเอง (page 1000) — กันเพดาน 1,000 แถวของ PostgREST ที่ตัดข้อมูลเงียบๆ (H5)
  const pageSize = 1000; let from = 0; let all = [];
  for (;;) {
    let q = supabase.from(table).select("*");
    if (filters) { for (const [col, val] of Object.entries(filters)) q = q.eq(col, val); }
    if (order) q = q.order(order, { ascending });
    // ★ รอบ 11: เรียงด้วยค่าที่ซ้ำได้ (part_no / release_date) + แบ่งหน้า OFFSET = แถวซ้ำ/หายเงียบๆ → ต่อท้ายด้วย id
    if (order && order !== "id" && ID_TABLES.has(table)) q = q.order("id", { ascending: true });
    q = q.range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) { console.warn("listRows error", table, error); if (strict) throw error; return all; }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function insertRow(table, row) {
  const { data, error } = await supabase.rpc("authz_insert", { p_token: authToken(), p_tbl: table, p_payload: row });
  if (error) { console.warn("insertRow error", table, error); flagAuth(error); throw error; }
  return data;
}

export async function insertRows(table, rows) {
  const { data, error } = await supabase.rpc("authz_insert_many", { p_token: authToken(), p_tbl: table, p_payload: rows });
  if (error) { console.warn("insertRows error", table, error); flagAuth(error); throw error; }
  return data || [];
}

export async function updateRow(table, id, patch) {
  const { data, error } = await supabase.rpc("authz_update", { p_token: authToken(), p_tbl: table, p_id: id, p_payload: patch });
  if (error) { console.warn("updateRow error", table, error); flagAuth(error); throw error; }
  return data;
}

// Bulk update: apply the same patch to every row matching the given filters.
// Used e.g. to propagate a release's edited weight/length down to all its part_units.
export async function updateRows(table, filters, patch) {
  const { data, error } = await supabase.rpc("authz_update_where", { p_token: authToken(), p_tbl: table, p_filters: filters, p_payload: patch });
  if (error) { console.warn("updateRows error", table, error); flagAuth(error); throw error; }
  return data || 0; // จำนวนแถวที่อัปเดต
}

export async function deleteRow(table, id) {
  const { error } = await supabase.rpc("authz_delete", { p_token: authToken(), p_tbl: table, p_id: id });
  if (error) { console.warn("deleteRow error", table, error); flagAuth(error); throw error; }
}

// Delete many rows by id in one call (e.g. removing part_units when shrinking a release's qty).
export async function deleteRows(table, ids) {
  if (!ids || ids.length === 0) return;
  const { error } = await supabase.rpc("authz_delete_many", { p_token: authToken(), p_tbl: table, p_ids: ids });
  if (error) { console.warn("deleteRows error", table, error); flagAuth(error); throw error; }
}

// ออกจากระบบ — ยกเลิก token ฝั่ง DB (เรียกก่อน clearSession)
export async function logoutSession() {
  const t = authToken();
  if (t) { try { await supabase.rpc("logout", { p_token: t }); } catch (_) { /* ignore */ } }
}

// เปิด/ปิดการใช้งานพนักงาน (admin เท่านั้น) — ผ่าน RPC
export async function setEmployeeActive(id, active) {
  const { error } = await supabase.rpc("set_employee_active", { p_token: authToken(), p_id: id, p_active: active });
  if (error) { console.warn("set_employee_active error", error); flagAuth(error); throw error; }
}

// รายชื่อ session ที่กำลังล็อกอินอยู่ (admin เท่านั้น) — ใครออนไลน์/ผูกเครื่องไหน
//   คืน array ของ { sid, is_self, code, name, role, is_machine, machine_code,
//                   machine_name, last_seen, created_at, expires_at, online }
//   sid = รหัสอ้างอิง session (md5 ของ token — ไม่ใช่ token จริง) ใช้ส่งให้ forceLogoutSession
export async function listActiveSessions() {
  const { data, error } = await supabase.rpc("authz_list_sessions", { p_token: authToken() });
  if (error) { console.warn("authz_list_sessions error", error); flagAuth(error); throw error; }
  return data || [];
}

// บังคับ 1 session ออกจากระบบ (admin เท่านั้น) — set superseded → เครื่องนั้นซิงค์งานค้างแล้วเด้งออก
//   คืน { ok:true, kicked:1 } เมื่อสำเร็จ · { ok:false, reason:'self' } เมื่อพยายามเตะเครื่องตัวเอง
export async function forceLogoutSession(sid) {
  const { data, error } = await supabase.rpc("authz_force_logout", { p_token: authToken(), p_sid: sid });
  if (error) { console.warn("authz_force_logout error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "unknown" };
}

// แก้หัวเอกสาร Release ทั้งใบ (admin เท่านั้น) — เลขที่ Release Order / วันที่ / Modify(mdf_no)
//   releaseIds = id ของทุก Part ในใบ · releaseDate = ISO string (หรือ null = ไม่เปลี่ยน)
//   mdfNo = ค่า Modify (ส่ง null = ไม่แตะ) · คืน { ok, releases, parts }
export async function updateReleaseHeader({ releaseIds, releaseOrder, releaseDate, mdfNo }) {
  const { data, error } = await supabase.rpc("authz_update_release_header", {
    p_token: authToken(),
    p_release_ids: releaseIds,
    p_release_order: releaseOrder ?? null,
    p_release_date: releaseDate ?? null,
    p_mdf_no: mdfNo ?? null,
  });
  if (error) { console.warn("authz_update_release_header error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "unknown" };
}

// ★ รอบ 11 (A6): MDF NO. เก็บ "ต่อ Release" (releases.mdf_no) — ไม่ลามไปใบอื่นที่ใช้เบอร์เดียวกัน
//   คืน { ok, releases } · ยังไม่ได้รัน migration-audit-round11.sql → { ok:false, missing:true } (ให้ผู้เรียกใช้วิธีเดิม)
export async function setReleaseMdf(releaseIds, mdfNo) {
  const ids = (releaseIds || []).filter(Boolean);
  if (!ids.length) return { ok: true, releases: 0 };
  const { data, error } = await supabase.rpc("set_release_mdf", { p_token: authToken(), p_release_ids: ids, p_mdf_no: mdfNo ?? null });
  if (error) {
    if (isMissingFnErr(error)) return { ok: false, missing: true };
    console.warn("set_release_mdf error", error); flagAuth(error); throw error;
  }
  return data || { ok: false, reason: "unknown" };
}
// MDF ที่ใช้โชว์ของ Release หนึ่ง: ของใบนั้นก่อน (releases.mdf_no) → ของเบอร์ (part_master.mdf_no · ข้อมูลเก่า)
export function releaseMdf(release, partMaster) {
  const r = release?.mdf_no;
  if (r != null && String(r).trim() !== "") return r;
  const pm = partMaster ?? release?.part_master;
  return pm?.mdf_no ?? null;
}

// ★ รอบ 11 (B2): แก้ข้อมูลเบอร์ (ชื่อ · INV · น้ำหนัก/ชิ้น · ความยาว/ชิ้น) — RPC เฉพาะ · ยังไม่ติดตั้ง = ใช้ updateRow แบบเดิม
export async function updatePartMaster(id, { part_name, material, unit_weight, default_length_mm }) {
  const { data, error } = await supabase.rpc("part_master_update", {
    p_token: authToken(), p_id: id, p_part_name: part_name ?? null, p_material: material ?? null,
    p_unit_weight: unit_weight ?? null, p_default_length_mm: default_length_mm ?? null,
  });
  if (error) {
    if (isMissingFnErr(error)) { await updateRow("part_master", id, { part_name, material, unit_weight, default_length_mm }); return { ok: true, legacy: true }; }
    console.warn("part_master_update error", error); flagAuth(error); throw error;
  }
  if (data && data.ok === false) { const e = new Error(data.reason || "failed"); e.code = data.reason; throw e; }
  return data || { ok: true };
}

// ★ รอบ 11 (B2): เติมน้ำหนักย้อนหลังให้สแกนที่บันทึกตอน "ยังไม่มีน้ำหนักต่อชิ้น" (เก็บเป็น 0)
//   releaseIds = null → ทั้งหมด · onlyMissing=false (ต้องส่ง releaseIds) → คิดใหม่ทุกแถวของ Release นั้น · dryRun = นับอย่างเดียว
export async function recalcRecordWeights({ releaseIds = null, onlyMissing = true, dryRun = false } = {}) {
  const { data, error } = await supabase.rpc("recalc_record_weights", {
    p_token: authToken(), p_release_ids: releaseIds && releaseIds.length ? releaseIds : null,
    p_only_missing: !!onlyMissing, p_dry_run: !!dryRun,
  });
  if (error) {
    if (isMissingFnErr(error)) return { ok: false, missing: true };
    console.warn("recalc_record_weights error", error); flagAuth(error); throw error;
  }
  return data || { ok: false, reason: "unknown" };
}

// ── Audit log: บันทึก "ใครทำอะไร (สำคัญ/ลบได้) เมื่อไหร่" ─────────────────────
// เรียก "หลังการกระทำสำเร็จ" แบบ best-effort — ถ้า log พลาดจะไม่ทำให้การกระทำหลักล้ม
export async function auditRecord(action, entity = null, entityId = null, detail = null) {
  try {
    await supabase.rpc("authz_audit_record", {
      p_token: authToken(), p_action: action, p_entity: entity,
      p_entity_id: entityId == null ? null : String(entityId), p_detail: detail,
    });
  } catch (e) { console.warn("auditRecord failed:", action, e?.message || e); }
}

// อ่านประวัติการแก้ไข (admin เท่านั้น) — ล่าสุดก่อน · before = timestamptz สำหรับโหลดหน้าถัดไป
export async function listAuditLog({ limit = 200, before = null } = {}) {
  const { data, error } = await supabase.rpc("authz_list_audit", { p_token: authToken(), p_limit: limit, p_before: before });
  if (error) { console.warn("authz_list_audit error", error); flagAuth(error); throw error; }
  return data || [];
}

// เปลี่ยนรหัสผ่านของตัวเอง (ผู้ใช้คนไหนก็ได้ที่ล็อกอินอยู่) — ต้องกรอกรหัสเดิมถูก
//   คืน { ok:true } · { ok:false, reason:'wrong_old'|'too_short' }
export async function changeMyPassword(oldPw, newPw) {
  const { data, error } = await supabase.rpc("change_my_password", { p_token: authToken(), p_old: oldPw, p_new: newPw });
  if (error) { console.warn("change_my_password error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "unknown" };
}

// ลบเครื่องจักร (admin เท่านั้น) — ผ่าน RPC
//   คืน { ok:true, unbound, deleted_records } เมื่อสำเร็จ
//   คืน { ok:false, reason:'has_records', count } เมื่อมีประวัติงาน (ยังไม่ยืนยัน)
//   force=true = ยืนยันลบทั้งประวัติงานของเครื่องนี้ (ตัวเลขในรายงานจะหาย)
export async function deleteMachine(id, force = false) {
  const { data, error } = await supabase.rpc("authz_delete_machine", { p_token: authToken(), p_id: id, p_force: !!force });
  if (error) { console.warn("authz_delete_machine error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "unknown" };
}

// ลบพนักงาน (admin เท่านั้น) — ผ่าน RPC
//   คืน { ok:true, detached } เมื่อลบสำเร็จ
//   คืน { ok:false, reason:'has_records', count } เมื่อมีประวัติงาน (ยังไม่ยืนยัน)
//   คืน { ok:false, reason:'self' } เมื่อพยายามลบบัญชีตัวเอง
//   force=true = ยืนยันลบทั้งที่มีประวัติ (ประวัติงานยังอยู่ แต่ตัดชื่อผู้ทำออก)
export async function deleteEmployee(id, force = false) {
  const { data, error } = await supabase.rpc("authz_delete_employee", { p_token: authToken(), p_id: id, p_force: !!force });
  if (error) { console.warn("authz_delete_employee error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "unknown" };
}

// Delete a release entirely, along with every part_unit it created and any
// scan_logs recorded against those units (FK constraints require deleting
// children before parents). Caller is responsible for warning the user first
// if any of those units have already been scanned — this does not check.
export async function deleteReleaseCascade(releaseId) {
  // cascade (scan_logs → part_units → releases) ทำใน RPC เดียว = atomic + ตรวจสิทธิ์
  const { error } = await supabase.rpc("authz_delete_release", { p_token: authToken(), p_release_id: releaseId });
  if (error) { console.warn("deleteReleaseCascade error", error); flagAuth(error); throw error; }
}

// ลบความสามารถของเครื่อง 1 คู่ (machine_id + operation_id) — composite key ผ่าน RPC
export async function deleteCap(machineId, operationId) {
  const { error } = await supabase.rpc("authz_delete_cap", { p_token: authToken(), p_machine_id: machineId, p_operation_id: operationId });
  if (error) { console.warn("deleteCap error", error); flagAuth(error); throw error; }
}
// ตั้ง "ขั้นตอนที่ทำได้" (ความสามารถ) ของเครื่อง/สถานี = แทนที่ทั้งชุด (admin) — ผ่าน RPC เฉพาะ
// เลี่ยง authz_insert_many (generic) ที่ไม่รองรับตาราง machine_operations → เพิ่ม cap แรกไม่ได้ (forbidden)
export async function setMachineOps(machineId, operationIds) {
  const ids = Array.from(new Set((operationIds || []).filter(Boolean)));
  const { data, error } = await supabase.rpc("authz_set_machine_ops", { p_token: authToken(), p_machine_id: machineId, p_operation_ids: ids });
  if (error) { console.warn("authz_set_machine_ops error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
}

// ── ล้างข้อมูลสแกน (admin) — ราย Release หรือ รายชิ้น · preview=true = นับก่อน ไม่ลบ ──
export async function clearScansRelease(releaseId, { preview = false } = {}) {
  const { data, error } = await supabase.rpc("authz_clear_scans_release", { p_token: authToken(), p_release_id: releaseId, p_preview: preview });
  if (error) { console.warn("clearScansRelease error", error); flagAuth(error); throw error; }
  return data;
}
export async function clearScansUnit(partUnitId, { preview = false } = {}) {
  const { data, error } = await supabase.rpc("authz_clear_scans_unit", { p_token: authToken(), p_part_unit_id: partUnitId, p_preview: preview });
  if (error) { console.warn("clearScansUnit error", error); flagAuth(error); throw error; }
  return data;
}
// ล้างสแกน "ทั้งชุด Release" — ทุก Part ใน (project + release_order) เดียวกัน
export async function clearScansReleaseGroup(projectId, releaseOrder, { preview = false } = {}) {
  const { data, error } = await supabase.rpc("authz_clear_scans_release_group", { p_token: authToken(), p_project_id: projectId, p_release_order: releaseOrder ?? null, p_preview: preview });
  if (error) { console.warn("clearScansReleaseGroup error", error); flagAuth(error); throw error; }
  return data;
}

const UNIT_SELECT = "*, part_master(*, projects(code, name, status)), release:releases(*)";

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
  else uncacheUnit(qr);                                   // ★ Modify: QR ถูกยกเลิก/ลบแล้ว → เอาออกจากแคช (ออฟไลน์จะไม่สแกนผ่าน)
  return data;
}

// ── Release Modify (M-01, M-02 …) · migration-release-modify.sql ─────────────────
// ประวัติ M + ต้นฉบับ M-00 + ขีดจำกัดต่อ Part (ทำแล้ว / QR ที่ยังไม่ใช้) ของ Release Order
export async function getReleaseModifyInfo(projectId, releaseOrder) {
  const { data, error } = await supabase.rpc("get_release_modify_info", { p_project_id: projectId, p_release_order: releaseOrder });
  if (error) {
    console.warn("get_release_modify_info error", error);
    return { ok: false, reason: isMissingFnErr(error) ? "not_installed" : "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
// บันทึก Modify ทั้งชุด (admin) — ทุกรายการใน transaction เดียว (พังรายการไหน = ไม่บันทึกเลยสักรายการ)
export async function applyReleaseModify({ projectId, releaseOrder, versionNo, reason, items, docDate }) {
  const args = {
    p_token: authToken(), p_project_id: projectId, p_release_order: releaseOrder,
    p_version_no: versionNo == null ? null : Number(versionNo), p_reason: reason, p_items: items || [],
  };
  if (docDate) args.p_doc_date = docDate;   // วันที่ของ M ตามเอกสาร (YYYY-MM-DD) · migration-release-modify-revert.sql
  const { data, error } = await supabase.rpc("apply_release_modify", args);
  if (error) {
    console.warn("apply_release_modify error", error);
    flagAuth(error);
    return { ok: false, reason: isMissingFnErr(error) ? (docDate ? "date_not_installed" : "not_installed") : "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
// ยกเลิก M / ย้อนกลับเวอร์ชัน (admin) · migration-release-modify-revert.sql
//   mode "cancel" + version "M-03" = ยกเลิกเฉพาะ M-03 · mode "rollback" + version "M-01" = ยกเลิกทุก M ที่เลขสูงกว่า (M-00 = กลับต้นฉบับ)
//   dryRun = ดูผลก่อน (ไม่บันทึก)
export async function revertReleaseModify({ projectId, releaseOrder, mode, version, reason, dryRun = false, docDate = null }) {
  const { data, error } = await supabase.rpc("revert_release_modify", {
    p_token: authToken(), p_project_id: projectId, p_release_order: releaseOrder,
    p_mode: mode, p_version: version, p_reason: reason || "", p_dry_run: !!dryRun, p_doc_date: docDate || null,
  });
  if (error) {
    console.warn("revert_release_modify error", error);
    flagAuth(error);
    return { ok: false, reason: isMissingFnErr(error) ? "revert_not_installed" : "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
// แก้วันที่ของ M (target "modify") หรือวันที่ยกเลิก (target "revert") — admin · เก็บประวัติ เดิม → ใหม่
export async function setReleaseModDate({ modId, target = "modify", date, note = "" }) {
  const { data, error } = await supabase.rpc("set_release_mod_date", {
    p_token: authToken(), p_mod_id: modId, p_target: target, p_date: date, p_note: note || null,
  });
  if (error) {
    console.warn("set_release_mod_date error", error);
    flagAuth(error);
    return { ok: false, reason: isMissingFnErr(error) ? "date_not_installed" : "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
// หน้าเครื่อง: QR นี้เคยถูกยกเลิกใน Modify ไหม (ออนไลน์เท่านั้น · ไม่มี migration = คืน null เงียบๆ)
export async function lookupCancelledQr(qr) {
  const q = String(qr || "").trim();
  if (!q) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  try {
    const { data, error } = await supabase.rpc("lookup_cancelled_qr", { p_qr: q });
    if (error) return null;
    return data && data.found ? data : null;
  } catch { return null; }
}

// หาชิ้นงานจาก "เบอร์พาร์ท" (แทนการสแกน QR — เผื่อ QR เสีย/พิมพ์เอง)
// ★ สำคัญ: พาร์ทเดียวอาจมีหลาย release → ถ้าเลือก release มั่ว "เลขรัน (PROCESS/BALANCE)"
//   จะแยกคนละชุดกับตอนสแกน QR (ที่ได้ release เจาะจงจากตัว QR) → ยอดไม่ตรงกัน
//   แก้: เลือก "release ที่กำลังทำอยู่" = release ที่มี machine_record ล่าสุดของพาร์ทนี้
//   → พิมพ์เบอร์พาร์ทแล้วไปนับต่อกับชุดเดียวกับที่สแกน (เลขรันตรงกัน)
// ทำเป็นขั้น ๆ (เลี่ยง embedded-filter ของ PostgREST ที่ไม่เสถียร):
export async function findUnitByPartNo(partNo) {
  const p = String(partNo || "").trim();
  if (!p) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;  // ต้องมีเน็ต
  // 1) หาพาร์ทที่ part_no ตรง (ไม่สนตัวพิมพ์เล็ก-ใหญ่/ช่องว่างหัวท้าย)
  const { data: pms, error: e1 } = await supabase
    .from("part_master").select("id").ilike("part_no", p);
  if (e1) { console.warn("findUnitByPartNo (part_master) error", e1); return null; }
  const ids = (pms || []).map((x) => x.id).filter(Boolean);
  if (!ids.length) return null;                            // ไม่มีพาร์ทเบอร์นี้ในระบบ

  // 2) หา "release ที่กำลังทำอยู่" = release ที่เพิ่งมี machine_record ล่าสุดของพาร์ทนี้
  //    (จับให้ตรงกับชุดที่สแกน QR อยู่ → เลขรันไม่แตกเป็นคนละชุด)
  let activeReleaseId = null;
  const { data: recent } = await supabase
    .from("machine_records").select("release_id")
    .in("part_master_id", ids)
    .not("release_id", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(1);
  if (recent && recent[0]) activeReleaseId = recent[0].release_id;

  // 3) เอา unit สักตัวของ release ที่กำลังทำ (ยังไม่เคยทำ → activeReleaseId=null ค่อย fallback)
  let u = null;
  if (activeReleaseId) {
    const { data } = await supabase
      .from("part_units").select(UNIT_SELECT)
      .eq("release_id", activeReleaseId).in("part_master_id", ids)
      .order("unit_no", { ascending: true }).limit(1);
    u = (data && data[0]) || null;
  }
  // fallback: ยังไม่เคยทำพาร์ทนี้ (ไม่มี record) → เอา unit แรกที่ผูก release แล้ว
  if (!u) {
    const { data, error } = await supabase
      .from("part_units").select(UNIT_SELECT)
      .in("part_master_id", ids)
      .order("release_id", { ascending: true, nullsFirst: false })
      .order("unit_no", { ascending: true }).limit(1);
    if (error) { console.warn("findUnitByPartNo error", error); return null; }
    u = (data && data[0]) || null;
  }
  if (u) cacheUnit(u);
  return u;
}

// พิมพ์เบอร์พาร์ท → คืน "ตัวเลือกระดับโปรเจค" (part_no ไม่ซ้ำในโปรเจคเดียว = 1 โปรเจค 1 part_master)
// ★ ผู้ใช้เลือกแค่ "โปรเจค" พอ (ไม่ต้องเลือก release) — ระบบ resolve unit ให้เอง
//   • done = ขั้นตอนนี้ (operation) "เคยทำ" ของโปรเจคนี้ไปกี่ครั้ง → เรียงโปรเจคที่ยังไม่เคยทำขึ้นก่อน
//     (โปรเจคที่ทำแล้วยังเลือกได้ ไว้แก้งานเสีย)
//   • unit ตัวแทน = ชิ้นของ "release ที่ยังทำอยู่" (record ล่าสุดของขั้นตอนนี้) ไม่งั้นชิ้นแรกของโปรเจค
// คืน [{ pmId, code, name, partName, length, doneCount, unit }] เรียงยังไม่เคยทำก่อน · [] ถ้าไม่พบ/ออฟไลน์
export async function findManualPartOptions(partNo, operationId = null) {
  const p = String(partNo || "").trim();
  if (!p) return [];
  if (typeof navigator !== "undefined" && navigator.onLine === false) return [];  // ต้องมีเน็ต
  // 1) part_master (1 ต่อ 1 โปรเจค) ที่ part_no ตรง
  const { data: pms, error: e1 } = await supabase
    .from("part_master").select("id, part_no, part_name, default_length_mm, projects(code, name, status)")
    .ilike("part_no", p);
  if (e1) { console.warn("findManualPartOptions (part_master) error", e1); return []; }
  // ตัดโปรเจคที่ "ปิดแล้ว" ออก — บันทึกไม่ได้อยู่แล้ว ไม่ต้องให้เลือก (ถ้าต้องแก้งาน ให้แอดมินเปิดโปรเจคก่อน)
  const masters = (pms || []).filter((m) => m.projects?.status !== "closed");
  if (!masters.length) return [];
  const ids = masters.map((m) => m.id);
  // 2) ชิ้นงานของทุก part_master (ไว้ resolve + เอาความยาวเฉพาะชิ้น)
  const { data: units } = await supabase.from("part_units").select(UNIT_SELECT)
    .in("part_master_id", ids).order("unit_no", { ascending: true });
  const allUnits = units || [];
  // 3) บันทึกของ "ขั้นตอนนี้" (ไว้หา doneCount + release ที่ยังทำอยู่ ต่อโปรเจค)
  let recs = [];
  if (operationId) {
    const { data: r } = await supabase.from("machine_records")
      .select("part_master_id, release_id, recorded_at")
      .in("part_master_id", ids).eq("operation_id", operationId)
      .order("recorded_at", { ascending: false });
    recs = r || [];
  }
  const out = [];
  for (const m of masters) {
    const mUnits = allUnits.filter((u) => u.part_master_id === m.id);
    if (!mUnits.length) continue;                          // ไม่มีชิ้น = บันทึกไม่ได้ → ข้าม
    const mRecs = recs.filter((r) => r.part_master_id === m.id);   // เรียงใหม่→เก่าอยู่แล้ว
    let unit = null;
    if (mRecs.length && mRecs[0].release_id) unit = mUnits.find((u) => u.release_id === mRecs[0].release_id) || null;
    if (!unit) unit = mUnits[0];                           // ยังไม่เคยทำ → ชิ้นแรกของโปรเจค
    out.push({
      pmId: m.id, code: m.projects?.code || "", name: m.projects?.name || "",
      partName: m.part_name || "", length: unit.length_mm ?? m.default_length_mm,
      doneCount: mRecs.length, lastTs: mRecs[0]?.recorded_at || null, unit,
    });
  }
  // ยังไม่เคยทำขั้นตอนนี้ (0) ขึ้นก่อน · ในกลุ่มเดียวกันเรียง "งานล่าสุด" ขึ้นก่อน (โปรเจคที่กำลังทำลอยขึ้น)
  out.sort((a, b) => {
    const af = a.doneCount === 0 ? 0 : 1, bf = b.doneCount === 0 ? 0 : 1;
    if (af !== bf) return af - bf;
    return String(b.lastTs || "").localeCompare(String(a.lastTs || ""));
  });
  return out;
}

// โหลดชิ้นงานล่วงหน้ามาเก็บในเครื่อง (เรียกตอนออนไลน์) เพื่อให้สแกนออฟไลน์เจอข้อมูล
// จำกัดจำนวนไว้กันหน่วง — ดึงล็อตล่าสุดก่อน (โอกาสถูกสแกนสูงสุด)
let _prefetchingUnits = false;
// ★ รอบ 11 (B27): โหลดล่วงหน้าไม่เกิน 1 ครั้ง / 20 นาที ต่อเครื่อง (เดิมทุกครั้งที่เปิดหน้า + ทุกครั้งที่เน็ตกลับ
//   → เน็ตในโรงงานกระพริบทีเดียว 50 แท็บเล็ตยิงพร้อมกัน ~200 คำขอหนัก) · force = บังคับโหลด
const PREFETCH_AT_KEY = "mls-prefetch-units-at";
const PREFETCH_EVERY_MS = 20 * 60 * 1000;
export async function prefetchUnitsForOffline(limit = 4000, { force = false } = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  if (_prefetchingUnits) return 0;                 // ★ กันรันซ้อน (mount + online event + เน็ตกระพริบ) = โหลดซ้ำหลายพันแถวโดยเปล่าประโยชน์
  if (!force) {
    try { const at = Number(localStorage.getItem(PREFETCH_AT_KEY)) || 0; if (Date.now() - at < PREFETCH_EVERY_MS) return 0; } catch { /* ignore */ }
  }
  _prefetchingUnits = true;
  try {
    const pageSize = 1000; let from = 0; let total = 0;
    for (; from < limit;) {
      const { data, error } = await supabase
        .from("part_units").select(UNIT_SELECT)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(from, Math.min(from + pageSize, limit) - 1);
      if (error) { console.warn("prefetchUnits error", error); break; }
      if (!data || !data.length) break;
      await cacheUnitsBulk(data);
      if (from === 0) { try { localStorage.setItem(PREFETCH_AT_KEY, String(Date.now())); } catch { /* ignore */ } }
      total += data.length;
      if (data.length < pageSize) break;
      from += pageSize;
    }
    // ★ Modify: QR ที่ถูกยกเลิก (ลดจำนวน/ยกเลิก Part) → ลบออกจากแคช กันเครื่องออฟไลน์สแกนผ่าน
    try {
      const { data: gone, error: gErr } = await supabase.rpc("list_cancelled_qr", { p_limit: 5000 });
      if (!gErr && Array.isArray(gone) && gone.length) await uncacheUnitsBulk(gone);
    } catch { /* ยังไม่ได้รัน migration → ข้าม */ }
    return total;
  } finally { _prefetchingUnits = false; }
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
  // ★ นับงานค้างคิว "เฉพาะขั้นตอนนี้" (กันเครื่องหลายขั้นตอนนับข้ามกันตอนออฟไลน์)
  const queued = queuedQtyForRelease(releaseId, operationId);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return (await getCachedProgress(key)) + queued;
  }
  // ★ รอบ 11 (B24): รวมยอดฝั่ง server ครั้งเดียว (station_progress) — ไม่ต้องโหลดทุกแถวมารวม
  const sp = await stationProgressRpc({ releaseId, operationId });
  if (sp.ok) {
    setCachedProgress(key, sp.done);
    return sp.done + queued;
  }
  if (sp.error) return (await getCachedProgress(key)) + queued;
  // ยังไม่ได้รัน migration-audit-round11.sql → แบบเดิม (แบ่งหน้า + เรียงด้วย id กันแถวซ้ำ/หาย)
  let done = 0; const pageSize = 1000; let from = 0;
  for (;;) {
    let q = supabase.from("machine_records").select("quantity").eq("release_id", releaseId);
    if (operationId) q = q.eq("operation_id", operationId);   // เฉพาะขั้นตอนของเครื่องนี้
    q = q.order("id", { ascending: true }).range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) {
      console.warn("getReleaseProgress error", error);
      return (await getCachedProgress(key)) + queued;
    }
    done += (data || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  setCachedProgress(key, done);                           // snapshot ไว้ใช้ออฟไลน์ (แยกตาม operation)
  return done + queued;
}

// station_progress RPC (รอบ 11) — { ok, done, unitOpCount, lock } · ยังไม่ติดตั้ง = { ok:false, missing:true } · พลาด = { ok:false, error }
let _spMissing = false;
async function stationProgressRpc({ releaseId, operationId, machineId = null, partUnitId = null, sinceIso = null }) {
  if (_spMissing) return { ok: false, missing: true };
  const { data, error } = await supabase.rpc("station_progress", {
    p_release_id: releaseId, p_operation_id: operationId || null, p_machine_id: machineId || null,
    p_part_unit_id: partUnitId || null, p_since: sinceIso || null,
  });
  if (error) {
    if (isMissingFnErr(error)) { _spMissing = true; return { ok: false, missing: true }; }
    console.warn("station_progress error", error);
    return { ok: false, error };
  }
  return {
    ok: true,
    done: Number(data?.done) || 0,
    unitOpCount: Number(data?.unit_op_count) || 0,
    lock: { finishedExists: !!data?.finished_exists, inProcessExists: !!data?.inprocess_exists },
  };
}

// ข้อมูลตอนสแกนหน้าเครื่อง (เลขวิ่ง + เตือน rework + ล็อกสถานะ) ในคำขอเดียว — เดิมยิง 3 คำขอต่อกัน
//   คืน { done (รวมงานค้างคิวแล้ว), dup, lock } · ออฟไลน์/พลาด = ใช้ snapshot + ไม่ล็อก (fail-open เหมือนเดิม)
export async function getStationScanInfo({ releaseId, operationId, machineId, partUnitId, sinceIso }) {
  const none = { finishedExists: false, inProcessExists: false };
  if (!releaseId || !operationId) return { done: null, dup: 0, lock: none };
  const key = releaseId + "|" + operationId;
  const queued = queuedQtyForRelease(releaseId, operationId);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) return { done: (await getCachedProgress(key)) + queued, dup: 0, lock: none };
  const sp = await stationProgressRpc({ releaseId, operationId, machineId, partUnitId, sinceIso });
  if (sp.ok) {
    setCachedProgress(key, sp.done);
    return { done: sp.done + queued, dup: sp.unitOpCount, lock: machineId ? sp.lock : none };
  }
  // ยังไม่ติดตั้ง/พลาด → วิธีเดิม แต่ยิงพร้อมกัน
  const [done, dup, lock] = await Promise.all([
    getReleaseProgress(releaseId, operationId),
    partUnitId ? countUnitOpRecords(partUnitId, operationId) : Promise.resolve(0),
    machineId ? getScanStatusLock(releaseId, operationId, machineId, sinceIso) : Promise.resolve(none),
  ]);
  return { done, dup, lock };
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

// นับว่าชิ้นนี้ (part_unit) เคยถูกบันทึก "ขั้นตอนนี้" ไปแล้วกี่ครั้ง — ใช้เตือน rework ตอนสแกน
// คืน 0 เมื่อไม่มี/ออฟไลน์/ผิดพลาด (ไม่บล็อกการทำงาน — แค่ข้อมูลเสริมสำหรับเตือน)
export async function countUnitOpRecords(partUnitId, operationId) {
  if (!partUnitId || !operationId) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  const { count, error } = await supabase
    .from("machine_records")
    .select("id", { count: "exact", head: true })
    .eq("part_unit_id", partUnitId)
    .eq("operation_id", operationId);
  if (error) { console.warn("countUnitOpRecords error", error); return 0; }
  return count || 0;
}

// ── สถานะที่ "ล็อกไว้" ของ (release + ขั้นตอน + เครื่อง) สำหรับกฎเลือกสถานะหน้าเครื่อง ──
//   finishedExists  = เคยกด Finished ไปแล้ว → บังคับให้เลือกได้เฉพาะ Finished (กันย้อนกลับเป็น In Process)
//   inProcessExists = เคยกด In Process ไปแล้ว → เลือก Finished ได้เมื่อ "ครบตามจำนวน" เท่านั้น
// fail-open: ออฟไลน์ / พารามิเตอร์ไม่ครบ / error → { false, false } (ไม่ล็อก ไม่บล็อกการบันทึกงาน)
// sinceIso = เวลาที่ "เพิ่มจำนวน" ล่าสุด (releases.mod_qty_at) → นับเฉพาะบันทึกหลังจากนั้น
//   (เคยกด Finished ไปแล้ว แต่ออฟฟิศเพิ่มจำนวน → ปลดล็อกให้เลือก In Process ได้อีก)
export async function getScanStatusLock(releaseId, operationId, machineId, sinceIso = null) {
  const none = { finishedExists: false, inProcessExists: false };
  if (!releaseId || !operationId || !machineId) return none;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return none;
  try {
    const q = (st) => {
      let b = supabase
        .from("machine_records")
        .select("id", { count: "exact", head: true })
        .eq("release_id", releaseId)
        .eq("operation_id", operationId)
        .eq("machine_id", machineId)
        .eq("status", st);
      if (sinceIso && st === "finished") b = b.gte("recorded_at", sinceIso);   // เฉพาะล็อก Finished (In Process ยังนับทั้งหมด)
      return b;
    };
    const [fin, inp] = await Promise.all([q("finished"), q("inprocess")]);
    if (fin.error || inp.error) { console.warn("getScanStatusLock error", fin.error || inp.error); return none; }
    return { finishedExists: (fin.count || 0) > 0, inProcessExists: (inp.count || 0) > 0 };
  } catch (e) { console.warn("getScanStatusLock exception", e); return none; }
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
  if (error) { console.warn("deleteProjectCascade error", error); flagAuth(error); throw error; }
}

// ใช้ประเมินก่อนลบ/แก้ไขโปรเจค — บอกว่าใต้โปรเจคนี้มี Part/Release/QR ที่สแกนแล้วกี่ชิ้น
export async function getProjectImpact(projectId) {
  // ★ รอบ 11: RPC เดียว รวม "งานหน้าเครื่อง" ด้วย (ไม่มี RPC = วิธีเดิม · stationRecords = null ไม่ทราบ)
  {
    const { data, error } = await supabase.rpc("project_delete_impact", { p_project_id: projectId });
    if (!error && data) {
      return {
        partCount: Number(data.part_count) || 0, releaseCount: Number(data.release_count) || 0,
        unitCount: Number(data.unit_count) || 0, scannedCount: Number(data.scanned_count) || 0,
        stationRecords: Number(data.station_records) || 0, stationPieces: Number(data.station_pieces) || 0,
      };
    }
    if (error && !isMissingFnErr(error)) {
      console.warn("project_delete_impact error", error);
      const e = new Error("impact_unknown: อ่านจำนวนข้อมูลที่จะถูกลบไม่ได้ — ลองใหม่อีกครั้ง (ยังไม่ได้ลบอะไร)");
      e.code = "impact_unknown"; throw e;
    }
  }
  // นับทุกอย่างด้วย count query (head:true) + inner join → ไม่ดึงแถว ไม่ติดเพดาน 1000
  //   เดิม: select id ของ part/release มานับ (partIds/releaseIds) → PostgREST ตัดที่ 1000 แถวเงียบ ๆ
  //         → โปรเจกต์ใหญ่ (>1000 part เช่น 840→โตขึ้น) แสดง "ผลกระทบตอนลบ" ต่ำกว่าจริง → ด่านยืนยันลบ (พิมพ์รหัส) อ่อนลง
  //   ใหม่: นับตรงจาก project_id (part_master) และผ่าน part_master!inner (releases/part_units) → เลขจริงเสมอ ไม่ว่าโปรเจกต์ใหญ่แค่ไหน
  const [pc, rc, uc, sc] = await Promise.all([
    supabase.from("part_master").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("releases").select("id, part_master!inner(project_id)", { count: "exact", head: true }).eq("part_master.project_id", projectId),
    supabase.from("part_units").select("id, part_master!inner(project_id)", { count: "exact", head: true }).eq("part_master.project_id", projectId),
    supabase.from("part_units").select("id, part_master!inner(project_id)", { count: "exact", head: true }).eq("part_master.project_id", projectId).neq("status", "released"),
  ]);
  // ★ รอบ 11 (A8): อ่านพลาด (เน็ต/5xx/timeout) ห้ามถือว่า "0" — เดิมทำให้ด่านยืนยันลบ (พิมพ์รหัส) หายไป
  //   แล้วลบประวัติสแกนทิ้งได้ด้วยคลิกเดียว → โยน error ให้หน้าจอหยุดการลบ
  const bad = [pc, rc, uc, sc].find((x) => x.error || x.count == null);
  if (bad) {
    console.warn("getProjectImpact error", bad.error);
    const e = new Error("impact_unknown: อ่านจำนวนข้อมูลที่จะถูกลบไม่ได้ — ลองใหม่อีกครั้ง (ยังไม่ได้ลบอะไร)");
    e.code = "impact_unknown";
    throw e;
  }
  return {
    partCount: pc.count || 0,
    releaseCount: rc.count || 0,
    unitCount: uc.count || 0,
    scannedCount: sc.count || 0,
    stationRecords: null,   // ไม่ทราบ (ยังไม่ได้รัน migration รอบ 11)
  };
}

// จำนวนบันทึกงานหน้าเครื่องของ Release หนึ่ง (ใช้ยืนยันก่อนลบ) — อ่านไม่ได้ = โยน error (ห้ามถือว่า 0)
export async function countReleaseStationRecords(releaseId) {
  const { count, error } = await supabase.from("machine_records")
    .select("id", { count: "exact", head: true }).eq("release_id", releaseId).gt("quantity", 0);
  if (error || count == null) { console.warn("countReleaseStationRecords error", error); throw (error || new Error("count_failed")); }
  return count;
}
export async function getReleasesFull() {
  // ★ page 1000 กัน PostgREST ตัดที่ 1000 แถวเงียบ ๆ — ที่ 10 ปี releases เกิน 1000 แล้ว
  //   (ถ้าไม่ page ตัวเลือก "ล้างข้อมูลสแกน" จะขาดโปรเจค/Release เก่าไป)
  const pageSize = 1000; let from = 0; let all = [];
  for (;;) {
    const { data, error } = await supabase
      .from("releases")
      .select("*, part_master(part_no, part_name, kind, routing, project_id, material, projects(code, name, status)), employee:employees(name, code)")
      .order("release_date", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) { console.warn("getReleasesFull error", error); break; }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
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

// ความคืบหน้าของ Release "แยกตามเครื่องจักร" (พาร์ทนี้ทำจากเครื่องไหน ขั้นตอนไหน กี่ชิ้น สถานะอะไร)
// คืน array: [ { machine_id, code, name, done, finished, caps:[{name,seq,used}] }, ... ] เรียงเครื่องที่ทำมากสุดก่อน
// ดู release_machine_progress RPC (migration-release-machine-progress.sql)
export async function getReleaseMachineProgress(releaseId) {
  if (!releaseId) return [];
  const { data, error } = await supabase.rpc("release_machine_progress", { p_release_ids: [releaseId] });
  if (error) { console.warn("release_machine_progress error", error); return []; }
  const arr = data && (data[releaseId] ?? data[String(releaseId)]);
  return Array.isArray(arr) ? arr : [];
}

// ความยาว material (หน้าเครื่อง) ที่ใช้จริง ต่อ Release — จาก machine_records.material_length_mm
// คืน { <release_id>: [ ความยาว, ... ] } (ค่าไม่ซ้ำ) · ดู release_material_lengths RPC
export async function getReleaseMaterialLengths(releaseIds) {
  if (!releaseIds || releaseIds.length === 0) return {};
  const { data, error } = await supabase.rpc("release_material_lengths", { p_release_ids: releaseIds });
  if (error) { console.warn("release_material_lengths error", error); return {}; }
  return data || {};
}

// เปลี่ยนสถานะงานหน้าเครื่องของ (Release + เครื่อง) เป็น finished / inprocess (admin/office/supervisor)
// ดู set_release_machine_status RPC · คืน { ok, updated } หรือโยน error
export async function setReleaseMachineStatus(releaseId, machineId, status) {
  const { data, error } = await supabase.rpc("set_release_machine_status", {
    p_token: authToken(), p_release_id: releaseId, p_machine_id: machineId, p_status: status,
  });
  if (error) { console.warn("set_release_machine_status error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}

// แก้ "ความยาว material" (machine_records.material_length_mm) ของทุกสแกนใน Release ให้เป็นค่าเดียว
// ใช้ในหน้า Edit Release (แอดมิน/ออฟฟิศ) — material_length_mm เป็นข้อมูลประกอบ ไม่กระทบน้ำหนัก/จำนวน/ยอด
// ดู migration-set-release-material-length.sql
export async function setReleaseMaterialLength(releaseId, length) {
  const { data, error } = await supabase.rpc("set_release_material_length", {
    p_token: authToken(), p_release_id: releaseId, p_length: Number(length),
  });
  if (error) { console.warn("set_release_material_length error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}

// ตั้ง "จำนวนของ 1 การสแกน" ใหม่ (แอดมิน) — เพิ่ม/ลด/ลบ · ใช้หน้า Scans ของเครื่อง (ปุ่ม Edit ท้ายแถว)
// newQty = 0 → ลบทั้งสแกน · newQty > เดิม → เพิ่ม · newQty < เดิม → ลด (น้ำหนักปรับตามสัดส่วน)
// ดู migration-set-scan-quantity.sql
export async function setScanQuantity(partUnitId, scannedAt, newQty) {
  const { data, error } = await supabase.rpc("set_scan_quantity", {
    p_token: authToken(), p_part_unit_id: partUnitId, p_scanned_at: scannedAt || null, p_new_qty: Number(newQty),
  });
  if (error) { console.warn("set_scan_quantity error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}

// แก้ "เวลาเดินเครื่อง (process_seconds) + สถานะ" ของ 1 การสแกน (แอดมิน) — ใช้คู่กับ setScanQuantity ในฟอร์มแก้ทั้งแถว
// ดู migration-set-scan-meta.sql
export async function setScanMeta(partUnitId, scannedAt, processSeconds, status) {
  const { data, error } = await supabase.rpc("set_scan_meta", {
    p_token: authToken(), p_part_unit_id: partUnitId, p_scanned_at: scannedAt || null,
    p_process_seconds: processSeconds == null ? null : Math.round(Number(processSeconds)),
    p_status: status || null,
  });
  if (error) { console.warn("set_scan_meta error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}

// แก้ "1 การสแกน" ครบทุกช่องรายสแกน (แอดมิน) — จำนวน/น้ำหนัก/เวลา/สถานะ/วันเวลา/ขั้นตอน · ดู migration-edit-scan.sql
// qty=0 → ลบทั้งสแกน · weight=null → คิดอัตโนมัติจากจำนวน · ช่องอื่น null = ไม่แก้
export async function editScan(partUnitId, scannedAt, opts = {}) {
  const { qty, weight, secs, status, recordedAt, opIds, matLen, slowReason, slowNote } = opts;
  const { data, error } = await supabase.rpc("edit_scan", {
    p_token: authToken(),
    p_part_unit_id: partUnitId,
    p_scanned_at: scannedAt || null,
    p_new_qty: Number(qty),
    p_weight: weight == null || weight === "" ? null : Number(weight),
    p_process_seconds: secs == null ? null : Math.round(Number(secs)),
    p_status: status || null,
    p_recorded_at: recordedAt || null,
    p_operation_ids: opIds && opIds.length ? opIds : null,
    p_material_length_mm: matLen == null || matLen === "" ? null : Number(matLen),
    p_slow_reason: slowReason == null ? null : String(slowReason),   // null = ไม่แตะ · '' = ล้าง
    p_slow_note: slowNote == null ? null : String(slowNote),
  });
  if (error) { console.warn("edit_scan error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}

// ── รายงานปัญหาหน้าเครื่อง (เครื่องหยุด + รอบที่ช้า) · ดู migration-machine-reports.sql ──
// แจ้งเครื่องหยุด → คืน { ok, id, started_at } · เก็บเวลาเริ่มหยุดหลังบ้าน (หน้าเครื่องไม่โชว์)
export async function reportMachineStop(machineId, reason, note, operationId) {
  const { data, error } = await supabase.rpc("report_machine_stop", {
    p_token: authToken(), p_machine_id: machineId, p_reason: reason || "",
    p_note: note || null, p_operation_id: operationId || null,
  });
  if (error) { console.warn("report_machine_stop error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}
// แจ้ง "พร้อมทำงาน" → ปิดการหยุด (บันทึกเวลาสิ้นสุด)
export async function machineReady(machineId) {
  const { data, error } = await supabase.rpc("machine_ready", { p_token: authToken(), p_machine_id: machineId });
  if (error) { console.warn("machine_ready error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}
// อ่านการหยุดที่ยังเปิดอยู่ (กู้สถานะตอนรีโหลด) → { open, reason, note, started_at } · พลาด = ถือว่าไม่หยุด
export async function getOpenDowntime(machineId) {
  const { data, error } = await supabase.rpc("get_open_downtime", { p_token: authToken(), p_machine_id: machineId });
  if (error) { console.warn("get_open_downtime error", error); return { ok: false, open: false }; }
  return data || { ok: true, open: false };
}
// แนบเหตุผล "รอบช้า" กับ record ที่เพิ่งสแกน
export async function setScanSlowReason(recordId, reason, note) {
  const { data, error } = await supabase.rpc("set_scan_slow_reason", {
    p_token: authToken(), p_record_id: recordId, p_reason: reason || "", p_note: note || null,
  });
  if (error) { console.warn("set_scan_slow_reason error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}
// รายการรายงานของเครื่องนี้ ตั้งแต่ since (คนงานหน้าเครื่องดูได้) → { downtime:[...], slow:[...] } · พลาด = ว่าง
export async function listMachineReports(machineId, since) {
  const { data, error } = await supabase.rpc("list_machine_reports", { p_token: authToken(), p_machine_id: machineId, p_since: since });
  if (error) { console.warn("list_machine_reports error", error); return { ok: false, downtime: [], slow: [] }; }
  return data || { ok: true, downtime: [], slow: [] };
}
// สรุปรายงานปัญหาให้แอดมิน (ตั้งแต่เวลา since) → { downtime:[...], slow:[...] }
export async function machineReportSummary(since) {
  const { data, error } = await supabase.rpc("machine_report_summary", { p_token: authToken(), p_since: since });
  if (error) { console.warn("machine_report_summary error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true, downtime: [], slow: [] };
}

// ── ลำดับคอลัมน์ในตาราง (2 ระดับ: company ค่ากลาง + user รายคน) · ดู migration-column-prefs.sql ──
export async function getColumnPrefs() {
  const { data, error } = await supabase.rpc("get_column_prefs", { p_token: authToken() });
  if (error) { console.warn("get_column_prefs error", error); return { company: {}, user: {} }; }
  return { company: (data && data.company) || {}, user: (data && data.user) || {} };
}
export async function setColumnPref(scope, tableId, colOrder) {
  const { data, error } = await supabase.rpc("set_column_pref", { p_token: authToken(), p_scope: scope, p_table_id: tableId, p_col_order: colOrder });
  if (error) { console.warn("set_column_pref error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}
export async function setColumnPrefsBulk(scope, prefs) {
  const { data, error } = await supabase.rpc("set_column_prefs_bulk", { p_token: authToken(), p_scope: scope, p_prefs: prefs || {} });
  if (error) { console.warn("set_column_prefs_bulk error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) throw new Error(data.reason || "failed");
  return data || { ok: true };
}
export async function clearColumnPref(scope, tableId) {
  const { data, error } = await supabase.rpc("clear_column_pref", { p_token: authToken(), p_scope: scope, p_table_id: tableId });
  if (error) { console.warn("clear_column_pref error", error); flagAuth(error); throw error; }
  return data || { ok: true };
}
export async function clearColumnPrefs(scope) {
  const { data, error } = await supabase.rpc("clear_column_prefs", { p_token: authToken(), p_scope: scope });
  if (error) { console.warn("clear_column_prefs error", error); flagAuth(error); throw error; }
  return data || { ok: true };
}

// ปรับ "จำนวนที่ทำเสร็จ (done)" ของเครื่องต่อ Release (แอดมิน) — เพิ่ม/ลด
// target > done → สร้างสแกน (co-tick ครบขั้นตอนของเครื่อง) ให้ชิ้นที่ยังไม่ทำ · target < done → ลบสแกนเครื่องนี้ออก
// ดู migration-set-release-machine-done.sql
export async function setReleaseMachineDone(releaseId, machineId, target) {
  const { data, error } = await supabase.rpc("set_release_machine_done", {
    p_token: authToken(), p_release_id: releaseId, p_machine_id: machineId, p_target: Number(target),
  });
  if (error) { console.warn("set_release_machine_done error", error); flagAuth(error); throw error; }
  if (data && data.ok === false) {
    const e = new Error(data.message || data.reason || "failed");   // ★ รอบ 11: lot_partial มีข้อความอธิบาย
    e.code = data.reason; e.data = data;
    throw e;
  }
  return data || { ok: true };
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
  if (error) { console.warn("record_scan error", error); flagAuth(error); return { ok: false, reason: "error", message: error.message }; }
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
// ★ แยกตาม "ขั้นตอน (operation)" ด้วย — กันเครื่องหลายขั้นตอนที่สลับงานบน release เดียวกัน
//   ตอนออฟไลน์ แล้วยอดคืบหน้าของแต่ละขั้นตอนนับข้ามกันจนเกินจริง
function queuedQtyForRelease(releaseId, operationId = null) {
  if (!releaseId) return 0;
  return qRead().reduce((s, it) => {
    if (it.release_id !== releaseId) return s;
    if (_syncedQids.has(it.qid)) return s;   // ★ รอบ 11: ส่งขึ้น server แล้ว (ยังไม่ได้ลบออกจากที่เก็บ) → นับใน DB แล้ว ไม่นับซ้ำ
    // ถ้าระบุขั้นตอน → นับเฉพาะงานค้างของขั้นตอนนั้น (machineWork ที่ p_operation_id ตรง)
    if (operationId && it.machineWork && it.machineWork.p_operation_id !== operationId) return s;
    return s + (Number(it.machineWork?.p_quantity) || 0);
  }, 0);
}
function isNetworkErr(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  // เน็ตสะดุด + server ล่มชั่วคราว (5xx / รับโหลดไม่ไหว) = retriable ทั้งหมด
  //   (logical reject ที่ "ห้าม retry" มาทาง data.ok=false ไม่ได้ throw → error ที่ throw = infra/เน็ตเสมอ)
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /abort|failed to fetch|network ?error|load failed|timed? ?out|fetch|connection|econn|socket|unavailable|temporar|overload|too many request|rate limit|bad gateway|gateway time|internal server|server error/i.test(msg);
}
// ★ V7: ตรวจว่า error = "ยังไม่มี RPC record_scan_by_qr_idem" (ยังไม่ได้รัน migration) → fallback ใช้ตัวเดิม
//   กัน deploy ผิดลำดับ (วางไฟล์ก่อนรัน SQL) แล้วสแกนออฟฟิศพัง
function isMissingFnErr(error) {
  return /PGRST202|could not find|does not exist|schema cache|record_scan_by_qr_idem/i.test((error && (error.message || error.hint || error.code)) || "");
}

// ── คิว "ซิงค์ไม่สำเร็จถาวร" — งานที่ทำออฟไลน์แล้วพอจะซิงค์ กลับเจอว่า QR/ล็อตถูกลบ
//    หรือถูกแก้ฝั่งออฟฟิศ (not_found ฯลฯ) → ไม่ทิ้งเงียบ เก็บไว้ให้แจ้ง/ลองใหม่ได้
const REJECT_Q_KEY = "mls-scan-rejected";
const rejectListeners = new Set();
function rjRead() { try { return JSON.parse(localStorage.getItem(REJECT_Q_KEY)) || []; } catch { return []; } }
// ★ รอบ 11 (B28): เขียนไม่ได้ (ที่เก็บเต็ม) → คืน false (เดิม throw แล้วงานหายจากทั้ง 2 คิว)
function rjWrite(a) {
  try { localStorage.setItem(REJECT_Q_KEY, JSON.stringify(a)); }
  catch (e) {
    console.warn("rjWrite failed (storage full?)", e);
    try { window.dispatchEvent(new CustomEvent("mls-storage-full")); } catch (_) { /* ignore */ }
    return false;
  }
  rejectListeners.forEach((f) => { try { f(a.length); } catch (_) {} });
  return true;
}
function pushRejected(item, reason) {
  const a = rjRead();
  if (item.qid && a.some((r) => r.qid === item.qid)) return true;   // มีอยู่แล้ว (กันซ้ำ)
  a.push({ ...item, reason, rejectedAt: Date.now() });
  return rjWrite(a);
}
// งานที่ส่งไม่สำเร็จ "นอกคิว" (เช่น ขั้นตอนร่วมที่บันทึกพลาดตอนออนไลน์) → เก็บเข้า "งานค้างซิงค์" ให้ออฟฟิศเห็น
export function addRejected(item, reason) {
  const it = { ...item, qid: item.qid || newClientId(), ts: item.ts || Date.now(), owner: item.owner || queueOwner() };
  const ok = pushRejected(it, reason);
  if (ok) { try { reportDeadLetter([{ ...it, reason, rejectedAt: Date.now() }]); } catch (_) { /* ignore */ } }
  return ok;
}
export function rejectedQueueCount() { return rjRead().length; }
export function onRejectedQueue(cb) { rejectListeners.add(cb); return () => rejectListeners.delete(cb); }
export function listRejected() { return rjRead(); }
// เอากลับเข้าคิวลองซิงค์ใหม่ (เช่นหลังออฟฟิศกู้ล็อตคืน)
export function retryRejected() {
  const rj = rjRead(); if (!rj.length) return;
  const q = qRead();
  // ★ ตัด attempts ออกด้วย — ไม่งั้น item ที่เคยพลาด 11 ครั้งจะชน MAX_ATTEMPTS ทันทีที่ retry (ลองใหม่ไม่ได้จริง)
  for (const it of rj) { const { reason, rejectedAt, attempts, ...orig } = it; q.push(orig); }
  // ★ กันข้อมูลหายตอนที่เก็บเต็ม: ถ้าเขียนคิวหลักไม่สำเร็จ ห้ามล้างคิว rejected ทิ้ง (เดิมล้างทันที = งานที่ทำจริงหาย)
  if (!qWrite(q)) { try { window.dispatchEvent(new CustomEvent("mls-storage-full")); } catch (_) { /* ignore */ } return; }
  rjWrite([]); flushScanQueue();
}
export function clearRejected() { rjWrite([]); }

// ── เจ้าของงานในคิว (รอบ 11 · A1) ─────────────────────────────────────────────
//   ทุกงานที่เข้าคิวติดป้าย owner (พนักงาน + เครื่อง) · ตอนซิงค์ส่งเฉพาะงานของ "คนที่ล็อกอินอยู่"
//   (เดิมส่งด้วย token ของใครก็ได้ที่ล็อกอินทีหลัง → งานของ CT-001 ไปลงชื่อ/เครื่อง CT-002 · หรือออฟฟิศเปิดหน้าแล้วโดน reject)
//   งานเก่าที่ไม่มีป้าย (ก่อนอัปเดต) = ส่งแบบเดิม
function ownedByMe(it, me) {
  if (!it || !it.owner || !it.owner.emp) return true;
  return !!me && it.owner.emp === me.id;
}
// งานค้างที่ "ไม่ใช่ของคนที่ล็อกอินอยู่" จัดกลุ่มตามเจ้าของ → หน้าเครื่องโชว์แถบ "มีงานของ … รอซิงค์"
export function queueForeignOwners() {
  const me = sessionUser();
  const m = new Map();
  for (const it of qRead()) {
    if (ownedByMe(it, me)) continue;
    const k = it.owner.emp;
    const cur = m.get(k) || { emp: k, code: it.owner.code, name: it.owner.name, machineCode: it.owner.machineCode, count: 0 };
    cur.count += 1; m.set(k, cur);
  }
  return [...m.values()];
}
export function myQueueCount() { const me = sessionUser(); return qRead().filter((it) => ownedByMe(it, me)).length; }

// ── รายงานคิว rejected ขึ้น server (dead-letter) ให้ office เห็นราย "เครื่อง" (#14) ──
// best-effort — server กันซ้ำด้วย qid · เรียกหลัง flush เมื่อมี reject ใหม่ + ตอนเปิดหน้าเครื่อง
export async function reportDeadLetter(items) {
  const list = (items || rjRead()).filter((it) => it && it.qid);
  if (!list.length) return;
  const payload = list.map((it) => {
    const mw = it.machineWork, asm = it.assembly;
    // ★ V5: งานประกอบ/แพ็ก (asm) เดิมส่ง qr=null detail=null → office ไม่รู้ว่าเบอร์ไหนพัง
    //   คงค่า kind เดิม {machine_work|qr} (กันชน CHECK constraint) · ใส่เบอร์แม่ที่ช่อง qr + รายละเอียดลง detail (jsonb)
    return {
      qid: it.qid,
      kind: mw ? "machine_work" : "qr",
      qr: mw ? null : (it.qr || asm?.p_parent_qr || null),
      detail: mw
        ? { release_id: mw.p_release_id, operation_id: mw.p_operation_id, quantity: mw.p_quantity }
        : asm
          ? { type: "assembly", parent_qr: asm.p_parent_qr, child_qrs: asm.p_child_qrs, child_count: (asm.p_child_qrs || []).length, operation_id: asm.p_operation_id }
          : null,
      reason: it.reason || null,
      client_ts: String(it.rejectedAt || it.ts || Date.now()),
    };
  });
  try {
    const { error } = await supabase.rpc("report_dead_letter", { p_token: authToken(), p_items: payload });
    if (error) console.warn("reportDeadLetter failed:", error.message || error);   // ★ supabase-js คืน error (ไม่ throw)
  } catch (e) { console.warn("reportDeadLetter failed:", e?.message || e); }
}
// อ่าน dead-letter (admin) · ทำเครื่องหมายจัดการแล้ว (admin)
export async function listDeadLetter(includeResolved = false) {
  const { data, error } = await supabase.rpc("authz_list_dead_letter", { p_token: authToken(), p_include_resolved: includeResolved });
  if (error) { console.warn("authz_list_dead_letter error", error); flagAuth(error); throw error; }
  return data || [];
}
export async function resolveDeadLetter(id) {
  const { error } = await supabase.rpc("authz_resolve_dead_letter", { p_token: authToken(), p_id: id });
  if (error) { console.warn("authz_resolve_dead_letter error", error); flagAuth(error); throw error; }
}

// ── BOM (ประกอบ/แพ็ก) — กำหนด/อ่าน รายการลูกของเบอร์แม่ ─────────────────────
// components = [{ child_pm_id, qty }] · แทนที่ทั้งชุด · ลูกต้องอยู่โปรเจคเดียวกัน (DB บังคับ)
export async function setBom(parentPmId, components) {
  const { data, error } = await supabase.rpc("authz_set_bom", { p_token: authToken(), p_parent_pm_id: parentPmId, p_components: components });
  if (error) { console.warn("authz_set_bom error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "unknown" };
}
export async function getBom(parentPmId) {
  const { data, error } = await supabase.rpc("get_bom", { p_parent_pm_id: parentPmId });
  if (error) { console.warn("get_bom error", error); return []; }
  return data || [];
}

// ── operation: สร้าง / ตั้งประเภทงาน (op_type) — ผ่าน RPC เฉพาะ (แอดมิน) เลี่ยง authz allow-list ──
export async function createOperation({ name, seq, opType }) {
  const { data, error } = await supabase.rpc("create_operation", {
    p_token: authToken(), p_name: name, p_seq: seq ?? null, p_op_type: opType || "machining",
  });
  if (error) { console.warn("create_operation error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
}
export async function setOperationType(operationId, opType) {
  const { data, error } = await supabase.rpc("set_operation_type", {
    p_token: authToken(), p_operation_id: operationId, p_op_type: opType,
  });
  if (error) { console.warn("set_operation_type error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
}

// เก็บ "บันทึกประกอบ/แพ็ก" เข้าคิว offline (localStorage เดียวกับงานตัด) → ซิงค์เองเมื่อเน็ตกลับ
// qid = client_id (uuid) → กันซ้ำทั้งฝั่ง flush และฝั่ง DB (record_assembly idempotent ด้วย p_client_id)
function queueAssembly(p) {
  const a = qRead();
  a.push({ assembly: {
    p_parent_qr: p.parentQr, p_child_qrs: p.childQrs,
    p_operation_id: p.operationId ?? null, p_client_id: p.clientId, p_recorded_at: p.recordedAt ?? null,
    p_parent_qty: p.parentQty ?? 1,   // จำนวนที่จะทำ (ซับ) → machine_record.quantity ฝั่ง server
  }, qid: p.clientId, ts: Date.now(), owner: queueOwner() });
  if (!qWrite(a)) return { ok: false, reason: "storage_full", message: "ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ" };
  return { ok: true, queued: true };
}

// บันทึกการประกอบจากหน้าเครื่อง — คืนผลตรวจครบตาม BOM · เน็ตหลุด/สะดุด = เก็บเข้าคิวซิงค์ทีหลัง
export async function recordAssembly({ parentQr, childQrs, operationId, clientId, recordedAt, parentQty }, { allowQueue = true } = {}) {
  // childQrs รับได้ทั้ง ["qr",...] (เดิม) และ [{qr,qty},...] (ใหม่ — นับจำนวนรวม) · parentQty = จำนวนที่จะทำของเบอร์แม่
  const p = { parentQr, childQrs, operationId, clientId: clientId ?? newClientId(), recordedAt: recordedAt ?? new Date().toISOString(), parentQty: Math.max(1, Math.floor(Number(parentQty) || 1)) };
  if (allowQueue && typeof navigator !== "undefined" && navigator.onLine === false) return queueAssembly(p);
  const { data, error } = await supabase.rpc("record_assembly", {
    p_token: authToken(), p_parent_qr: p.parentQr, p_child_qrs: p.childQrs,
    p_operation_id: p.operationId, p_client_id: p.clientId, p_recorded_at: p.recordedAt, p_parent_qty: p.parentQty,
  });
  if (error) {
    if (allowQueue && isNetworkErr(error)) return queueAssembly(p);   // เน็ตสะดุด → เข้าคิว (ไม่ทิ้งงาน)
    console.warn("record_assembly error", error); flagAuth(error); throw error;
  }
  return data || { ok: false, reason: "error" };
}

// บันทึกงานประกอบ "ซับ" แบบนับจำนวนรวม (สแกนแม่ + จำนวนที่ทำ · ลูกเช็ก BOM ที่สเตชัน) — ปิดงานเบอร์แม่
export async function recordSubassembly({ parentQr, qty, operationId, clientId, recordedAt }) {
  const { data, error } = await supabase.rpc("record_subassembly", {
    p_token: authToken(), p_parent_qr: parentQr, p_qty: qty,
    p_operation_id: operationId ?? null, p_client_id: clientId ?? newClientId(),
    p_recorded_at: recordedAt ?? new Date().toISOString(),
  });
  if (error) { console.warn("record_subassembly error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
}

// เอาลูกที่ติดตั้งแล้วออกจากเบอร์แม่ (ไว้ "แก้" งานที่เสร็จแล้ว) — ต้องออนไลน์ (ลบทันที ไม่เข้าคิว)
export async function removeAssemblyChild(parentUnitId, childUnitId) {
  const { data, error } = await supabase.rpc("remove_assembly_child", {
    p_token: authToken(), p_parent_unit_id: parentUnitId, p_child_unit_id: childUnitId,
  });
  if (error) { console.warn("remove_assembly_child error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
}

// โหลดสถานะประกอบ "สะสม" ของเบอร์แม่ (BOM + ที่ติดตั้งไปแล้วข้ามสเตชัน) — ใช้ตอนสแกนเบอร์แม่
// รองรับ offline: ออนไลน์ = โหลดจาก DB + แคชไว้ · ออฟไลน์/เน็ตสะดุด = อ่านจากแคช (เปิดเบอร์ที่เคยโหลดได้)
export async function getAssemblyState(parentQr) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    const c = await getCachedAsmState(parentQr);
    return c ? { ...c, offline: true } : { ok: false, reason: "offline_no_cache" };
  }
  const { data, error } = await supabase.rpc("get_assembly_state", { p_parent_qr: parentQr });
  if (error) {
    flagAuth(error);
    if (isNetworkErr(error)) {                                   // เน็ตสะดุด → ลองแคช
      const c = await getCachedAsmState(parentQr);
      if (c) return { ...c, offline: true };
    }
    console.warn("get_assembly_state error", error); throw error;
  }
  const st = data || { ok: false, reason: "error" };
  if (st && st.ok) { try { await setCachedAsmState(parentQr, st); } catch { /* ignore */ } }   // แคชไว้ใช้ offline
  return st;
}

// prefetch สถานะเบอร์แม่ที่กำลังทำ (assembly+packing) ลงแคช — เรียกตอนเข้าหน้า/เน็ตกลับ
// best-effort + bounded (กันยิง RPC เยอะ) → เปิดเบอร์ที่ยังไม่เคยสแกนตอน offline ได้
let _prefetchingAsm = false;
export async function prefetchAssemblyForOffline(limit = 120) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  if (_prefetchingAsm) return 0;                   // ★ กันรันซ้อน (mount + online event + เน็ตกระพริบ) = ยิง RPC ซ้ำเป็นชุด
  _prefetchingAsm = true;
  try {
    let parents = [];
    try {
      const [asm, panel, pack] = await Promise.all([listAssemblyParents("assembly"), listAssemblyParents("panel"), listAssemblyParents("packing")]);
      const seen = new Set();
      [...asm, ...panel, ...pack].forEach((p) => { if (p && p.qr_code && !seen.has(p.qr_code)) { seen.add(p.qr_code); parents.push(p.qr_code); } });
    } catch { return 0; }
    parents = parents.slice(0, limit);
    // ★ ขนานแบบจำกัด concurrency (เดิม sequential ทีละตัว = ช้ามาก ~120 round-trip/เครื่อง + burst ตอนหลายเครื่อง reconnect พร้อมกัน)
    let n = 0, idx = 0;
    const CONC = 4;
    const worker = async () => {
      while (idx < parents.length) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;   // เน็ตหลุดกลางคัน → หยุด
        const qr = parents[idx++];
        try {
          const { data, error } = await supabase.rpc("get_assembly_state", { p_parent_qr: qr });
          if (!error && data && data.ok) { await setCachedAsmState(qr, data); n++; }
        } catch { /* ข้ามตัวที่พลาด */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, parents.length) }, worker));
    return n;
  } finally { _prefetchingAsm = false; }
}

// ข้อมูลชิ้นส่วน (ความยาว + kind) ของลูกใน BOM — ใช้เติมให้หน้าประกอบวาดผัง + ป้ายจุดติดตั้ง
// อ่านตรง (anon SELECT part_master อนุญาต) ไม่ต้องแก้ RPC/ฐานข้อมูล
export async function getPartMeta(ids) {
  const list = Array.from(new Set((ids || []).filter(Boolean)));
  if (!list.length) return {};
  const { data, error } = await supabase
    .from("part_master")
    .select("id, part_no, part_name, default_length_mm, kind")
    .in("id", list);
  if (error) { console.warn("getPartMeta error", error); return {}; }
  const m = {};
  (data || []).forEach((r) => { m[r.id] = r; });
  return m;
}

// รายละเอียดยูนิต (QR + เบอร์ชิ้น) จาก part_unit id หลายตัว — ใช้หน้า "ตรวจงานประกอบ" หลังบ้าน
// โชว์ว่าที่สแกนเข้าเบอร์แม่คือ QR/ชิ้นไหนบ้าง · อ่านตรง (anon SELECT part_units อนุญาต)
export async function getUnitsByIds(ids) {
  const list = Array.from(new Set((ids || []).filter(Boolean)));
  if (!list.length) return {};
  const { data, error } = await supabase
    .from("part_units")
    .select("id, qr_code, part_master(part_no, part_name)")
    .in("id", list);
  if (error) { console.warn("getUnitsByIds error", error); return {}; }
  const m = {};
  (data || []).forEach((u) => { m[u.id] = { qr_code: u.qr_code, part_no: u.part_master?.part_no || "", part_name: u.part_master?.part_name || "" }; });
  return m;
}

// รายการ "เบอร์แม่" ที่ยังประกอบไม่เสร็จ (ให้เลือกในหน้าประกอบ/แพ็ก แทนการสแกนอย่างเดียว)
// assembly = แผง + ซับ · packing = บั้ง(package) · ตัดโปรเจคที่ปิด · อ่านตรง (anon SELECT)
export async function listAssemblyParents(dept) {
  // แยกชนิดตามสเตชัน: แพ็ก/แพ็กแผง/แพ็กไซต์→package · แผง→panel · ประกอบ(ซับ)→subassembly · อื่น ๆ→ทั้ง panel+sub
  const packDepts = ["packing", "packpanel", "packsite"];
  const kinds = packDepts.includes(dept) ? ["package"]
    : dept === "panel" ? ["panel"]
    : dept === "assembly" ? ["subassembly"]
    : ["panel", "subassembly"];
  const wantPack = dept === "packpanel" ? "panel" : dept === "packsite" ? "site" : null;   // แพ็กแผง/ไซต์ = เฉพาะบั้งที่ติดป้ายตรงกัน (legacy packing = ทุกบั้ง)
  const { data, error } = await supabase
    .from("part_units")
    .select("id, qr_code, status, part_master!inner(part_no, part_name, kind, pkg_meta, projects(code, name, status))")
    .in("part_master.kind", kinds)
    .neq("status", "finished")
    .limit(600);
  if (error) { console.warn("listAssemblyParents error", error); return []; }
  const rows = (data || []).map((u) => ({
    id: u.id,
    qr_code: u.qr_code,
    status: u.status,
    part_no: u.part_master?.part_no || u.qr_code,
    part_name: u.part_master?.part_name || "",
    kind: u.part_master?.kind || "part",
    pack_type: u.part_master?.pkg_meta?.pack_type || null,
    project_code: u.part_master?.projects?.code || "",
    project_status: u.part_master?.projects?.status || "",
  })).filter((r) => r.project_status !== "closed")
    .filter((r) => !wantPack || r.pack_type === wantPack);
  // กำลังทำ (in_progress) ขึ้นก่อน แล้วเรียงตามเบอร์
  const doing = (s) => /progress/i.test(s || "");
  rows.sort((a, b) => (doing(b.status) - doing(a.status)) || String(a.part_no).localeCompare(String(b.part_no)));
  return rows;
}

// บันทึก "ฟอร์มบั้ง (packing manifest)" ลง part_master ของ package (office ขึ้นไป)
// ผ่าน RPC เฉพาะ authz_set_manifest (เลี่ยง allow-list ของ authz_update ที่ไม่รู้จักคอลัมน์ใหม่)
export async function setPkgManifest(pmId, manifest, meta) {
  const { data, error } = await supabase.rpc("authz_set_manifest", {
    p_token: authToken(), p_pm_id: pmId, p_manifest: manifest ?? null, p_meta: meta ?? null,
  });
  if (error) { console.warn("authz_set_manifest error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
}

// ── รูปตอนแพ็ก (packing photos) — อัปขึ้น Storage แล้วผูก path กับเบอร์แพ็ก ──────
// อัปโหลด 1 รูป (blob) → คืน path ในบัคเก็ต 'packing-photos'
export async function uploadPackingPhoto(blob, keyHint = "pack") {
  const path = `${keyHint}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { data, error } = await supabase.storage.from("packing-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) { console.warn("uploadPackingPhoto error", error); throw error; }
  return data?.path || path;
}
export function packingPhotoUrl(path) {
  try { return supabase.storage.from("packing-photos").getPublicUrl(path).data.publicUrl; }
  catch { return null; }
}
// ผูก path รูปกับเบอร์แพ็ก (เรียกหลังอัปโหลดรูปสำเร็จ)
export async function recordPackingPhotos(parentQr, paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return { ok: true, saved: 0 };
  const { data, error } = await supabase.rpc("record_packing_photos", { p_token: authToken(), p_parent_qr: parentQr, p_paths: list });
  if (error) { console.warn("record_packing_photos error", error); flagAuth(error); throw error; }
  return data || { ok: false };
}

// สแกนด้วย QR (โหมดหน้าเครื่อง) — จบใน 1 round trip; ถ้าเน็ตหลุด เก็บเข้าคิวไว้ซิงค์ทีหลัง
export async function recordScanByQr(qr, { allowQueue = true } = {}) {
  const clientId = newClientId();   // ★ V7: 1 client_id ต่อการสแกน → ใช้ทั้งตอนยิงตรง + ตอนเข้าคิว (idem กันบันทึกซ้ำ)
  let { data, error } = await supabase.rpc("record_scan_by_qr_idem", { p_token: authToken(), p_qr: qr, p_client_id: clientId });
  if (error && isMissingFnErr(error)) {   // ยังไม่ได้รัน migration idem → ใช้ตัวเดิม (สแกนได้ แต่ยังไม่กันซ้ำ)
    ({ data, error } = await supabase.rpc("record_scan_by_qr", { p_token: authToken(), p_qr: qr }));
  }
  if (error) {
    if (allowQueue && isNetworkErr(error)) {
      const a = qRead(); a.push({ qr, qid: clientId, ts: Date.now(), owner: queueOwner() });   // ★ qid = clientId เดิม → flush ส่ง client_id เดิม → idem กันซ้ำข้าม direct↔queue
      if (!qWrite(a)) return { ok: false, reason: "storage_full", message: "ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ" };
      return { ok: true, queued: true };
    }
    console.warn("record_scan_by_qr error", error);
    flagAuth(error);   // token หมดอายุ → เด้ง login (network-err ไปเข้าคิวข้างบนแล้ว)
    return { ok: false, reason: "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}

// พยายามส่งคิวที่ค้างขึ้น server (เรียกตอนเน็ตกลับ/เป็นระยะ)
// ⚠️ ปลอดภัยต่อการเรียกซ้อน: มี guard กันรันพร้อมกัน + เอาออกจากคิวตาม "qid" (ไม่ทับของ
//    ที่ถูก enqueue ระหว่างซิงค์) — กันงานออฟไลน์หายจากการเขียนทับคิว
// ★ รอบ 11:
//   • A1  ส่งเฉพาะงานของคนที่ล็อกอินอยู่ (owner) ด้วย token ของคนนั้น · ไม่มี token = ไม่ยิงเลย
//   • B18 เอาออกจากคิว "ทีละรายการ" ที่ส่งสำเร็จ (รวมเขียนทุก 10 รายการ + ระหว่างนั้นไม่นับซ้ำด้วย _syncedQids)
//         เดิมเก็บไว้จนจบรอบ → ระหว่างซิงค์ 200 รายการ เลขวิ่ง/ปลดล็อก Finished นับซ้ำ · ปิดแท็บกลางทาง = ส่งซ้ำทั้งหมด
//   • B28 ย้ายไป rejected "ก่อน" แล้วค่อยลบจากคิวหลัก (ที่เก็บเต็ม = คงไว้ในคิวหลัก ไม่หาย)
//   • หยุดรอบทันทีเมื่อ token หมดอายุ / เน็ตหลุด / server สะดุดติดกัน 2 รายการ (เดิมยิงครบทุกรายการทุก 15 วิ)
let _flushing = false;
const _syncedQids = new Set();   // qid ที่ server รับแล้ว แต่ยังไม่ได้ลบออกจากที่เก็บ (ไม่นับซ้ำในยอดค้าง)
export async function flushScanQueue() {
  if (_flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const tok = authToken();
  if (!tok) return;                                // ยังไม่ล็อกอิน / ออกจากระบบแล้ว → ไม่ยิง (งานคงอยู่ในคิว)
  const me = sessionUser();
  let a = qRead();
  if (a.length === 0) return;
  let migrated = false;
  a = a.map((it) => (it.qid ? it : (migrated = true, { ...it, qid: newClientId() })));
  if (migrated) qWrite(a);
  const mine = a.filter((it) => ownedByMe(it, me));
  if (mine.length === 0) return;                   // มีแต่งานของคนอื่น → รอเจ้าของล็อกอิน

  _flushing = true;
  const done = new Set();          // qid ที่จัดการเสร็จ (สำเร็จ / ย้ายไป rejected แล้ว) → เอาออกจากคิว
  const bumped = new Map();        // qid -> จำนวนครั้งที่ลองแล้วพลาด (error ที่ไม่ใช่เน็ต)
  let newRejects = 0;
  let authExpired = false;
  let netFails = 0;                // server/เน็ตสะดุด "ติดกัน" กี่รายการ (2 = หยุดรอบนี้)
  const MAX_ATTEMPTS = 12;         // ~3 นาที (flush ทุก 15 วิ) ก่อนยอมแพ้ → ย้ายไป rejected (H3)
  const commit = () => {           // เขียนคิวใหม่: ลบที่เสร็จ + อัปเดตจำนวนครั้งที่พลาด (อ่านคิวล่าสุดก่อนเสมอ)
    if (!done.size && !bumped.size) return;
    const cur = qRead();
    const ok = qWrite(cur.filter((it) => !done.has(it.qid))
                        .map((it) => (bumped.has(it.qid) ? { ...it, attempts: bumped.get(it.qid) } : it)));
    if (ok) { for (const q of done) _syncedQids.delete(q); done.clear(); bumped.clear(); }
  };
  const toRejected = (item, reason) => {
    if (pushRejected(item, reason)) { done.add(item.qid); newRejects++; return true; }
    return false;                                  // เก็บ rejected ไม่ได้ (ที่เก็บเต็ม) → คงไว้ในคิวหลัก
  };
  try {
    for (const item of mine) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      let data, error;
      try {
        if (item.assembly) {
          ({ data, error } = await supabase.rpc("record_assembly", { ...item.assembly, p_token: tok }));
        } else if (item.machineWork) {
          ({ data, error } = await supabase.rpc("record_machine_work", { ...item.machineWork, p_token: tok }));
        } else {
          // ★ V7: ผ่านตัวห่อ idem (p_client_id = qid เดิมของ item) → commit-แล้ว-response-หาย ลองซ้ำไม่บันทึกซ้ำ
          ({ data, error } = await supabase.rpc("record_scan_by_qr_idem", { p_token: tok, p_qr: item.qr, p_client_id: item.qid }));
          if (error && isMissingFnErr(error)) ({ data, error } = await supabase.rpc("record_scan_by_qr", { p_token: tok, p_qr: item.qr }));
        }
      } catch (e) { error = e; }
      if (error) {
        if (isAuthError(error)) { authExpired = true; break; }          // token หมดอายุ → หยุด รอล็อกอินใหม่ (งานคงอยู่)
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        if (isNetworkErr(error)) { if (++netFails >= 2) break; continue; }   // เน็ต/server สะดุด → retry รอบหน้า (ไม่นับเพดาน)
        netFails = 0;
        const at = (Number(item.attempts) || 0) + 1;
        if (at >= MAX_ATTEMPTS) toRejected(item, "retry_exhausted");
        else bumped.set(item.qid, at);
        continue;
      }
      netFails = 0;
      if (data && data.ok === false) {
        if (data.reason === "unauthorized") { authExpired = true; break; }
        toRejected(item, data.reason);             // ลบ/แก้ฝั่งออฟฟิศ → rejected (ทั้ง machine/office)
      } else {
        done.add(item.qid); _syncedQids.add(item.qid);   // ok / deduped = สำเร็จ
      }
      if (done.size >= 10) { try { commit(); } catch (e) { console.warn("flush commit failed", e); } }
    }
  } finally {
    _flushing = false;                             // ★ ปลดล็อกก่อนเสมอ — กันค้างถาวรถ้าเขียน localStorage พลาด (B4)
    try { commit(); } catch (e) { console.warn("flush finalize failed", e); }
    if (newRejects) { try { reportDeadLetter(); } catch (_) { /* ignore */ } }
    if (authExpired && typeof window !== "undefined") {
      try { window.dispatchEvent(new Event("mls-session-expired")); } catch (_) { /* ignore */ }
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { flushScanQueue(); });
  setInterval(() => { if (qRead().length) flushScanQueue(); }, 15000);
}

// ── "งานที่กำลังทำ" หน้าเครื่อง (สแกนรอบแรกแล้ว ยังไม่กด OK) → ออฟฟิศเห็นสถานะ In Process ──
//   หน้าเครื่องบอก "สถานะที่ต้องการ" (มีงาน / ไม่มีงาน) → เก็บลงเครื่องก่อน แล้วค่อยส่ง (ทีละคำสั่ง ตามลำดับ)
//   ออฟไลน์ = เก็บไว้ ส่งตอนเน็ตกลับ (ส่งเฉพาะ "สถานะล่าสุด" — ไม่ต้องส่งย้อนทุกครั้ง)
//   ส่งไม่ได้ ไม่กระทบงานหน้าเครื่องเลย (best-effort) · ยังไม่ได้รัน SQL = เงียบ ไม่ลองซ้ำ
//   job = null (ไม่มีงาน) | { releaseId, partUnitId, operationIds:[...], startedAt (ms/ISO) }
//   ดู station_job_set (migration-part-machine-status.sql)
const AJ_KEY = "mls-active-job";
let _ajMem = null;             // สำรองเมื่อ localStorage ใช้ไม่ได้
let _ajBusy = false, _ajAgain = false, _ajTimer = null, _ajMissing = false;
function ajRead() {
  try { const raw = localStorage.getItem(AJ_KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
  return _ajMem;
}
function ajWrite(v) { _ajMem = v; try { localStorage.setItem(AJ_KEY, JSON.stringify(v)); } catch { /* ignore */ } }
function ajKey(job) {
  if (!job || !job.releaseId) return "";
  const t = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  // ไม่รวมป้าย (partUnitId) — รอบ 2 / กู้งานหลังรีโหลด ป้ายอาจเปลี่ยน แต่ยังเป็นงานเดิม (release + ขั้นตอน + เวลาเริ่ม)
  return [job.releaseId, (job.operationIds || []).filter(Boolean).join(","), t].join("|");
}
export function reportActiveJob(job) {
  const key = ajKey(job);
  const cur = ajRead();
  if (cur && cur.key === key) { if (!cur.sent) scheduleActiveJobFlush(); return; }
  // sentKey = สถานะล่าสุดที่เซิร์ฟเวอร์รู้แล้ว → เปลี่ยนไปแล้วเปลี่ยนกลับ (เช่นรีโหลด: ล้าง → กู้งานเดิม) ไม่ต้องส่งซ้ำ
  const sentKey = cur ? (cur.sent ? cur.key : cur.sentKey) : undefined;
  const same = sentKey !== undefined && sentKey === key;
  ajWrite({ key, job: key ? {
    releaseId: job.releaseId, partUnitId: job.partUnitId || null,
    operationIds: (job.operationIds || []).filter(Boolean),
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
  } : null, sent: same, sentKey, ts: Date.now() });
  if (!same) scheduleActiveJobFlush();
}
// หน่วงสั้นๆ รวมการเปลี่ยนที่เกิดติดกัน (เช่นตอนเปิดหน้า: ล้าง → กู้งานค้าง) ให้เหลือคำสั่งเดียว
function scheduleActiveJobFlush(delay = 400) {
  clearTimeout(_ajTimer);
  _ajTimer = setTimeout(() => { flushActiveJob(); }, delay);
}
export async function flushActiveJob() {
  if (_ajMissing) return;
  if (_ajBusy) { _ajAgain = true; return; }
  const cur = ajRead();
  if (!cur || cur.sent) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const tok = authToken();
  if (!tok) return;
  _ajBusy = true;
  try {
    const j = cur.job;
    const { data, error } = await supabase.rpc("station_job_set", j ? {
      p_token: tok, p_release_id: j.releaseId, p_part_unit_id: j.partUnitId || null,
      p_operation_ids: j.operationIds && j.operationIds.length ? j.operationIds : null,
      p_started_at: j.startedAt || null,
    } : { p_token: tok, p_release_id: null });
    let done = true;
    if (error) {
      if (isMissingFnErr(error)) { _ajMissing = true; console.info("station_job_set ยังไม่มีใน DB (รัน migration-part-machine-status.sql) — ข้ามการแจ้งงานที่กำลังทำ"); }
      else if (isNetworkErr(error) || isAuthError(error)) done = false;   // เน็ต/ token → ลองใหม่ภายหลัง
      else console.warn("station_job_set error", error);
    } else if (data && data.ok === false && data.reason !== "unauthorized") {
      console.warn("station_job_set rejected", data.reason);
    } else if (data && data.ok === false) done = false;                     // token หมด → รอล็อกอินใหม่
    if (done) {
      const now = ajRead();
      if (now && now.key === cur.key) ajWrite({ ...now, sent: true, sentKey: cur.key });
      else { if (now) ajWrite({ ...now, sentKey: cur.key }); _ajAgain = true; }   // ระหว่างส่งมีการเปลี่ยน → ส่งรอบใหม่ (ด้านล่าง)
    }
  } catch (e) {
    console.warn("station_job_set exception", e);
  } finally {
    _ajBusy = false;
    if (_ajAgain) { _ajAgain = false; scheduleActiveJobFlush(50); }
  }
}
// ออกจากระบบ: ล้างงานที่กำลังทำก่อน token หมด (รอไม่เกิน ~2.5 วิ · พลาด = ช่างอื่นสแกน/หมดอายุ 12 ชม. เอง)
export async function clearActiveJobNow(timeoutMs = 2500) {
  const cur = ajRead();
  if (!cur || (!cur.job && cur.sent)) return;   // ไม่เคยแจ้งงาน / ล้างไปแล้ว → ไม่ต้องยิง
  reportActiveJob(null);
  clearTimeout(_ajTimer);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + timeoutMs;
  try {
    while (Date.now() < until) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (_ajMissing) return;
      const c = ajRead();
      if (!c || c.sent) return;
      await Promise.race([flushActiveJob(), sleep(Math.max(0, until - Date.now()))]);
      const c2 = ajRead();
      if (!c2 || c2.sent) return;
      await sleep(150);   // กำลังส่งคำสั่งก่อนหน้าอยู่ / เน็ตสะดุด → รอแล้วลองอีก (ภายในเวลาที่กำหนด)
    }
  } catch { /* ignore */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { scheduleActiveJobFlush(1500); });
  setInterval(() => { const c = ajRead(); if (c && !c.sent && !_ajMissing) flushActiveJob(); }, 20000);
}

// ── บันทึก Material (INV Code) — แยกตามโปรเจค + Center Stock · ดู migration-materials.sql ──
//   ยังไม่ได้รัน SQL → { ok:false, reason:"not_installed" } (หน้าเว็บแจ้ง/ข้ามเงียบ ไม่พัง)
function matRes(data, error, fn) {
  if (error) {
    if (isMissingFnErr(error)) return { ok: false, reason: "not_installed" };
    console.warn(fn + " error", error);
    flagAuth(error);
    return { ok: false, reason: isNetworkErr(error) ? "network" : "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
// รายการของโปรเจค (+ Center Stock เสมอ) → { ok, project:[...], center:[...], counts:{...} }
export async function getMaterials(projectId = null) {
  const { data, error } = await supabase.rpc("materials_list", { p_project_id: projectId || null });
  if (error) return matRes(null, error, "materials_list");
  return { ok: true, project: data?.project || [], center: data?.center || [], counts: data?.counts || {} };
}
const matTxt = (v) => (v == null ? null : String(v).trim() === "" ? null : String(v).trim());
// เพิ่ม (id=null · projectId=null = Center Stock) / แก้ (id) 1 รายการ → { ok, row } | { ok:false, reason }
export async function saveMaterial({ id = null, projectId = null, inv, wpm, len, qty, note }) {
  const { data, error } = await supabase.rpc("material_save", {
    p_token: authToken(), p_id: id || null, p_project_id: projectId || null, p_inv: String(inv || "").trim(),
    p_wpm: matTxt(wpm), p_len: matTxt(len), p_qty: matTxt(qty), p_note: matTxt(note),
  });
  return matRes(data, error, "material_save");
}
// เพิ่มหลายรายการ (วางจาก Excel) · onDup: "skip" | "update" → { ok, added, updated, skipped:[{inv, reason}] }
export async function upsertMaterials(projectId, items, onDup = "skip") {
  const { data, error } = await supabase.rpc("materials_upsert_many", {
    p_token: authToken(), p_project_id: projectId || null, p_on_dup: onDup,
    p_items: (items || []).map((it) => ({ inv: String(it.inv || "").trim(), wpm: matTxt(it.wpm), len: matTxt(it.len), qty: matTxt(it.qty), note: matTxt(it.note) })),
  });
  return matRes(data, error, "materials_upsert_many");
}
export async function deleteMaterial(id) {
  const { data, error } = await supabase.rpc("material_delete", { p_token: authToken(), p_id: id });
  return matRes(data, error, "material_delete");
}
// หลังสร้าง Release: INV ที่ยังไม่มี (ทั้งโปรเจค + Center Stock) → เพิ่มเข้าโปรเจค · items: [{inv, wpm}] → { ok, added:[], filled:[] }
export async function addMaterialsFromRelease(projectId, releaseOrder, items) {
  const list = (items || []).filter((it) => String(it.inv || "").trim()).map((it) => ({ inv: String(it.inv).trim(), wpm: matTxt(it.wpm) }));
  if (!projectId || list.length === 0) return { ok: true, added: [], filled: [] };
  const { data, error } = await supabase.rpc("materials_add_from_release", {
    p_token: authToken(), p_project_id: projectId, p_release_order: releaseOrder || null, p_items: list,
  });
  return matRes(data, error, "materials_add_from_release");
}
// ดึง INV จาก Release เดิมของโปรเจค · dryRun=true นับอย่างเดียว → { ok, count, items:[{inv, wpm, parts}], added }
export async function backfillMaterials(projectId, dryRun = true) {
  const { data, error } = await supabase.rpc("materials_backfill", { p_token: authToken(), p_project_id: projectId, p_dry_run: !!dryRun });
  return matRes(data, error, "materials_backfill");
}

// สถานะเครื่องจักรต่อ Release (หน้า Release → ตาราง Part: ชิปเครื่อง + ตารางเครื่องใต้แถว)
//   คืน { ok:true, data:{ <release_id>: [ {machine_id, code, name, done, finished, run_seconds, first_at,
//         last_at, batches, ops:[{name,seq,done}], employees:[...], last_employee, active:{...}|null} ] } }
//   ยังไม่ได้รัน migration-part-machine-status.sql → { ok:false, reason:"not_installed" }
export async function getReleaseMachineStatus(releaseIds) {
  const ids = [...new Set((releaseIds || []).filter(Boolean))];
  if (ids.length === 0) return { ok: true, data: {} };
  const out = {};
  for (let i = 0; i < ids.length; i += 200) {   // แบ่งชุด กัน URL/payload ใหญ่เกิน
    const { data, error } = await supabase.rpc("release_machine_status", { p_release_ids: ids.slice(i, i + 200) });
    if (error) {
      if (isMissingFnErr(error)) return { ok: false, reason: "not_installed" };
      console.warn("release_machine_status error", error);
      return { ok: false, reason: "error", message: error.message };
    }
    Object.assign(out, data || {});
  }
  return { ok: true, data: out };
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

// id ของทุก Release ใน (โปรเจค + เลข Release Order) — ใช้ตั้ง MDF ทั้งใบ / แก้หัวเอกสารทั้งใบ (ทุกแผนก)
export async function listReleaseIdsOfOrder(projectId, releaseOrder) {
  const ro = String(releaseOrder || "").trim();
  if (!projectId || !ro) return [];
  const { data, error } = await supabase
    .from("releases")
    .select("id, part_master!inner(project_id)")
    .eq("part_master.project_id", projectId)
    .eq("release_order", ro)
    .order("id", { ascending: true })
    .range(0, 4999);
  if (error) { console.warn("listReleaseIdsOfOrder error", error); throw error; }
  return (data || []).map((r) => r.id);
}

// เช็คว่ามี Release ที่ (โปรเจค + เลขที่ Release Order) นี้อยู่แล้วไหม — กันสร้าง/นำเข้าซ้ำตอน retry หลังเน็ตวูบ
// (create_release_batch ไม่ idempotent) · เลข Order ว่าง = ระบุไม่ได้ ข้ามการเช็ค (fail-open) · เช็คไม่ได้ = ไม่บล็อก
export async function releaseOrderExists(projectId, releaseOrder) {
  const ro = String(releaseOrder || "").trim();
  if (!projectId || !ro) return false;
  const { data, error } = await supabase
    .from("releases")
    .select("id, part_master!inner(project_id)")
    .eq("part_master.project_id", projectId)
    .eq("release_order", ro)
    .limit(1);
  if (error) { console.warn("releaseOrderExists error", error); return false; }
  return (data || []).length > 0;
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
    flagAuth(error);
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
    const rows = await listRows(t, { strict: true });   // ★ backup ต้องครบ — error กลางคันให้ล้ม ไม่ใช่คืนบางส่วนเงียบ (ป้องกัน backup ขาด)
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
// ★ รอบ 11 (B3): โหลดพลาด = โยน error (เดิมคืน [] → หน้ารายงาน/TV โชว์ "ไม่มีงาน" + Export รายงานศูนย์ได้)
function reportErr(name, error) {
  console.warn(name + " error", error);
  const e = new Error(isNetworkErr(error) ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ / หมดเวลา" : (error?.message || "โหลดข้อมูลไม่สำเร็จ"));
  e.cause = error;
  return e;
}
export async function getScanLogsBetween(fromIso, toIso) {
  const { data, error } = await supabase.rpc("report_logs", { p_from: fromIso, p_to: toIso });
  if (error) throw reportErr("report_logs", error);
  return data || [];
}

// เหตุผล "รอบช้า" (รายงานการทำงาน) ต่อการสแกน ในช่วงเวลา — ออฟฟิศเอาไปจับคู่กับแถวสแกน (part_unit + เวลา)
export async function listScanSlow(fromIso, toIso) {
  const { data, error } = await supabase.rpc("list_scan_slow", { p_from: fromIso, p_to: toIso });
  if (error) {
    if (isMissingFnErr(error)) return [];          // ยังไม่ได้ติดตั้งรายงานเครื่อง → ไม่มีเหตุผลช้า (ไม่ใช่ error)
    throw reportErr("list_scan_slow", error);
  }
  return data || [];
}

// รายงานประกอบ/แพ็ก — ลูกที่ประกอบเข้าเบอร์แม่ทั้งช่วง (เบอร์แม่/ลูก + ความยาว + น้ำหนัก + ชนิด)
export async function getAssemblyLogsBetween(fromIso, toIso) {
  const { data, error } = await supabase.rpc("report_assembly", { p_from: fromIso, p_to: toIso });
  if (error) {
    if (isMissingFnErr(error)) return [];
    throw reportErr("report_assembly", error);
  }
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
  if (data && data.ok !== false) setDaySnapshot({ ...data, _day: bkkDay() });    // เก็บ snapshot ล่าสุดไว้ใช้ออฟไลน์ (+ วันที่ไทยของ snapshot)
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
  // เติม op_type + is_assembly + seq (RPC machine_ops เดิมอาจยังไม่คืนคอลัมน์เหล่านี้) — อ่านตรงจากตาราง operations
  try {
    const ids = list.map((o) => o.id).filter(Boolean);
    const needType = !(list[0] && "op_type" in list[0]);
    const needSeq = !(list[0] && "seq" in list[0]);
    if (ids.length && (needType || needSeq)) {
      const { data: ops } = await supabase.from("operations").select("id, seq, is_assembly, op_type").in("id", ids);
      const m = new Map((ops || []).map((o) => [o.id, o]));
      for (const o of list) {
        const e = m.get(o.id);
        if (needSeq && e && e.seq != null) o.seq = e.seq;   // ★ เติม seq ไว้เรียงลำดับขั้นตอนหน้าเครื่อง
        if (needType) { o.op_type = (e && e.op_type) || "machining"; o.is_assembly = e ? !!e.is_assembly : (o.op_type !== "machining"); }
      }
    }
  } catch { /* ignore — ถ้าเติมไม่ได้ ถือว่าเป็น machining ปกติ */ }
  try { localStorage.setItem(MOPS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

// ── ขั้นตอน "พื้นฐานทั้งหมด" ที่แอดมินตั้งไว้ (ทุก op ในระบบ) — หน้าเครื่องใช้โชว์ให้เลือกครบ ──
// ไม่จำกัดแค่ caps ของเครื่อง · anon SELECT ตาราง operations ได้ · แคช localStorage ให้ทำงานออฟไลน์
const ALLOPS_KEY = "mls-all-ops";
export async function getAllOperations() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    try { return JSON.parse(localStorage.getItem(ALLOPS_KEY)) || []; } catch { return []; }
  }
  try {
    const { data, error } = await supabase.from("operations").select("id, name, seq, op_type, is_assembly").order("seq");
    if (error) {
      console.warn("getAllOperations error", error);
      try { return JSON.parse(localStorage.getItem(ALLOPS_KEY)) || []; } catch { return []; }
    }
    const list = data || [];
    try { localStorage.setItem(ALLOPS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
    return list;
  } catch {
    try { return JSON.parse(localStorage.getItem(ALLOPS_KEY)) || []; } catch { return []; }
  }
}

// สร้างภาพ "วันนี้" ตอนออฟไลน์ = snapshot ล่าสุด + งานที่ยังค้างคิว (ยังไม่ซิงค์)
async function offlineMachineDay() {
  let snap = (await getDaySnapshot()) || { ok: true, daily: { quantity: 0, weight: 0, process_seconds: 0 }, records: [] };
  const today = bkkDay();
  // ★ รอบ 11: snapshot ของ "เมื่อวาน" (ออฟไลน์ข้ามเที่ยงคืน) → ยอดวันนี้เริ่มที่ 0 (ตารางสัปดาห์คงไว้)
  if (snap._day && snap._day !== today) snap = { ...snap, daily: { quantity: 0, weight: 0, process_seconds: 0 } };
  const me = sessionUser();
  const q = qRead().filter((it) => it.machineWork && !_syncedQids.has(it.qid) && ownedByMe(it, me));
  if (!q.length) return { ...snap, offline: true };
  const daily = { ...(snap.daily || { quantity: 0, weight: 0, process_seconds: 0 }) };
  const records = Array.isArray(snap.records) ? [...snap.records] : [];
  let item = records.length;
  for (const it of q) {
    const mw = it.machineWork;
    if (!(Number(mw.p_quantity) > 0)) continue;   // ★ ข้ามขั้นตอนที่ติ๊กร่วม (co-tick จำนวน 0) — ไม่โชว์เป็นแถวในตารางหน้าเครื่อง (ยอดรวมไม่กระทบ เพราะบวก 0)
    const isToday = !mw.p_recorded_at || bkkDay(new Date(mw.p_recorded_at)) === today;
    if (isToday) {   // ยอด "วันนี้" = เฉพาะงานค้างที่ทำวันนี้ (งานเมื่อวานที่ยังไม่ซิงค์ ยังขึ้นเป็นแถวรอซิงค์)
      daily.quantity = (Number(daily.quantity) || 0) + (Number(mw.p_quantity) || 0);
      daily.process_seconds = (Number(daily.process_seconds) || 0) + (Number(mw.p_process_seconds) || 0);
      daily.weight = (Number(daily.weight) || 0) + (Number(it.weight) || 0);   // ★ บวกน้ำหนักงานค้างด้วย
    }
    records.push({
      id: "q-" + (it.ts || item), item: ++item,
      qty: Number(mw.p_quantity) || 0, status: mw.p_status,
      process_seconds: Number(mw.p_process_seconds) || 0,
      weight: Number(it.weight) || 0,
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
  { qr, quantity, materialLengthMm, processSeconds, status, releaseId, clientId, recordedAt, operationId, weight },
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
      // เก็บ release_id + weight ไว้นอก payload (RPC ไม่รับ) เพื่อคำนวณ running number/ยอดน้ำหนักออฟไลน์
      //   (น้ำหนักคิดฝั่งเซิร์ฟเวอร์ = จำนวน × น้ำหนักต่อชิ้น · ออฟไลน์เก็บค่าที่คำนวณไว้ล่วงหน้ามาโชว์)
      const a = qRead();
      const { p_token: _omitToken, ...mwNoToken } = payload;   // ★ ไม่เก็บ token ลงคิว (ตอนซิงค์ใช้ token ของคนที่ล็อกอิน)
      a.push({ machineWork: mwNoToken, release_id: releaseId || null, weight: Number(weight) || 0, qid: payload.p_client_id, ts: Date.now(), owner: queueOwner() });
      // ★ ถ้าเขียนคิวไม่ได้ (ที่เก็บเต็ม/โหมดส่วนตัว) อย่าบอกว่าสำเร็จ — งานจะหายเงียบ
      if (!qWrite(a)) return { ok: false, reason: "storage_full", message: "ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ" };
      return { ok: true, queued: true };
    }
    console.warn("record_machine_work error", error);
    flagAuth(error);   // ★ token หมด/เพี้ยน → เด้ง login (path นี้เดิมตกหล่น = บันทึกหน้าเครื่องหลุดเงียบตอน token หมด ไม่เด้งออก)
    return { ok: false, reason: "error", message: error.message };
  }
  // ★ รอบ 11: token หมดอายุระหว่างงาน (server ตอบ unauthorized เป็นข้อมูล) → เก็บเข้าคิวในชื่อคนนี้ + เด้งให้ล็อกอินใหม่
  //   (เดิมขึ้น "บันทึกไม่สำเร็จ" เฉยๆ งานไม่เข้าคิว) · ล็อกอินกลับด้วยบัญชีเดิม = ซิงค์เอง (client_id กันซ้ำ)
  if (allowQueue && data && data.ok === false && data.reason === "unauthorized") {
    const a = qRead();
    const { p_token: _omitToken, ...mwNoToken } = payload;
    a.push({ machineWork: mwNoToken, release_id: releaseId || null, weight: Number(weight) || 0, qid: payload.p_client_id, ts: Date.now(), owner: queueOwner() });
    if (qWrite(a)) {
      try { window.dispatchEvent(new Event("mls-session-expired")); } catch (_) { /* ignore */ }
      return { ok: true, queued: true, authExpired: true };
    }
  }
  return data || { ok: false, reason: "error" };
}
