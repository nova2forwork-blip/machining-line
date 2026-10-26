// ══════════════════════════════════════════════════════════════════════════
// Release (แผน) + ปล่อยเป็นล็อต — office เลือกเองว่าจะปล่อยอะไร (แผง / ซับ / พาร์ท) และส่งไปใบงานไหน
//   หัว Total 3 อย่าง (ตาม Excel): Total Part (MACHINING PART · BENDING · STEEL) · Total Sub-Assembly (SUB A'ssy พับ / เชื่อม / Site Item / ยิง) · Total Mat. (วัตถุดิบงานตัด · GLASS · FIXING)
//   ซับ 1 เบอร์ไปได้หลายใบ (พับ + เชื่อม + ยิง) · พาร์ทเลือกได้ว่าไป MACHINING PART / BENDING / STEEL
//   ล็อต = P-142.1 / .2 / … (หรือ P-142 เอง) ปล่อยก่อนหลังได้ · ระบบหักของที่ปล่อยแล้ว ไม่ให้ปล่อยเกิน
// ══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { askConfirm } from "../confirm.jsx";
import {
  NC, ncmp, nf, nlen, findKey, isStar, SHEETS, PART_DESTS, isPartSheet, TOTALS, PROCS, procList, needOf, releasedOf, nextLotNo, lotOf, lotRows, explodeFrom, roKey,
  otherOf, bomGaps, pullBomFromPlans, modifyOps, applyModToPlan, bomEditEffects, ruleDest, modVer, nextModNo, lotModMap, addrKey, addrsFromNote, lotMaterials, ruleCat, QR_CATS, destLabel } from "./releaseCore.js";
import { Pill, ModQty, Code, SUB_SHORT } from "./releaseUi.jsx";
import { TotalsSection } from "./ReleaseTotals.jsx";
import LotSheetPreview from "./LotSheetPreview.jsx";
import "./release-wizard.css";

const todayYmd = () => { const d = new Date(); const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const dateToIso = (ymd) => { if (!ymd) return new Date().toISOString(); const now = new Date(); const d = new Date(`${ymd}T00:00:00`); d.setHours(now.getHours(), now.getMinutes(), now.getSeconds()); return d.toISOString(); };
const fmtD = (iso) => { try { return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return ""; } };
const sheetOf = (k) => SHEETS.find((s) => s.k === k) || { k, label: k, th: "" };

// แผนกับยอดคงเหลือ (ใช้ทั้งหน้า Release และตัวสร้างล็อต)
function usePlanState(plan, releases) {
  const need = useMemo(() => needOf(plan), [plan]);
  const rel = useMemo(() => releasedOf(releases, plan), [releases, plan]);
  const doneOf = (code) => (rel.byCode.get(NC(code)) || { qty: 0 }).qty;
  // เหลือปล่อย = ต้องใช้ − ปล่อยใน Release นี้ − ที่ปล่อยไว้แล้วใน Release อื่น (ใช้เป็นเบอร์ลูก ไม่ปล่อยซ้ำ)
  const leftOf = (code, needQty) => Math.max(0, Math.round((needQty - doneOf(code) - (otherOf(rel, code)?.qty || 0)) * 1000) / 1000);
  return { need, rel, doneOf, leftOf };
}

// ══ หน้า Release (แผน) ══
export function ReleasePlanView({ plan, releases, plans = [], api, user, onBack, onPlanChange, onReleased, onModified, openBuilder = false }) {
  const { need, rel, doneOf, leftOf } = usePlanState(plan, releases);
  const [builder, setBuilder] = useState(openBuilder);
  const [preset, setPreset] = useState(null);   // เลือกจากตาราง Total แล้วกด "ปล่อยที่เลือก"
  const [modify, setModify] = useState(false);
  const [open, setOpen] = useState(null);
  useEffect(() => { document.body.style.overflow = builder || modify ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [builder, modify]);
  // BOM ที่ยังไม่มีในแผนนี้ → ดึงจาก Release อื่นของโปรเจคเดียวกันให้เอง (เฉพาะที่ว่าง)
  const gaps = useMemo(() => bomGaps(plan), [plan]);
  const [pulled, setPulled] = useState([]);
  const pullNow = (auto) => {
    const r = pullBomFromPlans(plan, plans);
    if (r.filled.length && onPlanChange) { onPlanChange(r.plan); setPulled((x) => [...x, ...r.filled]); }
    return r.filled.length;
  };
  useEffect(() => { if ((gaps.panels.length || gaps.subs.length) && plans.length > 1) pullNow(true); }, [plan.id, plans.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const liveUnits = plan.units.filter((u) => !need.cancelledAddr[addrKey(u.addr)]);
  const nUnits = liveUnits.length, addrDone = liveUnits.filter((u) => rel.addrLot.has(String(u.addr).toUpperCase())).length;
  const liveSubs = need.subs.filter((s) => !s.cancelled), liveParts = need.parts.filter((p) => !p.cancelled);
  const subDone = liveSubs.filter((s) => leftOf(s.code, s.qty) <= 0).length;
  const partDone = liveParts.filter((p) => leftOf(p.code, p.qty) <= 0).length;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const descMap = useMemo(() => new Map([...need.parts, ...need.subs].map((x) => [NC(x.code), x.d])), [need]);
  const descOf = (code) => descMap.get(NC(code)) || "";
  const [sheetPrev, setSheetPrev] = useState(null);   // ตัวอย่างใบปล่อย (PDF / Excel) ของล็อต
  const lastLot = rel.lots[rel.lots.length - 1];
  const rowSheets = (r) => { const m = /ใบ:\s*(.+?)(?:\s*·|$)/.exec(r.note || ""); if (r.kind === "panel") return ["panel"]; if (m) return m[1].split(/\s*,\s*/).map((l) => (SHEETS.find((s) => s.label === l || s.k === l) || {}).k || l); return r.kind === "subassembly" ? (need.subs.find((s) => NC(s.code) === NC(r.code))?.procs || []) : [need.parts.find((p) => NC(p.code) === NC(r.code))?.dest || "CUTTING"]; };
  return (
    <div className="rw rl">
      {sheetPrev ? <LotSheetPreview args={sheetPrev} onClose={() => setSheetPrev(null)} /> : null}
      <div className="page-head rw-head">
        <div>
          <div className="rw-crumb"><button type="button" className="rw-link" onClick={onBack}>ปล่อยงาน (Release)</button> <span>/</span> {plan.ro}</div>
          <div className="page-title rl-title">Release {plan.ro} <Pill tone="ok">ใช้งาน</Pill>{plan.mods?.length ? <Pill tone="mod">ตอนนี้ {plan.mods[plan.mods.length - 1].ver}</Pill> : null}</div>
          <div className="page-sub">{plan.projectCode}{plan.note ? ` · ${plan.note}` : ""} · {fmtD(plan.date)} · จัดทำโดย {plan.by} · PDF {plan.pdfs?.length || 0} ไฟล์</div>
        </div>
        <div className="rw-head-right">
          <button type="button" className="btn btn-ghost" onClick={onBack}><Icon name="arrowLeft" size={14} /> กลับ</button>
          <button type="button" className="btn btn-ghost rl-modbtn" onClick={() => setModify(true)} title="แก้จำนวน / ยกเลิกเบอร์ / ยกเลิกที่อยู่ / เพิ่มเบอร์ — จำนวนเดิมขีดฆ่าไว้ · เบอร์ที่ยกเลิกเป็นสีแดง">✎ Modify</button>
          <button type="button" className="btn btn-accent" onClick={() => { setPreset(null); setBuilder(true); }}><Icon name="plus" size={15} /> ปล่อยล็อตใหม่</button>
        </div>
      </div>

      {pulled.length ? <div className="rw-msg ok">✓ ดึง BOM จาก Release อื่นให้อัตโนมัติ {pulled.length} เบอร์: {pulled.slice(0, 6).map((f) => `${f.code} (จาก ${f.from})`).join(", ")}{pulled.length > 6 ? " …" : ""}</div> : null}
      {gaps.panels.length || gaps.subs.length ? <div className="rw-msg warn">⚠ ยังไม่มี BOM: {[gaps.panels.length && `แผง ${gaps.panels.length} แบบ`, gaps.subs.length && `ซับ ${gaps.subs.length} เบอร์`].filter(Boolean).join(" · ")} — ปล่อยได้ก่อน พอ Release อื่นมี BOM ของเบอร์เหล่านี้ ระบบดึงมาให้เอง{plans.length > 1 ? <> <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (!pullNow()) setPulled([]); }}>ดึงตอนนี้</button></> : null}</div> : null}

      <div className="rl-kpis">
        {[["แผง", addrDone, nUnits, "ที่อยู่ปล่อยแล้ว"], ["ซับ", subDone, liveSubs.length, "เบอร์ปล่อยครบ"], ["พาร์ท", partDone, liveParts.length, "เบอร์ปล่อยครบ"]].filter(([l, , b]) => l !== "แผง" || b > 0).map(([l, a, b, s]) => (   // ใบที่ไม่มีแผง (โหมดเฉพาะซับ/พาร์ท) = ไม่โชว์ช่องแผง

          <div key={l} className="rl-kpi"><div className="rl-kpi-top"><span>{l}</span><b>{nf(a)}<small> / {nf(b)}</small></b></div><div className="rl-bar"><i style={{ width: `${pct(a, b)}%` }} /></div><small>{s} · {pct(a, b)}%</small></div>
        ))}
        <div className="rl-kpi"><div className="rl-kpi-top"><span>ล็อต</span><b>{rel.lots.length}</b></div><small>{lastLot ? `ล่าสุด ${lastLot.no} · ${fmtD(lastLot.date)}` : "ยังไม่ได้ปล่อย"}</small></div>
      </div>

      <TotalsSection plan={plan} need={need} rel={rel} doneOf={doneOf} leftOf={leftOf} onPlanChange={onPlanChange} onRelease={(pick, done) => { setPreset({ ...pick, done }); setBuilder(true); }} />

      <div className="card rw-card">
        <div className="rw-sec-head"><div><h2>ล็อตที่ปล่อยแล้ว</h2><p>แต่ละล็อตมี QR ของตัวเอง · ใบสั่งผลิตใช้เลขล็อต</p></div></div>
        {rel.lots.length ? (
          <div className="rl-lots">
            {rel.lots.map((L) => { const bySheet = new Map(); L.rows.forEach((r) => rowSheets(r).forEach((k) => (bySheet.get(k) || bySheet.set(k, []).get(k)).push(r)));
              const mm = lotModMap(plan, L.no);
              const lotVers = [...new Set([...[...mm.values()].map((x) => x.ver), ...L.rows.map((r) => r.mod_version).filter(Boolean)])].sort();
              return (
                <div key={L.no} className={`rl-lot ${open === L.no ? "open" : ""}`}>
                  <button type="button" className="rl-lot-h" onClick={() => setOpen(open === L.no ? null : L.no)} aria-expanded={open === L.no}>
                    <b className="rw-mono">{L.no}</b>
                    <span className="rw-muted">{fmtD(L.date)}</span>
                    {lotVers.length ? <Pill tone="mod">Modify {lotVers.join(", ")}</Pill> : null}
                    <span>{[L.panels && `แผง ${nf(L.panels)}`, L.subs && `ซับ ${nf(L.subs)} เบอร์`, L.parts && `พาร์ท ${nf(L.parts)} เบอร์`].filter(Boolean).join(" · ")}</span>
                    <span className="rl-lot-chips">{SHEETS.filter((s) => bySheet.has(s.k)).map((s) => <Pill key={s.k} tone={s.kind === "sub" ? "sub" : s.kind === "panel" ? "panel" : "part"}>{s.kind === "sub" ? "SUB " + SUB_SHORT[s.k] : s.kind === "panel" ? "แผง" : s.label} {s.kind === "panel" ? L.panels : bySheet.get(s.k).length}</Pill>)}</span>
                    <span className="rl-caret" aria-hidden="true">▾</span>
                  </button>
                  {open === L.no ? (
                    <div className="rl-lot-body">
                      <div className="rl-lot-bar">
                        <div className="rl-lot-bar-txt"><b>ใบปล่อยของล็อต {L.no}</b><span>ดูหน้ากระดาษก่อน แล้วโหลดเป็น PDF หรือ Excel · 1 ใบงาน = 1 หน้า/ชีต</span></div>
                        <button type="button" className="btn btn-accent btn-sm" onClick={() => setSheetPrev({ plan, need, lot: L, userName: user?.name || "" })}><Icon name="printer" size={14} /> ใบปล่อย · PDF / Excel</button>
                      </div>
                      <div className="rl-sc-grid">
                      {SHEETS.filter((s) => bySheet.has(s.k)).map((s) => { const rows = bySheet.get(s.k);
                        const others = (r) => rowSheets(r).filter((k) => k !== s.k);
                        const showOthers = s.kind === "sub" && rows.some((r) => others(r).length);
                        const pcs = s.kind === "panel" ? rows.reduce((t, r) => t + (Number(r.qty) || 0), 0) : rows.reduce((t, r) => t + (Number(r.qty) || 0), 0);
                        return (
                        <section key={s.k} className={`rl-sc ${s.kind}`}>
                          <header className="rl-sc-h">
                            <div className="rl-sc-t"><b>{s.label}</b><span>{s.th}</span></div>
                            <div className="rl-sc-n">{s.kind === "panel" ? <><b>{nf(pcs)}</b> แผง<small> · {nf(rows.length)} แบบ</small></> : <><b>{nf(rows.length)}</b> เบอร์<small> · {nf(pcs)} ชิ้น</small></>}</div>
                          </header>
                          <div className="rl-sc-tw"><table className="rl-sc-table">
                            <thead><tr>
                              <th>{s.kind === "panel" ? "แผง (Unit)" : "เบอร์ (Code)"}</th>
                              {s.kind === "panel" ? <th>ที่อยู่</th> : <th>รายละเอียด</th>}
                              {showOthers ? <th>อยู่ในใบอื่นด้วย</th> : null}
                              <th className="r">จำนวน</th>
                            </tr></thead>
                            <tbody>{rows.map((r) => { const m = mm.get(NC(r.code)); const cancel = !!(r.mod_cancelled_at || m?.cancel);
                              const addrs = s.kind === "panel" ? addrsFromNote(r.note) : [];
                              return (
                              <tr key={r.code} className={cancel ? "rl-cancelrow" : ""}>
                                <td className="rl-sc-code"><Code code={r.code} cancel={cancel} /></td>
                                {s.kind === "panel"
                                  ? <td>{addrs.length ? <div className="rl-sc-addr">{addrs.map((x) => <span key={x} className={/^MOCK-/.test(x) ? "mock" : ""}>{/^MOCK-/.test(x) ? <i>Mockup</i> : null}{x}</span>)}</div> : <span className="rw-muted">—</span>}</td>
                                  : <td className="rl-sc-desc" title={descOf(r.code)}>{descOf(r.code) || <span className="rw-muted">—</span>}</td>}
                                {showOthers ? <td>{others(r).map((k) => <Pill key={k} tone="sub">SUB {SUB_SHORT[k] || k}</Pill>)}</td> : null}
                                <td className="r rl-sc-q">{m || cancel ? <ModQty orig={m ? m.orig : r.qty} cur={r.qty} ver={m?.ver || r.mod_version} cancel={cancel} /> : <>{r.mod_version ? <><Pill tone="mod">{r.mod_version}</Pill> </> : null}{nf(r.qty)}</>}</td>
                              </tr>); })}</tbody>
                          </table></div>
                        </section>); })}
                      </div>
                      <LotMats plan={plan} need={need} lot={L} sheetsOf={rowSheets} />
                    </div>) : null}
                </div>); })}
          </div>
        ) : (
          <div className="rw-empty"><Icon name="box" size={26} /><b>ยังไม่ได้ปล่อยล็อต</b><span>กด "ปล่อยล็อตใหม่" แล้วเลือกพาร์ท / ซับ / แผงที่จะปล่อยรอบนี้ และใบงานที่ส่งไป</span><button type="button" className="btn btn-accent btn-sm" onClick={() => setBuilder(true)}><Icon name="plus" size={14} /> ปล่อยล็อตใหม่</button></div>
        )}
      </div>

      {plan.mods?.length ? (
        <div className="card rw-card">
          <div className="rw-sec-head"><div><h2>ประวัติ Modify</h2><p>จำนวนเดิมขีดฆ่า → จำนวนใหม่ · เบอร์/ที่อยู่ที่ยกเลิกเป็น<b className="rl-cx">สีแดง</b> · ของที่ปล่อยแล้วแก้ในล็อตด้วย (QR ที่ยกเลิกเก็บเป็นหลักฐาน)</p></div></div>
          <div className="rl-mods">
            {[...plan.mods].reverse().map((m) => (
              <div key={m.ver} className="rl-mod">
                <div className="rl-mod-h"><Pill tone="mod">{m.ver}</Pill> <b>{fmtD(m.date)}</b> <span className="rw-muted">· {m.by} · {(m.bomEdits || []).length ? `แก้ BOM ${m.bomEdits.length} จุด · ` : ""}{m.items.length} รายการ</span>{m.reason ? <span className="rl-mod-reason">เหตุผล: {m.reason}</span> : null}</div>
                <ul className="rl-mod-items">
                  {(m.bomEdits || []).map((e, i) => (
                    <li key={"b" + i}>
                      <span className="rw-muted">{e.scope === "panel" ? "แผง" : "ซับ"}</span> <span className="rw-mono"><b>{e.owner}</b></span> › <span className="rw-mono"><Code code={e.code} cancel={e.type === "cancel" || e.type === "replace"} /></span>{" "}
                      {e.type === "qty" ? <>จำนวน/ชุด <s className="rl-old">{nf(e.before, e.before % 1 ? 2 : 0)}</s> → <b className="rl-new">{nf(e.qty, e.qty % 1 ? 2 : 0)}</b></>
                        : e.type === "cancel" ? <>ยกเลิกลูก (เดิม <span className="rl-cxq">{nf(e.before)}</span>)</>
                        : e.type === "replace" ? <>แก้เบอร์ → <b className="rw-mono">{e.newCode}</b> ({nf(e.qty)}/ชุด)</>
                        : <>เพิ่มลูก {nf(e.qty, e.qty % 1 ? 2 : 0)}/ชุด</>}
                    </li>))}
                  {m.items.map((it, i) => (
                    <li key={i}>
                      <span className="rw-mono"><Code code={it.code} cancel={it.type === "cancel" || it.type === "addr"} /></span>{" "}
                      {it.type === "qty" ? <>ต้องใช้ <s className="rl-old">{nf(it.before)}</s> → <b className="rl-new">{nf(it.after)}</b></>
                        : it.type === "cancel" ? <>ยกเลิกเบอร์ (เดิม <span className="rl-cxq">{nf(it.before)}</span>)</>
                        : it.type === "addr" ? <>ยกเลิกที่อยู่ (แผง {it.unit || ""})</>
                        : <>เพิ่มใหม่ {nf(it.after)} {it.kind === "sub" ? "SET" : "ชิ้น"}</>}
                      {(it.lots || []).map((l) => <span key={l.lot} className="rl-mod-lot"> · {l.lot}: {l.cancel ? <><span className="rl-cxq">{nf(l.before)}</span> ยกเลิก</> : <><s className="rl-old">{nf(l.before)}</s> → <b>{nf(l.after)}</b></>}</span>)}
                    </li>))}
                </ul>
              </div>))}
          </div>
        </div>
      ) : null}

      {modify ? (
        <ModifyDrawer plan={plan} need={need} rel={rel} api={api} user={user} onClose={() => setModify(false)}
          onSaved={async (np, mod) => { setModify(false); if (onModified) await onModified(np, mod); }} />
      ) : null}

      {builder ? (
        <LotBuilder plan={plan} need={need} rel={rel} doneOf={doneOf} leftOf={leftOf} api={api} user={user}
          onPlanChange={onPlanChange} preset={preset} onClose={() => setBuilder(false)}
          onSaved={async (r) => { setBuilder(false); if (preset?.done) preset.done(); setPreset(null); setOpen(r.lotNo); if (onReleased) await onReleased(r); }} />
      ) : null}
    </div>
  );
}

// ══ ตัวสร้างล็อต (แผงด้านขวา) ══
function LotBuilder({ plan, need, rel, doneOf, leftOf, api, user, onPlanChange, preset, onClose, onSaved }) {
  // เปิดที่ใบงานแรกที่ยังมีของเหลือ
  const [tab, setTab] = useState(() => (SHEETS.find((s) => (s.kind === "part" ? need.parts.some((p) => p.dest === s.k && leftOf(p.code, p.qty) > 0)
    : s.kind === "sub" ? need.subs.some((x) => x.procs.includes(s.k) && leftOf(x.code, x.qty) > 0)
    : plan.units.some((u) => !rel.addrLot.has(String(u.addr).toUpperCase())))) || SHEETS[0]).k);
  const [lotNo, setLotNo] = useState(() => nextLotNo(plan.ro, rel.lots));
  const [date, setDate] = useState(todayYmd());
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [pull, setPull] = useState(true);
  const [sel, setSel] = useState(() => ({ addrs: new Set(), subs: new Map(), parts: new Map() }));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState([]);
  const presetDone = useRef(false);
  useEffect(() => { const k = (e) => { if (e.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [busy, onClose]);

  const sheet = sheetOf(tab);
  const partsOf = (k) => need.parts.filter((p) => p.dest === k);
  const subsOf = (k) => need.subs.filter((s) => s.procs.includes(k));
  const noProc = need.subs.filter((s) => !s.procs.length);
  const leftAddr = plan.units.filter((u) => !rel.addrLot.has(String(u.addr).toUpperCase()) && !need.cancelledAddr[addrKey(u.addr)]);
  const tabStat = (k) => {
    if (k === "panel") return { left: leftAddr.length, sel: sel.addrs.size };
    const items = isPartSheet(k) ? partsOf(k) : subsOf(k);
    const m = isPartSheet(k) ? sel.parts : sel.subs;
    return { left: items.filter((x) => leftOf(x.code, x.qty) > 0).length, sel: items.filter((x) => m.get(x.code) > 0).length };
  };
  const ql = q.trim().toUpperCase();
  const match = (...xs) => !ql || xs.some((x) => String(x || "").toUpperCase().includes(ql));
  const rows = sheet.kind === "panel" ? plan.units.filter((u) => match(u.addr, u.unit))
    : sheet.kind === "part" ? partsOf(tab).filter((p) => match(p.code, p.d)) : (tab === "__none" ? noProc : subsOf(tab)).filter((s) => match(s.code, s.d));

  // ── เลือก / ดึงลูก ──
  const addPulled = (s, panelQty, subQty, sign) => {
    if (!pull) return;
    const ex = explodeFrom(plan.bom, panelQty, subQty);
    const cap = (m, code, needQty, add) => { const left = leftOf(code, needQty); const cur = m.get(code) || 0; const nx = Math.max(0, Math.min(left, cur + sign * add)); if (nx > 0) m.set(code, nx); else m.delete(code); };
    for (const [c, qn] of ex.subs) { const n = need.subs.find((x) => NC(x.code) === NC(c)); if (n) cap(s.subs, n.code, n.qty, qn); }
    for (const [c, qn] of ex.parts) { const n = need.parts.find((x) => NC(x.code) === NC(c)); if (n) cap(s.parts, n.code, n.qty, qn); }
  };
  const toggleAddr = (addrs, on) => setSel((s0) => {
    const s = { addrs: new Set(s0.addrs), subs: new Map(s0.subs), parts: new Map(s0.parts) };
    const changed = [];
    for (const a of addrs) { if (rel.addrLot.has(a)) continue; if (on && !s.addrs.has(a)) { s.addrs.add(a); changed.push(a); } if (!on && s.addrs.has(a)) { s.addrs.delete(a); changed.push(a); } }
    const pq = new Map(); for (const a of changed) { const u = plan.units.find((x) => String(x.addr).toUpperCase() === a); if (u) pq.set(u.unit, (pq.get(u.unit) || 0) + 1); }
    addPulled(s, pq, null, on ? 1 : -1);
    return s;
  });
  const setQty = (kind, code, needQty, v, viaToggle = false) => setSel((s0) => {
    const s = { addrs: new Set(s0.addrs), subs: new Map(s0.subs), parts: new Map(s0.parts) };
    const m = kind === "sub" ? s.subs : s.parts;
    const left = leftOf(code, needQty); const before = m.get(code) || 0;
    const nx = Math.max(0, Math.min(left, Number(v) || 0));
    if (nx > 0) m.set(code, nx); else m.delete(code);
    if (kind === "sub" && viaToggle) addPulled(s, null, new Map([[code, Math.abs(nx - before)]]), nx > before ? 1 : -1);
    return s;
  });
  const selectAllVisible = (on) => {
    if (sheet.kind === "panel") return toggleAddr(rows.map((u) => String(u.addr).toUpperCase()), on);
    for (const r of rows) setQty(sheet.kind === "sub" ? "sub" : "part", r.code, r.qty, on ? leftOf(r.code, r.qty) : 0, true);
  };
  const selectEverything = () => setSel({
    addrs: new Set(leftAddr.map((u) => String(u.addr).toUpperCase())),
    subs: new Map(need.subs.filter((s) => leftOf(s.code, s.qty) > 0).map((s) => [s.code, leftOf(s.code, s.qty)])),
    parts: new Map(need.parts.filter((p) => leftOf(p.code, p.qty) > 0).map((p) => [p.code, leftOf(p.code, p.qty)])),
  });
  const setProc = (code, p, on) => {
    const cur = procList((plan.procOv || {})[code] ?? need.subs.find((s) => s.code === code)?.procs.join(", "));
    const nx = on ? [...new Set([...cur, p])] : cur.filter((x) => x !== p);
    onPlanChange({ ...plan, procOv: { ...(plan.procOv || {}), [code]: PROCS.filter((x) => nx.includes(x)).join(", ") } });
  };
  const setDest = (code, d) => onPlanChange({ ...plan, destOv: { ...(plan.destOv || {}), [code]: d } });
  // เปิดมาพร้อมของที่เลือกจากตาราง Total: แผง → ซับ → พาร์ท (ยอดที่เหลือทั้งหมด · ดึงลูกตามช่อง "ดึงลูกมาด้วย")
  useEffect(() => {
    if (!preset || presetDone.current) return; presetDone.current = true;
    if (preset.addrs.length) toggleAddr(preset.addrs, true);
    for (const c of preset.subs) { const r = need.subs.find((x) => x.code === c); if (r) setQty("sub", c, r.qty, leftOf(c, r.qty), true); }
    for (const c of preset.parts) { const r = need.parts.find((x) => x.code === c); if (r) setQty("part", c, r.qty, leftOf(c, r.qty), true); }
    const first = preset.addrs.length ? "panel" : preset.subs.length ? (need.subs.find((x) => x.code === preset.subs[0])?.procs[0] || "ยิง") : (need.parts.find((x) => x.code === preset.parts[0])?.dest || "CUTTING");
    setTab(first);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── สรุป + เตือน ──
  const lr = useMemo(() => lotRows(plan, need, sel, note), [plan, need, sel, note]);
  const nPanel = sel.addrs.size, nSub = sel.subs.size, nPart = sel.parts.size;
  const subSets = [...sel.subs.values()].reduce((a, b) => a + b, 0), partPcs = [...sel.parts.values()].reduce((a, b) => a + b, 0);
  const bySheetSel = SHEETS.map((s) => [s, s.kind === "panel" ? nPanel : s.kind === "part" ? need.parts.filter((p) => p.dest === s.k && sel.parts.get(p.code) > 0).length : need.subs.filter((x) => x.procs.includes(s.k) && sel.subs.get(x.code) > 0).length]).filter(([, n]) => n);
  const warns = useMemo(() => {
    const w = [];
    const noProcSel = need.subs.filter((s) => !s.procs.length && sel.subs.get(s.code) > 0);
    if (noProcSel.length) w.push(["block", `ซับ ${noProcSel.length} เบอร์ยังไม่ได้เลือกงาน (พับ/เชื่อม/ยิง/Site Item): ${noProcSel.slice(0, 5).map((s) => s.code).join(", ")} — ไม่ได้อยู่ในใบงานไหน`]);
    if (nPanel) {
      const pq = new Map(); for (const u of plan.units) if (sel.addrs.has(String(u.addr).toUpperCase())) pq.set(u.unit, (pq.get(u.unit) || 0) + 1);
      const noBom = [...pq.keys()].filter((u) => !findKey(plan.bom.panels, u));
      if (noBom.length) w.push(["warn", `แผง ${noBom.join(", ")} ยังไม่มี BOM — ได้ QR แผงแต่ตรวจประกอบไม่ได้`]);
      const ex = explodeFrom(plan.bom, pq, null);
      const short = [...ex.subs].filter(([c, qn]) => { const n = need.subs.find((x) => NC(x.code) === NC(c)); return n && doneOf(n.code) + (otherOf(rel, n.code)?.qty || 0) + (sel.subs.get(n.code) || 0) < qn - 1e-9; }).length
        + [...ex.parts].filter(([c, qn]) => { const n = need.parts.find((x) => NC(x.code) === NC(c)); return n && doneOf(n.code) + (otherOf(rel, n.code)?.qty || 0) + (sel.parts.get(n.code) || 0) < qn - 1e-9; }).length;
      if (short) w.push(["warn", `แผงที่เลือกใช้ซับ/พาร์ท ${short} เบอร์ที่ยังไม่ปล่อย (ทั้งในล็อตนี้และก่อนหน้า) — ประกอบได้เมื่อของมาครบ`]);
    }
    if (rel.lots.some((L) => roKey(L.no) === roKey(lotNo))) w.push(["block", `เลขล็อต ${lotNo} ใช้แล้ว — ใช้ ${nextLotNo(plan.ro, rel.lots)}`]);
    if (!/^P-\d+(\.\d+)?$/i.test(lotNo.trim())) w.push(["block", `เลขล็อตต้องเป็น ${plan.ro}.ตัวเลข หรือ ${plan.ro}`]);
    else if (roKey(lotNo).split(".")[0] !== roKey(plan.ro).split(".")[0]) w.push(["block", `เลขล็อตต้องขึ้นต้นด้วย ${plan.ro}`]);
    return w;
  }, [need, sel, nPanel, plan, doneOf, rel.lots, lotNo]);
  const blocked = warns.some((w) => w[0] === "block") || !lr.length;

  async function save() {
    if (blocked || busy) return;
    const soft = warns.filter((w) => w[0] === "warn");
    if (soft.length && !(await askConfirm({ title: "ปล่อยล็อตทั้งที่มีเรื่องควรดู?", message: soft.map((w) => "• " + w[1]).join("\n"), tone: "warn", confirmText: `ปล่อย ${lotNo}`, cancelText: "กลับไปแก้" }))) return;
    setBusy("เริ่มบันทึก…"); setErr([]);
    try {
      const res = await api.releaseLot({ plan, lotNo: lotNo.trim().toUpperCase(), date: dateToIso(date), userId: user?.id || null, rows: lr }, (m) => setBusy(m));
      setBusy("");
      await onSaved({ lotNo: lotNo.trim().toUpperCase(), rows: lr, res });
    } catch (e) { setBusy(""); setErr([e?.message || String(e)]); }
  }

  const lotsChip = (code) => { const e = rel.byCode.get(NC(code)); return e ? e.lots.map((l) => <Pill key={l} tone="info">{l}</Pill>) : null; };
  return (
    <>
      <div className="rl-back" onClick={() => !busy && onClose()} />
      <aside className="rl-drawer" role="dialog" aria-modal="true" aria-label="ปล่อยล็อตใหม่">
        <div className="rl-dr-head">
          <div className="rl-dr-title">
            <h2>ปล่อยล็อตใหม่</h2>
            <input className="input rw-mono rl-lotno" value={lotNo} onChange={(e) => setLotNo(e.target.value.toUpperCase())} aria-label="เลขล็อต" />
            {!rel.lots.some((L) => lotOf(L.no) === 0) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLotNo(plan.ro)} title="ปล่อยในเลข Release หลักเลย">ใช้เลข {plan.ro}</button> : null}
            <input className="input rl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="วันที่ล็อต" />
            <input className="input rl-note" value={note} placeholder="หมายเหตุ เช่น ปล่อยพาร์ทก่อน / ชั้น 25 ฝั่ง E" onChange={(e) => setNote(e.target.value)} aria-label="หมายเหตุล็อต" />
          </div>
          <button type="button" className="rl-x" onClick={onClose} aria-label="ปิด" disabled={!!busy}>×</button>
        </div>
        <p className="rl-dr-sub">เลือกสิ่งที่จะปล่อยรอบนี้ แยกตามใบงานที่ส่งไปทำ · ซับ 1 เบอร์ไปได้หลายใบ (ติ๊กงานในแถว) · พาร์ทเลือกได้ว่าไป MACHINING PART / BENDING / STEEL · ระบบหักของที่ปล่อยแล้ว ไม่ให้เกิน</p>
        <div className="rl-tabs grouped" role="tablist">
          {/* แท็บจัดกลุ่มตามหัว Total ใน Excel: Total Part (MACHINING PART · BENDING · STEEL) · Total Sub-Assembly (SUB A'ssy …) · แผง */}
          {[[TOTALS[0].label, "part"], [TOTALS[1].label, "sub"], ["แผง", "panel"]].filter(([, kind]) => kind !== "panel" || plan.units.length > 0).map(([lab, kind]) => (
            <div key={kind} className={`rl-tabgrp ${kind}`}>
              <span className="rl-tabgrp-lab">{lab}</span>
              <div className="rl-tabgrp-row">
                {SHEETS.filter((s) => s.kind === kind).map((s) => { const st = tabStat(s.k); return (
                  <button key={s.k} type="button" role="tab" aria-selected={tab === s.k} className={`rl-tab ${tab === s.k ? "on" : ""} ${s.kind}`} onClick={() => setTab(s.k)} title={s.label}>
                    <b>{s.tab}</b><small>เหลือ {nf(st.left)}{st.sel ? <em>เลือก {nf(st.sel)}</em> : null}</small>
                  </button>); })}
                {kind === "sub" && noProc.length ? <button type="button" role="tab" aria-selected={tab === "__none"} className={`rl-tab warn ${tab === "__none" ? "on" : ""}`} onClick={() => setTab("__none")}><b>ซับยังไม่เลือกงาน</b><small>{noProc.length} เบอร์</small></button> : null}
              </div>
            </div>))}
        </div>
        <div className="rl-tools">
          <input className="input rw-search" style={{ marginTop: 0 }} placeholder={sheet.kind === "panel" ? "ค้นหาที่อยู่ / Unit" : "ค้นหาเบอร์ / description"} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectAllVisible(true)}>☑ เลือกที่เหลือในหน้านี้</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectAllVisible(false)}>☐ ไม่เลือกในหน้านี้</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={selectEverything}>ปล่อยที่เหลือทั้งหมด (ทุกใบ)</button>
          <label className="rw-check" title="ติ๊กแผง/ซับแล้วเลือกซับ/พาร์ทที่อยู่ข้างในให้ด้วย (เท่าที่ยังเหลือ)"><input type="checkbox" checked={pull} onChange={(e) => setPull(e.target.checked)} /> เลือกแผง/ซับแล้วดึงลูกมาด้วย</label>
        </div>
        <div className="rl-sheetnote"><b>{tab === "__none" ? "ซับยังไม่เลือกงาน" : sheet.label}</b> <span className="rw-muted">— {tab === "__none" ? "ติ๊กงานอย่างน้อย 1 อย่าง ซับถึงจะอยู่ในใบงาน" : sheet.th}</span></div>
        <div className="table-wrap rw-tw rl-tw">
          <table className="data-table rw-table">
            {sheet.kind === "panel" && tab !== "__none" ? (
              <>
                <thead><tr><th style={{ width: 36 }} /><th>Address</th><th>Unit</th><th>BOM</th><th>สถานะ</th></tr></thead>
                <tbody>{rows.slice(0, 600).map((u) => { const a = String(u.addr).toUpperCase(); const done = rel.addrLot.get(a); const cx = need.cancelledAddr[a]; const on = sel.addrs.has(a); return (
                  <tr key={a} className={`${on ? "rl-sel" : ""} ${done || cx ? "rl-done" : ""} ${cx ? "rl-cancelrow" : ""}`}>
                    <td><input type="checkbox" checked={on} disabled={!!done || !!cx} onChange={(e) => toggleAddr([a], e.target.checked)} aria-label={`เลือก ${a}`} /></td>
                    <td className="rw-mono"><b className={cx ? "rl-cx" : ""}>{a}</b>{cx ? <> <Pill tone="bad">ยกเลิก {cx}</Pill></> : null}</td><td className="rw-mono">{u.unit}</td>
                    <td>{findKey(plan.bom.panels, u.unit) ? <Pill tone="ok">✓</Pill> : <Pill tone="warn">ไม่มี BOM</Pill>}</td>
                    <td>{done ? <Pill tone="info">ปล่อยแล้ว {done}</Pill> : cx ? <span className="rl-cxq small">ยกเลิกแล้ว</span> : <span className="rw-muted small">ยังไม่ปล่อย</span>}</td>
                  </tr>); })}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th style={{ width: 36 }} /><th className="r">NO.</th><th>CODE</th><th>DESCRIPTION</th><th className="r">LENGTH</th><th className="r">{sheet.kind === "part" ? "TOTAL QTY" : "SUB QTY."}</th>{sheet.kind === "part" ? <th>MATERIAL</th> : <th>UOM</th>}<th>{sheet.kind === "part" ? "ส่งไปใบ" : "งาน (ติ๊กได้หลายงาน)"}</th><th>ปล่อยแล้ว</th><th className="r">เหลือ</th><th className="r">ปล่อยรอบนี้</th></tr></thead>
                <tbody>{rows.slice(0, 600).map((r, ri) => {
                  const kind = sheet.kind === "part" ? "part" : "sub"; const m = kind === "sub" ? sel.subs : sel.parts;
                  const left = leftOf(r.code, r.qty); const cur = m.get(r.code) || 0; const on = cur > 0;
                  return (
                    <tr key={r.code} className={`${on ? "rl-sel" : ""} ${left <= 0 ? "rl-done" : ""} ${r.cancelled ? "rl-cancelrow" : ""}`}>
                      <td><input type="checkbox" checked={on} disabled={left <= 0} onChange={(e) => setQty(kind, r.code, r.qty, e.target.checked ? left : 0, true)} aria-label={`เลือก ${r.code}`} /></td>
                      <td className="r rw-muted">{ri + 1}</td>
                      <td className="rw-mono"><Code code={r.code} cancel={!!r.cancelled} added={r.added} />{isStar(r.code) ? <> <Pill tone="warn">*</Pill></> : null}</td>
                      <td className="rl-desc"><span>{r.d}</span></td>
                      <td className="r rw-num">{r.l ? nlen(r.l) : ""}</td>
                      <td className="r"><ModQty orig={r.orig} cur={r.qty} ver={r.modVer} cancel={!!r.cancelled} /></td>
                      {kind === "part" ? <td className="rw-mono rt-inv">{r.inv}</td> : <td className="rw-muted small">SET</td>}
                      <td>{kind === "part" ? (
                        <select className="select rw-cellsel rl-dest" value={r.dest} onChange={(e) => setDest(r.code, e.target.value)} aria-label={`ส่ง ${r.code} ไป`}>
                          {PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}
                        </select>
                      ) : (
                        <span className="rw-procs">{PROCS.map((p) => { const pon = r.procs.includes(p); return <label key={p} className={`rw-proc ${pon ? "on" : ""}`}><input type="checkbox" checked={pon} onChange={(e) => setProc(r.code, p, e.target.checked)} />{SUB_SHORT[p]}</label>; })}</span>
                      )}</td>
                      <td className="rl-donecell">{doneOf(r.code) ? <><b>{nlen(doneOf(r.code))}</b> {lotsChip(r.code)}</> : ""}{otherOf(rel, r.code) ? <Pill tone="ok" title={`ปล่อยไว้แล้วใน ${otherOf(rel, r.code).ros.join(", ")} ${nf(otherOf(rel, r.code).qty)} — ใช้เป็นเบอร์ลูก ไม่ต้องปล่อยใหม่`}>ใช้ของ {otherOf(rel, r.code).ros.join(", ")}</Pill> : null}</td>
                      <td className="r"><b>{left > 0 ? nlen(left) : "✓"}</b></td>
                      <td className="r">{left > 0 ? <input className="input rw-cell rl-qty" type="number" min="0" max={left} step="1" value={on ? cur : ""} placeholder={nlen(left)} onChange={(e) => setQty(kind, r.code, r.qty, e.target.value)} aria-label={`จำนวนปล่อย ${r.code}`} /> : null}</td>
                    </tr>); })}</tbody>
              </>
            )}
          </table>
          {rows.length > 600 ? <div className="rw-muted small" style={{ padding: 10 }}>แสดง 600 จาก {nf(rows.length)} — ค้นหาเพื่อดูที่เหลือ (ปุ่มเลือกทั้งหมดเลือกครบ)</div> : null}
          {!rows.length ? <div className="rw-muted small" style={{ padding: 14 }}>ไม่มีรายการในใบนี้</div> : null}
        </div>
        {warns.length ? <div className="rl-warns">{warns.map((w, i) => <div key={i} className={`rw-msg ${w[0] === "block" ? "bad" : "warn"}`}>{w[0] === "block" ? "✗" : "⚠"} {w[1]}</div>)}</div> : null}
        {err.length ? <div className="rw-msg bad">✗ บันทึกไม่สำเร็จ — {err.join(" · ")}</div> : null}
        <div className="rl-dr-foot">
          <div className="rl-sum">
            <b>ล็อต {lotNo}:</b> แผง {nf(nPanel)} · ซับ {nf(nSub)} เบอร์ ({nf(subSets)} SET) · พาร์ท {nf(nPart)} เบอร์ ({nf(partPcs)} ชิ้น)
            {bySheetSel.length ? <div className="rl-sum-chips">{bySheetSel.map(([s, n]) => <Pill key={s.k} tone={s.kind === "sub" ? "sub" : s.kind === "panel" ? "panel" : "part"}>{s.label} {n}</Pill>)}</div> : <div className="rw-muted small">ยังไม่ได้เลือกอะไร</div>}
          </div>
          <div className="rl-foot-btns">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>ยกเลิก</button>
            <button type="button" className="btn btn-accent" onClick={save} disabled={blocked || !!busy}>{busy || (lr.length ? `ปล่อย ${lotNo} + สร้าง QR` : "เลือกรายการที่จะปล่อยก่อน")}</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ══ Modify Release (แผงด้านขวา) ══
//   แก้ยอดต้องใช้ / ยกเลิกเบอร์ / ยกเลิกที่อยู่ (แผงที่ยังไม่ปล่อย) / เพิ่มเบอร์ใหม่ — 1 ครั้ง = 1 เลข M (M-001 …)
//   ของที่ปล่อยไปแล้วเกินยอดใหม่ → ลด/ยกเลิกในล็อตให้เอง (ล็อตล่าสุดก่อน) ผ่าน Modify เดิมของระบบ · จำนวนเดิมขีดฆ่าไว้ · เบอร์ที่ยกเลิกเป็นสีแดง
function ModifyDrawer({ plan, need, rel, api, user, onClose, onSaved }) {
  const [tab, setTab] = useState("part");
  const [q, setQ] = useState("");
  const [onlyChg, setOnlyChg] = useState(false);
  const [chg, setChg] = useState({});                 // "part|CODE" → { type: "qty"|"cancel", qty }
  const [addrs, setAddrs] = useState(() => new Set());  // ที่อยู่ที่จะยกเลิก
  const [adds, setAdds] = useState([]);
  const [bscope, setBscope] = useState("sub");          // แก้ BOM ลูกของ: ซับ / แผง
  const [bowner, setBowner] = useState("");
  const [bchg, setBchg] = useState({});                 // "scope|owner|idx" → { type:"qty"|"cancel"|"replace", qty, newCode }
  const [badds, setBadds] = useState([]);               // ลูกที่เพิ่มเข้า BOM ซับ/แผง
  const [bform, setBform] = useState({ kind: "part", code: "", qty: "", d: "" });
  const blankForm = { kind: "part", code: "", d: "", qty: "", l: "", inv: "", dest: "CUTTING", procs: "ยิง" };
  const [form, setForm] = useState(blankForm);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [verRaw, setVerRaw] = useState("");
  const [lim, setLim] = useState({ s: "loading", limits: new Map(), next: 0 });
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    api.lotLimits(plan, rel.lots.map((l) => l.no))
      .then((r) => { if (alive) setLim({ s: "ok", limits: r.limits || new Map(), next: r.nextNo || 0 }); })
      .catch((e) => { if (alive) setLim({ s: "err", limits: new Map(), next: 0, err: String(e?.message || e) }); });
    return () => { alive = false; };
  }, [api, plan, rel.lots]);
  useEffect(() => { const k = (e) => { if (e.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [busy, onClose]);

  const autoNo = nextModNo(plan, lim.next);
  const no = parseInt(verRaw, 10) > 0 ? parseInt(verRaw, 10) : autoNo;
  const ver = modVer(no);
  const verErr = (plan.mods || []).some((m) => m.no === no) ? `${ver} มีอยู่แล้ว — ใช้เลขอื่น` : no < lim.next ? `ล็อตบางล็อตใช้ถึง ${modVer(lim.next - 1)} แล้ว — ใช้ ${modVer(autoNo)} ขึ้นไป` : "";
  const key = (kind, code) => `${kind}|${code}`;
  const changes = useMemo(() => Object.entries(chg).map(([k, v]) => { const i = k.indexOf("|"); return { kind: k.slice(0, i), code: k.slice(i + 1), type: v.type, qty: v.qty }; })
    .filter((c) => c.type === "cancel" || (c.type === "qty" && String(c.qty).trim() !== "" && Number(c.qty) >= 0)), [chg]);
  const bomCol = (scope) => (scope === "panel" ? plan.bom.panels : plan.bom.subs);
  const edits = useMemo(() => {
    const out = [];
    for (const [k, v] of Object.entries(bchg)) {
      const [scope, owner, idx] = k.split("|"); const o = bomCol(scope)[findKey(bomCol(scope), owner)]; const it = o && o.items[Number(idx)]; if (!it) continue;
      const orig = it[6] != null ? it[6] : it[2];
      if (v.type === "cancel") out.push({ scope, owner, idx: Number(idx), type: "cancel", kind: it[0], code: it[1], before: it[2] });
      else if (v.type === "qty" && String(v.qty).trim() !== "" && Number(v.qty) >= 0 && Number(v.qty) !== it[2]) out.push({ scope, owner, idx: Number(idx), type: "qty", kind: it[0], code: it[1], before: it[2], qty: Number(v.qty), orig });
      else if (v.type === "replace" && String(v.newCode || "").trim() && NC(v.newCode) !== NC(it[1])) out.push({ scope, owner, idx: Number(idx), type: "replace", kind: it[0], code: it[1], before: it[2], newCode: v.newCode.trim().toUpperCase(), qty: String(v.qty ?? "").trim() === "" ? it[2] : Number(v.qty) });
    }
    for (const a of badds) out.push({ scope: a.scope, owner: a.owner, type: "add", kind: a.kind, code: a.code, qty: Number(a.qty), d: a.d, before: 0 });
    return out;
  }, [bchg, badds, plan]);                       // eslint-disable-line react-hooks/exhaustive-deps
  const bomFx = useMemo(() => (edits.length ? bomEditEffects(plan, edits) : { changes: [], adds: [] }), [plan, edits]);
  const manualCodes = new Set(changes.map((c) => NC(c.code)));
  const derivedChanges = bomFx.changes.filter((c) => !manualCodes.has(NC(c.code)));
  const derivedSet = new Set([...derivedChanges.map((c) => NC(c.code)), ...bomFx.adds.map((a) => NC(a.code))]);
  const ops = useMemo(() => modifyOps(need, rel, [...changes, ...derivedChanges], lim.limits), [need, rel, changes, derivedChanges.length, bomFx, lim.limits]);   // eslint-disable-line react-hooks/exhaustive-deps
  const itemOf = (code) => ops.items.find((x) => NC(x.code) === NC(code));
  const errOf = (code) => ops.errors.find((e) => e.startsWith(code + ":"));
  const noop = (c) => { const r = (c.kind === "sub" ? need.subs : need.parts).find((x) => NC(x.code) === NC(c.code)); return c.type === "qty" && r && Number(c.qty) === r.qty; };
  const realChanges = changes.filter((c) => !noop(c));
  const lotTouched = [...ops.lotOps.entries()].map(([lot, list]) => ({ lot, n: list.length, qr: list.reduce((s, o) => s + (o.type === "cancel" ? o.before - o.after : o.n), 0) }));
  const needAdmin = ops.lotOps.size > 0 && user && user.role && user.role !== "admin";
  const nChange = realChanges.length + addrs.size + adds.length + edits.length;
  const formErr = !form.code.trim() ? "" : need.parts.concat(need.subs).some((x) => NC(x.code) === NC(form.code)) || adds.some((a) => NC(a.code) === NC(form.code)) ? "เบอร์นี้มีอยู่แล้ว — ใช้ “แก้จำนวน” แทน" : !(Number(form.qty) > 0) ? "ใส่จำนวน" : "";
  const blockers = [
    !nChange && "ยังไม่ได้แก้อะไร",
    !reason.trim() && "ใส่เหตุผล (เช่น ลูกค้าแจ้งลดจำนวน / แบบ Rev B)",
    verErr,
    ops.errors.length && `${ops.errors.length} รายการลดไม่ได้ (ดูแถวสีแดง)`,
    needAdmin && "แก้ของที่ปล่อยแล้ว (ลด/ยกเลิกในล็อต) ต้องเป็นแอดมิน",
    lim.s === "loading" && ops.lotOps.size && "กำลังโหลดยอดที่ทำแล้วของล็อต…",
  ].filter(Boolean);

  const ql = q.trim().toUpperCase();
  const match = (...xs) => !ql || xs.some((x) => String(x || "").toUpperCase().includes(ql));
  const list = tab === "part" ? need.parts : tab === "sub" ? need.subs : [];
  const rows = list.filter((r) => match(r.code, r.d) && (!onlyChg || chg[key(tab, r.code)]?.type));
  const relQty = (code) => (rel.byCode.get(NC(code)) || { qty: 0 }).qty;
  const setRow = (kind, code, patch) => setChg((c) => { const k = key(kind, code); const nx = { ...(c[k] || {}), ...patch }; const o = { ...c }; if (!nx.type) delete o[k]; else o[k] = nx; return o; });
  const unitRows = plan.units.filter((u) => match(u.addr, u.unit));
  const tabCount = (k) => (k === "addr" ? addrs.size : k === "add" ? adds.length : k === "bom" ? edits.length : realChanges.filter((c) => c.kind === k).length);

  async function save() {
    if (blockers.length || busy) return;
    const mod = {
      no, ver, date, by: user?.name || "", at: new Date().toISOString(), reason: reason.trim(),
      bomEdits: edits,
      items: [
        ...ops.items.filter((it) => !(it.type === "qty" && it.before === it.after)).map((it) => (derivedSet.has(NC(it.code)) ? { ...it, derived: true } : it)),
        ...bomFx.adds.filter((a) => !manualCodes.has(NC(a.code))).map((a) => ({ kind: a.kind, type: "add", code: a.code, d: a.d, l: a.l, inv: a.inv, dest: a.kind === "part" ? ruleDest(ruleCat(a.code, "part"), a.code) : undefined, before: 0, after: a.qty, derived: true })),
        ...[...addrs].map((a) => ({ kind: "panel", type: "addr", code: a, unit: plan.units.find((u) => addrKey(u.addr) === a)?.unit || "", before: 1, after: 0 })),
        ...adds.map((a) => ({ kind: a.kind, type: "add", code: a.code.trim().toUpperCase(), d: a.d, l: a.l === "" ? null : Number(a.l), inv: a.inv, dest: a.dest, procs: a.procs, before: 0, after: Number(a.qty) })),
      ],
    };
    const qrOut = lotTouched.reduce((s, x) => s + x.qr, 0);
    const ok = await askConfirm({
      title: `บันทึก ${ver} ของ Release ${plan.ro}?`,
      message: [
        realChanges.filter((c) => c.type === "qty").length && `• แก้จำนวน ${realChanges.filter((c) => c.type === "qty").length} เบอร์`,
        realChanges.filter((c) => c.type === "cancel").length && `• ยกเลิก ${realChanges.filter((c) => c.type === "cancel").length} เบอร์`,
        addrs.size && `• ยกเลิกที่อยู่แผง ${addrs.size} ที่ (ยังไม่ได้ปล่อย)`,
        edits.length && `• แก้ BOM ลูกใน${[...new Set(edits.map((e) => (e.scope === "panel" ? "แผง " : "ซับ ") + e.owner))].join(", ")} — ${edits.length} จุด (ผลต่อยอดต้องใช้ทั้งใบ ${derivedSet.size} เบอร์)`,
        adds.length && `• เพิ่มเบอร์ใหม่ ${adds.length} เบอร์ (ปล่อยในล็อตถัดไป)`,
        lotTouched.length && `• แก้ในล็อต: ${lotTouched.map((x) => `${x.lot} (ยกเลิก QR ${nf(x.qr)} ใบ)`).join(" · ")} — QR ที่ยกเลิกเก็บเป็นหลักฐาน`,
        `\nเหตุผล: ${reason.trim()}`,
      ].filter(Boolean).join("\n"),
      tone: qrOut ? "danger" : "warn", confirmText: `บันทึก ${ver}`, cancelText: "กลับไปแก้",
    });
    if (!ok) return;
    setBusy("เริ่มบันทึก…"); setErr("");
    try {
      const np = await api.modifyRelease({ plan, mod, lotOps: ops.lotOps, docDate: date }, (m) => setBusy(m));
      setBusy("");
      await onSaved(np, mod);
    } catch (e) { setBusy(""); setErr(e?.message || String(e)); }
  }

  return (
    <>
      <div className="rl-back" onClick={() => !busy && onClose()} />
      <aside className="rl-drawer rm" role="dialog" aria-modal="true" aria-label={`Modify Release ${plan.ro}`}>
        <div className="rl-dr-head">
          <div className="rl-dr-title">
            <h2>Modify Release {plan.ro}</h2>
            <input className="input rw-mono rl-lotno" value={verRaw} placeholder={modVer(autoNo)} onChange={(e) => setVerRaw(e.target.value.replace(/[^0-9]/g, ""))} aria-label="เลข M (ว่าง = อัตโนมัติ)" title="เลข M — ว่าง = เลขถัดไปอัตโนมัติ" />
            <input className="input rl-date" type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} aria-label="วันที่ของ M ตามเอกสาร" />
            <input className="input rl-note" value={reason} placeholder="เหตุผล * เช่น ลูกค้าแจ้งลดจำนวน / แบบ Rev B" onChange={(e) => setReason(e.target.value)} aria-label="เหตุผลของการ Modify" />
          </div>
          <button type="button" className="rl-x" onClick={onClose} aria-label="ปิด" disabled={!!busy}>×</button>
        </div>
        <p className="rl-dr-sub">{ver}{verErr ? <b className="rl-errtxt"> · {verErr}</b> : null} · แก้ยอดต้องใช้ทั้งใบ / ยกเลิกเบอร์ / ยกเลิกที่อยู่แผงที่ยังไม่ปล่อย / เพิ่มเบอร์ใหม่ · ของที่ปล่อยแล้วเกินยอดใหม่ ระบบลด/ยกเลิกในล็อตให้ (ล็อตล่าสุดก่อน · ไม่ต่ำกว่าที่ทำแล้ว) · จำนวนเดิมขีดฆ่า · เบอร์ที่ยกเลิกเป็นสีแดง{lim.s === "err" ? ` · ⚠ อ่านยอดที่ทำแล้วไม่ได้ (${lim.err})` : ""}</p>
        <div className="rl-tabs" role="tablist">
          {[["part", "พาร์ท", need.parts.length], ["sub", "ซับ", need.subs.length], ["addr", "ที่อยู่แผง", plan.units.length], ["bom", "BOM ซับ/แผง", null], ["add", "เพิ่มเบอร์ใหม่", null]].map(([k, l, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rl-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
              <b>{l}</b><small>{n != null ? `${nf(n)} รายการ` : k === "bom" ? "แก้เบอร์/จำนวนลูก" : "เบอร์ที่ไม่มีใน BOM"}{tabCount(k) ? <em>แก้ {tabCount(k)}</em> : null}</small>
            </button>))}
        </div>
        {tab !== "add" && tab !== "bom" ? (
          <div className="rl-tools">
            <input className="input rw-search" style={{ marginTop: 0 }} placeholder={tab === "addr" ? "ค้นหาที่อยู่ / Unit" : "ค้นหาเบอร์ / description"} value={q} onChange={(e) => setQ(e.target.value)} />
            {tab !== "addr" ? <label className="rw-check"><input type="checkbox" checked={onlyChg} onChange={(e) => setOnlyChg(e.target.checked)} /> เฉพาะที่แก้</label> : null}
          </div>) : null}
        <div className="table-wrap rw-tw rl-tw">
          {tab === "part" || tab === "sub" ? (
            <table className="data-table rw-table">
              <thead><tr><th>Code</th><th>Description</th><th className="r">ต้องใช้</th><th className="r">ปล่อยแล้ว</th><th>การแก้</th><th className="r">ยอดใหม่</th><th>ผล</th></tr></thead>
              <tbody>{rows.slice(0, 500).map((r) => {
                const c = chg[key(tab, r.code)] || {}; const it = itemOf(r.code); const e = errOf(r.code); const done = relQty(r.code);
                const active = c.type && !(c.type === "qty" && (String(c.qty).trim() === "" || Number(c.qty) === r.qty));
                return (
                  <tr key={r.code} className={`${e ? "rl-errrow" : active ? "rl-sel" : ""} ${r.cancelled ? "rl-cancelrow" : ""}`}>
                    <td className="rw-mono"><Code code={r.code} cancel={!!r.cancelled || c.type === "cancel"} added={r.added} /></td>
                    <td className="rl-desc"><span>{r.d}</span></td>
                    <td className="r"><ModQty orig={r.orig} cur={r.qty} ver={r.modVer} cancel={!!r.cancelled} /></td>
                    <td className="r">{done ? nf(done) : ""}</td>
                    <td>{r.cancelled ? <span className="rw-muted small">ยกเลิกแล้ว</span> : (
                      <select className="select rw-cellsel rl-modsel" value={c.type || ""} onChange={(ev) => setRow(tab, r.code, { type: ev.target.value || undefined, qty: ev.target.value === "qty" ? (c.qty ?? String(r.qty)) : c.qty })} aria-label={`การแก้ ${r.code}`}>
                        <option value="">—</option><option value="qty">แก้จำนวน</option><option value="cancel">ยกเลิกเบอร์</option>
                      </select>)}</td>
                    <td className="r">{c.type === "qty" ? <input className="input rw-cell rl-qty" type="number" min="0" step="1" value={c.qty ?? ""} onChange={(ev) => setRow(tab, r.code, { qty: ev.target.value })} aria-label={`ยอดใหม่ ${r.code}`} /> : c.type === "cancel" ? <b className="rl-errtxt">0</b> : null}</td>
                    <td className="rl-res">{e ? <span className="rl-errtxt">✗ {e.slice(r.code.length + 1).trim()}</span> : active && it ? (
                      <>{it.type === "cancel" ? <>ยกเลิก <span className="rl-cxq">{nf(it.before)}</span></> : <><s className="rl-old">{nf(it.before)}</s> → <b className="rl-new">{nf(it.after)}</b></>}
                        {it.lots.map((l) => <div key={l.lot} className="rw-muted small">{l.lot}: {l.cancel ? <><span className="rl-cxq">{nf(l.before)}</span> ยกเลิก</> : <><s>{nf(l.before)}</s> → {nf(l.after)}</>} (QR −{nf(l.before - l.after)})</div>)}
                        {it.type === "qty" && it.after > done && done > 0 ? <div className="rw-muted small">เหลือปล่อยเพิ่ม {nf(it.after - done)}</div> : null}</>
                    ) : null}</td>
                  </tr>); })}</tbody>
            </table>
          ) : tab === "addr" ? (
            <table className="data-table rw-table">
              <thead><tr><th style={{ width: 36 }} /><th>Address</th><th>Unit</th><th>สถานะ</th></tr></thead>
              <tbody>{unitRows.slice(0, 600).map((u) => { const a = addrKey(u.addr); const lot = rel.addrLot.get(a); const cx = need.cancelledAddr[a]; const on = addrs.has(a); return (
                <tr key={a} className={`${on ? "rl-errrow" : ""} ${cx ? "rl-cancelrow" : ""}`}>
                  <td><input type="checkbox" checked={on || !!cx} disabled={!!lot || !!cx} onChange={(ev) => setAddrs((s) => { const n = new Set(s); if (ev.target.checked) n.add(a); else n.delete(a); return n; })} aria-label={`ยกเลิก ${a}`} /></td>
                  <td className="rw-mono"><b className={on || cx ? "rl-cx" : ""}>{a}</b>{cx ? <> <Pill tone="bad">ยกเลิก {cx}</Pill></> : on ? <> <Pill tone="bad">ยกเลิกใน {ver}</Pill></> : null}</td>
                  <td className="rw-mono">{u.unit}</td>
                  <td>{lot ? <span className="rw-muted small">ปล่อยแล้วใน {lot} — ยกเลิกแผงที่ปล่อยแล้วทำที่หน้า Release Order {lot} (เลือก QR)</span> : cx ? null : <span className="rw-muted small">ยังไม่ปล่อย</span>}</td>
                </tr>); })}</tbody>
            </table>
          ) : tab === "bom" ? (
            <div className="rl-bomedit">
              <div className="rl-tools">
                <select className="select" value={bscope} onChange={(e) => { setBscope(e.target.value); setBowner(""); }} aria-label="แก้ BOM ของ"><option value="sub">แก้ลูกในซับ</option><option value="panel">แก้ลูกในแผง</option></select>
                <select className="select rw-mono" value={bowner} onChange={(e) => setBowner(e.target.value)} aria-label="เลือกซับ/แผง" style={{ minWidth: 260 }}>
                  <option value="">— เลือก{bscope === "panel" ? "แบบแผง" : "ซับ"} —</option>
                  {(bscope === "panel" ? need.panels.map((x) => ({ code: x.code, d: x.d, n: x.qty })) : need.subs.filter((x) => x.hasBom && !x.cancelled).map((x) => ({ code: x.code, d: x.d, n: x.qty })))
                    .map((o) => <option key={o.code} value={o.code}>{o.code} · ใช้ {nf(o.n)}{bscope === "panel" ? " ใบ" : " ชุด"}{o.d ? ` · ${o.d}` : ""}</option>)}
                </select>
                <span className="rw-muted small">{bscope === "panel" ? "แก้ BOM แผง = มีผลกับแผงทุกใบของแบบนั้น" : "แก้ BOM ซับ = มีผลกับทุกที่ที่ใช้ซับนี้"} · ระบบคำนวณยอดต้องใช้ทั้งใบใหม่ให้เอง และลดในล็อตที่ปล่อยแล้ว</span>
              </div>
              {bowner ? (() => {
                const col = bomCol(bscope); const ok = findKey(col, bowner); const items = ok ? col[ok].items || [] : [];
                const dOf = (t, c) => { const m = t === "sub" ? plan.bom.subs : plan.bom.parts; const k = findKey(m, c); return k ? m[k].d || "" : ""; };
                return (
                  <>
                    <table className="data-table rw-table">
                      <thead><tr><th>ชนิด</th><th>เบอร์ลูก</th><th>Description</th><th className="r">จำนวน/ชุด</th><th>การแก้</th><th>ค่าใหม่</th></tr></thead>
                      <tbody>{items.map((it, idx) => {
                        const k = `${bscope}|${ok}|${idx}`; const c = bchg[k] || {}; const cx = it[4] === "ยกเลิก"; const orig = it[6] != null ? it[6] : null;
                        const set = (patch) => setBchg((o) => { const nx = { ...(o[k] || {}), ...patch }; const r = { ...o }; if (!nx.type) delete r[k]; else r[k] = nx; return r; });
                        return (
                          <tr key={idx} className={`${cx ? "rl-cancelrow" : ""} ${c.type ? "rl-sel" : ""}`}>
                            <td>{it[0] === "sub" ? "ซับ" : "พาร์ท"}</td>
                            <td className="rw-mono"><Code code={it[1]} cancel={cx || c.type === "cancel" || c.type === "replace"} added={it[8] === "add" ? it[5] : null} />{cx && it[7] ? <> → <b>{it[7]}</b></> : null}{cx && !it[7] ? <> <Pill tone="bad">ยกเลิก {it[5]}</Pill></> : null}</td>
                            <td className="rl-desc"><span>{dOf(it[0], it[1])}</span></td>
                            <td className="r">{cx ? <span className="rl-cxq">{nf(orig ?? it[2])}</span> : orig != null && orig !== it[2] ? <ModQty orig={orig} cur={it[2]} ver={it[5]} /> : nf(it[2], it[2] % 1 ? 2 : 0)}</td>
                            <td>{cx ? <span className="rw-muted small">แก้ไปแล้ว {it[5]}</span> : (
                              <select className="select rw-cellsel rl-modsel" value={c.type || ""} onChange={(e) => set({ type: e.target.value || undefined, qty: e.target.value === "qty" ? (c.qty ?? String(it[2])) : c.qty })} aria-label={`การแก้ ${it[1]}`}>
                                <option value="">—</option><option value="qty">แก้จำนวน</option><option value="replace">แก้เบอร์ (แทนด้วยเบอร์อื่น)</option><option value="cancel">ยกเลิกลูกนี้</option>
                              </select>)}</td>
                            <td>{c.type === "qty" ? <input className="input rw-cell rl-qty" type="number" min="0" step="any" value={c.qty ?? ""} onChange={(e) => set({ qty: e.target.value })} aria-label={`จำนวนใหม่ ${it[1]}`} />
                              : c.type === "replace" ? <span className="rl-addform"><input className="input rw-mono" placeholder="เบอร์ใหม่ *" value={c.newCode || ""} onChange={(e) => set({ newCode: e.target.value.toUpperCase() })} aria-label={`เบอร์ใหม่แทน ${it[1]}`} /><input className="input rw-cell rl-qty" type="number" min="0" step="any" placeholder={String(it[2])} value={c.qty ?? ""} onChange={(e) => set({ qty: e.target.value })} aria-label="จำนวนของเบอร์ใหม่" /></span>
                              : c.type === "cancel" ? <b className="rl-errtxt">ยกเลิก</b> : null}</td>
                          </tr>); })}</tbody>
                    </table>
                    <div className="rl-addform" style={{ padding: 10 }}>
                      <b className="small">เพิ่มลูกใน {bowner}:</b>
                      <select className="select" value={bform.kind} onChange={(e) => setBform({ ...bform, kind: e.target.value })} aria-label="ชนิดลูก"><option value="part">พาร์ท</option><option value="sub">ซับ</option></select>
                      <input className="input rw-mono" placeholder="เบอร์ลูก *" value={bform.code} onChange={(e) => setBform({ ...bform, code: e.target.value.toUpperCase() })} aria-label="เบอร์ลูกที่เพิ่ม" />
                      <input className="input" placeholder="Description" value={bform.d} onChange={(e) => setBform({ ...bform, d: e.target.value })} aria-label="Description ลูก" />
                      <input className="input" type="number" min="0" step="any" placeholder="จำนวน/ชุด *" value={bform.qty} onChange={(e) => setBform({ ...bform, qty: e.target.value })} aria-label="จำนวนลูกที่เพิ่ม" />
                      <button type="button" className="btn btn-accent btn-sm" disabled={!bform.code.trim() || !(Number(bform.qty) > 0)} onClick={() => { setBadds((a) => [...a, { ...bform, scope: bscope, owner: ok, code: bform.code.trim().toUpperCase() }]); setBform({ kind: "part", code: "", qty: "", d: "" }); }}><Icon name="plus" size={13} /> เพิ่ม</button>
                    </div>
                  </>);
              })() : <div className="rw-muted small" style={{ padding: 12 }}>เลือกซับหรือแบบแผงด้านบน แล้วแก้เบอร์ / จำนวนของลูกแต่ละตัวได้ · เพิ่มลูกใหม่ · ยกเลิกลูก</div>}
              {badds.length ? (
                <table className="data-table rw-table">
                  <thead><tr><th>เพิ่มใน</th><th>ลูก</th><th className="r">จำนวน/ชุด</th><th /></tr></thead>
                  <tbody>{badds.map((a, i) => <tr key={i}><td className="rw-mono">{a.scope === "panel" ? "แผง" : "ซับ"} {a.owner}</td><td className="rw-mono"><b>{a.code}</b> <Pill tone="mod">เพิ่ม {ver}</Pill></td><td className="r">{nf(Number(a.qty), 2)}</td><td><button type="button" className="rw-x" onClick={() => setBadds((x) => x.filter((_, j) => j !== i))} aria-label={`เอา ${a.code} ออก`}>×</button></td></tr>)}</tbody>
                </table>) : null}
              {edits.length ? (
                <div className="rl-bomfx">
                  <b className="small">ผลต่อยอดต้องใช้ทั้งใบ ({derivedSet.size} เบอร์)</b>
                  {ops.items.filter((it) => derivedSet.has(NC(it.code))).map((it) => <div key={it.code} className="small"><span className="rw-mono"><Code code={it.code} cancel={it.type === "cancel"} /></span> {it.type === "cancel" ? <>ยกเลิก <span className="rl-cxq">{nf(it.before)}</span></> : <><s className="rl-old">{nf(it.before)}</s> → <b className="rl-new">{nf(it.after)}</b></>}{it.lots.map((l) => <span key={l.lot} className="rw-muted"> · {l.lot}: {l.cancel ? "ยกเลิก" : `${nf(l.before)} → ${nf(l.after)}`}</span>)}{errOf(it.code) ? <span className="rl-errtxt"> ✗ {errOf(it.code).slice(it.code.length + 1)}</span> : null}</div>)}
                  {bomFx.adds.map((a) => <div key={a.code} className="small"><span className="rw-mono"><b>{a.code}</b></span> <Pill tone="mod">เพิ่ม {ver}</Pill> {nf(a.qty)}</div>)}
                </div>) : null}
            </div>
          ) : (
            <div className="rl-addbox">
              <div className="rl-addform">
                <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="ชนิด"><option value="part">พาร์ท</option><option value="sub">ซับ</option></select>
                <input className="input rw-mono" placeholder="Code *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} aria-label="Code" />
                <input className="input" placeholder="Description" value={form.d} onChange={(e) => setForm({ ...form, d: e.target.value })} aria-label="Description" />
                <input className="input" type="number" min="1" placeholder="จำนวน *" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="จำนวน" />
                <input className="input" type="number" min="0" placeholder="ยาว (มม.)" value={form.l} onChange={(e) => setForm({ ...form, l: e.target.value })} aria-label="ความยาว" />
                {form.kind === "part" ? <input className="input rw-mono" placeholder="INV" value={form.inv} onChange={(e) => setForm({ ...form, inv: e.target.value.toUpperCase() })} aria-label="INV" /> : null}
                {form.kind === "part"
                  ? <select className="select" value={form.dest} onChange={(e) => setForm({ ...form, dest: e.target.value })} aria-label="ใบงาน">{PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}</select>
                  : <select className="select" value={form.procs} onChange={(e) => setForm({ ...form, procs: e.target.value })} aria-label="งานซับ">{PROCS.map((p) => <option key={p} value={p}>SUB {SUB_SHORT[p]}</option>)}</select>}
                <button type="button" className="btn btn-accent btn-sm" disabled={!form.code.trim() || !!formErr} onClick={() => { setAdds((a) => [...a, { ...form, code: form.code.trim().toUpperCase() }]); setForm(blankForm); }}><Icon name="plus" size={13} /> เพิ่ม</button>
              </div>
              {formErr ? <div className="rw-msg warn">{formErr}</div> : null}
              {adds.length ? (
                <table className="data-table rw-table">
                  <thead><tr><th>ชนิด</th><th>Code</th><th>Description</th><th className="r">จำนวน</th><th>ใบงาน</th><th /></tr></thead>
                  <tbody>{adds.map((a, i) => <tr key={a.code}><td>{a.kind === "sub" ? "ซับ" : "พาร์ท"}</td><td className="rw-mono"><b>{a.code}</b> <Pill tone="mod">เพิ่ม {ver}</Pill></td><td className="rw-desc">{a.d}</td><td className="r">{nf(Number(a.qty))}</td><td>{a.kind === "sub" ? `SUB ${SUB_SHORT[a.procs]}` : a.dest}</td><td><button type="button" className="rw-x" onClick={() => setAdds((x) => x.filter((_, j) => j !== i))} aria-label={`เอา ${a.code} ออก`}>×</button></td></tr>)}</tbody>
                </table>
              ) : <div className="rw-muted small" style={{ padding: 12 }}>เบอร์ที่ไม่มีใน BOM เดิม (เช่นแบบ Rev ใหม่เพิ่มพาร์ท) — เพิ่มแล้วจะอยู่ในยอดคงเหลือ ปล่อยในล็อตถัดไป</div>}
            </div>
          )}
        </div>
        {err ? <div className="rw-msg bad">✗ {err}</div> : null}
        <div className="rl-dr-foot">
          <div className="rl-sum">
            <b>{ver}:</b> แก้จำนวน {realChanges.filter((c) => c.type === "qty").length} · ยกเลิกเบอร์ {realChanges.filter((c) => c.type === "cancel").length} · ยกเลิกที่อยู่ {addrs.size} · แก้ BOM ลูก {edits.length} · เพิ่ม {adds.length}
            {lotTouched.length ? <div className="rl-sum-chips">{lotTouched.map((x) => <Pill key={x.lot} tone="bad">{x.lot}: QR −{nf(x.qr)}</Pill>)}</div> : null}
            {blockers.length ? <div className="rw-muted small">{blockers.join(" · ")}</div> : null}
          </div>
          <div className="rl-foot-btns">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>ยกเลิก</button>
            <button type="button" className="btn btn-accent" onClick={save} disabled={!!blockers.length || !!busy}>{busy || `บันทึก ${ver}`}</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ══ การ์ด "Release ที่ยังปล่อยไม่ครบ" (หน้ารายการปล่อยงาน) ══
export function ReleasePlansCard({ plans, releases, onOpen }) {
  const rows = useMemo(() => (plans || []).map((p) => {
    const need = needOf(p); const rel = releasedOf(releases, p);
    const live = p.units.filter((u) => !need.cancelledAddr[addrKey(u.addr)]);
    const addr = live.filter((u) => rel.addrLot.has(String(u.addr).toUpperCase())).length;
    const left = need.parts.filter((x) => (rel.byCode.get(NC(x.code))?.qty || 0) < x.qty).length + need.subs.filter((x) => (rel.byCode.get(NC(x.code))?.qty || 0) < x.qty).length + (live.length - addr);
    return { p, need, rel, addr, left };
  }).sort((a, b) => ncmp(b.p.ro, a.p.ro)), [plans, releases]);
  if (!rows.length) return null;
  return (
    <div className="card rl-planscard">
      <div className="card-head"><div><div className="card-title">Release ที่ยังปล่อยไม่ครบ</div><div className="card-sub">บันทึกแล้ว · เลือกปล่อยเป็นล็อต P-xxx.1 / .2 … ได้ทีละส่วน</div></div></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Release</th><th>โปรเจค</th><th>วันที่</th><th style={{ textAlign: "right" }}>แผงปล่อยแล้ว</th><th style={{ textAlign: "right" }}>ล็อต</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{rows.map(({ p, rel, addr, left }) => (
            <tr key={p.id || p.ro} className="release-row" onClick={() => onOpen(p)}>
              <td><b>{p.ro}</b>{p.note ? <span className="rw-muted"> · {p.note}</span> : null}{p.mods?.length ? <> <Pill tone="mod">{p.mods[p.mods.length - 1].ver}</Pill></> : null}</td>
              <td>{p.projectCode}</td><td>{fmtD(p.date)}</td>
              <td style={{ textAlign: "right" }}>{nf(addr)} / {nf(p.units.filter((u) => !(p.cancelAddr || {})[addrKey(u.addr)]).length)}</td>
              <td style={{ textAlign: "right" }}>{rel.lots.length ? rel.lots.map((l) => l.no.replace(p.ro, "")).join(" ") || p.ro : "—"}</td>
              <td>{left ? <Pill tone="warn">เหลือ {nf(left)} รายการ</Pill> : <Pill tone="ok">ปล่อยครบ</Pill>}</td>
              <td><span className="rw-link">เปิด →</span></td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ★ วัสดุของล็อต (ใบเบิก · ไม่มี QR) — วัตถุดิบงานตัด · GLASS · ACCESSORIES · อื่นๆ (เฉพาะของที่ปล่อยในล็อตนี้)
const hwQ = (h) => (h.u === "m." && h.mm ? h.qty / 1000 : h.qty);
// เศษ ≥ 500 มม.: ความยาวซ้ำรวมกัน → "1,230 ×2 · 640"
const offTxt = (lens) => { const m = new Map(); for (const x of lens || []) m.set(x, (m.get(x) || 0) + 1); return [...m].map(([l, n]) => `${nf(l)}${n > 1 ? ` ×${n}` : ""}`).join(" · "); };
function LotMats({ plan, need, lot, sheetsOf }) {
  const m = useMemo(() => lotMaterials(plan, need, lot.rows, sheetsOf), [plan, need, lot]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cards = [];
  if (m.mat.length) cards.push(
    <section key="mat" className="rl-sc mat wide">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>วัตถุดิบงานตัด</b><span>MATERIAL LIST FOR CUTTING · จากพาร์ท MACHINING ในล็อต</span></div>
        <div className="rl-sc-n"><b>{nf(m.mat.reduce((a, x) => a + x.bars, 0))}</b> เส้น<small> · {nf(m.mat.length)} รายการ · เศษ {nf(m.mat.reduce((a, x) => a + x.off, 0))} ชิ้น</small></div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>วัตถุดิบ (INV)</th><th>รายละเอียด</th><th className="r">ยาวเส้น</th><th className="r">ใช้กับ</th><th className="r">เส้น</th><th className="r" title="เศษที่เหลือยาว ≥ 500 มม. หลังตัดล็อตนี้ (เก็บใช้ต่อได้) · คิดแบบเส้นใหม่ทุกล็อต">เศษ ≥ 500 มม.</th></tr></thead>
        <tbody>{m.mat.map((x) => (
          <tr key={x.inv || "—"}>
            <td className="rl-sc-code">{x.inv || <span className="rl-cxq">ไม่มี INV</span>}</td>
            <td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td>
            <td className="r rl-sc-q rl-sc-thin">{nf(x.stock)}{x.src === "default" ? <> <Pill tone="warn" title="ไม่รู้ความยาวเส้น — ใช้ค่าเริ่ม">?</Pill></> : null}</td>
            <td className="r rl-sc-q rl-sc-thin" title={x.parts.map((p) => `${p.code} × ${p.qty}`).join("\n")}>{nf(x.parts.length)} เบอร์ · {nf(x.pcs)} ชิ้น{x.noLen ? <> <Pill tone="warn" title="พาร์ทไม่มีความยาวใน BOM — ไม่ได้นับในเส้น">ไม่มียาว {nf(x.noLen)}</Pill></> : null}{x.over ? <> <Pill tone="bad">ยาวกว่าเส้น {nf(x.over)}</Pill></> : null}</td>
            <td className="r rl-sc-q">{nf(x.bars)}</td>
            <td className="r rl-sc-off" title={x.off ? `เศษ ${x.off} ชิ้น (มม.): ${offTxt(x.offLens)}` : "ไม่มีเศษยาว ≥ 500 มม."}>{x.off ? <><b>{nf(x.off)}</b><small>{offTxt(x.offLens)}</small></> : <span className="rw-muted">—</span>}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="rl-sc-foot">คิดแบบเส้นใหม่ทุกล็อต (ไม่นับเศษจากล็อตก่อน) · เศษ = ความยาวที่เหลือหลังตัด ≥ 500 มม. (หักรอยตัดแล้ว) เก็บไว้ใช้ต่อได้</div>
    </section>);
  if (m.glass.length) cards.push(
    <section key="glass" className="rl-sc mat">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>GLASS</b><span>กระจก · จาก BOM แผง/ซับในล็อต</span></div>
        <div className="rl-sc-n"><b>{nf(m.glass.reduce((a, x) => a + x.qty, 0))}</b> แผ่น<small> · {nf(m.glass.length)} เบอร์</small></div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>เบอร์ (CODE)</th><th>รายละเอียด</th><th className="r">ขนาด (มม.)</th><th className="r">จำนวน</th></tr></thead>
        <tbody>{m.glass.map((x) => (
          <tr key={x.code}><td className="rl-sc-code">{x.code}</td><td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td>
            <td className="r rl-sc-q rl-sc-thin">{x.l || x.h ? `${nlen(x.l) || "?"} × ${nlen(x.h) || "?"}` : "—"}</td><td className="r rl-sc-q">{nf(x.qty)}</td></tr>))}</tbody>
      </table></div>
    </section>);
  if (m.hw.length) cards.push(
    <section key="hw" className="rl-sc mat">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>ACCESSORIES</b><span>FASTENER, GASKET &amp; SILICONE · จาก BOM แผง/ซับในล็อต</span></div>
        <div className="rl-sc-n"><b>{nf(m.hw.length)}</b> รายการ</div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>เบอร์ (CODE)</th><th>รายละเอียด</th><th className="r">จำนวน</th></tr></thead>
        <tbody>{m.hw.map((x) => (
          <tr key={x.code}><td className="rl-sc-code">{x.code}</td><td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td>
            <td className="r rl-sc-q">{x.u === "m." || x.u === "mm." ? nlen(Math.round(hwQ(x) * 100) / 100) : nf(hwQ(x))} <small className="rw-muted">{x.u || (x.mm ? "mm." : "pcs.")}</small></td></tr>))}</tbody>
      </table></div>
    </section>);
  if (m.other.length) cards.push(
    <section key="other" className="rl-sc mat">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>อื่นๆ</b><span>VENT / ENCLOS / ที่ไม่มี QR</span></div><div className="rl-sc-n"><b>{nf(m.other.length)}</b> รายการ</div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>เบอร์ (CODE)</th><th>รายละเอียด</th><th className="r">จำนวน</th></tr></thead>
        <tbody>{m.other.map((x) => <tr key={x.code}><td className="rl-sc-code">{x.code}</td><td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td><td className="r rl-sc-q">{nf(x.qty)}</td></tr>)}</tbody>
      </table></div>
    </section>);
  return (
    <div className="rl-lot-mats">
      <div className="rl-lot-mats-h"><b>วัสดุของล็อตนี้</b><span>ใบเบิก · ไม่มี QR · คิดเฉพาะของที่ปล่อยในล็อต {lot.no}</span></div>
      {cards.length ? <div className="rl-sc-grid">{cards}</div> : <div className="rw-muted small rl-lot-mats-empty">ล็อตนี้ไม่มีวัสดุเบิก (ไม่มีพาร์ท MACHINING และ BOM ของแผง/ซับในล็อตไม่มีกระจก / อุปกรณ์)</div>}
    </div>);
}
