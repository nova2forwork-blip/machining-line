// ─── Offline support for the machine station (หน้าเครื่อง) ────────────────
// เป้าหมาย: ใช้งานได้แม้เน็ตหลุดยาว (หลายวัน)
//   1) แคชข้อมูลชิ้นงาน (part_units) ลง IndexedDB → สแกน QR ออฟไลน์แล้วเจอข้อมูล
//   2) เก็บ snapshot ความคืบหน้าต่อ release → running number ออฟไลน์ยังทำงาน
//   3) client_id (UUID) ต่อการบันทึก → กันข้อมูลซ้ำตอนซิงค์ (idempotency)
// ทุกฟังก์ชัน fail-safe: ถ้า IndexedDB มีปัญหา จะคืน null/ไม่พังแอป (ตกไปใช้ออนไลน์)

const DB_NAME = "mls-offline";
const DB_VER = 1;
const ST_UNITS = "units";       // key = qr_code → object (รูปเดียวกับ findUnitByQr)
const ST_KV = "kv";             // key/value ทั่วไป (snapshot ความคืบหน้า ฯลฯ)

let _dbPromise = null;
function db() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(ST_UNITS)) d.createObjectStore(ST_UNITS, { keyPath: "qr_code" });
        if (!d.objectStoreNames.contains(ST_KV)) d.createObjectStore(ST_KV);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve) => {
    if (!d) return resolve(null);
    try {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out = null;
      const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  }));
}

// ── UUID (idempotency key) ────────────────────────────────────────────────
// ต้องเป็นรูปแบบ UUID เสมอ เพราะฝั่ง DB คอลัมน์ client_id เป็น type uuid
// (ถ้าคืน string อื่น เช่นตอนเสิร์ฟผ่าน http ที่ crypto.randomUUID ไม่มี → insert พังทั้งหมด)
export function newClientId() {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); }        // มีใน insecure context (http) ด้วย
  catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40;              // version 4
  b[8] = (b[8] & 0x3f) | 0x80;              // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

// ── Unit cache (part_units) ───────────────────────────────────────────────
export function cacheUnit(unit) {
  if (!unit || !unit.qr_code) return Promise.resolve();
  return tx(ST_UNITS, "readwrite", (s) => s.put(unit));
}
export function cacheUnitsBulk(units) {
  return db().then((d) => new Promise((resolve) => {
    if (!d || !Array.isArray(units) || !units.length) return resolve();
    try {
      const t = d.transaction(ST_UNITS, "readwrite");
      const s = t.objectStore(ST_UNITS);
      for (const u of units) { if (u && u.qr_code) s.put(u); }
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
      t.onabort = () => resolve();
    } catch { resolve(); }
  }));
}
export function getCachedUnit(qr) {
  if (!qr) return Promise.resolve(null);
  return tx(ST_UNITS, "readonly", (s) => s.get(String(qr).trim()));
}
export function cachedUnitCount() {
  return tx(ST_UNITS, "readonly", (s) => s.count());
}

// ── Release progress snapshot (สำหรับ running number ออฟไลน์) ──────────────
export function setCachedProgress(releaseId, done) {
  if (!releaseId) return Promise.resolve();
  return tx(ST_KV, "readwrite", (s) => s.put({ done: Number(done) || 0, ts: Date.now() }, "prog:" + releaseId));
}
export function getCachedProgress(releaseId) {
  if (!releaseId) return Promise.resolve(0);
  return tx(ST_KV, "readonly", (s) => s.get("prog:" + releaseId)).then((v) => (v ? Number(v.done) || 0 : 0));
}

// ── Machine-day snapshot (สำหรับตาราง/ยอดวันออฟไลน์) ───────────────────────
export function setDaySnapshot(snap) {
  return tx(ST_KV, "readwrite", (s) => s.put({ snap, ts: Date.now() }, "machineDay"));
}
export function getDaySnapshot() {
  return tx(ST_KV, "readonly", (s) => s.get("machineDay")).then((v) => (v ? v.snap : null));
}
