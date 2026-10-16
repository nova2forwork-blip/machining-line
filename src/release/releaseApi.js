// ══════════════════════════════════════════════════════════════════════════
// ปล่อยงานแบบใหม่ — ต่อฐานข้อมูล (ใช้ RPC ที่มีอยู่แล้ว · ยังไม่ต้องรัน migration รอบนี้)
//   create_release_batch  → part_master + releases + QR (ทั้งใบในครั้งเดียว · atomic)
//   authz_update          → part_master.kind (panel / subassembly)
//   authz_set_bom         → BOM ของแผง/ซับ (ลูก = ซับ + พาร์ทที่มี QR)
//   part_master_update    → ชื่อเบอร์ (Description จาก PDF) เฉพาะเบอร์ที่ชื่อยังว่าง/เป็นเลขเบอร์
//   set_release_mdf       → Modify ของทั้งใบ · materials_add_from_release → INV ใหม่เข้า "บันทึก Material"
// ที่อยู่ของแผง: ยังไม่มีคอลัมน์ part_units.address → เก็บในหมายเหตุของ Release แผง ("ที่อยู่: …" เรียงตาม QR ชิ้นที่ 1..n)
// ══════════════════════════════════════════════════════════════════════════
import {
  supabase, listRows, insertRows, createReleaseBatch, releaseOrderExists, updateRow, setBom, getBom, updatePartMaster,
  listReleaseIdsOfOrder, setReleaseMdf, addMaterialsFromRelease, getMaterials, getReleaseModifyInfo, applyReleaseModify,
} from "../supabase.js";
import { getSession } from "../auth.js";
import { NC, findKey, QR_CATS, ruleCat, addrNote, projectContext, applyModToPlan } from "./releaseCore.js";

// ทำทีละ n งานพร้อมกัน (กันยิง RPC ถล่มทีเดียวหลายร้อยตัว)
async function pool(items, n, fn, onTick) {
  let i = 0, done = 0; const errs = [];
  const run = async () => {
    while (i < items.length) {
      const k = i++;
      try { await fn(items[k], k); } catch (e) { errs.push({ item: items[k], e }); }
      done++; if (onTick) onTick(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return errs;
}
const matKey = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");

// BOM เดิมในระบบของโปรเจค (part_master + bom_components) → รูปแบบเดียวกับที่ได้จาก PDF
//   onlyCodes = จำกัดเฉพาะแผงที่ใช้ในใบนี้ (ซับใต้แผงไล่ต่อให้เอง) · ไม่ส่ง = ทุกแผง/ซับ
export async function loadBomLibrary(projectId, onlyCodes = null, onTick) {
  const pms = await listRows("part_master", { filters: { project_id: projectId }, strict: true });
  const byId = new Map(pms.map((p) => [p.id, p]));
  const lib = { panels: {}, subs: {}, parts: {} };
  for (const p of pms) {
    const code = String(p.part_no || "").trim(); if (!code) continue;
    if (p.kind === "panel" || p.kind === "subassembly" || p.kind === "package") continue;
    lib.parts[code] = { d: p.part_name && p.part_name !== code ? p.part_name : "", l: p.default_length_mm ?? null, m: p.inventory_code || p.material || "", k: "part", rev: p.rev || "" };
  }
  const want = onlyCodes ? new Set(onlyCodes.map(NC)) : null;
  const queue = pms.filter((p) => (p.kind === "panel" || p.kind === "subassembly") && (!want || want.has(NC(p.part_no))));
  const seen = new Set();
  while (queue.length) {
    const batch = queue.splice(0, queue.length).filter((p) => !seen.has(p.id));
    batch.forEach((p) => seen.add(p.id));
    const errs = await pool(batch, 6, async (p) => {
      const bom = await getBom(p.id, { strict: true });
      const items = (bom || []).map((c) => [c.kind === "subassembly" ? "sub" : "part", String(c.part_no || "").trim(), Number(c.qty) || 0]);
      const code = String(p.part_no || "").trim();
      if (p.kind === "panel") lib.panels[code] = { d: p.part_name && p.part_name !== code ? p.part_name : "", items };
      else lib.subs[code] = { d: p.part_name && p.part_name !== code ? p.part_name : "", l: p.default_length_mm ?? null, f: "", lvl: 1, items };
      // ไล่ซับใต้แผง/ซับ
      for (const c of bom || []) if (c.kind === "subassembly") { const sp = byId.get(c.child_pm_id); if (sp && !seen.has(sp.id)) queue.push(sp); }
    }, onTick);
    if (errs.length) throw new Error(`อ่าน BOM ไม่ได้ ${errs.length} เบอร์ (${errs.slice(0, 3).map((x) => x.item.part_no).join(", ")})`);
  }
  // หมวด / งานซับ / ใบงาน ที่ office ตั้งไว้ที่ "ซับ / พาร์ท ของโปรเจค" (แถว LIB ใน release_plans)
  try { const r = await listPlans(projectId); if (r.lib) { lib.ov = { catOv: r.lib.catOv || {}, procOv: r.lib.procOv || {}, destOv: r.lib.destOv || {}, partMode: r.lib.partMode || "auto", partGroups: r.lib.partGroups || [] }; lib.libId = r.lib.id; lib.pdfs = r.lib.pdfs || []; for (const [c, its] of Object.entries(r.lib.subItems || {})) { const sk = Object.keys(lib.subs).find((x) => NC(x) === NC(c)); if (sk) lib.subs[sk].full = its; } for (const [c, k] of Object.entries(r.lib.kinds || {})) { const pk = Object.keys(lib.parts).find((x) => NC(x) === NC(c)); if (pk && k === "hw") lib.parts[pk].k = "hw"; } } } catch (_) { /* ยังไม่รัน migration-release-plans.sql */ }
  return lib;
}

export async function orderExists(projectId, ro) { return releaseOrderExists(projectId, ro); }

// ══ บันทึกทั้งใบ ══
//   payload = { projectId, releaseOrder, releaseDate(ISO), userId, modNo, note, plan, bomSave, make:{panels,subs,parts} }
//   resume  = ผลจากรอบก่อนที่ค้าง (batch ผ่านแล้ว) → ทำเฉพาะขั้นที่เหลือ ไม่สร้าง QR ซ้ำ
export async function saveRelease(payload, onProgress = () => {}, resume = null) {
  const { projectId, releaseOrder: ro, releaseDate, userId, modNo, note, plan, bomSave, make } = payload;
  const st = resume ? { ...resume } : { batch: false, kinds: false, boms: false, names: false, mdf: false, mats: false, errors: [] };
  st.errors = [];
  const rows = [];
  let wOf = () => 0;
  if (make.parts && !st.batch) { try { wOf = await weightIndex(projectId); } catch (_) { /* ไม่มีบันทึก Material = น้ำหนัก 0 */ } }
  if (make.parts) for (const p of plan.parts) rows.push({ code: p.code, qty: Math.round(p.qty), unit_weight: wOf(p.inv, p.l) || 0, length_mm: p.l ?? null, material: p.inv || null, remark: null, routing: [] });
  if (make.subs) for (const s of plan.subs) rows.push({ code: s.code, qty: Math.round(s.qty), unit_weight: 0, length_mm: s.l ?? null, material: null, remark: s.proc ? `งาน: ${s.proc}` : null, routing: [] });
  if (make.panels) for (const p of plan.panels) rows.push({ code: p.code, qty: p.qty, unit_weight: 0, length_mm: null, material: null, remark: [note, addrNote(p.addrs)].filter(Boolean).join(" · "), routing: [] });
  if (!rows.length) throw new Error("ไม่มีรายการที่จะปล่อยงาน");

  // 1) ปล่อยงานทั้งใบ (atomic) — กันซ้ำ: ถ้าเลขนี้มีแล้วและไม่ใช่การทำต่อ = หยุด
  if (!st.batch) {
    onProgress("ตรวจเลข Release ซ้ำ…");
    if (await releaseOrderExists(projectId, ro)) { const e = new Error(`Release Order "${ro}" มีอยู่แล้วในโปรเจคนี้ — ถ้าเพิ่งกดแล้วเน็ตหลุด อาจบันทึกไปแล้ว · ตรวจในรายการ Release ก่อน`); e.code = "exists"; throw e; }
    onProgress(`สร้าง Release + QR (${rows.length} เบอร์)…`);
    st.res = await createReleaseBatch({ projectId, releaseOrder: ro, releaseDate, releasedBy: userId, makeQr: true, rows });
    st.batch = true;
  }
  // 2) ชนิดเบอร์ + BOM
  onProgress("อ่านเบอร์ในโปรเจค…");
  const pms = await listRows("part_master", { filters: { project_id: projectId }, strict: true });
  const pmBy = new Map(pms.map((p) => [NC(p.part_no), p]));
  if (!st.kinds) {
    const want = [];
    if (make.panels) for (const p of plan.panels) want.push([p.code, "panel"]);
    for (const s of plan.subs) want.push([s.code, "subassembly"]);
    const todo = want.filter(([c, k]) => { const pm = pmBy.get(NC(c)); return pm && pm.kind !== k; });
    const errs = await pool(todo, 6, async ([c, k]) => { await updateRow("part_master", pmBy.get(NC(c)).id, { kind: k }); }, (d, n) => onProgress(`ตั้งชนิดเบอร์ ${d}/${n}`));
    if (errs.length) st.errors.push(`ตั้งชนิดไม่สำเร็จ ${errs.length} เบอร์ (${errs.slice(0, 4).map((x) => x.item[0]).join(", ")})`); else st.kinds = true;
  }
  if (!st.boms) {
    const missing = [];
    const jobs = bomSave.list.map((b) => {
      const parent = pmBy.get(NC(b.code));
      // ลูกที่ไม่ได้ปล่อยในใบนี้ (ติ๊กไม่ปล่อยชนิดนั้น) และยังไม่มีในระบบ = ข้ามเงียบๆ · ชนิดที่ปล่อยแล้วแต่หาไม่เจอ = แจ้ง
      const comps = b.children.map((c) => { const pm = pmBy.get(NC(c.code)); if (!pm && (c.kind === "sub" ? make.subs : make.parts)) missing.push(`${b.code} › ${c.code}`); return pm ? { child_pm_id: pm.id, qty: c.qty } : null; }).filter(Boolean);
      return { code: b.code, parent, comps };
    }).filter((j) => j.parent && j.comps.length);
    const errs = await pool(jobs, 4, async (j) => { const r = await setBom(j.parent.id, j.comps); if (r && r.ok === false) throw new Error(r.reason || "set_bom"); }, (d, n) => onProgress(`ตั้ง BOM ${d}/${n}`));
    if (missing.length) st.errors.push(`ลูกที่ยังไม่มีในระบบ ${missing.length} รายการ (ข้ามใน BOM): ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? " …" : ""}`);
    if (errs.length) st.errors.push(`ตั้ง BOM ไม่สำเร็จ ${errs.length} เบอร์ (${errs.slice(0, 4).map((x) => x.item.code).join(", ")})`); else st.boms = true;
  }
  // 3) ชื่อเบอร์ (Description จาก PDF) — เฉพาะเบอร์ที่ชื่อยังว่าง/เท่ากับเลขเบอร์ · ส่งค่าเดิมกลับไปทุกช่อง (ไม่ทับ Material/น้ำหนัก)
  if (!st.names) {
    const want = [...plan.parts, ...plan.subs, ...(make.panels ? plan.panels : [])].filter((x) => x.d);
    const todo = want.map((x) => [x, pmBy.get(NC(x.code))]).filter(([x, pm]) => pm && (!pm.part_name || NC(pm.part_name) === NC(pm.part_no)) && NC(x.d) !== NC(pm.part_no));
    const errs = await pool(todo, 6, async ([x, pm]) => {
      await updatePartMaster(pm.id, { part_name: x.d, material: pm.material ?? null, unit_weight: pm.unit_weight ?? 0, default_length_mm: pm.default_length_mm ?? null });
    }, (d, n) => onProgress(`เติมชื่อเบอร์ ${d}/${n}`));
    if (errs.length) st.errors.push(`เติมชื่อเบอร์ไม่สำเร็จ ${errs.length} เบอร์ (ไม่กระทบ QR)`); st.names = true;
  }
  // 4) Modify ทั้งใบ + INV เข้า "บันทึก Material" (พลาดไม่กระทบ Release)
  if (!st.mdf) {
    try { const ids = await listReleaseIdsOfOrder(projectId, ro); await setReleaseMdf(ids, String(modNo || "").trim() || "0"); } catch (_) { /* DB เก่ายังไม่มี releases.mdf_no */ }
    st.mdf = true;
  }
  if (!st.mats && make.parts) {
    try {
      const invs = [...new Set(plan.parts.map((p) => p.inv).filter(Boolean))].map((inv) => ({ inv, wpm: null }));
      if (invs.length) await addMaterialsFromRelease(projectId, ro, invs);
    } catch (_) { /* ignore */ }
    st.mats = true;
  }
  return st;
}

// น้ำหนักต่อชิ้น = Weight/M (บันทึก Material: โปรเจคก่อน → Center Stock) × ยาว — ไม่มีค่า = 0 (เติมทีหลังได้)
export async function weightIndex(projectId) {
  const res = await getMaterials(projectId);
  const idx = new Map();
  if (res && res.ok) {
    for (const m of res.center || []) { const w = Number(m.weight_per_m); if (w > 0) idx.set(matKey(m.inv_code), w); }
    for (const m of res.project || []) { const w = Number(m.weight_per_m); if (w > 0) idx.set(matKey(m.inv_code), w); }
  }
  return (inv, len) => { const w = idx.get(matKey(inv)); return w && len ? Number(((len / 1000) * w).toFixed(4)) : 0; };
}


// ══════════════════════════════════════════════════════════════════════════
// แผน Release + ปล่อยเป็นล็อต (ต้องรัน migration-release-plans.sql ก่อน)
// ══════════════════════════════════════════════════════════════════════════
const tok = () => getSession()?.token || null;
const missingFn = (e) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(String(e.message || "")));
function notInstalled() { const e = new Error("ยังไม่ได้รัน migration-release-plans.sql"); e.code = "not_installed"; return e; }

export async function listPlans(projectId = null) {
  const { data, error } = await supabase.rpc("release_plan_list", { p_token: tok(), p_project_id: projectId || null });
  if (error) { if (missingFn(error)) return { ok: false, reason: "not_installed", plans: [] }; throw error; }
  const all = (data || []).map((r) => ({ ...(r.plan || {}), id: r.id, projectId: r.project_id, ro: r.release_order, status: r.status, by: (r.plan && r.plan.by) || r.created_by_name || "" }));
  // แถว LIB = คลังซับ/พาร์ทของโปรเจค (ไม่ใช่ Release) → แยกออก
  return { ok: true, plans: all.filter((p) => p.kind !== "lib" && String(p.ro).toUpperCase() !== "LIB"), lib: all.find((p) => p.kind === "lib" || String(p.ro).toUpperCase() === "LIB") || null };
}
async function planRpc(projectId, ro, plan, id = null) {
  const { data, error } = await supabase.rpc("release_plan_save", { p_token: tok(), p_project_id: projectId, p_release_order: ro, p_plan: plan, p_id: id });
  if (error) { if (missingFn(error)) throw notInstalled(); throw error; }
  if (data && data.ok === false) { const e = new Error(data.reason === "duplicate" ? `Release ${ro} มีอยู่แล้ว` : `บันทึกแผนไม่สำเร็จ (${data.reason})`); e.code = data.reason === "duplicate" ? "exists" : data.reason; throw e; }
  return data || {};
}
// แก้แผน (เช่น office เปลี่ยนงานของซับ / ใบงานพาร์ทตอนปล่อยล็อต)
export async function updatePlan(plan) { const { id, ...body } = plan; return planRpc(plan.projectId, plan.ro, body, id); }

// บันทึกแผน: (1) เก็บแผน (2) สร้างเบอร์ที่ยังไม่มีใน part_master (3) ชนิดเบอร์ (4) BOM (5) ชื่อเบอร์ — ยังไม่สร้าง QR
export async function savePlan({ plan, need, bomSave }, onProgress = () => {}, resume = null) {
  const st = resume ? { ...resume } : { saved: false, id: null, created: false, kinds: false, boms: false, names: false };
  st.errors = [];
  const projectId = plan.projectId;
  if (!st.saved) {
    onProgress("ตรวจเลข Release ซ้ำ…");
    if (await releaseOrderExists(projectId, plan.ro)) { const e = new Error(`Release Order "${plan.ro}" มีอยู่แล้วในโปรเจคนี้`); e.code = "exists"; throw e; }
    onProgress("บันทึก Release…");
    const { id, ...body } = plan; void id;
    const r = await planRpc(projectId, plan.ro, body, null);
    st.saved = true; st.id = r.id;
  }
  onProgress("อ่านเบอร์ในโปรเจค…");
  let pms = await listRows("part_master", { filters: { project_id: projectId }, strict: true });
  let pmBy = new Map(pms.map((p) => [NC(p.part_no), p]));
  const want = [
    ...need.panels.map((p) => ({ code: p.code, kind: "panel", d: p.d, l: null, inv: null })),
    ...need.subs.map((s) => ({ code: s.code, kind: "subassembly", d: s.d, l: s.l, inv: null })),
    ...need.parts.map((p) => ({ code: p.code, kind: "part", d: p.d, l: p.l, inv: p.inv })),
  ];
  if (!st.created) {
    const miss = want.filter((w) => !pmBy.has(NC(w.code)));
    for (let i = 0; i < miss.length; i += 200) {
      onProgress(`สร้างเบอร์ใหม่ ${Math.min(i + 200, miss.length)}/${miss.length}`);
      await insertRows("part_master", miss.slice(i, i + 200).map((w) => ({ project_id: projectId, part_no: w.code, part_name: w.d || w.code, material: w.inv || null, unit_weight: 0, default_length_mm: w.l ?? null, routing: [], kind: w.kind })));
    }
    st.created = true;
    if (miss.length) { pms = await listRows("part_master", { filters: { project_id: projectId }, strict: true }); pmBy = new Map(pms.map((p) => [NC(p.part_no), p])); }
  }
  if (!st.kinds) {
    const todo = want.filter((w) => w.kind !== "part").filter((w) => { const pm = pmBy.get(NC(w.code)); return pm && pm.kind !== w.kind; });
    const errs = await pool(todo, 6, async (w) => { await updateRow("part_master", pmBy.get(NC(w.code)).id, { kind: w.kind }); }, (d, n) => onProgress(`ตั้งชนิดเบอร์ ${d}/${n}`));
    if (errs.length) st.errors.push(`ตั้งชนิดไม่สำเร็จ ${errs.length} เบอร์`); else st.kinds = true;
  }
  if (!st.boms) {
    const missing = [];
    const jobs = bomSave.list.map((b) => ({ code: b.code, parent: pmBy.get(NC(b.code)), comps: b.children.map((c) => { const pm = pmBy.get(NC(c.code)); if (!pm) missing.push(`${b.code} › ${c.code}`); return pm ? { child_pm_id: pm.id, qty: c.qty } : null; }).filter(Boolean) })).filter((j) => j.parent && j.comps.length);
    const errs = await pool(jobs, 4, async (j) => { const r = await setBom(j.parent.id, j.comps); if (r && r.ok === false) throw new Error(r.reason || "set_bom"); }, (d, n) => onProgress(`ตั้ง BOM ${d}/${n}`));
    if (missing.length) st.errors.push(`ลูกที่ยังไม่มีในระบบ ${missing.length} รายการ: ${missing.slice(0, 4).join(", ")}`);
    if (errs.length) st.errors.push(`ตั้ง BOM ไม่สำเร็จ ${errs.length} เบอร์ (${errs.slice(0, 4).map((x) => x.item.code).join(", ")})`); else if (!missing.length) st.boms = true;
  }
  if (!st.names) {
    const todo = want.filter((w) => w.d).map((w) => [w, pmBy.get(NC(w.code))]).filter(([w, pm]) => pm && (!pm.part_name || NC(pm.part_name) === NC(pm.part_no)) && NC(w.d) !== NC(pm.part_no));
    await pool(todo, 6, async ([w, pm]) => { await updatePartMaster(pm.id, { part_name: w.d, material: pm.material ?? null, unit_weight: pm.unit_weight ?? 0, default_length_mm: pm.default_length_mm ?? null }); }, (d, n) => onProgress(`เติมชื่อเบอร์ ${d}/${n}`));
    st.names = true;
  }
  return st;
}

// ══ ซับ / พาร์ท ของโปรเจค (คลัง) ══
//   (1) สร้างเบอร์ที่ยังไม่มีใน part_master (ซับ + พาร์ท) (2) ชนิดซับ (3) BOM ของซับ (ลูก = ซับ + พาร์ทที่มี QR) (4) ชื่อเบอร์
//   (5) แถว LIB ใน release_plans: หมวด / งานซับ / ใบงาน / ชนิด hw / PDF ที่เคยอัพ — Release ใหม่ใช้เป็นค่าเริ่ม
export async function saveLibrary({ projectId, projectCode, bom, newCodes, catOv, procOv, destOv, partMode, partGroups, catOf, pdfs, by }, onProgress = () => {}) {
  const st = { errors: [] };
  const subCodes = Object.keys(bom.subs); const partCodes = Object.keys(bom.parts);
  const qr = (c) => { const p = bom.parts[c]; return p && p.k !== "hw" && QR_CATS.has(catOf ? catOf(c, p.k || "part") : (catOv[c] || ruleCat(c, p.k || "part"))); };
  onProgress("อ่านเบอร์ในโปรเจค…");
  let pms = await listRows("part_master", { filters: { project_id: projectId }, strict: true });
  let pmBy = new Map(pms.map((p) => [NC(p.part_no), p]));
  const want = [
    ...subCodes.map((c) => ({ code: c, kind: "subassembly", d: bom.subs[c].d || "", l: bom.subs[c].l ?? null, inv: null })),
    ...partCodes.map((c) => ({ code: c, kind: "part", d: bom.parts[c].d || "", l: bom.parts[c].l ?? null, inv: bom.parts[c].binv || bom.parts[c].m || null })),
  ];
  const miss = want.filter((w) => !pmBy.has(NC(w.code)));
  for (let i = 0; i < miss.length; i += 200) {
    onProgress(`สร้างเบอร์ใหม่ ${Math.min(i + 200, miss.length)}/${miss.length}`);
    await insertRows("part_master", miss.slice(i, i + 200).map((w) => ({ project_id: projectId, part_no: w.code, part_name: w.d || w.code, material: w.inv || null, unit_weight: 0, default_length_mm: w.l ?? null, routing: [], kind: w.kind })));
  }
  if (miss.length) { pms = await listRows("part_master", { filters: { project_id: projectId }, strict: true }); pmBy = new Map(pms.map((p) => [NC(p.part_no), p])); }
  const kinds = want.filter((w) => w.kind !== "part").filter((w) => { const pm = pmBy.get(NC(w.code)); return pm && pm.kind !== w.kind; });
  const e1 = await pool(kinds, 6, async (w) => { await updateRow("part_master", pmBy.get(NC(w.code)).id, { kind: w.kind }); }, (d, n) => onProgress(`ตั้งชนิดเบอร์ ${d}/${n}`));
  if (e1.length) st.errors.push(`ตั้งชนิดไม่สำเร็จ ${e1.length} เบอร์`);
  // BOM ซับ — เฉพาะซับที่อัพ PDF ใหม่รอบนี้ (ซับเดิมในระบบไม่แตะ)
  const jobs = subCodes.filter((c) => !newCodes || newCodes.has(NC(c))).map((c) => {
    const comp = new Map();
    for (const it of bom.subs[c].items || []) { if ((it[4] || "") === "ยกเลิก") continue; const [t, cc, q] = it; if (!(q > 0)) continue; const ok = t === "sub" ? !!findKey(bom.subs, cc) : qr(findKey(bom.parts, cc) || cc); if (!ok) continue; const pm = pmBy.get(NC(cc)); if (!pm) continue; const e = comp.get(pm.id) || { child_pm_id: pm.id, qty: 0 }; e.qty += q; comp.set(pm.id, e); }
    return { code: c, parent: pmBy.get(NC(c)), comps: [...comp.values()].map((e) => ({ ...e, qty: Math.max(1, Math.round(e.qty)) })) };
  }).filter((j) => j.parent && j.comps.length);
  const e2 = await pool(jobs, 4, async (j) => { const r = await setBom(j.parent.id, j.comps); if (r && r.ok === false) throw new Error(r.reason || "set_bom"); }, (d, n) => onProgress(`ตั้ง BOM ซับ ${d}/${n}`));
  if (e2.length) st.errors.push(`ตั้ง BOM ไม่สำเร็จ ${e2.length} เบอร์ (${e2.slice(0, 4).map((x) => x.item.code).join(", ")})`);
  const names = want.filter((w) => w.d).map((w) => [w, pmBy.get(NC(w.code))]).filter(([w, pm]) => pm && (!pm.part_name || NC(pm.part_name) === NC(pm.part_no)) && NC(w.d) !== NC(pm.part_no));
  await pool(names, 6, async ([w, pm]) => { await updatePartMaster(pm.id, { part_name: w.d, material: pm.material ?? null, unit_weight: pm.unit_weight ?? 0, default_length_mm: pm.default_length_mm ?? null }); }, (d, n) => onProgress(`เติมชื่อเบอร์ ${d}/${n}`));
  // แถว LIB
  onProgress("บันทึกหมวด / งานซับ / ใบงาน…");
  const hwKinds = {}; for (const c of partCodes) if (bom.parts[c].k === "hw") hwKinds[c] = "hw";
  let old = null; try { old = (await listPlans(projectId)).lib; } catch (e) { if (e && e.code === "not_installed") { st.errors.push("ยังไม่ได้รัน migration-release-plans.sql — หมวด/งานซับไม่ถูกเก็บ"); return st; } throw e; }
  // ★ 2026-10-16: เก็บรายการลูก "ครบทุกบรรทัด" ของซับที่อัพรอบนี้ (รวมสกรู/ยาง/กระจก ที่ไม่มี QR จึงไม่อยู่ใน BOM ของระบบ) ไว้โชว์ตอนกางดูเบอร์ลูก
  const subItems = { ...(old?.subItems || {}) };
  for (const c of subCodes) { if (newCodes && !newCodes.has(NC(c))) continue; subItems[c] = (bom.subs[c].items || []).filter((it) => (it[4] || "") !== "ยกเลิก").map((it) => [it[0], it[1], it[2]]); }
  const body = { v: 1, kind: "lib", subItems, projectCode, catOv, procOv, destOv, partMode: partMode || "auto", partGroups: partGroups || [], kinds: hwKinds, pdfs: [...(old?.pdfs || []).filter((d) => !(pdfs || []).some((n) => n.file === d.file)), ...(pdfs || [])], by, updatedAt: new Date().toISOString() };
  await planRpc(projectId, "LIB", body, old ? old.id : null);
  return st;
}

// ปล่อย 1 ล็อต: rows จาก lotRows() → create_release_batch (release_order = เลขล็อต · QR ทุกชิ้น) + Modify + INV ใหม่
export async function releaseLot({ plan, lotNo, date, userId, rows }, onProgress = () => {}) {
  if (!rows || !rows.length) throw new Error("ยังไม่ได้เลือกอะไร");
  onProgress(`ตรวจเลขล็อต ${lotNo}…`);
  if (await releaseOrderExists(plan.projectId, lotNo)) { const e = new Error(`เลขล็อต ${lotNo} ถูกใช้แล้ว (อาจมีคนปล่อยไปก่อน) — รีเฟรชแล้วเลือกใหม่`); e.code = "exists"; throw e; }
  let wOf = () => 0;
  try { wOf = await weightIndex(plan.projectId); } catch (_) { /* ไม่มีบันทึก Material = น้ำหนัก 0 */ }
  onProgress(`สร้างล็อต ${lotNo} + QR (${rows.length} เบอร์)…`);
  const res = await createReleaseBatch({
    projectId: plan.projectId, releaseOrder: lotNo, releaseDate: date, releasedBy: userId, makeQr: true,
    rows: rows.map((r) => ({ code: r.code, qty: r.qty, unit_weight: r.kind === "part" ? wOf(r.material, r.length_mm) || 0 : 0, length_mm: r.length_mm ?? null, material: r.material || null, remark: r.remark || null, routing: [] })),
  });
  try { const ids = await listReleaseIdsOfOrder(plan.projectId, lotNo); await setReleaseMdf(ids, String(plan.mod || "").trim() || "0"); } catch (_) { /* DB เก่า */ }
  try { const invs = [...new Set(rows.filter((r) => r.kind === "part").map((r) => r.material).filter(Boolean))].map((inv) => ({ inv, wpm: null })); if (invs.length) await addMaterialsFromRelease(plan.projectId, lotNo, invs); } catch (_) { /* ignore */ }
  return res;
}

// ══ Modify Release ══
// ยอดที่ทำแล้ว / QR ที่ยังไม่ใช้ ต่อแถว release ของทุกล็อต (get_release_modify_info) + เลข M ถัดไปที่สูงสุด
export async function lotLimits(plan, lotNos) {
  const limits = new Map(); let nextNo = 0;
  for (const lot of lotNos) {
    const info = await getReleaseModifyInfo(plan.projectId, lot);
    if (!info || info.ok === false) { if (info?.reason === "not_installed") continue; throw new Error(`อ่านข้อมูลล็อต ${lot} ไม่ได้ (${info?.message || info?.reason || "error"})`); }
    for (const [rid, v] of Object.entries(info.limits || {})) limits.set(rid, v);
    nextNo = Math.max(nextNo, Number(info.next_no) || 0);
  }
  return { limits, nextNo };
}
// บันทึก Modify: (1) ลด/ยกเลิกในแต่ละล็อตด้วย apply_release_modify (เลข M เดียวกันทุกล็อต · ทีละล็อต · พังล็อตไหนหยุดที่นั่น)
//                (2) เก็บประวัติ M + ยอดใหม่ลงแผน
export async function modifyRelease({ plan, mod, lotOps, docDate }, onProgress = () => {}) {
  const done = [];
  for (const [lot, ops] of lotOps) {
    onProgress(`Modify ${lot} (${ops.length} รายการ)…`);
    const items = ops.map((o) => (o.type === "cancel" ? { release_id: o.release_id, type: "cancel", keep: o.keep || "spare" } : { release_id: o.release_id, type: "qty", dir: o.dir, n: o.n }));
    const res = await applyReleaseModify({ projectId: plan.projectId, releaseOrder: lot, versionNo: mod.no, reason: `${mod.reason} (Release ${plan.ro} ${mod.ver})`, items, docDate });
    if (!res || !res.ok) {
      if (done.length) {   // ล็อตก่อนหน้าแก้ไปแล้ว → บันทึกเฉพาะส่วนที่สำเร็จลงแผน (ไม่ให้ยอดในแผนกับล็อตไม่ตรงกัน)
        const part = { ...mod, partial: true, items: mod.items.filter((it) => !(it.lots || []).length || (it.lots || []).every((l) => done.includes(l.lot))) };
        try { await updatePlan(applyModToPlan(plan, part)); } catch (_) { /* ignore */ }
      }
      const e = new Error(`Modify ${lot} ไม่สำเร็จ: ${res?.message || res?.reason || "error"}${done.length ? ` · ล็อตที่แก้สำเร็จแล้ว: ${done.join(", ")}` : " · ยังไม่มีอะไรถูกแก้"}`);
      e.partial = done; throw e;
    }
    done.push(lot);
  }
  onProgress(`บันทึก ${mod.ver} ลง Release ${plan.ro}…`);
  const np = applyModToPlan(plan, mod);
  await updatePlan(np);
  return np;
}

export const realReleaseApi = { projectContext, loadBomLibrary, saveLibrary, orderExists, saveRelease, savePlan, updatePlan, listPlans, releaseLot, lotLimits, modifyRelease };
