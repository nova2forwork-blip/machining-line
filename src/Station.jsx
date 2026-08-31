import { useState, useEffect, useRef, useCallback } from "react";
import "./styles.css";
import "./station.css";
import {
  stationLogin, getSession, setSession, clearSession,
} from "./auth.js";
import {
  findUnitByQr, findManualPartOptions, getMachineDay, recordMachineWork, getReleaseProgress,
  scanQueueCount, onScanQueue, flushScanQueue, logoutSession, prefetchUnitsForOffline,
  rejectedQueueCount, onRejectedQueue, retryRejected, sessionHeartbeat, getMachineOps, reportDeadLetter,
  countUnitOpRecords, listRejected, clearRejected, getAssemblyState, recordAssembly,
  uploadPackingPhoto, recordPackingPhotos, getPartMeta, listAssemblyParents,
} from "./supabase.js";
import { enterFullscreen, toggleFullscreen, armFullscreenOnFirstTap, isStandalone, warmCameraPermission, getSharedCameraStream, releaseSharedCamera, camPermissionPersists, listRearCameras } from "./fullscreen.js";
import { useUpdateReady, applyUpdate } from "./updatePrompt.js";
import { askConfirm, ConfirmHost } from "./confirm.jsx";
import Icon from "./icons.jsx";
import { useLang } from "./i18n-dom.js";
import { newClientId } from "./offline.js";   // ตัวสร้าง UUID ที่ปลอดภัยเสมอ (แม้ไม่มี crypto.randomUUID)

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

// ─── แผนก (department) ─────────────────────────────────────────────────────
//   แต่ละหน้าจอ terminal = 1 แผนก · ระบุจาก op_type ของขั้นตอน
//   machine = งานเครื่องจักร (ตัด/เจาะ/บาก…) · assembly = ประกอบ · packing = แพ็ก
function opDept(o) {
  const ty = o?.op_type;
  if (ty === "assembly") return "assembly";
  if (ty === "packing") return "packing";
  return "machine";
}
const DEPT_META = {
  machine:  { th: "หน้าเครื่อง", en: "Machine",  path: "/station",  word: "เครื่อง", wordEn: "machine" },
  assembly: { th: "หน้าประกอบ", en: "Assembly", path: "/assembly", word: "ประกอบ", wordEn: "assembly" },
  packing:  { th: "หน้าแพ็ก",   en: "Packing",  path: "/packing",  word: "แพ็ก",   wordEn: "packing" },
};

// ── บัญชีนี้ไม่ใช่แผนกของหน้านี้ → บอกเหตุผล + ลิงก์ไปหน้าที่ถูกต้อง ─────────────
// อนิเมชันโหลดตอนล็อกอิน/เปลี่ยนหน้า (แบบ 3 — จุดเต้น + แถบกวาด) เต็มจอ · ใช้ร่วมกับหน้าสำนักงาน
function LoginSplash({ text = "กำลังเข้าสู่ระบบ…" }) {
  return (
    <div className="mls-splash">
      <div className="mls-splash-brand"><span className="m"><Icon name="bolt" size={18} /></span> MACHINING LINE</div>
      <div className="mls-load3"><div className="mls-load3-dots"><i /><i /><i /></div><div className="mls-load3-bar" /></div>
      <div className="mls-splash-text">{text}</div>
    </div>
  );
}

function StnDeptRedirect({ dept, acctDepts, onLogout, t }) {
  const here = DEPT_META[dept] || DEPT_META.machine;
  const targets = (acctDepts || []).filter((d) => DEPT_META[d]).map((d) => DEPT_META[d]);
  return (
    <div className="stn-login-wrap">
      <div className="stn-login stn-deptredir" style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}><StnLangToggle /></div>
        <div className="stn-deptredir-emoji"><Icon name="warn" size={40} /></div>
        <h1>{t(`บัญชีนี้ไม่ใช่แผนก “${here.word}”`, `This account isn't a ${here.wordEn} station`)}</h1>
        <p>{targets.length
          ? t("บัญชีนี้อยู่คนละแผนก — เปิดหน้าที่ถูกต้องด้านล่าง", "This account belongs to another department — open the correct page below")
          : t("บัญชีนี้ยังไม่ได้ตั้งขั้นตอนของแผนกใด — แจ้งผู้ดูแลให้ตั้งค่าก่อน", "No operation set for this account — ask an admin to configure it")}</p>
        <div className="stn-deptredir-links">
          {targets.map((m) => (
            <a key={m.path} className="stn-deptredir-go" href={m.path}>{t(`ไป${m.th}`, `Go to ${m.en}`)} →</a>
          ))}
        </div>
        <button type="button" className="stn-deptredir-out" onClick={onLogout}>{t("ออกจากระบบ", "Log out")}</button>
      </div>
    </div>
  );
}

// ── กำลังตรวจว่าบัญชีเป็นแผนกอะไร (ระหว่างโหลดรายการขั้นตอน) ─────────────────────
function StnDeptChecking({ dept, t }) {
  const m = DEPT_META[dept] || DEPT_META.machine;
  return <LoginSplash text={t(`กำลังเปิด${m.th}…`, `Opening ${m.en}…`)} />;
}

// ══════════════════════════════════════════════════════════════════════════
// STATION LOGIN — same credentials as the main app; intended for the
// machine's own account (an employee whose machine_id is set).
// ══════════════════════════════════════════════════════════════════════════
function StationLogin({ onLogin, notice, dept = "machine" }) {
  const meta = DEPT_META[dept] || DEPT_META.machine;
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
      <form className={`stn-login dept-${dept}`} onSubmit={submit} style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}><StnLangToggle /></div>
        <h1>{meta.th} — เข้าสู่ระบบ</h1>
        <p>{dept === "machine"
          ? "ล็อกอินด้วยบัญชีของเครื่อง/สถานีนี้ (บัญชีที่ผูกเครื่อง/สถานีไว้)"
          : `ล็อกอินด้วยบัญชีของแผนก${meta.word} (บัญชีที่ผูกสถานี${meta.word}ไว้)`}</p>
        {notice && <div className="stn-notice">{notice}</div>}
        <div className="stn-field">
          <label>{dept === "machine" ? "รหัสเครื่อง / พนักงาน" : `รหัสสถานี${meta.word} / พนักงาน`}</label>
          <input className="stn-input" value={code} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => setCode(e.target.value)}
            placeholder={dept === "assembly" ? "เช่น ประกอบ-01" : dept === "packing" ? "เช่น แพ็ก-01" : "เช่น CT-001"} />
        </div>
        <div className="stn-field">
          <label>รหัสผ่าน</label>
          <input className="stn-input" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {err && <div className="stn-err">{err}</div>}
        <button className="stn-btn" disabled={busy}>{busy ? <>กำลังเข้าสู่ระบบ<span className="mls-btn-dots"><i /><i /><i /></span></> : "เข้าสู่ระบบ"}</button>
        <div className="stn-login-foot">
          จอนี้สำหรับติดหน้า{meta.word} (แนวนอน)
        </div>
        <div className="stn-login-link">
          <a href="/">→ ไปหน้าปกติ (สำนักงาน)</a>
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

function MachineStation({ user, onLogout, onKicked, onExpired, dept = "machine" }) {
  const [lang] = useLang();                       // ★ สลับป้าย report/ปุ่ม ตามภาษา (ไม่พึ่ง DICT ที่ใช้ร่วมกับออฟฟิศ)
  const t = (th, en) => (lang === "en" ? en : th);
  const machine = user.machine; // { id, code, name }
  // ขั้นตอนประจำเครื่อง (ตัด/เจาะ/บาก) — ใช้ทำ running number แยกตามขั้นตอน
  // มาจาก login (user.operation) และรีเฟรชจาก machine_day ทุกครั้งที่โหลด (เผื่อ admin แก้)
  const [op, setOp] = useState(user.operation || null);
  const [machineOps, setMachineOps] = useState([]);   // ขั้นตอน "ของแผนกนี้" ที่บัญชีทำได้ (กรองตาม dept แล้ว)
  const [allOps, setAllOps] = useState([]);           // ★ ทุกขั้นตอนของบัญชี (ยังไม่กรอง) — ใช้บอกว่าบัญชีนี้เป็นแผนกอะไร
  const [opsLoaded, setOpsLoaded] = useState(false);  // โหลดรายการขั้นตอนเสร็จหรือยัง (กันเด้ง redirect ก่อนรู้ข้อมูล)
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
  // ── โหมดประกอบ/แพ็ก (assembly) — เมื่อ op.is_assembly ────────────────────────
  const [asmParent, setAsmParent] = useState(null);     // { unit, bom:[{child_pm_id, qty, part_no, part_name}] }
  const [asmChildren, setAsmChildren] = useState([]);   // [{ unit_id, qr, child_pm_id, part_no }]
  const asmClientRef = useRef(null);
  const [packPhotos, setPackPhotos] = useState([]);     // รูปตอนแพ็ก (ยังไม่อัป) [{ blob, url }]
  const [photoOpen, setPhotoOpen] = useState(false);    // เปิดกล้องถ่ายรูปแพ็ก
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

  // โหลดขั้นตอนที่บัญชีทำได้ → กรอง "เฉพาะแผนกของหน้านี้" (machine / assembly / packing) + ตั้ง default
  useEffect(() => {
    getMachineOps().then((raw) => {
      const list = raw || [];
      setAllOps(list);
      setOpsLoaded(true);
      const ops = list.filter((o) => opDept(o) === dept);                  // เก็บเฉพาะขั้นตอนของแผนกนี้
      setMachineOps(ops);
      setOp((cur) => {
        if (cur && ops.some((o) => o.id === cur.id)) return cur;          // เลือกไว้แล้ว + ยังทำได้ → คงเดิม
        if (ops.length === 1) return ops[0];                               // ทำได้ขั้นตอนเดียว → เลือกให้เลย
        if (ops.length === 0) return dept === "machine" ? (user.operation || cur) : null; // machine: ใช้ขั้นตอนประจำบัญชี
        // ★ ทำได้หลายขั้นตอน → บังคับให้แตะเลือกเอง (ไม่ default จากบัญชี กันบันทึกผิดขั้นตอนเงียบๆ)
        return null;
      });
    }).catch(() => { setAllOps([]); setMachineOps([]); setOpsLoaded(true); });   // โหลดขั้นตอนพลาด → ไม่ค้าง "กำลังตรวจ" (ถือว่ายังไม่มีแผนก)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept]);
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
      if (r && (r.expired || r.exists === false)) {              // token หมดอายุ/หาย → ล็อกอินใหม่ (ซิงค์ต่อหลัง login)
        onExpired && onExpired();
        return;
      }
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

  // flushScanQueue เจอ token หมดอายุระหว่างซิงค์ → ยิง event นี้ → เด้งล็อกอินใหม่ (งานคงในคิว รอดข้ามล็อกอิน)
  useEffect(() => {
    const onExp = () => { onExpired && onExpired(); };
    window.addEventListener("mls-session-expired", onExp);
    return () => window.removeEventListener("mls-session-expired", onExp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    flushScanQueue().then(() => setPending(scanQueueCount()));
    if (rejectedQueueCount() > 0) reportDeadLetter();   // มีงานค้างเดิมค้างอยู่ → แจ้ง office ตอนเปิดเครื่อง
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
    if (dept !== "machine") return;        // ★ ประกอบ/แพ็กไม่ใช้ draft (สถานะประกอบไม่ได้ถูกเก็บใน draft) — กันเด้ง "กู้งาน" หลอก + จับเวลาผี
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
    if (dept !== "machine") { draftLoadedRef.current = true; return; }   // ★ ประกอบ/แพ็ก: ไม่กู้ draft (กันงานเครื่องหลอกมาทับหน้าประกอบ)
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

  async function onScan() {
    if (step === STEP.IDLE) { flash("กด START ก่อนเริ่มสแกน", "warn"); return; }
    // ★ กด SCAN ซ้ำระหว่างกล้องเปิด (ยังไม่ได้สแกน) → ปิดกล้อง กลับไปหน้าจับเวลา (toggle)
    if (step === STEP.SCAN) { setStep(STEP.REC); return; }
    // เครื่องทำได้หลายขั้นตอน แต่ยังไม่เลือก → ต้องเลือกก่อน (กันบันทึกผิดขั้นตอน)
    if (machineOps.length > 1 && !op) { flash("เลือกขั้นตอน (ตัด/เจาะ/บาก) ก่อนสแกน", "warn"); return; }
    warmAudio(); // ปลดล็อกเสียงบนมือถือ (ต้องมาจาก user gesture) — เรียกก่อน await กันเสียงเงียบหลังการ์ดยืนยัน
    // มีชิ้นที่สแกนไว้แล้วแต่ยังไม่กด OK (เลือกสถานะ/จำนวนแล้ว) → เตือนก่อนทิ้ง กันนับขาด
    if (step === STEP.PART && unit && (status || qty > 1)) {
      if (!(await askConfirm({
        message: t("ยังไม่ได้กด OK บันทึกชิ้นที่สแกนไว้ — สแกนใหม่จะทิ้งค่าเดิม ยืนยันหรือไม่?",
                   "This scanned piece isn't saved yet — scanning again will discard it. Continue?"),
        tone: "warn",
        confirmText: t("สแกนใหม่", "Scan again"),
        cancelText: t("ยกเลิก", "Cancel"),
      }))) return;
    }
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
  // คืน true=แสดงชิ้นเข้าหน้าเลือกจำนวน · false=ถูกบล็อก (เช่นโปรเจกต์ปิดแล้ว)
  async function showScannedUnit(u) {
    // ★ กันไว้ตั้งแต่ต้น: โปรเจกต์ปิดแล้ว → เตือนทันที ไม่ให้เข้าหน้าทำงาน (ไม่ต้องเสียเวลาแล้วโดนเด้งตอนกด OK)
    if (u?.part_master?.projects?.status === "closed") {
      errorBeep();
      flash(t("โปรเจกต์นี้ปิดแล้ว (ทำเสร็จ) — บันทึกงานเพิ่มไม่ได้ · แจ้งแอดมินถ้าต้องแก้งาน",
              "This project is closed — can't add work · ask admin to reopen for rework"), "warn");
      return false;
    }
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
    return true;
  }
  // สแกน QR (จากกล้อง) — ถ้าอ่านได้เป็นเบอร์พาร์ท ลอง fallback หา 1 ตัว (กล้องเดี่ยวไม่มี UI ให้เลือก)
  // คืน true=พบ, false=ไม่พบ
  const curOpId = () => op?.id || user.operation?.id || null;
  async function onDecoded(qr) {
    if (!qr) return false;
    setBusy(true);
    const u = await findUnitByQr(qr);           // QR = ระบุชิ้น/โปรเจกต์/ใบเจาะจงเสมอ
    if (u) { setBusy(false); return await showScannedUnit(u); }   // โปรเจกต์ปิด → คืน false ให้สแกนต่อได้
    // ไม่เจอด้วย QR → เผื่อชี้กล้องที่ "เบอร์พาร์ท": ตรงโปรเจกต์เดียวใช้เลย · หลายโปรเจกต์ → อย่าเดา ให้พิมพ์เลือก
    const opts = await findManualPartOptions(qr, curOpId());
    setBusy(false);
    if (opts.length === 1) { return await showScannedUnit(opts[0].unit); }
    if (opts.length >= 2) {
      errorBeep();
      flash(t("เบอร์นี้อยู่หลายโปรเจกต์ — พิมพ์ในช่องด้านล่างแล้วเลือกโปรเจกต์",
              "This number is in several projects — type it below and pick the project"), "warn");
      return false;
    }
    errorBeep(); flash("ไม่พบ QR/เบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง", "warn"); return false;
  }
  // พิมพ์เบอร์พาร์ท/QR ในช่องกรอก — เบอร์พาร์ทอยู่หลายโปรเจกต์ → ให้เลือก "โปรเจกต์" (ไม่ต้องเลือก release)
  // คืน { ok:true } เมื่อระบุได้เลย · { ok:false, choose:[options] } เมื่อต้องเลือกโปรเจกต์ · { ok:false } เมื่อไม่พบ
  async function onManualEntry(text) {
    const s = String(text || "").trim();
    if (!s) return { ok: false };
    setBusy(true);
    // 1) เผื่อพิมพ์เป็น QR (unique) → ระบุชิ้นเจาะจงได้เลย
    const u = await findUnitByQr(s);
    if (u) { setBusy(false); return { ok: await showScannedUnit(u) }; }
    // 2) เป็นเบอร์พาร์ท → หาตัวเลือกระดับโปรเจกต์ (findManualPartOptions ตัดโปรเจกต์ปิดออกให้แล้ว)
    const opts = await findManualPartOptions(s, curOpId());
    setBusy(false);
    if (!opts.length) { errorBeep(); flash("ไม่พบเบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง", "warn"); return { ok: false }; }
    if (opts.length === 1) { return { ok: await showScannedUnit(opts[0].unit) }; }
    return { ok: false, choose: opts };   // หลายโปรเจกต์ → ให้เลือก
  }
  // คนงานเลือกโปรเจกต์แล้ว → ใช้ชิ้นตัวแทนของโปรเจกต์นั้น
  async function onPickUnit(u) { if (u) { setBusy(false); await showScannedUnit(u); } }

  // กด OK = บันทึกทันที (ไม่ต้องกด SAVE อีก)
  async function confirmPart() {
    if (!status) { flash("เลือกสถานะ In Process หรือ Finished", "warn"); return; }
    if (qty <= 0) { flash("ระบุจำนวนมากกว่า 0", "warn"); return; }
    if (!Number.isInteger(qty)) { flash("จำนวนต้องเป็นจำนวนเต็ม", "warn"); return; }
    if (qty > 100000) { flash("จำนวนมากเกินไป (สูงสุด 100,000/ครั้ง)", "warn"); return; }
    // จำนวนมากผิดปกติในครั้งเดียว — ให้ยืนยันกันพิมพ์เกิน (เช่น 100 กลายเป็น 1000)
    if (qty > 2000 && !(await askConfirm({
      message: t(`จำนวน ${qty.toLocaleString()} ชิ้นในการบันทึกครั้งเดียว มากผิดปกติ — ยืนยันหรือไม่?`,
                 `${qty.toLocaleString()} pieces in a single record is unusually large — confirm?`),
      tone: "warn",
      confirmText: t("ยืนยัน", "Confirm"),
      cancelText: t("ยกเลิก", "Cancel"),
    }))) return;
    // หมายเหตุ: ไม่เด้ง confirm "ทำซ้ำ (rework)" อีกแล้ว — เตือนแบบไม่บล็อก (ไม่หยุดเวลา) และเฉพาะ
    //   ตอน "เกินจำนวนสั่ง" เท่านั้น (ดูป้าย ⚠ เกินจำนวนสั่ง ในการ์ด · ยังไม่เกิน = ไม่เตือน)
    doSave();
  }

  // ── บันทึก (เรียกจากปุ่ม OK) ─────────────────────────────────────────────
  async function doSave() {
    if (savingRef.current) return;      // กันกด OK รัวๆ → บันทึกซ้ำ (re-entrancy)
    savingRef.current = true;
    setBusy(true);
    // สร้าง client_id ครั้งเดียวต่อการบันทึกชิ้นนี้ · ถ้ากด OK ซ้ำ (retry หลังพลาด) ใช้ตัวเดิม
    // → ฝั่ง DB dedup ด้วย client_id ได้ กันบันทึกซ้ำแม้ error ที่ไม่ใช่เน็ต (เช่น insert สำเร็จแต่ตอบกลับพลาด)
    // ★ ต้องเป็น "UUID จริง" เสมอ (คอลัมน์ client_id เป็น uuid) — newClientId() รับประกันได้แม้เครื่อง
    //   ไม่มี crypto.randomUUID (เปิดผ่าน http / webview เก่า) · เดิมใช้ fallback ที่ไม่ใช่ UUID → insert พัง
    if (!clientIdRef.current) clientIdRef.current = newClientId();
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
        const msg = res?.reason === "project_closed"
          ? t("โปรเจกต์นี้ปิดแล้ว — บันทึกไม่ได้ · แจ้งแอดมินถ้าต้องแก้งาน", "Project closed — can't save · ask admin to reopen")
          : (res?.message || "บันทึกไม่สำเร็จ");
        flash(msg, "warn");
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

  // ── โหมดของหน้านี้ "ล็อกตามแผนก" (dept) แล้ว — assembly/packing = โหมดประกอบ/แพ็ก · machine = งานเครื่อง ──
  const isAsm = dept === "assembly" || dept === "packing";
  // นับ "สะสม" = ที่ติดตั้งไปแล้ว (สเตชันก่อน) + ที่สแกนรอบนี้ · ครบเมื่อทุกบรรทัด ≥ qty
  const asmHave = (pmId) =>
    (asmParent?.installed || []).filter((x) => x.child_pm_id === pmId).length +
    asmChildren.filter((c) => c.child_pm_id === pmId).length;
  const asmComplete = !!asmParent && asmParent.bom.every((b) => asmHave(b.child_pm_id) >= b.qty);

  // เปลี่ยนขั้นตอน → ล้างสถานะประกอบที่ค้าง (กันสับสนข้ามงาน)
  useEffect(() => { setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false); }, [op?.id]);

  function asmReset() { setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false); }
  function asmRemoveChild(unitId) { setAsmChildren((prev) => prev.filter((c) => c.unit_id !== unitId)); }
  function asmOpenCam() {
    if (machineOps.length > 1 && !op) { flash(t("เลือกขั้นตอนก่อนสแกน", "pick an operation first"), "warn"); return; }   // ★ ต้องเลือกขั้นตอนก่อน
    warmAudio(); setStep(STEP.SCAN);
  }
  function photoCapture(blob, url) { setPackPhotos((prev) => [...prev, { blob, url }]); }
  function photoRemove(i) { setPackPhotos((prev) => prev.filter((_, idx) => idx !== i)); }

  const asmReason = (r) => {
    const m = {
      incomplete: t("ยังไม่ครบตาม BOM", "not complete per BOM"),
      not_in_bom: t("มีชิ้นไม่อยู่ใน BOM", "a part is not in this BOM"),
      child_used: t("มีชิ้นถูกใช้ในเบอร์อื่นแล้ว", "a part is already used elsewhere"),
      already_installed: t("มีชิ้นติดตั้งในเบอร์นี้ไปแล้ว", "a part is already installed here"),
      child_incomplete: t("มีชิ้นที่ยังประกอบไม่เสร็จ — ทำให้เสร็จก่อน", "a sub-part isn't finished yet"),
      over_bom: t("ใส่เกินจำนวนที่ BOM กำหนด", "exceeds the BOM quantity"),
      duplicate_child: t("มีชิ้นซ้ำ", "duplicate part"),
      child_not_found: t("มีชิ้นไม่พบในระบบ", "a part QR not found"),
      no_bom: t("เบอร์นี้ยังไม่ได้กำหนด BOM", "no BOM set for this number"),
      parent_not_found: t("ไม่พบเบอร์แม่", "parent not found"),
      no_machine: t("บัญชีไม่ได้ผูกเครื่อง", "account has no machine"),
      unauthorized: t("เซสชันหมดอายุ — ล็อกอินใหม่", "session expired"),
    };
    return m[r] || t("บันทึกประกอบไม่สำเร็จ", "assembly failed");
  };

  // สแกน/พิมพ์ QR โหมดประกอบ: ยังไม่มีเบอร์แม่ → โหลดสถานะสะสม (BOM + ที่ติดไปแล้ว) · มีแล้ว → เพิ่มเป็นลูกรอบนี้
  async function asmScan(code) {
    const s = String(code || "").trim();
    if (!s) return false;
    if (machineOps.length > 1 && !op) { errorBeep(); flash(t("เลือกขั้นตอนก่อนสแกน", "pick an operation first"), "warn"); return false; }   // ★ กันบันทึกผิดขั้นตอน (op=null) เหมือนหน้าเครื่อง
    setBusy(true);
    let u = null;
    try { u = await findUnitByQr(s); } catch { u = null; }
    setBusy(false);
    if (!u) { errorBeep(); flash(t("ไม่พบ QR นี้ในระบบ", "QR not found"), "warn"); return false; }

    if (!asmParent) {
      if (u.part_master?.projects?.status === "closed") {
        errorBeep(); flash(t("โปรเจกต์นี้ปิดแล้ว — ประกอบเพิ่มไม่ได้", "project closed"), "warn"); return false;
      }
      setBusy(true);
      let st = null;
      try { st = await getAssemblyState(u.qr_code); } catch { st = null; }
      setBusy(false);
      if (!st) { errorBeep(); flash(t("โหลดสถานะไม่ได้ — โหมดนี้ต้องออนไลน์", "couldn't load state — needs online"), "warn"); return false; }
      if (!st.ok) {
        errorBeep();
        flash(st.reason === "no_bom"
          ? t("เบอร์นี้ยังไม่ได้กำหนด BOM — ตั้งที่หน้า Part Master ก่อน", "no BOM set — set it in Part Master")
          : asmReason(st.reason), "warn");
        return false;
      }
      if (st.parent?.status === "finished") {
        flash(t("เบอร์นี้ประกอบครบแล้ว (เปิดดูได้ ใส่เพิ่มไม่ได้)", "already complete (view only)"), "warn");
      } else {
        tickBeep(); flash(t(`เบอร์แม่: ${u.part_master?.part_no || u.qr_code}`, `Parent: ${u.part_master?.part_no || u.qr_code}`), "ok");
      }
      // เติมความยาว + kind ให้ลูกแต่ละตัว (ไว้วาดผัง + ป้ายจุดติดตั้ง) — ถ้าโหลดไม่ได้ก็ยังใช้ต่อได้
      let bom = st.bom || [];
      try {
        const meta = await getPartMeta(bom.map((b) => b.child_pm_id));
        bom = bom.map((b) => ({
          ...b,
          length_mm: b.length_mm ?? meta[b.child_pm_id]?.default_length_mm ?? null,
          kind: b.kind || meta[b.child_pm_id]?.kind || "part",
        }));
      } catch { /* ไม่เป็นไร ใช้ bom เดิม */ }
      setAsmParent({ unit: u, parentKind: u.part_master?.kind || null, bom, installed: st.installed || [] });
      setAsmChildren([]); asmClientRef.current = null;
      return true;
    }

    // เป็น "ลูก" (ที่จะติดตั้งรอบนี้)
    if (u.id === asmParent.unit.id) { flash(t("นี่คือเบอร์แม่เอง", "this is the parent"), "warn"); return false; }
    if (asmChildren.some((c) => c.unit_id === u.id)) { flash(t("สแกนชิ้นนี้ไปแล้วรอบนี้", "already scanned this round"), "warn"); return false; }
    if ((asmParent.installed || []).some((x) => x.child_unit_id === u.id)) {
      flash(t("ชิ้นนี้ติดตั้งไปแล้ว (สเตชันก่อนหน้า)", "already installed (earlier station)"), "warn"); return false;
    }
    const inBom = asmParent.bom.find((b) => b.child_pm_id === u.part_master_id);
    if (!inBom) { errorBeep(); flash(t("ชิ้นนี้ไม่อยู่ใน BOM ของเบอร์แม่", "not in this BOM"), "warn"); return false; }
    // ลูกที่ "เป็นของประกอบเอง" (ไม่ใช่ part) ต้องประกอบเสร็จ (finished) ก่อนถึงใส่ได้
    if (u.part_master?.kind && u.part_master.kind !== "part" && u.status !== "finished") {
      errorBeep(); flash(t(`${inBom.part_no} ยังประกอบไม่เสร็จ — ใส่ไม่ได้`, `${inBom.part_no} isn't finished yet`), "warn"); return false;
    }
    const have = asmHave(u.part_master_id);
    if (have >= inBom.qty) { flash(t(`${inBom.part_no} ครบตาม BOM แล้ว`, `${inBom.part_no} already complete`), "warn"); return false; }
    tickBeep(); flash(`+ ${inBom.part_no} (${have + 1}/${inBom.qty})`, "ok");
    setAsmChildren((prev) => [...prev, { unit_id: u.id, qr: u.qr_code, child_pm_id: u.part_master_id, part_no: inBom.part_no }]);
    return true;
  }
  const asmDecoded = async (qr) => { await asmScan(qr); return false; };          // false = กล้องสแกนต่อ (ใส่ลูกได้เรื่อยๆ)
  const asmManual  = async (text) => { await asmScan(text); return { ok: false }; };

  // บันทึก "รอบนี้" (สะสมได้ — ไม่ต้องครบก็เซฟ) · ครบ BOM สะสม → ปิดงานอัตโนมัติ · ไม่ครบ → รีเฟรชยอด แล้วสแกนต่อ/ส่งสเตชันถัดไป
  async function asmConfirm() {
    if (!asmParent || asmChildren.length === 0 || savingRef.current) return;
    const isPack = dept === "packing";
    savingRef.current = true; setBusy(true);
    if (!asmClientRef.current) asmClientRef.current = newClientId();
    try {
      // แพ็ก: อัปรูปขึ้น Storage ก่อน (ถ้าถ่ายไว้) — พังตรงนี้ = หยุด ให้ลองใหม่ (ยังไม่บันทึก)
      let photoPaths = [];
      if (isPack && packPhotos.length > 0) {
        try {
          for (const p of packPhotos) photoPaths.push(await uploadPackingPhoto(p.blob, asmParent.unit.qr_code));
        } catch (e) {
          errorBeep(); flash(t("อัปรูปไม่สำเร็จ — ตรวจเน็ต/สิทธิ์ Storage แล้วลองใหม่", "photo upload failed — check network/storage"), "warn");
          setBusy(false); savingRef.current = false; return;
        }
      }
      const res = await recordAssembly({
        parentQr: asmParent.unit.qr_code,
        childQrs: asmChildren.map((c) => c.qr),
        operationId: op?.id || null,
        clientId: asmClientRef.current,
      });
      if (res && res.ok) {
        if (photoPaths.length) { try { await recordPackingPhotos(asmParent.unit.qr_code, photoPaths); } catch { /* ผูกไม่ได้แต่ไฟล์อยู่ Storage */ } }
        tickBeep();
        if (res.complete) {
          flash(isPack ? t("✓ แพ็กครบแล้ว — ปิดงาน", "✓ Packed & complete") : t("✓ ประกอบครบแล้ว — ปิดงาน", "✓ Assembled & complete"), "ok");
          setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false);
        } else {
          const added = res.added ?? asmChildren.length;
          flash(t(`✓ บันทึกแล้ว ${added} ชิ้น — ยังไม่ครบ BOM (ส่งต่อสเตชันถัดไปได้)`, `✓ Saved ${added} — not complete yet`), "ok");
          // รีเฟรชยอดสะสมจากเซิร์ฟเวอร์ → เห็น "ที่ติดแล้ว" อัปเดต · เคลียร์รายการรอบนี้ · รอบใหม่ใช้ client_id ใหม่
          let st = null;
          try { st = await getAssemblyState(asmParent.unit.qr_code); } catch { st = null; }
          if (st && st.ok) setAsmParent((p) => (p ? { ...p, bom: st.bom || p.bom, installed: st.installed || [] } : p));
          setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false);
        }
        reload();
      } else {
        errorBeep(); flash(asmReason(res?.reason), "warn");
      }
    } catch (e) {
      const off = typeof navigator !== "undefined" && navigator.onLine === false;
      errorBeep();
      flash(off ? t("โหมดประกอบ/แพ็กต้องออนไลน์ (ตรวจชิ้นกับระบบ)", "assembly/packing needs to be online") : t("บันทึกไม่สำเร็จ — ลองใหม่", "failed — retry"), "warn");
    } finally { setBusy(false); savingRef.current = false; }
  }

  // ── ยามแผนก (department gate): หน้านี้รับเฉพาะบัญชีของแผนกตัวเอง ──────────────
  const acctDepts = opsLoaded
    ? Array.from(new Set(allOps.length ? allOps.map(opDept) : ["machine"]))
    : [];
  if (!opsLoaded) return <StnDeptChecking dept={dept} t={t} />;   // รอรู้ "แผนกที่บัญชีทำได้" ก่อน (กันจอกระพริบ/เด้งผิด)
  if (!acctDepts.includes(dept)) {
    // บัญชีนี้ไม่ใช่แผนกนี้ → เด้งเข้า "แผนกแรก" ของบัญชีอัตโนมัติ (กันลูป: first ต่างจาก dept แน่ เพราะ !includes(dept))
    const first = acctDepts.find((d) => DEPT_META[d]);
    if (first && typeof window !== "undefined") { window.location.replace(DEPT_META[first].path); return <StnDeptChecking dept={first} t={t} />; }
    return <StnDeptRedirect dept={dept} acctDepts={acctDepts} onLogout={onLogout} t={t} />;   // ไม่มีแผนกให้ไป → fallback
  }

  const recording = step !== STEP.IDLE;
  const scanArmed = qty > 0 && !!unit;

  // WorkArea ตัวเดียว ใช้ได้ทั้งหน้า machine (โหมดเครื่อง) และ assembly/packing (โหมดประกอบ/แพ็ก)
  const workAreaEl = (
    <WorkArea
      step={step} elapsed={elapsed} unit={unit} progress={progress} qty={qty} setQty={setQty}
      status={status} setStatus={setStatus} busy={busy}
      onDecoded={onDecoded} onManualEntry={onManualEntry} onPickUnit={onPickUnit}
      confirmCancel={confirmCancel} confirmPart={confirmPart}
      closeScan={closeScan} rescan={rescan} dupCount={dupCount}
      isAsm={isAsm} asmType={dept === "packing" ? "packing" : "assembly"} asmParent={asmParent} asmChildren={asmChildren} asmComplete={asmComplete}
      asmDecoded={asmDecoded} asmManual={asmManual} asmScan={asmScan}
      asmConfirm={asmConfirm} asmRemoveChild={asmRemoveChild} asmReset={asmReset} asmOpenCam={asmOpenCam}
      packPhotos={packPhotos} photoOpen={photoOpen} openPhoto={() => setPhotoOpen(true)} closePhoto={() => setPhotoOpen(false)}
      photoCapture={photoCapture} photoRemove={photoRemove}
    />
  );

  // ── หน้า assembly / packing = เลย์เอาต์เฉพาะแผนก (ไม่มีตารางเครื่อง/นาฬิกา/ความยาววัสดุ) ──
  if (isAsm) {
    const meta = DEPT_META[dept];
    return (
      <div className={`stn-shell stn-asm-shell dept-${dept}`}>
        {(!online || pending > 0) && (
          <div className={`stn-netbar${online ? " syncing" : " offline"}`}>
            {!online ? (
              <span><Icon name="wifiOff" size={15} className="stn-ico" />{t("ออฟไลน์", "Offline")}{pending > 0 ? ` · ${t("ค้างซิงค์", "pending sync")} ${pending}` : ` · ${t("โหมดนี้ต้องออนไลน์", "this mode needs online")}`}</span>
            ) : (
              <span><Icon name="refresh" size={15} className="stn-ico" />{t("กำลังซิงค์งานค้าง", "Syncing")} · {pending}</span>
            )}
          </div>
        )}
        {storageFull && (
          <div className="stn-rejected" onClick={() => setStorageFull(false)} style={{ background: "#b91c1c" }}>
            <Icon name="warn" size={15} className="stn-ico" />{t("ที่เก็บข้อมูลเต็ม — งานอาจไม่ถูกบันทึก! แจ้งผู้ดูแล (แตะเพื่อซ่อน)", "Storage full — notify admin (tap to hide)")}
          </div>
        )}
        {rejected > 0 && (
          <button type="button" className="stn-rejected" onClick={() => setShowRejected(true)}>
            <Icon name="warn" size={15} className="stn-ico" />{t("ซิงค์ไม่สำเร็จ", "Failed to sync")} {rejected} — {t("แตะเพื่อจัดการ", "tap to manage")}
          </button>
        )}
        {showRejected && (
          <RejectedPanel t={t} onClose={() => setShowRejected(false)}
            onRetry={() => { retryRejected(); setShowRejected(false); flash(t("กำลังลองซิงค์ใหม่…", "Retrying sync…"), "ok"); }}
            onClear={() => { clearRejected(); setShowRejected(false); flash(t("ล้างคิวที่ซิงค์ไม่สำเร็จแล้ว", "Cleared failed-sync queue"), "ok"); }} />
        )}

        <div className="stn-asm-topbar">
          <div className="stn-asm-ident">
            <span className={`stn-asm-badge dept-${dept}`}>{lang === "en" ? meta.en : meta.th}</span>
            <span className="stn-asm-machine">{machine ? machine.code : "—"}</span>
            {machine?.name ? <span className="stn-asm-mname">{machine.name}</span> : null}
          </div>
          <div className="stn-asm-today" title={t("ยอดที่บันทึกวันนี้", "Recorded today")}>
            <span className="n">{fmt(daily.quantity)}</span>
            <span className="u">{t("วันนี้", "today")}</span>
          </div>
          <div className="stn-asm-tools">
            <StnLangToggle />
            {!isStandalone() && (
              <button className="stn-logout stn-fs" onClick={toggleFullscreen} title={t("เต็มจอ", "Fullscreen")}><Icon name="expand" size={15} className="stn-ico" />{t("เต็มจอ", "Full")}</button>
            )}
            <button className="stn-logout" onClick={onLogout} title={t("ออกจากระบบ", "Log out")}><Icon name="logout" size={15} className="stn-ico" />{t("ออก", "Exit")}</button>
          </div>
        </div>

        {machineOps.length > 1 && (
          <div className="stn-oppick">
            <span className="stn-oppick-lbl">{t("ขั้นตอน", "Operation")}:</span>
            {machineOps.map((o) => (
              <button key={o.id} className={`stn-oppick-btn${op?.id === o.id ? " sel" : ""}`} onClick={() => setOp(o)}>{o.name}</button>
            ))}
            {!op && <span className="stn-oppick-hint">← {t("แตะเลือกก่อน", "pick first")}</span>}
          </div>
        )}

        <div className="stn-asm-main">
          {workAreaEl}
          {toast && <div className={`stn-toast ${toast.tone}`}>{toast.text}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="stn-shell">
      {/* แถบสถานะเน็ต — โชว์เมื่อ "ออฟไลน์" หรือมีงาน "ค้างซิงค์" (ออนไลน์กำลังดันขึ้น) */}
      {(!online || pending > 0) && (
        <div className={`stn-netbar${online ? " syncing" : " offline"}`}>
          {!online ? (
            <span><Icon name="wifiOff" size={15} className="stn-ico" />{t("ออฟไลน์", "Offline")}
              {pending > 0
                ? ` · ${t("ค้างซิงค์", "pending sync")} ${pending} ${t("ชิ้น", "pcs")}`
                : ` · ${t("ทำงานต่อได้ตามปกติ", "you can keep working")}`}
            </span>
          ) : (
            <span><Icon name="refresh" size={15} className="stn-ico" />{t("กำลังซิงค์งานค้าง", "Syncing")} · {pending} {t("ชิ้น", "pcs")}</span>
          )}
        </div>
      )}
      {storageFull && (
        <div className="stn-rejected" onClick={() => setStorageFull(false)}
          style={{ background: "#b91c1c" }}
          title={t("ที่เก็บข้อมูลในเครื่องเต็ม", "Device storage full")}>
          <Icon name="warn" size={15} className="stn-ico" />{t("ที่เก็บข้อมูลเต็ม — งานอาจไม่ถูกบันทึก! ปิดแอปอื่น/ล้างข้อมูลเบราว์เซอร์ แล้วลองใหม่ · แจ้งผู้ดูแล (แตะเพื่อซ่อน)",
                "Storage full — work may not be saved! Close other apps / clear browser data, then retry · notify admin (tap to hide)")}
        </div>
      )}
      {rejected > 0 && (
        <button type="button" className="stn-rejected" onClick={() => setShowRejected(true)}
          title={t("แตะเพื่อจัดการคิวที่ซิงค์ไม่สำเร็จ", "Tap to manage failed-sync queue")}>
          <Icon name="warn" size={15} className="stn-ico" />{t("ซิงค์ไม่สำเร็จ", "Failed to sync")} {rejected} {t("ชิ้น", "pcs")} — {t("แตะเพื่อจัดการ", "tap to manage")}
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
          <button className="stn-logout stn-toplogout" onClick={onLogout} title="ออกจากระบบ" aria-label="ออกจากระบบ"><Icon name="logout" size={15} className="stn-ico" />ออก</button>
          <StnLangToggle />
          {/* ซ่อนปุ่มเต็มจอเมื่อเปิดแบบติดตั้ง (PWA standalone — รวม iPad/iOS) */}
          {!isStandalone() && (
            <button className="stn-logout stn-fs" onClick={toggleFullscreen} title="เต็มจอ" aria-label="เต็มจอ"><Icon name="expand" size={15} className="stn-ico" />เต็มจอ</button>
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
            {workAreaEl}
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
function AsmManualInput({ onSubmit, placeholder, t }) {
  const [v, setV] = useState("");
  return (
    <form className="stn-asm-manual" onSubmit={(e) => { e.preventDefault(); const s = v.trim(); if (!s) return; onSubmit(s); setV(""); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} inputMode="text" autoCapitalize="characters" />
      <button type="submit">{t("เพิ่ม", "Add")}</button>
    </form>
  );
}

// ── ประกอบ: จำแนกบทบาทชิ้นจากชื่อ (ใช้วาดผัง + ป้ายจุดติดตั้ง) ────────────────
function asmRole(name) {
  const d = String(name || "").toUpperCase();
  if (/SCREW|BOLT|RIVET|\bNUT\b|WASHER/.test(d)) return "fastener";
  if (/MULLION/.test(d) && !/STIFF/.test(d)) return "mullion";
  if (/TRANSOM|\bSILL\b|\bRAIL\b|\bHEAD\b/.test(d)) return "transom";
  if (/GLASS/.test(d) && !/SUPPORT|BEAD|SPACER|GASKET|SETTING|CLIP/.test(d)) return "glass";
  if (/BACKPAN|GALVAN/.test(d)) return "infill";
  return "accessory";
}

// ── หน้าประกอบ (โหมดเต็ม): ตารางชิ้นงาน (ซ้าย) + ผังแผง/ผังกล่องอัตโนมัติ (ขวา) ──
//    แตะชิ้น → ผังไฮไลต์ตำแหน่งที่ต้องติด · ยังสแกนบันทึกได้เหมือนเดิม
function AsmWorksheet({ asmParent, asmChildren, prevFor, sessFor, asmComplete, asmReset, asmOpenCam, asmScan, asmConfirm, asmRemoveChild, busy, t, isPack, childWord, confirmVerb, openPhoto, packPhotos = [], photoRemove }) {
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); }, [asmParent?.unit?.id]);

  const rows = (asmParent?.bom || []).map((b, i) => {
    const prev = prevFor(b.child_pm_id), sess = sessFor(b.child_pm_id), have = prev + sess;
    const done = have >= b.qty;
    return {
      ...b, idx: i + 1, prev, sess, have, done,
      stt: done ? "done" : (have > 0 ? "partial" : "todo"),
      role: asmRole(b.part_name), len: (b.length_mm != null ? Number(b.length_mm) : null),
      isSub: !!(b.kind && b.kind !== "part"),
    };
  });
  const total = rows.length, doneLines = rows.filter((r) => r.done).length;
  const pct = total ? Math.round((doneLines / total) * 100) : 0;

  const mullions = rows.filter((r) => r.role === "mullion");
  const transoms = rows.filter((r) => r.role === "transom");
  const glasses = rows.filter((r) => r.role === "glass");
  const useElev = mullions.length > 0 && glasses.length > 0;   // เหมือนแผงกระจก → วาด elevation
  const mL = mullions[0], mR = mullions[1] || mullions[0];
  const tItem = transoms.find((x) => !/SILL/i.test(x.part_name)) || transoms[0];
  const sItem = transoms.find((x) => /SILL/i.test(x.part_name)) || transoms[transoms.length - 1];
  const sortedGlass = glasses.slice().sort((a, b) => (/SPANDREL/i.test(a.part_name) ? 1 : 0) - (/SPANDREL/i.test(b.part_name) ? 1 : 0));
  const visionPm = (sortedGlass.find((g) => !/SPANDREL/i.test(g.part_name)) || sortedGlass[0] || {}).child_pm_id;
  const spandrelPm = (sortedGlass.find((g) => /SPANDREL/i.test(g.part_name)) || {}).child_pm_id;

  function place(r) {
    const d = String(r.part_name || "").toUpperCase();
    if (!useElev) return { label: "", target: r.child_pm_id, confident: true };
    if (r.role === "mullion") return { label: r === mL ? "เสาซ้าย" : (r === mR ? "เสาขวา" : "เสาตั้ง"), target: r.child_pm_id, confident: true };
    if (r.role === "transom") return { label: /SILL/.test(d) ? "ธรณีล่าง" : (/HEAD/.test(d) ? "คานบน" : "คานขวาง"), target: r.child_pm_id, confident: true };
    if (r.role === "glass") return { label: /SPANDREL/.test(d) ? "ช่องล่าง · สแปนเดรล" : "ช่องบน · กระจกใส", target: r.child_pm_id, confident: true };
    if (/BEAD/.test(d)) return { label: "รอบกระจก", target: visionPm, confident: false };
    if (/SUPPORT/.test(d)) return { label: "ร่องรับกระจก", target: visionPm, confident: false };
    if (/STIFF/.test(d)) return { label: "เสริมในเสา", target: mL ? mL.child_pm_id : null, confident: false };
    if (r.role === "infill" || /PRESSING/.test(d)) return { label: "หลังช่องทึบ", target: spandrelPm, confident: false };
    if (r.role === "fastener") return { label: "สกรูยึด", target: null, confident: false };
    return { label: "", target: null, confident: false };
  }
  rows.forEach((r) => (r.place = place(r)));

  const selRow = rows.find((r) => r.child_pm_id === sel) || null;
  const strongPm = selRow && selRow.place.confident ? selRow.place.target : null;
  const softPm = selRow && !selRow.place.confident ? selRow.place.target : null;
  const hcls = (pm) => (pm != null && pm === strongPm ? " hl" : (pm != null && pm === softPm ? " hlsoft" : ""));

  // ── ผัง elevation (เสา/คาน/กระจก) ──
  function renderElevation() {
    const L = 200, R = 320, T = 44, B = 356, MULL = 14, HS = 10, TT = 9;
    const innerT = T + HS, innerB = B - HS, innerH = innerB - innerT;
    const innerX = L + MULL, innerW = (R - MULL) - innerX;
    const nZ = Math.max(1, sortedGlass.length);
    const avail = innerH - TT * (nZ - 1);
    const sumL = sortedGlass.reduce((s, g) => s + (g.len || 1), 0) || 1;
    let y = innerT; const zones = [];
    sortedGlass.forEach((g, i) => { const zh = Math.round(avail * (g.len || 1) / sumL); zones.push({ g, y0: y, y1: y + zh }); y += zh; if (i < nZ - 1) y += TT; });
    const stFill = (r, sp) => r && r.done ? "rgba(22,184,119,.5)" : (sp ? "rgba(200,170,70,.16)" : "rgba(80,160,220,.18)");
    const memFill = (r) => r && r.done ? "var(--green, #16b877)" : (r && r.stt === "partial" ? "#7a6a2f" : "#26493c");
    const Balloon = ({ r, bx, by, tx, ty }) => r ? (
      <g className={"asw-bl " + (r.done ? "done " : "") + (sel === r.child_pm_id ? "hl" : "")} onClick={() => setSel(r.child_pm_id)} style={{ cursor: "pointer" }}>
        <line x1={bx} y1={by} x2={tx} y2={ty} /><circle cx={bx} cy={by} r={12.5} /><text x={bx} y={by + 4}>{r.idx}</text>
      </g>
    ) : null;
    return (
      <svg viewBox="146 28 232 348" className="asw-elev" role="img" aria-label="ผังแผง">
        {zones.map((z, i) => {
          const sp = /SPANDREL/i.test(z.g.part_name);
          return (
            <g key={"z" + i}>
              <rect className={"zone " + z.g.stt + hcls(z.g.child_pm_id)} x={innerX} y={z.y0} width={innerW} height={z.y1 - z.y0} fill={stFill(z.g, sp)} onClick={() => setSel(z.g.child_pm_id)} style={{ cursor: "pointer" }} />
              <text className="zlab" x={innerX + innerW / 2} y={(z.y0 + z.y1) / 2 + 4}>{sp ? "SPANDREL" : "VISION"}</text>
            </g>
          );
        })}
        {zones.slice(0, -1).map((z, i) => (
          <rect key={"t" + i} className={"mem" + hcls(tItem && tItem.child_pm_id)} x={innerX} y={z.y1} width={innerW} height={TT} fill={memFill(tItem)} onClick={() => tItem && setSel(tItem.child_pm_id)} style={{ cursor: "pointer" }} />
        ))}
        <rect className={"mem" + hcls(tItem && tItem.child_pm_id)} x={L} y={T} width={R - L} height={HS} fill={memFill(tItem)} onClick={() => tItem && setSel(tItem.child_pm_id)} style={{ cursor: "pointer" }} />
        <rect className={"mem" + hcls(sItem && sItem.child_pm_id)} x={L} y={innerB} width={R - L} height={HS} fill={memFill(sItem)} onClick={() => sItem && setSel(sItem.child_pm_id)} style={{ cursor: "pointer" }} />
        <rect className={"mem" + hcls(mL && mL.child_pm_id)} x={L} y={T} width={MULL} height={B - T} fill={memFill(mL)} onClick={() => mL && setSel(mL.child_pm_id)} style={{ cursor: "pointer" }} />
        <rect className={"mem" + hcls(mR && mR.child_pm_id)} x={R - MULL} y={T} width={MULL} height={B - T} fill={memFill(mR)} onClick={() => mR && setSel(mR.child_pm_id)} style={{ cursor: "pointer" }} />
        <rect className="asw-outline" x={L} y={T} width={R - L} height={B - T} />
        <Balloon r={mL} bx={165} by={118} tx={L} ty={118} />
        <Balloon r={mR} bx={355} by={108} tx={R} ty={108} />
        {tItem ? <Balloon r={tItem} bx={355} by={zones.length > 1 ? zones[0].y1 + TT / 2 : 70} tx={R - MULL} ty={zones.length > 1 ? zones[0].y1 + TT / 2 : 70} /> : null}
        {sItem ? <Balloon r={sItem} bx={165} by={innerB + 5} tx={L + 22} ty={innerB + 5} /> : null}
        {zones.map((z, i) => <Balloon key={"gb" + i} r={z.g} bx={355} by={i === 0 ? 150 : 300} tx={R - MULL} ty={(z.y0 + z.y1) / 2} />)}
      </svg>
    );
  }

  // ── ผังกล่อง (ซับ/ชิ้นงานทั่วไป) ──
  function renderBoxes() {
    const bars = rows.filter((r) => r.role !== "fastener");
    const fasts = rows.filter((r) => r.role === "fastener");
    const maxLen = Math.max(1, ...bars.map((r) => r.len || 1));
    const boxW = (r) => Math.round(46 + Math.sqrt(r.len || 1) / Math.sqrt(maxLen) * 150);
    return (
      <>
        <div className="asw-bwrap">
          {bars.map((r) => {
            const w = boxW(r), wide = w >= 96;
            return (
              <div key={r.child_pm_id} className={"asw-box " + r.stt + (sel === r.child_pm_id ? " hl" : "") + (wide ? " wide" : " narrow")} style={{ width: w, height: 44 }} onClick={() => setSel(r.child_pm_id)} title={`#${r.idx} ${r.part_no}`}>
                <span className="bn">{r.idx}</span>
                {wide ? <span className="blab"><span className="bpn">{r.part_no}</span><span className="bmeta">{r.len != null ? r.len : ""}{r.qty > 1 ? ` ·×${r.qty}` : ""}</span></span> : (r.qty > 1 ? <span className="bq">×{r.qty}</span> : null)}
                {r.done ? <span className="btick">✓</span> : null}
              </div>
            );
          })}
        </div>
        {fasts.length > 0 && <div className="asw-flabel">{t("สกรู/ตัวยึด", "Fasteners")}</div>}
        {fasts.length > 0 && (
          <div className="asw-fstrip">
            {fasts.map((r) => (
              <div key={r.child_pm_id} className={"asw-fchip " + r.stt + (sel === r.child_pm_id ? " hl" : "")} onClick={() => setSel(r.child_pm_id)}>
                <span className="bn">{r.idx}</span><span className="fpn">{r.part_no}</span><span className="fq">×{r.qty}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  const parentNo = asmParent.unit.part_master?.part_no || asmParent.unit.qr_code;
  const parentName = asmParent.unit.part_master?.part_name || "";
  const pkind = asmParent.parentKind;
  const kindTh = pkind === "panel" ? "แผง" : pkind === "subassembly" ? "ซับประกอบ" : pkind === "package" ? "แพ็ก" : "";

  return (
    <div className="asw">
      <div className="asw-head">
        <div className="asw-hgrow">
          <div className="asw-hlabel">{isPack ? t("เบอร์แพ็ก", "PACKAGE") : t("เบอร์แม่", "PARENT")}{kindTh ? ` · ${kindTh}` : ""}</div>
          <div className="asw-hno">{parentNo}{parentName ? <span className="asw-hname">{parentName}</span> : null}</div>
          <div className="asw-hbar"><i style={{ width: pct + "%" }} /></div>
          <div className="asw-hmeta"><span>{t("ครบแล้ว", "done")} {doneLines}/{total} {t("รายการ", "items")}</span><span>{pct}%</span></div>
        </div>
        <div className="asw-ring" style={{ "--p": pct }}><i>{pct}%</i></div>
        <button className="asw-change" onClick={asmReset}>{t("เปลี่ยน", "Change")}</button>
      </div>

      <div className="asw-split">
        <div className="asw-left">
          <div className="asw-stitle">{t("รายการชิ้นงานที่ต้องใช้", "Parts needed")} <span className="hint">· {total} {t("รายการ · แตะแถวดูตำแหน่ง", "items · tap a row")}</span></div>
          <div className="asw-sheet">
            <table className="asw-tab">
              <thead><tr>
                <th className="c-n">#</th><th className="c-pn">{t("เบอร์ชิ้น", "Part No")}</th>
                <th className="c-desc">{t("รายละเอียด · จุดติดตั้ง", "Description · where")}</th>
                <th className="c-len">{t("ขนาด/ยาว", "Size")}</th><th className="c-qty">{t("จำนวน", "Qty")}</th><th className="c-prog">{t("ประกอบแล้ว", "Done")}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.child_pm_id} className={"asw-r " + r.stt + (sel === r.child_pm_id ? " hl" : "")} onClick={() => setSel(r.child_pm_id)}>
                    <td className="c-n"><span className="nb">{r.idx}</span></td>
                    <td className="c-pn">{r.part_no}{r.isSub ? <span className="asw-subtag">{t("ซับ", "sub")}</span> : null}</td>
                    <td className="c-desc">{r.part_name || ""}{r.place.label ? <span className={"asw-postag " + (r.place.confident ? "sure" : "soft")}>{r.place.label}</span> : null}</td>
                    <td className="c-len">{r.len != null ? r.len : "—"}{r.len != null ? <span className="u"> mm</span> : null}</td>
                    <td className="c-qty">{r.qty}</td>
                    <td className="c-prog"><span className="chk">{r.done ? "✓" : (r.have > 0 ? "◐" : "○")}</span>{r.have}/{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="asw-right">
          <div className="asw-stitle">{useElev ? t("ผังแผง", "Panel view") : t("ผังชิ้นส่วน", "Parts view")} <span className="hint">· {useElev ? t("แตะชิ้น = ไฮไลต์ตำแหน่ง", "tap = where it goes") : t("แตะชิ้น = ไฮไลต์", "tap to highlight")}</span></div>
          <div className={"asw-draw " + (useElev ? "elev" : "box")}>
            {useElev ? renderElevation() : renderBoxes()}
            {selRow ? (
              <div className="asw-callout">
                <span className="cn">{selRow.idx}</span>
                <span className="cpn">{selRow.part_no}</span>
                {!useElev
                  ? <span className="cmuted">{selRow.part_name || ""}</span>
                  : (selRow.place.confident && selRow.place.label
                    ? <span className="cpos">{t("อยู่ตรงนี้ ·", "here ·")} {selRow.place.label}</span>
                    : (selRow.place.target != null
                      ? <span className="cmuted">{t("แถวๆ", "near")} {selRow.place.label} · {t("ดูแบบจริงเพื่อจุดแน่นอน", "see real drawing")}</span>
                      : <span className="cmuted">{selRow.part_name || ""} · {t("ไม่มีจุดในผังจำลอง", "not in schematic")}</span>))}
              </div>
            ) : null}
          </div>
          <div className="asw-actions">
            {asmChildren.length > 0 && (
              <div className="asw-scanned">
                {asmChildren.map((c) => (
                  <span key={c.unit_id} className="asw-chip" onClick={() => asmRemoveChild(c.unit_id)} title={t("แตะเพื่อเอาออก", "tap to remove")}>{c.part_no} · {c.qr} ✕</span>
                ))}
              </div>
            )}
            <div className="asw-arow">
              <button className="asw-scan" onClick={asmOpenCam}><Icon name="camera" size={16} className="stn-ico" />{t(`สแกน${childWord}`, `Scan ${childWord}`)}</button>
              <AsmManualInput onSubmit={asmScan} placeholder={t(`พิมพ์ QR ${childWord}`, `type ${childWord} QR`)} t={t} />
            </div>
            {isPack && (
              <div className="asw-photos">
                <button className="asw-photobtn" onClick={openPhoto}><Icon name="camera" size={16} className="stn-ico" />{t("ถ่ายรูปแพ็ก", "Pack photos")}{packPhotos.length ? ` (${packPhotos.length})` : ""} <span className="opt">{t("· ไม่บังคับ", "· optional")}</span></button>
                {packPhotos.length > 0 && (
                  <div className="asw-thumbs">
                    {packPhotos.map((p, i) => (
                      <div key={i} className="asw-thumb" onClick={() => photoRemove(i)} title={t("แตะเพื่อลบ", "tap to remove")}><img src={p.url} alt="" /><span className="x">✕</span></div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className={"asw-confirm" + (asmComplete ? " ready" : "")} disabled={asmChildren.length === 0 || busy} onClick={asmConfirm}>
              {busy ? "..." : asmChildren.length === 0
                ? t(`สแกน${childWord}ที่ติดรอบนี้ก่อน`, `scan the ${childWord}s you installed`)
                : asmComplete
                  ? t(`✓ ${confirmVerb} — ครบ ปิดงาน (${asmChildren.length})`, `✓ ${confirmVerb} — complete (${asmChildren.length})`)
                  : t(`บันทึกรอบนี้ (${asmChildren.length} ชิ้น) — ยังไม่ครบ`, `Save batch (${asmChildren.length}) — partial`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ถ่ายรูปตอนแพ็ก (ภาพนิ่งจากกล้องที่ใช้ร่วมกัน) ────────────────────────────
function PackPhotoCapture({ onCapture, onClose, count, t }) {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await getSharedCameraStream();
        if (cancelled || !stream) return;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.playsInline = true; v.muted = true; try { await v.play(); } catch { /* ignore */ } if (!cancelled) setReady(true); }
      } catch { /* ignore */ }
    })();
    return () => {
      cancelled = true;
      const v = videoRef.current;
      if (v) { try { v.pause(); } catch { /* ignore */ } v.srcObject = null; }
      if (camPermissionPersists()) releaseSharedCamera();
    };
  }, []);
  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1280 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.8);
    c.toBlob((blob) => { if (blob) onCapture(blob, url); }, "image/jpeg", 0.8);
  }
  return (
    <div className="stn-photocap">
      <div className="stn-photocap-view">
        <video ref={videoRef} playsInline muted />
        {!ready && <div className="stn-photocap-loading">{t("กำลังเปิดกล้อง…", "opening camera…")}</div>}
      </div>
      <div className="stn-photocap-bar">
        <button className="stn-photocap-close" onClick={onClose}>{t("เสร็จ", "Done")}{count > 0 ? ` (${count})` : ""}</button>
        <button className="stn-photocap-snap" onClick={snap} disabled={!ready}><Icon name="camera" size={16} className="stn-ico" />{t("ถ่าย", "Capture")}</button>
      </div>
    </div>
  );
}

// หน้าเลือกเบอร์แม่ (ก่อนเริ่มประกอบ) — สแกน + ค้นหา + ฟิลเตอร์ + รายการเบอร์แม่ที่ค้างอยู่ (แตะเลือก)
function AsmParentPicker({ dept, isPack, onScan, onPick, t }) {
  const [rows, setRows] = useState(null);   // null = กำลังโหลด
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const parentWord = isPack ? t("เบอร์แพ็ก", "package") : t("เบอร์แม่", "parent");

  useEffect(() => {
    let alive = true; setRows(null);
    listAssemblyParents(dept).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [dept]);

  const doing = (s) => /progress/i.test(s || "");
  const all = rows || [];
  const filtered = all.filter((r) => {
    if (q.trim()) { const s = q.trim().toLowerCase(); if (!`${r.part_no} ${r.part_name} ${r.project_code}`.toLowerCase().includes(s)) return false; }
    if (filter === "panel") return r.kind === "panel";
    if (filter === "package") return r.kind === "package";
    if (filter === "sub") return r.kind === "subassembly";
    if (filter === "doing") return doing(r.status);
    if (filter === "todo") return !doing(r.status);
    return true;
  });
  const kindLabel = (k) => k === "subassembly" ? t("ซับ", "SUB") : k === "package" ? t("บั้ง", "PKG") : t("แผง", "PANEL");
  const kindCls = (k) => k === "subassembly" ? "sub" : "panel";
  const submit = (e) => { e.preventDefault(); const s = q.trim(); if (s) onPick(s); };
  const chips = isPack
    ? [["all", t("ทั้งหมด", "All")], ["package", t("บั้ง", "Pkg")], ["doing", t("กำลังทำ", "Doing")], ["todo", t("ยังไม่เริ่ม", "Not started")]]
    : [["all", t("ทั้งหมด", "All")], ["panel", t("แผง", "Panel")], ["sub", t("ซับ", "Sub")], ["doing", t("กำลังทำ", "Doing")], ["todo", t("ยังไม่เริ่ม", "Not started")]];

  return (
    <div className="asw-pick">
      <div className="asw-pick-h">{t(`เลือก${parentWord}ที่จะประกอบ`, `Choose a ${parentWord}`)} <span>· {all.length} {t("รายการที่ค้างอยู่", "pending")}</span></div>
      <div className="asw-pick-srow">
        <form className="asw-pick-search" onSubmit={submit}>
          <Icon name="search" size={18} className="stn-ico" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(`ค้นหา / พิมพ์${parentWord}`, `Search / type ${parentWord}`)} inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </form>
        <button type="button" className="asw-pick-scan" onClick={onScan}><Icon name="camera" size={18} className="stn-ico" />{t("สแกน", "Scan")}</button>
      </div>
      <div className="asw-pick-chips">
        {chips.map(([k, label]) => (
          <button key={k} type="button" className={"asw-pick-chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <div className="asw-pick-list">
        {rows === null ? (
          <div className="asw-pick-msg"><div className="stn-asm-spin" />{t("กำลังโหลดรายการ…", "Loading…")}</div>
        ) : filtered.length === 0 ? (
          <div className="asw-pick-msg">{all.length === 0 ? t(`ไม่มี${parentWord}ที่ค้างอยู่ — สแกน QR เพื่อเริ่ม`, "nothing pending — scan to start") : t("ไม่พบตามที่ค้นหา", "no match")}</div>
        ) : filtered.map((r) => (
          <button type="button" key={r.qr_code || r.id} className="asw-pick-row" onClick={() => onPick(r.qr_code || r.part_no)}>
            <span className={"asw-pick-kind " + kindCls(r.kind)}>{kindLabel(r.kind)}</span>
            <span className="asw-pick-mid">
              <span className="asw-pick-pno">{r.part_no}</span>
              <span className="asw-pick-name">{r.part_name}{r.project_code ? <> · <span className="proj">{r.project_code}</span></> : null}</span>
            </span>
            <span className={"asw-pick-pill " + (doing(r.status) ? "doing" : "todo")}>{doing(r.status) ? t("กำลังทำ", "in progress") : t("ยังไม่เริ่ม", "not started")}</span>
            <span className="asw-pick-go">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkArea({ step, elapsed, unit, progress, qty, setQty, status, setStatus, busy, onDecoded, onManualEntry, onPickUnit, confirmCancel, confirmPart, closeScan, rescan, dupCount = 0,
  isAsm, asmType, asmParent, asmChildren = [], asmComplete, asmDecoded, asmManual, asmScan, asmConfirm, asmRemoveChild, asmReset, asmOpenCam,
  packPhotos = [], photoOpen, openPhoto, closePhoto, photoCapture, photoRemove }) {
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);

  // ── โหมดประกอบ/แพ็ก (แยกป้ายตามประเภท) ──────────────────────────────────────
  if (isAsm) {
    if (step === STEP.SCAN) {
      return <CameraScan onDecoded={asmDecoded} onManualEntry={asmManual} onPickUnit={() => {}} busy={busy} onClose={closeScan} />;
    }
    const isPack = asmType === "packing";
    const modeTitle = isPack ? t("โหมดแพ็ก", "Packing mode") : t("โหมดประกอบ", "Assembly mode");
    const parentWord = isPack ? t("เบอร์แพ็ก", "package") : t("เบอร์แม่", "parent");
    const childWord = isPack ? t("ของที่ใส่", "item") : t("ลูก", "child");
    const confirmVerb = isPack ? t("ยืนยันแพ็ก", "Confirm pack") : t("ยืนยันประกอบ", "Confirm assembly");
    if (isPack && photoOpen) {
      return <PackPhotoCapture onCapture={photoCapture} onClose={closePhoto} count={packPhotos.length} t={t} />;
    }
    const prevFor = (pmId) => (asmParent?.installed || []).filter((x) => x.child_pm_id === pmId).length; // ติดจากสเตชันก่อน
    const sessFor = (pmId) => asmChildren.filter((c) => c.child_pm_id === pmId).length;                  // สแกนรอบนี้
    return (
      <div className={"stn-asm" + (asmParent ? " stn-asm-ws" : " stn-asm-pick")}>
        {!asmParent ? (
          <AsmParentPicker dept={asmType} isPack={isPack} onScan={asmOpenCam} onPick={asmScan} t={t} />
        ) : (
          <AsmWorksheet
            asmParent={asmParent} asmChildren={asmChildren} prevFor={prevFor} sessFor={sessFor}
            asmComplete={asmComplete} asmReset={asmReset} asmOpenCam={asmOpenCam} asmScan={asmScan}
            asmConfirm={asmConfirm} asmRemoveChild={asmRemoveChild} busy={busy} t={t}
            isPack={isPack} childWord={childWord} confirmVerb={confirmVerb}
            openPhoto={openPhoto} packPhotos={packPhotos} photoRemove={photoRemove}
          />
        )}
      </div>
    );
  }

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
    // ★ เกินจำนวนสั่งเท่าไร (ถ้าบันทึกครั้งนี้) — ยังไม่เกิน = 0 (ไม่เตือน) · เกิน = โชว์จำนวนที่เกิน
    //   บันทึกต่อได้ปกติเสมอ (ตัดเผื่อสแปร์/เพิ่ม) — แค่เตือนแบบไม่บล็อก ไม่หยุดเวลา
    const projected = done + (Number(qty) || 0);
    const overBy = (!noOp && total != null && projected > total) ? (projected - total) : 0;
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
              {/* เตือนเฉพาะ "เกินจำนวนสั่ง" + บอกจำนวนที่เกิน (ยังไม่เกิน = ไม่เตือน) · แบบไม่บล็อก ไม่หยุดเวลา */}
              {overBy > 0 ? <div className="stn-lbl-dup">{t(`⚠ เกินจำนวนสั่ง +${fmt(overBy)} ชิ้น`, `⚠ Over the order +${fmt(overBy)} pcs`)}</div> : null}
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
  const [pickList, setPickList] = useState(null);   // [options] ให้เลือก "โปรเจกต์" เมื่อเบอร์พาร์ทอยู่หลายโปรเจกต์
  const [pickFilter, setPickFilter] = useState("");   // ค้นหาโปรเจกต์ในตัวเลือก (กรณีมีหลายสิบโปรเจกต์)
  const [camOn, setCamOn] = useState(true);    // ★ กด SCAN → กล้องเปิดทันที · ขอสิทธิ์ไปแล้วครั้งเดียว จึงไม่ถามซ้ำ (กด "พักกล้อง" ปิดชั่วคราวได้)
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);
  const trackRef = useRef(null);
  const [zoom, setZoom] = useState(null);      // { min, max, step, value } หรือ null ถ้ากล้องไม่รองรับซูม
  const pinchRef = useRef(null);               // จับระยะ 2 นิ้ว (pinch zoom)
  const [focusRing, setFocusRing] = useState(null);  // { x, y } จุดที่แตะโฟกัส (px ในกรอบกล้อง)
  const extraRef = useRef([]);                 // กล้องหลัง "ตัวอื่น" ที่เปิด decode ขนานกัน { stream, stop, video }
  const [camCount, setCamCount] = useState(1); // จำนวนกล้องหลังที่ใช้อ่านพร้อมกันจริง
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
  // แตะ = "สั่งโฟกัสใหม่ (re-autofocus)" — จิ้มโฟกัส "ที่จุด" เว็บไม่รองรับจริง (pointsOfInterest แทบ
  //   ไม่มีเบราว์เซอร์ไหนเปิด) จึงทำได้แค่กระตุ้นให้กล้องโฟกัสรอบใหม่ · เครื่องที่ไม่เปิด focusMode (iOS)
  //   สั่งไม่ได้ → เงียบไว้ (พึ่งโฟกัสอัตโนมัติต่อเนื่องแทน)
  async function tapFocus(e) {
    if (e.target?.closest?.("button, input, .stn-cam-zoom")) return;   // แตะปุ่ม/แถบซูม ไม่นับ
    const track = trackRef.current; if (!track) return;
    const caps = track.getCapabilities?.() || {};
    const modes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
    const hasPoint = !!caps.pointsOfInterest && modes.includes("single-shot");   // โฟกัสที่จุด (หายากมาก)
    const hasSingle = modes.includes("single-shot");                              // สั่งโฟกัสรอบใหม่ได้
    if (!hasPoint && !hasSingle) return;   // สั่งโฟกัสไม่ได้เลย (iOS/เครื่องที่ไม่เปิด API) → เงียบ ไม่หลอกตา
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX ?? e.changedTouches?.[0]?.clientX) - box.left;
    const py = (e.clientY ?? e.changedTouches?.[0]?.clientY) - box.top;
    setFocusRing({ x: px, y: py });
    setTimeout(() => setFocusRing(null), 900);
    try {
      if (hasPoint) {
        const nx = Math.min(1, Math.max(0, px / box.width));
        const ny = Math.min(1, Math.max(0, py / box.height));
        await track.applyConstraints({ advanced: [{ focusMode: "single-shot", pointsOfInterest: [{ x: nx, y: ny }] }] });
      } else {
        // กระตุ้นโฟกัสรอบใหม่ (single-shot) แล้วกลับเป็นต่อเนื่อง (ถ้ามี) ให้ AF ทำงานต่อ
        await track.applyConstraints({ advanced: [{ focusMode: "single-shot" }] });
        if (modes.includes("continuous")) {
          setTimeout(() => { track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}); }, 900);
        }
      }
    } catch { /* สั่งไม่สำเร็จ — เงียบไว้ */ }
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
        // ★ เปิดโฟกัสอัตโนมัติต่อเนื่อง (ถ้ารองรับ) — ให้กล้องปรับโฟกัสเองตลอด (สำคัญเมื่อจิ้มโฟกัสไม่ได้)
        if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
          try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ }
        }
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

    // เมื่อ decode เจอ QR (ตัวไหนก็ได้ที่อ่านชัดก่อน) → ประมวลผล · ถ้าไม่พบในระบบ กลับมาสแกนต่อเอง
    function handleFound(data) {
      doneRef.current = true;                          // หยุดทุกตัวชั่วคราว (กัน decode ซ้ำ)
      onDecoded(data).then((ok) => { if (!ok) { clearBox(); setTimeout(() => { doneRef.current = false; }, 1000); } });
    }
    // ★ tick แบบ "reschedule เสมอ" — พอ doneRef กลับเป็น false (เคสไม่พบ) จะสแกนต่ออัตโนมัติ ไม่ค้าง
    function makeTick(video, canvas, { drawsBox }) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let last = 0, raf = 0, live = true;
      const tick = () => {
        if (cancelled || !live) return;
        const now = Date.now();
        if (!doneRef.current && video.readyState === video.HAVE_ENOUGH_DATA && now - last > 110) {
          last = now;
          const w = video.videoWidth, h = video.videoHeight;
          if (w && h) {
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const code = jsQRmod(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
            if (code && code.data && code.location) {
              if (drawsBox) drawBox(code.location, w, h);
              handleFound(code.data.trim());
            } else if (drawsBox) { clearBox(); }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
      return () => { live = false; cancelAnimationFrame(raf); };
    }
    let jsQRmod = null;
    async function loop() {
      const mod = await import("jsqr");
      jsQRmod = mod.default || mod;
      const v = videoRef.current, cv = canvasRef.current;
      if (!v || !cv) return;
      const stopPrimary = makeTick(v, cv, { drawsBox: true });
      rafRef.current = stopPrimary;                    // เก็บตัวหยุดของกล้องหลัก
      startExtras();                                   // เปิดกล้องหลังตัวอื่น decode ขนานกัน
    }
    // กล้องหลัก "ยังทำงาน/ไม่ดำ" อยู่ไหม (ใช้เช็กว่าอุปกรณ์เปิดหลายกล้องพร้อมกันได้จริง)
    const primaryAlive = () => { const p = trackRef.current; return !!p && p.readyState === "live" && !p.muted; };
    // ── เปิดกล้องหลัง "ทุกตัว" ที่อุปกรณ์เปิดพร้อมกันได้ แล้ว decode ขนานกัน (ตัวไหนชัดก่อนชนะ) ──
    async function startExtras() {
      // ★ iOS/iPadOS เปิดกล้องได้ทีละตัว — เปิดตัวอื่นจะไปแย่งกล้องหลัก → จอดำ · ข้าม ใช้กล้องเดียว
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "")
        || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
      if (isIOS) { setCamCount(1); return; }
      try {
        const primaryId = trackRef.current?.getSettings?.().deviceId || null;
        const rears = await listRearCameras();
        if (cancelled) return;
        let count = 1;                                 // นับกล้องหลัก
        for (const c of rears.filter((x) => x.deviceId && x.deviceId !== primaryId)) {
          if (cancelled || !primaryAlive()) break;     // กล้องหลักตายแล้ว → หยุด (อุปกรณ์ไม่รองรับพร้อมกัน)
          let s = null;
          try {
            s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: c.deviceId } } });
          } catch { break; }                           // เปิดไม่ได้ = ไม่รองรับพร้อมกัน → หยุด
          // ★ ถ้าเปิดตัวใหม่แล้วกล้องหลัก "ตาย/ดำ" → ทิ้งตัวใหม่ + หยุด (กันจอหลักดำ)
          if (cancelled || !primaryAlive()) { try { s.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } break; }
          const vid = document.createElement("video");
          vid.playsInline = true; vid.muted = true; vid.srcObject = s;
          try { await vid.play(); } catch { /* ignore */ }
          if (cancelled || !primaryAlive()) { try { s.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } break; }
          const stop = makeTick(vid, document.createElement("canvas"), { drawsBox: false });
          extraRef.current.push({ stream: s, stop, video: vid });
          count++;
        }
        if (!cancelled) setCamCount(count);
      } catch { /* ignore */ }
    }
    open();
    return () => {
      cancelled = true;
      if (typeof rafRef.current === "function") { try { rafRef.current(); } catch { /* ignore */ } }  // หยุด loop กล้องหลัก
      rafRef.current = null;
      // หยุด decode + ปิดกล้องหลัง "ตัวอื่น" (extra) เสมอ — ไม่ใช่สตรีมถาวร
      extraRef.current.forEach((x) => {
        try { x.stop && x.stop(); } catch { /* ignore */ }
        try { x.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        try { x.video.srcObject = null; } catch { /* ignore */ }
      });
      extraRef.current = [];
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
    setPickList(null); setPickFilter("");
    // เบอร์พาร์ทอยู่หลายโปรเจกต์ → คืน choose ให้เลือกโปรเจกต์ · โปรเจกต์เดียว → ระบุเลย
    onManualEntry(manual.trim()).then((r) => {
      if (r && r.ok) { doneRef.current = true; }
      else if (r && r.choose) { setPickList(r.choose); setPickFilter(""); }
    });
  }
  function closePick() { setPickList(null); setPickFilter(""); }
  function pickOption(opt) {
    closePick();
    doneRef.current = true;
    onPickUnit(opt.unit);
  }

  return (
    <div>
      <div className="stn-cam"
        onTouchStart={camTouchStart} onTouchMove={camTouchMove} onTouchEnd={camTouchEnd} onClick={tapFocus}>
        {camOn ? (
          <>
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <canvas ref={overlayRef} className="stn-cam-overlay" />
            {focusRing && <div className="stn-cam-focus" style={{ left: focusRing.x, top: focusRing.y }} />}
            <button type="button" className="stn-cam-close" onClick={onClose} aria-label={t("ปิด", "Close")}>✕</button>
            {camCount > 1 && <div className="stn-cam-multi">📷×{camCount}</div>}
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

      {/* เบอร์พาร์ทอยู่หลายโปรเจกต์ → เลือก "โปรเจกต์" อย่างเดียว (ไม่ต้องเลือก release)
          ★ โปรเจกต์ที่ "ยังไม่ได้ทำขั้นตอนนี้" ขึ้นก่อน · ที่ทำแล้วอยู่ล่าง (ไว้แก้งานเสีย)
          ★ โชว์ ความยาว ให้เทียบกับชิ้นจริง (เบอร์ซ้ำแต่คนละความยาว) */}
      {pickList && pickList.length > 0 && (() => {
        const q = pickFilter.trim().toLowerCase();
        const filtered = q
          ? pickList.filter((o) => `${o.code} ${o.name} ${o.partName}`.toLowerCase().includes(q))
          : pickList;
        return (
          <div className="stn-pick-backdrop" onClick={closePick}>
            <div className="stn-pick" onClick={(e) => e.stopPropagation()}>
              <div className="stn-pick-head">
                <b>{pickList[0]?.unit?.part_master?.part_no || ""}</b>
                <span>{t("อยู่", "in")} {pickList.length} {t("โปรเจกต์ — เลือกให้ตรงชิ้นจริง (ดูความยาว)", "projects — pick the one matching the piece (check length)")}</span>
              </div>
              {/* มีหลายโปรเจกต์ → ช่องค้นหา (พิมพ์โค้ด/ชื่อโปรเจกต์ให้แคบลง) */}
              {pickList.length > 6 && (
                <input className="stn-input stn-pick-search" value={pickFilter} autoFocus
                  placeholder={t("ค้นหาโปรเจกต์ (โค้ด/ชื่อ)…", "Search project (code/name)…")}
                  onChange={(e) => setPickFilter(e.target.value)} />
              )}
              <div className="stn-pick-list">
                {filtered.length === 0 && <div className="stn-pick-empty">{t("ไม่พบโปรเจกต์ที่ค้นหา", "No matching project")}</div>}
                {filtered.map((o, i) => {
                  const projText = [o.code, o.name].filter(Boolean).join(" · ") || t("ไม่ระบุโปรเจกต์", "No project");
                  const done = o.doneCount > 0;
                  return (
                    <button type="button" key={o.pmId || i} className={`stn-pick-item${done ? " done" : ""}`} onClick={() => pickOption(o)}>
                      <b>{projText}</b>
                      <span className="stn-pick-len">{t("ยาว", "Length")} {o.length != null ? `${fmt(o.length)} mm` : "-"}
                        {o.partName ? ` · ${o.partName}` : ""}</span>
                      <span className={done ? "stn-pick-done" : "stn-pick-fresh"}>
                        {done
                          ? `✓ ${t("ทำขั้นตอนนี้แล้ว", "operation already done")} (${o.doneCount}) · ${t("เลือกเพื่อแก้งาน", "pick to rework")}`
                          : `● ${t("ยังไม่ได้ทำขั้นตอนนี้", "not done yet")}`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="stn-pill stn-cam-cancel" onClick={closePick}>{t("ยกเลิก", "Cancel")}</button>
            </div>
          </div>
        );
      })()}
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
          <b><Icon name="warn" size={15} className="stn-ico" />{t("คิวซิงค์ไม่สำเร็จ", "Failed-sync queue")} ({items.length})</b>
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
                <Icon name="refresh" size={15} className="stn-ico" />{t("ลองซิงค์ใหม่ทั้งหมด", "Retry all")}
              </button>
              <button type="button" className="stn-pill no" onClick={() => setConfirmClear(true)} disabled={!items.length}>
                <Icon name="trash" size={15} className="stn-ico" />{t("ล้างทิ้ง", "Discard")}
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
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  if (!ready) return null;
  return (
    <div className="stn-update">
      <span>● {t("มีเวอร์ชันใหม่", "New version")}{offline ? t(" · ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่", " · offline — reconnect then retry") : t(" — กดอัปเดตเมื่อพร้อม (งานที่ทำอยู่ไม่หาย)", " — tap update when ready (your work is safe)")}</span>
      <button onClick={() => { setBusy(true); if (!applyUpdate()) { setBusy(false); setOffline(true); } }} disabled={busy}>
        {busy ? t("กำลังอัปเดต…", "Updating…") : t("อัปเดต", "Update")}
      </button>
    </div>
  );
}

export default function StationApp({ dept = "machine" } = {}) {
  const meta = DEPT_META[dept] || DEPT_META.machine;
  const [user, setUser] = useState(getSession());
  const [notice, setNotice] = useState("");
  async function logout() {
    // เตือนถ้ายังมีงานค้างซิงค์ (ไม่หาย — เก็บใน localStorage รอดข้ามล็อกอิน จะซิงค์เองรอบหน้า)
    const pending = scanQueueCount() + rejectedQueueCount();
    const msg = pending > 0
      ? `ยังมีงานค้างซิงค์ ${pending} ชิ้น — จะซิงค์อัตโนมัติเมื่อล็อกอินอีกครั้ง (ข้อมูลไม่หาย)\n\nออกจากระบบและปิดแอป?`
      : "ออกจากระบบและปิดแอป?";
    if (!(await askConfirm({ message: msg, tone: "warn", confirmText: "ออกจากระบบ", cancelText: "อยู่ต่อ" }))) return;   // แจ้งเตือนก่อนล็อกเอาต์
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
  // token หมดอายุ (นาน ๆ ครั้ง — บัญชีเครื่องอายุ 30 วัน) — เด้งกลับหน้าล็อกอิน
  //   งานค้างอยู่ในคิว (localStorage) รอดข้ามล็อกอิน → ล็อกอินใหม่แล้วซิงค์ต่อเอง ไม่หาย
  function onExpired() {
    clearSession();
    setUser(null);
    setNotice("เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่ (งานที่ค้างจะซิงค์อัตโนมัติหลังล็อกอิน)");
  }
  useEffect(() => { document.body.classList.add("stn-body"); return () => document.body.classList.remove("stn-body"); }, []);
  // เต็มจอเองตอนแตะครั้งแรก (สำหรับคนที่ล็อกอินค้างไว้ — ไม่มี gesture ตอนโหลด) · PWA จะเต็มจอเองอยู่แล้ว
  useEffect(() => armFullscreenOnFirstTap(), []);
  // ล็อกอินรวมหน้าเดียว: ยังไม่ล็อกอิน + ออนไลน์ → ส่งไปหน้าเข้าสู่ระบบรวม (/) · ออฟไลน์ = ใช้หน้าล็อกอินสถานีเดิม (มี cache)
  const stnOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  useEffect(() => {
    if (!user && stnOnline) { try { window.location.replace("/"); } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  let content;
  if (!user) {
    content = stnOnline
      ? <LoginSplash text="กำลังไปหน้าเข้าสู่ระบบ…" />
      : <div className="stn-body" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}><StationLogin onLogin={(u) => { setNotice(""); setUser(u); }} notice={notice} dept={dept} /></div>;
  } else if (!user.machine) {
    content = (
      <div className="stn-login-wrap">
        <div className="stn-login">
          <h1>บัญชีนี้ยังไม่ได้ผูกเครื่อง/สถานี</h1>
          <p>{meta.th}ต้องใช้บัญชีที่กำหนด "เครื่อง/สถานีประจำ" ไว้ที่ Setup → พนักงาน<br />
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
    content = <MachineStation user={user} onLogout={logout} onKicked={onKicked} onExpired={onExpired} dept={dept} />;
  }
  return <><StationUpdateBanner />{content}<ConfirmHost /></>;
}
