// ══════════════════════════════════════════════════════════════════════════
// ★ 2026-11-12 ผู้ใช้: "ทุกตารางให้สามารถย้ายตำแหน่งได้ และเรียงได้" — ตารางกลางของกล่อง "ของในใบ"
//   • ลาก ⠿ ที่หัวคอลัมน์ไปวางที่หัวอื่น = ย้ายคอลัมน์ (จำไว้ในเครื่อง ต่อตาราง) · ↺ = คืนลำดับเดิม
//   • กดชื่อหัวคอลัมน์ = เรียง (กดซ้ำ = กลับด้าน · ครั้งที่ 3 = ลำดับเดิม)
//   cols: [{ k, h, th?: props ของ <th>, td: (row, i) => <td/>, sort?: (row) => ค่าเรียง, kid?: (kidRow, row, j) => <td/>, foot?: node | () => <td/> }]
//   rows · rowKey(row, i) · trProps(row, i) · kids(row) = แถวลูกใต้แถว (ไปด้วยกันตอนเรียง) · kidTrProps(kid, row, j)
//   group(row) = { key, render: (nCols) => <tr/> } หัวกลุ่มก่อนแถวแรกของกลุ่ม (ซ่อนตอนเรียง) · lock = คอลัมน์แรก ๆ ที่ไม่ให้ย้าย (เช่นช่องติ๊ก)
// ══════════════════════════════════════════════════════════════════════════
import { Fragment, cloneElement, isValidElement, useMemo, useState } from "react";

const loadOrder = (id) => { try { const v = JSON.parse(localStorage.getItem("xt-order-" + id) || "null"); return Array.isArray(v) ? v : null; } catch { return null; } };
const saveOrder = (id, o) => { try { if (o) localStorage.setItem("xt-order-" + id, JSON.stringify(o)); else localStorage.removeItem("xt-order-" + id); } catch { /* ignore */ } };
const cmp = (a, b) => {
  const na = typeof a === "number" || (a !== "" && a != null && !Number.isNaN(Number(a)) && typeof a !== "boolean");
  const nb = typeof b === "number" || (b !== "" && b != null && !Number.isNaN(Number(b)) && typeof b !== "boolean");
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  if (na && nb) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
};
const withKey = (el, key) => (isValidElement(el) ? cloneElement(el, { key }) : <td key={key}>{el}</td>);

// ★ 2026-11-12 S5: React ใช้ตัวตารางเดิมซ้ำเมื่อสลับแท็บ (ตำแหน่งเดียวกัน คนละ id) → ลำดับคอลัมน์ที่อ่านตอนเปิดครั้งแรกรั่วไปตารางอื่น
//   และของตารางที่จัดไว้ไม่กลับมา · key = id → เปลี่ยนตาราง = เริ่มใหม่ อ่านลำดับของตารางนั้นเอง
export function XTable(props) { return <XTableOne key={props.id || ""} {...props} />; }
function XTableOne({ id, cols, rows, rowKey, trProps = null, kids = null, kidTrProps = null, group = null, after = null, limit = Infinity, note = null, foot = true, lock = 0, className = "", tableProps = {}, empty = null, sortOn = true }) {
  const [order, setOrderRaw] = useState(() => loadOrder(id));
  const [sort, setSort] = useState({ k: "", d: 1 });
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const setOrder = (o) => { setOrderRaw(o); saveOrder(id, o); };
  // คอลัมน์ตามลำดับที่ผู้ใช้จัด (คอลัมน์ใหม่ที่ไม่เคยจัด = ต่อท้ายตามตำแหน่งเดิม · คอลัมน์ล็อกอยู่หน้าเสมอ)
  const shown = useMemo(() => {
    const fixed = cols.slice(0, lock), mov = cols.slice(lock);
    if (!order) return cols;
    const byK = new Map(mov.map((c) => [c.k, c])); const out = [];
    for (const k of order) if (byK.has(k)) { out.push(byK.get(k)); byK.delete(k); }
    mov.forEach((c, i) => { if (byK.has(c.k)) { const prev = mov[i - 1]; const at = prev ? out.indexOf(prev) + 1 : 0; out.splice(at, 0, c); byK.delete(c.k); } });
    return [...fixed, ...out];
  }, [cols, order, lock]);
  const moved = !!order && shown.some((c, i) => c !== cols[i]);
  const sc = sort.k ? cols.find((c) => c.k === sort.k && c.sort) : null;
  const view = useMemo(() => {
    const list = rows.map((r, i) => ({ r, i }));
    const out = !sc ? list : [...list].sort((a, b) => cmp(sc.sort(a.r), sc.sort(b.r)) * sort.d || a.i - b.i);
    return out.slice(0, limit);
  }, [rows, sc, sort.d, limit]);   // eslint-disable-line react-hooks/exhaustive-deps
  const clickSort = (c) => { if (!sortOn || !c.sort) return; setSort((s) => (s.k !== c.k ? { k: c.k, d: 1 } : s.d === 1 ? { k: c.k, d: -1 } : { k: "", d: 1 })); };
  const drop = (toK) => {
    if (!drag || drag === toK) return;
    const keys = shown.slice(lock).map((c) => c.k); const from = keys.indexOf(drag), to = keys.indexOf(toK); if (from < 0 || to < 0) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]); setOrder(keys);
  };
  let lastG = null;
  const n = shown.length;
  return (
    <table className={`xt ${className}`} {...tableProps}>
      <thead><tr>{shown.map((c, ci) => {
        const fixed = ci < lock; const on = sort.k === c.k;
        return (
          <th key={c.k} {...(c.th || {})} className={`${(c.th && c.th.className) || ""} ${over === c.k && drag && drag !== c.k ? "xt-over" : ""} ${drag === c.k ? "xt-drag" : ""}`.trim()}
            aria-sort={on ? (sort.d > 0 ? "ascending" : "descending") : undefined}
            draggable={!fixed} onDragStart={(e) => { if (fixed) return; setDrag(c.k); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.k); } catch { /* ignore */ } }}
            onDragOver={(e) => { if (!drag || fixed) return; e.preventDefault(); if (over !== c.k) setOver(c.k); }} onDragLeave={() => setOver((o) => (o === c.k ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.k); setDrag(null); setOver(null); }} onDragEnd={() => { setDrag(null); setOver(null); }}>
            <span className="xt-h">
              {!fixed ? <span className="xt-grip" title="ลากเพื่อย้ายคอลัมน์" aria-hidden="true">⠿</span> : null}
              {c.sort && sortOn ? <button type="button" className={`xt-sort ${on ? "on" : ""}`} onClick={() => clickSort(c)} title="กดเพื่อเรียง">{c.h}<i>{on ? (sort.d > 0 ? "▲" : "▼") : "↕"}</i></button> : <span>{c.h}</span>}
              {ci === n - 1 && moved ? <button type="button" className="xt-reset" onClick={() => setOrder(null)} title="คืนลำดับคอลัมน์เดิม">↺</button> : null}
            </span>
          </th>);
      })}</tr></thead>
      <tbody>
        {view.length ? view.map(({ r, i }) => {
          const g = group && !sc ? group(r, i) : null; const gk = g ? g.key : null; const head = g && gk !== lastG ? g.render(n) : null; if (g) lastG = gk;
          const kk = kids ? kids(r, i) || [] : [];
          const tp = trProps ? trProps(r, i, !!sc) || {} : {};
          return (
            <Fragment key={rowKey ? rowKey(r, i) : i}>
              {head}
              <tr {...tp}>{shown.map((c) => withKey(c.td(r, i), c.k))}</tr>
              {kk.map((kr, j) => <tr key={"k" + j} {...(kidTrProps ? kidTrProps(kr, r, j) || {} : {})}>{shown.map((c) => withKey(c.kid ? c.kid(kr, r, j) : <td />, c.k))}</tr>)}
              {after ? after(r, i, n) : null}
            </Fragment>);
        }) : empty ? <tr><td colSpan={n}>{empty}</td></tr> : null}
      </tbody>
      {note ? <tfoot><tr><td colSpan={n}>{typeof note === "function" ? note(!!sc) : note}</td></tr></tfoot> : null}
      {foot && !note && shown.some((c) => c.foot !== undefined) ? <tfoot><tr>{shown.map((c) => withKey(typeof c.foot === "function" ? c.foot() : c.foot === undefined ? <td /> : <td>{c.foot}</td>, c.k))}</tr></tfoot> : null}
    </table>);
}
