// ─── แปลงข้อความที่ก็อปจาก Excel (TSV) เป็นตาราง — ใช้ร่วมทั้งหน้าเพิ่ม Release และนำเข้าเบอร์ประกอบ/แผง ───
// ★ 2026-10-09: รองรับเซลล์ที่ Excel ครอบด้วย "..." (เซลล์มีขึ้นบรรทัดใหม่/แท็บ/เครื่องหมาย " ข้างใน)
//   เดิม split ตรงๆ ด้วย \n → หัวตาราง 2 บรรทัด ("Sum⏎Quantity") แตกเป็นหลายแถว → หาคอลัมน์ Sum ไม่เจอ
//   → ตกไปอ่านเป็น "รายชื่อแผง" (ทุกแถวกลายเป็นแผงเปล่า ไม่มี BOM)
export function tsvToRows(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  const rows = []; let row = []; let cell = ""; let i = 0; let atStart = true;
  while (i < src.length) {
    const ch = src[i];
    if (atStart && ch === '"') {
      // เซลล์แบบมีเครื่องหมายคำพูด: อ่านจนเจอ " ปิด ("" = " หนึ่งตัว)
      let j = i + 1; let val = ""; let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { val += '"'; j += 2; continue; }
          closed = true; j++; break;
        }
        val += src[j]; j++;
      }
      // ปิดแล้วต้องตามด้วยแท็บ/ขึ้นบรรทัด/จบ — ไม่ใช่ = " อยู่กลางข้อความปกติ → อ่านแบบธรรมดา
      // ★ 2026-10-10: Excel ไม่มีทางใส่ "แท็บ" ไว้ในเซลล์ → ถ้าช่วงในคำพูดมีแท็บ = " ตัวเดียวที่ไม่มีคู่ (เช่น 6" ) อ่านแบบธรรมดา
      //   (เดิมกลืนหลายแถว/หลายคอลัมน์เข้าเป็นเซลล์เดียว → ยอดเพี้ยน + แถวหาย)
      if (closed && !val.includes("\t") && (j >= src.length || src[j] === "\t" || src[j] === "\n")) { cell = val; i = j; atStart = false; continue; }
    }
    if (ch === "\t") { row.push(cell); cell = ""; atStart = true; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; atStart = true; i++; continue; }
    cell += ch; atStart = false; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

