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

// ── ขออนุญาตกล้อง "ครั้งเดียว" ล่วงหน้า ───────────────────────────────────
// เบราว์เซอร์บน https จะจำสิทธิ์กล้องต่อโดเมนอยู่แล้ว — ฟังก์ชันนี้ทริกให้ถามครั้งแรก
// ตั้งแต่ตอนล็อกอิน/แตะจอ แล้วครั้งต่อๆ ไป (รวมตอนกด SCAN) จะเข้ากล้องได้เลยไม่ถามซ้ำ
// ถ้าได้สิทธิ์แล้ว (granted) จะข้ามไป ไม่เปิดกล้องโดยไม่จำเป็น
let _camWarmed = false;
export async function warmCameraPermission() {
  if (_camWarmed) return;
  try {
    if (navigator.permissions?.query) {
      try {
        const st = await navigator.permissions.query({ name: "camera" });
        if (st.state === "granted") { _camWarmed = true; return; }   // ให้สิทธิ์แล้ว ไม่ต้องเปิด
        if (st.state === "denied") return;                            // ถูกปฏิเสธถาวร — ไปแก้ที่ตั้งค่าเบราว์เซอร์
      } catch { /* Permissions API ไม่รองรับ name:camera — ลอง getUserMedia ต่อ */ }
    }
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    s.getTracks().forEach((t) => t.stop());                          // ปิดกล้องทันที เก็บแค่สิทธิ์
    _camWarmed = true;
  } catch { /* ผู้ใช้ยังไม่กดอนุญาต/ปฏิเสธ → จะถูกถามอีกครั้งตอนกด SCAN */ }
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
