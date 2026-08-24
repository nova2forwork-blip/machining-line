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
function fmtHrs(secs, L = "th") {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)} ${L === "en" ? "h" : "ชม."}` : `${m} ${L === "en" ? "m" : "น."}`;
}
function fmtClock(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function fmtDateLoc(d, L) {
  return d.toLocaleDateString(L === "en" ? "en-GB" : "th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function timeOf(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// ─── สองภาษา ไทย/อังกฤษ ─────────────────────────────────────────────────────
const STR = {
  th: {
    subtitle: "จอแสดงการผลิตแบบเรียลไทม์", live: "LIVE",
    kpiPieces: "ชิ้นที่ผลิตวันนี้", unitPieces: "ชิ้น",
    kpiWeight: "น้ำหนักรวมวันนี้", unitKg: "กก.",
    kpiTime: "เวลาเดินเครื่องรวม (หน้าเครื่อง)",
    kpiScans: "การสแกนวันนี้", unitTimes: "ครั้ง",
    machines: "เครื่องจักร · วันนี้", machineUnit: "เครื่อง",
    noWork: "ยังไม่มีงานเข้าวันนี้ — รอเครื่องเริ่มสแกน…",
    hourly: "การผลิตรายชั่วโมง · วันนี้ (ชิ้น)", waitingData: "รอข้อมูลการผลิต…",
    liveFeed: "◉ ฟีดการผลิตสด", waitingScan: "รอการสแกนจากหน้าเครื่อง…",
    finished: "เสร็จแล้ว", inProcess: "กำลังทำ",
    booting: "กำลังเชื่อมต่อสายการผลิต…",
  },
  en: {
    subtitle: "Live Production Monitor", live: "LIVE",
    kpiPieces: "Pieces Produced Today", unitPieces: "pcs",
    kpiWeight: "Total Weight Today", unitKg: "kg",
    kpiTime: "Machine Time · logged",
    kpiScans: "Scans Today", unitTimes: "scans",
    machines: "Machines · Today", machineUnit: "machines",
    noWork: "No work yet today — waiting for the first scan…",
    hourly: "Hourly Production · Today (pcs)", waitingData: "Waiting for production data…",
    liveFeed: "◉ Live Production Feed", waitingScan: "Waiting for scans from the floor…",
    finished: "Finished", inProcess: "In Progress",
    booting: "Connecting to the production line…",
  },
};

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

// ชื่อขั้นตอน ไทย→อังกฤษ (สำหรับ dashboard เมื่อเลือกภาษา EN)
const OP_EN = {
  "ตัด": "Cut", "เจาะ": "Drill", "บาก": "Notch", "พับ": "Bend", "เชื่อม": "Weld", "ประกอบ": "Assemble",
  "กัด": "Milling", "เฉือน": "Shearing", "ปั๊ม": "Punching", "ต๊าป": "Tapping", "เซาะร่อง": "Grooving", "ผ่า": "Ripping",
};
const opLabel = (name, lang) => (lang === "en" ? (OP_EN[name] || name) : name);

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [booted, setBooted] = useState(false);
  const [now, setNow] = useState(new Date());
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("mls-dash-lang") === "en" ? "en" : "th"; } catch { return "th"; }
  });
  const t = STR[lang];
  const setLangSave = (l) => { setLang(l); try { localStorage.setItem("mls-dash-lang", l); } catch { /* ignore */ } };
  const [fresh, setFresh] = useState(new Set());       // key ของสแกนใหม่ (ไฮไลต์ฟีด)
  const [hit, setHit] = useState(new Set());           // ชื่อเครื่องที่เพิ่งมีงานเข้า (แฟลชการ์ด)
  const seenRef = useRef(null);                        // key ที่เคยเห็นแล้ว (กันแฟลชซ้ำ)
  const hitTimer = useRef(0);
  const hourlyRef = useRef([]);                        // อ้างอิงข้อมูลกราฟคงที่ (กันรีอนิเมชันซ้ำ)

  const fetchNow = useCallback(async () => {
    const { from, to } = bangkokTodayRange();
    let data;
    try {
      data = await getScanLogsBetween(from, to);
    } catch {
      // ดึงข้อมูลพลาด (เน็ต/DB) → อย่าค้างสปินเนอร์ ปล่อยให้โพลรอบหน้าลองใหม่
      setBooted(true);
      return;
    }
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
  // memo ตาม logs เท่านั้น — นาฬิกาเดินทุก 1 วิ ไม่ต้องคำนวณยอดทั้งวันใหม่ (เปลือง CPU
  // บนจอเปิดทั้งวัน) · ค่าจริงเปลี่ยนแค่ตอนโพล 5 วิ
  const { totalPieces, totalKg, totalSec, scanCount, machines, maxKg, feed } = useMemo(() => {
    const tPieces = logs.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    const tKg = logs.reduce((s, l) => s + (Number(l.weight) || 0), 0);
    const tSec = logs.reduce((s, l) => s + (Number(l.process_seconds) || 0), 0);
    const matrix = machineOpMatrix(logs);
    const mach = matrix.machines.map((m) => {
      const op = Object.entries(m.ops).sort((a, b) => b[1].count - a[1].count)[0];
      return { name: m.name, op: op ? op[0] : "", count: m.total.count, weight: m.total.weight, seconds: m.total.seconds };
    });
    return {
      totalPieces: tPieces, totalKg: tKg, totalSec: tSec, scanCount: logs.length,
      machines: mach, maxKg: Math.max(1, ...mach.map((m) => m.weight)), feed: logs.slice(0, 9),
    };
  }, [logs]);

  // ── กราฟการผลิตรายชั่วโมง (กก. ต่อ ชม.) ตามเวลาไทย ────────────────────
  // สำคัญ: ทำให้ "อ้างอิงข้อมูลคงที่" เมื่อค่าไม่เปลี่ยน (นาฬิกาเดินทุกวินาที
  // ไม่ควรทำให้กราฟรีเซ็ต/กระพริบใหม่) — Recharts จะขยับก็ต่อเมื่อค่าจริงเปลี่ยน
  const HOUR = 3600 * 1000;
  const curH = new Date(now.getTime() + 7 * HOUR).getUTCHours();
  const hourly = useMemo(() => {
    const bkkHour = (iso) => new Date(new Date(iso).getTime() + 7 * HOUR).getUTCHours();
    const perHour = new Array(24).fill(0);
    for (const l of logs) perHour[bkkHour(l.scanned_at)] += Number(l.quantity) || 0;   // นับ "จำนวนชิ้น" ต่อชั่วโมง
    const active = logs.map((l) => bkkHour(l.scanned_at));
    let startH = active.length ? Math.min(...active) : Math.max(0, curH - 6);
    startH = Math.min(startH, Math.max(0, curH - 3)); // โชว์อย่างน้อย ~4 จุด
    const arr = [];
    // เส้นเดียวปกติ — ทุกชั่วโมงรวมชั่วโมงปัจจุบัน (ยอดสะสมเท่าที่ทำได้ถึงตอนนี้)
    for (let h = startH; h <= curH; h++) arr.push({ hour: `${pad(h)}:00`, pcs: perHour[h] });
    // คงอ้างอิงเดิมถ้าค่าเท่าเดิม → กราฟไม่รีอนิเมชันซ้ำทุกโพล/ทุกวินาที
    if (JSON.stringify(arr) === JSON.stringify(hourlyRef.current)) return hourlyRef.current;
    hourlyRef.current = arr;
    return arr;
  }, [logs, curH]);

  // ── แฟลช KPI เฉพาะตัวที่ค่าเปลี่ยน (เดิมกระพริบทั้ง 4 ทุกการสแกน = รก) ──────
  const prevTotals = useRef({ p: 0, k: 0, s: 0, c: 0 });
  const kpiTimer = useRef(0);
  const [kpiHit, setKpiHit] = useState({});
  useEffect(() => {
    const pv = prevTotals.current;
    const hitK = { pieces: totalPieces !== pv.p, kg: totalKg !== pv.k, sec: totalSec !== pv.s, scans: scanCount !== pv.c };
    const hadData = pv.p || pv.k || pv.s || pv.c;   // รอบแรก (บูต) อย่าแฟลช
    if (hadData && (hitK.pieces || hitK.kg || hitK.sec || hitK.scans)) {
      setKpiHit(hitK);
      clearTimeout(kpiTimer.current);
      kpiTimer.current = setTimeout(() => setKpiHit({}), 1600);
    }
    prevTotals.current = { p: totalPieces, k: totalKg, s: totalSec, c: scanCount };
  }, [totalPieces, totalKg, totalSec, scanCount]);
  useEffect(() => () => clearTimeout(kpiTimer.current), []);

  if (!booted) {
    return (
      <div className="dash-boot">
        <div className="spin" />
        <div style={{ fontSize: "2vh" }}>{t.booting}</div>
      </div>
    );
  }

  return (
    <div className="dash">
      {/* ── header ── */}
      <div className="dash-head">
        <div className="dash-title">
          MACHINING LINE
          <span className="sub">{t.subtitle}</span>
        </div>
        <div className="dash-headright">
          <div className="dash-langsel">
            <button className={lang === "th" ? "on" : ""} onClick={() => setLangSave("th")}>ไทย</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLangSave("en")}>EN</button>
          </div>
          <div className="dash-live"><span className="dot" /> {t.live}</div>
          <div style={{ textAlign: "right" }}>
            <div className="dash-clock dash-num">{fmtClock(now)}</div>
            <div className="dash-date">{fmtDateLoc(now, lang)}</div>
          </div>
        </div>
      </div>

      {/* ── KPI hero row ── */}
      <div className="dash-kpi-row">
        <Kpi label={t.kpiPieces} value={totalPieces} format={fmtInt} unit={t.unitPieces} flash={!!kpiHit.pieces} />
        <Kpi label={t.kpiWeight} value={totalKg} format={fmtKg} unit={t.unitKg} flash={!!kpiHit.kg} />
        <Kpi label={t.kpiTime} value={totalSec} format={(v) => fmtHrs(v, lang)} unit="" flash={!!kpiHit.sec} />
        <Kpi label={t.kpiScans} value={scanCount} format={fmtInt} unit={t.unitTimes} flash={!!kpiHit.scans} />
      </div>

      {/* ── แถบอนิเมชันสายการผลิต (เหนือ Machines) ── */}
      <MachineLine />

      {/* ── main: machine cards + chart ── */}
      <div className="dash-main">
        <div className="dash-panel">
          <div className="dash-panel-h"><span>{t.machines}</span><span style={{ color: "var(--dash-green)" }}>{machines.length} {t.machineUnit}</span></div>
          {machines.length === 0 ? (
            <div className="dash-empty">{t.noWork}</div>
          ) : (
            <div className="dash-machines">
              {machines.map((m) => (
                <div key={m.name} className={`dash-mach ${hit.has(m.name) ? "hit" : ""}`}>
                  <div className="name">{m.name}{m.op ? <span className="op">{m.op}</span> : null}</div>
                  <div className="big"><CountNumber value={m.weight} format={fmtKg} /><span className="unit">{t.unitKg}</span></div>
                  <div className="meta"><CountNumber value={m.count} format={fmtInt} /> {t.unitPieces} · {fmtHrs(m.seconds, lang)}</div>
                  <div className="dash-bar-track"><div className="dash-bar-fill" style={{ width: `${Math.max(4, (m.weight / maxKg) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dash-panel">
          <div className="dash-panel-h"><span>{t.hourly}</span></div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {hourly.length === 0 ? (
              <div className="dash-empty">{t.waitingData}</div>
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
                  <Area type="monotone" dataKey="pcs" stroke="#14e39a" strokeWidth={3}
                    fill="url(#dashArea)" dot={{ r: 3, fill: "#14e39a", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "#22e07a", stroke: "#0b0f0d", strokeWidth: 2 }}
                    connectNulls={false} animationDuration={900} isAnimationActive />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── live feed ── */}
      <div className="dash-feed dash-panel">
        <div className="dash-panel-h"><span>{t.liveFeed}</span></div>
        {feed.length === 0 ? (
          <div className="dash-empty">{t.waitingScan}</div>
        ) : (
          <div className="dash-feed-list">
            {feed.map((l) => {
              return (
                <div key={keyOf(l)} className={`dash-feed-item ${fresh.has(keyOf(l)) ? "fresh" : ""}`}>
                  <div className="part">{l.part_unit?.part_master?.part_no || "—"}</div>
                  <div className="qty">+{fmtInt(l.quantity)}</div>
                  <div className="line2">
                    <span className="chip">{l.machine?.name || "—"}</span>
                    {l.operation?.name ? <span className="op">{opLabel(l.operation.name, lang)}</span> : null}
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

// ─── แถบอนิเมชัน "สายการผลิตกำลังทำงาน" (SVG ในตัว: สายพานวิ่ง + แขนกล + ชิ้นงาน) ──
const MLINE_SVG = `
<svg class="mline" viewBox="0 0 1200 190" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Production line running">
  <defs>
    <linearGradient id="mlSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a473f"/><stop offset="1" stop-color="#212c27"/></linearGradient>
    <linearGradient id="mlAlu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8ede9"/><stop offset="1" stop-color="#9fb0a7"/></linearGradient>
  </defs>
  <style>
    .mline{width:100%;height:100%;display:block}
    .ml-belt{animation:mlBelt 1s linear infinite}
    @keyframes mlBelt{to{stroke-dashoffset:-32}}
    .ml-parts g{animation:mlPart 6s linear infinite}
    @keyframes mlPart{0%{transform:translateX(0);opacity:0}6%{opacity:1}88%{opacity:1}100%{transform:translateX(956px);opacity:0}}
    .ml-a{animation:mlArrow 1.2s ease-in-out infinite}.ml-a.a2{animation-delay:.2s}.ml-a.a3{animation-delay:.4s}
    @keyframes mlArrow{0%,100%{opacity:.2}50%{opacity:1}}
    .ml-scr{animation:mlScr 2.4s ease-in-out infinite}@keyframes mlScr{0%,100%{opacity:.9}50%{opacity:.4}}
    .ml-led{animation:mlLed 1.4s steps(1) infinite}.ml-led.l2{animation-delay:.7s}
    @keyframes mlLed{0%,60%{opacity:1}61%,100%{opacity:.2}}
    .ml-spark{transform-origin:273px 122px;animation:mlSpark .5s ease-in-out infinite}
    @keyframes mlSpark{0%,100%{opacity:.75}50%{opacity:.4}}
    .ml-box{animation:mlBox 6s ease-in-out infinite}@keyframes mlBox{0%,68%{opacity:0;transform:translateX(-12px)}80%{opacity:1;transform:translateX(0)}100%{opacity:1}}
    /* เคารพผู้ใช้ที่ตั้งค่า "ลดการเคลื่อนไหว" + กันจอ 24 ชม.ล้าตา = ปิดอนิเมชันตกแต่ง */
    @media (prefers-reduced-motion: reduce){
      .ml-belt,.ml-parts g,.ml-a,.ml-scr,.ml-led,.ml-spark,.ml-box{animation:none !important}
    }
  </style>

  <!-- flow arrows (infeed) -->
  <g fill="none" stroke="#14e39a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path class="ml-a a1" d="M16 100 l16 14 -16 14"/><path class="ml-a a2" d="M42 100 l16 14 -16 14"/><path class="ml-a a3" d="M68 100 l16 14 -16 14"/>
  </g>

  <!-- conveyor belt -->
  <rect x="95" y="120" width="1010" height="22" rx="11" fill="url(#mlSteel)" stroke="#0d1310"/>
  <line class="ml-belt" x1="108" y1="131" x2="1092" y2="131" stroke="#14e39a" stroke-width="3" stroke-dasharray="16 16" stroke-linecap="round" opacity="0.55"/>
  <g fill="#0d1310"><rect x="150" y="142" width="10" height="34" rx="2"/><rect x="430" y="142" width="10" height="34" rx="2"/><rect x="720" y="142" width="10" height="34" rx="2"/><rect x="1010" y="142" width="10" height="34" rx="2"/></g>

  <!-- parts moving on belt -->
  <g class="ml-parts">
    <g style="animation-delay:0s">
      <rect x="120" y="100" width="168" height="18" rx="2" fill="url(#mlAlu)" stroke="#828f88" stroke-width="0.7"/>
      <rect x="126" y="103" width="156" height="12" rx="1" fill="#7fd6c0" opacity="0.30"/>
      <line x1="162" y1="100" x2="162" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <line x1="204" y1="100" x2="204" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <line x1="246" y1="100" x2="246" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <rect x="120" y="100" width="168" height="2.6" rx="1" fill="#14e39a" opacity="0.5"/>
    </g>
    <g style="animation-delay:-2s">
      <rect x="120" y="100" width="168" height="18" rx="2" fill="url(#mlAlu)" stroke="#828f88" stroke-width="0.7"/>
      <rect x="126" y="103" width="156" height="12" rx="1" fill="#7fd6c0" opacity="0.30"/>
      <line x1="162" y1="100" x2="162" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <line x1="204" y1="100" x2="204" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <line x1="246" y1="100" x2="246" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <rect x="120" y="100" width="168" height="2.6" rx="1" fill="#14e39a" opacity="0.5"/>
    </g>
    <g style="animation-delay:-4s">
      <rect x="120" y="100" width="168" height="18" rx="2" fill="url(#mlAlu)" stroke="#828f88" stroke-width="0.7"/>
      <rect x="126" y="103" width="156" height="12" rx="1" fill="#7fd6c0" opacity="0.30"/>
      <line x1="162" y1="100" x2="162" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <line x1="204" y1="100" x2="204" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <line x1="246" y1="100" x2="246" y2="118" stroke="#79877f" stroke-width="1.2"/>
      <rect x="120" y="100" width="168" height="2.6" rx="1" fill="#14e39a" opacity="0.5"/>
    </g>
  </g>

  <!-- Machine A: cutting -->
  <g>
    <rect x="228" y="46" width="90" height="76" rx="9" fill="url(#mlSteel)" stroke="#0d1310"/>
    <rect x="242" y="58" width="62" height="28" rx="4" fill="#0b1512"/><rect class="ml-scr" x="246" y="62" width="54" height="20" rx="2" fill="#14e39a"/>
    <circle class="ml-led l1" cx="250" cy="104" r="4.5" fill="#22e07a"/><circle class="ml-led l2" cx="266" cy="104" r="4.5" fill="#ffc23d"/>
    <g><animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 273 122" to="360 273 122" dur="0.5s" repeatCount="indefinite"/>
      <circle cx="273" cy="122" r="16" fill="#c2c8d0" stroke="#0d1310" stroke-width="2"/><circle cx="273" cy="122" r="16" fill="none" stroke="#0d1310" stroke-width="3" stroke-dasharray="3 5"/><circle cx="273" cy="122" r="4" fill="#14e39a"/>
    </g>
    <g class="ml-spark" fill="#ffb02e"><path d="M266 122 l-9 -5 M266 124 l-11 2 M266 126 l-8 6"/><circle cx="255" cy="120" r="1.6"/><circle cx="252" cy="127" r="1.4"/></g>
  </g>

  <!-- Robot arm 1 (pick & place) -->
  <rect x="404" y="100" width="34" height="44" rx="6" fill="url(#mlSteel)" stroke="#0d1310"/>
  <g><animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="3.4s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" values="-22 421 100; 8 421 100; -22 421 100"/>
    <rect x="416" y="40" width="10" height="62" rx="5" fill="#46564d"/><rect x="406" y="30" width="30" height="14" rx="4" fill="#2c3a34"/><rect x="404" y="26" width="6" height="16" rx="2" fill="#39473f"/><rect x="432" y="26" width="6" height="16" rx="2" fill="#39473f"/>
  </g>
  <circle cx="421" cy="100" r="9" fill="#14e39a"/>

  <!-- Machine B: drilling -->
  <g>
    <rect x="556" y="46" width="90" height="76" rx="9" fill="url(#mlSteel)" stroke="#0d1310"/>
    <rect x="570" y="58" width="62" height="28" rx="4" fill="#0b1512"/><rect class="ml-scr" x="574" y="62" width="54" height="20" rx="2" fill="#14e39a"/>
    <circle class="ml-led l1" cx="578" cy="104" r="4.5" fill="#22e07a"/><circle class="ml-led l2" cx="594" cy="104" r="4.5" fill="#ffc23d"/>
    <rect x="598" y="88" width="6" height="8" fill="#39473f"/>
    <g><animateTransform attributeName="transform" attributeType="XML" type="translate" dur="1.1s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" values="0 0; 0 16; 0 0"/><rect x="599" y="96" width="4" height="20" fill="#aeb6bd"/></g>
  </g>

  <!-- Robot arm 2 -->
  <rect x="734" y="100" width="34" height="44" rx="6" fill="url(#mlSteel)" stroke="#0d1310"/>
  <g><animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="2.9s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" values="14 751 100; -16 751 100; 14 751 100"/>
    <rect x="746" y="40" width="10" height="62" rx="5" fill="#46564d"/><rect x="736" y="30" width="30" height="14" rx="4" fill="#2c3a34"/><rect x="734" y="26" width="6" height="16" rx="2" fill="#39473f"/><rect x="762" y="26" width="6" height="16" rx="2" fill="#39473f"/>
  </g>
  <circle cx="751" cy="100" r="9" fill="#14e39a"/>

  <!-- Output machine + boxes -->
  <g>
    <rect x="980" y="52" width="94" height="70" rx="9" fill="url(#mlSteel)" stroke="#0d1310"/>
    <rect x="994" y="64" width="66" height="26" rx="4" fill="#0b1512"/><rect class="ml-scr" x="998" y="68" width="58" height="18" rx="2" fill="#14e39a"/>
    <circle class="ml-led l1" cx="998" cy="106" r="4.5" fill="#22e07a"/>
  </g>
  <g class="ml-box" style="animation-delay:0s"><rect x="1096" y="96" width="40" height="26" rx="3" fill="#2c3a34" stroke="#0d1310"/><rect x="1096" y="106" width="40" height="4" fill="#14e39a" opacity=".55"/></g>
  <g class="ml-box" style="animation-delay:-3s"><rect x="1096" y="70" width="40" height="24" rx="3" fill="#33413a" stroke="#0d1310"/><rect x="1096" y="79" width="40" height="4" fill="#14e39a" opacity=".55"/></g>
</svg>`;

function MachineLine() {
  return <div className="dash-panel dash-line" dangerouslySetInnerHTML={{ __html: MLINE_SVG }} />;
}

function Kpi({ label, value, format, unit, flash }) {
  return (
    <div className={`dash-kpi ${flash ? "flash" : ""}`}>
      <div className="lbl">{label}</div>
      <div className="val"><CountNumber value={value} format={format} />{unit ? <span className="unit">{unit}</span> : null}</div>
    </div>
  );
}
