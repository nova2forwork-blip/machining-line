// ─── QR label printing engine ────────────────────────────────────────────
// Renders labels at true physical size (mm), independent of screen DPI,
// using @page + CSS mm units so what prints matches the stated size
// exactly (default 2cm x 2cm) regardless of printer resolution.

export const LABEL_PRESETS = [
  { value: "20x20", label: "2 × 2 ซม. (มาตรฐาน)", w: 20, h: 20 },
  { value: "25x15", label: "2.5 × 1.5 ซม.", w: 25, h: 15 },
  { value: "30x20", label: "3 × 2 ซม.", w: 30, h: 20 },
  { value: "40x30", label: "4 × 3 ซม.", w: 40, h: 30 },
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
    widthMm = 20,
    heightMm = 20,
    showCode = false,
    mode = "sheet", // "sheet" (A4 grid) | "roll" (one label per page — thermal printers)
    title = "QR Labels",
  } = opts;

  if (!units || units.length === 0) return;

  const labelCells = units.map((u) => {
    const svg = collectQrSvg(u.id);
    return `<div class="lbl">
      <div class="qrbox">${svg}</div>
      ${showCode ? `<div class="code">${escapeHtml(u.qr_code)}</div>` : ""}
    </div>`;
  }).join("");

  const sheetCss = `
    @page { size: A4; margin: 10mm; }
    body { margin: 0; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, ${widthMm}mm);
      gap: 3mm;
      justify-content: start;
    }
    .lbl {
      width: ${widthMm}mm; height: ${heightMm}mm;
      border: 1px dashed #bbb;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      overflow: hidden; page-break-inside: avoid;
      padding: 1mm; box-sizing: border-box;
    }
  `;

  const rollCss = `
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    body { margin: 0; }
    .grid { display: block; }
    .lbl {
      width: ${widthMm}mm; height: ${heightMm}mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      overflow: hidden; page-break-after: always;
      box-sizing: border-box; padding: 0.5mm;
    }
    .lbl:last-child { page-break-after: auto; }
  `;

  const html = `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Mono', monospace; background:#fff; }
  ${mode === "roll" ? rollCss : sheetCss}
  .qrbox { width: 100%; flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
  .qrbox svg { width: 92%; height: 92%; display: block; }
  .code { font-size: 6.4pt; color: #111; text-align: center; line-height: 1.15; word-break: break-all; padding-top: 0.4mm; }
</style>
</head><body>
<div class="grid">${labelCells}</div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต popup แล้วลองใหม่"); return; }
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
