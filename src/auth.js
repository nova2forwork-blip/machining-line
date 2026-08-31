import { supabase } from "./supabase.js";

// ─── Password hashing (client-side) — DEPRECATED for login ───────────────────
// เดิมใช้ hash รหัสผ่านฝั่ง client แล้วเทียบใน browser ซึ่งไม่ปลอดภัย (ดึง hash ของ
// พนักงานทุกคนลงมาได้). ตอนนี้ย้ายการตรวจไปทำใน DB (verify_login RPC) แล้ว และการ
// สร้าง/ตั้งรหัสพนักงานก็ทำผ่าน upsert_employee RPC (DB hash ด้วย bcrypt เอง)
// จึงไม่ควรเรียกฟังก์ชันนี้อีก — คงไว้เพื่อ backward-compat เท่านั้น
export async function hashPassword(pw) {
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ROLES = ["admin", "office", "operator"];
export const ROLE_LABELS = {
  admin: "ผู้ดูแลระบบ (Admin)",
  office: "พนักงานออฟฟิศ",
  operator: "พนักงานหน้าเครื่อง",
  supervisor: "หัวหน้างาน (เดิม)",   // legacy — เผื่อมีข้อมูลเก่าจะได้ยังแสดง/ใช้สิทธิ์ได้
};

// ─── Role helpers (ใช้กัน UI ตามสิทธิ์ — ดู RBAC ใน App.jsx) ──────────────────
// admin    = ทำได้ทุกอย่าง (Setup พนักงาน/เครื่อง, จัดการ Release, ลบ)
// office   = ลงข้อมูล/สร้างโปรเจค + สร้าง & แก้ไข Release + ดูรายงาน · แต่เข้า Setup ระบบไม่ได้
// operator = ปล่อยงาน/สแกน/พิมพ์ป้าย/ดูรายงานเท่านั้น
// (supervisor = role เดิม ยังให้สิทธิ์เท่า office เพื่อ backward-compat)
export function isAdmin(user)      { return user?.role === "admin"; }
export function canManage(user)    { return user?.role === "admin" || user?.role === "office" || user?.role === "supervisor"; }

function mapLoginRow(row) {
  return {
    token: row.token,        // session token — แนบไปกับทุกการเขียนผ่าน supabase.js
    id: row.id,
    code: row.code,
    name: row.name,
    role: row.role,
    department: row.department_name || "-",
    machine: row.machine_id ? { id: row.machine_id, code: row.machine_code, name: row.machine_name } : null,
    operation: row.operation_id ? { id: row.operation_id, name: row.operation_name } : null,
  };
}

// ─── Login (ตรวจฝั่ง DB ผ่าน RPC — client ไม่เห็น password_hash อีกต่อไป) ──────
export async function verifyLogin(code, password) {
  const { data, error } = await supabase.rpc("verify_login", {
    p_code: code.trim(),
    p_password: password,
  });
  if (error) {
    console.warn("verify_login error", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return mapLoginRow(row);
}

// ─── Offline login (หน้าเครื่อง) ──────────────────────────────────────────
// เก็บ credential ที่ล็อกอินสำเร็จ "ตอนออนไลน์" ไว้ในเครื่อง (salt + SHA-256 ของรหัสผ่าน)
// เพื่อให้ล็อกอินซ้ำได้แม้ไม่มีเน็ต · ปลอดภัยพอสำหรับจอหน้าเครื่องที่เป็นอุปกรณ์เฉพาะ
// (ไม่ใช่ bcrypt แต่ hash+salt ในเครื่อง — และตัว token เองก็เก็บในเครื่องอยู่แล้ว)
const LOGIN_CACHE_KEY = "mls-login-cache";
async function sha256Hex(s) {
  // crypto.subtle มีเฉพาะ secure context (https/PWA) — ถ้าไม่มี (http บน LAN) คืน null
  // แล้ว offline login จะข้ามไป (ยังล็อกอินออนไลน์ได้ปกติ) แทนที่จะ throw ทำแอปพัง
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
function randSalt() {
  const a = new Uint8Array(16);
  try { crypto.getRandomValues(a); } catch { /* ignore */ }
  return Array.from(a).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function readLoginCache() { try { return JSON.parse(localStorage.getItem(LOGIN_CACHE_KEY)) || {}; } catch { return {}; } }
function writeLoginCache(m) { try { localStorage.setItem(LOGIN_CACHE_KEY, JSON.stringify(m)); } catch { /* ignore */ } }
async function cacheCredential(code, password, user) {
  try {
    const salt = randSalt();
    const hash = await sha256Hex(salt + ":" + password);
    if (!hash) return;   // ไม่มี crypto.subtle (http) → ไม่เก็บ (จะได้ไม่มีทาง match แบบ null===null)
    const m = readLoginCache();
    m[code.trim().toLowerCase()] = { salt, hash, user, ts: Date.now() };
    writeLoginCache(m);
  } catch { /* ignore */ }
}

// ล็อกอินหน้าเครื่อง: ออนไลน์ = ตรวจ DB + จำ credential ไว้ · ออฟไลน์/เน็ตหลุด = เทียบกับที่จำไว้
// คืน { user, offline } เมื่อสำเร็จ · { error:'bad' | 'offline_first' } เมื่อไม่สำเร็จ
export async function stationLogin(code, password) {
  const key = code.trim().toLowerCase();
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!isOffline) {
    // บล็อกถ้ามีเครื่องอื่นถือบัญชีนี้อยู่ (heartbeat < 3 นาที) — fail-open ถ้า probe พลาด
    try {
      const { data: probe } = await supabase.rpc("session_probe", { p_code: code.trim() });
      if (probe && probe.held) return { error: "in_use", lastSeen: probe.last_seen };
    } catch { /* fail-open: ปล่อยเข้า ไม่ให้ล็อกตายเพราะ RPC พลาด */ }

    const { data, error } = await supabase.rpc("verify_login", { p_code: code.trim(), p_password: password });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { error: "bad" };            // เซิร์ฟเวอร์ตอบว่ารหัสผิด → ไม่ fallback
      const user = mapLoginRow(row);
      await cacheCredential(code, password, user);   // จำไว้ใช้ตอนออฟไลน์
      return { user, offline: false };
    }
    // error = เน็ตมีปัญหา → ลองใช้ credential ที่แคชไว้
  }
  const e = readLoginCache()[key];
  if (!e) return { error: isOffline ? "offline_first" : "bad" };
  const hash = await sha256Hex(e.salt + ":" + password);
  if (!hash || !e.hash || hash !== e.hash) return { error: "bad" };   // null ไม่ถือว่า match
  return { user: e.user, offline: true };
}

// ─── Session ────────────────────────────────────────────────────────────────
// ใช้ localStorage: ล็อกอินค้างไว้ ไม่หลุดเมื่อปิดแท็บ/เบราว์เซอร์ (เหมาะกับจอหน้าเครื่อง
// ที่เปิดค้างทั้งวัน) — ออกจากระบบเมื่อกดปุ่ม "ออก" เท่านั้น
// หมายเหตุความปลอดภัย: object นี้แก้ไขในเครื่องได้ (เช่น ตั้ง role=admin เอง) — การกัน
// UI ตาม role เป็นแค่การช่วยผู้ใช้ ไม่ใช่กำแพงความปลอดภัยจริง กำแพงจริงอยู่ที่ DB (RLS/RPC)
// อนึ่ง token ยังมีอายุ 12 ชม.ฝั่ง DB — ถ้าค้างข้ามวันอาจต้องล็อกอินใหม่รอบเดียว
const SESSION_KEY = "mls-session";

// ★ iPad/Safari (โหมด private, "Block All Cookies", kiosk, บาง PWA) — localStorage อาจ throw
//   หรือเขียนแล้วอ่านไม่ติด → session หาย → ล็อกอินแล้วเด้งกลับ · จึงทำ fallback หลายชั้น:
//   localStorage → sessionStorage (รอดข้ามการ redirect ในแท็บเดียว) → in-memory (รอดอย่างน้อยจนปิดแอป)
// ★ cookie = ชั้นเก็บ session ที่ "รอดข้ามการรีโหลด" แม้ localStorage/sessionStorage ถูกบล็อก
//   (kiosk/PWA/Safari private) — แก้อาการ "กดอัปเดต/รีโหลดแล้วเด้งให้ล็อกอินใหม่" (in-memory หายตอนรีโหลด)
//   first-party + SameSite=Lax → ส่งเฉพาะ origin ตัวเอง (ไม่รั่วไป Supabase) · เท่ากับ exposure ของ localStorage เดิม
const COOKIE_KEY = "mls_session";
function readCookie(name) {
  try {
    const m = (typeof document !== "undefined" ? document.cookie || "" : "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}
function writeCookie(name, val, maxAgeSec) {
  try {
    const secure = (typeof location !== "undefined" && location.protocol === "https:") ? "; Secure" : "";
    document.cookie = name + "=" + encodeURIComponent(val) + "; path=/; max-age=" + maxAgeSec + "; SameSite=Lax" + secure;
  } catch { /* ignore */ }
}
function deleteCookie(name) {
  try { document.cookie = name + "=; path=/; max-age=0; SameSite=Lax"; } catch { /* ignore */ }
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage ถูกบล็อก — ไป fallback ต่อ */ }
  // cookie: รอดข้ามรีโหลด/กดอัปเดต แม้ localStorage/sessionStorage ใช้ไม่ได้
  try { const c = readCookie(COOKIE_KEY); if (c) return JSON.parse(c); } catch { /* ignore */ }
  try { return globalThis.__mlsSession || null; } catch { return null; }
}
export function setSession(user) {
  try { globalThis.__mlsSession = user; } catch { /* ignore */ }   // in-memory เสมอ (ทนสุด)
  const raw = JSON.stringify(user);
  let stored = false;
  try { localStorage.setItem(SESSION_KEY, raw); stored = true; } catch { /* localStorage บล็อก */ }
  try {
    if (stored) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, raw);   // localStorage ใช้ไม่ได้ → เก็บ sessionStorage แทน
  } catch { /* ignore */ }
  writeCookie(COOKIE_KEY, raw, 12 * 60 * 60);   // ★ เขียน cookie ควบเสมอ (อายุ 12 ชม. = เท่า token DB) → กดอัปเดต/รีโหลดแล้วไม่หลุด
}
export function clearSession() {
  try { globalThis.__mlsSession = null; } catch { /* ignore */ }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  deleteCookie(COOKIE_KEY);   // ★ ล้าง cookie ด้วย (กันล็อกอินค้างหลังกดออก)
}
