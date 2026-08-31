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
  try {
    const raw = localStorage.getItem("mls-session") || sessionStorage.getItem("mls-session");
    if (raw) return JSON.parse(raw)?.token || null;
  } catch { /* storage ถูกบล็อก (iPad private/kiosk/Block-All-Cookies) → ไป fallback */ }
  try { return globalThis.__mlsSession?.token || null; } catch { return null; }
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
  return data;
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

// พิมพ์เบอร์พาร์ท → คืน "ตัวเลือกระดับโปรเจกต์" (part_no ไม่ซ้ำในโปรเจกต์เดียว = 1 โปรเจกต์ 1 part_master)
// ★ ผู้ใช้เลือกแค่ "โปรเจกต์" พอ (ไม่ต้องเลือก release) — ระบบ resolve unit ให้เอง
//   • done = ขั้นตอนนี้ (operation) "เคยทำ" ของโปรเจกต์นี้ไปกี่ครั้ง → เรียงโปรเจกต์ที่ยังไม่เคยทำขึ้นก่อน
//     (โปรเจกต์ที่ทำแล้วยังเลือกได้ ไว้แก้งานเสีย)
//   • unit ตัวแทน = ชิ้นของ "release ที่ยังทำอยู่" (record ล่าสุดของขั้นตอนนี้) ไม่งั้นชิ้นแรกของโปรเจกต์
// คืน [{ pmId, code, name, partName, length, doneCount, unit }] เรียงยังไม่เคยทำก่อน · [] ถ้าไม่พบ/ออฟไลน์
export async function findManualPartOptions(partNo, operationId = null) {
  const p = String(partNo || "").trim();
  if (!p) return [];
  if (typeof navigator !== "undefined" && navigator.onLine === false) return [];  // ต้องมีเน็ต
  // 1) part_master (1 ต่อ 1 โปรเจกต์) ที่ part_no ตรง
  const { data: pms, error: e1 } = await supabase
    .from("part_master").select("id, part_no, part_name, default_length_mm, projects(code, name, status)")
    .ilike("part_no", p);
  if (e1) { console.warn("findManualPartOptions (part_master) error", e1); return []; }
  // ตัดโปรเจกต์ที่ "ปิดแล้ว" ออก — บันทึกไม่ได้อยู่แล้ว ไม่ต้องให้เลือก (ถ้าต้องแก้งาน ให้แอดมินเปิดโปรเจกต์ก่อน)
  const masters = (pms || []).filter((m) => m.projects?.status !== "closed");
  if (!masters.length) return [];
  const ids = masters.map((m) => m.id);
  // 2) ชิ้นงานของทุก part_master (ไว้ resolve + เอาความยาวเฉพาะชิ้น)
  const { data: units } = await supabase.from("part_units").select(UNIT_SELECT)
    .in("part_master_id", ids).order("unit_no", { ascending: true });
  const allUnits = units || [];
  // 3) บันทึกของ "ขั้นตอนนี้" (ไว้หา doneCount + release ที่ยังทำอยู่ ต่อโปรเจกต์)
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
    if (!unit) unit = mUnits[0];                           // ยังไม่เคยทำ → ชิ้นแรกของโปรเจกต์
    out.push({
      pmId: m.id, code: m.projects?.code || "", name: m.projects?.name || "",
      partName: m.part_name || "", length: unit.length_mm ?? m.default_length_mm,
      doneCount: mRecs.length, lastTs: mRecs[0]?.recorded_at || null, unit,
    });
  }
  // ยังไม่เคยทำขั้นตอนนี้ (0) ขึ้นก่อน · ในกลุ่มเดียวกันเรียง "งานล่าสุด" ขึ้นก่อน (โปรเจกต์ที่กำลังทำลอยขึ้น)
  out.sort((a, b) => {
    const af = a.doneCount === 0 ? 0 : 1, bf = b.doneCount === 0 ? 0 : 1;
    if (af !== bf) return af - bf;
    return String(b.lastTs || "").localeCompare(String(a.lastTs || ""));
  });
  return out;
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
  // ★ นับงานค้างคิว "เฉพาะขั้นตอนนี้" (กันเครื่องหลายขั้นตอนนับข้ามกันตอนออฟไลน์)
  const queued = queuedQtyForRelease(releaseId, operationId);
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
// ★ แยกตาม "ขั้นตอน (operation)" ด้วย — กันเครื่องหลายขั้นตอนที่สลับงานบน release เดียวกัน
//   ตอนออฟไลน์ แล้วยอดคืบหน้าของแต่ละขั้นตอนนับข้ามกันจนเกินจริง
function queuedQtyForRelease(releaseId, operationId = null) {
  if (!releaseId) return 0;
  return qRead().reduce((s, it) => {
    if (it.release_id !== releaseId) return s;
    // ถ้าระบุขั้นตอน → นับเฉพาะงานค้างของขั้นตอนนั้น (machineWork ที่ p_operation_id ตรง)
    if (operationId && it.machineWork && it.machineWork.p_operation_id !== operationId) return s;
    return s + (Number(it.machineWork?.p_quantity) || 0);
  }, 0);
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
  // ★ ตัด attempts ออกด้วย — ไม่งั้น item ที่เคยพลาด 11 ครั้งจะชน MAX_ATTEMPTS ทันทีที่ retry (ลองใหม่ไม่ได้จริง)
  for (const it of rj) { const { reason, rejectedAt, attempts, ...orig } = it; q.push(orig); }
  qWrite(q); rjWrite([]); flushScanQueue();
}
export function clearRejected() { rjWrite([]); }

// ── รายงานคิว rejected ขึ้น server (dead-letter) ให้ office เห็นราย "เครื่อง" (#14) ──
// best-effort — server กันซ้ำด้วย qid · เรียกหลัง flush เมื่อมี reject ใหม่ + ตอนเปิดหน้าเครื่อง
export async function reportDeadLetter(items) {
  const list = (items || rjRead()).filter((it) => it && it.qid);
  if (!list.length) return;
  const payload = list.map((it) => ({
    qid: it.qid,
    kind: it.machineWork ? "machine_work" : "qr",
    qr: it.qr || null,
    detail: it.machineWork
      ? { release_id: it.machineWork.p_release_id, operation_id: it.machineWork.p_operation_id, quantity: it.machineWork.p_quantity }
      : null,
    reason: it.reason || null,
    client_ts: String(it.rejectedAt || it.ts || Date.now()),
  }));
  try { await supabase.rpc("report_dead_letter", { p_token: authToken(), p_items: payload }); }
  catch (e) { console.warn("reportDeadLetter failed:", e?.message || e); }
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
// components = [{ child_pm_id, qty }] · แทนที่ทั้งชุด · ลูกต้องอยู่โปรเจกต์เดียวกัน (DB บังคับ)
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

// บันทึกการประกอบจากหน้าเครื่อง (ใช้ใน Phase 1 ส่วนที่ 3) — คืนผลตรวจครบตาม BOM
export async function recordAssembly({ parentQr, childQrs, operationId, clientId, recordedAt }) {
  const { data, error } = await supabase.rpc("record_assembly", {
    p_token: authToken(), p_parent_qr: parentQr, p_child_qrs: childQrs,
    p_operation_id: operationId, p_client_id: clientId ?? null, p_recorded_at: recordedAt ?? null,
  });
  if (error) { console.warn("record_assembly error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
}

// โหลดสถานะประกอบ "สะสม" ของเบอร์แม่ (BOM + ที่ติดตั้งไปแล้วข้ามสเตชัน) — ใช้ตอนสแกนเบอร์แม่
export async function getAssemblyState(parentQr) {
  const { data, error } = await supabase.rpc("get_assembly_state", { p_parent_qr: parentQr });
  if (error) { console.warn("get_assembly_state error", error); flagAuth(error); throw error; }
  return data || { ok: false, reason: "error" };
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

// รายการ "เบอร์แม่" ที่ยังประกอบไม่เสร็จ (ให้เลือกในหน้าประกอบ/แพ็ก แทนการสแกนอย่างเดียว)
// assembly = แผง + ซับ · packing = บั้ง(package) · ตัดโปรเจกต์ที่ปิด · อ่านตรง (anon SELECT)
export async function listAssemblyParents(dept) {
  const kinds = dept === "packing" ? ["package"] : ["panel", "subassembly"];
  const { data, error } = await supabase
    .from("part_units")
    .select("id, qr_code, status, part_master!inner(part_no, part_name, kind, projects(code, name, status))")
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
    project_code: u.part_master?.projects?.code || "",
    project_status: u.part_master?.projects?.status || "",
  })).filter((r) => r.project_status !== "closed");
  // กำลังทำ (in_progress) ขึ้นก่อน แล้วเรียงตามเบอร์
  const doing = (s) => /progress/i.test(s || "");
  rows.sort((a, b) => (doing(b.status) - doing(a.status)) || String(a.part_no).localeCompare(String(b.part_no)));
  return rows;
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
  let authExpired = false;         // เจอ token หมดอายุระหว่างซิงค์ → แจ้งให้ล็อกอินใหม่ (งานคงอยู่ในคิว)
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
        if (isAuthError(error)) { authExpired = true; continue; }  // token หมดอายุ/ไม่ถูกต้อง → คงไว้รอ login ใหม่ (ไม่นับ attempt/ไม่ reject)
        // แยก "เน็ต/DB สะดุด" (retry) ออกจาก "พลาดถาวร" (วนไม่จบ) — H3
        if (typeof navigator !== "undefined" && navigator.onLine === false) continue; // ออฟไลน์ = ไม่ถือเป็นครั้ง
        const at = (Number(item.attempts) || 0) + 1;
        if (at >= MAX_ATTEMPTS) { rejects.push({ item, reason: "retry_exhausted" }); done.add(item.qid); }
        else bumped.set(item.qid, at);                            // ยังไม่ถึงเพดาน → คงไว้ retry (บันทึกจำนวนครั้ง)
        continue;
      }
      if (data && data.ok === false) {
        if (data.reason === "unauthorized") { authExpired = true; continue; }   // token หมดอายุ → คงไว้รอ login ใหม่ + แจ้งเตือน
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
    // มี reject ใหม่ → รายงานคิว rejected ขึ้น server ให้ office เห็น (best-effort, กันซ้ำด้วย qid)
    if (rejects.length) { try { reportDeadLetter(); } catch (_) { /* ignore */ } }
    // token หมดอายุระหว่างซิงค์ → แจ้งแอปให้เด้งล็อกอินใหม่ (งานยังอยู่ในคิว รอดข้ามการล็อกอิน)
    if (authExpired && typeof window !== "undefined") {
      try { window.dispatchEvent(new Event("mls-session-expired")); } catch (_) { /* ignore */ }
    }
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
  // เติม op_type + is_assembly (RPC machine_ops เดิมอาจยังไม่คืนคอลัมน์นี้) — อ่านตรงจากตาราง operations
  try {
    const ids = list.map((o) => o.id).filter(Boolean);
    if (ids.length && !(list[0] && "op_type" in list[0])) {
      const { data: ops } = await supabase.from("operations").select("id, is_assembly, op_type").in("id", ids);
      const m = new Map((ops || []).map((o) => [o.id, o]));
      for (const o of list) {
        const e = m.get(o.id);
        o.op_type = (e && e.op_type) || "machining";
        o.is_assembly = e ? !!e.is_assembly : (o.op_type !== "machining");
      }
    }
  } catch { /* ignore — ถ้าเติมไม่ได้ ถือว่าเป็น machining ปกติ */ }
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
    daily.weight = (Number(daily.weight) || 0) + (Number(it.weight) || 0);   // ★ บวกน้ำหนักงานค้างด้วย
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
      a.push({ machineWork: payload, release_id: releaseId || null, weight: Number(weight) || 0, qid: payload.p_client_id, ts: Date.now() });
      // ★ ถ้าเขียนคิวไม่ได้ (ที่เก็บเต็ม/โหมดส่วนตัว) อย่าบอกว่าสำเร็จ — งานจะหายเงียบ
      if (!qWrite(a)) return { ok: false, reason: "storage_full", message: "ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ" };
      return { ok: true, queued: true };
    }
    console.warn("record_machine_work error", error);
    return { ok: false, reason: "error", message: error.message };
  }
  return data || { ok: false, reason: "error" };
}
