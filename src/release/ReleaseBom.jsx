// ══════════════════════════════════════════════════════════════════════════
// BOM — แผงนี้ใช้อะไรบ้าง · ซับซ้อนกับอะไร · ตัดจากเศษได้ไหม
//   ซ้าย: รายการแบบแผง (เรียง/ค้นหาได้)    ขวา: 3 มุมมอง
//     โครงสร้าง = แผง → ซับ 1 → ซับ 2 → พาร์ท (พับ/ขยายได้)  ·  รวมเบอร์ = เบอร์เดียวกันรวมกัน + ใช้ในซับไหนบ้าง  ·  ตารางเต็ม = แบบชีต BOM ใน Excel (กดหัวคอลัมน์เรียงได้)
//   SUM QTY = จำนวนต่อชุด × (ซับชั้นบน ๆ) × จำนวนแผงแบบนั้น (ตรงกับ Sum Quantity ใน Excel)
//   เศษ: ไล่ตัดตามลำดับแผงในใบนี้ — เบอร์ MATERIAL (INV) ตรงกัน ใช้เศษที่เหลือ ≥ ความยาวที่ต้องตัด (+รอยตัด) ก่อนเปิดเส้นใหม่ · เศษ ≥ 500 มม. เก็บไว้ใช้ต่อ
// ══════════════════════════════════════════════════════════════════════════
import { Fragment, useMemo, useState } from "react";
import { NC, ncmp, nf, nlen, findKey, stockLen, KERF, addrKey, destLabel } from "./releaseCore.js";
import { Pill, ModQty, SUB_SHORT } from "./releaseUi.jsx";

const PAGE = 300;
const MIN_OFFCUT = 500;
const has = (q, ...xs) => !q || xs.some((x) => String(x || "").toUpperCase().includes(q));

// แตก BOM ของแบบแผงเป็นแถว (ลำดับตามไฟล์) พร้อมจำนวนต่อแผง
function rowsOfType(plan, unit) {
  const pk = findKey(plan.bom.panels, unit); if (!pk) return [];
  const out = [];
  const walk = (items, path, mult, seen) => {
    for (const it of items || []) {
      const [t, c, qq] = it;
      const cx = (it[4] || "") === "ยกเลิก"; const ed = { cx, ver: it[5] || "", q0: it[6] != null && it[6] !== qq ? it[6] : null, to: cx ? it[7] || "" : "", add: it[8] === "add" };
      if (cx) {   // ลูกที่ถูก Modify ยกเลิก/แทนที่ — โชว์สีแดง ไม่นับยอด ไม่แตกต่อ
        const k = t === "sub" ? findKey(plan.bom.subs, c) : findKey(plan.bom.parts, c); const dd = (t === "sub" ? plan.bom.subs : plan.bom.parts)[k] || {};
        out.push({ i: out.length, path, depth: path.length, code: c, kind: t === "sub" ? "sub" : dd.k === "hw" ? "hw" : "part", d: dd.d || "", l: dd.l ?? null, h: null, f: dd.f || "", m: t === "sub" ? "" : dd.m || "", q: it[6] != null ? it[6] : qq, per: 0, uom: "pcs.", ...ed });
        continue;
      }
      if (t === "sub") {
        const sk = findKey(plan.bom.subs, c); const sd = sk ? plan.bom.subs[sk] : {};
        out.push({ i: out.length, path, depth: path.length, code: c, kind: "sub", d: sd.d || "", l: sd.l ?? null, h: null, f: sd.f || "", m: "", q: qq, per: mult * qq, ...ed });
        if (sk && !seen.has(sk)) walk(sd.items, [...path, c], mult * qq, new Set([...seen, sk]));
      } else {
        const pd = plan.bom.parts[findKey(plan.bom.parts, c)] || {};
        const hw = pd.k === "hw";
        out.push({ i: out.length, path, depth: path.length, code: c, kind: hw ? "hw" : "part", d: pd.d || "", l: pd.l ?? null, h: pd.h ?? null, f: pd.f || "", m: hw ? "" : pd.m || "", ml: pd.ml ?? null, inv: pd.binv || "", q: qq, per: mult * qq, uom: hw ? pd.u || "pcs." : "pcs.", ...ed });
      }
    }
  };
  walk(plan.bom.panels[pk].items, [], 1, new Set());
  return out;
}

// ความยาวเศษที่ใช้ แบบ Excel: ความยาวเดียว → "2,300" · หลายความยาว → "2300(1), 2100(1)"
const wasteLens = (c) => { const e = [...c.lens.entries()].sort((a, b) => b[0] - a[0]); return e.length === 1 ? nf(e[0][0]) : e.map(([l, n]) => `${l}(${n})`).join(", "); };
export function BomView({ plan, need }) {
  const [sel, setSel] = useState("");          // "" = แบบแรก · "__ALL__" = ทุกแบบ
  const [view, setView] = useState("tree");
  const [q, setQ] = useState("");
  const [lq, setLq] = useState("");
  const [lsort, setLsort] = useState({ k: "unit", d: 1 });
  const [sort, setSort] = useState({ k: "", d: 1 });
  const [closed, setClosed] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);

  const model = useMemo(() => {
    const units = (plan.units || []).filter((u) => !need.cancelledAddr[addrKey(u.addr)] && String(u.unit || "").trim());
    const cnt = new Map(); for (const u of units) { const k = String(u.unit).trim(); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const types = new Map();
    for (const [unit, n] of cnt) {
      const rows = rowsOfType(plan, unit); const pk = findKey(plan.bom.panels, unit);
      types.set(unit, { unit, n, has: !!pk, desc: pk ? plan.bom.panels[pk].d || "" : "", rows, off: 0, fresh: 0 });
    }
    // ไล่ตัดตามลำดับแผง: ใช้เศษที่ MATERIAL ตรงกันก่อน
    const pool = new Map();   // material → [{ rem, from }]
    for (const u of units) {
      const T = types.get(String(u.unit).trim());
      for (const r of T.rows) {
        if (r.kind !== "part" || !r.m || !(r.l > 0)) continue;
        const stock = stockLen(r.m, r.ml).len; const need1 = r.l + KERF;
        const n = Math.round(r.per); if (!(n > 0)) continue;
        r.cut = r.cut || { reuse: 0, fresh: 0, src: "", lens: new Map(), stock, over: stock + 1e-6 < r.l };
        const bars = pool.get(r.m) || pool.set(r.m, []).get(r.m);
        for (let k = 0; k < n; k++) {
          let bi = -1;
          for (let b = 0; b < bars.length; b++) if (bars[b].rem + 1e-6 >= need1 && (bi < 0 || bars[b].rem < bars[bi].rem)) bi = b;
          if (bi >= 0) { const was = Math.round(bars[bi].rem); r.cut.lens.set(was, (r.cut.lens.get(was) || 0) + 1); bars[bi].rem -= need1; r.cut.reuse++; if (!r.cut.src) r.cut.src = `${bars[bi].from} (เหลือก่อนตัด ${nf(bars[bi].rem + need1)} มม.)`; T.off++; if (bars[bi].rem < MIN_OFFCUT) bars.splice(bi, 1); }
          else { r.cut.fresh++; T.fresh++; const rem = stock - need1; if (rem >= MIN_OFFCUT) bars.push({ rem, from: `${T.unit} · ${r.code}` }); }
        }
      }
    }
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

  const flat = useMemo(() => scope.flatMap((T) => T.rows.map((r) => ({ ...r, unit: T.unit, n: T.n, sum: r.per * T.n }))), [scope.map((t) => t.unit).join("|"), model]);
  const sorter = (rows, keys) => {
    if (!sort.k) return rows;
    const f = keys[sort.k]; if (!f) return rows;
    return [...rows].sort((a, b) => { const x = f(a), y = f(b); const c = typeof x === "number" && typeof y === "number" ? x - y : ncmp(String(x ?? ""), String(y ?? "")); return c * sort.d || 0; });
  };
  const Th = ({ k, children, r }) => <th className={r ? "r" : ""} aria-sort={sort.k === k ? (sort.d > 0 ? "ascending" : "descending") : "none"}><button type="button" className={`bm-th ${sort.k === k ? "on" : ""}`} onClick={() => setSort((s) => (s.k === k ? { k, d: -s.d } : { k, d: 1 }))}>{children}<i>{sort.k === k ? (sort.d > 0 ? "▲" : "▼") : "↕"}</i></button></th>;
  const Lsort = ({ k, children }) => <button type="button" className={`bm-ls ${lsort.k === k ? "on" : ""}`} onClick={() => setLsort((s) => (s.k === k ? { k, d: -s.d } : { k, d: 1 }))}>{children}{lsort.k === k ? (lsort.d > 0 ? " ▲" : " ▼") : ""}</button>;
  const cutChip = (r) => (r.cut && (r.cut.reuse || r.cut.over) ? (
    <>{r.cut.reuse ? <Pill tone="bad" title={`ตัดจากเศษ ${r.cut.reuse} ชิ้น — ตัวอย่างต้นทาง: ${r.cut.src}`}>เศษ ×{nf(r.cut.reuse)}</Pill> : null}{r.cut.fresh ? <Pill tone="muted" title={`เปิดเส้นใหม่ ${nf(r.cut.stock)} มม.`}>เส้นใหม่ ×{nf(r.cut.fresh)}</Pill> : null}{r.cut.over ? <Pill tone="warn">ยาวกว่าเส้น</Pill> : null}</>
  ) : r.cut ? <Pill tone="muted" title={`เปิดเส้นใหม่ ${nf(r.cut.stock)} มม.`}>เส้นใหม่ ×{nf(r.cut.fresh)}</Pill> : null);

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
              <div className="bm-main"><button type="button" className="bm-tg" onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })} aria-expanded={!shut} aria-label={`${shut ? "ขยาย" : "พับ"} ${r.code}`}>{shut ? "▸" : "▾"}</button><b className={`rw-mono ${r.cx ? "rl-cx" : ""}`}>{r.code}</b><Pill tone="sub">{r.depth ? "ซับ 2" : "ซับ 1"}</Pill>{r.cx ? <Pill tone="bad">{r.to ? `แทนด้วย ${r.to}` : "ยกเลิก"} {r.ver}</Pill> : r.add ? <Pill tone="mod">เพิ่ม {r.ver}</Pill> : null}{destOf(r).map((k) => <Pill key={k} tone="sub">{SUB_SHORT[k] || k}</Pill>)}<span className="bm-d">{r.d}</span></div>
              <span className="bm-n r">{nlen(r.l)}</span><span className="bm-mat" />
              <span className="bm-q r"><small>ต่อชุด</small> {r.cx ? <span className="rl-cxq">{nlen(r.q)}</span> : r.q0 != null ? <ModQty orig={r.q0} cur={r.q} ver={r.ver} /> : nlen(r.q)}</span><span className="bm-s r"><small>รวม</small> <b>{r.cx ? "0" : nlen(r.per * cur.n)}</b> <small>SET</small></span>
            </div>);
          return (
            <div key={r.i} className={`bm-row bm-part ${r.kind}`} style={{ marginLeft: r.depth * 22 + 24 }}>
              <div className="bm-main"><span className={`rw-mono ${r.cx ? "rl-cx" : ""}`}>{r.code}</span>{r.cx ? <Pill tone="bad">{r.to ? `แทนด้วย ${r.to}` : "ยกเลิก"} {r.ver}</Pill> : r.add ? <Pill tone="mod">เพิ่ม {r.ver}</Pill> : null}{r.kind === "hw" ? <Pill tone="muted">สกรู/ยาง</Pill> : null}{destOf(r).map((k) => <Pill key={k} tone="part">{destLabel(k)}</Pill>)}<span className="bm-d">{r.d}</span></div>
              <span className="bm-n r">{nlen(r.l)}</span>
              <span className="bm-mat"><span className="rw-mono rt-inv">{r.m}</span> {cutChip(r)}</span>
              <span className="bm-q r"><small>ต่อชุด</small> {r.cx ? <span className="rl-cxq">{nlen(r.q)}</span> : r.q0 != null ? <ModQty orig={r.q0} cur={r.q} ver={r.ver} /> : nlen(r.q)}</span><span className="bm-s r"><small>รวม</small> <b>{r.cx ? "0" : nlen(Math.round(r.per * cur.n * 1000) / 1000)}</b> <small>{r.uom}</small></span>
            </div>);
        })}
      </div>);
  } else if (v === "merge") {
    const keys = { code: (e) => e.code, d: (e) => e.d, l: (e) => e.l ?? -1, m: (e) => e.m, total: (e) => e.total, uses: (e) => e.uses.size, reuse: (e) => e.reuse };
    const rows = sorter(merged.filter((e) => has(Q, e.code, e.d, e.m, ...e.uses.keys())), keys).sort(sort.k ? () => 0 : (a, b) => (a.kind === b.kind ? 0 : a.kind === "sub" ? -1 : b.kind === "sub" ? 1 : 0));
    count = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    body = (
      <div className="table-wrap rw-tw rt-tw"><table className="data-table rw-table rt-table">
        <thead><tr><Th k="code">เบอร์</Th><Th k="d">รายละเอียด</Th><Th k="l" r>ยาว</Th><Th k="m">MATERIAL</Th><Th k="total" r>รวมทั้งใบ</Th><th>หน่วย</th><Th k="uses">ใช้ใน (ซับ ×จำนวน)</Th><Th k="reuse" r>เศษ</Th></tr></thead>
        <tbody>{vis.map((e) => (
          <tr key={e.code} className={e.kind === "sub" ? "rt-subrow" : ""}>
            <td className="rw-mono"><b>{e.code}</b>{e.kind === "sub" ? <> <Pill tone="sub">ซับ</Pill></> : null}</td><td className="rl-desc"><span>{e.d}</span></td><td className="r rw-num">{nlen(e.l)}</td>
            <td className="rw-mono rt-inv">{e.m}</td><td className="r"><b>{nlen(Math.round(e.total * 1000) / 1000)}</b></td><td className="rw-muted small">{e.uom}</td>
            <td><div className="bm-uses">{[...e.uses.entries()].slice(0, 6).map(([p, u]) => <span key={p} className="rt-use" title={`${[...u.panels].slice(0, 6).join(", ")}${u.panels.size > 6 ? " …" : ""}`}><b className="rw-mono">{p}</b> × {nlen(u.q)}</span>)}{e.uses.size > 6 ? <small className="rw-muted">+{e.uses.size - 6}</small> : null}</div></td>
            <td className="r">{e.reuse ? <Pill tone="bad" title={`ตัดจากเศษ ${e.reuse} จาก ${e.reuse + e.fresh} ชิ้น`}>×{nf(e.reuse)}</Pill> : ""}</td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={8}><b>{nf(rows.length)} เบอร์</b>{ALL ? " · ทุกแบบแผง" : ` · ${cur?.unit}`} · รวมทั้งใบ = ต่อชุด × ซับชั้นบน × จำนวนแผง</td></tr></tfoot>
      </table></div>);
  } else if (v === "table") {
    const keys = { unit: (r) => r.unit, code: (r) => r.code, d: (r) => r.d, l: (r) => r.l ?? -1, f: (r) => r.f, m: (r) => r.m, ml: (r) => r.cut?.stock ?? r.ml ?? -1, q: (r) => r.q, sum: (r) => r.sum, off: (r) => r.cut?.reuse || 0 };
    const rows = sorter(flat.filter((r) => has(Q, r.code, r.d, r.m, r.unit, ...r.path)), keys);
    count = rows.length; const vis = rows.slice(0, limit); shown = vis.length;
    body = (
      <div className="table-wrap rw-tw rt-tw"><table className="data-table rw-table rt-table rt-bom">
        <thead><tr><Th k="unit">PANEL</Th><th className="r">แผง</th><th>SUB-01</th><th>SUB-02</th><Th k="code">PART NO.</Th><Th k="d">DESCRIPTION</Th><Th k="l" r>LENGTH</Th><Th k="f">FINISH</Th><Th k="m">MATERIAL</Th><Th k="off">WAST</Th><Th k="ml" r>MATERIAL LENGTH</Th><Th k="q" r>QUANTITY</Th><Th k="sum" r>SUM QUANTITY</Th></tr></thead>
        <tbody>{vis.map((r, i) => (
          <tr key={r.unit + r.i + "-" + i} className={r.kind === "sub" ? (r.depth ? "rt-b2" : "rt-b1") : ""}>
            <td className="rw-mono">{r.unit}</td><td className="r rw-num">{nf(r.n)}</td>
            <td className="rw-mono rt-inv">{r.path[0] || (r.kind === "sub" ? r.code : "")}</td><td className="rw-mono rt-inv">{r.path[1] || (r.kind === "sub" && r.depth === 1 ? r.code : "")}</td>
            <td className="rw-mono" style={{ paddingLeft: sort.k ? 12 : 12 + 12 * r.depth }}><span className={r.cx ? "rl-cx" : ""}>{r.kind === "sub" ? <b>{r.code}</b> : r.code}</span>{r.cx ? <> <Pill tone="bad">{r.to ? `แทนด้วย ${r.to}` : "ยกเลิก"} {r.ver}</Pill></> : r.add ? <> <Pill tone="mod">เพิ่ม {r.ver}</Pill></> : null}</td>
            <td className="rl-desc"><span>{r.d}</span></td><td className="r rw-num">{nlen(r.l)}</td><td className="rt-rem">{r.f}</td>
            <td className={`rw-mono rt-inv ${r.cut?.reuse ? "rt-waste" : ""}`}>{r.kind === "sub" ? (r.depth ? "SUB 2nd" : "SUB 1st") : r.m}</td>
            <td className="rt-waste">{r.cut?.reuse ? "wast" : ""}</td>
            <td className={`r rw-num ${r.cut?.reuse ? "rt-waste" : ""}`} title={r.cut?.reuse ? r.cut.src : ""}>{r.cut?.reuse ? wasteLens(r.cut) : r.cut ? nlen(r.cut.stock) : nlen(r.ml)}</td>
            <td className="r rw-num">{r.cx ? <span className="rl-cxq">{nlen(r.q)}</span> : r.q0 != null ? <ModQty orig={r.q0} cur={r.q} /> : nlen(r.q)}</td><td className="r"><b>{r.cx ? "0" : nlen(Math.round(r.sum * 1000) / 1000)}</b></td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={13}>{nf(rows.length)} บรรทัด · ตัวแดง/WASTE = ตัดจากเศษที่ MATERIAL ตรงกัน · กดหัวคอลัมน์เพื่อเรียง</td></tr></tfoot>
      </table></div>);
  }

  const stat = ALL
    ? { n: model.total, subs: new Set(scope.flatMap((t) => t.rows.filter((r) => !r.cx && r.kind === "sub").map((r) => r.code))).size, parts: new Set(scope.flatMap((t) => t.rows.filter((r) => !r.cx && r.kind === "part").map((r) => r.code))).size, hw: new Set(scope.flatMap((t) => t.rows.filter((r) => !r.cx && r.kind === "hw").map((r) => r.code))).size, pcs: scope.reduce((a, t) => a + t.pcs, 0), off: scope.reduce((a, t) => a + t.off, 0), fresh: scope.reduce((a, t) => a + t.fresh, 0) }
    : cur ? { n: cur.n, subs: cur.subs, parts: cur.parts, hw: cur.hw, pcs: cur.pcs, off: cur.off, fresh: cur.fresh } : null;

  return (
    <div className="bm">
      <aside className="bm-side" aria-label="แบบแผง">
        <input className="input rw-search" style={{ marginTop: 0, maxWidth: "none" }} placeholder="ค้นหาแบบแผง" value={lq} onChange={(e) => setLq(e.target.value)} aria-label="ค้นหาแบบแผง" />
        <div className="bm-lsort"><span>เรียง</span><Lsort k="unit">ชื่อ</Lsort><Lsort k="n">จำนวนแผง</Lsort><Lsort k="rows">จำนวนรายการ</Lsort><Lsort k="off">ใช้เศษ</Lsort></div>
        <div className="bm-list" role="listbox">
          <button type="button" role="option" aria-selected={ALL} className={`bm-li all ${ALL ? "on" : ""}`} onClick={() => { setSel("__ALL__"); setLimit(PAGE); }}><b>ทุกแบบแผง</b><small>{nf(model.types.size)} แบบ · {nf(model.total)} แผง</small></button>
          {list.map((t) => (
            <button key={t.unit} type="button" role="option" aria-selected={!ALL && cur?.unit === t.unit} className={`bm-li ${!ALL && cur?.unit === t.unit ? "on" : ""}`} onClick={() => { setSel(t.unit); setLimit(PAGE); }}>
              <b className="rw-mono">{t.unit}</b><span className="bm-li-n">{nf(t.n)} แผง</span>
              <small>{t.has ? `${nf(t.subs)} ซับ · ${nf(t.parts)} พาร์ท${t.off ? ` · เศษ ${nf(t.off)}` : ""}` : "ไม่มี BOM"}</small>
            </button>))}
        </div>
      </aside>
      <section className="bm-main-pane">
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
            </div>
            {v === "tree" ? <div className="bm-cols"><span>เบอร์ / รายละเอียด / ส่งไปใบ</span><span className="r">ยาว</span><span>MATERIAL · เศษ</span><span className="r">ต่อชุด</span><span className="r">รวม (× {nf(cur.n)} แผง)</span></div> : null}
            {body}
            {v !== "tree" && count > shown ? <div className="rt-more"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit((n) => n + PAGE)}>แสดงเพิ่ม ({nf(Math.min(PAGE, count - shown))})</button></div> : null}
            <div className="rt-note bm-note">เศษ: ไล่ตัดตามลำดับแผงในใบนี้ · MATERIAL (INV) ตรงกัน ใช้เศษที่เหลือพอ (ยาว + รอยตัด {KERF} มม.) ก่อนเปิดเส้นใหม่ · เศษ ≥ {MIN_OFFCUT} มม. เก็บไว้ใช้ต่อ — เป็นการคำนวณเบื้องต้น ไม่ได้ตัดสต็อกจริง</div>
          </>
        ) : <div className="rw-muted small rt-empty">ยังไม่มีแผงในใบนี้</div>}
      </section>
    </div>
  );
}
