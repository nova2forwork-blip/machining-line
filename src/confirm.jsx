// confirm.jsx — การ์ดยืนยันในแอป (แทน window.confirm) แบบ promise-based
// ใช้ร่วมกันทั้งหน้าสำนักงาน (App.jsx) และหน้าเครื่อง/ประกอบ/แพ็ก (Station.jsx)
//
// วิธีใช้:
//   const ok = await askConfirm({ message: "...", tone: "danger", confirmText: "ลบ", cancelText: "ยกเลิก" });
//   if (!ok) return;
//
// เหตุผลที่เลิกใช้ native window.confirm:
//   • หน้าจอ terminal/kiosk แบบเต็มจอ/PWA บางเบราว์เซอร์บล็อก window.confirm (เด้งไม่ขึ้น = งานค้าง)
//   • หน้าตา native ไม่เข้ากับธีมแอป และปุ่มเล็กเกินสำหรับจอสัมผัส
//
// mount <ConfirmHost /> ครั้งเดียวที่รากของแต่ละหน้า (App.jsx, Station.jsx) ก็พอ
import { useEffect, useState } from "react";

// resolve ของการ์ดที่กำลังแสดงอยู่ (ทีละใบ) — แยกกันคนละ bundle ระหว่าง App/Station
let _pending = null;

// เรียกจากที่ไหนก็ได้ (ไม่ต้องส่ง props) — คืน Promise<boolean>
export function askConfirm(opts = {}) {
  return new Promise((resolve) => {
    try {
      window.dispatchEvent(new CustomEvent("mls-confirm", { detail: { opts, resolve } }));
    } catch {
      resolve(false); // ไม่มี window (SSR) → ถือว่าไม่ยืนยัน
    }
  });
}

export function ConfirmHost() {
  const [cur, setCur] = useState(null); // { opts, resolve } | null

  useEffect(() => {
    const on = (e) => {
      // ถ้ามีการ์ดค้างอยู่ ให้ตอบ false ให้ตัวเก่าก่อน (กันสัญญาค้าง)
      if (_pending) { try { _pending(false); } catch { /* ignore */ } }
      _pending = e.detail.resolve;
      setCur(e.detail);
    };
    window.addEventListener("mls-confirm", on);
    return () => window.removeEventListener("mls-confirm", on);
  }, []);

  const done = (result) => {
    if (_pending) { try { _pending(result); } catch { /* ignore */ } _pending = null; }
    setCur(null);
  };

  // Esc = ยกเลิก · Enter = ยืนยัน
  useEffect(() => {
    if (!cur) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      else if (e.key === "Enter") { e.preventDefault(); done(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur]);

  if (!cur) return null;
  const o = cur.opts || {};
  const tone = o.tone || "default";
  return (
    <div className="mls-confirm-backdrop" onClick={() => done(false)}>
      <div className={`mls-confirm-card tone-${tone}`} role="dialog" aria-modal="true"
           onClick={(e) => e.stopPropagation()}>
        {o.title ? <div className="mls-confirm-title">{o.title}</div> : null}
        <div className="mls-confirm-msg">{o.message || ""}</div>
        <div className="mls-confirm-actions">
          <button type="button" className="mls-confirm-btn cancel" onClick={() => done(false)}>
            {o.cancelText || "ยกเลิก"}
          </button>
          <button type="button" className={`mls-confirm-btn ok tone-${tone}`} onClick={() => done(true)} autoFocus>
            {o.confirmText || "ตกลง"}
          </button>
        </div>
      </div>
    </div>
  );
}
