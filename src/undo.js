// ══ Ctrl+Z / Ctrl+Y ทั้งแอป (2026-11-04 · ผู้ใช้: "ทุกอย่างให้สามารถ Ctrl+Z ย้อนกลับได้") ══
//   ทะเบียนกลาง: ทุกจุดที่แก้ได้ลงทะเบียน "ตัวย้อน" ไว้ → กด Ctrl/Cmd+Z = ย้อนจุดที่แก้ล่าสุด
//   Ctrl+Y หรือ Ctrl+Shift+Z = ทำซ้ำ (redo) · สูงสุด 100 ขั้นต่อจุด
//   • กำลังพิมพ์ในช่องข้อความ → ปล่อยให้เบราว์เซอร์ย้อนตัวอักษรเอง (ออกจากช่องแล้วกด = ย้อนทั้งขั้น)
//   • หน้าที่มีตัวย้อนของตัวเองอยู่แล้ว (ตัวสร้าง Release / ตาราง Address) เรียก preventDefault → ตัวกลางไม่ทำซ้ำ
//   • มี modal เปิด → ย้อนได้เฉพาะสิ่งที่แก้หลัง modal เปิด (กันเผลอย้อนหน้าหลัง)
//   ของที่บันทึกลงฐานข้อมูลเป็นรายการใหม่ (ปล่อยล็อต / สร้าง QR / Modify / ลบ) ย้อนด้วยปุ่มของมันเอง ไม่ใช่ Ctrl+Z
import { useCallback, useEffect, useRef, useState } from "react";

const MAX = 100;
const undoers = [];          // ท้ายสุด = แก้ล่าสุด
let seq = 0;
const modalGates = [];
let installed = false;
const notify = (text) => { try { window.dispatchEvent(new CustomEvent("mls-toast", { detail: { text, tone: "info" } })); } catch { /* ignore */ } };

// modal เปิด → เรียก pushUndoGate() · ปิด → เรียกฟังก์ชันที่คืนมา
export function pushUndoGate() { const g = seq; modalGates.push(g); return () => { const i = modalGates.lastIndexOf(g); if (i >= 0) modalGates.splice(i, 1); }; }

function isTextTarget(a) {
  const tag = a && a.tagName;
  return (tag === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|file|color)$/i.test(a.type || "")) || tag === "TEXTAREA" || !!(a && a.isContentEditable);
}
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key || "").toLowerCase();
    const isUndo = k === "z" && !e.shiftKey, isRedo = (k === "z" && e.shiftKey) || k === "y";
    if (!isUndo && !isRedo) return;
    if (isTextTarget(document.activeElement)) return;      // เบราว์เซอร์ย้อนตัวอักษรเอง
    // รอให้ตัวจัดการของหน้านั้น (ตัวสร้าง Release / ตาราง Address) ทำก่อน — ถ้ามันเรียก preventDefault แล้ว = ไม่ทำซ้ำ
    setTimeout(() => {
      if (e.defaultPrevented) return;
      const gate = modalGates.length ? modalGates[modalGates.length - 1] : -1;
      for (let i = undoers.length - 1; i >= 0; i--) {
        const u = undoers[i];
        if ((u.seq || 0) <= gate) continue;
        if (isUndo ? u.canUndo() : u.canRedo()) {
          const label = isUndo ? u.undo() : u.redo();
          if (label === false) return;   // ขั้นพิเศษ (ย้อน M) บอกผลเอง
          notify(`${isUndo ? "↶ ย้อนแล้ว" : "↷ ทำซ้ำแล้ว"}${label ? ": " + label : ""}${isUndo ? " · Ctrl+Y = ทำซ้ำ" : ""}`);
          return;
        }
      }
      if (undoers.some((u) => u.seq)) notify(isUndo ? "ไม่มีอะไรให้ย้อนแล้ว" : "ไม่มีอะไรให้ทำซ้ำ");
    }, 0);
  }, true);
}
function touch(api) {
  const i = undoers.indexOf(api); if (i >= 0) undoers.splice(i, 1);
  undoers.push(api); api.seq = ++seq;
  try { window.dispatchEvent(new Event("mls-undo-available")); } catch { /* ignore */ }
}
function useRegister(api) {
  useEffect(() => {
    install();
    undoers.push(api);
    return () => { const i = undoers.indexOf(api); if (i >= 0) undoers.splice(i, 1); };
  }, [api]);
}

// ── useState ที่ย้อน/ทำซ้ำได้ (ฟอร์ม / ตารางในหน้าจอ ที่ยังไม่บันทึก) ──
//   label = ข้อความใน toast · coalesceMs = แก้ต่อเนื่องเร็ว ๆ (เช่นพิมพ์) รวมเป็นขั้นเดียว
export function useUndoState(initial, { label = "", coalesceMs = 0 } = {}) {
  const [state, setState] = useState(initial);
  const h = useRef({ past: [], future: [], last: 0 });
  const api = useRef(null); if (!api.current) api.current = {};
  const cur = useRef(state); cur.current = state;
  const set = useCallback((updater) => {
    touch(api.current);
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next === prev) return prev;
      const now = Date.now();
      if (!(coalesceMs && now - h.current.last < coalesceMs && h.current.past.length)) h.current.past = [...h.current.past, prev].slice(-MAX);
      h.current.last = now; h.current.future = [];
      return next;
    });
  }, [coalesceMs]);
  const a = api.current;
  a.canUndo = () => h.current.past.length > 0;
  a.canRedo = () => h.current.future.length > 0;
  a.undo = () => { const p = h.current.past.pop(); h.current.future.push(cur.current); h.current.last = 0; setState(p); return label; };
  a.redo = () => { const n = h.current.future.pop(); h.current.past.push(cur.current); h.current.last = 0; setState(n); return label; };
  useRegister(a);
  const reset = useCallback(() => { h.current = { past: [], future: [], last: 0 }; }, []);
  return [state, set, reset];
}

// ── ประวัติของ "ค่าที่บันทึกอัตโนมัติ" (เช่นแผน Release) ──
//   ใช้: const hist = useUndoHistory(apply, label) · ก่อนเปลี่ยนเรียก hist.record(ค่าเดิม, ค่าใหม่)
//   ย้อน = เรียก apply(ค่าเดิม) (ซึ่งบันทึกลงฐานข้อมูลให้ด้วย) · hist.reset() เมื่อค่าถูกแทนด้วยงานที่ย้อนไม่ได้ (ปล่อยล็อต / Modify)
//   ★ 2026-11-12 ขั้นพิเศษ (เช่น บันทึกเป็น M): record(ค่าเดิม, ค่าใหม่, step) · step = { undo: async () => true/false, redo?: async () => true/false }
//     ย้อนขั้นนี้ = เรียก step.undo() (ถามยืนยัน / ยกเลิกในฐานข้อมูลเอง · คืน false = ไม่ได้ย้อน → ขั้นยังอยู่) · ไม่มี step.redo = ทำซ้ำไม่ได้
//     ขั้นพิเศษไม่รวมกับขั้นอื่น (coalesce) · ระหว่างกำลังย้อนขั้นพิเศษ กด Ctrl+Z/Y ซ้ำไม่มีผล
export function useUndoHistory(apply, label = "", coalesceMs = 1000) {
  const h = useRef({ past: [], future: [], last: 0, cur: undefined, busy: false });
  const ap = useRef(apply); ap.current = apply;
  const lb = useRef(label); lb.current = label;
  const api = useRef(null); if (!api.current) api.current = {};
  const a = api.current;
  // กำลังย้อนขั้นพิเศษ (รอถามยืนยัน / ฐานข้อมูล) → รับปุ่มไว้เฉย ๆ ไม่ให้ไปย้อนจุดอื่นแทน
  a.canUndo = () => h.current.past.length > 0 || h.current.busy;
  a.canRedo = () => h.current.future.length > 0 || h.current.busy;
  const say = (to, from) => (typeof lb.current === "function" ? lb.current(to, from) : lb.current);
  // past / future = [{ v: ค่าอีกฝั่ง, step? }]
  const runStep = (fn, onOk) => {
    const H = h.current; H.busy = true;
    Promise.resolve().then(fn).then((ok) => { if (h.current === H && ok) onOk(); }, () => {}).finally(() => { H.busy = false; });
    return false;   // toast ให้ step บอกเอง
  };
  a.undo = () => {
    if (h.current.busy) return false;
    const H = h.current; const e = H.past[H.past.length - 1];
    if (e.step) return runStep(e.step.undo, () => { H.past.pop(); const c = H.cur; H.cur = e.v; H.last = 0; if (e.step.redo) H.future.push({ v: c, step: e.step }); else H.future = []; });
    H.past.pop(); const c = H.cur; H.future.push({ v: c }); H.cur = e.v; H.last = 0; ap.current(e.v); return say(e.v, c);
  };
  a.redo = () => {
    if (h.current.busy) return false;
    const H = h.current; const e = H.future[H.future.length - 1];
    if (e.step) return runStep(e.step.redo, () => { H.future.pop(); const c = H.cur; H.cur = e.v; H.last = 0; H.past.push({ v: c, step: e.step }); });
    H.future.pop(); const c = H.cur; H.past.push({ v: c }); H.cur = e.v; H.last = 0; ap.current(e.v); return say(e.v, c);
  };
  useRegister(a);
  const record = useCallback((prev, next, step = null) => {
    touch(a);
    const H = h.current; const now = Date.now(); const top = H.past[H.past.length - 1];
    if (step || !(coalesceMs && now - H.last < coalesceMs && top && !top.step)) H.past = [...H.past, step ? { v: prev, step } : { v: prev }].slice(-MAX);
    H.last = step ? 0 : now; H.future = []; H.cur = next;
  }, [a, coalesceMs]);
  const reset = useCallback(() => { h.current = { past: [], future: [], last: 0, cur: undefined, busy: false }; }, []);
  return { record, reset };
}

// ข้อความบอกว่าย้อนอะไร (แผน Release) — เทียบฟิลด์ที่ต่างกัน
const PLAN_FIELDS = [["matOv", "เปลี่ยนวัสดุ"], ["matSwap", "ใช้เบอร์วัสดุแทน"], ["destOv", "ใบงานของพาร์ท"], ["procOv", "งานของซับ"], ["catOv", "หมวดพาร์ท"],
  ["partMode", "โหมดหมวดพาร์ท"], ["partGroups", "หมวดพาร์ท"], ["matIssue", "ยอดเบิกจริง"], ["lotIssue", "ยอดเบิกของล็อต"], ["sheetEdit", "แก้ใบปล่อย"], ["bom", "BOM"], ["units", "ที่อยู่ / แผง"]];
export function planChangeLabel(a, b) {
  const s = (x) => JSON.stringify(x === undefined ? null : x);
  const hit = PLAN_FIELDS.filter(([k]) => s((a || {})[k]) !== s((b || {})[k])).map(([, t]) => t);
  const ro = (a || b || {}).ro || "";
  return `${[...new Set(hit)].join(" · ") || "แก้ไข"}${ro ? ` (${ro})` : ""}`;
}
