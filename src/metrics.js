// ─── Weight-counting metrics ─────────────────────────────────────────────
// จุดสำคัญ: "น้ำหนักรวม" ไม่ใช่ตัวเลขเดียว แต่เป็นคนละคำถามที่นับคนละแบบ
//
//   ถามเรื่อง "ของ" (วัสดุ/ผลผลิต)      → นับต่อชิ้น (distinct part_unit)
//   ถามเรื่อง "งาน" (ภาระเครื่อง/ขั้นตอน) → นับต่อการสแกน (ทุกแถวใน scan_logs)
//
// ชิ้นเดียวหนัก 10 กก. ที่ผ่าน 3 ขั้นตอน:
//   - per-scan  = 30 กก. (เครื่องแต่ละตัวประมวลผล 10 กก. จริง — ถูกต้องสำหรับวัดภาระงาน)
//   - per-unit  = 10 กก. (น้ำหนักวัสดุจริง — ถูกต้องสำหรับวัดผลผลิต)
// รายงานจะเชื่อถือได้ก็ต่อเมื่อเลือกวิธีนับให้ตรงกับคำถาม แล้วแปะป้ายให้ชัด

// ดึงน้ำหนักพร้อม fallback: ค่าที่ปล่อยลงชิ้น → ค่าเริ่มต้นจาก Part Master → 0
const w = (value, fallback) => Number(value ?? fallback ?? 0);
// จำนวนชิ้นของ log แต่ละแถว: หน้าเครื่อง = quantity (ล็อต), หน้าสำนักงาน = 1 (สแกน 1 ครั้ง = 1 ชิ้น)
const q = (l) => Number(l?.quantity ?? 1) || 0;
// เวลาเดินเครื่อง (วินาที) ของ log แต่ละแถว — มีเฉพาะงานหน้าเครื่อง (report_logs v3)
const sec = (l) => Number(l?.process_seconds) || 0;

// จำนวนชิ้นรวมทั้งหมดในชุด logs (นับ quantity ของงานหน้าเครื่องด้วย)
export function totalPieces(logs) {
  return (logs || []).reduce((sum, l) => sum + q(l), 0);
}

// ── 1) per-scan: ปริมาณงานที่ประมวลผล (ภาระเครื่อง / ขั้นตอน) ─────────────
// นับทุกแถวใน scan_logs — ชิ้นที่ผ่านหลายขั้นตอนถูกนับหลายครั้งโดยตั้งใจ
// เพราะแต่ละครั้งคือ "งาน" จริงที่เครื่องหนึ่งทำกับชิ้นนั้น
export function processedWeight(logs) {
  return (logs || []).reduce(
    (sum, l) => sum + w(l.weight, l.part_unit?.part_master?.unit_weight),
    0
  );
}

// ── 2) per-unit จาก scan_logs: น้ำหนักวัสดุจริง (นับแต่ละชิ้นครั้งเดียว) ───
// ใช้เมื่อข้อมูลต้นทางเป็น scan_logs แต่ต้องการน้ำหนักของ "ของ" ไม่ใช่ของ "งาน"
// (เช่น ในหน้า Report ที่กรองตามช่วงเวลา แต่อยากรู้ว่ามีวัสดุจริงกี่ กก.)
export function materialWeight(logs) {
  const seen = new Set();
  let sum = 0;
  for (const l of logs || []) {
    if (!l.part_unit_id || seen.has(l.part_unit_id)) continue;
    seen.add(l.part_unit_id);
    sum += w(l.weight, l.part_unit?.part_master?.unit_weight);
  }
  return sum;
}

// จำนวนชิ้น (distinct) ที่มีความเคลื่อนไหวในชุด logs นี้
export function distinctUnitCount(logs) {
  return new Set((logs || []).map((l) => l.part_unit_id).filter(Boolean)).size;
}

// ── 3) per-unit จาก part_units โดยตรง (Projects/Parts/Finished ใช้) ───────
// นับแต่ละชิ้นครั้งเดียวเสมอ — onlyFinished=true จะนับเฉพาะชิ้นที่ทำครบทุกขั้นตอน
export function unitsWeight(units, onlyFinished = false) {
  return (units || [])
    .filter((u) => !onlyFinished || u.status === "finished")
    .reduce((sum, u) => sum + w(u.weight, u.part_master?.unit_weight), 0);
}

// ── 4) machine × operation matrix (สำหรับเครื่องที่ทำได้หลายอย่าง) ─────────
// คืนโครงสร้าง:
//   {
//     machines: [{ name, total:{count,weight}, ops:{ opName:{count,weight} } }],
//     opNames: [ชื่อขั้นตอนทั้งหมดที่พบ เรียงแล้ว],
//   }
// ใช้แสดงตารางแยกน้ำหนักของเครื่องตัวเดียวออกเป็นราย-ขั้นตอนได้
// (เช่น "เครื่อง X: ตัด 500 กก. + เจาะ 300 กก.")
export function machineOpMatrix(logs) {
  const byMachine = new Map();
  const opNames = new Set();

  for (const l of logs || []) {
    const m = l.machine?.name || "ไม่ระบุ";
    const op = l.operation?.name || "ไม่ระบุ";
    const wt = w(l.weight, l.part_unit?.part_master?.unit_weight);
    opNames.add(op);

    if (!byMachine.has(m)) {
      byMachine.set(m, { name: m, total: { count: 0, weight: 0, seconds: 0 }, ops: {} });
    }
    const entry = byMachine.get(m);
    const pcs = q(l);
    const s = sec(l);
    entry.ops[op] = entry.ops[op] || { count: 0, weight: 0, seconds: 0 };
    entry.ops[op].count += pcs;
    entry.ops[op].weight += wt;
    entry.ops[op].seconds += s;
    entry.total.count += pcs;
    entry.total.weight += wt;
    entry.total.seconds += s;
  }

  const machines = Array.from(byMachine.values()).sort(
    (a, b) => b.total.count - a.total.count
  );
  return { machines, opNames: Array.from(opNames).sort() };
}

// ── 5b) part × operation matrix (แสดงว่าแต่ละ Part No. ทำขั้นตอนอะไรบ้าง กี่ครั้ง) ─
// คืนโครงสร้าง:
//   {
//     parts: [{ partNo, partName, total:{count,weight}, ops:{ opName:{count,weight} } }],
//     opNames: [ชื่อขั้นตอนทั้งหมดที่พบ เรียงแล้ว],
//   }
export function partOpMatrix(logs) {
  // แยกราย (Release + Part) → รู้ว่า Part ไหนมาจาก Release ไหน · เก็บ finished แยกด้วย
  const byKey = new Map();
  const opNames = new Set();

  for (const l of logs || []) {
    const releaseOrder = l.release_order || "—";
    const partNo   = l.part_unit?.part_master?.part_no   || "ไม่ระบุ";
    const partName = l.part_unit?.part_master?.part_name || "";
    const op       = l.operation?.name || "ไม่ระบุ";
    const wt       = w(l.weight, l.part_unit?.part_master?.unit_weight);
    const pcs      = q(l);
    const fin      = String(l.status).toLowerCase() === "finished" ? pcs : 0;
    opNames.add(op);

    const key = `${releaseOrder} ${partNo}`;
    if (!byKey.has(key)) {
      byKey.set(key, { releaseOrder, partNo, partName, total: { count: 0, weight: 0, finished: 0 }, ops: {} });
    }
    const entry = byKey.get(key);
    entry.ops[op] = entry.ops[op] || { count: 0, weight: 0 };
    entry.ops[op].count  += pcs;
    entry.ops[op].weight += wt;
    entry.total.count    += pcs;
    entry.total.weight   += wt;
    entry.total.finished += fin;
  }

  const parts = Array.from(byKey.values()).sort(
    (a, b) => (a.releaseOrder || "").localeCompare(b.releaseOrder || "", undefined, { numeric: true })
              || (b.total.count - a.total.count)
  );
  return { parts, opNames: Array.from(opNames).sort() };
}

// ── 5) (ทางเลือกขั้นสูง) น้ำหนักงานที่คืบหน้าไปแล้ว (ถ่วงตามขั้นตอน) ────────
// ต้องมีคอลัมน์ part_units.steps_done (ดู migration) — ชิ้น 10 กก. ทำ 2/4 ขั้น
// นับเป็นงานคืบหน้า 5 กก. ให้ภาพความคืบหน้าที่ละเอียดกว่าการนับหัวชิ้น
export function weightedProgress(units) {
  let done = 0;
  let material = 0;
  for (const u of units || []) {
    const total = (u.part_master?.routing || []).length;
    const unitW = w(u.weight, u.part_master?.unit_weight);
    material += unitW;
    if (total > 0) {
      const steps = Number(u.steps_done ?? (u.status === "finished" ? total : 0));
      done += unitW * Math.min(steps / total, 1);
    } else if (u.status === "finished") {
      done += unitW;
    }
  }
  return { done, material, pct: material > 0 ? (done / material) * 100 : 0 };
}

// ── 6) machine × day matrix (กก./จำนวน/เวลา ต่อวัน ต่อเครื่อง) ─────────────
// ตอบคำถาม "เครื่องนี้ทำได้กี่กิโล/กี่ชิ้น/ใช้เวลาเท่าไร ต่อวัน"
// ใช้เขตเวลาไทย (Asia/Bangkok) ในการตัดวัน เพื่อให้ตรงกับ Daily Report หน้าเครื่อง
// คืน:
//   {
//     machines: [{ name, days:{ 'YYYY-MM-DD':{count,weight,seconds} },
//                  total:{count,weight,seconds}, dayCount, avg:{count,weight,seconds} }],
//     days: [รายการวันที่ทั้งหมดที่พบ เรียงจากเก่า→ใหม่],
//   }
function bangkokDay(iso) {
  if (!iso) return "-";
  // แปลงเป็นเวลาไทยแล้วตัดเป็น YYYY-MM-DD (ไม่พึ่ง locale ของเครื่องผู้ใช้)
  const d = new Date(iso);
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
export function machineDailyMatrix(logs) {
  const byMachine = new Map();
  const days = new Set();
  for (const l of logs || []) {
    const m = l.machine?.name || "ไม่ระบุ";
    const day = bangkokDay(l.scanned_at);
    days.add(day);
    if (!byMachine.has(m)) {
      byMachine.set(m, { name: m, days: {}, total: { count: 0, weight: 0, seconds: 0 } });
    }
    const e = byMachine.get(m);
    e.days[day] = e.days[day] || { count: 0, weight: 0, seconds: 0 };
    const pcs = q(l), wt = w(l.weight, l.part_unit?.part_master?.unit_weight), s = sec(l);
    e.days[day].count += pcs; e.days[day].weight += wt; e.days[day].seconds += s;
    e.total.count += pcs; e.total.weight += wt; e.total.seconds += s;
  }
  const machines = Array.from(byMachine.values()).map((e) => {
    const dayCount = Object.keys(e.days).length || 1;   // จำนวน "วันที่มีงาน" (เฉลี่ยจากวันที่ทำจริง)
    return {
      ...e,
      dayCount,
      avg: {
        count: e.total.count / dayCount,
        weight: e.total.weight / dayCount,
        seconds: e.total.seconds / dayCount,
      },
    };
  }).sort((a, b) => b.total.weight - a.total.weight);
  return { machines, days: Array.from(days).sort() };
}

// ── 7) ตรวจ Part ที่ยังไม่ได้ตั้งน้ำหนัก/ชิ้น (กก. จะกลายเป็น 0 เงียบๆ) ──────
// คืนรายชื่อ Part No. ที่มีงาน (quantity > 0) แต่คำนวณน้ำหนักได้ 0
export function missingWeightParts(logs) {
  const bad = new Map();
  for (const l of logs || []) {
    if (q(l) <= 0) continue;
    const wt = w(l.weight, l.part_unit?.part_master?.unit_weight);
    if (wt > 0) continue;
    const partNo = l.part_unit?.part_master?.part_no || "ไม่ระบุ";
    bad.set(partNo, (bad.get(partNo) || 0) + q(l));
  }
  return Array.from(bad.entries()).map(([partNo, pieces]) => ({ partNo, pieces }));
}
