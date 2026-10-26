// ใบปล่อย (PRODUCTION ORDER) ของ 1 ล็อต → Excel · 1 ชีต ต่อ 1 ใบงาน — หน้าตาตามใบ Excel เดิมของออฟฟิศ
//   หัวใบ: โลโก้ · PRODUCTION ORDER · RPT/REV · Release Order / Project / Print date / Prepared by · ตาราง (ไม่มีช่องเซ็น)
//   ชีต: MACHINING PART / BENDING / STEEL · SUB-ASSEMBLY (พับ/เชื่อม/ยิง/Site Item) · ASSEMBLY (แผง) · วัตถุดิบงานตัด · GLASS · ACCESSORIES (ของล็อตนี้)
//   ใช้ ExcelJS (โหลดตอนกดปุ่มเท่านั้น) · buildLotWorkbook รับ ExcelJS เข้ามา → ทดสอบใน node ได้
import { NC, SHEETS, isStar, addrsFromNote, findKey, lotMaterials } from "./releaseCore.js";

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
  MAT: ["MATERIAL LIST FOR CUTTING", "วัตถุดิบงานตัด"],
  GLASS: ["GLASS", "รายการวัสดุกระจก"],
  FIXING: ["ACCESSORIES", "FASTENER, GASKET & SILICONE"],
};
const BLACK = { argb: "FF000000" }, GREY = { argb: "FF8C8C8C" }, RED = { argb: "FFC00000" };
// ตาราง (2026-10-26 จัดใหม่): เส้นในสีเทา · กรอบนอก/ใต้หัวตารางเส้นดำหนา · หัวพื้นเทา · แถวสลับสีอ่อน · แถวซับ (SET) พื้นเทาอ่อน · แถวรวมพื้นเทา
const LINE = { style: "thin", color: { argb: "FFB4B9C0" } }, EDGE = { style: "medium", color: BLACK };
const FILL = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const HEAD_BG = "FFE6E9ED", HEAD2_BG = "FFF2F4F6", ZEBRA_BG = "FFF8F9FB", SET_BG = "FFECEFF3", TOTAL_BG = "FFE6E9ED", INK2 = { argb: "FF4B5563" };
// คอลัมน์ที่จัดกลาง / เบอร์ที่ตัวหนา
const CENTER_COLS = new Set(["NO.", "ITEM", "UOM", "UNIT", "REV."]);
const CODE_COLS = new Set(["CODE", "MATERIAL CODE", "UNIT"]);
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

// คอลัมน์: { en, th, w, key? }  ·  groups = หัวรวมเหนือหลายคอลัมน์ [ก, ข, ชื่อ] (ตอนนี้ไม่มีชีตไหนใช้)
//   2026-10-26: เอาคอลัมน์ว่าง PRODUCTION QTY ×3 / DATE ×3 ออก (user สั่ง)
function columnsFor(sheet) {
  if (sheet.k === "panel") return { cols: [{ en: "NO.", th: "ลำดับ", w: 7 }, { en: "UNIT", th: "แผง", w: 22 }, { en: "ADDRESS", th: "ที่อยู่", w: 26 }, { en: "QTY", th: "จำนวน", w: 9 }, { en: "REMARK", th: "หมายเหตุ", w: 46 }] };
  if (sheet.kind === "sub") return { cols: [{ en: "ITEM", th: "", w: 7 }, { en: "CODE", th: "", w: 18 }, { en: "DESCRIPTION", th: "", w: 46 }, { en: "LENGTH (mm.)", th: "", w: 12 }, { en: "SUB QTY.", th: "", w: 9 }, { en: "QTY OF PART/SUB", th: "", w: 12, grey: true }, { en: "PART QTY.", th: "", w: 10 }, { en: "UOM", th: "", w: 8 }, { en: "Remark", th: "", w: 26 }] };
  if (sheet.k === "MAT") return { cols: [{ en: "NO.", th: "", w: 6 }, { en: "MATERIAL CODE", th: "", w: 22 }, { en: "MATERIAL DESCRIPTION", th: "", w: 40 }, { en: "LENGTH (mm.)", th: "", w: 12 }, { en: "PARTS / PCS", th: "", w: 14 }, { en: "REQUIRED QTY", th: "", w: 12 }, { en: "ACTUAL ISSUE", th: "", w: 12 }, { en: "OFFCUT ≥500", th: "", w: 11 }, { en: "REMARK", th: "", w: 30 }] };
  if (sheet.k === "GLASS") return { cols: [{ en: "NO.", th: "", w: 6 }, { en: "MATERIAL CODE", th: "", w: 22 }, { en: "MATERIAL DESCRIPTION", th: "", w: 46 }, { en: "LENGTH (mm.)", th: "", w: 12 }, { en: "HEIGHT (mm.)", th: "", w: 12 }, { en: "REQUIRED QTY", th: "", w: 12 }, { en: "REMARK", th: "", w: 22 }] };
  if (sheet.k === "FIXING") return { cols: [{ en: "NO.", th: "", w: 6 }, { en: "MATERIAL CODE", th: "", w: 22 }, { en: "MATERIAL DESCRIPTION", th: "", w: 52 }, { en: "REQUIRED QTY", th: "", w: 13 }, { en: "UNIT", th: "", w: 9 }, { en: "REMARK", th: "", w: 22 }] };
  // MACHINING / BENDING / STEEL
  return { cols: [{ en: "NO.", th: "ลำดับ", w: 7 }, { en: "CODE", th: "เบอร์พาร์ท", w: 22 }, { en: "QTY", th: "จำนวน", w: 9 }, { en: "QTY", th: "สั่งตัดเพิ่ม", w: 11 }, { en: "REV.", th: "แก้ไข", w: 8 }, { en: "MATERIAL", th: "วัตถุดิบ", w: 26 }, { en: "REMARK", th: "หมายเหตุ", w: 32 }] };
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
    out.push({ vals: [++n, r.code, q, "", p.rev || "", p.inv || "", [isStar(r.code) ? "LOOSE PARTS" : "", p.f || "", modNote(r)].filter(Boolean).join(" · ")], cancelled: !!r.mod_cancelled_at });
    total += q;
  }
  return { out, total, totalAt: 3 };
}

// เศษ ≥ 500 มม.: ความยาวซ้ำรวมกัน → "1230 x2, 640"
const offTxt = (lens) => { const m = new Map(); for (const x of lens || []) m.set(x, (m.get(x) || 0) + 1); return [...m].map(([l, n]) => `${l}${n > 1 ? ` x${n}` : ""}`).join(", "); };
// วัตถุดิบงานตัด / GLASS / ACCESSORIES = ใบเบิกวัสดุของล็อตนี้ (ไม่มี QR) — คิดจาก lotMaterials (2026-10-26: เดิมเป็นยอดทั้ง Release)
//   ACTUAL ISSUE เว้นว่างให้กรอกตอนเบิกจริง
function matRows(sheet, lm) {
  const out = []; let n = 0;
  if (sheet.k === "MAT") { for (const m of lm.mat) out.push({ vals: [++n, m.inv || "(ไม่มี INV)", m.d || "", num(m.stock), `${m.parts.length} / ${m.pcs}`, num(m.bars), "", m.off || "", [m.off ? `เศษ (มม.) ${offTxt(m.offLens)}` : "", m.noLen ? `ไม่มีความยาว ${m.noLen} ชิ้น` : "", m.over ? `ยาวกว่าเส้น ${m.over} ชิ้น` : ""].filter(Boolean).join(" · ")] }); return { out, total: lm.mat.reduce((a, m) => a + m.bars, 0), totalAt: 6 }; }
  if (sheet.k === "GLASS") for (const p of lm.glass) out.push({ vals: [++n, p.code, p.d || "", num(p.l), num(p.h), num(p.qty), p.f || ""] });
  else for (const p of lm.hw) out.push({ vals: [++n, p.code, p.d || "", num(p.qty), p.u || (p.mm ? "mm." : "pcs."), isStar(p.code) ? "LOOSE PARTS" : ""] });
  return { out, total: null };
}

// ข้อมูลใบปล่อยของล็อต (ใช้ร่วมกันทั้ง Excel และหน้าตัวอย่าง PDF) — 1 รายการ = 1 ชีต
export function buildLotModel({ plan, need, lot, userName, printDate }) {
  const by = new Map();
  for (const r of lot.rows) for (const k of lotRowSheets(r, need)) (by.get(k) || by.set(k, []).get(k)).push(r);
  const known = SHEETS.filter((s) => by.has(s.k));
  const unknown = [...by.keys()].filter((k) => !SHEETS.some((s) => s.k === k));   // ใบที่ไม่รู้จัก → รวมชีต "อื่นๆ"
  const list = [
    ...known.map((s) => ({ sheet: s, rows: by.get(s.k) })),
    ...(unknown.length ? [{ sheet: { k: "OTHER", kind: "part", label: "OTHER", tab: "อื่นๆ", th: "ใบงานอื่น" }, rows: unknown.flatMap((k) => by.get(k)) }] : []),
  ];
  // ใบเบิกวัสดุ (ทั้ง Release) — ใส่ท้ายถ้ามีรายการ
  const lm = lotMaterials(plan, need, lot.rows, (r) => lotRowSheets(r, need));
  if (lm.mat.length) list.push({ sheet: { k: "MAT", kind: "mat", tab: "วัตถุดิบงานตัด" }, mat: true });
  if (lm.glass.length) list.push({ sheet: { k: "GLASS", kind: "mat", tab: "GLASS" }, mat: true });
  if (lm.hw.length) list.push({ sheet: { k: "FIXING", kind: "mat", tab: "ACCESSORIES" }, mat: true });
  const meta = { ro: lot.no, project: plan.projectCode || "", by: lot.by || plan.by || userName || "", date: fmtDate(printDate || new Date()) };
  const used = new Set();
  const sheets = list.map(({ sheet, rows, mat }) => {
    let name = String(sheet.tab).replace(/[\\/?*[\]:']/g, " ").slice(0, 31); if (used.has(name)) name = name.slice(0, 27) + " (2)"; used.add(name);
    const { cols, groups } = columnsFor(sheet);
    const [t1, t2] = TITLES[sheet.k] || [`${sheet.label || sheet.k}`, sheet.th || ""];
    const { out, total, totalAt } = mat ? matRows(sheet, lm) : rowsFor(sheet, rows, { plan, need });
    return { key: sheet.k, kind: sheet.kind, name, cols, groups, two: cols.some((c) => c.th), t1, t2, line2: sheet.kind === "mat" ? "(ISSUE MATERIAL)" : sheet.kind === "sub" ? "" : "(CONFIRMATION)", rows: out, total, totalAt, note: mat ? `ใบเบิกวัสดุของล็อต ${lot.no} — คิดเฉพาะของที่ปล่อยในล็อตนี้${sheet.k === "MAT" ? " · REQUIRED QTY = จำนวนเส้น (จัดชิ้นลงเส้น · เส้นใหม่ทุกล็อต) · OFFCUT = เศษที่เหลือ ≥ 500 มม. (เก็บใช้ต่อได้)" : ""}` : "" };
  });
  return { meta, sheets, file: `ใบปล่อย ${plan.projectCode ? plan.projectCode + " " : ""}${lot.no}`.replace(/[\\/:*?"<>|]/g, "-") };
}

export function buildLotWorkbook(ExcelJS, args) {
  const { logo } = args;
  const model = buildLotModel(args); const { meta } = model; const lot = { no: meta.ro }; const plan = { projectCode: meta.project };
  const wb = new ExcelJS.Workbook(); wb.creator = "Artclad Production"; wb.created = new Date();
  const logoId = logo ? wb.addImage({ buffer: logo, extension: "png" }) : null;
  const releaser = meta.by; const today = meta.date;

  for (const sh of model.sheets) {
    const { name, cols, groups, two, t1, t2, rows: out, total, totalAt } = sh; const sheet = { kind: sh.kind }; const mat = sh.kind === "mat"; const W = cols.length;
    const ws = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: W > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }, views: [{ showGridLines: false }] });
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
    const tot = cols.reduce((s, c) => s + c.w, 0); void tot;
    const mergeTo = (r, a, b) => { if (b > a) ws.mergeCells(r, a, r, b); return ws.getCell(r, a); };
    const put = (r, a, b, value, font, align) => { const x = mergeTo(r, a, b); x.value = value; x.font = { name: FONT, size: 11, ...font }; x.alignment = { vertical: "middle", ...align }; return x; };

    // ── หัวใบ ──
    ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 16; ws.getRow(4).height = 16;
    put(1, 3, W, "PRODUCTION ORDER", { bold: true, size: 15 }, { horizontal: "center" });
    put(2, 3, W, sh.line2, { bold: true, size: 13 }, { horizontal: "center" });
    put(3, Math.max(1, W - 1), W, "RPT:", { size: 11 }, { horizontal: "right" });
    put(4, Math.max(1, W - 1), W, "REV:", { size: 11 }, { horizontal: "right" });
    if (logoId != null) ws.addImage(logoId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 178, height: 50 } });
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
    put(6, 1, aEnd, `Project : ${plan.projectCode}`, { bold: true, size: 12 }, { horizontal: "left" });
    put(6, aEnd + 1, bStart - 1, t2, { bold: true, size: 12 }, { horizontal: "center" });
    put(6, bStart, W, `Prepared by : ${releaser}`, { bold: true, size: 12 }, { horizontal: "right" });
    for (let i = 1; i <= W; i++) { ws.getCell(5, i).border = { top: { style: "medium", color: BLACK } }; ws.getCell(6, i).border = { bottom: { style: "medium", color: BLACK } }; }
    if (mat) put(7, 1, W, sh.note, { italic: true, size: 10, color: GREY }, { horizontal: "left" });
    // ── หัวตาราง ──
    void sheet; const hr = 9; const hr2 = two ? hr + 1 : hr;
    ws.getRow(hr).height = two ? 20 : 30; if (two) ws.getRow(hr2).height = 17;
    const edge = (i, top, bottom) => ({ top: top || LINE, bottom: bottom || LINE, left: i === 1 ? EDGE : LINE, right: i === W ? EDGE : LINE });
    cols.forEach((c, i) => {
      const a = ws.getCell(hr, i + 1); a.value = c.en || null; a.fill = FILL(HEAD_BG);
      a.font = { name: FONT, size: 10.5, bold: true, color: c.grey ? GREY : BLACK }; a.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      a.border = edge(i + 1, EDGE, two ? LINE : EDGE);
      if (two) { const b = ws.getCell(hr2, i + 1); b.value = c.th || null; b.fill = FILL(HEAD2_BG); b.font = { name: FONT, size: 9.5, color: INK2 }; b.alignment = { horizontal: "center", vertical: "middle" }; b.border = edge(i + 1, LINE, EDGE); }
    });
    for (const [a, b, label] of groups || []) { ws.mergeCells(hr, a, hr, b); const x = ws.getCell(hr, a); x.value = label; x.alignment = { horizontal: "center", vertical: "middle" }; x.font = { name: FONT, size: 10.5, bold: true }; }
    // ── ข้อมูล ──
    let zebra = 0;
    out.forEach((row, ri) => {
      const rr = hr2 + 1 + ri; ws.getRow(rr).height = 18;
      if (!row.kid) zebra += 1;   // ซับ: ลูกใช้สีเดียวกับแถวพ่อ
      const bg = row.bold && sh.kind === "sub" ? SET_BG : zebra % 2 === 0 ? ZEBRA_BG : null;
      const lastRow = ri === out.length - 1 && total == null;
      for (let i = 0; i < W; i++) {
        const c = cols[i]; const v = row.vals[i]; const x = ws.getCell(rr, i + 1); x.value = v === "" || v == null ? null : v;
        x.border = edge(i + 1, null, lastRow ? EDGE : null); if (bg) x.fill = FILL(bg);
        const numeric = typeof v === "number"; const head = c.en; const rm = head === "REMARK" || head === "Remark";
        const kidCode = row.kid && head === "CODE"; const uomCol = head === "UNIT" && sh.kind === "mat";
        const strong = (!!row.bold && !c.grey && !rm) || (CODE_COLS.has(head) && !uomCol && !row.kid && !numeric);
        x.font = { name: FONT, size: rm ? 10 : 10.5, bold: strong, color: c.grey || (row.kid && (head === "SUB QTY." || head === "QTY OF PART/SUB")) ? GREY : row.bold && head === "LENGTH (mm.)" ? RED : rm ? INK2 : BLACK };
        x.alignment = { vertical: "middle", horizontal: (CENTER_COLS.has(head) && head !== "UNIT") || uomCol ? "center" : numeric ? "right" : "left", wrapText: head === "DESCRIPTION" || head === "MATERIAL DESCRIPTION" || rm, indent: kidCode ? 2 : CENTER_COLS.has(head) || uomCol ? 0 : 1 };
        if (numeric) x.numFmt = Number.isInteger(v) ? "#,##0" : "#,##0.00";
        if (row.cancelled && head !== "NO." && head !== "ITEM") x.font = { ...x.font, strike: true, color: RED };
      }
    });
    let last = hr2 + out.length;
    if (total != null && out.length) {
      const tr = last + 1; last = tr; ws.getRow(tr).height = 20;
      for (let i = 1; i <= W; i++) { const c = ws.getCell(tr, i); c.border = edge(i, EDGE, EDGE); c.fill = FILL(TOTAL_BG); }
      const x = ws.getCell(tr, totalAt); x.value = total; x.numFmt = "#,##0"; x.font = { name: FONT, size: 11, bold: true }; x.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      const lab = ws.getCell(tr, totalAt - 1); lab.value = "รวม"; lab.font = { name: FONT, size: 11, bold: true }; lab.alignment = { horizontal: "right", vertical: "middle" };
    }
    if (!out.length) { const x = ws.getCell(hr2 + 1, 1); x.value = "(ไม่มีรายการ)"; x.font = { name: FONT, size: 10, color: GREY }; }
    ws.views = [{ state: "frozen", ySplit: hr2, showGridLines: false }];
    ws.pageSetup.printTitlesRow = `1:${hr2}`;   // ใบยาวหลายหน้า → หัวใบ + หัวตารางซ้ำทุกหน้า
  }
  if (!model.sheets.length) { const ws = wb.addWorksheet("ใบปล่อย"); ws.getCell("A1").value = "(ล็อตนี้ไม่มีรายการ)"; }
  return wb;
}

// ── หน้าตัวอย่าง (HTML → พิมพ์ / บันทึกเป็น PDF จากเบราว์เซอร์) — หน้าตาเดียวกับ Excel ──
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtN = (v) => (typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : esc(v));
export function lotSheetsHtml(model, { logoUrl = "" } = {}) {
  const { meta } = model;
  const pages = model.sheets.map((sh) => {
    const W = sh.cols.length; const tot = sh.cols.reduce((n, c) => n + c.w, 0);
    const land = W > 6; const mat = sh.kind === "mat";
    const colgroup = sh.cols.map((c) => `<col style="width:${(c.w / tot * 100).toFixed(2)}%">`).join("");
    const head1 = (() => { const cells = []; for (let i = 0; i < W; i++) { const g = (sh.groups || []).find(([a]) => a === i + 1); if (g) { cells.push(`<th colspan="${g[1] - g[0] + 1}">${esc(g[2])}</th>`); i = g[1] - 1; } else cells.push(`<th${sh.cols[i].grey ? ' class="grey"' : ""}${sh.two ? "" : ' rowspan="1"'}>${esc(sh.cols[i].en)}</th>`); } return cells.join(""); })();
    const head2 = sh.two ? `<tr>${sh.cols.map((c) => `<th>${esc(c.th)}</th>`).join("")}</tr>` : "";
    let zebra = 0;
    const body = sh.rows.map((r) => { if (!r.kid) zebra += 1; return `<tr class="${r.bold ? "b" : ""}${r.bold && sh.kind === "sub" ? " set" : ""}${!r.kid && !(r.bold && sh.kind === "sub") && zebra % 2 === 0 ? " z" : ""}${r.kid ? " k" : ""}${r.kid && zebra % 2 === 0 ? " z" : ""}${r.cancelled ? " x" : ""}">${r.vals.map((v, i) => {
      const h = sh.cols[i].en; const uom = h === "UNIT" && sh.kind === "mat"; const cls = [typeof v === "number" ? "n" : "", (CENTER_COLS.has(h) && h !== "UNIT") || uom ? "c" : "", CODE_COLS.has(h) && !uom && typeof v !== "number" ? "code" : "", sh.cols[i].grey || (r.kid && (h === "SUB QTY." || h === "QTY OF PART/SUB")) ? "grey" : "", r.bold && h === "LENGTH (mm.)" ? "red" : "", r.kid && h === "CODE" ? "ind" : "", h === "Remark" || h === "REMARK" ? "rm" : ""].filter(Boolean).join(" ");
      return `<td class="${cls}">${v === "" || v == null ? "" : fmtN(v)}</td>`;
    }).join("")}${"<td></td>".repeat(Math.max(0, W - r.vals.length))}</tr>`; }).join("");
    const totRow = sh.total != null && sh.rows.length ? `<tr class="t">${sh.cols.map((c, i) => `<td class="${i + 1 === sh.totalAt ? "n" : i + 2 === sh.totalAt ? "lab" : ""}">${i + 1 === sh.totalAt ? fmtN(sh.total) : i + 2 === sh.totalAt ? "รวม" : ""}</td>`).join("")}</tr>` : "";
    return `<section class="pg ${land ? "land" : "port"}">
<div class="top"><div class="logo">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}</div><div class="ttl"><b>PRODUCTION ORDER</b><br><b class="s">${esc(sh.line2)}</b></div><div class="rr">RPT:<br>REV:</div></div>
<div class="info"><div class="l"><b>Release Order : ${esc(meta.ro)}</b><b>Project : ${esc(meta.project)}</b></div><div class="m"><b>${esc(sh.t1)}</b><b>${esc(sh.t2)}</b></div><div class="r"><b>Print date : ${esc(meta.date)}</b><b>Prepared by : ${esc(meta.by)}</b></div></div>
${mat ? `<div class="note">${esc(sh.note)}</div>` : ""}
<table><colgroup>${colgroup}</colgroup><thead><tr>${head1}</tr>${head2}</thead><tbody>${body || `<tr><td colspan="${W}" class="grey">(ไม่มีรายการ)</td></tr>`}${totRow}</tbody></table>
</section>`;
  }).join("\n");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(model.file)}</title><style>
@page land{size:A4 landscape;margin:8mm}@page port{size:A4 portrait;margin:8mm}
*{box-sizing:border-box}html,body{margin:0;background:#e5e7eb;font-family:Tahoma,"Noto Sans Thai","Leelawadee UI",sans-serif;color:#000}
.pg{background:#fff;margin:14px auto;padding:8mm;box-shadow:0 1px 8px rgba(0,0,0,.25);font-size:10.5px;break-after:page}
.pg.land{page:land;width:297mm;min-height:210mm}.pg.port{page:port;width:210mm;min-height:297mm}
.top{display:flex;align-items:flex-start;min-height:17mm}.logo{width:52mm}.logo img{height:15mm}.ttl{flex:1;text-align:center;font-size:15px;line-height:1.5}.ttl .s{font-size:13px}.rr{width:52mm;text-align:right;font-size:11px;line-height:1.5}
.info{display:flex;justify-content:space-between;align-items:stretch;border-top:2px solid #000;border-bottom:2px solid #000;padding:3px 0;font-size:12px;margin-bottom:6mm}
.info>div{display:flex;flex-direction:column;gap:3px;line-height:1.35}.info .m{text-align:center;flex:1}.info .r{text-align:right}.info .l{min-width:60mm}
.note{font-size:10px;font-style:italic;color:#777;margin:-4mm 0 3mm}
table{width:100%;border-collapse:collapse;table-layout:fixed;border:1.5px solid #000}
th,td{border:1px solid #b4b9c0;padding:3px 6px;vertical-align:middle;word-wrap:break-word;overflow-wrap:anywhere;line-height:1.35}
thead th{background:#e6e9ed;font-weight:700;text-align:center;font-size:10.5px;padding:5px 4px}
thead tr:last-child th{border-bottom:1.5px solid #000}thead tr+tr th{background:#f2f4f6;font-weight:400;font-size:9.5px;color:#4b5563;padding:2px 4px}
td.n{text-align:right;font-variant-numeric:tabular-nums}td.c{text-align:center}td.code{font-weight:700}td.rm{font-size:9.5px;color:#4b5563}
.grey{color:#8c8c8c!important}.red{color:#c00000}td.ind{padding-left:18px}
tr.z td{background:#f8f9fb}tr.set td{background:#eceff3}
tr.b td{font-weight:700}tr.b td.rm{font-weight:400}tr.k td{font-weight:400}tr.x td{text-decoration:line-through;color:#c00000}
tr.t td{font-weight:700;background:#e6e9ed;border-top:1.5px solid #000;padding:4px 6px}td.lab{text-align:right}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
thead{display:table-header-group}tr{break-inside:avoid}
@media print{html,body{background:#fff}.pg{margin:0;box-shadow:none;width:auto!important;min-height:0!important;padding:0}}
</style></head><body>${pages || "<p style='padding:20px'>(ล็อตนี้ไม่มีรายการ)</p>"}</body></html>`;
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
  a.href = url; a.download = `${buildLotModel(args).file}.xlsx`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
