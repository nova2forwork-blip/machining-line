// ─── Fullscreen helpers ───────────────────────────────────────────────────
// requestFullscreen ต้องถูกเรียกจาก "user gesture" (เช่นตอนกดปุ่มล็อกอิน/แตะจอ)
// เบราว์เซอร์บล็อกการเรียกเองตอนโหลดหน้า — จึงเรียกตอนล็อกอิน + ตอนแตะครั้งแรก
// ส่วนการเปิดแบบ PWA (Add to Home Screen) จะเต็มจอเองตั้งแต่เปิด (ดู manifest)

export function isStandalone() {
  try {
    return (
      window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true
    );
  } catch { return false; }
}

export function lockLandscape() {
  try {
    const p = screen.orientation?.lock?.("landscape");
    if (p && p.catch) p.catch(() => { /* iOS/desktop ไม่รองรับ — ใช้ CSS หมุนแทน */ });
  } catch { /* ignore */ }
}

export function enterFullscreen() {
  try {
    if (isStandalone()) { lockLandscape(); return; }   // เป็น PWA เต็มจออยู่แล้ว
    if (document.fullscreenElement) { lockLandscape(); return; }
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    const p = fn?.call(el);
    if (p && p.then) p.then(lockLandscape).catch(lockLandscape);   // ล็อกแนวนอนหลังเข้าเต็มจอ
    else lockLandscape();
  } catch { /* ignore — บางเบราว์เซอร์/บริบทไม่อนุญาต */ }
}

export function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen)?.call(document);
    } else {
      enterFullscreen();
    }
  } catch { /* ignore */ }
}

// ── ขออนุญาตกล้อง "ครั้งเดียวตอนเปิดครั้งแรก" ────────────────────────────────
// ปัญหาเดิม: ตัวจำอยู่ในหน่วยความจำ (รีเซ็ตทุกครั้งที่เปิดแอป) + บน iOS/Safari
//   Permissions API ไม่รองรับ name:"camera" เลยตกไปเรียก getUserMedia ใหม่ทุกครั้ง
//   → เด้งขออนุญาต "ทุกครั้งที่เปิดแอป"
// แก้: จำถาวรใน localStorage ว่า "เคยถามไปแล้ว" → เปิดครั้งต่อๆ ไปจะไม่ขอตอนเปิดอีก
//   (กล้องจะถูกขอเฉพาะ "ตอนกด SCAN จริง" เท่านั้น) ถ้าเบราว์เซอร์ยังจำสิทธิ์ได้ (https ทั่วไป)
//   ตอนกด SCAN ก็จะไม่ถามซ้ำอยู่แล้ว
const CAM_ASKED_KEY = "mls-cam-asked";
let _camWarmed = false;
function camAsked() { try { return localStorage.getItem(CAM_ASKED_KEY) === "1"; } catch { return false; } }
function markCamAsked() { try { localStorage.setItem(CAM_ASKED_KEY, "1"); } catch { /* ignore */ } }

export async function warmCameraPermission() {
  if (_camWarmed || camAsked()) { _camWarmed = true; return; }   // เคยถามแล้ว → ไม่ขอตอนเปิดอีก
  try {
    if (navigator.permissions?.query) {
      try {
        const st = await navigator.permissions.query({ name: "camera" });
        if (st.state === "granted") { _camWarmed = true; markCamAsked(); return; }
        if (st.state === "denied") { markCamAsked(); return; }
      } catch { /* iOS/Safari ไม่รองรับ name:camera — ไปขอครั้งเดียวด้านล่าง */ }
    }
    if (!navigator.mediaDevices?.getUserMedia) return;
    markCamAsked();   // ★ ทำเครื่องหมาย "ถามแล้ว" ก่อนขอ → ต่อให้ผู้ใช้กดปิด/ปฏิเสธ ก็ไม่ถามตอนเปิดอีก
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    s.getTracks().forEach((t) => t.stop());                        // ปิดกล้องทันที เก็บแค่สิทธิ์
    _camWarmed = true;
  } catch { /* ผู้ใช้ปฏิเสธ/ไม่มีกล้อง — กล้องจะถูกขออีกทีตอนกด SCAN เท่านั้น */ }
}

// ── สตรีมกล้องถาวร: เปิดครั้งเดียว ใช้ซ้ำทุกครั้งที่กด SCAN ────────────────────
// เดิม CameraScan เรียก getUserMedia + stop ทุกครั้งที่เปิด/ปิด → บางเครื่องเด้งขอสิทธิ์ซ้ำ
//   และกล้องหน่วง (เปิดฮาร์ดแวร์ใหม่) ทุกครั้ง
// แก้: เก็บสตรีมไว้ตัวเดียว เปิดครั้งแรกครั้งเดียว จากนั้นคืนตัวเดิมเสมอ — ปิดจริงตอนออกจากระบบ
let _sharedStream = null;
let _acquiring = null;
function _streamAlive(s) { return !!s && s.getVideoTracks?.().some((t) => t.readyState === "live"); }

// ลิสต์ "กล้องหลังทั้งหมด" (ตัดกล้องหน้าออก) — ใช้เปิดหลายตัวพร้อมกันแล้ว decode ขนานกัน
// label จะมีค่าก็ต่อเมื่อได้สิทธิ์กล้องแล้ว (เรียกหลังเปิดกล้องหลักสำเร็จ)
export async function listRearCameras() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs
      .filter((d) => d.kind === "videoinput" && !/front|user|face|selfie/i.test(d.label || ""))
      .map((d) => ({ deviceId: d.deviceId, label: d.label || "" }))
      .filter((c) => c.deviceId);
  } catch { return []; }
}

async function _acquireRearStream() {
  // เลือกกล้องหลังตัวหลัก (เลี่ยง ultrawide/tele) ถ้าทำได้ แล้ว fallback ไปตามลำดับ
  let id = null;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const back = devs.filter((d) => d.kind === "videoinput" && /back|rear|environment/i.test(d.label || ""));
    id = (back.find((d) => !/ultra|wide|tele|0\.5x/i.test(d.label || "")) || back[0])?.deviceId || null;
  } catch { /* ignore */ }
  const tries = [
    id ? { video: { deviceId: { exact: id } } } : null,
    { video: { facingMode: { exact: "environment" } } },
    { video: { facingMode: "environment" } },
  ].filter(Boolean);
  for (const c of tries) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch { /* ลองแบบถัดไป */ }
  }
  return null;
}

// คืนสตรีมกล้องที่ใช้ร่วมกัน — ถ้ายังเปิดอยู่คืนตัวเดิม (ไม่เรียก getUserMedia ซ้ำ)
export async function getSharedCameraStream() {
  if (_streamAlive(_sharedStream)) return _sharedStream;
  if (_acquiring) return _acquiring;                               // กันเรียกซ้อนตอนกำลังเปิด
  _acquiring = (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return null;
      markCamAsked();
      const s = await _acquireRearStream();
      _sharedStream = s;
      _camWarmed = !!s;
      if (s) refreshCamPermissionPersist();                        // เพิ่งได้สิทธิ์ → เช็คว่าจำได้ไหม (ไม่ต้องรอ)
      return s;
    } finally { _acquiring = null; }
  })();
  return _acquiring;
}

// ปิดกล้องถาวรจริงๆ (เรียกตอนออกจากระบบ/ปิดหน้าเครื่อง หรือ "พักกล้อง" ระหว่างสแกน
// เมื่อรู้ว่าเบราว์เซอร์จำสิทธิ์ได้) — หยุด track = ดับไฟกล้อง คืนทรัพยากร
export function releaseSharedCamera() {
  try { _sharedStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  _sharedStream = null;
}

// ── เบราว์เซอร์ "จำสิทธิ์กล้อง" ได้ไหม? ──────────────────────────────────────
// ถ้าจำได้ → ปิดสตรีม (ดับไฟกล้อง) ระหว่างสแกนได้เลย เพราะเปิดใหม่จะไม่ถามสิทธิ์ซ้ำ
//   • Permissions API = 'granted' (Android/เดสก์ท็อป Chrome ฯลฯ) → จำได้แน่นอน
//   • ติดตั้งเป็นแอป (standalone/PWA) → จำได้ (รวม iOS ที่ Permissions API ไม่รองรับ camera)
//   • แท็บ Safari บน iOS (ไม่ได้ติดตั้งเป็นแอป) → จำข้าม stop() ไม่ได้ → ต้องคงสตรีมไว้กันถามซ้ำ
let _permPersists = false;
export function camPermissionPersists() { return _permPersists || isStandalone(); }
export async function refreshCamPermissionPersist() {
  try {
    if (navigator.permissions?.query) {
      const st = await navigator.permissions.query({ name: "camera" });
      _permPersists = (st.state === "granted");
      try { st.onchange = () => { _permPersists = (st.state === "granted"); }; } catch { /* ignore */ }
    }
  } catch { _permPersists = false; }   // iOS/Safari ไม่รองรับ name:camera → พึ่ง isStandalone แทน
}

// เรียกเต็มจอตอนผู้ใช้แตะจอครั้งแรก (fallback สำหรับคนที่ล็อกอินค้างไว้ ไม่มี gesture ตอนโหลด)
// คืนฟังก์ชัน cleanup
export function armFullscreenOnFirstTap() {
  if (typeof window === "undefined" || isStandalone()) return () => {};
  const handler = () => { enterFullscreen(); cleanup(); };
  const cleanup = () => {
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("touchend", handler);
    window.removeEventListener("keydown", handler);
  };
  window.addEventListener("pointerdown", handler);
  window.addEventListener("touchend", handler);
  window.addEventListener("keydown", handler);
  return cleanup;
}
