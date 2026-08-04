import { supabase } from "./supabase.js";

// ─── Password hashing ──────────────────────────────────────────────────────
// เช่นเดียวกับระบบ tender-cost: hash ด้วย SHA-256 ก่อนเก็บ เป็นการป้องกันแบบ
// เบื้องต้นสำหรับทีมงานที่ไว้ใจกันเท่านั้น ไม่ใช่ระบบความปลอดภัยระดับสูง
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

// ─── Login ──────────────────────────────────────────────────────────────────
export async function verifyLogin(code, password) {
  const { data: emp, error } = await supabase
    .from("employees")
    .select("*, departments(name), machines(id, code, name), operations(id, name)")
    .eq("code", code.trim())
    .maybeSingle();
  if (error || !emp || !emp.active) return null;
  const hash = await hashPassword(password);
  if (hash !== emp.password_hash) return null;
  return {
    id: emp.id,
    code: emp.code,
    name: emp.name,
    role: emp.role,
    department: emp.departments?.name || "-",
    machine: emp.machines || null,      // เครื่องจักรประจำ — ใช้แทนการเลือกมือตอนสแกน
    operation: emp.operations || null,  // ขั้นตอนประจำ — ใช้แทนการเลือกมือตอนสแกน
  };
}

// ─── Session ────────────────────────────────────────────────────────────────
// ใช้ sessionStorage โดยตั้งใจ (ต่างจาก tender-cost ที่ใช้ localStorage):
// sessionStorage จะหายอัตโนมัติทันทีที่ปิดแท็บ/เบราว์เซอร์ ตรงตามที่ต้องการ
// ให้พนักงาน "ปิดเว็บแล้วออกจากระบบ" โดยไม่ต้องเขียน logic logout เพิ่ม
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
