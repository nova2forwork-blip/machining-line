import { useState, useEffect, useRef, useCallback } from "react";
import "./styles.css";
import "./station.css";
import {
  stationLogin, getSession, setSession, clearSession,
} from "./auth.js";
import {
  findUnitByQr, findUnitByPartNo, findReleaseCandidatesByPartNo, getMachineDay, recordMachineWork, getReleaseProgress,
  scanQueueCount, onScanQueue, flushScanQueue, logoutSession, prefetchUnitsForOffline,
  rejectedQueueCount, onRejectedQueue, retryRejected, sessionHeartbeat, getMachineOps,
  countUnitOpRecords, listRejected, clearRejected,
} from "./supabase.js";
import { enterFullscreen, toggleFullscreen, armFullscreenOnFirstTap, isStandalone, warmCameraPermission, getSharedCameraStream, releaseSharedCamera, camPermissionPersists } from "./fullscreen.js";
import { useUpdateReady, applyUpdate } from "./updatePrompt.js";
import { useLang } from "./i18n-dom.js";

// ปุ่มสลับภาษา ไทย/EN บนหน้าเครื่อง (ใช้ตัวแปล DOM ตัวเดียวกับหน้าสำนักงาน · ซิงค์ผ่าน localStorage)
function StnLangToggle() {
  const [lang, setLang] = useLang();
  return (
    <button className="stn-lang" onClick={() => setLang(lang === "th" ? "en" : "th")}
      title="สลับภาษา / Switch language">
      {lang === "th" ? "EN" : "ไทย"}
    </button>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
const pad = (n) => String(n).padStart(2, "0");
function hms(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
function todayISOdate() {
  const d = new Date();
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}
// วันที่แบบสั้น MM.DD — ใช้เติมคอลัมน์ DATE ให้แถวที่เพิ่งสแกน (row จาก record_machine_work ไม่มี day)
function todayMD() {
  const d = new Date();
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

// ─── เสียง "ติ๊ด" ตอนสแกน (Web Audio) + สั่น ───────────────────────────────
let _audioCtx = null;
function audioCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    return _audioCtx;
  } catch { return null; }
}
// เรียกจาก user gesture (กด SCAN) เพื่อปลดล็อกเสียงบนมือถือ
function warmAudio() { audioCtx(); }
function beep(freq = 950, ms = 110, vol = 0.25) {
  const ctx = audioCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + ms / 1000 + 0.02);
  } catch { /* ignore */ }
}
function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch { /* ignore */ } }

// ══════════════════════════════════════════════════════════════════════════
// STATION LOGIN — same credentials as the main app; intended for the
// machine's own account (an employee whose machine_id is set).
// ══════════════════════════════════════════════════════════════════════════
function StationLogin({ onLogin, notice }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const res = await stationLogin(code, password);
    setBusy(false);
    if (!res || !res.user) {
      if (res && res.error === "in_use") {
        const t = res.lastSeen ? new Date(res.lastSeen) : null;
        const hhmm = t ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "";
        setErr(`มีเครื่องอื่นใช้บัญชีนี้อยู่${hhmm ? ` (ใช้งานล่าสุด ${hhmm})` : ""} — เข้าไม่ได้ · ให้ออกจากระบบที่เครื่องนั้นก่อน หรือรอสักครู่หากเครื่องนั้นปิดไปแล้ว`);
        return;
      }
      setErr(res && res.error === "offline_first"
        ? "บัญชีนี้ยังไม่เคยล็อกอินในเครื่องนี้ — ต้องล็อกอินตอนมีเน็ต 1 ครั้งก่อน แล้วครั้งต่อไปจะออฟไลน์ได้"
        : "รหัสเครื่อง/พนักงาน หรือรหัสผ่านไม่ถูกต้อง");
      return;
    }
    setSession(res.user);
    enterFullscreen();          // ล็อกอินสำเร็จ = user gesture → เข้าเต็มจอทันที
    warmCameraPermission();     // ขอสิทธิ์กล้อง "ครั้งเดียว" ตอนนี้เลย → SCAN ครั้งต่อไปไม่ถามซ้ำ
    onLogin(res.user);
  }

  return (
    <div className="stn-login-wrap">
      <form className="stn-login" onSubmit={submit} style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}><StnLangToggle /></div>
        <h1>หน้าเครื่อง — เข้าสู่ระบบ</h1>
        <p>ล็อกอินด้วยบัญชีของเครื่องจักรนี้ (บัญชีที่ผูกเครื่องไว้)</p>
        {notice && <div className="stn-notice">{notice}</div>}
        <div className="stn-field">
          <label>รหัสเครื่อง / พนักงาน</label>
          <input className="stn-input" value={code} autoFocus
            onChange={(e) => setCode(e.target.value)} placeholder="เช่น CT-001" />
        </div>
        <div className="stn-field">
          <label>รหัสผ่าน</label>
          <input className="stn-input" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {err && <div className="stn-err">{err}</div>}
        <button className="stn-btn" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</button>
        <div className="stn-login-foot">
          จอนี้สำหรับติดหน้าเครื่องจักร (แนวนอน)
          <br /><a className="stn-link-normal" href="/">ไปหน้าปกติ (สำนักงาน) →</a>
        </div>
      </form>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MACHINE TERMINAL
// ══════════════════════════════════════════════════════════════════════════
const STEP = { IDLE: "idle", REC: "rec", CANCEL: "cancel", SCAN: "scan", PART: "part", READY: "ready", SAVE: "save" };
// เก็บ "งานที่กำลังทำ" (ยังไม่กด OK) ไว้ใน localStorage → กดอัปเดต/รีโหลด/แอปเด้ง แล้วกู้กลับมาได้ ไม่หาย
const DRAFT_KEY = "mls-station-draft";
const DRAFT_MAX_AGE_MS = 6 * 3600 * 1000;   // เกินนี้ถือว่าเก่าเกิน (ไม่ใช่การรีโหลดสั้นๆ) → ไม่กู้ กันเวลาเดินเครื่องเพี้ยน

function MachineStation({ user, onLogout, onKicked }) {
  const [lang] = useLang();                       // ★ สลับป้าย report/ปุ่ม ตามภาษา (ไม่พึ่ง DICT ที่ใช้ร่วมกับออฟฟิศ)
  const t = (th, en) => (lang === "en" ? en : th);
  const machine = user.machine; // { id, code, name }
  // ขั้นตอนประจำเครื่อง (ตัด/เจาะ/บาก) — ใช้ทำ running number แยกตามขั้นตอน
  // มาจาก login (user.operation) และรีเฟรชจาก machine_day ทุกครั้งที่โหลด (เผื่อ admin แก้)
  const [op, setOp] = useState(user.operation || null);
  const [machineOps, setMachineOps] = useState([]);   // ขั้นตอนที่เครื่องนี้ทำได้ (สำหรับปุ่มเลือก)
  const [daily, setDaily] = useState({ quantity: 0, weight: 0, process_seconds: 0 });
  const [rows, setRows] = useState([]);
  const [newRowId, setNewRowId] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const [step, setStep] = useState(STEP.IDLE);
  const [materialLen, setMaterialLen] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startTsRef = useRef(null);   // เวลาเริ่มจริง (ms) — คำนวณเวลาเดินเครื่องแบบไม่ดริฟต์ + กู้ต่อได้ตอนโหลดใหม่

  const [unit, setUnit] = useState(null);   // resolved part_unit (from QR)
  const [progress, setProgress] = useState(null); // { done, total } ของล็อต/รีลีสที่สแกน
  const [dupCount, setDupCount] = useState(0);   // ชิ้นนี้เคยทำ "ขั้นตอนนี้" ไปแล้วกี่ครั้ง (เตือน rework)
  const [qty, setQty] = useState(0);
  const [status, setStatus] = useState(null); // 'finished' | 'inprocess'
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);   // กันกด OK ซ้ำระหว่างบันทึก (re-entrancy)
  const clientIdRef = useRef(null);  // ★ client_id คงเดิมตลอด "การบันทึกครั้งเดียว" (รวมตอน retry) กันบันทึกซ้ำ
  const [toast, setToast] = useState(null);   // { text, tone }
  const toastRef = useRef(null);
  const [pending, setPending] = useState(scanQueueCount());
  const [rejected, setRejected] = useState(rejectedQueueCount());
  const [storageFull, setStorageFull] = useState(false);   // ที่เก็บเต็ม — โชว์แถบค้างจนกว่าจะบันทึกได้
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [showRejected, setShowRejected] = useState(false); // เปิดแผงจัดการคิวซิงค์ไม่สำเร็จ

  // ── load today's records for this machine ──────────────────────────────
  const reload = useCallback(async () => {
    const res = await getMachineDay();
    // ถูกเตะออก (บัญชีถูกใช้ล็อกอินที่เครื่องอื่น) — เฉพาะตอนออนไลน์ที่เซิร์ฟเวอร์ตอบ unauthorized
    if (res && res.ok === false && res.reason === "unauthorized"
        && !(typeof navigator !== "undefined" && navigator.onLine === false)) {
      // ★ H2: ดันงานค้างขึ้นก่อนเตะออก — กันงานออฟไลน์ค้างซิงค์ไม่ได้อีก
      await flushScanQueue();
      if (scanQueueCount() === 0) { onKicked && onKicked(); }
      else { flash("บัญชีถูกใช้ที่เครื่องอื่น — กำลังซิงค์งานค้างก่อนออก", "warn"); }
      return;
    }
    if (res && res.ok !== false) {
      setDaily(res.daily || { quantity: 0, weight: 0, process_seconds: 0 });
      setRows(res.records || []);
      setLoadErr("");
      // หมายเหตุ: ไม่ตั้ง op จาก machine_day ที่นี่ — เพราะ reload ทำงานหลังบันทึกทุกครั้ง
      //   ถ้าตั้งจะไปทับ "ขั้นตอนที่คนงานเลือกเอง" · การตั้ง default ทำที่ effect โหลด machineOps
    } else {
      setLoadErr(res?.message || "โหลดข้อมูลไม่สำเร็จ");
    }
  }, [onKicked]);
  useEffect(() => { reload(); }, [reload]);

  // โหลดขั้นตอนที่เครื่องนี้ทำได้ + ตั้ง default การเลือก (ครั้งเดียวตอนเปิด)
  useEffect(() => {
    getMachineOps().then((ops) => {
      setMachineOps(ops);
      setOp((cur) => {
        if (cur && ops.some((o) => o.id === cur.id)) return cur;          // เลือกไว้แล้ว + ยังทำได้ → คงเดิม
        if (ops.length === 1) return ops[0];                               // ทำได้ขั้นตอนเดียว → เลือกให้เลย
        if (ops.length === 0) return user.operation || cur;               // ไม่ได้ตั้งความสามารถ → ใช้ขั้นตอนประจำบัญชี
        // ★ ทำได้หลายขั้นตอน → บังคับให้แตะเลือกเอง (ไม่ default จากบัญชี กันบันทึกผิดขั้นตอนเงียบๆ)
        return null;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // เช็คเป็นระยะ (ตอนออนไลน์) เผื่อถูกเตะออก + รีเฟรชยอดวัน
  useEffect(() => {
    const t = setInterval(() => { if (!(typeof navigator !== "undefined" && navigator.onLine === false)) reload(); }, 45000);
    return () => clearInterval(t);
  }, [reload]);

  // heartbeat: บอกว่าเครื่องนี้ยังใช้บัญชีอยู่ (กันเครื่องอื่นเข้าแทน)
  // ถ้าถูก superseded (มีเครื่องใหม่เข้าแทนตอนเราเงียบไป) → "ซิงค์งานค้างให้หมดก่อน" แล้วค่อยเด้งออก
  // (token ที่ superseded ยังซิงค์ได้ → ข้อมูลไม่หาย)
  useEffect(() => {
    let stopped = false;
    async function beat() {
      if (stopped || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
      const r = await sessionHeartbeat();
      if (stopped) return;
      if (r && r.superseded) {
        await flushScanQueue();                                  // ดันงานค้างขึ้นก่อน
        if (scanQueueCount() === 0) { onKicked && onKicked(); }  // ไม่มีค้างแล้ว → ออกได้ปลอดภัย
        else { flash("บัญชีถูกใช้ที่เครื่องอื่น — กำลังซิงค์งานค้างก่อนออก", "warn"); }
      }
    }
    beat();
    const t = setInterval(beat, 60000);
    return () => { stopped = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    flushScanQueue().then(() => setPending(scanQueueCount()));
    const off = onScanQueue((n) => setPending(n));
    const offR = onRejectedQueue((n) => setRejected(n));
    return () => { off(); offR(); };
  }, []);

  // สถานะออนไลน์/ออฟไลน์ (reactive) — ใช้โชว์แถบสถานะเน็ตด้านบน
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // แจ้งเตือนถ้าที่เก็บข้อมูลเต็ม (เขียนคิวไม่ได้) — งานอาจไม่ถูกบันทึก (B4)
  // โชว์เป็นแถบค้าง (ไม่ใช่ toast วูบเดียว) เพราะเป็นเหตุการณ์ข้อมูลหาย ต้องเห็นตลอด
  useEffect(() => {
    const onFull = () => { setStorageFull(true); errorBeep(); };
    window.addEventListener("mls-storage-full", onFull);
    return () => window.removeEventListener("mls-storage-full", onFull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ขอสิทธิ์กล้องครั้งเดียวตอนแตะจอครั้งแรก (สำหรับคนที่ล็อกอินค้างไว้ ไม่ได้ผ่านหน้าล็อกอิน)
  useEffect(() => {
    const once = () => { warmCameraPermission(); window.removeEventListener("pointerdown", once); };
    window.addEventListener("pointerdown", once, { once: true });
    return () => window.removeEventListener("pointerdown", once);
  }, []);

  // โหลดชิ้นงานล่วงหน้าเก็บในเครื่อง (ตอนออนไลน์) เพื่อให้สแกนออฟไลน์เจอข้อมูล
  // ทำเงียบๆ เบื้องหลัง + รีเฟรชทุกครั้งที่เน็ตกลับมา
  useEffect(() => {
    prefetchUnitsForOffline().catch(() => {});
    const onOnline = () => prefetchUnitsForOffline().catch(() => {});
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  function flash(text, tone = "ok") {
    setToast({ text, tone });
    clearTimeout(toastRef.current);
    // ข้อความเตือน (warn) อยู่นานกว่า — กันคนงานละสายตาแล้วพลาดข้อความสำคัญ (เช่น "ไม่พบ QR")
    toastRef.current = setTimeout(() => setToast(null), tone === "ok" ? 1900 : 4200);
  }
  useEffect(() => () => clearTimeout(toastRef.current), []);

  // ── timer ───────────────────────────────────────────────────────────────
  // ยึด "เวลาเริ่มจริง (startTsRef)" เป็นหลัก → เวลาไม่ดริฟต์ + กู้ต่อได้เป๊ะตอนโหลดแอปใหม่
  function startTimer() {
    clearInterval(timerRef.current);
    if (startTsRef.current == null) startTsRef.current = Date.now() - (Number(elapsed) || 0) * 1000;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startTsRef.current) / 1000)));
    tick();
    timerRef.current = setInterval(tick, 1000);
  }
  function stopTimer() { clearInterval(timerRef.current); timerRef.current = null; startTsRef.current = null; }
  useEffect(() => () => stopTimer(), []);
  // ปิดกล้องถาวรตอนออกจากหน้าเครื่อง (ออกจากระบบ/ถูกเตะ) — ระหว่างใช้งานกล้องเปิดค้างไว้ตัวเดียว
  useEffect(() => () => releaseSharedCamera(), []);

  // ── กัน "งานหายตอนกดอัปเดต/รีโหลด" ──────────────────────────────────────
  // เก็บงานที่กำลังทำ (พาร์ทที่สแกน/จำนวน/สถานะ/เวลาเดินเครื่อง) ลง localStorage แบบสด
  // แล้วกู้กลับตอนโหลดแอปใหม่ → กดอัปเดตกลางงานก็ไม่หาย (เวลาเดินเครื่องนับต่อจากเวลาเริ่มจริง)
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (!draftLoadedRef.current) return;   // ยังไม่ผ่านขั้นกู้ draft — อย่าเพิ่งเขียนทับ
    try {
      // "กำลังทำงาน" = กด START แล้ว (timer เดิน / สแกน / เลือกจำนวน) — step ไม่ใช่ IDLE
      if (step === STEP.IDLE) { localStorage.removeItem(DRAFT_KEY); return; }   // จบ/ยกเลิก/บันทึกแล้ว → ล้าง draft
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1, step, materialLen, qty, status,
        unit, op, progress, dupCount,
        clientId: clientIdRef.current,
        startTs: startTsRef.current,        // เวลาเริ่มจริง → คำนวณเวลาเดินเครื่องต่อได้
        savedAt: Date.now(),
      }));
    } catch { /* localStorage เต็ม/ปิด — ข้าม (ไม่ทำแอปพัง) */ }
  }, [step, materialLen, qty, status, unit, op, progress, dupCount]);

  // กู้ draft ครั้งเดียวตอนเปิด (ก่อนเขียนทับ) — ถ้ามีงานค้างจากรอบก่อน
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const tooOld = d && d.savedAt && (Date.now() - d.savedAt > DRAFT_MAX_AGE_MS);
        if (d && d.v === 1 && d.step && d.step !== STEP.IDLE && !tooOld) {
          setMaterialLen(d.materialLen ?? "");
          setUnit(d.unit ?? null);
          setQty(Number(d.qty) || 0);
          setStatus(d.status ?? null);
          setProgress(d.progress ?? null);
          setDupCount(Number(d.dupCount) || 0);
          if (d.op) setOp(d.op);
          clientIdRef.current = d.clientId ?? null;
          if (d.startTs) startTsRef.current = d.startTs;   // เวลาเดินเครื่องต่อจากของเดิม (รวมช่วงรีโหลด)
          setStep(d.step);
          startTimer();   // เดินเวลาต่อทันที
          flash(t("กู้งานที่ค้างอยู่กลับมาแล้ว — ตรวจแล้วกด OK ได้เลย", "Restored your in-progress job — review and press OK"), "ok");
        } else if (tooOld) {
          localStorage.removeItem(DRAFT_KEY);   // เก่าเกิน → ทิ้ง
        }
      }
    } catch { /* ignore */ }
    draftLoadedRef.current = true;   // เปิดให้ effect เขียน draft ทำงานได้หลังจากนี้
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetAll(keepLen = false) {
    stopTimer(); setElapsed(0); setUnit(null); setProgress(null); setDupCount(0); setQty(0);
    if (!keepLen) setMaterialLen("");   // หลังบันทึกให้คงความยาววัสดุไว้ (งานชุดเดียวกันมักยาวเท่ากัน)
    setStatus(null); setStep(STEP.IDLE);
    clientIdRef.current = null;          // จบชิ้นนี้แล้ว → ครั้งหน้าเป็น client_id ใหม่
  }

  // ── START / STOP (RECORD) ───────────────────────────────────────────────
  // ต้องกรอกความยาววัสดุก่อน ถึงจะกด Start ได้
  const matReady = materialLen !== "" && Number(materialLen) > 0;
  const prevStepRef = useRef(STEP.REC);
  function onRecord() {
    if (step === STEP.IDLE) {
      if (!matReady) { flash("กรอกความยาววัสดุ (Material Length) ก่อน", "warn"); return; }
      startTimer();
      setStep(STEP.REC);
    } else if (step !== STEP.CANCEL) {
      // pressing RECORD again while active → ask to cancel (จำ step เดิมไว้กลับ)
      prevStepRef.current = step;
      setStep(STEP.CANCEL);
    }
  }
  function confirmCancel(yes) {
    if (yes) resetAll();
    else setStep(prevStepRef.current || STEP.REC);
  }

  // ── SCAN ──────────────────────────────────────────────────────────────
  // เสียงเตือน "ครั้งเดียว" ตอนสแกน/กดผิด (ไม่ค้าง ไม่วนซ้ำ)
  function errorBeep() { beep(320, 240, 0.32); vibrate([90, 60, 90]); }
  function okBeep() { beep(1180, 80, 0.20); vibrate(45); }         // เสียงสั้นสูง = บันทึกสำเร็จ (ต่างจาก error ชัดเจน)
  function tickBeep() { beep(880, 45, 0.14); }                     // เสียงเบาๆ = สแกนเจอชิ้นงาน

  function onScan() {
    if (step === STEP.IDLE) { flash("กด START ก่อนเริ่มสแกน", "warn"); return; }
    // ★ กด SCAN ซ้ำระหว่างกล้องเปิด (ยังไม่ได้สแกน) → ปิดกล้อง กลับไปหน้าจับเวลา (toggle)
    if (step === STEP.SCAN) { setStep(STEP.REC); return; }
    // เครื่องทำได้หลายขั้นตอน แต่ยังไม่เลือก → ต้องเลือกก่อน (กันบันทึกผิดขั้นตอน)
    if (machineOps.length > 1 && !op) { flash("เลือกขั้นตอน (ตัด/เจาะ/บาก) ก่อนสแกน", "warn"); return; }
    // มีชิ้นที่สแกนไว้แล้วแต่ยังไม่กด OK (เลือกสถานะ/จำนวนแล้ว) → เตือนก่อนทิ้ง กันนับขาด
    if (step === STEP.PART && unit && (status || qty > 1)) {
      if (!confirm(t("ยังไม่ได้กด OK บันทึกชิ้นที่สแกนไว้ — สแกนใหม่จะทิ้งค่าเดิม ยืนยันหรือไม่?",
                     "This scanned piece isn't saved yet — scanning again will discard it. Continue?"))) return;
    }
    warmAudio(); // ปลดล็อกเสียงบนมือถือ (ต้องมาจาก user gesture) เผื่อไว้ให้เสียงสแกนดังได้
    // ล้างค่าสแกนเดิมก่อนเสมอ — กันสถานะ/จำนวนของชิ้นก่อนหน้าติดมากับชิ้นใหม่
    // (เช่นเลือก Finished/qty 5 ที่ชิ้น A แล้วกด SCAN ต่อชิ้น B โดยไม่กด Cancel)
    // ★ ล้าง client_id ด้วย — สแกนชิ้นใหม่ = การบันทึกครั้งใหม่ ถ้าไม่ล้างจะ reuse ตัวเดิม
    //   (เคส: บันทึกชิ้น A พลาดแบบไม่ใช่เน็ต แต่ DB commit แล้ว → กด SCAN ชิ้น B → B โดน dedup หาย)
    clientIdRef.current = null;
    setUnit(null); setProgress(null); setDupCount(0); setQty(0); setStatus(null);
    setStep(STEP.SCAN);
  }
  function closeScan() { setStep(STEP.REC); } // ปิดกล้อง กลับไปหน้ากำลังจับเวลา
  // Cancel หลังสแกน → กลับไปสแกนใหม่ (เวลาเดินต่อเนื่องอยู่แล้ว ไม่ต้อง start ใหม่)
  function rescan() { clientIdRef.current = null; setUnit(null); setProgress(null); setDupCount(0); setQty(0); setStatus(null); setStep(STEP.SCAN); }
  // แสดงชิ้นงานที่ระบุได้แล้ว (ใช้ร่วมกันทั้งสแกน QR / พิมพ์เบอร์ / เลือก release)
  // สแกนเสร็จ = เวลายังเดินต่อ (ไม่หยุด) — โชว์ป้ายตัวใหม่ + running number
  //   done = จำนวนที่ "เครื่องนี้ (ขั้นตอนนี้)" ทำไปแล้วของรีลีสนี้ · total = จำนวนสั่งทั้งใบ
  //   ★ H1: ต้องรู้ "ขั้นตอน (operation)" ถึงจะนับเลขวิ่งถูก — ถ้าไม่รู้ โชว์เป็นไม่ทราบ
  async function showScannedUnit(u) {
    tickBeep();   // เสียงเบายืนยันว่าเจอชิ้นงาน
    const opId = op?.id || user.operation?.id || null;
    const done = opId ? await getReleaseProgress(u.release_id, opId) : null;
    const dup = opId ? await countUnitOpRecords(u.id, opId) : 0;   // เตือน rework (0 เมื่อออฟไลน์)
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    setDupCount(dup);
    setProgress({ done, total: u.release?.qty ?? null, offline, noOp: !opId });
    setUnit(u);
    if (qty === 0) setQty(1);
    setStep(STEP.PART);
  }
  // สแกน QR (จากกล้อง) — ถ้าอ่านได้เป็นเบอร์พาร์ท ลอง fallback หา 1 ตัว (กล้องเดี่ยวไม่มี UI ให้เลือก)
  // คืน true=พบ, false=ไม่พบ
  async function onDecoded(qr) {
    if (!qr) return false;
    setBusy(true);
    let u = await findUnitByQr(qr);
    if (!u) u = await findUnitByPartNo(qr);
    if (!u) { setBusy(false); errorBeep(); flash("ไม่พบ QR/เบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง", "warn"); return false; }
    setBusy(false);
    await showScannedUnit(u);
    return true;
  }
  // พิมพ์เบอร์พาร์ท/QR ในช่องกรอก — ถ้าเบอร์พาร์ทตรงกับ "หลาย release" ให้เลือกก่อน (กันลงผิดใบ)
  // คืน { ok:true } เมื่อระบุได้เลย · { ok:false, choose:[units] } เมื่อต้องเลือก release · { ok:false } เมื่อไม่พบ
  async function onManualEntry(text) {
    const s = String(text || "").trim();
    if (!s) return { ok: false };
    setBusy(true);
    // 1) เผื่อพิมพ์เป็น QR (unique) → ระบุชิ้นเจาะจงได้เลย
    let u = await findUnitByQr(s);
    if (u) { setBusy(false); await showScannedUnit(u); return { ok: true }; }
    // 2) เป็นเบอร์พาร์ท → หา release ผู้สมัครทั้งหมด
    const cands = await findReleaseCandidatesByPartNo(s);
    setBusy(false);
    if (!cands.length) { errorBeep(); flash("ไม่พบเบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง", "warn"); return { ok: false }; }
    if (cands.length === 1) { await showScannedUnit(cands[0]); return { ok: true }; }
    // มีหลาย release → ให้คนงานเลือก (กันลงผิดใบ)
    return { ok: false, choose: cands };
  }
  // คนงานเลือก release จากตัวเลือกแล้ว → ใช้ชิ้นตัวแทนของ release นั้น
  async function onPickUnit(u) { if (u) { setBusy(false); await showScannedUnit(u); } }

  // กด OK = บันทึกทันที (ไม่ต้องกด SAVE อีก)
  function confirmPart() {
    if (!status) { flash("เลือกสถานะ In Process หรือ Finished", "warn"); return; }
    if (qty <= 0) { flash("ระบุจำนวนมากกว่า 0", "warn"); return; }
    if (!Number.isInteger(qty)) { flash("จำนวนต้องเป็นจำนวนเต็ม", "warn"); return; }
    if (qty > 100000) { flash("จำนวนมากเกินไป (สูงสุด 100,000/ครั้ง)", "warn"); return; }
    // จำนวนมากผิดปกติในครั้งเดียว — ให้ยืนยันกันพิมพ์เกิน (เช่น 100 กลายเป็น 1000)
    if (qty > 2000 && !confirm(t(`จำนวน ${qty.toLocaleString()} ชิ้นในการบันทึกครั้งเดียว มากผิดปกติ — ยืนยันหรือไม่?`,
                                 `${qty.toLocaleString()} pieces in a single record is unusually large — confirm?`))) return;
    // ชิ้นนี้เคยทำขั้นตอนนี้ไปแล้ว → ยืนยันกันสแกนซ้ำโดยไม่ตั้งใจ (ยอมได้ถ้าเป็น rework จริง)
    if (dupCount > 0 && !confirm(t(`ชิ้นนี้เคยบันทึกขั้นตอนนี้ไปแล้ว ${dupCount} ครั้ง — ยืนยันทำซ้ำ (rework) หรือไม่?`,
                                   `This piece already recorded this step ${dupCount}× — confirm rework?`))) return;
    doSave();
  }

  // ── บันทึก (เรียกจากปุ่ม OK) ─────────────────────────────────────────────
  async function doSave() {
    if (savingRef.current) return;      // กันกด OK รัวๆ → บันทึกซ้ำ (re-entrancy)
    savingRef.current = true;
    setBusy(true);
    // สร้าง client_id ครั้งเดียวต่อการบันทึกชิ้นนี้ · ถ้ากด OK ซ้ำ (retry หลังพลาด) ใช้ตัวเดิม
    // → ฝั่ง DB dedup ด้วย client_id ได้ กันบันทึกซ้ำแม้ error ที่ไม่ใช่เน็ต (เช่น insert สำเร็จแต่ตอบกลับพลาด)
    if (!clientIdRef.current) {
      clientIdRef.current = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
    try {
      // น้ำหนักต่อชิ้น (mirror ฝั่งเซิร์ฟเวอร์: unit.weight ?? part_master.unit_weight) → เก็บลงคิวไว้โชว์ยอดออฟไลน์
      const wpp = Number(unit.weight ?? unit.part_master?.unit_weight ?? 0) || 0;
      const res = await recordMachineWork({
        qr: unit.qr_code,
        quantity: qty,
        materialLengthMm: materialLen === "" ? null : Number(materialLen),
        processSeconds: elapsed,
        status,
        releaseId: unit.release_id,   // ใช้คำนวณ running number ตอนออฟไลน์
        operationId: op?.id || null,  // ★ ขั้นตอนที่เลือกบนจอ
        clientId: clientIdRef.current, // ★ คงเดิมตอน retry
        weight: qty * wpp,            // ★ ยอดน้ำหนักงานนี้ (ไว้บวกยอดรวมออฟไลน์)
      });
      if (!res || res.ok === false) {
        errorBeep();        // บันทึกผิดพลาด = เตือนครั้งเดียว
        flash(res?.message || "บันทึกไม่สำเร็จ", "warn");
        setStep(STEP.PART); // กลับไปหน้าจำนวน/สถานะ ให้กด OK ลองใหม่ได้
        return;
      }
      setStorageFull(false);   // บันทึก/เข้าคิวได้แล้ว = ที่เก็บไม่เต็มแล้ว
      if (res.queued) {
        okBeep();
        flash("เน็ตสะดุด — เก็บเข้าคิวแล้ว จะซิงค์ให้อัตโนมัติ", "ok");
        resetAll(true);        // เก็บความยาววัสดุไว้ (มักเท่าเดิมทั้งชุด)
        return;
      }
      // update table + daily from server response
      if (res.daily) setDaily(res.daily);
      if (res.row) {
        setRows((rs) => [...rs, res.row]);
        setNewRowId(res.row.id || `${Date.now()}`);
      } else {
        reload();
      }
      okBeep();                // ★ เสียง+สั่นยืนยันสำเร็จ (เดิมสำเร็จเงียบ คนงานไม่รู้ว่าบันทึกแล้ว)
      flash("บันทึกแล้ว ✓ พร้อมงานถัดไป", "ok");
      resetAll(true);          // เก็บความยาววัสดุไว้ ไม่ต้องกรอกใหม่ทุกชิ้น
    } finally {
      setBusy(false);
      savingRef.current = false;
    }
  }

  // ล็อกตารางไว้ที่ 6 แถว (สูง = หัวตาราง + 6 แถว) เกินกว่านั้นเลื่อนดูของเก่าได้
  // แถวใช้ฟอนต์ vh (ปรับตามจอ) จึงวัดความสูงจริงด้วย JS แล้วตั้ง maxHeight ให้ตรง 6 แถวเป๊ะ
  const tableRef = useRef(null);
  const ROWS_VISIBLE = 6;
  const lockTableHeight = useCallback(() => {
    const el = tableRef.current; if (!el) return;
    const table = el.querySelector("table.stn-rec"); if (!table) return;
    const thead = table.querySelector("thead");
    const bodyRows = table.querySelectorAll("tbody tr");
    if (bodyRows.length > ROWS_VISIBLE) {
      const headH = thead ? thead.offsetHeight : 0;
      let rowsH = 0;
      for (let i = 0; i < ROWS_VISIBLE; i++) rowsH += bodyRows[i].offsetHeight || 0;
      el.style.maxHeight = (headH + rowsH + 2) + "px";   // +2 กันเส้นขอบล่างโดนตัด
    } else {
      el.style.maxHeight = "";                            // ≤ 6 แถว → ไม่ต้องล็อก
    }
  }, []);
  useEffect(() => {
    lockTableHeight();
    if (tableRef.current) tableRef.current.scrollTop = tableRef.current.scrollHeight;   // เลื่อนไปแถวล่าสุด
  }, [rows, lockTableHeight]);
  // จอหมุน/เปลี่ยนขนาด → ฟอนต์ vh เปลี่ยน ต้องคำนวณความสูงใหม่
  useEffect(() => {
    const on = () => lockTableHeight();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, [lockTableHeight]);

  const recording = step !== STEP.IDLE;
  const scanArmed = qty > 0 && !!unit;

  return (
    <div className="stn-shell">
      {/* แถบสถานะเน็ต — โชว์เมื่อ "ออฟไลน์" หรือมีงาน "ค้างซิงค์" (ออนไลน์กำลังดันขึ้น) */}
      {(!online || pending > 0) && (
        <div className={`stn-netbar${online ? " syncing" : " offline"}`}>
          {!online ? (
            <span>📴 {t("ออฟไลน์", "Offline")}
              {pending > 0
                ? ` · ${t("ค้างซิงค์", "pending sync")} ${pending} ${t("ชิ้น", "pcs")}`
                : ` · ${t("ทำงานต่อได้ตามปกติ", "you can keep working")}`}
            </span>
          ) : (
            <span>🔄 {t("กำลังซิงค์งานค้าง", "Syncing")} · {pending} {t("ชิ้น", "pcs")}</span>
          )}
        </div>
      )}
      {storageFull && (
        <div className="stn-rejected" onClick={() => setStorageFull(false)}
          style={{ background: "#b91c1c" }}
          title={t("ที่เก็บข้อมูลในเครื่องเต็ม", "Device storage full")}>
          ⛔ {t("ที่เก็บข้อมูลเต็ม — งานอาจไม่ถูกบันทึก! ปิดแอปอื่น/ล้างข้อมูลเบราว์เซอร์ แล้วลองใหม่ · แจ้งผู้ดูแล (แตะเพื่อซ่อน)",
                "Storage full — work may not be saved! Close other apps / clear browser data, then retry · notify admin (tap to hide)")}
        </div>
      )}
      {rejected > 0 && (
        <button type="button" className="stn-rejected" onClick={() => setShowRejected(true)}
          title={t("แตะเพื่อจัดการคิวที่ซิงค์ไม่สำเร็จ", "Tap to manage failed-sync queue")}>
          ⚠️ {t("ซิงค์ไม่สำเร็จ", "Failed to sync")} {rejected} {t("ชิ้น", "pcs")} — {t("แตะเพื่อจัดการ", "tap to manage")}
        </button>
      )}
      {showRejected && (
        <RejectedPanel t={t} onClose={() => setShowRejected(false)}
          onRetry={() => { retryRejected(); setShowRejected(false); flash(t("กำลังลองซิงค์ใหม่…", "Retrying sync…"), "ok"); }}
          onClear={() => { clearRejected(); setShowRejected(false); flash(t("ล้างคิวที่ซิงค์ไม่สำเร็จแล้ว", "Cleared failed-sync queue"), "ok"); }} />
      )}

      {/* ── ปุ่มเลือกขั้นตอน — โชว์เฉพาะเครื่องที่ทำได้หลายขั้นตอน ─────────────── */}
      {machineOps.length > 1 && (
        <div className="stn-oppick">
          <span className="stn-oppick-lbl">ขั้นตอน:</span>
          {machineOps.map((o) => (
            <button key={o.id}
              className={`stn-oppick-btn${op?.id === o.id ? " sel" : ""}`}
              onClick={() => setOp(o)}>
              {o.name}
            </button>
          ))}
          {!op && <span className="stn-oppick-hint">← แตะเลือกก่อนสแกน</span>}
        </div>
      )}
      {machineOps.length === 1 && (
        <div className="stn-oppick one"><span className="stn-oppick-lbl">ขั้นตอน:</span>
          <span className="stn-oppick-btn sel" style={{ pointerEvents: "none" }}>{machineOps[0].name}</span>
        </div>
      )}

      <div className="stn-screen">
        {/* top-left: machine code */}
        <div className="stn-cell stn-code" style={{ position: "relative" }}>
          {/* ปุ่มออกจากระบบมุมบนซ้าย — โผล่เฉพาะมือถือจอเล็ก (แท็บเล็ตใช้ปุ่มใหญ่ด้านล่าง) */}
          <button className="stn-logout stn-toplogout" onClick={onLogout} title="ออกจากระบบ" aria-label="ออกจากระบบ">⏻ ออก</button>
          <StnLangToggle />
          {/* ซ่อนปุ่มเต็มจอเมื่อเปิดแบบติดตั้ง (PWA standalone — รวม iPad/iOS) */}
          {!isStandalone() && (
            <button className="stn-logout stn-fs" onClick={toggleFullscreen} title="เต็มจอ" aria-label="เต็มจอ">⛶ เต็มจอ</button>
          )}
          {machine ? machine.code : "— ไม่มีเครื่อง —"}
        </div>

        {/* top-right: records table */}
        <div className="stn-table" ref={tableRef}>
          <table className="stn-rec">
            <thead>
              <tr>
                <th>{t("วันที่", "DATE")}</th>
                <th className="stn-hide-sm">MDF&nbsp;NO.</th><th className="stn-hide-sm">REL&nbsp;NO.</th><th>PART&nbsp;NO.</th><th className="stn-hide-sm">REV.</th>
                <th>QTY.</th><th>REQ.</th><th>PROCESS /<br />REQUIRED</th><th>BALANCE</th>
                <th className="stn-hide-sm">LENGTH<br />[mm]</th><th className="stn-hide-sm">WEIGHT<br />[kg]</th><th>MATERIALS<br />LENGTH</th>
                <th className="stn-hide-sm">INVENTORY<br />CODE</th><th className="stn-hide-sm">PROCESS<br />TIME</th><th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr className="stn-empty-row"><td colSpan={15}>{t("ยังไม่มีบันทึกสัปดาห์นี้ — เริ่มงานแรกได้เลย", "No records this week — start your first job")}</td></tr>
              )}
              {rows.map((r, i) => {
                const fin = String(r.status).toLowerCase() === "finished";
                const isNew = (r.id && r.id === newRowId);
                return (
                  <tr key={r.id || i} className={`${isNew ? "stn-new" : ""}${r.pending ? " stn-pending-row" : ""}`}
                    title={r.pending ? "ยังไม่ซิงค์ — รอเน็ตกลับมา" : undefined}>
                    <td className="stn-mono">{r.day || todayMD()}</td>
                    <td className="stn-hide-sm">{r.mdf_no || "-"}</td>
                    <td className="stn-hide-sm">{r.rel_no || "-"}</td>
                    <td className="l">{r.part_no || "-"}</td>
                    <td className="stn-hide-sm">{r.rev || "-"}</td>
                    <td>{fmt(r.qty)}</td>
                    <td>{r.req != null ? fmt(r.req) : "-"}</td>
                    <td>{r.process_cum != null && r.req != null
                      ? `${fmt(r.process_cum)}/${fmt(r.req)}` : "-"}</td>
                    {/* BALANCE = ยอดสะสมที่ทำแล้ว (PROCESS) − REQ · ติดลบ = ยังไม่ครบจำนวนสั่ง · เป็น + = ทำเกิน (สแปร์) */}
                    <td className={r.process_cum != null && r.req != null && (r.process_cum - r.req) >= 0 ? "stn-st-fin" : ""}>
                      {r.process_cum != null && r.req != null
                        ? ((r.process_cum - r.req) > 0 ? `+${fmt(r.process_cum - r.req)}` : fmt(r.process_cum - r.req))
                        : "-"}</td>
                    <td className="stn-hide-sm">{r.length_mm != null ? fmt(r.length_mm) : "-"}</td>
                    <td className="stn-hide-sm">{r.weight != null ? fmt(r.weight) : "-"}</td>
                    {/* MATERIALS LENGTH สั้นกว่า LENGTH ของชิ้น → วัสดุไม่พอ ขึ้นสีแดง (Number() กันค่าเป็น string) */}
                    <td style={r.materials_length != null && r.length_mm != null && Number(r.materials_length) < Number(r.length_mm)
                        ? { color: "var(--st-red, #e11d1d)", fontWeight: 700 } : undefined}
                      title={r.materials_length != null && r.length_mm != null && Number(r.materials_length) < Number(r.length_mm)
                        ? t("ความยาววัสดุสั้นกว่าความยาวชิ้นงาน", "Material shorter than the part length") : undefined}>
                      {r.materials_length != null ? fmt(r.materials_length) : "-"}</td>
                    <td className="l stn-hide-sm">{r.inventory_code || "-"}</td>
                    <td className="stn-hide-sm">{hms(r.process_seconds)}</td>
                    <td className={fin ? "stn-st-fin" : "stn-st-inp"}>
                      {fin ? t("เสร็จแล้ว", "Finished") : t("กำลังทำ", "In Process")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* bottom-left: daily report */}
        <div className="stn-daily">
          <div className="stn-daily-head">
            <h2>{t("รายงานประจำวัน", "DAILY REPORT")}</h2>
            <div className="stn-date">{todayISOdate()}</div>
          </div>
          <div className="stn-kpis">
            <div className="stn-kpi"><div className="lbl">{t("จำนวนวันนี้", "Daily Quantity")}</div>
              <div className="val">{fmt(daily.quantity)} {t("ชิ้น", "pcs")}</div></div>
            <div className="stn-kpi"><div className="lbl">{t("น้ำหนักวันนี้", "Daily Weight")}</div>
              <div className="val">{fmt(daily.weight)} {t("กก.", "kg")}</div></div>
            <div className="stn-kpi"><div className="lbl">{t("เวลาเดินเครื่องวันนี้", "Daily Process Time")}</div>
              <div className="val mono">{hms(daily.process_seconds)}</div></div>
          </div>
          {loadErr && <div className="stn-err">{loadErr}</div>}
        </div>

        {/* bottom-right: work area + control */}
        <div className="stn-work-wrap">
          <div className="stn-work-area">
            <WorkArea
              step={step} elapsed={elapsed} unit={unit} progress={progress} qty={qty} setQty={setQty}
              status={status} setStatus={setStatus} busy={busy}
              onDecoded={onDecoded} onManualEntry={onManualEntry} onPickUnit={onPickUnit}
              confirmCancel={confirmCancel} confirmPart={confirmPart}
              closeScan={closeScan} rescan={rescan} dupCount={dupCount}
            />
            {toast && <div className={`stn-toast ${toast.tone}`}>{toast.text}</div>}
          </div>

          <div className="stn-control">
            <div className="stn-ctl-main">
              <div className={`stn-clock${recording ? " live" : ""}`}>{hms(elapsed)}</div>
              <div className={`stn-mat${recording ? " live" : ""}`}
                style={step === STEP.IDLE && !matReady ? { outline: "2px solid #f59e0b", outlineOffset: 2, borderRadius: 8 } : undefined}>
                <div className="lbl">{t("ความยาววัสดุ", "Material Length")} {step === STEP.IDLE && !matReady ? t("· กรอกก่อน", "· fill first") : ""}</div>
                <input
                  inputMode="numeric" disabled={recording}
                  value={materialLen} placeholder="0"
                  onChange={(e) => setMaterialLen(e.target.value.replace(/[^\d.]/g, ""))}
                />
              </div>
              {/* START ไม่ disable เพราะ !matReady — ปล่อยให้กดได้แล้ว flash บอกเหตุผล (เดิมกดไม่ได้เงียบ) */}
              <button className={`stn-ctl-btn${recording ? " recording" : ""}`} onClick={onRecord}
                disabled={busy}>
                <span>{recording ? t("ยกเลิก", "CANCEL") : t("เริ่ม", "START")}</span><span className="stn-rec-dot" />
              </button>
              <button className={`stn-ctl-btn stn-scan-cell${scanArmed ? " armed" : ""}${step === STEP.SCAN ? " scanning" : ""}`} onClick={onScan} disabled={busy}>
                <div className="row1">
                  <span>{step === STEP.SCAN ? t("ปิดกล้อง", "CLOSE") : t("สแกน", "SCAN")}</span>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16" /></svg>
                </div>
                <div className="qty">{step === STEP.SCAN ? t("กดซ้ำเพื่อปิดกล้อง", "tap again to close") : <>{t("จำนวน", "Quantity")} <b>{qty}</b> {t("ชิ้น", "piece")}</>}</div>
              </button>
            </div>
            <button className="stn-ctl-btn stn-exit" onClick={onLogout}>
              <span>{t("ออกจากระบบ", "Log out")}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Ambient animation: คนแบกอลูมิเนียมเดินไปวางบนเครื่องตัด (ซ้าย→ขวา) ────────
function StationAnim() {
  return (
    <svg className="stn-scene" viewBox="0 0 460 200" role="img"
      aria-label="พนักงานยกอลูมิเนียมไปวางบนเครื่องตัด">
      <defs>
        <linearGradient id="stnAlu" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f5f8" />
          <stop offset="0.45" stopColor="#cdd3da" />
          <stop offset="1" stopColor="#a6adb6" />
        </linearGradient>
        <linearGradient id="stnSteel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef1f4" />
          <stop offset="0.5" stopColor="#c2c8d0" />
          <stop offset="1" stopColor="#9aa0a8" />
        </linearGradient>
      </defs>

      {/* ground */}
      <line x1="0" y1="176" x2="460" y2="176" stroke="#e2e6ea" strokeWidth="2" />

      {/* ── เครื่องตัด (ขวา) ─────────────────────────── */}
      <g>
        <rect x="304" y="159" width="8" height="18" rx="1" fill="#1c2126" />
        <rect x="410" y="159" width="8" height="18" rx="1" fill="#1c2126" />
        <rect x="296" y="150" width="130" height="9" rx="3" fill="#2a3138" />
        <circle cx="308" cy="150" r="4.5" fill="#6b727a" />
        <circle cx="330" cy="150" r="4.5" fill="#6b727a" />
        <circle cx="396" cy="150" r="4.5" fill="#6b727a" />
        <circle cx="416" cy="150" r="4.5" fill="#6b727a" />
        <rect x="350" y="98" width="54" height="38" rx="7" fill="#2a3138" />
        <line x1="358" y1="107" x2="396" y2="107" stroke="#565d64" strokeWidth="2" />
        <line x1="358" y1="113" x2="396" y2="113" stroke="#565d64" strokeWidth="2" />
        <line x1="358" y1="119" x2="396" y2="119" stroke="#565d64" strokeWidth="2" />
        <rect x="372" y="130" width="8" height="16" fill="#2a3138" />
        <path d="M353 150 A23 23 0 0 1 399 150 L392 150 A16 16 0 0 0 360 150 Z" fill="#f5920b" />
        <g className="stn-saw">
          <circle cx="376" cy="150" r="20" fill="url(#stnSteel)" stroke="#1c2126" strokeWidth="2" />
          <circle cx="376" cy="150" r="20" fill="none" stroke="#1c2126" strokeWidth="3" strokeDasharray="3 5.5" />
          <line x1="376" y1="134" x2="376" y2="166" stroke="#aeb4bb" strokeWidth="2" />
          <line x1="360" y1="150" x2="392" y2="150" stroke="#aeb4bb" strokeWidth="2" />
          <line x1="365" y1="139" x2="387" y2="161" stroke="#aeb4bb" strokeWidth="1.5" />
          <line x1="387" y1="139" x2="365" y2="161" stroke="#aeb4bb" strokeWidth="1.5" />
          <circle cx="376" cy="150" r="5" fill="#e11d1d" />
        </g>
      </g>

      {/* ── อลูมิเนียม (เดินมากับคน แล้ววางบนเครื่อง) ── */}
      <g className="stn-carry">
        <rect x="86" y="105" width="150" height="12" rx="6" fill="url(#stnAlu)" stroke="#9aa0a8" strokeWidth="1" />
        <rect x="86" y="105" width="7" height="12" rx="3" fill="#9098a1" />
        <rect x="229" y="105" width="7" height="12" rx="3" fill="#9098a1" />
        <rect x="94" y="107.5" width="132" height="2.4" rx="1.2" fill="#ffffff" opacity="0.75" />
        <g className="stn-shine"><rect x="96" y="106" width="12" height="10" rx="2" fill="#ffffff" opacity="0.9" transform="skewX(-18)" /></g>
      </g>

      {/* ── ประกายไฟตอนตัด (บนสุด) ── */}
      <g className="stn-spark">
        <path d="M366 150 l3.5 -9 3.5 9 9 3.5 -9 3.5 -3.5 9 -3.5 -9 -9 -3.5 z" fill="#ffb02e" />
        <line x1="366" y1="150" x2="352" y2="162" stroke="#ff8a1e" strokeWidth="2" strokeLinecap="round" />
        <line x1="366" y1="150" x2="356" y2="166" stroke="#ffb02e" strokeWidth="2" strokeLinecap="round" />
        <line x1="366" y1="150" x2="348" y2="156" stroke="#ff8a1e" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="350" cy="164" r="1.6" fill="#ffd27a" />
        <circle cx="345" cy="158" r="1.4" fill="#ffd27a" />
      </g>

      {/* ── พนักงาน (เดินซ้าย→ขวา, ตัวเด้ง, ก้มวางของ) ── */}
      <g className="stn-walker"><g className="stn-bob">
        <ellipse cx="62" cy="178" rx="24" ry="4" fill="rgba(0,0,0,.12)" />
        <g className="stn-leg1">
          <rect x="55" y="138" width="8" height="28" rx="4" fill="#1c2126" />
          <rect x="55" y="163" width="15" height="6" rx="3" fill="#14181c" />
        </g>
        <g className="stn-leg2">
          <rect x="55" y="138" width="8" height="28" rx="4" fill="#2a3138" />
          <rect x="55" y="163" width="15" height="6" rx="3" fill="#20262b" />
        </g>
        <rect x="51" y="103" width="19" height="40" rx="8" fill="#232a31" />
        <rect x="51" y="120" width="19" height="4" fill="#eef2f5" opacity="0.85" />
        <rect x="58" y="103" width="4" height="40" fill="#eef2f5" opacity="0.5" />
        <g className="stn-arm">
          <rect x="58" y="110" width="47" height="8" rx="4" fill="#2a3138" />
          <circle cx="104" cy="114" r="5" fill="#e8b98f" />
        </g>
        <rect x="56" y="99" width="8" height="6" fill="#e8b98f" />
        <circle cx="60" cy="92" r="10" fill="#e8b98f" />
        <path d="M50 90 Q60 76 70 90 Z" fill="#f5920b" />
        <rect x="47" y="88" width="27" height="4" rx="2" fill="#f5920b" />
        <path d="M60 78 L60 90" stroke="#d97a00" strokeWidth="1.5" />
      </g></g>
    </svg>
  );
}

// ── the changing middle panel ─────────────────────────────────────────────
function WorkArea({ step, elapsed, unit, progress, qty, setQty, status, setStatus, busy, onDecoded, onManualEntry, onPickUnit, confirmCancel, confirmPart, closeScan, rescan, dupCount = 0 }) {
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);
  if (step === STEP.IDLE) {
    return (
      <div className="stn-hint">
        <div style={{ marginBottom: 8 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b6bcc4" strokeWidth="1.6"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16" /></svg>
        </div>
        {t(<>พร้อมเริ่มงาน — กรอก <b>MATERIAL LENGTH</b><br />แล้วกด <b>START</b> เพื่อเริ่มจับเวลา</>,
           <>Ready — enter <b>MATERIAL LENGTH</b><br />then press <b>START</b> to begin timing</>)}
      </div>
    );
  }
  if (step === STEP.REC) {
    return (
      <div>
        <StationAnim />
        <div className="stn-hint">
          <div className="big">{t("● กำลังบันทึกเวลา", "● Recording time")}</div>
          {t(<>กด <b>SCAN</b> เพื่อสแกนชิ้นงาน</>, <>Press <b>SCAN</b> to scan a piece</>)}
        </div>
      </div>
    );
  }
  if (step === STEP.CANCEL) {
    return (
      <div className="stn-confirm">
        <h3>{t("ยกเลิกการบันทึก?", "Cancel recording?")}</h3>
        <p>{t(`เวลาที่จับไว้ (${hms(elapsed)}) จะถูกล้างและเริ่มใหม่`,
              `The elapsed time (${hms(elapsed)}) will be cleared and restarted`)}</p>
        <div className="stn-row-btns">
          <button className="stn-pill yes" onClick={() => confirmCancel(true)}>{t("ใช่", "YES")}</button>
          <button className="stn-pill no" onClick={() => confirmCancel(false)}>{t("ไม่", "NO")}</button>
        </div>
      </div>
    );
  }
  if (step === STEP.SCAN) {
    return <CameraScan onDecoded={onDecoded} onManualEntry={onManualEntry} onPickUnit={onPickUnit} busy={busy} onClose={closeScan} />;
  }
  if (step === STEP.PART) {
    const p = unit?.part_master || {};
    const proj = p.projects || {};
    const rel = unit?.release || {};
    // running number ของป้ายตัวใหม่: เริ่มจาก (ทำไปแล้ว + 1) OF จำนวนทั้งใบ
    // นับ "แยกตามขั้นตอนของเครื่องนี้" (เจาะ/ตัด/บาก แยกกัน) — ดู getReleaseProgress
    const total = progress?.total ?? rel.qty ?? null;
    const noOp = !!progress?.noOp;                 // ไม่รู้ขั้นตอนของเครื่อง → ไม่โชว์เลขวิ่งที่อาจหลอก
    const done = progress?.done ?? 0;
    const startNo = done + 1;
    const endNo = done + Math.max(1, qty || 1);
    // เลขลำดับป้ายสะสม (ไม่ใช่ progress) — ใส่ "#" + คำว่า "ลำดับ" กำกับ กันเข้าใจผิดว่าเป็นยอดทำ/ยอดสั่ง
    const ofText = noOp
      ? (total != null ? `— of ${fmt(total)}` : "—")
      : (total != null
          ? `#${fmt(startNo)}${endNo > startNo ? `–${fmt(endNo)}` : ""} of ${fmt(total)}`
          : `#${fmt(startNo)}${endNo > startNo ? `–${fmt(endNo)}` : ""}`);
    // ทำเกินจำนวนสั่งแล้ว → บันทึกต่อได้ปกติ (เช่น ตัดเผื่อเป็นสแปร์ หรือกลับไปเจาะเพิ่ม)
    const isOver = !noOp && total != null && done >= total;
    return (
      <div className="stn-part-panel">
        {/* ป้ายกำกับตัวใหม่ (โครงเดียวกับป้ายพิมพ์ 76×12) + running number */}
        <div className="stn-part-label">
          <div className="stn-lbl-qr" />
          <div className="stn-lbl-body">
            <div className="stn-lbl-col left">
              <div className="stn-lbl-num">{proj.code || "-"}</div>
              <div className="stn-lbl-name">{proj.name || "-"}</div>
              <div className="stn-lbl-part">{p.part_no || "-"}</div>
              {p.material ? <div className="stn-lbl-mat">{p.material}</div> : null}
            </div>
            <div className="stn-lbl-vline" />
            <div className="stn-lbl-col right">
              <div className="stn-lbl-kv">
                <span className="k">MDF NO.</span><span className="v">{p.mdf_no || "-"}</span>
                <span className="k">REL NO.</span><span className="v">{rel.release_order || "-"}</span>
                {p.rev ? <><span className="k">REV.</span><span className="v">{p.rev}</span></> : null}
              </div>
              <div className="stn-lbl-of">
                <span style={{ fontSize: "0.62em", opacity: 0.7, fontWeight: 400, letterSpacing: 0 }}>{t("ลำดับ", "No.")} </span>
                {progress?.offline ? `~${ofText}` : ofText}
              </div>
              {/* ไม่แจ้งเตือนเมื่อสแกนเกินจำนวนสั่ง (REQ) — บันทึกต่อได้ปกติ (สแปร์/เพิ่ม) */}
              {dupCount > 0 ? <div className="stn-lbl-dup">{t(`⚠ ชิ้นนี้เคยทำขั้นตอนนี้แล้ว ${dupCount} ครั้ง`, `⚠ This piece already ran this step ${dupCount}×`)}</div> : null}
              {progress?.offline ? <div className="stn-lbl-approx">{t("ประมาณการ · ออฟไลน์", "estimate · offline")}</div> : null}
            </div>
          </div>
        </div>
        <div className="stn-qty-lbl">{t("จำนวน", "QUANTITY")}</div>
        <div className="stn-qty-stepper">
          <button onClick={() => setQty(Math.max(0, qty - 1))}>−</button>
          <input inputMode="numeric" value={qty}
            onChange={(e) => setQty(Math.min(100000, Math.max(0, parseInt(e.target.value || "0", 10) || 0)))} />
          <button onClick={() => setQty(Math.min(100000, qty + 1))}>+</button>
        </div>
        <div className="stn-row-btns stn-status-row">
          <button className={`stn-pill ${status === "inprocess" ? "sel-inp" : ""}`} onClick={() => setStatus("inprocess")}>{t("กำลังทำ", "In Process")}</button>
          <button className={`stn-pill ${status === "finished" ? "sel-fin" : ""}`} onClick={() => setStatus("finished")}>{t("เสร็จแล้ว", "Finished")}</button>
        </div>
        <div className="stn-row-btns">
          <button className="stn-pill no" onClick={rescan} disabled={busy}>{t("ยกเลิก", "Cancel")}</button>
          <button className="stn-pill ok" onClick={confirmPart} disabled={!status || qty <= 0 || busy}>{busy ? "..." : "OK"}</button>
        </div>
      </div>
    );
  }
  return null;
}

// ── Camera QR scanner (rear camera + jsQR) with manual fallback ────────────
function CameraScan({ onDecoded, onManualEntry, onPickUnit, busy, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);   // แคนวาสวาดกรอบขาวทับ QR ที่เจอ
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [manual, setManual] = useState("");
  const [err, setErr] = useState("");
  const [pickList, setPickList] = useState(null);   // [units] ให้เลือก release เมื่อเบอร์พาร์ทตรงหลายใบ
  const [camOn, setCamOn] = useState(true);    // ★ กด SCAN → กล้องเปิดทันที · ขอสิทธิ์ไปแล้วครั้งเดียว จึงไม่ถามซ้ำ (กด "พักกล้อง" ปิดชั่วคราวได้)
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);
  const trackRef = useRef(null);
  const [zoom, setZoom] = useState(null);      // { min, max, step, value } หรือ null ถ้ากล้องไม่รองรับซูม
  const pinchRef = useRef(null);               // จับระยะ 2 นิ้ว (pinch zoom)
  const [focusRing, setFocusRing] = useState(null);  // { x, y } จุดที่แตะโฟกัส (px ในกรอบกล้อง)
  function applyZoom(v) {
    const val = Number(v);
    setZoom((z) => (z ? { ...z, value: val } : z));
    try { trackRef.current?.applyConstraints({ advanced: [{ zoom: val }] }); } catch { /* กล้องไม่รองรับ */ }
  }
  const _touchDist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
  function camTouchStart(e) {
    if (e.touches.length === 2 && zoom) pinchRef.current = { d0: _touchDist(e.touches), z0: zoom.value };
  }
  function camTouchMove(e) {
    if (e.touches.length === 2 && zoom && pinchRef.current) {
      e.preventDefault();
      const ratio = _touchDist(e.touches) / pinchRef.current.d0;
      let v = pinchRef.current.z0 + (ratio - 1) * (zoom.max - zoom.min);   // กางนิ้ว = ซูมเข้า
      v = Math.max(zoom.min, Math.min(zoom.max, v));
      applyZoom(v);
    }
  }
  function camTouchEnd() { pinchRef.current = null; }
  // แตะเพื่อโฟกัสจุดที่แตะ (best-effort — กล้องที่ไม่รองรับจะเงียบไว้)
  async function tapFocus(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX ?? e.changedTouches?.[0]?.clientX) - box.left;
    const py = (e.clientY ?? e.changedTouches?.[0]?.clientY) - box.top;
    setFocusRing({ x: px, y: py });
    setTimeout(() => setFocusRing(null), 800);
    try {
      const track = trackRef.current; if (!track) return;
      const caps = track.getCapabilities?.() || {};
      const nx = Math.min(1, Math.max(0, px / box.width));
      const ny = Math.min(1, Math.max(0, py / box.height));
      const adv = {};
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("single-shot")) adv.focusMode = "single-shot";
      else if (Array.isArray(caps.focusMode) && caps.focusMode.includes("manual")) adv.focusMode = "manual";
      if (caps.pointsOfInterest) adv.pointsOfInterest = [{ x: nx, y: ny }];
      if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
    } catch { /* ไม่รองรับโฟกัสจุด */ }
  }

  useEffect(() => {
    if (!camOn) return;                          // ยังไม่กดเปิดกล้อง → ไม่แตะกล้องเลย
    doneRef.current = false;
    let cancelled = false;

    async function open() {
      // ★ ใช้สตรีมกล้องที่ใช้ร่วมกัน — เปิด/ขอสิทธิ์ครั้งเดียว จากนั้นทุกครั้งที่กด SCAN ใช้ตัวเดิม
      const stream = await getSharedCameraStream();
      if (cancelled) return;                       // ปิดหน้าไปก่อน — อย่าแตะกล้อง (สตรีมคงอยู่ให้ครั้งหน้า)
      if (!stream) { setErr(t("เปิดกล้องไม่ได้ — พิมพ์รหัส QR ด้านล่างแทนได้", "Can't open camera — type the QR code below instead")); setCamOn(false); return; }
      streamRef.current = stream;
      // ★ ตรวจว่ากล้องรองรับซูม (hardware zoom) ไหม — ถ้ารองรับให้โชว์แถบซูม
      const track = stream.getVideoTracks?.()[0] || null;
      trackRef.current = track;
      try {
        const caps = track?.getCapabilities?.();
        if (caps && caps.zoom && Number(caps.zoom.max) > Number(caps.zoom.min)) {
          const cur = track.getSettings?.().zoom ?? caps.zoom.min;
          setZoom({ min: Number(caps.zoom.min), max: Number(caps.zoom.max), step: Number(caps.zoom.step) || 0.1, value: Number(cur) });
        } else { setZoom(null); }
      } catch { setZoom(null); }
      const v = videoRef.current;
      if (!v) return;                              // ไม่ stop สตรีม — เก็บไว้ใช้ครั้งหน้า
      v.srcObject = stream;
      try { await v.play(); } catch { /* ignore */ }
      loop();
    }
    // วาดกรอบขาวรอบ QR ที่เจอ (ตามพิกัดมุมจาก jsQR) — พิกัดตรงกับภาพกล้องเพราะ
    // overlay ใช้ object-fit: cover เหมือน <video> (ดู .stn-cam-overlay ใน CSS)
    function drawBox(loc, w, h) {
      const oc = overlayRef.current; if (!oc) return;
      if (oc.width !== w || oc.height !== h) { oc.width = w; oc.height = h; }
      const g = oc.getContext("2d");
      g.clearRect(0, 0, w, h);
      if (!loc) return;
      const p = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
      g.lineJoin = "round"; g.lineCap = "round";
      g.lineWidth = Math.max(5, Math.round(w * 0.009));
      g.strokeStyle = "#fff";
      g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 8;
      g.beginPath();
      g.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < 4; i++) g.lineTo(p[i].x, p[i].y);
      g.closePath(); g.stroke();
    }
    function clearBox() { const oc = overlayRef.current; if (oc) { const g = oc.getContext("2d"); g && g.clearRect(0, 0, oc.width, oc.height); } }

    async function loop() {
      const mod = await import("jsqr");
      const jsQR = mod.default || mod;
      const v = videoRef.current, cv = canvasRef.current;
      if (!v || !cv) return;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      let last = 0;
      const tick = () => {
        if (cancelled || doneRef.current) return;
        const now = Date.now();
        if (v.readyState === v.HAVE_ENOUGH_DATA && now - last > 110) {
          last = now;
          const w = v.videoWidth, h = v.videoHeight;
          if (w && h) {
            cv.width = w; cv.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
            if (code && code.data && code.location) {
              drawBox(code.location, w, h);        // กรอบขาวเกาะรอบ QR ตัวที่กำลังอ่าน
              doneRef.current = true;
              // ถ้าไม่พบในระบบ → เตือนแล้วกลับมาสแกนต่อ (ล้างกรอบด้วย)
              onDecoded(code.data.trim()).then((ok) => { if (!ok) { clearBox(); setTimeout(() => { doneRef.current = false; }, 1000); } });
              return;
            }
            clearBox();                            // ไม่เจอ QR ในเฟรมนี้ → ล้างกรอบ
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    }
    open();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const v = videoRef.current;
      if (v) { try { v.pause(); } catch { /* ignore */ } v.srcObject = null; }
      streamRef.current = null;
      // ★ ปิดสตรีมจริง (ดับไฟกล้อง) "เฉพาะเมื่อเบราว์เซอร์จำสิทธิ์ได้" → กดสแกนชิ้นถัดไปไม่ถามซ้ำ
      //   (Android/เดสก์ท็อป หรือ ติดตั้งเป็นแอป/PWA)
      // ถ้าเป็นแท็บ Safari บน iOS ที่จำสิทธิ์ข้าม stop() ไม่ได้ → คงสตรีมไว้ กันเด้งขอสิทธิ์ซ้ำทุกชิ้น
      //   (สตรีมจะถูกปิดจริงตอนออกจากระบบ ที่ cleanup ระดับ root)
      if (camPermissionPersists()) releaseSharedCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  function submitManual(e) {
    e.preventDefault();
    if (!manual.trim()) return;
    setPickList(null);
    // เบอร์พาร์ทตรงหลาย release → คืน choose ให้เลือกก่อน (กันลงผิดใบ) · ตรงใบเดียว → ระบุเลย
    onManualEntry(manual.trim()).then((r) => {
      if (r && r.ok) { doneRef.current = true; }
      else if (r && r.choose) { setPickList(r.choose); }
    });
  }
  function pickRelease(u) {
    setPickList(null);
    doneRef.current = true;
    onPickUnit(u);
  }

  return (
    <div>
      <div className="stn-cam">
        {camOn ? (
          <>
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <canvas ref={overlayRef} className="stn-cam-overlay" />
            <button type="button" className="stn-cam-close" onClick={onClose} aria-label={t("ปิด", "Close")}>✕</button>
            {zoom && (
              <div className="stn-cam-zoom">
                <button type="button" onClick={() => applyZoom(Math.max(zoom.min, zoom.value - zoom.step * 3))} aria-label="zoom out">−</button>
                <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value}
                  onChange={(e) => applyZoom(e.target.value)} aria-label="zoom" />
                <button type="button" onClick={() => applyZoom(Math.min(zoom.max, zoom.value + zoom.step * 3))} aria-label="zoom in">+</button>
              </div>
            )}
          </>
        ) : (
          // กล้องยังไม่เปิด — กดเปิดเอง (ขอสิทธิ์ไปแล้ว จึงไม่ถามซ้ำ)
          <button type="button" className="stn-cam-open" onClick={() => { setErr(""); setCamOn(true); }}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            <span>{t("แตะเพื่อเปิดกล้อง", "Tap to open camera")}</span>
          </button>
        )}
      </div>
      {err && <div className="stn-err" style={{ marginTop: 10 }}>{err}</div>}
      <form className="stn-cam-manual" onSubmit={submitManual}>
        <input className="stn-input stn-mono" value={manual} placeholder={t("หรือพิมพ์ QR / เบอร์พาร์ท", "or type QR / part no.")}
          onChange={(e) => setManual(e.target.value)} />
        <button className="stn-pill" type="submit" disabled={busy}>{t("ตกลง", "OK")}</button>
      </form>
      <div className="stn-cam-cancel-row">
        <button type="button" className="stn-pill stn-cam-cancel" onClick={onClose}>{t("✕ ปิด / ยกเลิก", "✕ Close / Cancel")}</button>
      </div>

      {/* เบอร์พาร์ทตรงหลาย Release → เลือกใบที่กำลังทำ (กันลงผิดใบ) */}
      {pickList && pickList.length > 0 && (
        <div className="stn-pick-backdrop" onClick={() => setPickList(null)}>
          <div className="stn-pick" onClick={(e) => e.stopPropagation()}>
            <div className="stn-pick-head">
              <b>{pickList[0]?.part_master?.part_no || ""}</b>
              <span>{t("มีหลาย Release — เลือกใบที่กำลังทำ", "Multiple releases — pick the one you're working on")}</span>
            </div>
            <div className="stn-pick-list">
              {pickList.map((u, i) => (
                <button type="button" key={u.id || i} className="stn-pick-item" onClick={() => pickRelease(u)}>
                  <b>Release {u.release?.release_order ?? "-"}</b>
                  <span>{t("จำนวนสั่ง", "Qty")} {u.release?.qty ?? "-"}
                    {u.part_master?.projects?.code ? ` · ${u.part_master.projects.code}` : ""}</span>
                </button>
              ))}
            </div>
            <button type="button" className="stn-pill stn-cam-cancel" onClick={() => setPickList(null)}>{t("ยกเลิก", "Cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── แผงจัดการคิว "ซิงค์ไม่สำเร็จ" (rejected) — ดูรายการ + ลองใหม่ทั้งหมด / ล้างทิ้ง ──
function RejectedPanel({ t, onClose, onRetry, onClear }) {
  const items = listRejected();
  const [confirmClear, setConfirmClear] = useState(false);
  const reasonText = (r) => {
    if (r === "not_found" || r === "unit_not_found") return t("ไม่พบ QR/ล็อตในระบบ (อาจถูกลบ)", "QR/lot not found (may be deleted)");
    if (r === "retry_exhausted") return t("ลองซิงค์หลายครั้งไม่สำเร็จ", "Failed after several retries");
    if (r === "forbidden" || r === "unauthorized") return t("สิทธิ์/เซสชันมีปัญหา", "Permission/session issue");
    return r || t("ไม่ทราบสาเหตุ", "unknown");
  };
  const whatText = (it) => {
    const mw = it.machineWork;
    if (mw) return `${mw.p_qr || "-"}${mw.p_quantity ? ` × ${mw.p_quantity}` : ""}`;
    return it.qr || "-";
  };
  const whenText = (it) => {
    const ts = it.rejectedAt || it.ts;
    if (!ts) return "";
    try { const d = new Date(ts); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    catch { return ""; }
  };
  return (
    <div className="stn-rej-backdrop" onClick={onClose}>
      <div className="stn-rej-modal" onClick={(e) => e.stopPropagation()}>
        <div className="stn-rej-head">
          <b>⚠️ {t("คิวซิงค์ไม่สำเร็จ", "Failed-sync queue")} ({items.length})</b>
          <button type="button" className="stn-rej-x" onClick={onClose} aria-label={t("ปิด", "Close")}>✕</button>
        </div>
        <div className="stn-rej-note">
          {t("งานเหล่านี้ทำจริงแต่ซิงค์ขึ้นระบบไม่ได้ (มัก QR/ล็อตถูกลบหรือแก้ฝั่งออฟฟิศ) — ให้ออฟฟิศกู้/แก้ข้อมูลก่อน แล้วกดลองใหม่",
             "These jobs were done but couldn't sync (usually the QR/lot was deleted or changed in the office app). Ask the office to restore/fix the data, then retry.")}
        </div>
        <div className="stn-rej-list">
          {items.length === 0 && <div className="stn-rej-empty">{t("ไม่มีรายการ", "No items")}</div>}
          {items.map((it, i) => (
            <div className="stn-rej-item" key={it.qid || i}>
              <div className="stn-rej-what stn-mono">{whatText(it)}</div>
              <div className="stn-rej-reason">{reasonText(it.reason)}</div>
              <div className="stn-rej-when stn-mono">{whenText(it)}</div>
            </div>
          ))}
        </div>
        <div className="stn-rej-actions">
          {!confirmClear ? (
            <>
              <button type="button" className="stn-pill yes" onClick={onRetry} disabled={!items.length}>
                🔄 {t("ลองซิงค์ใหม่ทั้งหมด", "Retry all")}
              </button>
              <button type="button" className="stn-pill no" onClick={() => setConfirmClear(true)} disabled={!items.length}>
                🗑 {t("ล้างทิ้ง", "Discard")}
              </button>
            </>
          ) : (
            <>
              <span className="stn-rej-confirm">{t("ล้างทิ้งถาวร? งานเหล่านี้จะหายและไม่ถูกบันทึก", "Discard permanently? These jobs will be lost.")}</span>
              <button type="button" className="stn-pill no" onClick={onClear}>{t("ยืนยันล้าง", "Confirm discard")}</button>
              <button type="button" className="stn-pill" onClick={() => setConfirmClear(false)}>{t("ยกเลิก", "Cancel")}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT (station)
// ══════════════════════════════════════════════════════════════════════════
// แถบแจ้ง "มีอัปเดต" สำหรับหน้าเครื่อง — คนงานกดเองเมื่อพร้อม (งานค้าง/ออฟไลน์ไม่หาย เพราะเก็บใน localStorage)
function StationUpdateBanner() {
  const ready = useUpdateReady();
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  if (!ready) return null;
  return (
    <div className="stn-update">
      <span>● มีเวอร์ชันใหม่{offline ? " · ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่" : " — กดอัปเดตเมื่อพร้อม (งานที่ทำอยู่ไม่หาย)"}</span>
      <button onClick={() => { setBusy(true); if (!applyUpdate()) { setBusy(false); setOffline(true); } }} disabled={busy}>
        {busy ? "กำลังอัปเดต…" : "อัปเดต"}
      </button>
    </div>
  );
}

export default function StationApp() {
  const [user, setUser] = useState(getSession());
  const [notice, setNotice] = useState("");
  async function logout() {
    if (!window.confirm("ออกจากระบบและปิดแอป?")) return;   // แจ้งเตือนก่อนล็อกเอาต์
    try { await logoutSession(); } catch { /* ignore */ }
    clearSession();
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* ignore */ }
    setUser(null);
    try { window.close(); } catch { /* ignore */ }   // พยายามปิดแอป/แท็บ (ได้ผลบน PWA/บางเบราว์เซอร์)
  }
  // ถูกเตะออกเพราะบัญชีถูกใช้ล็อกอินที่เครื่องอื่น (1 บัญชี = 1 เครื่อง) — เด้งกลับหน้าล็อกอิน
  function onKicked() {
    clearSession();
    setUser(null);
    setNotice("บัญชีนี้ถูกใช้ล็อกอินที่เครื่องอื่น — กรุณาเข้าสู่ระบบใหม่");
  }
  useEffect(() => { document.body.classList.add("stn-body"); return () => document.body.classList.remove("stn-body"); }, []);
  // เต็มจอเองตอนแตะครั้งแรก (สำหรับคนที่ล็อกอินค้างไว้ — ไม่มี gesture ตอนโหลด) · PWA จะเต็มจอเองอยู่แล้ว
  useEffect(() => armFullscreenOnFirstTap(), []);

  let content;
  if (!user) {
    content = <div className="stn-body" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}><StationLogin onLogin={(u) => { setNotice(""); setUser(u); }} notice={notice} /></div>;
  } else if (!user.machine) {
    content = (
      <div className="stn-login-wrap">
        <div className="stn-login">
          <h1>บัญชีนี้ยังไม่ได้ผูกเครื่องจักร</h1>
          <p>หน้าเครื่องต้องใช้บัญชีที่กำหนด "เครื่องจักรประจำ" ไว้ที่ Setup → พนักงาน<br />
            แจ้ง Admin ให้ตั้งค่า machine ให้บัญชีนี้ก่อน</p>
          <button className="stn-btn" onClick={logout}>ออกจากระบบ</button>
          <div className="stn-login-foot">
            {/* บัญชี operator จะถูกหน้าออฟฟิศเด้งกลับมา /station เสมอ → ต้องออกจากระบบก่อน
                ไม่งั้นกด "ไปหน้าสำนักงาน" จะวนลูป · บัญชี admin/supervisor ไปได้เลย */}
            <span className="stn-link-normal" style={{ cursor: "pointer" }}
              onClick={() => { if (user.role === "operator") clearSession(); window.location.href = "/"; }}>
              ไปหน้าสำนักงาน (ล็อกอินใหม่ด้วยบัญชี Admin) →
            </span>
          </div>
        </div>
      </div>
    );
  } else {
    content = <MachineStation user={user} onLogout={logout} onKicked={onKicked} />;
  }
  return <><StationUpdateBanner />{content}</>;
}
