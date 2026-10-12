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

// ★ 2026-10-12: แยกสร้าง HTML ออกมา (ใช้ทั้งพิมพ์จริง + ทำภาพตัวอย่าง) · getSvg(u) = SVG ของ QR
export function buildLabelsHtml(units, opts = {}, getSvg = (u) => collectQrSvg(u.id)) {
  const {
    widthMm = 76,
    heightMm = 12,
    mode = "sheet", // "sheet" (A4 grid) | "roll" (one label per page — thermal printers)
    title = "Part Labels",
  } = opts;

  // ขนาดสัมพัทธ์กับความสูงป้าย เพื่อให้ย่อ/ขยายป้ายแล้วสัดส่วนคงเดิม
  const qrMm = heightMm.toFixed(2);              // QR ใหญ่เต็มความสูงป้าย
  const fSmall = (heightMm * 0.17).toFixed(2);
  const fProj = (heightMm * 0.17 * 1.3).toFixed(2);   // ★ 2026-10-12: เลขโปรเจค / ชื่อโปรเจค ใหญ่ขึ้น 30% (มีที่ว่างเหลือ)
  // ★ 2026-10-12: Part No. ใหญ่ขึ้น + ฐานตัวอักษรชิดขอบล่างของ QR (เดิม 0.27 × สูง ลอยกลาง)
  //   สคริปต์ย่อทีละนิดถ้าเบอร์ยาวจนล้นช่อง (ไม่ตัด "…")
  const fBig = (heightMm * 0.27 * 1.66).toFixed(2);   // ★ 2026-10-12: Part No. ใหญ่ขึ้น 66% จากเดิม (0.27 × สูง)
  // ★ 2026-10-12: ฝั่งขวา (MDF / REL / 1 OF 6) ย่อลง 15% → Part No. ได้ที่กว้างขึ้น
  const fMed = (heightMm * 0.23 * 0.85).toFixed(2);   // MDF NO. / REL NO.
  const fQty = fMed;
  const rowMm = (Math.max(Number(fMed), Number(fProj)) * 1.2).toFixed(2);     // ★ ระยะบรรทัดของ 2 แถวบน (ซ้าย/ขวาเท่ากัน → ตรงระดับกัน)                                   // 1 OF 6 — ★ ขนาดเท่า MDF NO. (เดิมเล็กไป มองไม่เห็น)

  const labelCells = units.map((u) => {
    const svg = getSvg(u);
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
    /* ห้าม !important ทับ fill ทั้งหมด — เดิมทำให้ "พื้นหลัง QR ดำ" กลายเป็นกล่องดำทึบ
       QRCodeSVG วาดพื้นหลังขาว + โมดูลดำมาให้อยู่แล้ว จึงปล่อยตามค่าเดิม (ดำล้วนคมชัด) */
    .qr svg path[fill="#FFFFFF"], .qr svg rect[fill="#FFFFFF"] { fill: #fff; }
    .body {
      flex: 1; height: 100%; display: flex;
      gap: 1.2mm; align-items: center; min-width: 0;
    }
    /* ★ 2026-10-12: จัดเป็นตาราง 3 แถวร่วมกันทั้งซ้าย-ขวา (ให้คนงานอ่าน Part No. ได้ไกล + ดูเป็นระเบียบ)
         แถว 1: เลขโปรเจค   ↔ MDF NO.
         แถว 2: ชื่อโปรเจค   ↔ REL NO.        (สองแถวบนใช้ระยะบรรทัดเท่ากัน → อยู่ระดับเดียวกันพอดี)
         แถว 3: Part No.    ↔ 1 OF 6         (ฐานตัวอักษรชิดขอบล่าง QR ทั้งคู่) */
    .body .col { display: flex; flex-direction: column; min-width: 0; gap: 0; align-self: stretch; }
    .body .col.left { flex: 1; }
    .body .col.right { flex-shrink: 0; align-items: stretch; }
    /* เส้นแบ่งกลางระหว่างข้อมูลโปรเจค (ซ้าย) กับ MDF/REL (ขวา) */
    .vline { width: 0.2mm; align-self: stretch; margin: 0.3mm 0; background: #000; flex-shrink: 0; }
    .c { font-size: ${fSmall}mm; line-height: ${rowMm}mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #000; }
    .c.num, .c.name { font-size: ${fProj}mm; }
    .c.num { letter-spacing: .01em; }
    .c.part { font-size: ${fBig}mm; font-weight: 700; letter-spacing: 0; line-height: 1;
              margin-top: auto; margin-bottom: -0.13em; text-overflow: clip; }   /* -0.13em = ฐานตัวอักษรชิดขอบล่าง QR (Arial · เผื่อขอบโค้งของ 0/8) */
    /* MDF / REL: คอลัมน์ชื่อ (M,R) ตรงกัน · คอลัมน์ค่าตรงกัน · ระยะบรรทัดเท่าฝั่งซ้าย */
    .kv { display: grid; grid-template-columns: auto auto; column-gap: 0.8mm; row-gap: 0; align-items: baseline; }
    .kv .k, .kv .v { font-size: ${fMed}mm; line-height: ${rowMm}mm; white-space: nowrap; color: #000; }
    .kv .k { font-weight: 600; }
    .kv .v { font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
    .c.qty { font-size: ${fQty}mm; line-height: 1; margin-top: auto; margin-bottom: -0.13em; padding-top: 0.6mm;
             border-top: 0.2mm solid #000; font-weight: 700; text-align: right; }
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
  /* บังคับพิมพ์สีให้ตรงเป๊ะทุกองค์ประกอบ — กัน QR ขึ้น "เงาเทาซ้อน"/สีจาง
     เวลาเบราว์เซอร์พยายามประหยัดหมึก หรือ "Background graphics" ไม่ได้ติ๊ก */
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { background: #fff; }
  /* QR = ขาว-ดำล้วน ห้ามมีเงา/ฟิลเตอร์/โปร่งใส (กันเงาเทาซ้อน) */
  .qr, .qr svg, .qr svg * { box-shadow: none !important; filter: none !important; opacity: 1 !important; }
  ${labelCss}
  ${mode === "roll" ? rollCss : sheetCss}
</style>
</head><body>
<div class="grid">${labelCells}</div>
<script>
  // ปิดหน้าต่างนี้เองทั้งตอนกด "Save" และ "Cancel" — กันหน้าต่างพิมพ์ค้างซ้อนกัน
  var closed = false;
  function closeSelf(){ if (closed) return; closed = true; try { window.close(); } catch (e) {} }
  window.onafterprint = closeSelf;               // ยิงเมื่อปิดกล่องพิมพ์ (เซฟหรือยกเลิก)
  // ★ 2026-10-12: Part No. ยาวจนล้นช่อง → ย่อทีละ 3% จนพอดี (ไม่ต่ำกว่า 45% ของขนาดเริ่ม)
  function fitParts(){
    var els = document.querySelectorAll('.c.part');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], base = parseFloat(getComputedStyle(el).fontSize), f = base, n = 0;
      while (el.scrollWidth > el.clientWidth + 0.5 && f > base * 0.45 && n < 40) { f *= 0.97; el.style.fontSize = f + 'px'; n++; }
    }
  }
  window.onload = function () {
    fitParts();
    if (window.__noPrint) return;
    setTimeout(function () {
      window.print();                            // Chrome จะค้างตรงนี้จนกว่าจะปิดกล่อง
      setTimeout(closeSelf, 300);                // เผื่อ onafterprint ไม่ยิง (เช่นกด Cancel) → ปิดเอง
    }, 120);
  };
</script>
</body></html>`;
  return html;
}

export function printLabels(units, opts = {}) {
  if (!units || units.length === 0) return;
  const html = buildLabelsHtml(units, opts);
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
