import { useState, useEffect, useRef, useCallback } from "react";
import "./styles.css";
import "./station.css";
import {
  stationLogin, getSession, setSession, clearSession,
} from "./auth.js";
import {
  findUnitByQr, getMachineDay, recordMachineWork, getReleaseProgress,
  scanQueueCount, onScanQueue, flushScanQueue, logoutSession, prefetchUnitsForOffline,
  rejectedQueueCount, onRejectedQueue, retryRejected, sessionHeartbeat, getMachineOps,
} from "./supabase.js";
import { enterFullscreen, toggleFullscreen, armFullscreenOnFirstTap, isStandalone, warmCameraPermission } from "./fullscreen.js";
import { useUpdateReady, applyUpdate } from "./updatePrompt.js";

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
      <form className="stn-login" onSubmit={submit}>
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

function MachineStation({ user, onLogout, onKicked }) {
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

  const [unit, setUnit] = useState(null);   // resolved part_unit (from QR)
  const [progress, setProgress] = useState(null); // { done, total } ของล็อต/รีลีสที่สแกน
  const [qty, setQty] = useState(0);
  const [status, setStatus] = useState(null); // 'finished' | 'inprocess'
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);   // กันกด OK ซ้ำระหว่างบันทึก (re-entrancy)
  const [toast, setToast] = useState(null);   // { text, tone }
  const toastRef = useRef(null);
  const [pending, setPending] = useState(scanQueueCount());
  const [rejected, setRejected] = useState(rejectedQueueCount());
  const [storageFull, setStorageFull] = useState(false);   // ที่เก็บเต็ม — โชว์แถบค้างจนกว่าจะบันทึกได้

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
        if (user.operation && ops.some((o) => o.id === user.operation.id)) return user.operation; // ใช้ขั้นตอนประจำบัญชี
        if (ops.length === 1) return ops[0];                               // ทำได้ขั้นตอนเดียว → เลือกให้เลย
        return cur;                                                        // ทำได้หลายขั้นตอน → ให้คนงานแตะเลือก
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
    toastRef.current = setTimeout(() => setToast(null), 1900);
  }
  useEffect(() => () => clearTimeout(toastRef.current), []);

  // ── timer ───────────────────────────────────────────────────────────────
  function startTimer() {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }
  function stopTimer() { clearInterval(timerRef.current); timerRef.current = null; }
  useEffect(() => () => stopTimer(), []);

  function resetAll(keepLen = false) {
    stopTimer(); setElapsed(0); setUnit(null); setProgress(null); setQty(0);
    if (!keepLen) setMaterialLen("");   // หลังบันทึกให้คงความยาววัสดุไว้ (งานชุดเดียวกันมักยาวเท่ากัน)
    setStatus(null); setStep(STEP.IDLE);
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
    // เครื่องทำได้หลายขั้นตอน แต่ยังไม่เลือก → ต้องเลือกก่อน (กันบันทึกผิดขั้นตอน)
    if (machineOps.length > 1 && !op) { flash("เลือกขั้นตอน (ตัด/เจาะ/บาก) ก่อนสแกน", "warn"); return; }
    warmAudio(); // ปลดล็อกเสียงบนมือถือ (ต้องมาจาก user gesture) เผื่อไว้ให้เสียงสแกนดังได้
    // ล้างค่าสแกนเดิมก่อนเสมอ — กันสถานะ/จำนวนของชิ้นก่อนหน้าติดมากับชิ้นใหม่
    // (เช่นเลือก Finished/qty 5 ที่ชิ้น A แล้วกด SCAN ต่อชิ้น B โดยไม่กด Cancel)
    setUnit(null); setProgress(null); setQty(0); setStatus(null);
    setStep(STEP.SCAN);
  }
  function closeScan() { setStep(STEP.REC); } // ปิดกล้อง กลับไปหน้ากำลังจับเวลา
  // Cancel หลังสแกน → กลับไปสแกนใหม่ (เวลาเดินต่อเนื่องอยู่แล้ว ไม่ต้อง start ใหม่)
  function rescan() { setUnit(null); setProgress(null); setQty(0); setStatus(null); setStep(STEP.SCAN); }
  // คืน true=พบ, false=ไม่พบ · มีเสียงเฉพาะตอน "ไม่พบ" (เตือนทุกครั้งที่กดตกลง) เท่านั้น
  async function onDecoded(qr) {
    if (!qr) return false;
    setBusy(true);
    const u = await findUnitByQr(qr);
    if (!u) { setBusy(false); errorBeep(); flash("ไม่พบ QR นี้ในระบบ — สแกนใหม่ หรือพิมพ์รหัสด้านล่าง", "warn"); return false; }
    tickBeep();   // เสียงเบายืนยันว่าสแกนเจอชิ้นงาน (ต่างจาก error)
    // สแกนเสร็จ = เวลายังเดินต่อ (ไม่หยุด) — โชว์ป้ายตัวใหม่ + running number
    // done = จำนวนที่ "เครื่องนี้ (ขั้นตอนนี้)" ทำไปแล้วของรีลีสนี้ · total = จำนวนสั่งทั้งใบ
    // ยึดตามเครื่องจักร: ตัด/เจาะ/บาก นับแยกกัน (ไม่รวมยอดข้ามขั้นตอน)
    // ★ H1: ต้องรู้ "ขั้นตอน (operation) ของเครื่องนี้" ถึงจะนับเลขวิ่งถูก — ถ้าไม่รู้
    //   อย่าเอายอด "รวมทุกขั้นตอน" มาโชว์ (จะหลอกให้หยุดงานก่อนครบ) → โชว์เป็นไม่ทราบแทน
    const opId = op?.id || user.operation?.id || null;
    const done = opId ? await getReleaseProgress(u.release_id, opId) : null;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    setBusy(false);
    setProgress({ done, total: u.release?.qty ?? null, offline, noOp: !opId });
    setUnit(u);
    if (qty === 0) setQty(1);
    setStep(STEP.PART);
    return true;
  }

  // กด OK = บันทึกทันที (ไม่ต้องกด SAVE อีก)
  function confirmPart() {
    if (!status) { flash("เลือกสถานะ In Process หรือ Finished", "warn"); return; }
    if (qty <= 0) { flash("ระบุจำนวนมากกว่า 0", "warn"); return; }
    if (!Number.isInteger(qty)) { flash("จำนวนต้องเป็นจำนวนเต็ม", "warn"); return; }
    if (qty > 100000) { flash("จำนวนมากเกินไป (สูงสุด 100,000/ครั้ง)", "warn"); return; }
    // จำนวนมากผิดปกติในครั้งเดียว — ให้ยืนยันกันพิมพ์เกิน (เช่น 100 กลายเป็น 1000)
    if (qty > 2000 && !confirm(`จำนวน ${qty.toLocaleString()} ชิ้นในการบันทึกครั้งเดียว มากผิดปกติ — ยืนยันหรือไม่?`)) return;
    doSave();
  }

  // ── บันทึก (เรียกจากปุ่ม OK) ─────────────────────────────────────────────
  async function doSave() {
    if (savingRef.current) return;      // กันกด OK รัวๆ → บันทึกซ้ำ (re-entrancy)
    savingRef.current = true;
    setBusy(true);
    try {
      const res = await recordMachineWork({
        qr: unit.qr_code,
        quantity: qty,
        materialLengthMm: materialLen === "" ? null : Number(materialLen),
        processSeconds: elapsed,
        status,
        releaseId: unit.release_id,   // ใช้คำนวณ running number ตอนออฟไลน์
        operationId: op?.id || null,  // ★ ขั้นตอนที่เลือกบนจอ
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

  // scroll table to newest row when it changes
  const tableRef = useRef(null);
  useEffect(() => {
    if (tableRef.current) tableRef.current.scrollTop = tableRef.current.scrollHeight;
  }, [rows.length]);

  const recording = step !== STEP.IDLE;
  const scanArmed = qty > 0 && !!unit;

  return (
    <div className="stn-shell">
      {pending > 0 && <div className="stn-pending">⏳ ค้างซิงค์ {pending}</div>}
      {storageFull && (
        <div className="stn-rejected" onClick={() => setStorageFull(false)}
          style={{ background: "#b91c1c" }}
          title="ที่เก็บข้อมูลในเครื่องเต็ม">
          ⛔ ที่เก็บข้อมูลเต็ม — งานอาจไม่ถูกบันทึก! ปิดแอปอื่น/ล้างข้อมูลเบราว์เซอร์ แล้วลองใหม่ · แจ้งผู้ดูแล (แตะเพื่อซ่อน)
        </div>
      )}
      {rejected > 0 && (
        <div className="stn-rejected" onClick={retryRejected}
          title="แตะเพื่อลองซิงค์อีกครั้ง (หลังออฟฟิศกู้/แก้ข้อมูลแล้ว)">
          ⚠️ ซิงค์ไม่สำเร็จ {rejected} — QR ถูกลบ/แก้ฝั่งออฟฟิศ · แตะเพื่อลองใหม่
        </div>
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
                <th>ITEM</th><th>MDF&nbsp;NO.</th><th>REL&nbsp;NO.</th><th>PART&nbsp;NO.</th><th>REV.</th>
                <th>QTY.</th><th>REQ.</th><th>PROCESS /<br />REQUIRED</th><th>BALANCE</th>
                <th>LENGTH<br />[mm]</th><th>WEIGHT<br />[kg]</th><th>MATERIALS<br />LENGTH</th>
                <th>INVENTORY<br />CODE</th><th>PROCESS<br />TIME</th><th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr className="stn-empty-row"><td colSpan={15}>ยังไม่มีบันทึกวันนี้ — เริ่มงานแรกได้เลย</td></tr>
              )}
              {rows.map((r, i) => {
                const fin = String(r.status).toLowerCase() === "finished";
                const isNew = (r.id && r.id === newRowId);
                return (
                  <tr key={r.id || i} className={`${isNew ? "stn-new" : ""}${r.pending ? " stn-pending-row" : ""}`}
                    title={r.pending ? "ยังไม่ซิงค์ — รอเน็ตกลับมา" : undefined}>
                    <td>{r.item != null ? String(r.item).padStart(3, "0") : pad(i + 1)}</td>
                    <td>{r.mdf_no || "-"}</td>
                    <td>{r.rel_no || "-"}</td>
                    <td className="l">{r.part_no || "-"}</td>
                    <td>{r.rev || "-"}</td>
                    <td>{fmt(r.qty)}</td>
                    <td>{r.req != null ? fmt(r.req) : "-"}</td>
                    <td>{r.process_cum != null && r.req != null
                      ? `${String(r.process_cum).padStart(4, "0")}/${String(r.req).padStart(4, "0")}` : "-"}</td>
                    {/* BALANCE = คงเหลือ (REQ − PROCESS) · ติดลบ = ทำเกิน (สแปร์) */}
                    <td className={r.process_cum != null && r.req != null && (r.req - r.process_cum) <= 0 ? "stn-st-fin" : ""}>
                      {r.process_cum != null && r.req != null ? fmt(r.req - r.process_cum) : "-"}</td>
                    <td>{r.length_mm != null ? fmt(r.length_mm) : "-"}</td>
                    <td>{r.weight != null ? fmt(r.weight) : "-"}</td>
                    <td>{r.materials_length != null ? fmt(r.materials_length) : "-"}</td>
                    <td className="l">{r.inventory_code || "-"}</td>
                    <td>{hms(r.process_seconds)}</td>
                    <td className={fin ? "stn-st-fin" : "stn-st-inp"}>
                      {fin ? "Finished" : "In Process"}
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
            <h2>DAILY REPORT</h2>
            <div className="stn-date">{todayISOdate()}</div>
          </div>
          <div className="stn-kpis">
            <div className="stn-kpi"><div className="lbl">Daily Quantity</div>
              <div className="val">{fmt(daily.quantity)} pcs</div></div>
            <div className="stn-kpi"><div className="lbl">Daily Weight</div>
              <div className="val">{fmt(daily.weight)} kg</div></div>
            <div className="stn-kpi"><div className="lbl">Daily Process Time</div>
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
              onDecoded={onDecoded} confirmCancel={confirmCancel} confirmPart={confirmPart}
              closeScan={closeScan} rescan={rescan}
            />
            {toast && <div className={`stn-toast ${toast.tone}`}>{toast.text}</div>}
          </div>

          <div className="stn-control">
            <div className="stn-ctl-main">
              <div className={`stn-clock${recording ? " live" : ""}`}>{hms(elapsed)}</div>
              <div className={`stn-mat${recording ? " live" : ""}`}
                style={step === STEP.IDLE && !matReady ? { outline: "2px solid #f59e0b", outlineOffset: 2, borderRadius: 8 } : undefined}>
                <div className="lbl">Material Length {step === STEP.IDLE && !matReady ? "· กรอกก่อน" : ""}</div>
                <input
                  inputMode="numeric" disabled={recording}
                  value={materialLen} placeholder="0"
                  onChange={(e) => setMaterialLen(e.target.value.replace(/[^\d.]/g, ""))}
                />
              </div>
              {/* START ไม่ disable เพราะ !matReady — ปล่อยให้กดได้แล้ว flash บอกเหตุผล (เดิมกดไม่ได้เงียบ) */}
              <button className={`stn-ctl-btn${recording ? " recording" : ""}`} onClick={onRecord}
                disabled={busy}>
                <span>{recording ? "STOP" : "START"}</span><span className="stn-rec-dot" />
              </button>
              <button className={`stn-ctl-btn stn-scan-cell${scanArmed ? " armed" : ""}`} onClick={onScan} disabled={busy}>
                <div className="row1">
                  <span>SCAN</span>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16" /></svg>
                </div>
                <div className="qty">Quantity <b>{qty}</b> piece</div>
              </button>
            </div>
            <button className="stn-ctl-btn stn-exit" onClick={onLogout}>
              <span>ออกจากระบบ</span>
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
function WorkArea({ step, elapsed, unit, progress, qty, setQty, status, setStatus, busy, onDecoded, confirmCancel, confirmPart, closeScan, rescan }) {
  if (step === STEP.IDLE) {
    return (
      <div className="stn-hint">
        <div style={{ marginBottom: 8 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b6bcc4" strokeWidth="1.6"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16" /></svg>
        </div>
        พร้อมเริ่มงาน — กรอก <b>MATERIAL LENGTH</b><br />แล้วกด <b>START</b> เพื่อเริ่มจับเวลา
      </div>
    );
  }
  if (step === STEP.REC) {
    return (
      <div>
        <StationAnim />
        <div className="stn-hint">
          <div className="big">● กำลังบันทึกเวลา</div>
          กด <b>SCAN</b> เพื่อสแกนชิ้นงาน
        </div>
      </div>
    );
  }
  if (step === STEP.CANCEL) {
    return (
      <div className="stn-confirm">
        <h3>ยกเลิกการบันทึก?</h3>
        <p>เวลาที่จับไว้ ({hms(elapsed)}) จะถูกล้างและเริ่มใหม่</p>
        <div className="stn-row-btns">
          <button className="stn-pill yes" onClick={() => confirmCancel(true)}>YES</button>
          <button className="stn-pill no" onClick={() => confirmCancel(false)}>NO</button>
        </div>
      </div>
    );
  }
  if (step === STEP.SCAN) {
    return <CameraScan onDecoded={onDecoded} busy={busy} onClose={closeScan} />;
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
    const ofText = noOp
      ? (total != null ? `— OF ${fmt(total)}` : "—")
      : (total != null
          ? `${fmt(startNo)}${endNo > startNo ? `–${fmt(endNo)}` : ""} OF ${fmt(total)}`
          : `${fmt(startNo)}${endNo > startNo ? `–${fmt(endNo)}` : ""}`);
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
              <div className="stn-lbl-of">{progress?.offline ? `~${ofText}` : ofText}</div>
              {isOver ? <div className="stn-lbl-rework">เกินจำนวนสั่งแล้ว (สแปร์ / เพิ่ม)</div> : null}
              {progress?.offline ? <div className="stn-lbl-approx">ประมาณการ · ออฟไลน์</div> : null}
            </div>
          </div>
        </div>
        <div className="stn-qty-lbl">QUANTITY</div>
        <div className="stn-qty-stepper">
          <button onClick={() => setQty(Math.max(0, qty - 1))}>−</button>
          <input inputMode="numeric" value={qty}
            onChange={(e) => setQty(Math.min(100000, Math.max(0, parseInt(e.target.value || "0", 10) || 0)))} />
          <button onClick={() => setQty(Math.min(100000, qty + 1))}>+</button>
        </div>
        <div className="stn-row-btns" style={{ marginBottom: 14 }}>
          <button className={`stn-pill ${status === "inprocess" ? "sel-inp" : ""}`} onClick={() => setStatus("inprocess")}>In Process</button>
          <button className={`stn-pill ${status === "finished" ? "sel-fin" : ""}`} onClick={() => setStatus("finished")}>Finished</button>
        </div>
        <div className="stn-row-btns">
          <button className="stn-pill no" onClick={rescan} disabled={busy}>Cancel</button>
          <button className="stn-pill ok" onClick={confirmPart} disabled={!status || qty <= 0 || busy}>{busy ? "..." : "OK"}</button>
        </div>
      </div>
    );
  }
  return null;
}

// ── Camera QR scanner (rear camera + jsQR) with manual fallback ────────────
function CameraScan({ onDecoded, busy, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);   // แคนวาสวาดกรอบขาวทับ QR ที่เจอ
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [manual, setManual] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    doneRef.current = false;
    let cancelled = false;

    async function pickRear() {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const back = devs.filter((d) => d.kind === "videoinput" && /back|rear|environment/i.test(d.label || ""));
        const main = back.find((d) => !/ultra|wide|tele|0\.5x/i.test(d.label || "")) || back[0];
        return main?.deviceId || null;
      } catch { return null; }
    }
    async function open() {
      const id = await pickRear();
      if (cancelled) return;
      const tries = [
        id ? { video: { deviceId: { exact: id } } } : null,
        { video: { facingMode: { exact: "environment" } } },
        { video: { facingMode: "environment" } },
      ].filter(Boolean);
      let stream = null;
      for (const c of tries) { try { stream = await navigator.mediaDevices.getUserMedia(c); break; } catch { /* next */ } }
      if (cancelled) { stream?.getTracks().forEach((t) => t.stop()); return; }
      if (!stream) { setErr("เปิดกล้องไม่ได้ — พิมพ์รหัส QR ด้านล่างแทนได้"); return; }
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) { stream.getTracks().forEach((t) => t.stop()); return; }
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitManual(e) {
    e.preventDefault();
    if (!manual.trim()) return;
    // กดตกลงได้ทุกครั้ง: ถ้า QR ผิด จะเตือนซ้ำทุกครั้ง; ถ้าถูกค่อยหยุดสแกน
    onDecoded(manual.trim()).then((ok) => { if (ok) doneRef.current = true; });
  }

  return (
    <div>
      <div className="stn-cam">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <canvas ref={overlayRef} className="stn-cam-overlay" />
        <button type="button" className="stn-cam-close" onClick={onClose} aria-label="ปิดกล้อง">✕</button>
      </div>
      {err && <div className="stn-err" style={{ marginTop: 10 }}>{err}</div>}
      <form className="stn-cam-manual" onSubmit={submitManual}>
        <input className="stn-input stn-mono" value={manual} placeholder="หรือพิมพ์รหัส QR"
          onChange={(e) => setManual(e.target.value)} />
        <button className="stn-pill" type="submit" disabled={busy}>ตกลง</button>
      </form>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="stn-pill" onClick={onClose}>✕ ปิดกล้อง / ยกเลิก</button>
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
      <span>● มีเวอร์ชันใหม่{offline ? " · ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่" : " — กดอัปเดตเมื่อพร้อม"}</span>
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
