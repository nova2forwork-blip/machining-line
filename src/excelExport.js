import * as XLSX from "xlsx";

// ─── ดาวน์โหลดรายงานเป็นไฟล์ Excel (.xlsx) ────────────────────────────────
// โหลดไลบรารี xlsx เฉพาะตอนกดปุ่ม (dynamic import) เหมือน excelImport.js
// เพื่อไม่ให้ก้อน xlsx ถ่วงตอนโหลดหน้าแรก
//
// sheets = [{ name, rows }] · rows = array ของ object (คีย์ = หัวคอลัมน์)
// ชีตที่ไม่มีข้อมูลจะใส่หมายเหตุแทน (กันไฟล์เพี้ยน)
export function downloadSheets(filename, sheets) {
  const wb = XLSX.utils.book_new();
  let any = false;
  for (const s of sheets || []) {
    const rows = s && Array.isArray(s.rows) ? s.rows : [];
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["(ไม่มีข้อมูลในช่วงนี้)"]]);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s?.name || "Sheet"));
    if (rows.length) any = true;
  }
  if (!any && (!sheets || sheets.length === 0)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["(ไม่มีข้อมูล)"]]), "Sheet1");
  }
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// ชื่อชีต Excel: จำกัด 31 ตัวอักษร + ห้ามอักขระ \ / ? * [ ] :
function safeSheetName(name) {
  const clean = String(name || "Sheet").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return clean || "Sheet";
}

// ปัดทศนิยม 2 ตำแหน่งสำหรับตัวเลขในไฟล์ (กก./เฉลี่ย)
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
