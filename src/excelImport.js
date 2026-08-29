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
  let blankStreak = 0;                    // นับแถว Code ว่างติดกัน — เยอะ = จบตารางจริง
  const END_AFTER_BLANKS = 15;            // ว่างติดกันเกินนี้ = ถือว่าจบ (กันวน footer ยาวๆ)
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const code = String(row[colMap.code] ?? "").trim();
    if (!code) {
      // แถว Code ว่าง = ข้ามไป (เผื่อเป็นแถวคั่นกลางตาราง) — ไม่หยุดทันที กัน Part หลังช่องว่างหาย
      // แต่ถ้าว่างติดกันหลายแถว ถือว่าจบตาราง (footer/ท้ายไฟล์) จึงหยุด
      if (++blankStreak >= END_AFTER_BLANKS) break;
      continue;
    }
    blankStreak = 0;
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

// ─── Import "Sub Assembly" release จาก Excel (โครงแม่–ลูก + BOM) ─────────────
// รูปแบบไฟล์: หัวมี PROJECT: / RELEASE: แล้วตารางคอลัมน์
//   Item | Code | Description | L | Quantity(แม่) | Quantity(ลูก) | U.M.I
// - แถว "แม่" = แถวที่มีเลข Item (คอลัมน์ Item) + จำนวนในคอลัมน์ Quantity แรก
// - แถว "ลูก" = ใต้แม่ · ไม่มี Item · มีจำนวนในคอลัมน์ Quantity ที่สอง (จำนวนรวมของทั้ง release)
// - แถวว่าง = คั่นกลุ่ม (แต่เลข Item เป็นตัวเริ่มกลุ่มใหม่อยู่แล้ว)
// คืน { projectName, releaseOrder, groups:[{ parentCode, parentDesc, parentLen, parentQty,
//        children:[{ code, desc, len, totalQty }] }] }

// ดึงค่าท้าย label ที่อาจอยู่ "ในเซลล์เดียวกัน" (เช่น "PROJECT: Barrington") หรือ "เซลล์ถัดไป"
function extractLabeled(rows, patterns) {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] ?? "");
      if (!cell.trim()) continue;
      if (patterns.some((re) => re.test(cell))) {
        // ในเซลล์เดียวกัน: ตัดข้อความหลัง ":" ออกมา
        const m = cell.split(/[:：]/);
        if (m.length > 1 && m.slice(1).join(":").trim()) return m.slice(1).join(":").trim();
        // ไม่มี → เอาเซลล์ถัดไปที่ไม่ว่าง
        for (let j = i + 1; j < row.length; j++) {
          const v = String(row[j] ?? "").trim();
          if (v) return v;
        }
      }
    }
  }
  return "";
}

const SUBASM_COLS = {
  item: [/^item$/i, /ลำดับ/],
  code: [/^code$/i, /เบอร์/],
  desc: [/description/i, /รายละเอียด/],
  length: [/^l$/i, /length/i, /ความยาว/],
};

export async function parseSubAssemblyExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });

  const projectName = extractLabeled(rows, [/^\s*project/i, /โปรเจ/]);
  const releaseRaw = extractLabeled(rows, [/^\s*release/i, /ปล่อยงาน/]);
  // ตัดเอาเฉพาะเลขที่ P-xxx จาก "P-076 (CARE PACKAGE)"
  const roMatch = String(releaseRaw).match(/P[-\s]?\d+/i);
  const releaseOrder = roMatch ? roMatch[0].replace(/\s/g, "").toUpperCase() : "";

  // หาแถวหัวตาราง: มีทั้ง Code และ (Quantity อย่างน้อย 1) — แล้วเก็บตำแหน่ง 2 คอลัมน์ Quantity
  let headerRowIndex = -1, colMap = null, qtyCols = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cm = {};
    for (const [field, pats] of Object.entries(SUBASM_COLS)) {
      const idx = row.findIndex((cell) => matches(cell, pats));
      if (idx !== -1) cm[field] = idx;
    }
    const qc = [];
    row.forEach((cell, i) => { if (matches(cell, [/quantity/i, /qty/i, /จำนวน/])) qc.push(i); });
    if (cm.code !== undefined && qc.length >= 1) {
      headerRowIndex = r; colMap = cm; qtyCols = qc; break;
    }
  }
  if (headerRowIndex === -1) {
    throw new Error("หาหัวตาราง (Code / Quantity) ในไฟล์ไม่เจอ — ตรวจสอบว่าเป็นฟอร์ม Sub Assembly ที่ถูกต้อง");
  }
  const qtyParentCol = qtyCols[0];
  const qtyChildCol = qtyCols.length >= 2 ? qtyCols[1] : qtyCols[0];
  const itemCol = colMap.item;               // อาจไม่มี → ใช้ "มีจำนวนแม่" เป็นตัวบอกแม่แทน
  const codeCol = colMap.code;
  const descCol = colMap.desc;
  const lenCol = colMap.length;

  const groups = [];
  let cur = null;
  let blankStreak = 0;
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const code = String(row[codeCol] ?? "").trim();
    const itemVal = itemCol !== undefined ? String(row[itemCol] ?? "").trim() : "";
    const qP = toNumber(row[qtyParentCol]);
    const qC = qtyChildCol !== undefined ? toNumber(row[qtyChildCol]) : null;

    if (!code) { if (++blankStreak >= 15) break; continue; }
    blankStreak = 0;

    // เป็น "แม่" ถ้ามีเลข Item หรือมีจำนวนในคอลัมน์แม่ (และไม่มีในคอลัมน์ลูก)
    const looksParent = (itemVal !== "" && itemVal !== "0") || (qP && qP > 0 && qtyParentCol !== qtyChildCol);
    if (looksParent) {
      cur = {
        parentCode: code,
        parentDesc: descCol !== undefined ? String(row[descCol] ?? "").trim() : "",
        parentLen: lenCol !== undefined ? toNumber(row[lenCol]) : null,
        parentQty: qP && qP > 0 ? qP : 1,
        children: [],
      };
      groups.push(cur);
    } else if (cur) {
      const total = qC && qC > 0 ? qC : (qP && qP > 0 ? qP : null);
      if (!total) continue;                         // แถวลูกที่ไม่มีจำนวน → ข้าม
      cur.children.push({
        code,
        desc: descCol !== undefined ? String(row[descCol] ?? "").trim() : "",
        len: lenCol !== undefined ? toNumber(row[lenCol]) : null,
        totalQty: total,
      });
    }
  }

  const withChildren = groups.filter((g) => g.children.length > 0);
  if (withChildren.length === 0) {
    throw new Error("ไม่พบกลุ่มเบอร์แม่–ลูกในไฟล์ — ตรวจสอบว่าแถวแม่มีเลข Item และแถวลูกมีจำนวน");
  }
  return { projectName, releaseOrder, groups: withChildren };
}
