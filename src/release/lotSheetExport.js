// ใบปล่อย (PRODUCTION ORDER) ของ 1 ล็อต → Excel · 1 ชีต ต่อ 1 ใบงานที่ส่งไปทำ
//   หัวใบ: เลขล็อต · Release · โปรเจค · วันที่ · ผู้ปล่อย · Modify · หมายเหตุ — ท้ายใบ: ช่องเซ็น ผู้จัดทำ / ผู้ปล่อย / ผู้อนุมัติ
//   ใช้ ExcelJS (โหลดตอนกดปุ่มเท่านั้น) · buildLotWorkbook รับ ExcelJS เข้ามา → ทดสอบใน node ได้
import { NC, SHEETS, isStar, addrsFromNote } from "./releaseCore.js";

const TITLES = {
  CUTTING: "CUTTING MACHINING & WELDING · งานตัดและเชื่อม",
  BENDING: "BENDING MACHINING & WELDING · งานพับและเชื่อม",
  STEEL: "STEEL PART · งานเหล็ก",
};
const C = { head: "FF1E293B", headFg: "FFFFFFFF", line: "FF94A3B8", soft: "FFF1F5F9", red: "FFB91C1C" };
const THIN = { style: "thin", color: { argb: C.line } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const fmtDate = (iso) => { try { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; } catch { return ""; } };
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? "" : Math.round(Number(v) * 100) / 100);

// ใบงานของแถวที่ปล่อย (อ่านจากหมายเหตุ "ใบ: …" เหมือนหน้าล็อต)
export function lotRowSheets(r, need) {
  const m = /ใบ:\s*(.+?)(?:\s*·|$)/.exec(r.note || "");
  if (r.kind === "panel") return ["panel"];
  if (m) return m[1].split(/\s*,\s*/).map((l) => (SHEETS.find((s) => s.label === l || s.k === l) || {}).k || l);
  return r.kind === "subassembly" ? (need.subs.find((s) => NC(s.code) === NC(r.code))?.procs || []) : [need.parts.find((p) => NC(p.code) === NC(r.code))?.dest || "CUTTING"];
}

// คอลัมน์ต่อชนิดใบ
function columnsFor(sheet) {
  if (sheet.kind === "panel") return [["NO.", 6], ["UNIT", 20], ["ADDRESS", 24], ["QTY", 8], ["REMARK", 34]];
  if (sheet.kind === "sub") return [["ITEM", 6], ["CODE", 20], ["DESCRIPTION", 44], ["LENGTH (mm.)", 14], ["SUB QTY.", 10], ["UOM", 8], ["REMARK", 34]];
  const h = sheet.k === "BENDING" || sheet.k === "STEEL";
  return [["NO.", 6], ["CODE", 20], ["DESCRIPTION", 42], ["LENGTH", 12], ...(h ? [["HEIGHT", 12]] : []), ["QTY", 8], ["REV.", 7], ["MATERIAL", 20], ["REMARK", 34]];
}

// แถวข้อมูลของชีต (array ตามคอลัมน์) + รวมจำนวน
function rowsFor(sheet, lotRows, { plan, need }) {
  const out = []; let total = 0;
  const modNote = (r) => (r.mod_cancelled_at ? "ยกเลิก" : r.mod_version ? `แก้ ${r.mod_version}` : "");
  if (sheet.kind === "panel") {
    let n = 0;
    for (const r of lotRows) {
      const addrs = addrsFromNote(r.note); const unit = r.code;
      const list = addrs.length ? addrs : Array.from({ length: Math.max(1, Number(r.qty) || 1) }, () => "");
      for (const a of list) {
        const isMock = /^MOCK-[A-Z]+-\d+$/.test(a); const row = (plan.units || []).find((u) => String(u.addr || "").trim().toUpperCase() === a);
        out.push([++n, unit, isMock || row?.mock ? "MOCKUP" : a, 1, [isMock || row?.mock ? a : "", modNote(r)].filter(Boolean).join(" · ")]); total += 1;
      }
    }
    return { out, total };
  }
  let n = 0;
  const sorted = [...lotRows].sort((a, b) => String(a.code).localeCompare(String(b.code), "en", { numeric: true }));
  for (const r of sorted) {
    const q = Number(r.qty) || 0;
    if (sheet.kind === "sub") {
      const s = need.subs.find((x) => NC(x.code) === NC(r.code)) || {};
      const others = (s.procs || []).filter((p) => p !== sheet.k);
      out.push([++n, r.code, s.d || "", num(s.l), q, "SET", [others.length ? "อยู่ในใบอื่นด้วย: " + others.join(", ") : "", modNote(r)].filter(Boolean).join(" · ")]);
    } else {
      const p = need.parts.find((x) => NC(x.code) === NC(r.code)) || {};
      const h = sheet.k === "BENDING" || sheet.k === "STEEL";
      out.push([++n, r.code, p.d || "", num(p.l), ...(h ? [num(p.h)] : []), q, p.rev || "", p.inv || "", [isStar(r.code) ? "LOOSE PARTS" : "", p.f || "", modNote(r)].filter(Boolean).join(" · ")]);
    }
    total += q;
  }
  return { out, total };
}

export function buildLotWorkbook(ExcelJS, { plan, need, lot, userName }) {
  const wb = new ExcelJS.Workbook(); wb.creator = "Artclad Production"; wb.created = new Date();
  const by = new Map();
  for (const r of lot.rows) for (const k of lotRowSheets(r, need)) (by.get(k) || by.set(k, []).get(k)).push(r);
  const sheets = SHEETS.filter((s) => by.has(s.k));
  const unknown = [...by.keys()].filter((k) => !SHEETS.some((s) => s.k === k));   // ใบที่ไม่รู้จัก → รวมชีต "อื่นๆ"
  const list = [...sheets.map((s) => ({ sheet: s, rows: by.get(s.k) })), ...(unknown.length ? [{ sheet: { k: "OTHER", kind: "part", label: "OTHER", tab: "อื่นๆ", th: "ใบงานอื่น" }, rows: unknown.flatMap((k) => by.get(k)) }] : [])];
  const used = new Set();
  const releaser = lot.by || userName || "";
  for (const { sheet, rows } of list) {
    let name = sheet.tab.replace(/[\\/?*[\]:]/g, " ").slice(0, 31); if (used.has(name)) name = name.slice(0, 27) + " (2)"; used.add(name);
    const ws = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: sheet.kind === "panel" ? "portrait" : "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
    const cols = columnsFor(sheet); const W = cols.length;
    cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
    const merge = (r, a = 1, b = W) => { if (b > a) ws.mergeCells(r, a, r, b); return ws.getCell(r, a); };
    // ── หัวใบ ──
    let c = merge(1); c.value = "PRODUCTION ORDER (CONFIRMATION)"; c.font = { bold: true, size: 15 }; c.alignment = { horizontal: "center" };
    c = merge(2); c.value = TITLES[sheet.k] || `${sheet.label}${sheet.th ? " · " + sheet.th : ""}`; c.font = { bold: true, size: 12 }; c.alignment = { horizontal: "center" };
    // หัวข้อมูล: ซ้าย = ครึ่งแรกของคอลัมน์ · ขวา = ครึ่งหลัง (ข้อความ "ป้าย:  ค่า" รวมในช่องเดียว กันป้ายถูกตัดเมื่อคอลัมน์แคบ)
    const half = Math.max(1, Math.ceil(W / 2));
    const info = [
      [["Release Order (ล็อต)", lot.no, true], ["โปรเจค", plan.projectCode || ""]],
      [["Release", plan.ro || ""], ["วันที่ปล่อย", fmtDate(lot.date)]],
      [["ผู้ปล่อย", releaser], ["Modify", String(plan.mod || "") || "-"]],
      [["หมายเหตุ", plan.note || ""], ["จำนวนรายการ", `${rows.length} รายการ`]],
    ];
    info.forEach(([L, R], i) => {
      const r = 4 + i;
      const put = (a, b, [lab, val, hi]) => { if (b > a) ws.mergeCells(r, a, r, b); const x = ws.getCell(r, a); x.value = `${lab}:  ${val}`; x.font = { bold: true, size: hi ? 12 : 10.5, color: { argb: hi ? "FF0F766E" : "FF0F172A" } }; x.alignment = { horizontal: "left" }; };
      put(1, half, L); if (W > half) put(half + 1, W, R);
    });
    // ── ตาราง ──
    const hr = 9;
    cols.forEach(([h], i) => { const x = ws.getCell(hr, i + 1); x.value = h; x.font = { bold: true, color: { argb: C.headFg } }; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.head } }; x.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; x.border = BOX; });
    ws.getRow(hr).height = 22;
    const { out, total } = rowsFor(sheet, rows, { plan, need });
    out.forEach((vals, ri) => {
      const rr = hr + 1 + ri;
      vals.forEach((v, i) => {
        const x = ws.getCell(rr, i + 1); x.value = v === "" ? null : v; x.border = BOX; x.font = { size: 10 };
        const h = cols[i][0];
        const numeric = typeof v === "number";
        x.alignment = { vertical: "middle", horizontal: h === "NO." || h === "ITEM" || h === "UOM" || h === "REV." ? "center" : numeric ? "right" : "left", wrapText: h === "DESCRIPTION" || h === "REMARK" };
        if (numeric && !Number.isInteger(v)) x.numFmt = "#,##0.00"; else if (numeric && /LENGTH|HEIGHT/.test(h)) x.numFmt = "#,##0.00";
        if (h === "CODE" || h === "UNIT") x.font = { size: 10, bold: true, name: "Consolas" };
        if (/ยกเลิก/.test(String(vals[vals.length - 1])) && h !== "NO.") x.font = { ...x.font, strike: true, color: { argb: C.red } };
        if (ri % 2) x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.soft } };
      });
    });
    // รวม
    const tr = hr + 1 + out.length; const qi = cols.findIndex(([h]) => h === "QTY" || h === "SUB QTY.") + 1;
    for (let i = 1; i <= W; i++) { const x = ws.getCell(tr, i); x.border = BOX; x.font = { bold: true }; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.soft } }; }
    if (qi > 1) { ws.getCell(tr, qi - 1).value = "รวม"; ws.getCell(tr, qi - 1).alignment = { horizontal: "right" }; ws.getCell(tr, qi).value = total; ws.getCell(tr, qi).alignment = { horizontal: "right" }; }
    else { ws.getCell(tr, 1).value = `รวม ${out.length} รายการ`; }
    ws.views = [{ state: "frozen", ySplit: hr }];
    ws.pageSetup.printTitlesRow = `${hr}:${hr}`;   // ใบยาวหลายหน้า → หัวตารางซ้ำทุกหน้า
    // ── ช่องเซ็น ──
    const sr = tr + 3;
    const boxes = [["ผู้จัดทำ (Prepared by)", plan.by || ""], ["ผู้ปล่อย (Released by)", releaser], ["ผู้อนุมัติ (Approved by)", ""]];
    const tot = cols.reduce((n, [, w]) => n + w, 0);
    const at = (frac) => { let acc = 0; for (let i = 0; i < W; i++) { acc += cols[i][1]; if (acc >= tot * frac) return i + 1; } return W; };
    let e1 = Math.max(1, at(1 / 3)), e2 = Math.max(e1 + 1, at(2 / 3)); if (e2 >= W) { e2 = W - 1; e1 = Math.min(e1, e2 - 1) || 1; }
    const edges = W === 5 ? [0, 2, 3, 5] : [0, e1, Math.max(e1 + 1, e2), W];
    boxes.forEach(([label, who], i) => {
      const a = edges[i] + 1, b = Math.max(a, edges[i + 1]);
      for (const [rowN, txt, opt] of [[sr, label, { bold: true, size: 10 }], [sr + 3, who ? `( ${who} )` : "(                                  )", { size: 10 }], [sr + 4, "วันที่  ____ / ____ / ________", { size: 9, color: { argb: "FF64748B" } }]]) {
        if (b > a) ws.mergeCells(rowN, a, rowN, b);
        const x = ws.getCell(rowN, a); x.value = txt; x.font = opt; x.alignment = { horizontal: "center" };
      }
      for (let col = a + (b > a ? 0 : 0); col <= b; col++) ws.getCell(sr + 2, col).border = { bottom: { style: "thin", color: { argb: "FF0F172A" } } };
    });
    ws.getRow(sr + 2).height = 26;
  }
  if (!list.length) { const ws = wb.addWorksheet("ใบปล่อย"); ws.getCell("A1").value = "(ล็อตนี้ไม่มีรายการ)"; }
  return wb;
}

export async function downloadLotSheets(args) {
  const mod = await import("exceljs/dist/exceljs.min.js");
  const ExcelJS = (mod && mod.Workbook) ? mod : (mod && mod.default && mod.default.Workbook) ? mod.default : (typeof window !== "undefined" && window.ExcelJS) || mod.default || mod;
  const wb = buildLotWorkbook(ExcelJS, args);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `ใบปล่อย ${args.plan.projectCode ? args.plan.projectCode + " " : ""}${args.lot.no}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
