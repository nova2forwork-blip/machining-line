// ══════════════════════════════════════════════════════════════════════════
// ★ 2026-11-10 กล่องรับเอกสาร (Inbox) ของหน้าปล่อยงาน — ลากทุกอย่างมาวางที่เดียว ระบบอ่านแล้วบอกว่าต้องไปทำอะไรที่ใบไหน
//   รับ: ใบ Modify (FM(DE)-00) · ใบปะหน้า Release (FM(DE)-03) · แบบ PDF (แผง / ซับ / พาร์ท / แบบ Site Item + อุปกรณ์) — Excel หรือ PDF
//   จับคู่: ใบ Modify → Release ที่อ้างถึง (P-089) · ใบปะหน้า P-069 → ใบ P-069 ถ้ามี (เพิ่มรายการ) ไม่มี = สร้างใหม่
//           แบบที่ไม่มีใบกำกับ → ทุก Release ที่ใช้แบบนั้น (แผง/ซับใน BOM · พาร์ทในใบ) ให้เลือก
//   ผลลัพธ์ = ปุ่ม "เปิด Modify P-089 พร้อมไฟล์" / "เพิ่มรายการใน P-069" / "สร้าง Release P-069" → หน้าเดิมเปิดขึ้นพร้อมไฟล์ที่อ่านแล้ว
// ══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { NC, findKey, findLatest, readPdfFiles, roKey, nf, nlen, buildBom, makeCatOf, newerRevOf } from "./releaseCore.js";
import { readOrderFile, readOrderPdf } from "./orderSheet.js";
import { Pill } from "./releaseUi.jsx";
import "./release-wizard.css";
import "./i18n-release.js";

const isSheetFile = (f) => /\.(xlsx?|xlsm)$/i.test(f.name);
// แบบนี้ใช้ใน Release ไหนบ้าง (แผง/ซับใน BOM · พาร์ทในคลังของใบ · แบบ loose = แผงในแบบตรงกับแผงของใบ)
function plansUsing(d, plans) {
  const hits = [];
  for (const p of plans || []) {
    const bom = p.bom || {}; let how = "";
    if (d.kind === "panel" && findKey(bom.panels || {}, d.code)) how = "แผง";
    else if (d.kind === "sub" && findKey(bom.subs || {}, d.code)) how = "ซับ";
    else if (d.kind === "part" && (findLatest(bom.parts || {}, d.code) || findKey(bom.parts || {}, d.code))) how = "พาร์ท";
    else if (d.kind === "loose" && (d.units || []).some((u) => findKey(bom.panels || {}, u.code))) how = "แผงในแบบ";
    if (how) hits.push({ plan: p, how });
  }
  return hits;
}
const planLabel = (p) => `${p.ro}${p.projectCode ? ` (${p.projectCode})` : ""}`;

// docs/setDocs เก็บที่หน้าแม่ (ReleasePage) — เปิดใบไปทำแล้วกดกลับมา งานที่เหลือยังอยู่
// โปรเจคของแบบ: PROJECT NO. ในหัวกระดาษ (A10042-US) → เทียบรหัสโปรเจค · ไม่มี = ชื่อโปรเจค (BARRINGTON PLAZA) เทียบชื่อ
function projectOfDrawing(d, projects) {
  const t = d.title || {}; const nm = String(t.PROJECT || "").trim().toLowerCase();
  for (const no of [NC(t.PROJECT_CODE || ""), NC(t.PROJECT_NO || "")].filter(Boolean)) { const base = no.replace(/-[A-Z]{2}$/, ""); const hit = projects.find((p) => NC(p.code) === no) || projects.find((p) => NC(p.code) === base || NC(p.code).startsWith(base + "-")); if (hit) return hit; }
  if (nm) { const hit = projects.find((p) => String(p.name || "").trim().toLowerCase() === nm) || projects.find((p) => nm && String(p.name || "").toLowerCase().includes(nm)); if (hit) return hit; }
  return null;
}
export default function ReleaseInbox({ plans = [], projects = [], api = null, userName = "", onOpenModify, onAddItems, onNewRelease, onOpenPlan, onBunk = null, onLibrarySaved = null, docs: docsIn, setDocs: setDocsIn }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState("");
  const [docsLocal, setDocsLocal] = useState([]);     // { file, type: "modify"|"order"|"drawing"|"bad", data, note }
  const docs = docsIn || docsLocal, setDocs = setDocsIn || setDocsLocal;
  const [open, setOpen] = useState(() => !!(docsIn && docsIn.length));
  const ref = useRef(null);
  const [libPick, setLibPick] = useState({});   // job key → projectId ที่เลือกเก็บเข้าคลัง
  const [libMsg, setLibMsg] = useState({});     // job key → { busy | ok | err }
  const byRo = (ro) => (plans || []).find((p) => roKey(p.ro) === roKey(ro));
  // ★ 2026-11-10 เก็บแบบซับ/พาร์ทเข้าคลังของโปรเจคตรงจากกล่องรับเอกสาร (เหมือนวางที่ขั้น "เลือกซับ / พาร์ท")
  async function saveToLibrary(j, projectId) {
    const project = projects.find((p) => p.id === projectId); if (!project || !api?.saveLibrary || !api?.loadBomLibrary) return;
    const got = j.drawings.map((d) => d.data).filter((d) => d.kind === "sub" || d.kind === "part");
    if (!got.length) return;
    setLibMsg((m) => ({ ...m, [j.k]: { busy: "อ่านคลังของโปรเจค…" } }));
    try {
      const base = await api.loadBomLibrary(project.id);
      const older = got.filter((d) => d.kind === "part" && newerRevOf(base.parts, d.code));
      const use = got.filter((d) => !older.includes(d));
      if (!use.length) { setLibMsg((m) => ({ ...m, [j.k]: { ok: `คลังมีรุ่นใหม่กว่าอยู่แล้ว (${older.map((d) => d.code).join(", ")}) — ไม่ได้เพิ่ม` } })); return; }
      const ov = base.ov || {};
      const merged = buildBom({ lib: base, pdfs: use, ack: {}, useLib: true });
      const cfg = { partMode: ov.partMode || "auto", partGroups: ov.partGroups || [] };
      const catOfLib = makeCatOf(merged, ov.catOv || {}, cfg);
      setLibMsg((m) => ({ ...m, [j.k]: { busy: "บันทึกลงคลัง…" } }));
      const r = await api.saveLibrary({ projectId: project.id, projectCode: project.code, bom: { panels: {}, subs: merged.subs, parts: merged.parts },
        newCodes: new Set(use.map((d) => NC(d.code))), catOv: ov.catOv || {}, procOv: ov.procOv || {}, destOv: ov.destOv || {}, ...cfg, catOf: catOfLib,
        pdfs: use.map((d) => ({ file: d.file, kind: d.kind, code: d.code, _file: d._file })), by: userName || "" }, (msg) => setLibMsg((m) => ({ ...m, [j.k]: { busy: msg } })));
      const gs = use.filter((d) => d.kind === "sub").length, gp = use.length - gs; const errs = (r && r.errors) || [];
      setLibMsg((m) => ({ ...m, [j.k]: { ok: `เก็บเข้าคลัง ${project.code} แล้ว — ซับ ${gs} · พาร์ท ${gp} เบอร์${older.length ? ` · ข้ามรุ่นเก่า ${older.length}` : ""}${errs.length ? " · " + errs.join(" · ") : ""}` } }));
      onLibrarySaved && onLibrarySaved(project, use);
    } catch (e) { setLibMsg((m) => ({ ...m, [j.k]: { err: "เก็บเข้าคลังไม่สำเร็จ: " + (e?.message || e) } })); }
  }

  async function addFiles(list) {
    const files = [...list].filter((f) => /\.(pdf|xlsx?|xlsm)$/i.test(f.name)); if (!files.length) return;
    setOpen(true); setBusy(`กำลังอ่าน ${files.length} ไฟล์…`);
    const out = [];
    for (const f of files.filter(isSheetFile)) {
      try {
        const o = await readOrderFile(f);
        if (o.items.length) { out.push({ file: f, type: o.kind === "modify" ? "modify" : "order", data: o }); continue; }
      } catch { /* ไม่ใช่ใบปะหน้า → ลองฟอร์มบั้ง */ }
      // ★ ฟอร์มบั้ง (Pack_Unit_*.xlsx · หัว BUNK NO. + ตาราง Unit No) — อ่านทุกชีต Ship
      try {
        const mod = await import("../excelImport.js");
        const b = await mod.parseBunkExcel(f);
        const n = (b.bunks || []).length, nU = (b.bunks || []).reduce((a, x) => a + x.units.length, 0);
        if (n) { out.push({ file: f, type: "bunk", data: { n, nU, sheets: b.sheets || [], warn: b.warn || [], project: b.bunks[0]?.meta?.project || "", first: b.bunks[0]?.meta?.bunk_no || "", last: b.bunks[n - 1]?.meta?.bunk_no || "" } }); continue; }
      } catch { /* ไม่ใช่ฟอร์มบั้ง */ }
      out.push({ file: f, type: "bad", note: "ไม่ใช่ใบปะหน้า (ไม่มีตาราง Item / Part No. / Qty) และไม่ใช่ฟอร์มบั้ง (ไม่มีหัว BUNK NO.)" });
    }
    const pdfs = files.filter((f) => !isSheetFile(f));
    if (pdfs.length) {
      let all = []; try { all = await readPdfFiles(pdfs, (n, of) => setBusy(`กำลังอ่าน PDF ${n}/${of}…`)); } catch (e) { out.push({ file: pdfs[0], type: "bad", note: "โหลดตัวอ่าน PDF ไม่ได้: " + (e?.message || e) }); }
      for (const d of all) {
        if (d.kind === "unknown" && d._file) { try { const o = await readOrderPdf(d._file); if (o.items.length) { out.push({ file: d._file, type: o.kind === "modify" ? "modify" : "order", data: o }); continue; } } catch { /* ไม่ใช่ใบปะหน้า */ } }
        if (d.kind === "unknown") out.push({ file: d._file || { name: d.file }, type: "bad", note: "อ่านไม่ออก — ไม่ใช่แบบแผง/ซับ/พาร์ท และไม่ใช่ใบปะหน้า (ไฟล์สแกนยังไม่รองรับ)" });
        else out.push({ file: d._file || { name: d.file }, type: "drawing", data: d });
      }
    }
    setDocs((old) => { const names = new Set(out.map((x) => x.file.name)); return [...old.filter((x) => !names.has(x.file.name)), ...out]; });
    setBusy("");
  }
  // ── จัดกลุ่มเป็น "งาน" ──
  const jobs = useMemo(() => {
    const drawings = docs.filter((x) => x.type === "drawing"); const used = new Set();
    const list = [];
    for (const s of docs.filter((x) => x.type === "modify")) {
      const o = s.data; const plan = o.refRo ? byRo(o.refRo) : null;
      const codes = new Set(o.items.map((i) => NC(i.code)));
      const mine = drawings.filter((d) => codes.has(NC(d.data.code))); mine.forEach((d) => used.add(d.file.name));
      const missing = o.items.filter((i) => !mine.some((d) => NC(d.data.code) === NC(i.code)));
      list.push({ k: "modify:" + s.file.name, sheet: s, plan, drawings: mine, missing, refRo: o.refRo });
    }
    for (const s of docs.filter((x) => x.type === "order")) {
      const o = s.data; const plan = o.ro ? byRo(o.ro) : null;
      const codes = new Set(o.items.map((i) => NC(i.code)));
      const mine = drawings.filter((d) => !used.has(d.file.name) && (codes.has(NC(d.data.code)) || (d.data.kind === "loose" && (d.data.site || []).some((r) => codes.has(NC(r.code)))))); mine.forEach((d) => used.add(d.file.name));
      const pc = NC(o.projectCode || ""); const prj = projects.find((p) => NC(p.code) === NC(o.projectFull || "") || NC(p.code) === pc || (pc && NC(p.code).startsWith(pc)));
      list.push({ k: "order:" + s.file.name, sheet: s, plan, project: prj, drawings: mine, missing: o.items.filter((i) => !mine.some((d) => NC(d.data.code) === NC(i.code))) });
    }
    const loose = drawings.filter((d) => !used.has(d.file.name));
    if (loose.length) {
      // แบบที่ไม่มีใบกำกับ → จัดตาม Release ที่ใช้
      const by = new Map(); const none = [];
      for (const d of loose) { const hits = plansUsing(d.data, plans); if (!hits.length) { none.push(d); continue; } for (const h of hits) { const e = by.get(h.plan.id) || { plan: h.plan, drawings: [] }; e.drawings.push({ ...d, how: h.how }); by.set(h.plan.id, e); } }
      const detect = (ds) => { const c = new Map(); for (const d of ds) { const pj = projectOfDrawing(d.data, projects); if (pj) c.set(pj.id, (c.get(pj.id) || 0) + 1); } const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0]; return top ? projects.find((p) => p.id === top[0]) : null; };
      for (const e of by.values()) list.push({ k: "loose:" + e.plan.id, plan: e.plan, drawings: e.drawings, loose: true, project: detect(e.drawings) });
      if (none.length) list.push({ k: "loose:none", drawings: none, loose: true, none: true, project: detect(none) });
    }
    return list;
  }, [docs, plans, projects]);   // eslint-disable-line react-hooks/exhaustive-deps
  const bad = docs.filter((x) => x.type === "bad");
  const bunkDocs = docs.filter((x) => x.type === "bunk");
  const filesOf = (j) => [...(j.sheet ? [j.sheet.file] : []), ...j.drawings.map((d) => d.file)].filter((f) => f instanceof File);
  const clear = () => { setDocs([]); setOpen(false); };
  const removeJob = (j) => { const names = new Set([...(j.sheet ? [j.sheet.file.name] : []), ...j.drawings.map((d) => d.file.name)]); setDocs((old) => old.filter((x) => !names.has(x.file.name))); };

  return (
    <div className="card rw-card rw-inbox">
      <div className={`rw-drop ${drag ? "drag" : ""} ${open ? "rw-drop-sm" : ""}`} role="button" tabIndex={0}
        onClick={() => ref.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
        <div className="rw-drop-ic"><Icon name="plus" size={20} /></div>
        <div><b>📥 วางเอกสารที่นี่ — ใบ Modify · ใบปะหน้า Release · แบบ PDF · ฟอร์มบั้ง (กี่ไฟล์ก็ได้ · Excel หรือ PDF)</b><span>ระบบอ่านเองว่าเป็นอะไร แล้วบอกว่าต้องไปทำที่ไหน: ใบ Modify → เปิด Modify ของใบที่อ้างถึงพร้อมแบบ · ใบปะหน้า → เพิ่มรายการ / สร้าง Release ใหม่ · แบบอย่างเดียว → ใบที่ใช้แบบนั้น · ฟอร์มบั้ง (Pack_Unit) → นำเข้าฟอร์มบั้ง ทุกชีต Ship ในไฟล์</span></div>
        <input ref={ref} type="file" multiple hidden accept=".pdf,.xls,.xlsx,.xlsm" data-testid="inbox-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {busy ? <div className="rw-msg info">{busy}</div> : null}
      {open && docs.length ? (
        <div className="rw-inbox-jobs">
          <div className="rw-order-h"><b>พบ {docs.length} ไฟล์ → {jobs.length} งาน</b><button type="button" className="rw-link" onClick={clear}>ล้างทั้งหมด</button></div>
          {jobs.map((j) => {
            const o = j.sheet?.data;
            if (j.sheet?.type === "modify") return (
              <div key={j.k} className={`rw-inbox-job ${j.plan ? "" : "bad"}`}>
                <div className="rw-inbox-job-h"><Pill tone="mod">ใบ Modify</Pill> <b>{o.roRaw || o.mVer}</b> <span className="rw-muted">อ้างถึง {o.refRo || "?"}{o.issuedBy ? ` · โดย ${o.issuedBy}` : ""}{o.date ? ` · ${o.date}` : ""}</span>
                  {j.plan ? <span className="rw-ok">→ Release {planLabel(j.plan)}</span> : <span className="rl-errtxt">→ ไม่พบ Release {o.refRo || ""} ในระบบ</span>}</div>
                <div className="rw-inbox-job-b">
                  แบบที่แก้ {o.items.length} รายการ: {o.items.map((i) => { const has = j.drawings.some((d) => NC(d.data.code) === NC(i.code)); return <Pill key={i.code} tone={has ? "ok" : "bad"}>{i.code}{i.rev ? ` REV.${i.rev}` : ""} {has ? "✓ มีแบบ" : "✗ ยังไม่มีแบบ"}</Pill>; })}
                  {j.missing.length ? <div className="rw-muted small">ยังไม่มีแบบ {j.missing.length} รายการ — วางเพิ่มได้ หรือเปิด Modify ไปก่อนแล้ววางทีหลัง</div> : null}
                </div>
                <div className="rw-inbox-job-a">
                  {j.plan ? <button type="button" className="btn btn-accent btn-sm" onClick={() => onOpenModify(j.plan, filesOf(j))}>✎ เปิด Modify {j.plan.ro} พร้อมไฟล์ {filesOf(j).length} ไฟล์</button> : null}
                  {j.plan ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenPlan(j.plan)}>เปิดใบ {j.plan.ro}</button> : null}
                  <button type="button" className="rw-link" onClick={() => removeJob(j)}>เอาออก</button>
                </div>
              </div>);
            if (j.sheet?.type === "order") return (
              <div key={j.k} className="rw-inbox-job">
                <div className="rw-inbox-job-h"><Pill tone="part">ใบปะหน้า</Pill> <b>{o.roRaw || o.ro || j.sheet.file.name}</b> <span className="rw-muted">{[o.projectName || o.projectCode, o.zone && `Zone ${o.zone}`, `${o.items.length} รายการ`].filter(Boolean).join(" · ")}</span>
                  {j.plan ? <span className="rw-ok">→ มีใบ {planLabel(j.plan)} แล้ว</span> : <span className="rw-muted">→ ยังไม่มีใบนี้ — สร้างใหม่{j.project ? ` ในโปรเจค ${j.project.code}` : ""}</span>}</div>
                <div className="rw-inbox-job-b">{o.items.slice(0, 12).map((i) => { const has = j.drawings.some((d) => NC(d.data.code) === NC(i.code) || (d.data.kind === "loose" && (d.data.site || []).some((r) => NC(r.code) === NC(i.code)))); return <Pill key={i.code} tone={has ? "ok" : "muted"}>{i.code} ×{nlen(i.qty)}{has ? " ✓ มีแบบ" : ""}</Pill>; })}{o.items.length > 12 ? <span className="rw-muted small"> … อีก {o.items.length - 12}</span> : null}</div>
                <div className="rw-inbox-job-a">
                  {j.plan ? <button type="button" className="btn btn-accent btn-sm" onClick={() => onAddItems(j.plan, filesOf(j))}>+ เพิ่มรายการใน {j.plan.ro} พร้อมไฟล์</button>
                    : <button type="button" className="btn btn-accent btn-sm" onClick={() => onNewRelease(filesOf(j), j.project ? j.project.id : "")}>+ สร้าง Release {o.ro || ""} จากใบนี้</button>}
                  {j.plan ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenPlan(j.plan)}>เปิดใบ {j.plan.ro}</button> : null}
                  <button type="button" className="rw-link" onClick={() => removeJob(j)}>เอาออก</button>
                </div>
              </div>);
            return (
              <div key={j.k} className={`rw-inbox-job ${j.none ? "bad" : ""}`}>
                <div className="rw-inbox-job-h"><Pill tone="muted">แบบ (ไม่มีใบกำกับ)</Pill> {j.plan ? <><b>ใช้ใน Release {planLabel(j.plan)}</b></> : <b>{j.project ? `โปรเจค ${j.project.code} — ${j.project.name}` : "ยังไม่รู้โปรเจค"}</b>}{!j.plan ? <span className="rw-muted">· ยังไม่มี Release ที่ใช้แบบนี้</span> : null}</div>
                <div className="rw-inbox-job-b">{j.drawings.map((d) => <Pill key={d.file.name} tone="ok">{d.data.code} <small>{d.data.kind === "panel" ? "แผง" : d.data.kind === "sub" ? "ซับ" : d.data.kind === "loose" ? "Site Item+อุปกรณ์" : "พาร์ท"}{d.how ? ` · ${d.how}` : ""}</small></Pill>)}</div>
                <div className="rw-inbox-job-a">
                  {j.plan ? <>
                    <button type="button" className="btn btn-accent btn-sm" onClick={() => onOpenModify(j.plan, filesOf(j))}>✎ Modify {j.plan.ro} ด้วยแบบนี้ (แบบ Rev ใหม่)</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAddItems(j.plan, filesOf(j))}>+ เพิ่มรายการใน {j.plan.ro}</button>
                  </> : null}
                  {j.drawings.some((d) => d.data.kind === "sub" || d.data.kind === "part") && api?.saveLibrary ? (() => {
                    const pid = libPick[j.k] ?? (j.project ? j.project.id : (j.plan ? j.plan.projectId : "")); const st = libMsg[j.k]; const nSP = j.drawings.filter((d) => d.data.kind === "sub" || d.data.kind === "part").length;
                    return <>
                      <select className="select" style={{ width: "auto", maxWidth: 260 }} value={pid || ""} onChange={(e) => setLibPick((o) => ({ ...o, [j.k]: e.target.value }))} aria-label="โปรเจคที่จะเก็บเข้าคลัง" disabled={!!st?.busy}>
                        <option value="">— โปรเจค —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                      </select>
                      <button type="button" className={`btn btn-sm ${j.plan ? "btn-ghost" : "btn-accent"}`} disabled={!pid || !!st?.busy || !!st?.ok} onClick={() => saveToLibrary(j, pid)} title="บันทึกแบบซับ/พาร์ทลงคลัง “ซับ / พาร์ท ของโปรเจค” (เหมือนวางที่ขั้นเลือกซับ/พาร์ท) — Release ใหม่ดึงจากคลังนี้">
                        {st?.busy ? st.busy : st?.ok ? "✓ เก็บแล้ว" : `เก็บเข้าคลังซับ/พาร์ท ${nSP} เบอร์${j.project && !libPick[j.k] ? ` · ${j.project.code} (จากในแบบ)` : ""}`}
                      </button>
                    </>; })() : null}
                  {j.drawings.some((d) => d.data.kind === "panel") && !j.plan ? <span className="rw-muted small">แบบแผง → ใช้ตอน "ปล่อยงานใหม่" (วางใบปะหน้ามาด้วยจะสร้างให้เลย)</span> : null}
                  <button type="button" className="rw-link" onClick={() => removeJob(j)}>เอาออก</button>
                </div>
                {libMsg[j.k]?.ok || libMsg[j.k]?.err ? <div className={`rw-msg ${libMsg[j.k].err ? "bad" : "ok"}`} style={{ marginTop: 6 }}>{libMsg[j.k].err || "✓ " + libMsg[j.k].ok}</div> : null}
              </div>);
          })}
          {bunkDocs.length ? (
            <div className="rw-inbox-job">
              <div className="rw-inbox-job-h"><Pill tone="panel">ฟอร์มบั้ง (แพ็ก)</Pill> <b>{bunkDocs.length} ไฟล์ · {nf(bunkDocs.reduce((a, x) => a + x.data.n, 0))} บั้ง · {nf(bunkDocs.reduce((a, x) => a + x.data.nU, 0))} ยูนิต</b> <span className="rw-muted">{bunkDocs[0].data.project ? `โปรเจค ${bunkDocs[0].data.project}` : ""}</span></div>
              <div className="rw-inbox-job-b">{bunkDocs.map((x) => <Pill key={x.file.name} tone="muted" title={x.data.sheets.filter((s) => s.used).map((s) => `${s.name}: ${s.used} บั้ง`).join("\n")}>{x.file.name.replace(/\.xlsx?$/i, "")} <small>{x.data.n} บั้ง · {x.data.sheets.filter((s) => s.used).length} ชีต{x.data.first ? ` · ${x.data.first}${x.data.last && x.data.last !== x.data.first ? " → " + x.data.last : ""}` : ""}</small></Pill>)}</div>
              {bunkDocs.some((x) => x.data.warn.length) ? <div className="rw-muted small">⚠ {bunkDocs.flatMap((x) => x.data.warn.map((w) => `${x.file.name}: ${w}`)).join(" · ")}</div> : null}
              <div className="rw-inbox-job-a">
                {onBunk ? <button type="button" className="btn btn-accent btn-sm" onClick={() => onBunk(bunkDocs.map((x) => x.file))}>📦 นำเข้าฟอร์มบั้ง {bunkDocs.length} ไฟล์ (เลือกโปรเจค / เลข Release แล้วบันทึก)</button> : null}
                <button type="button" className="rw-link" onClick={() => setDocs((old) => old.filter((x) => x.type !== "bunk"))}>เอาออก</button>
              </div>
            </div>) : null}
          {bad.length ? <div className="rw-msg bad">✗ อ่านไม่ได้ {bad.length} ไฟล์: {bad.map((x) => `${x.file.name} (${x.note})`).join(" · ")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
