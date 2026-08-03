import * as XLSX from "xlsx";

// ─── Import Release จากไฟล์ Excel ("Production Release Report") ────────────
// รูปแบบไฟล์ต้นแบบ: หัวเอกสารมี "Release Order:" กับ "Project:" แล้วตามด้วย
// ตารางที่มีคอลัมน์ Code / Total Qty / Length / Weight-per-metre / Material /
// Remark — 1 ไฟล์ = 1 ใบสั่งปล่อยงาน แต่มีได้หลาย Part (หลายแถว)
//
// หมายเหตุหน่วย: คอลัมน์ "Weight/M" ในไฟล์ต้นแบบคือ กก. ต่อ "เมตร" ไม่ใช่ต่อชิ้น
// จึงต้องคูณด้วยความยาว (แปลงมม. → ม.) เพื่อได้น้ำหนักต่อชิ้นก่อนบันทึกลง release
// (unit_weight ในระบบนี้หมายถึง กก./ชิ้นเสมอ)

const LABEL_ALIASES = {
  releaseOrder: [/release\s*order/i, /ใบสั่งปล่อยงาน/],
  project: [/project/i, /โปรเจค/],
};

const COLUMN_ALIASES = {
  code: [/code/i, /เบอร์พาท/],
  qty: [/qty/i, /q'?ty/i, /จำนวน/],
  length: [/length/i, /ความยาว/],
  weightPerM: [/weight/i, /น้ำหนัก/],
  material: [/material/i, /วัตถุดิบ/],
  remark: [/remark/i, /หมายเหตุ/],
};

function matches(value, patterns) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return patterns.some((re) => re.test(s));
}

// หาค่าที่อยู่ "ถัดจาก" label ในแถวเดียวกัน เช่น [B4:"Release Order:", C4:"P-012"]
function findLabeledValue(rows, patterns) {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      if (matches(row[i], patterns)) {
        for (let j = i + 1; j < row.length; j++) {
          const v = row[j];
          if (v !== undefined && v !== null && String(v).trim() !== "") {
            return String(v).trim();
          }
        }
      }
    }
  }
  return "";
}

// หาแถว header ของตาราง (แถวที่มีทั้ง Code และ Qty) แล้วคืนตำแหน่งคอลัมน์ + index แถว
function findHeaderRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const colMap = {};
    for (const [field, patterns] of Object.entries(COLUMN_ALIASES)) {
      const idx = row.findIndex((cell) => matches(cell, patterns));
      if (idx !== -1) colMap[field] = idx;
    }
    if (colMap.code !== undefined && colMap.qty !== undefined) {
      return { headerRowIndex: r, colMap };
    }
  }
  return null;
}

function toNumber(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

// file: a browser File object (from <input type="file">)
export async function parseReleaseExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });

  const releaseOrder = findLabeledValue(rows, LABEL_ALIASES.releaseOrder);
  const projectCode = findLabeledValue(rows, LABEL_ALIASES.project);

  const header = findHeaderRow(rows);
  if (!header) {
    throw new Error("หาหัวตาราง (คอลัมน์ Code / Qty) ในไฟล์ไม่เจอ — ตรวจสอบว่าเป็นไฟล์ฟอร์มที่ถูกต้อง");
  }
  const { headerRowIndex, colMap } = header;

  const items = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const code = String(row[colMap.code] ?? "").trim();
    if (!code) break; // จบตารางเมื่อคอลัมน์ Code ว่าง (กันแถว footer ที่เหลือ 0 ค้างอยู่)
    const qty = toNumber(row[colMap.qty]);
    if (!qty || qty <= 0) continue; // ข้ามแถวที่ไม่มีจำนวนจริง

    const length_mm = colMap.length !== undefined ? toNumber(row[colMap.length]) : null;
    const weightPerM = colMap.weightPerM !== undefined ? toNumber(row[colMap.weightPerM]) : null;
    const material = colMap.material !== undefined ? String(row[colMap.material] ?? "").trim() || null : null;
    const remark = colMap.remark !== undefined ? String(row[colMap.remark] ?? "").trim() || null : null;

    // น้ำหนัก/ชิ้น = (ความยาว มม. → ม.) × น้ำหนัก/เมตร
    const unit_weight = length_mm && weightPerM ? Number(((length_mm / 1000) * weightPerM).toFixed(4)) : null;

    items.push({ code, qty, length_mm, weightPerM, unit_weight, material, remark });
  }

  if (items.length === 0) {
    throw new Error("ไม่พบรายการ Part ในไฟล์ — ตรวจสอบว่ากรอกจำนวน (Qty) ไว้ครบ");
  }

  return { releaseOrder, projectCode, items };
}
