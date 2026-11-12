// ══ ★ 2026-11-12 ย้อน "บันทึกเป็น M" ด้วย Ctrl+Z (ผู้ใช้: ย้อน M ด้วย Ctrl+Z) ══
//   ใช้กับ useUndoHistory().record(ใบก่อน M, ใบหลัง M, modUndoStep(...))
//   ย้อน = ถามยืนยัน → api.undoModify (ล็อตที่ M ลด/ยกเลิก → ยกเลิก M ในล็อตด้วย · เช็คทุกล็อตก่อน) → คืนใบหลักเป็นก่อน M
//   ทำซ้ำ (Ctrl+Y) ได้เฉพาะ M ที่ไม่ได้แก้ล็อตที่ปล่อยแล้ว (แก้แค่ใบหลัก) — M ที่แก้ล็อตแล้วถ้าจะเอากลับต้องบันทึก M ใหม่
import { askConfirm } from "../confirm.jsx";
import { lotsOfMod } from "./releaseApi.js";

// getAt = _at ของใบที่หน้าแสดงอยู่ (★ R1: แก้/ย้อนอย่างอื่นหลัง M แล้ว ฐานข้อมูลเป็นรุ่นใหม่กว่า cur — ส่งรุ่นล่าสุดไปเทียบ ไม่ชนตัวเอง)
export function modUndoStep({ prev, np, mod, api, user = null, showPlan, onReload = async () => {}, toast, getAt = () => null }) {
  const lots = lotsOfMod(mod); let cur = np;
  const fresh = (p) => ({ ...p, _at: getAt() || p._at });
  return {
    undo: async () => {
      const ok = await askConfirm({ title: `ย้อน ${mod.ver}?`, tone: lots.length ? "danger" : "warn", confirmText: `ย้อน ${mod.ver}`, cancelText: "ไม่ย้อน", focusCancel: true,
        message: [`ใบ ${prev.ro} กลับเป็นก่อน ${mod.ver} (ยอดต้องใช้ · BOM · วัสดุ · ความยาว · ประวัติ Modify)`,
          lots.length ? `ล็อตที่ ${mod.ver} แก้: ${lots.join(", ")} → ยกเลิก ${mod.ver} ในล็อตด้วย (QR ที่ยกเลิกกลับมาใช้ได้ · หน้าล็อตขึ้นว่า “ยกเลิกแล้ว” · เลข ${mod.ver} ไม่ใช้ซ้ำ)`
            : `${mod.ver} ไม่ได้แก้ล็อตที่ปล่อยแล้ว — แก้แค่ใบหลัก · Ctrl+Y ทำซ้ำได้`,
          "แบบ PDF ที่เก็บลงคลังโปรเจคยังอยู่"].join("\n") });
      if (!ok) return false;
      try {
        toast(`กำลังย้อน ${mod.ver}…`, "info");
        const r = await api.undoModify({ plan: fresh(cur), prevPlan: prev, mod, by: user?.name || "" });
        cur = r.np; showPlan(r.np);
        toast(`↶ ย้อน ${mod.ver} แล้ว${r.lots.length ? ` · ยกเลิกในล็อต ${r.lots.join(", ")}` : ""}${lots.length ? "" : " · Ctrl+Y = ทำซ้ำ"}`, "success");
        if (r.lots.length) await onReload();
        return true;
      } catch (e) {
        toast(`ย้อน ${mod.ver} ไม่สำเร็จ: ${e?.message || e}`, "error");
        if (e?.partial?.length || e?.code === "conflict") await onReload();
        return false;
      }
    },
    redo: lots.length ? null : async () => {
      try {
        const p2 = fresh({ ...np, modUndone: cur.modUndone });
        await api.updatePlan(p2); cur = p2; showPlan(p2);
        toast(`↷ ทำซ้ำ ${mod.ver} แล้ว`, "success");
        return true;
      } catch (e) { toast(`ทำซ้ำ ${mod.ver} ไม่สำเร็จ: ${e?.message || e}`, "error"); return false; }
    },
  };
}
