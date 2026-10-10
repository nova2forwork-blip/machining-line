// ─── Service worker: เปิดแอปได้แม้ไม่มีเน็ต (app shell caching) ────────────
// กลยุทธ์:
//   • navigation (โหลดหน้า) = network-first (รอเน็ตไม่เกิน NAV_TIMEOUT ถ้ามีหน้าในแคชแล้ว)
//     ออฟไลน์/เน็ตช้า/เซิร์ฟเวอร์ 5xx → ใช้ index.html ที่แคชไว้
//   • ★ 2026-10-10 (อัปเดตแบบ "ทั้งชุด"): index.html ตัวใหม่จะถูกเก็บลงแคช "หลังจาก" เก็บไฟล์ JS/CSS
//     ทุกตัวที่มันอ้างถึง (รวม chunk ที่โหลดทีหลัง เช่นหน้าเครื่อง/หน้าสำนักงาน) ครบแล้วเท่านั้น
//     → ถ้าเน็ตหลุดกลางทาง แคชยังเป็นเวอร์ชันเดิมที่ครบชุด (ไม่ใช่หน้าใหม่ที่ไฟล์ประกอบไม่ครบ = จอขาว)
//   • static assets (/assets/* มี hash จาก Vite) = cache-first · เก็บเฉพาะไฟล์ที่ชนิดถูก
//     (Vercel rewrite ไฟล์ที่ไม่มีจริงเป็น index.html — ห้ามเก็บ HTML แทน .js)
//   • ไฟล์อื่นในโดเมนเดียวกัน (ไอคอน/manifest) = ใช้แคชก่อน แล้วอัปเดตเบื้องหลัง
//   • คำขอไป Supabase / ต่างโดเมน / POST = ปล่อยผ่าน ไม่แคช
//   • ลบไฟล์ /assets เก่า: เก็บไว้ 2 เวอร์ชัน (ปัจจุบัน + ก่อนหน้า — แท็บที่ยังเปิดเวอร์ชันเก่าอยู่ใช้ต่อได้)
//   ★ 2026-10-10 ตรวจรอบ 2 (รอบตรวจ): ตรวจชนิดไฟล์ตอน "เสิร์ฟ/ใช้จากแคช" ด้วย (ของเสียจาก sw รุ่นเก่า = ทิ้งแล้วดึงใหม่)
//     · ยังไม่มี META (เพิ่งอัปจาก sw รุ่นเก่าที่ index.html ค้างเก่ามาก) = ไม่ใช้กติกา 5 วิ (รอเน็ต · ใช้แคชเมื่อเน็ตล่ม/5xx)
//     · หน้า HTML จากเน็ตเป็น "เวอร์ชันใหม่" ที่ไฟล์ยังเก็บไม่ครบ → รอเก็บให้ครบภายในเวลาที่เหลือ · ไม่ทัน = เปิดตัวเดิมที่ครบชุด
//       (เดิมเปิดหน้าใหม่ทันที → Wi-Fi โรงงานกระตุก ไฟล์ JS โหลดไม่ขึ้น → จอขาว/ตัวกู้ล้างแคชทิ้ง)
//     · chunk ที่มี hash หาย (deploy ใหม่ระหว่างเก็บ) = ไม่ยอมรับชุดนั้น · ลิงก์ลึกไม่มี hash ที่แกะผิด = ข้ามไม่จด (ไม่วนเก็บซ้ำทุก 10 นาที)
//     · หน้าเว็บสั่ง "เก็บเวอร์ชันล่าสุดให้ครบก่อน" ได้ (message mls-install-latest) → แถบ "มีเวอร์ชันใหม่" ขึ้นเมื่อเก็บครบแล้ว กดอัปเดตเปิดได้ทันที
const CACHE = "mls-shell-v3";   // ★ bump = activate จะลบแคชเก่า (กัน chunk ค้างไม่ตรงเวอร์ชัน → React #130)
const META = "/__mls-shell-meta";          // บันทึกว่า shell ในแคชคือเวอร์ชันไหน + ไฟล์ที่ใช้
const NAV_TIMEOUT = 5000;                  // ms — มีหน้าในแคชแล้ว รอเน็ตไม่เกินนี้ (เน็ตโรงงานช้า/ค้าง)
const MAX_ASSETS = 400;                    // กันวนไม่รู้จบถ้าแกะลิงก์ผิด

// ── หาไฟล์ใน /assets ที่ข้อความ (HTML/JS/CSS) อ้างถึง ──
//    ต้องอยู่ในเครื่องหมายคำพูด/วงเล็บเต็มๆ เช่น "/assets/x.js" "assets/x.css" "./x.js" url(/assets/x.woff2)
//    (กันข้อความทั่วไปในไลบรารีที่บังเอิญมีคำว่า assets/ ถูกนับเป็นไฟล์)
const EXT = "(?:m?js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|ico|wasm)";
const ABS_RE = new RegExp("[\"'`(]\\/?assets\\/([A-Za-z0-9_.-]+\\." + EXT + ")[\"'`)]", "g");
const REL_RE = new RegExp("[\"'`(]\\.\\/([A-Za-z0-9_.-]+\\." + EXT + ")[\"'`)]", "g");
function refsIn(text, fromAsset) {
  const out = new Set();
  for (const m of text.matchAll(ABS_RE)) out.add("/assets/" + m[1]);
  if (fromAsset) for (const m of text.matchAll(REL_RE)) out.add("/assets/" + m[1]);   // "./X.js" ใน chunk = โฟลเดอร์เดียวกัน
  return [...out];
}
function mainScript(html) {
  const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i) || html.match(/<script[^>]+src="([^"]+)"[^>]+type="module"/i);
  return m ? m[1] : "";
}
// ชนิดไฟล์ต้องตรงนามสกุล — กันเก็บหน้า index.html (rewrite) แทนไฟล์ .js ที่หายไป
function typeOk(res, path) {
  if (!res || !res.ok || res.type !== "basic") return false;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (/\.m?js$/.test(path)) return ct.includes("javascript") || ct.includes("ecmascript");
  if (/\.css$/.test(path)) return ct.includes("text/css");
  return !ct.includes("text/html");
}
const isHtml = (res) => (res.headers.get("content-type") || "").toLowerCase().includes("text/html");
// ของในแคช: ดูแค่ชนิดไฟล์ (response ที่เก็บไว้ไม่ใช่ type "basic" เสมอไป)
function cachedTypeOk(res, path) {
  if (!res) return false;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (/\.m?js$/.test(path)) return ct.includes("javascript") || ct.includes("ecmascript");
  if (/\.css$/.test(path)) return ct.includes("text/css");
  return !ct.includes("text/html");
}
const HASHED = /-[A-Za-z0-9_-]{8}\.(?:m?js|css)$/;   // ไฟล์ที่ Vite ใส่ hash = ของจริงของเวอร์ชันนั้น (หาย = ชุดไม่ครบ)

async function readMeta(c) {
  try { const r = await c.match(META); return r ? await r.json() : null; } catch { return null; }
}

// เก็บ shell ใหม่ "ทั้งชุด": ไฟล์ประกอบครบก่อน → ค่อยแทน index.html → บันทึก meta → ลบไฟล์เก่า
async function installShell(html) {
  const sig = mainScript(html);
  if (!sig) return;                                    // ไม่ใช่หน้าแอป (เช่นหน้า error) → ไม่แตะแคช
  const c = await caches.open(CACHE);
  const meta = await readMeta(c);
  const retryMissing = meta && meta.missing && meta.missing.length && Date.now() - (meta.at || 0) > 10 * 60 * 1000;
  if (meta && meta.sig === sig && meta.html === html && !retryMissing && (await c.match("/index.html"))) return;   // เวอร์ชันเดิม ครบอยู่แล้ว

  const direct = new Set(refsIn(html, false));         // ไฟล์ที่ index.html อ้างตรงๆ (entry/CSS) = ต้องมีครบ
  const seen = new Set();
  const missing = [];
  const queue = [...direct];
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    if (seen.size > MAX_ASSETS) throw new Error("too many assets");
    let res = await c.match(p);
    if (res && !cachedTypeOk(res, p)) { await c.delete(p); res = null; }   // ของเสียจาก sw รุ่นเก่า (HTML แทน .js)
    if (!res) {
      const r = await fetch(p, { cache: "no-cache", credentials: "same-origin" });   // เน็ตหลุด = throw → ไม่แทน shell เดิม
      if (!typeOk(r, p)) {
        // เซิร์ฟเวอร์ตอบว่าไม่มีไฟล์นี้ (404 / rewrite เป็น HTML)
        if (direct.has(p) || HASHED.test(p) || r.status >= 500 || !r.ok && r.status !== 404) throw new Error("asset missing: " + p);
        continue;                                       // ลิงก์ลึกไม่มี hash ที่แกะผิด (เช่น ./v1.js ในไลบรารี) — ข้าม ไม่จด
      }
      await c.put(p, r.clone());
      res = r;
    }
    if (/\.(m?js|css)$/.test(p)) {
      const t = await res.text();
      for (const q of refsIn(t, true)) if (!seen.has(q)) queue.push(q);
    }
  }

  // ไฟล์ประกอบครบแล้ว → แทนหน้าแอป (สองคีย์ "/" และ "/index.html" เป็นเวอร์ชันเดียวกันเสมอ)
  const headers = { "content-type": "text/html; charset=utf-8" };
  await c.put("/index.html", new Response(html, { headers }));
  await c.put("/", new Response(html, { headers }));
  const assets = [...seen].filter((p) => !missing.includes(p));
  const prev = meta && meta.sig !== sig ? (meta.assets || []) : (meta && meta.prev) || [];
  await c.put(META, new Response(JSON.stringify({ sig, html, assets, prev, missing, at: Date.now() }), { headers: { "content-type": "application/json" } }));

  // ลบไฟล์ /assets ที่ไม่ใช่ของเวอร์ชันปัจจุบัน/ก่อนหน้า
  // (แคชจาก sw ตัวเก่าที่ยังไม่มี meta = ยังไม่รู้ว่าไฟล์ไหนของใคร → รอบนี้ยังไม่ลบ)
  if (!meta) return;
  const keep = new Set([...assets, ...prev]);
  const keys = await c.keys();
  await Promise.all(keys.map((k) => {
    const u = new URL(k.url);
    return u.pathname.startsWith("/assets/") && !keep.has(u.pathname) ? c.delete(k) : null;
  }));
}
// ทำทีละรอบ (หลายแท็บโหลดพร้อมกัน → ไม่ชนกันตอนลบไฟล์)
let _lock = Promise.resolve();
function installShellLocked(html) {
  const run = _lock.then(() => installShell(html));
  _lock = run.catch(() => {});
  return run;
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      try { const m = await fetch("/manifest.webmanifest", { cache: "no-cache" }); if (m.ok && m.type === "basic") await c.put("/manifest.webmanifest", m); } catch { /* ignore */ }
      const r = await fetch("/", { cache: "no-cache", credentials: "same-origin" });
      if (r.ok && r.type === "basic" && isHtml(r)) await installShellLocked(await r.text());
    } catch { /* ออฟไลน์ตอนติดตั้ง = ไว้เก็บตอนโหลดหน้าครั้งถัดไป */ }
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const cachedShell = () => caches.match("/index.html").then((r) => r || caches.match("/"));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       // POST/PUT (RPC) = ปล่อยผ่าน
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Supabase/ต่างโดเมน = ปล่อยผ่าน (ไม่แคช)
  // คำขอตรวจเวอร์ชัน (/?_v=timestamp) มี query ไม่ซ้ำทุกครั้ง — ปล่อยผ่าน ไม่แคช
  // (ไม่งั้นสะสมเป็น entry ใหม่ทุก 5 นาที ไม่มีลบ = storage บวมบนจอเปิดทั้งวัน)
  if (url.search.includes("_v=")) return;
  if (url.pathname === "/sw.js" || url.pathname === META) return;

  // ── โหลดหน้า (SPA) ──
  if (req.mode === "navigate") {
    // เก็บ shell ใหม่เบื้องหลัง — ผูก waitUntil ตั้งแต่ต้น (ทำต่อได้แม้หน้าได้ shell จากแคชไปแล้วเพราะเน็ตช้า)
    let bgDone;
    e.waitUntil(new Promise((r) => { bgDone = r; }));
    let installP = null;                                // true = ชุดของหน้านี้อยู่ในแคชครบแล้ว
    const net = fetch(req).then((res) => {
      // clone "ทันที" ก่อนส่ง res ให้หน้าเว็บ (ถ้า clone ทีหลัง body ถูกอ่านไปแล้ว → clone พังเงียบๆ)
      if (res && res.ok && res.type === "basic" && isHtml(res)) {
        installP = res.clone().text().then(installShellLocked).then(() => true, () => false);
        bgDone(installP);
      } else bgDone();
      return res;
    }, (err) => { bgDone(); throw err; });
    e.respondWith((async () => {
      const cached = await cachedShell();
      if (!cached) return net;                            // ยังไม่มีแคช = ต้องรอเน็ตอย่างเดียว
      const meta = await caches.open(CACHE).then(readMeta).catch(() => null);
      // ยังไม่มี META = แคชจาก sw รุ่นเก่า (index.html อาจเก่ามาก) → รอเน็ต ไม่ตัด 5 วิ · ใช้แคชเมื่อเน็ตล่ม/5xx เท่านั้น
      const limit = meta ? NAV_TIMEOUT : 60000;
      const t0 = Date.now();
      let timer;
      const timeout = (ms) => new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, ms)); });
      try {
        const res = await Promise.race([net, timeout(limit)]);
        clearTimeout(timer);
        if (!res) return cached;                          // เน็ตช้าเกิน → เปิดจากแคชไปก่อน (เบื้องหลังยังอัปเดตต่อ)
        if (res.status >= 500) return cached;             // เซิร์ฟเวอร์พัง/กำลัง deploy → ใช้ตัวที่แคชไว้
        if (meta && installP) {
          // หน้าเวอร์ชันใหม่ที่ไฟล์ยังเก็บไม่ครบ → รอเก็บให้ครบในเวลาที่เหลือ · ไม่ทัน/ไม่สำเร็จ = เปิดตัวเดิมที่ครบชุด
          const okNow = await Promise.race([installP, timeout(limit - (Date.now() - t0))]);
          clearTimeout(timer);
          if (!okNow) return cached;
        }
        return res;
      } catch {
        return cached;                                    // ออฟไลน์
      } finally { clearTimeout(timer); }
    })());
    return;
  }

  // ── /assets/* (มี hash) → cache-first, ไม่มีค่อยดึงเน็ตแล้วเก็บ (เฉพาะชนิดไฟล์ถูก) ──
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then(async (hit) => {
        if (hit && !cachedTypeOk(hit, url.pathname)) {   // ของเสีย (HTML ที่ sw รุ่นเก่าเก็บแทน .js) → ทิ้งแล้วดึงใหม่
          await caches.open(CACHE).then((c) => c.delete(req)).catch(() => {});
          hit = null;
        }
        return hit ||
        fetch(req).then((res) => {
          if (typeOk(res, url.pathname)) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
          }
          return res;
        });
      })
    );
    return;
  }

  // ── ไฟล์อื่น (ไอคอน/manifest — ชื่อไม่มี hash) → ใช้แคชก่อน + อัปเดตเบื้องหลัง ──
  e.respondWith(
    caches.match(req).then((hit) => {
      const upd = fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic" && !isHtml(res)) {
          const copy = res.clone();
          return caches.open(CACHE).then((c) => c.put(req, copy)).then(() => res, () => res);
        }
        return res;
      });
      if (hit) { e.waitUntil(upd.catch(() => {})); return hit; }
      return upd;
    })
  );
});

// ── หน้าเว็บสั่ง "เก็บเวอร์ชันล่าสุดให้ครบ" (updatePrompt.js เมื่อเจอเวอร์ชันใหม่) → ตอบกลับเมื่อเสร็จ ──
//   แถบ "มีเวอร์ชันใหม่" จะขึ้นหลังเก็บครบ → กดอัปเดตแล้วเปิดเวอร์ชันใหม่ได้ทันที แม้เน็ตช้า/หลุดหลังจากนั้น
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type !== "mls-install-latest") return;
  const port = e.ports && e.ports[0];
  e.waitUntil((async () => {
    let ok = false;
    try {
      const r = await fetch("/", { cache: "no-cache", credentials: "same-origin" });
      if (r.ok && r.type === "basic" && isHtml(r)) { await installShellLocked(await r.text()); ok = true; }
    } catch { ok = false; }
    try { if (port) port.postMessage({ ok }); } catch { /* ignore */ }
  })());
});
