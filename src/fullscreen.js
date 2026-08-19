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
