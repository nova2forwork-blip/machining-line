// ชิ้นส่วนหน้าจอที่ใช้ร่วมกัน (หน้า Release · ตัวสร้างล็อต · Modify · Total)
import { Fragment, useState } from "react";
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
export const Code = ({ code, cancel, added }) => <><b className={cancel ? "rl-cx" : ""} title={cancel ? "ยกเลิกแล้ว" : undefined}>{code}</b>{added ? <> <Pill tone="mod">เพิ่ม {added}</Pill></> : null}</>;

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
      <button type="button" className={`rt-mode-btn ${!setting ? "on" : ""}`} onClick={() => setMode("auto")} title="ระบบแยกหมวดให้เองตามกติกาเบอร์ · เบอร์ที่มี * ไปเป็น SITE ITEM">Auto</button>
      <button type="button" className={`rt-mode-btn ${setting ? "on" : ""}`} onClick={() => setMode("setting")} title="สร้างหมวดเอง + ตัวหน้าของเบอร์ · ไม่เข้าพวก = รอจัดเอง">Setting</button>
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
      {hint ? <span className="rw-muted small rt-mode-hint">{setting ? `ตั้งหมวดเอง: เบอร์ที่ขึ้นต้นด้วย "ตัวหน้า" ของหมวดไหนเข้าหมวดนั้นอัตโนมัติ (ตัวหน้ายาวสุดชนะ · * ชนะทุกตัว) · ไม่เข้าพวก = "${UNCAT}" รอจัดเอง (คอลัมน์ "หมวด" หรือค้นหา → ติ๊ก → ย้ายไปหมวด)` : "แยกตามกติกาเบอร์ · เบอร์ที่มี * = SITE ITEM"}</span> : null}
    </div>
  );
}

// ★ เบอร์ลูกของซับ (จากคลังซับ/พาร์ทของโปรเจค) — ซับซ้อนซับกางต่อได้ทุกชั้น · กันวนซ้ำด้วย seen
export function SubKids({ lib, code, path, depth, open, setOpen, seen, compact = false }) {
  const L = lib || { subs: {}, parts: {} };
  const sk = findKey(L.subs, code);
  const sub = sk ? L.subs[sk] : null;
  const pad = { paddingLeft: 10 + depth * 22 };
  if (!sub) return <tr className="rw-kid"><td /><td colSpan={compact ? 4 : 7} className="rw-muted small" style={pad}>↳ ยังไม่มีแบบซับ {code} ในโปรเจค — ลงที่หน้า “ซับ / พาร์ท ของโปรเจค” แล้วจะเห็นเบอร์ลูก</td></tr>;
  const items = (sub.full || sub.items || []).filter((i) => (i[4] || "") !== "ยกเลิก");   // full = ทุกบรรทัดจาก PDF ซับ (รวมสกรู/ยาง) · ไม่มี = ใช้ BOM ในระบบ
  if (!items.length) return <tr className="rw-kid"><td /><td colSpan={compact ? 4 : 7} className="rw-muted small" style={pad}>↳ ซับนี้ยังไม่มีเบอร์ลูก</td></tr>;
  return items.map((it, n) => {
    const [k, c, q] = it;
    const isSub = k === "sub";
    const rec = isSub ? L.subs[findKey(L.subs, c)] : L.parts[findKey(L.parts, c)];
    const p2 = path + ">" + c + "#" + n;
    const loop = isSub && seen.includes(NC(c));
    return (
      <Fragment key={p2}>
        <tr className="rw-kid">
          <td className="r rw-muted">↳</td>
          <td className="rw-mono" style={pad}>
            {isSub && !loop ? <button type="button" className="rw-tg" onClick={() => setOpen((o) => ({ ...o, [p2]: !o[p2] }))} aria-expanded={!!open[p2]}>{open[p2] ? "▾" : "▸"}</button> : null}
            <b>{c}</b> {isSub ? <Pill tone="sub">ซับ</Pill> : k === "hw" ? <Pill tone="muted">HW</Pill> : null}{loop ? <span className="rw-muted small"> (วนซ้ำ)</span> : null}
          </td>
          <td className="rw-desc">{rec?.d || ""}</td>
          {compact ? <><td className="r">{nlen(rec?.l)}</td><td className="rw-muted">× {nlen(q)}</td></> : <>
            <td className="r">{nlen(q)}</td><td />
            <td className="r">{nlen(rec?.l)}</td><td className="r">{nlen(rec?.h)}</td><td>{rec?.f || ""}</td></>}
        </tr>
        {isSub && !loop && open[p2] ? <SubKids lib={lib} code={c} path={p2} depth={depth + 1} open={open} setOpen={setOpen} seen={[...seen, NC(c)]} compact={compact} /> : null}
      </Fragment>
    );
  });
}

