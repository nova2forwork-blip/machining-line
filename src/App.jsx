import { useState, useEffect, useRef, useCallback, forwardRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listRows, insertRow, insertRows, updateRow, updateRows, deleteRow, deleteRows,
  deleteReleaseCascade, deleteProjectCascade, getProjectImpact,
  findUnitByQr, getUnitHistory, getScanLogsBetween, getAllUnitsFull, getReleasesFull,
  deleteCap, getUnitStatsByReleaseIds, supabase,
  recordScan, recordScanByQr, scanQueueCount, onScanQueue, flushScanQueue,
  createReleaseBatch, upsertEmployee, getProjectSummary, getPartSummary, getEmployees,
  logoutSession, setEmployeeActive, recalcPartStatus,
} from "./supabase.js";
import { ROLE_LABELS, getSession, setSession, clearSession, verifyLogin, isAdmin, canManage } from "./auth.js";
import { enterFullscreen } from "./fullscreen.js";
import { printLabels, LABEL_PRESETS } from "./labels.js";
// parseReleaseExcel ถูก import แบบ dynamic ตอนเลือกไฟล์ (ดู ImportReleaseModal)
// เพื่อไม่ให้ไลบรารี xlsx (ก้อนใหญ่) ถูกโหลดตั้งแต่หน้า Login
import {
  processedWeight, materialWeight, distinctUnitCount, machineOpMatrix, partOpMatrix, totalPieces,
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

const fmtNum = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-";

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
  { group: "การผลิต", items: [
    { key: "release", label: "Release Production", icon: "box" },
    { key: "detail", label: "สแกนหน้าเครื่อง", icon: "scan" },
    { key: "finished", label: "Finished Part", icon: "check" },
    { key: "labels", label: "พิมพ์ QR / ป้าย", icon: "qr" },
    { key: "manageReleases", label: "จัดการ Release", icon: "grid", can: canManage },
  ] },
  { group: "รายงาน", items: [
    { key: "report", label: "Report", icon: "chart" },
    { key: "machines", label: "Machines Summary", icon: "machine" },
    { key: "projects", label: "Projects Summary", icon: "folder" },
    { key: "parts", label: "Parts Summary", icon: "grid" },
  ] },
  { group: "ระบบ", items: [
    { key: "setup", label: "Setup", icon: "settings", can: isAdmin },
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
const BOTTOM_LEFT2 = { key: "finished", label: "เสร็จแล้ว", icon: "check" };
const BOTTOM_RIGHT = { key: "report", label: "รายงาน", icon: "chart" };

function Shell({ user, onLogout }) {
  const [tab, setTab] = useState("release");
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

  // ปุ่มสแกนกลมด้านล่าง: พาไปหน้าเลือกโหมดก่อนเสมอ
  // (ผู้ใช้เลือก หน้าเครื่อง / มือถือ แล้วค่อยกด "เริ่มสแกน" เอง)
  function goScanNow() {
    go("detail");
  }

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
          {tab === "detail" && <ScanPage user={user} />}
          {tab === "finished" && <FinishedPartPage />}
          {tab === "labels" && <QrLabelsPage initialReleaseId={labelsPreselect} onConsumeInitial={() => setLabelsPreselect("")} />}
          {tab === "manageReleases" && canManage(user) && <ReleaseManagePage />}
          {tab === "report" && <ReportPage goTo={go} />}
          {tab === "machines" && <MachinesSummaryPage />}
          {tab === "projects" && <ProjectsSummaryPage />}
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
        <div className="bottom-nav-scan" onClick={goScanNow}>
          <div className="bottom-nav-scan-btn"><Icon name="scan" size={22} strokeWidth={2.2} /></div>
          <span>สแกน</span>
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
const RELEASE_ORDER_RE = /^P-\d+$/i;
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
  const [form, setForm] = useState({});
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
  const [form, setForm] = useState({ routing: [] });
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
  const [operations, setOperations] = useState([]);
  const [bulkRouting, setBulkRouting] = useState([]); // Routing แม่แบบ สำหรับกด "ใช้กับ Part ใหม่ทั้งหมด"
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [undoCount, setUndoCount] = useState(0); // แสดงตัวเลขย้อนกลับล่าสุด (feedback เล็กๆ)

  // ── Undo stack (Ctrl+Z) ─────────────────────────────────────────────────
  // เก็บ snapshot ของ rows ก่อนทุกการเปลี่ยนแปลง ไม่เกิน 50 ขั้น
  const historyRef = useRef([]);

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

  useEffect(() => { listRows("operations", { order: "seq" }).then(setOperations); }, []);

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
  const validRows = rows.filter((r) => r.code.trim() && (gnum(r.qty) || 0) > 0);
  const totalQty = validRows.reduce((s, r) => s + (gnum(r.qty) || 0), 0);
  const totalKg = validRows.reduce((s, r) => s + (rowTotalKg(r) || 0), 0);
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
  // Part ใหม่ที่ยังไม่เลือก Routing เลย — เตือนเพราะจะไม่มีวันขึ้นสถานะ "เสร็จ"
  const newNoRouting = validRows.filter((r) => isNewPartRow(r) && (r.routing || []).length === 0).length;

  function toggleRowOp(rowId, opName) {
    setRowsU((rs) => rs.map((r) => {
      if (r.id !== rowId) return r;
      const has = (r.routing || []).includes(opName);
      return { ...r, routing: has ? r.routing.filter((x) => x !== opName) : [...(r.routing || []), opName] };
    }));
  }
  function toggleBulkOp(opName) {
    setBulkRouting((b) => (b.includes(opName) ? b.filter((x) => x !== opName) : [...b, opName]));
  }
  // ใช้ Routing แม่แบบกับทุกแถวที่เป็น Part ใหม่พร้อมกัน
  function applyBulkRouting() {
    setRowsU((rs) => rs.map((r) => (isNewPartRow(r) ? { ...r, routing: [...bulkRouting] } : r)));
  }

  async function doSave() {
    const ro = normalizeReleaseOrder(releaseOrder);
    if (!ro || !RELEASE_ORDER_RE.test(ro)) { setErr('เลขที่ Release Order ต้องเป็นรูปแบบ "P-ตัวเลข" เช่น P-009'); return; }
    if (!projectId) { setErr("กรุณาเลือกโปรเจค"); return; }
    if (!date) { setErr("กรุณาเลือกวันที่"); return; }
    if (validRows.length === 0) { setErr("กรุณากรอกอย่างน้อย 1 Part (ต้องมีรหัส Code และจำนวน Qty)"); return; }

    setBusy(true); setErr(""); setProgress("กำลังบันทึกทั้งใบ...");
    try {
      // ส่งทั้งใบไปให้ DB ทำใน transaction เดียว (atomic) — สร้าง Part/Release/QR ครบ
      // ถ้าพังกลางคัน DB จะ rollback ทั้งใบ ไม่มีข้อมูลค้างครึ่งๆ (แก้ H2) และ Part
      // รหัสซ้ำในใบเดียวจะถูก find-or-create ให้ถูกต้อง ไม่ชนกันเอง (แก้ M2)
      const rows = validRows.map((r) => ({
        code: r.code.trim(),
        qty: gnum(r.qty),
        unit_weight: rowWeightPcs(r),
        length_mm: gnum(r.length_mm),
        material: r.material?.trim() || null,
        remark: r.remark?.trim() || null,
        routing: r.routing || [],
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

      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>
        วางจาก Excel ได้ทั้งบล็อก — คอลัมน์: <b>Code · จำนวน · Length · Weight/M · Material · Total Kg · Remark</b>{" "}
        (คอลัมน์ No. และ Total Kg ระบบจัดการ/คำนวณให้เอง) · น้ำหนัก/ชิ้น = (Length ÷ 1000) × Weight/M
        <br />Routing: Part เดิมจะดึงขั้นตอนที่เคยตั้งไว้ให้อัตโนมัติ · Part ใหม่เลือกได้ในคอลัมน์ขวาสุด
      </div>

      {newPartCount > 0 && operations.length > 0 && (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>
            ตั้ง Routing ให้ Part ใหม่พร้อมกัน ({newPartCount} Part ใหม่)
          </div>
          <div className="chip-row" style={{ marginBottom: 8 }}>
            {operations.map((o) => {
              const active = bulkRouting.includes(o.name);
              return (
                <span key={o.id} onClick={() => toggleBulkOp(o.name)} className={`chip ${active ? "active" : ""}`}>
                  {o.name}{active ? ` (${bulkRouting.indexOf(o.name) + 1})` : ""}
                </span>
              );
            })}
          </div>
          <Btn type="button" variant="ghost" size="sm" onClick={applyBulkRouting} disabled={bulkRouting.length === 0}>
            ใช้ Routing นี้กับ Part ใหม่ทั้งหมด
          </Btn>
        </div>
      )}

      {!projectId && (
        <div className="pgrid-need-project">
          <Icon name="folder" size={14} />
          เลือกโปรเจคก่อน แล้วจึงกรอก/วางข้อมูล Part — ระบบต้องรู้โปรเจคเพื่อแยก Part เดิม/ใหม่ให้ถูกต้อง
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>(เบอร์เดียวกันคนละโปรเจค = คนละ Part คนละ Routing)</span>
        </div>
      )}

      <div className="pgrid-wrap" style={!projectId ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
        <table className="pgrid">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th style={{ minWidth: 130 }}>Code *</th>
              <th style={{ width: 64 }}>REV.</th>
              <th style={{ width: 78 }}>จำนวน *</th>
              <th style={{ width: 90 }}>Length (มม.)</th>
              <th style={{ width: 90 }}>Weight/M</th>
              <th style={{ minWidth: 110 }}>Material</th>
              <th style={{ width: 92, textAlign: "right" }}>น้ำหนัก/ชิ้น</th>
              <th style={{ width: 92, textAlign: "right" }}>Total Kg</th>
              <th style={{ minWidth: 110 }}>Remark</th>
              <th style={{ minWidth: 170 }}>Routing</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const wpcs = rowWeightPcs(r);
              const tkg = rowTotalKg(r);
              const ex = existingPartFor(r);
              const hasCode = r.code.trim() !== "";
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
                  <td className="pgrid-routing">
                    {!hasCode ? (
                      <span style={{ color: "var(--muted-2)", paddingLeft: 8 }}>—</span>
                    ) : ex ? (
                      // Part เดิม — โชว์ routing ที่เคยตั้งไว้ อ่านอย่างเดียว
                      (ex.routing || []).length > 0
                        ? <span className="pgrid-routing-ro" title="ดึงจาก Part เดิมอัตโนมัติ">{ex.routing.join(" → ")}</span>
                        : <span className="pgrid-routing-warn" title="Part เดิมนี้ยังไม่ได้ตั้ง Routing — ไปตั้งที่ Setup ได้">ยังไม่ตั้ง (Part เดิม)</span>
                    ) : (
                      // Part ใหม่ — เลือกขั้นตอนได้ + เตือนถ้าเบอร์นี้มีในโปรเจคอื่น
                      <div className="pgrid-chips">
                        {operations.map((o) => {
                          const active = (r.routing || []).includes(o.name);
                          return (
                            <span key={o.id} onClick={() => toggleRowOp(r.id, o.name)} className={`chip chip-sm ${active ? "active" : ""}`}>
                              {o.name}{active ? ` (${r.routing.indexOf(o.name) + 1})` : ""}
                            </span>
                          );
                        })}
                        {operations.length === 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>ยังไม่มีขั้นตอนงาน</span>}
                        {(() => {
                          const others = otherProjectMatches(r);
                          if (others.length === 0) return null;
                          return (
                            <div className="pgrid-xproj" title="เบอร์เดียวกันมีในโปรเจคอื่น — คนละ Part จึงไม่ดึง routing มาให้ แสดงไว้อ้างอิงเท่านั้น">
                              <Icon name="folder" size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                              เบอร์นี้มีในโปรเจคอื่น: {others.slice(0, 2).map((m, k) => (
                                <span key={k}>
                                  {k > 0 ? " · " : ""}
                                  {m.project?.code || "?"}
                                  {(m.part.routing || []).length > 0 ? ` (${m.part.routing.join("→")})` : " (ยังไม่ตั้ง)"}
                                </span>
                              ))}
                              {others.length > 2 ? ` +${others.length - 2}` : ""}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </td>
                  <td className="pgrid-del" onClick={() => removeRow(r.id)} title="ลบแถว">✕</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pgrid-foot">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Btn type="button" variant="ghost" size="sm" onClick={addRow} disabled={!projectId}><Icon name="plus" size={14} /> เพิ่มแถว</Btn>
          <span style={{ fontSize: 11.5, color: "var(--muted)", userSelect: "none" }} title="กด Ctrl+Z เพื่อย้อนกลับการแก้ไขตาราง">
            <Icon name="refresh" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />Ctrl+Z ย้อนกลับได้
            {historyRef.current.length > 0 && (
              <span style={{ marginLeft: 4, color: "var(--accent-dk)", fontWeight: 600 }}>({historyRef.current.length})</span>
            )}
          </span>
          {undoCount > 0 && (
            <span style={{ fontSize: 11.5, color: "var(--success)", fontWeight: 600, animation: "fadeIn .15s ease" }}>↩ ย้อนกลับแล้ว</span>
          )}
        </div>
        <span>รวม <b>{fmtNum(totalQty)}</b> ชิ้น · <b>{validRows.length}</b> Part · น้ำหนักรวม <b>{fmtNum(totalKg)}</b> กก.</span>
        {newPartCount > 0 && <span style={{ color: "var(--accent-dk)" }}>{newPartCount} Part จะถูกสร้างใหม่อัตโนมัติ</span>}
      </div>
      {newNoRouting > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--warning)", marginTop: 6, lineHeight: 1.5 }}>
          <Icon name="bolt" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          มี Part ใหม่ {newNoRouting} รายการที่ยังไม่ได้เลือก Routing — ชิ้นงานเหล่านี้จะไม่ขึ้นสถานะ "เสร็จ" จนกว่าจะตั้งขั้นตอน (เลือกในคอลัมน์ Routing หรือใช้ปุ่มด้านบน)
        </div>
      )}

      <label className="toggle-row" style={{ marginTop: 14 }}>
        <span className={`toggle-switch${makeQr ? " on" : ""}`}>
          <input type="checkbox" checked={makeQr} onChange={(e) => setMakeQr(e.target.checked)} />
          <span className="toggle-knob" />
        </span>
        <span className="toggle-text">
          <span className="toggle-text-title">สร้าง QR ต่อชิ้น</span>
          <span className="toggle-text-sub">
            {makeQr ? "จะสร้างป้าย QR ให้ทุกชิ้นอัตโนมัติ ไปพิมพ์ทีหลังได้" : "ปิดอยู่ — บันทึกแค่ยอด Release ไม่สร้าง QR ให้"}
          </span>
        </span>
      </label>

      {err && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginTop: 10 }}>{err}</div>}
      {busy && progress && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{progress}</div>}

      <div className="modal-actions">
        <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
        <Btn type="button" variant="accent" onClick={doSave} disabled={busy || validRows.length === 0}>
          {busy ? "กำลังบันทึก..." : makeQr ? `บันทึก + สร้าง QR (${fmtNum(totalQty)} ใบ)` : "บันทึก Release"}
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

// ── Mini progress bar (inline, no extra deps) ───────────────────────────────
function ProgressBar({ pct, finished, total }) {
  const p = Math.min(100, Math.max(0, pct));
  const color = p === 100 ? "var(--success)" : p > 0 ? "var(--accent-dk)" : "var(--border)";
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
  const [opCounts, setOpCounts] = useState({}); // ชื่อขั้นตอน -> จำนวนชิ้นที่ผ่านแล้ว
  const [notStarted, setNotStarted] = useState(0);
  const [finished, setFinished] = useState(0);
  const [totalUnits, setTotalUnits] = useState(release.qty || 0);

  // ── Routing (ตั้ง/แก้ได้ในหน้านี้เลย — เฉพาะ Admin) ──────────────────────────
  const [routing, setRouting] = useState(release.part_master?.routing || []);
  const [operations, setOperations] = useState([]);
  const [editRouting, setEditRouting] = useState((release.part_master?.routing || []).length === 0);
  const [savingRouting, setSavingRouting] = useState(false);
  const [routingErr, setRoutingErr] = useState("");
  const [reloadKey, setReloadKey] = useState(0); // บังคับโหลดตัวเลขความคืบหน้าใหม่หลังแก้ routing
  const canEditRouting = isAdmin(user);
  const partNo = release.part_master?.part_no || "-";
  const partName = release.part_master?.part_name || "";

  useEffect(() => { listRows("operations", { order: "seq" }).then(setOperations); }, []);

  function toggleRoutingOp(name) {
    setRouting((rt) => (rt.includes(name) ? rt.filter((x) => x !== name) : [...rt, name]));
  }
  async function saveRouting() {
    if (!release.part_master_id) { setRoutingErr("ไม่พบรหัส Part (part_master_id)"); return; }
    setSavingRouting(true); setRoutingErr("");
    try {
      await updateRow("part_master", release.part_master_id, { routing });
      if (release.part_master) release.part_master.routing = routing; // อัปเดตในหน่วยความจำ เผื่อเปิดซ้ำ
      // คำนวณสถานะย้อนหลังให้ชิ้นที่สแกนไปแล้ว (เช่น routing ขั้นเดียว → ที่สแกนแล้วเป็น finished ทันที)
      await recalcPartStatus(release.part_master_id);
      setEditRouting(false);
      setReloadKey((k) => k + 1); // โหลดตัวเลขความคืบหน้าใหม่
    } catch (e) {
      setRoutingErr("บันทึก Routing ไม่สำเร็จ: " + (e.message || "") + " (ต้องเป็นสิทธิ์ Admin)");
    }
    setSavingRouting(false);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr("");
      try {
        // 1) ชิ้นทั้งหมดของล็อตนี้ (release เดียว = 1 Part)
        const { data: units, error: uErr } = await supabase
          .from("part_units").select("id, status").eq("release_id", release.id);
        if (uErr) throw uErr;
        const ids = (units || []).map((u) => u.id);
        const fin = (units || []).filter((u) => u.status === "finished").length;

        // 2) การสแกนทั้งหมดของชิ้นเหล่านี้ พร้อมชื่อขั้นตอน
        let scans = [];
        if (ids.length) {
          const { data: sc, error: sErr } = await supabase
            .from("scan_logs").select("part_unit_id, operation:operations(name)")
            .in("part_unit_id", ids);
          if (sErr) throw sErr;
          scans = sc || [];
        }

        // 3) นับชิ้น (distinct) ต่อขั้นตอน + หาว่ากี่ชิ้นยังไม่เริ่มเลย
        const byOp = {};
        const scannedUnits = new Set();
        for (const s of scans) {
          const op = s.operation?.name;
          if (!op) continue;
          (byOp[op] = byOp[op] || new Set()).add(s.part_unit_id);
          scannedUnits.add(s.part_unit_id);
        }
        const counts = {};
        Object.entries(byOp).forEach(([op, set]) => { counts[op] = set.size; });

        if (alive) {
          setOpCounts(counts);
          setFinished(fin);
          setTotalUnits(ids.length || release.qty || 0);
          setNotStarted((ids.length || 0) - scannedUnits.size);
          setLoading(false);
        }
      } catch (e) {
        if (alive) { setErr("โหลดข้อมูลไม่สำเร็จ: " + e.message); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [release, reloadKey]);

  // ขั้นตอนที่ถูกสแกนแต่ไม่ได้อยู่ใน routing (กันข้อมูลหลุด routing) — เอามาแสดงต่อท้าย
  const extraOps = Object.keys(opCounts).filter((op) => !routing.includes(op));
  const stages = [...routing, ...extraOps];

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
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <div style={{ flex: 1, minWidth: 120, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>น้ำหนัก/ชิ้น</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{uw != null ? `${fmtNum(uw)} กก.` : "-"}</div>
                </div>
                <div style={{ flex: 1, minWidth: 120, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>ความยาว/ชิ้น</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{len != null ? `${fmtNum(len)} มม.` : "-"}</div>
                </div>
                <div style={{ flex: 1, minWidth: 120, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>น้ำหนักรวม</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{uw != null ? `${fmtNum(totalUnits * uw)} กก.` : "-"}</div>
                </div>
              </div>
            );
          })()}

          {/* ── ตัวตั้ง/แก้ Routing (เฉพาะ Admin) ─────────────────────────── */}
          {canEditRouting && (editRouting || routing.length === 0) ? (
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
              <div className="label-el" style={{ marginBottom: 8 }}>ตั้ง/แก้ Routing — เลือกขั้นตอนที่ Part นี้ต้องผ่าน ตามลำดับ</div>
              <div className="chip-row" style={{ marginBottom: 8 }}>
                {operations.map((o) => {
                  const active = routing.includes(o.name);
                  return (
                    <span key={o.id} onClick={() => toggleRoutingOp(o.name)} className={`chip ${active ? "active" : ""}`}>
                      {o.name}{active ? ` (${routing.indexOf(o.name) + 1})` : ""}
                    </span>
                  );
                })}
                {operations.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>ยังไม่มีขั้นตอนงาน — เพิ่มที่ Setup &gt; ขั้นตอนงาน ก่อน</span>}
              </div>
              {routingErr && <div style={{ color: "var(--danger-hi)", fontSize: 12.5, marginBottom: 6 }}>{routingErr}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="accent" size="sm" onClick={saveRouting} disabled={savingRouting || routing.length === 0}>
                  {savingRouting ? "กำลังบันทึก..." : "บันทึก Routing"}
                </Btn>
                {(release.part_master?.routing || []).length > 0 && (
                  <Btn variant="ghost" size="sm" onClick={() => { setRouting(release.part_master.routing); setEditRouting(false); setRoutingErr(""); }}>ยกเลิก</Btn>
                )}
              </div>
            </div>
          ) : canEditRouting ? (
            <div style={{ marginBottom: 12 }}>
              <Btn variant="ghost" size="sm" onClick={() => setEditRouting(true)}><Icon name="settings" size={13} /> แก้ Routing</Btn>
            </div>
          ) : null}

          {stages.length === 0 ? (
            <div style={{ color: "var(--warning)", fontSize: 13, lineHeight: 1.6 }}>
              {canEditRouting
                ? 'เลือกขั้นตอนด้านบนแล้วกด "บันทึก Routing" เพื่อเริ่มติดตามความคืบหน้า'
                : "Part นี้ยังไม่ได้ตั้ง Routing — แจ้ง Admin ให้ตั้งที่ Setup > Part Master"}
            </div>
          ) : (
          <>
          <div className="stage-list">
            {stages.map((op, i) => {
              const done = opCounts[op] || 0;
              const remaining = Math.max(0, totalUnits - done);
              const pct = totalUnits > 0 ? Math.round((done / totalUnits) * 100) : 0;
              const isExtra = !routing.includes(op);
              return (
                <div className="stage-row" key={op}>
                  <div className="stage-head">
                    <span className="stage-name">
                      <span className="stage-seq">{isExtra ? "?" : i + 1}</span>
                      {op}{isExtra && <span className="stage-extra"> (นอก routing)</span>}
                    </span>
                    <span className="stage-nums">
                      ทำแล้ว <b>{fmtNum(done)}</b> · เหลือ <b style={{ color: remaining > 0 ? "var(--warning)" : "var(--success)" }}>{fmtNum(remaining)}</b>
                    </span>
                  </div>
                  <div className="stage-bar">
                    <div className="stage-bar-fill" style={{ width: `${pct}%`, background: pct === 100 ? "var(--success)" : "var(--accent-dk)" }} />
                    <span className="stage-bar-pct">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="stage-summary">
            <div><span className="stage-summary-num">{fmtNum(notStarted)}</span><span>ยังไม่เริ่ม</span></div>
            <div><span className="stage-summary-num" style={{ color: "var(--success)" }}>{fmtNum(finished)}</span><span>เสร็จครบทุกขั้นตอน</span></div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
            "ทำแล้ว" = จำนวนชิ้นที่สแกนผ่านขั้นตอนนั้นแล้ว · "เหลือ" = ยังไม่ผ่านขั้นตอนนั้น (เทียบกับทั้งล็อต {fmtNum(totalUnits)} ชิ้น)
          </div>
          </>
          )}
        </>
      )}

      <div className="modal-actions">
        <Btn type="button" variant="ghost" onClick={onClose}>ปิด</Btn>
      </div>
    </Modal>
  );
}

function ReleaseGroupDetail({ group, user, onBack, goTo, onHome }) {
  const noteLabel = group.notes.size === 0 ? "-" : group.notes.size === 1 ? [...group.notes][0] : `${group.notes.size} หมายเหตุ`;
  const [unitStats, setUnitStats] = useState({});
  const [statsLoading, setStatsLoading] = useState(true);
  const [viewPart, setViewPart] = useState(null); // release row ที่กำลังดูความคืบหน้าแยกขั้นตอน

  const loadStats = useCallback(() => {
    const ids = group.releases.map((r) => r.id);
    setStatsLoading(true);
    getUnitStatsByReleaseIds(ids).then((s) => { setUnitStats(s); setStatsLoading(false); });
  }, [group]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // รวมทุก Part ใน Release Order นี้
  const totalFinished = group.releases.reduce((sum, r) => sum + (unitStats[r.id]?.finished || 0), 0);
  const totalInProgress = group.releases.reduce((sum, r) => sum + (unitStats[r.id]?.inProgress || 0), 0);
  const pctOverall = group.totalQty > 0 ? Math.round((totalFinished / group.totalQty) * 100) : 0;

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
          <div className="page-title">{group.releaseOrder ? `Release Order: ${group.releaseOrder}` : `Release — ${group.releases[0]?.part_master?.part_no || ""}`}</div>
          <div className="page-sub">{group.projectCode} — {group.projectName} · {fmtDT(group.date)}</div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Card>
          <div className="label-el">จำนวนรวม</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(group.totalQty)} ชิ้น</div>
        </Card>
        <Card>
          <div className="label-el">น้ำหนักรวม</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(group.totalWeight)} กก.</div>
        </Card>
        <Card>
          <div className="label-el">จำนวน Part</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{group.releases.length} Part</div>
        </Card>
        <Card>
          <div className="label-el" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="check" size={12} /> เสร็จแล้ว (ภาพรวม)
          </div>
          {statsLoading ? (
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>กำลังโหลด...</div>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: pctOverall === 100 ? "var(--success)" : "var(--text)" }}>
                {fmtNum(totalFinished)} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>/ {fmtNum(group.totalQty)} ชิ้น</span>
              </div>
              <ProgressBar pct={pctOverall} finished={totalFinished} total={group.totalQty} />
              {totalInProgress > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                  กำลังทำ: {fmtNum(totalInProgress)} ชิ้น
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card title="รายละเอียดแต่ละ Part ในล็อตนี้">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part No.</th>
                <th>ชื่อ Part</th>
                <th>จำนวน</th>
                <th>เสร็จแล้ว</th>
                <th>ความคืบหน้า</th>
                <th>น้ำหนัก/ชิ้น</th>
                <th>น้ำหนักรวม</th>
                <th>ความยาว/ชิ้น</th>
                <th>หมายเหตุ</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {group.releases.map((r) => {
                const st = unitStats[r.id] || null;
                const finished = st?.finished ?? 0;
                const total = st?.total ?? r.qty;
                const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
                return (
                  <tr key={r.id} className="release-row" onClick={() => setViewPart(r)} title="กดเพื่อดูความคืบหน้าแยกขั้นตอน">
                    <td style={{ fontWeight: 600 }}>{r.part_master?.part_no || "-"}</td>
                    <td>{r.part_master?.part_name || "-"}</td>
                    <td>{r.qty}</td>
                    <td>
                      {statsLoading ? (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span>
                      ) : (
                        <span style={{ fontWeight: 600, color: pct === 100 ? "var(--success)" : pct > 0 ? "var(--accent-dk)" : "var(--muted)" }}>
                          {fmtNum(finished)} ชิ้น
                        </span>
                      )}
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {statsLoading ? (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span>
                      ) : (
                        <ProgressBar pct={pct} finished={finished} total={total} />
                      )}
                    </td>
                    <td>{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}</td>
                    <td>{r.unit_weight ? `${fmtNum(r.qty * r.unit_weight)} กก.` : "-"}</td>
                    <td>{r.length_mm ? `${fmtNum(r.length_mm)} มม.` : "-"}</td>
                    <td>{r.note || "-"}</td>
                    <td>
                      <span onClick={(e) => { e.stopPropagation(); goTo && goTo("labels", { releaseId: r.id }); }} style={{ color: "var(--accent-dk)", cursor: "pointer", whiteSpace: "nowrap" }}>
                        <Icon name="printer" size={13} /> พิมพ์ QR
                      </span>
                    </td>
                    <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                      ดูขั้นตอน <Icon name="arrowLeft" size={12} style={{ transform: "rotate(180deg)", verticalAlign: "-1px" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {noteLabel !== "-" && group.notes.size > 1 && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>หมายเหตุทั้งหมด: {[...group.notes].join(" · ")}</div>
      )}

      {viewPart && <PartProgressModal release={viewPart} user={user} onClose={() => { setViewPart(null); loadStats(); }} />}
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
    return <ReleaseGroupDetail group={viewGroup} user={user} onBack={() => setViewGroup(null)} goTo={goTo} onHome={() => { setViewGroup(null); goTo && goTo("release"); }} />;
  }

  return (
    <div>
      <div className="page-head page-head-release">
        <div>
          <div className="page-title">Release Production</div>
          <div className="page-sub">ค้นหา Release ที่เคยปล่อยงาน หรือกด "เพิ่ม Release" เพื่อปล่อยงานใหม่ (วางข้อมูลจาก Excel ได้)</div>
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
        <div className="table-wrap">
          <table className="data-table responsive-cards">
            <thead><tr><th>วันที่</th><th>โปรเจค</th><th>Release Order</th><th>จำนวน</th><th>ความคืบหน้า</th><th>น้ำหนักรวม</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                // รวม stats ของทุก release ในกลุ่มนี้
                const gFinished = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.finished || 0), 0);
                const gTotal = g.releases.reduce((s, r) => s + (allUnitStats[r.id]?.total ?? r.qty), 0);
                const gPct = gTotal > 0 ? Math.round((gFinished / gTotal) * 100) : null;
                const statsReady = g.releases.every((r) => r.id in allUnitStats);
                return (
                  <tr key={g.key} className="release-row" onClick={() => setViewGroup(g)}>
                    <td data-label="วันที่">{fmtDT(g.date)}</td>
                    <td data-label="โปรเจค">{g.projectCode}</td>
                    <td data-label="Release Order">{g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? "-")}</td>
                    <td data-label="จำนวน">{fmtNum(g.totalQty)} ชิ้น{g.releases.length > 1 ? ` (${g.releases.length} Part)` : ""}</td>
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
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
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
            alert(
              `บันทึก ${releaseOrder} สำเร็จ: ${releasesCreated} รายการ Part` +
              (unitsCreated ? ` · สร้าง QR ${unitsCreated} ใบ` : "") +
              (partsCreated > 0 ? ` · สร้าง Part ใหม่ ${partsCreated} รายการ` : "")
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
            alert(
              `นำเข้าสำเร็จ: สร้าง ${releasesCreated} release (${unitsCreated} QR)` +
              (partsCreated > 0
                ? ` · สร้าง Part ใหม่ ${partsCreated} รายการ\n\n⚠ Part ใหม่ยังไม่มี Routing — ไปตั้งขั้นตอนที่ Setup > Part Master ก่อน ไม่งั้นชิ้นงานจะไม่ขึ้นสถานะ "เสร็จ"`
                : "")
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
function FinishedPartPage() {
  const [units, setUnits] = useState([]);
  useEffect(() => { getAllUnitsFull("finished").then(setUnits); }, []);
  const totalWeight = units.reduce((s, u) => s + Number(u.weight || u.part_master?.unit_weight || 0), 0);
  return (
    <div>
      <div className="page-head"><div className="page-title">Finished Part</div></div>
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
              <thead><tr><th>QR</th><th>Part</th><th>โปรเจค</th><th>น้ำหนัก</th><th>ความยาว</th></tr></thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{u.qr_code}</td>
                    <td>{u.part_master?.part_no} — {u.part_master?.part_name}</td>
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
    </div>
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
  const [printMode, setPrintMode] = useState("sheet");
  // ชนิดป้าย: 'unit' = ป้ายรายชิ้น (ติดทุกชิ้น — ชิ้นใหญ่) | 'lot' = ป้ายรวมล็อต 1 ใบ (ชิ้นเล็ก สแกนแล้วกรอกจำนวน)
  const [labelScope, setLabelScope] = useState("unit");

  useEffect(() => {
    (async () => {
      setReleases(await listRows("releases", { order: "release_date", ascending: false }));
      setParts(await listRows("part_master", { order: "part_no" }));
      setProjects(await listRows("projects", { order: "code" }));
    })();
  }, []);

  // มาจากปุ่ม "พิมพ์ QR" ในหน้ารายละเอียด Release — เลือกล็อตให้อัตโนมัติ
  useEffect(() => {
    if (initialReleaseId) {
      setReleaseId(initialReleaseId);
      onConsumeInitial && onConsumeInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReleaseId]);

  useEffect(() => {
    if (!releaseId) { setUnits([]); setSelected(new Set()); return; }
    setLoading(true);
    listRows("part_units", { order: "unit_no", filters: { release_id: releaseId } }).then((rows) => {
      setUnits(rows);
      setLoading(false);
    });
  }, [releaseId]);

  // เลือกป้ายตามชนิด: รายชิ้น = เลือกทุกชิ้น · รวมล็อต = เลือกชิ้นแรกใบเดียว
  useEffect(() => {
    if (!units.length) { setSelected(new Set()); return; }
    if (labelScope === "lot") setSelected(new Set([units[0].id]));
    else setSelected(new Set(units.map((u) => u.id)));
  }, [labelScope, units]);

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => (s.size === units.length ? new Set() : new Set(units.map((u) => u.id))));
  }
  function partOf(r) { return parts.find((p) => p.id === r.part_master_id); }

  function currentSize() {
    if (labelPreset === "custom") return { w: Number(customW) || 20, h: Number(customH) || 20 };
    const p = LABEL_PRESETS.find((x) => x.value === labelPreset);
    return { w: p.w, h: p.h };
  }
  function doPrint() {
    const picked = units.filter((u) => selected.has(u.id));
    if (!picked.length) { alert("กรุณาเลือกอย่างน้อย 1 ชิ้น"); return; }
    const { w, h } = currentSize();
    const rel = releases.find((r) => r.id === releaseId);
    const total = rel?.qty;
    // เติมข้อมูลลงแต่ละป้าย: โปรเจค / Part / MDF / REL / จำนวน (X OF Y)
    const chosen = picked.map((u) => {
      const part = parts.find((p) => p.id === u.part_master_id) || {};
      const proj = projects.find((p) => p.id === part.project_id) || {};
      return {
        ...u,
        _label: {
          projectNumber: proj.code || "",
          projectName: proj.name || "",
          partNo: part.part_no || "",
          mdfNo: part.mdf_no ?? "-",
          relNo: rel?.release_order || "",
          qtyText: labelScope === "lot"
            ? (total != null ? `รวม ${total} ชิ้น` : "")   // ป้ายรวมล็อต: โชว์จำนวนทั้งล็อต
            : ((u.unit_no != null && total != null)          // ป้ายรายชิ้น: X OF Y
                ? `${u.unit_no} OF ${total}`
                : (u.unit_no != null ? String(u.unit_no) : "")),
        },
      };
    });
    printLabels(chosen, { widthMm: w, heightMm: h, mode: printMode, title: "Part labels" });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">พิมพ์ QR / ป้าย</div>
          <div className="page-sub">ค้นหาล็อตที่เคย Release แล้วพิมพ์ป้ายซ้ำได้ทุกเมื่อ — ค่าเริ่มต้นขนาด 2×2 ซม.</div>
        </div>
      </div>

      <Card title="เลือกล็อตที่ต้องการพิมพ์">
        <Field label="ล็อต Release">
          <Select value={releaseId} onChange={(e) => setReleaseId(e.target.value)}
            options={releases.map((r) => ({ value: r.id, label: `${fmtDT(r.release_date)} — ${partOf(r)?.part_no || "-"} × ${r.qty} ชิ้น` }))} />
        </Field>
      </Card>

      {loading && <Card><div style={{ color: "var(--muted)", fontSize: 13 }}>กำลังโหลด...</div></Card>}

      {!loading && units.length > 0 && (
        <Card title={`ชิ้นงานในล็อตนี้ (${units.length})`} right={
          labelScope === "unit"
            ? <Btn size="sm" onClick={toggleAll}>{selected.size === units.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</Btn>
            : null
        }>
          <Field label="ชนิดป้าย">
            <div className="chip-row">
              <span className={`chip ${labelScope === "unit" ? "active" : ""}`} onClick={() => setLabelScope("unit")}>ป้ายรายชิ้น · ติดทุกชิ้น (ชิ้นใหญ่)</span>
              <span className={`chip ${labelScope === "lot" ? "active" : ""}`} onClick={() => setLabelScope("lot")}>ป้ายรวมล็อต · 1 ใบ (ชิ้นเล็ก สแกนกรอกจำนวน)</span>
            </div>
          </Field>
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 2px 14px", lineHeight: 1.6 }}>
            {labelScope === "unit"
              ? "พิมพ์ป้าย 1 ใบต่อ 1 ชิ้น — ติดสติกเกอร์รายชิ้น สแกนทีละชิ้น (จำนวน = 1)"
              : "พิมพ์ป้ายเดียวแทนทั้งล็อต — สแกน 1 ครั้งที่หน้าเครื่องแล้วกรอกจำนวนที่ทำ"}
          </div>

          {labelScope === "unit" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, marginBottom: 18 }}>
              {units.map((u) => (
                <label key={u.id} className={`unit-check ${selected.has(u.id) ? "checked" : ""}`}>
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} style={{ accentColor: "var(--accent)" }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{u.qr_code}</span>
                  <span style={{ display: "none" }}><QRCodeSVG id={`pq-${u.id}`} value={u.qr_code} size={90} /></span>
                </label>
              ))}
            </div>
          ) : (
            <div style={{ marginBottom: 18 }}>
              <label className="unit-check checked" style={{ maxWidth: 240 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{units[0]?.qr_code}</span>
                <span style={{ display: "none" }}><QRCodeSVG id={`pq-${units[0]?.id}`} value={units[0]?.qr_code || ""} size={90} /></span>
              </label>
            </div>
          )}

          <hr className="section-divider" />

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="ขนาดป้าย">
              <Select value={labelPreset} onChange={(e) => setLabelPreset(e.target.value)}
                options={LABEL_PRESETS.map((p) => ({ value: p.value, label: p.label }))} style={{ minWidth: 170 }} />
            </Field>
            {labelPreset === "custom" && (
              <>
                <Field label="กว้าง (มม.)"><Input type="number" value={customW} onChange={(e) => setCustomW(e.target.value)} style={{ width: 80 }} /></Field>
                <Field label="สูง (มม.)"><Input type="number" value={customH} onChange={(e) => setCustomH(e.target.value)} style={{ width: 80 }} /></Field>
              </>
            )}
            <Field label="รูปแบบ">
              <div className="chip-row">
                <span className={`chip ${printMode === "sheet" ? "active" : ""}`} onClick={() => setPrintMode("sheet")}>แผ่น A4</span>
                <span className={`chip ${printMode === "roll" ? "active" : ""}`} onClick={() => setPrintMode("roll")}>ม้วนป้าย</span>
              </div>
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", paddingBottom: 10 }}>
              <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> แสดงรหัสใต้ QR
            </label>
            <Btn variant="accent" onClick={doPrint} style={{ marginBottom: 2 }}><Icon name="printer" size={15} />พิมพ์ ({selected.size})</Btn>
          </div>
        </Card>
      )}

      {!loading && releaseId && units.length === 0 && (
        <div className="empty-state">
          <Icon name="qr" size={32} />
          <div className="empty-state-title">ไม่พบชิ้นงานในล็อตนี้</div>
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
function ReleaseEditModal({ release, onClose, onSaved }) {
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

          <div className="modal-actions">
            <Btn type="button" variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Btn>
            <Btn type="button" variant="accent" onClick={doSave} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function ReleaseManagePage() {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setReleases(await getReleasesFull());
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = releases.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [
      r.release_order, r.part_master?.part_no, r.part_master?.projects?.code,
      r.part_master?.projects?.name, r.note,
    ].some((v) => (v || "").toLowerCase().includes(q));
  });

  async function handleDelete(release) {
    setBusyId(release.id);
    try {
      const units = await listRows("part_units", { filters: { release_id: release.id } });
      const scanned = units.filter((u) => u.status !== "released").length;
      const msg = scanned > 0
        ? `ล็อตนี้มี ${units.length} ชิ้น และมี ${scanned} ชิ้นที่สแกนไปแล้ว (มีประวัติการทำงาน)\n\nการลบ Release นี้จะลบ QR และประวัติสแกนของชิ้นทั้งหมดในล็อตนี้ไปด้วย และกู้คืนไม่ได้\n\nยืนยันที่จะลบหรือไม่?`
        : `ล็อตนี้มี ${units.length} ชิ้น (ยังไม่มีการสแกน)\n\nต้องการลบ Release นี้พร้อม QR ทั้งหมดหรือไม่? การลบกู้คืนไม่ได้`;
      if (!confirm(msg)) { setBusyId(null); return; }
      await deleteReleaseCascade(release.id);
      await load();
    } catch (e) {
      alert("ลบไม่สำเร็จ: " + e.message);
    }
    setBusyId(null);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">จัดการ Release</div>
          <div className="page-sub">แก้ไขจำนวน/น้ำหนัก/ความยาว/หมายเหตุ หรือลบ Release ที่เคยปล่อยงานไปแล้ว</div>
        </div>
      </div>

      <Card>
        <Field label="ค้นหา">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="เลข Release Order / รหัส Part / รหัสโปรเจค / หมายเหตุ" />
        </Field>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>วันที่</th><th>Release Order</th><th>โปรเจค</th><th>Part</th><th>จำนวน</th>
                <th>น้ำหนัก/ชิ้น</th><th>ความยาว/ชิ้น</th><th>หมายเหตุ</th><th>ปล่อยโดย</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDT(r.release_date)}</td>
                  <td>{r.release_order || "-"}</td>
                  <td>{r.part_master?.projects?.code || "-"}</td>
                  <td>{r.part_master?.part_no || "-"}</td>
                  <td>{r.qty}</td>
                  <td>{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}</td>
                  <td>{r.length_mm ? `${fmtNum(r.length_mm)} มม.` : "-"}</td>
                  <td>{r.note || "-"}</td>
                  <td>{r.employee?.name || "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span onClick={() => setEditing(r)} style={{ color: "var(--accent-dk)", cursor: "pointer", marginRight: 12 }}>แก้ไข</span>
                    <span onClick={() => busyId !== r.id && handleDelete(r)} style={{ color: "var(--danger-hi)", cursor: busyId === r.id ? "wait" : "pointer" }}>
                      {busyId === r.id ? "กำลังลบ..." : "ลบ"}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>ไม่พบ Release</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <ReleaseEditModal
          release={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
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

function ReportPage({ goTo }) {
  // ── Quick actions: create a project, or jump to Release Production ──
  const [showNewProject, setShowNewProject] = useState(false);
  const [createdMsg, setCreatedMsg] = useState("");

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

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Report</div>
          <div className="page-sub">สรุปผลการสแกนตามช่วงเวลาและ Part ที่เลือก</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="ghost" onClick={() => setShowNewProject(true)}>
            <Icon name="folder" size={15} />สร้างโปรเจคใหม่
          </Btn>
          <Btn variant="accent" onClick={() => goTo && goTo("release")}>
            <Icon name="box" size={15} />เพิ่ม Release
          </Btn>
        </div>
      </div>

      {createdMsg && (
        <div className="card" style={{ background: "var(--accent-tint)", borderColor: "var(--accent)", color: "var(--accent-dk)", fontSize: 13, fontWeight: 600, padding: "12px 16px" }}>
          {createdMsg}
        </div>
      )}

      <Card title="ช่วงเวลาที่ต้องการดู">
        <div className="chip-row" style={{ marginBottom: 16 }}>
          {RANGE_MODES.map((m) => (
            <span key={m.value} className={`chip ${rangeMode === m.value ? "active" : ""}`} onClick={() => setRangeMode(m.value)}>
              {m.label}
            </span>
          ))}
        </div>

        {rangeMode === "preset" && <div style={{ marginBottom: 4 }}><PresetPicker value={preset} onChange={setPreset} /></div>}

        {rangeMode === "month" && (
          <div style={{ maxWidth: 220, marginBottom: 4 }}>
            <Field label="เลือกเดือนที่ต้องการดู">
              <Input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} />
            </Field>
          </div>
        )}

        {rangeMode === "custom" && (
          <div className="grid-2" style={{ maxWidth: 420, marginBottom: 4 }}>
            <Field label="จากวันที่"><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></Field>
            <Field label="ถึงวันที่"><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></Field>
          </div>
        )}

        <div className="section-divider" />

        <div style={{ maxWidth: 280 }}>
          <Field label="กรองเฉพาะ Part (เว้นว่าง = ดูทุก Part)">
            <Select value={partFilter} onChange={(e) => setPartFilter(e.target.value)}
              options={parts.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.part_name}` }))} />
          </Field>
        </div>
      </Card>

      <div className="stat-row">
        <StatCard label="จำนวนชิ้นที่ทำ · รวมทุกขั้นตอน" value={totalPieces(filteredLogs).toLocaleString()} icon="scan" />
        <StatCard label="งาน/ล็อตที่มีความเคลื่อนไหว" value={distinctUnits.toLocaleString()} icon="box" />
        <StatCard label="น้ำหนักวัสดุ · นับต่อชิ้น (กก.)" value={fmtNum(material)} icon="weight" />
        <StatCard label="ปริมาณงานที่ประมวลผล · ทุกขั้นตอน (กก.)" value={fmtNum(processed)} icon="bolt" />
      </div>
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
              <Bar dataKey="count" name="จำนวนชิ้น" fill={CHART.accent} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="เครื่องจักร × ขั้นตอน (ปริมาณงานที่ประมวลผล)">
        {matrix.machines.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 2px" }}>ยังไม่มีการสแกนในช่วงเวลานี้</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>เครื่องจักร</th>
                  {matrix.opNames.map((op) => <th key={op}>{op}</th>)}
                  <th>รวม</th>
                </tr>
              </thead>
              <tbody>
                {matrix.machines.map((m) => (
                  <tr key={m.name}>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    {matrix.opNames.map((op) => {
                      const cell = m.ops[op];
                      return (
                        <td key={op}>
                          {cell
                            ? <span>{cell.count} ชิ้น{cell.weight ? <span style={{ color: "var(--muted)" }}> · {fmtNum(cell.weight)} กก.</span> : null}</span>
                            : <span style={{ color: "var(--surface-3)" }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ fontWeight: 600 }}>
                      {m.total.count} ชิ้น{m.total.weight ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {fmtNum(m.total.weight)} กก.</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>
          เครื่องที่ทำได้หลายขั้นตอนจะเห็นน้ำหนักแยกรายขั้นตอนในคอลัมน์ต่างๆ — ตัวเลขนี้คือปริมาณงาน (นับต่อการสแกน) ไม่ใช่จำนวนวัสดุ
        </div>
      </Card>

      <Card title="Part No. × ขั้นตอน (จำนวนชิ้น)">
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          แต่ละแถวคือเบอร์ Part — คอลัมน์คือขั้นตอนการทำงาน — ตัวเลขในช่องคือจำนวนชิ้นที่ผ่านขั้นตอนนั้น (งานหน้าเครื่องนับตามจำนวนที่กรอก)
        </div>
        {partMatrix.parts.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 2px" }}>ยังไม่มีการสแกนในช่วงเวลานี้</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Part No.</th>
                  <th>ชื่อ Part</th>
                  {partMatrix.opNames.map((op) => <th key={op}>{op}</th>)}
                  <th>รวม</th>
                </tr>
              </thead>
              <tbody>
                {partMatrix.parts.map((p) => (
                  <tr key={p.partNo}>
                    <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12.5 }}>{p.partNo}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12.5 }}>{p.partName}</td>
                    {partMatrix.opNames.map((op) => {
                      const cell = p.ops[op];
                      return (
                        <td key={op}>
                          {cell ? (
                            <span>
                              {cell.count.toLocaleString()} ชิ้น
                              {cell.weight > 0 && (
                                <span style={{ color: "var(--muted)", fontSize: 11 }}> · {fmtNum(cell.weight)} กก.</span>
                              )}
                            </span>
                          ) : (
                            <span style={{ color: "var(--surface-3)" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ fontWeight: 600 }}>
                      {p.total.count.toLocaleString()} ชิ้น
                      {p.total.weight > 0 && (
                        <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {fmtNum(p.total.weight)} กก.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showNewProject && (
        <QuickAddProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(project) => {
            setCreatedMsg(`สร้างโปรเจค ${project.code} — ${project.name} สำเร็จ`);
            setTimeout(() => setCreatedMsg(""), 3500);
          }}
        />
      )}
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
        <div className="page-title">Machines Summary</div>
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
              <Bar dataKey="count" name="จำนวนชิ้น" fill={CHART.success} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>เครื่องจักร</th>
                {matrix.opNames.map((op) => <th key={op}>{op}</th>)}
                <th>รวมทุกขั้นตอน</th>
              </tr>
            </thead>
            <tbody>
              {matrix.machines.map((m) => (
                <tr key={m.name}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  {matrix.opNames.map((op) => {
                    const cell = m.ops[op];
                    return (
                      <td key={op}>
                        {cell
                          ? <span>{cell.count} ชิ้น{cell.weight ? <span style={{ color: "var(--muted)" }}> · {fmtNum(cell.weight)} กก.</span> : null}</span>
                          : <span style={{ color: "var(--surface-3)" }}>—</span>}
                      </td>
                    );
                  })}
                  <td style={{ fontWeight: 600 }}>
                    {m.total.count} ชิ้น{m.total.weight ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {fmtNum(m.total.weight)} กก.</span> : null}
                  </td>
                </tr>
              ))}
              {matrix.machines.length === 0 && (
                <tr><td colSpan={matrix.opNames.length + 2} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>ยังไม่มีการสแกนในช่วงเวลานี้</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 7) PROJECTS SUMMARY
// ══════════════════════════════════════════════════════════════════════════
function ProjectsSummaryPage() {
  // รวมยอดฝั่ง DB ผ่าน RPC — ไม่ต้องโหลด part_units ทุกแถวมาคำนวณใน browser (แก้ H6)
  const [rows, setRows] = useState([]);
  useEffect(() => { getProjectSummary().then(setRows); }, []);
  return (
    <div>
      <div className="page-head"><div className="page-title">Projects Summary</div></div>
      <Card title="ความคืบหน้าแยกตามโปรเจค (สะสมทั้งหมด)">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>รหัส</th><th>โปรเจค</th><th>ปล่อยงาน (ชิ้น)</th><th>เสร็จแล้ว</th><th>% เสร็จ</th><th>น้ำหนักวัสดุ (กก.)</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.total ? Math.round((r.finished / r.total) * 100) : 0;
                return (
                  <tr key={r.id}>
                    <td>{r.code}</td><td>{r.name}</td><td>{r.total}</td><td>{r.finished}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 64, height: 6, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "var(--success)" : "var(--accent)" }} />
                        </div>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{pct}%</span>
                      </div>
                    </td>
                    <td>{fmtNum(r.weight)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 8) PARTS SUMMARY
// ══════════════════════════════════════════════════════════════════════════
function PartsSummaryPage() {
  // รวมยอดฝั่ง DB ผ่าน RPC (เรียงตามจำนวนมาก→น้อยมาจาก DB แล้ว) — แก้ H6
  const [rows, setRows] = useState([]);
  useEffect(() => { getPartSummary().then(setRows); }, []);
  return (
    <div>
      <div className="page-head"><div className="page-title">Parts Summary</div></div>
      <Card title="สรุปแยกตามชนิด Part (สะสมทั้งหมด)">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Part No.</th><th>ชื่อ Part</th><th>ปล่อยงาน</th><th>เสร็จแล้ว</th><th>น้ำหนักวัสดุ (กก.)</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{r.part_no}</td><td>{r.part_name}</td><td>{r.total}</td><td>{r.finished}</td><td>{fmtNum(r.weight)}</td></tr>
              ))}
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
      if (typed !== project.code) { if (typed !== null) alert("รหัสโปรเจคไม่ตรง ยกเลิกการลบ"); return; }
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
  const [form, setForm] = useState({});
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
    { key: "operations", label: "ขั้นตอนงาน" },
    { key: "projects", label: "โปรเจค" },
    { key: "parts", label: "Part Master / Routing" },
    { key: "employees", label: "พนักงาน" },
    { key: "departments", label: "แผนก" },
  ];
  return (
    <div>
      <div className="page-head"><div className="page-title">Setup</div></div>
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
    </div>
  );
}

// เครื่องจักร + ความสามารถ (ทำขั้นตอนไหนได้บ้าง) — ใช้ตรวจตอนสแกนว่าเครื่องนี้
// ทำขั้นตอนนั้นได้จริง และให้หน้ารายงานแยกน้ำหนักของเครื่องออกเป็นราย-ขั้นตอนได้
function MachineCapModal({ machine, operations, caps, onClose, onSaved }) {
  const initial = new Set(caps.filter((c) => c.machine_id === machine.id).map((c) => c.operation_id));
  const [selected, setSelected] = useState(initial);
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
          <span key={o.id} onClick={() => toggle(o.id)} className={`chip ${selected.has(o.id) ? "active" : ""}`}>{o.name}</span>
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
  const [form, setForm] = useState({});
  const [editingCaps, setEditingCaps] = useState(null);
  const [err, setErr] = useState("");

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
  async function remove(id) { if (confirm("ลบเครื่องนี้?")) { await deleteRow("machines", id); load(); } }

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
        เครื่องหนึ่งทำได้หลายขั้นตอน — กด "ความสามารถ" เพื่อเลือกว่าเครื่องนี้ทำอะไรได้บ้าง ระบบจะใช้ตรวจตอนสแกน
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>รหัสเครื่อง</th><th>ชื่อเครื่องจักร</th><th>ประเภท</th><th>ขั้นตอนที่ทำได้</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const names = capNames(r.id);
              return (
                <tr key={r.id}>
                  <td>{r.code}</td><td>{r.name}</td><td>{r.type || "-"}</td>
                  <td>
                    {names.length > 0
                      ? names.join(" · ")
                      : <span style={{ color: "var(--muted)" }}>ไม่จำกัด (ยังไม่ตั้ง)</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span onClick={() => setEditingCaps(r)} style={{ color: "var(--accent-dk)", cursor: "pointer", marginRight: 12 }}>ความสามารถ</span>
                    <span onClick={() => remove(r.id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editingCaps && (
        <MachineCapModal
          machine={editingCaps} operations={operations} caps={caps}
          onClose={() => setEditingCaps(null)}
          onSaved={async () => { setEditingCaps(null); await load(); }}
        />
      )}
    </Card>
  );
}

function SimpleCrud({ table, fields }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({});
  const load = useCallback(async () => setRows(await listRows(table, { order: fields[0].key })), [table, fields]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form[fields[0].key]) return;
    await insertRow(table, form);
    setForm({}); load();
  }
  async function remove(id) { if (confirm("ลบรายการนี้?")) { await deleteRow(table, id); load(); } }

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

function EmployeeEditModal({ employee, departments, machines, operations, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: employee.name,
    department_id: employee.department_id || "",
    role: employee.role,
    machine_id: employee.machine_id || "",
    operation_id: employee.operation_id || "",
    password: "", // เว้นว่าง = ไม่เปลี่ยนรหัสผ่าน
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!form.name.trim()) { setErr("กรอกชื่อให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      // บันทึกผ่าน RPC — DB จัดการ bcrypt เอง client ไม่แตะ hash (แก้ C2/H1)
      await upsertEmployee({
        id: employee.id,
        code: employee.code,
        name: form.name.trim(),
        password: form.password, // "" = ไม่เปลี่ยน
        role: form.role,
        department_id: form.department_id || null,
        machine_id: form.machine_id || null,
        operation_id: form.operation_id || null,
        active: employee.active,
      });
      onSaved();
    } catch (e) {
      setErr("บันทึกไม่สำเร็จ: " + e.message);
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
        <Field label="เครื่องจักรประจำ *"><Select value={form.machine_id} onChange={(e) => setForm({ ...form, machine_id: e.target.value })}
          options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} /></Field>
        <Field label="ขั้นตอนประจำ *"><Select value={form.operation_id} onChange={(e) => setForm({ ...form, operation_id: e.target.value })}
          options={operations.map((o) => ({ value: o.id, label: o.name }))} /></Field>
      </div>
      <Field label="ตั้งรหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)">
        <Input type="password" value={form.password} autoComplete="new-password"
          onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
      </Field>
      {(!form.machine_id || !form.operation_id) && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          * ถ้าไม่ตั้งเครื่องจักร/ขั้นตอนประจำ พนักงานคนนี้จะสแกนงานไม่ได้
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

function EmployeeCrud() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [machines, setMachines] = useState([]);
  const [operations, setOperations] = useState([]);
  const [form, setForm] = useState({ role: "operator" });
  const [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    setRows(await getEmployees());
    setDepartments(await listRows("departments", { order: "name" }));
    setMachines(await listRows("machines", { order: "code" }));
    setOperations(await listRows("operations", { order: "seq" }));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.code || !form.name || !form.password) { alert("กรอกรหัส/ชื่อ/รหัสผ่านให้ครบ"); return; }
    try {
      // สร้างผ่าน RPC — DB hash ด้วย bcrypt เอง client ไม่แตะ hash (แก้ C2/H1)
      await upsertEmployee({
        code: form.code, name: form.name, password: form.password, role: form.role,
        department_id: form.department_id || null,
        machine_id: form.machine_id || null, operation_id: form.operation_id || null,
      });
      setForm({ role: "operator" }); load();
    } catch (e) {
      alert(isDuplicateError(e) ? `รหัสพนักงาน "${form.code}" มีอยู่แล้ว` : "เพิ่มพนักงานไม่สำเร็จ: " + e.message);
    }
  }
  async function toggle(r) {
    try { await setEmployeeActive(r.id, !r.active); load(); }
    catch (e) { alert("เปลี่ยนสถานะไม่สำเร็จ: " + e.message); }
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
        <Field label="เครื่องจักรประจำ"><Select value={form.machine_id} onChange={(e) => setForm({ ...form, machine_id: e.target.value })}
          options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} /></Field>
        <Field label="ขั้นตอนประจำ"><Select value={form.operation_id} onChange={(e) => setForm({ ...form, operation_id: e.target.value })}
          options={operations.map((o) => ({ value: o.id, label: o.name }))} /></Field>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        พนักงานที่ยังไม่ได้ตั้งเครื่องจักร/ขั้นตอนประจำ จะสแกนงานไม่ได้ (ตั้งภายหลังได้ที่ปุ่ม "แก้ไข")
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
                <td>{operations.find((o) => o.id === r.operation_id)?.name || <span style={{ color: "var(--danger-hi)" }}>ยังไม่ตั้ง</span>}</td>
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
          employee={editing} departments={departments} machines={machines} operations={operations}
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
  const [operations, setOperations] = useState([]);
  const [form, setForm] = useState({ routing: [] });
  const load = useCallback(async () => {
    setRows(await listRows("part_master", { order: "part_no" }));
    setProjects(await listRows("projects", { order: "code" }));
    setOperations(await listRows("operations", { order: "seq" }));
  }, []);
  useEffect(() => { load(); }, [load]);

  function toggleOp(name) {
    setForm((f) => {
      const has = (f.routing || []).includes(name);
      return { ...f, routing: has ? f.routing.filter((x) => x !== name) : [...(f.routing || []), name] };
    });
  }

  async function add() {
    if (!form.part_no || !form.project_id) { alert("กรอกโปรเจคและรหัส Part ให้ครบ"); return; }
    await insertRow("part_master", {
      project_id: form.project_id, part_no: form.part_no, part_name: form.part_name || form.part_no,
      material: form.material, unit_weight: Number(form.unit_weight || 0),
      default_length_mm: form.default_length_mm === "" || form.default_length_mm == null ? null : Number(form.default_length_mm),
      routing: form.routing || [],
    });
    setForm({ routing: [] }); load();
  }
  async function remove(id) { if (confirm("ลบ Part นี้?")) { await deleteRow("part_master", id); load(); } }

  return (
    <Card title="เพิ่ม Part ใหม่ + กำหนด Routing">
      <div className="grid-3" style={{ marginBottom: 4 }}>
        <Field label="โปรเจค"><Select value={form.project_id || ""} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
          options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} /></Field>
        <Field label="รหัส Part"><Input value={form.part_no || ""} onChange={(e) => setForm({ ...form, part_no: e.target.value })} /></Field>
        <Field label="ชื่อ Part"><Input value={form.part_name || ""} onChange={(e) => setForm({ ...form, part_name: e.target.value })} /></Field>
        <Field label="วัสดุ"><Input value={form.material || ""} onChange={(e) => setForm({ ...form, material: e.target.value })} /></Field>
        <Field label="น้ำหนักโดยประมาณ/ชิ้น (กก.)"><Input type="number" step="0.01" value={form.unit_weight || ""} onChange={(e) => setForm({ ...form, unit_weight: e.target.value })} /></Field>
        <Field label="ความยาวโดยประมาณ/ชิ้น (มม.)"><Input type="number" step="0.1" value={form.default_length_mm || ""} onChange={(e) => setForm({ ...form, default_length_mm: e.target.value })} /></Field>
      </div>
      <div className="label-el">Routing — เลือกขั้นตอนที่ part นี้ต้องผ่านตามลำดับ</div>
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {operations.map((o) => {
          const active = (form.routing || []).includes(o.name);
          return (
            <span key={o.id} onClick={() => toggleOp(o.name)} className={`chip ${active ? "active" : ""}`}>
              {o.name}{active ? ` (${form.routing.indexOf(o.name) + 1})` : ""}
            </span>
          );
        })}
      </div>
      <Btn variant="accent" onClick={add}>เพิ่ม Part</Btn>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table">
          <thead><tr><th>Part No.</th><th>ชื่อ</th><th>น้ำหนัก/ชิ้น</th><th>ความยาว/ชิ้น</th><th>Routing</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.part_no}</td><td>{r.part_name}</td>
                <td>{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}</td>
                <td>{r.default_length_mm ? `${fmtNum(r.default_length_mm)} มม.` : "-"}</td>
                <td>{(r.routing || []).join(" → ")}</td>
                <td><span onClick={() => remove(r.id)} style={{ color: "var(--danger-hi)", cursor: "pointer" }}>ลบ</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
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
  if (!user) return <Login onLogin={setUser} />;
  if (goStation) return null; // กำลังพาไป /station
  return <Shell user={user} onLogout={logout} />;
}
