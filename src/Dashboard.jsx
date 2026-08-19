import { useState, useEffect, useRef, useCallback } from "react";
import "./dashboard.css";
import { getScanLogsBetween, supabase } from "./supabase.js";
import { machineOpMatrix } from "./metrics.js";

// ─── helpers ──────────────────────────────────────────────────────────────
const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const fmtKg = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const pad = (n) => String(n).padStart(2, "0");
function fmtHrs(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)} ชม.` : `${m} น.`;
}
function fmtClock(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function fmtThaiDate(d) {
  return d.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function timeOf(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// ช่วง "วันนี้" ตามเวลาไทย (Asia/Bangkok, UTC+7) → คืน ISO from/to
function bangkokTodayRange() {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 3600 * 1000);
  const startUtcMs = Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), 0, 0, 0) - 7 * 3600 * 1000;
  return { from: new Date(startUtcMs).toISOString(), to: new Date().toISOString() };
}

// ─── ตัวเลขวิ่ง count-up (ease-out) ─────────────────────────────────────────
function CountNumber({ value, format = fmtInt, className = "" }) {
  const [disp, setDisp] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current, to = Number(value) || 0;
    if (from === to) { setDisp(to); return; }
    const dur = 850; let start = 0;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisp(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);
  return <span className={`dash-num ${className}`}>{format(disp)}</span>;
}

const keyOf = (l) => `${l.part_unit_id || "?"}|${l.scanned_at}|${l.operation?.name || "?"}|${l.quantity}`;

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [booted, setBooted] = useState(false);
  const [now, setNow] = useState(new Date());
  const [fresh, setFresh] = useState(new Set());       // key ของสแกนใหม่ (ไฮไลต์ฟีด)
  const [hit, setHit] = useState(new Set());           // ชื่อเครื่องที่เพิ่งมีงานเข้า (แฟลชการ์ด)
  const seenRef = useRef(null);                        // key ที่เคยเห็นแล้ว (กันแฟลชซ้ำ)
  const hitTimer = useRef(0);

  const fetchNow = useCallback(async () => {
    const { from, to } = bangkokTodayRange();
    const data = await getScanLogsBetween(from, to);
    const rows = Array.isArray(data) ? data : [];
    setLogs(rows);
    setBooted(true);

    // ตรวจสแกนใหม่ (เทียบกับรอบก่อน) — รอบแรกถือว่า "เห็นแล้วทั้งหมด" ไม่แฟลช
    const keys = new Set(rows.map(keyOf));
    if (seenRef.current) {
      const freshKeys = new Set();
      const hitMachines = new Set();
      for (const l of rows) {
        const k = keyOf(l);
        if (!seenRef.current.has(k)) { freshKeys.add(k); if (l.machine?.name) hitMachines.add(l.machine.name); }
      }
      if (freshKeys.size) {
        setFresh(freshKeys);
        setHit(hitMachines);
        clearTimeout(hitTimer.current);
        hitTimer.current = setTimeout(() => { setHit(new Set()); setFresh(new Set()); }, 1600);
      }
    }
    seenRef.current = keys;
  }, []);

  // โหลดรอบแรก + โพลทุก 5 วิ (near real-time) + นาฬิกาเดินทุก 1 วิ
  useEffect(() => {
    fetchNow();
    const poll = setInterval(fetchNow, 5000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); clearTimeout(hitTimer.current); };
  }, [fetchNow]);

  // เรียลไทม์: มีงานหน้าเครื่องเข้ามาปุ๊บ ดึงใหม่ทันที (ถ้าเปิด replication ไว้)
  useEffect(() => {
    let ch;
    try {
      ch = supabase
        .channel("dash-machine-records")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "machine_records" }, () => fetchNow())
        .subscribe();
    } catch { /* ถ้าไม่รองรับ realtime ก็ยังมี poll 5 วิ */ }
    return () => { try { ch && supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, [fetchNow]);

  // ── สรุปตัวเลข ────────────────────────────────────────────────────────
  const totalPieces = logs.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const totalKg = logs.reduce((s, l) => s + (Number(l.weight) || 0), 0);
  const totalSec = logs.reduce((s, l) => s + (Number(l.process_seconds) || 0), 0);
  const scanCount = logs.length;

  const matrix = machineOpMatrix(logs);
  const machines = matrix.machines.map((m) => {
    const op = Object.entries(m.ops).sort((a, b) => b[1].count - a[1].count)[0];
    return { name: m.name, op: op ? op[0] : "", count: m.total.count, weight: m.total.weight, seconds: m.total.seconds };
  });
  const maxKg = Math.max(1, ...machines.map((m) => m.weight));
  const feed = logs.slice(0, 9);

  if (!booted) {
    return (
      <div className="dash-boot">
        <div className="spin" />
        <div style={{ fontSize: "2vh" }}>กำลังเชื่อมต่อสายการผลิต…</div>
      </div>
    );
  }

  return (
    <div className="dash">
      {/* ── header ── */}
      <div className="dash-head">
        <div className="dash-title">
          MACHINING LINE
          <span className="sub">Live Production Monitor</span>
        </div>
        <div className="dash-headright">
          <div className="dash-live"><span className="dot" /> LIVE</div>
          <div style={{ textAlign: "right" }}>
            <div className="dash-clock dash-num">{fmtClock(now)}</div>
            <div className="dash-date">{fmtThaiDate(now)}</div>
          </div>
        </div>
      </div>

      {/* ── KPI hero row ── */}
      <div className="dash-kpi-row">
        <Kpi label="ชิ้นที่ผลิตวันนี้" value={totalPieces} format={fmtInt} unit="ชิ้น" flash={hit.size > 0} />
        <Kpi label="น้ำหนักรวมวันนี้" value={totalKg} format={fmtKg} unit="กก." flash={hit.size > 0} />
        <Kpi label="เวลาเดินเครื่องรวม" value={totalSec} format={fmtHrs} unit="" flash={hit.size > 0} />
        <Kpi label="จำนวนครั้งที่บันทึก" value={scanCount} format={fmtInt} unit="ครั้ง" flash={hit.size > 0} />
      </div>

      {/* ── main: machine cards + chart ── */}
      <div className="dash-main">
        <div className="dash-panel">
          <div className="dash-panel-h"><span>เครื่องจักร · วันนี้</span><span style={{ color: "var(--dash-green)" }}>{machines.length} เครื่อง</span></div>
          {machines.length === 0 ? (
            <div className="dash-empty">ยังไม่มีงานเข้าวันนี้ — รอเครื่องเริ่มสแกน…</div>
          ) : (
            <div className="dash-machines">
              {machines.map((m) => (
                <div key={m.name} className={`dash-mach ${hit.has(m.name) ? "hit" : ""}`}>
                  <div className="name">{m.name}{m.op ? <span className="op">{m.op}</span> : null}</div>
                  <div className="big"><CountNumber value={m.weight} format={fmtKg} /><span className="unit">กก.</span></div>
                  <div className="meta"><CountNumber value={m.count} format={fmtInt} /> ชิ้น · {fmtHrs(m.seconds)}</div>
                  <div className="dash-bar-track"><div className="dash-bar-fill" style={{ width: `${Math.max(4, (m.weight / maxKg) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dash-panel dash-chart">
          <div className="dash-panel-h" style={{ marginBottom: "0.4vh" }}>น้ำหนักที่ผลิต · แยกตามเครื่อง (กก.)</div>
          {machines.length === 0 ? (
            <div className="dash-empty">—</div>
          ) : (
            machines.slice(0, 6).map((m) => (
              <div key={m.name} className="dash-chart-row">
                <div className="cname">{m.name}</div>
                <div className="dash-chart-track"><div className="dash-chart-bar" style={{ width: `${Math.max(3, (m.weight / maxKg) * 100)}%` }} /></div>
                <div className="cval dash-num">{fmtKg(m.weight)} กก.</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── live feed ── */}
      <div className="dash-feed dash-panel">
        <div className="dash-panel-h"><span>◉ ฟีดการผลิตสด</span></div>
        {feed.length === 0 ? (
          <div className="dash-empty">รอการสแกนจากหน้าเครื่อง…</div>
        ) : (
          <div className="dash-feed-list">
            {feed.map((l) => {
              const finished = String(l.status).toLowerCase() === "finished";
              return (
                <div key={keyOf(l)} className={`dash-feed-item ${fresh.has(keyOf(l)) ? "fresh" : ""}`}>
                  <div className="part">{l.part_unit?.part_master?.part_no || "—"}</div>
                  <div className="qty">+{fmtInt(l.quantity)}</div>
                  <div className="line2">
                    <span className="chip">{l.machine?.name || "—"}</span>
                    {l.operation?.name ? <span>{l.operation.name}</span> : null}
                    <span className={finished ? "st-fin" : "st-inp"}>{finished ? "Finished" : "In Process"}</span>
                  </div>
                  <div className="time dash-num">{timeOf(l.scanned_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, format, unit, flash }) {
  return (
    <div className={`dash-kpi ${flash ? "flash" : ""}`}>
      <div className="lbl">{label}</div>
      <div className="val"><CountNumber value={value} format={format} />{unit ? <span className="unit">{unit}</span> : null}</div>
    </div>
  );
}
