// ══════════════════════════════════════════════════════════════════════════
// แผนลงตู้ (Container loading plan) — บั้งไหนลงตู้ไหน shipment ไหน
//   ★ 2026-11-23 ผู้ใช้: "packing ลงแบบนี้ได้ไหม" (แบบลงตู้ PDF จาก CAD) → "ให้ลงได้ทั้ง pdf และ excel แล้วให้แก้ได้ด้วย"
//   อ่านได้ 2 ทาง แล้วให้ผู้ใช้ตรวจ / แก้ก่อนบันทึก (ตัวอ่านเป็นแค่ร่าง):
//     PDF   แบบลงตู้จาก CAD — ป้าย "CNTR-013" + เลขบั้งรอบ ๆ + "SHIPMENT#06" ต่อหน้า
//     Excel ไฟล์ Pack Unit — ชีต Data (คอลัมน์ Bunk # / CNTR # / Shipment #) · ชีต "L3 Ship#BB06" (หัว BUNK NO.) ได้ shipment แต่ไม่มีเลขตู้
//   ฟังก์ชันในไฟล์นี้ไม่แตะ DOM / ฐานข้อมูล → ชุดทดสอบ (tests/js_bridge.mjs) เรียกตรง ๆ ได้
//   แถวผลลัพธ์: { shipment, container_no, bunk_no, row_no, col_no, len_mm, w_mm }
// ══════════════════════════════════════════════════════════════════════════

const up = (s) => String(s == null ? "" : s).trim().toUpperCase();
export const bunkKey = (s) => up(s).replace(/\s+/g, "");
// เลขตู้: "cntr 13" / "CNTR-013" → "CNTR-013" (เลขอย่างน้อย 3 หลัก) · รูปแบบอื่น = ตัดช่องว่างหัวท้าย + ตัวพิมพ์ใหญ่
export function normContainer(s) {
  const t = up(s); if (!t) return "";
  const m = /^CNTR\s*[-#]?\s*0*(\d+)$/.exec(t);
  return m ? `CNTR-${m[1].padStart(3, "0")}` : t.replace(/\s+/g, " ");
}
// shipment: "#BB04" / "bb04" / "Ship#BB05-1" / "SHIPMENT#06" (+ คำนำหน้าจากเลขบั้ง "BB") → "#BB04"
export function normShipment(s, prefix = "") {
  let t = up(s).replace(/^SHIP(MENT)?\s*/, "").replace(/^#\s*/, "").replace(/\s+/g, ""); if (!t) return "";
  const m = /^([A-Z]*)0*(\d+)(.*)$/.exec(t);
  if (!m) return `#${t}`;
  return `#${m[1] || up(prefix)}${m[2].padStart(2, "0")}${m[3]}`;
}
// คำที่ดูเป็น "เลขบั้ง / ของที่ลงตู้": ตัวอักษรนำ มีขีดคั่น ไม่มีช่องว่าง (BB-L03-C02 · BB-CPG-001 · BB-L01-L08-SB1)
//   ไม่นับ: ป้ายตู้ (CNTR-…) · หมายเหตุท้ายแบบที่ขึ้นต้นด้วย "-" (-L03 CW, -BB-L04-C01) · ตัวเลขล้วน / ขนาด
const BUNK_RE = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;
export const looksLikeBunk = (s) => { const t = up(s); return BUNK_RE.test(t) && !/^CNTR\b/.test(t) && /\d/.test(t); };

// ── PDF ── items = ข้อความ 1 หน้า [{ s, x, y }] (y นับจากบนลงล่าง) → { rows, warn }
//   ในแบบ: 1 ตู้ = บั้ง 2 แถว (แถวบน / แถวล่าง) · ป้าย CNTR อยู่ซ้ายมือระดับเดียวกับแถวล่าง · ประตู (DOOR) อยู่ขวา
//   → บั้งเป็นของตู้ที่ป้ายอยู่ "ใกล้ที่สุดในแนวตั้ง" · ใต้เลขบั้ง ~18 pt คือความยาว · ขวามือระดับเดียวกันคือความกว้าง
export function parseContainerPage(items) {
  const its = (items || []).map((i) => ({ s: String(i.s || "").trim(), x: Number(i.x) || 0, y: Number(i.y) || 0 })).filter((i) => i.s);
  const cntr = its.filter((i) => /^CNTR\s*[-#]?\s*\d+$/i.test(i.s)).sort((a, b) => a.y - b.y);
  const ships = its.map((i) => { const m = /^SHIPMENT\s*#\s*([A-Z0-9-]+)/i.exec(i.s); return m ? { no: m[1], y: i.y } : null; }).filter(Boolean);
  const bunks = its.filter((i) => looksLikeBunk(i.s));
  const nums = its.filter((i) => /^\d{3,5}$/.test(i.s)).map((i) => ({ ...i, n: Number(i.s) }));
  const warn = [];
  if (!cntr.length) return { rows: [], warn: bunks.length ? ["ไม่พบป้ายตู้ (CNTR-…) ในหน้านี้"] : [] };
  // ระยะห่างระหว่างตู้ (ไว้กันบั้งที่อยู่ไกลเกิน เช่น ตารางหมายเหตุ) — ตู้เดียวทั้งหน้า = ไม่จำกัด
  let gap = Infinity; for (let i = 1; i < cntr.length; i++) gap = Math.min(gap, cntr[i].y - cntr[i - 1].y);
  const lim = gap === Infinity ? Infinity : gap * 0.6;
  const prefix = (() => { const c = {}; bunks.forEach((b) => { const p = up(b.s).split("-")[0]; c[p] = (c[p] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ""; })();
  const shipOf = (y) => { if (!ships.length) return ""; const s = ships.slice().sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0]; return normShipment(s.no, prefix); };
  const by = new Map();
  for (const b of bunks) {
    const c = cntr.slice().sort((a, z) => Math.abs(a.y - b.y) - Math.abs(z.y - b.y))[0];
    if (Math.abs(c.y - b.y) > lim) continue;
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(b);
  }
  const rows = [];
  for (const c of cntr) {
    const list = (by.get(c) || []).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!list.length) { warn.push(`${normContainer(c.s)}: ไม่พบเลขบั้งในตู้`); continue; }
    // จัดแถว: y ห่างกันไม่เกิน 12 pt = แถวเดียวกัน
    const lines = []; for (const b of list) { const l = lines[lines.length - 1]; if (l && Math.abs(l.y - b.y) <= 12) l.it.push(b); else lines.push({ y: b.y, it: [b] }); }
    const ship = ships.length === 1 ? normShipment(ships[0].no, prefix) : shipOf(c.y);
    if (lines.length > 2) warn.push(`${normContainer(c.s)}: จัดวางไม่ใช่ 2 แถวปกติ (${list.length} รายการ) — ตรวจตำแหน่งแถว / ช่องอีกครั้ง`);
    lines.forEach((l, ri) => l.it.sort((a, b) => a.x - b.x).forEach((b, ci) => {
      const len = nums.filter((n) => n.y - b.y >= 8 && n.y - b.y <= 32 && Math.abs(n.x - (b.x + 12)) <= 36).sort((a, z) => (a.y - b.y) - (z.y - b.y))[0];
      const wid = nums.filter((n) => Math.abs(n.y - b.y) <= 8 && n.x - b.x >= 40 && n.x - b.x <= 150).sort((a, z) => a.x - z.x)[0];
      rows.push({ shipment: ship, container_no: normContainer(c.s), bunk_no: up(b.s), row_no: ri + 1, col_no: ci + 1, len_mm: len ? len.n : null, w_mm: wid ? wid.n : null });
    }));
  }
  return { rows, warn };
}
// หลายหน้า → รวม (บั้งซ้ำข้ามหน้า = เก็บตัวแรก แล้วเตือน)
export function parseContainerPages(pages) {
  const rows = []; const warn = []; const seen = new Map();
  (pages || []).forEach((items, pi) => {
    const r = parseContainerPage(items);
    r.warn.forEach((w) => warn.push(`หน้า ${pi + 1}: ${w}`));
    for (const row of r.rows) {
      const k = bunkKey(row.bunk_no);
      if (seen.has(k)) { const o = seen.get(k); if (o.container_no !== row.container_no) warn.push(`${row.bunk_no} อยู่ทั้งตู้ ${o.container_no} และ ${row.container_no} (หน้า ${pi + 1}) — ใช้ ${o.container_no}`); continue; }
      seen.set(k, row); rows.push(row);
    }
  });
  return { rows, warn };
}
export async function readContainerPdfWith(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent();
    pages.push(tc.items.filter((it) => it.str && it.str.trim()).map((it) => { const tx = pdfjsLib.Util.transform(vp.transform, it.transform); return { s: it.str.trim(), x: tx[4], y: tx[5] }; }));
  }
  return { ...parseContainerPages(pages), pages: doc.numPages };
}

// ── Excel ── sheets = [{ name, rows: [[เซลล์…]…] }] → { rows, warn, sheets: [{ name, n, how }] }
//   (ก) ชีตที่มีหัวตาราง "Bunk #" + "CNTR #" (+ "Shipment #")  → บั้ง → ตู้ + shipment
//   (ข) ชีตชื่อ "… Ship#BBxx" ที่มีหัว "BUNK NO."               → บั้ง → shipment (ไม่มีเลขตู้ — กรอกเองหรือนำเข้า PDF ทับ)
//   (ค) ชีตแผนส่งของ "Shipment Loading" (หัวตาราง "Shipment" + "Pallet No.")  → 1 ช่องมีหลายบั้งคั่นด้วย , · ตู้จากช่อง "Con No.13"
//        shipment ว่าง = ใช้ของแถวบน · แถว TOTAL ข้าม · ข้อความในวงเล็บตัดทิ้ง · แถวที่ไม่มี Con No. = ยังไม่ระบุตู้ (ไม่เดา)
//        ไฟล์นี้มีหลายตึกคนละชีต → แถวติดชื่อชีต (sheet) + sheets[].kind = "plan" ให้หน้าจอถามว่าจะเอาชีตไหน
//   ชีตชื่อมี OLD ข้าม · บั้งเดียวกันเจอทั้ง (ก) และ (ข) = ใช้ (ก)
export function parseContainerSheets(sheets) {
  const rows = []; const warn = []; const info = []; const at = new Map();
  const put = (r, strong) => {
    const k = bunkKey(r.bunk_no); if (!k) return false;
    if (at.has(k)) {
      const o = at.get(k);
      if (strong && !o._strong) { Object.assign(o, r, { _strong: true }); return true; }
      if (strong && o._strong && r.container_no && o.container_no && r.container_no !== o.container_no && !o._warned) { o._warned = true; warn.push(`${r.bunk_no} อยู่ทั้งตู้ ${o.container_no} และ ${r.container_no} — ใช้ ${o.container_no}`); }
      if (!o.shipment && r.shipment) o.shipment = r.shipment;
      return false;
    }
    const n = { ...r, _strong: !!strong }; at.set(k, n); rows.push(n); return true;
  };
  for (const sh of sheets || []) {
    const name = String(sh.name || ""); const data = sh.rows || [];
    if (/\bOLD\b/i.test(name)) { info.push({ name, n: 0, how: "ข้าม (ชีต OLD)" }); continue; }
    const cell = (r, j) => String((r || [])[j] == null ? "" : r[j]).trim();
    // (ค) แผนส่งของ: หัวตารางมี "Shipment" และ "Pallet No."
    {
      let ph = -1, cS2 = -1, cP = -1;
      for (let i = 0; i < Math.min(data.length, 15) && ph < 0; i++) {
        const r = data[i] || []; let a = -1, b = -1;
        for (let j = 0; j < r.length; j++) { const v = up(r[j]); if (a < 0 && /^SHIPMENT$/.test(v)) a = j; if (b < 0 && /^PALLET\s*NO\.?$/.test(v)) b = j; }
        if (a >= 0 && b >= 0) { ph = i; cS2 = a; cP = b; }
      }
      if (ph >= 0) {
        let n = 0, ship = "";
        for (let i = ph + 1; i < data.length; i++) {
          const r = data[i] || []; const sv = cell(r, cS2); if (sv) ship = normShipment(sv);
          const pv = cell(r, cP).replace(/\([^)]*\)/g, " "); if (!pv.trim() || /^TOTAL$/i.test(pv.trim())) continue;
          let c = ""; for (let j = 0; j < r.length && !c; j++) { const m2 = /^CON(?:TAINER)?\.?\s*NO\.?\s*0*(\d+)$/i.exec(cell(r, j)); if (m2) c = normContainer("CNTR-" + m2[1]); }
          for (const tok of pv.split(/[,;\n]+/)) {
            const b = up(tok).replace(/\s+/g, " "); if (!b || b.length > 60 || !/[A-Z]/.test(b) || !/\d/.test(b)) continue;
            if (put({ shipment: ship, container_no: c, bunk_no: b, row_no: null, col_no: null, len_mm: null, w_mm: null, sheet: name }, !!c)) n++;
          }
        }
        info.push({ name, n, how: "แผนส่งของ (Shipment / Pallet No.)", kind: "plan" }); continue;
      }
    }
    // (ก) หาแถวหัวตาราง
    let hi = -1, cB = -1, cC = -1, cS = -1;
    for (let i = 0; i < Math.min(data.length, 40) && hi < 0; i++) {
      const r = data[i] || []; let b = -1, c = -1, s = -1;
      for (let j = 0; j < r.length; j++) { const v = up(r[j]); if (b < 0 && /^BUNK\s*(#|NO\.?)$/.test(v)) b = j; if (c < 0 && /^(CNTR|CONTAINER)\s*(#|NO\.?)?$/.test(v)) c = j; if (s < 0 && /^SHIP(MENT)?\s*(#|NO\.?)?$/.test(v)) s = j; }
      if (b >= 0 && c >= 0) { hi = i; cB = b; cC = c; cS = s; }
    }
    if (hi >= 0) {
      let n = 0;
      for (let i = hi + 1; i < data.length; i++) {
        const b = up(cell(data[i], cB)); if (!b) continue;
        const c = normContainer(cell(data[i], cC)); const s = cS >= 0 ? normShipment(cell(data[i], cS)) : "";
        if (at.has(bunkKey(b)) && at.get(bunkKey(b))._strong) { put({ bunk_no: b, container_no: c, shipment: s }, true); continue; }
        if (put({ shipment: s, container_no: c, bunk_no: b, row_no: null, col_no: null, len_mm: null, w_mm: null }, true)) n++;   // Excel ไม่มีตำแหน่งในตู้ (ลำดับในตารางไม่ใช่ตำแหน่ง) → ไม่ทับแถว / ช่องที่ได้จาก PDF
      }
      info.push({ name, n, how: "ตาราง Bunk # / CNTR #" }); continue;
    }
    // (ข) ชีต Ship#…
    const m = /SHIP\s*#\s*([A-Z0-9-]+)/i.exec(name);
    if (m) {
      const ship = normShipment(m[1]); let n = 0, found = 0;
      for (let i = 0; i < data.length; i++) {
        if (!/^BUNK\s*NO/i.test(cell(data[i], 0))) continue;
        const r = data[i] || []; let b = "";
        for (let j = 1; j < r.length && !b; j++) { const v = up(r[j]); if (v && !/:$/.test(v) && !/^BUNK\s*ID/.test(v)) b = v; }
        if (!b) continue; found++;
        if (put({ shipment: ship, container_no: "", bunk_no: b, row_no: null, col_no: null, len_mm: null, w_mm: null }, false)) n++;
      }
      info.push({ name, n, how: n ? "ชีต Ship# (ไม่มีเลขตู้)" : found ? `บั้ง ${found} บั้งมีในตาราง Bunk # / CNTR # แล้ว` : "ข้าม (ไม่มีหัว BUNK NO.)" }); continue;
    }
    info.push({ name, n: 0, how: "ข้าม (ไม่มีคอลัมน์ Bunk # / CNTR #)" });
  }
  rows.forEach((r) => { delete r._strong; delete r._warned; });
  return { rows, warn, sheets: info };
}

// ── รวมของที่นำเข้าเข้ากับแผนที่มีอยู่ (เทียบด้วยเลขบั้ง) ──
//   ช่องที่ของใหม่ "ว่าง" ไม่ทับของเดิม (นำเข้า Excel ที่ไม่มีเลขตู้ ต้องไม่ล้างเลขตู้ที่ได้จาก PDF)
//   คืน { rows, added, changed, same } · แถวที่เปลี่ยนติด _dirty · แถวใหม่ไม่มี id
const FIELDS = ["shipment", "container_no", "row_no", "col_no", "len_mm", "w_mm"];
export function mergePlanRows(cur, incoming) {
  const rows = (cur || []).map((r) => ({ ...r })); const idx = new Map();
  rows.forEach((r, i) => { if (!r._del) idx.set(bunkKey(r.bunk_no), i); });
  let added = 0, changed = 0, same = 0;
  for (const n of incoming || []) {
    const k = bunkKey(n.bunk_no); if (!k) continue;
    if (!idx.has(k)) { idx.set(k, rows.length); rows.push({ ...n, bunk_no: up(n.bunk_no), _dirty: true, _new: true }); added++; continue; }
    const o = rows[idx.get(k)]; let diff = false;
    const moved = !!n.container_no && n.container_no !== (o.container_no || "");
    for (const f of FIELDS) {
      let v = n[f];
      if (v == null || v === "") { if (moved && (f === "row_no" || f === "col_no")) v = null; else continue; }   // ย้ายตู้แล้วไม่รู้ตำแหน่งใหม่ = ล้างตำแหน่งเดิม
      if ((o[f] == null ? "" : String(o[f])) !== (v == null ? "" : String(v))) { o[f] = v; diff = true; }
    }
    if (diff) { o._dirty = true; changed++; } else same++;
  }
  return { rows, added, changed, same };
}

// เรียงแสดง: shipment → ตู้ (ไม่มีเลขตู้ไว้ท้าย) → แถว → ช่อง → เลขบั้ง
const natCmp = (a, b) => String(a || "").localeCompare(String(b || ""), "en", { numeric: true });
export function sortPlanRows(rows) {
  return (rows || []).slice().sort((a, b) => natCmp(a.shipment, b.shipment) || (!a.container_no - !b.container_no) || natCmp(a.container_no, b.container_no)
    || ((a.row_no || 99) - (b.row_no || 99)) || ((a.col_no || 99) - (b.col_no || 99)) || natCmp(a.bunk_no, b.bunk_no));
}
// ตรวจก่อนบันทึก → รายการข้อผิดพลาด (ว่าง = ผ่าน)
export function validatePlanRows(rows) {
  const errs = []; const seen = new Map();
  for (const r of (rows || []).filter((x) => !x._del)) {
    const k = bunkKey(r.bunk_no);
    if (!k) { errs.push("มีแถวที่ไม่มีเลขบั้ง"); continue; }
    if (k.length > 60) errs.push(`เลขบั้งยาวเกิน 60 ตัวอักษร: ${r.bunk_no}`);
    if (seen.has(k)) errs.push(`เลขบั้งซ้ำ: ${up(r.bunk_no)}`); seen.set(k, 1);
    for (const f of ["len_mm", "w_mm"]) if (r[f] != null && r[f] !== "" && !(Number(r[f]) > 0 && Number(r[f]) <= 30000)) errs.push(`${up(r.bunk_no)}: ขนาดต้องเป็นตัวเลข 1–30000 มม.`);
    for (const f of ["row_no", "col_no"]) if (r[f] != null && r[f] !== "" && !(Number.isInteger(Number(r[f])) && Number(r[f]) >= 1 && Number(r[f]) <= 99)) errs.push(`${up(r.bunk_no)}: แถว / ช่อง ต้องเป็นเลข 1–99`);
  }
  return [...new Set(errs)];
}
