import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "./dashboard.css";
import { getScanLogsBetween, supabase } from "./supabase.js";
import { machineOpMatrix } from "./metrics.js";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { useUpdateReady, applyUpdate } from "./updatePrompt.js";

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
  const hourlyRef = useRef([]);                        // อ้างอิงข้อมูลกราฟคงที่ (กันรีอนิเมชันซ้ำ)

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

  // จอโชว์ไม่มีคนกด → มีเวอร์ชันใหม่ก็รีโหลดเงียบๆ เอง (หน่วง 4 วิ กันจังหวะกำลังอัปเดต)
  const updateReady = useUpdateReady();
  useEffect(() => {
    if (!updateReady) return;
    const t = setTimeout(() => applyUpdate(), 4000);
    return () => clearTimeout(t);
  }, [updateReady]);

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

  // ── กราฟการผลิตรายชั่วโมง (กก. ต่อ ชม.) ตามเวลาไทย ────────────────────
  // สำคัญ: ทำให้ "อ้างอิงข้อมูลคงที่" เมื่อค่าไม่เปลี่ยน (นาฬิกาเดินทุกวินาที
  // ไม่ควรทำให้กราฟรีเซ็ต/กระพริบใหม่) — Recharts จะขยับก็ต่อเมื่อค่าจริงเปลี่ยน
  const HOUR = 3600 * 1000;
  const curH = new Date(now.getTime() + 7 * HOUR).getUTCHours();
  const hourly = useMemo(() => {
    const bkkHour = (iso) => new Date(new Date(iso).getTime() + 7 * HOUR).getUTCHours();
    const perHourKg = new Array(24).fill(0);
    for (const l of logs) perHourKg[bkkHour(l.scanned_at)] += Number(l.weight) || 0;
    const active = logs.map((l) => bkkHour(l.scanned_at));
    let startH = active.length ? Math.min(...active) : Math.max(0, curH - 6);
    startH = Math.min(startH, Math.max(0, curH - 3)); // โชว์อย่างน้อย ~4 จุด
    const arr = [];
    for (let h = startH; h <= curH; h++) arr.push({ hour: `${pad(h)}:00`, kg: Math.round(perHourKg[h] * 10) / 10 });
    // คงอ้างอิงเดิมถ้าค่าเท่าเดิม → กราฟไม่รีอนิเมชันซ้ำทุกโพล/ทุกวินาที
    if (JSON.stringify(arr) === JSON.stringify(hourlyRef.current)) return hourlyRef.current;
    hourlyRef.current = arr;
    return arr;
  }, [logs, curH]);

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

        <div className="dash-panel">
          <div className="dash-panel-h"><span>การผลิตรายชั่วโมง · วันนี้ (กก.)</span></div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {hourly.length === 0 ? (
              <div className="dash-empty">รอข้อมูลการผลิต…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourly} margin={{ top: 12, right: 18, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14e39a" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#14e39a" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#24302a" vertical={false} />
                  <XAxis dataKey="hour" stroke="#24302a" tickLine={false}
                    tick={{ fill: "#9db1a8", fontSize: 14 }} interval="preserveStartEnd" />
                  <YAxis stroke="#24302a" tickLine={false} width={56}
                    tick={{ fill: "#9db1a8", fontSize: 13 }}
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} />
                  <Area type="monotone" dataKey="kg" stroke="#14e39a" strokeWidth={3}
                    fill="url(#dashArea)" dot={{ r: 3, fill: "#14e39a", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "#22e07a", stroke: "#0b0f0d", strokeWidth: 2 }}
                    animationDuration={900} isAnimationActive />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
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
