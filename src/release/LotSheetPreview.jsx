// ตัวอย่างใบปล่อย (PRODUCTION ORDER) ของล็อต — เห็นหน้ากระดาษก่อน แล้วโหลดได้ทั้ง Excel และ PDF (พิมพ์ → บันทึกเป็น PDF)
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { buildLotModel, lotSheetsHtml, downloadLotSheets } from "./lotSheetExport.js";
import "./release-wizard.css";

export default function LotSheetPreview({ args, onClose }) {
  const frame = useRef(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const model = useMemo(() => buildLotModel(args), [args]);
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
    try { await downloadLotSheets(args); } catch (e) { setErr("สร้าง Excel ไม่สำเร็จ: " + (e?.message || e)); } finally { setBusy(false); }
  }
  const n = model.sheets.length;
  return (
    <div className="lp-back" role="dialog" aria-modal="true" aria-label="ตัวอย่างใบปล่อย">
      <div className="lp-bar">
        <div className="lp-ttl"><b>{model.meta.ro}</b><span>ใบปล่อย · {model.meta.project} · {n} ใบงาน</span></div>
        <div className="lp-act">
          <button type="button" className="lp-btn" onClick={excel} disabled={busy}><Icon name="grid" size={15} /> {busy ? "กำลังสร้าง…" : "Excel"}</button>
          <button type="button" className="lp-btn pri" onClick={printPdf} disabled={!n}><Icon name="printer" size={15} /> พิมพ์ / PDF</button>
          <button type="button" className="lp-btn" onClick={onClose} aria-label="ปิด">ปิด ✕</button>
        </div>
        <div className="lp-hint">ปุ่ม <b>พิมพ์ / PDF</b> → ที่ปลายทางเลือก <b>“บันทึกเป็น PDF”</b> (Save as PDF) · ปุ่ม <b>Excel</b> โหลดไฟล์ .xlsx · แต่ละใบงานขึ้นหน้าใหม่{err ? <span className="lp-err"> · {err}</span> : null}</div>
      </div>
      <iframe ref={frame} className="lp-frame" title="ตัวอย่างใบปล่อย" srcDoc={html} />
    </div>
  );
}
