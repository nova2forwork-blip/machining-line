// ★ 2026-11-11 "ของในใบ" มุมมองใหม่ (แบบ B · ทดลอง) — ผู้ใช้: "เก็บแบบแรกไว้ก่อน · ข้อมูลแบบเดิม แต่ตารางเป็นแบบใหม่ · เวลาแก้ก็แก้ในตารางแบบใหม่"
//   ตารางเดียวทุกเบอร์ (พาร์ทผลิตเอง + ซับ) · คลิกช่อง จำนวน / วัสดุ / ความยาว แล้วพิมพ์ทับ (Enter = ตกลง · Tab = ช่องถัดไป · Esc = ยกเลิก)
//   ที่แก้ค้าง → แถบล่าง "บันทึกเป็น M-00x" เปิดหน้า Modify เดิมพร้อมรายการ (ใส่เหตุผล · ตรวจยอดที่ทำแล้ว · ยืนยัน) · แท็บชั้นอยู่ใต้ตารางแบบแท็บชีต Excel
//   ข้อมูลชุดเดียวกับมุมมองเดิม (need / rel ของใบ) — ไม่มีการบันทึกอะไรเองในหน้านี้
import { useMemo, useRef, useState, useEffect } from "react";
import { NC, ncmp, nf, nlen, addrKey, floorKey, floorsOf, nextModNo, modVer, suspectLen } from "./releaseCore.js";
import { rowsOfType } from "./ReleaseBom.jsx";

const LABEL = { qty: "จำนวน", inv: "วัสดุ", len: "ความยาว" };

export function SheetView({ kind = null, plan, need, rel, doneOf, leftOf, madeOf = null, onInlineModify = null, onRelease = null, onRowProgress = null }) {
  const [filt, setFilt] = useState("all");
  const [q, setQ] = useState("");
  const [floorSel, setFloorSel] = useState(null);
  const [ed, setEd] = useState({});            // "part|CODE" → { qty?, inv?, len? }
  const [cur, setCur] = useState(null);        // ช่องที่กำลังพิมพ์ "part|CODE|qty"
  const [pick, setPick] = useState(() => new Set());
  const [paste, setPaste] = useState(null);    // ข้อความที่วางจาก Excel (null = ปิด)
  const [pmsg, setPmsg] = useState("");
  const nextRef = useRef(0); const orderRef = useRef([]);
  const nMods = (plan.mods || []).length;
  useEffect(() => { setEd({}); setCur(null); }, [nMods, plan.ro]);

  const rows = useMemo(() => [...(kind === "sub" ? [] : need.parts.map((x) => ({ ...x, kind: "part" }))), ...(kind === "part" ? [] : need.subs.map((x) => ({ ...x, kind: "sub" })))].sort((a, b) => ncmp(a.code, b.code)), [need, kind]);
  const units = plan.units || [];
  const liveUnits = useMemo(() => units.filter((u) => !need.cancelledAddr[addrKey(u.addr)]), [units, need]);
  const floors = useMemo(() => floorsOf(liveUnits), [liveUnits]);
  const hasFloors = floors.some((x) => x.f);
  const floor = floorSel != null && floors.some((x) => x.f === floorSel) ? floorSel : null;
  const fq = useMemo(() => {
    if (floor == null) return null;
    const cnt = new Map(); for (const u of liveUnits) { if (floorKey(u) !== floor) continue; const k = String(u.unit || "").trim(); if (k) cnt.set(k, (cnt.get(k) || 0) + 1); }
    const m = new Map();
    for (const [unit, n] of cnt) for (const r of rowsOfType(plan, unit)) { if (r.cx || !(r.per > 0)) continue; const k = NC(r.code); m.set(k, (m.get(k) || 0) + r.per * n); }
    return m;
  }, [floor, liveUnits, plan.bom]);   // eslint-disable-line react-hooks/exhaustive-deps

  const kOf = (r) => `${r.kind}|${r.code}`;
  const curOf = (r, f) => (f === "qty" ? r.qty : f === "inv" ? r.inv || "" : r.l ?? "");
  const clean = (f, v) => { const s = String(v ?? "").trim(); if (!s) return null;
    if (f === "inv") return s.toUpperCase();
    const n = Number(s.replace(/,/g, "")); if (!Number.isFinite(n) || n < 0 || (f === "len" && n <= 0)) return null; return f === "qty" ? Math.round(n) : n; };
  const setEdit = (r, f, raw) => { const v = clean(f, raw); const c0 = curOf(r, f); const same = v == null || (f === "inv" ? v === String(c0).toUpperCase() : v === Number(c0));
    setEd((c) => { const k = kOf(r); const nx = { ...(c[k] || {}) }; if (same) delete nx[f]; else nx[f] = v; const o = { ...c }; if (Object.keys(nx).length) o[k] = nx; else delete o[k]; return o; }); };
  const made = (r) => (madeOf ? madeOf(r.code) : null);
  const locked = (r) => !!r.cancelled || (made(r) != null && r.qty > 0 && made(r) >= r.qty);
  const edList = useMemo(() => {
    const out = [];
    for (const [k, v] of Object.entries(ed)) { const i = k.indexOf("|"); const kd = k.slice(0, i); const r0 = (kd === "sub" ? need.subs : need.parts).find((x) => x.code === k.slice(i + 1)); const r = r0 ? { ...r0, kind: kd } : null; if (!r || r.cancelled) continue;
      for (const f of ["qty", "inv", "len"]) if (v[f] !== undefined) out.push({ kind: r.kind, code: r.code, f, from: curOf(r, f), to: v[f] }); }
    return out;
  }, [ed, need]);   // eslint-disable-line react-hooks/exhaustive-deps
  const edited = (r) => !!ed[kOf(r)];
  const sus = (r) => r.kind === "part" && !r.cancelled && suspectLen(r.l) && ed[kOf(r)]?.len === undefined;

  const Q = q.trim().toUpperCase();
  const pass = (r, f) => (f === "chk" ? sus(r) : f === "ed" ? edited(r) : f === "new" ? !r.cancelled && !doneOf(r.code) : f === "lock" ? locked(r) && !r.cancelled : true);
  const inFloor = (r) => !fq || fq.has(NC(r.code));
  const vis = rows.filter(inFloor).filter((r) => pass(r, filt)).filter((r) => !Q || `${r.code} ${r.d || ""} ${r.inv || ""}`.toUpperCase().includes(Q));
  const count = (f) => rows.filter(inFloor).filter((r) => pass(r, f)).length;

  const fmt = (f, v) => (f === "inv" ? v || "—" : v === "" || v == null ? "—" : nlen(v));
  orderRef.current = [];
  const commit = (r, f, raw) => { setEdit(r, f, raw); const id = `${kOf(r)}|${f}`; const dir = nextRef.current; nextRef.current = 0;
    if (dir) { const o = orderRef.current; const i = o.indexOf(id); setCur(o[i + dir] || null); } else setCur((c) => (c === id ? null : c)); };
  const cell = (r, f) => {
    const id = `${kOf(r)}|${f}`; const c0 = curOf(r, f); const pv = ed[kOf(r)]?.[f]; const chg = pv !== undefined;
    const can = !!onInlineModify && !locked(r) && (f !== "qty" || !fq) && (f !== "inv" || r.kind === "part");
    if (f === "qty" && fq) { const n = Math.round((fq.get(NC(r.code)) || 0) * 100) / 100; return <span className="rs2-v" title={`ชั้น ${floor || "ไม่ระบุ"} ใช้ ${nlen(n)} · ทั้งใบ ${nlen(r.qty)}`}><b>{nlen(n)}</b> <small className="rw-muted">/ {nlen(r.qty)}</small></span>; }
    if (!can) return <span className="rs2-v">{f === "inv" && r.kind === "sub" ? <span className="rw-muted">—</span> : fmt(f, c0)}</span>;
    orderRef.current.push(id);
    // ★ 2026-11-12 ผู้ใช้: "กดเข้าไปแก้แล้วมันยืด" → ช่องพิมพ์ลอยทับช่องเดิม (ไม่ดันความกว้างคอลัมน์) · ข้อความเดิมซ่อนไว้ข้างใต้เพื่อคงขนาด
    if (cur === id) return <span className="rs2-edhold"><span className="rs2-cell rs2-ghost" aria-hidden="true">{chg ? <s className="rl-old">{fmt(f, c0)}</s> : null}<b>{fmt(f, chg ? pv : c0)}</b></span><input autoFocus className="input rs2-in" defaultValue={chg ? pv : c0} inputMode={f === "inv" ? "text" : "decimal"} aria-label={`${LABEL[f]} ${r.code}`}
      onFocus={(e) => e.target.select()} onBlur={(e) => commit(r, f, e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") { e.target.value = String(chg ? pv : c0); e.target.blur(); } else if (e.key === "Tab") { e.preventDefault(); nextRef.current = e.shiftKey ? -1 : 1; e.target.blur(); } }} /></span>;
    const s = f === "len" && sus(r);
    return <button type="button" className={`rs2-cell ${chg ? "ed" : ""} ${s ? "sus" : ""}`} onClick={() => setCur(id)} aria-label={`${LABEL[f]} ${r.code}`} title={s ? "ความยาวน่าสงสัย (อาจอ่านมาแค่หลักฟุต) — กดเพื่อแก้" : "กดเพื่อแก้"}>
      {chg ? <s className="rl-old">{fmt(f, c0)}</s> : null}<b>{fmt(f, chg ? pv : c0)}</b>{s ? <small className="rs2-sus"> ตรวจ</small> : null}</button>;
  };
  const status = (r) => {
    if (r.cancelled) return <span className="rs2-tag am">ยกเลิก</span>;
    if (edited(r)) return <span className="rs2-tag bl">แก้ค้าง → {modVer(nextModNo(plan))}</span>;
    if (sus(r)) return <span className="rs2-tag am">ต้องตรวจ</span>;
    const done = doneOf(r.code); const m = made(r);
    if (m != null && r.qty > 0 && m >= r.qty) return <span className="rs2-tag g">เสร็จ {nf(m)}/{nf(r.qty)}</span>;
    if (!done) return <span className="rs2-tag gy">ยังไม่ปล่อย</span>;
    return <span className="rs2-tag gy">{m != null ? `ทำแล้ว ${nf(m)}/${nf(r.qty)}` : `ปล่อย ${nf(done)}/${nf(r.qty)}`}</span>;
  };
  const pickable = (r) => !r.cancelled && leftOf(r.code, r.qty) > 0;
  const tog = (r, on) => setPick((p) => { const n = new Set(p); if (on) n.add(kOf(r)); else n.delete(kOf(r)); return n; });
  const send = () => { if (!onInlineModify || !edList.length) return; const chg = {}; const matChg = [];
    for (const x of edList) { if (x.f === "qty") chg[`${x.kind}|${x.code}`] = { type: "qty", qty: String(x.to) };
      else matChg.push({ id: `${NC(x.code)}|${x.f === "len" ? "len" : "mat"}`, code: x.code, kind: x.kind, field: x.f === "len" ? "len" : "mat", from: x.from === "" ? "—" : x.from, to: x.to, file: "", on: true }); }
    onInlineModify({ chg, matChg }); };
  const doPaste = () => { let ok = 0; const miss = [], lk = [];
    for (const line of String(paste || "").split(/\r?\n/)) { if (!line.trim()) continue; const c = line.split("\t").map((x) => x.trim()); const r = rows.find((x) => NC(x.code) === NC(c[0]));
      if (!r) { if (!/เบอร์|code|part/i.test(c[0])) miss.push(c[0]); continue; } if (locked(r)) { lk.push(r.code); continue; }
      if (c[1] && clean("qty", c[1]) != null) { setEdit(r, "qty", c[1]); ok++; } if (c[2] && r.kind === "part") { setEdit(r, "inv", c[2]); ok++; } if (c[3] && clean("len", c[3]) != null) { setEdit(r, "len", c[3]); ok++; } }
    setPmsg(`อ่านได้ ${nf(ok)} ช่อง${miss.length ? ` · ไม่พบเบอร์: ${miss.slice(0, 8).join(", ")}${miss.length > 8 ? " …" : ""}` : ""}${lk.length ? ` · เสร็จแล้ว/ยกเลิก ข้าม: ${lk.join(", ")}` : ""} — ช่องที่ต่างจากเดิมเป็นสีฟ้า`); };
  const picks = rows.filter((r) => pick.has(kOf(r)) && pickable(r));
  const mv = modVer(nextModNo(plan));
  const chips = [["all", "ทั้งหมด"], ["chk", "ต้องตรวจ"], ["ed", "แก้ค้างอยู่"], ["new", "ยังไม่ปล่อย"], ["lock", "เสร็จแล้ว · ล็อก"]];

  return (
    <div className="rs2">
      <div className="rs2-top">
        {chips.map(([k, t]) => <button key={k} type="button" className={`rs2-chip ${filt === k ? "on" : ""}`} aria-pressed={filt === k} onClick={() => setFilt(k)}>{t} <small>{nf(count(k))}</small></button>)}
        <input className="input rs2-q" placeholder="ค้นหาเบอร์ / รายละเอียด / วัสดุ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาในตาราง" />
        {onInlineModify ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPaste(paste == null ? "" : null); setPmsg(""); }}>วางจาก Excel</button> : null}
        {onRelease ? <button type="button" className="btn btn-accent btn-sm" disabled={!picks.length} onClick={() => onRelease({ parts: picks.filter((r) => r.kind === "part").map((r) => r.code), subs: picks.filter((r) => r.kind === "sub").map((r) => r.code), addrs: [] }, () => setPick(new Set()))}>ปล่อยที่เลือก ({nf(picks.length)}) →</button> : null}
      </div>
      {paste != null ? (
        <div className="rs2-paste">
          <label htmlFor="rs2-pt">ก๊อปจาก Excel 2–4 คอลัมน์ <b>เบอร์ | จำนวน | วัสดุ | ยาว</b> (เว้นช่องที่ไม่แก้ได้) แล้ววางที่นี่ — ยังไม่บันทึกจนกว่าจะกดที่แถบล่าง</label>
          <textarea id="rs2-pt" className="input" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"MAL132-5001 A\t10\tA10031-AL39700D\nMAL530-5001 A\t\t\t1054.12"} />
          <div className="rs2-paste-row"><button type="button" className="btn btn-accent btn-sm" disabled={!paste.trim()} onClick={doPaste}>นำเข้าเป็นรายการแก้ค้าง</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaste(null)}>ปิด</button>{pmsg ? <span className="rw-muted small" role="status">{pmsg}</span> : null}</div>
        </div>) : null}
      <div className="rs2-card">
        <div className="table-wrap rs2-tw">
          <table className="rs2-table">
            <thead><tr><th style={{ width: 40 }} /><th>เบอร์</th><th>ชนิด</th><th>รายละเอียด</th><th className="r">{floor != null ? `จำนวน ${floor || "ไม่ระบุชั้น"} / ทั้งใบ` : "จำนวน"}</th><th>วัสดุ (INV)</th><th className="r">ยาว มม.</th><th>ล็อต</th><th>สถานะ</th></tr></thead>
            <tbody>{vis.slice(0, 800).map((r) => { const lk = locked(r); const e = rel.byCode.get(NC(r.code)); return (
              <tr key={kOf(r)} className={r.cancelled ? "cx" : lk ? "lock" : ""}>
                <td>{lk ? <span className="rs2-v rw-muted small" title={r.cancelled ? "ยกเลิกแล้ว" : "เสร็จแล้ว แก้ไม่ได้"}>ล็อก</span> : <span className="rs2-v"><input type="checkbox" checked={pick.has(kOf(r))} disabled={!pickable(r)} onChange={(ev) => tog(r, ev.target.checked)} aria-label={`เลือก ${r.code}`} /></span>}</td>
                <td>{onRowProgress ? <button type="button" className="rs2-code rw-mono" onClick={() => onRowProgress(r.code, r.kind === "sub" ? "subassembly" : "part")} title="กดเพื่อดูความคืบหน้า">{r.code}</button> : <span className="rs2-v rw-mono"><b>{r.code}</b></span>}</td>
                <td><span className="rs2-v">{r.kind === "sub" ? "Sub" : "Part"}</span></td>
                <td className="rs2-desc"><span className="rs2-v">{r.d}</span></td>
                <td className="r">{cell(r, "qty")}</td>
                <td>{cell(r, "inv")}</td>
                <td className="r">{cell(r, "len")}</td>
                <td><span className="rs2-v">{e && e.lots.length ? e.lots.join(" · ") : <span className="rw-muted">—</span>}</span></td>
                <td><span className="rs2-v">{status(r)}</span></td>
              </tr>); })}
              {!vis.length ? <tr><td colSpan={9}><span className="rs2-v rw-muted">ไม่มีเบอร์ในมุมมองนี้</span></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="rs2-tabs" role="tablist" aria-label="ชั้น">
          {floors.filter((x) => x.f).map((x) => <button key={x.f} type="button" role="tab" aria-selected={floor === x.f} className={`rs2-tab ${floor === x.f ? "on" : ""}`} onClick={() => setFloorSel(x.f)}>{x.f} <small>· {nf(x.n)} แผง</small></button>)}
          {hasFloors && floors.some((x) => !x.f) ? <button type="button" role="tab" aria-selected={floor === ""} className={`rs2-tab ${floor === "" ? "on" : ""}`} onClick={() => setFloorSel("")}>ยังไม่ระบุชั้น <small>· {nf(floors.find((x) => !x.f).n)}</small></button> : null}
          <button type="button" role="tab" aria-selected={floor == null} className={`rs2-tab all ${floor == null ? "on" : ""}`} onClick={() => setFloorSel(null)}>รวม {plan.ro} <small>· {nf(rows.length)} เบอร์</small></button>
          {!hasFloors ? <span className="rw-muted small">ยังไม่ได้ใส่ชั้นของแผง — ใส่ได้ที่มุมมองแบบเดิม แท็บ ASSEMBLY (แผง)</span> : null}
        </div>
        <div className="rs2-hint rw-muted small">{vis.length > 800 ? `แสดง 800 จาก ${nf(vis.length)} เบอร์ — ใช้ช่องค้นหา · ` : ""}{fq ? "แท็บชั้น: จำนวน = ที่ใช้ในชั้นนี้ / ทั้งใบ (แก้จำนวนที่แท็บรวม) · " : ""}คลิกช่อง จำนวน / วัสดุ / ความยาว เพื่อแก้ · Enter = ตกลง · Tab = ช่องถัดไป · Esc = ยกเลิก · ช่องเหลือง = ความยาวน่าสงสัย · เบอร์ที่เสร็จแล้วล็อก</div>
      </div>
      {edList.length ? (
        <div className="rt-pickbar rt-edbar" role="region" aria-label="รายการที่แก้ค้างไว้">
          <span><b>แก้ {nf(edList.length)} ช่อง ใน {nf(new Set(edList.map((x) => x.kind + "|" + x.code)).size)} เบอร์ · ยังไม่ได้บันทึก</b>
            <small>{edList.slice(0, 4).map((x) => `${x.code} ${LABEL[x.f]} ${fmt(x.f, x.from)} → ${fmt(x.f, x.to)}`).join(" · ")}{edList.length > 4 ? ` · อีก ${edList.length - 4}` : ""} — จะบันทึกเป็น {mv}</small></span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEd({}); setCur(null); }}>ยกเลิกที่แก้</button>
          <button type="button" className="btn btn-accent" onClick={send}>บันทึกเป็น {mv} →</button>
        </div>) : null}
    </div>
  );
}
