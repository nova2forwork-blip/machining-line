// สะพานให้ pytest เรียกฟังก์ชันคำนวณของแอป (src/release/releaseCore.js · orderSheet.js) ผ่าน node
// ใช้: node tests/js_bridge.mjs <ไฟล์ JSON ของ steps>  → พิมพ์ JSON ผลลัพธ์ทีละ step
//   step = { m: "core" | "order", fn: "ชื่อฟังก์ชัน", args: [...] }  ·  หลาย step ในโปรเซสเดียว = ใช้สถานะร่วมกันได้ (เช่น setMatLens แล้ว stockLen)
//   ค่าพิเศษ: { "$map": [[k, v], …] } = Map · { "$set": [...] } = Set · { "$ref": n } = ผลของ step ที่ n (เริ่ม 0)
// โค้ดของแอปไม่มี "type": "module" ใน package.json → คัดลอกเป็น .mjs ชั่วคราวก่อน import (ไม่แก้ไฟล์ใน src/)
import fs from "fs"; import os from "os"; import path from "path"; import { pathToFileURL, fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "src", "release");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mls-pytest-"));
fs.copyFileSync(path.join(src, "releaseCore.js"), path.join(tmp, "releaseCore.mjs"));
fs.writeFileSync(path.join(tmp, "orderSheet.mjs"), fs.readFileSync(path.join(src, "orderSheet.js"), "utf8").replace(/"\.\/releaseCore\.js"/g, '"./releaseCore.mjs"'));

fs.copyFileSync(path.join(src, "..", "containerPlan.js"), path.join(tmp, "containerPlan.mjs"));   // แผนลงตู้ (m: "cp")
fs.copyFileSync(path.join(src, "..", "packExport.js"), path.join(tmp, "packExport.mjs"));         // ส่งออกแผนแพ็ก (m: "px")

const mods = { core: await import(pathToFileURL(path.join(tmp, "releaseCore.mjs")).href), order: await import(pathToFileURL(path.join(tmp, "orderSheet.mjs")).href),
  cp: await import(pathToFileURL(path.join(tmp, "containerPlan.mjs")).href), px: await import(pathToFileURL(path.join(tmp, "packExport.mjs")).href) };
const steps = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).steps || [];
const out = [];
const dec = (v) => {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === "object") {
    if ("$map" in v) return new Map(v.$map.map(([k, x]) => [dec(k), dec(x)]));
    if ("$set" in v) return new Set(v.$set.map(dec));
    if ("$ref" in v) return out[v.$ref].raw;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]));
  }
  return v;
};
const enc = (k, v) => (v instanceof Map ? { $map: [...v] } : v instanceof Set ? { $set: [...v] } : typeof v === "function" ? undefined : v === undefined ? null : typeof v === "number" && !Number.isFinite(v) ? null : v);
for (const s of steps) {
  try {
    const f = mods[s.m || "core"][s.fn];
    if (s.get) { out.push({ ok: true, raw: f }); continue; }                 // ค่าคงที่ที่ export (เช่น KERF)
    if (typeof f !== "function") throw new Error(`ไม่มีฟังก์ชัน ${s.m || "core"}.${s.fn}`);
    out.push({ ok: true, raw: f(...dec(s.args || [])) });
  } catch (e) { out.push({ ok: false, error: String(e && e.message || e) }); }
}
process.stdout.write(JSON.stringify(out.map((o) => (o.ok ? { ok: true, value: o.raw } : o)), enc));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
