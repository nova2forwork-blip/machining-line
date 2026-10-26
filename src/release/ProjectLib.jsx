// ══════════════════════════════════════════════════════════════════════════
// ซับ / พาร์ท ของโปรเจค — office ลงแบบซับ/พาร์ท (PDF) แยกหมวดไว้ที่โปรเจค
//   Release ลงแค่แผง → แผงไหนใช้ซับ/พาร์ทตัวไหน ระบบดึงจากที่นี่ไปใส่ใน Release ให้เอง
//   เก็บ: part_master + BOM ของซับ (ในระบบเดิม) + หมวด/งานซับ/ใบงาน (แถว LIB ใน release_plans)
// ══════════════════════════════════════════════════════════════════════════
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { askConfirm } from "../confirm.jsx";
import { NC, ncmp, nf, nlen, findKey, isStar, PART_CATS, QR_CATS, PART_DESTS, UNCAT, ruleCat, ruleDest, destLabel, readPdfFiles, buildBom, makeCatOf } from "./releaseCore.js";
import { Pill, SubKids } from "./releaseUi.jsx";
import FileBrowser from "./FileBrowser.jsx";
import "./release-wizard.css";
import "./i18n-release.js";   // คำแปลอังกฤษของหน้า Release

const EMPTY = { panels: {}, subs: {}, parts: {} };

export default function ProjectLib({ projectId, projectCode, api, user, onBack, onSaved, demoTools = null }) {
  const [lib, setLib] = useState(null);
  const [state, setState] = useState({ s: "loading" });
  const [pdfs, setPdfs] = useState([]);
  const [catOv, setCatOv] = useState({});
  const [procOv, setProcOv] = useState({});
  const [partMode, setPartMode] = useState("auto");
  const [partGroups, setPartGroups] = useState([]);
  const [grpFilter, setGrpFilter] = useState("ALL");
  const [destOv, setDestOv] = useState({});
  const [tab, setTab] = useState("sub");
  const [q, setQ] = useState("");
  const [onlyNoKids, setOnlyNoKids] = useState(false);   // กรอง: ซับที่ยังไม่มีแบบ (ไม่มีเบอร์ลูก)
  const [reading, setReading] = useState(null);
  const [drag, setDrag] = useState(false);
  const [saving, setSaving] = useState({ busy: false, msg: "", err: "", done: null });
  const [open, setOpen] = useState({});   // ซับที่กางดูเบอร์ลูก
  const fileRef = useRef(null);
  const dirty = pdfs.length > 0 || saving.done === false;

  useEffect(() => {
    let alive = true; setState({ s: "loading" });
    api.loadBomLibrary(projectId).then((l) => { if (!alive) return; setLib(l || EMPTY); const ov = (l && l.ov) || {}; setCatOv(ov.catOv || {}); setProcOv(ov.procOv || {}); setDestOv(ov.destOv || {}); setPartMode(ov.partMode || "auto"); setPartGroups(ov.partGroups || []); setState({ s: "ok" }); })
      .catch((e) => { if (alive) { setLib(EMPTY); setState({ s: "err", err: String(e?.message || e) }); } });
    return () => { alive = false; };
  }, [api, projectId]);

  // คลังรวม = ของเดิมในระบบ + PDF ที่เพิ่งอัพ (ทับค่าเดิมของเบอร์นั้น)
  const bom = useMemo(() => buildBom({ lib: lib || EMPTY, pdfs, ack: {}, useLib: true }), [lib, pdfs]);
  // ไฟล์ PDF ที่เก็บไว้ในระบบ (path อยู่ในแถว LIB) → ปุ่ม "PDF" เปิดดูต้นฉบับ · ปุ่ม "อ่านซ้ำ" อ่านใหม่จากไฟล์เดิม
  const pdfOf = useMemo(() => new Map(((lib && lib.pdfs) || []).filter((x) => x.path).map((x) => [NC(x.code), x])), [lib]);
  async function openPdf(code) {
    const e = pdfOf.get(NC(code)); if (!e || !api.getLibPdfUrl) return;
    try { window.open(await api.getLibPdfUrl(e.path), "_blank", "noopener"); } catch (err) { setReading({ err: "เปิดไฟล์ PDF ไม่ได้: " + (err?.message || err) }); }
  }
  async function rereadStored() {
    const list = [...pdfOf.values()]; if (!list.length || !api.downloadLibPdf) return;
    setReading({ n: 0, of: list.length });
    try {
      const files = []; let n = 0;
      for (const e of list) { files.push(await api.downloadLibPdf(e.path, e.file || (e.code + ".pdf"))); setReading({ n: ++n, of: list.length }); }
      const got = (await readPdfFiles(files)).filter((d) => d.kind === "sub" || d.kind === "part");
      setPdfs((old) => { const names = new Set(got.map((d) => d.file)); return [...old.filter((d) => !names.has(d.file)), ...got]; });
      setReading({ warn: `อ่านซ้ำจากไฟล์ที่เก็บไว้ ${got.length} ไฟล์แล้ว — ตรวจแล้วกด "บันทึก" เพื่ออัปเดตข้อมูล` });
    } catch (err) { setReading({ err: "อ่านซ้ำไม่ได้: " + (err?.message || err) }); }
  }
  const srcOf = (code) => (pdfs.some((d) => NC(d.code) === NC(code)) ? "pdf" : "lib");
  const catOf = useMemo(() => makeCatOf(bom, catOv, { partMode, partGroups }), [bom, catOv, partMode, partGroups]);
  const subs = useMemo(() => Object.entries(bom.subs).map(([code, s]) => ({ code, ...s, items: (s.items || []).filter((it) => (it[4] || "") !== "ยกเลิก") })).sort((a, b) => ncmp(a.code, b.code)), [bom]);
  const parts = useMemo(() => Object.entries(bom.parts).map(([code, p]) => ({ code, ...p, cat: catOf(code, p.k || "part") })).sort((a, b) => ncmp(a.code, b.code)), [bom, catOf]);
  const catCount = useMemo(() => { const m = new Map(); for (const p of parts) m.set(p.cat, (m.get(p.cat) || 0) + 1); return m; }, [parts]);
  const onGroupChange = (patch) => { if (patch.partMode !== undefined) setPartMode(patch.partMode); if (patch.partGroups !== undefined) setPartGroups(patch.partGroups); if (patch.catOv !== undefined) setCatOv(patch.catOv); if (patch.destOv !== undefined) setDestOv(patch.destOv); };
  const usedIn = useMemo(() => { const m = new Map(); for (const s of subs) for (const it of s.items) (m.get(NC(it[1])) || m.set(NC(it[1]), []).get(NC(it[1]))).push(s.code); return m; }, [subs]);
  const Q = q.trim().toUpperCase();
  const has = (...xs) => !Q || xs.some((x) => String(x || "").toUpperCase().includes(Q));

  async function addFiles(list) {
    const files = [...list].filter((f) => /\.pdf$/i.test(f.name)); if (!files.length) return;
    setReading({ n: 0, of: files.length });
    try {
      const all = await readPdfFiles(files, (n, of) => setReading({ n, of }));
      const got = all.filter((d) => d.kind === "sub" || d.kind === "part"); const skip = all.filter((d) => !(d.kind === "sub" || d.kind === "part"));
      setPdfs((old) => { const names = new Set(got.map((d) => d.file)); return [...old.filter((d) => !names.has(d.file)), ...got]; });
      setReading(skip.length ? { warn: `ข้าม ${skip.length} ไฟล์ (${skip.map((d) => d.kind === "panel" ? "แบบแผง " + d.code : "อ่านไม่ออก " + d.file).slice(0, 4).join(", ")}) — แบบแผงลงที่ "ปล่อยงานใหม่"` } : null);
    } catch (e) { setReading({ err: "โหลดตัวอ่าน PDF ไม่ได้: " + (e?.message || e) }); }
  }
  const setCat = (codes, v) => setCatOv((o) => { const n = { ...o }; for (const c of codes) { if (!v || v === UNCAT) delete n[c]; else n[c] = v; } return n; });

  async function goBack() {
    if (saving.busy) return;
    if (pdfs.length && !(await askConfirm({ title: "มี PDF ใหม่ที่ยังไม่บันทึก", message: `PDF ใหม่ ${pdfs.length} ไฟล์ยังไม่ได้กด "บันทึก" — ถ้ากลับตอนนี้ไฟล์จะหาย ต้องอัพใหม่`, tone: "warn", confirmText: "กลับ (ทิ้งไฟล์)", cancelText: "อยู่ต่อ" }))) return;
    onBack();
  }

  async function save() {
    if (saving.busy) return;
    const nNew = pdfs.length;
    if (!(await askConfirm({ title: "บันทึกซับ / พาร์ท ของโปรเจค?", message: [`ซับ ${nf(subs.length)} เบอร์ · พาร์ท ${nf(parts.length)} เบอร์`, nNew ? `PDF ใหม่ ${nNew} ไฟล์ → สร้าง/อัปเดตเบอร์ + BOM ซับในระบบ` : "ไม่มี PDF ใหม่ — บันทึกเฉพาะหมวด / งานซับ / ใบงาน", "Release ที่สร้างใหม่จะดึงจากคลังนี้ · Release เดิมที่ยังไม่มี BOM จะดึงให้เมื่อเปิด"].join("\n"), tone: "warn", confirmText: "บันทึก", cancelText: "กลับ" }))) return;
    setSaving({ busy: true, msg: "เริ่มบันทึก…", err: "", done: null });
    try {
      const r = await api.saveLibrary({ projectId, projectCode, bom: { panels: {}, subs: bom.subs, parts: bom.parts }, newCodes: new Set(pdfs.map((d) => NC(d.code))), catOv, procOv, destOv, partMode, partGroups, catOf, pdfs: pdfs.map((d) => ({ file: d.file, kind: d.kind, code: d.code, _file: d._file })), by: user?.name || "" }, (m) => setSaving((s) => ({ ...s, msg: m })));
      setSaving({ busy: false, msg: "", err: "", done: true, errors: r?.errors || [] });
      setPdfs([]);
      let reloadErr = "";
      const l = await api.loadBomLibrary(projectId).catch((e) => { reloadErr = String(e?.message || e); return null; });
      if (l) setLib(l); else setSaving({ busy: false, msg: "", err: "", done: true, errors: [...(r?.errors || []), `บันทึกแล้ว แต่โหลดคลังกลับมาไม่ได้ (${reloadErr || "ไม่ทราบสาเหตุ"}) — กด F5 เพื่อรีเฟรช`] });
      if (onSaved) onSaved(r);
    } catch (e) { setSaving({ busy: false, msg: "", err: e?.message || String(e), done: false }); }
  }

  const grpNames = [...new Set([...partGroups.map((g) => g.name || g), ...PART_CATS, UNCAT])];
  const grpOrder = new Map(grpNames.map((k, i) => [k, i]));
  const catOpts = (partMode === "setting" ? [...partGroups.map((g) => g.name || g)] : PART_CATS).filter((k) => k !== "SUB-ASSEMBLY PART");
  const isGlass = (p) => p.cat === "GLASS";
  const partRows = parts.filter((p) => (tab === "glass" ? isGlass(p) : !isGlass(p))).filter((p) => has(p.code, p.d, p.m || p.binv, p.cat)).sort((a, b) => ((grpOrder.get(a.cat) ?? 99) - (grpOrder.get(b.cat) ?? 99)) || ncmp(a.code, b.code));
  const noKids = (s) => !s.items.length && !(s.full || []).length;   // ยังไม่เคยลงแบบ PDF ของซับนี้ (มีแต่ชื่อเบอร์ที่แผง/ซับแม่อ้างถึง)
  const noKidSubs = subs.filter(noKids);
  const subRows = subs.filter((s) => (has(s.code, s.d) || s.items.some((it) => has(it[1]))) && (!(onlyNoKids && noKidSubs.length) || noKids(s)));
  let lastCat = null;
  const nPdfSub = pdfs.filter((d) => d.kind === "sub").length, nPdfPart = pdfs.filter((d) => d.kind === "part").length;

  return (
    <div className="rw pl">
      <div className="page-head rw-head">
        <div>
          <div className="rw-crumb"><button type="button" className="rw-link" onClick={goBack}>โปรเจค {projectCode}</button> <span>/</span> ซับ / พาร์ท ของโปรเจค</div>
          <div className="page-title">ซับ / พาร์ท ของโปรเจค {projectCode}</div>
          <div className="page-sub">ลงแบบซับ (SA…) และแบบพาร์ทไว้ที่โปรเจค แยกหมวด · Release ลงแค่แผง แล้วระบบดึงซับ/พาร์ทที่แผงใช้จากที่นี่ให้เอง</div>
        </div>
        <div className="rw-head-right">
          <button type="button" className="btn btn-ghost" onClick={goBack} disabled={saving.busy}><Icon name="arrowLeft" size={14} /> กลับ</button>
          <button type="button" className="btn btn-accent" onClick={save} disabled={saving.busy || state.s !== "ok"}>{saving.busy ? saving.msg : "บันทึก"}</button>
        </div>
      </div>

      <div className="card rw-card">
        <div className={`rw-drop ${drag ? "drag" : ""}`} role="button" tabIndex={0}
          onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
          <div className="rw-drop-ic"><Icon name="plus" size={20} /></div>
          <div><b>ลาก PDF แบบซับ / แบบพาร์ท มาวาง หรือกดเพื่อเลือก</b><span>หลายไฟล์พร้อมกันได้ · ระบบอ่าน BILL OF MATERIALS + หัวกระดาษ · ไฟล์เบอร์เดิม = อัปเดตค่าเดิม</span></div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden data-testid="lib-pdf-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {reading ? <div className={`rw-msg ${reading.err ? "bad" : reading.warn ? "warn" : "info"}`}>{reading.err || reading.warn || `กำลังอ่าน PDF ${reading.n}/${reading.of}…`}</div> : null}
        {state.s === "err" ? <div className="rw-msg bad">✗ โหลดคลังของโปรเจคไม่ได้: {state.err}</div> : null}
        {saving.err ? <div className="rw-msg bad">✗ บันทึกไม่สำเร็จ — {saving.err}</div> : null}
        {saving.done ? <div className="rw-msg ok">✓ บันทึกแล้ว{saving.errors?.length ? ` · ⚠ ${saving.errors.join(" · ")}` : ""}</div> : null}
        <div className="rw-tools">
          <span className="rw-muted small">{state.s === "loading" ? "กำลังโหลด…" : <>ในโปรเจค: ซับ <b>{nf(subs.length)}</b> · พาร์ท <b>{nf(parts.length)}</b> เบอร์{pdfs.length ? <> · PDF ใหม่ {pdfs.length} ไฟล์ (ซับ {nPdfSub} · พาร์ท {nPdfPart}) <Pill tone="mod">ยังไม่บันทึก</Pill></> : null}</>}</span>
          {pdfs.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPdfs([])}>เอา PDF ใหม่ออก</button> : null}
          {pdfOf.size && api.downloadLibPdf ? <button type="button" className="btn btn-ghost btn-sm" onClick={rereadStored} disabled={!!reading && !reading.err && !reading.warn} title="อ่านข้อมูลใหม่จากไฟล์ PDF ที่เก็บไว้ในระบบ (ไม่ต้องอัพซ้ำ)">↻ อ่านซ้ำจากไฟล์ที่เก็บไว้ ({pdfOf.size})</button> : null}
          {demoTools?.libPdfs ? demoTools.libPdfs(setPdfs) : null}
        </div>
        <div className="rl-tabs" role="tablist">
          {[["sub", "ซับ (Sub-Assembly)", subs.length, "รายการซับ + ลูกใน BOM (งานพับ/เชื่อม/ยิง เลือกตอนปล่อยใน Release)"], ["part", "พาร์ท", parts.filter((p) => !isGlass(p)).length, "แยกหมวดตามกติกาเบอร์ · เบอร์ที่มี * = SITE ITEM"], ["glass", "กระจก (Glass)", parts.filter(isGlass).length, "รายการกระจก · ใบเบิก ไม่มี QR"], ...(api.listStorage ? [["files", "📁 ไฟล์", null, "โฟลเดอร์ PDF แบบ + รูปถ่ายแพ็ก"]] : [])].map(([k, l, n, th]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rl-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}><b>{l}</b><small>{n == null ? th : `${nf(n)} เบอร์ · ${th}`}</small></button>))}
        </div>
        {tab === "files" ? (
          <FileBrowser api={api} roots={[
            { key: "pdf", name: "PDF แบบซับ / พาร์ท", bucket: "release-pdfs", prefix: projectCode.replace(/[^A-Za-z0-9._-]+/g, "_"), note: `ไฟล์ต้นฉบับที่อัพไว้ของโปรเจค ${projectCode} · แยก sub / part` },
            { key: "photo", name: "รูปถ่าย (แพ็ก)", bucket: "packing-photos", prefix: "", note: "รูปที่ถ่ายตอนแพ็ก" },
          ]} />
        ) : (<>
        <div className="rl-tools">
          <input className="input rw-search" style={{ marginTop: 0 }} placeholder="ค้นหาเบอร์ / description / INV" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {tab === "sub" && noKidSubs.length ? (
          <div className="rw-msg warn rl-nokids">
            <span>⚠ ซับ <b>{nf(noKidSubs.length)}</b> เบอร์ ยังไม่มีเบอร์ลูก — ยังไม่ได้ลงแบบ PDF ของซับเหล่านี้ (ในระบบมีแค่ชื่อเบอร์ที่แผง/ซับแม่อ้างถึง) · ลาก PDF ของซับมาวางด้านบน แล้วกด "บันทึก"</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOnlyNoKids((v) => !v)}>{onlyNoKids ? "ดูซับทั้งหมด" : "ดูเฉพาะที่ยังไม่มีแบบ"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { try { navigator.clipboard.writeText(noKidSubs.map((x) => x.code).join("\n")); setReading({ warn: `คัดลอกรายชื่อซับที่ยังไม่มีแบบ ${noKidSubs.length} เบอร์แล้ว` }); } catch (_) { setReading({ err: "คัดลอกไม่ได้" }); } }}>คัดลอกรายชื่อ</button>
          </div>
        ) : null}
        <div className="table-wrap rw-tw rl-tw">
          {tab === "sub" ? (
            <table className="data-table rw-table">
              <thead><tr><th className="r">NO.</th><th>CODE</th><th>DESCRIPTION</th><th className="r">LENGTH</th><th>ที่มา</th></tr></thead>
              <tbody>{subRows.slice(0, 600).map((s, i) => { const path = "L|" + s.code; return (
                <Fragment key={s.code}>
                <tr>
                  <td className="r rw-num">{i + 1}</td>
                  <td className="rw-mono"><button type="button" className="rw-tg" onClick={() => setOpen((o) => ({ ...o, [path]: !o[path] }))} aria-expanded={!!open[path]} title={open[path] ? "ย่อ" : "ขยายดูเบอร์ลูก"}>{open[path] ? "▾" : "▸"}</button><b>{s.code}</b>{isStar(s.code) ? <> <Pill tone="warn">*</Pill></> : null}</td>
                  <td className="rl-desc"><span>{s.d}</span></td>
                  <td className="r rw-num">{nlen(s.l)}</td>
                  <td>{srcOf(s.code) === "pdf" ? <Pill tone="ok">PDF ใหม่</Pill> : <Pill tone="info">ในระบบ</Pill>}{noKids(s) ? <> <Pill tone="warn">ยังไม่มีแบบ</Pill></> : null}{pdfOf.has(NC(s.code)) && api.getLibPdfUrl ? <> <button type="button" className="rw-link" onClick={() => openPdf(s.code)} title="เปิดไฟล์ PDF ต้นฉบับ">PDF</button></> : null}</td>
                </tr>
                {open[path] ? <SubKids lib={bom} code={s.code} path={path} depth={1} open={open} setOpen={setOpen} seen={[NC(s.code)]} compact /> : null}
                </Fragment>); })}</tbody>
            </table>
          ) : (
            <table className="data-table rw-table rt-allparts">
              <thead><tr><th className="r">NO.</th><th>CODE</th><th>DESCRIPTION</th><th className="r">LENGTH</th><th>INV / MATERIAL</th><th>ที่มา</th></tr></thead>
              <tbody>{partRows.slice(0, 2000).flatMap((p, i) => {
                const rows = [];
                if (p.cat !== lastCat) { lastCat = p.cat; rows.push(<tr key={"g" + p.cat} className="rt-grp"><td colSpan={6}><b>{p.cat}</b> <span className="rw-muted small">{nf(partRows.filter((x) => x.cat === p.cat).length)} เบอร์</span>{p.cat === UNCAT ? <> <Pill tone="warn">รอจัดหมวด</Pill></> : !PART_CATS.includes(p.cat) ? <> <Pill tone="mod">หมวดที่ตั้งเอง</Pill></> : null}</td></tr>); }
                const qr = p.k !== "hw" && QR_CATS.has(PART_CATS.includes(p.cat) ? p.cat : ruleCat(p.code, p.k || "part")); const u = usedIn.get(NC(p.code)) || [];
                rows.push(
                  <tr key={p.code}>
                    <td className="r rw-num">{i + 1}</td>
                    <td className="rw-mono"><b>{p.code}</b>{isStar(p.code) ? <> <Pill tone="warn">*</Pill></> : null}</td>
                    <td className="rl-desc"><span>{p.d}</span></td>
                    <td className="r rw-num">{nlen(p.l)}</td>
                    <td className="rw-mono rt-inv">{p.binv || p.m || <span className="rw-muted">—</span>}</td>
                                        <td>{srcOf(p.code) === "pdf" ? <Pill tone="ok">PDF ใหม่</Pill> : <Pill tone="info">ในระบบ</Pill>}{pdfOf.has(NC(p.code)) && api.getLibPdfUrl ? <> <button type="button" className="rw-link" onClick={() => openPdf(p.code)} title="เปิดไฟล์ PDF ต้นฉบับ">PDF</button></> : null}</td>
                  </tr>);
                return rows;
              })}</tbody>
            </table>
          )}
          {(tab === "sub" ? subRows : partRows).length === 0 ? <div className="rw-muted small" style={{ padding: 14 }}>{state.s === "loading" ? "กำลังโหลด…" : q ? "ไม่พบ" : tab === "glass" ? "ยังไม่มีกระจก — กระจกมาจาก BOM ของซับ/แผง (เบอร์ GL…) หรือย้ายพาร์ทมาหมวด GLASS" : "ยังไม่มี — อัพ PDF แบบซับ/พาร์ทด้านบน"}</div> : null}
        </div>
        </>)}
        {dirty ? <div className="rw-muted small" style={{ padding: "8px 12px" }}>มี PDF ใหม่ที่ยังไม่บันทึก — กด "บันทึก" มุมขวาบน</div> : null}
      </div>
    </div>
  );
}
