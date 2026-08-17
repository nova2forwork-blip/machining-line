import { useState, useEffect, useRef, useCallback } from "react";
import "./styles.css";
import "./station.css";
import {
  verifyLogin, getSession, setSession, clearSession,
} from "./auth.js";
import {
  findUnitByQr, getMachineDay, recordMachineWork,
  scanQueueCount, onScanQueue, flushScanQueue, logoutSession,
} from "./supabase.js";

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

// ══════════════════════════════════════════════════════════════════════════
// STATION LOGIN — same credentials as the main app; intended for the
// machine's own account (an employee whose machine_id is set).
// ══════════════════════════════════════════════════════════════════════════
function StationLogin({ onLogin }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const user = await verifyLogin(code, password);
    setBusy(false);
    if (!user) { setErr("รหัสเครื่อง/พนักงาน หรือรหัสผ่านไม่ถูกต้อง"); return; }
    setSession(user);
    onLogin(user);
  }

  return (
    <div className="stn-login-wrap">
      <form className="stn-login" onSubmit={submit}>
        <h1>หน้าเครื่อง — เข้าสู่ระบบ</h1>
        <p>ล็อกอินด้วยบัญชีของเครื่องจักรนี้ (บัญชีที่ผูกเครื่องไว้)</p>
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

function MachineStation({ user, onLogout }) {
  const machine = user.machine; // { id, code, name }
  const [daily, setDaily] = useState({ quantity: 0, weight: 0, process_seconds: 0 });
  const [rows, setRows] = useState([]);
  const [newRowId, setNewRowId] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const [step, setStep] = useState(STEP.IDLE);
  const [materialLen, setMaterialLen] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  const [unit, setUnit] = useState(null);   // resolved part_unit (from QR)
  const [qty, setQty] = useState(0);
  const [status, setStatus] = useState(null); // 'finished' | 'inprocess'
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);   // { text, tone }
  const toastRef = useRef(null);
  const [pending, setPending] = useState(scanQueueCount());

  // ── load today's records for this machine ──────────────────────────────
  const reload = useCallback(async () => {
    const res = await getMachineDay();
    if (res && res.ok !== false) {
      setDaily(res.daily || { quantity: 0, weight: 0, process_seconds: 0 });
      setRows(res.records || []);
      setLoadErr("");
    } else {
      setLoadErr(res?.message || "โหลดข้อมูลไม่สำเร็จ");
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    flushScanQueue().then(() => setPending(scanQueueCount()));
    const off = onScanQueue((n) => setPending(n));
    return off;
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

  function resetAll() {
    stopTimer(); setElapsed(0); setMaterialLen(""); setUnit(null); setQty(0);
    setStatus(null); setStep(STEP.IDLE);
  }

  // เต็มจอ (ซ่อนแถบบราวเซอร์) — แตะครั้งเดียว
  function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } catch { /* ignore */ }
  }

  // ── RECORD ────────────────────────────────────────────────────────────
  const prevStepRef = useRef(STEP.REC);
  function onRecord() {
    if (step === STEP.IDLE) {
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
  function onScan() {
    if (step === STEP.IDLE) { flash("กด RECORD ก่อนเริ่มสแกน", "warn"); return; }
    setStep(STEP.SCAN);
  }
  async function onDecoded(qr) {
    if (!qr) return;
    setBusy(true);
    const u = await findUnitByQr(qr);
    setBusy(false);
    if (!u) { flash("ไม่พบ QR นี้ในระบบ", "warn"); return; }
    setUnit(u);
    if (qty === 0) setQty(1);
    setStep(STEP.PART);
  }

  // กด OK = บันทึกทันที (ไม่ต้องกด SAVE อีก)
  function confirmPart() {
    if (!status) { flash("เลือกสถานะ FINISHED หรือ INPROCESS", "warn"); return; }
    if (qty <= 0) { flash("ระบุจำนวนมากกว่า 0", "warn"); return; }
    doSave();
  }

  // ── SAVE (ปุ่มสำรอง — คงไว้ตามเลย์เอาต์ PDF; กด OK บันทึกให้แล้ว) ─────────
  function onSave() {
    if (!unit || qty <= 0 || !status) { flash("สแกน แล้วกด OK เพื่อบันทึกได้เลย", "warn"); return; }
    doSave();
  }
  async function doSave() {
    setBusy(true);
    const res = await recordMachineWork({
      qr: unit.qr_code,
      quantity: qty,
      materialLengthMm: materialLen === "" ? null : Number(materialLen),
      processSeconds: elapsed,
      status,
    });
    setBusy(false);
    if (!res || res.ok === false) {
      flash(res?.message || "บันทึกไม่สำเร็จ", "warn");
      setStep(STEP.PART); // กลับไปหน้าจำนวน/สถานะ ให้กด OK ลองใหม่ได้
      return;
    }
    if (res.queued) {
      flash("เน็ตสะดุด — เก็บเข้าคิวแล้ว จะซิงค์ให้อัตโนมัติ", "ok");
      resetAll();
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
    flash("บันทึกแล้ว ✓ พร้อมงานถัดไป", "ok");
    resetAll();
  }

  // scroll table to newest row when it changes
  const tableRef = useRef(null);
  useEffect(() => {
    if (tableRef.current) tableRef.current.scrollTop = tableRef.current.scrollHeight;
  }, [rows.length]);

  const recording = step !== STEP.IDLE;
  const scanArmed = qty > 0 && !!unit;
  const saveArmed = !!unit && qty > 0 && !!status && step === STEP.PART;

  return (
    <div className="stn-shell">
      {pending > 0 && <div className="stn-pending">⏳ ค้างซิงค์ {pending}</div>}
      <div className="stn-screen">
        {/* top-left: machine code */}
        <div className="stn-cell stn-code" style={{ position: "relative" }}>
          <button className="stn-logout" onClick={onLogout}>ออก</button>
          <button className="stn-logout stn-fs" onClick={toggleFullscreen} title="เต็มจอ" aria-label="เต็มจอ">⛶ เต็มจอ</button>
          {machine ? machine.code : "— ไม่มีเครื่อง —"}
        </div>

        {/* top-right: records table */}
        <div className="stn-table" ref={tableRef}>
          <table className="stn-rec">
            <thead>
              <tr>
                <th>ITEM</th><th>MDF&nbsp;NO.</th><th>REL&nbsp;NO.</th><th>PART&nbsp;NO.</th><th>REV.</th>
                <th>QTY.</th><th>REQ.</th><th>PROCESS /<br />REQUIRED</th>
                <th>LENGHT<br />[mm]</th><th>WEIGHT<br />[kg]</th><th>MATERIALS<br />LENGTH</th>
                <th>INVENTORY<br />CODE</th><th>PROCESS<br />TIME</th><th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr className="stn-empty-row"><td colSpan={14}>ยังไม่มีบันทึกวันนี้ — เริ่มงานแรกได้เลย</td></tr>
              )}
              {rows.map((r, i) => {
                const fin = String(r.status).toLowerCase() === "finished";
                const isNew = (r.id && r.id === newRowId);
                return (
                  <tr key={r.id || i} className={isNew ? "stn-new" : ""}>
                    <td>{r.item != null ? String(r.item).padStart(3, "0") : pad(i + 1)}</td>
                    <td>{r.mdf_no || "-"}</td>
                    <td>{r.rel_no || "-"}</td>
                    <td className="l">{r.part_no || "-"}</td>
                    <td>{r.rev || "-"}</td>
                    <td>{fmt(r.qty)}</td>
                    <td>{r.req != null ? fmt(r.req) : "-"}</td>
                    <td>{r.process_cum != null && r.req != null
                      ? `${String(r.process_cum).padStart(4, "0")}/${String(r.req).padStart(4, "0")}` : "-"}</td>
                    <td>{r.length_mm != null ? fmt(r.length_mm) : "-"}</td>
                    <td>{r.weight != null ? fmt(r.weight) : "-"}</td>
                    <td>{r.materials_length != null ? fmt(r.materials_length) : "-"}</td>
                    <td className="l">{r.inventory_code || "-"}</td>
                    <td>{hms(r.process_seconds)}</td>
                    <td className={fin ? "stn-st-fin" : "stn-st-inp"}>
                      {fin ? "FINISHED" : "INPROCESS"}{r.status_seq ? ` ${r.status_seq}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* bottom-left: daily report */}
        <div className="stn-daily">
          <h2>DAILY REPORT</h2>
          <div className="stn-date">{todayISOdate()}</div>
          <div className="stn-kpi"><div className="lbl">Daily Quantity</div>
            <div className="val">{fmt(daily.quantity)} pcs</div></div>
          <div className="stn-kpi"><div className="lbl">Daily Weight</div>
            <div className="val">{fmt(daily.weight)} kg</div></div>
          <div className="stn-kpi"><div className="lbl">Daily Process Time</div>
            <div className="val mono">{hms(daily.process_seconds)}</div></div>
          {loadErr && <div className="stn-err" style={{ marginTop: 12 }}>{loadErr}</div>}
        </div>

        {/* bottom-right: work area + control */}
        <div className="stn-work-wrap">
          <div className="stn-work-area">
            <WorkArea
              step={step} elapsed={elapsed} unit={unit} qty={qty} setQty={setQty}
              status={status} setStatus={setStatus} busy={busy}
              onDecoded={onDecoded} confirmCancel={confirmCancel} confirmPart={confirmPart}
              doSave={doSave}
            />
            {toast && <div className={`stn-toast ${toast.tone}`}>{toast.text}</div>}
          </div>

          <div className="stn-control">
            <div className={`stn-clock${recording ? " live" : ""}`}>{hms(elapsed)}</div>
            <div className={`stn-mat${recording ? " live" : ""}`}>
              <div className="lbl">Material Lenght</div>
              <input
                inputMode="numeric" disabled={recording}
                value={materialLen} placeholder="0"
                onChange={(e) => setMaterialLen(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </div>
            <button className={`stn-ctl-btn${recording ? " recording" : ""}`} onClick={onRecord} disabled={busy}>
              <span>{recording ? "STOP" : "RECORD"}</span><span className="stn-rec-dot" />
            </button>
            <button className={`stn-ctl-btn stn-scan-cell${scanArmed ? " armed" : ""}`} onClick={onScan} disabled={busy}>
              <div className="row1">
                <span>SCAN</span>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16" /></svg>
              </div>
              <div className="qty">Quantity <b>{qty}</b> piece</div>
            </button>
            <button className={`stn-ctl-btn stn-save-btn${saveArmed ? " armed" : ""}`} onClick={onSave} disabled={busy}>SAVE</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the changing middle panel ─────────────────────────────────────────────
function WorkArea({ step, elapsed, unit, qty, setQty, status, setStatus, busy, onDecoded, confirmCancel, confirmPart, doSave }) {
  if (step === STEP.IDLE) {
    return (
      <div className="stn-hint">
        <div style={{ marginBottom: 8 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b6bcc4" strokeWidth="1.6"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16" /></svg>
        </div>
        พร้อมเริ่มงาน — กรอก <b>MATERIAL LENGHT</b><br />แล้วกด <b>RECORD</b> เพื่อเริ่มจับเวลา
      </div>
    );
  }
  if (step === STEP.REC) {
    return (
      <div className="stn-hint">
        <div className="big">● กำลังบันทึกเวลา</div>
        กด <b>SCAN</b> เพื่อสแกน QR ล็อต/งานที่กำลังทำ
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
    return <CameraScan onDecoded={onDecoded} busy={busy} />;
  }
  if (step === STEP.PART) {
    const p = unit?.part_master || {};
    const proj = p.projects || {};
    const rel = unit?.release || {};
    return (
      <div className="stn-part-panel">
        <div className="stn-part-label">
          <div style={{ width: 54, height: 54, flexShrink: 0, border: "1.5px solid var(--st-line)", borderRadius: 3, background: "conic-gradient(#000 0 25%,#fff 0 50%,#000 0 75%,#fff 0)", backgroundSize: "12px 12px" }} />
          <div className="meta">
            <div className="big">{proj.name || proj.code || "-"}</div>
            <div>{p.part_no || "-"}{p.material ? ` · ${p.material}` : ""}</div>
            <div>REL NO. {rel.release_order || "-"}</div>
            <div style={{ marginTop: 3, color: "#555" }}>ต้องการ {rel.qty != null ? fmt(rel.qty) : "-"} ชิ้น</div>
          </div>
        </div>
        <div className="stn-qty-lbl">QUANTITY</div>
        <div className="stn-qty-stepper">
          <button onClick={() => setQty(Math.max(0, qty - 1))}>−</button>
          <input inputMode="numeric" value={qty}
            onChange={(e) => setQty(Math.max(0, parseInt(e.target.value || "0", 10) || 0))} />
          <button onClick={() => setQty(qty + 1)}>+</button>
        </div>
        <div className="stn-row-btns" style={{ marginBottom: 14 }}>
          <button className={`stn-pill ${status === "finished" ? "sel-fin" : ""}`} onClick={() => setStatus("finished")}>FINISHED</button>
          <button className={`stn-pill ${status === "inprocess" ? "sel-inp" : ""}`} onClick={() => setStatus("inprocess")}>INPROCESS</button>
        </div>
        <div className="stn-row-btns">
          <button className="stn-pill ok" onClick={confirmPart} disabled={!status || qty <= 0 || busy}>{busy ? "..." : "OK"}</button>
        </div>
      </div>
    );
  }
  return null;
}

// ── Camera QR scanner (rear camera + jsQR) with manual fallback ────────────
function CameraScan({ onDecoded, busy }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
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
            if (code && code.data) {
              doneRef.current = true;
              onDecoded(code.data.trim());
              return;
            }
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
    if (!manual.trim() || doneRef.current) return;
    doneRef.current = true;
    onDecoded(manual.trim());
  }

  return (
    <div>
      <div className="stn-cam">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" />
        <div className="laser" />
      </div>
      {err && <div className="stn-err" style={{ marginTop: 10 }}>{err}</div>}
      <form className="stn-cam-manual" onSubmit={submitManual}>
        <input className="stn-input stn-mono" value={manual} placeholder="หรือพิมพ์รหัส QR"
          onChange={(e) => setManual(e.target.value)} />
        <button className="stn-pill" type="submit" disabled={busy}>ตกลง</button>
      </form>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT (station)
// ══════════════════════════════════════════════════════════════════════════
export default function StationApp() {
  const [user, setUser] = useState(getSession());
  async function logout() {
    try { await logoutSession(); } catch { /* ignore */ }
    clearSession();
    setUser(null);
  }
  useEffect(() => { document.body.classList.add("stn-body"); return () => document.body.classList.remove("stn-body"); }, []);

  if (!user) return <div className="stn-body" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}><StationLogin onLogin={setUser} /></div>;

  if (!user.machine) {
    return (
      <div className="stn-login-wrap">
        <div className="stn-login">
          <h1>บัญชีนี้ยังไม่ได้ผูกเครื่องจักร</h1>
          <p>หน้าเครื่องต้องใช้บัญชีที่กำหนด "เครื่องจักรประจำ" ไว้ที่ Setup → พนักงาน<br />
            แจ้ง Admin ให้ตั้งค่า machine ให้บัญชีนี้ก่อน</p>
          <button className="stn-btn" onClick={logout}>ออกจากระบบ</button>
          <div className="stn-login-foot"><a className="stn-link-normal" href="/">ไปหน้าปกติ (สำนักงาน) →</a></div>
        </div>
      </div>
    );
  }
  return <MachineStation user={user} onLogout={logout} />;
}
