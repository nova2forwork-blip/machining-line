// ─── Service worker: เปิดแอปได้แม้ไม่มีเน็ต (app shell caching) ────────────
// กลยุทธ์:
//   • navigation (โหลดหน้า) = network-first, ออฟไลน์ค่อย fallback เป็น index.html ที่แคชไว้
//   • static assets (js/css/รูป ที่ชื่อไฟล์มี hash จาก Vite) = cache-first (ปลอดภัยเพราะ
//     deploy ใหม่ = ชื่อไฟล์ใหม่ ของเก่าไม่ชนกัน)
//   • คำขอไป Supabase / ต่างโดเมน = ปล่อยผ่าน ไม่แคช (ข้อมูลสด/POST ต้องออนไลน์)
const CACHE = "mls-shell-v3";   // ★ bump = activate จะลบแคชเก่า (กัน chunk ค้างไม่ตรงเวอร์ชัน → React #130)
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       // POST/PUT (RPC) = ปล่อยผ่าน
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Supabase/ต่างโดเมน = ปล่อยผ่าน (ไม่แคช)
  // คำขอตรวจเวอร์ชัน (/?_v=timestamp) มี query ไม่ซ้ำทุกครั้ง — ปล่อยผ่าน ไม่แคช
  // (ไม่งั้นสะสมเป็น entry ใหม่ทุก 5 นาที ไม่มีลบ = storage บวมบนจอเปิดทั้งวัน)
  if (url.search.includes("_v=")) return;

  // โหลดหน้า (SPA) → network-first, ออฟไลน์ใช้ index.html จากแคช
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        // เก็บเป็น app shell เฉพาะเมื่อโหลดสำเร็จจริง (res.ok) — กันหน้า error 4xx/5xx
        // ตอน deploy ถูกแคชแล้วเสิร์ฟเป็นหน้าแอปค้างไปเรื่อยๆ
        // ★ 2026-10-10: clone "ทันที" ก่อนส่ง res ให้หน้าเว็บ — เดิม clone ใน then ของ caches.open (ทีหลัง)
        //   ตอนนั้นหน้าเว็บอ่าน body ไปแล้ว → clone() พัง (body used) เงียบๆ → index.html ในแคชไม่เคยอัปเดต
        //   → ออฟไลน์เปิดได้แต่ "เวอร์ชันตอนติดตั้งครั้งแรก" ตลอด (ออนไลน์ปกติ ออฟไลน์เป็นหน้าเก่า)
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => Promise.all([c.put("/index.html", copy.clone()), c.put("/", copy)])).catch(() => {}));
        }
        return res;
      }).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // asset อื่นๆ (มี hash) → cache-first, ถ้าไม่มีค่อยดึงเน็ตแล้วเก็บ
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit)
    )
  );
});
