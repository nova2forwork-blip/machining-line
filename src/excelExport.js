// ─── ดาวน์โหลดรายงานเป็นไฟล์ Excel (.xlsx) แบบมีสไตล์ ด้วย ExcelJS ───────────
// โหลด exceljs เฉพาะตอนกดปุ่ม (dynamic import) จาก build เบราว์เซอร์สำเร็จรูป
// (exceljs/dist/exceljs.min.js) เพื่อเลี่ยงปัญหา Node stream ตอน bundle และไม่ให้
// ก้อน exceljs ถ่วงตอนโหลดหน้าแรก
//
// sheets = [{ name, rows }] · rows = array ของ object (คีย์ = หัวคอลัมน์)
// ดีไซน์: หัวตารางสีพื้น+ตัวหนา · เส้นขอบบาง · ตรึงหัวตาราง · autofilter ·
//         ตัวเลขมีคอมมา จัดชิดขวา · แถวคู่แต้มสีจาง (zebra) — สวยแบบมินิมอล

// ── โทนสี (ARGB — ตัวหน้า FF = ทึบ) ──
const C = {
  headBg: "FF1E293B", // slate-800 พื้นหัวตาราง
  headFg: "FFFFFFFF", // ตัวอักษรหัว (ขาว)
  bodyFg: "FF0F172A", // ตัวอักษรเนื้อ (~ดำ)
  zebra: "FFF8FAFC",  // แถวคู่ (จาง)
  border: "FFE2E8F0", // เส้นขอบ (เทาอ่อน)
};

// เลือก object ExcelJS จริงจากรูปแบบ import ที่ต่างกัน (ESM interop / UMD / global)
function pickExcelJS(mod) {
  if (mod && mod.Workbook) return mod;
  if (mod && mod.default && mod.default.Workbook) return mod.default;
  if (typeof window !== "undefined" && window.ExcelJS) return window.ExcelJS;
  return (mod && mod.default) || mod;
}

// ชื่อชีต Excel: จำกัด 31 ตัวอักษร + ห้าม \ / ? * [ ] : + กันชื่อซ้ำ
function safeSheetName(name, used) {
  let clean = String(name || "Sheet").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  if (used.has(clean)) {
    const base = clean.slice(0, 27);
    let i = 2;
    while (used.has(`${base} (${i})`)) i++;
    clean = `${base} (${i})`;
  }
  used.add(clean);
  return clean;
}

// ชนิดคอลัมน์: int (จำนวนเต็ม) / dec (ทศนิยม 2) / text — ใช้เลือก numFmt + การจัดวาง
function colKinds(headers, rows) {
  return headers.map((h) => {
    const decimal = /กก\.|วินาที\/ชิ้น|เฉลี่ย/.test(h);
    let anyNum = false, anyText = false;
    for (const r of rows) {
      const v = r[h];
      if (typeof v === "number" && Number.isFinite(v)) anyNum = true;
      else if (v !== "" && v != null) anyText = true;
    }
    if (anyNum && !anyText) return decimal ? "dec" : "int";
    return "text";
  });
}

// ความกว้างคอลัมน์ ≈ จำนวนตัวอักษรที่ยาวสุด (หัว/ค่า) + ระยะหายใจ · clamp 9–44
function colWidth(header, rows) {
  let max = String(header).length;
  for (const r of rows) {
    const v = r[header];
    const s = v == null ? "" : String(v);
    if (s.length > max) max = s.length;
  }
  return Math.min(Math.max(max + 2, 9), 44);
}

// เขียนค่า + จัดสไตล์ทั้งชีต (หัว + เนื้อ)
function styleWorksheet(ws, headers, rows, kinds) {
  const thin = { style: "thin", color: { argb: C.border } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  // แถวหัว (row 1)
  const hr = ws.getRow(1);
  hr.height = 22;
  headers.forEach((h, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: C.headFg }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headBg } };
    cell.alignment = { vertical: "middle", horizontal: kinds[i] === "text" ? "left" : "right" };
    cell.border = border;
  });

  // แถวเนื้อ (row 2..n)
  for (let i = 0; i < rows.length; i++) {
    const row = ws.getRow(i + 2);
    const zebra = i % 2 === 1;
    headers.forEach((h, ci) => {
      const cell = row.getCell(ci + 1);
      const v = rows[i][h];
      cell.value = v === "" || v == null ? null : v;
      cell.font = { color: { argb: C.bodyFg }, size: 10.5 };
      cell.border = border;
      const kind = kinds[ci];
      if (kind === "int") cell.numFmt = "#,##0";
      else if (kind === "dec") cell.numFmt = "#,##0.00";
      cell.alignment = { horizontal: kind === "text" ? "left" : "right", vertical: "middle" };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.zebra } };
    });
  }

  // ความกว้าง + ตรึงหัว + autofilter
  headers.forEach((h, i) => { ws.getColumn(i + 1).width = colWidth(h, rows); });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (rows.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  }
}

export async function downloadSheets(filename, sheets) {
  const ExcelJS = pickExcelJS(await import("exceljs/dist/exceljs.min.js"));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Machining Line System";
  wb.created = new Date();

  const used = new Set();
  const list = (sheets && sheets.length) ? sheets : [{ name: "Sheet1", rows: [] }];
  for (const s of list) {
    const rows = s && Array.isArray(s.rows) ? s.rows : [];
    const ws = wb.addWorksheet(safeSheetName(s && s.name, used));
    if (!rows.length) {
      ws.getCell("A1").value = "(ไม่มีข้อมูลในช่วงนี้)";
      ws.getCell("A1").font = { italic: true, color: { argb: "FF64748B" } };
      ws.getColumn(1).width = 30;
      continue;
    }
    const headers = Object.keys(rows[0]);
    styleWorksheet(ws, headers, rows, colKinds(headers, rows));
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// ปัดทศนิยม 2 ตำแหน่ง (กก./เฉลี่ย) — คงไว้เผื่อที่อื่นเรียกใช้
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
