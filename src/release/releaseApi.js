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
  listReleaseIdsOfOrder, setReleaseMdf, addMaterialsFromRelease, getMaterials, getReleaseModifyInfo, applyReleaseModify, revertReleaseModify,
  deleteReleaseCascade, countReleaseStationRecords,
} from "../supabase.js";
import { getSession } from "../auth.js";
import { NC, findKey, QR_CATS, ruleCat, addrNote, projectContext, applyModToPlan, baseOf, findLatest } from "./releaseCore.js";

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
  try { const r = await listPlans(projectId); if (r.lib) { lib.ov = { catOv: r.lib.catOv || {}, procOv: r.lib.procOv || {}, destOv: r.lib.destOv || {}, partMode: r.lib.partMode || "auto", partGroups: r.lib.partGroups || [] }; lib.libId = r.lib.id; lib.pdfs = r.lib.pdfs || []; for (const [c, its] of Object.entries(r.lib.subItems || {})) { const sk = Object.keys(lib.subs).find((x) => NC(x) === NC(c)); if (sk) lib.subs[sk].full = its; } for (const [c, k] of Object.entries(r.lib.kinds || {})) { const pk = Object.keys(lib.parts).find((x) => NC(x) === NC(c)); if (pk && k === "hw") lib.parts[pk].k = "hw"; } for (const [c, un] of Object.entries(r.lib.units || {})) { const pk = Object.keys(lib.parts).find((x) => NC(x) === NC(c)); if (pk && un) { if (un.u) lib.parts[pk].u = un.u; if (un.mm) lib.parts[pk].mm = 1; } } } } catch (_) { /* ยังไม่รัน migration-release-plans.sql */ }
  return lib;
}

// ═ เก็บ / เปิด ตัวไฟล์ PDF ของซับ-พาร์ท (Storage bucket "release-pdfs" · ต้องรัน migration-release-pdfs.sql) ═
//   path = <projectId>/<sub|part>/<เบอร์>.pdf · อัพซ้ำเบอร์เดิม = ทับไฟล์เดิม
const PDF_BUCKET = "release-pdfs";
const safeSeg = (x) => String(x || "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "x";
const libPdfPath = (projectKey, d) => `${safeSeg(projectKey)}/${d.kind === "part" ? "part" : "sub"}/${safeSeg(d.famOf || d.code)}.pdf`;   // แผ่นหลายเบอร์ (famOf) เก็บไฟล์เดียวในชื่อเบอร์ของแผ่น
// ★ 2026-11-12 R5: โปรเจครหัสเดียวกันหลายตึก → เดิมใช้โฟลเดอร์ <รหัส> ร่วมกัน แบบตึกหนึ่งทับอีกตึก
//   ตอนนี้: รหัสนี้มีโปรเจคเดียว = <รหัส> (เหมือนเดิม) · มีหลายโปรเจค = <รหัส>_<id 8 ตัวแรก> แยกตึก
//   ไฟล์เก่าเปิดจาก path ที่เก็บไว้ในคลัง (pdfs[].path) จึงยังเปิดได้ตามเดิม
const folderCache = new Map();
export async function pdfFolderOf(projectId, projectCode) {
  const code = String(projectCode || "").trim();
  if (!code || !projectId) return String(projectId || code);
  const ck = `${projectId}|${code}`; if (folderCache.has(ck)) return folderCache.get(ck);
  let shared = false;
  try { const all = await listRows("projects"); shared = (all || []).some((x) => x.id !== projectId && safeSeg(x.code) === safeSeg(code)); }
  catch (_) { shared = true; }   // อ่านรายการโปรเจคไม่ได้ = แยกโฟลเดอร์ไว้ก่อน (ปลอดภัยกว่าทับ)
  const f = shared ? `${code}_${String(projectId).slice(0, 8)}` : code;
  folderCache.set(ck, f); return f;
}
async function uploadLibPdf(projectKey, d) {
  const path = libPdfPath(projectKey, d);
  const { error } = await supabase.storage.from(PDF_BUCKET).upload(path, d._file, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
  return path;
}
// ดูโฟลเดอร์ใน Storage (เฉพาะ bucket ที่ระบุ) · คืน [{ name, file:boolean, size, updated }] โฟลเดอร์มาก่อน
const BROWSE_OK = new Set([PDF_BUCKET, "packing-photos"]);
export async function listStorage(bucket, prefix = "") {
  if (!BROWSE_OK.has(bucket)) throw new Error("bucket not allowed");
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 500, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  return (data || []).filter((x) => x.name !== ".emptyFolderPlaceholder").map((x) => ({ name: x.name, file: !!x.id, size: x.metadata?.size ?? null, updated: x.updated_at || x.created_at || null }))
    .sort((a, b) => (a.file === b.file ? 0 : a.file ? 1 : -1));
}
export async function signedUrls(bucket, paths) {
  if (!BROWSE_OK.has(bucket)) throw new Error("bucket not allowed");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 600);
  if (error) throw error;
  const m = {}; for (const x of data || []) if (x.signedUrl) m[x.path] = x.signedUrl;
  return m;
}
export async function getLibPdfUrl(path) {
  const { data, error } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
export async function downloadLibPdf(path, name = "file.pdf") {
  const { data, error } = await supabase.storage.from(PDF_BUCKET).download(path);
  if (error) throw error;
  return new File([data], name, { type: "application/pdf" });
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
  // ★ 2026-11-09 projectCode = รหัสโปรเจคปัจจุบันจาก DB (ในแผนเป็นรหัสตอนสร้าง — เปลี่ยนรหัสโปรเจคแล้วล็อตไม่เข้าใบหลัก เห็นเลขเดียวกันสองแถว)
  // ★ 2026-11-12 R1: _at = updated_at ของแถวตอนโหลด — ติดไปกับใบ (และทุกสำเนาที่แก้ต่อจากใบนี้) · updatePlan ส่งกลับไปเทียบ ไม่ตรง = มีคนแก้ไปก่อน → ไม่บันทึกทับ
  const all = (data || []).map((r) => ({ ...(r.plan || {}), _at: r.updated_at || null, id: r.id, projectId: r.project_id, ro: r.release_order, status: r.status, by: (r.plan && r.plan.by) || r.created_by_name || "", ...(r.project_code ? { projectCode: r.project_code } : {}) }));
  // แถว LIB = คลังซับ/พาร์ทของโปรเจค (ไม่ใช่ Release) → แยกออก · แถว DRAFT = ร่าง "ปล่อยงานใหม่" ของผู้ใช้ (★ 2026-11-10) → แยกออก
  const isDraft = (p) => p.kind === "draft" || /^DRAFT:/i.test(String(p.ro));
  return { ok: true, plans: all.filter((p) => p.kind !== "lib" && String(p.ro).toUpperCase() !== "LIB" && !isDraft(p)), lib: all.find((p) => p.kind === "lib" || String(p.ro).toUpperCase() === "LIB") || null, drafts: all.filter(isDraft) };
}
// ★ 2026-11-10 ร่าง "ปล่อยงานใหม่" เก็บบนเซิร์ฟเวอร์ด้วย (แถว release_plans · ro = "DRAFT:<employee id>" ต่อโปรเจค · plan.kind = "draft")
//   → เปิดจากเครื่องอื่นแล้วกด "ทำต่อ" ได้ (เดิมอยู่แค่ localStorage ของเครื่องที่พิมพ์) · เก็บได้เมื่อเลือกโปรเจคแล้ว (แถวต้องมี project_id)
const draftRo = (userId) => `DRAFT:${userId}`;
export async function listDrafts(userId) {
  if (!userId) return [];
  const r = await listPlans(null); if (!r.ok) return [];
  return (r.drafts || []).filter((d) => String(d.ro).toUpperCase() === draftRo(userId).toUpperCase() && d.status !== "cancelled").map((d) => ({ ...d.draft, serverId: d.id, projectId: d.projectId }));
}
export async function saveDraft({ projectId, userId, draft, id = null }) {
  if (!projectId || !userId) return null;
  const body = { kind: "draft", by: draft.by || "", at: draft.at, draft };
  try { const r = await planRpc(projectId, draftRo(userId), body, id); return r.id || id; }
  catch (e) {
    if (e.code !== "exists") throw e;
    const cur = (await listDrafts(userId)).find((d) => d.projectId === projectId); if (!cur) throw e;
    const r = await planRpc(projectId, draftRo(userId), body, cur.serverId); return r.id || cur.serverId;
  }
}
export async function dropDraft(id) {
  if (!id) return;
  const { data, error } = await supabase.rpc("release_plan_set_status", { p_token: tok(), p_id: id, p_status: "cancelled", p_keep_lots: true });
  if (error) { if (missingFn(error)) return; throw error; }
  return data;
}
async function planRpc(projectId, ro, plan, id = null, baseAt = null) {
  const args = { p_token: tok(), p_project_id: projectId, p_release_order: ro, p_plan: plan, p_id: id };
  let { data, error } = await supabase.rpc("release_plan_save", baseAt ? { ...args, p_base_at: baseAt } : args);
  // ฐานข้อมูลยังไม่ได้รัน migration-critical-fixes-2026-11-12.sql (ไม่มี p_base_at) → บันทึกแบบเดิม
  if (error && baseAt && missingFn(error)) ({ data, error } = await supabase.rpc("release_plan_save", args));
  if (error) { if (missingFn(error)) throw notInstalled(); throw error; }
  if (data && data.ok === false && data.reason === "conflict") {
    const t = data.updated_at ? new Date(data.updated_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "";
    const e = new Error(`ใบ ${ro} ถูกแก้${data.updated_by_name ? `โดย ${data.updated_by_name}` : "จากที่อื่น"}${t ? ` เมื่อ ${t}` : ""} หลังจากคุณเปิดใบนี้ — ไม่ได้บันทึกทับ · โหลดใบล่าสุดให้แล้ว แก้ใหม่อีกครั้ง`);
    e.code = "conflict"; throw e;
  }
  if (data && data.ok === false) { const e = new Error(data.reason === "duplicate" ? `Release ${ro} มีอยู่แล้ว` : `บันทึกแผนไม่สำเร็จ (${data.reason})`); e.code = data.reason === "duplicate" ? "exists" : data.reason; throw e; }
  return data || {};
}
// ★ 2026-11-09 ลบใบหลัก (status = cancelled) — ได้เฉพาะใบที่ไม่มีล็อตเหลือ · ลบแล้วใช้เลขเดิมลงใหม่ได้
//   (ต้องรัน migration-release-plans.sql รอบใหม่ — ฝั่ง DB เช็คล็อต + ปลดเลขซ้ำ)
//   keepLots = ลบเฉพาะใบหลัก ล็อตที่ปล่อยแล้ว (QR) อยู่ครบ — เช่น สร้างใบหลักซ้ำโดยไม่ตั้งใจ
export async function deletePlan(plan, { keepLots = false } = {}) {
  const { data, error } = await supabase.rpc("release_plan_set_status", { p_token: tok(), p_id: plan.id, p_status: "cancelled", ...(keepLots ? { p_keep_lots: true } : {}) });
  if (error) { if (missingFn(error)) throw notInstalled(); throw error; }
  if (data && data.ok === false) {
    const e = new Error(data.reason === "has_lots" ? `${plan.ro} ยังมีล็อตที่ปล่อยแล้ว — ลบล็อตทั้งหมดก่อน แล้วจึงลบใบหลัก` : `ลบใบ ${plan.ro} ไม่สำเร็จ (${data.reason})`);
    e.code = data.reason; throw e;
  }
  return true;
}
// แก้แผน (เช่น office เปลี่ยนงานของซับ / ใบงานพาร์ทตอนปล่อยล็อต)
// ★ 2026-11-12 R1: ส่ง plan._at (เวอร์ชันที่ใบนี้แก้ต่อมา) ไปเทียบ · สำเร็จ = อัปเดต plan._at ให้ (แก้ต่อจากใบเดิมได้โดยไม่ชนตัวเอง)
export async function updatePlan(plan) {
  const { id, _at, ...body } = plan;
  const r = await planRpc(plan.projectId, plan.ro, body, id, _at || null);
  if (r && r.updated_at) { try { plan._at = r.updated_at; } catch (_) { /* frozen */ } }
  return r;
}
// เช็คก่อนแก้ล็อต (Modify / ย้อน M): ใบในฐานข้อมูลยังเป็นรุ่นที่เปิดอยู่ไหม — ไม่ใช่ = หยุดก่อนแตะล็อต
async function assertPlanFresh(plan) {
  if (!plan || !plan.id || !plan._at) return;
  const r = await listPlans(plan.projectId || null);
  const cur = (r.plans || []).find((x) => x.id === plan.id);
  if (cur && cur._at && cur._at !== plan._at) {
    const e = new Error(`ใบ ${plan.ro} ถูกแก้จากที่อื่นหลังจากคุณเปิดใบนี้ — ยังไม่มีอะไรถูกแก้ · โหลดใบล่าสุดให้แล้ว ทำใหม่อีกครั้ง`); e.code = "conflict"; throw e;
  }
}

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
  // ★ 2026-11-03 ลูกที่เป็นพาร์ท → ใช้รุ่นล่าสุดในคลัง (BOM เขียน "X A" แต่มี "X B" แล้ว = ตั้งเป็น B) · ซับเดิมที่อ้างรุ่นเก่าของพาร์ทที่อัพรอบนี้ → ตั้ง BOM ใหม่ด้วย
  const newBases = new Set([...(newCodes || [])].filter((c) => bom.parts[findKey(bom.parts, c)] ).map((c) => baseOf(c)));
  const refsNew = (c) => (bom.subs[c].items || []).some((it) => it[0] !== "sub" && newBases.has(baseOf(it[1])) && findLatest(bom.parts, it[1]) !== findKey(bom.parts, it[1]));
  const jobs = subCodes.filter((c) => !newCodes || newCodes.has(NC(c)) || refsNew(c)).map((c) => {
    const comp = new Map();
    for (const it of bom.subs[c].items || []) { if ((it[4] || "") === "ยกเลิก") continue; const [t, cc0, q] = it; if (!(q > 0)) continue; const cc = t === "sub" ? cc0 : (findLatest(bom.parts, cc0) || cc0); const ok = t === "sub" ? !!findKey(bom.subs, cc) : qr(findKey(bom.parts, cc) || cc); if (!ok) continue; const pm = pmBy.get(NC(cc)); if (!pm) continue; const e = comp.get(pm.id) || { child_pm_id: pm.id, qty: 0 }; e.qty += q; comp.set(pm.id, e); }
    return { code: c, parent: pmBy.get(NC(c)), comps: [...comp.values()].map((e) => ({ ...e, qty: Math.max(1, Math.round(e.qty)) })) };
  }).filter((j) => j.parent && j.comps.length);
  const e2 = await pool(jobs, 4, async (j) => { const r = await setBom(j.parent.id, j.comps); if (r && r.ok === false) throw new Error(r.reason || "set_bom"); }, (d, n) => onProgress(`ตั้ง BOM ซับ ${d}/${n}`));
  if (e2.length) st.errors.push(`ตั้ง BOM ไม่สำเร็จ ${e2.length} เบอร์ (${e2.slice(0, 4).map((x) => x.item.code).join(", ")})`);
  const names = want.filter((w) => w.d).map((w) => [w, pmBy.get(NC(w.code))]).filter(([w, pm]) => pm && (!pm.part_name || NC(pm.part_name) === NC(pm.part_no)) && NC(w.d) !== NC(pm.part_no));
  await pool(names, 6, async ([w, pm]) => { await updatePartMaster(pm.id, { part_name: w.d, material: pm.material ?? null, unit_weight: pm.unit_weight ?? 0, default_length_mm: pm.default_length_mm ?? null }); }, (d, n) => onProgress(`เติมชื่อเบอร์ ${d}/${n}`));
  // แถว LIB
  onProgress("บันทึกหมวด / งานซับ / ใบงาน…");
  const hwKinds = {}; for (const c of partCodes) if (bom.parts[c].k === "hw") hwKinds[c] = "hw";
  // ★ 2026-10-26 หน่วยของสกรู/ยาง (pcs. / m. + วัดเป็นมม.) — part_master ไม่มีช่องนี้ → เก็บใน LIB row
  const hwUnits = {}; for (const c of partCodes) { const p = bom.parts[c]; if (p.k === "hw" && (p.u || p.mm)) hwUnits[c] = { u: p.u || "", mm: p.mm ? 1 : 0 }; }
  let old = null; try { old = (await listPlans(projectId)).lib; } catch (e) { if (e && e.code === "not_installed") { st.errors.push("ยังไม่ได้รัน migration-release-plans.sql — หมวด/งานซับไม่ถูกเก็บ"); return st; } throw e; }
  // ★ 2026-10-16: เก็บรายการลูก "ครบทุกบรรทัด" ของซับที่อัพรอบนี้ (รวมสกรู/ยาง/กระจก ที่ไม่มี QR จึงไม่อยู่ใน BOM ของระบบ) ไว้โชว์ตอนกางดูเบอร์ลูก
  // เก็บตัวไฟล์ PDF ที่อัพรอบนี้ (ไม่สำเร็จ = เตือน แต่ข้อมูลที่อ่านได้ยังบันทึกตามปกติ)
  const pdfsOut = [];
  const upErrs = [];
  // ไฟล์เดียวกันที่แตกเป็นหลายเบอร์ (famOf) อัพครั้งเดียว
  const folder = await pdfFolderOf(projectId, projectCode);
  const upOnce = new Map(); for (const d of (pdfs || []).filter((x) => x._file)) { const k = libPdfPath(folder, d); if (!upOnce.has(k)) upOnce.set(k, []); upOnce.get(k).push(d); }
  await pool([...upOnce.values()], 4, async (ds) => { const path = await uploadLibPdf(folder, ds[0]); for (const d of ds) d.path = path; }, (n, m) => onProgress(`เก็บไฟล์ PDF ${n}/${m}`)).then((errs) => errs.forEach((x) => upErrs.push(x)));
  for (const d of pdfs || []) pdfsOut.push({ file: d.file, kind: d.kind, code: d.code, ...(d.path ? { path: d.path } : {}) });
  if (upErrs.length) { const m = String(upErrs[0].e?.message || upErrs[0].e || ""); st.errors.push(/bucket|not found|404/i.test(m) ? "ยังไม่ได้รัน migration-release-pdfs.sql — ไม่ได้เก็บตัวไฟล์ PDF (ข้อมูลที่อ่านได้บันทึกแล้ว)" : `เก็บไฟล์ PDF ไม่สำเร็จ ${upErrs.length} ไฟล์ (${m.slice(0, 80)})`); }
  const subItems = { ...(old?.subItems || {}) };
  for (const c of subCodes) { if (newCodes && !newCodes.has(NC(c))) continue; subItems[c] = (bom.subs[c].items || []).filter((it) => (it[4] || "") !== "ยกเลิก").map((it) => [it[0], it[1], it[2]]); }
  const body = { v: 1, kind: "lib", subItems, projectCode, catOv, procOv, destOv, partMode: partMode || "auto", partGroups: partGroups || [], kinds: { ...(old?.kinds || {}), ...hwKinds }, units: { ...(old?.units || {}), ...hwUnits }, pdfs: [...(old?.pdfs || []).filter((d) => !pdfsOut.some((n) => NC(n.code) === NC(d.code) && n.kind === d.kind)), ...pdfsOut], by, updatedAt: new Date().toISOString() };
  await planRpc(projectId, "LIB", body, old ? old.id : null);
  return st;
}

// ★ 2026-11-12 ผู้ใช้: "ดูแบบ ถ้ามีการอัพใหม่หรือ Modify จะเปิดตัวใหม่ไหม" → ตอนบันทึก Modify / เพิ่มรายการ เก็บไฟล์ PDF ที่วางไว้ลงคลังโปรเจคด้วย
//   (ไม่แตะ BOM / part_master — แค่อัพไฟล์ทับของเดิมเบอร์เดียวกัน + อัปเดตรายการไฟล์ในแถว LIB)
export async function storeLibPdfs({ projectId, projectCode, pdfs }, onProgress = () => {}) {
  const ds = (pdfs || []).filter((d) => d && d._file && d.code && ["part", "sub", "panel"].includes(d.kind));
  if (!ds.length || !projectId) return { n: 0 };
  const folder = await pdfFolderOf(projectId, projectCode);
  const upOnce = new Map(); for (const d of ds) { const k = libPdfPath(folder, d); if (!upOnce.has(k)) upOnce.set(k, []); upOnce.get(k).push(d); }
  const out = [];
  const errs = await pool([...upOnce.values()], 4, async (g) => { const path = await uploadLibPdf(folder, g[0]); for (const d of g) out.push({ file: d.file, kind: d.kind, code: d.code, path }); }, (n, m) => onProgress(`เก็บไฟล์แบบลงคลัง ${n}/${m}`));
  if (!out.length) { const m = errs.length ? String(errs[0].e?.message || errs[0].e || "") : ""; throw new Error(m || "เก็บไฟล์แบบไม่สำเร็จ"); }
  const old = (await listPlans(projectId)).lib;
  const { id: _i, projectId: _p, ro: _r, status: _s, ...keep } = old || {};
  const body = { ...(old ? keep : { v: 1, kind: "lib", projectCode }), pdfs: [...((old && old.pdfs) || []).filter((d) => !out.some((n) => NC(n.code) === NC(d.code) && n.kind === d.kind)), ...out], updatedAt: new Date().toISOString() };
  await planRpc(projectId, "LIB", body, old ? old.id : null);
  return { n: out.length, failed: errs.length };
}

// ปล่อย 1 ล็อต: rows จาก lotRows() → create_release_batch (release_order = เลขล็อต · QR ทุกชิ้น) + Modify + INV ใหม่
//   append = เพิ่มเข้าล็อตที่ปล่อยแล้ว (เลขล็อตเดิม · แถวใหม่ + QR ใหม่ต่อท้ายในใบปล่อยเดียวกัน) — ผู้ใช้ยืนยันแล้ว
export async function releaseLot({ plan, lotNo, date, userId, rows, append = false }, onProgress = () => {}) {
  if (!rows || !rows.length) throw new Error("ยังไม่ได้เลือกอะไร");
  onProgress(`ตรวจเลขล็อต ${lotNo}…`);
  const used = await releaseOrderExists(plan.projectId, lotNo);
  if (used && !append) { const e = new Error(`เลขล็อต ${lotNo} ถูกใช้แล้ว (อาจมีคนปล่อยไปก่อน) — รีเฟรชแล้วเลือกใหม่`); e.code = "exists"; throw e; }
  if (!used && append) { const e = new Error(`ไม่พบล็อต ${lotNo} ที่จะเพิ่มเข้า — รีเฟรชแล้วลองใหม่`); e.code = "not_found"; throw e; }
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
  onProgress(`ตรวจว่าใบ ${plan.ro} ยังเป็นรุ่นล่าสุด…`);
  await assertPlanFresh(plan);   // ★ R1: สองคนบันทึก M พร้อมกัน = คนที่สองหยุดก่อนแตะล็อต (ไม่ได้เลข M ซ้ำ)
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

// ★ 2026-11-12 ย้อน M ด้วย Ctrl+Z: (1) ล็อตที่ M นี้ลด/ยกเลิก → ยกเลิก M ในล็อตนั้นด้วย revert_release_modify (mode "cancel")
//   เช็คทุกล็อตก่อน (dry-run) — ล็อตไหนย้อนไม่ได้ (QR ที่มาจาก M ถูกสแกนแล้ว / มี M ใหม่กว่าแก้เบอร์เดียวกัน …) = ไม่แตะอะไรเลย
//   (2) คืนใบหลักเป็นก่อน M (prevPlan) + จดไว้ใน modUndone ว่าเคยมี M นี้แล้วถูกย้อน
//   lotsOfMod(mod) = ล็อตที่ M นี้แก้ · ไม่มีล็อต = ย้อนแค่ใบหลัก (ทำซ้ำได้)
export const lotsOfMod = (mod) => [...new Set((mod.items || []).flatMap((it) => (it.lots || []).map((l) => l.lot)).filter(Boolean))];
const REVERT_TXT = {
  revert_not_installed: "ฐานข้อมูลยังไม่มีส่วน “ยกเลิก M” (migration-release-modify-revert.sql)",
  revert_used: "ชิ้นงานที่มาจาก M นี้ถูกสแกน / ใช้ไปแล้ว", revert_conflict: "มี M ที่ใหม่กว่าแก้เบอร์เดียวกัน",
  revert_state_changed: "เบอร์ถูกแก้ต่อหลัง M นี้แล้ว", revert_inv_changed: "INV ถูกแก้ต่อจากที่อื่นแล้ว",
  revert_missing: "ไม่พบแถว Release นี้แล้ว", revert_qr_missing: "QR บางใบไม่อยู่ในระบบแล้ว", revert_qr_exists: "QR มีอยู่แล้ว",
  revert_target_locked: "Release ปลายทางมีงานผูกอยู่", already_reverted: "M นี้ถูกยกเลิกไปแล้ว",
};
export const revertText = (r) => REVERT_TXT[r?.reason] || r?.message || r?.reason || "error";
export async function undoModify({ plan, prevPlan, mod, by = "" }, onProgress = () => {}) {
  const lots = lotsOfMod(mod); const todo = [];
  await assertPlanFresh(plan);   // ★ R1
  for (const lot of lots) {
    onProgress(`ตรวจล็อต ${lot}…`);
    const info = await getReleaseModifyInfo(plan.projectId, lot);
    if (!info || info.ok === false) throw new Error(`อ่านข้อมูลล็อต ${lot} ไม่ได้ (${info?.message || info?.reason || "error"})`);
    const m = (info.mods || []).find((x) => Number(x.version_no) === Number(mod.no));
    if (!m) continue;                                  // ล็อตนี้ไม่ได้ถูกแก้จริง (เช่นบันทึกไม่ครบ)
    if (m.reverted) continue;                          // ยกเลิกไปแล้วจากหน้าล็อต
    const dry = await revertReleaseModify({ projectId: plan.projectId, releaseOrder: lot, mode: "cancel", version: m.version, dryRun: true });
    if (!dry || !dry.ok) throw new Error(`${lot}: ${revertText(dry)} — ย้อน ${mod.ver} ไม่ได้ (ยังไม่มีอะไรถูกแก้)`);
    todo.push({ lot, version: m.version });
  }
  const done = [];
  for (const t of todo) {
    onProgress(`ยกเลิก ${mod.ver} ในล็อต ${t.lot}…`);
    const r = await revertReleaseModify({ projectId: plan.projectId, releaseOrder: t.lot, mode: "cancel", version: t.version, reason: `Ctrl+Z ย้อน ${mod.ver} (Release ${plan.ro})` });
    if (!r || !r.ok) {
      const e = new Error(`${t.lot}: ${revertText(r)}${done.length ? ` · ล็อตที่ยกเลิก ${mod.ver} ไปแล้ว: ${done.join(", ")} (ใบหลักยังเป็น ${mod.ver} — ไปยกเลิกต่อที่หน้าล็อต)` : " · ยังไม่มีอะไรถูกแก้"}`);
      e.partial = done; throw e;
    }
    done.push(t.lot);
  }
  onProgress(`คืนใบ ${plan.ro} เป็นก่อน ${mod.ver}…`);
  const np = { ...prevPlan, id: plan.id, _at: plan._at, modUndone: [...(plan.modUndone || prevPlan.modUndone || []), { ver: mod.ver, no: mod.no, at: new Date().toISOString(), by, lots: done }] };
  try { await updatePlan(np); }
  catch (e) {   // ★ 2026-11-12 ยกเลิกในล็อตสำเร็จแล้วแต่บันทึกใบหลักไม่ได้ → บอกให้โหลดใหม่ (ล็อตเปลี่ยนแล้ว) · กด Ctrl+Z อีกครั้งได้ (ล็อตที่ยกเลิกแล้วจะข้าม)
    const e2 = new Error(`${done.length ? `ยกเลิก ${mod.ver} ในล็อต ${done.join(", ")} แล้ว แต่` : ""}บันทึกใบ ${plan.ro} ไม่สำเร็จ (${e?.message || e}) — กด Ctrl+Z อีกครั้งเพื่อลองใหม่`);
    e2.partial = done; throw e2;
  }
  return { np, lots: done };
}

// ★ 2026-11-04 ใบปะหน้า: Instruction No. = ครั้งที่ปล่อยในเดือน (เดือน 9 ครั้งแรก = 001/09) แยกตามใบ CUTTING / BENDING / STEEL
//   โหลดแถว releases ทั้งเดือน (ทุกโปรเจค · เฉพาะคอลัมน์ที่ใช้นับ) — แบ่งหน้า 1000
export async function monthReleases(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || "")); if (!m) return [];
  const y = +m[1], mo = +m[2]; const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  let all = []; let from = 0;
  for (;;) {
    const { data, error } = await supabase.from("releases").select("id, release_order, release_date, created_at, note, part_master(kind)")
      .gte("release_date", `${ym}-01`).lt("release_date", `${next}-01`).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    all = all.concat(data || []); if (!data || data.length < 1000) break; from += 1000;
  }
  return all;
}
// ★ 2026-11-10 ย้ายของที่ปล่อยแล้วไปใบงานอื่น (ปล่อยผิดใบ เช่น งานพับไปอยู่ MACHINING PART): แก้หมายเหตุ "ใบ: …" ของแถว releases
//   QR / ประวัติสแกนเดิมอยู่ครบ · หน้าล็อต / ใบสั่งผลิต / แท็บ Machine-Sub อ่านใบจากหมายเหตุนี้
export async function moveReleasedSheet(rows, toLabel) {
  let n = 0;
  for (const r of rows) {
    const old = String(r.note || ""); const cur = /ใบ:\s*(.+?)(?:\s*·|$)/.exec(old);
    const note = cur ? old.replace(/ใบ:\s*(.+?)(?=\s*·|$)/, `ใบ: ${toLabel}`) : [`ใบ: ${toLabel}`, old].filter(Boolean).join(" · ");
    if (note === old) continue;
    await updateRow("releases", r.id, { note }); n++;
  }
  return n;
}
// ★ 2026-11-11 อัปเดตแถวที่ปล่อยแล้วให้ตรงใบหลัก: ความยาว + น้ำหนัก/ชิ้น (คิดใหม่จากบันทึก Material: กก./ม. × ความยาว) + วัสดุ
//   items = ผลจาก staleReleasedRows · น้ำหนักหาไม่ได้ (INV ไม่มีในบันทึก Material) → ไม่แตะน้ำหนักเดิม แล้วรายงานกลับ
//   วัสดุเขียนแยกอีกคำสั่ง: ถ้าฐานข้อมูลไม่อนุญาตให้แก้คอลัมน์นี้ ความยาว/น้ำหนักที่เขียนไปแล้วยังอยู่ (รายงาน matFailed)
export async function syncReleasedRows(projectId, items, onProgress = () => {}) {
  let wOf = () => 0; try { wOf = await weightIndex(projectId); } catch (_) { /* ไม่มีบันทึก Material */ }
  const out = { n: 0, weight: 0, noWeight: [], matFailed: 0, errors: [] };
  let i = 0;
  for (const it of items || []) {
    onProgress(`อัปเดต ${++i}/${items.length}…`);
    const patch = {};
    if (it.len) patch.length_mm = it.toLen;
    if (it.kind === "part") { const w = wOf(it.toInv, it.toLen); if (w > 0) { patch.unit_weight = w; out.weight++; } else out.noWeight.push(it.code); }
    try {
      if (Object.keys(patch).length) await updateRow("releases", it.id, patch);
      if (it.mat) { try { await updateRow("releases", it.id, { material: it.toInv }); } catch (_) { out.matFailed++; } }
      out.n++;
    } catch (e) { out.errors.push(`${it.code} (${it.lot}): ${e?.message || e}`); }
  }
  out.noWeight = [...new Set(out.noWeight)];
  return out;
}
// ★ 2026-11-10 ยกเลิกการปล่อย (ปล่อยผิด → ปล่อยใหม่): เช็คทุกแถวก่อน — มีสแกน / บันทึกงานหน้าเครื่อง = ไม่ลบ (คืนใน blocked)
//   check(rows) → { ok:[row], blocked:[{row, scanned, recs}] } · unrelease(rows) → จำนวนที่ลบ (ลบแถว + QR ผ่าน authz_delete_release)
export async function checkUnrelease(rows) {
  const ok = [], blocked = [];
  for (const r of rows) {
    const [units, recs] = await Promise.all([listRows("part_units", { filters: { release_id: r.id }, strict: true }), countReleaseStationRecords(r.id)]);
    const scanned = (units || []).filter((u) => u.status !== "released").length;
    if (scanned > 0 || recs > 0) blocked.push({ row: r, scanned, recs }); else ok.push(r);
  }
  return { ok, blocked };
}
export async function unreleaseRows(rows, onProgress = () => {}) {
  let n = 0;
  for (const r of rows) { onProgress(`ยกเลิก ${n + 1}/${rows.length}…`); await deleteReleaseCascade(r.id); n++; }
  return n;
}
export const realReleaseApi = { pdfFolderOf, checkUnrelease, unreleaseRows, moveReleasedSheet, syncReleasedRows, monthReleases, projectContext, loadBomLibrary, saveLibrary, getLibPdfUrl, downloadLibPdf, listStorage, signedUrls, orderExists, saveRelease, savePlan, updatePlan, deletePlan, listPlans, listDrafts, saveDraft, dropDraft, releaseLot, lotLimits, modifyRelease, undoModify, storeLibPdfs };
