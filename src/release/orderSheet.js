// ══════════════════════════════════════════════════════════════════════════
// ★ 2026-11-10 ใบปะหน้า Release "Release for Production / Order" (ฟอร์ม FM(DE)-03) — อ่านจาก Excel (.xls/.xlsx) หรือ PDF
//   หัวใบ: ชื่อโปรเจค + รหัส (A10035-US) · RELEASE : A10035- P-069 · Location / Zone · NOTE · Issued By · Date
//   ตาราง: Item | Part No. | Description | Qty | Remarks  (Qty อาจเป็น "1 set")
//   ใช้ในหน้า "ปล่อยงานใหม่": วางใบนี้ก่อน → ได้เลข Release / โปรเจค / รายการเบอร์ + จำนวนที่ต้องมีในใบ
//   แล้วค่อยวางแบบ PDF ตามเดิม → ระบบเทียบว่าเบอร์ไหนมีแบบ/อยู่ในคลังแล้ว เบอร์ไหนยังขาด จำนวนตรงไหม
// ══════════════════════════════════════════════════════════════════════════
import { NC, normalizeRO, loadPdfJs } from "./releaseCore.js";

const S = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const num = (v) => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(v ?? "").replace(/,/g, "")); return m ? parseFloat(m[0]) : null; };
// "1 set" / "4" / "2 pcs" → { qty, unit }
const qtyOf = (v) => { const t = S(v); const q = num(t); const u = t.replace(/[-\d.,\s]+/, "").trim().toLowerCase(); return { qty: q, unit: u || "" }; };
// "A10035- P-069" / "A10035-P-069" / "P-069" → { project: "A10035", ro: "P-069" }
export function splitRelease(raw) {
  const t = S(raw).toUpperCase();
  const m = /^(?:([A-Z0-9]+(?:-[A-Z]{2})?)\s*-\s*)?(P\s*-?\s*\d+.*)$/i.exec(t);
  if (!m) return { project: "", ro: "" };
  return { project: (m[1] || "").replace(/-[A-Z]{2}$/, "").trim(), ro: normalizeRO(m[2]) };
}
// "Barrington Plaza - (A10035-US)" → { name, code: "A10035-US" }
const splitTitle = (raw) => { const t = S(raw); const m = /^(.*?)\s*-?\s*\(([A-Z0-9-]+)\)\s*$/i.exec(t); return m ? { name: m[1].trim(), code: m[2].toUpperCase() } : { name: t, code: "" }; };
// วันที่ Excel (serial) หรือข้อความ "16/9/2025" → "YYYY-MM-DD" (ไม่รู้ = "")
const dateOf = (v) => {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(S(v));
  if (m) { let y = +m[3]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return `${y}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`; }
  return "";
};
const isHdr = (cells) => { const t = cells.map((c) => S(c).toLowerCase()); return t.some((x) => x === "item") && t.some((x) => /^part\s*no\.?$/.test(x)) && t.some((x) => x === "qty" || x === "qty."); };

// ตารางเซลล์ (แถว × คอลัมน์ · จาก Excel หรือจัดจาก PDF) → ใบปะหน้า
function fromGrid(grid, fileName) {
  const out = { file: fileName, kind: "order", title: "", projectCode: "", projectName: "", ro: "", roRaw: "", zone: "", attention: "", note: "", issuedBy: "", date: "", items: [], warn: [] };
  const rows = grid.map((r) => (r || []).map((c) => c));
  const findLabel = (re) => { for (const r of rows) for (let i = 0; i < r.length; i++) if (re.test(S(r[i]))) return { r, i }; return null; };
  const valueAfter = (re) => { const f = findLabel(re); if (!f) return ""; for (let j = f.i + 1; j < f.r.length; j++) { const v = S(f.r[j]); if (v) return v; } return ""; };
  // "RELEASE :" อาจอยู่ท้ายเซลล์เดียวกับ "( For Action )" · ค่าอยู่เซลล์ถัดไป หรือต่อท้ายในเซลล์เดียวกัน
  const rel = findLabel(/RELEASE\s*:/i);
  let roRaw = "";
  if (rel) { const cell = S(rel.r[rel.i]); const m = /RELEASE\s*:\s*(\S.*)$/i.exec(cell); roRaw = m ? m[1] : ""; if (!roRaw) for (let j = rel.i + 1; j < rel.r.length; j++) { const v = S(rel.r[j]); if (v) { roRaw = v; break; } } }
  if (roRaw) { const sp = splitRelease(roRaw); out.roRaw = roRaw; out.ro = sp.ro; out.projectCode = sp.project; }
  for (const r of rows.slice(0, 12)) { const t = r.map(S).filter(Boolean).join(" "); const m = splitTitle(t); if (m.code && /^[A-Z]\d{4,}/.test(m.code)) { out.title = t; out.projectName = m.name; if (!out.projectCode) out.projectCode = m.code.replace(/-[A-Z]{2}$/, ""); out.projectFull = m.code; break; } }
  out.zone = valueAfter(/^Location\s*\/?\s*Zone\s*:?$/i);
  out.attention = valueAfter(/^Attention\s*:?$/i);
  out.note = valueAfter(/^NOTE\s*:?$/i);
  out.issuedBy = valueAfter(/^Issued\s*By\s*:?$/i);
  { const f = findLabel(/^Date\s*:?$/i); if (f) for (let j = f.i + 1; j < f.r.length; j++) { const v = f.r[j]; if (v !== "" && v != null) { out.date = dateOf(v); break; } } }
  const hi = rows.findIndex(isHdr);
  if (hi < 0) { out.warn.push("ไม่พบหัวตาราง Item / Part No. / Qty"); return out; }
  const hdr = rows[hi].map((c) => S(c).toLowerCase());
  const col = (re) => hdr.findIndex((x) => re.test(x));
  const cItem = col(/^item$/), cCode = col(/^part\s*no\.?$/), cDesc = col(/^description$/), cQty = col(/^qty\.?$/), cRem = col(/^remarks?$/);
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]; const cells = r.map(S);
    if (!cells.some(Boolean)) continue;
    if (cells.some((c) => /^(NOTE|Issued By|Approved By|Date)\s*:?$/i.test(c))) break;
    const code = S(r[cCode]); const item = num(r[cItem]);
    if (!code) { if (item == null) continue; out.warn.push(`แถว Item ${item}: ไม่มี Part No.`); continue; }
    const q = qtyOf(r[cQty]);
    out.items.push({ item, code: code.toUpperCase(), d: cDesc >= 0 ? S(r[cDesc]) : "", qty: q.qty, unit: q.unit, remark: cRem >= 0 ? S(r[cRem]) : "" });
    if (q.qty == null) out.warn.push(`${code}: ไม่มีจำนวน`);
  }
  return out;
}

export async function readOrderXlsx(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  // ชีตที่มีหัวตาราง (ปกติ "form-01") — ไม่มี = ชีตแรก
  let best = null;
  for (const n of wb.SheetNames) { const g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, blankrows: false, defval: "" }); if (g.some(isHdr)) { best = g; break; } if (!best) best = g; }
  return fromGrid(best || [], file.name);
}
export async function readOrderPdf(file) { return readOrderPdfWith(await loadPdfJs(), file); }
export async function readOrderPdfWith(pdfjsLib, file) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const page = await doc.getPage(1); const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent();
  const ws = [];
  for (const it of tc.items) { const s = it.str; if (!s || !s.trim()) continue; const tx = pdfjsLib.Util.transform(vp.transform, it.transform); const size = Math.hypot(tx[2], tx[3]); ws.push({ s: s.trim(), x0: tx[4], x1: tx[4] + (it.width * vp.scale || s.length * size * 0.5), top: tx[5] - size * 0.78 }); }
  try { doc.destroy(); } catch { /* ignore */ }
  // จัดเป็นบรรทัด → หาหัวตารางเพื่อรู้ขอบคอลัมน์ → แถวใต้หัวตารางแยกเซลล์ตามคอลัมน์ · บรรทัดอื่นแยกด้วยช่องว่างกว้าง
  const lines = []; for (const w of ws.sort((a, b) => a.top - b.top || a.x0 - b.x0)) { const L = lines[lines.length - 1]; if (L && Math.abs(L.top - w.top) <= 3) L.w.push(w); else lines.push({ top: w.top, w: [w] }); }
  lines.forEach((L) => L.w.sort((a, b) => a.x0 - b.x0));
  const hdrLine = lines.find((L) => { const t = L.w.map((w) => w.s.toLowerCase()); return t.includes("item") && t.some((x) => /^part$|^part no\.?$/.test(x)) && t.some((x) => /^qty\.?$/.test(x)); });
  let cols = null;
  if (hdrLine) {
    // รวม "Part" + "No." · คอลัมน์ = [ชื่อ, x เริ่ม]
    const merged = []; for (const w of hdrLine.w) { const last = merged[merged.length - 1]; if (last && /^part$/i.test(last.s) && /^no\.?$/i.test(w.s)) { last.s = "Part No."; last.x1 = w.x1; } else merged.push({ ...w }); }
    cols = merged.map((w, i) => ({ name: w.s, x0: i ? (merged[i - 1].x1 + w.x0) / 2 : -1e9, x1: i + 1 < merged.length ? (w.x1 + merged[i + 1].x0) / 2 : 1e9 }));
  }
  const grid = lines.map((L) => {
    const below = cols && L.top > hdrLine.top - 1;
    if (below) { const cells = cols.map(() => []); for (const w of L.w) { const cx = (w.x0 + w.x1) / 2; const i = cols.findIndex((c) => cx >= c.x0 && cx < c.x1); (cells[i < 0 ? cols.length - 1 : i]).push(w.s); } return cells.map((c) => c.join(" ")); }
    const cells = []; let cur = null;
    for (const w of L.w) { if (cur && w.x0 - cur.x1 < 14) { cur.s += " " + w.s; cur.x1 = w.x1; } else { cur = { s: w.s, x1: w.x1 }; cells.push(cur); } }
    // "Attention : SATANEE" → แยกป้ายกับค่า
    return cells.flatMap((c) => { const m = /^([A-Za-z /]+?\s*:)\s*(.*)$/.exec(c.s); return m && m[2] ? [m[1], m[2]] : [c.s]; });
  });
  return fromGrid(grid, file.name);
}
export async function readOrderFile(file) {
  if (/\.pdf$/i.test(file.name)) return readOrderPdf(file);
  if (/\.(xlsx?|xlsm)$/i.test(file.name)) return readOrderXlsx(file);
  throw new Error("รองรับ .pdf / .xls / .xlsx");
}
// เทียบรายการในใบปะหน้า กับของที่จะอยู่ในใบ (plan จาก needOf / planRelease) → ต่อรายการ: found / qty ตรงไหม
//   kinds: panels (code=แบบแผง, qty=จำนวนแผง) · subs · parts · hw/glass/other (ใบเบิก)
export function compareOrder(order, plan) {
  if (!order || !plan) return [];
  const idx = new Map();
  const put = (list, kind) => { for (const x of list || []) { const k = NC(x.code); const e = idx.get(k) || { qty: 0, kind }; e.qty += Number(x.qty) || 0; idx.set(k, e); } };
  put(plan.panels, "panel"); put(plan.subs, "sub"); put(plan.parts, "part"); put(plan.hw, "hw"); put(plan.glass, "glass"); put(plan.other, "other");
  return order.items.map((it) => {
    const e = idx.get(NC(it.code));
    if (!e) return { ...it, status: "missing", have: 0 };
    const ok = it.qty == null || Math.abs(e.qty - it.qty) < 1e-9;
    return { ...it, status: ok ? "ok" : e.qty > it.qty ? "more" : "less", have: e.qty, kind: e.kind };
  });
}
