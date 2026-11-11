// ══════════════════════════════════════════════════════════════════════════
// Release (แผน) + ปล่อยเป็นล็อต — office เลือกเองว่าจะปล่อยอะไร (แผง / ซับ / พาร์ท) และส่งไปใบงานไหน
//   หัว Total 3 อย่าง (ตาม Excel): Total Part (MACHINING PART · BENDING · STEEL) · Total Sub-Assembly (SUB A'ssy พับ / เชื่อม / Site Item / ยิง) · Total Mat. (วัตถุดิบงานตัด · GLASS · FIXING)
//   ซับ 1 เบอร์ไปได้หลายใบ (พับ + เชื่อม + ยิง) · พาร์ทเลือกได้ว่าไป MACHINING PART / BENDING / STEEL
//   ล็อต = P-142.1 / .2 / … (หรือ P-142 เอง) ปล่อยก่อนหลังได้ · ระบบหักของที่ปล่อยแล้ว ไม่ให้ปล่อยเกิน
// ══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useUndoState, pushUndoGate } from "../undo.js";
import Icon from "../icons.jsx";
import { askConfirm } from "../confirm.jsx";
import { getSession } from "../auth.js";
import {
  NC, ncmp, nf, nlen, findKey, isStar, SHEETS, PART_DESTS, isPartSheet, TOTALS, PROCS, procList, needOf, releasedOf, nextLotNo, lotOf, lotRows, explodeFrom, roKey,
  otherOf, bomGaps, pullBomFromPlans, modifyOps, applyModToPlan, bomEditEffects, ruleDest, modVer, nextModNo, lotModMap, addrKey, addrsFromNote, lotMaterials, refreshBomFromLib, sheetKeyOf, ruleCat, QR_CATS, destLabel, readPdfFiles, findLatest, baseOf, hwIssuedOf, CAT_DEST, replayMods } from "./releaseCore.js";
import { Pill, ModQty, Code, SUB_SHORT } from "./releaseUi.jsx";
import { TotalsSection } from "./ReleaseTotals.jsx";
import LotSheetPreview from "./LotSheetPreview.jsx";
import { compareOrder, readOrderFile, readOrderPdf } from "./orderSheet.js";
import "./release-wizard.css";
import "./i18n-release.js";   // คำแปลอังกฤษของหน้า Release

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
export function ReleasePlanView({ plan, releases, plans = [], api, user, onBack, onPlanChange, onReleased, onModified, openBuilder = false, onPrintQr = null, onOpenLot = null, onDelete = null, inbox = null, onSheetMoved = null, onOpenPart = null }) {
  const { need, rel, doneOf, leftOf } = usePlanState(plan, releases);
  // ★ 2026-11-10 ปล่อยผิดใบ (งานพับไปอยู่ MACHINING PART) → ย้ายหมวดของเบอร์ที่ปล่อยแล้ว: แก้ "ใบ: …" ในแถวที่ปล่อย + หมวดในแผน (QR เดิมใช้ต่อ)
  async function moveReleased(codes, cat) {
    const set = new Set(codes.map(NC));
    const rows = rel.lots.flatMap((L) => L.rows.filter((r) => set.has(NC(r.code)) && r.kind !== "panel" && r.kind !== "subassembly" && !r.mod_cancelled_at).map((r) => ({ ...r, lot: L.no })));
    if (!rows.length) return;
    const dest = CAT_DEST[cat] || ruleDest(cat, codes[0]); const toLabel = destLabel(dest);
    const fromLabels = [...new Set(rows.map((r) => (/ใบ:\s*(.+?)(?:\s*·|$)/.exec(r.note || "") || [])[1] || "—"))];
    const qty = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    const ok = await askConfirm({
      title: `ย้าย ${codes.length} เบอร์ที่ปล่อยแล้ว → ใบ ${toLabel}?`,
      message: [`เบอร์: ${codes.join(", ")}`, `ล็อต: ${[...new Set(rows.map((r) => r.lot))].join(", ")} · ${nf(qty)} ชิ้น · จากใบ ${fromLabels.join(", ")}`, "", "QR และประวัติสแกนเดิมอยู่ครบ · หน้าล็อต / ใบสั่งผลิต จะย้ายไปใบใหม่ (ใบที่พิมพ์ไปแล้วต้องพิมพ์ใหม่) · หมวดในใบหลักเปลี่ยนเป็น " + cat].join("\n"),
      tone: "warn", confirmText: "ย้ายใบงาน", cancelText: "ยกเลิก",
    });
    if (!ok) return;
    try {
      const n = await api.moveReleasedSheet(rows, toLabel);
      const catOv = { ...(plan.catOv || {}) }; const destOv = { ...(plan.destOv || {}) };
      for (const c of codes) { catOv[c] = cat; if (CAT_DEST[cat]) delete destOv[c]; else destOv[c] = dest; }
      onPlanChange({ ...plan, catOv, destOv });
      onSheetMoved && onSheetMoved({ codes, toLabel, rows: n });
    } catch (e) { alert("ย้ายใบงานไม่สำเร็จ: " + (e?.message || e)); }
  }
  // ★ 2026-11-10 มาจากกล่องรับเอกสาร: เปิด Modify / เพิ่มรายการ พร้อมไฟล์ที่วางไว้แล้ว (inbox = { mode: "modify"|"add", files })
  const [inboxFiles, setInboxFiles] = useState(null);
  useEffect(() => { if (inbox && inbox.files && inbox.files.length) { setInboxFiles(inbox.files); setModify(inbox.mode === "add" ? "add" : true); } }, [inbox]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ★ 2026-11-10 ใบปะหน้า (plan.order) — เทียบกับของในใบ: แบบยังมาไม่ครบ → เตือน + ปุ่มเพิ่มรายการ
  const orderCmp = useMemo(() => (plan.order ? compareOrder(plan.order, need) : []), [plan.order, need]);
  const orderMiss = orderCmp.filter((x) => x.status === "missing"), orderDiff = orderCmp.filter((x) => x.status === "less" || x.status === "more");
  const [cmpOpen, setCmpOpen] = useState(() => new Set());
  const [modsOpen, setModsOpen] = useState(false);
  // ★ 2026-11-11 ป้ายม่วง M-001 ในตาราง (ModTag) กดแล้ว → เปิดประวัติ Modify ที่ M นั้น
  useEffect(() => {
    const on = (e) => { const v = String(e.detail || ""); if (!v) return; setCmpOpen(new Set([v])); setModsOpen(true); };
    window.addEventListener("rl-open-mod", on); return () => window.removeEventListener("rl-open-mod", on);
  }, []);
  const [progOpen, setProgOpen] = useState(false);   // ★ 2026-11-11 ป็อปอัพ "ทำไปแค่ไหนแล้ว" ทั้ง Release (แบบที่ 3)
  // ★ 2026-11-11 กดแถวในตาราง "ของในใบ" → ความคืบหน้าของเบอร์นั้น: ปล่อยในล็อตเดียว = ป็อปอัพแยกขั้นตอน (ตัวเดียวกับหน้าล็อต) · หลายล็อต = ป็อปอัพทั้งใบ กรองเฉพาะเบอร์นี้
  const [rowMsg, setRowMsg] = useState("");
  useEffect(() => { if (!rowMsg) return undefined; const t = setTimeout(() => setRowMsg(""), 3500); return () => clearTimeout(t); }, [rowMsg]);
  const rowProgress = (code, kind) => {
    const hit = []; for (const L of rel.lots) { if (L.hwOnly) continue; for (const r of L.rows) if (!r.mod_cancelled_at && NC(r.code) === NC(code) && (kind === "subassembly" ? r.kind === "subassembly" : r.kind !== "subassembly" && r.kind !== "panel")) hit.push(r); }
    if (!hit.length) { setRowMsg(`${code} ยังไม่ได้ปล่อย — ยังไม่มีความคืบหน้าให้ดู`); return; }
    if (hit.length === 1 && onOpenPart && onOpenPart(hit[0].id)) return;
    setProgOpen(String(code));
  };
  const [modEdit, setModEdit] = useState(null);   // ★ 2026-11-10 M ที่กำลังแก้ (บันทึกผิด)   // ★ 2026-11-10 แบบ B: ประวัติ Modify เปิดเป็นแผงด้านขวา
  const [lotsAll, setLotsAll] = useState(false);
  // ★ 2026-11-10 แถบขวาพับได้: "auto" = พับเองตอนดูแท็บ BOM (ตารางกว้าง) · "show" / "hide" = ผู้ใช้เลือก (จำไว้)
  //   จำไว้แค่ "hide" (ซ่อนทุกแท็บ) · เปิดดูตอนอยู่ BOM = ชั่วคราว (peek) — เปลี่ยนแท็บ / ออกแล้วเข้าใหม่ = BOM พับเองเหมือนเดิม
  const [side, setSideRaw] = useState(() => { try { return localStorage.getItem("rl-side") === "hide" ? "hide" : "auto"; } catch { return "auto"; } });
  const [peek, setPeek] = useState(false);
  const [tab, setTabRaw] = useState("part");
  const setTab = (t) => { setTabRaw(t); setPeek(false); };
  const setSide = (v) => { setSideRaw(v); try { localStorage.setItem("rl-side", v); } catch { /* ignore */ } };
  const sideHidden = !peek && (side === "hide" || tab === "bom");
  const showSide = () => { if (side === "hide") setSide("auto"); if (tab === "bom") setPeek(true); };
  const hideSide = () => { setPeek(false); if (tab !== "bom") setSide("hide"); };   // ★ 2026-11-10 Modify ที่เปิดตารางเปรียบเทียบก่อน/หลัง
  const lotsRef = useRef(null);   // ★ 2026-11-04 ล็อตที่ปล่อยแล้ว ย้ายขึ้นไว้ใต้ KPI (เดิมอยู่ใต้ Total ต้องเลื่อนไกล)
  const [builder, setBuilder] = useState(openBuilder);
  const [preset, setPreset] = useState(null);   // เลือกจากตาราง Total แล้วกด "ปล่อยที่เลือก"
  const [modify, setModify] = useState(false);   // true = Modify (มีเลข M) · "add" = เพิ่มรายการใหม่เฉย ๆ (ไม่นับ Modify)
  // ★ 2026-10-26 ล็อตที่เปิด: เข้ามาครั้งแรก = ล็อตล่าสุดเปิดค้างไว้ · จำที่ผู้ใช้เปิด/ปิดไว้ต่อ Release (localStorage) · ปล่อยล็อตใหม่ = เปิดล็อตใหม่ให้
  const openKey = `mls-lot-open:${plan.id || plan.ro}`;
  const newestNo = rel.lots.length ? rel.lots[rel.lots.length - 1].no : null;
  // ★ 2026-11-10 แบบ B: ล็อตกางในหน้าเฉพาะตอนกด "เปิด" (ไม่มีหน้าล็อตแยก / ใบเบิกอุปกรณ์) — เปิดหน้าใหม่ = ไม่กางค้าง
  const [open, setOpenRaw] = useState(() => (onOpenLot ? null : (() => { try { const v = localStorage.getItem(openKey); if (v !== null) return v === "" ? null : rel.lots.some((l) => l.no === v) ? v : newestNo; } catch { /* ignore */ } return null; })()));
  const [lotQ, setLotQ] = useState("");   // ★ ค้นหาในล็อตที่เปิด (เบอร์ / รายละเอียด / ที่อยู่ / INV)
  const setOpen = (v) => { setOpenRaw(v); setLotQ(""); try { localStorage.setItem(openKey, v || ""); } catch { /* ignore */ } };
  // ★ 2026-11-11 ป้ายเลขล็อตในตารางแผง (LotTag) กดแล้ว → เปิดล็อตนั้น (หน้าล็อต ถ้ามี · ไม่มี = กางในหน้านี้)
  useEffect(() => {
    const on = (e) => { const no = String(e.detail || ""); if (!no) return; const L = rel.lots.find((x) => x.no === no); if (onOpenLot && !(L && L.hwOnly)) onOpenLot(no); else setOpen(no); };
    window.addEventListener("rl-open-lot", on); return () => window.removeEventListener("rl-open-lot", on);
  });
  const nLotsRef = useRef(rel.lots.length);
  useEffect(() => {
    const prev = nLotsRef.current; nLotsRef.current = rel.lots.length;
    if (!newestNo || rel.lots.length <= prev) return;
    if (prev === 0) {   // ล็อตเพิ่งโหลดมา (เปิดหน้ามาก่อนข้อมูลมา) → ใช้ที่จำไว้ ถ้าไม่มี = ล่าสุด
      let v = null; try { v = localStorage.getItem(openKey); } catch { /* ignore */ }
      setOpenRaw(v === null ? newestNo : v === "" ? null : rel.lots.some((l) => l.no === v) ? v : newestNo);
    } else setOpen(newestNo);   // ปล่อยล็อตใหม่ → เปิดล็อตใหม่
  }, [rel.lots.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  // BOM ที่ยังไม่มีในแผนนี้ → ดึงจาก Release อื่นของโปรเจคเดียวกันให้เอง (เฉพาะที่ว่าง)
  const gaps = useMemo(() => bomGaps(plan), [plan]);
  const [pulled, setPulled] = useState([]);
  // ★ อัปเดต BOM จากคลังโปรเจค (เติมบรรทัดจาก PDF / รายละเอียดสกรู-ยาง · ไม่แตะจำนวน/Modify)
  const [libSync, setLibSync] = useState(null);   // null | { busy } | { ok, text } | { err }
  const syncFromLib = async () => {
    if (!api?.loadBomLibrary || !onPlanChange) return;
    setLibSync({ busy: true });
    try {
      const panelCodes = [...new Set((plan.units || []).map((u) => u.unit).filter(Boolean))];
      const lib = await api.loadBomLibrary(plan.projectId, panelCodes.length ? panelCodes : null);
      const r = refreshBomFromLib(plan, lib);
      if (!r.n) { setLibSync({ ok: true, text: "BOM ของ Release นี้ตรงกับคลังแล้ว — ไม่มีอะไรต้องเติม" }); return; }
      const c = r.changes; const ls = (a) => a.slice(0, 5).join(", ") + (a.length > 5 ? ` …(+${a.length - 5})` : "");
      const lines = [
        c.full.length && `• ซับ ${c.full.length} เบอร์: ใช้รายการครบจาก PDF (สกรู/ยาง/กระจก) — ${ls(c.full)}`,
        c.filled.length && `• ซับ ${c.filled.length} เบอร์ที่ยังไม่มีลูก: ใส่ลูกจากคลัง — ${ls(c.filled)}`,
        c.addedSubs.length && `• ซับลูกที่ยังไม่มีในแผน ${c.addedSubs.length} เบอร์ — ${ls(c.addedSubs)}`,
        c.parts.length && `• พาร์ท/สกรู/ยาง ${c.parts.length} เบอร์: เติมรายละเอียด/หน่วย — ${ls(c.parts)}`,
      ].filter(Boolean);
      setLibSync(null);
      const ok = await askConfirm({ title: `อัปเดต BOM ของ ${plan.ro} จากคลัง?`, message: lines.join("\n") + "\n\nไม่เปลี่ยนจำนวนที่ปล่อยแล้ว / ประวัติ Modify / QR · ใบปล่อยและใบเบิกจะใช้ข้อมูลใหม่", confirmText: "อัปเดต" });
      if (!ok) { setLibSync(null); return; }
      onPlanChange(r.plan);
      setLibSync({ ok: true, text: `อัปเดต BOM จากคลังแล้ว (${r.n} รายการ)` });
    } catch (e) { setLibSync({ err: "อัปเดตจากคลังไม่สำเร็จ: " + (e?.message || e) }); }
  };
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
  const [fixLot, setFixLot] = useState(null);   // ★ 2026-11-10 แก้ล็อตที่ปล่อยผิด (ย้ายใบ / ยกเลิกการปล่อย) — เปิดจากแถบล็อตด้านบน ไม่ต้องเลื่อนลงไปหา
  useEffect(() => { document.body.style.overflow = builder || modify || progOpen || modsOpen || fixLot ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [builder, modify, progOpen, modsOpen, fixLot]);   // ล็อกจอข้างหลังตอนมีป็อปอัพ / แผงข้าง
  const [sheetPrev, setSheetPrev] = useState(null);   // ตัวอย่างใบปล่อย (PDF / Excel) ของล็อต
  // ★ ความคืบหน้าต่อล็อต: ยอดที่ทำแล้วต่อแถว release (get_release_modify_info) — โหลดเบื้องหลัง · ไม่ได้ = ไม่โชว์
  const lotKey = rel.lots.map((l) => `${l.no}:${l.rows.length}:${l.qty}`).join("|");
  const [prod, setProd] = useState(null);   // Map(release_id → ทำแล้ว)
  useEffect(() => {
    if (!api?.lotLimits || !rel.lots.length) { setProd(null); return; }
    let alive = true;
    api.lotLimits(plan, rel.lots.map((l) => l.no))
      .then(({ limits }) => { if (!alive) return; const m = new Map(); for (const [rid, v] of limits || []) m.set(String(rid), Number(v?.produced) || 0); setProd(m); })
      .catch(() => { if (alive) setProd(null); });
    return () => { alive = false; };
  }, [lotKey, plan.projectId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const doneRow = (r) => (prod && r.id != null ? Math.min(Number(r.qty) || 0, prod.get(String(r.id)) || 0) : null);
  // ผลิตแล้วต่อเบอร์ (รวมทุกล็อต · ไม่นับแถวที่ Modify ยกเลิก) + ยอดรวมทั้งใบ
  const madeBy = useMemo(() => { if (!prod) return null; const m = new Map(); let d = 0, t = 0;
    for (const L of rel.lots) for (const r of L.rows) { if (r.mod_cancelled_at) continue; const q = Number(r.qty) || 0; const x = Math.min(q, prod.get(String(r.id)) || 0); t += q; d += x; if (r.kind !== "panel") m.set(NC(r.code), (m.get(NC(r.code)) || 0) + x); }
    return { m, d, t }; }, [prod, rel]);
  const madeOf = madeBy ? (code) => madeBy.m.get(NC(code)) || 0 : null;
  const lotProg = (L) => {
    if (!prod) return null;
    const g = { part: [0, 0], sub: [0, 0], panel: [0, 0] };
    for (const r of L.rows) { if (r.mod_cancelled_at) continue; const k = r.kind === "panel" ? "panel" : r.kind === "subassembly" ? "sub" : "part"; g[k][0] += doneRow(r) || 0; g[k][1] += Number(r.qty) || 0; }
    const d = g.part[0] + g.sub[0] + g.panel[0], t = g.part[1] + g.sub[1] + g.panel[1];
    return { g, d, t, pct: t ? Math.round((d / t) * 100) : 0 };
  };
  const lastLot = rel.lots[rel.lots.length - 1];
  const rowSheets = (r) => { const m = /ใบ:\s*(.+?)(?:\s*·|$)/.exec(r.note || ""); if (r.kind === "panel") return ["panel"]; if (m) return m[1].split(/\s*,\s*/).map(sheetKeyOf); return r.kind === "subassembly" ? (need.subs.find((s) => NC(s.code) === NC(r.code))?.procs || []) : [need.parts.find((p) => NC(p.code) === NC(r.code))?.dest || "CUTTING"]; };
  return (
    <div className="rw rl">
      {fixLot && rel.lots.find((L) => L.no === fixLot) ? <LotFixDrawer lot={rel.lots.find((L) => L.no === fixLot)} plan={plan} need={need} api={api} user={user} rowSheets={rowSheets} onPlanChange={onPlanChange}
        onClose={() => setFixLot(null)} onDone={(msg) => { setFixLot(null); onSheetMoved && onSheetMoved({ msg }); }} /> : null}
      {sheetPrev ? <LotSheetPreview args={sheetPrev} onClose={() => setSheetPrev(null)} /> : null}
      <div className="page-head rw-head">
        <div>
          <div className="rw-crumb"><button type="button" className="rw-link" onClick={onBack}>ปล่อยงาน (Release)</button> <span>/</span> {plan.ro}</div>
          <div className="page-title rl-title">Release {plan.ro} <Pill tone="ok">ใช้งาน</Pill>{plan.mods?.length ? <button type="button" className="rl-pillbtn" onClick={() => { setCmpOpen(new Set([plan.mods[plan.mods.length - 1].ver])); setModsOpen(true); }} title="ดูประวัติ Modify / เปรียบเทียบ"><Pill tone="mod">ตอนนี้ {plan.mods[plan.mods.length - 1].ver} ›</Pill></button> : null}</div>
          <div className="page-sub">{plan.projectCode}{plan.note ? ` · ${plan.note}` : ""} · {fmtD(plan.date)} · จัดทำโดย {plan.by} · PDF {plan.pdfs?.length || 0} ไฟล์</div>
        </div>
        <div className="rw-head-right">
          <button type="button" className="btn btn-ghost" onClick={onBack}><Icon name="arrowLeft" size={14} /> กลับ</button>
          <button type="button" className="btn btn-accent" onClick={() => { setPreset(null); setBuilder(true); }}><Icon name="plus" size={15} /> ปล่อยล็อตใหม่</button>
        </div>
      </div>

      {plan.order && (orderMiss.length || orderDiff.length) ? (
        <div className="rw-msg warn" role="status">⚠ ตามใบปะหน้า {plan.order.roRaw || plan.order.ro || plan.order.file}: {[orderMiss.length && `ยังไม่อยู่ในใบ ${orderMiss.length} เบอร์ — ${orderMiss.slice(0, 6).map((x) => `${x.code} ×${nlen(x.qty)}`).join(", ")}${orderMiss.length > 6 ? " …" : ""}`, orderDiff.length && `จำนวนไม่ตรง ${orderDiff.length} — ${orderDiff.slice(0, 4).map((x) => `${x.code} ${nlen(x.qty)}/${nlen(x.have)}`).join(", ")}`].filter(Boolean).join(" · ")}
          {onPlanChange ? <> <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModify("add")}>+ เพิ่มรายการ (วาง PDF แบบที่มาเพิ่ม)</button></> : null}</div>
      ) : plan.order ? <div className="rw-msg ok" role="status">✓ ครบตามใบปะหน้า {plan.order.roRaw || plan.order.ro || plan.order.file} — {plan.order.items.length} รายการ</div> : null}
      {libSync && !libSync.busy ? <div className={`rw-msg ${libSync.err ? "bad" : "ok"}`} role="status">{libSync.err ? "✗ " + libSync.err : "✓ " + libSync.text} <button type="button" className="rw-link" onClick={() => setLibSync(null)}>ปิด</button></div> : null}
      {pulled.length ? <div className="rw-msg ok">✓ ดึง BOM จาก Release อื่นให้อัตโนมัติ {pulled.length} เบอร์: {pulled.slice(0, 6).map((f) => `${f.code} (จาก ${f.from})`).join(", ")}{pulled.length > 6 ? " …" : ""}</div> : null}
      {gaps.panels.length || gaps.subs.length ? <div className="rw-msg warn">⚠ ยังไม่มี BOM: {[gaps.panels.length && `แผง ${gaps.panels.length} แบบ`, gaps.subs.length && `ซับ ${gaps.subs.length} เบอร์`].filter(Boolean).join(" · ")} — ปล่อยได้ก่อน พอ Release อื่นมี BOM ของเบอร์เหล่านี้ ระบบดึงมาให้เอง{plans.length > 1 ? <> <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (!pullNow()) setPulled([]); }}>ดึงตอนนี้</button></> : null}</div> : null}


      <div className={`rl-split ${sideHidden ? "side-off" : ""}`}>
        <div className="rl-main">
      {open && rel.lots.some((L) => L.no === open) ? <div className="card rw-card" ref={lotsRef}>
        <div className="rw-sec-head"><div><h2>ล็อต {open}</h2><p>ใบปล่อย / QR / วัสดุของล็อตนี้</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>✕ ปิด</button></div>
        {rel.lots.length ? (
          <div className="rl-lots">
            {rel.lots.filter((L) => L.no === open).map((L) => { const bySheet = new Map(); L.rows.forEach((r) => rowSheets(r).forEach((k) => (bySheet.get(k) || bySheet.set(k, []).get(k)).push(r)));
              const mm = lotModMap(plan, L.no);
              const lotVers = [...new Set([...[...mm.values()].map((x) => x.ver), ...L.rows.map((r) => r.mod_version).filter(Boolean)])].sort();
              return (
                <div key={L.no} className={`rl-lot ${open === L.no ? "open" : ""}`}>
                  <div className="rl-lot-hw">
                  <button type="button" className="rl-lot-h" onClick={() => (onOpenLot && !L.hwOnly ? onOpenLot(L.no) : setOpen(open === L.no ? null : L.no))} aria-expanded={onOpenLot && !L.hwOnly ? undefined : open === L.no}>
                    <b className="rw-mono">{L.no}</b>
                    <span className="rw-muted">{fmtD(L.date)}</span>
                    {lotVers.length ? <Pill tone="mod">Modify {lotVers.join(", ")}</Pill> : null}
                    <span>{[L.panels && `แผง ${nf(L.panels)}`, L.subs && `ซับ ${nf(L.subs)} เบอร์`, L.parts && `พาร์ท ${nf(L.parts)} เบอร์`, L.hw && L.hw.length && `อุปกรณ์ ${nf(L.hw.length)} รายการ`].filter(Boolean).join(" · ")}{L.hwOnly ? <> <Pill tone="muted">ใบเบิก · ไม่มี QR</Pill></> : null}</span>
                    {(() => { const pg = lotProg(L); if (!pg || !pg.t) return null;
                      const tip = [["พาร์ท", "part"], ["ซับ", "sub"], ["แผง", "panel"]].filter(([, k]) => pg.g[k][1]).map(([n, k]) => `${n} ${nf(pg.g[k][0])}/${nf(pg.g[k][1])}`).join(" · ");
                      return <span className={`rl-lot-prog ${pg.pct >= 100 ? "full" : pg.d ? "" : "zero"}`} title={`ทำแล้ว (ชิ้น) · ${tip}`}><i><b style={{ width: `${pg.pct}%` }} /></i>{pg.pct >= 100 ? "เสร็จครบ" : `ทำแล้ว ${pg.pct}%`}</span>; })()}
                    <span className="rl-lot-chips">{SHEETS.filter((s) => bySheet.has(s.k)).map((s) => <Pill key={s.k} tone={s.kind === "sub" ? "sub" : s.kind === "panel" ? "panel" : "part"}>{s.kind === "sub" ? "SUB " + SUB_SHORT[s.k] : s.kind === "panel" ? "แผง" : s.label} {s.kind === "panel" ? L.panels : bySheet.get(s.k).length}</Pill>)}{L.hw && L.hw.length ? <Pill tone="muted">ACCESSORIES {L.hw.length}</Pill> : null}</span>
                    {onOpenLot && !L.hwOnly ? <span className="rl-caret" aria-hidden="true">›</span> : <span className="rl-caret" aria-hidden="true">▾</span>}
                  </button>
                  {!L.hwOnly && api.moveReleasedSheet && L.rows.some((r) => r.kind !== "panel" && !r.mod_cancelled_at) ? <button type="button" className="btn btn-ghost btn-sm rl-lot-fix" onClick={() => setFixLot(L.no)} title={`ปล่อยผิดใบ: เลือกเบอร์ใน ${L.no} → ย้ายไปใบอื่น หรือยกเลิกการปล่อยเพื่อปล่อยใหม่`}>⇄ ย้ายใบ / ยกเลิก</button> : null}
                  </div>
                  {open === L.no && (!onOpenLot || L.hwOnly) ? (
                    <div className="rl-lot-body">
                      <div className="rl-lot-bar">
                        <div className="rl-lot-bar-txt"><b>ใบปล่อย / QR ของล็อต {L.no}</b><span>ใบปล่อย: ดูหน้ากระดาษก่อน แล้วโหลดเป็น PDF หรือ Excel{onPrintQr ? " · QR: เปิดหน้าพิมพ์ป้ายพร้อมเลือกเบอร์ของล็อตนี้ให้" : ""}</span></div>
                        <div className="rl-lot-search">
                          <Icon name="search" size={14} />
                          <input className="input" value={lotQ} onChange={(e) => setLotQ(e.target.value)} placeholder="ค้นหาเบอร์ / รายละเอียด / ที่อยู่ / INV" aria-label={`ค้นหาในล็อต ${L.no}`} />
                          {lotQ ? <button type="button" className="rl-x-sm" onClick={() => setLotQ("")} aria-label="ล้างคำค้นหา">×</button> : null}
                        </div>
                        <div className="rl-lot-bar-btns">
                          {onPrintQr ? QR_GROUPS.map((g) => { const ids = L.rows.filter((r) => g.kinds.includes(r.kind) && !r.mod_cancelled_at && r.id).map((r) => r.id); return ids.length ? (
                            <button key={g.k} type="button" className={`btn btn-ghost btn-sm rl-qrbtn ${g.k}`} onClick={() => onPrintQr(ids)} title={g.k === "panel" ? `เปิดหน้าพิมพ์ QR ของแผงในล็อต ${L.no} (${nf(L.panels)} แผง · 1 QR ต่อที่อยู่)` : `เปิดหน้าพิมพ์ QR ของ${g.th}ในล็อต ${L.no} (${ids.length} เบอร์)`}><Icon name="qr" size={14} /> QR {g.label} <small>{nf(g.k === "panel" ? L.panels || ids.length : ids.length)}</small></button>) : null; }) : null}
                          <button type="button" className="btn btn-accent btn-sm" onClick={() => setSheetPrev({ plan, need, lot: L, userName: user?.name || "" })}><Icon name="printer" size={14} /> ใบปล่อย · PDF / Excel</button>
                        </div>
                      </div>
                      {(() => { const qq = lotQ.trim().toUpperCase(); if (!qq) return null;
                        const hit = L.rows.filter((r) => rowHit(r, qq, descOf)).length;
                        return <div className={`rl-lot-found ${hit ? "" : "none"}`}>{hit ? <>เจอ <b>{nf(hit)}</b> เบอร์ในใบงาน{L.rows.length > hit ? <span className="rw-muted"> · ซ่อนที่ไม่ตรง {nf(L.rows.length - hit)} เบอร์</span> : null}</> : <>ไม่เจอ “{lotQ.trim()}” ในใบงานของล็อตนี้</>}</div>; })()}
                      <div className="rl-sc-grid">
                      {SHEETS.filter((s) => bySheet.has(s.k)).map((s) => { const all = bySheet.get(s.k); const qq = lotQ.trim().toUpperCase();
                        const rows = qq ? all.filter((r) => rowHit(r, qq, descOf)) : all; if (!rows.length) return null;
                        const others = (r) => rowSheets(r).filter((k) => k !== s.k);
                        const showOthers = s.kind === "sub" && rows.some((r) => others(r).length);
                        const pcs = s.kind === "panel" ? rows.reduce((t, r) => t + (Number(r.qty) || 0), 0) : rows.reduce((t, r) => t + (Number(r.qty) || 0), 0);
                        return (
                        <section key={s.k} className={`rl-sc ${s.kind}`}>
                          <header className="rl-sc-h">
                            <div className="rl-sc-t"><b>{s.label}</b><span>{s.th}</span></div>
                            <div className="rl-sc-n">{qq ? <><b>{nf(rows.length)}</b><small>/{nf(all.length)}</small> {s.kind === "panel" ? "แบบ" : "เบอร์"}</> : s.kind === "panel" ? <><b>{nf(pcs)}</b> แผง<small> · {nf(rows.length)} แบบ</small></> : <><b>{nf(rows.length)}</b> เบอร์<small> · {nf(pcs)} ชิ้น</small></>}</div>
                          </header>
                          <div className="rl-sc-tw"><table className="rl-sc-table">
                            <thead><tr>
                              <th>{s.kind === "panel" ? "แผง (Unit)" : "เบอร์ (Code)"}</th>
                              {s.kind === "panel" ? <th>ที่อยู่</th> : <th>รายละเอียด</th>}
                              {showOthers ? <th>อยู่ในใบอื่นด้วย</th> : null}
                              <th className="r">จำนวน</th>
                              {prod ? <th className="r" title="ชิ้นที่ทำแล้ว / ชิ้นที่ปล่อย">ทำแล้ว</th> : null}
                            </tr></thead>
                            <tbody>{rows.map((r) => { const m = mm.get(NC(r.code)); const cancel = !!(r.mod_cancelled_at || m?.cancel);
                              const addrs = s.kind === "panel" ? addrsFromNote(r.note) : [];
                              return (
                              <tr key={r.code} className={cancel ? "rl-cancelrow" : ""}>
                                <td className="rl-sc-code">{qq && !cancel ? <Hl t={r.code} q={qq} /> : <Code code={r.code} cancel={cancel} />}</td>
                                {s.kind === "panel"
                                  ? <td>{addrs.length ? <div className="rl-sc-addr">{addrs.map((x) => <span key={x} className={/^MOCK-/.test(x) ? "mock" : ""}>{/^MOCK-/.test(x) ? <i>Mockup</i> : null}<Hl t={x} q={qq} /></span>)}</div> : <span className="rw-muted">—</span>}</td>
                                  : <td className="rl-sc-desc" title={descOf(r.code)}>{descOf(r.code) ? <Hl t={descOf(r.code)} q={qq} /> : <span className="rw-muted">—</span>}</td>}
                                {showOthers ? <td>{others(r).map((k) => <Pill key={k} tone="sub">SUB {SUB_SHORT[k] || k}</Pill>)}</td> : null}
                                <td className="r rl-sc-q">{m || cancel ? <ModQty orig={m ? m.orig : r.qty} cur={r.qty} ver={m?.ver || r.mod_version} cancel={cancel} /> : <>{r.mod_version ? <><Pill tone="mod">{r.mod_version}</Pill> </> : null}{nf(r.qty)}</>}</td>
                                {prod ? (() => { const d = doneRow(r); const q = Number(r.qty) || 0; return <td className={`r rl-sc-done ${cancel ? "" : d >= q && q ? "full" : d ? "part" : "zero"}`}>{cancel ? "" : d >= q && q ? <>✓ {nf(d)}</> : <>{nf(d)}<small>/{nf(q)}</small></>}</td>; })() : null}
                              </tr>); })}</tbody>
                          </table></div>
                        </section>); })}
                      </div>
                      <LotMats plan={plan} need={need} lot={L} sheetsOf={rowSheets} q={lotQ.trim().toUpperCase()} onPlanChange={onPlanChange} />
                    </div>) : null}
                </div>); })}
          </div>
        ) : (
          <div className="rw-empty"><Icon name="box" size={26} /><b>ยังไม่ได้ปล่อยล็อต</b><span>กด "ปล่อยล็อตใหม่" แล้วเลือกพาร์ท / ซับ / แผงที่จะปล่อยรอบนี้ และใบงานที่ส่งไป</span><button type="button" className="btn btn-accent btn-sm" onClick={() => setBuilder(true)}><Icon name="plus" size={14} /> ปล่อยล็อตใหม่</button></div>
        )}
      </div> : null}
      <TotalsSection plan={plan} need={need} rel={rel} doneOf={doneOf} leftOf={leftOf} onPlanChange={onPlanChange} onRelease={(pick, done) => { setPreset({ ...pick, done }); setBuilder(true); }} onMoveReleased={api.moveReleasedSheet && onPlanChange ? moveReleased : null} onTab={setTab} madeOf={madeOf} onRowProgress={rowProgress} />
        </div>
      {sideHidden ? (
      <aside className="rl-side rl-side-mini">
        <button type="button" className="rl-side-open" onClick={showSide} title="แสดงแถบสถานะ / ล็อต / Modify">‹<span>สถานะ · ล็อต · Modify</span></button>
        <div className="rl-side-mini-n" title="พาร์ทปล่อยครบ"><b>{nf(partDone)}</b><small>/{nf(liveParts.length)}</small></div>
        <div className="rl-side-mini-n" title="ล็อต"><b>{rel.lots.length}</b><small>ล็อต</small></div>
      </aside>
      ) : (
      <aside className="rl-side">
        <button type="button" className="rl-side-hidebtn" onClick={hideSide} title={tab === "bom" ? "พับแถบนี้ (แท็บ BOM พับให้เองทุกครั้ง)" : "พับแถบนี้ทุกแท็บ — ให้ตารางกว้างเต็มจอ (กด ‹ ที่ขอบขวาเพื่อเปิด)"}>พับแถบนี้ ›</button>
        <div className="rl-sbox">
          <div className="rl-sbox-h"><b>สถานะใบนี้</b></div>
          {[["แผง", addrDone, nUnits, "ที่อยู่ปล่อยแล้ว"], ["ซับ", subDone, liveSubs.length, "เบอร์ปล่อยครบ"], ["พาร์ท", partDone, liveParts.length, "เบอร์ปล่อยครบ"]].filter(([, , b]) => b > 0).map(([l, a, b, s2]) => (
            <div key={l} className="rl-sstat"><div className="rl-sstat-top"><span>{l} <small className="rw-muted">{s2}</small></span><b>{nf(a)} / {nf(b)}</b></div><div className="rl-bar"><i style={{ width: `${pct(a, b)}%` }} /></div></div>))}
          {madeBy && madeBy.t ? <div className="rl-sstat rl-sstat-made"><div className="rl-sstat-top"><span>ผลิตแล้ว <small className="rw-muted">ชิ้น · จากที่ปล่อย</small></span><b>{nf(madeBy.d)} / {nf(madeBy.t)}</b></div><div className="rl-bar"><i style={{ width: `${pct(madeBy.d, madeBy.t)}%` }} /></div><small className="rw-muted">{pct(madeBy.d, madeBy.t)}%</small></div> : null}
          {rel.lots.length ? <button type="button" className="rl-progbtn" onClick={() => setProgOpen(true)}>ดูความคืบหน้าทีละรายการ ›</button> : null}
          {(() => { const left = (nUnits - addrDone) + (liveSubs.length - subDone) + (liveParts.length - partDone); const tot = nUnits + liveSubs.length + liveParts.length;
            return !tot ? <div className="rw-muted small">ยังไม่มีของในใบ</div> : left > 0 ? <div className="rl-snote warn">ยังไม่ปล่อย {[nUnits - addrDone > 0 && `แผง ${nf(nUnits - addrDone)} ที่`, liveSubs.length - subDone > 0 && `ซับ ${nf(liveSubs.length - subDone)} เบอร์`, liveParts.length - partDone > 0 && `พาร์ท ${nf(liveParts.length - partDone)} เบอร์`].filter(Boolean).join(" · ")} <button type="button" className="rw-link" onClick={() => { setPreset(null); setBuilder(true); }}>ปล่อยต่อ →</button></div> : <div className="rl-snote ok">ปล่อยครบแล้ว</div>; })()}
        </div>

        <div className="rl-sbox" ref={lotsRef}>
          <div className="rl-sbox-h"><b>ล็อตที่ปล่อย</b><span className="rw-muted small">{rel.lots.length} ล็อต</span></div>
          {rel.lots.length ? [...rel.lots].reverse().slice(0, lotsAll ? undefined : 5).map((L) => { const pg = lotProg(L); return (
            <div key={L.no} className={`rl-slot ${open === L.no ? "on" : ""}`}>
              <div className="rl-slot-top"><b className="rw-mono">{L.no}</b><span className="rw-muted small">{fmtD(L.date)}</span></div>
              <div className="rw-muted small">{[L.panels && `แผง ${nf(L.panels)}`, L.subs && `ซับ ${nf(L.subs)} เบอร์`, L.parts && `พาร์ท ${nf(L.parts)} เบอร์`, L.hw && L.hw.length && `อุปกรณ์ ${nf(L.hw.length)}`].filter(Boolean).join(" · ")}{pg && pg.t ? ` · ทำแล้ว ${pg.pct}%` : ""}</div>
              <div className="rl-slot-btns">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => (onOpenLot && !L.hwOnly ? onOpenLot(L.no) : setOpen(open === L.no ? null : L.no))}>เปิด</button>
                {!L.hwOnly ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSheetPrev({ plan, need, lot: L, userName: user?.name || "" })}>พิมพ์ใบ</button> : null}
                {onPrintQr && !L.hwOnly ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPrintQr(L.rows.filter((r) => !r.mod_cancelled_at && r.id).map((r) => r.id))}>QR</button> : null}
                {!L.hwOnly && api.moveReleasedSheet && L.rows.some((r) => r.kind !== "panel" && !r.mod_cancelled_at) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFixLot(L.no)} title="ปล่อยผิดใบ: ย้ายไปใบอื่น หรือยกเลิกการปล่อยเพื่อปล่อยใหม่">⇄ ย้ายใบ / ยกเลิก</button> : null}
              </div>
            </div>); }) : <div className="rw-muted small">ยังไม่ได้ปล่อย — กด "ปล่อยล็อตใหม่"</div>}
          {rel.lots.length > 5 ? <button type="button" className="rw-link small" onClick={() => setLotsAll((v) => !v)}>{lotsAll ? "ย่อ" : `ดูทั้งหมด ${rel.lots.length} ล็อต`}</button> : null}
        </div>

        <div className="rl-sbox">
          <div className="rl-sbox-h"><b>Modify</b><button type="button" className="btn btn-ghost btn-sm rl-modbtn" onClick={() => setModify(true)} title="แก้จำนวน / ยกเลิกเบอร์ / ยกเลิกที่อยู่ / เพิ่มเบอร์ / เปลี่ยนวัสดุ — มีเลข M">✎ Modify ใหม่</button></div>
          {plan.mods?.length ? (() => { const m = plan.mods[plan.mods.length - 1]; return (
            <div className="rl-smod click" role="button" tabIndex={0} title="ดูก่อน / หลัง · แก้ได้"
              onClick={() => { setCmpOpen(new Set([m.ver])); setModsOpen(true); }}
              onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setCmpOpen(new Set([m.ver])); setModsOpen(true); } }}>
              <div><button type="button" className="rl-smod-v rl-mlink" onClick={(e) => { e.stopPropagation(); setCmpOpen(new Set([m.ver])); setModsOpen(true); }} title="ดูก่อน / หลัง · แก้ได้">{m.ver} ›</button> <span className="rw-muted small">· {fmtD(m.date)} · {m.by}</span></div>
              {m.reason ? <div className="rw-muted small">{m.reason}</div> : null}
              <ul className="rl-smod-list">{m.items.filter((it) => !it.derived).slice(0, 4).map((it, i) => <li key={i}><span className="rw-mono">{it.code}</span> {it.type === "add" ? `+${nf(it.after)}` : it.type === "cancel" ? "ยกเลิก" : it.type === "addr" ? "ยกเลิกที่อยู่" : it.type === "mat" ? `วัสดุ → ${it.after}` : it.type === "len" ? `ยาว → ${it.after}` : `${nf(it.before)} → ${nf(it.after)}`}</li>)}{m.items.filter((it) => !it.derived).length > 4 ? <li className="rw-muted">… อีก {m.items.filter((it) => !it.derived).length - 4} รายการ</li> : null}</ul>
              {plan.mods.length > 1 ? <button type="button" className="rw-link small" onClick={(e) => { e.stopPropagation(); setCmpOpen(new Set()); setModsOpen(true); }}>ประวัติทั้งหมด {plan.mods.length} ครั้ง</button> : null}
            </div>); })() : <div className="rw-muted small">ยังไม่เคย Modify</div>}
          <button type="button" className="rl-sadd" onClick={() => setModify("add")} title="เพิ่มเบอร์ / Site Item / อุปกรณ์ ที่ยังไม่มีในใบ — ไม่นับเป็น Modify">+ เพิ่มรายการ (ไม่นับ Modify)</button>
        </div>

        <div className="rl-sother">
          อื่นๆ:{" "}
          {api?.loadBomLibrary && onPlanChange ? <button type="button" className="rw-link" onClick={syncFromLib} disabled={!!libSync?.busy} title="ดึงข้อมูลล่าสุดจาก “ซับ / พาร์ท ของโปรเจค” มาเติม — ไม่เปลี่ยนจำนวนที่ปล่อยแล้ว">{libSync?.busy ? "กำลังอ่านคลัง…" : "อัปเดต BOM จากคลัง"}</button> : null}
          {onDelete ? <> · <button type="button" className="rw-link rl-danger" onClick={() => onDelete(rel.lots.length ? rel.lots : [])} title={rel.lots.length ? "ลบเฉพาะใบหลัก — ล็อตที่ปล่อยแล้ว (QR) ไม่ถูกลบ" : "ใบนี้ยังไม่มีล็อต — ลบแล้วใช้เลขนี้ลงใหม่ได้"}>{rel.lots.length ? "ลบใบหลัก" : "ลบใบนี้"}</button></> : null}
        </div>
      </aside>
      )}
      </div>
      {rowMsg ? <div className="rl-rowmsg" role="status">{rowMsg}</div> : null}
      {progOpen ? <ProgressPop plan={plan} need={need} rel={rel} prod={prod} rowSheets={rowSheets} initQ={typeof progOpen === "string" ? progOpen : ""} onClose={() => setProgOpen(false)} onOpenLot={onOpenLot} /> : null}
      {modsOpen && plan.mods?.length ? (<>
        <div className="rl-back" onClick={() => setModsOpen(false)} />
        <aside className="rl-drawer rl-modsdr" role="dialog" aria-modal="true" aria-label="ประวัติ Modify">
        <div className="rl-dr-head"><div className="rl-dr-title"><h2>ประวัติ Modify · {plan.ro}</h2><span className="rw-muted small">แถวที่มีสี = เบอร์ที่ Modify แก้ · ค่าเดิมขีดฆ่า → ค่าใหม่</span></div><button type="button" className="rl-x" onClick={() => setModsOpen(false)} aria-label="ปิด">×</button></div>
        <div className="rl-modsdr-body">
          <div className="rw-sec-head"><div><p>จำนวนเดิมขีดฆ่า → จำนวนใหม่ · เบอร์/ที่อยู่ที่ยกเลิกเป็น<b className="rl-cx">สีแดง</b> · ของที่ปล่อยแล้วแก้ในล็อตด้วย (QR ที่ยกเลิกเก็บเป็นหลักฐาน)</p></div></div>
          <div className="rl-mods">
            {[...plan.mods].reverse().map((m) => (
              <div key={m.ver} className="rl-mod">
                <div className="rl-mod-h"><button type="button" className={`rl-mlink big ${cmpOpen.has(m.ver) ? "on" : ""}`} onClick={() => setCmpOpen((o) => { const n = new Set(o); if (n.has(m.ver)) n.delete(m.ver); else n.add(m.ver); return n; })} aria-expanded={cmpOpen.has(m.ver)} title="กดเพื่อดู / ซ่อน ตารางก่อน → หลัง">{m.ver} {cmpOpen.has(m.ver) ? "▾" : "▸"}</button> <b>{fmtD(m.date)}</b> <span className="rw-muted">· {m.by} · {(m.bomEdits || []).length ? `แก้ BOM ${m.bomEdits.length} จุด · ` : ""}{m.items.length} รายการ{m.edited?.length ? ` · แก้ไขแล้ว ${m.edited.length} ครั้ง (ล่าสุด ${m.edited[m.edited.length - 1].by})` : ""}</span>{onPlanChange && modEdit !== m.ver ? <button type="button" className="btn btn-ghost btn-sm rl-mod-editbtn" onClick={() => setModEdit(m.ver)}>✎ แก้ {m.ver}</button> : null}</div>
                {m.reason && modEdit !== m.ver ? <div className="rl-mod-reason">เหตุผล: {m.reason}</div> : null}
                {modEdit === m.ver ? <ModEditor m={m} need={need} doneOf={doneOf} onCancel={() => setModEdit(null)} onSave={async (nm) => {
                  const nmods = plan.mods.map((x) => (x.ver === m.ver ? nm : x));
                  const ok = await askConfirm({ title: `บันทึกการแก้ ${m.ver}?`, message: `ยอดต้องใช้ / ของที่เพิ่ม / วัสดุ / ความยาว ในใบจะคำนวณใหม่ตาม ${m.ver} ที่แก้\nล็อตที่ปล่อยแล้วไม่เปลี่ยน · ประวัติการแก้เก็บไว้ใน ${m.ver}`, tone: "warn", confirmText: "บันทึกการแก้", cancelText: "กลับ" });
                  if (!ok) return;
                  onPlanChange(replayMods(plan, nmods)); setModEdit(null); setCmpOpen((o) => new Set([...o, m.ver]));
                }} /> : null}
                {cmpOpen.has(m.ver) && modEdit !== m.ver ? <ModCompare m={m} need={need} /> : null}
                <ul className="rl-mod-items" hidden={cmpOpen.has(m.ver) || modEdit === m.ver}>
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
                        : it.type === "len" ? <>ความยาว <span className="rw-mono"><s className="rl-old">{String(it.before ?? "—")}</s> → <b className="rl-new">{String(it.after)}</b></span>{it.file ? <span className="rw-muted"> · แบบ {it.file}</span> : null}</>
                        : it.type === "mat" ? <>เปลี่ยนวัสดุ <span className="rw-mono"><s className="rl-old">{it.before || "—"}</s> → <b className="rl-new">{it.after}</b></span>{it.file ? <span className="rw-muted"> · แบบ {it.file}</span> : null}</>
                        : <>เพิ่มใหม่ {it.kind === "hw" ? nlen(it.after) : nf(it.after)} {it.kind === "sub" ? "SET" : it.kind === "hw" ? (it.u || "pcs.") + " · อุปกรณ์ ไม่มี QR" : "ชิ้น"}{it.src ? <span className="rw-muted"> · จากแบบ {it.src}</span> : null}</>}
                      {(it.lots || []).map((l) => <span key={l.lot} className="rl-mod-lot"> · {l.lot}: {l.cancel ? <><span className="rl-cxq">{nf(l.before)}</span> ยกเลิก</> : <><s className="rl-old">{nf(l.before)}</s> → <b>{nf(l.after)}</b></>}</span>)}
                    </li>))}
                </ul>
              </div>))}
          </div>
        </div>
        </aside>
      </>) : null}



      {modify ? (
        <ModifyDrawer plan={plan} need={need} rel={rel} api={api} user={user} onClose={() => { setModify(false); setInboxFiles(null); }} addOnly={modify === "add"} initialFiles={inboxFiles}
          onSaved={async (np, mod) => { setModify(false); if (onModified) await onModified(np, mod); }}
          onAdded={(np, n) => { setModify(false); if (onPlanChange) onPlanChange(np); }} />
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
  const [sel, setSel] = useUndoState(() => ({ addrs: new Set(), subs: new Map(), parts: new Map(), hw: new Map() }), { label: "เลือกของที่จะปล่อย" });
  // ★ 2026-11-09 อุปกรณ์ (สกรู/ยาง · ไม่มี QR) เบิกเป็นล็อตได้ — เช่น Site Item + อุปกรณ์จากแบบ mock-up ที่เพิ่มหลังปล่อยแผงไปแล้ว
  //   ยอดที่เบิกแล้ว = ติดแผง/ซับที่ปล่อยไปแล้ว (ใบเบิกของล็อตนั้น) + ที่เลือกเบิกเองในล็อตก่อน ๆ
  const hwDone = useMemo(() => hwIssuedOf(plan, need, rel), [plan, need, rel]);
  const hwDoneOf = (code) => (hwDone.get(NC(code)) || { qty: 0 }).qty;
  const hwLeft = (h) => Math.max(0, Math.round((h.qty - hwDoneOf(h.code)) * 1000) / 1000);
  const hwQ = (h, q = h.qty) => (h.u === "m." && h.mm ? q / 1000 : q);     // แสดง: เก็บเป็นมม. → โชว์เป็นเมตร
  const hwRaw = (h, q) => (h.u === "m." && h.mm ? q * 1000 : q);
  const hwList = need.hw.filter((h) => !h.cancelled);
  const selHw = sel.hw || new Map();
  const setHw = (h, v) => setSel((s0) => { const s = { ...s0, addrs: new Set(s0.addrs), subs: new Map(s0.subs), parts: new Map(s0.parts), hw: new Map(s0.hw || []) }; const nx = Math.max(0, Math.min(hwLeft(h), hwRaw(h, Number(v) || 0))); if (nx > 0) s.hw.set(h.code, nx); else s.hw.delete(h.code); return s; });
  useEffect(() => pushUndoGate(), []);   // ★ Ctrl+Z ในหน้าต่างนี้ไม่ย้อนหน้าหลัง
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
    if (k === "__hw") return { left: hwList.filter((h) => hwLeft(h) > 0).length, sel: hwList.filter((h) => selHw.get(h.code) > 0).length };
    const items = isPartSheet(k) ? partsOf(k) : subsOf(k);
    const m = isPartSheet(k) ? sel.parts : sel.subs;
    return { left: items.filter((x) => leftOf(x.code, x.qty) > 0).length, sel: items.filter((x) => m.get(x.code) > 0).length };
  };
  // ★ 2026-11-09 ปล่อยเข้า "ล็อตเดิม" ได้ (เช่น Site Item/อุปกรณ์ที่เพิ่มทีหลัง ให้อยู่ในใบปล่อย P-241 เดียวกัน) — ใส่เลขล็อตที่ปล่อยแล้ว หรือเลือกจากรายการ
  const intoLot = rel.lots.find((L) => roKey(L.no) === roKey(lotNo)) || null;
  const ql = q.trim().toUpperCase();
  const match = (...xs) => !ql || xs.some((x) => String(x || "").toUpperCase().includes(ql));
  const rows = tab === "__hw" ? hwList.filter((h) => match(h.code, h.d))
    : sheet.kind === "panel" ? plan.units.filter((u) => match(u.addr, u.unit))
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
    if (tab === "__hw") { for (const h of rows) setHw(h, on ? hwQ(h, hwLeft(h)) : 0); return; }
    if (sheet.kind === "panel") return toggleAddr(rows.map((u) => String(u.addr).toUpperCase()), on);
    for (const r of rows) setQty(sheet.kind === "sub" ? "sub" : "part", r.code, r.qty, on ? leftOf(r.code, r.qty) : 0, true);
  };
  const selectEverything = () => setSel({
    addrs: new Set(leftAddr.map((u) => String(u.addr).toUpperCase())),
    subs: new Map(need.subs.filter((s) => leftOf(s.code, s.qty) > 0).map((s) => [s.code, leftOf(s.code, s.qty)])),
    parts: new Map(need.parts.filter((p) => leftOf(p.code, p.qty) > 0).map((p) => [p.code, leftOf(p.code, p.qty)])),
    hw: new Map(selHw),   // อุปกรณ์เลือกเองที่แท็บ ACCESSORIES (ติดแผงจะไปกับใบเบิกของแผงอยู่แล้ว)
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
  const nPanel = sel.addrs.size, nSub = sel.subs.size, nPart = sel.parts.size, nHw = selHw.size;
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
    if (intoLot) w.push(["warn", `เพิ่มเข้าล็อตเดิม ${intoLot.no} (${fmtD(intoLot.date)} · ${[intoLot.panels && `แผง ${nf(intoLot.panels)}`, intoLot.subs && `ซับ ${nf(intoLot.subs)} เบอร์`, intoLot.parts && `พาร์ท ${nf(intoLot.parts)} เบอร์`, intoLot.hw?.length && `อุปกรณ์ ${nf(intoLot.hw.length)}`].filter(Boolean).join(" · ") || "ว่าง"}) — ของใหม่จะอยู่ในใบปล่อย/ใบเบิกเดียวกัน QR ใหม่ต่อท้าย · ถ้าต้องการแยกล็อต ใช้ ${nextLotNo(plan.ro, rel.lots)}`]);
    if (!/^P-\d+(\.\d+)?$/i.test(lotNo.trim())) w.push(["block", `เลขล็อตต้องเป็น ${plan.ro}.ตัวเลข หรือ ${plan.ro}`]);
    else if (roKey(lotNo).split(".")[0] !== roKey(plan.ro).split(".")[0]) w.push(["block", `เลขล็อตต้องขึ้นต้นด้วย ${plan.ro}`]);
    return w;
  }, [need, sel, nPanel, plan, doneOf, rel.lots, lotNo, intoLot]);
  const blocked = warns.some((w) => w[0] === "block") || (!lr.length && !nHw);

  async function save() {
    if (blocked || busy) return;
    const soft = warns.filter((w) => w[0] === "warn");
    if (soft.length && !(await askConfirm({ title: "ปล่อยล็อตทั้งที่มีเรื่องควรดู?", message: soft.map((w) => "• " + w[1]).join("\n"), tone: "warn", confirmText: `ปล่อย ${lotNo}`, cancelText: "กลับไปแก้" }))) return;
    setBusy("เริ่มบันทึก…"); setErr([]);
    const no = lotNo.trim().toUpperCase();
    try {
      let res = null;
      if (lr.length) res = await api.releaseLot({ plan, lotNo: no, date: dateToIso(date), userId: user?.id || null, rows: lr, append: !!intoLot }, (m) => setBusy(m));
      // ★ 2026-11-09 อุปกรณ์ที่เลือกเบิก (ไม่มี QR) → เก็บกับแผน plan.lotHw[ล็อต] (ใบเบิก ACCESSORIES ของล็อตนี้ · หักยอดคงเหลือ)
      let np = plan;
      if (nHw) {
        let items = hwList.filter((h) => selHw.get(h.code) > 0).map((h) => ({ code: h.code, qty: selHw.get(h.code), u: h.u || "pcs.", d: h.d || "" }));
        const hwKey = Object.keys(plan.lotHw || {}).find((k) => roKey(k) === roKey(no)) || (intoLot ? intoLot.no : no);
        const prev = (plan.lotHw || {})[hwKey];
        if (prev && prev.items) { const merged = [...prev.items.map((x) => ({ ...x }))]; for (const it of items) { const ex = merged.find((x) => NC(x.code) === NC(it.code)); if (ex) ex.qty = Math.round((Number(ex.qty) + Number(it.qty)) * 1000) / 1000; else merged.push(it); } items = merged; }
        np = { ...plan, lotHw: { ...(plan.lotHw || {}), [hwKey]: { ...(prev || {}), date: prev?.date || dateToIso(date), by: prev?.by || user?.name || "", note: [prev?.note, note.trim()].filter(Boolean).join(" · "), items } } };
        setBusy(`บันทึกรายการอุปกรณ์ของ ${no}…`);
        try { await api.updatePlan(np); }
        catch (e) { setBusy(""); setErr([`${lr.length ? `ปล่อย ${no} แล้ว แต่` : ""}บันทึกรายการอุปกรณ์ไม่สำเร็จ: ${e?.message || e}${lr.length ? " — รายการอุปกรณ์ยังไม่ถูกหัก ลองเบิกอุปกรณ์ใหม่อีกครั้ง (เลขล็อตใหม่)" : ""}`]); if (!lr.length) return; }
        if (onPlanChange) onPlanChange(np);
      }
      setBusy("");
      await onSaved({ lotNo: no, rows: lr, res, hw: nHw, plan: np });
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
            {rel.lots.length ? <select className="select rw-mono" style={{ width: "auto" }} value={intoLot ? intoLot.no : ""} onChange={(e) => setLotNo(e.target.value || nextLotNo(plan.ro, rel.lots))} aria-label="เพิ่มเข้าล็อตเดิม" title="เพิ่มของใหม่เข้าล็อตที่ปล่อยแล้ว (ใบปล่อยเดียวกัน · QR ใหม่ต่อท้าย)">
              <option value="">ล็อตใหม่ {nextLotNo(plan.ro, rel.lots)}</option>
              {rel.lots.map((L) => <option key={L.no} value={L.no}>เพิ่มเข้าล็อตเดิม {L.no}</option>)}
            </select> : null}
            <input className="input rl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="วันที่ล็อต" />
            <input className="input rl-note" value={note} placeholder="หมายเหตุ เช่น ปล่อยพาร์ทก่อน / ชั้น 25 ฝั่ง E" onChange={(e) => setNote(e.target.value)} aria-label="หมายเหตุล็อต" />
          </div>
          <button type="button" className="rl-x" onClick={onClose} aria-label="ปิด" disabled={!!busy}>×</button>
        </div>
        <p className="rl-dr-sub">เลือกสิ่งที่จะปล่อยรอบนี้ แยกตามใบงานที่ส่งไปทำ · ซับ 1 เบอร์ไปได้หลายใบ (ติ๊กงานในแถว) · พาร์ทเลือกได้ว่าไป MACHINING PART / BENDING / STEEL · ระบบหักของที่ปล่อยแล้ว ไม่ให้เกิน</p>
        <div className="rl-tabs grouped" role="tablist">
          {/* แท็บจัดกลุ่มตามหัว Total ใน Excel: Total Part (MACHINING PART · BENDING · STEEL) · Total Sub-Assembly (SUB A'ssy …) · แผง */}
          {[[TOTALS[0].label, "part"], [TOTALS[1].label, "sub"], ["แผง", "panel"], ["อุปกรณ์ · ไม่มี QR", "hw"]].filter(([, kind]) => (kind !== "panel" || plan.units.length > 0) && (kind !== "hw" || hwList.length > 0)).map(([lab, kind]) => (
            <div key={kind} className={`rl-tabgrp ${kind}`}>
              <span className="rl-tabgrp-lab">{lab}</span>
              <div className="rl-tabgrp-row">
                {SHEETS.filter((s) => s.kind === kind).map((s) => { const st = tabStat(s.k); return (
                  <button key={s.k} type="button" role="tab" aria-selected={tab === s.k} className={`rl-tab ${tab === s.k ? "on" : ""} ${s.kind}`} onClick={() => setTab(s.k)} title={s.label}>
                    <b>{s.tab}</b><small>เหลือ {nf(st.left)}{st.sel ? <em>เลือก {nf(st.sel)}</em> : null}</small>
                  </button>); })}
                {kind === "sub" && noProc.length ? <button type="button" role="tab" aria-selected={tab === "__none"} className={`rl-tab warn ${tab === "__none" ? "on" : ""}`} onClick={() => setTab("__none")}><b>ซับยังไม่เลือกงาน</b><small>{noProc.length} เบอร์</small></button> : null}
                {kind === "hw" ? (() => { const st = tabStat("__hw"); return <button type="button" role="tab" aria-selected={tab === "__hw"} className={`rl-tab ${tab === "__hw" ? "on" : ""}`} onClick={() => setTab("__hw")} title="FASTENER, GASKET & SILICONE — เบิกเป็นล็อต ไม่สร้าง QR · ออกในใบเบิก ACCESSORIES ของล็อตนี้"><b>ACCESSORIES</b><small>เหลือ {nf(st.left)}{st.sel ? <em>เลือก {nf(st.sel)}</em> : null}</small></button>; })() : null}
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
        <div className="rl-sheetnote"><b>{tab === "__none" ? "ซับยังไม่เลือกงาน" : tab === "__hw" ? "ACCESSORIES (อุปกรณ์ · ไม่มี QR)" : sheet.label}</b> <span className="rw-muted">— {tab === "__none" ? "ติ๊กงานอย่างน้อย 1 อย่าง ซับถึงจะอยู่ในใบงาน" : tab === "__hw" ? "สกรู / ยาง / ซิลิโคน เบิกเป็นล็อต (ไม่สร้าง QR) · ที่ติดแผง/ซับที่ปล่อยไปแล้วหักให้แล้ว · ออกในใบเบิก ACCESSORIES ของล็อตนี้" : sheet.th}</span></div>
        <div className="table-wrap rw-tw rl-tw">
          <table className="data-table rw-table">
            {tab === "__hw" ? (
              <>
                <thead><tr><th style={{ width: 36 }} /><th className="r">NO.</th><th>CODE</th><th>DESCRIPTION</th><th className="r">TOTAL QTY</th><th>UOM</th><th>เบิกแล้ว</th><th className="r">เหลือ</th><th className="r">เบิกรอบนี้</th></tr></thead>
                <tbody>{rows.slice(0, 600).map((h, ri) => { const left = hwLeft(h); const cur = selHw.get(h.code) || 0; const on = cur > 0; const dn = hwDone.get(NC(h.code)); const step = h.u === "m." || h.u === "mm." ? "0.01" : "1"; return (
                  <tr key={h.code} className={`${on ? "rl-sel" : ""} ${left <= 0 ? "rl-done" : ""}`}>
                    <td><input type="checkbox" checked={on} disabled={left <= 0} onChange={(e) => setHw(h, e.target.checked ? hwQ(h, left) : 0)} aria-label={`เลือก ${h.code}`} /></td>
                    <td className="r rw-muted">{ri + 1}</td>
                    <td className="rw-mono"><Code code={h.code} added={h.added} /></td>
                    <td className="rl-desc"><span>{h.d}</span></td>
                    <td className="r"><b>{nlen(Math.round(hwQ(h) * 100) / 100)}</b></td>
                    <td className="rw-muted small">{h.u || (h.mm ? "mm." : "pcs.")}</td>
                    <td className="rl-donecell">{dn && dn.qty ? <><b>{nlen(Math.round(hwQ(h, dn.qty) * 100) / 100)}</b> {dn.lots.map((l) => <Pill key={l} tone="info">{l}</Pill>)}</> : ""}</td>
                    <td className="r"><b>{left > 0 ? nlen(Math.round(hwQ(h, left) * 100) / 100) : "✓"}</b></td>
                    <td className="r">{left > 0 ? <input className="input rw-cell rl-qty" type="number" min="0" max={hwQ(h, left)} step={step} value={on ? hwQ(h, cur) : ""} placeholder={nlen(Math.round(hwQ(h, left) * 100) / 100)} onChange={(e) => setHw(h, e.target.value)} aria-label={`จำนวนเบิก ${h.code}`} /> : null}</td>
                  </tr>); })}</tbody>
              </>
            ) : sheet.kind === "panel" && tab !== "__none" ? (
              <>
                <thead><tr><th style={{ width: 36 }} /><th>Address</th><th>Unit</th><th>BOM</th><th>สถานะ</th></tr></thead>
                <tbody>{rows.slice(0, 600).map((u) => { const a = String(u.addr).toUpperCase(); const done = rel.addrLot.get(a); const cx = need.cancelledAddr[a]; const on = sel.addrs.has(a); return (
                  <tr key={a} className={`${on ? "rl-sel" : ""} ${done || cx ? "rl-done" : ""} ${cx ? "rl-cancelrow" : ""}`}>
                    <td><input type="checkbox" checked={on} disabled={!!done || !!cx} onChange={(e) => toggleAddr([a], e.target.checked)} aria-label={`เลือก ${a}`} /></td>
                    <td className="rw-mono"><b className={cx ? "rl-cx" : ""}>{a}</b>{cx ? <> <Pill tone="bad">ยกเลิก {cx}</Pill></> : null}</td><td className="rw-mono">{u.unit}</td>
                    <td>{findKey(plan.bom.panels, u.unit) ? <Pill tone="ok">✓</Pill> : <Pill tone="warn">ไม่มี BOM</Pill>}</td>
                    <td>{done ? <Pill tone="info" title="ปล่อยแล้ว">{done}</Pill> : cx ? <span className="rl-cxq small">ยกเลิกแล้ว</span> : <span className="rw-muted small">ยังไม่ปล่อย</span>}</td>
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
                      <td className="rw-mono"><Code code={r.code} cancel={!!r.cancelled} added={r.added} />{isStar(r.code) ? <> <Pill tone="warn">*</Pill></> : r.cat === "SITE ITEM" ? <> <Pill tone="warn">SITE ITEM</Pill></> : r.siteQty ? <> <Pill tone="warn" title={`${nf(r.siteQty)} ชิ้นในจำนวนนี้เป็น Site Item ส่งไซต์ (เพิ่มจากแบบ)`}>SITE ITEM +{nf(r.siteQty)}</Pill></> : null}</td>
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
            <b>ล็อต {lotNo}:</b> แผง {nf(nPanel)} · ซับ {nf(nSub)} เบอร์ ({nf(subSets)} SET) · พาร์ท {nf(nPart)} เบอร์ ({nf(partPcs)} ชิ้น){nHw ? <> · อุปกรณ์ {nf(nHw)} รายการ <small className="rw-muted">(ไม่มี QR)</small></> : null}
            {bySheetSel.length || nHw ? <div className="rl-sum-chips">{bySheetSel.map(([s, n]) => <Pill key={s.k} tone={s.kind === "sub" ? "sub" : s.kind === "panel" ? "panel" : "part"}>{s.label} {n}</Pill>)}{nHw ? <Pill tone="muted">ACCESSORIES {nHw}</Pill> : null}</div> : <div className="rw-muted small">ยังไม่ได้เลือกอะไร</div>}
          </div>
          <div className="rl-foot-btns">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>ยกเลิก</button>
            <button type="button" className="btn btn-accent" onClick={save} disabled={blocked || !!busy}>{busy || (lr.length ? `${intoLot ? "เพิ่มเข้า" : "ปล่อย"} ${lotNo} + สร้าง QR${nHw ? " + ใบเบิก" : ""}` : nHw ? `เบิกอุปกรณ์ ${intoLot ? "เพิ่มเข้า " : ""}${lotNo} (ไม่มี QR)` : "เลือกรายการที่จะปล่อยก่อน")}</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ══ Modify Release (แผงด้านขวา) ══
//   แก้ยอดต้องใช้ / ยกเลิกเบอร์ / ยกเลิกที่อยู่ (แผงที่ยังไม่ปล่อย) / เพิ่มเบอร์ใหม่ — 1 ครั้ง = 1 เลข M (M-001 …)
//   ของที่ปล่อยไปแล้วเกินยอดใหม่ → ลด/ยกเลิกในล็อตให้เอง (ล็อตล่าสุดก่อน) ผ่าน Modify เดิมของระบบ · จำนวนเดิมขีดฆ่าไว้ · เบอร์ที่ยกเลิกเป็นสีแดง
function ModifyDrawer({ plan, need, rel, api, user, onClose, onSaved, addOnly = false, onAdded = null, initialFiles = null }) {
  // ★ 2026-11-09 addOnly = "เพิ่มรายการ" — เพิ่มเบอร์/Site Item/อุปกรณ์ที่ยังไม่มีในใบ โดยไม่นับเป็น Modify (ไม่มีเลข M · ไม่ลงประวัติ Modify)
  const [tab, setTab] = useState(addOnly ? "add" : "part");
  const [q, setQ] = useState("");
  const [onlyChg, setOnlyChg] = useState(false);
  const [chg, setChg] = useUndoState({}, { label: "Modify: จำนวน / ยกเลิก" });
  useEffect(() => pushUndoGate(), []);                 // "part|CODE" → { type: "qty"|"cancel", qty }
  const [addrs, setAddrs] = useUndoState(() => new Set(), { label: "Modify: ยกเลิกที่อยู่" });  // ที่อยู่ที่จะยกเลิก
  const [adds, setAdds] = useUndoState([], { label: "Modify: เพิ่มเบอร์", coalesceMs: 800 });
  // ★ 2026-11-10 เปลี่ยนวัสดุผ่าน Modify: วางแบบพาร์ท Rev ใหม่ที่ INV.CODE ต่างจากเดิม → เสนอเป็นรายการ "เปลี่ยนวัสดุ" (ติ๊กออกได้) · บันทึกเป็น matOv ของแผน
  const [matChg, setMatChg] = useState([]);   // ★ เปลี่ยนจากแบบ: [{ id, code, kind:"part"|"sub", field:"mat"|"len", from, to, file, on }]
  const [found, setFound] = useState([]);     // ★ 2026-11-10 สรุปทุกอย่างที่เทียบเจอจากแบบที่วาง (โชว์รวมที่เดียว) [{ code, what, from, to, where, tone }]
  const [bscope, setBscope] = useState("sub");          // แก้ BOM ลูกของ: ซับ / แผง
  const [bowner, setBowner] = useState("");
  const [bchg, setBchg] = useUndoState({}, { label: "Modify: BOM ลูก", coalesceMs: 800 });                 // "scope|owner|idx" → { type:"qty"|"cancel"|"replace", qty, newCode }
  const [badds, setBadds] = useUndoState([], { label: "Modify: เพิ่มลูกใน BOM", coalesceMs: 800 });               // ลูกที่เพิ่มเข้า BOM ซับ/แผง
  const [bform, setBform] = useState({ kind: "part", code: "", qty: "", d: "" });
  const blankForm = { kind: "part", code: "", d: "", qty: "", l: "", inv: "", dest: "CUTTING", procs: "ยิง", u: "pcs." };
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
  const matOn = matChg.filter((x) => x.on);
  const nChange = realChanges.length + addrs.size + adds.length + edits.length + matOn.length;
  const formErr = !form.code.trim() ? "" : (form.kind !== "hw" && need.parts.concat(need.subs).some((x) => NC(x.code) === NC(form.code))) || adds.some((a) => NC(a.code) === NC(form.code)) ? "เบอร์นี้มีอยู่แล้ว — ใช้ “แก้จำนวน” แทน" : !(Number(form.qty) > 0) ? "ใส่จำนวน" : "";
  const blockers = addOnly ? [
    !adds.length && "ยังไม่ได้เพิ่มอะไร",
    adds.some((a) => !(Number(a.qty) > 0)) && `ใส่จำนวนเบอร์ใหม่ ${adds.filter((a) => !(Number(a.qty) > 0)).length} เบอร์`,
  ].filter(Boolean) : [
    !nChange && "ยังไม่ได้แก้อะไร",
    !reason.trim() && "ใส่เหตุผล (เช่น ลูกค้าแจ้งลดจำนวน / แบบ Rev B)",
    adds.some((a) => !(Number(a.qty) > 0)) && `ใส่จำนวนเบอร์ใหม่ ${adds.filter((a) => !(Number(a.qty) > 0)).length} เบอร์`,
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
  const tabCount = (k) => (k === "addr" ? addrs.size : k === "add" ? adds.length : k === "bom" ? edits.filter((e) => e.scope === "panel").length : realChanges.filter((c) => c.kind === k).length + (k === "sub" ? edits.filter((e) => e.scope === "sub").length : 0) + (k === "part" ? matOn.length : 0));

  async function save() {
    if (blockers.length || busy) return;
    if (addOnly) {
      const at = new Date().toISOString(); const by = user?.name || "";
      const extra = adds.map((a) => ({ kind: a.kind, code: a.code.trim().toUpperCase(), qty: Number(a.qty), d: a.d || "", l: a.l === "" || a.l == null ? null : Number(a.l), inv: a.inv || "", dest: a.kind === "hw" ? undefined : a.dest, at, by, ...(a.cat ? { cat: a.cat } : {}), ...(a.kind === "hw" ? { u: a.u || "pcs." } : {}), ...(a.src ? { src: a.src } : {}) }));
      const np = { ...plan, extra: [...(plan.extra || []), ...extra] };
      for (const a of adds) if (a.kind === "sub" && a.procs) np.procOv = { ...(np.procOv || {}), [a.code.trim().toUpperCase()]: a.procs };
      const nQr = extra.filter((x) => x.kind !== "hw").length, nHw = extra.length - nQr;
      const ok = await askConfirm({ title: `เพิ่ม ${extra.length} รายการใน Release ${plan.ro}?`, message: [nQr && `• พาร์ท/ซับ ${nQr} เบอร์ (มี QR · ปล่อยในล็อตถัดไป)`, nHw && `• อุปกรณ์ ${nHw} รายการ (ไม่มี QR · เบิกที่แท็บ ACCESSORIES ตอนปล่อยล็อต)`, "\nไม่นับเป็น Modify — ไม่มีเลข M · ของเดิมไม่เปลี่ยน"].filter(Boolean).join("\n"), confirmText: "เพิ่มรายการ", cancelText: "กลับไปแก้" });
      if (!ok) return;
      setBusy("บันทึก…"); setErr("");
      try { await api.updatePlan(np); setBusy(""); onAdded && onAdded(np, extra.length); }
      catch (e) { setBusy(""); setErr(e?.message || String(e)); }
      return;
    }
    const mod = {
      no, ver, date, by: user?.name || "", at: new Date().toISOString(), reason: reason.trim(),
      ...(sheet && sheet.kind === "modify" ? { sheet: { file: sheet.file, roRaw: sheet.roRaw, mVer: sheet.mVer, refRo: sheet.refRo, zone: sheet.zone, issuedBy: sheet.issuedBy, date: sheet.date, items: sheet.items } } : {}),
      bomEdits: edits,
      items: [
        ...ops.items.filter((it) => !(it.type === "qty" && it.before === it.after)).map((it) => (derivedSet.has(NC(it.code)) ? { ...it, derived: true } : it)),
        ...bomFx.adds.filter((a) => !manualCodes.has(NC(a.code))).map((a) => ({ kind: a.kind, type: "add", code: a.code, d: a.d, l: a.l, inv: a.inv, dest: a.kind === "part" ? ruleDest(ruleCat(a.code, "part"), a.code) : undefined, before: 0, after: a.qty, derived: true })),
        ...[...addrs].map((a) => ({ kind: "panel", type: "addr", code: a, unit: plan.units.find((u) => addrKey(u.addr) === a)?.unit || "", before: 1, after: 0 })),
        ...matOn.map((x) => ({ kind: x.kind || "part", type: x.field === "len" ? "len" : "mat", code: x.code, before: x.from, after: x.to, file: x.file })),
        ...adds.map((a) => ({ kind: a.kind, type: "add", code: a.code.trim().toUpperCase(), d: a.d, l: a.l === "" ? null : Number(a.l), inv: a.inv, dest: a.kind === "hw" ? undefined : a.dest, procs: a.procs, before: 0, after: Number(a.qty), ...(a.cat ? { cat: a.cat } : {}), ...(a.kind === "hw" ? { u: a.u || "pcs." } : {}), ...(a.src ? { src: a.src } : {}) })),
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
        matOn.length && `• เปลี่ยนตามแบบ ${matOn.length} จุด: ${matOn.map((x) => `${x.code} ${x.field === "len" ? "ยาว" : "วัสดุ"} ${x.from ?? "—"} → ${x.to}`).join(" · ")} (ใบปล่อย / ใบเบิกวัสดุใช้ค่าใหม่ · ล็อตที่ตัดไปแล้วไม่เปลี่ยน)`,
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

  // ★ 2026-11-04 วาง PDF ใน Modify: แบบซับ/แผงที่มีในใบ → เทียบ BOM ให้เอง (จำนวนเพิ่ม-ลด · ยกเลิก · ลูกใหม่) · แบบพาร์ท/ซับใหม่ → เพิ่มเบอร์ใหม่ (ลงข้อมูลให้ ใส่แค่จำนวน · แก้ได้)
  const [pdfMsg, setPdfMsg] = useState(null);
  const [pdfDrag, setPdfDrag] = useState(false);
  const pdfRef = useRef(null);
  // ★ 2026-11-10 ใบปะหน้าของรอบนี้: ใบ Modify (FM(DE)-00 "Release for Modification" · M-060 อ้างถึง P-089 · รายการแบบที่แก้ UA2007 REV.A …)
  //   หรือใบปะหน้า Release (FM(DE)-03) ตอน "เพิ่มรายการ" — วางได้ในช่องเดียวกับแบบ (xls/xlsx/pdf) → เติมเลข M / วันที่ / เหตุผล + เช็กลิสต์ว่าแบบที่แก้มาครบไหม
  const [sheet, setSheet] = useState(null);
  const [dropped, setDropped] = useState({});   // NC(code) → ข้อความสรุปจากแบบที่วาง (เช่น "จำนวนเปลี่ยน 2 · ลูกใหม่ 1")
  const sheetCmp = useMemo(() => {
    if (!sheet) return [];
    if (sheet.kind === "modify") return sheet.items.map((it) => { const k = NC(it.code); const inPlan = findKey(plan.bom.panels, it.code) ? "panel" : findKey(plan.bom.subs, it.code) ? "sub" : need.parts.some((x) => NC(x.code) === k) ? "part" : ""; return { ...it, inPlan, drop: dropped[k] || "" }; });
    return compareOrder(sheet, need).map((x) => ({ ...x, drop: dropped[NC(x.code)] || "" }));
  }, [sheet, dropped, plan.bom, need]);
  async function onModPdfs(list) {
    const files = [...list].filter((f) => /\.(pdf|xlsx?|xlsm)$/i.test(f.name)); if (!files.length) return;
    setPdfMsg({ info: `กำลังอ่าน ${files.length} ไฟล์…` });
    const notes = []; let jump = null; const newAdds = []; const bAdds = []; const bChg = {}; const drops = {}; const foundL = [];
    // ใบปะหน้า Excel → อ่านเป็นใบปะหน้าเลย · PDF ที่ไม่ใช่แบบ (อ่านไม่ออก) → ลองอ่านเป็นใบปะหน้า
    const applySheet = (o) => {
      setSheet(o);
      if (o.kind === "modify") {
        if (!addOnly) {
          if (o.mNo && !verRaw) setVerRaw(String(o.mNo));
          if (o.date) setDate(o.date);
          if (!reason.trim()) setReason(`ตามใบ Modify ${o.roRaw || o.mVer}${o.items.length ? " — " + o.items.map((x) => x.code + (x.rev ? " REV." + x.rev : "")).join(", ") : ""}${o.note ? " · " + o.note : ""}`);
        }
        notes.push(`ใบ Modify ${o.roRaw || o.mVer}${o.refRo ? ` (อ้างถึง ${o.refRo})` : ""}: แบบที่แก้ ${o.items.length} รายการ — ${o.items.map((x) => x.code + (x.rev ? " REV." + x.rev : "")).join(", ")}${o.issuedBy ? ` · โดย ${o.issuedBy}` : ""}`);
        if (o.refRo && roKey(o.refRo) !== roKey(plan.ro)) notes.push(`⚠ ใบ Modify นี้อ้างถึง ${o.refRo} แต่กำลังแก้ Release ${plan.ro} — ตรวจว่าเปิดใบถูก`);
        if (addOnly) notes.push(`นี่คือใบ Modify — ถ้าจะแก้ของเดิม (จำนวน/ยกเลิก/แบบ Rev ใหม่) ให้ใช้ ✎ Modify · หน้านี้ใช้เพิ่มรายการใหม่เท่านั้น`);
      } else {
        notes.push(`ใบปะหน้า ${o.roRaw || o.ro || o.file}: ${o.items.length} รายการ${o.zone ? ` · Zone ${o.zone}` : ""}`);
        if (o.ro && roKey(o.ro) !== roKey(plan.ro)) notes.push(`⚠ ใบปะหน้านี้เป็น ${o.ro} แต่กำลังแก้ Release ${plan.ro} — ตรวจว่าเปิดใบถูก`);
      }
    };
    let all = [];
    try {
      for (const f of files) {
        if (/\.(xlsx?|xlsm)$/i.test(f.name)) { try { applySheet(await readOrderFile(f)); } catch (e) { notes.push(`อ่าน ${f.name} ไม่ได้: ${e?.message || e}`); } }
      }
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
      if (pdfs.length) all = await readPdfFiles(pdfs);
      const rest = [];
      for (const d of all) {
        if (d.kind === "unknown" && d._file) { try { const o = await readOrderPdf(d._file); if (o.items.length) { applySheet(o); continue; } } catch { /* ไม่ใช่ใบปะหน้า */ } }
        rest.push(d);
      }
      all = rest;
    } catch (e) { setPdfMsg({ bad: "อ่านไฟล์ไม่ได้: " + (e?.message || e) }); return; }
    const exists = (c) => need.parts.concat(need.subs).some((x) => NC(x.code) === NC(c)) || adds.some((a) => NC(a.code) === NC(c));
    for (const d of all) {
      const scope = d.kind === "panel" ? "panel" : d.kind === "sub" ? "sub" : null;
      const col = scope ? bomCol(scope) : null; const ok = col ? findKey(col, d.code) : null;
      if (scope && ok) {
        // เทียบ BOM: แถวเดิม (ไม่นับที่ยกเลิก) vs แถวใน PDF (รวมเบอร์ซ้ำ)
        const items = col[ok].items || []; const pdfQ = new Map();
        for (const b of d.bom || []) { const c = NC(b.code); if (!c) continue; const e = pdfQ.get(c) || { code: String(b.code).trim().toUpperCase(), qty: 0, d: b.desc || "" }; e.qty += Number(b.qty) || 0; pdfQ.set(c, e); }
        let nq = 0, nc = 0, na = 0; const seen = new Set();
        items.forEach((it, idx) => {
          if (it[4] === "ยกเลิก") return; const c = NC(it[1]); seen.add(c); const k = `${scope}|${ok}|${idx}`; const e = pdfQ.get(c);
          const where = `ลูกใน${scope === "panel" ? "แผง" : "ซับ"} ${ok}`;
          if (!e) { bChg[k] = { type: "cancel" }; nc++; foundL.push({ code: it[1], what: "ลูกถูกเอาออก", from: `${nf(Number(it[2]))}/ชุด`, to: "ยกเลิก", where, tone: "bad" }); }
          else if (Math.abs(e.qty - Number(it[2])) > 1e-9) { bChg[k] = { type: "qty", qty: String(e.qty) }; nq++; foundL.push({ code: it[1], what: "จำนวนลูก/ชุด", from: nf(Number(it[2]), 2), to: nf(e.qty, 2), where, tone: "chg" }); }
        });
        for (const [c, e] of pdfQ) if (!seen.has(c) && e.qty > 0) { bAdds.push({ scope, owner: ok, kind: /^SA/i.test(e.code) || findKey(plan.bom.subs, e.code) ? "sub" : "part", code: e.code, qty: String(e.qty), d: e.d }); na++; foundL.push({ code: e.code, what: "ลูกใหม่", from: "—", to: `${nf(e.qty, 2)}/ชุด`, where: `ลูกใน${scope === "panel" ? "แผง" : "ซับ"} ${ok}`, tone: "new" }); }
        // ความยาวซับตามหัวกระดาษ
        if (scope === "sub") { const cs = need.subs.find((x) => NC(x.code) === NC(ok)); const Ls = parseFloat(d.title?.LENGTH); if (cs && Number.isFinite(Ls) && Ls > 0 && (cs.l == null || Math.abs(Ls - Number(cs.l)) > 0.05)) { const ent = { id: `${NC(ok)}|len`, code: ok, kind: "sub", field: "len", from: cs.l ?? "—", to: Ls, file: d.file, on: true }; setMatChg((m) => [...m.filter((x) => x.id !== ent.id), ent]); foundL.push({ code: ok, what: "ความยาวซับ", from: cs.l ?? "—", to: Ls, where: "ซับ", tone: "chg" }); } }
        const sum = [nq && `จำนวนเปลี่ยน ${nq}`, nc && `ยกเลิก ${nc}`, na && `ลูกใหม่ ${na}`].filter(Boolean).join(" · ") || "ตรงกับ BOM เดิม ไม่มีอะไรเปลี่ยน";
        drops[NC(ok)] = sum;
        notes.push(`${scope === "panel" ? "แผง" : "ซับ"} ${ok}: ${sum}`);
        if (nq || nc || na) jump = jump || { scope, owner: ok };
      } else if (d.kind === "loose") {
        // ★ 2026-11-09 แบบ Site Item + อุปกรณ์ (เช่น MTG01-001 mock-up): BILL SITE ITEM → พาร์ทหมวด SITE ITEM (มี QR · ใบงานตามรหัสเบอร์)
        //   FASTENER COMPONENT LIST → อุปกรณ์ (ไม่มี QR · เบิกที่แท็บ ACCESSORIES ตอนปล่อยล็อต) · จำนวนตามตาราง (ไม่คูณแผง)
        let ns = 0, nh = 0, skip = 0;
        for (const r of d.site || []) {
          const code = String(r.code).trim().toUpperCase();
          if (adds.some((a) => NC(a.code) === NC(code)) || newAdds.some((a) => NC(a.code) === NC(code))) { skip++; continue; }
          const isSub = need.subs.some((x) => NC(x.code) === NC(code)) || !!findKey(plan.bom.subs, code) || /^(SA|MSA)/i.test(code);   // ★ ซับส่งไซต์ (เช่น MSAAT550-5001 ในแบบ US)
          const have = (isSub ? need.subs : need.parts).find((x) => NC(x.code) === NC(code));   // มีในใบแล้ว (เช่น อยู่ใน BOM แผง) → จำนวนนี้บวกเพิ่มเป็นของส่งไซต์
          newAdds.push({ kind: isSub ? "sub" : "part", code, d: r.desc || have?.d || "", qty: r.qty != null ? String(r.qty) : "", l: r.len != null ? String(r.len) : have?.l != null ? String(have.l) : "", inv: have?.inv || "", dest: have?.dest || ruleDest(ruleCat(code, "part"), code), procs: "ยิง", cat: "SITE ITEM", fromPdf: true, src: d.code,
            note: have ? `มีในใบแล้ว ${nf(have.qty)} ชิ้น (จาก BOM แผง) — จำนวนนี้บวกเพิ่ม เป็น Site Item ส่งไซต์` : `Site Item จากแบบ ${d.code}` }); ns++;
          foundL.push({ code, what: "Site Item เพิ่ม", from: have ? nf(have.qty) : "—", to: r.qty != null ? `+${nf(r.qty)}` : "ใส่จำนวน", where: `แบบ ${d.code}`, tone: "new" });
        }
        for (const r of d.hw || []) {
          const code = String(r.code).trim().toUpperCase();
          if (adds.some((a) => NC(a.code) === NC(code)) || newAdds.some((a) => NC(a.code) === NC(code))) { skip++; continue; }
          const have = need.hw.find((x) => NC(x.code) === NC(code));
          const q = r.qty > 0 ? r.qty : r.len > 0 ? r.len : "";
          newAdds.push({ kind: "hw", code, d: r.desc || "", qty: q === "" ? "" : String(q), l: "", inv: "", u: r.u || "pcs.", fromPdf: true, src: d.code,
            note: [have ? `มีในใบแล้ว ${nlen(have.qty)} ${have.u || "pcs."} (จาก BOM แผง) — จำนวนนี้บวกเพิ่ม` : "", r.qty > 0 ? "" : r.len > 0 ? `ตารางไม่มี TOTAL — ใส่ ${r.len} ${r.u} จากช่อง DIM.A ให้ (แก้ได้)` : "ตารางไม่มีจำนวน", r.remark || ""].filter(Boolean).join(" · ") }); nh++;
        }
        drops[NC(d.code)] = `Site Item ${ns} · อุปกรณ์ ${nh}`;
        notes.push(`${d.code} (${d.title?.DESC || "แบบ Site Item + อุปกรณ์"}): Site Item ${ns} เบอร์ · อุปกรณ์ ${nh} รายการ${skip ? ` · ข้าม ${skip} (มีแล้ว)` : ""}${(d.units || []).length ? ` · แผงในแบบ: ${d.units.map((u) => `${u.code} ×${u.qty}`).join(", ")}` : ""}`);
      } else if (d.kind === "part" || d.kind === "sub") {
        if (exists(d.code)) {
          // ★ 2026-11-10 เบอร์มีในใบแล้ว → เทียบหัวกระดาษ: ความยาว (พาร์ท/ซับ) · วัสดุ INV (พาร์ท) — เจอต่าง = รายการ "เปลี่ยนตามแบบ" (ติ๊กออกได้)
          const cur = (d.kind === "part" ? need.parts : need.subs).find((x) => NC(x.code) === NC(d.code));
          const t = d.title || {}; const inv = String(t["INV.CODE"] || "").trim().toUpperCase(); const L = parseFloat(t.LENGTH);
          const got = [];
          if (cur && d.kind === "part") { const curInv = String(cur.inv || "").trim().toUpperCase(); if (inv && inv !== "-" && inv !== curInv) got.push({ field: "mat", from: curInv || "—", to: inv }); }
          if (cur && Number.isFinite(L) && L > 0 && (cur.l == null || Math.abs(L - Number(cur.l)) > 0.05)) got.push({ field: "len", from: cur.l ?? "—", to: L });
          if (got.length) {
            const ents = got.map((g) => ({ id: `${NC(cur.code)}|${g.field}`, code: cur.code, kind: d.kind, file: d.file, on: true, ...g }));
            setMatChg((m) => [...m.filter((x) => !ents.some((y) => y.id === (x.id || `${NC(x.code)}|${x.field || "mat"}`))), ...ents]);
            got.forEach((g) => foundL.push({ code: cur.code, what: g.field === "len" ? "ความยาว" : "วัสดุ (INV)", from: g.from, to: g.to, where: d.kind === "sub" ? "ซับ" : "พาร์ท", tone: "chg" }));
            drops[NC(d.code)] = got.map((g) => (g.field === "len" ? `ยาว → ${g.to}` : `วัสดุ → ${g.to}`)).join(" · ");
            notes.push(`${d.code}: ${got.map((g) => `${g.field === "len" ? "ความยาว" : "วัสดุ"} ${g.from} → ${g.to}`).join(" · ")} (ติ๊กออกได้ในตาราง "เทียบกับแบบ")`); continue;
          }
          drops[NC(d.code)] = "ตรงเดิม"; foundL.push({ code: d.code, what: "ตรงกับใบเดิม", from: "", to: "", where: d.kind === "sub" ? "ซับ" : "พาร์ท", tone: "same" });
          notes.push(`${d.code}: ตรงกับใบเดิม (ความยาว / วัสดุไม่เปลี่ยน)`); continue;
        }
        const t = d.title || {}; const L = parseFloat(t.LENGTH); const inv = String(t["INV.CODE"] || "").trim();
        const old = d.kind === "part" ? need.parts.find((x) => baseOf(x.code) === baseOf(d.code) && NC(x.code) !== NC(d.code)) : null;
        drops[NC(d.code)] = old ? `แทน ${old.code}` : "เพิ่มเป็นเบอร์ใหม่";
        // ★ 2026-11-10 เบอร์รุ่นใหม่ (REV) ของเบอร์ที่มีในใบ → ใช้จำนวนเดิม + ยกเลิกเบอร์เดิมให้ (แก้/ติ๊กออกได้ที่แท็บพาร์ท)
        if (old) { setRow("part", old.code, { type: "cancel" }); foundL.push({ code: `${old.code} → ${String(d.code).trim().toUpperCase()}`, what: "เปลี่ยนเบอร์ (REV ใหม่)", from: `${old.code} × ${nf(old.qty)}`, to: `${String(d.code).trim().toUpperCase()} × ${nf(old.qty)}`, where: "พาร์ท", tone: "chg" }); }
        else foundL.push({ code: String(d.code).trim().toUpperCase(), what: "เบอร์ใหม่ (ไม่มีในใบ)", from: "—", to: "ใส่จำนวนที่แท็บเพิ่มเบอร์ใหม่", where: d.kind === "sub" ? "ซับ" : "พาร์ท", tone: "new" });
        newAdds.push({ kind: d.kind, code: String(d.code).trim().toUpperCase(), d: t.DESC || "", qty: old ? String(old.qty) : "", l: Number.isFinite(L) ? String(L) : "", inv: inv && inv !== "-" ? inv : "", dest: ruleDest(d.code), procs: "ยิง", fromPdf: true, note: old ? `รุ่นใหม่ของ ${old.code} — ใช้จำนวนเดิม ${nf(old.qty)} และยกเลิก ${old.code} ให้แล้ว (ไม่ใช้แทน: ลบแถวนี้ + เอายกเลิกออกที่แท็บพาร์ท)` : (d.kind === "sub" ? "ซับใหม่: สร้าง QR ซับ · ลูกของซับตั้งที่หน้า ซับ / พาร์ท ของโปรเจค" : "") });
      } else if (scope && !ok) { drops[NC(d.code)] = `${scope === "panel" ? "แบบแผง" : "ซับ"}นี้ไม่อยู่ในใบ`; notes.push(`${d.code}: ${scope === "panel" ? "แบบแผง" : "ซับ"}นี้ไม่อยู่ในใบ`); }
      else notes.push(`อ่านไม่ออก: ${d.file}`);
    }
    if (foundL.length) setFound((f) => [...f.filter((x) => !foundL.some((y) => y.code === x.code && y.what === x.what && y.where === x.where)), ...foundL]);
    if (Object.keys(drops).length) setDropped((o) => ({ ...o, ...drops }));
    if (Object.keys(bChg).length) setBchg((o) => ({ ...o, ...bChg }));
    if (bAdds.length) setBadds((a) => [...a.filter((x) => !bAdds.some((y) => y.scope === x.scope && NC(y.owner) === NC(x.owner) && NC(y.code) === NC(x.code))), ...bAdds]);
    if (newAdds.length) { setAdds((a) => [...a, ...newAdds]); setTab("add"); notes.push(`เพิ่มเบอร์ใหม่ ${newAdds.length} เบอร์ — ใส่จำนวนในตาราง (ข้อมูลอื่นแก้ได้)`); }
    else if (jump) { setTab(jump.scope === "panel" ? "bom" : "sub"); setBscope(jump.scope); setBowner(jump.owner); }
    setPdfMsg({ ok: notes });
  }
  const initRef = useRef(false);
  useEffect(() => { if (initialFiles && initialFiles.length && !initRef.current) { initRef.current = true; onModPdfs(initialFiles); } }, [initialFiles]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nDrawn = Object.keys(dropped).length;
  const nMiss = sheet ? sheetCmp.filter((x) => !x.drop).length : 0;
  const zone = (ref, drag, setDrag, onFiles) => ({ role: "button", tabIndex: 0, onClick: () => ref.current?.click(), onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } },
    onDragOver: (e) => { e.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false), onDrop: (e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); } });
  // ★ 2026-11-10 ผู้ใช้: ใบปะหน้ากับแบบวางที่เดียวกัน — ระบบแยกให้เอง (Excel / PDF ใบปะหน้า = ใบ · PDF แบบ = แบบ) · ใต้ช่องบอกว่าได้อะไรแล้ว
  const pdfDropEl = (
    <div className="rl-1drop">
      <div className={`rw-drop rw-drop-sm rl-step-drop ${pdfDrag ? "drag" : ""}`} {...zone(pdfRef, pdfDrag, setPdfDrag, onModPdfs)}>
        <div className="rw-drop-ic"><Icon name="plus" size={16} /></div>
        <div><b>{nDrawn || sheet ? "วางเพิ่มได้" : `วาง${addOnly ? "ใบปะหน้า Release" : "ใบ Modify (FM(DE)-00)"} + แบบที่${addOnly ? "เพิ่ม" : "แก้"} ที่นี่`}</b><span>วางพร้อมกันหลายไฟล์ได้ · ระบบแยกให้เองว่าไฟล์ไหนเป็นใบปะหน้า ไฟล์ไหนเป็นแบบ · ใบปะหน้า Excel / PDF · แบบ PDF (ซับ / แผง / พาร์ท / Site Item + อุปกรณ์)</span></div>
      </div>
      <input ref={pdfRef} type="file" accept=".pdf,.xls,.xlsx,.xlsm,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple hidden onChange={(e) => { onModPdfs(e.target.files); e.target.value = ""; }} />
      <div className="rl-1drop-st">
        <span className={`rl-1drop-chip ${sheet ? "ok" : ""}`}>{sheet ? "✓" : "○"} {addOnly ? "ใบปะหน้า" : "ใบ Modify"}: {sheet ? <><b>{sheet.roRaw || sheet.mVer || sheet.ro || sheet.file}</b> · {sheet.items.length} รายการ{sheet.refRo ? ` · อ้างถึง ${sheet.refRo}` : ""} <button type="button" className="rw-link" onClick={() => setSheet(null)}>เอาออก</button></> : <span className="rw-muted">ยังไม่มี (ไม่มีก็ข้ามได้)</span>}</span>
        <span className={`rl-1drop-chip ${nDrawn && !nMiss ? "ok" : nMiss ? "warn" : ""}`}>{nDrawn && !nMiss ? "✓" : "○"} แบบ: {nDrawn ? <b>วางแล้ว {nDrawn} แบบ</b> : <span className="rw-muted">ยังไม่มี</span>}{sheet ? (nMiss ? <span className="rl-errtxt"> · ตามใบยังขาด {nMiss} แบบ</span> : nDrawn ? " · ครบตามใบ" : "") : ""}</span>
      </div>
    </div>);
  const sheetEl = sheet ? (
    <div className={`rw-order-check ${sheetCmp.some((x) => (sheet.kind === "modify" ? !x.drop : x.status === "missing")) ? "warn" : "ok"}`} style={{ marginBottom: 10 }}>
      <div className="rw-order-h">
        <b>{sheet.kind === "modify" ? `ใบ Modify ${sheet.roRaw || sheet.mVer}` : `ใบปะหน้า ${sheet.roRaw || sheet.ro || sheet.file}`}</b>
        <span className="rw-muted">{[sheet.refRo && `อ้างถึง ${sheet.refRo}`, sheet.zone && `Zone ${sheet.zone}`, sheet.issuedBy && `โดย ${sheet.issuedBy}`, sheet.date].filter(Boolean).join(" · ")} · {sheet.items.length} รายการ{sheet.kind === "modify" ? ` · วางแบบแล้ว ${sheetCmp.filter((x) => x.drop).length}/${sheet.items.length}` : ""}</span>
        <button type="button" className="rw-link" onClick={() => { setSheet(null); }}>เอาออก</button>
      </div>
      <table className="data-table rw-table rw-order-tbl">
        <thead><tr><th className="r">#</th><th>Part No.</th><th>Description</th><th>{sheet.kind === "modify" ? "Remarks" : "จำนวน"}</th><th>ในใบ {plan.ro}</th><th>แบบที่วางรอบนี้</th></tr></thead>
        <tbody>{sheetCmp.map((x) => (
          <tr key={x.code} className={(sheet.kind === "modify" ? !x.drop : x.status === "missing") ? "rl-errrow" : ""}>
            <td className="r rw-muted">{x.item ?? ""}</td><td className="rw-mono"><b>{x.code}</b></td><td className="rw-desc">{x.d}</td>
            <td>{sheet.kind === "modify" ? (x.remark || (x.rev ? "REV." + x.rev : "")) : <>{nlen(x.qty)}{x.unit ? <small className="rw-muted"> {x.unit}</small> : null}</>}</td>
            <td>{sheet.kind === "modify" ? (x.inPlan ? <Pill tone="ok">{x.inPlan === "panel" ? "แผง" : x.inPlan === "sub" ? "ซับ" : "พาร์ท"}</Pill> : <Pill tone="bad">ไม่อยู่ในใบ</Pill>) : (x.status === "missing" ? <Pill tone="bad">ยังไม่อยู่ในใบ</Pill> : x.status === "ok" ? <Pill tone="ok">มี {nlen(x.have)}</Pill> : <Pill tone="warn">มี {nlen(x.have)}</Pill>)}</td>
            <td>{x.drop ? <span className="rw-ok small">✓ {x.drop}</span> : <span className="rl-errtxt small">ยังไม่ได้วางแบบ</span>}</td>
          </tr>))}</tbody>
      </table>
    </div>) : null;
  const togChg = (id, on) => setMatChg((m) => m.map((y) => ((y.id || `${NC(y.code)}|${y.field || "mat"}`) === id ? { ...y, on } : y)));
  const chgOf = (f) => matChg.find((x) => (x.id || `${NC(x.code)}|${x.field || "mat"}`) === `${NC(f.code)}|${f.what === "วัสดุ (INV)" ? "mat" : "len"}`);
  const matChgEl = found.length && !addOnly ? (
    <div className="rl-found">
      <div className="rl-found-h"><b>เทียบกับแบบที่วาง</b><span className="rw-muted small">{found.filter((f) => f.tone !== "same").length} จุดที่เปลี่ยน · {found.filter((f) => f.tone === "same").length} แบบตรงเดิม · ติ๊กออก = ไม่เอาจุดนั้น</span><button type="button" className="rw-link small" onClick={() => setFound([])}>ซ่อนตาราง</button></div>
      <div className="rl-found-tw"><table className="rl-sc-table rl-cmp-t">
        <thead><tr><th style={{ width: 30 }} /><th>เบอร์</th><th>อยู่ที่</th><th>เปลี่ยนอะไร</th><th className="r">เดิม</th><th /><th>ตามแบบ</th></tr></thead>
        <tbody>{found.map((f, i) => { const c = (f.what === "วัสดุ (INV)" || f.what === "ความยาว" || f.what === "ความยาวซับ") ? chgOf(f) : null; return (
          <tr key={i} className={`rl-cmp-${f.tone === "same" ? "same" : f.tone}`}>
            <td>{c ? <input type="checkbox" checked={c.on} onChange={(e) => togChg(c.id || `${NC(c.code)}|${c.field || "mat"}`, e.target.checked)} aria-label={`ใช้ ${f.what} ของ ${f.code}`} /> : f.tone === "same" ? <span className="rw-muted">=</span> : <span className="rw-ok">✓</span>}</td>
            <td className="rw-mono"><b>{f.code}</b></td><td className="small">{f.where}</td><td className="small"><b>{f.what}</b></td>
            <td className="r rw-mono">{f.from !== "" ? <s className="rl-old">{String(f.from)}</s> : null}</td><td className="rw-muted">{f.tone === "same" ? "" : "→"}</td>
            <td className="rw-mono"><b className={f.tone === "bad" ? "rl-errtxt" : f.tone === "same" ? "rw-muted" : "rl-new"}>{String(f.to)}</b></td>
          </tr>); })}</tbody>
      </table></div>
      <div className="rw-muted small">ลูกใน BOM / จำนวน / ยกเลิก ปรับต่อได้ที่แท็บ ซับ · BOM แผง · พาร์ท · เบอร์ใหม่ใส่จำนวนที่แท็บ "เพิ่มเบอร์ใหม่" · ความยาว / วัสดุ = ใบปล่อยล็อตถัดไปใช้ค่าใหม่ (ล็อตที่ปล่อยแล้วไม่เปลี่ยน)</div>
    </div>) : null;
  const pdfMsgEl = pdfMsg ? (
    <div className={`rw-msg ${pdfMsg.bad ? "bad" : pdfMsg.info ? "info" : "ok"}`} style={{ marginTop: 0, marginBottom: 10 }}>
      {pdfMsg.bad || pdfMsg.info || <>{pdfMsg.ok.map((t, i) => <div key={i}>✓ {t}</div>)}<div className="rw-muted small">ตรวจแล้วแก้ต่อได้ · ยังไม่บันทึกจนกว่าจะกด "{addOnly ? "เพิ่มรายการ" : `บันทึก ${ver}`}"</div></>}
      {pdfMsg.ok || pdfMsg.bad ? <button type="button" className="rw-link" style={{ marginLeft: 8 }} onClick={() => setPdfMsg(null)}>ปิด</button> : null}
    </div>) : null;
  // ★ 2026-11-04 ผู้ใช้: "Sub ให้มีที่เดียวพอ" — แก้ลูกของซับอยู่ในแท็บ "ซับ" (ปุ่ม แก้ลูก) · แท็บ BOM เหลือแผงอย่างเดียว
  const bomEditorEl = (
    <div className="rl-bomedit">
              <div className="rl-tools">
                {bscope === "sub" ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBowner("")}>← รายการซับ</button> : null}
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
  );
  return (
    <>
      <div className="rl-back" onClick={() => !busy && onClose()} />
      <aside className="rl-drawer rm" role="dialog" aria-modal="true" aria-label={`Modify Release ${plan.ro}`}>
        <div className="rl-dr-head">
          <div className="rl-dr-title">
            <h2>{addOnly ? `เพิ่มรายการ · Release ${plan.ro}` : `Modify Release ${plan.ro}`}</h2>
            {addOnly ? null : <input className="input rw-mono rl-lotno" value={verRaw} placeholder={modVer(autoNo)} onChange={(e) => setVerRaw(e.target.value.replace(/[^0-9]/g, ""))} aria-label="เลข M (ว่าง = อัตโนมัติ)" title="เลข M — ว่าง = เลขถัดไปอัตโนมัติ" />}
            {addOnly ? null : <input className="input rl-date" type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} aria-label="วันที่ของ M ตามเอกสาร" />}
            {addOnly ? null : <input className="input rl-note" value={reason} placeholder="เหตุผล * เช่น ลูกค้าแจ้งลดจำนวน / แบบ Rev B" onChange={(e) => setReason(e.target.value)} aria-label="เหตุผลของการ Modify" />}
          </div>
          <button type="button" className="rl-x" onClick={onClose} aria-label="ปิด" disabled={!!busy}>×</button>
        </div>
        {addOnly ? <p className="rl-dr-sub">เพิ่มเบอร์ / Site Item / อุปกรณ์ ที่ยังไม่มีในใบนี้ — วาง PDF แบบ (เช่น แบบ mock-up ที่มี BILL SITE ITEM + FASTENER COMPONENT LIST) หรือพิมพ์เอง · <b>ไม่นับเป็น Modify</b> ไม่มีเลข M · ของเดิมไม่เปลี่ยน · ถ้าต้องแก้จำนวน/ยกเลิกของเดิม ใช้ ✎ Modify</p> : null}
        {addOnly ? null : <p className="rl-dr-sub">{ver}{verErr ? <b className="rl-errtxt"> · {verErr}</b> : null} · แก้ยอดต้องใช้ทั้งใบ / ยกเลิกเบอร์ / ยกเลิกที่อยู่แผงที่ยังไม่ปล่อย / เพิ่มเบอร์ใหม่ · ของที่ปล่อยแล้วเกินยอดใหม่ ระบบลด/ยกเลิกในล็อตให้ (ล็อตล่าสุดก่อน · ไม่ต่ำกว่าที่ทำแล้ว) · จำนวนเดิมขีดฆ่า · เบอร์ที่ยกเลิกเป็นสีแดง{lim.s === "err" ? ` · ⚠ อ่านยอดที่ทำแล้วไม่ได้ (${lim.err})` : ""}</p>}
        {addOnly ? null : <div className="rl-tabs" role="tablist">
          {[["part", "พาร์ท", need.parts.length], ["sub", "ซับ", need.subs.length], ["bom", "BOM แผง", null], ["add", "เพิ่มเบอร์ใหม่", null], ["addr", "ที่อยู่แผง", plan.units.length]].map(([k, l, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rl-tab ${tab === k ? "on" : ""}`} onClick={() => { setTab(k); if (k === "bom") { setBscope("panel"); setBowner(""); } else if (k === "sub") { setBscope("sub"); setBowner(""); } }}>
              <b>{l}</b><small>{n != null ? `${nf(n)} รายการ` : k === "bom" ? "แก้เบอร์/จำนวนลูกในแผง" : "เบอร์ที่ไม่มีใน BOM"}{tabCount(k) ? <em>แก้ {tabCount(k)}</em> : null}</small>
            </button>))}
        </div>}
        <div className="rl-dr-top">{pdfDropEl}{sheetEl}{matChgEl}{pdfMsgEl}</div>
        {tab !== "add" && tab !== "bom" && !(tab === "sub" && bowner) ? (
          <div className="rl-tools">
            <input className="input rw-search" style={{ marginTop: 0 }} placeholder={tab === "addr" ? "ค้นหาที่อยู่ / Unit" : "ค้นหาเบอร์ / description"} value={q} onChange={(e) => setQ(e.target.value)} />
            {tab !== "addr" ? <label className="rw-check"><input type="checkbox" checked={onlyChg} onChange={(e) => setOnlyChg(e.target.checked)} /> เฉพาะที่แก้</label> : null}
          </div>) : null}
        <div className="table-wrap rw-tw rl-tw">
          {tab === "sub" && bowner ? bomEditorEl : tab === "part" || tab === "sub" ? (
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
                      </select>)}
                      {tab === "sub" && r.hasBom && !r.cancelled ? (() => { const nE = edits.filter((x) => x.scope === "sub" && NC(x.owner) === NC(r.code)).length; return <button type="button" className="btn btn-ghost btn-sm rl-kidsbtn" onClick={() => { setBscope("sub"); setBowner(r.code); }} title="แก้เบอร์ลูก / จำนวนลูกในซับนี้">แก้ลูก{nE ? ` (${nE})` : ""}</button>; })() : null}</td>
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
          ) : tab === "bom" ? bomEditorEl : (
            <div className="rl-addbox">
              <div className="rl-addform">
                <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="ชนิด"><option value="part">พาร์ท</option><option value="sub">ซับ</option><option value="hw">อุปกรณ์ (ไม่มี QR)</option></select>
                <input className="input rw-mono" placeholder="Code *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} aria-label="Code" />
                <input className="input" placeholder="Description" value={form.d} onChange={(e) => setForm({ ...form, d: e.target.value })} aria-label="Description" />
                <input className="input" type="number" min={form.kind === "hw" ? "0.01" : "1"} step={form.kind === "hw" ? "0.01" : "1"} placeholder="จำนวน *" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="จำนวน" />
                {form.kind !== "hw" ? <input className="input" type="number" min="0" placeholder="ยาว (มม.)" value={form.l} onChange={(e) => setForm({ ...form, l: e.target.value })} aria-label="ความยาว" /> : null}
                {form.kind === "part" ? <input className="input rw-mono" placeholder="INV" value={form.inv} onChange={(e) => setForm({ ...form, inv: e.target.value.toUpperCase() })} aria-label="INV" /> : null}
                {form.kind === "part"
                  ? <select className="select" value={form.dest} onChange={(e) => setForm({ ...form, dest: e.target.value })} aria-label="ใบงาน">{PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}</select>
                  : form.kind === "sub" ? <select className="select" value={form.procs} onChange={(e) => setForm({ ...form, procs: e.target.value })} aria-label="งานซับ">{PROCS.map((p) => <option key={p} value={p}>SUB {SUB_SHORT[p]}</option>)}</select>
                  : <select className="select" value={form.u} onChange={(e) => setForm({ ...form, u: e.target.value })} aria-label="หน่วย"><option value="pcs.">pcs.</option><option value="m.">m.</option></select>}
                <button type="button" className="btn btn-accent btn-sm" disabled={!form.code.trim() || !!formErr} onClick={() => { setAdds((a) => [...a, { ...form, code: form.code.trim().toUpperCase() }]); setForm(blankForm); }}><Icon name="plus" size={13} /> เพิ่ม</button>
              </div>
              {formErr ? <div className="rw-msg warn">{formErr}</div> : null}
              {adds.length ? (
                <table className="data-table rw-table">
                  <thead><tr><th>ชนิด</th><th>Code</th><th>Description</th><th className="r">จำนวน *</th><th className="r">ยาว (มม.)</th><th>INV</th><th>ใบงาน / หน่วย</th><th /></tr></thead>
                  <tbody>{adds.map((a, i) => { const up = (patch) => setAdds((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))); const noQ = !(Number(a.qty) > 0); return (
                    <tr key={a.code} className={noQ ? "rl-needqty" : ""}>
                      <td>{a.kind === "sub" ? "ซับ" : a.kind === "hw" ? <>อุปกรณ์ <small className="rw-muted">ไม่มี QR</small></> : a.cat === "SITE ITEM" ? <>พาร์ท <small className="rw-muted">SITE ITEM</small></> : "พาร์ท"}</td>
                      <td className="rw-mono"><b>{a.code}</b> {addOnly ? <Pill tone="info">เพิ่มใหม่</Pill> : <Pill tone="mod">เพิ่ม {ver}</Pill>}{a.fromPdf ? <> <Pill tone="info">PDF</Pill></> : null}{a.note ? <div className="rw-muted small">{a.note}</div> : null}</td>
                      <td><input className="input rw-cell" value={a.d || ""} onChange={(e) => up({ d: e.target.value })} aria-label={`Description ${a.code}`} /></td>
                      <td className="r"><input className="input rw-cell rl-qty" type="number" min={a.kind === "hw" ? "0.01" : "1"} step={a.kind === "hw" ? "0.01" : "1"} placeholder="จำนวน" value={a.qty} onChange={(e) => up({ qty: e.target.value })} aria-label={`จำนวน ${a.code}`} autoFocus={a.fromPdf && noQ && i === adds.findIndex((x) => !(Number(x.qty) > 0))} /></td>
                      <td className="r">{a.kind !== "hw" ? <input className="input rw-cell rl-qty" type="number" min="0" value={a.l || ""} onChange={(e) => up({ l: e.target.value })} aria-label={`ความยาว ${a.code}`} /> : null}</td>
                      <td>{a.kind === "part" ? <input className="input rw-cell rw-mono" value={a.inv || ""} onChange={(e) => up({ inv: e.target.value.toUpperCase() })} aria-label={`INV ${a.code}`} /> : null}</td>
                      <td>{a.kind === "part"
                        ? <select className="select rw-cellsel" value={a.dest} onChange={(e) => up({ dest: e.target.value })} aria-label={`ใบงาน ${a.code}`}>{PART_DESTS.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}</select>
                        : a.kind === "sub" ? <select className="select rw-cellsel" value={a.procs} onChange={(e) => up({ procs: e.target.value })} aria-label={`งานซับ ${a.code}`}>{PROCS.map((p) => <option key={p} value={p}>SUB {SUB_SHORT[p]}</option>)}</select>
                        : <select className="select rw-cellsel" value={a.u || "pcs."} onChange={(e) => up({ u: e.target.value })} aria-label={`หน่วย ${a.code}`}><option value="pcs.">pcs.</option><option value="m.">m.</option></select>}</td>
                      <td><button type="button" className="rl-x" onClick={() => setAdds((xs) => xs.filter((_, j) => j !== i))} aria-label={`เอา ${a.code} ออก`}>×</button></td>
                    </tr>); })}</tbody>
                </table>
              ) : <div className="rw-muted small" style={{ padding: 12 }}>เบอร์ที่ไม่มีใน BOM เดิม (เช่นแบบ Rev ใหม่เพิ่มพาร์ท) — เพิ่มแล้วจะอยู่ในยอดคงเหลือ ปล่อยในล็อตถัดไป</div>}
            </div>
          )}
        </div>
        {err ? <div className="rw-msg bad">✗ {err}</div> : null}
        <div className="rl-dr-foot">
          <div className="rl-sum">
            {addOnly ? <><b>เพิ่มรายการ:</b> พาร์ท/ซับ {adds.filter((a) => a.kind !== "hw").length} เบอร์ · อุปกรณ์ {adds.filter((a) => a.kind === "hw").length} รายการ <small className="rw-muted">· ไม่นับเป็น Modify</small></> : <><b>{ver}:</b> แก้จำนวน {realChanges.filter((c) => c.type === "qty").length} · ยกเลิกเบอร์ {realChanges.filter((c) => c.type === "cancel").length} · ยกเลิกที่อยู่ {addrs.size} · แก้ BOM ลูก {edits.length} · เพิ่ม {adds.length}{matOn.length ? <> · เปลี่ยนตามแบบ {matOn.length}</> : null}</>}
            {lotTouched.length ? <div className="rl-sum-chips">{lotTouched.map((x) => <Pill key={x.lot} tone="bad">{x.lot}: QR −{nf(x.qr)}</Pill>)}</div> : null}
            {blockers.length ? <div className="rw-muted small">{blockers.join(" · ")}</div> : null}
          </div>
          <div className="rl-foot-btns">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>ยกเลิก</button>
            <button type="button" className="btn btn-accent" onClick={save} disabled={!!blockers.length || !!busy}>{busy || (addOnly ? `เพิ่ม ${adds.length} รายการ` : `บันทึก ${ver}`)}</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ══ การ์ด "Release ที่ยังปล่อยไม่ครบ" (หน้ารายการปล่อยงาน) ══
// ★ 2026-11-10 แก้ล็อตที่ปล่อยผิด — ติ๊กเบอร์ → ย้ายไปใบอื่น (QR เดิม) หรือยกเลิกการปล่อย (ลบแถว + QR ที่ยังไม่สแกน → ยอดกลับเป็น "เหลือ" ปล่อยใหม่ได้)
function LotFixDrawer({ lot, plan, need, api, user, rowSheets, onPlanChange, onClose, onDone }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const admin = user && user.role === "admin";
  const descOf = (r) => (r.kind === "subassembly" ? need.subs : need.parts).find((x) => NC(x.code) === NC(r.code))?.d || "";
  const rows = lot.rows.filter((r) => r.kind !== "panel" && !r.mod_cancelled_at);
  const ql = q.trim().toUpperCase();
  const vis = rows.filter((r) => !ql || [r.code, descOf(r), r.note].some((x) => String(x || "").toUpperCase().includes(ql)));
  const sel = rows.filter((r) => pick.has(r.id));
  const kinds = new Set(sel.map((r) => (r.kind === "subassembly" ? "sub" : "part")));
  const opts = kinds.size === 1 ? SHEETS.filter((x) => x.kind === [...kinds][0]) : [];
  const sheetName = (r) => rowSheets(r).map((k) => sheetOf(k).label).join(", ");
  const tog = (ids, on) => setPick((o) => { const n = new Set(o); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  async function move(label) {
    const list = sel.filter((r) => sheetName(r) !== label); if (!list.length) { setErr("เบอร์ที่เลือกอยู่ในใบนี้อยู่แล้ว"); return; }
    const ok = await askConfirm({ title: `ย้าย ${list.length} เบอร์ → ใบ ${label}?`, message: `${list.map((r) => `${r.code} (${nf(r.qty)})`).join(", ")}\nล็อต ${lot.no} · จากใบ ${[...new Set(list.map(sheetName))].join(", ")}\n\nQR และประวัติสแกนเดิมอยู่ครบ · ใบสั่งผลิตที่พิมพ์ไปแล้วต้องพิมพ์ใหม่${[...kinds][0] === "part" ? " · หมวดในใบหลักเปลี่ยนตาม (ล็อตต่อไปไปใบนี้)" : ""}`, tone: "warn", confirmText: "ย้ายใบงาน", cancelText: "ยกเลิก" });
    if (!ok) return;
    setBusy("กำลังย้าย…"); setErr("");
    try {
      const n = await api.moveReleasedSheet(list, label);
      if ([...kinds][0] === "part" && onPlanChange) {
        const sk = SHEETS.find((x) => x.label === label)?.k; const cat = Object.keys(CAT_DEST).find((c) => CAT_DEST[c] === sk);
        const catOv = { ...(plan.catOv || {}) }, destOv = { ...(plan.destOv || {}) };
        for (const r of list) { if (cat) { catOv[r.code] = cat; delete destOv[r.code]; } else if (sk) destOv[r.code] = sk; }
        onPlanChange({ ...plan, catOv, destOv });
      }
      setBusy(""); onDone(`ย้าย ${n} เบอร์ของ ${lot.no} ไปใบ ${label} แล้ว`);
    } catch (e) { setBusy(""); setErr("ย้ายไม่สำเร็จ: " + (e?.message || e)); }
  }
  async function unrelease() {
    setBusy("กำลังตรวจประวัติสแกน…"); setErr("");
    let chk; try { chk = await api.checkUnrelease(sel); } catch (e) { setBusy(""); setErr("ตรวจประวัติไม่สำเร็จ: " + (e?.message || e)); return; }
    setBusy("");
    const bl = chk.blocked.map((b) => `${b.row.code} (สแกนแล้ว ${nf(b.scanned)}${b.recs ? ` · บันทึกงาน ${nf(b.recs)}` : ""})`);
    if (!chk.ok.length) { setErr(`ยกเลิกไม่ได้ — ทุกเบอร์ที่เลือกเริ่มทำแล้ว: ${bl.join(", ")} · ใช้ "ย้ายไปใบ" แทน`); return; }
    const pcs = chk.ok.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    const ok = await askConfirm({ title: `ยกเลิกการปล่อย ${chk.ok.length} เบอร์ใน ${lot.no}?`, message: `${chk.ok.map((r) => `${r.code} (${nf(r.qty)})`).join(", ")}\n\nลบพร้อม QR ${nf(pcs)} ดวง (ยังไม่มีการสแกน) · ยอดกลับไปเป็น "เหลือ" → กด "ปล่อยล็อตใหม่" ปล่อยในใบ/ล็อตที่ถูกได้${bl.length ? `\n\nข้าม ${bl.length} เบอร์ที่เริ่มทำแล้ว: ${bl.join(", ")}` : ""}`, tone: "danger", confirmText: "ยกเลิกการปล่อย", cancelText: "กลับ" });
    if (!ok) return;
    try { const n = await api.unreleaseRows(chk.ok, (m) => setBusy(m)); setBusy(""); onDone(`ยกเลิกการปล่อย ${n} เบอร์ของ ${lot.no} แล้ว — ปล่อยใหม่ได้ที่ "ปล่อยล็อตใหม่"`); }
    catch (e) { setBusy(""); setErr("ยกเลิกไม่สำเร็จ (บางเบอร์อาจลบไปแล้ว — รีเฟรชดู): " + (e?.message || e)); }
  }
  return (
    <>
      <div className="rl-back" onClick={() => !busy && onClose()} />
      <aside className="rl-drawer rl-fix" role="dialog" aria-modal="true" aria-label={`ย้ายใบ / ยกเลิก ${lot.no}`}>
        <div className="rl-dr-head">
          <div className="rl-dr-title"><h2>ย้ายใบ / ยกเลิกการปล่อย · <span className="rw-mono">{lot.no}</span></h2></div>
          <button type="button" className="rl-x" onClick={onClose} disabled={!!busy} aria-label="ปิด">×</button>
        </div>
        <div className="rl-dr-sub">ติ๊กเบอร์ที่ปล่อยผิด → <b>ย้ายไปใบ</b> (QR เดิมใช้ต่อ) หรือ <b>ยกเลิกการปล่อย</b> (เฉพาะเบอร์ที่ยังไม่สแกน · ยอดกลับเป็น "เหลือ" ปล่อยใหม่ได้)</div>
        <div className="rl-fix-bar">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเบอร์ / รายละเอียด / ใบ" aria-label="ค้นหาเบอร์ในล็อต" />
          <span className="rw-muted small">เลือก <b>{sel.length}</b> / {rows.length}</span>
          <label className="rl-fix-act">ย้ายไปใบ <select className="select" value="" disabled={!sel.length || !opts.length || !!busy} onChange={(e) => { if (e.target.value) move(e.target.value); }} aria-label="ย้ายเบอร์ที่เลือกไปใบ">
            <option value="">{!sel.length ? "— ติ๊กเบอร์ก่อน —" : !opts.length ? "เลือกพาร์ท หรือ ซับ อย่างเดียว" : "— เลือกใบ —"}</option>{opts.map((x) => <option key={x.k} value={x.label}>{x.label}</option>)}</select></label>
          <button type="button" className="btn btn-sm rl-fix-del" disabled={!sel.length || !admin || !!busy} onClick={unrelease} title={admin ? "" : "ยกเลิกการปล่อย = แอดมิน"}>ยกเลิกการปล่อย {sel.length || ""}</button>
        </div>
        {err ? <div className="rw-msg bad">{err}</div> : null}
        {busy ? <div className="rw-msg info">{busy}</div> : null}
        <div className="rl-fix-tw"><table className="rl-sc-table rl-fix-t">
          <thead><tr>
            <th style={{ width: 34 }}><input type="checkbox" checked={vis.length > 0 && vis.every((r) => pick.has(r.id))} onChange={(e) => tog(vis.map((r) => r.id), e.target.checked)} aria-label="เลือกทั้งหมดที่เห็น" /></th>
            <th>เบอร์</th><th>รายละเอียด</th><th>ใบตอนนี้</th><th className="r">จำนวน</th>
          </tr></thead>
          <tbody>{vis.map((r) => (
            <tr key={r.id} className={pick.has(r.id) ? "on" : ""} onClick={() => tog([r.id], !pick.has(r.id))}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={pick.has(r.id)} onChange={(e) => tog([r.id], e.target.checked)} aria-label={`เลือก ${r.code}`} /></td>
              <td className="rw-mono"><b>{r.code}</b>{r.kind === "subassembly" ? <> <Pill tone="sub">ซับ</Pill></> : null}</td>
              <td className="rl-desc"><span>{descOf(r)}</span></td>
              <td><Pill tone={r.kind === "subassembly" ? "sub" : "part"}>{sheetName(r) || "—"}</Pill></td>
              <td className="r rw-num">{nf(r.qty)}</td>
            </tr>))}
            {!vis.length ? <tr><td colSpan={5} className="rw-muted">ไม่เจอ “{q}”</td></tr> : null}
          </tbody>
        </table></div>
      </aside>
    </>
  );
}

// ★ 2026-11-10 ตารางเปรียบเทียบของ Modify 1 ครั้ง: เบอร์ · รายละเอียด · เรื่องที่แก้ · ก่อน · หลัง · ผลต่อล็อต
function ModCompare({ m, need }) {
  const descOf = (c) => [...need.parts, ...need.subs, ...(need.hw || []), ...(need.glass || []), ...(need.other || [])].find((x) => NC(x.code) === NC(c))?.d || "";
  const nn = (v) => (v == null || v === "" ? "—" : typeof v === "number" ? nf(v, v % 1 ? 2 : 0) : String(v));
  const rows = [
    ...(m.bomEdits || []).map((e) => ({ code: e.code, where: `${e.scope === "panel" ? "แผง" : "ซับ"} ${e.owner}`, what: e.type === "qty" ? "จำนวน/ชุด" : e.type === "cancel" ? "ยกเลิกลูก" : e.type === "replace" ? "แก้เบอร์" : "เพิ่มลูก",
      before: e.type === "add" ? "—" : e.type === "replace" ? `${e.code} × ${nn(e.before ?? e.qty)}` : nn(e.before), after: e.type === "cancel" ? "ยกเลิก" : e.type === "replace" ? `${e.newCode} × ${nn(e.qty)}` : nn(e.qty), tone: e.type === "cancel" || e.type === "replace" ? "bad" : e.type === "add" ? "new" : "chg" })),
    ...m.items.filter((it) => !it.derived || m.items.length < 40).map((it) => ({ code: it.code, where: it.kind === "panel" ? `ที่อยู่ · แผง ${it.unit || ""}` : it.kind === "sub" ? "ซับ" : it.kind === "hw" ? "อุปกรณ์" : "พาร์ท",
      what: it.type === "qty" ? "จำนวนต้องใช้" : it.type === "cancel" ? "ยกเลิกเบอร์" : it.type === "addr" ? "ยกเลิกที่อยู่" : it.type === "mat" ? "วัสดุ (INV)" : it.type === "len" ? "ความยาว" : "เพิ่มเบอร์ใหม่",
      before: it.type === "add" ? "—" : it.type === "addr" ? "มี" : nn(it.before), after: it.type === "cancel" || it.type === "addr" ? "ยกเลิก" : nn(it.after) + (it.type === "add" ? ` ${it.kind === "sub" ? "SET" : it.kind === "hw" ? it.u || "pcs." : "ชิ้น"}` : ""),
      lots: (it.lots || []).map((l) => `${l.lot}: ${l.cancel ? `${nf(l.before)} → ยกเลิก` : `${nf(l.before)} → ${nf(l.after)}`}`).join(" · "), derived: it.derived,
      tone: it.type === "cancel" || it.type === "addr" ? "bad" : it.type === "add" ? "new" : "chg" })),
  ];
  // ★ 2026-11-11 ผู้ใช้: "ให้ไฮไลต์เบอร์ที่แก้ จะได้ดูง่าย ทำเป็น popup เหมือน M-000" → ตารางทุกเบอร์ในใบ (เหมือนป็อปอัพต้นฉบับ) · แถวที่ M นี้แตะ = ไฮไลต์ + ค่าเดิมขีดฆ่า → ค่าใหม่
  const [onlyChg, setOnlyChg] = useState(false);
  const chg = new Map();   // "p|CODE" / "s|CODE" → { qty, mat, len, add, cancel, lots }
  for (const it of m.items) {
    if (it.kind === "panel" || it.kind === "hw" || it.type === "addr") continue;
    const k = (it.kind === "sub" ? "s|" : "p|") + NC(it.code); const c = chg.get(k) || chg.set(k, { lots: [] }).get(k);
    if (it.type === "add") c.add = it; else if (it.type === "cancel") c.cancel = it; else if (it.type === "qty") c.qty = it; else if (it.type === "mat") c.mat = it; else if (it.type === "len") c.len = it;
    for (const l of it.lots || []) c.lots.push(`${l.lot}: ${l.cancel ? `${nf(l.before)} → ยกเลิก` : `${nf(l.before)} → ${nf(l.after)}`}`);
  }
  const all = [...need.parts.map((x) => ({ ...x, _k: "p|" + NC(x.code), _sub: false })), ...need.subs.map((x) => ({ ...x, _k: "s|" + NC(x.code), _sub: true }))];
  const seen = new Set(all.map((x) => x._k));
  for (const [k, c] of chg) if (!seen.has(k)) { const it = c.add || c.cancel || c.qty || c.mat || c.len; all.push({ code: it.code, d: "", qty: null, l: null, _k: k, _sub: k[0] === "s", _gone: true }); }
  const full = all.map((x) => ({ x, c: chg.get(x._k) || null })).sort((a, b) => (a.x._sub ? 1 : 0) - (b.x._sub ? 1 : 0) || ncmp(a.x.code, b.x.code));
  const shown = onlyChg ? full.filter((r) => r.c) : full;
  const nChg = full.filter((r) => r.c).length;
  const others = rows.filter((r) => !chg.has((r.where === "ซับ" ? "s|" : "p|") + NC(r.code)) || (r.where !== "ซับ" && r.where !== "พาร์ท"));
  const BA = ({ it, fmt = nn }) => <><s className="rl-old">{fmt(it.before)}</s> → <b className="rl-new">{fmt(it.after)}</b></>;
  const whatOf = (c) => [c.add && "เพิ่มเบอร์ใหม่", c.cancel && "ยกเลิกเบอร์", c.qty && "จำนวน", c.mat && "วัสดุ (INV)", c.len && "ความยาว"].filter(Boolean).join(" · ");
  return (
    <div className="rl-cmp">
      <div className="rl-cmp-bar">
        <span><b>{nf(nChg)}</b> เบอร์ที่ {m.ver} แก้ · จาก {nf(full.length)} เบอร์ในใบ</span>
        <span className="rl-cmp-seg"><button type="button" className={!onlyChg ? "on" : ""} onClick={() => setOnlyChg(false)}>ทุกเบอร์</button><button type="button" className={onlyChg ? "on" : ""} onClick={() => setOnlyChg(true)}>เฉพาะที่แก้</button></span>
      </div>
      <table className="rl-sc-table rl-cmp-t rl-cmp-full">
        <thead><tr><th>PART NO.</th><th>รายละเอียด</th><th className="r">จำนวน</th><th className="r">ความยาว/ชิ้น (มม.)</th><th>INV CODE</th><th>{m.ver} แก้อะไร</th><th>ล็อตที่ปล่อยแล้ว</th></tr></thead>
        <tbody>{shown.map(({ x, c }) => (
          <tr key={x._k} className={c ? `rl-cmp-hit ${c.cancel ? "bad" : c.add ? "new" : "chg"}` : "rl-cmp-plain"}>
            <td className="rw-mono"><b className={c && c.cancel ? "rl-cx" : ""}>{x.code}</b>{x._sub ? <> <Pill tone="sub">ซับ</Pill></> : null}</td>
            <td className="rl-desc"><span>{x.d || descOf(x.code)}</span></td>
            <td className="r rw-num">{c && c.cancel ? <><s className="rl-old">{nn(c.cancel.before)}</s> → <b className="rl-errtxt">ยกเลิก</b></> : c && c.qty ? <BA it={c.qty} /> : c && c.add ? <b className="rl-new">{nn(c.add.after)}</b> : x.qty == null ? "—" : nf(x.qty)}</td>
            <td className="r rw-num">{c && c.len ? <BA it={c.len} fmt={(v) => (v == null || v === "" ? "—" : String(v))} /> : x.l == null ? "-" : nlen(x.l)}</td>
            <td className="rw-mono">{c && c.mat ? <BA it={c.mat} fmt={(v) => v || "—"} /> : x._sub ? "" : x.inv || x.m || "-"}</td>
            <td className="small">{c ? <b>{whatOf(c)}</b> : null}</td>
            <td className="small rw-muted">{c && c.lots.length ? c.lots.join(" · ") : c ? "—" : ""}</td>
          </tr>))}
        </tbody>
      </table>
      {others.length ? <>
      <div className="rl-cmp-sub">แก้ BOM / ที่อยู่แผง / อุปกรณ์</div>
      <table className="rl-sc-table rl-cmp-t">
        <thead><tr><th>เบอร์</th><th>รายละเอียด</th><th>อยู่ที่</th><th>แก้อะไร</th><th className="r">ก่อน</th><th /><th>หลัง</th><th>ล็อตที่ปล่อยแล้ว</th></tr></thead>
        <tbody>{others.map((r, i) => (
          <tr key={i} className={`rl-cmp-${r.tone}`}>
            <td className="rw-mono"><b>{r.code}</b>{r.derived ? <span className="rw-muted small"> (ผลจากแก้ BOM)</span> : null}</td>
            <td className="rl-desc"><span>{descOf(r.code)}</span></td>
            <td className="small">{r.where}</td>
            <td className="small"><b>{r.what}</b></td>
            <td className="r rw-mono"><s className="rl-old">{r.before}</s></td>
            <td className="rw-muted">→</td>
            <td className="rw-mono"><b className={r.tone === "bad" ? "rl-errtxt" : "rl-new"}>{r.after}</b></td>
            <td className="small rw-muted">{r.lots || "—"}</td>
          </tr>))}
        </tbody>
      </table></> : null}
      <div className="rw-muted small">{m.sheet ? `ใบ Modify: ${m.sheet.roRaw || m.sheet.file || ""}${m.sheet.issuedBy ? ` · ออกโดย ${m.sheet.issuedBy}` : ""} · ` : ""}เขียว = เพิ่ม · ม่วง = แก้ · แดง = ยกเลิก</div>
    </div>
  );
}

// ★ 2026-11-10 แก้ Modify ที่บันทึกไปแล้ว — วันที่ / เหตุผล / ค่าของแต่ละรายการ / เอารายการออก
//   ล็อก: รายการที่ไปลด/ยกเลิก QR ในล็อตแล้ว (it.lots) · ผลจากแก้ BOM ลูก (derived) · แก้ BOM ลูก (bomEdits) → ต้องทำ Modify ใหม่
function ModEditor({ m, need, doneOf = () => 0, onCancel, onSave }) {
  const [date, setDate] = useState(m.date || "");
  const [reason, setReason] = useState(m.reason || "");
  const [items, setItems] = useState(() => m.items.map((it, i) => ({ ...it, _i: i, _del: false })));
  const descOf = (c) => [...need.parts, ...need.subs, ...(need.hw || [])].find((x) => NC(x.code) === NC(c))?.d || "";
  const locked = (it) => (it.lots || []).length ? `แก้ QR ในล็อต ${(it.lots || []).map((l) => l.lot).join(", ")} แล้ว` : it.derived ? "ผลจากแก้ BOM ลูก" : "";
  const editable = (it) => ["add", "qty", "mat", "len"].includes(it.type);
  const up = (i, patch) => setItems((a) => a.map((x) => (x._i === i ? { ...x, ...patch } : x)));
  // ★ 2026-11-10 เพิ่มรายการที่ M นี้ลืม (เช่น เปลี่ยน INV.CODE ของเบอร์อื่นด้วย) — เบอร์ในใบ: วัสดุ / ความยาว / จำนวนต้องใช้ · หรือเบอร์ใหม่
  const blankAdd = { code: "", field: "mat", val: "", d: "", l: "", inv: "" };
  const [nw, setNw] = useState(blankAdd);
  const codeList = [...need.parts.map((x) => ({ ...x, kind: "part" })), ...need.subs.map((x) => ({ ...x, kind: "sub" }))].filter((x) => !x.cancelled);
  const hit = codeList.find((x) => NC(x.code) === NC(nw.code));
  const curOf = (x, f) => (f === "mat" ? x.inv || "" : f === "len" ? x.l ?? "" : x.qty);
  const nwErr = !nw.code.trim() ? "" : nw.field === "new" ? (hit ? "เบอร์นี้มีในใบแล้ว — เลือกวัสดุ / ความยาว / จำนวน แทน" : !(Number(nw.val) > 0) ? "ใส่จำนวน" : "")
    : !hit ? "ไม่มีเบอร์นี้ในใบ (ถ้าเป็นเบอร์ใหม่ เลือก \"เบอร์ใหม่\")" : hit.kind === "sub" && nw.field === "mat" ? "ซับไม่มีวัสดุ" : nw.field === "mat" ? (!nw.val.trim() ? "ใส่ INV ใหม่" : "") : nw.field === "len" ? (!(Number(nw.val) > 0) ? "ใส่ความยาว" : "") : !(String(nw.val).trim() !== "" && Number(nw.val) >= 0) ? "ใส่จำนวน" : Number(nw.val) < doneOf(hit.code) ? `ปล่อยไปแล้ว ${nf(doneOf(hit.code))} — ลดต่ำกว่านี้ต้องทำ Modify ใหม่` : "";
  const dup = nw.code.trim() && items.some((x) => !x._del && NC(x.code) === NC(nw.code) && (nw.field === "new" ? x.type === "add" : x.type === nw.field));
  function addItem() {
    if (!nw.code.trim() || nwErr || dup) return;
    const i = Math.max(-1, ...items.map((x) => x._i)) + 1;
    const it = nw.field === "new"
      ? { kind: "part", type: "add", code: nw.code.trim().toUpperCase(), d: nw.d, l: nw.l === "" ? null : Number(nw.l), inv: nw.inv.trim().toUpperCase(), before: 0, after: nw.val, dest: undefined }
      : { kind: hit.kind, type: nw.field, code: hit.code, before: curOf(hit, nw.field), after: nw.val };
    setItems((a) => [...a, { ...it, _i: i, _del: false, _new: true }]); setNw(blankAdd);
  }
  const changed = date !== (m.date || "") || reason !== (m.reason || "") || items.some((x) => x._new || x._del || String(x.after) !== String(m.items[x._i]?.after));
  const bad = items.some((x) => !x._del && (x.type === "add" || x.type === "qty") && !(Number(x.after) >= 0 && String(x.after).trim() !== "")) || items.some((x) => !x._del && x.type === "len" && !(Number(x.after) > 0)) || !reason.trim();
  function save() {
    const kept = items.filter((x) => !x._del).map(({ _i, _del, _new, ...x }) => ({ ...x, after: x.type === "mat" ? String(x.after).trim().toUpperCase() : Number(x.after) }));
    const kept2 = items.filter((x) => !(x._new && x._del));
    const diff = kept2.filter((x) => x._new || x._del || String(x.after) !== String(m.items[x._i]?.after)).map((x) => (x._new ? `เพิ่ม ${x.code} (${x.type}) ${x.before ?? ""} → ${x.after}` : x._del ? `เอา ${x.code} (${x.type}) ออก` : `${x.code}: ${m.items[x._i].after} → ${x.after}`));
    if (date !== (m.date || "")) diff.push(`วันที่ ${m.date} → ${date}`);
    if (reason !== (m.reason || "")) diff.push("แก้เหตุผล");
    onSave({ ...m, date, reason: reason.trim(), items: kept, edited: [...(m.edited || []), { at: new Date().toISOString(), by: getSession()?.name || "", what: diff }] });
  }
  const [adding, setAdding] = useState(false);
  const typeName = (t) => ({ add: "เพิ่มเบอร์ใหม่", qty: "จำนวนต้องใช้", cancel: "ยกเลิกเบอร์", addr: "ยกเลิกที่อยู่", mat: "วัสดุ (INV)", len: "ความยาว" }[t] || t);
  const nEdit = items.filter((x) => !x._new && !x._del && String(x.after) !== String(m.items[x._i]?.after)).length;
  const nNew = items.filter((x) => x._new && !x._del).length, nDel = items.filter((x) => !x._new && x._del).length;
  const sumTxt = [nEdit && `แก้ค่า ${nEdit}`, nNew && `เพิ่ม ${nNew}`, nDel && `เอาออก ${nDel}`, (date !== (m.date || "") || reason !== (m.reason || "")) && "แก้หัว M"].filter(Boolean).join(" · ");
  return (
    <div className="rl-me">
      <div className="rl-me-head">
        <label className="rl-me-f"><span>วันที่ของ {m.ver}</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="rl-me-f grow"><span>เหตุผล *</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล *" /></label>
      </div>

      <div className="rl-me-tw"><table className="rl-me-t">
        <thead><tr><th>เบอร์</th><th>เปลี่ยนอะไร</th><th className="r">เดิม</th><th className="c" /><th>ค่าใน {m.ver}</th><th className="c" /></tr></thead>
        <tbody>
          {items.map((it) => { const lk = locked(it); const ed = !lk && editable(it) && !it._del; const dirty = !it._new && !it._del && String(it.after) !== String(m.items[it._i]?.after); return (
            <tr key={it._i} className={it._del ? "del" : it._new ? "new" : dirty ? "dirty" : ""}>
              <td><div className="rl-me-code">{it.code}{it._new ? <span className="rl-newtag">ใหม่</span> : null}</div><div className="rl-me-desc">{descOf(it.code) || it.d || ""}</div></td>
              <td><span className={`rl-me-type ${it.type}`}>{typeName(it.type)}</span></td>
              <td className="r rw-mono rl-me-old">{it.type === "add" ? "—" : String(it.before ?? "—")}</td>
              <td className="c rw-muted">→</td>
              <td>{ed ? <input className="input rl-me-in rw-mono" type={it.type === "mat" ? "text" : "number"} value={it.after} onChange={(e) => up(it._i, { after: it.type === "mat" ? e.target.value.toUpperCase() : e.target.value })} aria-label={`ค่าใหม่ ${it.code}`} />
                : <span className="rw-mono rl-me-val">{it.type === "cancel" || it.type === "addr" ? "ยกเลิก" : String(it.after)}</span>}
                {lk ? <div className="rl-me-lock">🔒 {lk}</div> : null}</td>
              <td className="c">{lk ? null : it._del
                ? <button type="button" className="rl-me-act" onClick={() => up(it._i, { _del: false })} title="เอากลับ" aria-label={`เอา ${it.code} กลับ`}>↺</button>
                : <button type="button" className="rl-me-act del" onClick={() => (it._new ? setItems((a) => a.filter((x) => x._i !== it._i)) : up(it._i, { _del: true }))} title="เอาออก" aria-label={`เอา ${it.code} ออก`}>✕</button>}</td>
            </tr>); })}
          {adding ? (
            <tr className="adding">
              <td><input className="input rl-me-in rw-mono" list={`medit-codes-${m.ver}`} placeholder="เบอร์ (พิมพ์ / เลือก)" value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value.toUpperCase() })} aria-label="เบอร์ที่จะเพิ่มใน M" autoFocus />
                <datalist id={`medit-codes-${m.ver}`}>{codeList.map((x) => <option key={x.code} value={x.code}>{x.d}</option>)}</datalist>
                {hit ? <div className="rl-me-desc">{hit.d}</div> : null}</td>
              <td><select className="select rl-me-sel" value={nw.field} onChange={(e) => setNw({ ...nw, field: e.target.value, val: "" })} aria-label="เปลี่ยนอะไร">
                <option value="mat">วัสดุ (INV)</option><option value="len">ความยาว</option><option value="qty">จำนวนต้องใช้</option><option value="new">เบอร์ใหม่ (ไม่มีในใบ)</option></select></td>
              <td className="r rw-mono rl-me-old">{nw.field === "new" ? "—" : hit ? String(curOf(hit, nw.field) || "—") : ""}</td>
              <td className="c rw-muted">→</td>
              <td><input className="input rl-me-in rw-mono" type={nw.field === "mat" ? "text" : "number"} placeholder={nw.field === "mat" ? "INV ใหม่" : nw.field === "len" ? "ความยาวใหม่" : "จำนวน"} value={nw.val} onChange={(e) => setNw({ ...nw, val: nw.field === "mat" ? e.target.value.toUpperCase() : e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") addItem(); }} aria-label="ค่าใหม่" />
                {nw.field === "new" ? <div className="rl-me-newf">
                  <input className="input" placeholder="รายละเอียด" value={nw.d} onChange={(e) => setNw({ ...nw, d: e.target.value })} aria-label="รายละเอียดเบอร์ใหม่" />
                  <input className="input rw-mono" type="number" placeholder="ยาว (มม.)" value={nw.l} onChange={(e) => setNw({ ...nw, l: e.target.value })} aria-label="ความยาวเบอร์ใหม่" />
                  <input className="input rw-mono" placeholder="INV" value={nw.inv} onChange={(e) => setNw({ ...nw, inv: e.target.value.toUpperCase() })} aria-label="INV เบอร์ใหม่" />
                </div> : null}
                {nw.code.trim() && (nwErr || dup) ? <div className="rl-me-err">{dup ? "มีรายการนี้ใน M แล้ว — แก้ค่าในตารางด้านบน" : nwErr}</div> : null}</td>
              <td className="c"><button type="button" className="rl-me-act ok" onClick={addItem} disabled={!nw.code.trim() || !!nwErr || dup} title="เพิ่ม" aria-label="เพิ่มรายการ">✓</button>
                <button type="button" className="rl-me-act" onClick={() => { setAdding(false); setNw(blankAdd); }} title="ยกเลิก" aria-label="ยกเลิกการเพิ่ม">✕</button></td>
            </tr>) : null}
        </tbody>
      </table></div>
      {!adding ? <button type="button" className="rl-me-addbtn" onClick={() => setAdding(true)}>+ เพิ่มรายการใน {m.ver} <small>เปลี่ยนวัสดุ / ความยาว / จำนวนของเบอร์อื่น · หรือเบอร์ใหม่</small></button> : null}
      {(m.bomEdits || []).length ? <div className="rl-me-lock">🔒 แก้ BOM ลูก {m.bomEdits.length} จุดใน {m.ver} แก้ที่นี่ไม่ได้ — ทำ Modify ใหม่เพื่อแก้กลับ</div> : null}

      <div className="rl-me-foot">
        <div className="rl-me-sum">{bad ? <span className="rl-errtxt">{!reason.trim() ? "ใส่เหตุผล" : "ใส่ค่าให้ครบ (จำนวน ≥ 0 · ความยาว > 0)"}</span> : changed ? <><b>{sumTxt}</b><span className="rw-muted"> · ล็อตที่ปล่อยแล้วไม่เปลี่ยน · ยอดในใบคำนวณใหม่</span></> : <span className="rw-muted">ยังไม่ได้แก้อะไร</span>}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>ยกเลิก</button>
        <button type="button" className="btn btn-accent btn-sm" disabled={!changed || bad} onClick={save}>บันทึกการแก้ {m.ver}</button>
      </div>
    </div>
  );
}

// ★ 2026-11-11 ป็อปอัพความคืบหน้าทั้ง Release: การ์ดสรุป (ทั้งใบ / ตามใบงาน / ตามล็อต) + ตารางรายการ เรียงจากที่ทำได้น้อยสุด
//   ผลิตแล้ว = ยอดจากหน้าเครื่อง (prod: release_id → ชิ้น) · ไม่นับแถวที่ Modify ยกเลิก · เบอร์เดียวกันหลายล็อตรวมกัน
function ProgressPop({ plan, need, rel, prod, rowSheets, onClose, onOpenLot, initQ = "" }) {
  const [big, setBig] = useState(false);   // ขยายเต็มจอ
  // ★ 2026-11-11 ลากขอบซ้าย / ขวา / ล่าง / มุมล่าง เพื่อย่อ-ขยาย (ป็อปอัพอยู่กลางจอ → ลากขอบข้าง = กว้างขึ้นสองฝั่ง) · จำขนาดไว้
  const [size, setSize] = useState(() => { try { return JSON.parse(localStorage.getItem("rl-pop-size") || "null"); } catch { return null; } });
  const popRef = useRef(null);
  const startDrag = (dir) => (e) => {
    if (big || !popRef.current) return; e.preventDefault();
    const r = popRef.current.getBoundingClientRect(); const x0 = e.clientX, y0 = e.clientY; let last = { w: r.width, h: r.height };
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      const w = dir.includes("e") ? r.width + 2 * dx : dir.includes("w") ? r.width - 2 * dx : r.width;
      const h = dir.includes("s") ? r.height + dy : r.height;
      last = { w: Math.max(520, Math.min(window.innerWidth - 16, w)), h: Math.max(320, Math.min(window.innerHeight - r.top - 8, h)) }; setSize(last);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.userSelect = ""; try { localStorage.setItem("rl-pop-size", JSON.stringify(last)); } catch { /* ignore */ } };
    document.body.style.userSelect = "none"; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const [flt, setFlt] = useState(initQ ? "all" : "left");
  const [q, setQ] = useState(initQ);
  const data = useMemo(() => {
    const items = new Map(), sheets = new Map(), lots = [];
    for (const L of rel.lots) {
      if (L.hwOnly) continue; let ld = 0, lt = 0;
      for (const r of L.rows) {
        if (r.mod_cancelled_at) continue; const qy = Number(r.qty) || 0; if (!qy) continue;
        const m = prod ? Math.min(qy, prod.get(String(r.id)) || 0) : 0; ld += m; lt += qy;
        const sk = rowSheets(r)[0] || (r.kind === "panel" ? "panel" : "—");
        const key = r.kind + "|" + NC(r.code);
        const it = items.get(key) || items.set(key, { code: r.code, kind: r.kind, qty: 0, made: 0, lots: [], sheet: sk, uw: null, len: null, inv: "", notes: [] }).get(key);
        it.qty += qy; it.made += m; if (!it.lots.includes(L.no)) it.lots.push(L.no);
        if (it.uw == null && Number(r.unit_weight) > 0) it.uw = Number(r.unit_weight); if (it.len == null && Number(r.length_mm) > 0) it.len = Number(r.length_mm); if (!it.inv && r.material) it.inv = r.material;
        const sh = sheets.get(sk) || sheets.set(sk, { k: sk, qty: 0, made: 0, codes: new Set() }).get(sk);
        sh.qty += qy; sh.made += m; sh.codes.add(key);
      }
      lots.push({ no: L.no, made: ld, qty: lt });
    }
    const list = [...items.values()];
    return { list, sheets: SHEETS.filter((x) => sheets.has(x.k)).map((x) => ({ ...sheets.get(x.k), label: x.label })), lots, made: list.reduce((a, x) => a + x.made, 0), qty: list.reduce((a, x) => a + x.qty, 0) };
  }, [rel, prod]);   // eslint-disable-line react-hooks/exhaustive-deps
  const descOf = (it) => (it.kind === "panel" ? "แผง" : (it.kind === "subassembly" ? need.subs : need.parts).find((x) => NC(x.code) === NC(it.code))?.d || "");
  const pc = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const left = data.list.filter((x) => x.made < x.qty), done = data.list.filter((x) => x.made >= x.qty);
  const ql = q.trim().toUpperCase();
  const wait = data.list.filter((x) => !x.made), doing = data.list.filter((x) => x.made > 0 && x.made < x.qty);
  const rows = (flt === "left" ? left : flt === "done" ? done : flt === "wait" ? wait : flt === "doing" ? doing : data.list).filter((x) => !ql || x.code.toUpperCase().includes(ql) || descOf(x).toUpperCase().includes(ql)).sort((a, b) => a.made / a.qty - b.made / b.qty || ncmp(a.code, b.code));
  const Bar = ({ m, t }) => <div className={`rl-pp-bar ${m >= t && t ? "full" : ""}`}><i><b style={{ width: `${pc(m, t)}%` }} /></i><span>{nf(m)} / {nf(t)}</span></div>;
  const stOf = (x) => (x.made >= x.qty ? ["full", "เสร็จ"] : x.made > 0 ? ["part", "กำลังทำ"] : ["zero", "รอเริ่ม"]);
  return (
    <>
      <div className="rl-back" onClick={onClose} />
      <div ref={popRef} className={`rl-pop ${big ? "big" : ""}`} role="dialog" aria-modal="true" aria-label={`ความคืบหน้า ${plan.ro}`} style={!big && size ? { width: size.w, height: size.h } : undefined}>
        {big ? null : ["w", "e", "s", "sw", "se"].map((d) => <div key={d} className={`rl-pop-rz ${d}`} onPointerDown={startDrag(d)} aria-hidden="true" />)}
        <div className="rl-pop-h"><h2>Release {plan.ro} ทำไปแค่ไหนแล้ว</h2><span className="rw-muted small">ผลิตแล้ว = นับจากหน้าเครื่อง · เฉพาะของที่ปล่อยแล้ว · รวมทุกล็อต</span><button type="button" className="rl-x rl-pop-max" onClick={() => setBig((v) => !v)} aria-label={big ? "ย่อหน้าต่าง" : "ขยายเต็มจอ"} title={big ? "ย่อหน้าต่าง" : "ขยายเต็มจอ"}>{big ? "❐" : "□"}</button><button type="button" className="rl-x" onClick={onClose} aria-label="ปิด">×</button></div>
        {!prod ? <div className="rw-msg warn">ยังโหลดยอดผลิตไม่ได้ (หรือยังไม่ได้ติดตั้งส่วน Modify) — ตัวเลขผลิตแล้วจะเป็น 0</div> : null}
        <div className="rl-pop-body">
          <div className="rl-pp-cards">
            <div className="rl-pp-card main"><div className="rl-pp-card-t"><b>ทั้งใบ</b><span>{pc(data.made, data.qty)}%</span></div><small>ผลิตแล้ว {nf(data.made)} / {nf(data.qty)} ชิ้น · {nf(data.list.length)} รายการ</small><Bar m={data.made} t={data.qty} /></div>
            {data.sheets.map((sh) => <div key={sh.k} className="rl-pp-card"><div className="rl-pp-card-t"><b>{sh.label}</b><span>{pc(sh.made, sh.qty)}%</span></div><small>{nf(sh.codes.size)} {sh.k === "panel" ? "แบบ" : "เบอร์"}</small><Bar m={sh.made} t={sh.qty} /></div>)}
            <div className="rl-pp-card"><div className="rl-pp-card-t"><b>ตามล็อต</b></div>
              <div className="rl-pp-lots">{[...data.lots].reverse().map((L) => <div key={L.no}>{onOpenLot ? <button type="button" className="rw-link rw-mono" onClick={() => onOpenLot(L.no)}>{L.no}</button> : <span className="rw-mono">{L.no}</span>}<Bar m={L.made} t={L.qty} /></div>)}</div></div>
          </div>
          <div className="rl-pp-tools">
            <b>รายละเอียดแต่ละรายการ</b>
            <div className="rl-pp-status"><span>สถานะ</span>
              {[["all", "ทั้งหมด", data.list.length, ""], ["left", "ยังค้าง", left.length, ""], ["wait", "Pending", wait.length, "zero"], ["doing", "In Process", doing.length, "part"], ["done", "Finish", done.length, "full"]].map(([k, l, n, c]) => <button key={k} type="button" className={`rl-pp-chip ${flt === k ? "on" : ""}`} onClick={() => setFlt(k)}>{c ? <i className={c} /> : null}{l} <small>{nf(n)}</small></button>)}</div>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเบอร์ / รายละเอียด" aria-label="ค้นหารายการ" />
          </div>
          <div className="rl-pp-tw"><table className="rl-pp-t">
            <thead><tr><th className="r">ITEM</th><th>PART NO.</th><th className="r">QTY</th><th>FINISHED</th><th>PROGRESS</th><th className="r">WEIGHT/PC (KG)</th><th className="r">TOTAL WEIGHT (KG)</th><th className="r">LENGTH/PC (MM)</th><th>INV CODE</th><th>ใบงาน</th><th>ล็อต</th></tr></thead>
            <tbody>{rows.map((x, i) => { const [c] = stOf(x); const np = x.kind === "part" ? need.parts.find((p) => NC(p.code) === NC(x.code)) : x.kind === "subassembly" ? need.subs.find((p) => NC(p.code) === NC(x.code)) : null;
              const len = x.len ?? np?.l ?? null, inv = x.inv || np?.inv || ""; return (
              <tr key={x.kind + x.code}>
                <td className="r rw-muted">{i + 1}</td>
                <td><div className="rl-pp-pn"><b>{x.code}</b><span className={`rl-pp-st ${c}`}>{c === "full" ? "Finish" : c === "part" ? "In Process" : "Pending"}</span></div><div className="rw-muted small">{descOf(x)}</div></td>
                <td className="r">{nf(x.qty)}</td>
                <td className={c === "zero" ? "" : "rl-pp-fin"}>{nf(x.made)} ชิ้น</td>
                <td><div className={`rl-pp-prog ${c}`}><i><b style={{ width: `${pc(x.made, x.qty)}%` }} /></i><b>{pc(x.made, x.qty)}%</b><span>({nf(x.made)}/{nf(x.qty)})</span></div></td>
                <td className="r">{x.uw ? nlen(x.uw) : "-"}</td><td className="r">{x.uw ? nlen(Math.round(x.uw * x.qty * 100) / 100) : "-"}</td>
                <td className="r">{len != null ? nlen(len) : "-"}</td><td>{inv || "-"}</td>
                <td className="small">{sheetOf(x.sheet).label}</td>
                <td className="small">{x.lots.map((l) => (onOpenLot ? <button key={l} type="button" className="rw-link rw-mono" style={{ marginRight: 6 }} onClick={() => onOpenLot(l)}>{l}</button> : <span key={l} className="rw-mono" style={{ marginRight: 6 }}>{l}</span>))}</td>
              </tr>); })}
              {!rows.length ? <tr><td colSpan={11} className="rw-muted">{flt === "left" ? "ไม่มีรายการค้าง — ผลิตครบทุกรายการที่ปล่อยแล้ว" : "ไม่มีรายการ"}</td></tr> : null}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}

export function ReleasePlansCard({ plans, releases, onOpen }) {
  const rows = useMemo(() => (plans || []).map((p) => {
    const need = needOf(p); const rel = releasedOf(releases, p);
    const live = p.units.filter((u) => !need.cancelledAddr[addrKey(u.addr)]);
    const addr = live.filter((u) => rel.addrLot.has(String(u.addr).toUpperCase())).length;
    const left = need.parts.filter((x) => (rel.byCode.get(NC(x.code))?.qty || 0) < x.qty).length + need.subs.filter((x) => (rel.byCode.get(NC(x.code))?.qty || 0) < x.qty).length + (live.length - addr);
    return { p, need, rel, addr, left };
  }).sort((a, b) => ncmp(b.p.ro, a.p.ro)), [plans, releases]);
  // ★ 2026-11-04 ผู้ใช้: "ปล่อยครบแล้วไม่ใช่หรอ" — การ์ดนี้แสดงเฉพาะที่ยังเหลือ · ที่ปล่อยครบพับไว้ (กดดูได้ · เปิดจากรายการ Release ปกติได้เหมือนเดิม)
  // ★ 2026-11-04 ผู้ใช้: "P-241 หายไปไหน" — การ์ดนี้เป็นทางเข้าหน้า Release หลัก (Total / ปล่อยล็อต) จึงต้องมีทุกใบ
  //   ยังเหลือ = ขึ้นก่อน · ปล่อยครบ = ต่อท้าย (ป้ายเขียว)
  const pending = rows.filter((r) => r.left > 0);
  const shown = [...pending, ...rows.filter((r) => r.left <= 0)];
  if (!rows.length) return null;
  return (
    <div className="card rl-planscard">
      <div className="card-head"><div><div className="card-title">Release (ใบหลัก){pending.length ? ` · ยังปล่อยไม่ครบ ${nf(pending.length)}` : ""}</div><div className="card-sub">กดเปิดเพื่อดู Total · BOM · ล็อตที่ปล่อย · ปล่อยล็อตใหม่ (P-xxx.1 / .2 …)</div></div></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Release</th><th>โปรเจค</th><th>วันที่</th><th style={{ textAlign: "right" }}>แผงปล่อยแล้ว</th><th style={{ textAlign: "right" }}>ล็อต</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{!shown.length ? <tr><td colSpan={7} className="rw-muted" style={{ padding: 14 }}>ปล่อยครบทุกใบแล้ว</td></tr> : null}{shown.map(({ p, rel, addr, left }) => (
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

// ค้นหาในล็อต: เบอร์ / รายละเอียด / ที่อยู่แผง (qq = ตัวพิมพ์ใหญ่แล้ว)
const rowHit = (r, qq, descOf) => String(r.code).toUpperCase().includes(qq) || String(descOf(r.code) || "").toUpperCase().includes(qq) || (r.kind === "panel" && addrsFromNote(r.note).some((a) => a.includes(qq)));
// ไฮไลต์คำที่ค้น (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
function Hl({ t, q }) {
  const s = String(t ?? ""); if (!q) return s;
  const i = s.toUpperCase().indexOf(q); if (i < 0) return s;
  return <>{s.slice(0, i)}<mark className="rl-hl">{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
}
// ปุ่มพิมพ์ QR ของล็อต — แยกตามแผนกของหน้าพิมพ์ QR (พาร์ท = Machine · ซับ = Sub-Assembly · แผง = Assembly)
const QR_GROUPS = [
  { k: "part", label: "พาร์ท", th: "พาร์ท", kinds: ["part"] },
  { k: "sub", label: "ซับ", th: "ซับ", kinds: ["subassembly"] },
  { k: "panel", label: "แผง", th: "แผง", kinds: ["panel"] },
];
// ★ วัสดุของล็อต (ใบเบิก · ไม่มี QR) — วัตถุดิบงานตัด · GLASS · ACCESSORIES · อื่นๆ (เฉพาะของที่ปล่อยในล็อตนี้)
const hwQ = (h) => (h.u === "m." && h.mm ? h.qty / 1000 : h.qty);
// เศษ ≥ 500 มม.: ความยาวซ้ำรวมกัน → "1,230 ×2 · 640"
const offTxt = (lens) => { const m = new Map(); for (const x of lens || []) m.set(x, (m.get(x) || 0) + 1); return [...m].map(([l, n]) => `${nf(l)}${n > 1 ? ` ×${n}` : ""}`).join(" · "); };
const insteadOf = (x) => { const f = [...new Set([x.from, ...(x.froms || [])].filter((c) => c && c !== x.code))]; return f.length ? <div className="rw-muted small">ใช้แทน {f.join(", ")}</div> : null; };
export function LotMats({ plan, need, lot, sheetsOf, q = "", onPlanChange = null }) {
  // ★ ยอดเบิกจริงต่อล็อต (ACTUAL ISSUE) — เก็บใน plan.lotIssue[เลขล็อต][INV] = { n, r } · ว่าง = ใช้ยอดคำนวณ · ใส่ลงใบเบิกด้วย
  const iss = (plan.lotIssue || {})[lot.no] || {};
  const setIss = (key, patch) => onPlanChange && onPlanChange({ ...plan, lotIssue: { ...(plan.lotIssue || {}), [lot.no]: { ...iss, [key]: { ...(iss[key] || {}), ...patch } } } });
  const issued = (x) => { const v = iss[x.inv || "—"]?.n; return v === "" || v == null ? null : Number(v); };
  const m0 = useMemo(() => lotMaterials(plan, need, lot.rows, sheetsOf, lot.no), [plan, need, lot]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ค้นหา: รหัส / INV / รายละเอียด / เบอร์พาร์ทที่ใช้วัตถุดิบนั้น
  const has = (...xs) => !q || xs.some((x) => String(x || "").toUpperCase().includes(q));
  const m = q ? { mat: m0.mat.filter((x) => has(x.inv, x.d, ...x.parts.map((p) => p.code))), glass: m0.glass.filter((x) => has(x.code, x.d)), hw: m0.hw.filter((x) => has(x.code, x.d)), other: m0.other.filter((x) => has(x.code, x.d)) } : m0;
  const cards = [];
  if (m.mat.length) cards.push(
    <section key="mat" className="rl-sc mat wide">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>วัตถุดิบงานตัด</b><span>MATERIAL LIST FOR CUTTING · จากพาร์ท MACHINING ในล็อต</span></div>
        <div className="rl-sc-n"><b>{nf(m.mat.reduce((a, x) => a + x.bars, 0))}</b> เส้น<small> · {nf(m.mat.length)} รายการ · เศษ {nf(m.mat.reduce((a, x) => a + x.off, 0))} ชิ้น{m.mat.some((x) => issued(x) != null) ? ` · เบิกจริง ${nf(m.mat.reduce((a, x) => a + (issued(x) ?? x.bars), 0))} เส้น` : ""}</small></div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>วัตถุดิบ (INV)</th><th>รายละเอียด</th><th className="r">ยาวเส้น</th><th className="r">ใช้กับ</th><th className="r">เส้น</th><th className="r" title="เศษที่เหลือยาว ≥ 500 มม. หลังตัดล็อตนี้ (เก็บใช้ต่อได้) · คิดแบบเส้นใหม่ทุกล็อต">เศษ ≥ 500 มม.</th>
          <th className="r" title="ยอดเบิกจริงของล็อตนี้ (เส้น) · ว่าง = ใช้ยอดคำนวณ · ใส่ลงช่อง ACTUAL ISSUE ในใบเบิก">เบิกจริง</th><th>หมายเหตุเบิก</th></tr></thead>
        <tbody>{m.mat.map((x) => (
          <tr key={x.inv || "—"}>
            <td className="rl-sc-code">{x.inv || <><span className="rl-cxq">ไม่มี INV</span><div className="rw-muted small rl-noinv" title="พาร์ทเหล่านี้ไม่มีรหัสวัตถุดิบ (INV.CODE) — ใส่ได้ที่ Total Part ช่อง MATERIAL (✎) หรือแก้ในคลังซับ/พาร์ท">{x.parts.map((p) => <span key={p.code} className="rl-noinv-c">{p.code} ×{nf(p.qty)}</span>)}</div></>}{x.origs && x.origs.length ? <div className="rw-muted small" title={x.note || ""}>เปลี่ยนจากแบบ: {x.origs.join(", ")}</div> : null}</td>
            <td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td>
            <td className="r rl-sc-q rl-sc-thin">{nf(x.stock)}{x.src === "default" ? <> <Pill tone="warn" title="ไม่รู้ความยาวเส้น — ใช้ค่าเริ่ม">?</Pill></> : null}</td>
            <td className="r rl-sc-q rl-sc-thin" title={x.parts.map((p) => `${p.code} × ${p.qty}`).join("\n")}>{nf(x.parts.length)} เบอร์ · {nf(x.pcs)} ชิ้น{x.noLen ? <> <Pill tone="warn" title="พาร์ทไม่มีความยาวใน BOM — ไม่ได้นับในเส้น">ไม่มียาว {nf(x.noLen)}</Pill></> : null}{x.over ? <> <Pill tone="bad">ยาวกว่าเส้น {nf(x.over)}</Pill></> : null}</td>
            <td className="r rl-sc-q">{nf(x.bars)}</td>
            <td className="r rl-sc-off" title={x.off ? `เศษ ${x.off} ชิ้น (มม.): ${offTxt(x.offLens)}` : "ไม่มีเศษยาว ≥ 500 มม."}>{x.off ? <><b>{nf(x.off)}</b><small>{offTxt(x.offLens)}</small></> : <span className="rw-muted">—</span>}</td>
            {(() => { const key = x.inv || "—"; const mi = iss[key] || {}; const v = issued(x); return onPlanChange ? <>
              <td className="r rl-sc-iss"><input className={`input rw-cell rl-iss ${v != null && v !== x.bars ? "diff" : ""}`} type="number" min="0" step="1" inputMode="numeric" value={mi.n ?? ""} placeholder={String(x.bars)} onChange={(e) => setIss(key, { n: e.target.value })} aria-label={`เบิกจริง ${key} ล็อต ${lot.no}`} /></td>
              <td className="rl-sc-iss"><input className="input rw-cell rl-iss-r" value={mi.r || ""} placeholder="—" title="เช่น ใช้เศษ 2 เส้น / ใช้เส้น 6.3 ม." onChange={(e) => setIss(key, { r: e.target.value })} aria-label={`หมายเหตุเบิก ${key}`} /></td>
            </> : <><td className="r rl-sc-q">{v != null ? nf(v) : <span className="rw-muted">—</span>}</td><td className="rw-muted small">{mi.r || ""}</td></>; })()}
          </tr>))}</tbody>
      </table></div>
      <div className="rl-sc-foot">คิดแบบเส้นใหม่ทุกล็อต (ไม่นับเศษจากล็อตก่อน) · เศษ = ความยาวที่เหลือหลังตัด ≥ 500 มม. (หักรอยตัดแล้ว) เก็บไว้ใช้ต่อได้{onPlanChange ? " · เบิกจริง: กรอกเมื่อเบิกไม่ตรงยอดคำนวณ (ว่าง = ตามคำนวณ) — บันทึกอัตโนมัติ และใส่ลงใบเบิก" : ""}</div>
    </section>);
  if (m.glass.length) cards.push(
    <section key="glass" className="rl-sc mat">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>GLASS</b><span>กระจก · จาก BOM แผง/ซับในล็อต</span></div>
        <div className="rl-sc-n"><b>{nf(m.glass.reduce((a, x) => a + x.qty, 0))}</b> แผ่น<small> · {nf(m.glass.length)} เบอร์</small></div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>เบอร์ (CODE)</th><th>รายละเอียด</th><th className="r">ขนาด (มม.)</th><th className="r">จำนวน</th></tr></thead>
        <tbody>{m.glass.map((x) => (
          <tr key={x.code}><td className="rl-sc-code">{x.code}{insteadOf(x)}</td><td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td>
            <td className="r rl-sc-q rl-sc-thin">{x.l || x.h ? `${nlen(x.l) || "?"} × ${nlen(x.h) || "?"}` : "—"}</td><td className="r rl-sc-q">{nf(x.qty)}</td></tr>))}</tbody>
      </table></div>
    </section>);
  if (m.hw.length) cards.push(
    <section key="hw" className="rl-sc mat">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>ACCESSORIES</b><span>FASTENER, GASKET &amp; SILICONE · จาก BOM แผง/ซับในล็อต{m.hw.some((x) => x.picked) ? " + ที่เลือกเบิกในล็อตนี้" : ""}</span></div>
        <div className="rl-sc-n"><b>{nf(m.hw.length)}</b> รายการ</div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>เบอร์ (CODE)</th><th>รายละเอียด</th><th className="r">จำนวน</th></tr></thead>
        <tbody>{m.hw.map((x) => (
          <tr key={x.code}><td className="rl-sc-code">{x.code}{insteadOf(x)}</td><td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td>
            <td className="r rl-sc-q">{x.u === "m." || x.u === "mm." ? nlen(Math.round(hwQ(x) * 100) / 100) : nf(hwQ(x))} <small className="rw-muted">{x.u || (x.mm ? "mm." : "pcs.")}</small></td></tr>))}</tbody>
      </table></div>
    </section>);
  if (m.other.length) cards.push(
    <section key="other" className="rl-sc mat">
      <header className="rl-sc-h"><div className="rl-sc-t"><b>อื่นๆ</b><span>VENT / ENCLOS / ที่ไม่มี QR</span></div><div className="rl-sc-n"><b>{nf(m.other.length)}</b> รายการ</div></header>
      <div className="rl-sc-tw"><table className="rl-sc-table">
        <thead><tr><th>เบอร์ (CODE)</th><th>รายละเอียด</th><th className="r">จำนวน</th></tr></thead>
        <tbody>{m.other.map((x) => <tr key={x.code}><td className="rl-sc-code">{x.code}{insteadOf(x)}</td><td className="rl-sc-desc" title={x.d}>{x.d || <span className="rw-muted">—</span>}</td><td className="r rl-sc-q">{nf(x.qty)}</td></tr>)}</tbody>
      </table></div>
    </section>);
  if (q && !cards.length) return null;   // ค้นหาแล้วไม่เจอในวัสดุ → ซ่อนทั้งส่วน
  return (
    <div className="rl-lot-mats">
      <div className="rl-lot-mats-h"><b>วัสดุของล็อตนี้</b><span>ใบเบิก · ไม่มี QR · คิดเฉพาะของที่ปล่อยในล็อต {lot.no}</span></div>
      {cards.length ? <div className="rl-sc-grid">{cards}</div> : <div className="rw-muted small rl-lot-mats-empty">ล็อตนี้ไม่มีวัสดุเบิก (ไม่มีพาร์ท MACHINING และ BOM ของแผง/ซับในล็อตไม่มีกระจก / อุปกรณ์)</div>}
    </div>);
}
