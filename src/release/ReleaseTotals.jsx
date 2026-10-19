// ══════════════════════════════════════════════════════════════════════════
// หน้า Release › Total — หัว 3 อย่างตามแท็บใน Excel แต่ละอย่างมีหัวข้อย่อย
//   Total Part         → ทั้งหมด · MACHINING PART · BENDING · STEEL                     (พาร์ทผลิต · มี QR · ปล่อยเป็นล็อต)
//   Total Sub-Assembly → ทั้งหมด · SUB A'ssy (พับ) · (เชื่อม) · (Site Item) · (ยิง) (ซับ 1 เบอร์อยู่ได้หลายใบ · แสดงพาร์ทลูกแบบใน Excel)
//   Total Mat.         → วัตถุดิบงานตัด · GLASS · FIXING (· อื่นๆ)                 (ใบเบิก · ไม่มี QR)
//   + ASSEMBLY (แผง) แยกไว้ท้าย (ที่อยู่ / Unit / ปล่อยในล็อตไหน)
// ══════════════════════════════════════════════════════════════════════════
import { Fragment, useMemo, useState } from "react";
import { otherOf, partGroupsOf, UNCAT, PART_CATS, QR_CATS, NC, ncmp, nf, nlen, findKey, isStar, SHEETS, TOTALS, MAT_SHEETS, PART_DESTS, PROCS, procList, cutMaterials, addrKey, KERF, destLabel, CAT_DEST } from "./releaseCore.js";
import { Pill, ModQty, Code, SUB_SHORT, PartGroupBar } from "./releaseUi.jsx";
import { askConfirm } from "../confirm.jsx";
import { BomView } from "./ReleaseBom.jsx";

const PAGE = 300;
const sheetOf = (k) => SHEETS.find((s) => s.k === k) || MAT_SHEETS.find((s) => s.k === k) || { k, tab: k, label: k, th: PART_CATS.includes(k) ? (QR_CATS.has(k) ? "ผลิตเอง · มี QR · ส่งไปใบ MACHINING PART / BENDING / STEEL ได้" : k === "SUB-ASSEMBLY PART" ? "ซับทั้งหมด (รายละเอียดดูที่ Total Sub-Assembly)" : k === "SITE ITEM" ? "รายการเบอร์ * ที่ส่งไปประกอบที่ไซต์" : "ใบเบิก · ไม่มี QR") : "" };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const has = (q, ...xs) => !q || xs.some((x) => String(x || "").toUpperCase().includes(q));
const hwQty = (p) => (p.u === "m." && p.mm ? p.qty / 1000 : p.qty);

export function TotalsSection({ plan, need, rel, doneOf, leftOf, onPlanChange, onRelease }) {
  const [grp, setGrp] = useState("part");
  const [sub, setSub] = useState({ part: "ALL", sub: "ALL", mat: "MAT", panel: "ALL", bom: "" });
  const [q, setQ] = useState("");
  const [kids, setKids] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [openMat, setOpenMat] = useState(null);
  const [partDest, setPartDest] = useState("ALL");
  const [pickP, setPickP] = useState(() => new Set()), [pickS, setPickS] = useState(() => new Set()), [pickA, setPickA] = useState(() => new Set());
  const flip = (set, setter) => (keys, on) => setter((cur) => { const n = new Set(cur); for (const k of keys) { if (on) n.add(k); else n.delete(k); } return n; });
  const tP = flip(pickP, setPickP), tS = flip(pickS, setPickS), tA = flip(pickA, setPickA);
  const nPick = pickP.size + pickS.size + pickA.size;
  const clearPick = () => { setPickP(new Set()); setPickS(new Set()); setPickA(new Set()); };
  // ย้ายพาร์ทไปใบ CUTTING/BENDING/STEEL · ตั้งงานซับ (ติ๊กได้หลายงาน) — เก็บเป็น destOv / procOv ของแผน (ใช้ตอนปล่อยล็อต)
  const setDests = (codes, d) => onPlanChange && onPlanChange({ ...plan, destOv: { ...(plan.destOv || {}), ...Object.fromEntries(codes.map((c) => [c, d])) } });
  const setProcs = (codes, fn) => onPlanChange && onPlanChange({ ...plan, procOv: { ...(plan.procOv || {}), ...Object.fromEntries(codes.map((c) => { const cur = need.subs.find((x) => x.code === c)?.procs || []; return [c, PROCS.filter((k) => fn(cur).includes(k)).join(", ")]; })) } });
  const Chk = ({ keys, set, tog, label }) => {
    const on = keys.length > 0 && keys.every((k) => set.has(k)); const some = !on && keys.some((k) => set.has(k));
    return <input type="checkbox" checked={on} ref={(el) => { if (el) el.indeterminate = some; }} disabled={!keys.length} onChange={(e) => tog(keys, e.target.checked)} aria-label={label} />;
  };
  const cur = sub[grp];
  const pick = (g, s) => { setGrp(g); if (s) setSub((x) => ({ ...x, [g]: s })); setLimit(PAGE); setOpenMat(null); };

  const parts = useMemo(() => [...need.parts].sort((a, b) => ncmp(a.code, b.code)), [need]);
  const subs = useMemo(() => [...need.subs].sort((a, b) => ncmp(a.code, b.code)), [need]);
  const mats = useMemo(() => cutMaterials(need.parts), [need]);
  const glass = need.glass || [], hw = need.hw || [], other = need.other || [];
  const inSheet = (g, k) => (x) => k === "ALL" || (g === "part" ? x.cat === k : (x.procs || []).includes(k));
  const stat = (list) => {
    const live = list.filter((x) => !x.cancelled);
    const done = live.filter((x) => leftOf(x.code, x.qty) <= 0).length;
    const pcs = live.reduce((a, x) => a + x.qty, 0), relPcs = live.reduce((a, x) => a + Math.min(x.qty, doneOf(x.code)), 0);
    return { tot: live.length, done, pcs, relPcs, cx: list.length - live.length };
  };
  const units = plan.units || [];
  const liveUnits = units.filter((u) => !need.cancelledAddr[addrKey(u.addr)]);
  const panelDone = liveUnits.filter((u) => rel.addrLot.has(addrKey(u.addr))).length;
  const head = {
    part: stat(parts), sub: stat(subs),
    mat: { MAT: mats.length, GLASS: glass.length, FIXING: hw.length, OTHER: other.length },
    panel: { tot: liveUnits.length, done: panelDone },
  };
  // ย้ายพาร์ทไปหมวดอื่น (catOv ของแผน) — หมวดผลิตเอง (QR) ใบงานตามหมวด · ที่ปล่อยแล้วย้ายไม่ได้
  const setCats = (codes, cat) => {
    const ok = codes.filter((c) => !doneOf(c)); if (!ok.length || !onPlanChange) return;
    const destOv = { ...(plan.destOv || {}) }; for (const c of ok) delete destOv[c];
    const catOv = { ...(plan.catOv || {}) }; for (const c of ok) { if (cat === UNCAT || !cat) delete catOv[c]; else catOv[c] = cat; }
    onPlanChange({ ...plan, catOv, destOv });
  };
  // พาร์ททุกเบอร์ (ผลิตเอง + ใบเบิก) + หมวดที่โชว์
  const allParts = useMemo(() => {
    const mk = (x, qr) => ({ ...x, qr, cat: x.cat || "", qty: x.u === "m." && x.mm ? x.qty / 1000 : x.qty, uom: qr ? "pcs." : x.u || "pcs." });
    return [...parts.map((x) => mk(x, true)), ...glass.map((x) => mk({ ...x, cat: x.cat || "GLASS" }, false)), ...hw.map((x) => mk({ ...x, cat: x.cat || "FASTENER & GASKET" }, false)), ...other.map((x) => mk(x, false))];
  }, [parts, glass, hw, other]);
  const catCount = useMemo(() => { const m = new Map(); for (const r of allParts) if (!r.cancelled) m.set(r.cat, (m.get(r.cat) || 0) + 1); return m; }, [allParts]);
  // Auto / Setting ของ Total Part
  const setting = plan.partMode === "setting";
  const [partGrp, setPartGrp] = useState("ALL");   // หมวดที่เลือกดูใน Total Part (ALL = ทุกหมวด)
  // ค้นหาเบอร์ข้ามทุกหมวดของ Total Part (ผลิตเอง + กระจก + สกรู/ยาง + อื่นๆ)
  // BOM: แบบแผงที่ใช้ในใบนี้ → แตกเป็นซับ 1 › ซับ 2 › พาร์ท (เหมือนชีต BOM ใน Excel)
  const bomTypes = useMemo(() => {
    const cnt = new Map();
    for (const u of units) { if (need.cancelledAddr[addrKey(u.addr)]) continue; const k = String(u.unit || "").trim(); if (k) cnt.set(k, (cnt.get(k) || 0) + 1); }
    return [...cnt.entries()].map(([unit, n]) => ({ unit, n, has: !!findKey(plan.bom.panels, unit) })).sort((a, b) => ncmp(a.unit, b.unit));
  }, [units, need, plan.bom]);
  const bomSel = sub.bom === "__ALL__" ? "__ALL__" : bomTypes.find((t) => t.unit === sub.bom)?.unit || bomTypes[0]?.unit || "";
  // แถว BOM แบบชีต "BOM P-142": Panel · Sub-01 · Sub-02 · Part No. · … · Material · Waste · Material Length · Quantity · Sum Quantity
  //   แถวซับ 1st = พื้นเทา ตัวหนา · ซับ 2nd = พื้นเขียว · พาร์ทที่ตัดจากเศษ = Material/ความยาวตัวแดง + WASTE
  const bomRowsOf = (unit, nPanel) => {
    const pk = findKey(plan.bom.panels, unit); if (!pk) return [];
    const pn = plan.bom.panels[pk]; const out = [];
    const walk = (items, path, mult, seen) => {
      for (const it of items || []) {
        if ((it[4] || "") === "ยกเลิก") continue;
        const [t, c, qq] = it;
        if (t === "sub") {
          const sk = findKey(plan.bom.subs, c); const sd = sk ? plan.bom.subs[sk] : {};
          out.push({ unit, pd: pn.d || "", n: nPanel, path, code: c, d: sd.d || "", l: sd.l ?? null, h: null, f: sd.f || "", m: path.length ? "SUB 2nd" : "SUB 1st", q: qq, sum: mult * qq * nPanel, sub: path.length + 1 });
          if (sk && !seen.has(sk)) walk(sd.items, [...path, c], mult * qq, new Set([...seen, sk]));
        } else {
          const pd = plan.bom.parts[findKey(plan.bom.parts, c)] || {};
          const wm = (pd.mv || []).find((x) => String(x).startsWith((pd.m || "") + "@")); const wl = wm ? Number(/@(\d+(?:\.\d+)?)/.exec(wm)?.[1]) : null;
          out.push({ unit, pd: pn.d || "", n: nPanel, path, code: c, d: pd.d || "", l: pd.l ?? null, h: pd.h ?? null, f: pd.f || "", m: pd.m || pd.binv || "", waste: !!wm, ml: wm ? wl : pd.ml ?? null, q: qq, sum: mult * qq * nPanel, hw: pd.k === "hw" });
        }
      }
    };
    walk(pn.items, [], 1, new Set());
    return out;
  };
  const bomRows = useMemo(() => (bomSel === "__ALL__" ? bomTypes.flatMap((t) => bomRowsOf(t.unit, t.n)) : bomRowsOf(bomSel, bomTypes.find((t) => t.unit === bomSel)?.n || 1)), [plan.bom, bomSel, bomTypes]);
  const Q = q.trim().toUpperCase();
  const matIssue = plan.matIssue || {};
  const setIssue = (inv, patch) => onPlanChange && onPlanChange({ ...plan, matIssue: { ...matIssue, [inv]: { ...(matIssue[inv] || {}), ...patch } } });
  const lotsOf = (code) => {
    const e = rel.byCode.get(NC(code)); const o = otherOf(rel, code);
    return <>{e ? e.lots.map((l) => <Pill key={l} tone="info">{l}</Pill>) : null}{o ? <Pill tone="ok" title={`ปล่อยไว้แล้วใน ${o.ros.join(", ")} ${nf(o.qty)} — ใช้เป็นเบอร์ลูก ไม่ต้องปล่อยใหม่`}>ใช้ของ {o.ros.join(", ")}</Pill> : null}</>;
  };
  const kidRows = (code, mult) => {
    const sk = findKey(plan.bom.subs, code); if (!sk) return [];
    return (plan.bom.subs[sk].items || []).filter((it) => (it[4] || "") !== "ยกเลิก").map(([t, c, qq]) => {
      const pd = t === "sub" ? plan.bom.subs[findKey(plan.bom.subs, c)] || {} : plan.bom.parts[findKey(plan.bom.parts, c)] || {};
      const uom = t === "sub" ? "SET" : pd.k === "hw" ? pd.u || "pcs." : "pcs.";
      return { t, c, qq, d: pd.d || "", l: pd.l ?? null, uom, tot: mult * qq };
    });
  };

  // ── ตาราง ──
  let table = null, shown = 0, total = 0, foot = null;
  if (grp === "bom") {
    const rows = bomRows.filter((r) => has(Q, r.code, r.d, r.m, r.unit, ...r.path));
    total = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    table = (
      <table className="data-table rw-table rt-table rt-bom">
        <thead><tr><th>PANEL</th><th>PANEL DESCRIPTION</th><th className="r">PANEL QTY</th><th>SUB-01</th><th>SUB-02</th><th>PART NO.</th><th>DESCRIPTION</th><th className="r">LENGTH</th><th className="r">HEIGHT</th><th>FINISH</th><th>MATERIAL</th><th>WAST</th><th className="r">MATERIAL LENGTH</th><th className="r">QUANTITY</th><th className="r">SUM QUANTITY</th></tr></thead>
        <tbody>{vis.map((r, i) => (
          <tr key={r.unit + i} className={r.sub === 1 ? "rt-b1" : r.sub === 2 ? "rt-b2" : r.sub > 2 ? "rt-b2" : ""}>
            <td className="rw-mono">{r.unit}</td><td className="rw-muted small">{r.pd}</td><td className="r rw-num">{nf(r.n)}</td>
            <td className="rw-mono rt-inv">{r.path[0] || (r.sub === 1 ? r.code : "")}</td><td className="rw-mono rt-inv">{r.path[1] || (r.sub === 2 ? r.code : "")}</td>
            <td className="rw-mono" style={{ paddingLeft: 12 + 12 * (r.path.length) }}>{r.sub ? <b>{r.code}</b> : r.code}</td>
            <td className="rl-desc"><span>{r.d}</span></td><td className="r rw-num">{nlen(r.l)}</td><td className="r rw-num">{nlen(r.h)}</td><td className="rt-rem">{r.f}</td>
            <td className={`rw-mono rt-inv ${r.waste ? "rt-waste" : ""}`}>{r.m}</td><td className="rt-waste small">{r.waste ? "WASTE" : ""}</td><td className={`r rw-num ${r.waste ? "rt-waste" : ""}`}>{nlen(r.ml)}</td>
            <td className="r rw-num">{nlen(r.q)}</td><td className="r"><b>{nlen(r.sum)}</b></td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={15}><b>{bomSel === "__ALL__" ? "ทุกแบบแผง" : bomSel}</b> · {nf(rows.length)} บรรทัด · SUM QUANTITY = จำนวนต่อชุด × จำนวนแผงแบบนั้น · ตัวแดง/WASTE = ตัดจากเศษ</td></tr></tfoot>
      </table>);
  } else if (grp === "part") {
    // ── Total Part: พาร์ททุกเบอร์ (ผลิตเอง + กระจก + สกรู/ยาง + อื่นๆ) จัดกลุ่มตามหมวด · Auto = ตามกติกา · Setting = office สร้างหมวดเอง ──
    const groups = partGroupsOf(plan);
    const all = allParts
      .filter((r) => partGrp === "ALL" || r.cat === partGrp)
      .filter((r) => has(Q, r.code, r.d, r.inv, r.cat)).filter((r) => partDest === "ALL" || (r.qr && r.dest === partDest));
    const order = new Map([...groups, ...PART_CATS].map((g, k) => [g, k]));
    all.sort((a, b) => ((order.has(a.cat) ? order.get(a.cat) : 999) - (order.has(b.cat) ? order.get(b.cat) : 999)) || ncmp(a.code, b.code));
    total = all.length; const vis = all.slice(0, Math.max(limit, 1200)); shown = vis.length;   // โชว์ทุกหมวดในหน้าเดียว (หัวหมวดเป็นแถวในตาราง)
    const live = all.filter((r) => !r.cancelled);
    const pickable = (r) => r.qr && !r.cancelled && leftOf(r.code, r.qty) > 0;
    const catOpts = [...new Set([...groups, ...(setting ? [] : PART_CATS)])].filter((k) => k !== "SUB-ASSEMBLY PART" && k !== UNCAT);
    const byCat = new Map(); for (const r of all) byCat.set(r.cat, (byCat.get(r.cat) || 0) + 1);
    let lastCat = null;
    table = (
      <table className="data-table rw-table rt-table rt-allparts">
        <thead><tr><th style={{ width: 34 }}><Chk keys={all.filter(pickable).map((r) => r.code)} set={pickP} tog={tP} label="เลือกทั้งหมดที่แสดง" /></th><th className="r">NO.</th><th>CODE</th><th>DESCRIPTION</th><th className="r">LENGTH</th><th className="r">TOTAL QTY</th><th>MATERIAL</th><th title="เลือกหมวด = ส่งไปใบงานของหมวดนั้นเลย (MACHINING→CUTTING · BENDING · STEEL)">หมวด / ส่งไปใบ</th><th>ปล่อยแล้ว / ทำแล้วที่</th><th className="r">เหลือ</th><th>REMARK</th></tr></thead>
        <tbody>{vis.flatMap((r, i) => {
          const rows = [];
          if (r.cat !== lastCat) { lastCat = r.cat; rows.push(<tr key={"g" + r.cat} className="rt-grp"><td colSpan={11}><b>{r.cat || "ไม่มีหมวด"}</b> <span className="rw-muted small">{nf(byCat.get(r.cat))} เบอร์</span>{r.cat === UNCAT ? <Pill tone="warn">รอจัดหมวด</Pill> : !PART_CATS.includes(r.cat) ? <Pill tone="mod">หมวดที่ตั้งเอง</Pill> : null}</td></tr>); }
          const left = r.qr ? leftOf(r.code, r.qty) : 0; const done = doneOf(r.code); const o = otherOf(rel, r.code);
          rows.push(
            <tr key={r.code + i} className={r.cancelled ? "rl-cancelrow" : pickP.has(r.code) ? "rl-sel" : r.qr && left <= 0 ? "rt-full" : ""}>
              <td>{r.qr ? <input type="checkbox" checked={pickP.has(r.code)} disabled={!pickable(r)} onChange={(e) => tP([r.code], e.target.checked)} aria-label={`เลือก ${r.code}`} /> : null}</td>
              <td className="r rw-num">{i + 1}</td>
              <td className="rw-mono"><Code code={r.code} cancel={!!r.cancelled} added={r.added} />{isStar(r.code) ? <> <Pill tone="warn">*</Pill></> : null}</td>
              <td className="rl-desc"><span>{r.d}</span></td>
              <td className="r rw-num">{nlen(r.l)}</td>
              <td className="r">{r.qr ? <ModQty orig={r.orig} cur={r.qty} ver={r.modVer} cancel={!!r.cancelled} /> : <><b>{nlen(Math.round(r.qty * 100) / 100)}</b> <small className="rw-muted">{r.uom}</small></>}</td>
              <td className="rw-mono rt-inv">{r.inv || <span className="rw-muted">—</span>}</td>
              <td>{onPlanChange && !r.cancelled && !done ? <select className="select rw-cellsel rt-dest" value={r.cat} onChange={(e) => setCats([r.code], e.target.value)} aria-label={`หมวด ${r.code}`}>{[...new Set([r.cat, ...catOpts])].map((k) => <option key={k} value={k}>{k}</option>)}</select> : <Pill tone="muted" title={done ? "ปล่อยไปแล้ว — ย้ายหมวดไม่ได้" : ""}>{r.cat}</Pill>}
                {!r.qr ? <div className="rw-muted small">ใบเบิก · ไม่มี QR</div>
                  : CAT_DEST[r.cat] === r.dest ? null   // หมวดผลิตเอง 3 หมวด = ใบเดียวกัน ไม่ต้องเลือกซ้ำ
                  : (onPlanChange && !r.cancelled && !done ? <div className="rt-destrow"><span className="rw-muted small">→ ส่งไปใบ</span><select className="select rw-cellsel rt-dest" value={r.dest} onChange={(e) => setDests([r.code], e.target.value)} aria-label={`ส่ง ${r.code} ไป`}>{PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}</select></div> : <div className="rt-destrow"><span className="rw-muted small">→ ส่งไปใบ</span> <Pill tone="part">{destLabel(r.dest)}</Pill></div>)}</td>
              <td className="rl-donecell">{done ? <b>{nf(done)}</b> : null} {lotsOf(r.code)}{o ? <div className="small rw-ok">ทำแล้วที่ {o.ros.join(", ")} ({nf(o.qty)})</div> : null}</td>
              <td className="r"><b>{!r.qr || r.cancelled ? "" : left > 0 ? nf(left) : "✓"}</b></td>
              <td className="rt-rem">{[r.f, r.rev ? `Rev ${r.rev}` : ""].filter(Boolean).join(" · ")}</td>
            </tr>);
          return rows;
        })}</tbody>
        <tfoot><tr><td /><td /><td colSpan={3}><b>รวม {nf(live.length)} เบอร์</b> · ผลิตเอง (QR) {nf(live.filter((r) => r.qr).length)} · ใบเบิก {nf(live.filter((r) => !r.qr).length)}{all.length - live.length ? <span className="rl-cxq small"> · ยกเลิก {all.length - live.length}</span> : null}</td><td className="r"><b>{nf(live.filter((r) => r.qr).reduce((a, p) => a + p.qty, 0))}</b></td><td colSpan={2} /><td /><td className="r"><b>{nf(live.filter((r) => r.qr).reduce((a, p) => a + leftOf(p.code, p.qty), 0))}</b></td><td /></tr></tfoot>
      </table>);
  } else if (grp === "sub") {
    const rows = subs.filter(inSheet("sub", cur)).filter((s) => has(Q, s.code, s.d) || (kids && kidRows(s.code, 1).some((k) => has(Q, k.c, k.d))));
    total = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    const all = cur === "ALL";
    const live = rows.filter((s) => !s.cancelled);
    table = (
      <table className="data-table rw-table rt-table">
        <thead><tr><th style={{ width: 34 }}><Chk keys={vis.filter((x) => !x.cancelled && leftOf(x.code, x.qty) > 0).map((x) => x.code)} set={pickS} tog={tS} label="เลือกทั้งหน้า" /></th><th className="r">ITEM</th><th>CODE</th><th>DESCRIPTION</th><th className="r">LENGTH (mm.)</th><th className="r">SUB QTY.</th>{kids ? <><th className="r">QTY OF PART/SUB</th><th className="r">PART QTY.</th></> : null}<th>UOM</th><th>งาน (ติ๊กได้หลายงาน)</th><th>ปล่อยแล้ว</th><th className="r">เหลือ</th></tr></thead>
        <tbody>{vis.map((s, i) => { const left = leftOf(s.code, s.qty); const done = doneOf(s.code); const ks = kids ? kidRows(s.code, s.qty) : []; return (
          <Fragment key={s.code}>
            <tr className={`rt-subrow ${s.cancelled ? "rl-cancelrow" : pickS.has(s.code) ? "rl-sel" : left <= 0 ? "rt-full" : ""}`}>
              <td><input type="checkbox" checked={pickS.has(s.code)} disabled={s.cancelled || left <= 0} onChange={(e) => tS([s.code], e.target.checked)} aria-label={`เลือก ${s.code}`} /></td>
              <td className="r rw-num">{i + 1}</td>
              <td className="rw-mono"><Code code={s.code} cancel={!!s.cancelled} added={s.added} /></td>
              <td className="rl-desc"><span>{s.d}</span></td>
              <td className="r rw-num">{nlen(s.l)}</td>
              <td className="r"><ModQty orig={s.orig} cur={s.qty} ver={s.modVer} cancel={!!s.cancelled} /></td>
              {kids ? <><td /><td /></> : null}
              <td className="rw-muted small">SET</td>
              <td>{onPlanChange && !s.cancelled ? <span className="rw-procs">{PROCS.map((k) => { const on = s.procs.includes(k); return <label key={k} className={`rw-proc ${on ? "on" : ""}`}><input type="checkbox" checked={on} onChange={(e) => setProcs([s.code], (c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))} />{SUB_SHORT[k]}</label>; })}</span> : s.procs.map((k) => <Pill key={k} tone="sub">{SUB_SHORT[k] || k}</Pill>)}{!s.procs.length ? <Pill tone="warn">ยังไม่เลือกงาน</Pill> : null}</td>
              <td className="rl-donecell">{done ? <b>{nf(done)}</b> : null} {lotsOf(s.code)}</td>
              <td className="r"><b>{s.cancelled ? "" : left > 0 ? nf(left) : "✓"}</b></td>
            </tr>
            {ks.map((k) => (
              <tr key={s.code + ">" + k.c} className={`rt-kid ${s.cancelled ? "rl-cancelrow" : ""}`}>
                <td /><td /><td className="rw-mono"><span className="rt-kid-ic">└</span>{k.c}{k.t === "sub" ? <> <Pill tone="sub">ซับ</Pill></> : null}</td>
                <td className="rl-desc"><span>{k.d}</span></td><td className="r rw-num">{nlen(k.l)}</td><td className="r rw-num">{nf(s.qty)}</td>
                <td className="r rw-num">{nlen(k.qq)}</td><td className="r"><b>{nlen(k.tot)}</b></td><td className="rw-muted small">{k.uom}</td><td /><td /><td />
              </tr>))}
          </Fragment>); })}</tbody>
        <tfoot><tr><td /><td /><td colSpan={3}><b>รวม {nf(live.length)} เบอร์</b>{rows.length - live.length ? <span className="rl-cxq small"> · ยกเลิก {rows.length - live.length}</span> : null}</td><td className="r"><b>{nf(live.reduce((a, s) => a + s.qty, 0))}</b> <small className="rw-muted">SET</small></td>{kids ? <><td /><td /></> : null}<td /><td /><td><b>{nf(live.reduce((a, s) => a + Math.min(s.qty, doneOf(s.code)), 0))}</b></td><td className="r"><b>{nf(live.reduce((a, s) => a + leftOf(s.code, s.qty), 0))}</b></td></tr></tfoot>
      </table>);
  } else if (grp === "mat" && cur === "MAT") {
    const rows = mats.filter((m) => has(Q, m.inv, m.d, ...m.parts.map((p) => p.code)));
    total = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    const issueOf = (m) => { const v = matIssue[m.inv || "—"]?.n; return v === "" || v == null ? m.bars : Number(v); };
    table = (
      <table className="data-table rw-table rt-table">
        <thead><tr><th className="r">NO.</th><th>MATERIAL CODE</th><th>MATERIAL DESCRIPTION</th><th className="r">LENGTH (mm.)</th><th>ใช้กับ</th><th className="r">ยาวรวม (ม.)</th>
          <th className="r" title={`ความยาวพาร์ท + รอยตัด ${KERF} มม. ÷ ความยาวเส้น`}>REQUIRED QTY</th>
          <th className="r" title={`ค่าเริ่ม = จัดชิ้นลงเส้นจริง (ยาวก่อน · รอยตัด ${KERF} มม.) · แก้เป็นยอดเบิกจริงได้`}>ACTUAL ISSUE</th><th>REMARK</th></tr></thead>
        <tbody>{vis.map((m, i) => { const key = m.inv || "—"; const mi = matIssue[key] || {}; const open = openMat === key; return (
          <Fragment key={key}>
            <tr className={open ? "rl-sel" : ""}>
              <td className="r rw-num">{i + 1}</td>
              <td className="rw-mono"><b>{m.inv || <span className="rl-cxq">ไม่มี INV</span>}</b></td>
              <td className="rl-desc"><span>{m.d}</span></td>
              <td className="r rw-num">{nf(m.stock)}{m.src === "code" ? <div><Pill tone="muted" title="ไม่มีใน BOM — อ่านความยาวจากรหัส INV">จากรหัส</Pill></div> : m.src === "default" ? <div><Pill tone="warn" title="ไม่รู้ความยาวเส้น — คิดที่ 6,000">ไม่ทราบ</Pill></div> : null}</td>
              <td><button type="button" className="rt-uses" onClick={() => setOpenMat(open ? null : key)} aria-expanded={open}>{nf(m.parts.length)} เบอร์ · {nf(m.pcs)} ชิ้น {open ? "▴" : "▾"}</button>
                {m.over ? <div><Pill tone="bad">ยาวกว่าเส้น {nf(m.over)} ชิ้น</Pill></div> : null}{m.noLen ? <div><Pill tone="warn">ไม่มีความยาว {nf(m.noLen)} ชิ้น</Pill></div> : null}</td>
              <td className="r rw-num">{nf(m.len / 1000, 1)}</td>
              <td className="r rw-num">{nf(m.req, 2)}</td>
              <td className="r">{onPlanChange ? <input className="input rw-cell rt-issue" type="number" min="0" step="1" value={mi.n ?? ""} placeholder={String(m.bars)} onChange={(e) => setIssue(key, { n: e.target.value })} aria-label={`เบิกจริง ${key}`} /> : <b>{nf(issueOf(m))}</b>}
                {mi.n !== undefined && mi.n !== "" && Number(mi.n) !== m.bars ? <div className="rw-muted small">คำนวณ {nf(m.bars)}</div> : null}</td>
              <td>{onPlanChange ? <input className="input rw-cell rt-remark" value={mi.r || ""} placeholder="หมายเหตุ" onChange={(e) => setIssue(key, { r: e.target.value })} aria-label={`หมายเหตุ ${key}`} /> : mi.r || ""}</td>
            </tr>
            {open ? <tr className="rt-uses-row"><td /><td colSpan={8}>
              <div className="rt-uses-list">{m.parts.map((p) => <span key={p.code} className="rt-use"><b className="rw-mono">{p.code}</b> × {nf(p.qty)} <small>ยาว {nlen(p.l) || "?"}</small></span>)}</div>
              <div className="rw-muted small">จัดลงเส้น {nf(m.stock)} มม. ได้ {nf(m.bars)} เส้น · เศษรวม {nf(m.waste / 1000, 1)} ม. · เศษ ≥ 500 มม. {nf(m.off)} ชิ้น (เก็บใช้ต่อได้)</div>
            </td></tr> : null}
          </Fragment>); })}</tbody>
        <tfoot><tr><td /><td colSpan={4}><b>รวม {nf(rows.length)} รายการ</b> <span className="rw-muted small">· พาร์ท CUTTING {nf(rows.reduce((a, m) => a + m.parts.length, 0))} เบอร์</span></td><td className="r"><b>{nf(rows.reduce((a, m) => a + m.len, 0) / 1000, 1)}</b></td><td className="r"><b>{nf(rows.reduce((a, m) => a + m.req, 0), 2)}</b></td><td className="r"><b>{nf(rows.reduce((a, m) => a + issueOf(m), 0))}</b> <small className="rw-muted">เส้น</small></td><td /></tr></tfoot>
      </table>);
  } else if (grp === "mat" && cur === "GLASS") {
    const rows = glass.filter((g) => has(Q, g.code, g.d)); total = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    table = (
      <table className="data-table rw-table rt-table">
        <thead><tr><th className="r">NO.</th><th>MATERIAL CODE</th><th>MATERIAL DESCRIPTION</th><th className="r">LENGTH (mm.)</th><th className="r">HEIGHT (mm.)</th><th className="r">REQUIRED QTY</th></tr></thead>
        <tbody>{vis.map((g, i) => <tr key={g.code}><td className="r rw-num">{i + 1}</td><td className="rw-mono"><b>{g.code}</b></td><td className="rl-desc"><span>{g.d}</span></td><td className="r rw-num">{nlen(g.l)}</td><td className="r rw-num">{nlen(g.h)}</td><td className="r"><b>{nf(g.qty)}</b></td></tr>)}</tbody>
        <tfoot><tr><td /><td colSpan={4}><b>รวม {nf(rows.length)} เบอร์</b></td><td className="r"><b>{nf(rows.reduce((a, g) => a + g.qty, 0))}</b> <small className="rw-muted">แผ่น</small></td></tr></tfoot>
      </table>);
  } else if (grp === "mat" && cur === "FIXING") {
    const rows = hw.filter((h) => has(Q, h.code, h.d)); total = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    table = (
      <table className="data-table rw-table rt-table">
        <thead><tr><th className="r">NO.</th><th>MATERIAL CODE</th><th>MATERIAL DESCRIPTION</th><th className="r">REQUIRED QTY</th><th>UNIT</th></tr></thead>
        <tbody>{vis.map((h, i) => <tr key={h.code}><td className="r rw-num">{i + 1}</td><td className="rw-mono"><b>{h.code}</b>{isStar(h.code) ? <> <Pill tone="warn">*</Pill></> : null}</td><td className="rl-desc"><span>{h.d}</span></td><td className="r"><b>{h.u === "m." ? nlen(Math.round(hwQty(h) * 100) / 100) : nf(hwQty(h))}</b></td><td className="rw-muted small">{h.u || "pcs."}</td></tr>)}</tbody>
        <tfoot><tr><td /><td colSpan={4}><b>รวม {nf(rows.length)} รายการ</b></td></tr></tfoot>
      </table>);
  } else if (grp === "mat") {
    const rows = other.filter((o) => has(Q, o.code, o.d, o.cat)); total = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    table = (
      <table className="data-table rw-table rt-table">
        <thead><tr><th className="r">NO.</th><th>CODE</th><th>DESCRIPTION</th><th>CATEGORY</th><th className="r">QTY</th></tr></thead>
        <tbody>{vis.map((o, i) => <tr key={o.code}><td className="r rw-num">{i + 1}</td><td className="rw-mono"><b>{o.code}</b></td><td className="rl-desc"><span>{o.d}</span></td><td><Pill tone="muted">{o.cat}</Pill></td><td className="r"><b>{nf(o.qty)}</b></td></tr>)}</tbody>
      </table>);
  } else {
    const rows = units.filter((u) => has(Q, u.addr, u.unit)); total = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    table = (
      <table className="data-table rw-table rt-table">
        <thead><tr><th style={{ width: 34 }}><Chk keys={vis.map((u) => addrKey(u.addr)).filter((a) => !rel.addrLot.has(a) && !need.cancelledAddr[a])} set={pickA} tog={tA} label="เลือกทั้งหน้า" /></th><th className="r">NO.</th><th>ADDRESS</th><th>UNIT</th><th>BOM</th><th>สถานะ</th></tr></thead>
        <tbody>{vis.map((u, i) => { const a = addrKey(u.addr); const lot = rel.addrLot.get(a); const cx = need.cancelledAddr[a]; return (
          <tr key={a + i} className={cx ? "rl-cancelrow" : pickA.has(a) ? "rl-sel" : lot ? "rt-full" : ""}>
            <td><input type="checkbox" checked={pickA.has(a)} disabled={!!lot || !!cx} onChange={(e) => tA([a], e.target.checked)} aria-label={`เลือก ${a}`} /></td>
            <td className="r rw-num">{i + 1}</td>
            <td className="rw-mono"><b className={cx ? "rl-cx" : ""}>{a}</b>{cx ? <> <Pill tone="bad">ยกเลิก {cx}</Pill></> : null}</td>
            <td className="rw-mono">{u.unit}</td>
            <td>{findKey(plan.bom.panels, u.unit) ? <Pill tone="ok">✓</Pill> : <Pill tone="warn">ไม่มี BOM</Pill>}</td>
            <td>{lot ? <Pill tone="info">ปล่อยแล้ว {lot}</Pill> : cx ? <span className="rl-cxq small">ยกเลิกแล้ว</span> : <span className="rw-muted small">ยังไม่ปล่อย</span>}</td>
          </tr>); })}</tbody>
      </table>);
  }

  const T = TOTALS.find((t) => t.k === grp) || { label: grp === "bom" ? "BOM" : "ASSEMBLY (แผง)", sheets: [] };
  const curSheet = grp === "panel" ? sheetOf("panel") : cur === "ALL" ? null : sheetOf(cur);
  const headBtn = (g) => {
    const on = grp === g.k;
    return (
      <button key={g.k} type="button" role="tab" aria-selected={on} className={`rt-head ${g.k} ${on ? "on" : ""}`} onClick={() => pick(g.k)}>
        <span className="rt-head-t">{g.label}</span>
        <small className="rt-head-th">{g.th}</small>
        {g.k === "mat" ? (
          <span className="rt-head-mat"><b>{nf(head.mat.MAT)}</b><small> รายการวัตถุดิบ · {nf(mats.reduce((x, m) => x + m.bars, 0))} เส้น (ประมาณ)</small></span>
        ) : (
          <>
            <span className="rt-head-n"><b>{nf(head[g.k].done)}</b><small> / {nf(head[g.k].tot)} เบอร์ปล่อยครบ</small></span>
            <span className="rl-bar"><i style={{ width: `${pct(head[g.k].done, head[g.k].tot)}%` }} /></span>
          </>
        )}
      </button>);
  };

  return (
    <div className="card rw-card rt">
      <div className="rw-sec-head"><div><h2>Total</h2><p>BOM · Total Part · Total Sub-Assembly · ASSEMBLY (แผง) · Total Mat. — กดหัวเพื่อดูรายการ · ซับ 1 เบอร์อยู่ได้หลายใบ</p></div></div>
      <div className="rt-heads" role="tablist" aria-label="Total">
        <button type="button" role="tab" aria-selected={grp === "bom"} className={`rt-head bom ${grp === "bom" ? "on" : ""}`} onClick={() => pick("bom")}>
          <span className="rt-head-t">BOM</span>
          <small className="rt-head-th">โครงแผง → ซับ → พาร์ท (ตามแบบ PDF)</small>
          <span className="rt-head-n"><b>{nf(bomTypes.length)}</b><small> แบบแผง · {nf(bomRows.length ? bomTypes.reduce((a, b) => a + b.n, 0) : liveUnits.length)} แผง</small></span>
        </button>
        {TOTALS.filter((g) => g.k !== "mat").map(headBtn)}
        <button type="button" role="tab" aria-selected={grp === "panel"} className={`rt-head panel ${grp === "panel" ? "on" : ""}`} onClick={() => pick("panel")}>
          <span className="rt-head-t">ASSEMBLY (แผง)</span>
          <small className="rt-head-th">ประกอบแผง · 1 QR ต่อที่อยู่</small>
          <span className="rt-head-n"><b>{nf(head.panel.done)}</b><small> / {nf(head.panel.tot)} แผง</small></span>
          <span className="rl-bar"><i style={{ width: `${pct(head.panel.done, head.panel.tot)}%` }} /></span>
        </button>
        {TOTALS.filter((g) => g.k === "mat").map(headBtn)}
      </div>

      {grp === "part" && onPlanChange ? (
        <PartGroupBar mode={plan.partMode} groups={plan.partGroups} catOv={plan.catOv} bom={plan.bom} counts={catCount} filter={partGrp}
          onFilter={(g) => { setPartGrp(g); setLimit(PAGE); }}
          onChange={(patch) => onPlanChange({ ...plan, ...patch })} />) : null}

      {grp === "bom" ? <BomView plan={plan} need={need} /> : (
        <>
      <div className="rt-tools">
        <div className="rt-title">
          <b>{curSheet ? curSheet.label : grp === "bom" ? `BOM · ${bomSel === "__ALL__" ? "ทุกแบบแผง" : bomSel}` : T.label}</b>
          <span>{curSheet ? curSheet.th : grp === "bom" ? `แตกซับทุกชั้นเหมือนชีต BOM P-142 ใน Excel — ซับ 1st พื้นเทา · ซับ 2nd พื้นเขียว` : grp === "part" ? "พาร์ททุกเบอร์ · จัดกลุ่มตามหมวด · พิมพ์ค้นหา → ติ๊กเลือก → ย้ายไปหมวด / ปล่อย" : "ซับทุกใบ — ซับที่อยู่หลายใบนับครั้งเดียว"}</span>
        </div>
        <input className="input rw-search" style={{ marginTop: 0 }} placeholder={grp === "bom" ? "ค้นหาเบอร์ / รายละเอียด" : grp === "panel" ? "ค้นหาที่อยู่ / Unit" : grp === "mat" ? "ค้นหารหัสวัตถุดิบ / เบอร์พาร์ท" : "ค้นหาเบอร์ / รายละเอียด"} value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} aria-label="ค้นหาในตาราง" />
        {grp === "part" ? <label className="rt-bulk">ใบงาน <select className="select" value={partDest} onChange={(e) => { setPartDest(e.target.value); setLimit(PAGE); }} aria-label="กรองตามใบงาน"><option value="ALL">ทั้งหมด</option>{PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}</select></label> : null}
        {grp === "bom" ? <select className="select rt-bomsel" value={bomSel} onChange={(e) => { setSub((x) => ({ ...x, bom: e.target.value })); setLimit(PAGE); }} aria-label="เลือกแบบแผง"><option value="__ALL__">ทุกแบบแผง ({nf(bomTypes.length)})</option>{bomTypes.map((t) => <option key={t.unit} value={t.unit}>{t.unit} · {nf(t.n)} แผง{t.has ? "" : " · ไม่มี BOM"}</option>)}</select> : null}
        {grp === "sub" ? <label className="rw-check"><input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} /> แสดงพาร์ทลูก (แบบ Excel)</label> : null}
        <span className="rw-muted small">แสดง {nf(shown)} จาก {nf(total)}</span>
      </div>
      {grp === "mat" && cur === "MAT" ? <div className="rt-note">คำนวณจากความยาวพาร์ท MACHINING PART ตามรหัส INV ในแบบ · รอยตัด {KERF} มม. · ช่อง ACTUAL ISSUE ใส่ยอดเบิกจริงได้ (เช่นใช้เส้นยาวอื่น / ใช้เศษ) — บันทึกไว้กับ Release นี้</div> : null}
      <div className="table-wrap rw-tw rt-tw">
        {total ? table : <div className="rw-muted small rt-empty">{q ? "ไม่พบรายการที่ค้นหา" : "ไม่มีในใบนี้"}</div>}
      </div>
      {nPick ? (
        <div className="rt-pickbar" role="region" aria-label="รายการที่เลือกปล่อย">
          <span><b>เลือก {nf(nPick)} รายการ</b> <small>{[pickP.size && `พาร์ท ${nf(pickP.size)}`, pickS.size && `ซับ ${nf(pickS.size)}`, pickA.size && `แผง ${nf(pickA.size)}`].filter(Boolean).join(" · ")} · ปล่อยยอดที่เหลือทั้งหมดของแต่ละเบอร์ · แผง/ซับดึงลูกมาด้วย</small></span>
          {pickP.size && onPlanChange ? <label className="rt-bulk">ย้ายไปหมวด <select className="select" value="" onChange={(e) => { if (e.target.value) { setCats([...pickP], e.target.value); clearPick(); } }} aria-label="ย้ายพาร์ทที่เลือกไปหมวด"><option value="">เลือกหมวด…</option>{[...new Set([...partGroupsOf(plan), ...(plan.partMode === "setting" ? [] : PART_CATS)])].filter((k) => k !== "SUB-ASSEMBLY PART").map((k) => <option key={k} value={k}>{k}</option>)}</select></label> : null}
          {pickP.size && onPlanChange ? <label className="rt-bulk">พาร์ทที่เลือก → ส่งไปใบ <select className="select" value="" onChange={(e) => { if (e.target.value) setDests([...pickP].filter((c) => !doneOf(c)), e.target.value); }} aria-label="ส่งพาร์ทที่เลือกไปใบ"><option value="">เลือกใบ…</option>{PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}</select></label> : null}
          {pickS.size && onPlanChange ? <label className="rt-bulk">ซับที่เลือก → <select className="select" value="" onChange={(e) => { const [m, k] = e.target.value.split("|"); if (k) setProcs([...pickS], (c) => (m === "add" ? [...c, k] : [k])); }} aria-label="ตั้งงานซับที่เลือก"><option value="">ตั้งงาน…</option>{PROCS.map((k) => <option key={"a" + k} value={`add|${k}`}>เพิ่มงาน {SUB_SHORT[k]}</option>)}{PROCS.map((k) => <option key={"o" + k} value={`set|${k}`}>เหลืองาน {SUB_SHORT[k]} อย่างเดียว</option>)}</select></label> : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearPick}>ล้าง</button>
          <button type="button" className="btn btn-accent" onClick={() => onRelease && onRelease({ parts: [...pickP].filter((c) => need.parts.some((x) => x.code === c)), subs: [...pickS], addrs: [...pickA] }, clearPick)}>ปล่อยที่เลือก →</button>
        </div>) : null}
      {total > shown ? <div className="rt-more"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit((n) => n + PAGE)}>แสดงเพิ่ม ({nf(Math.min(PAGE, total - shown))})</button></div> : null}
        </>
      )}
    </div>
  );
}
