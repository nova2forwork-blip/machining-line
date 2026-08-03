import { useState, useEffect, useRef, useCallback, forwardRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listRows, insertRow, insertRows, updateRow, deleteRow,
  findUnitByQr, getUnitHistory, getScanLogsBetween, getAllUnitsFull,
} from "./supabase.js";
import { ROLE_LABELS, getSession, setSession, clearSession, verifyLogin, hashPassword } from "./auth.js";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── Theme ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0d1520", panel: "#141d2b", panel2: "#1a2436", border: "#223047",
  text: "#e2e8f0", muted: "#8ca0b8", accent: "#3b82f6", success: "#10b981",
  warning: "#f59e0b", danger: "#ef4444",
};

// ─── Small UI atoms ─────────────────────────────────────────────────────────
const Btn = ({ children, variant = "default", style, ...rest }) => {
  const bg = { default: C.panel2, accent: C.accent, danger: C.danger, success: C.success }[variant];
  return (
    <button
      {...rest}
      style={{
        background: bg, color: "#fff", border: `1px solid ${variant === "default" ? C.border : bg}`,
        borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", ...style,
      }}
    >{children}</button>
  );
};
const Input = forwardRef((props, ref) => (
  <input {...props} ref={ref} style={{
    background: C.panel2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: "9px 12px", fontSize: 14, width: "100%", outline: "none", ...(props.style || {}),
  }} />
));
const Select = ({ options, ...props }) => (
  <select {...props} style={{
    background: C.panel2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: "9px 12px", fontSize: 14, width: "100%", outline: "none", ...(props.style || {}),
  }}>
    <option value="">— เลือก —</option>
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);
const Label = ({ children }) => (
  <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>{children}</div>
);
const Field = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}><Label>{label}</Label>{children}</div>
);
const Card = ({ title, right, children }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
    {(title || right) && (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: C.text }}>{title}</div>
        <div>{right}</div>
      </div>
    )}
    {children}
  </div>
);
const Badge = ({ children, color = C.accent }) => (
  <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>{children}</span>
);
const Th = ({ children, ...rest }) => <th {...rest} style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{children}</th>;
const Td = ({ children, ...rest }) => <td {...rest} style={{ padding: "8px 10px", fontSize: 13, color: C.text, borderBottom: `1px solid ${C.border}` }}>{children}</td>;

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
    <div style={{ display: "flex", gap: 8 }}>
      {PRESETS.map((p) => (
        <button key={p.value} onClick={() => onChange(p.value)} style={{
          background: value === p.value ? C.accent : C.panel2, color: "#fff",
          border: `1px solid ${value === p.value ? C.accent : C.border}`, borderRadius: 8,
          padding: "6px 12px", fontSize: 13, cursor: "pointer",
        }}>{p.label}</button>
      ))}
    </div>
  );
}

// ─── Routing helpers ─────────────────────────────────────────────────────────
// routing เก็บเป็น array ชื่อขั้นตอน เช่น ["ตัด","เจาะ","บาก","ประกอบ"]
function progressFor(routing, doneOpNames) {
  const done = new Set(doneOpNames);
  return (routing || []).map((op) => ({ op, done: done.has(op) }));
}
function nextOpFor(routing, doneOpNames) {
  const done = new Set(doneOpNames);
  return (routing || []).find((op) => !done.has(op)) || null;
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <form onSubmit={submit} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, width: 340 }}>
        <div style={{ fontSize: 20, fontWeight: 500, color: C.text, marginBottom: 2 }}>Machining Line System</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 22 }}>ระบบบันทึกการทำงานเครื่องจักร</div>
        <Field label="รหัสพนักงาน">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น admin" autoFocus />
        </Field>
        <Field label="รหัสผ่าน">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        {err && <div style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <Btn variant="accent" style={{ width: "100%" }} disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</Btn>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 14, lineHeight: 1.6 }}>
          ค่าเริ่มต้น: admin / admin123 — ระบบจะออกจากระบบอัตโนมัติเมื่อปิดแท็บนี้
        </div>
      </form>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// SHELL — sidebar + routing between pages
// ══════════════════════════════════════════════════════════════════════════
const MENU = [
  { group: "การผลิต", items: [
    { key: "release", label: "Release Production" },
    { key: "detail", label: "Production Detail" },
    { key: "finished", label: "Finished Part" },
  ]},
  { group: "รายงาน", items: [
    { key: "report", label: "Report" },
    { key: "machines", label: "Machines Summary" },
    { key: "projects", label: "Projects Summary" },
    { key: "parts", label: "Parts Summary" },
  ]},
  { group: "ระบบ", items: [
    { key: "setup", label: "Setup" },
  ]},
];

function Shell({ user, onLogout }) {
  const [tab, setTab] = useState("release");
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex" }}>
      <div style={{ width: 230, background: C.panel, borderRight: `1px solid ${C.border}`, padding: 18, flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: C.text }}>Machining Line</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>{user.name} · {ROLE_LABELS[user.role] || user.role}</div>
        {MENU.map((g) => (
          <div key={g.group} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, margin: "6px 0" }}>{g.group}</div>
            {g.items.map((it) => (
              <div key={it.key} onClick={() => setTab(it.key)} style={{
                padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13.5,
                color: tab === it.key ? "#fff" : C.text,
                background: tab === it.key ? C.accent : "transparent", marginBottom: 2,
              }}>{it.label}</div>
            ))}
          </div>
        ))}
        <div onClick={onLogout} style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, color: C.danger, marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          Exit Application
        </div>
      </div>
      <div style={{ flex: 1, padding: 24, maxWidth: 1100, overflowX: "auto" }}>
        {tab === "release" && <ReleasePage user={user} />}
        {tab === "detail" && <ScanPage user={user} />}
        {tab === "finished" && <FinishedPartPage />}
        {tab === "report" && <ReportPage />}
        {tab === "machines" && <MachinesSummaryPage />}
        {tab === "projects" && <ProjectsSummaryPage />}
        {tab === "parts" && <PartsSummaryPage />}
        {tab === "setup" && <SetupPage />}
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
  const printRef = useRef(null);

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

  function printLabels() {
    const w = window.open("", "_blank");
    const html = `<html><head><title>QR labels</title><style>
      body{font-family:sans-serif;margin:0;padding:12px}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      .lbl{border:1px solid #999;border-radius:6px;padding:8px;text-align:center;font-size:11px}
      .lbl svg{width:90px;height:90px}
    </style></head><body><div class="grid">${
      (lastUnits || []).map((u) => `<div class="lbl">${document.getElementById("qr-" + u.id)?.outerHTML || ""}<div>${u.qr_code}</div></div>`).join("")
    }</div></body></html>`;
    w.document.write(html); w.document.close(); w.print();
  }

  return (
    <div>
      <h2 style={{ color: C.text, fontWeight: 500, marginBottom: 16 }}>Release Production</h2>
      <Card title="ปล่อยงานใหม่">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
            Routing: {(selectedPart.routing || []).join(" → ") || "ยังไม่ได้กำหนด (ไปตั้งค่าที่ Setup)"} ·
            น้ำหนัก/ชิ้น: {fmtNum(selectedPart.unit_weight)} กก.
          </div>
        )}
        <Btn variant="accent" onClick={doRelease} disabled={busy || !partId}>
          {busy ? "กำลังสร้าง QR..." : `Release + สร้าง QR ${qty || 0} ใบ`}
        </Btn>
      </Card>

      {lastUnits && (
        <Card title={`QR ที่สร้างล่าสุด (${lastUnits.length} ใบ)`} right={<Btn onClick={printLabels}>พิมพ์ป้ายทั้งหมด</Btn>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px,1fr))", gap: 10 }}>
            {lastUnits.map((u) => (
              <div key={u.id} style={{ background: "#fff", borderRadius: 8, padding: 8, textAlign: "center" }}>
                <div id={`qr-${u.id}`}><QRCodeSVG value={u.qr_code} size={90} /></div>
                <div style={{ fontSize: 10, color: "#111", marginTop: 4, wordBreak: "break-all" }}>{u.qr_code}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="ประวัติการ Release ล่าสุด">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>วันที่</Th><Th>Part</Th><Th>จำนวน</Th><Th>หมายเหตุ</Th></tr></thead>
          <tbody>
            {recent.slice(0, 10).map((r) => (
              <tr key={r.id}>
                <Td>{fmtDT(r.release_date)}</Td>
                <Td>{parts.find((p) => p.id === r.part_master_id)?.part_no || "-"}</Td>
                <Td>{r.qty}</Td>
                <Td>{r.note || "-"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 2) PRODUCTION DETAIL — สแกน QR หน้าเครื่องจักร (มือถือ/สแกนเกาน์/พิมพ์เอง)
// ══════════════════════════════════════════════════════════════════════════
function ScanPage({ user }) {
  const [machines, setMachines] = useState([]);
  const [operations, setOperations] = useState([]);
  const [machineId, setMachineId] = useState("");
  const [opId, setOpId] = useState("");
  const [qrInput, setQrInput] = useState("");
  const [unit, setUnit] = useState(null);
  const [history, setHistory] = useState([]);
  const [weight, setWeight] = useState("");
  const [msg, setMsg] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const inputRef = useRef(null);
  const scannerRef = useRef(null);

  useEffect(() => {
    (async () => {
      setMachines(await listRows("machines", { order: "code", filters: { active: true } }));
      setOperations(await listRows("operations", { order: "seq" }));
    })();
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, [unit]);

  // กล้องมือถือ (ใช้ html5-qrcode) — เปิด/ปิดตามปุ่มผู้ใช้
  useEffect(() => {
    if (!cameraOn) return;
    let scanner;
    import("html5-qrcode").then(({ Html5QrcodeScanner }) => {
      scanner = new Html5QrcodeScanner("qr-cam", { fps: 10, qrbox: 220 }, false);
      scanner.render((decodedText) => {
        setQrInput(decodedText);
        lookup(decodedText);
        setCameraOn(false);
      }, () => {});
      scannerRef.current = scanner;
    });
    return () => { scannerRef.current?.clear?.().catch(() => {}); };
  }, [cameraOn]);

  async function lookup(code) {
    const c = (code ?? qrInput).trim();
    if (!c) return;
    setMsg("กำลังค้นหา...");
    const u = await findUnitByQr(c);
    if (!u) { setUnit(null); setHistory([]); setMsg("ไม่พบ QR นี้ในระบบ"); return; }
    const h = await getUnitHistory(u.id);
    setUnit(u); setHistory(h); setMsg("");
    const doneOps = h.map((x) => x.operation?.name).filter(Boolean);
    const next = nextOpFor(u.part_master?.routing, doneOps);
    const nextOpRow = operations.find((o) => o.name === next);
    if (nextOpRow) setOpId(nextOpRow.id);
    setWeight(u.weight || u.part_master?.unit_weight || "");
  }

  function onQrKeyDown(e) {
    if (e.key === "Enter") { e.preventDefault(); lookup(); }
  }

  async function confirmScan() {
    if (!unit || !machineId || !opId) { setMsg("กรุณาเลือกเครื่องจักรและขั้นตอนก่อน"); return; }
    const routing = unit.part_master?.routing || [];
    const doneOps = history.map((x) => x.operation?.name).filter(Boolean);
    const opName = operations.find((o) => o.id === opId)?.name;
    await insertRow("scan_logs", {
      part_unit_id: unit.id, machine_id: machineId, operation_id: opId,
      employee_id: user.id, weight: weight || null,
    });
    const newDone = new Set([...doneOps, opName]);
    const finished = routing.length > 0 && routing.every((r) => newDone.has(r));
    await updateRow("part_units", unit.id, { status: finished ? "finished" : "in_progress", weight: weight || unit.weight });
    setMsg(finished ? "บันทึกแล้ว — ชิ้นนี้ทำครบทุกขั้นตอนแล้ว ✓" : "บันทึกการสแกนเรียบร้อย");
    setQrInput(""); setUnit(null); setHistory([]);
    inputRef.current?.focus();
  }

  const doneOps = history.map((x) => x.operation?.name).filter(Boolean);

  return (
    <div>
      <h2 style={{ color: C.text, fontWeight: 500, marginBottom: 16 }}>Production Detail — สแกนหน้าเครื่องจักร</h2>
      <Card title="1) ตั้งค่าเครื่องจักร / ขั้นตอน">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="เครื่องจักร"><Select value={machineId} onChange={(e) => setMachineId(e.target.value)}
            options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} /></Field>
          <Field label="ขั้นตอนที่ทำ"><Select value={opId} onChange={(e) => setOpId(e.target.value)}
            options={operations.map((o) => ({ value: o.id, label: o.name }))} /></Field>
        </div>
      </Card>

      <Card title="2) สแกน QR" right={<Btn onClick={() => setCameraOn((v) => !v)}>{cameraOn ? "ปิดกล้อง" : "เปิดกล้องมือถือ"}</Btn>}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
          พิมพ์/ยิงด้วยเครื่องสแกนบาร์โค้ด แล้วกด Enter หรือเปิดกล้องมือถือเพื่อสแกนเองก็ได้
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Input ref={inputRef} value={qrInput} onChange={(e) => setQrInput(e.target.value)} onKeyDown={onQrKeyDown}
            placeholder="สแกนหรือพิมพ์รหัส QR แล้วกด Enter" autoFocus />
          <Btn variant="accent" onClick={() => lookup()}>ค้นหา</Btn>
        </div>
        {cameraOn && <div id="qr-cam" style={{ marginBottom: 10 }} />}
        {msg && <div style={{ fontSize: 13, color: unit ? C.success : C.warning }}>{msg}</div>}
      </Card>

      {unit && (
        <Card title={`ชิ้นงาน: ${unit.qr_code}`}>
          <div style={{ fontSize: 13, color: C.text, marginBottom: 8 }}>
            {unit.part_master?.part_no} — {unit.part_master?.part_name}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {progressFor(unit.part_master?.routing, doneOps).map((s) => (
              <Badge key={s.op} color={s.done ? C.success : C.muted}>{s.op}{s.done ? " ✓" : ""}</Badge>
            ))}
          </div>
          <Field label="น้ำหนัก (กก.)"><Input type="number" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Btn variant="success" onClick={confirmScan}>บันทึกการสแกน</Btn>

          {history.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Label>ประวัติชิ้นนี้</Label>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><Th>เวลา</Th><Th>เครื่องจักร</Th><Th>ขั้นตอน</Th><Th>พนักงาน</Th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}><Td>{fmtDT(h.scanned_at)}</Td><Td>{h.machine?.name}</Td><Td>{h.operation?.name}</Td><Td>{h.employee?.name}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
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
      <h2 style={{ color: C.text, fontWeight: 500, marginBottom: 16 }}>Finished Part</h2>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Card title="ชิ้นที่เสร็จทั้งหมด"><div style={{ fontSize: 26, color: C.text }}>{units.length.toLocaleString()}</div></Card>
        <Card title="น้ำหนักรวม (กก.)"><div style={{ fontSize: 26, color: C.text }}>{fmtNum(totalWeight)}</div></Card>
      </div>
      <Card title="รายการชิ้นงานที่เสร็จสมบูรณ์">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>QR</Th><Th>Part</Th><Th>โปรเจค</Th><Th>น้ำหนัก</Th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <Td>{u.qr_code}</Td>
                <Td>{u.part_master?.part_no} — {u.part_master?.part_name}</Td>
                <Td>{u.part_master?.projects?.name || "-"}</Td>
                <Td>{fmtNum(u.weight || u.part_master?.unit_weight)}</Td>
              </tr>
            ))}
            {units.length === 0 && <tr><Td colSpan={4}>ยังไม่มีชิ้นงานที่เสร็จสมบูรณ์</Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 4) REPORT — สรุปรวม แยกตามขั้นตอน ตามช่วงเวลา
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: C.text, fontWeight: 500 }}>Report</h2>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Card title="จำนวนการสแกน"><div style={{ fontSize: 26, color: C.text }}>{logs.length.toLocaleString()}</div></Card>
        <Card title="ชิ้นงานที่มีความเคลื่อนไหว"><div style={{ fontSize: 26, color: C.text }}>{distinctUnits.toLocaleString()}</div></Card>
        <Card title="น้ำหนักรวม (กก.)"><div style={{ fontSize: 26, color: C.text }}>{fmtNum(totalWeight)}</div></Card>
      </div>
      <Card title="แยกตามขั้นตอนการทำงาน (ตัด / เจาะ / บาก ฯลฯ)">
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={C.muted} fontSize={12} />
              <YAxis stroke={C.muted} fontSize={12} />
              <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }} />
              <Bar dataKey="count" name="จำนวนครั้งที่สแกน" fill={C.accent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 5) MACHINES SUMMARY
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: C.text, fontWeight: 500 }}>Machines Summary</h2>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      <Card title="ผลงานแยกตามเครื่องจักร">
        <div style={{ height: 240, marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={C.muted} fontSize={12} />
              <YAxis stroke={C.muted} fontSize={12} />
              <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }} />
              <Bar dataKey="count" name="จำนวนชิ้น" fill={C.success} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>เครื่องจักร</Th><Th>จำนวนครั้ง</Th><Th>น้ำหนักรวม (กก.)</Th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.name}><Td>{r.name}</Td><Td>{r.count}</Td><Td>{fmtNum(r.weight)}</Td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 6) PROJECTS SUMMARY — ความคืบหน้าทั้งหมด (all-time)
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
      <h2 style={{ color: C.text, fontWeight: 500, marginBottom: 16 }}>Projects Summary</h2>
      <Card title="ความคืบหน้าแยกตามโปรเจค (สะสมทั้งหมด)">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>โปรเจค</Th><Th>ปล่อยงาน (ชิ้น)</Th><Th>เสร็จแล้ว</Th><Th>% เสร็จ</Th><Th>น้ำหนักรวม (กก.)</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <Td>{r.name}</Td><Td>{r.total}</Td><Td>{r.finished}</Td>
                <Td>{r.total ? Math.round((r.finished / r.total) * 100) : 0}%</Td>
                <Td>{fmtNum(r.weight)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 7) PARTS SUMMARY — สรุปแยกชนิด part (all-time)
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
      <h2 style={{ color: C.text, fontWeight: 500, marginBottom: 16 }}>Parts Summary</h2>
      <Card title="สรุปแยกตามชนิด Part (สะสมทั้งหมด)">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Part No.</Th><Th>ชื่อ Part</Th><Th>ปล่อยงาน</Th><Th>เสร็จแล้ว</Th><Th>น้ำหนักรวม (กก.)</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.part}><Td>{r.part}</Td><Td>{r.name}</Td><Td>{r.total}</Td><Td>{r.finished}</Td><Td>{fmtNum(r.weight)}</Td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 8) SETUP — master data (departments / employees / machines / operations / projects / part master)
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
      <h2 style={{ color: C.text, fontWeight: 500, marginBottom: 16 }}>Setup</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: tab === t.key ? C.accent : C.panel2, color: "#fff",
            border: `1px solid ${tab === t.key ? C.accent : C.border}`, borderRadius: 8,
            padding: "7px 14px", fontSize: 13, cursor: "pointer",
          }}>{t.label}</button>
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

// generic CRUD สำหรับตารางง่ายๆ (machines / operations / projects / departments)
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
          <div key={f.key} style={{ minWidth: 160 }}>
            <Label>{f.label}</Label>
            <Input type={f.type || "text"} value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          </div>
        ))}
        <div style={{ alignSelf: "flex-end" }}><Btn variant="accent" onClick={add}>เพิ่ม</Btn></div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{fields.map((f) => <Th key={f.key}>{f.label}</Th>)}<Th></Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {fields.map((f) => <Td key={f.key}>{r[f.key]}</Td>)}
              <Td><span onClick={() => remove(r.id)} style={{ color: C.danger, cursor: "pointer" }}>ลบ</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
        <Field label="รหัสพนักงาน"><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
        <Field label="ชื่อ"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="รหัสผ่านเริ่มต้น"><Input value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="แผนก"><Select value={form.department_id || ""} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
          options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="สิทธิ์การใช้งาน"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
          options={[{ value: "admin", label: "Admin" }, { value: "supervisor", label: "หัวหน้างาน" }, { value: "operator", label: "พนักงานหน้าเครื่อง" }]} /></Field>
      </div>
      <Btn variant="accent" onClick={add}>เพิ่มพนักงาน</Btn>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead><tr><Th>รหัส</Th><Th>ชื่อ</Th><Th>แผนก</Th><Th>สิทธิ์</Th><Th>สถานะ</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.code}</Td><Td>{r.name}</Td>
              <Td>{departments.find((d) => d.id === r.department_id)?.name || "-"}</Td>
              <Td>{ROLE_LABELS[r.role] || r.role}</Td>
              <Td><span onClick={() => toggle(r)} style={{ cursor: "pointer", color: r.active ? C.success : C.muted }}>{r.active ? "ใช้งาน" : "ปิดใช้งาน"}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 10 }}>
        <Field label="โปรเจค"><Select value={form.project_id || ""} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
          options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} /></Field>
        <Field label="รหัส Part"><Input value={form.part_no || ""} onChange={(e) => setForm({ ...form, part_no: e.target.value })} /></Field>
        <Field label="ชื่อ Part"><Input value={form.part_name || ""} onChange={(e) => setForm({ ...form, part_name: e.target.value })} /></Field>
        <Field label="วัสดุ"><Input value={form.material || ""} onChange={(e) => setForm({ ...form, material: e.target.value })} /></Field>
        <Field label="น้ำหนักโดยประมาณ/ชิ้น (กก.)"><Input type="number" step="0.01" value={form.unit_weight || ""} onChange={(e) => setForm({ ...form, unit_weight: e.target.value })} /></Field>
      </div>
      <Label>Routing — เลือกขั้นตอนที่ part นี้ต้องผ่าน</Label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {operations.map((o) => {
          const active = (form.routing || []).includes(o.name);
          return (
            <span key={o.id} onClick={() => toggleOp(o.name)} style={{
              cursor: "pointer", padding: "6px 12px", borderRadius: 8, fontSize: 13,
              background: active ? C.accent : C.panel2, color: "#fff", border: `1px solid ${active ? C.accent : C.border}`,
            }}>{o.name}{active ? ` (${form.routing.indexOf(o.name) + 1})` : ""}</span>
          );
        })}
      </div>
      <Btn variant="accent" onClick={add}>เพิ่ม Part</Btn>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead><tr><Th>Part No.</Th><Th>ชื่อ</Th><Th>Routing</Th><Th></Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.part_no}</Td><Td>{r.part_name}</Td><Td>{(r.routing || []).join(" → ")}</Td>
              <Td><span onClick={() => remove(r.id)} style={{ color: C.danger, cursor: "pointer" }}>ลบ</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
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
