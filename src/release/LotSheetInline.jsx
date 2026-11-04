// ★ 2026-11-04 ใบปล่อยของล็อต "ดูในหน้าล็อตเลย + แก้ได้" (ผู้ใช้: "ตารางนี้ให้ดูอยู่ข้างนอกได้ไหม และแก้ด้วย")
//   ตารางเดียวกับใบที่พิมพ์ (buildLotModel) · แก้ได้เฉพาะช่อง REMARK / สั่งตัดเพิ่ม / REV. / ADDRESS
//   ที่แก้เก็บใน plan.sheetEdit[ล็อต][ใบ][rowId][คอลัมน์] → ใบพิมพ์ / Excel ใช้ค่าที่แก้ทันที (ไม่แตะจำนวน/QR)
import { useEffect, useMemo, useState } from "react";
import { getLang } from "../i18n-dom.js";
import { needOf, releasedOf, roKey, inPlan } from "./releaseCore.js";
import { buildLotModel } from "./lotSheetExport.js";
import "./release-wizard.css";

export default function LotSheetInline({ api, projectId, ro, releases, userName, onOpenPrint }) {
  const [plan, setPlan] = useState(null);
  const [state, setState] = useState("loading");
  const [key, setKey] = useState(null);
  const [draft, setDraft] = useState({});   // { [sheetKey]: { [rowId]: { [colIdx]: text } } } ของล็อตนี้
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  const lang = getLang();
  const L = (th, en) => (lang === "en" ? en : th);

  useEffect(() => {
    let alive = true; setState("loading");
    (async () => {
      try {
        const { plans } = await api.listPlans(projectId);
        const p = (plans || []).find((x) => inPlan(ro, x.ro));
        if (!alive) return;
        if (!p) { setState("none"); return; }
        setPlan(p); setDraft(((p.sheetEdit || {})[lotNoOf(p, ro)]) || {}); setState("ok");
      } catch { if (alive) setState("none"); }
    })();
    return () => { alive = false; };
  }, [api, projectId, ro]);

  const ctx = useMemo(() => {
    if (!plan) return null;
    const need = needOf(plan); const rel = releasedOf(releases, plan);
    const lot = rel.lots.find((l) => roKey(l.no) === roKey(ro)); if (!lot) return null;
    const planX = { ...plan, sheetEdit: { ...(plan.sheetEdit || {}), [lot.no]: draft } };
    const model = buildLotModel({ plan: planX, need, lot, userName, printDate: new Date(), lang });
    return { need, lot, model };
  }, [plan, releases, ro, draft, userName, lang]);

  if (state === "loading") return <div className="card rl-inl"><div className="rw-muted small">{L("กำลังโหลดใบปล่อย…", "Loading release sheet…")}</div></div>;
  if (state !== "ok" || !ctx) return null;   // ล็อตเก่า (ไม่มีแผนแบบใหม่) = ไม่แสดง
  const sheets = ctx.model.sheets; if (!sheets.length) return null;
  const sh = sheets.find((x) => x.key === key) || sheets[0];
  const saved = ((plan.sheetEdit || {})[ctx.lot.no]) || {};
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const nEdit = Object.values(draft).reduce((a, s) => a + Object.values(s).reduce((b, r) => b + Object.keys(r).length, 0), 0);

  const setCell = (rowId, ci, v) => setDraft((d) => {
    const s = { ...(d[sh.key] || {}) }; const r = { ...(s[rowId] || {}) };
    r[ci] = v; s[rowId] = r; return { ...d, [sh.key]: s };
  });
  const resetRow = (rowId) => setDraft((d) => { const s = { ...(d[sh.key] || {}) }; delete s[rowId]; return { ...d, [sh.key]: s }; });
  async function save() {
    if (saving) return; setSaving("…"); setMsg("");
    try {
      const clean = {}; for (const [k, s] of Object.entries(draft)) { const rows = Object.fromEntries(Object.entries(s).filter(([, r]) => Object.keys(r).length)); if (Object.keys(rows).length) clean[k] = rows; }
      const next = { ...plan, sheetEdit: { ...(plan.sheetEdit || {}), [ctx.lot.no]: clean } };
      const r = await api.updatePlan(next);
      if (r && r.ok === false) throw new Error(r.reason || "save");
      setPlan(next); setDraft(clean); setMsg(L("✓ บันทึกแล้ว — ใบพิมพ์ / Excel ใช้ค่าที่แก้", "✓ Saved — print / Excel use the edited values"));
    } catch (e) { setMsg(L("บันทึกไม่สำเร็จ: ", "Save failed: ") + (e?.message || e)); }
    setSaving("");
  }

  return (
    <div className="card rl-inl">
      <div className="rl-inl-h">
        <div><b>{L("ใบปล่อยของล็อต", "Lot release sheet")} {ctx.lot.no}</b>
          <span className="rw-muted small">{L(" · ดู/แก้ได้ที่นี่ · แก้ได้เฉพาะช่องสีเหลือง (REMARK · สั่งตัดเพิ่ม · REV. · ที่อยู่)", " · view / edit here · only yellow cells are editable (REMARK · extra cut · REV. · address)")}</span></div>
        <div className="rl-inl-acts">
          {dirty ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(saved)}>{L("ยกเลิกที่แก้", "Discard")}</button> : null}
          <button type="button" className="btn btn-accent btn-sm" onClick={save} disabled={!dirty || !!saving}>{saving ? L("กำลังบันทึก…", "Saving…") : L("บันทึกที่แก้", "Save edits")}{nEdit && !dirty ? ` (${nEdit})` : ""}</button>
          {onOpenPrint ? <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenPrint} disabled={dirty} title={dirty ? L("บันทึกก่อนพิมพ์", "Save before printing") : undefined}>🖨 {L("พิมพ์ / PDF / Excel", "Print / PDF / Excel")}</button> : null}
        </div>
      </div>
      {msg ? <div className={`rw-msg ${msg.startsWith("✓") ? "ok" : "bad"}`} style={{ marginTop: 0, marginBottom: 8 }}>{msg}</div> : null}
      <div className="rl-inl-tabs">
        {sheets.map((x) => <button key={x.key} type="button" className={x.key === sh.key ? "on" : ""} onClick={() => setKey(x.key)}>{x.tab}<small>{x.rows.filter((r) => !r.kid).length}</small></button>)}
      </div>
      {/* หัวใบเหมือนใบที่พิมพ์ */}
      <div className="rl-inl-paper">
        <div className="rl-inl-top">
          <div className="logo"><img src={`${(import.meta.env && import.meta.env.BASE_URL) || "/"}brand/artclad-company.png`} alt="ARTCLAD" /></div>
          <div className="ttl"><b>PRODUCTION ORDER</b>{sh.line2 ? <><br /><b className="s">{sh.line2}</b></> : null}</div>
          <div className="rpt">RPT:<br />REV:</div>
        </div>
        <div className="rl-inl-meta">
          <div>Release Order : <b>{ctx.model.meta.ro}</b><br />Project : <b>{ctx.model.meta.project}</b></div>
          <div className="c"><b>{sh.t1}</b>{sh.t2 ? <><br /><b>{sh.t2}</b></> : null}</div>
          <div className="r">Print date : <b>{ctx.model.meta.date}</b><br />Prepared by : <b>{ctx.model.meta.by}</b></div>
        </div>
      </div>
      <div className="table-wrap rl-inl-tw">
        <table className="rl-inl-t">
          <thead>
            <tr>{sh.cols.map((c, i) => <th key={i} className={c.edit ? "ed" : ""}>{c.en}</th>)}<th /></tr>
            {sh.two ? <tr className="th2">{sh.cols.map((c, i) => <th key={i}>{c.th}</th>)}<th /></tr> : null}
          </thead>
          <tbody>
            {sh.rows.map((r, ri) => (
              <tr key={(r.id || "r") + ri} className={`${r.kid ? "kid" : ""} ${r.cancelled ? "cx" : ""} ${r.edited ? "edited" : ""}`}>
                {r.vals.map((v, ci) => {
                  const c = sh.cols[ci] || {}; const ed = c.edit && !r.kid && r.id != null;
                  return <td key={ci} className={ed ? "ed" : ""} style={r.kid && ci === 1 ? { paddingLeft: 8 + (r.lvl || 1) * 14 } : undefined}>
                    {ed ? <input value={v ?? ""} onChange={(e) => setCell(r.id, ci, e.target.value)} aria-label={`${c.en} ${r.vals[1] || ""}`} /> : (v ?? "")}
                  </td>;
                })}
                <td className="rst">{r.edited && (draft[sh.key] || {})[r.id] ? <button type="button" className="rw-link" title={L("คืนค่าเดิมของแถวนี้", "Reset this row")} onClick={() => resetRow(r.id)}>↺</button> : null}</td>
              </tr>))}
            {sh.total != null ? <tr className="tot">{sh.cols.map((c, i) => <td key={i} className={i + 1 === sh.totalAt ? "n" : ""}>{i + 2 === sh.totalAt ? L("รวม", "Total") : i + 1 === sh.totalAt ? sh.total : ""}</td>)}<td /></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// เลขล็อตจริงของแผน (P-241.2 / P-241) — ใช้ตัวที่ตรง roKey
function lotNoOf(plan, ro) { return String(ro || "").trim(); }
