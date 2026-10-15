// ★ 2026-10-15: ช่องรหัสผ่านที่มีปุ่ม "ตา" กดดู/ซ่อนรหัสที่พิมพ์
// ใช้แทน <input type="password"> ทุกที่ (ล็อกอินออฟฟิศ · ล็อกอินหน้าเครื่อง · เปลี่ยนรหัสผ่าน · ฟอร์มพนักงาน)
import { useState, forwardRef } from "react";
import { getLang } from "./i18n-dom.js";

function EyeIcon({ open }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  );
}

// className = คลาสของช่อง input (เช่น "input" ของออฟฟิศ / "stn-input" ของหน้าเครื่อง)
const PasswordField = forwardRef(({ className = "", wrapClassName = "", ...props }, ref) => {
  const [show, setShow] = useState(false);
  const en = getLang() === "en";
  const label = show ? (en ? "Hide password" : "ซ่อนรหัสผ่าน") : (en ? "Show password" : "แสดงรหัสผ่าน");
  return (
    <span className={`pw-wrap ${wrapClassName}`}>
      <input {...props} ref={ref} type={show ? "text" : "password"} className={`${className} pw-input`}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)}
        aria-label={label} aria-pressed={show} title={label}>
        <EyeIcon open={show} />
      </button>
    </span>
  );
});

export default PasswordField;
