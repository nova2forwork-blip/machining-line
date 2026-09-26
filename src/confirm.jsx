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
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";

// resolve ของการ์ดที่กำลังแสดงอยู่ (ทีละใบ) — แยกกันคนละ bundle ระหว่าง App/Station
let _pending = null;

// เรียกจากที่ไหนก็ได้ (ไม่ต้องส่ง props) — คืน Promise<boolean>
//   ★ รอบ 14: ส่ง choices: [{ value, label, tone?, primary? }] = ปุ่มหลายทางเลือก → คืน value ที่กด (ยกเลิก/Esc/คลิกนอกกรอบ = null)
//     Enter = ปุ่มที่ primary (ไม่มี = ปุ่มสุดท้าย) · cancelText = ปุ่มยกเลิก (ใส่ false = ไม่มีปุ่มยกเลิก)
export function askChoice(opts = {}) { return askConfirm({ ...opts, choices: opts.choices || [] }); }
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

  const isChoice = !!(cur && Array.isArray(cur.opts && cur.opts.choices));
  const no = () => (isChoice ? null : false);
  const primary = () => { const cs = (cur && cur.opts && cur.opts.choices) || []; const p = cs.find((c) => c.primary) || cs[cs.length - 1]; return p ? p.value : null; };
  const done = (result) => {
    if (_pending) { try { _pending(result); } catch { /* ignore */ } _pending = null; }
    setCur(null);
  };

  // Esc = ยกเลิก · Enter = ยืนยัน
  useEffect(() => {
    if (!cur) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(no()); }
      else if (e.key === "Enter") { e.preventDefault(); done(isChoice ? primary() : true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur]);

  if (!cur) return null;
  const o = cur.opts || {};
  const tone = o.tone || "default";
  return (
    <div className="mls-confirm-backdrop" onClick={() => done(no())}>
      <div className={`mls-confirm-card tone-${tone}${isChoice ? " is-choice" : ""}${o.wide ? " is-wide" : ""}`} role="dialog" aria-modal="true"
           onClick={(e) => e.stopPropagation()}>
        {o.title ? <div className="mls-confirm-title">{o.title}</div> : null}
        <div className="mls-confirm-msg">{o.message || ""}</div>
        {o.list && o.list.length ? (
          <ul className="mls-confirm-list">
            {o.list.map((it, i) => <li key={i}>{typeof it === "string" ? it : <><b>{it.head}</b>{it.text ? <span> — {it.text}</span> : null}</>}</li>)}
          </ul>
        ) : null}
        {o.foot ? <div className="mls-confirm-foot">{o.foot}</div> : null}
        {isChoice ? (
          <div className="mls-confirm-actions">
            {o.cancelText !== false && (
              <button type="button" className="mls-confirm-btn cancel" onClick={() => done(null)}>{o.cancelText || "ยกเลิก"}</button>
            )}
            {o.choices.map((c) => (
              <button key={String(c.value)} type="button" data-choice={String(c.value)}
                className={`mls-confirm-btn ${c.primary ? "ok" : "alt"} tone-${c.tone || tone}`} onClick={() => done(c.value)} autoFocus={!!c.primary}>
                {c.label}
              </button>
            ))}
          </div>
        ) : (
        <div className="mls-confirm-actions">
          <button type="button" className="mls-confirm-btn cancel" onClick={() => done(false)}>
            {o.cancelText || "ยกเลิก"}
          </button>
          <button type="button" className={`mls-confirm-btn ok tone-${tone}`} onClick={() => done(true)} autoFocus>
            {o.confirmText || "ตกลง"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// ★ รอบ 14: ช่องกรอกตัวเลขที่ใส่ "," หลักพันให้เอง (ใช้ร่วมกัน App + Station)
//   พิมพ์ 5400 → เห็น 5,400 ทันที (เคอร์เซอร์ไม่กระโดด) · ค่าที่ส่งให้ onChange = ไม่มีคอมมา ("5400")
//   ข้อความที่ไม่ใช่ตัวเลข (non-strict) แสดงตามที่พิมพ์ เพื่อให้ตัวตรวจในฟอร์มไฮไลต์แดงเอง
//   strict = รับเฉพาะตัวเลข (แทน type="number" ที่ใส่คอมมาไม่ได้) · allowNeg = ให้พิมพ์ติดลบได้
//   onChange ได้ event-like { target: { value } } — โค้ดเดิมที่ใช้ e.target.value ใช้ต่อได้เลย
// ═══════════════════════════════════════════════════════════════════════════
// ตัวเลขสำหรับแสดงผล: ใส่ , หลักพัน (1500 → "1,500") · ข้อความที่ไม่ใช่ตัวเลข / มีเลข 0 นำหน้า ("007") คืนตามเดิม · null → ""
export function nc(v, maxFrac = 2) {
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: maxFrac }) : String(v);
  if (typeof v === "string" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim())) return Number(v).toLocaleString("en-US", { maximumFractionDigits: maxFrac });
  return v == null ? "" : v;
}
const NUM_TXT_RE = /^-?[\d,]*\.?\d*$/;
export function groupNum(v) {
  const s = v == null ? "" : String(v);
  const t = s.trim();
  if (!t || !NUM_TXT_RE.test(t)) return s;
  const raw = t.replace(/,/g, "");
  const neg = raw.startsWith("-") ? "-" : "";
  const body = neg ? raw.slice(1) : raw;
  const dot = body.indexOf(".");
  const ip = dot >= 0 ? body.slice(0, dot) : body;
  const fp = dot >= 0 ? body.slice(dot) : "";
  return neg + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fp;
}
export const NumInput = forwardRef(function NumInput({ value, onChange, strict = false, allowNeg = false, inputMode, type: _type, min: _min, step: _step, ...rest }, ref) {
  const inner = useRef(null);
  const caret = useRef(null);            // จำนวนตัวอักษร (ไม่นับคอมมา) ก่อนเคอร์เซอร์ → วางกลับหลัง render
  const [, bump] = useState(0);
  const setRefs = (el) => { inner.current = el; if (typeof ref === "function") ref(el); else if (ref) ref.current = el; };
  useLayoutEffect(() => {
    const el = inner.current; const c = caret.current;
    caret.current = null;
    if (!el || c == null || document.activeElement !== el) return;
    const v = el.value; let pos = 0, seen = 0;
    while (pos < v.length && seen < c) { if (v[pos] !== ",") seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
  });
  function handle(e) {
    const el = e.target; const v = el.value;
    const p = el.selectionStart == null ? v.length : el.selectionStart;
    const before = v.slice(0, p).replace(/,/g, "").length;
    const raw = v.replace(/,/g, "");
    if (strict && !(allowNeg ? /^\s*-?\d*\.?\d*\s*$/ : /^\s*\d*\.?\d*\s*$/).test(raw)) {
      caret.current = Math.max(0, before - 1); bump((n) => n + 1);   // ไม่รับตัวอักษรนั้น · เคอร์เซอร์อยู่ที่เดิม
      return;
    }
    caret.current = before;
    if (onChange) onChange({ target: { value: raw, name: el.name, dataset: el.dataset }, currentTarget: { value: raw }, nativeEvent: e.nativeEvent, preventDefault() {}, stopPropagation() {} });
  }
  return <input {...rest} ref={setRefs} value={groupNum(value)} onChange={handle} inputMode={inputMode || "decimal"} autoComplete="off" />;
});
