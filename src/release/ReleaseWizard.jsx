// ══════════════════════════════════════════════════════════════════════════
// ปล่อยงานใหม่ (Release) — 4 ขั้น: ① สร้าง Release ② Address & Unit ③ อัพ PDF แผง/ซับ/พาร์ท ④ ตรวจ + บันทึก
// แทนปุ่มเดิม "เพิ่ม Release" + "เบอร์ประกอบ / แผง" (2026-10-13)
//   api = { projectContext, loadBomLibrary, orderExists, saveRelease } — ของจริง (releaseApi.js) หรือของตัวอย่าง (demo)
//   ไฟล์นี้ไม่ import supabase.js โดยตรง → ใช้ทำหน้าตัวอย่างได้โดยไม่ต้องต่อฐานข้อมูล
// ══════════════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { askConfirm } from "../confirm.jsx";
import {
  NC, ncmp, nf, nlen, findKey, isStar, CATS, PART_CATS, PROCS, QR_CATS, ruleCat, ruleProc, procList,
  readPdfFiles, buildBom, runChecks, countUnits, coverage, unitIssues, parseUnitsPaste, normMockUnits, mockType, bomForSave,
  RELEASE_ORDER_RE, normalizeRO, roKey, inPlan, needOf, trimBom, lotRows, SHEETS, PART_DESTS, ruleDest, isPartSheet, TOTALS, cutMaterials, destLabel, CAT_DEST, loadPdfJs, readUnitsPdf, releasedOf, otherOf, makeCatOf, findLatest, newerRevOf, revLetter, expandUnits, mockQty } from "./releaseCore.js";
import { SubKids, trailTo } from "./releaseUi.jsx";
import { readOrderFile, compareOrder } from "./orderSheet.js";
import "./release-wizard.css";
import "./i18n-release.js";   // คำแปลอังกฤษของหน้า Release

const DRAFT_KEY = "mls.relwiz.draft.v1";
const STEPS = ["สร้าง Release", "Address & Unit", "อัพ PDF แผง", "ตรวจ + บันทึก"];
const SUB_SHORT = { "พับ": "พับ", "เชื่อม": "เชื่อม", "ยิง": "ยิง", "Site Item": "Site Item" };
const EMPTY_LIB = { panels: {}, subs: {}, parts: {} };
const NONE = [];   // อาร์เรย์ว่างตัวเดียว (ref คงที่ — ไม่ทำให้ useMemo คำนวณใหม่ทุกครั้ง)
const todayYmd = () => { const d = new Date(); const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const dateToIso = (ymd) => { if (!ymd) return new Date().toISOString(); const now = new Date(); const d = new Date(`${ymd}T00:00:00`); d.setHours(now.getHours(), now.getMinutes(), now.getSeconds()); return d.toISOString(); };
const fmtYmd = (ymd) => (ymd ? ymd.split("-").reverse().join("/") : "");
const hhmm = (d) => (d ? new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const loadDraft = () => { try { const s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const kindLabel = { panel: ["panel", "แผง"], sub: ["sub", "ซับ"], part: ["part", "พาร์ท"], unknown: ["bad", "อ่านไม่ได้"] };
const LV = { ok: ["ok", "✓ ตรง"], info: ["ok", "✓ ใหม่"], done: ["ok", "✓ ตัดสินแล้ว"], warn: ["warn", "⚠ ดู"], bad: ["bad", "✗"] };

function Pill({ tone = "muted", children, title }) { return <span className={`rw-pill ${tone}`} title={title}>{children}</span>; }
function Help({ label = "ระบบตรวจอะไรบ้าง", children }) {
  return (
    <details className="rw-help">
      <summary><span aria-hidden="true">ⓘ</span> {label}</summary>
      <div className="rw-help-pop">{children}</div>
    </details>
  );
}
function SecHead({ title, sub, right }) {
  return (
    <div className="rw-sec-head">
      <div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
      {right ? <div className="rw-sec-right">{right}</div> : null}
    </div>
  );
}
function Chips({ list, max = 14 }) {
  const tone = (x) => (x.src === "none" ? "warn" : x.src === "lib" ? "info" : "ok");
  const chip = (x) => <Pill key={x.code} tone={tone(x)} title={x.from ? "ใช้ใน " + x.from : ""}>{x.code}</Pill>;
  if (list.length <= max) return <>{list.map(chip)}</>;
  return (
    <>
      {list.slice(0, max).map(chip)}
      <details className="rw-more"><summary>+ อีก {list.length - max} เบอร์</summary><div className="rw-more-body">{list.slice(max).map(chip)}</div></details>
    </>
  );
}

export default function ReleaseWizard({ user, projects = [], releases = [], plans = [], initialProjectId = "", api, onCancel, onSaved, onNeedProject, demoTools = null, initialFiles = null }) {
  const userName = user?.name || "—";
  // ── state ──
  const [step, setStep] = useState(0);
  const [hdr, setHdr] = useState(() => ({ projectId: initialProjectId || (projects.length === 1 ? projects[0].id : ""), ro: "", date: todayYmd(), note: "", mod: "" }));
  // ── โหมดของใบนี้: "panel" = ลงที่อยู่แผง + อัพ PDF แผง (เดิม) · "items" = ปล่อยเฉพาะซับ/พาร์ท เลือกจากคลังของโปรเจค (ไม่มีแผง) ──
  const [mode, setMode] = useState("panel");
  const [picks, setPicks] = useState([]);                // โหมด items: [{ code, kind:"sub"|"part", qty }]
  // ★ 2026-11-10 ใบปะหน้า Release (FM(DE)-03 · PDF/Excel) — รายการเบอร์ + จำนวนที่ "ต้องมี" ในใบนี้ · วางก่อนแล้วค่อยวางแบบ ระบบเทียบให้
  const [order, setOrder] = useState(null);              // { file, ro, projectCode, zone, note, items:[{code,d,qty,unit,remark}] } | null
  const [orderHw, setOrderHw] = useState([]);            // เบอร์ในใบปะหน้าที่ถือเป็นอุปกรณ์ (ไม่มี QR · ไปใบเบิก) — เก็บเป็น plan.extra kind "hw"
  const itemsMode = mode === "items";
  const [unitsRaw, setUnits] = useState([]);
  const [pdfsRaw, setPdfs] = useState([]);
  // ★ 2026-11-03 แถว Mockup ที่ใส่จำนวน → กางเป็นแผงละแถว (1 QR ต่อแผง) ก่อนใช้คำนวณ/บันทึก · ตาราง Address & Unit ยังแสดงแถวดิบ
  const pdfs = itemsMode ? NONE : pdfsRaw;
  const [ack, setAck] = useState({});
  const [ackMeta, setAckMeta] = useState({});
  const [useLib, setUseLib] = useState(true);   // ซับ/พาร์ทมาจากคลังของโปรเจคเสมอ (Release ลงแค่แผง)
  const [lib, setLib] = useState(null);
  const [libState, setLibState] = useState({ s: "idle", key: "" });
  const [catOv, setCatOv] = useState({});
  const [procOv, setProcOv] = useState({});
  const [destOv, setDestOv] = useState({});              // พาร์ท → CUTTING / BENDING (office เลือก)
  const [partCfg, setPartCfg] = useState({ partMode: "auto", partGroups: [] });   // หมวดย่อยพาร์ท (Auto/Setting) จากคลังของโปรเจค
  const [afterSave, setAfterSave] = useState("lots");    // "lots" = บันทึกแล้วเลือกปล่อยเป็นล็อต · "all" = ปล่อยทั้งหมดเป็นเลข Release หลัก
  const [draftAt, setDraftAt] = useState(null);
  // ร่างที่คุ้มจะเสนอ "ทำต่อ": มีแผง / PDF / รายการที่เลือก หรืออย่างน้อยใส่เลขและเลือกโปรเจคแล้ว (แค่พิมพ์เลข P อย่างเดียว = ไม่เสนอ · กดทำต่อแล้วเหมือนไม่มีอะไรเกิดขึ้น)
  const draftWorth = (d) => !!d && !!(d.units?.length || d.pdfs?.length || d.picks?.length || d.order || (d.hdr?.ro && d.hdr?.projectId));
  const [draftOffer, setDraftOffer] = useState(() => { const d = loadDraft(); return draftWorth(d) ? d : null; });
  const [draftSrv, setDraftSrv] = useState({ id: null, at: 0 });   // ★ 2026-11-10 ร่างบนเซิร์ฟเวอร์ (ทำต่อจากเครื่องอื่นได้) · id = แถว release_plans
  // เปิดหน้ามา → ดูร่างบนเซิร์ฟเวอร์ของผู้ใช้คนนี้ ถ้าใหม่กว่าร่างในเครื่อง (หรือเครื่องนี้ไม่มี) → เสนออันนั้น
  useEffect(() => {
    if (!api?.listDrafts || !user?.id) return undefined;
    let alive = true;
    api.listDrafts(user.id).then((list) => {
      if (!alive || !list.length) return;
      const best = list.filter(draftWorth).sort((a, b) => (b.at || 0) - (a.at || 0))[0]; if (!best) return;
      setDraftOffer((cur) => { if (cur && (cur.at || 0) >= (best.at || 0)) return cur; return { ...best, fromServer: true }; });
      setDraftSrv((v) => (v.id ? v : { id: best.serverId, at: best.at || 0 }));
    }).catch(() => { /* ยังไม่รัน SQL / ออฟไลน์ — ใช้ร่างในเครื่องอย่างเดียว */ });
    return () => { alive = false; };
  }, [api, user?.id]);
  const [saving, setSaving] = useState({ busy: false, msg: "", err: "", errors: [], resume: null, done: null });
  const [roTouched, setRoTouched] = useState(false);
  const topRef = useRef(null);

  const project = projects.find((p) => p.id === hdr.projectId) || null;
  // Release / ที่อยู่ที่ใช้แล้วในโปรเจค — รวมแผน Release ที่บันทึกไว้แต่ยังปล่อยไม่ครบ (ที่อยู่ในแผนถือว่าจองแล้ว)
  const ctx = useMemo(() => {
    const c = api.projectContext(releases, project?.code);
    for (const p of plans || []) {
      if (!project || p.projectCode !== project.code) continue;
      if (!c.orders.some((o) => inPlan(o.code, p.ro))) c.orders.push({ code: p.ro, parts: 0, panels: (p.units || []).length, date: p.createdAt || p.date });
      for (const u of p.units || []) { const a = String(u.addr || "").trim().toUpperCase(); if (a && !c.usedAddr.has(a)) c.usedAddr.set(a, p.ro); }
    }
    return c;
  }, [api, releases, plans, project]);
  const libEff = lib || EMPTY_LIB;
  const unitsX = useMemo(() => expandUnits(unitsRaw, ctx.usedAddr), [unitsRaw, ctx.usedAddr]);
  const units = itemsMode ? NONE : unitsX;              // โหมด items = ไม่มีแผง/PDF แผง (ข้อมูลที่กรอกไว้ในโหมดแผงยังอยู่ — สลับกลับมาได้)

  // ── derived ──
  const bom = useMemo(() => buildBom({ lib: libEff, pdfs, ack, useLib }), [libEff, pdfs, ack, useLib]);
  const checks = useMemo(() => runChecks(pdfs, { lib: libEff, ack }), [pdfs, libEff, ack]);
  const catOf = useMemo(() => makeCatOf(bom, catOv, partCfg), [catOv, bom, partCfg]);
  const procOf = useCallback((code) => procOv[code] ?? ruleProc(code), [procOv]);
  const cnt = useMemo(() => countUnits(units, bom), [units, bom]);
  const ui = useMemo(() => unitIssues(itemsMode ? NONE : unitsRaw, ctx.usedAddr), [itemsMode, unitsRaw, ctx.usedAddr]);   // ตามแถวดิบ (ดัชนีตรงตาราง)
  const cv = useMemo(() => coverage(units, bom, pdfs, catOf), [units, bom, pdfs, catOf]);
  const roNorm0 = normalizeRO(hdr.ro);
  const orderExtra = useMemo(() => (order ? orderHw.map((c) => { const it = order.items.find((x) => NC(x.code) === NC(c)); return it ? { kind: "hw", code: it.code, qty: Number(it.qty) || 0, d: it.d || "", u: it.unit && /^m/.test(it.unit) ? "m." : "pcs.", src: order.ro || order.file, by: userName } : null; }).filter(Boolean) : []), [order, orderHw, userName]);
  const draftPlan = useMemo(() => ({ v: 1, ro: roNorm0, projectId: hdr.projectId, projectCode: project?.code || "", date: hdr.date, note: hdr.note, mod: hdr.mod, by: userName, units, bom, catOv, procOv, destOv, ...partCfg, ...(itemsMode ? { mode: "items", picks } : {}),
    ...(order ? { order: { file: order.file, ro: order.ro, roRaw: order.roRaw, projectCode: order.projectCode, zone: order.zone, note: order.note, attention: order.attention, issuedBy: order.issuedBy, date: order.date, items: order.items } } : {}), ...(orderExtra.length ? { extra: orderExtra } : {}) }),
    [roNorm0, hdr.projectId, project?.code, hdr.date, hdr.note, hdr.mod, userName, units, bom, catOv, procOv, destOv, partCfg, itemsMode, picks, order, orderExtra]);

  const plan = useMemo(() => { const p = needOf(draftPlan); p.subs.forEach((s) => { s.proc = s.procs.join(", "); }); return p; }, [draftPlan]);   // ยอดทั้งใบ + ใบงานต่อเบอร์
  // เทียบใบปะหน้ากับของที่จะอยู่ในใบ (แผง / ซับ / พาร์ท / อุปกรณ์)
  const orderCmp = useMemo(() => (order ? compareOrder(order, plan) : []), [order, plan]);
  // โหมด items: ซับ/พาร์ทมาจากคลัง — BOM ของซับมีในระบบอยู่แล้ว ไม่ตั้งทับ
  const bomSave = useMemo(() => (itemsMode ? { list: [], frac: [] } : bomForSave(bom, plan, catOf)), [bom, plan, catOf, itemsMode]);
  const openN = checks.reduce((a, r) => a + r.open, 0);

  const roNorm = normalizeRO(hdr.ro);
  const roErr = !hdr.ro.trim() ? "ยังไม่ใส่เลข Release"
    : !RELEASE_ORDER_RE.test(roNorm) ? (/\.\d+$/.test(hdr.ro.trim()) ? 'ห้ามลงท้าย ".ตัวเลข" — สงวนไว้ให้ล็อต (เช่น P-142.1)' : 'ต้องเป็นรูปแบบ "P-ตัวเลข" เช่น P-142 (ต่อท้าย "(…)" ได้)')
    : ctx.orders.some((o) => roKey(o.code) === roKey(roNorm) || inPlan(o.code, roNorm)) ? `${roNorm} มีอยู่แล้วในโปรเจคนี้ — ใช้เลขอื่น หรือเปิดใบเดิมแล้วปล่อยล็อตเพิ่ม` : "";
  const hdrErr = roErr || (!hdr.projectId ? "ยังไม่เลือกโปรเจค" : !hdr.date ? "ยังไม่เลือกวันที่" : "");
  const nextRo = useMemo(() => {
    let mx = 0; for (const o of ctx.orders) { const m = /^P-0*(\d+)/i.exec(o.code); if (m) mx = Math.max(mx, +m[1]); }
    return normalizeRO(String(mx + 1));
  }, [ctx.orders]);

  // ── BOM เดิมในระบบ: โหลดเมื่อถึงขั้น ③ (ใช้เทียบค่า + เติมเบอร์ที่ไม่มี PDF) ──
  // ★ 2026-10-16: รวมเบอร์ซับ/พาร์ทที่ "อยู่ใน BOM ของ PDF แผง" ด้วย — เดิมโหลดเฉพาะซับที่ไล่ได้จากแผงเดิมในระบบ แผงใหม่เลยไม่เห็นซับในคลัง
  const [libTick, setLibTick] = useState(0);   // กด "โหลดใหม่" หลังเพิ่มซับที่หน้า ซับ/พาร์ท ของโปรเจค
  const libCodes = [...new Set([...cnt.map((c) => c.unit), ...pdfs.filter((d) => d.kind === "sub" || d.kind === "panel").flatMap((d) => [d.code, ...(d.bom || []).map((b) => NC(b.code))])])].filter(Boolean).sort();
  const libKey = hdr.projectId + "|" + (itemsMode ? "ALL" : libCodes.join(",")) + "|" + libTick;
  const libReq = useRef("");
  useEffect(() => {
    if (step < (itemsMode ? 1 : 2) || !hdr.projectId || libReq.current === libKey) return;
    libReq.current = libKey;
    setLibState({ s: "loading", key: libKey });
    const codes = itemsMode ? null : libCodes;   // โหมด items = โหลดทั้งคลัง (ไว้ให้เลือก)
    api.loadBomLibrary(hdr.projectId, codes)
      .then((l) => { if (libReq.current === libKey) {
        setLib(l); setLibState({ s: "ok", key: libKey });
        // หมวด / งานซับ / ใบงาน ที่ตั้งไว้ในคลังของโปรเจค → ใช้เป็นค่าเริ่มของใบนี้ (ที่ตั้งในใบนี้แล้วไม่ทับ)
        const ov = l && l.ov; if (ov) { setCatOv((c) => ({ ...(ov.catOv || {}), ...c })); setProcOv((c) => ({ ...(ov.procOv || {}), ...c })); setDestOv((c) => ({ ...(ov.destOv || {}), ...c })); setPartCfg({ partMode: ov.partMode || "auto", partGroups: ov.partGroups || [] }); }
      } })
      .catch((e) => { if (libReq.current === libKey) { setLib(null); setLibState({ s: "err", key: libKey, err: String(e?.message || e) }); } });
  }, [step, hdr.projectId, libKey, api, itemsMode]);

  // ── ร่างอัตโนมัติ ──
  useEffect(() => {
    if (draftOffer || saving.done) return;
    if (!hdr.ro && !unitsRaw.length && !pdfsRaw.length && !picks.length && !order) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, at: Date.now(), step, hdr, units: unitsRaw, pdfs: pdfsRaw, ack, ackMeta, useLib, catOv, procOv, destOv, afterSave, mode, picks, order, orderHw, by: userName })); setDraftAt(new Date()); } catch { /* เต็ม/ปิดไว้ = ข้าม */ }
    }, 600);
    // ★ 2026-11-10 ร่างบนเซิร์ฟเวอร์ (หน่วง 3 วิ · ต้องเลือกโปรเจคแล้ว) — ไม่สำเร็จ = เงียบ ยังมีร่างในเครื่อง
    const t2 = setTimeout(() => {
      if (!api?.saveDraft || !user?.id || !hdr.projectId) return;
      const draft = { v: 1, at: Date.now(), step, hdr, units: unitsRaw, pdfs: pdfsRaw.map(({ _file, ...d }) => d), ack, ackMeta, useLib, catOv, procOv, destOv, afterSave, mode, picks, order, orderHw, by: userName };
      api.saveDraft({ projectId: hdr.projectId, userId: user.id, draft, id: draftSrv.id }).then((id) => { if (id) setDraftSrv({ id, at: draft.at }); }).catch(() => {});
    }, 3000);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [step, hdr, unitsRaw, pdfsRaw, ack, ackMeta, useLib, catOv, procOv, destOv, afterSave, mode, picks, order, orderHw, draftOffer, saving.done, userName]);   // eslint-disable-line react-hooks/exhaustive-deps
  function resumeDraft() {
    const d = draftOffer; if (!d) return;
    setHdr({ ...hdr, ...d.hdr }); setUnits(d.units || []); setPdfs(d.pdfs || []); setAck(d.ack || {}); setAckMeta(d.ackMeta || {});
    setMode(d.mode === "items" ? "items" : "panel"); setPicks(d.picks || []); setOrder(d.order || null); setOrderHw(d.orderHw || []);
    setUseLib(true); setCatOv(d.catOv || {}); setProcOv(d.procOv || {}); setDestOv(d.destOv || {}); setAfterSave(d.afterSave || "lots");
    setStep(Math.min(3, d.step === 2 && d.mode === "items" ? 1 : d.step || 0)); setDraftOffer(null);
    if (d.serverId) setDraftSrv({ id: d.serverId, at: d.at || 0 });
  }
  // ลบร่างบนเซิร์ฟเวอร์ (บันทึกใบสำเร็จ / กดเริ่มใหม่)
  const dropSrvDraft = (id) => { const k = id || draftSrv.id; if (k && api?.dropDraft) api.dropDraft(k).catch(() => {}); setDraftSrv({ id: null, at: 0 }); };
  // ── ★ ย้อนกลับ / ทำซ้ำ (Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y) — เก็บภาพสถานะข้อมูลทั้งใบ (หัวใบ · Address · PDF · การตัดสิน · หมวด/งาน/ปลายทาง) ──
  //   รวมการพิมพ์ติด ๆ กันเป็นก้าวเดียว (หน่วง 350ms) · เก็บย้อนหลังสูงสุด 60 ก้าว · ไม่นับการเปลี่ยนขั้น
  const HKEYS = ["hdr", "units", "pdfs", "ack", "ackMeta", "catOv", "procOv", "destOv", "afterSave", "mode", "picks"];
  const snapNow = { hdr, units: unitsRaw, pdfs: pdfsRaw, ack, ackMeta, catOv, procOv, destOv, afterSave, mode, picks };
  const latestSnap = useRef(snapNow); latestSnap.current = snapNow;
  const hist = useRef({ past: [], future: [], cur: null, t: 0 });
  const [hv, setHv] = useState({ u: 0, r: 0 });
  const sameSnap = (a, b) => HKEYS.every((k) => a[k] === b[k]);
  const syncHv = () => setHv({ u: hist.current.past.length, r: hist.current.future.length });
  const flushHist = () => {
    const h = hist.current; clearTimeout(h.t);
    if (h.cur && !sameSnap(h.cur, latestSnap.current)) { h.past.push(h.cur); if (h.past.length > 60) h.past.shift(); h.future = []; h.cur = latestSnap.current; }
  };
  useEffect(() => {
    const h = hist.current;
    if (!h.cur) { h.cur = latestSnap.current; return; }
    clearTimeout(h.t);
    h.t = setTimeout(() => { flushHist(); syncHv(); }, 350);
    return () => clearTimeout(h.t);
  }, [hdr, unitsRaw, pdfsRaw, ack, ackMeta, catOv, procOv, destOv, afterSave, mode, picks]);   // eslint-disable-line react-hooks/exhaustive-deps
  function applySnap(t) {
    setHdr(t.hdr); setUnits(t.units); setPdfs(t.pdfs); setAck(t.ack); setAckMeta(t.ackMeta);
    setCatOv(t.catOv); setProcOv(t.procOv); setDestOv(t.destOv); setAfterSave(t.afterSave); setMode(t.mode || "panel"); setPicks(t.picks || []);
  }
  function undo() {
    if (saving.busy || saving.done) return;
    const h = hist.current; flushHist();
    if (!h.past.length) { syncHv(); return; }
    const t = h.past.pop(); h.future.push(h.cur); h.cur = t; applySnap(t); syncHv();
  }
  function redo() {
    if (saving.busy || saving.done) return;
    const h = hist.current; flushHist();
    if (!h.future.length) { syncHv(); return; }
    const t = h.future.pop(); h.past.push(h.cur); h.cur = t; applySnap(t); syncHv();
  }
  const undoRef = useRef({}); undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); undoRef.current.redo(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  function dropDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } dropSrvDraft(draftOffer?.serverId || null); setDraftOffer(null); }

  // ── ใบปะหน้า: อ่านไฟล์ → เติมหัวใบ (เลข / โปรเจค / หมายเหตุ) ที่ยังว่าง ──
  const [orderMsg, setOrderMsg] = useState(null);
  async function onOrderFile(list) {
    const f = [...list].find((x) => /\.(pdf|xlsx?|xlsm)$/i.test(x.name)); if (!f) { setOrderMsg({ bad: "วางไฟล์ใบปะหน้าเป็น PDF หรือ Excel (.xls/.xlsx)" }); return; }
    setOrderMsg({ info: `กำลังอ่าน ${f.name}…` });
    try {
      const o = await readOrderFile(f);
      if (!o.items.length) { setOrderMsg({ bad: `อ่าน ${f.name} ไม่ได้รายการ — ${o.warn.join(" · ") || "ไม่พบตาราง Item / Part No. / Qty (ใช่ฟอร์ม Release for Production / Order ไหม)"}` }); return; }
      setOrder(o); setOrderHw([]);
      const patch = {};
      if (o.ro && !hdr.ro.trim()) patch.ro = o.ro;
      if (!hdr.projectId && o.projectCode) {
        const pc = NC(o.projectCode); const full = NC(o.projectFull || "");
        const hit = projects.filter((p) => { const c = NC(p.code); return c === full || c === pc || c.startsWith(pc + "-") || c.startsWith(pc); });
        if (hit.length === 1) patch.projectId = hit[0].id;
      }
      if (o.zone && !hdr.note.trim()) patch.note = o.zone;
      if (Object.keys(patch).length) setHdr((h) => ({ ...h, ...patch }));
      const notes = [`${o.file}: ${o.roRaw || o.ro || "ไม่มีเลข Release"} · ${o.items.length} รายการ`];
      if (o.ro && hdr.ro.trim() && roKey(hdr.ro) !== roKey(o.ro)) notes.push(`เลขในใบปะหน้าเป็น ${o.ro} แต่ช่อง Release เป็น ${normalizeRO(hdr.ro)} — ตรวจด้วย`);
      if (o.projectCode && !patch.projectId && !hdr.projectId) notes.push(`หาโปรเจค ${o.projectFull || o.projectCode} ในระบบไม่เจอ — เลือกเอง`);
      if (o.warn.length) notes.push(o.warn.join(" · "));
      setOrderMsg({ ok: notes });
    } catch (e) { setOrderMsg({ bad: "อ่านใบปะหน้าไม่ได้: " + (e?.message || e) }); }
  }
  const [orderDrag, setOrderDrag] = useState(false);
  const orderRef = useRef(null);
  // ★ 2026-11-10 มาจากกล่องรับเอกสาร: ใบปะหน้า → อ่านเติมหัวใบ · แบบ PDF → ใส่ขั้นอัพ PDF ให้ (แผง/แบบ Site Item) · ซับ/พาร์ท → เก็บไว้วางที่ขั้นเลือกซับ/พาร์ท
  const initRef = useRef(false);
  const [pendingPdfs, setPendingPdfs] = useState([]);   // แบบซับ/พาร์ทจาก inbox ที่รอวางในขั้น "เลือกซับ / พาร์ท"
  useEffect(() => {
    if (!initialFiles || !initialFiles.length || initRef.current) return; initRef.current = true;
    (async () => {
      const sheets = initialFiles.filter((f) => /\.(xlsx?|xlsm)$/i.test(f.name)); const pdfs = initialFiles.filter((f) => /\.pdf$/i.test(f.name));
      let all = []; try { all = pdfs.length ? await readPdfFiles(pdfs) : []; } catch { /* ignore */ }
      const drawings = []; const sheetPdfs = [];
      for (const d of all) { if (d.kind === "unknown" && d._file) sheetPdfs.push(d._file); else drawings.push(d); }
      const first = sheets[0] || sheetPdfs[0]; if (first) await onOrderFile([first]);
      const panelish = drawings.filter((d) => d.kind === "panel" || d.kind === "loose"); const subpart = drawings.filter((d) => d.kind === "sub" || d.kind === "part");
      if (panelish.length) setPdfs((old) => { const names = new Set(panelish.map((d) => d.file)); return [...old.filter((d) => !names.has(d.file)), ...panelish]; });
      if (subpart.length) { setPendingPdfs(subpart.map((d) => d._file).filter(Boolean)); if (!panelish.length) setMode("items"); }
    })();
  }, [initialFiles]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── สถานะแต่ละขั้น (โชว์ในแถบขั้น) ──
  const saveChecks = useMemo(() => {
    const noBom = cnt.filter((r) => !r.has);
    const missSub = cv.subs.filter((x) => x.src === "none").length, missPart = cv.parts.filter((x) => x.src === "none").length;
    const noProc = plan.subs.filter((s) => !s.procs.length);
    const all = [
      { k: "hdr", label: "หัวใบ Release", v: hdrErr || `${roNorm}${hdr.note ? " · " + hdr.note : ""} · ${fmtYmd(hdr.date)} · ${project?.code || ""} · ผู้จัดทำ ${userName}`, s: hdrErr ? "block" : "ok", go: 0 },
      { k: "units", label: "Address & Unit", v: units.length ? `${nf(units.length)} แผง${units.some((r) => r.mock) ? ` (Mockup ${units.filter((r) => r.mock).length})` : ""} · ${cnt.length} แบบ${ui.block.length ? " · " + ui.block.join(" · ") : ""}${ui.warn.length ? " · " + ui.warn.join(" · ") : ""}` : "ยังไม่มีที่อยู่", s: !units.length || ui.block.length ? "block" : ui.warn.length ? "warn" : "ok", go: 1 },
      { k: "bom", label: "แบบแผงมี BOM", v: noBom.length ? `ยังไม่มี ${noBom.length} แบบ: ${noBom.slice(0, 6).map((r) => r.unit).join(", ")}${noBom.length > 6 ? " …" : ""} — ได้ QR แผงแต่ยังไม่แตกเป็นซับ/พาร์ท` : `ครบ ${cnt.length} แบบ`, s: noBom.length ? "warn" : "ok", go: 2 },
      { k: "pdf", label: "PDF ซับ / พาร์ท", v: missSub || missPart ? `ยังขาด PDF ซับ ${missSub} · พาร์ท ${missPart} (ไม่รู้ลูกของซับ / INV วัตถุดิบ)` : "ครบ", s: missSub || missPart ? "warn" : "ok", go: 2 },
      { k: "ack", label: "ค่าที่ไม่ตรงใน PDF", v: openN ? `ยังไม่ได้ตัดสิน ${openN} จุด (บันทึกเลย = ใช้ตาม PDF)` : "ไม่มี / ตัดสินครบแล้ว", s: openN ? "warn" : "ok", go: 2 },
      ...(bomSave.frac.length ? [{ k: "frac", label: "จำนวนต่อชุดไม่ลงตัว", v: `${bomSave.frac.length} รายการ — BOM เก็บจำนวนเต็ม ระบบปัดให้: ${bomSave.frac.slice(0, 3).join(" · ")}${bomSave.frac.length > 3 ? " …" : ""}`, s: "warn", go: 3 }] : []),
      { k: "proc", label: "งานของซับ", v: noProc.length ? `${noProc.length} เบอร์ยังไม่ได้เลือกงาน (พับ / เชื่อม / ยิง / Site Item): ${noProc.slice(0, 5).map((s) => s.code).join(", ")} — เลือกได้ในแท็บ "ใบงาน + Category"` : `ครบ ${plan.subs.length} เบอร์ (1 ซับไปได้หลายใบ)`, s: noProc.length ? "warn" : "ok", go: 3, tab: "items" },
      { k: "after", label: "หลังบันทึก", v: afterSave === "all" ? `ปล่อยทั้งหมดเป็น ${roNorm} ทันที (แผง ${nf(units.length)} · ซับ ${nf(plan.subs.length)} เบอร์ · พาร์ท ${nf(plan.parts.length)} เบอร์)` : `เปิดหน้า Release ${roNorm || ""} ให้ office เลือกปล่อยเป็นล็อต ${roNorm ? roNorm + ".1" : ""} …`, s: "ok", go: 3 },
    ];
    if (order) {
      const miss = orderCmp.filter((x) => x.status === "missing"), diff = orderCmp.filter((x) => x.status === "more" || x.status === "less");
      const v = miss.length || diff.length
        ? [miss.length && `ยังไม่อยู่ในใบ ${miss.length} รายการ: ${miss.slice(0, 5).map((x) => `${x.code} ×${nlen(x.qty)}`).join(", ")}${miss.length > 5 ? " …" : ""}`, diff.length && `จำนวนไม่ตรง ${diff.length}: ${diff.slice(0, 4).map((x) => `${x.code} ใบปะหน้า ${nlen(x.qty)} / ใบนี้ ${nlen(x.have)}`).join(", ")}${diff.length > 4 ? " …" : ""}`].filter(Boolean).join(" · ")
        : `ครบตามใบปะหน้า ${order.roRaw || order.ro || order.file} — ${order.items.length} รายการ`;
      all.splice(1, 0, { k: "order", label: "ตามใบปะหน้า", v, s: miss.length || diff.length ? "warn" : "ok", go: itemsMode ? 1 : 2 });
    }
    if (!itemsMode) return all;
    // โหมด items: ไม่มีที่อยู่ / แผง / PDF — เหลือ หัวใบ + เลือกซับ·พาร์ท + งานของซับ + หลังบันทึก
    const by = (k) => all.find((x) => x.k === k);
    const nS = picks.filter((x) => x.kind === "sub").length, nP = picks.length - nS;
    const lost = picks.filter((x) => !findKey(x.kind === "sub" ? bom.subs : bom.parts, x.code));
    const bare = picks.filter((x) => { const k = x.kind === "sub" ? findKey(bom.subs, x.code) : null; return k && !(bom.subs[k].items || []).length; });
    const after = { ...by("after"), v: afterSave === "all" ? `ปล่อยทั้งหมดเป็น ${roNorm} ทันที (ซับ ${nf(plan.subs.length)} เบอร์ · พาร์ท ${nf(plan.parts.length)} เบอร์)` : by("after").v };
    return [
      by("hdr"), ...(by("order") ? [by("order")] : []),
      { k: "picks", label: "เลือกซับ / พาร์ท", v: !picks.length ? "ยังไม่ได้เลือกเบอร์" : lost.length ? `ไม่พบในคลังของโปรเจค ${lost.length} เบอร์: ${lost.slice(0, 5).map((x) => x.code).join(", ")}` : `เลือกซับ ${nf(nS)} · พาร์ท ${nf(nP)} เบอร์ → รวมลูกที่แตกให้แล้ว ซับ ${nf(plan.subs.length)} · พาร์ท ${nf(plan.parts.length)} เบอร์`, s: !picks.length || lost.length ? "block" : "ok", go: 1 },
      ...(bare.length ? [{ k: "bare", label: "ซับที่ยังไม่มีเบอร์ลูก", v: `${bare.length} เบอร์: ${bare.slice(0, 5).map((x) => x.code).join(", ")} — ปล่อยได้แต่ไม่แตกลูก · ลงแบบซับที่หน้า "ซับ / พาร์ท ของโปรเจค" ก่อนจะได้เบอร์ลูก`, s: "warn", go: 1 }] : []),
      by("proc"), after,
    ];
  }, [cnt, cv, plan, hdrErr, roNorm, hdr, project, userName, units, ui, openN, bomSave, afterSave, itemsMode, picks, bom, order, orderCmp]);
  const stepInfo = (k) => {
    if (k === 0) return hdrErr ? ["warn", hdrErr] : ["", `${roNorm} · ${fmtYmd(hdr.date)}`];
    if (k === 1 && itemsMode) return !picks.length ? ["warn", "ยังไม่ได้เลือก"] : ["", `ซับ ${nf(picks.filter((x) => x.kind === "sub").length)} · พาร์ท ${nf(picks.filter((x) => x.kind !== "sub").length)} เบอร์`];
    if (k === 1) return !units.length ? ["warn", "ยังไม่มีที่อยู่"] : [ui.block.length ? "warn" : "", `${nf(units.length)} แผง · ${cnt.length} แบบ${ui.block.length ? " · ต้องแก้" : ""}`];
    if (k === 2) return [openN ? "warn" : "", pdfs.length ? `${pdfs.length} ไฟล์${openN ? ` · รอตัดสิน ${openN}` : " · ตรวจครบ"}` : "ยังไม่มีไฟล์"];
    const b = saveChecks.filter((x) => x.s === "block").length, w = saveChecks.filter((x) => x.s === "warn").length;
    return step < 3 ? ["", "ตรวจ + บันทึก"] : [b ? "bad" : w ? "warn" : "", b ? "ยังบันทึกไม่ได้" : w ? `${w} เรื่องควรดู` : "พร้อมบันทึก"];
  };
  const go = (i) => {
    const n = Math.max(0, Math.min(3, i));
    if (n > 0 && step === 0 && hdrErr) { setRoTouched(true); return; }
    setStep(n); setRoTouched(true);
    try { topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); } catch { /* ignore */ }
  };
  const VIS = itemsMode ? [0, 1, 3] : [0, 1, 2, 3];   // ขั้นที่แสดง (โหมด items ข้ามขั้น ③ อัพ PDF แผง)
  const stepLabel = (k) => (itemsMode && k === 1 ? "เลือกซับ / พาร์ท" : STEPS[k]);
  const visIdx = Math.max(0, VIS.indexOf(step));
  const decide = (key, v) => { setAck((a) => ({ ...a, [key]: v })); setAckMeta((m) => ({ ...m, [key]: { by: userName, at: new Date().toISOString() } })); };

  // ── บันทึก ──
  //   1) บันทึกแผน Release (ที่อยู่ + BOM + งานซับ/ใบงานพาร์ท) + ตั้ง part_master / BOM ในระบบ — ยังไม่สร้าง QR
  //   2) "lots" → เปิดหน้า Release ให้ office เลือกปล่อยเป็นล็อต · "all" → ปล่อยทั้งหมดเป็นเลข Release หลักทันที
  //   DB ยังไม่รัน migration-release-plans.sql → ถามแล้วปล่อยทั้งใบแบบเดิม (ไม่มีล็อต)
  async function doSave() {
    if (saving.busy) return;
    const blocks = saveChecks.filter((x) => x.s === "block");
    if (blocks.length) { setSaving((s) => ({ ...s, err: "บันทึกไม่ได้ — " + blocks.map((b) => `${b.label}: ${b.v}`).join(" · ") })); return; }
    // ★ 2026-11-10 แบบยังมาไม่ครบตามใบปะหน้า → ถามยืนยันก่อน (บันทึกได้ · เพิ่มทีหลังที่หน้า Release → "เพิ่มรายการ")
    if (order && !saving.resume) {
      const miss = orderCmp.filter((x) => x.status === "missing" && !orderHw.some((h) => NC(h) === NC(x.code)));
      const diff = orderCmp.filter((x) => x.status === "less" || x.status === "more");
      if (miss.length || diff.length) {
        const ok = await askConfirm({
          title: `แบบยังมาไม่ครบตามใบปะหน้า ${order.roRaw || order.ro || ""} — บันทึกเลยไหม?`,
          message: [
            miss.length && `ยังไม่อยู่ในใบ ${miss.length} เบอร์ (ไม่มีแบบ / ไม่มีในคลัง):\n${miss.map((x) => `  • ${x.code} ×${nlen(x.qty)}${x.unit ? " " + x.unit : ""}${x.d ? " — " + x.d : ""}`).join("\n")}`,
            diff.length && `จำนวนไม่ตรง ${diff.length} เบอร์:\n${diff.map((x) => `  • ${x.code} ใบปะหน้า ${nlen(x.qty)} / ใบนี้ ${nlen(x.have)}`).join("\n")}`,
            `\nบันทึกได้ก่อน — พอแบบมาเพิ่ม เปิดหน้า Release ${roNorm} → ปุ่ม "เพิ่มรายการ" แล้ววาง PDF (หน้านั้นจะเตือนรายการที่ยังขาดให้)\nถ้าเป็นสกรู / น็อต / ยาง ให้ติ๊ก "ไม่มี QR" ในตารางตามใบปะหน้าแทน`,
          ].filter(Boolean).join("\n\n"),
          tone: "warn", confirmText: "บันทึก · เพิ่มทีหลัง", cancelText: "กลับไปวางแบบ",
        });
        if (!ok) return;
      }
    }
    const warns = saveChecks.filter((x) => x.s === "warn" && x.k !== "order");
    if (warns.length && !saving.resume) {
      const ok = await askConfirm({ title: `บันทึกทั้งที่ยังมี ${warns.length} เรื่องควรดู?`, message: warns.map((w) => `• ${w.label}: ${w.v}`).join("\n"), tone: "warn", confirmText: "บันทึก Release", cancelText: "กลับไปแก้" });
      if (!ok) return;
    }
    const decisions = {}; for (const [k, v] of Object.entries(ack)) decisions[k] = { v, ...(ackMeta[k] || {}) };
    const planObj = { ...draftPlan, ro: roNorm, createdAt: new Date().toISOString(), bom: trimBom(bom, plan), pdfs: pdfs.map((d) => ({ file: d.file, kind: d.kind, code: d.code })), decisions };
    const say = (msg) => setSaving((s) => ({ ...s, msg }));
    setSaving({ busy: true, msg: "เริ่มบันทึก…", err: "", errors: [], resume: saving.resume, done: null });
    try {
      const st = await api.savePlan({ plan: planObj, need: plan, bomSave, userId: user?.id || null }, say, saving.resume);
      if (st.errors && st.errors.length) { setSaving({ busy: false, msg: "", err: "", errors: st.errors, resume: st, done: null }); return; }
      const saved = { ...planObj, id: st.id };
      let lotNo = null;
      if (afterSave === "all") {
        const sel = { addrs: new Set(units.map((u) => String(u.addr).trim().toUpperCase())), subs: new Map(plan.subs.map((s) => [s.code, s.qty])), parts: new Map(plan.parts.map((p) => [p.code, p.qty])) };
        await api.releaseLot({ plan: saved, lotNo: roNorm, date: dateToIso(hdr.date), userId: user?.id || null, rows: lotRows(saved, plan, sel, hdr.note) }, say);
        lotNo = roNorm;
      }
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      dropSrvDraft();
      setSaving({ busy: false, msg: "", err: "", errors: [], resume: null, done: st });
      onSaved && onSaved({ plan: saved, lotNo, releaseOrder: roNorm, projectId: hdr.projectId, projectCode: project?.code });
    } catch (e) {
      if (e?.code === "not_installed") {
        setSaving({ busy: false, msg: "", err: "", errors: [], resume: null, done: null });
        const ok = await askConfirm({ title: "ฐานข้อมูลยังไม่รองรับการปล่อยเป็นล็อต", message: "ยังไม่ได้รัน migration-release-plans.sql ใน Supabase\n\nปล่อยทั้งใบเลยแบบเดิม (สร้าง QR ทุกอย่างในเลข " + roNorm + ") หรือกลับไปก่อน แล้วให้แอดมินรัน SQL", tone: "warn", confirmText: "ปล่อยทั้งใบเลย", cancelText: "กลับไปก่อน" });
        if (!ok) return;
        setSaving({ busy: true, msg: "เริ่มบันทึก…", err: "", errors: [], resume: null, done: null });
        try {
          const make = { panels: true, subs: true, parts: true };
          const st = await api.saveRelease({ projectId: hdr.projectId, releaseOrder: roNorm, releaseDate: dateToIso(hdr.date), userId: user?.id || null, modNo: hdr.mod, note: hdr.note, plan, bomSave, make }, say, null);
          try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
          dropSrvDraft();
          setSaving({ busy: false, msg: "", err: "", errors: st.errors || [], resume: null, done: st });
          onSaved && onSaved({ legacy: true, releaseOrder: roNorm, projectId: hdr.projectId, projectCode: project?.code, make, plan });
        } catch (e2) { setSaving({ busy: false, msg: "", err: "บันทึกไม่สำเร็จ: " + (e2?.message || e2), errors: [], resume: null, done: null }); }
        return;
      }
      setSaving({ busy: false, msg: "", err: (e?.code === "exists" ? "" : "บันทึกไม่สำเร็จ: ") + (e?.message || e), errors: [], resume: saving.resume, done: null });
    }
  }

  // ── UI ──
  const nextLabel = itemsMode ? ["สร้าง Release →", "ถัดไป: ตรวจและบันทึก →"][visIdx] : ["สร้าง Release →", "ถัดไป: อัพ PDF →", "ถัดไป: ตรวจและบันทึก →"][step];
  const [, curSub] = stepInfo(step);
  return (
    <div className="rw" ref={topRef}>
      <div className="page-head rw-head">
        <div>
          <div className="rw-crumb"><button type="button" className="rw-link" onClick={onCancel}>ปล่อยงาน (Release)</button> <span>/</span> ปล่อยงานใหม่</div>
          <div className="page-title">ปล่อยงานใหม่</div>
          <div className="page-sub">{itemsMode ? "สร้าง Release → เลือกซับ / พาร์ท จากคลังของโปรเจค → ตรวจและบันทึก · ระบบแตกลูกของซับและสร้าง QR ให้" : "สร้าง Release → ลงที่อยู่ → อัพ PDF แบบ → ตรวจและบันทึก · ระบบนับแผง สร้าง BOM และ QR ให้"}</div>
        </div>
        <div className="rw-head-right">
          {draftAt ? <span className="rw-saved" title="ปิดหน้าแล้วกลับมาทำต่อได้"><span className="dot" aria-hidden="true" />บันทึกร่างอัตโนมัติ {hhmm(draftAt)}</span> : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}><Icon name="close" size={14} /> ปิด</button>
        </div>
      </div>

      {draftOffer ? (
        <div className="rw-banner info">
          <Icon name="clock" size={18} />
          <div><b>มีร่างค้างไว้</b>{draftOffer.fromServer ? <> <span className="rw-muted">(จากเครื่องอื่น · {draftOffer.by || user?.name || ""})</span></> : null} — {draftOffer.hdr?.ro || "(ยังไม่ใส่เลข)"} · ขั้น {Math.min(4, (draftOffer.step || 0) + 1)} · {draftOffer.mode === "items" ? `${nf(draftOffer.picks?.length || 0)} รายการ` : `${nf(draftOffer.units?.length || 0)} แผง`} · {draftOffer.pdfs?.length || 0} PDF · {new Date(draftOffer.at).toLocaleString("th-TH")}{draftOffer.pdfs?.length ? <span className="rw-muted"> · ข้อมูลที่อ่านจาก PDF อยู่ครบ (ตัวไฟล์ต้องวางใหม่ถ้าจะเก็บเข้าคลัง)</span> : null}</div>
          <div className="rw-banner-act"><button type="button" className="btn btn-accent btn-sm" onClick={resumeDraft}>ทำต่อ</button><button type="button" className="btn btn-ghost btn-sm" onClick={dropDraft}>เริ่มใหม่</button></div>
        </div>
      ) : null}

      <div className="rw-steps" role="list" style={{ gridTemplateColumns: `repeat(${VIS.length}, minmax(0, 1fr))` }}>
        {VIS.map((k, vi) => { const [st, sub] = stepInfo(k); return (
          <button key={k} type="button" role="listitem" className={`rw-step ${k === step ? "on" : k < step ? "done" : ""} ${st}`} aria-current={k === step ? "step" : undefined} onClick={() => go(k)}>
            <span className="n">{k < step && !st ? "✓" : vi + 1}</span>
            <span className="st"><b>{stepLabel(k)}</b><small>{sub}</small></span>
          </button>); })}
      </div>

      {step === 0 && (
        <div className="card rw-card">
          <SecHead title="ข้อมูล Release" sub={`หัวใบนี้ใช้กับทุกชีตและใบสั่งผลิต · ผู้จัดทำ = คนที่ล็อกอิน (${userName})`} />
          {/* ★ 2026-11-10 ใบปะหน้า Release (FM(DE)-03) — วางก่อน: ได้เลข / โปรเจค / รายการเบอร์ + จำนวนที่ต้องมี → ขั้นถัดไปเทียบกับแบบที่วาง */}
          {!order ? (
            <div className={`rw-drop rw-drop-sm ${orderDrag ? "drag" : ""}`} role="button" tabIndex={0} style={{ marginBottom: 12 }}
              onClick={() => orderRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); orderRef.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setOrderDrag(true); }} onDragLeave={() => setOrderDrag(false)}
              onDrop={(e) => { e.preventDefault(); setOrderDrag(false); onOrderFile(e.dataTransfer.files); }}>
              <div className="rw-drop-ic"><Icon name="plus" size={18} /></div>
              <div><b>วางใบปะหน้า Release (Release for Production / Order · FM(DE)-03) — PDF หรือ Excel <span className="rw-opt">ถ้ามี</span></b><span>ระบบอ่านเลข Release · โปรเจค · Location/Zone · รายการ Part No. + จำนวน → เติมหัวใบให้ และใช้เทียบกับแบบที่วางในขั้นถัดไป ว่าครบ/ขาดเบอร์ไหน จำนวนตรงไหม</span></div>
              <input ref={orderRef} type="file" accept=".pdf,.xls,.xlsx,.xlsm,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-testid="order-input" onChange={(e) => { onOrderFile(e.target.files); e.target.value = ""; }} />
            </div>
          ) : (
            <div className="rw-order">
              <div className="rw-order-h">
                <b>ใบปะหน้า {order.roRaw || order.ro || order.file}</b>
                <span className="rw-muted">{[order.projectName, order.zone && `Zone: ${order.zone}`, order.issuedBy && `โดย ${order.issuedBy}`, order.date && fmtYmd(order.date)].filter(Boolean).join(" · ")} · {order.items.length} รายการ</span>
                <button type="button" className="rw-link" onClick={() => { setOrder(null); setOrderHw([]); setOrderMsg(null); }}>เอาออก</button>
              </div>
              <div className="rw-order-items">{order.items.map((it) => <span key={it.code} className="rw-pick-chip part" title={it.d}>{it.code} <b>×{nlen(it.qty)}{it.unit ? ` ${it.unit}` : ""}</b></span>)}</div>
              {order.note ? <div className="rw-muted small">NOTE: {order.note}</div> : null}
            </div>
          )}
          {orderMsg ? <div className={`rw-msg ${orderMsg.bad ? "bad" : orderMsg.info ? "info" : "ok"}`} style={{ marginBottom: 10 }}>{orderMsg.bad || orderMsg.info || orderMsg.ok.map((t, i) => <div key={i}>✓ {t}</div>)} {orderMsg.ok || orderMsg.bad ? <button type="button" className="rw-link" onClick={() => setOrderMsg(null)}>ปิด</button> : null}</div> : null}
          <div className="rw-mode" role="radiogroup" aria-label="โหมดการปล่อยงาน">
            <button type="button" role="radio" aria-checked={!itemsMode} className={`rw-mode-opt ${!itemsMode ? "on" : ""}`} onClick={() => setMode("panel")}>
              <b>🏢 ปล่อยแผง (มีที่อยู่)</b><small>ลง Address &amp; Unit + อัพ PDF แบบแผง → ระบบแตกเป็นซับ / พาร์ท ให้เอง</small>
            </button>
            <button type="button" role="radio" aria-checked={itemsMode} className={`rw-mode-opt ${itemsMode ? "on" : ""}`} onClick={() => setMode("items")}>
              <b>🔩 ปล่อยเฉพาะซับ / พาร์ท</b><small>ไม่มีแผง — เลือกเบอร์จากคลังของโปรเจค ใส่จำนวน (ซับแตกลูกให้ด้วย)</small>
            </button>
          </div>
          <div className="rw-hdr">
            <div className={`field ${roTouched && roErr ? "fld-err" : ""}`}>
              <div className="label-el">Release *</div>
              <input className="input rw-mono" value={hdr.ro} placeholder={nextRo || "P-142"} autoFocus
                onChange={(e) => setHdr({ ...hdr, ro: e.target.value })} onBlur={() => { setRoTouched(true); if (hdr.ro.trim()) setHdr((h) => ({ ...h, ro: normalizeRO(h.ro) })); }} />
              <div className={roTouched && roErr ? "fld-err-msg" : "rw-hint"}>{roTouched && roErr ? roErr : "เลขใบปล่อยงาน เช่น P-142 · พิมพ์ 142 ก็ได้"}</div>
            </div>
            <div className="field"><div className="label-el">วันที่ *</div><input className="input" type="date" value={hdr.date} onChange={(e) => setHdr({ ...hdr, date: e.target.value })} /></div>
            <div className={`field ${roTouched && !hdr.projectId ? "fld-err" : ""}`}>
              <div className="label-el">โปรเจค *</div>
              <div className="rw-inline">
                <select className="select" value={hdr.projectId} onChange={(e) => setHdr({ ...hdr, projectId: e.target.value })}>
                  <option value="">— เลือกโปรเจค —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
                {onNeedProject ? <button type="button" className="btn btn-ghost btn-sm" onClick={onNeedProject} title="เพิ่มโปรเจคใหม่"><Icon name="plus" size={14} /></button> : null}
              </div>
            </div>
            <div className="field"><div className="label-el">หมายเหตุหัวใบ</div><input className="input" value={hdr.note} placeholder="เช่น L25" onChange={(e) => setHdr({ ...hdr, note: e.target.value })} /><div className="rw-hint">ต่อท้ายเลข Release ในหัวกระดาษ</div></div>
            <div className="field"><div className="label-el">Modify <span className="rw-opt">ถ้ามี</span></div><input className="input" value={hdr.mod} placeholder="เช่น M-001 (ใบแก้)" onChange={(e) => setHdr({ ...hdr, mod: e.target.value })} /></div>
          </div>
          {project ? (
            <div className="rw-exist">
              <span>Release ในโปรเจคนี้:</span>
              {ctx.orders.length ? ctx.orders.slice(0, 8).map((o) => <Pill key={o.code} tone="muted">{o.code}{o.panels ? ` · ${nf(o.panels)} แผง` : ""}</Pill>) : <span className="rw-muted">ยังไม่มี</span>}
              {ctx.orders.length > 8 ? <span className="rw-muted">… อีก {ctx.orders.length - 8}</span> : null}
              {nextRo ? <> · เลขถัดไป <button type="button" className="rw-link" onClick={() => setHdr({ ...hdr, ro: nextRo })}>{nextRo}</button></> : null}
            </div>
          ) : null}
        </div>
      )}

      {step === 1 && !itemsMode && <UnitsStep units={unitsRaw} total={units.length} setUnits={setUnits} usedAddr={ctx.usedAddr} ui={ui} cnt={cnt} pdfs={pdfs} demoTools={demoTools} go={go} />}
      {step === 1 && itemsMode && <PicksStep project={project} picks={picks} setPicks={setPicks} bom={bom} lib={lib} libState={libState} catOf={catOf} onReloadLib={() => setLibTick((t) => t + 1)} api={api} userName={userName} order={order} orderCmp={orderCmp} orderHw={orderHw} setOrderHw={setOrderHw} pendingPdfs={pendingPdfs} onPendingDone={() => setPendingPdfs([])} />}

      {step === 2 && !itemsMode && (
        <PdfStep onReloadLib={() => setLibTick((t) => t + 1)} pdfs={pdfs} setPdfs={setPdfs} checks={checks} cv={cv} units={units} useLib={useLib} setUseLib={setUseLib}
          libState={libState} lib={lib} ack={ack} ackMeta={ackMeta} decide={decide} openN={openN} demoTools={demoTools} order={order} orderCmp={orderCmp} orderHw={orderHw} setOrderHw={setOrderHw} />
      )}

      {step === 3 && (
        <SaveStep itemsMode={itemsMode} releases={releases} draftPlan={draftPlan} saveChecks={saveChecks} go={go} plan={plan} units={units} cnt={cnt} roNorm={roNorm}
          project={project} catOf={catOf} catOv={catOv} setCatOv={setCatOv} procOf={procOf} setProcOv={setProcOv} destOv={destOv} setDestOv={setDestOv}
          afterSave={afterSave} setAfterSave={setAfterSave} bomSave={bomSave} saving={saving} hdr={hdr} />
      )}

      <div className="rw-grow" aria-hidden="true" />
      <div className="rw-actionbar">
        <button type="button" className="btn btn-ghost" onClick={() => (step === 0 ? onCancel() : go(VIS[Math.max(0, visIdx - 1)]))} disabled={saving.busy}>
          {step === 0 ? "ยกเลิก" : "← ย้อนกลับ"}
        </button>
        <div className="rw-undo">
          <button type="button" className="btn btn-ghost btn-sm" onClick={undo} disabled={!hv.u || saving.busy} title="ย้อนกลับ (Ctrl+Z)">↶ ย้อน{hv.u ? ` (${hv.u})` : ""}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={redo} disabled={!hv.r || saving.busy} title="ทำซ้ำ (Ctrl+Shift+Z / Ctrl+Y)">↷ ทำซ้ำ</button>
        </div>
        <div className="rw-navsum"><b>ขั้น {visIdx + 1} จาก {VIS.length}</b> · {stepLabel(step)}{curSub ? <span className="rw-muted"> — {curSub}</span> : null}</div>
        {step < 3
          ? <button type="button" className="btn btn-accent" onClick={() => go(VIS[Math.min(VIS.length - 1, visIdx + 1)])}>{nextLabel}</button>
          : <button type="button" className="btn btn-accent" onClick={doSave} disabled={saving.busy}>{saving.busy ? "กำลังบันทึก…" : saving.resume ? "บันทึกขั้นที่เหลือ" : afterSave === "all" ? `บันทึก + ปล่อยทั้งหมดเป็น ${roNorm}` : "บันทึก Release → เลือกปล่อย"}</button>}
      </div>

      {saving.busy ? (
        <div className="rw-overlay" role="status" aria-live="polite">
          <div className="rw-overlay-card"><div className="rw-spin" aria-hidden="true" /><b>กำลังบันทึก {roNorm}</b><div className="rw-muted">{saving.msg}</div><div className="rw-muted small">อย่าปิดหน้านี้จนกว่าจะเสร็จ</div></div>
        </div>
      ) : null}
    </div>
  );
}

// ══ ② Address & Unit ══
function UnitsStep({ units, total, setUnits: setUnitsRaw, usedAddr, ui, cnt, pdfs, demoTools, go }) {
  // ทุกการแก้ผ่านตัวนี้ → แถว Mockup (PMU/VMU/EMU) ได้ที่อยู่สมมติ MOCK-xxx-n ให้อัตโนมัติ
  const setUnits = useCallback((fn) => setUnitsRaw((u) => normMockUnits(typeof fn === "function" ? fn(u) : fn, usedAddr)), [setUnitsRaw, usedAddr]);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState("");
  const [onlyBad, setOnlyBad] = useState(false);
  const [q, setQ] = useState("");
  const fileRef = useRef(null);
  const pdfRef = useRef(null);
  const pasteRef = useRef(null);
  const apply = useCallback((text, mode = "replace") => {
    const { rows, skipped } = parseUnitsPaste(text);
    if (!rows.length) { setMsg("ไม่พบข้อมูล — ต้องมี 2 คอลัมน์ Unit กับ Address (คั่นด้วยแท็บ เหมือนก๊อปจาก Excel)"); return; }
    setUnits((u) => (mode === "append" ? [...u, ...rows] : rows));
    setMsg(`✓ ${mode === "append" ? "เพิ่ม" : "ได้"} ${nf(rows.length)} แถว${skipped ? ` · ข้ามแถวว่าง ${skipped}` : ""}`);
    setPaste("");
  }, [setUnits]);
  // วางที่ไหนก็ได้ในหน้า (ยกเว้นวางในช่องกรอก) = แทนที่ทั้งตาราง
  useEffect(() => {
    const on = (ev) => {
      const tg = ev.target;
      if (tg && tg !== pasteRef.current && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.isContentEditable)) return;
      const text = ev.clipboardData?.getData("text") || "";
      if (!text.includes("\t")) return;
      ev.preventDefault(); apply(text);
    };
    document.addEventListener("paste", on);
    return () => document.removeEventListener("paste", on);
  }, [apply, units.length]);
  async function importXlsx(file) {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const name = wb.SheetNames.find((n) => /address|unit/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, blankrows: false });
      apply(rows.map((r) => (r || []).slice(0, 4).map((c) => String(c ?? "").trim()).join("\t")).join("\n"));
      setMsg((m) => m + ` · จากชีต "${name}"`);
    } catch (e) { setMsg("อ่านไฟล์ไม่ได้: " + (e?.message || e)); }
  }
  // ★ นำเข้า PDF (เลือกได้หลายไฟล์) → "เพิ่มต่อท้าย" ของเดิมเสมอ ไม่ทับ
  async function importPdf(files) {
    try {
      const lib = await loadPdfJs();
      let all = [], skippedLines = 0, empty = [];
      for (const f of files) {
        const r = await readUnitsPdf(lib, await f.arrayBuffer());
        if (!r.found) empty.push(f.name); else { all.push(r.text); }
        skippedLines += r.skipped;
      }
      if (!all.length) { setMsg(`ไม่พบแถว Unit (UAxxxx) ใน PDF${empty.length ? ` (${empty.join(", ")})` : ""} — ถ้าเป็นไฟล์สแกนรูป ต้องใช้ไฟล์ที่ก๊อปข้อความได้ หรือก๊อปจาก Excel แทน`); return; }
      apply(all.join("\n"), "append");
      setMsg((m) => m + ` · จาก PDF ${files.length - empty.length} ไฟล์` + (empty.length ? ` · ไม่พบข้อมูล: ${empty.join(", ")}` : "") + " — ตรวจ Address ให้ถูกก่อนไปต่อ");
    } catch (e) { setMsg("อ่าน PDF ไม่ได้: " + (e?.message || e)); }
  }
  const setCell = (i, k, v) => setUnits((u) => u.map((r, j) => (j === i ? { ...r, [k]: v.toUpperCase() } : r)));
  const toggleMock = (i) => setUnits((u) => u.map((r, j) => (j === i ? (r.mock ? { ...r, mock: false, qty: undefined } : { ...r, mock: true, addr: "" }) : r)));
  const setQty = (i, v) => setUnits((u) => u.map((r, j) => (j === i ? { ...r, qty: v === "" ? undefined : Math.max(1, Math.min(999, Math.round(Number(v) || 1))) } : r)));
  const del = (i) => setUnits((u) => u.filter((_, j) => j !== i));
  const badIdx = Object.keys(ui.row).map(Number);
  const view = (onlyBad ? badIdx : units.map((_, i) => i)).slice(0, 400);
  const pdfPanel = new Set(pdfs.filter((d) => d.kind === "panel").map((d) => NC(d.code)));
  const inUnits = new Set(units.map((r) => NC(r.unit)));
  const missPanels = [...new Map(pdfs.filter((d) => d.kind === "panel" && !inUnits.has(NC(d.code))).map((d) => [NC(d.code), d.code])).values()];
  const cntV = cnt.filter((c) => !q || c.unit.toUpperCase().includes(q.toUpperCase()));
  const withBom = cnt.filter((c) => c.has).length;
  return (
    <div className="rw-two">
      <div className="card rw-card">
        <SecHead title="Address & Unit" sub="2 คอลัมน์: Unit (แบบแผง) + Address (ตำแหน่งติดตั้ง) · 1 แถว = แผง 1 ชิ้น = QR 1 ดวง · แผง Mockup (PMU/VMU/EMU) ติ๊กช่อง Mockup ได้ ไม่ต้องมีที่อยู่"
          right={<Help label="วิธีลง"><ul><li>ก๊อป 2 คอลัมน์จาก Excel แล้ววาง (Ctrl+V) ที่ไหนก็ได้ในหน้านี้ — มีหัวตารางหรือไม่มีก็ได้ สลับคอลัมน์ได้</li><li>หรือนำเข้าไฟล์ .xlsx (ชีตชื่อ Address&amp;Units ถ้ามี) หรือ PDF (ต้องเป็น PDF ที่มีตัวอักษร ก๊อปข้อความได้ · เลือกหลายไฟล์ได้ · เพิ่มต่อท้ายของเดิม)</li><li>ที่อยู่ซ้ำ / ใช้ใน Release อื่นแล้ว / ข้อมูลไม่ครบ = บันทึกไม่ได้ · Unit รูปแบบแปลก = เตือน</li></ul></Help>} />
        <textarea ref={pasteRef} className="input rw-paste" rows={2} value={paste} placeholder="วางจาก Excel ที่นี่ (Ctrl+V) — Unit | Address"
          onChange={(e) => setPaste(e.target.value)} onPaste={(e) => { const t = e.clipboardData?.getData("text") || ""; if (t.includes("\t")) { e.preventDefault(); apply(t); } }} />
        {paste.trim() ? <div className="rw-row"><button type="button" className="btn btn-accent btn-sm" onClick={() => apply(paste)}>ใช้ข้อมูลนี้ (แทนที่)</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(paste, "append")}>เพิ่มต่อท้าย</button></div> : null}
        <div className="rw-tools">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUnits((u) => [...u, { unit: "", addr: "" }])}><Icon name="plus" size={13} /> เพิ่มแถว</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Icon name="folder" size={13} /> นำเข้าไฟล์ .xlsx</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = ""; }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => pdfRef.current?.click()}><Icon name="folder" size={13} /> นำเข้า PDF</button>
          <input ref={pdfRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(e) => { const fs = [...(e.target.files || [])]; if (fs.length) importPdf(fs); e.target.value = ""; }} />
          {missPanels.length ? <button type="button" className="btn btn-accent btn-sm" onClick={() => { setUnits((u) => [...u, ...missPanels.map((c) => ({ unit: String(c).toUpperCase(), addr: "" }))]); setMsg(`✓ เพิ่ม ${missPanels.length} แบบแผงจาก PDF ที่อัพไว้ (แผงละ 1 ชิ้น) — PMU/VMU/EMU ติ๊ก Mockup ให้แล้ว · แบบอื่นต้องใส่ Address · ต้องการหลายชิ้น กด "เพิ่มแถว" แล้วพิมพ์ชื่อซ้ำ`); }}><Icon name="plus" size={13} /> เพิ่มแผงจาก PDF ที่อัพไว้ ({missPanels.length} แบบ)</button> : null}
          {units.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { if (await askConfirm({ message: `ล้างที่อยู่ทั้งหมด ${units.length} แถว?`, tone: "danger", confirmText: "ล้าง", cancelText: "ยกเลิก" })) setUnits([]); }}><Icon name="trash" size={13} /> ล้างทั้งหมด</button> : null}
          {badIdx.length ? <label className="rw-check"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /> เฉพาะแถวที่ต้องดู ({badIdx.length})</label> : null}
          {demoTools?.units ? demoTools.units(setUnits, setMsg) : null}
        </div>
        {msg ? <div className={`rw-msg ${msg.startsWith("✓") ? "ok" : "warn"}`}>{msg}</div> : null}
        {units.length ? (
          <div className="table-wrap rw-tw">
            <table className="data-table rw-table">
              <thead><tr><th style={{ width: 44 }}>#</th><th>Unit</th><th>Address</th><th style={{ width: 96 }} title="ชั้นที่ติดตั้ง เช่น L13 · LOB (ไม่บังคับ) — ใช้แยกตารางตามชั้นในใบหลัก">ชั้น</th><th title="แผง Mockup (PMU / VMU / EMU) ไม่ต้องมีที่อยู่">Mockup</th><th>ตรวจ</th><th style={{ width: 50 }} /></tr></thead>
              <tbody>
                {view.map((i) => { const r = units[i]; const is = ui.row[i] || []; const bad = is.some((x) => x[0] === "bad");
                  return (
                    <tr key={i} className={bad ? "rw-rowbad" : is.length ? "rw-rowwarn" : ""}>
                      <td className="rw-num">{i + 1}</td>
                      <td><input className="input rw-cell rw-mono" value={r.unit} onChange={(e) => setCell(i, "unit", e.target.value)} aria-label={`Unit แถว ${i + 1}`} /></td>
                      <td>{r.mock ? <span className="rw-mock-addr" title="ที่อยู่สมมติ — ระบบออกให้ ใช้แทนที่อยู่จริงของแผง Mockup"><b>MOCKUP</b> {mockType(r.unit)} <label className="rw-mock-qty" title="จำนวนแผง Mockup แบบนี้ (ปล่อยเหมือนกัน ใช้ PDF ชุดเดียว · 1 QR ต่อแผง)">× <input className="input rw-cell" type="number" min="1" max="999" step="1" inputMode="numeric" value={r.qty || 1} onChange={(e) => setQty(i, e.target.value)} aria-label={`จำนวน Mockup แถว ${i + 1}`} /></label> <i className="rw-mono">{mockQty(r) > 1 ? `${String(r.addr || "").replace(/-\d+$/, "")}-1…${mockQty(r)}` : r.addr}</i></span>
                        : <input className="input rw-cell rw-mono" value={r.addr} onChange={(e) => setCell(i, "addr", e.target.value)} aria-label={`Address แถว ${i + 1}`} />}</td>
                      <td><input className="input rw-cell rw-mono" value={r.floor || ""} placeholder="—" onChange={(e) => setCell(i, "floor", e.target.value)} aria-label={`ชั้น แถว ${i + 1}`} /></td>
                      <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!r.mock} onChange={() => toggleMock(i)} aria-label={`Mockup แถว ${i + 1}`} /></td>
                      <td>{is.length ? is.map(([t, m], k) => <Pill key={k} tone={t === "bad" ? "bad" : "warn"}>{m}</Pill>) : (cnt.find((c) => c.unit === r.unit)?.has ? <Pill tone="ok">✓ มี BOM</Pill> : <Pill tone="muted">รอ PDF</Pill>)}</td>
                      <td><button type="button" className="rw-x" onClick={() => del(i)} title="ลบแถว" aria-label={`ลบแถว ${i + 1}`}>×</button></td>
                    </tr>); })}
              </tbody>
            </table>
            {(onlyBad ? badIdx.length : units.length) > 400 ? <div className="rw-muted small" style={{ padding: 10 }}>แสดง 400 แถวแรก จาก {nf(onlyBad ? badIdx.length : units.length)}</div> : null}
          </div>
        ) : (
          <div className="rw-empty"><Icon name="grid" size={26} /><b>ยังไม่มีที่อยู่</b><span>ก๊อป 2 คอลัมน์ Unit | Address จาก Excel แล้วกด Ctrl+V (มีคอลัมน์ ชั้น เป็นคอลัมน์ที่ 3 ได้) · แผง Mockup พิมพ์ชื่อ Unit (เช่น EMU-E-3036) ไม่ต้องใส่ Address</span></div>
        )}
      </div>

      <div className="card rw-card rw-sticky">
        <SecHead title="สรุปแผง" sub="นับให้เองต่อแบบ (แทนชีต Units)" />
        <div className="rw-stats">
          <div className="rw-stat"><b>{nf(total ?? units.length)}</b><span>แผงทั้งหมด{units.some((r) => r.mock) ? ` (Mockup ${nf(units.filter((r) => r.mock).reduce((a, r) => a + mockQty(r), 0))})` : ""}{(total ?? units.length) !== units.length ? ` · ${nf(units.length)} แถว` : ""}</span></div>
          <div className="rw-stat"><b>{cnt.length}</b><span>แบบแผง</span></div>
          <div className="rw-stat"><b className={withBom < cnt.length ? "warn" : "ok"}>{withBom}</b><span>มี BOM แล้ว</span></div>
        </div>
        {cnt.length > 8 ? <input className="input rw-search" placeholder="ค้นหาแบบแผง" value={q} onChange={(e) => setQ(e.target.value)} /> : null}
        {cnt.length ? (
          <div className="table-wrap rw-tw short">
            <table className="data-table rw-table">
              <thead><tr><th>Unit</th><th className="r">จำนวน</th><th>BOM</th></tr></thead>
              <tbody>{cntV.map((c) => <tr key={c.unit}><td className="rw-mono"><b>{c.unit}</b></td><td className="r">{c.qty}</td><td>{pdfPanel.has(NC(c.unit)) ? <Pill tone="ok">PDF</Pill> : c.has ? <Pill tone="info">BOM เดิม</Pill> : <Pill tone="warn">รอ PDF</Pill>}</td></tr>)}</tbody>
            </table>
          </div>
        ) : null}
        {ui.block.length ? <div className="rw-msg bad">✗ บันทึกไม่ได้จนกว่าจะแก้: {ui.block.join(" · ")}</div> : null}
        {ui.warn.length ? <div className="rw-msg warn">⚠ {ui.warn.join(" · ")}</div> : null}
        {units.length && !ui.block.length ? (withBom < cnt.length
          ? <div className="rw-msg warn">{cnt.length - withBom} แบบแผงยังไม่มี BOM — <button type="button" className="rw-link" onClick={() => go(2)}>ไปขั้น ③ อัพ PDF แบบแผง</button> (ระบบไล่ต่อให้ว่าต้องมี PDF ซับ/พาร์ทตัวไหนอีก)</div>
          : <div className="rw-msg ok">✓ ทุกแบบแผงมี BOM — ไปขั้น ③ ต่อได้เลย</div>) : null}
      </div>
    </div>
  );
}

// ══ ③ อัพ PDF ══
function PdfStep({ onReloadLib, pdfs, setPdfs, checks, cv, units, useLib, setUseLib, libState, lib, ack, ackMeta, decide, openN, demoTools, order = null, orderCmp = [], orderHw = [], setOrderHw = () => {} }) {
  const [sel, setSel] = useState(null);
  const [focus, setFocus] = useState("");     // เบอร์ที่ขาด ที่กดจากเช็กลิสต์ → เปิดแผงที่ใช้ + กางซับ + ไฮไลต์แถว
  const [focusMsg, setFocusMsg] = useState("");
  const miss = useMemo(() => new Set([...cv.subs, ...cv.parts].filter((x) => x.src === "none").map((x) => NC(x.code))), [cv]);
  const locate = (code) => {
    const hit = checks.find((r) => r.d.kind === "panel" && (r.rows.some((x) => NC(x.code) === NC(code)) || r.rows.some((x) => x.k === "sub" && trailTo(lib, x.code, code, x.code + "|" + (x.item || ""), [NC(x.code)], {}))));
    if (!hit) { setFocusMsg(`หา ${code} ในแบบแผงที่อัพไว้ไม่เจอ (อาจอยู่ในซับที่ยังไม่มีแบบ)`); return; }
    setFocusMsg(""); setFilt("all"); setSel(hit.d.file); setFocus(code);
  };
  const [filt, setFilt] = useState("all");
  const [reading, setReading] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  async function addFiles(list) {
    const files = [...list].filter((f) => /\.pdf$/i.test(f.name));
    if (!files.length) return;
    setReading({ n: 0, of: files.length });
    try {
      const all = await readPdfFiles(files, (n, of) => setReading({ n, of }));
      // Release ลงแค่แบบแผง — แบบซับ/พาร์ทให้ลงที่ "ซับ / พาร์ท ของโปรเจค" (ระบบดึงมาใช้เอง)
      const got = all.filter((d) => d.kind !== "sub" && d.kind !== "part"); const skipped = all.filter((d) => d.kind === "sub" || d.kind === "part");
      setPdfs((old) => { const names = new Set(got.map((d) => d.file)); return [...old.filter((d) => !names.has(d.file)), ...got]; });
      const firstBad = got.find((d) => d.kind === "unknown"); setSel(firstBad ? firstBad.file : null);   // null = เปิดไฟล์แรกที่ต้องตัดสิน
      if (skipped.length) { setReading({ warn: `ข้าม ${skipped.length} ไฟล์ (แบบซับ/พาร์ท: ${skipped.slice(0, 4).map((d) => d.code).join(", ")}${skipped.length > 4 ? " …" : ""}) — Release ลงแค่แบบแผง · แบบซับ/พาร์ทให้ลงที่หน้า "ซับ / พาร์ท ของโปรเจค" แล้วระบบดึงมาใช้เอง` }); return; }
    } catch (e) { setReading({ err: "โหลดตัวอ่าน PDF ไม่ได้: " + (e?.message || e) }); return; }
    setReading(null);
  }
  const kindOrd = { panel: 0, sub: 1, part: 2, unknown: 3 };
  const list = checks.filter((r) => filt === "all" || (filt === "bad" ? r.open : !r.open)).sort((a, b) => kindOrd[a.d.kind] - kindOrd[b.d.kind] || ncmp(a.d.code, b.d.code));
  const R = checks.find((r) => r.d.file === sel) || checks.find((r) => r.open) || checks[0] || null;
  const nPanel = pdfs.filter((d) => d.kind === "panel").length, nSub = pdfs.filter((d) => d.kind === "sub").length, nPart = pdfs.filter((d) => d.kind === "part").length;
  const covRow = (lab, arr, what) => {
    const pdf = arr.filter((x) => x.src === "pdf").length, lb = arr.filter((x) => x.src === "lib").length, none = arr.filter((x) => x.src === "none"); const tot = arr.length || 1;
    return (
      <div className="rw-cov">
        <div className="rw-cov-lab"><b>{lab}</b><span>{arr.length} เบอร์</span></div>
        <div className="rw-cov-bar" role="img" aria-label={`${lab}: PDF ${pdf}, BOM เดิม ${lb}, ขาด ${none.length}`}><i className="pdf" style={{ width: `${(pdf / tot) * 100}%` }} /><i className="lib" style={{ width: `${(lb / tot) * 100}%` }} /><i className="none" style={{ width: `${(none.length / tot) * 100}%` }} /></div>
        <div className="rw-cov-num"><Pill tone="ok">PDF {pdf}</Pill>{lb ? <Pill tone="info">เดิม {lb}</Pill> : null}<Pill tone={none.length ? "warn" : "ok"}>ขาด {none.length}</Pill></div>
        {none.length ? <div className="rw-cov-miss"><span className="rw-muted">ยังไม่มี PDF {what}:</span> {none.slice(0, 12).map((x) => <span key={x.code} className="rw-miss-i"><button type="button" className="rw-misslink" onClick={() => locate(x.code)} title="กดเพื่อเปิดแผงที่ใช้เบอร์นี้ และไฮไลต์แถว"><Pill tone="warn">{x.code}</Pill> 🔍</button>{x.from ? <span className="rw-muted small"> ← ใช้ใน <b className="rw-mono">{x.from}</b></span> : null}</span>)}{none.length > 12 ? <span className="rw-muted small"> … อีก {none.length - 12} เบอร์ (เปิด “ดูทั้งหมด” ด้านล่าง)</span> : null}</div> : null}
        {arr.length ? <details className="rw-cov-all"><summary>ดูทั้งหมด {arr.length} เบอร์ — แต่ละเบอร์มาจากไหน / ใช้ในอะไร</summary>
          <table className="data-table rw-table"><thead><tr><th>เบอร์</th><th>แหล่งข้อมูล</th><th>{lab === "แบบแผง" ? "ในใบนี้" : "ใช้ใน"}</th></tr></thead>
            <tbody>{arr.map((x) => <tr key={x.code}><td className="rw-mono"><b>{x.code}</b></td><td><Pill tone={x.src === "pdf" ? "ok" : x.src === "lib" ? "info" : "warn"}>{x.src === "pdf" ? "PDF ที่อัพ" : x.src === "lib" ? "BOM เดิม" : "ยังไม่มี"}</Pill></td><td className="rw-mono">{lab === "แบบแผง" ? `${units.filter((u) => NC(u.unit) === NC(x.code)).length} แผง${units.some((u) => NC(u.unit) === NC(x.code) && u.mock) ? " · Mockup" : ""}` : (x.from || "")}</td></tr>)}</tbody></table>
        </details> : null}
      </div>
    );
  };
  return (
    <>
      <div className="card rw-card">
        <SecHead title="อัพ PDF แบบแผง" sub="Release ลงแค่แบบแผง (UA…) — ซับ/พาร์ทที่แผงใช้ ระบบดึงจาก “ซับ / พาร์ท ของโปรเจค” ให้เอง · เบอร์ที่ปล่อยไว้แล้วใน Release อื่นจะถูกใช้เป็นลูก ไม่ปล่อยซ้ำ"
          right={<Help><ul><li><b>เทียบกับ BOM เดิมในระบบ:</b> จำนวน · ยาว · สูง · Finish · INV · Develop · มีใน PDF ไม่มีในระบบ · มีในระบบไม่มีใน PDF</li><li><b>เทียบ PDF กันเอง:</b> เบอร์เดียวกันคนละค่า (ใช้ค่าจากแบบของเบอร์นั้นเอง)</li><li><b>ในแบบเอง:</b> ไม่มีจำนวน · อ่านเบอร์ไม่ได้ · เบอร์ซ้ำ · ยาง HS ยาวกว่าซับ · M.D. &lt; LENGTH · STOCK ≠ INV · ชื่อไฟล์ ≠ เบอร์</li><li>ยาง/เทปต่าง ≤ 1.5 มม. = ปัดเศษ (ไม่นับเป็นผิด)</li><li>จุดที่ต่าง: เลือก "ใช้ตาม PDF" (ค่าเริ่ม) หรือ "ใช้ค่าเดิม" — ระบบจำว่าใครตัดสิน เมื่อไร</li></ul></Help>} />
        <OrderChecklist order={order} orderCmp={orderCmp} orderHw={orderHw} setOrderHw={setOrderHw} hint="เทียบกับแผง / ซับ / พาร์ท / อุปกรณ์ ที่แตกจาก Address & Unit + แบบที่วาง" />
        <div className={`rw-drop ${drag ? "drag" : ""}`} role="button" tabIndex={0}
          onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
          <div className="rw-drop-ic"><Icon name="plus" size={20} /></div>
          <div><b>ลากไฟล์ PDF มาวาง หรือกดเพื่อเลือก</b><span>หลายไฟล์พร้อมกันได้ · อ่านในเครื่อง ไม่ต้องรอ · ไฟล์ชื่อซ้ำ = แทนที่ของเดิม</span></div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden data-testid="pdf-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {reading ? <div className={`rw-msg ${reading.err ? "bad" : reading.warn ? "warn" : "info"}`}>{reading.err || reading.warn || `กำลังอ่าน PDF ${reading.n}/${reading.of}…`}{reading.warn ? <button type="button" className="rw-x" style={{ marginLeft: 8 }} onClick={() => setReading(null)} aria-label="ปิด">×</button> : null}</div> : null}
        <div className="rw-tools">
          <span className="rw-muted small"><b>ซับ / พาร์ท ของโปรเจค:</b> {libState.s === "loading" ? "กำลังโหลด…" : libState.s === "err" ? `โหลดไม่ได้ (${libState.err})` : lib ? `ซับ ${Object.keys(lib.subs).length} · พาร์ท ${nf(Object.keys(lib.parts).length)} เบอร์ — ดึงมาใช้กับแผงที่อัพให้เอง` : "ยังไม่ได้โหลด"}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReloadLib} disabled={libState.s === "loading"} title="โหลดซับ/พาร์ทของโปรเจคใหม่ (หลังเพิ่มที่หน้า ซับ / พาร์ท ของโปรเจค)">↻ โหลดใหม่</button>
          {pdfs.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { if (await askConfirm({ message: `เอา PDF ออกทั้งหมด ${pdfs.length} ไฟล์?`, tone: "danger", confirmText: "เอาออก", cancelText: "ยกเลิก" })) { setPdfs([]); setSel(null); } }}><Icon name="trash" size={13} /> ล้างไฟล์ทั้งหมด</button> : null}
          {demoTools?.pdfs ? demoTools.pdfs(setPdfs, setSel) : null}
        </div>

        <div className="rw-covbox">
          <div className="rw-covhead"><b>เช็กลิสต์ PDF ของใบนี้</b> <span className="rw-muted">— คิดจาก Address &amp; Unit ({nf(units.length)} แผง · {cv.panels.length} แบบ) แล้วไล่ BOM ลงทีละชั้น</span></div>
          {covRow("แบบแผง", cv.panels, "(ยังไม่รู้ว่าแผงประกอบด้วยอะไร)")}
          {covRow("ซับที่แผงใช้", cv.subs, "— ยังไม่มีในโปรเจค ลงที่หน้า ซับ/พาร์ท ของโปรเจค")}
          {covRow("พาร์ทที่แผงใช้", cv.parts, "— ยังไม่มีในโปรเจค ลงที่หน้า ซับ/พาร์ท ของโปรเจค")}
          <div className="rw-muted small">ซับ/พาร์ทโผล่หลังอัพแบบแผงที่ใช้มัน · “เดิม” = มีในคลังของโปรเจคแล้ว · ที่ขาด = ปล่อยได้ก่อน พอลงในโปรเจค (หรือ Release อื่นมี) ระบบดึงมาให้เอง</div>
          {focusMsg ? <div className="rw-msg warn">{focusMsg}</div> : null}
          {cv.orphan.length ? <div className="rw-msg warn">⚠ PDF {cv.orphan.length} ไฟล์ไม่ได้ใช้ในแผงของใบนี้: {cv.orphan.map((d) => d.code).join(", ")} — อัพผิดไฟล์ หรือยังไม่ได้อัพแบบแผง/ซับที่ใช้เบอร์นี้</div> : null}
        </div>
      </div>

      {pdfs.length ? (
        <div className="card rw-card">
          <div className="rw-stats wide">
            <div className="rw-stat"><b>{pdfs.length}</b><span>ไฟล์ PDF</span></div>
            <div className="rw-stat"><b>{nPanel}</b><span>แบบแผง</span></div>
            <div className="rw-stat"><b className="ok">{checks.filter((r) => !r.open).length}</b><span>ไฟล์ไม่มีปัญหา</span></div>
            <div className="rw-stat"><b className={openN ? "bad" : "ok"}>{openN}</b><span>จุดที่ยังต้องตัดสิน</span></div>
          </div>
          <div className="rw-pdfgrid">
            <div>
              <div className="rw-seg">{[["all", "ทั้งหมด"], ["bad", "ต้องตรวจ"], ["ok", "ไม่มีปัญหา"]].map(([k, l]) => <button key={k} type="button" className={filt === k ? "on" : ""} onClick={() => setFilt(k)}>{l}</button>)}</div>
              <div className="rw-plist">
                {list.map((r) => { const [kc, kl] = kindLabel[r.d.kind] || kindLabel.unknown; const lv = LV[r.lv];
                  return (
                    <div key={r.d.file} className="rw-pitem-row">
                      <button type="button" className={`rw-pitem ${R && r.d.file === R.d.file ? "on" : ""}`} onClick={() => setSel(r.d.file)}>
                        <span className="rw-pitem-l"><Pill tone={kc}>{kl}</Pill><span className="rw-mono">{r.d.code}</span></span>
                        <Pill tone={lv[0]}>{r.open ? `${lv[1]} ${r.open} จุด` : lv[1]}</Pill>
                      </button>
                      <button type="button" className="rw-x" title="เอาไฟล์นี้ออก" aria-label={`เอา ${r.d.code} ออก`}
                        onClick={() => { setPdfs((p) => p.filter((d) => d.file !== r.d.file)); if (R && R.d.file === r.d.file) setSel(null); }}>×</button>
                    </div>); })}
                {!list.length ? <div className="rw-muted small" style={{ padding: 10 }}>ไม่มีไฟล์ในกลุ่มนี้</div> : null}
              </div>
            </div>
            {R ? <PdfDetail R={R} lib={lib} miss={miss} focus={focus} ack={ack} ackMeta={ackMeta} decide={decide} onRemove={() => { setPdfs((p) => p.filter((d) => d.file !== R.d.file)); setSel(null); }} /> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
function PdfDetail({ R, lib, miss, focus, ack, ackMeta, decide, onRemove }) {
  const [open, setOpen] = useState({});   // แถวซับที่กางอยู่ (key = เส้นทางจากแถวบน)
  useEffect(() => { setOpen({}); }, [R.d.file]);
  // กดเบอร์ที่ขาดจากเช็กลิสต์ → กางซับทุกชั้นที่พาไปถึงเบอร์นั้น แล้วเลื่อนไปที่แถว
  useEffect(() => {
    if (!focus) return;
    const out = {};
    for (const x of R.rows) if (x.k === "sub") trailTo(lib, x.code, focus, x.code + "|" + (x.item || ""), [NC(x.code)], out);
    setOpen((o) => ({ ...o, ...out }));
    const t = setTimeout(() => document.querySelector("tr.rw-miss-row.focus")?.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
    return () => clearTimeout(t);
  }, [focus, R.d.file]);   // eslint-disable-line react-hooks/exhaustive-deps
  const d = R.d; const [kc, kl] = kindLabel[d.kind] || kindLabel.unknown;
  const shown = R.issues.filter((i) => i.lvl !== "info");
  const infos = R.issues.filter((i) => i.lvl === "info");
  const choiceOpen = shown.filter((i) => i.choice && !ack[i.key]);
  return (
    <div className="rw-pdetail">
      <div className="rw-pd-head">
        <div className="rw-pd-title"><b className="rw-mono">{d.code}</b><span><Pill tone={kc}>{kl}</Pill> {d.file}</span></div>
        {d.kind !== "part" ? <div className="rw-stat sm"><b>{d.bom.length}</b><span>บรรทัดใน BOM</span></div> : <div className="rw-stat sm"><b>{d.title?.["INV.CODE"] || "—"}</b><span>INV.CODE</span></div>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}><Icon name="trash" size={13} /> เอาไฟล์นี้ออก</button>
      </div>
      {shown.length ? (
        <div className={`rw-issues ${R.open ? "open" : ""}`}>
          <div className="rw-issues-h">{R.open ? <><b>ต้องตัดสิน {R.open} จาก {shown.length} จุด</b> <span className="rw-muted">· ค่าเริ่ม = ใช้ตาม PDF</span></> : <b>ตัดสินครบแล้ว ✓</b>}</div>
          {shown.map((i) => { const a = ack[i.key]; const meta = ackMeta[i.key];
            return (
              <div key={i.key} className={`rw-issue ${a ? "done" : i.lvl}`}>
                <span className="ic">{a ? "✓" : i.lvl === "bad" ? "✗" : "⚠"}</span>
                <div className="tx">{i.msg}{a && meta ? <div className="rw-muted small">{a === "lib" ? (i.libLabel || "ใช้ค่าเดิม") : a === "pdf" ? (i.pdfLabel || "ใช้ตาม PDF") : "รับทราบ"} · โดย {meta.by} {hhmm(meta.at)}</div> : null}</div>
                <div className="act">
                  {i.choice ? (<>
                    <button type="button" className={`btn btn-sm ${a === "pdf" ? "btn-accent" : "btn-ghost"}`} onClick={() => decide(i.key, "pdf")}>{i.pdfLabel || "ใช้ตาม PDF"}</button>
                    <button type="button" className={`btn btn-sm ${a === "lib" ? "btn-accent" : "btn-ghost"}`} onClick={() => decide(i.key, "lib")}>{i.libLabel || "ใช้ค่าเดิม"}</button>
                  </>) : <button type="button" className={`btn btn-sm ${a ? "btn-accent" : "btn-ghost"}`} onClick={() => decide(i.key, "ok")}>รับทราบ</button>}
                </div>
              </div>); })}
          {choiceOpen.length > 1 ? <div className="rw-row"><button type="button" className="btn btn-accent btn-sm" onClick={() => choiceOpen.forEach((i) => decide(i.key, "pdf"))}>ใช้ตาม PDF ทุกจุดในไฟล์นี้</button></div> : null}
        </div>
      ) : <div className="rw-msg ok">✓ ไม่มีจุดที่ต้องตัดสิน{infos.length ? " · " + infos.map((i) => i.msg).join(" · ") : ""}</div>}
      {d.kind === "part" ? (
        <div className="table-wrap rw-tw short"><table className="data-table rw-table">
          <thead><tr><th>ช่อง</th><th>PDF</th><th>BOM เดิม</th><th>ผล</th></tr></thead>
          <tbody>{R.rows.map((r) => <tr key={r.field}><td><b>{r.field}</b></td><td className="rw-mono">{r.pv ?? "—"}</td><td className="rw-mono">{r.sv ?? "—"}</td><td>{r.ok === true ? <Pill tone="ok">ตรง</Pill> : r.ok === false ? <Pill tone={r.used === "lib" ? "info" : "bad"}>{r.used === "lib" ? "ใช้ค่าเดิม" : "ต่าง"}</Pill> : <span className="rw-muted small">{r.note || ""}</span>}</td></tr>)}</tbody>
        </table></div>
      ) : d.kind !== "unknown" ? (
        <div className="table-wrap rw-tw"><table className="data-table rw-table">
          <thead><tr><th className="r">ITEM</th><th>PART NUMBER</th><th>DESCRIPTION</th><th className="r">QTY</th><th className="r">เดิม</th><th className="r">LENGTH</th><th className="r">HEIGHT</th><th>FINISH</th></tr></thead>
          <tbody>{R.rows.map((r) => {
            const path = r.code + "|" + (r.item || "");
            return (
              <Fragment key={path}>
                <tr className={`${r.bad.miss ? "rw-rowwarn" : ""}${miss && miss.has(NC(r.code)) ? " rw-miss-row" : ""}${focus && NC(r.code) === NC(focus) ? " focus" : ""}`}>
                  <td className="r rw-muted">{r.item ?? "—"}</td>
                  <td className="rw-mono">
                    {r.k === "sub" ? <button type="button" className="rw-tg" onClick={() => setOpen((o) => ({ ...o, [path]: !o[path] }))} aria-expanded={!!open[path]} title={open[path] ? "ย่อ" : "ขยายดูเบอร์ลูก"}>{open[path] ? "▾" : "▸"}</button> : null}
                    <b>{r.code}</b> {r.k === "sub" ? <Pill tone="sub">ซับ</Pill> : r.k === "hw" ? <Pill tone="muted">HW</Pill> : null}{miss && miss.has(NC(r.code)) ? <Pill tone="warn">ไม่มีในโปรเจค</Pill> : null}
                  </td>
                  <td className="rw-desc">{r.desc}</td>
                  <td className={`r ${r.bad.q === "bad" || r.bad.miss === "pdf" ? "rw-bad" : ""}`}>{r.qp == null ? "—" : nlen(r.qp)}{r.unit ? <span className="rw-muted small"> {r.unit}</span> : null}</td>
                  <td className="r rw-muted">{r.qs == null ? "" : nlen(r.qs)}</td>
                  <td className={`r ${r.bad.l ? "rw-bad" : ""}`}>{nlen(r.lp)}</td>
                  <td className={`r ${r.bad.h ? "rw-bad" : ""}`}>{nlen(r.hp)}</td>
                  <td className={r.bad.f ? "rw-bad" : ""}>{r.fp}</td>
                </tr>
                {r.k === "sub" && open[path] ? <SubKids lib={lib} code={r.code} path={path} depth={1} open={open} setOpen={setOpen} seen={[NC(r.code)]} miss={miss} focus={focus} /> : null}
              </Fragment>); })}</tbody>
        </table></div>
      ) : null}
    </div>
  );
}

function SumCard({ tone, title, big, children, wide }) {
  return (
    <div className={`rw-make ${wide ? "wide" : ""}`}>
      <div className="rw-make-h"><Pill tone={tone}>{title}</Pill></div>
      {big ? <div className="rw-make-big">{big}</div> : null}
      <p>{children}</p>
    </div>
  );
}
// ══ ④ ตรวจ + บันทึก ══
// ★ 2026-11-10 เช็กลิสต์ "ตามใบปะหน้า" — ต่อรายการ: อยู่ในใบแล้วเท่าไหร่ / ยังขาด / ถือเป็นอุปกรณ์ (ไม่มี QR)
//   onApply = โหมด items: เลือกเบอร์ตามใบปะหน้าให้ (เฉพาะที่มีในคลัง) · orderHw/setOrderHw = เบอร์ที่ติ๊กว่าเป็นอุปกรณ์ → ไปใบเบิก
function OrderChecklist({ order, orderCmp, orderHw, setOrderHw, onApply, hint }) {
  if (!order) return null;
  const miss = orderCmp.filter((x) => x.status === "missing").length, bad = orderCmp.filter((x) => x.status === "more" || x.status === "less").length;
  const isHw = (c) => orderHw.some((x) => NC(x) === NC(c));
  const tog = (c, on) => setOrderHw((xs) => (on ? [...xs.filter((x) => NC(x) !== NC(c)), c] : xs.filter((x) => NC(x) !== NC(c))));
  return (
    <div className={`rw-order-check ${miss || bad ? "warn" : "ok"}`}>
      <div className="rw-order-h">
        <b>ตามใบปะหน้า {order.roRaw || order.ro || order.file}</b>
        <span className="rw-muted">{miss || bad ? [miss && `ยังขาด ${miss}`, bad && `จำนวนไม่ตรง ${bad}`].filter(Boolean).join(" · ") : `ครบ ${order.items.length} รายการ`}{hint ? ` · ${hint}` : ""}</span>
        {onApply ? <button type="button" className="btn btn-ghost btn-sm" onClick={onApply} title="เลือกเบอร์ + จำนวนตามใบปะหน้า (เฉพาะเบอร์ที่มีในคลังของโปรเจค)">เลือกตามใบปะหน้า</button> : null}
      </div>
      <table className="data-table rw-table rw-order-tbl">
        <thead><tr><th className="r">#</th><th>Part No.</th><th>Description</th><th className="r">ใบปะหน้า</th><th className="r">ในใบนี้</th><th>สถานะ</th><th title="สกรู / น็อต / ยาง ที่ไม่ผลิตเอง — ไม่มี QR ไปใบเบิก ACCESSORIES">อุปกรณ์?</th></tr></thead>
        <tbody>{orderCmp.map((x) => (
          <tr key={x.code} className={x.status === "missing" && !isHw(x.code) ? "rl-errrow" : x.status === "ok" ? "" : "rw-picked-row"}>
            <td className="r rw-muted">{x.item ?? ""}</td>
            <td className="rw-mono"><b>{x.code}</b></td>
            <td className="rw-desc">{x.d}{x.remark ? <span className="rw-muted"> · {x.remark}</span> : null}</td>
            <td className="r">{nlen(x.qty)}{x.unit ? <small className="rw-muted"> {x.unit}</small> : null}</td>
            <td className="r">{x.status === "missing" ? <span className="rw-muted">—</span> : nlen(x.have)}</td>
            <td>{x.status === "ok" ? <Pill tone="ok">ครบ{x.kind === "hw" ? " · ใบเบิก" : x.kind === "panel" ? " · แผง" : x.kind === "sub" ? " · ซับ" : ""}</Pill>
              : x.status === "missing" ? (isHw(x.code) ? <Pill tone="muted">อุปกรณ์ · ใบเบิก</Pill> : <Pill tone="bad">ยังไม่อยู่ในใบ</Pill>)
              : <Pill tone="warn">{x.status === "more" ? "ในใบมากกว่า" : "ในใบน้อยกว่า"}</Pill>}</td>
            <td>{x.status === "missing" || isHw(x.code) ? <label className="rw-check"><input type="checkbox" checked={isHw(x.code)} onChange={(e) => tog(x.code, e.target.checked)} /> ไม่มี QR</label> : null}</td>
          </tr>))}</tbody>
      </table>
    </div>);
}
// ── ขั้น ② โหมด "เฉพาะซับ / พาร์ท": เลือกเบอร์จากคลังของโปรเจค + จำนวน (ไม่มีแผง · ไม่ต้องอัพ PDF) ──
function PicksStep({ project, picks, setPicks, bom, lib, libState, catOf, onReloadLib, api, userName, order = null, orderCmp = [], orderHw = [], setOrderHw = () => {}, pendingPdfs = [], onPendingDone = () => {} }) {
  const [tab, setTab] = useState("sub");
  // ★ 2026-11-03: วาง PDF แบบซับ/พาร์ทได้ที่นี่เลย (เหมือนขั้นอัพ PDF แผง) — อ่าน → บันทึกลงคลังของโปรเจคทันที → เลือกให้ ×1
  const [reading, setReading] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const Q = q.trim().toUpperCase();
  const key = (kind, code) => kind + "|" + NC(code);
  const qtyOf = useMemo(() => new Map(picks.map((p) => [key(p.kind, p.code), p.qty])), [picks]);
  const subs = useMemo(() => Object.entries(bom.subs).map(([code, x]) => ({ code, ...x, nKids: (x.items || []).filter((i) => (i[4] || "") !== "ยกเลิก").length })).sort((a, b) => ncmp(a.code, b.code)), [bom]);
  const nOldRev = useMemo(() => Object.keys(bom.parts).filter((c) => findLatest(bom.parts, c) !== c).length, [bom]);   // รุ่นเก่าที่ซ่อน
  const parts = useMemo(() => Object.entries(bom.parts).filter(([code, x]) => x.k !== "hw" && findLatest(bom.parts, code) === code).map(([code, x]) => { const cat = catOf(code, "part"); const base = PART_CATS.includes(cat) ? cat : ruleCat(code, "part"); return { code, ...x, cat, qr: QR_CATS.has(base) }; }).filter((x) => x.qr).sort((a, b) => ncmp(a.code, b.code)), [bom, catOf]);
  const list = (tab === "sub" ? subs : parts).filter((r) => !Q || r.code.toUpperCase().includes(Q) || String(r.d || "").toUpperCase().includes(Q));
  const setQty = (kind, code, v) => {
    const n = Math.round(Number(v));
    setPicks((old) => { const rest = old.filter((p) => key(p.kind, p.code) !== key(kind, code)); return n > 0 ? [...rest, { code, kind, qty: n }] : rest; });
  };
  const nSub = picks.filter((p) => p.kind === "sub").length, nPart = picks.length - nSub;
  // ★ 2026-11-10 เลือกตามใบปะหน้า: ซับ/พาร์ท (QR) ที่มีในคลัง → เลือกให้ตามจำนวน · ที่เป็นสกรู/ยางในคลัง (hw) → ติ๊กเป็นอุปกรณ์ให้ · ที่ไม่มีในคลัง → แดง รอวาง PDF หรือติ๊กอุปกรณ์เอง
  const applyOrder = () => {
    if (!order) return;
    const add = []; const hw = [];
    for (const it of order.items) {
      const q = Number(it.qty) || 0; if (!(q > 0)) continue;
      const sk = findKey(bom.subs, it.code); if (sk) { add.push({ code: sk, kind: "sub", qty: q }); continue; }
      const pk = findLatest(bom.parts, it.code) || findKey(bom.parts, it.code);
      if (pk) { if (bom.parts[pk].k === "hw") hw.push(it.code); else add.push({ code: pk, kind: "part", qty: q }); continue; }
      if (/^(HP|R&D)/i.test(it.code)) hw.push(it.code);
    }
    if (add.length) setPicks((old) => { const have = new Map(old.map((p) => [key(p.kind, p.code), p])); for (const a of add) have.set(key(a.kind, a.code), { ...(have.get(key(a.kind, a.code)) || {}), ...a }); return [...have.values()]; });
    if (hw.length) setOrderHw((xs) => [...xs.filter((x) => !hw.some((h) => NC(h) === NC(x))), ...hw]);
  };
  // แบบซับ/พาร์ทที่มาจากกล่องรับเอกสาร → วางให้เองเมื่อคลังโหลดแล้ว
  const pendRef = useRef(false);
  useEffect(() => { if (!pendingPdfs.length || libState.s !== "ok" || pendRef.current) return; pendRef.current = true; addFiles(pendingPdfs).finally(onPendingDone); }, [pendingPdfs, libState.s]);   // eslint-disable-line react-hooks/exhaustive-deps
  const autoRef = useRef("");
  useEffect(() => { if (!order || libState.s !== "ok" || picks.length) return; const k = order.file + "|" + libState.key; if (autoRef.current === k) return; autoRef.current = k; applyOrder(); }, [order, libState.s, libState.key]);   // eslint-disable-line react-hooks/exhaustive-deps
  async function addFiles(list) {
    const files = [...list].filter((f) => /\.pdf$/i.test(f.name)); if (!files.length || !project) return;
    setReading({ n: 0, of: files.length });
    try {
      const all = await readPdfFiles(files, (n, of) => setReading({ n, of }));
      const base = lib || EMPTY_LIB;
      // ★ 2026-11-03 เบอร์เดียวกันแต่รุ่นเก่ากว่าที่มีในคลัง (เช่น วาง "X A" ทั้งที่มี "X B") → ข้าม ใช้รุ่นล่าสุดเสมอ
      const older = all.filter((d) => d.kind === "part" && newerRevOf(base.parts, d.code));
      const got = all.filter((d) => (d.kind === "sub" || d.kind === "part") && !older.includes(d));
      const skip = all.filter((d) => !(d.kind === "sub" || d.kind === "part"));
      const skipTxt = [
        skip.length ? `ข้าม ${skip.length} ไฟล์ (${skip.slice(0, 4).map((d) => d.kind === "panel" ? "แบบแผง " + d.code + " — ใช้โหมดปล่อยแผง" : "อ่านไม่ออก " + d.file).join(", ")}${skip.length > 4 ? " …" : ""})` : "",
        older.length ? `รุ่นเก่ากว่าในคลัง ${older.length} ไฟล์ ไม่เอาทับ (${older.slice(0, 4).map((d) => `${d.code} → ใช้ ${newerRevOf(base.parts, d.code)}`).join(", ")}${older.length > 4 ? " …" : ""})` : "",
      ].filter(Boolean).join(" · ");
      if (!got.length) {
        if (older.length) {   // วางแต่รุ่นเก่า → เลือกรุ่นล่าสุดในคลังให้แทน
          setPicks((old) => { const have = new Set(old.map((p) => key(p.kind, p.code))); const add = older.map((d) => newerRevOf(base.parts, d.code)).filter((c) => !have.has(key("part", c))); return [...old, ...[...new Set(add)].map((c) => ({ code: c, kind: "part", qty: 1 }))]; });
          setReading({ ok: "ไม่ได้เพิ่ม — คลังมีรุ่นใหม่กว่าอยู่แล้ว เลือกรุ่นล่าสุดให้แทน", warn: skipTxt }); return;
        }
        setReading({ err: "ไม่มีแบบซับ/พาร์ทในไฟล์ที่วาง" + (skipTxt ? " — " + skipTxt : "") }); return;
      }
      if (!api?.saveLibrary) { setReading({ err: "ระบบนี้ยังบันทึกลงคลังจากหน้านี้ไม่ได้ — ลงที่หน้า “ซับ / พาร์ท ของโปรเจค”" }); return; }
      // รวมกับคลังเดิม → บันทึกลงคลังของโปรเจค (เหมือนกด "บันทึก" ที่หน้า ซับ / พาร์ท ของโปรเจค) · หมวด/งานซับใช้ค่าของคลัง
      const ov = base.ov || {};
      const merged = buildBom({ lib: base, pdfs: got, ack: {}, useLib: true });
      const cfg = { partMode: ov.partMode || "auto", partGroups: ov.partGroups || [] };
      const catOfLib = makeCatOf(merged, ov.catOv || {}, cfg);
      setReading({ msg: "บันทึกลงคลังของโปรเจค…" });
      const r = await api.saveLibrary({ projectId: project.id, projectCode: project.code, bom: { panels: {}, subs: merged.subs, parts: merged.parts },
        newCodes: new Set(got.map((d) => NC(d.code))), catOv: ov.catOv || {}, procOv: ov.procOv || {}, destOv: ov.destOv || {}, ...cfg, catOf: catOfLib,
        pdfs: got.map((d) => ({ file: d.file, kind: d.kind, code: d.code, famOf: d.famOf, _file: d._file })), by: userName || "" }, (m) => setReading({ msg: m }));
      // เลือกเบอร์ที่เพิ่งวางให้เลย ×1 (แก้จำนวนได้) — เบอร์ที่เลือกอยู่แล้วคงจำนวนเดิม
      // เลือกรุ่นล่าสุดของเบอร์นั้นให้ (ไฟล์ที่วางเป็นรุ่นใหม่กว่าอยู่แล้ว · ถ้าเคยเลือกรุ่นเก่าไว้ → เปลี่ยนเป็นรุ่นใหม่)
      setPicks((old) => {
        const next = old.map((p) => { const d = p.kind === "part" ? got.find((g) => g.kind === "part" && NC(g.code) !== NC(p.code) && newerRevOf({ [g.code]: 1 }, p.code)) : null; return d ? { ...p, code: d.code } : p; });
        const have = new Set(next.map((p) => key(p.kind, p.code)));
        const oq = (c) => { const it = order && order.items.find((x) => NC(x.code) === NC(c)); return it && Number(it.qty) > 0 ? Number(it.qty) : 1; };   // จำนวนตามใบปะหน้า ถ้ามี
        return [...next, ...got.filter((d) => !have.has(key(d.kind, d.code))).map((d) => ({ code: d.code, kind: d.kind, qty: oq(d.code) }))];
      });
      onReloadLib();
      const gs = got.filter((d) => d.kind === "sub").length, gp = got.length - gs;
      const errs = (r && r.errors) || [];
      setReading({ ok: `เพิ่มลงคลังแล้ว ซับ ${nf(gs)} · พาร์ท ${nf(gp)} เบอร์ — เลือกให้แล้ว ×1 แก้จำนวนในตารางได้เลย`, warn: [skipTxt, ...errs].filter(Boolean).join(" · ") });
    } catch (e) { setReading({ err: "วาง PDF ไม่สำเร็จ: " + (e?.message || e) }); }
  }
  if (!project) return <div className="card rw-card"><div className="rw-empty"><Icon name="grid" size={26} /><b>ยังไม่ได้เลือกโปรเจค</b><span>กลับไปขั้น ① แล้วเลือกโปรเจค — เบอร์ที่เลือกได้มาจากคลังของโปรเจค</span></div></div>;
  return (
    <div className="card rw-card">
      <SecHead title="เลือกซับ / พาร์ท" sub={`จากคลังของโปรเจค ${project.code} — ใส่จำนวนที่ต้องการปล่อย · ซับจะแตกลูก (ซับย่อย + พาร์ท) ให้เองตาม BOM ในคลัง`}
        right={<button type="button" className="btn btn-ghost btn-sm" onClick={onReloadLib} title="โหลดคลังใหม่ (หลังเพิ่มซับ/พาร์ทที่หน้า ซับ / พาร์ท ของโปรเจค)">↻ โหลดคลังใหม่</button>} />
      <OrderChecklist order={order} orderCmp={orderCmp} orderHw={orderHw} setOrderHw={setOrderHw} onApply={applyOrder} hint="เบอร์ที่ยังไม่อยู่ในใบ = ไม่มีในคลัง → วาง PDF แบบด้านล่าง หรือติ๊กว่าเป็นอุปกรณ์" />
      <div className={`rw-drop rw-drop-sm ${drag ? "drag" : ""}`} role="button" tabIndex={0}
        onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
        <div className="rw-drop-ic"><Icon name="plus" size={20} /></div>
        <div><b>ลาก PDF แบบซับ / พาร์ท มาวาง หรือกดเพื่อเลือก</b><span>ระบบอ่านแล้วลงคลังของโปรเจคให้ทันที พร้อมเลือกเบอร์นั้นให้ · หลายไฟล์พร้อมกันได้ · ไฟล์ชื่อซ้ำ = แทนที่ของเดิม</span></div>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden data-testid="pick-pdf-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {reading ? <div className={`rw-msg ${reading.err ? "bad" : reading.ok ? (reading.warn ? "warn" : "ok") : "info"}`}>
        {reading.err || (reading.ok ? <>✓ {reading.ok}{reading.warn ? <> · {reading.warn}</> : null}</> : reading.msg ? reading.msg : `กำลังอ่าน PDF ${reading.n}/${reading.of}…`)}
        {(reading.err || reading.ok) ? <button type="button" className="rw-link" style={{ marginLeft: 8 }} onClick={() => setReading(null)}>ปิด</button> : null}
      </div> : null}
      {libState.s === "loading" ? <div className="rw-msg info">กำลังโหลดคลังของโปรเจค…</div> : null}
      {libState.s === "err" ? <div className="rw-msg bad">✗ โหลดคลังไม่ได้: {libState.err}</div> : null}
      <div className="rw-picked">
        <span className="rw-muted small">เลือกแล้ว: ซับ <b>{nf(nSub)}</b> · พาร์ท <b>{nf(nPart)}</b> เบอร์</span>
        {picks.slice(0, 40).map((p) => (
          <span key={key(p.kind, p.code)} className={`rw-pick-chip ${p.kind}`}>{p.code} <b>×{nf(p.qty)}</b><button type="button" aria-label={`เอา ${p.code} ออก`} onClick={() => setQty(p.kind, p.code, 0)}>×</button></span>))}
        {picks.length > 40 ? <span className="rw-muted small">… อีก {picks.length - 40} เบอร์</span> : null}
        {picks.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicks([])}><Icon name="trash" size={13} /> ล้างที่เลือก</button> : null}
      </div>
      <div className="rw-tools">
        <div className="rw-seg">{[["sub", `ซับ (${nf(subs.length)})`], ["part", `พาร์ท (${nf(parts.length)})`]].map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
        <input className="input rw-search" placeholder="ค้นหาเบอร์ / description" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap rw-tw">
        <table className="data-table rw-table">
          <thead><tr><th style={{ width: 96 }}>จำนวน</th><th>CODE</th><th>DESCRIPTION</th><th className="r">LENGTH</th><th>{tab === "sub" ? "ลูกใน BOM" : "หมวด"}</th></tr></thead>
          <tbody>{list.slice(0, 300).map((r) => {
            const kind = tab === "sub" ? "sub" : "part"; const v = qtyOf.get(key(kind, r.code)); const path = "P|" + r.code;
            return (
              <Fragment key={kind + r.code}>
                <tr className={v ? "rw-picked-row" : ""}>
                  <td><input className="input rw-pick-qty" type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={v || ""} aria-label={`จำนวน ${r.code}`} onChange={(e) => setQty(kind, r.code, e.target.value)} /></td>
                  <td className="rw-mono">{kind === "sub" ? <button type="button" className="rw-tg" onClick={() => setOpen((o) => ({ ...o, [path]: !o[path] }))} aria-expanded={!!open[path]} title="ดูเบอร์ลูก">{open[path] ? "▾" : "▸"}</button> : null}<b>{r.code}</b>{isStar(r.code) ? <> <Pill tone="warn">Site *</Pill></> : null}</td>
                  <td className="rw-desc">{r.d}</td>
                  <td className="r">{nlen(r.l)}</td>
                  <td>{kind === "sub" ? (r.nKids ? <Pill tone="muted">{r.nKids} รายการ</Pill> : <Pill tone="warn" title="ยังไม่เคยลงแบบ PDF ของซับนี้ที่หน้า ซับ / พาร์ท ของโปรเจค">ยังไม่มีเบอร์ลูก</Pill>) : <span className="rw-muted small">{r.cat}</span>}</td>
                </tr>
                {kind === "sub" && open[path] ? <SubKids lib={bom} code={r.code} path={path} depth={1} open={open} setOpen={setOpen} seen={[NC(r.code)]} compact /> : null}
              </Fragment>); })}</tbody>
        </table>
        {list.length > 300 ? <div className="rw-muted small" style={{ padding: 10 }}>แสดง 300 จาก {nf(list.length)} เบอร์ — พิมพ์ค้นหาเพื่อดูที่เหลือ</div> : null}
        {!list.length ? <div className="rw-muted small" style={{ padding: 14 }}>{libState.s === "loading" ? "กำลังโหลด…" : Q ? "ไม่พบเบอร์ที่ค้นหา" : tab === "sub" ? "ยังไม่มีซับในคลังของโปรเจคนี้ — ลาก PDF แบบซับมาวางด้านบนได้เลย (หรือลงที่หน้า “ซับ / พาร์ท ของโปรเจค” แล้วกด ↻ โหลดคลังใหม่)" : "ยังไม่มีพาร์ทที่มี QR ในคลัง — ลงแบบพาร์ทที่หน้า “ซับ / พาร์ท ของโปรเจค”"}</div> : null}
      </div>
      <div className="rw-muted small" style={{ marginTop: 8 }}>{nOldRev ? <>เบอร์ที่มีหลายรุ่น แสดงเฉพาะรุ่นล่าสุด (ซ่อนรุ่นเก่า {nf(nOldRev)} เบอร์) · </> : null}แสดงเฉพาะพาร์ทที่ผลิตเอง (มี QR) · สกรู / ยาง / กระจก ไม่ทำ QR · ซับที่ปล่อยจะไปเป็นใบงานพับ / เชื่อม / ยิง ตามกติกาเบอร์ (แก้ได้ในขั้นตรวจ + บันทึก)</div>
    </div>
  );
}

function SaveStep({ itemsMode, releases, draftPlan, saveChecks, go, plan, units, cnt, roNorm, project, catOf, catOv, setCatOv, procOf, setProcOv, destOv, setDestOv, afterSave, setAfterSave, bomSave, saving, hdr }) {
  const [tab, setTab] = useState("make");
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const icon = { ok: "✓", warn: "⚠", block: "✗" };
  const sum = (arr) => arr.reduce((a, x) => a + x.qty, 0);
  const items = useMemo(() => {
    const rows = [];
    for (const s of plan.subs) rows.push({ code: s.code, type: "sub", d: s.d, qty: s.qty, uom: "SET" });
    for (const p of [...plan.parts, ...plan.glass, ...plan.other, ...plan.hw]) rows.push({ code: p.code, type: p.k === "hw" ? "hw" : "part", d: p.d, qty: p.k === "hw" && p.u === "m." ? (p.mm ? p.qty / 1000 : p.qty) : p.qty, uom: p.k === "hw" ? (p.u === "m." ? "m." : "pcs.") : "pcs." });
    return rows;
  }, [plan]);
  const vis = items.filter((r) => (type === "all" || r.type === type) && (!q || r.code.toUpperCase().includes(q.toUpperCase()) || String(r.d).toUpperCase().includes(q.toUpperCase()))).sort((a, b) => ncmp(a.code, b.code));
  const mats = useMemo(() => cutMaterials(plan.parts), [plan]);
  // ★ 2026-10-16: Total Part แยกตาม "หมวด" (PART_CATS) ไม่ใช่ชีต CUTTING/BENDING/STEEL — เดิมค้นผิดชุดจนหน้าพัง (reading 'kind')
  const partsIn = (k) => plan.parts.filter((p) => (PART_CATS.includes(k) ? catOf(p.code, "part") === k : p.dest === k));
  const sheetN = (k) => (k === "panel" ? units.length : PART_CATS.includes(k) || isPartSheet(k) ? partsIn(k).length : plan.subs.filter((s) => s.procs.includes(k)).length);
  const sheetQ = (k) => (k === "panel" ? units.length : PART_CATS.includes(k) || isPartSheet(k) ? sum(partsIn(k)) : sum(plan.subs.filter((s) => s.procs.includes(k))));
  return (
    <>
      <div className="card rw-card">
        <SecHead title="ตรวจก่อนบันทึก" sub="บันทึก = เก็บ Release นี้ (ที่อยู่ + BOM + ใบงาน) แล้ว office เลือกปล่อยเป็นล็อต — QR สร้างตอนปล่อยล็อต" />
        <div className="rw-checks">
          {saveChecks.map((c) => (
            <div key={c.k} className={`rw-chk ${c.s}`}>
              <span className="ic">{icon[c.s]}</span><b>{c.label}</b><span className="v">{c.v}</span>
              {c.s !== "ok" ? <button type="button" className="rw-link" onClick={() => (c.go === 3 ? setTab(c.tab || "make") : go(c.go))}>แก้</button> : <span />}
            </div>))}
        </div>
        <div className="rw-after" role="radiogroup" aria-label="หลังบันทึก">
          <label className={`rw-after-opt ${afterSave === "lots" ? "on" : ""}`}>
            <input type="radio" name="rw-after" checked={afterSave === "lots"} onChange={() => setAfterSave("lots")} />
            <span><b>บันทึก แล้วเลือกปล่อยเป็นล็อต</b><small>office เลือกเองว่าปล่อยอะไรก่อน (พาร์ท / ซับ / แผง) และส่งไปใบงานไหน · ได้ {roNorm || "P-xxx"}.1 / .2 / …</small></span>
          </label>
          <label className={`rw-after-opt ${afterSave === "all" ? "on" : ""}`}>
            <input type="radio" name="rw-after" checked={afterSave === "all"} onChange={() => setAfterSave("all")} />
            <span><b>ปล่อยทั้งหมดเลยเป็น {roNorm || "P-xxx"}</b><small>ใบที่ปล่อยครบรอบเดียว · สร้าง QR ทุกอย่างทันทีตอนบันทึก</small></span>
          </label>
        </div>
        {saving.err ? <div className="rw-msg bad">✗ {saving.err}</div> : null}
        {saving.errors.length ? (
          <div className="rw-msg warn">
            <b>บันทึก Release แล้ว แต่บางขั้นยังไม่เสร็จ:</b>
            <ul>{saving.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            กด "บันทึกขั้นที่เหลือ" เพื่อลองใหม่
          </div>) : null}
      </div>

      <div className="card rw-card">
        <div className="rw-tabs" role="tablist">
          {[["make", "สรุปทั้งใบ"], ["items", `ใบงาน + Category (${nf(items.length)})`], ...(itemsMode ? [] : [["labels", "ป้ายแผง"]])].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === "make" && (
          <>
            {/* หัว Total 3 อย่างตาม Excel (Total Part · Total Sub-Assembly · Total Mat.) + แผง */}
            <div className="rw-sumgrps">
              {TOTALS.filter((g) => g.k !== "mat").map((g) => (
                <div key={g.k} className={`rw-sumgrp ${g.k}`}>
                  <div className="rw-sumgrp-h"><b>{g.label}</b><small>{g.th}</small></div>
                  <div className="rw-sheetsum">
                    {g.k === "mat"
                      ? [["วัตถุดิบงานตัด", `${nf(mats.length)} รายการ`, `${nf(mats.reduce((a, m) => a + m.bars, 0))} เส้น (ประมาณ)`], ["GLASS", `${nf(plan.glass.length)} เบอร์`, `${nf(sum(plan.glass))} แผ่น`], ["FIXING", `${nf(plan.hw.length)} รายการ`, "สกรู / ยาง / ซิลิโคน"], ...(plan.other.length ? [["อื่นๆ", `${nf(plan.other.length)} เบอร์`, [...new Set(plan.other.map((o) => o.cat))].join(" · ")]] : [])]
                        .map(([t, a, b]) => <div key={t} className="rw-sheetsum-i mat"><b>{t}</b><span>{a} · {b}</span></div>)
                      : g.sheets.map((k) => { const s = SHEETS.find((x) => x.k === k) || { kind: "part", tab: k, label: k }; return <div key={k} className={`rw-sheetsum-i ${s.kind}`} title={s.label}><b>{s.tab}</b><span>{nf(sheetN(k))} เบอร์ · {nf(sheetQ(k))} {s.kind === "sub" ? "SET" : "ชิ้น"}</span></div>; })}
                  </div>
                </div>))}
              {itemsMode ? null : (
              <div className="rw-sumgrp panel">
                <div className="rw-sumgrp-h"><b>ASSEMBLY (แผง)</b><small>1 QR ต่อที่อยู่</small></div>
                <div className="rw-sheetsum"><div className="rw-sheetsum-i panel"><b>แผง</b><span>{nf(units.length)} แผง · {nf(cnt.length)} แบบ</span></div></div>
              </div>
              )}

              {TOTALS.filter((g) => g.k === "mat").map((g) => (
                <div key={g.k} className={`rw-sumgrp ${g.k}`}>
                  <div className="rw-sumgrp-h"><b>{g.label}</b><small>{g.th}</small></div>
                  <div className="rw-sheetsum">
                    {g.k === "mat"
                      ? [["วัตถุดิบงานตัด", `${nf(mats.length)} รายการ`, `${nf(mats.reduce((a, m) => a + m.bars, 0))} เส้น (ประมาณ)`], ["GLASS", `${nf(plan.glass.length)} เบอร์`, `${nf(sum(plan.glass))} แผ่น`], ["FIXING", `${nf(plan.hw.length)} รายการ`, "สกรู / ยาง / ซิลิโคน"], ...(plan.other.length ? [["อื่นๆ", `${nf(plan.other.length)} เบอร์`, [...new Set(plan.other.map((o) => o.cat))].join(" · ")]] : [])]
                        .map(([t, a, b]) => <div key={t} className="rw-sheetsum-i mat"><b>{t}</b><span>{a} · {b}</span></div>)
                      : g.sheets.map((k) => { const s = SHEETS.find((x) => x.k === k) || { kind: "part", tab: k, label: k }; return <div key={k} className={`rw-sheetsum-i ${s.kind}`} title={s.label}><b>{s.tab}</b><span>{nf(sheetN(k))} เบอร์ · {nf(sheetQ(k))} {s.kind === "sub" ? "SET" : "ชิ้น"}</span></div>; })}
                  </div>
                </div>))}
            </div>
            <div className="rw-muted small" style={{ margin: "8px 0 14px" }}>ใบงานตั้งตามกติกาเบอร์ (MACHINING → CUTTING · BENDING → BENDING · STEEL → STEEL · SAAL → เชื่อม · SAAP/SASF → พับ · เบอร์ * → Site Item · อื่น → ยิง) · แก้ได้ในแท็บ "ใบงาน + Category" หรือตอนปล่อยล็อต · ซับ 1 เบอร์อยู่ได้หลายใบ</div>
            {(() => {
              const rel = releasedOf(releases, draftPlan);
              const used = [...plan.subs, ...plan.parts].map((x) => [x, otherOf(rel, x.code)]).filter(([, o]) => o);
              return used.length ? <div className="rw-msg ok">✓ เบอร์ที่ปล่อยไว้แล้วใน Release อื่นของโปรเจคนี้ <b>{nf(used.length)} เบอร์</b> — ใช้เป็นเบอร์ลูก ไม่ปล่อยซ้ำ: {used.slice(0, 8).map(([x, o]) => `${x.code} (ทำแล้วที่ ${o.ros.join(", ")})`).join(" · ")}{used.length > 8 ? " …" : ""}</div> : null;
            })()}
            <div className="rw-makes">
              {itemsMode ? null : <SumCard tone="panel" title="แผง" big={`${nf(units.length)} QR`}>{cnt.length} แบบแผง · 1 QR ต่อ 1 ที่อยู่ · BOM แผง = ซับ + พาร์ทติดแผง</SumCard>}
              <SumCard tone="sub" title="ซับ" big={`${nf(sum(plan.subs))} QR`}>{plan.subs.length} เบอร์ · ตั้ง BOM ให้เอง · ใช้ที่สถานีประกอบ</SumCard>
              <SumCard tone="part" title="พาร์ท" big={`${nf(sum(plan.parts))} QR`}>{plan.parts.length} เบอร์ · {PART_DESTS.map((k) => `${destLabel(k)} ${nf(sum(plan.parts.filter((p) => p.dest === k)))}`).join(" · ")} ชิ้น</SumCard>
              <SumCard tone="muted" title="GLASS" big={`${nf(sum(plan.glass))} แผ่น`}>{plan.glass.length} เบอร์ · ใบเบิกกระจก — ไม่ทำ QR</SumCard>
              <SumCard tone="muted" title="Hardware" big={`${plan.hw.length} รายการ`}>สกรู / ยาง / เทป — ไม่ทำ QR</SumCard>
              {plan.other.length ? <SumCard tone="muted" title="อื่นๆ" big={`${plan.other.length} เบอร์`}>{[...new Set(plan.other.map((o) => o.cat))].join(" · ")} — ไม่ทำ QR</SumCard> : null}
              {cnt.some((c) => !c.has) ? <SumCard tone="warn" title="⚠ ยังไม่มี BOM" big={`${nf(cnt.filter((c) => !c.has).reduce((a, c) => a + c.qty, 0))} แผง`}>{cnt.filter((c) => !c.has).slice(0, 8).map((c) => c.unit).join(", ")}</SumCard> : null}
              {itemsMode ? null : <SumCard tone="info" title="BOM ที่จะตั้งในระบบ" wide>แผง {bomSave.list.filter((b) => b.kind === "panel").length} · ซับ {bomSave.list.filter((b) => b.kind === "subassembly").length} เบอร์ · ลูกใน BOM = ซับ + พาร์ทที่มี QR (กระจก/สกรู/ยางไม่ใส่ เพราะไม่มี QR ให้สแกนตอนประกอบ){bomSave.frac.length ? ` · ⚠ ปัดจำนวนต่อชุด ${bomSave.frac.length} รายการ` : ""}</SumCard>}
            </div>
          </>
        )}
        {tab === "items" && (
          <>
            <div className="rw-tools">
              <input className="input rw-search" placeholder="ค้นหาเบอร์ / description" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="rw-seg">{[["all", "ทั้งหมด"], ["sub", "ซับ"], ["part", "พาร์ท"], ["hw", "Hardware"]].map(([k, l]) => <button key={k} type="button" className={type === k ? "on" : ""} onClick={() => setType(k)}>{l}</button>)}</div>
              {Object.keys(catOv).length || Object.keys(destOv).length ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCatOv({}); setProcOv({}); setDestOv({}); }}>คืนค่าตามกติกาเบอร์</button> : null}
            </div>
            <div className="table-wrap rw-tw">
              <table className="data-table rw-table">
                <thead><tr><th>Code</th><th>Description</th><th className="r">จำนวน</th><th>Category</th><th>ใบงาน (ส่งไปทำที่)</th></tr></thead>
                <tbody>{vis.slice(0, 500).map((r) => {
                  const cat = r.type === "sub" ? "SUB-ASSEMBLY PART" : catOf(r.code, r.type);
                  const qr = r.type === "part" && QR_CATS.has(cat);
                  return (
                    <tr key={r.type + r.code}>
                      <td className="rw-mono"><b>{r.code}</b>{isStar(r.code) ? <> <Pill tone="warn">Site *</Pill></> : null}</td>
                      <td className="rw-desc">{r.d}</td>
                      <td className="r">{nlen(r.qty)} <span className="rw-muted small">{r.uom}</span></td>
                      <td>{r.type === "sub" ? <Pill tone="sub">SUB-ASSEMBLY</Pill> : (
                        <select className="select rw-cellsel" value={cat} onChange={(e) => { setCatOv((o) => ({ ...o, [r.code]: e.target.value })); setDestOv((o) => { const n = { ...o }; delete n[r.code]; return n; }); }} aria-label={`Category ${r.code}`}>
                          {PART_CATS.filter((c) => c !== "SUB-ASSEMBLY PART").map((c) => <option key={c} value={c}>{c}{QR_CATS.has(c) ? " · QR" : ""}</option>)}
                        </select>)}</td>
                      <td>{r.type === "sub" ? (
                        <span className="rw-procs">{PROCS.map((p) => { const on = procList(procOf(r.code)).includes(p); return (
                          <label key={p} className={`rw-proc ${on ? "on" : ""}`}><input type="checkbox" checked={on} onChange={(e) => setProcOv((o) => { const cur = procList(o[r.code] ?? procOf(r.code)); const nx = e.target.checked ? [...cur, p] : cur.filter((x) => x !== p); return { ...o, [r.code]: PROCS.filter((x) => nx.includes(x)).join(", ") }; })} />{SUB_SHORT[p]}</label>); })}</span>
                      ) : qr && CAT_DEST[cat] && (!destOv[r.code] || destOv[r.code] === CAT_DEST[cat]) ? (
                        <span className="rw-muted small">= ตามหมวด (ใบเดียวกัน)</span>
                      ) : qr ? (
                        <select className="select rw-cellsel" style={{ minWidth: 130 }} value={destOv[r.code] || ruleDest(cat, r.code)} onChange={(e) => setDestOv((o) => ({ ...o, [r.code]: e.target.value }))} aria-label={`ใบงาน ${r.code}`}>
                          {PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}
                        </select>
                      ) : <span className="rw-muted small">ไม่ทำ QR (ใบเบิก)</span>}</td>
                    </tr>); })}</tbody>
              </table>
              {vis.length > 500 ? <div className="rw-muted small" style={{ padding: 10 }}>แสดง 500 จาก {nf(vis.length)} — ค้นหาเพื่อดูที่เหลือ</div> : null}
            </div>
            <div className="rw-muted small" style={{ marginTop: 8 }}>ซับ 1 เบอร์ติ๊กได้หลายงาน = อยู่ในหลายใบ (SUB-ASSEMBLY งานพับ / งานเชื่อม / SUB A'ssy ยิง / Site Item) · พาร์ทเลือกว่าไป CUTTING หรือ BENDING · เปลี่ยนเป็นหมวดที่มี "· QR" = ได้ QR พาร์ท</div>
          </>
        )}
        {tab === "labels" && (
          <div className="rw-labels">
            {units.slice(0, 6).map((u, i) => (
              <div key={i} className="rw-label">
                <div className="rw-qr" aria-hidden="true">{Array.from({ length: 49 }, (_, k) => <i key={k} className={(k * 7 + i * 3 + u.addr.length) % 3 ? "" : "b"} />)}</div>
                <div><div className="l1">{u.unit}</div><div className="l2">{u.mock ? `MOCKUP ${mockType(u.unit)}`.trim() : u.addr}</div><div className="l3">{roNorm} · {project?.code || ""}</div></div>
              </div>))}
            <div className="rw-muted small" style={{ gridColumn: "1 / -1" }}>ตัวอย่างหน้าตาป้ายแผง (QR จริงสร้างตอนปล่อยล็อต — พิมพ์ได้ที่เมนู "พิมพ์ QR / ป้าย") · {fmtYmd(hdr.date)}</div>
          </div>
        )}
      </div>
    </>
  );
}
