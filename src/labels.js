// ─── QR / Part label printing engine ──────────────────────────────────────
// Renders "PART LABEL" at true physical size (mm) using @page + CSS mm units,
// so the print matches the stated size exactly regardless of printer DPI.
// Layout ตามสเปก: ป้าย 76 × 12 มม., QR 10 มม. ทางซ้าย, ข้อความ Arial (2/3 มม.)
//   [QR] | PROJECT NUMBER      MDF NO. -
//        | PROJECT NAME        REL NO. P-001 (L01-L04)
//        | PART NUMBER (ใหญ่)              1 OF 100

export const LABEL_PRESETS = [
  { value: "76x12", label: "7.6 × 1.2 ซม. (Part Label)", w: 76, h: 12 },
  { value: "60x10", label: "6 × 1 ซม.", w: 60, h: 10 },
  { value: "90x15", label: "9 × 1.5 ซม.", w: 90, h: 15 },
  { value: "custom", label: "กำหนดเอง (มม.)", w: null, h: null },
];

// Collect the outerHTML of hidden, pre-rendered <QRCodeSVG id="pq-{id}">
// elements so the print document doesn't need React at all.
function collectQrSvg(unitId) {
  const el = document.getElementById(`pq-${unitId}`);
  return el ? el.outerHTML : "";
}

export function printLabels(units, opts = {}) {
  const {
    widthMm = 76,
    heightMm = 12,
    mode = "sheet", // "sheet" (A4 grid) | "roll" (one label per page — thermal printers)
    title = "Part Labels",
  } = opts;

  if (!units || units.length === 0) return;

  // ขนาดสัมพัทธ์กับความสูงป้าย เพื่อให้ย่อ/ขยายป้ายแล้วสัดส่วนคงเดิม
  const qrMm = heightMm.toFixed(2);              // QR ใหญ่เต็มความสูงป้าย
  const fSmall = (heightMm * 0.17).toFixed(2);
  const fBig = (heightMm * 0.27).toFixed(2);
  const fMed = (heightMm * 0.23).toFixed(2);     // MDF NO. / REL NO. ให้ใหญ่ขึ้น

  const labelCells = units.map((u) => {
    const svg = collectQrSvg(u.id);
    const L = u._label || {};
    return `<div class="lbl">
      <div class="qr">${svg}</div>
      <div class="body">
        <div class="col left">
          <div class="c num">${escapeHtml(L.projectNumber || "")}</div>
          <div class="c name">${escapeHtml(L.projectName || "")}</div>
          <div class="c part">${escapeHtml(L.partNo || "")}</div>
        </div>
        <div class="vline"></div>
        <div class="col right">
          <div class="kv">
            <span class="k">MDF NO.</span><span class="v">${escapeHtml(L.mdfNo || "-")}</span>
            <span class="k">REL NO.</span><span class="v">${escapeHtml(L.relNo || "-")}</span>
          </div>
          <div class="c qty">${escapeHtml(L.qtyText || "")}</div>
        </div>
      </div>
    </div>`;
  }).join("");

  const labelCss = `
    .lbl {
      width: ${widthMm}mm; height: ${heightMm}mm;
      display: flex; align-items: center; gap: 1.5mm;
      padding: 0 1.4mm; box-sizing: border-box; overflow: hidden;
      font-family: Arial, 'Helvetica Neue', sans-serif; color: #000;
      page-break-inside: avoid;
    }
    .qr { width: ${qrMm}mm; height: ${qrMm}mm; flex-shrink: 0; }
    .qr svg { width: 100%; height: 100%; display: block; shape-rendering: crispEdges; }
    .qr svg rect, .qr svg path { fill: #000 !important; }
    .body {
      flex: 1; height: 100%; display: flex;
      gap: 2mm; align-items: center; min-width: 0;
    }
    .body .col { display: flex; flex-direction: column; justify-content: center; min-width: 0; gap: 0.35mm; }
    .body .col.left { flex: 1; }
    .body .col.right { text-align: left; align-items: flex-end; flex-shrink: 0; }
    /* เส้นแบ่งกลางระหว่างข้อมูลโปรเจค (ซ้าย) กับ MDF/REL (ขวา) */
    .vline { width: 0.2mm; align-self: stretch; margin: 1.4mm 0; background: #000; flex-shrink: 0; }
    .c { font-size: ${fSmall}mm; line-height: 1.18; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #000; }
    .c.num { letter-spacing: .01em; }
    .c.part { font-size: ${fBig}mm; font-weight: 700; letter-spacing: .02em; margin-top: 0.5mm; }
    /* ตาราง MDF/REL: คอลัมน์ชื่อ (M,R) ตรงกัน · คอลัมน์ค่าตรงกัน — ใหญ่ขึ้น + ดำล้วน */
    .kv { display: grid; grid-template-columns: auto auto; column-gap: 1mm; row-gap: 0.3mm; align-items: baseline; }
    .kv .k { font-size: ${fMed}mm; line-height: 1.18; white-space: nowrap; color: #000; font-weight: 600; }
    .kv .v { font-size: ${fMed}mm; line-height: 1.18; white-space: nowrap; font-weight: 700; color: #000; overflow: hidden; text-overflow: ellipsis; }
    .c.qty { margin-top: 0.6mm; padding-top: 0.5mm; border-top: 0.2mm solid #000; font-weight: 700; align-self: stretch; text-align: right; }
  `;

  const sheetCss = `
    @page { size: A4; margin: 8mm; }
    body { margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, ${widthMm}mm); gap: 3mm; justify-content: start; }
  `;
  // 1 ป้าย/หน้า · ขนาดป้ายจริง + เผื่อขอบ 1 มม. รอบด้าน (กันกรอบ/มุมมนโดนตัดตอนพิมพ์)
  // ป้ายถัดไปขึ้นหน้าใหม่ · ตั้ง Scale=100% + Margins=None ในกล่องพิมพ์
  const pad = 1;                                  // มม. เผื่อขอบกันโดนตัด
  const pageW = (widthMm + pad * 2).toFixed(2);
  const pageH = (heightMm + pad * 2).toFixed(2);
  const rollCss = `
    @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; width: ${pageW}mm; background: #fff; }
    .grid { display: block; margin: 0; padding: 0; width: ${pageW}mm; }
    .lbl {
      width: ${widthMm}mm; height: ${heightMm}mm; margin: ${pad}mm auto;
      page-break-after: always; break-after: page; page-break-inside: avoid;
    }
    .lbl:last-child { page-break-after: auto; break-after: auto; }
  `;

  const html = `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { background: #fff; }
  ${labelCss}
  ${mode === "roll" ? rollCss : sheetCss}
</style>
</head><body>
<div class="grid">${labelCells}</div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank", "width=1000,height=700");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต popup แล้วลองใหม่"); return; }
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
