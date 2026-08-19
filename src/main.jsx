import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// ─── Route split: /station = machine terminal (หน้าเครื่อง) ──────────────
//    ทุก path อื่น = แอปปกติ (สำนักงาน)  ·  ทั้งสองใช้ Supabase/ฐานข้อมูลเดียวกัน
//    (vercel.json rewrite ทุก path → index.html อยู่แล้ว จึงไม่ต้องตั้ง route เพิ่ม)
const path = window.location.pathname.replace(/\/+$/, "").toLowerCase();
const isStation = path.startsWith("/station");
const isDashboard = path.startsWith("/dashboard");

// ─── Service worker: แคช app shell ให้เปิดแอปได้แม้ไม่มีเน็ต + แจ้งเวอร์ชันใหม่ ──
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => import("./updatePrompt.js").then(({ setupUpdateWatcher }) => setupUpdateWatcher(reg)))
      .catch(() => { /* ไม่รองรับก็ข้ามไป */ });
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));

if (isDashboard) {
  document.body.classList.add("dash-body");
  import("./Dashboard.jsx").then(({ default: Dashboard }) => {
    root.render(
      <React.StrictMode>
        <Dashboard />
      </React.StrictMode>
    );
  });
} else if (isStation) {
  import("./Station.jsx").then(({ default: StationApp }) => {
    root.render(
      <React.StrictMode>
        <StationApp />
      </React.StrictMode>
    );
  });
} else {
  import("./App.jsx").then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
