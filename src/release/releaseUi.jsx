// ชิ้นส่วนหน้าจอที่ใช้ร่วมกัน (หน้า Release · ตัวสร้างล็อต · Modify · Total)
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { askConfirm } from "../confirm.jsx";
import { NC, findKey, nlen, nf, PART_CATS, UNCAT, seedPartGroups, partGroupsOf } from "./releaseCore.js";

export const SUB_SHORT = { "พับ": "พับ", "เชื่อม": "เชื่อม", "ยิง": "ยิง", "Site Item": "Site Item" };
export function Pill({ tone = "muted", children, title }) { return <span className={`rw-pill ${tone}`} title={title}>{children}</span>; }
// จำนวนที่ถูก Modify: ยอดเดิมขีดฆ่า → ยอดใหม่ · ยกเลิก = ไม่ขีด แต่เป็นสีแดง + ป้ายยกเลิก
export function ModQty({ orig, cur, ver, cancel, unit = "" }) {
  if (cancel) return <span className="rl-mq"><span className="rl-cxq">{nf(orig)}</span>{cur ? <> → <b>{nf(cur)}</b></> : null} <Pill tone="bad">ยกเลิก {ver || ""}</Pill></span>;
  if (orig != null && Math.abs(orig - cur) > 1e-9) return <span className="rl-mq"><s className="rl-old">{nf(orig)}</s> <b className="rl-new">{nf(cur)}</b>{unit ? <small> {unit}</small> : null} {ver ? <Pill tone="mod">{ver}</Pill> : null}</span>;
  return <span>{nf(cur)}{unit ? <small className="rw-muted"> {unit}</small> : null}</span>;
}
// เบอร์ที่ถูกยกเลิก = เปลี่ยนเป็นสีแดง (ไม่ขีดฆ่า)
// added = "M-001" (จาก Modify · ป้ายม่วง) หรือ "จากแบบ …" / "ใหม่" (จาก "เพิ่มรายการ" ไม่นับ Modify · ป้ายฟ้า)
export const Code = ({ code, cancel, added }) => <><b className={cancel ? "rl-cx" : ""} title={cancel ? "ยกเลิกแล้ว" : undefined}>{code}</b>{added ? <> {/^M-\d/.test(String(added)) ? <ModTag ver={added} /> : <Pill tone="info">{added}</Pill>}</> : null}</>;
// ★ 2026-11-11 ผู้ใช้: "ตรงนี้กดได้ เอาเพิ่ม ออกด้วย" → ป้ายม่วง M-001 (เบอร์ที่เพิ่มจาก Modify) กดแล้วเปิดประวัติ Modify ของ M นั้น
//   ส่งเป็น event ให้หน้า Release (ReleasePlanView) เปิดลิ้นชักเอง — ไม่ต้องร้อย prop ผ่านทุกตาราง
export const ModTag = ({ ver }) => <button type="button" className="rw-pill mod rl-modtag" title={`เพิ่มจาก ${ver} — กดดูก่อน / หลัง`}
  onClick={(e) => { e.stopPropagation(); try { window.dispatchEvent(new CustomEvent("rl-open-mod", { detail: String(ver) })); } catch { /* ignore */ } }}>{ver}</button>;

// ══ แถบหมวดย่อยของพาร์ท: Auto (ตามกติกาเบอร์) / Setting (ตั้งหมวดเอง + ตัวหน้าของเบอร์) ══
//   ใช้ทั้งหน้า Release (Total Part) และหน้า "ซับ / พาร์ท ของโปรเจค"
//   props: mode ("auto"|"setting") · groups [{name, prefixes}] · catOv {code→หมวด} · bom (ไว้เดาตัวหน้าตอนกด Setting ครั้งแรก)
//          counts Map(หมวด→จำนวน) · filter ("ALL"|หมวด) · onFilter(หมวด) · onChange({ partMode, partGroups, catOv, destOv })
export function PartGroupBar({ mode, groups, catOv = {}, bom, counts, filter = "ALL", onFilter, onChange, hint = true }) {
  const setting = mode === "setting";
  const plan = { partMode: mode, partGroups: groups, catOv };
  const [newGrp, setNewGrp] = useState(""); const [newPre, setNewPre] = useState(""); const [editGrp, setEditGrp] = useState(null);
  const parsePre = (t) => [...new Set(String(t || "").split(/[\s,;/]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const setMode = async (m) => {
    if ((m === "auto") === !setting) return;
    if (m === "auto") {
      if (Object.keys(catOv).length && !(await askConfirm({ title: "กลับไปแยกหมวดอัตโนมัติ?", message: "หมวดที่ตั้งเองจะถูกล้าง แล้วระบบแยกหมวดให้ใหม่ตามกติกาเบอร์ (เบอร์ที่มี * → SITE ITEM)", tone: "warn", confirmText: "Auto", cancelText: "กลับ" }))) return;
      onChange({ partMode: "auto", catOv: {}, destOv: {} }); onFilter && onFilter("ALL");
    } else onChange({ partMode: "setting", partGroups: groups && groups.length ? groups.map((g) => (typeof g === "string" ? { name: g, prefixes: [] } : { prefixes: [], ...g })) : seedPartGroups(bom || { parts: {} }) });
  };
  const addGroup = () => { const n = newGrp.trim().toUpperCase(); if (!n) return; if ((groups || []).some((g) => (g.name || g) === n)) { setNewGrp(""); return; } onChange({ partGroups: [...(groups || []), { name: n, prefixes: parsePre(newPre) }] }); setNewGrp(""); setNewPre(""); };
  const saveGroup = () => {
    if (!editGrp) return; const old = editGrp.old; const n = editGrp.name.trim().toUpperCase(); if (!n) return;
    const nc = {}; for (const [c, v] of Object.entries(catOv)) nc[c] = v === old ? n : v;
    onChange({ partGroups: (groups || []).map((g) => ((g.name || g) === old ? { name: n, prefixes: parsePre(editGrp.pre) } : g)), catOv: nc });
    if (filter === old && onFilter) onFilter(n); setEditGrp(null);
  };
  const delGroup = (name) => { const nc = {}; for (const [c, v] of Object.entries(catOv)) if (v !== name) nc[c] = v; onChange({ partGroups: (groups || []).filter((g) => (g.name || g) !== name), catOv: nc }); if (filter === name && onFilter) onFilter("ALL"); };
  const total = [...(counts || new Map()).values()].reduce((a, b) => a + b, 0);
  const names = [...new Set([...partGroupsOf(plan), ...(setting ? [UNCAT] : [...(counts || new Map()).keys()])])].filter((n) => n && n !== "SUB-ASSEMBLY PART" && (setting || (counts && counts.get(n))));
  return (
    <div className="rt-mode" role="group" aria-label="วิธีแยกหมวดของพาร์ท">
      <span className="rt-mode-lab">หมวดย่อย:</span>
      <span className="rt-mode-seg">
        <button type="button" className={`rt-mode-btn ${!setting ? "on" : ""}`} onClick={() => setMode("auto")} title="ระบบแยกหมวดให้เองตามกติกาเบอร์ · เบอร์ที่มี * ไปเป็น SITE ITEM">Auto</button>
        <button type="button" className={`rt-mode-btn ${setting ? "on" : ""}`} onClick={() => setMode("setting")} title="สร้างหมวดเอง + ตัวหน้าของเบอร์ · ไม่เข้าพวก = รอจัดเอง">Setting</button>
      </span>
      <span className="rt-mode-sep" aria-hidden="true" />
      <span className="rt-groups">
        <button type="button" className={`rt-grp-chip tab ${filter === "ALL" ? "on" : ""}`} onClick={() => onFilter && onFilter("ALL")}><b>ทั้งหมด</b><small>{nf(total)}</small></button>
        {names.map((n) => {
          const g = (groups || []).find((x) => (x.name || x) === n); const pre = g && g.prefixes ? g.prefixes : []; const un = n === UNCAT;
          return (
            <span key={n} className={`rt-grp-chip tab ${filter === n ? "on" : ""} ${un ? "uncat" : !PART_CATS.includes(n) ? "custom" : ""}`} title={setting && pre.length ? `ตัวหน้า: ${pre.join(", ")}` : un ? "เบอร์ที่ไม่เข้าตัวหน้าของหมวดไหน — รอจัดเอง" : ""}>
              <button type="button" className="rt-grp-name" onClick={() => onFilter && onFilter(filter === n ? "ALL" : n)}>{n}{setting && !un ? <em className="rt-grp-pre">{pre.length ? pre.join(" ") : "ไม่มีตัวหน้า"}</em> : null}</button>
              <small>{nf((counts && counts.get(n)) || 0)}</small>
              {setting && !un ? <><button type="button" className="rt-grp-x" title="แก้ชื่อ / ตัวหน้า" onClick={() => setEditGrp({ old: n, name: n, pre: pre.join(", ") })} aria-label={`แก้หมวด ${n}`}>✎</button><button type="button" className="rt-grp-x" onClick={() => delGroup(n)} aria-label={`ลบหมวด ${n}`}>×</button></> : null}
            </span>); })}
      </span>
      {setting ? (
        <span className="rt-grp-form">
          {editGrp ? (
            <>
              <b className="small">แก้หมวด {editGrp.old}:</b>
              <input className="input rt-grp-in" value={editGrp.name} onChange={(e) => setEditGrp({ ...editGrp, name: e.target.value.toUpperCase() })} aria-label="ชื่อหมวด" placeholder="ชื่อหมวด" />
              <input className="input rt-grp-in wide" value={editGrp.pre} onChange={(e) => setEditGrp({ ...editGrp, pre: e.target.value.toUpperCase() })} onKeyDown={(e) => { if (e.key === "Enter") saveGroup(); }} aria-label="ตัวหน้าของเบอร์" placeholder="ตัวหน้า เช่น AL, BL, HZ (คั่นด้วย , · * = เบอร์ที่มี *)" />
              <button type="button" className="btn btn-accent btn-sm" onClick={saveGroup}>บันทึก</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditGrp(null)}>ยกเลิก</button>
            </>
          ) : (
            <>
              <b className="small">+ หมวดใหม่:</b>
              <input className="input rt-grp-in" placeholder="ชื่อหมวด" value={newGrp} onChange={(e) => setNewGrp(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") addGroup(); }} aria-label="ชื่อหมวดใหม่" />
              <input className="input rt-grp-in wide" placeholder="ตัวหน้าของเบอร์ เช่น AL, BL, HZ (คั่นด้วย ,)" value={newPre} onChange={(e) => setNewPre(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") addGroup(); }} aria-label="ตัวหน้าของหมวดใหม่" />
              <button type="button" className="btn btn-accent btn-sm" onClick={addGroup} disabled={!newGrp.trim()}>เพิ่ม</button>
            </>
          )}
        </span>) : null}
      {hint && setting ? <span className="rw-muted small rt-mode-hint">{setting ? `ตั้งหมวดเอง: เบอร์ที่ขึ้นต้นด้วย "ตัวหน้า" ของหมวดไหนเข้าหมวดนั้นอัตโนมัติ (ตัวหน้ายาวสุดชนะ · * ชนะทุกตัว) · ไม่เข้าพวก = "${UNCAT}" รอจัดเอง (คอลัมน์ "หมวด" หรือค้นหา → ติ๊ก → ย้ายไปหมวด)` : "แยกตามกติกาเบอร์ · เบอร์ที่มี * = SITE ITEM"}</span> : null}
    </div>
  );
}

// ★ เบอร์ลูกของซับ (จากคลังซับ/พาร์ทของโปรเจค) — ซับซ้อนซับกางต่อได้ทุกชั้น · กันวนซ้ำด้วย seen
// ★ หาเบอร์ target ใต้ซับ code (ไล่ทุกชั้น) → out[path] = true ทุกแถวซับที่ต้องกางเพื่อเห็นเบอร์นั้น (path รูปแบบเดียวกับที่ SubKids ใช้)
export function trailTo(lib, code, target, path, seen, out) {
  const L = lib || { subs: {}, parts: {} }; const sk = findKey(L.subs, code); const sub = sk ? L.subs[sk] : null; if (!sub) return false;
  let found = false;
  (sub.full || sub.items || []).filter((i) => (i[4] || "") !== "ยกเลิก").forEach((it, n) => {
    const [k, c] = it; const p2 = path + ">" + c + "#" + n;
    if (NC(c) === NC(target)) found = true;
    else if (k === "sub" && !seen.includes(NC(c)) && trailTo(lib, c, target, p2, [...seen, NC(c)], out)) found = true;
  });
  if (found) out[path] = true;
  return found;
}
export function SubKids({ lib, code, path, depth, open, setOpen, seen, compact = false, miss = null, focus = "" }) {
  const L = lib || { subs: {}, parts: {} };
  const sk = findKey(L.subs, code);
  const sub = sk ? L.subs[sk] : null;
  const pad = { paddingLeft: 10 + depth * 22 };
  if (!sub) return <tr className="rw-kid"><td /><td colSpan={compact ? 4 : 7} className="rw-muted small" style={pad}>↳ ยังไม่มีแบบซับ {code} ในโปรเจค — ลงที่หน้า “ซับ / พาร์ท ของโปรเจค” แล้วจะเห็นเบอร์ลูก</td></tr>;
  const items = (sub.full || sub.items || []).filter((i) => (i[4] || "") !== "ยกเลิก");   // full = ทุกบรรทัดจาก PDF ซับ (รวมสกรู/ยาง) · ไม่มี = ใช้ BOM ในระบบ
  if (!items.length) return <tr className="rw-kid"><td /><td colSpan={compact ? 4 : 7} className="rw-muted small" style={pad}>↳ ยังไม่ได้ลงแบบซับ {code} — ลาก PDF ของซับนี้ไปวางที่หน้า “ซับ / พาร์ท ของโปรเจค” แล้วกด “บันทึก” (เบอร์ลูกถึงจะขึ้น)</td></tr>;
  return items.map((it, n) => {
    const [k, c, q] = it;
    const isSub = k === "sub";
    const rec = isSub ? L.subs[findKey(L.subs, c)] : L.parts[findKey(L.parts, c)];
    const p2 = path + ">" + c + "#" + n;
    const loop = isSub && seen.includes(NC(c));
    return (
      <Fragment key={p2}>
        <tr className={`rw-kid${miss && miss.has(NC(c)) ? " rw-miss-row" : ""}${focus && NC(c) === NC(focus) ? " focus" : ""}`}>
          <td className="r rw-muted">↳</td>
          <td className="rw-mono" style={pad}>
            {isSub && !loop ? <button type="button" className="rw-tg" onClick={() => setOpen((o) => ({ ...o, [p2]: !o[p2] }))} aria-expanded={!!open[p2]}>{open[p2] ? "▾" : "▸"}</button> : null}
            <b>{c}</b> {isSub ? <Pill tone="sub">ซับ</Pill> : k === "hw" ? <Pill tone="muted">HW</Pill> : null}{miss && miss.has(NC(c)) ? <Pill tone="warn">ไม่มีในโปรเจค</Pill> : null}{loop ? <span className="rw-muted small"> (วนซ้ำ)</span> : null}
          </td>
          <td className="rw-desc">{rec?.d || ""}</td>
          {compact ? <><td className="r">{nlen(rec?.l)}</td><td className="rw-muted">× {nlen(q)}</td></> : <>
            <td className="r">{nlen(q)}</td><td />
            <td className="r">{nlen(rec?.l)}</td><td className="r">{nlen(rec?.h)}</td><td>{rec?.f || ""}</td></>}
        </tr>
        {isSub && !loop && open[p2] ? <SubKids lib={lib} code={c} path={p2} depth={depth + 1} open={open} setOpen={setOpen} seen={[...seen, NC(c)]} compact={compact} miss={miss} focus={focus} /> : null}
      </Fragment>
    );
  });
}


// ══ ★ 2026-11-04 เปลี่ยนวัสดุ (วัสดุตามแบบไม่มี / หมด → ใช้ตัวอื่น) ══
//   แสดงค่าปัจจุบัน · ถ้าเปลี่ยนแล้ว = ค่าเดิมขีดฆ่า + ป้าย "เปลี่ยน" · กด ✎ = แก้ในแถว · ↺ = กลับไปใช้ตามแบบ
//   props: cur · orig (ค่าตามแบบ ถ้าเปลี่ยนแล้ว) · note · list (รหัสให้เลือก) · withDesc/desc (ใบเบิก: รายละเอียดใหม่) · withLen/len (ยาวเส้น)
//          onSave({ to, d, ml, r }) · onReset() · placeholder
export function MatEdit({ cur, orig, note, list = [], withDesc = false, desc = "", withLen = false, len = "", onSave, onReset, placeholder = "INV ใหม่", label = "" }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ to: "", d: "", ml: "", r: "" });
  const lid = "mat-dl-" + String(label || cur || "x").replace(/[^A-Za-z0-9_-]/g, "");
  const start = () => { setF({ to: "", d: orig ? desc : "", ml: orig && len ? String(len) : "", r: note || "" }); setOpen(true); };
  // ★ 2026-11-12 ผู้ใช้: "กดผิดมาแก้ แล้วไปกดช่องอื่น ให้ออกจากตรงนี้" → คลิกนอกกล่อง = ปิด (ไม่บันทึก) · Esc ก็ปิด
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", out, true); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out, true); document.removeEventListener("keydown", esc); };
  }, [open]);
  // ★ 2026-11-17 ผู้ใช้: "ออกแบบวิธีแก้ material ให้ใช้ง่ายกว่านี้" — เดิม: ช่องพิมพ์ 3-4 ช่องเบียดในแถว + ปุ่ม ✎ ↺ เล็กๆ
  //   ใหม่: กด ✎ = กล่องลอยใต้ช่อง · ค้นหา / กดเลือกจากรายการวัสดุของใบนี้ · เหตุผลกดเลือกได้ · "กลับไปใช้ตามแบบ" อยู่ในกล่อง (มีชื่อบอก ไม่ใช่ไอคอน)
  const anchor = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const a = anchor.current; if (!a) return;
      const r = (a.closest("td") || a).getBoundingClientRect(); const w = Math.min(340, window.innerWidth - 16); const h = (box.current && box.current.offsetHeight) || 380;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)); const below = r.bottom + 4 + h <= window.innerHeight - 8;
      setPos({ left, top: below ? r.bottom + 4 : Math.max(8, r.top - h - 4), width: w });
    };
    place(); const t = setTimeout(place, 0);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { clearTimeout(t); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  const codeOf = (x) => String(typeof x === "string" ? x : (x && (x.inv || x.code)) || "").trim().toUpperCase();
  const descOf = (x) => (typeof x === "string" ? "" : (x && (x.d || x.desc)) || "");
  const now = String(cur || "").trim().toUpperCase();
  const ql = f.to.trim().toUpperCase();
  const all = list.map((x) => ({ c: codeOf(x), d: descOf(x) })).filter((x) => x.c && x.c !== now);
  const exact = all.some((x) => x.c === ql);
  const shown = (ql && !exact ? all.filter((x) => x.c.includes(ql) || String(x.d).toUpperCase().includes(ql)) : all).slice(0, 60);
  const go = () => { if (!f.to.trim() || f.to.trim() === now) return; onSave({ ...f, to: f.to.trim() }); setOpen(false); };
  const REASONS = ["ของหมด", "ไม่มีในสต็อก", "ใช้วัสดุที่มีอยู่", "ตามแบบแก้ไข"];
  const pop = open ? createPortal(
    <div className="rt-matpop" ref={box} role="dialog" aria-label={`เปลี่ยนวัสดุ ${label}`} style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: -9999, top: 0 }}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="rt-matpop-h"><b>เปลี่ยนวัสดุ</b>{label && label !== "noinv" ? <span className="rw-mono rw-muted"> {label}</span> : null}<button type="button" className="rl-x" onClick={() => setOpen(false)} aria-label="ปิด">×</button></div>
      <div className="rt-matpop-cur">ตอนนี้ใช้ <b className="rw-mono">{cur || "—"}</b>{orig ? <> · ตามแบบ <span className="rw-mono">{orig}</span></> : null}{orig && note ? <div className="rw-muted small">{note}</div> : null}</div>
      <input className="input rw-mono" autoFocus value={f.to} placeholder={`ค้นหา หรือพิมพ์ ${placeholder}`} onChange={(e) => setF({ ...f, to: e.target.value.toUpperCase() })}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter") { if (!exact && shown.length === 1 && ql) setF({ ...f, to: shown[0].c }); else go(); } }} aria-label={`วัสดุใหม่ ${label}`} />
      <div className="rt-matpop-list" role="listbox" aria-label="วัสดุในใบนี้">
        {shown.length ? shown.map((x) => (
          <button key={x.c} type="button" role="option" aria-selected={x.c === ql} className={`rt-matpop-i ${x.c === ql ? "on" : ""}`} onClick={() => setF({ ...f, to: x.c })}>
            <span className="rw-mono">{x.c}</span>{x.d ? <small className="rw-muted">{x.d}</small> : null}{orig && x.c === String(orig).trim().toUpperCase() ? <small className="rw-muted">ตามแบบ</small> : null}
          </button>)) : <div className="rw-muted small" style={{ padding: "8px 10px" }}>{ql ? `ไม่มี ${ql} ในใบนี้ — ใช้รหัสที่พิมพ์ได้ (ระบบจะถามยืนยัน)` : "ยังไม่มีรายการวัสดุให้เลือก — พิมพ์รหัสเอง"}</div>}
      </div>
      {withDesc || withLen ? <div className="rt-matpop-row">
        {withDesc ? <input className="input" value={f.d} placeholder="รายละเอียด (ไม่ใส่ = เดิม)" onChange={(e) => setF({ ...f, d: e.target.value })} aria-label={`รายละเอียดวัสดุใหม่ ${label}`} /> : null}
        {withLen ? <input className="input rw-num" type="number" min="0" value={f.ml} placeholder="ยาวเส้น (มม.) — ไม่ใส่ก็ได้" title="ไม่ใส่ = ใช้ความยาวของ INV นี้ในแบบ หรืออ่านจากรหัส" onChange={(e) => setF({ ...f, ml: e.target.value })} aria-label={`ยาวเส้น ${label}`} /> : null}
      </div> : null}
      <input className="input" value={f.r} placeholder="เหตุผล (ไม่ใส่ก็ได้)" onChange={(e) => setF({ ...f, r: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") go(); if (e.key === "Escape") setOpen(false); }} aria-label={`เหตุผล ${label}`} />
      <div className="rt-matpop-chips">{REASONS.map((t) => <button key={t} type="button" className={`rt-matpop-chip ${f.r === t ? "on" : ""}`} onClick={() => setF({ ...f, r: f.r === t ? "" : t })}>{t}</button>)}</div>
      <div className="rt-matpop-f">
        {orig && onReset ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); onReset(); }}>↺ กลับไปใช้ตามแบบ</button> : <span />}
        <span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>ยกเลิก</button> <button type="button" className="btn btn-accent btn-sm" disabled={!f.to.trim() || f.to.trim() === now} onClick={go}>{f.to.trim() && f.to.trim() !== now ? `ใช้ ${f.to.trim()}` : "เลือกวัสดุ"}</button></span>
      </div>
    </div>, document.body) : null;
  const mv = (/^Modify\s+(M-\d+)/.exec(String(note || "")) || [])[1] || "";
  const tip = [`เดิมตามแบบ: ${orig}`, note].filter(Boolean).join(" · ");
  return (
    <span className={`rt-matcur ${open ? "open" : ""}`} ref={anchor}>
      <b className={`rw-mono ${orig ? "rl-new" : ""}`} title={orig ? tip : undefined}>{cur || <span className="rw-muted">—</span>}</b>
      {orig ? (mv ? <> <ModTag ver={mv} /></> : <> <Pill tone="warn" title={tip}>เปลี่ยน</Pill></>) : null}
      {onSave ? <button type="button" className="rw-link rt-matbtn" title="เปลี่ยนวัสดุ (ของไม่มี / หมด → ใช้ตัวอื่น) · กลับไปใช้ตามแบบ" aria-label={`เปลี่ยนวัสดุ ${label}`} onClick={start}>✎</button> : null}
      {pop}
    </span>);
}

// ★ 2026-11-11 ผู้ใช้: "และให้กดไปได้ด้วย" → ป้ายเลขล็อต (P-007.1) กดแล้วเปิดล็อตนั้น — ส่ง event ให้หน้า Release เปิดเอง (แบบเดียวกับ ModTag)
export const LotTag = ({ no }) => <button type="button" className="rw-pill info rl-lottag" title={`ปล่อยแล้ว — กดเปิดล็อต ${no}`}
  onClick={(e) => { e.stopPropagation(); try { window.dispatchEvent(new CustomEvent("rl-open-lot", { detail: String(no) })); } catch { /* ignore */ } }}>{no} ›</button>;
