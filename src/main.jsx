import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// ─── Route split: /station = machine terminal (หน้าเครื่อง) ──────────────
//    ทุก path อื่น = แอปปกติ (สำนักงาน)  ·  ทั้งสองใช้ Supabase/ฐานข้อมูลเดียวกัน
//    (vercel.json rewrite ทุก path → index.html อยู่แล้ว จึงไม่ต้องตั้ง route เพิ่ม)
const path = window.location.pathname.replace(/\/+$/, "").toLowerCase();
// เทียบแบบเป๊ะ/มีขอบเขต — กัน /stationery, /dashboard-foo เผลอเข้าหน้าเครื่อง/แดชบอร์ด
const isStation = path === "/station" || path.startsWith("/station/");
const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");

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
  try { sessionStorage.removeItem("mls-load-retry"); } catch { /* ignore */ }
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
  if (tries < 3) {
    try { sessionStorage.setItem("mls-load-retry", String(tries + 1)); } catch { /* ignore */ }
    setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 2500);
  } else {
    if (s) s.innerHTML = '<div style="color:#9db1a8;font-family:system-ui,sans-serif;text-align:center;font-size:16px;line-height:1.6">โหลดแอปไม่สำเร็จ<br>กำลังลองใหม่อัตโนมัติ…</div>';
    // จอเปิดทิ้ง 24 ชม. (เช่น Dashboard/หน้าเครื่อง) — อย่าหยุดถาวร ลองใหม่เป็นระยะจนกว่าจะสำเร็จ
    // รีเซ็ตตัวนับก่อน เพื่อให้รอบถัดไปได้ retry เร็ว 3 ครั้งอีกชุด
    try { sessionStorage.removeItem("mls-load-retry"); } catch { /* ignore */ }
    setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 30000);
  }
}

if (isDashboard) {
  document.body.classList.add("dash-body");
  import("./Dashboard.jsx").then(({ default: Dashboard }) => {
    root.render(<React.StrictMode><Dashboard /></React.StrictMode>);
    hideBootSplash();
  }).catch(onChunkError);
} else if (isStation) {
  import("./Station.jsx").then(({ default: StationApp }) => {
    root.render(<React.StrictMode><StationApp /></React.StrictMode>);
    hideBootSplash();
  }).catch(onChunkError);
} else {
  import("./App.jsx").then(({ default: App }) => {
    root.render(<React.StrictMode><App /></React.StrictMode>);
    hideBootSplash();
  }).catch(onChunkError);
}
