import { useState, useEffect, useRef, useCallback, forwardRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listRows, insertRow, insertRows, updateRow, updateRows, deleteRow, deleteRows,
  deleteReleaseCascade, deleteProjectCascade, getProjectImpact,
  findUnitByQr, getUnitHistory, getScanLogsBetween, getAllUnitsFull, getReleasesFull,
} from "./supabase.js";
import { ROLE_LABELS, getSession, setSession, clearSession, verifyLogin, hashPassword } from "./auth.js";
import { printLabels, LABEL_PRESETS } from "./labels.js";
import { parseReleaseExcel } from "./excelImport.js";
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
function Modal({ title, sub, onClose, children, closeOnBackdrop = true, locked = false }) {
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
      <div className={`modal${shake ? " modal-shake" : ""}`}>
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
const MENU = [
  { group: "การผลิต", items: [
    { key: "release", label: "Release Production", icon: "box" },
    { key: "detail", label: "สแกนหน้าเครื่อง", icon: "scan" },
    { key: "finished", label: "Finished Part", icon: "check" },
    { key: "labels", label: "พิมพ์ QR / ป้าย", icon: "qr" },
    { key: "manageReleases", label: "จัดการ Release", icon: "grid" },
  ] },
  { group: "รายงาน", items: [
    { key: "report", label: "Report", icon: "chart" },
    { key: "machines", label: "Machines Summary", icon: "machine" },
    { key: "projects", label: "Projects Summary", icon: "folder" },
    { key: "parts", label: "Parts Summary", icon: "grid" },
  ] },
  { group: "ระบบ", items: [
    { key: "setup", label: "Setup", icon: "settings" },
  ] },
];
const BOTTOM_LEFT = { key: "release", label: "Release", icon: "box" };
const BOTTOM_LEFT2 = { key: "finished", label: "เสร็จแล้ว", icon: "check" };
const BOTTOM_RIGHT = { key: "report", label: "รายงาน", icon: "chart" };

function Shell({ user, onLogout }) {
  const [tab, setTab] = useState("release");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [labelsPreselect, setLabelsPreselect] = useState(""); // release id ที่ส่งมาจากหน้ารายละเอียด Release เพื่อเปิดหน้าพิมพ์ QR แบบเลือกล็อตให้อัตโนมัติ
  const [scanRequestId, setScanRequestId] = useState(0); // เพิ่มค่าทุกครั้งที่กดปุ่มสแกนกลมด้านล่าง เพื่อสั่งเปิดกล้องแบบเต็มจอทันที
  const currentLabel = MENU.flatMap((g) => g.items).find((i) => i.key === tab)?.label || "";

  function go(key, opts) {
    setTab(key);
    setDrawerOpen(false);
    if (opts?.releaseId) setLabelsPreselect(opts.releaseId);
  }

  // ปุ่มสแกนกลมด้านล่าง: พาไปหน้าสแกน "และ" เปิดกล้องเต็มจอให้เลยทันที
  // ไม่ต้องกดเข้าหน้าแล้วกด "เริ่มสแกน" อีกรอบ (ถ้าตั้งค่าเครื่องจักร/ขั้นตอนประจำไว้แล้ว)
  function goScanNow() {
    setScanRequestId((n) => n + 1);
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
        {MENU.map((g) => (
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
        {MENU.map((g) => (
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
          {tab === "detail" && <ScanPage user={user} autoScanTrigger={scanRequestId} />}
          {tab === "finished" && <FinishedPartPage />}
          {tab === "labels" && <QrLabelsPage initialReleaseId={labelsPreselect} onConsumeInitial={() => setLabelsPreselect("")} />}
          {tab === "manageReleases" && <ReleaseManagePage />}
          {tab === "report" && <ReportPage goTo={go} />}
          {tab === "machines" && <MachinesSummaryPage />}
          {tab === "projects" && <ProjectsSummaryPage />}
          {tab === "parts" && <PartsSummaryPage />}
          {tab === "setup" && <SetupPage />}
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
    setBusy(true); setErr("");
    const allUnits = [];
    let releasesCreated = 0;
    let partsCreated = 0;
    try {
      // ทำทีละแถวตามลำดับ (ไม่ Promise.all) เพื่อกันสร้าง Part ซ้ำแข่งกันเอง
      for (let i = 0; i < rowsPreview.length; i++) {
        const row = rowsPreview[i];
        setProgress(`กำลังนำเข้า ${i + 1} / ${rowsPreview.length} — ${row.code}`);

        let part = row.existingPart;
        if (!part) {
          part = await insertRow("part_master", {
            project_id: projectId,
            part_no: row.code,
            part_name: row.code,
            material: row.material,
            unit_weight: row.unit_weight ?? 0,
            default_length_mm: row.length_mm,
            routing: [],
          });
          partsCreated += 1;
        }

        const release = await insertRow("releases", {
          part_master_id: part.id,
          qty: row.qty,
          unit_weight: row.unit_weight,
          length_mm: row.length_mm,
          released_by: user.id,
          note: row.remark,
          release_order: parsed.releaseOrder || null,
        });
        releasesCreated += 1;

        const suffix = release.id.slice(0, 6).toUpperCase();
        const units = Array.from({ length: row.qty }, (_, u) => ({
          release_id: release.id,
          part_master_id: part.id,
          unit_no: u + 1,
          qr_code: `${part.part_no}-${suffix}-${String(u + 1).padStart(4, "0")}`,
          status: "released",
          weight: release.unit_weight,
          length_mm: release.length_mm,
        }));
        const created = await insertRows("part_units", units);
        allUnits.push(...created);
      }
      onImported({ units: allUnits, releaseOrder: parsed.releaseOrder, releasesCreated, partsCreated });
      onClose();
    } catch (e2) {
      setErr("เกิดข้อผิดพลาดระหว่างนำเข้า: " + e2.message + (allUnits.length ? ` (สร้างสำเร็จไปแล้ว ${releasesCreated} release ก่อนพัง — ตรวจสอบประวัติ Release ด้านล่างได้)` : ""));
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
    const key = r.release_order ? `RO:${r.release_order}` : `S:${r.id}`;
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

function ReleaseGroupDetail({ group, onBack, goTo }) {
  const noteLabel = group.notes.size === 0 ? "-" : group.notes.size === 1 ? [...group.notes][0] : `${group.notes.size} หมายเหตุ`;
  return (
    <div>
      <div className="page-head">
        <div>
          <Btn variant="ghost" size="sm" onClick={onBack} style={{ marginBottom: 8 }}>
            <Icon name="arrowLeft" size={14} /> กลับไปหน้า Release
          </Btn>
          <div className="page-title">{group.releaseOrder ? `Release Order: ${group.releaseOrder}` : `Release — ${group.releases[0]?.part_master?.part_no || ""}`}</div>
          <div className="page-sub">{group.projectCode} — {group.projectName} · {fmtDT(group.date)}</div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Card><div className="label-el">จำนวนรวม</div><div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(group.totalQty)} ชิ้น</div></Card>
        <Card><div className="label-el">น้ำหนักรวม</div><div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(group.totalWeight)} กก.</div></Card>
        <Card><div className="label-el">จำนวน Part</div><div style={{ fontSize: 22, fontWeight: 700 }}>{group.releases.length} Part</div></Card>
      </div>

      <Card title="รายละเอียดแต่ละ Part ในล็อตนี้">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Part No.</th><th>ชื่อ Part</th><th>จำนวน</th><th>น้ำหนัก/ชิ้น</th><th>น้ำหนักรวม</th><th>ความยาว/ชิ้น</th><th>หมายเหตุ</th><th></th></tr>
            </thead>
            <tbody>
              {group.releases.map((r) => (
                <tr key={r.id}>
                  <td>{r.part_master?.part_no || "-"}</td>
                  <td>{r.part_master?.part_name || "-"}</td>
                  <td>{r.qty}</td>
                  <td>{r.unit_weight ? `${fmtNum(r.unit_weight)} กก.` : "-"}</td>
                  <td>{r.unit_weight ? `${fmtNum(r.qty * r.unit_weight)} กก.` : "-"}</td>
                  <td>{r.length_mm ? `${fmtNum(r.length_mm)} มม.` : "-"}</td>
                  <td>{r.note || "-"}</td>
                  <td>
                    <span onClick={() => goTo && goTo("labels", { releaseId: r.id })} style={{ color: "var(--accent-dk)", cursor: "pointer", whiteSpace: "nowrap" }}>
                      <Icon name="printer" size={13} /> พิมพ์ QR
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {noteLabel !== "-" && group.notes.size > 1 && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>หมายเหตุทั้งหมด: {[...group.notes].join(" · ")}</div>
      )}
    </div>
  );
}

function ReleasePage({ user, goTo }) {
  const [projects, setProjects] = useState([]);
  const [parts, setParts] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState(10);
  const [relWeight, setRelWeight] = useState("");
  const [relLength, setRelLength] = useState("");
  const [note, setNote] = useState("");
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewPart, setShowNewPart] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [viewGroup, setViewGroup] = useState(null); // group ที่กำลังดูรายละเอียดอยู่ (null = แสดงตารางสรุป)
  const [makeQr, setMakeQr] = useState(true); // ปิดได้เมื่อแค่ต้องการบันทึก Release ไว้ ไม่ต้องสร้าง QR ต่อชิ้น

  const load = useCallback(async () => {
    setProjects(await listRows("projects", { order: "code" }));
    setParts(await listRows("part_master", { order: "part_no" }));
    setRecent(await getReleasesFull());
  }, []);
  useEffect(() => { load(); }, [load]);

  const partsInProject = parts.filter((p) => !projectId || p.project_id === projectId);
  const selectedPart = parts.find((p) => p.id === partId);
  const selectedProject = projects.find((p) => p.id === projectId);
  const groups = groupReleases(recent.slice(0, 60)); // ดูย้อนหลังพอประมาณ ไม่โหลดทั้งหมด

  useEffect(() => {
    setRelWeight(selectedPart ? selectedPart.unit_weight ?? "" : "");
    setRelLength(selectedPart ? selectedPart.default_length_mm ?? "" : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  async function doRelease() {
    if (!partId || !qty) return;
    setBusy(true);
    try {
      const release = await insertRow("releases", {
        part_master_id: partId, qty: Number(qty), released_by: user.id, note,
        unit_weight: relWeight === "" ? null : Number(relWeight),
        length_mm: relLength === "" ? null : Number(relLength),
      });
      if (makeQr) {
        const suffix = release.id.slice(0, 6).toUpperCase();
        const units = Array.from({ length: Number(qty) }, (_, i) => ({
          release_id: release.id,
          part_master_id: partId,
          unit_no: i + 1,
          qr_code: `${selectedPart.part_no}-${suffix}-${String(i + 1).padStart(4, "0")}`,
          status: "released",
          weight: release.unit_weight,
          length_mm: release.length_mm,
        }));
        await insertRows("part_units", units); // สร้าง QR เบื้องหลังไว้เลย — ไปพิมพ์ทีหลังได้จากหน้ารายละเอียด/พิมพ์ QR
      } // ถ้าปิดสวิตช์ไว้ จะบันทึกแค่ยอด Release เท่านั้น ไม่สร้างชิ้น/QR ให้
      setNote(""); setQty(10);
      await load();
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
    setBusy(false);
  }

  if (viewGroup) {
    return <ReleaseGroupDetail group={viewGroup} onBack={() => setViewGroup(null)} goTo={goTo} />;
  }

  return (
    <div>
      <div className="page-head page-head-release">
        <div>
          <div className="page-title">Release Production</div>
          <div className="page-sub">ปล่อยงานใหม่ — สร้าง QR ต่อชิ้นให้อัตโนมัติ ไปพิมพ์ป้ายทีหลังได้จากหน้ารายละเอียด</div>
        </div>
        <Btn variant="ghost" className="release-import-btn" onClick={() => setShowImport(true)}>
          <Icon name="folder" size={15} />นำเข้าจาก Excel (หลาย Part)
        </Btn>
      </div>

      <Card title="ปล่อยงานใหม่">
        <div className="grid-2">
          <div className="field-inline-btn">
            <Field label="โปรเจค">
              <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPartId(""); }}
                options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
            </Field>
            <Btn type="button" variant="ghost" className="icon-btn-add" title="สร้างโปรเจคใหม่" onClick={() => setShowNewProject(true)}>
              <Icon name="plus" size={16} />
            </Btn>
          </div>
          <div className="field-inline-btn">
            <Field label="Part">
              <Select value={partId} onChange={(e) => setPartId(e.target.value)}
                options={partsInProject.map((p) => ({ value: p.id, label: `${p.part_no} — ${p.part_name}` }))} />
            </Field>
            <Btn type="button" variant="ghost" className="icon-btn-add" title={projectId ? "สร้าง Part ใหม่" : "เลือกโปรเจคก่อน"}
              disabled={!projectId} onClick={() => setShowNewPart(true)}>
              <Icon name="plus" size={16} />
            </Btn>
          </div>
          <Field label="จำนวน (ชิ้น)">
            <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="หมายเหตุ">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่บังคับ" />
          </Field>
          <Field label="น้ำหนัก/ชิ้น (กก.)">
            <Input type="number" step="0.01" value={relWeight} onChange={(e) => setRelWeight(e.target.value)} placeholder="เช่น 1.25" />
          </Field>
          <Field label="ความยาว/ชิ้น (มม.)">
            <Input type="number" step="0.1" value={relLength} onChange={(e) => setRelLength(e.target.value)} placeholder="เช่น 600" />
          </Field>
        </div>
        {selectedPart && (
          <div style={{ marginBottom: 14 }}>
            <RoutingRail routing={selectedPart.routing} doneOps={[]} />
          </div>
        )}

        <label className="toggle-row">
          <span className={`toggle-switch${makeQr ? " on" : ""}`}>
            <input type="checkbox" checked={makeQr} onChange={(e) => setMakeQr(e.target.checked)} />
            <span className="toggle-knob" />
          </span>
          <span className="toggle-text">
            <span className="toggle-text-title">สร้าง QR ต่อชิ้น</span>
            <span className="toggle-text-sub">
              {makeQr
                ? "จะสร้างป้าย QR ให้ทุกชิ้นอัตโนมัติ ไปพิมพ์ป้ายทีหลังได้"
                : "ปิดอยู่ — จะบันทึกแค่ยอด Release เท่านั้น ไม่สร้าง QR ให้ (ใช้เมื่อไม่ต้องแปะป้ายติดชิ้นงาน)"}
            </span>
          </span>
        </label>

        <Btn variant="accent" size="lg" className="release-submit-btn" onClick={doRelease} disabled={busy || !partId}>
          <Icon name={makeQr ? "box" : "check"} size={16} />
          {busy
            ? (makeQr ? "กำลังสร้าง QR..." : "กำลังบันทึก...")
            : (makeQr ? `Release + สร้าง QR ${qty || 0} ใบ` : "บันทึก Release (ไม่สร้าง QR)")}
        </Btn>
      </Card>

      <Card title="ประวัติการ Release ล่าสุด">
        <div className="table-wrap">
          <table className="data-table responsive-cards">
            <thead><tr><th>วันที่</th><th>โปรเจค</th><th>Release Order</th><th>จำนวนรวม</th><th>น้ำหนักรวม</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="release-row" onClick={() => setViewGroup(g)}>
                  <td data-label="วันที่">{fmtDT(g.date)}</td>
                  <td data-label="โปรเจค">{g.projectCode}</td>
                  <td data-label="Release Order">{g.releaseOrder || (g.releases[0]?.part_master?.part_no ?? "-")}</td>
                  <td data-label="จำนวนรวม">{fmtNum(g.totalQty)} ชิ้น{g.releases.length > 1 ? ` (${g.releases.length} Part)` : ""}</td>
                  <td data-label="น้ำหนักรวม">{g.totalWeight ? `${fmtNum(g.totalWeight)} กก.` : "-"}</td>
                  <td data-label="หมายเหตุ">{g.notes.size === 0 ? "-" : g.notes.size === 1 ? [...g.notes][0] : `${g.notes.size} หมายเหตุ`}</td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>ยังไม่มี Release</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showImport && (
        <ImportReleaseModal
          user={user}
          projects={projects}
          parts={parts}
          onClose={() => setShowImport(false)}
          onImported={async ({ units, releasesCreated, partsCreated }) => {
            await load();
            alert(
              `นำเข้าสำเร็จ: สร้าง ${releasesCreated} release (${units.length} QR)` +
              (partsCreated > 0 ? ` · สร้าง Part ใหม่ ${partsCreated} รายการ` : "")
            );
          }}
        />
      )}

      {showNewProject && (
        <QuickAddProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(project) => {
            setProjects((prev) => [...prev, project].sort((a, b) => a.code.localeCompare(b.code)));
            setProjectId(project.id);
            setPartId("");
          }}
        />
      )}
      {showNewPart && selectedProject && (
        <QuickAddPartModal
          project={selectedProject}
          onClose={() => setShowNewPart(false)}
          onCreated={(part) => {
            setParts((prev) => [...prev, part].sort((a, b) => a.part_no.localeCompare(b.part_no)));
            setPartId(part.id);
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
function ScanPage({ user, autoScanTrigger }) {
  const [stationOpen, setStationOpen] = useState(false);
  const ready = !!(user.machine && user.operation);

  // มาจากปุ่มสแกนกลมด้านล่าง (bottom-nav) — เปิดกล้องเต็มจอให้ทันที ไม่ต้องกด "เริ่มสแกน" ซ้ำ
  useEffect(() => {
    if (autoScanTrigger && ready) setStationOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScanTrigger]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">สแกนหน้าเครื่องจักร</div>
          <div className="page-sub">ล็อกอินแล้วสแกนงานที่ตัวเองทำได้ทันที ไม่ต้องเลือกเครื่องจักร/ขั้นตอนเอง</div>
        </div>
      </div>

      <Card title="สถานีของคุณ">
        {ready ? (
          <>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div>
                <div className="label-el">เครื่องจักรประจำ</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{user.machine.code} — {user.machine.name}</div>
              </div>
              <div>
                <div className="label-el">ขั้นตอนประจำ</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{user.operation.name}</div>
              </div>
            </div>
            <Btn variant="accent" size="lg" className="btn-block" onClick={() => setStationOpen(true)}>
              <Icon name="scan" size={18} /> เริ่มสแกน
            </Btn>
          </>
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

      <Card title="วิธีใช้งาน">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--muted)", lineHeight: 2 }}>
          <li>ยิงด้วยเครื่องสแกนบาร์โค้ด แล้วระบบจะค้นหาให้อัตโนมัติ</li>
          <li>หรือเปิดกล้องมือถือเพื่อสแกน QR เอง</li>
          <li>สแกนต่อเนื่องได้เรื่อยๆ โดยไม่ต้องออกจากหน้าจอสแกน</li>
        </ul>
      </Card>

      {stationOpen && (
        <ScanStation
          user={user} machine={user.machine} operation={user.operation}
          onExit={() => setStationOpen(false)}
        />
      )}
    </div>
  );
}

const QR_CAM_REGION_ID = "qr-cam-region";

function ScanStation({ user, machine, operation, onExit }) {
  const [qrInput, setQrInput] = useState("");
  const [unit, setUnit] = useState(null);
  const [history, setHistory] = useState([]);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState("muted");
  // เปิดกล้องอัตโนมัติทันทีที่เข้าหน้าสแกน — พร้อมสแกนเลยไม่ต้องกดเปิดเอง
  const [cameraOn, setCameraOn] = useState(true);
  // frozen = เจอ QR แล้ว ภาพค้างไว้ (ไม่สแกนซ้ำ) จนกว่าจะยืนยันหรือกดรีเฟรช
  const [frozen, setFrozen] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const inputRef = useRef(null);
  const scannerRef = useRef(null); // instance ของ Html5Qrcode ที่กำลังทำงานอยู่

  useEffect(() => { inputRef.current?.focus(); }, [unit]);

  // เปิดกล้อง — บังคับใช้กล้องหลัง(ตัวหลัก ไม่ใช่ ultra-wide/telephoto) และเริ่มสแกนทันที
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;

    async function onDecoded(decodedText) {
      // เจอ QR แล้ว — สั่งค้างภาพไว้ก่อนทันที กันสแกนซ้ำ จนกว่าจะยืนยัน/กดรีเฟรช
      try { scannerRef.current?.pause(true); } catch (_) {}
      setFrozen(true);
      setQrInput(decodedText);
      lookup(decodedText);
    }

    async function pickRearCameraId(Html5Qrcode) {
      try {
        const devices = await Html5Qrcode.getCameras();
        const back = (devices || []).filter((d) => /back|rear|environment/i.test(d.label || ""));
        // เลี่ยงเลนส์ ultra-wide / telephoto ถ้ามีตัวเลือก เอากล้องหลังตัวหลักจริงๆ
        const main = back.find((d) => !/ultra|wide[\s-]?angle|tele(photo)?|0\.5x/i.test(d.label || "")) || back[0];
        return main ? main.id : null;
      } catch (_) {
        return null; // ยังไม่ได้สิทธิ์กล้อง — จะ fallback ไปใช้ facingMode แทน
      }
    }

    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled) return;
      const html5QrCode = new Html5Qrcode(QR_CAM_REGION_ID, false);
      scannerRef.current = html5QrCode;
      const config = { fps: 10, qrbox: 220 };
      const rearId = await pickRearCameraId(Html5Qrcode);
      if (cancelled) return;
      try {
        // บังคับกล้องหลังตัวหลักที่หาเจอ ถ้าไม่เจอค่อย fallback เป็น facingMode: environment (exact)
        await html5QrCode.start(rearId || { facingMode: { exact: "environment" } }, config, onDecoded, () => {});
      } catch (_) {
        try {
          if (!cancelled) await html5QrCode.start({ facingMode: "environment" }, config, onDecoded, () => {});
        } catch (_e2) {
          if (!cancelled) { setMsg("เปิดกล้องไม่สำเร็จ — ตรวจสอบสิทธิ์การเข้าถึงกล้อง"); setMsgTone("danger"); }
        }
      }
    })();

    return () => {
      cancelled = true;
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (inst) { inst.stop().then(() => inst.clear()).catch(() => inst.clear?.().catch(() => {})); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  // ยกเลิกผลที่ค้างไว้ แล้วสแกนใหม่ (โดยไม่ต้องกดยืนยัน)
  function rescan() {
    setUnit(null); setHistory([]); setMsg(""); setQrInput(""); setFrozen(false);
    try { scannerRef.current?.resume(); } catch (_) {}
  }

  async function lookup(code) {
    const c = (code ?? qrInput).trim();
    if (!c) return;
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

  function onQrKeyDown(e) { if (e.key === "Enter") { e.preventDefault(); lookup(); } }

  // ไม่มีการพิมพ์ข้อมูลใดๆ เพิ่มตอนสแกน — น้ำหนัก/ความยาวถูกกำหนดไว้แล้วตั้งแต่ตอน
  // Release และคัดลอกมาพร้อมกับชิ้นงานนี้ (unit.weight / unit.length_mm) จึงบันทึกซ้ำตรงๆ
  async function confirmScan() {
    if (!unit || !machine || !operation) return;
    const routing = unit.part_master?.routing || [];
    const doneOps = history.map((x) => x.operation?.name).filter(Boolean);
    await insertRow("scan_logs", {
      part_unit_id: unit.id, machine_id: machine.id, operation_id: operation.id,
      employee_id: user.id, weight: unit.weight ?? null,
    });
    const newDone = new Set([...doneOps, operation.name]);
    const finished = routing.length > 0 && routing.every((r) => newDone.has(r));
    await updateRow("part_units", unit.id, { status: finished ? "finished" : "in_progress" });
    setMsg(finished ? "บันทึกแล้ว — ชิ้นนี้ทำครบทุกขั้นตอนแล้ว ✓" : "บันทึกการสแกนเรียบร้อย");
    setMsgTone("success");
    setSessionCount((c) => c + 1);
    setQrInput(""); setUnit(null); setHistory([]);
    setFrozen(false);
    try { scannerRef.current?.resume(); } catch (_) {} // พร้อมสแกนชิ้นถัดไปทันที
    setTimeout(() => setMsg(""), 2200);
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
          <div className="scan-topbar-sub">ขั้นตอน: {operation?.name}</div>
        </div>
        <div className="scan-counter">สแกนแล้ว {sessionCount} ชิ้น</div>
      </div>

      <div className="scan-viewport">
        {cameraOn ? (
          // ไม่เอา div นี้ออกตอนเจอ QR แล้ว (frozen) — ให้ภาพที่สแกนได้ค้างอยู่ ให้เห็นว่าเจอชิ้นไหน
          // จนกว่าจะกดยืนยัน หรือกดรีเฟรชเพื่อสแกนใหม่
          <div id={QR_CAM_REGION_ID} style={{ width: "min(92vw,420px)" }} />
        ) : unit ? (
          <div className="scan-idle-hint">
            <Icon name="check" size={40} />
            <div>พบชิ้นงานแล้ว — ดูรายละเอียดด้านล่าง</div>
          </div>
        ) : (
          <div className="scan-frame">
            <div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" />
            <div className="scan-line" />
          </div>
        )}
      </div>

      <div className="scan-manual">
        <div style={{ display: "flex", gap: 8 }}>
          <Input ref={inputRef} value={qrInput} onChange={(e) => setQrInput(e.target.value)} onKeyDown={onQrKeyDown}
            placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัส QR แล้วกด Enter" autoFocus />
          <Btn variant="accent" onClick={() => lookup()}><Icon name="search" size={16} /></Btn>
        </div>
        <button className="btn scan-toggle-cam" onClick={() => setCameraOn((v) => !v)}>
          <Icon name="camera" size={15} style={{ marginRight: 6 }} />{cameraOn ? "ปิดกล้อง" : "เปิดกล้องสแกน QR"}
        </button>
      </div>

      {(msg || unit) && (
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
        <StatCard label="น้ำหนักรวม (กก.)" value={fmtNum(totalWeight)} icon="weight" />
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
  const [releaseId, setReleaseId] = useState("");
  const [units, setUnits] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const [labelPreset, setLabelPreset] = useState("20x20");
  const [customW, setCustomW] = useState(20);
  const [customH, setCustomH] = useState(20);
  const [showCode, setShowCode] = useState(false);
  const [printMode, setPrintMode] = useState("sheet");

  useEffect(() => {
    (async () => {
      setReleases(await listRows("releases", { order: "release_date", ascending: false }));
      setParts(await listRows("part_master", { order: "part_no" }));
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
      setSelected(new Set(rows.map((r) => r.id)));
      setLoading(false);
    });
  }, [releaseId]);

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
    const chosen = units.filter((u) => selected.has(u.id));
    if (!chosen.length) { alert("กรุณาเลือกอย่างน้อย 1 ชิ้น"); return; }
    const { w, h } = currentSize();
    printLabels(chosen, { widthMm: w, heightMm: h, showCode, mode: printMode, title: "QR labels" });
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
          <Btn size="sm" onClick={toggleAll}>{selected.size === units.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</Btn>
        }>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, marginBottom: 18 }}>
            {units.map((u) => (
              <label key={u.id} className={`unit-check ${selected.has(u.id) ? "checked" : ""}`}>
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} style={{ accentColor: "var(--accent)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{u.qr_code}</span>
                <span style={{ display: "none" }}><QRCodeSVG id={`pq-${u.id}`} value={u.qr_code} size={90} /></span>
              </label>
            ))}
          </div>

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
    setBusy(true); setErr("");
    try {
      const patch = {
        qty: qtyNum,
        unit_weight: unitWeight === "" ? null : Number(unitWeight),
        length_mm: lengthMm === "" ? null : Number(lengthMm),
        note: note || null,
        release_order: releaseOrder || null,
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
              <Input value={releaseOrder} onChange={(e) => setReleaseOrder(e.target.value)} placeholder="ไม่บังคับ" />
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

  const totalWeight = filteredLogs.reduce((s, l) => s + Number(l.weight || l.part_unit?.part_master?.unit_weight || 0), 0);
  const distinctUnits = new Set(filteredLogs.map((l) => l.part_unit_id)).size;
  const byOp = {};
  filteredLogs.forEach((l) => {
    const name = l.operation?.name || "ไม่ระบุ";
    byOp[name] = byOp[name] || { name, count: 0, weight: 0 };
    byOp[name].count += 1;
    byOp[name].weight += Number(l.weight || l.part_unit?.part_master?.unit_weight || 0);
  });
  const chartData = Object.values(byOp);

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
        <StatCard label="จำนวนการสแกน" value={filteredLogs.length.toLocaleString()} icon="scan" />
        <StatCard label="ชิ้นงานที่มีความเคลื่อนไหว" value={distinctUnits.toLocaleString()} icon="box" />
        <StatCard label="น้ำหนักรวม (กก.)" value={fmtNum(totalWeight)} icon="weight" />
      </div>
      <Card title="แยกตามขั้นตอนการทำงาน">
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={CHART.muted} fontSize={12} />
              <YAxis stroke={CHART.muted} fontSize={12} />
              <Tooltip contentStyle={{ background: CHART.tooltipBg, border: `1px solid ${CHART.tooltipBorder}`, color: CHART.text, borderRadius: 10 }} />
              <Bar dataKey="count" name="จำนวนครั้งที่สแกน" fill={CHART.accent} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
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

  const byMachine = {};
  logs.forEach((l) => {
    const name = l.machine?.name || "ไม่ระบุ";
    byMachine[name] = byMachine[name] || { name, count: 0, weight: 0 };
    byMachine[name].count += 1;
    byMachine[name].weight += Number(l.weight || l.part_unit?.part_master?.unit_weight || 0);
  });
  const rows = Object.values(byMachine).sort((a, b) => b.count - a.count);

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Machines Summary</div>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      <Card title="ผลงานแยกตามเครื่องจักร">
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
            <thead><tr><th>เครื่องจักร</th><th>จำนวนครั้ง</th><th>น้ำหนักรวม (กก.)</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.count}</td><td>{fmtNum(r.weight)}</td></tr>)}</tbody>
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
  const [units, setUnits] = useState([]);
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    getAllUnitsFull().then(setUnits);
    listRows("projects", { order: "code" }).then(setProjects);
  }, []);
  // นับสถิติแยกตาม project_id ก่อน แล้วค่อย "left join" กับรายชื่อโปรเจคทั้งหมด
  // เพื่อให้โปรเจคที่ยังไม่เคย Release เลยก็ยังขึ้นแถวในตาราง (แถวละ 0)
  const byProjectId = {};
  units.forEach((u) => {
    const pid = u.part_master?.project_id;
    if (!pid) return;
    byProjectId[pid] = byProjectId[pid] || { total: 0, finished: 0, weight: 0 };
    byProjectId[pid].total += 1;
    if (u.status === "finished") byProjectId[pid].finished += 1;
    byProjectId[pid].weight += Number(u.weight || u.part_master?.unit_weight || 0);
  });
  const rows = projects.map((p) => ({
    id: p.id, code: p.code, name: p.name,
    ...(byProjectId[p.id] || { total: 0, finished: 0, weight: 0 }),
  }));
  return (
    <div>
      <div className="page-head"><div className="page-title">Projects Summary</div></div>
      <Card title="ความคืบหน้าแยกตามโปรเจค (สะสมทั้งหมด)">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>รหัส</th><th>โปรเจค</th><th>ปล่อยงาน (ชิ้น)</th><th>เสร็จแล้ว</th><th>% เสร็จ</th><th>น้ำหนักรวม (กก.)</th></tr></thead>
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
  const [units, setUnits] = useState([]);
  const [parts, setParts] = useState([]);
  useEffect(() => {
    getAllUnitsFull().then(setUnits);
    listRows("part_master", { order: "part_no" }).then(setParts);
  }, []);
  const byPartId = {};
  units.forEach((u) => {
    const pid = u.part_master_id;
    if (!pid) return;
    byPartId[pid] = byPartId[pid] || { total: 0, finished: 0, weight: 0 };
    byPartId[pid].total += 1;
    if (u.status === "finished") byPartId[pid].finished += 1;
    byPartId[pid].weight += Number(u.weight || u.part_master?.unit_weight || 0);
  });
  const rows = parts
    .map((p) => ({
      part: p.part_no, name: p.part_name,
      ...(byPartId[p.id] || { total: 0, finished: 0, weight: 0 }),
    }))
    .sort((a, b) => b.total - a.total);
  return (
    <div>
      <div className="page-head"><div className="page-title">Parts Summary</div></div>
      <Card title="สรุปแยกตามชนิด Part (สะสมทั้งหมด)">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Part No.</th><th>ชื่อ Part</th><th>ปล่อยงาน</th><th>เสร็จแล้ว</th><th>น้ำหนักรวม (กก.)</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.part}><td>{r.part}</td><td>{r.name}</td><td>{r.total}</td><td>{r.finished}</td><td>{fmtNum(r.weight)}</td></tr>
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
      {tab === "machines" && <SimpleCrud table="machines" fields={[
        { key: "code", label: "รหัสเครื่อง" }, { key: "name", label: "ชื่อเครื่องจักร" }, { key: "type", label: "ประเภทงาน" },
      ]} />}
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
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!form.name.trim()) { setErr("กรอกชื่อให้ครบ"); return; }
    setBusy(true); setErr("");
    try {
      await updateRow("employees", employee.id, {
        name: form.name.trim(),
        department_id: form.department_id || null,
        role: form.role,
        machine_id: form.machine_id || null,
        operation_id: form.operation_id || null,
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
    setRows(await listRows("employees", { order: "code" }));
    setDepartments(await listRows("departments", { order: "name" }));
    setMachines(await listRows("machines", { order: "code" }));
    setOperations(await listRows("operations", { order: "seq" }));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.code || !form.name || !form.password) { alert("กรอกรหัส/ชื่อ/รหัสผ่านให้ครบ"); return; }
    const password_hash = await hashPassword(form.password);
    await insertRow("employees", {
      code: form.code, name: form.name, department_id: form.department_id || null,
      role: form.role, password_hash,
      machine_id: form.machine_id || null, operation_id: form.operation_id || null,
    });
    setForm({ role: "operator" }); load();
  }
  async function toggle(r) { await updateRow("employees", r.id, { active: !r.active }); load(); }

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
  function logout() { clearSession(); setUser(null); }
  if (!user) return <Login onLogin={setUser} />;
  return <Shell user={user} onLogout={logout} />;
}
