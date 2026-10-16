// ══════════════════════════════════════════════════════════════════════════
// ปล่อยงานแบบใหม่ (2026-10-13) — แกนข้อมูล (ไม่มี UI / ไม่แตะฐานข้อมูล)
//   ① สร้าง Release  ② ลง Address & Unit  ③ อัพ PDF แผง/ซับ/พาร์ท → สร้าง BOM  ④ บันทึก
//   ระบบนับแผงต่อแบบ · แตก BOM ทั้งใบ · เทียบ PDF กับ BOM เดิมในระบบ แล้วเตือนค่าที่ไม่ตรง/ผิด
// รูปแบบรายการใน BOM: [kind, code, qty, rev?, chg?]   kind = "sub" | "part" | "hw"   chg "ยกเลิก" = ข้าม
// ══════════════════════════════════════════════════════════════════════════

export const KERF = 5;
export const NC = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
export const ncmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
export const near = (a, b, t = 0.01) => a != null && b != null && Math.abs(a - b) <= t;
export const fnum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
export const isStar = (code) => /\*$/.test(String(code || "").trim());
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
export const findKey = (obj, c) => { if (!obj || !c) return null; if (obj[c]) return c; const n = NC(c); return Object.keys(obj).find((k) => NC(k) === n) || null; };
export const nf = (n, d = 0) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const nlen = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

// ── Category ตามกติกาเบอร์ (ตรงไฟล์ Excel จริง 1,042/1,042) ──
export const CATS = ["MACHINING PART", "BENDING PART", "STEEL PART", "SUB-ASSEMBLY PART", "SUB-ASSEMBLY BY ENCLOS", "GLASS", "FASTENER & GASKET", "VENT"];
export const QR_CATS = new Set(["MACHINING PART", "BENDING PART", "STEEL PART", "SITE ITEM"]);   // พาร์ทที่ผลิตเอง = มี QR (Site Item = ชิ้นที่มี * ส่งไปไซต์ แต่ยังผลิตเอง)
export const PROCS = ["พับ", "เชื่อม", "ยิง", "Site Item"];   // ลำดับแสดงผล: พับ · เชื่อม · ยิง · Site Item
// หมวดอัตโนมัติ (ปุ่ม Auto): เบอร์ที่มี * = SITE ITEM · ที่เหลือตามรหัสเบอร์ (ruleCatBase)
export function ruleCat(code, kind) {
  if (kind !== "sub" && kind !== "enclos" && isStar(code)) return "SITE ITEM";
  return ruleCatBase(code, kind);
}
export function ruleCatBase(code, kind) {
  const c = NC(code);
  if (kind === "sub") return "SUB-ASSEMBLY PART";
  if (kind === "enclos") return "SUB-ASSEMBLY BY ENCLOS";
  if (kind === "hw") return "FASTENER & GASKET";
  if (c.startsWith("GL")) return "GLASS";
  if (c.startsWith("UA-")) return "VENT";
  if (c.startsWith("HP")) return "FASTENER & GASKET";
  if (/^(SF|AP|SP|FA)/.test(c)) return "BENDING PART";
  if (c.startsWith("FS")) return "STEEL PART";
  return "MACHINING PART";
}
// งานของซับ (1 ซับมีได้หลายงาน เก็บเป็น "เชื่อม, ยิง")
export function ruleProc(code) {
  const c = NC(code);
  if (isStar(c)) return "Site Item";
  if (/^SAAL/.test(c)) return "เชื่อม";
  if (/^(SAAP|SASF)/.test(c)) return "พับ";
  return "ยิง";
}
export const procList = (v) => String(v || "").split(/\s*,\s*/).filter(Boolean);
// แถวใน BOM ของ PDF → ชนิด
export function guessKind(row) {
  const c = NC(row.code);
  if (/^SA/.test(c)) return "sub";
  if (row.qty_unit) return "hw";
  if (!row.len && !row.fin && !/^GL/.test(c)) return "hw";
  return "part";
}

// ══ อ่าน PDF แบบ shop drawing (text PDF — ไม่ใช่สแกน) ด้วยตำแหน่งคำ ══
//   แผง: ตาราง "UAxxxx BILL OF MATERIALS" · ซับ: หัวกระดาษ + BOM · พาร์ท: หัวกระดาษ PART NO./LENGTH/INV.CODE/DEVELOP
export async function readShopPdf(pdfjsLib, data, fileName) {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const words = [];
  for (const it of tc.items) {
    const s = it.str; if (!s || !s.trim()) continue;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    const x = tx[4], base = tx[5], top = base - size * 0.78;
    const W = it.width * vp.scale || s.length * size * 0.5; const cw = W / s.length;
    let i = 0;
    for (const part of s.split(/(\s+)/)) {
      if (part.trim()) words.push({ text: part, x0: x + i * cw, x1: x + (i + part.length) * cw, top, size });
      i += part.length;
    }
  }
  try { doc.destroy(); } catch { /* ignore */ }
  const num = (v) => { const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? null : n; };
  const out = { file: fileName, title: {}, bom: [], warn_read: [] };
  const inv = words.find((w) => w.text === "INV.CODE");
  if (inv) {
    const labs = words.filter((w) => Math.abs(w.top - inv.top) < 2 && w.x0 <= inv.x1 + 1).sort((a, b) => a.x0 - b.x0);
    const cols = [];
    for (const w of labs) { if (w.text === "NO." && cols.length && cols[cols.length - 1][0] === "PART") cols[cols.length - 1] = ["PART NO.", cols[cols.length - 1][1], w.x1]; else cols.push([w.text, w.x0, w.x1]); }
    const vals = words.filter((w) => w.top - inv.top > 8 && w.top - inv.top < 26 && w.x0 <= inv.x1 + 40);
    for (const [lab, a, b] of cols) {
      const mid = (a + b) / 2;
      const nearW = vals.filter((v) => Math.abs((v.x0 + v.x1) / 2 - mid) < 30).sort((p, q) => p.x0 - q.x0);
      out.title[lab] = nearW.map((v) => v.text).join(" ") || null;
    }
    const dv = words.find((w) => w.text === "DEVELOP");
    if (dv) out.title.DEVELOP = words.filter((w) => w.top - dv.top > 8 && w.top - dv.top < 26 && w.x0 >= dv.x0 - 20 && w.x0 < dv.x0 + 90).sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" ");
  }
  // ★ 2026-10-16: ชื่อชิ้นงาน (DESCRIPTION ในกรอบหัวกระดาษมุมล่างขวา — ใต้ป้าย "DESCRIPTION") → title.DESC ใช้เป็นชื่อพาร์ท/ซับ
  //   เอาเฉพาะป้ายที่อยู่ครึ่งล่างของหน้า (ป้าย DESCRIPTION ของตาราง BOM แผง/ซับอยู่ด้านบน — ไม่เอา)
  {
    const labs = words.filter((w) => w.text.toUpperCase() === "DESCRIPTION" && w.top > vp.height * 0.7 && w.x0 > vp.width * 0.7).sort((a, b) => a.top - b.top);
    const lb = labs[0];
    if (lb) {
      const cx = (lb.x0 + lb.x1) / 2;
      const near = words.filter((w) => w.top > lb.top + 3 && w.top < lb.top + 40 && Math.abs((w.x0 + w.x1) / 2 - cx) < 95 && !/:$/.test(w.text));
      const rows = []; for (const w of near.sort((a, b) => a.top - b.top || a.x0 - b.x0)) { const r = rows[rows.length - 1]; if (r && Math.abs(r.top - w.top) < 3) r.w.push(w); else rows.push({ top: w.top, w: [w] }); }
      const txt = rows.map((r) => r.w.sort((a, b) => a.x0 - b.x0).map((x) => x.text).join(" ")).join(" ").replace(/\s+/g, " ").trim();
      if (txt) out.title.DESC = txt;
    }
  }
  const rightOf = (lab, stop) => {
    const w = words.find((x) => x.text === lab); if (!w) return null;
    const line = words.filter((x) => Math.abs(x.top - w.top) < 3 && x.x0 > w.x1 - 1).sort((a, b) => a.x0 - b.x0);
    const res = [];
    for (const x of line) { if (stop.includes(x.text) || x.x0 - (res.length ? res[res.length - 1].x1 : w.x1) > 60) break; res.push(x); }
    return res.map((x) => x.text).join(" ") || null;
  };
  out.title.FINISH = rightOf("FINISH:", ["STOCK"]);
  out.title.STOCK = (rightOf("STOCK", ["PART"]) || "").replace(/^NO\.:\s*/, "") || null;
  out.title.MATERIAL = rightOf("MATERIAL:", []);
  const bomHdr = words.find((w) => w.text === "BILL");
  if (bomHdr) { const nm = words.filter((w) => Math.abs(w.top - bomHdr.top) < 2 && w.x1 <= bomHdr.x0 + 1).sort((a, b) => b.x0 - a.x0)[0]; if (nm) out.title.BOM_OF = nm.text; }
  const rowsByY = (ws) => { const rows = []; for (const w of [...ws].sort((a, b) => a.top - b.top || a.x0 - b.x0)) { const r = rows[rows.length - 1]; if (r && Math.abs(r.y - w.top) <= 2) r.ws.push(w); else rows.push({ y: w.top, ws: [w] }); } rows.forEach((r) => r.ws.sort((a, b) => a.x0 - b.x0)); return rows; };
  for (const it of words.filter((w) => w.text === "ITEM")) {
    const hdr = words.filter((w) => Math.abs(w.top - it.top) < 2 && w.x0 >= it.x0 - 2).sort((a, b) => a.x0 - b.x0);
    const names = hdr.map((w) => w.text);
    if (!names.includes("NUMBER") || !names.includes("QTY.")) continue;
    const cut = hdr.find((w) => w.text === "ITEM" && w.x0 > it.x0 + 5);
    const xmax = cut ? cut.x0 - 2 : Math.max(...hdr.map((w) => w.x1)) + 25;
    const hx = {}; for (const w of hdr) if (w.x0 < xmax && hx[w.text] == null) hx[w.text] = [w.x0, w.x1];
    const numx = {}; for (const k of ["QTY.", "LENGTH", "HEIGHT", "FINISH"]) if (hx[k]) numx[k] = hx[k];
    if (!numx["QTY."]) continue;
    const qx0 = numx["QTY."][0] - 22;
    const cells = words.filter((w) => w.x0 >= it.x0 - 4 && w.x0 < xmax && w.top > it.top + 3 && Math.abs(w.size - it.size) < 0.3);
    const colof = (w) => { const cx = (w.x0 + w.x1) / 2; let best = null; for (const k in numx) { const [a, b] = numx[k]; const d = a - 3 <= cx && cx <= b + 3 ? 0 : Math.min(Math.abs(cx - a), Math.abs(cx - b)); if (!best || d < best[0]) best = [d, k]; } return best[1]; };
    let last = null;
    for (const { ws } of rowsByY(cells)) {
      if (!/^\d+$/.test(ws[0].text)) {
        const ex = ws.map((w) => w.text);
        if (last && ex.length === 1 && /^(M|PCS|MM)\.?$/i.test(ex[0])) last.qty_unit = ex[0].replace(".", "").toLowerCase();
        continue;
      }
      const r = {}; const txt = [];
      for (const w of ws.slice(1)) { if (w.x0 >= qx0) (r[colof(w)] = r[colof(w)] || []).push(w.text); else txt.push(w.text); }
      if (!txt.length && !Object.keys(r).length) continue;
      let code = txt[0] || ""; let rest = txt.slice(1);
      if (rest.length && /^[A-Z]{1,2}\*?$/.test(rest[0])) { code += " " + rest[0]; rest = rest.slice(1); }
      const q = r["QTY."] || [], L = r["LENGTH"] || [], H = r["HEIGHT"] || [], F = r["FINISH"] || [];
      const row = { item: +ws[0].text, code, desc: rest.join(" "), qty: q.length ? num(q[0]) : null, len: L.length ? num(L[0]) : null, ht: H.length ? num(H[0]) : null, fin: F.join(" ") || null };
      if (L.length && /^(MM|M|PCS)\.?$/i.test(L[0])) { row.qty_unit = L[0].replace(".", "").toLowerCase(); row.len = L.length > 1 ? num(L[1]) : null; }
      if (!code) out.warn_read.push(`แถว ${row.item}: อ่านเบอร์ไม่ได้`);
      if (row.qty == null && code) out.warn_read.push(`แถว ${row.item} ${code}: ไม่มีจำนวน`);
      out.bom.push(row); last = row;
    }
  }
  out.kind = /^UA\d/i.test(out.title.BOM_OF || "") || (!inv && out.bom.length) ? "panel" : out.bom.length ? "sub" : inv ? "part" : "unknown";
  out.code = (out.title["PART NO."] || out.title.BOM_OF || String(fileName).replace(/^.*?_?([A-Z]{2,}[\w-]*)\.pdf$/i, "$1")).trim();
  if (out.kind === "panel" && out.title.BOM_OF) out.code = out.title.BOM_OF;
  return out;
}

// pdf.js โหลดเฉพาะตอนอัพ PDF (ไม่ถ่วงหน้าอื่น) · ใช้ worker บน main thread (ไฟล์แบบเล็ก · ไม่ต้องตั้ง URL ของ worker)
let _pdfjs = null;
export function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = (async () => {
    const lib = await import("pdfjs-dist/build/pdf.min.js");
    const pdfjsLib = lib.default && lib.default.getDocument ? lib.default : lib;
    if (!globalThis.pdfjsWorker) {
      const w = await import("pdfjs-dist/build/pdf.worker.min.js");
      globalThis.pdfjsWorker = w.default && w.default.WorkerMessageHandler ? w.default : w;
    }
    return pdfjsLib;
  })().catch((e) => { _pdfjs = null; throw e; });
  return _pdfjs;
}
export async function readPdfFiles(files, onEach) {
  const pdfjsLib = await loadPdfJs();
  const out = [];
  for (const f of files) {
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const d = await readShopPdf(pdfjsLib, buf, f.name);
      out.push({ ...d, src: "upload", size: f.size, _file: f });
    } catch (e) {
      out.push({ file: f.name, kind: "unknown", code: f.name.replace(/\.pdf$/i, ""), title: {}, bom: [], warn_read: [`เปิดไฟล์ไม่ได้: ${e?.message || e}`], src: "upload" });
    }
    if (onEach) onEach(out.length, files.length);
  }
  return out;
}

// ══ สร้าง BOM ที่ใช้จริง: (BOM เดิมในระบบ ถ้าเปิด) + ทับด้วย PDF · ยกเว้นจุดที่เลือก "ใช้ค่าเดิม" ══
//   lib = { panels:{code:{d,items}}, subs:{code:{d,l,f,lvl,items}}, parts:{code:{d,l,h,f,m,k,u,...}} }
//   ack = { "<file>|<key>": "pdf" | "lib" | "ok" }
export function buildBom({ lib, pdfs, ack, useLib }) {
  const L = lib || { panels: {}, subs: {}, parts: {} };
  const kept = (d, key) => ack[d.file + "|" + key] === "lib";
  const libSub = (c) => { const k = findKey(L.subs, c); return k ? L.subs[k] : null; };
  const libHolder = (d) => (d.kind === "panel" ? L.panels[findKey(L.panels, d.code)] || null : d.kind === "sub" ? libSub(d.code) : null);
  const PANELS = useLib ? clone(L.panels) : {}, SUBS = useLib ? clone(L.subs) : {}, PARTS = useLib ? clone(L.parts) : {};
  const order = { panel: 0, sub: 1, part: 2, unknown: 3 };
  for (const d of [...pdfs].sort((a, b) => order[a.kind] - order[b.kind])) {
    if (d.kind === "panel" || d.kind === "sub") {
      const lh = libHolder(d); const items = [];
      for (const b of d.bom) {
        const c = NC(b.code); if (!c) continue;
        if (lh && kept(d, "miss:" + c)) continue;
        const k = guessKind(b);
        if (k === "sub") {
          const sk = findKey(SUBS, b.code);
          if (!sk) SUBS[b.code] = { d: b.desc, l: b.len, f: b.fin || "", lvl: d.kind === "panel" ? 1 : 2, items: [] };
          else { const s = SUBS[sk]; if (!kept(d, "l:" + c) && b.len != null) s.l = b.len; if (!s.d) s.d = b.desc; }
        } else {
          const pk = findKey(PARTS, b.code);
          const p = pk ? PARTS[pk] : (PARTS[b.code] = { d: b.desc, l: null, h: null, f: "", m: "", k });
          if (!p.d) p.d = b.desc;
          if (b.len != null && !kept(d, "l:" + c)) p.l = b.len;
          if (b.ht != null && !kept(d, "h:" + c)) p.h = b.ht;
          if (b.fin && !kept(d, "f:" + c)) p.f = b.fin;
          if (k === "hw") { p.k = "hw"; p.u = b.qty_unit === "pcs" ? "pcs." : "m."; if (b.qty_unit === "mm") p.mm = 1; }
        }
        let q = b.qty || 0;
        if (lh && kept(d, "q:" + c)) q = lh.items.filter((i) => NC(i[1]) === c && (i[4] || "") !== "ยกเลิก").reduce((a, i) => a + i[2], 0);
        const key = findKey(k === "sub" ? SUBS : PARTS, b.code) || b.code;
        const ex = items.find((i) => NC(i[1]) === c); if (ex) ex[2] += q; else items.push([k, key, q]);
      }
      if (lh) for (const it of lh.items) { const c = NC(it[1]); if ((it[4] || "") === "ยกเลิก") continue; if (!d.bom.some((b) => NC(b.code) === c) && kept(d, "gone:" + c) && !items.some((i) => NC(i[1]) === c)) items.push([it[0], it[1], it[2]]); }
      if (d.kind === "panel") { const pk = findKey(PANELS, d.code) || d.code; PANELS[pk] = { d: (PANELS[pk] || {}).d || "", items, pdf: d.file }; }
      else { const sk = findKey(SUBS, d.code) || d.code; const old = SUBS[sk] || {}; const Ln = fnum(d.title.LENGTH); SUBS[sk] = { d: old.d || d.title.DESC || "", l: kept(d, "subL") ? old.l : (Ln ?? old.l), f: old.f || "", lvl: old.lvl || 1, items, pdf: d.file }; }
    } else if (d.kind === "part") {
      const t = d.title; const pk = findKey(PARTS, d.code) || d.code; const p = PARTS[pk] = PARTS[pk] || { d: "", k: "part" };
      const set = (lab, fn) => { if (!kept(d, lab)) fn(); };
      const Ln = fnum(t.LENGTH), H = fnum(t.HEIGHT), inv = (t["INV.CODE"] || "").trim();
      set("LENGTH", () => { if (Ln != null) p.l = Ln; }); set("HEIGHT", () => { if (H != null) p.h = H; }); set("FINISH", () => { if (t.FINISH) p.f = t.FINISH; });
      const dm = /([\d.]+)\s*x\s*([\d.]+)/.exec(t.DEVELOP || "");
      if (dm) { set("DEVELOP W", () => (p.bw = +dm[1])); set("DEVELOP H", () => (p.bh = +dm[2])); set("INV.CODE", () => { if (inv && inv !== "-") { p.binv = inv; p.bm = p.bm || inv; } }); }
      else set("INV.CODE", () => { if (inv && inv !== "-") p.m = inv; });
      if (t.DESC) p.d = t.DESC;
      p.md = fnum(t["M.D."]); p.pdf = d.file; p.mat = t.MATERIAL || ""; p.rev = t["REV."] && t["REV."] !== "-" ? t["REV."] : p.rev;
    }
  }
  return { panels: PANELS, subs: SUBS, parts: PARTS };
}

// ══ ตรวจ 1 ไฟล์: เทียบ BOM เดิม + ความถูกต้องในแบบ ══
export function checkPdf(d, { lib, ack }) {
  const L = lib || { panels: {}, subs: {}, parts: {} };
  const kept = (key) => ack[d.file + "|" + key] === "lib";
  const libPart = (c) => { const k = findKey(L.parts, c); return k ? L.parts[k] : null; };
  const libSub = (c) => { const k = findKey(L.subs, c); return k ? L.subs[k] : null; };
  const libHolder = d.kind === "panel" ? L.panels[findKey(L.panels, d.code)] || null : d.kind === "sub" ? libSub(d.code) : null;
  const issues = [], rows = [];
  const add = (lvl, msg, key, opt = {}) => issues.push({ lvl, msg, key: d.file + "|" + key, ...opt });
  {
    const fn = NC(String(d.file || "").replace(/\.pdf$/i, "").replace(/^\d+_/, ""));
    const base = NC(d.code).replace(/\s+[A-Z]{1,2}\*?$/, "");
    if (d.code && fn && !fn.includes(base)) add("warn", `ชื่อไฟล์ "${d.file}" ไม่ตรงกับเบอร์ในแบบ ${d.code} — ตรวจว่าอัพถูกไฟล์`, "fname");
  }
  const t = d.title || {};
  for (const w of d.warn_read || []) add("bad", "อ่านแบบ: " + w, "read:" + w);
  if (d.kind === "unknown") { add("bad", "ไม่พบตาราง BILL OF MATERIALS หรือหัวกระดาษ PART NO. — อาจเป็น PDF สแกน (รูปภาพ) หรือไม่ใช่แบบแผง/ซับ/พาร์ท", "unk"); return { issues, rows }; }
  if (d.kind === "part") {
    const lp = libPart(d.code);
    const Ln = fnum(t.LENGTH), H = fnum(t.HEIGHT), inv = (t["INV.CODE"] || "").trim(), fin = (t.FINISH || "").trim();
    const dm = /([\d.]+)\s*x\s*([\d.]+)/.exec(t.DEVELOP || ""); const dw = dm ? +dm[1] : null, dh = dm ? +dm[2] : null;
    const lb = lp || {}; const libInv = dm ? (lb.binv || lb.bm || "") : (lb.m || "");
    const F = [["LENGTH", Ln, lb.l, true], ["HEIGHT", H, lb.h, H != null || lb.h], ["FINISH", fin, lb.f || "", true], ["INV.CODE", inv === "-" ? "" : inv, libInv, inv && inv !== "-"], ["DEVELOP W", dw, lb.bw, dw != null], ["DEVELOP H", dh, lb.bh, dh != null]];
    for (const [lab, pv, sv, show] of F) {
      if (!show) continue;
      let ok = null;
      // BOM เดิมไม่มีค่าช่องนี้ (เช่นในระบบยังไม่เก็บ Finish/สูง) = ไม่เทียบ · เทียบเฉพาะเมื่อมีค่าทั้งสองฝั่ง
      if (lp && sv != null && sv !== "") ok = typeof pv === "number" || typeof sv === "number" ? (pv == null ? false : near(pv, Number(sv), 0.02)) : String(pv || "") === String(sv || "");
      rows.push({ field: lab, pv, sv, ok, used: kept(lab) ? "lib" : "pdf" });
      if (ok === false) add("bad", `${lab}: PDF ${pv ?? "—"} ≠ BOM เดิม ${sv ?? "—"}`, lab, { choice: true, code: d.code });
    }
    const md = fnum(t["M.D."]); rows.push({ field: "M.D.", pv: md, sv: null, ok: null, note: "ความยาวตัดเผื่อ" });
    rows.push({ field: "MATERIAL", pv: t.MATERIAL || "", sv: null, ok: null });
    if (md != null && Ln != null && md < Ln) add("bad", `ในแบบเอง: M.D. ${md} สั้นกว่า LENGTH ${Ln}`, "md");
    if (t.STOCK && !/^(N\/A|-)$/.test(t.STOCK) && inv && inv !== "-" && !inv.startsWith(t.STOCK)) add("warn", `ในแบบเอง: STOCK NO. ${t.STOCK} ไม่ตรงกับ INV.CODE ${inv}`, "stock");
    if (!lp) add("info", `${d.code} ใหม่ — ยังไม่มีใน BOM เดิม ใช้ค่าจาก PDF`, "new");
    if (!inv || inv === "-") add("warn", "ในแบบเอง: ไม่มี INV.CODE (ไม่รู้วัตถุดิบ)", "noinv");
    return { issues, rows };
  }
  const lh = libHolder; const Ln = fnum(t.LENGTH);
  if (!lh) add("info", `${d.kind === "panel" ? "แผง" : "ซับ"} ${d.code} ใหม่ — ยังไม่มีใน BOM เดิม ใช้ BOM จาก PDF`, "new");
  const sq = new Map();
  if (lh) for (const it of lh.items) { if ((it[4] || "") === "ยกเลิก") continue; const c = NC(it[1]); const e = sq.get(c) || { q: 0, code: it[1], t: it[0] }; e.q += it[2]; sq.set(c, e); }
  const pq = new Map();
  for (const b of d.bom) { const c = NC(b.code); if (!c) continue; if (pq.has(c)) add("warn", `ในแบบเอง: ${b.code} อยู่ 2 บรรทัด (ITEM ${pq.get(c).b.item} และ ${b.item}) — รวมจำนวนให้`, "dup:" + c); const e = pq.get(c) || { q: 0, b }; e.q += b.qty || 0; pq.set(c, e); }
  const codes = [...pq.keys(), ...[...sq.keys()].filter((c) => !pq.has(c))];
  for (const c of codes) {
    const p = pq.get(c), s = sq.get(c), b = p ? p.b : {};
    const ref = /^SA/.test(c) ? libSub(c) : libPart(c);
    const r = { item: b.item, code: p ? b.code : s.code, desc: b.desc || (ref && ref.d) || "", qp: p ? p.q : null, qs: s ? s.q : null, unit: b.qty_unit || "", lp: b.len ?? null, ls: ref ? ref.l ?? null : null, hp: b.ht ?? null, hs: ref ? ref.h ?? null : null, fp: b.fin || "", fs: ref ? ref.f || "" : "", k: p ? guessKind(b) : s.t, bad: {} };
    rows.push(r);
    if (!lh) continue;
    if (!s) { r.bad.miss = "lib"; add("bad", `${r.code}: มีใน PDF (จำนวน ${r.qp}) แต่ไม่มีใน BOM เดิม`, "miss:" + c, { choice: true, libLabel: "ไม่เอาบรรทัดนี้", code: r.code }); continue; }
    if (!p) { r.bad.miss = "pdf"; add("bad", `${r.code}: มีใน BOM เดิม (จำนวน ${r.qs}) แต่ไม่มีใน PDF`, "gone:" + c, { choice: true, pdfLabel: "ตัดออก (ตาม PDF)", libLabel: "เก็บไว้ (ตามเดิม)", code: r.code }); continue; }
    if (!near(r.qp, r.qs)) {
      const round = (r.unit === "mm" || r.unit === "m") && Math.abs(r.qp - r.qs) <= Math.max(1.5, 0.006 * r.qs);
      r.bad.q = round ? "round" : "bad";
      add(round ? "info" : "bad", `${r.code}: จำนวน PDF ${r.qp} ${round ? "≈" : "≠"} BOM เดิม ${r.qs}${round ? " " + r.unit + " (ปัดเศษ)" : ""}`, "q:" + c, { choice: !round, code: r.code });
    }
    if (r.lp != null && r.ls && !near(r.lp, r.ls, 0.02)) { r.bad.l = 1; add("bad", `${r.code}: ความยาว PDF ${r.lp} ≠ BOM เดิม ${r.ls}`, "l:" + c, { choice: true, code: r.code }); }
    if (r.hp != null && r.hs != null && !near(r.hp, r.hs, 0.02)) { r.bad.h = 1; add("bad", `${r.code}: สูง PDF ${r.hp} ≠ BOM เดิม ${r.hs}`, "h:" + c, { choice: true, code: r.code }); }
    if (r.fp && r.fs && r.fp !== r.fs) { r.bad.f = 1; add("bad", `${r.code}: Finish PDF ${r.fp} ≠ BOM เดิม ${r.fs}`, "f:" + c, { choice: true, code: r.code }); }
  }
  for (const b of d.bom) if (b.code && b.qty == null) add("bad", `ในแบบเอง: ${b.code} ไม่มีจำนวน`, "noq:" + b.code);
  if (d.kind === "sub") {
    const ls = libSub(d.code);
    if (ls && Ln != null && ls.l && !near(Ln, ls.l, 0.02)) add("bad", `ความยาวซับ PDF ${Ln} ≠ BOM เดิม ${ls.l}`, "subL", { choice: true, code: d.code });
    const main = d.bom.find((b) => b.len && !b.qty_unit);
    if (main && Ln != null && !near(main.len, Ln, 0.02)) add("warn", `ในแบบเอง: ยาวซับ ${Ln} ≠ ยาวพาร์ทหลัก ${main.code} ${main.len}`, "mainL");
    for (const b of d.bom) if (b.qty_unit === "mm" && Ln && b.qty > Ln) add("bad", `ในแบบเอง: ${b.code} ยาว ${b.qty} มม. มากกว่าความยาวซับ ${Ln}`, "hsL:" + b.code);
  }
  return { issues, rows };
}
// เบอร์เดียวกันใน PDF หลายไฟล์แต่ค่าไม่ตรงกัน (เช่น ยาวในตารางแผง ≠ ยาวในแบบพาร์ท)
export function crossPdf(pdfs) {
  const m = new Map();
  const put = (c, f, field, v, where) => { if (v == null || v === "" || v === "-") return; const k = NC(c) + "|" + field; (m.get(k) || m.set(k, []).get(k)).push({ f, v, where }); };
  for (const d of pdfs) {
    if (d.kind === "part" || d.kind === "sub") { put(d.code, d.file, "ความยาว", fnum(d.title.LENGTH), "หัวกระดาษ"); if (d.kind === "part") { put(d.code, d.file, "สูง", fnum(d.title.HEIGHT), "หัวกระดาษ"); put(d.code, d.file, "Finish", d.title.FINISH, "หัวกระดาษ"); } }
    for (const b of d.bom || []) { put(b.code, d.file, "ความยาว", b.len, "ITEM " + b.item); put(b.code, d.file, "สูง", b.ht, "ITEM " + b.item); put(b.code, d.file, "Finish", b.fin, "ITEM " + b.item); }
  }
  const out = new Map();
  for (const [k, a] of m) {
    if (new Set(a.map((x) => (typeof x.v === "number" ? x.v.toFixed(2) : x.v))).size < 2) continue;
    const [code, field] = k.split("|");
    const hasPart = a.find((x) => x.where === "หัวกระดาษ");
    const msg = `${code}: ${field}ไม่ตรงกันระหว่าง PDF — ${a.map((x) => `${x.f.replace(/\.pdf$/i, "")} (${x.where}) ${typeof x.v === "number" ? nlen(x.v) : x.v}`).join(" · ")}${hasPart ? " → ใช้ค่าจากแบบของเบอร์นั้นเอง" : ""}`;
    for (const x of a) { const l = out.get(x.f) || []; if (!l.includes(msg)) l.push(msg); out.set(x.f, l); }
  }
  return out;
}
export function runChecks(pdfs, { lib, ack }) {
  const cross = crossPdf(pdfs);
  return pdfs.map((d) => {
    const r = checkPdf(d, { lib, ack });
    for (const msg of cross.get(d.file) || []) r.issues.push({ lvl: "bad", msg, key: d.file + "|x:" + msg });
    const open = r.issues.filter((i) => i.lvl !== "info" && !ack[i.key]);
    const lv = open.some((i) => i.lvl === "bad") ? "bad" : open.length ? "warn" : r.issues.some((i) => i.lvl !== "info") ? "done" : r.issues.length ? "info" : "ok";
    return { d, ...r, lv, open: open.length };
  });
}

// ══ นับแผงต่อแบบ (แทนชีต Units) + แตก BOM ทั้งใบ ══
export function countUnits(units, bom) {
  const m = new Map();
  for (const u of units) { const k = String(u.unit || "").trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => ncmp(a[0], b[0])).map(([unit, qty]) => ({ unit, qty, has: !!(bom.panels[findKey(bom.panels, unit)] || null) }));
}
export function explode(units, bom) {
  const subs = new Map(), parts = new Map();
  const walk = (items, mult, depth, parentKind, seen) => {
    for (const it of items) {
      const [t, code, q] = it;
      if ((it[4] || "") === "ยกเลิก") continue;
      const n = mult * (q || 0);
      if (t === "sub") {
        const s = subs.get(code) || { code, qty: 0, depth };
        s.qty += n; s.depth = Math.min(s.depth, depth); subs.set(code, s);
        const sk = findKey(bom.subs, code);
        if (sk && !seen.has(sk)) walk(bom.subs[sk].items || [], n, depth + 1, "sub", new Set([...seen, sk]));
      } else {
        const p = parts.get(code) || { code, qty: 0, loose: 0, kind: t };
        p.qty += n; if (parentKind === "panel") p.loose += n; parts.set(code, p);
      }
    }
  };
  for (const c of countUnits(units, bom)) if (c.has) walk(bom.panels[findKey(bom.panels, c.unit)].items, c.qty, 1, "panel", new Set());
  return { subs, parts };
}
// เช็กลิสต์ PDF ของใบนี้: แผงจาก Unit → ซับจาก BOM แผง → พาร์ท (เฉพาะงานตัด/พับ/เหล็ก)
export function coverage(units, bom, pdfs, catOf) {
  const pdfOf = (kind, c) => pdfs.find((d) => d.kind === kind && NC(d.code) === NC(c));
  const panels = countUnits(units, bom).map((r) => ({ code: r.unit, qty: r.qty, src: pdfOf("panel", r.unit) ? "pdf" : r.has ? "lib" : "none" }));
  const subs = new Map(), parts = new Map();
  const walk = (items, from) => {
    for (const it of items) {
      if ((it[4] || "") === "ยกเลิก") continue;
      const [k, c] = it;
      if (k === "sub") { if (!subs.has(c)) { subs.set(c, from); const sk = findKey(bom.subs, c); if (sk) walk(bom.subs[sk].items || [], c); } }
      else if (k === "part") { if (QR_CATS.has(catOf(c, "part")) && !parts.has(c)) parts.set(c, from); }
    }
  };
  for (const p of panels) { const pk = findKey(bom.panels, p.code); if (pk) walk(bom.panels[pk].items, p.code); }
  const subL = [...subs].map(([c, from]) => { const s = bom.subs[findKey(bom.subs, c)]; return { code: c, from, src: pdfOf("sub", c) ? "pdf" : s && (s.items || []).length ? "lib" : "none" }; });
  const partL = [...parts].map(([c, from]) => { const p = bom.parts[findKey(bom.parts, c)]; return { code: c, from, src: pdfOf("part", c) ? "pdf" : p && (p.m || p.binv || p.bm) ? "lib" : "none" }; });
  const need = new Set([...panels.map((x) => NC(x.code)), ...subL.map((x) => NC(x.code)), ...partL.map((x) => NC(x.code))]);
  const orphan = pdfs.filter((d) => d.kind !== "unknown" && !need.has(NC(d.code)));
  return { panels, subs: subL, parts: partL, orphan };
}

// ══ ตรวจ Address & Unit ══
export const UNIT_RE = /^UA\d{4}[A-Z]?$/i;
export function unitIssues(units, usedAddr) {
  const row = {}, block = [], warn = []; const seen = new Map();
  units.forEach((u, i) => { const a = String(u.addr || "").trim().toUpperCase(); if (a) { if (!seen.has(a)) seen.set(a, []); seen.get(a).push(i); } });
  let nInc = 0, nDup = 0, nUsed = 0, nOdd = 0;
  units.forEach((u, i) => {
    const is = []; const a = String(u.addr || "").trim().toUpperCase(); const un = String(u.unit || "").trim();
    if (!un || !a) { is.push(["bad", "ข้อมูลไม่ครบ"]); nInc++; }
    if (a && seen.get(a).length > 1) { is.push(["bad", `ซ้ำ (แถว ${seen.get(a).map((x) => x + 1).join(", ")})`]); nDup++; }
    if (a && usedAddr && usedAddr.has(a)) { is.push(["bad", `อยู่ใน ${usedAddr.get(a)} แล้ว`]); nUsed++; }
    if (un && !UNIT_RE.test(un)) { is.push(["warn", /O/i.test(un.slice(2)) ? "รูปแบบแปลก (ตัว O หรือ 0?)" : "รูปแบบแปลก"]); nOdd++; }
    if (is.length) row[i] = is;
  });
  if (nInc) block.push(`ข้อมูลไม่ครบ ${nInc} แถว`);
  if (nDup) block.push(`ที่อยู่ซ้ำ ${nDup} แถว`);
  if (nUsed) block.push(`ที่อยู่ใช้ใน Release อื่นแล้ว ${nUsed} แถว`);
  if (nOdd) warn.push(`Unit รูปแบบแปลก ${nOdd} แถว`);
  return { row, block, warn };
}
// วางจาก Excel: 2 คอลัมน์ Unit | Address (สลับลำดับได้ · มีหัวตารางได้ · คอลัมน์เดียว = ข้าม)
export function parseUnitsPaste(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { rows: [], skipped: 0 };
  const cells = lines.map((l) => l.split("\t").map((c) => c.trim()));
  let ui = 0, ai = 1, start = 0;
  const h = cells[0].map((c) => c.toLowerCase());
  const hu = h.findIndex((c) => /unit|แบบ/.test(c)), ha = h.findIndex((c) => /addr|ที่อยู่|ตำแหน่ง/.test(c));
  if (hu >= 0 && ha >= 0) { ui = hu; ai = ha; start = 1; }
  else {
    // ไม่มีหัว: คอลัมน์ไหนหน้าตาเป็น UAxxxx = Unit
    const sample = cells.slice(0, 20);
    const score = (i) => sample.filter((r) => UNIT_RE.test(r[i] || "")).length;
    const w = Math.max(...cells.map((r) => r.length));
    let best = 0; for (let i = 1; i < w; i++) if (score(i) > score(best)) best = i;
    ui = best; ai = ui === 0 ? 1 : 0;
    if (sample.length && !UNIT_RE.test(cells[0][ui] || "") && score(ui) >= Math.min(2, sample.length - 1)) start = 1;
  }
  const rows = []; let skipped = 0;
  for (const r of cells.slice(start)) {
    const unit = (r[ui] || "").trim().toUpperCase(), addr = (r[ai] || "").trim().toUpperCase();
    if (!unit && !addr) { skipped++; continue; }
    rows.push({ unit, addr });
  }
  return { rows, skipped };
}
// ★ 2026-10-16: นำเข้า Unit | Address จากไฟล์ PDF (ตารางแบบ text ไม่ใช่สแกน) → ข้อความแท็บคั่น ส่งต่อ parseUnitsPaste
//   จัดแถวตามตำแหน่งแนวตั้ง · แถวที่มี token รูปแบบ UAxxxx = Unit, token ที่เหลือตัวแรกที่หน้าตาเป็นที่อยู่ (มีเลข/ขีด) = Address
export async function readUnitsPdf(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const lines = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const ws = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        ws.push({ t: it.str.trim(), x: tx[4], y: tx[5] });
      }
      ws.sort((a, b) => a.y - b.y || a.x - b.x);
      let cur = null;
      for (const w of ws) {
        if (cur && Math.abs(w.y - cur.y) <= 3) cur.w.push(w); else { cur = { y: w.y, w: [w] }; lines.push(cur); }
      }
    }
  } finally { try { doc.destroy(); } catch { /* ignore */ } }
  const out = []; let skipped = 0;
  for (const ln of lines) {
    const toks = ln.w.sort((a, b) => a.x - b.x).flatMap((w) => w.t.split(/\s+/)).filter(Boolean);
    const ui = toks.findIndex((t) => UNIT_RE.test(t));
    if (ui < 0) { skipped++; continue; }
    const rest = toks.filter((_, i) => i !== ui);
    const addr = rest.find((t) => /\d/.test(t) && /[-_\/]/.test(t)) || rest.find((t) => /\d/.test(t)) || "";
    out.push(`${toks[ui]}\t${addr}`);
  }
  return { text: out.join("\n"), found: out.length, skipped };
}
// ที่อยู่ที่ใช้ไปแล้ว (เก็บในหมายเหตุของ Release แผง แบบ "ที่อยู่: 25-E-301, 25-E-302")
export const ADDR_TAG = "ที่อยู่:";
export function addrNote(addrs) { return `${ADDR_TAG} ${addrs.join(", ")}`; }
export function addrsFromNote(note) {
  const s = String(note || ""); const i = s.indexOf(ADDR_TAG); if (i < 0) return [];
  return s.slice(i + ADDR_TAG.length).split(/[,\n]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
}

// ══ สรุปสิ่งที่จะสร้างตอนบันทึก (ใช้ทั้งหน้าจอขั้น ④ และตอนบันทึกจริง) ══
//   panels: แบบแผง × จำนวน (QR 1 ต่อที่อยู่) · subs: ซับทุกชั้น (QR ต่อชุด) · parts: งานตัด/พับ/เหล็ก (QR ต่อชิ้น)
//   glass / hw / other = ไม่ทำ QR (ใบเบิก)
export function planRelease(units, bom, catOf) {
  // หมวดที่ office ตั้งเอง (Setting) ไม่ใช่หมวดมาตรฐาน → ผลิต/ใบงานคิดจากหมวดอัตโนมัติ (base) · หมวดที่โชว์ = ที่ตั้งเอง
  const cnt = countUnits(units, bom);
  const ex = explode(units, bom);
  const addrOf = new Map();
  for (const u of units) { const k = String(u.unit || "").trim(); if (!k) continue; (addrOf.get(k) || addrOf.set(k, []).get(k)).push(String(u.addr || "").trim().toUpperCase()); }
  const panels = cnt.map((c) => ({ code: c.unit, qty: c.qty, has: c.has, addrs: addrOf.get(c.unit) || [], d: (bom.panels[findKey(bom.panels, c.unit)] || {}).d || "" }));
  const subs = [...ex.subs.values()].map((s) => { const sd = bom.subs[findKey(bom.subs, s.code)] || {}; return { code: s.code, qty: s.qty, depth: s.depth, d: sd.d || "", l: sd.l ?? null, hasBom: !!(sd.items && sd.items.length), proc: null }; }).sort((a, b) => ncmp(a.code, b.code));
  const parts = [], glass = [], hw = [], other = [];
  for (const p of ex.parts.values()) {
    if (!(p.qty > 0)) continue;
    const d = bom.parts[findKey(bom.parts, p.code)] || {};
    const k = d.k || p.kind || "part";
    const cat = catOf(p.code, k);
    const base = PART_CATS.includes(cat) ? cat : ruleCat(p.code, k);
    const row = { code: p.code, qty: p.qty, cat, base, k, d: d.d || "", l: d.l ?? null, h: d.h ?? null, f: d.f || "", inv: d.binv || d.m || "", ml: d.ml ?? null, u: d.u || "", mm: !!d.mm, rev: d.rev || "" };
    if (k === "hw" || base === "FASTENER & GASKET") hw.push(row);
    else if (base === "GLASS") glass.push(row);
    else if (QR_CATS.has(base)) parts.push(row);
    else other.push(row);
  }
  const by = (a, b) => ncmp(a.code, b.code);
  parts.sort(by); glass.sort(by); hw.sort(by); other.sort(by);
  return { panels, subs, parts, glass, hw, other, ex };
}
// BOM ที่จะตั้งในระบบ (ตาราง bom_components) ของแผง/ซับ — ลูก = ซับ + พาร์ทที่มี QR เท่านั้น
//   (กระจก / สกรู / ยาง ไม่มี QR → ใส่ใน BOM จะทำให้หน้าตรวจประกอบรอลูกที่สแกนไม่ได้)
//   BOM เก็บจำนวนเต็มต่อชุด → ปัดเศษ + คืนรายการที่ปัดไว้เตือน
export function bomForSave(bom, plan, catOf) {
  const qrPart = new Set(plan.parts.map((p) => NC(p.code)));
  const subSet = new Set(plan.subs.map((s) => NC(s.code)));
  const out = []; const frac = [];
  const take = (code, kind, items) => {
    const comp = new Map();
    for (const it of items || []) {
      if ((it[4] || "") === "ยกเลิก") continue;
      const [t, c, q] = it; const n = NC(c);
      if (!(t === "sub" ? subSet.has(n) : qrPart.has(n))) continue;
      if (!(q > 0)) continue;
      const e = comp.get(n) || { code: c, qty: 0, kind: t === "sub" ? "sub" : "part" }; e.qty += q; comp.set(n, e);
    }
    const children = [...comp.values()].map((e) => { const r = Math.max(1, Math.round(e.qty)); if (Math.abs(r - e.qty) > 1e-9) frac.push(`${code} › ${e.code}: ${e.qty} → ${r}`); return { ...e, qty: r }; });
    if (children.length) out.push({ code, kind, children });
  };
  for (const p of plan.panels) if (p.has) take(p.code, "panel", bom.panels[findKey(bom.panels, p.code)].items);
  for (const s of plan.subs) { const sk = findKey(bom.subs, s.code); if (sk) take(s.code, "subassembly", bom.subs[sk].items); }
  void catOf;
  return { list: out, frac };
}

// Release / ที่อยู่ที่ใช้แล้วในโปรเจค (จากรายการ Release ที่หน้า "ปล่อยงาน" โหลดไว้แล้ว — ไม่ต้องโหลดซ้ำ)
export function projectContext(releases, projectCode) {
  const orders = new Map(); const usedAddr = new Map();
  for (const r of releases || []) {
    if (projectCode && r.part_master?.projects?.code !== projectCode) continue;
    const ro = String(r.release_order || "").trim(); if (!ro) continue;
    const o = orders.get(ro) || { code: ro, parts: 0, panels: 0, date: r.release_date };
    o.parts++; if (r.part_master?.kind === "panel") o.panels += Number(r.qty) || 0;
    if (String(r.release_date) > String(o.date)) o.date = r.release_date;
    orders.set(ro, o);
    if (r.part_master?.kind === "panel") for (const a of addrsFromNote(r.note)) usedAddr.set(a, ro);
  }
  return { orders: [...orders.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))), usedAddr };
}
// เลข Release: P-ตัวเลข (+ "(…)" ต่อท้ายได้) · เทียบซ้ำแบบเลขเดียวกัน P-9 = P-09 = P-009 (กติกาเดียวกับ releaseOrderKey ใน supabase.js)
export const RELEASE_ORDER_RE = /^P-\d+(\s*\(.*\))?$/i;
export function normalizeRO(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  if (/^\d+$/.test(s)) return `P-${s.padStart(3, "0")}`;
  const m = s.match(/^P\s*-?\s*0*(\d+)(\s*\(.*\))?$/);
  if (m) return `P-${m[1].padStart(3, "0")}${m[2] ? " " + m[2].trim() : ""}`;
  return s;
}
export function roKey(raw) {
  const s = String(raw || "").trim().toUpperCase();
  const m = s.match(/^P\s*-?\s*0*(\d+)(?:\.0*(\d+))?\s*(\(.*\))?$/);
  return m ? `P-${Number(m[1])}${m[2] ? "." + Number(m[2]) : ""}${m[3] ? m[3].replace(/\s+/g, "") : ""}` : s.replace(/\s+/g, "");
}

// ══════════════════════════════════════════════════════════════════════════
// ปล่อยเป็นล็อต (P-142.1 / .2 / …) — office เลือกเองว่าจะปล่อยอะไร ไปทำที่ไหน
//   ล็อต = releases.release_order = "P-142.1" (ตารางเดิม) · แผน Release (P-142) เก็บ ที่อยู่ + BOM + งาน/ปลายทาง
// ══════════════════════════════════════════════════════════════════════════
// ใบงาน (ปลายทาง) ที่ office ส่งของไปทำ — ตามชีตในไฟล์จริง (Book1: MACHINING PART · BENDING · STEEL · SUB A'ssy (พับ/เชื่อม/Site Item/ยิง))
//   label = หัวใบสั่งผลิต (เก็บในหมายเหตุ release "ใบ: …" — อย่าเปลี่ยน) · tab = ชื่อชีตใน Excel
export const SHEETS = [
  { k: "CUTTING", kind: "part", label: "MACHINING PART", tab: "MACHINING PART", th: "งานตัด / เจาะ / บาก (MACHINING)" },
  { k: "BENDING", kind: "part", label: "BENDING", tab: "BENDING", th: "งานพับ (BENDING PART)" },
  { k: "STEEL", kind: "part", label: "STEEL", tab: "STEEL", th: "งานเหล็ก (STEEL PART)" },
  { k: "พับ", kind: "sub", label: "SUB-ASSEMBLY (งานพับ)", tab: "SUB A'ssy (พับ)", th: "ซับงานพับ" },
  { k: "เชื่อม", kind: "sub", label: "SUB-ASSEMBLY (งานเชื่อม)", tab: "SUB A'ssy (เชื่อม)", th: "ซับงานเชื่อม" },
  { k: "ยิง", kind: "sub", label: "SUB A'ssy (ยิง)", tab: "SUB A'ssy (ยิง)", th: "ซับงานยิงประกอบ" },
  { k: "Site Item", kind: "sub", label: "SUB-ASSEMBLY (Loose Parts)", tab: "SUB A'ssy (Site Item)", th: "ซับส่งไซต์ (เบอร์ *)" },
  { k: "panel", kind: "panel", label: "ASSEMBLY (แผง)", tab: "ASSEMBLY (แผง)", th: "ประกอบแผง · 1 QR ต่อที่อยู่" },
];
export const PART_DESTS = ["CUTTING", "BENDING", "STEEL"];
// ชื่อที่แสดง: ใบ CUTTING = MACHINING PART (ค่าเก็บในระบบยังเป็น CUTTING)
export const destLabel = (d) => (d === "CUTTING" ? "MACHINING PART" : d);
export const isPartSheet = (k) => PART_DESTS.includes(k);
export const ruleDest = (cat, code = "") => { const c = !PART_CATS.includes(cat) || cat === "SITE ITEM" ? ruleCatBase(code, "part") : cat; return c === "MACHINING PART" ? "CUTTING" : c === "STEEL PART" ? "STEEL" : "BENDING"; };

// ══ หัว Total 3 อย่าง (ตามแท็บ Excel: Total Part · Total Sub-Assembly · Total Mat.) แต่ละอย่างมีหัวข้อย่อย ══
//   Part / Sub = ของที่ปล่อยเป็นล็อต (มี QR) · Mat. = ใบเบิกวัสดุ (ไม่มี QR — วัตถุดิบงานตัด / กระจก / สกรู-ยาง)
export const MAT_SHEETS = [
  { k: "MAT", tab: "วัตถุดิบงานตัด", label: "MATERIAL LIST FOR CUTTING", th: "เส้นวัตถุดิบของพาร์ท CUTTING (คำนวณจากความยาว)" },
  { k: "GLASS", tab: "GLASS", label: "GLASS", th: "รายการวัสดุกระจก" },
  { k: "FIXING", tab: "FIXING", label: "ACCESSORIES", th: "FASTENER, GASKET & SILICONE" },
  { k: "OTHER", tab: "อื่นๆ", label: "OTHER", th: "VENT / ENCLOS / อื่นๆ ที่ไม่มี QR" },
];
// หมวดของพาร์ท (ตามหัวคอลัมน์ในชีต PARTS ของ Excel) — 3 หมวดแรกผลิตเอง (มี QR) · ที่เหลือเป็นรายการอ้างอิง/ใบเบิก
export const PART_CATS = ["MACHINING PART", "BENDING PART", "STEEL PART", "SUB-ASSEMBLY PART", "SUB-ASSEMBLY BY ENCLOS", "GLASS", "FASTENER & GASKET", "VENT", "SITE ITEM"];
// หมวดย่อยของ Total Part: Auto = PART_CATS ตามกติกา · Setting = office สร้างหมวดเอง (plan.partGroups) + ย้ายเบอร์ด้วย catOv
export function partGroupsOf(plan) {
  const custom = (plan.partGroups || []).map((g) => (typeof g === "string" ? g : g.name)).filter(Boolean);
  return plan.partMode === "setting" ? [...new Set([...custom, ...Object.values(plan.catOv || {})])] : PART_CATS;
}
export const TOTALS = [
  { k: "part", label: "Total Part", th: "แยกตามหมวดพาร์ท · ผลิตเองมี QR", sheets: PART_CATS },
  { k: "sub", label: "Total Sub-Assembly", th: "ซับ · 1 เบอร์อยู่ได้หลายใบ", sheets: ["พับ", "เชื่อม", "ยิง", "Site Item"] },
  { k: "mat", label: "Total Mat.", th: "ใบเบิกวัตถุดิบงานตัด · ไม่มี QR", sheets: ["MAT"] },
];
// ความยาวเส้นวัตถุดิบ: จาก BOM (ml) → จากรหัส INV (3 หลักก่อนตัวอักษรท้าย ×10 เช่น 23HZ02600C = 6,000 · 23BL01327B+C = 3,270) → 6,000
export const STOCK_DEFAULT = 6000;
export function stockLen(inv, ml) {
  if (Number(ml) > 0) return { len: Number(ml), src: "bom" };
  const m = /(\d{3})[A-Z]*(?:\+[A-Z]+)?\d?$/i.exec(String(inv || "").trim());
  if (m && Number(m[1]) >= 100) return { len: Number(m[1]) * 10, src: "code" };
  return { len: STOCK_DEFAULT, src: "default" };
}
// จัดชิ้นลงเส้น (First-Fit Decreasing) · ชิ้นละ len + KERF · เส้นสุดท้ายไม่ต้องเผื่อรอยตัด
export function packBars(pieces, stock, kerf = KERF) {
  const list = pieces.filter((p) => p.len > 0 && p.qty > 0).sort((a, b) => b.len - a.len);
  const rem = []; let over = 0, used = 0;
  for (const p of list) {
    if (p.len > stock + 1e-6) { over += p.qty; continue; }
    const need = p.len + kerf;
    let from = 0;   // เส้นก่อนหน้า from เหลือไม่พอสำหรับความยาวนี้แล้ว (เหลือแต่ลดลง) → ไม่ต้องไล่ซ้ำ
    for (let i = 0; i < p.qty; i++) {
      while (from < rem.length && rem[from] + 1e-6 < need) from++;
      if (from >= rem.length) rem.push(stock + kerf - need); else rem[from] -= need;
      used += p.len;
    }
  }
  const off = rem.filter((r) => r - kerf >= 500).length;   // เศษ ≥ 500 มม. (เก็บใช้ต่อได้)
  return { bars: rem.length, over, used, waste: rem.length * stock - used, off };
}
// รายการวัตถุดิบงานตัด (Total Mat. › วัตถุดิบงานตัด) — รวมพาร์ท MACHINING PART ตาม INV
export function cutMaterials(parts) {
  const by = new Map();
  for (const p of parts || []) {
    if (p.cancelled || !(p.qty > 0) || p.dest !== "CUTTING") continue;
    const inv = String(p.inv || "").trim();
    const key = inv || "—";
    const g = by.get(key) || by.set(key, { inv, stock: 0, src: "", parts: [], pcs: 0, len: 0, noLen: 0, desc: new Map() }).get(key);
    if (!g.stock) { const s = stockLen(inv, p.ml); g.stock = s.len; g.src = inv ? s.src : "default"; }
    g.parts.push({ code: p.code, l: p.l, qty: p.qty });
    g.pcs += p.qty;
    if (p.l > 0) g.len += p.l * p.qty; else g.noLen += p.qty;
    if (p.d) g.desc.set(p.d, (g.desc.get(p.d) || 0) + p.qty);
  }
  const out = [];
  for (const g of by.values()) {
    const pk = packBars(g.parts.map((x) => ({ len: Number(x.l) || 0, qty: x.qty })), g.stock);
    const req = g.stock ? g.parts.reduce((a, x) => a + (x.l > 0 ? (x.l + KERF) * x.qty : 0), 0) / g.stock : 0;
    const d = [...g.desc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    out.push({ inv: g.inv, d, stock: g.stock, src: g.src, parts: g.parts.sort((a, b) => ncmp(a.code, b.code)), pcs: g.pcs, len: g.len, noLen: g.noLen, req: Math.round(req * 100) / 100, bars: pk.bars, over: pk.over, waste: pk.waste, off: pk.off });
  }
  return out.sort((a, b) => (a.inv ? 0 : 1) - (b.inv ? 0 : 1) || ncmp(a.inv, b.inv));
}
const roNum = (ro) => { const m = /^P\s*-?\s*0*(\d+)/i.exec(String(ro || "").trim()); return m ? Number(m[1]) : null; };
export const lotOf = (ro) => { const m = /^P\s*-?\s*0*\d+\.0*(\d+)/i.exec(String(ro || "").trim()); return m ? Number(m[1]) : 0; };
export const inPlan = (lotRo, planRo) => roNum(lotRo) != null && roNum(lotRo) === roNum(planRo);
export function nextLotNo(planRo, lots) {
  const base = normalizeRO(planRo).replace(/\s*\(.*\)$/, "");
  let n = 1; const used = new Set(lots.map((l) => lotOf(l.no)));
  while (used.has(n)) n++;
  return `${base}.${n}`;
}
// ของที่ปล่อยไปแล้วของแผนนี้ (จากรายการ releases) → ยอดต่อเบอร์ · ที่อยู่แผงที่ปล่อยแล้ว · รายการล็อต
export function releasedOf(releases, plan) {
  const lots = new Map(); const byCode = new Map(); const addrLot = new Map(); const other = new Map();
  for (const r of releases || []) {
    if (plan.projectCode && r.part_master?.projects?.code && r.part_master.projects.code !== plan.projectCode) continue;
    const no = String(r.release_order || "").trim();
    if (!inPlan(no, plan.ro)) {
      // ปล่อยไว้แล้วใน Release อื่นของโปรเจคเดียวกัน → ใช้เป็นเบอร์ลูกได้เลย ไม่ต้องปล่อยใหม่
      const k = r.part_master?.kind || "part";
      if (k !== "panel" && !r.mod_cancelled_at && Number(r.qty) > 0) {
        const c = NC(r.part_master?.part_no); const e = other.get(c) || { qty: 0, ros: [] };
        e.qty += Number(r.qty); const ro = String(no).replace(/\.\d+$/, ""); if (ro && !e.ros.includes(ro)) e.ros.push(ro); other.set(c, e);
      }
      continue;
    }
    const L = lots.get(no) || { no, date: r.release_date, rows: [], panels: 0, subs: 0, parts: 0, qty: 0 };
    const kind = r.part_master?.kind || "part"; const code = String(r.part_master?.part_no || "").trim();
    L.rows.push({ id: r.id, code, kind, qty: Number(r.qty) || 0, note: r.note || "", mod_version: r.mod_version || null, mod_cancelled_at: r.mod_cancelled_at || null });
    if (kind === "panel") { L.panels += Number(r.qty) || 0; for (const a of addrsFromNote(r.note)) addrLot.set(a, no); }
    else {
      if (kind === "subassembly") L.subs++; else L.parts++;
      const e = byCode.get(NC(code)) || { qty: 0, lots: [] }; e.qty += Number(r.qty) || 0; if (!e.lots.includes(no)) e.lots.push(no); byCode.set(NC(code), e);
    }
    L.qty += Number(r.qty) || 0;
    if (String(r.release_date) < String(L.date)) L.date = r.release_date;
    lots.set(no, L);
  }
  return { lots: [...lots.values()].sort((a, b) => lotOf(a.no) - lotOf(b.no)), byCode, addrLot, other };
}
// ของเบอร์นี้ที่ปล่อยไว้แล้วใน Release อื่น (ใช้เป็นลูก) → { qty, ros } หรือ null
export function otherOf(rel, code) {
  const e = rel && rel.other && rel.other.get(NC(code)); return e && e.qty > 0 ? e : null;
}
// แตกลูกของแผง/ซับที่เลือก (ใช้ "เลือกแผง/ซับแล้วดึงลูกมาด้วย") → Map code→qty (ซับทุกชั้น + พาร์ท)
export function explodeFrom(bom, panelQty, subQty) {
  const subs = new Map(), parts = new Map();
  const walk = (items, mult, seen) => {
    for (const it of items || []) {
      if ((it[4] || "") === "ยกเลิก") continue;
      const [t, code, q] = it; const n = mult * (q || 0); if (!(n > 0)) continue;
      if (t === "sub") { subs.set(code, (subs.get(code) || 0) + n); const sk = findKey(bom.subs, code); if (sk && !seen.has(sk)) walk(bom.subs[sk].items, n, new Set([...seen, sk])); }
      else parts.set(code, (parts.get(code) || 0) + n);
    }
  };
  for (const [code, q] of panelQty || []) { const pk = findKey(bom.panels, code); if (pk) walk(bom.panels[pk].items, q, new Set()); }
  for (const [code, q] of subQty || []) { const sk = findKey(bom.subs, code); if (sk) walk(bom.subs[sk].items, q, new Set([sk])); }
  return { subs, parts };
}

// Category ของเบอร์ (แก้ได้ต่อใบ) · ใบงานของพาร์ท (CUTTING / BENDING) · งานของซับ (หลายงานได้)
export const UNCAT = "ยังไม่จัดหมวด";   // Setting: เบอร์ที่ไม่เข้าตัวหน้าของหมวดไหน → รอคนจัดเอง
// หมวดจาก "ตัวหน้า" ของหมวดที่ตั้งเอง: ตัวหน้ายาวสุดชนะ · "*" = เบอร์ที่ลงท้ายด้วย * · ไม่เข้าพวก = UNCAT
export function groupCatOf(groups, code) {
  const c = NC(code); let best = null, bl = -1;
  for (const g of groups || []) for (const pf of g.prefixes || []) {
    const P = NC(pf); if (!P) continue;
    const ok = P === "*" ? isStar(c) : c.startsWith(P);
    const L = P === "*" ? 99 : P.length;   // "*" ชนะทุกตัวหน้า · ตัวหน้ายาวกว่าชนะ · ยาวเท่ากัน = หมวดที่สร้างทีหลังชนะ
    if (ok && L >= bl) { best = g.name; bl = L; }
  }
  return best || UNCAT;
}
// ตัวหน้าเริ่มต้นของแต่ละหมวด (ตอนกด Setting ครั้งแรก) = ตัวอักษรหน้าของเบอร์ที่อยู่ในหมวดนั้นตอน Auto
export function seedPartGroups(bom) {
  const pre = (code) => { const m = /^([A-Z]+)/.exec(NC(code)); return m ? m[1] : NC(code).slice(0, 2); };
  const m = new Map(PART_CATS.filter((k) => k !== "SUB-ASSEMBLY PART").map((k) => [k, new Set()]));
  for (const [code, p] of Object.entries(bom.parts || {})) { const cat = ruleCat(code, p.k || "part"); if (!m.has(cat)) continue; m.get(cat).add(isStar(code) ? "*" : pre(code)); }
  return [...m.entries()].map(([name, set]) => ({ name, prefixes: [...set].sort() }));
}
export function makeCatOf(bom, catOv = {}, plan = null) {
  const kindOf = (code, kind) => (kind === "sub" ? "sub" : (bom.parts[findKey(bom.parts, code)] || {}).k || kind);
  if (plan && plan.partMode === "setting") return (code, kind) => { const k = kindOf(code, kind); if (k === "sub") return "SUB-ASSEMBLY PART"; return catOv[code] || groupCatOf(plan.partGroups, code); };
  return (code, kind) => catOv[code] || ruleCat(code, kindOf(code, kind));
}
// ยอดที่ต้องปล่อยทั้งใบของแผน + ใบงานต่อเบอร์
//   + Modify ของ Release: plan.adj { code:{qty,ver} } · plan.cancel { code: ver } · plan.cancelAddr { addr: ver } · plan.extra [เบอร์เพิ่ม]
//   แถวที่ถูกแก้: orig = ยอดเดิม (โชว์ขีดฆ่า) · modVer = M ล่าสุดที่แก้ · cancelled = ยกเลิกใน M ไหน · added = เพิ่มใน M ไหน
export const addrKey = (a) => String(a || "").trim().toUpperCase();
export function needOf(plan) {
  const catOf = makeCatOf(plan.bom, plan.catOv || {}, plan);
  const cAddr = plan.cancelAddr || {};
  const units = (plan.units || []).filter((u) => !cAddr[addrKey(u.addr)]);
  const p = planRelease(units, plan.bom, catOf);
  for (const x of plan.extra || []) {
    if (x.kind === "sub") { if (!p.subs.some((s) => NC(s.code) === NC(x.code))) p.subs.push({ code: x.code, qty: x.qty, depth: 1, d: x.d || "", l: x.l ?? null, hasBom: false, added: x.mod }); }
    else if (!p.parts.some((s) => NC(s.code) === NC(x.code))) p.parts.push({ code: x.code, qty: x.qty, cat: x.cat || ruleCat(x.code, "part"), k: "part", d: x.d || "", l: x.l ?? null, h: null, f: "", inv: x.inv || "", u: "", mm: false, rev: "", added: x.mod });
  }
  const adj = plan.adj || {}, cancel = plan.cancel || {};
  // ยอดเดิมก่อน Modify (ก่อนยกเลิกที่อยู่ด้วย) — ใช้โชว์ขีดฆ่า
  const hasBE = !!(plan.bomEdits && plan.bomEdits.length);
  const base = Object.keys(cAddr).length || hasBE ? planRelease(plan.units || [], hasBE ? bomBefore(plan.bom) : plan.bom, catOf) : null;
  const baseQty = new Map(); if (base) for (const r of [...base.subs, ...base.parts, ...base.glass, ...base.hw, ...base.other]) baseQty.set(NC(r.code), r.qty);
  // แก้ BOM ลูก (ซับ/แผง) แล้วเบอร์นั้นไม่ถูกใช้อีก → คงแถวไว้ qty 0 + ป้ายยกเลิก (ล็อตที่ปล่อยไปแล้วยังอ้างถึงได้)
  if (hasBE) {
    const base2 = planRelease(units, bomBefore(plan.bom), catOf);
    const verOf = (code) => { const e = [...plan.bomEdits].reverse().find((x) => NC(x.code) === NC(code) || NC(x.newCode) === NC(code)); return e ? e.ver : ""; };
    for (const [key, list] of [["subs", base2.subs], ["parts", base2.parts]]) for (const r of list) if (!p[key].some((x) => NC(x.code) === NC(r.code))) p[key].push({ ...r, qty: 0, ghost: true, cancelled: verOf(r.code), modVer: verOf(r.code) });
  }
  for (const r of [...p.subs, ...p.parts]) {
    r.orig = base && baseQty.has(NC(r.code)) ? baseQty.get(NC(r.code)) : r.qty;
    const a = adj[r.code]; if (a) { r.qty = a.qty; r.modVer = a.ver; }
    if (cancel[r.code]) { r.cancelled = cancel[r.code]; r.modVer = cancel[r.code]; r.qty = 0; }
  }
  p.panels.forEach((x) => { x.orig = (plan.units || []).filter((u) => u.unit === x.code).length; });
  p.subs.forEach((s) => { s.procs = procList((plan.procOv || {})[s.code] ?? ruleProc(s.code)); });
  p.parts.forEach((x) => { x.dest = (plan.destOv || {})[x.code] || (plan.extra || []).find((e) => e.code === x.code)?.dest || ruleDest(x.cat, x.code); });
  p.cancelledAddr = cAddr;
  return p;
}
// ══ Modify ══
//   changes: [{ kind:"part"|"sub", code, type:"qty"|"cancel", qty }] (qty = ยอดต้องใช้ใหม่ทั้งใบ)
//   ของที่ปล่อยไปแล้วเกินยอดใหม่ → ลด/ยกเลิกในล็อต (ล็อตล่าสุดก่อน) ด้วย Modify เดิมของระบบ (apply_release_modify)
//     กติกาเดียวกับ DB: ลดได้ไม่ต่ำกว่าที่ทำแล้ว · ลดได้ไม่เกิน QR ที่ยังไม่ใช้ · ลดจนเหลือ 0 = ยกเลิกเบอร์ในล็อตนั้น
//   limits: Map(release_id → { produced, free_qr, cancelled }) จาก get_release_modify_info
export function modifyOps(need, rel, changes, limits = new Map()) {
  const items = [], errors = []; const lotOps = new Map();
  const push = (lot, op) => (lotOps.get(lot) || lotOps.set(lot, []).get(lot)).push(op);
  for (const c of changes) {
    const row = (c.kind === "sub" ? need.subs : need.parts).find((x) => NC(x.code) === NC(c.code));
    if (!row) continue;
    const target = c.type === "cancel" ? 0 : Math.max(0, Math.round(Number(c.qty) || 0));
    const rrows = [];
    for (const L of rel.lots) for (const r of L.rows) if (NC(r.code) === NC(c.code) && r.kind !== "panel" && !r.mod_cancelled_at && r.qty > 0) rrows.push({ lot: L.no, r });
    rrows.sort((a, b) => lotOf(b.lot) - lotOf(a.lot));
    const relTotal = rrows.reduce((s, x) => s + x.r.qty, 0);
    let reduce = Math.max(0, relTotal - target);
    const lotsChg = [];
    for (const { lot, r } of rrows) {
      if (reduce <= 0) break;
      const lim = limits.get(r.id) || {}; const produced = Number(lim.produced) || 0; const free = lim.free_qr != null ? Number(lim.free_qr) : r.qty;
      const canCut = Math.max(0, Math.min(r.qty - produced, free));
      if (c.type === "cancel" || (reduce >= r.qty && canCut >= r.qty)) {
        push(lot, { release_id: r.id, type: "cancel", keep: "spare", code: r.code, before: r.qty, after: produced });
        lotsChg.push({ lot, before: r.qty, after: produced, cancel: true });
        reduce -= r.qty - produced;
        continue;
      }
      const n = Math.min(reduce, canCut, r.qty - 1);
      if (n > 0) { push(lot, { release_id: r.id, type: "qty", dir: "sub", n, code: r.code, before: r.qty, after: r.qty - n }); lotsChg.push({ lot, before: r.qty, after: r.qty - n }); reduce -= n; }
    }
    if (reduce > 0 && c.type !== "cancel") errors.push(`${c.code}: ปล่อยไปแล้ว ${nf(relTotal)} · ทำแล้ว/ใช้ QR ไปแล้วจนลดได้ถึง ${nf(relTotal - (relTotal - target - reduce))} เท่านั้น`);
    items.push({ kind: c.kind, code: row.code, type: c.type, before: row.qty, after: target, orig: row.orig, lots: lotsChg });
  }
  return { items, lotOps, errors };
}
// บันทึก Modify ลงแผน (ประวัติ M + ยอดใหม่ + เบอร์ยกเลิก/ที่อยู่ยกเลิก/เบอร์เพิ่ม)
export function applyModToPlan(plan, mod) {
  const p = { ...plan, adj: { ...(plan.adj || {}) }, cancel: { ...(plan.cancel || {}) }, cancelAddr: { ...(plan.cancelAddr || {}) }, extra: [...(plan.extra || [])], mods: [...(plan.mods || []), mod] };
  if (mod.bomEdits && mod.bomEdits.length) {
    p.bom = applyBomEdits(plan.bom, mod.bomEdits, mod.ver);
    p.bomEdits = [...(plan.bomEdits || []), ...mod.bomEdits.map((e) => ({ ...e, ver: mod.ver }))];
  }
  for (const it of mod.items) {
    if (it.derived) continue;   // ผลจากการแก้ BOM ลูก — ยอดมาจาก BOM ที่แก้แล้ว ไม่ต้องซ้ำใน adj/cancel/extra
    if (it.type === "cancel") p.cancel[it.code] = mod.ver;
    else if (it.type === "qty") p.adj[it.code] = { qty: it.after, ver: mod.ver };
    else if (it.type === "add") p.extra.push({ kind: it.kind, code: it.code, qty: it.after, d: it.d || "", l: it.l ?? null, inv: it.inv || "", dest: it.dest, mod: mod.ver });
    else if (it.type === "addr") p.cancelAddr[addrKey(it.code)] = mod.ver;
    if (it.type === "add" && it.kind === "sub" && it.procs) p.procOv = { ...(p.procOv || {}), [it.code]: it.procs };
  }
  return p;
}

// ══ Modify BOM ลูก (ซับ / แผง) ══
//   edit = { scope:"sub"|"panel", owner, idx, type:"qty"|"cancel"|"replace"|"add", kind?:"sub"|"part", code (ลูกเดิม), qty?, newCode?, d? }
//   ลูกในรายการ BOM = [type, code, qty, ?, "ยกเลิก"?, ver, qtyเดิม, แทนด้วย, "add"?] — แก้แบบต่อท้าย (ไม่ลบ) เพื่อโชว์ประวัติ
//   แก้ BOM ของแผงแบบไหน = มีผลกับแผงทุกใบของแบบนั้น · แก้ซับ = มีผลกับทุกที่ที่ใช้ซับนั้น
const pad9 = (it) => { const a = [...it]; while (a.length < 9) a.push(undefined); return a; };
export function applyBomEdits(bom, edits, ver = "") {
  const out = { ...bom, panels: { ...bom.panels }, subs: { ...bom.subs }, parts: { ...bom.parts } };
  const done = new Set();
  const own = (scope, code) => {
    const col = scope === "panel" ? out.panels : out.subs; const k = findKey(col, code); if (!k) return null;
    if (!done.has(scope + k)) { col[k] = { ...col[k], items: (col[k].items || []).map(pad9) }; done.add(scope + k); }
    return col[k];
  };
  for (const e of edits || []) {
    const o = own(e.scope, e.owner); if (!o) continue;
    const it = o.items[e.idx];
    if (e.type === "add") {
      const kind = e.kind === "sub" ? "sub" : "part";
      o.items.push([kind, e.code, Number(e.qty) || 0, "", "", ver, null, undefined, "add"]);
      if (kind === "part" && !findKey(out.parts, e.code)) out.parts[e.code] = { k: "part", d: e.d || "" };
      continue;
    }
    if (!it) continue;
    if (it[6] == null && it[8] !== "add") it[6] = it[2];
    if (e.type === "qty") { it[2] = Number(e.qty) || 0; it[5] = ver; }
    else if (e.type === "cancel") { it[4] = "ยกเลิก"; it[5] = ver; }
    else if (e.type === "replace") {
      it[4] = "ยกเลิก"; it[5] = ver; it[7] = e.newCode;
      const q = e.qty != null && e.qty !== "" ? Number(e.qty) : it[6];
      o.items.push([it[0], e.newCode, q, "", "", ver, null, undefined, "add"]);
      if (it[0] !== "sub" && !findKey(out.parts, e.newCode)) { const src = out.parts[findKey(out.parts, it[1])] || {}; out.parts[e.newCode] = { ...src, d: e.d || src.d || "" }; }
    }
  }
  return out;
}
// BOM ก่อนถูกแก้ (ย้อนเครื่องหมายแก้) — ใช้คำนวณยอดเดิมโชว์ขีดฆ่า
export function bomBefore(bom) {
  const fix = (col) => { const o = {}; for (const [k, v] of Object.entries(col || {})) o[k] = v.items && v.items.some((it) => it[6] !== undefined || it[8] === "add") ? { ...v, items: v.items.filter((it) => it[8] !== "add").map((it) => (it[6] != null ? [it[0], it[1], it[6], it[3], ""] : it)) } : v; return o; };
  return { ...bom, panels: fix(bom.panels), subs: fix(bom.subs) };
}
// ผลของการแก้ BOM ต่อยอดต้องปล่อยทั้งใบ → changes (ใช้กับ modifyOps ลดล็อต) + adds (เบอร์ใหม่ที่ถูกใช้)
export function bomEditEffects(plan, edits) {
  const before = needOf(plan);
  const bom2 = applyBomEdits(plan.bom, edits, "");
  const after = needOf({ ...plan, bom: bom2, bomEdits: [...(plan.bomEdits || []), ...edits.map((e) => ({ ...e, ver: "" }))] });
  const changes = [], adds = [];
  for (const [kind, key] of [["sub", "subs"], ["part", "parts"]]) {
    for (const r2 of after[key]) {
      const r1 = before[key].find((x) => NC(x.code) === NC(r2.code));
      const q1 = r1 && !r1.cancelled ? r1.qty : 0; const q2 = r2.cancelled ? 0 : r2.qty;
      if (Math.abs(q1 - q2) < 1e-9) continue;
      if (!r1) adds.push({ kind, code: r2.code, qty: q2, d: r2.d || "", l: r2.l ?? null, inv: r2.inv || "" });
      else if (q2 === 0) changes.push({ kind, code: r2.code, type: "cancel", qty: 0 });
      else changes.push({ kind, code: r2.code, type: "qty", qty: q2 });
    }
  }
  return { changes, adds, after };
}

// ══ ดึง BOM จาก Release อื่นของโปรเจคเดียวกัน ══
//   ปล่อยแผง/ซับบางส่วนโดยยังไม่มี BOM → พอ Release อื่นมี BOM ของเบอร์นั้น ดึงมาเติมให้เองเฉพาะที่ยังว่าง (ไม่ทับของเดิม)
const hasItems = (e) => !!(e && e.items && e.items.some((it) => (it[4] || "") !== "ยกเลิก"));
export function bomGaps(plan) {
  const need = needOf(plan);
  const panels = [...new Set((plan.units || []).filter((u) => !(plan.cancelAddr || {})[addrKey(u.addr)]).map((u) => String(u.unit || "").trim()).filter(Boolean))]
    .filter((u) => !hasItems(plan.bom.panels[findKey(plan.bom.panels, u)]));
  const subs = need.subs.filter((s) => !s.cancelled && !s.added && !hasItems(plan.bom.subs[findKey(plan.bom.subs, s.code)])).map((s) => s.code);
  return { panels, subs };
}
export function pullBomFromPlans(plan, others) {
  const src = (others || []).filter((o) => o.id !== plan.id && (!plan.projectCode || o.projectCode === plan.projectCode) && o.bom);
  if (!src.length) return { plan, filled: [] };
  const clean = (e, ro) => ({ ...e, items: (e.items || []).filter((it) => (it[4] || "") !== "ยกเลิก").map((it) => [it[0], it[1], it[2], it[3] ?? ""]), _from: ro });
  const find = (kind, code) => { for (const o of src) { const col = kind === "panel" ? o.bom.panels : o.bom.subs; const e = col[findKey(col, code)]; if (hasItems(e)) return clean(e, o.ro); } return null; };
  const bom = { ...plan.bom, panels: { ...plan.bom.panels }, subs: { ...plan.bom.subs }, parts: { ...plan.bom.parts } };
  const filled = []; const queue = [];
  const gaps = bomGaps(plan);
  for (const c of gaps.panels) queue.push(["panel", c]);
  for (const c of gaps.subs) queue.push(["sub", c]);
  const seen = new Set();
  while (queue.length) {
    const [kind, code] = queue.shift(); const key = kind + NC(code); if (seen.has(key)) continue; seen.add(key);
    const e = find(kind, code); if (!e) continue;
    const from = e._from; delete e._from;
    (kind === "panel" ? bom.panels : bom.subs)[findKey(kind === "panel" ? bom.panels : bom.subs, code) || code] = e;
    filled.push({ code, kind, from });
    for (const it of e.items) {
      if (it[0] === "sub") { if (!hasItems(bom.subs[findKey(bom.subs, it[1])])) queue.push(["sub", it[1]]); }
      else if (!findKey(bom.parts, it[1])) for (const o of src) { const pk = findKey(o.bom.parts, it[1]); if (pk) { bom.parts[it[1]] = o.bom.parts[pk]; break; } }
    }
  }
  return { plan: filled.length ? { ...plan, bom, bomFrom: { ...(plan.bomFrom || {}), ...Object.fromEntries(filled.map((f) => [f.code, f.from])) } } : plan, filled };
}
export const modVer = (n) => "M-" + String(n).padStart(3, "0");
export function nextModNo(plan, dbNext = 0) { return Math.max(dbNext || 0, ...((plan.mods || []).map((m) => m.no + 1)), 1); }
// ล็อตนี้ถูก Modify อะไรบ้าง (จากประวัติในแผน) → Map code → { orig, cur, ver, cancel }
export function lotModMap(plan, lotNo) {
  const m = new Map();
  for (const mod of plan.mods || []) for (const it of mod.items) for (const l of it.lots || []) {
    if (l.lot !== lotNo) continue;
    const e = m.get(NC(it.code)) || { orig: l.before, cur: l.after, ver: mod.ver, cancel: false };
    e.cur = l.after; e.ver = mod.ver; if (l.cancel) e.cancel = true; m.set(NC(it.code), e);
  }
  return m;
}
// เก็บเฉพาะ BOM ที่ใบนี้ใช้ (แผนเล็กลง)
export function trimBom(bom, need) {
  const keep = (obj, codes) => { const o = {}; for (const c of codes) { const k = findKey(obj, c); if (k) o[k] = obj[k]; } return o; };
  return {
    panels: keep(bom.panels, need.panels.map((p) => p.code)),
    subs: keep(bom.subs, need.subs.map((s) => s.code)),
    parts: keep(bom.parts, [...need.parts, ...need.glass, ...need.hw, ...need.other].map((p) => p.code)),
  };
}
// แถวที่จะส่งให้ create_release_batch ของ 1 ล็อต
//   sel = { addrs:Set, subs:Map(code→qty), parts:Map(code→qty) } · หมายเหตุ "ใบ: …" = ใบงานที่ส่งไป (ดูย้อนหลังได้)
export function lotRows(plan, need, sel, note = "") {
  const rows = [];
  const subLabel = (k) => (SHEETS.find((s) => s.k === k) || {}).label || k;
  for (const p of need.parts) { const q = sel.parts.get(p.code); if (q > 0) rows.push({ kind: "part", code: p.code, qty: Math.round(q), length_mm: p.l ?? null, material: p.inv || null, remark: `ใบ: ${p.dest}`, sheet: [p.dest] }); }
  for (const s of need.subs) { const q = sel.subs.get(s.code); if (q > 0) rows.push({ kind: "subassembly", code: s.code, qty: Math.round(q), length_mm: s.l ?? null, material: null, remark: `ใบ: ${s.procs.map(subLabel).join(", ")}`, sheet: s.procs }); }
  const byUnit = new Map();
  for (const u of plan.units) { const a = String(u.addr || "").trim().toUpperCase(); if (sel.addrs.has(a)) (byUnit.get(u.unit) || byUnit.set(u.unit, []).get(u.unit)).push(a); }
  for (const [unit, addrs] of byUnit) rows.push({ kind: "panel", code: unit, qty: addrs.length, length_mm: null, material: null, remark: [note, addrNote(addrs)].filter(Boolean).join(" · "), sheet: ["panel"], addrs });
  return rows;
}
