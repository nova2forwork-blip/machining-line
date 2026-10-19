// ใบปล่อย (PRODUCTION ORDER) ของ 1 ล็อต → Excel · 1 ชีต ต่อ 1 ใบงาน — หน้าตาตามใบ Excel เดิมของออฟฟิศ
//   หัวใบ: โลโก้ · PRODUCTION ORDER · RPT/REV · Release Order / Project / Print date / Prepared by · ตาราง (ไม่มีช่องเซ็น)
//   ชีต: MACHINING PART / BENDING / STEEL · SUB-ASSEMBLY (พับ/เชื่อม/ยิง/Site Item) · ASSEMBLY (แผง) · GLASS · ACCESSORIES
//   ใช้ ExcelJS (โหลดตอนกดปุ่มเท่านั้น) · buildLotWorkbook รับ ExcelJS เข้ามา → ทดสอบใน node ได้
import { NC, SHEETS, isStar, addrsFromNote, findKey } from "./releaseCore.js";

// หัวกลางของแต่ละใบ: [บรรทัดอังกฤษ, บรรทัดไทย]
const TITLES = {
  CUTTING: ["CUTTING MACHINING & WELDING", "งานตัดและเชื่อม"],
  BENDING: ["BENDING MACHINING & WELDING", "งานพับและเชื่อม"],
  STEEL: ["STEEL PART", "งานเหล็ก"],
  พับ: ["SUB-ASSEMBLY (งานพับ)", ""],
  เชื่อม: ["SUB-ASSEMBLY (งานเชื่อม)", ""],
  ยิง: ["SUB-ASSEMBLY (งานยิงประกอบ)", ""],
  "Site Item": ["SUB-ASSEMBLY (Loose Parts)", ""],
  panel: ["ASSEMBLY (แผง)", "ประกอบแผง · 1 QR ต่อที่อยู่"],
  GLASS: ["GLASS", "รายการวัสดุกระจก"],
  FIXING: ["ACCESSORIES", "FASTENER, GASKET & SILICONE"],
};
const BLACK = { argb: "FF000000" }, GREY = { argb: "FF8C8C8C" }, RED = { argb: "FFC00000" };
const THIN = { style: "thin", color: BLACK };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const FONT = "Tahoma";

const fmtDate = (d) => { try { return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; } catch { return ""; } };
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? "" : Math.round(Number(v) * 100) / 100);

// ใบงานของแถวที่ปล่อย (อ่านจากหมายเหตุ "ใบ: …" เหมือนหน้าล็อต)
export function lotRowSheets(r, need) {
  const m = /ใบ:\s*(.+?)(?:\s*·|$)/.exec(r.note || "");
  if (r.kind === "panel") return ["panel"];
  if (m) return m[1].split(/\s*,\s*/).map((l) => (SHEETS.find((s) => s.label === l || s.k === l) || {}).k || l);
  return r.kind === "subassembly" ? (need.subs.find((s) => NC(s.code) === NC(r.code))?.procs || []) : [need.parts.find((p) => NC(p.code) === NC(r.code))?.dest || "CUTTING"];
}

// ลูกของซับ (ตาม BOM): พาร์ท / ซับย่อย / สกรู-ยาง
function subKids(plan, code) {
  const bom = plan.bom || {}; const sk = findKey(bom.subs, code); if (!sk) return [];
  const out = [];
  for (const it of bom.subs[sk].items || []) {
    if ((it[4] || "") === "ยกเลิก") continue;
    const [t, c, q] = it; if (!c || !(q > 0)) continue;
    const isSub = t === "sub";
    const d = (isSub ? bom.subs[findKey(bom.subs, c)] : bom.parts[findKey(bom.parts, c)]) || {};
    out.push({ code: c, d: d.d || "", l: d.l ?? null, q, uom: isSub ? "SET" : d.k === "hw" ? d.u || "pcs." : "pcs." });
  }
  return out;
}

// คอลัมน์: { en, th, w, key? }  ·  group = หัวรวมเหนือคอลัมน์ว่าง (PRODUCTION QTY / DATE)
const PROD = (n) => Array.from({ length: n }, () => ({ en: "", th: "", w: 8, blank: true }));
function columnsFor(sheet) {
  if (sheet.k === "panel") return { cols: [{ en: "NO.", th: "ลำดับ", w: 7 }, { en: "UNIT", th: "แผง", w: 22 }, { en: "ADDRESS", th: "ที่อยู่", w: 26 }, { en: "QTY", th: "จำนวน", w: 9 }, { en: "REMARK", th: "หมายเหตุ", w: 46 }] };
  if (sheet.kind === "sub") return { cols: [{ en: "ITEM", th: "", w: 7 }, { en: "CODE", th: "", w: 18 }, { en: "DESCRIPTION", th: "", w: 46 }, { en: "LENGTH (mm.)", th: "", w: 12 }, { en: "SUB QTY.", th: "", w: 9 }, { en: "QTY OF PART/SUB", th: "", w: 12, grey: true }, { en: "PART QTY.", th: "", w: 10 }, { en: "UOM", th: "", w: 8 }, { en: "Remark", th: "", w: 26 }] };
  if (sheet.k === "GLASS") return { cols: [{ en: "NO.", th: "", w: 6 }, { en: "MATERIAL CODE", th: "", w: 22 }, { en: "MATERIAL DESCRIPTION", th: "", w: 46 }, { en: "LENGTH (mm.)", th: "", w: 12 }, { en: "HEIGHT (mm.)", th: "", w: 12 }, { en: "REQUIRED QTY", th: "", w: 12 }, { en: "REMARK", th: "", w: 22 }] };
  if (sheet.k === "FIXING") return { cols: [{ en: "NO.", th: "", w: 6 }, { en: "MATERIAL CODE", th: "", w: 22 }, { en: "MATERIAL DESCRIPTION", th: "", w: 52 }, { en: "REQUIRED QTY", th: "", w: 13 }, { en: "UNIT", th: "", w: 9 }, { en: "REMARK", th: "", w: 22 }] };
  // MACHINING / BENDING / STEEL
  return { cols: [{ en: "NO.", th: "ลำดับ", w: 6 }, { en: "CODE", th: "เบอร์พาร์ท", w: 20 }, { en: "QTY", th: "จำนวน", w: 9 }, { en: "QTY", th: "สั่งตัดเพิ่ม", w: 10 }, { en: "REV.", th: "แก้ไข", w: 8 }, { en: "MATERIAL", th: "วัตถุดิบ", w: 24 }, ...PROD(6), { en: "REMARK", th: "หมายเหตุ", w: 30 }], groups: [[7, 9, "PRODUCTION QTY"], [10, 12, "DATE"]] };
}

// แถวข้อมูลของชีต: [{ vals:[...ตามคอลัมน์], bold?, kid?, cancelled? }] + รวมจำนวน
function rowsFor(sheet, lotRows, { plan, need }) {
  const out = []; let total = null;
  const modNote = (r) => (r.mod_cancelled_at ? "ยกเลิก" : r.mod_version ? `แก้ ${r.mod_version}` : "");
  if (sheet.k === "panel") {
    let n = 0; total = 0;
    for (const r of lotRows) {
      const addrs = addrsFromNote(r.note);
      const list = addrs.length ? addrs : Array.from({ length: Math.max(1, Number(r.qty) || 1) }, () => "");
      for (const a of list) {
        const isMock = /^MOCK-[A-Z]+-\d+$/.test(a); const row = (plan.units || []).find((u) => String(u.addr || "").trim().toUpperCase() === a);
        const mk = isMock || row?.mock;
        out.push({ vals: [++n, r.code, mk ? "MOCKUP" : a, 1, [mk ? a : "", modNote(r)].filter(Boolean).join(" · ")], cancelled: !!r.mod_cancelled_at }); total += 1;
      }
    }
    return { out, total, totalAt: 4 };
  }
  const sorted = [...lotRows].sort((a, b) => String(a.code).localeCompare(String(b.code), "en", { numeric: true }));
  let n = 0;
  if (sheet.kind === "sub") {
    for (const r of sorted) {
      const q = Number(r.qty) || 0;
      const s = need.subs.find((x) => NC(x.code) === NC(r.code)) || {};
      const others = (s.procs || []).filter((p) => p !== sheet.k);
      const cx = !!r.mod_cancelled_at;
      out.push({ vals: [++n, r.code, s.d || "", num(s.l), q, "", "", "SET", [others.length ? "อยู่ในใบอื่นด้วย: " + others.join(", ") : "", modNote(r)].filter(Boolean).join(" · ")], bold: true, cancelled: cx });
      for (const k of subKids(plan, r.code)) out.push({ vals: ["", k.code, k.d, num(k.l), q, num(k.q), num(k.q * q), k.uom, ""], kid: true, cancelled: cx });
    }
    return { out, total };
  }
  total = 0;
  for (const r of sorted) {
    const q = Number(r.qty) || 0;
    const p = need.parts.find((x) => NC(x.code) === NC(r.code)) || {};
    out.push({ vals: [++n, r.code, q, "", p.rev || "", p.inv || "", ...PROD(6).map(() => ""), [isStar(r.code) ? "LOOSE PARTS" : "", p.f || "", modNote(r)].filter(Boolean).join(" · ")], cancelled: !!r.mod_cancelled_at });
    total += q;
  }
  return { out, total, totalAt: 3 };
}

// GLASS / ACCESSORIES = ใบเบิกวัสดุของทั้ง Release (ไม่มี QR ไม่แยกตามล็อต)
function matRows(sheet, need) {
  const out = []; let n = 0;
  if (sheet.k === "GLASS") for (const p of need.glass || []) out.push({ vals: [++n, p.code, p.d || "", num(p.l), num(p.h), num(p.qty), p.f || ""] });
  else for (const p of need.hw || []) out.push({ vals: [++n, p.code, p.d || "", num(p.qty), p.u || (p.mm ? "mm." : "pcs."), isStar(p.code) ? "LOOSE PARTS" : ""] });
  return { out, total: null };
}

export function buildLotWorkbook(ExcelJS, { plan, need, lot, userName, logo, printDate }) {
  const wb = new ExcelJS.Workbook(); wb.creator = "Artclad Production"; wb.created = new Date();
  const logoId = logo ? wb.addImage({ buffer: logo, extension: "png" }) : null;
  const by = new Map();
  for (const r of lot.rows) for (const k of lotRowSheets(r, need)) (by.get(k) || by.set(k, []).get(k)).push(r);
  const known = SHEETS.filter((s) => by.has(s.k));
  const unknown = [...by.keys()].filter((k) => !SHEETS.some((s) => s.k === k));   // ใบที่ไม่รู้จัก → รวมชีต "อื่นๆ"
  const list = [
    ...known.map((s) => ({ sheet: s, rows: by.get(s.k) })),
    ...(unknown.length ? [{ sheet: { k: "OTHER", kind: "part", label: "OTHER", tab: "อื่นๆ", th: "ใบงานอื่น" }, rows: unknown.flatMap((k) => by.get(k)) }] : []),
  ];
  // ใบเบิกวัสดุ (ทั้ง Release) — ใส่ท้ายถ้ามีรายการ
  if ((need.glass || []).length) list.push({ sheet: { k: "GLASS", kind: "mat", tab: "GLASS" }, mat: true });
  if ((need.hw || []).length) list.push({ sheet: { k: "FIXING", kind: "mat", tab: "ACCESSORIES" }, mat: true });
  const releaser = lot.by || plan.by || userName || "";
  const today = fmtDate(printDate || new Date());
  const used = new Set();

  for (const { sheet, rows, mat } of list) {
    let name = String(sheet.tab).replace(/[\\/?*[\]:']/g, " ").slice(0, 31); if (used.has(name)) name = name.slice(0, 27) + " (2)"; used.add(name);
    const { cols, groups } = columnsFor(sheet); const W = cols.length;
    const two = cols.some((c) => c.th);           // หัวตาราง 2 บรรทัด (อังกฤษ/ไทย)
    const ws = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: W > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }, views: [{ showGridLines: false }] });
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
    const tot = cols.reduce((s, c) => s + c.w, 0);
    const colAt = (frac) => { let acc = 0; for (let i = 0; i < W; i++) { acc += cols[i].w; if (acc >= tot * frac) return i + 1; } return W; };
    const mergeTo = (r, a, b) => { if (b > a) ws.mergeCells(r, a, r, b); return ws.getCell(r, a); };
    const put = (r, a, b, value, font, align) => { const x = mergeTo(r, a, b); x.value = value; x.font = { name: FONT, size: 11, ...font }; x.alignment = { vertical: "middle", ...align }; return x; };

    // ── หัวใบ ──
    const issue = sheet.kind === "mat";
    ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 16; ws.getRow(4).height = 16;
    put(1, 3, W, "PRODUCTION ORDER", { bold: true, size: 15 }, { horizontal: "center" });
    put(2, 3, W, issue ? "(ISSUE MATERIAL)" : sheet.kind === "sub" ? "" : "(CONFIRMATION)", { bold: true, size: 13 }, { horizontal: "center" });
    if (sheet.kind === "mat") put(1, 1, 2, "", {}, {});
    put(3, Math.max(1, W - 1), W, "RPT:", { size: 11 }, { horizontal: "right" });
    put(4, Math.max(1, W - 1), W, "REV:", { size: 11 }, { horizontal: "right" });
    if (logoId != null) ws.addImage(logoId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 178, height: 50 } });
    const [t1, t2] = TITLES[sheet.k] || [`${sheet.label || sheet.k}`, sheet.th || ""];
    // แบ่งแถวหัว 3 ช่วง: ซ้าย (Release Order/Project) · กลาง (ชื่อใบ) · ขวา (Print date/Prepared by) ตามความกว้างคอลัมน์
    const needL = Math.max(27, (String(lot.no).length + 16) * 1.2);
    let aEnd = 1; { let acc = 0; for (let i = 0; i < W; i++) { acc += cols[i].w; aEnd = i + 1; if (acc >= needL) break; } }
    let bStart = W; { let acc = 0; for (let i = W - 1; i >= 0; i--) { acc += cols[i].w; bStart = i + 1; if (acc >= 30) break; } }
    if (bStart <= aEnd + 1) { aEnd = Math.max(1, Math.min(aEnd, W - 3)); bStart = Math.min(W, aEnd + 2); }
    const roText = `Release Order : ${lot.no}`;
    ws.getRow(5).height = 20; ws.getRow(6).height = 20;
    put(5, 1, aEnd, roText, { bold: true, size: 12 }, { horizontal: "left" });
    put(5, aEnd + 1, bStart - 1, t1, { bold: true, size: 12 }, { horizontal: "center" });
    put(5, bStart, W, `Print date : ${today}`, { bold: true, size: 12 }, { horizontal: "right" });
    put(6, 1, aEnd, `Project : ${plan.projectCode || ""}`, { bold: true, size: 12 }, { horizontal: "left" });
    put(6, aEnd + 1, bStart - 1, t2, { bold: true, size: 12 }, { horizontal: "center" });
    put(6, bStart, W, `Prepared by : ${releaser}`, { bold: true, size: 12 }, { horizontal: "right" });
    for (let i = 1; i <= W; i++) { ws.getCell(5, i).border = { top: { style: "medium", color: BLACK } }; ws.getCell(6, i).border = { bottom: { style: "medium", color: BLACK } }; }
    if (mat) put(7, 1, W, `ยอดรวมทั้ง Release ${plan.ro || ""} (ใบเบิกวัสดุ ไม่แยกตามล็อต)`, { italic: true, size: 10, color: GREY }, { horizontal: "left" });
    // ── หัวตาราง ──
    const hr = 9; const hr2 = two ? hr + 1 : hr;
    ws.getRow(hr).height = two ? 20 : 34; if (two) ws.getRow(hr2).height = 20;
    cols.forEach((c, i) => {
      const a = ws.getCell(hr, i + 1); a.value = c.en || null;
      a.font = { name: FONT, size: 11, bold: true, color: c.grey ? GREY : BLACK }; a.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; a.border = BOX;
      if (two) { const b = ws.getCell(hr2, i + 1); b.value = c.th || null; b.font = { name: FONT, size: 11, bold: true }; b.alignment = { horizontal: "center", vertical: "middle" }; b.border = BOX; }
    });
    for (const [a, b, label] of groups || []) { ws.mergeCells(hr, a, hr, b); const x = ws.getCell(hr, a); x.value = label; x.alignment = { horizontal: "center", vertical: "middle" }; x.font = { name: FONT, size: 11, bold: true }; }
    // ── ข้อมูล ──
    const { out, total, totalAt } = mat ? matRows(sheet, need) : rowsFor(sheet, rows, { plan, need });
    out.forEach((row, ri) => {
      const rr = hr2 + 1 + ri;
      row.vals.forEach((v, i) => {
        const c = cols[i]; const x = ws.getCell(rr, i + 1); x.value = v === "" || v == null ? null : v; x.border = BOX;
        const numeric = typeof v === "number"; const head = c.en;
        const center = head === "NO." || head === "ITEM" || head === "UOM" || head === "UNIT" || head === "REV.";
        const kidCode = row.kid && head === "CODE";
        x.font = { name: FONT, size: 11, bold: !!row.bold && !c.grey && head !== "Remark", color: c.grey || (row.kid && (head === "SUB QTY." || head === "QTY OF PART/SUB")) ? GREY : row.bold && head === "LENGTH (mm.)" ? RED : BLACK };
        x.alignment = { vertical: "middle", horizontal: center ? "center" : numeric ? "right" : "left", wrapText: head === "DESCRIPTION" || head === "MATERIAL DESCRIPTION" || head === "REMARK" || head === "Remark", indent: kidCode ? 1 : 0 };
        if (numeric && !Number.isInteger(v)) x.numFmt = "#,##0.00";
        if (row.cancelled && head !== "NO." && head !== "ITEM") x.font = { ...x.font, strike: true, color: RED };
      });
      for (let i = row.vals.length; i < W; i++) ws.getCell(rr, i + 1).border = BOX;
    });
    let last = hr2 + out.length;
    if (total != null && out.length) {
      const tr = last + 1; last = tr;
      for (let i = 1; i <= W; i++) ws.getCell(tr, i).border = BOX;
      const x = ws.getCell(tr, totalAt); x.value = total; x.font = { name: FONT, size: 11, bold: true }; x.alignment = { horizontal: "right" };
      const lab = ws.getCell(tr, totalAt - 1); lab.value = "รวม"; lab.font = { name: FONT, size: 11, bold: true }; lab.alignment = { horizontal: "right" };
    }
    if (!out.length) { const x = ws.getCell(hr2 + 1, 1); x.value = "(ไม่มีรายการ)"; x.font = { name: FONT, size: 10, color: GREY }; }
    ws.views = [{ state: "frozen", ySplit: hr2, showGridLines: false }];
    ws.pageSetup.printTitlesRow = `1:${hr2}`;   // ใบยาวหลายหน้า → หัวใบ + หัวตารางซ้ำทุกหน้า
  }
  if (!list.length) { const ws = wb.addWorksheet("ใบปล่อย"); ws.getCell("A1").value = "(ล็อตนี้ไม่มีรายการ)"; }
  return wb;
}

export async function downloadLotSheets(args) {
  const mod = await import("exceljs/dist/exceljs.min.js");
  const ExcelJS = (mod && mod.Workbook) ? mod : (mod && mod.default && mod.default.Workbook) ? mod.default : (typeof window !== "undefined" && window.ExcelJS) || mod.default || mod;
  let logo = null;
  try { const base = (import.meta.env && import.meta.env.BASE_URL) || "/"; const r = await fetch(`${base}brand/artclad-logo.png`); if (r.ok) logo = await r.arrayBuffer(); } catch { /* ไม่มีโลโก้ก็ยังออกใบได้ */ }
  const wb = buildLotWorkbook(ExcelJS, { ...args, logo });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `ใบปล่อย ${args.plan.projectCode ? args.plan.projectCode + " " : ""}${args.lot.no}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
