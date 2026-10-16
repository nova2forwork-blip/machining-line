// หน้าตัวอย่าง "ปล่อยงานใหม่" — ใช้คอมโพเนนต์จริงของแอป (ReleaseWizard + styles.css) แต่ไม่ต่อฐานข้อมูล
// build: npx vite build --config vite.demo.config.js → dist-demo/
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import "./demo.css";
import Icon from "../../icons.jsx";
import { ConfirmHost } from "../../confirm.jsx";
import ReleaseWizard from "../ReleaseWizard.jsx";
import { ReleasePlanView, ReleasePlansCard } from "../ReleaseLots.jsx";
import ProjectLib from "../ProjectLib.jsx";
import { projectContext, addrNote, nf, needOf, trimBom, lotRows, applyModToPlan } from "../releaseCore.js";
import DATA from "./demoData.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROJECTS = [
  { id: "p1", code: "A10035-US", name: "BARRINGTON" },
  { id: "p2", code: "A10024-E", name: "RIVERSIDE TOWER" },
];
const user = { id: "u1", name: "DEW", role: "admin" };
const addrs = (base, n, from = 1) => Array.from({ length: n }, (_, i) => `${base}${String(i + from).padStart(2, "0")}`);
function seedReleases() {
  const pj = { code: "A10035-US", name: "BARRINGTON" };
  const mk = (ro, date, kind, code, qty, note = "") => ({ id: ro + code, release_order: ro, release_date: date, qty, note, part_master: { part_no: code, kind, projects: pj } });
  return [
    mk("P-139", "2026-09-02T09:00:00Z", "panel", "UA2401A", 60, addrNote(addrs("25-W-2", 60))),
    mk("P-139", "2026-09-02T09:00:00Z", "part", "AL01-002 A", 120),
    mk("P-140", "2026-09-15T09:00:00Z", "panel", "UA2301A", 24, addrNote(addrs("24-E-3", 24))),
    mk("P-141", "2026-10-01T09:00:00Z", "panel", "UA2501A", 40, addrNote(addrs("25-E-2", 40))),
    mk("P-141", "2026-10-01T09:00:00Z", "subassembly", "SAAL18-002", 69),
  ];
}

// ตัวอย่างที่มีอยู่แล้ว: Release P-142 (304 แผง · BOM จากไฟล์ Excel) ปล่อยล็อต P-142.1 = พาร์ท CUTTING ไปแล้ว
function seedPlan() {
  const units = DATA.units304.map(([unit, addr]) => ({ unit, addr }));
  const base = { v: 1, id: "plan-142", ro: "P-142", projectId: "p1", projectCode: "A10035-US", date: "2026-10-08", note: "L25", mod: "", by: "DEW", createdAt: "2026-10-08T09:00:00Z", units, bom: DATA.lib, catOv: {}, procOv: {}, destOv: {}, pdfs: DATA.pdfs.map((d) => ({ file: d.file, kind: d.kind, code: d.code })) };
  const need = needOf(base);
  const plan = { ...base, bom: trimBom(DATA.lib, need) };
  const sel = { addrs: new Set(), subs: new Map(), parts: new Map(need.parts.filter((p) => p.dest === "CUTTING").map((p) => [p.code, p.qty])) };
  const pj = { code: "A10035-US", name: "BARRINGTON" };
  const lot = lotRows(plan, need, sel, "ปล่อยพาร์ทก่อน").map((r) => ({ id: "P-142.1" + r.code, release_order: "P-142.1", release_date: "2026-10-09T09:00:00Z", qty: r.qty, note: r.remark || "", part_master: { part_no: r.code, kind: r.kind, projects: pj } }));
  // Release อื่นของโปรเจคเดียวกัน (P-141 ปล่อยซับ 4 เบอร์ไปแล้ว) → P-142 ใช้เป็นเบอร์ลูก ไม่ต้องปล่อยใหม่
  const early = need.subs.slice(0, 4).map((x) => ({ id: "P-141" + x.code, release_order: "P-141", release_date: "2026-09-20T09:00:00Z", qty: x.qty, note: "ใบ: SUB-ASSEMBLY (งานพับ)", part_master: { part_no: x.code, kind: "subassembly", projects: pj } }));
  return { plan, lot: [...early, ...lot] };
}
const SEED = seedPlan();
// 8 แผงที่มี PDF — ใช้ชั้น 26 (ชั้น 25 อยู่ใน P-142 ตัวอย่างแล้ว)
const UNITS8 = DATA.units8.map(([unit, addr]) => ({ unit, addr: addr.replace(/^25-/, "26-") }));

function App() {
  const [releases, setReleases] = useState(() => [...SEED.lot, ...seedReleases()]);
  const [plans, setPlans] = useState(() => [SEED.plan]);
  const [libOv, setLibOv] = useState({ catOv: {}, procOv: {}, destOv: {} });   // หมวด/งานซับ/ใบงาน ที่ตั้งไว้ใน "ซับ / พาร์ท ของโปรเจค"
  const [libExtra, setLibExtra] = useState({ subs: {}, parts: {} });              // ซับ/พาร์ทที่อัพเพิ่มในคลัง
  const [view, setView] = useState("list");          // "list" | "wizard"
  const [planView, setPlanView] = useState(null);    // { plan, openBuilder }
  const [toast, setToast] = useState("");
  const [lastRo, setLastRo] = useState("");
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of releases) { const g = m.get(r.release_order) || { ro: r.release_order, date: r.release_date, parts: 0, qty: 0, panels: 0, code: r.part_master.projects.code }; g.parts++; g.qty += r.qty; if (r.part_master.kind === "panel") g.panels += r.qty; m.set(r.release_order, g); }
    return [...m.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.ro).localeCompare(String(a.ro)));
  }, [releases]);
  const say = (t) => { setToast(t); setTimeout(() => setToast(""), 4200); };
  const pjOf = (id) => PROJECTS.find((p) => p.id === id);

  const api = useMemo(() => ({
    projectContext,
    async loadBomLibrary(projectId) { await sleep(350); return projectId === "p1" ? { ...DATA.lib, subs: { ...DATA.lib.subs, ...libExtra.subs }, parts: { ...DATA.lib.parts, ...libExtra.parts }, ov: libOv } : { panels: {}, subs: {}, parts: {}, ov: libOv }; },
    async saveLibrary({ bom, catOv, procOv, destOv, partMode, partGroups }, onProgress) {
      onProgress("สร้างเบอร์ใหม่…"); await sleep(300); onProgress("ตั้ง BOM ซับ…"); await sleep(300); onProgress("บันทึกหมวด / งานซับ / ใบงาน…"); await sleep(200);
      setLibExtra({ subs: bom.subs, parts: bom.parts }); setLibOv({ catOv, procOv, destOv, partMode, partGroups });
      return { errors: [] };
    },
    async orderExists(pid, ro) { return releases.some((r) => r.release_order === ro); },
    async savePlan({ plan, bomSave }, onProgress) {
      onProgress("ตรวจเลข Release ซ้ำ…"); await sleep(300);
      if (plans.some((p) => p.projectId === plan.projectId && p.ro === plan.ro) || releases.some((r) => r.release_order === plan.ro)) { const e = new Error(`Release "${plan.ro}" มีอยู่แล้วในโปรเจคนี้`); e.code = "exists"; throw e; }
      onProgress("บันทึก Release…"); await sleep(300);
      onProgress("สร้างเบอร์ใหม่ + ตั้งชนิดเบอร์…"); await sleep(300);
      for (let i = 1; i <= bomSave.list.length; i += Math.max(1, Math.ceil(bomSave.list.length / 5))) { onProgress(`ตั้ง BOM ${Math.min(i, bomSave.list.length)}/${bomSave.list.length}`); await sleep(140); }
      const id = "plan-" + Date.now();
      setPlans((ps) => [{ ...plan, id }, ...ps]);
      return { saved: true, id, errors: [] };
    },
    async updatePlan(plan) { setPlans((ps) => ps.map((p) => (p.id === plan.id ? plan : p))); return { ok: true }; },
    async listPlans() { return { ok: true, plans }; },
    async releaseLot({ plan, lotNo, date, rows }, onProgress) {
      onProgress(`ตรวจเลขล็อต ${lotNo}…`); await sleep(250);
      if (releases.some((r) => r.release_order === lotNo)) { const e = new Error(`เลขล็อต ${lotNo} ถูกใช้แล้ว`); e.code = "exists"; throw e; }
      onProgress(`สร้างล็อต ${lotNo} + QR (${rows.length} เบอร์)…`); await sleep(650);
      const pj = pjOf(plan.projectId);
      const add = rows.map((r) => ({ id: lotNo + r.code, release_order: lotNo, release_date: date, qty: r.qty, note: r.remark || "", part_master: { part_no: r.code, kind: r.kind, projects: pj } }));
      setReleases((rs) => [...add, ...rs]);
      return { releasesCreated: rows.length, unitsCreated: rows.reduce((a, r) => a + r.qty, 0) };
    },
    async saveRelease() { throw new Error("ตัวอย่างนี้ใช้การปล่อยเป็นล็อต"); },
    async lotLimits() { await sleep(200); return { limits: new Map(), nextNo: 0 }; },
    async modifyRelease({ plan, mod, lotOps }, onProgress) {
      for (const [lot, ops] of lotOps) { onProgress(`Modify ${lot} (${ops.length} รายการ)…`); await sleep(300); }
      const byId = new Map(); for (const ops of lotOps.values()) for (const o of ops) byId.set(o.release_id, o);
      setReleases((rs) => rs.map((r) => { const o = byId.get(r.id); if (!o) return r; return o.type === "cancel" ? { ...r, qty: o.after, mod_version: mod.ver, mod_cancelled_at: new Date().toISOString() } : { ...r, qty: r.qty - o.n, mod_version: mod.ver }; }));
      onProgress(`บันทึก ${mod.ver}…`); await sleep(250);
      const np = applyModToPlan(plan, mod);
      setPlans((ps) => ps.map((p) => (p.id === np.id ? np : p)));
      return np;
    },
  }), [releases, plans, libOv, libExtra]);

  const demoTools = {
    units: (setUnits, setMsg) => (
      <span className="demo-chips">
        <span className="demo-tag">ตัวอย่าง</span>
        <button type="button" className="demo-chip" onClick={() => { setUnits(UNITS8); setMsg("✓ ใส่ 8 แผงที่มี PDF (UA2502B–UA2505B)"); }}>8 แผงที่มี PDF</button>
        <button type="button" className="demo-chip" onClick={() => { setUnits(DATA.units304.map(([unit, addr]) => ({ unit, addr }))); setMsg("✓ ใส่ P-142 ทั้งใบ 304 แผง (เปิด \"ใช้ BOM เดิม\" ในขั้น ③ เพื่อแตก BOM)"); }}>P-142 · 304 แผง</button>
        <button type="button" className="demo-chip" onClick={() => { setUnits([...UNITS8, { unit: "UA25O2B", addr: "26-E-308" }, { unit: "UA2502B", addr: "25-E-205" }, { unit: "", addr: "26-E-309" }]); setMsg("✓ ใส่ข้อมูลผิดตัวอย่าง — ดูการเตือนในตาราง"); }}>ข้อมูลผิดตัวอย่าง</button>
      </span>
    ),
    pdfs: (setPdfs, setSel) => (
      <span className="demo-chips">
        <span className="demo-tag">ตัวอย่าง</span>
        <button type="button" className="demo-chip" onClick={() => { setPdfs(DATA.pdfs.filter((d) => d.kind === "panel").map((d) => ({ ...d, src: "sample" }))); setSel(null); }}>โหลด PDF แบบแผงตัวอย่าง ({DATA.pdfs.filter((d) => d.kind === "panel").length} ไฟล์)</button>
      </span>
    ),
  };

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="bolt" size={19} style={{ stroke: "var(--accent-ink)" }} /></div>
          <div><div className="brand-name">Machining Line</div><div className="brand-sub">ระบบบันทึกการทำงาน</div></div>
        </div>
        {[["ขั้นตอนงาน", [["folder", "โปรเจค · ซับ/พาร์ท", false, "lib"], ["box", "ปล่อยงาน (Release)", true], ["qr", "พิมพ์ QR / ป้าย"], ["chart", "รายงานข้อมูลสแกน"], ["check", "ตรวจงานประกอบ"]]],
          ["สรุปภาพรวม", [["chart", "รายงานประจำวัน"], ["machine", "สรุปเครื่องจักร"], ["grid", "สรุป Part"]]],
          ["จัดการ", [["scale", "บันทึก Material"], ["settings", "ตั้งค่า"]]]].map(([g, items]) => (
          <div className="nav-group" key={g}>
            <div className="nav-group-label">{g}</div>
            {items.map(([ic, l, on, go]) => <div key={l} className={`nav-item ${on && view !== "lib" ? "active" : go && view === "lib" ? "active" : ""}`} onClick={() => (go ? (setView(go), setPlanView(null)) : on ? (setView("list"), setPlanView(null)) : say("หน้าตัวอย่างนี้เปิดเฉพาะเมนู ปล่อยงาน (Release)"))}><Icon name={ic} size={17} />{l}</div>)}
          </div>
        ))}
        <div className="sidebar-footer">
          <div className="user-chip"><div className="user-avatar">D</div><div><div className="user-name">DEW</div><div className="user-role">สำนักงาน</div></div></div>
        </div>
      </div>
      <div className="content">
        <div className="content-inner">
          <div className="demo-note">🧪 <b>หน้าตัวอย่าง</b> — ใช้โค้ดจริงของหน้าปล่อยงานใหม่ในแอป แต่ไม่ต่อฐานข้อมูล (บันทึกแล้วหายเมื่อรีเฟรช) · ปุ่มเส้นประ = ข้อมูลตัวอย่าง</div>
          {planView ? (
            <ReleasePlanView plan={planView.plan} releases={releases} plans={plans} api={api} user={user} openBuilder={!!planView.openBuilder}
              onBack={() => setPlanView(null)}
              onPlanChange={(p) => { setPlanView((v) => ({ ...v, plan: p })); setPlans((ps) => ps.map((x) => (x.id === p.id ? p : x))); }}
              onModified={(np, mod) => { setPlanView((v) => ({ ...v, plan: np })); say(`บันทึก ${mod.ver} แล้ว — ${mod.items.length} รายการ · จำนวนเดิมขีดฆ่า · เบอร์ที่ยกเลิกเป็นสีแดง (หน้า Release และล็อต)`); }}
              onReleased={({ lotNo, rows }) => { setLastRo(lotNo); say(`ปล่อย ${lotNo} สำเร็จ — ${rows.length} เบอร์ · สร้าง QR ${nf(rows.reduce((a, r) => a + r.qty, 0))} ดวง`); }} />
          ) : view === "lib" ? (
            <ProjectLib projectId="p1" projectCode="A10035-US" api={api} user={user} onBack={() => setView("list")} onSaved={() => say("บันทึกซับ / พาร์ท ของโปรเจคแล้ว — Release ใหม่จะดึงจากคลังนี้")}
              demoTools={{ libPdfs: (setPdfs) => <span className="demo-chips"><span className="demo-tag">ตัวอย่าง</span><button type="button" className="demo-chip" onClick={() => setPdfs(DATA.pdfs.filter((d) => d.kind !== "panel").map((d) => ({ ...d, src: "sample" })))}>โหลด PDF ซับ/พาร์ทตัวอย่าง</button></span> }} />
          ) : view === "wizard" ? (
            <ReleaseWizard user={user} projects={PROJECTS} releases={releases} plans={plans} initialProjectId="p1" api={api} demoTools={demoTools}
              onCancel={() => setView("list")} onNeedProject={() => say("ตัวอย่าง: ปุ่มนี้เปิดหน้าต่างเพิ่มโปรเจคใหม่")}
              onSaved={(r) => {
                setView("list");
                say(r.lotNo ? `บันทึก Release ${r.releaseOrder} + ปล่อยทั้งหมดเป็น ${r.lotNo} แล้ว` : `บันทึก Release ${r.releaseOrder} แล้ว — เลือกปล่อยล็อตแรกได้เลย`);
                setPlanView({ plan: r.plan, openBuilder: !r.lotNo });
              }} />
          ) : (
            <>
              <div className="page-head">
                <div>
                  <div className="page-title">ปล่อยงาน (Release)</div>
                  <div className="page-sub">ค้นหา Release ที่เคยปล่อยงาน หรือกด "ปล่อยงานใหม่" (ลงที่อยู่ + อัพ PDF แบบ → ระบบสร้าง BOM แล้ว office เลือกปล่อยเป็นล็อต) · แตะแถวเพื่อดูรายละเอียด</div>
                </div>
                <div className="pa-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-accent" onClick={() => setView("wizard")}><Icon name="plus" size={15} />ปล่อยงานใหม่</button>
                  <button type="button" className="btn btn-ghost" title="เพิ่ม Release แบบเดิม — พาร์ทเสริม/ซ่อมที่ไม่อยู่ใน BOM" onClick={() => say("ตัวอย่าง: ฟอร์ม เพิ่ม Release แบบเดิม (สำหรับพาร์ทเสริม/ซ่อม)")}><Icon name="plus" size={15} />เพิ่มพาร์ทเสริม</button>
                  <button type="button" className="btn btn-ghost" onClick={() => say("ตัวอย่าง: นำเข้า Release จาก Excel แบบเดิม")}><Icon name="folder" size={15} />นำเข้า Release จาก Excel</button>
                  <button type="button" className="btn btn-ghost" onClick={() => say("ตัวอย่าง: นำเข้าฟอร์มบั้ง (แพ็ก) แบบเดิม")}><Icon name="weight" size={15} />นำเข้าฟอร์มบั้ง (แพ็ก)</button>
                </div>
              </div>
              <ReleasePlansCard plans={plans} releases={releases} onOpen={(p) => setPlanView({ plan: p, openBuilder: false })} />
              <div className="card">
                <div className="card-head"><div className="card-title">ประวัติการ Release ล่าสุด</div></div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>วันที่</th><th>โปรเจค</th><th>Release Order</th><th style={{ textAlign: "right" }}>Part No.</th><th style={{ textAlign: "right" }}>แผง</th><th style={{ textAlign: "right" }}>จำนวน</th></tr></thead>
                    <tbody>{groups.map((g) => (
                      <tr key={g.ro} className={g.ro === lastRo ? "demo-new" : ""}>
                        <td>{new Date(g.date).toLocaleDateString("th-TH")}</td><td>{g.code}</td><td><b>{g.ro}</b>{g.ro === lastRo ? <span className="demo-badge">ใหม่</span> : null}</td>
                        <td style={{ textAlign: "right" }}>{nf(g.parts)} Part</td><td style={{ textAlign: "right" }}>{g.panels ? nf(g.panels) : "-"}</td><td style={{ textAlign: "right" }}>{nf(g.qty)} ชิ้น</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {/* มือถือ: แถบเมนูล่างเหมือนแอปจริง */}
      <div className="bottom-nav">
        {[["folder", "โปรเจค"], ["box", "ปล่อยงาน", true], ["chart", "รายงาน"], ["more", "เพิ่มเติม"]].map(([ic, l, on]) => (
          <div key={l} className={`bottom-nav-item ${on ? "active" : ""}`} onClick={() => (on ? (setView("list"), setPlanView(null)) : say("หน้าตัวอย่างนี้เปิดเฉพาะเมนู ปล่อยงาน (Release)"))}><Icon name={ic} size={20} /><span>{l}</span></div>
        ))}
      </div>
      {toast ? <div className="demo-toast" role="status">{toast}</div> : null}
      <ConfirmHost />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
