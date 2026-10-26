// ★ 2026-10-26 คำแปลอังกฤษของหน้า Release (หัวหน้าเป็นชาวต่างชาติ) — โหลดพร้อมหน้า Release แล้วลงทะเบียนเข้า i18n-dom
//   dict = ข้อความไทยคงที่ → อังกฤษ · tpls = แม่แบบที่มีค่าตอนรัน {1},{2}… (แปลค่าที่เป็นไทยต่อให้)
//   สร้างจากซอร์สของ src/release/* (ดึงข้อความไทยทุกจุด) + ชื่อใบงานจาก SHEETS · เพิ่ม/แก้คำได้ที่นี่
import { registerI18n } from "../i18n-dom.js";
import { SHEETS } from "./releaseCore.js";

const DICT = {
 "BOM ของ Release นี้ตรงกับคลังแล้ว — ไม่มีอะไรต้องเติม": "This Release's BOM already matches the library — nothing to fill in",
 "\n\nไม่เปลี่ยนจำนวนที่ปล่อยแล้ว / ประวัติ Modify / QR · ใบปล่อยและใบเบิกจะใช้ข้อมูลใหม่": "\n\nReleased qty / Modify history / QR stay unchanged · Release sheet and issue sheet will use the new data",
 "อัปเดต": "Update",
 "อัปเดตจากคลังไม่สำเร็จ:": "Update from library failed:",
 "ดึงข้อมูลล่าสุดจาก “ซับ / พาร์ท ของโปรเจค” มาเติม: รายการครบจาก PDF ของซับ (สกรู/ยาง/กระจก) และรายละเอียด/หน่วยที่ขาด — ไม่เปลี่ยนจำนวนที่ปล่อยแล้ว": "Pull latest data from “Project subs / parts”: full item list from sub PDFs (screws/gaskets/glass) and missing description/unit — released qty unchanged",
 "กำลังอ่านคลัง…": "Reading library…",
 "อัปเดต BOM จากคลัง": "Update BOM from library",
 "แก้จำนวน / ยกเลิกเบอร์ / ยกเลิกที่อยู่ / เพิ่มเบอร์ — จำนวนเดิมขีดฆ่าไว้ · เบอร์ที่ยกเลิกเป็นสีแดง": "Edit qty / cancel code / cancel address / add code — old qty struck through · cancelled codes in red",
 "แผง": "Panels",
 "ที่อยู่ปล่อยแล้ว": "Addresses released",
 "ซับ": "Subs",
 "เบอร์ปล่อยครบ": "Codes fully released",
 "พาร์ท": "Parts",
 "ยังไม่ได้ปล่อย": "Not released yet",
 "เสร็จครบ": "All done",
 "· QR: เปิดหน้าพิมพ์ป้ายพร้อมเลือกเบอร์ของล็อตนี้ให้": "· QR: opens label print page with this lot's codes pre-selected",
 "ค้นหาเบอร์ / รายละเอียด / ที่อยู่ / INV": "Search code / description / address / INV",
 "ล้างคำค้นหา": "Clear search",
 "แบบ": "types",
 "เบอร์": "codes",
 "แผง (Unit)": "Panel (Unit)",
 "เบอร์ (Code)": "Code",
 "ชิ้นที่ทำแล้ว / ชิ้นที่ปล่อย": "Pcs done / pcs released",
 "ปล่อยล็อตใหม่": "Release new lot",
 "ชิ้น": "pcs",
 "ยิง": "Fastening",
 "ปล่อยล็อตทั้งที่มีเรื่องควรดู?": "Release lot despite warnings?",
 "กลับไปแก้": "Back to edit",
 "เริ่มบันทึก…": "Saving…",
 "เลขล็อต": "Lot no.",
 "ปล่อยในเลข Release หลักเลย": "Release under the main Release no.",
 "วันที่ล็อต": "Lot date",
 "หมายเหตุ เช่น ปล่อยพาร์ทก่อน / ชั้น 25 ฝั่ง E": "Note, e.g. release parts first / floor 25 side E",
 "หมายเหตุล็อต": "Lot note",
 "ปิด": "Close",
 "ค้นหาที่อยู่ / Unit": "Search address / Unit",
 "ค้นหาเบอร์ / description": "Search code / description",
 "ติ๊กแผง/ซับแล้วเลือกซับ/พาร์ทที่อยู่ข้างในให้ด้วย (เท่าที่ยังเหลือ)": "When ticking a panel/sub, also select the subs/parts inside it (what's still remaining)",
 "ซับยังไม่เลือกงาน": "Sub has no job selected",
 "ติ๊กงานอย่างน้อย 1 อย่าง ซับถึงจะอยู่ในใบงาน": "Tick at least 1 job for the sub to appear on a work sheet",
 "ส่งไปใบ": "Send to sheet",
 "งาน (ติ๊กได้หลายงาน)": "Jobs (multiple allowed)",
 "เลือกรายการที่จะปล่อยก่อน": "Select items to release first",
 "เบอร์นี้มีอยู่แล้ว — ใช้ “แก้จำนวน” แทน": "This code already exists — use “Edit qty” instead",
 "ใส่จำนวน": "Enter qty",
 "ยังไม่ได้แก้อะไร": "Nothing edited yet",
 "ใส่เหตุผล (เช่น ลูกค้าแจ้งลดจำนวน / แบบ Rev B)": "Enter reason (e.g. customer reduced qty / drawing Rev B)",
 "แก้ของที่ปล่อยแล้ว (ลด/ยกเลิกในล็อต) ต้องเป็นแอดมิน": "Editing released items (reduce/cancel in lot) requires admin",
 "กำลังโหลดยอดที่ทำแล้วของล็อต…": "Loading done qty for lots…",
 "เลข M (ว่าง = อัตโนมัติ)": "M no. (blank = auto)",
 "เลข M — ว่าง = เลขถัดไปอัตโนมัติ": "M no. — blank = next number automatically",
 "วันที่ของ M ตามเอกสาร": "M date per document",
 "เหตุผล * เช่น ลูกค้าแจ้งลดจำนวน / แบบ Rev B": "Reason * e.g. customer reduced qty / drawing Rev B",
 "เหตุผลของการ Modify": "Reason for Modify",
 "ที่อยู่แผง": "Panel addresses",
 "BOM ซับ/แผง": "Sub/panel BOM",
 "เพิ่มเบอร์ใหม่": "Add new code",
 "แก้เบอร์/จำนวนลูก": "Edit child code/qty",
 "เบอร์ที่ไม่มีใน BOM": "Codes not in BOM",
 "แก้ BOM ของ": "Edit BOM of",
 "เลือกซับ/แผง": "Select sub/panel",
 "แบบแผง": "Panel type",
 "ใบ": "panels",
 "ชุด": "sets",
 "แก้ BOM แผง = มีผลกับแผงทุกใบของแบบนั้น": "Editing panel BOM affects every panel of that type",
 "แก้ BOM ซับ = มีผลกับทุกที่ที่ใช้ซับนี้": "Editing sub BOM affects every place this sub is used",
 "ยกเลิก": "Cancel",
 "เบอร์ใหม่ *": "New code *",
 "จำนวนของเบอร์ใหม่": "Qty of new code",
 "ชนิดลูก": "Child type",
 "เบอร์ลูก *": "Child code *",
 "เบอร์ลูกที่เพิ่ม": "Child code to add",
 "Description ลูก": "Child description",
 "จำนวน/ชุด *": "Qty/set *",
 "จำนวนลูกที่เพิ่ม": "Child qty to add",
 "ชนิด": "Type",
 "จำนวน *": "Qty *",
 "จำนวน": "Qty",
 "ยาว (มม.)": "Length (mm)",
 "ความยาว": "Length",
 "ใบงาน": "Work sheet",
 "งานซับ": "Sub jobs",
 "เศษที่เหลือยาว ≥ 500 มม. หลังตัดล็อตนี้ (เก็บใช้ต่อได้) · คิดแบบเส้นใหม่ทุกล็อต": "Offcuts ≥ 500 mm left after cutting this lot (reusable) · each lot calculated with new bars",
 "ยอดเบิกจริงของล็อตนี้ (เส้น) · ว่าง = ใช้ยอดคำนวณ · ใส่ลงช่อง ACTUAL ISSUE ในใบเบิก": "Actual issue for this lot (bars) · blank = use calculated qty · goes into ACTUAL ISSUE on the issue sheet",
 "ไม่รู้ความยาวเส้น — ใช้ค่าเริ่ม": "Bar length unknown — using default",
 "พาร์ทไม่มีความยาวใน BOM — ไม่ได้นับในเส้น": "Part has no length in BOM — not counted in bars",
 "ไม่มีเศษยาว ≥ 500 มม.": "No offcuts ≥ 500 mm",
 "เช่น ใช้เศษ 2 เส้น / ใช้เส้น 6.3 ม.": "e.g. used 2 offcuts / used 6.3 m bar",
 "· เบิกจริง: กรอกเมื่อเบิกไม่ตรงยอดคำนวณ (ว่าง = ตามคำนวณ) — บันทึกอัตโนมัติ และใส่ลงใบเบิก": "· Actual issue: fill in when issue differs from calculated qty (blank = as calculated) — auto-saved and put on the issue sheet",
 "ปล่อยงาน (Release)": "Release",
 "ใช้งาน": "Active",
 "ตอนนี้": "Current",
 "· จัดทำโดย": "· Prepared by",
 "ไฟล์": "File",
 "กลับ": "Back",
 "✓ ดึง BOM จาก Release อื่นให้อัตโนมัติ": "✓ BOM pulled automatically from other Releases",
 "เบอร์:": "codes:",
 "⚠ ยังไม่มี BOM:": "⚠ No BOM yet:",
 "— ปล่อยได้ก่อน พอ Release อื่นมี BOM ของเบอร์เหล่านี้ ระบบดึงมาให้เอง": "— can release now; once another Release has BOM for these codes, the system pulls it in automatically",
 "ดึงตอนนี้": "Pull now",
 "ล็อต": "Lot",
 "ล็อตที่ปล่อยแล้ว": "Released lots",
 "ล่าสุดอยู่บน · แต่ละล็อตมี QR ของตัวเอง · ใบสั่งผลิตใช้เลขล็อต": "Newest on top · each lot has its own QR · production orders use the lot no.",
 "ใบปล่อย / QR ของล็อต": "Lot release sheet / QR",
 "ใบปล่อย: ดูหน้ากระดาษก่อน แล้วโหลดเป็น PDF หรือ Excel": "Release sheet: preview the page, then download as PDF or Excel",
 "ใบปล่อย · PDF / Excel": "Release sheet · PDF / Excel",
 "เจอ": "Found",
 "เบอร์ในใบงาน": "codes on work sheets",
 "· ซ่อนที่ไม่ตรง": "· hide non-matching",
 "ไม่เจอ “": "No “",
 "” ในใบงานของล็อตนี้": "” found on this lot's work sheets",
 "ที่อยู่": "Address",
 "รายละเอียด": "Description",
 "อยู่ในใบอื่นด้วย": "Also on other sheets",
 "ทำแล้ว": "Done",
 "ยังไม่ได้ปล่อยล็อต": "No lots released yet",
 "กด \"ปล่อยล็อตใหม่\" แล้วเลือกพาร์ท / ซับ / แผงที่จะปล่อยรอบนี้ และใบงานที่ส่งไป": "Click \"Release new lot\" then choose parts / subs / panels to release this round and the work sheets to send to",
 "ประวัติ Modify": "Modify history",
 "จำนวนเดิมขีดฆ่า → จำนวนใหม่ · เบอร์/ที่อยู่ที่ยกเลิกเป็น": "Old qty struck through → new qty · cancelled codes/addresses shown in",
 "สีแดง": "red",
 "· ของที่ปล่อยแล้วแก้ในล็อตด้วย (QR ที่ยกเลิกเก็บเป็นหลักฐาน)": "· released items are also adjusted in lots (cancelled QRs kept as record)",
 "รายการ": "items",
 "เหตุผล:": "Reason:",
 "จำนวน/ชุด": "Qty/set",
 "ยกเลิกลูก (เดิม": "Cancel child (was",
 "แก้เบอร์ →": "Change code →",
 "/ชุด)": "/set)",
 "เพิ่มลูก": "Add child",
 "/ชุด": "/set",
 "ต้องใช้": "Required",
 "ยกเลิกเบอร์ (เดิม": "Cancel code (was",
 "ยกเลิกที่อยู่ (แผง": "Cancel address (panel",
 "เพิ่มใหม่": "Add new",
 "ใช้เลข": "Use no.",
 "เลือกสิ่งที่จะปล่อยรอบนี้ แยกตามใบงานที่ส่งไปทำ · ซับ 1 เบอร์ไปได้หลายใบ (ติ๊กงานในแถว) · พาร์ทเลือกได้ว่าไป MACHINING PART / BENDING / STEEL · ระบบหักของที่ปล่อยแล้ว ไม่ให้เกิน": "Choose what to release this round, grouped by work sheet · 1 sub code can go to several sheets (tick jobs in the row) · parts can go to MACHINING PART / BENDING / STEEL · the system deducts what's already released, never exceeding",
 "เหลือ": "Remaining",
 "เลือก": "Select",
 "☑ เลือกที่เหลือในหน้านี้": "☑ Select remaining on this page",
 "☐ ไม่เลือกในหน้านี้": "☐ Deselect this page",
 "ปล่อยที่เหลือทั้งหมด (ทุกใบ)": "Release all remaining (all sheets)",
 "เลือกแผง/ซับแล้วดึงลูกมาด้วย": "Selecting a panel/sub also pulls its children",
 "สถานะ": "Status",
 "ไม่มี BOM": "No BOM",
 "ปล่อยแล้ว": "Released",
 "ยกเลิกแล้ว": "Cancelled",
 "ยังไม่ปล่อย": "Not released",
 "ปล่อยรอบนี้": "Release now",
 "ใช้ของ": "From",
 "แสดง 600 จาก": "Showing 600 of",
 "— ค้นหาเพื่อดูที่เหลือ (ปุ่มเลือกทั้งหมดเลือกครบ)": "— search to see the rest (Select all selects everything)",
 "ไม่มีรายการในใบนี้": "No items on this sheet",
 "✗ บันทึกไม่สำเร็จ —": "✗ Save failed —",
 "· ซับ": "· Subs",
 "เบอร์ (": "codes (",
 "SET) · พาร์ท": "SET) · Parts",
 "ชิ้น)": "pcs)",
 "ยังไม่ได้เลือกอะไร": "Nothing selected",
 "· แก้ยอดต้องใช้ทั้งใบ / ยกเลิกเบอร์ / ยกเลิกที่อยู่แผงที่ยังไม่ปล่อย / เพิ่มเบอร์ใหม่ · ของที่ปล่อยแล้วเกินยอดใหม่ ระบบลด/ยกเลิกในล็อตให้ (ล็อตล่าสุดก่อน · ไม่ต่ำกว่าที่ทำแล้ว) · จำนวนเดิมขีดฆ่า · เบอร์ที่ยกเลิกเป็นสีแดง": "· Edit total required qty / cancel code / cancel unreleased panel address / add new code · released items above the new total are reduced/cancelled in lots automatically (latest lot first · not below done qty) · old qty struck through · cancelled codes in red",
 "แก้": "Edit",
 "เฉพาะที่แก้": "Edited only",
 "การแก้": "Change",
 "ยอดใหม่": "New total",
 "ผล": "Result",
 "แก้จำนวน": "Edit qty",
 "ยกเลิกเบอร์": "Cancel code",
 "เหลือปล่อยเพิ่ม": "Left to release",
 "ยกเลิกใน": "Cancel in",
 "ปล่อยแล้วใน": "Released in",
 "— ยกเลิกแผงที่ปล่อยแล้วทำที่หน้า Release Order": "— cancel released panels on the Release Order page",
 "(เลือก QR)": "(select QR)",
 "แก้ลูกในซับ": "Edit sub children",
 "แก้ลูกในแผง": "Edit panel children",
 "— เลือก": "— select",
 "· ใช้": "· uses",
 "· ระบบคำนวณยอดต้องใช้ทั้งใบใหม่ให้เอง และลดในล็อตที่ปล่อยแล้ว": "· the system recalculates total required qty and reduces released lots automatically",
 "เบอร์ลูก": "Child code",
 "ค่าใหม่": "New value",
 "แก้ไปแล้ว": "Edited",
 "แก้เบอร์ (แทนด้วยเบอร์อื่น)": "Change code (replace with another)",
 "ยกเลิกลูกนี้": "Cancel this child",
 "เพิ่มลูกใน": "Add child to",
 "เพิ่ม": "Added",
 "เลือกซับหรือแบบแผงด้านบน แล้วแก้เบอร์ / จำนวนของลูกแต่ละตัวได้ · เพิ่มลูกใหม่ · ยกเลิกลูก": "Select a sub or panel type above, then edit each child's code / qty · add new children · cancel children",
 "เพิ่มใน": "Add to",
 "ลูก": "Children",
 "ผลต่อยอดต้องใช้ทั้งใบ (": "Affects total required qty (",
 "เบอร์)": "codes)",
 "เบอร์ที่ไม่มีใน BOM เดิม (เช่นแบบ Rev ใหม่เพิ่มพาร์ท) — เพิ่มแล้วจะอยู่ในยอดคงเหลือ ปล่อยในล็อตถัดไป": "Codes not in the original BOM (e.g. a new drawing Rev adds parts) — once added they go into remaining qty and are released in the next lot",
 "· ยกเลิกเบอร์": "· cancel code",
 "· ยกเลิกที่อยู่": "· cancel address",
 "· แก้ BOM ลูก": "· edit child BOM",
 "· เพิ่ม": "· add",
 "Release ที่ยังปล่อยไม่ครบ": "Releases not fully released",
 "บันทึกแล้ว · เลือกปล่อยเป็นล็อต P-xxx.1 / .2 … ได้ทีละส่วน": "Saved · release as lots P-xxx.1 / .2 … one part at a time",
 "โปรเจค": "Project",
 "วันที่": "Date",
 "แผงปล่อยแล้ว": "Panels released",
 "ปล่อยครบ": "Fully released",
 "เปิด →": "Open →",
 "วัตถุดิบงานตัด": "Cutting raw material",
 "MATERIAL LIST FOR CUTTING · จากพาร์ท MACHINING ในล็อต": "MATERIAL LIST FOR CUTTING · from MACHINING parts in lot",
 "เส้น": "bars",
 "รายการ · เศษ": "items · offcuts",
 "วัตถุดิบ (INV)": "Raw material (INV)",
 "ยาวเส้น": "Bar length",
 "ใช้กับ": "Used for",
 "เศษ ≥ 500 มม.": "Offcut ≥ 500 mm",
 "เบิกจริง": "Actual issue",
 "หมายเหตุเบิก": "Issue note",
 "ไม่มี INV": "No INV",
 "เบอร์ ·": "codes ·",
 "ไม่มียาว": "No length",
 "ยาวกว่าเส้น": "Longer than bar",
 "คิดแบบเส้นใหม่ทุกล็อต (ไม่นับเศษจากล็อตก่อน) · เศษ = ความยาวที่เหลือหลังตัด ≥ 500 มม. (หักรอยตัดแล้ว) เก็บไว้ใช้ต่อได้": "Calculated with new bars for each lot (offcuts from earlier lots not counted) · offcut = length left after cutting ≥ 500 mm (kerf deducted), kept for reuse",
 "กระจก · จาก BOM แผง/ซับในล็อต": "Glass · from panel/sub BOMs in lot",
 "แผ่น": "panes",
 "เบอร์ (CODE)": "Code",
 "ขนาด (มม.)": "Size (mm)",
 "อื่นๆ": "Other",
 "VENT / ENCLOS / ที่ไม่มี QR": "VENT / ENCLOS / items without QR",
 "วัสดุของล็อตนี้": "Materials for this lot",
 "ใบเบิก · ไม่มี QR · คิดเฉพาะของที่ปล่อยในล็อต": "Issue sheet · no QR · counts only items released in this lot",
 "ล็อตนี้ไม่มีวัสดุเบิก (ไม่มีพาร์ท MACHINING และ BOM ของแผง/ซับในล็อตไม่มีกระจก / อุปกรณ์)": "No materials to issue in this lot (no MACHINING parts, and panel/sub BOMs in this lot have no glass / accessories)",
 "ผลิตเอง · มี QR · ส่งไปใบ MACHINING PART / BENDING / STEEL ได้": "In-house · has QR · can send to sheet MACHINING PART / BENDING / STEEL",
 "ซับทั้งหมด (รายละเอียดดูที่ Total Sub-Assembly)": "All subs (details in Total Sub-Assembly)",
 "รายการเบอร์ * ที่ส่งไปประกอบที่ไซต์": "Codes marked * that are sent for assembly on site",
 "ใบเบิก · ไม่มี QR": "Issue sheet · no QR",
 "(ติดแผงโดยตรง)": "(attached directly to panel)",
 "ทุกแบบแผง": "All panel types",
 "เลือกทั้งหมดที่แสดง": "Select all shown",
 "พาร์ทนี้อยู่ในแผงแบบไหน (ชิ้นรวมทุกแผงของแบบนั้น) — เอาเมาส์ชี้ดูซับที่อยู่": "Which panel types use this part (pcs totalled over all panels of that type) — hover to see the sub it is in",
 "เลือกหมวด = ส่งไปใบงานของหมวดนั้นเลย (MACHINING→CUTTING · BENDING · STEEL)": "Choose category = send to that category's sheet (MACHINING→CUTTING · BENDING · STEEL)",
 "ไม่มีหมวด": "No category",
 "ปล่อยไปแล้ว — ย้ายหมวดไม่ได้": "Already released — can't change category",
 "เลือกทั้งหน้า": "Select whole page",
 "ไม่มีใน BOM — อ่านความยาวจากรหัส INV": "Not in BOM — length read from INV code",
 "ไม่รู้ความยาวเส้น — คิดที่ 6,000": "Bar length unknown — assumed 6,000",
 "หมายเหตุ": "Note",
 "ASSEMBLY (แผง)": "ASSEMBLY (panel)",
 "แตกซับทุกชั้นเหมือนชีต BOM P-142 ใน Excel — ซับ 1st พื้นเทา · ซับ 2nd พื้นเขียว": "Expands every sub level like BOM sheet P-142 in Excel — 1st-level subs grey · 2nd-level subs green",
 "พาร์ททุกเบอร์ · จัดกลุ่มตามหมวด · พิมพ์ค้นหา → ติ๊กเลือก → ย้ายไปหมวด / ปล่อย": "All part codes · grouped by category · type to search → tick → move to category / release",
 "ซับทุกใบ — ซับที่อยู่หลายใบนับครั้งเดียว": "All subs on every sheet — a sub on several sheets is counted once",
 "ค้นหาเบอร์ / รายละเอียด": "Search code / description",
 "ค้นหารหัสวัตถุดิบ / เบอร์พาร์ท": "Search raw material code / part code",
 "ค้นหาในตาราง": "Search table",
 "กรองตามใบงาน": "Filter by sheet",
 "เลือกแบบแผง": "Select panel type",
 "· ไม่มี BOM": "· no BOM",
 "ไม่พบรายการที่ค้นหา": "No matching items",
 "ไม่มีในใบนี้": "Not in this sheet",
 "รายการที่เลือกปล่อย": "Items selected for release",
 "ย้ายพาร์ทที่เลือกไปหมวด": "Move selected parts to category",
 "ส่งพาร์ทที่เลือกไปใบ": "Send selected parts to sheet",
 "ตั้งงานซับที่เลือก": "Set job for selected subs",
 "บรรทัด · SUM QUANTITY = จำนวนต่อชุด × จำนวนแผงแบบนั้น · ตัวแดง/WASTE = ตัดจากเศษ": "lines · SUM QUANTITY = qty per set × panels of that type · red/WASTE = cut from offcut",
 "ใช้ในแผง": "Used in panels",
 "หมวด / ส่งไปใบ": "Category / send to sheet",
 "ปล่อยแล้ว / ทำแล้วที่": "Released / done at",
 "รอจัดหมวด": "Awaiting category",
 "หมวดที่ตั้งเอง": "Custom categories",
 "→ ส่งไปใบ": "→ send to sheet",
 "ทำแล้วที่": "Done at",
 "รวม": "Total",
 "· ผลิตเอง (QR)": "· in-house (QR)",
 "· ใบเบิก": "· issue sheet",
 "· ยกเลิก": "· cancelled",
 "ยังไม่เลือกงาน": "No job selected",
 "ยาวรวม (ม.)": "Total length (m)",
 "จากรหัส": "From code",
 "ไม่ทราบ": "Unknown",
 "ไม่มีความยาว": "No length",
 "คำนวณ": "Calculated",
 "ยาว": "Length",
 "จัดลงเส้น": "Nested into",
 "มม. ได้": "mm bars:",
 "เส้น · เศษรวม": "bars · total offcut",
 "ม. · เศษ ≥ 500 มม.": "m · offcuts ≥ 500 mm:",
 "ชิ้น (เก็บใช้ต่อได้)": "pcs (reusable)",
 "· พาร์ท CUTTING": "· CUTTING parts",
 "รายการวัตถุดิบ ·": "Raw material list ·",
 "เส้น (ประมาณ)": "bars (approx.)",
 "BOM · Total Part · Total Sub-Assembly · ASSEMBLY (แผง) · Total Mat. — กดหัวเพื่อดูรายการ · ซับ 1 เบอร์อยู่ได้หลายใบ": "BOM · Total Part · Total Sub-Assembly · ASSEMBLY (panel) · Total Mat. — click a header to view the list · one sub code can be on several sheets",
 "โครงแผง → ซับ → พาร์ท (ตามแบบ PDF)": "Panel structure → sub → part (per drawing PDF)",
 "แบบแผง ·": "Panel type ·",
 "ประกอบแผง · 1 QR ต่อที่อยู่": "Panel assembly · 1 QR per address",
 "ทั้งหมด": "All",
 "ทุกแบบแผง (": "All panel types (",
 "แสดงพาร์ทลูก (แบบ Excel)": "Show child parts (Excel style)",
 "แสดง": "Showing",
 "จาก": "of",
 "คำนวณจากความยาวพาร์ท MACHINING PART ตามรหัส INV ในแบบ · รอยตัด": "Calculated from MACHINING PART lengths by INV code in the drawings · kerf",
 "มม. · ช่อง ACTUAL ISSUE ใส่ยอดเบิกจริงได้ (เช่นใช้เส้นยาวอื่น / ใช้เศษ) — บันทึกไว้กับ Release นี้": "mm · enter the actual issue in ACTUAL ISSUE (e.g. a different bar length / offcuts used) — saved with this Release",
 "· ปล่อยยอดที่เหลือทั้งหมดของแต่ละเบอร์ · แผง/ซับดึงลูกมาด้วย": "· releases all remaining qty of each code · panels/subs bring their children",
 "ย้ายไปหมวด": "Move to category",
 "เลือกหมวด…": "Choose category…",
 "พาร์ทที่เลือก → ส่งไปใบ": "Selected parts → send to sheet",
 "เลือกใบ…": "Choose sheet…",
 "ซับที่เลือก →": "Selected subs →",
 "ตั้งงาน…": "Set job…",
 "เพิ่มงาน": "Add job",
 "เหลืองาน": "Keep job",
 "อย่างเดียว": "only",
 "ล้าง": "Clear",
 "ปล่อยที่เลือก →": "Release selected →",
 "แสดงเพิ่ม (": "Show more (",
 "สร้าง Release": "Create Release",
 "อัพ PDF แผง": "Upload panel PDF",
 "ตรวจ + บันทึก": "Check + save",
 "พับ": "Bending",
 "เชื่อม": "Welding",
 "อ่านไม่ได้": "Unreadable",
 "✓ ตรง": "✓ Match",
 "✓ ใหม่": "✓ New",
 "✓ ตัดสินแล้ว": "✓ Decided",
 "⚠ ดู": "⚠ Review",
 "ระบบตรวจอะไรบ้าง": "What the system checks",
 "ใช้ใน": "Used in",
 "ยังไม่ใส่เลข Release": "Release no. not entered",
 "ห้ามลงท้าย \".ตัวเลข\" — สงวนไว้ให้ล็อต (เช่น P-142.1)": "Must not end in \".number\" — reserved for lots (e.g. P-142.1)",
 "ต้องเป็นรูปแบบ \"P-ตัวเลข\" เช่น P-142 (ต่อท้าย \"(…)\" ได้)": "Must be in the form \"P-number\", e.g. P-142 (a \"(…)\" suffix is allowed)",
 "ยังไม่เลือกโปรเจค": "No project selected",
 "ยังไม่เลือกวันที่": "No date selected",
 "หัวใบ Release": "Release header",
 "ยังไม่มีที่อยู่": "No addresses yet",
 "แบบแผงมี BOM": "Panel types with BOM",
 "PDF ซับ / พาร์ท": "Sub / part PDFs",
 "ครบ": "Complete",
 "ค่าที่ไม่ตรงใน PDF": "Mismatched values in PDF",
 "ไม่มี / ตัดสินครบแล้ว": "None / all decided",
 "จำนวนต่อชุดไม่ลงตัว": "Qty per set not a whole number",
 "งานของซับ": "Sub jobs",
 "หลังบันทึก": "After saving",
 "เลือกซับ / พาร์ท": "Select subs / parts",
 "ยังไม่ได้เลือกเบอร์": "No codes selected",
 "ซับที่ยังไม่มีเบอร์ลูก": "Subs without child codes",
 "ยังไม่ได้เลือก": "Not selected",
 "· ต้องแก้": "· needs fixing",
 "· ตรวจครบ": "· all checked",
 "ยังไม่มีไฟล์": "No files yet",
 "ยังบันทึกไม่ได้": "Can't save yet",
 "พร้อมบันทึก": "Ready to save",
 "บันทึกไม่ได้ —": "Can't save —",
 "บันทึก Release": "Save Release",
 "ฐานข้อมูลยังไม่รองรับการปล่อยเป็นล็อต": "Database does not support lot release yet",
 "ยังไม่ได้รัน migration-release-plans.sql ใน Supabase\n\nปล่อยทั้งใบเลยแบบเดิม (สร้าง QR ทุกอย่างในเลข": "migration-release-plans.sql has not been run in Supabase\n\nRelease the whole sheet the old way (creates QR for everything under no.",
 ") หรือกลับไปก่อน แล้วให้แอดมินรัน SQL": ") or go back first and have an admin run the SQL",
 "ปล่อยทั้งใบเลย": "Release whole sheet",
 "กลับไปก่อน": "Go back",
 "บันทึกไม่สำเร็จ:": "Save failed:",
 "สร้าง Release →": "Create Release →",
 "ถัดไป: ตรวจและบันทึก →": "Next: check and save →",
 "ถัดไป: อัพ PDF →": "Next: upload PDF →",
 "สร้าง Release → เลือกซับ / พาร์ท จากคลังของโปรเจค → ตรวจและบันทึก · ระบบแตกลูกของซับและสร้าง QR ให้": "Create Release → select subs / parts from project library → check and save · the system expands sub children and creates QR",
 "สร้าง Release → ลงที่อยู่ → อัพ PDF แบบ → ตรวจและบันทึก · ระบบนับแผง สร้าง BOM และ QR ให้": "Create Release → enter addresses → upload drawing PDF → check and save · the system counts panels and creates BOM and QR",
 "ปิดหน้าแล้วกลับมาทำต่อได้": "You can close the page and continue later",
 "(ยังไม่ใส่เลข)": "(no number yet)",
 "ข้อมูล Release": "Release info",
 "โหมดการปล่อยงาน": "Release mode",
 "เลขใบปล่อยงาน เช่น P-142 · พิมพ์ 142 ก็ได้": "Release sheet no., e.g. P-142 · typing 142 also works",
 "เพิ่มโปรเจคใหม่": "Add new project",
 "เช่น L25": "e.g. L25",
 "เช่น M-001 (ใบแก้)": "e.g. M-001 (modify sheet)",
 "← ย้อนกลับ": "← Back",
 "ย้อนกลับ (Ctrl+Z)": "Undo (Ctrl+Z)",
 "ทำซ้ำ (Ctrl+Shift+Z / Ctrl+Y)": "Redo (Ctrl+Shift+Z / Ctrl+Y)",
 "กำลังบันทึก…": "Saving…",
 "บันทึกขั้นที่เหลือ": "Save remaining steps",
 "บันทึก Release → เลือกปล่อย": "Save Release → choose what to release",
 "ไม่พบข้อมูล — ต้องมี 2 คอลัมน์ Unit กับ Address (คั่นด้วยแท็บ เหมือนก๊อปจาก Excel)": "No data found — needs 2 columns, Unit and Address (tab-separated, as copied from Excel)",
 "ได้": "Loaded",
 "อ่านไฟล์ไม่ได้:": "Can't read file:",
 "— ตรวจ Address ให้ถูกก่อนไปต่อ": "— check Addresses before continuing",
 "อ่าน PDF ไม่ได้:": "Can't read PDF:",
 "2 คอลัมน์: Unit (แบบแผง) + Address (ตำแหน่งติดตั้ง) · 1 แถว = แผง 1 ชิ้น = QR 1 ดวง · แผง Mockup (PMU/VMU/EMU) ติ๊กช่อง Mockup ได้ ไม่ต้องมีที่อยู่": "2 columns: Unit (panel type) + Address (install location) · 1 row = 1 panel = 1 QR · Mockup panels (PMU/VMU/EMU) can tick Mockup, no address needed",
 "วิธีลง": "How to enter",
 "วางจาก Excel ที่นี่ (Ctrl+V) — Unit | Address": "Paste from Excel here (Ctrl+V) — Unit | Address",
 "แผง Mockup (PMU / VMU / EMU) ไม่ต้องมีที่อยู่": "Mockup panels (PMU / VMU / EMU) need no address",
 "ที่อยู่สมมติ — ระบบออกให้ ใช้แทนที่อยู่จริงของแผง Mockup": "Placeholder address — system-generated, used instead of a real address for Mockup panels",
 "ลบแถว": "Delete row",
 "สรุปแผง": "Panel summary",
 "นับให้เองต่อแบบ (แทนชีต Units)": "Auto-counted per type (replaces Units sheet)",
 "ค้นหาแบบแผง": "Search panel types",
 "โหลดตัวอ่าน PDF ไม่ได้:": "Can't load PDF reader:",
 "กดเพื่อเปิดแผงที่ใช้เบอร์นี้ และไฮไลต์แถว": "Click to open the panel using this code and highlight the row",
 "ในใบนี้": "In this sheet",
 "PDF ที่อัพ": "Uploaded PDFs",
 "BOM เดิม": "Existing BOM",
 "ยังไม่มี": "None yet",
 "อัพ PDF แบบแผง": "Upload panel-type PDFs",
 "Release ลงแค่แบบแผง (UA…) — ซับ/พาร์ทที่แผงใช้ ระบบดึงจาก “ซับ / พาร์ท ของโปรเจค” ให้เอง · เบอร์ที่ปล่อยไว้แล้วใน Release อื่นจะถูกใช้เป็นลูก ไม่ปล่อยซ้ำ": "The Release only takes panel-type drawings (UA…) — subs/parts used by panels are pulled automatically from “Project subs / parts” · codes already released in another Release are used as children, not released again",
 "ใช้ตาม PDF": "Use PDF",
 "ใช้ค่าเดิม": "Keep existing",
 "กำลังโหลด…": "Loading…",
 "ยังไม่ได้โหลด": "Not loaded yet",
 "โหลดซับ/พาร์ทของโปรเจคใหม่ (หลังเพิ่มที่หน้า ซับ / พาร์ท ของโปรเจค)": "Reload project subs/parts (after adding them on the Project subs / parts page)",
 "เอาออก": "Remove",
 "(ยังไม่รู้ว่าแผงประกอบด้วยอะไร)": "(Panel contents not known yet)",
 "ซับที่แผงใช้": "Subs used by panel",
 "— ยังไม่มีในโปรเจค ลงที่หน้า ซับ/พาร์ท ของโปรเจค": "— not in project yet; add on the Project subs/parts page",
 "พาร์ทที่แผงใช้": "Parts used by panel",
 "ต้องตรวจ": "Needs check",
 "ไม่มีปัญหา": "No issues",
 "เอาไฟล์นี้ออก": "Remove this file",
 "รับทราบ": "Acknowledge",
 "ต่าง": "Differs",
 "ย่อ": "Collapse",
 "ขยายดูเบอร์ลูก": "Expand to see child codes",
 "โหลดคลังใหม่ (หลังเพิ่มซับ/พาร์ทที่หน้า ซับ / พาร์ท ของโปรเจค)": "Reload library (after adding subs/parts on the Project subs / parts page)",
 "ลูกใน BOM": "BOM children",
 "หมวด": "Category",
 "ดูเบอร์ลูก": "View child codes",
 "ยังไม่เคยลงแบบ PDF ของซับนี้ที่หน้า ซับ / พาร์ท ของโปรเจค": "No drawing PDF for this sub on the Project subs / parts page yet",
 "ไม่พบเบอร์ที่ค้นหา": "No matching codes",
 "ยังไม่มีซับในคลังของโปรเจคนี้ — ลงแบบซับที่หน้า “ซับ / พาร์ท ของโปรเจค” แล้วกด ↻ โหลดคลังใหม่": "No subs in this project's library yet — add sub drawings on the “Project subs / parts” page, then click ↻ Reload library",
 "ยังไม่มีพาร์ทที่มี QR ในคลัง — ลงแบบพาร์ทที่หน้า “ซับ / พาร์ท ของโปรเจค”": "No parts with QR in the library yet — add part drawings on the “Project subs / parts” page",
 "ตรวจก่อนบันทึก": "Check before saving",
 "บันทึก = เก็บ Release นี้ (ที่อยู่ + BOM + ใบงาน) แล้ว office เลือกปล่อยเป็นล็อต — QR สร้างตอนปล่อยล็อต": "Save = store this Release (addresses + BOM + work sheets), then office picks lots to release — QR codes are created when a lot is released",
 "สรุปทั้งใบ": "Sheet summary",
 "ป้ายแผง": "Panel labels",
 "สกรู / ยาง / ซิลิโคน": "Screws / gaskets / silicone",
 "ใบงาน + Category": "Work sheets + Category",
 "⚠ ยังไม่มี BOM": "⚠ No BOM yet",
 "BOM ที่จะตั้งในระบบ": "BOM to be set up in system",
 "พิมพ์ QR / ป้าย": "Print QR / labels",
 "+ อีก": "+",
 "ปล่อยงานใหม่": "New release",
 "บันทึกร่างอัตโนมัติ": "Draft auto-saved",
 "มีร่างค้างไว้": "Unfinished draft found",
 "· ขั้น": "· Step",
 "แผง ·": "panels ·",
 "ทำต่อ": "Continue",
 "เริ่มใหม่": "Start over",
 "🏢 ปล่อยแผง (มีที่อยู่)": "🏢 Release panels (with addresses)",
 "🔩 ปล่อยเฉพาะซับ / พาร์ท": "🔩 Release subs / parts only",
 "ไม่มีแผง — เลือกเบอร์จากคลังของโปรเจค ใส่จำนวน (ซับแตกลูกให้ด้วย)": "No panels — pick codes from the project library and enter qty (subs expand into children too)",
 "วันที่ *": "Date *",
 "โปรเจค *": "Project *",
 "— เลือกโปรเจค —": "— Select project —",
 "หมายเหตุหัวใบ": "Header note",
 "ต่อท้ายเลข Release ในหัวกระดาษ": "Appended to the Release no. in the title block",
 "ถ้ามี": "optional",
 "Release ในโปรเจคนี้:": "Releases in this project:",
 "… อีก": "… +",
 "· เลขถัดไป": "· Next no.",
 "↶ ย้อน": "↶ Undo",
 "↷ ทำซ้ำ": "↷ Redo",
 "ขั้น": "Step",
 "กำลังบันทึก": "Saving",
 "อย่าปิดหน้านี้จนกว่าจะเสร็จ": "Do not close this page until finished",
 "ก๊อป 2 คอลัมน์จาก Excel แล้ววาง (Ctrl+V) ที่ไหนก็ได้ในหน้านี้ — มีหัวตารางหรือไม่มีก็ได้ สลับคอลัมน์ได้": "Copy 2 columns from Excel and paste (Ctrl+V) anywhere on this page — with or without headers, columns in any order",
 "ที่อยู่ซ้ำ / ใช้ใน Release อื่นแล้ว / ข้อมูลไม่ครบ = บันทึกไม่ได้ · Unit รูปแบบแปลก = เตือน": "Duplicate address / used in another Release / incomplete data = cannot save · unusual Unit format = warning",
 "ใช้ข้อมูลนี้ (แทนที่)": "Use this data (replace)",
 "เพิ่มต่อท้าย": "Append",
 "เพิ่มแถว": "Add row",
 "นำเข้าไฟล์ .xlsx": "Import .xlsx file",
 "นำเข้า PDF": "Import PDF",
 "เพิ่มแผงจาก PDF ที่อัพไว้ (": "Add panels from uploaded PDFs (",
 "แบบ)": "types)",
 "ล้างทั้งหมด": "Clear all",
 "เฉพาะแถวที่ต้องดู (": "Only rows needing attention (",
 "ตรวจ": "Check",
 "✓ มี BOM": "✓ Has BOM",
 "รอ PDF": "Awaiting PDF",
 "แสดง 400 แถวแรก จาก": "Showing first 400 rows of",
 "ก๊อป 2 คอลัมน์ Unit | Address จาก Excel แล้วกด Ctrl+V · แผง Mockup พิมพ์ชื่อ Unit (เช่น EMU-E-3036) ไม่ต้องใส่ Address": "Copy 2 columns Unit | Address from Excel and press Ctrl+V · for Mockup panels type the Unit name (e.g. EMU-E-3036), no Address needed",
 "แผงทั้งหมด": "Total panels",
 "มี BOM แล้ว": "With BOM",
 "✗ บันทึกไม่ได้จนกว่าจะแก้:": "✗ Cannot save until fixed:",
 "แบบแผงยังไม่มี BOM —": "Panel types without BOM —",
 "ไปขั้น ③ อัพ PDF แบบแผง": "Go to step ③ Upload panel-type PDFs",
 "(ระบบไล่ต่อให้ว่าต้องมี PDF ซับ/พาร์ทตัวไหนอีก)": "(the system then traces which sub/part PDFs are still needed)",
 "✓ ทุกแบบแผงมี BOM — ไปขั้น ③ ต่อได้เลย": "✓ All panel types have a BOM — continue to step ③",
 "เดิม": "Existing",
 "ขาด": "Missing",
 "ยังไม่มี PDF": "No PDF yet",
 "← ใช้ใน": "← used in",
 "เบอร์ (เปิด “ดูทั้งหมด” ด้านล่าง)": "codes (open “View all” below)",
 "ดูทั้งหมด": "View all",
 "เบอร์ — แต่ละเบอร์มาจากไหน / ใช้ในอะไร": "codes — where each comes from / what it is used in",
 "แหล่งข้อมูล": "Source",
 "เทียบกับ BOM เดิมในระบบ:": "Compared with existing BOM in system:",
 "จำนวน · ยาว · สูง · Finish · INV · Develop · มีใน PDF ไม่มีในระบบ · มีในระบบไม่มีใน PDF": "Qty · length · height · Finish · INV · Develop · in PDF not in system · in system not in PDF",
 "เทียบ PDF กันเอง:": "PDFs compared with each other:",
 "เบอร์เดียวกันคนละค่า (ใช้ค่าจากแบบของเบอร์นั้นเอง)": "Same code, different values (uses the values from that code's own drawing)",
 "ในแบบเอง:": "Within the drawing:",
 "ยาง/เทปต่าง ≤ 1.5 มม. = ปัดเศษ (ไม่นับเป็นผิด)": "Gasket/tape differences ≤ 1.5 mm = rounding (not counted as errors)",
 "จุดที่ต่าง: เลือก \"ใช้ตาม PDF\" (ค่าเริ่ม) หรือ \"ใช้ค่าเดิม\" — ระบบจำว่าใครตัดสิน เมื่อไร": "Differences: choose \"Use PDF\" (default) or \"Keep existing\" — the system records who decided and when",
 "ลากไฟล์ PDF มาวาง หรือกดเพื่อเลือก": "Drag PDF files here, or click to choose",
 "หลายไฟล์พร้อมกันได้ · อ่านในเครื่อง ไม่ต้องรอ · ไฟล์ชื่อซ้ำ = แทนที่ของเดิม": "Multiple files at once · read locally, no waiting · same file name = replaces the old one",
 "ซับ / พาร์ท ของโปรเจค:": "Project subs / parts:",
 "↻ โหลดใหม่": "↻ Reload",
 "ล้างไฟล์ทั้งหมด": "Clear all files",
 "เช็กลิสต์ PDF ของใบนี้": "PDF checklist for this sheet",
 "แบบ) แล้วไล่ BOM ลงทีละชั้น": "types), then BOM traced level by level",
 "ซับ/พาร์ทโผล่หลังอัพแบบแผงที่ใช้มัน · “เดิม” = มีในคลังของโปรเจคแล้ว · ที่ขาด = ปล่อยได้ก่อน พอลงในโปรเจค (หรือ Release อื่นมี) ระบบดึงมาให้เอง": "Subs/parts appear after uploading the panel drawings that use them · “Existing” = already in project library · missing ones can be released first; once added to the project (or found in another Release) the system pulls them in automatically",
 "ไฟล์ไม่ได้ใช้ในแผงของใบนี้:": "Files not used by panels on this sheet:",
 "— อัพผิดไฟล์ หรือยังไม่ได้อัพแบบแผง/ซับที่ใช้เบอร์นี้": "— wrong file uploaded, or the panel/sub drawing using this code is not uploaded yet",
 "ไฟล์ PDF": "PDF files",
 "ไฟล์ไม่มีปัญหา": "Files with no issues",
 "จุดที่ยังต้องตัดสิน": "Open decisions",
 "ไม่มีไฟล์ในกลุ่มนี้": "No files in this group",
 "บรรทัดใน BOM": "BOM lines",
 "ต้องตัดสิน": "To decide",
 "จุด": "issues",
 "· ค่าเริ่ม = ใช้ตาม PDF": "· default = Use PDF",
 "ตัดสินครบแล้ว ✓": "All decided ✓",
 "· โดย": "· by",
 "ใช้ตาม PDF ทุกจุดในไฟล์นี้": "Use PDF for all issues in this file",
 "✓ ไม่มีจุดที่ต้องตัดสิน": "✓ Nothing to decide",
 "ช่อง": "Field",
 "ตรง": "Match",
 "ไม่มีในโปรเจค": "Not in project",
 "ยังไม่ได้เลือกโปรเจค": "No project selected",
 "กลับไปขั้น ① แล้วเลือกโปรเจค — เบอร์ที่เลือกได้มาจากคลังของโปรเจค": "Go back to step ① and select a project — selectable codes come from the project library",
 "↻ โหลดคลังใหม่": "↻ Reload library",
 "กำลังโหลดคลังของโปรเจค…": "Loading project library…",
 "✗ โหลดคลังไม่ได้:": "✗ Could not load library:",
 "เลือกแล้ว: ซับ": "Selected: subs",
 "· พาร์ท": "· parts",
 "ล้างที่เลือก": "Clear selection",
 "ยังไม่มีเบอร์ลูก": "No child codes yet",
 "แสดง 300 จาก": "Showing 300 of",
 "เบอร์ — พิมพ์ค้นหาเพื่อดูที่เหลือ": "codes — type to search for the rest",
 "แสดงเฉพาะพาร์ทที่ผลิตเอง (มี QR) · สกรู / ยาง / กระจก ไม่ทำ QR · ซับที่ปล่อยจะไปเป็นใบงานพับ / เชื่อม / ยิง ตามกติกาเบอร์ (แก้ได้ในขั้นตรวจ + บันทึก)": "Only in-house parts (with QR) shown · screws / gaskets / glass get no QR · released subs go to bending / welding / fastening work sheets per code rules (editable in the Check + Save step)",
 "บันทึก แล้วเลือกปล่อยเป็นล็อต": "Save, then release as lots",
 "office เลือกเองว่าปล่อยอะไรก่อน (พาร์ท / ซับ / แผง) และส่งไปใบงานไหน · ได้": "Office chooses what to release first (parts / subs / panels) and which work sheet to send to · gives",
 "ปล่อยทั้งหมดเลยเป็น": "Release all at once as",
 "ใบที่ปล่อยครบรอบเดียว · สร้าง QR ทุกอย่างทันทีตอนบันทึก": "Single full release · all QR codes created immediately on save",
 "บันทึก Release แล้ว แต่บางขั้นยังไม่เสร็จ:": "Release saved, but some steps are not finished:",
 "กด \"บันทึกขั้นที่เหลือ\" เพื่อลองใหม่": "Click \"Save remaining steps\" to retry",
 "1 QR ต่อที่อยู่": "1 QR per address",
 "ใบงานตั้งตามกติกาเบอร์ (MACHINING → CUTTING · BENDING → BENDING · STEEL → STEEL · SAAL → เชื่อม · SAAP/SASF → พับ · เบอร์ * → Site Item · อื่น → ยิง) · แก้ได้ในแท็บ \"ใบงาน + Category\" หรือตอนปล่อยล็อต · ซับ 1 เบอร์อยู่ได้หลายใบ": "Work sheets set by code rules (MACHINING → CUTTING · BENDING → BENDING · STEEL → STEEL · SAAL → welding · SAAP/SASF → bending · code * → Site Item · others → fastening) · editable in the \"Work sheets + Category\" tab or when releasing a lot · one sub code can be on several sheets",
 "✓ เบอร์ที่ปล่อยไว้แล้วใน Release อื่นของโปรเจคนี้": "✓ Codes already released in another Release of this project",
 "— ใช้เป็นเบอร์ลูก ไม่ปล่อยซ้ำ:": "— used as child codes, not released again:",
 "แบบแผง · 1 QR ต่อ 1 ที่อยู่ · BOM แผง = ซับ + พาร์ทติดแผง": "panel types · 1 QR per address · panel BOM = subs + panel-mounted parts",
 "เบอร์ · ตั้ง BOM ให้เอง · ใช้ที่สถานีประกอบ": "codes · BOM set automatically · used at assembly station",
 "เบอร์ · ใบเบิกกระจก — ไม่ทำ QR": "codes · glass issue sheet — no QR",
 "สกรู / ยาง / เทป — ไม่ทำ QR": "Screws / gaskets / tape — no QR",
 "— ไม่ทำ QR": "— no QR",
 "เบอร์ · ลูกใน BOM = ซับ + พาร์ทที่มี QR (กระจก/สกรู/ยางไม่ใส่ เพราะไม่มี QR ให้สแกนตอนประกอบ)": "codes · BOM children = subs + parts with QR (glass/screws/gaskets excluded — no QR to scan at assembly)",
 "คืนค่าตามกติกาเบอร์": "Reset to code rules",
 "ใบงาน (ส่งไปทำที่)": "Work sheet (send to)",
 "= ตามหมวด (ใบเดียวกัน)": "= per category (same sheet)",
 "ไม่ทำ QR (ใบเบิก)": "No QR (issue sheet)",
 "แสดง 500 จาก": "Showing 500 of",
 "— ค้นหาเพื่อดูที่เหลือ": "— search to see the rest",
 "ซับ 1 เบอร์ติ๊กได้หลายงาน = อยู่ในหลายใบ (SUB-ASSEMBLY งานพับ / งานเชื่อม / SUB A'ssy ยิง / Site Item) · พาร์ทเลือกว่าไป CUTTING หรือ BENDING · เปลี่ยนเป็นหมวดที่มี \"· QR\" = ได้ QR พาร์ท": "One sub code can tick several processes = on several sheets (SUB-ASSEMBLY bending / welding / SUB A'ssy fastening / Site Item) · parts choose CUTTING or BENDING · switching to a category marked \"· QR\" = gets a part QR",
 "ตัวอย่างหน้าตาป้ายแผง (QR จริงสร้างตอนปล่อยล็อต — พิมพ์ได้ที่เมนู \"พิมพ์ QR / ป้าย\") ·": "Panel label preview (real QR codes are created when a lot is released — print from the \"Print QR / labels\" menu) ·",
 "เส้นเต็มของแถวนี้เอง": "This row's own full bar",
 "(ติดแผงตรง)": "(mounted directly on panel)",
 "ขยาย": "Expand",
 "ซับ 2": "Sub 2",
 "ซับ 1": "Sub 1",
 "· ทุกแบบแผง": "· All panel types",
 "เส้นเต็ม (ชิ้นเต็ม) ใช้ที่ไหน · เศษมาจากไหน / ไปใช้ที่ไหน": "Where full bars (full pieces) are used · where offcuts come from / go to",
 "เศษที่ใช้ตัดแถวนี้ มาจากเส้นเต็มของแถวนี้": "Offcuts used to cut this row come from these full bars",
 "เศษที่เหลือจากเส้นเต็มของแถวนี้ ถูกนำไปตัดที่แถวเหล่านี้": "Offcuts left from this row's full bars are used to cut these rows",
 "โครงสร้าง": "Structure",
 "รวมเบอร์": "Codes combined",
 "ตารางเต็ม": "Full table",
 "เลือกแบบแผงเดียวเพื่อดูโครงสร้าง": "Select a single panel type to view its structure",
 "ค้นหาเบอร์ / รายละเอียด / MATERIAL": "Search code / description / MATERIAL",
 "ค้นหาใน BOM": "Search BOM",
 "เศษ ×": "Offcut ×",
 "เส้นใหม่ ×": "New bar ×",
 "ไม่พบรายการ": "No items found",
 "ต่อชุด": "Per set",
 "สกรู/ยาง": "Screws/gaskets",
 "รวมทั้งใบ": "Sheet total",
 "หน่วย": "Unit",
 "ใช้ใน (ซับ ×จำนวน)": "Used in (sub ×qty)",
 "เศษ": "Offcut",
 "· รวมทั้งใบ = ต่อชุด × ซับชั้นบน × จำนวนแผง": "· sheet total = per set × parent sub × panel qty",
 "เส้นเต็ม ↔ เศษ": "Full bar ↔ offcut",
 "เส้นเต็ม": "Full bar",
 "← เศษจาก": "← offcut from",
 "→ เศษไปใช้ที่": "→ offcut used at",
 "บรรทัด · ตัวแดง/WASTE = ตัดจากเศษที่ MATERIAL ตรงกัน · กดหัวคอลัมน์เพื่อเรียง": "lines · red/WASTE = cut from offcut with matching MATERIAL · click a column header to sort",
 "เรียง": "Sort",
 "ชื่อ": "Name",
 "จำนวนแผง": "Panel qty",
 "จำนวนรายการ": "Item count",
 "ใช้เศษ": "Offcut used",
 "แบบ ·": "types ·",
 "ชิ้นต้องตัด": "pcs to cut",
 "พับทั้งหมด": "Collapse all",
 "ขยายทั้งหมด": "Expand all",
 "เบอร์ / รายละเอียด / ส่งไปใบ": "Code / Details / Send to sheet",
 "MATERIAL · เศษ": "MATERIAL · Offcut",
 "รวม (×": "Total (×",
 "แผง)": "panels)",
 "เศษ: ไล่ตัดตามลำดับแผงในใบนี้ · MATERIAL (INV) ตรงกัน ใช้เศษที่เหลือพอ (ยาว + รอยตัด": "Offcuts: cut in panel order on this sheet · same MATERIAL (INV): use a remaining offcut if long enough (length + kerf",
 "มม.) ก่อนเปิดเส้นใหม่ · เศษ ≥": "mm) before opening a new bar · offcuts ≥",
 "มม. เก็บไว้ใช้ต่อ — เป็นการคำนวณเบื้องต้น ไม่ได้ตัดสต็อกจริง": "mm are kept for reuse — a rough estimate, stock is not actually deducted",
 "ยังไม่มีแผงในใบนี้": "No panels on this sheet yet",
 "เปิดไฟล์ PDF ไม่ได้:": "Cannot open PDF file:",
 "อ่านซ้ำไม่ได้:": "Cannot re-read:",
 "อ่านไม่ออก": "Unreadable",
 "มี PDF ใหม่ที่ยังไม่บันทึก": "New PDFs not saved yet",
 "กลับ (ทิ้งไฟล์)": "Back (discard files)",
 "อยู่ต่อ": "Stay",
 "บันทึกซับ / พาร์ท ของโปรเจค?": "Save project subs / parts?",
 "ไม่มี PDF ใหม่ — บันทึกเฉพาะหมวด / งานซับ / ใบงาน": "No new PDFs — save categories / sub work / work sheets only",
 "Release ที่สร้างใหม่จะดึงจากคลังนี้ · Release เดิมที่ยังไม่มี BOM จะดึงให้เมื่อเปิด": "New Releases pull from this library · existing Releases without a BOM pull it when opened",
 "บันทึก": "Save",
 "ไม่ทราบสาเหตุ": "Unknown cause",
 "อ่านข้อมูลใหม่จากไฟล์ PDF ที่เก็บไว้ในระบบ (ไม่ต้องอัพซ้ำ)": "Re-read data from the PDF files stored in the system (no re-upload needed)",
 "ซับ (Sub-Assembly)": "Sub (Sub-Assembly)",
 "รายการซับ + ลูกใน BOM (งานพับ/เชื่อม/ยิง เลือกตอนปล่อยใน Release)": "Subs + children in the BOM (bending/welding/fastening chosen when releasing in Release)",
 "แยกหมวดตามกติกาเบอร์ · เบอร์ที่มี * = SITE ITEM": "Categorized by code rules · codes with * = SITE ITEM",
 "กระจก (Glass)": "Glass",
 "รายการกระจก · ใบเบิก ไม่มี QR": "Glass list · issue sheet, no QR",
 "📁 ไฟล์": "📁 Files",
 "โฟลเดอร์ PDF แบบ + รูปถ่ายแพ็ก": "Drawing PDF folder + packing photos",
 "PDF แบบซับ / พาร์ท": "Sub / part drawing PDFs",
 "รูปถ่าย (แพ็ก)": "Photos (packing)",
 "รูปที่ถ่ายตอนแพ็ก": "Photos taken during packing",
 "ค้นหาเบอร์ / description / INV": "Search code / description / INV",
 "ดูซับทั้งหมด": "Show all subs",
 "ดูเฉพาะที่ยังไม่มีแบบ": "Show only those without drawings",
 "คัดลอกไม่ได้": "Copy failed",
 "เปิดไฟล์ PDF ต้นฉบับ": "Open original PDF",
 "ไม่พบ": "Not found",
 "ยังไม่มีกระจก — กระจกมาจาก BOM ของซับ/แผง (เบอร์ GL…) หรือย้ายพาร์ทมาหมวด GLASS": "No glass yet — glass comes from sub/panel BOMs (GL… codes) or move parts to the GLASS category",
 "ยังไม่มี — อัพ PDF แบบซับ/พาร์ทด้านบน": "None yet — upload sub/part drawing PDFs above",
 "ซับ / พาร์ท ของโปรเจค": "Project subs / parts",
 "ลงแบบซับ (SA…) และแบบพาร์ทไว้ที่โปรเจค แยกหมวด · Release ลงแค่แผง แล้วระบบดึงซับ/พาร์ทที่แผงใช้จากที่นี่ให้เอง": "Upload sub drawings (SA…) and part drawings to the project, by category · Release only needs panels; the system pulls the subs/parts each panel uses from here",
 "ลาก PDF แบบซับ / แบบพาร์ท มาวาง หรือกดเพื่อเลือก": "Drag sub / part drawing PDFs here, or click to select",
 "หลายไฟล์พร้อมกันได้ · ระบบอ่าน BILL OF MATERIALS + หัวกระดาษ · ไฟล์เบอร์เดิม = อัปเดตค่าเดิม": "Multiple files at once · reads BILL OF MATERIALS + title block · file with an existing code = updates it",
 "✗ โหลดคลังของโปรเจคไม่ได้:": "✗ Could not load the project library:",
 "✓ บันทึกแล้ว": "✓ Saved",
 "ในโปรเจค: ซับ": "In project: subs",
 "· PDF ใหม่": "· new PDFs",
 "ไฟล์ (ซับ": "files (subs",
 "ยังไม่บันทึก": "Not saved",
 "เอา PDF ใหม่ออก": "Remove new PDFs",
 "↻ อ่านซ้ำจากไฟล์ที่เก็บไว้ (": "↻ Re-read from stored files (",
 "⚠ ซับ": "⚠ Subs",
 "เบอร์ ยังไม่มีเบอร์ลูก — ยังไม่ได้ลงแบบ PDF ของซับเหล่านี้ (ในระบบมีแค่ชื่อเบอร์ที่แผง/ซับแม่อ้างถึง) · ลาก PDF ของซับมาวางด้านบน แล้วกด \"บันทึก\"": "codes have no child codes yet — their PDF drawings haven't been uploaded (the system only has the code names referenced by panels/parent subs) · drag the sub PDFs above, then press \"Save\"",
 "คัดลอกรายชื่อ": "Copy list",
 "ที่มา": "Source",
 "PDF ใหม่": "New PDF",
 "ในระบบ": "In system",
 "ยังไม่มีแบบ": "No drawing",
 "มี PDF ใหม่ที่ยังไม่บันทึก — กด \"บันทึก\" มุมขวาบน": "New PDFs not saved — press \"Save\" at top right",
 "กลับไปแยกหมวดอัตโนมัติ?": "Switch back to auto categories?",
 "หมวดที่ตั้งเองจะถูกล้าง แล้วระบบแยกหมวดให้ใหม่ตามกติกาเบอร์ (เบอร์ที่มี * → SITE ITEM)": "Custom categories will be cleared and the system will re-categorize by code rules (codes with * → SITE ITEM)",
 "วิธีแยกหมวดของพาร์ท": "Part categorization method",
 "ระบบแยกหมวดให้เองตามกติกาเบอร์ · เบอร์ที่มี * ไปเป็น SITE ITEM": "System categorizes by code rules · codes with * go to SITE ITEM",
 "สร้างหมวดเอง + ตัวหน้าของเบอร์ · ไม่เข้าพวก = รอจัดเอง": "Create your own categories + code prefixes · no match = sort manually",
 "เบอร์ที่ไม่เข้าตัวหน้าของหมวดไหน — รอจัดเอง": "Codes matching no category prefix — sort manually",
 "ไม่มีตัวหน้า": "No prefix",
 "แก้ชื่อ / ตัวหน้า": "Edit name / prefix",
 "ชื่อหมวด": "Category name",
 "ตัวหน้าของเบอร์": "Code prefix",
 "ตัวหน้า เช่น AL, BL, HZ (คั่นด้วย , · * = เบอร์ที่มี *)": "Prefixes e.g. AL, BL, HZ (comma-separated · * = codes with *)",
 "ชื่อหมวดใหม่": "New category name",
 "ตัวหน้าของเบอร์ เช่น AL, BL, HZ (คั่นด้วย ,)": "Code prefixes e.g. AL, BL, HZ (comma-separated)",
 "ตัวหน้าของหมวดใหม่": "New category prefixes",
 "แยกตามกติกาเบอร์ · เบอร์ที่มี * = SITE ITEM": "By code rules · codes with * = SITE ITEM",
 "หมวดย่อย:": "Subcategory:",
 "แก้หมวด": "Edit categories",
 "+ หมวดใหม่:": "+ New category:",
 "↳ ยังไม่มีแบบซับ": "↳ No sub drawing for",
 "ในโปรเจค — ลงที่หน้า “ซับ / พาร์ท ของโปรเจค” แล้วจะเห็นเบอร์ลูก": "in the project — upload on the “Project subs / parts” page to see child codes",
 "↳ ยังไม่ได้ลงแบบซับ": "↳ Sub drawing not uploaded for",
 "— ลาก PDF ของซับนี้ไปวางที่หน้า “ซับ / พาร์ท ของโปรเจค” แล้วกด “บันทึก” (เบอร์ลูกถึงจะขึ้น)": "— drag this sub's PDF to the “Project subs / parts” page and press “Save” (then child codes will appear)",
 "(วนซ้ำ)": "(loop)",
 "พิมพ์ไม่สำเร็จ:": "Print failed:",
 "สร้าง Excel ไม่สำเร็จ:": "Excel creation failed:",
 "ตัวอย่างใบปล่อย": "Release sheet preview",
 "กำลังสร้าง…": "Creating…",
 "เลือกใบที่จะพิมพ์": "Select sheets to print",
 "ต้องเลือกอย่างน้อย 1 ใบ": "Select at least 1 sheet",
 "ใบปล่อย ·": "Release sheet ·",
 "· เลือก": "· Select",
 "พิมพ์ / PDF": "Print / PDF",
 "ปิด ✕": "Close ✕",
 "ใบที่จะพิมพ์ / โหลด:": "Sheets to print / download:",
 "ปุ่ม": "Button",
 "→ ที่ปลายทางเลือก": "→ for destination choose",
 "“บันทึกเป็น PDF”": "“Save as PDF”",
 "(Save as PDF) · ปุ่ม": "(Save as PDF) · Button",
 "โหลดไฟล์ .xlsx · แต่ละใบงานขึ้นหน้าใหม่": "downloads a .xlsx file · each work sheet on a new page",
 "เปิดไฟล์ไม่ได้:": "Cannot open file:",
 "📁 ไฟล์ทั้งหมด": "📁 All files",
 "— ยังไม่ได้รัน migration-release-pdfs.sql ?": "— migration-release-pdfs.sql not run yet?",
 "✗ เปิดโฟลเดอร์ไม่ได้:": "✗ Cannot open folder:",
 "โฟลเดอร์ว่าง": "Folder is empty",
 "อ่านแบบ:": "Reading drawing:",
 "ไม่พบตาราง BILL OF MATERIALS หรือหัวกระดาษ PART NO. — อาจเป็น PDF สแกน (รูปภาพ) หรือไม่ใช่แบบแผง/ซับ/พาร์ท": "No BILL OF MATERIALS table or PART NO. title block found — may be a scanned PDF (image) or not a panel/sub/part drawing",
 "ความยาวตัดเผื่อ": "Cut allowance length",
 "ในแบบเอง: ไม่มี INV.CODE (ไม่รู้วัตถุดิบ)": "Within drawing: no INV.CODE (raw material unknown)",
 "ไม่เอาบรรทัดนี้": "Drop this line",
 "ตัดออก (ตาม PDF)": "Remove (per PDF)",
 "เก็บไว้ (ตามเดิม)": "Keep (as before)",
 "(ปัดเศษ)": "(rounded)",
 "หัวกระดาษ": "Title block",
 "สูง": "Height",
 "→ ใช้ค่าจากแบบของเบอร์นั้นเอง": "→ use values from that code's own drawing",
 "ข้อมูลไม่ครบ": "Incomplete data",
 "รูปแบบแปลก (ตัว O หรือ 0?)": "Odd format (letter O or 0?)",
 "รูปแบบแปลก": "Odd format",
 "งานตัด / เจาะ / บาก": "Cutting / drilling / notching",
 "งานพับ": "Bending",
 "งานเหล็ก": "Steel work",
 "SUB-ASSEMBLY (พับ)": "SUB-ASSEMBLY (bending)",
 "ซับงานพับ": "Bending sub",
 "SUB-ASSEMBLY (งานพับ)": "SUB-ASSEMBLY (bending)",
 "SUB A'ssy (พับ)": "SUB A'ssy (bending)",
 "SUB-ASSEMBLY (เชื่อม)": "SUB-ASSEMBLY (welding)",
 "ซับงานเชื่อม": "Welding sub",
 "SUB-ASSEMBLY (งานเชื่อม)": "SUB-ASSEMBLY (welding)",
 "SUB A'ssy (เชื่อม)": "SUB A'ssy (welding)",
 "SUB-ASSEMBLY (ยิง)": "SUB-ASSEMBLY (fastening)",
 "ซับงานยิงประกอบ": "Fastening sub",
 "SUB A'ssy (ยิง)": "SUB A'ssy (fastening)",
 "SUB-ASSEMBLY (งานยิงประกอบ)": "SUB-ASSEMBLY (fastening)",
 "ซับส่งไซต์ · Loose Parts (เบอร์ *)": "Site item subs · Loose Parts (codes with *)",
 "เส้นวัตถุดิบของพาร์ท CUTTING (คำนวณจากความยาว)": "Raw material bars for CUTTING parts (calculated from length)",
 "รายการวัสดุกระจก": "Glass material list",
 "VENT / ENCLOS / อื่นๆ ที่ไม่มี QR": "VENT / ENCLOS / other items without QR",
 "แยกตามหมวดพาร์ท · ผลิตเองมี QR": "By part category · in-house parts have QR",
 "ซับ · 1 เบอร์อยู่ได้หลายใบ": "Subs · 1 code can be on several sheets",
 "ใบเบิกวัตถุดิบงานตัด · ไม่มี QR": "Cutting raw material issue sheet · no QR",
 "ยังไม่จัดหมวด": "Uncategorized",
 "ไม่มีรายการที่จะปล่อยงาน": "Nothing to release",
 "ตรวจเลข Release ซ้ำ…": "Checking for duplicate Release no.…",
 "อ่านเบอร์ในโปรเจค…": "Reading project codes…",
 "ยังไม่ได้รัน migration-release-plans.sql": "migration-release-plans.sql not run yet",
 "บันทึก Release…": "Saving Release…",
 "บันทึกหมวด / งานซับ / ใบงาน…": "Saving categories / sub work / work sheets…",
 "ยังไม่ได้รัน migration-release-plans.sql — หมวด/งานซับไม่ถูกเก็บ": "migration-release-plans.sql not run yet — categories/sub work not saved",
 "ยังไม่ได้รัน migration-release-pdfs.sql — ไม่ได้เก็บตัวไฟล์ PDF (ข้อมูลที่อ่านได้บันทึกแล้ว)": "migration-release-pdfs.sql not run yet — PDF files not stored (the data read was saved)",
 "· ยังไม่มีอะไรถูกแก้": "· Nothing has been changed"
};

const TPLS = [
[
"• ซับ {1} เบอร์: ใช้รายการครบจาก PDF (สกรู/ยาง/กระจก) — {2}",
"• {1} sub codes: use full item list from PDF (screws/gaskets/glass) — {2}"
],
[
"• ซับ {1} เบอร์ที่ยังไม่มีลูก: ใส่ลูกจากคลัง — {2}",
"• {1} sub codes without children: add children from library — {2}"
],
[
"• ซับลูกที่ยังไม่มีในแผน {1} เบอร์ — {2}",
"• {1} nested sub codes not yet in plan — {2}"
],
[
"• พาร์ท/สกรู/ยาง {1} เบอร์: เติมรายละเอียด/หน่วย — {2}",
"• {1} part/screw/gasket codes: fill in description/unit — {2}"
],
[
"อัปเดต BOM ของ {1} จากคลัง?",
"Update BOM of {1} from library?"
],
[
"อัปเดต BOM จากคลังแล้ว ({1} รายการ)",
"BOM updated from library ({1} items)"
],
[
"{1} (จาก {2})",
"{1} (from {2})"
],
[
"แผง {1} แบบ",
"{1} panel types"
],
[
"ซับ {1} เบอร์",
"{1} sub codes"
],
[
"ล่าสุด {1} · {2}",
"Latest {1} · {2}"
],
[
"แผง {1}",
"Panels {1}"
],
[
"พาร์ท {1} เบอร์",
"{1} part codes"
],
[
"ทำแล้ว (ชิ้น) · {1}",
"Done (pcs) · {1}"
],
[
"ทำแล้ว {1}%",
"{1}% done"
],
[
"ค้นหาในล็อต {1}",
"Search in lot {1}"
],
[
"เปิดหน้าพิมพ์ QR ของแผงในล็อต {1} ({2} แผง · 1 QR ต่อที่อยู่)",
"Open QR print page for panels in lot {1} ({2} panels · 1 QR per address)"
],
[
"เปิดหน้าพิมพ์ QR ของ{1}ในล็อต {2} ({3} เบอร์)",
"Open QR print page for {1} in lot {2} ({3} codes)"
],
[
"แก้ BOM {1} จุด ·",
"BOM edits: {1} ·"
],
[
"ซับ {1} เบอร์ยังไม่ได้เลือกงาน (พับ/เชื่อม/ยิง/Site Item): {2} — ไม่ได้อยู่ในใบงานไหน",
"{1} sub codes have no job selected (bending/welding/fastening/Site Item): {2} — not on any work sheet"
],
[
"แผง {1} ยังไม่มี BOM — ได้ QR แผงแต่ตรวจประกอบไม่ได้",
"Panel {1} has no BOM yet — panel QR is created but assembly can't be checked"
],
[
"แผงที่เลือกใช้ซับ/พาร์ท {1} เบอร์ที่ยังไม่ปล่อย (ทั้งในล็อตนี้และก่อนหน้า) — ประกอบได้เมื่อของมาครบ",
"Selected panels use {1} sub/part codes not yet released (in this or earlier lots) — can assemble once all items arrive"
],
[
"เลขล็อต {1} ใช้แล้ว — ใช้ {2}",
"Lot no. {1} is taken — use {2}"
],
[
"เลขล็อตต้องเป็น {1}.ตัวเลข หรือ {2}",
"Lot no. must be {1}.number or {2}"
],
[
"เลขล็อตต้องขึ้นต้นด้วย {1}",
"Lot no. must start with {1}"
],
[
"ปล่อย {1}",
"Release {1}"
],
[
"เลือก {1}",
"Select {1}"
],
[
"ส่ง {1} ไป",
"Send {1} to"
],
[
"ปล่อยไว้แล้วใน {1} {2} — ใช้เป็นเบอร์ลูก ไม่ต้องปล่อยใหม่",
"Already released in {1} {2} — used as child code, no need to release again"
],
[
"จำนวนปล่อย {1}",
"Release qty {1}"
],
[
"ปล่อย {1} + สร้าง QR",
"Release {1} + create QR"
],
[
"{1} มีอยู่แล้ว — ใช้เลขอื่น",
"{1} already exists — use another number"
],
[
"ล็อตบางล็อตใช้ถึง {1} แล้ว — ใช้ {2} ขึ้นไป",
"Some lots already go up to {1} — use {2} or higher"
],
[
"{1} รายการลดไม่ได้ (ดูแถวสีแดง)",
"{1} items can't be reduced (see red rows)"
],
[
"บันทึก {1} ของ Release {2}?",
"Save {1} for Release {2}?"
],
[
"• แก้จำนวน {1} เบอร์",
"• Edit qty: {1} codes"
],
[
"• ยกเลิก {1} เบอร์",
"• Cancel {1} codes"
],
[
"• ยกเลิกที่อยู่แผง {1} ที่ (ยังไม่ได้ปล่อย)",
"• Cancel {1} panel addresses (not released)"
],
[
"• แก้ BOM ลูกใน{1} — {2} จุด (ผลต่อยอดต้องใช้ทั้งใบ {3} เบอร์)",
"• Edit child BOM in {1} — {2} changes (affects total required qty of {3} codes)"
],
[
"• เพิ่มเบอร์ใหม่ {1} เบอร์ (ปล่อยในล็อตถัดไป)",
"• Add {1} new codes (release in next lot)"
],
[
"{1} (ยกเลิก QR {2} ใบ)",
"{1} (cancel {2} QR)"
],
[
"• แก้ในล็อต: {1} — QR ที่ยกเลิกเก็บเป็นหลักฐาน",
"• Edit in lots: {1} — cancelled QRs kept as record"
],
[
"\nเหตุผล: {1}",
"\nReason: {1}"
],
[
"บันทึก {1}",
"Save {1}"
],
[
"· ⚠ อ่านยอดที่ทำแล้วไม่ได้ ({1})",
"· ⚠ Couldn't read done qty ({1})"
],
[
"{1} รายการ",
"{1} items"
],
[
"การแก้ {1}",
"Edits {1}"
],
[
"ยอดใหม่ {1}",
"New total {1}"
],
[
"ยกเลิก {1}",
"Cancel {1}"
],
[
"จำนวนใหม่ {1}",
"New qty {1}"
],
[
"เบอร์ใหม่แทน {1}",
"New code replacing {1}"
],
[
"เอา {1} ออก",
"Remove {1}"
],
[
"· เบิกจริง {1} เส้น",
"· Actual issue {1} bars"
],
[
"เศษ {1} ชิ้น (มม.): {2}",
"Offcuts {1} pcs (mm): {2}"
],
[
"เบิกจริง {1} ล็อต {2}",
"Actual issue {1} lot {2}"
],
[
"หมายเหตุเบิก {1}",
"Issue note {1}"
],
[
"{1} ({2} แผง) · {3} ชิ้น · อยู่ใน {4}",
"{1} ({2} panels) · {3} pcs · in {4}"
],
[
"หมวด {1}",
"Category {1}"
],
[
"ความยาวพาร์ท + รอยตัด {1} มม. ÷ ความยาวเส้น",
"Part length + kerf {1} mm ÷ bar length"
],
[
"ค่าเริ่ม = จัดชิ้นลงเส้นจริง (ยาวก่อน · รอยตัด {1} มม.) · แก้เป็นยอดเบิกจริงได้",
"Default = actual nesting into bars (longest first · kerf {1} mm) · can be edited to actual issue qty"
],
[
"เบิกจริง {1}",
"Actual issue {1}"
],
[
"หมายเหตุ {1}",
"Note {1}"
],
[
"พาร์ท {1}",
"Part {1}"
],
[
"ซับ {1}",
"Sub {1}"
],
[
"{1} มีอยู่แล้วในโปรเจคนี้ — ใช้เลขอื่น หรือเปิดใบเดิมแล้วปล่อยล็อตเพิ่ม",
"{1} already exists in this project — use another number, or open the existing sheet and release more lots"
],
[
"{1}{2} · {3} · {4} · ผู้จัดทำ {5}",
"{1}{2} · {3} · {4} · Prepared by {5}"
],
[
"{1} แผง{2} · {3} แบบ{4}{5}",
"{1} panels{2} · {3} types{4}{5}"
],
[
"ยังไม่มี {1} แบบ: {2}{3} — ได้ QR แผงแต่ยังไม่แตกเป็นซับ/พาร์ท",
"No {1} for types: {2}{3} — panel QR is created but not broken down into subs/parts"
],
[
"ครบ {1} แบบ",
"All {1} types"
],
[
"ยังขาด PDF ซับ {1} · พาร์ท {2} (ไม่รู้ลูกของซับ / INV วัตถุดิบ)",
"Still missing PDFs: subs {1} · parts {2} (sub children / raw material INV unknown)"
],
[
"ยังไม่ได้ตัดสิน {1} จุด (บันทึกเลย = ใช้ตาม PDF)",
"{1} items not yet decided (saving now = use PDF values)"
],
[
"{1} รายการ — BOM เก็บจำนวนเต็ม ระบบปัดให้: {2}{3}",
"{1} items — BOM stores whole numbers, rounded to: {2}{3}"
],
[
"{1} เบอร์ยังไม่ได้เลือกงาน (พับ / เชื่อม / ยิง / Site Item): {2} — เลือกได้ในแท็บ \"ใบงาน + Category\"",
"{1} codes have no job selected (bending / welding / fastening / Site Item): {2} — choose in the \"Work sheet + Category\" tab"
],
[
"ครบ {1} เบอร์ (1 ซับไปได้หลายใบ)",
"All {1} codes (1 sub can go to several sheets)"
],
[
"ปล่อยทั้งหมดเป็น {1} ทันที (แผง {2} · ซับ {3} เบอร์ · พาร์ท {4} เบอร์)",
"Release all as {1} now (panels {2} · subs {3} codes · parts {4} codes)"
],
[
"เปิดหน้า Release {1} ให้ office เลือกปล่อยเป็นล็อต {2} …",
"Open Release {1} page so the office can release as lots {2} …"
],
[
"ปล่อยทั้งหมดเป็น {1} ทันที (ซับ {2} เบอร์ · พาร์ท {3} เบอร์)",
"Release all as {1} now (subs {2} codes · parts {3} codes)"
],
[
"ไม่พบในคลังของโปรเจค {1} เบอร์: {2}",
"Not found in project library ({1} codes): {2}"
],
[
"เลือกซับ {1} · พาร์ท {2} เบอร์ → รวมลูกที่แตกให้แล้ว ซับ {3} · พาร์ท {4} เบอร์",
"Selected subs {1} · parts {2} codes → incl. expanded children: subs {3} · parts {4} codes"
],
[
"{1} เบอร์: {2} — ปล่อยได้แต่ไม่แตกลูก · ลงแบบซับที่หน้า \"ซับ / พาร์ท ของโปรเจค\" ก่อนจะได้เบอร์ลูก",
"{1} codes: {2} — can be released but children are not expanded · add the sub drawing on the \"Project subs / parts\" page first to get child codes"
],
[
"ซับ {1} · พาร์ท {2} เบอร์",
"Subs {1} · parts {2} codes"
],
[
"{1} แผง · {2} แบบ{3}",
"{1} panels · {2} types{3}"
],
[
"· รอตัดสิน {1}",
"· {1} pending"
],
[
"{1} ไฟล์{2}",
"{1} files{2}"
],
[
"{1} เรื่องควรดู",
"{1} issues to review"
],
[
"บันทึกทั้งที่ยังมี {1} เรื่องควรดู?",
"Save anyway with {1} issues to review?"
],
[
"หัวใบนี้ใช้กับทุกชีตและใบสั่งผลิต · ผู้จัดทำ = คนที่ล็อกอิน ({1})",
"This header is used on all sheets and production orders · Prepared by = logged-in user ({1})"
],
[
"· {1} แผง",
"· {1} panels"
],
[
"บันทึก + ปล่อยทั้งหมดเป็น {1}",
"Save + release all as {1}"
],
[
"· ข้ามแถวว่าง {1}",
"· skipped {1} empty rows"
],
[
"✓ {1} {2} แถว{3}",
"✓ {1} {2} rows{3}"
],
[
"· จากชีต \"{1}\"",
"· from sheet \"{1}\""
],
[
"ไม่พบแถว Unit (UAxxxx) ใน PDF{1} — ถ้าเป็นไฟล์สแกนรูป ต้องใช้ไฟล์ที่ก๊อปข้อความได้ หรือก๊อปจาก Excel แทน",
"No Unit rows (UAxxxx) found in PDF{1} — for scanned image files, use a file with copyable text or copy from Excel instead"
],
[
"· จาก PDF {1} ไฟล์",
"· from {1} PDF files"
],
[
"· ไม่พบข้อมูล: {1}",
"· no data found: {1}"
],
[
"✓ เพิ่ม {1} แบบแผงจาก PDF ที่อัพไว้ (แผงละ 1 ชิ้น) — PMU/VMU/EMU ติ๊ก Mockup ให้แล้ว · แบบอื่นต้องใส่ Address · ต้องการหลายชิ้น กด \"เพิ่มแถว\" แล้วพิมพ์ชื่อซ้ำ",
"✓ Added {1} panel types from uploaded PDFs (1 pc each) — PMU/VMU/EMU marked Mockup · other types need an Address · for more pcs, click \"Add row\" and type the same name"
],
[
"ล้างที่อยู่ทั้งหมด {1} แถว?",
"Clear all {1} address rows?"
],
[
"Unit แถว {1}",
"Unit row {1}"
],
[
"Address แถว {1}",
"Address row {1}"
],
[
"Mockup แถว {1}",
"Mockup row {1}"
],
[
"ลบแถว {1}",
"Delete row {1}"
],
[
"หา {1} ในแบบแผงที่อัพไว้ไม่เจอ (อาจอยู่ในซับที่ยังไม่มีแบบ)",
"Can't find {1} in uploaded panel drawings (may be in a sub without a drawing)"
],
[
"ข้าม {1} ไฟล์ (แบบซับ/พาร์ท: {2}{3}) — Release ลงแค่แบบแผง · แบบซับ/พาร์ทให้ลงที่หน้า \"ซับ / พาร์ท ของโปรเจค\" แล้วระบบดึงมาใช้เอง",
"Skipped {1} files (sub/part drawings: {2}{3}) — Release takes panel drawings only · add sub/part drawings on the \"Project subs / parts\" page and the system uses them automatically"
],
[
"{1}: PDF {2}, BOM เดิม {3}, ขาด {4}",
"{1}: PDF {2}, previous BOM {3}, missing {4}"
],
[
"{1} แผง{2}",
"{1} panels{2}"
],
[
"กำลังอ่าน PDF {1}/{2}…",
"Reading PDF {1}/{2}…"
],
[
"โหลดไม่ได้ ({1})",
"Could not load ({1})"
],
[
"ซับ {1} · พาร์ท {2} เบอร์ — ดึงมาใช้กับแผงที่อัพให้เอง",
"Subs {1} · parts {2} codes — pulled in automatically for uploaded panels"
],
[
"เอา PDF ออกทั้งหมด {1} ไฟล์?",
"Remove all {1} PDF files?"
],
[
"{1} {2} จุด",
"{1} · {2} issues"
],
[
"จากคลังของโปรเจค {1} — ใส่จำนวนที่ต้องการปล่อย · ซับจะแตกลูก (ซับย่อย + พาร์ท) ให้เองตาม BOM ในคลัง",
"From project library {1} — enter qty to release · subs expand into children (nested subs + parts) automatically per the library BOM"
],
[
"ซับ ({1})",
"Subs ({1})"
],
[
"พาร์ท ({1})",
"Parts ({1})"
],
[
"จำนวน {1}",
"Qty {1}"
],
[
"ใบงาน + Category ({1})",
"Work sheets + Category ({1})"
],
[
"{1} เส้น (ประมาณ)",
"{1} bars (approx.)"
],
[
"{1} เบอร์",
"{1} codes"
],
[
"{1} แผ่น",
"{1} sheets"
],
[
"{1} (ทำแล้วที่ {2})",
"{1} (done in {2})"
],
[
"{1} แผง",
"{1} panels"
],
[
"· ⚠ ปัดจำนวนต่อชุด {1} รายการ",
"· ⚠ per-set qty rounded for {1} items"
],
[
"ใบงาน {1}",
"Work sheet {1}"
],
[
"{1} (เหลือก่อนตัด {2} มม.)",
"{1} (remaining before cut {2} mm)"
],
[
"ตัดจากเศษ {1} ชิ้น — ตัวอย่างต้นทาง: {2}",
"Cut from offcut {1} pcs — sample source: {2}"
],
[
"เปิดเส้นใหม่ {1} มม.",
"New bar {1} mm"
],
[
"แทนด้วย {1}",
"Replaced by {1}"
],
[
"ตัดจากเศษ {1} จาก {2} ชิ้น",
"Cut from offcut {1} of {2} pcs"
],
[
"· เศษ {1}",
"· offcut {1}"
],
[
"{1} ซับ · {2} พาร์ท{3}",
"{1} subs · {2} parts{3}"
],
[
"{1} แบบ",
"{1} types"
],
[
"{1} / {2} บรรทัด",
"{1} / {2} lines"
],
[
"แสดง {1} จาก {2}",
"Showing {1} of {2}"
],
[
"อ่านซ้ำจากไฟล์ที่เก็บไว้ {1} ไฟล์แล้ว — ตรวจแล้วกด \"บันทึก\" เพื่ออัปเดตข้อมูล",
"Re-read {1} stored files — check, then press \"Save\" to update the data"
],
[
"ข้าม {1} ไฟล์ ({2}) — แบบแผงลงที่ \"ปล่อยงานใหม่\"",
"Skipped {1} files ({2}) — panel drawings go in \"New release\""
],
[
"PDF ใหม่ {1} ไฟล์ยังไม่ได้กด \"บันทึก\" — ถ้ากลับตอนนี้ไฟล์จะหาย ต้องอัพใหม่",
"{1} new PDF files not saved yet — if you go back now they will be lost and must be uploaded again"
],
[
"ซับ {1} เบอร์ · พาร์ท {2} เบอร์",
"Subs {1} codes · Parts {2} codes"
],
[
"PDF ใหม่ {1} ไฟล์ → สร้าง/อัปเดตเบอร์ + BOM ซับในระบบ",
"{1} new PDF files → create/update codes + sub BOMs in the system"
],
[
"บันทึกแล้ว แต่โหลดคลังกลับมาไม่ได้ ({1}) — กด F5 เพื่อรีเฟรช",
"Saved, but could not reload the library ({1}) — press F5 to refresh"
],
[
"{1} เบอร์ · {2}",
"{1} codes · {2}"
],
[
"ไฟล์ต้นฉบับที่อัพไว้ของโปรเจค {1} · แยก sub / part",
"Original files uploaded for project {1} · split by sub / part"
],
[
"คัดลอกรายชื่อซับที่ยังไม่มีแบบ {1} เบอร์แล้ว",
"Copied list of {1} subs without drawings"
],
[
"ตัวหน้า: {1}",
"Prefix: {1}"
],
[
"แก้หมวด {1}",
"Edit category {1}"
],
[
"ลบหมวด {1}",
"Delete category {1}"
],
[
"ตั้งหมวดเอง: เบอร์ที่ขึ้นต้นด้วย \"ตัวหน้า\" ของหมวดไหนเข้าหมวดนั้นอัตโนมัติ (ตัวหน้ายาวสุดชนะ · * ชนะทุกตัว) · ไม่เข้าพวก = \"{1}\" รอจัดเอง (คอลัมน์ \"หมวด\" หรือค้นหา → ติ๊ก → ย้ายไปหมวด)",
"Custom categories: codes starting with a category's \"prefix\" go into it automatically (longest prefix wins · * beats all) · no match = \"{1}\", sort manually (\"Category\" column or search → tick → move to category)"
],
[
"แถว {1}: อ่านเบอร์ไม่ได้",
"Row {1}: cannot read code"
],
[
"แถว {1} {2}: ไม่มีจำนวน",
"Row {1} {2}: no qty"
],
[
"เปิดไฟล์ไม่ได้: {1}",
"Cannot open file: {1}"
],
[
"ชื่อไฟล์ \"{1}\" ไม่ตรงกับเบอร์ในแบบ {2} — ตรวจว่าอัพถูกไฟล์",
"File name \"{1}\" does not match the drawing code {2} — check the correct file was uploaded"
],
[
"{1}: PDF {2} ≠ BOM เดิม {3}",
"{1}: PDF {2} ≠ old BOM {3}"
],
[
"ในแบบเอง: M.D. {1} สั้นกว่า LENGTH {2}",
"Within drawing: M.D. {1} shorter than LENGTH {2}"
],
[
"ในแบบเอง: STOCK NO. {1} ไม่ตรงกับ INV.CODE {2}",
"Within drawing: STOCK NO. {1} does not match INV.CODE {2}"
],
[
"{1} ใหม่ — ยังไม่มีใน BOM เดิม ใช้ค่าจาก PDF",
"{1} new — not in old BOM, using PDF values"
],
[
"{1} {2} ใหม่ — ยังไม่มีใน BOM เดิม ใช้ BOM จาก PDF",
"{1} {2} new — not in old BOM, using PDF BOM"
],
[
"ในแบบเอง: {1} อยู่ 2 บรรทัด (ITEM {2} และ {3}) — รวมจำนวนให้",
"Within drawing: {1} on 2 lines (ITEM {2} and {3}) — qty combined"
],
[
"{1}: มีใน PDF (จำนวน {2}) แต่ไม่มีใน BOM เดิม",
"{1}: in PDF (qty {2}) but not in old BOM"
],
[
"{1}: มีใน BOM เดิม (จำนวน {2}) แต่ไม่มีใน PDF",
"{1}: in old BOM (qty {2}) but not in PDF"
],
[
"{1}: จำนวน PDF {2} {3} BOM เดิม {4}{5}",
"{1}: PDF qty {2} {3} old BOM {4}{5}"
],
[
"{1}: ความยาว PDF {2} ≠ BOM เดิม {3}",
"{1}: PDF length {2} ≠ old BOM {3}"
],
[
"{1}: สูง PDF {2} ≠ BOM เดิม {3}",
"{1}: PDF height {2} ≠ old BOM {3}"
],
[
"{1}: Finish PDF {2} ≠ BOM เดิม {3}",
"{1}: PDF finish {2} ≠ old BOM {3}"
],
[
"ในแบบเอง: {1} ไม่มีจำนวน",
"Within drawing: {1} has no qty"
],
[
"ความยาวซับ PDF {1} ≠ BOM เดิม {2}",
"PDF sub length {1} ≠ old BOM {2}"
],
[
"ในแบบเอง: ยาวซับ {1} ≠ ยาวพาร์ทหลัก {2} {3}",
"Within drawing: sub length {1} ≠ main part length {2} {3}"
],
[
"ในแบบเอง: {1} ยาว {2} มม. มากกว่าความยาวซับ {3}",
"Within drawing: {1} length {2} mm exceeds sub length {3}"
],
[
"{1}: {2}ไม่ตรงกันระหว่าง PDF — {3}{4}",
"{1}: {2} mismatch between PDFs — {3}{4}"
],
[
"ซ้ำ (แถว {1})",
"Duplicate (row {1})"
],
[
"อยู่ใน {1} แล้ว",
"Already in {1}"
],
[
"ข้อมูลไม่ครบ {1} แถว",
"{1} rows incomplete"
],
[
"ที่อยู่ซ้ำ {1} แถว",
"{1} duplicate address rows"
],
[
"ที่อยู่ใช้ใน Release อื่นแล้ว {1} แถว",
"{1} rows with addresses used in another Release"
],
[
"Unit รูปแบบแปลก {1} แถว",
"{1} rows with odd Unit format"
],
[
"{1}: ปล่อยไปแล้ว {2} · ทำแล้ว/ใช้ QR ไปแล้วจนลดได้ถึง {3} เท่านั้น",
"{1}: {2} already released · done/QR used, can only reduce to {3}"
],
[
"อ่าน BOM ไม่ได้ {1} เบอร์ ({2})",
"Could not read BOM for {1} codes ({2})"
],
[
"Release Order \"{1}\" มีอยู่แล้วในโปรเจคนี้ — ถ้าเพิ่งกดแล้วเน็ตหลุด อาจบันทึกไปแล้ว · ตรวจในรายการ Release ก่อน",
"Release Order \"{1}\" already exists in this project — if you just pressed and the connection dropped, it may already be saved · check the Release list first"
],
[
"สร้าง Release + QR ({1} เบอร์)…",
"Creating Release + QR ({1} codes)…"
],
[
"ตั้งชนิดเบอร์ {1}/{2}",
"Setting code types {1}/{2}"
],
[
"ตั้งชนิดไม่สำเร็จ {1} เบอร์ ({2})",
"Failed to set type for {1} codes ({2})"
],
[
"ตั้ง BOM {1}/{2}",
"Setting BOM {1}/{2}"
],
[
"ลูกที่ยังไม่มีในระบบ {1} รายการ (ข้ามใน BOM): {2}{3}",
"{1} children not in system (skipped in BOM): {2}{3}"
],
[
"ตั้ง BOM ไม่สำเร็จ {1} เบอร์ ({2})",
"Failed to set BOM for {1} codes ({2})"
],
[
"เติมชื่อเบอร์ {1}/{2}",
"Filling code names {1}/{2}"
],
[
"เติมชื่อเบอร์ไม่สำเร็จ {1} เบอร์ (ไม่กระทบ QR)",
"Failed to fill names for {1} codes (QR not affected)"
],
[
"Release {1} มีอยู่แล้ว",
"Release {1} already exists"
],
[
"บันทึกแผนไม่สำเร็จ ({1})",
"Failed to save plan ({1})"
],
[
"Release Order \"{1}\" มีอยู่แล้วในโปรเจคนี้",
"Release Order \"{1}\" already exists in this project"
],
[
"สร้างเบอร์ใหม่ {1}/{2}",
"Creating new codes {1}/{2}"
],
[
"ตั้งชนิดไม่สำเร็จ {1} เบอร์",
"Failed to set type for {1} codes"
],
[
"ลูกที่ยังไม่มีในระบบ {1} รายการ: {2}",
"{1} children not in system: {2}"
],
[
"ตั้ง BOM ซับ {1}/{2}",
"Setting sub BOM {1}/{2}"
],
[
"เก็บไฟล์ PDF {1}/{2}",
"Storing PDF files {1}/{2}"
],
[
"เก็บไฟล์ PDF ไม่สำเร็จ {1} ไฟล์ ({2})",
"Failed to store {1} PDF files ({2})"
],
[
"ตรวจเลขล็อต {1}…",
"Checking lot no. {1}…"
],
[
"เลขล็อต {1} ถูกใช้แล้ว (อาจมีคนปล่อยไปก่อน) — รีเฟรชแล้วเลือกใหม่",
"Lot no. {1} already used (someone may have released it first) — refresh and choose again"
],
[
"สร้างล็อต {1} + QR ({2} เบอร์)…",
"Creating lot {1} + QR ({2} codes)…"
],
[
"อ่านข้อมูลล็อต {1} ไม่ได้ ({2})",
"Could not read lot {1} data ({2})"
],
[
"Modify {1} ({2} รายการ)…",
"Modify {1} ({2} items)…"
],
[
"· ล็อตที่แก้สำเร็จแล้ว: {1}",
"· Lots already modified: {1}"
],
[
"Modify {1} ไม่สำเร็จ: {2}{3}",
"Modify {1} failed: {2}{3}"
],
[
"บันทึก {1} ลง Release {2}…",
"Saving {1} to Release {2}…"
]
];

const SHEET_DICT = {};
for (const s of SHEETS) {
  if (s.label && s.en) SHEET_DICT[s.label] = s.en;
  if (s.tab && s.en) SHEET_DICT[s.tab] = s.en;
  if (s.th && s.thEn) SHEET_DICT[s.th] = s.thEn;
}
Object.assign(SHEET_DICT, {"SUB พับ": "SUB Bending", "SUB เชื่อม": "SUB Welding", "SUB ยิง": "SUB Fastening", "SUB Site Item": "SUB Site Item", "พับ": "Bending", "เชื่อม": "Welding", "ยิง": "Fastening"});

// เก็บตก (ไล่ตรวจหน้าจอโหมด EN 2026-10-26)
const FIX_DICT = {
  "รายการกระจก": "Glass list", "ใบเบิก ไม่มี QR": "issue sheet, no QR", "แยกหมวดตามกติกาเบอร์": "categorised by code rules", "เบอร์ที่มี * = SITE ITEM": "codes with * = SITE ITEM",
  "(ติดแผงโดยตรง)": "(directly on panel)",
  "จาก BOM แผง/ซับในล็อต": "from the BOM of panels/subs in this lot",
  "กระจก · จาก BOM แผง/ซับในล็อต": "Glass · from the BOM of panels/subs in this lot",
  "FASTENER, GASKET & SILICONE · จาก BOM แผง/ซับในล็อต": "FASTENER, GASKET & SILICONE · from the BOM of panels/subs in this lot",
  "ลง Address & Unit + อัพ PDF แบบแผง → ระบบแตกเป็นซับ / พาร์ท ให้เอง": "Enter Address & Unit + upload panel drawing PDFs → the system breaks them down into subs / parts",
  "ไม่เปลี่ยนจำนวนที่ปล่อยแล้ว / ประวัติ Modify / QR · ใบปล่อยและใบเบิกจะใช้ข้อมูลใหม่": "Released qty / Modify history / QR stay unchanged · release and issue sheets will use the new data",
};
const FIX_TPLS = [
  ["พับ {1}", "Bending {1}"], ["เชื่อม {1}", "Welding {1}"], ["ยิง {1}", "Fastening {1}"],
  ["{1} แผ่น", "{1} pcs"],
  ["{1} ซับ", "{1} subs"], ["เศษ {1}", "offcut {1}"],
  ["เลือก {1}/{2} ใบ", "{1}/{2} sheets selected"],
];
registerI18n({ dict: { ...DICT, ...FIX_DICT, ...SHEET_DICT }, tpls: [...FIX_TPLS, ...TPLS] });   // ชื่อใบงานจาก SHEETS ชนะ (ชื่อเดียวกับใบพิมพ์)
export default true;
