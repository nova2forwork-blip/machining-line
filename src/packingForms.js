// ══════════════════════════════════════════════════════════════════════════
// ตารางแพ็กกิ้ง — อ่าน "ใบแพ็ก" (ฟอร์ม BOX NO. / BUNK NO.) จาก Excel และ PDF → กล่อง / บั้ง + รายการของข้างใน
//   ★ 2026-11-23 ผู้ใช้: "ให้ลงข้อมูลคล้าย ๆ ปล่อยงาน แต่เป็น packing ให้ลงไฟล์ pdf หรือ excel แล้วจะได้ตารางแพ็กกิ้งมา
//      ให้แก้ตารางได้ แล้วเลือกว่าจะแก้เป็น modify หรือแก้ธรรมดาได้"
//   ฟอร์มที่ใช้อยู่ (ทุกชนิดหน้าตาเดียวกัน):
//     BOX NO. / BUNK NO.  │ เลขกล่อง        LOCATION / ELEVATION │ …     LEVEL │ …     PROJECT NO. │ (ชื่องาน เช่น ANCHOR) │ ชื่อโปรเจค
//     No. │ Part Name / Unit No. / LV Name │ Description │ Length / Width / Height (mm) │ … │ Quantity / Qty. / TOTAL │ Unit / UoM │ Weight
//     … รายการ …  แล้วจบด้วยแถว TOTAL
//   1 ชีต / 1 หน้า มีได้หลายกล่องต่อกัน · ไฟล์ PDF คือฟอร์มเดียวกันที่พิมพ์ออกมา (อ่านตามตำแหน่งคอลัมน์ — ให้ตรวจตารางอีกครั้ง)
//   กล่อง: { box_no, kind: "panel" | "loose", title, location, level, ship, items: [{ item, desc, pos, addr, len, w, h, unit, qty, wt }] }
//   ฟังก์ชันในไฟล์นี้ไม่แตะ DOM / ฐานข้อมูล → ทดสอบจาก tests/ ได้
// ══════════════════════════════════════════════════════════════════════════
const up = (s) => String(s == null ? "" : s).trim().toUpperCase();
const txt = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
export const boxKey = (s) => up(s).replace(/\s+/g, "");
const numOf = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/,/g, "").trim()); return isFinite(n) ? Math.round(n * 1000) / 1000 : null; };
const ITEM_FIELDS = ["item", "desc", "pos", "addr", "len", "w", "h", "unit", "qty", "wt"];
export const blankItem = () => ({ item: "", desc: "", pos: "", addr: "", len: null, w: null, h: null, unit: "", qty: 1, wt: null });

// หัวคอลัมน์ → ช่องข้อมูล (เรียงตามความเจาะจง: "Unit No." ต้องมาก่อน "Unit")
function fieldOf(h) {
  const t = up(h).replace(/\s+/g, " ").replace(/[.:]+$/, "");
  if (!t) return null;
  if (/^NO$/.test(t)) return "no";
  if (/^(PART NO|UNIT NO|ITEM|ITEM NO|([A-Z]+ )?NAME)$/.test(t)) return "item";   // Part Name / LV Name / Mesh Name …
  if (/^DESCRIPTION$/.test(t)) return "desc";
  if (/^(BUNK )?POSITION$/.test(t)) return "pos";
  if (/^ADDRESS( SEQUENCE| #)?$/.test(t)) return "addr";
  if (/^(LENGTH|DIM)\b.*\(?MM\)?$/.test(t) || /^LENGTH$/.test(t)) return "len";
  if (/^WIDTH\b.*MM\)?$/.test(t) || /^WIDTH$/.test(t)) return "w";
  if (/^HEIGHT\b.*MM\)?$/.test(t) || /^HEIGHT$/.test(t)) return "h";
  if (/^(UNIT|UOM)$/.test(t)) return "unit";
  if (/^(QUANTITY|QTY|QUANTITY UNIT|Q'TY)$/.test(t)) return "qty";
  if (/^TOTAL$/.test(t)) return "total";
  if (/^(WEIGHT.*|TOTAL KG)$/.test(t)) return "wt";
  return null;
}
const isBoxHead = (v) => /^(BOX|BUNK)\s*(NO|ID)\b/.test(up(v));

// ── Excel ── rows = แถวของ 1 ชีต ([[เซลล์…]…]) → กล่องทั้งหมดในชีต
export function parseBoxRows(rows, src = "") {
  const out = []; const starts = [];
  for (let i = 0; i < (rows || []).length; i++) if (isBoxHead((rows[i] || [])[0])) starts.push(i);
  for (let b = 0; b < starts.length; b++) {
    const seg = rows.slice(starts[b], b + 1 < starts.length ? starts[b + 1] : rows.length);
    const firstVal = (r) => { for (let j = 1; j < (r || []).length; j++) { const v = txt(r[j]); if (v && !/:$/.test(v) && !isBoxHead(v)) return v; } return ""; };
    const box = { box_no: up(firstVal(seg[0])), kind: /^BUNK/.test(up(seg[0][0])) ? "panel" : "loose", title: "", location: "", level: "", ship: "", items: [], src };
    // ฟอร์ม Mock-up: เลขอยู่แถวถัดไป (แถวนั้นช่องแรกว่าง) — แถวถัดไปที่เป็นหัวข้ออื่น / หัวตาราง ไม่ใช่เลขกล่อง
    if (!box.box_no && seg[1] && !txt(seg[1][0])) box.box_no = up(firstVal(seg[1]));
    let hi = -1;
    for (let i = 1; i < Math.min(seg.length, 12) && hi < 0; i++) {
      const r = seg[i] || []; const k = up(r[0]).replace(/[.:\s]+$/, "");
      if (/^(LOCATION|ELEVATION)$/.test(k)) box.location = firstVal(r);
      else if (/^LEVEL$/.test(k)) box.level = firstVal(r);
      else if (/^PROJECT( NO)?$/.test(k)) { const vals = r.slice(1).map(txt).filter(Boolean); if (vals.length > 1) box.title = vals[0]; }
      else if (/^NO$/.test(k)) hi = i;
    }
    if (!box.box_no) continue;
    if (hi < 0) { out.push(box); continue; }
    // คอลัมน์: ช่องแรกที่เจอของแต่ละชนิด · มีทั้ง Quantity และ TOTAL = ใช้ Quantity · ไม่มี Quantity = ใช้ TOTAL
    const col = {}; const hdr = seg[hi] || [];
    for (let j = 0; j < hdr.length; j++) { const f = fieldOf(hdr[j]); if (f && col[f] == null) col[f] = j; }
    if (col.qty == null && col.total != null) col.qty = col.total;
    if (col.pos != null || col.addr != null) box.kind = "panel";
    for (let i = hi + 1; i < seg.length; i++) {
      const r = seg[i] || [];
      if (r.some((c) => /^TOTAL$/.test(up(c)))) break;   // แถวรวมท้ายตาราง
      const item = txt(r[col.item ?? 1]); if (!item) continue;
      if (col.no != null && !/^\d+(\.0+)?$/.test(txt(r[col.no]))) continue;
      const it = blankItem();
      it.item = up(item); it.desc = col.desc != null ? txt(r[col.desc]) : ""; it.pos = col.pos != null ? up(r[col.pos]) : ""; it.addr = col.addr != null ? txt(r[col.addr]) : "";
      it.len = col.len != null ? numOf(r[col.len]) : null; it.w = col.w != null ? numOf(r[col.w]) : null; it.h = col.h != null ? numOf(r[col.h]) : null;
      it.unit = col.unit != null ? txt(r[col.unit]) : ""; it.wt = col.wt != null ? numOf(r[col.wt]) : null;
      const q = col.qty != null ? numOf(r[col.qty]) : null; it.qty = q != null && q > 0 ? q : 1;
      box.items.push(it);
    }
    out.push(box);
  }
  return out;
}
// sheets = [{ name, rows }] → { boxes, warn, sheets: [{ name, n }] } · เลขกล่องซ้ำข้ามชีต = เก็บตัวแรก (เตือน) · ชีตชื่อ OLD ข้าม
//   ชื่อชีตมี "Ship#BB06" = ชิปของทุกกล่องในชีตนั้น
export function parseBoxSheets(sheets) {
  const boxes = []; const warn = []; const info = []; const seen = new Map();
  for (const sh of sheets || []) {
    const name = String(sh.name || "");
    if (/\bOLD\b/i.test(name)) { info.push({ name, n: 0, skipped: "OLD" }); continue; }
    const m = /SHIP\s*#\s*([A-Z0-9-]+)/i.exec(name); const ship = m ? "#" + up(m[1]).replace(/^#/, "") : "";
    let n = 0;
    for (const b of parseBoxRows(sh.rows || [], name)) {
      const k = boxKey(b.box_no);
      if (seen.has(k)) { if (!seen.get(k)._w) { seen.get(k)._w = true; warn.push(`${b.box_no} มีมากกว่า 1 ใบ (ชีต ${seen.get(k).src.trim()} และ ${name.trim()}) — ใช้ใบแรก`); } continue; }
      if (ship) b.ship = ship;
      seen.set(k, b); boxes.push(b); n++;
    }
    info.push({ name, n });
  }
  boxes.forEach((b) => { delete b._w; });
  return { boxes, warn, sheets: info };
}

// ── PDF ── items = ข้อความ 1 หน้า [{ s, x, y }] (y จากบนลงล่าง) → กล่องในหน้านั้น
//   รวมข้อความเป็นบรรทัด (y ห่างไม่เกิน 4.5 pt) · บรรทัดหัวตาราง = มี "No." และ "Description" · หัวที่อยู่คนละบรรทัด (Length / Height ด้านบน) เก็บมาด้วย
//   ค่าในแต่ละแถวเข้าคอลัมน์ที่หัวอยู่ใกล้ที่สุดในแนวนอน
export function parseBoxPdfPage(items, src = "") {
  const its = (items || []).map((i) => ({ s: txt(i.s), x: Number(i.x) || 0, y: Number(i.y) || 0 })).filter((i) => i.s).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = []; for (const it of its) { const l = lines[lines.length - 1]; if (l && Math.abs(it.y - l.y) <= 4.5) { l.c.push(it); } else lines.push({ y: it.y, c: [it] }); }
  lines.forEach((l) => l.c.sort((a, b) => a.x - b.x));
  const out = []; let box = null, cols = null, done = false, headY = 0;
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li]; const first = l.c[0];
    if (isBoxHead(first.s)) {
      const rest = first.s.replace(/^(?:BOX|BUNK)\s*(?:NO|ID)[.:\s]*/i, "");
      box = { box_no: up(rest || (l.c[1] || {}).s), kind: /^BUNK/i.test(first.s) ? "panel" : "loose", title: "", location: "", level: "", ship: "", items: [], src };
      cols = null; done = false; if (box.box_no) out.push(box); else box = null; continue;
    }
    if (!box || done) continue;
    const k = up(first.s).replace(/[.:\s]+$/, "");
    if (!cols) {
      if (/^(LOCATION|ELEVATION)$/.test(k)) { box.location = l.c.slice(1).map((c) => c.s).join(" "); continue; }
      if (/^LEVEL$/.test(k)) { box.level = (l.c[1] || {}).s || ""; continue; }
      if (/^PROJECT( NO)?$/.test(k)) { if (l.c.length > 2) box.title = l.c[1].s; continue; }
      if (k === "NO" && l.c.some((c) => /^DESCRIPTION$/i.test(c.s))) {
        // หัวตาราง: บรรทัดนี้ + หัวที่อยู่บรรทัดบน / ล่างภายใน 14 pt (เช่น "Length" บน "(mm)")
        const hs = lines.filter((x) => Math.abs(x.y - l.y) <= 14 && !isBoxHead(x.c[0].s) && !/^\d+$/.test(x.c[0].s)).flatMap((x) => x.c.map((c) => ({ ...c, y: x.y })));
        const groups = [];   // กลุ่มหัวคอลัมน์ตามแนวตั้ง (x ห่างไม่เกิน 16 pt)
        for (const c of hs.sort((a, b) => a.x - b.x || a.y - b.y)) { const g = groups.find((q) => Math.abs(q.x - c.x) <= 16); if (g) g.c.push(c); else groups.push({ x: c.x, c: [c] }); }
        cols = groups.map((g) => ({ x: g.x, f: fieldOf(g.c.sort((a, b) => a.y - b.y).map((c) => c.s).join(" ")) || "skip" }));
        headY = l.y;
        if (cols.some((c) => c.f === "pos" || c.f === "addr")) box.kind = "panel";
        continue;
      }
      continue;
    }
    if (l.c.some((c) => /^TOTAL$/i.test(c.s)) && !/^\d+$/.test(first.s)) { done = true; continue; }
    if (Math.abs(l.y - headY) <= 14) continue;   // บรรทัดที่เป็นส่วนของหัวตาราง ("(mm)" ใต้ "Length")
    if (cols.some((c) => c.f === "no") && !/^\d+$/.test(first.s)) continue;   // แถวรายการต้องขึ้นต้นด้วยเลขลำดับ (บรรทัดที่ตัดคำลงมาไม่นับ)
    const row = {}; for (const c of l.c) { let best = null; for (const q of cols) if (!best || Math.abs(q.x - c.x) < Math.abs(best.x - c.x)) best = q; if (best && row[best.f] == null) row[best.f] = c.s; }
    if (!row.item) continue;
    const it = blankItem(); it.item = up(row.item); it.desc = row.desc || ""; it.pos = up(row.pos || ""); it.addr = row.addr || "";
    it.len = numOf(row.len); it.w = numOf(row.w); it.h = numOf(row.h); it.unit = row.unit || ""; it.wt = numOf(row.wt);
    const q = numOf(row.qty != null ? row.qty : row.total); it.qty = q != null && q > 0 ? q : 1;
    box.items.push(it);
  }
  return out;
}
export function parseBoxPdfPages(pages, src = "") {
  const boxes = []; const warn = []; const seen = new Set();
  (pages || []).forEach((items, pi) => { for (const b of parseBoxPdfPage(items, src)) { const k = boxKey(b.box_no); if (seen.has(k)) { warn.push(`${b.box_no} มีมากกว่า 1 ใบ (หน้า ${pi + 1}) — ใช้ใบแรก`); continue; } seen.add(k); boxes.push(b); } });
  return { boxes, warn };
}
export async function readBoxPdfWith(pdfjsLib, data, src = "") {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise; const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent();
    pages.push(tc.items.filter((it) => it.str && it.str.trim()).map((it) => { const tx = pdfjsLib.Util.transform(vp.transform, it.transform); return { s: it.str.trim(), x: tx[4], y: tx[5] }; }));
  }
  return { ...parseBoxPdfPages(pages, src), pages: doc.numPages, raw: pages };
}

// ── รวมกล่องที่นำเข้าเข้ากับตารางที่มี (เทียบด้วยเลขกล่อง) ──
//   กล่องใหม่ = เพิ่ม · กล่องเดิม = แทนรายการข้างในด้วยของไฟล์ (หัวกล่องที่ไฟล์ไม่มีค่า คงของเดิม) · คืน { boxes, added, replaced, same }
export const itemsEqual = (a, b) => (a || []).length === (b || []).length && (a || []).every((x, i) => ITEM_FIELDS.every((f) => String(x[f] ?? "") === String(b[i][f] ?? "")));
export function mergeBoxes(cur, incoming) {
  const boxes = (cur || []).map((b) => ({ ...b, items: (b.items || []).map((i) => ({ ...i })) })); const idx = new Map();
  boxes.forEach((b, i) => { if (!b._del) idx.set(boxKey(b.box_no), i); });
  let added = 0, replaced = 0, same = 0;
  for (const n of incoming || []) {
    const k = boxKey(n.box_no); if (!k) continue;
    if (!idx.has(k)) { idx.set(k, boxes.length); boxes.push({ ...n, items: (n.items || []).map((i) => ({ ...i })), _dirty: true, _new: true }); added++; continue; }
    const o = boxes[idx.get(k)]; let diff = false;
    for (const f of ["title", "location", "level", "ship", "kind"]) if (n[f] && n[f] !== o[f]) { o[f] = n[f]; diff = true; }
    if ((n.items || []).length && !itemsEqual(o.items, n.items)) { o.items = n.items.map((i) => ({ ...i })); diff = true; }
    if (diff) { o._dirty = true; replaced++; } else same++;
  }
  return { boxes, added, replaced, same };
}

// ── สิ่งที่เปลี่ยน (ใช้ทำบันทึก Modify) ── before / after = [{ box_no, ship, cntr, items }] → [{ type, box, text }]
const itemKey = (i) => [up(i.item), up(i.pos), txt(i.addr)].join("|");
export function diffPacking(before, after) {
  const A = new Map((before || []).map((b) => [boxKey(b.box_no), b])), B = new Map((after || []).filter((b) => !b._del).map((b) => [boxKey(b.box_no), b]));
  const out = []; const gone = []; const came = [];   // รายการที่หาย / โผล่ (ไว้จับคู่เป็น "ย้าย")
  for (const [k, b] of B) if (!A.has(k)) { out.push({ type: "box_add", box: b.box_no, text: `เพิ่มกล่อง ${b.box_no} (${(b.items || []).length} รายการ)` }); }
  for (const [k, a] of A) if (!B.has(k)) out.push({ type: "box_del", box: a.box_no, text: `ลบกล่อง ${a.box_no} (${(a.items || []).length} รายการ)` });
  for (const [k, b] of B) {
    const a = A.get(k); if (!a) continue;
    if ((a.ship || "") !== (b.ship || "") || (a.cntr || "") !== (b.cntr || "")) out.push({ type: "box_move", box: b.box_no, text: `ย้าย ${b.box_no}: ${a.ship || "(ไม่ระบุชิป)"} · ${a.cntr || "(ไม่ระบุตู้)"} → ${b.ship || "(ไม่ระบุชิป)"} · ${b.cntr || "(ไม่ระบุตู้)"}` });
    for (const f of [["title", "ชื่องาน"], ["location", "ตำแหน่ง"], ["level", "ชั้น"]]) if ((a[f[0]] || "") !== (b[f[0]] || "")) out.push({ type: "box_edit", box: b.box_no, text: `${b.box_no}: ${f[1]} ${a[f[0]] || "(ว่าง)"} → ${b[f[0]] || "(ว่าง)"}` });
    const am = new Map(), bm = new Map();
    for (const i of a.items || []) { const q = itemKey(i); am.set(q, (am.get(q) || []).concat(i)); }
    for (const i of b.items || []) { const q = itemKey(i); bm.set(q, (bm.get(q) || []).concat(i)); }
    for (const [q, la] of am) { const lb = bm.get(q) || []; const qa = la.reduce((s, i) => s + (Number(i.qty) || 0), 0), qb = lb.reduce((s, i) => s + (Number(i.qty) || 0), 0);
      if (!lb.length) gone.push({ box: a.box_no, i: la[0], qty: qa });
      else if (qa !== qb) out.push({ type: "qty", box: b.box_no, text: `${b.box_no}: ${la[0].item} จำนวน ${qa} → ${qb}` }); }
    for (const [q, lb] of bm) if (!am.has(q)) came.push({ box: b.box_no, i: lb[0], qty: lb.reduce((s, i) => s + (Number(i.qty) || 0), 0) });
  }
  // จับคู่ "หายจากกล่องหนึ่ง + โผล่อีกกล่อง" (เบอร์ + ที่อยู่เดียวกัน) = ย้าย
  for (const g of gone) {
    const at = came.findIndex((c) => !c.used && up(c.i.item) === up(g.i.item) && txt(c.i.addr) === txt(g.i.addr) && c.box !== g.box);
    if (at >= 0) { came[at].used = true; out.push({ type: "move", box: came[at].box, text: `ย้าย ${g.i.item}${g.i.addr ? ` (${g.i.addr})` : ""}: ${g.box} → ${came[at].box}` }); }
    else out.push({ type: "item_del", box: g.box, text: `${g.box}: เอา ${g.i.item}${g.i.addr ? ` (${g.i.addr})` : ""} ออก (จำนวน ${g.qty})` });
  }
  for (const c of came) if (!c.used) out.push({ type: "item_add", box: c.box, text: `${c.box}: เพิ่ม ${c.i.item}${c.i.addr ? ` (${c.i.addr})` : ""} (จำนวน ${c.qty})` });
  return out;
}

// ตรวจก่อนบันทึก → รายการข้อผิดพลาด (ว่าง = ผ่าน)
export function validateBoxes(boxes) {
  const errs = []; const seen = new Set();
  for (const b of (boxes || []).filter((x) => !x._del)) {
    const k = boxKey(b.box_no);
    if (!k) { errs.push("มีกล่องที่ไม่มีเลขกล่อง"); continue; }
    if (k.length > 60) errs.push(`เลขกล่องยาวเกิน 60 ตัวอักษร: ${b.box_no}`);
    if (seen.has(k)) errs.push(`เลขกล่องซ้ำ: ${up(b.box_no)}`); seen.add(k);
    (b.items || []).forEach((i, n) => {
      if (!txt(i.item)) errs.push(`${up(b.box_no)}: แถวที่ ${n + 1} ไม่มีเบอร์`);
      if (!(Number(i.qty) > 0 && Number(i.qty) <= 1000000)) errs.push(`${up(b.box_no)}: ${i.item || `แถวที่ ${n + 1}`} จำนวนต้องมากกว่า 0`);
      for (const f of ["len", "w", "h", "wt"]) if (i[f] != null && i[f] !== "" && !(Number(i[f]) >= 0 && Number(i[f]) <= 1000000)) errs.push(`${up(b.box_no)}: ${i.item} ตัวเลขไม่ถูกต้อง`);
    });
  }
  return [...new Set(errs)];
}
