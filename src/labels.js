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
  { value: "90x30", label: "9 × 3 ซม. (ป้ายแผง)", w: 90, h: 30 },   // ★ 2026-11-19 ป้ายแผงแบบของเราเอง: QR + ชื่อแผง · ADDR · โปรเจค
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
    showCode = false,   // ★ 2026-11-11 พิมพ์รหัส QR (ตัวอักษร) เป็นแถบเล็กใต้ป้าย — เดิมตัวเลือก "แสดงรหัสใต้ QR" มีผลแค่บนจอ
  } = opts;
  // มีแถบรหัส: เนื้อป้ายเดิมย่อเหลือ 84% ของความสูง (สัดส่วนเดิมทุกอย่าง) · อีก 16% ล่าง = บรรทัดรหัส · ขนาดป้ายรวมเท่าเดิม
  const fullH = heightMm;
  const codeH = showCode ? fullH * 0.16 : 0;
  const bodyH = fullH - codeH;

  // ขนาดสัมพัทธ์กับความสูงป้าย เพื่อให้ย่อ/ขยายป้ายแล้วสัดส่วนคงเดิม
  // ★ 2026-11-18 sim-test SIM4: ป้ายเกือบจัตุรัส (เช่น กำหนดเอง 20 × 20 มม.) — QR เต็มความสูง = กว้างกว่าที่ว่างในป้าย (หักขอบซ้าย-ขวา 1.4 มม.) → ถูกตัดขอบ สแกนไม่ออก
  //   ป้ายที่ไม่เหลือที่ให้ข้อความ (เหลือน้อยกว่า 8 มม.) = ป้าย "QR อย่างเดียว": QR ย่อให้พอดี เว้นขอบขาวรอบ 5% และอยู่กลางป้าย · ป้ายยาวตามปกติไม่เปลี่ยน
  const innerW = widthMm - 2.8;
  const qrOnly = innerW - bodyH < 8;
  const qrMm = (qrOnly ? Math.max(1, Math.min(bodyH, innerW) * 0.9) : bodyH).toFixed(2);
  const fSmall = (bodyH * 0.17).toFixed(2);
  const fProj = (bodyH * 0.17 * 1.3).toFixed(2);   // ★ 2026-10-12: เลขโปรเจค / ชื่อโปรเจค ใหญ่ขึ้น 30% (มีที่ว่างเหลือ)
  // ★ 2026-10-12: Part No. ใหญ่ขึ้น + ฐานตัวอักษรชิดขอบล่างของ QR (เดิม 0.27 × สูง ลอยกลาง)
  //   สคริปต์ย่อทีละนิดถ้าเบอร์ยาวจนล้นช่อง (ไม่ตัด "…")
  const fBig = (bodyH * 0.27 * 1.66).toFixed(2);   // ★ 2026-10-12: Part No. ใหญ่ขึ้น 66% จากเดิม (0.27 × สูง)
  // ★ 2026-10-12: ฝั่งขวา (MDF / REL / 1 OF 6) ย่อลง 15% → Part No. ได้ที่กว้างขึ้น
  const fMed = (bodyH * 0.23 * 0.85).toFixed(2);   // MDF NO. / REL NO.
  const fQty = fMed;
  const rowMm = (Math.max(Number(fMed), Number(fProj)) * 1.2).toFixed(2);     // ★ ระยะบรรทัดของ 2 แถวบน (ซ้าย/ขวาเท่ากัน → ตรงระดับกัน)                                   // 1 OF 6 — ★ ขนาดเท่า MDF NO. (เดิมเล็กไป มองไม่เห็น)

  // ★ 2026-11-19 ผู้ใช้: "ออกแบบ QR code ของเราเอง มี ชื่อแผง address ชื่อและรหัสโปรเจค" — ป้ายแผงแบบบล็อก (QR ซ้าย · ข้อความเรียง 4 บรรทัดทางขวา)
  //   ใช้เมื่อเป็นป้ายแผงรายใบ (รู้ที่อยู่ของแผงใบนั้น) และป้ายสูงพอ (≥ 20 มม.) และกว้างพอให้ข้อความ (เหลือ ≥ 25 มม. ข้าง QR) · ป้ายเตี้ย (7.6 × 1.2) ยังใช้แบบแถวเดียวเดิม
  //     บรรทัด 1 ชื่อแผง (ตัวใหญ่หนา)   2 ADDR: ที่อยู่   3 รหัสโปรเจค   4 ชื่อโปรเจค (ยาว = ย่อตัวอักษรให้พอดี)
  //     ★ ผู้ใช้ 2026-11-19: "เอาพวกนี้ออก ทั้งแผงกับกระจก" → ไม่มีบรรทัดเลขล็อต · ลำดับ · MDF แล้ว (เปิด "แสดงรหัสใต้ QR" = มีบรรทัดรหัส QR แทน)
  const blockOk = heightMm >= 20 && innerW - heightMm >= 25;
  const pbQr = (heightMm * 0.84).toFixed(2);
  // ★ 2026-11-19 ผู้ใช้: "ออกแบบให้สวยงามด้วย · ป้ายกระจก ADDR เอาออก"
  //   โครงเดียวกันทั้งป้ายแผงและป้ายกระจก (พิมพ์ขาว-ดำ): QR ซ้าย │ เส้นตั้ง │ ข้อความ 3 ชั้น คั่นด้วยเส้นบาง
  //     ชั้น 1  หัวเล็ก (PANEL / GLASS) + ชื่อตัวใหญ่หนา
  //     ชั้น 2  หัวเล็ก (ADDRESS / PANEL) + ค่า
  //     ชั้น 3  รหัสโปรเจคในแถบดำตัวขาว + ชื่อโปรเจค (ยาว = ย่อตัวอักษรให้พอดี)
  //   เปิด "แสดงรหัสใต้ QR" = มีบรรทัดรหัส QR เล็ก ๆ ต่อท้าย (ใช้แยกใบด้วยตา)
  const blockLabel = (u, L, svg, { cap1, name, cap2, value }) => `<div class="lbl pb">
      <div class="qr pbq">${svg}</div>
      <div class="pinfo">
        <div class="cap">${cap1}</div>
        <div class="p1">${escapeHtml(name || "")}</div>
        <div class="rule"></div>
        <div class="cap">${cap2}</div>
        <div class="pv">${escapeHtml(value || "-")}</div>
        <div class="rule"></div>
        <div class="pj">${L.projCode ? `<span class="chip">${escapeHtml(L.projCode)}</span>` : ""}<span class="pjn">${escapeHtml(L.projName || "")}</span></div>${showCode ? `
        <div class="pcode">${escapeHtml(u.qr_code || "")}</div>` : ""}
      </div>
    </div>`;
  const panelBlock = (u, L, svg) => blockLabel(u, L, svg, { cap1: "PANEL", name: L.partNo, cap2: "ADDRESS", value: L.addr });
  const glassBlock = (u, L, svg) => blockLabel(u, L, svg, { cap1: "GLASS", name: L.partNo, cap2: "PANEL", value: L.panelNo });
  const labelCells = units.map((u) => {
    const svg = getSvg(u);
    const L = u._label || {};
    if (L.panelNo && blockOk) return glassBlock(u, L, svg);
    if (L.addr && !L.panelNo && blockOk) return panelBlock(u, L, svg);
    return `<div class="lbl${showCode ? " wc" : ""}${qrOnly ? " qo" : ""}">${showCode ? '<div class="lrow">' : ""}
      <div class="qr">${svg}</div>
      <div class="body">
        <div class="col left">
          <div class="c num">${escapeHtml(L.projectNumber || "")}</div>
          <div class="c name">${escapeHtml(L.projectName || "")}</div>
          <div class="c part">${escapeHtml(L.partNo || "")}</div>
        </div>
        <div class="vline"></div>
        <div class="col right">
          <div class="kv">${L.panelNo
            /* ★ 2026-11-19 ป้ายกระจก: แบบแผง แทน MDF (ผู้ใช้: "ป้ายกระจก ADDR เอาออก" — ที่อยู่ยังผูกอยู่ใน QR ใช้ตรวจตอนสแกน) */
            ? `
            <span class="k">PANEL</span><span class="v">${escapeHtml(L.panelNo)}</span>
            <span class="k">REL NO.</span><span class="v">${escapeHtml(L.relNo || "-")}</span>`
            : L.addr
            /* ★ 2026-11-19 ป้ายแผง (รายใบ): ที่อยู่ของแผงใบนี้ แทนบรรทัด MDF (MDF ย้ายไปต่อท้ายรหัสโปรเจค) */
            ? `
            <span class="k">ADDR.</span><span class="v">${escapeHtml(L.addr)}</span>
            <span class="k">REL NO.</span><span class="v">${escapeHtml(L.relNo || "-")}</span>`
            : `
            <span class="k">MDF NO.</span><span class="v">${escapeHtml(L.mdfNo || "-")}</span>
            <span class="k">REL NO.</span><span class="v">${escapeHtml(L.relNo || "-")}</span>`}
          </div>
          <div class="c qty">${escapeHtml(L.qtyText || "")}</div>
        </div>
      </div>${showCode ? `</div><div class="lcode">${escapeHtml(u.qr_code || "")}</div>` : ""}
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
    .lbl.wc { flex-direction: column; align-items: stretch; gap: 0; }
    .lbl.wc .lrow { display: flex; align-items: center; gap: 1.5mm; height: ${bodyH.toFixed(2)}mm; min-height: 0; }
    .lcode { height: ${codeH.toFixed(2)}mm; line-height: ${codeH.toFixed(2)}mm; font-size: ${(codeH * 0.78).toFixed(2)}mm; font-family: 'Courier New', ui-monospace, monospace; font-weight: 700;
             letter-spacing: .02em; white-space: nowrap; overflow: hidden; color: #000; }
    .qr { width: ${qrMm}mm; height: ${qrMm}mm; flex-shrink: 0; }
    /* ป้ายแผง / ป้ายกระจก แบบบล็อก */
    .lbl.pb { gap: ${(heightMm * 0.07).toFixed(2)}mm; padding: 0 ${(heightMm * 0.07).toFixed(2)}mm; }
    .lbl.pb .qr.pbq { width: ${pbQr}mm; height: ${pbQr}mm; }
    .pinfo { flex: 1; min-width: 0; align-self: stretch; margin: ${(heightMm * 0.08).toFixed(2)}mm 0; padding-left: ${(heightMm * 0.07).toFixed(2)}mm; border-left: 0.3mm solid #000;
             display: flex; flex-direction: column; justify-content: center; color: #000; }
    .pinfo > div { white-space: nowrap; overflow: hidden; }
    .pinfo .cap { font-size: ${(heightMm * 0.062).toFixed(2)}mm; font-weight: 700; letter-spacing: .16em; line-height: 1.15; }
    .pinfo .p1 { font-size: ${(heightMm * 0.24).toFixed(2)}mm; font-weight: 800; letter-spacing: .01em; line-height: 1.02; }
    .pinfo .pv { font-size: ${(heightMm * 0.165).toFixed(2)}mm; font-weight: 700; line-height: 1.05; }
    .pinfo .rule { height: 0; border-top: 0.2mm solid #000; margin: ${(heightMm * 0.03).toFixed(2)}mm 0 ${(heightMm * 0.025).toFixed(2)}mm; flex-shrink: 0; }
    .pinfo .pj { display: flex; align-items: center; gap: 0.4em; font-size: ${(heightMm * 0.1).toFixed(2)}mm; }   /* รหัส + ชื่อโปรเจค ใช้ขนาดเดียวกัน (em) → ย่อพร้อมกันได้เมื่อชื่อยาว */
    .pinfo .chip { flex-shrink: 0; background: #000; color: #fff; font-size: 1em; font-weight: 800; letter-spacing: .02em; line-height: 1;
                   padding: 0.22em 0.4em; border-radius: 0.25em; }
    .pinfo .pjn { flex: 1; min-width: 0; font-size: 1em; font-weight: 600; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pinfo .pcode { font-size: ${(heightMm * 0.07).toFixed(2)}mm; font-family: 'Courier New', ui-monospace, monospace; font-weight: 700; margin-top: ${(heightMm * 0.02).toFixed(2)}mm; }
    .lbl.qo, .lbl.qo .lrow { justify-content: center; gap: 0; }
    .lbl.qo .body { display: none; }
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
    var els = document.querySelectorAll('.c.part, .pinfo .p1, .pinfo .pv, .pinfo .pcode');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], base = parseFloat(getComputedStyle(el).fontSize), f = base, n = 0;
      var lim = el.closest && el.closest('.pinfo') ? 0.3 : 0.45;   // ป้ายแบบบล็อก: ตัวอักษรเริ่มใหญ่กว่า จึงยอมให้ย่อได้มากกว่า · ชื่อแผง / กระจก ต้องครบเสมอ   // ป้ายแบบบล็อก: ตัวอักษรเริ่มใหญ่กว่า จึงยอมให้ย่อได้มากกว่า
      while (el.scrollWidth > el.clientWidth + 0.5 && f > base * lim && n < 60) { f *= 0.97; el.style.fontSize = f + 'px'; n++; }
    }
  }
  // แถวโปรเจค (รหัสในแถบดำ + ชื่อ): ชื่อยาวเกิน → ย่อทั้งแถวพร้อมกันได้ถึง 60% แล้วจึงตัดด้วย … (เล็กกว่านี้อ่านไม่ออก)
  function fitProject(){
    var rows = document.querySelectorAll('.pinfo .pj');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], nm = row.querySelector('.pjn'); if (!nm) continue;
      var base = parseFloat(getComputedStyle(row).fontSize), f = base, n = 0;
      while (nm.scrollWidth > nm.clientWidth + 0.5 && f > base * 0.6 && n < 40) { f *= 0.97; row.style.fontSize = f + 'px'; n++; }
    }
  }
  window.onload = function () {
    fitParts(); fitProject();
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
