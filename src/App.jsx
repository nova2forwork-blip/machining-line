import { useState, useEffect, useRef, useCallback, forwardRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listRows, insertRow, insertRows, updateRow, deleteRow,
  findUnitByQr, getUnitHistory, getScanLogsBetween, getAllUnitsFull,
} from "./supabase.js";
import { ROLE_LABELS, getSession, setSession, clearSession, verifyLogin, hashPassword } from "./auth.js";
import { printLabels, LABEL_PRESETS } from "./labels.js";
import Icon from "./icons.jsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── Chart theme (matches CSS custom properties — recharts needs literal values) ──
const CHART = {
  grid: "#2c3540", muted: "#8b93a1", tooltipBg: "#212832", tooltipBorder: "#2c3540",
  text: "#edf1f4", accent: "#d98c3d", success: "#48b083",
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
  accent: { c: "var(--accent-hi)", bg: "rgba(217,140,61,.14)", bd: "rgba(217,140,61,.4)" },
  success: { c: "var(--success-hi)", bg: "rgba(72,176,131,.14)", bd: "rgba(72,176,131,.4)" },
  steel: { c: "var(--steel-hi)", bg: "rgba(91,143,186,.14)", bd: "rgba(91,143,186,.4)" },
  warning: { c: "var(--warning)", bg: "rgba(220,176,35,.14)", bd: "rgba(220,176,35,.4)" },
  danger: { c: "var(--danger-hi)", bg: "rgba(221,91,79,.14)", bd: "rgba(221,91,79,.4)" },
  muted: { c: "var(--muted)", bg: "rgba(139,147,161,.1)", bd: "rgba(139,147,161,.3)" },
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
  const currentLabel = MENU.flatMap((g) => g.items).find((i) => i.key === tab)?.label || "";

  function go(key) { setTab(key); setDrawerOpen(false); }

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
        <div className="topbar-title">{currentLabel}</div>
        <div className="icon-btn" onClick={onLogout}><Icon name="logout" size={18} style={{ stroke: "var(--danger)" }} /></div>
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
          {tab === "release" && <ReleasePage user={user} />}
          {tab === "detail" && <ScanPage user={user} />}
          {tab === "finished" && <FinishedPartPage />}
          {tab === "labels" && <QrLabelsPage />}
          {tab === "report" && <ReportPage />}
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
        <div className="bottom-nav-scan" onClick={() => go("detail")}>
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
function ReleasePage({ user }) {
  const [projects, setProjects] = useState([]);
  const [parts, setParts] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState(10);
  const [note, setNote] = useState("");
  const [lastUnits, setLastUnits] = useState(null);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);

  const [labelPreset, setLabelPreset] = useState("20x20");
  const [customW, setCustomW] = useState(20);
  const [customH, setCustomH] = useState(20);
  const [showCode, setShowCode] = useState(false);
  const [printMode, setPrintMode] = useState("sheet");

  const load = useCallback(async () => {
    setProjects(await listRows("projects", { order: "code" }));
    setParts(await listRows("part_master", { order: "part_no" }));
    setRecent(await listRows("releases", { order: "release_date", ascending: false }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const partsInProject = parts.filter((p) => !projectId || p.project_id === projectId);
  const selectedPart = parts.find((p) => p.id === partId);

  async function doRelease() {
    if (!partId || !qty) return;
    setBusy(true);
    try {
      const release = await insertRow("releases", {
        part_master_id: partId, qty: Number(qty), released_by: user.id, note,
      });
      const suffix = release.id.slice(0, 6).toUpperCase();
      const units = Array.from({ length: Number(qty) }, (_, i) => ({
        release_id: release.id,
        part_master_id: partId,
        unit_no: i + 1,
        qr_code: `${selectedPart.part_no}-${suffix}-${String(i + 1).padStart(4, "0")}`,
        status: "released",
      }));
      const created = await insertRows("part_units", units);
      setLastUnits(created);
      setNote(""); setQty(10);
      await load();
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
    setBusy(false);
  }

  function currentSize() {
    if (labelPreset === "custom") return { w: Number(customW) || 20, h: Number(customH) || 20 };
    const p = LABEL_PRESETS.find((x) => x.value === labelPreset);
    return { w: p.w, h: p.h };
  }
  function doPrint() {
    const { w, h } = currentSize();
    printLabels(lastUnits, { widthMm: w, heightMm: h, showCode, mode: printMode, title: `QR-${selectedPart?.part_no || ""}` });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Release Production</div>
          <div className="page-sub">ปล่อยงานใหม่และสร้าง QR ต่อชิ้นสำหรับพิมพ์ป้าย</div>
        </div>
      </div>

      <Card title="ปล่อยงานใหม่">
        <div className="grid-2">
          <Field label="โปรเจค">
            <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPartId(""); }}
              options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
          </Field>
          <Field label="Part">
            <Select value={partId} onChange={(e) => setPartId(e.target.value)}
              options={partsInProject.map((p) => ({ value: p.id, label: `${p.part_no} — ${p.part_name}` }))} />
          </Field>
          <Field label="จำนวน (ชิ้น)">
            <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="หมายเหตุ">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่บังคับ" />
          </Field>
        </div>
        {selectedPart && (
          <div style={{ marginBottom: 14 }}>
            <RoutingRail routing={selectedPart.routing} doneOps={[]} />
            <div style={{ fontSize: 12, color: "var(--muted)" }}>น้ำหนักโดยประมาณ/ชิ้น: {fmtNum(selectedPart.unit_weight)} กก.</div>
          </div>
        )}
        <Btn variant="accent" size="lg" onClick={doRelease} disabled={busy || !partId}>
          <Icon name="box" size={16} />{busy ? "กำลังสร้าง QR..." : `Release + สร้าง QR ${qty || 0} ใบ`}
        </Btn>
      </Card>

      {lastUnits && (
        <Card title={`QR ที่สร้างล่าสุด (${lastUnits.length} ใบ)`}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
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
            <Field label="รูปแบบการพิมพ์">
              <div className="chip-row">
                <span className={`chip ${printMode === "sheet" ? "active" : ""}`} onClick={() => setPrintMode("sheet")}>แผ่น A4 (ตาราง)</span>
                <span className={`chip ${printMode === "roll" ? "active" : ""}`} onClick={() => setPrintMode("roll")}>ม้วนป้าย (ทีละดวง)</span>
              </div>
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", paddingBottom: 10 }}>
              <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> แสดงรหัสใต้ QR
            </label>
            <Btn variant="accent" onClick={doPrint} style={{ marginBottom: 2 }}><Icon name="printer" size={15} />พิมพ์ป้ายทั้งหมด</Btn>
          </div>
          <div className="grid-auto">
            {lastUnits.map((u) => (
              <div key={u.id} className="label-preview">
                <QRCodeSVG id={`pq-${u.id}`} value={u.qr_code} size={96} />
                <div className="code">{u.qr_code}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="ประวัติการ Release ล่าสุด">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>วันที่</th><th>Part</th><th>จำนวน</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              {recent.slice(0, 10).map((r) => (
                <tr key={r.id}>
                  <td>{fmtDT(r.release_date)}</td>
                  <td>{parts.find((p) => p.id === r.part_master_id)?.part_no || "-"}</td>
                  <td>{r.qty}</td>
                  <td>{r.note || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 2) SCAN — station setup, then a dedicated full-screen scan flow
// ══════════════════════════════════════════════════════════════════════════
function ScanPage({ user }) {
  const [machines, setMachines] = useState([]);
  const [operations, setOperations] = useState([]);
  const [machineId, setMachineId] = useState("");
  const [opId, setOpId] = useState("");
  const [stationOpen, setStationOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setMachines(await listRows("machines", { order: "code", filters: { active: true } }));
      setOperations(await listRows("operations", { order: "seq" }));
    })();
  }, []);

  const machine = machines.find((m) => m.id === machineId);
  const operation = operations.find((o) => o.id === opId);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">สแกนหน้าเครื่องจักร</div>
          <div className="page-sub">เลือกเครื่องจักรและขั้นตอนที่ทำ แล้วเริ่มสแกนแบบเต็มหน้าจอ</div>
        </div>
      </div>

      <Card title="ตั้งค่าสถานีสแกน">
        <div className="grid-2">
          <Field label="เครื่องจักร">
            <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}
              options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} />
          </Field>
          <Field label="ขั้นตอนที่ทำ">
            <Select value={opId} onChange={(e) => setOpId(e.target.value)}
              options={operations.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
        </div>
        <Btn variant="accent" size="lg" className="btn-block" disabled={!machineId || !opId} onClick={() => setStationOpen(true)}>
          <Icon name="scan" size={18} /> เริ่มสแกน
        </Btn>
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
          user={user} machine={machine} operation={operation}
          onExit={() => setStationOpen(false)}
        />
      )}
    </div>
  );
}

function ScanStation({ user, machine, operation, onExit }) {
  const [qrInput, setQrInput] = useState("");
  const [unit, setUnit] = useState(null);
  const [history, setHistory] = useState([]);
  const [weight, setWeight] = useState("");
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState("muted");
  const [cameraOn, setCameraOn] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const inputRef = useRef(null);
  const scannerRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [unit]);

  useEffect(() => {
    if (!cameraOn) return;
    let scanner;
    import("html5-qrcode").then(({ Html5QrcodeScanner }) => {
      scanner = new Html5QrcodeScanner("qr-cam-region", { fps: 10, qrbox: 220 }, false);
      scanner.render((decodedText) => {
        setQrInput(decodedText);
        lookup(decodedText);
        setCameraOn(false);
      }, () => {});
      scannerRef.current = scanner;
    });
    return () => { scannerRef.current?.clear?.().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

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
    setWeight(u.weight || u.part_master?.unit_weight || "");
    if (next && operation && next !== operation.name) {
      setMsg(`ขั้นตอนถัดไปของชิ้นนี้คือ "${next}" ไม่ใช่ "${operation.name}" — ตรวจสอบก่อนบันทึก`);
      setMsgTone("warning");
    }
  }

  function onQrKeyDown(e) { if (e.key === "Enter") { e.preventDefault(); lookup(); } }

  async function confirmScan() {
    if (!unit || !machine || !operation) return;
    const routing = unit.part_master?.routing || [];
    const doneOps = history.map((x) => x.operation?.name).filter(Boolean);
    await insertRow("scan_logs", {
      part_unit_id: unit.id, machine_id: machine.id, operation_id: operation.id,
      employee_id: user.id, weight: weight || null,
    });
    const newDone = new Set([...doneOps, operation.name]);
    const finished = routing.length > 0 && routing.every((r) => newDone.has(r));
    await updateRow("part_units", unit.id, { status: finished ? "finished" : "in_progress", weight: weight || unit.weight });
    setMsg(finished ? "บันทึกแล้ว — ชิ้นนี้ทำครบทุกขั้นตอนแล้ว ✓" : "บันทึกการสแกนเรียบร้อย");
    setMsgTone("success");
    setSessionCount((c) => c + 1);
    setQrInput(""); setUnit(null); setHistory([]);
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
          <div id="qr-cam-region" style={{ width: "min(92vw,420px)" }} />
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
              <Field label="น้ำหนัก (กก.)">
                <Input type="number" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </Field>
              <Btn variant="success" size="lg" className="btn-block" onClick={confirmScan}>
                <Icon name="check" size={17} /> ยืนยันการสแกน
              </Btn>
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
              <thead><tr><th>QR</th><th>Part</th><th>โปรเจค</th><th>น้ำหนัก</th></tr></thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{u.qr_code}</td>
                    <td>{u.part_master?.part_no} — {u.part_master?.part_name}</td>
                    <td>{u.part_master?.projects?.name || "-"}</td>
                    <td>{fmtNum(u.weight || u.part_master?.unit_weight)}</td>
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
function QrLabelsPage() {
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
// 5) REPORT
// ══════════════════════════════════════════════════════════════════════════
function ReportPage() {
  const [preset, setPreset] = useState("week");
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    const { from, to } = rangeFor(preset);
    getScanLogsBetween(from, to).then(setLogs);
  }, [preset]);

  const totalWeight = logs.reduce((s, l) => s + Number(l.weight || l.part_unit?.part_master?.unit_weight || 0), 0);
  const distinctUnits = new Set(logs.map((l) => l.part_unit_id)).size;
  const byOp = {};
  logs.forEach((l) => {
    const name = l.operation?.name || "ไม่ระบุ";
    byOp[name] = byOp[name] || { name, count: 0, weight: 0 };
    byOp[name].count += 1;
    byOp[name].weight += Number(l.weight || l.part_unit?.part_master?.unit_weight || 0);
  });
  const chartData = Object.values(byOp);

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Report</div>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      <div className="stat-row">
        <StatCard label="จำนวนการสแกน" value={logs.length.toLocaleString()} icon="scan" />
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
  useEffect(() => { getAllUnitsFull().then(setUnits); }, []);
  const byProject = {};
  units.forEach((u) => {
    const name = u.part_master?.projects?.name || "ไม่ระบุโปรเจค";
    byProject[name] = byProject[name] || { name, total: 0, finished: 0, weight: 0 };
    byProject[name].total += 1;
    if (u.status === "finished") byProject[name].finished += 1;
    byProject[name].weight += Number(u.weight || u.part_master?.unit_weight || 0);
  });
  const rows = Object.values(byProject);
  return (
    <div>
      <div className="page-head"><div className="page-title">Projects Summary</div></div>
      <Card title="ความคืบหน้าแยกตามโปรเจค (สะสมทั้งหมด)">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>โปรเจค</th><th>ปล่อยงาน (ชิ้น)</th><th>เสร็จแล้ว</th><th>% เสร็จ</th><th>น้ำหนักรวม (กก.)</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.total ? Math.round((r.finished / r.total) * 100) : 0;
                return (
                  <tr key={r.name}>
                    <td>{r.name}</td><td>{r.total}</td><td>{r.finished}</td>
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
  useEffect(() => { getAllUnitsFull().then(setUnits); }, []);
  const byPart = {};
  units.forEach((u) => {
    const key = u.part_master?.part_no || "ไม่ระบุ";
    byPart[key] = byPart[key] || { part: key, name: u.part_master?.part_name, total: 0, finished: 0, weight: 0 };
    byPart[key].total += 1;
    if (u.status === "finished") byPart[key].finished += 1;
    byPart[key].weight += Number(u.weight || u.part_master?.unit_weight || 0);
  });
  const rows = Object.values(byPart).sort((a, b) => b.total - a.total);
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
      {tab === "projects" && <SimpleCrud table="projects" fields={[
        { key: "code", label: "รหัสโปรเจค" }, { key: "name", label: "ชื่อโปรเจค" }, { key: "customer", label: "ลูกค้า" },
      ]} />}
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

function EmployeeCrud() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ role: "operator" });
  const load = useCallback(async () => {
    setRows(await listRows("employees", { order: "code" }));
    setDepartments(await listRows("departments", { order: "name" }));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.code || !form.name || !form.password) { alert("กรอกรหัส/ชื่อ/รหัสผ่านให้ครบ"); return; }
    const password_hash = await hashPassword(form.password);
    await insertRow("employees", {
      code: form.code, name: form.name, department_id: form.department_id || null,
      role: form.role, password_hash,
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
        <Field label="แผนก"><Select value={form.department_id || ""} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
          options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="สิทธิ์การใช้งาน"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
          options={[{ value: "admin", label: "Admin" }, { value: "supervisor", label: "หัวหน้างาน" }, { value: "operator", label: "พนักงานหน้าเครื่อง" }]} /></Field>
      </div>
      <Btn variant="accent" onClick={add}>เพิ่มพนักงาน</Btn>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>สิทธิ์</th><th>สถานะ</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td><td>{r.name}</td>
                <td>{departments.find((d) => d.id === r.department_id)?.name || "-"}</td>
                <td>{ROLE_LABELS[r.role] || r.role}</td>
                <td>
                  <span onClick={() => toggle(r)} style={{ cursor: "pointer" }}>
                    <Badge tone={r.active ? "success" : "muted"}>{r.active ? "ใช้งาน" : "ปิดใช้งาน"}</Badge>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      material: form.material, unit_weight: Number(form.unit_weight || 0), routing: form.routing || [],
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
          <thead><tr><th>Part No.</th><th>ชื่อ</th><th>Routing</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.part_no}</td><td>{r.part_name}</td><td>{(r.routing || []).join(" → ")}</td>
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
