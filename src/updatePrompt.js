// ─── ตรวจ "มีเวอร์ชันใหม่" ของแอป แล้วแจ้งให้ผู้ใช้กดอัปเดตเอง ──────────────
// ทำงานคู่กับ service worker (public/sw.js): เมื่อ deploy ใหม่ เบราว์เซอร์จะโหลด
// sw.js ตัวใหม่ → ติดตั้ง → ตั้งธง window.__mlsUpdateReady + ยิง event 'mls-update-ready'
// แอปจะโชว์แถบ "มีอัปเดต — กดเพื่อโหลดใหม่" ให้ผู้ใช้กดเองตอนพร้อม (ไม่รีโหลดกลางคัน)
//
// setupUpdateWatcher() เรียกครั้งเดียวใน main.jsx (หลัง register SW)
import { useState, useEffect } from "react";

const EVENT = "mls-update-ready";

export function markUpdateReady() {
  if (typeof window === "undefined") return;
  if (window.__mlsUpdateReady) return;      // แจ้งครั้งเดียวพอ
  window.__mlsUpdateReady = true;
  window.dispatchEvent(new Event(EVENT));
}

// ── ตรวจเวอร์ชันจาก "ชื่อไฟล์ bundle" (วิธีหลัก — เชื่อถือได้) ────────────────
// sw.js เป็นไฟล์เดิมทุก deploy เบราว์เซอร์เลยไม่ถือว่า service worker เปลี่ยน
// (updatefound/controllerchange จะไม่ยิง) แต่ Vite เปลี่ยน "ชื่อไฟล์ JS (มี hash)"
// ทุก build → เราจึงเทียบชื่อไฟล์ module ปัจจุบัน กับตัวที่ deploy ล่าสุดแทน
function currentBundlePath() {
  const s = document.querySelector('script[type="module"][src]');
  try { return s ? new URL(s.src, location.href).pathname : null; } catch { return null; }
}
let baselineBundle = null;

async function checkVersion() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    // ใส่ query กัน service worker คืน index.html เก่าจากแคช (บังคับดึงจากเน็ต)
    const res = await fetch(`/?_v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
    if (!m) return;
    const latest = new URL(m[1], location.href).pathname;
    if (baselineBundle && latest && latest !== baselineBundle) markUpdateReady();
  } catch { /* ออฟไลน์/พลาด = ข้าม */ }
}

// เรียกจาก main.jsx: ผูกกับ registration ของ service worker + เริ่มเช็คเวอร์ชันเป็นระยะ
export function setupUpdateWatcher(reg) {
  if (typeof navigator === "undefined") return;
  baselineBundle = currentBundlePath();   // ชื่อไฟล์ที่กำลังรันอยู่ตอนนี้

  // (เสริม) ฟัง service worker เผื่ออนาคต sw.js เปลี่ยน — ปัจจุบันอาจไม่ยิง
  if (reg) {
    const hadController = !!navigator.serviceWorker.controller;
    const watch = (w) => w && w.addEventListener("statechange", () => {
      if (w.state === "installed" && navigator.serviceWorker.controller) markUpdateReady();
    });
    if (reg.waiting && navigator.serviceWorker.controller) markUpdateReady();
    watch(reg.installing);
    reg.addEventListener("updatefound", () => watch(reg.installing));
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) markUpdateReady(); });
  }

  // เช็คเวอร์ชันเป็นระยะ (จอเปิดค้างทั้งวัน) + ตอนกลับมาออนไลน์/กลับมาโฟกัส
  const check = () => { checkVersion(); if (reg) { try { reg.update(); } catch { /* ignore */ } } };
  setTimeout(check, 8 * 1000);                      // เช็คครั้งแรกไวๆ หลังเปิด (กันหน้าที่เปิดค้าง/โหลดจากแคชเก่า)
  setInterval(check, 5 * 60 * 1000);                // จากนั้นทุก 5 นาที
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}

// React hook: คืน true เมื่อมีเวอร์ชันใหม่พร้อม
export function useUpdateReady() {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && !!window.__mlsUpdateReady);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener(EVENT, on);
    if (window.__mlsUpdateReady) setReady(true);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return ready;
}

// โหลดหน้าใหม่เพื่อรับเวอร์ชันล่าสุด — ต้องออนไลน์ (ไม่งั้นจะได้ของเก่าจากแคช)
// คืน false ถ้าออฟไลน์อยู่ (ให้ผู้เรียกแจ้งผู้ใช้ว่าให้ลองตอนมีเน็ต)
export function applyUpdate() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try { window.location.reload(); } catch { /* ignore */ }
  return true;
}
