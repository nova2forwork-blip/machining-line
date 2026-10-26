// ตัวอย่างใบปล่อย (PRODUCTION ORDER) ของล็อต — เห็นหน้ากระดาษก่อน แล้วโหลดได้ทั้ง Excel และ PDF (พิมพ์ → บันทึกเป็น PDF)
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { buildLotModel, lotSheetsHtml, downloadLotSheets } from "./lotSheetExport.js";
import "./release-wizard.css";

const SEL_KEY = "mls-lot-sheet-pick";   // ใบที่เลือกล่าสุด (key ของใบ) · null = ทุกใบ
const kindTone = (k) => (k === "sub" ? "sub" : k === "panel" ? "panel" : k === "mat" ? "mat" : "part");

export default function LotSheetPreview({ args, onClose }) {
  const frame = useRef(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  // ★ เลือกใบที่จะพิมพ์/โหลด (2026-10-26) — จำที่เลือกล่าสุดไว้ในเครื่อง (เช่น ฝ่ายตัดพิมพ์แค่ MACHINING)
  const full = useMemo(() => buildLotModel(args), [args]);
  const keys = full.all.map((x) => x.key);
  const [sel, setSel] = useState(() => {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(SEL_KEY) || "null"); } catch { /* ignore */ }
    const s = Array.isArray(saved) ? keys.filter((k) => saved.includes(k)) : [];
    return s.length ? s : keys;
  });
  const choose = (next) => { setSel(next); try { localStorage.setItem(SEL_KEY, JSON.stringify(next.length === keys.length ? null : next)); } catch { /* ignore */ } };
  // ตอนเลือก "ทั้งหมด" อยู่ → กดใบไหน = เอาเฉพาะใบนั้น · หลังจากนั้นกด = เพิ่ม/เอาออกทีละใบ (เหลืออย่างน้อย 1)
  const toggle = (k) => {
    if (sel.length === keys.length && keys.length > 1) { choose([k]); return; }
    const next = sel.includes(k) ? sel.filter((x) => x !== k) : keys.filter((x) => sel.includes(x) || x === k); if (next.length) choose(next);
  };
  const only = sel.length === keys.length ? null : sel;
  const model = useMemo(() => buildLotModel({ ...args, only }), [args, only && only.join("|")]);   // eslint-disable-line react-hooks/exhaustive-deps
  const html = useMemo(() => {
    let logoUrl = ""; try { logoUrl = new URL(`${(import.meta.env && import.meta.env.BASE_URL) || "/"}brand/artclad-logo.png`, window.location.origin).href; } catch { /* ไม่มีโลโก้ก็ได้ */ }
    return lotSheetsHtml(model, { logoUrl });
  }, [model]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  function printPdf() {
    const w = frame.current && frame.current.contentWindow; if (!w) return;
    try { w.focus(); w.print(); } catch (e) { setErr("พิมพ์ไม่สำเร็จ: " + (e?.message || e)); }
  }
  async function excel() {
    setBusy(true); setErr("");
    try { await downloadLotSheets({ ...args, only }); } catch (e) { setErr("สร้าง Excel ไม่สำเร็จ: " + (e?.message || e)); } finally { setBusy(false); }
  }
  const n = model.sheets.length;
  return (
    <div className="lp-back" role="dialog" aria-modal="true" aria-label="ตัวอย่างใบปล่อย">
      <div className="lp-bar">
        <div className="lp-ttl"><b>{model.meta.ro}</b><span>ใบปล่อย · {model.meta.project} · เลือก {n}/{keys.length} ใบ</span></div>
        <div className="lp-act">
          <button type="button" className="lp-btn" onClick={excel} disabled={busy}><Icon name="grid" size={15} /> {busy ? "กำลังสร้าง…" : "Excel"}</button>
          <button type="button" className="lp-btn pri" onClick={printPdf} disabled={!n}><Icon name="printer" size={15} /> พิมพ์ / PDF</button>
          <button type="button" className="lp-btn" onClick={onClose} aria-label="ปิด">ปิด ✕</button>
        </div>
        <div className="lp-pick" role="group" aria-label="เลือกใบที่จะพิมพ์">
          <span className="lp-pick-lab">ใบที่จะพิมพ์ / โหลด:</span>
          <button type="button" className={`lp-chip all ${only ? "" : "on"}`} onClick={() => choose(keys)} aria-pressed={!only}>ทั้งหมด</button>
          {full.all.map((x) => { const on = sel.includes(x.key); return (
            <button key={x.key} type="button" className={`lp-chip ${kindTone(x.kind)} ${on ? "on" : ""}`} onClick={() => toggle(x.key)} aria-pressed={on} title={on && sel.length === 1 ? "ต้องเลือกอย่างน้อย 1 ใบ" : x.t1}>
              <span className="lp-box" aria-hidden="true">{on ? "✓" : ""}</span>{x.name}<small>{x.rows}</small>
            </button>); })}
        </div>
        <div className="lp-hint">ปุ่ม <b>พิมพ์ / PDF</b> → ที่ปลายทางเลือก <b>“บันทึกเป็น PDF”</b> (Save as PDF) · ปุ่ม <b>Excel</b> โหลดไฟล์ .xlsx · แต่ละใบงานขึ้นหน้าใหม่{err ? <span className="lp-err"> · {err}</span> : null}</div>
      </div>
      <iframe ref={frame} className="lp-frame" title="ตัวอย่างใบปล่อย" srcDoc={html} />
    </div>
  );
}
