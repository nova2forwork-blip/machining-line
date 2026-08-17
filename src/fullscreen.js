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
