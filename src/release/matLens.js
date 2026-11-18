// ★ 2026-11-18 ผู้ใช้: "ความยาวเส้นที่กรอกในหน้า บันทึก Material ควรไหลเข้า Total Mat."
//   โหลด "ความยาว/เส้น" ของวัตถุดิบ (ของโปรเจค มาก่อน Center Stock) แล้วเก็บในทะเบียนของ releaseCore (setMatLens)
//   → needOf / stockLen ใช้เป็นความยาวเส้นเมื่อพาร์ทไม่ได้ระบุความยาวเส้นเองในใบ
//   ลำดับความยาวเส้น: ที่ใส่ในใบ (Stock L) > ของพาร์ทอื่นที่ใช้ INV เดียวกันในใบ > หน้า บันทึก Material > อ่านจากรหัส INV > ค่าเริ่ม
import { useEffect, useState } from "react";
import { getMaterials } from "../supabase.js";
import { setMatLens } from "./releaseCore.js";

const subs = new Set();
let ver = 0;
const invKey = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");

export async function refreshMatLens(projectId) {
  if (!projectId) return;
  try {
    const res = await getMaterials(projectId);
    if (!res || !res.ok) return;
    const m = new Map();
    for (const x of res.center || []) { const l = Number(x.length_mm); if (l > 0) m.set(invKey(x.inv_code), l); }
    for (const x of res.project || []) { const l = Number(x.length_mm); if (l > 0) m.set(invKey(x.inv_code), l); }
    setMatLens(projectId, m);
    ver++; subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
  } catch { /* ไม่มีตาราง Material / ออฟไลน์ = ใช้ลำดับเดิม */ }
}

// คืนเลขรุ่นของทะเบียน — ใส่ใน deps ของ useMemo ที่คำนวณ needOf เพื่อคิดใหม่เมื่อโหลดเสร็จ
export function useMatLens(projectId) {
  const [v, setV] = useState(ver);
  useEffect(() => {
    const f = () => setV(ver); subs.add(f);
    if (projectId) refreshMatLens(projectId);
    return () => { subs.delete(f); };
  }, [projectId]);
  return v;
}
