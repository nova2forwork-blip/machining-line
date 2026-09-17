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

// น้ำหนักรวม (กก.) ของ log แต่ละแถว:
//   • ถ้ามีค่า weight ที่บันทึกไว้ → ใช้เลย (report_logs คืน weight = น้ำหนักต่อชิ้น × quantity ของแถวนั้น)
//   • ถ้าไม่มี weight (record เก่า/ยังไม่ปล่อยค่า) → fallback เป็น (น้ำหนักต่อชิ้น) × (quantity)
//     ★ ต้องคูณ quantity ด้วย ไม่งั้นล็อตหลายชิ้นจะถูกนับต่ำกว่าจริง (เช่น 8 ชิ้นได้แค่ 1 ชิ้น)
export function logWeight(l) {
  const recorded = l?.weight;
  if (recorded != null && recorded !== "") return Number(recorded) || 0;
  const per = Number(l?.part_unit?.weight ?? l?.part_unit?.part_master?.unit_weight ?? 0) || 0;
  return per * (Number(l?.quantity ?? 1) || 0);
}

// จำนวนชิ้นรวมทั้งหมดในชุด logs (นับ quantity ของงานหน้าเครื่องด้วย)
export function totalPieces(logs) {
  return (logs || []).reduce((sum, l) => sum + q(l), 0);
}

// ── 1) per-scan: ปริมาณงานที่ประมวลผล (ภาระเครื่อง / ขั้นตอน) ─────────────
// นับทุกแถวใน scan_logs — ชิ้นที่ผ่านหลายขั้นตอนถูกนับหลายครั้งโดยตั้งใจ
// เพราะแต่ละครั้งคือ "งาน" จริงที่เครื่องหนึ่งทำกับชิ้นนั้น
export function processedWeight(logs) {
  return (logs || []).reduce(
    (sum, l) => sum + logWeight(l),
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
    sum += logWeight(l);
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

// ── เรียงชื่อขั้นตอนตาม "ลำดับกระบวนการจริง" (seq) ไม่ใช่ตามตัวอักษร ─────────
// ปัญหาเดิม: Array.from(set).sort() เรียงตาม Unicode ของชื่อไทย → กัด·ตัด·บาก·เจาะ
//   (Milling·Cut·Notch·Drill) ผิดลำดับการผลิต ที่ถูกคือ ตัด→บาก→กัด→เจาะ
// opOrder (ถ้าส่งมา) = แม็ป { ชื่อขั้นตอน → seq } จากตาราง operations (แหล่งจริง ผู้ดูแลแก้ได้)
// ไม่ได้ส่ง opOrder (เช่น caller เก่า/ออฟไลน์) → ใช้ลำดับมาตรฐานในตัวด้านล่าง
const OP_RANK = { "ตัด": 1, "บาก": 2, "กัด": 3, "MILLING": 3, "เจาะ": 4, "พับ": 10, "เชื่อม": 11, "ประกอบ": 12 };
function opRank(name, opOrder) {
  if (opOrder) {                                   // ยึด seq จากฐานข้อมูลก่อน (ตรงกับที่ผู้ดูแลตั้ง)
    const s = opOrder[name];
    if (s != null && s !== "" && isFinite(Number(s))) return Number(s);
  }
  const r = OP_RANK[name] ?? OP_RANK[String(name).toUpperCase()];   // สำรอง: ลำดับมาตรฐาน (รองรับทั้ง "กัด" และ "MILLING")
  return r != null ? r : 999;                      // ขั้นตอนไม่รู้จัก → ไว้ท้าย แล้วเรียงตามชื่อ
}
function sortOpNames(nameSet, opOrder) {
  return Array.from(nameSet).sort(
    (a, b) => (opRank(a, opOrder) - opRank(b, opOrder)) || String(a).localeCompare(String(b))
  );
}

// ── 4) machine × operation matrix (สำหรับเครื่องที่ทำได้หลายอย่าง) ─────────
// คืนโครงสร้าง:
//   {
//     machines: [{ name, total:{count,weight}, ops:{ opName:{count,weight} } }],
//     opNames: [ชื่อขั้นตอนทั้งหมดที่พบ เรียงแล้ว],
//   }
// ใช้แสดงตารางแยกน้ำหนักของเครื่องตัวเดียวออกเป็นราย-ขั้นตอนได้
// (เช่น "เครื่อง X: ตัด 500 กก. + เจาะ 300 กก.")
// ★ นับ "จำนวนชิ้นต่อขั้นตอน" แบบรู้จัก co-tick:
//   หน้าเครื่องติ๊กหลายขั้นตอนใน 1 สแกน → ขั้นตอนหลักถือ quantity จริง · ที่ติ๊กร่วม = อีก record quantity 0
//   ถ้านับ sum(quantity) ดิบ ขั้นตอนที่ติ๊กร่วมจะได้ 0 (โชว์ "0 pcs" ทั้งที่เครื่องทำจริง)
//   จึงจับ "1 สแกน" (record หลัก quantity>0 + ตัวติ๊กร่วม quantity 0 ที่ตามมา ชิ้น+สถานะเดียวกัน)
//   แล้วเครดิตจำนวนของสแกนนั้นให้ "ทุกขั้นตอนที่ทำในสแกน" → ทุกขั้นตอนได้จำนวนชิ้นที่ผ่านจริง
//   • total.count / weight / seconds = ผลรวมจริง (co-tick เป็น 0 อยู่แล้ว ไม่นับซ้ำ)
export function machineOpMatrix(logs, opOrder) {
  const byMachine = new Map();
  const opNames = new Set();

  // จัดกลุ่ม log ตามเครื่องก่อน (key = code เพื่อกันชื่อซ้ำ) — แล้วค่อยคิดทีละเครื่อง
  const byMachineLogs = new Map();
  for (const l of logs || []) {
    const mName = l.machine?.name || "ไม่ระบุ";
    const mKey = l.machine?.code || mName;
    opNames.add(l.operation?.name || "ไม่ระบุ");
    if (!byMachineLogs.has(mKey)) byMachineLogs.set(mKey, { name: mName, code: l.machine?.code || "", rows: [] });
    byMachineLogs.get(mKey).rows.push(l);
  }

  for (const [, mv] of byMachineLogs) {
    const entry = { name: mv.name, code: mv.code, total: { count: 0, weight: 0, seconds: 0 }, ops: {} };
    const ensureOp = (op) => (entry.ops[op] = entry.ops[op] || { count: 0, weight: 0, seconds: 0 });

    // 1) น้ำหนัก/เวลา/ยอดรวม — รวมจาก record จริงทุกแถว (co-tick มีค่า 0 อยู่แล้ว)
    for (const l of mv.rows) {
      const op = l.operation?.name || "ไม่ระบุ";
      const wt = logWeight(l), s = sec(l);
      ensureOp(op).weight += wt;
      entry.ops[op].seconds += s;
      entry.total.weight += wt;
      entry.total.seconds += s;
    }

    // 2) จำนวนต่อขั้นตอน — จับ 1 สแกน แล้วเครดิตจำนวนหลักให้ทุกขั้นตอนในสแกนนั้น
    const asc = [...mv.rows].sort((a, b) => String(a.scanned_at || "").localeCompare(String(b.scanned_at || "")));
    let cur = null;
    for (const l of asc) {
      const op = l.operation?.name || "ไม่ระบุ";
      const qv = q(l);
      const puid = l.part_unit_id;
      const st = String(l.status || "").toLowerCase();
      if (qv > 0) {                                   // record หลัก → เริ่มสแกนใหม่ + เครดิตขั้นตอนหลัก
        cur = { qty: qv, puid, st, ops: new Set([op]) };
        entry.total.count += qv;
        ensureOp(op).count += qv;
      } else if (cur && cur.puid === puid && cur.st === st) {   // ติ๊กร่วม → เครดิตจำนวนของสแกนนั้น
        if (!cur.ops.has(op)) { cur.ops.add(op); ensureOp(op).count += cur.qty; }
      } else {
        ensureOp(op);                                 // ติ๊กร่วมกำพร้า (ไม่มีตัวหลักคู่) → มีคอลัมน์ไว้ แต่ไม่เครดิต
      }
    }
    byMachine.set(mv.code || mv.name, entry);
  }

  const machines = Array.from(byMachine.values()).sort(
    (a, b) => b.total.count - a.total.count
  );
  return { machines, opNames: sortOpNames(opNames, opOrder) };
}

// ── 5b) part × operation matrix (แสดงว่าแต่ละ Part No. ทำขั้นตอนอะไรบ้าง กี่ครั้ง) ─
// คืนโครงสร้าง:
//   {
//     parts: [{ partNo, partName, total:{count,weight}, ops:{ opName:{count,weight} } }],
//     opNames: [ชื่อขั้นตอนทั้งหมดที่พบ เรียงแล้ว],
//   }
export function partOpMatrix(logs, opOrder) {
  // แยกราย (Release + Part) → รู้ว่า Part ไหนมาจาก Release ไหน · เก็บ finished แยกด้วย
  // ★ จำนวนต่อขั้นตอน = "ชิ้นที่ผ่านขั้นตอนนั้น" แบบรู้จัก co-tick (1 สแกนติ๊กหลายขั้น = ตัวหลักมีจำนวน · ที่ติ๊กร่วม = 0)
  //   จับ 1 สแกน (ตัวหลัก quantity>0 + ตัวติ๊กร่วม quantity 0 ที่ตามมา ชิ้น+สถานะเดียวกัน) แล้วเครดิตจำนวนให้ทุกขั้นตอนในสแกนนั้น
  const opNames = new Set();
  const byKeyLogs = new Map();
  for (const l of logs || []) {
    const releaseId = l.release_id || l.part_unit?.release_id || null;   // จัดกลุ่มด้วย release_id (unique)
    const releaseOrder = l.release_order || "—";
    const partNo   = l.part_unit?.part_master?.part_no   || "ไม่ระบุ";
    const partName = l.part_unit?.part_master?.part_name || "";
    opNames.add(l.operation?.name || "ไม่ระบุ");
    const key = `${releaseId || releaseOrder}|${partNo}`;
    if (!byKeyLogs.has(key)) byKeyLogs.set(key, { releaseId, releaseOrder, partNo, partName, rows: [] });
    byKeyLogs.get(key).rows.push(l);
  }

  const parts = [];
  for (const [, kv] of byKeyLogs) {
    const entry = { releaseId: kv.releaseId, releaseOrder: kv.releaseOrder, partNo: kv.partNo, partName: kv.partName,
                    total: { count: 0, weight: 0, finished: 0 }, ops: {} };
    const ensureOp = (op) => (entry.ops[op] = entry.ops[op] || { count: 0, weight: 0 });

    // 1) น้ำหนัก / finished / น้ำหนักรวม — รวมจาก record จริง (co-tick มีค่า 0 อยู่แล้ว)
    for (const l of kv.rows) {
      const op = l.operation?.name || "ไม่ระบุ";
      const wt = logWeight(l);
      ensureOp(op).weight += wt;
      entry.total.weight += wt;
      entry.total.finished += (String(l.status).toLowerCase() === "finished" ? q(l) : 0);
    }

    // 2) จำนวนต่อขั้นตอน — จับ 1 สแกน แล้วเครดิตจำนวนหลักให้ทุกขั้นตอนในสแกนนั้น
    const asc = [...kv.rows].sort((a, b) => String(a.scanned_at || "").localeCompare(String(b.scanned_at || "")));
    let cur = null;
    for (const l of asc) {
      const op = l.operation?.name || "ไม่ระบุ";
      const qv = q(l);
      const puid = l.part_unit_id;
      const st = String(l.status || "").toLowerCase();
      if (qv > 0) {                                   // record หลัก → เริ่มสแกนใหม่ + เครดิตขั้นตอนหลัก
        cur = { qty: qv, puid, st, ops: new Set([op]) };
        entry.total.count += qv;
        ensureOp(op).count += qv;
      } else if (cur && cur.puid === puid && cur.st === st) {   // ติ๊กร่วม → เครดิตจำนวนของสแกนนั้น
        if (!cur.ops.has(op)) { cur.ops.add(op); ensureOp(op).count += cur.qty; }
      } else {
        ensureOp(op);                                 // ติ๊กร่วมกำพร้า → มีคอลัมน์ไว้ แต่ไม่เครดิต
      }
    }
    parts.push(entry);
  }

  parts.sort((a, b) => (a.releaseOrder || "").localeCompare(b.releaseOrder || "", undefined, { numeric: true })
                      || (b.total.count - a.total.count));
  return { parts, opNames: sortOpNames(opNames, opOrder) };
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
  if (!isFinite(d.getTime())) return "-";   // ★ กันวันที่พัง (NaN → toISOString throw → ทั้งรายงานล่ม)
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
export function machineDailyMatrix(logs) {
  const byMachine = new Map();
  const days = new Set();
  for (const l of logs || []) {
    const mName = l.machine?.name || "ไม่ระบุ";
    const m = l.machine?.code || mName;   // ★ key ด้วย code (unique) กันเครื่องชื่อซ้ำถูกยุบรวม · โชว์ชื่อตามเดิม
    const day = bangkokDay(l.scanned_at);
    days.add(day);
    if (!byMachine.has(m)) {
      byMachine.set(m, { name: mName, days: {}, total: { count: 0, weight: 0, seconds: 0 } });
    }
    const e = byMachine.get(m);
    e.days[day] = e.days[day] || { count: 0, weight: 0, seconds: 0 };
    const pcs = q(l), wt = logWeight(l), s = sec(l);
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
    const wt = logWeight(l);
    if (wt > 0) continue;
    const partNo = l.part_unit?.part_master?.part_no || "ไม่ระบุ";
    bad.set(partNo, (bad.get(partNo) || 0) + q(l));
  }
  return Array.from(bad.entries()).map(([partNo, pieces]) => ({ partNo, pieces }));
}
