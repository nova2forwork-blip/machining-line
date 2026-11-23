// ══════════════════════════════════════════════════════════════════════════
// ส่งออกแผนแพ็ก / แผนลงตู้ เป็น Excel หรือพิมพ์ (บันทึกเป็น PDF จากหน้าพิมพ์ของเบราว์เซอร์)
//   ★ 2026-11-23 ผู้ใช้: "ให้ export pdf หรือ excel ได้ด้วย"
//   items = [{ bunk_no, shipment, load_date ("YYYY-MM-DD" ของชิป), container_no, row_no, col_no, len_mm, w_mm, packed, manifest: [{ position, unit_no, address_seq, width, height, weight, qty }] }]
//   packSheets / packPrintHtml ไม่แตะ DOM → ทดสอบใน tests/ ได้
// ══════════════════════════════════════════════════════════════════════════
const nat = (a, b) => String(a || "").localeCompare(String(b || ""), "en", { numeric: true });
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? "" : Number(v));
const qtyOf = (m) => (Number(m && m.qty) > 0 ? Number(m.qty) : 1);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// เรียง: ชิป → ตู้ (ไม่มีเลขตู้ไว้ท้าย) → แถว → ช่อง → เลขบั้ง
export function sortPackItems(items) {
  return (items || []).slice().sort((a, b) => nat(a.shipment, b.shipment) || (!a.container_no - !b.container_no) || nat(a.container_no, b.container_no)
    || ((a.row_no || 99) - (b.row_no || 99)) || ((a.col_no || 99) - (b.col_no || 99)) || nat(a.bunk_no, b.bunk_no));
}
// ตารางสำหรับ Excel 2 ชีต: "ตู้-บั้ง" (1 แถว = 1 บั้ง) · "แผงในบั้ง" (1 แถว = 1 แผง)
export function packSheets(items) {
  const list = sortPackItems(items);
  const bunks = [["Shipment", "Loading date", "Container", "Bunk No.", "Row", "Slot", "Length (mm)", "Width (mm)", "Units", "Packed", "Weight"]];
  const units = [["Shipment", "Loading date", "Container", "Bunk No.", "Position", "Unit No.", "Address", "Width (mm)", "Height (mm)", "Qty", "Weight"]];
  for (const b of list) {
    const man = Array.isArray(b.manifest) ? b.manifest : [];
    const n = man.reduce((s, m) => s + qtyOf(m), 0);
    const w = man.reduce((s, m) => s + (Number(m.weight) || 0), 0);
    bunks.push([b.shipment || "", b.load_date || "", b.container_no || "", b.bunk_no || "", num(b.row_no), num(b.col_no), num(b.len_mm), num(b.w_mm), man.length ? n : "", b.packed == null ? "" : Number(b.packed) || 0, man.length ? Math.round(w * 100) / 100 : ""]);
    for (const m of man) units.push([b.shipment || "", b.load_date || "", b.container_no || "", b.bunk_no || "", m.position || "", m.unit_no || "", m.address_seq || "", num(m.width), num(m.height), qtyOf(m), num(m.weight)]);
  }
  return { bunks, units };
}
export async function exportPackExcel(items, { title = "", fileName = "packing-plan.xlsx" } = {}) {
  const XLSX = await import("xlsx");
  const { bunks, units } = packSheets(items);
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.aoa_to_sheet(title ? [[title], [], ...bunks] : bunks); s1["!cols"] = [12, 13, 12, 18, 6, 6, 12, 12, 8, 8, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, s1, "Container-Bunk");
  if (units.length > 1) { const s2 = XLSX.utils.aoa_to_sheet(units); s2["!cols"] = [12, 13, 12, 18, 9, 14, 14, 12, 12, 6, 10].map((wch) => ({ wch })); XLSX.utils.book_append_sheet(wb, s2, "Units"); }
  XLSX.writeFile(wb, fileName);
  return { bunks: bunks.length - 1, units: units.length - 1 };
}
// หน้าพิมพ์ (A4 แนวตั้ง): ชิป → ตู้ → บั้ง (+ แผงในบั้งถ้ามี)
export function packPrintHtml(items, { title = "", sub = "" } = {}) {
  const list = sortPackItems(items); const ships = new Map();
  for (const b of list) { const s = b.shipment || ""; if (!ships.has(s)) ships.set(s, new Map()); const c = b.container_no || ""; if (!ships.get(s).has(c)) ships.get(s).set(c, []); ships.get(s).get(c).push(b); }
  const f = (v) => (v === "" || v == null ? "" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }));
  let body = "";
  for (const [s, cm] of ships) {
    const all = [...cm.values()].flat();
    const ld = (all.find((x) => x.load_date) || {}).load_date; const ldTxt = ld ? ld.split("-").reverse().join("/") : "";
    body += `<section><h2>Shipment ${esc(s || "(ไม่ระบุ)")}${ldTxt ? ` — ${esc(ldTxt)}` : ""} <small>${[...cm.keys()].filter(Boolean).length} ตู้ · ${all.length} บั้ง</small></h2>`;
    for (const [c, bs] of cm) {
      body += `<div class="cn"><h3>${c ? "ตู้ " + esc(c) : "ยังไม่ระบุตู้"} <small>${bs.length} บั้ง</small></h3>`;
      for (const b of bs) {
        const man = Array.isArray(b.manifest) ? b.manifest : [];
        const info = [b.row_no ? `แถว ${b.row_no}` : "", b.col_no ? `ช่อง ${b.col_no}` : "", b.len_mm ? `${f(b.len_mm)} × ${f(b.w_mm)} มม.` : "", man.length ? `${man.reduce((x, m) => x + qtyOf(m), 0)} แผง` : "", b.packed != null && man.length ? `แพ็กแล้ว ${Number(b.packed) || 0}` : ""].filter(Boolean).join(" · ");
        body += `<div class="bk"><div class="bh"><b>${esc(b.bunk_no)}</b><span>${esc(info)}</span></div>`;
        if (man.length) body += `<table><thead><tr><th>ตำแหน่ง</th><th>แผง</th><th>ที่อยู่</th><th class="r">กว้าง</th><th class="r">สูง</th><th class="r">น้ำหนัก</th></tr></thead><tbody>${man.map((m) => `<tr><td>${esc(m.position || "")}</td><td><b>${esc(m.unit_no || "")}</b></td><td>${esc(m.address_seq || "")}</td><td class="r">${f(num(m.width))}</td><td class="r">${f(num(m.height))}</td><td class="r">${f(num(m.weight))}</td></tr>`).join("")}</tbody></table>`;
        body += `</div>`;
      }
      body += `</div>`;
    }
    body += `</section>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || "Packing plan")}</title><style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; } body { font-family: "Leelawadee UI", Tahoma, Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; }
    h1 { font-size: 15pt; margin: 0 0 2px; } .sub { font-size: 9pt; color: #444; margin-bottom: 8px; }
    h2 { font-size: 12.5pt; margin: 10px 0 4px; padding: 3px 6px; background: #000; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 small, h3 small { font-weight: 400; font-size: 9pt; margin-left: 6px; }
    h3 { font-size: 11pt; margin: 6px 0 3px; border-bottom: 1.5px solid #000; padding-bottom: 1px; }
    .cn { margin-bottom: 6px; } .bk { break-inside: avoid; margin: 0 0 4px 8px; }
    .bh { display: flex; gap: 10px; align-items: baseline; } .bh b { font-family: Consolas, "Courier New", monospace; font-size: 10.5pt; } .bh span { font-size: 9pt; color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 1px 0 3px; font-size: 9pt; } th, td { border: 0.5px solid #999; padding: 1px 5px; text-align: left; } th { background: #eee; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .r { text-align: right; }
    section { break-inside: auto; }
  </style></head><body><h1>${esc(title || "Packing plan")}</h1><div class="sub">${esc(sub)}</div>${body || "<p>ไม่มีข้อมูล</p>"}
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };<\/script></body></html>`;
}
export function printPack(items, opts = {}) {
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return false;
  w.document.write(packPrintHtml(items, opts)); w.document.close();
  return true;
}
