import { useState, useEffect, useRef, useCallback, useMemo, Component } from "react";
import "./styles.css";
import "./station.css";
import {
  stationLogin, getSession, setSession, clearSession,
} from "./auth.js";
import {
  findUnitByQr, findManualPartOptions, getMachineDay, recordMachineWork, lookupCancelledQr,
  onScanQueue, flushScanQueue, logoutSession, prefetchUnitsForOffline, prefetchAssemblyForOffline,
  rejectedQueueCount, onRejectedQueue, retryRejected, sessionHeartbeat, getMachineOps, reportDeadLetter,
  listRejected, clearRejected, getAssemblyState, recordAssembly, removeAssemblyChild,
  recordAssemblyBatch, getAssemblyBatches, logAssemblyRemoval, assemblyBatchSupported, assemblyPackSupported, assemblyChildParents,
  uploadPackingPhoto, recordPackingPhotos, getPartMeta, listAssemblyParents, listGlazingParents,
  getOpenDowntime, listMachineReports,
  stationStop, stationReady, stationSlowReason, onStationEvents, stationEventsPending, stationPing, getStationDayOps, getTypicalTime, appBuildId,
  reportActiveJob, clearActiveJobNow,
  getStationScanInfo, queueForeignOwners, myQueueCount, addRejected, releaseMdf,
  getMachineScanMode, cachedMachineScanMode, prefetchAllScanModes,
} from "./supabase.js";
import { enterFullscreen, toggleFullscreen, armFullscreenOnFirstTap, isStandalone, warmCameraPermission, getSharedCameraStream, releaseSharedCamera, camPermissionPersists, listRearCameras, getCameraErrorKind } from "./fullscreen.js";
import { useUpdateReady, applyUpdate } from "./updatePrompt.js";
import { askConfirm, askChoice, ConfirmHost, NumInput, nc } from "./confirm.jsx";
import Icon from "./icons.jsx";
import { useLang } from "./i18n-dom.js";
import { newClientId, setCachedAsmState } from "./offline.js";   // UUID ปลอดภัย + แคชสถานะประกอบ/แพ็ก (offline)

// ปุ่มสลับภาษา บนหน้าเครื่อง — โชว์ "ภาษาปัจจุบัน" (ไทย→ไทย · อังกฤษ→EN) · กดเพื่อสลับ (ซิงค์ผ่าน localStorage)
function StnLangToggle() {
  const [lang, setLang] = useLang();
  return (
    <button className="stn-lang" onClick={() => setLang(lang === "th" ? "en" : "th")}
      title="สลับภาษา / Switch language">
      {lang === "th" ? "ไทย" : "EN"}
    </button>
  );
}

// ─── รายงานปัญหาหน้าเครื่อง — เหตุผล (ปรับได้) ────────────────────────────────
const STN_STOP_REASONS = [
  { i: "⚡", th: "ไฟดับ / ไฟตก", en: "Power outage" },
  { i: "🔧", th: "เครื่องเสีย", en: "Machine breakdown" },
  { i: "🧰", th: "บำรุงรักษา (PM)", en: "Maintenance" },
  { i: "✏️", th: "อื่นๆ", en: "Other" },
];
const STN_WORK_REASONS = [
  { i: "💨", th: "ปั้มลมมีปัญหา", en: "Air pump" },
  { i: "🔩", th: "เครื่องเดินไม่เต็มที่ / รวน", en: "Machine unstable" },
  { i: "🪚", th: "ดอก/ใบมีดสึก", en: "Tool worn" },
  { i: "📐", th: "วัตถุดิบไม่ได้ขนาด/มีตำหนิ", en: "Material off-spec" },
  { i: "📄", th: "แบบ/ดรออิงไม่ชัด", en: "Drawing unclear" },
  { i: "🧩", th: "งานยาก/ซับซ้อนกว่าปกติ", en: "Harder job" },
  { i: "✏️", th: "อื่นๆ", en: "Other" },
];

// ป็อปอัพเลือกเหตุผล — mode "stop" = แจ้งเครื่องหยุด · "work" = รายงานการทำงาน (แนบกับสแกน)
function StnReportModal({ mode: mode0, onSubmit, onClose, busy, midJob = false, onBreak }) {
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState(mode0);      // ★ รอบ 13: กลางงานสลับเป็น "เครื่องหยุด" ได้
  const stop = mode === "stop";
  const reasons = stop ? STN_STOP_REASONS : STN_WORK_REASONS;
  const has = !!(pick || note.trim());
  return (
    <div className="stn-rep-ov" onClick={(e) => { if (e.target.classList.contains("stn-rep-ov")) onClose(); }}>
      <div className="stn-rep-modal">
        <div className="stn-rep-h">
          <div className={`stn-rep-ico ${stop ? "stop" : "work"}`}>{stop ? "🛑" : "⚠️"}</div>
          <div>
            <div className="stn-rep-title">{stop ? t("เครื่องหยุด — เพราะอะไร?", "Machine stopped — why?") : t("รายงานการทำงาน — เหตุผล", "Work report — reason")}</div>
            <div className="stn-rep-sub">{stop
              ? t("เลือกสาเหตุ แล้วกด \"พร้อมทำงาน\" เมื่อเครื่องกลับมา", "Pick a reason; press \"Ready\" when the machine is back")
              : t("เลือกเหตุผล แล้วจะบันทึกไปกับชิ้นที่กด SCAN", "Pick a reason; it saves with the next SCAN")}</div>
          </div>
          <button className="stn-rep-close" onClick={onClose} aria-label="close">✕</button>
        </div>
        {/* ★ รอบ 13: พักงาน (หยุดเวลา) · กลางงาน: สลับ "รอบนี้ช้า" ↔ "เครื่องหยุด" */}
        <div className="stn-rep-modes">
          {onBreak ? (
            <button type="button" className="stn-rep-mode brk" disabled={busy} onClick={onBreak}>
              <span className="em">☕</span>
              <span><b>{t("พักงาน", "Take a break")}</b><small>{midJob ? t("หยุดเวลาไว้ · กลับมากด ทำงานต่อ", "pauses the timer · press Resume when back") : t("พัก/เบรก · ไม่นับเป็นเครื่องหยุด", "break · not counted as downtime")}</small></span>
            </button>
          ) : null}
          {midJob ? (
            <button type="button" className={`stn-rep-mode ${stop ? "on stop" : ""}`} onClick={() => { setMode(stop ? "work" : "stop"); setPick(null); }}>
              <span className="em">{stop ? "⚠️" : "🛑"}</span>
              <span><b>{stop ? t("รอบนี้ช้า (แนบเหตุผล)", "Slow round (reason)") : t("เครื่องหยุดกลางงาน", "Machine stopped mid-job")}</b>
                <small>{stop ? t("กลับไปเลือกเหตุผลรอบช้า", "back to slow-round reasons") : t("หยุดเวลา + แจ้งออฟฟิศ", "pauses the timer + tells the office")}</small></span>
            </button>
          ) : null}
        </div>
        <div className="stn-rep-grid">
          {reasons.map((r) => (
            <button key={r.th} type="button"
              className={`stn-rep-reason${pick === r.th ? " sel " + (stop ? "stop" : "work") : ""}`}
              onClick={() => setPick(r.th)}>
              <span className="em">{r.i}</span><span>{lang === "en" ? r.en : r.th}</span>
            </button>
          ))}
        </div>
        <textarea className="stn-rep-note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={stop ? t("รายละเอียดเพิ่มเติม (พิมพ์เอง)", "More detail (optional)")
            : t("เช่น ปั้มลมไม่แรง เลยทำรอบนี้ช้ากว่าปกติ", "e.g. weak air pressure, slower this round")} />
        <div className="stn-rep-actions">
          <button type="button" className="stn-rep-btn cancel" onClick={onClose}>{t("ยกเลิก", "Cancel")}</button>
          <button type="button" className={`stn-rep-btn ${stop ? "go-stop" : "go-work"}`} disabled={!has || busy}
            onClick={() => onSubmit(pick || "อื่นๆ", note.trim(), mode)}>
            {stop ? t("บันทึกการหยุด", "Report stop") : t("ตั้งเหตุผล → SCAN", "Set reason → SCAN")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ★ รอบ 13: กันจอดับระหว่างใช้งาน (Screen Wake Lock) ─────────────────────────
//   ขอค้างจอไว้ตลอดที่เปิดหน้าเครื่อง · สลับแอป/ล็อกจอแล้วกลับมา = ขอใหม่เอง · เบราว์เซอร์ไม่รองรับ = เงียบ
function useWakeLock() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return undefined;
    let lock = null, stopped = false, asking = false;
    const req = async () => {
      if (stopped || lock || asking || document.visibilityState !== "visible") return;
      asking = true;
      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener?.("release", () => { lock = null; });
        if (stopped) { try { lock.release(); } catch { /* ignore */ } lock = null; }
      } catch { lock = null; } finally { asking = false; }
    };
    const onVis = () => { if (document.visibilityState === "visible") req(); };
    req();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", req);          // บางเครื่องต้องมีการแตะก่อน
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", req);
      try { lock && lock.release(); } catch { /* ignore */ }
    };
  }, []);
}

// ─── ★ รอบ 13: เครื่องสแกน USB / Bluetooth (แบบคีย์บอร์ด — keyboard wedge) ───────────
//   ตัวสแกนพิมพ์ตัวอักษรเร็วมาก (< ~35 มิลลิวินาที/ตัว) แล้วกด Enter/Tab → จับเป็น "สแกน 1 ครั้ง"
//   คนพิมพ์ปกติช้ากว่านี้มาก → ไม่โดนดัก · ถ้าตัวอักษรหลุดเข้าช่องกรอกที่โฟกัสอยู่ → คืนค่าเดิมให้
function setNativeValue(el, value) {
  try {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch { /* ignore */ }
}
function useWedgeScanner(onCode) {
  const cbRef = useRef(onCode);
  cbRef.current = onCode;
  useEffect(() => {
    let buf = "", first = 0, last = 0, el = null, elVal = null, idleT = null;
    const AVG_MS = 35, MIN_LEN = 4;
    const isBurst = (now) => buf.length >= MIN_LEN && (last - first) / Math.max(1, buf.length - 1) < AVG_MS && now - last < 150;
    const fire = () => {
      const code = buf.trim(); const target = el, before = elVal;
      buf = ""; el = null; elVal = null; first = 0; last = 0;
      if (target && before != null && target.value !== before) setNativeValue(target, before);
      if (code) { try { cbRef.current && cbRef.current(code); } catch (e) { console.warn("wedge scan", e); } }
    };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const now = performance.now();
      if (e.key === "Enter" || e.key === "Tab") {
        clearTimeout(idleT);
        if (isBurst(now)) { e.preventDefault(); e.stopImmediatePropagation(); fire(); }
        else { buf = ""; el = null; elVal = null; }
        return;
      }
      if (!e.key || e.key.length !== 1) return;              // Shift/CapsLock ฯลฯ — ไม่นับ ไม่รีเซ็ต
      if (!buf || now - last > 80) {                          // เริ่มชุดใหม่
        buf = ""; first = now;
        const a = document.activeElement;
        el = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") ? a : null;
        elVal = el ? el.value : null;
      }
      buf += e.key; last = now;
      // สแกนเนอร์ที่ไม่ส่ง Enter ท้าย → เงียบ 120 มิลลิวินาที + ยาวพอ + เร็วพอ = ถือว่าจบ 1 ครั้ง
      clearTimeout(idleT);
      idleT = setTimeout(() => { if (buf.length >= 6 && isBurst(last + 1)) fire(); else if (performance.now() - last > 100) { buf = ""; el = null; elVal = null; } }, 120);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); clearTimeout(idleT); };
  }, []);
}

// ─── helpers ────────────────────────────────────────────────────────────
// ★ รอบ 11 (L5): รหัสเหตุผลจาก server → ข้อความที่คนหน้าเครื่องอ่านรู้เรื่อง (เดิมโชว์ "machine_cannot" ดิบๆ)
function reasonText(code, t) {
  const m = {
    machine_cannot: t("เครื่องนี้ไม่ได้ตั้งให้ทำขั้นตอนนี้ — แจ้งแอดมิน", "this machine isn't set up for that step — tell admin"),
    not_found: t("ไม่พบ QR/ล็อตในระบบ", "QR/lot not found"), unit_not_found: t("ไม่พบ QR/ล็อตในระบบ", "QR/lot not found"),
    project_closed: t("โปรเจคปิดแล้ว", "project closed"),
    qr_cancelled: t("QR ถูกยกเลิกใน Modify", "QR cancelled in Modify"),
    release_cancelled: t("Part ถูกยกเลิกใน Modify", "part cancelled in Modify"),
    unauthorized: t("เซสชันหมดอายุ — ล็อกอินใหม่", "session expired — log in again"),
    forbidden: t("ไม่มีสิทธิ์", "not allowed"),
    no_machine: t("บัญชีนี้ไม่ได้ผูกกับเครื่อง", "this account has no machine"),
    bad_quantity: t("จำนวนไม่ถูกต้อง", "invalid quantity"), bad_status: t("สถานะไม่ถูกต้อง", "invalid status"),
    retry_exhausted: t("ลองหลายครั้งไม่สำเร็จ", "failed after several retries"),
    cotick_failed: t("บันทึกขั้นตอนร่วมไม่สำเร็จ", "co-ticked step failed"),
    storage_full: t("ที่เก็บข้อมูลเต็ม", "storage full"),
    exception: t("ข้อผิดพลาด", "error"), error: t("ข้อผิดพลาด", "error"),
  };
  return m[code] || code || t("ไม่ทราบสาเหตุ", "unknown");
}
const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
const pad = (n) => String(n).padStart(2, "0");
function hms(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
// ★ รอบ 15: วันที่แบบ "วัน/เดือน" ตามที่คนไทยอ่าน (เดิม 2026.09.26 · 09.24 = เดือนก่อนวัน ชวนงง)
//   การ์ดรายงานประจำวัน: 26/09/2569 (ไทย · พ.ศ.) / 26/09/2026 (EN)
function todayISOdate(lang) {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + (lang === "en" ? 0 : 543)}`;
}
// วันที่แบบสั้น DD/MM — ใช้เติมคอลัมน์ DATE ให้แถวที่เพิ่งสแกน (row จาก record_machine_work ไม่มี day)
function todayMD() {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
// server ส่ง day เป็น "MM.DD" (machine_day) → แสดงเป็น "DD/MM" · รูปแบบอื่นคืนตามเดิม
function dayDM(s) {
  const m = /^(\d{1,2})\.(\d{1,2})$/.exec(String(s ?? "").trim());
  return m ? `${pad(m[2])}/${pad(m[1])}` : s;
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
  if (ty === "assembly") return "assembly";   // ซับ (subassembly)
  if (ty === "panel") return "panel";         // แผง
  if (ty === "pack_panel") return "packpanel";   // แพ็กแผง
  if (ty === "pack_site") return "packsite";     // แพ็กไซต์ไอเทม
  if (ty === "packing") return "packing";        // แพ็ก (รวม — บัญชีเดิม)
  if (ty === "glazing") return "glazing";        // ★ รอบ 22: ติดกระจก (เบอร์แม่ = ซับ/หน้าต่าง หรือ แผง ที่ประกอบเสร็จแล้ว)
  return "machine";
}
const DEPT_META = {
  machine:  { th: "หน้าเครื่อง", en: "Machine",  path: "/station",  word: "เครื่อง", wordEn: "machine" },
  assembly: { th: "หน้าประกอบ (ซับ)", en: "Sub-assembly", path: "/assembly", word: "ประกอบ", wordEn: "sub-assembly" },
  panel:    { th: "หน้าแผง",   en: "Panel",    path: "/panel",    word: "แผง",   wordEn: "panel" },
  packing:  { th: "หน้าแพ็ก",   en: "Packing",  path: "/packing",  word: "แพ็ก",   wordEn: "packing" },
  packpanel:{ th: "หน้าแพ็กแผง", en: "Pack Panel", path: "/packing-panel", word: "แพ็กแผง", wordEn: "pack-panel" },
  packsite: { th: "หน้าแพ็กไซต์ไอเทม", en: "Pack Site Item", path: "/packing-site", word: "แพ็กไซต์ไอเทม", wordEn: "pack-site" },
  glazing:  { th: "หน้าติดกระจก (Glazing)", en: "Glazing", path: "/glazing", word: "ติดกระจก", wordEn: "glazing" },
};
// ★ รอบ 23: สเตชันประกอบ (ซับ/แผง/ติดกระจก) = "บันทึกว่าใส่อะไรเข้าไป" อย่างเดียว — ไม่ปิดงานเอง ไม่บอกครบ/ไม่ครบ
//   (หลังบ้านเทียบกับแบบ/BOM เองที่หน้า "ตรวจงานประกอบ") · แพ็ก (บั้ง) ยังเทียบรายการเหมือนเดิม
const ASM_AUTO_CLOSE = false;
// ★ รอบ 22: ชิ้นกระจก (ดูจากเบอร์/ชื่อ) — สเตชันซับ "ไม่บังคับ" ให้สแกนกระจกครบก่อนปิดงานเฟรม (กระจกไปติดที่สเตชัน Glazing)
//   ไม่นับอุปกรณ์รอบกระจก (ยาง/คิ้ว/ตัวรอง/ซิลิโคน/คลิป) ว่าเป็นกระจก
function isGlassName(s) {
  const d = String(s || "").toUpperCase();
  if (/SUPPORT|BEAD|SPACER|GASKET|SETTING|CLIP|SEAL|SILICON|TAPE|BLOCK/.test(d)) return false;
  if (/ยาง|คิ้ว|ตัวรอง|ซิลิโคน|ซีล|เทป|คลิป/.test(String(s || ""))) return false;
  return /GLASS|GLAZ|\bIGU\b|กระจก/.test(d) || /กระจก/.test(String(s || ""));
}
// สเตชันตระกูล "แพ็ก" (โหมดแพ็กเหมือนกัน) — legacy packing = เห็นทุกบั้ง · packpanel/packsite = กรองด้วย pkg_meta.pack_type
const PACK_DEPTS = ["packing", "packpanel", "packsite"];
const isPackingDept = (d) => PACK_DEPTS.includes(d);
const PACK_TYPE_OF = { packpanel: "panel", packsite: "site" };   // packpanel เปิดบั้ง pack_type=panel · packsite = site · packing = ทั้งหมด
// ธีม/CSS: packpanel/packsite ใช้ธีมแพ็ก (สีน้ำเงิน) ตัวเดียวกับ .dept-packing
const themeDept = (d) => (isPackingDept(d) ? "packing" : d);

// ── ชื่อขั้นตอน: ไทยเป็นหลัก · โหมด EN แปลเป็นอังกฤษ · ขั้นตอนที่เผลอตั้งชื่ออังกฤษ (เช่น MILLING) แสดงเป็นไทย "กัด" ──
const OP_EN = { "ตัด":"Cut","เจาะ":"Drill","บาก":"Notch","พับ":"Bend","เชื่อม":"Weld","ประกอบ":"Assemble","กัด":"Milling","เฉือน":"Shearing","ปั๊ม":"Punching","ต๊าป":"Tapping","เซาะร่อง":"Grooving","ผ่า":"Ripping" };
const OP_NORM = { "MILLING":"กัด","milling":"กัด","Milling":"กัด" };   // ชื่ออังกฤษ → ไทยมาตรฐาน
function opLabel(name, lang) {
  const th = OP_NORM[name] || name;
  return lang === "en" ? (OP_EN[th] || th) : th;
}

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
  // ★ 2026-10-10: เปิดหน้าล็อกอินตอนมีเน็ต → จำโหมดสแกนของทุกเครื่องไว้ (ล็อกอินออฟไลน์ทีหลังได้หน้าถูกแบบ)
  useEffect(() => {
    prefetchAllScanModes();
    const on = () => prefetchAllScanModes();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);

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
        : res && res.error === "locked"
          ? "ลองรหัสผิดหลายครั้ง — ระบบพักบัญชีนี้ไว้ 5 นาที แล้วลองใหม่"
        : res && res.error === "offline_expired"
          ? "ไม่ได้ล็อกอินตอนมีเน็ตมานานกว่า 14 วัน — ต่อเน็ตแล้วล็อกอินใหม่ 1 ครั้ง"
        : "รหัสเครื่อง/พนักงาน หรือรหัสผ่านไม่ถูกต้อง");
      return;
    }
    setSession(res.user);
    enterFullscreen();          // ล็อกอินสำเร็จ = user gesture → เข้าเต็มจอทันที
    warmCameraPermission();     // ขอสิทธิ์กล้อง "ครั้งเดียว" ตอนนี้เลย → SCAN ครั้งต่อไปไม่ถามซ้ำ
    // ★ 2026-10-10: ดึง + จำ "รูปแบบการสแกน" ของเครื่องก่อนเข้าหน้าเครื่อง → จอแรกถูกแบบตั้งแต่แรก
    //   และออฟไลน์ครั้งต่อไปก็หน้าตาเหมือนออนไลน์ (ใช้ค่าที่จำไว้) · รอไม่เกิน 4 วิ (เน็ตช้า = ใช้ค่าที่จำไว้)
    if (dept === "machine" && res.user.machine?.id && !res.offline) {
      setBusy(true);
      try { await Promise.race([getMachineScanMode(res.user.machine.id), new Promise((r) => setTimeout(r, 4000))]); } catch { /* ignore */ }
      setBusy(false);
    }
    onLogin(res.user);
  }

  return (
    <div className="stn-login-wrap">
      <form className={`stn-login dept-${themeDept(dept)}`} onSubmit={submit} style={{ position: "relative" }}>
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
            placeholder={dept === "assembly" ? "เช่น ประกอบ-01" : dept === "panel" ? "เช่น แผง-01" : dept === "glazing" ? "เช่น กระจก-01" : dept === "packpanel" ? "เช่น แพ็กแผง-01" : dept === "packsite" ? "เช่น แพ็กไซต์-01" : dept === "packing" ? "เช่น แพ็ก-01" : "เช่น CT-001"} />
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
const DRAFT_KEY = "mls-station-draft";       // เดิม: key เดียวทั้งเครื่อง (ยังอ่านครั้งเดียวตอนอัปเดต)
// ★ รอบ 11 (B22): draft แยก "ต่อบัญชี" — บัญชีเครื่องอื่นที่ล็อกอินแท็บเล็ตเดียวกันไม่รับงานค้าง/เวลา/ขั้นตอนของคนก่อน
const draftKeyFor = (userId) => DRAFT_KEY + ":" + (userId || "x");
const DRAFT_MAX_AGE_MS = 6 * 3600 * 1000;   // เกินนี้ถือว่าเก่าเกิน (ไม่ใช่การรีโหลดสั้นๆ) → ไม่กู้ กันเวลาเดินเครื่องเพี้ยน
const ASM_WIP_KEY = "mls-asm-wip";          // WIP ประกอบ/แพ็ก: เบอร์แม่ + ลูกที่สแกนแต่ "ยังไม่กดยืนยัน" → refresh/อัปเดตแล้วไม่หาย

function MachineStation({ user, onLogout, onKicked, onExpired, dept = "machine" }) {
  const [lang] = useLang();                       // ★ สลับป้าย report/ปุ่ม ตามภาษา (ไม่พึ่ง DICT ที่ใช้ร่วมกับออฟฟิศ)
  const t = (th, en) => (lang === "en" ? en : th);
  const machine = user.machine; // { id, code, name }
  const DKEY = draftKeyFor(user.id);   // ★ รอบ 11: draft งานค้าง "ของบัญชีนี้"
  // ★ 2026-10-10 ตรวจรอบ 2: จำ "ความยาววัสดุ + ขั้นตอนที่เลือก" ของบัญชีนี้ไว้ในเครื่อง — กดอัปเดต/รีโหลดแล้วไม่ต้องกรอก/เลือกใหม่
  //   (เดิมรีโหลดตอนว่าง = ความยาวหาย + ขั้นตอนกลับไปติ๊กทุกอัน → ถ้าไม่ทันสังเกต บันทึกขั้นตอนที่ไม่ได้ทำเพิ่ม)
  const PKEY = `mls-stn-pref:${user.id || "x"}`;
  const savedPref = useMemo(() => { try { return JSON.parse(localStorage.getItem(PKEY) || "{}") || {}; } catch { return {}; } }, [PKEY]);
  // ── รายงานปัญหาหน้าเครื่อง ──
  const [reportOpen, setReportOpen] = useState(null);   // null | 'stop' | 'work'
  const [slowArmed, setSlowArmed] = useState(null);     // { reason, note } — แนบกับสแกนถัดไป (ค้างจนกดยกเลิก)
  // ★ รอบ 13: "พัก/หยุด" (hold) = { kind: 'stop'|'break', reason, since(ms), id?, queued? }
  //   stop = แจ้งเครื่องหยุด (บันทึกที่ server · ออฟไลน์ = เข้าคิว) · break = พักงาน (หยุดเวลา · ไม่บันทึกเป็นเครื่องหยุด)
  //   ระหว่างมีงานอยู่ → เวลาเดินเครื่องหยุดนับ (process_seconds ไม่รวมช่วงพัก/หยุด) · เก็บในเครื่อง → รีโหลด/ออฟไลน์ไม่หาย
  const HOLD_KEY = `mls-stn-hold:${machine?.id || "none"}`;
  const [hold, setHoldState] = useState(() => {
    try { const h = JSON.parse(localStorage.getItem(`mls-stn-hold:${user.machine?.id || "none"}`) || "null"); return h && (h.kind === "stop" || h.kind === "break") ? h : null; } catch { return null; }
  });
  const holdRef = useRef(hold);
  const setHold = (h) => {
    holdRef.current = h; setHoldState(h);
    try { if (h) localStorage.setItem(HOLD_KEY, JSON.stringify(h)); else localStorage.removeItem(HOLD_KEY); } catch { /* ignore */ }
  };
  const downStop = hold && hold.kind === "stop" ? hold : null;     // เครื่องกำลังหยุด (ชื่อเดิม — ใช้ต่อทั้งไฟล์)
  const onBreak = hold && hold.kind === "break" ? hold : null;     // พักงานอยู่
  const [evPending, setEvPending] = useState(() => stationEventsPending(user.machine?.id || null));
  useEffect(() => onStationEvents(() => setEvPending(stationEventsPending(machine?.id || null))), [machine?.id]);
  const [reportBusy, setReportBusy] = useState(false);
  const [stnReports, setStnReports] = useState([]);     // รายการรายงานวันนี้ของเครื่องนี้ (โชว์ท้าย DAILY REPORT)
  // ดึงรายการ "รายงานวันนี้" ของเครื่องนี้ (ไม่โชว์ระยะเวลาหยุด) — เรียกตอนเข้า + หลังรายงาน/สแกน
  async function loadReports() {
    if (!machine?.id) return;
    const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();   // ต้นวันนี้ (เวลาเครื่อง)
    try {
      const r = await listMachineReports(machine.id, since);
      const merged = [
        ...((r && r.downtime) || []).map((d) => ({ kind: "stop", reason: d.reason, at: d.at, open: d.open, key: "d" + d.id })),
        ...((r && r.slow) || []).map((s) => ({ kind: "slow", reason: s.reason, at: s.at, part_no: s.part_no, key: "s" + s.id })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at));
      setStnReports(merged);
    } catch { /* ignore */ }
  }
  // กู้สถานะ "เครื่องกำลังหยุด" + ดึงรายการรายงานวันนี้ ตอนเข้า/รีโหลด
  useEffect(() => {
    let ok = true;
    if (machine?.id) {
      // ★ รอบ 13: server = ความจริง เว้นแต่ในเครื่องยังมีแจ้งหยุด/พร้อมที่ยังไม่ได้ส่ง (ออฟไลน์) · อ่านไม่ได้ (ออฟไลน์) = ใช้ของในเครื่อง
      getOpenDowntime(machine.id).then((r) => {
        if (!ok || !r || r.ok === false) return;
        if (stationEventsPending(machine.id) > 0) return;
        const cur = holdRef.current;
        if (r.open) {
          if (!cur || cur.kind !== "stop" || cur.id !== r.id) {
            const since = r.started_at ? new Date(r.started_at).getTime() : Date.now();
            beginHoldRef.current({ kind: "stop", id: r.id, reason: r.reason, since: cur && cur.kind === "stop" ? cur.since : since });
          }
        } else if (cur && cur.kind === "stop") {
          endHoldRef.current();                        // ปิดไปแล้วที่ server (เช่น ออฟฟิศ/เครื่องอื่นกดพร้อม) → ล้างในเครื่อง
        }
      }).catch(() => {});
      loadReports();
    }
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine?.id]);
  // ★ 2026-10-10 ตรวจรอบ 3: ข้ามวัน (เวลาไทย) ระหว่างเปิดหน้าค้าง → ดึง "รายงานวันนี้" ใหม่ (เดิมโหลดตอนเปิดครั้งเดียว ค้างของเมื่อวาน)
  useEffect(() => {
    if (!machine?.id) return;
    const dayKey = () => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()); } catch { return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); } };
    let last = dayKey();
    const id = setInterval(() => { const k = dayKey(); if (k !== last) { last = k; loadReports(); } }, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine?.id]);
  // ★ 2026-10-10 ตรวจรอบ 3: แท็บอื่นล็อกอิน/ออกด้วยบัญชีอื่น → token ในเครื่องเปลี่ยน แต่จอยังเป็นคนเดิม → รีโหลดให้ตรงกัน (เฉพาะเมื่อ id ต่างจากจอนี้ กันวนรีโหลด)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== "mls-session" && e.key !== null) return;
      let sid = null;
      try { const raw = localStorage.getItem("mls-session") || sessionStorage.getItem("mls-session"); sid = raw ? (JSON.parse(raw)?.id ?? null) : null; } catch { return; }
      if (String(sid ?? "") !== String(user.id ?? "")) { try { window.location.reload(); } catch { /* ignore */ } }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user.id]);
  // ขั้นตอนประจำเครื่อง (ตัด/เจาะ/บาก) — ใช้ทำ running number แยกตามขั้นตอน
  // มาจาก login (user.operation) และรีเฟรชจาก machine_day ทุกครั้งที่โหลด (เผื่อ admin แก้)
  const [op, setOp] = useState(user.operation || null);
  const [opSel, setOpSel] = useState(() => new Set());  // ★ หน้าเครื่อง: ขั้นตอนที่เลือก "หลายอัน" (CNC ทำหลายขั้นในครั้งเดียว) — บันทึกทุกอันที่เลือก
  const [machineOps, setMachineOps] = useState([]);   // ขั้นตอน "ของแผนกนี้" ที่บัญชีทำได้ (กรองตาม dept แล้ว)
  const [allOps, setAllOps] = useState([]);           // ★ ทุกขั้นตอนของบัญชี (ยังไม่กรอง) — ใช้บอกว่าบัญชีนี้เป็นแผนกอะไร
  const [opsLoaded, setOpsLoaded] = useState(false);  // โหลดรายการขั้นตอนเสร็จหรือยัง (กันเด้ง redirect ก่อนรู้ข้อมูล)
  const [daily, setDaily] = useState({ quantity: 0, weight: 0, process_seconds: 0 });
  const [dayOps, setDayOps] = useState(null);   // ★ รอบ 13: ยอดวันนี้แยกขั้นตอน { ops:[{operation_id,name,qty}], pending:{opId:qty} }
  const [rows, setRows] = useState([]);
  const [newRowId, setNewRowId] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const [step, setStep] = useState(STEP.IDLE);
  const stepRef = useRef(step); stepRef.current = step;   // ★ 2026-10-10 ตรวจรอบ 3: step ล่าสุด (ใช้เช็คหลัง await ใน confirmPart)
  // ★ 2026-10-09: รูปแบบการสแกนของเครื่องนี้ (ตั้งที่ออฟฟิศ › เครื่อง/สถานี) — 'count' = สแกนครั้งเดียวตอนเสร็จ ไม่จับเวลา
  //   (เช่น Drilling-01 นับชิ้นอย่างเดียว) · ค่าเริ่มจากที่จำไว้ในเครื่อง แล้วอัปเดตจาก server
  const [scanMode, setScanMode] = useState(() => (dept === "machine" ? (cachedMachineScanMode(user.machine?.id) || "timed") : "timed"));
  useEffect(() => {
    if (dept !== "machine" || !machine?.id) return undefined;
    let ok = true;
    const load = () => {
      prefetchAllScanModes();
      return getMachineScanMode(machine.id).then((m) => { if (ok) setScanMode(m); }).catch(() => {});
    };
    load();
    // ออฟไลน์ + ยังไม่เคยจำโหมดของเครื่องนี้ → บอกให้ชัด (ใช้แบบปกติไปก่อน · เน็ตกลับมาจะสลับให้เอง)
    if (typeof navigator !== "undefined" && navigator.onLine === false && !cachedMachineScanMode(machine.id)) {
      setTimeout(() => { if (ok) setModeUnknown(true); }, 0);
    }
    window.addEventListener("online", load);
    return () => { ok = false; window.removeEventListener("online", load); };
  }, [dept, machine?.id]);
  const [modeUnknown, setModeUnknown] = useState(false);   // ออฟไลน์ + ไม่รู้โหมดของเครื่องนี้ (ยังไม่เคยเปิดตอนมีเน็ต)
  useEffect(() => { if (scanMode === "count") setModeUnknown(false); }, [scanMode]);
  useEffect(() => { const on = () => setModeUnknown(false); window.addEventListener("online", on); return () => window.removeEventListener("online", on); }, []);
  // ★ 2026-10-10 ตรวจรอบ 2: งานที่เปิดอยู่ทำต่อ "ในโหมดที่เริ่มไว้" (jobMode) — ออฟฟิศสลับโหมด/ค่าจาก server มาทีหลัง ระหว่างทำงาน
  //   เดิมสลับกลางงาน: งานจับเวลาที่เดินอยู่ถูกบันทึกเป็น 0 วิ + ความยาวหาย หรือปิดกล้องแล้วงานหายเงียบๆ · โหมดใหม่มีผลที่หน้าว่าง
  const [jobMode, setJobMode] = useState(null);
  const quick = dept === "machine" && ((step !== STEP.IDLE && jobMode) ? jobMode : scanMode) === "count";
  const quickRef = useRef(quick); quickRef.current = quick;
  const lastSavedRef = useRef(null);   // ★ 2026-10-10 ตรวจรอบ 2: ป้ายที่เพิ่งบันทึก (โหมดสแกนครั้งเดียว) — กันป้ายเดิมค้างหน้ากล้องแล้วบันทึกซ้ำ
  const [materialLen, setMaterialLen] = useState(() => (dept === "machine" && typeof savedPref.len === "string" ? savedPref.len : ""));
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startTsRef = useRef(null);   // เวลาเริ่มจริง (ms) — คำนวณเวลาเดินเครื่องแบบไม่ดริฟต์ + กู้ต่อได้ตอนโหลดใหม่
  // ★ สแกน 2 รอบ (2026-09-23): กรอกความยาว → START (เปิดกล้อง) → สแกนรอบ 1 = เริ่มจับเวลา → ยกขึ้นเครื่อง
  //   → ทำเสร็จ กด SCAN สแกนรอบ 2 (QR ไหนก็ได้ของเบอร์เดียวกัน) → ใส่จำนวน + สถานะ → OK
  //   ★ เวลาไม่หยุดตอนสแกนรอบ 2 — เดินต่อจนกด OK (เหมือนเดิม) · process_seconds = สแกนรอบ 1 → กด OK

  const [unit, setUnit] = useState(null);   // resolved part_unit (from QR) — สแกนรอบ 1 = "งานที่เริ่มไว้" (บันทึกเข้าชิ้นนี้)
  const unitRef = useRef(null);             // สำเนาล่าสุดของ unit (กัน closure ค้างในตัวสแกนกล้อง)
  useEffect(() => { unitRef.current = unit; }, [unit]);
  // ── โหมดประกอบ/แพ็ก (assembly) — เมื่อ op.is_assembly ────────────────────────
  const [asmParent, setAsmParent] = useState(null);     // { unit, bom:[{child_pm_id, qty, part_no, part_name}] }
  const [asmParentQty, setAsmParentQty] = useState(1);  // "จำนวนที่จะทำ" ของเบอร์แม่ (ซับ) — เข้ายอดผลิต + ใช้เทียบ BOM×จำนวน (ปิดงานอัตโนมัติ)
  const [asmQtyLocked, setAsmQtyLocked] = useState(false);  // ซับ: ยืนยัน "จำนวนที่จะทำ" แล้วค่อยเริ่มสแกนลูก (กันปิดงานอัตโนมัติก่อนตั้งจำนวน)
  const [asmChildren, setAsmChildren] = useState([]);   // [{ unit_id, qr, child_pm_id, part_no, qty }]
  const [asmPending, setAsmPending] = useState(null);   // ลูกที่เพิ่งสแกน รอกด "ใส่เข้าเบอร์แม่" (แผงยืนยันต่อชิ้น — โหมดประกอบ)
  const [asmDone, setAsmDone] = useState(null);         // แจ้งเตือน "ประกอบ/แพ็กเสร็จ" เด้งกลางจอหลังยืนยันสำเร็จ { partNo, count, isPack, queued }
  const asmClientRef = useRef(null);
  const asmGlzClientRef = useRef(null);   // ★ รอบ 22: client_id ยอดติดกระจก (คงเดิมจนบันทึกสำเร็จ → กดซ้ำไม่นับเบิ้ล)
  const [packPhotos, setPackPhotos] = useState([]);     // รูปตอนแพ็ก (ยังไม่อัป) [{ blob, url }]
  const [photoOpen, setPhotoOpen] = useState(false);    // เปิดกล้องถ่ายรูปแพ็ก
  const [progress, setProgress] = useState(null); // { done, total } ของล็อต/รีลีสที่สแกน
  const [dupCount, setDupCount] = useState(0);   // ชิ้นนี้เคยทำ "ขั้นตอนนี้" ไปแล้วกี่ครั้ง (เตือน rework)
  const [qty, setQty] = useState(0);
  const [status, setStatus] = useState(null); // 'finished' | 'inprocess'
  // กฎเลือกสถานะต่อ (release+ขั้นตอน+เครื่อง): เคย Finished → ล็อก Finished · เคย In Process → Finished ได้เมื่อครบจำนวน
  const [statusLock, setStatusLock] = useState({ finishedExists: false, inProcessExists: false });
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);   // กันกด OK ซ้ำระหว่างบันทึก (re-entrancy)
  const clientIdRef = useRef(null);  // ★ client_id คงเดิมตลอด "การบันทึกครั้งเดียว" (รวมตอน retry) กันบันทึกซ้ำ
  const clientIdMapRef = useRef(null);  // ★ หน้าเครื่องหลายขั้นตอน: client_id แยกต่อขั้นตอน (คงเดิมตอน retry ทั้งชุด)
  const [toast, setToast] = useState(null);   // { text, tone }
  const toastRef = useRef(null);
  const [pending, setPending] = useState(() => myQueueCount());          // ★ รอบ 11: งานค้าง "ของบัญชีนี้"
  const [foreign, setForeign] = useState(() => queueForeignOwners());   // ★ รอบ 11 (A1): งานค้างของบัญชีอื่นบนแท็บเล็ตนี้
  const [rejected, setRejected] = useState(rejectedQueueCount());
  const [storageFull, setStorageFull] = useState(false);   // ที่เก็บเต็ม — โชว์แถบค้างจนกว่าจะบันทึกได้
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [showRejected, setShowRejected] = useState(false); // เปิดแผงจัดการคิวซิงค์ไม่สำเร็จ

  // ── load today's records for this machine ──────────────────────────────
  const reload = useCallback(async () => {
    getStationDayOps().then((d) => setDayOps(d)).catch(() => {});   // ★ รอบ 13: ยอดแยกขั้นตอน (ไม่บล็อก)
    const res = await getMachineDay();
    // ถูกเตะออก (บัญชีถูกใช้ล็อกอินที่เครื่องอื่น) — เฉพาะตอนออนไลน์ที่เซิร์ฟเวอร์ตอบ unauthorized
    if (res && res.ok === false && res.reason === "unauthorized"
        && !(typeof navigator !== "undefined" && navigator.onLine === false)) {
      // ★ H2: ดันงานค้างขึ้นก่อนเตะออก — กันงานออฟไลน์ค้างซิงค์ไม่ได้อีก
      await flushScanQueue();
      if (myQueueCount() === 0) { onKicked && onKicked(); }
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
      const caps = raw || [];
      setAllOps(caps);
      setOpsLoaded(true);
      const ops = caps.filter((o) => opDept(o) === dept)
        .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));   // ★ แสดงเฉพาะ caps ของเครื่องนี้ + เรียงตามลำดับ (seq) ที่ตั้งไว้
      setMachineOps(ops);
      // ★ หน้าเครื่อง: เลือก "ทุกขั้นตอนที่เครื่องทำได้" ไว้ก่อน (CNC ทำหลายขั้นในครั้งเดียว) — คนงานกดออกเหลือเท่าที่ทำจริง · คงการกดออกไว้ (ไม่รีเซ็ตทุกครั้งที่โหลด)
      if (dept === "machine") setOpSel((prev) => {
        if (prev && prev.size) return prev;
        const keep = Array.isArray(savedPref.sel) ? savedPref.sel.filter((id) => ops.some((o) => o.id === id)) : [];
        return new Set(keep.length ? keep : ops.map((o) => o.id));   // ★ 2026-10-10 ตรวจรอบ 2: ที่เลือกไว้ก่อนรีโหลด (ที่ยังมีอยู่)
      });
      setOp((cur) => {
        if (cur && ops.some((o) => o.id === cur.id)) return cur;
        if (ops.length === 1) return ops[0];
        if (dept === "machine") {
          const mine = user.operation && ops.find((o) => o.id === user.operation.id);
          return mine || ops[0] || cur || null;
        }
        return null;
      });
    }).catch(() => { setAllOps([]); setMachineOps([]); setOpsLoaded(true); });   // โหลดขั้นตอนพลาด → ไม่ค้าง "กำลังตรวจ" (ถือว่ายังไม่มีแผนก)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept]);
  // ★ รอบ 11 (A3): ขั้นตอนที่เลือก "เรียงตามลำดับกระบวนการ (seq)" · ตัวแรก = ขั้นตอนหลัก (รับจำนวน/เวลา/น้ำหนัก)
  //   เดิม: ขั้นตอนหลัก = ตัวแรกใน Set (ลำดับการกด) แต่เลขวิ่ง/ล็อกสถานะใช้ "ขั้นตอนประจำบัญชี" → ไม่ตรงกัน
  //   (บัญชีตั้ง Drill แต่ติ๊ก Cut+Drill → Cut รับจำนวน · ป้ายขึ้น "#1 of 500" ตลอด · กด Finished ไม่ได้)
  const selOps = useMemo(() => machineOps.filter((o) => opSel.has(o.id)), [machineOps, opSel]);
  const primaryOp = selOps[0] || null;
  // หน้าเครื่อง: op (ใช้นับเลขวิ่ง/rework/ล็อกสถานะ) = ขั้นตอนหลักเสมอ · ว่าง = ไม่มีเลือก (บล็อกบันทึกเหมือนเดิม)
  useEffect(() => {
    if (dept !== "machine") return;
    if (machineOps.length === 0) return;   // ไม่มี caps → ปล่อย op ตาม fallback (ขั้นตอนประจำของพนักงาน)
    setOp((cur) => (primaryOp ? (cur && cur.id === primaryOp.id ? cur : primaryOp) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryOp, machineOps, dept]);
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
        if (myQueueCount() === 0) { onKicked && onKicked(); }  // ไม่มีค้างแล้ว → ออกได้ปลอดภัย
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
    flushScanQueue().then(() => { setPending(myQueueCount()); setForeign(queueForeignOwners()); });
    if (rejectedQueueCount() > 0) reportDeadLetter();   // มีงานค้างเดิมค้างอยู่ → แจ้ง office ตอนเปิดเครื่อง
    const off = onScanQueue(() => { setPending(myQueueCount()); setForeign(queueForeignOwners()); });
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
    const isAsmDept = dept === "assembly" || dept === "panel" || dept === "glazing" || isPackingDept(dept);
    const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
    // ★ อุ่น chunk ตัวถอด QR (jsQR) ตอนออนไลน์ → service worker แคชไว้ → สแกนกล้อง "ออฟไลน์" ได้
    //   (เดิม import("jsqr") ตอนเปิดกล้องครั้งแรก ถ้าครั้งแรกดันเป็นตอนออฟไลน์ = chunk ไม่ถูกแคช สแกนกล้องไม่ทำงาน)
    const warmScanner = () => { if (isOnline()) import("jsqr").catch(() => {}); };
    warmScanner();
    prefetchUnitsForOffline().catch(() => {});
    if (isAsmDept) prefetchAssemblyForOffline(120, dept).catch(() => {});   // แคชสถานะเบอร์แม่ที่กำลังทำ → เปิด offline ได้
    const onOnline = () => {
      warmScanner();
      prefetchUnitsForOffline().catch(() => {});
      if (isAsmDept) prefetchAssemblyForOffline(120, dept).catch(() => {});
    };
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
  // ★ รอบ 13: เวลาเดินเครื่อง = ตอนนี้ − เวลาเริ่ม − ช่วงพัก/หยุด (pauseRef) · พักอยู่ = นาฬิกาหยุดนิ่ง
  const pauseRef = useRef({ total: 0, since: null });   // ms ที่พักไปแล้ว (งานนี้) + เริ่มพักรอบปัจจุบันเมื่อไร
  function activeSecs(now = Date.now()) {
    if (startTsRef.current == null) return Number(elapsed) || 0;
    const p = pauseRef.current;
    const paused = (Number(p.total) || 0) + (p.since ? Math.max(0, now - p.since) : 0);
    return Math.max(0, Math.floor((now - startTsRef.current - paused) / 1000));
  }
  function startTimer() {
    clearInterval(timerRef.current);
    if (startTsRef.current == null) startTsRef.current = Date.now() - (Number(elapsed) || 0) * 1000;
    const tick = () => setElapsed(activeSecs());
    tick();
    if (pauseRef.current.since) { timerRef.current = null; return; }   // พักอยู่ → ไม่เดิน
    timerRef.current = setInterval(tick, 1000);
  }
  function stopTimer() { clearInterval(timerRef.current); timerRef.current = null; startTsRef.current = null; pauseRef.current = { total: 0, since: null }; }
  // เริ่ม/จบ พัก-หยุด: มีงานอยู่ → หยุดนับเวลา · จบ → นับต่อ (ช่วงพักไม่ถูกนับเป็นเวลาเดินเครื่อง)
  function beginHold(h) {
    setHold(h);
    if (startTsRef.current != null && !pauseRef.current.since) {
      // ★ 2026-10-10 ตรวจรอบ 3: หยุดที่เปิดค้างจาก server (เริ่มก่อนงานนี้) → เริ่มนับพักไม่ก่อนเวลาเริ่มงาน (เดิมลบเวลาเดินเครื่องหมด)
      pauseRef.current = { ...pauseRef.current, since: Math.min(Date.now(), Math.max(h.since || Date.now(), startTsRef.current)) };
      clearInterval(timerRef.current); timerRef.current = null;
      setElapsed(activeSecs());
    }
  }
  function endHold() {
    setHold(null);
    const p = pauseRef.current;
    if (p.since) {
      pauseRef.current = { total: (Number(p.total) || 0) + Math.max(0, Date.now() - p.since), since: null };
      if (startTsRef.current != null) startTimer();
    }
  }
  const beginHoldRef = useRef(beginHold); beginHoldRef.current = beginHold;
  const endHoldRef = useRef(endHold); endHoldRef.current = endHold;
  useEffect(() => () => stopTimer(), []);
  // ปิดกล้องถาวรตอนออกจากหน้าเครื่อง (ออกจากระบบ/ถูกเตะ) — ระหว่างใช้งานกล้องเปิดค้างไว้ตัวเดียว
  useEffect(() => () => releaseSharedCamera(), []);

  // ── กัน "งานหายตอนกดอัปเดต/รีโหลด" ──────────────────────────────────────
  // เก็บงานที่กำลังทำ (พาร์ทที่สแกน/จำนวน/สถานะ/เวลาเดินเครื่อง) ลง localStorage แบบสด
  // แล้วกู้กลับตอนโหลดแอปใหม่ → กดอัปเดตกลางงานก็ไม่หาย (เวลาเดินเครื่องนับต่อจากเวลาเริ่มจริง)
  const draftLoadedRef = useRef(false);
  const restoredRef = useRef(false);        // กู้งานค้างที่สแกนรอบแรกแล้ว → รอ ops โหลดเสร็จแล้วดึงล็อกสถานะใหม่
  useEffect(() => {
    if (dept !== "machine") return;        // ★ ประกอบ/แพ็กไม่ใช้ draft (สถานะประกอบไม่ได้ถูกเก็บใน draft) — กันเด้ง "กู้งาน" หลอก + จับเวลาผี
    if (!draftLoadedRef.current) return;   // ยังไม่ผ่านขั้นกู้ draft — อย่าเพิ่งเขียนทับ
    try {
      // "กำลังทำงาน" = กด START แล้ว (timer เดิน / สแกน / เลือกจำนวน) — step ไม่ใช่ IDLE
      if (step === STEP.IDLE) { localStorage.removeItem(DKEY); return; }   // จบ/ยกเลิก/บันทึกแล้ว → ล้าง draft
      // ★ 2026-10-10: ยังไม่ได้สแกนชิ้นไหนเลย (แค่กดเริ่ม/เปิดกล้อง) = ไม่มีอะไรต้องกู้ → ไม่เก็บ draft
      //   (เดิมเก็บไว้ → ล็อกอินใหม่แล้วเด้งเป็น "ยกเลิกงาน / ① สแกนเพื่อเริ่ม" เหมือนงานเริ่มเอง)
      if (!unit) { localStorage.removeItem(DKEY); return; }
      localStorage.setItem(DKEY, JSON.stringify({
        v: 1, step, materialLen, qty, status, statusLock,
        unit, op, progress, dupCount,
        opSel: [...opSel],                  // ★ ขั้นตอนที่เลือกไว้ (หลายอัน) — กันรีโหลดแล้วกลับไปเลือกทุกอันเอง
        startTs: startTsRef.current,        // เวลาเริ่มจริง (สแกนรอบ 1) → คำนวณเวลาเดินเครื่องต่อได้
        pause: pauseRef.current,            // ★ รอบ 13: ช่วงพัก/หยุดของงานนี้ (ไม่นับเป็นเวลาเดินเครื่อง)
        clientIdMap: clientIdMapRef.current || null,   // ★ client_id ต่อขั้นตอน — กู้กลับได้ ถ้ารีโหลดหลังกด OK แล้วตอบกลับหาย (กัน DB บันทึกซ้ำ)
        mode: jobMode || scanMode,          // ★ 2026-10-10 ตรวจรอบ 2: โหมดของงานนี้ (กู้แล้วทำต่อแบบเดิม)
        savedAt: Date.now(),
      }));
    } catch { /* localStorage เต็ม/ปิด — ข้าม (ไม่ทำแอปพัง) */ }
  }, [step, materialLen, qty, status, statusLock, unit, op, progress, dupCount, opSel, hold, jobMode]);
  useEffect(() => {
    if (dept !== "machine" || !draftLoadedRef.current) return;
    try { localStorage.setItem(PKEY, JSON.stringify({ len: materialLen || "", sel: [...opSel] })); } catch { /* ignore */ }
  }, [materialLen, opSel, dept, PKEY]);

  // กู้ draft ครั้งเดียวตอนเปิด (ก่อนเขียนทับ) — ถ้ามีงานค้างจากรอบก่อน
  useEffect(() => {
    if (dept !== "machine") { draftLoadedRef.current = true; return; }   // ★ ประกอบ/แพ็ก: ไม่กู้ draft (กันงานเครื่องหลอกมาทับหน้าประกอบ)
    try {
      // ★ รอบ 11 (B22): draft ของบัญชีนี้ · ไฟล์เดิม (key รวม) อ่านได้ครั้งเดียวหลังอัปเดต แล้วลบทิ้ง
      let raw = localStorage.getItem(DKEY);
      if (!raw) { raw = localStorage.getItem(DRAFT_KEY); if (raw) localStorage.removeItem(DRAFT_KEY); }
      if (raw) {
        const d = JSON.parse(raw);
        const tooOld = d && d.savedAt && (Date.now() - d.savedAt > DRAFT_MAX_AGE_MS);
        if (d && d.v === 1 && d.step && d.step !== STEP.IDLE && !tooOld && !d.unit) {
          // ★ 2026-10-10: draft ที่ยังไม่ได้สแกนชิ้นงาน (แค่กดเริ่ม/เปิดกล้อง) → ไม่กู้เป็นงานค้าง
          //   คงไว้แค่ความยาววัสดุ · กลับหน้าพร้อมเริ่มงาน (ไม่เด้ง "ยกเลิกงาน" เอง)
          if (d.materialLen) setMaterialLen(d.materialLen);
          localStorage.removeItem(DKEY);
        } else if (d && d.v === 1 && d.step && d.step !== STEP.IDLE && !tooOld) {
          setMaterialLen(d.materialLen ?? "");
          setUnit(d.unit ?? null);
          setQty(Number(d.qty) || 0);
          setStatus(d.status ?? null);
          setProgress(d.progress ?? null);
          setDupCount(Number(d.dupCount) || 0);
          if (d.statusLock && typeof d.statusLock === "object") setStatusLock({ finishedExists: !!d.statusLock.finishedExists, inProcessExists: !!d.statusLock.inProcessExists });
          if (d.unit) restoredRef.current = true;   // ★ รอบ 11 (B19): ดึงล็อกสถานะ/เลขวิ่งจาก server ใหม่หลังกู้
          if (d.op) setOp(d.op);
          if (Array.isArray(d.opSel)) setOpSel(new Set(d.opSel));   // ★ กู้ "ขั้นตอนที่เลือกไว้" (หลายอัน) ให้ตรงกับตอนก่อนรีโหลด
          clientIdRef.current = d.clientId ?? null;
          if (d.clientIdMap && typeof d.clientIdMap === "object") clientIdMapRef.current = d.clientIdMap;   // ★ กู้ client_id ต่อขั้นตอน → กด OK ซ้ำหลังรีโหลด = ตัวเดิม → DB dedup ไม่บันทึกซ้ำ
          unitRef.current = d.unit ?? null;
          setJobMode(d.mode === "count" || d.mode === "timed" ? d.mode : (d.startTs ? "timed" : null));   // ★ 2026-10-10 ตรวจรอบ 2
          if (d.startTs) startTsRef.current = d.startTs;   // เวลาเดินเครื่องต่อจากของเดิม (รวมช่วงรีโหลด)
          // ★ รอบ 13: ช่วงพัก — ยังพักอยู่ (hold ในเครื่อง) = นาฬิกาหยุดต่อ · ไม่พักแล้ว = ปิดช่วงพักตอนนี้แล้วเดินต่อ
          if (d.pause && typeof d.pause === "object") {
            const pz = { total: Number(d.pause.total) || 0, since: d.pause.since || null };
            if (pz.since && !holdRef.current) { pz.total += Math.max(0, Date.now() - pz.since); pz.since = null; }
            pauseRef.current = pz;
          } else if (holdRef.current && d.startTs) {
            pauseRef.current = { total: 0, since: Math.max(holdRef.current.since || Date.now(), d.startTs) };   // ★ 2026-10-10 ตรวจรอบ 3: ไม่ก่อนเวลาเริ่มงาน
          }
          // กล้องไม่เปิดเองตอนกู้ (SCAN → REC)
          const st = d.step === STEP.SCAN ? STEP.REC : d.step;
          if (d.unit && d.startTs) {
            startTimer();   // งานเริ่มแล้ว (สแกนรอบ 1 แล้ว) → เวลาเดินต่อทันที (รวมหน้าจำนวน/สถานะ)
          } else {
            startTsRef.current = null;   // ยังไม่ได้สแกนรอบ 1 → ยังไม่จับเวลา
          }
          setStep(st);
          flash(d.unit
            ? t("กู้งานที่ค้างอยู่กลับมาแล้ว — ทำเสร็จแล้วสแกนอีกครั้ง / ตรวจแล้วกด OK", "Restored your in-progress job — scan again when done / review and press OK")
            : t("กู้งานที่ค้างอยู่กลับมาแล้ว — กด SCAN สแกนชิ้นงานเพื่อเริ่ม", "Restored — press SCAN to scan the piece and start"), "ok");
        } else if (tooOld) {
          localStorage.removeItem(DKEY);   // เก่าเกิน → ทิ้ง
        }
      }
    } catch { /* ignore */ }
    draftLoadedRef.current = true;   // เปิดให้ effect เขียน draft ทำงานได้หลังจากนี้
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ แจ้งออฟฟิศว่า "กำลังทำงาน" (สแกนรอบแรกแล้ว ยังไม่กด OK) → หน้า Release ขึ้น In Process ที่เครื่องนี้
  //   สแกนรอบแรก / กู้งานค้าง = ตั้งงาน · กด OK / ยกเลิก / จบงาน = ล้าง · เปิดหน้าใหม่ไม่มีงานค้าง = ล้างของเก่า
  //   ส่งแบบ best-effort (ออฟไลน์เก็บไว้ส่งทีหลัง) — ไม่กระทบการสแกน/บันทึกงานเลย
  const ajUnitRef = useRef({ ts: null, id: null });   // ป้ายที่สแกนรอบแรกของงานนี้ (รอบ 2 เปลี่ยน unit แต่ไม่ต้องแจ้งใหม่)
  useEffect(() => {
    if (dept !== "machine") return;
    if (!draftLoadedRef.current) return;
    const ts = startTsRef.current;
    if (step === STEP.IDLE || !unit || !unit.release_id || !ts) { ajUnitRef.current = { ts: null, id: null }; reportActiveJob(null); return; }
    if (ajUnitRef.current.ts !== ts) ajUnitRef.current = { ts, id: unit.id || null };
    const opIds = selOps.length ? selOps.map((o) => o.id) : (op?.id ? [op.id] : (user.operation?.id ? [user.operation.id] : []));
    reportActiveJob({ releaseId: unit.release_id, partUnitId: ajUnitRef.current.id, operationIds: opIds, startedAt: ts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, unit, selOps, op]);

  // ★ รอบ 11 (B19): ล็อกสถานะ (เคย Finished → ห้าม In Process) อยู่ในเครื่องอย่างเดียว — หายเมื่อรีโหลด/ออฟไลน์
  //   → ดึงใหม่จาก server หลังกู้งานค้าง และทุกครั้งที่เน็ตกลับมาระหว่างทำงาน
  const refreshLockRef = useRef(null);
  refreshLockRef.current = async () => {
    const u = unitRef.current;
    if (dept !== "machine" || !u || !u.release_id) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const opId = primaryOp?.id || op?.id || user.operation?.id || null;
    if (!opId) return;
    const gen = jobGenRef.current;
    try {
      const info = await getStationScanInfo({ releaseId: u.release_id, operationId: opId, machineId: machine?.id, partUnitId: u.id, sinceIso: u.release?.mod_qty_at || null });
      if (gen !== jobGenRef.current || unitRef.current !== u) return;
      setStatusLock(info.lock);
      if (info.done != null) setProgress((p) => (p ? { ...p, done: info.done, offline: false } : p));
      if (info.lock.finishedExists) setStatus((st) => (st === "inprocess" || !st ? "finished" : st));
    } catch { /* ไม่บล็อกงาน */ }
  };
  useEffect(() => {
    if (!restoredRef.current || !opsLoaded) return;
    restoredRef.current = false;
    refreshLockRef.current && refreshLockRef.current();
    if (unitRef.current) loadTypical(unitRef.current);   // ★ รอบ 13: กู้งานค้าง → โหลดเวลาปกติต่อชิ้นด้วย
  }, [opsLoaded, primaryOp]);
  useEffect(() => {
    const on = () => { if (unitRef.current) setTimeout(() => refreshLockRef.current && refreshLockRef.current(), 1500); };
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);

  // ★ รอบ 11 (B23): เลขรุ่นงาน — ยกเลิก/จบงานแล้ว ผลค้นป้ายที่ตอบกลับมาทีหลัง "ทิ้ง" (เดิมเริ่มจับเวลางานผีเอง)
  const jobGenRef = useRef(0);
  function resetAll(keepLen = false) {
    jobGenRef.current += 1;
    stopTimer(); setElapsed(0); setUnit(null); setProgress(null); setDupCount(0); setQty(0);
    if (!keepLen) setMaterialLen("");   // หลังบันทึกให้คงความยาววัสดุไว้ (งานชุดเดียวกันมักยาวเท่ากัน)
    setStatus(null); setStatusLock({ finishedExists: false, inProcessExists: false }); setStep(STEP.IDLE);
    setJobMode(null);
    clientIdRef.current = null;          // จบชิ้นนี้แล้ว → ครั้งหน้าเป็น client_id ใหม่
    clientIdMapRef.current = null;       // ★ ล้าง client_id ต่อขั้นตอนด้วย (ชิ้นใหม่ = ชุดใหม่)
    unitRef.current = null;              // จบงาน → รอบหน้าสแกนรอบ 1 ใหม่
  }

  // ── รายงานปัญหา: เดินเครื่องอยู่ = "รายงานการทำงาน" · ยังไม่เริ่ม = "แจ้งเครื่องหยุด" ──
  function openReport() {
    if (hold) return;                           // หยุด/พักอยู่ → ให้กด "พร้อมทำงาน / ทำงานต่อ" ก่อน
    setReportOpen(step !== STEP.IDLE ? "work" : "stop");
  }
  // ★ รอบ 13: แจ้งหยุดได้ทั้ง "ก่อนเริ่มงาน" และ "กลางงาน" (เวลาหยุดนับ) · ออฟไลน์ = เข้าคิว ส่งเมื่อเน็ตกลับ
  async function submitStop(reason, note) {
    if (reportBusy) return; setReportBusy(true);
    try {
      const r = await stationStop({ machineId: machine?.id, reason, note, operationId: op?.id || null });
      if (r && r.ok === false) {
        flash(r.reason === "forbidden" ? t("บัญชีนี้แจ้งหยุดเครื่องนี้ไม่ได้", "This account can't report this machine")
          : t("แจ้งไม่สำเร็จ ลองใหม่", "Report failed, try again"), "warn");
        return;
      }
      beginHold({ kind: "stop", id: r?.id || null, reason, since: Date.now(), queued: !!r?.queued });
      setReportOpen(null);
      flash(r?.queued ? t("แจ้งเครื่องหยุดแล้ว (ออฟไลน์ — จะส่งให้เองเมื่อเน็ตกลับ)", "Stop recorded (offline — will send when back online)")
        : t("แจ้งเครื่องหยุดแล้ว", "Machine stop reported"), "ok");
      loadReports();
    } catch { flash(t("แจ้งไม่สำเร็จ ลองใหม่", "Report failed, try again"), "warn"); }
    finally { setReportBusy(false); }
  }
  // พักงาน (เบรก/พักกินข้าว) — หยุดเวลาไว้ ไม่บันทึกเป็นเครื่องหยุด
  function startBreak() {
    if (hold) return;
    beginHold({ kind: "break", reason: t("พักงาน", "Break"), since: Date.now() });
    setReportOpen(null);
    flash(step !== STEP.IDLE ? t("พักงาน — หยุดเวลาไว้แล้ว", "On break — timer paused") : t("พักงาน", "On break"), "ok");
  }
  async function markReady() {
    if (reportBusy) return;
    if (onBreak) { endHold(); flash(t("ทำงานต่อ", "Back to work"), "ok"); return; }
    setReportBusy(true);
    try {
      const r = await stationReady({ machineId: machine?.id });
      if (r && r.ok === false && r.reason !== "retry_exhausted") {
        flash(t("ทำรายการไม่สำเร็จ ลองใหม่", "Failed, try again"), "warn"); return;
      }
      endHold();
      flash(r?.queued ? t("เครื่องพร้อมทำงาน (ออฟไลน์ — จะส่งให้เอง)", "Machine ready (offline — will send later)") : t("เครื่องพร้อมทำงาน", "Machine ready"), "ok");
      loadReports();
    } catch { flash(t("ทำรายการไม่สำเร็จ ลองใหม่", "Failed, try again"), "warn"); }
    finally { setReportBusy(false); }
  }
  function submitWork(reason, note) {           // ตั้งเหตุผลค้างไว้ → บันทึกตอน SCAN (ผูกกับชิ้น)
    setSlowArmed({ reason, note });
    setReportOpen(null);
    flash(t("ตั้งเหตุผลแล้ว — จะบันทึกตอนกด SCAN", "Reason set — saved on next SCAN"), "ok");
  }

  // ── START / STOP (RECORD) ───────────────────────────────────────────────
  // ต้องกรอกความยาววัสดุก่อน ถึงจะกด Start ได้
  const matReady = materialLen !== "" && Number(materialLen) > 0;
  const prevStepRef = useRef(STEP.REC);
  const holdMsg = () => (downStop ? t("เครื่องกำลังหยุด — กด \"พร้อมทำงาน\" ก่อน", "Machine is stopped — press \"Ready\" first")
    : t("พักงานอยู่ — กด \"ทำงานต่อ\" ก่อน", "On break — press \"Resume\" first"));
  // START (ใช้ร่วมกับสแกนเนอร์ USB: สแกนตอนยังไม่เริ่ม = เริ่มงานให้เลย) · คืน false = ยังเริ่มไม่ได้ (บอกเหตุผลแล้ว)
  function beginJob() {
    if (!quickRef.current && !matReady) { errorBeep(); flash(t("กรอกความยาววัสดุ (Material Length) ก่อน", "Enter the Material Length first"), "warn"); return false; }
    if (machineOps.length > 1 && !op) { errorBeep(); flash(t("เลือกขั้นตอน (ตัด/เจาะ/บาก) ก่อน", "Pick the operation first"), "warn"); return false; }
    warmAudio();
    // ★ START = เปิดกล้องให้สแกน (ยังไม่จับเวลา) · เวลาเริ่มนับตอนสแกนรอบ 1
    clientIdRef.current = null; clientIdMapRef.current = null;
    stopTimer(); setElapsed(0);
    setUnit(null); unitRef.current = null; setProgress(null); setDupCount(0); setQty(0); setStatus(null);
    setJobMode(dept === "machine" ? scanMode : null);   // ★ 2026-10-10 ตรวจรอบ 2: จำโหมดของงานนี้
    setStep(STEP.SCAN);
    return true;
  }
  function onRecord() {
    if (hold) { flash(holdMsg(), "warn"); return; }
    if (step === STEP.IDLE) {
      beginJob();
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
    if (hold) { flash(holdMsg(), "warn"); return; }
    // ★ โหมดสแกนครั้งเดียว: กด SCAN ตอนว่าง = เปิดกล้องเลย (ไม่ต้องกรอกความยาว/กดเริ่ม) · กดซ้ำ = ปิดกล้อง กลับหน้าว่าง
    if (quick && step === STEP.IDLE) { beginJob(); return; }
    if (quick && step === STEP.SCAN) { resetAll(true); return; }
    if (step === STEP.IDLE) { flash(t("กรอกความยาว แล้วกด เริ่ม ก่อน", "Enter the length, then press START"), "warn"); return; }
    // ★ กด SCAN ซ้ำระหว่างกล้องเปิด (ยังไม่ได้สแกน) → ปิดกล้อง (toggle) · งาน/เวลาที่เริ่มไว้ยังอยู่
    if (step === STEP.SCAN) { setStep(STEP.REC); return; }
    if (step === STEP.CANCEL) return;
    // หน้าจำนวน/สถานะ (สแกนรอบ 2 แล้ว) → ให้กด OK หรือ ยกเลิก (กันงานที่เริ่มไว้หาย)
    if (step === STEP.PART) {
      flash(t("กด OK เพื่อบันทึก หรือกด ยกเลิก เพื่อกลับไปหน้ากำลังทำงาน", "Press OK to save, or Cancel to go back"), "warn"); return;
    }
    // เครื่องทำได้หลายขั้นตอน แต่ยังไม่เลือก → ต้องเลือกก่อน (กันบันทึกผิดขั้นตอน)
    if (machineOps.length > 1 && !op) { flash("เลือกขั้นตอน (ตัด/เจาะ/บาก) ก่อนสแกน", "warn"); return; }
    warmAudio(); // ปลดล็อกเสียงบนมือถือ (ต้องมาจาก user gesture)
    // ยังไม่มีงาน = สแกนรอบ 1 (เริ่มจับเวลา) · มีงานแล้ว = สแกนรอบ 2 (ทำเสร็จ) — แยกกันใน showScannedUnit
    setStep(STEP.SCAN);
  }
  function closeScan() { if (quickRef.current && !isAsm) { resetAll(true); return; } setStep(STEP.REC); } // ปิดกล้อง กลับไปหน้ากำลังทำงาน (ถ้ายังไม่ได้สแกนรอบ 1 = ยังไม่จับเวลา)
  // หน้าจำนวน/สถานะ กด ยกเลิก → กลับไปหน้ากำลังทำงาน (งาน + เวลายังเดินอยู่ ไม่ได้หยุด) · สแกนรอบ 2 ใหม่ได้
  function backToRun() {
    if (quickRef.current) { resetAll(true); return; }   // โหมดสแกนครั้งเดียว: ← กลับ = ทิ้งชิ้นนี้ กลับหน้าว่าง (ไม่มีงานค้าง/เวลา)
    jobGenRef.current += 1; clientIdRef.current = null; clientIdMapRef.current = null; setStep(STEP.REC);
  }
  // แสดงชิ้นงานที่ระบุได้แล้ว (ใช้ร่วมกันทั้งสแกน QR / พิมพ์เบอร์ / เลือก release)
  // สแกนเสร็จ = เวลายังเดินต่อ (ไม่หยุด) — โชว์ป้ายตัวใหม่ + running number
  //   done = จำนวนที่ "เครื่องนี้ (ขั้นตอนนี้)" ทำไปแล้วของรีลีสนี้ · total = จำนวนสั่งทั้งใบ
  //   ★ H1: ต้องรู้ "ขั้นตอน (operation)" ถึงจะนับเลขวิ่งถูก — ถ้าไม่รู้ โชว์เป็นไม่ทราบ
  // คืน true=แสดงชิ้นเข้าหน้าเลือกจำนวน · false=ถูกบล็อก (เช่นโปรเจคปิดแล้ว)
  // ตรวจ + โหลดข้อมูลชิ้นที่สแกน (โปรเจคปิด / Modify · เลขวิ่ง · rework · ล็อกสถานะ) — ขั้นตอนสแกนเดิม
  //   ใช้ทั้งสแกนรอบ 1 (เริ่มงาน) และรอบ 2 · คืน false = ถูกบล็อก (กล้องยังเปิด สแกนใหม่ได้)
  async function loadScannedUnit(u) {
    // ★ กันไว้ตั้งแต่ต้น: โปรเจคปิดแล้ว → เตือนทันที ไม่ให้เข้าหน้าทำงาน (ไม่ต้องเสียเวลาแล้วโดนเด้งตอนกด OK)
    if (u?.part_master?.projects?.status === "closed") {
      errorBeep();
      flash(t("โปรเจคนี้ปิดแล้ว (ทำเสร็จ) — บันทึกงานเพิ่มไม่ได้ · แจ้งแอดมินถ้าต้องแก้งาน",
              "This project is closed — can't add work · ask admin to reopen for rework"), "warn");
      return false;
    }
    // ★ Modify: Part นี้ถูกยกเลิกในออฟฟิศ (M-xx) → จอแดงบล็อก ไม่ให้เข้าหน้าทำงาน
    if (u?.release?.mod_cancelled_at) {
      errorBeep();
      const pn = u.part_master?.part_no || "";
      const ver = fmtM(u.release.mod_version) || "Modify";
      const moved = u.release.mod_cancel_keep === "moved";
      flash(moved
        ? t(`⛔ ${pn} ถูกย้ายไปเบอร์อื่นหมดแล้วใน ${ver} — สแกนชิ้นที่ติดป้ายใหม่ หรือแจ้งออฟฟิศ`, `⛔ ${pn} was fully moved to another number in ${ver} — ask the office`)
        : t(`⛔ ${pn} ถูกยกเลิกใน ${ver} — หยุดทำ · ชิ้นที่ทำแล้วแยกเก็บตามที่ออฟฟิศกำหนด`, `⛔ ${pn} was cancelled in ${ver} — stop · set finished pieces aside`), "warn");
      return false;
    }
    tickBeep();   // เสียงเบายืนยันว่าเจอชิ้นงาน
    const gen = jobGenRef.current;
    const opId = (dept === "machine" ? primaryOp?.id : null) || op?.id || user.operation?.id || null;
    // ★ รอบ 11 (B24): เลขวิ่ง + rework + ล็อกสถานะ ในคำขอเดียว (เดิม 3 คำขอต่อกัน + โหลดทุกแถวมารวม)
    //   กฎเลือกสถานะ = ที่เครื่องนี้เคยบันทึกไว้กับ (รีลีส+ขั้นตอน) นี้ (fail-open ถ้าออฟไลน์/พลาด)
    //   ★ เพิ่มจำนวนแล้ว (mod_qty_at) → นับ Finished เฉพาะหลังจากนั้น (ปลดล็อก)
    const info = opId
      ? await getStationScanInfo({ releaseId: u.release_id, operationId: opId, machineId: machine?.id, partUnitId: u.id, sinceIso: u.release?.mod_qty_at || null })
      : { done: null, dup: 0, lock: { finishedExists: false, inProcessExists: false } };
    if (gen !== jobGenRef.current) return false;   // ★ ระหว่างรอ ผู้ใช้กดยกเลิก/จบงานไปแล้ว → ทิ้งผลนี้
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const done = info.done, dup = info.dup || 0, lock = info.lock;
    setDupCount(dup);
    setProgress({ done, total: u.release?.qty ?? null, offline, noOp: !opId });
    setStatusLock(lock);
    // เลือกสถานะเริ่มต้นให้เมื่อมีทางเดียว: เคย Finished → Finished · เคย In Process → In Process (Finished ปลดล็อกเมื่อครบ)
    if (lock.finishedExists) setStatus("finished");
    else if (lock.inProcessExists) setStatus("inprocess");
    else setStatus(null);
    setUnit(u); unitRef.current = u;          // ชิ้นที่สแกนล่าสุด = ชิ้นที่บันทึก (เหมือนเดิม)
    return true;
  }
  // ★ สแกน 2 รอบ: เพิ่ม "สแกนรอบแรก" ตอนเริ่มงานเท่านั้น — ที่เหลือเหมือนเดิมทุกอย่าง
  //   รอบ 1 = เริ่มจับเวลา · รอบ 2 = ขั้นตอนสแกนเดิม (ใส่จำนวน · สถานะ · OK) เวลาเดินจนกด OK
  async function showScannedUnit(u, gen = jobGenRef.current) {
    if (gen !== jobGenRef.current) return false;   // ★ B23: สแกนนี้เริ่มก่อนกดยกเลิก → ทิ้ง
    // ★ 2026-10-10 ตรวจรอบ 2: พัก/เครื่องหยุดอยู่ แต่กล้องยังเปิดค้างใต้แผ่นบัง → ป้ายที่ผ่านหน้ากล้องเริ่มจับเวลาเอง (ช่วงพักถูกนับเป็นเวลาทำงาน)
    if (holdRef.current) { errorBeep(); flash(holdMsg(), "warn"); return false; }
    // ★ โหมดสแกนครั้งเดียว: สแกน = ทำเสร็จแล้ว → ตรวจเหมือนเดิม → หน้าจำนวน + สถานะ → OK (ไม่จับเวลา)
    if (quickRef.current) {
      // ★ 2026-10-10 ตรวจรอบ 2: ป้ายเดียวกับที่เพิ่งบันทึก (ภายใน 90 วิ) — มักเป็นป้ายเดิมที่ยังค้างหน้ากล้อง → ถามก่อน (กันนับซ้ำ)
      const ls = lastSavedRef.current;
      if (ls && u && ls.unitId === u.id && Date.now() - ls.at < 90 * 1000) {
        errorBeep();
        const secs = Math.max(1, Math.round((Date.now() - ls.at) / 1000));
        const again = await askConfirm({
          message: t(`ป้ายนี้ (${u.part_master?.part_no || ""}) เพิ่งบันทึกไปเมื่อ ${secs} วินาทีที่แล้ว — ทำชิ้นนี้เพิ่มอีกจริงไหม?\n\nถ้าป้ายเดิมยังอยู่หน้ากล้อง กด "ไม่ใช่"`,
            `This label (${u.part_master?.part_no || ""}) was saved ${secs} s ago — really add it again?\n\nIf the old label is still in front of the camera, press "No"`),
          tone: "warn", confirmText: t("บันทึกเพิ่ม", "Add again"), cancelText: t("ไม่ใช่ (ปิดกล้อง)", "No (close camera)"),
        });
        if (gen !== jobGenRef.current) return false;
        if (!again) { resetAll(true); return false; }
      }
      if (!(await loadScannedUnit(u))) return false;
      if (gen !== jobGenRef.current) return false;
      stopTimer(); setElapsed(0);
      setQty(1);
      clearTimeout(toastRef.current); setToast(null);
      setStep(STEP.PART);
      return true;
    }
    const job = unitRef.current;
    if (job) {
      // รอบ 2: QR ไหนก็ได้ ขอแค่เป็นเบอร์พาร์ทเดียวกัน (โปรเจคเดียวกัน) กับที่เริ่มไว้
      if (!samePartAsJob(u, job)) return false;
      if (!(await loadScannedUnit(u))) return false;
      setQty((q) => (q > 0 ? q : 1));       // ค่าเริ่ม 1 (เหมือนเดิม) — แก้เป็นจำนวนจริงที่ทำได้
      clearTimeout(toastRef.current); setToast(null);   // ล้างข้อความเตือน "ไม่ตรง" ของรอบก่อน (สแกนถูกแล้ว)
      setStep(STEP.PART);
      return true;
    }
    const t0 = Date.now();   // เวลาเริ่มจริง = ตอนสแกนรอบ 1 (ก่อนรอถามข้อมูลจาก DB)
    if (!(await loadScannedUnit(u))) return false;
    if (gen !== jobGenRef.current) return false;   // ยกเลิกไปแล้วระหว่างรอ → ไม่เริ่มงานผี
    setQty(0);                                // จำนวนใส่ตอนสแกนรอบ 2
    pauseRef.current = { total: 0, since: null };
    startTsRef.current = t0; startTimer();   // ★ เริ่มจับเวลาตอนสแกนรอบ 1
    loadTypical(u);                          // ★ รอบ 13: เวลาปกติต่อชิ้นของเบอร์นี้ (ไว้เตือนตอนกด OK)
    setStep(STEP.REC);
    flash(t("เริ่มจับเวลาแล้ว — ยกชิ้นงานขึ้นเครื่อง · ทำเสร็จแล้วกด SCAN สแกนอีกครั้ง",
            "Timer started — load the piece · when done press SCAN and scan again"), "ok");
    return true;
  }
  // รอบ 2 ต้องตรงกับงานที่เริ่มไว้ทั้ง เบอร์พาร์ท + โปรเจค + Release (QR ไหนก็ได้) · ไม่ตรง = เตือน บอกว่าไม่ตรงตรงไหน
  function samePartAsJob(u, job) {
    const norm = (x) => String(x || "").trim().toUpperCase();
    const jp = job.part_master || {}, up = u?.part_master || {};
    const jr = job.release || {}, ur = u?.release || {};
    const jPn = jp.part_no || "?", jProj = jp.projects?.code || "?", jRo = jr.release_order || "?";
    const samePn = !!(u?.part_master_id && job.part_master_id && u.part_master_id === job.part_master_id)
      || (norm(up.part_no) !== "" && norm(up.part_no) === norm(jp.part_no));
    const sameProj = (up.project_id && jp.project_id) ? up.project_id === jp.project_id
      : norm(up.projects?.code) === norm(jp.projects?.code);
    const sameRel = (u?.release_id && job.release_id && u.release_id === job.release_id)
      || (norm(ur.release_order) !== "" && norm(ur.release_order) === norm(jr.release_order));
    if (samePn && sameProj && sameRel) return true;
    errorBeep();
    const need = t(`สแกนป้ายของ ${jPn} · โปรเจค ${jProj} · Release ${jRo}`, `scan a label of ${jPn} · project ${jProj} · Release ${jRo}`);
    flash(!samePn
      ? t(`⛔ เบอร์ไม่ตรงกับงานที่เริ่มไว้ (สแกนได้ ${up.part_no || "?"}) — ${need}`, `⛔ Not the part you started (scanned ${up.part_no || "?"}) — ${need}`)
      : !sameProj
        ? t(`⛔ เบอร์ถูก แต่คนละโปรเจค (${up.projects?.code || "?"}) — ${need}`, `⛔ Right part, other project (${up.projects?.code || "?"}) — ${need}`)
        : t(`⛔ เบอร์ถูก แต่คนละ Release (${ur.release_order || "?"}) — ${need}`, `⛔ Right part, other Release (${ur.release_order || "?"}) — ${need}`), "warn");
    return false;
  }
  // สแกน QR (จากกล้อง) — ถ้าอ่านได้เป็นเบอร์พาร์ท ลอง fallback หา 1 ตัว (กล้องเดี่ยวไม่มี UI ให้เลือก)
  // คืน true=พบ, false=ไม่พบ
  const curOpId = () => op?.id || user.operation?.id || null;
  async function onDecoded(qr) {
    if (!qr) return false;
    const gen = jobGenRef.current;              // ★ B23: รุ่นงานตอนเริ่มสแกน (ยกเลิกระหว่างค้น = ทิ้งผล)
    setBusy(true);
    const u = await findUnitByQr(qr);           // QR = ระบุชิ้น/โปรเจค/ใบเจาะจงเสมอ
    if (u) { setBusy(false); return await showScannedUnit(u, gen); }   // โปรเจคปิด → คืน false ให้สแกนต่อได้
    // ★ Modify: QR ที่ถูกยกเลิก (ลดจำนวน/ยกเลิก Part) → บอกให้ชัดว่ายกเลิกใน M ไหน (ไม่ใช่แค่ "ไม่พบ")
    { const cq = await lookupCancelledQr(qr); if (cq) { setBusy(false); errorBeep(); flash(cancelledQrMsg(cq), "warn"); return false; } }
    // ไม่เจอด้วย QR → เผื่อชี้กล้องที่ "เบอร์พาร์ท": ตรงโปรเจคเดียวใช้เลย · หลายโปรเจค → อย่าเดา ให้พิมพ์เลือก
    const opts = await findManualPartOptions(qr, curOpId());
    setBusy(false);
    if (opts.length === 1) { return await showScannedUnit(opts[0].unit, gen); }
    if (opts.length >= 2) {
      errorBeep();
      flash(t("เบอร์นี้อยู่หลายโปรเจค — พิมพ์ในช่องด้านล่างแล้วเลือกโปรเจค",
              "This number is in several projects — type it below and pick the project"), "warn");
      return false;
    }
    errorBeep(); flash("ไม่พบ QR/เบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง", "warn"); return false;
  }
  const cancelledQrMsg = (cq) => t(
    `⛔ QR นี้ถูกยกเลิกใน ${fmtM(cq.version) || "Modify"} (${cq.why || "ยกเลิก"}${cq.part_no ? " · " + cq.part_no : ""}) — ไม่ต้องทำชิ้นนี้ · แยกออก · แจ้งออฟฟิศถ้าทำไปแล้ว`,
    `⛔ This QR was cancelled in ${fmtM(cq.version) || "Modify"} (${cq.why === "ลดจำนวน" ? "qty reduced" : "part cancelled"}${cq.part_no ? " · " + cq.part_no : ""}) — don't make it · set it aside · tell the office if already made`);
  // พิมพ์เบอร์พาร์ท/QR ในช่องกรอก — เบอร์พาร์ทอยู่หลายโปรเจค → ให้เลือก "โปรเจค" (ไม่ต้องเลือก release)
  // คืน { ok:true } เมื่อระบุได้เลย · { ok:false, choose:[options] } เมื่อต้องเลือกโปรเจค · { ok:false } เมื่อไม่พบ
  async function onManualEntry(text) {
    const s = String(text || "").trim();
    if (!s) return { ok: false };
    const gen = jobGenRef.current;
    setBusy(true);
    // 1) เผื่อพิมพ์เป็น QR (unique) → ระบุชิ้นเจาะจงได้เลย
    const u = await findUnitByQr(s);
    if (u) { setBusy(false); return { ok: await showScannedUnit(u, gen) }; }
    { const cq = await lookupCancelledQr(s); if (cq) { setBusy(false); errorBeep(); flash(cancelledQrMsg(cq), "warn"); return { ok: false }; } }
    // 2) เป็นเบอร์พาร์ท → หาตัวเลือกระดับโปรเจค (findManualPartOptions ตัดโปรเจคปิดออกให้แล้ว)
    const opts = await findManualPartOptions(s, curOpId());
    setBusy(false);
    if (!opts.length) { errorBeep(); flash("ไม่พบเบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง", "warn"); return { ok: false }; }
    if (opts.length === 1) { return { ok: await showScannedUnit(opts[0].unit, gen) }; }
    return { ok: false, choose: opts };   // หลายโปรเจค → ให้เลือก
  }
  // คนงานเลือกโปรเจคแล้ว → ใช้ชิ้นตัวแทนของโปรเจคนั้น
  async function onPickUnit(u) { if (u) { setBusy(false); await showScannedUnit(u); } }

  // ★ รอบ 13: เวลาปกติต่อชิ้น (ค่ากลาง 40 ครั้งล่าสุดของเบอร์นี้ × ขั้นตอนหลัก) → เตือนเวลาผิดปกติตอนกด OK
  const typicalRef = useRef(null);   // { key, v:{ n, median } }
  const durWarnedRef = useRef(null); // เตือนแล้วสำหรับงานไหน (เวลาเริ่ม) — เตือนครั้งเดียวต่องาน
  function loadTypical(u) {
    const pm = u?.part_master_id || u?.part_master?.id || null;
    const opId = primaryOp?.id || op?.id || user.operation?.id || null;
    const key = `${pm}|${opId}`;
    typicalRef.current = { key, v: null };
    if (!pm || !opId) return;
    getTypicalTime(pm, opId).then((v) => { if (typicalRef.current && typicalRef.current.key === key) typicalRef.current = { key, v }; }).catch(() => {});
  }
  // คืน null = ปกติ · { kind:'fast'|'slow', secs, per, median } = ผิดปกติ
  function durationIssue() {
    const secs = activeSecs();
    const q = Math.max(1, Number(qty) || 1);
    const per = secs / q;
    const v = typicalRef.current && typicalRef.current.v;
    if (v && v.n >= 5 && v.median > 0) {
      if (per < v.median / 4 && v.median * q - secs > 30) return { kind: "fast", secs, per, median: v.median };
      if (per > v.median * 4 && secs - v.median * q > 600) return { kind: "slow", secs, per, median: v.median };
      return null;
    }
    if (secs < 2) return { kind: "fast", secs, per, median: null };                  // ไม่มีประวัติ: สแกน 2 รอบติดกันทันที = ลืมสแกนตอนเริ่ม
    if (secs > 8 * 3600) return { kind: "slow", secs, per, median: null };
    return null;
  }

  // กด OK = บันทึกทันที (ไม่ต้องกด SAVE อีก)
  // ★ 2026-10-10 ตรวจรอบ 3: กันกด OK ซ้ำระหว่างหน้าต่างถาม (ครั้งที่ 2 ข้ามคำเตือนแล้วบันทึก + ครั้งแรกบันทึกซ้ำอีก)
  const confirmingRef = useRef(false);
  async function confirmPart() {
    if (confirmingRef.current || savingRef.current) return;
    confirmingRef.current = true;
    try { await confirmPartInner(); } finally { confirmingRef.current = false; }
  }
  async function confirmPartInner() {
    // ★ 2026-10-10 ตรวจรอบ 3: จำรุ่นงาน/ชิ้น/step ก่อนถาม → หลังตอบแล้วงานเปลี่ยน (ยกเลิก/สแกนใหม่) = ไม่บันทึก
    const gen0 = jobGenRef.current, unit0 = unitRef.current, step0 = stepRef.current;
    const stillSame = () => gen0 === jobGenRef.current && unit0 === unitRef.current && step0 === stepRef.current;
    if (!status) { flash("เลือกสถานะ In Process หรือ Finished", "warn"); return; }
    // ── กฎเลือกสถานะต่อเครื่อง (กันไว้อีกชั้น เผื่อ draft เก่า/หลุดปุ่ม disabled) ──
    if (statusLock.finishedExists && status === "inprocess") {
      flash(t("เครื่องนี้บันทึกเบอร์นี้เป็น Finished แล้ว — เลือก In Process ไม่ได้", "This machine already marked this part Finished — In Process not allowed"), "warn"); return;
    }
    if (statusLock.inProcessExists && !statusLock.finishedExists && status === "finished") {
      const totQ = unit?.release?.qty ?? null;
      const projQ = (Number(progress?.done) || 0) + (Number(qty) || 0);
      if (totQ != null && projQ < totQ) {
        flash(t(`ยังไม่ครบจำนวน (${nc(projQ)}/${nc(totQ)}) — เลือก Finished ได้เมื่อครบ`, `Not complete yet (${nc(projQ)}/${nc(totQ)}) — Finished unlocks when complete`), "warn"); return;
      }
    }
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
    if (!stillSame()) return;   // ★ 2026-10-10 ตรวจรอบ 3: งานเปลี่ยนระหว่างถาม → ไม่บันทึก
    // หมายเหตุ: ไม่เด้ง confirm "ทำซ้ำ (rework)" อีกแล้ว — เตือนแบบไม่บล็อก (ไม่หยุดเวลา) และเฉพาะ
    //   ตอน "เกินจำนวนสั่ง" เท่านั้น (ดูป้าย ⚠ เกินจำนวนสั่ง ในการ์ด · ยังไม่เกิน = ไม่เตือน)
    // ★ รอบ 13: เวลาผิดปกติ (เร็ว/ช้ากว่าปกติมาก) → ถามก่อนบันทึก (ครั้งเดียวต่องาน · มีเหตุผลรอบช้าแล้ว = ไม่ถามเรื่องช้า)
    const iss = quick ? null : durationIssue();   // โหมดสแกนครั้งเดียว = ไม่มีเวลา ไม่ต้องตรวจ
    if (iss && durWarnedRef.current !== startTsRef.current && !(iss.kind === "slow" && slowArmed)) {
      durWarnedRef.current = startTsRef.current;
      const typ = iss.median ? t(` · ปกติ ~${hms(Math.round(iss.median))} ต่อชิ้น`, ` · usually ~${hms(Math.round(iss.median))} per piece`) : "";
      const msg = iss.kind === "fast"
        ? t(`⏱ เวลาเร็วผิดปกติ: ${hms(iss.secs)} สำหรับ ${nc(qty)} ชิ้น${typ}\n\nลืมสแกนรอบแรกตอนเริ่มงาน หรือใส่จำนวนผิดหรือเปล่า?`,
            `⏱ Unusually fast: ${hms(iss.secs)} for ${qty} pc${typ}\n\nDid you forget the first scan at the start, or enter the wrong quantity?`)
        : t(`⏱ เวลานานผิดปกติ: ${hms(iss.secs)} สำหรับ ${nc(qty)} ชิ้น${typ}\n\nลืมกด "พักงาน/แจ้งหยุด" หรือเปล่า? ถ้ารอบนี้ช้าจริง กด "กลับไปตรวจ" แล้วใช้ปุ่ม แจ้งปัญหา → ใส่เหตุผล`,
            `⏱ Unusually long: ${hms(iss.secs)} for ${qty} pc${typ}\n\nDid you forget "Break/Stop"? If this round really was slow, press "Go back" and use REPORT → reason`);
      if (!(await askConfirm({ title: t("ตรวจเวลาก่อนบันทึก", "Check the time"), message: msg, tone: "warn",
        confirmText: t("บันทึกตามนี้", "Save anyway"), cancelText: t("กลับไปตรวจ", "Go back") }))) return;
      if (!stillSame()) return;   // ★ 2026-10-10 ตรวจรอบ 3: งานเปลี่ยนระหว่างถาม → ไม่บันทึก
    }
    await doSave();
  }

  // ── บันทึก (เรียกจากปุ่ม OK) ─────────────────────────────────────────────
  async function doSave() {
    if (savingRef.current) return;      // กันกด OK รัวๆ → บันทึกซ้ำ (re-entrancy)
    // ★ หน้าเครื่อง: บันทึก "ทุกขั้นตอนที่เลือก" (CNC ทำหลายขั้นในครั้งเดียว) · ต้องเลือกอย่างน้อย 1 ขั้นตอน
    // ★ รอบ 11 (A3): เรียงตามลำดับกระบวนการ (seq) — ตัวแรก = ขั้นตอนหลัก (ตัวเดียวกับที่ใช้นับเลขวิ่ง/ล็อกสถานะ)
    const opIds = (dept === "machine")
      ? (selOps.length ? selOps.map((o) => o.id) : (op?.id ? [op.id] : []))
      : [op?.id || null];
    if (opIds.length === 0) { flash(t("เลือกอย่างน้อย 1 ขั้นตอนก่อนบันทึก", "pick at least one operation first"), "warn"); return; }
    savingRef.current = true;
    setBusy(true);
    // สร้าง client_id ครั้งเดียวต่อการบันทึกชิ้นนี้ · ถ้ากด OK ซ้ำ (retry หลังพลาด) ใช้ตัวเดิม
    // → ฝั่ง DB dedup ด้วย client_id ได้ กันบันทึกซ้ำแม้ error ที่ไม่ใช่เน็ต (เช่น insert สำเร็จแต่ตอบกลับพลาด)
    // ★ ต้องเป็น "UUID จริง" เสมอ (คอลัมน์ client_id เป็น uuid) — newClientId() รับประกันได้แม้เครื่อง
    //   ไม่มี crypto.randomUUID (เปิดผ่าน http / webview เก่า) · เดิมใช้ fallback ที่ไม่ใช่ UUID → insert พัง
    if (!clientIdMapRef.current) clientIdMapRef.current = {};   // client_id แยกต่อขั้นตอน (คงเดิมตอน retry)
    // ★ สร้าง client_id ของ "ทุกขั้นตอน" ล่วงหน้า แล้วเซฟลง draft ก่อนยิง —
    //   ถ้ารีโหลด/แอปอัปเดตกลางการบันทึก (insert ติดแล้วแต่ตอบกลับหาย) แล้วกู้งานมากด OK ซ้ำ จะใช้ id เดิม → DB dedup ไม่บันทึกซ้ำ
    for (const oid of opIds) { const k = String(oid); if (!clientIdMapRef.current[k]) clientIdMapRef.current[k] = newClientId(); }
    try { const raw = localStorage.getItem(DKEY); const d0 = raw ? JSON.parse(raw) : {}; d0.clientIdMap = clientIdMapRef.current; localStorage.setItem(DKEY, JSON.stringify(d0)); } catch { /* localStorage เต็ม/ปิด — ข้าม */ }
    try {
      // น้ำหนักต่อชิ้น (mirror ฝั่งเซิร์ฟเวอร์: unit.weight ?? part_master.unit_weight) → เก็บลงคิวไว้โชว์ยอดออฟไลน์
      const wpp = Number(unit.weight ?? unit.part_master?.unit_weight ?? 0) || 0;
      // ★ count-once: 1 สแกน = 1 รอบเครื่อง · ขั้นตอน "หลัก" (ตัวแรกที่เลือก) นับจำนวน/เวลา/น้ำหนักจริง
      //   ขั้นตอนอื่นที่เลือก = บันทึกเป็น "ทำแล้ว" แต่ยอด 0 (ไม่บวกจำนวน/เวลา/น้ำหนักซ้ำตามจำนวนขั้นตอน)
      const primaryId = opIds[0];
      const pk = String(primaryId);
      if (!clientIdMapRef.current[pk]) clientIdMapRef.current[pk] = newClientId();
      const res = await recordMachineWork({
        qr: unit.qr_code,
        quantity: qty,
        materialLengthMm: (quick || materialLen === "") ? null : Number(materialLen),
        processSeconds: quick ? 0 : activeSecs(),   // ★ โหมดสแกนครั้งเดียว = ไม่จับเวลา (0)   // ★ คิดจากเวลาเริ่มจริง (ไม่พึ่งนาฬิกาบนจอ) · ★ รอบ 13: ไม่รวมช่วงพัก/หยุด
        status,
        releaseId: unit.release_id,   // ใช้คำนวณ running number ตอนออฟไลน์
        operationId: primaryId,       // ★ ขั้นตอนหลัก — นับยอด/เวลา/น้ำหนักจริง
        clientId: clientIdMapRef.current[pk], // ★ คงเดิมตอน retry
        weight: qty * wpp,            // ★ ยอดน้ำหนักงานนี้ (ไว้บวกยอดรวมออฟไลน์)
      });
      if (!res || res.ok === false) {
        errorBeep();        // บันทึกผิดพลาด = เตือนครั้งเดียว
        const msg = res?.reason === "project_closed"
          ? t("โปรเจคนี้ปิดแล้ว — บันทึกไม่ได้ · แจ้งแอดมินถ้าต้องแก้งาน", "Project closed — can't save · ask admin to reopen")
          : (res?.reason === "qr_cancelled" || res?.reason === "release_cancelled")
            ? t(`⛔ ${fmtMText(res.message) || "ถูกยกเลิกใน Modify"} — ออฟฟิศเพิ่งแก้ Release นี้ · สแกนใหม่`, `⛔ Cancelled in ${fmtM(res.version) || "Modify"} — the office just changed this release · rescan`)
            : (res?.message || (res?.reason && res.reason !== "error" ? t(`บันทึกไม่สำเร็จ — ${reasonText(res.reason, t)}`, `Save failed — ${reasonText(res.reason, t)}`) : t("บันทึกไม่สำเร็จ", "Save failed")));
        flash(msg, "warn");
        setStep(STEP.PART); // กลับไปหน้าจำนวน/สถานะ ให้กด OK ลองใหม่ได้
        return;
      }
      let anyRow = false;
      if (res.daily) setDaily(res.daily);
      if (res.row) { setRows((rs) => [...rs, res.row]); setNewRowId(res.row.id || `${Date.now()}`); anyRow = true; }
      // ขั้นตอนอื่นที่เลือก — มาร์กว่า "ทำแล้ว" ยอด 0 (ไม่บวกซ้ำ) · นับผลไว้แจ้งบนจอ (วินิจฉัยบนแท็บเล็ตได้)
      let coOk = 0, coFail = 0, coReason = "", coParked = 0;
      // ★ 2026-10-10 ตรวจรอบ 3: token หมดอายุ (เซสชันถูกล้าง) → ไม่ยิงขั้นตอนร่วมต่อ (จะเข้าคิวแบบไม่มีเจ้าของ) · เก็บเข้า "ซิงค์ไม่สำเร็จ" ในชื่อบัญชีนี้แทน
      let authGone = !!res.authExpired;
      const coOwner = { emp: user.id, code: user.code || null, name: user.name || null, machine: user.machine?.id || null, machineCode: user.machine?.code || null };
      for (const oid of opIds.slice(1)) {
        const k = String(oid);
        if (!clientIdMapRef.current[k]) clientIdMapRef.current[k] = newClientId();
        const payload = {
          qr: unit.qr_code, quantity: 0,
          materialLengthMm: (quick || materialLen === "") ? null : Number(materialLen),
          processSeconds: 0, status,
          releaseId: unit.release_id, operationId: oid,
          clientId: clientIdMapRef.current[k], weight: 0,
          recordedAt: new Date().toISOString(),
        };
        let cr = null;
        if (authGone) cr = { ok: false, reason: "unauthorized" };
        else { try { cr = await recordMachineWork(payload); } catch { cr = { ok: false, reason: "exception" }; } }
        if (cr && cr.authExpired) authGone = true;   // ★ 2026-10-10 ตรวจรอบ 3: ตัวนี้เข้าคิวแล้ว แต่ตัวถัดไปหยุด
        if (cr && cr.ok !== false) { coOk++; continue; }
        coFail++; coReason = cr?.reason || coReason;
        // ★ รอบ 11 (B20): ขั้นตอนร่วมที่บันทึกไม่ได้ → เก็บเข้า "ซิงค์ไม่สำเร็จ" + แจ้งออฟฟิศ (เดิมหายเงียบ)
        //   (client_id เดิม → กด "ลองซิงค์ใหม่" แล้วไม่ซ้ำ)
        const mw = {
          p_qr: String(payload.qr || "").trim(), p_quantity: 0,
          p_material_length: payload.materialLengthMm, p_process_seconds: 0, p_status: status || "inprocess",
          p_client_id: payload.clientId, p_recorded_at: payload.recordedAt, p_operation_id: oid,
        };
        if (addRejected({ machineWork: mw, release_id: unit.release_id || null, weight: 0, qid: payload.clientId, owner: coOwner }, cr?.reason || "cotick_failed")) coParked++;
      }
      const savedSteps = 1 + coOk;   // ขั้นตอนหลัก + co-tick ที่สำเร็จ
      if (quick) lastSavedRef.current = { unitId: unit.id, at: Date.now() };   // ★ 2026-10-10 ตรวจรอบ 2: กันป้ายเดิมค้างหน้ากล้อง
      setStorageFull(false);   // บันทึก/เข้าคิวได้แล้ว = ที่เก็บไม่เต็มแล้ว
      // ★ รอบ 13: แนบเหตุผล "รอบช้า" ได้ทั้งออนไลน์ (record id) และออฟไลน์ (client_id → ส่งหลังงานซิงค์) · ค้างไว้ต่อจนกดยกเลิก
      if (slowArmed) {
        const recId = res && res.row && res.row.id ? res.row.id : null;
        stationSlowReason({ machineId: machine?.id, recordId: recId, recordClientId: recId ? null : clientIdMapRef.current[pk],
          reason: slowArmed.reason, note: slowArmed.note }).then(() => loadReports()).catch(() => {});
      }
      if (res.queued) {
        okBeep();
        flash("เน็ตสะดุด — เก็บเข้าคิวแล้ว จะซิงค์ให้อัตโนมัติ", "ok");
        resetAll(true);        // เก็บความยาววัสดุไว้ (มักเท่าเดิมทั้งชุด)
        reload();              // ★ อัปเดตยอด "วันนี้" + ตารางจากคิวออฟไลน์ (offlineMachineDay รวมงานค้าง) — กันคนงานเห็นยอดนิ่งแล้วสแกนซ้ำ
        return;
      }
      if (!anyRow) reload();   // เผื่อ server ไม่คืน row — ดึงยอด/ตารางใหม่
      else getStationDayOps().then((d) => setDayOps(d)).catch(() => {});   // ★ รอบ 13: ยอดแยกขั้นตอนอัปเดตทันที
      okBeep();                // ★ เสียง+สั่นยืนยันสำเร็จ (เดิมสำเร็จเงียบ คนงานไม่รู้ว่าบันทึกแล้ว)
      // แจ้งผลจำนวนขั้นตอนที่บันทึก — โชว์บนจอ (เห็นบนแท็บเล็ตโดยไม่ต้องเปิด DevTools)
      if (opIds.length > 1 && coFail > 0) {
        flash(t(`บันทึก ${nc(savedSteps)}/${nc(opIds.length)} ขั้นตอน · พลาด ${coFail} (${reasonText(coReason, t)})${coParked ? " — เก็บไว้ที่ \"ซิงค์ไม่สำเร็จ\" แล้ว" : ""}`,
                `Saved ${nc(savedSteps)}/${nc(opIds.length)} steps · ${coFail} failed (${reasonText(coReason, t)})${coParked ? " — kept under “failed to sync”" : ""}`), "warn");
      } else {
        // โชว์จำนวนขั้นตอนเสมอ (ต่างจากข้อความเดิม) → ถ้ายังเห็น "บันทึกแล้ว ✓ พร้อมงานถัดไป" = แท็บเล็ตยังรันโค้ดเก่า (แคช)
        flash(t(`บันทึกครบ ${savedSteps} ขั้นตอน ✓`, `Saved ${savedSteps} step(s) ✓`), "ok");
      }
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
  // ★ รอบ 11 (L1): เลื่อนลงแถวล่าสุด "เฉพาะตอนมีแถวใหม่" (เดิมทุก 45 วิ ที่รีเฟรช → กำลังดูแถวเก่าก็เด้งลงล่าง)
  const lastRowCountRef = useRef(-1);
  useEffect(() => {
    lockTableHeight();
    const n = rows.length;
    if (tableRef.current && n > lastRowCountRef.current) tableRef.current.scrollTop = tableRef.current.scrollHeight;
    lastRowCountRef.current = n;
  }, [rows, lockTableHeight]);
  // จอหมุน/เปลี่ยนขนาด → ฟอนต์ vh เปลี่ยน ต้องคำนวณความสูงใหม่
  useEffect(() => {
    const on = () => lockTableHeight();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, [lockTableHeight]);

  // ── โหมดของหน้านี้ "ล็อกตามแผนก" (dept) แล้ว — assembly/packing = โหมดประกอบ/แพ็ก · machine = งานเครื่อง ──
  const isAsm = dept === "assembly" || dept === "panel" || dept === "glazing" || isPackingDept(dept);
  // นับ "สะสม" = ที่ติดตั้งไปแล้ว (สเตชันก่อน) + ที่สแกนรอบนี้ · ครบเมื่อทุกบรรทัด ≥ qty
  const asmHave = (pmId) =>
    (asmParent?.installed || []).filter((x) => x.child_pm_id === pmId).length +
    asmChildren.filter((c) => c.child_pm_id === pmId).length;
  const asmComplete = !!asmParent && asmParent.bom.every((b) => asmHave(b.child_pm_id) >= b.qty);

  // เปลี่ยนขั้นตอน → ล้างสถานะประกอบที่ค้าง (กันสับสนข้ามงาน)
  const asmOpRestoreRef = useRef(null);   // ★ 2026-10-10 ตรวจรอบ 3: op ที่เพิ่งกู้จาก WIP → ข้ามการล้างรอบนี้ (ไม่งั้นล้าง WIP ที่เพิ่งกู้)
  useEffect(() => {
    if (asmOpRestoreRef.current != null && asmOpRestoreRef.current === (op?.id ?? null)) { asmOpRestoreRef.current = null; return; }
    setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false);
  }, [op?.id]);

  // ── กัน "ลูกที่สแกนยังไม่ยืนยัน หายตอน refresh / กดอัปเดต" (โหมดประกอบ/แพ็ก) ──
  //   เก็บ WIP (เบอร์แม่ + ลูกที่สแกนรอบนี้) ลง localStorage แบบสด แล้วกู้กลับตอนเปิดแอปใหม่
  const asmWipKey = ASM_WIP_KEY + ":" + (machine?.id || "x");
  const asmWipLoadedRef = useRef(false);
  // กู้ครั้งเดียวตอนเปิด — วางไว้ "หลัง" effect ล้างสถานะข้างบน + รอ opsLoaded (op นิ่งแล้ว) → การกู้ชนะ ไม่โดน effect ล้าง op ทับ
  useEffect(() => {
    if (asmWipLoadedRef.current) return;                                 // กู้ครั้งเดียวพอ
    if (dept === "machine") { asmWipLoadedRef.current = true; return; }   // เครื่องใช้ draft แยก (ไม่เกี่ยว)
    if (!opsLoaded) return;                                               // รอ ops เซ็ตตัว (op auto-select เสร็จ) ก่อน — กัน effect ล้าง op มาลบ WIP ที่เพิ่งกู้
    try {
      const raw = localStorage.getItem(asmWipKey);
      if (raw) {
        const w = JSON.parse(raw);
        const tooOld = w && w.savedAt && (Date.now() - w.savedAt > DRAFT_MAX_AGE_MS);
        if (w && w.v === 1 && w.parent && !tooOld) {
          setAsmParent(w.parent);
          const kids = Array.isArray(w.children) ? w.children : [];
          setAsmChildren(kids);
          if (w.parentQty != null) setAsmParentQty(Math.max(0, Math.floor(Number(w.parentQty) || 0)));   // กู้ "จำนวนที่จะทำ" + สถานะยืนยันจำนวน (ซับ) — refresh แล้วไม่ต้องตั้งใหม่
          if (w.qtyLocked) setAsmQtyLocked(true);
          // ★ 2026-10-10 ตรวจรอบ 3: กู้ขั้นตอนที่เลือกไว้ (ถ้ายังเป็นขั้นตอนของสเตชันนี้) — เดิมกู้แล้วบันทึกเป็นขั้นตอนค่าเริ่มต้น
          const wop = w.opId != null ? machineOps.find((o) => o.id === w.opId) : null;
          if (wop && wop.id !== op?.id) { asmOpRestoreRef.current = wop.id; setOp(wop); }
          flash(kids.length
            ? t("กู้รายการที่สแกนค้างไว้ (" + kids.length + ") กลับมาแล้ว — ตรวจแล้วกดยืนยันได้เลย", "Restored " + kids.length + " scanned item(s) — review & confirm")
            : t("กู้เบอร์แม่ที่ค้างไว้กลับมาแล้ว", "Restored the parent you were working on"), "ok");
        } else if (tooOld) {
          localStorage.removeItem(asmWipKey);
        }
      }
    } catch { /* localStorage ปิด/เสีย — ข้าม (ไม่ทำแอปพัง) */ }
    asmWipLoadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsLoaded]);
  // เขียน WIP แบบสดทุกครั้งที่เบอร์แม่/ลูกเปลี่ยน (หลังผ่านขั้นกู้แล้วเท่านั้น กันเขียนทับตอนโหลด)
  useEffect(() => {
    if (dept === "machine" || !asmWipLoadedRef.current) return;
    try {
      if (asmParent) localStorage.setItem(asmWipKey, JSON.stringify({ v: 1, parent: asmParent, children: asmChildren, parentQty: asmParentQty, qtyLocked: asmQtyLocked, opId: op?.id ?? null, savedAt: Date.now() }));   // ★ 2026-10-10 ตรวจรอบ 3: เก็บ opId
      else localStorage.removeItem(asmWipKey);   // ไม่มีเบอร์แม่ (Back / ยืนยันแล้ว) → ล้าง WIP
    } catch { /* เต็ม/ปิด — ข้าม */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asmParent, asmChildren, asmParentQty, asmQtyLocked, op?.id]);
  // ★ 2026-10-10 ตรวจรอบ 3: เปิดหน้าค้างไว้ = ยังทำงานอยู่ → ต่ออายุ savedAt ทุก 60 วิ (เดิมงานยาว >6 ชม. รีโหลดแล้วถูกทิ้งเงียบ)
  useEffect(() => {
    const bump = (k) => { try { const raw = localStorage.getItem(k); if (!raw) return; const d = JSON.parse(raw); if (d && typeof d === "object") { d.savedAt = Date.now(); localStorage.setItem(k, JSON.stringify(d)); } } catch { /* ignore */ } };
    const id = setInterval(() => {
      if (dept === "machine") { if (draftLoadedRef.current && unitRef.current) bump(DKEY); }
      else if (asmWipLoadedRef.current) bump(asmWipKey);
    }, 60000);
    return () => clearInterval(id);
  }, [dept, DKEY, asmWipKey]);

  // แจ้งเตือน "ประกอบเสร็จ" เด้งกลางจอ → หายเองใน 2.6 วิ (หรือแตะ/กดตกลง)
  useEffect(() => {
    if (!asmDone) return;
    const id = setTimeout(() => setAsmDone(null), 2600);
    return () => clearTimeout(id);
  }, [asmDone]);

  function asmReset() { setAsmParent(null); setAsmParentQty(1); setAsmQtyLocked(false); setAsmChildren([]); setAsmPending(null); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false); setAsmUndo(null); }
  // ★ รอบ 12 (D): แตะชิปพลาด = เอาออกทันที → มีปุ่ม "↶ เอาคืน" 6 วิ (เดิมไม่มี undo ต้องสแกนใหม่)
  const [asmUndo, setAsmUndo] = useState(null);   // { child, idx }
  const asmUndoTimer = useRef(0);
  function asmRemoveChild(unitId) {
    setAsmChildren((prev) => {
      const idx = prev.findIndex((c) => c.unit_id === unitId);
      if (idx < 0) return prev;
      setAsmUndo({ child: prev[idx], idx });
      clearTimeout(asmUndoTimer.current);
      asmUndoTimer.current = setTimeout(() => setAsmUndo(null), 6000);
      return prev.filter((c) => c.unit_id !== unitId);
    });
  }
  function asmUndoRemove() {
    const u = asmUndo; if (!u) return;
    clearTimeout(asmUndoTimer.current); setAsmUndo(null);
    setAsmChildren((prev) => (prev.some((c) => c.unit_id === u.child.unit_id) ? prev
      : [...prev.slice(0, u.idx), u.child, ...prev.slice(u.idx)]));
  }
  useEffect(() => () => clearTimeout(asmUndoTimer.current), []);
  // ลบลูกที่ "บันทึกแล้ว" (installed) ออกจากเบอร์แม่ — ไว้แก้งานที่เสร็จ · ต้องออนไลน์ (ลบทันที ไม่เข้าคิว)
  async function asmRemoveInstalled(childUnitId, partNo) {
    if (!asmParent || !childUnitId) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      errorBeep(); flash(t("ลบชิ้นที่บันทึกแล้วต้องออนไลน์ก่อน", "removing a saved child needs to be online"), "warn"); return;
    }
    // ★ รอบ 12 (D): การ์ดยืนยันในแอป (window.confirm ถูกบล็อกบนจอ kiosk/PWA บางเครื่อง = กดแล้วเงียบ)
    if (!(await askConfirm({ message: t(`เอา ${partNo || "ลูกนี้"} ออกจากเบอร์แม่? (ลบชิ้นที่บันทึกไปแล้ว)`, `Remove ${partNo || "this child"} from the parent?`),
      tone: "danger", confirmText: t("เอาออก", "Remove"), cancelText: t("ยกเลิก", "Cancel") }))) return;
    setBusy(true);
    try {
      const res = await removeAssemblyChild(asmParent.unit.id, childUnitId);
      if (res && res.ok) {
        // ★ รอบ 24: จดลงประวัติรายรอบว่า "เอาออก" (หลังบ้านเห็นว่าสเตชันไหนเอาอะไรออก) · ไม่สำเร็จไม่เป็นไร
        if (asmParent.batchOk) {
          const remQty = (asmParent.installed || []).filter((x) => x.child_unit_id === childUnitId).reduce((s, x) => s + Math.max(1, Math.floor(Number(x.qty) || 1)), 0);
          logAssemblyRemoval({ parentUnitId: asmParent.unit.id, childUnitId, qty: remQty || 1, operationId: op?.id || null });
        }
        setAsmParent((p) => (p ? { ...p, installed: (p.installed || []).filter((x) => x.child_unit_id !== childUnitId) } : p));
        tickBeep(); flash(t("เอาลูกออกแล้ว", "child removed"), "ok");
      } else { errorBeep(); flash(asmReason(res?.reason) + (res?.reason ? ` [${res.reason}]` : ""), "warn"); }
    } catch (e) {
      errorBeep(); flash(t("ลบไม่สำเร็จ: ", "remove failed: ") + (e?.message || e?.details || String(e)), "warn");
    } finally { setBusy(false); }
  }
  // แผงยืนยันต่อชิ้น (โหมดประกอบ): กด "ใส่เข้าเบอร์แม่" → เข้ารายการรอปิดงาน · "ยกเลิก" → ทิ้งชิ้นที่เพิ่งสแกน
  async function asmAddPending(qty) {
    if (!asmPending) return;
    const q = Math.max(1, Math.floor(Number(qty) || 1));   // จำนวนที่กรอกในแผงยืนยัน (ค่าเริ่มต้น 1)
    // ★ รอบ 25: แพ็กใส่จำนวน — รวมแล้วเกินใบบั้ง = ถามก่อน (ใส่ต่อได้)
    if (asmPending.pack && asmPending.inBom && asmPending.bomQty != null) {
      const total = pmHave(asmPending.child_pm_id) + q;
      if (total > asmPending.bomQty) {
        const v = await askChoice({
          title: t("ตรวจก่อนใส่บั้ง", "Check before packing"), tone: "warn", cancelText: false,
          message: t(`${asmPending.part_no}: ในใบบั้งมี ${nc(asmPending.bomQty)} · ใส่รอบนี้แล้วรวมจะเป็น ${nc(total)} (เกิน ${nc(total - asmPending.bomQty)})\nใส่ต่อไหม?`,
                     `${asmPending.part_no}: the list has ${nc(asmPending.bomQty)} · this makes ${nc(total)} (${nc(total - asmPending.bomQty)} extra)\nAdd anyway?`),
          choices: [{ value: "add", label: t("ใส่ต่อ", "Add anyway"), tone: "warn" }, { value: "skip", label: t("แก้จำนวน", "Change qty"), primary: true }],
        });
        if (v !== "add") return;   // แผงกรอกจำนวนยังเปิดอยู่ — แก้แล้วกดใหม่
      }
    }
    setAsmChildren((prev) => {
      const i = prev.findIndex((c) => c.unit_id === asmPending.unit_id);
      if (i >= 0) {   // เบอร์เดิมที่สแกนซ้ำ → บวกจำนวนเพิ่มในแถวเดิม (นับจำนวนรวม)
        const next = prev.slice();
        next[i] = { ...next[i], qty: (Number(next[i].qty) || 0) + q };
        return next;
      }
      return [...prev, { ...asmPending, qty: q }];
    });
    setAsmPending(null);
  }
  function asmCancelPending() { setAsmPending(null); }
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
      // ★ รอบ 24 (record_assembly_batch)
      bad_child_kind: t("เบอร์ลูกชนิดนี้ใส่ในเบอร์แม่นี้ไม่ได้", "this child type can't go into this parent"),
      bad_parent_kind: t("เบอร์นี้ไม่ใช่ซับ/แผง — เปิดที่สเตชันนี้ไม่ได้", "not a subassembly/panel"),
      child_is_parent: t("สแกนเบอร์แม่เป็นลูกของตัวเองไม่ได้", "a parent can't be its own child"),
      machine_cannot: t("สถานีนี้ไม่ได้ตั้งให้ทำขั้นตอนนี้ — แจ้งออฟฟิศ", "this station isn't set up for this operation"),
      project_closed: t("โปรเจคนี้ปิดแล้ว — บันทึกเพิ่มไม่ได้", "project closed"),
      release_cancelled: t("Part นี้ถูกยกเลิกใน Modify — บันทึกไม่ได้", "part cancelled by a Modify"),
      nothing: t("ยังไม่มีอะไรให้บันทึก", "nothing to save"),
      too_many: t("สแกนลูกเกิน 500 รายการในรอบเดียว — แบ่งบันทึกเป็นหลายรอบ", "over 500 children in one save — split it"),
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
        errorBeep(); flash(t("โปรเจคนี้ปิดแล้ว — ประกอบเพิ่มไม่ได้", "project closed"), "warn"); return false;
      }
      // เบอร์แม่ต้องเป็นชนิดที่ "ตรงกับสเตชัน": แผง→panel · ซับ→subassembly · แพ็ก→package (แยกสเตชันชัดเจน)
      {
        const pk = u.part_master?.kind || "part";
        const wantKind = dept === "panel" ? "panel" : isPackingDept(dept) ? "package" : "subassembly";
        // ★ รอบ 22: ติดกระจก — เบอร์แม่เป็นได้ทั้ง ซับ (หน้าต่าง) และ แผง
        if (dept === "glazing" && pk !== "subassembly" && pk !== "panel") {
          errorBeep();
          flash(t(`สเตชันติดกระจกเปิดได้เฉพาะเบอร์ ซับ (หน้าต่าง) หรือ แผง — เบอร์นี้เป็น ${pk === "package" ? "แพ็ก" : "part ธรรมดา"}`,
                  `glazing opens subassembly (window) or panel parents only — this is ${pk}`), "warn");
          return false;
        }
        if (dept !== "glazing" && pk !== wantKind) {
          const wantName = wantKind === "panel" ? t("แผง", "panel") : wantKind === "package" ? t("แพ็ก", "package") : t("ซับ (subassembly)", "subassembly");
          const pkName = pk === "part" ? t("part ธรรมดา", "plain part") : pk === "panel" ? t("แผง", "panel") : pk === "package" ? t("แพ็ก", "package") : pk === "subassembly" ? t("ซับ", "subassembly") : pk;
          errorBeep();
          flash(t(`สเตชันนี้เปิดได้เฉพาะเบอร์ "${wantName}" — เบอร์นี้เป็น ${pkName} เปิดที่นี่ไม่ได้`, `this station only opens "${wantName}" — this is ${pkName}`), "warn");
          return false;
        }
        // แพ็กแผง / แพ็กไซต์ไอเทม: เปิดได้เฉพาะบั้งที่ "ติดป้ายชนิดตรงกัน" (pkg_meta.pack_type) — legacy packing เปิดได้ทุกบั้ง
        const wantPack = PACK_TYPE_OF[dept];
        if (wantPack) {
          const pt = u.part_master?.pkg_meta?.pack_type || null;
          if (pt !== wantPack) {
            const wName = wantPack === "panel" ? t("แผง", "panel") : t("ไซต์ไอเทม", "site item");
            const gotName = pt === "panel" ? t("แผง", "panel") : pt === "site" ? t("ไซต์ไอเทม", "site item") : t("ยังไม่ติดป้ายชนิด (office ตั้งก่อน)", "untagged");
            errorBeep();
            flash(t(`สเตชันนี้เปิดได้เฉพาะบั้ง "${wName}" — บั้งนี้เป็น ${gotName}`, `this station only opens "${wName}" bunks — this is ${gotName}`), "warn");
            return false;
          }
        }
      }
      setBusy(true);
      let st = null;
      try { st = await getAssemblyState(u.qr_code); } catch { st = null; }
      setBusy(false);
      if (!st) { errorBeep(); flash(t("โหลดสถานะไม่ได้ — เน็ตมีปัญหา ลองใหม่", "couldn't load state — network problem"), "warn"); return false; }
      if (!st.ok) {
        errorBeep();
        flash(st.reason === "no_bom"
          ? t("เบอร์นี้ยังไม่ได้กำหนด BOM — ตั้งที่หน้า Part Master ก่อน", "no BOM set — set it in Part Master")
          : st.reason === "offline_no_cache"
            ? t("เน็ตหลุด + เบอร์นี้ยังไม่เคยเปิดตอนออนไลน์ — ต่อเน็ตเปิด 1 ครั้งก่อน", "offline + never loaded online — connect once first")
            : asmReason(st.reason), "warn");
        return false;
      }
      if (st.offline) flash(t("โหมดออฟไลน์ — บันทึกเข้าคิว จะซิงค์เมื่อเน็ตกลับ", "offline — will queue & sync"), "info");
      // ★ รอบ 24: ประกอบเป็นรอบ — ยอดที่ทำไว้แล้ว (รวมทุกรอบ) + server รองรับ "ใส่จำนวนทุกรอบ / สแกนลูกเดิมซ้ำ" ไหม
      let bi = null;
      setBusy(true);
      try { bi = await getAssemblyBatches(u.qr_code); } catch { bi = null; }
      setBusy(false);
      // ★ รอบ 25: แพ็ก = ต้องเป็น server รุ่นที่รับ "บั้ง" (caps: package) · ไม่งั้นใช้แบบเดิม (เทียบใบบั้ง · ครบแล้วปิด)
      const batchOk = isPackingDept(dept)
        ? (bi ? !!(bi.ok && Array.isArray(bi.caps) && bi.caps.includes("package")) : assemblyPackSupported())
        : (bi ? !!bi.ok : assemblyBatchSupported());
      // แพ็กแผง = สแกนทีละแผ่น (1 QR = 1 ชิ้น) · แพ็กไซต์ไอเทม = ป้ายล็อต + ใส่จำนวน (/packing เดิม: ตามชนิดบั้ง)
      const packMode = dept === "packsite" || (dept === "packing" && u.part_master?.pkg_meta?.pack_type === "site") ? "qty" : "piece";
      const madeSum = bi && bi.ok ? Math.max(0, Math.floor(Number(bi.made_qty) || 0)) : null;
      const glazedSum = bi && bi.ok ? Math.max(0, Math.floor(Number(bi.glazed_qty) || 0)) : null;
      const reopen = st.parent?.status === "finished" || (st.installed || []).length > 0 || (madeSum || 0) > 0;
      // ★ รอบ 22: ติดกระจกหลังประกอบเสร็จเท่านั้น (เฟรมหน้าต่าง/แผงต้องบันทึกเสร็จที่สเตชันประกอบก่อน)
      if (dept === "glazing" && st.parent?.status !== "finished" && u.status !== "finished") {
        errorBeep();
        flash(t(`${u.part_master?.part_no || u.qr_code} ยังไม่มีบันทึกที่สเตชัน${(u.part_master?.kind === "panel") ? "แผง" : "ซับ"} — บันทึกที่นั่นก่อน แล้วค่อยติดกระจก`,
                `${u.part_master?.part_no || u.qr_code} isn't assembled yet — finish it at the ${u.part_master?.kind === "panel" ? "panel" : "sub-assembly"} station first`), "warn");
        return false;
      }
      if (dept === "glazing") {
        tickBeep(); flash(t(`ติดกระจก: ${u.part_master?.part_no || u.qr_code}`, `Glazing: ${u.part_master?.part_no || u.qr_code}`), "ok");
      } else if ((st.parent?.status === "finished" && !isPackingDept(dept)) || (isPackingDept(dept) && batchOk && (st.installed || []).length > 0)) {
        // ★ รอบ 23: ไม่บอกหน้างานว่า "เสร็จ/ไม่เสร็จ" — แค่บอกว่ามีของที่บันทึกไว้แล้วกี่รายการ ใส่เพิ่มได้ (รอบ 25: บั้งด้วย)
        const nm = (isPackingDept(dept) && u.part_master?.pkg_meta?.bunk_no) || u.part_master?.part_no || u.qr_code;
        tickBeep(); flash(t(`${nm} — บันทึกไว้แล้ว ${nc((st.installed || []).length)} รายการ · ใส่เพิ่มได้`, `${nm} — ${(st.installed || []).length} saved · add more`), "ok");
      } else if (isPackingDept(dept) && batchOk) {
        tickBeep(); flash(t(`บั้ง: ${u.part_master?.pkg_meta?.bunk_no || u.part_master?.part_no || u.qr_code}`, `Bunk: ${u.part_master?.pkg_meta?.bunk_no || u.part_master?.part_no || u.qr_code}`), "ok");
      } else if (st.parent?.status === "finished") {
        tickBeep(); flash(t("เบอร์นี้เสร็จแล้ว — เปิดโหมดแก้ไข (เพิ่ม/ลบลูกได้ ยอดผลิตไม่นับซ้ำ)", "already done — edit mode (add/remove children, no double count)"), "info");
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
      const madeQty = Math.max(1, madeSum != null && madeSum > 0 ? madeSum : Math.floor(Number(st.made_qty) || 1));
      setAsmParent({ unit: u, parentKind: u.part_master?.kind || null, bom, installed: st.installed || [], parentStatus: st.parent?.status || null,
        madeQty, madeSum, glazedSum, batchOk, reopen, packMode });
      // ติดกระจก: จำนวนเริ่มต้น = ที่ประกอบไว้ − ที่ติดกระจกไปแล้ว (รู้ยอด) / ที่ประกอบไว้ (ไม่รู้ยอด)
      setAsmParentQty(dept === "glazing"
        ? (glazedSum != null && madeQty - glazedSum > 0 ? madeQty - glazedSum : madeQty)
        : 1);
      // ★ รอบ 24: server รองรับรอบ → ถามจำนวนเบอร์แม่ "ทุกรอบ" (ทำเพิ่ม / ใส่ของเพิ่มในชิ้นเดิม)
      //   ยังไม่รัน SQL รอบ 24 → แบบรอบ 23: เบอร์ที่เคยบันทึกแล้วไม่ถามซ้ำ (ยอดผลิตนับครั้งแรกครั้งเดียว)
      setAsmQtyLocked((dept === "assembly" || dept === "panel") && !batchOk && st.parent?.status === "finished");
      setAsmChildren([]); asmClientRef.current = null; asmGlzClientRef.current = null;
      return true;
    }

    // เป็น "ลูก" (ที่จะติดตั้งรอบนี้)
    if (u.id === asmParent.unit.id) { flash(t("นี่คือเบอร์แม่เอง", "this is the parent"), "warn"); return false; }
    // ★ รอบ 25: แพ็กแบบใหม่ (server รองรับ) — ไม่เทียบใบบั้งที่หน้าจอ · ของไม่อยู่ในใบ/เกิน/ยังไม่ประกอบ/อยู่บั้งอื่น = เตือนแล้วใส่ต่อได้
    if (asmParent.parentKind === "package" && asmParent.batchOk) return packFreeScan(u);
    // แพ็ก (นับต่อดวง): ห้ามสแกนดวงเดิมซ้ำ · ประกอบ/ซับ (นับจำนวนรวม): สแกนเบอร์เดิมซ้ำได้ → บวกจำนวนเพิ่มในแถวเดิม (asmAddPending รวมยอดให้)
    if (asmParent.parentKind === "package" && asmChildren.some((c) => c.unit_id === u.id)) { flash(t("สแกนชิ้นนี้ไปแล้วรอบนี้", "already scanned this round"), "warn"); return false; }
    // ★ รอบ 24: server รองรับรอบ → QR ลูกเดิมใส่เบอร์แม่เดิมซ้ำได้ (บวกจำนวน · ป้ายล็อต 1 ใบ = หลายชิ้น) · แพ็กยังห้ามซ้ำ
    const prevQty = (asmParent.installed || []).filter((x) => x.child_unit_id === u.id).reduce((s, x) => s + Math.max(1, Math.floor(Number(x.qty) || 1)), 0);
    if (prevQty > 0 && !(asmParent.batchOk && asmParent.parentKind !== "package")) {
      flash(t("ชิ้นนี้ติดตั้งไปแล้ว (สเตชันก่อนหน้า)", "already installed (earlier station)"), "warn"); return false;
    }
    // ── กฎ "ชนิดลูก" ตามชนิดเบอร์แม่ (อัตโนมัติ) — sub → รับ part/ซับตัวอื่น (ไม่รับแผง) · แผง → รับ sub/part (กันสแกนผิดชั้น) ──
    //   แพ็ก(package): ไม่คุมด้วยกฎนี้ — ใช้ manifest/บั้ง (โหมดเข้ม) คุมเอง รับได้ทั้ง part/sub/แผงตามบั้ง · เบอร์แม่ชนิดอื่นไม่จำกัด
    {
      const allowByParent = { subassembly: ["part", "subassembly"], panel: ["subassembly", "part"] };
      const allowed = allowByParent[asmParent.parentKind];
      const cKind = u.part_master?.kind || "part";
      if (allowed && !allowed.includes(cKind)) {
        const kName = (k) => k === "subassembly" ? "sub" : k === "panel" ? t("แผง", "panel") : k === "package" ? t("แพ็ก", "package") : t("part (ชิ้นเครื่อง)", "part");
        errorBeep();
        flash(t(`เบอร์แม่นี้ต้องใส่ ${allowed.map(kName).join(" หรือ ")} — เบอร์นี้เป็น ${kName(cKind)} ใส่ไม่ได้`,
                `this parent takes ${allowed.map(kName).join(" / ")} — this is ${kName(cKind)}`), "warn");
        return false;
      }
    }
    // ลูกที่ "เป็นของประกอบเอง" (ไม่ใช่ part) ต้องประกอบเสร็จ (finished) ก่อนถึงใส่ได้ (ทั้ง 2 โหมด)
    // ★ รอบ 23: ประกอบ/แผง/ติดกระจก ไม่บังคับแล้ว (หน้างานทำตามแบบกระดาษ · หลังบ้านตรวจเอง) · แพ็กยังบังคับเหมือนเดิม
    if (asmParent.parentKind === "package" && u.part_master?.kind && u.part_master.kind !== "part" && u.status !== "finished") {
      errorBeep(); flash(t(`${u.part_master?.part_no || u.qr_code} ยังประกอบไม่เสร็จ — ใส่ไม่ได้`, `${u.part_master?.part_no || u.qr_code} isn't finished yet`), "warn"); return false;
    }
    const strict = asmParent.parentKind === "package";   // แพ็ก = เข้ม BOM/manifest · ประกอบ = อิสระ
    if (strict) {
      const inBom = asmParent.bom.find((b) => b.child_pm_id === u.part_master_id);
      if (!inBom) { errorBeep(); flash(t("ชิ้นนี้ไม่อยู่ในรายการบั้ง", "not in this bunk list"), "warn"); return false; }
      const have = asmHave(u.part_master_id);
      if (have >= inBom.qty) { flash(t(`${inBom.part_no} ครบแล้ว`, `${inBom.part_no} already complete`), "warn"); return false; }
      tickBeep(); flash(`+ ${inBom.part_no} (${nc(have + 1)}/${nc(inBom.qty)})`, "ok");
      // ★ รอบ 11 (A2): เช็กซ้ำใน updater ด้วย (สถานะล่าสุดจริง) — ป้ายเดียวกันเข้ารายการได้ครั้งเดียว
      setAsmChildren((prev) => (prev.some((c) => c.unit_id === u.id) ? prev : [...prev, { unit_id: u.id, qr: u.qr_code, child_pm_id: u.part_master_id, part_no: inBom.part_no }]));
      return true;
    }
    // ── ประกอบอิสระ: สแกนลูกเบอร์ไหนก็ได้เข้าไป (ไม่เช็ก BOM) · เช็กลิสต์อยู่หลังบ้าน ──
    const cno = u.part_master?.part_no || u.qr_code;
    const clen = u.length_mm ?? u.part_master?.default_length_mm ?? null;   // ความยาว: ของยูนิต → ถ้าไม่มีใช้ค่าเริ่มต้นของ Part
    const cwt = u.weight ?? u.part_master?.unit_weight ?? null;             // น้ำหนัก: ของยูนิต → ถ้าไม่มีใช้ค่าเริ่มต้นของ Part
    tickBeep();
    // เด้งแผงยืนยันต่อชิ้น (เหมือนหน้าเครื่อง) — ยังไม่เข้ารายการจนกว่าจะกด "ใส่เข้าเบอร์แม่"
    //   สแกนเบอร์เดิมซ้ำ → ส่ง existingQty ให้แผงยืนยันโชว์ "มีอยู่แล้ว N" (asmAddPending จะบวกจำนวนเพิ่มให้)
    const existing = asmChildren.find((c) => c.unit_id === u.id);
    // จำนวนเริ่มต้น = จำนวนเบอร์แม่ที่ทำรอบนี้ (ทำ 10 ชุด → ลูกเริ่มที่ 10 · แก้ได้) · ไม่ได้ทำเพิ่ม (0) = 1
    const defQty = Math.max(1, Math.floor(Number(asmParentQty) || 0) || 1);
    setAsmPending({ unit_id: u.id, qr: u.qr_code, child_pm_id: u.part_master_id, part_no: cno, part_name: u.part_master?.part_name || "", len: clen, wt: cwt, qty: 1,
      existingQty: existing ? (Number(existing.qty) || 0) : 0, prevQty, defQty });
    return true;
  }
  // ยอดของเบอร์นี้ในบั้ง/เบอร์แม่: ที่บันทึกแล้ว + ที่สแกนรอบนี้ (รวมจำนวน)
  const pmHave = (pmId) => {
    let n = 0;
    (asmParent?.installed || []).forEach((x) => { if (x.child_pm_id === pmId) n += Math.max(1, Math.floor(Number(x.qty) || 1)); });
    asmChildren.forEach((c) => { if (c.child_pm_id === pmId) n += Math.max(1, Math.floor(Number(c.qty) || 1)); });
    return n;
  };
  // ถามก่อนใส่ (ของไม่อยู่ในใบ / เกิน / ยังไม่ประกอบ / อยู่บั้งอื่น) · Enter / แตะนอกกรอบ = "ไม่ใส่" (กันสแกนเนอร์ยิง Enter แล้วใส่เอง)
  async function packWarnAsk(lines) {
    closeScan();   // ปิดกล้องก่อนถาม (กันสแกนซ้ำระหว่างรอตอบ)
    errorBeep();
    const v = await askChoice({
      title: t("ตรวจก่อนใส่บั้ง", "Check before packing"), tone: "warn", list: lines, cancelText: false,
      message: t("ชิ้นนี้ไม่ตรงกับใบบั้ง — ใส่ต่อไหม? (หลังบ้านจะเห็นเป็นรายการที่ต้องตรวจ)", "This doesn't match the bunk list — add it anyway? (the office will see it flagged)"),
      choices: [{ value: "add", label: t("ใส่ต่อ", "Add anyway"), tone: "warn" }, { value: "skip", label: t("ไม่ใส่", "Don't add"), primary: true }],
    });
    if (v !== "add") { flash(t("ไม่ได้ใส่", "not added"), "info"); return false; }
    return true;
  }
  // ★ รอบ 25: สแกนของเข้าบั้ง (แพ็กแบบใหม่ · ไม่ปิดบั้ง)
  //   ทีละแผ่น (แพ็กแผง): 1 QR = 1 ชิ้น · ซ้ำในบั้งเดียวกันไม่ได้ · ใส่เลยไม่ต้องกรอกจำนวน · กล้องเปิดค้าง
  //   ใส่จำนวน (แพ็กไซต์ไอเทม): ป้ายล็อต → แผงกรอกจำนวน · สแกนซ้ำ = บวกเพิ่ม · เกินใบ = ถามตอนกดใส่
  async function packFreeScan(u) {
    const qtyMode = asmParent.packMode === "qty";
    const cno = u.part_master?.part_no || u.qr_code;
    const cKind = u.part_master?.kind || "part";
    if (cKind === "package") { errorBeep(); flash(t("ใส่บั้งในบั้งไม่ได้", "a bunk can't go inside a bunk"), "warn"); return false; }
    const prevQty = (asmParent.installed || []).filter((x) => x.child_unit_id === u.id).reduce((s, x) => s + Math.max(1, Math.floor(Number(x.qty) || 1)), 0);
    const sess = asmChildren.find((c) => c.unit_id === u.id);
    if (!qtyMode && sess) { flash(t("สแกนชิ้นนี้ไปแล้วรอบนี้", "already scanned this round"), "warn"); return false; }
    if (!qtyMode && prevQty > 0) { flash(t(`${cno} อยู่ในบั้งนี้แล้ว (บันทึกไว้ก่อนหน้า)`, `${cno} is already in this bunk`), "warn"); return false; }
    const inBom = (asmParent.bom || []).find((b) => b.child_pm_id === u.part_master_id);
    const warns = [];
    if (!inBom) warns.push(t(`${cno} ไม่อยู่ในใบบั้งนี้`, `${cno} is not on this bunk's list`));
    else if (!qtyMode && pmHave(u.part_master_id) + 1 > Math.max(0, Number(inBom.qty) || 0)) {
      warns.push(t(`${cno} ใส่ครบตามใบแล้ว (${nc(inBom.qty)} ชิ้น) — ชิ้นนี้จะเกิน`, `${cno} already has the listed ${nc(inBom.qty)} — this one is extra`));
    }
    if (cKind !== "part" && u.status !== "finished") {
      warns.push(t(`${cno} ยังไม่มีบันทึกที่สเตชัน${cKind === "panel" ? "แผง" : "ซับ"}`, `${cno} has nothing recorded at the ${cKind === "panel" ? "panel" : "sub-assembly"} station yet`));
    }
    if (!qtyMode) {
      setBusy(true);
      let others = null;
      try { others = await assemblyChildParents(u.qr_code); } catch { others = null; }
      setBusy(false);
      const oth = (others || []).filter((p) => p.qr !== asmParent.unit.qr_code);
      if (oth.length) warns.push(t(`${cno} อยู่ในบั้ง ${oth.map((p) => p.bunk_no || p.part_no).join(", ")} แล้ว`, `${cno} is already in bunk ${oth.map((p) => p.bunk_no || p.part_no).join(", ")}`));
    }
    if (warns.length && !(await packWarnAsk(warns))) return false;
    const clen = u.length_mm ?? u.part_master?.default_length_mm ?? null;
    const cwt = u.weight ?? u.part_master?.unit_weight ?? null;
    if (qtyMode) {
      tickBeep();
      setAsmPending({ unit_id: u.id, qr: u.qr_code, child_pm_id: u.part_master_id, part_no: cno, part_name: u.part_master?.part_name || "", len: clen, wt: cwt, qty: 1,
        existingQty: sess ? (Number(sess.qty) || 0) : 0, prevQty, defQty: 1, pack: true, inBom: !!inBom, bomQty: inBom ? Number(inBom.qty) || 0 : null });
      return true;
    }
    tickBeep(); flash(`+ ${cno}`, "ok");
    setAsmChildren((prev) => (prev.some((c) => c.unit_id === u.id) ? prev
      : [...prev, { unit_id: u.id, qr: u.qr_code, child_pm_id: u.part_master_id, part_no: cno, qty: 1, len: clen, wt: cwt }]));
    return true;
  }
  const asmDecoded = async (qr) => {
    const hadParent = !!asmParent;
    // แพ็กทีละแผ่น (ทั้งแบบเดิมและแบบใหม่) = กล้องเปิดค้าง สแกนรัว · ประกอบ / แพ็กใส่จำนวน = ปิดกล้อง เด้งแผงกรอกจำนวน
    const keepOpen = !!asmParent && asmParent.parentKind === "package" && !(asmParent.batchOk && asmParent.packMode === "qty");
    const ok = await asmScan(qr);
    // เบอร์แม่ (ยังไม่มี parent) → ปิดกล้อง เด้งเข้าหน้าเบอร์นั้น · ลูกโหมดประกอบ → ปิดกล้อง เด้งแผงยืนยันต่อชิ้น
    if (ok && (!hadParent || !keepOpen)) closeScan();
    return false;
  };
  const asmManual  = async (text) => { await asmScan(text); return { ok: false }; };

  // ★ รอบ 22: ติดกระจก — (1) ผูกกระจก/ชิ้นที่สแกนเข้าเบอร์แม่ (ถ้ามี · เบอร์แม่เสร็จแล้ว = ไม่นับยอดประกอบซ้ำ)
  //   (2) บันทึก "ยอดติดกระจก" เป็นงานของสเตชันนี้ (ขั้นตอน Glazing · จำนวน = ชิ้นที่ติดกระจกรอบนี้) → ขึ้นรายงาน/TV/รายงานประจำวัน
  //   ทั้งสองส่วนเข้าคิวออฟไลน์ได้ · ส่วน (2) ใช้ client_id คงที่ → กดซ้ำ/ซิงค์ซ้ำไม่นับเบิ้ล
  async function glazeConfirm() {
    if (!asmParent || savingRef.current) return;
    const pq = Math.max(1, Math.floor(Number(asmParentQty) || 1));
    const pno = asmParent.unit.part_master?.part_no || asmParent.unit.qr_code;
    savingRef.current = true; setBusy(true);
    if (!asmClientRef.current) asmClientRef.current = newClientId();
    if (!asmGlzClientRef.current) asmGlzClientRef.current = newClientId();
    let queued = false;
    try {
      // ★ รอบ 24: server รองรับรอบ → ครั้งเดียวจบ (ยอดติดกระจก + กระจกที่สแกน + สเตชัน/เวลา) ใน transaction เดียว
      let viaBatch = false;
      if (asmParent.batchOk) {
        const rb = await recordAssemblyBatch({
          parentQr: asmParent.unit.qr_code,
          children: asmChildren.map((c) => ({ qr: c.qr, qty: Math.max(1, Math.floor(Number(c.qty) || 1)) })),
          parentQty: pq, operationId: op?.id || null, clientId: asmClientRef.current,
        });
        if (rb && !rb.legacy) {
          if (rb.ok || rb.queued) {
            tickBeep();
            flash(rb.queued ? t(`✓ ติดกระจก ${nc(pq)} ชิ้น — เก็บเข้าคิว รอซิงค์`, `✓ Glazed ${pq} — queued for sync`)
                            : t(`✓ ติดกระจกแล้ว ${nc(pq)} ชิ้น`, `✓ Glazed ${pq}`), "ok");
            setAsmDone({ partNo: pno, count: pq, isPack: false, isSub: false, isGlz: true, queued: !!rb.queued });
            setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; asmGlzClientRef.current = null;
            reload();
          } else if (rb.reason === "storage_full") {
            errorBeep(); flash(t("ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ (เคลียร์คิวเก่าก่อน)", "storage full — clear the queue first"), "warn");
          } else {
            errorBeep(); flash(asmReason(rb?.reason) + (rb?.reason ? ` [${rb.reason}]` : ""), "warn");
          }
          return;
        }
        // server ไม่มีฟังก์ชันรอบ 24 (ถูกย้อนกลับ) → ลูกผูกผ่าน record_assembly แล้ว · นับยอดติดกระจกแบบเดิมต่อด้านล่าง
        viaBatch = true;
        if (rb && rb.queued) queued = true;
        else if (!(rb && rb.ok) && asmChildren.length > 0) {
          errorBeep(); flash(asmReason(rb?.reason) + (rb?.reason ? ` [${rb.reason}]` : ""), "warn");
          return;
        }
        if (asmChildren.length > 0) {
          const addNow = asmChildren.map((c) => ({ child_pm_id: c.child_pm_id, child_unit_id: c.unit_id, qty: c.qty ?? 1, part_no: c.part_no, qr: c.qr }));
          setAsmParent((p) => (p ? { ...p, installed: [...(p.installed || []), ...addNow] } : p));
          setAsmChildren([]); asmClientRef.current = null;
        }
      }
      if (!viaBatch && asmChildren.length > 0) {
        const res = await recordAssembly({
          parentQr: asmParent.unit.qr_code,
          childQrs: asmChildren.map((c) => ({ qr: c.qr, qty: Math.max(1, Math.floor(Number(c.qty) || 1)) })),
          parentQty: pq, operationId: op?.id || null, clientId: asmClientRef.current,
        });
        if (res && res.queued) queued = true;
        else if (!(res && res.ok)) {
          errorBeep(); flash(asmReason(res?.reason) + (res?.reason ? ` [${res.reason}]` : ""), "warn");
          return;
        }
        // ชิ้นที่สแกนรอบนี้บันทึกแล้ว → ย้ายไป "ติดแล้ว" (ถ้าขั้นต่อไปพลาด กดยืนยันซ้ำจะไม่ส่งลูกซ้ำ)
        const addNow = asmChildren.map((c) => ({ child_pm_id: c.child_pm_id, child_unit_id: c.unit_id, qty: c.qty ?? 1, part_no: c.part_no, qr: c.qr }));
        setAsmParent((p) => (p ? { ...p, installed: [...(p.installed || []), ...addNow] } : p));
        setAsmChildren([]); asmClientRef.current = null;
      }
      const mw = await recordMachineWork({
        qr: asmParent.unit.qr_code, quantity: pq, materialLengthMm: null, processSeconds: 0, status: "finished",
        releaseId: asmParent.unit.release_id || null, clientId: asmGlzClientRef.current, operationId: op?.id || null, weight: 0,
      });
      if (mw && (mw.ok || mw.queued)) {
        if (mw.queued) queued = true;
        tickBeep();
        flash(queued ? t(`✓ ติดกระจก ${nc(pq)} ชิ้น — เก็บเข้าคิว รอซิงค์`, `✓ Glazed ${pq} — queued for sync`)
                     : t(`✓ ติดกระจกแล้ว ${nc(pq)} ชิ้น`, `✓ Glazed ${pq}`), "ok");
        setAsmDone({ partNo: pno, count: pq, isPack: false, isSub: false, isGlz: true, queued });
        setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; asmGlzClientRef.current = null;
        reload();
      } else {
        errorBeep();
        flash(t("บันทึกยอดติดกระจกไม่สำเร็จ — กดบันทึกอีกครั้ง", "couldn't save the glazing count — press save again") + (mw?.reason ? ` [${mw.reason}]` : ""), "warn");
      }
    } catch (e) {
      errorBeep();
      flash(t("บันทึกไม่สำเร็จ: ", "save failed: ") + (e?.message || e?.details || e?.code || String(e)), "warn");
    } finally { setBusy(false); savingRef.current = false; }
  }

  // บันทึก "รอบนี้" (สะสมได้ — ไม่ต้องครบก็เซฟ) · ครบ BOM สะสม → ปิดงานอัตโนมัติ · ไม่ครบ → รีเฟรชยอด แล้วสแกนต่อ/ส่งสเตชันถัดไป
  // ★ รอบ 24: บันทึก 1 รอบ (ซับ/แผง) — จำนวนเบอร์แม่รอบนี้ (0 = ใส่ของเพิ่มในชิ้นเดิม) + ลูกพร้อมจำนวน + สเตชัน/เวลา
  //   กลับหน้ารายการเบอร์แม่ทุกครั้ง (ไม่บอกครบ/ไม่ครบ) · เข้าคิวออฟไลน์ได้ (client_id คงที่ = ส่งซ้ำไม่นับเบิ้ล)
  async function asmBatchConfirm() {
    if (!asmParent || asmChildren.length === 0 || savingRef.current) return;
    const isPackP = asmParent.parentKind === "package";   // ★ รอบ 25: บั้ง — ไม่มีจำนวนที่ทำ · รูปแพ็กอัปหลังบันทึก
    const pq = isPackP ? 0 : Math.max(0, Math.floor(Number(asmParentQty) || 0));
    const pno = (isPackP && asmParent.unit.part_master?.pkg_meta?.bunk_no) || asmParent.unit.part_master?.part_no || asmParent.unit.qr_code;
    const n = asmChildren.length;
    savingRef.current = true; setBusy(true);
    if (!asmClientRef.current) asmClientRef.current = newClientId();
    try {
      const res = await recordAssemblyBatch({
        parentQr: asmParent.unit.qr_code,
        children: asmChildren.map((c) => ({ qr: c.qr, qty: Math.max(1, Math.floor(Number(c.qty) || 1)) })),
        parentQty: pq, operationId: op?.id || null, clientId: asmClientRef.current,
      });
      if (res && (res.ok || res.queued)) {
        tickBeep();
        if (res.queued) {
          // แคชสถานะใหม่ไว้ (เปิดเบอร์นี้ซ้ำตอนออฟไลน์ เห็นของที่ใส่ไปแล้ว)
          try {
            const inst = (asmParent.installed || []).map((x) => ({ ...x }));
            asmChildren.forEach((c) => {
              const i = inst.findIndex((x) => x.child_unit_id === c.unit_id);
              const q = Math.max(1, Math.floor(Number(c.qty) || 1));
              if (i >= 0) inst[i].qty = Math.max(1, Math.floor(Number(inst[i].qty) || 1)) + q;
              else inst.push({ child_pm_id: c.child_pm_id, child_unit_id: c.unit_id, qty: q, part_no: c.part_no, qr: c.qr });
            });
            setCachedAsmState(asmParent.unit.qr_code, {
              ok: true, bom: asmParent.bom || [], installed: inst,
              parent: { part_no: pno, status: (pq > 0 || asmParent.parentStatus === "finished") ? "finished" : (asmParent.parentStatus || "released") },
              made_qty: asmParent.madeQty,
            });
          } catch { /* ignore */ }
        }
        // แพ็ก: อัปรูปหลังบันทึกสำเร็จ (ออนไลน์) · อัปไม่ได้ไม่ล้มงาน (รูปไม่บังคับ)
        let photoNote = "";
        if (isPackP && packPhotos.length > 0) {
          if (res.queued) photoNote = t(" · รูปยังไม่อัป (ออนไลน์แล้วถ่ายซ้ำ)", " · photos not saved offline");
          else {
            try {
              const photoPaths = [];
              for (const ph of packPhotos) photoPaths.push(await uploadPackingPhoto(ph.blob, asmParent.unit.qr_code));
              if (photoPaths.length) await recordPackingPhotos(asmParent.unit.qr_code, photoPaths);
            } catch { photoNote = t(" · แนบรูปไม่สำเร็จ (รูปไม่บังคับ)", " · photo attach failed (optional)"); }
          }
        }
        const what = isPackP ? t(`ใส่ ${nc(n)} รายการ`, `${n} item(s)`)
          : pq > 0 ? t(`ทำ ${nc(pq)} ชิ้น · ใส่ ${nc(n)} รายการ`, `made ${pq} · ${n} item(s)`) : t(`ใส่เพิ่ม ${nc(n)} รายการ`, `added ${n} item(s)`);
        flash((res.queued ? t(`✓ บันทึกแล้ว ${pno} — ${what} · เก็บเข้าคิว รอซิงค์`, `✓ Saved ${pno} — ${what} · queued`)
                          : t(`✓ บันทึกแล้ว ${pno} — ${what}`, `✓ Saved ${pno} — ${what}`)) + photoNote, "ok");
        setAsmDone({ partNo: pno, count: pq > 0 ? pq : n, isPack: isPackP, isSub: dept === "assembly" && pq > 0, queued: !!res.queued });
        setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; setAsmParentQty(1); setAsmQtyLocked(false);
        setPackPhotos([]); setPhotoOpen(false);
        reload();
      } else if (res && res.reason === "storage_full") {
        errorBeep(); flash(t("ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ (เคลียร์คิวเก่าก่อน)", "storage full — clear the queue first"), "warn");
      } else {
        errorBeep(); flash(asmReason(res?.reason) + (res?.reason ? ` [${res.reason}]` : "") + (res?.qr ? ` · ${res.qr}` : ""), "warn");
      }
    } catch (e) {
      errorBeep();
      flash(t("บันทึกไม่สำเร็จ: ", "save failed: ") + (e?.message || e?.details || e?.hint || e?.code || String(e)), "warn");
    } finally { setBusy(false); savingRef.current = false; }
  }
  async function asmConfirm() {
    if (dept === "glazing") return glazeConfirm();
    if (!asmParent || asmChildren.length === 0 || savingRef.current) return;
    if (asmParent.batchOk) return asmBatchConfirm();   // ★ รอบ 24–25: ซับ/แผง/บั้ง = บันทึกเป็นรอบ
    const isPack = isPackingDept(dept);
    const free = asmParent.parentKind !== "package";   // ประกอบอิสระ = ปิดเมื่อกดยืนยัน (แพ็ก = ครบตาม BOM)
    // ซับ: แจ้ง "เสร็จ" เป็น "จำนวนที่จะทำ" (นับหลายชิ้น) · อื่น ๆ = จำนวนลูกที่สแกนรอบนี้
    const doneCount = dept === "assembly" ? Math.max(1, Math.floor(Number(asmParentQty) || 1)) : asmChildren.length;
    savingRef.current = true; setBusy(true);
    if (!asmClientRef.current) asmClientRef.current = newClientId();
    try {
      // แพ็ก: อัปรูปทำ "หลัง" บันทึกสำเร็จ (ในสาขา res.ok) — เดิมอัปก่อน record ถ้า record ตกไปเข้าคิว (network-err) รูปจะค้าง Storage ไม่ถูกผูก
      const res = await recordAssembly({
        parentQr: asmParent.unit.qr_code,
        // ส่งลูกพร้อม "จำนวน" (นับจำนวนรวม — สแกน 1 ที + จำนวน) · เบอร์แม่ส่ง "จำนวนที่จะทำ" → เข้ายอดผลิต
        childQrs: asmChildren.map((c) => ({ qr: c.qr, qty: Math.max(1, Math.floor(Number(c.qty) || 1)) })),
        parentQty: Math.max(1, Math.floor(Number(asmParentQty) || 1)),
        operationId: op?.id || null,
        clientId: asmClientRef.current,
      });
      if (res && res.queued) {
        // ── offline: เก็บเข้าคิว → อัปเดต "ที่ติดแล้ว" ในเครื่อง (กันสแกนซ้ำ/นับต่อ) + แคชสถานะใหม่ → ซิงค์เองเมื่อเน็ตกลับ ──
        tickBeep();
        const addNow = asmChildren.map((c) => ({ child_pm_id: c.child_pm_id, child_unit_id: c.unit_id, qty: c.qty ?? 1 }));
        const newInstalled = [...(asmParent.installed || []), ...addNow];
        const bom = asmParent.bom || [];
        // ประกอบอิสระ (ไม่ใช่แพ็ก): กดยืนยัน = ปิดงานเลย · แพ็ก: ครบตาม BOM เป๊ะ
        const complete = free ? true : (bom.length > 0 && bom.every((b) => newInstalled.filter((x) => x.child_pm_id === b.child_pm_id).length >= b.qty));
        try {
          setCachedAsmState(asmParent.unit.qr_code, {
            ok: true, bom, installed: newInstalled,
            parent: { part_no: asmParent.unit.part_master?.part_no, status: complete ? "finished" : "in_progress" },
          });
        } catch { /* ignore */ }
        const photoNote = (isPack && packPhotos.length > 0) ? t(" · รูปยังไม่อัป (ออนไลน์แล้วถ่ายซ้ำ)", " · photos not saved offline") : "";
        if (complete) {
          flash((isPack ? t("✓ แพ็กครบ — เก็บเข้าคิว รอซิงค์", "✓ Packed — queued for sync") : t(`✓ บันทึกแล้ว ${nc(asmChildren.length)} รายการ — เก็บเข้าคิว รอซิงค์`, `✓ Saved ${asmChildren.length} — queued for sync`)) + photoNote, "ok");
          setAsmDone({ partNo: asmParent.unit.part_master?.part_no || asmParent.unit.qr_code, count: doneCount, isPack, isSub: dept === "assembly", queued: true });
          setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false);
        } else {
          flash(t(`✓ เก็บเข้าคิว ${nc(asmChildren.length)} ชิ้น (เน็ตหลุด) — จะซิงค์ให้อัตโนมัติ`, `✓ Queued ${asmChildren.length} — will sync`) + photoNote, "ok");
          setAsmParent((p) => (p ? { ...p, installed: newInstalled } : p));
          setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false);
        }
        reload();
      } else if (res && res.ok) {
        // อัปรูปแพ็กหลังบันทึกสำเร็จ (ออนไลน์แน่แล้ว) · อัป/ผูกไม่สำเร็จ = ไม่ล้มงาน (รูปไม่บังคับ · record บันทึกไปแล้ว)
        if (isPack && packPhotos.length > 0) {
          try {
            const photoPaths = [];
            for (const p of packPhotos) photoPaths.push(await uploadPackingPhoto(p.blob, asmParent.unit.qr_code));
            if (photoPaths.length) await recordPackingPhotos(asmParent.unit.qr_code, photoPaths);
          } catch { flash(t("บันทึกแพ็กแล้ว แต่แนบรูปไม่สำเร็จ (รูปไม่บังคับ)", "packed OK · photo attach failed (optional)"), "warn"); }
        }
        tickBeep();
        if (res.complete) {
          flash(isPack ? t("✓ แพ็กครบแล้ว — ปิดงาน", "✓ Packed & complete") : t(`✓ บันทึกแล้ว ${nc(res.added ?? asmChildren.length)} รายการ`, `✓ Saved ${res.added ?? asmChildren.length}`), "ok");
          setAsmDone({ partNo: asmParent.unit.part_master?.part_no || asmParent.unit.qr_code, count: doneCount, isPack, isSub: dept === "assembly", queued: false });
          setAsmParent(null); setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false);
        } else {
          const added = res.added ?? asmChildren.length;
          flash((isPack ? t(`✓ บันทึกแล้ว ${nc(added)} ชิ้น — ยังไม่ครบ BOM (ส่งต่อสเตชันถัดไปได้)`, `✓ Saved ${added} — not complete yet`) : t(`✓ บันทึกแล้ว ${nc(added)} รายการ`, `✓ Saved ${added}`)), "ok");
          // อัปเดต "ที่ติดแล้ว" แบบ optimistic ก่อน แล้ว reconcile กับเซิร์ฟเวอร์ · เก็บ length_mm/kind ที่เติมตอนสแกนไว้ (get_assembly_state ไม่คืนมา → กันคอลัมน์ขนาด/ยาวหาย)
          const addNow = asmChildren.map((c) => ({ child_pm_id: c.child_pm_id, child_unit_id: c.unit_id, qty: c.qty ?? 1 }));
          let st = null;
          try { st = await getAssemblyState(asmParent.unit.qr_code); } catch { st = null; }
          setAsmParent((p) => {
            if (!p) return p;
            if (st && st.ok) {
              const meta = {};
              (p.bom || []).forEach((b) => { if (b.child_pm_id != null) meta[b.child_pm_id] = { length_mm: b.length_mm, kind: b.kind }; });
              const bom = (st.bom || p.bom).map((b) => ({
                ...b,
                length_mm: b.length_mm ?? meta[b.child_pm_id]?.length_mm ?? null,
                kind: b.kind || meta[b.child_pm_id]?.kind || "part",
              }));
              return { ...p, bom, installed: st.installed || [] };
            }
            // รีเฟรชพลาด → ใช้ยอด optimistic (ชิ้นที่เพิ่งเซฟไม่หายจากจอ · เซิร์ฟเวอร์ยังเป็นตัวจริงตอน reload/สแกนรอบหน้า)
            return { ...p, installed: [...(p.installed || []), ...addNow] };
          });
          setAsmChildren([]); asmClientRef.current = null; setPackPhotos([]); setPhotoOpen(false);
        }
        reload();
      } else if (res && res.reason === "storage_full") {
        errorBeep(); flash(t("ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ (เคลียร์คิวเก่าก่อน)", "storage full — clear the queue first"), "warn");
      } else {
        errorBeep(); flash(asmReason(res?.reason) + (res?.reason ? ` [${res.reason}]` : ""), "warn");
      }
    } catch (e) {
      errorBeep();
      // โชว์ error จริงจาก server (ไว้ไล่ปัญหา) — message/details/hint/code
      const emsg = e?.message || e?.details || e?.hint || e?.code || String(e);
      flash(t("บันทึกไม่สำเร็จ: ", "save failed: ") + emsg, "warn");
    } finally { setBusy(false); savingRef.current = false; }
  }

  // ── auto-complete (เฉพาะสเตชัน "ซับ"): เทียบ BOM×"จำนวนที่จะทำ" หลังบ้าน — ไม่โชว์รายการ BOM ให้คนงาน ──
  //    สแกนลูกครบตาม BOM (× จำนวนที่จะทำ) → นับถอยหลัง 3 วิ แล้วปิดงานเอง · แก้/ลบชิ้นระหว่างนับ = เริ่มนับใหม่/ยกเลิก
  const asmConfirmRef = useRef(asmConfirm);
  asmConfirmRef.current = asmConfirm;   // ให้ตัวจับเวลาเรียก asmConfirm เวอร์ชันล่าสุดเสมอ (กัน closure ค้าง)
  // ยอดลูกที่ได้ต่อ part (นับจำนวนรวม): ที่ติดไปแล้ว (installed) + ที่สแกนรอบนี้ (× จำนวนที่กรอก)
  const asmGotByPm = useMemo(() => {
    const m = {};
    (asmParent?.installed || []).forEach((x) => { if (x.child_pm_id != null) m[x.child_pm_id] = (m[x.child_pm_id] || 0) + Math.max(1, Math.floor(Number(x.qty) || 1)); });
    (asmChildren || []).forEach((c) => { if (c.child_pm_id != null) m[c.child_pm_id] = (m[c.child_pm_id] || 0) + Math.max(1, Math.floor(Number(c.qty) || 1)); });
    return m;
  }, [asmParent, asmChildren]);
  // ครบ BOM×จำนวนหรือยัง — เฉพาะซับ + ต้องมี BOM + ครบทุกพาร์ท (ไม่มี BOM = ปิดเองไม่ได้ → กดยืนยันเอง)
  const asmBomMet = useMemo(() => {
    if (dept !== "assembly") return false;
    // ★ รอบ 22: กระจกไม่บังคับที่สเตชันซับ (ไปติดที่สเตชัน Glazing ทีหลัง) · ถ้า BOM มีแต่กระจก = ใช้ BOM เต็มเหมือนเดิม
    const bom0 = asmParent?.bom || [];
    const noGlass = bom0.filter((b) => !isGlassName(`${b.part_no || ""} ${b.part_name || ""}`));
    const bom = noGlass.length ? noGlass : bom0;
    const pq = Math.max(1, Math.floor(Number(asmParentQty) || 1));
    if (bom.length === 0) return false;
    return bom.every((b) => (asmGotByPm[b.child_pm_id] || 0) >= Math.max(1, Math.floor(Number(b.qty) || 1)) * pq);
  }, [dept, asmParent, asmGotByPm, asmParentQty]);
  const [asmAutoIn, setAsmAutoIn] = useState(0);   // นับถอยหลังก่อนปิดงานอัตโนมัติ (0 = ไม่ได้นับ)
  useEffect(() => {
    // ปิดงานอัตโนมัติเฉพาะซับ + ยืนยันจำนวนแล้ว (locked) + ครบ BOM×จำนวน + มีลูกสแกนรอบนี้
    // ★ รอบ 23: เลิกปิดงานอัตโนมัติ (ผู้ใช้: "ไม่ต้องปิดงาน · ไม่ได้ประกอบครบในตอนเดียว · หลังบ้านดูเองว่าครบ/ผิด")
    //   → หน้างานกด "บันทึก" เองทุกรอบ · กลับมาใส่เพิ่มได้ · ตัวนับถอยหลังไม่ทำงานอีก
    if (ASM_AUTO_CLOSE === false || dept !== "assembly" || !asmQtyLocked || !asmBomMet || busy || asmChildren.length === 0) { setAsmAutoIn(0); return; }
    setAsmAutoIn(3);
    const iv = setInterval(() => {
      setAsmAutoIn((n) => { if (n <= 1) { clearInterval(iv); asmConfirmRef.current(); return 0; } return n - 1; });
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept, asmQtyLocked, asmBomMet, busy, asmChildren]);

  // ★ รอบ 11 (B26): แถวตารางหน้าเครื่องสร้างครั้งเดียวต่อข้อมูลที่เปลี่ยน — นาฬิกาเดินทุกวินาทีไม่ต้องวาดทั้งตารางใหม่
  //   (แท็บเล็ตรุ่นเล็กกระตุก/กินแบต เมื่อสัปดาห์มีหลายร้อยแถว)
  const recRowsEl = useMemo(() => rows.map((r, i) => {
                const fin = String(r.status).toLowerCase() === "finished";
                const isNew = (r.id && r.id === newRowId);
                return (
                  <tr key={r.id || i} className={`${isNew ? "stn-new" : ""}${r.pending ? " stn-pending-row" : ""}`}
                    title={r.pending ? "ยังไม่ซิงค์ — รอเน็ตกลับมา" : undefined}>
                    <td className="stn-mono">{r.day ? dayDM(r.day) : todayMD()}</td>
                    <td className="stn-hide-sm">{fmtM(r.mdf_no) || "-"}</td>
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
                    <td className="stn-hide-sm" style={{ textAlign: "center" }}>{r.inventory_code || "-"}</td>
                    <td className="stn-hide-sm">{hms(r.process_seconds)}</td>
                    <td className={fin ? "stn-st-fin" : "stn-st-inp"}>
                      {fin ? t("เสร็จแล้ว", "Finished") : t("กำลังทำ", "In Process")}
                    </td>
                  </tr>
                );
              }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, newRowId, lang]);

  // ── ★ รอบ 13: ยอดวันนี้แยกขั้นตอน (server + งานรอซิงค์ในเครื่อง) ─────────────────
  const dayOpsList = useMemo(() => {
    if (!dayOps) return [];
    const m = new Map();
    (dayOps.ops || []).forEach((o) => m.set(String(o.operation_id || "?"), { id: String(o.operation_id || "?"), name: o.name, seq: o.seq, qty: Number(o.qty) || 0, pend: 0 }));
    Object.entries(dayOps.pending || {}).forEach(([id, q]) => {
      const known = allOps.find((x) => String(x.id) === id);
      const cur = m.get(id) || { id, name: known?.name || "?", seq: known?.seq, qty: 0, pend: 0 };
      cur.pend += Number(q) || 0; m.set(id, cur);
    });
    return [...m.values()].filter((x) => x.qty || x.pend).sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
  }, [dayOps, allOps]);

  // ── ★ รอบ 13: กันจอดับ + สแกนเนอร์ USB/Bluetooth ───────────────────────────────
  useWakeLock();
  useWedgeScanner(async (code) => {
    const s = String(code || "").trim();
    if (!s) return;
    if (document.querySelector(".mls-confirm-backdrop, .stn-rep-ov")) { errorBeep(); return; }   // มีหน้าต่างถามอยู่ → ไม่สแกนทับ
    if (busy || savingRef.current) { errorBeep(); flash(t("กำลังทำงานอยู่ — รอสักครู่แล้วสแกนใหม่", "Busy — wait a moment and scan again"), "warn"); return; }
    // ★ 2026-10-10 ตรวจรอบ 3: มีลูกรอยืนยันจำนวนอยู่ → ไม่สแกนทับ (เดิมเปลี่ยนลูกแต่จำนวนที่พิมพ์ค้างของตัวเก่า)
    if (isAsm && asmPending) { errorBeep(); flash(t("กดใส่/ยกเลิกชิ้นที่สแกนก่อน", "Add or cancel the scanned item first"), "warn"); return; }
    if (isAsm) { warmAudio(); await asmScan(s); return; }
    if (hold) { errorBeep(); flash(holdMsg(), "warn"); return; }
    if (step === STEP.CANCEL) return;
    if (step === STEP.PART) { errorBeep(); flash(t("กด OK เพื่อบันทึก หรือกด ยกเลิก ก่อนสแกนใหม่", "Press OK to save, or Cancel, before scanning again"), "warn"); return; }
    if (step === STEP.IDLE && !beginJob()) return;           // ยังไม่เริ่ม → สแกน = กด START ให้เลย
    warmAudio();
    await onDecoded(s);
  });

  // ── ★ รอบ 13: ส่งสถานะหน้าเครื่องให้ออฟฟิศ/จอ TV (ทุก 1 นาที + ทันทีที่สถานะเปลี่ยน) ─────────
  const pingState = hold ? (hold.kind === "stop" ? "stopped" : "paused")
    : ((isAsm ? !!asmParent : (step !== STEP.IDLE && !!unit)) ? "running" : "idle");
  const pingPart = (isAsm ? asmParent?.unit?.part_master?.part_no : unit?.part_master?.part_no) || null;
  const pingSince = hold ? hold.since : (pingState === "running" && !isAsm ? startTsRef.current : null);
  const pingRef = useRef(null);
  pingRef.current = { dept, state: pingState, part_no: pingPart, state_since: pingSince ? new Date(pingSince).toISOString() : null };
  useEffect(() => {
    const tmo = setTimeout(() => { stationPing(pingRef.current); }, 1500);
    return () => clearTimeout(tmo);
  }, [pingState, pingPart, pending, rejected, evPending]);
  useEffect(() => {
    const iv = setInterval(() => { stationPing(pingRef.current); }, 60000);
    const on = () => setTimeout(() => stationPing(pingRef.current), 2500);
    window.addEventListener("online", on);
    return () => { clearInterval(iv); window.removeEventListener("online", on); };
  }, []);

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
  const scanArmed = step === STEP.REC;                     // รอสแกน (รอบ 1 = เริ่ม · รอบ 2 = จบงาน) → ปุ่ม SCAN เด่น
  const timerLive = !!unit && recording && !hold;   // เวลาเดินจริง (สแกนรอบ 1 แล้ว จนกด OK) · พัก/หยุดอยู่ = นาฬิกานิ่ง

  // WorkArea ตัวเดียว ใช้ได้ทั้งหน้า machine (โหมดเครื่อง) และ assembly/packing (โหมดประกอบ/แพ็ก)
  const workAreaEl = (
    <WorkArea
      step={step} elapsed={elapsed} unit={unit} progress={progress} qty={qty} setQty={setQty}
      status={status} setStatus={setStatus} statusLock={statusLock} busy={busy}
      onDecoded={onDecoded} onManualEntry={onManualEntry} onPickUnit={onPickUnit}
      confirmCancel={confirmCancel} confirmPart={confirmPart}
      closeScan={closeScan} rescan={backToRun} dupCount={dupCount} matReady={matReady} quick={quick}
      isAsm={isAsm} asmType={dept} asmParent={asmParent} asmChildren={asmChildren} asmComplete={asmComplete}
      asmParentQty={asmParentQty} setAsmParentQty={setAsmParentQty} asmAutoIn={asmAutoIn}
      asmQtyLocked={asmQtyLocked} setAsmQtyLocked={setAsmQtyLocked}
      asmDecoded={asmDecoded} asmManual={asmManual} asmScan={asmScan}
      asmConfirm={asmConfirm} asmRemoveChild={asmRemoveChild} asmRemoveInstalled={asmRemoveInstalled} asmReset={asmReset} asmOpenCam={asmOpenCam}
      asmUndo={asmUndo} asmUndoRemove={asmUndoRemove}
      asmPending={asmPending} asmAddPending={asmAddPending} asmCancelPending={asmCancelPending}
      packPhotos={packPhotos} photoOpen={photoOpen} openPhoto={() => setPhotoOpen(true)} closePhoto={() => setPhotoOpen(false)}
      photoCapture={photoCapture} photoRemove={photoRemove}
    />
  );

  // ── หน้า assembly / packing = เลย์เอาต์เฉพาะแผนก (ไม่มีตารางเครื่อง/นาฬิกา/ความยาววัสดุ) ──
  if (isAsm) {
    const meta = DEPT_META[dept];
    return (
      <div className={`stn-shell stn-asm-shell dept-${themeDept(dept)}`}>
        {(!online || pending > 0) && (
          <div className={`stn-netbar${online ? " syncing" : " offline"}`}>
            {!online ? (
              <span><Icon name="wifiOff" size={15} className="stn-ico" />{t("ออฟไลน์", "Offline")}{pending > 0 ? ` · ${t("ค้างซิงค์", "pending sync")} ${pending}` : ` · ${t("บันทึกจะเข้าคิว ซิงค์เมื่อเน็ตกลับ", "saves will queue & sync")}`}</span>
            ) : (
              <span><Icon name="refresh" size={15} className="stn-ico" />{t("กำลังซิงค์งานค้าง", "Syncing")} · {pending}</span>
            )}
          </div>
        )}
        {foreign.length > 0 && (
          <div className="stn-rejected" style={{ background: "#7c3aed" }}
            title={t("งานเหล่านี้จะซิงค์ในชื่อเจ้าของงานเท่านั้น (ไม่ลงชื่อบัญชีนี้)", "These jobs only sync under their owner's account")}>
            <Icon name="warn" size={15} className="stn-ico" />
            {foreign.map((f) => t(`งานของ ${f.name || f.code || "บัญชีอื่น"}${f.machineCode ? ` (${f.machineCode})` : ""} ${nc(f.count)} รายการ รอซิงค์`, `${f.count} job(s) of ${f.name || f.code || "another account"}${f.machineCode ? ` (${f.machineCode})` : ""} waiting`)).join(" · ")}
            {" — "}{t("ให้เจ้าของล็อกอินที่แท็บเล็ตนี้เพื่อส่ง", "have the owner log in on this tablet to send them")}
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
            <span className={`stn-asm-badge dept-${themeDept(dept)}`}>{lang === "en" ? meta.en : meta.th}</span>
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
              <button key={o.id} className={`stn-oppick-btn${op?.id === o.id ? " sel" : ""}`} disabled={busy}
                onClick={async () => {
                  if (op?.id === o.id) return;
                  // ★ รอบ 11 (B21): มีเบอร์แม่/ลูกที่สแกนค้างอยู่ → ถามก่อน (เปลี่ยนขั้นตอน = ล้างงานประกอบที่ยังไม่ยืนยัน)
                  if ((asmParent || asmChildren.length) && !(await askConfirm({
                    message: t(`เปลี่ยนเป็น "${opLabel(o.name, lang)}"?\nเบอร์แม่ + ลูกที่สแกนไว้ (ยังไม่ยืนยัน) จะถูกล้าง`, `Switch to "${opLabel(o.name, lang)}"?\nThe open parent and unconfirmed children will be cleared`),
                    tone: "warn", confirmText: t("เปลี่ยน", "Switch"), cancelText: t("ยกเลิก", "Cancel"),
                  }))) return;
                  setOp(o);
                }}>{opLabel(o.name, lang)}</button>
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
      {(!online || pending > 0 || evPending > 0) && (
        <div className={`stn-netbar${online ? " syncing" : " offline"}`}>
          {!online ? (
            <span><Icon name="wifiOff" size={15} className="stn-ico" />{t("ออฟไลน์", "Offline")}
              {pending > 0
                ? ` · ${t("ค้างซิงค์", "pending sync")} ${pending} ${t("ชิ้น", "pcs")}`
                : ` · ${t("ทำงานต่อได้ตามปกติ", "you can keep working")}`}
              {evPending > 0 ? ` · ${t("แจ้งหยุด/พร้อม/เหตุผล รอส่ง", "stop/ready/reasons waiting")} ${evPending}` : ""}
            </span>
          ) : (
            <span><Icon name="refresh" size={15} className="stn-ico" />{t("กำลังซิงค์งานค้าง", "Syncing")} · {pending} {t("ชิ้น", "pcs")}
              {evPending > 0 ? ` · ${t("แจ้งหยุด/พร้อม/เหตุผล", "stop/ready/reasons")} ${evPending}` : ""}</span>
          )}
        </div>
      )}
      {modeUnknown && !online && dept === "machine" && (
        <div className="stn-rejected" style={{ background: "#b45309" }}>
          <Icon name="warn" size={15} className="stn-ico" />
          {t("แท็บเล็ตนี้ยังไม่รู้รูปแบบการสแกนของเครื่องนี้ (ยังไม่เคยเปิดตอนมีเน็ต) — ใช้แบบปกติไปก่อน · ต่อเน็ตแล้วจะสลับเป็นแบบที่ตั้งไว้ให้เอง",
             "This tablet doesn't know this machine's scan mode yet (never opened online) — using the normal mode for now · it switches automatically once online")}
        </div>
      )}
      {foreign.length > 0 && (
        <div className="stn-rejected" style={{ background: "#7c3aed" }}
          title={t("งานเหล่านี้จะซิงค์ในชื่อเจ้าของงานเท่านั้น (ไม่ลงชื่อบัญชีนี้)", "These jobs only sync under their owner's account")}>
          <Icon name="warn" size={15} className="stn-ico" />
          {foreign.map((f) => t(`งานของ ${f.name || f.code || "บัญชีอื่น"}${f.machineCode ? ` (${f.machineCode})` : ""} ${nc(f.count)} รายการ รอซิงค์`, `${f.count} job(s) of ${f.name || f.code || "another account"}${f.machineCode ? ` (${f.machineCode})` : ""} waiting`)).join(" · ")}
          {" — "}{t("ให้เจ้าของล็อกอินที่แท็บเล็ตนี้เพื่อส่ง", "have the owner log in on this tablet to send them")}
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
          <span className="stn-oppick-lbl">{t("ขั้นตอน", "Step")}:</span>
          {machineOps.map((o) => {
            // ★ รอบ 19: ไม่แสดง "ขั้นตอนหลัก" บนปุ่มแล้ว (ไม่มีดาว/กรอบ/ข้อความ — ผู้ใช้ขอ) · ปุ่มทุกขั้นตอนหน้าตาเหมือนกัน
            // ★ รอบ 11 (B21): ระหว่างทำงาน (เริ่ม START แล้ว) ล็อกขั้นตอน — เดิมเปลี่ยนได้กลางงาน (ล็อก/เลขวิ่งคิดจากขั้นตอนเดิม)
            const locked = step !== STEP.IDLE;
            return (
              <button key={o.id}
                className={`stn-oppick-btn${opSel.has(o.id) ? " sel" : ""}`}
                disabled={locked}
                title={locked ? t("ล็อกระหว่างทำงาน — จบ/ยกเลิกงานก่อนถึงเปลี่ยนได้", "Locked during a job — finish or cancel first") : undefined}
                onClick={() => setOpSel((prev) => { const n = new Set(prev); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })}>
                {opLabel(o.name, lang)}
              </button>
            );
          })}
          {opSel.size === 0 && <span className="stn-oppick-hint">← {t("เลือกอย่างน้อย 1 ขั้นตอน", "pick at least one step")}</span>}
          {step !== STEP.IDLE && opSel.size > 0 && <span className="stn-oppick-hint">🔒 {t("ล็อกระหว่างทำงาน", "locked during job")}</span>}
        </div>
      )}
      {machineOps.length === 1 && (
        <div className="stn-oppick one"><span className="stn-oppick-lbl">ขั้นตอน:</span>
          <span className="stn-oppick-btn sel" style={{ pointerEvents: "none" }}>{opLabel(machineOps[0].name, lang)}</span>
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
              {recRowsEl}
            </tbody>
          </table>
        </div>

        {/* bottom-left: daily report */}
        <div className="stn-daily">
          <div className="stn-daily-head">
            <h2>{t("รายงานประจำวัน", "DAILY REPORT")}</h2>
            <div className="stn-date">{todayISOdate(lang)}<span className="stn-build" title="รุ่นของเว็บ">build {appBuildId()}</span></div>
          </div>
          <div className="stn-kpis">
            <div className="stn-kpi"><div className="lbl">{t("จำนวนวันนี้", "Daily Quantity")}</div>
              <div className="val">{fmt(daily.quantity)} {t("ชิ้น", "pcs")}</div></div>
            <div className="stn-kpi"><div className="lbl">{t("น้ำหนักวันนี้", "Daily Weight")}</div>
              <div className="val">{fmt(daily.weight)} {t("กก.", "kg")}</div></div>
            {quick ? null : (
              <div className="stn-kpi"><div className="lbl">{t("เวลาเดินเครื่องวันนี้", "Daily Process Time")}</div>
                <div className="val mono">{hms(daily.process_seconds)}</div></div>
            )}
          </div>
          {/* ★ รอบ 13: ยอดวันนี้แยกตามขั้นตอน (ขั้นตอนที่ติ๊กร่วม = จำนวนชิ้นของสแกนนั้น) */}
          {dayOpsList.length > 0 && (
            <div className="stn-dayops" title={t("จำนวนชิ้นวันนี้ แยกตามขั้นตอน", "Pieces today, per step")}>
              <span className="lbl">{t("แยกขั้นตอน", "By step")}</span>
              {dayOpsList.map((o) => (
                <span key={o.id} className="stn-dayop">
                  <b>{opLabel(o.name, lang)}</b> {fmt(o.qty + o.pend)}
                  {o.pend ? <em> ({t("รอซิงค์", "pending")} {fmt(o.pend)})</em> : null}
                </span>
              ))}
            </div>
          )}
          {/* ท้ายสุด: รายงานวันนี้ของเครื่องนี้ (มีอะไรบ้าง) — ไม่โชว์ระยะเวลาที่หยุด */}
          {stnReports.length > 0 && (
            <div className="stn-daily-reports">
              <div className="stn-dr-head">{t("รายงานวันนี้", "Reports today")} <span>({stnReports.length})</span></div>
              <div className="stn-dr-list">
                {stnReports.map((r) => {
                  const d = new Date(r.at); const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
                  return (
                    <div key={r.key} className="stn-dr-item">
                      <span className={`stn-dr-tag ${r.kind}`}>{r.kind === "stop" ? t("หยุด", "Stop") : t("ทำงาน", "Work")}</span>
                      <span className="stn-dr-reason" title={r.reason}>{r.reason}</span>
                      <span className="stn-dr-time">{hm}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {loadErr && <div className="stn-err">{loadErr}</div>}
        </div>

        {/* bottom-right: work area + control */}
        <div className="stn-work-wrap">
          <div className="stn-work-area">
            {workAreaEl}
            {toast && <div className={`stn-toast ${toast.tone}`}>{toast.text}</div>}
            {/* แจ้งเตือน "ประกอบ/แพ็กเสร็จ" เด้งกลางจอ (auto-hide 2.6 วิ · แตะ/กดตกลง เพื่อปิดเลย) */}
            {asmDone ? (
              <div onClick={() => setAsmDone(null)}
                style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(4,20,12,.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                <div onClick={(e) => e.stopPropagation()}
                  style={{ width: "min(92vw, 420px)", background: "linear-gradient(180deg,#12241a,#0e1b14)", border: "1px solid #2f7d55", borderRadius: 20, padding: "30px 26px 22px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }}>
                  <div style={{ width: 78, height: 78, margin: "0 auto 14px", borderRadius: "50%", background: "#1f9d5a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, color: "#fff", boxShadow: "0 0 0 6px rgba(31,157,90,.22)" }}>✓</div>
                  <div style={{ fontSize: 21, fontWeight: 800, color: "#eafff5" }}>{asmDone.isGlz ? t("ติดกระจกเสร็จแล้ว", "Glazing done") : asmDone.isPack ? t("แพ็กเสร็จแล้ว", "Packing done") : t("ประกอบเสร็จแล้ว", "Assembly done")}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace", color: "#8ff0c0", margin: "10px 0 4px", wordBreak: "break-all" }}>{asmDone.partNo}</div>
                  <div style={{ fontSize: 13.5, color: "#bfe6d3" }}>{asmDone.isGlz ? t("ติดกระจก", "Glazed") : asmDone.isSub ? t("ทำเสร็จ", "Made") : t("ใส่ลูกเข้าไป", "Assembled")} {asmDone.count} {t("ชิ้น", "pcs")} · {t("ปิดงานแล้ว", "closed")}{asmDone.queued ? t(" · รอซิงค์", " · queued") : ""}</div>
                  <button onClick={() => setAsmDone(null)} className="stn-pill ok" style={{ marginTop: 18, width: "100%" }}>{t("ตกลง", "OK")}</button>
                </div>
              </div>
            ) : null}
            {/* เครื่องกำลังหยุด / พักงาน — บังหน้าจอทำงาน + ปุ่มกลับมาทำงาน (ไม่โชว์เวลาที่หยุด) */}
            {hold ? (
              <div className={`stn-down${onBreak ? " brk" : ""}`}>
                <div className="ico">{onBreak ? "☕" : "⛔"}</div>
                <div className="ttl">{onBreak ? t("พักงาน", "ON BREAK") : t("เครื่องหยุด", "MACHINE STOPPED")}</div>
                {!onBreak ? <div className="rsn">{hold.reason}</div> : null}
                {unit && recording ? <div className="sub">{t("หยุดจับเวลางานนี้ไว้แล้ว — ช่วงนี้ไม่นับเป็นเวลาเดินเครื่อง", "Job timer paused — this time isn't counted")}</div> : null}
                {evPending > 0 ? <div className="sub q">{t("ออฟไลน์ — จะส่งแจ้งหยุด/พร้อมให้เองเมื่อเน็ตกลับ", "Offline — the stop/ready will be sent when back online")}</div> : null}
                <button className="ready" disabled={reportBusy} onClick={markReady}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  {onBreak ? t("ทำงานต่อ", "RESUME") : t("พร้อมทำงาน", "READY TO WORK")}
                </button>
              </div>
            ) : null}
            {/* เหตุผล "รอบช้า" ที่ตั้งค้างไว้ — จะบันทึกกับชิ้นที่สแกนถัดไป */}
            {slowArmed && !hold ? (
              <div className="stn-armed">
                <span className="em">⚠️</span>
                <div className="tx"><b>{t("จะแนบกับชิ้นที่สแกน", "Attaches to next SCAN")}:</b> {slowArmed.reason}</div>
                <button className="x" onClick={() => setSlowArmed(null)}>{t("ยกเลิก", "Clear")}</button>
              </div>
            ) : null}
          </div>

          <div className="stn-control">
            <div className="stn-ctl-main">
              {quick ? (
                /* ★ โหมดสแกนครั้งเดียว: ไม่มีนาฬิกา/ความยาว/ปุ่มเริ่ม — โชว์ยอดวันนี้ตัวใหญ่แทน */
                <div className="stn-quick-today">
                  <div className="lbl">{t("เสร็จวันนี้", "Done today")}</div>
                  <div className="val">{fmt(daily.quantity)} <small>{t("ชิ้น", "pcs")}</small></div>
                  <div className="mode">{t("⚡ สแกนครั้งเดียว · ไม่จับเวลา", "⚡ One scan · no timer")}</div>
                </div>
              ) : <>
              <div className={`stn-clock${timerLive ? " live" : ""}`}>{hms(elapsed)}</div>
              <div className={`stn-mat${recording ? " live" : ""}`}
                style={step === STEP.IDLE && !matReady ? { outline: "2px solid #f59e0b", outlineOffset: 2, borderRadius: 8 } : undefined}>
                <div className="lbl">{t("ความยาววัสดุ", "Material Length")} {step === STEP.IDLE && !matReady ? t("· ① กรอกก่อน", "· ① fill first") : ""}</div>
                <NumInput
                  inputMode="numeric" disabled={recording}
                  value={materialLen} placeholder="0"
                  onChange={(e) => setMaterialLen(e.target.value.replace(/[^\d.]/g, ""))}
                />
              </div>
              {/* START ไม่ disable เพราะ !matReady — ปล่อยให้กดได้แล้ว flash บอกเหตุผล (เดิมกดไม่ได้เงียบ) */}
              {/* ★ รอบ 15: ปุ่ม "ขั้นถัดไป" เป็นสีทึบ (ยังไม่เริ่ม + กรอกความยาวแล้ว = เริ่ม · รอสแกน = สแกน) คนใหม่รู้ว่าต้องกดอะไรต่อ */}
              <button className={`stn-ctl-btn${recording ? " recording" : ""}${step === STEP.IDLE && matReady && !hold && !busy ? " next" : ""}`} onClick={onRecord}
                disabled={busy || !!hold}>
                <span>{recording ? t("ยกเลิกงาน", "CANCEL JOB") : t("เริ่ม", "START")}</span><span className="stn-rec-dot" />
              </button>
              </>}
              <button className={`stn-ctl-btn stn-scan-cell${scanArmed || (quick && step === STEP.IDLE) ? " armed" : ""}${step === STEP.SCAN ? " scanning" : ""}${(scanArmed || (quick && step === STEP.IDLE)) && !hold && !busy ? " next" : ""}`} onClick={onScan} disabled={busy || !!hold}>
                <div className="row1">
                  <span>{step === STEP.SCAN ? t("ปิดกล้อง", "CLOSE") : t("สแกน", "SCAN")}</span>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16" /></svg>
                </div>
                <div className="qty">{step === STEP.SCAN ? t("กดซ้ำเพื่อปิดกล้อง", "tap again to close")
                  : step === STEP.REC ? (unit ? t("② สแกนเมื่อทำเสร็จ", "② scan when done") : t("① สแกนเพื่อเริ่ม", "① scan to start"))
                  : step === STEP.PART ? <>{t("จำนวน", "Quantity")} <b>{qty}</b> {t("ชิ้น", "piece")}</>
                  : quick ? t("สแกนเมื่อทำเสร็จ", "scan when done")
                  : t("กด เริ่ม ก่อน", "press START first")}</div>
              </button>
              {/* ปุ่มรายงานปัญหา — เดินเครื่องอยู่ = รายงานการทำงาน · ยังไม่เริ่ม = แจ้งเครื่องหยุด */}
              <button className={`stn-ctl-btn stn-scan-cell stn-report${slowArmed ? " armed" : ""}`} onClick={openReport} disabled={busy || !!hold}>
                <div className="row1">
                  <span>{t("แจ้งปัญหา", "REPORT")}</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                </div>
                <div className="qty">{recording ? (slowArmed ? t("ตั้งเหตุผลแล้ว ✓", "reason set ✓") : t("พัก / หยุด / ช้า", "Break / stop / slow")) : t("แจ้งหยุด / พัก", "Stop / break")}</div>
              </button>
            </div>
            <button className="stn-ctl-btn stn-exit" onClick={onLogout}>
              <span>{t("ออกจากระบบ", "Log out")}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
          {reportOpen ? (
            <StnReportModal mode={reportOpen} busy={reportBusy} midJob={recording} onBreak={startBreak}
              onClose={() => setReportOpen(null)}
              onSubmit={(reason, note, mode) => ((mode || reportOpen) === "stop" ? submitStop(reason, note) : submitWork(reason, note))} />
          ) : null}
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

// แผงยืนยันต่อชิ้น (โหมดประกอบ/แพ็กอิสระ) — สแกนลูก → กรอกจำนวน → กดใส่เข้าเบอร์แม่
function PendConfirm({ pending, onAdd, onCancel, busy, t }) {
  // ★ รอบ 24: จำนวนเริ่มต้น = จำนวนเบอร์แม่ที่ทำรอบนี้ (defQty) · แก้ได้
  const [q, setQ] = useState(String(Math.max(1, Math.floor(Number(pending.defQty) || 1))));
  const nq = Math.max(1, Math.floor(Number(q) || 0));
  const has = Math.max(0, Math.floor(Number(pending.existingQty) || 0));   // มีอยู่แล้วในแถวเดิม (กรณีสแกนเบอร์เดิมซ้ำ)
  const prev = Math.max(0, Math.floor(Number(pending.prevQty) || 0));      // ใส่ไปแล้วในรอบก่อน (บันทึกแล้ว)
  const stepBtn = { width: 46, height: 46, borderRadius: 10, border: "1px solid #2f5f49", background: "#0f1b15", color: "#eafff5", fontSize: 26, fontWeight: 800, cursor: "pointer", lineHeight: 1 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      {/* ล็อกหน้าจอ: แตะพื้นหลังไม่ปิด — ต้องกด "ใส่เข้าเบอร์แม่" หรือ "ยกเลิก" เท่านั้น (กันเผลอแตะแล้วหลุด) */}
      <div style={{ width: "min(92vw, 380px)", background: "#17231d", border: "1px solid #2f5f49", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 16px 48px rgba(0,0,0,.55)" }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#6fd3a6", letterSpacing: ".06em", textTransform: "uppercase" }}>{pending.pack ? t("สแกนของเข้าบั้ง", "Scanned item") : t("สแกนลูกได้", "Scanned child")}</div>
          <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace", color: "#eafff5", margin: "8px 0 2px", wordBreak: "break-all" }}>{pending.part_no}</div>
          {pending.part_name ? <div style={{ fontSize: 13.5, color: "#cfe7dc" }}>{pending.part_name}</div> : null}
          <div style={{ fontSize: 12.5, color: "#9fd8bf", marginTop: 3 }}>
            {pending.len != null && !isNaN(Number(pending.len)) ? <>{t("ยาว", "Len")} {Number(pending.len).toLocaleString()} {t("มม.", "mm")}{pending.wt != null ? " · " : ""}</> : null}
            {pending.wt != null && !isNaN(Number(pending.wt)) ? <>{t("น้ำหนัก", "Wt")} {Number(pending.wt).toLocaleString()} {t("กก.", "kg")}</> : null}
          </div>
          <div style={{ fontSize: 11.5, color: "#7fa694", fontFamily: "monospace", marginTop: 6, wordBreak: "break-all" }}>{pending.qr}</div>
        </div>
        {/* สแกนเบอร์เดิมซ้ำ — บอกว่ามีอยู่แล้วเท่าไร แล้วให้กรอก "จำนวนที่จะเพิ่ม" */}
        {has > 0 ? (
          <div style={{ textAlign: "center", fontSize: 13, color: "#e6c67a", fontWeight: 700, margin: "0 0 12px", padding: "8px 10px", background: "#241f10", border: "1px solid #5c4a1f", borderRadius: 10 }}>
            {t(`เบอร์นี้มีอยู่แล้ว ${nc(has)} ชิ้น — กรอกจำนวนที่จะเพิ่ม`, `already ${nc(has)} pcs — enter amount to add`)}
          </div>
        ) : prev > 0 ? (
          <div className="pend-prev" style={{ textAlign: "center", fontSize: 13, color: "#bfe6d3", fontWeight: 700, margin: "0 0 12px", padding: "8px 10px", background: "#12261c", border: "1px solid #2f5f49", borderRadius: 10 }}>
            {t(`รอบก่อนใส่ไปแล้ว ${nc(prev)} ชิ้น — กรอกจำนวนที่ใส่รอบนี้`, `${nc(prev)} pcs saved earlier — enter this round's amount`)}
          </div>
        ) : null}
        {/* กรอกจำนวน (มีปุ่ม +/− ให้กดง่ายบนแท็บเล็ต) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, margin: "4px 0 16px" }}>
          <span style={{ fontSize: 14, color: "#cfe7dc", fontWeight: 600 }}>{t("จำนวน", "Qty")}</span>
          <button type="button" onClick={() => setQ(String(Math.max(1, nq - 1)))} disabled={busy} style={stepBtn}>−</button>
          <NumInput strict inputMode="numeric" min={1} value={q} disabled={busy}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setQ(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ width: 96, padding: "10px", fontSize: 26, fontWeight: 800, textAlign: "center", borderRadius: 10, border: "1px solid #2f5f49", background: "#0f1b15", color: "#eafff5", fontFamily: "'IBM Plex Mono', monospace" }} />
          <button type="button" onClick={() => setQ(String(nq + 1))} disabled={busy} style={stepBtn}>+</button>
        </div>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#7fa694", marginBottom: 9, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <Icon name="lock" size={12} className="stn-ico" />{t("แตะปุ่มด้านล่างเท่านั้น", "use the buttons below only")}
        </div>
        <div className="stn-row-btns">
          <button className="stn-pill no" onClick={onCancel} disabled={busy}>{t("ยกเลิก", "Cancel")}</button>
          <button className="stn-pill ok" onClick={() => onAdd(nq)} disabled={busy}>{has > 0 ? t(`✓ เพิ่ม (รวม ${has + nq})`, `✓ Add (total ${has + nq})`) : pending.pack ? t("✓ ใส่เข้าบั้ง", "✓ Add to bunk") : t("✓ ใส่เข้าเบอร์แม่", "✓ Add to parent")}</button>
        </div>
      </div>
    </div>
  );
}


// ── หน้าประกอบ/แพ็ก (สเตชัน) = ตารางรายการชิ้นงาน (เช็กลิสต์) + สแกนติ๊กความคืบหน้า ───────────────
//    คอลัมน์: # · เบอร์ชิ้น/ยูนิต · รายละเอียด · ขนาด/ยาว(ประกอบ)|น้ำหนัก(แพ็ก) · จำนวน · ประกอบแล้ว/แพ็กแล้ว (X/Y)
//    ✓ = ครบ · ◐ = บางส่วน · ○ = ยังไม่ทำ (นับสะสม: ที่ติดไปแล้ว + ที่สแกนรอบนี้) · สแกนลูก = ติ๊กเพิ่มอัตโนมัติ
//    ใช้คอมโพเนนต์เดียวทั้งประกอบ (ธีมเขียว) และแพ็ก (isPack → ธีมน้ำเงินจาก .dept-packing + ปุ่มถ่ายรูป)
function AsmWorksheet({ asmParent, asmChildren, asmType, asmComplete, asmReset, asmOpenCam, asmScan, asmConfirm, asmRemoveChild, asmRemoveInstalled, asmUndo = null, asmUndoRemove, busy, t, childWord, confirmVerb, isPack = false, parentQty = 1, setParentQty, autoIn = 0, qtyLocked = false, setQtyLocked, openPhoto, packPhotos = [], photoRemove }) {
  const isGlz = asmType === "glazing";   // ★ รอบ 22: สเตชันติดกระจก — ใส่ "จำนวนที่ติดกระจก" ก่อน · สแกนกระจกได้ (ไม่บังคับ) · กดบันทึกเอง
  const isSub = asmType === "assembly";   // สเตชัน "ซับ" — มีช่อง "จำนวนที่จะทำ" + ปิดงานอัตโนมัติเมื่อครบ BOM (ซ่อน BOM)
  const isPnl = asmType === "panel";      // ★ รอบ 24: สเตชันแผงก็ใส่จำนวนเบอร์แม่ (ป้ายล็อต 1 ใบ = หลายแผง)
  const pqN = Math.floor(Number(parentQty));
  const pq = Number.isFinite(pqN) && pqN >= 0 ? (isGlz ? Math.max(1, pqN) : pqN) : 1;   // 0 = ใส่ของเพิ่มในชิ้นเดิม (ซับ/แผง)
  const reMore = !!(asmParent.batchOk && asmParent.reopen) && !isGlz;   // เบอร์ที่เคยบันทึกแล้ว + server รองรับรอบ → "ทำเพิ่มกี่ชิ้น"
  const madeSum = asmParent.madeSum;
  const subAuto = ASM_AUTO_CLOSE && isSub && (asmParent.bom || []).length > 0;   // ★ รอบ 23: ปิด (บันทึกเองทุกรอบ)   // ซับที่มี BOM (มาจากตอนสั่งผลิต) → ปิดงานอัตโนมัติ ไม่มีปุ่มแตะปิด

  // ── ซับ ขั้นที่ 1: ใส่ "จำนวนที่จะทำ" แล้วกด "เริ่มสแกนลูก" ก่อน (กันปิดงานก่อนตั้งจำนวน) ──
  if ((isSub || isPnl || isGlz) && !qtyLocked) {
    const subNo = asmParent.unit?.part_master?.part_no || asmParent.unit?.qr_code;
    const pqIn = Math.max(1, pq);   // ช่องกรอก (อย่างน้อย 1 · "ไม่ทำเพิ่ม" ใช้ปุ่มด้านล่าง)
    const subName = asmParent.unit?.part_master?.part_name || "";
    const stepBtn = { width: 56, height: 56, borderRadius: 12, border: "1px solid #2f5f49", background: "#0f1b15", color: "#eafff5", fontSize: 30, fontWeight: 800, cursor: "pointer", lineHeight: 1 };
    // ★ 2026-10-10 ตรวจรอบ 3: ใช้การ์ดยืนยันในแอป (window.confirm ถูกบล็อกบน kiosk/PWA)
    const subBack = async () => { if (asmChildren.length > 0 && !(await askConfirm({ message: t("ทิ้งลูกที่สแกนไว้ แล้วย้อนกลับ?", "Discard scanned children and go back?"), tone: "warn", confirmText: t("ทิ้ง", "Discard"), cancelText: t("ยกเลิก", "Cancel") }))) return; asmReset && asmReset(); };
    return (
      <div className="asw">
        <div className="asw-head">
          <button className="asw-change" onClick={subBack} title={t("ย้อนกลับ / เปลี่ยนเบอร์", "Back / change")}>← {t("ย้อนกลับ", "Back")}</button>
          <div className="asw-hgrow">
            <div className="asw-hlabel">{isGlz ? (asmParent.parentKind === "panel" ? t("ติดกระจก · แผง", "GLAZING · PANEL") : t("ติดกระจก · หน้าต่าง/ซับ", "GLAZING · WINDOW/SUB")) : isPnl ? t("เบอร์แม่ (แผง)", "PANEL") : t("เบอร์แม่ (ซับ)", "SUBASSEMBLY")}</div>
            <div className="asw-hno">{subNo}{subName ? <span className="asw-hname">{subName}</span> : null}</div>
          </div>
          <button className="asw-change" onClick={subBack}>{t("เปลี่ยนเบอร์", "Change")}</button>
        </div>
        <div style={{ maxWidth: 520, margin: "8px auto 0", width: "100%", background: "#17231d", border: "1px solid #2f5f49", borderRadius: 16, padding: "26px 20px 22px", textAlign: "center" }}>
          <div className="asw-q-title" style={{ fontSize: 15, color: "#9fd8bf", fontWeight: 700, marginBottom: 4 }}>{isGlz ? t("ติดกระจกกี่ชิ้น?", "How many to glaze?")
            : reMore ? t("รอบนี้ทำเพิ่มกี่ชิ้น?", "How many more this round?")
            : isPnl ? t("จะทำแผงนี้กี่ชิ้น?", "How many panels to make?") : t("จะทำเบอร์นี้กี่ชิ้น?", "How many to make?")}</div>
          <div className="asw-q-sub" style={{ fontSize: 12.5, color: "#7fa694", marginBottom: 18 }}>{isGlz
            ? t(`ประกอบไว้ ${nc(asmParent.madeQty || 1)} ชิ้น · ใส่จำนวนที่ติดกระจกรอบนี้`, `${asmParent.madeQty || 1} assembled · enter how many you glaze now`)
            : reMore
              ? (madeSum != null
                  ? t(`ทำไว้แล้ว ${nc(madeSum)} ชิ้น · ใส่จำนวนที่ทำรอบนี้ แล้วสแกนลูก`, `${nc(madeSum)} made so far · enter this round's quantity, then scan`)
                  : t("เบอร์นี้เคยบันทึกแล้ว · ใส่จำนวนที่ทำรอบนี้ แล้วสแกนลูก", "saved before · enter this round's quantity, then scan"))
              : t("ใส่จำนวนก่อน แล้วค่อยสแกนลูก", "set the quantity, then scan children")}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <button type="button" aria-label="minus" onClick={() => setParentQty && setParentQty(Math.max(1, pqIn - 1))} disabled={busy} style={stepBtn}>−</button>
            <NumInput strict inputMode="numeric" min={1} value={pqIn} disabled={busy}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setParentQty && setParentQty(Math.max(1, Math.floor(Number(String(e.target.value).replace(/[^0-9]/g, "")) || 1)))}
              style={{ width: 130, padding: "12px", fontSize: 40, fontWeight: 800, textAlign: "center", borderRadius: 12, border: "1px solid #2f5f49", background: "#0f1b15", color: "#eafff5", fontFamily: "'IBM Plex Mono', monospace" }} />
            <button type="button" aria-label="plus" onClick={() => setParentQty && setParentQty(pqIn + 1)} disabled={busy} style={stepBtn}>+</button>
          </div>
          <button type="button" className="asw-q-go" onClick={() => { setParentQty && setParentQty(pqIn); setQtyLocked && setQtyLocked(true); }} disabled={busy}
            style={{ marginTop: 22, width: "100%", padding: "15px", borderRadius: 12, border: "none", background: "#2f9e64", color: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer" }}>
            {isGlz ? t(`ต่อไป (ติดกระจก ${nc(pqIn)} ชิ้น)`, `Next (glaze ${pqIn})`)
              : reMore ? t(`เริ่มสแกนลูก (ทำเพิ่ม ${nc(pqIn)} ชิ้น)`, `Start scanning (make ${pqIn} more)`)
              : t(`เริ่มสแกนลูก (จะทำ ${nc(pqIn)} ชิ้น)`, `Start scanning (make ${pqIn})`)}
          </button>
          {reMore ? (
            <button type="button" className="asw-q-nomore" onClick={() => { setParentQty && setParentQty(0); setQtyLocked && setQtyLocked(true); }} disabled={busy}
              style={{ marginTop: 10, width: "100%", padding: "13px", borderRadius: 12, border: "1px solid #2f5f49", background: "#0f1b15", color: "#cfe7dc", fontSize: 15, fontWeight: 700, cursor: "pointer", lineHeight: 1.45 }}>
              {t("ใส่ของเพิ่มในชิ้นเดิม (ไม่ได้ทำเพิ่ม)", "Add parts to the existing ones (no new pieces)")}
              <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#7fa694" }}>{t("ยอดทำไม่เพิ่ม · บันทึกแค่ของที่ใส่", "count stays the same · saves only what goes in")}</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  const pm = asmParent.unit.part_master || {};
  const meta = pm.pkg_meta || {};
  // เบอร์ที่กำลังทำ — แพ็ก: เลขบั้ง (bunk_no) ถ้ามี · ประกอบ: เบอร์พาร์ทแม่
  const parentNo = isPack ? (meta.bunk_no || pm.part_no || asmParent.unit.qr_code) : (pm.part_no || asmParent.unit.qr_code);
  const parentName = isPack
    ? [meta.project, meta.elevation, meta.level ? (String(meta.level).match(/level/i) ? meta.level : `LEVEL ${meta.level}`) : ""].filter(Boolean).join(" · ")
    : (pm.part_name || "");
  const pkind = asmParent.parentKind;
  const kindTh = isPack ? "" : (pkind === "panel" ? "แผง" : pkind === "subassembly" ? "ซับประกอบ" : "");
  const fmtNum = (n, d) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });

  // น้ำหนักต่อยูนิต (หน้าแพ็ก) — จับจากฟอร์มบั้ง (pkg_manifest.unit_no = เบอร์พาร์ท)
  const wtByNo = {};
  if (isPack) (Array.isArray(pm.pkg_manifest) ? pm.pkg_manifest : []).forEach((u) => {
    const k = String(u.unit_no || "").toUpperCase();
    if (k && u.weight != null && u.weight !== "" && !isNaN(Number(u.weight))) wtByNo[k] = Number(u.weight);
  });

  // นับสะสม: ที่ติดไปแล้ว (installed จากรอบก่อน/สเตชันก่อน) + ที่สแกนรอบนี้ → ต่อ child_pm_id
  const prevFor = (pmId) => (asmParent.installed || []).filter((x) => x.child_pm_id === pmId).length;
  const sessFor = (pmId) => asmChildren.filter((c) => c.child_pm_id === pmId).length;

  const rows = (asmParent.bom || []).map((b, i) => {
    const qty = b.qty || 1;
    const have = Math.min(prevFor(b.child_pm_id) + sessFor(b.child_pm_id), qty);
    const measure = isPack
      ? (wtByNo[String(b.part_no || "").toUpperCase()] ?? null)
      : (b.length_mm != null && !isNaN(Number(b.length_mm)) ? Number(b.length_mm) : null);
    return { key: b.child_pm_id ?? ("r" + i), part_no: b.part_no, name: b.part_name || "", qty, have, measure };
  });
  const totalUnits = rows.reduce((s, r) => s + r.qty, 0);
  const doneUnits = rows.reduce((s, r) => s + r.have, 0);

  // ── โหมดประกอบอิสระ (เบอร์แม่ที่ไม่ใช่ package): โชว์ "ลูกที่สแกนเข้าไปแล้ว" แทนเช็กลิสต์ BOM
  //    (เช็กลิสต์อยู่หลังบ้าน) · แยกด้วย kind ให้ตรงกับ RPC — แพ็ก (package) = เช็กลิสต์เหมือนเดิม ──
  const free = pkind !== "package" || !!asmParent.batchOk;   // ★ รอบ 25: บั้ง (server รองรับ) = แบบอิสระเหมือนประกอบ · ไม่โชว์ใบบั้ง
  // ตารางประกอบ: ที่ติดตั้งแล้ว (จากสเตชันก่อน/เซิร์ฟเวอร์) + ที่สแกนเข้ารายการรอบนี้ (ลบออกได้)
  const installedRows = (asmParent.installed || []).map((x, i) => ({
    key: "i" + (x.child_unit_id || i), unit_id: x.child_unit_id, part_no: x.part_no || "—", qr: x.qr || "—", now: false, len: null, wt: null, qty: x.qty ?? 1,
  }));
  const thisRoundRows = asmChildren.map((c) => ({
    key: "n" + c.unit_id, unit_id: c.unit_id, part_no: c.part_no || "—", qr: c.qr || "—", now: true, len: c.len ?? null, wt: c.wt ?? null, qty: c.qty ?? 1,
  }));
  const freeRows = [...installedRows, ...thisRoundRows];
  const scannedCount = freeRows.length;

  // ยกเลิก/ย้อนกลับ — เคลียร์เบอร์แม่ กลับไปหน้าสแกน · กันเผลอทิ้งที่สแกนค้างไว้รอบนี้
  const asmBack = async () => {   // ★ 2026-10-10 ตรวจรอบ 3: การ์ดยืนยันในแอปแทน window.confirm (kiosk/PWA บล็อก)
    if (asmChildren.length > 0 && !(await askConfirm({ message:
      t(`ทิ้ง${childWord}ที่สแกนไว้รอบนี้ ${nc(asmChildren.length)} ชิ้น แล้วย้อนกลับ?`,
        `Discard ${asmChildren.length} scanned ${childWord}(s) this round and go back?`), tone: "warn", confirmText: t("ทิ้ง", "Discard"), cancelText: t("ยกเลิก", "Cancel") }))) return;
    asmReset();
  };

  const measHead = isPack ? t("น้ำหนัก", "Weight") : t("ขนาด/ยาว", "Size/Len");
  const measUnit = isPack ? "Lbs" : "mm";
  const measDigits = isPack ? 1 : 0;

  return (
    <div className="asw">
      <div className="asw-head">
        <button className="asw-change" onClick={asmBack} title={t("ย้อนกลับ / ยกเลิก", "Back / cancel")}>← {t("ย้อนกลับ", "Back")}</button>
        <div className="asw-hgrow">
          <div className="asw-hlabel">{isPack ? t("บั้งที่กำลังแพ็ก", "PACKING") : t("เบอร์แม่ที่กำลังทำ", "PARENT")}{kindTh ? ` · ${kindTh}` : ""}</div>
          <div className="asw-hno">{parentNo}{parentName ? <span className="asw-hname">{parentName}</span> : null}</div>
        </div>
        <div className="asw-scount"><b>{free ? scannedCount : `${nc(doneUnits)}/${nc(totalUnits)}`}</b><span>{isPack ? t("แพ็กแล้ว", "packed") : free ? t("สแกนเข้าไปแล้ว", "scanned in") : t("ประกอบแล้ว", "assembled")}</span></div>
        <button className="asw-change" onClick={asmBack}>{isPack ? t("เปลี่ยนบั้ง", "Change") : t("เปลี่ยนเบอร์", "Change")}</button>
      </div>

      {/* ── ซับ (ยืนยันจำนวนแล้ว): โชว์ "จำนวนที่จะทำ" อ่านอย่างเดียว + ปุ่มแก้ (กลับไปตั้งใหม่) ── */}
      {(isSub || isPnl) ? (
        <div className="asw-qrow" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", margin: "2px 0 6px", background: "#17231d", border: "1px solid #2f5f49", borderRadius: 12 }}>
          {pq === 0 ? (
            <span style={{ fontSize: 14, fontWeight: 700, color: "#cfe7dc", flex: 1, minWidth: 0 }}>{t("ใส่ของเพิ่มในชิ้นเดิม · ยอดทำไม่เพิ่ม", "Adding to existing pieces · count unchanged")}{madeSum != null ? <span style={{ color: "#7fa694", fontWeight: 500 }}> · {t(`ทำไว้แล้ว ${nc(madeSum)} ชิ้น`, `${nc(madeSum)} made`)}</span> : null}</span>
          ) : (<>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#cfe7dc", flex: 1, minWidth: 0 }}>{reMore ? t("รอบนี้ทำเพิ่ม", "Making now") : t("จำนวนที่จะทำ", "Qty to make")}{reMore && madeSum != null ? <span style={{ color: "#7fa694", fontWeight: 500 }}> · {t(`ทำไว้แล้ว ${nc(madeSum)} ชิ้น`, `${nc(madeSum)} made`)}</span> : null}</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: "#8ff0c0", fontFamily: "'IBM Plex Mono', monospace" }}>{pq}</span>
          <span style={{ fontSize: 13, color: "#9fd8bf" }}>{t("ชิ้น", "pcs")}</span>
          </>)}
          <button type="button" onClick={() => setQtyLocked && setQtyLocked(false)} disabled={busy}
            style={{ marginLeft: 6, padding: "9px 13px", borderRadius: 9, border: "1px solid #2f5f49", background: "#0f1b15", color: "#cfe7dc", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("แก้จำนวน", "Edit")}</button>
        </div>
      ) : null}

      <div className="asw-stitle">{isPack ? (free ? t("ของที่แพ็กเข้าบั้งแล้ว", "Packed into this bunk") : t("รายการยูนิตในบั้งนี้", "Units in this bunk")) : free ? t("ลูกที่สแกนเข้าไปแล้ว", "Children scanned in") : t("รายการชิ้นงานที่ต้องใช้", "Parts required")} <span className="hint">· {free ? scannedCount : rows.length} {t("รายการ", "items")}</span></div>
      <div className="asw-sheet">
        {free ? (
        <table className="asw-tab">
          <thead><tr>
            <th className="c-n">#</th>
            <th className="c-pn">{t("เบอร์ชิ้น", "Part No")}</th>
            <th>QR</th>
            <th className="c-len">{t("ยาว (มม.)", "Len (mm)")}</th>
            <th className="c-len">{t("น้ำหนัก (กก.)", "Wt (kg)")}</th>
            <th className="c-qty">{t("จำนวน", "Qty")}</th>
            <th className="c-prog"></th>
          </tr></thead>
          <tbody>
            {freeRows.map((r, i) => (
              <tr key={r.key} className={"asw-r" + (r.now ? " partial" : " done")}>
                <td className="c-n"><span className="nb">{i + 1}</span></td>
                <td className="c-pn">{r.part_no}</td>
                <td className="c-desc" style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>{r.qr}</td>
                <td className="c-len">{r.len != null && !isNaN(Number(r.len)) ? <>{fmtNum(r.len, 0)}<span className="u"> mm</span></> : "—"}</td>
                <td className="c-len">{r.wt != null && !isNaN(Number(r.wt)) ? <>{fmtNum(r.wt, 2)}<span className="u"> kg</span></> : "—"}</td>
                <td className="c-qty">{r.qty ?? 1}</td>
                <td className="c-prog" style={{ textAlign: "center" }}>
                  {r.now
                    ? <span onClick={() => asmRemoveChild(r.unit_id)} title={t("เอาออก", "remove")} style={{ cursor: "pointer", color: "var(--danger-hi, #e6533c)", fontWeight: 700 }}>✕</span>
                    : (r.unit_id && asmRemoveInstalled
                        ? <span onClick={() => asmRemoveInstalled(r.unit_id, r.part_no)} title={t("เอาออก (ลบชิ้นที่บันทึกแล้ว)", "remove (saved)")} style={{ cursor: "pointer", color: "var(--danger-hi, #e6533c)", fontWeight: 700, opacity: .8 }}>✕</span>
                        : null)}
                </td>
              </tr>
            ))}
            {freeRows.length === 0 ? (
              <tr><td colSpan={7} className="asw-tabempty">{isPack ? t("ยังไม่มีของในบั้ง — สแกน QR ของที่แพ็กเข้าบั้งนี้", "nothing packed yet — scan the QR of what goes into this bunk")
                : t("ยังไม่มีลูกที่สแกนเข้าไป — สแกน QR ลูกที่ประกอบเข้าเบอร์นี้", "no children yet — scan the QR of parts assembled into this")}</td></tr>
            ) : null}
          </tbody>
        </table>
        ) : (
        <table className="asw-tab">
          <thead><tr>
            <th className="c-n">#</th>
            <th className="c-pn">{isPack ? t("ยูนิต", "Unit No") : t("เบอร์ชิ้น", "Part No")}</th>
            <th>{t("รายละเอียด", "Description")}</th>
            <th className="c-len">{measHead}</th>
            <th className="c-qty">{t("จำนวน", "Qty")}</th>
            <th className="c-prog">{isPack ? t("แพ็กแล้ว", "Packed") : t("ประกอบแล้ว", "Assembled")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const done = r.have >= r.qty;
              const partial = r.have > 0 && r.have < r.qty;
              return (
                <tr key={r.key} className={"asw-r" + (done ? " done" : partial ? " partial" : "")}>
                  <td className="c-n"><span className="nb">{i + 1}</span></td>
                  <td className="c-pn">{r.part_no}</td>
                  <td className="c-desc">{r.name || "—"}</td>
                  <td className="c-len">{r.measure != null ? <>{fmtNum(r.measure, measDigits)}<span className="u"> {measUnit}</span></> : "—"}</td>
                  <td className="c-qty">{r.qty}</td>
                  <td className="c-prog"><span className="chk">{done ? "✓" : partial ? "◐" : "○"}</span>{nc(r.have)}/{nc(r.qty)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="asw-tabempty">{isPack ? t("บั้งนี้ยังไม่ได้ตั้งรายการ — import ฟอร์มบั้ง หรือกำหนด BOM ที่หน้า Part Master", "no units yet — import the bunk form or set the BOM") : t("เบอร์นี้ยังไม่ได้กำหนด BOM — ตั้งที่หน้า Part Master ก่อน", "no BOM set — set it in Part Master")}</td></tr>
            ) : null}
          </tbody>
        </table>
        )}
      </div>

      <div className="asw-actions">
        {asmUndo && asmUndoRemove && (
          <div className="asw-undo">
            <span>{t("เอาออกแล้ว:", "Removed:")} {asmUndo.child.part_no} · {asmUndo.child.qr}</span>
            <button type="button" onClick={asmUndoRemove}>↶ {t("เอาคืน", "Undo")}</button>
          </div>
        )}
        {/* ชิป "รอคอนเฟิร์ม" นอกตาราง — เหลือเฉพาะแพ็ก (ประกอบ: ที่กดใส่แล้วอยู่ในตารางเลย) */}
        {!free && asmChildren.length > 0 && (
          <div className="asw-scanned">
            {asmChildren.map((c) => (
              <span key={c.unit_id} className="asw-chip" onClick={() => asmRemoveChild(c.unit_id)} title={t("แตะเพื่อเอาออก", "tap to remove")}>{c.part_no} · {c.qr} ✕</span>
            ))}
          </div>
        )}
        <div className="asw-scanhead">
          <button className="asw-scanbtn" onClick={asmOpenCam}><Icon name="camera" size={22} className="stn-ico" />{isPack ? t(`สแกน${childWord}`, `Scan ${childWord}`) : isGlz ? t("สแกนกระจก / ชิ้นที่ติด (ถ้ามี QR)", "Scan glass / parts (if labelled)") : t(`สแกน${childWord}ที่ประกอบ`, `Scan ${childWord}`)}</button>
          <AsmManualInput onSubmit={asmScan} placeholder={t(`หรือพิมพ์ QR ${childWord}`, `type ${childWord} QR`)} t={t} />
        </div>
        {isPack ? (
          <div className="asw-photos">
            <button className="asw-photobtn" onClick={openPhoto}><Icon name="camera" size={16} className="stn-ico" />{t("ถ่ายรูปแพ็ก", "Pack photos")}{packPhotos.length ? ` (${packPhotos.length})` : ""} <span className="opt">{t("· ไม่บังคับ", "· optional")}</span></button>
            {packPhotos.length > 0 && (
              <div className="asw-thumbs">
                {packPhotos.map((p, i) => (
                  <div key={i} className="asw-thumb" title={t("แตะเพื่อลบ", "tap to remove")}
                    onClick={async () => { if (await askConfirm({ message: t("ลบรูปนี้?", "Delete this photo?"), tone: "warn", confirmText: t("ลบ", "Delete"), cancelText: t("ยกเลิก", "Cancel") })) photoRemove(i); }}>
                    <img src={p.url} alt="" /><span className="x">✕</span></div>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {subAuto ? (
          /* ── ซับ (มี BOM จากตอนสั่งผลิต): ครบตามจำนวน → ปิดงานเองอัตโนมัติ · ไม่มีปุ่มแตะปิด ── */
          <div style={{ marginTop: 2 }}>
            {busy ? (
              <div style={{ textAlign: "center", padding: "14px 12px", borderRadius: 12, background: "#123524", border: "1px solid #2f7d54", color: "#8ff0bd", fontWeight: 800, fontSize: 15 }}>{t("กำลังบันทึก…", "saving…")}</div>
            ) : autoIn > 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px 12px", borderRadius: 12, background: "#123524", border: "1px solid #2f7d54", color: "#8ff0bd", fontWeight: 800, fontSize: 16 }}>
                <span>✓ {t("ครบตามจำนวนแล้ว", "All complete")}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>· {t("ปิดงานอัตโนมัติใน", "auto-finishing in")} {autoIn}…</span>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "14px 12px", borderRadius: 12, background: "#17231d", border: "1px dashed #2f5f49", color: "#9fd8bf", fontSize: 14, lineHeight: 1.6 }}>
                {t("สแกนลูกให้ครบตามจำนวนที่จะทำ — ระบบจะปิดงานให้เองอัตโนมัติ", "scan all children up to the target — it finishes automatically")}
              </div>
            )}
          </div>
        ) : (
          isGlz ? (
            <button className="asw-confirm ready" disabled={busy} onClick={asmConfirm}>
              {busy ? "..." : t(`✓ บันทึกติดกระจก ${nc(pq)} ชิ้น${asmChildren.length ? ` · ${nc(asmChildren.length)} รายการที่สแกน` : ""}`,
                                `✓ Save glazing · ${pq} pcs${asmChildren.length ? ` · ${asmChildren.length} scanned` : ""}`)}
            </button>
          ) :
          <button className={"asw-confirm" + (asmChildren.length > 0 ? " ready" : "")} disabled={asmChildren.length === 0 || busy} onClick={asmConfirm}>
            {busy ? "..." : asmChildren.length === 0
              ? (isPack ? t(`สแกน${childWord}ที่ใส่รอบนี้ก่อน`, `scan the ${childWord}s first`) : t(`สแกน${childWord}ที่ประกอบรอบนี้ก่อน`, `scan the ${childWord}s first`))
              : (free
                ? (asmParent.batchOk && (isSub || isPnl)
                    ? (pq > 0 ? t(`✓ บันทึก (ทำ ${nc(pq)} ชิ้น · ${nc(asmChildren.length)} รายการ)`, `✓ Save (make ${pq} · ${asmChildren.length} items)`)
                              : t(`✓ บันทึก (ใส่เพิ่ม ${nc(asmChildren.length)} รายการ)`, `✓ Save (add ${asmChildren.length} items)`))
                    : t(`✓ บันทึก (${nc(asmChildren.length)} รายการ)`, `✓ Save (${asmChildren.length})`))
                : asmComplete
                  ? t(`✓ ${confirmVerb} — ครบ ปิดงาน (${asmChildren.length})`, `✓ ${confirmVerb} — complete (${asmChildren.length})`)
                  : t(`✓ ${confirmVerb} (${nc(asmChildren.length)} ชิ้น)`, `✓ ${confirmVerb} (${asmChildren.length})`))}
          </button>
        )}
      </div>
    </div>
  );
}

// ── วิธีแก้เมื่อเปิดกล้องไม่ได้ ───────────────────────────────────────────────
// เคสหลัก: ตอนแรกกด "ไม่อนุญาต" → เบราว์เซอร์จำไว้และจะไม่เด้งถามอีก (เว็บขอใหม่เองไม่ได้)
//   ต้องให้ผู้ใช้ไปเปิดสิทธิ์ในการตั้งค่า แล้วโหลดหน้าใหม่ — จึงบอกขั้นตอนตามอุปกรณ์
function CameraFixHelp({ kind, t }) {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  const app = isStandalone();
  const iosChrome = isIOS && /CriOS/.test(ua);            // Chrome บน iPad/iPhone
  const iosOther = isIOS && /EdgiOS|FxiOS/.test(ua);      // Edge / Firefox บน iPad
  let steps = [];
  if (kind === "denied") {
    if (iosChrome || iosOther) steps = [
      t("เปิดแอป \"การตั้งค่า\" (Settings) ของ iPad", "Open the iPad Settings app"),
      t(`ไปที่ แอป → ${iosChrome ? "Chrome" : "เบราว์เซอร์ที่ใช้"} → เปิดสวิตช์ \"กล้อง\" (Camera)`, `Go to Apps → ${iosChrome ? "Chrome" : "your browser"} → turn on Camera`),
      t("กลับมาที่ Chrome → แตะไอคอนซ้ายของช่องที่อยู่เว็บ → สิทธิ์ (Permissions) → เปิด \"กล้อง\"", "Back in Chrome → tap the icon left of the address bar → Permissions → turn on Camera"),
      t("ถ้ายังไม่ได้: ปัดปิด Chrome แล้วเปิดใหม่", "Still blocked: swipe Chrome away and reopen it"),
      t("กด \"โหลดหน้าใหม่\" ด้านล่าง แล้วแตะเปิดกล้องอีกครั้ง (ถ้าเด้งถาม ให้กด \"อนุญาต\")", "Tap Reload below, tap to open the camera, and choose Allow if asked"),
    ];
    else if (isIOS && app) steps = [
      t("เปิดแอป \"การตั้งค่า\" (Settings) ของ iPad", "Open the iPad Settings app"),
      t("ไปที่ แอป → Safari → กล้อง (Camera) → เลือก \"อนุญาต\" หรือ \"ถาม\"", "Go to Apps → Safari → Camera → choose Allow or Ask"),
      t("ปิดแอปนี้ (ปัดขึ้นทิ้ง) แล้วเปิดใหม่ → แตะเปิดกล้อง", "Close this app (swipe it away), reopen it, then tap to open the camera"),
      t("ถ้ายังไม่ได้: ลบไอคอนแอปจากหน้าจอโฮม แล้ว \"เพิ่มไปยังหน้าจอโฮม\" ใหม่จาก Safari", "Still blocked: delete the Home Screen icon and add it again from Safari"),
    ];
    else if (isIOS) steps = [
      t("แตะปุ่ม \"aA\" (หรือไอคอนหน้าเว็บ) ซ้ายของช่องที่อยู่เว็บ", "Tap the \"aA\" (page settings) button next to the address bar"),
      t("เลือก \"การตั้งค่าเว็บไซต์\" → กล้อง → \"อนุญาต\"", "Choose Website Settings → Camera → Allow"),
      t("หรือ: การตั้งค่า (Settings) → แอป → Safari → กล้อง → \"อนุญาต\"", "Or: Settings → Apps → Safari → Camera → Allow"),
      t("กด \"โหลดหน้าใหม่\" ด้านล่าง แล้วแตะเปิดกล้องอีกครั้ง", "Tap Reload below, then tap to open the camera again"),
    ];
    else steps = [
      t("แตะไอคอน 🔒 / ⚙ ซ้ายของช่องที่อยู่เว็บ", "Tap the 🔒 / ⚙ icon left of the address bar"),
      t("เลือก \"สิทธิ์\" (Permissions) → กล้อง → \"อนุญาต\"", "Choose Permissions → Camera → Allow"),
      t("กด \"โหลดหน้าใหม่\" ด้านล่าง แล้วแตะเปิดกล้องอีกครั้ง", "Tap Reload below, then tap to open the camera again"),
    ];
  } else if (kind === "insecure") steps = [
    t("เว็บต้องเปิดผ่าน https:// เท่านั้นถึงจะใช้กล้องได้", "The camera only works when the site is opened over https://"),
    t("ตรวจลิงก์ที่เปิด — ให้ใช้ลิงก์ที่ขึ้นต้นด้วย https://", "Check the link — use the one starting with https://"),
  ];
  else if (kind === "busy") steps = [
    t("กล้องถูกแอปอื่นใช้อยู่ — ปิดแอปกล้อง/วิดีโอคอลอื่นก่อน", "The camera is in use by another app — close camera / video-call apps"),
    t("แล้วแตะเปิดกล้องอีกครั้ง (ถ้ายังไม่ได้ ให้โหลดหน้าใหม่)", "Then tap to open the camera again (reload if needed)"),
  ];
  else if (kind === "notfound") steps = [
    t("ไม่พบกล้องบนเครื่องนี้ — ใช้ช่องพิมพ์รหัส QR ด้านล่างแทน", "No camera found on this device — use the code box below"),
  ];
  else if (kind === "unsupported") steps = [
    t("เบราว์เซอร์นี้ใช้กล้องไม่ได้ — เปิดลิงก์ด้วย Safari หรือ Chrome โดยตรง", "This browser can't use the camera — open the link directly in Safari or Chrome"),
  ];
  if (!steps.length) return null;
  return (
    <div className="stn-cam-help" style={{ marginTop: 8, padding: "10px 14px", borderRadius: 12, background: "rgba(59,91,219,.07)", fontSize: 14, lineHeight: 1.55, textAlign: "left" }}>
      <b>{kind === "denied" ? t("กล้องถูกปิดสิทธิ์ไว้ (เคยกด \"ไม่อนุญาต\") — วิธีเปิด:", "Camera permission is blocked (\"Don't Allow\" was chosen) — to fix:") : t("วิธีแก้:", "How to fix:")}</b>
      <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {(kind === "denied" || kind === "busy") && (
        <button type="button" className="stn-pill" style={{ marginTop: 8 }} onClick={() => window.location.reload()}>
          {t("↻ โหลดหน้าใหม่", "↻ Reload")}
        </button>
      )}
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
  const glz = dept === "glazing";   // ★ รอบ 22: รายการ = หน้าต่าง/แผงที่ประกอบเสร็จแล้ว (รอติดกระจกขึ้นก่อน)
  const parentWord = isPack ? t("เบอร์แพ็ก", "package") : glz ? t("หน้าต่าง/แผง", "window/panel") : t("เบอร์แม่", "parent");
  const [glzMissing, setGlzMissing] = useState(false);

  useEffect(() => {
    let alive = true; setRows(null);
    const load = glz ? listGlazingParents().then((r) => { if (r === null) { setGlzMissing(true); return []; } return r; }) : listAssemblyParents(dept);
    load.then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [dept, glz]);

  // ★ รอบ 23: ซับ/แผง — "เริ่มแล้ว" = มีของที่บันทึกเข้าไปแล้ว (ไม่บอกครบ/ไม่ครบ)
  const doing = (s, r) => (glz ? false : (r && r.items != null) ? r.items > 0 : /progress/i.test(s || ""));
  const all = rows || [];
  const filtered = all.filter((r) => {
    if (q.trim()) { const s = q.trim().toLowerCase(); if (!`${r.part_no} ${r.part_name} ${r.project_code}`.toLowerCase().includes(s)) return false; }
    if (filter === "panel") return r.kind === "panel";
    if (filter === "package") return r.kind === "package";
    if (filter === "sub") return r.kind === "subassembly";
    if (filter === "doing") return doing(r.status, r);
    if (filter === "todo") return !doing(r.status, r);
    if (filter === "glz-todo") return !r.glazed;
    if (filter === "glz-done") return !!r.glazed;
    return true;
  });
  const kindLabel = (k) => k === "subassembly" ? t("ซับ", "SUB") : k === "package" ? t("บั้ง", "PKG") : t("แผง", "PANEL");
  const hasItems = all.some((r) => r.items != null);   // ★ รอบ 25: รายการแบบใหม่ (รวมบั้ง/เบอร์ที่บันทึกแล้ว + จำนวนรายการที่ใส่)
  const kindCls = (k) => k === "subassembly" ? "sub" : "panel";
  const submit = (e) => { e.preventDefault(); const s = q.trim(); if (s) onPick(s); };
  const chips = glz
    ? [["all", t("ทั้งหมด", "All")], ["glz-todo", t("รอติดกระจก", "To glaze")], ["glz-done", t("ติดแล้ว", "Glazed")], ["panel", t("แผง", "Panel")], ["sub", t("หน้าต่าง/ซับ", "Window/sub")]]
    : isPack
    ? [["all", t("ทั้งหมด", "All")], ["package", t("บั้ง", "Pkg")], ["doing", hasItems ? t("เริ่มแล้ว", "Started") : t("กำลังทำ", "Doing")], ["todo", t("ยังไม่เริ่ม", "Not started")]]
    : [["all", t("ทั้งหมด", "All")], ["panel", t("แผง", "Panel")], ["sub", t("ซับ", "Sub")], ["doing", t("เริ่มแล้ว", "Started")], ["todo", t("ยังไม่เริ่ม", "Not started")]];

  return (
    <div className="asw-pick">
      <div className="asw-pick-h">{glz ? t("เลือกหน้าต่าง/แผงที่จะติดกระจก", "Choose a window/panel to glaze") : t(`เลือก${parentWord}ที่จะประกอบ`, `Choose a ${parentWord}`)} <span>· {nc(all.length)} {glz ? t("รายการ (ประกอบเสร็จแล้ว)", "assembled") : isPack && !hasItems ? t("รายการที่ค้างอยู่", "pending") : t("รายการ", "items")}</span></div>
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
          <div className="asw-pick-msg">{all.length === 0 ? (glz
            ? (glzMissing ? t("สแกน QR หน้าต่าง/แผงที่จะติดกระจก (รายการให้เลือกจะขึ้นหลังรัน migration-round22-glazing.sql)", "scan the window/panel QR (the pick list appears after migration-round22-glazing.sql)")
                          : t("ยังไม่มีหน้าต่าง/แผงที่ประกอบเสร็จ — สแกน QR เพื่อเริ่ม", "nothing assembled yet — scan to start"))
            : t(`ไม่มี${parentWord}ที่ค้างอยู่ — สแกน QR เพื่อเริ่ม`, "nothing pending — scan to start")) : t("ไม่พบตามที่ค้นหา", "no match")}</div>
        ) : filtered.map((r) => (
          <button type="button" key={r.qr_code || r.id} className="asw-pick-row" onClick={() => onPick(r.qr_code || r.part_no)}>
            <span className={"asw-pick-kind " + kindCls(r.kind)}>{kindLabel(r.kind)}</span>
            <span className="asw-pick-mid">
              <span className="asw-pick-pno">{r.part_no}</span>
              <span className="asw-pick-name">{r.bunk_no && r.bunk_no !== r.part_no ? <><b>{r.bunk_no}</b> · </> : null}{r.part_name}{r.project_code ? <> · <span className="proj">{r.project_code}</span></> : null}</span>
            </span>
            {glz
              ? <span className={"asw-pick-pill " + (r.glazed ? "doing" : "todo")}>{r.glazed ? t("ติดกระจกแล้ว", "glazed") : t("รอติดกระจก", "to glaze")}</span>
              : <span className={"asw-pick-pill " + (doing(r.status, r) ? "doing" : "todo")}>{doing(r.status, r)
                  ? (r.items != null ? t(`ใส่แล้ว ${nc(r.items)} รายการ`, `${r.items} saved`) : t("กำลังทำ", "in progress"))
                  : t("ยังไม่เริ่ม", "not started")}</span>}
            <span className="asw-pick-go">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── เลข M 3 หลัก: บันทึกเก่า "M-01" → แสดง "M-001" (บันทึกงานเก่าเก็บค่าตอนนั้นไว้ ไม่แก้ในฐานข้อมูล) ──
function fmtM(v) { if (v == null) return v; const s = String(v); const m = s.match(/^M-(\d+)$/); return m ? "M-" + String(Number(m[1])).padStart(3, "0") : s; }
function fmtMText(t) { return t == null ? t : String(t).replace(/(^|[^A-Za-z0-9])M-(\d{2})(?!\d)/g, "$1M-0$2"); }
// ── Modify: ข้อความที่ DB เขียนไว้ (ภาษาไทย รูปแบบตายตัว) → อังกฤษ ตอนเลือก EN ──
function modNoteText(note, lang) {
  note = fmtMText(note);
  if (!note || lang !== "en") return note;
  return String(note)
    .replace(/(M-\d+) ถูกยกเลิก/g, "$1 cancelled")                       // ★ ยกเลิก M / ย้อนกลับ
    .replace(/คืนจำนวน/g, "Qty restored")
    .replace(/ยกเลิก QR ที่เพิ่ม (\d+) ใบ/g, "cancelled $1 added QR")
    .replace(/คืน QR (\d+) ใบ/g, "$1 QR restored")
    .replace(/\(คืนค่าเดิม\)/g, "(restored)")
    .replace(/เปิด Part กลับมา/g, "Part reopened")
    .replace(/ย้ายกลับ (\d+) ชิ้น จาก/g, "moved back $1 pcs from")
    .replace(/ย้าย (\d+) ชิ้นกลับไป/g, "moved $1 pcs back to")
    .replace(/· จำนวน (\d+)/g, "· qty $1")
    .replace(/QR ใหม่ (\d+) ใบ/g, "$1 new QR")
    .replace(/ยกเลิก QR ที่ยังไม่ใช้ (\d+) ใบ/g, "cancelled $1 unused QR")
    .replace(/ยกเลิก QR (\d+) ใบ/g, "cancelled $1 QR")
    .replace(/ทำแล้ว (\d+) ชิ้น → สแปร์/g, "$1 made → spare")
    .replace(/ทำแล้ว (\d+) ชิ้น → scrap/g, "$1 made → scrap")
    .replace(/รับย้าย (\d+) ชิ้นจาก/g, "received $1 pcs from")
    .replace(/ย้ายจาก/g, "moved from")
    .replace(/ย้าย (\d+) ชิ้น →/g, "moved $1 pcs →")
    .replace(/\(QR เดิม\)/g, "(same QR)")
    .replace(/เพิ่มจำนวน/g, "Qty increased").replace(/ลดจำนวน/g, "Qty reduced").replace(/ยกเลิก Part/g, "Part cancelled");
}
function WorkArea({ step, elapsed, unit, progress, qty, setQty, status, setStatus, statusLock = { finishedExists: false, inProcessExists: false }, busy, onDecoded, onManualEntry, onPickUnit, confirmCancel, confirmPart, closeScan, rescan, dupCount = 0, matReady = false, quick = false,
  isAsm, asmType, asmParent, asmChildren = [], asmComplete, asmDecoded, asmManual, asmScan, asmConfirm, asmRemoveChild, asmRemoveInstalled, asmReset, asmOpenCam,
  asmUndo = null, asmUndoRemove,
  asmParentQty = 1, setAsmParentQty, asmAutoIn = 0, asmQtyLocked = false, setAsmQtyLocked,
  asmPending = null, asmAddPending, asmCancelPending,
  packPhotos = [], photoOpen, openPhoto, closePhoto, photoCapture, photoRemove }) {
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);

  // ── โหมดประกอบ/แพ็ก (แยกป้ายตามประเภท) ──────────────────────────────────────
  if (isAsm) {
    if (step === STEP.SCAN) {
      return <CameraScan onDecoded={asmDecoded} onManualEntry={asmManual} onPickUnit={() => {}} busy={busy} onClose={closeScan} locked={true} />;
    }
    const isPack = isPackingDept(asmType);
    const childWord = isPack ? t("ของที่ใส่", "item") : t("ลูก", "child");
    const confirmVerb = isPack ? t("ยืนยันแพ็ก", "Confirm pack") : t("ยืนยันประกอบ", "Confirm assembly");
    if (isPack && photoOpen) {
      return <PackPhotoCapture onCapture={photoCapture} onClose={closePhoto} count={packPhotos.length} t={t} />;
    }
    // ประกอบ + แพ็ก ใช้หน้า "สแกนอย่างเดียว" เดียวกัน (AsmWorksheet) — คนงานสแกนเหมือนหน้าตัด
    //   ไม่โชว์ list/manifest ที่หน้างาน · ดูรายการ/เทียบครบไปที่หลังบ้าน (office → "ตรวจงานประกอบ")
    return (
      <div className={"stn-asm" + (asmParent ? " stn-asm-ws" : " stn-asm-pick")}>
        {!asmParent ? (
          <AsmParentPicker dept={asmType} isPack={isPack} onScan={asmOpenCam} onPick={asmScan} t={t} />
        ) : (
          <AsmWorksheet
            asmParent={asmParent} asmChildren={asmChildren} asmType={asmType}
            asmComplete={asmComplete} asmReset={asmReset} asmOpenCam={asmOpenCam} asmScan={asmScan}
            asmConfirm={asmConfirm} asmRemoveChild={asmRemoveChild} asmRemoveInstalled={asmRemoveInstalled} busy={busy} t={t}
            asmUndo={asmUndo} asmUndoRemove={asmUndoRemove}
            isPack={isPack} childWord={childWord} confirmVerb={confirmVerb}
            parentQty={asmParentQty} setParentQty={setAsmParentQty} autoIn={asmAutoIn}
            qtyLocked={asmQtyLocked} setQtyLocked={setAsmQtyLocked}
            openPhoto={openPhoto} packPhotos={packPhotos} photoRemove={photoRemove}
          />
        )}

        {/* แผงยืนยันต่อชิ้น (โหมดประกอบ) — popup กลางจอ · กรอกจำนวน แล้วกด "ใส่เข้าเบอร์แม่" */}
        {asmPending ? (
          <PendConfirm key={asmPending.unit_id || asmPending.qr || "p"} pending={asmPending} onAdd={asmAddPending} onCancel={asmCancelPending} busy={busy} t={t} />
        ) : null}
      </div>
    );
  }

  if (step === STEP.IDLE) {
    // ★ รอบ 16: ขั้นตอนเป็นลำดับตัวใหญ่ + ติ๊กถูกเมื่อทำแล้ว (เดิมข้อความเล็ก 2 บรรทัด · กลางจอว่าง)
    // ★ 2026-10-09: โหมดสแกนครั้งเดียว (ไม่จับเวลา) — ทำเสร็จ → สแกน → จำนวน/สถานะ → OK
    const steps = quick ? [
      { k: "work", done: false, th: <>ทำงานให้ <b>เสร็จ</b></>, en: <>Finish the <b>work</b></>, subTh: "ไม่ต้องกรอกความยาว · ไม่จับเวลา", subEn: "no length · no timer" },
      { k: "scan", done: false, th: <>กด <b>สแกน</b> → สแกน QR</>, en: <>Press <b>SCAN</b> → scan the QR</>, subTh: "สแกนครั้งเดียวตอนเสร็จ", subEn: "one scan when done" },
      { k: "fin", done: false, th: <>ใส่จำนวน + สถานะ → <b>OK</b></>, en: <>Qty + status → <b>OK</b></>, subTh: "เข้ายอดวันนี้ทันที", subEn: "counts toward today" },
    ] : [
      { k: "len", done: matReady, th: <>กรอก <b>ความยาววัสดุ</b></>, en: <>Enter <b>material length</b></>, subTh: "ช่องขวามือ (มม.)", subEn: "right panel (mm)" },
      { k: "start", done: false, th: <>กด <b>เริ่ม</b></>, en: <>Press <b>START</b></>, subTh: "เปิดกล้องสแกน", subEn: "opens the scanner" },
      { k: "scan", done: false, th: <>สแกน QR ชิ้นงาน</>, en: <>Scan the piece QR</>, subTh: "เวลาเริ่มนับตอนสแกน", subEn: "the timer starts on scan" },
      { k: "fin", done: false, th: <>ทำเสร็จ → สแกนอีกครั้ง → <b>OK</b></>, en: <>Done → scan again → <b>OK</b></>, subTh: "ใส่จำนวน + เลือกสถานะ", subEn: "enter qty + status" },
    ];
    const cur = steps.findIndex((x) => !x.done);
    return (
      <div className="stn-idle">
        <div className="stn-idle-title">{t("พร้อมเริ่มงาน", "Ready to start")}</div>
        <ol className="stn-steps">
          {steps.map((x, i) => (
            <li key={x.k} className={x.done ? "done" : i === cur ? "cur" : ""}>
              <span className="n" aria-hidden="true">{x.done ? "✓" : i + 1}</span>
              <span className="tx"><span className="m">{lang === "en" ? x.en : x.th}</span><small>{lang === "en" ? x.subEn : x.subTh}</small></span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (step === STEP.REC) {
    // ยังไม่ได้สแกนรอบ 1 → ยังไม่จับเวลา
    if (!unit) {
      return (
        <div className="stn-hint">
          <div className="big" style={{ color: "#4361ee" }}>{t("① สแกนชิ้นงานเพื่อเริ่ม", "① Scan the piece to start")}</div>
          {t(<>กด <b>SCAN</b> แล้วสแกน QR ของชิ้นงาน — เวลาเริ่มนับตอนสแกน</>, <>Press <b>SCAN</b> and scan the piece’s QR — the timer starts on scan</>)}
        </div>
      );
    }
    // สแกนรอบ 1 แล้ว → กำลังทำ (เวลาเดิน) · ทำเสร็จสแกนอีกครั้ง
    const p = unit.part_master || {};
    const proj = p.projects || {};
    const rel = unit.release || {};
    const total = progress?.total ?? rel.qty ?? null;
    const done = progress?.done ?? 0;
    const showOf = !progress?.noOp && total != null;
    const pct = showOf && Number(total) > 0 ? Math.max(0, Math.min(100, (Number(done) / Number(total)) * 100)) : null;
    return (
      <div className="stn-run-view">
        <div className="stn-part-label" style={{ marginBottom: 8 }}>
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
                <span className="k">MDF NO.</span><span className="v">{fmtM(releaseMdf(unit?.release, p)) || "-"}</span>
                <span className="k">REL NO.</span><span className="v">{rel.release_order || "-"}</span>
                {p.rev ? <><span className="k">REV.</span><span className="v">{p.rev}</span></> : null}
              </div>
              {showOf ? (
                <div className="stn-lbl-of">
                  <span style={{ fontSize: "0.62em", opacity: 0.7, fontWeight: 400, letterSpacing: 0 }}>{t("ทำแล้ว", "Done")} </span>
                  {progress?.offline ? "~" : ""}{fmt(done)} of {fmt(total)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {pct != null ? (
          <div className="stn-run-prog" role="progressbar" aria-valuemin={0} aria-valuemax={Number(total)} aria-valuenow={Number(done)}
            title={t(`ทำแล้ว ${fmt(done)} จาก ${fmt(total)}`, `${fmt(done)} of ${fmt(total)} done`)}>
            <i style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <StationAnim />
        <div className="stn-hint">
          <div className="big">{t("● กำลังทำงาน — จับเวลาอยู่", "● Working — timer running")}</div>
          {t(<>ยกชิ้นงานขึ้นเครื่อง · ทำเสร็จแล้วกด <b>SCAN</b> สแกนอีกครั้ง<br /><span style={{ fontSize: "0.85em", opacity: 0.8 }}>(ป้ายไหนก็ได้ของเบอร์ {p.part_no || "นี้"} · โปรเจค {proj.code || "-"} · Release {rel.release_order || "-"})</span></>,
             <>Load the piece · when done press <b>SCAN</b> and scan again<br /><span style={{ fontSize: "0.85em", opacity: 0.8 }}>(any label of {p.part_no || "this number"} · project {proj.code || "-"} · Release {rel.release_order || "-"})</span></>)}
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
    // ป้ายบอกว่ากำลังสแกนรอบไหน: ① เริ่มงาน (เริ่มจับเวลา) · ② จบงาน (ต้องเป็นเบอร์เดียวกับที่เริ่มไว้)
    const pn = unit?.part_master?.part_no || "";
    const ro = unit?.release?.release_order || "";
    const pj = unit?.part_master?.projects?.code || "";
    return (
      <div className="stn-scan-stack">
        <div className={"stn-scan-phase" + (unit || quick ? " fin" : "")}>
          {quick
            ? t("สแกน QR ชิ้นงานที่ทำเสร็จ (ไม่จับเวลา)", "Scan the finished piece’s QR (no timer)")
            : unit
            ? t(<>② สแกนจบงาน — ป้ายไหนก็ได้ของ <b>{pn}</b> · {pj} · Release <b>{ro}</b> · เวลา {hms(elapsed)}</>, <>② Finish scan — any label of <b>{pn}</b> · {pj} · Release <b>{ro}</b> · {hms(elapsed)}</>)
            : t("① สแกนชิ้นงานเพื่อเริ่มจับเวลา", "① Scan the piece to start the timer")}
        </div>
        <CameraScan onDecoded={onDecoded} onManualEntry={onManualEntry} onPickUnit={onPickUnit} busy={busy} onClose={closeScan} />
      </div>
    );
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
    // ── กฎเลือกสถานะ: เคย Finished → ล็อก Finished · เคย In Process → Finished ปลดเมื่อครบจำนวน ──
    const finExists = !!statusLock?.finishedExists;
    const inpExists = !!statusLock?.inProcessExists;
    const reachedQty = (noOp || total == null) ? true : (projected >= total);   // ครบจำนวน (นับ qty ที่กำลังจะบันทึกครั้งนี้)
    const inpDisabled = finExists;                                // เคย Finished → เลือก In Process ไม่ได้
    const finDisabled = inpExists && !finExists && !reachedQty;   // เคย In Process + ยังไม่ครบ → เลือก Finished ไม่ได้
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
                <span className="k">MDF NO.</span><span className="v">{fmtM(releaseMdf(unit?.release, p)) || "-"}</span>
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
        {/* ★ Modify: บอกว่าเบอร์นี้ถูกแก้อะไร (ชิ้นที่ถูกย้าย = โชว์ตลอด · การแก้ของ Release = 30 วันล่าสุด) */}
        {(() => {
          if (unit?.mod_note) return <div className="stn-mod-note moved">🔀 {t("ชิ้นนี้", "This piece")}: {modNoteText(unit.mod_note, lang)} — {t("ทำตามเบอร์บนจอ (ป้ายอาจยังเป็นเบอร์เดิม)", "follow the number on screen (the label may still show the old one)")}</div>;
          const at = rel.mod_at ? new Date(rel.mod_at).getTime() : 0;
          if (rel.mod_note && at && (Date.now() - at) < 30 * 86400000) return <div className="stn-mod-note">ℹ️ {modNoteText(rel.mod_note, lang)}</div>;
          return null;
        })()}
        <div className="stn-qty-lbl">{t("จำนวน", "QUANTITY")}</div>
        <div className="stn-qty-stepper">
          <button onClick={() => setQty(Math.max(0, qty - 1))}>−</button>
          <NumInput strict inputMode="numeric" value={qty}
            onChange={(e) => setQty(Math.min(100000, Math.max(0, parseInt(e.target.value || "0", 10) || 0)))} />
          <button onClick={() => setQty(Math.min(100000, qty + 1))}>+</button>
        </div>
        <div className={`stn-row-btns stn-status-row${!status ? " pick" : ""}`}>
          <button className={`stn-pill ${status === "inprocess" ? "sel-inp" : ""}`} disabled={inpDisabled}
            style={inpDisabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            onClick={() => { if (!inpDisabled) setStatus("inprocess"); }}>{t("กำลังทำ", "In Process")}</button>
          <button className={`stn-pill ${status === "finished" ? "sel-fin" : ""}`} disabled={finDisabled}
            style={finDisabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            onClick={() => { if (!finDisabled) setStatus("finished"); }}>{t("เสร็จแล้ว", "Finished")}</button>
        </div>
        {finDisabled ? (
          <div className="stn-status-hint" style={{ fontSize: 12.5, color: "#b45309", textAlign: "center", marginTop: 2, lineHeight: 1.5 }}>
            {t(`ทำให้ครบ ${fmt(total)} ชิ้นก่อน ถึงจะเลือก "เสร็จแล้ว" ได้ (ตอนนี้ ${fmt(projected)})`, `Reach ${fmt(total)} pcs first to pick Finished (now ${fmt(projected)})`)}
          </div>
        ) : inpDisabled ? (
          <div className="stn-status-hint" style={{ fontSize: 12.5, color: "#b45309", textAlign: "center", marginTop: 2, lineHeight: 1.5 }}>
            {t("เบอร์นี้เครื่องนี้บันทึกเป็น \"เสร็จแล้ว\" แล้ว — เลือกได้เฉพาะ เสร็จแล้ว", "Marked Finished on this machine — Finished only")}
          </div>
        ) : (inpExists && !finExists && !noOp && total != null && reachedQty) ? (
          <div className="stn-status-hint" style={{ fontSize: 12.5, color: "#0e9d63", textAlign: "center", marginTop: 2, lineHeight: 1.5 }}>
            {t(`ครบ ${fmt(total)} แล้ว — กด "เสร็จแล้ว" เพื่อปิดงาน หรือทำสแปร์ต่อได้ (กำลังทำ)`, `Reached ${fmt(total)} — press Finished to close, or keep going for spares (In Process)`)}
          </div>
        ) : !status ? (
          /* ★ รอบ 15: ปุ่ม OK จาง = ยังไม่ได้เลือกสถานะ → บอกให้ชัด */
          <div className="stn-status-hint need">{t("① เลือก \"กำลังทำ\" หรือ \"เสร็จแล้ว\"  →  ② กด OK", "① Pick In Process or Finished  →  ② press OK")}</div>
        ) : qty <= 0 ? (
          <div className="stn-status-hint need">{t("ใส่จำนวนอย่างน้อย 1 ชิ้น", "Enter at least 1 piece")}</div>
        ) : null}
        <div className="stn-row-btns">
          <button className="stn-pill no" onClick={rescan} disabled={busy} title={quick ? t("ไม่บันทึกชิ้นนี้ กลับไปหน้าแรก", "Don't save — back to start") : t("กลับไปหน้ากำลังทำงาน (เวลายังเดินอยู่)", "Back to the running job (timer keeps running)")}>{quick ? t("✕ ยกเลิก", "✕ Cancel") : t("← กลับ", "← Back")}</button>
          <button className={`stn-pill ok${status && qty > 0 && !busy ? " next" : ""}`} onClick={confirmPart} disabled={!status || qty <= 0 || busy}>{busy ? "..." : "OK"}</button>
        </div>
      </div>
    );
  }
  return null;
}

// ── Camera QR scanner (rear camera + jsQR) with manual fallback ────────────
function CameraScan({ onDecoded, onManualEntry, onPickUnit, busy, onClose, locked = false }) {
  // ★ รอบ 11 (A2): เรียก onDecoded "ตัวล่าสุด" เสมอ — เดิมกล้องจับฟังก์ชันตอนเปิดกล้องไว้ (effect [camOn])
  //   → สถานีแพ็กที่เปิดกล้องค้าง เห็นรายการลูก "ตอนเปิดกล้อง" ตลอด → ถือกล้องค้างที่ป้ายเดิม = เพิ่มซ้ำทุก 1 วิ
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;
  // ★ รอบ 11 (L3): ป้ายเดิมที่เพิ่งอ่าน (ไม่ผ่าน/รับแล้วในโหมดแพ็ก) ค้างหน้ากล้อง → ไม่อ่านซ้ำภายใน 4 วิ
  //   (เดิมบี๊บ/สั่น/ค้นซ้ำทุก ~1 วิ)
  const lastCodeRef = useRef({ code: null, at: 0 });
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);   // แคนวาสวาดกรอบขาวทับ QR ที่เจอ
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [manual, setManual] = useState("");
  const [err, setErr] = useState("");
  const [errKind, setErrKind] = useState("");   // เหตุที่เปิดกล้องไม่ได้ → โชว์วิธีแก้
  const [pickList, setPickList] = useState(null);   // [options] ให้เลือก "โปรเจค" เมื่อเบอร์พาร์ทอยู่หลายโปรเจค
  const [pickFilter, setPickFilter] = useState("");   // ค้นหาโปรเจคในตัวเลือก (กรณีมีหลายสิบโปรเจค)
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
      if (!stream) { setErrKind(getCameraErrorKind()); setErr(t("เปิดกล้องไม่ได้ — พิมพ์รหัส QR ด้านล่างแทนได้", "Can't open camera — type the QR code below instead")); setCamOn(false); return; }
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
      loop().catch(() => { /* ★ 2026-10-10 ตรวจรอบ 2: โหลดตัวอ่าน QR ไม่ขึ้น (เน็ตกระตุก) — ไม่ปล่อยเป็น error ลอย (ตัวกู้แอปจะล้างแคชทิ้ง) */ });
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
      const now = Date.now();
      if (lastCodeRef.current.code === data && now - lastCodeRef.current.at < 4000) return;   // ป้ายเดิมยังค้างหน้ากล้อง → ข้าม
      doneRef.current = true;                          // หยุดทุกตัวชั่วคราว (กัน decode ซ้ำ)
      Promise.resolve(onDecodedRef.current(data)).then((ok) => {
        if (!ok) { lastCodeRef.current = { code: data, at: Date.now() }; clearBox(); setTimeout(() => { doneRef.current = false; }, 1000); }
      }).catch(() => { lastCodeRef.current = { code: data, at: Date.now() }; clearBox(); setTimeout(() => { doneRef.current = false; }, 1000); });
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
    // เบอร์พาร์ทอยู่หลายโปรเจค → คืน choose ให้เลือกโปรเจค · โปรเจคเดียว → ระบุเลย
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
            {!locked && <button type="button" className="stn-cam-close" onClick={onClose} aria-label={t("ปิด", "Close")}>✕</button>}
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
          <button type="button" className="stn-cam-open" onClick={() => { setErr(""); setErrKind(""); setCamOn(true); }}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            <span>{t("แตะเพื่อเปิดกล้อง", "Tap to open camera")}</span>
          </button>
        )}
      </div>
      {err && <div className="stn-err" style={{ marginTop: 10 }}>{err}</div>}
      {err && errKind && errKind !== "other" && <CameraFixHelp kind={errKind} t={t} />}
      <form className="stn-cam-manual" onSubmit={submitManual}>
        <input className="stn-input stn-mono" value={manual} placeholder={t("หรือพิมพ์ QR / เบอร์พาร์ท", "or type QR / part no.")}
          onChange={(e) => setManual(e.target.value)} />
        <button className="stn-pill" type="submit" disabled={busy}>{t("ตกลง", "OK")}</button>
      </form>
      <div className="stn-cam-cancel-row">
        <button type="button" className="stn-pill stn-cam-cancel" onClick={onClose}>{t("✕ ปิด / ยกเลิก", "✕ Close / Cancel")}</button>
      </div>

      {/* เบอร์พาร์ทอยู่หลายโปรเจค → เลือก "โปรเจค" อย่างเดียว (ไม่ต้องเลือก release)
          ★ โปรเจคที่ "ยังไม่ได้ทำขั้นตอนนี้" ขึ้นก่อน · ที่ทำแล้วอยู่ล่าง (ไว้แก้งานเสีย)
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
                <span>{t("อยู่", "in")} {pickList.length} {t("โปรเจค — เลือกให้ตรงชิ้นจริง (ดูความยาว)", "projects — pick the one matching the piece (check length)")}</span>
              </div>
              {/* มีหลายโปรเจค → ช่องค้นหา (พิมพ์โค้ด/ชื่อโปรเจคให้แคบลง) */}
              {pickList.length > 6 && (
                <input className="stn-input stn-pick-search" value={pickFilter} autoFocus
                  placeholder={t("ค้นหาโปรเจค (โค้ด/ชื่อ)…", "Search project (code/name)…")}
                  onChange={(e) => setPickFilter(e.target.value)} />
              )}
              <div className="stn-pick-list">
                {filtered.length === 0 && <div className="stn-pick-empty">{t("ไม่พบโปรเจคที่ค้นหา", "No matching project")}</div>}
                {filtered.map((o, i) => {
                  const projText = [o.code, o.name].filter(Boolean).join(" · ") || t("ไม่ระบุโปรเจค", "No project");
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
  // ★ 2026-10-10 ตรวจรอบ 3: เปลี่ยนชื่อ (เดิมชื่อซ้ำ reasonText ระดับไฟล์ → fallback เรียกตัวเอง = วนไม่จบ จอค้าง)
  const rejReasonText = (r) => {
    if (r === "not_found" || r === "unit_not_found") return t("ไม่พบ QR/ล็อตในระบบ (อาจถูกลบ)", "QR/lot not found (may be deleted)");
    if (r === "qr_cancelled") return t("QR ถูกยกเลิกใน Modify (ออฟฟิศลดจำนวน/ยกเลิก Part)", "QR cancelled by an office Modify");
    if (r === "release_cancelled") return t("Part ถูกยกเลิกใน Modify — ออฟฟิศต้องตัดสิน (สแปร์/คืนงาน)", "Part cancelled by an office Modify");
    if (r === "retry_exhausted") return t("ลองซิงค์หลายครั้งไม่สำเร็จ", "Failed after several retries");
    if (r === "forbidden" || r === "unauthorized") return t("สิทธิ์/เซสชันมีปัญหา", "Permission/session issue");
    return reasonText(r, t);
  };
  const whatText = (it) => {
    const mw = it.machineWork;
    if (mw) return `${mw.p_qr || "-"}${mw.p_quantity ? ` × ${mw.p_quantity}` : ""}`;
    // ★ งานประกอบ/แพ็ก (it.assembly) — เดิมตกไป it.qr = "-" (ไม่รู้ว่าเบอร์ไหนพัง) → โชว์เบอร์แม่ + จำนวนลูก
    if (it.assembly) { const a = it.assembly; const n = (a.p_child_qrs || []).length; return `${a.p_parent_qr || "-"} · ${n} ${t("ชิ้น", "pcs")}`; }
    return it.qr || "-";
  };
  const whenText = (it) => {
    const ts = it.rejectedAt || it.ts;
    if (!ts) return "";
    try { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
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
              <div className="stn-rej-reason">{rejReasonText(it.reason)}</div>
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

// ── กันจอขาวหน้าสเตชัน — จับ error ตอนเรนเดอร์ → โชว์การ์ด (ธีมมืด) + ปุ่มโหลดใหม่/ออกจากระบบ ──
//   ถ้าเป็น error จาก chunk ค้าง (deploy ใหม่ทับของเก่า) กู้เอง 1 ครั้ง (เหมือน auto-heal ใน main.jsx)
function stnHardReload(auto = false) {
  const reload = () => { try { location.reload(); } catch { /* ignore */ } };
  // ★ 2026-10-10 ตรวจรอบ 2: กู้อัตโนมัติ + มีชุดแอปครบในแคช (sw รุ่นใหม่) → แค่โหลดใหม่ ไม่ล้าง (กันหน้าเครื่องเปิดออฟไลน์ไม่ได้)
  if (auto && !(typeof navigator !== "undefined" && navigator.onLine === false) && window.caches && caches.match) {
    caches.match("/__mls-shell-meta").then((m) => { if (m) reload(); else stnHardReload(false); }, () => stnHardReload(false));
    return;
  }
  // ★ ออฟไลน์: ห้ามล้างแคช/ถอน service worker (จะทำให้เปิดแอปไม่ได้เลยจนกว่าจะออนไลน์)
  //   — โหลดใหม่จาก app shell ที่แคชไว้เฉยๆ · การล้างแคชช่วยได้เฉพาะตอนออนไลน์ (ดึงเวอร์ชันใหม่ได้)
  if (typeof navigator !== "undefined" && navigator.onLine === false) { reload(); return; }
  try {
    const cc = (window.caches && caches.keys) ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {}) : Promise.resolve();
    const sw = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) ? navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {}) : Promise.resolve();
    Promise.all([cc, sw]).finally(reload);
  } catch { reload(); }
}
class StationErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null, stack: "" }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    console.error("Station crashed:", err, info?.componentStack);
    this.setState({ stack: info?.componentStack || "" });
    const msg = String(err?.message || err || "");
    if (/#130|Loading chunk|ChunkLoadError|Importing a module script failed|dynamically imported/i.test(msg)) {
      let healed = false;
      try { healed = sessionStorage.getItem("mls-healed") === "1"; } catch { /* ignore */ }
      // ★ ออฟไลน์: ไม่ auto-heal (โหลดใหม่ตอนออฟไลน์ไม่ช่วย + เสี่ยงวน) → โชว์การ์ด crash ให้เลือกเอง
      if (!healed && !(typeof navigator !== "undefined" && navigator.onLine === false)) { try { sessionStorage.setItem("mls-healed", "1"); } catch { /* ignore */ } stnHardReload(true); }
    }
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="stn-crash">
        <div className="stn-crash-card">
          <div className="stn-crash-title">หน้าจอมีปัญหาชั่วคราว</div>
          <div className="stn-crash-sub">งานที่บันทึกไปแล้วไม่หาย · กด “โหลดใหม่” เพื่อใช้งานต่อ — ถ้ายังไม่หาย แคปข้อความด้านล่างส่งแอดมิน</div>
          <pre className="stn-crash-pre">{String(this.state.err?.message || this.state.err)}{this.state.stack ? "\n\n" + this.state.stack.split("\n").slice(0, 6).join("\n") : ""}</pre>
          <div className="stn-crash-btns">
            <button className="stn-crash-reload" onClick={() => stnHardReload(false)}>{/* ★ 2026-10-10 ตรวจรอบ 3: เดิมส่ง event เป็น auto=true → ไม่ล้างแคช */}โหลดใหม่ (ล้างแคช)</button>
            {this.props.onLogout ? <button className="stn-crash-logout" onClick={() => { try { this.props.onLogout(); } catch { stnHardReload(); } }}>ออกจากระบบ</button> : null}
          </div>
        </div>
      </div>
    );
  }
}

export default function StationApp({ dept = "machine" } = {}) {
  const meta = DEPT_META[dept] || DEPT_META.machine;
  const [lang] = useLang();
  const t = (th, en) => (lang === "en" ? en : th);
  const [user, setUser] = useState(getSession());
  const [leaving, setLeaving] = useState(false);   // กำลังออกไปหน้าแอดมิน (กันกดซ้ำ)
  const [notice, setNotice] = useState("");
  async function logout() {
    // เตือนถ้ายังมีงานค้างซิงค์ (ไม่หาย — เก็บใน localStorage รอดข้ามล็อกอิน จะซิงค์เองรอบหน้า)
    // ★ รอบ 11: ออนไลน์ → ลองส่งงานค้างก่อน · งานค้างผูกกับบัญชีนี้ (A1) · มีงานกำลังทำ (B22) → บอกด้วย
    if (typeof navigator === "undefined" || navigator.onLine !== false) { try { await flushScanQueue(); } catch { /* ignore */ } }
    const pending = myQueueCount() + rejectedQueueCount();
    let running = false, runningCount = false;
    try {
      const d = JSON.parse(localStorage.getItem(draftKeyFor(user?.id)) || "null");
      running = !!(d && d.step && d.step !== "idle" && d.unit);
      runningCount = running && d.mode === "count";   // ★ 2026-10-10 ตรวจรอบ 2: โหมดสแกนครั้งเดียวไม่มีนาฬิกา/ปุ่มยกเลิกงาน → ข้อความต่างกัน
    } catch { /* ignore */ }
    const parts = [];
    if (pending > 0) parts.push(t(`ยังมีงานค้างซิงค์ ${nc(pending)} ชิ้น — จะซิงค์อัตโนมัติเมื่อบัญชีนี้ล็อกอินอีกครั้ง (ข้อมูลไม่หาย)`, `${pending} job(s) still waiting to sync — they'll sync when this account logs in again`));
    if (running) parts.push(runningCount
      ? t("มีชิ้นที่สแกนแล้วแต่ยังไม่กด OK — เก็บไว้ให้บัญชีนี้กด OK ต่อ · ถ้าไม่บันทึกชิ้นนี้ให้กด ✕ ยกเลิก ก่อนออก", "A scanned piece hasn't been saved (OK not pressed) — kept for this account · press ✕ Cancel first if you won't save it")
      : t("มีงานที่กำลังทำอยู่ (ยังไม่กด OK) — เก็บไว้ให้บัญชีนี้ทำต่อ · เวลาเดินเครื่องยังนับต่อ ถ้าไม่ได้ทำต่อให้กดยกเลิกงานก่อนออก", "A job is in progress (OK not pressed) — kept for this account · its timer keeps running; cancel the job first if you won't continue"));
    const msg = parts.length ? parts.join("\n\n") + "\n\n" + t("ออกจากระบบและปิดแอป?", "Log out and close?") : t("ออกจากระบบและปิดแอป?", "Log out and close?");
    if (!(await askConfirm({ message: msg, tone: "warn", confirmText: "ออกจากระบบ", cancelText: "อยู่ต่อ" }))) return;   // แจ้งเตือนก่อนล็อกเอาต์
    try { await clearActiveJobNow(); } catch { /* ignore */ }   // ★ ล้าง "กำลังทำงาน" ฝั่งออฟฟิศก่อน token หมด
    try { await logoutSession(); } catch { /* ignore */ }
    clearSession();
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* ignore */ }
    setUser(null);
    try { window.close(); } catch { /* ignore */ }   // พยายามปิดแอป/แท็บ (ได้ผลบน PWA/บางเบราว์เซอร์)
  }
  // ถูกเตะออกเพราะบัญชีถูกใช้ล็อกอินที่เครื่องอื่น (1 บัญชี = 1 เครื่อง) — เด้งกลับหน้าล็อกอิน
  // ★ รอบ 11 (L2): ออนไลน์จะถูกส่งไปหน้าเข้าสู่ระบบรวม (/) ทันที → ฝากข้อความไว้ให้หน้านั้นแสดง (เดิมไม่เคยเห็น)
  const passNotice = (msg) => { try { sessionStorage.setItem("mls-login-notice", msg); } catch { /* ignore */ } };
  function onKicked() {
    clearSession();
    setUser(null);
    const m = "บัญชีนี้ถูกใช้ล็อกอินที่เครื่องอื่น — กรุณาเข้าสู่ระบบใหม่";
    setNotice(m); passNotice(m);
  }
  // token หมดอายุ (นาน ๆ ครั้ง — บัญชีเครื่องอายุ 30 วัน) — เด้งกลับหน้าล็อกอิน
  //   งานค้างอยู่ในคิว (localStorage) รอดข้ามล็อกอิน → ล็อกอินใหม่แล้วซิงค์ต่อเอง ไม่หาย
  function onExpired() {
    clearSession();
    setUser(null);
    const m = "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่ (งานที่ค้างจะซิงค์อัตโนมัติหลังล็อกอินด้วยบัญชีเดิม)";
    setNotice(m); passNotice(m);
  }
  useEffect(() => { document.body.classList.add("stn-body"); return () => document.body.classList.remove("stn-body"); }, []);
  // เต็มจอเองตอนแตะครั้งแรก (สำหรับคนที่ล็อกอินค้างไว้ — ไม่มี gesture ตอนโหลด) · PWA จะเต็มจอเองอยู่แล้ว
  useEffect(() => armFullscreenOnFirstTap(), []);
  // ล็อกอินรวมหน้าเดียว: ยังไม่ล็อกอิน + ออนไลน์ → ส่งไปหน้าเข้าสู่ระบบรวม (/) · ออฟไลน์ = ใช้หน้าล็อกอินสถานีเดิม (มี cache)
  const stnOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  // ★ ยามกันไฟล์วางสลับ: main.jsx ส่งมาที่ StationApp เฉพาะ path ของสถานี (/station, /assembly, …)
  //   ถ้า StationApp ขึ้นที่ path อื่น (เช่น "/") = src/App.jsx บน GitHub ถูกวางเป็นโค้ด Station.jsx
  //   → หน้าสำนักงาน/แอดมินหายไป + ปุ่ม "ไปหน้าแอดมิน" วนกลับมาจอนี้ + ไม่มี session = รีโหลดวนไม่หยุด
  //   จึงหยุด redirect แล้วบอกวิธีแก้ตรง ๆ แทน
  const onStationPath = (() => {
    try {
      const p = window.location.pathname.replace(/\/+$/, "").toLowerCase();
      return Object.values(DEPT_META).some((m) => p === m.path || p.startsWith(m.path + "/"));
    } catch { return true; }
  })();
  useEffect(() => {
    if (!onStationPath) return;
    if (!user && stnOnline) { try { window.location.replace("/"); } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  let content;
  if (!onStationPath) {
    content = (
      <div className="stn-login-wrap">
        <div className="stn-login">
          <h1>{t("ไฟล์ App.jsx ถูกวางผิด", "App.jsx was replaced by the wrong file")}</h1>
          <p>
            {t("หน้านี้ (", "This page (")}<b>{window.location.pathname}</b>
            {t(") ต้องเป็นหน้าสำนักงาน/แอดมิน แต่ไฟล์ ", ") should be the office/admin app, but ")}<b>src/App.jsx</b>
            {t(" บน GitHub ตอนนี้เป็นโค้ดของหน้าเครื่อง (Station.jsx)", " on GitHub currently holds the station code (Station.jsx)")}<br /><br />
            {t("วิธีแก้: วางไฟล์ App.jsx ตัวจริง (บรรทัดที่ 3 = import { QRCodeSVG } from \"qrcode.react\") ทับ src/App.jsx แล้วรอ Vercel deploy เสร็จ",
               "Fix: upload the real App.jsx (line 3 = import { QRCodeSVG } from \"qrcode.react\") over src/App.jsx, then wait for Vercel to finish deploying")}
          </p>
          <button className="stn-btn" onClick={() => { window.location.href = "/station"; }}>
            {t("ไปหน้าเครื่อง (/station)", "Open the station (/station)")}
          </button>
        </div>
      </div>
    );
  } else if (!user) {
    content = stnOnline
      ? <LoginSplash text="กำลังไปหน้าเข้าสู่ระบบ…" />
      : <div className="stn-body" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}><StationLogin onLogin={(u) => { setNotice(""); setUser(u); }} notice={notice} dept={dept} /></div>;
  } else if (!user.machine) {
    // ★ บัญชีไม่มีเครื่อง/สถานีประจำ → ไปหน้าแอดมิน (ตั้งค่า → พนักงาน) ได้เสมอ
    //   · แอดมิน: ไปได้เลย (session เดิม) เปิดหน้า ตั้งค่า → พนักงาน ให้ทันที
    //   · บัญชีอื่น (operator/office/…): ต้อง "ออกจากระบบจริง" (ฝั่ง server ด้วย) ก่อน แล้วล็อกอินใหม่ด้วยบัญชีแอดมิน
    //     เดิมล้างแค่ในเครื่อง + เฉพาะ operator → บัญชี office ไปถึงหน้าสำนักงานแต่ไม่มีเมนูตั้งค่า (ไปหน้าแอดมินไม่ได้)
    //     และ operator ค้าง "ใช้งานอยู่" ฝั่ง server ~3 นาที (ล็อกอินกลับบัญชีเดิมไม่ได้ชั่วคราว)
    const isAdm = user.role === "admin";
    const goAdmin = async () => {
      if (leaving) return;
      setLeaving(true);
      if (!isAdm) {
        try { await logoutSession(); } catch { /* ignore — ล้างในเครื่องต่อ */ }
        clearSession();
      }
      const q = "go=setup-employees" + (!isAdm && user.code ? "&for=" + encodeURIComponent(user.code) : "");
      window.location.href = "/?" + q;
    };
    content = (
      <div className="stn-login-wrap">
        <div className="stn-login">
          <h1>{t("บัญชีนี้ยังไม่ได้ผูกเครื่อง/สถานี", "This account isn't bound to a machine/station")}</h1>
          <p>
            {t(`${meta.th}ต้องใช้บัญชีที่ตั้ง "เครื่อง/สถานีประจำ" ไว้ที่ ตั้งค่า → พนักงาน`,
               `The ${meta.en} terminal needs an account with a home machine/station set in Setup → Employees`)}<br />
            {isAdm
              ? t("คุณเป็นแอดมิน — กดปุ่มด้านล่างเพื่อไปตั้งเครื่องให้พนักงาน", "You're an admin — use the button below to set machines for employees")
              : t(`บัญชี ${user.code || ""} ยังไม่มีเครื่อง — ให้แอดมินตั้งค่าให้ก่อน`, `Account ${user.code || ""} has no machine yet — ask an admin to set one`)}
          </p>
          {isAdm ? (
            <>
              <button className="stn-btn" onClick={goAdmin} disabled={leaving}>
                {leaving ? t("กำลังไป…", "Opening…") : t("ไปหน้าแอดมิน (ตั้งค่า → พนักงาน)", "Go to admin (Setup → Employees)")}
              </button>
              <div className="stn-login-foot">
                <span className="stn-link-normal" style={{ cursor: "pointer" }} onClick={logout}>{t("ออกจากระบบ", "Log out")}</span>
              </div>
            </>
          ) : (
            <>
              <button className="stn-btn" onClick={logout}>{t("ออกจากระบบ", "Log out")}</button>
              <div className="stn-login-foot">
                <span className="stn-link-normal" style={{ cursor: leaving ? "wait" : "pointer" }} onClick={goAdmin}>
                  {leaving ? t("กำลังออกจากระบบ…", "Signing out…") : t("ไปหน้าแอดมิน (ออกจากบัญชีนี้ แล้วเข้าด้วยบัญชี Admin) →", "Go to admin (sign out, then sign in as Admin) →")}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  } else {
    content = <MachineStation user={user} onLogout={logout} onKicked={onKicked} onExpired={onExpired} dept={dept} />;
  }
  return <><StationUpdateBanner /><StationErrorBoundary onLogout={logout}>{content}</StationErrorBoundary><ConfirmHost /></>;
}
