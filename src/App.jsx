import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, Component, Fragment } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  listRows, insertRow, insertRows, updateRow, updateRows, deleteRow, deleteRows,
  deleteReleaseCascade, deleteProjectCascade, getProjectImpact,
  findUnitByQr, getUnitHistory, getScanLogsBetween, getAssemblyLogsBetween, getAllUnitsFull, getReleasesFull,
  deleteCap, setMachineOps, getUnitStatsByReleaseIds, getReleaseOpProgress, getReleaseMachineProgress, getReleaseMaterialLengths, setReleaseMachineStatus, setReleaseMaterialLength, setScanQuantity, setScanMeta, editScan, setReleaseMachineDone, supabase,
  getColumnPrefs, setColumnPref, setColumnPrefsBulk, clearColumnPref, clearColumnPrefs,
  getReleaseModifyInfo, applyReleaseModify, revertReleaseModify, setReleaseModDate, getReleaseMachineStatus,
  getMaterials, saveMaterial, upsertMaterials, deleteMaterial, addMaterialsFromRelease, backfillMaterials,
  machineReportSummary, listScanSlow,
  recordScan, recordScanByQr, scanQueueCount, onScanQueue, flushScanQueue,
  createReleaseBatch, releaseOrderExists, upsertEmployee, getProjectSummary, getProjectStationProgress, getPartSummary, getEmployees,
  logoutSession, setEmployeeActive, deleteEmployee, deleteMachine, recalcPartStatus, sessionHeartbeat,
  listActiveSessions, forceLogoutSession, updateReleaseHeader, auditRecord, listAuditLog, changeMyPassword,
  listDeadLetter, resolveDeadLetter, setBom, getBom, setPkgManifest, createOperation, setOperationType,
  getAssemblyState, listAssemblyParents, getUnitsByIds,
  exportAllData, clearScansRelease, clearScansUnit, clearScansReleaseGroup,
  ensureDailyBackup, listBackups, snapshotAllProjects, restoreBackup, importBackup,
} from "./supabase.js";
import { ROLE_LABELS, getSession, setSession, clearSession, verifyLogin, appLogin, isAdmin, canManage } from "./auth.js";
import { enterFullscreen } from "./fullscreen.js";
import { printLabels, LABEL_PRESETS } from "./labels.js";
import { useUpdateReady, applyUpdate } from "./updatePrompt.js";
import { useLang } from "./i18n-dom.js";

// ── Ctrl+Z ย้อนการแก้ไขที่ยังไม่บันทึก (ทั้งแอปฝั่งสำนักงาน) ──────────────────────
// ใช้ useUndoable แทน useState ในฟอร์ม/ตาราง → เก็บประวัติ state (สูงสุด 50 ขั้น)
// กด Ctrl/Cmd+Z จะย้อน "ฟอร์มที่เพิ่งแก้ล่าสุด" (ยึดลำดับการแก้ ไม่ใช่โฟกัส)
//   • ถ้ากำลังพิมพ์ในช่องข้อความ → ปล่อยให้เบราว์เซอร์ undo ตัวอักษรเองตามปกติ
//   • dropdown / ปุ่มเลือก (chip) / ตัวเพิ่ม-ลด ที่ไม่มี undo ในตัว → ใช้ตัวนี้ย้อน
const _undoers = [];              // ฟอร์มที่ลงทะเบียนไว้ (ท้ายสุด = แก้ล่าสุด)
let _undoKeyOn = false;
let _editSeq = 0;                 // ลำดับการแก้ไข (นับขึ้นเรื่อยๆ) — ใช้กันย้อนฟอร์มที่ซ่อนหลัง modal
const _modalStack = [];           // _editSeq ตอนที่แต่ละ modal เปิด (ล่าสุด = บนสุด)
function _installUndoKey() {
  if (_undoKeyOn || typeof window === "undefined") return;
  _undoKeyOn = true;
  window.addEventListener("keydown", (e) => {
    if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z"))) return;
    const a = document.activeElement;
    const tag = a && a.tagName;
    const isText =
      (tag === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|file|color)$/i.test(a.type || "")) ||
      tag === "TEXTAREA" || (a && a.isContentEditable);
    if (isText) return;           // อยู่ในช่องพิมพ์ → ให้เบราว์เซอร์ undo ตัวอักษรเอง
    // ถ้ามี modal เปิดอยู่ → ย้อนได้เฉพาะฟอร์มที่ "แก้หลังจาก modal เปิด" (กันเผลอย้อนฟอร์มพื้นหลัง)
    const gate = _modalStack.length ? _modalStack[_modalStack.length - 1] : -1;
    for (let i = _undoers.length - 1; i >= 0; i--) {
      if (_undoers[i].canUndo() && (_undoers[i].seq || 0) > gate) { e.preventDefault(); _undoers[i].undo(); return; }
    }
  });
}
function useUndoable(initial) {
  const [state, setState] = useState(initial);
  const hist = useRef([]);
  const api = useRef(null);
  if (!api.current) api.current = {};
  const set = useCallback((updater) => {
    const idx = _undoers.indexOf(api.current);   // ทำเครื่องหมายว่าแก้ล่าสุด → ย้ายไปท้ายสแตก
    if (idx >= 0) { _undoers.splice(idx, 1); _undoers.push(api.current); }
    api.current.seq = ++_editSeq;                // จำลำดับการแก้ล่าสุดของฟอร์มนี้
    try { window.dispatchEvent(new Event("mls-undo-available")); } catch { /* ignore */ }
    setState((prev) => {
      hist.current = [...hist.current, prev].slice(-50);
      return typeof updater === "function" ? updater(prev) : updater;
    });
  }, []);
  api.current.canUndo = () => hist.current.length > 0;
  api.current.undo = () => setState((prev) => {
    if (hist.current.length === 0) return prev;
    const last = hist.current[hist.current.length - 1];
    hist.current = hist.current.slice(0, -1);
    return last;
  });
  useEffect(() => {
    _installUndoKey();
    _undoers.push(api.current);
    return () => { const i = _undoers.indexOf(api.current); if (i >= 0) _undoers.splice(i, 1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [state, set];
}

// ── ตารางเรียงลำดับตามหัวข้อ (คลิกหัวคอลัมน์เพื่อเรียง) ─────────────────────────
// useTableSort เก็บ key+ทิศทาง · sortRows เรียงจาก "ค่าจริง" (ตัวเลข/วันที่) ไม่ใช่ข้อความที่โชว์
function useTableSort(defaultKey = null, defaultDir = "asc") {
  const [key, setKey] = useState(defaultKey);
  const [dir, setDir] = useState(defaultDir);
  const toggle = (k) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setKey(k); setDir("asc"); }
  };
  const set = (k) => { setKey(k || null); setDir("asc"); };   // เลือกจาก dropdown (มือถือ)
  const sortRows = (rows, accessors) => {
    if (!key || !accessors || !accessors[key]) return rows;
    const acc = accessors[key];
    const arr = [...(rows || [])];
    arr.sort((a, b) => {
      let va = acc(a), vb = acc(b);
      const na = va == null, nb = vb == null;
      if (na && nb) return 0;
      if (na) return 1;               // ค่าว่างไปท้ายเสมอ
      if (nb) return -1;
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
    });
    if (dir === "desc") arr.reverse();
    return arr;
  };
  return { key, dir, toggle, set, sortRows };
}
// หัวคอลัมน์ที่กดเรียงได้ (โชว์ลูกศร ▲/▼ ตัวที่กำลังเรียง) — เดสก์ท็อป
function SortTh({ k, sort, children, style }) {
  const active = sort.key === k;
  return (
    <th onClick={() => sort.toggle(k)} style={{ cursor: "pointer", userSelect: "none", ...style }} title="กดเพื่อเรียงลำดับ">
      {children}
      <span style={{ marginLeft: 5, fontSize: 11, opacity: active ? 1 : 0.5 }}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}
// ตัวเลือกเรียงลำดับสำหรับมือถือ/แท็บเล็ต (หัวตารางถูกซ่อนตอนเป็นการ์ด) — โชว์เฉพาะ ≤820px
function SortControl({ sort, options }) {
  return (
    <div className="sort-mobile">
      <span>เรียงโดย</span>
      <select value={sort.key || ""} onChange={(e) => sort.set(e.target.value)}>
        <option value="">— ค่าเริ่มต้น —</option>
        {options.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
      </select>
      <button type="button" onClick={() => sort.key && sort.toggle(sort.key)} disabled={!sort.key}
        title="สลับ น้อย↔มาก" aria-label="สลับทิศทางการเรียง">{sort.dir === "asc" ? "▲ น้อย→มาก" : "▼ มาก→น้อย"}</button>
    </div>
  );
}

// ── คอลัมน์ลากสลับตำแหน่งได้ + จำลำดับใน DB 2 ระดับ (ค่ากลาง company + รายคน user) ─────────────
//   ลำดับที่ใช้จริง: ของฉัน (user) > ค่ากลาง (company) > ค่าเริ่มต้นในโค้ด
//   แอดมินลาก = บันทึกเป็น "ค่ากลาง" (ทุกเครื่องเห็น) · คนอื่นลาก = "ของฉัน" (ตามติด login) · มิเรอร์ค่ากลางใน localStorage ให้ลื่น/ออฟไลน์
function _cpLoad(k) { try { const s = window.localStorage.getItem(k); return s ? JSON.parse(s) : {}; } catch { return {}; } }
function _cpSaveLS(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
const COL_PREFS = { user: {}, company: _cpLoad("mls.colprefs.company"), loaded: false };   // user โหลดจาก DB ตอน login (ไม่มิเรอร์ กันปนกันบนเครื่องรวม)
const _cpSubs = new Set();
function _cpNotify() { _cpSubs.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }
function _cpMirror() { _cpSaveLS("mls.colprefs.company", COL_PREFS.company); }
async function loadColPrefs() {
  COL_PREFS.user = {}; _cpNotify();   // ล้างของคนก่อนทันที (กันเห็นลำดับคนอื่นชั่ววูบบนเครื่องรวม)
  try {
    const d = await getColumnPrefs();
    COL_PREFS.user = d?.user || {};
    COL_PREFS.company = d?.company || {};
  } catch { /* ignore — ใช้ค่ามิเรอร์เดิม */ }
  COL_PREFS.loaded = true; _cpMirror(); _cpNotify();
}
function colOrderFor(id) { return COL_PREFS.user[id] || COL_PREFS.company[id] || null; }
// ซ่อน/แสดงคอลัมน์: เก็บในระบบเดียวกับลำดับคอลัมน์ (table_id เดิม + "::hidden") → ไม่ต้องแก้ DB/SQL เพิ่ม
const COL_HIDE_SUF = "::hidden";
function colHiddenFor(id) {
  const u = COL_PREFS.user[id + COL_HIDE_SUF], c = COL_PREFS.company[id + COL_HIDE_SUF];
  return Array.isArray(u) ? u : (Array.isArray(c) ? c : null);   // ของฉัน (รวมกรณี [] = โชว์ครบ) > ค่ากลาง > ไม่ตั้ง
}
// แอดมินลาก = บันทึกเป็น "ค่ากลาง" (ทุกเครื่องเห็น) · คนอื่นลาก = บันทึกเป็น "ของฉัน"
async function saveColOrderScoped(id, order, admin) {
  if (admin) {
    COL_PREFS.company[id] = order;
    if (COL_PREFS.user[id]) { delete COL_PREFS.user[id]; try { await clearColumnPref("user", id); } catch { /* ignore */ } }   // กันลำดับ "ของฉัน" เดิมบังค่ากลางที่เพิ่งตั้ง
    _cpMirror(); _cpNotify();
    try { await setColumnPref("company", id, order); } catch { /* เก็บในหน่วยความจำแล้ว */ }
  } else {
    COL_PREFS.user[id] = order; _cpNotify();
    try { await setColumnPref("user", id, order); } catch { /* เก็บในหน่วยความจำแล้ว */ }
  }
}
async function clearColOrderScoped(id, admin) {
  if (admin) {
    delete COL_PREFS.company[id]; _cpMirror(); _cpNotify();
    try { await clearColumnPref("company", id); } catch { /* ignore */ }
  } else {
    delete COL_PREFS.user[id]; _cpNotify();
    try { await clearColumnPref("user", id); } catch { /* ignore */ }
  }
}
async function publishCompanyColPrefs() {   // แอดมิน: เอาลำดับ "ของฉัน" ทั้งหมด → ค่ากลาง
  const prefs = { ...COL_PREFS.user };
  COL_PREFS.company = { ...COL_PREFS.company, ...prefs }; _cpMirror(); _cpNotify();
  return setColumnPrefsBulk("company", prefs);
}
async function clearAllMyColPrefs() { COL_PREFS.user = {}; _cpNotify(); return clearColumnPrefs("user"); }
async function clearCompanyColPrefs() { COL_PREFS.company = {}; _cpMirror(); _cpNotify(); return clearColumnPrefs("company"); }

// รวมลำดับที่บันทึกไว้กับชุดคอลัมน์ปัจจุบัน (ตัดตัวที่หายไป · ต่อท้ายตัวที่เพิ่มใหม่)
function mergeColOrder(saved, keys) {
  if (!saved || !saved.length) return keys.slice();
  const set = new Set(keys);
  const out = saved.filter((k) => set.has(k));
  keys.forEach((k) => { if (!out.includes(k)) out.push(k); });
  return out;
}
function useColOrder(id, keys, defaultHidden = null) {
  const keySig = keys.join("|");
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); _cpSubs.add(fn); return () => { _cpSubs.delete(fn); }; }, []);
  const saved = colOrderFor(id);
  const order = useMemo(() => mergeColOrder(saved, keys), [saved ? saved.join("|") : "", keySig]);
  const [drag, setDrag] = useState(null);   // { from, over, side }
  const move = (fromKey, overKey, side) => {
    if (!fromKey || !overKey || fromKey === overKey) return;
    const arr = order.filter((k) => k !== fromKey);
    let idx = arr.indexOf(overKey);
    if (idx < 0) return;
    if (side === "right") idx += 1;
    arr.splice(idx, 0, fromKey);
    saveColOrderScoped(id, arr, isAdmin(getSession()));   // แอดมิน → ค่ากลาง · คนอื่น → ของฉัน
  };
  const reset = () => { clearColOrderScoped(id, isAdmin(getSession())); };
  // ── ซ่อน/แสดงคอลัมน์ (บันทึกที่เดียวกับลำดับ: แอดมิน→ค่ากลาง · คนอื่น→ของฉัน) ──
  const savedHide = colHiddenFor(id);
  const defHideSig = Array.isArray(defaultHidden) ? defaultHidden.join("|") : "";
  const hiddenArr = useMemo(() => {
    const set = new Set(keys);
    // ยังไม่เคยตั้ง (null) → ใช้ค่าเริ่มต้นของตาราง (defaultHidden) · ตั้งแล้ว (รวม [] = แสดงครบ) → ตามที่ตั้ง
    const base = savedHide || (Array.isArray(defaultHidden) ? defaultHidden : []);
    return base.filter((k) => set.has(k));                    // ตัดคอลัมน์ที่ไม่มีแล้วออก
  }, [savedHide ? savedHide.join("|") : "-", keySig, defHideSig]);
  const hidden = useMemo(() => new Set(hiddenArr), [hiddenArr.join("|")]);
  const setHidden = (arr) => { saveColOrderScoped(id + COL_HIDE_SUF, arr, isAdmin(getSession())); };
  const toggleHide = (k) => { setHidden(hidden.has(k) ? hiddenArr.filter((x) => x !== k) : [...hiddenArr, k]); };
  const showAll = () => { setHidden([]); };
  const resetAll = () => {                                   // คืนค่าเริ่มต้นทั้งลำดับ + คอลัมน์ที่ซ่อน
    const admin = isAdmin(getSession());
    clearColOrderScoped(id, admin); clearColOrderScoped(id + COL_HIDE_SUF, admin);
  };
  return { order, move, reset, drag, setDrag, hidden, hiddenArr, toggleHide, showAll, resetAll };
}
// ป้ายชื่อคอลัมน์ที่ใช้ในเมนูเลือกคอลัมน์ (หัวตารางบางอันเป็น element → ใช้ dataLabel/key แทน)
function colLabel(c) {
  if (typeof c.header === "string" && c.header.trim()) return c.header;
  if (typeof c.dataLabel === "string" && c.dataLabel.trim()) return c.dataLabel;
  return c.key;
}
// ── เมนูคลิกขวาที่หัวตาราง: ติ๊กเปิด-ปิดคอลัมน์ (แบบ Windows Explorer) ────────────
function ColumnMenu({ at, cols, hidden, canHide, onToggle, onShowAll, onReset, onClose, lang }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y, ready: false });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(6, Math.min(at.x, window.innerWidth - r.width - 8)),
      top: Math.max(6, Math.min(at.y, window.innerHeight - r.height - 8)),
      ready: true,
    });
  }, [at.x, at.y, cols.length]);
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);
  const nHidden = cols.filter((c) => hidden.has(c.key)).length;
  const body = (
    <div ref={ref} className="dt-menu" role="menu" onContextMenu={(e) => e.preventDefault()}
         style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}>
      <div className="hd">{lang === "en" ? "Show columns" : "เลือกคอลัมน์ที่จะแสดง"}</div>
      {cols.map((c) => {
        const on = !hidden.has(c.key);
        const lock = on && !canHide(c.key);
        return (
          <div key={c.key} role="menuitemcheckbox" aria-checked={on} className={"mi" + (lock ? " dis" : "")}
               title={lock ? (lang === "en" ? "Must keep at least one column" : "ต้องเหลืออย่างน้อย 1 คอลัมน์") : ""}
               onClick={() => { if (!lock) onToggle(c.key); }}>
            <span className="ck">{on ? "✓" : ""}</span><span className="lb">{colLabel(c)}</span>
          </div>
        );
      })}
      <div className="sep" />
      <div className={"mi" + (nHidden ? "" : " dis")} onClick={() => { if (nHidden) onShowAll(); }}>
        <span className="ck" /><span className="lb">{lang === "en" ? "Show all columns" : "แสดงทุกคอลัมน์"}</span>
      </div>
      <div className="mi" onClick={onReset}>
        <span className="ck" /><span className="lb">{lang === "en" ? "Reset to default" : "คืนค่าเริ่มต้น (ลำดับ + คอลัมน์)"}</span>
      </div>
      <div className="ft">{isAdmin(getSession())
        ? (lang === "en" ? "Admin: saved as the shared default for everyone" : "แอดมิน: บันทึกเป็นค่ากลาง ทุกเครื่องเห็นเหมือนกัน")
        : (lang === "en" ? "Saved for your account only" : "บันทึกเฉพาะบัญชีของคุณ")}</div>
    </div>
  );
  try { return createPortal(body, document.body); } catch { return body; }
}
// หัวคอลัมน์: คลิก = เรียงลำดับ (ถ้ามี sortKey) · ลากที่จับ ⠿ = ย้ายตำแหน่งคอลัมน์ (เมาส์/สัมผัส)
function ReorderTh({ col, sort, drag, setDrag, onMove }) {
  const [lang] = useLang();
  const active = sort && col.sortKey && sort.key === col.sortKey;
  const isFrom = drag && drag.from === col.key;
  const isOver = drag && drag.over === col.key && drag.from !== col.key;
  const grab = (e) => {
    if (e.button != null && e.button !== 0) return;   // คลิกขวา/กลาง = ไม่ลาก (ปล่อยให้เมนูเลือกคอลัมน์ทำงาน)
    e.stopPropagation();
    e.preventDefault();
    const grip = e.currentTarget;
    const pid = e.pointerId;
    try { grip.setPointerCapture(pid); } catch { /* ignore */ }
    let cur = { from: col.key, over: col.key, side: "left" };
    setDrag(cur);
    const onPtMove = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const th = el && el.closest && el.closest("th[data-colkey]");
      if (!th) return;
      const k = th.getAttribute("data-colkey");
      const r = th.getBoundingClientRect();
      const side = ev.clientX < r.left + r.width / 2 ? "left" : "right";
      cur = { from: col.key, over: k, side };
      setDrag(cur);
    };
    const done = () => {
      grip.removeEventListener("pointermove", onPtMove);
      grip.removeEventListener("pointerup", done);
      grip.removeEventListener("pointercancel", done);
      try { grip.releasePointerCapture(pid); } catch { /* ignore */ }
      onMove(cur.from, cur.over, cur.side);
      setDrag(null);
    };
    grip.addEventListener("pointermove", onPtMove);
    grip.addEventListener("pointerup", done);
    grip.addEventListener("pointercancel", done);
  };
  const thStyle = {
    ...(col.thStyle || {}),
    ...(col.align ? { textAlign: col.align } : {}),
    cursor: col.sortKey ? "pointer" : ((col.thStyle && col.thStyle.cursor) || "default"),
    userSelect: "none",
    opacity: isFrom ? 0.45 : 1,
    boxShadow: isOver ? (drag.side === "left" ? "inset 3px 0 0 var(--accent-dk, #0a7)" : "inset -3px 0 0 var(--accent-dk, #0a7)") : undefined,
    transition: "box-shadow .08s",
  };
  return (
    <th data-colkey={col.key} style={thStyle}
        onClick={col.sortKey ? () => sort.toggle(col.sortKey) : undefined}
        title={col.title || (lang === "en"
          ? (col.sortKey ? "Click to sort · drag ⠿ to move the column" : "Drag ⠿ to move the column") + " · right-click = choose columns"
          : (col.sortKey ? "กดเพื่อเรียง · ลากที่จับ ⠿ เพื่อย้ายคอลัมน์" : "ลากที่จับ ⠿ เพื่อย้ายคอลัมน์") + " · คลิกขวา = เลือกคอลัมน์")}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        <span onPointerDown={grab} onClick={(e) => e.stopPropagation()} title={lang === "en" ? "Drag to move the column" : "ลากเพื่อย้ายคอลัมน์"}
              style={{ cursor: "grab", opacity: 0.4, touchAction: "none", padding: "0 2px", fontSize: 12, lineHeight: 1, letterSpacing: -2 }}>⠿</span>
        {col.header}
        {col.sortKey && <span style={{ marginLeft: 3, fontSize: 11, opacity: active ? 1 : 0.5 }}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>}
      </span>
    </th>
  );
}
// ตารางข้อมูลที่คอลัมน์ลากสลับได้ (ขับด้วย config: หัว+ค่าอยู่ด้วยกัน จึงไม่มีทางสลับผิดคู่)
// columns: [{ key, header, sortKey?, thStyle?, tdStyle?, tdProps?(row,i,ctx), cell(row,i,ctx), dataLabel? }]
// rowAfter(row, i, ctx) → เนื้อหาแถวเสริมใต้แถวนั้น (เช่น ตารางเครื่องจักรที่เปิดขยาย) · null = ไม่มี
function DataTable({ id, columns, rows, rowKey, sort, sortAccessors, rowCtx, rowProps, rowAfter, wrapClass, tableClass, tableStyle, wrapStyle, empty, orderApiRef, defaultHidden }) {
  const cols0 = (columns || []).filter(Boolean);
  const keys = cols0.map((c) => c.key);
  const { order, move, reset, drag, setDrag, hidden, toggleHide, showAll, resetAll } = useColOrder(id, keys, defaultHidden);
  const byKey = {};
  cols0.forEach((c) => { byKey[c.key] = c; });
  const allCols = order.map((k) => byKey[k]).filter(Boolean);
  const cols = allCols.filter((c) => c.lockCol || !hidden.has(c.key));   // lockCol = ปิดไม่ได้ (คอลัมน์หลัก)
  // visibleKeys = คอลัมน์ที่เห็นอยู่ตามลำดับบนจอ (ให้ Export Excel ออกตามที่ผู้ใช้จัดไว้)
  if (orderApiRef) orderApiRef.current = { reset, showAll, resetAll, visibleKeys: cols.map((c) => c.key) };
  const nHidden = allCols.length - cols.length;
  const [menu, setMenu] = useState(null);                                 // { x, y } = เมนูเลือกคอลัมน์
  const canHide = (k) => { const c = byKey[k]; return !(c && c.lockCol) && cols.length > 1; };
  const openMenuAt = (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); };
  const openMenuBtn = (e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 210, y: r.bottom + 4 }); };
  const data = (sort && sortAccessors) ? sort.sortRows(rows, sortAccessors) : (rows || []);
  const [lang] = useLang();
  const wrapRef = useRef(null);
  const [showTableTop, setShowTableTop] = useState(false);
  const [canScrollV, setCanScrollV] = useState(false);   // ตารางเลื่อนแนวตั้งในกล่องได้ไหม (มีปุ่มขึ้น + เว้นที่ท้ายตารางกันปุ่มทับ)
  const recheckScroll = () => {
    const el = wrapRef.current; if (!el) return;
    setCanScrollV((el.scrollHeight - el.clientHeight) > 24);
    try { el.style.setProperty("--dt-vw", el.clientWidth + "px"); } catch { /* ignore */ }   // ความกว้างที่มองเห็น → แถวเสริม (rowAfter) ค้างในจอแม้ตารางเลื่อนแนวนอน
  };
  useEffect(() => { recheckScroll(); const on = () => recheckScroll(); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, [data.length, cols.length]);
  const onWrapScroll = (e) => { setShowTableTop((e.currentTarget.scrollTop || 0) > 120); };
  const tableToTop = () => { const el = wrapRef.current; if (!el) return; try { el.scrollTo({ top: 0, behavior: "smooth" }); } catch { el.scrollTop = 0; } };
  return (
    <div className="dt-host" style={{ position: "relative", paddingBottom: canScrollV ? 42 : undefined }}>
      <div ref={wrapRef} onScroll={onWrapScroll} className={wrapClass || "table-wrap"} style={wrapStyle}>
      <table className={tableClass || "data-table"} style={tableStyle}>
        <thead>
          <tr onContextMenu={openMenuAt}>
            {cols.map((c) => <ReorderTh key={c.key} col={c} sort={sort} drag={drag} setDrag={setDrag} onMove={move} />)}
            {/* ★ ปุ่มเลือกคอลัมน์ = คอลัมน์ของตัวเองท้ายหัวตาราง (ไม่ลอยทับหัวคอลัมน์สุดท้าย/สกอร์บาร์) · sticky ขวา = เห็นเสมอแม้ตารางเลื่อนแนวนอน */}
            <th className="dt-colth">
              <button type="button" className={"dt-colbtn" + (nHidden ? " on" : "")} onClick={openMenuBtn}
                aria-label={lang === "en" ? "Choose columns" : "เลือกคอลัมน์"}
                title={nHidden
                  ? (lang === "en" ? `${nHidden} column(s) hidden — click to choose` : `ซ่อนอยู่ ${nHidden} คอลัมน์ — กดเพื่อเลือก`)
                  : (lang === "en" ? "Choose columns (or right-click the header)" : "เลือกคอลัมน์ที่จะแสดง (คลิกขวาที่หัวตารางก็ได้)")}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="5.2" height="16" rx="1" /><rect x="9.4" y="4" width="5.2" height="16" rx="1" /><rect x="15.8" y="4" width="5.2" height="16" rx="1" />
                </svg>
                {nHidden ? <span className="dt-colbtn-dot" /> : null}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {(!data || data.length === 0) ? (
            <tr><td colSpan={(cols.length || 1) + 1} style={{ color: "var(--muted)", textAlign: "center", padding: "16px 8px" }}>{empty || "—"}</td></tr>
          ) : data.map((row, i) => {
            const ctx = rowCtx ? rowCtx(row, i) : undefined;
            const rp = rowProps ? rowProps(row, i, ctx) : null;
            const after = rowAfter ? rowAfter(row, i, ctx) : null;
            const rk = rowKey ? rowKey(row, i) : i;
            const rpx = after ? { ...(rp || {}), className: ((rp && rp.className) || "") + " dt-has-after" } : rp;
            return (
              <Fragment key={rk}>
              <tr {...(rpx || {})}>
                {cols.map((c) => {
                  const tp = c.tdProps ? c.tdProps(row, i, ctx) : null;
                  let tstyle, trest = null;
                  if (tp) { const { style, ...rest } = tp; tstyle = style; trest = rest; }
                  return (
                    <td key={c.key}
                        data-label={c.dataLabel != null ? c.dataLabel : (typeof c.header === "string" ? c.header : "")}
                        style={{ ...(c.align ? { textAlign: c.align } : {}), ...(c.tdStyle || {}), ...(tstyle || {}) }} {...(trest || {})}>
                      {c.cell ? c.cell(row, i, ctx) : null}
                    </td>
                  );
                })}
                <td className="dt-colpad" data-label="" aria-hidden="true" />
              </tr>
              {after ? (
                <tr className="dt-after">
                  <td colSpan={(cols.length || 1) + 1} data-label="">{after}</td>
                </tr>
              ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      {menu && (
        <ColumnMenu at={menu} cols={allCols} hidden={hidden} canHide={canHide} lang={lang}
          onToggle={toggleHide} onShowAll={showAll}
          onReset={() => { resetAll(); setMenu(null); }} onClose={() => setMenu(null)} />
      )}
      {showTableTop && (
        <button type="button" onClick={tableToTop}
          aria-label={lang === "en" ? "Scroll this table to top" : "เลื่อนตารางนี้ขึ้นบนสุด"}
          title={lang === "en" ? "Scroll this table to top" : "เลื่อนตารางนี้ขึ้นบนสุด"}
          style={{ position: "absolute", right: 6, bottom: 3, zIndex: 6, width: 36, height: 36, borderRadius: 10,
            background: "var(--surface, #fff)", color: "#1f5288", border: "2px solid #1f5288", cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
        </button>
      )}
    </div>
  );
}

// ── Toast แจ้งเตือนแบบไม่บล็อกหน้าจอ (แทน alert) ──────────────────────────────
function mlsToast(text, tone = "info") {
  try { window.dispatchEvent(new CustomEvent("mls-toast", { detail: { text, tone } })); } catch { /* ignore */ }
}
function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let idc = 0;
    const on = (e) => {
      const id = ++idc;
      setItems((s) => [...s, { id, text: e.detail.text, tone: e.detail.tone || "info" }]);
      const ttl = e.detail.tone === "error" ? 6000 : e.detail.tone === "warn" ? 4500 : 3400;
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), ttl);
    };
    window.addEventListener("mls-toast", on);
    return () => window.removeEventListener("mls-toast", on);
  }, []);
  if (!items.length) return null;
  return (
    <div className="mls-toaster">
      {items.map((it) => (
        <div key={it.id} className={`mls-toast ${it.tone}`} role="status"
          onClick={() => setItems((s) => s.filter((x) => x.id !== it.id))} title="แตะเพื่อปิด">{it.text}</div>
      ))}
    </div>
  );
}

// ── ป้ายบอกว่ากด Ctrl+Z ย้อนได้ (โผล่ครั้งแรกที่มีการแก้ไขในเซสชัน) ──────────────
function UndoHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => {
      let seen = false; try { seen = sessionStorage.getItem("mls-undo-hint") === "1"; } catch { /* ignore */ }
      if (seen) return;
      try { sessionStorage.setItem("mls-undo-hint", "1"); } catch { /* ignore */ }
      setShow(true);
      setTimeout(() => setShow(false), 4500);
    };
    window.addEventListener("mls-undo-available", on);
    return () => window.removeEventListener("mls-undo-available", on);
  }, []);
  if (!show) return null;
  return <div className="mls-undo-hint" onClick={() => setShow(false)}>↶ กด Ctrl+Z เพื่อย้อนการแก้ไข</div>;
}

// parseReleaseExcel ถูก import แบบ dynamic ตอนเลือกไฟล์ (ดู ImportReleaseModal)
// เพื่อไม่ให้ไลบรารี xlsx (ก้อนใหญ่) ถูกโหลดตั้งแต่หน้า Login
import {
  processedWeight, materialWeight, distinctUnitCount, machineOpMatrix, partOpMatrix, totalPieces,
  machineDailyMatrix, missingWeightParts, logWeight,
} from "./metrics.js";
import Icon from "./icons.jsx";
import { askConfirm, ConfirmHost } from "./confirm.jsx";
import { SimpleBarChart } from "./svgcharts.jsx";

// ─── Chart theme (สีกราฟ SVG — ค่าสีตรงกับ CSS variables ของแอป) ──
const CHART = {
  grid: "#e1e9e5", muted: "#6d7d76", tooltipBg: "#ffffff", tooltipBorder: "#e1e9e5",
  text: "#142420", accent: "#10b981", success: "#22c55e",
};

// ปุ่มสลับภาษา ไทย/EN — โชว์ "ภาษาปัจจุบัน" (ไทย→ไทย · อังกฤษ→EN) · กดเพื่อสลับ
function LangToggle() {
  const [lang, setLang] = useLang();
  return (
    <button className="lang-toggle-btn" onClick={() => setLang(lang === "th" ? "en" : "th")}
      title="สลับภาษา / Switch language"
      style={{ appearance: "none", cursor: "pointer", fontFamily: "inherit",
        fontSize: 13, fontWeight: 800, lineHeight: 1, letterSpacing: ".03em",
        padding: "5px 12px", borderRadius: 8,
        border: "1.5px solid var(--accent, #10b981)", background: "transparent", color: "var(--accent, #10b981)" }}>
      {lang === "th" ? "ไทย" : "EN"}
    </button>
  );
}

const fmtNum = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-";
// วันที่อย่างเดียว (สำหรับ "วันที่ปล่อยงาน" ที่เวลาไม่ใช่เวลาจริง — โชว์เวลาแล้วจะทำให้เข้าใจผิด)
const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString("th-TH", { dateStyle: "short" }) : "-";
// เวลาเป็น ชม.:นาที (สำหรับ "เวลาเดินเครื่อง") — ปัดวินาทีทิ้ง อ่านง่ายในรายงาน
const fmtHrs = (secs) => {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;   // HH:MM:SS
};

// ─── เสียง + สั่น ตอบรับการสแกน (สำคัญบนหน้าโรงงานที่ไม่ได้จ้องจอ) ───────────────
let _audioCtx = null;
function beep(kind) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const ctx = _audioCtx;
    const play = (freq, start, dur, vol = 0.18) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + start;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    };
    if (kind === "success") play(950, 0, 0.13);
    else if (kind === "warning") { play(600, 0, 0.1); play(600, 0.14, 0.1); }
    else { play(240, 0, 0.32, 0.22); } // error/danger — ต่ำและยาว
  } catch (_) { /* บางเบราว์เซอร์บล็อกเสียงก่อน user gesture */ }
}
function feedback(tone) {
  beep(tone === "danger" ? "danger" : tone === "warning" ? "warning" : "success");
  try {
    if (navigator.vibrate) navigator.vibrate(tone === "success" ? 60 : tone === "warning" ? [40, 50, 40] : [120, 70, 120]);
  } catch (_) {}
}

// ─── Date range presets ─────────────────────────────────────────────────────
const PRESETS = [
  { value: "day", label: "วันนี้" },
  { value: "week", label: "7 วันล่าสุด" },
  { value: "month", label: "30 วันล่าสุด" },
  { value: "year", label: "12 เดือนล่าสุด" },
];
function rangeFor(preset) {
  const to = new Date();
  const from = new Date(to);
  if (preset === "day") from.setHours(0, 0, 0, 0);
  else if (preset === "week") from.setDate(to.getDate() - 7);
  else if (preset === "month") from.setDate(to.getDate() - 30);
  else from.setFullYear(to.getFullYear() - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
// ─── Month / custom range helpers (used by Report's flexible date filter) ──
function monthRangeFor(monthStr) {
  if (!monthStr) return rangeFor("month");
  const [y, m] = monthStr.split("-").map(Number);
  const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, m, 0, 23, 59, 59, 999); // last day of that month
  return { from: from.toISOString(), to: to.toISOString() };
}
function customRangeFor(fromStr, toStr) {
  const from = fromStr ? new Date(`${fromStr}T00:00:00`) : new Date(0);
  const to = toStr ? new Date(`${toStr}T23:59:59.999`) : new Date();
  return { from: from.toISOString(), to: to.toISOString() };
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function PresetPicker({ value, onChange }) {
  return (
    <div className="chip-row">
      {PRESETS.map((p) => (
        <button key={p.value} className={`chip ${value === p.value ? "active" : ""}`} onClick={() => onChange(p.value)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ─── Routing helpers ─────────────────────────────────────────────────────────
function progressFor(routing, doneOpNames) {
  const done = new Set(doneOpNames);
  return (routing || []).map((op) => ({ op, done: done.has(op) }));
}
function nextOpFor(routing, doneOpNames) {
  const done = new Set(doneOpNames);
  return (routing || []).find((op) => !done.has(op)) || null;
}

// ══════════════════════════════════════════════════════════════════════════
// UI ATOMS
// ══════════════════════════════════════════════════════════════════════════
const Btn = ({ children, variant = "default", size, className = "", ...rest }) => {
  const vClass = { accent: "btn-accent", success: "btn-success", danger: "btn-danger", ghost: "btn-ghost" }[variant] || "";
  const sClass = { lg: "btn-lg", sm: "btn-sm" }[size] || "";
  return <button {...rest} className={`btn ${vClass} ${sClass} ${className}`}>{children}</button>;
};
const Input = forwardRef(({ className = "", ...props }, ref) => (
  <input {...props} ref={ref} className={`input ${className}`} />
));
const Select = ({ options, className = "", ...props }) => (
  <select {...props} className={`select ${className}`}>
    <option value="">— เลือก —</option>
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);
// ── ดรอปดาวน์ค้นหาได้ (พิมพ์เพื่อกรอง) — ใช้ตอนตัวเลือกเยอะ เช่น เลือกโปรเจคหน้า "ล้างข้อมูลสแกน" ──
function SearchSelect({ value, onChange, options, placeholder = "— เลือก / พิมพ์เพื่อค้นหา —", className = "" }) {
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);   // เริ่มพิมพ์แล้วหรือยัง (พิมพ์ = โชว์คำค้น · ไม่พิมพ์ = โชว์ค่าที่เลือก)
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const selected = options.find((o) => String(o.value) === String(value)) || null;
  const shown = touched ? query : (selected ? selected.label : "");
  const q = query.trim().toLowerCase();
  const list = (touched && q) ? options.filter((o) => String(o.label).toLowerCase().includes(q)) : options;

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setTouched(false); setQuery(""); } };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (o) => { onChange(o.value); setOpen(false); setTouched(false); setQuery(""); };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input className={`input ${className}`} value={shown} placeholder={placeholder} style={{ width: "100%" }}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onChange={(e) => { setQuery(e.target.value); setTouched(true); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setTouched(false); setQuery(""); e.currentTarget.blur(); }
          else if (e.key === "Enter" && open && list.length) { e.preventDefault(); choose(list[0]); }
        }} />
      {open && (
        <div style={{ position: "absolute", zIndex: 40, top: "calc(100% + 4px)", left: 0, right: 0,
          maxHeight: 280, overflowY: "auto", background: "var(--surface, #fff)",
          border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 14px 36px rgba(15,23,42,.18)" }}>
          {list.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--muted)" }}>ไม่พบรายการที่ตรงกับ “{query}”</div>
          ) : list.map((o) => (
            <div key={o.value} title={o.label} onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              style={{ padding: "9px 12px", fontSize: 13.5, cursor: "pointer",
                background: String(o.value) === String(value) ? "var(--surface-2)" : "transparent",
                borderBottom: "1px solid var(--surface-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = String(o.value) === String(value) ? "var(--surface-2)" : "transparent"; }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const Field = ({ label, children }) => (
  <div className="field"><div className="label-el">{label}</div>{children}</div>
);
const Card = ({ title, right, children, className = "" }) => (
  <div className={`card ${className}`}>
    {(title || right) && (
      <div className="card-head">
        <div className="card-title">{title}</div>
        <div>{right}</div>
      </div>
    )}
    {children}
  </div>
);
const TONES = {
  accent: { c: "var(--accent-dk)", bg: "rgba(16,185,129,.12)", bd: "rgba(16,185,129,.3)" },
  success: { c: "#15803d", bg: "rgba(34,197,94,.14)", bd: "rgba(34,197,94,.3)" },
  steel: { c: "#1d4ed8", bg: "rgba(59,130,246,.12)", bd: "rgba(59,130,246,.3)" },
  warning: { c: "#b45309", bg: "rgba(245,158,11,.14)", bd: "rgba(245,158,11,.32)" },
  danger: { c: "#b91c1c", bg: "rgba(239,68,68,.12)", bd: "rgba(239,68,68,.3)" },
  muted: { c: "var(--muted)", bg: "rgba(109,125,118,.1)", bd: "rgba(109,125,118,.25)" },
};
const Badge = ({ children, tone = "accent" }) => {
  const t = TONES[tone] || TONES.accent;
  return <span className="badge" style={{ color: t.c, background: t.bg, borderColor: t.bd }}>{children}</span>;
};
const StatCard = ({ label, value, icon }) => (
  <div className="card">
    <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {icon && <Icon name={icon} size={13} />}{label}
    </div>
    <div className="stat-value">{value}</div>
  </div>
);

// Generic modal shell used by the quick-create Project / Part popups.
// closeOnBackdrop: false = คลิกพื้นที่ว่างรอบๆ จะไม่ปิด (ต้องกด X หรือปุ่มยกเลิกเท่านั้น)
// locked: true = ล็อกเต็มรูปแบบชั่วคราว (ปิดไม่ได้เลยแม้กด X/Esc) — ใช้ตอนกำลังประมวลผล/นำเข้าอยู่
function Modal({ title, sub, onClose, children, closeOnBackdrop = true, locked = false, wide = false }) {
  const [shake, setShake] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape" && !locked) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, locked]);

  // ลงทะเบียน modal ในสแตก (สำหรับ Ctrl+Z: ย้อนได้เฉพาะฟอร์มในหน้าต่างนี้ ไม่ย้อนฟอร์มพื้นหลัง)
  useEffect(() => {
    _modalStack.push(_editSeq);
    return () => { _modalStack.pop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pulse() {
    setShake(true);
    setTimeout(() => setShake(false), 320);
  }

  function handleBackdropClick(e) {
    if (e.target !== e.currentTarget) return;
    if (locked) { pulse(); return; }
    if (closeOnBackdrop) onClose();
    else pulse(); // แจ้งเตือนเบาๆ ว่าหน้าต่างนี้ถูกล็อกไว้ ไม่ได้ค้าง
  }

  return (
    <div className="modal-backdrop" onMouseDown={handleBackdropClick}>
      <div className={`modal${wide ? " modal-wide" : ""}${shake ? " modal-shake" : ""}`}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
          <span
            className={`modal-close${locked ? " modal-close-disabled" : ""}`}
            onClick={() => { if (locked) { pulse(); return; } onClose(); }}
          >
            <Icon name="close" size={16} />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

// Signature element: the routing rail — a numbered track of the real
// operation sequence a part unit must travel through.
function RoutingRail({ routing, doneOps }) {
  const [lang] = useLang();
  const steps = routing || [];
  const doneSet = new Set(doneOps || []);
  let currentAssigned = false;
  if (steps.length === 0) {
    return <div style={{ fontSize: 12.5, color: "var(--muted)" }}>ยังไม่ได้กำหนด Routing สำหรับ Part นี้</div>;
  }
  return (
    <div className="rail">
      {steps.map((op, i) => {
        const done = doneSet.has(op);
        const isCurrent = !done && !currentAssigned;
        if (isCurrent) currentAssigned = true;
        return (
          <div className="rail-node-wrap" key={op}>
            {i > 0 && <div className={`rail-line ${doneSet.has(steps[i - 1]) ? "done" : ""}`} />}
            <div className="rail-node">
              <div className={`rail-dot ${done ? "done" : isCurrent ? "current" : ""}`}>{done ? "✓" : i + 1}</div>
              <div className={`rail-label ${done ? "done" : isCurrent ? "current" : ""}`}>{opLabel(op, lang)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════
// อนิเมชันโหลดตอนล็อกอิน/เปลี่ยนหน้า (แบบ 3 — จุดเต้น + แถบกวาด) เต็มจอ
function LoginSplash({ text = "กำลังเข้าสู่ระบบ…" }) {
  return (
    <div className="mls-splash">
      <div className="mls-splash-brand"><span className="m"><Icon name="bolt" size={18} /></span> MACHINING LINE</div>
      <div className="mls-load3"><div className="mls-load3-dots"><i /><i /><i /></div><div className="mls-load3-bar" /></div>
      <div className="mls-splash-text">{text}</div>
    </div>
  );
}

function Login({ onLogin }) {
  const [lang] = useLang();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const res = await appLogin(code, password);   // ล็อกอินรวม (หน้าเดียวทั้งออฟฟิศ+คนงาน) — ออนไลน์เช็ค DB + จำรหัสไว้ล็อกอินออฟไลน์
    setBusy(false);
    if (!res || !res.user) {
      // ★ กันล็อกอินซ้อน: บัญชีถูกใช้อยู่ที่เครื่องอื่น → แจ้งเตือน + บล็อก (เครื่องแรกไม่หลุด)
      if (res && res.error === "in_use") {
        const t = res.lastSeen ? new Date(res.lastSeen) : null;
        const hhmm = t && !isNaN(t.getTime()) ? t.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
        setErr(`บัญชีนี้กำลังใช้งานอยู่ที่เครื่องอื่น${hhmm ? ` (ใช้งานล่าสุด ${hhmm} น.)` : ""} — เข้าไม่ได้ · ให้กด “ออกจากระบบ” ที่เครื่องนั้นก่อน หรือรอสักครู่หากเครื่องนั้นปิดไปแล้ว (แอดมินสั่งเด้งออกจากเมนู ตั้งค่า → ผู้ใช้ออนไลน์ ได้)`);
        return;
      }
      setErr(res && res.error === "offline_first"
        ? "บัญชีนี้ยังไม่เคยล็อกอินในเครื่องนี้ — ต้องล็อกอินตอนมีเน็ต 1 ครั้งก่อน แล้วครั้งต่อไปจะออฟไลน์ได้"
        : res && res.error === "network"
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (เน็ตช้า/หลุด) — เช็ค Wi-Fi แล้วกดเข้าสู่ระบบอีกครั้ง"
          : "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง");
      return;
    }
    setSession(res.user);
    enterFullscreen();   // ล็อกอินสำเร็จ = user gesture → เข้าเต็มจอทันที
    onLogin(res.user);   // operator จะถูก goStation เด้งไป /station → แล้วเข้าแผนกตัวเองอัตโนมัติ
  }

  return (
    <div className="login-wrap">
      <form onSubmit={submit} className="login-card">
        <div className="login-mark"><Icon name="bolt" size={24} style={{ stroke: "var(--accent-ink)" }} /></div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 600, color: "var(--text)" }}>
          Machining Line System
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24, marginTop: 3 }}>
          ระบบบันทึกการทำงานเครื่องจักร
        </div>
        {BOOT_GO.go === "setup-employees" && (
          <div style={{ background: "rgba(16,185,129,.10)", border: "1px solid rgba(16,185,129,.35)", color: "var(--text)", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, marginBottom: 14, lineHeight: 1.55 }}>
            {lang === "en"
              ? <>🔑 Sign in with an <b>Admin</b> account to set a home machine/station{BOOT_GO.forCode ? <> for <b>{BOOT_GO.forCode}</b></> : null} — Setup → Employees opens right after</>
              : <>🔑 เข้าสู่ระบบด้วย<b>บัญชี Admin</b> เพื่อตั้งเครื่อง/สถานีประจำ{BOOT_GO.forCode ? <> ให้บัญชี <b>{BOOT_GO.forCode}</b></> : null} — ระบบจะเปิดหน้า ตั้งค่า → พนักงาน ให้เลย</>}
          </div>
        )}
        <Field label="รหัสพนักงาน">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น admin" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label="รหัสผ่าน">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        {err && <div style={{ color: "var(--danger-hi)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <Btn variant="accent" size="lg" className="btn-block" disabled={busy}>
          {busy ? <>กำลังเข้าสู่ระบบ<span className="mls-btn-dots"><i /><i /><i /></span></> : "เข้าสู่ระบบ"}
        </Btn>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 18, lineHeight: 1.7, textAlign: "center" }}>
          ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ
        </div>
      </form>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// SHELL — responsive nav: sidebar (desktop) / topbar+drawer+bottom nav (mobile)
// ══════════════════════════════════════════════════════════════════════════
// can: ฟังก์ชันเช็คสิทธิ์ต่อเมนู (undefined = ทุก role เข้าได้)
const MENU = [
  { group: "ขั้นตอนงาน", items: [
    { key: "projects", label: "โปรเจค", icon: "folder" },
    { key: "release", label: "ปล่อยงาน (Release)", icon: "box" },
    { key: "labels", label: "พิมพ์ QR / ป้าย", icon: "qr" },
    { key: "report", label: "รายงานข้อมูลสแกน", icon: "chart" },
    { key: "verify", label: "ตรวจงานประกอบ", icon: "check" },
  ] },
  { group: "สรุปภาพรวม", items: [
    { key: "daily", label: "รายงานประจำวัน", en: "Daily Report", icon: "chart" },
    { key: "machines", label: "สรุปเครื่องจักร", icon: "machine" },
    { key: "parts", label: "สรุป Part", icon: "grid" },
    { key: "machinereports", label: "รายงานปัญหาเครื่อง", icon: "warn", can: canManage },
  ] },
  { group: "จัดการ", items: [
    { key: "materials", label: "บันทึก Material", en: "Materials", icon: "scale" },
    { key: "setup", label: "ตั้งค่า", icon: "settings", can: isAdmin },
  ] },
];
// เมนูที่ user คนนี้เข้าถึงได้จริง (ตามสิทธิ์) — ใช้ทั้งเรนเดอร์เมนูและกันการเปิดแท็บ
function menuForUser(user) {
  return MENU
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.can || it.can(user)) }))
    .filter((g) => g.items.length > 0);
}
function canOpenTab(user, key) {
  return MENU.flatMap((g) => g.items).some((it) => it.key === key && (!it.can || it.can(user)));
}
const BOTTOM_LEFT = { key: "release", label: "Release", icon: "box" };
const BOTTOM_LEFT2 = { key: "labels", label: "พิมพ์ QR", icon: "qr" };
const BOTTOM_RIGHT = { key: "report", label: "รายงาน", icon: "chart" };

// ─── เปลี่ยนรหัสผ่านของตัวเอง (ผู้ใช้คนไหนก็ได้ที่ล็อกอินอยู่) ───────────────────
function ChangePasswordModal({ onClose }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    setErr("");
    if (newPw.length < 4) { setErr("รหัสผ่านใหม่ต้องอย่างน้อย 4 ตัวอักษร"); return; }
    if (newPw !== confirmPw) { setErr("ยืนยันรหัสผ่านใหม่ไม่ตรงกัน"); return; }
    if (newPw === oldPw) { setErr("รหัสผ่านใหม่ต้องต่างจากรหัสเดิม"); return; }
    setBusy(true);
    try {
      const res = await changeMyPassword(oldPw, newPw);
      if (res?.ok) { setDone(true); mlsToast("เปลี่ยนรหัสผ่านแล้ว", "success"); }
      else if (res?.reason === "wrong_old") setErr("รหัสผ่านเดิมไม่ถูกต้อง");
      else if (res?.reason === "too_short") setErr("รหัสผ่านใหม่สั้นเกินไป");
      else setErr("เปลี่ยนไม่สำเร็จ");
    } catch (e) { setErr("เปลี่ยนไม่สำเร็จ: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="เปลี่ยนรหัสผ่าน" sub="เปลี่ยนรหัสผ่านของบัญชีคุณเอง" onClose={onClose} locked={busy}>
      {done ? (
        <>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--accent-dk)", marginBottom: 16 }}>
            ✓ เปลี่ยนรหัสผ่านเรียบร้อยแล้ว — ครั้งต่อไปให้ใช้รหัสผ่านใหม่ในการเข้าสู่ระบบ
          </div>
          <div className="modal-actions"><Btn variant="accent" onClick={onClose}>เสร็จสิ้น</Btn></div>
        </>
      ) : (
        <>
          <Field label="รหัสผ่านเดิม">
            <Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
          </Field>
          <Field label="รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)">
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
          <Field label="ยืนยันรหัสผ่านใหม่">
            <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </Field>
          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 4 }}>{err}</div>}
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <Btn variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
            <Btn variant="accent" onClick={submit} disabled={busy || !oldPw || !newPw || !confirmPw}>
              {busy ? "กำลังเปลี่ยน..." : "เปลี่ยนรหัสผ่าน"}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── ลิงก์ตรงจากหน้าเครื่อง: /?go=setup-employees[&for=รหัส] → เปิด ตั้งค่า → พนักงาน (เฉพาะแอดมิน) ──
//   อ่านครั้งเดียวตอนโหลด (ก่อนล้าง URL) · ใช้ทั้งหน้าล็อกอิน (โชว์คำแนะนำ) และ Shell (เปิดแท็บ)
const BOOT_GO = (() => {
  try { const q = new URLSearchParams(window.location.search); return { go: q.get("go") || "", forCode: q.get("for") || "", used: false }; }
  catch { return { go: "", forCode: "", used: false }; }
})();
function Shell({ user, onLogout }) {
  const [shellLang] = useLang();
  const [tab, setTab] = useState(() => (BOOT_GO.go === "setup-employees" && isAdmin(user)) ? "setup" : "projects");
  useEffect(() => {
    if (!BOOT_GO.go) return;
    try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ }   // ล้าง ?go= ออกจาก URL (รีโหลดแล้วไม่เด้งซ้ำ)
    if (BOOT_GO.go === "setup-employees" && isAdmin(user) && BOOT_GO.forCode) {
      const msg = shellLang === "en" ? `Setup → Employees: press “Edit” on ${BOOT_GO.forCode} and choose a home machine/station`
                                     : `ตั้งค่า → พนักงาน: กด “แก้ไข” ที่ ${BOOT_GO.forCode} แล้วเลือกเครื่อง/สถานีประจำ`;
      setTimeout(() => mlsToast(msg, "info"), 400);   // รอ Toaster พร้อม (mount ทีหลัง Shell)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);   // หน้าต่างเปลี่ยนรหัสผ่านตัวเอง
  const [labelsPreselect, setLabelsPreselect] = useState(""); // release id ที่ส่งมาจากหน้ารายละเอียด Release เพื่อเปิดหน้าพิมพ์ QR แบบเลือกล็อตให้อัตโนมัติ
  const [verifyPreselect, setVerifyPreselect] = useState(""); // parent QR ส่งมาจากรายงานประกอบ/แพ็ก → เปิดหน้าตรวจเบอร์นั้นอัตโนมัติ
  const [verifyNonce, setVerifyNonce] = useState(0); // บั๊มพ์ทุกครั้งที่เข้าหน้าตรวจ → remount หน้าใหม่ (กดเมนูซ้ำ = เคลียร์ผลเดิม)
  useEffect(() => { loadColPrefs(); }, [user?.id]);   // โหลดลำดับคอลัมน์ (ค่ากลาง company + ของฉัน user) จาก DB ตอนเข้าระบบ

  const menu = menuForUser(user); // เมนูตามสิทธิ์ของ user คนนี้
  const currentLabel = MENU.flatMap((g) => g.items).find((i) => i.key === tab)?.label || "";

  function go(key, opts) {
    if (!canOpenTab(user, key)) return; // กันเปิดแท็บที่ไม่มีสิทธิ์ (เช่น ยิงจากปุ่มลึกๆ)
    setTab(key);
    setDrawerOpen(false);
    if (opts?.releaseId) setLabelsPreselect(opts.releaseId);
    if (opts?.qr) setVerifyPreselect(opts.qr);
    if (key === "verify") setVerifyNonce((n) => n + 1);   // เข้าหน้าตรวจทุกครั้ง → หน้าใหม่ (กดเมนูซ้ำ = เคลียร์ผลเดิม)
  }

  // (เอาการสแกนออกจากหน้าสำนักงานแล้ว — การสแกนทำที่หน้าเครื่อง /station เท่านั้น
  //  หน้าสำนักงานบนมือถือ/ไอแพดจึงไม่ต้องใช้กล้อง)

  return (
    <div className="app-shell">
      {/* ── Desktop sidebar ── */}
      <div className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="bolt" size={19} style={{ stroke: "var(--accent-ink)" }} /></div>
          <div>
            <div className="brand-name">Machining Line</div>
            <div className="brand-sub">ระบบบันทึกการทำงานเครื่องจักร</div>
          </div>
        </div>
        {menu.map((g) => (
          <div className="nav-group" key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map((it) => (
              <div key={it.key} className={`nav-item ${tab === it.key ? "active" : ""}`} onClick={() => go(it.key)}>
                <Icon name={it.icon} size={17} />{(shellLang === "en" && it.en) || it.label}
              </div>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{(user.name || "U").slice(0, 1)}</div>
            <div>
              <div className="user-name">{user.name}</div>
              <div className="user-role">{ROLE_LABELS[user.role] || user.role}</div>
            </div>
            <div style={{ marginLeft: "auto" }}><LangToggle /></div>
          </div>
          <div className="nav-item" onClick={() => setPwOpen(true)}><Icon name="lock" size={17} />เปลี่ยนรหัสผ่าน</div>
          <div className="nav-item logout-item" onClick={onLogout}><Icon name="logout" size={17} />ออกจากระบบ</div>
        </div>
      </div>

      {/* ── Mobile topbar ── */}
      <div className="topbar">
        <div className="icon-btn" onClick={() => setDrawerOpen(true)}><Icon name="menu" size={19} /></div>
        <div className="topbar-center">
          <div className="topbar-title">{currentLabel}</div>
          <div className="topbar-sub">{user.name} · {ROLE_LABELS[user.role] || user.role}</div>
        </div>
        <div className="topbar-actions">
          <div className="icon-btn" onClick={onLogout} title="ออกจากระบบ">
            <Icon name="logout" size={17} style={{ stroke: "var(--danger)" }} />
          </div>
          <div className="topbar-avatar" onClick={() => setDrawerOpen(true)}>{(user.name || "U").slice(0, 1)}</div>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      <div className={`drawer-backdrop ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)} />
      <div className={`drawer ${drawerOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Icon name="bolt" size={19} style={{ stroke: "var(--accent-ink)" }} /></div>
          <div>
            <div className="brand-name">Machining Line</div>
            <div className="brand-sub">{user.name} · {ROLE_LABELS[user.role] || user.role}</div>
          </div>
        </div>
        {menu.map((g) => (
          <div className="nav-group" key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map((it) => (
              <div key={it.key} className={`nav-item ${tab === it.key ? "active" : ""}`} onClick={() => go(it.key)}>
                <Icon name={it.icon} size={17} />{(shellLang === "en" && it.en) || it.label}
              </div>
            ))}
          </div>
        ))}
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border-soft)", paddingTop: 14, paddingLeft: 6 }}>
          <LangToggle />
        </div>
        <div className="nav-item" onClick={() => { setDrawerOpen(false); setPwOpen(true); }} style={{ marginTop: 8 }}>
          <Icon name="lock" size={17} />เปลี่ยนรหัสผ่าน
        </div>
        <div className="nav-item logout-item" onClick={onLogout} style={{ marginTop: 8 }}>
          <Icon name="logout" size={17} />ออกจากระบบ
        </div>
      </div>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}

      {/* ── Page content ── */}
      <div className="content">
        <div className="content-inner">
          {tab === "release" && <ReleasePage user={user} goTo={go} />}
          {tab === "labels" && <QrLabelsPage initialReleaseId={labelsPreselect} onConsumeInitial={() => setLabelsPreselect("")} />}
          {tab === "report" && <ReportPage goTo={go} />}
          {tab === "verify" && <AssemblyVerifyPage key={"vf" + verifyNonce} initialQr={verifyPreselect} onConsumeInitial={() => setVerifyPreselect("")} />}
          {tab === "daily" && <DailyReportPage />}
          {tab === "machines" && <MachinesSummaryPage />}
          {tab === "machinereports" && canManage(user) && <MachineReportsPage />}
          {tab === "projects" && <ProjectsPage user={user} goTo={go} />}
          {tab === "materials" && <MaterialsPage user={user} />}
          {tab === "parts" && <PartsSummaryPage />}
          {tab === "setup" && isAdmin(user) && <SetupPage />}
        </div>
      </div>

      {/* ── Mobile bottom nav ── */}
      <div className="bottom-nav">
        <div className={`bottom-nav-item ${tab === BOTTOM_LEFT.key ? "active" : ""}`} onClick={() => go(BOTTOM_LEFT.key)}>
          <Icon name={BOTTOM_LEFT.icon} size={20} /><span>{BOTTOM_LEFT.label}</span>
        </div>
        <div className={`bottom-nav-item ${tab === BOTTOM_LEFT2.key ? "active" : ""}`} onClick={() => go(BOTTOM_LEFT2.key)}>
          <Icon name={BOTTOM_LEFT2.icon} size={20} /><span>{BOTTOM_LEFT2.label}</span>
        </div>
        <div className={`bottom-nav-item ${tab === BOTTOM_RIGHT.key ? "active" : ""}`} onClick={() => go(BOTTOM_RIGHT.key)}>
          <Icon name={BOTTOM_RIGHT.icon} size={20} /><span>{BOTTOM_RIGHT.label}</span>
        </div>
        <div className="bottom-nav-item" onClick={() => setDrawerOpen(true)}>
          <Icon name="more" size={20} /><span>เพิ่มเติม</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 1) RELEASE PRODUCTION — ปล่อยงาน + สร้าง QR ต่อชิ้น
// ══════════════════════════════════════════════════════════════════════════
// Postgres unique-violation code, used to give a friendly Thai message
// instead of a raw DB error when someone reuses a code that must be unique.
function isDuplicateError(e) {
  return e?.code === "23505" || /duplicate key|already exists/i.test(e?.message || "");
}

// ─── Add Release popup helpers ──────────────────────────────────────────────
// น้ำหนัก/ชิ้น = (ความยาว มม. → ม.) × น้ำหนัก/เมตร — สูตรเดียวกับตอนนำเข้า Excel
const gnum = (v) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};
function rowWeightPcs(row) {
  const len = gnum(row.length_mm), wpm = gnum(row.weight_per_m);
  return len && wpm ? Number(((len / 1000) * wpm).toFixed(4)) : null;
}
function rowTotalKg(row) {
  const q = gnum(row.qty), wpcs = rowWeightPcs(row);
  return q && wpcs ? Number((q * wpcs).toFixed(2)) : null;
}
// รวมวันที่ที่เลือก + เวลาปัจจุบัน เพื่อให้ backdate ได้แต่ยังเรียงลำดับภายในวันได้
function dateToIso(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const now = new Date();
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  return d.toISOString();
}
// Release Order ต้องเป็นรูปแบบ P-<ตัวเลข> เช่น P-009 (ตามฟอร์มจริงของโรงงาน)
// P-ตัวเลข + ต่อท้ายด้วยข้อความในวงเล็บได้ เช่น "P-184 (L13-L15)" (ไว้โน้ตว่าปล่อยอะไรไปบ้าง)
const RELEASE_ORDER_RE = /^P-\d+(\s*\(.*\))?$/i;
function normalizeReleaseOrder(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  if (/^\d+$/.test(s)) return `P-${s.padStart(3, "0")}`; // พิมพ์เลขล้วน → เติม P- ให้
  return s;
}
// ลำดับคอลัมน์ตามฟอร์ม Excel จริง (Image): [No.] Code, Qty, Length, Weight/M, Material, [Total Kg], Remark
// __skip__ = คอลัมน์ที่ระบบคำนวณเอง (Total Kg) — รับค่าที่วางมาแต่ทิ้ง แล้วคิดใหม่
const PASTE_COLS = ["code", "qty", "length_mm", "weight_per_m", "material", "__skip__", "remark"];

// จับคอลัมน์จาก "ชื่อหัวตาราง" (header) — รองรับ MDF / REV และคอลัมน์สลับลำดับได้
const HEADER_ALIASES = {
  code: [/^code$/i, /เบอร์/i, /part\s*no/i, /part\s*number/i],
  rev: [/^rev\.?$/i, /revision/i],
  qty: [/qty/i, /q'?ty/i, /จำนวน/i],
  length_mm: [/length/i, /ยาว/i, /ความยาว/i],
  weight_per_m: [/weight\s*\/?\s*m/i, /\bw\/?m\b/i, /น้ำหนัก\s*\/?\s*เมตร/i, /weight\s*per/i],
  material: [/material/i, /วัสดุ/i, /วัตถุดิบ/i, /\binv/i],
  remark: [/remark/i, /หมายเหตุ/i],
};
function matchHeaderCell(cell) {
  const s = String(cell ?? "").trim();
  if (!s) return null;
  for (const [field, pats] of Object.entries(HEADER_ALIASES)) {
    if (pats.some((re) => re.test(s))) return field;
  }
  return null;
}
function looksLikeHeader(cells) {
  return cells.filter((c) => matchHeaderCell(c)).length >= 2;
}

function parsePastedRows(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const grid = lines.map((l) => l.split("\t")).filter((cells) => cells.some((c) => String(c).trim() !== ""));
  if (grid.length === 0) return [];

  // ── โหมดมีหัวตาราง: จับคอลัมน์จากชื่อหัว (รองรับ MDF/REV + สลับลำดับ) ──
  if (looksLikeHeader(grid[0])) {
    const map = grid[0].map(matchHeaderCell);
    return grid.slice(1).map((cells) => {
      const row = {};
      map.forEach((field, i) => {
        if (!field) return;
        if (cells[i] !== undefined) row[field] = String(cells[i]).trim();
      });
      return row;
    });
  }

  // ── โหมดไม่มีหัวตาราง: ใช้ลำดับคงที่แบบเดิม ──
  return grid.map((cells) => {
    let cols = cells;
    if (cols.length === PASTE_COLS.length + 1 && /^\d+$/.test(String(cols[0]).trim())) {
      cols = cols.slice(1);
    }
    const row = {};
    PASTE_COLS.forEach((key, i) => {
      if (key === "__skip__") return;
      if (cols[i] !== undefined) row[key] = String(cols[i]).trim();
    });
    return row;
  });
}

// ─── Quick-create: Project ──────────────────────────────────────────────────
// Lets the user spin up a new project right from the Release page instead of
// hopping over to Setup — keeps "create project → create part → release" as
// one uninterrupted flow.
function QuickAddProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useUndoable({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    const code = (form.code || "").trim();
    const name = (form.name || "").trim();
    if (!code || !name) { setErr("กรอกรหัสโปรเจคและชื่อโปรเจคให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      const project = await insertRow("projects", { code, name });
      onCreated(project);
      onClose();
    } catch (e2) {
      setErr(isDuplicateError(e2) ? `รหัสโปรเจค "${code}" มีอยู่แล้ว กรุณาใช้รหัสอื่น` : "เกิดข้อผิดพลาด: " + e2.message);
    }
    setBusy(false);
  }

  return (
    <Modal title="โปรเจคใหม่" sub="1 โปรเจคสามารถมีได้หลาย Part และหลาย Release" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="รหัสโปรเจค *">
          <Input autoFocus value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="เช่น PRJ001" />
        </Field>
        <Field label="ชื่อโปรเจค *">
          <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น สายการผลิตชิ้นส่วน A" />
        </Field>
        {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 2 }}>{err}</div>}
        <div className="modal-actions">
          <Btn type="button" variant="ghost" onClick={onClose}>ยกเลิก</Btn>
          <Btn type="submit" variant="accent" disabled={busy}>{busy ? "กำลังสร้าง..." : "สร้างโปรเจค"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ─── Quick-create: Part (+ Routing) ─────────────────────────────────────────
// A project needs at least one Part before it can be Released, so this
// mirrors PartMasterCrud but scoped to one project and reachable inline.
function QuickAddPartModal({ project, onClose, onCreated }) {
  const [operations, setOperations] = useState([]);
  const [lang] = useLang();
  const [form, setForm] = useUndoable({ routing: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { listRows("operations", { order: "seq" }).then(setOperations); }, []);

  function toggleOp(name) {
    setForm((f) => {
      const has = (f.routing || []).includes(name);
      return { ...f, routing: has ? f.routing.filter((x) => x !== name) : [...(f.routing || []), name] };
    });
  }

  async function submit(e) {
    e.preventDefault();
    const part_no = (form.part_no || "").trim();
    if (!part_no) { setErr("กรอกรหัส Part ให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      const part = await insertRow("part_master", {
        project_id: project.id, part_no, part_name: (form.part_name || "").trim() || part_no,
        material: (form.material || "").trim() || null,
        unit_weight: Number(form.unit_weight || 0),
        default_length_mm: form.default_length_mm === "" || form.default_length_mm == null ? null : Number(form.default_length_mm),
        routing: form.routing || [],
      });
      onCreated(part);
      onClose();
    } catch (e2) {
      setErr(isDuplicateError(e2) ? `Part "${part_no}" มีอยู่แล้วในโปรเจคนี้` : "เกิดข้อผิดพลาด: " + e2.message);
    }
    setBusy(false);
  }

  return (
    <Modal title="Part ใหม่" sub={`ในโปรเจค ${project.code} — ${project.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid-2">
          <Field label="รหัส Part *">
            <Input autoFocus value={form.part_no || ""} onChange={(e) => setForm({ ...form, part_no: e.target.value })} />
          </Field>
          <Field label="ชื่อ Part">
            <Input value={form.part_name || ""} onChange={(e) => setForm({ ...form, part_name: e.target.value })} />
          </Field>
          <Field label="วัสดุ">
            <Input value={form.material || ""} onChange={(e) => setForm({ ...form, material: e.target.value })} />
          </Field>
          <Field label="น้ำหนัก/ชิ้น (กก.)">
            <Input type="number" step="0.01" value={form.unit_weight || ""} onChange={(e) => setForm({ ...form, unit_weight: e.target.value })} />
          </Field>
          <Field label="ความยาว/ชิ้น (มม.)">
            <Input type="number" step="0.1" value={form.default_length_mm || ""} onChange={(e) => setForm({ ...form, default_length_mm: e.target.value })} />
          </Field>
        </div>
        <div className="label-el">Routing — เลือกขั้นตอนที่ part นี้ต้องผ่านตามลำดับ</div>
        <div className="chip-row" style={{ marginBottom: 6 }}>
          {operations.map((o) => {
            const active = (form.routing || []).includes(o.name);
            return (
              <span key={o.id} onClick={() => toggleOp(o.name)} className={`chip ${active ? "active" : ""}`}>
                {opLabel(o.name, lang)}{active ? ` (${form.routing.indexOf(o.name) + 1})` : ""}
              </span>
            );
          })}
          {operations.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>ยังไม่มีขั้นตอนงาน — ไปตั้งค่าที่ Setup ก่อน</span>}
        </div>
        {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        <div className="modal-actions">
          <Btn type="button" variant="ghost" onClick={onClose}>ยกเลิก</Btn>
          <Btn type="submit" variant="accent" disabled={busy}>{busy ? "กำลังสร้าง..." : "สร้าง Part"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ══ บันทึก Material (INV Code) — แยกตามโปรเจค + Center Stock ════════════════════════════
//   ข้อมูล: materials_list / material_save / materials_upsert_many / material_delete / materials_backfill
//   ตอนสร้าง Release: Weight/M ที่เว้นว่าง → หา INV ของโปรเจคก่อน → ไม่มี (หรือว่าง) ค่อยใช้ Center Stock
//   INV ใหม่ที่ไม่มีทั้ง 2 ที่ → บันทึกเข้าโปรเจคหลังสร้าง Release (materials_add_from_release)
const matKey = (s) => String(s ?? "").trim().toUpperCase();
// ★ OFF CUT (เศษ) = ไม่บันทึกน้ำหนัก — กรอก Weight/M เองทุกครั้ง (ตรงกับ _mat_is_scrap ใน SQL)
//   INV ที่ขึ้นต้น OFF CUT / OFFCUT / OFF-CUT (ไม่สนช่องว่าง . - _) หรือมีคำว่า "เศษ"
const isScrapInv = (s) => { const t = String(s ?? ""); return t.toUpperCase().replace(/[\s._-]+/g, "").startsWith("OFFCUT") || t.includes("เศษ"); };
const matNum = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
// ตัวเลขทศนิยมละเอียดกว่า fmtNum (Weight/M มักมี 3 ตำแหน่ง เช่น 1.845)
const fmtDec = (n, d = 4) => (n == null || n === "" || !Number.isFinite(Number(n)) ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }));
const matBarKg = (m) => { const l = matNum(m.length_mm), w = matNum(m.weight_per_m); return l && w ? (l / 1000) * w : null; };
const matTotKg = (m) => { const b = matBarKg(m), q = matNum(m.qty); return b != null && q != null ? b * q : null; };
const matMissing = (m) => [m.weight_per_m == null && !isScrapInv(m.inv_code) ? "wpm" : null, m.length_mm == null ? "len" : null, m.qty == null ? "qty" : null].filter(Boolean);
// ดัชนีค้นหา INV → { proj, center } จากผล getMaterials
function buildMatIndex(res) {
  const byKey = new Map();
  if (res && res.ok) {
    for (const m of res.project || []) { const k = matKey(m.inv_code); const e = byKey.get(k) || {}; e.proj = m; byKey.set(k, e); }
    for (const m of res.center || []) { const k = matKey(m.inv_code); const e = byKey.get(k) || {}; e.center = m; byKey.set(k, e); }
  }
  return byKey;
}
// Weight/M ของ INV: โปรเจคก่อน · โปรเจคไม่มีค่า/ไม่มี INV → Center Stock
//   คืน { scope: "project"|"center"|null, wpm, row, inProject, inCenter, scrap }
//   เศษ (OFF CUT) → wpm = null เสมอ (ไม่เติมอัตโนมัติ · กรอกเอง)
function matLookup(idx, inv) {
  const k = matKey(inv);
  if (!k || !idx) return { scope: null, wpm: null, row: null, inProject: false, inCenter: false, scrap: false };
  if (isScrapInv(inv)) { const e = idx.get(k) || {}; return { scope: null, wpm: null, row: e.proj || e.center || null, inProject: !!e.proj, inCenter: !!e.center, scrap: true }; }
  const e = idx.get(k) || {};
  const pw = e.proj ? matNum(e.proj.weight_per_m) : null;
  const cw = e.center ? matNum(e.center.weight_per_m) : null;
  if (pw != null) return { scope: "project", wpm: pw, row: e.proj, inProject: true, inCenter: !!e.center };
  if (cw != null) return { scope: "center", wpm: cw, row: e.center, inProject: !!e.proj, inCenter: true };
  return { scope: e.proj ? "project" : e.center ? "center" : null, wpm: null, row: e.proj || e.center || null, inProject: !!e.proj, inCenter: !!e.center };
}
const matReasonText = (r, L) => ({
  duplicate: L("INV นี้มีอยู่แล้วในรายการนี้", "This INV already exists in this list"),
  bad_inv: L("ต้องกรอก INV Code", "INV Code is required"),
  bad_number: L("ตัวเลขไม่ถูกต้อง (ติดลบไม่ได้ · จำนวนต้องเป็นจำนวนเต็ม)", "Invalid number (no negatives · qty must be a whole number)"),
  forbidden: L("ไม่มีสิทธิ์แก้ไข (เฉพาะแอดมิน/ออฟฟิศ)", "No permission (admin/office only)"),
  unauthorized: L("หมดเวลาเข้าสู่ระบบ — ล็อกอินใหม่", "Session expired — log in again"),
  not_installed: L("ยังไม่ได้ติดตั้ง — รัน migration-materials.sql ใน Supabase ก่อน", "Not installed — run migration-materials.sql in Supabase first"),
  not_found: L("ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)", "Not found (maybe deleted)"),
  no_project: L("ไม่พบโปรเจค", "Project not found"),
  network: L("เน็ตสะดุด ลองใหม่อีกครั้ง", "Network problem, try again"),
}[r] || L("บันทึกไม่สำเร็จ", "Save failed") + (r ? ` (${r})` : ""));

// ── แก้ 1 รายการ ──
function MaterialEditModal({ row, scopeLabel, onClose, onSaved }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const [f, setF] = useState(() => ({
    inv: row?.inv_code || "", wpm: row?.weight_per_m ?? "", len: row?.length_mm ?? "", qty: row?.qty ?? "", note: row?.note || "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const prev = { weight_per_m: isScrapInv(f.inv) ? null : gnum(f.wpm), length_mm: gnum(f.len), qty: gnum(f.qty) };
  async function save(e) {
    e && e.preventDefault();
    if (!f.inv.trim()) { setErr(matReasonText("bad_inv", L)); return; }
    setBusy(true); setErr("");
    const r = await saveMaterial({ id: row.id, inv: f.inv, wpm: String(f.wpm ?? "").replace(/,/g, ""), len: String(f.len ?? "").replace(/,/g, ""), qty: String(f.qty ?? "").replace(/,/g, ""), note: f.note });
    setBusy(false);
    if (!r || !r.ok) { setErr(matReasonText(r?.reason, L)); return; }
    auditRecord("material_update", "material", row.id, { inv: f.inv.trim(), scope: scopeLabel, before: { inv: row.inv_code, wpm: row.weight_per_m, len: row.length_mm, qty: row.qty }, after: { wpm: f.wpm, len: f.len, qty: f.qty } });
    onSaved && onSaved(r.row);
  }
  return (
    <Modal title={L("แก้ไข Material", "Edit material")} sub={scopeLabel} onClose={onClose} locked={busy}>
      <form onSubmit={save}>
        <div className="grid-2">
          <Field label="INV Code *"><Input autoFocus value={f.inv} onChange={set("inv")} /></Field>
          <Field label={L("น้ำหนักต่อเมตร (กก./ม.)", "Weight/M (kg/m)")}>
            {isScrapInv(f.inv)
              ? <Input value="" disabled placeholder={L("เศษ — ไม่บันทึก (กรอกเองตอนสร้าง Release)", "Scrap — not stored (type it when creating a release)")} />
              : <Input value={f.wpm} onChange={set("wpm")} inputMode="decimal" placeholder="เช่น 1.845" />}
          </Field>
          <Field label={L("ความยาว/เส้น (มม.)", "Length/bar (mm)")}><Input value={f.len} onChange={set("len")} inputMode="decimal" placeholder="เช่น 6000" /></Field>
          <Field label={L("จำนวน (เส้น)", "Qty (bars)")}><Input value={f.qty} onChange={set("qty")} inputMode="numeric" /></Field>
        </div>
        <Field label={L("หมายเหตุ", "Note")}><Input value={f.note} onChange={set("note")} /></Field>
        <div className="mat-preview">
          {L("น้ำหนัก/เส้น", "Weight/bar")} <b>{matBarKg(prev) != null ? fmtDec(matBarKg(prev), 3) : "-"}</b> {L("กก.", "kg")}
          <span> · </span>{L("น้ำหนักรวม", "Total")} <b>{matTotKg(prev) != null ? fmtDec(matTotKg(prev), 2) : "-"}</b> {L("กก.", "kg")}
        </div>
        {err && <div className="mat-err">{err}</div>}
        <div className="modal-actions">
          <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>{L("ยกเลิก", "Cancel")}</Btn>
          <Btn type="submit" variant="accent" disabled={busy}>{busy ? L("กำลังบันทึก...", "Saving...") : L("บันทึก", "Save")}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ── เพิ่ม / แก้ไขหลายรายการ (ตารางกรอก · ก็อปจาก Excel มาวางได้) ─────────────────────────────
//   mode "add"  : แถวว่าง 5 แถว · INV ที่มีอยู่แล้วติดป้าย "มีแล้ว" → ข้าม (หรือติ๊กอัปเดตทับ)
//   mode "edit" : แสดงทุกรายการของขอบเขตนี้ให้แก้ในตาราง (+ แถวว่างท้ายตาราง) · ช่องที่แก้ = สีเหลือง
//   วาง (Ctrl+V) ได้ทุกที่ในหน้าต่าง · ก็อปมาหลายคอลัมน์ → จับคอลัมน์จากหัวตาราง หรือเดาจากข้อมูล (INV/ความยาว/Weight/M/จำนวน/หมายเหตุ)
//     แล้วขึ้นแถบให้เปลี่ยนได้ว่าแต่ละคอลัมน์ลงช่องไหน · คอลัมน์เดียว = ลงช่องที่คลิก ไล่ลงไป
//   INV ที่มีในตารางอยู่ก่อนแล้ว = อัปเดตแถวนั้น (ช่องว่างที่วางมาไม่ลบค่าเดิม) · นอกนั้นลงแถวว่างถัดไป (ซ้ำกันเอง = แยกแถว ขึ้นป้าย "ซ้ำ")
const MAT_COLS = ["inv", "wpm", "len", "qty", "note"];
const matRid = () => Math.random().toString(36).slice(2);
const MAT_BLANK = () => ({ key: matRid(), id: null, inv: "", wpm: "", len: "", qty: "", note: "", orig: null });
const matStr = (v) => (v == null ? "" : String(v));
const matRowFrom = (m) => {
  const o = { inv: matStr(m.inv_code), wpm: matStr(m.weight_per_m), len: matStr(m.length_mm), qty: matStr(m.qty), note: matStr(m.note) };
  return { key: matRid(), id: m.id, ...o, orig: o };
};
const matBlank = (r) => MAT_COLS.every((k) => !String(r[k] ?? "").trim());
const matNormNum = (v) => { const t = String(v ?? "").trim(); if (!t) return ""; const n = gnum(t); return n == null ? t : String(n); };
const matCellChanged = (r, k) => !!r.orig && (k === "inv" || k === "note" ? String(r[k] ?? "").trim() !== String(r.orig[k] ?? "").trim() : matNormNum(r[k]) !== matNormNum(r.orig[k]));
const matRowChanged = (r) => !!r.orig && MAT_COLS.some((k) => matCellChanged(r, k));
const matBadNum = (v, int) => { const t = String(v ?? "").trim(); if (!t) return false; const n = gnum(t); return n == null || n < 0 || (int && !Number.isInteger(n)); };
// ข้อความที่ก็อปจาก Excel → ตาราง [[cell]] — รองรับเซลล์ในเครื่องหมายคำพูด (มีขึ้นบรรทัด/แท็บในเซลล์) · CRLF / CR / LF
function matParseTsv(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  const out = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.map((c) => c.replace(/\s+/g, " ").trim())).filter((r) => r.some((c) => c !== ""));
}
const MAT_HEADER = {
  inv: [/\binv/i, /inventory/i, /material/i, /\bcode\b/i, /item\s*no/i, /รหัส/i, /วัสดุ/i],
  wpm: [/weight\s*\/?\s*m\b/i, /\bw\s*\/\s*m\b/i, /kg\s*\/\s*m/i, /กก\.?\s*\/\s*ม/i, /น้ำหนัก.*(เมตร|ม\.)/i, /unit\s*weight/i],
  len: [/length/i, /\blen\b/i, /ยาว/i],
  qty: [/q'?ty/i, /quantity/i, /จำนวน/i, /\bpcs\b/i, /^bars?$/i, /เส้น$/],
  note: [/remark/i, /note/i, /หมายเหตุ/i, /desc/i, /รายละเอียด/i],
};
const matIsNumTxt = (v) => /^-?[\d,]*\.?\d+$/.test(String(v).replace(/\s/g, ""));
const matHeaderOf = (c) => Object.keys(MAT_HEADER).find((k) => MAT_HEADER[k].some((re) => re.test(c))) || null;
// เดาว่าคอลัมน์ไหนคืออะไรจาก "ข้อมูล" (ไม่มีหัวตาราง): INV = รหัส (ไม่ใช่ตัวเลขล้วน/ไม่ใช่ภาษาไทย) · ความยาว = ตัวเลข ≥300
//   · Weight/M = ทศนิยม <100 · จำนวน = จำนวนเต็ม · หมายเหตุ = ข้อความที่เหลือ · เลขลำดับ 1,2,3… = ไม่ใช้
function matGuessMap(grid) {
  const n = Math.max(0, ...grid.map((r) => r.length));
  const st = [];
  for (let j = 0; j < n; j++) {
    const vals = grid.map((r) => String(r[j] ?? "").trim()).filter(Boolean);
    const nums = vals.filter(matIsNumTxt).map((v) => gnum(v)).filter((x) => x != null);
    const sorted = [...nums].sort((x, y) => x - y);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const codeish = vals.filter((v) => !matIsNumTxt(v) && !/[฀-๿]/.test(v) && v.length <= 40).length;
    st.push({
      j, empty: !vals.length, numRatio: vals.length ? nums.length / vals.length : 0, codeRatio: vals.length ? codeish / vals.length : 0,
      allInt: nums.length > 0 && nums.every(Number.isInteger), hasDec: nums.some((x) => !Number.isInteger(x)), med,
      seq: nums.length === grid.length && grid.length > 1 && grid.every((r, i) => gnum(r[j]) === i + 1),
    });
  }
  const map = Array(n).fill(null); const used = new Set();
  const free = () => st.filter((x) => map[x.j] == null && !x.empty && !x.seq);
  const take = (k, c) => { if (c && !used.has(k)) { map[c.j] = k; used.add(k); } };
  take("inv", free().find((x) => x.numRatio < 0.5 && x.codeRatio >= 0.6));
  const numCols = () => free().filter((x) => x.numRatio >= 0.8);
  take("len", numCols().find((x) => x.med != null && x.med >= 300));
  take("wpm", numCols().find((x) => x.hasDec && x.med != null && x.med < 100));
  take("qty", numCols().find((x) => x.allInt));
  take("wpm", numCols().find((x) => x.med != null && x.med < 100));
  take("note", free().find((x) => x.numRatio < 0.5));
  return map;
}
// อ่านคลิปบอร์ด → { grid, headers|null, map, how: "header"|"guess"|"single" }
function matParseClip(text, startCol) {
  const all = matParseTsv(text);
  if (!all.length) return null;
  const n = Math.max(...all.map((r) => r.length));
  if (n <= 1) return { grid: all, headers: null, map: [startCol || "inv"], how: "single" };
  const hdr = all[0].map(matHeaderOf);
  const firstRowText = all[0].every((c) => !c || !matIsNumTxt(c));
  const laterNums = all.slice(1).some((r) => r.some((c) => c && matIsNumTxt(c)));
  if (hdr.filter(Boolean).length >= 2 || (hdr.filter(Boolean).length >= 1 && firstRowText && laterNums && all.length > 1)) {
    const seen = new Set();
    const map = hdr.map((k) => (k && !seen.has(k) ? (seen.add(k), k) : null));
    return { grid: all.slice(1), headers: all[0], map, how: "header" };
  }
  return { grid: all, headers: null, map: matGuessMap(all), how: "guess" };
}
// วางลงตาราง (คืน rows ใหม่) · base = ตารางก่อนวาง
//   มีคอลัมน์ INV → INV ที่ "มีในตารางก่อนวาง" = อัปเดตแถวนั้น (ช่องว่างที่วางมาไม่ลบค่าเดิม) · นอกนั้นลงแถวว่างถัดไปทีละแถว
//     (INV ซ้ำกันเองในสิ่งที่วาง = แยกแถว → ขึ้นป้าย "ซ้ำ" ให้เห็น ไม่รวมเงียบๆ · แถวที่ไม่มี INV ก็ลงให้เห็น)
//   ไม่มีคอลัมน์ INV → ตามตำแหน่ง ลงไปทีละแถวจากแถวที่คลิก
function matApplyPaste(base, clip, startRow) {
  const next = base.map((r) => ({ ...r }));
  const known = new Map();
  base.forEach((r, i) => { const k = matKey(r.inv); if (k && !known.has(k)) known.set(k, i); });
  const hasInv = clip.map.includes("inv");
  let cursor = Math.max(0, startRow);
  const nextFree = () => {
    while (cursor < next.length && !matBlank(next[cursor])) cursor++;
    if (cursor >= next.length) next.push(MAT_BLANK());
    return cursor;
  };
  clip.grid.forEach((cells, i) => {
    const data = {};
    clip.map.forEach((k, j) => { if (k && cells[j] !== undefined && String(cells[j]).trim() !== "") data[k] = cells[j]; });
    if (!Object.keys(data).length) return;
    if (hasInv) {
      const hit = data.inv ? known.get(matKey(data.inv)) : undefined;
      if (hit !== undefined) { Object.entries(data).forEach(([k, v]) => { if (k !== "inv") next[hit][k] = v; }); return; }
      const idx = nextFree();
      next[idx] = { ...next[idx], ...data };
      cursor = idx + 1;
    } else {
      const idx = startRow + i;
      while (next.length <= idx) next.push(MAT_BLANK());
      next[idx] = { ...next[idx], ...data };
    }
  });
  return next;
}
const MAT_FIELD_LABEL = (k, L) => ({ inv: "INV Code", wpm: "Weight/M", len: L("ความยาว/เส้น", "Length/bar"), qty: L("จำนวน", "Qty"), note: L("หมายเหตุ", "Note") }[k] || k);

function MaterialGridModal({ mode = "add", projectId, scopeLabel, index, existing = [], onClose, onSaved }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const edit = mode === "edit";
  const [rows, setRows] = useState(() => (edit ? [...existing.map(matRowFrom), ...Array.from({ length: 3 }, MAT_BLANK)] : Array.from({ length: 5 }, MAT_BLANK)));
  const [updateDup, setUpdateDup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const [pinfo, setPinfo] = useState(null);      // การวางล่าสุด (ไว้เปลี่ยนคอลัมน์): { base, clip, startRow }
  const wrapRef = useRef(null);
  const firstRef = useRef(null);
  const inScope = (inv) => { const e = index && index.get(matKey(inv)); return !!(e && (projectId ? e.proj : e.center)); };
  const setCell = (key, k, v) => { setPinfo(null); setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [k]: v } : r))); };
  // โฟกัสช่อง INV ของแถวว่างแรก → เปิดหน้าต่างแล้วกด Ctrl+V ได้ทันที
  useEffect(() => { const t = setTimeout(() => { try { firstRef.current && firstRef.current.focus(); } catch { /* ignore */ } }, 60); return () => clearTimeout(t); }, []);
  const firstBlank = (rs) => { const i = rs.findIndex(matBlank); return i >= 0 ? i : rs.length; };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  function pasteText(text, startRow, startCol) {
    const clip = matParseClip(text, startCol || "inv");
    if (!clip || !clip.grid.length) return false;
    const base = rowsRef.current;
    const sr = startRow == null ? firstBlank(base) : startRow;
    setRows(matApplyPaste(base, clip, sr));
    setPinfo(clip.how === "single" ? null : { base, clip, startRow: sr });
    setFlash(L(`วางแล้ว ${clip.grid.length} แถว`, `Pasted ${clip.grid.length} row(s)`));
    setTimeout(() => setFlash(""), 2600);
    return true;
  }
  // เปลี่ยนว่าคอลัมน์ที่วางมาไปลงช่องไหน → วางใหม่จากตารางก่อนวาง
  function remap(j, k) {
    if (!pinfo) return;
    const map = pinfo.clip.map.map((x, i) => (i === j ? (k || null) : (k && x === k ? null : x)));
    const clip = { ...pinfo.clip, map };
    setPinfo({ ...pinfo, clip });
    setRows(matApplyPaste(pinfo.base, clip, pinfo.startRow));
  }
  // จับการวางทั้งหน้าต่าง: ในช่องตาราง = เริ่มที่ช่องนั้น · นอกช่อง = แถวว่างแรก คอลัมน์ INV
  useEffect(() => {
    function onPaste(e) {
      const text = e.clipboardData ? e.clipboardData.getData("text") : "";
      if (!text) return;
      const el = e.target;
      const inGrid = el && el.closest && wrapRef.current && wrapRef.current.contains(el) && el.dataset && el.dataset.col;
      if (inGrid) {
        if (!text.includes("\t") && !text.includes("\n")) return;   // ค่าเดียว → วางปกติในช่องนั้น
        e.preventDefault();
        pasteText(text, Number(el.dataset.row), el.dataset.col);
        return;
      }
      const tag = (el && el.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (el && el.isContentEditable)) return;   // ช่องอื่นนอกตาราง → ปล่อยปกติ
      e.preventDefault();
      pasteText(text, null, "inv");
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);
  const filled = rows.filter((r) => !matBlank(r));
  const newRows = filled.filter((r) => !r.id);
  const changedRows = rows.filter((r) => r.id && matRowChanged(r));
  const noInv = filled.filter((r) => !String(r.inv).trim());
  const badRows = filled.filter((r) => matBadNum(r.wpm) || matBadNum(r.len) || matBadNum(r.qty, true));
  const keyCount = new Map();
  filled.forEach((r) => { const k = matKey(r.inv); if (k) keyCount.set(k, (keyCount.get(k) || 0) + 1); });
  const dupInGrid = (r) => (keyCount.get(matKey(r.inv)) || 0) > 1;
  const dupDb = edit ? [] : newRows.filter((r) => inScope(r.inv));
  const nWork = edit ? changedRows.length + newRows.length : newRows.length;
  const clean = (x) => ({ inv: String(x.inv).trim(), wpm: isScrapInv(x.inv) ? "" : String(x.wpm ?? "").replace(/,/g, ""), len: String(x.len ?? "").replace(/,/g, ""), qty: String(x.qty ?? "").replace(/,/g, ""), note: x.note });

  async function save() {
    if (noInv.length) { setErr(L(`มี ${noInv.length} แถวที่ยังไม่มี INV Code`, `${noInv.length} row(s) have no INV Code`)); return; }
    if (badRows.length) { setErr(L(`ตัวเลขไม่ถูกต้อง ${badRows.length} แถว (ช่องสีแดง)`, `${badRows.length} row(s) have invalid numbers (red cells)`)); return; }
    if (filled.some(dupInGrid)) { setErr(L("มี INV ซ้ำกันในตาราง (ป้าย \"ซ้ำ\") — ลบหรือแก้ให้เหลือแถวเดียว", "The same INV appears twice (\"dup\" tag) — keep one row")); return; }
    if (!nWork) { setErr(edit ? L("ยังไม่ได้แก้อะไร", "Nothing changed") : L("กรอกอย่างน้อย 1 INV", "Enter at least one INV")); return; }
    setBusy(true); setErr("");
    const fails = [];
    const skippedExisting = [];      // INV ที่มีอยู่แล้ว (ไม่ได้ติ๊กอัปเดตทับ) = ข้ามตามตั้งใจ ไม่นับว่าพลาด
    let nUpd = 0, nAdd = 0, nUpdDup = 0;
    const doneKeys = new Set();
    // 1) แก้รายการเดิม (ทีละแถว — ล้างช่องได้)
    for (const r of changedRows) {
      const res = await saveMaterial({ id: r.id, ...clean(r) });
      if (res && res.ok) { nUpd++; doneKeys.add(r.key); } else fails.push(`${r.inv || "-"}: ${matReasonText(res?.reason, L)}`);
    }
    // 2) เพิ่มรายการใหม่ (ทีเดียว)
    if (newRows.length) {
      const res = await upsertMaterials(projectId, newRows.map(clean), updateDup ? "update" : "skip");
      if (res && res.ok) {
        nAdd = res.added || 0; nUpdDup = res.updated || 0;
        const why = { exists: L("มีแล้ว", "exists"), dup_in_list: L("ซ้ำในรายการ", "repeated"), bad_inv: L("ไม่มี INV", "no INV"), bad_number: L("ตัวเลขผิด", "bad number") };
        const failKeys = new Set();
        (res.skipped || []).forEach((sk) => {
          if (sk.reason === "exists") { skippedExisting.push(sk.inv); return; }
          failKeys.add(matKey(sk.inv)); fails.push(`${sk.inv || "-"}: ${why[sk.reason] || sk.reason}`);
        });
        newRows.forEach((r) => { if (!failKeys.has(matKey(r.inv))) doneKeys.add(r.key); });
      } else fails.push(matReasonText(res?.reason, L));
    }
    setBusy(false);
    auditRecord(edit ? "material_bulk_edit" : "material_add", "material", null, { scope: scopeLabel, updated: nUpd + nUpdDup, added: nAdd, failed: fails.length });
    const msg = [nUpd + nUpdDup ? L(`แก้ ${nUpd + nUpdDup}`, `updated ${nUpd + nUpdDup}`) : "", nAdd ? L(`เพิ่ม ${nAdd}`, `added ${nAdd}`) : "",
      skippedExisting.length ? L(`ข้าม ${skippedExisting.length} ที่มีแล้ว (${skippedExisting.slice(0, 4).join(", ")}${skippedExisting.length > 4 ? " …" : ""})`, `skipped ${skippedExisting.length} existing (${skippedExisting.slice(0, 4).join(", ")}${skippedExisting.length > 4 ? " …" : ""})`) : ""].filter(Boolean).join(" · ");
    if (fails.length) {
      // เก็บแถวที่บันทึกไม่ผ่านไว้ให้แก้ต่อ · แถวที่ผ่านแล้วถือเป็นค่าเดิมใหม่ (กดบันทึกซ้ำไม่ส่งซ้ำ)
      setRows((rs) => rs.map((r) => (doneKeys.has(r.key) ? (r.id ? { ...r, orig: { inv: r.inv, wpm: r.wpm, len: r.len, qty: r.qty, note: r.note } } : MAT_BLANK()) : r)));
      setErr(L(`บันทึกไม่ผ่าน ${fails.length}: `, `${fails.length} not saved: `) + fails.slice(0, 5).join(" · ") + (fails.length > 5 ? " …" : ""));
      if (msg) mlsToast(msg, "success");
      if (doneKeys.size) onSaved && onSaved({ keepOpen: true });
      return;
    }
    mlsToast(msg || L("บันทึกแล้ว", "Saved"), skippedExisting.length ? "warn" : "success");
    onSaved && onSaved({});
  }

  const cellCls = (r, k) => [r.id && matCellChanged(r, k) ? "mat-cell-changed" : "", k === "inv" && !matBlank(r) && !String(r.inv).trim() ? "mat-cell-bad" : "", (k === "wpm" || k === "len" || k === "qty") && matBadNum(r[k], k === "qty") ? "mat-cell-bad" : "", k === "inv" && ((!edit && !r.id && r.inv.trim() && inScope(r.inv)) || (r.inv.trim() && dupInGrid(r))) ? "mat-cell-dup" : ""].filter(Boolean).join(" ") || undefined;
  const title = edit ? L("แก้ไข Material (ทั้งตาราง)", "Edit materials (whole table)") : L("เพิ่ม Material", "Add materials");
  let firstAssigned = false;
  return (
    <Modal title={title} sub={scopeLabel} onClose={onClose} closeOnBackdrop={false} locked={busy} wide>
      {pinfo && (
        <div className="mat-mapbar">
          <div className="mat-mapbar-h">
            <b>{L(`วางแล้ว ${pinfo.clip.grid.length} แถว — ตรวจว่าแต่ละคอลัมน์ลงช่องถูก`, `Pasted ${pinfo.clip.grid.length} row(s) — check where each column goes`)}</b>
            <span>{pinfo.clip.how === "header" ? L("(จับจากหัวตาราง)", "(matched by header)") : L("(เดาจากข้อมูล — เปลี่ยนได้)", "(guessed from the data — change if needed)")}</span>
            <button type="button" className="mat-link" onClick={() => setPinfo(null)}>{L("ตกลง", "OK")}</button>
          </div>
          <div className="mat-mapcols">
            {pinfo.clip.map.map((k, j) => {
              const sample = pinfo.clip.grid.map((r) => r[j]).filter(Boolean).slice(0, 2).join(" · ");
              return (
                <label key={j} className={"mat-mapcol" + (k ? " on" : "")}>
                  <span className="h">{(pinfo.clip.headers && pinfo.clip.headers[j]) || L(`คอลัมน์ ${j + 1}`, `Column ${j + 1}`)}</span>
                  <span className="s" title={sample}>{sample || "—"}</span>
                  <select value={k || ""} onChange={(e) => remap(j, e.target.value)} aria-label={L(`คอลัมน์ ${j + 1} ไปที่`, `Column ${j + 1} goes to`)}>
                    <option value="">{L("— ไม่ใช้ —", "— skip —")}</option>
                    {MAT_COLS.map((f) => <option key={f} value={f}>{MAT_FIELD_LABEL(f, L)}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      )}
      <div className="pgrid-wrap" style={{ maxHeight: "48vh" }} ref={wrapRef}>
        <table className="pgrid" style={{ minWidth: 660 }}>
          <thead><tr>
            <th style={{ width: 34 }}>#</th><th style={{ minWidth: 160 }}>INV Code *</th>
            <th style={{ width: 110 }}>{L("Weight/M (กก./ม.)", "Weight/M (kg/m)")}</th><th style={{ width: 110 }}>{L("ความยาว/เส้น (มม.)", "Length/bar (mm)")}</th>
            <th style={{ width: 90 }}>{L("จำนวน (เส้น)", "Qty (bars)")}</th><th style={{ width: 96, textAlign: "right" }}>{L("น้ำหนักรวม", "Total kg")}</th>
            <th style={{ minWidth: 120 }}>{L("หมายเหตุ", "Note")}</th><th style={{ width: 30 }}></th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const scrap = r.inv.trim() && isScrapInv(r.inv);
              const tot = matTotKg({ length_mm: gnum(r.len), weight_per_m: scrap ? null : gnum(r.wpm), qty: gnum(r.qty) });
              const dupDbRow = !edit && !r.id && r.inv.trim() && inScope(r.inv);
              const dupG = r.inv.trim() && dupInGrid(r);
              const isFirst = !firstAssigned && !r.id && matBlank(r) && (firstAssigned = true);
              return (
                <tr key={r.key} className={r.id ? "mat-row-existing" : undefined}>
                  <td className="pgrid-idx">{i + 1}</td>
                  {["inv", "wpm", "len", "qty", "note"].map((k) => {
                    if (k === "wpm" && scrap) return (
                      <td key={k} className="mat-cell-scrap" title={L("เศษ (OFF CUT) — ไม่บันทึกน้ำหนัก · กรอก Weight/M เองตอนสร้าง Release", "Scrap (OFF CUT) — weight isn't stored · type Weight/M when creating a release")}>
                        <input value="" disabled placeholder={L("เศษ · ไม่บันทึก", "scrap · not stored")} />
                      </td>
                    );
                    const inputEl = <input ref={k === "inv" && isFirst ? firstRef : undefined} data-row={i} data-col={k} value={r[k]} onChange={(e) => setCell(r.key, k, e.target.value)} inputMode={k === "inv" || k === "note" ? undefined : "decimal"} />;
                    const cells = [];
                    if (k === "note") cells.push(<td key="tot" className="pgrid-ro">{tot != null ? fmtDec(tot, 2) : "-"}</td>);
                    cells.push(
                      <td key={k} className={cellCls(r, k)}
                        title={k === "inv" && dupDbRow ? L("มีแล้วในรายการนี้ — จะข้าม (หรือติ๊ก \"อัปเดตทับ\")", "Already in this list — skipped (or tick \"update\")") : k === "inv" && dupG ? L("INV ซ้ำกันในตาราง", "Same INV twice in the table") : (r.id && matCellChanged(r, k) ? L(`เดิม: ${r.orig[k] || "(ว่าง)"}`, `was: ${r.orig[k] || "(empty)"}`) : undefined)}>
                        {inputEl}
                        {k === "inv" && dupG ? <span className="pg-tag dup">{L("ซ้ำ", "dup")}</span> : k === "inv" && dupDbRow ? <span className="pg-tag dup">{L("มีแล้ว", "exists")}</span> : null}
                      </td>
                    );
                    return cells;
                  })}
                  {r.id
                    ? <td className="pgrid-idx" title={L("ลบรายการเดิมได้ที่ปุ่ม \"ลบ\" ในหน้ารายการ", "Delete saved items with \"Delete\" on the list")} />
                    : <td className="pgrid-del" onClick={() => setRows((rs) => { const n = rs.filter((x) => x.key !== r.key); return n.length ? n : [MAT_BLANK()]; })} title={L("ลบแถว", "Remove row")}>✕</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pgrid-foot">
        <Btn variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, MAT_BLANK(), MAT_BLANK(), MAT_BLANK()])}><Icon name="plus" size={14} /> {L("เพิ่มแถว", "Add rows")}</Btn>
        <span>
          {edit ? <>{L("แก้", "Changed")} <b>{changedRows.length}</b> · {L("ใหม่", "new")} <b>{newRows.length}</b></> : <>{L("รายการ", "Items")} <b>{newRows.length}</b></>}
          {dupDb.length ? <span style={{ color: "var(--warning)" }}> · {L(`มีแล้ว ${dupDb.length}`, `${dupDb.length} already exist`)}</span> : null}
        </span>
        {flash && <span className="mat-flash">✓ {flash}</span>}
        {dupDb.length > 0 && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={updateDup} onChange={(e) => setUpdateDup(e.target.checked)} />
            {L("INV ที่มีแล้ว: อัปเดตค่าที่กรอก (ช่องว่างไม่ทับ)", "Existing INV: update with what's entered (blanks don't overwrite)")}
          </label>
        )}
      </div>
      {err && <div className="mat-err">{err}</div>}
      <div className="modal-actions">
        <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>{L("ปิด", "Close")}</Btn>
        <Btn type="button" variant="accent" onClick={save} disabled={busy || !nWork}>
          {busy ? L("กำลังบันทึก...", "Saving...") : edit ? L(`บันทึกการแก้ไข (${nWork})`, `Save changes (${nWork})`) : L(`บันทึก (${nWork})`, `Save (${nWork})`)}
        </Btn>
      </div>
    </Modal>
  );
}

// ── หน้า "บันทึก Material" ──
function MaterialsPage({ user }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const canEdit = canManage(user);
  const [projects, setProjects] = useState([]);
  const [scope, setScope] = useState(() => { try { return localStorage.getItem("mls.mat.scope") === "center" ? "center" : "project"; } catch { return "project"; } });
  const [projectId, setProjectId] = useState(() => { try { return localStorage.getItem("mls.mat.project") || ""; } catch { return ""; } });
  const [res, setRes] = useState(null);           // ผล getMaterials
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("all");        // all | incomplete | release
  const [edit, setEdit] = useState(null);         // row ที่กำลังแก้
  const [grid, setGrid] = useState(null);         // null | "add" | "edit" — ตารางกรอก/วางจาก Excel
  const [bf, setBf] = useState(null);             // { count, items } จาก materials_backfill (dry run)
  const [bfBusy, setBfBusy] = useState(false);
  const sort = useTableSort("inv", "asc");
  const colApi = useRef(null);
  useEffect(() => { listRows("projects", { order: "code" }).then((ps) => setProjects(ps || [])); }, []);
  useEffect(() => { try { localStorage.setItem("mls.mat.scope", scope); if (projectId) localStorage.setItem("mls.mat.project", projectId); } catch { /* ignore */ } }, [scope, projectId]);
  // โปรเจคที่จำไว้ถูกลบ/ไม่มี → เลือกตัวแรก
  useEffect(() => { if (projects.length && (!projectId || !projects.some((p) => p.id === projectId))) setProjectId(projects[0].id); }, [projects, projectId]);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await getMaterials(scope === "project" ? (projectId || null) : null);
    setRes(r); setLoading(false);
    if (scope === "project" && projectId && canEdit && r.ok) {
      const b = await backfillMaterials(projectId, true);
      setBf(b && b.ok ? b : null);
    } else setBf(null);
  }, [scope, projectId, canEdit]);
  useEffect(() => { if (scope === "center" || projectId) load(); }, [load, scope, projectId]);

  const project = projects.find((p) => p.id === projectId);
  const scopeLabel = scope === "center" ? "Center Stock — " + L("ใช้ได้ทุกโปรเจค", "shared by every project") : (project ? `${L("โปรเจค", "Project")} ${project.code} — ${project.name}` : "");
  const index = useMemo(() => buildMatIndex(res), [res]);
  const list = res && res.ok ? (scope === "center" ? res.center : res.project) : [];
  const counts = (res && res.ok && res.counts) || {};
  const incomplete = (m) => matMissing(m).length > 0;
  const fromRel = (m) => m.source === "release" || m.source === "backfill";
  const qq = q.trim().toLowerCase();
  const shown = list.filter((m) => (!qq || String(m.inv_code).toLowerCase().includes(qq) || String(m.note || "").toLowerCase().includes(qq))
    && (chip === "all" || (chip === "incomplete" ? incomplete(m) : fromRel(m))));
  const totalKg = list.reduce((s, m) => s + (matTotKg(m) || 0), 0);
  const sortAccessors = {
    inv: (m) => String(m.inv_code || ""), wpm: (m) => matNum(m.weight_per_m), len: (m) => matNum(m.length_mm), qty: (m) => matNum(m.qty),
    bar: (m) => matBarKg(m), tot: (m) => matTotKg(m), used: (m) => Number(m.used_parts) || 0, upd: (m) => m.updated_at || "",
  };
  const miss = <span className="mat-miss">{L("ยังไม่กรอก", "not set")}</span>;
  async function del(m) {
    if (!(await askConfirm({ message: L(`ลบ ${m.inv_code} ออกจาก${scope === "center" ? " Center Stock" : "โปรเจคนี้"}?\n\n(ไม่กระทบ Release/Part ที่ใช้ INV นี้อยู่)`, `Delete ${m.inv_code} from ${scope === "center" ? "Center Stock" : "this project"}?\n\n(Releases/parts using this INV are not affected)`), tone: "danger", confirmText: L("ลบ", "Delete"), cancelText: L("ยกเลิก", "Cancel") }))) return;
    const r = await deleteMaterial(m.id);
    if (!r || !r.ok) { mlsToast(matReasonText(r?.reason, L), "error"); return; }
    auditRecord("material_delete", "material", m.id, { inv: m.inv_code, scope: scopeLabel, wpm: m.weight_per_m, len: m.length_mm, qty: m.qty });
    mlsToast(L(`ลบ ${m.inv_code} แล้ว`, `Deleted ${m.inv_code}`), "success");
    load();
  }
  async function doBackfill() {
    if (!bf || !bf.count || bfBusy) return;
    const sample = (bf.items || []).slice(0, 8).map((x) => `${x.inv}${x.wpm != null ? ` (${fmtDec(x.wpm, 3)} กก./ม.)` : ""}`).join("\n");
    if (!(await askConfirm({ message: L(`ดึง INV ที่ Part ในโปรเจคนี้ใช้อยู่ แต่ยังไม่มีในรายการ (${bf.count} รายการ)\n\n${sample}${bf.count > 8 ? "\n…" : ""}\n\nWeight/M คิดจาก น้ำหนัก/ชิ้น ÷ ความยาว ของ Release เดิม (ใส่ให้เฉพาะที่ทุก Release ตรงกัน) · ความยาว/จำนวนเส้น กรอกเองต่อ`,
      `Add the INV codes this project's parts use but aren't listed yet (${bf.count})\n\n${sample}${bf.count > 8 ? "\n…" : ""}\n\nWeight/M is derived from weight/pc ÷ length of past releases (only when they all agree) · fill length/qty yourself`), confirmText: L("ดึงเข้ารายการ", "Add them"), cancelText: L("ยกเลิก", "Cancel") }))) return;
    setBfBusy(true);
    const r = await backfillMaterials(projectId, false);
    setBfBusy(false);
    if (!r || !r.ok) { mlsToast(matReasonText(r?.reason, L), "error"); return; }
    auditRecord("material_backfill", "project", projectId, { added: r.added });
    mlsToast(L(`เพิ่ม ${r.added} INV จาก Release เดิม`, `Added ${r.added} INV from past releases`), "success");
    load();
  }
  const cols = [
    { key: "inv", header: "INV Code", sortKey: "inv", lockCol: true, tdStyle: { whiteSpace: "nowrap" },
      cell: (m) => {
        const e = index.get(matKey(m.inv_code)) || {};
        return (
          <span className="mat-inv">
            <b>{m.inv_code}</b>
            {m.source === "release" && <span className="mat-src rel" title={L("บันทึกอัตโนมัติตอนสร้าง Release", "added automatically when a release was created")}>{L("จาก Release", "from release")} {m.source_ref || ""}</span>}
            {m.source === "backfill" && <span className="mat-src rel" title={L("ดึงจาก Release เดิม", "pulled from past releases")}>{L("จาก Release เดิม", "from past releases")}</span>}
            {scope === "project" && e.center && <span className="mat-src ctr" title={L(`มีใน Center Stock ด้วย (W/M ${fmtDec(e.center.weight_per_m, 4) || "-"}) — ตอนสร้าง Release โปรเจคนี้ใช้ค่าของโปรเจคก่อน`, `Also in Center Stock (W/M ${fmtDec(e.center.weight_per_m, 4) || "-"}) — this project's value is used first`)}>Center</span>}
          </span>
        );
      } },
    { key: "wpm", header: L("Weight/M (กก./ม.)", "Weight/M (kg/m)"), sortKey: "wpm", align: "right",
      cell: (m) => (isScrapInv(m.inv_code) ? <span className="mat-scrap" title={L("เศษ (OFF CUT) — ไม่บันทึกน้ำหนัก · กรอก Weight/M เองตอนสร้าง Release", "Scrap (OFF CUT) — weight isn't stored · type Weight/M when creating a release")}>{L("เศษ · กรอกเอง", "scrap · manual")}</span>
        : m.weight_per_m != null ? fmtDec(m.weight_per_m, 4) : miss) },
    { key: "len", header: L("ความยาว/เส้น (มม.)", "Length/bar (mm)"), sortKey: "len", align: "right", cell: (m) => (m.length_mm != null ? fmtDec(m.length_mm, 2) : miss) },
    { key: "qty", header: L("จำนวน (เส้น)", "Qty (bars)"), sortKey: "qty", align: "right", cell: (m) => (m.qty != null ? fmtDec(m.qty, 0) : miss) },
    { key: "bar", header: L("น้ำหนัก/เส้น (กก.)", "Weight/bar (kg)"), sortKey: "bar", align: "right", tdStyle: { color: "var(--muted)" }, cell: (m) => (matBarKg(m) != null ? fmtDec(matBarKg(m), 3) : "-") },
    { key: "tot", header: L("น้ำหนักรวม (กก.)", "Total weight (kg)"), sortKey: "tot", align: "right", tdStyle: { fontWeight: 600 }, cell: (m) => (matTotKg(m) != null ? fmtDec(matTotKg(m), 2) : "-") },
    { key: "used", header: L("ใช้ใน Part", "Used by parts"), sortKey: "used", align: "right", tdStyle: { whiteSpace: "nowrap" },
      cell: (m) => (Number(m.used_parts) > 0 ? <>{fmtNum(m.used_parts)}{scope === "center" && Number(m.used_projects) > 0 ? <span className="mat-sub"> · {L(`${m.used_projects} โปรเจค`, `${m.used_projects} project(s)`)}</span> : null}</> : <span className="mat-sub">0</span>) },
    { key: "note", header: L("หมายเหตุ", "Note"), cell: (m) => m.note || "-" },
    { key: "upd", header: L("อัปเดตล่าสุด", "Updated"), sortKey: "upd", tdStyle: { whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }, cell: (m) => <>{fmtDT(m.updated_at)}{m.by_name ? <span className="mat-sub"> · {m.by_name}</span> : null}</> },
    ...(canEdit ? [{ key: "manage", header: L("จัดการ", "Manage"), lockCol: true, tdStyle: { whiteSpace: "nowrap" }, tdProps: () => ({ onClick: (e) => e.stopPropagation() }),
      cell: (m) => (
        <span className="mat-actions">
          <button type="button" className="mat-link" onClick={() => setEdit(m)}>{L("แก้ไข", "Edit")}</button>
          <button type="button" className="mat-link danger" onClick={() => del(m)}>{L("ลบ", "Delete")}</button>
        </span>
      ) }] : []),
  ];
  const notInstalled = res && !res.ok && res.reason === "not_installed";
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">{L("บันทึก Material", "Materials")}</div>
          <div className="page-sub">{L("INV Code · น้ำหนักต่อเมตร · ความยาวต่อเส้น · จำนวนเส้น — แยกตามโปรเจค และ Center Stock (INV ที่ใช้ได้ทุกโปรเจค)",
            "INV code · weight per metre · bar length · number of bars — per project, plus Center Stock (INV shared by every project)")}</div>
        </div>
        {canEdit && !notInstalled && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {scope === "project" && bf && bf.count > 0 && (
              <Btn variant="ghost" onClick={doBackfill} disabled={bfBusy} title={L("INV ที่ Part ในโปรเจคนี้ใช้อยู่ แต่ยังไม่มีในรายการ", "INV codes used by this project's parts that aren't listed yet")}>
                <Icon name="refresh" size={14} /> {L(`ดึง INV จาก Release เดิม (${bf.count})`, `Add INV from past releases (${bf.count})`)}
              </Btn>
            )}
            {list.length > 0 && (
              <Btn variant="ghost" onClick={() => setGrid("edit")} title={L("แก้ทุกรายการในตาราง · ก็อปจาก Excel มาวางทับได้ (จับคู่ตาม INV)", "Edit every item in a grid · paste from Excel to update (matched by INV)")}>
                ✎ {L("แก้ไขทั้งตาราง", "Edit table")}
              </Btn>
            )}
            <Btn variant="accent" onClick={() => setGrid("add")} disabled={scope === "project" && !projectId}>
              <Icon name="plus" size={15} /> {L("เพิ่ม Material", "Add material")}
            </Btn>
          </div>
        )}
      </div>

      <div className="mat-scopebar">
        <div className="mat-seg" role="tablist">
          <button type="button" role="tab" aria-selected={scope === "project"} className={scope === "project" ? "on" : ""} onClick={() => setScope("project")}>
            <Icon name="folder" size={14} /> {L("ตามโปรเจค", "By project")}
          </button>
          <button type="button" role="tab" aria-selected={scope === "center"} className={scope === "center" ? "on" : ""} onClick={() => setScope("center")}>
            <Icon name="box" size={14} /> Center Stock{counts.center ? <b>{counts.center}</b> : null}
          </button>
        </div>
        {scope === "project" && (
          <select className="select mat-projsel" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={L("โปรเจค", "Project")}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}{counts[p.id] ? ` (${counts[p.id]})` : ""}</option>)}
          </select>
        )}
        <div className="mat-search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา INV / หมายเหตุ", "Search INV / note")} />
        </div>
      </div>
      <div className="mat-hint">
        {scope === "center"
          ? L("Center Stock = INV ที่ใช้ได้ทุกโปรเจค (กรอกเอง) · ตอนสร้าง Release ถ้าโปรเจคไม่มี INV นั้น (หรือไม่มี Weight/M) จะใช้ค่าจากที่นี่",
              "Center Stock = INV shared by every project (entered here) · when a release is created, this is used if the project doesn't list the INV (or has no Weight/M)")
          : L("ตอนสร้าง Release: Weight/M ที่เว้นว่างจะเติมจาก INV ของโปรเจคก่อน ไม่มีค่อยใช้ Center Stock · INV ใหม่ที่ยังไม่มีทั้ง 2 ที่ จะถูกบันทึกเข้าโปรเจคให้อัตโนมัติ — มากรอกความยาว/จำนวนต่อที่นี่ · OFF CUT (เศษ) ไม่บันทึกน้ำหนัก กรอกเองตอนสร้าง Release",
              "When a release is created: an empty Weight/M is filled from this project's INV first, then Center Stock · a new INV found in neither is added to the project automatically — fill in length/qty here · OFF CUT (scrap) has no stored weight — type it when creating a release")}
      </div>

      <Card>
        {notInstalled ? (
          <div className="mat-empty">{matReasonText("not_installed", L)}</div>
        ) : (
          <>
            <div className="mat-kpis">
              <span>{L("รายการ", "Items")} <b>{fmtNum(list.length)}</b></span>
              <span>{L("น้ำหนักรวมในสต็อก", "Stock weight")} <b>{fmtDec(totalKg, 2) || 0}</b> {L("กก.", "kg")}</span>
              <span className="mat-chips">
                {[["all", L("ทั้งหมด", "All"), list.length], ["incomplete", L("ยังกรอกไม่ครบ", "Incomplete"), list.filter(incomplete).length], ["release", L("มาจาก Release", "From releases"), list.filter(fromRel).length]].map(([k, lab, n]) => (
                  <button key={k} type="button" className={"mat-chip" + (chip === k ? " on" : "") + (k === "incomplete" && n ? " warn" : "")} onClick={() => setChip(k)} aria-pressed={chip === k}>
                    {lab} <b>{n}</b>
                  </button>
                ))}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <Btn variant="ghost" size="sm" onClick={() => colApi.current && colApi.current.resetAll()}>↺ {L("คอลัมน์", "Columns")}</Btn>
              </span>
            </div>
            {res && !res.ok && !notInstalled && <div className="mat-err">{matReasonText(res.reason, L)} · <button type="button" className="mat-link" onClick={load}>{L("ลองใหม่", "retry")}</button></div>}
            <DataTable id="materials-list" columns={cols} rows={shown} rowKey={(m) => m.id} sort={sort} sortAccessors={sortAccessors} orderApiRef={colApi}
              wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
              rowProps={(m) => ({ className: "mat-row" + (incomplete(m) ? " incomplete" : ""), onDoubleClick: canEdit ? () => setEdit(m) : undefined })}
              empty={loading ? L("กำลังโหลด...", "Loading...")
                : list.length === 0 ? (scope === "center" ? L("ยังไม่มี INV ใน Center Stock — กด \"เพิ่ม Material\" (ก็อปจาก Excel มาวางได้)", "No INV in Center Stock yet — press \"Add material\" (you can paste from Excel)") : L("ยังไม่มี INV ในโปรเจคนี้ — กด \"เพิ่ม Material\" (ก็อปจาก Excel มาวางได้) หรือสร้าง Release แล้วระบบจะบันทึกให้", "No INV in this project yet — press \"Add material\" (you can paste from Excel) or create a release and they'll be added"))
                : L("ไม่พบรายการที่ตรงกับตัวกรอง", "No items match the filter")} />
          </>
        )}
      </Card>

      {edit && <MaterialEditModal row={edit} scopeLabel={scopeLabel} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); mlsToast(L("บันทึกแล้ว", "Saved"), "success"); load(); }} />}
      {grid && <MaterialGridModal mode={grid} projectId={scope === "center" ? null : projectId} scopeLabel={scopeLabel} index={index} existing={list}
        onClose={() => { setGrid(null); load(); }} onSaved={(o) => { if (!o || !o.keepOpen) setGrid(null); load(); }} />}
    </div>
  );
}

// ─── เพิ่ม Release (ป็อปอัป) — กรอกหัวเอกสาร + วางข้อมูล Part จาก Excel ได้เลย ──
// หัวเอกสาร: Release Order (P-xxx), วันที่, โปรเจค
// ตาราง Part: วาง (paste) จาก Excel ได้ทั้งบล็อก — คอลัมน์ตรงตามฟอร์ม Production
// Release Report (Code, Qty, Length, Weight/M, Material, Total Kg, Remark)
// แต่ละแถว = 1 release + สร้าง QR ต่อชิ้นให้ครบตาม Qty (เหมือนการนำเข้า Excel)
const BLANK_ROW = () => ({ id: Math.random().toString(36).slice(2), code: "", rev: "", qty: "", length_mm: "", weight_per_m: "", material: "", remark: "", routing: [] });

// คอลัมน์ตาราง "เพิ่ม Release" — ลากสลับตำแหน่งได้ (จำต่อบัญชี) · วางจาก Excel แบบไม่มีหัวตาราง = เรียงตามลำดับบนจอ
//   paste: ฟิลด์ที่รับค่า · "__skip__" = คอลัมน์ที่ระบบคำนวณเอง (รับค่าที่วางมาแล้วทิ้ง)
//   ค่าเริ่มต้นเรียงตามฟอร์ม Excel จริง (Part No., Qty, Length, Weight/M, Material, Total Kg, Remark) → วางแบบเดิมได้ผลเหมือนเดิม
const RELEASE_GRID_COLS = ["code", "qty", "length_mm", "weight_per_m", "material", "tkg", "remark", "rev", "wpcs"];
const RELEASE_GRID_PASTE = { code: "code", qty: "qty", length_mm: "length_mm", weight_per_m: "weight_per_m", material: "material", tkg: "__skip__", remark: "remark", rev: "rev", wpcs: "__skip__" };

function AddReleaseModal({ user, projects, parts, onClose, onSaved, onNeedProject }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const [modify, setModify] = useState("");   // Modify Release (เช่น M-001) — ระดับทั้งใบ
  const [releaseOrder, setReleaseOrder] = useState("");
  const [date, setDate] = useState(() => todayStr());
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, BLANK_ROW));
  const [makeQr, setMakeQr] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [undoCount, setUndoCount] = useState(0); // แสดงตัวเลขย้อนกลับล่าสุด (feedback เล็กๆ)

  // ── Undo stack (Ctrl+Z) ─────────────────────────────────────────────────
  // เก็บ snapshot ของ rows ก่อนทุกการเปลี่ยนแปลง ไม่เกิน 50 ขั้น
  const historyRef = useRef([]);
  const rowsScrollRef = useRef(null);   // กรอบเลื่อนตารางแถว (ปุ่ม "ขึ้นบนสุด")

  // ใช้แทน setRows เสมอเมื่อต้องการ undo ได้
  const setRowsU = useCallback((updater) => {
    setRows((prev) => {
      historyRef.current = [...historyRef.current, prev].slice(-50);
      return typeof updater === "function" ? updater(prev) : updater;
    });
  }, []);

  // Ctrl+Z / Cmd+Z — pop จาก stack แล้ว restore
  useEffect(() => {
    function onKeydown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !busy) {
        if (historyRef.current.length === 0) return;
        e.preventDefault();
        const prev = historyRef.current[historyRef.current.length - 1];
        historyRef.current = historyRef.current.slice(0, -1);
        setRows(prev);
        setUndoCount((n) => n + 1);
        setTimeout(() => setUndoCount(0), 1200);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [busy]);

  // ── บันทึก Material ของโปรเจค (+ Center Stock) → เติม Weight/M ที่เว้นว่าง + รู้ว่า INV ไหนใหม่ ──
  const [mat, setMat] = useState({ state: "idle", res: null });   // idle | loading | ok | not_installed | error
  useEffect(() => {
    if (!projectId) { setMat({ state: "idle", res: null }); return undefined; }
    let alive = true;
    setMat((m) => ({ state: "loading", res: m.res }));
    getMaterials(projectId).then((r) => {
      if (alive) setMat({ state: r && r.ok ? "ok" : (r && r.reason === "not_installed" ? "not_installed" : "error"), res: r && r.ok ? r : null });
    }).catch(() => { if (alive) setMat({ state: "error", res: null }); });
    return () => { alive = false; };
  }, [projectId]);
  const matIdx = useMemo(() => buildMatIndex(mat.res), [mat.res]);
  // Weight/M ของแถว: กรอกเอง = ใช้ค่าที่กรอก (ต่างจากที่บันทึกไว้ = เตือน) · ว่าง = เติมจาก INV (โปรเจค → Center Stock)
  function wpmInfo(r) {
    const lk = matLookup(matIdx, r.material);
    const typed = gnum(r.weight_per_m);
    if (lk.scrap) return { eff: typed, auto: false, warn: false, lk, scrap: true, need: typed == null };   // ★ เศษ: กรอกเองเสมอ
    if (typed != null) return { eff: typed, auto: false, warn: lk.wpm != null && Math.abs(lk.wpm - typed) > 1e-9, lk };
    return { eff: lk.wpm, auto: lk.wpm != null, warn: false, lk };
  }
  const effRow = (r) => { const w = wpmInfo(r); return w.auto ? { ...r, weight_per_m: String(w.eff) } : r; };
  const invState = (r) => {           // scrap | proj | center | new | null
    if (!String(r.material || "").trim()) return null;
    if (isScrapInv(r.material)) return "scrap";
    if (mat.state !== "ok") return null;
    const lk = matLookup(matIdx, r.material);
    return lk.inProject ? "proj" : lk.inCenter ? "center" : "new";
  };

  // ── ลำดับคอลัมน์ (ลากสลับได้ · จำต่อบัญชี · แอดมิน = ค่ากลาง) ──
  const { order: colOrder, move: moveCol, reset: resetCols, drag, setDrag } = useColOrder("release-add-grid", RELEASE_GRID_COLS);
  const gridCols = colOrder.filter((k) => RELEASE_GRID_PASTE[k]);
  const pasteOrder = gridCols.map((k) => RELEASE_GRID_PASTE[k]);
  const colDefault = gridCols.join("|") === RELEASE_GRID_COLS.join("|");

  function setCell(rowId, key, value) {
    setRowsU((rs) => rs.map((r) => (r.id === rowId ? { ...r, [key]: value } : r)));
  }
  function addRow() { setRowsU((rs) => [...rs, BLANK_ROW()]); }
  function removeRow(rowId) {
    setRowsU((rs) => {
      const next = rs.filter((r) => r.id !== rowId);
      return next.length ? next : [BLANK_ROW()];
    });
  }

  // วางข้อมูลจาก Excel:
  //  - มีหัวตาราง → จับคอลัมน์จากชื่อหัว (ไม่สนลำดับ)
  //  - หลายคอลัมน์ ไม่มีหัว → เติมตาม "ลำดับคอลัมน์บนจอ" เริ่มจากคอลัมน์ที่คลิก (ตัดเลข No. นำหน้าให้ถ้าวางที่ Part No.)
  //  - คอลัมน์เดียว (มีแต่ขึ้นบรรทัดใหม่) → เติมลงคอลัมน์ที่โฟกัสไล่ลงไป
  function handlePaste(e, rowIndex, colKey) {
    if (!projectId) {
      e.preventDefault();
      setErr("กรุณาเลือกโปรเจคก่อน แล้วจึงวางข้อมูล — ระบบต้องรู้โปรเจคเพื่อแยก Part เดิม/ใหม่ให้ถูกต้อง (เบอร์เดียวกันคนละโปรเจคถือเป็นคนละ Part)");
      return;
    }
    const text = e.clipboardData.getData("text");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return; // ค่าเดียว ปล่อยให้วางปกติ
    e.preventDefault();

    const isMultiCol = text.includes("\t");
    setRowsU((rs) => {
      const next = [...rs];
      const ensure = (idx) => { while (next.length <= idx) next.push(BLANK_ROW()); };

      if (isMultiCol) {
        const lines = String(text).replace(/\r/g, "").split("\n");
        while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
        const grid = lines.map((l) => l.split("\t")).filter((cells) => cells.some((c) => String(c).trim() !== ""));
        if (grid.length && looksLikeHeader(grid[0])) {
          parsePastedRows(text).forEach((data, i) => { const idx = rowIndex + i; ensure(idx); next[idx] = { ...next[idx], ...data }; });
        } else {
          const start = Math.max(0, gridCols.indexOf(colKey));
          grid.forEach((cells, i) => {
            let cs = cells;
            // เลขลำดับ (No.) นำหน้า: วางที่ Part No. + ช่องแรกเป็นเลขล้วน + ช่องถัดไปไม่ใช่ตัวเลข (= เบอร์พาร์ท) → ตัดทิ้ง
            if (gridCols[start] === "code" && cs.length > 1 && /^\d+$/.test(String(cs[0]).trim())
                && String(cs[1]).trim() && !/^[\d.,\s]+$/.test(String(cs[1]).trim())) cs = cs.slice(1);
            const data = {};
            cs.forEach((v, j) => { const f = pasteOrder[start + j]; if (f && f !== "__skip__") data[f] = String(v).trim(); });
            const idx = rowIndex + i;
            ensure(idx);
            next[idx] = { ...next[idx], ...data };
          });
        }
      } else {
        const values = text.replace(/\r/g, "").split("\n");
        while (values.length && values[values.length - 1].trim() === "") values.pop();
        values.forEach((v, i) => {
          const idx = rowIndex + i;
          ensure(idx);
          next[idx] = { ...next[idx], [colKey]: v.trim() };
        });
      }
      return next;
    });
  }

  const project = projects.find((p) => p.id === projectId);
  const qtyOf = (r) => gnum(r.qty) || 1;                       // เว้นว่าง = 1 อัตโนมัติ
  const validRows = rows.filter((r) => r.code.trim());         // ขอแค่มีรหัส Code (จำนวนไม่บังคับ)
  const totalQty = validRows.reduce((s, r) => s + qtyOf(r), 0);
  const totalKg = validRows.reduce((s, r) => s + (qtyOf(r) * (rowWeightPcs(effRow(r)) || 0)), 0);
  const partsInProject = parts.filter((p) => p.project_id === projectId);
  const autoCount = validRows.filter((r) => wpmInfo(r).auto).length;
  const warnRows = validRows.filter((r) => wpmInfo(r).warn);
  const newInvs = [...new Map(validRows.filter((r) => invState(r) === "new").map((r) => [matKey(r.material), r.material.trim()])).values()];
  const scrapRows = validRows.filter((r) => invState(r) === "scrap");
  const scrapNeed = scrapRows.filter((r) => gnum(r.weight_per_m) == null);

  // Part เดิมในโปรเจคนี้ (ถ้ามี) — ใช้ตัดสินว่าแถวนี้เป็น Part ใหม่หรือของเดิม
  function existingPartFor(row) {
    const code = row.code.trim().toLowerCase();
    if (!code) return null;
    return partsInProject.find((p) => p.part_no.trim().toLowerCase() === code) || null;
  }
  // เบอร์เดียวกันที่มีอยู่ใน "โปรเจคอื่น" — เตือนให้รู้ว่ามี routing อื่นอยู่ (อาจต่างกันโดยตั้งใจ)
  // คนละโปรเจค = คนละ Part เสมอ จึงไม่ดึง routing ข้ามโปรเจคมาให้ แต่โชว์ให้ดูเป็นข้อมูลอ้างอิง
  function otherProjectMatches(row) {
    const code = row.code.trim().toLowerCase();
    if (!code) return [];
    return parts
      .filter((p) => p.part_no.trim().toLowerCase() === code && p.project_id !== projectId)
      .map((p) => ({ part: p, project: projects.find((pr) => pr.id === p.project_id) }));
  }
  const isNewPartRow = (row) => row.code.trim() && !existingPartFor(row);
  const newPartCount = validRows.filter(isNewPartRow).length;

  async function doSave() {
    const ro = normalizeReleaseOrder(releaseOrder);
    if (!ro || !RELEASE_ORDER_RE.test(ro)) { setErr('เลขที่ Release Order ต้องเป็นรูปแบบ "P-ตัวเลข" เช่น P-009'); return; }
    if (!projectId) { setErr("กรุณาเลือกโปรเจค"); return; }
    if (!date) { setErr("กรุณาเลือกวันที่"); return; }
    if (validRows.length === 0) { setErr("กรุณากรอกอย่างน้อย 1 Part (ต้องมีรหัส Code)"); return; }
    // กันจำนวนติดลบ/ทศนิยม/ใหญ่ผิดปกติ (เว้นว่าง = 1) — จำนวนชิ้นต้องเป็นจำนวนเต็มบวก
    const badRow = validRows.find((r) => {
      const raw = String(r.qty ?? "").trim();
      if (raw === "") return false;              // เว้นว่าง = 1 (อนุญาต)
      const q = gnum(raw);                        // ใช้ gnum → รองรับคอมมา "1,200" เหมือนตอนบันทึก
      return !Number.isInteger(q) || q < 1 || q > 1000000;
    });
    if (badRow) { setErr(`จำนวนของ Part "${badRow.code || "-"}" ไม่ถูกต้อง — ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`); return; }

    setBusy(true); setErr(""); setProgress("กำลังบันทึกทั้งใบ...");
    try {
      // ส่งทั้งใบไปให้ DB ทำใน transaction เดียว (atomic) — สร้าง Part/Release/QR ครบ
      // ถ้าพังกลางคัน DB จะ rollback ทั้งใบ ไม่มีข้อมูลค้างครึ่งๆ (แก้ H2) และ Part
      // รหัสซ้ำในใบเดียวจะถูก find-or-create ให้ถูกต้อง ไม่ชนกันเอง (แก้ M2)
      const rows = validRows.map((r) => ({
        code: r.code.trim(),
        qty: qtyOf(r),                    // เว้นว่าง = 1
        unit_weight: rowWeightPcs(effRow(r)),   // ★ Weight/M ว่าง = เติมจากบันทึก Material (โปรเจค → Center Stock)
        length_mm: gnum(r.length_mm),
        material: r.material?.trim() || null,
        remark: r.remark?.trim() || null,
        routing: [],                      // ไม่ใช้ Routing แล้ว — ขั้นตอนขึ้นกับเครื่องที่ทำ
      }));
      // ★ กัน Release ซ้ำ: ถ้า (โปรเจค+เลข Order) นี้มีแล้ว (เช่นกดแล้วเน็ตวูบตอนตอบกลับ) อย่าสร้างซ้ำ
      if (await releaseOrderExists(projectId, ro)) {
        setErr(`Release Order "${ro}" มีอยู่แล้วในโปรเจคนี้ — ถ้าเพิ่งกดแล้วเน็ตหลุด อาจบันทึกไปแล้ว · รีเฟรช/ตรวจในรายการ Release ก่อนกดซ้ำ (กันบันทึกซ้ำ)`);
        setBusy(false); setProgress(""); return;
      }
      const res = await createReleaseBatch({
        projectId, releaseOrder: ro, releaseDate: dateToIso(date),
        releasedBy: user.id, makeQr, rows,
      });
      // เก็บ Modify (ทั้งใบ) → mdf_no ทุก Part ในใบนี้ · REV → ราย Part — เว้นว่าง = "0"
      // (ต้องมีคอลัมน์ mdf_no / rev จาก migration-station.sql; ถ้ายังไม่มีจะข้ามเงียบๆ)
      const mdfVal = modify.trim() || "0";
      for (const r of validRows) {
        const code = r.code.trim();
        if (!code) continue;
        try {
          await updateRows("part_master", { project_id: projectId, part_no: code }, {
            mdf_no: mdfVal,
            rev: (r.rev ?? "").toString().trim() || "0",
          });
        } catch (_) { /* คอลัมน์อาจยังไม่มี — ไม่ให้ล้มทั้งใบ */ }
      }
      // ★ INV ที่ยังไม่มี (ทั้งในโปรเจคและ Center Stock) → บันทึกเข้า Material ของโปรเจคนี้ (พลาดไม่กระทบ Release ที่บันทึกแล้ว)
      if (mat.state !== "not_installed") {
        try {
          const mr = await addMaterialsFromRelease(projectId, ro, validRows.filter((r) => !isScrapInv(r.material)).map((r) => ({ inv: r.material, wpm: gnum(r.weight_per_m) })));   // ★ เศษไม่บันทึก
          if (mr && mr.ok && ((mr.added || []).length || (mr.filled || []).length)) {
            const a = mr.added || [], f = mr.filled || [];
            mlsToast(L(`บันทึก Material ของโปรเจค: INV ใหม่ ${a.length}${a.length ? ` (${a.slice(0, 4).join(", ")}${a.length > 4 ? " …" : ""})` : ""}${f.length ? ` · เติม Weight/M ${f.length}` : ""} — ไปกรอกความยาว/จำนวนได้ที่เมนู "บันทึก Material"`,
              `Project materials: ${a.length} new INV${a.length ? ` (${a.slice(0, 4).join(", ")}${a.length > 4 ? " …" : ""})` : ""}${f.length ? ` · ${f.length} Weight/M filled` : ""} — fill length/qty in "Materials"`), "success");
          } else if (mr && !mr.ok && mr.reason !== "not_installed") {
            mlsToast(L("บันทึก INV ใหม่เข้า Material ไม่สำเร็จ (Release บันทึกแล้ว) — เพิ่มเองได้ที่เมนู \"บันทึก Material\"", "Couldn't add the new INV to Materials (the release is saved) — add them in \"Materials\""), "warn");
          }
        } catch (_) { /* ignore */ }
      }
      onSaved({ releaseOrder: ro, ...res });
    } catch (e2) {
      setErr("เกิดข้อผิดพลาดระหว่างบันทึก: " + e2.message + " — ถ้าเน็ตหลุดหลังกดบันทึก อาจบันทึกไปแล้ว · รีเฟรชแล้วตรวจในรายการ Release ก่อนกดซ้ำ (กันซ้ำ)");
    }
    setBusy(false); setProgress("");
  }

  // ── หัวคอลัมน์ + เซลล์ต่อคอลัมน์ ──
  const dragTip = L("ลากที่จับ ⠿ เพื่อย้ายคอลัมน์ — วางจาก Excel (ไม่มีหัวตาราง) จะเรียงตามลำดับนี้", "Drag ⠿ to move the column — pasting from Excel (no header row) follows this order");
  const COLDEF = {
    code: { header: "Part No. *", thStyle: { minWidth: 130 } },
    qty: { header: L("จำนวน", "Qty"), thStyle: { width: 78 } },
    length_mm: { header: L("Length (มม.)", "Length (mm)"), thStyle: { width: 90 } },
    weight_per_m: { header: "Weight/M", thStyle: { width: 96 } },
    material: { header: L("Material (INV)", "Material (INV)"), thStyle: { minWidth: 170 } },
    tkg: { header: "Total Kg", thStyle: { width: 92, textAlign: "right" } },
    remark: { header: "Remark", thStyle: { minWidth: 90 } },
    rev: { header: "REV.", thStyle: { width: 64 } },
    wpcs: { header: L("น้ำหนัก/ชิ้น", "Weight/pc"), thStyle: { width: 92, textAlign: "right" } },
  };
  const inp = (r, i, k, extra = {}) => (
    <input value={r[k]} onChange={(e) => setCell(r.id, k, e.target.value)} onPaste={(e) => handlePaste(e, i, k)} {...extra} />
  );
  function cellFor(k, r, i) {
    if (k === "code") return <td key={k}>{inp(r, i, "code", { placeholder: "AN04-001-01" })}</td>;
    if (k === "qty") return <td key={k}>{inp(r, i, "qty", { inputMode: "numeric" })}</td>;
    if (k === "length_mm") return <td key={k}>{inp(r, i, "length_mm", { inputMode: "decimal" })}</td>;
    if (k === "rev") return <td key={k}>{inp(r, i, "rev", { placeholder: "0" })}</td>;
    if (k === "remark") return <td key={k}>{inp(r, i, "remark")}</td>;
    if (k === "weight_per_m") {
      const w = wpmInfo(r);
      const src = w.lk.scope === "center" ? "Center Stock" : L("โปรเจคนี้", "this project");
      const tip = w.scrap ? L("เศษ (OFF CUT) — ไม่บันทึกน้ำหนัก · กรอก Weight/M เองทุกครั้ง", "Scrap (OFF CUT) — weight isn't stored · type Weight/M every time")
        : w.auto ? L(`เติมอัตโนมัติจาก ${w.lk.row?.inv_code || r.material} (${src}) — พิมพ์ทับได้`, `Auto-filled from ${w.lk.row?.inv_code || r.material} (${src}) — type to override`)
        : w.warn ? L(`ไม่ตรงกับที่บันทึกไว้ของ ${w.lk.row?.inv_code || r.material}: ${fmtDec(w.lk.wpm, 4)} (${src}) — ใช้ค่าในแถวนี้`, `Differs from the saved value of ${w.lk.row?.inv_code || r.material}: ${fmtDec(w.lk.wpm, 4)} (${src}) — this row's value is used`) : undefined;
      return (
        <td key={k} className={"pg-wpm" + (w.auto ? " auto" : "") + (w.warn ? " warn" : "") + (w.scrap && w.need ? " need" : "")} title={tip}>
          {inp(r, i, "weight_per_m", { inputMode: "decimal", placeholder: w.auto ? fmtDec(w.eff, 4) : w.scrap && w.need ? L("กรอกเอง", "type it") : "" })}
          {w.auto || w.warn ? <span className="pg-corner" aria-hidden="true" /> : null}
        </td>
      );
    }
    if (k === "material") {
      const st = invState(r);
      const lk = st ? matLookup(matIdx, r.material) : null;
      const tip = st === "scrap" ? L("เศษ (OFF CUT) — ไม่บันทึกเข้า Material · กรอก Weight/M เอง", "Scrap (OFF CUT) — not added to Materials · type Weight/M yourself")
        : st === "proj" ? L(`มีในบันทึก Material ของโปรเจคนี้${lk?.wpm != null ? ` · W/M ${fmtDec(lk.wpm, 4)}` : " · ยังไม่มี W/M"}`, `In this project's materials${lk?.wpm != null ? ` · W/M ${fmtDec(lk.wpm, 4)}` : " · no W/M yet"}`)
        : st === "center" ? L(`มีใน Center Stock${lk?.wpm != null ? ` · W/M ${fmtDec(lk.wpm, 4)}` : ""}`, `In Center Stock${lk?.wpm != null ? ` · W/M ${fmtDec(lk.wpm, 4)}` : ""}`)
        : st === "new" ? L("INV ใหม่ — จะบันทึกเข้า Material ของโปรเจคนี้หลังบันทึก Release", "New INV — will be added to this project's materials when the release is saved") : undefined;
      return (
        <td key={k} className={st ? "pg-inv has-tag" : undefined} title={tip}>
          {inp(r, i, "material", { list: "mls-inv-dl", autoComplete: "off" })}
          {st === "scrap" ? <span className="pg-tag scrap">{L("เศษ", "scrap")}</span> : st === "proj" ? <span className="pg-tag proj">✓</span> : st === "center" ? <span className="pg-tag ctr">Center</span> : st === "new" ? <span className="pg-tag new">{L("ใหม่", "new")}</span> : null}
        </td>
      );
    }
    if (k === "wpcs") { const v = rowWeightPcs(effRow(r)); return <td key={k} className="pgrid-ro">{v != null ? fmtNum(v) : "-"}</td>; }
    if (k === "tkg") { const v = rowTotalKg(effRow(r)); return <td key={k} className="pgrid-ro">{v != null ? fmtNum(v) : "-"}</td>; }
    return <td key={k} />;
  }
  const dlOptions = useMemo(() => {
    const out = [];
    for (const [, e] of matIdx) {
      const m = e.proj || e.center;
      const w = matLookup(matIdx, m.inv_code).wpm;
      out.push({ v: m.inv_code, label: `${e.proj ? L("โปรเจค", "project") : "Center"}${w != null ? ` · ${fmtDec(w, 4)} ${L("กก./ม.", "kg/m")}` : ""}` });
    }
    return out;
  }, [matIdx, lang]);

  return (
    <Modal
      title="เพิ่ม Release" wide
      sub="กรอกหัวเอกสาร แล้ววางข้อมูล Part จาก Excel ลงตารางได้เลย (Ctrl+V)"
      onClose={onClose} closeOnBackdrop={false} locked={busy}
    >
      <div className="modal-lock-hint">
        <Icon name="lock" size={12} /> หน้าต่างนี้ล็อกไว้ — คลิกนอกกรอบจะไม่ปิด กด "ยกเลิก" หรือ ✕ เพื่อออก
      </div>

      <div className="release-header-fields" style={{ marginBottom: 12 }}>
        <Field label="Modify (Release)">
          <Input value={modify} placeholder="เช่น M-001"
            onChange={(e) => setModify(e.target.value)} />
        </Field>
        <Field label="เลขที่ Release Order *">
          <Input value={releaseOrder} placeholder="เช่น P-009"
            onChange={(e) => setReleaseOrder(e.target.value)}
            onBlur={(e) => setReleaseOrder(normalizeReleaseOrder(e.target.value))} />
        </Field>
        <Field label="วันที่ *">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="โปรเจค *">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
        </Field>
        <Btn type="button" variant="ghost" className="icon-btn-add" title="สร้างโปรเจคใหม่"
          onClick={() => onNeedProject && onNeedProject()}>
          <Icon name="plus" size={16} />
        </Btn>
      </div>

      {/* แถบสรุป + ปุ่มทั้งหมด ล็อกไว้ด้านบน (ไม่ต้องเลื่อนลงไปกดบันทึก) */}
      <div className="release-actionbar">
        <span className="ra-summary">
          รวม <b>{fmtNum(totalQty)}</b> ชิ้น · <b>{validRows.length}</b> Part · <b>{fmtNum(totalKg)}</b> กก.
          {newPartCount > 0 && <span style={{ color: "var(--accent-dk)", marginLeft: 6 }}>({newPartCount} ใหม่)</span>}
        </span>
        <label className="toggle-row" style={{ margin: 0 }}>
          <span className={`toggle-switch${makeQr ? " on" : ""}`}>
            <input type="checkbox" checked={makeQr} onChange={(e) => setMakeQr(e.target.checked)} />
            <span className="toggle-knob" />
          </span>
          <span className="toggle-text"><span className="toggle-text-title" style={{ fontSize: 12.5 }}>สร้าง QR ต่อชิ้น</span></span>
        </label>
        <span className="ra-spacer" />
        <Btn type="button" variant="ghost" size="sm" onClick={addRow} disabled={!projectId}><Icon name="plus" size={14} /> เพิ่มแถว</Btn>
        <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
        <Btn type="button" variant="accent" onClick={doSave} disabled={busy || validRows.length === 0}>
          {busy ? "กำลังบันทึก..." : makeQr ? `บันทึก + QR (${fmtNum(totalQty)})` : "บันทึก Release"}
        </Btn>
      </div>
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      {busy && progress && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{progress}</div>}
      {projectId && (mat.state === "ok" || mat.state === "not_installed") && (autoCount > 0 || warnRows.length > 0 || newInvs.length > 0 || scrapRows.length > 0 || mat.state === "not_installed") && (
        <div className="pg-matbar">
          {mat.state === "not_installed" ? (
            <span className="pg-mb muted">{L("ยังไม่ได้ติดตั้ง \"บันทึก Material\" (รัน migration-materials.sql) — Weight/M ไม่เติมอัตโนมัติ", "\"Materials\" isn't installed (run migration-materials.sql) — Weight/M isn't auto-filled")}</span>
          ) : (
            <>
              {autoCount > 0 && <span className="pg-mb auto">{L(`Weight/M เติมอัตโนมัติ ${autoCount} แถว`, `Weight/M auto-filled on ${autoCount} row(s)`)}</span>}
              {warnRows.length > 0 && <span className="pg-mb warn" title={warnRows.slice(0, 8).map((r) => `${r.code}: ${r.weight_per_m} ≠ ${fmtDec(wpmInfo(r).lk.wpm, 4)} (${r.material})`).join("\n")}>{L(`Weight/M ไม่ตรงกับที่บันทึกไว้ ${warnRows.length} แถว — ใช้ค่าในแถว`, `Weight/M differs from the saved value on ${warnRows.length} row(s) — the row's value is used`)}</span>}
              {scrapRows.length > 0 && <span className={"pg-mb " + (scrapNeed.length ? "warn" : "muted")} title={scrapNeed.map((r) => r.code).join(", ") || undefined}>
                {scrapNeed.length ? L(`OFF CUT (เศษ) ${scrapRows.length} แถว — ยังไม่กรอก Weight/M ${scrapNeed.length} แถว (กรอกเอง ไม่บันทึกเข้า Material)`, `OFF CUT (scrap) ${scrapRows.length} row(s) — ${scrapNeed.length} without Weight/M (type it · not stored in Materials)`)
                  : L(`OFF CUT (เศษ) ${scrapRows.length} แถว — กรอก Weight/M เอง ไม่บันทึกเข้า Material`, `OFF CUT (scrap) ${scrapRows.length} row(s) — Weight/M typed · not stored in Materials`)}
              </span>}
              {newInvs.length > 0 && <span className="pg-mb new" title={newInvs.join(", ")}>{L(`INV ใหม่ ${newInvs.length} รายการ — จะบันทึกเข้า Material ของโปรเจคนี้`, `${newInvs.length} new INV — will be added to this project's materials`)}</span>}
            </>
          )}
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>
        {L(<>วางจาก Excel ได้ทั้งบล็อก — <b>เรียงตามคอลัมน์บนจอ</b> เริ่มจากช่องที่คลิก (ลากหัวคอลัมน์ ⠿ ให้ตรงกับไฟล์ Excel ได้ · มีหัวตาราง = จับจากชื่อหัว) · คอลัมน์ที่ระบบคำนวณ (Total Kg · น้ำหนัก/ชิ้น) ข้ามค่าที่วางมา · น้ำหนัก/ชิ้น = (Length ÷ 1000) × Weight/M</>,
           <>Paste a whole block from Excel — <b>it follows the column order on screen</b>, starting at the clicked cell (drag ⠿ headers to match your Excel file · with a header row, columns are matched by name) · calculated columns (Total Kg · Weight/pc) ignore pasted values · Weight/pc = (Length ÷ 1000) × Weight/M</>)}
        <br />{L(<>Weight/M เว้นว่าง = เติมจาก <b>บันทึก Material</b> ตาม INV (โปรเจคนี้ก่อน → Center Stock) · <b>OFF CUT (เศษ) กรอก Weight/M เอง</b> ไม่เติม/ไม่บันทึก · จำนวนเว้นว่างได้ = 1 อัตโนมัติ · ขั้นตอนการทำงานขึ้นกับ "เครื่อง" ที่ทำ</>,
           <>Empty Weight/M = filled from <b>Materials</b> by INV (this project first → Center Stock) · <b>OFF CUT (scrap): type Weight/M yourself</b> — never filled or stored · empty Qty = 1 · steps depend on the machine that does the work</>)}
      </div>

      {!projectId && (
        <div className="pgrid-need-project">
          <Icon name="folder" size={14} />
          เลือกโปรเจคก่อน แล้วจึงกรอก/วางข้อมูล Part — ระบบต้องรู้โปรเจคเพื่อแยก Part เดิม/ใหม่ให้ถูกต้อง
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>(เบอร์เดียวกันคนละโปรเจค = คนละ Part คนละ Routing)</span>
        </div>
      )}

      <div ref={rowsScrollRef} className="pgrid-wrap" style={!projectId ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
        <table className="pgrid">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              {gridCols.map((k) => <ReorderTh key={k} col={{ key: k, header: COLDEF[k].header, thStyle: COLDEF[k].thStyle, title: dragTip }} drag={drag} setDrag={setDrag} onMove={moveCol} />)}
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="pgrid-idx">{i + 1}</td>
                {gridCols.map((k) => cellFor(k, r, i))}
                <td className="pgrid-del" onClick={() => removeRow(r.id)} title="ลบแถว">✕</td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="mls-inv-dl">
          {dlOptions.map((o) => <option key={o.v} value={o.v} label={o.label} />)}
        </datalist>
      </div>

      <div className="pgrid-foot">
        <span style={{ fontSize: 11.5, color: "var(--muted)", userSelect: "none" }} title="กด Ctrl+Z เพื่อย้อนกลับการแก้ไขตาราง">
          <Icon name="refresh" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />Ctrl+Z ย้อนกลับได้
          {historyRef.current.length > 0 && (
            <span style={{ marginLeft: 4, color: "var(--accent-dk)", fontWeight: 600 }}>({historyRef.current.length})</span>
          )}
        </span>
        {undoCount > 0 && (
          <span style={{ fontSize: 11.5, color: "var(--success)", fontWeight: 600 }}>↩ ย้อนกลับแล้ว</span>
        )}
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {makeQr ? "เปิดสร้าง QR — จะได้ป้ายทุกชิ้นอัตโนมัติ" : "ปิดสร้าง QR — บันทึกแค่ยอด Release"}
        </span>
        {!colDefault && (
          <Btn variant="ghost" size="sm" onClick={resetCols} title={L("คืนลำดับคอลัมน์เริ่มต้น (ตามฟอร์ม Excel: Part No., จำนวน, Length, Weight/M, Material, Total Kg, Remark)", "Reset the column order (Excel form: Part No., Qty, Length, Weight/M, Material, Total Kg, Remark)")}>
            ↺ {L("ลำดับคอลัมน์", "Column order")}
          </Btn>
        )}
        <Btn variant="ghost" size="sm" style={{ marginLeft: "auto" }}
          onClick={() => rowsScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px" }}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          &nbsp;ขึ้นบนสุด
        </Btn>
      </div>
    </Modal>
  );
}

// ─── Import Release จากไฟล์ Excel (หลาย Part ในใบเดียว) ─────────────────────
// ไฟล์ต้นแบบ: "Production Release Report" — มี Release Order + Project ที่หัว
// เอกสาร ตามด้วยตารางรายการ Part หลายแถว (Code / Qty / Length / Weight-per-m /
// Material / Remark) แต่ละแถวจะกลายเป็น 1 release + สร้าง QR ต่อชิ้นให้ครบ
// ตาม Qty เหมือนการ Release ทีละ Part ทุกประการ — ต่างกันที่ทำทีเดียวหลาย Part
// และ Part ที่ยังไม่มีใน Part Master จะถูกสร้างให้อัตโนมัติจากข้อมูลในไฟล์
function ImportReleaseModal({ user, projects, parts, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null); // { releaseOrder, projectCode, items }
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState("");

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setErr(""); setParsed(null);
    try {
      const { parseReleaseExcel } = await import("./excelImport.js"); // โหลด xlsx เฉพาะตอนใช้จริง
      const result = await parseReleaseExcel(f);
      setParsed(result);
      const matchedProject = projects.find(
        (p) => p.code.trim().toLowerCase() === result.projectCode.trim().toLowerCase()
      );
      setProjectId(matchedProject ? matchedProject.id : "");
    } catch (e2) {
      setErr(e2.message || "อ่านไฟล์ไม่สำเร็จ");
    }
  }

  // ★ บันทึก Material: น้ำหนัก/ชิ้นว่างในไฟล์ → คิดจาก Weight/M ของ INV (โปรเจค → Center Stock) · INV ใหม่ → บันทึกเข้าโปรเจคหลังนำเข้า
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const [mat, setMat] = useState({ state: "idle", res: null });
  useEffect(() => {
    if (!projectId) { setMat({ state: "idle", res: null }); return undefined; }
    let alive = true;
    getMaterials(projectId).then((r) => { if (alive) setMat({ state: r && r.ok ? "ok" : (r && r.reason === "not_installed" ? "not_installed" : "error"), res: r && r.ok ? r : null }); })
      .catch(() => { if (alive) setMat({ state: "error", res: null }); });
    return () => { alive = false; };
  }, [projectId]);
  const matIdx = useMemo(() => buildMatIndex(mat.res), [mat.res]);
  const partsInProject = parts.filter((p) => p.project_id === projectId);
  const rowsPreview = (parsed?.items || []).map((it) => {
    const lk = matLookup(matIdx, it.material);
    const hasW = Number(it.unit_weight) > 0;
    const len = gnum(it.length_mm);
    const autoW = !hasW && len && lk.wpm != null ? Number(((len / 1000) * lk.wpm).toFixed(4)) : null;
    const inv = !String(it.material || "").trim() ? null : lk.scrap ? "scrap" : mat.state === "ok" ? (lk.inProject ? "proj" : lk.inCenter ? "center" : "new") : null;
    return {
      ...it,
      unit_weight: hasW ? it.unit_weight : (autoW ?? it.unit_weight),
      autoW: autoW != null, invState: inv,
      fileWpm: gnum(it.weight_per_m) ?? (hasW && len ? Number((Number(it.unit_weight) / (len / 1000)).toFixed(4)) : null),
      existingPart: partsInProject.find((p) => p.part_no.trim().toLowerCase() === it.code.trim().toLowerCase()),
    };
  });
  const newInvCount = new Set(rowsPreview.filter((r) => r.invState === "new").map((r) => matKey(r.material))).size;
  const newPartCount = rowsPreview.filter((r) => !r.existingPart).length;
  const totalUnits = rowsPreview.reduce((sum, r) => sum + r.qty, 0);

  async function doImport() {
    if (!parsed || !projectId) return;
    setBusy(true); setErr(""); setProgress("กำลังนำเข้าทั้งใบ...");
    try {
      // นำเข้าทั้งใบใน transaction เดียว (atomic) — พังกลางคัน = rollback ทั้งใบ (แก้ H2)
      // Part ใหม่จาก Excel จะยังไม่มี routing → เตือนผู้ใช้ให้ไปตั้งที่ Setup (แก้ M3)
      const rows = rowsPreview.map((r) => ({
        code: r.code,
        qty: r.qty,
        unit_weight: r.unit_weight,
        length_mm: r.length_mm,
        material: r.material,
        remark: r.remark,
        routing: [],
      }));
      // ★ กัน Release ซ้ำตอน retry: ถ้า (โปรเจค+เลข Order) นี้มีแล้ว อย่านำเข้าซ้ำ
      if (await releaseOrderExists(projectId, parsed.releaseOrder)) {
        setErr(`Release Order "${parsed.releaseOrder}" มีอยู่แล้วในโปรเจคนี้ — อาจนำเข้าไปแล้ว · ตรวจในรายการ Release ก่อนนำเข้าซ้ำ`);
        setBusy(false); setProgress(""); return;
      }
      const res = await createReleaseBatch({
        projectId, releaseOrder: parsed.releaseOrder, releaseDate: null,
        releasedBy: user.id, makeQr: true, rows,
      });
      // ★ INV ที่ยังไม่มี → บันทึกเข้า Material ของโปรเจค (พลาดไม่กระทบ Release ที่นำเข้าแล้ว)
      if (mat.state !== "not_installed") {
        try {
          const mr = await addMaterialsFromRelease(projectId, parsed.releaseOrder, rowsPreview.filter((r) => r.invState !== "scrap").map((r) => ({ inv: r.material, wpm: r.fileWpm })));   // ★ เศษไม่บันทึก
          if (mr && mr.ok && (mr.added || []).length) mlsToast(L(`บันทึก INV ใหม่ ${mr.added.length} รายการเข้า Material ของโปรเจค — กรอกความยาว/จำนวนได้ที่เมนู "บันทึก Material"`, `${mr.added.length} new INV added to the project's materials — fill length/qty in "Materials"`), "success");
        } catch (_) { /* ignore */ }
      }
      onImported({ releaseOrder: parsed.releaseOrder, ...res });
      onClose();
    } catch (e2) {
      setErr("เกิดข้อผิดพลาดระหว่างนำเข้า: " + e2.message + " — ถ้าเน็ตหลุดหลังกดนำเข้า อาจนำเข้าไปแล้ว · รีเฟรชแล้วตรวจในรายการ Release ก่อนนำเข้าซ้ำ");
    }
    setBusy(false); setProgress("");
  }

  return (
    <Modal
      title="นำเข้า Release จาก Excel"
      sub="รองรับไฟล์ฟอร์ม Production Release Report (หลาย Part ในใบเดียว)"
      onClose={onClose}
      closeOnBackdrop={false}
      locked={busy}
    >
      <div className="modal-lock-hint">
        <Icon name="lock" size={12} /> หน้าต่างนี้ล็อกไว้ — คลิกนอกกรอบจะไม่ปิด กด "ยกเลิก" หรือ ✕ เพื่อออก
      </div>
      {!parsed && (
        <>
          <Field label="เลือกไฟล์ Excel (.xlsx)">
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="input" />
          </Field>
          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 4 }}>{err}</div>}
        </>
      )}

      {parsed && (
        <>
          <div className="grid-2" style={{ marginBottom: 10 }}>
            <Field label="เลขที่ Release Order (จากไฟล์)">
              <Input value={parsed.releaseOrder || "-"} readOnly />
            </Field>
            <Field label="โปรเจค">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
            </Field>
          </div>
          {!projectId && (
            <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>
              ไม่พบโปรเจค "{parsed.projectCode}" ที่ตรงกันในระบบ — กรุณาเลือกโปรเจคเป้าหมายเอง
            </div>
          )}

          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
            พบ {rowsPreview.length} รายการ Part · รวม {fmtNum(totalUnits)} ชิ้น
            {newPartCount > 0 && <> · <b style={{ color: "var(--accent-dk)" }}>{newPartCount} Part จะถูกสร้างใหม่อัตโนมัติ</b></>}
            {newInvCount > 0 && <> · <b style={{ color: "#6d4aff" }}>{L(`INV ใหม่ ${newInvCount} รายการ → บันทึกเข้า Material ของโปรเจค`, `${newInvCount} new INV → added to the project's materials`)}</b></>}
          </div>
          {newPartCount > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--warning)", marginBottom: 10, lineHeight: 1.5, display: "flex", gap: 6 }}>
              <Icon name="bolt" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Part ใหม่จากไฟล์จะยังไม่มี Routing — หลังนำเข้าให้ไปตั้งขั้นตอนที่ <b>Setup &gt; Part Master</b> ไม่งั้นชิ้นงานจะไม่ขึ้นสถานะ "เสร็จ"</span>
            </div>
          )}

          <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
            <table className="data-table">
              <thead>
                <tr><th>Part No.</th><th>Qty</th><th>ยาว (มม.)</th><th>น้ำหนัก/ชิ้น</th><th>วัสดุ</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {rowsPreview.map((r, i) => (
                  <tr key={i}>
                    <td>{r.code}</td>
                    <td>{r.qty}</td>
                    <td>{r.length_mm ? fmtNum(r.length_mm) : "-"}</td>
                    <td title={r.autoW ? L("คิดจาก Weight/M ในบันทึก Material", "from the Weight/M in Materials") : undefined}>{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}{r.autoW ? <span className="pg-tag auto inline">{L("อัตโนมัติ", "auto")}</span> : null}</td>
                    <td>{r.material || "-"}{r.invState === "new" ? <span className="pg-tag new inline" title={L("INV ใหม่ — จะบันทึกเข้า Material ของโปรเจค", "New INV — will be added to the project's materials")}>{L("ใหม่", "new")}</span> : r.invState === "center" ? <span className="pg-tag ctr inline">Center</span> : r.invState === "scrap" ? <span className="pg-tag scrap inline" title={L("เศษ — ไม่บันทึกเข้า Material · น้ำหนักตามไฟล์", "Scrap — not stored in Materials · weight as in the file")}>{L("เศษ", "scrap")}</span> : null}</td>
                    <td>{r.existingPart ? <Badge tone="steel">มีอยู่แล้ว</Badge> : <Badge tone="warning">สร้างใหม่</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
          {busy && progress && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{progress}</div>}

          <div className="modal-actions">
            <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
            <Btn type="button" variant="accent" onClick={doImport} disabled={busy || !projectId}>
              {busy ? "กำลังนำเข้า..." : `นำเข้าและสร้าง QR ทั้งหมด (${fmtNum(totalUnits)} ใบ)`}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ══ Sub Assembly release (เบอร์แม่ kind=subassembly + ลูกตาม BOM × จำนวน) ══════
// บันทึกต่อกลุ่ม 3 ขั้น: (1) release เบอร์แม่ (createReleaseBatch → part+QR) (2) ตั้ง kind=subassembly
//   (3) upsert ลูก + ตั้ง BOM (ต่อชุด = จำนวนรวมของลูก ÷ จำนวนแม่)
// รองรับทั้งกรอกมือและนำเข้า Excel (ปุ่มนำเข้าเติมกลุ่มให้ แล้วผู้ใช้ตรวจก่อนบันทึก)
function emptySubAsmChild() { return { code: "", desc: "", len: "", perSet: "" }; }
function emptySubAsmGroup() { return { parentKind: "subassembly", parentCode: "", parentDesc: "", parentLen: "", parentQty: "1", children: [] }; }

function AssemblyReleaseModal({ user, projects, onClose, onSaved, onNeedProject }) {
  const [releaseOrder, setReleaseOrder] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [groups, setGroups] = useState([emptySubAsmGroup()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState("");
  const fileRef = useRef(null);

  const setParent = (gi, key, val) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, [key]: val } : g)));
  const setChild = (gi, ci, key, val) => setGroups((gs) => gs.map((g, i) => (i === gi
    ? { ...g, children: g.children.map((c, j) => (j === ci ? { ...c, [key]: val } : c)) } : g)));
  const addChild = (gi) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, children: [...g.children, emptySubAsmChild()] } : g)));
  const removeChild = (gi, ci) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, children: g.children.filter((_, j) => j !== ci) } : g)));
  const addGroup = () => setGroups((gs) => [...gs, emptySubAsmGroup()]);
  const removeGroup = (gi) => setGroups((gs) => (gs.length <= 1 ? [emptySubAsmGroup()] : gs.filter((_, i) => i !== gi)));

  // เติมฟอร์มจากผลที่ parse ได้ (ใช้ทั้งนำเข้าไฟล์ + วางจาก Excel)
  function matchProject(projectName) {
    if (!projectName) return;
    const nm = projectName.toLowerCase();
    const pj = projects.find((p) => (p.name || "").toLowerCase() === nm || (p.code || "").toLowerCase() === nm);
    if (pj) setProjectId(pj.id);
  }
  function applyBom(parsed, src) {
    const gs = parsed.groups.map((g) => ({
      parentKind: g.parentKind || "subassembly",
      parentCode: g.parentCode, parentDesc: g.parentDesc,
      parentLen: g.parentLen ?? "", parentQty: String(g.parentQty || 1),
      // ไฟล์/วาง คืน "จำนวนรวมทุกแม่" (totalQty) → แปลงเป็น "ต่อชุด" (÷ จำนวนแม่) ให้ฟอร์มใหม่ที่กรอกต่อชุดตรง ๆ
      children: g.children.map((c) => ({
        code: c.code, desc: c.desc, len: c.len ?? "",
        perSet: Number(c.totalQty) > 0 ? String(Math.max(1, Math.round(Number(c.totalQty) / (Number(g.parentQty) || 1)))) : "",
      })),
    }));
    setGroups(gs.length ? gs : [emptySubAsmGroup()]);
    if (parsed.releaseOrder) setReleaseOrder(parsed.releaseOrder);
    matchProject(parsed.projectName);
    mlsToast(`${src} ${gs.length} เบอร์แม่ — ตรวจแล้วกดบันทึก`, "success");
  }
  // รายชื่อแผง (flat) → กลุ่มแบบ "ไม่มีลูก" (ปล่อยงานเฉยๆ · kind=panel)
  function applyPanelAsGroups(parsed, src) {
    const gs = parsed.items.map((it) => ({ parentKind: "panel", parentCode: it.code, parentDesc: "", parentLen: "", parentQty: String(it.qty || 1), children: [] }));
    setGroups(gs.length ? gs : [emptySubAsmGroup()]);
    if (parsed.releaseOrder) setReleaseOrder(parsed.releaseOrder);
    matchProject(parsed.projectName);
    mlsToast(`${src} ${gs.length} แผง (ปล่อยงานเฉยๆ) — ตรวจแล้วกดบันทึก`, "success");
  }
  // นำเข้า/วาง auto-detect เอง: ลองอ่านเป็นฟอร์ม BOM ก่อน · ถ้าไม่ใช่ (ไม่มีคอลัมน์ Code) → อ่านเป็นรายชื่อแผง
  async function onPickFile(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setErr("");
    try {
      const mod = await import("./excelImport.js");
      try { applyBom(await mod.parseSubAssemblyExcel(file), "อ่านไฟล์ได้"); }
      catch { applyPanelAsGroups(await mod.parsePanelReleaseExcel(file), "อ่านไฟล์ได้"); }
    } catch (e2) { setErr("อ่านไฟล์ไม่สำเร็จ: " + (e2?.message || e2)); }
  }
  const pasteRef = useRef(null);
  const lastPasteRef = useRef(0);
  async function handlePastedText(text) {
    if (!text || (!text.includes("\t") && !text.includes("\n"))) {
      setErr("ยังไม่ใช่ตาราง — ก็อปจาก Excel โดยลากคลุมทั้งตาราง (รวมแถวหัว Code/Quantity/Sum) ก่อน");
      return;
    }
    const now = Date.now();
    if (now - lastPasteRef.current < 400) return;   // กันประมวลผลซ้ำ (ช่องวาง + ตัวฟังทั้งหน้า ยิงพร้อมกัน)
    lastPasteRef.current = now;
    setErr("");
    try {
      const mod = await import("./excelImport.js");
      try { applyBom(mod.parseSubAssemblyText(text), "วางข้อมูลได้"); }
      catch { applyPanelAsGroups(mod.parsePanelReleaseText(text), "วางข้อมูลได้"); }
    } catch (e2) { setErr("อ่านข้อมูลที่วางไม่สำเร็จ: " + (e2?.message || e2)); }
  }
  function onPasteTextarea(e) {
    const text = e.clipboardData?.getData("text") || "";
    if (!text.includes("\t") && !text.includes("\n")) return;   // ค่าเดียว → วางปกติ
    e.preventDefault();
    handlePastedText(text);
  }
  // วางด้วย Ctrl+V ได้เลย: โฟกัสช่องวางอัตโนมัติตอนเปิด + ฟัง paste ทั้งหน้าเป็นสำรอง (เผื่อโฟกัสหลุด)
  useEffect(() => {
    try { pasteRef.current?.focus(); } catch { /* ignore */ }
    const onDocPaste = (ev) => {
      const text = ev.clipboardData?.getData("text") || "";
      if (!text.includes("\t") && !text.includes("\n")) return;
      ev.preventDefault();
      handlePastedText(text);
    };
    document.addEventListener("paste", onDocPaste);
    return () => document.removeEventListener("paste", onDocPaste);
  }, []);

  // บันทึก 1 กลุ่ม (เบอร์แม่ + ลูก) — atomic เฉพาะขั้น release; BOM/kind เป็นขั้นต่อเนื่อง
  async function saveOneGroup(g, ro) {
    const parentCode = g.parentCode.trim();
    const pQty = parseInt(g.parentQty, 10) || 1;
    // 1) release เบอร์แม่ → หา/สร้าง part_master (ถ้ายังไม่มี) + release + QR
    //    ★ หาแม่ก่อนเสมอ (เหมือน saveOneBunk) — ถ้ามีแล้วข้าม createReleaseBatch
    //    กัน retry หลังพลาดกลางกลุ่ม สร้าง release + QR ซ้ำ (createReleaseBatch ไม่ idempotent)
    let parentPm = (await listRows("part_master", { filters: { project_id: projectId, part_no: parentCode } }))[0];
    if (!parentPm) {
      await createReleaseBatch({
        projectId, releaseOrder: ro, releaseDate: dateToIso(date), releasedBy: user.id, makeQr: true,
        rows: [{ code: parentCode, qty: pQty, unit_weight: 0,
          length_mm: g.parentLen === "" || g.parentLen == null ? null : Number(g.parentLen),
          material: null, remark: null, routing: [] }],
      });
      parentPm = (await listRows("part_master", { filters: { project_id: projectId, part_no: parentCode } }))[0];
    }
    if (!parentPm) throw new Error(`ไม่พบเบอร์แม่ ${parentCode} หลังสร้าง`);
    // 2) ตั้ง kind=subassembly (replace-style, idempotent)
    await updateRow("part_master", parentPm.id, { kind: g.parentKind || "subassembly" });
    // 3) upsert ลูก → id + ตั้ง BOM (qty = "ต่อชุด" ที่กรอกโดยตรง — 1 แม่ใช้ลูกกี่ชิ้น)
    const components = [];
    for (const ch of g.children) {
      const code = ch.code.trim();
      if (!code || !(Number(ch.perSet) > 0)) continue;
      let pm = (await listRows("part_master", { filters: { project_id: projectId, part_no: code } }))[0];
      if (!pm) {
        const created = await insertRow("part_master", {
          project_id: projectId, part_no: code, part_name: ch.desc?.trim() || code,
          material: null, unit_weight: 0,
          default_length_mm: ch.len === "" || ch.len == null ? null : Number(ch.len),
          routing: [], kind: /^\s*sa/i.test(code) ? "subassembly" : "part",   // ลูกที่ code ขึ้นต้น SA = เบอร์ซับ
        });
        pm = created && created.id ? created : (await listRows("part_master", { filters: { project_id: projectId, part_no: code } }))[0];
      }
      if (!pm?.id) throw new Error(`สร้าง/หาลูก ${code} ไม่สำเร็จ`);
      const perUnit = Math.max(1, Math.round(Number(ch.perSet)));   // "ต่อชุด" = qty ใน BOM โดยตรง (ไม่ต้องหารแล้ว)
      components.push({ child_pm_id: pm.id, qty: perUnit });
    }
    if (components.length) await setBom(parentPm.id, components);
  }

  async function doSave() {
    const ro = normalizeReleaseOrder(releaseOrder);
    if (!ro || !RELEASE_ORDER_RE.test(ro)) { setErr('เลขที่ Release Order ต้องเป็นรูปแบบ "P-ตัวเลข" เช่น P-076'); return; }
    if (!projectId) { setErr("กรุณาเลือกโปรเจค"); return; }
    if (!date) { setErr("กรุณาเลือกวันที่"); return; }
    const clean = groups
      .map((g) => ({ ...g, parentCode: g.parentCode.trim(), children: g.children.filter((c) => c.code.trim() && Number(c.perSet) > 0) }))
      .filter((g) => g.parentCode);   // มีเบอร์แม่พอ · มีลูก = ตั้ง BOM · ไม่มีลูก = ปล่อยงานเฉยๆ (เช่นแผง)
    if (clean.length === 0) { setErr("ต้องมีอย่างน้อย 1 เบอร์แม่ (กรอก Code)"); return; }
    for (const g of clean) {
      const pq = Number(g.parentQty);
      if (!Number.isInteger(pq) || pq < 1) { setErr(`จำนวนแม่ของ "${g.parentCode}" ต้องเป็นจำนวนเต็ม ≥ 1`); return; }
      for (const c of g.children) {
        const ps = Number(c.perSet);
        if (!Number.isInteger(ps) || ps < 1) { setErr(`จำนวนต่อชุดของลูก "${c.code}" ใน "${g.parentCode}" ต้องเป็นจำนวนเต็ม ≥ 1`); return; }
      }
    }
    setBusy(true); setErr("");
    let done = 0;
    try {
      for (const g of clean) {
        setProgress(`กำลังบันทึก ${g.parentCode} (${done + 1}/${clean.length})...`);
        await saveOneGroup(g, ro);
        done++;
      }
      onSaved({ releaseOrder: ro, groups: clean.length });
    } catch (e2) {
      // เก็บเฉพาะเบอร์ที่ "ยังไม่บันทึก" ไว้ในฟอร์ม กันกดซ้ำแล้วสร้าง release ซ้ำ
      const remaining = clean.slice(done).map((g) => ({
        parentCode: g.parentCode, parentDesc: g.parentDesc, parentLen: g.parentLen, parentQty: String(g.parentQty),
        children: g.children.map((c) => ({ code: c.code, desc: c.desc, len: c.len, perSet: String(c.perSet) })),
      }));
      setGroups(remaining.length ? remaining : [emptySubAsmGroup()]);
      setErr(`บันทึกไม่สำเร็จที่เบอร์ "${clean[done]?.parentCode || "-"}": ${e2?.message || e2}` + (done > 0 ? ` · บันทึกสำเร็จไปแล้ว ${done} เบอร์ (เอาออกจากฟอร์มให้แล้ว ไม่ต้องทำซ้ำ)` : ""));
      setBusy(false); setProgress("");
      return;
    }
    setBusy(false); setProgress("");
  }

  const totalParents = groups.filter((g) => g.parentCode.trim()).length;
  const totalUnits = groups.reduce((s, g) => s + (g.parentCode.trim() ? (parseInt(g.parentQty, 10) || 0) : 0), 0);

  return (
    <Modal title="เพิ่ม / นำเข้า เบอร์ประกอบ + แผง" wide
      sub="ฟอร์มเดียวใช้ได้ทั้งคู่: ใส่ลูก = ตั้ง BOM + ปล่อยงาน (ซับ/แผง) · ไม่ใส่ลูก = ปล่อยงานเฉยๆ (เช่นแผง) · นำเข้า/วางจาก Excel ได้ทั้งฟอร์ม BOM และรายชื่อแผง — ระบบแยกให้เอง"
      onClose={onClose} closeOnBackdrop={false} locked={busy}>
      <div className="modal-lock-hint">
        <Icon name="lock" size={12} /> หน้าต่างนี้ล็อกไว้ — กด "ยกเลิก" หรือ ✕ เพื่อออก
      </div>

      <div className="release-header-fields" style={{ marginBottom: 12 }}>
        <Field label="เลขที่ Release Order *">
          <Input value={releaseOrder} placeholder="เช่น P-076"
            onChange={(e) => setReleaseOrder(e.target.value)}
            onBlur={(e) => setReleaseOrder(normalizeReleaseOrder(e.target.value))} />
        </Field>
        <Field label="วันที่ *"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="โปรเจค *">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
        </Field>
        <Btn type="button" variant="ghost" className="icon-btn-add" title="สร้างโปรเจคใหม่"
          onClick={() => onNeedProject && onNeedProject()}><Icon name="plus" size={16} /></Btn>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={onPickFile} />
        <Btn type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="folder" size={14} /> นำเข้าจากไฟล์ Excel
        </Btn>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>หรือก็อปตารางจาก Excel แล้ว <b>กด Ctrl+V</b> (ช่องด้านล่างพร้อมวางแล้ว)</span>
      </div>
      <textarea ref={pasteRef} onPaste={onPasteTextarea} rows={2} disabled={busy}
        placeholder="⬇ วางตารางที่นี่ด้วย Ctrl+V — ก็อปจาก Excel รวมแถวหัว (Code / Quantity / Sum) · ได้ทั้งฟอร์ม BOM และรายชื่อแผง"
        style={{ width: "100%", boxSizing: "border-box", resize: "none", padding: "11px 12px", borderRadius: 8, marginBottom: 10,
          border: "2px dashed var(--accent, #10b981)", background: "var(--surface-2, #f4f8f6)",
          fontSize: 13, fontFamily: "inherit", color: "var(--muted)" }} />
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        หรือกรอกมือด้านล่าง · รวม <b>{fmtNum(totalParents)}</b> เบอร์ · ปล่อยงาน <b>{fmtNum(totalUnits)}</b> ชิ้น (QR)
      </div>

      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>{err}</div>}
      {progress && <div style={{ color: "var(--accent-dk)", fontSize: 12.5, marginBottom: 10 }}>{progress}</div>}

      <div style={{ maxHeight: "48vh", overflow: "auto", paddingRight: 4 }}>
        {groups.map((g, gi) => {
          const pq = parseInt(g.parentQty, 10) || 0;
          return (
            <div key={gi} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12, background: "var(--surface-2, #f6f8f7)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
                <div style={{ flex: "0 0 108px" }}>
                  <Field label={`ชนิด #${gi + 1}`}>
                    <Select value={g.parentKind || "subassembly"} onChange={(e) => setParent(gi, "parentKind", e.target.value)}
                      options={[{ value: "subassembly", label: "ซับ (Sub)" }, { value: "panel", label: "แผง (Panel)" }, { value: "package", label: "แพ็ก (Pack)" }]} />
                  </Field>
                </div>
                <div style={{ flex: "1 1 130px", minWidth: 120 }}>
                  <Field label="เบอร์แม่ (Code) *"><Input value={g.parentCode} placeholder="เช่น SAAN04-001 / UA1501B"
                    onChange={(e) => setParent(gi, "parentCode", e.target.value)} /></Field>
                </div>
                <div style={{ flex: "2 1 200px", minWidth: 160 }}>
                  <Field label="รายละเอียด"><Input value={g.parentDesc} placeholder="SUB-ASSEMBLY ..."
                    onChange={(e) => setParent(gi, "parentDesc", e.target.value)} /></Field>
                </div>
                <div style={{ flex: "0 0 80px" }}>
                  <Field label="L (มม.)"><Input value={g.parentLen} inputMode="decimal"
                    onChange={(e) => setParent(gi, "parentLen", e.target.value)} /></Field>
                </div>
                <div style={{ flex: "0 0 90px" }}>
                  <Field label="จำนวนแม่ *"><Input value={g.parentQty} inputMode="numeric"
                    onChange={(e) => setParent(gi, "parentQty", e.target.value)} /></Field>
                </div>
                <Btn type="button" variant="ghost" size="sm" title="ลบเบอร์แม่นี้" onClick={() => removeGroup(gi)}>
                  <Icon name="trash" size={13} />
                </Btn>
              </div>

              {g.children.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table bom-child-table" style={{ fontSize: 12.5, width: "100%", minWidth: 620, tableLayout: "fixed" }}>
                  <thead><tr>
                    <th style={{ width: 132 }}>ลูก (Code)</th><th>รายละเอียด</th>
                    <th style={{ width: 96 }}>L</th><th style={{ width: 96 }}>ต่อชุด *</th>
                    <th style={{ width: 84 }}>รวมทุกแม่</th><th style={{ width: 30 }}></th>
                  </tr></thead>
                  <tbody>
                    {g.children.map((c, ci) => {
                      const per = Number(c.perSet);
                      const total = pq > 0 && per > 0 ? per * pq : null;   // ต่อชุด × จำนวนแม่ = ลูกที่ต้องใช้ทั้งหมด (โชว์เฉย ๆ)
                      const totalTxt = total == null ? "—" : fmtNum(total);
                      return (
                        <tr key={ci}>
                          <td><Input value={c.code} title={c.code} placeholder="AN04-001A" style={{ width: "100%" }} onChange={(e) => setChild(gi, ci, "code", e.target.value)} /></td>
                          <td><Input value={c.desc} title={c.desc} placeholder="ANCHOR BASE PLATE" style={{ width: "100%" }} onChange={(e) => setChild(gi, ci, "desc", e.target.value)} /></td>
                          <td><Input value={c.len} title={c.len} inputMode="decimal" style={{ width: "100%" }} onChange={(e) => setChild(gi, ci, "len", e.target.value)} /></td>
                          <td><Input value={c.perSet} inputMode="numeric" placeholder="ใส่จำนวน" style={{ width: "100%" }} onChange={(e) => setChild(gi, ci, "perSet", e.target.value)} /></td>
                          <td style={{ textAlign: "center", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{totalTxt}</td>
                          <td style={{ textAlign: "center" }}>
                            <span onClick={() => removeChild(gi, ci)} title="ลบลูก" style={{ cursor: "pointer", color: "var(--danger-hi)" }}>✕</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
              <Btn type="button" variant="ghost" size="sm" onClick={() => addChild(gi)} style={{ marginTop: 6 }}>
                <Icon name="plus" size={13} /> {g.children.length > 0 ? "เพิ่มลูก" : "＋ ใส่ลูก (ตั้ง BOM) — ไม่ใส่ = ปล่อยงานเฉยๆ"}
              </Btn>
            </div>
          );
        })}
      </div>

      <Btn type="button" variant="ghost" onClick={addGroup} style={{ marginTop: 4 }}>
        <Icon name="plus" size={15} /> เพิ่มเบอร์แม่
      </Btn>

      <div className="modal-actions" style={{ marginTop: 14 }}>
        <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
        <Btn type="button" variant="accent" onClick={doSave} disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึก + ปล่อยงาน"}
        </Btn>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// นำเข้า "ฟอร์มบั้ง (Packing List)" — ไฟล์เดียวหลายบั้ง → สร้าง package + BOM + manifest
//   1 บั้ง = 1 package (kind=package + QR) · ยูนิตในบั้ง = BOM (จับคู่ part_no) · ฟอร์มเต็ม = pkg_manifest
//   หน้าแพ็กที่สเตชันจะโชว์ manifest นี้ (ตำแหน่ง/ขนาด/น้ำหนัก) แล้วสแกนยูนิตเข้าเพื่อติดตามแพ็ก
// ══════════════════════════════════════════════════════════════════════════
function BunkImportModal({ user, projects, onClose, onSaved, onNeedProject }) {
  const [releaseOrder, setReleaseOrder] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [packType, setPackType] = useState("panel");   // ชนิดการแพ็กของบั้งชุดนี้: panel (แพ็กแผง) / site (แพ็กไซต์ไอเทม) → pkg_meta.pack_type
  const [bunks, setBunks] = useState([]);      // [{ meta, units }]
  const [openIdx, setOpenIdx] = useState(-1);  // การ์ดที่กางดูยูนิต
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState("");
  const fileRef = useRef(null);
  const pasteRef = useRef(null);
  const lastPasteRef = useRef(0);

  function matchProject(projectName) {
    if (!projectName) return;
    const nm = String(projectName).toLowerCase();
    // ★ กัน code/name ว่าง: "..".includes("") = true เสมอ → เดิมเลือกโปรเจคที่ code ว่างมั่ว
    const pj = projects.find((p) => {
      const code = (p.code || "").toLowerCase(), name = (p.name || "").toLowerCase();
      return (name && name === nm) || (code && code === nm) || (code && nm.includes(code)) || (name && name.includes(nm));
    });
    if (pj) setProjectId(pj.id);
  }
  function applyBunks(parsed, src) {
    const list = (parsed?.bunks || []).filter((b) => b && b.units && b.units.length);
    if (!list.length) { setErr("ไม่พบข้อมูลบั้งในไฟล์/ข้อความ — ตรวจว่ามีหัว 'BUNK NO.' + ตาราง Unit No/Weight"); return; }
    setBunks(list);
    setOpenIdx(-1);
    matchProject(list[0]?.meta?.project);
    setErr("");
    mlsToast(`${src} ${list.length} บั้ง · ${list.reduce((s, b) => s + b.units.length, 0)} ยูนิต — ตรวจแล้วกดบันทึก`, "success");
  }
  async function onPickFile(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setErr("");
    try {
      const mod = await import("./excelImport.js");
      applyBunks(await mod.parseBunkExcel(file), "อ่านไฟล์ได้");
    } catch (e2) { setErr("อ่านไฟล์ไม่สำเร็จ: " + (e2?.message || e2)); }
  }
  async function handlePastedText(text) {
    if (!text || (!text.includes("\t") && !text.includes("\n"))) {
      setErr("ยังไม่ใช่ตาราง — ก็อปจาก Excel ทั้งฟอร์มบั้ง (รวมหัว BUNK NO. + ตาราง Unit No) ก่อน"); return;
    }
    const now = Date.now(); if (now - lastPasteRef.current < 400) return; lastPasteRef.current = now;
    setErr("");
    try {
      const mod = await import("./excelImport.js");
      applyBunks(mod.parseBunkText(text), "วางข้อมูลได้");
    } catch (e2) { setErr("อ่านข้อมูลที่วางไม่สำเร็จ: " + (e2?.message || e2)); }
  }
  function onPasteTextarea(e) {
    const text = e.clipboardData?.getData("text") || "";
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault(); handlePastedText(text);
  }
  useEffect(() => {
    try { pasteRef.current?.focus(); } catch { /* ignore */ }
    const onDocPaste = (ev) => {
      const text = ev.clipboardData?.getData("text") || "";
      if (!text.includes("\t") && !text.includes("\n")) return;
      ev.preventDefault(); handlePastedText(text);
    };
    document.addEventListener("paste", onDocPaste);
    return () => document.removeEventListener("paste", onDocPaste);
  }, []);

  const removeBunk = (i) => setBunks((bs) => bs.filter((_, j) => j !== i));

  // บันทึก 1 บั้ง: หา/สร้าง package (+QR) → kind=package → BOM (รวมตาม unit_no) → manifest
  //   คืนรายชื่อยูนิตที่ "สร้างใหม่" (ยังไม่มีในระบบ = ยังไม่มี QR ให้สแกน) ไว้เตือน office
  async function saveOneBunk(bunk, ro) {
    const code = String(bunk.meta?.bunk_no || "").trim();
    if (!code) throw new Error("บั้งนี้ไม่มีเลข BUNK NO.");
    let parentPm = (await listRows("part_master", { filters: { project_id: projectId, part_no: code } }))[0];
    if (!parentPm) {
      await createReleaseBatch({
        projectId, releaseOrder: ro, releaseDate: dateToIso(date), releasedBy: user.id, makeQr: true,
        rows: [{ code, qty: 1, unit_weight: Number(bunk.meta?.total_weight) || 0, length_mm: null, material: null,
          remark: [bunk.meta?.project, bunk.meta?.elevation, bunk.meta?.level].filter(Boolean).join(" · ") || null, routing: [] }],
      });
      parentPm = (await listRows("part_master", { filters: { project_id: projectId, part_no: code } }))[0];
    }
    if (!parentPm?.id) throw new Error(`ไม่พบบั้ง ${code} หลังสร้าง`);
    if (parentPm.kind !== "package") await updateRow("part_master", parentPm.id, { kind: "package" });

    // รวมยูนิตตาม unit_no (sum qty) → BOM
    const byNo = new Map();
    for (const u of bunk.units) {
      const key = String(u.unit_no || "").trim();
      if (!key) continue;
      byNo.set(key, (byNo.get(key) || 0) + (Number(u.qty) > 0 ? Number(u.qty) : 1));
    }
    const components = []; const createdUnits = [];
    for (const [unitNo, qty] of byNo) {
      let pm = (await listRows("part_master", { filters: { project_id: projectId, part_no: unitNo } }))[0];
      if (!pm) {
        const sample = bunk.units.find((u) => String(u.unit_no).trim() === unitNo) || {};
        const created = await insertRow("part_master", {
          project_id: projectId, part_no: unitNo, part_name: sample.description || unitNo,
          material: null, unit_weight: Number(sample.weight) || 0, default_length_mm: null, routing: [], kind: "part",
        });
        pm = created && created.id ? created : (await listRows("part_master", { filters: { project_id: projectId, part_no: unitNo } }))[0];
        createdUnits.push(unitNo);
      }
      if (!pm?.id) throw new Error(`สร้าง/หายูนิต ${unitNo} ไม่สำเร็จ`);
      components.push({ child_pm_id: pm.id, qty });
    }
    if (components.length) await setBom(parentPm.id, components);
    // ★ ติดป้ายชนิดการแพ็ก (pack_type) ลง pkg_meta → สเตชันแพ็กแผง/แพ็กไซต์ไอเทมกรองบั้งของตัวเอง
    await setPkgManifest(parentPm.id, bunk.units, { ...(bunk.meta || {}), pack_type: packType });
    return { createdUnits };
  }

  async function doSave() {
    const ro = normalizeReleaseOrder(releaseOrder);
    if (!ro || !RELEASE_ORDER_RE.test(ro)) { setErr('เลขที่ Release Order ต้องเป็นรูปแบบ "P-ตัวเลข" เช่น P-100'); return; }
    if (!projectId) { setErr("กรุณาเลือกโปรเจค"); return; }
    if (!date) { setErr("กรุณาเลือกวันที่"); return; }
    if (!bunks.length) { setErr("ยังไม่มีบั้ง — นำเข้าไฟล์ หรือวางฟอร์มบั้งก่อน"); return; }
    const bad = bunks.find((b) => !String(b.meta?.bunk_no || "").trim());
    if (bad) { setErr("มีบั้งที่ไม่มีเลข BUNK NO. — ตรวจไฟล์อีกครั้ง"); return; }

    setBusy(true); setErr(""); let done = 0; const allCreated = new Set();
    try {
      for (const b of bunks) {
        setProgress(`กำลังบันทึกบั้ง ${b.meta.bunk_no} (${done + 1}/${bunks.length})...`);
        const { createdUnits } = await saveOneBunk(b, ro);
        (createdUnits || []).forEach((u) => allCreated.add(u));
        done++;
      }
    } catch (e2) {
      setBunks((bs) => bs.slice(done));   // เหลือเฉพาะบั้งที่ยังไม่บันทึก กันบันทึกซ้ำ
      setErr(`บันทึกไม่สำเร็จที่บั้ง "${bunks[done]?.meta?.bunk_no || "-"}": ${e2?.message || e2}`
        + (done > 0 ? ` · บันทึกสำเร็จไปแล้ว ${done} บั้ง (เอาออกให้แล้ว)` : ""));
      setBusy(false); setProgress("");
      return;
    }
    setBusy(false); setProgress("");
    onSaved({ releaseOrder: ro, bunks: done, createdUnits: Array.from(allCreated) });
  }

  const totalUnits = bunks.reduce((s, b) => s + b.units.length, 0);
  const fmt2 = (n) => (n == null || isNaN(Number(n)) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

  return (
    <Modal title="นำเข้าฟอร์มบั้ง (Packing List)" wide
      sub="1 บั้ง = 1 แพ็ก (package + QR) · ยูนิตในบั้งจะตั้งเป็น BOM ให้อัตโนมัติ · ฟอร์มเต็ม (ตำแหน่ง/ขนาด/น้ำหนัก) เก็บไว้โชว์ที่หน้าแพ็ก — ไฟล์เดียวหลายบั้งได้"
      onClose={onClose} closeOnBackdrop={false} locked={busy}>
      <div className="modal-lock-hint"><Icon name="lock" size={12} /> หน้าต่างนี้ล็อกไว้ — กด "ยกเลิก" หรือ ✕ เพื่อออก</div>

      <div className="release-header-fields" style={{ marginBottom: 12 }}>
        <Field label="เลขที่ Release Order *">
          <Input value={releaseOrder} placeholder="เช่น P-100"
            onChange={(e) => setReleaseOrder(e.target.value)}
            onBlur={(e) => setReleaseOrder(normalizeReleaseOrder(e.target.value))} />
        </Field>
        <Field label="วันที่ *"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="โปรเจค *">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
        </Field>
        <Field label="ชนิดการแพ็ก *">
          <Select value={packType} onChange={(e) => setPackType(e.target.value)}
            options={[{ value: "panel", label: "แพ็กแผง (panel)" }, { value: "site", label: "แพ็กไซต์ไอเทม (site item)" }]} />
        </Field>
        <Btn type="button" variant="ghost" className="icon-btn-add" title="สร้างโปรเจคใหม่"
          onClick={() => onNeedProject && onNeedProject()}><Icon name="plus" size={16} /></Btn>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={onPickFile} />
        <Btn type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="folder" size={14} /> นำเข้าจากไฟล์ Excel
        </Btn>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>หรือก็อปฟอร์มบั้งจาก Excel แล้ว <b>กด Ctrl+V</b> (ช่องด้านล่างพร้อมวางแล้ว)</span>
      </div>
      <textarea ref={pasteRef} onPaste={onPasteTextarea} rows={2} disabled={busy}
        placeholder="⬇ วางฟอร์มบั้งที่นี่ด้วย Ctrl+V — ก็อปจาก Excel รวมหัว BUNK NO. + ตาราง Unit No/Position/Weight · หลายบั้งในครั้งเดียวได้"
        style={{ width: "100%", boxSizing: "border-box", resize: "none", padding: "11px 12px", borderRadius: 8, marginBottom: 10,
          border: "2px dashed #2b8cff", background: "var(--surface-2, #f4f8f6)", fontSize: 13, fontFamily: "inherit", color: "var(--muted)" }} />

      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>{err}</div>}
      {progress && <div style={{ color: "var(--accent-dk)", fontSize: 12.5, marginBottom: 10 }}>{progress}</div>}

      {bunks.length > 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
          พร้อมบันทึก <b>{fmtNum(bunks.length)}</b> บั้ง · รวม <b>{fmtNum(totalUnits)}</b> ยูนิต — แตะการ์ดเพื่อดูรายละเอียด
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, padding: "18px 12px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
          ยังไม่มีบั้ง — นำเข้าไฟล์ Excel หรือวางฟอร์มบั้งด้านบน
        </div>
      )}

      <div style={{ maxHeight: "46vh", overflow: "auto", paddingRight: 4 }}>
        {bunks.map((b, i) => {
          const m = b.meta || {};
          const meta = [m.project, m.elevation, m.level].filter(Boolean).join(" · ");
          const open = openIdx === i;
          return (
            <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, marginBottom: 10, background: "var(--surface-2, #f6f8f7)", overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 13px", cursor: "pointer" }} onClick={() => setOpenIdx(open ? -1 : i)}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 15, color: "var(--ink, #123)" }}>{m.bunk_no || "(ไม่มีเลขบั้ง)"}</span>
                {meta ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{meta}</span> : null}
                <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                  {b.units.length} ยูนิต · {fmt2(m.total_weight)} Lbs
                </span>
                <span onClick={(e) => { e.stopPropagation(); removeBunk(i); }} title="เอาบั้งนี้ออก" style={{ cursor: "pointer", color: "var(--danger-hi)", padding: "0 4px" }}>✕</span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
              </div>
              {open && (
                <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", minWidth: 640 }}>
                    <thead><tr>
                      <th style={{ width: 34 }}>#</th><th style={{ width: 96 }}>ยูนิต</th><th style={{ width: 60 }}>ตำแหน่ง</th>
                      <th>รายละเอียด</th><th style={{ width: 110 }}>ขนาด (มม.)</th><th style={{ width: 64 }}>จำนวน</th><th style={{ width: 88 }}>น้ำหนัก</th>
                    </tr></thead>
                    <tbody>
                      {b.units.map((u, j) => (
                        <tr key={j}>
                          <td style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{u.no || j + 1}</td>
                          <td style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{u.unit_no}</td>
                          <td style={{ fontFamily: "var(--font-mono)", textAlign: "center" }}>{u.position || "—"}</td>
                          <td style={{ color: "var(--muted)" }}>{u.description || ""}{u.address_seq ? ` · ${u.address_seq}` : ""}</td>
                          <td style={{ fontFamily: "var(--font-mono)", textAlign: "right" }}>{u.width != null && u.height != null ? `${fmt2(u.width)} × ${fmt2(u.height)}` : "—"}</td>
                          <td style={{ fontFamily: "var(--font-mono)", textAlign: "center" }}>{u.qty || 1}</td>
                          <td style={{ fontFamily: "var(--font-mono)", textAlign: "right" }}>{u.weight != null ? `${fmt2(u.weight)}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="modal-actions" style={{ marginTop: 14 }}>
        <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
        <Btn type="button" variant="accent" onClick={doSave} disabled={busy || !bunks.length}>
          {busy ? "กำลังบันทึก..." : `บันทึก ${bunks.length ? fmtNum(bunks.length) + " บั้ง" : ""} + ปล่อยงาน`}
        </Btn>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ตรวจงานประกอบ/แพ็ก (หลังบ้าน) — เทียบ "ที่สั่งจาก release (แผน/BOM)" กับ
//   "ที่หน้างานสแกนมาจริง (แต่ละชิ้น + QR)" → ดูว่าทำถูก + ครบไหม
//   หน้างาน (สเตชัน) ไม่โชว์รายการแล้ว = สแกนอย่างเดียว · การตรวจย้ายมาทำที่นี่
// ══════════════════════════════════════════════════════════════════════════
function verifyStatusColor(s) {
  return s === "complete" ? { bg: "rgba(16,185,129,.12)", fg: "var(--accent-dk, #0e9d63)", bd: "rgba(16,185,129,.35)" }
    : s === "partial" ? { bg: "rgba(217,164,65,.14)", fg: "#b45309", bd: "rgba(217,164,65,.4)" }
    : { bg: "rgba(220,38,38,.10)", fg: "var(--danger-hi, #c0362c)", bd: "rgba(220,38,38,.3)" };
}
function AssemblyVerifyPage({ initialQr, onConsumeInitial }) {
  const [parents, setParents] = useState([]);
  const [q, setQ] = useState("");
  const [manualQr, setManualQr] = useState("");
  const [sel, setSel] = useState(null);       // parent meta ที่เลือก
  const [result, setResult] = useState(null);  // ผลเทียบ
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [projSel, setProjSel] = useState(""); // กรองโปรเจค (เหมือนหน้าพิมพ์ QR)
  const [partSel, setPartSel] = useState(""); // กรองเบอร์ (Part)

  useEffect(() => {
    (async () => {
      try {
        const [asm, panel, pack] = await Promise.all([listAssemblyParents("assembly"), listAssemblyParents("panel"), listAssemblyParents("packing")]);
        const seen = new Set(); const merged = [];
        [...asm, ...panel, ...pack].forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); } });
        setParents(merged);
      } catch (e) { /* ยังพิมพ์ QR เองได้ */ }
    })();
  }, []);

  // ตัวเลือก dropdown (เหมือนหน้าพิมพ์ QR) — โปรเจค → Part (Part กรองตามโปรเจคที่เลือก)
  const projOptions = useMemo(
    () => [...new Set(parents.map((p) => p.project_code).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
      .map((c) => ({ value: c, label: c })),
    [parents]);
  const partOptions = useMemo(
    () => [...new Set(parents.filter((p) => !projSel || p.project_code === projSel).map((p) => p.part_no).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
      .map((n) => ({ value: n, label: n })),
    [parents, projSel]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return parents.filter((p) => {
      if (projSel && p.project_code !== projSel) return false;
      if (partSel && p.part_no !== partSel) return false;
      if (s && !((p.part_no || "").toLowerCase().includes(s)
        || (p.qr_code || "").toLowerCase().includes(s)
        || (p.project_code || "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [parents, q, projSel, partSel]);

  async function load(qr, meta) {
    if (!qr) return;
    setBusy(true); setErr(""); setResult(null); setSel(meta || { part_no: qr, qr_code: qr });
    try {
      const st = await getAssemblyState(qr);
      if (!st || !st.ok) {
        setErr(st?.reason === "no_bom" ? "เบอร์นี้ยังไม่ได้ตั้ง BOM — ตั้งที่หน้า Part Master ก่อน"
          : st?.reason === "not_found" ? "ไม่พบ QR นี้ในระบบ" : "โหลดสถานะไม่ได้ (" + (st?.reason || "error") + ")");
        setBusy(false); return;
      }
      const bom = st.bom || [];
      const installed = st.installed || [];
      const madeQty = Math.max(1, Math.floor(Number(st.made_qty) || 1));   // จำนวนที่ทำของเบอร์แม่ → แผน = BOM × จำนวนนี้
      const unitMap = await getUnitsByIds(installed.map((x) => x.child_unit_id));
      const byPm = {};
      installed.forEach((x) => {
        (byPm[x.child_pm_id] = byPm[x.child_pm_id] || []).push({
          unit_id: x.child_unit_id,
          qty: Math.max(1, Math.floor(Number(x.qty) || 1)),   // จำนวนที่ใส่จริง (นับจำนวนรวม)
          qr: unitMap[x.child_unit_id]?.qr_code || "—",
          part_no: unitMap[x.child_unit_id]?.part_no || "",
        });
      });
      const sumQty = (arr) => arr.reduce((s, u) => s + (Number(u.qty) || 1), 0);
      const rows = bom.map((b) => {
        const sc = byPm[b.child_pm_id] || [];
        const used = sumQty(sc);                       // ใช้ไปจริง (รวมจำนวน)
        const need = (Number(b.qty) || 0) * madeQty;   // แผน = ต่อชุด × จำนวนที่ทำ
        // เกิน (over) = ใช้มากกว่าแผน · ครบ = เท่ากับแผนเป๊ะ · ขาด = partial · ยังไม่สแกน = missing
        const status = used > need ? "over" : used === need ? "complete" : used > 0 ? "partial" : "missing";
        return { part_no: b.part_no, part_name: b.part_name, planned: need, scanned: used, units: sc, status };
      });
      const bomSet = new Set(bom.map((b) => b.child_pm_id));
      const extra = [];
      Object.keys(byPm).forEach((pm) => { if (!bomSet.has(pm)) extra.push(...byPm[pm]); });
      const hasOver = rows.some((r) => r.status === "over");
      const complete = rows.length > 0 && rows.every((r) => r.status === "complete");
      setResult({
        parentNo: meta?.part_no || st.parent?.part_no || qr,
        parentName: meta?.part_name || "",
        finished: st.parent?.status === "finished",
        madeQty,
        rows, extra, complete, hasOver, ok: complete && extra.length === 0 && !hasOver,
        plannedTotal: bom.reduce((s, b) => s + (Number(b.qty) || 0) * madeQty, 0), scannedTotal: sumQty(installed),
      });
    } catch (e) { setErr("ผิดพลาด: " + (e?.message || e)); }
    setBusy(false);
  }

  // เปิดมาจากรายงานประกอบ/แพ็ก (กดเบอร์แม่) → โหลดเบอร์นั้นให้อัตโนมัติ
  useEffect(() => {
    if (initialQr) { load(initialQr); onConsumeInitial && onConsumeInitial(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQr]);

  const doing = (s) => /progress/i.test(s || "");

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">ตรวจงานประกอบ / แพ็ก</div>
          <div className="page-sub">เทียบ "ที่สั่งจาก release (แผน)" กับ "ที่หน้างานสแกนมาจริง" — ดูว่าทำถูก + ครบไหม · เลือกเบอร์จากรายการ หรือสแกน/พิมพ์ QR (ดูของที่เสร็จแล้วได้)</div>
        </div>
      </div>

      <Card title="เลือกเบอร์แม่ / เบอร์แพ็ก">
        {/* กรองแบบเดียวกับหน้าพิมพ์ QR: เลือกโปรเจค → Part · หรือสแกน/พิมพ์ QR ตรง ๆ */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, alignItems: "end" }}>
          <Field label="โปรเจค">
            <Select value={projSel} onChange={(e) => { setProjSel(e.target.value); setPartSel(""); }} options={projOptions} />
          </Field>
          <Field label="เบอร์ (Part)">
            <Select value={partSel} onChange={(e) => setPartSel(e.target.value)} options={partOptions} />
          </Field>
          <Field label="หรือสแกน / พิมพ์ QR ตรงๆ (เสร็จแล้วก็ดูได้)">
            <form onSubmit={(e) => { e.preventDefault(); const s = manualQr.trim(); if (s) load(s, null); }} style={{ display: "flex", gap: 8 }}>
              <Input value={manualQr} onChange={(e) => setManualQr(e.target.value)} placeholder="เช่น UA3011B / QR" style={{ flex: 1 }} />
              <Btn type="submit" variant="accent">โหลด</Btn>
            </form>
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเพิ่ม (เบอร์ / โปรเจค / QR)" style={{ flex: "1 1 240px" }} />
          {(projSel || partSel || q) && <Btn variant="ghost" onClick={() => { setProjSel(""); setPartSel(""); setQ(""); }}>× ล้างตัวกรอง</Btn>}
          {(projSel || partSel || q.trim()) && <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{filtered.length.toLocaleString()} รายการ</span>}
        </div>
        <div style={{ maxHeight: 300, overflow: "auto", marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {!(projSel || partSel || q.trim()) ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 20, textAlign: "center", lineHeight: 1.8 }}>
              เลือก <b>โปรเจค / Part</b> หรือพิมพ์ค้นหาด้านบน เพื่อดูรายการ<br />
              <span style={{ fontSize: 12 }}>· หรือสแกน / พิมพ์ QR ตรง ๆ (ดูเบอร์ที่เสร็จแล้วก็ได้)</span>
            </div>
          ) : filtered.slice(0, 300).map((p) => (
            <div key={p.id} onClick={() => load(p.qr_code, p)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: sel && sel.id === p.id ? "var(--surface-2, #eef4f1)" : "var(--surface, #fff)", cursor: "pointer" }}>
              <b style={{ fontFamily: "var(--font-mono)", fontSize: 15, flexShrink: 0 }}>{p.part_no}</b>
              <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)", flexShrink: 0 }}>{p.qr_code}</span>
              <span style={{ color: "var(--muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.part_name}{p.project_code ? ` · ${p.project_code}` : ""}</span>
              <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: doing(p.status) ? "rgba(217,164,65,.15)" : "rgba(120,140,190,.12)", color: doing(p.status) ? "#b45309" : "var(--muted)" }}>{doing(p.status) ? "กำลังทำ" : "ยังไม่เริ่ม"}</span>
              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: ".03em", color: "var(--muted)" }}>{p.kind === "package" ? "แพ็ก" : p.kind === "panel" ? "แผง" : "ซับ"}</span>
            </div>
          ))}
          {(projSel || partSel || q.trim()) && filtered.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 14, textAlign: "center" }}>ไม่พบในรายการที่กำลังทำ — ถ้าเบอร์เสร็จแล้ว ให้สแกน/พิมพ์ QR ในช่องด้านบน</div>}
        </div>
      </Card>

      {busy && <Card><div style={{ color: "var(--muted)", padding: 8 }}>กำลังโหลด…</div></Card>}
      {err && !busy && <Card><div style={{ color: "var(--danger-hi)", fontSize: 13, padding: 8, lineHeight: 1.6 }}>{err}</div></Card>}

      {result && !busy && (
        <Card title={`ผลเทียบ — ${result.parentNo}${result.parentName ? "  ·  " + result.parentName : ""}${result.finished ? "  (เสร็จแล้ว)" : ""}`}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 14px", borderRadius: 10, marginBottom: 14, fontWeight: 700,
            ...(result.ok ? { background: "rgba(16,185,129,.12)", color: "var(--accent-dk, #0e9d63)", border: "1px solid rgba(16,185,129,.35)" }
              : (result.extra.length || result.hasOver) ? { background: "rgba(220,38,38,.10)", color: "var(--danger-hi, #c0362c)", border: "1px solid rgba(220,38,38,.3)" }
                : { background: "rgba(217,164,65,.14)", color: "#b45309", border: "1px solid rgba(217,164,65,.4)" }),
          }}>
            <span style={{ fontSize: 16 }}>{result.ok ? "✓ ทำถูกและครบตามแผน" : result.extra.length ? "⚠ มีชิ้นที่ไม่อยู่ในแผน (อาจใส่ผิด/เกิน)" : result.hasOver ? "⚠ มีชิ้นเกินจำนวนที่แผนกำหนด" : "◐ ยังไม่ครบตามแผน"}</span>
            {result.madeQty > 1 ? <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 700, opacity: .9 }}>ทำเบอร์แม่ {result.madeQty} ตัว · แผน = ต่อชุด×{result.madeQty}</span> : null}
            <span style={{ marginLeft: result.madeQty > 1 ? 0 : "auto", fontFamily: "var(--font-mono)", fontWeight: 800 }}>สแกนแล้ว {result.scannedTotal}/{result.plannedTotal} ชิ้น</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ minWidth: 640 }}>
              <thead><tr>
                <th>เบอร์ชิ้น (แผน)</th><th>รายละเอียด</th>
                <th style={{ textAlign: "center", width: 80 }}>ต้องใช้</th><th style={{ textAlign: "center", width: 90 }}>สแกนแล้ว</th>
                <th style={{ width: 120 }}>สถานะ</th><th>QR/ชิ้นที่สแกนมา</th>
              </tr></thead>
              <tbody>
                {result.rows.map((r, i) => {
                  const c = verifyStatusColor(r.status);
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }}>{r.part_no}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12.5 }}>{r.part_name}</td>
                      <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.planned}</td>
                      <td style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{r.scanned}</td>
                      <td><span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, whiteSpace: "nowrap" }}>{r.status === "complete" ? "✓ ครบ" : r.status === "over" ? `เกิน +${r.scanned - r.planned}` : r.status === "partial" ? `ขาด ${r.planned - r.scanned}` : "✗ ยังไม่สแกน"}</span></td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{r.units.length ? r.units.map((u) => (Number(u.qty) > 1 ? `${u.qr} ×${u.qty}` : u.qr)).join(", ") : "—"}</td>
                    </tr>
                  );
                })}
                {result.rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>เบอร์นี้ไม่มี BOM (ไม่มีชิ้นที่ต้องประกอบ)</td></tr>}
              </tbody>
            </table>
          </div>

          {result.extra.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, color: "var(--danger-hi)", marginBottom: 6 }}>⚠ ชิ้นที่สแกนมาแต่ไม่อยู่ในแผน ({result.extra.length}) — ตรวจว่าใส่ผิดเบอร์ไหม</div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ minWidth: 360 }}>
                  <thead><tr><th>เบอร์ชิ้น</th><th>QR</th></tr></thead>
                  <tbody>{result.extra.map((u, i) => <tr key={i}><td style={{ fontFamily: "var(--font-mono)" }}>{u.part_no || "?"}</td><td style={{ fontFamily: "var(--font-mono)" }}>{u.qr}{Number(u.qty) > 1 ? ` ×${u.qty}` : ""}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// จัดกลุ่ม release หลายแถวที่มาจากไฟล์ Excel เดียวกัน (release_order เดียวกัน) ให้เป็น
// "การปล่อยงาน 1 ครั้ง" 1 แถวในตารางสรุป — ส่วน release เดี่ยวที่ไม่มี release_order
// (ปล่อยทีละ Part ตามปกติ) ก็ยังคงแยกเป็นคนละแถวเหมือนเดิม
function groupReleases(list) {
  const map = new Map();
  for (const r of list) {
    // จับกลุ่มด้วย (โปรเจค + Release Order) — release_order ไม่ unique และคนละโปรเจค
    // อาจใช้เลขซ้ำกันได้ (มาจากคนละไฟล์ Excel) จึงต้องแยกตามโปรเจคด้วย ไม่งั้นยอดรวมเพี้ยน
    const pid = r.part_master?.project_id || r.part_master?.projects?.code || "?";
    const key = r.release_order ? `RO:${pid}:${r.release_order}` : `S:${r.id}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        releaseOrder: r.release_order || null,
        projectCode: r.part_master?.projects?.code || "-",
        projectName: r.part_master?.projects?.name || "-",
        date: r.release_date,
        totalQty: 0,
        totalWeight: 0,
        notes: new Set(),
        releases: [],
      });
    }
    const g = map.get(key);
    g.totalQty += r.qty || 0;
    g.totalWeight += (r.qty || 0) * (r.unit_weight || 0);
    if (r.note) g.notes.add(r.note);
    if (new Date(r.release_date) < new Date(g.date)) g.date = r.release_date;
    g.releases.push(r);
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ── ตัวช่วยกลาง: คำนวณ "จำนวนเสร็จ" ของ Release / กลุ่ม Release ให้ทุกหน้าตรงกัน ──────────
//   ★ กติกา (ผู้ใช้กำหนด 2026-09-23): Part ไม่ได้ตั้ง Routing แล้ว — "รูท" ของชิ้น = ขั้นตอนที่เครื่องที่สแกนเข้ามาติ๊กไว้
//     สะสมไปเรื่อย ๆ จนกว่าหน้าเครื่องจะกด Finished → กด Finished = เสร็จ (ไม่ว่าจะผ่านกี่ขั้นตอน/กี่เครื่อง)
//   ใช้เหมือนกันทั้ง Projects · รายการ Release · รายละเอียด Release · ป็อปอัปความคืบหน้า · Report
//   เสร็จ = max( สแกนสำนักงานแบบเดิม (part_units.status), ชิ้นที่หน้าเครื่องกด Finished ) ไม่เกินจำนวนสั่ง (เกิน = สแปร์)
//   ต่อชิ้น/QR นับ max(จำนวน) กันนับซ้ำ (co-tick 0 · สแกนซ้ำ · หลายเครื่องกด Finished ชิ้นเดียวกัน) — RPC release_finished_pieces
//   ยังไม่ได้รัน migration-finished-pieces.sql → ค่าประมาณจาก release_op_progress (ขั้นตอนที่มีชิ้นมากสุด)
async function fetchReleaseFinishedPieces(ids) {
  const { data, error } = await supabase.rpc("release_finished_pieces", { p_release_ids: ids });
  if (error) throw error;
  return data || {};
}
let _finRpcWarned = false;
// release_op_progress (ราย op — ใช้โชว์ชิปขั้นตอน) + release_finished_pieces (ราย release — ใช้นับเสร็จ)
//   ผลลัพธ์รูปเดิม { <release_id>: [ops] } + แนบ __fin (non-enumerable ไม่โผล่ใน Object.keys/entries)
async function getReleaseOpProgressFin(ids) {
  if (!ids || ids.length === 0) return {};
  const [op, fin] = await Promise.all([
    getReleaseOpProgress(ids),
    fetchReleaseFinishedPieces(ids).catch((e) => {
      if (!_finRpcWarned) { _finRpcWarned = true; console.warn("release_finished_pieces ยังไม่มีใน DB (รัน migration-finished-pieces.sql) — ใช้ค่าประมาณ", e); }
      return null;
    }),
  ]);
  const out = op || {};
  try { Object.defineProperty(out, "__fin", { value: fin, enumerable: false, configurable: true }); } catch { /* ignore */ }
  return out;
}
// ยอดหน้าเครื่องของ 1 release: fin = ชิ้นที่กด Finished · done = ชิ้นที่ถูกสแกน (ทุกสถานะ) · has = มีงานหน้าเครื่อง
function stationRelProg(opProg, rid) {
  const f = opProg && opProg.__fin ? opProg.__fin[rid] : undefined;
  if (f) return { fin: Number(f.finished) || 0, done: Math.max(Number(f.done) || 0, Number(f.finished) || 0), has: true };
  const ops = (opProg && opProg[rid]) || [];
  if (opProg && opProg.__fin && !ops.length) return { fin: 0, done: 0, has: false };
  if (!ops.length) return { fin: 0, done: 0, has: false };
  // ค่าประมาณ (ยังไม่มี RPC): ขั้นตอนที่มีชิ้นมากสุด — ต่อ op นับชิ้นที่ผ่าน op นั้น ด้วยจำนวนเสร็จของชิ้น (ข้ามขั้นตอน/เครื่อง)
  const fin = ops.reduce((m, o) => Math.max(m, Number(o.finished) || 0), 0);
  const done = ops.reduce((m, o) => Math.max(m, Number(o.done) || 0), 0);
  return { fin, done: Math.max(done, fin), has: done > 0 || fin > 0 };
}
// ความคืบหน้าของ 1 release (ใช้ทั้งแถวตาราง การ์ดรวม และป็อปอัป)
function relProgress(r, unitStats, opProg) {
  const office = (unitStats && unitStats[r.id]) || null;
  const total = Number(office?.total ?? r.qty) || 0;
  const st = stationRelProg(opProg, r.id);
  const officeFin = Number(office?.finished ?? 0) || 0;
  const raw = Math.max(officeFin, st.fin);
  const finished = total > 0 ? Math.min(raw, total) : raw;   // เพดานที่จำนวนสั่ง (ใช้คิด % + กำลังทำ)
  const over = total > 0 ? Math.max(0, raw - total) : 0;     // เกินจำนวนสั่ง = สแปร์
  // "กำลังทำ" = สแกนแล้วแต่ยังไม่กด Finished (งานหน้าเครื่องเป็นหลักถ้ามี)
  const inProgRaw = st.has ? Math.max(0, st.done - st.fin) : (Number(office?.inProgress ?? 0) || 0);
  const inProgress = total > 0 ? Math.min(inProgRaw, Math.max(0, total - finished)) : inProgRaw;
  return { finished, total, inProgress, over, done: raw, stationFin: st.fin, stationDone: st.done, officeFin, hasStation: st.has };
}
function computeGroupProgress(releases, unitStats, opProg, totalQty) {
  // ชิปขั้นตอน (รูทที่เครื่องติ๊กไว้) — รวมทุก release ในกลุ่ม เรียงตาม seq
  const by = new Map();
  for (const r of releases) {
    for (const o of (opProg?.[r.id] || [])) {
      const k = o.op || "ไม่ระบุ";
      const e = by.get(k) || { op: k, seq: o.seq ?? 999, done: 0, finished: 0 };
      e.done += Number(o.done) || 0; e.finished += Number(o.finished) || 0;
      by.set(k, e);
    }
  }
  const opAgg = Array.from(by.values()).sort((a, b) => (a.seq - b.seq) || a.op.localeCompare(b.op));
  const aggWithDone = opAgg.filter((o) => (Number(o.done) || 0) > 0);
  const lastOp = aggWithDone.length ? aggWithDone[aggWithDone.length - 1] : (opAgg.length ? opAgg[opAgg.length - 1] : null);   // ใช้แสดงผลเท่านั้น (ไม่ใช้นับเสร็จแล้ว)
  let finished = 0, inProgress = 0, officeFinished = 0, stationFinished = 0, stationDone = 0, anyStation = false;
  for (const r of releases) {
    const p = relProgress(r, unitStats, opProg);
    finished += p.finished; inProgress += p.inProgress;
    officeFinished += p.officeFin; stationFinished += p.stationFin; stationDone += p.stationDone;
    if (p.hasStation) anyStation = true;
  }
  if (totalQty > 0) finished = Math.min(finished, totalQty);
  // งานหน้าเครื่องเป็น "ตัวหลัก" เมื่อยอดหน้าเครื่อง ≥ ยอดสำนักงาน และมากกว่า 0
  const stationDrove = stationFinished > 0 && stationFinished >= officeFinished;
  return { finished, inProgress, officeFinished, stationFinished, stationDone, anyStation, opAgg, lastOp, stationDrove };
}

// ── Mini progress bar (inline, no extra deps) ───────────────────────────────
// ป้าย % อัจฉริยะ (ใช้ร่วมกันหลายที่): มีคืบหน้าจริงแต่ปัดแล้วเป็น 0% (เช่น 73/18,769 = 0.4%)
//   → โชว์ทศนิยม · ต่ำกว่า 0.1% → "<0.1%" · 1% ขึ้นไป → เลขเต็ม · ครบจริงเท่านั้นถึง 100%
function pctLabel(rawPct, complete) {
  if (complete) return "100%";
  if (!(Number(rawPct) > 0)) return "0%";
  if (rawPct < 1) return rawPct >= 0.1 ? (Math.round(rawPct * 10) / 10) + "%" : "<0.1%";
  return Math.min(99, Math.round(rawPct)) + "%";   // ยังไม่ครบ อย่าโชว์ 100%
}

function ProgressBar({ pct, finished, total }) {
  // "เสร็จจริง" = ชิ้นครบ (ไม่ใช่แค่ % ปัดขึ้นถึง 100) — กัน 199/200 = 99.5% ปัดเป็น 100% เขียว
  const hasFT = finished != null && total != null && Number(total) > 0;
  const rawPct = hasFT ? (Number(finished) / Number(total)) * 100 : (Number(pct) || 0);   // % จริง (ยังไม่ปัด)
  const complete = hasFT ? Number(finished) >= Number(total) : rawPct >= 100;
  let width = Math.min(100, Math.max(0, rawPct));
  if (!complete && width >= 100) width = 99;   // ยังไม่ครบ อย่าเพิ่งเต็มแถบ
  // ป้าย %: มีความคืบหน้าจริงแต่ปัดแล้วเป็น 0% (เช่น 71/18,769) → โชว์ทศนิยม/“<0.1%” กันเข้าใจผิดว่ายังไม่เริ่ม
  const label = pctLabel(rawPct, complete);
  const color = complete ? "var(--success)" : width > 0 ? "var(--accent-dk)" : "var(--border)";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: "0 0 90px", width: 90, height: 7, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden", border: "1px solid var(--border)" }}>
        <div style={{ width: `${width}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, whiteSpace: "nowrap", minWidth: 44, textAlign: "right" }}>
        {label}
      </span>
      <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
        ({finished}/{total})
      </span>
    </div>
  );
}

// ── รายละเอียดความคืบหน้าของ Part เดียว (แยกตามขั้นตอน) ─────────────────────
// กดจากแถว Part ในหน้ารายละเอียด Release — แสดงว่าเบอร์นี้ ตัดไปกี่ชิ้น เหลือเจาะ
// เหลือบาก ฯลฯ โดยนับ "จำนวนชิ้น (distinct) ที่ผ่านแต่ละขั้นตอน" จาก scan_logs จริง
function PartProgressModal({ release, user, goTo, onClose }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [opProg, setOpProg] = useState([]);   // [{op, seq, done, finished}] ความคืบหน้าแยกขั้นตอน (ใช้คิดยอดรวมบนสุด)
  const [machineProg, setMachineProg] = useState([]);   // [{code,name,done,finished,caps:[{name,seq,used}]}] แยกตามเครื่อง
  const [lang] = useLang();
  const [finished, setFinished] = useState(0);
  const [over, setOver] = useState(0);   // เสร็จเกินจำนวนสั่ง = สแปร์
  const [inProgress, setInProgress] = useState(0);
  const [totalUnits, setTotalUnits] = useState(release.qty || 0);

  const routing = release.part_master?.routing || [];
  const partNo = release.part_master?.part_no || "-";
  const partName = release.part_master?.part_name || "";

  // สไตล์การ์ดสรุป (ใช้ซ้ำหลายจุด)
  const cellStyle = { flex: 1, minWidth: 120, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" };
  const cellLbl = { fontSize: 11.5, color: "var(--muted)" };
  const cellVal = { fontSize: 16, fontWeight: 700 };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr("");
      try {
        // จำนวนชิ้น (รวม/เสร็จ/กำลังทำ) + ความคืบหน้าแยกขั้นตอนจากงานหน้าเครื่องจริง
        // ใช้แหล่งเดียวกับการ์ดรวมในหน้ารายละเอียด Release เพื่อให้ตัวเลขตรงกัน
        const [stats, prog, mprog] = await Promise.all([
          getUnitStatsByReleaseIds([release.id]),
          getReleaseOpProgressFin([release.id]),
          getReleaseMachineProgress(release.id),
        ]);
        if (!alive) return;
        setMachineProg(Array.isArray(mprog) ? mprog : []);
        const ops = Array.isArray(prog[release.id]) ? prog[release.id] : [];
        // ── นิยาม "เสร็จ / กำลังทำ" เดียวกับการ์ดรวมและตารางแต่ละ Part (relProgress) ──
        //    เสร็จ = ชิ้นที่หน้าเครื่องกด Finished (ตามรูทของเครื่อง) หรือสแกนสำนักงานแบบเดิม — ค่าที่มากกว่า
        const p = relProgress(release, stats, prog);
        const total = p.total;
        const fin = p.finished, overFin = p.over, inProg = p.inProgress;
        setTotalUnits(total || release.qty || 0);
        setFinished(fin);
        setOver(overFin);
        setInProgress(inProg);
        setOpProg(ops);
        setLoading(false);
      } catch (e) {
        if (alive) { setErr("โหลดข้อมูลไม่สำเร็จ: " + e.message); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [release]);

  const notStarted = Math.max(0, totalUnits - finished - inProgress);

  // ป้ายสถานะ (แยกกัน): เสร็จ = เขียว · กำลังทำ = ฟ้า · ค่า 0 = จาง — ใช้ซ้ำทั้งราย "เครื่อง" และราย "ขั้นตอน"
  const pillBase = { fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99, whiteSpace: "nowrap" };
  const finStyle = (n) => n > 0
    ? { ...pillBase, color: "var(--success)", background: "rgba(16,157,99,.12)", border: "1px solid var(--success)" }
    : { ...pillBase, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)" };
  const inStyle = (n) => n > 0
    ? { ...pillBase, color: "var(--accent-dk)", background: "rgba(37,99,235,.10)", border: "1px solid var(--accent-dk)" }
    : { ...pillBase, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)" };

  return (
    <Modal
      title={`ความคืบหน้า — ${partNo}`}
      sub={`${partName}${partName ? " · " : ""}ทั้งหมด ${fmtNum(totalUnits)} ชิ้น`}
      onClose={onClose}
    >
      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "12px 2px" }}>กำลังโหลด...</div>
      ) : err ? (
        <div style={{ color: "var(--danger-hi)", fontSize: 13 }}>{err}</div>
      ) : (
        <>
          {/* ── น้ำหนัก / ความยาว ของ Part นี้ ───────────────────────────── */}
          {(() => {
            const uw = release.unit_weight ?? release.part_master?.unit_weight;
            const len = release.length_mm ?? release.part_master?.default_length_mm;
            return (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <div style={cellStyle}>
                  <div style={cellLbl}>น้ำหนัก/ชิ้น</div>
                  <div style={cellVal}>{uw != null ? `${fmtNum(uw)} กก.` : "-"}</div>
                </div>
                <div style={cellStyle}>
                  <div style={cellLbl}>ความยาว/ชิ้น</div>
                  <div style={cellVal}>{len != null ? `${fmtNum(len)} มม.` : "-"}</div>
                </div>
                <div style={cellStyle}>
                  <div style={cellLbl}>น้ำหนักรวม</div>
                  <div style={cellVal}>{uw != null ? `${fmtNum(totalUnits * uw)} กก.` : "-"}</div>
                </div>
              </div>
            );
          })()}

          {/* ── สรุปจำนวนชิ้น: ทั้งหมด / เสร็จ / กำลังทำ / ยังไม่เริ่ม ───────── */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <div style={cellStyle}>
              <div style={cellLbl}>จำนวนทั้งหมด</div>
              <div style={cellVal}>{fmtNum(totalUnits)} ชิ้น</div>
            </div>
            <div style={cellStyle}>
              <div style={cellLbl}>เสร็จแล้ว</div>
              <div style={{ ...cellVal, color: (finished + over) > 0 ? "var(--success)" : "var(--muted)" }}>{fmtNum(finished + over)} ชิ้น</div>
              {over > 0 && (
                <div style={{ fontSize: 11, color: "var(--warning, #d97a00)", fontWeight: 700, marginTop: 2, whiteSpace: "nowrap" }}
                  title={lang === "en" ? "Over ordered qty (spare)" : "เกินจำนวนสั่ง (สแปร์)"}>
                  +{fmtNum(over)} {lang === "en" ? "spare" : "เกิน (สแปร์)"}
                </div>
              )}
            </div>
            <div style={cellStyle}>
              <div style={cellLbl}>กำลังทำ</div>
              <div style={{ ...cellVal, color: inProgress > 0 ? "var(--accent-dk)" : "var(--text)" }}>{fmtNum(inProgress)} ชิ้น</div>
            </div>
            <div style={cellStyle}>
              <div style={cellLbl}>ยังไม่เริ่ม</div>
              <div style={{ ...cellVal, color: "var(--muted)" }}>{fmtNum(notStarted)} ชิ้น</div>
            </div>
          </div>

          {/* ── ทำจากเครื่องไหนบ้าง (แยกตามเครื่องจักร) ─────────────────────── */}
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>
            {lang === "en" ? "Work by machine" : "งานแยกตามเครื่องจักร"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
            {lang === "en"
              ? <>Which machine made this part, doing which step — <b>Done</b> = all statuses · <b>finished</b> = pressed Finished · vs order {fmtNum(totalUnits)} pcs</>
              : <>พาร์ทนี้ทำจากเครื่องไหน ขั้นตอนไหนบ้าง — <b>ทำแล้ว</b> = ทุกสถานะ · <b>เสร็จ</b> = กด Finished · เทียบกับจำนวนสั่ง {fmtNum(totalUnits)} ชิ้น</>}
          </div>
          {machineProg.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "2px 2px 6px", lineHeight: 1.6 }}>
              {lang === "en" ? "No machine records yet for this part." : "ยังไม่มีการบันทึกงานหน้าเครื่องสำหรับ Part นี้"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {machineProg.map((m) => {
                const caps = Array.isArray(m.caps) ? m.caps : [];
                // ยอดรวมของเครื่อง (ตรงกับการ์ดสรุปด้านบน) — เสร็จ/กำลังทำ/ทำแล้ว
                const done = Number(m.done) || 0;
                const fin = Number(m.finished) || 0;
                const inp = Math.max(0, done - fin);
                const pct = totalUnits > 0 ? Math.round((done / totalUnits) * 100) : 0;
                const over = done > totalUnits;
                return (
                  <div key={m.machine_id || m.code} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", background: "var(--surface-2)" }}>
                    {/* หัว: รหัสเครื่อง (ซ้าย) + สถานะ เสร็จ/กำลังทำ (มุมขวาบน) */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 9 }}>
                      <span style={{ fontWeight: 800, fontSize: 15, fontFamily: "var(--font-mono, ui-monospace, monospace)", letterSpacing: ".02em", whiteSpace: "nowrap" }}>{m.code || "—"}</span>
                      {/* สถานะเดียวต่อเครื่อง — โชว์เฉพาะที่มีจริง (ซ่อนอันที่เป็น 0) */}
                      <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        {fin > 0 ? <span style={finStyle(fin)}>{lang === "en" ? "finished" : "เสร็จ"} {fmtNum(fin)}</span> : null}
                        {inp > 0 ? <span style={inStyle(inp)}>{lang === "en" ? "in process" : "กำลังทำ"} {fmtNum(inp)}</span> : null}
                        {fin === 0 && inp === 0 ? <span style={inStyle(0)}>{lang === "en" ? "in process" : "กำลังทำ"} 0</span> : null}
                      </span>
                    </div>
                    {/* ชิปความสามารถ (แสดงทุกขั้นตอนที่ตั้งไว้) */}
                    {caps.length ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 9 }}>
                        {caps.map((c, ci) => (
                          <span key={ci} style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
                            color: "#2563eb", background: "rgba(37,99,235,.10)", border: "1px solid rgba(37,99,235,.40)",
                          }}>{opLabel(c.name, lang)}</span>
                        ))}
                      </div>
                    ) : null}
                    {/* ทำแล้วรวม + แถบความคืบหน้า */}
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                      {lang === "en" ? "Done" : "ทำแล้ว"} {fmtNum(done)} / {fmtNum(totalUnits)} {lang === "en" ? "pcs" : "ชิ้น"}
                      {over ? <span style={{ color: "var(--warning)" }}> · {lang === "en" ? "over (spare)" : "เกิน (สแปร์)"}</span> : null}
                    </div>
                    <ProgressBar pct={Math.min(pct, 100)} finished={done} total={totalUnits} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="modal-actions" style={{ justifyContent: "space-between" }}>
        {goTo
          ? <Btn type="button" variant="ghost" onClick={() => { goTo("labels", { releaseId: release.id }); onClose(); }} style={{ color: "var(--accent-dk)" }}><Icon name="printer" size={14} /> {lang === "en" ? "Print QR" : "พิมพ์ QR"}</Btn>
          : <span />}
        <Btn type="button" variant="ghost" onClick={onClose}>ปิด</Btn>
      </div>
    </Modal>
  );
}

// ─── Release Modify (M-01, M-02 …) — แก้รายการใน Release Order แบบเก็บของเดิมเป็นหลักฐาน ───────────
//   แต่ละ Part เลือกการแก้ไขของตัวเองอิสระ · ทั้งหมดบันทึกรวมเป็น M เดียว (migration-release-modify.sql)
const MOD_ACTS = [
  ["qty+", "เพิ่มจำนวน (+)"], ["qty-", "ลดจำนวน (−)"], ["inv", "แก้ INV Code"],
  ["cancel", "ยกเลิก Part"], ["transfer", "Transfer เป็นเบอร์อื่น"],
];
const MOD_TL = { qty: "แก้จำนวน", inv: "แก้ INV Code", cancel: "ยกเลิก Part", transfer: "Transfer" };
const MOD_TL_EN = { qty: "Qty", inv: "INV Code", cancel: "Cancel part", transfer: "Transfer" };
const MOD_ACTS_EN = { "qty+": "Add qty (+)", "qty-": "Reduce qty (−)", inv: "Change INV Code", cancel: "Cancel part", transfer: "Transfer to other part" };
const modTL = (type, lang) => (lang === "en" ? MOD_TL_EN[type] : MOD_TL[type]) || type;
const modActLabel = (v, t, lang) => (lang === "en" ? MOD_ACTS_EN[v] || t : t);
// ── เลข M 3 หลัก: ข้อมูลเก่า "M-01" → แสดง "M-001" (กันกรณียังไม่ได้รัน SQL แปลง / บันทึกงานเก่าหน้าเครื่อง) ──
const M0 = "M-000";
function fmtM(v) { const s = String(v ?? ""); const m = s.match(/^M-(\d+)$/); return m ? "M-" + String(Number(m[1])).padStart(3, "0") : s; }
function fmtMText(t) { return t == null ? t : String(t).replace(/(^|[^A-Za-z0-9])M-(\d{2})(?!\d)/g, "$1M-0$2"); }
function normModInfo(d) {
  if (!d || !d.ok) return d;
  return {
    ...d,
    current: d.current ? fmtM(d.current) : d.current,
    origin: d.origin ? { ...d.origin, version: M0 } : d.origin,
    mods: (d.mods || []).map((m) => ({
      ...m, version: fmtM(m.version),
      reverted: m.reverted ? { ...m.reverted, target_version: m.reverted.target_version ? fmtM(m.reverted.target_version) : m.reverted.target_version } : m.reverted,
      items: (m.items || []).map((it) => ({ ...it, note: fmtMText(it.note) })),
    })),
  };
}
// ข้อความที่ DB เขียนไว้ (ภาษาไทย รูปแบบตายตัว) → อังกฤษ ตอนเลือกภาษา EN
function modNoteText(note, lang) {
  note = fmtMText(note);
  if (!note || lang !== "en") return note;
  return String(note)
    .replace(/(M-\d+) ถูกยกเลิก/g, "$1 cancelled")                       // ★ ยกเลิก M / ย้อนกลับ
    .replace(/คืนจำนวน/g, "Qty restored")
    .replace(/ยกเลิก QR ที่เพิ่ม (\d+) ใบ/g, "cancelled $1 added QR")
    .replace(/คืน QR (\d+) ใบ/g, "$1 QR restored")
    .replace(/\(คืนค่าเดิม\)/g, "(restored)")
    .replace(/เปิด Part กลับมา/g, "Part reopened")
    .replace(/ย้ายกลับ (\d+) ชิ้น จาก/g, "moved back $1 pcs from")
    .replace(/ย้าย (\d+) ชิ้นกลับไป/g, "moved $1 pcs back to")
    .replace(/· จำนวน (\d+)/g, "· qty $1")
    .replace(/QR ใหม่ (\d+) ใบ/g, "$1 new QR")
    .replace(/ยกเลิก QR ที่ยังไม่ใช้ (\d+) ใบ/g, "cancelled $1 unused QR")
    .replace(/ยกเลิก QR (\d+) ใบ/g, "cancelled $1 QR")
    .replace(/ทำแล้ว (\d+) ชิ้น → สแปร์/g, "$1 made → spare")
    .replace(/ทำแล้ว (\d+) ชิ้น → scrap/g, "$1 made → scrap")
    .replace(/รับย้าย (\d+) ชิ้นจาก/g, "received $1 pcs from")
    .replace(/ย้ายจาก/g, "moved from")
    .replace(/ย้าย (\d+) ชิ้น →/g, "moved $1 pcs →")
    .replace(/\(QR เดิม\)/g, "(same QR)")
    .replace(/เพิ่มจำนวน/g, "Qty increased").replace(/ลดจำนวน/g, "Qty reduced").replace(/ยกเลิก Part/g, "Part cancelled");
}
const MOD_TONE = {
  qty: { c: "#2563eb", bg: "rgba(37,99,235,.11)" }, inv: { c: "#c2410c", bg: "rgba(245,158,11,.14)" },
  cancel: { c: "#dc2626", bg: "rgba(239,68,68,.11)" }, transfer: { c: "#6d4aff", bg: "rgba(109,74,255,.12)" },
};
const MOD_PURPLE = "#6d4aff";
const modVer = (n) => "M-" + String(n).padStart(3, "0");   // ★ 3 หลัก: M-000 (ต้นฉบับ) · M-001 · M-002 …
// ── วันที่ของ M (ตามเอกสาร) แยกจากเวลาที่ลงแอป ──
const fmtYmd = (s) => (s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("th-TH", { dateStyle: "short" }) : "-");   // ไม่เลื่อนวันตามโซนเวลา
const ymdOf = (iso) => { if (!iso) return ""; const d = new Date(iso); if (!Number.isFinite(d.getTime())) return ""; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const todayYmd = () => ymdOf(new Date().toISOString());
const modDocDate = (m) => (m && (m.doc_date || ymdOf(m.created_at))) || "";        // M เก่า (ก่อนมีช่องวันที่) = วันที่ลงแอป
const revDocDate = (rv) => (rv && (rv.doc_date || ymdOf(rv.at))) || "";
const modTypeOf = (k) => (k === "qty+" || k === "qty-") ? "qty" : (k || "");
function ModChip({ type }) {
  const [lang] = useLang();
  const t = MOD_TONE[type] || { c: "var(--muted)", bg: "var(--surface-2)" };
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 99, color: t.c, background: t.bg, marginRight: 4, whiteSpace: "nowrap" }}>{modTL(type, lang)}</span>;
}
function ModVerPill({ v, gray, onClick, title }) {
  return (
    <span onClick={onClick} title={title}
      style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 7, whiteSpace: "nowrap",
        background: gray ? "var(--muted-2)" : MOD_PURPLE, color: "#fff", cursor: onClick ? "pointer" : "default", flexShrink: 0 }}>{fmtM(v)}</span>
  );
}
// ข้อความผิดพลาดจากเซิร์ฟเวอร์ → ภาษาคน
function modErrText(res, lang = "th") {
  const E = (th, en) => (lang === "en" ? en : th);
  const d = String(res?.detail || "");
  const [, a, b] = d.split(":");
  switch (res?.reason) {
    case "not_installed": return E("ยังไม่ได้ติดตั้งฐานข้อมูลส่วน Modify — รัน migration-release-modify.sql ใน Supabase ก่อน", "Modify isn't installed yet — run migration-release-modify.sql in Supabase first");
    case "forbidden": return E("เฉพาะแอดมินเท่านั้นที่ Modify ได้", "Only admins can Modify");
    case "unauthorized": return E("เซสชันหมดอายุ — เข้าสู่ระบบใหม่", "Session expired — please sign in again");
    case "no_reason": return E("ใส่เหตุผลก่อนบันทึก", "Enter a reason before saving");
    case "no_items": return E("ยังไม่มีรายการแก้ไข", "No changes yet");
    case "project_closed": return E("โปรเจคนี้ปิดแล้ว — เปิดโปรเจคก่อนถึงแก้ได้", "This project is closed — reopen it first");
    case "version_used": return E(`เลข ${modVer(a)} มีอยู่แล้ว — ใช้เลขอื่น`, `${modVer(a)} already exists — use another number`);
    case "bad_version": return E("เลข M ไม่ถูกต้อง", "Invalid M number");
    case "below_produced": return E(`${a}: ลดต่ำกว่าจำนวนที่ทำไปแล้ว (${b} ชิ้น) ไม่ได้`, `${a}: can't go below the ${b} pcs already made`);
    case "use_cancel": return E(`${a}: ลดจนเหลือ 0 ไม่ได้ — ใช้ “ยกเลิก Part” แทน`, `${a}: can't reduce to 0 — use “Cancel part” instead`);
    case "not_enough_free": return E(`${a}: QR ที่ยังไม่ถูกใช้มีแค่ ${b} ใบ (ใบที่สแกนแล้วยกเลิก/ย้ายไม่ได้)`, `${a}: only ${b} unused QR left (scanned QR can't be cancelled/moved)`);
    case "transfer_produced": return E(`${a}: ย้ายได้เฉพาะชิ้นที่ยังไม่ทำ (สูงสุด ${b} ชิ้น)`, `${a}: only unmade pieces can be moved (max ${b})`);
    case "release_cancelled": return E(`${a}: Part นี้ถูกยกเลิกไปแล้ว`, `${a}: this part is already cancelled`);
    case "target_cancelled": return E(`${a}: เบอร์ปลายทางถูกยกเลิกไปแล้ว`, `${a}: the target part is cancelled`);
    case "same_target": return E(`${a}: ปลายทางต้องต่างจากเบอร์เดิม`, `${a}: target must differ from the current part`);
    case "same_inv": return E(`${a}: INV ใหม่ต้องต่างจากเดิม`, `${a}: new INV must differ from the current one`);
    case "check_violation": return E("ฐานข้อมูลไม่รับค่านี้ (เช่น จำนวน 0) — ", "The database rejected this value (e.g. qty 0) — ") + d;
    // ── วันที่ของ M / วันที่ยกเลิก ──
    case "future_date": return E("วันที่ต้องไม่เกินวันนี้", "The date can't be in the future");
    case "bad_date": return E("วันที่ไม่ถูกต้อง", "Invalid date");
    case "same_date": return E("เป็นวันที่นี้อยู่แล้ว", "It already has this date");
    case "not_reverted": return E("M นี้ยังไม่ถูกยกเลิก", "This M isn't cancelled");
    case "date_not_installed": return E("ยังไม่ได้รัน migration-release-modify-revert.sql เวอร์ชันล่าสุด (มีวันที่ของ M) ใน Supabase", "Run the latest migration-release-modify-revert.sql (with M dates) in Supabase first");
    // ── ยกเลิก M / ย้อนกลับ (migration-release-modify-revert.sql) ──
    case "revert_not_installed": return E("ยังไม่ได้ติดตั้งส่วน “ยกเลิก/ย้อน M” — รัน migration-release-modify-revert.sql ใน Supabase ก่อน", "Cancel/rollback isn't installed yet — run migration-release-modify-revert.sql in Supabase first");
    case "bad_mode": return E("คำสั่งไม่ถูกต้อง", "Invalid request");
    case "not_found": return E(`ไม่พบ ${a || "M นี้"}`, `${a || "This M"} not found`);
    case "already_reverted": return E(`${a} ถูกยกเลิกไปแล้ว`, `${a} is already cancelled`);
    case "target_reverted": return E(`${a} ถูกยกเลิกแล้ว — ย้อนกลับไปเวอร์ชันที่ถูกยกเลิกไม่ได้ เลือกเวอร์ชันอื่น`, `${a} is cancelled — you can't roll back to a cancelled version`);
    case "nothing_to_revert": return E(`ไม่มี M ที่ใหม่กว่า ${a} ให้ยกเลิก — ตอนนี้เป็น ${a} อยู่แล้ว`, `Nothing newer than ${a} to cancel — it's already ${a}`);
    case "revert_conflict": return E(`${a}: M ที่บันทึกหลังจากนี้ (${b}) แก้ Part เดียวกัน — ต้องยกเลิก ${b} ก่อน หรือใช้ “ย้อนกลับ” ทั้งช่วง`, `${a}: a later M (${b}) changed the same part — cancel ${b} first, or roll back the whole range`);
    case "revert_used": return E(`${a}: ชิ้นงาน ${b} ชิ้นที่มาจาก M นี้ถูกสแกน/ใช้ไปแล้ว — ยกเลิกไม่ได้ เพื่อไม่ให้งานที่ทำไปแล้วหาย (ถ้าจำเป็นให้ Modify ใหม่ เช่น ลดจำนวน)`, `${a}: ${b} piece(s) from this M were already scanned/used — can't cancel, so finished work isn't lost (make a new Modify instead, e.g. reduce qty)`);
    case "revert_inv_changed": return E(`${a}: INV ถูกแก้ต่อจากที่อื่นแล้ว (ตอนนี้ ${b}) — ยกเลิกไม่ได้`, `${a}: INV was changed elsewhere afterwards (now ${b}) — can't cancel`);
    case "revert_state_changed": return E(`${a}: Part นี้ถูกแก้หลัง M นี้แล้ว — ยกเลิกไม่ได้`, `${a}: this part changed after this M — can't cancel`);
    case "revert_missing": return E(`${a}: ไม่พบ Part/Release นี้แล้ว (อาจถูกลบ) — ยกเลิกไม่ได้`, `${a}: this part/release no longer exists — can't cancel`);
    case "revert_qr_missing": return E(`${a}: QR ${b} ใบไม่อยู่ในระบบแล้ว — ยกเลิกไม่ได้`, `${a}: ${b} QR no longer exist — can't cancel`);
    case "revert_qr_exists": return E(`${a}: QR ${b} มีอยู่แล้ว — คืนซ้ำไม่ได้`, `${a}: QR ${b} already exists`);
    case "revert_target_locked": return E(`${a}: Release ปลายทางมีงานผูกอยู่ — ย้ายกลับไม่ได้`, `${a}: the target release has linked work — can't move back`);
    default: return (res?.message || d || res?.reason || E("บันทึกไม่สำเร็จ", "Save failed"));
  }
}

function ReleaseModifyModal({ releases, projectId, releaseOrder, info, onClose, onSaved }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const limits = info?.limits || {};
  const usedNos = useMemo(() => new Set((info?.mods || []).map((m) => Number(m.version_no))), [info]);
  const autoNo = Number(info?.next_no) || 1;
  const [verRaw, setVerRaw] = useState(String(autoNo).padStart(3, "0"));
  const [docDate, setDocDate] = useState(todayYmd());   // ★ วันที่ของ M ตามเอกสาร (อาจไม่ใช่วันที่ลงแอป)
  const [q, setQ] = useState("");
  const [sel, setSel] = useState([]);          // release id ตามลำดับที่เลือก
  const [lines, setLines] = useState([]);      // { id, rid, key, n, inv, keep, tn, tro }
  const [qk, setQk] = useState("");
  const [qv, setQv] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const lidRef = useRef(0);
  const byId = useMemo(() => Object.fromEntries(releases.map((r) => [r.id, r])), [releases]);
  const pnOf = (rid) => byId[rid]?.part_master?.part_no || "-";
  const isCancelled = (r) => !!(r?.mod_cancelled_at || limits[r?.id]?.cancelled);

  // ── เลข M ──
  const verN = parseInt(verRaw, 10);
  const verBlank = !String(verRaw).trim();
  const verErr = verBlank ? "" : !(verN >= 1) ? L("ใส่เลข M มากกว่า 0", "Enter an M number above 0") : usedNos.has(verN) ? L(`${modVer(verN)} มีอยู่แล้ว — ใช้เลขอื่น`, `${modVer(verN)} already exists — use another`) : "";
  const chosenNo = verBlank || !(verN >= 1) ? autoNo : verN;
  const chosen = modVer(chosenNo);
  const verInfo = verErr ? "" : chosenNo > autoNo ? L(`ข้ามเลข (ปกติคือ ${modVer(autoNo)})`, `skipping (next would be ${modVer(autoNo)})`) : chosenNo < autoNo ? L("แทรกก่อน M ล่าสุด — จะเรียงตามเลข", "inserted before the latest M — sorted by number") : L("อัตโนมัติ (เรียงต่อกัน)", "auto (next in sequence)");

  // ── จำลองผลตามลำดับ (กติกาเดียวกับฝั่ง DB) ──
  const freshState = () => {
    const st = {};
    releases.forEach((r) => {
      const Lm = limits[r.id] || {};
      st[r.id] = { qty: Number(r.qty) || 0, produced: Number(Lm.produced) || 0,
        free: Lm.free_qr != null ? Number(Lm.free_qr) : (Number(r.qty) || 0),
        inv: r.part_master?.material || "", cancelled: isCancelled(r) };
    });
    return st;
  };
  const num = (l) => parseInt(l.n, 10) || 0;
  const troOf = (l) => normalizeReleaseOrder(l.tro || "") || releaseOrder;
  function lineState(l, b) {
    const n = num(l);
    const pn = pnOf(l.rid);
    if (!l.key) return { inc: L("เลือกการแก้ไข", "choose a change") };
    if (b.cancelled) return { err: L("Part นี้ถูกยกเลิกแล้ว", "this part is cancelled") };
    if (l.key === "qty+") { if (n <= 0) return { inc: L("ใส่จำนวน", "enter qty") }; return { ok: L(`→ ใหม่ ${fmtNum(b.qty + n)} ชิ้น`, `→ new ${fmtNum(b.qty + n)} pcs`) }; }
    if (l.key === "qty-") {
      if (n <= 0) return { inc: L("ใส่จำนวน", "enter qty") };
      if (b.qty - n < 1) return { err: L("ลดจนเหลือ 0 ไม่ได้ — ใช้ “ยกเลิก Part”", "can't reduce to 0 — use “Cancel part”") };
      if (b.qty - n < b.produced) return { err: L(`ทำไปแล้ว ${fmtNum(b.produced)} ชิ้น — ลดได้ถึง ${fmtNum(b.produced)}`, `${fmtNum(b.produced)} pcs already made — min ${fmtNum(b.produced)}`) };
      if (n > b.free) return { err: L(`QR ที่ยังไม่ใช้มี ${fmtNum(b.free)} ใบ`, `only ${fmtNum(b.free)} unused QR`) };
      return { ok: L(`→ ใหม่ ${fmtNum(b.qty - n)} ชิ้น`, `→ new ${fmtNum(b.qty - n)} pcs`) };
    }
    if (l.key === "inv") {
      const iv = String(l.inv || "").trim();
      if (!iv) return { inc: L("ใส่ INV ใหม่", "enter new INV") };
      if (iv === b.inv) return { err: L("ต้องต่างจาก INV เดิม", "must differ from the current INV") };
      return { ok: `→ ${iv}` };
    }
    if (l.key === "cancel") return { ok: b.produced > 0 ? L(`→ เหลือ ${fmtNum(b.produced)} (ทำแล้ว · ${l.keep === "scrap" ? "scrap" : "สแปร์"})`, `→ ${fmtNum(b.produced)} left (made · ${l.keep === "scrap" ? "scrap" : "spare"})`) : L("→ ยกเลิกทั้ง Part", "→ whole part cancelled") };
    if (l.key === "transfer") {
      if (n <= 0) return { inc: L("ใส่จำนวน", "enter qty") };
      const max = Math.max(0, Math.min(b.qty - b.produced, b.free));
      if (n > max) return { err: L(`ย้ายได้เฉพาะชิ้นที่ยังไม่ทำ (สูงสุด ${fmtNum(max)})`, `only unmade pieces can move (max ${fmtNum(max)})`) };
      const tn = String(l.tn || "").trim();
      if (!tn) return { inc: L("ใส่เบอร์ปลายทาง", "enter target part no.") };
      const tro = troOf(l);
      if (l.tro && !RELEASE_ORDER_RE.test(tro)) return { err: L("Release Order ต้องเป็นรูปแบบ P-ตัวเลข", "Release Order must look like P-123") };
      if (tn === pn && tro === releaseOrder) return { err: L("ปลายทางต้องต่างจากเดิม", "target must differ from the current part") };
      return { ok: L(`→ เหลือ ${fmtNum(b.qty - n)}`, `→ ${fmtNum(b.qty - n)} left`) };
    }
    return { inc: "" };
  }
  function applyLine(l, st) {
    const s = st[l.rid]; const n = num(l);
    if (l.key === "qty+") { s.qty += n; s.free += n; }
    if (l.key === "qty-") { s.qty -= n; s.free -= n; }
    if (l.key === "inv") s.inv = String(l.inv || "").trim();
    if (l.key === "cancel") { s.qty = s.produced; s.free = 0; s.cancelled = true; }
    if (l.key === "transfer") {
      s.qty -= n; s.free -= n;
      if (troOf(l) === releaseOrder) {
        const t = releases.find((x) => x.part_master?.part_no === String(l.tn || "").trim());
        if (t && st[t.id]) { st[t.id].qty += n; st[t.id].free += n; }
      }
    }
  }
  const ordered = sel.flatMap((rid) => lines.filter((l) => l.rid === rid));
  const sim = (() => { const st = freshState(); return ordered.map((l) => { const b = { ...st[l.rid] }; const s = lineState(l, b); if (s.ok) applyLine(l, st); return { l, b, a: { ...st[l.rid] }, s }; }); })();
  const stateBefore = (l) => sim.find((x) => x.l.id === l.id)?.b || freshState()[l.rid];
  function descLine(l, b, a) {
    const n = num(l);
    if (l.key === "qty+") return L(`${fmtNum(b.qty)} → ${fmtNum(a.qty)} ชิ้น (+${n}) · สร้าง QR ใหม่ ${n} ใบ`, `${fmtNum(b.qty)} → ${fmtNum(a.qty)} pcs (+${n}) · ${n} new QR`);
    if (l.key === "qty-") return L(`${fmtNum(b.qty)} → ${fmtNum(a.qty)} ชิ้น (−${n}) · ยกเลิก QR ที่ยังไม่ใช้ ${n} ใบ (เก็บเป็นหลักฐาน)`, `${fmtNum(b.qty)} → ${fmtNum(a.qty)} pcs (−${n}) · cancel ${n} unused QR (kept as evidence)`);
    if (l.key === "inv") return L(`INV ${b.inv || "-"} → ${String(l.inv || "").trim()} · จำนวน/QR ไม่เปลี่ยน (มีผลทุก Release ของเบอร์นี้)`, `INV ${b.inv || "-"} → ${String(l.inv || "").trim()} · qty/QR unchanged (applies to every release of this part)`);
    if (l.key === "cancel") return L(`ยกเลิก QR ที่ยังไม่ใช้ ${fmtNum(b.free)} ใบ`, `cancel ${fmtNum(b.free)} unused QR`) + (b.produced > 0 ? L(` · ทำแล้ว ${fmtNum(b.produced)} ชิ้น → ${l.keep === "scrap" ? "ทิ้ง (scrap)" : "เก็บเป็นสแปร์"}`, ` · ${fmtNum(b.produced)} made → ${l.keep === "scrap" ? "scrap" : "keep as spare"}`) : L(" · ยกเลิกทั้ง Part", " · whole part cancelled"));
    if (l.key === "transfer") { const tro = troOf(l); return L(`ย้าย ${n} ชิ้น → ${String(l.tn || "").trim()} · ${tro === releaseOrder ? "Release Order นี้" : tro} · เหลือ ${fmtNum(a.qty)} · QR เดิม`, `move ${n} pcs → ${String(l.tn || "").trim()} · ${tro === releaseOrder ? "this Release Order" : tro} · ${fmtNum(a.qty)} left · same QR`); }
    return "";
  }

  // ── เลือก Part ──
  const qq = q.trim().toLowerCase();
  const pickList = releases.filter((r) => !isCancelled(r) && (!qq
    || String(r.part_master?.part_no || "").toLowerCase().includes(qq)
    || String(r.part_master?.material || "").toLowerCase().includes(qq)));
  function toggle(rid) {
    if (sel.includes(rid)) { setSel((s) => s.filter((x) => x !== rid)); setLines((ls) => ls.filter((l) => l.rid !== rid)); }
    else { setSel((s) => [...s, rid]); setLines((ls) => [...ls, { id: ++lidRef.current, rid, key: "", n: "", inv: "", keep: "spare", tn: "", tro: "" }]); }
  }
  const setL = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addMore = (rid) => setLines((ls) => [...ls, { id: ++lidRef.current, rid, key: "", n: "", inv: "", keep: "spare", tn: "", tro: "" }]);
  const rmLine = (id) => setLines((ls) => ls.filter((l) => l.id !== id));
  function quickApply() {
    if (!qk) return;
    let done = 0, skip = 0;
    const next = lines.slice();
    sel.forEach((rid) => {
      const pl = next.filter((l) => l.rid === rid);
      const first = pl[0]; if (!first) return;
      const clash = pl.some((x) => x !== first && modTypeOf(x.key) === modTypeOf(qk)) || (qk === "cancel" && pl.length > 1);
      if (clash) { skip++; return; }
      const i = next.indexOf(first);
      next[i] = { ...first, key: qk, ...(qk === "inv" ? { inv: qv } : qk !== "cancel" ? { n: qv } : {}) };
      done++;
    });
    setLines(next);
    const qkLabel = modActLabel(qk, (MOD_ACTS.find((a) => a[0] === qk) || [])[1], lang);
    mlsToast(L(`ตั้ง “${qkLabel}” ให้ ${done} Part`, `Set “${qkLabel}” on ${done} part(s)`) + (skip ? L(` · ข้าม ${skip} Part (ชนกับการแก้อื่น)`, ` · skipped ${skip} (conflicts with another change)`) : ""), "info");
  }

  // ── สรุป / ปุ่มบันทึก ──
  const good = sim.filter((x) => x.s.ok);
  const nInc = sim.filter((x) => x.s.inc).length;
  const nErr = sim.filter((x) => x.s.err).length;
  const reasonOk = !!reason.trim();
  const relDay = useMemo(() => (releases || []).map((r) => String(r.release_date || "").slice(0, 10)).filter(Boolean).sort()[0] || "", [releases]);
  const dateErr = !docDate ? L("เลือกวันที่ของ M", "Pick the M date") : docDate > todayYmd() ? L("วันที่ต้องไม่เกินวันนี้", "The date can't be in the future") : "";
  const dateWarn = !dateErr && relDay && docDate < relDay ? L(`ก่อนวันปล่อยงาน (${fmtYmd(relDay)})`, `before the release date (${fmtYmd(relDay)})`) : "";
  const canSave = !busy && sim.length > 0 && !nInc && !nErr && reasonOk && !verErr && !dateErr;
  const footHint = !sel.length ? L("เลือก Part อย่างน้อย 1 เบอร์", "Pick at least one part")
    : nErr ? L(`มี ${nErr} รายการไม่ถูกต้อง (แดง) — แก้ก่อนบันทึก`, `${nErr} invalid row(s) (red) — fix before saving`)
    : nInc ? L(`ยังกรอกไม่ครบ ${nInc} แถว — กรอกให้ครบ หรือกด ✕ เอาเบอร์ที่ไม่แก้ออก`, `${nInc} row(s) incomplete — fill them in or press ✕ to remove`)
    : !reasonOk ? L("ใส่เหตุผลก่อนบันทึก", "Enter a reason before saving")
    : verErr ? L("เลข M ใช้ไม่ได้", "M number not allowed")
    : dateErr ? dateErr : "";

  async function submit() {
    if (!canSave) return;
    const items = good.map(({ l }) => {
      const base = { release_id: l.rid };
      if (l.key === "qty+") return { ...base, type: "qty", dir: "add", n: num(l) };
      if (l.key === "qty-") return { ...base, type: "qty", dir: "sub", n: num(l) };
      if (l.key === "inv") return { ...base, type: "inv", inv: String(l.inv).trim() };
      if (l.key === "cancel") return { ...base, type: "cancel", keep: l.keep === "scrap" ? "scrap" : "spare" };
      return { ...base, type: "transfer", n: num(l), to_release_order: troOf(l), to_part_no: String(l.tn).trim() };
    });
    const qrOut = good.reduce((s, x) => s + (x.l.key === "qty-" ? num(x.l) : x.l.key === "cancel" ? x.b.free : 0), 0);
    const moved = good.filter((x) => x.l.key === "transfer").reduce((s, x) => s + num(x.l), 0);
    const ok = await askConfirm({
      message: L(`บันทึก ${chosen} · ${good.length} รายการ (${new Set(good.map((x) => x.l.rid)).size} Part) · วันที่ M ${fmtYmd(docDate)}`, `Save ${chosen} · ${good.length} change(s) (${new Set(good.map((x) => x.l.rid)).size} part(s)) · M date ${fmtYmd(docDate)}`)
        + (qrOut ? L(`\n• ยกเลิก QR ที่ยังไม่ใช้ ${fmtNum(qrOut)} ใบ (เก็บเป็นหลักฐาน · หน้าเครื่องสแกนแล้วจะแจ้งว่ายกเลิก)`, `\n• Cancel ${fmtNum(qrOut)} unused QR (kept as evidence · stations will show them as cancelled)`) : "")
        + (moved ? L(`\n• ย้าย ${fmtNum(moved)} ชิ้นไปเบอร์ใหม่ (QR เดิม)`, `\n• Move ${fmtNum(moved)} pcs to a new part no. (same QR)`) : "")
        + L(`\n\nค่าก่อนแก้เก็บไว้ใน M ก่อนหน้า · ถ้าผิด ยกเลิก ${chosen} ได้ภายหลังจากประวัติการแก้ไข`, `\n\nThe previous values stay in the earlier M · if it's wrong you can cancel ${chosen} later from the history`),
      tone: qrOut || moved ? "danger" : "warn", confirmText: L(`บันทึก ${chosen}`, `Save ${chosen}`), cancelText: L("กลับไปแก้", "Back to edit"),
    });
    if (!ok) return;
    setBusy(true); setErr("");
    const res = await applyReleaseModify({
      projectId, releaseOrder, reason: reason.trim(), items, docDate,
      versionNo: (verBlank || chosenNo === autoNo) ? null : chosenNo,   // อัตโนมัติ = ให้ DB เลือกเลขถัดไป (กันชนกันถ้ามีคนแก้พร้อมกัน)
    });
    setBusy(false);
    if (!res || !res.ok) { setErr(modErrText(res, lang)); return; }
    auditRecord("release_modify", "release_order", releaseOrder, { version: res.version, items, project_id: projectId, doc_date: docDate });
    mlsToast(L(`บันทึก ${fmtM(res.version)} แล้ว (${items.length} รายการ) · ของเดิมเก็บเป็นหลักฐาน`, `Saved ${fmtM(res.version)} (${items.length} change(s)) · previous values kept as evidence`), "ok");
    onSaved(res);
  }

  const secH = (n, text, right) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, margin: "16px 0 8px" }}>
      <span style={{ width: 22, height: 22, borderRadius: 99, background: MOD_PURPLE, color: "#fff", fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
      {text}<span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: MOD_PURPLE }}>{right}</span>
    </div>
  );
  const resStyle = (s) => ({ fontSize: 12.5, fontWeight: 700, color: s.ok ? "var(--accent-dk)" : s.err ? "var(--danger)" : "var(--muted)" });
  const lx = { border: 0, background: "transparent", color: "var(--muted-2)", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 6 };

  return (
    <Modal wide title={L("Modify รายการใน Release", "Modify release items")} locked={busy} closeOnBackdrop={false}
      sub={L(`${releaseOrder} · เลือก Part → เลือกการแก้ไขท้ายแต่ละเบอร์ (แยกกันอิสระ) → บันทึกทีเดียวเป็น M ใหม่ · ของเดิมเก็บเป็นหลักฐาน`, `${releaseOrder} · pick parts → choose a change after each part (independent) → save once as a new M · previous values kept as evidence`)}
      onClose={onClose}>
      {/* เลข M */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: -4 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{L("บันทึกเป็น", "Save as")}</span>
        <span style={{ display: "inline-flex", alignItems: "center", border: `1.5px solid ${MOD_PURPLE}`, borderRadius: 9, overflow: "hidden", background: "rgba(109,74,255,.07)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: MOD_PURPLE, padding: "0 0 0 9px" }}>M-</span>
          <input type="number" min="1" value={verRaw} onChange={(e) => setVerRaw(e.target.value)}
            onBlur={() => { const n = parseInt(verRaw, 10); if (n > 0) setVerRaw(String(n).padStart(3, "0")); }}
            style={{ width: 58, fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: MOD_PURPLE, background: "transparent", border: 0, padding: "7px 8px 7px 2px", outline: "none" }} />
        </span>
        <Btn size="sm" variant="ghost" onClick={() => setVerRaw(String(autoNo).padStart(3, "0"))} title={L("ใช้เลขถัดไปอัตโนมัติ", "Use the next number automatically")}>↺ {L("อัตโนมัติ", "Auto")}</Btn>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginLeft: 6 }}>{L("วันที่ M", "M date")}</span>
        <input type="date" className="relmod-date" value={docDate} max={todayYmd()} onChange={(e) => setDocDate(e.target.value)}
          title={L("วันที่ตามเอกสาร Modify (ไม่ใช่วันที่ลงแอป)", "Date on the Modify document (not the day it's entered)")} style={{ borderColor: dateErr ? "var(--danger)" : undefined }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: verErr ? "var(--danger)" : chosenNo !== autoNo ? MOD_PURPLE : "var(--muted)", flexBasis: "100%", textAlign: "right" }}>{verErr ? "⚠ " + verErr : verInfo}
          {" · "}<span style={{ color: dateErr ? "var(--danger)" : dateWarn ? "#b45309" : "var(--muted)" }}>{dateErr ? "⚠ " + dateErr : docDate !== todayYmd() ? L(`วันที่ M ${fmtYmd(docDate)} · ลงแอปวันนี้`, `M date ${fmtYmd(docDate)} · entered today`) : L("วันที่ M = วันนี้ (เปลี่ยนได้ถ้าเอกสารลงวันอื่น)", "M date = today (change it if the document has another date)")}{dateWarn ? " · ⚠ " + dateWarn : ""}</span></span>
      </div>

      {secH(1, L("เลือก Part (เลือกได้หลาย Part)", "Pick parts (multiple allowed)"), sel.length ? L(`เลือกแล้ว ${sel.length} Part`, `${sel.length} selected`) : "")}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("🔍 พิมพ์ค้นหาเบอร์ Part / INV Code…", "🔍 Search part no. / INV Code…")} />
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, maxHeight: 220, overflow: "auto", marginTop: 8 }}>
        {pickList.length === 0 && <div style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 13 }}>{L("ไม่พบ Part ที่ค้นหา", "No matching parts")}</div>}
        {pickList.map((r, i) => {
          const Lm = limits[r.id] || {}; const on = sel.includes(r.id);
          return (
            <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: i ? "1px solid var(--border)" : "none", cursor: "pointer", fontSize: 13, background: on ? "rgba(109,74,255,.07)" : undefined }}>
              <input type="checkbox" checked={on} onChange={() => toggle(r.id)} style={{ width: 16, height: 16, accentColor: MOD_PURPLE }} />
              <b style={{ minWidth: 120 }}>{r.part_master?.part_no || "-"}</b>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>qty {fmtNum(r.qty)} · {L("ทำแล้ว", "made")} {fmtNum(Lm.produced || 0)} · {L("QR ยังไม่ใช้", "unused QR")} {fmtNum(Lm.free_qr ?? r.qty)} · {r.part_master?.material || "-"}</span>
              {r.mod_version && <ModVerPill v={r.mod_version} />}
            </label>
          );
        })}
      </div>

      {secH(2, <>{L("แต่ละเบอร์แก้อะไร", "What to change on each part")} <span style={{ fontWeight: 500, color: "var(--muted)", fontSize: 12 }}>{L("(เลือกแยกกันอิสระ)", "(independent per part)")}</span></>, sel.length ? L(`${sel.length} Part`, `${sel.length} part(s)`) : "")}
      {!sel.length ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", padding: 12, border: "1px dashed var(--border)", borderRadius: 11, textAlign: "center" }}>{L("เลือก Part ในข้อ 1 ก่อน — แล้วเลือกการแก้ไขท้ายแต่ละเบอร์ (เบอร์ไหนแก้อะไรก็ได้)", "Pick parts in step 1 first — then choose a change after each part (any mix)")}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "var(--surface-2)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5, marginBottom: 6 }}>
            {L("ตั้งทุก Part พร้อมกัน (ไม่บังคับ):", "Set all parts at once (optional):")}
            <select className="select" value={qk} onChange={(e) => { setQk(e.target.value); setQv(""); }} style={{ width: "auto" }}>
              <option value="">{L("— การแก้ไข —", "— change —")}</option>
              {MOD_ACTS.map(([v, t]) => <option key={v} value={v}>{modActLabel(v, t, lang)}</option>)}
            </select>
            {(qk === "qty+" || qk === "qty-" || qk === "transfer") && <Input type="number" min="1" value={qv} onChange={(e) => setQv(e.target.value)} placeholder="0" style={{ width: 80 }} />}
            {qk === "inv" && <Input value={qv} onChange={(e) => setQv(e.target.value)} placeholder={L("INV Code ใหม่", "New INV Code")} style={{ width: 160 }} />}
            <Btn size="sm" variant="ghost" onClick={quickApply} disabled={!qk}>{L("ใช้กับทุก Part", "Apply to all")}</Btn>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{L("แล้วค่อยแก้เบอร์ที่ต่างออกไปทีละแถว", "then adjust the different ones row by row")}</span>
          </div>
          {sel.map((rid) => {
            const r = byId[rid]; const pl = lines.filter((l) => l.rid === rid); const Lm = limits[rid] || {};
            const used = new Set(pl.map((x) => modTypeOf(x.key)).filter(Boolean));
            const more = !pl.some((x) => x.key === "cancel") && pl.every((x) => x.key) && ["qty", "inv", "transfer"].some((g) => !used.has(g));
            return (
              <div key={rid} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 190px) minmax(0, 1fr)", gap: 12, alignItems: "start", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ paddingTop: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13 }}>
                    {r?.part_master?.part_no || "-"}
                    <button type="button" style={lx} onClick={() => toggle(rid)} title={L("ไม่แก้เบอร์นี้ (เอาออก)", "Don't change this part (remove)")}>✕</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>qty {fmtNum(r?.qty)} · {L("ทำแล้ว", "made")} {fmtNum(Lm.produced || 0)} · {L("QR ยังไม่ใช้", "unused QR")} {fmtNum(Lm.free_qr ?? r?.qty)}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
                  {pl.map((l) => {
                    const others = pl.filter((x) => x !== l).map((x) => modTypeOf(x.key)).filter(Boolean);
                    const b = stateBefore(l);
                    const s = sim.find((x) => x.l.id === l.id)?.s || {};
                    const tone = MOD_TONE[modTypeOf(l.key)];
                    return (
                      <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
                        <select className="select" value={l.key} onChange={(e) => setL(l.id, { key: e.target.value })}
                          style={{ width: 200, fontWeight: 600, ...(tone ? { borderColor: tone.c, color: tone.c } : { borderStyle: "dashed", color: "var(--muted)" }) }}>
                          <option value="">{L("— เลือกการแก้ไข —", "— choose a change —")}</option>
                          {MOD_ACTS.map(([v, t]) => {
                            const dis = others.includes(modTypeOf(v)) || (v === "cancel" && pl.length > 1);
                            return <option key={v} value={v} disabled={dis}>{modActLabel(v, t, lang)}{v === "cancel" && pl.length > 1 ? L(" (มีการแก้อื่นอยู่)", " (other changes exist)") : ""}</option>;
                          })}
                        </select>
                        {(l.key === "qty+" || l.key === "qty-") && <><Input type="number" min="1" value={l.n} onChange={(e) => setL(l.id, { n: e.target.value })} placeholder="0" style={{ width: 80 }} /> {L("ชิ้น", "pcs")}</>}
                        {l.key === "inv" && <>
                          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{L("เดิม", "now")}</span>
                          <b style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{b?.inv || "-"}</b>
                          <span style={{ color: "var(--muted-2)" }}>→</span>
                          <Input value={l.inv} onChange={(e) => setL(l.id, { inv: e.target.value })} placeholder={L("INV Code ใหม่", "New INV Code")} style={{ width: 160 }} />
                        </>}
                        {l.key === "cancel" && <>
                          <span>{L("ยกเลิก QR ที่ยังไม่ใช้", "cancel unused QR")}</span>
                          {(b?.produced || 0) > 0 && <>· {L("ทำแล้ว", "made")} {fmtNum(b.produced)} {L("ชิ้น", "pcs")}:
                            <select className="select" value={l.keep} onChange={(e) => setL(l.id, { keep: e.target.value })} style={{ width: "auto" }}>
                              <option value="spare">{L("เก็บเป็นสแปร์", "keep as spare")}</option><option value="scrap">{L("ทิ้ง (scrap)", "scrap")}</option>
                            </select></>}
                        </>}
                        {l.key === "transfer" && <>
                          <Input type="number" min="1" value={l.n} onChange={(e) => setL(l.id, { n: e.target.value })} placeholder="0" style={{ width: 80 }} /> {L("ชิ้น", "pcs")} →
                          <Input value={l.tro} onChange={(e) => setL(l.id, { tro: e.target.value })} placeholder={releaseOrder} title={L("Release Order ปลายทาง (ว่าง = ใบนี้)", "Target Release Order (blank = this one)")} style={{ width: 120 }} />
                          <Input value={l.tn} onChange={(e) => setL(l.id, { tn: e.target.value })} list={`relmod-dl-${l.id}`} placeholder={L("เบอร์ปลายทาง", "Target part no.")} style={{ width: 150 }} />
                          <datalist id={`relmod-dl-${l.id}`}>{releases.filter((x) => x.id !== rid && !isCancelled(x)).map((x) => <option key={x.id} value={x.part_master?.part_no || ""} />)}</datalist>
                        </>}
                        <span style={resStyle(s)}>{s.ok || s.err || s.inc || ""}</span>
                        {pl.length > 1 && <button type="button" style={lx} onClick={() => rmLine(l.id)} title={L("เอาการแก้ไขนี้ออก", "Remove this change")}>✕</button>}
                      </div>
                    );
                  })}
                  {more && <button type="button" onClick={() => addMore(rid)}
                    style={{ alignSelf: "flex-start", font: "inherit", fontSize: 12, color: MOD_PURPLE, fontWeight: 700, cursor: "pointer", background: "none", border: "1px dashed rgba(109,74,255,.45)", borderRadius: 8, padding: "3px 10px" }}>{L("+ แก้อย่างอื่นกับเบอร์นี้ด้วย", "+ another change for this part")}</button>}
                </div>
              </div>
            );
          })}
        </>
      )}

      {secH(3, L(`สรุปก่อนบันทึก — ${chosen}`, `Summary before saving — ${chosen}`), good.length ? L(`${good.length} รายการ · ${new Set(good.map((x) => x.l.rid)).size} Part`, `${good.length} change(s) · ${new Set(good.map((x) => x.l.rid)).size} part(s)`) : "")}
      {!sel.length ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", padding: 12, border: "1px dashed var(--border)", borderRadius: 11, textAlign: "center" }}>{L("1 M แก้ได้หลายอย่าง: เบอร์หนึ่งเพิ่มจำนวน อีกเบอร์ยกเลิก อีกเบอร์แก้ INV ก็ได้ แล้วบันทึกทีเดียว", "One M can hold many changes: add qty on one part, cancel another, change INV on a third — then save once")}</div>
      ) : (
        <div style={{ border: "1px solid rgba(109,74,255,.35)", borderRadius: 12, overflow: "hidden" }}>
          {sel.map((rid, gi) => {
            const rows = sim.filter((x) => x.l.rid === rid);
            if (!rows.length) return null;
            const b0 = rows[0].b, aN = rows[rows.length - 1].a;
            const net = [];
            if (aN.qty !== b0.qty) net.push(`qty ${fmtNum(b0.qty)}→${fmtNum(aN.qty)}`);
            if (aN.inv !== b0.inv) net.push(`INV→${aN.inv}`);
            if (aN.cancelled && !b0.cancelled) net.push(L("ยกเลิก", "cancelled"));
            return (
              <div key={rid} style={{ borderTop: gi ? "1px solid var(--border)" : "none", padding: "8px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
                  {pnOf(rid)}<span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{net.length ? L("สุทธิ: ", "net: ") + net.join(" · ") : ""}</span>
                </div>
                {rows.map(({ l, b, a, s }) => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0 3px 10px", fontSize: 12.5 }}>
                    {s.ok ? <ModChip type={modTypeOf(l.key)} /> : <span style={{ fontSize: 11, color: "var(--muted)" }}>{l.key ? modTL(modTypeOf(l.key), lang) : L("ยังไม่เลือก", "not chosen")}</span>}
                    <span style={{ color: s.ok ? "var(--text)" : s.err ? "var(--danger)" : "var(--muted)" }}>{s.ok ? descLine(l, b, a) : s.err ? "⚠ " + s.err : L("ยังไม่ครบ — ", "incomplete — ") + s.inc}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>{L("🔒 ค่าก่อนแก้เก็บไว้ใน M ก่อนหน้า (ย้อนดูได้) · ทุกรายการบันทึกรวมเป็น ", "🔒 Previous values stay in the earlier M (viewable) · every change is saved together as ")}<b>{chosen}</b>{L(" ครั้งเดียว · บันทึกงานที่ทำไปแล้วไม่ถูกลบ · QR ชิ้นเดิมไม่เปลี่ยน", " · recorded work is never deleted · existing QR codes don't change")}</div>

      {secH(4, L("เหตุผล (จำเป็น · ใช้กับทั้ง M)", "Reason (required · for the whole M)"))}
      <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder={L("เช่น แก้ตาม drawing rev ใหม่ / ลูกค้าเปลี่ยนจำนวน + INV / ย้ายไป release ใหม่", "e.g. new drawing rev / customer changed qty + INV / moved to a new release")} style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }} />

      {err && <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 10, background: "rgba(239,68,68,.1)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>⚠ {err}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 12, fontWeight: footHint ? 700 : 400, color: footHint ? (nErr ? "var(--danger)" : "var(--warning, #b45309)") : "var(--muted)" }}>{footHint || L("🔒 ของเดิม (ก่อนแก้) เก็บไว้ใน M ก่อนหน้า · QR ชิ้นเดิมไม่เปลี่ยน", "🔒 Previous values stay in the earlier M · existing QR codes don't change")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>{L("ยกเลิก", "Cancel")}</Btn>
          <Btn variant="danger" onClick={submit} disabled={!canSave}>{busy ? L("กำลังบันทึก…", "Saving…") : L(`ยืนยัน · บันทึก ${chosen}${good.length ? ` (${good.length} รายการ)` : ""}`, `Confirm · save ${chosen}${good.length ? ` (${good.length})` : ""}`)}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── ดูรายละเอียดของ M (หรือ M-000 ต้นฉบับ) ──
// ปุ่มท้ายรายละเอียด M: Export (ทุกคน) · ยกเลิก M / ย้อนกลับ (แอดมิน)
function ModDetailActions({ version, canRevert, canCancel, canRollback, onRevert, onExport, exporting }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  return (
    <div className="relmod-actions">
      <Btn variant="ghost" size="sm" onClick={() => onExport && onExport(version)} disabled={!onExport || exporting}>
        <Icon name="grid" size={14} /> {exporting ? L("กำลังสร้าง…", "Exporting…") : L(`Export ${version}`, `Export ${version}`)}
      </Btn>
      <span style={{ flex: 1 }} />
      {canRevert && canRollback && (
        <Btn variant="ghost" size="sm" onClick={() => onRevert("rollback", version)}
          title={version === M0 ? L("ยกเลิกทุก M ให้กลับเป็นค่าต้นฉบับ", "Cancel every M and go back to the original") : L(`ยกเลิกทุก M ที่ใหม่กว่า ${version}`, `Cancel every M newer than ${version}`)}>
          ↩ {version === M0 ? L("ย้อนกลับเป็นต้นฉบับ", "Roll back to original") : L(`ย้อนกลับเป็น ${version}`, `Roll back to ${version}`)}
        </Btn>
      )}
      {canRevert && canCancel && (
        <Btn variant="danger" size="sm" onClick={() => onRevert("cancel", version)} title={L(`ย้อนเฉพาะการแก้ใน ${version}`, `Undo only the changes in ${version}`)}>
          ✕ {L(`ยกเลิก ${version}`, `Cancel ${version}`)}
        </Btn>
      )}
    </div>
  );
}
// แก้วันที่ของ M / วันที่ยกเลิก (แอดมิน) — ประวัติการแก้วันที่เก็บไว้ในฐานข้อมูล
function ModDateEdit({ mod, target = "modify", onSaved }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const cur = target === "revert" ? revDocDate(mod?.reverted) : modDocDate(mod);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(cur);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open) return <button type="button" className="relmod-datebtn" onClick={() => { setD(cur); setNote(""); setErr(""); setOpen(true); }}>✎ {L("แก้วันที่", "Edit date")}</button>;
  const bad = !d ? L("เลือกวันที่", "Pick a date") : d > todayYmd() ? L("วันที่ต้องไม่เกินวันนี้", "The date can't be in the future") : d === cur ? L("ยังเป็นวันที่เดิม", "Same date as now") : "";
  async function save() {
    if (bad || busy) return;
    setBusy(true); setErr("");
    const r = await setReleaseModDate({ modId: mod.id, target, date: d, note: note.trim() });
    setBusy(false);
    if (!r || !r.ok) { setErr(modErrText(r, lang)); return; }
    auditRecord("release_modify_date", "release_modification", mod.id, { version: mod.version, target, old_date: r.old_date, new_date: r.new_date, note: note.trim() });
    mlsToast(L(`${mod.version}: ${target === "revert" ? "วันที่ยกเลิก" : "วันที่ M"} ${fmtYmd(r.old_date)} → ${fmtYmd(r.new_date)}`, `${mod.version}: ${target === "revert" ? "cancel date" : "M date"} ${fmtYmd(r.old_date)} → ${fmtYmd(r.new_date)}`), "success");
    setOpen(false);
    onSaved && onSaved();
  }
  return (
    <span className="relmod-dateedit">
      <input type="date" className="relmod-date" value={d} max={todayYmd()} onChange={(e) => setD(e.target.value)} disabled={busy} />
      <input className="relmod-date" style={{ width: 170 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("หมายเหตุ (ไม่บังคับ)", "Note (optional)")} disabled={busy} />
      <Btn size="sm" variant="accent" onClick={save} disabled={!!bad || busy}>{busy ? "…" : L("บันทึก", "Save")}</Btn>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{L("ยกเลิก", "Cancel")}</Btn>
      {(err || (bad && d !== cur)) && <span style={{ color: "var(--danger)", fontSize: 11.5, fontWeight: 600, flexBasis: "100%" }}>⚠ {err || bad}</span>}
    </span>
  );
}
function ModDateLog({ log }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  if (!Array.isArray(log) || !log.length) return null;
  return (
    <div className="relmod-datelog">
      {log.map((x, i) => (
        <div key={i}>✎ {x.target === "revert" ? L("แก้วันที่ยกเลิก", "Cancel date changed") : L("แก้วันที่ M", "M date changed")} {fmtYmd(x.old_date)} → <b>{fmtYmd(x.new_date)}</b> · {x.actor_name || "-"} · {fmtDT(x.at)}{x.note ? ` · ${x.note}` : ""}</div>
      ))}
    </div>
  );
}
// แถบ "ยกเลิกแล้ว" (ใคร · วันที่ยกเลิก · ลงแอปเมื่อ · เหตุผล · วิธี)
function ModRevertedBanner({ rv, mod, canEditDate, onDateChanged }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  if (!rv) return null;
  return (
    <div className="relmod-cancelled-banner">
      <b>⊘ {L("ยกเลิกแล้ว", "Cancelled")}</b> · {L("วันที่ยกเลิก", "cancel date")} <b>{fmtYmd(revDocDate(rv))}</b>
      {canEditDate && onDateChanged ? <> <ModDateEdit mod={mod} target="revert" onSaved={onDateChanged} /></> : null}
      {" · "}{L("ลงแอป", "entered")} {fmtDT(rv.at)} · {rv.actor_name || "-"}
      {rv.mode === "rollback" ? <> · {L(`ย้อนกลับเป็น ${rv.target_version || M0}`, `rolled back to ${rv.target_version || M0}`)}</> : null}
      <div style={{ marginTop: 3 }}>📝 {L("เหตุผลที่ยกเลิก:", "Cancel reason:")} {rv.reason || "-"}</div>
      <div style={{ marginTop: 3, fontSize: 11.5, opacity: .85 }}>{L("การแก้ใน M นี้ถูกย้อนกลับแล้ว · รายละเอียดด้านล่างเก็บไว้เป็นประวัติ", "The changes in this M were undone · the details below are kept as history")}</div>
    </div>
  );
}

function ReleaseModDetailModal({ mod, origin, prevVersion, releases, onClose, canRevert = false, hasNewer = false, anyActive = false, onRevert, onExport, exporting = false, canEditDate = false, onDateChanged }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  if (!mod) {
    // M-000 = ต้นฉบับล้วน (ไม่มีคอลัมน์ "ตอนนี้/เปลี่ยนแปลง")
    const rows = origin?.rows || releases.map((r) => ({
      part_no: r.part_master?.part_no, qty: r.qty, length_mm: r.length_mm ?? r.part_master?.default_length_mm,
      unit_weight: r.unit_weight ?? r.part_master?.unit_weight, inv: r.part_master?.material || r.material,
    }));
    const tq = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const tw = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unit_weight) || 0), 0);
    return (
      <Modal wide onClose={onClose}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><ModVerPill v={M0} gray /> {L("ต้นฉบับ — ก่อนการแก้ไข", "Original — before any change")}</span>}
        sub={origin ? L("ค่าของทุก Part ก่อนการ Modify ครั้งแรก · ล็อกไว้เป็นหลักฐาน แก้ไม่ได้", "Every part before the first Modify · locked as evidence, read-only") : L("ยังไม่เคย Modify — ค่าปัจจุบันคือต้นฉบับ (จะถูกล็อกเป็น M-000 ตอน Modify ครั้งแรก)", "Never modified — current values are the original (locked as M-000 at the first Modify)")}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)", margin: "4px 0 12px" }}>
          {(() => { const rd = (rows.map((r) => String(r.release_date || "").slice(0, 10)).filter(Boolean).sort()[0]) || (releases.map((r) => String(r.release_date || "").slice(0, 10)).filter(Boolean).sort()[0]); return rd ? <span>{L("วันที่ปล่อยงาน:", "Release date:")} <b style={{ color: "var(--text)" }}>{fmtYmd(rd)}</b></span> : null; })()}
          {origin && <span>{L("บันทึกต้นฉบับลงแอป:", "Original saved:")} <b style={{ color: "var(--text)" }}>{fmtDT(origin.created_at)}</b></span>}
          <span>{L("จำนวนรวม:", "Total qty:")} <b style={{ color: "var(--text)" }}>{fmtNum(tq)} {L("ชิ้น", "pcs")}</b></span>
          <span>{L("น้ำหนักรวม:", "Total weight:")} <b style={{ color: "var(--text)" }}>{fmtNum(tw)} {L("กก.", "kg")}</b></span>
          <span>{L("สถานะ:", "Status:")} <b style={{ color: "var(--text)" }}>{L("🔒 ล็อกเป็นหลักฐาน", "🔒 locked as evidence")}</b></span>
        </div>
        <div className="table-wrap" style={{ maxHeight: "55vh", overflow: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Part No.</th><th style={{ textAlign: "right" }}>{L("จำนวน", "Qty")}</th><th style={{ textAlign: "right" }}>{L("ความยาว/ชิ้น (มม.)", "Length/pc (mm)")}</th><th style={{ textAlign: "right" }}>{L("น้ำหนัก/ชิ้น", "Weight/pc")}</th><th style={{ textAlign: "right" }}>{L("น้ำหนักรวม", "Total weight")}</th><th>INV Code</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}><td style={{ fontWeight: 600 }}>{r.part_no || "-"}</td><td style={{ textAlign: "right" }}>{fmtNum(r.qty)}</td>
                <td style={{ textAlign: "right" }}>{r.length_mm ? fmtNum(r.length_mm) : "-"}</td>
                <td style={{ textAlign: "right" }}>{r.unit_weight ? Number(r.unit_weight).toFixed(2) : "-"}</td>
                <td style={{ textAlign: "right" }}>{r.unit_weight ? fmtNum((Number(r.qty) || 0) * Number(r.unit_weight)) : "-"}</td>
                <td>{r.inv || "-"}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <ModDetailActions version={M0} canRevert={canRevert} canCancel={false} canRollback={anyActive} onRevert={onRevert} onExport={onExport} exporting={exporting} />
      </Modal>
    );
  }
  const types = ["qty", "inv", "cancel", "transfer"].filter((t) => (mod.items || []).some((i) => i.type === t));
  const partOrder = [...new Set((mod.items || []).map((i) => i.part_no))];
  const items = (mod.items || []).slice().sort((a, b) => partOrder.indexOf(a.part_no) - partOrder.indexOf(b.part_no) || a.seq - b.seq);
  const ba = (it) => it.type === "inv"
    ? <><span style={{ color: "var(--muted)", textDecoration: "line-through", fontFamily: "var(--font-mono)", fontSize: 12 }}>{it.before?.inv || "-"}</span><span style={{ color: "var(--muted-2)", margin: "0 4px" }}>→</span><b style={{ color: "var(--accent-dk)" }}>{it.after?.inv || "-"}</b></>
    : <><span style={{ color: "var(--muted)", textDecoration: "line-through" }}>{fmtNum(it.before?.qty)}</span><span style={{ color: "var(--muted-2)", margin: "0 4px" }}>→</span><b style={{ color: "var(--accent-dk)" }}>{fmtNum(it.after?.qty)}</b> <span style={{ fontSize: 11, color: "var(--muted)" }}>{L("ชิ้น", "pcs")}</span></>;
  const qrText = (it) => {
    const a = Array.isArray(it.after?.qr) ? it.after.qr : [];
    if (!a.length) return null;
    return <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontFamily: "var(--font-mono)" }} title={a.join("\n")}>QR: {a.slice(0, 3).join(", ")}{a.length > 3 ? ` … (+${a.length - 3})` : ""}</div>;
  };
  return (
    <Modal wide onClose={onClose}
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><ModVerPill v={mod.version} gray={!!mod.reverted} />{mod.reverted ? <span className="relmod-xchip">{L("ยกเลิกแล้ว", "Cancelled")}</span> : null}{types.map((t) => <ModChip key={t} type={t} />)}</span>}
      sub={L(`${(mod.items || []).length} รายการ · ${partOrder.length} Part · เทียบกับ ${prevVersion} (ค่าก่อนแก้)`, `${(mod.items || []).length} change(s) · ${partOrder.length} part(s) · compared with ${prevVersion} (before)`)}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "var(--muted)", margin: "4px 0 10px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>📅 {L("วันที่ M:", "M date:")} <b style={{ color: "var(--text)" }}>{fmtYmd(modDocDate(mod))}</b>
          {!mod.doc_date && <span style={{ fontSize: 11.5 }}>{L("(ไม่ได้ระบุ = วันที่ลงแอป)", "(not set = entry date)")}</span>}
          {canEditDate && onDateChanged ? <ModDateEdit key={"m" + (mod.doc_date || "")} mod={mod} target="modify" onSaved={onDateChanged} /> : null}</span>
        <span>{L("ลงแอป:", "Entered:")} <b style={{ color: "var(--text)" }}>{fmtDT(mod.created_at)}</b></span>
        <span>{L("ผู้แก้:", "By:")} <b style={{ color: "var(--text)" }}>{mod.actor_name || "-"}</b></span>
      </div>
      <ModDateLog log={mod.date_log} />
      <ModRevertedBanner rv={mod.reverted} mod={mod} canEditDate={canEditDate} onDateChanged={onDateChanged} />
      <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>📝 {L("เหตุผล:", "Reason:")} {mod.reason || "-"}</div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Part No.</th><th>{L("การแก้ไข", "Change")}</th><th>{L("ก่อน → หลัง", "Before → after")}</th><th>{L("รายละเอียด", "Details")}</th></tr></thead>
          <tbody>{items.map((it, k) => (
            <tr key={k}>
              <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{k > 0 && items[k - 1].part_no === it.part_no ? <span style={{ color: "var(--muted)" }}>〃</span> : it.part_no}</td>
              <td><ModChip type={it.type} /></td>
              <td style={{ whiteSpace: "nowrap" }}>{ba(it)}</td>
              <td style={{ whiteSpace: "normal" }}>{modNoteText(it.note, lang)}{qrText(it)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>🔒 {L(`${prevVersion} (ค่าก่อนแก้) ยังเก็บอยู่ ลบทับไม่ได้ · บันทึกงานหน้าเครื่องที่ทำไปแล้วจำค่าตอนที่ทำ · QR ของชิ้นเดิมไม่เปลี่ยน`, `${prevVersion} (before) is still kept and can't be overwritten · station records keep the values from when they were made · existing QR codes don't change`)}</div>
      <ModDetailActions version={mod.version} canRevert={canRevert && !mod.reverted} canCancel canRollback={hasNewer} onRevert={onRevert} onExport={onExport} exporting={exporting} />
    </Modal>
  );
}

// ── สถานะของทุก Part ในใบ "ณ เวอร์ชัน" ──
//   เริ่มจากต้นฉบับ M-000 แล้วเล่นเหตุการณ์ตามเวลาจริง (บันทึก M / ยกเลิก M) จนถึงตอนบันทึก M นั้น
//   (M ที่ถูกยกเลิกก่อนหน้า = ย้อนออกแล้ว · M ที่ถูกยกเลิกทีหลัง = ยังนับ เพราะตอนนั้นยังใช้อยู่)
function modStateAt(info, releases, ro, stopVersion) {
  const mods = (info && info.mods) || [];
  const cur = new Map((releases || []).map((r) => [r.id, r]));
  const rows = new Map();
  const base = (info?.origin?.rows && info.origin.rows.length) ? info.origin.rows : (releases || []).map((r) => ({
    release_id: r.id, part_no: r.part_master?.part_no, qty: r.qty, length_mm: r.length_mm ?? r.part_master?.default_length_mm,
    unit_weight: r.unit_weight ?? r.part_master?.unit_weight, inv: r.part_master?.material || r.material,
  }));
  base.forEach((o) => rows.set(o.release_id, { release_id: o.release_id, part_no: o.part_no, qty: Number(o.qty) || 0, length_mm: o.length_mm, unit_weight: o.unit_weight, inv: o.inv, status: "" }));
  if (stopVersion === M0) return [...rows.values()];
  const get = (it) => {
    let r = rows.get(it.release_id);
    if (!r) {
      const c = cur.get(it.release_id);
      r = { release_id: it.release_id, part_no: it.part_no, qty: Number(it.before?.qty) || 0, length_mm: c?.length_mm ?? c?.part_master?.default_length_mm ?? null,
        unit_weight: c?.unit_weight ?? c?.part_master?.unit_weight ?? null, inv: it.before?.inv, status: "" };
      rows.set(it.release_id, r);
    }
    return r;
  };
  const ms = (t) => { const v = new Date(t).getTime(); return Number.isFinite(v) ? v : 0; };
  const ev = [];
  mods.forEach((m) => { ev.push({ t: ms(m.created_at), k: 0, m }); if (m.reverted) ev.push({ t: ms(m.reverted.at), k: 1, m }); });
  ev.sort((a, b) => a.t - b.t || a.k - b.k || (a.k === 1 ? ms(b.m.created_at) - ms(a.m.created_at) : 0));
  for (const e of ev) {
    const items = [...(e.m.items || [])].sort((a, b) => a.seq - b.seq);
    if (e.k === 0) {
      for (const it of items) {
        const r = get(it);
        if (it.after?.qty != null) r.qty = Number(it.after.qty) || 0;
        if (it.after && "inv" in it.after) r.inv = it.after.inv;
        if (it.after?.part_no) r.part_no = it.after.part_no;
        if (it.type === "cancel") r.status = "cancelled";
        if (it.type === "transfer") {
          if (r.qty === 0) r.status = "moved";
          const to = it.after?.to_release_id;
          if (to && (it.after?.to_release_order || ro) === ro) {
            let d = rows.get(to);
            if (!d) {
              const c = cur.get(to);
              d = { release_id: to, part_no: it.after.to_part_no, qty: 0, length_mm: c?.length_mm ?? r.length_mm, unit_weight: c?.unit_weight ?? r.unit_weight, inv: r.inv, status: "" };
              rows.set(to, d);
            }
            d.qty += Number(it.after.moved) || 0;
          }
        }
      }
      if (stopVersion && e.m.version === stopVersion) break;
    } else {
      for (const it of items.reverse()) {
        const r = get(it);
        if (it.before?.qty != null) r.qty = Number(it.before.qty) || 0;
        if (it.before && "inv" in it.before) r.inv = it.before.inv;
        if (it.type === "cancel" || (it.type === "transfer" && r.status === "moved")) r.status = "";
        const to = it.after?.to_release_id;
        if (it.type === "transfer" && to && rows.has(to)) {
          const d = rows.get(to);
          d.qty -= Number(it.after.moved) || 0;
          if (d.qty <= 0) rows.delete(to);
        }
      }
    }
  }
  return [...rows.values()];
}

// ── Export Excel ของ M (หรือทุก M) ──
function modExportSheets({ info, releases, ro, version, lang }) {
  const L = (th, en) => (lang === "en" ? en : th);
  const mods = (info && info.mods) || [];
  const pj = releases[0]?.part_master?.projects || {};
  const cur = info?.current || M0;
  const w2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const statusOf = (m) => (m.reverted ? L("ยกเลิกแล้ว", "Cancelled") : m.version === cur ? L("ใช้อยู่ (เวอร์ชันปัจจุบัน)", "Active (current)") : L("ใช้อยู่", "Active"));
  const howOf = (rv) => (!rv ? "" : rv.mode === "rollback" ? L(`ย้อนกลับเป็น ${rv.target_version || M0}`, `Rolled back to ${rv.target_version || M0}`) : L("ยกเลิก M นี้", "Cancelled this M"));
  const kv = (list) => list.filter(Boolean).map(([k, v]) => ({ [L("หัวข้อ", "Item")]: k, [L("ค่า", "Value")]: v ?? "" }));
  const typeText = (it) => modTL(it.type, lang) + (it.type === "qty" ? ((Number(it.after?.qty) || 0) > (Number(it.before?.qty) || 0) ? " (+)" : " (−)") : "");
  const itemRow = (it, extra = {}) => ({
    ...extra,
    [L("ลำดับ", "#")]: it.seq, "Part No.": it.part_no || "", [L("การแก้ไข", "Change")]: typeText(it),
    [L("จำนวนก่อน", "Qty before")]: it.before?.qty ?? "", [L("จำนวนหลัง", "Qty after")]: it.after?.qty ?? "",
    [L("INV ก่อน", "INV before")]: it.before?.inv || "", [L("INV หลัง", "INV after")]: it.after?.inv || "",
    [L("ทำแล้วตอนแก้ (ชิ้น)", "Made at the time (pcs)")]: it.before?.produced ?? "",
    [L("ปลายทาง (Transfer)", "Target (transfer)")]: it.type === "transfer" ? `${it.after?.to_part_no || ""} · ${it.after?.to_release_order || ro}` : "",
    [L("รายละเอียด", "Details")]: modNoteText(it.note, lang) || "",
    [L("QR (ใบ)", "QR (count)")]: Array.isArray(it.after?.qr) ? it.after.qr.length : 0,
  });
  const partRows = (list, changed) => list.map((r) => ({
    "Part No.": r.part_no || "", [L("จำนวน", "Qty")]: Number(r.qty) || 0,
    [L("ความยาว/ชิ้น (มม.)", "Length/pc (mm)")]: r.length_mm != null && r.length_mm !== "" ? Number(r.length_mm) : "",
    [L("น้ำหนัก/ชิ้น (กก.)", "Weight/pc (kg)")]: r.unit_weight ? w2(r.unit_weight) : "",
    [L("น้ำหนักรวม (กก.)", "Total weight (kg)")]: r.unit_weight ? w2((Number(r.qty) || 0) * Number(r.unit_weight)) : "",
    "INV Code": r.inv || "",
    [L("สถานะ", "Status")]: r.status === "cancelled" ? L("ยกเลิก", "Cancelled") : r.status === "moved" ? L("ย้ายหมดแล้ว", "All moved") : "",
    ...(changed ? { [L("แก้ใน M นี้", "Changed in this M")]: changed.has(r.release_id) ? "✓" : "" } : {}),
  }));
  const qrAct = (it) => (it.type === "qty" ? ((Number(it.after?.qty) || 0) > (Number(it.before?.qty) || 0) ? L("เพิ่มใหม่", "New") : L("ยกเลิก (ลดจำนวน)", "Cancelled (qty reduced)"))
    : it.type === "cancel" ? L("ยกเลิก (ยกเลิก Part)", "Cancelled (part cancelled)")
    : it.type === "transfer" ? L(`ย้ายไป ${it.after?.to_part_no || ""} · ${it.after?.to_release_order || ro}`, `Moved to ${it.after?.to_part_no || ""} · ${it.after?.to_release_order || ro}`) : "");
  const qrUndo = (type, it) => (type === "qty" ? ((Number(it.after?.qty) || 0) > (Number(it.before?.qty) || 0) ? L("ยกเลิก (ยกเลิก M)", "Cancelled (M cancelled)") : L("คืน (ยกเลิก M)", "Restored (M cancelled)"))
    : type === "cancel" ? L("คืน (ยกเลิก M)", "Restored (M cancelled)") : type === "transfer" ? L("ย้ายกลับ (ยกเลิก M)", "Moved back (M cancelled)") : "");
  const qrRows = (m) => {
    const out = [];
    const bySeq = new Map((m.items || []).map((it) => [it.seq, it]));
    (m.items || []).forEach((it) => (Array.isArray(it.after?.qr) ? it.after.qr : []).forEach((q) => out.push({ QR: q, "Part No.": it.part_no || "", [L("การกระทำ", "Action")]: qrAct(it), [L("เวอร์ชัน", "Version")]: m.version })));
    ((m.reverted?.detail?.items) || []).forEach((x) => (Array.isArray(x.qr) ? x.qr : []).forEach((q) => out.push({ QR: q, "Part No.": x.part_no || "", [L("การกระทำ", "Action")]: qrUndo(x.type, bySeq.get(x.seq) || {}), [L("เวอร์ชัน", "Version")]: L(`ยกเลิก ${m.version}`, `${m.version} cancelled`) })));
    return out;
  };
  const tagRO = String(ro || "RO").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
  const relDay = (releases || []).map((r) => String(r.release_date || "").slice(0, 10)).filter(Boolean).sort()[0] || "";
  const dateLogText = (m) => (m.date_log || []).map((x) => `${x.target === "revert" ? L("วันที่ยกเลิก", "cancel date") : L("วันที่ M", "M date")} ${fmtYmd(x.old_date)} → ${fmtYmd(x.new_date)} (${x.actor_name || "-"} ${fmtDT(x.at)}${x.note ? " · " + x.note : ""})`).join(" | ");

  if (version === "ALL") {
    const hist = mods.map((m) => ({
      [L("เวอร์ชัน", "Version")]: m.version, [L("วันที่ M", "M date")]: fmtYmd(modDocDate(m)), [L("สถานะ", "Status")]: statusOf(m), [L("ลงแอปเมื่อ", "Entered")]: fmtDT(m.created_at),
      [L("ผู้แก้", "By")]: m.actor_name || "", [L("เหตุผล", "Reason")]: m.reason || "", [L("รายการ", "Changes")]: (m.items || []).length,
      "Part": [...new Set((m.items || []).map((i) => i.part_no))].join(", "),
      [L("วันที่ยกเลิก", "Cancel date")]: m.reverted ? fmtYmd(revDocDate(m.reverted)) : "", [L("ยกเลิก — ลงแอปเมื่อ", "Cancel entered")]: m.reverted ? fmtDT(m.reverted.at) : "",
      [L("ผู้ยกเลิก", "Cancelled by")]: m.reverted?.actor_name || "",
      [L("เหตุผลที่ยกเลิก", "Cancel reason")]: m.reverted?.reason || "", [L("วิธี", "How")]: howOf(m.reverted),
      [L("ประวัติแก้วันที่", "Date changes")]: dateLogText(m),
    }));
    hist.push({ [L("เวอร์ชัน", "Version")]: M0, [L("วันที่ M", "M date")]: relDay ? fmtYmd(relDay) + L(" (ปล่อยงาน)", " (release)") : "", [L("สถานะ", "Status")]: L("ต้นฉบับ (ล็อก)", "Original (locked)"), [L("ลงแอปเมื่อ", "Entered")]: info?.origin ? fmtDT(info.origin.created_at) : "",
      [L("ผู้แก้", "By")]: info?.origin?.actor_name || "", [L("เหตุผล", "Reason")]: L("ค่าก่อนการแก้ไขครั้งแรก", "Values before the first change") });
    const all = [];
    mods.forEach((m) => [...(m.items || [])].sort((a, b) => a.seq - b.seq).forEach((it) => all.push(itemRow(it, { [L("เวอร์ชัน", "Version")]: m.version, [L("วันที่ M", "M date")]: fmtYmd(modDocDate(m)), [L("สถานะ M", "M status")]: m.reverted ? L("ยกเลิกแล้ว", "Cancelled") : L("ใช้อยู่", "Active") }))));
    const nowRows = (releases || []).map((r) => ({
      release_id: r.id, part_no: r.part_master?.part_no, qty: r.qty, length_mm: r.length_mm ?? r.part_master?.default_length_mm,
      unit_weight: r.unit_weight ?? r.part_master?.unit_weight, inv: r.part_master?.material || r.material,
      status: r.mod_cancelled_at ? (r.mod_cancel_keep === "moved" ? "moved" : "cancelled") : "",
    }));
    const qrs = mods.flatMap(qrRows);
    return {
      name: `modify-${tagRO}-all.xlsx`,
      sheets: [
        { name: L("ประวัติ", "History"), rows: hist },
        ...(all.length ? [{ name: L("รายการแก้ไขทั้งหมด", "All changes"), rows: all }] : []),
        { name: L(`Part ปัจจุบัน (${cur})`, `Current parts (${cur})`), rows: partRows(nowRows) },
        ...(qrs.length ? [{ name: "QR", rows: qrs }] : []),
      ],
    };
  }
  if (version === M0) {
    const rows = modStateAt(info, releases, ro, M0);
    return {
      name: `modify-${tagRO}-${M0}.xlsx`,
      sheets: [
        { name: L("สรุป", "Summary"), rows: kv([
          [L("โปรเจค", "Project"), [pj.code, pj.name].filter(Boolean).join(" — ")], ["Release Order", ro], [L("เวอร์ชัน", "Version"), M0],
          [L("สถานะ", "Status"), L("ต้นฉบับ — ก่อนการแก้ไข (ล็อกเป็นหลักฐาน)", "Original — before any change (locked)")],
          [L("วันที่ปล่อยงาน", "Release date"), relDay ? fmtYmd(relDay) : ""],
          [L("บันทึกต้นฉบับลงแอปเมื่อ", "Original saved"), info?.origin ? fmtDT(info.origin.created_at) : L("ยังไม่เคย Modify (ค่าปัจจุบัน)", "Never modified (current values)")],
          [L("จำนวน Part", "Parts"), rows.length], [L("จำนวนรวม (ชิ้น)", "Total qty (pcs)"), rows.reduce((a, r) => a + (Number(r.qty) || 0), 0)],
          [L("เวอร์ชันปัจจุบันของใบ", "Current version of this RO"), cur], [L("Export เมื่อ", "Exported"), fmtDT(new Date().toISOString())],
        ]) },
        { name: L(`Part ณ ${M0}`, `Parts at ${M0}`), rows: partRows(rows) },
      ],
    };
  }
  const m = mods.find((x) => x.version === version);
  if (!m) return null;
  const idx = mods.findIndex((x) => x.version === version);
  const prevV = mods[idx + 1] ? mods[idx + 1].version : M0;
  const items = [...(m.items || [])].sort((a, b) => a.seq - b.seq);
  const changed = new Set(items.flatMap((i) => [i.release_id, i.after?.to_release_id].filter(Boolean)));
  const st = modStateAt(info, releases, ro, version);
  const qrs = qrRows(m);
  return {
    name: `modify-${tagRO}-${version}.xlsx`,
    sheets: [
      { name: L("สรุป", "Summary"), rows: kv([
        [L("โปรเจค", "Project"), [pj.code, pj.name].filter(Boolean).join(" — ")], ["Release Order", ro], [L("เวอร์ชัน", "Version"), m.version],
        [L("วันที่ M (ตามเอกสาร)", "M date (document)"), fmtYmd(modDocDate(m)) + (m.doc_date ? "" : L(" (ไม่ได้ระบุ = วันที่ลงแอป)", " (not set = entry date)"))],
        [L("สถานะ", "Status"), statusOf(m)], [L("บันทึกลงแอปเมื่อ", "Entered in the app"), fmtDT(m.created_at)], [L("ผู้แก้", "By"), m.actor_name || ""],
        [L("เหตุผล", "Reason"), m.reason || ""], [L("จำนวนรายการ", "Changes"), items.length],
        [L("จำนวน Part ที่แก้", "Parts changed"), new Set(items.map((i) => i.part_no)).size], [L("เทียบกับ (ค่าก่อนแก้)", "Compared with (before)"), prevV],
        m.reverted && [L("วันที่ยกเลิก (ตามเอกสาร)", "Cancel date (document)"), fmtYmd(revDocDate(m.reverted))],
        m.reverted && [L("ยกเลิก — ลงแอปเมื่อ", "Cancel entered in the app"), fmtDT(m.reverted.at)],
        m.reverted && [L("ผู้ยกเลิก", "Cancelled by"), m.reverted.actor_name || ""],
        m.reverted && [L("เหตุผลที่ยกเลิก", "Cancel reason"), m.reverted.reason || ""],
        m.reverted && [L("วิธียกเลิก", "How"), howOf(m.reverted)],
        (m.date_log || []).length > 0 && [L("ประวัติแก้วันที่", "Date changes"), dateLogText(m)],
        [L("เวอร์ชันปัจจุบันของใบ", "Current version of this RO"), cur], [L("Export เมื่อ", "Exported"), fmtDT(new Date().toISOString())],
      ]) },
      { name: L("รายการแก้ไข", "Changes"), rows: items.map((it) => itemRow(it)) },
      { name: L(`Part ณ ${m.version}`, `Parts at ${m.version}`), rows: partRows(st, changed) },
      ...(qrs.length ? [{ name: "QR", rows: qrs }] : []),
    ],
  };
}

// ── ยืนยันการยกเลิก M / ย้อนกลับ (ตรวจผลก่อนด้วย dry-run → ใส่เหตุผล → ยืนยัน) ──
function ReleaseRevertModal({ mode, version, projectId, releaseOrder, mods, current, onClose, onDone, onSwitch }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const [pv, setPv] = useState(null);        // ผล dry-run
  const [reason, setReason] = useState("");
  const [revDate, setRevDate] = useState(todayYmd());   // ★ วันที่ยกเลิกตามเอกสาร
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    setPv(null); setErr("");
    revertReleaseModify({ projectId, releaseOrder, mode, version, dryRun: true })
      .then((r) => { if (alive) setPv(r || { ok: false, reason: "error" }); })
      .catch((e) => { if (alive) setPv({ ok: false, reason: "error", message: String(e?.message || e) }); });
    return () => { alive = false; };
  }, [projectId, releaseOrder, mode, version]);
  const m = (mods || []).find((x) => x.version === version);
  const below = (mods || []).filter((x) => !x.reverted && m && Number(x.version_no) < Number(m.version_no)).sort((a, b) => b.version_no - a.version_no)[0];
  const suggest = below ? below.version : M0;
  const title = mode === "cancel" ? L(`ยกเลิก ${version}`, `Cancel ${version}`)
    : version === M0 ? L(`ย้อนกลับเป็นต้นฉบับ (${M0})`, `Roll back to the original (${M0})`) : L(`ย้อนกลับเป็น ${version}`, `Roll back to ${version}`);
  const sub = mode === "cancel"
    ? L(`ย้อนเฉพาะการแก้ใน ${version} · ${version} ยังอยู่ในประวัติ (ขึ้นว่า “ยกเลิกแล้ว”) · เลข ${version} จะไม่ถูกนำกลับมาใช้ซ้ำ`, `Undo only the changes in ${version} · ${version} stays in the history (marked “cancelled”) · the number ${version} won't be reused`)
    : L(`ยกเลิกทุก M ที่ใหม่กว่า ${version} ทีเดียว (ไล่จาก M ล่าสุดลงมา) · ทุก M ยังอยู่ในประวัติ`, `Cancel every M newer than ${version} at once (newest first) · all of them stay in the history`);
  const ok = !!(pv && pv.ok);
  const revDateErr = !revDate ? L("เลือกวันที่ยกเลิก", "Pick the cancel date") : revDate > todayYmd() ? L("วันที่ต้องไม่เกินวันนี้", "The date can't be in the future") : "";
  const newestM = (pv?.reverted || []).map((x) => (mods || []).find((mm) => mm.version === x.version)).filter(Boolean).map(modDocDate).sort().slice(-1)[0] || "";
  const revDateWarn = !revDateErr && newestM && revDate < newestM ? L(`ก่อนวันที่ของ M ที่จะยกเลิก (${fmtYmd(newestM)})`, `before the date of the M being cancelled (${fmtYmd(newestM)})`) : "";
  const canSave = ok && !!reason.trim() && !busy && !revDateErr;
  async function submit() {
    if (!canSave) return;
    setBusy(true); setErr("");
    const r = await revertReleaseModify({ projectId, releaseOrder, mode, version, reason: reason.trim(), dryRun: false, docDate: revDate });
    setBusy(false);
    if (!r || !r.ok) { setErr(modErrText(r, lang)); return; }
    auditRecord("release_modify_revert", "release_order", releaseOrder, { mode, version, current: r.current, reverted: (r.reverted || []).map((x) => x.version), project_id: projectId, reason: reason.trim(), doc_date: revDate });
    mlsToast(L(`${(r.reverted || []).map((x) => fmtM(x.version)).join(", ")} ถูกยกเลิกแล้ว · ตอนนี้ ${fmtM(r.current)}`, `${(r.reverted || []).map((x) => fmtM(x.version)).join(", ")} cancelled · now ${fmtM(r.current)}`), "success");
    onDone && onDone(r);
  }
  return (
    <Modal wide onClose={onClose} locked={busy} title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>↩ {title}</span>} sub={sub}>
      {!pv ? (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "10px 2px" }}>{L("กำลังตรวจว่าย้อนได้ไหม…", "Checking whether this can be undone…")}</div>
      ) : !pv.ok ? (
        <div className="relmod-err">
          <b>{L("ยกเลิกไม่ได้", "Can't cancel")}</b>
          <div style={{ marginTop: 4 }}>{modErrText(pv, lang)}</div>
          {pv.reason === "revert_conflict" && mode === "cancel" && onSwitch && (
            <div style={{ marginTop: 10 }}>
              <Btn variant="ghost" size="sm" onClick={() => onSwitch("rollback", suggest)}>↩ {suggest === M0 ? L("ย้อนกลับเป็นต้นฉบับแทน", "Roll back to the original instead") : L(`ย้อนกลับเป็น ${suggest} แทน`, `Roll back to ${suggest} instead`)}</Btn>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontWeight: 700, margin: "2px 0 8px" }}>{L("สิ่งที่จะเกิด", "What will happen")}</div>
          <div className="relmod-rv-list">
            {(pv.reverted || []).map((x) => (
              <div key={x.version} className="relmod-rv-m">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><ModVerPill v={x.version} /> <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{L("→ ยกเลิก", "→ cancelled")}</span></div>
                {(x.items || []).map((it) => (
                  <div key={it.seq} className="relmod-rv-it"><b style={{ fontFamily: "var(--font-mono)" }}>{it.part_no}</b> <ModChip type={it.type} /> {modNoteText(it.note, lang)}</div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 4px", fontSize: 12.5 }}>
            {pv.restored_qr > 0 && <span className="relmod-rv-chip">{L(`คืน QR ${pv.restored_qr} ใบ`, `${pv.restored_qr} QR restored`)}</span>}
            {pv.cancelled_qr > 0 && <span className="relmod-rv-chip bad">{L(`ยกเลิก QR ${pv.cancelled_qr} ใบ`, `${pv.cancelled_qr} QR cancelled`)}</span>}
            {pv.moved_back > 0 && <span className="relmod-rv-chip">{L(`ย้ายกลับ ${pv.moved_back} ชิ้น`, `${pv.moved_back} pcs moved back`)}</span>}
            <span className="relmod-rv-chip now">{L("ตอนนี้", "Now")} {fmtM(current)} → <b>{fmtM(pv.current)}</b></span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 12px", lineHeight: 1.55 }}>
            {L("QR ที่คืน = ป้ายเดิมสแกนได้ต่อ · QR ที่ถูกยกเลิก = ถ้าพิมพ์ป้ายไปแล้ว ให้แยกป้าย/ชิ้นนั้นออก (หน้าเครื่องจะแจ้งว่าถูกยกเลิก) · งานที่บันทึกไปแล้วไม่ถูกแตะ",
               "Restored QR = the old labels scan again · Cancelled QR = if labels were printed, set them aside (the station will say they're cancelled) · recorded work is not touched")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600 }}>📅 {L("วันที่ยกเลิก (ตามเอกสาร)", "Cancel date (per document)")}</label>
            <input type="date" className="relmod-date" value={revDate} max={todayYmd()} onChange={(e) => setRevDate(e.target.value)} disabled={busy} style={{ borderColor: revDateErr ? "var(--danger)" : undefined }} />
            <span style={{ fontSize: 11.5, color: revDateErr ? "var(--danger)" : revDateWarn ? "#b45309" : "var(--muted)", fontWeight: revDateErr || revDateWarn ? 600 : 400 }}>
              {revDateErr ? "⚠ " + revDateErr : revDateWarn ? "⚠ " + revDateWarn : revDate !== todayYmd() ? L("ลงแอปวันนี้ · วันที่ตามเอกสารคือวันที่เลือก", "entered today · the document date is the one picked") : L("ไม่ใช่วันนี้? เลือกวันที่ตามเอกสาร", "Not today? pick the document date")}
            </span>
          </div>
          <label style={{ fontSize: 12.5, fontWeight: 600 }}>{L("เหตุผลที่ยกเลิก (บังคับ)", "Reason (required)")}</label>
          <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}
            placeholder={L("เช่น ลูกค้าแจ้งกลับไปใช้แบบเดิม", "e.g. customer went back to the previous drawing")} style={{ width: "100%", marginTop: 4, resize: "vertical" }} />
        </>
      )}
      {err && <div className="relmod-err" style={{ marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{L("ปิด", "Close")}</Btn>
        {ok && (
          <Btn variant="danger" onClick={submit} disabled={!canSave}>
            {busy ? L("กำลังบันทึก…", "Saving…") : mode === "cancel" ? L(`ยืนยัน · ยกเลิก ${version}`, `Confirm · cancel ${version}`) : L(`ยืนยัน · ย้อนกลับเป็น ${version}`, `Confirm · roll back to ${version}`)}
          </Btn>
        )}
      </div>
      {ok && !reason.trim() && <div style={{ textAlign: "right", fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{L("ใส่เหตุผลก่อนยืนยัน", "Enter a reason to confirm")}</div>}
    </Modal>
  );
}

// ══ เครื่องจักรต่อเบอร์ + สถานะ (ตาราง Part ของ Release) ══════════════════════════════
//   ข้อมูล: release_machine_status (migration-part-machine-status.sql) — ยอด/เวลา/พนักงาน ต่อ (เบอร์, เครื่อง)
//          + "งานที่กำลังทำ" ที่หน้าเครื่องแจ้งตอนสแกนรอบแรก (ล้างเมื่อกด OK / ยกเลิก)
//   ต่อเครื่อง: กำลังทำ (สแกนรอบแรกแล้ว ยังไม่ OK) = In Process · กด Finished หรือ ทำครบจำนวนสั่ง = Finish
//              · นอกนั้น (ทำไปบางส่วน รอชุดถัดไป) = In Process Balance
//   ต่อเบอร์ : ไม่มีเครื่อง = Pending · มีเครื่องกำลังทำ = In Process · ทุกเครื่อง Finish = Finish · นอกนั้น = In Process Balance
const PM_ST = { pend: "Pending", run: "In Process", bal: "In Process Balance", fin: "Finish" };
const PM_ORDER = ["pend", "run", "bal", "fin"];
const PM_COLOR = { pend: "#9aa8a2", run: "#2563eb", bal: "#d97706", fin: "#10b981" };
function pmMachines(list, qty) {
  const q = Number(qty) || 0;
  return (Array.isArray(list) ? list : []).map((m) => {
    const done = Number(m.done) || 0;
    const st = m.active ? "run" : (m.finished || (q > 0 && done >= q)) ? "fin" : "bal";
    return { ...m, done, st, bal: Math.max(0, q - done), over: Math.max(0, done - q) };
  });
}
function pmRowStatus(ms, prog) {
  if (!ms.length) {
    // ไม่มีงานหน้าเครื่อง แต่มียอดจากการสแกนออฟฟิศแบบเดิม → ไม่ขึ้น Pending หลอก
    if (prog && prog.total > 0 && prog.done >= prog.total) return "fin";
    if (prog && prog.done > 0) return "bal";
    return "pend";
  }
  if (ms.some((m) => m.st === "run")) return "run";
  if (ms.every((m) => m.st === "fin")) return "fin";
  return "bal";
}
const pmPad = (n) => String(n).padStart(2, "0");
function pmDur(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  return `${pmPad(Math.floor(s / 3600))}:${pmPad(Math.floor((s % 3600) / 60))}:${pmPad(s % 60)}`;
}
// เวลาสั้น: วันนี้ = HH:mm · วันอื่น = DD/MM HH:mm
function pmClock(iso, nowMs) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const n = new Date(nowMs || Date.now());
  const hm = `${pmPad(d.getHours())}:${pmPad(d.getMinutes())}`;
  return d.toDateString() === n.toDateString() ? hm : `${pmPad(d.getDate())}/${pmPad(d.getMonth() + 1)} ${hm}`;
}
function pmAgo(ms, lang) {
  const m = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  if (m < 1) return lang === "en" ? "<1m" : "ไม่ถึง 1 นาที";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (lang === "en") return [d ? `${d}d` : "", h ? `${h}h` : "", !d && mm ? `${mm}m` : ""].filter(Boolean).join(" ");
  return [d ? `${d} วัน` : "", h ? `${h} ชม.` : "", !d && mm ? `${mm} น.` : ""].filter(Boolean).join(" ");
}
// ข้อความช่อง "ตอนนี้" (ใช้ทั้งบนจอและใน Excel)
function pmNowText(m, qty, lang, nowMs) {
  const en = lang === "en";
  if (m.st === "run") {
    const a = m.active || {};
    const t0 = a.started_at ? new Date(a.started_at).getTime() : NaN;
    const el = isNaN(t0) ? "-" : pmDur((nowMs - t0) / 1000);
    const n = (Number(m.batches) || 0) + 1;
    return en ? `running batch ${n} · started ${pmClock(a.started_at, nowMs)} · ${el} elapsed`
              : `กำลังทำชุดที่ ${n} · เริ่ม ${pmClock(a.started_at, nowMs)} · ผ่านไป ${el}`;
  }
  if (m.st === "fin") {
    const how = m.finished ? (en ? "Finished pressed" : "กด Finished") : (en ? "full qty" : "ครบจำนวน");
    const over = m.over > 0 ? (en ? ` · +${fmtNum(m.over)} spare` : ` · เกิน ${fmtNum(m.over)} (สแปร์)`) : "";
    return `${how} · ${en ? "done" : "เสร็จ"} ${pmClock(m.last_at, nowMs)}${over}`;
  }
  const idle = m.last_at ? pmAgo(nowMs - new Date(m.last_at).getTime(), lang) : "-";
  return en ? `paused · ${fmtNum(m.done)} of ${fmtNum(qty)} made · ${fmtNum(m.bal)} to go · idle ${idle}`
            : `พักอยู่ · ทำไป ${fmtNum(m.done)} จาก ${fmtNum(qty)} · รออีก ${fmtNum(m.bal)} ชิ้น · หยุดมาแล้ว ${idle}`;
}
const pmOps = (m) => {
  const names = (Array.isArray(m.ops) ? m.ops : []).map((o) => o && o.name).filter(Boolean);
  const act = (m.active && Array.isArray(m.active.ops)) ? m.active.ops : [];
  return [...new Set([...names, ...act])];
};
function PmPill({ k, sm }) {
  return <span className={`pm-st pm-st-${k}${sm ? " sm" : ""}`}>{k === "run" && <i className="pm-pulse" />}{PM_ST[k]}</span>;
}
// ชิปเครื่องใต้เบอร์ (สีตามสถานะของเครื่อง) — กด = เปิด/ปิดตารางเครื่อง (ไม่เปิดป็อปอัปของแถว)
function PmChips({ ms, qty, open, onToggle, lang }) {
  const en = lang === "en";
  if (!ms.length) return <span className="pm-none">{en ? "no machine yet" : "ยังไม่มีเครื่อง"}</span>;
  const stop = (e) => { e.stopPropagation(); onToggle(); };
  return (
    <>
      {ms.map((m) => (
        <button type="button" key={m.machine_id || m.code} className={`pm-mchip ${m.st}`} onClick={stop}
          title={`${m.code || "?"} · ${PM_ST[m.st]} · ${fmtNum(m.done)}/${fmtNum(qty)}`}>
          <i />{m.code || "?"}
        </button>
      ))}
      <button type="button" className={"pm-toggle" + (open ? " open" : "")} onClick={stop}
        aria-expanded={open} title={en ? "Show / hide each machine" : "เปิด/ปิด รายละเอียดแต่ละเครื่อง"}>
        <span className="ar">▶</span>{open ? (en ? "hide" : "ซ่อน") : (en ? `${ms.length} machine${ms.length > 1 ? "s" : ""}` : `${ms.length} เครื่อง`)}
      </button>
    </>
  );
}
// ตารางเครื่องใต้แถว (เปิดขยาย)
function PmDetail({ r, ms, qty, lang, nowMs }) {
  const en = lang === "en";
  const L = (th, e) => (en ? e : th);
  const pn = r.part_master?.part_no || "";
  return (
    <div className="pm-dbox" onClick={(e) => e.stopPropagation()}>
      <div className="pm-dbox-h">{L(`เครื่องที่ทำ ${pn}`, `Machines on ${pn}`)}
        <span>· {L(`${ms.length} เครื่อง · เรียงตามเวลาที่เริ่มทำ · สั่ง ${fmtNum(qty)} ชิ้น`, `${ms.length} machine(s) · in order started · ordered ${fmtNum(qty)} pcs`)}</span></div>
      <div className="pm-subwrap">
        <table className="pm-sub">
          <thead><tr>
            <th>{L("เครื่อง", "Machine")}</th><th>{L("ขั้นตอน", "Steps")}</th><th>{L("สถานะ", "Status")}</th>
            <th className="num">{L("ทำแล้ว / สั่ง", "Done / ordered")}</th><th className="num">Balance</th>
            <th className="num">{L("เวลาทำงานรวม", "Run time")}</th><th>{L("เริ่ม", "Start")}</th><th>{L("ล่าสุด", "Last")}</th>
            <th className="num">{L("ชุดที่เสร็จ", "Batches")}</th><th>{L("ตอนนี้", "Now")}</th>
          </tr></thead>
          <tbody>
            {ms.map((m) => {
              const ops = Array.isArray(m.ops) ? m.ops : [];
              const uniform = ops.every((o) => (Number(o.done) || 0) === (Number(ops[0]?.done) || 0));
              const actOps = (m.active && Array.isArray(m.active.ops)) ? m.active.ops.filter((n) => !ops.some((o) => o.name === n)) : [];
              const pct = qty > 0 ? Math.min(100, (m.done / qty) * 100) : (m.done > 0 ? 100 : 0);
              return (
                <tr key={m.machine_id || m.code}>
                  <td data-label={L("เครื่อง", "Machine")}><span><span className={`pm-mchip ${m.st} static`}><i />{m.code || "?"}</span>{m.name ? <span className="pm-mname">{m.name}</span> : null}</span></td>
                  <td data-label={L("ขั้นตอน", "Steps")}><span>
                    {ops.map((o) => <span key={o.name} className="pm-opc" title={`${o.name} · ${fmtNum(o.done)} ${L("ชิ้น", "pcs")}`}>{o.name}{!uniform ? <b> {fmtNum(o.done)}</b> : null}</span>)}
                    {actOps.map((n) => <span key={"a" + n} className="pm-opc" title={L("ขั้นตอนของงานที่กำลังทำ", "step of the running job")}>{n}</span>)}
                    {!ops.length && !actOps.length ? <span className="pm-none">-</span> : null}
                  </span></td>
                  <td data-label={L("สถานะ", "Status")}><PmPill k={m.st} /></td>
                  <td className="num" data-label={L("ทำแล้ว / สั่ง", "Done / ordered")}>
                    <span><span className="pm-mini"><i style={{ width: `${pct}%`, background: PM_COLOR[m.st] }} /></span><b>{fmtNum(m.done)}</b> / {fmtNum(qty)}</span>
                  </td>
                  <td className="num" data-label="Balance"><span>
                    <span className={"pm-balv " + (m.bal > 0 ? (m.st === "fin" ? "muted" : "pos") : "zero")}
                      title={m.bal > 0 && m.st === "fin" ? L("เครื่องนี้กด Finished แล้ว (อาจแบ่งงานกับเครื่องอื่น)", "this machine pressed Finished (work may be split with another machine)") : undefined}>{fmtNum(m.bal)}</span>
                    {m.over > 0 ? <span className="pm-over"> +{fmtNum(m.over)}</span> : null}
                  </span></td>
                  <td className="num mono" data-label={L("เวลาทำงานรวม", "Run time")}>{pmDur(m.run_seconds)}</td>
                  <td className="mono" data-label={L("เริ่ม", "Start")} title={m.first_at ? fmtDT(m.first_at) : ""}>{pmClock(m.first_at || m.active?.started_at, nowMs)}</td>
                  <td className="mono" data-label={L("ล่าสุด", "Last")} title={m.last_at ? fmtDT(m.last_at) : ""}>{pmClock(m.last_at, nowMs)}</td>
                  <td className="num" data-label={L("ชุดที่เสร็จ", "Batches")}>{fmtNum(m.batches || 0)}</td>
                  <td className="pm-nowc" data-label={L("ตอนนี้", "Now")}><span className={`pm-live ${m.st}`}>{pmNowText(m, qty, lang, nowMs)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Export: 1 แถว = 1 เบอร์ + 1 เครื่อง (sort/filter ใน Excel ง่าย) ──
//   rows: [{ r, ms, st, p }] ตามลำดับบนจอ (กรองแล้ว) · p = ความคืบหน้าของเบอร์ (rowProg)
//   exceljs (มีใน package.json) → ชนิดข้อมูลจริง: ตัวเลข · วันเวลา · ระยะเวลา [h]:mm:ss · ตรึงหัว + 3 คอลัมน์ · ตัวกรองหัวคอลัมน์ · สีสถานะ
//   ถ้าโหลด exceljs ไม่ได้ → ใช้ downloadSheets เดิม (ค่าเป็นข้อความ/ตัวเลข)
async function pmExportExcel({ rows, lang, ro, isAsm, filterKeys, fileName, itemNo }) {
  const en = lang === "en";
  const L = (th, e) => (en ? e : th);
  const nowMs = Date.now();
  const MACH = [L("เครื่อง", "Machine"), L("สถานะเครื่อง", "Machine status"), L("ขั้นตอน", "Steps"), L("จำนวน (สั่ง)", "Qty (ordered)"),
    L("ทำแล้ว (เครื่องนี้)", "Done (this machine)"), L("Balance (เครื่องนี้)", "Balance (this machine)"), L("เวลาทำงานรวม", "Run time"),
    L("เริ่ม", "Start"), L("ล่าสุด", "Last"), L("ชุดที่เสร็จ", "Batches"), L("ตอนนี้", "Now")];
  const PART = [L("สถานะเบอร์", "Part status"), L("เสร็จแล้ว (เบอร์)", "Finished (part)"), L("เกิน (สแปร์)", "Spare (over)"), L("กำลังทำ", "In progress"),
    L("ความคืบหน้า (%)", "Progress (%)"),
    ...(!isAsm ? [L("น้ำหนัก/ชิ้น (กก.)", "Weight/pc (kg)"), L("น้ำหนักรวม (กก.)", "Total weight (kg)")] : []),
    L("ความยาว/ชิ้น (มม.)", "Length/pc (mm)"), "INV Code", L("Mat. Length (มม.)", "Mat. Length (mm)"), L("หมายเหตุ", "Remark"), "Modify"];
  const HEAD = [L("ลำดับ", "Item"), L("เบอร์พาร์ท", "Part No."), ...MACH, ...PART];
  const nM = MACH.length;
  // ค่าแต่ละแถว (ชนิดจริง) — วันเวลาเป็น Date · ระยะเวลาเป็นวินาที (แปลงตอนเขียน)
  const out = [];
  rows.forEach(({ r, ms, st, p, matLen }, idx) => {
    const qty = Number(r.qty) || 0;
    const done = p.done ?? p.finished ?? 0;
    const total = p.total || qty;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const uw = Number(r.unit_weight) || 0;
    const partVals = [PM_ST[st], done, p.over || null, p.inProgress || null, pct,
      ...(!isAsm ? [uw ? Math.round(uw * 100) / 100 : null, uw ? Math.round(uw * qty * 100) / 100 : null] : []),
      r.length_mm ? Number(r.length_mm) : null, r.part_master?.material || r.material || "",
      matLen.length === 1 ? Number(matLen[0]) : (matLen.length ? matLen.map((n) => fmtNum(n)).join(" · ") : null),
      r.note || "", (r.mod_version ? fmtM(r.mod_version) : "") + (r.mod_cancelled_at ? (r.mod_cancel_keep === "moved" ? L(" · ย้ายหมดแล้ว", " · all moved") : L(" · ยกเลิก", " · cancelled")) : "")];
    const no = itemNo ? itemNo(r, idx) : idx + 1;
    const pn = r.part_master?.part_no || "";
    if (!ms.length) {
      out.push({ st: null, pst: st, vals: [no, pn, "", "", "", qty, null, null, null, null, null, null,
        st === "pend" ? L("ยังไม่มีเครื่องเริ่ม", "no machine started yet") : L("ไม่มีงานหน้าเครื่อง (ยอดจากการสแกนออฟฟิศ)", "no machine work (office scan totals)"), ...partVals] });
      return;
    }
    ms.forEach((m) => {
      const first = m.first_at || m.active?.started_at || null;
      out.push({ st: m.st, pst: st, bal: m.bal, vals: [no, pn, m.code || "", PM_ST[m.st], pmOps(m).join(" · "), qty, m.done, m.bal,
        { dur: Number(m.run_seconds) || 0 }, first ? new Date(first) : null, m.last_at ? new Date(m.last_at) : null,
        Number(m.batches) || 0, pmNowText(m, qty, lang, nowMs), ...partVals] });
    });
  });
  const sheetName = L("รายการ Part", "Parts");
  const fDesc = filterKeys && filterKeys.length ? filterKeys.map((k) => PM_ST[k]).join(", ") : L("ทั้งหมด (ไม่กรอง)", "all (no filter)");
  const notes = [
    [L(`Export — รายละเอียดแต่ละ Part × เครื่องจักร${ro ? " (Release Order " + ro + ")" : ""}`, `Export — each Part × machine${ro ? " (Release Order " + ro + ")" : ""}`), true],
    [L(`สร้างเมื่อ ${fmtDT(new Date(nowMs).toISOString())} · ตัวกรองสถานะ: ${fDesc} · ${rows.length} เบอร์ · ${out.length} แถว`, `Created ${fmtDT(new Date(nowMs).toISOString())} · status filter: ${fDesc} · ${rows.length} parts · ${out.length} rows`), false],
    ["", false],
    [L("1 แถว = 1 เบอร์ + 1 เครื่อง · เบอร์ที่ผ่าน 2 เครื่อง = 2 แถว (ข้อมูลของเบอร์ซ้ำในทุกแถว → sort / filter ใน Excel ได้ทันที)", "1 row = 1 part + 1 machine · a part on 2 machines = 2 rows (part data repeats on every row → sort / filter in Excel directly)"), false],
    [L("เบอร์ที่ยังไม่มีเครื่องเริ่ม = 1 แถว ช่องเครื่องว่าง", "A part with no machine yet = 1 row with empty machine columns"), false],
    [L("Export ตามตัวกรองสถานะที่เลือกบนหน้าจอ (ไม่กรอง = ทั้งหมด) · เรียงตามที่เห็นบนจอ", "Follows the status filter on screen (no filter = all) · same order as on screen"), false],
    ["", false],
    [L("สถานะเครื่อง", "Machine status"), true],
    [L("In Process = สแกนรอบแรกแล้ว เวลากำลังเดิน (ยังไม่กด OK)", "In Process = first scan done, timer running (OK not pressed yet)"), false],
    [L("In Process Balance = ทำไปบางส่วน รอชุดถัดไป (ยังไม่สแกนรอบแรกของชุดต่อไป)", "In Process Balance = partly done, waiting for the next batch"), false],
    [L("Finish = ทำครบจำนวนสั่ง หรือกด Finished ที่หน้าเครื่อง", "Finish = full ordered qty done, or Finished pressed at the machine"), false],
    [L("สถานะเบอร์ = In Process ถ้ามีเครื่องกำลังทำ · Finish ถ้าทุกเครื่องเสร็จ · In Process Balance ถ้าเริ่มแล้วยังไม่ครบ · Pending ถ้ายังไม่มีเครื่องเริ่ม", "Part status = In Process if a machine is running · Finish if all machines are done · In Process Balance if started but not complete · Pending if no machine started"), false],
    ["", false],
    [L("คอลัมน์", "Columns"), true],
    [L("ทำแล้ว (เครื่องนี้) = ยอดของขั้นตอนที่มากสุดในเครื่องนั้น (ขั้นตอนที่ติ๊กร่วมไม่นับซ้ำ) · Balance = จำนวนสั่ง − ทำแล้ว", "Done (this machine) = the highest step total on that machine (co-ticked steps not double counted) · Balance = ordered − done"), false],
    [L("เวลาทำงานรวม = รวมเวลาที่จับได้ทุกชุดของเครื่องนั้น (ชม.:นาที:วินาที รวม/เรียงได้) · เริ่ม / ล่าสุด = วันเวลาจริง (เรียงได้)", "Run time = sum of timed batches on that machine ([h]:mm:ss, can be summed/sorted) · Start / Last = real date-times (sortable)"), false],
    [L("หัวคอลัมน์สีม่วง = ข้อมูลของเครื่อง · สีเข้ม = ข้อมูลของเบอร์", "Purple headers = machine data · dark headers = part data"), false],
  ];
  const FILL = { fin: ["FFE3F7EE", "FF047857"], run: ["FFE8EFFF", "FF1D4ED8"], bal: ["FFFFF4E0", "FF92400E"], pend: ["FFEEF2F0", "FF5B6B65"] };
  const iDur = 2 + 6, iStart = 2 + 7, iLast = 2 + 8, iPst = 2 + nM;   // 0-based index ใน vals
  let ExcelJS = null;
  try { const mod = await import("exceljs"); ExcelJS = mod.default || mod; } catch (e) { console.warn("exceljs load failed → fallback", e); }
  if (ExcelJS && ExcelJS.Workbook) {
    const wb = new ExcelJS.Workbook();
    wb.created = new Date(nowMs);
    const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
    const WID = [7, 14, 10, 19, 16, 12, 16, 16, 14, 17, 17, 11, 56, 19, 15, 12, 11, 15, ...(!isAsm ? [16, 16] : []), 17, 14, 16, 16, 12];
    ws.columns = HEAD.map((h, i) => ({ header: h, key: "c" + i, width: WID[i] || 14 }));
    const F = "Arial";
    const hr = ws.getRow(1);
    hr.height = 32;
    hr.eachCell((c, col) => {
      c.font = { name: F, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: (col >= 3 && col < 3 + nM) ? "FF6D4AFF" : "FF142420" } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    const local = (d) => (d instanceof Date && !isNaN(d.getTime())) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : null;   // exceljs เขียนเป็น UTC → ชดเชยให้ Excel เห็นเวลาไทย
    const numCols = new Set([5, 6, 7, 11, iPst + 1, iPst + 2, iPst + 3, iPst + 4]);   // 0-based
    const wCols = !isAsm ? new Set([iPst + 5, iPst + 6]) : new Set();
    const lenCol = iPst + (!isAsm ? 7 : 5), matCol = lenCol + 2;
    out.forEach((o) => {
      const vals = o.vals.map((v, i) => {
        if (v && typeof v === "object" && "dur" in v) return v.dur / 86400;
        if (i === iStart || i === iLast) return v ? local(v) : null;
        return v === "" ? null : v;
      });
      const row = ws.addRow(vals);
      row.eachCell({ includeEmpty: true }, (c, col) => {
        const i = col - 1;
        c.font = { name: F, size: 10, bold: i === 1 || i === 2 };
        c.alignment = { vertical: "middle" };
        c.border = { bottom: { style: "thin", color: { argb: "FFD7E3DD" } } };
        if (i === iDur) c.numFmt = "[h]:mm:ss";
        else if (i === iStart || i === iLast) c.numFmt = "dd/mm/yyyy hh:mm";
        else if (numCols.has(i)) c.numFmt = "#,##0";
        else if (wCols.has(i)) c.numFmt = "#,##0.00";
        else if (i === lenCol || i === matCol) c.numFmt = "#,##0.##";
      });
      if (o.st) {
        const [bg, fg] = FILL[o.st];
        const c = row.getCell(4);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        c.font = { name: F, size: 10, bold: true, color: { argb: fg } };
        if (o.bal > 0 && o.st !== "fin") row.getCell(8).font = { name: F, size: 10, bold: true, color: { argb: "FFB45309" } };
      }
      { const [bg, fg] = FILL[o.pst] || FILL.pend;
        const c = row.getCell(iPst + 1);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        c.font = { name: F, size: 10, bold: true, color: { argb: fg } }; }
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, out.length + 1), column: HEAD.length } };
    const n = wb.addWorksheet(L("อ่านก่อน", "Read me"));
    n.getColumn(1).width = 130;
    notes.forEach(([t, b]) => { const row = n.addRow([t]); row.getCell(1).font = { name: F, size: b ? 11 : 10, bold: b }; });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { rows: out.length, engine: "exceljs" };
  }
  // ── fallback: downloadSheets เดิม (ค่าเรียงได้: วันเวลา = yyyy-mm-dd hh:mm · ระยะเวลา = hh:mm:ss) ──
  const ymdhm = (d) => (d instanceof Date && !isNaN(d.getTime())) ? `${d.getFullYear()}-${pmPad(d.getMonth() + 1)}-${pmPad(d.getDate())} ${pmPad(d.getHours())}:${pmPad(d.getMinutes())}` : "";
  const flat = out.map((o) => {
    const obj = {};
    HEAD.forEach((h, i) => {
      const v = o.vals[i];
      obj[h] = (v && typeof v === "object" && "dur" in v) ? pmDur(v.dur) : (v instanceof Date ? ymdhm(v) : (v == null ? "" : v));
    });
    return obj;
  });
  const { downloadSheets } = await import("./excelExport.js");
  await downloadSheets(fileName, [{ name: sheetName, rows: flat }, { name: L("อ่านก่อน", "Read me"), rows: notes.map(([t]) => ({ [L("คำอธิบาย", "Notes")]: t })) }]);
  return { rows: out.length, engine: "downloadSheets" };
}

// จำตัวกรอง/แถวที่เปิดขยาย ต่อ Release Order ในเครื่องนี้ (สะดวก ไม่สำคัญ — อ่าน/เขียนพลาดก็ข้าม)
function pmUiLoad(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); if (v && typeof v === "object") return v; } catch { /* ignore */ }
  return null;
}
function pmUiSave(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

function ReleaseGroupDetail({ group, user, onBack, goTo, onHome, onChanged }) {
  const canEdit = isAdmin(user);   // เฉพาะ Admin เท่านั้นที่แก้ไข/ลบ Release ได้ (office เพิ่ม/นำเข้า/ดูได้ แต่แก้/ลบไม่ได้)
  const [lang] = useLang();        // แปลหัวคอลัมน์ที่เพิ่มเอง (ลำดับ/Item) ตามภาษา
  // สำเนา releases แบบ local เพื่อให้แก้ไข/ลบ สะท้อนทันทีในหน้านี้ (ยอดรวมคิดใหม่ตามนี้)
  const [releases, setReleases] = useState(group.releases);
  const [unitStats, setUnitStats] = useState({});
  const [opProg, setOpProg] = useState({});   // ความคืบหน้าแยกขั้นตอน (งานหน้าเครื่อง) ต่อ release
  const [matLens, setMatLens] = useState({}); // ความยาว material (หน้าเครื่อง) ต่อ release → { id: [len,...] }
  const [statsLoading, setStatsLoading] = useState(true);
  const [viewPart, setViewPart] = useState(null); // release row ที่กำลังดูความคืบหน้าแยกขั้นตอน
  const [editing, setEditing] = useState(null);   // release ที่กำลังแก้ไข
  const [busyId, setBusyId] = useState(null);     // release ที่กำลังลบ
  const [editHeader, setEditHeader] = useState(false);   // เปิดหน้าต่างแก้หัวเอกสาร (Modify/RO/วันที่)
  const [hdr, setHdr] = useState({ ro: group.releaseOrder, date: group.date });   // ค่าหัวเอกสารที่โชว์ (อัปเดตหลังบันทึก)
  const [exporting, setExporting] = useState(false);   // กำลังสร้างไฟล์ Excel ของตารางนี้
  const sort = useTableSort();
  const colApi = useRef(null);   // ปุ่มรีเซ็ตลำดับคอลัมน์ (DataTable ส่ง { reset } มาให้)
  // ── Modify (M-01, M-02 …) ──
  const projectId = releases[0]?.part_master?.project_id || null;
  const [modInfo, setModInfo] = useState(null);     // { origin, mods, limits, next_no } | { ok:false, reason }
  const [modOpen, setModOpen] = useState(false);
  const [modView, setModView] = useState(null);     // null | M0 | "M-03"
  const loadModInfo = useCallback(async () => {
    if (!projectId || !hdr.ro) { setModInfo(null); return; }
    const d = await getReleaseModifyInfo(projectId, hdr.ro);
    setModInfo(normModInfo(d));
  }, [projectId, hdr.ro]);
  useEffect(() => { loadModInfo(); }, [loadModInfo]);
  const modReady = !!(modInfo && modInfo.ok);
  const modList = modReady ? (modInfo.mods || []) : [];
  const activeMods = modList.filter((m) => !m.reverted);   // ★ M ที่ถูกยกเลิก ไม่นับเป็นเวอร์ชันปัจจุบัน
  const curVersion = (modReady && modInfo.current) || (activeMods.length ? modVer(Math.max(...activeMods.map((m) => Number(m.version_no) || 0))) : M0);
  const nCancelled = modList.length - activeMods.length;
  const hasNewerThan = (v) => { const n = Number(String(v).replace(/\D/g, "")) || 0; return activeMods.some((m) => (Number(m.version_no) || 0) > n); };
  const [revertReq, setRevertReq] = useState(null);   // { mode: "cancel"|"rollback", version }
  const [modExporting, setModExporting] = useState(false);
  async function exportMod(version) {
    if (modExporting || !modReady) return;
    setModExporting(true);
    try {
      const pack = modExportSheets({ info: modInfo, releases, ro: hdr.ro, version, lang });
      if (!pack) throw new Error("no data");
      const { downloadSheets } = await import("./excelExport.js");
      await downloadSheets(pack.name, pack.sheets);
    } catch (e) {
      console.warn("export modify excel error", e);
      mlsToast(lang === "en" ? "Export failed, please try again" : "สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    } finally { setModExporting(false); }
  }
  const modByVersion = (v) => modList.find((m) => m.version === v) || null;
  const prevOf = (v) => { const i = modList.findIndex((m) => m.version === v); return (i >= 0 && modList[i + 1]) ? modList[i + 1].version : M0; };
  function openModify() {
    if (!hdr.ro) { mlsToast(lang === "en" ? "Set a Release Order number first (via “Edit header”)" : "ต้องมีเลขที่ Release Order ก่อน (แก้ที่ “แก้ไขหัวเอกสาร”)", "warn"); return; }
    if (modInfo && modInfo.reason === "not_installed") { mlsToast(lang === "en" ? "Modify isn't installed — run migration-release-modify.sql in Supabase first" : "ยังไม่ได้ติดตั้งส่วน Modify — รัน migration-release-modify.sql ใน Supabase ก่อน", "error"); return; }
    if (!modReady) { mlsToast(lang === "en" ? "Loading Modify data… try again" : "กำลังโหลดข้อมูล Modify… ลองอีกครั้ง", "warn"); loadModInfo(); return; }
    setModOpen(true);
  }
  // หลัง Modify: โหลด Release ของใบนี้ใหม่ทั้งชุด (Transfer อาจสร้าง Part/Release ใหม่ในใบเดียวกัน)
  async function afterModify() {
    setModOpen(false);
    onChanged && onChanged();
    try {
      const all = await getReleasesFull();
      const next = all.filter((r) => r.release_order === hdr.ro && r.part_master?.project_id === projectId);
      if (next.length) { setReleases(next); loadStats(next); } else loadStats();
    } catch { loadStats(); }
    loadModInfo();
  }

  // ยอดรวมคิดจาก releases ปัจจุบัน (อัปเดตเมื่อแก้ไข/ลบ)
  const totalQty = releases.reduce((s, r) => s + (r.qty || 0), 0);
  const totalWeight = releases.reduce((s, r) => s + (r.qty || 0) * (r.unit_weight || 0), 0);
  // ประกอบ/แพ็ก (ลูกเป็น sub/แผง/แพ็ก) ไม่ต้องโชว์น้ำหนัก — คงไว้เฉพาะงานเครื่อง (part)
  const isAsmGroup = releases.length > 0 && releases.every((r) => { const k = r.part_master?.kind || "part"; return k === "subassembly" || k === "panel" || k === "package"; });
  const notes = new Set(releases.map((r) => r.note).filter(Boolean));
  const noteLabel = notes.size === 0 ? "-" : notes.size === 1 ? [...notes][0] : `${notes.size} หมายเหตุ`;

  // ── เครื่องจักรต่อเบอร์ + สถานะ (ชิปใต้เบอร์ · ตารางเครื่องเปิดขยาย · ตัวกรองสถานะ) ──
  const [mstat, setMstat] = useState({ state: "loading", data: {} });   // state: loading | ok | not_installed | error
  const mstatSig = useRef("");
  const loadMachineStatus = useCallback(async (list, { silent = false } = {}) => {
    if (isAsmGroup) return false;
    const ids = (list || []).map((r) => r.id);
    if (!ids.length) { setMstat({ state: "ok", data: {} }); return false; }
    let res;
    try { res = await getReleaseMachineStatus(ids); } catch (e) { res = { ok: false, reason: "error", message: e?.message }; }
    if (!res.ok) {
      setMstat((s) => ({ state: res.reason === "not_installed" ? "not_installed" : (silent && s.state === "ok" ? "ok" : "error"), data: s.data }));
      return false;
    }
    // ลายเซ็นข้อมูล → ถ้าเปลี่ยน (มีงานใหม่/เริ่ม/จบ) ให้รีเฟรชยอดของตารางด้วย
    const sig = Object.keys(res.data).sort().map((k) => k + ":" + (res.data[k] || []).map((m) => [m.machine_id, m.done, m.finished, m.last_at, m.active ? m.active.started_at : ""].join(",")).join(";")).join("|");
    const changed = !!mstatSig.current && sig !== mstatSig.current;
    mstatSig.current = sig;
    setMstat({ state: "ok", data: res.data || {} });
    return changed;
  }, [isAsmGroup]);

  // ★ รับได้ทั้ง loadStats() / loadStats(list) / onClick={loadStats} (event) — เดิมปุ่มรีเฟรชส่ง event มาแทน list แล้วพัง
  const loadStats = useCallback((arg, { silent = false } = {}) => {
    const list = Array.isArray(arg) ? arg : releases;
    const ids = list.map((r) => r.id);
    if (ids.length === 0) { setUnitStats({}); setOpProg({}); setMatLens({}); setStatsLoading(false); setMstat({ state: "ok", data: {} }); return; }
    if (!silent) setStatsLoading(true);
    Promise.all([getUnitStatsByReleaseIds(ids), getReleaseOpProgressFin(ids), getReleaseMaterialLengths(ids)])
      .then(([s, op, ml]) => { setUnitStats(s); setOpProg(op || {}); setMatLens(ml || {}); setStatsLoading(false); });
    if (!silent) loadMachineStatus(list);
  }, [releases, loadMachineStatus]);
  useEffect(() => { loadStats(); }, [loadStats]);
  // สถานะเครื่องเปลี่ยนตลอด (สแกนรอบแรก / กด OK) → ดึงใหม่ทุก 30 วิ ตอนเปิดหน้านี้อยู่ · มีการเปลี่ยน = รีเฟรชยอดแบบเงียบ
  useEffect(() => {
    if (isAsmGroup) return undefined;
    const t = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const changed = await loadMachineStatus(releases, { silent: true });
      if (changed) loadStats(releases, { silent: true });
    }, 30000);
    return () => clearInterval(t);
  }, [releases, isAsmGroup, loadMachineStatus, loadStats]);

  // ── ลบ Release (พร้อม QR + ประวัติสแกนของล็อตนั้น) ───────────────────────
  async function handleDelete(r) {
    setBusyId(r.id);
    try {
      const units = await listRows("part_units", { filters: { release_id: r.id } });
      const scanned = units.filter((u) => u.status !== "released").length;
      const msg = scanned > 0
        ? `ล็อตนี้มี ${units.length} ชิ้น และมี ${scanned} ชิ้นที่สแกนไปแล้ว (มีประวัติการทำงาน)\n\nการลบ Release นี้จะลบ QR และประวัติสแกนของชิ้นทั้งหมดในล็อตนี้ไปด้วย และกู้คืนไม่ได้\n\nยืนยันที่จะลบหรือไม่?`
        : `ล็อตนี้มี ${units.length} ชิ้น (ยังไม่มีการสแกน)\n\nต้องการลบ Release นี้พร้อม QR ทั้งหมดหรือไม่? การลบกู้คืนไม่ได้`;
      if (!(await askConfirm({ message: msg, tone: "danger", confirmText: "ลบ Release", cancelText: "ยกเลิก" }))) { setBusyId(null); return; }
      await deleteReleaseCascade(r.id);
      auditRecord("delete_release", "release", r.id, { part_no: r.part_master?.part_no, release_order: r.release_order, qty: r.qty, project: r.part_master?.projects?.code });
      const next = releases.filter((x) => x.id !== r.id);
      setReleases(next);
      onChanged && onChanged();               // ให้หน้ารายการหลักรีโหลดด้วย
      if (next.length === 0) { onBack(); return; } // ลบหมดทั้งกลุ่ม → กลับหน้ารายการ
      loadStats(next);
    } catch (e) {
      mlsToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    setBusyId(null);
  }

  // หลังแก้ไข Release: ดึงค่าล่าสุดของล็อตในกลุ่มนี้มาแสดง แล้วรีเฟรชสถิติ
  async function afterEdit() {
    setEditing(null);
    onChanged && onChanged();
    try {
      const all = await getReleasesFull();
      const ids = new Set(releases.map((r) => r.id));
      const updated = all.filter((r) => ids.has(r.id));
      if (updated.length) { setReleases(updated); loadStats(updated); }
      else loadStats();
    } catch { loadStats(); }
  }

  // ★ ใช้ตัวช่วยกลาง computeGroupProgress → นิยาม "เสร็จ" เดียวกับหน้า Projects และ
  //   รายการ Release (max ระหว่างสแกนสำนักงาน กับขั้นตอนสุดท้ายหน้าเครื่อง) — เลิกขัดกันเอง
  const wPer = (r) => Number(r.unit_weight ?? r.part_master?.unit_weight ?? 0);
  const { finished: totalFinished, inProgress: totalInProgress, stationDrove } =
    computeGroupProgress(releases, unitStats, opProg, totalQty);
  const pctOverall = totalQty > 0 ? Math.round((totalFinished / totalQty) * 100) : 0;
  // น้ำหนักที่ทำแล้ว = Σ (เสร็จของแต่ละ Part × น้ำหนัก/ชิ้นของ Part นั้น)
  const finishedWeight = releases.reduce((sum, r) => sum + relProgress(r, unitStats, opProg).finished * wPer(r), 0);

  // ── ความคืบหน้าต่อ Part (แต่ละแถว) = MAX(สแกนออฟฟิศ, งานหน้าเครื่องขั้นตอนสุดท้าย) ──
  //    ให้ตรงกับการ์ด "เสร็จแล้ว (ภาพรวม)" ด้านบน · เดิมแถวอ่านเฉพาะ unitStats (สแกนออฟฟิศ)
  //    งานที่บันทึกจากหน้าเครื่อง (machine_records) จึงไม่ขึ้นในตาราง — โชว์ 0 ทั้งที่ยอดรวมเห็นแล้ว
  const rowProg = (r) => relProgress(r, unitStats, opProg);   // done = จำนวนจริงที่เสร็จ (รวมสแปร์)

  // ── ตัวช่วยเรียงตาราง (ใช้ทั้งแสดงผลบนจอและ export Excel ให้ลำดับตรงกันเป๊ะ) ──
  // ความยาว material (หน้าเครื่อง) ต่อ release — รวมค่าที่ใช้จริง (ไม่ซ้ำ) เป็นข้อความ
  const matLenList = (r) => { const a = matLens[r.id]; return Array.isArray(a) ? a.filter((n) => n != null) : []; };
  const matLenText = (r) => { const a = matLenList(r); return a.length ? a.map((n) => fmtNum(n)).join(" · ") : "-"; };

  const sortAccessors = {
    part_no: (r) => r.part_master?.part_no || "", part_name: (r) => r.part_master?.part_name || "",
    qty: (r) => Number(r.qty) || 0,
    finished: (r) => rowProg(r).done,
    progress: (r) => { const p = rowProg(r); return p.total > 0 ? p.done / p.total : 0; },
    uw: (r) => Number(r.unit_weight) || 0,
    tw: (r) => (Number(r.unit_weight) || 0) * (Number(r.qty) || 0),
    len: (r) => Number(r.length_mm) || 0,
    material: (r) => r.part_master?.material || r.material || "",
    matlen: (r) => { const a = matLenList(r); return a.length ? Math.max(...a.map(Number)) : 0; },
  };

  // ── เครื่องจักรต่อเบอร์ + สถานะ ──
  const LL = (th, en) => (lang === "en" ? en : th);
  const pmOn = !isAsmGroup;                          // ประกอบ/แพ็ก ไม่ใช้ (ไม่มีงานเครื่อง)
  const pmKey = `mls.pm-ui:${projectId || ""}:${hdr.ro || group.releases?.[0]?.id || ""}`;
  const [pmFilter, setPmFilter] = useState(() => { const v = pmUiLoad(pmKey); return new Set(Array.isArray(v?.f) ? v.f.filter((k) => PM_ORDER.includes(k)) : []); });
  const [pmOpen, setPmOpen] = useState(() => { const v = pmUiLoad(pmKey); return new Set(Array.isArray(v?.o) ? v.o : []); });
  useEffect(() => {
    const ids = new Set(releases.map((r) => r.id));
    pmUiSave(pmKey, { f: [...pmFilter], o: [...pmOpen].filter((id) => ids.has(id)) });   // เก็บเฉพาะแถวที่ยังอยู่ในใบนี้
  }, [pmKey, pmFilter, pmOpen, releases]);
  const pmReady = pmOn && mstat.state === "ok";
  const pmInfo = useMemo(() => {
    const m = new Map();
    for (const r of releases) {
      const ms = pmMachines(mstat.data[r.id] || mstat.data[String(r.id)], r.qty);
      m.set(r.id, { ms, st: pmRowStatus(ms, relProgress(r, unitStats, opProg)) });
    }
    return m;
  }, [releases, mstat, unitStats, opProg]);
  const pmCounts = useMemo(() => {
    const c = { pend: 0, run: 0, bal: 0, fin: 0 };
    if (pmReady) for (const v of pmInfo.values()) c[v.st] = (c[v.st] || 0) + 1;
    return c;
  }, [pmInfo, pmReady]);
  const pmActiveFilter = pmReady && pmFilter.size > 0;
  const viewRows = pmActiveFilter ? releases.filter((r) => pmFilter.has(pmInfo.get(r.id)?.st)) : releases;
  // ลำดับ (ITEM) คงเลขเดิมแม้กรอง — นับจากทั้งตารางตามการเรียงที่เลือก
  const itemNoMap = new Map(sort.sortRows(releases, sortAccessors).map((r, i) => [r.id, i + 1]));
  const pmToggle = (id) => setPmOpen((s0) => { const n = new Set(s0); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pmExpandable = pmReady ? viewRows.filter((r) => (pmInfo.get(r.id)?.ms.length || 0) > 0) : [];
  const pmAllOpen = pmExpandable.length > 0 && pmExpandable.every((r) => pmOpen.has(r.id));
  const pmToggleAll = () => setPmOpen((s0) => { const n = new Set(s0); pmExpandable.forEach((r) => { if (pmAllOpen) n.delete(r.id); else n.add(r.id); }); return n; });
  const pmFilterToggle = (k) => setPmFilter((s0) => { if (k === "all") return new Set(); const n = new Set(s0); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // นาฬิกาสำหรับ "ผ่านไป / หยุดมาแล้ว" — ทุกวินาทีเฉพาะตอนเปิดดูเครื่องที่กำลังทำ · นอกนั้นทุก 30 วิ
  const [pmNow, setPmNow] = useState(() => Date.now());
  const pmNeedsSec = pmReady && viewRows.some((r) => pmOpen.has(r.id) && (pmInfo.get(r.id)?.ms || []).some((m) => m.st === "run"));
  useEffect(() => {
    if (!pmOn) return undefined;
    setPmNow(Date.now());
    const t = setInterval(() => setPmNow(Date.now()), pmNeedsSec ? 1000 : 30000);
    return () => clearInterval(t);
  }, [pmOn, pmNeedsSec]);

  // ── ดาวน์โหลดตาราง "รายละเอียดแต่ละ Part" เป็นไฟล์ Excel (.xlsx) ──
  // คอลัมน์/ลำดับตรงกับที่เห็นบนจอ · หัวคอลัมน์ตามภาษาที่ใช้อยู่ · ตัวเลขเป็นตัวเลขจริง (รวม/เรียงใน Excel ได้)
  async function doExportExcel() {
    if (exporting) return;
    setExporting(true);
    const w2 = (n) => (Number(n) || 0).toFixed(2);   // ★ บังคับ 2 ตำแหน่งทศนิยมเสมอ (เช่น 5.00, 5.20)
    try {
      // ★ มีสถานะเครื่องแล้ว → 1 แถว = 1 เบอร์ + 1 เครื่อง (ตามตัวกรองสถานะ + การเรียงบนจอ)
      if (pmReady) {
        const roTag0 = String(hdr.ro || releases[0]?.part_master?.part_no || "export").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
        const list = sort.sortRows(viewRows, sortAccessors).map((r) => {
          const pi = pmInfo.get(r.id) || { ms: [], st: "pend" };
          return { r, ms: pi.ms, st: pi.st, p: rowProg(r), matLen: matLenList(r) };
        });
        await pmExportExcel({ rows: list, lang, ro: hdr.ro, isAsm: isAsmGroup, fileName: `release-${roTag0}.xlsx`,
          filterKeys: pmActiveFilter ? PM_ORDER.filter((k) => pmFilter.has(k)) : [], itemNo: (r) => itemNoMap.get(r.id) });
        return;
      }
      const rows = sort.sortRows(releases, sortAccessors).map((r, i) => {
        const p = rowProg(r);
        const done = p.done ?? p.finished;        // จำนวนจริงที่ทำ/เสร็จ (รวมสแปร์)
        const over = p.over || 0;                 // เกินจำนวนสั่ง (สแปร์)
        const total = p.total || r.qty;
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const row = {};
        row[lang === "en" ? "Item" : "ลำดับ"] = i + 1;
        row[lang === "en" ? "Part No." : "เบอร์พาร์ท"] = r.part_master?.part_no || "";
        row[lang === "en" ? "Qty" : "จำนวน"] = Number(r.qty) || 0;
        row[lang === "en" ? "Finished" : "เสร็จแล้ว"] = done;
        row[lang === "en" ? "Spare (over)" : "เกิน (สแปร์)"] = over || "";
        row[lang === "en" ? "In progress" : "กำลังทำ"] = p.inProgress;
        row[lang === "en" ? "Progress (%)" : "ความคืบหน้า (%)"] = pct;
        if (!isAsmGroup) {
          row[lang === "en" ? "Weight/pc (kg)" : "น้ำหนัก/ชิ้น (กก.)"] = r.unit_weight ? w2(r.unit_weight) : "";
          row[lang === "en" ? "Total weight (kg)" : "น้ำหนักรวม (กก.)"] = r.unit_weight ? w2((Number(r.qty) || 0) * r.unit_weight) : "";
        }
        row[lang === "en" ? "Length/pc (mm)" : "ความยาว/ชิ้น (มม.)"] = r.length_mm ? Number(r.length_mm) : "";
        row["INV Code"] = r.part_master?.material || r.material || "";
        { const a = matLenList(r); row[lang === "en" ? "Mat. Length (mm)" : "Mat. Length (มม.)"] = a.length === 1 ? Number(a[0]) : a.map((n) => fmtNum(n)).join(" · "); }
        row[lang === "en" ? "Remark" : "หมายเหตุ"] = r.note || "";
        return row;
      });
      const roTag = String(hdr.ro || releases[0]?.part_master?.part_no || "export").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
      const { downloadSheets } = await import("./excelExport.js");
      await downloadSheets(`release-${roTag}.xlsx`, [{ name: lang === "en" ? "Parts" : "รายการ Part", rows }]);
    } catch (e) {
      console.warn("export release excel error", e);
      mlsToast(lang === "en" ? "Export failed, please try again" : "สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <Btn variant="ghost" size="sm" onClick={onBack}>
              <Icon name="arrowLeft" size={14} /> กลับไปหน้า Release
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => loadStats()} title="โหลดความคืบหน้าล่าสุด">
              <Icon name="refresh" size={14} /> รีเฟรช
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => (onHome ? onHome() : onBack())} title="กลับหน้าแรก">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: "-2px" }}>
                <path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              หน้าแรก
            </Btn>
          </div>
          <div className="page-title">{hdr.ro ? `Release Order: ${hdr.ro}` : `Release — ${releases[0]?.part_master?.part_no || ""}`}
            {modReady && hdr.ro && (
              // ★ ทุกเวอร์ชัน: M-000 (ต้นฉบับ) → … → ล่าสุดอยู่ขวาสุด · กดดูรายละเอียดได้ · ตัวที่ใช้อยู่ตอนนี้ = ทึบม่วง · ที่ยกเลิก = ขีดฆ่า
              <span className="relmod-vstrip">
                {[null, ...[...modList].sort((a, b) => (Number(a.version_no) || 0) - (Number(b.version_no) || 0))].map((m, i) => {
                  const v = m ? m.version : M0;
                  const isCur = v === curVersion;
                  const cls = "relmod-vpill" + (!m ? " origin" : "") + (m && m.reverted ? " cancelled" : "") + (isCur ? " cur" : "");
                  const tip = !m
                    ? `${M0} · ${lang === "en" ? "original (before any change)" : "ต้นฉบับ (ก่อนการแก้ไข)"}${isCur ? (lang === "en" ? " · current" : " · ใช้อยู่ตอนนี้") : ""}`
                    : `${v} · 📅 ${fmtYmd(modDocDate(m))} · ${[...new Set((m.items || []).map((it) => modTL(it.type, lang)))].join(", ")} · ${[...new Set((m.items || []).map((it) => it.part_no))].join(", ")}`
                      + (m.reverted ? (lang === "en" ? " · CANCELLED" : " · ยกเลิกแล้ว") : "") + (isCur ? (lang === "en" ? " · current" : " · ใช้อยู่ตอนนี้") : "");
                  return (
                    <span key={v} className="relmod-vitem">
                      {i > 0 && <span className="relmod-vsep">›</span>}
                      <button type="button" className={cls} title={tip} onClick={() => setModView(v)}>{v}</button>
                    </span>
                  );
                })}
              </span>
            )}
          </div>
          <div className="page-sub">{group.projectCode} — {group.projectName} · {fmtD(hdr.date)}</div>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn onClick={openModify} disabled={!hdr.ro}
              title={hdr.ro ? (lang === "en" ? "Change release items: add/reduce qty · INV · cancel part · transfer — saved as a new M, previous values kept as evidence" : "แก้รายการใน Release: เพิ่ม/ลดจำนวน · แก้ INV · ยกเลิก Part · Transfer — บันทึกเป็น M ใหม่ เก็บของเดิมเป็นหลักฐาน") : (lang === "en" ? "Set a Release Order number first" : "ต้องมีเลขที่ Release Order ก่อน")}
              style={{ background: "rgba(109,74,255,.10)", border: `1.5px solid ${MOD_PURPLE}`, color: MOD_PURPLE, fontWeight: 700 }}>
              ✎ Modify
            </Btn>
            <Btn variant="accent" onClick={() => setEditHeader(true)}
              title="แก้เลขที่ Release Order / วันที่ / Modify ของทั้งใบ">
              <Icon name="settings" size={15} /> แก้ไขหัวเอกสาร
            </Btn>
          </div>
        )}
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Card>
          <div className="label-el">จำนวนรวม</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(totalQty)} ชิ้น</div>
        </Card>
        {!isAsmGroup && (
          <Card>
            <div className="label-el">น้ำหนักรวม</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(totalWeight)} กก.</div>
          </Card>
        )}
        <Card>
          <div className="label-el">Part No.</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{releases.length} Part</div>
        </Card>
        <Card>
          <div className="label-el" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="check" size={12} /> เสร็จแล้ว (ภาพรวม)
          </div>
          {statsLoading ? (
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>กำลังโหลด...</div>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: (totalQty > 0 && totalFinished >= totalQty) ? "var(--success)" : "var(--text)" }}>
                {fmtNum(totalFinished)} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>/ {fmtNum(totalQty)} ชิ้น</span>
              </div>
              <ProgressBar pct={pctOverall} finished={totalFinished} total={totalQty} />
              {!isAsmGroup && (
                <div style={{ fontSize: 12, color: "var(--accent-dk)", fontWeight: 600, marginTop: 6 }}>
                  น้ำหนักที่ทำแล้ว: {fmtNum(finishedWeight)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>/ {fmtNum(totalWeight)} กก.</span>
                </div>
              )}
              {stationDrove && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                  {lang === "en" ? "* Counts pieces the machine terminal marked Finished (each machine’s own route)" : "* นับชิ้นที่หน้าเครื่องกด Finished (ตามรูทของเครื่อง)"}
                </div>
              )}
              {totalInProgress > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                  กำลังทำ: {fmtNum(totalInProgress)} ชิ้น
                </div>
              )}
            </>
          )}
        </Card>
        {hdr.ro && (
          <Card className="span-2"
            title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{lang === "en" ? "Modify history" : "ประวัติการแก้ไข (Modify)"}
              {modReady && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 700, padding: "1px 8px", borderRadius: 7, background: "rgba(109,74,255,.10)", color: MOD_PURPLE, border: "1px solid rgba(109,74,255,.35)" }}>{lang === "en" ? "now" : "ตอนนี้"} {curVersion}</span>}</span>}
            right={modReady ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{modList.length} {lang === "en" ? "time(s)" : "ครั้ง"}{nCancelled ? (lang === "en" ? ` · ${nCancelled} cancelled` : ` · ยกเลิก ${nCancelled}`) : ""}</span>
                <Btn variant="ghost" size="sm" onClick={() => exportMod("ALL")} disabled={modExporting} title={lang === "en" ? "One Excel file: every M (incl. cancelled) + all changes + current parts + QR" : "ไฟล์ Excel เดียว: ทุก M (รวมที่ยกเลิก) + รายการแก้ทั้งหมด + Part ปัจจุบัน + QR"}>
                  <Icon name="grid" size={13} /> {lang === "en" ? "Export all M" : "Export ทุก M"}
                </Btn>
              </span>) : null}>
            {!modInfo ? <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{lang === "en" ? "Loading…" : "กำลังโหลด..."}</div>
              : !modReady ? <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{modInfo.reason === "not_installed" ? (lang === "en" ? "Modify isn't installed — run migration-release-modify.sql in Supabase" : "ยังไม่ได้ติดตั้งส่วน Modify — รัน migration-release-modify.sql ใน Supabase") : (lang === "en" ? "Couldn't load history" : "โหลดประวัติไม่สำเร็จ")}</div>
              : (
                <>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>{lang === "en" ? "What changed · in which M · click an M for details · previous values are kept as evidence" : "แก้อะไร · ใน M ไหน · กดดูรายละเอียดแต่ละ M ได้ · ของเดิมเก็บเป็นหลักฐาน ลบทับไม่ได้"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 236, overflow: "auto" }}>
                    {modList.map((m) => {
                      const types = ["qty", "inv", "cancel", "transfer"].filter((t) => (m.items || []).some((i) => i.type === t));
                      const pns = [...new Set((m.items || []).map((i) => i.part_no))];
                      const rv = m.reverted;
                      return (
                        <div key={m.id} className={"relmod-hrow" + (rv ? " cancelled" : "")} onClick={() => setModView(m.version)}>
                          <span className={rv ? "relmod-strike" : ""}><ModVerPill v={m.version} gray={!!rv} /></span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {rv ? <span className="relmod-xchip">{lang === "en" ? "Cancelled" : "ยกเลิกแล้ว"}</span> : (m.version === curVersion ? <span className="relmod-nowchip">{lang === "en" ? "now" : "ตอนนี้"}</span> : null)}
                              {types.map((t) => <ModChip key={t} type={t} />)}<span className={rv ? "relmod-strike-txt" : ""}>{pns.join(", ")}</span>
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📅 <b style={{ color: "var(--text)", fontWeight: 600 }}>{fmtYmd(modDocDate(m))}</b> · {lang === "en" ? "entered" : "ลงแอป"} {fmtDT(m.created_at)} · {(m.items || []).length} {lang === "en" ? "change(s)" : "รายการ"} · {pns.length} Part · {m.actor_name || "-"} · {m.reason}</div>
                            {rv && <div style={{ fontSize: 11.5, color: "#b91c1c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>⊘ {lang === "en" ? "Cancelled" : "ยกเลิก"} <b>{fmtYmd(revDocDate(rv))}</b> · {lang === "en" ? "entered" : "ลงแอป"} {fmtDT(rv.at)} · {rv.actor_name || "-"}{rv.mode === "rollback" ? (lang === "en" ? ` · rolled back to ${rv.target_version || M0}` : ` · ย้อนกลับเป็น ${rv.target_version || M0}`) : ""} · {rv.reason}</div>}
                          </div>
                          <button type="button" className="relmod-dl" title={lang === "en" ? `Export ${m.version} (Excel)` : `Export ${m.version} (Excel)`} disabled={modExporting}
                            onClick={(e) => { e.stopPropagation(); exportMod(m.version); }}><Icon name="grid" size={13} /></button>
                          <span style={{ color: "var(--muted-2)" }}>›</span>
                        </div>
                      );
                    })}
                    <div className="relmod-hrow" onClick={() => setModView(M0)}>
                      <ModVerPill v={M0} gray />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{lang === "en" ? "Original — before any change" : "ต้นฉบับ — ก่อนการแก้ไข"}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{(() => { const rd = releases.map((r) => String(r.release_date || "").slice(0, 10)).filter(Boolean).sort()[0]; return rd ? <>📅 {lang === "en" ? "released" : "ปล่อยงาน"} <b style={{ color: "var(--text)", fontWeight: 600 }}>{fmtYmd(rd)}</b> · </> : null; })()}{modInfo.origin ? `🔒 ${lang === "en" ? "kept as evidence" : "เก็บเป็นหลักฐาน"}` : (lang === "en" ? "Never modified — current values are the original" : "ยังไม่เคย Modify — ค่าปัจจุบันคือต้นฉบับ")} · {lang === "en" ? "click to view" : "กดดูค่าต้นฉบับ"}</div>
                      </div>
                      <button type="button" className="relmod-dl" title={`Export ${M0} (Excel)`} disabled={modExporting}
                        onClick={(e) => { e.stopPropagation(); exportMod(M0); }}><Icon name="grid" size={13} /></button>
                      <span style={{ color: "var(--muted-2)" }}>›</span>
                    </div>
                  </div>
                </>
              )}
          </Card>
        )}
      </div>

      {/* (ผู้ใช้ 2026-09-24: เอาการ์ด "ความคืบหน้าตามขั้นตอน (งานหน้าเครื่อง)" ออก — ดูรายเครื่องในตาราง Part แทน) */}

      <Card title={lang === "en" ? "Details of each Part in this lot" : "รายละเอียดแต่ละ Part ในล็อตนี้"}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn variant="ghost" size="sm" onClick={() => colApi.current && colApi.current.resetAll()}
              title={lang === "en" ? "Reset column order + show all columns" : "คืนค่าเริ่มต้น: ลำดับคอลัมน์ + แสดงคอลัมน์ที่ซ่อนไว้ทั้งหมด"}>
              ↺ {lang === "en" ? "Columns" : "คอลัมน์"}
            </Btn>
            <Btn variant="accent" size="sm" onClick={doExportExcel} disabled={exporting || viewRows.length === 0}
              title={lang === "en" ? "Download this table as Excel (.xlsx)" : "ดาวน์โหลดตารางนี้เป็นไฟล์ Excel (.xlsx)"}>
              <Icon name="grid" size={14} /> {exporting ? (lang === "en" ? "Exporting…" : "กำลังสร้าง…") : (lang === "en" ? "Export Excel" : "Export Excel")}
            </Btn>
          </div>
        }>
        <SortControl sort={sort} options={[
          { k: "part_no", label: lang === "en" ? "Part No." : "เบอร์พาร์ท" }, { k: "qty", label: lang === "en" ? "Qty" : "จำนวน" },
          { k: "finished", label: lang === "en" ? "Finished" : "เสร็จแล้ว" }, { k: "progress", label: lang === "en" ? "Progress" : "ความคืบหน้า" },
          ...(!isAsmGroup ? [{ k: "uw", label: lang === "en" ? "Weight/pc" : "น้ำหนัก/ชิ้น" }, { k: "tw", label: lang === "en" ? "Total weight" : "น้ำหนักรวม" }] : []), { k: "len", label: lang === "en" ? "Length/pc" : "ความยาว/ชิ้น" },
          { k: "material", label: "INV Code" }, { k: "matlen", label: "Mat. Length" },
        ]} />
        {(() => {
          const cols = [
            { key: "item", header: lang === "en" ? "Item" : "ลำดับ",
              thStyle: { minWidth: 44, textAlign: "right", whiteSpace: "nowrap" },
              tdStyle: { color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" },
              cell: (r, i) => itemNoMap.get(r.id) || i + 1 },
            { key: "part_no", header: lang === "en" ? "Part No." : "เบอร์พาร์ท", sortKey: "part_no",
              tdStyle: { fontWeight: 600, whiteSpace: "nowrap" }, dataLabel: lang === "en" ? "Part No." : "เบอร์พาร์ท",
              cell: (r) => {
                const pi = pmReady ? pmInfo.get(r.id) : null;
                return (
                <div className="pm-pncell">
                <span className="pm-pnline1">
                  <span style={r.mod_cancelled_at ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>{r.part_master?.part_no || "-"}</span>
                  {r.mod_version && (
                    <span onClick={(e) => { e.stopPropagation(); if (modByVersion(r.mod_version)) setModView(r.mod_version); }}
                      title={modNoteText(r.mod_note, lang) || (lang === "en" ? "See what changed" : "ดูว่าแก้อะไร")}
                      style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 5, background: "rgba(109,74,255,.10)", color: MOD_PURPLE, border: "1px solid rgba(109,74,255,.35)", cursor: "pointer" }}>{r.mod_version}</span>
                  )}
                  {r.mod_cancelled_at && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 5, background: "rgba(239,68,68,.11)", color: "var(--danger)" }}>{r.mod_cancel_keep === "moved" ? (lang === "en" ? "all moved" : "ย้ายหมดแล้ว") : (lang === "en" ? "cancelled" : "ยกเลิก")}</span>}
                  {pi && <PmPill k={pi.st} sm />}
                </span>
                {pmOn && (
                  <div className="pm-pnline2">
                    {pi ? <PmChips ms={pi.ms} qty={Number(r.qty) || 0} open={pmOpen.has(r.id)} onToggle={() => pmToggle(r.id)} lang={lang} />
                      : mstat.state === "loading" ? <span className="pm-none">…</span> : null}
                  </div>
                )}
                </div>
                );
              } },
            { key: "qty", header: lang === "en" ? "Qty" : "จำนวน", sortKey: "qty", align: "right", cell: (r) => fmtNum(r.qty) },
            { key: "finished", header: lang === "en" ? "Finished" : "เสร็จแล้ว", sortKey: "finished",
              cell: (r, i, c) => statsLoading ? <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span> : (
                <>
                  <span style={{ fontWeight: 600, color: c.done > 0 ? "var(--success)" : "var(--muted)" }}>{fmtNum(c.done)} ชิ้น</span>
                  {c.over > 0 && (
                    <div style={{ fontSize: 11, color: "var(--alert, #d97a00)", fontWeight: 700, marginTop: 2, whiteSpace: "nowrap" }}
                      title={lang === "en" ? "Over ordered qty (spare)" : "เกินจำนวนสั่ง (สแปร์)"}>
                      +{fmtNum(c.over)} {lang === "en" ? "spare" : "เกิน (สแปร์)"}
                    </div>
                  )}
                  {c.inProgress > 0 && (
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginTop: 2, whiteSpace: "nowrap" }}
                      title={lang === "en" ? "Started but not marked Finished yet" : "เริ่มทำแล้วแต่ยังไม่ได้กด Finished"}>
                      +{fmtNum(c.inProgress)} {lang === "en" ? "in progress" : "กำลังทำ"}
                    </div>
                  )}
                </>
              ) },
            { key: "progress", header: lang === "en" ? "Progress" : "ความคืบหน้า", sortKey: "progress",
              tdStyle: { whiteSpace: "nowrap" },
              cell: (r, i, c) => statsLoading ? <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span> : <ProgressBar pct={c.pct} finished={c.done} total={c.total} /> },
            ...(!isAsmGroup ? [
              { key: "uw", header: lang === "en" ? "Weight/pc (kg)" : "น้ำหนัก/ชิ้น (กก.)", sortKey: "uw", align: "right", cell: (r) => r.unit_weight ? fmtNum(r.unit_weight) : "-" },
              { key: "tw", header: lang === "en" ? "Total weight (kg)" : "น้ำหนักรวม (กก.)", sortKey: "tw", align: "right", cell: (r) => r.unit_weight ? fmtNum(r.qty * r.unit_weight) : "-" },
            ] : []),
            { key: "len", header: lang === "en" ? "Length/pc (mm)" : "ความยาว/ชิ้น (มม.)", sortKey: "len", align: "right", cell: (r) => r.length_mm ? fmtNum(r.length_mm) : "-" },
            { key: "material", header: "INV Code", sortKey: "material", tdStyle: { whiteSpace: "nowrap" }, cell: (r) => r.part_master?.material || r.material || "-" },
            { key: "matlen", header: lang === "en" ? "Mat. Length (mm)" : "Mat. Length (มม.)", sortKey: "matlen", align: "right", tdStyle: { whiteSpace: "nowrap" },
              cell: (r) => statsLoading ? <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span> : matLenText(r) },
            { key: "remark", header: lang === "en" ? "Remark" : "หมายเหตุ", cell: (r) => r.note || "-" },
            ...(canEdit ? [{ key: "manage", header: lang === "en" ? "Manage" : "จัดการ",
              tdStyle: { whiteSpace: "nowrap" }, tdProps: () => ({ onClick: (e) => e.stopPropagation() }),
              cell: (r) => <span onClick={() => setEditing(r)} style={{ color: "var(--accent-dk)", cursor: "pointer" }}>{busyId === r.id ? "กำลังลบ..." : "แก้ไข"}</span> }] : []),
          ];
          const rctx = (r) => {
            const p = rowProg(r);
            const over = p.over || 0;
            const done = p.done ?? p.finished;
            const total = p.total || r.qty;
            return { finished: p.finished, inProgress: p.inProgress, over, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
          };
          return (
            <>
            {pmOn && (
              <div className="pm-tbar">
                <div className="pm-tbar-l">
                  <span className="pm-tbar-lbl">{LL("สถานะ", "Status")}</span>
                  {pmReady ? (
                    <div className="pm-fchips" role="group" aria-label={LL("กรองตามสถานะ", "Filter by status")}>
                      <button type="button" className={"pm-fchip all" + (pmFilter.size ? "" : " on")} onClick={() => pmFilterToggle("all")} aria-pressed={!pmFilter.size}>
                        {LL("ทั้งหมด", "All")} <b>{releases.length}</b>
                      </button>
                      {PM_ORDER.map((k) => (
                        <button key={k} type="button" className={`pm-fchip ${k}` + (pmFilter.has(k) ? " on" : "") + (pmCounts[k] ? "" : " zero")}
                          onClick={() => pmFilterToggle(k)} aria-pressed={pmFilter.has(k)}
                          title={{ pend: LL("ยังไม่มีเครื่องเริ่ม", "no machine started yet"), run: LL("สแกนรอบแรกแล้ว เวลากำลังเดิน", "first scan done, timer running"), bal: LL("ทำไปบางส่วน รอชุดถัดไป", "partly done, waiting for the next batch"), fin: LL("ครบจำนวนสั่ง หรือกด Finished", "full qty done, or Finished pressed") }[k] + LL(" · กดเลือกได้หลายสถานะ", " · pick several")}>
                          <i />{PM_ST[k]} <b>{pmCounts[k]}</b>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="pm-tbar-msg">
                      {mstat.state === "loading" ? LL("กำลังโหลดสถานะเครื่อง…", "Loading machine status…")
                        : mstat.state === "not_installed" ? LL("ยังไม่ได้ติดตั้งส่วนสถานะเครื่อง — รัน migration-part-machine-status.sql ใน Supabase", "Machine status isn't installed — run migration-part-machine-status.sql in Supabase")
                        : <>{LL("โหลดสถานะเครื่องไม่สำเร็จ", "Couldn't load machine status")} · <button type="button" className="pm-linkbtn" onClick={() => loadMachineStatus(releases)}>{LL("ลองใหม่", "retry")}</button></>}
                    </span>
                  )}
                </div>
                {pmReady && (
                  <div className="pm-tbar-r">
                    <span className="pm-tbar-count">{pmActiveFilter
                      ? <>{LL("แสดง", "showing")} <b>{viewRows.length}</b> {LL(`จาก ${releases.length} เบอร์`, `of ${releases.length} parts`)}</>
                      : <>{LL("ทั้งหมด", "")} <b>{releases.length}</b> {LL("เบอร์", "parts")}</>}</span>
                    <Btn variant="ghost" size="sm" onClick={pmToggleAll} disabled={!pmExpandable.length}
                      title={LL("เปิด/ปิด ตารางเครื่องของทุกเบอร์ที่เห็นอยู่", "Open/close the machine table of every visible part")}>
                      {pmAllOpen ? LL("⊟ ย่อทั้งหมด", "⊟ Collapse all") : LL("⊞ ขยายทั้งหมด", "⊞ Expand all")}
                    </Btn>
                    <Btn variant="ghost" size="sm" onClick={() => setPmFilter(new Set())} disabled={!pmFilter.size}>
                      {LL("✕ ล้างตัวกรอง", "✕ Clear filter")}
                    </Btn>
                  </div>
                )}
              </div>
            )}
            {pmReady && (
              <div className="pm-hint">{LL("กดชิปเครื่อง หรือ “▸ N เครื่อง” ใต้เบอร์ = เปิดดูรายละเอียดของแต่ละเครื่อง · กดที่อื่นในแถว = เปิดความคืบหน้าเหมือนเดิม",
                "Click a machine chip or “▸ N machines” under the part no. to see each machine · click elsewhere on the row = progress popup as before")}</div>
            )}
            <DataTable id="lot-parts" columns={cols} rows={viewRows} rowKey={(r) => r.id}
              sort={sort} sortAccessors={sortAccessors} rowCtx={rctx} orderApiRef={colApi}
              wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
              rowProps={(r) => ({ className: "release-row", onClick: () => setViewPart(r), title: "กดเพื่อดูความคืบหน้าแยกขั้นตอน" })}
              rowAfter={(r) => {
                if (!pmReady || !pmOpen.has(r.id)) return null;
                const pi = pmInfo.get(r.id);
                if (!pi || !pi.ms.length) return null;
                return <PmDetail r={r} ms={pi.ms} qty={Number(r.qty) || 0} lang={lang} nowMs={pmNow} />;
              }}
              empty={pmActiveFilter ? LL("ไม่มีเบอร์ที่ตรงกับสถานะที่เลือก", "No parts match the selected status") : (lang === "en" ? "No parts" : "ยังไม่มีข้อมูล")} />
            </>
          );
        })()}
      </Card>
      {noteLabel !== "-" && notes.size > 1 && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>หมายเหตุทั้งหมด: {[...notes].join(" · ")}</div>
      )}

      {viewPart && <PartProgressModal release={viewPart} user={user} goTo={goTo} onClose={() => { setViewPart(null); loadStats(); }} />}
      {editing && (
        <ReleaseEditModal
          release={editing}
          onClose={() => setEditing(null)}
          onSaved={afterEdit}
          onDelete={() => { const r = editing; setEditing(null); handleDelete(r); }}
        />
      )}
      {modOpen && modReady && (
        <ReleaseModifyModal releases={releases} projectId={projectId} releaseOrder={hdr.ro} info={modInfo}
          onClose={() => setModOpen(false)} onSaved={afterModify} />
      )}
      {modView && (
        <ReleaseModDetailModal releases={releases} origin={modReady ? modInfo.origin : null}
          mod={modView === M0 ? null : modByVersion(modView)} prevVersion={modView === M0 ? "" : prevOf(modView)}
          canRevert={canEdit && modReady && !!hdr.ro} hasNewer={hasNewerThan(modView)} anyActive={activeMods.length > 0}
          onRevert={(mode, version) => setRevertReq({ mode, version })} onExport={exportMod} exporting={modExporting}
          canEditDate={canEdit && modReady} onDateChanged={loadModInfo}
          onClose={() => setModView(null)} />
      )}
      {revertReq && modReady && (
        <ReleaseRevertModal mode={revertReq.mode} version={revertReq.version} projectId={projectId} releaseOrder={hdr.ro}
          mods={modList} current={curVersion}
          onSwitch={(mode, version) => setRevertReq({ mode, version })}
          onClose={() => setRevertReq(null)}
          onDone={() => { setRevertReq(null); setModView(null); afterModify(); }} />
      )}
      {editHeader && (
        <ReleaseHeaderEditModal
          group={group}
          releases={releases}
          curRO={hdr.ro}
          curDate={hdr.date}
          onClose={() => setEditHeader(false)}
          onSaved={({ ro, dateIso, mdf }) => {
            // อัปเดตค่าที่โชว์ + แถวในตารางให้เห็นผลทันที (ไม่ต้องกลับออกไปโหลดใหม่)
            setHdr({ ro, date: dateIso || hdr.date });
            setReleases((prev) => prev.map((r) => ({
              ...r,
              release_order: ro || null,
              release_date: dateIso || r.release_date,
              part_master: r.part_master ? { ...r.part_master, mdf_no: mdf ?? r.part_master.mdf_no } : r.part_master,
            })));
            setEditHeader(false);
            onChanged && onChanged();   // ให้หน้ารายการหลักรีเฟรชด้วย
          }}
        />
      )}
    </div>
  );
}

// ── แท็บแผนก (ใช้ร่วม 3 หน้า: รายงาน · ปล่อยงาน · พิมพ์ QR) — แยก แผง / ซับ ออกจากกัน ──
const DEPT_TABS = [
  { value: "machine", label: "Machine",      sub: "งานตัด / เจาะ",  color: "#b45309", soft: "rgba(217,164,65,.14)", icon: "bolt" },
  { value: "sub",     label: "Sub-Assembly", sub: "ซับ",            color: "#7c3aed", soft: "rgba(124,58,237,.10)", icon: "check" },
  { value: "panel",   label: "Assembly",     sub: "แผง",            color: "#0e9d63", soft: "rgba(16,185,129,.11)", icon: "grid" },
  { value: "packing", label: "Packing",      sub: "แพ็ก",           color: "#2563eb", soft: "rgba(37,99,235,.09)",  icon: "box" },
];
// ชนิด part → แผนก: package=แพ็ก · panel=แผง · subassembly=ซับ · อื่น ๆ=เครื่องจักร
const deptOfKind = (k) => (k === "package" ? "packing" : k === "panel" ? "panel" : k === "subassembly" ? "sub" : "machine");
function DeptTabs({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 10, margin: "0 0 16px", flexWrap: "wrap" }}>
      {DEPT_TABS.map((d) => {
        const active = value === d.value;
        return (
          <button key={d.value} type="button" onClick={() => onChange(d.value)}
            style={{ flex: "1 1 160px", display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 14, cursor: "pointer", textAlign: "left", font: "inherit", appearance: "none",
              border: active ? `2px solid ${d.color}` : "1px solid var(--border, #e5e7eb)",
              background: active ? d.soft : "var(--card, #fff)",
              boxShadow: active ? "0 4px 16px rgba(0,0,0,.06)" : "none", transition: "border-color .15s, background .15s, box-shadow .15s" }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: active ? d.color : "var(--bg-soft, #f1f5f9)", color: active ? "#fff" : "var(--muted, #64748b)" }}>
              <Icon name={d.icon} size={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: active ? d.color : "var(--text, #0f172a)" }}>{d.label}</div>
              <div style={{ fontSize: 11, color: "var(--muted, #64748b)", marginTop: 1 }}>{d.sub}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ReleasePage({ user, goTo }) {
  const [projects, setProjects] = useState([]);
  const [parts, setParts] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showSubAsm, setShowSubAsm] = useState(false);
  const [showBunk, setShowBunk] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [viewGroup, setViewGroup] = useState(null); // group ที่กำลังดูรายละเอียดอยู่ (null = แสดงตารางสรุป)
  const sort = useTableSort();   // เรียงตารางประวัติ Release ตามหัวข้อ
  // สถิติความคืบหน้า (finished / total) ของแต่ละ release — โหลดหลังได้รายการ
  const [allUnitStats, setAllUnitStats] = useState({});
  const [allOpProg, setAllOpProg] = useState({});   // ความคืบหน้าแยกขั้นตอน (งานหน้าเครื่อง) ต่อ release — ใช้รวมกับ office

  // ── ค้นหา/กรองประวัติ: วันที่ (จาก–ถึง) · โปรเจค · เลข Release Order ──
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("machine"); // แยกตามแผนก (เหมือนรายงาน): machine / assembly / packing

  const load = useCallback(async () => {
    setLoading(true);
    setProjects(await listRows("projects", { order: "code" }));
    setParts(await listRows("part_master", { order: "part_no" }));
    const releases = await getReleasesFull();
    setRecent(releases);
    setLoading(false);
    // โหลด stats ความคืบหน้าแบบ background (ไม่บล็อก UI)
    if (releases.length > 0) {
      const ids = releases.map((r) => r.id);
      // โหลดทั้งสแกนออฟฟิศ + งานหน้าเครื่อง พร้อมกัน → คิด "เสร็จ" แบบ MAX(ออฟฟิศ, หน้าเครื่อง) ให้ตรงกับหน้ารายละเอียด
      Promise.all([getUnitStatsByReleaseIds(ids), getReleaseOpProgressFin(ids)])
        .then(([s, op]) => { setAllUnitStats(s); setAllOpProg(op || {}); });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // กรองที่ระดับ release ก่อน แล้วค่อยจัดกลุ่ม เพื่อให้ค้นหาครอบคลุมทั้งประวัติ (deptOfKind = ตัวกลาง)
  const filteredReleases = recent.filter((r) => {
    if (deptFilter && deptOfKind(r.part_master?.kind) !== deptFilter) return false;
    if (projectFilter && r.part_master?.projects?.code !== projectFilter) return false;
    if (fromDate && new Date(r.release_date) < new Date(`${fromDate}T00:00:00`)) return false;
    if (toDate && new Date(r.release_date) > new Date(`${toDate}T23:59:59.999`)) return false;
    if (orderSearch) {
      const q = orderSearch.trim().toLowerCase();
      const hay = [r.release_order, r.part_master?.part_no, r.part_master?.projects?.name, r.note]
        .some((v) => (v || "").toLowerCase().includes(q));
      if (!hay) return false;
    }
    return true;
  });
  const groups = groupReleases(filteredReleases);
  const hasFilter = fromDate || toDate || projectFilter || orderSearch;
  function clearFilters() { setFromDate(""); setToDate(""); setProjectFilter(""); setOrderSearch(""); }

  if (viewGroup) {
    return <ReleaseGroupDetail group={viewGroup} user={user} onBack={() => setViewGroup(null)} goTo={goTo} onHome={() => { setViewGroup(null); goTo && goTo("release"); }} onChanged={load} />;
  }

  return (
    <div>
      <div className="page-head page-head-release">
        <div>
          <div className="page-title">ปล่อยงาน (Release)</div>
          <div className="page-sub">ค้นหา Release ที่เคยปล่อยงาน หรือกด "เพิ่ม Release" เพื่อปล่อยงานใหม่ (วางข้อมูลจาก Excel ได้) · แตะแถวเพื่อดูความคืบหน้า แก้ไข หรือลบ</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="accent" className="release-import-btn" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={15} />เพิ่ม Release
          </Btn>
          <Btn variant="accent" className="release-import-btn" onClick={() => setShowImport(true)}>
            <Icon name="folder" size={15} />นำเข้า Release จาก Excel
          </Btn>
          <Btn variant="accent" className="release-import-btn" onClick={() => setShowSubAsm(true)}>
            <Icon name="box" size={15} />เบอร์ประกอบ / แผง
          </Btn>
          <Btn variant="accent" className="release-import-btn" onClick={() => setShowBunk(true)}>
            <Icon name="weight" size={15} />นำเข้าฟอร์มบั้ง (แพ็ก)
          </Btn>
        </div>
      </div>

      <Card title="ค้นหา Release">
        <div className="grid-2">
          <Field label="จากวันที่">
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="ถึงวันที่">
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
          <Field label="โปรเจค">
            <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
              options={projects.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))} />
          </Field>
          <Field label="ค้นหา Release Order / Part / หมายเหตุ">
            <Input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="เช่น P-009" />
          </Field>
        </div>
        {hasFilter && (
          <div style={{ marginTop: 4 }}>
            <Btn variant="ghost" size="sm" onClick={clearFilters}><Icon name="close" size={13} /> ล้างตัวกรอง</Btn>
          </div>
        )}
      </Card>

      <DeptTabs value={deptFilter} onChange={setDeptFilter} />

      <Card title={hasFilter ? `ผลการค้นหา (${groups.length})` : "ประวัติการ Release ล่าสุด"}>
        <SortControl sort={sort} options={[
          { k: "date", label: "วันที่" }, { k: "project", label: "โปรเจค" }, { k: "order", label: "Release Order" },
          { k: "parts", label: "Part No." }, { k: "qty", label: "จำนวน" }, { k: "progress", label: "ความคืบหน้า" }, { k: "weight", label: "น้ำหนักรวม" },
        ]} />
        <DataTable id="release-history" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
          rows={groups} rowKey={(g) => g.key} sort={sort}
          sortAccessors={{
            date: (g) => new Date(g.date).getTime() || 0,
            project: (g) => g.projectCode || "",
            order: (g) => g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? ""),
            parts: (g) => g.releases.length,
            qty: (g) => g.totalQty || 0,
            weight: (g) => g.totalWeight || 0,
            progress: (g) => {
              const t = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.total ?? r.qty), 0);
              const f = computeGroupProgress(g.releases, allUnitStats, allOpProg, t).finished;
              return t > 0 ? f / t : 0;
            },
          }}
          rowCtx={(g) => {
            const gTotal = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.total ?? r.qty), 0);
            const gFinished = computeGroupProgress(g.releases, allUnitStats, allOpProg, gTotal).finished;
            const gPct = gTotal > 0 ? Math.round((gFinished / gTotal) * 100) : null;
            return { gTotal, gFinished, gPct, statsReady: g.releases.every((r) => r.id in allUnitStats) };
          }}
          rowProps={(g) => ({ className: "release-row", onClick: () => setViewGroup(g) })}
          empty={loading ? "…" : (hasFilter ? "ไม่พบ Release ตามเงื่อนไขที่ค้นหา" : "ยังไม่มี Release — กด \"เพิ่ม Release\" เพื่อเริ่ม")}
          columns={[
            { key: "date", header: "วันที่", sortKey: "date", cell: (g) => fmtD(g.date) },
            { key: "project", header: "โปรเจค", sortKey: "project", cell: (g) => g.projectCode },
            { key: "order", header: "Release Order", sortKey: "order", cell: (g) => g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? "-") },
            { key: "parts", header: "Part No.", sortKey: "parts", align: "right", cell: (g) => `${fmtNum(g.releases.length)} Part` },
            { key: "qty", header: "จำนวน", sortKey: "qty", align: "right", cell: (g) => `${fmtNum(g.totalQty)} ชิ้น` },
            { key: "progress", header: "ความคืบหน้า", sortKey: "progress", tdStyle: { whiteSpace: "nowrap" },
              cell: (g, i, c) => c.statsReady && c.gPct !== null ? <ProgressBar pct={c.gPct} finished={c.gFinished} total={c.gTotal} /> : <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span> },
            { key: "weight", header: "น้ำหนักรวม", sortKey: "weight", align: "right", cell: (g) => g.totalWeight ? `${fmtNum(g.totalWeight)} กก.` : "-" },
            { key: "remark", header: "หมายเหตุ", cell: (g) => g.notes.size === 0 ? "-" : g.notes.size === 1 ? [...g.notes][0] : `${g.notes.size} หมายเหตุ` },
          ]} />
      </Card>

      {showAdd && (
        <AddReleaseModal
          user={user}
          projects={projects}
          parts={parts}
          onClose={() => setShowAdd(false)}
          onNeedProject={() => setShowNewProject(true)}
          onSaved={async ({ releaseOrder, releasesCreated, partsCreated, unitsCreated }) => {
            setShowAdd(false);
            await load();
            mlsToast(
              `บันทึก ${releaseOrder} สำเร็จ: ${releasesCreated} รายการ Part` +
              (unitsCreated ? ` · สร้าง QR ${unitsCreated} ใบ` : "") +
              (partsCreated > 0 ? ` · สร้าง Part ใหม่ ${partsCreated} รายการ` : ""),
              "success"
            );
          }}
        />
      )}

      {showImport && (
        <ImportReleaseModal
          user={user}
          projects={projects}
          parts={parts}
          onClose={() => setShowImport(false)}
          onImported={async ({ unitsCreated, releasesCreated, partsCreated }) => {
            await load();
            mlsToast(
              `นำเข้าสำเร็จ: สร้าง ${releasesCreated} release (${unitsCreated} QR)` +
              (partsCreated > 0
                ? ` · สร้าง Part ใหม่ ${partsCreated} รายการ · ⚠ Part ใหม่ยังไม่มี Routing — ไปตั้งขั้นตอนที่ Setup > Part Master ก่อน ไม่งั้นชิ้นงานจะไม่ขึ้นสถานะ "เสร็จ"`
                : ""),
              partsCreated > 0 ? "warn" : "success"
            );
          }}
        />
      )}

      {showSubAsm && (
        <AssemblyReleaseModal
          user={user}
          projects={projects}
          onClose={() => setShowSubAsm(false)}
          onNeedProject={() => setShowNewProject(true)}
          onSaved={async ({ releaseOrder, groups }) => {
            setShowSubAsm(false);
            await load();
            mlsToast(`บันทึก ${releaseOrder} สำเร็จ — ${groups} เบอร์ (ตั้ง BOM/ปล่อยงานแล้ว)`, "success");
          }}
        />
      )}

      {showBunk && (
        <BunkImportModal
          user={user}
          projects={projects}
          onClose={() => setShowBunk(false)}
          onNeedProject={() => setShowNewProject(true)}
          onSaved={async ({ releaseOrder, bunks, createdUnits }) => {
            setShowBunk(false);
            await load();
            const warn = createdUnits && createdUnits.length;
            mlsToast(
              `นำเข้าบั้งสำเร็จ: ${bunks} บั้ง (${releaseOrder})` +
              (warn ? ` · ⚠ สร้างยูนิตใหม่ ${createdUnits.length} รายการที่ยังไม่มีในระบบ (ยังไม่มี QR ให้สแกน) — ${createdUnits.slice(0, 8).join(", ")}${createdUnits.length > 8 ? "…" : ""} · ปล่อยงานยูนิตเหล่านี้ก่อนถึงจะสแกนแพ็กได้` : ""),
              warn ? "warn" : "success"
            );
          }}
        />
      )}

      {showNewProject && (
        <QuickAddProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(project) => {
            setProjects((prev) => [...prev, project].sort((a, b) => a.code.localeCompare(b.code)));
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 2) SCAN — station setup, then a dedicated full-screen scan flow
// ══════════════════════════════════════════════════════════════════════════
// เครื่องจักร + ขั้นตอนไม่ให้เลือกเองอีกต่อไป — ผูกไว้กับตัวพนักงานแล้วตั้งแต่ตอนล็อกอิน
// (ตั้งค่าที่ Setup > พนักงาน) พนักงานที่ยังไม่ได้ตั้งค่าจะสแกนไม่ได้ จนกว่า Admin จะตั้งให้
// ── Scan mode constants ────────────────────────────────────────────────────
// "station" = หน้าเครื่อง: auto-save ทันทีที่สแกน ตามลำดับ routing เลย ไม่ต้องกดยืนยัน
// "mobile"  = มือถือ: แสดงข้อมูลชิ้นงาน + รอกดยืนยันก่อนบันทึก (ป้องกันสแกนผิด)
const SCAN_MODES = [
  {
    value: "station",
    label: "หน้าเครื่อง",
    sub: "สแกนทีละชิ้น มีเสียง · ค้าง 4 วิ แล้วต่อเอง",
    icon: "machine",
    tone: "accent",
  },
  {
    value: "mobile",
    label: "มือถือ",
    sub: "ตรวจสอบแล้วกดยืนยันก่อนบันทึก",
    icon: "camera",
    tone: "steel",
  },
];

function ScanPage({ user }) {
  const [stationOpen, setStationOpen] = useState(false);
  // จำโหมดที่เลือกไว้ในหน้านี้ (ไม่ข้ามหน้า)
  const [scanMode, setScanMode] = useState("station");
  const ready = !!(user.machine && user.operation);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">สแกนหน้าเครื่องจักร</div>
          <div className="page-sub">เลือกโหมดให้ตรงกับวิธีใช้งาน แล้วกด "เริ่มสแกน"</div>
        </div>
      </div>

      {/* ── สถานีของคุณ ─────────────────────────────────────── */}
      <Card title="สถานีของคุณ">
        {ready ? (
          <div className="grid-2" style={{ marginBottom: 0 }}>
            <div>
              <div className="label-el">เครื่อง/สถานีประจำ</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{user.machine.code} — {user.machine.name}</div>
            </div>
            <div>
              <div className="label-el">ขั้นตอนประจำ</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{user.operation.name}</div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <Icon name="scan" size={32} />
            <div className="empty-state-title">ยังไม่ได้ตั้งค่าเครื่อง/สถานี/ขั้นตอนประจำ</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              แจ้ง Admin ให้ตั้งค่าที่ Setup → พนักงาน ก่อน จึงจะเริ่มสแกนได้
            </div>
          </div>
        )}
      </Card>

      {/* ── เลือกโหมดสแกน ────────────────────────────────────── */}
      {ready && (
        <Card title="เลือกโหมดสแกน">
          <div className="scan-mode-grid">
            {SCAN_MODES.map((m) => (
              <button
                key={m.value}
                className={`scan-mode-card${scanMode === m.value ? " active" : ""}`}
                onClick={() => setScanMode(m.value)}
              >
                <div className={`scan-mode-icon tone-${m.tone}`}>
                  <Icon name={m.icon} size={22} />
                </div>
                <div className="scan-mode-label">{m.label}</div>
                <div className="scan-mode-sub">{m.sub}</div>
                {scanMode === m.value && (
                  <div className="scan-mode-badge">
                    <Icon name="check" size={11} /> เลือกอยู่
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* คำอธิบายโหมดที่เลือก */}
          <div className="scan-mode-hint">
            {scanMode === "station" ? (
              <>
                <Icon name="bolt" size={13} style={{ flexShrink: 0 }} />
                <span>
                  <strong>หน้าเครื่อง</strong> — สแกน <strong>ทีละชิ้น</strong>: ยิง QR 1 ชิ้น → มีเสียงและแจ้งเตือนผล
                  → ค้างผล 4 วิ แล้ว<strong>สแกนชิ้นถัดไปได้เองอัตโนมัติ</strong> (ไม่ต้องกด · กันยิงรัวและสแกนซ้ำในจังหวะเดียว) เครื่อง/ขั้นตอน/พนักงานบันทึกอัตโนมัติ
                </span>
              </>
            ) : (
              <>
                <Icon name="check" size={13} style={{ flexShrink: 0 }} />
                <span>
                  <strong>มือถือ</strong> — สแกน QR แล้วดูข้อมูลชิ้นงานก่อน กดยืนยันเองเพื่อบันทึก
                  เหมาะสำหรับตรวจสอบหรือสแกนนอกสถานีเครื่อง
                </span>
              </>
            )}
          </div>

          <Btn variant="accent" size="lg" className="btn-block" style={{ marginTop: 14 }} onClick={() => setStationOpen(true)}>
            <Icon name="scan" size={18} /> เริ่มสแกน — โหมด{scanMode === "station" ? "หน้าเครื่อง" : "มือถือ"}
          </Btn>
        </Card>
      )}

      {stationOpen && (
        <ScanStation
          user={user} machine={user.machine} operation={user.operation}
          mode={scanMode}
          onExit={() => setStationOpen(false)}
        />
      )}
    </div>
  );
}

// กรอบวงเล็บสีขาว (แบบกล้องมือถือ) ที่ขยับไปสวมพอดีกับตำแหน่ง QR ที่กำลังอ่านอยู่จริง —
// ไม่ใช่กรอบคงที่กลางจอ เพื่อให้รู้ชัดว่ากำลังอ่าน QR อันไหนเวลามีหลายอันอยู่ในเฟรมเดียวกัน
// box: { left, top, width, height } เป็นเปอร์เซ็นต์เทียบกับพื้นที่วิดีโอ (มาจากตำแหน่งจริงที่ jsQR ตรวจเจอ)
function QrBracketFrame({ box, frozen }) {
  if (!box) return null;
  const c = frozen ? "#22c55e" : "#ffffff";
  const corner = (top, left, right, bottom) => ({
    position: "absolute", width: 22, height: 22,
    top, left, right, bottom,
    borderTop: top !== undefined ? `3px solid ${c}` : undefined,
    borderBottom: bottom !== undefined ? `3px solid ${c}` : undefined,
    borderLeft: left !== undefined ? `3px solid ${c}` : undefined,
    borderRight: right !== undefined ? `3px solid ${c}` : undefined,
    borderTopLeftRadius: top !== undefined && left !== undefined ? 8 : undefined,
    borderTopRightRadius: top !== undefined && right !== undefined ? 8 : undefined,
    borderBottomLeftRadius: bottom !== undefined && left !== undefined ? 8 : undefined,
    borderBottomRightRadius: bottom !== undefined && right !== undefined ? 8 : undefined,
    filter: "drop-shadow(0 0 2px rgba(0,0,0,.6))",
  });
  return (
    <div
      style={{
        position: "absolute", pointerEvents: "none",
        left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`,
        transition: "left .08s linear, top .08s linear, width .08s linear, height .08s linear",
      }}
    >
      <div style={corner(-2, -2, undefined, undefined)} />
      <div style={corner(-2, undefined, -2, undefined)} />
      <div style={corner(undefined, -2, undefined, -2)} />
      <div style={corner(undefined, undefined, -2, -2)} />
    </div>
  );
}

// แปลงจุดมุมทั้ง 4 ที่ jsQR หาเจอ (พิกัดพิกเซลของเฟรม) ให้เป็นกรอบสี่เหลี่ยม (เปอร์เซ็นต์) พร้อม padding เผื่อขอบเล็กน้อย
function boxFromQrLocation(location, frameW, frameH) {
  const xs = [location.topLeftCorner.x, location.topRightCorner.x, location.bottomLeftCorner.x, location.bottomRightCorner.x];
  const ys = [location.topLeftCorner.y, location.topRightCorner.y, location.bottomLeftCorner.y, location.bottomRightCorner.y];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = (maxX - minX) * 0.12, padY = (maxY - minY) * 0.12;
  const left = Math.max(0, minX - padX), top = Math.max(0, minY - padY);
  const right = Math.min(frameW, maxX + padX), bottom = Math.min(frameH, maxY + padY);
  return {
    left: (left / frameW) * 100, top: (top / frameH) * 100,
    width: ((right - left) / frameW) * 100, height: ((bottom - top) / frameH) * 100,
  };
}

function ScanStation({ user, machine, operation, mode = "station", onExit }) {
  const isStation = mode === "station"; // true = หน้าเครื่อง (auto-save), false = มือถือ (ยืนยันก่อน)

  const [qrInput, setQrInput] = useState("");
  const [unit, setUnit] = useState(null);
  const [history, setHistory] = useState([]);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState("muted");
  // เปิดกล้องอัตโนมัติทันทีที่เข้าหน้าสแกน — พร้อมสแกนเลยไม่ต้องกดเปิดเอง
  const [cameraOn, setCameraOn] = useState(true);
  // frozen = เจอ QR แล้ว ภาพค้างไว้ (ไม่สแกนซ้ำ) จนกว่าจะยืนยันหรือกดรีเฟรช
  const [frozen, setFrozen] = useState(false);
  const [qrBox, setQrBox] = useState(null); // ตำแหน่ง QR ล่าสุดที่เจอ (เปอร์เซ็นต์) ใช้วาดกรอบให้สวมพอดี
  const [videoAspect, setVideoAspect] = useState("3 / 4");
  const [sessionCount, setSessionCount] = useState(0);
  // station mode: toast ชั่วคราวบนกล้อง (success / warning / danger) แทน bottom sheet
  const [toast, setToast] = useState(null); // { text, tone }
  const toastTimerRef = useRef(null);
  // หน้าเครื่อง: ผลสแกนล่าสุดที่ "ค้างไว้" 4 วิ (สแกนทีละชิ้น) แล้วสแกนชิ้นถัดไปได้เองอัตโนมัติ
  const [stationResult, setStationResult] = useState(null); // { ok, msg, tone, finished, code }
  const [countdown, setCountdown] = useState(0);            // วินาทีที่เหลือก่อนสแกนต่ออัตโนมัติ
  const STATION_HOLD_SEC = 4;

  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [pending, setPending] = useState(scanQueueCount()); // จำนวนสแกนค้างในคิวออฟไลน์

  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // แคนวาสที่ซ่อนไว้ ใช้แค่ถอดพิกเซลไปให้ jsQR อ่าน ไม่ได้แสดงผล
  const streamRef = useRef(null);
  const trackRef = useRef(null);  // video track (ใช้เปิด/ปิดไฟฉาย)
  const rafRef = useRef(null);
  const frozenRef = useRef(false);
  const lastScanRef = useRef({ code: "", at: 0 }); // debounce กันอ่านโค้ดเดิมซ้ำรัวๆ
  const lastDecodeRef = useRef(0);                  // throttle การถอด jsQR
  const stationTimerRef = useRef(null);             // ตัวจับเวลานับถอยหลัง 4 วิ (auto-advance)

  useEffect(() => { inputRef.current?.focus(); }, [unit]);
  useEffect(() => { frozenRef.current = frozen; }, [frozen]);

  // ติดตามจำนวนคิวออฟไลน์ + พยายามซิงค์เมื่อเข้าหน้าสแกน
  useEffect(() => {
    flushScanQueue().then(() => setPending(scanQueueCount()));
    const off = onScanQueue((n) => setPending(n));
    return off;
  }, []);

  // แสดง toast บนกล้อง (station mode) แล้วหายเองหลัง delay ms
  function showToast(text, tone = "success", delay = 2000) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), delay);
  }
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // เปิดกล้อง — บังคับใช้กล้องหลัง (ตัวหลัก ไม่ใช่ ultra-wide/telephoto) พร้อมสแกนทันที
  // และวนอ่านเฟรมด้วย jsQR เพื่อรู้ตำแหน่งจริงของ QR ในภาพ (เอาไว้วาดกรอบให้สวมพอดี)
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;

    function onDecoded(decodedText) {
      if (frozenRef.current) return; // มีผลค้างอยู่แล้ว รอยืนยัน/รีเฟรชก่อน
      // debounce: กันอ่านโค้ดเดิมซ้ำรัวๆ (เช่น QR เดิมยังค้างในเฟรมหลังบันทึกไปแล้ว)
      const nowT = Date.now();
      if (decodedText === lastScanRef.current.code && nowT - lastScanRef.current.at < 2500) return;
      lastScanRef.current = { code: decodedText, at: nowT };
      frozenRef.current = true;
      setFrozen(true);
      videoRef.current?.pause(); // ค้างภาพไว้ให้เห็นว่าเจอชิ้นไหน
      setQrInput(decodedText);
      lookup(decodedText);
    }

    async function pickRearDeviceId() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const back = devices.filter((d) => d.kind === "videoinput" && /back|rear|environment/i.test(d.label || ""));
        // เลี่ยงเลนส์ ultra-wide / telephoto ถ้ามีตัวเลือก เอากล้องหลังตัวหลักจริงๆ
        const main = back.find((d) => !/ultra|wide[\s-]?angle|tele(photo)?|0\.5x/i.test(d.label || "")) || back[0];
        return main?.deviceId || null;
      } catch (_) {
        return null; // ยังไม่ได้สิทธิ์กล้อง (ชื่อกล้องจะยังไม่ขึ้น) — ไปใช้ facingMode แทน
      }
    }

    async function openCamera() {
      const deviceId = await pickRearDeviceId();
      if (cancelled) return;
      const attempts = [
        deviceId ? { video: { deviceId: { exact: deviceId } } } : null,
        { video: { facingMode: { exact: "environment" } } },
        { video: { facingMode: "environment" } },
      ].filter(Boolean);
      let stream = null;
      for (const constraints of attempts) {
        try { stream = await navigator.mediaDevices.getUserMedia(constraints); break; } catch (_) { /* ลองตัวถัดไป */ }
      }
      if (cancelled) { stream?.getTracks().forEach((t) => t.stop()); return; }
      if (!stream) { setMsg("เปิดกล้องไม่สำเร็จ — ตรวจสอบสิทธิ์การเข้าถึงกล้อง"); setMsgTone("danger"); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) setVideoAspect(`${video.videoWidth} / ${video.videoHeight}`);
      };
      try { await video.play(); } catch (_) {}
      // เก็บ track ไว้เปิด/ปิดไฟฉาย + ตรวจว่ารองรับไหม
      const track = stream.getVideoTracks?.()[0] || null;
      trackRef.current = track;
      try { const caps = track?.getCapabilities?.(); setTorchSupported(!!(caps && caps.torch)); } catch (_) { setTorchSupported(false); }
      setTorchOn(false);
      decodeLoop();
    }

    async function decodeLoop() {
      const jsQRModule = await import("jsqr");
      const jsQR = jsQRModule.default || jsQRModule;
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        if (cancelled) return;
        // throttle การถอด QR ~9 ครั้ง/วินาที (พอสำหรับสแกน แต่ลดภาระ CPU/แบตมือถือ)
        const nowT = Date.now();
        if (!frozenRef.current && video.readyState === video.HAVE_ENOUGH_DATA && nowT - lastDecodeRef.current > 110) {
          lastDecodeRef.current = nowT;
          const w = video.videoWidth, h = video.videoHeight;
          if (w && h) {
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const code = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
            if (code) { setQrBox(boxFromQrLocation(code.location, w, h)); onDecoded(code.data); }
            else setQrBox(null);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    }

    openCamera();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      trackRef.current = null;
      setTorchSupported(false); setTorchOn(false);
      setQrBox(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  // เปิด/ปิดไฟฉาย (ถ้าอุปกรณ์รองรับ) — ช่วยสแกนในพื้นที่มืด
  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn((v) => !v); }
    catch (_) { setTorchSupported(false); }
  }

  // กลับไปสแกนต่อ — เล่นวิดีโอต่อ + เคลียร์กรอบเดิม ให้ jsQR เริ่มตามหา QR ใหม่
  function resumeScanning() {
    frozenRef.current = false;
    setFrozen(false);
    setQrBox(null);
    videoRef.current?.play().catch(() => {});
  }

  function clearStationTimer() {
    if (stationTimerRef.current) { clearInterval(stationTimerRef.current); stationTimerRef.current = null; }
  }

  // ยกเลิกผลที่ค้างไว้ แล้วสแกนใหม่ (โดยไม่ต้องกดยืนยัน)
  function rescan() {
    clearStationTimer(); setCountdown(0);
    setUnit(null); setHistory([]); setMsg(""); setQrInput(""); setStationResult(null);
    resumeScanning();
  }

  // หน้าเครื่อง: สแกนชิ้นถัดไป (เคลียร์ผลที่ค้าง + เริ่มสแกนใหม่) — เรียกอัตโนมัติเมื่อครบ 4 วิ หรือกดเอง
  function nextScan() {
    clearStationTimer(); setCountdown(0);
    setStationResult(null);
    setQrInput(""); setUnit(null); setHistory([]);
    // คงการ debounce โค้ดล่าสุดไว้ชั่วครู่ กันสแกน "ชิ้นเดิม" ที่ยังค้างในเฟรมซ้ำทันที
    lastScanRef.current = { code: lastScanRef.current.code, at: Date.now() };
    resumeScanning();
    inputRef.current?.focus();
  }

  // เริ่มนับถอยหลัง 4 วิ แล้วสแกนชิ้นถัดไปให้เองอัตโนมัติ
  function startStationHold() {
    clearStationTimer();
    let n = STATION_HOLD_SEC;
    setCountdown(n);
    stationTimerRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { nextScan(); }
      else setCountdown(n);
    }, 1000);
  }

  // เคลียร์ timer เมื่อออกจากหน้าสแกน
  useEffect(() => () => clearStationTimer(), []);

  // ── core save logic — shared between both modes ────────────────────────
  // คืนค่า { ok, msg, tone } เพื่อให้ caller ตัดสินใจจะแสดงผลยังไง (toast vs sheet-msg)
  // แปลงผลลัพธ์ RPC เป็นข้อความ/โทน (+ เสียง/สั่น) — ใช้ร่วมทั้ง 2 โหมด
  function interpret(res) {
    if (res.queued) {
      const r = { ok: true, msg: "บันทึกออฟไลน์ไว้แล้ว — จะซิงค์อัตโนมัติเมื่อเน็ตกลับ", tone: "warning" };
      feedback("warning"); return r;
    }
    if (!res.ok) {
      const reasonMsg = {
        not_found: "ไม่พบชิ้นงานนี้ในระบบ",
        machine_cannot: `เครื่อง ${machine?.code || ""} ไม่ได้ตั้งค่าให้ทำขั้นตอน "${operation?.name || ""}"`,
        duplicate: `ผ่านขั้นตอน "${operation?.name || ""}" ไปแล้ว — ไม่บันทึกซ้ำ`,
        no_station: "บัญชีนี้ยังไม่ได้ตั้งเครื่อง/สถานี/ขั้นตอนประจำ — แจ้ง Admin",
        unauthorized: "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่",
        storage_full: "ที่เก็บข้อมูลในเครื่องเต็ม — บันทึกไม่สำเร็จ ลบข้อมูล/แอปอื่นแล้วลองใหม่",
        error: "บันทึกไม่สำเร็จ" + (res.message ? ": " + res.message : ""),
      };
      const tone = res.reason === "duplicate" ? "warning" : "danger";
      feedback(tone);
      return { ok: false, msg: reasonMsg[res.reason] || "บันทึกไม่สำเร็จ", tone };
    }
    const total = res.total || 0, step = res.step || 0;
    let msg, tone;
    if (res.finished) { msg = "✓ ครบทุกขั้นตอนแล้ว!"; tone = "success"; }
    else if (res.out_of_order) { msg = `⚠ บันทึกแล้ว (ขั้นตอน "${operation?.name || ""}" — ลำดับไม่ตรง routing)`; tone = "warning"; }
    else { msg = total > 0 ? `✓ บันทึกแล้ว — ขั้น ${step}/${total}` : "✓ บันทึกการสแกนเรียบร้อย"; tone = "success"; }
    feedback(tone);
    return { ok: true, msg, tone, finished: res.finished };
  }

  // โหมดมือถือ: บันทึกด้วย unit ที่ lookup ไว้แล้ว (เครื่อง/ขั้นตอน/พนักงานมาจาก token)
  async function doSave(u) {
    if (!u) return { ok: false, msg: "ข้อมูลไม่ครบ", tone: "danger" };
    return interpret(await recordScan({ unitId: u.id }));
  }

  async function lookup(code) {
    const c = (code ?? qrInput).trim();
    if (!c) return;
    // หน้าเครื่อง: ถ้ายังมีผลสแกนค้างอยู่ ไม่รับสแกนใหม่ (รวมถึงเครื่องยิงบาร์โค้ด) จนกดสแกนชิ้นถัดไป
    if (isStation && stationResult) return;
    if (isStation) {
      // หน้าเครื่อง: สแกน "ทีละชิ้น" — บันทึกแล้วค้างภาพ + ค้างผลไว้ (มีเสียง+แจ้งเตือน)
      // ต้องกด "สแกนชิ้นถัดไป" ก่อนจึงจะสแกนต่อ → กันยิงรัว และกันสแกนซ้ำในจังหวะเดียวกัน
      frozenRef.current = true; setFrozen(true); videoRef.current?.pause();
      const result = interpret(await recordScanByQr(c)); // interpret เล่นเสียง/สั่นให้แล้ว
      if (result.ok) setSessionCount((n) => n + 1);
      setStationResult({ ...result, code: c });
      startStationHold(); // ค้างผล 4 วิ แล้วสแกนชิ้นถัดไปเองอัตโนมัติ
    } else {
      // มือถือ: lookup แล้วแสดงใน sheet รอกดยืนยัน
      setMsg("กำลังค้นหา..."); setMsgTone("muted");
      const u = await findUnitByQr(c);
      if (!u) { setUnit(null); setHistory([]); setMsg("ไม่พบ QR นี้ในระบบ"); setMsgTone("danger"); return; }
      const h = await getUnitHistory(u.id);
      setUnit(u); setHistory(h); setMsg("");
      const doneOps = h.map((x) => x.operation?.name).filter(Boolean);
      const next = nextOpFor(u.part_master?.routing, doneOps);
      if (next && operation && next !== operation.name) {
        setMsg(`ขั้นตอนถัดไปของชิ้นนี้คือ "${next}" ไม่ใช่ "${operation.name}" — ตรวจสอบก่อนบันทึก`);
        setMsgTone("warning");
      }
    }
  }

  function onQrKeyDown(e) { if (e.key === "Enter") { e.preventDefault(); lookup(); } }

  // มือถือ mode เท่านั้น — กดยืนยันก่อนบันทึก
  async function confirmScan() {
    if (!unit) return;
    const result = await doSave(unit);
    if (result.ok) {
      setMsg(result.msg);
      setMsgTone(result.tone);
      setSessionCount((c) => c + 1);
      setQrInput(""); setUnit(null); setHistory([]);
      resumeScanning();
      setTimeout(() => setMsg(""), 2500);
    } else {
      setMsg(result.msg);
      setMsgTone(result.tone);
    }
    inputRef.current?.focus();
  }

  const doneOps = history.map((x) => x.operation?.name).filter(Boolean);

  return (
    <div className="scan-station">
      <div className="scan-topbar">
        <div className="icon-btn" onClick={onExit} style={{ background: "rgba(255,255,255,.08)", borderColor: "rgba(255,255,255,.14)" }}>
          <Icon name="arrowLeft" size={18} style={{ stroke: "#fff" }} />
        </div>
        <div className="scan-topbar-info">
          <div className="scan-topbar-title">{machine?.code} — {machine?.name}</div>
          <div className="scan-topbar-sub">
            ขั้นตอน: {operation?.name}
            <span className={`scan-mode-pill ${isStation ? "station" : "mobile"}`}>
              {isStation ? "หน้าเครื่อง" : "มือถือ"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div className="scan-counter">สแกนแล้ว {sessionCount} ชิ้น</div>
          {pending > 0 && (
            <div className="scan-counter" style={{ color: "var(--warning)", background: "rgba(245,158,11,.16)", borderColor: "rgba(245,158,11,.4)" }}
              title="สแกนที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ (จะซิงค์อัตโนมัติเมื่อเน็ตกลับ)">
              <Icon name="clock" size={13} style={{ verticalAlign: "-2px", marginInlineEnd: 4 }} />ค้างซิงค์ {pending}
            </div>
          )}
        </div>
      </div>

      <div className="scan-viewport">
        {cameraOn ? (
          <div style={{ position: "relative", width: "min(92vw,420px)", aspectRatio: videoAspect, overflow: "hidden", borderRadius: 16, background: "#000" }}>
            <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <QrBracketFrame box={qrBox} frozen={frozen} />
            {!qrBox && !frozen && (
              <div style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                whiteSpace: "nowrap", fontSize: 12, color: "#fff", background: "rgba(0,0,0,.5)",
                padding: "4px 10px", borderRadius: 20, pointerEvents: "none",
              }}>
                เล็งกล้องไปที่ QR code
              </div>
            )}
            {/* Toast overlay — แสดงเฉพาะ station mode */}
            {toast && (
              <div className={`scan-toast tone-${toast.tone}`}>
                {toast.tone === "success" && <Icon name="check" size={15} />}
                {toast.tone === "warning" && <Icon name="clock" size={15} />}
                {toast.tone === "danger" && <Icon name="close" size={15} />}
                {toast.text}
              </div>
            )}
          </div>
        ) : unit ? (
          <div className="scan-idle-hint">
            <Icon name="check" size={40} />
            <div>พบชิ้นงานแล้ว — ดูรายละเอียดด้านล่าง</div>
          </div>
        ) : (
          <div className="scan-frame">
            <div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" />
            <div className="scan-line" />
            {/* Toast overlay เมื่อกล้องปิด */}
            {toast && (
              <div className={`scan-toast scan-toast-center tone-${toast.tone}`}>
                {toast.text}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="scan-manual">
        <div style={{ display: "flex", gap: 8 }}>
          <Input ref={inputRef} value={qrInput} onChange={(e) => setQrInput(e.target.value)} onKeyDown={onQrKeyDown}
            placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัส QR แล้วกด Enter" autoFocus />
          <Btn variant="accent" onClick={() => lookup()}><Icon name="search" size={16} /></Btn>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn scan-toggle-cam" style={{ marginTop: 0, flex: 1 }} onClick={() => setCameraOn((v) => !v)}>
            <Icon name="camera" size={15} style={{ marginRight: 6 }} />{cameraOn ? "ปิดกล้อง" : "เปิดกล้องสแกน QR"}
          </button>
          {cameraOn && torchSupported && (
            <button className="btn scan-toggle-cam" style={{ marginTop: 0, width: 120, borderStyle: "solid",
              background: torchOn ? "rgba(245,158,11,.18)" : "transparent",
              borderColor: torchOn ? "var(--warning)" : "rgba(255,255,255,.22)",
              color: torchOn ? "var(--warning)" : "rgba(255,255,255,.75)" }} onClick={toggleTorch}>
              <Icon name="bolt" size={15} style={{ marginRight: 6 }} />{torchOn ? "ปิดไฟ" : "ไฟฉาย"}
            </button>
          )}
        </div>
      </div>

      {/* Station mode: ผลสแกนทีละชิ้น — ค้างไว้จนกดสแกนชิ้นถัดไป */}
      {isStation && stationResult && (
        <div className="scan-sheet">
          <div className="scan-sheet-handle" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "2px 4px 6px", textAlign: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: stationResult.tone === "success" ? "rgba(34,197,94,.15)" : stationResult.tone === "warning" ? "rgba(245,158,11,.15)" : "rgba(239,68,68,.15)",
            }}>
              <Icon
                name={stationResult.tone === "success" ? "check" : stationResult.tone === "warning" ? "clock" : "close"}
                size={30}
                style={{ stroke: stationResult.tone === "success" ? "var(--success)" : stationResult.tone === "warning" ? "var(--warning)" : "var(--danger)" }}
              />
            </div>
            <div style={{
              fontSize: 15.5, fontWeight: 700, lineHeight: 1.4,
              color: stationResult.tone === "success" ? "var(--success)" : stationResult.tone === "warning" ? "var(--warning)" : "var(--danger)",
            }}>{stationResult.msg}</div>
            {stationResult.code && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--muted)", wordBreak: "break-all" }}>{stationResult.code}</div>
            )}
          </div>
          <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            พร้อมสแกนชิ้นถัดไปใน <b style={{ color: "var(--accent-dk)", fontSize: 15 }}>{countdown}</b> วิ…
          </div>
          <Btn variant="ghost" size="lg" className="btn-block" onClick={nextScan}>
            <Icon name="scan" size={18} /> สแกนต่อทันที
          </Btn>
        </div>
      )}

      {/* Mobile mode only: bottom sheet ยืนยันก่อนบันทึก */}
      {!isStation && (msg || unit) && (
        <div className="scan-sheet">
          <div className="scan-sheet-handle" />
          {msg && (
            <div className="scan-msg" style={{
              color: msgTone === "danger" ? "var(--danger-hi)" : msgTone === "warning" ? "var(--warning)" : msgTone === "success" ? "var(--success-hi)" : "var(--text)",
            }}>{msg}</div>
          )}
          {unit && (
            <div style={{ padding: "0 2px" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>
                {unit.qr_code}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
                {unit.part_master?.part_no} — {unit.part_master?.part_name}
              </div>
              <RoutingRail routing={unit.part_master?.routing} doneOps={doneOps} />
              <div className="scan-info-grid">
                <div className="scan-info-cell">
                  <div className="scan-info-label">โปรเจค</div>
                  <div className="scan-info-value">{unit.part_master?.projects?.name || "-"}</div>
                </div>
                <div className="scan-info-cell">
                  <div className="scan-info-label">Release</div>
                  <div className="scan-info-value">{unit.release?.release_date ? fmtDT(unit.release.release_date) : "-"}</div>
                </div>
                <div className="scan-info-cell">
                  <div className="scan-info-label">น้ำหนัก</div>
                  <div className="scan-info-value">{unit.weight ? `${fmtNum(unit.weight)} กก.` : "-"}</div>
                </div>
                <div className="scan-info-cell">
                  <div className="scan-info-label">ความยาว</div>
                  <div className="scan-info-value">{unit.length_mm ? `${fmtNum(unit.length_mm)} มม.` : "-"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="success" size="lg" className="btn-block" onClick={confirmScan}>
                  <Icon name="check" size={17} /> ยืนยันการสแกน
                </Btn>
                <Btn variant="ghost" size="lg" onClick={rescan} title="สแกนใหม่โดยไม่บันทึกรายการนี้">
                  <Icon name="refresh" size={17} />
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 3) FINISHED PART
// ══════════════════════════════════════════════════════════════════════════
// เนื้อหา Finished Part (สถิติ + ตาราง) — ฝังในหน้า Report
// ★ เดิมดึง part_units ที่ status = 'finished' — แต่งานจริงบันทึกที่หน้าเครื่อง (machine_records แบบจำนวน)
//   ซึ่งไม่เคยเปลี่ยน part_units.status → รายงานนี้ขึ้น 0 ตลอด
// ★ กติกา "ชิ้นที่เสร็จ" (ผู้ใช้กำหนด): ตามรูทของเครื่อง — หน้าเครื่องกด Finished = เสร็จ
//   เครื่องทำ/ติ๊กขั้นตอนไหนไว้ก็ตามนั้น (ไม่ใช้ part_master.routing ซึ่งปล่อยงาน/นำเข้า Excel บันทึกว่างอยู่แล้ว)
//   · ต่อชิ้น/QR นับ max(จำนวนที่กด Finished) กันนับซ้ำ (co-tick 0 / สแกนซ้ำ / หลายเครื่อง) — RPC release_finished_pieces
//   · รวมชิ้นสแกนสำนักงานแบบเดิม (part_units.status) · ไม่เกินจำนวนสั่ง (ส่วนเกิน = สแปร์)
//   · ยังไม่ได้รัน migration-finished-pieces.sql → ใช้ค่าประมาณจาก release_op_progress (ขั้นตอนที่มีชิ้นเสร็จมากสุด)
//   ยอดสะสมทั้งหมด (ไม่ขึ้นกับช่วงเวลา) · กรองตาม โปรเจค / Part / Release Order ของหน้า Report
function FinishedPartSection({ releases: relsIn, projectFilter = "", partFilter = "", releaseFilter = "" }) {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const [rels, setRels] = useState(relsIn || null);
  const [prog, setProg] = useState(null);     // { fin, opProg, unitStats, needSql } · null = กำลังโหลด
  const [err, setErr] = useState("");
  const sort = useTableSort();
  useEffect(() => { if (relsIn) setRels(relsIn); }, [relsIn]);
  useEffect(() => { if (!relsIn) getReleasesFull().then(setRels).catch(() => setRels([])); }, [relsIn]);
  useEffect(() => {
    if (!rels) return;
    let alive = true;
    setProg(null); setErr("");
    const ids = rels.map((r) => r.id).filter(Boolean);
    const CH = 400;   // แบ่งก้อน ids กัน body RPC ใหญ่เกิน (ที่ 10 ปี releases หลายพัน)
    const chunks = [];
    for (let i = 0; i < ids.length; i += CH) chunks.push(ids.slice(i, i + CH));
    (async () => {
      const fin = {}, opProg = {}, unitStats = {};
      let needSql = false;
      // 1) ชิ้นที่กด Finished ต่อ Release (RPC ใหม่) — ถ้ายังไม่ได้รัน SQL → ตกไปใช้ค่าประมาณ
      try {
        const res = await Promise.all(chunks.map((c) => fetchReleaseFinishedPieces(c)));
        res.forEach((x) => Object.assign(fin, x || {}));
      } catch (e) {
        needSql = true;
        console.warn("release_finished_pieces ยังไม่มีใน DB — ใช้ค่าประมาณจาก release_op_progress", e);
        const res = await Promise.all(chunks.map((c) => getReleaseOpProgress(c)));
        res.forEach((x) => Object.assign(opProg, x || {}));
      }
      // 2) ชิ้นที่สแกนจากสำนักงานแบบเดิม
      const us = await Promise.all(chunks.map((c) => getUnitStatsByReleaseIds(c)));
      us.forEach((x) => Object.assign(unitStats, x || {}));
      if (alive) setProg({ fin, opProg, unitStats, needSql });
    })().catch((e) => { if (alive) { setErr(String(e?.message || e)); setProg({ fin: {}, opProg: {}, unitStats: {}, needSql: false }); } });
    return () => { alive = false; };
  }, [rels]);

  const allRows = useMemo(() => {
    if (!rels || !prog) return [];
    const out = [];
    for (const r of rels) {
      const qty = Number(r.qty) || 0;
      const f = prog.fin[r.id];
      let station = 0, machines = [], ops = [], lastAt = null;
      if (f) {
        station = Number(f.finished) || 0;
        machines = Array.isArray(f.machines) ? f.machines : [];
        lastAt = f.last_at || null;
      } else if (prog.needSql) {
        const po = prog.opProg[r.id] || [];
        station = po.reduce((m, o) => Math.max(m, Number(o.finished) || 0), 0);   // ค่าประมาณ: ขั้นตอนที่มีชิ้นเสร็จมากสุด
        ops = po.filter((o) => (Number(o.done) || 0) > 0).sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999)).map((o) => o.op);
      }
      const office = Number(prog.unitStats[r.id]?.finished) || 0;
      const raw = Math.max(office, station);
      const finished = qty > 0 ? Math.min(raw, qty) : raw;
      if (!(finished > 0)) continue;
      const w = Number(r.unit_weight) || 0;
      out.push({
        id: r.id, r, qty, finished, spare: qty > 0 ? Math.max(0, raw - qty) : 0,
        pct: qty > 0 ? (finished / qty) * 100 : 0,
        weight: finished * w, unitWeight: w,
        machines, ops, lastAt, officeOnly: station === 0 && office > 0,
        projectId: r.part_master?.project_id || null,
        projectName: r.part_master?.projects?.name || r.part_master?.projects?.code || "-",
        partNo: r.part_master?.part_no || "-", partName: r.part_master?.part_name || "",
        ro: r.release_order || "-", date: r.release_date || null,
        len: r.length_mm != null ? Number(r.length_mm) : null,
      });
    }
    out.sort((a, b) => String(b.lastAt || b.date || "").localeCompare(String(a.lastAt || a.date || "")));   // เสร็จล่าสุดก่อน
    return out;
  }, [rels, prog]);
  const rows = allRows.filter((x) =>
    (!projectFilter || x.projectId === projectFilter) &&
    (!partFilter || x.partNo === partFilter) &&
    (!releaseFilter || String(x.ro) === releaseFilter));
  const totalPcs = rows.reduce((s, x) => s + x.finished, 0);
  const totalWeight = rows.reduce((s, x) => s + x.weight, 0);
  const fullRel = rows.filter((x) => x.qty > 0 && x.finished >= x.qty).length;
  const loading = !rels || !prog;
  const chip = { fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99, whiteSpace: "nowrap", color: "#2563eb", background: "rgba(37,99,235,.10)", border: "1px solid rgba(37,99,235,.35)" };

  return (
    <>
      <div className="stat-row">
        <StatCard label={L("ชิ้นที่เสร็จทั้งหมด", "Total finished")} value={loading ? "…" : fmtNum(totalPcs)} icon="check" />
        <StatCard label={L("น้ำหนักวัสดุ (กก.)", "Material weight (kg)")} value={loading ? "…" : fmtNum(totalWeight)} icon="weight" />
        <StatCard label={L("Release ที่ทำครบแล้ว", "Releases complete")} value={loading ? "…" : `${fmtNum(fullRel)} / ${fmtNum(rows.length)}`} icon="check" />
      </div>
      <Card title={L("รายการชิ้นงานที่เสร็จ (ต่อ Release)", "Finished pieces (per Release)")}>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          {L(<><b>เสร็จ</b> = ชิ้นที่หน้าเครื่องกด <b>Finished</b> ตามรูทของเครื่อง (เครื่องติ๊กขั้นตอนไหนไว้ก็ตามนั้น) · ชิ้นเดียวกันกด Finished หลายเครื่อง/หลายครั้ง นับครั้งเดียว · ไม่เกินจำนวนสั่ง (ส่วนเกิน = สแปร์) · ยอด<b>สะสมทั้งหมด</b> ไม่ขึ้นกับช่วงเวลาด้านบน · กรองตามโปรเจค / Part / Release ที่เลือก</>,
             <><b>Finished</b> = pieces the machine terminal marked <b>Finished</b>, following each machine’s own route (whatever steps it ticked) · a piece finished on several machines/scans counts once · capped at the ordered qty (extra = spare) · <b>cumulative</b>, not limited to the period above · filtered by the selected project / Part / Release</>)}
        </div>
        {!loading && prog.needSql && (
          <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 12, padding: "8px 11px", borderRadius: 9, background: "rgba(217,122,0,.10)", border: "1px solid rgba(217,122,0,.35)", color: "var(--text)" }}>
            {L(<>⚠ ยังไม่ได้รัน <b>migration-finished-pieces.sql</b> ใน Supabase — ตอนนี้เป็นค่าประมาณ (ขั้นตอนที่มีชิ้นเสร็จมากสุด) และยังไม่แสดงเครื่อง</>,
               <>⚠ <b>migration-finished-pieces.sql</b> hasn’t been run in Supabase yet — numbers are an estimate (the step with the most finished pieces) and machines aren’t shown</>)}
          </div>
        )}
        {err && <div style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{L("โหลดข้อมูลไม่สำเร็จ: ", "Couldn't load: ")}{err}</div>}
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "18px 2px", textAlign: "center" }}>{L("กำลังโหลด…", "Loading…")}</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <Icon name="check" size={32} />
            <div className="empty-state-title">{L("ยังไม่มีชิ้นงานที่เสร็จ", "No finished pieces yet")}</div>
            <div className="empty-state-sub">{(projectFilter || partFilter || releaseFilter)
              ? L("ไม่มีชิ้นที่เสร็จตามตัวกรองที่เลือก — ลองเลือก \"ทุกโปรเจค\"", "No finished pieces match the selected filters — try \"All projects\"")
              : L("รายการจะขึ้นเมื่อหน้าเครื่องกด Finished", "Rows appear once a machine terminal marks pieces Finished")}</div>
          </div>
        ) : (
          <DataTable id="finished-parts" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
            rows={rows} rowKey={(x) => x.id} sort={sort}
            sortAccessors={{
              ro: (x) => x.ro, part: (x) => x.partNo, name: (x) => x.partName, proj: (x) => x.projectName,
              ordered: (x) => x.qty, finished: (x) => x.finished, weight: (x) => x.weight, len: (x) => x.len,
              mach: (x) => (x.machines[0]?.code || x.ops[0] || ""), last: (x) => x.lastAt || "", date: (x) => x.date || "",
            }}
            columns={[
              { key: "ro", header: "Release", sortKey: "ro", dataLabel: "Release", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }, cell: (x) => x.ro },
              { key: "part", header: "Part No.", sortKey: "part", dataLabel: "Part No.", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" },
                cell: (x) => <>{x.partNo}{x.r.mod_cancelled_at && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 5, background: "rgba(239,68,68,.11)", color: "var(--danger)" }}>{x.r.mod_cancel_keep === "moved" ? L("ย้ายหมดแล้ว", "all moved") : L("ยกเลิก", "cancelled")}</span>}</> },
              { key: "name", header: L("ชื่อ Part", "Part name"), sortKey: "name", tdStyle: { color: "var(--muted)", fontSize: 12.5, whiteSpace: "nowrap" }, cell: (x) => x.partName || "-" },
              { key: "proj", header: L("โปรเจค", "Project"), sortKey: "proj", tdStyle: { whiteSpace: "nowrap" }, cell: (x) => x.projectName },
              { key: "ordered", header: L("สั่ง", "Ordered"), sortKey: "ordered", align: "right", cell: (x) => fmtNum(x.qty) },
              { key: "finished", header: L("เสร็จ (ชิ้น)", "Finished (pcs)"), sortKey: "finished", align: "right",
                tdProps: (x) => ({ style: { fontWeight: 700, color: x.finished >= x.qty ? "var(--success)" : "var(--text)", whiteSpace: "nowrap" } }),
                cell: (x) => <>{fmtNum(x.finished)}<span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>{pctLabel(x.pct, x.finished >= x.qty)}</span>
                  {x.spare > 0 && <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 800, color: "#d97a00", background: "rgba(217,122,0,.12)", border: "1px solid rgba(217,122,0,.4)", borderRadius: 99, padding: "1px 6px" }}>{L(`สแปร์ ${fmtNum(x.spare)}`, `spare ${fmtNum(x.spare)}`)}</span>}</> },
              { key: "weight", header: L("น้ำหนัก (กก.)", "Weight (kg)"), sortKey: "weight", align: "right", tdStyle: { whiteSpace: "nowrap", color: "var(--accent-dk)" }, cell: (x) => x.unitWeight ? fmtNum(x.weight) : "—" },
              { key: "len", header: L("ความยาว (มม.)", "Length (mm)"), sortKey: "len", align: "right", tdStyle: { whiteSpace: "nowrap" }, cell: (x) => x.len != null ? fmtNum(x.len) : "-" },
              { key: "mach", header: L("เครื่อง · ขั้นตอนที่ติ๊ก", "Machine · steps ticked"), sortKey: "mach", dataLabel: L("เครื่อง", "Machine"),
                cell: (x) => x.machines.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {x.machines.map((m, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", opacity: (Number(m.finished) || 0) > 0 ? 1 : 0.6 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }} title={m.name || ""}>{m.code || m.name || "?"}</span>
                        {(m.ops || []).map((o, oi) => <span key={oi} style={chip}>{opLabel(o, lang)}</span>)}
                        <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{L(`เสร็จ ${fmtNum(m.finished || 0)}`, `${fmtNum(m.finished || 0)} finished`)}</span>
                      </div>
                    ))}
                  </div>
                ) : x.ops.length ? (
                  <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{x.ops.map((o, oi) => <span key={oi} style={chip}>{opLabel(o, lang)}</span>)}</span>
                ) : x.officeOnly ? <span style={{ color: "var(--muted)" }}>{L("สแกนสำนักงาน", "Office scan")}</span> : "—" },
              { key: "last", header: L("เสร็จล่าสุด", "Last finished"), sortKey: "last", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5 }, cell: (x) => x.lastAt ? fmtDT(x.lastAt) : "—" },
              { key: "date", header: L("วันที่ปล่อยงาน", "Released"), sortKey: "date", tdStyle: { whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12.5 }, cell: (x) => fmtD(x.date) },
            ]} />
        )}
      </Card>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 4) QR / LABELS — reprint labels for any past release lot, true-size (2×2cm default)
// ══════════════════════════════════════════════════════════════════════════
function QrLabelsPage({ initialReleaseId, onConsumeInitial }) {
  const [releases, setReleases] = useState([]);
  const [parts, setParts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [releaseId, setReleaseId] = useState("");
  const [units, setUnits] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const [labelPreset, setLabelPreset] = useState("76x12");
  const [customW, setCustomW] = useState(20);
  const [customH, setCustomH] = useState(20);
  const [showCode, setShowCode] = useState(false);
  const [printMode, setPrintMode] = useState("roll");   // ค่าเริ่มต้น: 1 ป้าย/หน้า ขนาดเท่าจริง
  // ชนิดป้าย: 'unit' = ป้ายรายชิ้น (ติดทุกชิ้น — ชิ้นใหญ่) | 'lot' = ป้ายรวมล็อต 1 ใบ (ชิ้นเล็ก สแกนแล้วกรอกจำนวน)
  const [labelScope, setLabelScope] = useState("unit");
  // กรองล็อตแบบดรอปดาวลูกโซ่: Projects → Release (Release Order) → Part (ล็อต) + ช่องค้นหาอิสระ
  const [projectFilter, setProjectFilter] = useState("");
  const [releaseOrder, setReleaseOrder] = useState("");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("machine"); // แยกแผนก (เหมือนหน้า Release/รายงาน): machine/assembly/packing
  const gridRef = useRef(null);   // กรอบเลื่อนตาราง QR (ใช้ปุ่ม "ขึ้นบนสุด")
  const [committedKey, setCommittedKey] = useState(""); // ★ โหลด QR เฉพาะหลังกด "ค้นหา" (กันโหลดหมื่นใบทันที)

  useEffect(() => {
    (async () => {
      setReleases(await listRows("releases", { order: "release_date", ascending: false }));
      setParts(await listRows("part_master", { order: "part_no" }));
      setProjects(await listRows("projects", { order: "code" }));
    })();
  }, []);

  // มาจากปุ่ม "พิมพ์ QR" ในหน้ารายละเอียด Release — เลือกล็อต + ค้นหาให้อัตโนมัติ
  useEffect(() => {
    if (initialReleaseId) {
      setReleaseId(initialReleaseId);
      setCommittedKey(initialReleaseId);   // จากปุ่มพิมพ์ QR = โชว์เลย ไม่ต้องกดค้นหา
      onConsumeInitial && onConsumeInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReleaseId]);

  function partOf(r) { return parts.find((p) => p.id === r.part_master_id); }

  // ── ตัวกรองลูกโซ่ + ช่องค้นหาอิสระ (คำนวณก่อน effect โหลด QR) ─────────────
  const q = search.trim().toLowerCase();
  const relHay = (r) => {
    const part = partOf(r);
    const proj = projects.find((p) => p.id === part?.project_id);
    return [fmtDT(r.release_date), part?.part_no, part?.part_name, r.release_order, proj?.code, proj?.name]
      .filter(Boolean).join(" ").toLowerCase();
  };
  const matchSearch = (r) => !q || relHay(r).includes(q);
  const relsInProject = releases.filter((r) =>
    (!deptFilter || deptOfKind(partOf(r)?.kind) === deptFilter)
    && (!projectFilter || partOf(r)?.project_id === projectFilter) && matchSearch(r));
  const releaseOrders = Array.from(new Set(relsInProject.map((r) => r.release_order).filter(Boolean))).sort();
  const filteredReleases = relsInProject.filter((r) => !releaseOrder || r.release_order === releaseOrder);
  const hasFilter = !!(projectFilter || releaseOrder || q || releaseId);

  // ★ ล็อตที่จะโชว์ QR: เลือก Part เจาะจง = ล็อตนั้น · เลือกแค่ Project/Release = "ทุกล็อต" ในตัวกรอง
  const activeReleaseIds = releaseId
    ? [releaseId]
    : ((projectFilter || releaseOrder || q) ? filteredReleases.map((r) => r.id) : []);
  const activeIdsKey = activeReleaseIds.join(",");

  // โหลดชิ้นงาน (QR) — เฉพาะ "หลังกดค้นหา" (committedKey) เท่านั้น · แบ่ง batch กัน URL ยาว + แบ่งหน้ากันเกิน 1000
  useEffect(() => {
    if (!committedKey) { setUnits([]); setSelected(new Set()); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      const ids = committedKey.split(",");
      const out = [];
      for (let i = 0; i < ids.length; i += 60) {
        const chunk = ids.slice(i, i + 60);
        let from = 0;
        for (;;) {
          const { data, error } = await supabase
            .from("part_units")
            .select("id, unit_no, qr_code, release_id, part_master_id")
            .in("release_id", chunk)
            .order("release_id", { ascending: true }).order("unit_no", { ascending: true })
            .range(from, from + 999);
          if (error || !data || !data.length) break;
          out.push(...data);
          if (data.length < 1000) break;
          from += 1000;
        }
      }
      if (alive) { setUnits(out); setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedKey]);

  // 1 ใบต่อ 1 พาร์ท (ตัวแทนใบแรกของแต่ละล็อต) — สำหรับป้ายรวมล็อต / เลือกหลายพาร์ท
  const lotReps = (() => {
    const seen = new Set(); const reps = [];
    for (const u of units) if (!seen.has(u.release_id)) { seen.add(u.release_id); reps.push(u); }
    return reps;
  })();
  const multi = lotReps.length > 1;                  // เลือกหลายพาร์ท (ใช้ปรับข้อความอธิบาย)
  const effScope = labelScope;                       // เลือกป้ายรายชิ้น (รันเบอร์) ได้แม้เลือกหลายพาร์ท
  const displayed = effScope === "unit" ? units : lotReps;

  // เลือกทุกใบที่แสดงโดยอัตโนมัติ
  useEffect(() => {
    setSelected(new Set(displayed.map((u) => u.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedKey, effScope, units.length]);

  // ป้าย QR ที่ต้องเรนเดอร์ "ซ่อน" เพิ่มตอนพิมพ์ (เฉพาะใบที่เลือกแต่ไม่อยู่ในพรีวิว 600 ใบแรก)
  //   ★ ไม่เรนเดอร์ล่วงหน้าทั้งหมดตอนค้นหา → เลิกจอค้างเวลาล็อตใหญ่ (หมื่นใบ)
  const [printHidden, setPrintHidden] = useState([]);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const pendingPrintRef = useRef(null);

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => (s.size === displayed.length ? new Set() : new Set(displayed.map((u) => u.id))));
  }

  function currentSize() {
    if (labelPreset === "custom") return { w: Number(customW) || 20, h: Number(customH) || 20 };
    const p = LABEL_PRESETS.find((x) => x.value === labelPreset);
    return { w: p.w, h: p.h };
  }
  function doPrint() {
    const picked = displayed.filter((u) => selected.has(u.id));
    if (!picked.length) { mlsToast("กรุณาเลือกอย่างน้อย 1 ใบ", "warn"); return; }
    // ใบที่เลือกแต่ไม่อยู่ในพรีวิว 600 ใบแรก ต้องเรนเดอร์ QR ซ่อนก่อน (printLabels อ่านจาก DOM)
    const first600 = new Set(displayed.slice(0, 600).map((u) => u.id));
    const needHidden = picked.filter((u) => !first600.has(u.id));
    if (needHidden.length) {
      pendingPrintRef.current = picked;
      setPreparingPrint(true);
      setPrintHidden(needHidden);        // เรนเดอร์เสร็จแล้ว effect จะสั่งพิมพ์ต่อ
      return;
    }
    runPrint(picked);
  }

  // เมื่อ QR ซ่อนถูกเรนเดอร์ครบใน DOM แล้ว → สั่งพิมพ์ (แล้วเก็บกวาด)
  useEffect(() => {
    if (!preparingPrint || !pendingPrintRef.current) return;
    const picked = pendingPrintRef.current;
    pendingPrintRef.current = null;
    // รอ 1 เฟรมให้ DOM วาด QR ที่เพิ่งเพิ่มเสร็จก่อนพิมพ์
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      runPrint(picked);
      setPreparingPrint(false);
      setPrintHidden([]);                // เคลียร์ QR ซ่อนออกจาก DOM หลังพิมพ์
    }));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printHidden, preparingPrint]);

  function runPrint(picked) {
    const { w, h } = currentSize();
    // เติมข้อมูลลงแต่ละป้าย: อ้างอิง Release ของแต่ละใบเอง (รองรับหลายพาร์ท)
    const chosen = picked.map((u) => {
      const rel = releases.find((r) => r.id === u.release_id) || {};
      const total = rel.qty;
      const part = parts.find((p) => p.id === u.part_master_id) || {};
      const proj = projects.find((p) => p.id === part.project_id) || {};
      return {
        ...u,
        _label: {
          projectNumber: proj.code || "",
          projectName: proj.name || "",
          partNo: part.part_no || "",
          mdfNo: part.mdf_no ?? "-",
          relNo: rel.release_order || "",
          qtyText: effScope === "lot"
            ? (total != null ? `${total} PCS` : "")   // ป้ายรวมล็อต: โชว์จำนวนทั้งล็อต (อังกฤษ ให้ตรงกับ MDF/REL NO.)
            : ((u.unit_no != null && total != null)          // ป้ายรายชิ้น: X OF Y
                ? `${u.unit_no} OF ${total}`
                : (u.unit_no != null ? String(u.unit_no) : "")),
        },
      };
    });
    printLabels(chosen, { widthMm: w, heightMm: h, mode: printMode, title: "Part labels" });
  }

  function doSearch() { setCommittedKey(activeIdsKey); }   // กดค้นหา = โหลด/แสดง QR ตามตัวกรองปัจจุบัน
  function clearSearch() { setProjectFilter(""); setReleaseOrder(""); setSearch(""); setReleaseId(""); setCommittedKey(""); }   // ล้างทั้งหมด
  const searchDirty = activeIdsKey !== committedKey;   // ตัวกรองเปลี่ยนหลังค้นหา → ต้องกดค้นหาใหม่

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">พิมพ์ QR / ป้าย</div>
          <div className="page-sub">ค้นหาล็อตที่เคย Release แล้วพิมพ์ป้ายซ้ำได้ทุกเมื่อ — ค่าเริ่มต้นขนาด 2×2 ซม.</div>
        </div>
      </div>

      <DeptTabs value={deptFilter} onChange={(v) => { setDeptFilter(v); setReleaseOrder(""); setReleaseId(""); }} />

      <Card title="เลือกล็อตที่ต้องการพิมพ์">
        {/* ช่องค้นหาอิสระ (กรองตัวเลือกในดรอปดาวน์) */}
        <div className={`lot-search ${hasFilter ? "has" : ""}`}>
          <svg className="lot-search-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input className="lot-search-in" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา Part No. / Release Order / โปรเจค / วันที่..." />
        </div>

        {/* ดรอปดาวลูกโซ่: เลือกโปรเจค → รายการ Release แคบลง → เลือก Part */}
        <div className="grid-3" style={{ gap: 12, marginTop: 14 }}>
          <Field label="Projects">
            <Select value={projectFilter}
              onChange={(e) => { setProjectFilter(e.target.value); setReleaseOrder(""); setReleaseId(""); }}
              options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
          </Field>
          <Field label={`Release${releaseOrders.length ? ` (${releaseOrders.length})` : ""}`}>
            <Select value={releaseOrder}
              onChange={(e) => { setReleaseOrder(e.target.value); setReleaseId(""); }}
              options={releaseOrders.map((ro) => ({ value: ro, label: ro }))} />
          </Field>
          <Field label={`Part${hasFilter ? ` (${filteredReleases.length})` : ""}`}>
            <Select value={releaseId} onChange={(e) => setReleaseId(e.target.value)}
              options={filteredReleases.map((r) => ({ value: r.id, label: `${partOf(r)?.part_no || "-"}${r.release_order ? ` · ${r.release_order}` : ""} × ${r.qty} ชิ้น` }))} />
          </Field>
        </div>

        {/* ★ เลือกก่อน แล้วกด "ค้นหา" ค่อยโหลด/แสดง QR · ปุ่มล้างอยู่ข้างกัน */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <Btn variant="accent" onClick={doSearch} disabled={!activeIdsKey}>
            <Icon name="qr" size={15} /> ค้นหา QR
          </Btn>
          <Btn variant="ghost" onClick={clearSearch} disabled={!hasFilter && !committedKey}>
            <Icon name="close" size={14} /> ล้าง
          </Btn>
          {searchDirty && committedKey && (
            <span style={{ fontSize: 12, color: "var(--warn, #b45309)", fontWeight: 600 }}>ตัวกรองเปลี่ยนแล้ว — กด “ค้นหา QR” เพื่ออัปเดต</span>
          )}
        </div>
        {hasFilter && filteredReleases.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>ไม่พบล็อตที่ตรงกับการค้นหา — กด “ล้าง” เพื่อดูทั้งหมด</div>
        )}
      </Card>

      {loading && <Card><div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div></Card>}

      {!loading && displayed.length > 0 && (
        <Card title={`ป้ายที่จะพิมพ์ (${fmtNum(displayed.length)})`} right={
          <Btn size="sm" onClick={toggleAll}>{selected.size === displayed.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</Btn>
        }>
          <Field label="ชนิดป้าย">
            <div className="chip-row">
              <span className={`chip ${effScope === "unit" ? "active" : ""}`} onClick={() => setLabelScope("unit")}>ป้ายรายชิ้น · รันเบอร์ 1 OF N (ชิ้นใหญ่)</span>
              <span className={`chip ${effScope === "lot" ? "active" : ""}`} onClick={() => setLabelScope("lot")}>ป้ายรวมล็อต · 1 ใบต่อพาร์ท (ชิ้นเล็ก)</span>
            </div>
          </Field>
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 2px 12px", lineHeight: 1.6 }}>
            {effScope === "unit"
              ? (multi
                  ? `ป้ายรายชิ้น (รันเบอร์) — ทุกพาร์ทที่เลือก (${fmtNum(lotReps.length)} พาร์ท) จะได้ป้ายครบทุกชิ้น เลขวิ่ง 1 OF N แยกตามแต่ละพาร์ท`
                  : "พิมพ์ป้าย 1 ใบต่อ 1 ชิ้น เลขวิ่ง 1 OF N — ติดสติกเกอร์รายชิ้น")
              : (multi
                  ? `ป้ายรวมล็อต — ${fmtNum(lotReps.length)} พาร์ท ได้ 1 ใบต่อพาร์ท (สแกน 1 ครั้งแล้วกรอกจำนวน)`
                  : "พิมพ์ป้ายเดียวแทนทั้งล็อต — สแกน 1 ครั้งที่หน้าเครื่องแล้วกรอกจำนวนที่ทำ")}
          </div>
          {effScope === "unit" && displayed.length > 1500 && (
            <div style={{ fontSize: 12, color: "var(--warn, #b45309)", margin: "-4px 2px 10px", fontWeight: 600 }}>
              ⚠ ป้ายรายชิ้นรวม {fmtNum(displayed.length)} ใบ — พิมพ์เยอะมาก อาจใช้เวลาโหลด/พิมพ์นาน (เลือกเฉพาะพาร์ทที่ต้องการได้)
            </div>
          )}

          {/* ── แถบเครื่องมือ (ย้ายขึ้นบน + sticky) ─────────────────────────── */}
          <div className="qr-toolbar">
            <Field label="ขนาดป้าย">
              <Select value={labelPreset} onChange={(e) => setLabelPreset(e.target.value)}
                options={LABEL_PRESETS.map((p) => ({ value: p.value, label: p.label }))} style={{ minWidth: 160 }} />
            </Field>
            {labelPreset === "custom" && (
              <>
                <Field label="กว้าง (มม.)"><Input type="number" value={customW} onChange={(e) => setCustomW(e.target.value)} style={{ width: 78 }} /></Field>
                <Field label="สูง (มม.)"><Input type="number" value={customH} onChange={(e) => setCustomH(e.target.value)} style={{ width: 78 }} /></Field>
              </>
            )}
            <Field label="รูปแบบการพิมพ์">
              <div className="chip-row">
                <span className={`chip ${printMode === "roll" ? "active" : ""}`} onClick={() => setPrintMode("roll")}>1 ป้าย/หน้า · เท่าจริง</span>
                <span className={`chip ${printMode === "sheet" ? "active" : ""}`} onClick={() => setPrintMode("sheet")}>หลายป้าย/แผ่น A4</span>
              </div>
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", paddingBottom: 9 }}>
              <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> แสดงรหัสใต้ QR
            </label>
            <div className="qr-toolbar-print">
              <span className="qr-count">เลือก {fmtNum(selected.size)} / {fmtNum(displayed.length)}</span>
              <Btn variant="accent" onClick={doPrint} disabled={preparingPrint}>
                <Icon name="printer" size={15} />{preparingPrint ? "กำลังเตรียมป้าย..." : `พิมพ์ (${fmtNum(selected.size)})`}
              </Btn>
            </div>
          </div>

          {/* ── ตาราง QR เลื่อนได้ (มีสกอลบาร์ด้านข้าง) ───────────────────── */}
          <div ref={gridRef} className="qr-grid-scroll">
            <div className="qr-grid">
              {displayed.slice(0, 600).map((u) => {
                const part = parts.find((p) => p.id === u.part_master_id);
                return (
                  <label key={u.id} className={`unit-check ${selected.has(u.id) ? "checked" : ""}`} style={{ alignItems: "center", textAlign: "center", gap: 6 }}>
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} style={{ accentColor: "var(--accent)", alignSelf: "flex-start" }} />
                    <QRCodeSVG id={`pq-${u.id}`} value={u.qr_code} size={82} fgColor="#000000" bgColor="#ffffff" />
                    {part?.part_no ? <span style={{ fontSize: 12, fontWeight: 600 }}>{part.part_no}</span> : null}
                    {showCode ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", wordBreak: "break-all" }}>{u.qr_code}</span> : null}
                  </label>
                );
              })}
            </div>
            {/* QR ซ่อนสำหรับพิมพ์ — เรนเดอร์เฉพาะตอนกดพิมพ์ (ไม่ทำล่วงหน้าตอนค้นหา กันจอค้าง) */}
            {printHidden.length > 0 && (
              <div style={{ display: "none" }}>
                {printHidden.map((u) => <QRCodeSVG key={u.id} id={`pq-${u.id}`} value={u.qr_code} size={82} fgColor="#000000" bgColor="#ffffff" />)}
              </div>
            )}
            {displayed.length > 600 && (
              <div style={{ fontSize: 12, color: "var(--muted)", margin: "10px 2px 2px", textAlign: "center" }}>* แสดงตัวอย่าง 600 ใบแรก — เวลาพิมพ์จะพิมพ์ครบทุกใบที่เลือก ({fmtNum(selected.size)})</div>
            )}
          </div>

          {/* ── ปุ่มกลับขึ้นด้านบนสุด ─────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <Btn variant="ghost" size="sm" onClick={() => gridRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px" }}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              &nbsp;ขึ้นไปด้านบนสุด
            </Btn>
          </div>
        </Card>
      )}

      {!loading && committedKey && displayed.length === 0 && (
        <div className="empty-state">
          <Icon name="qr" size={32} />
          <div className="empty-state-title">ไม่พบชิ้นงาน (QR) ในตัวกรองนี้</div>
        </div>
      )}
    </div>
  );
}

// แปลง ISO/timestamp → "yyyy-mm-dd" ตามเวลาเครื่อง (สำหรับ <input type="date">)
//   ใช้ส่วนวันของเวลาท้องถิ่น (ไทย = UTC+7) ให้ตรงกับ dateToIso ตอนบันทึกกลับ
function isoToDateInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ─── แก้หัวเอกสาร Release ทั้งใบ (Modify / เลขที่ Release Order / วันที่) — Admin เท่านั้น ───
// ค่าทั้ง 3 เป็นระดับ "ทั้งใบ" → บันทึกทีเดียวเปลี่ยนครบทุก Part (ผ่าน RPC admin-gated)
function ReleaseHeaderEditModal({ group, releases, curRO, curDate, onClose, onSaved }) {
  const [modify, setModify] = useState("");
  const [releaseOrder, setReleaseOrder] = useState(curRO || "");
  const [date, setDate] = useState(() => isoToDateInput(curDate));
  const [origMdf, setOrigMdf] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ดึงค่า Modify ปัจจุบัน (เก็บที่ part_master — ตัวแทน 1 Part ในใบ, ปกติทั้งใบใช้ค่าเดียวกัน)
  useEffect(() => {
    let alive = true;
    const pmId = releases[0]?.part_master_id;
    if (!pmId) { setLoading(false); return; }
    listRows("part_master", { filters: { id: pmId } })
      .then((rows) => { if (!alive) return; const m = (rows[0]?.mdf_no ?? "").toString(); setModify(m); setOrigMdf(m); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [releases]);

  async function doSave() {
    const ro = normalizeReleaseOrder(releaseOrder);
    if (ro && !RELEASE_ORDER_RE.test(ro)) { setErr('เลขที่ Release Order ต้องเป็นรูปแบบ "P-ตัวเลข" เช่น P-009 (หรือเว้นว่าง)'); return; }
    if (!date) { setErr("กรุณาเลือกวันที่"); return; }
    setBusy(true); setErr("");
    try {
      const dateChanged = date !== isoToDateInput(curDate);
      const dateIso = dateChanged ? dateToIso(date) : null;
      const mdfTrim = modify.trim();
      const mdfChanged = mdfTrim !== (origMdf ?? "").trim();
      const mdfVal = mdfChanged ? (mdfTrim || "0") : null;

      const res = await updateReleaseHeader({
        releaseIds: releases.map((r) => r.id),
        releaseOrder: ro || null,
        releaseDate: dateIso,
        mdfNo: mdfVal,
      });
      if (!res?.ok) { setErr("บันทึกไม่สำเร็จ" + (res?.reason ? ` (${res.reason})` : "")); setBusy(false); return; }

      auditRecord("edit_release_header", "release_group", group.releaseOrder || releases[0]?.id, {
        project: group.projectCode, parts: releases.length,
        release_order: ro || null,
        mdf: mdfChanged ? (mdfTrim || "0") : undefined,
        date: dateChanged ? date : undefined,
      });
      mlsToast(`บันทึกหัวเอกสารแล้ว — อัปเดต ${fmtNum(res.releases || releases.length)} Part`, "success");
      onSaved({
        ro: ro || null,
        dateIso: dateChanged ? dateIso : curDate,
        mdf: mdfChanged ? (mdfTrim || "0") : origMdf,
      });
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + (e?.message || e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="แก้ไขหัวเอกสาร Release"
      sub={`${group.projectCode} — ${group.projectName} · ${releases.length} Part ในใบนี้`}
      onClose={onClose} locked={busy}
    >
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
        แก้ค่าหัวเอกสารที่ใช้ “ทั้งใบ” — บันทึกครั้งเดียวจะเปลี่ยนให้ครบทุก Part ({releases.length} รายการ) ในใบนี้พร้อมกัน
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>กำลังโหลด...</div>
      ) : (
        <>
          <div className="grid-2">
            <Field label="Modify (Release)">
              <Input value={modify} onChange={(e) => setModify(e.target.value)} placeholder="เช่น M-001 (เว้นว่าง = 0)" />
            </Field>
            <Field label="เลขที่ Release Order">
              <Input value={releaseOrder} onChange={(e) => setReleaseOrder(e.target.value)}
                onBlur={(e) => setReleaseOrder(normalizeReleaseOrder(e.target.value))} placeholder="เช่น P-009 (ไม่บังคับ)" />
            </Field>
            <Field label="วันที่">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>{err}</div>}
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
            <Btn type="button" variant="accent" onClick={doSave} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึกทั้งใบ"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 4.5) MANAGE RELEASES — แก้ไข/ลบ Release ที่เคยปล่อยงานไปแล้ว
// ══════════════════════════════════════════════════════════════════════════
// แก้ไขได้: จำนวน / น้ำหนักต่อชิ้น / ความยาวต่อชิ้น / หมายเหตุ / เลข Release Order
// - เพิ่มจำนวน  → สร้าง QR ใหม่ต่อท้าย (unit_no ต่อจากใบล่าสุด)
// - ลดจำนวน    → ลบเฉพาะ QR ที่ "ยังไม่ถูกสแกน" (status = released) เท่านั้น
//                ลบต่ำกว่าจำนวนที่สแกนไปแล้วไม่ได้ เพื่อไม่ให้ประวัติการทำงานหาย
// - แก้น้ำหนัก/ความยาว → จ่ายค่าลงทุกชิ้นในล็อตนี้ใหม่ (เหมือนตอน Release ครั้งแรก)
// ลบทั้ง Release → ลบ QR (part_units) และประวัติสแกน (scan_logs) ของล็อตนั้นทั้งหมด
function ReleaseEditModal({ release, onClose, onSaved, onDelete }) {
  const [qty, setQty] = useState(release.qty);
  const [unitWeight, setUnitWeight] = useState(release.unit_weight ?? "");
  const [lengthMm, setLengthMm] = useState(release.length_mm ?? "");
  const [note, setNote] = useState(release.note ?? "");
  const [releaseOrder, setReleaseOrder] = useState(release.release_order ?? "");
  const [lang] = useLang();
  const [partNo, setPartNo] = useState(release.part_master?.part_no ?? "");   // Part No. (part_master.part_no — มีผลทุก Release ของพาร์ท)
  const [material, setMaterial] = useState(release.part_master?.material ?? "");   // INV Code (part_master.material)
  const [matLen, setMatLen] = useState("");        // ความยาว material (mm) — ตั้งค่าเดียวให้ทุกสแกนของล็อตนี้
  const [matLens0, setMatLens0] = useState([]);     // ค่าปัจจุบัน (ไม่ซ้ำ) จากสแกนจริง — ไว้เทียบ/พรีฟิล
  const [machines, setMachines] = useState([]);   // เครื่องที่ทำพาร์ทนี้ [{machine_id, code, done, finished}]
  const [allMachines, setAllMachines] = useState([]);   // เครื่องทั้งหมด (ไว้เลือกปรับ done ให้พาร์ทที่ยังไม่มีสแกน)
  const [doneTarget, setDoneTarget] = useState("");     // จำนวนที่ทำเสร็จ (done) เป้าหมายของเครื่องที่เลือก
  const [selMachine, setSelMachine] = useState("");   // machine_id ที่เลือก (ว่าง = ไม่มีงานหน้าเครื่อง → ระดับสำนักงาน)
  const [prodStatus, setProdStatus] = useState("inprocess");   // สถานะที่จะบันทึก
  const [units, setUnits] = useState(null); // null = ยังโหลดไม่เสร็จ
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // สถานะปัจจุบันของเครื่องหนึ่ง / ของฝั่งสำนักงาน (จากยอด finished vs done)
  const machStatus = (m) => (m && Number(m.done) > 0 && Number(m.finished) >= Number(m.done)) ? "finished" : "inprocess";
  const officeStatus = (u) => ((u || []).length > 0 && (u || []).every((x) => x.status === "finished")) ? "finished" : "inprocess";

  useEffect(() => {
    Promise.all([
      listRows("part_units", { filters: { release_id: release.id }, order: "unit_no" }),
      getReleaseMachineProgress(release.id),
      getReleaseMaterialLengths([release.id]),
      listRows("machines", { order: "code" }),
    ]).then(([u, ms, ml, allM]) => {
      const units2 = u || [];
      const arr = Array.isArray(ms) ? ms : [];
      setUnits(units2); setMachines(arr); setAllMachines(Array.isArray(allM) ? allM : []);
      const lens = (ml && ml[release.id]) || [];      // ความยาว material ที่ใช้จริง (ไม่ซ้ำ)
      setMatLens0(lens);
      if (lens.length === 1) setMatLen(String(lens[0]));   // มีค่าเดียว → เติมให้แก้ได้ทันที
      if (arr.length) { setSelMachine(arr[0].machine_id); setProdStatus(machStatus(arr[0])); setDoneTarget(String(Number(arr[0].done) || 0)); }
      else { setProdStatus(officeStatus(units2)); }
    });
  }, [release.id]);

  const selM = machines.find((m) => m.machine_id === selMachine) || null;
  const origStatus = selM ? machStatus(selM) : officeStatus(units);
  const onSelMachine = (id) => { setSelMachine(id); const m = machines.find((x) => x.machine_id === id); if (m) setProdStatus(machStatus(m)); setDoneTarget(String(m ? Number(m.done) || 0 : 0)); };
  const curDoneOf = (mid) => machines.find((m) => m.machine_id === mid)?.done ?? 0;   // done ปัจจุบันของเครื่องนั้น

  const scannedCount = units ? units.filter((u) => u.status !== "released").length : 0;
  const releasedCount = units ? units.length - scannedCount : 0;
  const qtyNum = Number(qty) || 0;
  const delta = qtyNum - release.qty;
  // ทำไปแล้วสูงสุด (ไว้เทียบสแปร์) — จากยอด done ของเครื่อง (co-tick aware) · ไม่มีงานเครื่อง → ใช้ยอดสแกนสำนักงาน
  const doneMax = machines.length ? Math.max(0, ...machines.map((m) => Number(m.done) || 0)) : scannedCount;
  const spare = Math.max(0, doneMax - qtyNum);   // เกินจำนวนสั่ง = สแปร์

  async function doSave() {
    if (!units) return;
    if (qtyNum < 1) { setErr("จำนวนต้องมากกว่า 0"); return; }
    if (qtyNum < scannedCount) {
      setErr(`ลดจำนวนต่ำกว่านี้ไม่ได้ — มีชิ้นที่สแกนไปแล้ว ${scannedCount} ชิ้นในล็อตนี้`);
      return;
    }
    if (delta < 0 && Math.abs(delta) > releasedCount) {
      setErr(`ลบได้สูงสุด ${releasedCount} ชิ้น (เหลือเฉพาะชิ้นที่ยังไม่สแกน)`);
      return;
    }
    // ลดจำนวน = ลบ QR ชิ้นที่ยังไม่สแกนออกถาวร → ต้องเตือนก่อนเสมอ (กันลบพลาด)
    if (delta < 0) {
      const ok = await askConfirm({
        message: `ลดจำนวนล็อตนี้ลง ${fmtNum(Math.abs(delta))} ชิ้น\nจะลบ QR ${fmtNum(Math.abs(delta))} ชิ้นที่ยังไม่ได้สแกนออกถาวร · กู้คืนไม่ได้`,
        tone: "danger", confirmText: "ลดจำนวน (ลบ QR)", cancelText: "ยกเลิก",
      });
      if (!ok) return;
    }
    const ro = normalizeReleaseOrder(releaseOrder);
    if (ro && !RELEASE_ORDER_RE.test(ro)) { setErr('เลขที่ Release Order ต้องเป็นรูปแบบ "P-ตัวเลข" เช่น P-009 (หรือเว้นว่าง)'); return; }
    setBusy(true); setErr("");
    try {
      const patch = {
        qty: qtyNum,
        unit_weight: unitWeight === "" ? null : Number(unitWeight),
        length_mm: lengthMm === "" ? null : Number(lengthMm),
        note: note || null,
        release_order: ro || null,
      };
      await updateRow("releases", release.id, patch);

      // ถ้าน้ำหนัก/ความยาวเปลี่ยน ให้จ่ายค่าลงทุกชิ้นของล็อตนี้ใหม่ทั้งหมด
      if (patch.unit_weight !== (release.unit_weight ?? null) || patch.length_mm !== (release.length_mm ?? null)) {
        await updateRows("part_units", { release_id: release.id }, { weight: patch.unit_weight, length_mm: patch.length_mm });
      }

      if (delta > 0) {
        const maxUnitNo = units.reduce((m, u) => Math.max(m, u.unit_no), 0);
        const suffix = release.id.slice(0, 6).toUpperCase();
        const qrPartNo = (partNo || "").trim() || release.part_master?.part_no || "PART";   // ใช้เลขที่แก้ล่าสุดสำหรับ QR ใหม่
        const newUnits = Array.from({ length: delta }, (_, i) => ({
          release_id: release.id,
          part_master_id: release.part_master_id,
          unit_no: maxUnitNo + i + 1,
          qr_code: `${qrPartNo}-${suffix}-${String(maxUnitNo + i + 1).padStart(4, "0")}`,
          status: "released",
          weight: patch.unit_weight,
          length_mm: patch.length_mm,
        }));
        await insertRows("part_units", newUnits);
      } else if (delta < 0) {
        const removable = units.filter((u) => u.status === "released").sort((a, b) => b.unit_no - a.unit_no);
        const toRemove = removable.slice(0, Math.abs(delta)).map((u) => u.id);
        await deleteRows("part_units", toRemove);
      }

      // ── แก้ Part No. + INV (material) — เก็บที่ part_master (มีผลกับทุก Release ของพาร์ทนี้) ──
      //   part_name ให้ตาม part_no เสมอ (ระบบใช้ค่าเดียวกัน) → ไม่มีข้อมูลค้างไม่ตรง
      const matVal = (material || "").trim() || null;
      const pmPatch = {};
      if (matVal !== (release.part_master?.material ?? null)) pmPatch.material = matVal;
      const pnoVal = (partNo || "").trim();
      if (pnoVal && pnoVal !== (release.part_master?.part_no ?? "")) { pmPatch.part_no = pnoVal; pmPatch.part_name = pnoVal; }
      if (Object.keys(pmPatch).length && release.part_master_id) {
        await updateRow("part_master", release.part_master_id, pmPatch);
      }

      // ── ความยาว material — ตั้งค่าเดียวให้ "ทุกสแกน" ของล็อตนี้ (material_length_mm รายสแกน) ──
      //   material_length_mm เป็นข้อมูลประกอบ ไม่กระทบน้ำหนัก/จำนวน · เขียนก็ต่อเมื่อกรอกค่าใหม่ที่ต่างจากเดิม
      if (matLen !== "" && Number(matLen) > 0
          && !(matLens0.length === 1 && Number(matLen) === Number(matLens0[0]))) {
        await setReleaseMaterialLength(release.id, Number(matLen));
      }
      // ── ปรับจำนวนที่ทำเสร็จ (done) ของเครื่องที่เลือก — เพิ่ม=สร้างงาน · ลด=เอาสแกนออก (แอดมิน) ──
      if (selMachine && doneTarget !== "") {
        const tgt = Math.max(0, Math.floor(Number(doneTarget) || 0));
        const cur = curDoneOf(selMachine);
        if (tgt !== cur) {
          const diff = tgt - cur;
          const mcode = (allMachines.find((m) => m.id === selMachine)?.code) || (machines.find((m) => m.machine_id === selMachine)?.code) || "";
          const ok = await askConfirm({
            message: diff > 0
              ? `ยืนยันเพิ่มงานเครื่อง ${mcode} อีก ${fmtNum(diff)} ชิ้น?\nระบบจะสร้างบันทึกการทำ (สแกน) ให้ชิ้นที่ยังไม่ทำ`
              : `ยืนยันเอางานเครื่อง ${mcode} ออก ${fmtNum(-diff)} ชิ้น?\nลบสแกนของเครื่องนี้ · ลบแล้วกู้คืนไม่ได้`,
            tone: diff > 0 ? "warn" : "danger", confirmText: "ยืนยัน", cancelText: "ยกเลิก",
          });
          if (ok) await setReleaseMachineDone(release.id, selMachine, tgt);
        }
      }

      // ── เปลี่ยนสถานะการผลิต ──
      //   มีงานหน้าเครื่อง → เปลี่ยนสถานะของ "เครื่องที่เลือก" (machine_records)
      //   ไม่มีงานหน้าเครื่อง → ระดับสำนักงาน (part_units): finished=ปิดงาน · inprocess=คำนวณใหม่จากสแกน
      if (prodStatus !== origStatus) {
        if (selM) {
          await setReleaseMachineStatus(release.id, selM.machine_id, prodStatus);
        } else if (prodStatus === "finished") {
          await updateRows("part_units", { release_id: release.id }, { status: "finished" });
        } else if (release.part_master_id) {
          await recalcPartStatus(release.part_master_id);
        }
      }

      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + e.message);
    }
    setBusy(false);
  }

  // ── ลบข้อมูลสแกนของล็อตนี้ (แก้กรณีสแกนเกิน/ผิด) — ใช้ตัวเดียวกับการ์ด "ล้างข้อมูลสแกน" ──
  //   ลบ machine_records + รีเซ็ตสถานะชิ้นงานกลับเป็น "ยังไม่ทำ" · QR/ล็อต/พาร์ท ยังอยู่ครบ · กู้คืนไม่ได้
  async function doClearScans() {
    setErr("");
    try {
      const prev = await clearScansRelease(release.id, { preview: true });   // นับก่อนว่าจะลบกี่รายการ
      const mr = Number(prev?.machine_records || 0);
      if (mr === 0) { setErr("ล็อตนี้ยังไม่มีข้อมูลสแกนให้ลบ"); return; }
      const ok = await askConfirm({
        message: `ยืนยันลบข้อมูลสแกนของ Part นี้ (${fmtNum(mr)} รายการ · ${fmtNum(scannedCount)} ชิ้น)?\nยอดสแกนจะกลับเป็น 0 · QR/ล็อตยังอยู่ครบ · ลบแล้วกู้คืนไม่ได้ — แนะนำสำรองข้อมูลก่อน`,
        tone: "danger", confirmText: "ลบข้อมูลสแกน", cancelText: "ยกเลิก",
      });
      if (!ok) return;
      setBusy(true);
      const res = await clearScansRelease(release.id, {});
      auditRecord("clear_scans", "scan_data", release.id, { scope: "part", machine_records: res?.machine_records || 0, scan_logs: res?.scan_logs || 0 });
      onSaved();
    } catch (e) {
      setErr("ลบข้อมูลสแกนไม่สำเร็จ: " + (e?.message || e));
    } finally { setBusy(false); }
  }

  return (
    <Modal title="แก้ไข Release" sub={`Part ${release.part_master?.part_no || "-"} — โปรเจค ${release.part_master?.projects?.code || "-"}`} onClose={onClose}>
      {units === null ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>กำลังโหลด...</div>
      ) : (
        <>
          <Field label={lang === "en" ? "Part No." : "เบอร์พาร์ท (Part No.)"}>
            <Input value={partNo} onChange={(e) => setPartNo(e.target.value)} />
          </Field>
          <div className="grid-2">
            <Field label="จำนวน (ชิ้น)">
              {/* ★ แก้จำนวนย้ายไปที่ปุ่ม Modify (เก็บของเดิมเป็นหลักฐาน M-xx + QR ที่ยกเลิก) — ที่นี่ล็อกไว้ ไม่ให้ลบ QR เงียบๆ */}
              <Input type="number" value={qty} readOnly disabled title={lang === "en" ? "Change qty with ✎ Modify on the Release Order page" : "แก้จำนวนที่ปุ่ม ✎ Modify หน้า Release Order"} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{lang === "en" ? <>Change qty with <b style={{ color: "#6d4aff" }}>✎ Modify</b> (saved as a new M, previous values kept as evidence)</> : <>แก้จำนวนที่ปุ่ม <b style={{ color: "#6d4aff" }}>✎ Modify</b> (บันทึกเป็น M ใหม่ เก็บของเดิมเป็นหลักฐาน)</>}</div>
            </Field>
            <Field label="เลขที่ Release Order">
              <Input value={releaseOrder} onChange={(e) => setReleaseOrder(e.target.value)}
                onBlur={(e) => setReleaseOrder(normalizeReleaseOrder(e.target.value))} placeholder="เช่น P-009 (ไม่บังคับ)" />
            </Field>
            <Field label="น้ำหนัก/ชิ้น (กก.)">
              <Input type="number" step="0.01" value={unitWeight} onChange={(e) => setUnitWeight(e.target.value)} />
            </Field>
            <Field label="ความยาว/ชิ้น (มม.)">
              <Input type="number" step="0.1" value={lengthMm} onChange={(e) => setLengthMm(e.target.value)} />
            </Field>
          </div>

          <div className="grid-2">
            <Field label="INV Code">
              <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder={lang === "en" ? "e.g. 23AN01600C (optional)" : "เช่น 23AN01600C (ไม่บังคับ)"} />
            </Field>
            <Field label={lang === "en" ? "Material len (mm)" : "ความยาว material (มม.)"}>
              <Input type="number" step="0.1" min="0" value={matLen} onChange={(e) => setMatLen(e.target.value)}
                placeholder={matLens0.length > 1
                  ? (lang === "en" ? `multiple: ${matLens0.map(fmtNum).join(" · ")}` : `หลายค่า: ${matLens0.map(fmtNum).join(" · ")}`)
                  : (matLens0.length === 0 ? (lang === "en" ? "no scans yet" : "ยังไม่มีสแกน") : "")} />
            </Field>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-4px 0 12px", lineHeight: 1.6 }}>
            {lang === "en"
              ? <><b>Part No. / INV Code</b> apply to every release of this part (QR already printed still scans) · <b>Material len</b> sets one value on all scans of this lot (doesn’t affect weight/qty)</>
              : <><b>Part No. / INV Code</b> มีผลกับทุก Release ของพาร์ทนี้ (QR ที่พิมพ์แล้วยังสแกนได้) · <b>ความยาว material</b> ตั้งค่าเดียวให้ทุกสแกนของล็อตนี้ (ไม่กระทบน้ำหนัก/จำนวน)</>}
          </div>

          <Field label="หมายเหตุ">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่บังคับ" />
          </Field>

          {/* เครื่อง + จำนวนที่ทำเสร็จ (แอดมินปรับเพิ่ม/ลดได้) + สถานะ */}
          <Field label={lang === "en" ? "Machine" : "เครื่อง"}>
            <select value={selMachine} onChange={(e) => onSelMachine(e.target.value)}
              style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 }}>
              <option value="">{lang === "en" ? "— pick a machine —" : "— เลือกเครื่อง —"}</option>
              {(allMachines.length ? allMachines : machines.map((m) => ({ id: m.machine_id, code: m.code, name: "" }))).map((m) => {
                const d = curDoneOf(m.id);
                return <option key={m.id} value={m.id}>{(m.code || "—")}{m.name ? " · " + m.name : ""}{d ? ` · ${lang === "en" ? "done" : "ทำแล้ว"} ${fmtNum(d)}` : ""}</option>;
              })}
            </select>
          </Field>
          <div className="grid-2">
            <Field label={lang === "en" ? "Finished (pcs)" : "ทำเสร็จ (ชิ้น)"}>
              <Input type="number" min={0} value={doneTarget} onChange={(e) => setDoneTarget(e.target.value)}
                disabled={!selMachine} placeholder={selMachine ? "" : (lang === "en" ? "pick a machine first" : "เลือกเครื่องก่อน")} />
            </Field>
            <Field label={lang === "en" ? "Status" : "สถานะ"}>
              <select value={prodStatus} onChange={(e) => setProdStatus(e.target.value)}
                style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 }}>
                <option value="inprocess">{lang === "en" ? "In Process" : "กำลังทำ"}</option>
                <option value="finished">{lang === "en" ? "Finished" : "เสร็จแล้ว"}</option>
              </select>
            </Field>
          </div>
          {selMachine && doneTarget !== "" && (() => {
            const cur = curDoneOf(selMachine);
            const tgt = Math.max(0, Math.floor(Number(doneTarget) || 0));
            if (tgt === cur) return null;
            const diff = tgt - cur;
            return (
              <div style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.6, color: diff > 0 ? "var(--accent-dk)" : "var(--alert, #d97a00)" }}>
                {diff > 0
                  ? (lang === "en" ? `+ mark ${fmtNum(diff)} more pcs done by this machine (creates work records)` : `เพิ่มงานเครื่องนี้อีก ${fmtNum(diff)} ชิ้น (สร้างบันทึกการทำ)`)
                  : (lang === "en" ? `− remove ${fmtNum(-diff)} pcs of this machine's work` : `เอางานเครื่องนี้ออก ${fmtNum(-diff)} ชิ้น`)}
              </div>
            );
          })()}
          {prodStatus !== origStatus && (
            <div style={{ fontSize: 12, color: prodStatus === "finished" ? "var(--alert, #d97a00)" : "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
              {selM
                ? (lang === "en"
                    ? `Set machine ${selM.code || ""} to “${prodStatus === "finished" ? "Finished" : "In Process"}”`
                    : `เปลี่ยนสถานะเครื่อง ${selM.code || ""} เป็น “${prodStatus === "finished" ? "เสร็จแล้ว" : "กำลังทำ"}”`)
                : (prodStatus === "finished"
                    ? (lang === "en" ? `Close — count all ${units.length} pcs as Finished` : `ปิดงาน — นับทุกชิ้น (${units.length}) เป็นเสร็จ`)
                    : (lang === "en" ? "Reopen — recompute from actual scans" : "เปิดงานต่อ — คำนวณสถานะใหม่จากงานที่สแกนจริง"))}
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
            สั่ง <b>{fmtNum(qtyNum)}</b> ชิ้น · สแกนแล้ว <b>{fmtNum(doneMax)}</b> ชิ้น
            {spare > 0 && <span style={{ color: "var(--alert, #d97a00)", fontWeight: 700 }}> · เกิน {fmtNum(spare)} (สแปร์)</span>}
            {releasedCount > 0 && <>{" "}· ยังไม่สแกน {fmtNum(releasedCount)} ชิ้น</>}
            {delta > 0 && <><br />จะสร้าง QR เพิ่มอีก <b>{delta}</b> ใบ ต่อท้ายล็อตเดิม</>}
            {delta < 0 && <><br />จะลบ QR ที่ยังไม่สแกนออก <b>{Math.abs(delta)}</b> ใบ</>}
          </div>

          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

          <div className="modal-actions" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onDelete && (
                <Btn type="button" variant="ghost" onClick={onDelete} disabled={busy}
                  style={{ color: "var(--danger-hi)" }}>
                  ลบ Part นี้
                </Btn>
              )}
              {scannedCount > 0 && (
                <Btn type="button" variant="ghost" onClick={doClearScans} disabled={busy}
                  style={{ color: "var(--danger-hi)" }} title="ลบข้อมูลสแกนของล็อตนี้ (แก้สแกนเกิน/ผิด) — QR/ล็อตยังอยู่">
                  ลบข้อมูลสแกน
                </Btn>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
              <Btn type="button" variant="accent" onClick={doSave} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Btn>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 5) REPORT
// ══════════════════════════════════════════════════════════════════════════
const RANGE_MODES = [
  { value: "preset", label: "ช่วงเวลาด่วน" },
  { value: "month", label: "รายเดือน" },
  { value: "custom", label: "กำหนดเอง (จาก–ถึง)" },
];

// ── วิวรายงาน "ประกอบ / แพ็ก" — ลูกที่ประกอบเข้าเบอร์แม่ (เบอร์ + ความยาว + จำนวน) จาก assembly_links ──
//   แยกแพ็ก/ประกอบด้วยชนิดเบอร์แม่: package = แพ็ก · อื่น ๆ (sub/แผง) = ประกอบ
function AssemblyReportView({ from, to, parentKind, projectFilter, partFilter, goTo }) {
  const isPack = parentKind === "package";
  const kindWord = parentKind === "package" ? "แพ็ก" : parentKind === "panel" ? "แผง" : "ซับ";
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setLoading(true);
    getAssemblyLogsBetween(from, to)
      .then((d) => { if (alive) { setLogs(Array.isArray(d) ? d : []); setLoading(false); } })
      .catch(() => { if (alive) { setLogs([]); setLoading(false); } });
    return () => { alive = false; };
  }, [from, to]);

  const kindTh = (k) => (k === "subassembly" ? "sub" : k === "panel" ? "แผง" : k === "package" ? "แพ็ก" : "part");
  const filtered = logs.filter((l) => {
    if ((l.parent_kind || "part") !== parentKind) return false;   // เฉพาะเบอร์แม่ชนิดนี้ (แผง / ซับ / แพ็ก)
    if (projectFilter && l.parent_project !== projectFilter) return false;
    if (partFilter && l.parent_no !== partFilter && l.child_no !== partFilter) return false;
    return true;
  });

  const parentSet = new Set(filtered.map((l) => l.parent_unit_id));
  const totalChildren = filtered.reduce((s, l) => s + (Number(l.qty) || 1), 0);   // รวม "จำนวนที่ใส่จริง" (นับจำนวนรวม) ไม่ใช่นับลิงก์
  const totalLen = filtered.reduce((s, l) => s + (Number(l.length_mm) || 0), 0);

  // จับกลุ่ม (เบอร์แม่ยูนิต × เบอร์ลูก × ยาว) → รวมจำนวนที่ใช้จริง (assembly_links.qty)
  const grp = {};
  filtered.forEach((l) => {
    const key = l.parent_unit_id + "|" + l.child_no + "|" + (l.length_mm ?? "");
    if (!grp[key]) grp[key] = { parent_no: l.parent_no, parent_qr: l.parent_qr, child_no: l.child_no, child_kind: l.child_kind, length_mm: l.length_mm, qty: 0 };
    grp[key].qty += (Number(l.qty) || 1);
  });
  const rows = Object.values(grp).sort((a, b) =>
    String(a.parent_no).localeCompare(String(b.parent_no), undefined, { numeric: true })
    || String(a.child_no).localeCompare(String(b.child_no), undefined, { numeric: true }));
  const fmtL = (n) => (n == null || isNaN(Number(n)) ? "—" : Number(n).toLocaleString());

  return (
    <div>
      <div className="stat-row">
        <StatCard label={`จำนวนเบอร์แม่ (${kindWord})`} value={parentSet.size.toLocaleString()} icon="box" />
        <StatCard label="จำนวนลูกที่ใส่รวม (ชิ้น)" value={totalChildren.toLocaleString()} icon="scan" />
        <StatCard label="ความยาวรวม (มม.)" value={fmtL(totalLen)} icon="bolt" />
      </div>
      <Card title={`รายการ${kindWord} — เบอร์ลูกที่ใส่เข้าแต่ละเบอร์แม่`}>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
          {isPack ? "แต่ละแพ็กมีลูก/แผงอะไรบ้าง ยาวเท่าไร กี่ชิ้น" : "แต่ละเบอร์แม่มีเบอร์ลูกอะไร ยาวเท่าไร กี่ชิ้น — ใช้เช็คว่าประกอบถูกไหม"}
        </div>
        {loading ? <div style={{ color: "var(--muted)", padding: 12 }}>กำลังโหลด…</div>
          : rows.length === 0 ? <div style={{ color: "var(--muted)", padding: 12 }}>ไม่มีข้อมูลในช่วงนี้</div>
          : (
            <DataTable id="assembly-report" wrapClass="table-wrap" wrapStyle={{ overflowX: "auto" }} tableClass="data-table" tableStyle={{ minWidth: 620 }}
              rows={rows} rowKey={(r, i) => i}
              rowProps={(r) => ({
                onClick: () => goTo && goTo("verify", { qr: r.parent_qr }),
                title: goTo ? "กดเพื่อเปิดหน้าตรวจเบอร์นี้" : undefined,
                style: { cursor: goTo ? "pointer" : "default" },
                onMouseEnter: (e) => { if (goTo) e.currentTarget.style.background = "var(--accent-soft, rgba(16,185,129,.07))"; },
                onMouseLeave: (e) => { e.currentTarget.style.background = ""; },
              })}
              columns={[
                { key: "parent", header: "เบอร์แม่", cell: (r) => (
                  <>
                    <span style={{ fontWeight: 700, color: goTo ? "var(--accent-dk, #0e9d63)" : "inherit" }}>{r.parent_no}</span>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{r.parent_qr}</div>
                  </>
                ) },
                { key: "child", header: "เบอร์ลูก", cell: (r) => r.child_no },
                { key: "kind", header: "ชนิด", cell: (r) => kindTh(r.child_kind) },
                { key: "length", header: "ยาว (มม.)", align: "right", tdStyle: { fontFamily: "monospace" }, cell: (r) => fmtL(r.length_mm) },
                { key: "qty", header: "จำนวน (ชิ้น)", align: "right", tdStyle: { fontFamily: "monospace", fontWeight: 700 }, cell: (r) => r.qty },
              ]} />
          )}
      </Card>
    </div>
  );
}

// ── จับกลุ่ม "1 การสแกน = 1 แถว" (รู้จัก co-tick) — ใช้ร่วมกันหลายที่ ──────────
//   ตัวหลัก quantity>0 = เริ่มสแกนใหม่ · ตัวติ๊กร่วม quantity 0 ที่ตามมา (ชิ้น+สถานะเดียวกัน) = ขั้นตอนเสริมของสแกนนั้น
//   เรียงตามเวลา asc (ตัวหลักถูกบันทึกก่อนเสมอ) แล้วยุบตัว 0 เข้ากลุ่มเดียวกัน → 1 แถวโชว์ครบทุกขั้นตอน
function groupCoTickScans(rows) {
  const opOf = (l) => l.operation?.name || null;
  const asc = [...(rows || [])].sort((a, b) => String(a.scanned_at || "").localeCompare(String(b.scanned_at || "")));
  const out = [];
  let cur = null;
  const mk = (l, qty) => ({
    key: (l.id || `${l.part_unit_id}-${l.scanned_at}`) + (qty > 0 ? "" : "-x"),
    time: l.scanned_at,
    part_no: l.part_unit?.part_master?.part_no || "—",
    part_name: l.part_unit?.part_master?.part_name || "—",
    release_order: l.release_order || "—",
    machine_code: l.machine?.code || l.machine?.name || "—",
    status: l.status, part_unit_id: l.part_unit_id,
    ops: opOf(l) ? [opOf(l)] : [], qty, weight: logWeight(l), secs: Number(l.process_seconds) || 0,
  });
  for (const l of asc) {
    const qv = Number(l.quantity) || 0;
    const op = opOf(l);
    if (qv > 0) { cur = mk(l, qv); out.push(cur); }
    else if (cur && cur.part_unit_id === l.part_unit_id
             && String(cur.status).toLowerCase() === String(l.status).toLowerCase()) {
      if (op && !cur.ops.includes(op)) cur.ops.push(op);   // ขั้นตอนที่ติ๊กเพิ่ม (จำนวน 0) → เติมเข้ากลุ่ม
      cur.weight += logWeight(l); cur.secs += Number(l.process_seconds) || 0;
    } else { out.push(mk(l, 0)); }                          // ตัว 0 กำพร้า (หายาก) → แถวเดี่ยว
  }
  return out;
}

// ── ป็อปอัป "ดูรายละเอียดการสแกน" — เปิดจากแถวในตารางรายงาน (เครื่อง หรือ พาร์ท) ──
//   ใช้ logs ชุดเดียวกับที่นับในตาราง (filteredLogs กรองเฉพาะแถวนั้น) → ตัวเลขในป็อปอัปตรงกับแถวเป๊ะ
//   mode="machine" → ซ่อนคอลัมน์เครื่อง (เครื่องเดียวทั้งตาราง) โชว์พาร์ท · mode="part" → ซ่อนพาร์ท โชว์เครื่องแทน
function ScanDrillModal({ mode = "machine", title, subtitle, logs, opOrder, onClose }) {
  const [lang] = useLang();
  const sort = useTableSort("time", "desc");
  const grouped = useMemo(() => groupCoTickScans(logs), [logs]);
  const rankOps = (ops) => ops.slice().sort((a, b) => ((opOrder?.[a] ?? 999) - (opOrder?.[b] ?? 999)) || String(a).localeCompare(String(b)));
  const acc = {
    time: (g) => g.time || "",
    part: (g) => g.part_no || "",
    mach: (g) => g.machine_code || "",
    op: (g) => rankOps(g.ops).map((o) => opLabel(o, lang)).join(" · "),
    status: (g) => (String(g.status).toLowerCase() === "finished" ? 1 : 0),
    qty: (g) => Number(g.qty) || 0,
    weight: (g) => Number(g.weight) || 0,
  };
  const sorted = sort.sortRows(grouped, acc);
  const totPcs = grouped.reduce((s, g) => s + (Number(g.qty) || 0), 0);
  const totWt = grouped.reduce((s, g) => s + (Number(g.weight) || 0), 0);
  const showMachine = mode === "part";
  const showPart = mode === "machine";
  const colCount = 5 + (showMachine ? 1 : 0) + (showPart ? 1 : 0);
  const statCell = { flex: 1, minWidth: 120, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" };
  const statLbl = { fontSize: 11.5, color: "var(--muted)" };
  const pill = (st) => {
    const fin = String(st).toLowerCase() === "finished";
    return (
      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
        color: fin ? "var(--success)" : "var(--accent-dk)",
        background: fin ? "rgba(16,157,99,.12)" : "rgba(37,99,235,.10)",
        border: `1px solid ${fin ? "var(--success)" : "var(--accent-dk)"}` }}>
        {fin ? (lang === "en" ? "finished" : "เสร็จ") : (lang === "en" ? "in process" : "กำลังทำ")}
      </span>
    );
  };
  const chip = (o, oi) => (
    <span key={oi} style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
      color: "#2563eb", background: "rgba(37,99,235,.10)", border: "1px solid rgba(37,99,235,.40)" }}>{opLabel(o, lang)}</span>
  );
  return (
    <Modal title={title} sub={subtitle} onClose={onClose} wide>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={statCell}><div style={statLbl}>{lang === "en" ? "Scans" : "จำนวนสแกน"}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(grouped.length)} {lang === "en" ? "rows" : "แถว"}</div></div>
        <div style={statCell}><div style={statLbl}>{lang === "en" ? "Total pcs" : "รวมจำนวน"}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(totPcs)} {lang === "en" ? "pcs" : "ชิ้น"}</div></div>
        <div style={statCell}><div style={statLbl}>{lang === "en" ? "Total weight" : "น้ำหนักรวม"}</div><div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-dk)" }}>{fmtNum(totWt)} {lang === "en" ? "kg" : "กก."}</div></div>
      </div>
      <DataTable id="scan-drill" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
        rows={sorted} rowKey={(g) => g.key} sort={sort}
        empty={lang === "en" ? "No scans" : "ไม่มีการสแกน"}
        columns={[
          { key: "time", header: lang === "en" ? "Date · time" : "วัน · เวลา", sortKey: "time", tdStyle: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, cell: (g) => fmtDT(g.time) },
          ...(showPart ? [{ key: "part", header: lang === "en" ? "Part No." : "เบอร์พาร์ท", sortKey: "part", tdStyle: { fontWeight: 600, whiteSpace: "nowrap" },
            cell: (g) => <>{g.part_no}{g.part_name && g.part_name !== g.part_no ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {g.part_name}</span> : null}</> }] : []),
          ...(showMachine ? [{ key: "mach", header: lang === "en" ? "Machine" : "เครื่อง", sortKey: "mach", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (g) => g.machine_code }] : []),
          { key: "op", header: lang === "en" ? "Step" : "ขั้นตอน", sortKey: "op", cell: (g) => g.ops.length ? <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 5 }}>{rankOps(g.ops).map(chip)}</span> : "—" },
          { key: "status", header: lang === "en" ? "Status" : "สถานะ", sortKey: "status", cell: (g) => pill(g.status) },
          { key: "qty", header: lang === "en" ? "Qty" : "จำนวน", sortKey: "qty", align: "right", tdStyle: { fontWeight: 600 }, cell: (g) => `${fmtNum(g.qty)} ${lang === "en" ? "pcs" : "ชิ้น"}` },
          { key: "weight", header: lang === "en" ? "Weight (kg)" : "น้ำหนัก (กก.)", sortKey: "weight", align: "right", tdStyle: { color: "var(--accent-dk)" }, cell: (g) => g.weight ? fmtNum(g.weight) : "—" },
        ]} />
    </Modal>
  );
}

function ReportPage({ goTo }) {
  const [lang] = useLang();
  // ── Flexible date filter: quick preset / specific month / custom from–to ──
  const [rangeMode, setRangeMode] = useState("preset");
  const [preset, setPreset] = useState("week");
  const [monthValue, setMonthValue] = useState(() => todayStr().slice(0, 7));
  const [customFrom, setCustomFrom] = useState(() => daysAgoStr(7));
  const [customTo, setCustomTo] = useState(() => todayStr());

  // ── กรองรายโปรเจค + ราย Part ──
  const [parts, setParts] = useState([]);
  const [partFilter, setPartFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");   // "" = ทุกโปรเจค
  const [releaseFilter, setReleaseFilter] = useState("");    // กรองตามเลข Release Order (ดรอปดาวน์)
  const [projects, setProjects] = useState([]);              // รายชื่อโปรเจค (dedupe จาก releases)
  const [relProj, setRelProj] = useState({});                // release_id → project_id (แม่นยำ ไม่ติดปัญหา part_no ซ้ำข้ามโปรเจค)
  const [allRels, setAllRels] = useState(null);             // releases ทั้งหมด (ส่งให้ Finished Part)

  const [logs, setLogs] = useState([]);
  const [deptFilter, setDeptFilter] = useState("machine");   // "machine"/"assembly"/"packing" — แต่ละแผนกดูคนละแบบ
  const [operations, setOperations] = useState([]);   // ไว้แม็ป operation → แผนก (op_type)
  const [drill, setDrill] = useState(null);   // ป็อปอัปดูรายละเอียดการสแกน (เปิดจากแถวตาราง) — {mode,title,subtitle,logs}

  // ── เลือกตารางก่อน export + สถานะระหว่างสร้างไฟล์ ──
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [pick, setPick] = useState({ op: true, machine: true, cycle: true, part: true, daily: true });

  useEffect(() => { listRows("part_master", { order: "part_no" }).then(setParts); }, []);
  useEffect(() => { listRows("operations").then(setOperations).catch(() => setOperations([])); }, []);

  // โหลด releases ครั้งเดียว → map release→โปรเจค (สำหรับกรอง log) + รายชื่อโปรเจค (สำหรับ dropdown)
  // ใช้ release_id เพราะ 1 release ผูกโปรเจคเดียวชัดเจน — เลี่ยงปัญหา part_no ซ้ำข้ามโปรเจค (K)
  useEffect(() => {
    getReleasesFull().then((rels) => {
      setAllRels(rels || []);   // ใช้ซ้ำใน Finished Part (ไม่ต้องโหลด releases ซ้ำ)
      const rp = {};
      const pmap = new Map();
      for (const r of rels || []) {
        const pid = r.part_master?.project_id;
        if (r.id && pid) rp[r.id] = pid;
        if (pid && !pmap.has(pid)) {
          const pj = r.part_master?.projects || {};
          pmap.set(pid, { id: pid, code: pj.code || "", name: pj.name || "", status: pj.status || "" });
        }
      }
      setRelProj(rp);
      setProjects(Array.from(pmap.values()));
    });
  }, []);

  useEffect(() => {
    const range =
      rangeMode === "month" ? monthRangeFor(monthValue) :
      rangeMode === "custom" ? customRangeFor(customFrom, customTo) :
      rangeFor(preset);
    getScanLogsBetween(range.from, range.to).then(setLogs);
  }, [rangeMode, preset, monthValue, customFrom, customTo]);

  // อ่าน project ของแต่ละ log จาก release_id (เหมือน metrics.js) แล้วเทียบตัวกรอง
  const logProjectId = (l) => {
    const rid = l.release_id || l.part_unit?.release_id || null;
    return rid ? relProj[rid] : undefined;
  };
  // แม็ป operation → แผนก (จาก op_type: assembly/packing · อื่น ๆ = เครื่องจักร)
  const deptOfOpType = (ty) => (ty === "assembly" ? "sub" : ty === "panel" ? "panel" : (ty === "packing" || ty === "pack_panel" || ty === "pack_site") ? "packing" : "machine");
  const opTypeById = {}, opTypeByName = {};
  operations.forEach((o) => { if (o.id != null) opTypeById[o.id] = o.op_type; if (o.name) opTypeByName[o.name] = o.op_type; });
  const deptOfLog = (l) => deptOfOpType(
    l.operation?.op_type ?? opTypeById[l.operation?.id] ?? opTypeById[l.operation_id] ?? opTypeByName[l.operation?.name]
  );
  const filteredLogs = logs.filter((l) => {
    if (projectFilter && logProjectId(l) !== projectFilter) return false;
    if (partFilter && l.part_unit?.part_master?.part_no !== partFilter) return false;
    if (releaseFilter && String(l.release_order || "") !== releaseFilter) return false;   // กรอง Release Order (ตรงตัว)
    if (deptFilter && deptOfLog(l) !== deptFilter) return false;
    return true;
  });

  // ช่วงเวลาปัจจุบัน (ใช้ส่งให้วิวประกอบ/แพ็ก) — คำนวณเดียวกับ effect โหลด logs
  const curRange =
    rangeMode === "month" ? monthRangeFor(monthValue) :
    rangeMode === "custom" ? customRangeFor(customFrom, customTo) :
    rangeFor(preset);
  // Part ที่โชว์ในตัวกรอง — เลือกโปรเจคแล้วโชว์เฉพาะ Part ของโปรเจคนั้น
  const visibleParts = projectFilter ? parts.filter((p) => p.project_id === projectFilter) : parts;
  // รายการ Release Order สำหรับดรอปดาวน์ — เฉพาะที่มีงานสแกนในช่วงเวลานี้ · กรองตามโปรเจคที่เลือก
  const releaseOrders = Array.from(new Set(
    logs.filter((l) => !projectFilter || logProjectId(l) === projectFilter)
        .map((l) => l.release_order).filter(Boolean)
  )).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  // ตัวเลือกโปรเจค — ที่ยังทำอยู่ขึ้นก่อน · ปิดแล้วไว้ท้าย (มิเรอร์การ์ดล้างข้อมูลสแกน)
  const projectOptions = [...projects]
    .sort((a, b) => ((a.status === "closed") - (b.status === "closed"))
      || String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true }))
    .map((p) => ({ value: p.id, label: `${p.code || "?"} — ${p.name || ""}${p.status === "closed" ? " (ปิดแล้ว)" : ""}` }));
  const selProj = projects.find((p) => p.id === projectFilter);

  // แยกน้ำหนักเป็น 2 ตัวเลขคนละความหมาย (ดู metrics.js):
  //   material  = น้ำหนักวัสดุจริง นับแต่ละชิ้นครั้งเดียว
  //   processed = ปริมาณงานที่ประมวลผล นับทุกครั้งที่สแกน (ชิ้นผ่านหลายขั้น = นับหลายครั้ง)
  const material = materialWeight(filteredLogs);
  const processed = processedWeight(filteredLogs);
  const distinctUnits = distinctUnitCount(filteredLogs);
  // ลำดับขั้นตอนตาม seq จากตาราง operations (ตัด→บาก→กัด→เจาะ…) → เรียงคอลัมน์ให้ตรงกระบวนการจริง
  const opOrder = {};
  operations.forEach((o) => { if (o && o.name != null) opOrder[o.name] = o.seq; });
  const matrix = machineOpMatrix(filteredLogs, opOrder); // ตารางแยกน้ำหนักของเครื่อง × ขั้นตอน
  const partMatrix = partOpMatrix(filteredLogs, opOrder); // ตารางแยก Part No. × ขั้นตอน
  // คีย์จับคู่ log → แถวในตาราง Part (ต้องตรงกับ partOpMatrix เป๊ะ) สำหรับ drill-down
  const partKeyOf = (l) => `${(l.release_id || l.part_unit?.release_id) || (l.release_order || "—")}|${l.part_unit?.part_master?.part_no || "ไม่ระบุ"}`;
  // กราฟ "By operation" — จำนวน/น้ำหนักต่อขั้นตอน ดึงจาก matrix (รู้จัก co-tick + เรียงตาม seq แล้ว)
  //   เดิมบวก quantity ดิบ → ขั้นตอนที่ติ๊กร่วม (quantity 0) ได้ 0 เลยขึ้นแต่ Cut · ตอนนี้ทุกขั้นตอนโชว์ชิ้นที่ผ่านจริง
  const chartData = matrix.opNames.map((op) => {
    let count = 0, weight = 0;
    matrix.machines.forEach((m) => { const c = m.ops[op]; if (c) { count += c.count || 0; weight += c.weight || 0; } });
    return { name: op, count, weight };
  });
  const dailyMatrix = machineDailyMatrix(filteredLogs); // กก./จำนวน/เวลา ต่อวัน ต่อเครื่อง
  // น้ำหนักเฉลี่ยต่อวันทำงาน = ปริมาณงานที่ประมวลผล (นับต่อขั้นตอน · co-tick เครื่องเดียวนับครั้งเดียวอยู่แล้ว) ÷ จำนวนวันที่มีงานจริง
  const activeDays = dailyMatrix.days.length;   // วันที่มีงานจริง (bucket เวลาไทย เหมือน 'เฉลี่ย/วัน' ในตารางด้านล่าง)
  const avgWeightPerDay = activeDays > 0 ? processed / activeDays : 0;
  // ── เรียงลำดับตารางรายงาน (กดหัวคอลัมน์) ──────────────────────────────────
  const sortM = useTableSort();   // ตารางเครื่องจักร × ขั้นตอน (ปริมาณงาน + เฉลี่ย/วัน)
  const sortW = useTableSort();   // ตารางปริมาณงานที่แต่ละเครื่องประมวลผล
  const sortP = useTableSort();   // ตาราง Release × Part × ขั้นตอน
  const dmByName = (name) => dailyMatrix.machines.find((x) => x.name === name);
  const machineAcc = {
    code: (m) => m.code || "", name: (m) => m.name, total: (m) => m.total.count, weight: (m) => m.total.weight,
    time: (m) => m.total.seconds,
    secPer: (m) => (m.total.count > 0 ? m.total.seconds / m.total.count : 0),   // cycle-time วินาที/ชิ้น
    avgKg: (m) => dmByName(m.name)?.avg.weight || 0, avgPcs: (m) => dmByName(m.name)?.avg.count || 0,
  };
  matrix.opNames.forEach((op) => { machineAcc[`op:${op}`] = (m) => m.ops[op]?.count || 0; });
  const partAcc = {
    release: (p) => p.releaseOrder, part_no: (p) => p.partNo, part_name: (p) => p.partName,
    total: (p) => p.total.count, weight: (p) => p.total.weight, finished: (p) => p.total.finished,
  };
  partMatrix.opNames.forEach((op) => { partAcc[`op:${op}`] = (p) => p.ops[op]?.count || 0; });
  const noWeight = missingWeightParts(filteredLogs);     // Part ที่ยังไม่ตั้งน้ำหนัก → กก. = 0
  const totalSeconds = filteredLogs.reduce((s, l) => s + (Number(l.process_seconds) || 0), 0);

  // ── สร้างข้อมูลทุกตารางของหน้านี้ (คีย์ = ใช้กับกล่องเลือก · rows พร้อมเข้า exceljs) ──
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  function buildAllSheets() {
    const opRows = chartData.map((o) => ({ "ขั้นตอน": o.name, "จำนวน (ชิ้น)": o.count, "น้ำหนัก (กก.)": round2(o.weight) }));
    const mOps = matrix.opNames;
    const machineRows = matrix.machines.map((m) => {
      const row = { "รหัสเครื่อง": m.code || "", "เครื่องจักร": m.name };
      mOps.forEach((op) => { row[op] = m.ops[op]?.count || 0; });
      row["รวม (ชิ้น)"] = m.total.count;
      row["น้ำหนัก (กก.)"] = round2(m.total.weight);
      row["เวลาเดินเครื่อง (วินาที)"] = Math.round(m.total.seconds || 0);
      row["วินาที/ชิ้น"] = m.total.count > 0 ? round2(m.total.seconds / m.total.count) : "";
      const dm = dmByName(m.name);
      row["เฉลี่ย กก./วัน"] = dm ? round2(dm.avg.weight) : "";
      row["เฉลี่ย ชิ้น/วัน"] = dm ? round2(dm.avg.count) : "";
      return row;
    });
    const cycleRows = [];
    matrix.machines.forEach((m) => mOps.forEach((op) => {
      const c = m.ops[op];
      if (!c || !c.count) return;
      cycleRows.push({
        "เครื่องจักร": m.name, "ขั้นตอน": op, "จำนวน (ชิ้น)": c.count,
        "เวลา (วินาที)": Math.round(c.seconds || 0),
        "วินาที/ชิ้น": c.count > 0 ? round2((c.seconds || 0) / c.count) : "",
      });
    }));
    const pOps = partMatrix.opNames;
    const partRows = partMatrix.parts.map((p) => {
      const row = { "Release": p.releaseOrder, "Part No.": p.partNo, "ชื่อ Part": p.partName };
      pOps.forEach((op) => { row[op] = p.ops[op]?.count || 0; });
      row["รวม (ชิ้น)"] = p.total.count;
      row["น้ำหนัก (กก.)"] = round2(p.total.weight);
      row["เสร็จ (ชิ้น)"] = p.total.finished;
      return row;
    });
    const dailyRows = [];
    dailyMatrix.machines.forEach((m) => dailyMatrix.days.forEach((day) => {
      const d = m.days[day];
      if (!d) return;
      dailyRows.push({
        "เครื่องจักร": m.name, "วันที่": day, "จำนวน (ชิ้น)": d.count,
        "น้ำหนัก (กก.)": round2(d.weight), "เวลา (วินาที)": Math.round(d.seconds || 0),
      });
    }));
    return [
      { key: "op", name: "สรุปตามขั้นตอน", rows: opRows },
      { key: "machine", name: "เครื่องจักรxขั้นตอน", rows: machineRows },
      { key: "cycle", name: "Cycle-time วินาทีต่อชิ้น", rows: cycleRows },
      { key: "part", name: "ReleasexPart", rows: partRows },
      { key: "daily", name: "รายวันต่อเครื่อง", rows: dailyRows },
    ];
  }
  const allSheets = buildAllSheets();
  const pickedCount = allSheets.filter((s) => pick[s.key]).length;

  // ── ดาวน์โหลดเฉพาะตารางที่ติ๊กเลือก เป็นไฟล์ Excel มีสไตล์ (โหลด exceljs เฉพาะตอนกด) ──
  async function doDownload() {
    const chosen = allSheets.filter((s) => pick[s.key]);
    if (!chosen.length) return;
    setExporting(true); setExportErr("");
    try {
      const { downloadSheets } = await import("./excelExport.js");
      await downloadSheets(
        `report-${todayStr()}${selProj?.code ? "-" + selProj.code : ""}${partFilter ? "-" + partFilter : ""}.xlsx`,
        chosen.map((s) => ({ name: s.name, rows: s.rows })),
      );
      setExportOpen(false);
    } catch (e) {
      console.warn("export excel error", e);
      setExportErr("สร้างไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">รายงานข้อมูลสแกน</div>
          <div className="page-sub">สรุปผลการสแกนตามช่วงเวลาและ Part ที่เลือก</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {deptFilter === "machine" && (
            <Btn variant="accent" onClick={() => { setExportErr(""); setExportOpen(true); }} disabled={filteredLogs.length === 0}
              title="เลือกตารางแล้วดาวน์โหลดเป็นไฟล์ Excel">
              <Icon name="grid" size={15} /> ดาวน์โหลด Excel
            </Btn>
          )}
        </div>
      </div>

      {exportOpen && (
        <Modal title="เลือกตารางที่จะดาวน์โหลด" sub="ติ๊กเฉพาะตารางที่ต้องการ แล้วดาวน์โหลดเป็นไฟล์ Excel (.xlsx)"
          onClose={() => { if (!exporting) setExportOpen(false); }} locked={exporting}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>เลือกแล้ว {pickedCount}/{allSheets.length} ตาราง</span>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn variant="ghost" onClick={() => setPick({ op: true, machine: true, cycle: true, part: true, daily: true })} disabled={exporting}>เลือกทั้งหมด</Btn>
              <Btn variant="ghost" onClick={() => setPick({ op: false, machine: false, cycle: false, part: false, daily: false })} disabled={exporting}>ล้าง</Btn>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {allSheets.map((s) => (
              <label key={s.key}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10,
                  cursor: exporting ? "default" : "pointer",
                  background: pick[s.key] ? "var(--accent-soft, rgba(37,99,235,0.08))" : "transparent",
                  border: "1px solid var(--border, #e5e7eb)" }}>
                <input type="checkbox" checked={!!pick[s.key]} disabled={exporting}
                  onChange={(e) => setPick((p) => ({ ...p, [s.key]: e.target.checked }))}
                  style={{ accentColor: "var(--accent)", width: 16, height: 16, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {s.rows.length ? `${s.rows.length.toLocaleString()} แถว` : "ไม่มีข้อมูลในช่วงนี้"}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {exportErr && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 10 }}>{exportErr}</div>}
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <Btn variant="ghost" onClick={() => setExportOpen(false)} disabled={exporting}>ยกเลิก</Btn>
            <Btn variant="accent" onClick={doDownload} disabled={exporting || pickedCount === 0}>
              {exporting ? "กำลังสร้างไฟล์..." : `ดาวน์โหลด Excel (${pickedCount})`}
            </Btn>
          </div>
        </Modal>
      )}

      <Card title="ช่วงเวลาที่ต้องการดู">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 22, alignItems: "start" }}>
          {/* ── ซ้าย: ช่วงเวลา (โหมด + ค่า เรียงชิดกัน) ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 9 }}>ช่วงเวลา</div>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {RANGE_MODES.map((m) => (
                <span key={m.value} className={`chip ${rangeMode === m.value ? "active" : ""}`} onClick={() => setRangeMode(m.value)}>
                  {m.label}
                </span>
              ))}
            </div>
            <div>
              {rangeMode === "preset" && <PresetPicker value={preset} onChange={setPreset} />}
              {rangeMode === "month" && (
                <Input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} style={{ maxWidth: 220 }} />
              )}
              {rangeMode === "custom" && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ maxWidth: 180 }} />
                  <span style={{ color: "var(--muted)" }}>–</span>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ maxWidth: 180 }} />
                </div>
              )}
            </div>
          </div>
          {/* ── ขวา: กรองโปรเจค + Part (ป้ายบน · เต็มความกว้าง) ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>โปรเจค</div>
              <Select value={projectFilter} style={{ width: "100%" }}
                onChange={(e) => {
                  const pid = e.target.value;
                  setProjectFilter(pid);
                  // ถ้า Part/Release ที่เลือกไว้ไม่ได้อยู่ในโปรเจคใหม่ → ล้างตัวกรองนั้น
                  if (pid && partFilter && !parts.some((p) => p.project_id === pid && p.part_no === partFilter)) setPartFilter("");
                  if (pid && releaseFilter && !logs.some((l) => logProjectId(l) === pid && String(l.release_order || "") === releaseFilter)) setReleaseFilter("");
                }}
                options={projectOptions} />
            </div>
            {/* ── กลาง: เลือก Release (ดรอปดาวน์ · เฉพาะที่มีงานในช่วงเวลานี้) ── */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Release</div>
              <Select value={releaseFilter} onChange={(e) => setReleaseFilter(e.target.value)} style={{ width: "100%" }}
                options={releaseOrders.map((ro) => ({ value: ro, label: ro }))} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Part</div>
              <Select value={partFilter} onChange={(e) => setPartFilter(e.target.value)} style={{ width: "100%" }}
                options={visibleParts.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.part_name}` }))} />
            </div>
            {(projectFilter || partFilter || releaseFilter) && (
              <div>
                <Btn variant="ghost" size="sm" onClick={() => { setProjectFilter(""); setPartFilter(""); setReleaseFilter(""); }}>
                  <Icon name="close" size={13} /> {lang === "en" ? "Clear search" : "ล้างการค้นหา"}
                </Btn>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* แยกดูตามแผนก — เครื่องจักร / แผง / ซับ / แพ็ก (กดสลับ · กรองทั้งรายงาน) */}
      <DeptTabs value={deptFilter} onChange={setDeptFilter} />

      {deptFilter === "machine" ? (
      <>
      <div className="stat-row">
        <StatCard label="จำนวนที่บันทึก · นับต่อขั้นตอน" value={totalPieces(filteredLogs).toLocaleString()} icon="scan" />
        <StatCard label="งาน/ล็อตที่มีความเคลื่อนไหว" value={distinctUnits.toLocaleString()} icon="box" />
        <StatCard label={lang === "en" ? "Avg weight · per active day (kg)" : "น้ำหนักเฉลี่ย · ต่อวันทำงาน (กก.)"} value={fmtNum(avgWeightPerDay)} icon="weight" />
        <StatCard label="ปริมาณงานที่ประมวลผล · ทุกขั้นตอน (กก.)" value={fmtNum(processed)} icon="bolt" />
        <StatCard label="เวลาเดินเครื่องรวม (จับจากหน้าเครื่อง)" value={fmtHrs(totalSeconds)} icon="bolt" />
      </div>

      {noWeight.length > 0 && (
        <div className="card" style={{ background: "var(--danger-tint, #fff4f4)", borderColor: "var(--danger, #e11d1d)", color: "var(--danger-dk, #a01212)", fontSize: 12.5, padding: "10px 14px", marginBottom: 14, lineHeight: 1.6 }}>
          <Icon name="warn" size={14} style={{ verticalAlign: "-2px", marginInlineEnd: 4 }} /><b>มี Part ที่ยังไม่ได้ตั้งน้ำหนัก/ชิ้น — น้ำหนักจะถูกนับเป็น 0 กก.</b><br />
          {noWeight.map((p) => `${p.partNo} (${fmtNum(p.pieces)} ชิ้น)`).join(" · ")}
          <br /><span style={{ opacity: .8 }}>ไปตั้งค่าน้ำหนัก/ชิ้นที่ Setup → Part Master เพื่อให้ กก. ครบถ้วน</span>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-8px 2px 14px", lineHeight: 1.6 }}>
        {lang === "en"
          ? <><b>Avg weight · per active day</b> = processed workload ÷ days that had work · a piece doing several ops in one machine at once counts once ·{" "}
              <b>Processed workload</b> = every scan summed; a piece through several separate operations is counted per operation (production-line load)</>
          : <><b>น้ำหนักเฉลี่ย/วัน</b> = ปริมาณงานที่ประมวลผล ÷ จำนวนวันที่มีงานจริง · ชิ้นที่ทำหลายขั้นตอนในเครื่องเดียว (สแกนครั้งเดียว) นับครั้งเดียว ·{" "}
              <b>ปริมาณงานที่ประมวลผล</b> = รวมทุกครั้งที่สแกน ชิ้นที่ผ่านหลายขั้นตอน (คนละครั้ง) นับต่อขั้นตอน (วัดภาระงานรวมของสาย)</>}
      </div>
      <Card title="แยกตามขั้นตอนการทำงาน">
        <SimpleBarChart data={chartData} color={CHART.accent} height={260} />
      </Card>

      <Card title="เครื่องจักร × ขั้นตอน (ปริมาณงาน + เฉลี่ย/วัน)">
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          {lang === "en"
            ? <>How much each machine did per operation (pcs·kg) + machine time + avg/day, all in one table · <b>Avg/day</b> is based on days with activity only</>
            : <>แต่ละเครื่องทำขั้นตอนอะไรไปเท่าไร (ชิ้น·กก.) + เวลาเดินเครื่อง + เฉลี่ย/วัน ในตารางเดียว · <b>เฉลี่ย/วัน</b> คิดจากเฉพาะวันที่มีงานจริง</>}
        </div>
        {matrix.machines.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 2px" }}>{lang === "en" ? "No scans in this period" : "ยังไม่มีการสแกนในช่วงเวลานี้"}</div>
        ) : (
          <DataTable id="report-machine-op" wrapClass="table-wrap tall-scroll" tableClass="data-table"
            rows={matrix.machines} rowKey={(m) => m.name} sort={sortM} sortAccessors={machineAcc}
            rowCtx={(m) => ({ dm: dailyMatrix.machines.find((x) => x.name === m.name) })}
            rowProps={(m) => ({
              className: "release-row", style: { cursor: "pointer" },
              onClick: () => setDrill({
                mode: "machine",
                title: m.code || m.name,
                subtitle: (m.code && m.name ? m.name + " · " : "") + (lang === "en" ? "scans in the selected period" : "การสแกนในช่วงที่เลือก"),
                logs: filteredLogs.filter((l) => (l.machine?.code || l.machine?.name) === (m.code || m.name)),
              }),
              title: lang === "en" ? "Click to see the scans behind these numbers" : "แตะเพื่อดูการสแกนที่เป็นที่มาของตัวเลขนี้",
            })}
            columns={[
              { key: "code", header: lang === "en" ? "Machine code" : "รหัสเครื่อง", sortKey: "code",
                tdStyle: { fontFamily: "var(--font-mono)", color: "var(--muted)", whiteSpace: "nowrap" }, cell: (m) => m.code || "—" },
              { key: "name", header: "เครื่องจักร", sortKey: "name", tdStyle: { fontWeight: 600 }, cell: (m) => m.name },
              ...matrix.opNames.map((op) => ({
                key: `op:${op}`, header: opLabel(op, lang), sortKey: `op:${op}`, align: "right",
                cell: (m) => { const cell = m.ops[op]; return cell ? `${cell.count.toLocaleString()} ชิ้น` : <span style={{ color: "var(--surface-3)" }}>—</span>; },
              })),
              { key: "total", header: "รวม (ชิ้น)", sortKey: "total", align: "right", tdStyle: { fontWeight: 600, whiteSpace: "nowrap" }, cell: (m) => `${m.total.count.toLocaleString()} ชิ้น` },
              { key: "weight", header: "น้ำหนัก (กก.)", sortKey: "weight", align: "right", tdStyle: { whiteSpace: "nowrap", color: "var(--accent-dk)" }, cell: (m) => m.total.weight > 0 ? `${fmtNum(m.total.weight)} กก.` : "—" },
              { key: "time", header: "เวลาเดินเครื่อง", sortKey: "time", align: "right", tdStyle: { fontFamily: "var(--font-mono)" }, cell: (m) => m.total.seconds ? fmtHrs(m.total.seconds) : "—" },
              { key: "secPer", header: "วินาที/ชิ้น", sortKey: "secPer", align: "right", tdStyle: { fontFamily: "var(--font-mono)", color: "var(--accent-dk)", whiteSpace: "nowrap" }, cell: (m) => (m.total.seconds && m.total.count) ? `${(m.total.seconds / m.total.count).toFixed(1)} วิ` : "—" },
              { key: "avgKg", header: "เฉลี่ย กก./วัน", sortKey: "avgKg", align: "right", tdStyle: { whiteSpace: "nowrap", color: "var(--accent-dk)" }, cell: (m, i, c) => c.dm ? `${fmtNum(c.dm.avg.weight)} กก.` : "—" },
              { key: "avgPcs", header: "เฉลี่ย ชิ้น/วัน", sortKey: "avgPcs", align: "right", tdStyle: { whiteSpace: "nowrap", color: "var(--accent-dk)" },
                cell: (m, i, c) => c.dm ? <span>{fmtNum(c.dm.avg.count)} ชิ้น{c.dm.avg.seconds ? <span style={{ color: "var(--muted)", fontSize: 11 }}> · {fmtHrs(c.dm.avg.seconds)}</span> : null}</span> : "—" },
            ]} />
        )}
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
          {lang === "en"
            ? <>Numbers are workload (counted per scan), not material quantity · <b>Machine time</b> = time captured between START–SAVE on the terminal (not the machine's actual power-on time)</>
            : <>ตัวเลขคือปริมาณงาน (นับต่อการสแกน) ไม่ใช่จำนวนวัสดุ · <b>เวลาเดินเครื่อง</b> = เวลาที่จับจากกด START–SAVE บนหน้าเครื่อง (ไม่ใช่เวลาเครื่องเปิดจริง)</>}
        </div>
      </Card>

      <Card title={lang === "en" ? "Release × Part × Operation" : "Release × Part × ขั้นตอน"}>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          {lang === "en"
            ? <>Each row = a Part in each Release · Operation columns = pieces that passed that operation · <b>Weight</b> in its own column · <b>Finished</b> = pieces marked Finished</>
            : <>แต่ละแถว = Part ในแต่ละ Release · คอลัมน์ขั้นตอน = จำนวนชิ้นที่ผ่านขั้นตอนนั้น · <b>น้ำหนัก</b> แยกคอลัมน์ · <b>เสร็จ</b> = ชิ้นที่กด Finished</>}
        </div>
        {partMatrix.parts.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 2px" }}>{lang === "en" ? "No scans in this period" : "ยังไม่มีการสแกนในช่วงเวลานี้"}</div>
        ) : (
          <DataTable id="report-part-op" wrapClass="table-wrap tall-scroll" tableClass="data-table"
            rows={partMatrix.parts} rowKey={(p) => `${p.releaseOrder} ${p.partNo}`} sort={sortP} sortAccessors={partAcc}
            rowProps={(p) => ({
              className: "release-row", style: { cursor: "pointer" },
              onClick: () => setDrill({
                mode: "part",
                title: p.partNo + (p.partName && p.partName !== p.partNo ? " · " + p.partName : ""),
                subtitle: `Release ${p.releaseOrder}`,
                logs: filteredLogs.filter((l) => partKeyOf(l) === `${p.releaseId || p.releaseOrder}|${p.partNo}`),
              }),
              title: lang === "en" ? "Click to see the scans behind these numbers" : "แตะเพื่อดูการสแกนที่เป็นที่มาของตัวเลขนี้",
            })}
            columns={[
              { key: "release", header: "Release", sortKey: "release", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }, cell: (p) => p.releaseOrder },
              { key: "part_no", header: "Part No.", sortKey: "part_no", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }, cell: (p) => p.partNo },
              { key: "part_name", header: "ชื่อ Part", sortKey: "part_name", tdStyle: { color: "var(--muted)", fontSize: 12.5, whiteSpace: "nowrap" }, cell: (p) => p.partName },
              ...partMatrix.opNames.map((op) => ({
                key: `op:${op}`, header: opLabel(op, lang), sortKey: `op:${op}`, align: "right",
                cell: (p) => { const cell = p.ops[op]; return cell ? `${cell.count.toLocaleString()} ชิ้น` : <span style={{ color: "var(--surface-3)" }}>—</span>; },
              })),
              { key: "total", header: "รวม (ชิ้น)", sortKey: "total", align: "right", tdStyle: { fontWeight: 600 }, cell: (p) => `${p.total.count.toLocaleString()} ชิ้น` },
              { key: "weight", header: "น้ำหนัก (กก.)", sortKey: "weight", align: "right", tdStyle: { whiteSpace: "nowrap", color: "var(--accent-dk)" }, cell: (p) => p.total.weight > 0 ? `${fmtNum(p.total.weight)} กก.` : "—" },
              { key: "finished", header: "เสร็จ (ชิ้น)", sortKey: "finished", align: "right",
                tdProps: (p) => ({ style: { fontWeight: 700, color: p.total.finished > 0 ? "var(--success)" : "var(--muted)" } }),
                cell: (p) => p.total.finished > 0 ? `${p.total.finished.toLocaleString()} ชิ้น` : "—" },
            ]} />
        )}
      </Card>

      {drill && (
        <ScanDrillModal mode={drill.mode} title={drill.title} subtitle={drill.subtitle}
          logs={drill.logs} opOrder={opOrder} onClose={() => setDrill(null)} />
      )}

      {/* ── Finished Part (รวมมาไว้ในหน้า Report) ──────────────────────────── */}
      <div className="section-heading" style={{ margin: "26px 2px 12px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
        {lang === "en" ? "Finished Parts — completed pieces" : "Finished Part — ชิ้นงานที่เสร็จสมบูรณ์"}
      </div>
      <FinishedPartSection releases={allRels} projectFilter={projectFilter} partFilter={partFilter} releaseFilter={releaseFilter} />
      </>
      ) : (
        <AssemblyReportView from={curRange.from} to={curRange.to} parentKind={deptFilter === "packing" ? "package" : deptFilter === "panel" ? "panel" : "subassembly"} projectFilter={projectFilter} partFilter={partFilter} goTo={goTo} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 6) MACHINES SUMMARY
// ══════════════════════════════════════════════════════════════════════════
// เหตุผล "รายงานการทำงาน (รอบช้า)" มาตรฐาน — ใช้ในตัวเลือกป็อปอัพแก้สแกน (ตรงกับหน้าเครื่อง)
const SCAN_SLOW_REASONS = ["ปั้มลมมีปัญหา", "เครื่องเดินไม่เต็มที่ / รวน", "ดอก/ใบมีดสึก", "วัตถุดิบไม่ได้ขนาด/มีตำหนิ", "แบบ/ดรออิงไม่ชัด", "งานยาก/ซับซ้อนกว่าปกติ", "อื่นๆ"];

// ── เจาะดู "สแกนทั้งหมดของเครื่องนี้" — ตารางบันทึกงานหน้าเครื่อง (วัน-เวลา · พาร์ท · ขั้นตอน · จำนวน) ──
//    เปิดจากแถวเครื่องในหน้าสรุปเครื่องจักร · เลือกช่วงเวลาเองได้ (ด่วน/รายเดือน/กำหนดเอง) · ล่าสุดอยู่บนสุด
function MachineScanDetail({ machine, onBack }) {
  const [lang] = useLang();
  const [rangeMode, setRangeMode] = useState("preset");
  const [preset, setPreset] = useState("year");           // เริ่มต้น 12 เดือน = เห็นเกือบทั้งหมด
  const [monthValue, setMonthValue] = useState(todayStr().slice(0, 7));
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());
  const [logs, setLogs] = useState(null);                 // null = กำลังโหลด
  const sort = useTableSort("time", "desc");               // ค่าเริ่มต้น: วัน-เวลา ล่าสุดอยู่บนสุด
  const admin = isAdmin(getSession());                     // เฉพาะแอดมินถึงจะลบสแกนได้
  const [reloadTick, setReloadTick] = useState(0);         // บวกเพื่อโหลดใหม่หลังลบ
  const [orderQty, setOrderQty] = useState({});            // จำนวนสั่ง ต่อ release_id (ไว้ดูสแปร์)
  const [editRow, setEditRow] = useState(null);            // แถว (scan) ที่กด Edit เพื่อแก้จำนวน/ลบ
  const [newQty, setNewQty] = useState(1);                 // จำนวนใหม่ในป็อปอัป (เพิ่ม/ลด/0=ลบ)
  const [relInfo, setRelInfo] = useState({});              // release_id → { qty, length_mm, part_master_id, material, default_length_mm }
  const [matLenMap, setMatLenMap] = useState({});          // release_id → [material_length_mm ที่ใช้จริง]
  const [allOps, setAllOps] = useState([]);                // รายการขั้นตอนทั้งหมด (ไว้เลือก STEP)
  const [slowRows, setSlowRows] = useState([]);            // เหตุผลรอบช้า (รายงานการทำงาน) ต่อสแกน — จับคู่ด้วย part_unit+เวลา
  // ฟอร์มแก้ทั้งแถว — รายสแกน (dt/weight/runMin/status/opIds/slowReason/slowNote) + ระดับล็อต/พาร์ท (partNo/releaseOrder/ordered/mat/partLen/matLen)
  const [edForm, setEdForm] = useState({ dt: "", weight: "", runMin: "", status: "", opIds: [], slowReason: "", slowNote: "", partNo: "", releaseOrder: "", ordered: "", mat: "", partLen: "", matLen: "" });
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);   // กำลังสร้างไฟล์ Excel ของตารางนี้
  const colApi = useRef(null);                          // ปุ่มรีเซ็ตลำดับคอลัมน์ (DataTable ส่ง { reset } มา)

  useEffect(() => { listRows("operations", { order: "seq" }).then((r) => setAllOps(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  useEffect(() => {
    let alive = true;
    const range =
      rangeMode === "month" ? monthRangeFor(monthValue) :
      rangeMode === "custom" ? customRangeFor(customFrom, customTo) :
      rangeFor(preset);
    setLogs(null);
    getScanLogsBetween(range.from, range.to)
      .then((d) => { if (alive) setLogs(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setLogs([]); });
    listScanSlow(range.from, range.to)
      .then((d) => { if (alive) setSlowRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setSlowRows([]); });
    return () => { alive = false; };
  }, [rangeMode, preset, monthValue, customFrom, customTo, reloadTick]);

  // จำนวนสั่ง (ordered qty) ต่อ release — ไว้เทียบว่ามีสแปร์ไหม (สแกนเกินจำนวนสั่ง)
  useEffect(() => {
    const ids = [...new Set((logs || []).map((l) => l.release_id).filter(Boolean))];
    if (!ids.length) { setOrderQty({}); setRelInfo({}); setMatLenMap({}); return; }
    let alive = true;
    supabase.from("releases").select("id, qty, length_mm, part_master_id, part_master(material, default_length_mm)").in("id", ids)
      .then(({ data }) => { if (alive && Array.isArray(data)) {
        const oq = {}, ri = {};
        data.forEach((r) => {
          oq[r.id] = Number(r.qty) || 0;
          ri[r.id] = { qty: Number(r.qty) || 0, length_mm: r.length_mm, part_master_id: r.part_master_id, material: r.part_master?.material || "", default_length_mm: r.part_master?.default_length_mm };
        });
        setOrderQty(oq); setRelInfo(ri);
      } })
      .catch(() => {});
    getReleaseMaterialLengths(ids).then((m) => { if (alive) setMatLenMap(m || {}); }).catch(() => {});
    return () => { alive = false; };
  }, [logs]);

  const mkey = machine.code || machine.name;              // คีย์เดียวกับ machineOpMatrix (code ก่อน ชื่อสำรอง)
  const mine = (logs || []).filter((l) => (l.machine?.code || l.machine?.name) === mkey);

  // ── จับกลุ่ม "1 การสแกน = 1 แถว" แล้วโชว์ทุกขั้นตอนที่ติ๊กในสแกนนั้น ──
  //    หน้าเครื่องบันทึกแบบ count-once: ขั้นตอนหลัก (ติ๊กตัวแรก) = จำนวนจริง · ขั้นตอนอื่นที่ติ๊ก = อีก record แต่จำนวน 0
  //    report_logs คืนทุก record (รวมตัวจำนวน 0) → ถ้าโชว์ดิบจะเห็นขั้นตอนเดียวต่อแถว + มีแถวจำนวน 0 เกลื่อน
  //    จึงยุบ record จำนวน 0 (ขั้นตอนที่ติ๊กเพิ่ม) เข้ากับ record หลักของสแกนเดียวกัน แล้วโชว์ครบทุกขั้นตอน
  //    (ตัวหลักถูกบันทึกก่อนเสมอ → เรียงตามเวลา asc แล้วตัว 0 ที่ตามมา = ขั้นตอนเสริมของสแกนนั้น)
  const opOf = (l) => l.operation?.name || null;
  const grouped = (() => {
    const asc = [...mine].sort((a, b) => String(a.scanned_at || "").localeCompare(String(b.scanned_at || "")));
    const out = [];
    let cur = null;
    for (const l of asc) {
      const qv = Number(l.quantity) || 0;
      const op = opOf(l);
      if (qv > 0) {                                       // record หลัก (มีจำนวนจริง) → เริ่มกลุ่มใหม่
        cur = {
          key: l.id || `${l.part_unit_id}-${l.scanned_at}`,
          time: l.scanned_at,
          part_no: l.part_unit?.part_master?.part_no || "—",
          part_name: l.part_unit?.part_master?.part_name || "—",
          release_order: l.release_order || "—", release_id: l.release_id,
          status: l.status, part_unit_id: l.part_unit_id,
          ops: op ? [op] : [], qty: qv, weight: logWeight(l), secs: Number(l.process_seconds) || 0, material_length_mm: l.material_length_mm != null ? Number(l.material_length_mm) : null,
        };
        out.push(cur);
      } else if (cur && cur.part_unit_id === l.part_unit_id
                 && String(cur.status).toLowerCase() === String(l.status).toLowerCase()) {
        if (op && !cur.ops.includes(op)) cur.ops.push(op);   // ขั้นตอนที่ติ๊กเพิ่ม (จำนวน 0) → เติมเข้ากลุ่มเดียวกัน
        cur.weight += logWeight(l); cur.secs += Number(l.process_seconds) || 0;
      } else {                                            // record จำนวน 0 ที่ไม่มีตัวหลักคู่ (หายาก) → แถวเดี่ยว
        out.push({
          key: (l.id || `${l.part_unit_id}-${l.scanned_at}`) + "-x",
          time: l.scanned_at,
          part_no: l.part_unit?.part_master?.part_no || "—",
          part_name: l.part_unit?.part_master?.part_name || "—",
          release_order: l.release_order || "—", release_id: l.release_id,
          status: l.status, part_unit_id: l.part_unit_id,
          ops: op ? [op] : [], qty: 0, weight: logWeight(l), secs: Number(l.process_seconds) || 0, material_length_mm: l.material_length_mm != null ? Number(l.material_length_mm) : null,
        });
      }
    }
    // จับคู่เหตุผล "รอบช้า" (รายงานการทำงาน) เข้าแต่ละสแกน — ตรง part_unit + เวลาใกล้กัน (±3 วิ)
    if (slowRows && slowRows.length) {
      const usedSlow = new Set();   // กันเหตุผลเดียวถูกจับไปหลายแถว (rescan ชิ้นเดิมเร็วๆ)
      for (const g of out) {
        let best = null, bestDt = 3000, bestIdx = -1;
        for (let si = 0; si < slowRows.length; si++) {
          if (usedSlow.has(si)) continue;
          const s = slowRows[si];
          if (s.part_unit_id !== g.part_unit_id) continue;
          const dt = Math.abs(new Date(s.at) - new Date(g.time));
          if (dt < bestDt) { best = s; bestDt = dt; bestIdx = si; }   // เลือกเวลาใกล้สุด — สแกนของเครื่องตัวเอง = 0 วิ → ไม่หยิบเหตุผลของเครื่องอื่น/รอบอื่น
        }
        if (best) { usedSlow.add(bestIdx); g.slow_reason = best.reason || ""; g.slow_note = best.note || ""; }
      }
    }
    return out;
  })();

  const acc = {
    time: (g) => g.time || "",
    part: (g) => g.part_no || "",
    pname: (g) => g.part_name || "",
    ro: (g) => g.release_order || "",
    op: (g) => g.ops.join(" · "),
    status: (g) => (String(g.status).toLowerCase() === "finished" ? 1 : 0),
    qty: (g) => Number(g.qty) || 0,
    weight: (g) => Number(g.weight) || 0,
    secs: (g) => Number(g.secs) || 0,
  };
  const sorted = sort.sortRows(grouped, acc);

  // สรุปหัวตาราง (เฉพาะเครื่องนี้ ในช่วงเวลาที่เลือก) — จำนวน/น้ำหนัก/เวลา ไม่นับซ้ำ (ตัวเสริมจำนวน 0)
  const totPcs = mine.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const totWt = mine.reduce((s, l) => s + logWeight(l), 0);
  const totSec = mine.reduce((s, l) => s + (Number(l.process_seconds) || 0), 0);

  const statCell = { flex: 1, minWidth: 140, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" };
  const statLbl = { fontSize: 11.5, color: "var(--muted)" };
  const pill = (st) => {
    const fin = String(st).toLowerCase() === "finished";
    return (
      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
        color: fin ? "var(--success)" : "var(--accent-dk)",
        background: fin ? "rgba(16,157,99,.12)" : "rgba(37,99,235,.10)",
        border: `1px solid ${fin ? "var(--success)" : "var(--accent-dk)"}` }}>
        {fin ? (lang === "en" ? "finished" : "เสร็จ") : (lang === "en" ? "in process" : "กำลังทำ")}
      </span>
    );
  };

  // ── จำนวนสั่ง/สแปร์ + เลือกหลายแถวเพื่อลบ (admin) ──
  const scannedByRel = {};   // สแกนไปแล้วกี่ชิ้นต่อ release (เฉพาะเครื่องนี้) → เทียบจำนวนสั่งดูสแปร์
  grouped.forEach((g) => { if (g.release_id) scannedByRel[g.release_id] = (scannedByRel[g.release_id] || 0) + (Number(g.qty) || 0); });
  const colCount = 9 + (admin ? 1 : 0);
  // ── ค่าระดับล็อต/พาร์ท (ต่อ release) สำหรับคอลัมน์ + ฟอร์มแก้ ──
  const partLenOf = (rid) => { const ri = relInfo[rid]; const v = ri?.length_mm ?? ri?.default_length_mm; return (v == null || v === "") ? null : v; };
  const matLenTextOf = (rid) => { const a = matLenMap[rid] || []; if (!a.length) return "-"; return a.length === 1 ? fmtNum(a[0]) : a.map((n) => fmtNum(n)).join(" · "); };
  // แปลงเวลา ↔ ช่อง datetime-local (เวลาเครื่องผู้ใช้)
  const toDTLocal = (iso) => { try { const d = new Date(iso); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return ""; } };
  const fromDTLocal = (s) => { try { const d = new Date(s); return isNaN(d) ? null : d.toISOString(); } catch { return null; } };
  // ขั้นตอน (STEP) ปัจจุบันของสแกน → operation_id ตามลำดับ (ตัวหลักก่อน) อิงชื่อจาก allOps
  const opIdsOf = (g) => { const byName = {}; allOps.forEach((o) => { if (o && o.name != null) byName[o.name] = o.id; }); return (g.ops || []).map((n) => byName[n]).filter(Boolean); };

  // ── เปิดฟอร์มแก้ทั้งแถว — เติมค่าเดิมทุกฟิลด์ (รายสแกน + ระดับล็อต) ──
  const openEdit = (g) => {
    setEditRow(g);
    setNewQty(Math.max(0, Number(g.qty) || 0));
    const ri = relInfo[g.release_id] || {};
    const ml = matLenMap[g.release_id] || [];
    const pl = ri.length_mm ?? ri.default_length_mm;
    setEdForm({
      dt: toDTLocal(g.time),
      weight: "",   // เว้นว่าง = คิดจากจำนวนอัตโนมัติ · พิมพ์เอง = กำหนดน้ำหนักเอง
      runMin: g.secs ? String(Math.round((Number(g.secs) || 0) / 60)) : "",
      status: (String(g.status).toLowerCase() === "finished") ? "finished" : "inprocess",
      opIds: opIdsOf(g),
      slowReason: g.slow_reason || "",
      slowNote: g.slow_note || "",
      partNo: (g.part_no && g.part_no !== "—") ? g.part_no : "",
      releaseOrder: (g.release_order && g.release_order !== "—") ? g.release_order : "",
      ordered: ri.qty != null ? String(ri.qty) : (orderQty[g.release_id] != null ? String(orderQty[g.release_id]) : ""),
      mat: ri.material || "",
      partLen: (pl == null || pl === "") ? "" : String(pl),
      matLen: g.material_length_mm != null ? String(g.material_length_mm) : (ml.length === 1 ? String(ml[0]) : ""),
    });
  };
  async function doApply() {
    if (!editRow) return;
    const g = editRow;
    const cur = Number(g.qty) || 0;
    const nq = Math.max(0, Math.floor(Number(newQty) || 0));
    const ri = relInfo[g.release_id] || {};
    const ml0 = matLenMap[g.release_id] || [];
    // ── ค่าเดิม (เทียบว่าฟิลด์ไหนถูกแก้จริง) ──
    const origDT = toDTLocal(g.time);
    const origWeight = g.weight != null ? Number(g.weight) : 0;
    const origRunMin = g.secs ? Math.round((Number(g.secs) || 0) / 60) : 0;
    const origStatus = (String(g.status).toLowerCase() === "finished") ? "finished" : "inprocess";
    const origOps = opIdsOf(g);
    const origPartNo = (g.part_no && g.part_no !== "—") ? g.part_no : "";
    const origRO = (g.release_order && g.release_order !== "—") ? g.release_order : "";
    const origOrdered = ri.qty != null ? Number(ri.qty) : (orderQty[g.release_id] != null ? Number(orderQty[g.release_id]) : null);
    const origMat = ri.material || "";
    const origPartLen = (ri.length_mm ?? ri.default_length_mm ?? "");
    const origMatLen = g.material_length_mm != null ? Number(g.material_length_mm) : (ml0.length === 1 ? Number(ml0[0]) : null);
    const origSlowReason = g.slow_reason || "";
    const origSlowNote = g.slow_note || "";

    const isDelete = nq === 0;
    const nWeight = edForm.weight === "" ? null : Number(edForm.weight);
    const nRunMin = edForm.runMin === "" ? null : Math.max(0, Math.floor(Number(edForm.runMin) || 0));
    const nStatus = edForm.status || origStatus;
    const nOps = Array.isArray(edForm.opIds) ? edForm.opIds : [];
    const nPartNo = (edForm.partNo || "").trim();
    const nRO = (edForm.releaseOrder || "").trim();
    const nOrdered = edForm.ordered === "" ? null : Math.max(0, Math.floor(Number(edForm.ordered) || 0));
    const nMat = (edForm.mat || "").trim();
    const nPartLen = edForm.partLen;
    const nMatLen = edForm.matLen === "" ? "" : Number(edForm.matLen);
    const nSlowReason = (edForm.slowReason || "").trim();
    const nSlowNote = (edForm.slowNote || "").trim();

    // รายสแกน (แถวนี้)
    const qtyChanged = nq !== cur;
    const wtChanged = !isDelete && nWeight != null;   // พิมพ์น้ำหนักเอง = override (เว้นว่าง = auto จากจำนวน)
    const runChanged = !isDelete && nRunMin != null && nRunMin !== origRunMin;
    const statusChanged = !isDelete && nStatus !== origStatus;
    const dtChanged = !isDelete && edForm.dt !== "" && edForm.dt !== origDT;
    const opsChanged = !isDelete && nOps.length >= 1 && nOps.join(",") !== origOps.join(",");
    const mlChanged = !isDelete && nMatLen !== "" && Number(nMatLen) > 0 && Number(nMatLen) !== (origMatLen ?? NaN);   // Mat. Length = รายสแกน
    const slowChanged = !isDelete && (nSlowReason !== origSlowReason || nSlowNote !== origSlowNote);   // รายงานการทำงาน = รายสแกน
    const scanChanged = qtyChanged || wtChanged || runChanged || statusChanged || dtChanged || opsChanged || mlChanged || slowChanged;
    // ระดับล็อต/พาร์ท
    const partNoChanged = !isDelete && nPartNo !== "" && nPartNo !== origPartNo;
    const roChanged = !isDelete && nRO !== origRO;
    const orderedChanged = !isDelete && nOrdered != null && nOrdered !== (origOrdered ?? NaN);
    const matChanged = !isDelete && nMat !== (origMat || "");
    const plChanged = !isDelete && String(nPartLen) !== String(origPartLen ?? "");
    const lotChanged = partNoChanged || roChanged || orderedChanged || matChanged || plChanged;

    if (!isDelete && !scanChanged && !lotChanged) { setEditRow(null); return; }

    const ok = await askConfirm({
      message: isDelete
        ? `ยืนยันลบสแกนนี้ทั้งแถว?\n${g.part_no} · ${fmtNum(cur)} ชิ้น → ชิ้นกลับเป็น "ยังไม่ทำ" (QR/ล็อตยังอยู่) · ลบแล้วกู้คืนไม่ได้`
        : `ยืนยันบันทึกการแก้ไขแถวนี้?\n${g.part_no} · ${fmtDT(g.time)}`
          + (scanChanged ? `\n· แก้ข้อมูลเฉพาะสแกนนี้` : "")
          + (lotChanged ? `\n\n⚠️ Part No. / Release / จำนวนสั่ง / INV / ความยาวพาร์ท มีผลกับ "ทุกสแกน" ของ Release/พาร์ทนี้ ไม่ใช่แค่แถวนี้` : ""),
      tone: isDelete ? "danger" : "warn", confirmText: isDelete ? "ลบทั้งแถว" : "บันทึก", cancelText: "ยกเลิก",
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (isDelete) {
        await editScan(g.part_unit_id, g.time, { qty: 0 });
        auditRecord("clear_scans", "scan_data", g.release_id, { scope: "scan_delete", machine: mkey, from: cur });
      } else {
        // ── รายสแกน (แถวนี้) — RPC เดียวครบ: จำนวน/น้ำหนัก/เวลา/สถานะ/วันเวลา/ขั้นตอน ──
        if (scanChanged) {
          await editScan(g.part_unit_id, g.time, {
            qty: nq,
            weight: wtChanged ? nWeight : null,           // null = คิดอัตโนมัติจากจำนวน
            secs: runChanged ? nRunMin * 60 : null,
            status: statusChanged ? nStatus : null,
            recordedAt: dtChanged ? fromDTLocal(edForm.dt) : null,
            opIds: opsChanged ? nOps : null,
            matLen: mlChanged ? nMatLen : null,           // Mat. Length = เฉพาะสแกนนี้
            slowReason: slowChanged ? nSlowReason : null, // รายงานการทำงาน = เฉพาะสแกนนี้ (null = ไม่แตะ · '' = ล้าง)
            slowNote: slowChanged ? nSlowNote : null,
          });
        }
        // ── ระดับพาร์ท (part_master: Part No. + INV) — มีผลทุก Release ของพาร์ทนี้ ──
        const pmPatch = {};
        if (partNoChanged) { pmPatch.part_no = nPartNo; pmPatch.part_name = nPartNo; }
        if (matChanged) pmPatch.material = nMat || null;
        if (Object.keys(pmPatch).length && ri.part_master_id) await updateRow("part_master", ri.part_master_id, pmPatch);
        // ── ระดับ Release (release_order + จำนวนสั่ง + ความยาวพาร์ท) ──
        const relPatch = {};
        if (roChanged) relPatch.release_order = nRO || null;
        if (orderedChanged) relPatch.qty = nOrdered;
        if (plChanged) relPatch.length_mm = (nPartLen === "" ? null : Number(nPartLen));
        if (Object.keys(relPatch).length) await updateRow("releases", g.release_id, relPatch);
        if (plChanged) await updateRows("part_units", { release_id: g.release_id }, { length_mm: (nPartLen === "" ? null : Number(nPartLen)) });
        auditRecord("clear_scans", "scan_data", g.release_id, { scope: "scan_edit_all", machine: mkey });
      }
      setEditRow(null);
      setReloadTick((t) => t + 1);
      mlsToast(isDelete ? "ลบสแกนแล้ว" : "บันทึกการแก้ไขแล้ว", "ok");
    } catch (e) {
      mlsToast("ไม่สำเร็จ: " + (e?.message || e), "err");
    } finally { setBusy(false); }
  }

  // ── ดาวน์โหลดตารางสแกนของเครื่องนี้เป็น Excel (.xlsx) — คอลัมน์/ลำดับตรงกับที่เห็นบนจอ ──
  async function doExportExcel() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows = sorted.map((g) => {
        const row = {};
        row[lang === "en" ? "Date · time" : "วัน · เวลา"] = fmtDT(g.time);
        row[lang === "en" ? "Part No." : "เบอร์พาร์ท"] = g.part_no;
        row["Release"] = g.release_order;
        row[lang === "en" ? "Ordered" : "สั่ง"] = orderQty[g.release_id] != null ? orderQty[g.release_id] : "";
        row[lang === "en" ? "Step" : "ขั้นตอน"] = (g.ops || []).map((o) => opLabel(o, lang)).join(" · ");
        row[lang === "en" ? "Status" : "สถานะ"] = String(g.status).toLowerCase() === "finished" ? (lang === "en" ? "finished" : "เสร็จ") : (lang === "en" ? "in process" : "กำลังทำ");
        row[lang === "en" ? "Qty" : "จำนวน"] = Number(g.qty) || 0;
        { const v = partLenOf(g.release_id); row[lang === "en" ? "Part length (mm)" : "ความยาวพาร์ท (มม.)"] = v != null ? Number(v) : ""; }
        row[lang === "en" ? "Weight (kg)" : "น้ำหนัก (กก.)"] = g.weight ? (Number(g.weight) || 0).toFixed(2) : "";   // น้ำหนัก 2 ตำแหน่งเสมอ
        row["INV Code"] = relInfo[g.release_id]?.material || "";
        { const ml = matLenMap[g.release_id] || []; row[lang === "en" ? "Mat. Length (mm)" : "Mat. Length (มม.)"] = g.material_length_mm != null ? Number(g.material_length_mm) : (ml.length === 1 ? Number(ml[0]) : ""); }
        row[lang === "en" ? "Run time" : "เวลาเดินเครื่อง"] = g.secs ? fmtHrs(g.secs) : "";
        row[lang === "en" ? "Work report" : "รายงานการทำงาน"] = g.slow_reason ? (g.slow_reason + (g.slow_note ? " — " + g.slow_note : "")) : "";
        return row;
      });
      const tag = String(machine.code || machine.name || "machine").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 40);
      const { downloadSheets } = await import("./excelExport.js");
      await downloadSheets(`scans-${tag}-${todayStr()}.xlsx`, [{ name: lang === "en" ? "Scans" : "รายการสแกน", rows }]);
    } catch (e) {
      console.warn("export scans excel error", e);
      mlsToast(lang === "en" ? "Export failed, please try again" : "สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <Btn variant="ghost" size="sm" onClick={onBack}><Icon name="arrowLeft" size={14} /> {lang === "en" ? "Back to machines" : "กลับหน้าสรุปเครื่องจักร"}</Btn>
          </div>
          <div className="page-title" style={{ fontFamily: "var(--font-mono)", letterSpacing: ".02em" }}>{machine.code || "—"}</div>
          <div className="page-sub">{machine.name}{machine.name ? " · " : ""}{lang === "en" ? "all scans of this machine · pick the dates you want" : "การสแกนทั้งหมดของเครื่องนี้ · เลือกช่วงวันที่ที่ต้องการดูได้"}</div>
        </div>
      </div>

      <Card title={lang === "en" ? "Period to view" : "ช่วงเวลาที่ต้องการดู"}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 9 }}>{lang === "en" ? "Period" : "ช่วงเวลา"}</div>
        <div className="chip-row" style={{ marginBottom: 12 }}>
          {RANGE_MODES.filter((m) => m.value !== "month").map((m) => (   // เอา "รายเดือน" ออกจากหน้ารายการสแกนของเครื่อง
            <span key={m.value} className={`chip ${rangeMode === m.value ? "active" : ""}`} onClick={() => setRangeMode(m.value)}>{m.label}</span>
          ))}
        </div>
        <div>
          {rangeMode === "preset" && <PresetPicker value={preset} onChange={setPreset} />}
          {rangeMode === "month" && (
            <Input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} style={{ maxWidth: 220 }} />
          )}
          {rangeMode === "custom" && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ maxWidth: 180 }} />
              <span style={{ color: "var(--muted)" }}>–</span>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ maxWidth: 180 }} />
            </div>
          )}
        </div>
      </Card>

      <Card title={lang === "en" ? `Scans — ${machine.code || machine.name}` : `รายการสแกน — ${machine.code || machine.name}`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn variant="ghost" size="sm" onClick={() => colApi.current && colApi.current.resetAll()}
              title={lang === "en" ? "Reset column order + show all columns" : "คืนค่าเริ่มต้น: ลำดับคอลัมน์ + แสดงคอลัมน์ที่ซ่อนไว้ทั้งหมด"}>
              ↺ {lang === "en" ? "Columns" : "คอลัมน์"}
            </Btn>
            <Btn variant="accent" size="sm" onClick={doExportExcel} disabled={exporting || sorted.length === 0}
              title={lang === "en" ? "Download this table as Excel (.xlsx)" : "ดาวน์โหลดตารางนี้เป็นไฟล์ Excel (.xlsx)"}>
              <Icon name="grid" size={14} /> {exporting ? (lang === "en" ? "Exporting…" : "กำลังสร้าง…") : "Export Excel"}
            </Btn>
          </div>
        }>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={statCell}><div style={statLbl}>{lang === "en" ? "Scans" : "จำนวนสแกน"}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(grouped.length)} {lang === "en" ? "rows" : "แถว"}</div></div>
          <div style={statCell}><div style={statLbl}>{lang === "en" ? "Total pcs" : "รวมจำนวน"}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(totPcs)} {lang === "en" ? "pcs" : "ชิ้น"}</div></div>
          <div style={statCell}><div style={statLbl}>{lang === "en" ? "Total weight" : "น้ำหนักรวม"}</div><div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-dk)" }}>{fmtNum(totWt)} {lang === "en" ? "kg" : "กก."}</div></div>
          <div style={statCell}><div style={statLbl}>{lang === "en" ? "Run time" : "เวลาเดินเครื่อง"}</div><div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{totSec ? fmtHrs(totSec) : "—"}</div></div>
        </div>

        <SortControl sort={sort} options={[
          { k: "time", label: lang === "en" ? "Date-time" : "วัน-เวลา" },
          { k: "part", label: "Part No." },
          { k: "op", label: lang === "en" ? "Step" : "ขั้นตอน" },
          { k: "status", label: lang === "en" ? "Status" : "สถานะ" },
          { k: "qty", label: lang === "en" ? "Qty" : "จำนวน" },
          { k: "weight", label: lang === "en" ? "Weight" : "น้ำหนัก" },
          { k: "secs", label: lang === "en" ? "Run time" : "เวลาเดินเครื่อง" },
        ]} />

        {admin && <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>{lang === "en" ? "Admin: click a row to edit (quantity / weight / status / INV / lengths) or delete the whole scan" : "แอดมิน: กดที่แถวเพื่อแก้ไข (จำนวน / น้ำหนัก / สถานะ / INV / ความยาว) หรือ ลบทั้งแถว"}</div>}

        <DataTable id="machine-scans" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards" orderApiRef={colApi}
          rows={sorted} rowKey={(g) => g.key} sort={sort}
          empty={logs === null ? (lang === "en" ? "Loading…" : "กำลังโหลด...") : (lang === "en" ? "No scans in this period" : "ยังไม่มีการสแกนในช่วงเวลานี้")}
          rowProps={admin ? (g) => ({ className: "release-row", style: { cursor: "pointer" }, onClick: () => openEdit(g), title: lang === "en" ? "Click the row to edit / delete" : "กดที่แถวเพื่อแก้ไข / ลบ" }) : undefined}
          columns={[
            { key: "time", header: lang === "en" ? "Date · time" : "วัน · เวลา", sortKey: "time", tdStyle: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, cell: (g) => fmtDT(g.time) },
            { key: "part", header: lang === "en" ? "Part No." : "เบอร์พาร์ท", sortKey: "part", tdStyle: { fontWeight: 600, whiteSpace: "nowrap" }, cell: (g) => g.part_no },
            { key: "ro", header: "Release", sortKey: "ro", dataLabel: "Release", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => g.release_order },
            { key: "ordered", header: lang === "en" ? "Ordered" : "สั่ง", align: "right", tdStyle: { whiteSpace: "nowrap" },
              cell: (g) => orderQty[g.release_id] != null
                ? <>{fmtNum(orderQty[g.release_id])}{scannedByRel[g.release_id] > orderQty[g.release_id] && <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 800, color: "#d97a00", background: "rgba(217,122,0,.12)", border: "1px solid rgba(217,122,0,.4)", borderRadius: 99, padding: "1px 6px" }}>{lang === "en" ? `spare ${fmtNum(scannedByRel[g.release_id] - orderQty[g.release_id])}` : `สแปร์ ${fmtNum(scannedByRel[g.release_id] - orderQty[g.release_id])}`}</span>}</>
                : "—" },
            { key: "op", header: lang === "en" ? "Step" : "ขั้นตอน", sortKey: "op", tdStyle: { whiteSpace: "nowrap" },
              cell: (g) => g.ops.length ? (
                <span style={{ display: "inline-flex", flexWrap: "nowrap", gap: 5 }}>
                  {g.ops.map((o, oi) => (
                    <span key={oi} style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
                      color: "#2563eb", background: "rgba(37,99,235,.10)", border: "1px solid rgba(37,99,235,.40)" }}>{opLabel(o, lang)}</span>
                  ))}
                </span>
              ) : "—" },
            { key: "status", header: lang === "en" ? "Status" : "สถานะ", sortKey: "status", tdStyle: { whiteSpace: "nowrap" },
              cell: (g) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {pill(g.status)}
                  {g.slow_reason && <span title={g.slow_reason + (g.slow_note ? " — " + g.slow_note : "")} style={{ fontSize: 14, cursor: "help" }}>⚠️</span>}
                </span>
              ) },
            { key: "qty", header: lang === "en" ? "Qty" : "จำนวน", sortKey: "qty", align: "right", tdStyle: { fontWeight: 600 }, cell: (g) => `${fmtNum(g.qty)} ${lang === "en" ? "pcs" : "ชิ้น"}` },
            { key: "weight", header: lang === "en" ? "Weight (kg)" : "น้ำหนัก (กก.)", sortKey: "weight", align: "right", tdStyle: { color: "var(--accent-dk)" }, cell: (g) => g.weight ? fmtNum(g.weight) : "—" },
            { key: "secs", header: lang === "en" ? "Run time" : "เวลาเดินเครื่อง", sortKey: "secs", align: "right", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (g) => g.secs ? fmtHrs(g.secs) : "—" },
            { key: "inv", header: "INV Code", dataLabel: "INV Code", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => relInfo[g.release_id]?.material || "-" },
            { key: "partlen", header: lang === "en" ? "Part length (mm)" : "ความยาวพาร์ท (มม.)", align: "right", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => { const v = partLenOf(g.release_id); return v != null ? fmtNum(v) : "-"; } },
            { key: "matlen", header: lang === "en" ? "Mat. Length (mm)" : "Mat. Length (มม.)", align: "right", tdStyle: { whiteSpace: "nowrap" },
              cell: (g) => { if (g.material_length_mm != null) return fmtNum(g.material_length_mm); const a = matLenMap[g.release_id] || []; return a.length === 1 ? fmtNum(a[0]) : "—"; } },   // ค่าเฉพาะสแกน · ถ้าไม่รู้และล็อตมีหลายค่า = — (เลิกโชว์ปนกัน)
            // หมายเหตุ: รายงานการทำงาน (slow_reason) ย้ายไปรวมกับคอลัมน์ "สถานะ" เป็นไอคอน ⚠️ แล้ว — เลิกทำคอลัมน์แยก (กันตารางตกขอบ)
          ]} />
      </Card>

      {admin && editRow && (() => {
        const cur = Number(editRow.qty) || 0;
        const nq = Math.max(0, Math.floor(Number(newQty) || 0));
        const diff = nq - cur;
        const mls0 = matLenMap[editRow.release_id] || [];
        const inSel = { width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 };
        return (
        <Modal wide title={lang === "en" ? "Edit scan (all fields)" : "แก้ไขสแกน (ทั้งแถว)"} sub={`${editRow.part_no} · ${fmtDT(editRow.time)}`} onClose={() => { if (!busy) setEditRow(null); }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, fontWeight: 700 }}>
            {lang === "en" ? "This scan (row)" : "เฉพาะสแกนนี้ (แถวนี้)"}
          </div>
          <div className="grid-3">
            <Field label={lang === "en" ? "Date · time" : "วัน · เวลา"}>
              <Input type="datetime-local" value={edForm.dt} onChange={(e) => setEdForm((f) => ({ ...f, dt: e.target.value }))} disabled={nq === 0} />
            </Field>
            <Field label={lang === "en" ? "Quantity (0 = delete row)" : "จำนวน (0 = ลบทั้งแถว)"}>
              <Input type="number" min={0} value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </Field>
            <Field label={lang === "en" ? "Weight (kg) — blank = auto" : "น้ำหนัก (กก.) — เว้นว่าง = auto"}>
              <Input type="number" step="0.01" min="0" value={edForm.weight} onChange={(e) => setEdForm((f) => ({ ...f, weight: e.target.value }))} disabled={nq === 0}
                placeholder={editRow.weight ? `${lang === "en" ? "now" : "ปัจจุบัน"} ${fmtNum(editRow.weight)}` : (lang === "en" ? "auto from qty" : "คิดจากจำนวน")} />
            </Field>
            <Field label={lang === "en" ? "Run time (min)" : "เวลาเดินเครื่อง (นาที)"}>
              <Input type="number" min={0} value={edForm.runMin} onChange={(e) => setEdForm((f) => ({ ...f, runMin: e.target.value }))} disabled={nq === 0} />
            </Field>
            <Field label={lang === "en" ? "Mat. Length (mm)" : "Mat. Length (มม.)"}>
              <Input type="number" step="0.1" min="0" value={edForm.matLen} onChange={(e) => setEdForm((f) => ({ ...f, matLen: e.target.value }))} disabled={nq === 0}
                placeholder={mls0.length > 1 ? `${lang === "en" ? "release has" : "ในล็อตมี"}: ${mls0.map(fmtNum).join(" · ")}` : ""} />
            </Field>
            <Field label={lang === "en" ? "Status" : "สถานะ"}>
              <select value={edForm.status} onChange={(e) => setEdForm((f) => ({ ...f, status: e.target.value }))} disabled={nq === 0} style={inSel}>
                <option value="inprocess">{lang === "en" ? "In process" : "กำลังทำ"}</option>
                <option value="finished">{lang === "en" ? "Finished" : "เสร็จ"}</option>
              </select>
            </Field>
          </div>
          <Field label={lang === "en" ? "Step (tap to toggle · first = main)" : "ขั้นตอน (แตะเลือก/เอาออก · ตัวแรก = หลัก)"}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {allOps.length === 0 ? <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span> : allOps.map((o) => {
                const on = edForm.opIds.includes(o.id);
                return (
                  <span key={o.id} onClick={nq === 0 ? undefined : () => setEdForm((f) => ({ ...f, opIds: on ? f.opIds.filter((x) => x !== o.id) : [...f.opIds, o.id] }))}
                    style={{ cursor: nq === 0 ? "default" : "pointer", opacity: nq === 0 ? 0.5 : 1, fontSize: 12, fontWeight: 700, padding: "3px 11px", borderRadius: 99, whiteSpace: "nowrap",
                      color: on ? "#fff" : "var(--accent-dk)", background: on ? "var(--accent)" : "rgba(37,99,235,.08)", border: `1px solid ${on ? "var(--accent)" : "rgba(37,99,235,.35)"}` }}>
                    {opLabel(o.name, lang)}
                  </span>
                );
              })}
            </div>
          </Field>
          {/* รายงานการทำงาน (เหตุผลรอบช้า) — ผูกกับสแกนนี้ */}
          <div className="grid-2">
            <Field label={lang === "en" ? "Work report (slow reason)" : "รายงานการทำงาน (เหตุผลรอบช้า)"}>
              <select value={edForm.slowReason} onChange={(e) => setEdForm((f) => ({ ...f, slowReason: e.target.value }))} disabled={nq === 0}
                style={edForm.slowReason ? { ...inSel, color: "#c2410c", fontWeight: 700, background: "#fff4e5", border: "1px solid #f5a623" } : inSel}>
                <option value="" style={{ color: "var(--text)", fontWeight: 400 }}>{lang === "en" ? "— none —" : "— ไม่มี —"}</option>
                {(edForm.slowReason && !SCAN_SLOW_REASONS.includes(edForm.slowReason) ? [edForm.slowReason, ...SCAN_SLOW_REASONS] : SCAN_SLOW_REASONS).map((r) => <option key={r} value={r} style={{ color: "#b45309", fontWeight: 600 }}>{r}</option>)}
              </select>
            </Field>
            <Field label={lang === "en" ? "Work report — note" : "รายงานการทำงาน — หมายเหตุ"}>
              <Input value={edForm.slowNote} onChange={(e) => setEdForm((f) => ({ ...f, slowNote: e.target.value }))} disabled={nq === 0} placeholder={lang === "en" ? "detail (optional)" : "รายละเอียด (ถ้ามี)"} />
            </Field>
          </div>
          <div style={{ fontSize: 12, margin: "2px 0 12px", lineHeight: 1.6, color: nq === 0 ? "var(--danger-hi)" : diff !== 0 ? "var(--accent-dk)" : "var(--muted)" }}>
            {nq === 0 ? (lang === "en" ? "= delete the whole scan · piece back to “Not started” (QR/lot kept)" : "= ลบทั้งแถว · ชิ้นกลับเป็น “ยังไม่ทำ” (QR/ล็อตยังอยู่)")
              : diff > 0 ? (lang === "en" ? `Qty +${fmtNum(diff)} → ${fmtNum(nq)} pcs` : `จำนวน +${fmtNum(diff)} → ${fmtNum(nq)} ชิ้น`)
              : diff < 0 ? (lang === "en" ? `Qty −${fmtNum(-diff)} → ${fmtNum(nq)} pcs` : `จำนวน −${fmtNum(-diff)} → ${fmtNum(nq)} ชิ้น`)
              : (lang === "en" ? "Leave weight blank to auto-compute from quantity" : "เว้นน้ำหนักว่างไว้ = คิดจากจำนวนอัตโนมัติ")}
          </div>

          {/* ระดับล็อต/พาร์ท — Part No. · Release · จำนวนสั่ง · INV · ความยาว · Mat. Length */}
          <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0 10px" }} />
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, fontWeight: 700 }}>
            {lang === "en" ? "Whole Release / part (every scan)" : "ระดับ Release / พาร์ท (มีผลทุกสแกน)"}
          </div>
          <div className="grid-3">
            <Field label="Part No.">
              <Input value={edForm.partNo} onChange={(e) => setEdForm((f) => ({ ...f, partNo: e.target.value }))} disabled={nq === 0} />
            </Field>
            <Field label="Release">
              <Input value={edForm.releaseOrder} onChange={(e) => setEdForm((f) => ({ ...f, releaseOrder: e.target.value }))} disabled={nq === 0} placeholder={lang === "en" ? "e.g. P-184" : "เช่น P-184"} />
            </Field>
            <Field label={lang === "en" ? "Ordered (pcs)" : "จำนวนสั่ง (ชิ้น)"}>
              <Input type="number" min={0} value={edForm.ordered} onChange={(e) => setEdForm((f) => ({ ...f, ordered: e.target.value }))} disabled={nq === 0} />
            </Field>
            <Field label="INV Code">
              <Input value={edForm.mat} onChange={(e) => setEdForm((f) => ({ ...f, mat: e.target.value }))} disabled={nq === 0} placeholder={lang === "en" ? "e.g. 23AN01600C" : "เช่น 23AN01600C"} />
            </Field>
            <Field label={lang === "en" ? "Part length (mm)" : "ความยาวพาร์ท (มม.)"}>
              <Input type="number" step="0.1" min="0" value={edForm.partLen} onChange={(e) => setEdForm((f) => ({ ...f, partLen: e.target.value }))} disabled={nq === 0} />
            </Field>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-2px 0 14px", lineHeight: 1.6 }}>
            ⚠️ {lang === "en" ? "These 5 fields change the whole Release/part (every scan), not just this row" : "5 ช่องนี้มีผลกับทั้ง Release/พาร์ท (ทุกสแกน) ไม่ใช่แค่แถวนี้"}
          </div>

          <div className="modal-actions">
            <Btn variant="ghost" onClick={() => setEditRow(null)} disabled={busy}>{lang === "en" ? "Cancel" : "ยกเลิก"}</Btn>
            <Btn onClick={doApply} disabled={busy}
              style={nq === 0 ? { background: "var(--danger-hi)", color: "#fff", border: "none" } : { background: "var(--accent)", color: "#fff", border: "none" }}>
              {busy ? (lang === "en" ? "Saving…" : "กำลังบันทึก...")
                : nq === 0 ? (lang === "en" ? "Delete whole row" : "ลบทั้งแถว")
                : (lang === "en" ? "Save" : "บันทึก")}
            </Btn>
          </div>
        </Modal>
        );
      })()}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// รายงานปัญหาเครื่อง (แอดมิน) — สรุปเวลาหยุด + ปัญหาระหว่างทำงาน · ดู migration-machine-reports.sql
// ══════════════════════════════════════════════════════════════════════════
function MReasonBars({ obj, total, empty }) {
  const arr = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const fmtMin = (m) => { m = Math.round(Number(m) || 0); if (m < 60) return m + " น."; const h = Math.floor(m / 60), mm = m % 60; return h + " ชม." + (mm ? " " + mm + " น." : ""); };
  if (!arr.length) return <div style={{ color: "var(--muted-2)", fontSize: 13, textAlign: "center", padding: 18 }}>{empty}</div>;
  const max = arr[0][1] || 1;
  return (
    <div>
      {arr.map(([k, v]) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(84px,148px) 1fr auto", alignItems: "center", gap: 12, padding: "6px 0" }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</div>
          <div style={{ height: 16, background: "var(--surface-3)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: (v / max * 100) + "%", background: "var(--danger)", borderRadius: "0 8px 8px 0", minWidth: 3 }} />
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", minWidth: 62, textAlign: "right" }}>
            {fmtMin(v)}{total ? <span style={{ color: "var(--muted-2)", fontSize: 11 }}> {Math.round(v / total * 100)}%</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function MachineReportsPage() {
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);
  const [data, setData] = useState({ downtime: [], slow: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [range, setRange] = useState("week");   // today | week | month
  const [mFilter, setMFilter] = useState("");
  const [tFilter, setTFilter] = useState("");    // "" | stop | slow

  useEffect(() => {
    let ok = true;
    setLoading(true); setErr("");
    const since = new Date(Date.now() - 31 * 864e5).toISOString();   // ดึงกว้าง 31 วัน แล้วค่อยกรองในจอ
    machineReportSummary(since).then((r) => {
      if (!ok) return;
      setData({ downtime: r.downtime || [], slow: r.slow || [] });
      setLoading(false);
    }).catch((e) => { if (ok) { setErr(e?.message || "โหลดไม่สำเร็จ"); setLoading(false); } });
    return () => { ok = false; };
  }, []);

  const fmtMin = (m) => { m = Math.round(Number(m) || 0); if (m < 60) return m + " " + t("น.", "min"); const h = Math.floor(m / 60), mm = m % 60; return h + " " + t("ชม.", "h") + (mm ? " " + mm + " " + t("น.", "m") : ""); };
  const sinceMs = range === "today" ? new Date().setHours(0, 0, 0, 0) : (range === "week" ? Date.now() - 7 * 864e5 : Date.now() - 31 * 864e5);
  const down = (data.downtime || []).filter((d) => new Date(d.started_at).getTime() >= sinceMs && (!mFilter || d.machine === mFilter));
  const slow = (data.slow || []).filter((s) => new Date(s.recorded_at).getTime() >= sinceMs && (!mFilter || s.machine === mFilter));

  const totalMin = down.reduce((a, d) => a + (Number(d.minutes) || 0), 0);
  const byReason = {}; down.forEach((d) => { byReason[d.reason || "-"] = (byReason[d.reason || "-"] || 0) + (Number(d.minutes) || 0); });
  const byMachine = {}; down.forEach((d) => { const k = d.machine || "-"; byMachine[k] = (byMachine[k] || 0) + (Number(d.minutes) || 0); });
  const worst = Object.entries(byMachine).sort((a, b) => b[1] - a[1])[0];
  const machines = [...new Set([...(data.downtime || []).map((d) => d.machine), ...(data.slow || []).map((s) => s.machine)].filter(Boolean))].sort();

  let rows = [
    ...down.map((d) => ({ kind: "stop", at: d.started_at, machine: d.machine, employee: d.employee, reason: d.reason, note: d.note, minutes: d.minutes, open: d.open, lot: "" })),
    ...slow.map((s) => ({ kind: "slow", at: s.recorded_at, machine: s.machine, employee: s.employee, reason: s.reason, note: s.note, minutes: null, lot: [s.part_no, s.release_order].filter(Boolean).join(" · ") })),
  ];
  if (tFilter) rows = rows.filter((r) => r.kind === tFilter);
  rows.sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">{t("รายงานปัญหาเครื่อง", "Machine Reports")}</div>
          <div className="page-sub">{t("สรุปเวลาเครื่องหยุด & ปัญหาระหว่างทำงาน — ทุกเครื่องในไลน์", "Downtime & in-process issues — all machines")}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <div className="chip-row">
          {[["today", t("วันนี้", "Today")], ["week", t("สัปดาห์นี้", "Week")], ["month", t("เดือนนี้", "Month")]].map(([k, lbl]) => (
            <button key={k} className={`chip${range === k ? " active" : ""}`} onClick={() => setRange(k)}>{lbl}</button>
          ))}
        </div>
        <select className="select" value={mFilter} onChange={(e) => setMFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">{t("ทุกเครื่อง", "All machines")}</option>
          {machines.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="select" value={tFilter} onChange={(e) => setTFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">{t("ทุกประเภท", "All types")}</option>
          <option value="stop">{t("เครื่องหยุด", "Machine stop")}</option>
          <option value="slow">{t("ระหว่างทำงาน", "In-process")}</option>
        </select>
      </div>

      {err && <Card><div style={{ color: "var(--danger)", padding: 6 }}>{err}</div></Card>}
      {loading ? (
        <Card><div style={{ color: "var(--muted)", padding: 22, textAlign: "center" }}>{t("กำลังโหลด…", "Loading…")}</div></Card>
      ) : (
        <>
          <div className="stat-row">
            <StatCard label={t("เวลาหยุดรวม", "Total downtime")} value={fmtMin(totalMin)} icon="warn" />
            <StatCard label={t("จำนวนครั้งที่หยุด", "Stops")} value={fmtNum(down.length)} icon="clock" />
            <StatCard label={t("ปัญหาระหว่างทำงาน", "In-process issues")} value={fmtNum(slow.length)} icon="bolt" />
            <StatCard label={t("เครื่องหยุดนานสุด", "Top machine")} value={worst ? worst[0] : "—"} icon="machine" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
            <Card title={t("เวลาหยุด แยกตามสาเหตุ", "Downtime by reason")}><MReasonBars obj={byReason} total={totalMin} empty={t("ไม่มีการหยุดในช่วงนี้", "No downtime in range")} /></Card>
            <Card title={t("เวลาหยุด แยกตามเครื่อง", "By machine")}><MReasonBars obj={byMachine} total={totalMin} empty={t("ไม่มีการหยุดในช่วงนี้", "No downtime in range")} /></Card>
          </div>

          <Card title={`${t("รายการทั้งหมด", "All reports")} (${rows.length})`}>
            <DataTable id="machine-reports" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
              rows={rows} rowKey={(r, i) => `${r.kind}-${i}`}
              empty={t("ไม่มีรายการในช่วงที่เลือก", "No reports in range")}
              columns={[
                { key: "at", header: t("วัน–เวลา", "Date–time"), tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap", color: "var(--muted)" }, cell: (r) => fmtDT(r.at) },
                { key: "machine", header: t("เครื่อง", "Machine"), tdStyle: { fontWeight: 600 }, cell: (r) => r.machine || "-" },
                { key: "emp", header: t("พนักงาน", "Operator"), cell: (r) => r.employee || "-" },
                { key: "type", header: t("ประเภท", "Type"), cell: (r) => r.kind === "stop" ? <Badge tone="danger">🛑 {t("เครื่องหยุด", "Stop")}</Badge> : <Badge tone="warning">⚠️ {t("ระหว่างทำงาน", "In-process")}</Badge> },
                { key: "reason", header: t("สาเหตุ / ปัญหา", "Reason"), cell: (r) => r.reason || "-" },
                { key: "dur", header: t("เวลาหยุด", "Downtime"), align: "right", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (r) => r.kind === "stop" ? (r.open ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>● {t("ยังหยุด", "open")}</span> : fmtMin(r.minutes)) : <span style={{ color: "var(--muted-2)" }}>—</span> },
                { key: "lot", header: t("ล็อต / พาร์ท", "Lot / part"), tdStyle: { fontFamily: "var(--font-mono)", fontSize: 12.5 }, cell: (r) => r.lot || "—" },
                { key: "note", header: t("หมายเหตุ", "Note"), tdStyle: { color: "var(--muted)", fontSize: 12.5, maxWidth: 260 }, cell: (r) => r.note || "—" },
              ]} />
          </Card>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// DAILY REPORT — สรุปภาพรวม → รายงานประจำวัน  (v2: ออกแบบตามหลัก dashboard มืออาชีพ)
//   หลักที่ใช้ (ดู claude/daily-report.md):
//   · Stephen Few — จอแรกตอบคำถามหลักได้ในแวบเดียว · ตัวเลขต้องมี "สิ่งเทียบ" (เป้า / วันทำงานก่อนหน้า / เฉลี่ย 7 วัน)
//     · 1 ช่อง = 1 ตัวชี้วัด 1 หน่วย · ความละเอียดพอดี (ไม่ใส่ทศนิยม/วินาทีเกินจำเป็น) · เรื่องสำคัญซ้ายบน
//   · ISA-101 (High-Performance HMI) — จอเงียบตอนปกติ · สี amber/red เฉพาะ "ผิดปกติ" + มีข้อความกำกับเสมอ
//     · ลำดับชั้น: ภาพรวม → รายเครื่อง → รายการละเอียด
//   · ISO 22400 / OEE — แยกเวลา: ตามแผน (กะ − พัก) = เดินเครื่อง + หยุด + ว่าง/อื่น ๆ · Utilization = เดินเครื่อง ÷ ตามแผน
//     · นิยามตัวเลขเขียนไว้ในหน้า (ทุกคนอ่านแบบเดียวกัน) · ยังไม่มีข้อมูลคุณภาพ (ของเสีย) → ไม่คิด OEE เต็ม
//   · NN/g — ใช้ความยาว/ตำแหน่ง (แท่ง) · ไม่ใช้พาย/เกจ · Pareto เรียงมาก→น้อย
//   ข้อมูล: report_logs · list_scan_slow · machine_report_summary (หยุด — admin/office/supervisor) · releases
//           · app_settings 'daily_report' (เวลากะ + เป้าต่อเครื่อง — migration-daily-report-settings.sql)
// ══════════════════════════════════════════════════════════════════════════
// วันที่ "ตามเวลาเครื่อง" (ไม่ใช่ UTC) — กันช่วงเช้ามืด (00:00–07:00 ไทย) กลายเป็นเมื่อวาน
const localDayStr = (d = new Date()) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const shiftDayStr = (ds, n) => { const d = new Date(`${ds}T12:00:00`); d.setDate(d.getDate() + n); return localDayStr(d); };
const fmtClock = (iso) => (iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-");
const drDeptOfOpType = (ty) => (ty === "assembly" ? "sub" : ty === "panel" ? "panel" : (ty === "packing" || ty === "pack_panel" || ty === "pack_site") ? "packing" : "machine");
const DR_KEY = "daily_report";
const DR_DEFAULT = { start: "08:00", end: "17:00", breakStart: "12:00", breakMin: 60, targets: {} };
const hmToMin = (s) => { const [h, m] = String(s || "0:0").split(":").map((x) => Number(x) || 0); return h * 60 + m; };
const minToHm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.round(n % 60)).padStart(2, "0")}`;
// เวลาทำงานตามแผน (นาที) ของวัน — กะ − พัก · วันนี้ = นับถึงตอนนี้ (planned-to-date)
function drPlannedMin(cfg, dayStr, nowMs = Date.now()) {
  const s = hmToMin(cfg.start), e = hmToMin(cfg.end);
  const bs = hmToMin(cfg.breakStart), be = bs + (Number(cfg.breakMin) || 0);
  let upTo = e;
  if (dayStr === localDayStr(new Date(nowMs))) { const d = new Date(nowMs); upTo = Math.min(e, d.getHours() * 60 + d.getMinutes()); }
  if (upTo <= s) return 0;
  const brk = Math.max(0, Math.min(upTo, be) - Math.max(s, bs));
  return Math.max(0, upTo - s - brk);
}
// เวลาหยุดของ "วันนั้น" (นาที): ตัดขอบวัน · หยุดค้าง = ถึงตอนนี้ · planned = เฉพาะช่วงกะ (ไม่นับช่วงพัก/นอกกะ)
function drStopMin(s, cfg, dayStr, nowMs = Date.now()) {
  const st = new Date(s.started_at).getTime();
  if (!Number.isFinite(st)) return { day: 0, planned: 0 };
  const en = s.ended_at ? new Date(s.ended_at).getTime() : s.open ? nowMs : st + (Number(s.minutes) || 0) * 60000;
  const base = new Date(`${dayStr}T00:00:00`).getTime();
  const a = Math.max(st, base), b = Math.min(en, base + 86400000);
  if (!(b > a)) return { day: 0, planned: 0 };
  const seg = (m0, m1) => Math.max(0, Math.min(b, base + m1 * 60000) - Math.max(a, base + m0 * 60000));
  const sh = hmToMin(cfg.start), eh = hmToMin(cfg.end), bs = hmToMin(cfg.breakStart), be = bs + (Number(cfg.breakMin) || 0);
  const inShift = seg(sh, eh) - (be > bs ? seg(Math.max(sh, bs), Math.min(eh, be)) : 0);
  return { day: (b - a) / 60000, planned: Math.max(0, inShift) / 60000 };
}
// ชั่วโมง/นาที อ่านง่าย (ไม่ใส่วินาทีบนการ์ด)
function fmtDur(min, lang) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (lang === "en") return h ? `${h}h ${r}m` : `${r}m`;
  return h ? `${h} ชม. ${r} น.` : `${r} น.`;
}
const fmtKpi = (v) => { const n = Number(v) || 0; return Math.abs(n) >= 100 ? Math.round(n).toLocaleString("th-TH") : (Math.round(n * 10) / 10).toLocaleString("th-TH"); };
async function drLoadSettings() {
  const { data, error } = await supabase.rpc("get_app_settings", { p_keys: [DR_KEY] });
  if (error) throw error;
  const v = (data && data[DR_KEY]) || {};
  return { ...DR_DEFAULT, ...v, targets: { ...(v.targets || {}) } };
}
async function drSaveSettings(v) {
  const { data, error } = await supabase.rpc("set_app_setting", { p_token: getSession()?.token || null, p_key: DR_KEY, p_value: v });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.reason || "failed");
}

// ── การ์ดตัวชี้วัด: ค่าใหญ่ + สิ่งเทียบ (bullet bar กับเป้า · ▲▼ เทียบวันก่อน/เฉลี่ย) ──
function DrKpi({ label, value, unit, sub, goal, deltas = [], alert, info }) {
  const pct = goal && goal.target > 0 ? goal.actual / goal.target : null;
  const pace = goal && goal.target > 0 && goal.pace != null ? goal.pace / goal.target : null;   // วันนี้: เป้า ณ ตอนนี้
  return (
    <div className="card dr-kpi" title={info || undefined}>
      <div className="dr-kpi-lbl">{label}</div>
      <div className="dr-kpi-val">{value}{unit ? <span className="dr-kpi-unit">{unit}</span> : null}</div>
      {goal && goal.target > 0 ? (
        <div className="dr-bullet" aria-label={goal.text}>
          <div className="dr-bullet-track">
            <div className={"dr-bullet-fill" + (goal.low ? " low" : "")} style={{ width: `${Math.min(100, (pct || 0) * 100)}%` }} />
            {pace != null && pace < 1 ? <div className="dr-bullet-pace" style={{ left: `${Math.min(100, pace * 100)}%` }} title={goal.paceText} /> : null}
          </div>
          <div className={"dr-bullet-txt" + (goal.low ? " low" : "")}>{goal.text}</div>
        </div>
      ) : null}
      {sub ? <div className="dr-kpi-sub">{sub}</div> : null}
      {deltas.filter(Boolean).map((d, i) => (
        <div key={i} className={"dr-delta " + (d.tone || "")}>{d.text}</div>
      ))}
      {alert ? <div className="dr-kpi-alert">{alert}</div> : null}
    </div>
  );
}

// ── กราฟแท่งรายชั่วโมง + เส้นเป้า/ชม. + แถบพัก · hover = tooltip ──
function DrHourlyChart({ data, targetPerHour, breakHours = [], lang, height = 230 }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  const [hov, setHov] = useState(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const upd = () => setW(el.clientWidth || 0);
    upd();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", upd); return () => window.removeEventListener("resize", upd); }
    const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect();
  }, []);
  const L = (th, en) => (lang === "en" ? en : th);
  const padL = 34, padR = 12, padT = 16, padB = 26;
  const iw = Math.max(0, w - padL - padR), ih = height - padT - padB;
  const maxV = Math.max(1, ...data.map((d) => d.pcs), targetPerHour || 0);
  const mag = Math.pow(10, Math.floor(Math.log10(maxV)));
  const stepN = [1, 2, 5, 10].map((k) => k * mag).find((s) => maxV / s <= 5) || mag * 10;
  const top = Math.ceil(maxV / stepN) * stepN;
  const ticks = []; for (let v = 0; v <= top + 1e-9; v += stepN) ticks.push(v);
  const bw = data.length ? iw / data.length : 0;
  const barW = Math.max(4, Math.min(38, bw * 0.62));
  const y = (v) => padT + ih - (v / top) * ih;
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={L("ชิ้นงานรายชั่วโมง", "Pieces per hour")}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--border-soft, #e6ece9)" strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted, #6d7d76)">{t}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = padL + i * bw;
            const isBreak = breakHours.includes(d.h);
            const bh = Math.max(0, ih - (y(d.pcs) - padT));
            const bx = x0 + (bw - barW) / 2;
            const r = Math.min(4, barW / 2, bh);
            return (
              <g key={d.h}>
                {isBreak && <rect x={x0 + 1} y={padT} width={Math.max(0, bw - 2)} height={ih} fill="var(--surface-2, #f1f5f3)" />}
                {isBreak && <text x={x0 + bw / 2} y={padT + 12} textAnchor="middle" fontSize="10.5" fill="var(--muted, #6d7d76)">{L("พัก", "break")}</text>}
                {d.pcs > 0 && (
                  <path d={`M${bx},${y(0)} V${y(d.pcs) + r} Q${bx},${y(d.pcs)} ${bx + r},${y(d.pcs)} H${bx + barW - r} Q${bx + barW},${y(d.pcs)} ${bx + barW},${y(d.pcs) + r} V${y(0)} Z`}
                    fill={hov === i ? "var(--dr-data-dk, #3d6a5b)" : "var(--dr-data, #5f8a7b)"} />
                )}
                <text x={x0 + bw / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted, #6d7d76)">{String(d.h).padStart(2, "0")}</text>
                <rect x={x0} y={padT} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} />
              </g>
            );
          })}
          <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} stroke="var(--border, #d7e3dd)" strokeWidth="1" />
          {targetPerHour > 0 && (
            <g>
              <line x1={padL} x2={w - padR} y1={y(targetPerHour)} y2={y(targetPerHour)} stroke="var(--text, #142420)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.55" />
              <text x={w - padR} y={y(targetPerHour) - 5} textAnchor="end" fontSize="11" fill="var(--text, #142420)" opacity="0.75">{L(`เป้า ${fmtKpi(targetPerHour)}/ชม.`, `target ${fmtKpi(targetPerHour)}/h`)}</text>
            </g>
          )}
        </svg>
      )}
      {hov != null && data[hov] && (
        <div className="dr-tip" style={{ left: Math.min(Math.max(0, padL + hov * bw + bw / 2 - 80), Math.max(0, w - 170)), top: 0 }}>
          <b>{String(data[hov].h).padStart(2, "0")}:00–{String(data[hov].h + 1).padStart(2, "0")}:00</b><br />
          {L("ชิ้นงาน", "Pieces")} {fmtNum(data[hov].pcs)} · {L("น้ำหนัก", "weight")} {fmtKpi(data[hov].kg)} {L("กก.", "kg")}<br />
          {L("สแกน", "Scans")} {fmtNum(data[hov].scans)}{targetPerHour > 0 ? <> · {L("เป้า", "target")} {fmtKpi(targetPerHour)}</> : null}
        </div>
      )}
    </div>
  );
}

// ── Pareto แนวนอน (มาก → น้อย) ──
function DrPareto({ rows, unit, empty, tone }) {
  if (!rows.length) return <div style={{ color: "var(--muted)", fontSize: 13, padding: "6px 2px" }}>{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="dr-pareto">
      {rows.map((r) => (
        <div key={r.k} className="dr-pareto-row" title={`${r.k}: ${fmtNum(r.v)} ${unit}${r.n != null ? ` · ${r.n}×` : ""}`}>
          <div className="dr-pareto-k">{r.k}</div>
          <div className="dr-pareto-bar"><div className={"fill " + (tone || "")} style={{ width: `${(r.v / max) * 100}%` }} /></div>
          <div className="dr-pareto-v">{fmtNum(r.v)} {unit}{r.n != null ? <span style={{ color: "var(--muted)" }}> · {r.n}×</span> : null}</div>
        </div>
      ))}
    </div>
  );
}

// ── ตั้งค่า (แอดมิน): เวลากะกลาง + เป้าต่อเครื่องต่อวัน ──
function DrSettingsModal({ cfg, machines, onClose, onSaved, lang }) {
  const L = (th, en) => (lang === "en" ? en : th);
  const [f, setF] = useState(() => ({ ...cfg, targets: { ...(cfg.targets || {}) } }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const planned = (() => { const s = hmToMin(f.start), e = hmToMin(f.end); const bs = hmToMin(f.breakStart), be = bs + (Number(f.breakMin) || 0); return Math.max(0, e - s - Math.max(0, Math.min(e, be) - Math.max(s, bs))); })();
  const setT = (code, k, v) => setF((x) => ({ ...x, targets: { ...x.targets, [code]: { ...(x.targets[code] || {}), [k]: v === "" ? "" : Math.max(0, Number(v) || 0) } } }));
  async function save() {
    if (hmToMin(f.end) <= hmToMin(f.start)) { setErr(L("เวลาเลิกต้องหลังเวลาเริ่ม", "End must be after start")); return; }
    setBusy(true); setErr("");
    const targets = {};
    Object.entries(f.targets || {}).forEach(([k, t]) => {
      const pcs = Number(t?.pcs) || 0, kg = Number(t?.kg) || 0;
      if (pcs > 0 || kg > 0) targets[k] = { pcs, kg };
    });
    const v = { start: f.start, end: f.end, breakStart: f.breakStart, breakMin: Math.max(0, Number(f.breakMin) || 0), targets };
    try { await drSaveSettings(v); onSaved(v); }
    catch (e) { setErr(String(e?.message || e).includes("get_app_settings") || String(e?.message || e).includes("set_app_setting") ? L("ยังไม่ได้รัน migration-daily-report-settings.sql ใน Supabase", "Run migration-daily-report-settings.sql in Supabase first") : L("บันทึกไม่สำเร็จ: ", "Save failed: ") + (e?.message || e)); }
    finally { setBusy(false); }
  }
  const inp = { height: 36, borderRadius: 9, border: "1px solid var(--border)", padding: "0 8px", fontFamily: "inherit", fontSize: 14, background: "var(--surface)", color: "var(--text)" };
  return (
    <Modal title={L("ตั้งค่ารายงานประจำวัน", "Daily report settings")} sub={L("ใช้ร่วมกันทุกเครื่อง/ทุกคน", "Shared by everyone")} onClose={onClose} locked={busy} wide>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{L("เวลากะ (เวลาทำงานตามแผน)", "Shift (planned time)")}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
        <label style={{ fontSize: 12.5 }}>{L("เริ่ม", "Start")}<br /><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} style={inp} /></label>
        <label style={{ fontSize: 12.5 }}>{L("เลิก", "End")}<br /><input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} style={inp} /></label>
        <label style={{ fontSize: 12.5 }}>{L("พักเริ่ม", "Break at")}<br /><input type="time" value={f.breakStart} onChange={(e) => setF({ ...f, breakStart: e.target.value })} style={inp} /></label>
        <label style={{ fontSize: 12.5 }}>{L("พัก (นาที)", "Break (min)")}<br /><input type="number" min="0" value={f.breakMin} onChange={(e) => setF({ ...f, breakMin: e.target.value })} style={{ ...inp, width: 90 }} /></label>
        <div style={{ fontSize: 13, color: "var(--muted)", paddingBottom: 8 }}>= {fmtDur(planned, lang)} {L("ต่อเครื่องต่อวัน", "per machine per day")}</div>
      </div>
      <div style={{ fontWeight: 700, margin: "16px 0 8px" }}>{L("เป้าต่อเครื่องต่อวัน (เว้นว่าง = ไม่มีเป้า)", "Daily target per machine (blank = no target)")}</div>
      <div style={{ maxHeight: "42vh", overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table className="data-table" style={{ minWidth: 0 }}>
          <thead><tr><th>{L("เครื่อง", "Machine")}</th><th style={{ textAlign: "right" }}>{L("เป้า ชิ้น/วัน", "Target pcs/day")}</th><th style={{ textAlign: "right" }}>{L("เป้า กก./วัน", "Target kg/day")}</th></tr></thead>
          <tbody>
            {machines.map((m) => {
              const t = f.targets[m.code] || {};
              return (
                <tr key={m.code}>
                  <td><b style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{m.code}</b> <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{m.name && m.name !== m.code ? m.name : ""}</span></td>
                  <td style={{ textAlign: "right" }}><input type="number" min="0" value={t.pcs ?? ""} onChange={(e) => setT(m.code, "pcs", e.target.value)} style={{ ...inp, width: "min(110px, 22vw)", textAlign: "right" }} aria-label={`${m.code} ${L("เป้า ชิ้น/วัน", "target pcs/day")}`} /></td>
                  <td style={{ textAlign: "right" }}><input type="number" min="0" value={t.kg ?? ""} onChange={(e) => setT(m.code, "kg", e.target.value)} style={{ ...inp, width: "min(110px, 22vw)", textAlign: "right" }} aria-label={`${m.code} ${L("เป้า กก./วัน", "target kg/day")}`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{L("ยกเลิก", "Cancel")}</Btn>
        <Btn variant="accent" onClick={save} disabled={busy}>{busy ? L("กำลังบันทึก…", "Saving…") : L("บันทึก", "Save")}</Btn>
      </div>
    </Modal>
  );
}

function DailyReportPage() {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const sess = getSession();
  const manage = canManage(sess);
  const admin = isAdmin(sess);
  const today = localDayStr();
  const [day, setDay] = useState(today);
  const [machineF, setMachineF] = useState("");
  const [projF, setProjF] = useState("");
  const [deptF, setDeptF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [q, setQ] = useState("");
  const [logs, setLogs] = useState(null);          // null = กำลังโหลด
  const [hist, setHist] = useState(null);          // สแกน 7 วันก่อนหน้า (ไว้เทียบ)
  const [slowRows, setSlowRows] = useState([]);
  const [stopsAll, setStopsAll] = useState(null);  // เครื่องหยุด 8 วัน (null = ไม่มีสิทธิ์ดู/โหลดไม่ได้)
  const [relInfo, setRelInfo] = useState({});
  const [ops, setOps] = useState([]);
  const [machinesAll, setMachinesAll] = useState([]);
  const [cfg, setCfg] = useState(DR_DEFAULT);
  const [cfgState, setCfgState] = useState("loading");   // loading | ok | nosql
  const [showCfg, setShowCfg] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [exporting, setExporting] = useState(false);
  const sortM = useTableSort("pcs", "desc");
  const sortS = useTableSort("time", "desc");
  const colApiM = useRef(null);
  const colApiS = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { listRows("operations", { order: "seq" }).then((r) => setOps(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  useEffect(() => { listRows("machines", { order: "code" }).then((r) => setMachinesAll(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  useEffect(() => {
    drLoadSettings().then((v) => { setCfg(v); setCfgState("ok"); }).catch(() => { setCfg(DR_DEFAULT); setCfgState("nosql"); });
  }, []);
  // วันนี้: เดินนาฬิกาทุก 1 นาที (เวลาตามแผน ณ ตอนนี้ / เป้า ณ ตอนนี้)
  useEffect(() => { if (day !== today) return undefined; const t = setInterval(() => setNowMs(Date.now()), 60000); return () => clearInterval(t); }, [day, today]);
  useEffect(() => {
    let alive = true;
    const { from, to } = customRangeFor(day, day);
    const h = customRangeFor(shiftDayStr(day, -7), shiftDayStr(day, -1));
    setLogs(null); setHist(null);
    getScanLogsBetween(from, to).then((d) => { if (alive) setLogs(Array.isArray(d) ? d : []); }).catch(() => { if (alive) setLogs([]); });
    getScanLogsBetween(h.from, h.to).then((d) => { if (alive) setHist(Array.isArray(d) ? d : []); }).catch(() => { if (alive) setHist([]); });
    listScanSlow(from, to).then((d) => { if (alive) setSlowRows(Array.isArray(d) ? d : []); }).catch(() => { if (alive) setSlowRows([]); });
    if (manage) {
      machineReportSummary(h.from)
        .then((r) => { if (alive) setStopsAll(Array.isArray(r?.downtime) ? r.downtime : []); })
        .catch(() => { if (alive) setStopsAll(null); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, reloadTick]);
  useEffect(() => {
    const ids = [...new Set((logs || []).map((l) => l.release_id).filter(Boolean))];
    if (!ids.length) { setRelInfo({}); return; }
    let alive = true;
    (async () => {
      const out = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("releases").select("*, part_master(*, projects(code, name))").in("id", ids.slice(i, i + 150));
        (data || []).forEach((r) => { out[r.id] = r; });
      }
      if (alive) setRelInfo(out);
    })().catch(() => {});
    return () => { alive = false; };
  }, [logs]);

  const opType = useMemo(() => { const m = {}; ops.forEach((o) => { if (o && o.name) m[o.name] = o.op_type; }); return m; }, [ops]);
  const machineName = useMemo(() => { const m = {}; machinesAll.forEach((x) => { if (x.code) m[x.code] = x.name || ""; }); return m; }, [machinesAll]);

  // ── 1 สแกน = 1 แถว: ยุบแถว co-tick (จำนวน 0) เข้ากับแถวหลักของเครื่องเดียวกัน ──
  const groupLogs = (list) => {
    const asc = [...(list || [])].sort((a, b) => String(a.scanned_at || "").localeCompare(String(b.scanned_at || "")));
    const out = []; const cur = new Map(); let n = 0;
    const mk = (l, qty) => {
      const pm = l.part_unit?.part_master || {};
      const mkey = l.machine?.code || l.machine?.name || "—";
      const op = l.operation?.name || null;
      return {
        key: `${l.part_unit_id || "u"}-${l.scanned_at}-${mkey}-${n++}`,
        time: l.scanned_at, day: l.scanned_at ? localDayStr(new Date(l.scanned_at)) : "", mkey, machine_name: l.machine?.name || "",
        employee: l.employee?.name || "",
        project_id: pm.project_id || null, project_name: pm.projects?.name || "",
        release_id: l.release_id || null, release_order: l.release_order || "—",
        part_no: pm.part_no || "—", part_name: pm.part_name || "",
        ops: op ? [op] : [], dept: drDeptOfOpType(op ? opType[op] : null),
        status: l.status, office: l.status == null,
        qty, weight: logWeight(l), secs: Number(l.process_seconds) || 0,
        matlen: l.material_length_mm != null ? Number(l.material_length_mm) : null,
        part_unit_id: l.part_unit_id, unit_len: l.part_unit?.length_mm ?? null, def_len: pm.default_length_mm ?? null,
      };
    };
    for (const l of asc) {
      const mkey = l.machine?.code || l.machine?.name || "—";
      const qv = Number(l.quantity) || 0;
      const op = l.operation?.name || null;
      const c = cur.get(mkey);
      if (qv > 0) { const g = mk(l, qv); cur.set(mkey, g); out.push(g); }
      else if (c && c.part_unit_id === l.part_unit_id && String(c.status).toLowerCase() === String(l.status).toLowerCase()) {
        if (op && !c.ops.includes(op)) c.ops.push(op);
        c.weight += logWeight(l); c.secs += Number(l.process_seconds) || 0;
      } else { out.push(mk(l, 0)); }
    }
    return out;
  };
  const grouped = useMemo(() => {
    const out = groupLogs(logs);
    if (slowRows && slowRows.length) {   // รายงานการทำงาน → จับคู่ part_unit + เวลาใกล้สุด (±3 วิ)
      const used = new Set();
      for (const g of out) {
        let best = null, bestDt = 3000, bi = -1;
        for (let i = 0; i < slowRows.length; i++) {
          if (used.has(i)) continue;
          const s = slowRows[i];
          if (s.part_unit_id !== g.part_unit_id) continue;
          const dt = Math.abs(new Date(s.at) - new Date(g.time));
          if (dt < bestDt) { best = s; bestDt = dt; bi = i; }
        }
        if (best) { used.add(bi); g.slow_reason = best.reason || ""; g.slow_note = best.note || ""; }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, slowRows, opType]);
  const histGrouped = useMemo(() => groupLogs(hist), [hist, opType]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rowsAll = grouped.map((g) => {
    const r = relInfo[g.release_id] || null;
    const pm = r?.part_master || {};
    return {
      ...g,
      ordered: r ? Number(r.qty) || 0 : null,
      part_len: r?.length_mm ?? pm.default_length_mm ?? g.unit_len ?? g.def_len ?? null,
      inv: pm.material || pm.inventory_code || "",
      mdf: pm.mdf_no || "", rev: pm.rev || "",
      project_code: pm.projects?.code || "",
      project_name: g.project_name || pm.projects?.name || "",
      mod: r?.mod_version || "",
      machine_name: g.machine_name || machineName[g.mkey] || "",
    };
  });
  const text = (x) => String(x || "").toLowerCase();
  const qq = text(q).trim();
  const pass = (g) =>
    (!machineF || g.mkey === machineF) &&
    (!projF || g.project_id === projF) &&
    (!deptF || g.dept === deptF) &&
    (!statusF || (statusF === "office" ? g.office : String(g.status).toLowerCase() === statusF)) &&
    (!qq || [g.part_no, g.part_name, g.release_order, g.employee, g.mkey, g.machine_name, g.project_name, g.project_code, g.inv].some((v) => text(v).includes(qq)));
  const rows = rowsAll.filter(pass);
  const histRows = histGrouped.filter(pass);   // ใช้ตัวกรองเดียวกัน → เทียบแบบเดียวกัน

  const tgtMachines = Object.keys(cfg.targets || {}).filter((k) => (Number(cfg.targets[k]?.pcs) || 0) > 0 || (Number(cfg.targets[k]?.kg) || 0) > 0);
  const machineOpts = [...new Map([...tgtMachines.map((k) => [k, machineName[k] || ""]), ...rowsAll.map((g) => [g.mkey, g.machine_name])]).entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  const projOpts = [...new Map(rowsAll.filter((g) => g.project_id).map((g) => [g.project_id, `${g.project_code ? g.project_code + " — " : ""}${g.project_name}`])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const deptOpts = [["machine", L("เครื่องจักร", "Machining")], ["sub", L("ประกอบ (ซับ)", "Sub-assembly")], ["panel", L("แผง", "Panel")], ["packing", L("แพ็ก", "Packing")]]
    .filter(([k]) => rowsAll.some((g) => g.dept === k));
  const anyFilter = !!(machineF || projF || deptF || statusF || qq);

  // ── ตัวเลขหลัก ──
  const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const totPcs = sum(rows, (g) => g.qty);
  const totKg = sum(rows, (g) => g.weight);
  const totSec = sum(rows, (g) => g.secs);
  const finPcs = sum(rows.filter((g) => String(g.status).toLowerCase() === "finished"), (g) => g.qty);
  const inpPcs = sum(rows.filter((g) => String(g.status).toLowerCase() === "inprocess"), (g) => g.qty);
  const nSlow = rows.filter((g) => g.slow_reason).length;
  const activeMachines = [...new Set(rows.map((g) => g.mkey))];
  const nEmp = new Set(rows.map((g) => g.employee).filter(Boolean)).size;
  const nParts = new Set(rows.map((g) => `${g.project_id}|${g.part_no}`)).size;
  const nRel = new Set(rows.map((g) => g.release_order).filter((x) => x && x !== "—")).size;
  const firstT = rows.length ? rows.reduce((m, g) => (g.time < m ? g.time : m), rows[0].time) : null;
  const lastT = rows.length ? rows.reduce((m, g) => (g.time > m ? g.time : m), rows[0].time) : null;

  // เวลาตามแผน · เป้า (ตามเครื่องที่อยู่ในมุมมอง: ทำงานวันนี้ ∪ มีเป้า — ตัวกรองอื่นนอกจากเครื่องทำให้เป้าไม่ตรง → ไม่ใช้เป้า)
  const plannedFull = drPlannedMin(cfg, "0000-00-00");                 // ทั้งกะ
  const plannedNow = drPlannedMin(cfg, day, nowMs);                    // ถึงตอนนี้ (วันที่ผ่านแล้ว = ทั้งกะ)
  const paceRatio = plannedFull > 0 ? plannedNow / plannedFull : 1;
  const tgts = cfg.targets || {};
  const targetOK = !projF && !deptF && !statusF && !qq;                // เป้าตั้งเป็น "ต่อเครื่องทั้งวัน" — กรองย่อยลงไปจะเทียบไม่ได้
  const planSet = (active) => [...new Set([...active, ...tgtMachines])]
    .filter((k) => !machineF || k === machineF)
    .filter((k) => !anyFilter || machineF || active.includes(k));
  const plannedMachines = planSet(activeMachines);
  const tPcs = targetOK ? sum(plannedMachines, (k) => tgts[k]?.pcs) : 0;
  const tKg = targetOK ? sum(plannedMachines, (k) => tgts[k]?.kg) : 0;
  const nPlanned = plannedMachines.length;
  const plannedMinTotal = plannedNow * nPlanned;
  const util = plannedMinTotal > 0 ? (totSec / 60) / plannedMinTotal : null;
  const stops = (stopsAll || []).map((s) => ({ ...s, ...drStopMin(s, cfg, day, nowMs) })).filter((s) => s.day > 0 || (s.started_at && localDayStr(new Date(s.started_at)) === day));
  const stopsF = stops.filter((s) => !machineF || s.machine === machineF);
  const stopMin = sum(stopsF, (s) => s.day);
  const openStops = stopsF.filter((s) => s.open);
  const cycleMin = totPcs > 0 ? (totSec / 60) / totPcs : null;

  // ── สิ่งเทียบ: วันทำงานก่อนหน้า + เฉลี่ย 7 วัน (เฉพาะวันที่มีงาน) ──
  const byDay = {};
  histRows.forEach((g) => { const e = byDay[g.day] || (byDay[g.day] = { pcs: 0, kg: 0, secs: 0, ms: new Set() }); e.pcs += Number(g.qty) || 0; e.kg += Number(g.weight) || 0; e.secs += Number(g.secs) || 0; e.ms.add(g.mkey); });
  const workDays = Object.keys(byDay).filter((d) => byDay[d].pcs > 0).sort();
  workDays.forEach((d) => { const n = planSet([...byDay[d].ms]).length; byDay[d].util = plannedFull > 0 && n > 0 ? (byDay[d].secs / 60) / (plannedFull * n) : null; });
  const prevDay = workDays.length ? workDays[workDays.length - 1] : null;
  const prev = prevDay ? byDay[prevDay] : null;
  const avg = workDays.length ? {
    pcs: sum(workDays, (d) => byDay[d].pcs) / workDays.length,
    kg: sum(workDays, (d) => byDay[d].kg) / workDays.length,
    secs: sum(workDays, (d) => byDay[d].secs) / workDays.length,
    cyc: (() => { const p = sum(workDays, (d) => byDay[d].pcs); return p > 0 ? (sum(workDays, (d) => byDay[d].secs) / 60) / p : null; })(),
    util: (() => { const u = workDays.map((d) => byDay[d].util).filter((x) => x != null); return u.length ? u.reduce((a, b) => a + b, 0) / u.length : null; })(),
  } : null;
  if (prev) prev.cyc = prev.pcs > 0 ? (prev.secs / 60) / prev.pcs : null;
  const isToday = day === today;
  const prevLbl = prevDay ? new Date(`${prevDay}T12:00:00`).toLocaleDateString(lang === "en" ? "en-GB" : "th-TH", { day: "numeric", month: "short" }) : "";
  // ▲▼ — ยอดสะสม (ชิ้น/กก.) ของวันนี้ที่ยังไม่จบวัน: เทียบกับ "สัดส่วนเดียวกันของวัน" (× paceRatio) ไม่งั้นช่วงเช้าจะดูแย่ตลอด
  //       ค่าที่เป็นอัตรา (นาที/ชิ้น · %) ไม่ต้องปรับ · % ใช้ส่วนต่าง "จุด" (pts) ไม่ใช่ % ของ %
  const deltaOf = (cur, base, higherBetter, basisLbl, { scaled = true, pts = false } = {}) => {
    if (base == null || !(base > 0) || cur == null) return null;
    const b = scaled && isToday ? base * paceRatio : base;
    if (!(b > 0)) return null;
    const diff = pts ? (cur - b) * 100 : (cur - b) / b * 100;
    const up = diff >= 0;
    const good = higherBetter ? up : !up;
    const near = Math.abs(diff) < (pts ? 2 : 5);
    const num = pts ? L(`${Math.abs(Math.round(diff))} จุด`, `${Math.abs(Math.round(diff))} pts`) : `${Math.abs(Math.round(diff))}%`;
    return { tone: near ? "" : good ? "good" : "bad", text: `${near ? "≈" : up ? "▲" : "▼"} ${num} ${basisLbl}` };
  };
  const vsPrev = (cur, base, hb, o) => deltaOf(cur, base, hb, L(`จาก ${prevLbl}`, `vs ${prevLbl}`), o);
  const vsAvg = (cur, base, hb, o) => deltaOf(cur, base, hb, L("จากเฉลี่ย 7 วัน", "vs 7-day avg"), o);
  const goalOf = (actual, target, unitLbl) => {
    if (!(target > 0)) return null;
    const pace = isToday ? target * paceRatio : target;
    const low = actual < pace * 0.9;
    return {
      actual, target, pace: isToday ? pace : null, low,
      text: isToday
        ? L(`${Math.round(actual / target * 100)}% ของเป้า ${fmtKpi(target)} ${unitLbl} · ณ ตอนนี้ควรได้ ${fmtKpi(pace)}`, `${Math.round(actual / target * 100)}% of ${fmtKpi(target)} ${unitLbl} target · pace now ${fmtKpi(pace)}`)
        : L(`${Math.round(actual / target * 100)}% ของเป้า ${fmtKpi(target)} ${unitLbl}`, `${Math.round(actual / target * 100)}% of ${fmtKpi(target)} ${unitLbl} target`),
      paceText: L("เป้า ณ ตอนนี้", "pace now"),
    };
  };

  // ── ชิ้นงานรายชั่วโมง (ช่วงกะ ขยายถ้ามีงานนอกกะ) ──
  const hourly = (() => {
    const by = {};
    rows.forEach((g) => { const h = new Date(g.time).getHours(); const e = by[h] || (by[h] = { pcs: 0, kg: 0, scans: 0 }); e.pcs += Number(g.qty) || 0; e.kg += Number(g.weight) || 0; e.scans += 1; });
    const hs = Object.keys(by).map(Number);
    let h0 = Math.floor(hmToMin(cfg.start) / 60), h1 = Math.ceil(hmToMin(cfg.end) / 60) - 1;
    if (hs.length) { h0 = Math.min(h0, ...hs); h1 = Math.max(h1, ...hs); }
    if (isToday) h1 = Math.min(h1, Math.max(new Date(nowMs).getHours(), hs.length ? Math.max(...hs) : h0));
    const out = [];
    for (let h = h0; h <= h1; h++) out.push({ h, pcs: by[h]?.pcs || 0, kg: by[h]?.kg || 0, scans: by[h]?.scans || 0 });
    return out;
  })();
  const breakHours = (() => {
    const bs = hmToMin(cfg.breakStart), be = bs + (Number(cfg.breakMin) || 0);
    const out = []; for (let h = Math.floor(bs / 60); h * 60 < be; h++) { if ((Math.min(be, (h + 1) * 60) - Math.max(bs, h * 60)) >= 30) out.push(h); }
    return out;
  })();
  const targetPerHour = tPcs > 0 && plannedFull > 0 ? tPcs / (plannedFull / 60) : 0;

  // ── สรุปรายเครื่อง (+ เวลาตามแผน · เป้า · ธงผิดปกติ) ──
  const histByMachine = (() => {
    const m = {};
    histRows.forEach((g) => { const e = m[g.mkey] || (m[g.mkey] = {}); e[g.day] = (e[g.day] || 0) + (Number(g.qty) || 0); });
    const out = {};
    Object.entries(m).forEach(([k, days]) => { const ds = Object.values(days).filter((v) => v > 0); out[k] = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null; });
    return out;
  })();
  const machineRows = (() => {
    const m = new Map();
    const blank = (k) => ({ mkey: k, name: machineName[k] || "", emps: new Set(), parts: new Set(), scans: 0, pcs: 0, kg: 0, secs: 0, fin: 0, inp: 0, slow: 0, first: null, last: null });
    for (const g of rows) {
      const e = m.get(g.mkey) || blank(g.mkey);
      if (!e.name) e.name = g.machine_name || "";
      e.scans += 1; e.pcs += Number(g.qty) || 0; e.kg += Number(g.weight) || 0; e.secs += Number(g.secs) || 0;
      if (g.employee) e.emps.add(g.employee);
      e.parts.add(`${g.project_id}|${g.part_no}`);
      const st = String(g.status).toLowerCase();
      if (st === "finished") e.fin += Number(g.qty) || 0; else if (st === "inprocess") e.inp += Number(g.qty) || 0;
      if (g.slow_reason) e.slow += 1;
      if (!e.first || g.time < e.first) e.first = g.time;
      if (!e.last || g.time > e.last) e.last = g.time;
      m.set(g.mkey, e);
    }
    // เครื่องที่ "ตามแผนต้องทำ" (มีเป้า) หรือหยุด แต่ไม่มีสแกน → ต้องโชว์ (ข้อยกเว้นสำคัญ)
    if (!projF && !deptF && !statusF && !qq) {
      plannedMachines.forEach((k) => { if (!m.has(k)) m.set(k, blank(k)); });
      stopsF.forEach((s) => { if (!m.has(s.machine)) m.set(s.machine, blank(s.machine)); });
    }
    return [...m.values()].map((e) => {
      const st = stops.filter((s) => s.machine === e.mkey);
      const stopM = sum(st, (s) => s.day);
      const stopPl = sum(st, (s) => s.planned);   // ส่วนที่อยู่ในเวลากะ → ใช้แบ่งเวลาตามแผน
      const runM = e.secs / 60;
      const planned = plannedNow;
      const tp = targetOK ? Number(tgts[e.mkey]?.pcs) || 0 : 0;
      const tk = targetOK ? Number(tgts[e.mkey]?.kg) || 0 : 0;
      const paceP = tp * (isToday ? paceRatio : 1);
      const flags = [];
      if (st.some((s) => s.open)) flags.push({ tone: "bad", t: L("⛔ หยุดอยู่", "⛔ stopped now") });
      if (tp > 0 && e.scans > 0 && e.pcs < paceP * 0.9) flags.push({ tone: "warn", t: L("▼ ต่ำกว่าเป้า", "▼ below target") });
      if (e.scans === 0 && !st.length) flags.push({ tone: "warn", t: L("ยังไม่มีงาน", "no work yet") });
      if (st.length && !st.some((s) => s.open)) flags.push({ tone: "warn", t: L(`หยุด ${st.length} ครั้ง`, `${st.length} stop(s)`) });
      if (e.slow) flags.push({ tone: "warn", t: L(`รอบช้า ${e.slow}`, `${e.slow} slow`) });
      return {
        ...e, empText: [...e.emps].join(", "), nParts: e.parts.size, cycle: e.pcs > 0 ? runM / e.pcs : null,
        stops: st.length, stopMin: stopM, runMin: runM, planned,
        stopPlMin: stopPl, idleMin: Math.max(0, planned - runM - stopPl),
        util: planned > 0 ? runM / planned : null,
        tPcs: tp, tKg: tk, pctT: tp > 0 ? e.pcs / tp : null,
        avg7: histByMachine[e.mkey] ?? null, flags, sev: flags.some((f) => f.tone === "bad") ? 2 : flags.length ? 1 : 0,
      };
    });
  })();

  // Pareto: เวลาหยุดตามสาเหตุ (นาที) · รายงานการทำงานตามเหตุผล (ครั้ง)
  const stopPareto = (() => {
    const m = {};
    stopsF.forEach((s) => { const k = s.reason || L("ไม่ระบุ", "unspecified"); const e = m[k] || (m[k] = { v: 0, n: 0 }); e.v += Number(s.day) || 0; e.n += 1; });
    return Object.entries(m).map(([k, e]) => ({ k, v: Math.round(e.v), n: e.n })).sort((a, b) => b.v - a.v);
  })();
  const slowPareto = (() => {
    const m = {};
    rows.forEach((g) => { if (g.slow_reason) m[g.slow_reason] = (m[g.slow_reason] || 0) + 1; });
    return Object.entries(m).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  })();

  const loading = logs === null;
  const statusPill = (g) => {
    if (g.office) return <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{L("สแกนสำนักงาน", "office scan")}</span>;
    const fin = String(g.status).toLowerCase() === "finished";
    return (
      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
        color: fin ? "var(--success)" : "var(--accent-dk)", background: fin ? "rgba(16,157,99,.12)" : "rgba(37,99,235,.10)",
        border: `1px solid ${fin ? "var(--success)" : "var(--accent-dk)"}` }}>
        {fin ? L("เสร็จ", "finished") : L("กำลังทำ", "in process")}
      </span>
    );
  };
  const chip = { fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap", color: "#2563eb", background: "rgba(37,99,235,.10)", border: "1px solid rgba(37,99,235,.40)" };
  const nf = (v) => (v != null && v !== "" ? fmtNum(v) : "-");
  const pctTxt = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const statusText = (g) => (g.office ? L("สแกนสำนักงาน", "office scan") : String(g.status).toLowerCase() === "finished" ? L("เสร็จ", "finished") : L("กำลังทำ", "in process"));

  // ── คอลัมน์ "สรุปรายเครื่อง" ──
  const mCols = [
    { key: "flag", header: L("สถานะเครื่อง", "Condition"), sortKey: "flag", tdStyle: { whiteSpace: "nowrap" },
      cell: (m) => (m.flags.length ? <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{m.flags.map((f, i) => <span key={i} className={"dr-flag " + f.tone}>{f.t}</span>)}</span> : <span className="dr-flag ok">{L("✓ ปกติ", "✓ normal")}</span>),
      exp: (m) => (m.flags.length ? m.flags.map((f) => f.t).join(" · ") : L("ปกติ", "normal")) },
    { key: "mkey", header: L("เครื่อง", "Machine"), sortKey: "mkey", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }, cell: (m) => m.mkey, exp: (m) => m.mkey },
    { key: "name", header: L("ชื่อเครื่อง", "Machine name"), sortKey: "name", tdStyle: { color: "var(--muted)", whiteSpace: "nowrap" }, cell: (m) => m.name || "-", exp: (m) => m.name || "" },
    { key: "emp", header: L("พนักงาน", "Operator"), sortKey: "emp", tdStyle: { whiteSpace: "nowrap" }, cell: (m) => m.empText || "-", exp: (m) => m.empText },
    { key: "pcs", header: L("ชิ้นงาน", "Pieces"), sortKey: "pcs", align: "right", tdStyle: { fontWeight: 700 }, cell: (m) => fmtNum(m.pcs), exp: (m) => m.pcs },
    { key: "tgt", header: L("เป้า (ชิ้น)", "Target (pcs)"), sortKey: "tgt", align: "right", tdStyle: { whiteSpace: "nowrap" },
      cell: (m) => (m.tPcs > 0 ? <span className="dr-mini"><span className="dr-mini-bar"><i className={m.flags.some((f) => f.t.includes("▼")) ? "low" : ""} style={{ width: `${Math.min(100, (m.pctT || 0) * 100)}%` }} /></span>{pctTxt(m.pctT)} <span style={{ color: "var(--muted)" }}>/ {fmtNum(m.tPcs)}</span></span> : "—"),
      exp: (m) => (m.tPcs > 0 ? `${Math.round((m.pctT || 0) * 100)}% / ${m.tPcs}` : "") },
    { key: "avg7", header: L("เฉลี่ย 7 วัน", "7-day avg"), sortKey: "avg7", align: "right", tdStyle: { color: "var(--muted)" }, cell: (m) => (m.avg7 != null ? fmtKpi(m.avg7) : "—"), exp: (m) => (m.avg7 != null ? Math.round(m.avg7 * 10) / 10 : "") },
    { key: "kg", header: L("น้ำหนัก (กก.)", "Weight (kg)"), sortKey: "kg", align: "right", tdStyle: { color: "var(--accent-dk)", whiteSpace: "nowrap" }, cell: (m) => fmtKpi(m.kg), exp: (m) => Number((m.kg || 0).toFixed(2)) },
    { key: "util", header: L("เวลาเดินเครื่อง %", "Utilization %"), sortKey: "util", align: "right", tdStyle: { whiteSpace: "nowrap" },
      cell: (m) => (m.util != null ? <>{pctTxt(m.util)} <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{fmtDur(m.runMin, lang)}</span></> : "—"), exp: (m) => (m.util != null ? Math.round(m.util * 100) : "") },
    { key: "cycle", header: L("นาที/ชิ้น", "Min/pc"), sortKey: "cycle", align: "right", cell: (m) => (m.cycle != null ? fmtKpi(m.cycle) : "—"), exp: (m) => (m.cycle != null ? Math.round(m.cycle * 10) / 10 : "") },
    ...(manage ? [{ key: "stops", header: L("เวลาหยุด", "Downtime"), sortKey: "stops", align: "right", tdStyle: { whiteSpace: "nowrap" },
      cell: (m) => (m.stops ? <span style={{ color: "var(--danger)" }}>{fmtDur(m.stopMin, lang)} · {m.stops}×</span> : "—"), exp: (m) => (m.stops ? `${Math.round(m.stopMin)} min · ${m.stops}×` : "") }] : []),
    { key: "idle", header: L("ว่าง/อื่นๆ", "Idle/other"), sortKey: "idle", align: "right", tdStyle: { whiteSpace: "nowrap", color: "var(--muted)" }, cell: (m) => fmtDur(m.idleMin, lang), exp: (m) => Math.round(m.idleMin) },
    { key: "scans", header: L("สแกน", "Scans"), sortKey: "scans", align: "right", cell: (m) => fmtNum(m.scans), exp: (m) => m.scans },
    { key: "fin", header: L("เสร็จ (ชิ้น)", "Finished (pcs)"), sortKey: "fin", align: "right", cell: (m) => fmtNum(m.fin), exp: (m) => m.fin },
    { key: "inp", header: L("กำลังทำ (ชิ้น)", "In process (pcs)"), sortKey: "inp", align: "right", cell: (m) => fmtNum(m.inp), exp: (m) => m.inp },
    { key: "parts", header: "Part", dataLabel: "Part", sortKey: "parts", align: "right", cell: (m) => fmtNum(m.nParts), exp: (m) => m.nParts },
    { key: "slow", header: L("รายงานการทำงาน", "Work reports"), sortKey: "slow", align: "right", cell: (m) => (m.slow ? fmtNum(m.slow) : "—"), exp: (m) => m.slow || "" },
    { key: "first", header: L("สแกนแรก", "First scan"), sortKey: "first", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (m) => (m.first ? fmtClock(m.first) : "—"), exp: (m) => (m.first ? fmtClock(m.first) : "") },
    { key: "last", header: L("สแกนล่าสุด", "Last scan"), sortKey: "last", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (m) => (m.last ? fmtClock(m.last) : "—"), exp: (m) => (m.last ? fmtClock(m.last) : "") },
  ];
  const mAcc = { flag: (m) => m.sev, mkey: (m) => m.mkey, name: (m) => m.name, emp: (m) => m.empText, pcs: (m) => m.pcs, tgt: (m) => m.pctT, avg7: (m) => m.avg7, kg: (m) => m.kg,
    util: (m) => m.util, cycle: (m) => m.cycle, stops: (m) => m.stopMin, idle: (m) => m.idleMin, scans: (m) => m.scans, fin: (m) => m.fin, inp: (m) => m.inp,
    parts: (m) => m.nParts, slow: (m) => m.slow, first: (m) => m.first || "", last: (m) => m.last || "" };

  // ── คอลัมน์ "รายการทั้งหมด" ──
  const sCols = [
    { key: "time", header: L("เวลา", "Time"), sortKey: "time", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (g) => fmtClock(g.time), exp: (g) => fmtClock(g.time) },
    { key: "machine", header: L("เครื่อง", "Machine"), sortKey: "machine", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }, cell: (g) => g.mkey, exp: (g) => g.mkey },
    { key: "emp", header: L("พนักงาน", "Operator"), sortKey: "emp", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => g.employee || "-", exp: (g) => g.employee },
    { key: "project", header: L("โปรเจค", "Project"), sortKey: "project", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => (g.project_code ? <><b>{g.project_code}</b> <span style={{ color: "var(--muted)" }}>{g.project_name}</span></> : g.project_name || "-"), exp: (g) => [g.project_code, g.project_name].filter(Boolean).join(" — ") },
    { key: "ro", header: "Release", dataLabel: "Release", sortKey: "ro", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (g) => g.release_order, exp: (g) => g.release_order },
    { key: "part", header: "Part No.", dataLabel: "Part No.", sortKey: "part", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 600, whiteSpace: "nowrap" }, cell: (g) => g.part_no, exp: (g) => g.part_no },
    { key: "pname", header: L("ชื่อ Part", "Part name"), sortKey: "pname", tdStyle: { color: "var(--muted)", whiteSpace: "nowrap" }, cell: (g) => g.part_name || "-", exp: (g) => g.part_name },
    { key: "mdf", header: "MDF NO.", dataLabel: "MDF NO.", sortKey: "mdf", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => g.mdf || "-", exp: (g) => g.mdf },
    { key: "rev", header: "REV.", dataLabel: "REV.", sortKey: "rev", cell: (g) => g.rev || "-", exp: (g) => g.rev },
    { key: "op", header: L("ขั้นตอน", "Step"), sortKey: "op", tdStyle: { whiteSpace: "nowrap" },
      cell: (g) => (g.ops.length ? <span style={{ display: "inline-flex", gap: 5 }}>{g.ops.map((o, i) => <span key={i} style={chip}>{opLabel(o, lang)}</span>)}</span> : "—"),
      exp: (g) => g.ops.map((o) => opLabel(o, lang)).join(" · ") },
    { key: "status", header: L("สถานะ", "Status"), sortKey: "status", tdStyle: { whiteSpace: "nowrap" },
      cell: (g) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{statusPill(g)}{g.slow_reason ? <span title={g.slow_reason + (g.slow_note ? " — " + g.slow_note : "")} style={{ cursor: "help" }}>⚠️</span> : null}</span>,
      exp: (g) => statusText(g) },
    { key: "qty", header: L("จำนวน", "Qty"), sortKey: "qty", align: "right", tdStyle: { fontWeight: 700 }, cell: (g) => fmtNum(g.qty), exp: (g) => Number(g.qty) || 0 },
    { key: "ordered", header: L("สั่ง", "Ordered"), sortKey: "ordered", align: "right", cell: (g) => nf(g.ordered), exp: (g) => (g.ordered != null ? g.ordered : "") },
    { key: "weight", header: L("น้ำหนัก (กก.)", "Weight (kg)"), sortKey: "weight", align: "right", tdStyle: { color: "var(--accent-dk)", whiteSpace: "nowrap" }, cell: (g) => (g.weight ? fmtNum(g.weight) : "—"), exp: (g) => (g.weight ? Number((Number(g.weight) || 0).toFixed(2)) : "") },
    { key: "partlen", header: L("ความยาวพาร์ท (มม.)", "Part length (mm)"), sortKey: "partlen", align: "right", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => nf(g.part_len), exp: (g) => (g.part_len != null ? Number(g.part_len) : "") },
    { key: "matlen", header: L("Mat. Length (มม.)", "Mat. Length (mm)"), sortKey: "matlen", align: "right", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => nf(g.matlen), exp: (g) => (g.matlen != null ? g.matlen : "") },
    { key: "inv", header: "INV Code", dataLabel: "INV Code", sortKey: "inv", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => g.inv || "-", exp: (g) => g.inv },
    { key: "secs", header: L("เวลาเดินเครื่อง", "Run time"), sortKey: "secs", align: "right", tdStyle: { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }, cell: (g) => (g.secs ? fmtHrs(g.secs) : "—"), exp: (g) => (g.secs ? fmtHrs(g.secs) : "") },
    { key: "minPer", header: L("นาที/ชิ้น", "Min/pc"), sortKey: "minPer", align: "right", cell: (g) => (g.qty > 0 && g.secs ? fmtKpi(g.secs / 60 / g.qty) : "—"), exp: (g) => (g.qty > 0 && g.secs ? Math.round(g.secs / 6 / g.qty) / 10 : "") },
    { key: "slow", header: L("รายงานการทำงาน", "Work report"), sortKey: "slow", tdStyle: { color: "#b45309", whiteSpace: "nowrap" }, cell: (g) => (g.slow_reason ? g.slow_reason + (g.slow_note ? " — " + g.slow_note : "") : "—"), exp: (g) => (g.slow_reason ? g.slow_reason + (g.slow_note ? " — " + g.slow_note : "") : "") },
    { key: "mod", header: "Modify", dataLabel: "Modify", sortKey: "mod", tdStyle: { whiteSpace: "nowrap" }, cell: (g) => g.mod || "-", exp: (g) => g.mod },
  ];
  const sAcc = {
    time: (g) => g.time || "", machine: (g) => g.mkey, emp: (g) => g.employee, project: (g) => `${g.project_code} ${g.project_name}`, ro: (g) => g.release_order,
    part: (g) => g.part_no, pname: (g) => g.part_name, mdf: (g) => g.mdf, rev: (g) => g.rev, op: (g) => g.ops.join(" · "),
    status: (g) => (g.office ? -1 : String(g.status).toLowerCase() === "finished" ? 1 : 0), qty: (g) => Number(g.qty) || 0, ordered: (g) => g.ordered,
    weight: (g) => Number(g.weight) || 0, partlen: (g) => (g.part_len != null ? Number(g.part_len) : null), matlen: (g) => g.matlen, inv: (g) => g.inv,
    secs: (g) => Number(g.secs) || 0, minPer: (g) => (g.qty > 0 ? (Number(g.secs) || 0) / g.qty : null), slow: (g) => g.slow_reason || "", mod: (g) => g.mod,
  };

  async function doExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const pick = (cols, api, list) => {
        const vis = (api && api.current && Array.isArray(api.current.visibleKeys)) ? api.current.visibleKeys : cols.map((c) => c.key);
        const by = Object.fromEntries(cols.map((c) => [c.key, c]));
        const useCols = vis.map((k) => by[k]).filter(Boolean);
        return list.map((x) => { const o = {}; useCols.forEach((c) => { o[typeof c.header === "string" ? c.header : c.key] = c.exp ? c.exp(x) : ""; }); return o; });
      };
      const kpi = [
        [L("วันที่", "Date"), day],
        [L("ชิ้นงาน", "Pieces"), totPcs], [L("เป้า (ชิ้น)", "Target (pcs)"), tPcs || ""],
        [L("ชิ้นที่กด Finished", "Finished pcs"), finPcs], [L("ชิ้นกำลังทำ", "In-process pcs"), inpPcs],
        [L("น้ำหนัก (กก.)", "Weight (kg)"), Number(totKg.toFixed(2))], [L("เป้า (กก.)", "Target (kg)"), tKg || ""],
        [L("เวลาเดินเครื่อง (นาที)", "Run time (min)"), Math.round(totSec / 60)],
        [L("เวลาตามแผน (นาที)", "Planned time (min)"), Math.round(plannedMinTotal)],
        [L("เวลาเดินเครื่อง %", "Utilization %"), util != null ? Math.round(util * 100) : ""],
        [L("นาที/ชิ้น", "Min per piece"), cycleMin != null ? Math.round(cycleMin * 10) / 10 : ""],
        ...(manage && stopsAll ? [[L("เวลาหยุด (นาที)", "Downtime (min)"), Math.round(stopMin)], [L("หยุด (ครั้ง)", "Stops"), stopsF.length]] : []),
        [L("สแกน (ครั้ง)", "Scans"), rows.length], [L("เครื่องที่ทำงาน", "Machines working"), activeMachines.length], [L("พนักงาน", "Operators"), nEmp],
        ["Part", nParts], ["Release", nRel], [L("รายงานการทำงาน", "Work reports"), nSlow],
        [L("เทียบวันก่อน", "Previous working day"), prevDay || ""], [L("ชิ้นงาน วันก่อน", "Pieces prev day"), prev ? prev.pcs : ""],
        [L("ชิ้นงาน เฉลี่ย 7 วัน", "Pieces 7-day avg"), avg ? Math.round(avg.pcs * 10) / 10 : ""],
        [L("เวลากะ", "Shift"), `${cfg.start}–${cfg.end} · ${L("พัก", "break")} ${cfg.breakStart} ${cfg.breakMin} min`],
      ].map(([k, v]) => ({ [L("หัวข้อ", "Item")]: k, [L("ค่า", "Value")]: v }));
      const { downloadSheets } = await import("./excelExport.js");
      await downloadSheets(`daily-report-${day}.xlsx`, [
        { name: L("ภาพรวม", "Overview"), rows: kpi },
        { name: L("สรุปรายเครื่อง", "By machine"), rows: pick(mCols, colApiM, sortM.sortRows(machineRows, mAcc)) },
        { name: L("รายการทั้งหมด", "All scans"), rows: pick(sCols, colApiS, sortS.sortRows(rows, sAcc)) },
        ...(stopPareto.length ? [{ name: L("สาเหตุหยุด", "Downtime reasons"), rows: stopPareto.map((r) => ({ [L("สาเหตุ", "Reason")]: r.k, [L("นาที", "Minutes")]: r.v, [L("ครั้ง", "Count")]: r.n })) }] : []),
        ...(slowPareto.length ? [{ name: L("รายงานการทำงาน", "Work reports"), rows: slowPareto.map((r) => ({ [L("เหตุผล", "Reason")]: r.k, [L("ครั้ง", "Count")]: r.v })) }] : []),
      ]);
    } catch (e) {
      console.warn("daily report export error", e);
      mlsToast(L("สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง", "Export failed, please try again"), "error");
    } finally { setExporting(false); }
  }

  const selStyle = { height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", padding: "0 10px", fontFamily: "inherit", fontSize: 13.5, minWidth: 150 };
  const dayLabel = new Date(`${day}T12:00:00`).toLocaleDateString(lang === "en" ? "en-GB" : "th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const exceptions = machineRows.filter((m) => m.sev > 0).sort((a, b) => b.sev - a.sev);
  const pctDone = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

  return (
    <div className="dr-page">
      <div className="page-head">
        <div>
          <div className="page-title">{L("รายงานประจำวัน", "Daily Report")}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            {dayLabel}{isToday ? L(" · วันนี้ (ยังไม่จบวัน)", " · today (in progress)") : ""}
            {" · "}{L("กะ", "shift")} {cfg.start}–{cfg.end} ({L("พัก", "break")} {cfg.breakMin} {L("น.", "min")})
            {admin ? <button type="button" className="dr-link" onClick={() => setShowCfg(true)}>⚙ {L("ตั้งเวลากะ / เป้า", "Shift & targets")}</button> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Btn variant="ghost" size="sm" onClick={() => setDay(shiftDayStr(day, -1))} title={L("วันก่อนหน้า", "Previous day")}>◀</Btn>
          <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ ...selStyle, minWidth: 0 }} aria-label={L("เลือกวันที่", "Pick a date")} />
          <Btn variant="ghost" size="sm" onClick={() => setDay(shiftDayStr(day, 1))} disabled={day >= today} title={L("วันถัดไป", "Next day")}>▶</Btn>
          {!isToday && <Btn variant="ghost" size="sm" onClick={() => setDay(today)}>{L("วันนี้", "Today")}</Btn>}
          <Btn variant="ghost" size="sm" onClick={() => { setNowMs(Date.now()); setReloadTick((n) => n + 1); }} title={L("โหลดใหม่", "Reload")}><Icon name="refresh" size={14} /></Btn>
          <Btn variant="accent" size="sm" onClick={doExport} disabled={exporting || loading}><Icon name="grid" size={14} /> {exporting ? L("กำลังสร้าง…", "Exporting…") : "Export Excel"}</Btn>
        </div>
      </div>

      {cfgState === "nosql" && admin && (
        <div className="dr-banner">{L("⚠ ยังไม่ได้รัน migration-daily-report-settings.sql — ใช้เวลากะเริ่มต้น 08:00–17:00 และยังตั้งเป้าไม่ได้", "⚠ migration-daily-report-settings.sql not run yet — using default shift 08:00–17:00, targets unavailable")}</div>
      )}

      <div className="dr-filters">
        <select value={machineF} onChange={(e) => setMachineF(e.target.value)} style={selStyle} aria-label={L("เครื่อง", "Machine")}>
          <option value="">{L("ทุกเครื่อง", "All machines")}</option>
          {machineOpts.map(([k, n]) => <option key={k} value={k}>{k}{n && n !== k ? ` — ${n}` : ""}</option>)}
        </select>
        <select value={projF} onChange={(e) => setProjF(e.target.value)} style={selStyle} aria-label={L("โปรเจค", "Project")}>
          <option value="">{L("ทุกโปรเจค", "All projects")}</option>
          {projOpts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        {deptOpts.length > 1 && (
          <select value={deptF} onChange={(e) => setDeptF(e.target.value)} style={selStyle} aria-label={L("แผนก", "Department")}>
            <option value="">{L("ทุกแผนก", "All departments")}</option>
            {deptOpts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        )}
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={selStyle} aria-label={L("สถานะ", "Status")}>
          <option value="">{L("ทุกสถานะ", "All statuses")}</option>
          <option value="finished">{L("เสร็จ", "Finished")}</option>
          <option value="inprocess">{L("กำลังทำ", "In process")}</option>
          {rowsAll.some((g) => g.office) && <option value="office">{L("สแกนสำนักงาน", "Office scan")}</option>}
        </select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา Part / Release / พนักงาน / INV…", "Search part / release / operator / INV…")} style={{ flex: "1 1 220px", minWidth: 200, height: 38 }} />
        {anyFilter ? <Btn variant="ghost" size="sm" onClick={() => { setMachineF(""); setProjF(""); setDeptF(""); setStatusF(""); setQ(""); }}>{L("ล้างตัวกรอง", "Clear filters")}</Btn> : null}
      </div>

      {loading ? (
        <Card><div style={{ color: "var(--muted)", fontSize: 13, padding: "18px 2px", textAlign: "center" }}>{L("กำลังโหลด…", "Loading…")}</div></Card>
      ) : (
        <>
          {/* ── ชั้นที่ 1: ตัวชี้วัดหลัก 5 ตัว (สำคัญสุดซ้าย) · ทุกตัวมีสิ่งเทียบ ── */}
          <div className="dr-kpis">
            <DrKpi label={L("ชิ้นงานที่ทำ", "Pieces produced")} value={fmtNum(totPcs)} unit={L("ชิ้น", "pcs")}
              goal={targetOK ? goalOf(totPcs, tPcs, L("ชิ้น", "pcs")) : null}
              sub={L(`กด Finished ${fmtNum(finPcs)} · กำลังทำ ${fmtNum(inpPcs)}`, `Finished ${fmtNum(finPcs)} · in process ${fmtNum(inpPcs)}`)}
              deltas={[vsPrev(totPcs, prev?.pcs, true), vsAvg(totPcs, avg?.pcs, true)]}
              info={L("รวมจำนวนที่ใส่ตอนกด OK ทุกงานของวัน (ชิ้นที่ผ่าน 2 เครื่อง นับ 2 ครั้ง = ปริมาณงานของเครื่อง)", "Sum of quantities saved today (a piece through 2 machines counts twice = machine workload)")} />
            <DrKpi label={L("น้ำหนักงาน", "Weight processed")} value={fmtKpi(totKg)} unit={L("กก.", "kg")}
              goal={targetOK ? goalOf(totKg, tKg, L("กก.", "kg")) : null}
              sub={totPcs > 0 ? L(`เฉลี่ย ${fmtKpi(totKg / totPcs)} กก./ชิ้น`, `avg ${fmtKpi(totKg / totPcs)} kg/pc`) : null}
              deltas={[vsPrev(totKg, prev?.kg, true), vsAvg(totKg, avg?.kg, true)]}
              info={L("จำนวน × น้ำหนักต่อชิ้นของงานที่บันทึก", "Quantity × unit weight of saved work")} />
            <DrKpi label={L("เวลาเดินเครื่อง", "Utilization")} value={util != null ? `${Math.round(util * 100)}` : "—"} unit={util != null ? "%" : ""}
              sub={L(`เดิน ${fmtDur(totSec / 60, lang)} จากเวลาตามแผน ${fmtDur(plannedMinTotal, lang)} (${nPlanned} เครื่อง)`, `ran ${fmtDur(totSec / 60, lang)} of ${fmtDur(plannedMinTotal, lang)} planned (${nPlanned} machine${nPlanned === 1 ? "" : "s"})`)}
              deltas={util != null ? [vsPrev(util, prev?.util, true, { scaled: false, pts: true }), vsAvg(util, avg?.util, true, { scaled: false, pts: true })] : []}
              info={L("เวลาเดินเครื่อง (สแกนรอบแรก → กด OK) ÷ เวลาทำงานตามแผน (กะ − พัก) × จำนวนเครื่องที่ตามแผน (ทำงานวันนี้ หรือมีเป้า) · วันนี้นับถึงตอนนี้", "Run time (first scan → OK) ÷ planned time (shift − break) × planned machines (worked today or have a target) · today counts up to now")} />
            <DrKpi label={L("เวลาต่อชิ้น", "Time per piece")} value={cycleMin != null ? fmtKpi(cycleMin) : "—"} unit={cycleMin != null ? L("นาที", "min") : ""}
              deltas={cycleMin != null ? [vsPrev(cycleMin, prev?.cyc, false, { scaled: false }), vsAvg(cycleMin, avg?.cyc, false, { scaled: false })] : []}
              sub={L("เวลาเดินเครื่อง ÷ ชิ้นงาน (น้อย = เร็ว)", "run time ÷ pieces (lower = faster)")}
              info={L("เฉลี่ยทุกเครื่อง · ดูรายเครื่องในตารางด้านล่าง", "All machines average · see per machine below")} />
            <DrKpi label={L("เวลาหยุดเครื่อง", "Downtime")} value={manage && stopsAll ? fmtDur(stopMin, lang) : "—"}
              sub={manage && stopsAll ? L(`${stopsF.length} ครั้ง${openStops.length ? ` · หยุดอยู่ ${openStops.length} เครื่อง` : ""}`, `${stopsF.length} stop(s)${openStops.length ? ` · ${openStops.length} stopped now` : ""}`) : L("ดูได้เฉพาะ admin / office / supervisor", "admin / office / supervisor only")}
              alert={openStops.length ? L(`⛔ ${openStops.map((s) => s.machine).join(", ")} หยุดอยู่ตอนนี้`, `⛔ ${openStops.map((s) => s.machine).join(", ")} stopped now`) : null}
              info={L("จากการกด \"แจ้งเครื่องหยุด\" ที่หน้าเครื่อง จนกด \"พร้อมทำงาน\"", "From \"machine stop\" on the terminal until \"ready\"")} />
          </div>
          <div className="dr-context">
            {L("สแกน", "Scans")} <b>{fmtNum(rows.length)}</b> · {L("เครื่องทำงาน", "machines working")} <b>{activeMachines.length}</b>{machinesAll.length ? <>/{machinesAll.length}</> : null}
            {" · "}{L("พนักงาน", "operators")} <b>{nEmp}</b> · Part <b>{nParts}</b> · Release <b>{nRel}</b>
            {" · "}{L("รายงานการทำงาน", "work reports")} <b>{nSlow}</b>
            {rows.length ? <> · {L("สแกนแรก", "first")} <b className="mono">{fmtClock(firstT)}</b> {L("ล่าสุด", "last")} <b className="mono">{fmtClock(lastT)}</b></> : null}
            {prevDay ? <> · {L("เทียบ", "compared with")} {prevLbl} {L("และเฉลี่ย", "and the average of")} {workDays.length} {L("วันทำงาน", "working days")}</> : <> · {L("ยังไม่มีข้อมูล 7 วันก่อนหน้าให้เทียบ", "no previous 7 days to compare")}</>}
            {anyFilter ? <span style={{ color: "#b45309" }}> · {L("ตัวเลขตามตัวกรอง", "filtered")}{!targetOK ? L(" (ไม่แสดงเป้า)", " (targets hidden)") : ""}</span> : null}
          </div>

          {/* ── ข้อยกเว้น (Report by exception): เครื่องที่ต้องดู ── */}
          {exceptions.length > 0 && (
            <div className="dr-exc">
              <b>{L("ต้องดู", "Needs attention")}:</b>
              {exceptions.slice(0, 8).map((m) => (
                <button key={m.mkey} type="button" className={"dr-exc-item " + (m.sev === 2 ? "bad" : "warn")} onClick={() => { setMachineF(m.mkey); setTimeout(() => { try { listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* ignore */ } }, 60); }}>
                  <b>{m.mkey}</b> {m.flags.map((f) => f.t).join(" · ")}
                </button>
              ))}
            </div>
          )}

          {rows.length === 0 && machineRows.length === 0 ? (
            <Card>
              <div className="empty-state">
                <Icon name="chart" size={32} />
                <div className="empty-state-title">{anyFilter ? L("ไม่มีงานตามตัวกรองที่เลือก", "No work matches the filters") : L("วันนี้ยังไม่มีการสแกน", "No scans on this day")}</div>
                <div className="empty-state-sub">{L("เลือกวันอื่นด้วย ◀ ▶ หรือปฏิทินด้านบน", "Pick another day with ◀ ▶ or the calendar above")}</div>
              </div>
            </Card>
          ) : (
            <>
              {/* ── ชั้นที่ 2: แนวโน้มระหว่างวัน + การใช้เวลาเครื่อง ── */}
              <div className="dr-grid2">
                <Card title={L("ชิ้นงานรายชั่วโมง", "Pieces per hour")}
                  right={<span className="dr-legend">{targetPerHour > 0 ? <><i className="dash" /> {L("เป้า/ชม.", "target/h")}</> : null} <i className="sq brk" /> {L("พัก", "break")}</span>}>
                  <DrHourlyChart data={hourly} targetPerHour={targetOK ? targetPerHour : 0} breakHours={breakHours} lang={lang} />
                </Card>
                <Card title={L("การใช้เวลาเครื่อง (ตามแผน)", "Machine time (planned)")}
                  right={<span className="dr-legend"><i className="sq run" /> {L("เดินเครื่อง", "running")} <i className="sq stop" /> {L("หยุด", "down")} <i className="sq idle" /> {L("ว่าง/อื่นๆ", "idle/other")}</span>}>
                  <div className="dr-time">
                    {[...machineRows].sort((a, b) => b.runMin - a.runMin).slice(0, 12).map((m) => {
                      const tot = Math.max(m.planned, m.runMin + m.stopPlMin, 1);
                      const w = (v) => `${(v / tot) * 100}%`;
                      return (
                        <div key={m.mkey} className="dr-time-row" title={`${m.mkey}: ${L("เดิน", "run")} ${fmtDur(m.runMin, lang)} · ${L("หยุด", "down")} ${fmtDur(m.stopPlMin, lang)} · ${L("ว่าง", "idle")} ${fmtDur(m.idleMin, lang)} / ${L("ตามแผน", "planned")} ${fmtDur(m.planned, lang)}`}>
                          <div className="dr-time-k">{m.mkey}</div>
                          <div className="dr-time-bar">
                            {m.runMin > 0 && <i className="run" style={{ width: w(m.runMin) }} />}
                            {m.stopPlMin > 0 && <i className="stop" style={{ width: w(m.stopPlMin) }} />}
                            {m.idleMin > 0 && <i className="idle" style={{ width: w(m.idleMin) }} />}
                          </div>
                          <div className="dr-time-v">{pctTxt(m.util)}</div>
                        </div>
                      );
                    })}
                    {plannedNow <= 0 && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{L("ยังไม่ถึงเวลาเริ่มกะ", "Shift hasn't started")}</div>}
                  </div>
                </Card>
              </div>

              {/* ── Pareto: สาเหตุเวลาหยุด · เหตุผลรอบช้า ── */}
              <div className="dr-grid2">
                <Card title={L("สาเหตุเวลาหยุด (นาที)", "Downtime by reason (min)")}>
                  {manage && stopsAll
                    ? <DrPareto rows={stopPareto} unit={L("น.", "min")} tone="stop" empty={L("ไม่มีเครื่องหยุดในวันนี้", "No downtime on this day")} />
                    : <div style={{ color: "var(--muted)", fontSize: 13 }}>{L("ดูได้เฉพาะ admin / office / supervisor", "admin / office / supervisor only")}</div>}
                </Card>
                <Card title={L("รายงานการทำงาน (รอบช้า) ตามเหตุผล", "Work reports (slow) by reason")}>
                  <DrPareto rows={slowPareto} unit={L("ครั้ง", "×")} tone="warn" empty={L("ไม่มีรายงานการทำงาน", "No work reports")} />
                  {rows.length > 0 && nSlow / rows.length > 0.5 ? (
                    <div style={{ fontSize: 11.5, color: "#b45309", marginTop: 8 }}>
                      {L(`มีเหตุผลแนบ ${nSlow} จาก ${rows.length} งาน — หน้าเครื่องแนบเหตุผลค้างไว้กับทุกงานถัดไปจนกด "ยกเลิก" ตรวจว่าคนงานลืมยกเลิกหรือไม่`,
                         `${nSlow} of ${rows.length} jobs carry a reason — the terminal keeps it for every next job until "Clear"; check whether it was left on`)}
                    </div>
                  ) : null}
                </Card>
              </div>

              {/* ── ชั้นที่ 3: รายเครื่อง ── */}
              <Card title={L("สรุปรายเครื่อง", "By machine")}
                right={<Btn variant="ghost" size="sm" onClick={() => colApiM.current && colApiM.current.resetAll()} title={L("คืนค่าเริ่มต้น: ลำดับคอลัมน์ + แสดงคอลัมน์ที่ซ่อน", "Reset column order + show hidden columns")}>↺ {L("คอลัมน์", "Columns")}</Btn>}>
                <div className="dr-hint">
                  {L("แตะแถวเพื่อดูเฉพาะเครื่องนั้นในตารางด้านล่าง · คลิกขวาที่หัวตาราง/ปุ่ม ▥ = เลือกคอลัมน์ · ลาก ⠿ = ย้ายคอลัมน์",
                     "Tap a row to show only that machine below · right-click the header / ▥ = choose columns · drag ⠿ = move columns")}
                </div>
                <DataTable id="daily-machines2" wrapClass="table-wrap" tableClass="data-table responsive-cards" orderApiRef={colApiM}
                  rows={machineRows} rowKey={(m) => m.mkey} sort={sortM} sortAccessors={mAcc} columns={mCols}
                  defaultHidden={["name", "scans", "parts", "first", "last", "inp"]}
                  rowProps={(m) => ({ className: "release-row", style: { cursor: "pointer", background: machineF === m.mkey ? "var(--accent-soft, rgba(16,185,129,.08))" : undefined },
                    onClick: () => { setMachineF(machineF === m.mkey ? "" : m.mkey); setTimeout(() => { try { listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* ignore */ } }, 60); },
                    title: L("แตะเพื่อกรองเฉพาะเครื่องนี้ (แตะซ้ำ = ยกเลิก)", "Tap to filter this machine (tap again to clear)") })} />
              </Card>

              {/* ── ชั้นที่ 4: รายการละเอียด ── */}
              <div ref={listRef} />
              <Card title={`${L("รายการทั้งหมด", "All scans")} (${fmtNum(rows.length)})`}
                right={<Btn variant="ghost" size="sm" onClick={() => colApiS.current && colApiS.current.resetAll()} title={L("คืนค่าเริ่มต้น: ลำดับคอลัมน์ + แสดงคอลัมน์ที่ซ่อน", "Reset column order + show hidden columns")}>↺ {L("คอลัมน์", "Columns")}</Btn>}>
                <div className="dr-hint">
                  {L("1 แถว = 1 การสแกน (ขั้นตอนที่ติ๊กร่วมรวมในแถวเดียว) · คลิกขวาที่หัวตาราง/ปุ่ม ▥ = เปิด-ปิดคอลัมน์ · ลาก ⠿ = ย้ายคอลัมน์ · Export ออกตามคอลัมน์ที่เห็น",
                     "1 row = 1 scan (co-ticked steps merged) · right-click the header / ▥ = show/hide columns · drag ⠿ = move columns · Export follows the visible columns")}
                </div>
                <DataTable id="daily-scans" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards" orderApiRef={colApiS}
                  rows={rows} rowKey={(g) => g.key} sort={sortS} sortAccessors={sAcc} columns={sCols}
                  defaultHidden={["pname", "mdf", "rev", "minPer", "mod"]}
                  empty={L("ไม่มีรายการ", "No rows")} />
              </Card>
            </>
          )}

          {/* ── นิยามตัวเลข (ISO 22400: ทุกคนอ่านแบบเดียวกัน) ── */}
          <details className="dr-defs">
            <summary>ⓘ {L("นิยามตัวเลขในหน้านี้", "How the numbers are defined")}</summary>
            <ul>
              <li><b>{L("ชิ้นงานที่ทำ", "Pieces produced")}</b> — {L("รวมจำนวนที่ใส่ตอนกด OK ทุกงาน (ปริมาณงานของเครื่อง: ชิ้นที่ผ่าน 2 เครื่องนับ 2 ครั้ง)", "sum of quantities saved (machine workload: a piece through 2 machines counts twice)")}</li>
              <li><b>{L("เป้า", "Target")}</b> — {L("เป้าชิ้น/กก. ต่อเครื่องต่อวันที่แอดมินตั้ง · วันนี้ขีดดำ = เป้า ณ ตอนนี้ (ตามสัดส่วนเวลากะที่ผ่านไป) · ต่ำกว่า 90% ของเป้า ณ ตอนนี้ = ▼ ต่ำกว่าเป้า", "admin-set pcs/kg per machine per day · today the black tick = pace now (share of the shift elapsed) · below 90% of pace = ▼ below target")}</li>
              <li><b>{L("เวลาเดินเครื่อง %", "Utilization %")}</b> — {L("เวลาเดินเครื่อง (สแกนรอบแรก → กด OK) ÷ เวลาตามแผน (เวลากะ − พัก) ของเครื่องที่ทำงานวันนี้หรือมีเป้า", "run time (first scan → OK) ÷ planned time (shift − break) of machines that worked today or have a target")}</li>
              <li><b>{L("เวลาหยุด / ว่าง", "Downtime / idle")}</b> — {L("หยุด = จากกด \"แจ้งเครื่องหยุด\" ถึง \"พร้อมทำงาน\" (ตัดตามขอบวัน · หยุดค้าง = ถึงตอนนี้) · ว่าง/อื่นๆ = เวลาตามแผน − เดินเครื่อง − หยุดในเวลากะ (รอของ, ตั้งเครื่อง, ไม่ได้สแกน ฯลฯ) · ทำงานนอกเวลากะ/ล่วงเวลา ทำให้เกิน 100% ได้", "down = from \"machine stop\" to \"ready\" (clipped to the day · open stop = until now) · idle/other = planned − running − down within the shift (waiting, setup, unscanned work …) · work outside the shift/overtime can exceed 100%")}</li>
              <li><b>{L("เวลาต่อชิ้น", "Time per piece")}</b> — {L("เวลาเดินเครื่อง ÷ ชิ้นงาน (น้อย = เร็ว)", "run time ÷ pieces (lower = faster)")}</li>
              <li><b>{L("▲▼ เทียบ", "▲▼ comparisons")}</b> — {L("เทียบวันทำงานก่อนหน้า และค่าเฉลี่ยของวันที่มีงานใน 7 วันก่อน · วันนี้เทียบกับสัดส่วนเดียวกันของวัน · เขียว = ดีขึ้น · ส้ม = แย่ลง · ≈ = ต่างไม่ถึง 5%", "vs the previous working day and the average of working days in the previous 7 · today is compared at the same share of the day · green = better · amber = worse · ≈ = within 5%")}</li>
              <li><b>{L("ยังไม่มี", "Not yet included")}</b> — {L("คุณภาพ/ของเสีย (หน้าเครื่องยังไม่เก็บ) จึงยังไม่คิด OEE เต็ม (Availability × Performance × Quality)", "quality/scrap (not captured yet), so full OEE (Availability × Performance × Quality) isn't computed")}</li>
            </ul>
          </details>
        </>
      )}

      {showCfg && (
        <DrSettingsModal cfg={cfg} lang={lang}
          machines={(machinesAll.length ? machinesAll : activeMachines.map((c) => ({ code: c, name: "" }))).filter((m) => m.code)}
          onClose={() => setShowCfg(false)}
          onSaved={(v) => { setCfg({ ...DR_DEFAULT, ...v }); setCfgState("ok"); setShowCfg(false); mlsToast(L("บันทึกเวลากะ/เป้าแล้ว", "Shift & targets saved"), "success"); }} />
      )}
    </div>
  );
}

function MachinesSummaryPage() {
  const [lang] = useLang();
  const [preset, setPreset] = useState("week");
  const [logs, setLogs] = useState([]);
  const [viewMachine, setViewMachine] = useState(null);   // เจาะดูสแกนทั้งหมดของเครื่องที่เลือก
  useEffect(() => {
    const { from, to } = rangeFor(preset);
    getScanLogsBetween(from, to).then(setLogs);
  }, [preset]);

  // per-scan = ภาระงานของเครื่อง (ถูกต้อง: เครื่องทำงานกับชิ้นนั้นจริงทุกครั้งที่สแกน)
  const matrix = machineOpMatrix(logs);
  const rows = matrix.machines.map((m) => ({ name: m.code || m.name, count: m.total.count, weight: m.total.weight }));

  // เรียงลำดับตาราง (กดหัวคอลัมน์) — ต้องมี sort + accessor ของหน้านี้เอง (เดิมอ้างของ ReportPage → จอขาว)
  const sortW = useTableSort();
  const machineAcc = {
    code: (m) => m.code || "", name: (m) => m.name, total: (m) => m.total.count,
    weight: (m) => m.total.weight, time: (m) => m.total.seconds,
  };
  matrix.opNames.forEach((op) => { machineAcc[`op:${op}`] = (m) => m.ops[op]?.count || 0; });

  if (viewMachine) return <MachineScanDetail machine={viewMachine} onBack={() => setViewMachine(null)} />;

  return (
    <div>
      <div className="page-head">
        <div className="page-title">สรุปเครื่องจักร</div>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      <Card title="ปริมาณงานที่แต่ละเครื่องประมวลผล">
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          นับตามจำนวนชิ้นที่ทำในแต่ละขั้นตอน — ชิ้นเดียวที่ผ่านหลายเครื่องจะถูกนับที่ทุกเครื่องที่ทำ (งานหน้าเครื่องนับตามจำนวนที่กรอก)
          <br />{lang === "en" ? "Tip: click a machine row to see all its scans (with date · time)." : "เคล็ดลับ: แตะแถวเครื่องเพื่อดูการสแกนทั้งหมดของเครื่องนั้น (พร้อมวัน · เวลา)"}
        </div>
        <div style={{ marginBottom: 16 }}>
          <SimpleBarChart data={rows} color={CHART.success} height={240} />
        </div>
        <DataTable id="machines-summary" wrapClass="table-wrap" tableClass="data-table"
          rows={matrix.machines} rowKey={(m) => m.name} sort={sortW} sortAccessors={machineAcc}
          empty={lang === "en" ? "No scans in this period" : "ยังไม่มีการสแกนในช่วงเวลานี้"}
          rowProps={(m) => ({ className: "release-row", style: { cursor: "pointer" }, onClick: () => setViewMachine({ code: m.code, name: m.name }), title: lang === "en" ? "Click to see all scans of this machine" : "แตะเพื่อดูการสแกนทั้งหมดของเครื่องนี้" })}
          columns={[
            { key: "code", header: "รหัสเครื่อง", sortKey: "code", tdStyle: { fontFamily: "var(--font-mono)", fontWeight: 700 }, cell: (m) => m.code || "—" },
            { key: "name", header: "เครื่องจักร", sortKey: "name", tdStyle: { fontWeight: 600 }, cell: (m) => m.name },
            ...matrix.opNames.map((op) => ({
              key: `op:${op}`, header: opLabel(op, lang), sortKey: `op:${op}`, align: "right",
              cell: (m) => { const cell = m.ops[op]; return cell ? <span>{cell.count} ชิ้น</span> : <span style={{ color: "var(--surface-3)" }}>—</span>; },
            })),
            { key: "total", header: "รวมทุกขั้นตอน", sortKey: "total", align: "right", tdStyle: { fontWeight: 600 }, cell: (m) => `${m.total.count} ชิ้น` },
            { key: "weight", header: "น้ำหนักรวม (กก.)", sortKey: "weight", align: "right", tdStyle: { fontWeight: 600, color: "var(--accent-dk)" }, cell: (m) => m.total.weight ? fmtNum(m.total.weight) : "—" },
            { key: "time", header: "เวลาเดินเครื่อง", sortKey: "time", align: "right", tdStyle: { fontFamily: "var(--font-mono)" }, cell: (m) => m.total.seconds ? fmtHrs(m.total.seconds) : "—" },
          ]} />
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 6.5) PROJECTS — รวม "จัดการ + สรุปความคืบหน้า" ไว้หน้าเดียว (เมนูแรกของขั้นตอนงาน)
// ══════════════════════════════════════════════════════════════════════════
// ─── ดู Release ทั้งหมดในโปรเจคเดียว → เจาะเข้า Release → Part → รายละเอียด ──────
//   ใช้ ReleaseGroupDetail ตัวเดียวกับหน้า Release Production เพื่อให้รายละเอียดเหมือนกัน
function ProjectReleasesView({ project, user, goTo, onBack }) {
  const [groups, setGroups] = useState(null);   // null = กำลังโหลด
  const [stats, setStats] = useState({});       // release_id → { total, finished, ... } (สแกนสำนักงาน)
  const [opProg, setOpProg] = useState({});     // release_id → [{op,seq,done,finished}] (งานหน้าเครื่อง)
  const [statsReady, setStatsReady] = useState(false);
  const [viewGroup, setViewGroup] = useState(null);
  const sort = useTableSort();

  const load = useCallback(async () => {
    const all = await getReleasesFull();
    const mine = all.filter((r) => r.part_master?.project_id === project.id);
    setGroups(groupReleases(mine));
    const ids = mine.map((r) => r.id);
    setStatsReady(false);
    if (ids.length) {
      // โหลดทั้งสแกนสำนักงาน + งานหน้าเครื่อง เพื่อคำนวณ %เสร็จ ให้ตรงกับหน้าอื่น
      Promise.all([getUnitStatsByReleaseIds(ids), getReleaseOpProgressFin(ids)])
        .then(([s, op]) => { setStats(s); setOpProg(op || {}); setStatsReady(true); });
    } else { setStats({}); setOpProg({}); setStatsReady(true); }
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  // เจาะเข้า Release Order → แสดง Part + รายละเอียด (เหมือนหน้า Release Production)
  if (viewGroup) {
    return (
      <ReleaseGroupDetail
        group={viewGroup} user={user} goTo={goTo}
        onBack={() => setViewGroup(null)}
        onHome={onBack}
        onChanged={load}
      />
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <Btn variant="ghost" size="sm" onClick={onBack}><Icon name="arrowLeft" size={14} /> กลับไปหน้า Projects</Btn>
          </div>
          <div className="page-title">{project.code} — {project.name}</div>
          <div className="page-sub">Release ทั้งหมดในโปรเจคนี้ · แตะแถวเพื่อดู Part และรายละเอียด</div>
        </div>
      </div>
      <Card title={groups ? `Release ทั้งหมด (${groups.length})` : "Release ทั้งหมด"}>
        <SortControl sort={sort} options={[
          { k: "date", label: "วันที่" }, { k: "order", label: "Release Order" }, { k: "parts", label: "Part No." },
          { k: "qty", label: "จำนวน" }, { k: "finished", label: "เสร็จแล้ว" }, { k: "progress", label: "ความคืบหน้า" }, { k: "weight", label: "น้ำหนักรวม" },
        ]} />
        {groups === null ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <Icon name="box" size={32} />
            <div className="empty-state-title">ยังไม่มี Release ในโปรเจคนี้</div>
            <div className="empty-state-sub">ปล่อยงานที่หน้า Release Production เพื่อสร้าง Release แรก</div>
          </div>
        ) : (
          <DataTable id="project-releases" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
            rows={groups} rowKey={(g) => g.key} sort={sort}
            sortAccessors={{
              date: (g) => new Date(g.date).getTime() || 0,
              order: (g) => g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? ""),
              parts: (g) => g.releases.length,
              qty: (g) => g.totalQty || 0,
              weight: (g) => g.totalWeight || 0,
              finished: (g) => computeGroupProgress(g.releases, stats, opProg, g.releases.reduce((s, r) => s + (stats[r.id]?.total ?? r.qty), 0)).finished,
              progress: (g) => {
                const t = g.releases.reduce((s, r) => s + (stats[r.id]?.total ?? r.qty), 0);
                return t > 0 ? computeGroupProgress(g.releases, stats, opProg, t).finished / t : 0;
              },
            }}
            rowCtx={(g) => {
              const gTotal = g.releases.reduce((s, r) => s + (stats[r.id]?.total ?? r.qty), 0);
              const { finished: gFinished } = computeGroupProgress(g.releases, stats, opProg, gTotal);
              return { gTotal, gFinished, gPct: gTotal > 0 ? Math.round((gFinished / gTotal) * 100) : null };
            }}
            rowProps={(g) => ({ className: "release-row", onClick: () => setViewGroup(g) })}
            columns={[
              { key: "date", header: "วันที่", sortKey: "date", cell: (g) => fmtD(g.date) },
              { key: "order", header: "Release Order", sortKey: "order", cell: (g) => g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? "-") },
              { key: "parts", header: "Part No.", sortKey: "parts", align: "right", cell: (g) => `${fmtNum(g.releases.length)} Part` },
              { key: "qty", header: "จำนวน", sortKey: "qty", align: "right", cell: (g) => `${fmtNum(g.totalQty)} ชิ้น` },
              { key: "finished", header: "เสร็จแล้ว", sortKey: "finished", align: "right",
                tdProps: (g, i, c) => ({ style: { fontWeight: 700, color: statsReady && c.gFinished > 0 ? "var(--success)" : "var(--muted)" } }),
                cell: (g, i, c) => statsReady ? `${fmtNum(c.gFinished)} ชิ้น` : "—" },
              { key: "progress", header: "ความคืบหน้า", sortKey: "progress", tdStyle: { whiteSpace: "nowrap" },
                cell: (g, i, c) => statsReady && c.gPct !== null ? <ProgressBar pct={c.gPct} finished={c.gFinished} total={c.gTotal} /> : <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span> },
              { key: "weight", header: "น้ำหนักรวม", sortKey: "weight", align: "right", cell: (g) => g.totalWeight ? `${fmtNum(g.totalWeight)} กก.` : "-" },
            ]} />
        )}
      </Card>
    </div>
  );
}

function ProjectsPage({ user, goTo }) {
  const canEdit = canManage(user);
  const [projects, setProjects] = useState([]);   // รายการโปรเจคเต็ม (รวม new ที่ยังไม่มีงาน)
  const [statMap, setStatMap] = useState({});      // id → { total, finished, weight }
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);    // { project, impact }
  const [viewProject, setViewProject] = useState(null); // โปรเจคที่กดเข้าไปดู Release อยู่
  const sort = useTableSort("code");

  const reload = useCallback(async () => {
    setLoading(true);
    const [ps, summary, station] = await Promise.all([
      listRows("projects", { order: "code" }),
      getProjectSummary(),
      getProjectStationProgress(),   // B3: ความคืบหน้าจากงานหน้าเครื่อง
    ]);
    const m = {};
    (summary || []).forEach((s) => { m[s.id] = { ...s }; });
    // merge: "จำนวนเสร็จ" ใช้ค่าที่มากกว่า (สแกนสำนักงาน part_units.status vs งานหน้าเครื่อง)
    // ★ แต่ "น้ำหนักวัสดุ" คงเป็นน้ำหนักรวมทั้งโปรเจค (project_summary) เสมอ — เดิมเอาน้ำหนักงานที่เสร็จหน้าเครื่องมาทับ
    //   ทำให้โปรเจคที่มีงานหน้าเครื่องโชว์น้ำหนักน้อยผิด (เช่น 18,769 ชิ้น แต่ขึ้น 7.89 กก.)
    Object.entries(station || {}).forEach(([pid, st]) => {
      const base = m[pid] || { id: pid, total: 0, finished: 0, weight: 0 };
      const stFin = Number(st?.finished) || 0;
      if (stFin > (Number(base.finished) || 0)) base.finished = stFin;   // เอาเฉพาะจำนวนเสร็จที่มากกว่า · ไม่แตะน้ำหนัก
      m[pid] = base;
    });
    setProjects(ps); setStatMap(m); setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function openEdit(p) {
    if (!canEdit) return;
    const impact = await getProjectImpact(p.id);
    setEditing({ project: p, impact });
  }

  // แอดมินปิด/เปิดโปรเจคได้จากในกล่อง "แก้ไข" (ProjectEditModal) แล้ว — ไม่มีปุ่มแยกในแถว

  // กดเข้าไปดู Release ในโปรเจคนี้ (แล้วเจาะเข้า Part / รายละเอียด ต่อได้)
  if (viewProject) {
    return (
      <ProjectReleasesView
        project={viewProject} user={user} goTo={goTo}
        onBack={() => { setViewProject(null); reload(); }}
      />
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">โปรเจค</div>
          <div className="page-sub">เพิ่ม / แก้ไข / ลบ โปรเจค + ดูความคืบหน้าแยกตามโปรเจค · แตะแถวเพื่อดู Release และ Part ในโปรเจคนั้น</div>
        </div>
        {canEdit && (
          <Btn variant="accent" onClick={() => setShowAdd(true)}><Icon name="folder" size={15} /> เพิ่มโปรเจค</Btn>
        )}
      </div>
      <Card title={`โปรเจคทั้งหมด (${projects.length})`}>
        <SortControl sort={sort} options={[
          { k: "code", label: "รหัส" }, { k: "name", label: "ชื่อโปรเจค" }, { k: "total", label: "ปล่อยงาน" },
          { k: "finished", label: "เสร็จแล้ว" }, { k: "pct", label: "% เสร็จ" }, { k: "weight", label: "น้ำหนักวัสดุ" },
        ]} />
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <Icon name="folder" size={32} />
            <div className="empty-state-title">ยังไม่มีโปรเจค</div>
            <div className="empty-state-sub">กด “เพิ่มโปรเจค” เพื่อสร้างโปรเจคแรก</div>
          </div>
        ) : (
          <DataTable id="projects" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
            rows={projects} rowKey={(p) => p.id} sort={sort}
            sortAccessors={{
              code: (p) => p.code, name: (p) => p.name,
              total: (p) => statMap[p.id]?.total || 0,
              finished: (p) => statMap[p.id]?.finished || 0,
              pct: (p) => { const s = statMap[p.id]; return s?.total ? s.finished / s.total : 0; },
              weight: (p) => statMap[p.id]?.weight || 0,
            }}
            rowCtx={(p) => {
              const s = statMap[p.id] || { total: 0, finished: 0, weight: 0 };
              const done = s.total > 0 && s.finished >= s.total;
              const rawPct = s.total ? (s.finished / s.total) * 100 : 0;
              return { s, done, rawPct, barW: done ? 100 : Math.min(99, rawPct) };
            }}
            rowProps={(p) => ({ className: "release-row", onClick: () => setViewProject(p), title: "กดเพื่อดู Release ในโปรเจคนี้", style: p.status === "closed" ? { opacity: 0.62 } : undefined })}
            columns={[
              { key: "code", header: "รหัส", sortKey: "code", tdStyle: { fontFamily: "var(--font-mono)" },
                cell: (p) => <>{p.code}{p.status === "closed" && <span className="proj-closed-badge">ปิดแล้ว</span>}</> },
              { key: "name", header: "ชื่อโปรเจค", sortKey: "name", cell: (p) => p.name },
              { key: "total", header: "ปล่อยงาน (ชิ้น)", sortKey: "total", align: "right", cell: (p, i, c) => fmtNum(c.s.total) },
              { key: "finished", header: "เสร็จแล้ว", sortKey: "finished", align: "right",
                tdProps: (p, i, c) => ({ style: { fontWeight: 700, color: c.s.finished > 0 ? "var(--success)" : "var(--muted)" } }), cell: (p, i, c) => fmtNum(c.s.finished) },
              { key: "pct", header: "% เสร็จ", sortKey: "pct",
                cell: (p, i, c) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 64, height: 6, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden", flex: "0 0 64px" }}>
                      <div style={{ width: c.barW > 0 ? `max(3px, ${c.barW}%)` : "0%", height: "100%", background: c.done ? "var(--success)" : "var(--accent)" }} />
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}>{pctLabel(c.rawPct, c.done)}</span>
                  </div>
                ) },
              { key: "weight", header: "น้ำหนักวัสดุ (กก.)", sortKey: "weight", align: "right", cell: (p, i, c) => fmtNum(c.s.weight) },
              ...(canEdit ? [{ key: "manage", header: "", dataLabel: "", tdStyle: { textAlign: "right", whiteSpace: "nowrap" },
                cell: (p) => <>{p.status === "closed" && (
                    <span title="โปรเจคนี้ปิดแล้ว — เปิด/แก้ได้ในปุ่มแก้ไข"
                      style={{ fontSize: 11.5, fontWeight: 700, color: "#b45309", background: "#fff4e5", border: "1px solid #f5c98a", borderRadius: 999, padding: "3px 10px", marginRight: 8 }}>ปิดแล้ว</span>
                  )}<Btn variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(p); }}><Icon name="settings" size={13} /> แก้ไข</Btn></> }] : []),
            ]} />
        )}
      </Card>

      {showAdd && (
        <QuickAddProjectModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); reload(); }} />
      )}
      {editing && (
        <ProjectEditModal
          project={editing.project} impact={editing.impact} admin={isAdmin(getSession())} canDelRelease={canManage(getSession())}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
          onDeleted={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 8) PARTS SUMMARY
// ══════════════════════════════════════════════════════════════════════════
function PartsSummaryPage() {
  // รวมยอดฝั่ง DB ผ่าน RPC (เรียงตามจำนวนมาก→น้อยมาจาก DB แล้ว) — แก้ H6
  const [rows, setRows] = useState([]);
  const sort = useTableSort();
  useEffect(() => { getPartSummary().then(setRows); }, []);
  return (
    <div>
      <div className="page-head"><div className="page-title">สรุป Part</div></div>
      <Card title="สรุปแยกตามชนิด Part (สะสมทั้งหมด)">
        <SortControl sort={sort} options={[
          { k: "part_no", label: "Part No." }, { k: "part_name", label: "ชื่อ Part" },
          { k: "total", label: "ปล่อยงาน" }, { k: "finished", label: "เสร็จแล้ว" }, { k: "weight", label: "น้ำหนักวัสดุ" },
        ]} />
        <DataTable id="parts-summary" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
          rows={rows} rowKey={(r) => r.id} sort={sort}
          sortAccessors={{
            part_no: (r) => r.part_no || "", part_name: (r) => r.part_name || "",
            total: (r) => Number(r.total) || 0, finished: (r) => Number(r.finished) || 0, weight: (r) => Number(r.weight) || 0,
          }}
          empty={
            <div className="empty-state" style={{ padding: "24px 0" }}>
              <Icon name="grid" size={30} />
              <div className="empty-state-title">ยังไม่มีข้อมูลการปล่อยงาน</div>
              <div className="empty-state-sub">เมื่อมีการปล่อยงาน/สแกน จะเห็นสรุปแยกตาม Part ที่นี่</div>
            </div>
          }
          columns={[
            { key: "part_no", header: "Part No.", sortKey: "part_no", tdStyle: { whiteSpace: "nowrap" }, cell: (r) => r.part_no },
            { key: "part_name", header: "ชื่อ Part", sortKey: "part_name", tdStyle: { whiteSpace: "nowrap" }, cell: (r) => r.part_name },
            { key: "total", header: "ปล่อยงาน", sortKey: "total", align: "right", cell: (r) => fmtNum(r.total) },
            { key: "finished", header: "เสร็จแล้ว", sortKey: "finished", align: "right",
              tdProps: (r) => ({ style: { fontWeight: 600, color: r.finished > 0 ? "var(--success)" : "var(--muted)" } }), cell: (r) => fmtNum(r.finished) },
            { key: "weight", header: "น้ำหนักวัสดุ (กก.)", sortKey: "weight", align: "right", cell: (r) => fmtNum(r.weight) },
          ]} />
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 9) SETUP
// ══════════════════════════════════════════════════════════════════════════
// ─── Projects: เพิ่ม/แก้ไข/ลบ พร้อมเช็คผลกระทบก่อนลบ (มี Part/Release/QR อยู่ใต้โปรเจคไหม) ──
function ProjectEditModal({ project, impact, onClose, onSaved, onDeleted, admin, canDelRelease }) {
  const [code, setCode] = useState(project.code);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rels, setRels] = useState(null);   // รายการ Release ในโปรเจคนี้
  const [delKey, setDelKey] = useState(null);   // Release Order ที่กำลังลบ (โชว์ progress)
  const [delProg, setDelProg] = useState(0);
  useEffect(() => {
    getReleasesFull().then((all) => setRels(all.filter((r) => r.part_master?.project_id === project.id)));
  }, [project.id]);

  // ลบ Release Order ทั้งชุด (ทุก Part ในเลขที่นั้น) — ใช้ deleteReleaseCascade ต่อ release (ลบ QR+ประวัติสแกนด้วย) แบบขนานจำกัด
  async function deleteOrder(g) {
    if (delKey) return;
    const ok = await askConfirm({
      message: `ลบ Release Order "${g.order}" ทั้งชุด?\n(${g.parts} Part · ${fmtNum(g.qty)} ชิ้น)\n\nจะลบ QR และประวัติสแกนของทุกชิ้นในชุดนี้ไปด้วย · กู้คืนไม่ได้`,
      tone: "danger", confirmText: "ลบ Release", cancelText: "ยกเลิก",
    });
    if (!ok) return;
    setDelKey(g.key); setDelProg(0); setErr("");
    const ids = [...g.ids];
    let done = 0, failed = 0, firstErr = null;
    const CONC = 5;   // ลบทีละ 5 (release คนละล็อต ไม่ชนกัน) — เร็วขึ้นแต่ไม่ถล่ม DB
    for (let i = 0; i < ids.length; i += CONC) {
      const res = await Promise.allSettled(ids.slice(i, i + CONC).map((id) => deleteReleaseCascade(id)));
      res.forEach((x) => { if (x.status === "fulfilled") { done += 1; } else { failed += 1; if (!firstErr) firstErr = x.reason; } });
      setDelProg(done + failed);
      if (firstErr && done === 0 && failed >= ids.slice(0, i + CONC).length) break;   // พลาดทั้งหมดตั้งแต่ต้น (เช่นสิทธิ์ไม่พอ) → หยุด ไม่ต้องยิงต่อ
    }
    auditRecord("delete_release", "release", project.id, { release_order: g.order, parts: g.parts, deleted: done, failed, project: project.code });
    try { const all = await getReleasesFull(); setRels(all.filter((r) => r.part_master?.project_id === project.id)); } catch { /* ignore */ }
    setDelKey(null);
    if (failed > 0) {
      const em = String(firstErr?.message || firstErr || "");
      const forbidden = /forbidden|unauthor|permission|denied|not allowed|สิทธิ/i.test(em);
      setErr(forbidden
        ? `บัญชีนี้ยังไม่มีสิทธิ์ลบ Release ฝั่งเซิร์ฟเวอร์ (RPC จำกัดเฉพาะแอดมิน) — แจ้งผู้ดูแลให้เปิดสิทธิ์ให้ออฟฟิศ`
        : `ลบไม่ครบ — สำเร็จ ${done} · ไม่สำเร็จ ${failed} · ลองอีกครั้งได้`);
      mlsToast(forbidden ? "ออฟฟิศยังไม่มีสิทธิ์ลบ Release (ต้องปรับ RPC)" : `ลบ ${g.order}: สำเร็จ ${done} · พลาด ${failed}`, "warn");
    } else mlsToast(`ลบ Release Order "${g.order}" แล้ว (${done} รายการ)`, "success");
  }

  async function save() {
    const c = code.trim(), n = name.trim();
    if (!c || !n) { setErr("กรอกรหัสและชื่อโปรเจคให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      await updateRow("projects", project.id, { code: c, name: n });
      onSaved();
    } catch (e) {
      setErr(isDuplicateError(e) ? `รหัสโปรเจค "${c}" มีอยู่แล้ว กรุณาใช้รหัสอื่น` : "บันทึกไม่สำเร็จ: " + e.message);
    }
    setBusy(false);
  }

  // ปิด/เปิดโปรเจค (admin) — ย้ายมาจากปุ่มในแถวหน้า "โปรเจค" · ปิดแล้วหน้าเครื่องบันทึกงานเพิ่มไม่ได้
  async function toggleStatus() {
    const closing = project.status !== "closed";
    if (closing && !(await askConfirm({
      message: `ปิดโปรเจค "${project.code} — ${project.name}"?\nหน้าเครื่องจะบันทึกงานเพิ่มไม่ได้ จนกว่าจะเปิดใหม่`,
      tone: "warn", confirmText: "ปิดโปรเจค", cancelText: "ยกเลิก",
    }))) return;
    setBusy(true); setErr("");
    try {
      await updateRow("projects", project.id, { status: closing ? "closed" : "active" });
      auditRecord(closing ? "close_project" : "reopen_project", "project", project.id, { code: project.code, name: project.name });
      mlsToast(closing ? "ปิดโปรเจคแล้ว" : "เปิดโปรเจคอีกครั้งแล้ว", "success");
      onSaved();   // ปิดกล่อง + รีโหลดรายการให้เห็นสถานะใหม่
    } catch (e) {
      setErr("เปลี่ยนสถานะไม่สำเร็จ: " + (e?.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    const hasData = impact.partCount > 0;
    const msg = impact.scannedCount > 0
      ? `โปรเจคนี้มี ${impact.partCount} Part, ${impact.releaseCount} Release, ${impact.unitCount} ชิ้น (QR) และมี ${impact.scannedCount} ชิ้นที่สแกนไปแล้ว (มีประวัติการทำงาน)\n\nการลบโปรเจคจะลบข้อมูลทั้งหมดนี้ทิ้งไปด้วย และกู้คืนไม่ได้\n\nพิมพ์รหัสโปรเจค "${project.code}" เพื่อยืนยันการลบ`
      : hasData
      ? `โปรเจคนี้มี ${impact.partCount} Part และ ${impact.unitCount} ชิ้น (QR) แต่ยังไม่มีการสแกน\n\nต้องการลบโปรเจคนี้พร้อมข้อมูลทั้งหมดหรือไม่? การลบกู้คืนไม่ได้`
      : `ต้องการลบโปรเจค "${project.code} — ${project.name}" หรือไม่?`;

    if (impact.scannedCount > 0) {
      const typed = prompt(msg);
      if (typed !== project.code) { if (typed !== null) mlsToast("รหัสโปรเจคไม่ตรง ยกเลิกการลบ", "warn"); return; }
    } else if (!(await askConfirm({ message: msg, tone: "danger", confirmText: "ลบโปรเจค", cancelText: "ยกเลิก" }))) {
      return;
    }

    setBusy(true); setErr("");
    try {
      await deleteProjectCascade(project.id);
      auditRecord("delete_project", "project", project.id, { code: project.code, name: project.name });
      onDeleted();
    } catch (e) {
      setErr("ลบไม่สำเร็จ: " + e.message);
      setBusy(false);
    }
  }

  return (
    <Modal wide title="แก้ไขโปรเจค" sub={`สร้างเมื่อ ${fmtDT(project.created_at)}`} onClose={onClose} locked={!!delKey}>
      <div className="grid-2">
        <Field label="รหัสโปรเจค *"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="ชื่อโปรเจค *"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        ใต้โปรเจคนี้มี {impact.partCount} Part · {impact.releaseCount} Release · {impact.unitCount} ชิ้น (QR)
        {impact.scannedCount > 0 && <> · สแกนไปแล้ว {impact.scannedCount} ชิ้น</>}
      </div>

      {/* ปิด/เปิดโปรเจค (แอดมิน) — ย้ายมาจากปุ่มในแถว */}
      {admin && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "10px 12px", marginBottom: 12, borderRadius: 8,
          background: project.status === "closed" ? "#fff4e5" : "var(--surface-2, #f3f6f4)",
          border: `1px solid ${project.status === "closed" ? "#f5c98a" : "var(--border)"}` }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            {project.status === "closed"
              ? <>สถานะ: <b style={{ color: "#b45309" }}>ปิดแล้ว (เสร็จ)</b><br /><span style={{ color: "var(--muted)" }}>หน้าเครื่องบันทึกงานเพิ่มไม่ได้</span></>
              : <>สถานะ: <b style={{ color: "var(--success, #0a7)" }}>กำลังทำ</b><br /><span style={{ color: "var(--muted)" }}>ปิดเมื่อทำเสร็จ เพื่อกันบันทึกงานเพิ่ม</span></>}
          </div>
          <Btn type="button" variant="ghost" size="sm" disabled={busy} onClick={toggleStatus}>
            {project.status === "closed"
              ? <><Icon name="refresh" size={13} /> เปิดโปรเจคอีกครั้ง</>
              : <><Icon name="check" size={13} /> ปิดโปรเจค (เสร็จ)</>}
          </Btn>
        </div>
      )}

      {/* รายการ Release ในโปรเจคนี้ — รวมเป็น 1 Release Order ต่อ 1 แถว */}
      {(() => {
        let orders = null;
        if (rels) {
          const map = new Map();
          for (const r of rels) {
            const key = r.release_order || `__${r.id}`;   // ไม่มีเลขที่ → แยกแถวของตัวเอง
            const g = map.get(key) || { order: r.release_order || "-", date: r.release_date, parts: 0, qty: 0, ids: [], key };
            g.parts += 1; g.qty += Number(r.qty) || 0; g.ids.push(r.id);   // เก็บ release id ไว้ลบทั้งชุด
            if (new Date(r.release_date) > new Date(g.date)) g.date = r.release_date;
            map.set(key, g);
          }
          orders = Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
        }
        return (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
              Release ในโปรเจคนี้{orders ? ` (${orders.length})` : ""}
            </div>
            {orders === null ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>กำลังโหลด...</div>
            ) : orders.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>ยังไม่มี Release</div>
            ) : (
              <DataTable id="project-impact" wrapClass="table-wrap" wrapStyle={{ maxHeight: 190, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}
                tableClass="data-table" tableStyle={{ fontSize: 12.5 }} rows={orders} rowKey={(g, i) => i}
                columns={[
                  { key: "date", header: "วันที่", cell: (g) => fmtD(g.date) },
                  { key: "order", header: "Release Order", cell: (g) => g.order },
                  { key: "parts", header: "Part No.", align: "right", cell: (g) => `${g.parts} Part` },
                  { key: "qty", header: "จำนวนรวม", align: "right", cell: (g) => `${fmtNum(g.qty)} ชิ้น` },
                  ...(canDelRelease ? [{ key: "manage", header: "", dataLabel: "", tdStyle: { whiteSpace: "nowrap", textAlign: "right" },
                    cell: (g) => delKey === g.key
                      ? <span style={{ fontSize: 11.5, color: "var(--muted)" }}>กำลังลบ {delProg}/{g.ids.length}…</span>
                      : <span onClick={() => deleteOrder(g)} title="ลบ Release Order นี้ทั้งชุด" style={{ color: "var(--danger-hi)", cursor: delKey ? "default" : "pointer", opacity: delKey ? 0.4 : 1 }}>ลบ</span> }] : []),
                ]} />
            )}
          </div>
        );
      })()}
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <div className="modal-actions" style={{ justifyContent: "space-between" }}>
        {admin ? (
          <Btn type="button" variant="danger" size="sm" onClick={remove} disabled={busy || !!delKey}>
            <Icon name="trash" size={13} /> ลบโปรเจคนี้
          </Btn>
        ) : <span />}
        <div style={{ display: "flex", gap: 8 }}>
          <Btn type="button" variant="ghost" onClick={onClose} disabled={busy || !!delKey}>ยกเลิก</Btn>
          <Btn type="button" variant="accent" onClick={save} disabled={busy || !!delKey}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// (ProjectCrud ถูกลบ — เป็นโค้ดตาย: SetupPage ไม่มีแท็บ "projects" · การจัดการโปรเจคอยู่ที่หน้า "โปรเจค" (ProjectsPage) แล้ว)

// ─── ล้างข้อมูลสแกน (admin): ทั้ง Release / ราย Part / รายชิ้น — ลบบันทึกงาน + รีเซ็ตสถานะ ───
// ─── ผู้ใช้ที่กำลังล็อกอินอยู่ + บังคับออกจากระบบ (เฉพาะ Admin) ───────────────────
function ActiveSessionsCard() {
  const [rows, setRows] = useState(null);   // null = loading
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");     // sid ที่กำลังเตะ
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const data = await listActiveSessions();
      setRows(Array.isArray(data) ? data : []);
      setErr("");
    } catch (e) {
      setErr("โหลดรายชื่อไม่สำเร็จ: " + (e?.message || e));
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // รีเฟรชอัตโนมัติทุก 30 วิ (สถานะออนไลน์เปลี่ยนตาม heartbeat) + เดินนาฬิกา "ใช้งานล่าสุด"
  useEffect(() => {
    const t1 = setInterval(load, 30000);
    const t2 = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [load]);

  function ago(iso) {
    if (!iso) return "-";
    const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
    if (s < 45) return "เมื่อสักครู่";
    const m = Math.floor(s / 60);
    if (m < 1) return "เมื่อสักครู่";
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ชม.ที่แล้ว`;
    return `${Math.floor(h / 24)} วันที่แล้ว`;
  }

  async function kick(row) {
    if (row.is_self) return;
    const who = `${row.code || "-"}${row.name ? " — " + row.name : ""}`;
    if (!(await askConfirm({ message: `บังคับ "${who}" ออกจากระบบ?\n\nเครื่องนั้นจะซิงค์งานที่ค้างให้เสร็จก่อน แล้วเด้งออกเอง (ข้อมูลไม่หาย) — ต้องล็อกอินใหม่ถึงจะใช้ต่อได้`, tone: "warn", confirmText: "บังคับออก", cancelText: "ยกเลิก" }))) return;
    setBusy(row.sid); setMsg("");
    try {
      const res = await forceLogoutSession(row.sid);
      if (res?.ok) {
        auditRecord("force_logout", "session", row.sid, { code: row.code, name: row.name, machine: row.machine_code });
        setMsg(`บังคับ ${who} ออกจากระบบแล้ว — เครื่องนั้นจะเด้งออกภายใน 1 นาที`);
        mlsToast("บังคับออกจากระบบแล้ว", "success");
        await load();
      } else if (res?.reason === "self") {
        mlsToast("เตะเครื่องที่กำลังใช้อยู่ไม่ได้", "warn");
      } else {
        mlsToast("เครื่องนั้นออกไปแล้ว หรือไม่พบเซสชัน", "warn");
        await load();
      }
    } catch (e) {
      setErr("บังคับออกไม่สำเร็จ: " + (e?.message || e));
    } finally { setBusy(""); }
  }

  const online = (rows || []).filter((r) => r.online).length;

  return (
    <Card
      title="ผู้ใช้ที่กำลังใช้งาน (เฉพาะ Admin)"
      right={<Btn variant="ghost" size="sm" onClick={load} disabled={rows === null}>รีเฟรช</Btn>}
    >
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
        รายชื่อบัญชีที่ยัง “ถือเซสชันอยู่” (ยังไม่หมดอายุ/ยังไม่ถูกตัด) · จุดเขียว = กำลังออนไลน์ (มีสัญญาณใน 3 นาที) ·
        กด <b>บังคับออกจากระบบ</b> เพื่อเตะเครื่องนั้น — เครื่องนั้นจะซิงค์งานค้างให้เสร็จก่อนแล้วเด้งออกเอง <b>(ข้อมูลไม่หาย)</b>
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--accent-dk, #0a7)" }}>✓ {msg}</div>}
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>{err}</div>}

      {rows === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <Icon name="user" size={30} />
          <div className="empty-state-title">ยังไม่มีใครล็อกอินอยู่</div>
          <div className="empty-state-sub">เมื่อมีเครื่อง/บัญชีเข้าใช้งาน จะแสดงที่นี่</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
            ทั้งหมด <b>{rows.length}</b> เซสชัน · ออนไลน์ตอนนี้ <b style={{ color: "var(--accent-dk)" }}>{online}</b>
          </div>
          <DataTable id="sessions" wrapClass="table-wrap" tableClass="data-table" rows={rows} rowKey={(r) => r.sid}
            columns={[
              { key: "status", header: "สถานะ", thStyle: { width: 44 },
                cell: (r) => <span title={r.online ? "ออนไลน์" : "เงียบ (แท็บปิด/ออฟไลน์)"} style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: r.online ? "var(--success, #22c55e)" : "var(--border, #cbd5d1)", boxShadow: r.online ? "0 0 0 3px rgba(34,197,94,.18)" : "none" }} /> },
              { key: "account", header: "บัญชี", tdStyle: { whiteSpace: "nowrap" },
                cell: (r) => <><span style={{ fontWeight: 600 }}>{r.code || "-"}</span>{r.name ? <span style={{ color: "var(--muted)" }}> — {r.name}</span> : null}{r.is_self && <> <Badge tone="steel">เครื่องนี้</Badge></>}</> },
              { key: "role", header: "บทบาท", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5, color: "var(--muted)" }, cell: (r) => ROLE_LABELS[r.role] || r.role || "-" },
              { key: "machine", header: "เครื่อง", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5 }, cell: (r) => r.is_machine ? `${r.machine_code || "-"}${r.machine_name ? " — " + r.machine_name : ""}` : <span style={{ color: "var(--muted)" }}>—</span> },
              { key: "lastseen", header: "ใช้งานล่าสุด", tdProps: (r) => ({ style: { whiteSpace: "nowrap", fontSize: 12.5, color: r.online ? "var(--text)" : "var(--muted)" } }), cell: (r) => ago(r.last_seen) },
              { key: "manage", header: "", dataLabel: "", tdStyle: { textAlign: "right" },
                cell: (r) => <Btn variant="danger" size="sm" disabled={r.is_self || busy === r.sid} onClick={() => kick(r)}>{busy === r.sid ? "กำลังเตะ..." : "บังคับออกจากระบบ"}</Btn> },
            ]} />
        </>
      )}
    </Card>
  );
}

// ─── งานค้างซิงค์ราย "เครื่อง" (dead-letter) — ทำแล้วแต่เข้าระบบไม่ได้ (เฉพาะ Admin) ───
const DL_REASONS = {
  not_found: "QR/ล็อตถูกลบหรือแก้",
  project_closed: "โปรเจคถูกปิด",
  retry_exhausted: "ลองซิงค์หลายครั้งไม่สำเร็จ",
};
function DeadLetterCard() {
  const [rows, setRows] = useState(null);   // null = loading
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    try { setRows(await listDeadLetter(false)); setErr(""); }
    catch (e) { setErr("โหลดไม่สำเร็จ: " + (e?.message || e)); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resolve(id) {
    setBusy(id);
    try { await resolveDeadLetter(id); setRows((prev) => prev.filter((r) => r.id !== id)); }
    catch (e) { setErr("ทำเครื่องหมายไม่สำเร็จ: " + (e?.message || e)); }
    finally { setBusy(0); }
  }

  function itemText(r) {
    if (r.kind === "qr" || r.qr) return `QR ${r.qr || "-"}`;
    const d = r.detail || {};
    return "งานหน้าเครื่อง" + (d.quantity != null ? ` · ${fmtNum(d.quantity)} ชิ้น` : "");
  }

  return (
    <Card title="งานค้างซิงค์ (stranded) — เฉพาะ Admin" right={<Btn variant="ghost" size="sm" onClick={load} disabled={rows === null}>รีเฟรช</Btn>}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
        งานที่ทำหน้าเครื่อง (ตอนออฟไลน์) แล้ว <b>ซิงค์เข้าระบบไม่ได้ถาวร</b> — มักเพราะ QR/ล็อตถูกลบหรือแก้ฝั่งออฟฟิศ · แก้ต้นเหตุ (เช่นกู้ล็อตคืน) แล้วให้เครื่องนั้นกด “ลองซิงค์ใหม่” ในแถบงานค้าง · เคลียร์แล้วกด ✓ จัดการแล้ว
      </div>
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {rows === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <Icon name="check" size={30} />
          <div className="empty-state-title">ไม่มีงานค้างซิงค์</div>
          <div className="empty-state-sub">ทุกเครื่องซิงค์งานเข้าระบบครบ</div>
        </div>
      ) : (
        <DataTable id="deadletter" wrapClass="table-wrap tall-scroll" tableClass="data-table" rows={rows} rowKey={(r) => r.id}
          columns={[
            { key: "time", header: "เวลาทำงาน", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5, color: "var(--muted)" }, cell: (r) => fmtDT(r.client_ts || r.reported_at) },
            { key: "machine", header: "เครื่อง", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5 }, cell: (r) => r.machine_code || "-" },
            { key: "actor", header: "ผู้ทำ", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5 }, cell: (r) => r.actor_code || "-" },
            { key: "item", header: "งาน", tdStyle: { fontSize: 12.5 }, cell: (r) => itemText(r) },
            { key: "reason", header: "เหตุผล", cell: (r) => <Badge tone="danger">{DL_REASONS[r.reason] || r.reason || "-"}</Badge> },
            { key: "manage", header: "", dataLabel: "", tdStyle: { textAlign: "right" },
              cell: (r) => <Btn variant="ghost" size="sm" disabled={busy === r.id} onClick={() => resolve(r.id)}>{busy === r.id ? "..." : "✓ จัดการแล้ว"}</Btn> },
          ]} />
      )}
    </Card>
  );
}

// ─── ประวัติการแก้ไข (audit log) — ใครทำอะไรที่สำคัญ/ลบข้อมูลได้ (เฉพาะ Admin) ───
const AUDIT_ACTIONS = {
  delete_project:      { label: "ลบโปรเจค", tone: "danger" },
  delete_release:      { label: "ลบ Release", tone: "danger" },
  delete_employee:     { label: "ลบพนักงาน", tone: "danger" },
  delete_machine:      { label: "ลบเครื่องจักร", tone: "danger" },
  clear_scans:         { label: "ล้างข้อมูลสแกน", tone: "danger" },
  restore_backup:      { label: "กู้คืน Backup", tone: "warning" },
  force_logout:        { label: "บังคับออกจากระบบ", tone: "warning" },
  edit_release_header: { label: "แก้หัวเอกสาร Release", tone: "steel" },
  close_project:       { label: "ปิดโปรเจค", tone: "muted" },
  reopen_project:      { label: "เปิดโปรเจค", tone: "muted" },
};

function auditDetailText(row) {
  const d = row.detail || {};
  const parts = [];
  if (d.code || d.name) parts.push([d.code, d.name].filter(Boolean).join(" — "));
  if (d.part_no) parts.push(`Part ${d.part_no}`);
  if (d.release_order) parts.push(d.release_order);
  if (d.project && !d.code) parts.push(`โปรเจค ${d.project}`);
  if (d.parts != null) parts.push(`${fmtNum(d.parts)} Part`);
  if (d.qty != null) parts.push(`${fmtNum(d.qty)} ชิ้น`);
  if (d.scope) parts.push(`ขอบเขต: ${d.scope}`);
  if (d.machine_records != null) parts.push(`บันทึกหน้าเครื่อง ${fmtNum(d.machine_records)}`);
  if (d.records != null) parts.push(`ประวัติ ${fmtNum(d.records)} รายการ`);
  if (d.mode) parts.push(`โหมด ${d.mode}`);
  if (d.mdf != null) parts.push(`Modify ${d.mdf}`);
  if (d.date) parts.push(`วันที่ ${d.date}`);
  if (d.machine) parts.push(`เครื่อง ${d.machine}`);
  return parts.join(" · ") || (row.entity_id ? `id ${String(row.entity_id).slice(0, 8)}` : "—");
}

function AuditLogCard() {
  const [rows, setRows] = useState(null);   // null = loading
  const [err, setErr] = useState("");
  const [canMore, setCanMore] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    try { const r = await listAuditLog({ limit: 200 }); setRows(r); setCanMore(r.length >= 200); setErr(""); }
    catch (e) { setErr("โหลดไม่สำเร็จ: " + (e?.message || e)); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    if (!rows || rows.length === 0) return;
    setMore(true);
    try {
      const before = rows[rows.length - 1].created_at;
      const next = await listAuditLog({ limit: 200, before });
      setRows((prev) => [...prev, ...next]);
      setCanMore(next.length >= 200);
    } catch (e) { setErr("โหลดเพิ่มไม่สำเร็จ: " + (e?.message || e)); }
    finally { setMore(false); }
  }

  return (
    <Card title="ประวัติการแก้ไข (เฉพาะ Admin)" right={<Btn variant="ghost" size="sm" onClick={load} disabled={rows === null}>รีเฟรช</Btn>}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
        บันทึกการกระทำสำคัญ/ที่ลบข้อมูลได้ — ใครทำ อะไร เมื่อไหร่ (ลบโปรเจค/Release, ล้างสแกน, บังคับออกจากระบบ, แก้หัวเอกสาร, ปิด/เปิดโปรเจค, กู้คืน)
      </div>
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {rows === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <Icon name="clock" size={30} />
          <div className="empty-state-title">ยังไม่มีประวัติ</div>
          <div className="empty-state-sub">เมื่อมีการลบ/แก้/กู้คืนข้อมูลสำคัญ จะบันทึกที่นี่</div>
        </div>
      ) : (
        <>
          <DataTable id="audit" wrapClass="table-wrap tall-scroll" tableClass="data-table" rows={rows} rowKey={(r) => r.id}
            columns={[
              { key: "time", header: "เวลา", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5, color: "var(--muted)" }, cell: (r) => fmtDT(r.created_at) },
              { key: "actor", header: "ผู้ทำ", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5 }, cell: (r) => <>{r.actor_code || "-"}{r.actor_name ? <span style={{ color: "var(--muted)" }}> — {r.actor_name}</span> : null}</> },
              { key: "action", header: "การกระทำ", tdStyle: { whiteSpace: "nowrap" }, cell: (r) => { const a = AUDIT_ACTIONS[r.action] || { label: r.action, tone: "muted" }; return <Badge tone={a.tone}>{a.label}</Badge>; } },
              { key: "detail", header: "รายละเอียด", tdStyle: { fontSize: 12.5 }, cell: (r) => auditDetailText(r) },
            ]} />
          {canMore && (
            <div style={{ marginTop: 10 }}>
              <Btn variant="ghost" size="sm" onClick={loadMore} disabled={more}>{more ? "กำลังโหลด..." : "โหลดเพิ่ม"}</Btn>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ClearScansCard() {
  const [releases, setReleases] = useState([]);
  const [projId, setProjId] = useState("");
  const [scope, setScope] = useState("project");   // project (ทั้งโปรเจค) | group (ชุด Release) | part | unit (QR)
  const [grpKey, setGrpKey] = useState("");         // index (string) ใน groups
  const [relId, setRelId] = useState("");
  const [qr, setQr] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState(null);
  const [scanned, setScanned] = useState(null);   // Set ของ release_id ที่มีข้อมูลสแกน (null=ยังไม่โหลด)
  useEffect(() => { getReleasesFull().then(setReleases); }, []);

  // โปรเจค (dedupe จาก releases) — ที่ยังทำอยู่ขึ้นก่อน · ปิดแล้วไว้ท้าย (ลิสต์สั้น เลือกง่าย)
  const projects = useMemo(() => {
    const m = new Map();
    for (const r of releases) {
      const pid = r.part_master?.project_id; if (!pid) continue;
      const p = m.get(pid) || {
        id: pid, name: r.part_master?.projects?.name || "-",
        code: r.part_master?.projects?.code || "", status: r.part_master?.projects?.status || "",
        parts: 0, qty: 0,
      };
      p.parts += 1; p.qty += Number(r.qty) || 0; m.set(pid, p);
    }
    return Array.from(m.values()).sort((a, b) =>
      ((a.status === "closed") - (b.status === "closed")) || String(a.name).localeCompare(String(b.name)));
  }, [releases]);

  const proj = projects.find((p) => p.id === projId) || null;
  const projReleases = useMemo(() => releases.filter((r) => r.part_master?.project_id === projId), [releases, projId]);
  // ชุด Release (release_order) ภายในโปรเจคที่เลือก
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of projReleases) {
      const ro = r.release_order || "";
      const g = m.get(ro) || { releaseOrder: r.release_order || null, parts: 0, qty: 0 };
      g.parts += 1; g.qty += Number(r.qty) || 0; m.set(ro, g);
    }
    return Array.from(m.values());
  }, [projReleases]);

  // โหลดว่า release ไหน "มีข้อมูลสแกน" ของโปรเจคที่เลือก (ออฟฟิศ part_units + งานหน้าเครื่อง machine_records)
  useEffect(() => {
    if (!projId) { setScanned(null); return; }
    const ids = projReleases.map((r) => r.id);
    if (!ids.length) { setScanned(new Set()); return; }
    let alive = true;
    Promise.all([getUnitStatsByReleaseIds(ids), getReleaseOpProgress(ids)])
      .then(([stats, op]) => {
        if (!alive) return;
        const s = new Set();
        for (const id of ids) {
          const us = stats[id];
          const hasOffice = us && ((Number(us.finished) || 0) > 0 || (Number(us.inProgress) || 0) > 0);
          const ops = op[id] || [];
          const hasTerm = Array.isArray(ops) && ops.some((o) => (Number(o.done) || 0) > 0);
          if (hasOffice || hasTerm) s.add(id);
        }
        setScanned(s);
      })
      .catch(() => { if (alive) setScanned(new Set()); });
    return () => { alive = false; };
  }, [projId, projReleases]);

  // Part ที่ "มีข้อมูลสแกน" เท่านั้น (ระหว่างโหลด = โชว์ทั้งหมดไปก่อน)
  const scannedReleases = useMemo(
    () => (scanned ? projReleases.filter((r) => scanned.has(r.id)) : projReleases),
    [projReleases, scanned]
  );

  function resetSel() { setPreview(null); setMsg(null); setProgress(""); }
  function pickProject(id) { setProjId(id); setScope("project"); setGrpKey(""); setRelId(""); setQr(""); resetSel(); }

  async function doPreview() {
    setMsg(null); setPreview(null); setProgress(""); setBusy(true);
    try {
      if (scope === "project") {
        if (!projId) { mlsToast("เลือกโปรเจคก่อน", "warn"); return; }
        // รวมผลตรวจของทุกชุดในโปรเจค (แต่ละชุดแยกกันตาม release_order → บวกกันได้)
        let mr = 0, sl = 0, un = 0, rp = 0, i = 0;
        for (const g of groups) {
          i += 1; setProgress(`กำลังตรวจ ${i}/${groups.length}`);
          const p = await clearScansReleaseGroup(projId, g.releaseOrder, { preview: true });
          mr += p.machine_records || 0; sl += p.scan_logs || 0; un += p.units || 0; rp += p.releases || 0;
        }
        setProgress("");
        setPreview({ machine_records: mr, scan_logs: sl, units: un, releases: rp, whole: true });
      } else if (scope === "group") {
        const g = grpKey === "" ? null : groups[Number(grpKey)];   // ★ Number("")===0 → กันเผลอมองว่าเป็นชุดแรก
        if (!g) { mlsToast("เลือกชุด Release ก่อน", "warn"); return; }
        setPreview({ ...(await clearScansReleaseGroup(projId, g.releaseOrder, { preview: true })), grp: g });
      } else if (scope === "part") {
        if (!relId) { mlsToast("เลือก Part ก่อน", "warn"); return; }
        setPreview(await clearScansRelease(relId, { preview: true }));
      } else {
        if (!qr.trim()) { mlsToast("พิมพ์/สแกน QR ก่อน", "warn"); return; }
        const u = await findUnitByQr(qr.trim());
        if (!u) { setMsg({ ok: false, text: "ไม่พบ QR นี้ในระบบ" }); return; }
        setPreview({ ...(await clearScansUnit(u.id, { preview: true })), unit: u });
      }
    } catch (e) { setMsg({ ok: false, text: "ตรวจสอบไม่สำเร็จ: " + (e?.message || e) }); }
    finally { setBusy(false); setProgress(""); }
  }

  async function doClear() {
    const total = (preview?.machine_records || 0) + (preview?.scan_logs || 0);
    const scopeLabel = scope === "project" ? `ทั้งโปรเจค “${proj?.name || ""}”`
      : scope === "group" ? "ชุด Release นี้" : scope === "part" ? "Part นี้" : "ชิ้นนี้";
    if (!(await askConfirm({ message: `ยืนยันลบข้อมูลสแกนของ${scopeLabel} (${total} รายการ)?\nลบแล้วกู้คืนไม่ได้ — แนะนำสำรองข้อมูลก่อน`, tone: "danger", confirmText: "ลบข้อมูลสแกน", cancelText: "ยกเลิก" }))) return;
    setBusy(true); setProgress("");
    let mr = 0, sl = 0, doneGroups = 0;
    try {
      if (scope === "project") {
        for (const g of groups) {
          setProgress(`กำลังลบ ${doneGroups + 1}/${groups.length}`);
          const res = await clearScansReleaseGroup(projId, g.releaseOrder, {});
          mr += res.machine_records || 0; sl += res.scan_logs || 0; doneGroups += 1;
        }
      } else if (scope === "group") {
        const g = grpKey === "" ? null : groups[Number(grpKey)];
        if (!g) { mlsToast("เลือกชุด Release ก่อน", "warn"); return; }
        const res = await clearScansReleaseGroup(projId, g.releaseOrder, {}); mr = res.machine_records || 0; sl = res.scan_logs || 0;
      } else if (scope === "part") {
        const res = await clearScansRelease(relId, {}); mr = res.machine_records || 0; sl = res.scan_logs || 0;
      } else {
        const u = preview?.unit || await findUnitByQr(qr.trim());
        const res = await clearScansUnit(u.id, {}); mr = res.machine_records || 0; sl = res.scan_logs || 0;
      }
      auditRecord("clear_scans", "scan_data", null, { scope, project: projId || null, machine_records: mr, scan_logs: sl });
      setMsg({ ok: true, text: `ลบแล้ว — บันทึกงานหน้าเครื่อง ${fmtNum(mr)} · สแกนสำนักงาน ${fmtNum(sl)} รายการ · รีเซ็ตสถานะชิ้นงานแล้ว` });
      setPreview(null); setGrpKey(""); setRelId(""); setQr(""); setProgress("");
    } catch (e) {
      // ★ whole-project วนลบทีละชุด (ไม่ atomic) — ถ้าพังกลางคัน บอกว่าลบไปแล้วกี่ชุด กด "ลบ" ซ้ำลบต่อได้
      const partial = (scope === "project" && doneGroups > 0)
        ? ` (ลบไปแล้ว ${doneGroups}/${groups.length} ชุด — กด “ลบข้อมูลสแกน” ซ้ำเพื่อลบส่วนที่เหลือ)` : "";
      setMsg({ ok: false, text: "ลบไม่สำเร็จ: " + (e?.message || e) + partial });
    }
    finally { setBusy(false); setProgress(""); }
  }

  const chipCls = (v) => `chip ${scope === v ? "active" : ""}`;
  const totalPrev = preview ? (preview.machine_records || 0) + (preview.scan_logs || 0) : 0;

  return (
    <Card title="ล้างข้อมูลสแกน (เฉพาะ Admin)">
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
        ลบเฉพาะ “ข้อมูลการสแกน/บันทึกงาน” ของขอบเขตที่เลือก แล้วรีเซ็ตสถานะชิ้นงานกลับเป็น “ยังไม่ทำ” — โปรเจค / Release / Part / QR ยังอยู่ครบ · <b style={{ color: "var(--danger, #e11d1d)" }}>ลบแล้วกู้คืนไม่ได้</b> แนะนำสำรองข้อมูลก่อน
      </div>

      <Field label="1) เลือกโปรเจค">
        <SearchSelect value={projId} onChange={(v) => pickProject(v)}
          placeholder="พิมพ์ชื่อ/รหัสโปรเจคเพื่อค้นหา…"
          options={projects.map((p) => ({
            value: p.id,
            label: `${p.name}${p.code ? " (" + p.code + ")" : ""} — ${p.parts} Part × ${fmtNum(p.qty)} ชิ้น${p.status === "closed" ? " · ปิดแล้ว" : ""}`,
          }))} />
      </Field>

      {projId && (
        <>
          <Field label="2) ขอบเขตที่จะลบ">
            <div className="chip-row">
              <span className={chipCls("project")} onClick={() => { setScope("project"); resetSel(); }}>ทั้งโปรเจค</span>
              <span className={chipCls("group")} onClick={() => { setScope("group"); resetSel(); }}>รายชุด Release</span>
              <span className={chipCls("part")} onClick={() => { setScope("part"); resetSel(); }}>ราย Part</span>
              <span className={chipCls("unit")} onClick={() => { setScope("unit"); resetSel(); }}>รายชิ้น (QR)</span>
            </div>
          </Field>

          {scope === "project" && (
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              จะลบข้อมูลสแกนของ <b>ทุก Part / ทุกชุด</b> ในโปรเจคนี้ — {groups.length} ชุด · {proj?.parts || 0} Part × {fmtNum(proj?.qty || 0)} ชิ้น
            </div>
          )}
          {scope === "group" && (
            <Field label="เลือกชุด Release">
              <Select value={grpKey} onChange={(e) => { setGrpKey(e.target.value); setPreview(null); }}
                options={[{ value: "", label: "— เลือกชุด —" }, ...groups.map((g, i) => ({
                  value: String(i), label: `${g.releaseOrder || "(ไม่มีเลข)"} — ${g.parts} Part × ${fmtNum(g.qty)} ชิ้น`,
                }))]} />
            </Field>
          )}
          {scope === "part" && (
            <Field label={`เลือก Part${scanned ? ` (มีข้อมูลสแกน ${scannedReleases.length})` : "…"}`}>
              <SearchSelect value={relId} onChange={(v) => { setRelId(v); setPreview(null); }}
                placeholder="พิมพ์เบอร์พาร์ทเพื่อค้นหา…"
                options={scannedReleases.map((r) => ({
                  value: r.id, label: `${r.part_master?.part_no || "-"}${r.release_order ? " · " + r.release_order : ""} × ${r.qty} ชิ้น`,
                }))} />
              {scanned && scannedReleases.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>ไม่มี Part ที่มีข้อมูลสแกนในโปรเจคนี้</div>
              )}
            </Field>
          )}
          {scope === "unit" && (
            <Field label="รหัส QR ของชิ้นงาน">
              <Input value={qr} onChange={(e) => { setQr(e.target.value); setPreview(null); }} placeholder="สแกน/พิมพ์รหัส QR" />
            </Field>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <Btn variant="ghost" onClick={doPreview} disabled={busy}>ตรวจจำนวนก่อนลบ</Btn>
            {preview && (
              <Btn variant="danger" onClick={doClear} disabled={busy}>ลบข้อมูลสแกน ({fmtNum(totalPrev)} รายการ)</Btn>
            )}
            {progress && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{progress}</span>}
          </div>

          {preview && (
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
              พบ: บันทึกงานหน้าเครื่อง <b>{fmtNum(preview.machine_records || 0)}</b> · สแกนสำนักงาน <b>{fmtNum(preview.scan_logs || 0)}</b>
              {preview.units != null ? <> · รีเซ็ตชิ้นงาน <b>{fmtNum(preview.units)}</b></> : null}
              {preview.releases != null ? <> · ครอบคลุม <b>{fmtNum(preview.releases)}</b> Part</> : null}
              {preview.unit ? <> · ชิ้น {preview.unit.part_master?.part_no || ""} ({preview.unit.qr_code})</> : null}
              {totalPrev === 0 ? <> — <b>ไม่มีข้อมูลสแกนให้ลบ</b></> : null}
            </div>
          )}
        </>
      )}

      {msg && <div style={{ fontSize: 13, fontWeight: 600, marginTop: 12, color: msg.ok ? "var(--accent-dk, #0a7)" : "var(--danger, #e11d1d)" }}>{msg.ok ? "✓ " : "⚠ "}{msg.text}</div>}
    </Card>
  );
}

function SetupPage() {
  const [tab, setTab] = useState(() => {
    if (BOOT_GO.go === "setup-employees" && !BOOT_GO.used) { BOOT_GO.used = true; return "employees"; }   // มาจากหน้าเครื่อง → เปิดแท็บพนักงาน
    return "machines";
  });
  const TABS = [
    { key: "machines", label: "เครื่อง/สถานี" },
    { key: "operations", label: "ขั้นตอน" },
    { key: "parts", label: "Part Master" },
    { key: "employees", label: "พนักงาน" },
    { key: "departments", label: "แผนก" },
    { key: "sessions", label: "ผู้ใช้ออนไลน์" },
    { key: "audit", label: "ประวัติการแก้ไข" },
    { key: "backup", label: "สำรองข้อมูล" },
    { key: "display", label: "คอลัมน์ตาราง" },
  ];
  return (
    <div>
      <div className="page-head"><div className="page-title">ตั้งค่า</div></div>
      <div className="chip-row" style={{ marginBottom: 18 }}>
        {TABS.map((t) => (
          <span key={t.key} className={`chip ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</span>
        ))}
      </div>
      {tab === "machines" && <MachineCrud />}
      {tab === "operations" && <OperationsCrud />}
      {tab === "departments" && <SimpleCrud table="departments" fields={[{ key: "name", label: "ชื่อแผนก" }]} />}
      {tab === "employees" && <EmployeeCrud />}
      {tab === "sessions" && <><ActiveSessionsCard /><DeadLetterCard /></>}
      {tab === "audit" && <AuditLogCard />}
      {tab === "parts" && <PartMasterCrud />}
      {tab === "backup" && <><RestorePointsCard /><BackupCard /><ClearScansCard /></>}
      {tab === "display" && <ColumnLayoutCard />}
    </div>
  );
}

// ─── ลำดับคอลัมน์ในตาราง: ล้างของฉัน · (แอดมิน) ตั้งเป็นค่ากลาง / ล้างค่ากลาง ────────
function ColumnLayoutCard() {
  const [lang] = useLang();
  const L = (th, en) => (lang === "en" ? en : th);
  const admin = isAdmin(getSession());
  const [busy, setBusy] = useState("");
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); _cpSubs.add(fn); return () => { _cpSubs.delete(fn); }; }, []);
  const _cnt = (o) => Object.keys(o || {}).filter((k) => !k.endsWith(COL_HIDE_SUF)).length;
  const _cntHide = (o) => Object.entries(o || {}).filter(([k, v]) => k.endsWith(COL_HIDE_SUF) && Array.isArray(v) && v.length).length;
  const nMine = _cnt(COL_PREFS.user);
  const nCompany = _cnt(COL_PREFS.company);
  const nHideMine = _cntHide(COL_PREFS.user);
  const nHideCompany = _cntHide(COL_PREFS.company);
  async function run(kind) {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === "clearMine") { await clearAllMyColPrefs(); mlsToast(L("ล้างการตั้งค่าคอลัมน์ของฉันแล้ว (ลำดับ + ที่ซ่อนไว้)", "Cleared my column settings (order + hidden)"), "ok"); }
      else if (kind === "publish") { await publishCompanyColPrefs(); mlsToast(L("ตั้งลำดับ + คอลัมน์ที่แสดงปัจจุบันเป็นค่ากลางแล้ว — ทุกเครื่องจะเห็นเหมือนกัน", "Current order + visible columns set as the shared default — every device will match"), "ok"); }
      else if (kind === "clearCompany") {
        const ok = await askConfirm({
          message: L("ล้างค่ากลางของคอลัมน์ทั้งหมด?\n(ทั้งลำดับ และคอลัมน์ที่ซ่อนไว้)\nทุกเครื่องที่ไม่ได้ตั้งเอง จะกลับไปใช้ค่าเริ่มต้น", "Clear all shared column defaults?\n(both order and hidden columns)\nDevices without their own settings go back to the default"),
          tone: "danger", confirmText: L("ล้างค่ากลาง", "Clear shared defaults"), cancelText: L("ยกเลิก", "Cancel"),
        });
        if (!ok) { setBusy(""); return; }
        await clearCompanyColPrefs(); mlsToast(L("ล้างค่ากลางแล้ว", "Shared defaults cleared"), "ok");
      }
    } catch (e) { mlsToast(L("ไม่สำเร็จ: ", "Failed: ") + (e?.message || e), "err"); }
    finally { setBusy(""); }
  }
  return (
    <Card title={L("คอลัมน์ในตาราง (ลำดับ + ซ่อน/แสดง)", "Table columns (order + show/hide)")}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.75 }}>
        {lang === "en" ? (
          <>
            Drag the ⠿ handle on a column header to reorder · <b>right-click the table header</b> (or the ▥ button at the table’s top-right) to <b>show/hide columns</b><br />
            {admin
              ? <>• You are an <b>admin</b> — changes you make become the <b>shared default</b> for every device right away</>
              : <>• Your changes are saved as <b>your own</b> (follows your account on every device)</>}<br />
            Priority: <b>mine</b> first · otherwise the <b>shared default</b> (set by an admin) · otherwise the <b>built-in default</b><br />
            Now: own order <b>{nMine}</b> table(s) · shared <b>{nCompany}</b> · hidden columns: mine <b>{nHideMine}</b> · shared <b>{nHideCompany}</b>
          </>
        ) : (
          <>
            ลากที่จับ ⠿ บนหัวคอลัมน์เพื่อจัดลำดับ · <b>คลิกขวาที่หัวตาราง</b> (หรือปุ่ม ▥ มุมขวาบนของตาราง) เพื่อ <b>ติ๊กเปิด-ปิดคอลัมน์</b><br />
            {admin
              ? <>• คุณเป็น <b>แอดมิน</b> — ลากที่ตารางไหน จะกลายเป็น <b>ค่ากลาง</b> ให้ทุกเครื่องเห็นเหมือนกันทันที</>
              : <>• คุณลากเอง = จำเป็น <b>ของคุณเอง</b> (ตามติดทุกเครื่องที่ล็อกอินบัญชีนี้)</>}<br />
            ลำดับที่ใช้จริง: <b>ของฉัน</b> ก่อน · ถ้าไม่ได้ตั้งเองใช้ <b>ค่ากลาง</b> (ที่แอดมินจัด) · ถ้าไม่มีใช้ <b>ค่าเริ่มต้น</b><br />
            ตอนนี้: ตั้งลำดับเอง <b>{nMine}</b> ตาราง · ค่ากลาง <b>{nCompany}</b> ตาราง · ซ่อนคอลัมน์ไว้: ของฉัน <b>{nHideMine}</b> ตาราง · ค่ากลาง <b>{nHideCompany}</b> ตาราง
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn variant="ghost" onClick={() => run("clearMine")} disabled={!!busy}>{busy === "clearMine" ? L("กำลังล้าง...", "Clearing…") : L("ล้างการตั้งค่าคอลัมน์ของฉัน (ลำดับ + ที่ซ่อนไว้)", "Clear my column settings (order + hidden)")}</Btn>
        {admin && <Btn variant="ghost" onClick={() => run("clearCompany")} disabled={!!busy} style={{ color: "var(--danger-hi)" }}>{busy === "clearCompany" ? L("กำลังล้าง...", "Clearing…") : L("ล้างค่ากลางทั้งหมด (รีเซ็ตทุกตาราง)", "Clear all shared defaults (reset every table)")}</Btn>}
      </div>
    </Card>
  );
}

// ─── ปุ่มลอย "ไปบนสุด" — โผล่เมื่อเลื่อนลง · กดแล้วเลื่อนหน้าขึ้นบนสุด (ทุกหน้าหลังบ้าน) ──
function ScrollTopButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => {                                       // เฉพาะสกอลล์ของ "ทั้งหน้า" (ตารางมีปุ่มขึ้นของตัวเองแยกต่างหาก)
      const se = document.scrollingElement;
      const winY = window.pageYOffset || document.documentElement.scrollTop || (se ? se.scrollTop : 0) || 0;
      setShow(winY > 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });   // ไม่ capture = ไม่จับสกอลล์ในกล่องตาราง
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  const toTop = () => {                                            // เลื่อน "ทั้งหน้า" ขึ้นบนสุด (ไม่ยุ่งกับสกอลล์ในตาราง)
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { try { window.scrollTo(0, 0); } catch { /* ignore */ } }
    try { const el = document.scrollingElement || document.documentElement; if (el && el.scrollTo) el.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* ignore */ }
  };
  return (
    <button type="button" onClick={toTop} aria-label="ไปบนสุด" title="ไปบนสุด"
      style={{ position: "fixed", right: 18, bottom: 18, zIndex: 850, width: 46, height: 46, borderRadius: 12,
        background: "#1f5288", color: "#fff", border: "none", cursor: "pointer",
        boxShadow: "0 6px 18px rgba(0,0,0,.24)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
    </button>
  );
}

// ─── จุดกู้คืนในแอป: ดูสแนปช็อตย้อนหลัง 7 วัน แยกโปรเจค + กดกู้คืนได้เลย ────────
function RestoreModal({ backup, onClose, onDone }) {
  const [mode, setMode] = useState(null);   // 'merge' | 'replace'
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const code = backup.project_code || "";

  async function run() {
    setBusy(true); setErr("");
    try {
      const res = await restoreBackup(backup.id, mode);
      auditRecord("restore_backup", "project", backup.project_id || backup.id, { code: backup.project_code, name: backup.project_name, mode });
      onDone(res, mode);
    } catch (e) {
      setErr("กู้คืนไม่สำเร็จ: " + (e?.message || e));
      setBusy(false);
    }
  }

  return (
    <Modal title="กู้คืนข้อมูลโปรเจค" sub={`${code} — ${backup.project_name || ""} · จุดกู้คืนวันที่ ${fmtDT(backup.taken_at)}`} onClose={onClose} locked={busy}>
      {!mode ? (
        <>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 14 }}>
            เลือกวิธีกู้คืนสำหรับโปรเจคนี้ (สแนปช็อตนี้มี {fmtNum(backup.total_rows)} แถว):
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button onClick={() => setMode("merge")}
              style={{ textAlign: "left", cursor: "pointer", padding: "14px 16px", borderRadius: 10, border: "1px solid var(--border-soft, #e1e9e5)", background: "var(--surface-2, #f6faf8)", fontFamily: "inherit" }}>
              <div style={{ fontWeight: 700, color: "var(--accent-dk)", marginBottom: 4 }}>กู้เฉพาะที่หายไป (แนะนำ)</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
                คืนเฉพาะ Part / Release / QR ที่ถูกลบไป — <b>ข้อมูลเดิมและงานที่สแกนใหม่ทั้งหมดยังอยู่ครบ</b> ไม่ทับข้อมูลปัจจุบัน
              </div>
            </button>
            <button onClick={() => setMode("replace")}
              style={{ textAlign: "left", cursor: "pointer", padding: "14px 16px", borderRadius: 10, border: "1px solid var(--danger-hi, #d64545)", background: "var(--surface-2, #f6faf8)", fontFamily: "inherit" }}>
              <div style={{ fontWeight: 700, color: "var(--danger-hi)", marginBottom: 4 }}>ย้อนทั้งโปรเจคกลับวันนั้น</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
                โครงโปรเจคกลับเป็นสภาพวันนั้นเป๊ะ — <b style={{ color: "var(--danger-hi)" }}>การสแกนที่เกิดหลังวันนั้นบนโปรเจคนี้จะหายไป</b> (ต้องพิมพ์รหัสยืนยัน)
              </div>
            </button>
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <Btn type="button" variant="ghost" onClick={onClose}>ยกเลิก</Btn>
          </div>
        </>
      ) : mode === "merge" ? (
        <>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, marginBottom: 16 }}>
            ยืนยันกู้คืนแบบ <b style={{ color: "var(--accent-dk)" }}>เฉพาะที่หายไป</b> — ระบบจะเติมข้อมูลที่ถูกลบกลับมา
            โดยไม่แตะข้อมูลปัจจุบันและการสแกนใหม่ทั้งหมด
          </div>
          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
          <div className="modal-actions">
            <Btn type="button" variant="ghost" onClick={() => setMode(null)} disabled={busy}>ย้อนกลับ</Btn>
            <Btn type="button" variant="accent" onClick={run} disabled={busy}>{busy ? "กำลังกู้คืน..." : "ยืนยันกู้คืน"}</Btn>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, marginBottom: 8, color: "var(--danger-hi)", fontWeight: 600 }}>
            ⚠ ย้อนทั้งโปรเจคกลับไปวันนั้น — การสแกนที่เกิดหลัง {fmtDT(backup.taken_at)} บนโปรเจคนี้จะหายไปถาวร
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
            พิมพ์รหัสโปรเจค <b style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{code}</b> เพื่อยืนยัน
          </div>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={code} autoFocus />
          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <Btn type="button" variant="ghost" onClick={() => { setMode(null); setConfirmText(""); }} disabled={busy}>ย้อนกลับ</Btn>
            <Btn type="button" variant="accent" onClick={run} disabled={busy || confirmText.trim() !== code}
              style={{ background: confirmText.trim() === code ? "var(--danger-hi)" : undefined, borderColor: "var(--danger-hi)" }}>
              {busy ? "กำลังย้อนข้อมูล..." : "ยืนยันย้อนทั้งโปรเจค"}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function RestorePointsCard() {
  const [rows, setRows] = useState(null);   // null = loading
  const [err, setErr] = useState("");
  const [projFilter, setProjFilter] = useState("");
  const [restoring, setRestoring] = useState(null);   // backup ที่กำลังจะกู้คืน
  const [snapBusy, setSnapBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      await ensureDailyBackup();          // สำรองอัตโนมัติของวันนี้ (ถ้ายังไม่มี)
      setRows(await listBackups());
      setErr("");
    } catch (e) {
      setRows([]);
      setErr("โหลดจุดกู้คืนไม่สำเร็จ — ตรวจว่ารัน migration-project-backups.sql ใน Supabase แล้วหรือยัง (" + (e?.message || e) + ")");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function snapshotNow() {
    setSnapBusy(true); setMsg("");
    try {
      const n = await snapshotAllProjects("manual");
      setMsg(`สร้างจุดกู้คืนแล้ว ${fmtNum(n)} โปรเจค`);
      await load();
    } catch (e) {
      setErr("สร้างจุดกู้คืนไม่สำเร็จ: " + (e?.message || e));
    }
    setSnapBusy(false);
  }

  const projects = rows ? [...new Map(rows.filter(r => r.project_code).map(r => [r.project_code, r.project_name])).entries()] : [];
  const shown = rows ? rows.filter(r => !projFilter || r.project_code === projFilter) : [];

  return (
    <>
      <Card title="จุดกู้คืนในแอป (ย้อนหลัง 7 วัน)">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 14 }}>
          ระบบเก็บ <b>สแนปช็อตอัตโนมัติทุกวัน (เที่ยงคืน)</b> แยกตามโปรเจค เก็บย้อนหลัง 7 วัน — admin กดกู้คืนได้เองในแอป
          โดยเลือกได้ว่าจะ <b>กู้เฉพาะที่หายไป</b> (งานสแกนใหม่ยังอยู่) หรือ <b>ย้อนทั้งโปรเจค</b> กลับไปวันนั้น
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <Btn variant="accent" onClick={snapshotNow} disabled={snapBusy}>
            <Icon name="plus" size={14} />{snapBusy ? "กำลังสร้าง..." : "สร้างจุดกู้คืนตอนนี้"}
          </Btn>
          <Btn variant="ghost" size="sm" onClick={load}><Icon name="refresh" size={13} /> รีเฟรช</Btn>
          {projects.length > 0 && (
            <div style={{ minWidth: 220 }}>
              <Select value={projFilter} onChange={(e) => setProjFilter(e.target.value)}
                options={projects.map(([code, name]) => ({ value: code, label: `${code} — ${name}` }))} />
            </div>
          )}
        </div>

        {msg && <div style={{ color: "var(--success)", fontSize: 13, marginBottom: 10 }}>✓ {msg}</div>}
        {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>{err}</div>}

        {rows === null ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">
            <Icon name="clock" size={30} />
            <div className="empty-state-title">{projFilter ? "โปรเจคนี้ยังไม่มีจุดกู้คืน" : "ยังไม่มีจุดกู้คืน"}</div>
            <div className="empty-state-sub">กด “สร้างจุดกู้คืนตอนนี้” เพื่อสำรองครั้งแรก</div>
          </div>
        ) : (
          <DataTable id="restore-points" wrapClass="table-wrap" tableClass="data-table" rows={shown} rowKey={(b) => b.id}
            columns={[
              { key: "date", header: "วันที่/เวลา", tdStyle: { whiteSpace: "nowrap" }, cell: (b) => fmtDT(b.taken_at) },
              { key: "project", header: "โปรเจค", tdStyle: { whiteSpace: "nowrap" }, cell: (b) => `${b.project_code} — ${b.project_name}` },
              { key: "kind", header: "ชนิด", cell: (b) => (
                <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                  background: b.kind === "auto" ? "var(--surface-3)" : "var(--accent)", color: b.kind === "auto" ? "var(--muted)" : "#fff" }}>
                  {b.kind === "auto" ? "อัตโนมัติ" : "สร้างเอง"}
                </span>
              ) },
              { key: "rows", header: "จำนวนแถว", align: "right", cell: (b) => fmtNum(b.total_rows) },
              { key: "manage", header: "", dataLabel: "", tdStyle: { textAlign: "right" },
                cell: (b) => <Btn variant="ghost" size="sm" onClick={() => setRestoring(b)}><Icon name="refresh" size={13} /> กู้คืน</Btn> },
            ]} />
        )}
      </Card>

      {restoring && (
        <RestoreModal
          backup={restoring}
          onClose={() => setRestoring(null)}
          onDone={(res, mode) => {
            setRestoring(null);
            setMsg(mode === "replace"
              ? "ย้อนทั้งโปรเจคกลับเรียบร้อยแล้ว"
              : "กู้คืนข้อมูลที่หายไปเรียบร้อยแล้ว");
            load();
          }}
        />
      )}
    </>
  );
}

// ─── สำรองข้อมูล: ดาวน์โหลดข้อมูลทุกตารางเป็นไฟล์ JSON เก็บเอง ─────────────────
function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);   // { table, index, total }
  const [last, setLast] = useState(null);           // { at, totalRows, name }
  const [err, setErr] = useState("");
  // นำเข้าไฟล์สำรอง
  const fileRef = useRef(null);
  const [impBusy, setImpBusy] = useState(false);
  const [impErr, setImpErr] = useState("");
  const [impResult, setImpResult] = useState(null); // { inserted, total, name }

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";              // ให้เลือกไฟล์เดิมซ้ำได้
    if (!file) return;
    setImpErr(""); setImpResult(null);
    let dump;
    try {
      dump = JSON.parse(await file.text());
    } catch {
      setImpErr("อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .json ที่ดาวน์โหลดจากปุ่มสำรองข้อมูลเท่านั้น");
      return;
    }
    const tables = dump?.tables;
    if (!tables || typeof tables !== "object") {
      setImpErr("รูปแบบไฟล์ไม่ถูกต้อง (ไม่พบส่วน tables) — ใช้ไฟล์ที่ดาวน์โหลดจากแอปนี้");
      return;
    }
    const rows = Object.values(tables).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
    if (!(await askConfirm({ message: `นำเข้าไฟล์ "${file.name}" (${fmtNum(rows)} แถว)?\n\nระบบจะ "เติมเฉพาะข้อมูลที่หายไป" กลับเข้าระบบ — ของเดิมและงานที่ทำใหม่ทั้งหมดจะไม่ถูกทับ`, tone: "warn", confirmText: "นำเข้า", cancelText: "ยกเลิก" }))) return;

    setImpBusy(true);
    try {
      const res = await importBackup(tables, "merge");
      const inserted = Object.values(res?.inserted || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      setImpResult({ inserted, byTable: res?.inserted || {}, name: file.name });
    } catch (e2) {
      setImpErr("นำเข้าไม่สำเร็จ: " + (e2?.message || e2) + " — ตรวจว่ารัน migration-backup-import.sql ใน Supabase แล้วหรือยัง");
    }
    setImpBusy(false);
  }

  async function download() {
    setBusy(true); setErr(""); setProgress(null);
    try {
      const dump = await exportAllData((p) => setProgress(p));
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const name = `mls-backup-${stamp}.json`;
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setLast({ at: now, totalRows: dump._meta.totalRows, name, counts: dump._meta.counts });
    } catch (e) {
      setErr("สำรองข้อมูลไม่สำเร็จ: " + (e?.message || e));
    }
    setBusy(false); setProgress(null);
  }

  return (
    <div>
      <Card title="สำรองข้อมูล (ดาวน์โหลดเก็บเอง)">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 14 }}>
          กดปุ่มด้านล่างเพื่อดึงข้อมูล<b>ทุกตารางหลัก</b> (โปรเจค · Part · Release · QR · ประวัติสแกน · งานหน้าเครื่อง · พนักงาน ฯลฯ)
          ออกมาเป็นไฟล์ <b>JSON</b> ไฟล์เดียว เก็บไว้ในเครื่อง/ไดรฟ์ของคุณเองได้ เป็นการสำรองอีกชั้นนอกเหนือจากแบ็คอัพอัตโนมัติของฐานข้อมูล
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16, padding: "10px 12px", background: "var(--surface-2, #f6faf8)", borderRadius: 8, border: "1px solid var(--border-soft, #e1e9e5)" }}>
          💡 <b>แนะนำ:</b> เวลาทำงาน 8:00–17:00 น. — ควรดาวน์โหลดสำรอง<b>ช่วงหลังเลิกงาน (~18:00–21:00)</b> ของทุกวันทำงาน
          เพราะข้อมูลของวันนั้นครบและนิ่งแล้ว · และควรกดสำรองเพิ่มก่อนนำเข้า Excel ชุดใหญ่ หรือก่อนลบโปรเจค/Release
        </div>

        {err && <div style={{ color: "var(--danger-hi)", fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <Btn variant="accent" onClick={download} disabled={busy}>
          <Icon name="box" size={15} />
          {busy
            ? (progress ? `กำลังดึง ${progress.table} (${progress.index + 1}/${progress.total})...` : "กำลังเตรียมข้อมูล...")
            : "ดาวน์โหลดไฟล์สำรองข้อมูล (JSON)"}
        </Btn>

        {last && (
          <div style={{ marginTop: 16, fontSize: 13, color: "var(--text)" }}>
            <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 4 }}>
              ✓ สำรองข้อมูลล่าสุดสำเร็จ — {fmtNum(last.totalRows)} แถว
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              ไฟล์: {last.name} · เวลา {fmtDT(last.at.toISOString())}
            </div>
          </div>
        )}
      </Card>

      <Card title="นำเข้าไฟล์สำรอง (กู้คืนจากไฟล์ JSON)">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 14 }}>
          เลือกไฟล์ <b>.json</b> ที่เคยดาวน์โหลดไว้ เพื่อนำข้อมูลกลับเข้าระบบ — ระบบจะ <b>เติมเฉพาะข้อมูลที่หายไป</b> (id ที่ยังไม่มี)
          <b> ไม่ทับของเดิมและงานที่ทำใหม่</b> เหมาะกับกรณีเผลอลบข้อมูลแล้วอยากได้กลับมา
        </div>

        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onPickFile} style={{ display: "none" }} />
        <Btn variant="accent" onClick={() => fileRef.current?.click()} disabled={impBusy}>
          <Icon name="folder" size={15} />{impBusy ? "กำลังนำเข้า..." : "เลือกไฟล์สำรอง แล้วนำเข้า"}
        </Btn>

        {impErr && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 12, lineHeight: 1.6 }}>{impErr}</div>}
        {impResult && (
          <div style={{ marginTop: 14, fontSize: 13 }}>
            <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 4 }}>
              ✓ นำเข้าสำเร็จ — เพิ่มข้อมูลที่หายไปกลับมา {fmtNum(impResult.inserted)} แถว
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              จากไฟล์: {impResult.name}
              {impResult.inserted === 0 && " · (ข้อมูลในไฟล์มีอยู่ในระบบครบแล้ว ไม่มีอะไรต้องเติม)"}
            </div>
          </div>
        )}
      </Card>

    </div>
  );
}

// ── ซิงค์ "ขั้นตอนที่เครื่องทำได้" (machine_operations) ให้ตรงกับที่เลือก ──────────
// ความสามารถผูกกับ "เครื่องจักร" (ไม่ใช่พนักงาน) — หน้าเครื่องอ่านตารางนี้ไปทำปุ่มเลือกขั้นตอน
// ตั้งได้ทั้งจากแท็บเครื่องจักร (ความสามารถ) และจากฟอร์มพนักงาน (ขั้นตอนประจำ) — แหล่งข้อมูลเดียวกัน
async function syncMachineOps(machineId, selectedIds, _caps) {
  if (!machineId) return;
  // ตั้งความสามารถทั้งชุดผ่าน RPC เฉพาะ (admin) — เลี่ยง insertRows generic ที่ไม่รองรับ machine_operations
  // (chip ที่เลือก = ชุดเต็มที่ต้องการอยู่แล้ว จึง replace ได้ตรง) · _caps ไม่ใช้แล้ว คงไว้กันแก้ caller
  await setMachineOps(machineId, [...new Set(selectedIds)]);
}

// ปุ่มแตะเลือกขั้นตอนได้หลายอัน (chip) — ใช้ทั้งฟอร์มเพิ่ม/แก้ไขพนักงาน
// ─── op_type → "หน้าปลายทาง" (terminal/แผนก) ที่ขั้นตอนนี้ขับ ───────────────────
// ★ ต้องตรงกับ Station.jsx: opDept() + DEPT_META (แผนก/URL) — ใช้ให้หน้า Setup อธิบายตัวเองว่า
//   "ขั้นตอนนี้/สถานีนี้จะเข้าหน้าไหน" เพื่อกันตั้งค่าผิด (เช่น 2 สเตชันแพ็กใช้ 'แพ็ก' ตัวเดียวกัน = ไม่แยก)
const OP_TYPE_DEST = {
  machining:  { th: "หน้าเครื่อง (ตัด/เจาะ/บาก…)", path: "/station" },
  assembly:   { th: "หน้าประกอบ · ซับ",            path: "/assembly" },
  panel:      { th: "หน้าแผง",                     path: "/panel" },
  pack_panel: { th: "หน้าแพ็กแผง",                 path: "/packing-panel" },
  pack_site:  { th: "หน้าแพ็กไซต์ไอเทม",           path: "/packing-site" },
  packing:    { th: "หน้าแพ็ก · รวมทุกบั้ง",       path: "/packing" },
};
const opTypeDest = (ty) => OP_TYPE_DEST[ty] || OP_TYPE_DEST.machining;
// รวม "หน้าปลายทาง" ที่ไม่ซ้ำ จากชุด operation ที่เลือก (ไว้สรุปว่าสเตชันนี้จะเป็นหน้าอะไร)
function destsOfSelected(operations, selectedSet) {
  const seen = new Set(); const out = [];
  (operations || []).forEach((o) => {
    if (!selectedSet.has(o.id)) return;
    const d = opTypeDest(o.op_type);
    if (!seen.has(d.path)) { seen.add(d.path); out.push(d); }
  });
  return out;
}

// ── ชื่อขั้นตอน: ไทยเป็นหลัก · โหมด EN แปลอังกฤษ · ชื่ออังกฤษ (เช่น MILLING) แสดงเป็นไทย "กัด" ──
const OP_EN = { "ตัด":"Cut","เจาะ":"Drill","บาก":"Notch","พับ":"Bend","เชื่อม":"Weld","ประกอบ":"Assemble","กัด":"Milling","เฉือน":"Shearing","ปั๊ม":"Punching","ต๊าป":"Tapping","เซาะร่อง":"Grooving","ผ่า":"Ripping" };
const OP_NORM = { "MILLING":"กัด","milling":"กัด","Milling":"กัด" };
function opLabel(name, lang) { const th = OP_NORM[name] || name; return lang === "en" ? (OP_EN[th] || th) : th; }

function OpMultiPick({ operations, selected, onToggle, machineChosen }) {
  const [lang] = useLang();
  const dests = destsOfSelected(operations, selected);
  return (
    <div>
      <div className="chip-row">
        {operations.map((o) => (
          <span key={o.id} tabIndex={0} onClick={() => onToggle(o.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(o.id); } }}
            className={`chip ${selected.has(o.id) ? "active" : ""}`}>{opLabel(o.name, lang)}</span>
        ))}
        {operations.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>ยังไม่มีขั้นตอนงาน — ไปเพิ่มที่แท็บ "ขั้นตอนงาน" ก่อน</span>
        )}
      </div>
      {dests.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          สเตชันนี้จะเข้า: {dests.map((d) => `${d.th} (${d.path})`).join(" · ")}
        </div>
      )}
      {dests.length > 1 && (
        <div style={{ fontSize: 11.5, color: "var(--warning)", marginTop: 3 }}>
          ⚠️ เลือกข้ามหลายแผนก — 1 สเตชันควรทำแผนกเดียว (ไม่งั้นพนักงานจะถูกเด้งไปหน้าแรกที่ตรงเท่านั้น)
        </div>
      )}
      {!machineChosen && selected.size > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--warning)", marginTop: 4 }}>เลือกเครื่อง/สถานีก่อน จึงจะบันทึกหลายขั้นตอนได้</div>
      )}
    </div>
  );
}

// เครื่องจักร + ความสามารถ (ทำขั้นตอนไหนได้บ้าง) — ใช้ตรวจตอนสแกนว่าเครื่องนี้
// ทำขั้นตอนนั้นได้จริง และให้หน้ารายงานแยกน้ำหนักของเครื่องออกเป็นราย-ขั้นตอนได้
function MachineCapModal({ machine, operations, caps, onClose, onSaved }) {
  const initial = new Set(caps.filter((c) => c.machine_id === machine.id).map((c) => c.operation_id));
  const [selected, setSelected] = useUndoable(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggle(opId) {
    setSelected((s) => { const n = new Set(s); n.has(opId) ? n.delete(opId) : n.add(opId); return n; });
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      await setMachineOps(machine.id, [...selected]);   // แทนที่ทั้งชุดผ่าน RPC เฉพาะ (admin)
      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + (e?.message || e));
    }
    setBusy(false);
  }

  return (
    <Modal title={`ความสามารถของเครื่อง — ${machine.code}`} sub="เลือกขั้นตอนที่เครื่องนี้ทำได้ (เลือกได้หลายอย่าง) — หน้าสแกนจะเตือนถ้าเครื่องทำขั้นตอนที่ไม่ได้ตั้งไว้" onClose={onClose}>
      <div className="label-el">ขั้นตอนที่เครื่องนี้ทำได้</div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {operations.map((o) => (
          <span key={o.id} tabIndex={0} onClick={() => toggle(o.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(o.id); } }}
            className={`chip ${selected.has(o.id) ? "active" : ""}`}>{o.name}</span>
        ))}
        {operations.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>ยังไม่มีขั้นตอนงาน — ไปเพิ่มที่แท็บ "ขั้นตอนงาน" ก่อน</span>}
      </div>
      {selected.size === 0 && (
        <div style={{ fontSize: 12, color: "var(--warning)", marginBottom: 8 }}>
          ไม่เลือกเลย = ไม่จำกัด (เครื่องนี้จะสแกนขั้นตอนใดก็ได้) — เลือกอย่างน้อย 1 อย่างเพื่อเปิดการตรวจสอบ
        </div>
      )}
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <div className="modal-actions">
        <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
        <Btn type="button" variant="accent" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Btn>
      </div>
    </Modal>
  );
}

function MachineCrud() {
  const [rows, setRows] = useState([]);
  const [operations, setOperations] = useState([]);
  const [caps, setCaps] = useState([]);
  const [form, setForm] = useUndoable({});
  const [editing, setEditing] = useState(null);     // เครื่องที่กำลังแก้ไข (ชื่อ/ประเภท/ความสามารถ/ลบ)
  const [err, setErr] = useState("");
  const [lang] = useLang();
  const sort = useTableSort("code");

  const load = useCallback(async () => {
    setRows(await listRows("machines", { order: "code" }));
    setOperations(await listRows("operations", { order: "seq" }));
    setCaps(await listRows("machine_operations"));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.code || !form.name) { setErr("กรอกรหัสและชื่อเครื่องให้ครบ"); return; }
    setErr("");
    try {
      await insertRow("machines", { code: form.code, name: form.name, type: form.type || null });
      setForm({}); load();
    } catch (e) {
      setErr(isDuplicateError(e) ? `รหัสเครื่อง "${form.code}" มีอยู่แล้ว` : "เกิดข้อผิดพลาด: " + e.message);
    }
  }
  function capNames(machineId) {
    const ids = new Set(caps.filter((c) => c.machine_id === machineId).map((c) => c.operation_id));
    const names = operations.filter((o) => ids.has(o.id)).map((o) => opLabel(o.name, lang));
    return names;
  }
  // หน้าปลายทาง (แผนก/URL) ที่สเตชันนี้จะเข้า — คิดจาก "ประเภทงาน" ของขั้นตอนที่ตั้งไว้ (ไม่ใช่ชื่อสเตชัน)
  function capDests(machineId) {
    const ids = new Set(caps.filter((c) => c.machine_id === machineId).map((c) => c.operation_id));
    const sel = operations.filter((o) => ids.has(o.id));
    return destsOfSelected(sel, new Set(sel.map((o) => o.id)));
  }

  return (
    <Card title="เพิ่มเครื่อง/สถานีใหม่ + ตั้งความสามารถ">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ minWidth: 140 }}><Field label="รหัสเครื่อง"><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field></div>
        <div style={{ minWidth: 180 }}><Field label="ชื่อเครื่อง/สถานี"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
        <div style={{ minWidth: 140 }}><Field label="ประเภทงาน"><Input value={form.type || ""} onChange={(e) => setForm({ ...form, type: e.target.value })} /></Field></div>
        <Btn variant="accent" onClick={add} style={{ height: 42, alignSelf: "flex-start", marginTop: 20 }}>เพิ่ม</Btn>
      </div>
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        เครื่อง/สถานีหนึ่งทำได้หลายขั้นตอน · งานประกอบ/แพ็กสร้างเป็น "สถานี" ที่นี่ (เช่น ประกอบ-01, แพ็ก-01) — กด "แก้ไข" เพื่อตั้งชื่อ/ประเภท เลือกขั้นตอนที่ทำได้ หรือลบเครื่อง · <b>ปุ่มลัด:</b> กด "แก้ไข" ที่สเตชันแล้วติ๊กปุ่ม <b>แพ็กแผง</b> / <b>แพ็กไซต์ไอเทม</b> / <b>MILLING</b> (ถ้ายังไม่มีขั้นตอน ระบบสร้างให้ตอนบันทึก)
      </div>
      <SortControl sort={sort} options={[
        { k: "code", label: "รหัสเครื่อง" }, { k: "name", label: "ชื่อเครื่อง/สถานี" },
        { k: "type", label: "ประเภท" }, { k: "caps", label: "ขั้นตอนที่ทำได้" },
      ]} />
      <DataTable id="machine-crud" wrapClass="table-wrap tall-scroll" tableClass="data-table responsive-cards"
        rows={rows} rowKey={(r) => r.id} sort={sort}
        sortAccessors={{
          code: (r) => r.code, name: (r) => r.name, type: (r) => r.type || "",
          caps: (r) => capNames(r.id).join(", "),
        }}
        columns={[
          { key: "code", header: "รหัสเครื่อง", sortKey: "code", cell: (r) => r.code },
          { key: "name", header: "ชื่อเครื่อง/สถานี", sortKey: "name", cell: (r) => r.name },
          { key: "type", header: "ประเภท", sortKey: "type", cell: (r) => r.type || "-" },
          { key: "caps", header: "ขั้นตอนที่ทำได้", sortKey: "caps",
            cell: (r) => { const names = capNames(r.id); return (
              <>
                {names.length > 0 ? names.join(" · ") : <span style={{ color: "var(--muted)" }}>ไม่จำกัด (ยังไม่ตั้ง)</span>}
                {(() => { const ds = capDests(r.id); return ds.length > 0 ? (
                  <div style={{ fontSize: 11.5, color: ds.length > 1 ? "var(--warning)" : "var(--muted)", marginTop: 3 }}>
                    {ds.length > 1 ? "⚠️ " : "→ "}{ds.map((d) => `${d.th} (${d.path})`).join(" · ")}
                  </div>
                ) : null; })()}
              </>
            ); } },
          { key: "manage", header: "", dataLabel: "", tdStyle: { whiteSpace: "nowrap" },
            cell: (r) => <span onClick={() => setEditing(r)} style={{ color: "var(--accent-dk)", cursor: "pointer" }}>แก้ไข</span> },
        ]} />
      {editing && (
        <MachineEditModal
          machine={editing} operations={operations} caps={caps}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </Card>
  );
}

// แก้ไขเครื่องจักร — ชื่อ / ประเภท / ขั้นตอนที่ทำได้ (ความสามารถ) + ลบ · ในที่เดียว
// (ต้องกด "แก้ไข" ก่อนถึงจะลบหรือแก้ความสามารถได้ · รหัสเครื่องแก้ไม่ได้ — เป็นตัวระบุตัวตน)
// ปุ่มลัด "เพิ่มขั้นตอนที่ยังไม่มี" — ติ๊กแล้วสร้างขั้นตอนให้อัตโนมัติตอนบันทึก
// match = วิธีเช็กว่ามีขั้นตอนนี้อยู่แล้วไหม · แพ็กแยกด้วย op_type (คนละหน้า) · MILLING เป็นงานเครื่อง (เหมือน ตัด/เจาะ) จึงเช็กด้วยชื่อ
const QUICK_ADD_CHIPS = [
  { key: "pack_panel", name: "แพ็กแผง",       op_type: "pack_panel", match: (o) => o.op_type === "pack_panel" },
  { key: "pack_site",  name: "แพ็กไซต์ไอเทม", op_type: "pack_site",  match: (o) => o.op_type === "pack_site" },
  { key: "milling",    name: "กัด",           op_type: "machining",  match: (o) => { const n = String(o.name || "").trim(); return n === "กัด" || n.toUpperCase() === "MILLING"; } },
];
function MachineEditModal({ machine, operations, caps = [], onClose, onSaved }) {
  const [form, setForm] = useUndoable({ name: machine.name || "", type: machine.type || "" });
  const [opSel, setOpSel] = useUndoable(() => new Set(caps.filter((c) => c.machine_id === machine.id).map((c) => c.operation_id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // โชว์ปุ่มลัด (แพ็กแผง/แพ็กไซต์ไอเทม/MILLING) เป็นชิปแยกกันเสมอ — ถ้ายังไม่มีขั้นตอนจริง เติมชิป "ชั่วคราว" (id ขึ้นต้น new:)
  const synthChips = QUICK_ADD_CHIPS.filter((c) => !(operations || []).some(c.match))
    .map((c) => ({ id: `new:${c.key}`, name: c.name, op_type: c.op_type, __synthetic: true }));
  const augOps = [...(operations || []), ...synthChips];
  const hasSynthSelected = [...opSel].some((id) => typeof id === "string" && id.startsWith("new:"));

  function toggleOp(id) { setOpSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  async function save() {
    if (!form.name.trim()) { setErr("กรอกชื่อเครื่องให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      await updateRow("machines", machine.id, { name: form.name.trim(), type: form.type.trim() || null });
      // แปลงชิปชั่วคราว (new:<key>) → สร้างขั้นตอนจริงถ้ายังไม่มี แล้วใช้ id จริง (idempotent · เช็ก/หาเจอด้วย match)
      const finalIds = [];
      for (const id of opSel) {
        if (typeof id === "string" && id.startsWith("new:")) {
          const spec = QUICK_ADD_CHIPS.find((c) => c.key === id.slice(4));
          if (!spec) continue;
          let ops = await listRows("operations", { order: "seq" });
          let hit = ops.find(spec.match);
          if (!hit) {
            const nextSeq = ops.reduce((m, o) => Math.max(m, Number(o.seq) || 0), 0) + 1;   // ★ seq เป็น NOT NULL — ต่อท้ายลำดับล่าสุด
            const res = await createOperation({ name: spec.name, seq: nextSeq, opType: spec.op_type });
            if (res && res.ok === false) throw new Error(res.reason || "สร้างขั้นตอนไม่สำเร็จ");
            ops = await listRows("operations", { order: "seq" });
            hit = ops.find(spec.match);
          }
          if (hit) finalIds.push(hit.id);
        } else {
          finalIds.push(id);
        }
      }
      await setMachineOps(machine.id, [...new Set(finalIds)]);   // แทนที่ทั้งชุดผ่าน RPC เฉพาะ (admin)
      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + (e?.message || e));
    }
    setBusy(false);
  }

  async function del() {
    if (!(await askConfirm({ message: `ลบเครื่อง "${machine.code} — ${machine.name}" ?`, tone: "danger", confirmText: "ลบเครื่อง", cancelText: "ยกเลิก" }))) return;
    setBusy(true); setErr("");
    try {
      let res = await deleteMachine(machine.id, false);
      if (res && res.ok === false && res.reason === "has_records") {
        setBusy(false);
        const ok = await askConfirm({
          message:
            `เครื่องนี้มีประวัติงานผลิต ${Number(res.count || 0).toLocaleString()} รายการ\n\n` +
            `⚠️ ถ้าลบ ตัวเลขการผลิตของเครื่องนี้จะหายจากรายงานถาวร (กู้คืนไม่ได้)\n` +
            `ถ้าเครื่องแค่เลิกใช้ แนะนำให้เก็บไว้เฉยๆ จะดีกว่า\n\nยืนยันลบเครื่องพร้อมประวัติทั้งหมด?`,
          tone: "danger", confirmText: "ลบพร้อมประวัติ", cancelText: "ยกเลิก",
        });
        if (!ok) return;
        setBusy(true);
        res = await deleteMachine(machine.id, true);
      }
      if (res && res.ok === false) { setErr(res.reason === "bad_request" ? "ลบไม่สำเร็จ" : "ลบไม่สำเร็จ: " + res.reason); setBusy(false); return; }
      if (res && res.ok && res.unbound > 0) {
        mlsToast(`ลบเครื่องแล้ว · ปลดพนักงาน ${res.unbound} คนออกจากเครื่องนี้ — อย่าลืมไปตั้งเครื่องใหม่ให้เขาที่ Setup › พนักงาน`, "info");
      }
      if (res && res.ok) auditRecord("delete_machine", "machine", machine.id, { code: machine.code, name: machine.name, records: res.deleted_records || 0 });
      onSaved();
    } catch (e) {
      setErr("ลบไม่สำเร็จ: " + (e?.message || e));
    }
    setBusy(false);
  }

  return (
    <Modal title={`แก้ไขเครื่อง/สถานี — ${machine.code}`} sub="แก้ชื่อ/ประเภท · เลือกขั้นตอนที่ทำได้ · หรือลบเครื่อง — รหัสเครื่องแก้ไม่ได้" onClose={onClose}>
      <div className="grid-2">
        <Field label="รหัสเครื่อง"><Input value={machine.code} disabled /></Field>
        <Field label="ชื่อเครื่อง/สถานี"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      </div>
      <Field label="ประเภทงาน (คำอธิบาย · ไม่บังคับ)">
        <Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="เช่น CUTTING / NOTCHING" />
      </Field>
      <Field label="ขั้นตอนที่เครื่องนี้ทำได้ (เลือกได้หลายอย่าง)">
        <OpMultiPick operations={augOps} selected={opSel} onToggle={toggleOp} machineChosen={true} />
      </Field>
      {hasSynthSelected && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
          ขั้นตอนที่ติ๊กใหม่ (แพ็กแผง / แพ็กไซต์ไอเทม / MILLING) ถ้ายังไม่มีในระบบ กด "บันทึก" แล้วจะสร้างให้อัตโนมัติ
        </div>
      )}
      {opSel.size === 0 && (
        <div style={{ fontSize: 12, color: "var(--warning)", marginBottom: 8 }}>
          ไม่เลือกเลย = ไม่จำกัด (เครื่องนี้สแกนขั้นตอนใดก็ได้) — เลือกอย่างน้อย 1 อย่างเพื่อเปิดการตรวจสอบ
        </div>
      )}
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <div className="modal-actions" style={{ justifyContent: "space-between" }}>
        <Btn type="button" variant="ghost" onClick={del} disabled={busy} style={{ color: "var(--danger-hi)" }}>ลบเครื่องนี้</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
          <Btn type="button" variant="accent" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── ขั้นตอนการทำงาน + ประเภทงาน (machining / assembly / packing) ───────────────
const OP_TYPES = [
  { value: "machining", label: "งานเครื่อง (machining)" },
  { value: "assembly", label: "ประกอบ · ซับ (subassembly)" },
  { value: "panel", label: "แผง (panel)" },
  { value: "pack_panel", label: "แพ็กแผง (pack panel)" },
  { value: "pack_site", label: "แพ็กไซต์ไอเทม (pack site item)" },
  { value: "packing", label: "แพ็ก · รวมทุกบั้ง (packing)" },
];
function OperationsCrud() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useUndoable({ op_type: "machining" });
  const [lang] = useLang();
  const load = useCallback(async () => setRows(await listRows("operations", { order: "seq" })), []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.name) { mlsToast("กรอกชื่อขั้นตอน", "warn"); return; }
    try {
      const res = await createOperation({
        name: form.name,
        seq: form.seq === "" || form.seq == null ? null : Number(form.seq),
        opType: form.op_type || "machining",
      });
      if (!res?.ok) { mlsToast("เพิ่มขั้นตอนไม่สำเร็จ: " + (res?.reason || "unknown"), "error"); return; }
      setForm({ op_type: "machining" }); load();
    } catch (e) { mlsToast("เพิ่มขั้นตอนไม่สำเร็จ: " + (e?.message || e), "error"); }
  }
  async function changeType(id, op_type) {
    try {
      const res = await setOperationType(id, op_type);
      if (!res?.ok) { mlsToast("เปลี่ยนประเภทไม่สำเร็จ: " + (res?.reason || "unknown"), "error"); return; }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, op_type } : r)));
    } catch (e) { mlsToast("เปลี่ยนประเภทไม่สำเร็จ: " + (e?.message || e), "error"); }
  }
  async function remove(id) {
    if (!(await askConfirm({ message: "ลบขั้นตอนนี้?", tone: "danger", confirmText: "ลบ", cancelText: "ยกเลิก" }))) return;
    try { await deleteRow("operations", id); load(); }
    catch (e) { mlsToast("ลบไม่ได้ — ขั้นตอนนี้ถูกใช้งานอยู่ (มีเครื่อง/งาน/การสแกนอ้างอิงถึง)", "error"); }
  }

  return (
    <Card title="ขั้นตอนการทำงาน (machining / ประกอบ / แพ็ก)">
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
        <b>งานเครื่อง</b> = ตัด/เจาะ/บาก (สแกนต่อชิ้นปกติ) · <b>ประกอบ/แพ็ก</b> = หน้าเครื่องสลับเป็นโหมดประกอบ (สแกนลูกเข้าเบอร์แม่ตาม BOM) — ตั้งประเภทที่นี่แทนการรัน SQL
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--surface-2, #f6f7f9)", border: "1px solid var(--border, #e6e8ec)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, lineHeight: 1.7 }}>
        <b>สำคัญ: "แผนก/หน้าปลายทาง" มาจาก "ประเภทงาน" ของขั้นตอน ไม่ใช่ชื่อสเตชัน</b> — ดูคอลัมน์ <b>หน้าปลายทาง</b> ด้านล่าง<br />
        • อยากแยกแพ็กเป็น 2 หน้า ต้องมี <b>2 ขั้นตอนคนละประเภท</b>: <b>แพ็กแผง</b> (→ /packing-panel) และ <b>แพ็กไซต์ไอเทม</b> (→ /packing-site) แล้วตั้งให้สเตชันละอัน · ประเภท <b>แพ็ก · รวมทุกบั้ง</b> (→ /packing) เห็นทุกบั้ง ไม่แยก<br />
        • ถ้าหลายสเตชันใช้ขั้นตอนประเภทเดียวกัน จะเข้า<b>หน้าเดียวกัน</b> (ไม่แยกกัน)<br />
        • <b>Glazing/ติดกระจก</b>: เลือก <b>แผง</b> ถ้าเบอร์แม่ที่กระจกไปติดเป็นชนิด "แผง" · เลือก <b>ประกอบ · ซับ</b> ถ้าเป็นชนิด "ซับ" — ทั้งสองแบบ<b>ใส่ part ที่ไม่ใช่กระจกได้อยู่แล้ว</b> (ไม่บล็อก)
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "flex-start" }}>
        <Field label="ชื่อขั้นตอน"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น ตัด / ประกอบ / แพ็ก" /></Field>
        <Field label="ลำดับ"><Input type="number" value={form.seq ?? ""} onChange={(e) => setForm({ ...form, seq: e.target.value })} style={{ maxWidth: 90 }} /></Field>
        <div style={{ minWidth: 200 }}>
          <Field label="ประเภทงาน"><Select value={form.op_type || "machining"} onChange={(e) => setForm({ ...form, op_type: e.target.value })}
            options={OP_TYPES.map((o) => ({ value: o.value, label: o.label }))} /></Field>
        </div>
        <Field label={" "}><Btn variant="accent" onClick={add} style={{ height: 42 }}>เพิ่ม</Btn></Field>
      </div>
      <DataTable id="operations-crud" wrapClass="table-wrap" tableClass="data-table" rows={rows} rowKey={(r) => r.id}
        empty={<div className="empty-state" style={{ padding: "20px 0" }}><Icon name="settings" size={28} /><div className="empty-state-title">ยังไม่มีขั้นตอน</div><div className="empty-state-sub">เพิ่มขั้นตอนแรกด้านบน</div></div>}
        columns={[
          { key: "name", header: "ชื่อขั้นตอน", tdStyle: { whiteSpace: "nowrap", fontWeight: 600 }, cell: (r) => opLabel(r.name, lang) },
          { key: "seq", header: "ลำดับ", align: "right", cell: (r) => r.seq },
          { key: "op_type", header: "ประเภทงาน", cell: (r) => (
            <select className="select" value={r.op_type || "machining"} onChange={(e) => changeType(r.id, e.target.value)} style={{ minWidth: 190 }}>
              {OP_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) },
          { key: "dest", header: "หน้าปลายทาง (แผนก/URL)", tdStyle: { whiteSpace: "nowrap", fontSize: 12.5 },
            cell: (r) => { const dest = opTypeDest(r.op_type || "machining"); return (
              <><span style={{ fontWeight: 600 }}>{dest.th}</span><span style={{ color: "var(--muted)", marginLeft: 6 }}>{dest.path}</span></>
            ); } },
          { key: "manage", header: "", dataLabel: "", cell: (r) => <span onClick={() => remove(r.id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span> },
        ]} />
    </Card>
  );
}

function SimpleCrud({ table, fields }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useUndoable({});
  const load = useCallback(async () => setRows(await listRows(table, { order: fields[0].key })), [table, fields]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form[fields[0].key]) return;
    await insertRow(table, form);
    setForm({}); load();
  }
  async function remove(id) {
    if (!(await askConfirm({ message: "ลบรายการนี้?", tone: "danger", confirmText: "ลบ", cancelText: "ยกเลิก" }))) return;
    try {
      await deleteRow(table, id);
      load();
    } catch (e) {
      // FK: ถ้ามีเครื่อง/งานอ้างอิงอยู่ (เช่น ขั้นตอนที่เครื่องใช้/มีการสแกน) จะลบไม่ได้ — แจ้งชัด ไม่เงียบ
      mlsToast("ลบไม่ได้ — รายการนี้ถูกใช้งานอยู่ (มีเครื่องจักร/งาน/การสแกนอ้างอิงถึง) · ต้องเอาการอ้างอิงออกก่อน หรือปล่อยไว้เพื่อรักษาประวัติ", "error");
    }
  }

  return (
    <Card title="เพิ่มรายการใหม่">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {fields.map((f) => (
          <div key={f.key} style={{ minWidth: 170 }}>
            <Field label={f.label}>
              <Input type={f.type || "text"} value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            </Field>
          </div>
        ))}
        <Btn variant="accent" onClick={add} style={{ height: 42, alignSelf: "flex-start", marginTop: 20 }}>เพิ่ม</Btn>
      </div>
      <DataTable id={`simple-crud-${table}`} wrapClass="table-wrap" tableClass="data-table" rows={rows} rowKey={(r) => r.id}
        columns={[
          ...fields.map((f) => ({ key: f.key, header: f.label, align: f.type === "number" ? "right" : undefined, cell: (r) => r[f.key] })),
          { key: "__manage", header: "", dataLabel: "", cell: (r) => <span onClick={() => remove(r.id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span> },
        ]} />
    </Card>
  );
}

function EmployeeEditModal({ employee, departments, machines, operations, caps = [], onClose, onSaved }) {
  const [form, setForm] = useUndoable({
    name: employee.name,
    department_id: employee.department_id || "",
    role: employee.role,
    machine_id: employee.machine_id || "",
    password: "", // เว้นว่าง = ไม่เปลี่ยนรหัสผ่าน
  });
  // ขั้นตอนประจำ = เลือกได้หลายอัน · ค่าเริ่มต้นดึงจาก "ความสามารถของเครื่อง" ที่ผูกอยู่
  // (ถ้าเครื่องยังไม่มีความสามารถ แต่มี operation_id เดิม → ใช้ค่านั้นเป็นตัวเริ่ม)
  // ★ ใช้ "ความสามารถจริงของเครื่อง" อย่างเดียว — ไม่ seed จาก employee.operation_id เดิม
  //   (เดิม seed ค่านั้นเมื่อเครื่องไม่มี caps แล้วพอ save จะเขียนทับ = เผลอล็อกเครื่องที่ตั้ง "ไม่จำกัด" ให้เหลือขั้นตอนเดียว)
  const capsForMachine = (mid) => new Set(caps.filter((c) => c.machine_id === mid).map((c) => c.operation_id));
  const [opSel, setOpSel] = useUndoable(() => capsForMachine(employee.machine_id || ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function chooseMachine(mid) {
    setForm((f) => ({ ...f, machine_id: mid }));
    setOpSel(capsForMachine(mid));   // ย้ายเครื่อง → โหลดความสามารถของเครื่องใหม่มาแสดง
  }
  function toggleOp(id) {
    setOpSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function save() {
    if (!form.name.trim()) { setErr("กรอกชื่อให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      const opIds = [...opSel];
      // บันทึกผ่าน RPC — DB จัดการ bcrypt เอง client ไม่แตะ hash (แก้ C2/H1)
      await upsertEmployee({
        id: employee.id,
        code: employee.code,
        name: form.name.trim(),
        password: form.password, // "" = ไม่เปลี่ยน
        role: form.role,
        department_id: form.department_id || null,
        machine_id: form.machine_id || null,
        operation_id: opIds[0] || null,   // ตัวแรก = ขั้นตอนตั้งต้น (fallback ตอนสแกน)
        active: employee.active,
      });
      // ซิงค์ความสามารถของเครื่องให้ตรงกับที่เลือก (หน้าเครื่องจะโชว์ปุ่มเลือกตามนี้)
      await syncMachineOps(form.machine_id, opIds, caps);
      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + e.message);
    }
    setBusy(false);
  }

  async function del() {
    if (!(await askConfirm({ message: `ลบพนักงาน "${employee.code} — ${employee.name}" ?`, tone: "danger", confirmText: "ลบพนักงาน", cancelText: "ยกเลิก" }))) return;
    setBusy(true); setErr("");
    try {
      let res = await deleteEmployee(employee.id, false);
      if (res && res.ok === false && res.reason === "has_records") {
        setBusy(false);
        const ok = await askConfirm({
          message:
            `พนักงานคนนี้มีประวัติงานหน้าเครื่อง ${Number(res.count || 0).toLocaleString()} รายการ\n\n` +
            `แนะนำให้ "ปิดใช้งาน" แทนการลบ เพื่อเก็บชื่อผู้ทำไว้ในประวัติ\n\n` +
            `ถ้ายืนยันลบ: ตัวเลขการผลิตจะยังอยู่ครบ แต่ประวัติจะไม่ระบุว่าใครเป็นคนทำ\n\nยืนยันลบ?`,
          tone: "danger", confirmText: "ลบพนักงาน", cancelText: "ยกเลิก",
        });
        if (!ok) return;
        setBusy(true);
        res = await deleteEmployee(employee.id, true);
      }
      if (res && res.ok === false) {
        if (res.reason === "self") setErr("ลบบัญชีตัวเองไม่ได้ — ให้บัญชี Admin อื่นลบให้");
        else setErr("ลบไม่สำเร็จ");
        setBusy(false);
        return;
      }
      auditRecord("delete_employee", "employee", employee.id, { code: employee.code, name: employee.name });
      onSaved();
    } catch (e) {
      setErr("ลบไม่สำเร็จ: " + e.message);
    }
    setBusy(false);
  }

  return (
    <Modal title={`แก้ไขพนักงาน — ${employee.code}`} sub="ตั้งเครื่อง/สถานี/ขั้นตอนประจำที่นี่ — หน้าสแกนจะใช้ค่านี้แทนการเลือกเอง" onClose={onClose}>
      <div className="grid-2">
        <Field label="ชื่อ"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="แผนก"><Select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
          options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="สิทธิ์การใช้งาน"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
          options={[{ value: "admin", label: "Admin" }, { value: "office", label: "พนักงานออฟฟิศ" }, { value: "operator", label: "พนักงานหน้าเครื่อง" }]} /></Field>
        <div />
        <Field label="เครื่อง/สถานีประจำ *"><Select value={form.machine_id} onChange={(e) => chooseMachine(e.target.value)}
          options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} /></Field>
        <Field label="ขั้นตอนประจำ (เลือกได้หลายขั้นตอน) *">
          <OpMultiPick operations={operations} selected={opSel} onToggle={toggleOp} machineChosen={!!form.machine_id} />
        </Field>
      </div>
      <Field label="ตั้งรหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)">
        <Input type="password" value={form.password} autoComplete="new-password"
          onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
      </Field>
      {(!form.machine_id || opSel.size === 0) && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          * ถ้าไม่ตั้งเครื่อง/สถานี/ขั้นตอนประจำ พนักงานคนนี้จะสแกนงานไม่ได้
        </div>
      )}
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <div className="modal-actions" style={{ justifyContent: "space-between" }}>
        <Btn type="button" variant="ghost" onClick={del} disabled={busy} style={{ color: "var(--danger-hi)" }}>
          ลบพนักงานนี้
        </Btn>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
          <Btn type="button" variant="accent" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function EmployeeCrud() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [machines, setMachines] = useState([]);
  const [operations, setOperations] = useState([]);
  const [caps, setCaps] = useState([]);
  const [form, setForm] = useUndoable({ role: "operator" });
  const [opSel, setOpSel] = useUndoable(new Set());   // ขั้นตอนประจำ (เลือกได้หลายอัน)
  const [lang] = useLang();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);            // กำลังบันทึก — กันกดซ้ำ + โชว์สถานะ
  const [msg, setMsg] = useState(null);               // { ok, text } แสดงผลในฟอร์ม (เห็นชัดกว่า toast มุมจอ)
  const load = useCallback(async () => {
    setRows(await getEmployees());
    setDepartments(await listRows("departments", { order: "name" }));
    setMachines(await listRows("machines", { order: "code" }));
    setOperations(await listRows("operations", { order: "seq" }));
    setCaps(await listRows("machine_operations"));
  }, []);
  useEffect(() => { load(); }, [load]);

  // เลือกเครื่อง → ดึงความสามารถเดิมของเครื่องนั้นมาแสดง (กันเผลอลบทิ้งตอนบันทึก)
  function chooseMachine(mid) {
    setForm((f) => ({ ...f, machine_id: mid }));
    setOpSel(new Set(caps.filter((c) => c.machine_id === mid).map((c) => c.operation_id)));
  }
  function toggleOp(id) {
    setOpSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function add() {
    if (busy) return;                                   // กันกดซ้ำระหว่างบันทึก
    if (!form.code || !form.name || !form.password) {
      const w = "กรอกรหัส/ชื่อ/รหัสผ่านให้ครบ"; setMsg({ ok: false, text: w }); mlsToast(w, "warn"); return;
    }
    const opIds = [...opSel];
    setBusy(true); setMsg({ ok: null, text: "กำลังบันทึก…" });
    // ── ขั้นที่ 1: สร้างพนักงาน (ผ่าน RPC — DB hash bcrypt เอง client ไม่แตะ hash) ──
    try {
      await upsertEmployee({
        code: form.code, name: form.name, password: form.password, role: form.role,
        department_id: form.department_id || null,
        machine_id: form.machine_id || null, operation_id: opIds[0] || null,
      });
    } catch (e) {
      // แสดง error จริงให้ครบ (เช่น RPC signature ไม่ตรง / unauthorized / รหัสซ้ำ)
      const text = isDuplicateError(e)
        ? `รหัสพนักงาน "${form.code}" มีอยู่แล้ว`
        : "เพิ่มพนักงานไม่สำเร็จ: " + (e?.message || e?.code || JSON.stringify(e));
      console.error("add employee failed", e);
      setMsg({ ok: false, text }); mlsToast(text, "error"); setBusy(false); return;
    }
    // ── ขั้นที่ 2: ตั้งความสามารถเครื่อง (งานรอง) — ถ้าพลาด พนักงานถูกสร้างแล้ว อย่าให้ดูเหมือนล้มเหลว ──
    let warn = "";
    try {
      await syncMachineOps(form.machine_id, opIds, caps);
    } catch (e) {
      warn = ` (แต่ตั้งความสามารถเครื่องไม่สำเร็จ: ${e?.message || "error"} — แก้ได้ที่ปุ่ม "แก้ไข")`;
      mlsToast(`เพิ่มพนักงานแล้ว${warn}`, "warn");
    }
    setMsg({ ok: true, text: `เพิ่มพนักงาน "${form.name}" สำเร็จ${warn}` });
    if (!warn) mlsToast(`เพิ่มพนักงาน "${form.name}" สำเร็จ`, "info");
    setForm({ role: "operator" }); setOpSel(new Set()); setBusy(false); load();
  }
  async function toggle(r) {
    try { await setEmployeeActive(r.id, !r.active); load(); }
    catch (e) { mlsToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error"); }
  }

  return (
    <Card title="เพิ่มพนักงานใหม่">
      <div className="grid-3" style={{ marginBottom: 6 }}>
        <Field label="รหัสพนักงาน"><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
        <Field label="ชื่อ"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="รหัสผ่านเริ่มต้น"><Input value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="แผนก"><Select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
          options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="สิทธิ์การใช้งาน"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
          options={[{ value: "admin", label: "Admin" }, { value: "office", label: "พนักงานออฟฟิศ" }, { value: "operator", label: "พนักงานหน้าเครื่อง" }]} /></Field>
        <div />
        <Field label="เครื่อง/สถานีประจำ"><Select value={form.machine_id || ""} onChange={(e) => chooseMachine(e.target.value)}
          options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} /></Field>
        <Field label="ขั้นตอนประจำ (เลือกได้หลายขั้นตอน)">
          <OpMultiPick operations={operations} selected={opSel} onToggle={toggleOp} machineChosen={!!form.machine_id} />
        </Field>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        พนักงานที่ยังไม่ได้ตั้งเครื่อง/สถานี/ขั้นตอนประจำ จะสแกนงานไม่ได้ (ตั้งภายหลังได้ที่ปุ่ม "แก้ไข") · เลือกได้หลายขั้นตอนถ้าเครื่องนี้ทำได้หลายอย่าง
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Btn variant="accent" onClick={add} disabled={busy}>{busy ? "กำลังบันทึก…" : "เพิ่มพนักงาน"}</Btn>
        {msg && (
          <span style={{ fontSize: 13, fontWeight: 600,
            color: msg.ok === true ? "var(--accent-dk, #0a7)" : msg.ok === false ? "var(--danger, #e11d1d)" : "var(--muted)" }}>
            {msg.ok === true ? "✓ " : msg.ok === false ? "⚠ " : ""}{msg.text}
          </span>
        )}
      </div>
      <DataTable id="employee-crud" wrapClass="table-wrap" tableClass="data-table" rows={rows} rowKey={(r) => r.id}
        columns={[
          { key: "code", header: "รหัส", cell: (r) => r.code },
          { key: "name", header: "ชื่อ", cell: (r) => r.name },
          { key: "dept", header: "แผนก", cell: (r) => departments.find((d) => d.id === r.department_id)?.name || "-" },
          { key: "role", header: "สิทธิ์", cell: (r) => ROLE_LABELS[r.role] || r.role },
          { key: "machine", header: "เครื่อง/สถานีประจำ", cell: (r) => machines.find((m) => m.id === r.machine_id)?.code || <span style={{ color: "var(--danger-hi)" }}>ยังไม่ตั้ง</span> },
          { key: "ops", header: "ขั้นตอนประจำ", cell: (r) => {
            const ids = new Set(caps.filter((c) => c.machine_id === r.machine_id).map((c) => c.operation_id));
            let names = operations.filter((o) => ids.has(o.id)).map((o) => opLabel(o.name, lang));
            if (names.length === 0 && r.operation_id) { const o = operations.find((o) => o.id === r.operation_id); if (o) names = [opLabel(o.name, lang)]; }
            return names.length ? names.join(", ") : <span style={{ color: "var(--danger-hi)" }}>ยังไม่ตั้ง</span>;
          } },
          { key: "status", header: "สถานะ", cell: (r) => (
            <span onClick={() => toggle(r)} style={{ cursor: "pointer" }}>
              <Badge tone={r.active ? "success" : "muted"}>{r.active ? "ใช้งาน" : "ปิดใช้งาน"}</Badge>
            </span>
          ) },
          { key: "manage", header: "", dataLabel: "", cell: (r) => <span onClick={() => setEditing(r)} style={{ color: "var(--accent-dk)", cursor: "pointer" }}>แก้ไข</span> },
        ]} />
      {editing && (
        <EmployeeEditModal
          employee={editing} departments={departments} machines={machines} operations={operations} caps={caps}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </Card>
  );
}

// ─── ชนิดของเบอร์ (พาร์ท / ซับ / แผง / แพ็ก) + BOM editor สำหรับเบอร์ประกอบ ────────
const PM_KINDS = [
  { value: "part", label: "พาร์ท" },
  { value: "subassembly", label: "ซับแอสเซมบลี" },
  { value: "panel", label: "แผง" },
  { value: "package", label: "แพ็ก" },
];
const kindLabel = (k) => (PM_KINDS.find((x) => x.value === (k || "part"))?.label || "พาร์ท");

// กำหนด BOM ของเบอร์แม่ (ซับ/แผง/แพ็ก) — เลือกลูกในโปรเจคเดียวกัน + จำนวน
function BomEditorModal({ parent, allParts, onClose, onSaved }) {
  const [rows, setRows] = useState(null);   // null = loading · [{child_pm_id, qty, part_no, part_name, kind}]
  const [pick, setPick] = useState("");
  const [pickQty, setPickQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const candidates = useMemo(
    () => allParts.filter((p) => p.project_id === parent.project_id && p.id !== parent.id),
    [allParts, parent]
  );

  useEffect(() => {
    getBom(parent.id).then((b) => setRows((b || []).map((x) => ({
      child_pm_id: x.child_pm_id, qty: x.qty, part_no: x.part_no, part_name: x.part_name, kind: x.kind,
    }))));
  }, [parent.id]);

  function addChild() {
    if (!pick || !rows) return;
    if (rows.some((r) => r.child_pm_id === pick)) { setErr("มีลูกตัวนี้อยู่แล้ว — แก้จำนวนในตารางแทน"); return; }
    const c = candidates.find((p) => p.id === pick);
    setRows([...rows, { child_pm_id: pick, qty: Math.max(1, Number(pickQty) || 1), part_no: c?.part_no, part_name: c?.part_name, kind: c?.kind }]);
    setPick(""); setPickQty(1); setErr("");
  }
  const removeChild = (id) => setRows(rows.filter((r) => r.child_pm_id !== id));
  const setQty = (id, q) => setRows(rows.map((r) => (r.child_pm_id === id ? { ...r, qty: Math.max(1, Number(q) || 1) } : r)));

  async function save() {
    setBusy(true); setErr("");
    try {
      const res = await setBom(parent.id, rows.map((r) => ({ child_pm_id: r.child_pm_id, qty: r.qty })));
      if (res?.ok) { mlsToast("บันทึก BOM แล้ว", "success"); onSaved && onSaved(); onClose(); }
      else setErr("บันทึกไม่สำเร็จ" + (res?.reason ? ` (${res.reason})` : ""));
    } catch (e) { setErr("บันทึกไม่สำเร็จ: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  const avail = rows ? candidates.filter((c) => !rows.some((r) => r.child_pm_id === c.id)) : [];

  return (
    <Modal title={`กำหนด BOM — ${parent.part_no}`} sub={`${kindLabel(parent.kind)} · ประกอบจากลูก (ต้องอยู่โปรเจคเดียวกัน)`} onClose={onClose} locked={busy} wide>
      {rows === null ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>กำลังโหลด...</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Field label="เพิ่มลูก (Part / ซับ ในโปรเจคนี้)">
                <Select value={pick} onChange={(e) => setPick(e.target.value)}
                  options={avail.map((c) => ({ value: c.id, label: `${c.part_no} — ${c.part_name || ""}${c.kind && c.kind !== "part" ? " [" + kindLabel(c.kind) + "]" : ""}` }))} />
              </Field>
            </div>
            <Field label="จำนวน/ชุด"><Input type="number" min="1" value={pickQty} onChange={(e) => setPickQty(e.target.value)} style={{ maxWidth: 100 }} /></Field>
            <Btn variant="ghost" onClick={addChild} disabled={!pick}><Icon name="plus" size={14} /> เพิ่มลูก</Btn>
          </div>

          {rows.length === 0 ? (
            <div className="empty-state"><Icon name="grid" size={28} /><div className="empty-state-title">ยังไม่มีลูกใน BOM</div><div className="empty-state-sub">เลือกลูกด้านบนแล้วกด “เพิ่มลูก”</div></div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>ลูก (Part No.)</th><th>ชื่อ</th><th>ชนิด</th><th>จำนวน/ชุด</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.child_pm_id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600, whiteSpace: "nowrap" }}>{r.part_no}</td>
                      <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{r.part_name}</td>
                      <td style={{ fontSize: 12.5 }}>{kindLabel(r.kind)}</td>
                      <td><Input type="number" min="1" value={r.qty} onChange={(e) => setQty(r.child_pm_id, e.target.value)} style={{ maxWidth: 80 }} /></td>
                      <td><span onClick={() => removeChild(r.child_pm_id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <Btn variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
            <Btn variant="accent" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก BOM"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function PartMasterCrud() {
  const [rows, setRows] = useState([]);
  const [projects, setProjects] = useState([]);
  const [bomParent, setBomParent] = useState(null);   // เบอร์ที่กำลังกำหนด BOM
  const [form, setForm] = useUndoable({ routing: [] });
  const load = useCallback(async () => {
    setRows(await listRows("part_master", { order: "part_no" }));
    setProjects(await listRows("projects", { order: "code" }));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.part_no || !form.project_id) { mlsToast("กรอกโปรเจคและรหัส Part ให้ครบ", "warn"); return; }
    await insertRow("part_master", {
      project_id: form.project_id, part_no: form.part_no, part_name: form.part_name || form.part_no,
      material: form.material, unit_weight: Number(form.unit_weight || 0),
      default_length_mm: form.default_length_mm === "" || form.default_length_mm == null ? null : Number(form.default_length_mm),
      routing: form.routing || [], kind: form.kind || "part",
    });
    setForm({ routing: [] }); load();
  }
  // เปลี่ยนชนิดของเบอร์ที่มีอยู่ (พาร์ท ↔ ซับ/แผง/แพ็ก) — เบอร์ประกอบถึงจะกำหนด BOM ได้
  async function changeKind(id, kind) {
    try { await updateRow("part_master", id, { kind }); setRows((prev) => prev.map((r) => (r.id === id ? { ...r, kind } : r))); }
    catch (e) { mlsToast("เปลี่ยนชนิดไม่สำเร็จ: " + (e?.message || e), "error"); }
  }
  // ลบ Part แบบรู้ผลกระทบ — ถ้ายังมี Release/ชิ้นงานผูกอยู่ ห้ามลบตรงๆ (กันข้อมูลหาย + กัน FK error)
  async function remove(id) {
    const r = rows.find((x) => x.id === id);
    let rels = [], units = [];
    try {
      [rels, units] = await Promise.all([
        listRows("releases", { filters: { part_master_id: id } }),
        listRows("part_units", { filters: { part_master_id: id } }),
      ]);
    } catch { /* ถ้าเช็คไม่ได้ ให้ทำ flow ปลอดภัยด้านล่างต่อ */ }
    if (rels.length > 0 || units.length > 0) {
      mlsToast(`ลบ Part "${r?.part_no || ""}" ไม่ได้ — ยังมี ${fmtNum(rels.length)} Release และ ${fmtNum(units.length)} ชิ้น (QR) ผูกอยู่ · ให้ลบ Release ของ Part นี้ก่อน (ที่หน้า "ปล่อยงาน (Release)") แล้วจึงลบ Part ได้`, "error");
      return;
    }
    if (await askConfirm({ message: `ลบ Part "${r?.part_no || ""}"?\n(ยังไม่มี Release/ชิ้นงานผูกอยู่ — ลบได้ปลอดภัย)`, tone: "danger", confirmText: "ลบ Part", cancelText: "ยกเลิก" })) {
      await deleteRow("part_master", id); load();
    }
  }

  return (
    <>
    <Card title="เพิ่ม Part ใหม่">
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Field label="โปรเจค"><Select value={form.project_id || ""} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
          options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} /></Field>
        <Field label="รหัส Part"><Input value={form.part_no || ""} onChange={(e) => setForm({ ...form, part_no: e.target.value })} /></Field>
        <Field label="ชื่อ Part"><Input value={form.part_name || ""} onChange={(e) => setForm({ ...form, part_name: e.target.value })} /></Field>
        <Field label="วัสดุ"><Input value={form.material || ""} onChange={(e) => setForm({ ...form, material: e.target.value })} /></Field>
        <Field label="น้ำหนักโดยประมาณ/ชิ้น (กก.)"><Input type="number" step="0.01" value={form.unit_weight || ""} onChange={(e) => setForm({ ...form, unit_weight: e.target.value })} /></Field>
        <Field label="ความยาวโดยประมาณ/ชิ้น (มม.)"><Input type="number" step="0.1" value={form.default_length_mm || ""} onChange={(e) => setForm({ ...form, default_length_mm: e.target.value })} /></Field>
        <Field label="ชนิด">
          <Select value={form.kind || "part"} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            options={PM_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        </Field>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-6px 2px 12px", lineHeight: 1.6 }}>
        <b>ชนิด</b>: พาร์ท = ชิ้นส่วนปกติ · ซับ/แผง/แพ็ก = เบอร์ประกอบ (ประกอบจากลูก) — เลือกเป็นเบอร์ประกอบแล้วจะกำหนด BOM ได้ในตารางด้านล่าง
      </div>
      <Btn variant="accent" onClick={add}>เพิ่ม Part</Btn>
      <DataTable id="partmaster-crud" wrapClass="table-wrap" tableClass="data-table" rows={rows} rowKey={(r) => r.id}
        empty={
          <div className="empty-state" style={{ padding: "24px 0" }}>
            <Icon name="grid" size={30} />
            <div className="empty-state-title">ยังไม่มี Part</div>
            <div className="empty-state-sub">กรอกฟอร์มด้านบนแล้วกด “เพิ่ม Part” เพื่อเพิ่มรายการแรก</div>
          </div>
        }
        columns={[
          { key: "part_no", header: "Part No.", tdStyle: { whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontWeight: 600 }, cell: (r) => r.part_no },
          { key: "part_name", header: "ชื่อ", tdStyle: { whiteSpace: "nowrap" }, cell: (r) => r.part_name },
          { key: "kind", header: "ชนิด", cell: (r) => (
            <select className="select" value={r.kind || "part"} onChange={(e) => changeKind(r.id, e.target.value)} style={{ minWidth: 120 }}>
              {PM_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          ) },
          { key: "unit_weight", header: "น้ำหนัก/ชิ้น", align: "right", cell: (r) => r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-" },
          { key: "length", header: "ความยาว/ชิ้น", align: "right", cell: (r) => r.default_length_mm ? `${fmtNum(r.default_length_mm)} มม.` : "-" },
          { key: "bom", header: "BOM", cell: (r) => (r.kind && r.kind !== "part")
            ? <Btn variant="ghost" size="sm" onClick={() => setBomParent(r)}><Icon name="grid" size={13} /> กำหนด BOM</Btn>
            : <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span> },
          { key: "manage", header: "", dataLabel: "", cell: (r) => <span onClick={() => remove(r.id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span> },
        ]} />
    </Card>
    {bomParent && (
      <BomEditorModal parent={bomParent} allParts={rows} onClose={() => setBomParent(null)} onSaved={load} />
    )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
// แถบแจ้ง "มีเวอร์ชันใหม่" — ให้ผู้ใช้กดอัปเดตเองเมื่อพร้อม (ไม่รีโหลดกลางคัน)
function UpdateBanner() {
  const ready = useUpdateReady();
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  if (!ready) return null;
  return (
    <div className="update-banner">
      <span><b>มีเวอร์ชันใหม่ของระบบ</b>{offline ? " — ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่" : " — อัปเดตเพื่อใช้เวอร์ชันล่าสุด"}</span>
      <button className="ub-btn" disabled={busy} onClick={() => { setBusy(true); if (!applyUpdate()) { setBusy(false); setOffline(true); } }}>
        {busy ? "กำลังอัปเดต…" : "อัปเดตเดี๋ยวนี้"}
      </button>
    </div>
  );
}

// ── กันจอขาว: ถ้าเรนเดอร์พังตรงไหน โชว์ข้อความ + ปุ่มโหลดใหม่ แทนหน้าจอว่างเปล่า ──
//   (ก่อนหน้านี้ error ระหว่าง render ทำให้ React ถอดทั้งหน้า = จอขาว หาสาเหตุยาก)
// กู้อัตโนมัติจาก chunk ที่ค้างไม่ตรงเวอร์ชัน: ล้างแคช SW + ถอน SW แล้วโหลดใหม่
function mlsHardReload() {
  const reload = () => { try { location.reload(); } catch { /* ignore */ } };
  // ★ ออฟไลน์: ห้ามล้างแคช/ถอน SW (จะเปิดแอปไม่ได้จนกว่าจะออนไลน์) — โหลดใหม่จาก shell ที่แคชไว้เฉยๆ
  if (typeof navigator !== "undefined" && navigator.onLine === false) { reload(); return; }
  try {
    const cc = (window.caches && caches.keys)
      ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {})
      : Promise.resolve();
    const sw = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
      ? navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {})
      : Promise.resolve();
    Promise.all([cc, sw]).finally(reload);
  } catch { reload(); }
}
class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null, stack: "" }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    console.error("App crashed:", err, info?.componentStack);
    this.setState({ stack: info?.componentStack || "" });
    // ถ้าเป็น error แบบ chunk ไม่ตรงเวอร์ชัน (deploy ใหม่ทับของเก่า) → กู้อัตโนมัติ 1 ครั้ง
    const msg = String(err?.message || err || "");
    if (/#130|Loading chunk|ChunkLoadError|Importing a module script failed|dynamically imported/i.test(msg)) {
      let healed = false;
      try { healed = sessionStorage.getItem("mls-healed") === "1"; } catch { /* ignore */ }
      // ★ ออฟไลน์: ไม่ auto-heal (โหลดใหม่ตอนออฟไลน์ไม่ช่วย + เสี่ยงวน) → โชว์การ์ด crash ให้เลือกเอง
      if (!healed && !(typeof navigator !== "undefined" && navigator.onLine === false)) { try { sessionStorage.setItem("mls-healed", "1"); } catch { /* ignore */ } mlsHardReload(); }
    }
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#eef3f1", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 520, background: "#fff", border: "1px solid #e1e9e5", borderRadius: 16, padding: "28px 26px", boxShadow: "0 10px 40px -12px rgba(0,0,0,.15)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>เกิดข้อผิดพลาดในการแสดงผล</div>
          <div style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.7, marginBottom: 16 }}>
            ลองกด “โหลดใหม่” — ถ้ายังพบปัญหา ให้แคปข้อความด้านล่างส่งให้ผู้ดูแลระบบ
          </div>
          <pre style={{ fontSize: 11.5, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 220, overflow: "auto", margin: "0 0 16px" }}>
            {String(this.state.err?.message || this.state.err)}
            {this.state.stack ? "\n\nComponent stack:" + this.state.stack.split("\n").slice(0, 8).join("\n") : ""}
          </pre>
          <button onClick={mlsHardReload}
            style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            โหลดใหม่ (ล้างแคช)
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  const [user, setUser] = useState(getSession());

  // ฝ่ายผลิต / พนักงานหน้าเครื่อง (role = operator) → เด้งไปหน้าเครื่องใหม่ /station อัตโนมัติ
  // (admin / supervisor ใช้หน้าปกติเหมือนเดิม) — session แชร์กันทั้งสองส่วนอยู่แล้ว
  const goStation = !!user && user.role === "operator";
  useEffect(() => {
    if (goStation) window.location.replace("/station");
  }, [goStation]);

  async function logout() {
    try { await logoutSession(); } catch (_) { /* ignore */ } // ยกเลิก token ฝั่ง DB
    clearSession();
    setUser(null);
  }

  // ★ session หมดอายุ/ถูกตัดจากเครื่องอื่น → เด้งออกจากระบบทันที ไม่ค้างในระบบแบบใช้งานไม่ได้
  //   (1) ฟัง event จาก supabase.js เมื่อ action ใดๆ เจอ 'invalid session' → ออกทันที
  //   (2) เช็คเป็นระยะ (heartbeat) เผื่อถูกตัด/หมดอายุขณะไม่ได้กดอะไร
  useEffect(() => {
    if (!user) return;
    let done = false;
    function forceOut(msg) {
      if (done) return; done = true;
      try { mlsToast(msg || "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่", "warn"); } catch (_) { /* ignore */ }
      clearSession(); setUser(null);
    }
    const onInvalid = () => forceOut();
    window.addEventListener("mls-session-invalid", onInvalid);
    async function check() {
      try {
        const r = await sessionHeartbeat();   // { ok, exists, superseded }
        if (r && (r.exists === false || r.superseded === true || r.expired === true)) {
          forceOut("บัญชีถูกใช้ที่อื่น หรือเซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่");
        }
      } catch (_) { /* เน็ตสะดุด — ไม่เตะออก */ }
    }
    check();
    const t = setInterval(check, 60000);   // เช็คทุก 60 วินาที
    return () => { done = true; window.removeEventListener("mls-session-invalid", onInvalid); clearInterval(t); };
  }, [user]);

  const content = !user
    ? <Login onLogin={setUser} />
    : goStation ? <LoginSplash text="กำลังเปิดหน้างาน…" /> : <Shell user={user} onLogout={logout} />;
  return <ErrorBoundary>
    {/* ทุกตารางหลังบ้านไม่ตัดบรรทัด (เดสก์ท็อป/แท็บเล็ต ≥768px) — ยาวเกินให้เลื่อนแนวนอนแทน · มือถือโหมดการ์ดไม่กระทบ */}
    <style>{`@media(min-width:768px){.data-table th,.data-table td,.pgrid th,.pgrid td{white-space:nowrap}.data-table td *{flex-wrap:nowrap!important}}`}</style>
    <UpdateBanner />{content}<Toaster /><ConfirmHost /><UndoHint />{user && <ScrollTopButton />}
  </ErrorBoundary>;
}
