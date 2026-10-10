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
    // รองรับทั้งลำดับ type="module" ... src และ src ... type="module" (กัน Vite สลับลำดับ attribute)
    const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)
           || html.match(/<script[^>]+src="([^"]+)"[^>]+type="module"/i);
    if (!m) return;
    const latest = new URL(m[1], location.href).pathname;
    if (baselineBundle && latest && latest !== baselineBundle) readyWhenCached(latest);
  } catch { /* ออฟไลน์/พลาด = ข้าม */ }
}

// ★ 2026-10-10 ตรวจรอบ 2: เจอเวอร์ชันใหม่ → สั่ง service worker เก็บไฟล์ของเวอร์ชันนั้นให้ครบก่อน แล้วค่อยขึ้นแถบ "มีเวอร์ชันใหม่"
//   (เดิมขึ้นแถบทันที → กดอัปเดตตอนเน็ตช้า ได้เวอร์ชันเดิมกลับมา + แถบขึ้นซ้ำ · จอ TV รีโหลดวนจนกว่าจะเก็บครบ)
//   ไม่มี service worker / ตอบช้าเกิน 2 นาที = ขึ้นแถบเลย (แบบเดิม)
let _preinstall = "";
function readyWhenCached(latest) {
  if (window.__mlsUpdateReady || _preinstall === latest) return;
  _preinstall = latest;
  const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!ctl || typeof MessageChannel === "undefined") { markUpdateReady(); return; }
  let done = false;
  const finish = () => { if (done) return; done = true; markUpdateReady(); };
  // ★ 2026-10-10 ตรวจรอบ 3: SW ตอบ {ok:false} (เก็บไฟล์ไม่ครบ) → ห้ามขึ้นแถบ (จอ TV รีโหลดได้ตัวเดิม → วนรีโหลด)
  //   ล้าง _preinstall ให้รอบเช็คถัดไป (ทุก 5 นาที) สั่งเก็บใหม่ · ไม่ตอบเลยเกิน 2 นาที = ขึ้นแถบแบบเดิม
  const fail = () => { if (done) return; done = true; if (_preinstall === latest) _preinstall = ""; };
  try {
    const ch = new MessageChannel();
    ch.port1.onmessage = (ev) => { if (ev && ev.data && ev.data.ok === true) finish(); else fail(); };
    ctl.postMessage({ type: "mls-install-latest" }, [ch.port2]);
  } catch { finish(); return; }
  setTimeout(finish, 120 * 1000);
}

// เรียกจาก main.jsx: ผูกกับ registration ของ service worker + เริ่มเช็คเวอร์ชันเป็นระยะ
export function setupUpdateWatcher(reg) {
  if (typeof navigator === "undefined") return;
  baselineBundle = currentBundlePath();   // ชื่อไฟล์ที่กำลังรันอยู่ตอนนี้

  // (เสริม) ฟัง service worker เผื่ออนาคต sw.js เปลี่ยน — ปัจจุบันอาจไม่ยิง
  if (reg) {
    const hadController = !!navigator.serviceWorker.controller;
    // ★ 2026-10-10 ตรวจรอบ 2: sw.js เปลี่ยน ≠ แอปเปลี่ยน → ไปเทียบชื่อไฟล์ bundle ก่อน (เดิมขึ้น "มีเวอร์ชันใหม่" หลอก · จอ TV รีโหลดเปล่าๆ)
    const watch = (w) => w && w.addEventListener("statechange", () => {
      if (w.state === "installed" && navigator.serviceWorker.controller) checkVersion();
    });
    if (reg.waiting && navigator.serviceWorker.controller) checkVersion();
    watch(reg.installing);
    reg.addEventListener("updatefound", () => watch(reg.installing));
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) checkVersion(); });
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
