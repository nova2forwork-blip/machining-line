import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// ─── Route split: /station = machine terminal (หน้าเครื่อง) ──────────────
//    ทุก path อื่น = แอปปกติ (สำนักงาน)  ·  ทั้งสองใช้ Supabase/ฐานข้อมูลเดียวกัน
//    (vercel.json rewrite ทุก path → index.html อยู่แล้ว จึงไม่ต้องตั้ง route เพิ่ม)
const path = window.location.pathname.replace(/\/+$/, "").toLowerCase();
// เทียบแบบเป๊ะ/มีขอบเขต — กัน /stationery, /dashboard-foo เผลอเข้าหน้าเครื่อง/แดชบอร์ด
const isStation = path === "/station" || path.startsWith("/station/");
const isAssembly = path === "/assembly" || path.startsWith("/assembly/");   // หน้าประกอบ (แผนกประกอบ)
const isPacking = path === "/packing" || path.startsWith("/packing/");      // หน้าแพ็ก (แผนกแพ็ก)
const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");

// ── auto-heal: render error จาก chunk ที่ไม่ตรงกัน (deploy ใหม่ทับของเก่า / แคชค้าง) ──
//    เช่น React error #130 (component undefined) — ต่างจาก chunk "โหลดไม่ได้" (onChunkError)
//    ตรงที่ chunk โหลดสำเร็จแต่ "เนื้อในไม่ตรงเวอร์ชัน" → เรนเดอร์แล้วพัง
//    วิธีกู้: ล้าง cache ของ service worker + ถอน SW แล้วโหลดใหม่ "ครั้งเดียว" (กันวนซ้ำด้วย sessionStorage)
//    ถ้าโหลดใหม่แล้วยัง error = ปล่อยให้เห็น error จริง (ไม่วนไม่รู้จบ)
if (typeof window !== "undefined") {
  const healOnce = () => {
    let healed = false;
    try { healed = sessionStorage.getItem("mls-healed") === "1"; } catch { /* ignore */ }
    if (healed) return;
    try { sessionStorage.setItem("mls-healed", "1"); } catch { /* ignore */ }
    const reload = () => { try { location.reload(); } catch { /* ignore */ } };
    const clearCaches = () =>
      (window.caches && caches.keys)
        ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {})
        : Promise.resolve();
    const unregSW = () =>
      (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
        ? navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {})
        : Promise.resolve();
    Promise.all([clearCaches(), unregSW()]).finally(reload);
  };
  const looksStale = (msg) =>
    /Minified React error #130|React error #130|Loading chunk|ChunkLoadError|Importing a module script failed|dynamically imported module|error loading dynamically/i.test(String(msg || ""));
  window.addEventListener("error", (ev) => {
    const msg = (ev && (ev.message || (ev.error && ev.error.message))) || "";
    if (looksStale(msg)) healOnce();
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const msg = (ev && ev.reason && (ev.reason.message || ev.reason)) || "";
    if (looksStale(msg)) healOnce();
  });
}

// ─── Service worker: แคช app shell ให้เปิดแอปได้แม้ไม่มีเน็ต + แจ้งเวอร์ชันใหม่ ──
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => import("./updatePrompt.js").then(({ setupUpdateWatcher }) => setupUpdateWatcher(reg)))
      .catch(() => { /* ไม่รองรับก็ข้ามไป */ });
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));

// ปิดหน้าโหลดชั่วคราว (boot-splash) หลังแอปเรนเดอร์แล้ว — เฟดออกนุ่มๆ กันจอมืด
function hideBootSplash() {
  // เรนเดอร์สำเร็จแล้ว → รีเซ็ตตัวกันวนของ auto-heal (เผื่อ deploy หน้าเจอปัญหาใหม่จะกู้ได้อีก)
  try { sessionStorage.removeItem("mls-load-retry"); sessionStorage.removeItem("mls-healed"); } catch { /* ignore */ }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const s = document.getElementById("boot-splash");
    if (!s) return;
    s.style.opacity = "0";
    setTimeout(() => { try { s.remove(); } catch { /* ignore */ } }, 400);
  }));
}

// H7: ถ้าโหลดโค้ด (chunk) พลาด เช่นกลาง deploy/เน็ตกระตุก → อย่าค้างสปินเนอร์
//     ลองรีโหลดอัตโนมัติสูงสุด 3 ครั้ง แล้วค่อยขึ้นข้อความให้ผู้ใช้
function onChunkError(e) {
  console.warn("chunk load failed", e);
  let tries = 0;
  try { tries = Number(sessionStorage.getItem("mls-load-retry") || "0"); } catch { /* ignore */ }
  const s = document.getElementById("boot-splash");
  const reloadNow = () => { try { location.reload(); } catch { /* ignore */ } };
  // ครั้งแรก = อาจแค่เน็ตกระตุก → reload เฉยๆ (คงแคชออฟไลน์ไว้)
  // ครั้งที่ 2+ = น่าจะ chunk ค้างไม่ตรงเวอร์ชัน → ล้างแคช service worker + ถอน SW ก่อน reload (กัน loop)
  const hardHeal = tries >= 1;
  const go = () => {
    if (!hardHeal) return reloadNow();
    const cc = (window.caches && caches.keys)
      ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {})
      : Promise.resolve();
    const sw = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
      ? navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {})
      : Promise.resolve();
    Promise.all([cc, sw]).finally(reloadNow);
  };
  if (tries < 3) {
    try { sessionStorage.setItem("mls-load-retry", String(tries + 1)); } catch { /* ignore */ }
    setTimeout(go, 2500);
  } else {
    if (s) s.innerHTML = '<div style="color:#9db1a8;font-family:system-ui,sans-serif;text-align:center;font-size:16px;line-height:1.6">โหลดแอปไม่สำเร็จ<br>กำลังลองใหม่อัตโนมัติ…</div>';
    // จอเปิดทิ้ง 24 ชม. (เช่น Dashboard/หน้าเครื่อง) — อย่าหยุดถาวร ลองใหม่เป็นระยะจนกว่าจะสำเร็จ
    try { sessionStorage.removeItem("mls-load-retry"); } catch { /* ignore */ }
    setTimeout(go, 30000);
  }
}

if (isDashboard) {
  document.body.classList.add("dash-body");
  import("./Dashboard.jsx").then(({ default: Dashboard }) => {
    root.render(<React.StrictMode><Dashboard /></React.StrictMode>);
    hideBootSplash();
  }).catch(onChunkError);
} else if (isStation || isAssembly || isPacking) {
  // ทั้ง 3 แผนกใช้เอนจิน Station.jsx ตัวเดียวกัน — แยกด้วย prop dept (คนละ URL / คนละหน้าจอ)
  const dept = isAssembly ? "assembly" : isPacking ? "packing" : "machine";
  import("./Station.jsx").then(({ default: StationApp }) => {
    root.render(<React.StrictMode><StationApp dept={dept} /></React.StrictMode>);
    hideBootSplash();
  }).catch(onChunkError);
} else {
  import("./App.jsx").then(({ default: App }) => {
    root.render(<React.StrictMode><App /></React.StrictMode>);
    hideBootSplash();
  }).catch(onChunkError);
}
