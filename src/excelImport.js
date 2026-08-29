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

// code ขึ้นต้น "SA" = เบอร์ซับ (sub-assembly) — ใช้แยกชั้นในฟอร์มแผง
function isSubAsmCode(code) { return /^\s*sa/i.test(String(code || "")); }

function parseHeaderMeta(rows) {
  const projectName = extractLabeled(rows, [/^\s*project/i, /โปรเจ/]);
  const releaseRaw = extractLabeled(rows, [/^\s*release/i, /ปล่อยงาน/]);
  const roMatch = String(releaseRaw).match(/P[-\s]?\d+/i);
  const releaseOrder = roMatch ? roMatch[0].replace(/\s/g, "").toUpperCase() : "";
  return { projectName, releaseOrder };
}

// รองรับ 2 ฟอร์ม:
//   • Sub Assembly (flat): Item | Code | Description | L | Quantity(แม่) | Quantity(ลูกรวม) | U.M.I
//   • Panel (nested):      Panel | Description | Quantity(แผง) | ... | Code | Description | L | ... | Quantity(ต่อแผง) | Sum(รวม)
//     - แถว Code ขึ้นต้น "SA" = เบอร์ซับ (ลูกตรงของแผง + เปิดกลุ่มซับ) · ลูกของซับ = แถวถัดไปที่ "description ว่าง"
//     - แถว description "มีข้อความ" = ลูกตรงของแผง (ปิดบริบทซับ)
// คืน { projectName, releaseOrder, groups:[{ parentKind, parentCode, parentDesc, parentLen, parentQty, children:[{code,desc,len,totalQty}] }] }
export async function parseSubAssemblyExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  return parseSubAssemblyRows(rows);
}

// แปลงข้อความ TSV (ก็อปจาก Excel, Ctrl+V) เป็นตาราง array-of-arrays
function tsvToRows(text) {
  return String(text || "").replace(/\r/g, "").split("\n").map((line) => line.split("\t"));
}

// วางจาก Excel: ก็อปทั้งตาราง (รวมแถวหัว Code/Quantity/Sum) แล้ววาง → parse เหมือนตอน import ไฟล์
export function parseSubAssemblyText(text) {
  return parseSubAssemblyRows(tsvToRows(text));
}

// core: parse ตาราง array-of-arrays → groups (ใช้ร่วมทั้งไฟล์และ paste)
function parseSubAssemblyRows(rows) {
  const { projectName, releaseOrder } = parseHeaderMeta(rows);

  // หาแถวหัวตาราง: ต้องมี Code + Quantity อย่างน้อย 1
  let headerRowIndex = -1, headerRow = null;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const hasCode = row.some((c) => matches(c, [/^code$/i, /เบอร์/]));
    const hasQty = row.some((c) => matches(c, [/quantity/i, /qty/i, /จำนวน/]));
    if (hasCode && hasQty) { headerRowIndex = r; headerRow = row; break; }
  }
  if (headerRowIndex === -1) throw new Error("หาหัวตาราง (Code / Quantity) ไม่เจอ — ก็อป/เลือกไฟล์ให้มีแถวหัวตาราง (Code, Quantity/Sum) มาด้วย");

  const codeCol = headerRow.findIndex((c) => matches(c, [/^code$/i, /เบอร์/]));
  const sumCol = headerRow.findIndex((c) => matches(c, [/^sum$/i, /รวม/]));
  const panelCol = headerRow.findIndex((c) => matches(c, [/^panel$/i]) && !matches(c, [/panel\s*no/i]));
  const qtyCols = []; headerRow.forEach((c, i) => { if (matches(c, [/quantity/i, /qty/i, /จำนวน/])) qtyCols.push(i); });
  const descCols = []; headerRow.forEach((c, i) => { if (matches(c, [/description/i, /รายละเอียด/])) descCols.push(i); });
  const lenCols = []; headerRow.forEach((c, i) => { if (matches(c, [/^l$/i, /length/i, /ความยาว/])) lenCols.push(i); });

  const body = rows.slice(headerRowIndex + 1);

  // ── ฟอร์มแผง (มีคอลัมน์ Panel + Sum) → parse แบบ nested ──
  if (panelCol !== -1 && sumCol !== -1) {
    const groups = parsePanelBody(body, { panelCol, codeCol, sumCol, qtyCols, descCols, lenCols });
    return { projectName, releaseOrder, groups };
  }

  // ── ฟอร์ม Sub Assembly (flat) ──
  const itemCol = headerRow.findIndex((c) => matches(c, [/^item$/i, /ลำดับ/]));
  const compDescCol = descCols[descCols.length - 1];
  const compLenCol = lenCols.find((i) => i > codeCol);
  const qtyParentCol = qtyCols[0];
  const qtyChildCol = qtyCols.length >= 2 ? qtyCols[1] : qtyCols[0];

  const groups = [];
  let cur = null, blankStreak = 0;
  for (const row of body) {
    const code = String(row[codeCol] ?? "").trim();
    const itemVal = itemCol !== -1 ? String(row[itemCol] ?? "").trim() : "";
    const qP = toNumber(row[qtyParentCol]);
    const qC = qtyChildCol !== undefined ? toNumber(row[qtyChildCol]) : null;
    if (!code) { if (++blankStreak >= 15) break; continue; }
    blankStreak = 0;
    const looksParent = (itemVal !== "" && itemVal !== "0") || (qP && qP > 0 && qtyParentCol !== qtyChildCol);
    if (looksParent) {
      cur = { parentKind: "subassembly", parentCode: code,
        parentDesc: compDescCol !== undefined ? String(row[compDescCol] ?? "").trim() : "",
        parentLen: compLenCol !== undefined ? toNumber(row[compLenCol]) : null,
        parentQty: qP && qP > 0 ? qP : 1, children: [] };
      groups.push(cur);
    } else if (cur) {
      const total = qC && qC > 0 ? qC : (qP && qP > 0 ? qP : null);
      if (!total) continue;
      cur.children.push({ code,
        desc: compDescCol !== undefined ? String(row[compDescCol] ?? "").trim() : "",
        len: compLenCol !== undefined ? toNumber(row[compLenCol]) : null, totalQty: total });
    }
  }
  const withChildren = groups.filter((g) => g.children.length > 0);
  if (withChildren.length === 0) throw new Error("ไม่พบกลุ่มเบอร์แม่–ลูก — ตรวจว่าแถวแม่มีเลข Item/จำนวน และแถวลูกมีจำนวน");
  return { projectName, releaseOrder, groups: withChildren };
}

// parse ตัวตารางฟอร์มแผง → หลายกลุ่ม (แผง 1 + ซับ N) · ใช้ Sum เป็น "จำนวนรวม" ของทุกแถว
function parsePanelBody(body, cols) {
  const { panelCol, codeCol, sumCol, qtyCols, descCols, lenCols } = cols;
  const panelDescCol = descCols.find((i) => i < codeCol);
  const panelQtyCol = qtyCols.find((i) => i < codeCol);
  const compDescCol = descCols.find((i) => i > codeCol);
  const compLenCol = lenCols.find((i) => i > codeCol);

  const groups = [];
  const panelByCode = new Map();
  let curPanel = null, curSA = null, blankStreak = 0;

  for (const row of body) {
    const panelCode = String(row[panelCol] ?? "").trim();
    const code = String(row[codeCol] ?? "").trim();
    const compDesc = compDescCol !== undefined ? String(row[compDescCol] ?? "").trim() : "";
    const compLen = compLenCol !== undefined ? toNumber(row[compLenCol]) : null;
    const sum = toNumber(row[sumCol]);
    const panelQty = panelQtyCol !== undefined ? toNumber(row[panelQtyCol]) : null;

    if (!code && !panelCode) { if (++blankStreak >= 15) break; continue; }
    blankStreak = 0;

    // เปลี่ยนแผง (panelCode ใหม่) → เปิด/สลับกลุ่มแผง
    if (panelCode && (!curPanel || curPanel.parentCode !== panelCode)) {
      if (panelByCode.has(panelCode)) curPanel = panelByCode.get(panelCode);
      else {
        curPanel = { parentKind: "panel", parentCode: panelCode,
          parentDesc: panelDescCol !== undefined ? String(row[panelDescCol] ?? "").trim() : "",
          parentLen: null, parentQty: panelQty && panelQty > 0 ? panelQty : 1, children: [] };
        groups.push(curPanel); panelByCode.set(panelCode, curPanel);
      }
      curSA = null;
    }
    if (!code || !curPanel) continue;
    const total = sum && sum > 0 ? sum : null;

    if (isSubAsmCode(code)) {
      if (total) curPanel.children.push({ code, desc: compDesc, len: compLen, totalQty: total });
      curSA = { parentKind: "subassembly", parentCode: code, parentDesc: compDesc, parentLen: compLen,
        parentQty: total && total > 0 ? total : 1, children: [] };
      groups.push(curSA);
    } else if (curSA && !compDesc) {
      if (total) curSA.children.push({ code, desc: compDesc, len: compLen, totalQty: total });
    } else {
      if (total) curPanel.children.push({ code, desc: compDesc, len: compLen, totalQty: total });
      curSA = null;   // ลูกที่มี description = ลูกตรงของแผง → ปิดบริบทซับ
    }
  }

  const withChildren = groups.filter((g) => g.children.length > 0);
  if (withChildren.length === 0) throw new Error("อ่านฟอร์มแผงไม่พบรายการ — ตรวจว่ามีคอลัมน์ Code/Sum และกรอกจำนวนใน Sum");
  return withChildren;
}

// ─── Import "release แผง" (form 2 — flat): Item | Panel No | Qty | Level | Remarks ─────
// คืน { projectName, releaseOrder, items:[{ code, qty }] } — เอาไป release เป็นแผง (kind=panel)
export async function parsePanelReleaseExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  return parsePanelReleaseRows(rows);
}

// วางจาก Excel: ก็อปตาราง (รวมหัว Panel No/Qty) แล้ววาง
export function parsePanelReleaseText(text) {
  return parsePanelReleaseRows(tsvToRows(text));
}

function parsePanelReleaseRows(rows) {
  const { projectName, releaseOrder } = parseHeaderMeta(rows);
  let headerRowIndex = -1, panelNoCol = -1, qtyCol = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const pIdx = row.findIndex((c) => matches(c, [/panel\s*no/i, /panel\s*number/i, /หมายเลขแผง/, /^panel$/i]));
    const qIdx = row.findIndex((c) => matches(c, [/^qty$/i, /quantity/i, /จำนวน/]));
    if (pIdx !== -1 && qIdx !== -1) { headerRowIndex = r; panelNoCol = pIdx; qtyCol = qIdx; break; }
  }
  if (headerRowIndex === -1) throw new Error("หาหัวตาราง (Panel No / Qty) ไม่เจอ — ก็อปให้มีแถวหัว (Panel No + Qty) มาด้วย");

  const items = [];
  let blankStreak = 0;
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const code = String(rows[r][panelNoCol] ?? "").trim();
    if (!code) { if (++blankStreak >= 15) break; continue; }
    blankStreak = 0;
    const qty = toNumber(rows[r][qtyCol]);
    if (!qty || qty <= 0) continue;
    items.push({ code, qty });
  }
  if (items.length === 0) throw new Error("ไม่พบรายชื่อแผง — ตรวจว่ากรอก Panel No + Qty ครบ");
  return { projectName, releaseOrder, items };
}
