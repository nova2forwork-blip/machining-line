// ══════════════════════════════════════════════════════════════════════════
// ★ 2026-11-12 ผู้ใช้: "ทุกตาราง ให้แก้ได้เหมือนตารางเต็ม · ให้เลือก save เป็น M หรือไม่ก็ได้ · Ctrl+Z ได้ไม่ว่าจะ save หรือยัง"
//   ตัวแก้กลางของกล่อง "ของในใบ" (BOM · Total Part · Total Sub · ASSEMBLY · Total Mat) — ใช้ชุดเดียว แถบล่างเดียว
//   คลิกช่อง → พิมพ์ → Enter · ที่แก้ค้างนับรวมที่แถบล่าง → [บันทึก (ไม่นับ Modify)] หรือ [บันทึกเป็น M-00x]
//   Ctrl+Z / Ctrl+Y: ที่ยังไม่บันทึก = ย้อนทีละช่อง · บันทึกแบบไม่นับ M แล้ว = ย้อนการบันทึก (ประวัติแผนของหน้า)
//     บันทึกเป็น M แล้ว = Ctrl+Z ถามก่อนแล้วย้อน M (ยกเลิก M ในล็อตที่โดนแก้ด้วย) — src/release/modUndo.js
//   ช่องที่แก้ได้ (f):
//     q / code  = จำนวนต่อชุด / เบอร์ ของลูก 1 บรรทัดในรายการแผง/ซับ (r.own = { scope, owner, oi })
//     d l f m rev h ml um pd = ข้อมูลของเบอร์ (มีผลทุกที่ที่ใช้เบอร์นั้น) · pd = รายละเอียดแบบแผง
//     tq = จำนวนต้องใช้ทั้งใบ (พาร์ท/ซับ) · rc = เปลี่ยนเบอร์ทุกบรรทัดที่ใช้เบอร์นี้
//     ua / uu = ที่อยู่ / แบบแผง ของแผงที่ยังไม่ปล่อย · mml = ความยาวเส้นของวัตถุดิบ (ทุกพาร์ทที่ใช้ INV นั้น)
// ══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { NC, nf, nlen, findKey, addrKey, needOf, nextModNo, modVer } from "./releaseCore.js";
import { askConfirm } from "../confirm.jsx";
import { useUndoState } from "../undo.js";

const EMPTY = { b: {}, a: {}, t: {}, c: {}, u: {}, m: {} };
const AF = { d: "d", l: "l", f: "f", m: "m", rev: "rev", h: "h", ml: "ml", um: "u", pd: "d" };
const NUMF = new Set(["q", "l", "h", "ml", "tq", "mml"]);
const ITEM_F = new Set(["q", "code"]);
export const FL = { q: "ต่อชุด", code: "เบอร์", d: "รายละเอียด", l: "ความยาว", f: "FINISH", m: "MATERIAL", rev: "Rev", h: "H", ml: "L วัตถุดิบ", um: "U.M.", u: "U.M.", pd: "รายละเอียดแผง",
  tq: "จำนวนทั้งใบ", rc: "เปลี่ยนเบอร์", ua: "ที่อยู่", uu: "แบบแผง", mml: "ความยาวเส้น" };

export function useBomEdit({ plan, rel = null, onSaveDirect = null, onModify = null }) {
  const canEdit = !!(onSaveDirect || onModify);
  const [S, setS, resetHist] = useUndoState(EMPTY, { label: "แก้ตาราง" });
  const [cur, setCur] = useState(null);
  const [busy, setBusy] = useState(false);
  const clear = () => { setS(EMPTY); setCur(null); setTimeout(resetHist, 0); };
  useEffect(() => { clear(); }, [(plan.mods || []).length, plan.ro]);   // eslint-disable-line react-hooks/exhaustive-deps

  const okey = (r) => (r.own ? `${r.own.scope}|${r.own.owner}|${r.own.oi}` : "");
  const akey = (r, f) => (f === "pd" ? `panel|${NC(r.unit)}` : `${r.kind === "sub" ? "sub" : "part"}|${NC(r.code)}`);
  const tkey = (r) => `${r.kind === "sub" ? "sub" : "part"}|${r.code}`;
  const ownItem = (k) => { const [sc, ow, oi] = k.split("|"); const col = sc === "panel" ? plan.bom.panels : plan.bom.subs; const o = col[ow]; return o && o.items ? o.items[Number(oi)] : null; };
  const attrOf = (ak) => { const i = ak.indexOf("|"); const kd = ak.slice(0, i), c = ak.slice(i + 1); const col = kd === "panel" ? plan.bom.panels : kd === "sub" ? plan.bom.subs : plan.bom.parts; const k = findKey(col, c); return { kd, k, e: k ? col[k] : null }; };
  // บรรทัดใน BOM ที่ใช้เบอร์นี้ (ใช้ตอนเปลี่ยนเบอร์ทั้งใบ)
  const occOf = (kind, code) => { const out = []; const t = kind === "sub" ? "sub" : "part";
    for (const [scope, col] of [["panel", plan.bom.panels], ["sub", plan.bom.subs]]) for (const [owner, o] of Object.entries(col || {})) (o.items || []).forEach((it, idx) => { if (it[0] === t && NC(it[1]) === NC(code) && (it[4] || "") !== "ยกเลิก") out.push({ scope, owner, idx, q: it[2] }); });
    return out; };
  const curVal = (r, f) => ({ q: r.q, code: r.code, d: r.d || "", l: r.l ?? "", f: r.f || "", m: r.m || "", rev: r.rev || "", h: r.h ?? "", ml: r.ml ?? "", um: r.uom || "", pd: r.pdesc || "",
    tq: r.qty, rc: r.code, ua: r.addr || "", uu: r.unit || "", mml: r.stock ?? "" })[f];
  const pend = (r, f) => {
    if (ITEM_F.has(f)) return S.b[okey(r)]?.[f];
    if (f === "tq") return S.t[tkey(r)];
    if (f === "rc") return S.c[tkey(r)];
    if (f === "ua" || f === "uu") return S.u[addrKey(r.addr)]?.[f];
    if (f === "mml") return S.m[r.inv || "—"]?.to;
    return S.a[akey(r, f)]?.[AF[f]];
  };
  const parse = (f, raw) => { const t = String(raw ?? "").trim(); const num = () => Number(t.replace(/,/g, ""));
    if (f === "q") { const n = num(); return t !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : undefined; }
    if (f === "tq") { const n = num(); return t !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined; }
    if (f === "l" || f === "h" || f === "ml" || f === "mml") { const n = num(); return t !== "" && Number.isFinite(n) && n > 0 ? n : undefined; }
    if (f === "code" || f === "m" || f === "rc" || f === "ua" || f === "uu") return t ? t.toUpperCase() : undefined;
    if (f === "d" || f === "pd") return t || undefined;
    if (f === "rev") return t.toUpperCase();
    if (f === "um") return t ? t.toLowerCase().replace(/^(pcs|m|set|ea)$/, "$1.") : undefined;
    return t; };   // FINISH เว้นว่างได้
  const put = (part, k, fk, v) => setS((s) => {
    const sec = { ...s[part] };
    if (fk == null) { if (v === undefined) delete sec[k]; else sec[k] = v; }
    else { const nx = { ...(sec[k] || {}) }; if (v === undefined) delete nx[fk]; else nx[fk] = v; if (Object.keys(nx).length) sec[k] = nx; else delete sec[k]; }
    return { ...s, [part]: sec };
  });
  const setVal = (r, f, raw) => {
    const v0 = parse(f, raw); const c0 = curVal(r, f);
    const same = v0 === undefined || (typeof v0 === "number" ? Math.abs(v0 - Number(c0)) < 1e-9 : String(v0) === String(c0 ?? "").trim() || ((f === "code" || f === "rc") && NC(v0) === NC(c0)));
    const v = same ? undefined : v0;
    if (ITEM_F.has(f)) put("b", okey(r), f, v);
    else if (f === "tq") put("t", tkey(r), null, v === undefined ? undefined : { to: v, from: r.qty, base: r.orig ?? r.qty });
    else if (f === "rc") put("c", tkey(r), null, v);
    else if (f === "ua" || f === "uu") put("u", addrKey(r.addr), f, v);
    else if (f === "mml") put("m", r.inv || "—", null, v === undefined ? undefined : { to: v, from: r.stock, codes: r.codes || [] });
    else put("a", akey(r, f), AF[f], v);
  };
  const canF = (r, f) => {
    if (!canEdit) return false;
    if (f === "mml") return true;
    if (f === "ua" || f === "uu") return !r.cx && !r.released;
    if (f === "pd") return true;
    if (r.cx) return false;
    if (ITEM_F.has(f)) return !!r.own;
    if (f === "tq") return (r.kind === "part" || r.kind === "sub") && r.qr !== false;
    if (f === "rc") return (r.kind === "part" || r.kind === "sub") && occOf(r.kind, r.code).length > 0;
    if (f === "m" || f === "h" || f === "ml") return r.kind === "part";
    if (f === "um") return r.kind === "hw";
    return true;
  };
  const fmtF = (f, v) => (NUMF.has(f) ? (v === "" || v == null ? "—" : nlen(v)) : v === "" || v == null ? "—" : String(v));
  const eCell = (r, f, uniq, shown) => {
    if (!canF(r, f)) return shown;
    const pv = pend(r, f); const pvv = pv && typeof pv === "object" ? pv.to : pv; const chg = pvv !== undefined; const c0 = curVal(r, f);
    const disp = chg ? <>{f === "d" || f === "pd" ? null : <s className="rl-old">{fmtF(f, c0)}</s>}<b>{fmtF(f, pvv)}</b></> : shown;
    const who = f === "pd" ? r.unit : f === "ua" || f === "uu" ? r.addr : f === "mml" ? r.inv : r.code;
    const id = `${f}|${okey(r) || who}|${uniq}`; const lab = `${FL[f]} ${who}`;
    if (cur === id) return <span className="bm-edhold"><span className="bm-ghost" aria-hidden="true">{disp}</span><input autoFocus className={`input bm-in ${NUMF.has(f) ? "num" : ""}`} defaultValue={chg ? pvv : c0} inputMode={NUMF.has(f) ? "decimal" : "text"} aria-label={lab}
      onFocus={(e) => e.target.select()} onBlur={(e) => { setVal(r, f, e.target.value); setCur((c) => (c === id ? null : c)); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") { e.target.value = String(chg ? pvv : c0); e.target.blur(); } }} /></span>;
    const tip = ITEM_F.has(f) ? (r.own.scope === "sub" ? `แก้ในซับ ${r.own.owner} — มีผลทุกแผงที่ใช้ซับนี้` : `แก้ในแผง ${r.own.owner}`)
      : f === "pd" ? `แก้รายละเอียดของแบบแผง ${r.unit}` : f === "tq" ? `แก้จำนวนที่ต้องใช้ทั้งใบของ ${r.code}` : f === "rc" ? `เปลี่ยน ${r.code} เป็นเบอร์อื่น ทุกบรรทัดใน BOM`
      : f === "ua" || f === "uu" ? `แก้แผง ${r.addr} (ยังไม่ปล่อย)` : f === "mml" ? `แก้ความยาวเส้น ${r.inv} — ทุกพาร์ทที่ใช้วัตถุดิบนี้` : `แก้ข้อมูลของเบอร์ ${r.code} — มีผลทุกแผง / ทุกซับที่ใช้เบอร์นี้`;
    return <button type="button" className={`bm-qbtn ${NUMF.has(f) ? "num" : ""} ${chg ? "ed" : ""}`} onClick={() => setCur(id)} aria-label={lab} title={tip}>{disp}</button>;
  };
  // คลิกตรงไหนในช่องก็ได้ → เปิดแก้ช่องนั้น (ใส่ที่ <table onClick>)
  const tableClick = (e) => { if (e.target.closest("button, input, a, select, label, textarea")) return; const td = e.target.closest("td"); const btn = td && td.querySelector(":scope > .bm-qbtn, :scope > span > .bm-qbtn, .bm-qbtn"); if (btn) btn.click(); };

  // รายการที่แก้ค้าง (แบน)
  const list = useMemo(() => {
    const out = [];
    for (const [k, v] of Object.entries(S.b)) { const it = ownItem(k); if (!it) continue; const [scope, owner, oi] = k.split("|");
      const base = { scope, owner, idx: Number(oi), kind: it[0], code: it[1], before: it[2] };
      if (v.code !== undefined) out.push({ ...base, f: "code", from: it[1], to: v.code, q: v.q });
      if (v.q !== undefined) out.push({ ...base, f: "q", from: it[2], to: v.q }); }
    const attrSeen = new Set();
    for (const [ak, v] of Object.entries(S.a)) { const { kd, k, e } = attrOf(ak); if (!e) continue;
      for (const f of ["d", "l", "f", "m", "rev", "h", "ml", "u"]) if (v[f] !== undefined) { attrSeen.add(`${kd}|${k}|${f}`); out.push({ attr: true, kd, key: k, code: k, f: kd === "panel" && f === "d" ? "pd" : f, fld: f, from: e[f] ?? "", to: v[f], hw: e.k === "hw" }); } }
    for (const [inv, v] of Object.entries(S.m)) for (const c of v.codes || []) { const k = findKey(plan.bom.parts, c); if (!k || attrSeen.has(`part|${k}|ml`)) continue; out.push({ attr: true, kd: "part", key: k, code: k, f: "ml", fld: "ml", from: plan.bom.parts[k].ml ?? v.from ?? "", to: v.to, inv }); }
    for (const [k, v] of Object.entries(S.t)) { const i = k.indexOf("|"); out.push({ tq: true, kind: k.slice(0, i), code: k.slice(i + 1), f: "tq", from: v.from, to: v.to, base: v.base }); }
    for (const [k, v] of Object.entries(S.c)) { const i = k.indexOf("|"); const kind = k.slice(0, i), code = k.slice(i + 1); out.push({ rc: true, kind, code, f: "rc", from: code, to: v, occ: occOf(kind, code) }); }
    for (const [k, v] of Object.entries(S.u)) { const u = (plan.units || []).find((x) => addrKey(x.addr) === k); if (!u) continue; out.push({ unit: true, key: k, f: v.ua !== undefined ? "ua" : "uu", from: `${u.addr} · ${u.unit}`, to: `${v.ua ?? u.addr} · ${v.uu ?? u.unit}`, addr: v.ua, unitTo: v.uu, code: u.addr }); }
    return out;
  }, [S, plan.bom, plan.units]);   // eslint-disable-line react-hooks/exhaustive-deps
  const lineOf = (e) => (e.attr ? `${e.code} ${FL[e.f]} ${fmtF(e.f, e.from)} → ${fmtF(e.f, e.to)}`
    : e.tq ? `${e.code} ทั้งใบ ${nlen(e.from)} → ${nlen(e.to)}`
    : e.rc ? `${e.from} → ${e.to} (${e.occ.length} บรรทัดใน BOM)`
    : e.unit ? `แผง ${e.from} → ${e.to}`
    : `${e.f === "code" ? `${e.from} → ${e.to}` : `${e.code} ต่อชุด ${nlen(e.from)} → ${nlen(e.to)}`} ใน${e.scope === "panel" ? "แผง" : "ซับ"} ${e.owner}`);

  // แผนใหม่จากที่แก้ (ไม่ผ่าน Modify)
  const buildDirect = (lst) => {
    const bom = { ...plan.bom, panels: { ...plan.bom.panels }, subs: { ...plan.bom.subs }, parts: { ...plan.bom.parts } };
    const errs = []; const cloned = new Set(); let adj = null; let units = null; let matOv = null;
    const own = (scope, owner) => { const col = scope === "panel" ? bom.panels : bom.subs; if (!col[owner]) return null; const ck = scope + "|" + owner; if (!cloned.has(ck)) { col[owner] = { ...col[owner], items: (col[owner].items || []).map((x) => [...x]) }; cloned.add(ck); } return col[owner]; };
    const ent = (kd, key) => { const col = kd === "panel" ? bom.panels : kd === "sub" ? bom.subs : bom.parts; const ck = "e|" + kd + "|" + key; if (!cloned.has(ck)) { col[key] = { ...col[key] }; cloned.add(ck); } return col[key]; };
    const setCode = (scope, owner, idx, from, to) => { const o = own(scope, owner); const it = o && o.items[idx]; if (!it) return;
      if (it[0] === "sub") { if (!findKey(bom.subs, to)) { errs.push(`${to}: ยังไม่มี BOM ของซับนี้ในใบ — เปลี่ยนเป็นซับใหม่ทำผ่าน ✎ Modify (เพิ่มเบอร์ / วางแบบ)`); return; } }
      else if (!findKey(bom.parts, to)) { const src = bom.parts[findKey(bom.parts, from)] || {}; bom.parts[to] = { ...src }; }
      it[1] = to; };
    for (const e of lst) {
      if (e.attr) {
        // ค่าที่ถูกทับไว้ (matOv / lenOv): จาก Modify → ต้องแก้ต่อเป็น M · วัสดุที่เปลี่ยนเองด้วย ✎ (ไม่ใช่ Modify) → แก้ที่ตัวทับนั้นเลย ทุกตารางจะตรงกัน
        const mk = findKey(plan.matOv || {}, e.code), lk = findKey(plan.lenOv || {}, e.code);
        if (e.f === "l" && e.kd !== "panel" && lk) { errs.push(`${e.code}: ความยาวถูกเปลี่ยนใน Modify แล้ว — แก้ต่อต้องเป็น M`); continue; }
        if ((e.f === "m" || e.f === "ml") && e.kd === "part" && mk) {
          if (/^Modify /.test(String(plan.matOv[mk].r || ""))) { errs.push(`${e.code}: วัสดุถูกเปลี่ยนใน Modify แล้ว — แก้ต่อต้องเป็น M`); continue; }
          matOv = matOv || { ...(plan.matOv || {}) }; matOv[mk] = { ...matOv[mk], ...(e.f === "m" ? { to: e.to } : { ml: e.to }) }; continue; }
        const x = ent(e.kd, e.key); x[e.fld || e.f] = e.to; continue; }
      if (e.tq) { adj = adj || { ...(plan.adj || {}) }; if (Math.abs(e.to - (e.base ?? -1)) < 1e-9 && !(adj[e.code] && adj[e.code].ver)) delete adj[e.code]; else adj[e.code] = { qty: e.to, ver: "" }; continue; }
      if (e.rc) { for (const o of e.occ) setCode(o.scope, o.owner, o.idx, e.from, e.to); continue; }
      if (e.unit) {
        units = units || (plan.units || []).map((u) => ({ ...u }));
        const u = units.find((x) => addrKey(x.addr) === e.key); if (!u) continue;
        if (e.addr !== undefined) { const dup = units.some((x) => x !== u && addrKey(x.addr) === addrKey(e.addr)); if (dup) { errs.push(`ที่อยู่ ${e.addr} ซ้ำกับแผงอื่นในใบ`); continue; } u.addr = e.addr; }
        if (e.unitTo !== undefined) { if (!findKey(bom.panels, e.unitTo)) errs.push(`แบบแผง ${e.unitTo} ยังไม่มี BOM ในใบ — อัพแบบแผงก่อน`); else u.unit = e.unitTo; }
        continue; }
      if (e.f === "q") { const o = own(e.scope, e.owner); const it = o && o.items[e.idx]; if (it) it[2] = e.to; }
      else if (e.f === "code") setCode(e.scope, e.owner, e.idx, e.from, e.to);
    }
    const np = { ...plan, bom, ...(adj ? { adj } : {}), ...(units ? { units } : {}), ...(matOv ? { matOv } : {}), bomFix: [...(plan.bomFix || []), { at: new Date().toISOString(), items: lst.map((e) => ({ what: e.f, code: e.code, ...(e.scope ? { scope: e.scope, owner: e.owner } : {}), from: e.from, to: e.to })) }] };
    return { np, errs };
  };
  const relQ = (c) => (rel && rel.byCode.get(NC(c)) ? rel.byCode.get(NC(c)).qty : 0);
  const needDiff = (np) => { const n0 = needOf(plan), n1 = needOf(np); const diff = [], low = [];
    for (const key of ["subs", "parts"]) { for (const r1 of n1[key]) { const r0 = n0[key].find((x) => NC(x.code) === NC(r1.code)); const a = r0 ? r0.qty : 0; if (Math.abs(a - r1.qty) < 1e-9) continue; diff.push(`${r1.code} ${nlen(a)} → ${nlen(r1.qty)}`); if (r1.qty < relQ(r1.code)) low.push(`${r1.code} (ปล่อยแล้ว ${nf(relQ(r1.code))} · ยอดใหม่ ${nlen(r1.qty)})`); }
      for (const r0 of n0[key]) if (!n1[key].some((x) => NC(x.code) === NC(r0.code)) && r0.qty) { diff.push(`${r0.code} ${nlen(r0.qty)} → 0`); if (relQ(r0.code) > 0) low.push(`${r0.code} (ปล่อยแล้ว ${nf(relQ(r0.code))} · ยอดใหม่ 0)`); } }
    return { diff, low }; };
  async function saveDirect() {
    if (!onSaveDirect || !list.length || busy) return;
    const { np, errs } = buildDirect(list); const { diff, low } = needDiff(np);
    const relTouched = list.filter((e) => e.attr && (e.f === "m" || e.f === "l" || e.f === "ml") && relQ(e.code) > 0).map((e) => e.code);
    if (errs.length || low.length) { await askConfirm({ title: "บันทึกแบบไม่นับ Modify ไม่ได้", message: [...errs, ...(low.length ? ["ยอดใหม่ต่ำกว่าที่ปล่อยไปแล้ว:", ...low] : []), "", `ใช้ "บันทึกเป็น ${modVer(nextModNo(plan))}" แทน — ระบบจะลด/ยกเลิกในล็อตให้และเก็บประวัติ`].join("\n"), tone: "warn", confirmText: "ตกลง", cancelText: "ปิด" }); return; }
    const ok = await askConfirm({ title: `บันทึก ${list.length} จุด โดยไม่นับ Modify?`, message: [...list.slice(0, 20).map((e) => `• ${lineOf(e)}`), list.length > 20 ? `… อีก ${list.length - 20}` : "", "", diff.length ? `ยอดต้องใช้ทั้งใบที่เปลี่ยน: ${diff.slice(0, 12).join(" · ")}${diff.length > 12 ? " …" : ""}` : "ยอดต้องใช้ทั้งใบไม่เปลี่ยน",
      relTouched.length ? `\n⚠ ${[...new Set(relTouched)].join(", ")} ปล่อยไปแล้ว — ใบงาน / แถวที่ปล่อยแล้วยังเป็นค่าเดิม (กด "อัปเดตความยาว · วัสดุ · น้ำหนัก" ที่แถบด้านข้างถ้าจะตามค่าใหม่)` : "", "", "ไม่มีเลข M · ไม่ลงประวัติ Modify · ใช้กับล็อตที่ปล่อยต่อจากนี้ · Ctrl+Z ย้อนได้"].filter(Boolean).join("\n"), tone: "warn", confirmText: "บันทึก", cancelText: "กลับไปแก้" });
    if (!ok) return;
    setBusy(true); try { await onSaveDirect(np); clear(); } finally { setBusy(false); }
  }
  async function saveAsM() {
    if (!onModify || !list.length) return;
    // ไม่มีในใบ Modify → บันทึกตรงก่อน: รายละเอียด / FINISH / Rev / H / ความยาวเส้น / U.M. / รายละเอียดแผง / แผง (ที่อยู่ · แบบ)
    const direct = list.filter((e) => e.unit || (e.attr && !((e.f === "m" && e.kd === "part") || (e.f === "l" && !e.hw && e.kd !== "panel"))));
    if (direct.length) {
      const ok = await askConfirm({ title: "บางอย่างไม่อยู่ใน Modify", message: [...direct.slice(0, 15).map((e) => lineOf(e)), "", `${[...new Set(direct.map((e) => FL[e.f]))].join(" / ")} ไม่มีในใบ Modify — จะบันทึกตรงไปก่อน (ไม่นับ M) แล้วเปิดหน้า ${modVer(nextModNo(plan))} สำหรับที่เหลือ`].join("\n"), tone: "warn", confirmText: "ตกลง ทำต่อ", cancelText: "กลับไปแก้" });
      if (!ok) return;
      const { np, errs } = buildDirect(direct);
      if (errs.length) { await askConfirm({ title: "บันทึกไม่ได้", message: errs.join("\n"), tone: "warn", confirmText: "ตกลง", cancelText: "ปิด" }); return; }
      if (onSaveDirect) { setBusy(true); try { await onSaveDirect(np); } finally { setBusy(false); } }
    }
    const rest = list.filter((e) => !direct.includes(e));
    const chg = {}, bchg = {}, matChg = [];
    for (const e of rest) {
      if (e.attr) { matChg.push({ id: `${NC(e.code)}|${e.f === "m" ? "mat" : "len"}`, code: e.code, kind: e.kd === "sub" ? "sub" : "part", field: e.f === "m" ? "mat" : "len", from: e.from === "" ? "—" : e.from, to: e.to, file: "", on: true }); continue; }
      if (e.tq) { chg[`${e.kind}|${e.code}`] = { type: "qty", qty: String(e.to) }; continue; }
      if (e.rc) { for (const o of e.occ) bchg[`${o.scope}|${o.owner}|${o.idx}`] = { type: "replace", newCode: e.to, qty: String(o.q) }; continue; }
      const k = `${e.scope}|${e.owner}|${e.idx}`;
      if (e.f === "code") bchg[k] = { type: "replace", newCode: e.to, qty: String(e.q ?? e.before) };
      else if (!bchg[k]) bchg[k] = { type: "qty", qty: String(e.to) };
    }
    clear();
    if (!Object.keys(chg).length && !Object.keys(bchg).length && !matChg.length) return;
    const firstB = Object.keys(bchg)[0];
    onModify({ chg, bchg, matChg, ...(firstB ? { bscope: firstB.split("|")[0], bowner: firstB.split("|")[1] } : {}) });
  }
  const barEl = list.length ? (
    <div className="rt-pickbar rt-edbar" role="region" aria-label="ที่แก้ค้างไว้">
      <span><b>แก้ {nf(list.length)} จุด · ยังไม่ได้บันทึก</b>
        <small>{list.slice(0, 3).map(lineOf).join(" · ")}{list.length > 3 ? ` · อีก ${list.length - 3}` : ""} · Ctrl+Z = ย้อนทีละช่อง</small></span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>ยกเลิกที่แก้</button>
      {onSaveDirect ? <button type="button" className="btn btn-sm bm-nom" disabled={busy} onClick={saveDirect} title="บันทึกตรง ๆ — ไม่มีเลข M · ไม่ลงประวัติ Modify · Ctrl+Z ย้อนได้">{busy ? "กำลังบันทึก…" : "บันทึก (ไม่นับ Modify)"}</button> : null}
      {onModify ? <button type="button" className="btn btn-accent" disabled={busy} onClick={saveAsM}>บันทึกเป็น {modVer(nextModNo(plan))} →</button> : null}
    </div>) : null;
  const qCellOf = (r, uniq, shown) => eCell(r, "q", uniq, shown);
  return { canEdit, eCell, qCellOf, tableClick, barEl, count: list.length, clear };
}
