import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// ─── Route split: /station = machine terminal (หน้าเครื่อง) ──────────────
//    ทุก path อื่น = แอปปกติ (สำนักงาน)  ·  ทั้งสองใช้ Supabase/ฐานข้อมูลเดียวกัน
//    (vercel.json rewrite ทุก path → index.html อยู่แล้ว จึงไม่ต้องตั้ง route เพิ่ม)
const isStation = window.location.pathname.replace(/\/+$/, "").toLowerCase().startsWith("/station");

// ─── Service worker: แคช app shell ให้เปิดแอปได้แม้ไม่มีเน็ต ──────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* ไม่รองรับก็ข้ามไป */ });
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));

if (isStation) {
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
