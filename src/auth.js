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

export const ROLES = ["admin", "supervisor", "operator"];
export const ROLE_LABELS = {
  admin: "ผู้ดูแลระบบ (Admin)",
  supervisor: "หัวหน้างาน",
  operator: "พนักงานหน้าเครื่อง",
};

// ─── Role helpers (ใช้กัน UI ตามสิทธิ์ — ดู RBAC ใน App.jsx) ──────────────────
// admin      = ทำได้ทุกอย่าง (Setup, จัดการ Release, ลบ)
// supervisor = ดูรายงาน + จัดการ Release ได้ แต่แก้ Setup ระบบ (พนักงาน/เครื่อง) ไม่ได้
// operator   = ปล่อยงาน/สแกน/พิมพ์ป้าย/ดูรายงานเท่านั้น
export function isAdmin(user)      { return user?.role === "admin"; }
export function canManage(user)    { return user?.role === "admin" || user?.role === "supervisor"; }

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

// ─── Session ────────────────────────────────────────────────────────────────
// ใช้ sessionStorage โดยตั้งใจ: หายอัตโนมัติเมื่อปิดแท็บ/เบราว์เซอร์
// หมายเหตุความปลอดภัย: object นี้แก้ไขในเครื่องได้ (เช่น ตั้ง role=admin เอง) — การกัน
// UI ตาม role เป็นแค่การช่วยผู้ใช้ ไม่ใช่กำแพงความปลอดภัยจริง กำแพงจริงต้องอยู่ที่
// DB (RLS/RPC) เมื่อย้ายไป Supabase Auth แล้ว (ดู CHANGES.md)
const SESSION_KEY = "mls-session";

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function setSession(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
}
export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
