// ══════════════════════════════════════════════════════════════════════════
// BOM — แผงนี้ใช้อะไรบ้าง · ซับซ้อนกับอะไร · ตัดจากเศษได้ไหม
//   ซ้าย: รายการแบบแผง (เรียง/ค้นหาได้)    ขวา: 3 มุมมอง
//     โครงสร้าง = แผง → ซับ 1 → ซับ 2 → พาร์ท (พับ/ขยายได้)  ·  รวมเบอร์ = เบอร์เดียวกันรวมกัน + ใช้ในซับไหนบ้าง  ·  ตารางเต็ม = แบบชีต BOM ใน Excel (กดหัวคอลัมน์เรียงได้)
//   SUM QTY = จำนวนต่อชุด × (ซับชั้นบน ๆ) × จำนวนแผงแบบนั้น (ตรงกับ Sum Quantity ใน Excel)
//   เศษ: ไล่ตัดตามลำดับแผงในใบนี้ — เบอร์ MATERIAL (INV) ตรงกัน ใช้เศษที่เหลือ ≥ ความยาวที่ต้องตัด (+รอยตัด) ก่อนเปิดเส้นใหม่ · เศษ ≥ 500 มม. เก็บไว้ใช้ต่อ
// ══════════════════════════════════════════════════════════════════════════
import { Fragment, useEffect, useMemo, useState } from "react";
import { NC, ncmp, nf, nlen, findKey, stockLen, KERF, addrKey, destLabel, needOf, nextModNo, modVer } from "./releaseCore.js";
import { askConfirm } from "../confirm.jsx";
import { Pill, ModQty, SUB_SHORT, ModTag } from "./releaseUi.jsx";

const PAGE = 300;
const MIN_OFFCUT = 500;
const has = (q, ...xs) => !q || xs.some((x) => String(x || "").toUpperCase().includes(q));

// แตก BOM ของแบบแผงเป็นแถว (ลำดับตามไฟล์) พร้อมจำนวนต่อแผง
export function rowsOfType(plan, unit) {
  const pk = findKey(plan.bom.panels, unit); if (!pk) return [];
  const out = [];
  // ★ 2026-11-12 แต่ละแถวรู้ว่าอยู่ในรายการของใคร (own = แผง/ซับเจ้าของ · oi = ลำดับในรายการ) — ใช้แก้จำนวนต่อชุดในตาราง BOM
  const walk = (items, path, mult, seen, scope, owner) => {
    (items || []).forEach((it, oi) => {
      const own = { scope, owner, oi };
      const [t, c, qq] = it;
      const cx = (it[4] || "") === "ยกเลิก"; const ed = { cx, ver: it[5] || "", q0: it[6] != null && it[6] !== qq ? it[6] : null, to: cx ? it[7] || "" : "", add: it[8] === "add" };
      if (cx) {   // ลูกที่ถูก Modify ยกเลิก/แทนที่ — โชว์สีแดง ไม่นับยอด ไม่แตกต่อ
        const k = t === "sub" ? findKey(plan.bom.subs, c) : findKey(plan.bom.parts, c); const dd = (t === "sub" ? plan.bom.subs : plan.bom.parts)[k] || {};
        out.push({ i: out.length, path, depth: path.length, code: c, kind: t === "sub" ? "sub" : dd.k === "hw" ? "hw" : "part", d: dd.d || "", l: dd.l ?? null, h: null, f: dd.f || "", m: t === "sub" ? "" : dd.m || "", q: it[6] != null ? it[6] : qq, per: 0, uom: "pcs.", own, ...ed });
        return;
      }
      if (t === "sub") {
        const sk = findKey(plan.bom.subs, c); const sd = sk ? plan.bom.subs[sk] : {};
        out.push({ i: out.length, path, depth: path.length, code: c, kind: "sub", d: sd.d || "", l: sd.l ?? null, h: null, f: sd.f || "", m: "", rev: sd.rev || "", q: qq, per: mult * qq, own, ...ed });
        if (sk && !seen.has(sk)) walk(sd.items, [...path, c], mult * qq, new Set([...seen, sk]), "sub", sk);
      } else {
        const pd = plan.bom.parts[findKey(plan.bom.parts, c)] || {};
        const hw = pd.k === "hw";
        out.push({ i: out.length, path, depth: path.length, code: c, kind: hw ? "hw" : "part", d: pd.d || "", l: pd.l ?? null, h: pd.h ?? null, f: pd.f || "", m: hw ? "" : pd.m || "", ml: pd.ml ?? null, inv: pd.binv || "", rev: pd.rev || "", q: qq, per: mult * qq, uom: hw ? pd.u || "pcs." : "pcs.", own, ...ed });
      }
    });
  };
  walk(plan.bom.panels[pk].items, [], 1, new Set(), "panel", pk);
  return out;
}

// ความยาวเศษที่ใช้ แบบ Excel: ความยาวเดียว → "2,300" · หลายความยาว → "2300(1), 2100(1)"
// ★ เส้นเต็ม ↔ เศษ: แถวที่ตัดจากเศษ → บอกว่าเศษมาจากเส้นเต็มของแถวไหน · แถวที่เปิดเส้นเต็ม → บอกว่าเศษที่เหลือไปใช้ที่แถวไหน
const cutFlow = (c) => {
  if (!c) return { from: [], to: [] };
  const fmt = (m) => [...m.entries()].map(([k, n]) => `${k === c.label ? "เส้นเต็มของแถวนี้เอง" : k} (${nf(n)})`);
  return { from: c.reuse ? fmt(c.srcs) : [], to: fmt(c.outs) };
};
const groupLens = (arr) => { const m = new Map(); for (const v of arr) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([l, n]) => `${nf(l)}(${n})`).join(", "); };
const wasteLens = (c) => { const e = [...c.lens.entries()].sort((a, b) => b[0] - a[0]); return e.length === 1 ? nf(e[0][0]) : e.map(([l, n]) => `${l}(${n})`).join(", "); };
// ★ 2026-11-11 ผู้ใช้: "ให้ตัดบรรทัดละ 6" → ความยาวเศษหลายค่า ขึ้นบรรทัดใหม่ทุก 6 ค่า (บนจอ · Excel ยังเป็นบรรทัดเดียว)
const wasteLines = (c) => {
  const parts = wasteLens(c).split(", "); if (parts.length <= 6) return parts.join(", ");
  const out = []; for (let i = 0; i < parts.length; i += 6) out.push(parts.slice(i, i + 6).join(", ") + (i + 6 < parts.length ? "," : ""));
  return out.map((t, i) => <div key={i} style={{ whiteSpace: "nowrap" }}>{t}</div>);
};
export function BomView({ plan, need, rel = null, onSaveDirect = null, onModify = null }) {
  // ★ 2026-11-12 ผู้ใช้: "BOM ให้แก้ได้ · ตอนบันทึกให้เลือกเป็น M หรือไม่ M ก็ได้"
  //   คลิกช่อง "ต่อชุด" / QUANTITY → พิมพ์ทับ · ที่แก้ค้างนับที่แถบล่าง → [บันทึก (ไม่นับ Modify)] แก้ BOM ตรง ๆ  หรือ  [บันทึกเป็น M-00x] เปิดหน้า Modify (แท็บ BOM) พร้อมรายการ
  //   ไม่นับ Modify ได้เฉพาะเมื่อยอดใหม่ไม่ต่ำกว่าที่ปล่อยไปแล้ว — ต่ำกว่า = ต้องเป็น M (ระบบลด/ยกเลิกในล็อตให้)
  // ★ 2026-11-12 (รอบ 2) ผู้ใช้: "ให้แก้ได้ทุกอย่าง ยกเว้น wast" → ตารางเต็ม: PART NO. · DESCRIPTION · LENGTH · FINISH · MATERIAL · QUANTITY
  //   ค่าที่คำนวณเอง (WAST · MATERIAL LENGTH · SUM · จำนวนแผง) แก้ไม่ได้ · รายละเอียด / ยาว / FINISH / MATERIAL เป็นของเบอร์ (แก้ที่เดียวมีผลทุกแผง)
  const canEdit = !!(onSaveDirect || onModify);
  const [bed, setBed] = useState({});      // "scope|owner|oi" → { q?, code? }  (ลูกแต่ละบรรทัดในรายการของแผง/ซับ)
  const [aed, setAed] = useState({});      // "part|CODE" / "sub|CODE" → { d?, l?, f?, m? }  (ข้อมูลของเบอร์)
  const [bcur, setBcur] = useState(null);  // ช่องที่กำลังพิมพ์
  const [bbusy, setBbusy] = useState(false);
  const clearEd = () => { setBed({}); setAed({}); setBcur(null); };
  useEffect(() => { clearEd(); }, [(plan.mods || []).length, plan.ro]);   // eslint-disable-line react-hooks/exhaustive-deps
  const okey = (r) => (r.own ? `${r.own.scope}|${r.own.owner}|${r.own.oi}` : "");
  const akey = (r) => `${r.kind === "sub" ? "sub" : "part"}|${NC(r.code)}`;
  const ITEM_F = new Set(["q", "code"]);
  const FL = { q: "ต่อชุด", code: "เบอร์", d: "รายละเอียด", l: "ความยาว", f: "FINISH", m: "MATERIAL" };
  const ownItem = (k) => { const [sc, ow, oi] = k.split("|"); const col = sc === "panel" ? plan.bom.panels : plan.bom.subs; const o = col[ow]; return o && o.items ? o.items[Number(oi)] : null; };
  const attrOf = (ak) => { const i = ak.indexOf("|"); const kd = ak.slice(0, i), c = ak.slice(i + 1); const col = kd === "sub" ? plan.bom.subs : plan.bom.parts; const k = findKey(col, c); return { kd, k, e: k ? col[k] : null }; };
  const curVal = (r, f) => (f === "q" ? r.q : f === "code" ? r.code : f === "d" ? r.d || "" : f === "l" ? r.l ?? "" : f === "f" ? r.f || "" : r.m || "");
  const pend = (r, f) => (ITEM_F.has(f) ? bed[okey(r)]?.[f] : aed[akey(r)]?.[f]);
  const parse = (f, raw) => { const t = String(raw ?? "").trim();
    if (f === "q") { const n = Number(t.replace(/,/g, "")); return t !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : undefined; }
    if (f === "l") { const n = Number(t.replace(/,/g, "")); return t !== "" && Number.isFinite(n) && n > 0 ? n : undefined; }
    if (f === "code" || f === "m") return t ? t.toUpperCase() : undefined;
    if (f === "d") return t || undefined;
    return t; };   // FINISH เว้นว่างได้
  const setVal = (r, f, raw) => { const v = parse(f, raw); const c0 = curVal(r, f);
    const same = v === undefined || (typeof v === "number" ? Math.abs(v - Number(c0)) < 1e-9 : String(v) === String(c0).trim() || (f === "code" && NC(v) === NC(c0)));
    const isItem = ITEM_F.has(f); const k = isItem ? okey(r) : akey(r); const set = isItem ? setBed : setAed;
    set((b) => { const nx = { ...(b[k] || {}) }; if (same) delete nx[f]; else nx[f] = v; const o = { ...b }; if (Object.keys(nx).length) o[k] = nx; else delete o[k]; return o; }); };
  const canF = (r, f) => canEdit && !r.cx && (ITEM_F.has(f) ? !!r.own : true) && !(f === "m" && r.kind !== "part") && !(r.kind === "sub" && f === "m");
  const fmtF = (f, v) => (f === "q" || f === "l" ? (v === "" || v == null ? "—" : nlen(v)) : v === "" || v == null ? "—" : String(v));
  const eCell = (r, f, uniq, shown) => {
    if (!canF(r, f)) return shown;
    const pv = pend(r, f); const chg = pv !== undefined; const c0 = curVal(r, f);
    const disp = chg ? <>{f === "d" ? null : <s className="rl-old">{fmtF(f, c0)}</s>}<b>{fmtF(f, pv)}</b></> : shown;
    const id = `${f}|${okey(r) || akey(r)}|${uniq}`; const lab = `${FL[f]} ${r.code}`;
    if (bcur === id) return <span className="bm-edhold"><span className="bm-ghost" aria-hidden="true">{disp}</span><input autoFocus className={`input bm-in ${f === "q" || f === "l" ? "num" : ""}`} defaultValue={chg ? pv : c0} inputMode={f === "q" || f === "l" ? "decimal" : "text"} aria-label={lab}
      onFocus={(e) => e.target.select()} onBlur={(e) => { setVal(r, f, e.target.value); setBcur((c) => (c === id ? null : c)); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") { e.target.value = String(chg ? pv : c0); e.target.blur(); } }} /></span>;
    const tip = ITEM_F.has(f) ? (r.own.scope === "sub" ? `แก้ในซับ ${r.own.owner} — มีผลทุกแผงที่ใช้ซับนี้` : `แก้ในแผง ${r.own.owner}`) : `แก้ข้อมูลของเบอร์ ${r.code} — มีผลทุกแผง / ทุกซับที่ใช้เบอร์นี้`;
    return <button type="button" className={`bm-qbtn ${f === "q" || f === "l" ? "num" : ""} ${chg ? "ed" : ""}`} onClick={() => setBcur(id)} aria-label={lab} title={tip}>{disp}</button>;
  };
  const qCell = (r, unitN) => eCell(r, "q", unitN, r.cx ? <span className="rl-cxq">{nlen(r.q)}</span> : r.q0 != null ? <ModQty orig={r.q0} cur={r.q} ver={r.ver} /> : nlen(r.q));
  // รายการที่แก้ค้าง (แบนเป็นบรรทัดเดียวกัน)
  const bedits = useMemo(() => {
    const out = [];
    for (const [k, v] of Object.entries(bed)) { const it = ownItem(k); if (!it) continue; const [scope, owner, oi] = k.split("|");
      const base = { scope, owner, idx: Number(oi), kind: it[0], code: it[1], before: it[2], orig: it[6] != null ? it[6] : it[2] };
      if (v.code !== undefined) out.push({ ...base, f: "code", from: it[1], to: v.code, q: v.q });
      if (v.q !== undefined) out.push({ ...base, f: "q", from: it[2], to: v.q, qty: v.q }); }
    for (const [ak, v] of Object.entries(aed)) { const { kd, k, e } = attrOf(ak); if (!e) continue;
      for (const f of ["d", "l", "f", "m"]) if (v[f] !== undefined) out.push({ attr: true, kd, key: k, code: k, f, from: f === "l" ? e.l ?? "" : e[f] || "", to: v[f], hw: e.k === "hw" }); }
    return out;
  }, [bed, aed, plan.bom]);   // eslint-disable-line react-hooks/exhaustive-deps
  const lineOf = (e) => (e.attr ? `${e.code} ${FL[e.f]} ${fmtF(e.f, e.from)} → ${fmtF(e.f, e.to)}` : `${e.f === "code" ? `${e.from} → ${e.to}` : `${e.code} ต่อชุด ${nlen(e.from)} → ${nlen(e.to)}`} ใน${e.scope === "panel" ? "แผง" : "ซับ"} ${e.owner}`);
  // สร้างแผนใหม่จากที่แก้ (ไม่ผ่าน Modify) — only = เฉพาะบางชนิด (ใช้ตอนส่ง M: รายละเอียด / FINISH บันทึกตรง)
  const buildDirect = (list) => {
    const bom = { ...plan.bom, panels: { ...plan.bom.panels }, subs: { ...plan.bom.subs }, parts: { ...plan.bom.parts } };
    const errs = []; const cloned = new Set();
    const own = (scope, owner) => { const col = scope === "panel" ? bom.panels : bom.subs; if (!col[owner]) return null; const ck = scope + "|" + owner; if (!cloned.has(ck)) { col[owner] = { ...col[owner], items: (col[owner].items || []).map((x) => [...x]) }; cloned.add(ck); } return col[owner]; };
    const ent = (kd, key) => { const col = kd === "sub" ? bom.subs : bom.parts; const ck = "e|" + kd + "|" + key; if (!cloned.has(ck)) { col[key] = { ...col[key] }; cloned.add(ck); } return col[key]; };
    for (const e of list) {
      if (e.attr) {
        if ((e.f === "m" || e.f === "l") && e.kd === "part" && ((e.f === "m" && (plan.matOv || {})[e.code]) || (e.f === "l" && (plan.lenOv || {})[e.code]))) { errs.push(`${e.code}: ${FL[e.f]}ถูกเปลี่ยนใน Modify แล้ว — แก้ต่อต้องเป็น M`); continue; }
        const x = ent(e.kd, e.key); if (e.f === "l") x.l = e.to; else x[e.f] = e.to; continue; }
      const o = own(e.scope, e.owner); const it = o && o.items[e.idx]; if (!it) continue;
      if (e.f === "q") it[2] = e.to;
      else if (e.f === "code") {
        if (it[0] === "sub") { if (!findKey(bom.subs, e.to)) { errs.push(`${e.to}: ยังไม่มี BOM ของซับนี้ในใบ — เปลี่ยนเป็นซับใหม่ทำผ่าน ✎ Modify (เพิ่มเบอร์ / วางแบบ)`); continue; } }
        else if (!findKey(bom.parts, e.to)) { const src = bom.parts[findKey(bom.parts, e.from)] || {}; bom.parts[e.to] = { ...src }; }
        it[1] = e.to; }
    }
    return { np: { ...plan, bom, bomFix: [...(plan.bomFix || []), { at: new Date().toISOString(), items: list.map((e) => ({ what: e.f, code: e.code, ...(e.attr ? {} : { scope: e.scope, owner: e.owner }), from: e.from, to: e.to })) }] }, errs };
  };
  const relQ = (c) => (rel && rel.byCode.get(NC(c)) ? rel.byCode.get(NC(c)).qty : 0);
  const needDiff = (np) => { const n0 = needOf(plan), n1 = needOf(np); const diff = [], low = [];
    for (const key of ["subs", "parts"]) { for (const r1 of n1[key]) { const r0 = n0[key].find((x) => NC(x.code) === NC(r1.code)); const a = r0 ? r0.qty : 0; if (Math.abs(a - r1.qty) < 1e-9) continue; diff.push(`${r1.code} ${nlen(a)} → ${nlen(r1.qty)}`); if (r1.qty < relQ(r1.code)) low.push(`${r1.code} (ปล่อยแล้ว ${nf(relQ(r1.code))} · ยอดใหม่ ${nlen(r1.qty)})`); }
      for (const r0 of n0[key]) if (!n1[key].some((x) => NC(x.code) === NC(r0.code)) && r0.qty) { diff.push(`${r0.code} ${nlen(r0.qty)} → 0`); if (relQ(r0.code) > 0) low.push(`${r0.code} (ปล่อยแล้ว ${nf(relQ(r0.code))} · ยอดใหม่ 0)`); } }
    return { diff, low }; };
  async function saveDirect() {
    if (!onSaveDirect || !bedits.length || bbusy) return;
    const { np, errs } = buildDirect(bedits); const { diff, low } = needDiff(np);
    const relTouched = bedits.filter((e) => e.attr && (e.f === "m" || e.f === "l") && relQ(e.code) > 0).map((e) => e.code);
    if (errs.length || low.length) { await askConfirm({ title: "บันทึกแบบไม่นับ Modify ไม่ได้", message: [...errs, ...(low.length ? ["ยอดใหม่ต่ำกว่าที่ปล่อยไปแล้ว:", ...low] : []), "", `ใช้ "บันทึกเป็น ${modVer(nextModNo(plan))}" แทน — ระบบจะลด/ยกเลิกในล็อตให้และเก็บประวัติ`].join("\n"), tone: "warn", confirmText: "ตกลง", cancelText: "ปิด" }); return; }
    const ok = await askConfirm({ title: `แก้ BOM ${bedits.length} จุด โดยไม่นับ Modify?`, message: [...bedits.map((e) => `• ${lineOf(e)}`), "", diff.length ? `ยอดต้องใช้ทั้งใบที่เปลี่ยน: ${diff.slice(0, 12).join(" · ")}${diff.length > 12 ? " …" : ""}` : "ยอดต้องใช้ทั้งใบไม่เปลี่ยน",
      relTouched.length ? `\n⚠ ${[...new Set(relTouched)].join(", ")} ปล่อยไปแล้ว — ใบงาน / แถวที่ปล่อยแล้วยังเป็นค่าเดิม (กด "อัปเดตความยาว · วัสดุ · น้ำหนัก" ที่แถบด้านข้างถ้าจะตามค่าใหม่)` : "", "", "ไม่มีเลข M · ไม่ลงประวัติ Modify · ใช้กับล็อตที่ปล่อยต่อจากนี้"].filter((x) => x !== null).join("\n"), tone: "warn", confirmText: "บันทึก", cancelText: "กลับไปแก้" });
    if (!ok) return;
    setBbusy(true); try { await onSaveDirect(np); clearEd(); } finally { setBbusy(false); }
  }
  async function saveAsM() {
    if (!onModify || !bedits.length) return;
    const direct = bedits.filter((e) => e.attr && (e.f === "d" || e.f === "f" || (e.f === "l" && e.hw)));
    if (direct.length) {
      const ok = await askConfirm({ title: "บางอย่างไม่อยู่ใน Modify", message: [`${direct.map((e) => lineOf(e)).join("\n")}`, "", `รายละเอียด / FINISH${direct.some((e) => e.f === "l") ? " / ความยาวสกรู-ยาง" : ""} ไม่มีในใบ Modify — จะบันทึกตรงไปก่อน (ไม่นับ M) แล้วเปิดหน้า ${modVer(nextModNo(plan))} สำหรับที่เหลือ`].join("\n"), tone: "warn", confirmText: "ตกลง ทำต่อ", cancelText: "กลับไปแก้" });
      if (!ok) return;
      const { np } = buildDirect(direct); if (onSaveDirect) { setBbusy(true); try { await onSaveDirect(np); } finally { setBbusy(false); } }
    }
    const rest = bedits.filter((e) => !direct.includes(e));
    const bchg = {}; const matChg = [];
    for (const e of rest) {
      if (e.attr) { matChg.push({ id: `${NC(e.code)}|${e.f === "m" ? "mat" : "len"}`, code: e.code, kind: e.kd === "sub" ? "sub" : "part", field: e.f === "m" ? "mat" : "len", from: e.from === "" ? "—" : e.from, to: e.to, file: "", on: true }); continue; }
      const k = `${e.scope}|${e.owner}|${e.idx}`;
      if (e.f === "code") bchg[k] = { type: "replace", newCode: e.to, qty: String(e.q ?? e.before) };
      else if (!bchg[k]) bchg[k] = { type: "qty", qty: String(e.to) };
    }
    clearEd();
    if (!Object.keys(bchg).length && !matChg.length) return;
    const first = rest.find((e) => !e.attr);
    onModify({ bchg, matChg, ...(first ? { bscope: first.scope, bowner: first.owner } : {}) });
  }
  const [sel, setSel] = useState("");          // "" = แบบแรก · "__ALL__" = ทุกแบบ
  const [view, setView] = useState("tree");
  const [q, setQ] = useState("");
  const [lq, setLq] = useState("");
  // ★ 2026-11-10 รายการแบบแผงด้านซ้าย: แคบ บรรทัดเดียว · พับได้ (พับ = เลือกแบบแผงจาก dropdown เหนือตาราง) — จำไว้
  const [listOff, setListOffRaw] = useState(() => { try { return localStorage.getItem("bm-list-off") === "1"; } catch { return false; } });
  const setListOff = (v) => { setListOffRaw(v); try { localStorage.setItem("bm-list-off", v ? "1" : ""); } catch { /* ignore */ } };
  const [lsort, setLsort] = useState({ k: "unit", d: 1 });
  const [sort, setSort] = useState({ k: "", d: 1 });
  const [closed, setClosed] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  // ★ 2026-11-12 ผู้ใช้: "ทำเป็นตารางเหมือน Excel · SUB-01 SUB-02 ยังอยู่ · ตัวคำนวณเศษให้ย่อ-ขยายได้" — จำไว้ในเครื่อง
  const [wasteOn, setWasteOnRaw] = useState(() => { try { return localStorage.getItem("bm-waste-on") === "1"; } catch { return false; } });
  const setWasteOn = (v) => { setWasteOnRaw(v); try { localStorage.setItem("bm-waste-on", v ? "1" : ""); } catch { /* ignore */ } };

  const model = useMemo(() => {
    const units = (plan.units || []).filter((u) => !need.cancelledAddr[addrKey(u.addr)] && String(u.unit || "").trim());
    const cnt = new Map(); for (const u of units) { const k = String(u.unit).trim(); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const types = new Map();
    for (const [unit, n] of cnt) {
      const rows = rowsOfType(plan, unit); const pk = findKey(plan.bom.panels, unit);
      types.set(unit, { unit, n, has: !!pk, desc: pk ? plan.bom.panels[pk].d || "" : "", rows, off: 0, fresh: 0 });
    }
    // ไล่ตัดตามลำดับแผง: ใช้เศษที่ MATERIAL ตรงกันก่อน
    const pool = new Map(); const opened = [];   // material → [{ rem, from }]
    for (const u of units) {
      const T = types.get(String(u.unit).trim());
      for (const r of T.rows) {
        if (r.kind !== "part" || !r.m || !(r.l > 0)) continue;
        const stock = stockLen(r.m, r.ml).len; const need1 = r.l + KERF;
        const n = Math.round(r.per); if (!(n > 0)) continue;
        r.cut = r.cut || { reuse: 0, fresh: 0, src: "", lens: new Map(), stock, over: stock + 1e-6 < r.l, srcs: new Map(), outs: new Map(), label: `${T.unit} · ${r.code}` };
        const bars = pool.get(r.m) || pool.set(r.m, []).get(r.m);
        for (let k = 0; k < n; k++) {
          let bi = -1;
          for (let b = 0; b < bars.length; b++) if (bars[b].rem + 1e-6 >= need1 && (bi < 0 || bars[b].rem < bars[bi].rem)) bi = b;
          if (bi >= 0) { const was = Math.round(bars[bi].rem); { const sb = bars[bi]; r.cut.srcs.set(sb.from, (r.cut.srcs.get(sb.from) || 0) + 1); if (sb.row && sb.row !== r) sb.row.cut.outs.set(r.cut.label, (sb.row.cut.outs.get(r.cut.label) || 0) + 1); } r.cut.lens.set(was, (r.cut.lens.get(was) || 0) + 1); bars[bi].rem -= need1; r.cut.reuse++; if (!r.cut.src) r.cut.src = `${bars[bi].from} (เหลือก่อนตัด ${nf(bars[bi].rem + need1)} มม.)`; T.off++; if (bars[bi].rem < MIN_OFFCUT) bars.splice(bi, 1); }
          else { r.cut.fresh++; T.fresh++; const rem = stock - need1; const bar = { rem, from: `${T.unit} · ${r.code}`, row: r }; opened.push(bar); if (rem >= MIN_OFFCUT) bars.push(bar); }
        }
      }
    }
    // ★ 2026-11-12 ผู้ใช้: "ตอนขยายให้บอกทั้งหมด" → เศษที่เหลือสุดท้ายของเส้นเต็มที่แถวนี้เปิด (ยังไม่ถูกใช้ต่อ) · < 500 มม. = เศษทิ้ง
    for (const bar of opened) { const c = bar.row.cut; const v = Math.max(0, Math.round(bar.rem)); (v >= MIN_OFFCUT ? (c.left = c.left || []) : (c.scrap = c.scrap || [])).push(v); }
    for (const T of types.values()) {
      T.subs = new Set(T.rows.filter((r) => !r.cx && r.kind === "sub").map((r) => r.code)).size;
      T.parts = new Set(T.rows.filter((r) => !r.cx && r.kind === "part").map((r) => r.code)).size;
      T.hw = new Set(T.rows.filter((r) => !r.cx && r.kind === "hw").map((r) => r.code)).size;
      T.pcs = T.rows.filter((r) => r.kind === "part").reduce((a, r) => a + r.per * T.n, 0);
    }
    return { types, total: units.length };
  }, [plan.bom, plan.units, need]);

  const list = useMemo(() => {
    let a = [...model.types.values()].filter((t) => has(lq.trim().toUpperCase(), t.unit, t.desc));
    const f = { unit: (x, y) => ncmp(x.unit, y.unit), n: (x, y) => x.n - y.n, rows: (x, y) => x.rows.length - y.rows.length, off: (x, y) => x.off - y.off }[lsort.k];
    a.sort((x, y) => f(x, y) * lsort.d || ncmp(x.unit, y.unit)); return a;
  }, [model, lq, lsort]);
  const ALL = sel === "__ALL__";
  const cur = ALL ? null : model.types.get(sel) || list[0] || [...model.types.values()][0] || null;
  const v = ALL && view === "tree" ? "merge" : view;
  const destOf = (r) => (r.kind === "sub" ? (need.subs.find((x) => NC(x.code) === NC(r.code))?.procs || []) : r.kind === "part" ? [need.parts.find((x) => NC(x.code) === NC(r.code))?.dest].filter(Boolean) : []);
  const scope = ALL ? [...model.types.values()] : cur ? [cur] : [];
  const Q = q.trim().toUpperCase();

  // รวมเบอร์: เบอร์เดียวกันจากทุกซับ/ทุกแผงรวมกัน
  const merged = useMemo(() => {
    const m = new Map();
    for (const T of scope) for (const r of T.rows) {
      if (r.cx) continue;
      const e = m.get(r.code) || m.set(r.code, { code: r.code, kind: r.kind, d: r.d, l: r.l, m: r.m, uom: r.uom || (r.kind === "sub" ? "SET" : "pcs."), total: 0, reuse: 0, fresh: 0, uses: new Map() }).get(r.code);
      e.total += r.per * T.n; if (r.cut) { e.reuse += r.cut.reuse; e.fresh += r.cut.fresh; }
      const par = r.path.length ? r.path[r.path.length - 1] : "(ติดแผงตรง)";
      const u = e.uses.get(par) || { q: 0, panels: new Set() }; u.q += r.per * T.n; u.panels.add(T.unit); e.uses.set(par, u);
    }
    return [...m.values()];
  }, [scope.map((t) => t.unit).join("|"), model]);

  const flat = useMemo(() => scope.flatMap((T) => T.rows.map((r) => ({ ...r, unit: T.unit, pdesc: T.desc, n: T.n, sum: r.per * T.n }))), [scope.map((t) => t.unit).join("|"), model]);
  const sorter = (rows, keys) => {
    if (!sort.k) return rows;
    const f = keys[sort.k]; if (!f) return rows;
    return [...rows].sort((a, b) => { const x = f(a), y = f(b); const c = typeof x === "number" && typeof y === "number" ? x - y : ncmp(String(x ?? ""), String(y ?? "")); return c * sort.d || 0; });
  };
  const Th = ({ k, children, r }) => <th className={r ? "r" : ""} aria-sort={sort.k === k ? (sort.d > 0 ? "ascending" : "descending") : "none"}><button type="button" className={`bm-th ${sort.k === k ? "on" : ""}`} onClick={() => setSort((s) => (s.k === k ? { k, d: -s.d } : { k, d: 1 }))}>{children}<i>{sort.k === k ? (sort.d > 0 ? "▲" : "▼") : "↕"}</i></button></th>;
  const cutChip = (r) => (r.cut && (r.cut.reuse || r.cut.over) ? (
    <>{r.cut.reuse ? <Pill tone="bad" title={`ตัดจากเศษ ${r.cut.reuse} ชิ้น — ตัวอย่างต้นทาง: ${r.cut.src}`}>เศษ ×{nf(r.cut.reuse)}</Pill> : null}{r.cut.fresh ? <Pill tone="muted" title={`เปิดเส้นใหม่ ${nf(r.cut.stock)} มม.`}>เส้นใหม่ ×{nf(r.cut.fresh)}</Pill> : null}{r.cut.over ? <Pill tone="warn">ยาวกว่าเส้น</Pill> : null}</>
  ) : r.cut ? <Pill tone="muted" title={`เปิดเส้นใหม่ ${nf(r.cut.stock)} มม.`}>เส้นใหม่ ×{nf(r.cut.fresh)}</Pill> : null);

  // ★ 2026-11-10 ดาวน์โหลด BOM เป็น Excel — ขอบเขต = แบบแผงที่เลือก (หรือทุกแบบ) · ทุกแถว (ไม่ตามคำค้นหา / ไม่ตัดตามหน้า)
  const [xlsBusy, setXlsBusy] = useState(false);
  async function exportXlsx() {
    setXlsBusy(true);
    try {
      const { downloadSheets } = await import("../excelExport.js");
      const num = (x) => (x == null || x === "" ? "" : Number(x));
      const full = flat.map((r) => ({
        PANEL: r.unit, "จำนวนแผง": r.n, "SUB-01": r.path[0] || (r.kind === "sub" ? r.code : ""), "SUB-02": r.path[1] || (r.kind === "sub" && r.depth === 1 ? r.code : ""),
        "PART NO.": r.code, "ประเภท": r.kind === "sub" ? (r.depth ? "SUB 2nd" : "SUB 1st") : r.kind === "hw" ? "สกรู/ยาง" : "พาร์ท", DESCRIPTION: r.d || "", LENGTH: num(r.l), FINISH: r.f || "",
        MATERIAL: r.kind === "sub" ? "" : r.m || "", WAST: r.cut?.reuse ? "wast" : "", "MAT. LENGTH": r.cut?.reuse ? (r.cut.fresh ? `${r.cut.stock}(${r.cut.fresh}) + เศษ ` : "") + wasteLens(r.cut) : r.cut ? num(r.cut.stock) : num(r.ml),
        "ต่อชุด": r.cx ? 0 : num(r.q), "รวม": r.cx ? 0 : Math.round(r.sum * 1000) / 1000, "หน่วย": r.uom || (r.kind === "sub" ? "SET" : "pcs."),
        "ส่งไปใบ": destOf(r).map(destLabel).join(", "), "หมายเหตุ": r.cx ? (r.to ? `แทนด้วย ${r.to} ${r.ver || ""}` : `ยกเลิก ${r.ver || ""}`).trim() : r.add ? `เพิ่ม ${r.ver || ""}`.trim() : r.q0 != null ? `เดิม ${r.q0} (${r.ver || "Modify"})` : "",
      }));
      const sum = [...merged].sort((a, b) => (a.kind === b.kind ? ncmp(a.code, b.code) : a.kind === "sub" ? -1 : 1)).map((e) => ({
        "PART NO.": e.code, "ประเภท": e.kind === "sub" ? "ซับ" : e.kind === "hw" ? "สกรู/ยาง" : "พาร์ท", DESCRIPTION: e.d || "", LENGTH: num(e.l), MATERIAL: e.m || "",
        "รวมทั้งใบ": Math.round(e.total * 1000) / 1000, "หน่วย": e.uom, "ใช้ใน (ซับ/แผง × จำนวน)": [...e.uses.entries()].map(([p, u]) => `${p} ×${nlen(u.q)}`).join(", "),
        "ตัดจากเศษ": e.reuse || "", "เส้นใหม่": e.fresh || "",
      }));
      const tree = scope.flatMap((T) => T.rows.map((r) => ({ "แบบแผง": T.unit, "จำนวนแผง": T.n, "ชั้น": r.depth + 1, "โครงสร้าง": `${"    ".repeat(r.depth)}${r.kind === "sub" ? "▸ " : ""}${r.code}`, DESCRIPTION: r.d || "", LENGTH: num(r.l), MATERIAL: r.kind === "sub" ? "" : r.m || "", "ต่อชุด": r.cx ? 0 : num(r.q), "รวม": r.cx ? 0 : Math.round(r.per * T.n * 1000) / 1000, "หน่วย": r.uom || (r.kind === "sub" ? "SET" : "pcs."), "หมายเหตุ": r.cx ? "ยกเลิก" : r.add ? "เพิ่ม" : "" })));
      const tag = ALL ? "ALL" : cur?.unit || "BOM";
      await downloadSheets(`BOM_${plan.ro}_${tag}.xlsx`.replace(/[\\/:*?"<>|\s]+/g, "_"), [{ name: "ตารางเต็ม", rows: full }, { name: "รวมเบอร์", rows: sum }, { name: "โครงสร้าง", rows: tree }]);
    } catch (e) { alert("สร้างไฟล์ Excel ไม่สำเร็จ: " + (e?.message || e)); }
    setXlsBusy(false);
  }

  // ── มุมมอง ──
  let body = null, count = 0, shown = 0;
  if (v === "tree" && cur) {
    const hidden = (r) => r.path.some((_, j) => closed.has(`${cur.unit}|${r.path.slice(0, j + 1).join(">")}`));
    const rows = cur.rows;
    const match = Q ? new Set(rows.filter((r) => has(Q, r.code, r.d, r.m)).flatMap((r) => [r.i])) : null;
    const keep = (r) => !match || match.has(r.i) || rows.some((x) => match.has(x.i) && x.path.includes(r.code) && x.path.length > r.depth);
    const vis = rows.filter((r) => keep(r) && (Q || !hidden(r)));
    count = rows.length; shown = vis.length;
    const direct = vis.filter((r) => !r.depth && r.kind !== "sub");
    body = (
      <div className="bm-tree">
        {vis.filter((r) => r.kind === "sub" || r.depth > 0).length || direct.length ? null : <div className="rw-muted small rt-empty">ไม่พบรายการ</div>}
        {vis.map((r) => {
          const key = `${cur.unit}|${[...r.path, r.code].join(">")}`; const shut = closed.has(key);
          if (r.kind === "sub") return (
            <div key={r.i} className={`bm-row bm-sub d${Math.min(r.depth, 2)}`} style={{ marginLeft: r.depth * 22 }}>
              <div className="bm-main"><button type="button" className="bm-tg" onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })} aria-expanded={!shut} aria-label={`${shut ? "ขยาย" : "พับ"} ${r.code}`}>{shut ? "▸" : "▾"}</button><b className={`rw-mono ${r.cx ? "rl-cx" : ""}`}>{r.code}</b><Pill tone="sub">{r.depth ? "ซับ 2" : "ซับ 1"}</Pill>{r.cx ? <Pill tone="bad">{r.to ? `แทนด้วย ${r.to}` : "ยกเลิก"} {r.ver}</Pill> : r.add ? (r.ver ? <ModTag ver={r.ver} /> : <Pill tone="mod">เพิ่ม</Pill>) : null}{destOf(r).map((k) => <Pill key={k} tone="sub">{SUB_SHORT[k] || k}</Pill>)}<span className="bm-d">{r.d}</span></div>
              <span className="bm-n r">{nlen(r.l)}</span><span className="bm-mat" />
              <span className="bm-q r"><small>ต่อชุด</small> {qCell(r, cur.unit)}</span><span className="bm-s r"><small>รวม</small> <b>{r.cx ? "0" : nlen(r.per * cur.n)}</b> <small>SET</small></span>
            </div>);
          return (
            <div key={r.i} className={`bm-row bm-part ${r.kind}`} style={{ marginLeft: r.depth * 22 + 24 }}>
              <div className="bm-main"><span className={`rw-mono ${r.cx ? "rl-cx" : ""}`}>{r.code}</span>{r.cx ? <Pill tone="bad">{r.to ? `แทนด้วย ${r.to}` : "ยกเลิก"} {r.ver}</Pill> : r.add ? (r.ver ? <ModTag ver={r.ver} /> : <Pill tone="mod">เพิ่ม</Pill>) : null}{r.kind === "hw" ? <Pill tone="muted">สกรู/ยาง</Pill> : null}{destOf(r).map((k) => <Pill key={k} tone="part">{destLabel(k)}</Pill>)}<span className="bm-d">{r.d}</span></div>
              <span className="bm-n r">{nlen(r.l)}</span>
              <span className="bm-mat"><span className="rw-mono rt-inv">{r.m}</span> {cutChip(r)}</span>
              <span className="bm-q r"><small>ต่อชุด</small> {qCell(r, cur.unit)}</span><span className="bm-s r"><small>รวม</small> <b>{r.cx ? "0" : nlen(Math.round(r.per * cur.n * 1000) / 1000)}</b> <small>{r.uom}</small></span>
            </div>);
        })}
      </div>);
  } else if (v === "merge") {
    const keys = { code: (e) => e.code, d: (e) => e.d, l: (e) => e.l ?? -1, m: (e) => e.m, total: (e) => e.total, uses: (e) => e.uses.size, reuse: (e) => e.reuse };
    const rows = sorter(merged.filter((e) => has(Q, e.code, e.d, e.m, ...e.uses.keys())), keys).sort(sort.k ? () => 0 : (a, b) => (a.kind === b.kind ? 0 : a.kind === "sub" ? -1 : b.kind === "sub" ? 1 : 0));
    count = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    body = (
      <div className="table-wrap rw-tw rt-tw"><table className="data-table rw-table rt-table">
        <thead><tr><Th k="code">เบอร์</Th><Th k="d">รายละเอียด</Th><Th k="l" r>ยาว</Th><Th k="m">MATERIAL</Th><Th k="total" r>รวมทั้งใบ</Th><th>หน่วย</th><Th k="reuse" r>เศษ</Th><Th k="uses">ใช้ใน (ซับ ×จำนวน)</Th></tr></thead>
        <tbody>{vis.map((e) => (
          <tr key={e.code} className={e.kind === "sub" ? "rt-subrow" : ""}>
            <td className="rw-mono"><b>{e.code}</b>{e.kind === "sub" ? <> <Pill tone="sub">ซับ</Pill></> : null}</td><td className="rl-desc"><span>{e.d}</span></td><td className="r rw-num">{nlen(e.l)}</td>
            <td className="rw-mono rt-inv">{e.m}</td><td className="r"><b>{nlen(Math.round(e.total * 1000) / 1000)}</b></td><td className="rw-muted small">{e.uom}</td>
            <td className="r">{e.reuse ? <Pill tone="bad" title={`ตัดจากเศษ ${e.reuse} จาก ${e.reuse + e.fresh} ชิ้น`}>×{nf(e.reuse)}</Pill> : ""}</td>
            <td><div className="bm-uses">{[...e.uses.entries()].slice(0, 6).map(([p, u]) => <span key={p} className="rt-use" title={`${[...u.panels].slice(0, 6).join(", ")}${u.panels.size > 6 ? " …" : ""}`}><b className="rw-mono">{p}</b> × {nlen(u.q)}</span>)}{e.uses.size > 6 ? <small className="rw-muted">+{e.uses.size - 6}</small> : null}</div></td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={8}><b>{nf(rows.length)} เบอร์</b>{ALL ? " · ทุกแบบแผง" : ` · ${cur?.unit}`} · รวมทั้งใบ = ต่อชุด × ซับชั้นบน × จำนวนแผง</td></tr></tfoot>
      </table></div>);
  } else if (v === "table") {
    // ตารางแบบชีต BOM ใน Excel: Panel | Description | Quantity | U.M. | Rev | SUB-01 | SUB-02 | Code | Description | L | H | Finish | Material | L | Quantity | Sum | U.M.
    //   การคำนวณเศษ (WAST · ความยาวเศษ · เส้นเต็ม ↔ เศษ) ย่อ/ขยายได้ — ย่อไว้ = แถวเตี้ยเท่า Excel · ตัดจากเศษ = ป้าย OFF แดงที่ Material
    const keys = { unit: (r) => r.unit, code: (r) => r.code, d: (r) => r.d, l: (r) => r.l ?? -1, f: (r) => r.f, m: (r) => r.m, ml: (r) => r.cut?.stock ?? r.ml ?? -1, q: (r) => r.q, sum: (r) => r.sum, off: (r) => r.cut?.reuse || 0 };
    const rows = sorter(flat.filter((r) => has(Q, r.code, r.d, r.m, r.unit, ...r.path)), keys);
    count = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    let g = 0, lastTop = null;
    const shade = vis.map((r) => { if (sort.k) return ""; const top = r.unit + "|" + (r.path[0] || (r.kind === "sub" && !r.depth ? r.code : "")); if (top !== lastTop) { lastTop = top; if (top.split("|")[1]) g++; } return top.split("|")[1] ? (g % 2 ? "g1" : "g2") : ""; });
    const um = (r) => (r.kind === "sub" ? "SET" : String(r.uom || "pcs.").replace(/\.$/, "").toUpperCase());
    const nCols = wasteOn ? 19 : 17;
    body = (
      <div className="table-wrap rw-tw rt-tw"><table className="rt-xl" onClick={(e) => {
        // ★ 2026-11-12 ผู้ใช้: "ตอนแก้ให้กดที่ตารางได้เลย กดที่ตัวหนังสือบางทีมันตัวเล็ก" → กดตรงไหนในช่องก็เปิดแก้ช่องนั้น
        if (e.target.closest("button, input, a, select, label")) return; const td = e.target.closest("td"); const btn = td && td.querySelector(".bm-qbtn"); if (btn) btn.click(); }}>
        <thead><tr><Th k="unit">Panel</Th><th>Description</th><th className="r">Quantity</th><th>U.M.</th><th>Rev</th><th>SUB-01</th><th>SUB-02</th><Th k="code">Code</Th><Th k="d">Description</Th><Th k="l" r>L</Th><th className="r">H</th><Th k="f">Finish</Th><Th k="m">Material</Th>{wasteOn ? <Th k="off">Wast</Th> : null}<Th k="ml" r>{wasteOn ? "Material Length" : "L"}</Th><Th k="q" r>Quantity</Th><Th k="sum" r>Sum</Th><th>U.M.</th>
          {wasteOn ? <th title="เส้นเต็ม (ชิ้นเต็ม) ใช้ที่ไหน · เศษมาจาก / ไปใช้ที่แถวไหน">เส้นเต็ม ↔ เศษ</th> : null}</tr></thead>
        <tbody>{vis.map((r, i) => { const u = r.unit + "#" + i; const inSub = r.path.length > 0; const off = !!r.cut?.reuse;
          // ★ 2026-11-12 ผู้ใช้: "ช่องว่างระหว่างแผงทำให้รู้ด้วย" → ขึ้นแผงใหม่ = แถบหัวแผง (ชื่อ · รายละเอียด · จำนวนแผง)
          const newPanel = !sort.k && (i === 0 || vis[i - 1].unit !== r.unit);
          return (<Fragment key={r.unit + r.i + "-" + i}>
          {newPanel ? <tr className="xl-pgap"><td colSpan={nCols}><b>{r.unit}</b><span>{r.pdesc}</span><small>{nf(r.n)} แผง</small></td></tr> : null}
          <tr className={`${shade[i]} ${r.kind === "sub" ? "sub" : ""} ${r.cx ? "cx" : ""}`}>
            <td className="pn">{r.unit}</td><td className="pd">{r.pdesc}</td><td className="r">{nf(r.n)}</td><td>SET</td>
            <td className="rev">{r.rev || ""}</td>
            <td className="mono">{r.path[0] || (r.kind === "sub" && !r.depth ? r.code : "")}</td><td className="mono">{r.path[1] || (r.kind === "sub" && r.depth === 1 ? r.code : "")}</td>
            <td className={`mono code ${r.kind === "sub" ? "sub" : inSub ? "kid" : ""}`}>{eCell(r, "code", u, <span className={r.cx ? "rl-cx" : ""}>{r.code}</span>)}{r.cx ? <> <Pill tone="bad">{r.to ? `แทนด้วย ${r.to}` : "ยกเลิก"} {r.ver}</Pill></> : r.add ? <> {r.ver ? <ModTag ver={r.ver} /> : <Pill tone="mod">เพิ่ม</Pill>}</> : null}</td>
            <td className="desc">{eCell(r, "d", u, <span>{r.d}</span>)}</td>
            <td className="r">{eCell(r, "l", u, nlen(r.l))}</td><td className="r">{nlen(r.h)}</td>
            <td>{eCell(r, "f", u, r.f)}</td>
            {/* ★ 2026-11-12 ผู้ใช้: "การใช้เศษตารางไม่เหมือนเดิม" → ขยายเศษ = แบบเดิม: Material ตัวแดง · WAST · Material Length = ความยาวเศษที่ใช้ (แดง) · ย่อ = แบบ Excel: ป้าย OFF + ความยาวเส้น */}
            <td className={`c ${r.kind === "sub" ? "subm" : ""}`}>{r.kind === "sub" ? "SUB" : <>{eCell(r, "m", u, r.m)}{off && !wasteOn ? <span className="xl-off" title={`ตัดจากเศษ ${nf(r.cut.reuse)} ชิ้น · ${r.cut.src}`}>OFF</span> : null}</>}</td>
            {wasteOn ? <td className="c xl-wastec">{off ? "wast" : ""}</td> : null}
            <td className="r" title={wasteOn && off ? r.cut.src : ""}>{r.kind === "sub" ? "" : wasteOn && off
              // ★ 2026-11-12 ผู้ใช้ (ภาพ Excel): "มันต้องเป็นแบบนี้" → เส้นเต็ม = ความยาวเส้น (ดำ) · ใช้เศษ = ความยาวเศษ (แดง) เช่น 2300(1), 2100(1) · ใช้ทั้งคู่ = เส้นเต็มก่อน แล้วตามด้วยเศษ
              ? <>{r.cut.fresh ? <span className="xl-fresh">{nlen(r.cut.stock)}({nf(r.cut.fresh)}), </span> : null}<span className="rt-waste">{wasteLines(r.cut)}</span></>
              : r.cut ? nlen(r.cut.stock) : nlen(r.ml)}</td>
            <td className="r">{qCell(r, u)}</td><td className="r"><b>{r.cx ? "0" : nlen(Math.round(r.sum * 1000) / 1000)}</b></td><td>{um(r)}</td>
            {wasteOn ? <>
              <td className="bm-flow">{(() => { const f = cutFlow(r.cut); return (<>
                {r.cut?.fresh ? <div><Pill tone="muted">เส้นเต็ม {nlen(r.cut.stock)} ×{nf(r.cut.fresh)}</Pill></div> : null}
                {f.from.length ? <div className="small rt-waste">← เศษจาก {f.from.join(", ")}</div> : null}
                {f.to.length ? <div className="small rw-muted">→ เศษไปใช้ที่ {f.to.join(", ")}</div> : null}
              </>); })()}</td></> : null}
          </tr></Fragment>); })}</tbody>
        <tfoot><tr><td colSpan={nCols}>{nf(rows.length)} บรรทัด · SUB = ซับ (โค้ดเขียวตัวหนา) · โค้ดเขียว = ลูกในซับ · <span className="xl-off">OFF</span> = ตัดจากเศษ{wasteOn ? "" : " (กด \"การคำนวณเศษ\" ด้านบนเพื่อดูรายละเอียด)"} · Sum = Quantity × ซับชั้นบน × จำนวนแผง</td></tr></tfoot>
      </table></div>);
  }

  const stat = ALL
    ? { n: model.total, subs: new Set(scope.flatMap((t) => t.rows.filter((r) => !r.cx && r.kind === "sub").map((r) => r.code))).size, parts: new Set(scope.flatMap((t) => t.rows.filter((r) => !r.cx && r.kind === "part").map((r) => r.code))).size, hw: new Set(scope.flatMap((t) => t.rows.filter((r) => !r.cx && r.kind === "hw").map((r) => r.code))).size, pcs: scope.reduce((a, t) => a + t.pcs, 0), off: scope.reduce((a, t) => a + t.off, 0), fresh: scope.reduce((a, t) => a + t.fresh, 0) }
    : cur ? { n: cur.n, subs: cur.subs, parts: cur.parts, hw: cur.hw, pcs: cur.pcs, off: cur.off, fresh: cur.fresh } : null;

  return (
    <div className={`bm ${listOff ? "list-off" : ""}`}>
      {listOff ? null : <aside className="bm-side" aria-label="แบบแผง">
        <div className="bm-side-top"><input className="input rw-search" style={{ marginTop: 0, maxWidth: "none" }} placeholder="ค้นหาแบบแผง" value={lq} onChange={(e) => setLq(e.target.value)} aria-label="ค้นหาแบบแผง" /><button type="button" className="bm-fold" onClick={() => setListOff(true)} title="พับรายการแบบแผง — ตารางกว้างขึ้น (เลือกแบบแผงจาก dropdown เหนือตาราง)" aria-label="พับรายการแบบแผง">‹</button></div>
        <label className="bm-lsort2"><span>เรียง</span><select className="select" value={lsort.k + ":" + lsort.d} onChange={(e) => { const [k, d] = e.target.value.split(":"); setLsort({ k, d: Number(d) }); }} aria-label="เรียงแบบแผง">
          <option value="unit:1">ชื่อ A→Z</option><option value="unit:-1">ชื่อ Z→A</option><option value="n:-1">จำนวนแผง มาก→น้อย</option><option value="rows:-1">จำนวนรายการ มาก→น้อย</option><option value="off:-1">ใช้เศษ มาก→น้อย</option></select></label>
        <div className="bm-list" role="listbox">
          <button type="button" role="option" aria-selected={ALL} className={`bm-li all ${ALL ? "on" : ""}`} onClick={() => { setSel("__ALL__"); setLimit(PAGE); }}><b>ทุกแบบแผง</b><small>{nf(model.types.size)} แบบ · {nf(model.total)} แผง</small></button>
          {list.map((t) => (
            <button key={t.unit} type="button" role="option" aria-selected={!ALL && cur?.unit === t.unit} className={`bm-li ${!ALL && cur?.unit === t.unit ? "on" : ""}`} onClick={() => { setSel(t.unit); setLimit(PAGE); }}>
              <b className="rw-mono">{t.unit}</b><span className="bm-li-n">{nf(t.n)}</span>
              <small>{t.has ? `${nf(t.subs)} ซับ · ${nf(t.parts)} พาร์ท${t.off ? ` · เศษ ${nf(t.off)}` : ""}` : "ไม่มี BOM"}</small>
            </button>))}
        </div>
      </aside>}
      <section className="bm-main-pane">
        {listOff ? <div className="bm-pick"><button type="button" className="bm-fold open" onClick={() => setListOff(false)} title="แสดงรายการแบบแผงด้านซ้าย" aria-label="แสดงรายการแบบแผง">›</button>
          <label><span>แบบแผง</span> <select className="select" value={ALL ? "__ALL__" : cur?.unit || ""} onChange={(e) => { setSel(e.target.value); setLimit(PAGE); }} aria-label="เลือกแบบแผง">
            <option value="__ALL__">ทุกแบบแผง ({nf(model.types.size)} แบบ · {nf(model.total)} แผง)</option>
            {list.map((t) => <option key={t.unit} value={t.unit}>{t.unit} · {nf(t.n)} แผง{t.has ? "" : " · ไม่มี BOM"}</option>)}</select></label></div> : null}
        {stat ? (
          <>
            <div className="bm-head">
              <div className="bm-title"><b className="rw-mono">{ALL ? "ทุกแบบแผง" : cur.unit}</b><span>{ALL ? `${nf(model.types.size)} แบบ` : cur.desc}</span></div>
              <div className="bm-kpis">
                <span><b>{nf(stat.n)}</b><small>แผง</small></span><span><b>{nf(stat.subs)}</b><small>ซับ</small></span><span><b>{nf(stat.parts)}</b><small>พาร์ท</small></span><span><b>{nf(stat.hw)}</b><small>สกรู/ยาง</small></span><span><b>{nf(stat.pcs)}</b><small>ชิ้นต้องตัด</small></span>
                <span className={stat.off ? "off" : ""}><b>{nf(stat.off)}</b><small>ใช้เศษ</small></span>
              </div>
            </div>
            <div className="bm-bar">
              <div className="rw-tabs bm-views" role="tablist">
                {[["tree", "โครงสร้าง"], ["merge", "รวมเบอร์"], ["table", "ตารางเต็ม"]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={v === k} disabled={ALL && k === "tree"} title={ALL && k === "tree" ? "เลือกแบบแผงเดียวเพื่อดูโครงสร้าง" : ""} className={v === k ? "on" : ""} onClick={() => { setView(k); setLimit(PAGE); setSort({ k: "", d: 1 }); }}>{l}</button>)}
              </div>
              <input className="input rw-search" style={{ marginTop: 0 }} placeholder="ค้นหาเบอร์ / รายละเอียด / MATERIAL" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} aria-label="ค้นหาใน BOM" />
              {v === "tree" ? <><button type="button" className="btn btn-ghost btn-sm" onClick={() => setClosed(new Set(cur.rows.filter((r) => r.kind === "sub").map((r) => `${cur.unit}|${[...r.path, r.code].join(">")}`)))}>พับทั้งหมด</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setClosed(new Set())}>ขยายทั้งหมด</button></> : null}
              <span className="rw-muted small">{v === "tree" ? `${nf(shown)} / ${nf(count)} บรรทัด` : `แสดง ${nf(shown)} จาก ${nf(count)}`}</span>
              {v === "table" ? <button type="button" className={`btn btn-sm ${wasteOn ? "btn-accent" : "btn-ghost"}`} aria-pressed={wasteOn} onClick={() => setWasteOn(!wasteOn)} title="แสดง / ซ่อนคอลัมน์ WAST · ความยาวเศษ · เส้นเต็ม ↔ เศษ">{wasteOn ? "▾" : "▸"} การคำนวณเศษ</button> : null}
              <button type="button" className="btn btn-ghost btn-sm bm-xls" onClick={exportXlsx} disabled={xlsBusy} title={`ดาวน์โหลด BOM ${ALL ? "ทุกแบบแผง" : cur?.unit || ""} เป็น Excel — ชีต: ตารางเต็ม · รวมเบอร์ · โครงสร้าง (ทุกแถว ไม่ตามคำค้นหา)`}>{xlsBusy ? "กำลังสร้าง…" : "⬇ Excel"}</button>
            </div>
            {v === "tree" ? <div className="bm-cols"><span>เบอร์ / รายละเอียด / ส่งไปใบ</span><span className="r">ยาว</span><span>MATERIAL · เศษ</span><span className="r">ต่อชุด</span><span className="r">รวม (× {nf(cur.n)} แผง)</span></div> : null}
            {body}
            {v !== "tree" && count > shown ? <div className="rt-more"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit((n) => n + PAGE)}>แสดงเพิ่ม ({nf(Math.min(PAGE, count - shown))})</button></div> : null}
            <div className="rt-note bm-note">เศษ: ไล่ตัดตามลำดับแผงในใบนี้ · MATERIAL (INV) ตรงกัน ใช้เศษที่เหลือพอ (ยาว + รอยตัด {KERF} มม.) ก่อนเปิดเส้นใหม่ · เศษ ≥ {MIN_OFFCUT} มม. เก็บไว้ใช้ต่อ — เป็นการคำนวณเบื้องต้น ไม่ได้ตัดสต็อกจริง</div>
            {canEdit && v !== "merge" && !bedits.length ? <div className="rw-muted small bm-edhint">{v === "table" ? <>คลิกช่องเพื่อแก้: <b>PART NO. · DESCRIPTION · LENGTH · FINISH · MATERIAL · QUANTITY</b> (WAST / MATERIAL LENGTH / SUM คำนวณให้เอง)</> : <>คลิกตัวเลข <b>ต่อชุด</b> เพื่อแก้ · แก้ช่องอื่นได้ที่มุมมอง <b>ตารางเต็ม</b></>} · Enter = ตกลง · Esc = ยกเลิก · ข้อมูลของเบอร์ (รายละเอียด / ยาว / FINISH / MATERIAL) แก้ที่เดียวมีผลทุกแผง · เพิ่ม / ยกเลิกลูก ทำที่ ✎ Modify ใหม่ → แท็บ BOM</div> : null}
            {bedits.length ? (
              <div className="rt-pickbar rt-edbar" role="region" aria-label="BOM ที่แก้ค้างไว้">
                <span><b>แก้ BOM {nf(bedits.length)} จุด · ยังไม่ได้บันทึก</b>
                  <small>{bedits.slice(0, 3).map(lineOf).join(" · ")}{bedits.length > 3 ? ` · อีก ${bedits.length - 3}` : ""}</small></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearEd}>ยกเลิกที่แก้</button>
                {onSaveDirect ? <button type="button" className="btn btn-sm bm-nom" disabled={bbusy} onClick={saveDirect} title="แก้ BOM ตรง ๆ — ไม่มีเลข M · ไม่ลงประวัติ Modify">{bbusy ? "กำลังบันทึก…" : "บันทึก (ไม่นับ Modify)"}</button> : null}
                {onModify ? <button type="button" className="btn btn-accent" disabled={bbusy} onClick={saveAsM}>บันทึกเป็น {modVer(nextModNo(plan))} →</button> : null}
              </div>) : null}
          </>
        ) : <div className="rw-muted small rt-empty">ยังไม่มีแผงในใบนี้</div>}
      </section>
    </div>
  );
}
