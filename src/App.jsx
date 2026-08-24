import { useState, useEffect, useRef, useCallback, forwardRef, Component } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listRows, insertRow, insertRows, updateRow, updateRows, deleteRow, deleteRows,
  deleteReleaseCascade, deleteProjectCascade, getProjectImpact,
  findUnitByQr, getUnitHistory, getScanLogsBetween, getAllUnitsFull, getReleasesFull,
  deleteCap, getUnitStatsByReleaseIds, getReleaseOpProgress, supabase,
  recordScan, recordScanByQr, scanQueueCount, onScanQueue, flushScanQueue,
  createReleaseBatch, upsertEmployee, getProjectSummary, getProjectStationProgress, getPartSummary, getEmployees,
  logoutSession, setEmployeeActive, deleteEmployee, deleteMachine, recalcPartStatus,
  exportAllData,
  ensureDailyBackup, listBackups, snapshotAllProjects, restoreBackup, importBackup,
} from "./supabase.js";
import { ROLE_LABELS, getSession, setSession, clearSession, verifyLogin, isAdmin, canManage } from "./auth.js";
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
  machineDailyMatrix, missingWeightParts,
} from "./metrics.js";
import Icon from "./icons.jsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── Chart theme (matches CSS custom properties — recharts needs literal values) ──
const CHART = {
  grid: "#e1e9e5", muted: "#6d7d76", tooltipBg: "#ffffff", tooltipBorder: "#e1e9e5",
  text: "#142420", accent: "#10b981", success: "#22c55e",
};

// ปุ่มสลับภาษา ไทย/EN — ปุ่มเดียวโชว์ภาษาที่จะสลับไป (แบบเดียวกับหน้าเครื่อง)
function LangToggle() {
  const [lang, setLang] = useLang();
  return (
    <button className="lang-toggle-btn" onClick={() => setLang(lang === "th" ? "en" : "th")}
      title="สลับภาษา / Switch language"
      style={{ appearance: "none", cursor: "pointer", fontFamily: "inherit",
        fontSize: 13, fontWeight: 800, lineHeight: 1, letterSpacing: ".03em",
        padding: "5px 12px", borderRadius: 8, marginBottom: 10, alignSelf: "flex-start",
        border: "1.5px solid var(--accent, #10b981)", background: "transparent", color: "var(--accent, #10b981)" }}>
      {lang === "th" ? "EN" : "ไทย"}
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
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} ชม. ${String(m).padStart(2, "0")} น.` : `${m} น.`;
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
              <div className={`rail-label ${done ? "done" : isCurrent ? "current" : ""}`}>{op}</div>
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
function Login({ onLogin }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const user = await verifyLogin(code, password);
    setBusy(false);
    if (!user) { setErr("รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง"); return; }
    setSession(user);
    enterFullscreen();   // ล็อกอินสำเร็จ = user gesture → เข้าเต็มจอทันที
    onLogin(user);
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
        <Field label="รหัสพนักงาน">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น admin" autoFocus />
        </Field>
        <Field label="รหัสผ่าน">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        {err && <div style={{ color: "var(--danger-hi)", fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <Btn variant="accent" size="lg" className="btn-block" disabled={busy}>
          {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </Btn>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 18, lineHeight: 1.7, textAlign: "center" }}>
          ค่าเริ่มต้น: admin / admin123<br />ระบบจะออกจากระบบอัตโนมัติเมื่อปิดแท็บนี้
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
  ] },
  { group: "สรุปภาพรวม", items: [
    { key: "machines", label: "สรุปเครื่องจักร", icon: "machine" },
    { key: "parts", label: "สรุป Part", icon: "grid" },
  ] },
  { group: "จัดการ", items: [
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

function Shell({ user, onLogout }) {
  const [tab, setTab] = useState("projects");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [labelsPreselect, setLabelsPreselect] = useState(""); // release id ที่ส่งมาจากหน้ารายละเอียด Release เพื่อเปิดหน้าพิมพ์ QR แบบเลือกล็อตให้อัตโนมัติ

  const menu = menuForUser(user); // เมนูตามสิทธิ์ของ user คนนี้
  const currentLabel = MENU.flatMap((g) => g.items).find((i) => i.key === tab)?.label || "";

  function go(key, opts) {
    if (!canOpenTab(user, key)) return; // กันเปิดแท็บที่ไม่มีสิทธิ์ (เช่น ยิงจากปุ่มลึกๆ)
    setTab(key);
    setDrawerOpen(false);
    if (opts?.releaseId) setLabelsPreselect(opts.releaseId);
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
                <Icon name={it.icon} size={17} />{it.label}
              </div>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <LangToggle />
          <div className="user-chip">
            <div className="user-avatar">{(user.name || "U").slice(0, 1)}</div>
            <div>
              <div className="user-name">{user.name}</div>
              <div className="user-role">{ROLE_LABELS[user.role] || user.role}</div>
            </div>
          </div>
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
                <Icon name={it.icon} size={17} />{it.label}
              </div>
            ))}
          </div>
        ))}
        <div className="nav-item logout-item" onClick={onLogout} style={{ marginTop: 10, borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
          <Icon name="logout" size={17} />ออกจากระบบ
        </div>
      </div>

      {/* ── Page content ── */}
      <div className="content">
        <div className="content-inner">
          {tab === "release" && <ReleasePage user={user} goTo={go} />}
          {tab === "labels" && <QrLabelsPage initialReleaseId={labelsPreselect} onConsumeInitial={() => setLabelsPreselect("")} />}
          {tab === "report" && <ReportPage />}
          {tab === "machines" && <MachinesSummaryPage />}
          {tab === "projects" && <ProjectsPage user={user} goTo={go} />}
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
  material: [/material/i, /วัสดุ/i, /วัตถุดิบ/i],
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
                {o.name}{active ? ` (${form.routing.indexOf(o.name) + 1})` : ""}
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

// ─── เพิ่ม Release (ป็อปอัป) — กรอกหัวเอกสาร + วางข้อมูล Part จาก Excel ได้เลย ──
// หัวเอกสาร: Release Order (P-xxx), วันที่, โปรเจค
// ตาราง Part: วาง (paste) จาก Excel ได้ทั้งบล็อก — คอลัมน์ตรงตามฟอร์ม Production
// Release Report (Code, Qty, Length, Weight/M, Material, Total Kg, Remark)
// แต่ละแถว = 1 release + สร้าง QR ต่อชิ้นให้ครบตาม Qty (เหมือนการนำเข้า Excel)
const BLANK_ROW = () => ({ id: Math.random().toString(36).slice(2), code: "", rev: "", qty: "", length_mm: "", weight_per_m: "", material: "", remark: "", routing: [] });

function AddReleaseModal({ user, projects, parts, onClose, onSaved, onNeedProject }) {
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
  //  - หลายคอลัมน์ (มี tab) → เติมทั้งแถวตามลำดับคอลัมน์ เริ่มจากแถวที่โฟกัส
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
        const parsed = parsePastedRows(text);
        parsed.forEach((data, i) => {
          const idx = rowIndex + i;
          ensure(idx);
          next[idx] = { ...next[idx], ...data };
        });
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
  const totalKg = validRows.reduce((s, r) => s + (qtyOf(r) * (rowWeightPcs(r) || 0)), 0);
  const partsInProject = parts.filter((p) => p.project_id === projectId);

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
        unit_weight: rowWeightPcs(r),
        length_mm: gnum(r.length_mm),
        material: r.material?.trim() || null,
        remark: r.remark?.trim() || null,
        routing: [],                      // ไม่ใช้ Routing แล้ว — ขั้นตอนขึ้นกับเครื่องที่ทำ
      }));
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
      onSaved({ releaseOrder: ro, ...res });
    } catch (e2) {
      setErr("เกิดข้อผิดพลาดระหว่างบันทึก: " + e2.message + " — ระบบยกเลิกทั้งใบอัตโนมัติ ไม่มีข้อมูลค้าง");
    }
    setBusy(false); setProgress("");
  }

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

      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>
        วางจาก Excel ได้ทั้งบล็อก — คอลัมน์: <b>Code · จำนวน · Length · Weight/M · Material · Total Kg · Remark</b>{" "}
        (คอลัมน์ No. และ Total Kg ระบบจัดการ/คำนวณให้เอง) · น้ำหนัก/ชิ้น = (Length ÷ 1000) × Weight/M
        <br />จำนวนเว้นว่างได้ = 1 อัตโนมัติ · ขั้นตอนการทำงานขึ้นกับ "เครื่อง" ที่ทำ (ไม่ต้องตั้ง Routing ต่อ Part แล้ว)
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
              <th style={{ minWidth: 130 }}>Code *</th>
              <th style={{ width: 64 }}>REV.</th>
              <th style={{ width: 78 }}>จำนวน</th>
              <th style={{ width: 90 }}>Length (มม.)</th>
              <th style={{ width: 90 }}>Weight/M</th>
              <th style={{ minWidth: 110 }}>Material</th>
              <th style={{ width: 92, textAlign: "right" }}>น้ำหนัก/ชิ้น</th>
              <th style={{ width: 92, textAlign: "right" }}>Total Kg</th>
              <th style={{ minWidth: 110 }}>Remark</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const wpcs = rowWeightPcs(r);
              const tkg = rowTotalKg(r);
              return (
                <tr key={r.id}>
                  <td className="pgrid-idx">{i + 1}</td>
                  <td><input value={r.code} onChange={(e) => setCell(r.id, "code", e.target.value)} onPaste={(e) => handlePaste(e, i, "code")} placeholder="AN04-001-01" /></td>
                  <td><input value={r.rev} onChange={(e) => setCell(r.id, "rev", e.target.value)} onPaste={(e) => handlePaste(e, i, "rev")} placeholder="0" /></td>
                  <td><input value={r.qty} onChange={(e) => setCell(r.id, "qty", e.target.value)} onPaste={(e) => handlePaste(e, i, "qty")} inputMode="numeric" /></td>
                  <td><input value={r.length_mm} onChange={(e) => setCell(r.id, "length_mm", e.target.value)} onPaste={(e) => handlePaste(e, i, "length_mm")} inputMode="decimal" /></td>
                  <td><input value={r.weight_per_m} onChange={(e) => setCell(r.id, "weight_per_m", e.target.value)} onPaste={(e) => handlePaste(e, i, "weight_per_m")} inputMode="decimal" /></td>
                  <td><input value={r.material} onChange={(e) => setCell(r.id, "material", e.target.value)} onPaste={(e) => handlePaste(e, i, "material")} /></td>
                  <td className="pgrid-ro">{wpcs != null ? fmtNum(wpcs) : "-"}</td>
                  <td className="pgrid-ro">{tkg != null ? fmtNum(tkg) : "-"}</td>
                  <td><input value={r.remark} onChange={(e) => setCell(r.id, "remark", e.target.value)} onPaste={(e) => handlePaste(e, i, "remark")} /></td>
                  <td className="pgrid-del" onClick={() => removeRow(r.id)} title="ลบแถว">✕</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

  const partsInProject = parts.filter((p) => p.project_id === projectId);
  const rowsPreview = (parsed?.items || []).map((it) => ({
    ...it,
    existingPart: partsInProject.find((p) => p.part_no.trim().toLowerCase() === it.code.trim().toLowerCase()),
  }));
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
      const res = await createReleaseBatch({
        projectId, releaseOrder: parsed.releaseOrder, releaseDate: null,
        releasedBy: user.id, makeQr: true, rows,
      });
      onImported({ releaseOrder: parsed.releaseOrder, ...res });
      onClose();
    } catch (e2) {
      setErr("เกิดข้อผิดพลาดระหว่างนำเข้า: " + e2.message + " — ระบบยกเลิกทั้งใบอัตโนมัติ ไม่มีข้อมูลค้าง");
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
                <tr><th>Code</th><th>Qty</th><th>ยาว (มม.)</th><th>น้ำหนัก/ชิ้น</th><th>วัสดุ</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {rowsPreview.map((r, i) => (
                  <tr key={i}>
                    <td>{r.code}</td>
                    <td>{r.qty}</td>
                    <td>{r.length_mm ? fmtNum(r.length_mm) : "-"}</td>
                    <td>{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}</td>
                    <td>{r.material || "-"}</td>
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

// ── ตัวช่วยกลาง: คำนวณ "จำนวนเสร็จ" ของกลุ่ม Release ให้ทุกหน้าตรงกัน ──────────
//   นิยามเดียว (ใช้เหมือนกันทั้ง Projects, รายการ Release, รายละเอียด Release):
//   เสร็จ = max( เสร็จจากสแกนสำนักงาน (part_units.status),
//                เสร็จจากขั้นตอนสุดท้ายของงานหน้าเครื่อง (machine_records) )  ไม่เกินจำนวนสั่ง
//   → เลิกขัดกันเอง (เดิมพอมีงานหน้าเครื่องแม้แถวเดียว จะทิ้งยอดสำนักงานทันที = 400/400 กลายเป็น 0%)
function computeGroupProgress(releases, unitStats, opProg, totalQty) {
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
  const lastOp = opAgg.length ? opAgg[opAgg.length - 1] : null;
  const stationFinished = lastOp ? Math.min(lastOp.finished, totalQty) : 0;
  const officeFinished = releases.reduce((s, r) => s + (unitStats?.[r.id]?.finished || 0), 0);
  const finished = Math.min(Math.max(officeFinished, stationFinished), totalQty);
  // งานหน้าเครื่องเป็น "ตัวหลัก" เมื่อยอดหน้าเครื่อง ≥ ยอดสำนักงาน และมากกว่า 0
  const stationDrove = stationFinished > 0 && stationFinished >= officeFinished;
  return { finished, officeFinished, stationFinished, opAgg, lastOp, stationDrove };
}

// ── Mini progress bar (inline, no extra deps) ───────────────────────────────
function ProgressBar({ pct, finished, total }) {
  // "เสร็จจริง" = ชิ้นครบ (ไม่ใช่แค่ % ปัดขึ้นถึง 100) — กัน 199/200 = 99.5% ปัดเป็น 100% เขียว
  const complete = (finished != null && total != null && total > 0) ? finished >= total : pct >= 100;
  let p = Math.min(100, Math.max(0, pct));
  if (!complete && p >= 100) p = 99;   // ยังไม่ครบ อย่าเพิ่งโชว์ 100%
  const color = complete ? "var(--success)" : p > 0 ? "var(--accent-dk)" : "var(--border)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 160 }}>
      <div style={{ flex: 1, height: 7, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden", border: "1px solid var(--border)" }}>
        <div style={{ width: `${p}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, whiteSpace: "nowrap", minWidth: 38, textAlign: "right" }}>
        {p}%
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
function PartProgressModal({ release, user, onClose }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [opProg, setOpProg] = useState([]);   // [{op, seq, done, finished}] ความคืบหน้าแยกขั้นตอน (งานหน้าเครื่อง)
  const [finished, setFinished] = useState(0);
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
        const [stats, prog] = await Promise.all([
          getUnitStatsByReleaseIds([release.id]),
          getReleaseOpProgress([release.id]),
        ]);
        if (!alive) return;
        const s = stats[release.id] || { total: release.qty || 0, finished: 0, inProgress: 0 };
        setTotalUnits(s.total || release.qty || 0);
        setFinished(s.finished || 0);
        setInProgress(s.inProgress || 0);
        setOpProg(Array.isArray(prog[release.id]) ? prog[release.id] : []);
        setLoading(false);
      } catch (e) {
        if (alive) { setErr("โหลดข้อมูลไม่สำเร็จ: " + e.message); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [release]);

  // เรียงขั้นตอนตาม routing ก่อน แล้วต่อด้วยขั้นตอนที่มีงานจริงแต่ไม่อยู่ใน routing
  const opMap = new Map(opProg.map((o) => [o.op, o]));
  const extraOps = opProg.filter((o) => !routing.includes(o.op)).map((o) => o.op);
  const stages = [...routing, ...extraOps];
  const notStarted = Math.max(0, totalUnits - finished - inProgress);

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
              <div style={{ ...cellVal, color: finished > 0 ? "var(--success)" : "var(--muted)" }}>{fmtNum(finished)} ชิ้น</div>
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

          {/* ── ทำแต่ละขั้นตอนไปแล้วกี่ชิ้น (งานหน้าเครื่อง) ─────────────────── */}
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>ทำแต่ละขั้นตอนไปแล้วกี่ชิ้น</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
            นับจากงานที่บันทึกหน้าเครื่องจริง แยกแต่ละขั้นตอน — <b>ทำแล้ว</b> = ทุกสถานะ · <b>เสร็จ</b> = กด Finished · เทียบกับจำนวนสั่ง {fmtNum(totalUnits)} ชิ้น
          </div>
          {stages.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "2px 2px 6px", lineHeight: 1.6 }}>
              {routing.length === 0
                ? "Part นี้ยังไม่ได้ตั้ง Routing — ไปตั้งขั้นตอนที่ Setup › Part Master ก่อน"
                : "ยังไม่มีการบันทึกงานหน้าเครื่องสำหรับ Part นี้"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {stages.map((op, i) => {
                const e = opMap.get(op) || { done: 0, finished: 0 };
                const done = Number(e.done) || 0;
                const fin = Number(e.finished) || 0;
                const pct = totalUnits > 0 ? Math.round((done / totalUnits) * 100) : 0;
                const over = done > totalUnits;
                const inRouting = routing.includes(op);
                return (
                  <div key={op}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginBottom: 4, gap: 10 }}>
                      <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {inRouting && <span className="stage-seq">{i + 1}</span>}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{op}</span>
                        {!inRouting && <span style={{ fontWeight: 400, fontSize: 11, color: "var(--muted)" }}>(นอก routing)</span>}
                      </span>
                      <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                        ทำแล้ว {fmtNum(done)} / {fmtNum(totalUnits)} ชิ้น
                        {fin > 0 ? <span style={{ color: "var(--success)" }}> · เสร็จ {fmtNum(fin)}</span> : null}
                        {over ? <span style={{ color: "var(--warning)" }}> · เกิน (สแปร์)</span> : null}
                      </span>
                    </div>
                    <ProgressBar pct={Math.min(pct, 100)} finished={done} total={totalUnits} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="modal-actions">
        <Btn type="button" variant="ghost" onClick={onClose}>ปิด</Btn>
      </div>
    </Modal>
  );
}

function ReleaseGroupDetail({ group, user, onBack, goTo, onHome, onChanged }) {
  const canEdit = canManage(user);   // admin / supervisor เท่านั้นที่แก้ไข/ลบได้
  // สำเนา releases แบบ local เพื่อให้แก้ไข/ลบ สะท้อนทันทีในหน้านี้ (ยอดรวมคิดใหม่ตามนี้)
  const [releases, setReleases] = useState(group.releases);
  const [unitStats, setUnitStats] = useState({});
  const [opProg, setOpProg] = useState({});   // ความคืบหน้าแยกขั้นตอน (งานหน้าเครื่อง) ต่อ release
  const [statsLoading, setStatsLoading] = useState(true);
  const [viewPart, setViewPart] = useState(null); // release row ที่กำลังดูความคืบหน้าแยกขั้นตอน
  const [editing, setEditing] = useState(null);   // release ที่กำลังแก้ไข
  const [busyId, setBusyId] = useState(null);     // release ที่กำลังลบ
  const sort = useTableSort();

  // ยอดรวมคิดจาก releases ปัจจุบัน (อัปเดตเมื่อแก้ไข/ลบ)
  const totalQty = releases.reduce((s, r) => s + (r.qty || 0), 0);
  const totalWeight = releases.reduce((s, r) => s + (r.qty || 0) * (r.unit_weight || 0), 0);
  const notes = new Set(releases.map((r) => r.note).filter(Boolean));
  const noteLabel = notes.size === 0 ? "-" : notes.size === 1 ? [...notes][0] : `${notes.size} หมายเหตุ`;

  const loadStats = useCallback((list = releases) => {
    const ids = list.map((r) => r.id);
    if (ids.length === 0) { setUnitStats({}); setOpProg({}); setStatsLoading(false); return; }
    setStatsLoading(true);
    Promise.all([getUnitStatsByReleaseIds(ids), getReleaseOpProgress(ids)])
      .then(([s, op]) => { setUnitStats(s); setOpProg(op || {}); setStatsLoading(false); });
  }, [releases]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // ── ลบ Release (พร้อม QR + ประวัติสแกนของล็อตนั้น) ───────────────────────
  async function handleDelete(r) {
    setBusyId(r.id);
    try {
      const units = await listRows("part_units", { filters: { release_id: r.id } });
      const scanned = units.filter((u) => u.status !== "released").length;
      const msg = scanned > 0
        ? `ล็อตนี้มี ${units.length} ชิ้น และมี ${scanned} ชิ้นที่สแกนไปแล้ว (มีประวัติการทำงาน)\n\nการลบ Release นี้จะลบ QR และประวัติสแกนของชิ้นทั้งหมดในล็อตนี้ไปด้วย และกู้คืนไม่ได้\n\nยืนยันที่จะลบหรือไม่?`
        : `ล็อตนี้มี ${units.length} ชิ้น (ยังไม่มีการสแกน)\n\nต้องการลบ Release นี้พร้อม QR ทั้งหมดหรือไม่? การลบกู้คืนไม่ได้`;
      if (!confirm(msg)) { setBusyId(null); return; }
      await deleteReleaseCascade(r.id);
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
  const { finished: totalFinished, opAgg, lastOp, stationDrove } =
    computeGroupProgress(releases, unitStats, opProg, totalQty);
  const totalInProgress = stationDrove
    ? Math.max(0, Math.min(lastOp.done, totalQty) - totalFinished)
    : releases.reduce((sum, r) => sum + (unitStats[r.id]?.inProgress || 0), 0);
  const pctOverall = totalQty > 0 ? Math.round((totalFinished / totalQty) * 100) : 0;
  const avgW = totalQty > 0 ? totalWeight / totalQty : 0;
  const finishedWeight = stationDrove
    ? totalFinished * avgW
    : releases.reduce((sum, r) => sum + (unitStats[r.id]?.finished || 0) * wPer(r), 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <Btn variant="ghost" size="sm" onClick={onBack}>
              <Icon name="arrowLeft" size={14} /> กลับไปหน้า Release
            </Btn>
            <Btn variant="ghost" size="sm" onClick={loadStats} title="โหลดความคืบหน้าล่าสุด">
              <Icon name="refresh" size={14} /> รีเฟรช
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => (onHome ? onHome() : onBack())} title="กลับหน้าแรก">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: "-2px" }}>
                <path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              หน้าแรก
            </Btn>
          </div>
          <div className="page-title">{group.releaseOrder ? `Release Order: ${group.releaseOrder}` : `Release — ${releases[0]?.part_master?.part_no || ""}`}</div>
          <div className="page-sub">{group.projectCode} — {group.projectName} · {fmtD(group.date)}</div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Card>
          <div className="label-el">จำนวนรวม</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(totalQty)} ชิ้น</div>
        </Card>
        <Card>
          <div className="label-el">น้ำหนักรวม</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(totalWeight)} กก.</div>
        </Card>
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
              <div style={{ fontSize: 12, color: "var(--accent-dk)", fontWeight: 600, marginTop: 6 }}>
                น้ำหนักที่ทำแล้ว: {fmtNum(finishedWeight)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>/ {fmtNum(totalWeight)} กก.</span>
              </div>
              {stationDrove && lastOp && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                  * นับจากขั้นตอนสุดท้าย ({lastOp.op}) ของงานหน้าเครื่อง
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
      </div>

      {!statsLoading && opAgg.length > 0 && (
        <Card title="ความคืบหน้าตามขั้นตอน (งานหน้าเครื่อง)">
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
            นับจากงานที่บันทึกหน้าเครื่องจริง แยกแต่ละขั้นตอน (ตัด/เจาะ/บาก) — <b>ทำแล้ว</b> = ทุกสถานะ · <b>เสร็จ</b> = กด Finished · เทียบกับจำนวนสั่ง {fmtNum(totalQty)} ชิ้น
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {opAgg.map((o) => {
              const pct = totalQty > 0 ? Math.round((o.done / totalQty) * 100) : 0;
              const over = o.done > totalQty;
              return (
                <div key={o.op}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{o.op}</span>
                    <span style={{ color: "var(--muted)" }}>
                      ทำแล้ว {fmtNum(o.done)} / {fmtNum(totalQty)} ชิ้น
                      {o.finished > 0 ? <span style={{ color: "var(--success)" }}> · เสร็จ {fmtNum(o.finished)}</span> : null}
                      {over ? <span style={{ color: "var(--alert, #d97a00)" }}> · เกิน (สแปร์)</span> : null}
                    </span>
                  </div>
                  <ProgressBar pct={Math.min(pct, 100)} finished={o.done} total={totalQty} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="รายละเอียดแต่ละ Part ในล็อตนี้">
        <SortControl sort={sort} options={[
          { k: "part_no", label: "Part No." }, { k: "part_name", label: "ชื่อ Part" }, { k: "qty", label: "จำนวน" },
          { k: "finished", label: "เสร็จแล้ว" }, { k: "progress", label: "ความคืบหน้า" },
          { k: "uw", label: "น้ำหนัก/ชิ้น" }, { k: "tw", label: "น้ำหนักรวม" }, { k: "len", label: "ความยาว/ชิ้น" },
        ]} />
        <div className="table-wrap tall-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <SortTh k="part_no" sort={sort}>Part No.</SortTh>
                <SortTh k="part_name" sort={sort}>ชื่อ Part</SortTh>
                <SortTh k="qty" sort={sort}>จำนวน</SortTh>
                <SortTh k="finished" sort={sort}>เสร็จแล้ว</SortTh>
                <SortTh k="progress" sort={sort}>ความคืบหน้า</SortTh>
                <SortTh k="uw" sort={sort}>น้ำหนัก/ชิ้น</SortTh>
                <SortTh k="tw" sort={sort}>น้ำหนักรวม</SortTh>
                <SortTh k="len" sort={sort}>ความยาว/ชิ้น</SortTh>
                <th>หมายเหตุ</th>
                {canEdit && <th>จัดการ</th>}
                <th>พิมพ์</th>
                <th>ขั้นตอน</th>
              </tr>
            </thead>
            <tbody>
              {sort.sortRows(releases, {
                part_no: (r) => r.part_master?.part_no || "", part_name: (r) => r.part_master?.part_name || "",
                qty: (r) => Number(r.qty) || 0,
                finished: (r) => unitStats[r.id]?.finished ?? 0,
                progress: (r) => { const t = unitStats[r.id]?.total ?? r.qty; return t > 0 ? (unitStats[r.id]?.finished ?? 0) / t : 0; },
                uw: (r) => Number(r.unit_weight) || 0,
                tw: (r) => (Number(r.unit_weight) || 0) * (Number(r.qty) || 0),
                len: (r) => Number(r.length_mm) || 0,
              }).map((r) => {
                const st = unitStats[r.id] || null;
                const finished = st?.finished ?? 0;
                const total = st?.total ?? r.qty;
                const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
                return (
                  <tr key={r.id} className="release-row" onClick={() => setViewPart(r)} title="กดเพื่อดูความคืบหน้าแยกขั้นตอน">
                    <td data-label="Part No." style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.part_master?.part_no || "-"}</td>
                    <td data-label="ชื่อ Part" style={{ whiteSpace: "nowrap" }}>{r.part_master?.part_name || "-"}</td>
                    <td data-label="จำนวน">{fmtNum(r.qty)}</td>
                    <td data-label="เสร็จแล้ว">
                      {statsLoading ? (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span>
                      ) : (
                        <span style={{ fontWeight: 600, color: finished > 0 ? "var(--success)" : "var(--muted)" }}>
                          {fmtNum(finished)} ชิ้น
                        </span>
                      )}
                    </td>
                    <td data-label="ความคืบหน้า" style={{ minWidth: 180 }}>
                      {statsLoading ? (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span>
                      ) : (
                        <ProgressBar pct={pct} finished={finished} total={total} />
                      )}
                    </td>
                    <td data-label="น้ำหนัก/ชิ้น">{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}</td>
                    <td data-label="น้ำหนักรวม">{r.unit_weight ? `${fmtNum(r.qty * r.unit_weight)} กก.` : "-"}</td>
                    <td data-label="ความยาว/ชิ้น">{r.length_mm ? `${fmtNum(r.length_mm)} มม.` : "-"}</td>
                    <td data-label="หมายเหตุ">{r.note || "-"}</td>
                    {canEdit && (
                      <td data-label="จัดการ" style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <span onClick={() => setEditing(r)} style={{ color: "var(--accent-dk)", cursor: "pointer" }}>
                          {busyId === r.id ? "กำลังลบ..." : "แก้ไข"}
                        </span>
                      </td>
                    )}
                    <td data-label="พิมพ์">
                      <span onClick={(e) => { e.stopPropagation(); goTo && goTo("labels", { releaseId: r.id }); }} style={{ color: "var(--accent-dk)", cursor: "pointer", whiteSpace: "nowrap" }}>
                        <Icon name="printer" size={13} /> พิมพ์ QR
                      </span>
                    </td>
                    <td data-label="" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                      ดูขั้นตอน <Icon name="arrowLeft" size={12} style={{ transform: "rotate(180deg)", verticalAlign: "-1px" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {noteLabel !== "-" && notes.size > 1 && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>หมายเหตุทั้งหมด: {[...notes].join(" · ")}</div>
      )}

      {viewPart && <PartProgressModal release={viewPart} user={user} onClose={() => { setViewPart(null); loadStats(); }} />}
      {editing && (
        <ReleaseEditModal
          release={editing}
          onClose={() => setEditing(null)}
          onSaved={afterEdit}
          onDelete={() => { const r = editing; setEditing(null); handleDelete(r); }}
        />
      )}
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
  const [showNewProject, setShowNewProject] = useState(false);
  const [viewGroup, setViewGroup] = useState(null); // group ที่กำลังดูรายละเอียดอยู่ (null = แสดงตารางสรุป)
  const sort = useTableSort();   // เรียงตารางประวัติ Release ตามหัวข้อ
  // สถิติความคืบหน้า (finished / total) ของแต่ละ release — โหลดหลังได้รายการ
  const [allUnitStats, setAllUnitStats] = useState({});

  // ── ค้นหา/กรองประวัติ: วันที่ (จาก–ถึง) · โปรเจค · เลข Release Order ──
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [orderSearch, setOrderSearch] = useState("");

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
      getUnitStatsByReleaseIds(ids).then(setAllUnitStats);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // กรองที่ระดับ release ก่อน แล้วค่อยจัดกลุ่ม เพื่อให้ค้นหาครอบคลุมทั้งประวัติ
  const filteredReleases = recent.filter((r) => {
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
          <Btn variant="accent" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={15} />เพิ่ม Release
          </Btn>
          <Btn variant="ghost" className="release-import-btn" onClick={() => setShowImport(true)}>
            <Icon name="folder" size={15} />นำเข้าจาก Excel (หลาย Part)
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

      <Card title={hasFilter ? `ผลการค้นหา (${groups.length})` : "ประวัติการ Release ล่าสุด"}>
        <SortControl sort={sort} options={[
          { k: "date", label: "วันที่" }, { k: "project", label: "โปรเจค" }, { k: "order", label: "Release Order" },
          { k: "parts", label: "Part No." }, { k: "qty", label: "จำนวน" }, { k: "progress", label: "ความคืบหน้า" }, { k: "weight", label: "น้ำหนักรวม" },
        ]} />
        <div className="table-wrap tall-scroll">
          <table className="data-table responsive-cards">
            <thead><tr>
              <SortTh k="date" sort={sort}>วันที่</SortTh>
              <SortTh k="project" sort={sort}>โปรเจค</SortTh>
              <SortTh k="order" sort={sort}>Release Order</SortTh>
              <SortTh k="parts" sort={sort}>Part No.</SortTh>
              <SortTh k="qty" sort={sort}>จำนวน</SortTh>
              <SortTh k="progress" sort={sort}>ความคืบหน้า</SortTh>
              <SortTh k="weight" sort={sort}>น้ำหนักรวม</SortTh>
              <th>หมายเหตุ</th>
            </tr></thead>
            <tbody>
              {sort.sortRows(groups, {
                date: (g) => new Date(g.date).getTime() || 0,
                project: (g) => g.projectCode || "",
                order: (g) => g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? ""),
                parts: (g) => g.releases.length,
                qty: (g) => g.totalQty || 0,
                weight: (g) => g.totalWeight || 0,
                progress: (g) => {
                  const t = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.total ?? r.qty), 0);
                  const f = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.finished || 0), 0);
                  return t > 0 ? f / t : 0;
                },
              }).map((g) => {
                // รวม stats ของทุก release ในกลุ่มนี้
                const gFinished = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.finished || 0), 0);
                const gTotal = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.total ?? r.qty), 0);
                const gPct = gTotal > 0 ? Math.round((gFinished / gTotal) * 100) : null;
                const statsReady = g.releases.every((r) => r.id in allUnitStats);
                return (
                  <tr key={g.key} className="release-row" onClick={() => setViewGroup(g)}>
                    <td data-label="วันที่">{fmtD(g.date)}</td>
                    <td data-label="โปรเจค">{g.projectCode}</td>
                    <td data-label="Release Order">{g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? "-")}</td>
                    <td data-label="Part No.">{fmtNum(g.releases.length)} Part</td>
                    <td data-label="จำนวน">{fmtNum(g.totalQty)} ชิ้น</td>
                    <td data-label="ความคืบหน้า" style={{ minWidth: 160 }}>
                      {statsReady && gPct !== null ? (
                        <ProgressBar pct={gPct} finished={gFinished} total={gTotal} />
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td data-label="น้ำหนักรวม">{g.totalWeight ? `${fmtNum(g.totalWeight)} กก.` : "-"}</td>
                    <td data-label="หมายเหตุ">{g.notes.size === 0 ? "-" : g.notes.size === 1 ? [...g.notes][0] : `${g.notes.size} หมายเหตุ`}</td>
                  </tr>
                );
              })}
              {!loading && groups.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                  {hasFilter ? "ไม่พบ Release ตามเงื่อนไขที่ค้นหา" : "ยังไม่มี Release — กด \"เพิ่ม Release\" เพื่อเริ่ม"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
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
              <div className="label-el">เครื่องจักรประจำ</div>
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
            <div className="empty-state-title">ยังไม่ได้ตั้งค่าเครื่องจักร/ขั้นตอนประจำ</div>
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
        no_station: "บัญชีนี้ยังไม่ได้ตั้งเครื่องจักร/ขั้นตอนประจำ — แจ้ง Admin",
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
              ⏳ ค้างซิงค์ {pending}
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
// เนื้อหา Finished Part (สถิติ + ตาราง) — ใช้ซ้ำได้ทั้งหน้าเดี่ยวและฝังใน Report
function FinishedPartSection() {
  const [units, setUnits] = useState([]);
  const sort = useTableSort();
  useEffect(() => { getAllUnitsFull("finished").then(setUnits); }, []);
  const totalWeight = units.reduce((s, u) => s + Number(u.weight || u.part_master?.unit_weight || 0), 0);
  return (
    <>
      <div className="stat-row">
        <StatCard label="ชิ้นที่เสร็จทั้งหมด" value={units.length.toLocaleString()} icon="check" />
        <StatCard label="น้ำหนักวัสดุ (กก.)" value={fmtNum(totalWeight)} icon="weight" />
      </div>
      <Card title="รายการชิ้นงานที่เสร็จสมบูรณ์">
        {units.length === 0 ? (
          <div className="empty-state">
            <Icon name="check" size={32} />
            <div className="empty-state-title">ยังไม่มีชิ้นงานที่เสร็จสมบูรณ์</div>
            <div className="empty-state-sub">รายการจะปรากฏที่นี่เมื่อชิ้นงานผ่านครบทุกขั้นตอนตาม Routing</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>
                <SortTh k="qr" sort={sort}>QR</SortTh>
                <SortTh k="part" sort={sort}>Part</SortTh>
                <SortTh k="proj" sort={sort}>โปรเจค</SortTh>
                <SortTh k="weight" sort={sort}>น้ำหนัก</SortTh>
                <SortTh k="len" sort={sort}>ความยาว</SortTh>
              </tr></thead>
              <tbody>
                {sort.sortRows(units, {
                  qr: (u) => u.qr_code || "", part: (u) => u.part_master?.part_no || "",
                  proj: (u) => u.part_master?.projects?.name || "",
                  weight: (u) => Number(u.weight || u.part_master?.unit_weight || 0),
                  len: (u) => Number(u.length_mm || u.part_master?.default_length_mm || 0),
                }).map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{u.qr_code}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{u.part_master?.part_no} — {u.part_master?.part_name}</td>
                    <td>{u.part_master?.projects?.name || "-"}</td>
                    <td>{fmtNum(u.weight || u.part_master?.unit_weight)}</td>
                    <td>{u.length_mm || u.part_master?.default_length_mm ? `${fmtNum(u.length_mm || u.part_master?.default_length_mm)} มม.` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  const relsInProject = releases.filter((r) => (!projectFilter || partOf(r)?.project_id === projectFilter) && matchSearch(r));
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
            ? (total != null ? `รวม ${total} ชิ้น` : "")   // ป้ายรวมล็อต: โชว์จำนวนทั้งล็อต
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
              options={filteredReleases.map((r) => ({ value: r.id, label: `${fmtD(r.release_date)} — ${partOf(r)?.part_no || "-"}${r.release_order ? ` · ${r.release_order}` : ""} × ${r.qty} ชิ้น` }))} />
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
  const [units, setUnits] = useState(null); // null = ยังโหลดไม่เสร็จ
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    listRows("part_units", { filters: { release_id: release.id }, order: "unit_no" }).then(setUnits);
  }, [release.id]);

  const scannedCount = units ? units.filter((u) => u.status !== "released").length : 0;
  const releasedCount = units ? units.length - scannedCount : 0;
  const qtyNum = Number(qty) || 0;
  const delta = qtyNum - release.qty;

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
        const partNo = release.part_master?.part_no || "PART";
        const newUnits = Array.from({ length: delta }, (_, i) => ({
          release_id: release.id,
          part_master_id: release.part_master_id,
          unit_no: maxUnitNo + i + 1,
          qr_code: `${partNo}-${suffix}-${String(maxUnitNo + i + 1).padStart(4, "0")}`,
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

      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + e.message);
    }
    setBusy(false);
  }

  return (
    <Modal title="แก้ไข Release" sub={`Part ${release.part_master?.part_no || "-"} — โปรเจค ${release.part_master?.projects?.code || "-"}`} onClose={onClose}>
      {units === null ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>กำลังโหลด...</div>
      ) : (
        <>
          <div className="grid-2">
            <Field label="จำนวน (ชิ้น)">
              <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
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
          <Field label="หมายเหตุ">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่บังคับ" />
          </Field>

          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
            ตอนนี้มี {units.length} ชิ้น — สแกนไปแล้ว {scannedCount} ชิ้น, ยังไม่สแกน {releasedCount} ชิ้น
            {delta > 0 && <><br />จะสร้าง QR เพิ่มอีก <b>{delta}</b> ใบ ต่อท้ายล็อตเดิม</>}
            {delta < 0 && <><br />จะลบ QR ที่ยังไม่สแกนออก <b>{Math.abs(delta)}</b> ใบ</>}
          </div>

          {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

          <div className="modal-actions" style={{ justifyContent: "space-between" }}>
            {onDelete ? (
              <Btn type="button" variant="ghost" onClick={onDelete} disabled={busy}
                style={{ color: "var(--danger-hi)" }}>
                ลบ Part นี้
              </Btn>
            ) : <span />}
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

function ReportPage() {
  // ── Flexible date filter: quick preset / specific month / custom from–to ──
  const [rangeMode, setRangeMode] = useState("preset");
  const [preset, setPreset] = useState("week");
  const [monthValue, setMonthValue] = useState(() => todayStr().slice(0, 7));
  const [customFrom, setCustomFrom] = useState(() => daysAgoStr(7));
  const [customTo, setCustomTo] = useState(() => todayStr());

  // ── Filter by a specific Part number ──
  const [parts, setParts] = useState([]);
  const [partFilter, setPartFilter] = useState("");

  const [logs, setLogs] = useState([]);

  useEffect(() => { listRows("part_master", { order: "part_no" }).then(setParts); }, []);

  useEffect(() => {
    const range =
      rangeMode === "month" ? monthRangeFor(monthValue) :
      rangeMode === "custom" ? customRangeFor(customFrom, customTo) :
      rangeFor(preset);
    getScanLogsBetween(range.from, range.to).then(setLogs);
  }, [rangeMode, preset, monthValue, customFrom, customTo]);

  const filteredLogs = partFilter
    ? logs.filter((l) => l.part_unit?.part_master?.part_no === partFilter)
    : logs;

  // แยกน้ำหนักเป็น 2 ตัวเลขคนละความหมาย (ดู metrics.js):
  //   material  = น้ำหนักวัสดุจริง นับแต่ละชิ้นครั้งเดียว
  //   processed = ปริมาณงานที่ประมวลผล นับทุกครั้งที่สแกน (ชิ้นผ่านหลายขั้น = นับหลายครั้ง)
  const material = materialWeight(filteredLogs);
  const processed = processedWeight(filteredLogs);
  const distinctUnits = distinctUnitCount(filteredLogs);
  const byOp = {};
  filteredLogs.forEach((l) => {
    const name = l.operation?.name || "ไม่ระบุ";
    byOp[name] = byOp[name] || { name, count: 0, weight: 0 };
    byOp[name].count += Number(l.quantity ?? 1) || 0;   // นับจำนวนชิ้น (งานหน้าเครื่อง = quantity)
    byOp[name].weight += Number(l.weight ?? l.part_unit?.part_master?.unit_weight ?? 0);
  });
  const chartData = Object.values(byOp);
  const matrix = machineOpMatrix(filteredLogs); // ตารางแยกน้ำหนักของเครื่อง × ขั้นตอน
  const partMatrix = partOpMatrix(filteredLogs); // ตารางแยก Part No. × ขั้นตอน
  const dailyMatrix = machineDailyMatrix(filteredLogs); // กก./จำนวน/เวลา ต่อวัน ต่อเครื่อง
  // ── เรียงลำดับตารางรายงาน (กดหัวคอลัมน์) ──────────────────────────────────
  const sortM = useTableSort();   // ตารางเครื่องจักร × ขั้นตอน (ปริมาณงาน + เฉลี่ย/วัน)
  const sortW = useTableSort();   // ตารางปริมาณงานที่แต่ละเครื่องประมวลผล
  const sortP = useTableSort();   // ตาราง Release × Part × ขั้นตอน
  const dmByName = (name) => dailyMatrix.machines.find((x) => x.name === name);
  const machineAcc = {
    name: (m) => m.name, total: (m) => m.total.count, weight: (m) => m.total.weight,
    time: (m) => m.total.seconds,
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

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">รายงานข้อมูลสแกน</div>
          <div className="page-sub">สรุปผลการสแกนตามช่วงเวลาและ Part ที่เลือก</div>
        </div>
      </div>

      <Card title="ช่วงเวลาที่ต้องการดู">
        {/* แถวบน: เลือกโหมดช่วงเวลา (ซ้าย) · กรอง Part (ขวา) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div className="chip-row">
            {RANGE_MODES.map((m) => (
              <span key={m.value} className={`chip ${rangeMode === m.value ? "active" : ""}`} onClick={() => setRangeMode(m.value)}>
                {m.label}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>Part:</span>
            <Select value={partFilter} onChange={(e) => setPartFilter(e.target.value)} style={{ minWidth: 200 }}
              options={parts.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.part_name}` }))} />
          </div>
        </div>

        {/* แถวล่าง: ค่าตามโหมดที่เลือก */}
        <div style={{ marginTop: 12 }}>
          {rangeMode === "preset" && <PresetPicker value={preset} onChange={setPreset} />}
          {rangeMode === "month" && (
            <Input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} style={{ maxWidth: 200 }} />
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

      <div className="stat-row">
        <StatCard label="จำนวนที่บันทึก · นับต่อขั้นตอน" value={totalPieces(filteredLogs).toLocaleString()} icon="scan" />
        <StatCard label="งาน/ล็อตที่มีความเคลื่อนไหว" value={distinctUnits.toLocaleString()} icon="box" />
        <StatCard label="น้ำหนักวัสดุ · นับต่อชิ้น (กก.)" value={fmtNum(material)} icon="weight" />
        <StatCard label="ปริมาณงานที่ประมวลผล · ทุกขั้นตอน (กก.)" value={fmtNum(processed)} icon="bolt" />
        <StatCard label="เวลาเดินเครื่องรวม (จับจากหน้าเครื่อง)" value={fmtHrs(totalSeconds)} icon="bolt" />
      </div>

      {noWeight.length > 0 && (
        <div className="card" style={{ background: "var(--danger-tint, #fff4f4)", borderColor: "var(--danger, #e11d1d)", color: "var(--danger-dk, #a01212)", fontSize: 12.5, padding: "10px 14px", marginBottom: 14, lineHeight: 1.6 }}>
          ⚠️ <b>มี Part ที่ยังไม่ได้ตั้งน้ำหนัก/ชิ้น — น้ำหนักจะถูกนับเป็น 0 กก.</b><br />
          {noWeight.map((p) => `${p.partNo} (${fmtNum(p.pieces)} ชิ้น)`).join(" · ")}
          <br /><span style={{ opacity: .8 }}>ไปตั้งค่าน้ำหนัก/ชิ้นที่ Setup → Part Master เพื่อให้ กก. ครบถ้วน</span>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-8px 2px 14px", lineHeight: 1.6 }}>
        <b>น้ำหนักวัสดุ</b> = น้ำหนักของชิ้นงานจริง นับแต่ละชิ้นครั้งเดียว ·{" "}
        <b>ปริมาณงานที่ประมวลผล</b> = รวมทุกครั้งที่สแกน ชิ้นที่ผ่านหลายขั้นตอนถูกนับซ้ำตามจำนวนขั้น (ใช้วัดภาระงานรวมของสายการผลิต)
      </div>
      <Card title="แยกตามขั้นตอนการทำงาน">
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={CHART.muted} fontSize={12} />
              <YAxis stroke={CHART.muted} fontSize={12} />
              <Tooltip contentStyle={{ background: CHART.tooltipBg, border: `1px solid ${CHART.tooltipBorder}`, color: CHART.text, borderRadius: 10 }} />
              <Bar dataKey="count" name="จำนวน (นับต่อขั้นตอน)" fill={CHART.accent} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="เครื่องจักร × ขั้นตอน (ปริมาณงาน + เฉลี่ย/วัน)">
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          แต่ละเครื่องทำขั้นตอนอะไรไปเท่าไร (ชิ้น·กก.) + เวลาเดินเครื่อง + เฉลี่ย/วัน ในตารางเดียว · <b>เฉลี่ย/วัน</b> คิดจากเฉพาะวันที่มีงานจริง
        </div>
        {matrix.machines.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 2px" }}>ยังไม่มีการสแกนในช่วงเวลานี้</div>
        ) : (
          <div className="table-wrap tall-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <SortTh k="name" sort={sortM}>เครื่องจักร</SortTh>
                  {matrix.opNames.map((op) => <SortTh k={`op:${op}`} sort={sortM} key={op}>{op}</SortTh>)}
                  <SortTh k="total" sort={sortM}>รวม (ชิ้น)</SortTh>
                  <SortTh k="weight" sort={sortM}>น้ำหนัก (กก.)</SortTh>
                  <SortTh k="time" sort={sortM}>เวลาเดินเครื่อง</SortTh>
                  <SortTh k="avgKg" sort={sortM}>เฉลี่ย กก./วัน</SortTh>
                  <SortTh k="avgPcs" sort={sortM}>เฉลี่ย ชิ้น/วัน</SortTh>
                </tr>
              </thead>
              <tbody>
                {sortM.sortRows(matrix.machines, machineAcc).map((m) => {
                  const dm = dailyMatrix.machines.find((x) => x.name === m.name);
                  return (
                    <tr key={m.name}>
                      <td style={{ fontWeight: 600 }}>{m.name}</td>
                      {matrix.opNames.map((op) => {
                        const cell = m.ops[op];
                        return (
                          <td key={op}>
                            {cell ? `${cell.count.toLocaleString()} ชิ้น` : <span style={{ color: "var(--surface-3)" }}>—</span>}
                          </td>
                        );
                      })}
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{m.total.count.toLocaleString()} ชิ้น</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--accent-dk)" }}>{m.total.weight > 0 ? `${fmtNum(m.total.weight)} กก.` : "—"}</td>
                      <td style={{ fontFamily: "var(--font-mono)" }}>{m.total.seconds ? fmtHrs(m.total.seconds) : "—"}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--accent-dk)" }}>{dm ? `${fmtNum(dm.avg.weight)} กก.` : "—"}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--accent-dk)" }}>
                        {dm
                          ? <span>{fmtNum(dm.avg.count)} ชิ้น{dm.avg.seconds ? <span style={{ color: "var(--muted)", fontSize: 11 }}> · {fmtHrs(dm.avg.seconds)}</span> : null}</span>
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
          ตัวเลขคือปริมาณงาน (นับต่อการสแกน) ไม่ใช่จำนวนวัสดุ · <b>เวลาเดินเครื่อง</b> = เวลาที่จับจากกด START–SAVE บนหน้าเครื่อง (ไม่ใช่เวลาเครื่องเปิดจริง)
        </div>
      </Card>

      <Card title="Release × Part × ขั้นตอน">
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          แต่ละแถว = Part ในแต่ละ Release · คอลัมน์ขั้นตอน = จำนวนชิ้นที่ผ่านขั้นตอนนั้น · <b>น้ำหนัก</b> แยกคอลัมน์ · <b>เสร็จ</b> = ชิ้นที่กด Finished
        </div>
        {partMatrix.parts.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 2px" }}>ยังไม่มีการสแกนในช่วงเวลานี้</div>
        ) : (
          <div className="table-wrap tall-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <SortTh k="release" sort={sortP}>Release</SortTh>
                  <SortTh k="part_no" sort={sortP}>Part No.</SortTh>
                  <SortTh k="part_name" sort={sortP}>ชื่อ Part</SortTh>
                  {partMatrix.opNames.map((op) => <SortTh k={`op:${op}`} sort={sortP} key={op}>{op}</SortTh>)}
                  <SortTh k="total" sort={sortP}>รวม (ชิ้น)</SortTh>
                  <SortTh k="weight" sort={sortP}>น้ำหนัก (กก.)</SortTh>
                  <SortTh k="finished" sort={sortP}>เสร็จ (ชิ้น)</SortTh>
                </tr>
              </thead>
              <tbody>
                {sortP.sortRows(partMatrix.parts, partAcc).map((p) => (
                  <tr key={`${p.releaseOrder} ${p.partNo}`}>
                    <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>{p.releaseOrder}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>{p.partNo}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12.5, whiteSpace: "nowrap" }}>{p.partName}</td>
                    {partMatrix.opNames.map((op) => {
                      const cell = p.ops[op];
                      return (
                        <td key={op}>
                          {cell ? `${cell.count.toLocaleString()} ชิ้น` : <span style={{ color: "var(--surface-3)" }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ fontWeight: 600 }}>{p.total.count.toLocaleString()} ชิ้น</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--accent-dk)" }}>{p.total.weight > 0 ? `${fmtNum(p.total.weight)} กก.` : "—"}</td>
                    <td style={{ fontWeight: 700, color: p.total.finished > 0 ? "var(--success)" : "var(--muted)" }}>
                      {p.total.finished > 0 ? `${p.total.finished.toLocaleString()} ชิ้น` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Finished Part (รวมมาไว้ในหน้า Report) ──────────────────────────── */}
      <div className="section-heading" style={{ margin: "26px 2px 12px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
        Finished Part — ชิ้นงานที่เสร็จสมบูรณ์
      </div>
      <FinishedPartSection />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 6) MACHINES SUMMARY
// ══════════════════════════════════════════════════════════════════════════
function MachinesSummaryPage() {
  const [preset, setPreset] = useState("week");
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    const { from, to } = rangeFor(preset);
    getScanLogsBetween(from, to).then(setLogs);
  }, [preset]);

  // per-scan = ภาระงานของเครื่อง (ถูกต้อง: เครื่องทำงานกับชิ้นนั้นจริงทุกครั้งที่สแกน)
  const matrix = machineOpMatrix(logs);
  const rows = matrix.machines.map((m) => ({ name: m.name, count: m.total.count, weight: m.total.weight }));

  return (
    <div>
      <div className="page-head">
        <div className="page-title">สรุปเครื่องจักร</div>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      <Card title="ปริมาณงานที่แต่ละเครื่องประมวลผล">
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          นับตามจำนวนชิ้นที่ทำในแต่ละขั้นตอน — ชิ้นเดียวที่ผ่านหลายเครื่องจะถูกนับที่ทุกเครื่องที่ทำ (งานหน้าเครื่องนับตามจำนวนที่กรอก)
        </div>
        <div style={{ height: 240, marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={CHART.muted} fontSize={12} />
              <YAxis stroke={CHART.muted} fontSize={12} />
              <Tooltip contentStyle={{ background: CHART.tooltipBg, border: `1px solid ${CHART.tooltipBorder}`, color: CHART.text, borderRadius: 10 }} />
              <Bar dataKey="count" name="จำนวน (นับต่อขั้นตอน)" fill={CHART.success} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <SortTh k="name" sort={sortW}>เครื่องจักร</SortTh>
                {matrix.opNames.map((op) => <SortTh k={`op:${op}`} sort={sortW} key={op}>{op}</SortTh>)}
                <SortTh k="total" sort={sortW}>รวมทุกขั้นตอน</SortTh>
                <SortTh k="weight" sort={sortW}>น้ำหนักรวม (กก.)</SortTh>
                <SortTh k="time" sort={sortW}>เวลาเดินเครื่อง</SortTh>
              </tr>
            </thead>
            <tbody>
              {sortW.sortRows(matrix.machines, machineAcc).map((m) => (
                <tr key={m.name}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  {matrix.opNames.map((op) => {
                    const cell = m.ops[op];
                    return (
                      <td key={op}>
                        {cell
                          ? <span>{cell.count} ชิ้น</span>
                          : <span style={{ color: "var(--surface-3)" }}>—</span>}
                      </td>
                    );
                  })}
                  <td style={{ fontWeight: 600 }}>{m.total.count} ชิ้น</td>
                  <td style={{ fontWeight: 600, color: "var(--accent-dk)" }}>{m.total.weight ? fmtNum(m.total.weight) : "—"}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{m.total.seconds ? fmtHrs(m.total.seconds) : "—"}</td>
                </tr>
              ))}
              {matrix.machines.length === 0 && (
                <tr><td colSpan={matrix.opNames.length + 4} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>ยังไม่มีการสแกนในช่วงเวลานี้</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
      Promise.all([getUnitStatsByReleaseIds(ids), getReleaseOpProgress(ids)])
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
          <div className="table-wrap tall-scroll">
            <table className="data-table responsive-cards">
              <thead><tr>
                <SortTh k="date" sort={sort}>วันที่</SortTh>
                <SortTh k="order" sort={sort}>Release Order</SortTh>
                <SortTh k="parts" sort={sort}>Part No.</SortTh>
                <SortTh k="qty" sort={sort}>จำนวน</SortTh>
                <SortTh k="finished" sort={sort}>เสร็จแล้ว</SortTh>
                <SortTh k="progress" sort={sort}>ความคืบหน้า</SortTh>
                <SortTh k="weight" sort={sort}>น้ำหนักรวม</SortTh>
              </tr></thead>
              <tbody>
                {sort.sortRows(groups, {
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
                }).map((g) => {
                  const gTotal = g.releases.reduce((s, r) => s + (stats[r.id]?.total ?? r.qty), 0);
                  // ★ นิยาม "เสร็จ" เดียวกับหน้า Projects และรายละเอียด Release (max สำนักงาน/หน้าเครื่อง)
                  const { finished: gFinished } = computeGroupProgress(g.releases, stats, opProg, gTotal);
                  const gPct = gTotal > 0 ? Math.round((gFinished / gTotal) * 100) : null;
                  return (
                    <tr key={g.key} className="release-row" onClick={() => setViewGroup(g)}>
                      <td data-label="วันที่">{fmtD(g.date)}</td>
                      <td data-label="Release Order">{g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? "-")}</td>
                      <td data-label="Part No.">{fmtNum(g.releases.length)} Part</td>
                      <td data-label="จำนวน">{fmtNum(g.totalQty)} ชิ้น</td>
                      <td data-label="เสร็จแล้ว" style={{ fontWeight: 700, color: statsReady && gFinished > 0 ? "var(--success)" : "var(--muted)" }}>
                        {statsReady ? `${fmtNum(gFinished)} ชิ้น` : "—"}
                      </td>
                      <td data-label="ความคืบหน้า" style={{ minWidth: 160 }}>
                        {statsReady && gPct !== null ? (
                          <ProgressBar pct={gPct} finished={gFinished} total={gTotal} />
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td data-label="น้ำหนักรวม">{g.totalWeight ? `${fmtNum(g.totalWeight)} กก.` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
    // merge: ใช้ค่าที่ "มากกว่า" ระหว่างสแกนสำนักงาน (part_units.status) กับหน้าเครื่อง
    Object.entries(station || {}).forEach(([pid, st]) => {
      const base = m[pid] || { id: pid, total: 0, finished: 0, weight: 0 };
      const stFin = Number(st?.finished) || 0;
      if (stFin >= (Number(base.finished) || 0)) { base.finished = stFin; base.weight = Number(st?.weight) || base.weight; }
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
          <div className="table-wrap tall-scroll">
            <table className="data-table responsive-cards">
              <thead><tr>
                <SortTh k="code" sort={sort}>รหัส</SortTh>
                <SortTh k="name" sort={sort}>ชื่อโปรเจค</SortTh>
                <SortTh k="total" sort={sort}>ปล่อยงาน (ชิ้น)</SortTh>
                <SortTh k="finished" sort={sort}>เสร็จแล้ว</SortTh>
                <SortTh k="pct" sort={sort}>% เสร็จ</SortTh>
                <SortTh k="weight" sort={sort}>น้ำหนักวัสดุ (กก.)</SortTh>{canEdit && <th></th>}
              </tr></thead>
              <tbody>
                {sort.sortRows(projects, {
                  code: (p) => p.code, name: (p) => p.name,
                  total: (p) => statMap[p.id]?.total || 0,
                  finished: (p) => statMap[p.id]?.finished || 0,
                  pct: (p) => { const s = statMap[p.id]; return s?.total ? s.finished / s.total : 0; },
                  weight: (p) => statMap[p.id]?.weight || 0,
                }).map((p) => {
                  const s = statMap[p.id] || { total: 0, finished: 0, weight: 0 };
                  const done = s.total > 0 && s.finished >= s.total;   // ครบจริง
                  const pct = s.total ? (done ? 100 : Math.min(99, Math.round((s.finished / s.total) * 100))) : 0;
                  return (
                    <tr key={p.id} className="release-row" onClick={() => setViewProject(p)} title="กดเพื่อดู Release ในโปรเจคนี้">
                      <td data-label="รหัส" style={{ fontFamily: "var(--font-mono)" }}>{p.code}</td>
                      <td data-label="ชื่อโปรเจค">{p.name}</td>
                      <td data-label="ปล่อยงาน (ชิ้น)">{fmtNum(s.total)}</td>
                      <td data-label="เสร็จแล้ว" style={{ fontWeight: 700, color: s.finished > 0 ? "var(--success)" : "var(--muted)" }}>{fmtNum(s.finished)}</td>
                      <td data-label="% เสร็จ">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 64, height: 6, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: done ? "var(--success)" : "var(--accent)" }} />
                          </div>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{pct}%</span>
                        </div>
                      </td>
                      <td data-label="น้ำหนักวัสดุ (กก.)">{fmtNum(s.weight)}</td>
                      {canEdit && (
                        <td data-label="" style={{ textAlign: "right" }}>
                          <Btn variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(p); }}><Icon name="settings" size={13} /> แก้ไข</Btn>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showAdd && (
        <QuickAddProjectModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); reload(); }} />
      )}
      {editing && (
        <ProjectEditModal
          project={editing.project} impact={editing.impact}
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
        <div className="table-wrap tall-scroll">
          <table className="data-table responsive-cards">
            <thead><tr>
              <SortTh k="part_no" sort={sort}>Part No.</SortTh>
              <SortTh k="part_name" sort={sort}>ชื่อ Part</SortTh>
              <SortTh k="total" sort={sort}>ปล่อยงาน</SortTh>
              <SortTh k="finished" sort={sort}>เสร็จแล้ว</SortTh>
              <SortTh k="weight" sort={sort}>น้ำหนักวัสดุ (กก.)</SortTh>
            </tr></thead>
            <tbody>
              {sort.sortRows(rows, {
                part_no: (r) => r.part_no || "", part_name: (r) => r.part_name || "",
                total: (r) => Number(r.total) || 0, finished: (r) => Number(r.finished) || 0, weight: (r) => Number(r.weight) || 0,
              }).map((r) => (
                <tr key={r.id}><td data-label="Part No." style={{ whiteSpace: "nowrap" }}>{r.part_no}</td><td data-label="ชื่อ Part" style={{ whiteSpace: "nowrap" }}>{r.part_name}</td><td data-label="ปล่อยงาน">{fmtNum(r.total)}</td><td data-label="เสร็จแล้ว" style={{ fontWeight: 600, color: r.finished > 0 ? "var(--success)" : "var(--muted)" }}>{fmtNum(r.finished)}</td><td data-label="น้ำหนักวัสดุ (กก.)">{fmtNum(r.weight)}</td></tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5}>
                  <div className="empty-state" style={{ padding: "24px 0" }}>
                    <Icon name="grid" size={30} />
                    <div className="empty-state-title">ยังไม่มีข้อมูลการปล่อยงาน</div>
                    <div className="empty-state-sub">เมื่อมีการปล่อยงาน/สแกน จะเห็นสรุปแยกตาม Part ที่นี่</div>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 9) SETUP
// ══════════════════════════════════════════════════════════════════════════
// ─── Projects: เพิ่ม/แก้ไข/ลบ พร้อมเช็คผลกระทบก่อนลบ (มี Part/Release/QR อยู่ใต้โปรเจคไหม) ──
function ProjectEditModal({ project, impact, onClose, onSaved, onDeleted }) {
  const [code, setCode] = useState(project.code);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rels, setRels] = useState(null);   // รายการ Release ในโปรเจคนี้
  useEffect(() => {
    getReleasesFull().then((all) => setRels(all.filter((r) => r.part_master?.project_id === project.id)));
  }, [project.id]);

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
    } else if (!confirm(msg)) {
      return;
    }

    setBusy(true); setErr("");
    try {
      await deleteProjectCascade(project.id);
      onDeleted();
    } catch (e) {
      setErr("ลบไม่สำเร็จ: " + e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="แก้ไขโปรเจค" sub={`สร้างเมื่อ ${fmtDT(project.created_at)}`} onClose={onClose}>
      <div className="grid-2">
        <Field label="รหัสโปรเจค *"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="ชื่อโปรเจค *"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        ใต้โปรเจคนี้มี {impact.partCount} Part · {impact.releaseCount} Release · {impact.unitCount} ชิ้น (QR)
        {impact.scannedCount > 0 && <> · สแกนไปแล้ว {impact.scannedCount} ชิ้น</>}
      </div>

      {/* รายการ Release ในโปรเจคนี้ — รวมเป็น 1 Release Order ต่อ 1 แถว */}
      {(() => {
        let orders = null;
        if (rels) {
          const map = new Map();
          for (const r of rels) {
            const key = r.release_order || `__${r.id}`;   // ไม่มีเลขที่ → แยกแถวของตัวเอง
            const g = map.get(key) || { order: r.release_order || "-", date: r.release_date, parts: 0, qty: 0 };
            g.parts += 1; g.qty += Number(r.qty) || 0;
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
              <div style={{ maxHeight: 190, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table className="data-table" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>วันที่</th><th>Release Order</th><th>Part No.</th><th>จำนวนรวม</th></tr></thead>
                  <tbody>
                    {orders.map((g, i) => (
                      <tr key={i}>
                        <td>{fmtD(g.date)}</td>
                        <td>{g.order}</td>
                        <td>{g.parts} Part</td>
                        <td>{fmtNum(g.qty)} ชิ้น</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <div className="modal-actions" style={{ justifyContent: "space-between" }}>
        <span onClick={() => !busy && remove()} style={{ color: "var(--danger-hi)", cursor: busy ? "wait" : "pointer", fontSize: 13 }}>
          ลบโปรเจคนี้
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
          <Btn type="button" variant="accent" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ProjectCrud() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useUndoable({});
  const [editing, setEditing] = useState(null); // { project, impact }
  const [err, setErr] = useState("");

  const load = useCallback(async () => setRows(await listRows("projects", { order: "code" })), []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const code = (form.code || "").trim(), name = (form.name || "").trim();
    if (!code || !name) { setErr("กรอกรหัสและชื่อโปรเจคให้ครบ"); return; }
    setErr("");
    try {
      await insertRow("projects", { code, name });
      setForm({}); load();
    } catch (e) {
      setErr(isDuplicateError(e) ? `รหัสโปรเจค "${code}" มีอยู่แล้ว กรุณาใช้รหัสอื่น` : "เกิดข้อผิดพลาด: " + e.message);
    }
  }

  async function openEdit(project) {
    const impact = await getProjectImpact(project.id);
    setEditing({ project, impact });
  }

  return (
    <Card title="เพิ่มโปรเจคใหม่">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ minWidth: 170 }}>
          <Field label="รหัสโปรเจค"><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
        </div>
        <div style={{ minWidth: 220 }}>
          <Field label="ชื่อโปรเจค"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        </div>
        <Btn variant="accent" onClick={add} style={{ height: 42, alignSelf: "flex-start", marginTop: 20 }}>เพิ่ม</Btn>
      </div>
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>รหัสโปรเจค</th><th>ชื่อโปรเจค</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td><td>{r.name}</td>
                <td><span onClick={() => openEdit(r)} style={{ color: "var(--accent-dk)", cursor: "pointer" }}>แก้ไข</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <ProjectEditModal
          project={editing.project} impact={editing.impact}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
          onDeleted={async () => { setEditing(null); await load(); }}
        />
      )}
    </Card>
  );
}

function SetupPage() {
  const [tab, setTab] = useState("machines");
  const TABS = [
    { key: "machines", label: "เครื่องจักร" },
    { key: "parts", label: "Part Master" },
    { key: "employees", label: "พนักงาน" },
    { key: "backup", label: "สำรองข้อมูล" },
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
      {tab === "operations" && <SimpleCrud table="operations" fields={[
        { key: "name", label: "ชื่อขั้นตอน (เช่น ตัด/เจาะ/บาก)" }, { key: "seq", label: "ลำดับ", type: "number" },
      ]} />}
      {tab === "projects" && <ProjectCrud />}
      {tab === "departments" && <SimpleCrud table="departments" fields={[{ key: "name", label: "ชื่อแผนก" }]} />}
      {tab === "employees" && <EmployeeCrud />}
      {tab === "parts" && <PartMasterCrud />}
      {tab === "backup" && <><RestorePointsCard /><BackupCard /></>}
    </div>
  );
}

// ─── จุดกู้คืนในแอป: ดูสแนปช็อตย้อนหลัง 30 วัน แยกโปรเจค + กดกู้คืนได้เลย ────────
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
      <Card title="จุดกู้คืนในแอป (ย้อนหลัง 30 วัน)">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 14 }}>
          ระบบเก็บ <b>สแนปช็อตอัตโนมัติทุกวัน</b> แยกตามโปรเจค เก็บย้อนหลัง 30 วัน — admin กดกู้คืนได้เองในแอป
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
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>วันที่/เวลา</th><th>โปรเจค</th><th>ชนิด</th><th>จำนวนแถว</th><th></th></tr></thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(b.taken_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{b.project_code} — {b.project_name}</td>
                    <td>
                      <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                        background: b.kind === "auto" ? "var(--surface-3)" : "var(--accent)", color: b.kind === "auto" ? "var(--muted)" : "#fff" }}>
                        {b.kind === "auto" ? "อัตโนมัติ" : "สร้างเอง"}
                      </span>
                    </td>
                    <td>{fmtNum(b.total_rows)}</td>
                    <td style={{ textAlign: "right" }}>
                      <Btn variant="ghost" size="sm" onClick={() => setRestoring(b)}>
                        <Icon name="refresh" size={13} /> กู้คืน
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    if (!confirm(`นำเข้าไฟล์ "${file.name}" (${fmtNum(rows)} แถว)?\n\nระบบจะ "เติมเฉพาะข้อมูลที่หายไป" กลับเข้าระบบ — ของเดิมและงานที่ทำใหม่ทั้งหมดจะไม่ถูกทับ`)) return;

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
async function syncMachineOps(machineId, selectedIds, caps) {
  if (!machineId) return;
  const current = new Set((caps || []).filter((c) => c.machine_id === machineId).map((c) => c.operation_id));
  const sel = new Set(selectedIds);
  const toAdd = [...sel].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !sel.has(id));
  if (toAdd.length) {
    await insertRows("machine_operations", toAdd.map((operation_id) => ({ machine_id: machineId, operation_id })));
  }
  for (const operation_id of toRemove) await deleteCap(machineId, operation_id);
}

// ปุ่มแตะเลือกขั้นตอนได้หลายอัน (chip) — ใช้ทั้งฟอร์มเพิ่ม/แก้ไขพนักงาน
function OpMultiPick({ operations, selected, onToggle, machineChosen }) {
  return (
    <div>
      <div className="chip-row">
        {operations.map((o) => (
          <span key={o.id} tabIndex={0} onClick={() => onToggle(o.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(o.id); } }}
            className={`chip ${selected.has(o.id) ? "active" : ""}`}>{o.name}</span>
        ))}
        {operations.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>ยังไม่มีขั้นตอนงาน — ไปเพิ่มที่แท็บ "ขั้นตอนงาน" ก่อน</span>
        )}
      </div>
      {!machineChosen && selected.size > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--warning)", marginTop: 4 }}>เลือกเครื่องจักรก่อน จึงจะบันทึกหลายขั้นตอนได้</div>
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
      const current = new Set(caps.filter((c) => c.machine_id === machine.id).map((c) => c.operation_id));
      const toAdd = [...selected].filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !selected.has(id));
      if (toAdd.length) {
        await insertRows("machine_operations", toAdd.map((operation_id) => ({ machine_id: machine.id, operation_id })));
      }
      for (const operation_id of toRemove) {
        await deleteCap(machine.id, operation_id);
      }
      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + e.message);
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
    const names = operations.filter((o) => ids.has(o.id)).map((o) => o.name);
    return names;
  }

  return (
    <Card title="เพิ่มเครื่องจักรใหม่ + ตั้งความสามารถ">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ minWidth: 140 }}><Field label="รหัสเครื่อง"><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field></div>
        <div style={{ minWidth: 180 }}><Field label="ชื่อเครื่องจักร"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
        <div style={{ minWidth: 140 }}><Field label="ประเภทงาน"><Input value={form.type || ""} onChange={(e) => setForm({ ...form, type: e.target.value })} /></Field></div>
        <Btn variant="accent" onClick={add} style={{ height: 42, alignSelf: "flex-start", marginTop: 20 }}>เพิ่ม</Btn>
      </div>
      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        เครื่องหนึ่งทำได้หลายขั้นตอน — กด "แก้ไข" เพื่อตั้งชื่อ/ประเภท เลือกขั้นตอนที่ทำได้ หรือลบเครื่อง
      </div>
      <SortControl sort={sort} options={[
        { k: "code", label: "รหัสเครื่อง" }, { k: "name", label: "ชื่อเครื่องจักร" },
        { k: "type", label: "ประเภท" }, { k: "caps", label: "ขั้นตอนที่ทำได้" },
      ]} />
      <div className="table-wrap tall-scroll">
        <table className="data-table responsive-cards">
          <thead><tr>
            <SortTh k="code" sort={sort}>รหัสเครื่อง</SortTh>
            <SortTh k="name" sort={sort}>ชื่อเครื่องจักร</SortTh>
            <SortTh k="type" sort={sort}>ประเภท</SortTh>
            <SortTh k="caps" sort={sort}>ขั้นตอนที่ทำได้</SortTh>
            <th></th>
          </tr></thead>
          <tbody>
            {sort.sortRows(rows, {
              code: (r) => r.code, name: (r) => r.name, type: (r) => r.type || "",
              caps: (r) => capNames(r.id).join(", "),
            }).map((r) => {
              const names = capNames(r.id);
              return (
                <tr key={r.id}>
                  <td data-label="รหัสเครื่อง">{r.code}</td>
                  <td data-label="ชื่อเครื่องจักร">{r.name}</td>
                  <td data-label="ประเภท">{r.type || "-"}</td>
                  <td data-label="ขั้นตอนที่ทำได้">
                    {names.length > 0
                      ? names.join(" · ")
                      : <span style={{ color: "var(--muted)" }}>ไม่จำกัด (ยังไม่ตั้ง)</span>}
                  </td>
                  <td data-label="" style={{ whiteSpace: "nowrap" }}>
                    <span onClick={() => setEditing(r)} style={{ color: "var(--accent-dk)", cursor: "pointer" }}>แก้ไข</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
function MachineEditModal({ machine, operations, caps = [], onClose, onSaved }) {
  const [form, setForm] = useUndoable({ name: machine.name || "", type: machine.type || "" });
  const [opSel, setOpSel] = useUndoable(() => new Set(caps.filter((c) => c.machine_id === machine.id).map((c) => c.operation_id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggleOp(id) { setOpSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  async function save() {
    if (!form.name.trim()) { setErr("กรอกชื่อเครื่องให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      await updateRow("machines", machine.id, { name: form.name.trim(), type: form.type.trim() || null });
      await syncMachineOps(machine.id, [...opSel], caps);   // บันทึกความสามารถไปพร้อมกัน
      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + (e?.message || e));
    }
    setBusy(false);
  }

  async function del() {
    if (!confirm(`ลบเครื่อง "${machine.code} — ${machine.name}" ?`)) return;
    setBusy(true); setErr("");
    try {
      let res = await deleteMachine(machine.id, false);
      if (res && res.ok === false && res.reason === "has_records") {
        setBusy(false);
        const ok = confirm(
          `เครื่องนี้มีประวัติงานผลิต ${Number(res.count || 0).toLocaleString()} รายการ\n\n` +
          `⚠️ ถ้าลบ ตัวเลขการผลิตของเครื่องนี้จะหายจากรายงานถาวร (กู้คืนไม่ได้)\n` +
          `ถ้าเครื่องแค่เลิกใช้ แนะนำให้เก็บไว้เฉยๆ จะดีกว่า\n\nยืนยันลบเครื่องพร้อมประวัติทั้งหมด?`
        );
        if (!ok) return;
        setBusy(true);
        res = await deleteMachine(machine.id, true);
      }
      if (res && res.ok === false) { setErr(res.reason === "bad_request" ? "ลบไม่สำเร็จ" : "ลบไม่สำเร็จ: " + res.reason); setBusy(false); return; }
      if (res && res.ok && res.unbound > 0) {
        mlsToast(`ลบเครื่องแล้ว · ปลดพนักงาน ${res.unbound} คนออกจากเครื่องนี้ — อย่าลืมไปตั้งเครื่องใหม่ให้เขาที่ Setup › พนักงาน`, "info");
      }
      onSaved();
    } catch (e) {
      setErr("ลบไม่สำเร็จ: " + (e?.message || e));
    }
    setBusy(false);
  }

  return (
    <Modal title={`แก้ไขเครื่องจักร — ${machine.code}`} sub="แก้ชื่อ/ประเภท · เลือกขั้นตอนที่ทำได้ · หรือลบเครื่อง — รหัสเครื่องแก้ไม่ได้" onClose={onClose}>
      <div className="grid-2">
        <Field label="รหัสเครื่อง"><Input value={machine.code} disabled /></Field>
        <Field label="ชื่อเครื่องจักร"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      </div>
      <Field label="ประเภทงาน (คำอธิบาย · ไม่บังคับ)">
        <Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="เช่น CUTTING / NOTCHING" />
      </Field>
      <Field label="ขั้นตอนที่เครื่องนี้ทำได้ (เลือกได้หลายอย่าง)">
        <OpMultiPick operations={operations} selected={opSel} onToggle={toggleOp} machineChosen={true} />
      </Field>
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
    if (!confirm("ลบรายการนี้?")) return;
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
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>{fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {fields.map((f) => <td key={f.key}>{r[f.key]}</td>)}
                <td><span onClick={() => remove(r.id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const capsForMachine = (mid) => {
    const ids = new Set(caps.filter((c) => c.machine_id === mid).map((c) => c.operation_id));
    if (ids.size === 0 && employee.operation_id && mid === (employee.machine_id || "")) ids.add(employee.operation_id);
    return ids;
  };
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
    if (!confirm(`ลบพนักงาน "${employee.code} — ${employee.name}" ?`)) return;
    setBusy(true); setErr("");
    try {
      let res = await deleteEmployee(employee.id, false);
      if (res && res.ok === false && res.reason === "has_records") {
        setBusy(false);
        const ok = confirm(
          `พนักงานคนนี้มีประวัติงานหน้าเครื่อง ${Number(res.count || 0).toLocaleString()} รายการ\n\n` +
          `แนะนำให้ "ปิดใช้งาน" แทนการลบ เพื่อเก็บชื่อผู้ทำไว้ในประวัติ\n\n` +
          `ถ้ายืนยันลบ: ตัวเลขการผลิตจะยังอยู่ครบ แต่ประวัติจะไม่ระบุว่าใครเป็นคนทำ\n\nยืนยันลบ?`
        );
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
      onSaved();
    } catch (e) {
      setErr("ลบไม่สำเร็จ: " + e.message);
    }
    setBusy(false);
  }

  return (
    <Modal title={`แก้ไขพนักงาน — ${employee.code}`} sub="ตั้งเครื่องจักร/ขั้นตอนประจำที่นี่ — หน้าสแกนจะใช้ค่านี้แทนการเลือกเอง" onClose={onClose}>
      <div className="grid-2">
        <Field label="ชื่อ"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="แผนก"><Select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
          options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="สิทธิ์การใช้งาน"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
          options={[{ value: "admin", label: "Admin" }, { value: "supervisor", label: "หัวหน้างาน" }, { value: "operator", label: "พนักงานหน้าเครื่อง" }]} /></Field>
        <div />
        <Field label="เครื่องจักรประจำ *"><Select value={form.machine_id} onChange={(e) => chooseMachine(e.target.value)}
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
          * ถ้าไม่ตั้งเครื่องจักร/ขั้นตอนประจำ พนักงานคนนี้จะสแกนงานไม่ได้
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
  const [editing, setEditing] = useState(null);
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
    if (!form.code || !form.name || !form.password) { mlsToast("กรอกรหัส/ชื่อ/รหัสผ่านให้ครบ", "warn"); return; }
    try {
      const opIds = [...opSel];
      // สร้างผ่าน RPC — DB hash ด้วย bcrypt เอง client ไม่แตะ hash (แก้ C2/H1)
      await upsertEmployee({
        code: form.code, name: form.name, password: form.password, role: form.role,
        department_id: form.department_id || null,
        machine_id: form.machine_id || null, operation_id: opIds[0] || null,
      });
      // ตั้งความสามารถของเครื่อง (หน้าเครื่องจะโชว์ปุ่มเลือกตามนี้)
      await syncMachineOps(form.machine_id, opIds, caps);
      setForm({ role: "operator" }); setOpSel(new Set()); load();
    } catch (e) {
      mlsToast(isDuplicateError(e) ? `รหัสพนักงาน "${form.code}" มีอยู่แล้ว` : "เพิ่มพนักงานไม่สำเร็จ: " + e.message, "error");
    }
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
          options={[{ value: "admin", label: "Admin" }, { value: "supervisor", label: "หัวหน้างาน" }, { value: "operator", label: "พนักงานหน้าเครื่อง" }]} /></Field>
        <div />
        <Field label="เครื่องจักรประจำ"><Select value={form.machine_id || ""} onChange={(e) => chooseMachine(e.target.value)}
          options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} /></Field>
        <Field label="ขั้นตอนประจำ (เลือกได้หลายขั้นตอน)">
          <OpMultiPick operations={operations} selected={opSel} onToggle={toggleOp} machineChosen={!!form.machine_id} />
        </Field>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        พนักงานที่ยังไม่ได้ตั้งเครื่องจักร/ขั้นตอนประจำ จะสแกนงานไม่ได้ (ตั้งภายหลังได้ที่ปุ่ม "แก้ไข") · เลือกได้หลายขั้นตอนถ้าเครื่องนี้ทำได้หลายอย่าง
      </div>
      <Btn variant="accent" onClick={add}>เพิ่มพนักงาน</Btn>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>สิทธิ์</th><th>เครื่องจักรประจำ</th><th>ขั้นตอนประจำ</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td><td>{r.name}</td>
                <td>{departments.find((d) => d.id === r.department_id)?.name || "-"}</td>
                <td>{ROLE_LABELS[r.role] || r.role}</td>
                <td>{machines.find((m) => m.id === r.machine_id)?.code || <span style={{ color: "var(--danger-hi)" }}>ยังไม่ตั้ง</span>}</td>
                <td>{(() => {
                  const ids = new Set(caps.filter((c) => c.machine_id === r.machine_id).map((c) => c.operation_id));
                  let names = operations.filter((o) => ids.has(o.id)).map((o) => o.name);
                  if (names.length === 0 && r.operation_id) { const o = operations.find((o) => o.id === r.operation_id); if (o) names = [o.name]; }
                  return names.length ? names.join(", ") : <span style={{ color: "var(--danger-hi)" }}>ยังไม่ตั้ง</span>;
                })()}</td>
                <td>
                  <span onClick={() => toggle(r)} style={{ cursor: "pointer" }}>
                    <Badge tone={r.active ? "success" : "muted"}>{r.active ? "ใช้งาน" : "ปิดใช้งาน"}</Badge>
                  </span>
                </td>
                <td><span onClick={() => setEditing(r)} style={{ color: "var(--accent-dk)", cursor: "pointer" }}>แก้ไข</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function PartMasterCrud() {
  const [rows, setRows] = useState([]);
  const [projects, setProjects] = useState([]);
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
      routing: form.routing || [],
    });
    setForm({ routing: [] }); load();
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
    if (confirm(`ลบ Part "${r?.part_no || ""}"?\n(ยังไม่มี Release/ชิ้นงานผูกอยู่ — ลบได้ปลอดภัย)`)) {
      await deleteRow("part_master", id); load();
    }
  }

  return (
    <Card title="เพิ่ม Part ใหม่">
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Field label="โปรเจค"><Select value={form.project_id || ""} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
          options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} /></Field>
        <Field label="รหัส Part"><Input value={form.part_no || ""} onChange={(e) => setForm({ ...form, part_no: e.target.value })} /></Field>
        <Field label="ชื่อ Part"><Input value={form.part_name || ""} onChange={(e) => setForm({ ...form, part_name: e.target.value })} /></Field>
        <Field label="วัสดุ"><Input value={form.material || ""} onChange={(e) => setForm({ ...form, material: e.target.value })} /></Field>
        <Field label="น้ำหนักโดยประมาณ/ชิ้น (กก.)"><Input type="number" step="0.01" value={form.unit_weight || ""} onChange={(e) => setForm({ ...form, unit_weight: e.target.value })} /></Field>
        <Field label="ความยาวโดยประมาณ/ชิ้น (มม.)"><Input type="number" step="0.1" value={form.default_length_mm || ""} onChange={(e) => setForm({ ...form, default_length_mm: e.target.value })} /></Field>
      </div>
      <Btn variant="accent" onClick={add}>เพิ่ม Part</Btn>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table">
          <thead><tr><th>Part No.</th><th>ชื่อ</th><th>น้ำหนัก/ชิ้น</th><th>ความยาว/ชิ้น</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.part_no}</td><td style={{ whiteSpace: "nowrap" }}>{r.part_name}</td>
                <td>{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}</td>
                <td>{r.default_length_mm ? `${fmtNum(r.default_length_mm)} มม.` : "-"}</td>
                <td><span onClick={() => remove(r.id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5}>
                <div className="empty-state" style={{ padding: "24px 0" }}>
                  <Icon name="grid" size={30} />
                  <div className="empty-state-title">ยังไม่มี Part</div>
                  <div className="empty-state-sub">กรอกฟอร์มด้านบนแล้วกด “เพิ่ม Part” เพื่อเพิ่มรายการแรก</div>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
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
      if (!healed) { try { sessionStorage.setItem("mls-healed", "1"); } catch { /* ignore */ } mlsHardReload(); }
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
  const content = !user
    ? <Login onLogin={setUser} />
    : goStation ? null : <Shell user={user} onLogout={logout} />;
  return <ErrorBoundary><UpdateBanner />{content}<Toaster /><UndoHint /></ErrorBoundary>;
}
