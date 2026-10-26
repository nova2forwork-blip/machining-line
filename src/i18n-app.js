// ★ 2026-10-26 คำแปลอังกฤษของแอปสำนักงาน (ส่วนที่ยังไม่มีใน DICT ของ i18n-dom) — หัวหน้าเป็นชาวต่างชาติ
//   ดึงข้อความไทยจาก App.jsx / Dashboard.jsx / confirm / labels ฯลฯ · dict = ข้อความคงที่ · tpls = แม่แบบ {1},{2}…
//   (หน้าเครื่อง/แท็บเล็ตคนงาน Station.jsx คงเป็นไทย) · เพิ่ม/แก้คำได้ที่นี่
import { registerI18n } from "./i18n-dom.js";

const DICT = {
 "กดเพื่อเรียง · ลากที่จับ ⠿ เพื่อย้ายคอลัมน์": "Click to sort · drag the ⠿ handle to move the column",
 "ลากที่จับ ⠿ เพื่อย้ายคอลัมน์": "Drag the ⠿ handle to move the column",
 "· คลิกขวา = เลือกคอลัมน์": "· Right-click = choose columns",
 "เลือกคอลัมน์ที่จะแสดง (คลิกขวาที่หัวตารางก็ได้)": "Choose columns to show (or right-click a table header)",
 "ไทย": "Thai",
 "— เลือก / พิมพ์เพื่อค้นหา —": "— Select / type to search —",
 "รายการ": "Items",
 "วิธีใช้": "How to use",
 "กำลังเข้าสู่ระบบ…": "Signing in…",
 "ลองรหัสผิดหลายครั้ง — ระบบพักบัญชีนี้ไว้ 5 นาที แล้วลองใหม่ (หรือให้แอดมินตรวจรหัส)": "Too many wrong passwords — this account is locked for 5 minutes, then try again (or ask an admin to check the password)",
 "ไม่ได้ล็อกอินตอนมีเน็ตมานานกว่า 14 วัน — ต่อเน็ตแล้วล็อกอินใหม่ 1 ครั้ง": "Not signed in online for over 14 days — connect to the internet and sign in once again",
 "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (เน็ตช้า/หลุด) — เช็ค Wi-Fi แล้วกดเข้าสู่ระบบอีกครั้ง": "Can't connect to the server (slow/dropped connection) — check Wi-Fi and press Sign in again",
 "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง": "Incorrect employee ID or password",
 "รายงานสรุป": "Summary report",
 "รหัสผ่านใหม่ต้องอย่างน้อย 4 ตัวอักษร": "New password must be at least 4 characters",
 "ยืนยันรหัสผ่านใหม่ไม่ตรงกัน": "New password confirmation doesn't match",
 "รหัสผ่านใหม่ต้องต่างจากรหัสเดิม": "New password must differ from the old one",
 "รหัสผ่านเดิมไม่ถูกต้อง": "Current password is incorrect",
 "รหัสผ่านใหม่สั้นเกินไป": "New password is too short",
 "เปลี่ยนไม่สำเร็จ": "Change failed",
 "เปลี่ยนไม่สำเร็จ:": "Change failed:",
 "กำลังเปลี่ยน...": "Changing...",
 "กรอกรหัสโปรเจคและชื่อโปรเจคให้ครบ": "Enter both project code and project name",
 "เกิดข้อผิดพลาด:": "An error occurred:",
 "เศษ": "Offcut",
 "เต็ม": "Full",
 "โปรเจคนี้": "this project",
 "มีแล้ว": "Exists",
 "ซ้ำ": "Duplicate",
 "กรุณาเลือกโปรเจคก่อน แล้วจึงวางข้อมูล — ระบบต้องรู้โปรเจคเพื่อแยก Part เดิม/ใหม่ให้ถูกต้อง (เบอร์เดียวกันคนละโปรเจคถือเป็นคนละ Part)": "Please select a project first, then paste the data — the system needs the project to tell existing/new Parts apart correctly (the same code in different projects is a different Part)",
 "\nบันทึกต่อหรือไม่?": "\nContinue saving?",
 "บันทึกต่อ": "Save anyway",
 "เกิดข้อผิดพลาดระหว่างบันทึก:": "Error while saving:",
 "— ถ้าเน็ตหลุดหลังกดบันทึก อาจบันทึกไปแล้ว · รีเฟรชแล้วตรวจในรายการ Release ก่อนกดซ้ำ (กันซ้ำ)": "— If the connection dropped after pressing save, it may already be saved · refresh and check the Release list before pressing again (avoids duplicates)",
 "· ยังไม่มี W/M": "· No W/M yet",
 "บันทึกไว้": "Saved",
 "เครื่อง": "Machine",
 "ปิดสร้าง QR — บันทึกแค่ยอด Release": "QR creation off — save Release qty only",
 "อ่านไฟล์ไม่สำเร็จ": "Failed to read file",
 "เลขที่ Release Order ต้องเป็นรูปแบบ \"P-ตัวเลข\" เช่น P-009 — ไฟล์ไม่มีเลข/เลขผิดรูปแบบ ให้กรอกเอง": "Release Order no. must be in the format \"P-number\", e.g. P-009 — the file has no number or a wrong format, enter it manually",
 "กรุณาเลือกวันที่ปล่อยงาน": "Please select the release date",
 "เกิดข้อผิดพลาดระหว่างนำเข้า:": "Error while importing:",
 "— ถ้าเน็ตหลุดหลังกดนำเข้า อาจนำเข้าไปแล้ว · รีเฟรชแล้วตรวจในรายการ Release ก่อนนำเข้าซ้ำ": "— If the connection dropped after pressing import, it may already be imported · refresh and check the Release list before importing again",
 "รองรับไฟล์ฟอร์ม Production Release Report (หลาย Part ในใบเดียว)": "Supports Production Release Report form files (multiple Parts per sheet)",
 "เลือกไฟล์ Excel (.xlsx)": "Choose Excel file (.xlsx)",
 "วันที่ปล่อยงาน *": "Release date *",
 "ไม่ทราบสาเหตุ": "Unknown cause",
 "อ่านไฟล์ได้": "File read",
 "อ่านไฟล์ไม่สำเร็จ:": "Failed to read file:",
 "ยังไม่ใช่ตาราง — ก็อปจาก Excel โดยลากคลุมทั้งตาราง (รวมแถวหัว Code/Quantity/Sum) ก่อน": "Not a table yet — in Excel, select the whole table (including the Code/Quantity/Sum header row) and copy first",
 "แทนที่ข้อมูลในฟอร์ม?": "Replace form data?",
 "ฟอร์มมีเบอร์กรอกไว้แล้ว — ข้อมูลที่วางจะแทนที่ทั้งหมด": "The form already has codes entered — the pasted data will replace all of it",
 "แทนที่": "Replace",
 "วางข้อมูลได้": "Data pasted",
 "อ่านข้อมูลที่วางไม่สำเร็จ:": "Failed to read pasted data:",
 "เลขที่ Release Order ต้องเป็นรูปแบบ \"P-ตัวเลข\" เช่น P-076": "Release Order no. must be in the format \"P-number\", e.g. P-076",
 "กรุณาเลือกโปรเจค": "Please select a project",
 "กรุณาเลือกวันที่": "Please select a date",
 "ต้องมีอย่างน้อย 1 เบอร์แม่ (กรอก Code)": "At least 1 parent code is required (enter Code)",
 "จำนวนต่อชุดไม่ลงตัว": "Per-set qty doesn't divide evenly",
 "ตรวจเบอร์ที่มีอยู่แล้วไม่สำเร็จ:": "Failed to check existing codes:",
 "ใส่จำนวน": "Enter qty",
 "ไม่พบข้อมูลบั้งในไฟล์/ข้อความ — ตรวจว่ามีหัว 'BUNK NO.' + ตาราง Unit No/Weight": "No bundle data found in file/text — check for a 'BUNK NO.' header + Unit No/Weight table",
 "ยังไม่ใช่ตาราง — ก็อปจาก Excel ทั้งฟอร์มบั้ง (รวมหัว BUNK NO. + ตาราง Unit No) ก่อน": "Not a table yet — in Excel, copy the whole bundle form (including the BUNK NO. header + Unit No table) first",
 "บั้งนี้ไม่มีเลข BUNK NO.": "This bundle has no BUNK NO.",
 "เลขที่ Release Order ต้องเป็นรูปแบบ \"P-ตัวเลข\" เช่น P-100": "Release Order no. must be in the format \"P-number\", e.g. P-100",
 "ยังไม่มีบั้ง — นำเข้าไฟล์ หรือวางฟอร์มบั้งก่อน": "No bundles yet — import a file or paste a bundle form first",
 "มีบั้งที่ไม่มีเลข BUNK NO. — ตรวจไฟล์อีกครั้ง": "Some bundles have no BUNK NO. — check the file again",
 "ตรวจบั้งที่มีอยู่แล้วไม่สำเร็จ:": "Failed to check existing bundles:",
 "(ไม่มีเลขบั้ง)": "(no bundle no.)",
 "เอาบั้งนี้ออก": "Remove this bundle",
 "เบอร์นี้ยังไม่ได้ตั้ง BOM — ตั้งที่หน้า Part Master ก่อน": "This code has no BOM yet — set it on the Part Master page first",
 "โหลดสถานะไม่ได้ (": "Couldn't load status (",
 "ผิดพลาด:": "Error:",
 "ที่สั่งจาก release (แผน)": "Ordered by release (plan)",
 "ที่หน้างานสแกนมาจริง": "Actually scanned on the floor",
 "(เสร็จแล้ว)": "(done)",
 "✓ ทำถูกและครบตามแผน": "✓ Correct and complete per plan",
 "⚠ มีชิ้นที่ไม่อยู่ในแผน (อาจใส่ผิด/เกิน)": "⚠ Some pieces are not in the plan (may be wrong/extra)",
 "⚠ มีชิ้นเกินจำนวนที่แผนกำหนด": "⚠ Some pieces exceed the planned qty",
 "✓ ครบ": "✓ Complete",
 "✗ ยังไม่สแกน": "✗ Not scanned yet",
 "สเตชันไหน · ใคร · เมื่อไร · ใส่อะไรเท่าไร": "Which station · who · when · what and how many",
 "release_finished_pieces ยังไม่มีใน DB (รัน migration-finished-pieces.sql) — ใช้ค่าประมาณ": "release_finished_pieces not in DB yet (run migration-finished-pieces.sql) — using estimates",
 "โหลดข้อมูลไม่สำเร็จ:": "Failed to load data:",
 "เพิ่มจำนวน (+)": "Increase qty (+)",
 "ลดจำนวน (−)": "Decrease qty (−)",
 "แก้ INV Code": "Edit INV Code",
 "ยกเลิก Part": "Cancel Part",
 "Transfer เป็นเบอร์อื่น": "Transfer to another code",
 "แก้จำนวน": "Edit qty",
 "ฐานข้อมูลไม่รับค่านี้ (เช่น จำนวน 0) —": "The database rejected this value (e.g. qty 0) —",
 "M นี้": "This M",
 "สแปร์": "Spare",
 "ทิ้ง (scrap)": "Scrap",
 "เก็บเป็นสแปร์": "Keep as spare",
 "· ยกเลิกทั้ง Part": "· Cancel whole Part",
 "Release Order นี้": "This Release Order",
 "(มีการแก้อื่นอยู่)": "(other edit pending)",
 "สุทธิ:": "Net:",
 "ยังไม่ครบ —": "Incomplete —",
 "🔒 ค่าก่อนแก้เก็บไว้ใน M ก่อนหน้า (ย้อนดูได้) · ทุกรายการบันทึกรวมเป็น": "🔒 Previous values are kept in the previous M (viewable) · all items are saved together as",
 "ครั้งเดียว · บันทึกงานที่ทำไปแล้วไม่ถูกลบ · QR ชิ้นเดิมไม่เปลี่ยน": "in one go · recorded work is not deleted · existing piece QRs unchanged",
 "วันที่ยกเลิก": "Cancel date",
 "ยกเลิกแล้ว": "Cancelled",
 "(ปล่อยงาน)": "(release)",
 "วันที่ปล่อยงาน": "Release date",
 "กด Finished": "Press Finished",
 "ครบจำนวน": "Qty complete",
 "ยังไม่มีเครื่อง": "No machines yet",
 "เปิด/ปิด รายละเอียดแต่ละเครื่อง": "Show/hide details per machine",
 "· ย้ายหมดแล้ว": "· all moved",
 "· ยกเลิก": "· cancelled",
 "ลบ Release": "Delete Release",
 "ลบไม่สำเร็จ:": "Delete failed:",
 "สร้างใบปล่อยไม่สำเร็จ:": "Failed to create release sheet:",
 "· ใช้อยู่ตอนนี้": "· in use now",
 "· ยกเลิกแล้ว": "· cancelled",
 "ดูตัวอย่างใบปล่อย (PRODUCTION ORDER) ของล็อตนี้ แล้วโหลดเป็น PDF หรือ Excel — แยกชีตตามใบงาน มีช่องเซ็นอนุมัติ": "Preview this lot's release sheet (PRODUCTION ORDER) and download as PDF or Excel — one tab per work sheet, with approval signature boxes",
 "กำลังเปิด…": "Opening…",
 "ใบปล่อย (PDF / Excel)": "Release sheet (PDF / Excel)",
 "* นับชิ้นที่หน้าเครื่องกด Finished (ตามรูทของเครื่อง)": "* Counts pcs where the machine pressed Finished (per machine route)",
 "แก้อะไร · ใน M ไหน · กดดูรายละเอียดแต่ละ M ได้ · ของเดิมเก็บเป็นหลักฐาน ลบทับไม่ได้": "What changed · in which M · click each M for details · originals kept as record, cannot be overwritten",
 "· กดเลือกได้หลายสถานะ": "· multiple statuses can be selected",
 "ปล่อยงานใหม่": "New release",
 "เพิ่มพาร์ทเสริม": "Add extra part",
 "เพิ่ม Release แบบเดิม — พาร์ทเสริม/ซ่อมที่ไม่อยู่ใน BOM": "Add Release (classic) — extra/repair parts not in BOM",
 "บันทึกการเปลี่ยนใบงานไม่สำเร็จ:": "Failed to save work sheet change:",
 "ไม่พบ Release ตามเงื่อนไขที่ค้นหา": "No Release matches your search",
 "ยังไม่มี Release — กด \"ปล่อยงานใหม่\" เพื่อเริ่ม": "No Releases yet — click \"New release\" to start",
 "release_finished_pieces ยังไม่มีใน DB — ใช้ค่าประมาณจาก release_op_progress": "release_finished_pieces not in DB yet — using estimate from release_op_progress",
 "ที่ค้นเจอ": "Found",
 "ย้ายที่เลือก": "Move selected",
 "กำลังเตรียมป้าย...": "Preparing labels...",
 "พิมพ์ทั้งหมด": "Print all",
 "พิมพ์": "Print",
 "โหลด QR ไม่สำเร็จ (เน็ตสะดุด) — กด “ค้นหา QR” อีกครั้ง": "Failed to load QR (network glitch) — press “Search QR” again",
 "เลขที่ Release Order ต้องเป็นรูปแบบ \"P-ตัวเลข\" เช่น P-009 (หรือเว้นว่าง)": "Release Order no. must be in the form \"P-number\", e.g. P-009 (or leave blank)",
 "ตรวจเลข Release Order ซ้ำไม่สำเร็จ (เน็ตสะดุด) — ลองบันทึกอีกครั้ง:": "Failed to check duplicate Release Order no. (network glitch) — try saving again:",
 "รวมเป็นใบเดียว": "Merge into one",
 "บันทึก Modify ไม่สำเร็จ:": "Failed to save Modify:",
 "· (Modify บันทึกแล้ว)": "· (Modify saved)",
 "บันทึกไม่สำเร็จ:": "Save failed:",
 "แก้ไขหัวเอกสาร Release": "Edit Release header",
 "เช่น M-001 (เว้นว่าง = 0)": "e.g. M-001 (blank = 0)",
 "ใบนี้มีประวัติ Modify — เลข M เปลี่ยนตามการ Modify/ยกเลิก เท่านั้น": "This sheet has Modify history — M no. changes only via Modify/cancel",
 "ใบนี้มีประวัติ Modify — เปลี่ยนเลขไม่ได้": "This sheet has Modify history — number cannot be changed",
 "บันทึกทั้งใบ": "Save whole sheet",
 "โหลดข้อมูลล็อตไม่สำเร็จ — ปิดแล้วเปิดใหม่อีกครั้ง:": "Failed to load lot data — close and reopen:",
 "ลดจำนวน (ลบ QR)": "Reduce qty (delete QR)",
 "ตรวจ Part No. ซ้ำไม่สำเร็จ — ลองอีกครั้ง": "Failed to check duplicate Part No. — try again",
 "ยืนยัน": "Confirm",
 "ปรับยอดเสร็จไม่สำเร็จ:": "Failed to adjust done count:",
 "(ยังไม่ได้บันทึกช่องอื่น)": "(other fields not saved yet)",
 "ล็อตนี้ยังไม่มีข้อมูลสแกนให้ลบ": "This lot has no scan data to delete",
 "ลบข้อมูลสแกนไม่สำเร็จ:": "Failed to delete scan data:",
 "แก้จำนวนที่ปุ่ม ✎ Modify หน้า Release Order": "Edit qty via the ✎ Modify button on the Release Order page",
 "คิดน้ำหนักในประวัติสแกนของ Part นี้ใหม่ด้วย (รายงานตรงทันที)": "Also recalculate weight in this Part's scan history (reports update immediately)",
 "ลบข้อมูลสแกนของล็อตนี้ (แก้สแกนเกิน/ผิด) — QR/ล็อตยังอยู่": "Delete this lot's scan data (fix over/wrong scans) — QR/lot remain",
 "QR เบอร์แม่": "Parent code QR",
 "จำนวนลูก (ชิ้น)": "Child qty (pcs)",
 "เบอร์ลูก": "Child code",
 "กำลังสร้างไฟล์…": "Creating file…",
 "กดเพื่อเปิดหน้าตรวจเบอร์นี้": "Click to open the check page for this code",
 "ยังไม่ได้รัน migration-round13.sql": "migration-round13.sql has not been run yet",
 "ช่วงเวลายาวเกินไป (สูงสุด 800 วัน · รายวัน 400 วัน)": "Date range too long (max 800 days · daily 400 days)",
 "ไม่มีสิทธิ์ดูรายงานนี้": "No permission to view this report",
 "ช่วงเวลาไม่ถูกต้อง": "Invalid date range",
 "โหลดไม่สำเร็จ": "Load failed",
 "12 สัปดาห์": "12 weeks",
 "26 สัปดาห์": "26 weeks",
 "12 เดือน": "12 months",
 "24 เดือน": "24 months",
 "ธ.ค.": "Dec",
 "โหลดรายการ Release ไม่สำเร็จ — กดรีเฟรชหน้าอีกครั้ง:": "Failed to load Release list — refresh the page:",
 "(ปิดแล้ว)": "(closed)",
 "ตรวจไม่สำเร็จ": "Check failed",
 "เติมน้ำหนัก": "Fill weight",
 "เติมน้ำหนักไม่สำเร็จ:": "Failed to fill weight:",
 "เวลาเดินเครื่อง (วินาที)": "Machine run time (sec)",
 "แบบ": "Drawing",
 "เวลา (วินาที)": "Time (sec)",
 "กำลังสร้างไฟล์...": "Creating file...",
 "แล้วกด “เติมน้ำหนักย้อนหลัง” เพื่อบันทึกลงฐานข้อมูล": "then press “Backfill weight” to save to the database",
 "กำลังเติม...": "Filling...",
 "เติมน้ำหนักย้อนหลัง": "Backfill weight",
 "แตะเพื่อดูการสแกนที่เป็นที่มาของตัวเลขนี้": "Tap to see the scans behind this number",
 "โหลดข้อมูลล็อต (จำนวนสั่ง/INV/ความยาว) ไม่สำเร็จ:": "Failed to load lot data (order qty/INV/length):",
 "เลข Release ต้องเป็นรูปแบบ \"P-ตัวเลข\" เช่น P-009": "Release no. must be in the form \"P-number\", e.g. P-009",
 "\n· แก้ข้อมูลเฉพาะสแกนนี้": "\n· edits this scan only",
 "\n\n⚠️ Part No. / Release / จำนวนสั่ง / INV / ความยาวพาร์ท มีผลกับ \"ทุกสแกน\" ของ Release/พาร์ทนี้ ไม่ใช่แค่แถวนี้": "\n\n⚠️ Part No. / Release / order qty / INV / part length affect \"every scan\" of this Release/part, not just this row",
 "ลบทั้งแถว": "Delete whole row",
 "เลข Release": "Release no.",
 "ความยาวพาร์ท": "Part length",
 "ความยาว QR ในล็อต": "QR length in lot",
 "ข้อมูลสแกน": "Scan data",
 "ลบสแกนแล้ว": "Scan deleted",
 "ไม่สำเร็จ:": "Failed:",
 "การสแกนทั้งหมดของเครื่องนี้ · เลือกช่วงวันที่ที่ต้องการดูได้": "All scans of this machine · choose a date range to view",
 "แอดมิน: กดที่แถวเพื่อแก้ไข (จำนวน / น้ำหนัก / สถานะ / INV / ความยาว) หรือ ลบทั้งแถว": "Admin: click a row to edit (qty / weight / status / INV / length) or delete the whole row",
 "เว้นน้ำหนักว่างไว้ = คิดจากจำนวนอัตโนมัติ": "Leave weight blank = auto-calculated from qty",
 "เปลี่ยนจำนวนสั่งที่ปุ่ม ✎ Modify หน้า Release": "Change order qty via the ✎ Modify button on the Release page",
 "5 ช่องนี้มีผลกับทั้ง Release/พาร์ท (ทุกสแกน) ไม่ใช่แค่แถวนี้": "These 5 fields apply to the whole Release/part (every scan), not just this row",
 "(ชิ้นงาน)": "(pcs)",
 "สรุปรายเครื่อง": "Summary by machine",
 "· วันนี้ (ยังไม่จบวัน)": "· Today (day not over yet)",
 "ปี": "Year",
 "(ไม่แสดงเป้า)": "(target hidden)",
 "เคล็ดลับ: แตะแถวเครื่องเพื่อดูการสแกนทั้งหมดของเครื่องนั้น (พร้อมวัน · เวลา)": "Tip: tap a machine row to see all its scans (with date · time)",
 "โหลดรายการ Release ไม่สำเร็จ:": "Failed to load Release list:",
 "บันทึกซับ/พาร์ทแล้ว — มีบางรายการไม่สำเร็จ": "Subs/parts saved — some items failed",
 "บันทึกซับ / พาร์ท ของโปรเจคแล้ว": "Project subs / parts saved",
 "ซับ / พาร์ท ของโปรเจค": "Project subs / parts",
 "ลงแบบซับ/พาร์ท แยกหมวดไว้ที่โปรเจค — Release ลงแค่แผง แล้วดึงจากที่นี่": "Upload sub/part drawings by category at the project — a Release only adds panels, then pulls from here",
 "Release ทั้งหมด": "All Releases",
 "บัญชีนี้ยังไม่มีสิทธิ์ลบ Release ฝั่งเซิร์ฟเวอร์ (RPC จำกัดเฉพาะแอดมิน) — แจ้งผู้ดูแลให้เปิดสิทธิ์ให้ออฟฟิศ": "This account has no permission to delete Releases on the server (RPC is admin-only) — ask the administrator to grant it to the office",
 "ออฟฟิศยังไม่มีสิทธิ์ลบ Release (ต้องปรับ RPC)": "Office has no permission to delete Releases yet (RPC needs updating)",
 "กรอกรหัสและชื่อโปรเจคให้ครบ": "Enter both project code and name",
 "เปลี่ยนสถานะไม่สำเร็จ:": "Failed to change status:",
 "โหลดรายชื่อไม่สำเร็จ:": "Failed to load list:",
 "บังคับออก": "Force sign-out",
 "บังคับออกไม่สำเร็จ:": "Force sign-out failed:",
 "ออนไลน์": "Online",
 "เงียบ (แท็บปิด/ออฟไลน์)": "Idle (tab closed/offline)",
 "บทบาท": "Role",
 "ใช้งานล่าสุด": "Last active",
 "กำลังเตะ...": "Signing out...",
 "QR/ล็อตถูกลบหรือแก้": "QR/lot deleted or edited",
 "ลองซิงค์หลายครั้งไม่สำเร็จ": "Sync failed after several tries",
 "โหลดไม่สำเร็จ:": "Failed to load:",
 "ทำเครื่องหมายไม่สำเร็จ:": "Failed to mark:",
 "งานหน้าเครื่อง": "Machine work",
 "เวลาทำงาน": "Work time",
 "ผู้ทำ": "Done by",
 "งาน": "Job",
 "✓ จัดการแล้ว": "✓ Handled",
 "แก้สแกน": "Edit scan",
 "ลบสแกน": "Delete scan",
 "แก้พนักงาน": "Edit employee",
 "นำเข้าไฟล์สำรอง": "Import backup file",
 "เปลี่ยนประเภทขั้นตอน": "Change step type",
 "แก้ BOM": "Edit BOM",
 "แก้ Part Master": "Edit Part Master",
 "แก้วันที่ Modify": "Edit Modify date",
 "ยกเลิก Modify": "Cancel Modify",
 "แก้ Material": "Edit Material",
 "แก้ Material (หลายแถว)": "Edit Material (multiple rows)",
 "ลบ Material": "Delete Material",
 "ดึง INV จาก Release": "Pull INV from Release",
 "ลบพนักงาน": "Delete employee",
 "ลบเครื่องจักร": "Delete machine",
 "ล้างข้อมูลสแกน": "Clear scan data",
 "กู้คืน Backup": "Restore backup",
 "แก้หัวเอกสาร Release": "Edit Release header",
 "โหลดเพิ่มไม่สำเร็จ:": "Failed to load more:",
 "โหลดเพิ่ม": "Load more",
 "ตรวจสอบไม่สำเร็จ:": "Check failed:",
 "ชุด Release นี้": "This Release set",
 "Part นี้": "This part",
 "ชิ้นนี้": "This piece",
 "· ปิดแล้ว": "· closed",
 "(ไม่มีเลข)": "(no number)",
 "พิมพ์เบอร์พาร์ทเพื่อค้นหา…": "Type a part code to search…",
 "กู้คืนไม่สำเร็จ:": "Restore failed:",
 "โหลดจุดกู้คืนไม่สำเร็จ — ตรวจว่ารัน migration-project-backups.sql ใน Supabase แล้วหรือยัง (": "Failed to load restore points — check that migration-project-backups.sql has been run in Supabase (",
 "สร้างจุดกู้คืนไม่สำเร็จ:": "Failed to create restore point:",
 "ย้อนทั้งโปรเจคกลับเรียบร้อยแล้ว": "Whole project rolled back",
 "กู้คืนข้อมูลที่หายไปเรียบร้อยแล้ว": "Missing data restored",
 "อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .json ที่ดาวน์โหลดจากปุ่มสำรองข้อมูลเท่านั้น": "Can't read the file — it must be a .json file downloaded from the backup button",
 "รูปแบบไฟล์ไม่ถูกต้อง (ไม่พบส่วน tables) — ใช้ไฟล์ที่ดาวน์โหลดจากแอปนี้": "Invalid file format (no tables section) — use a file downloaded from this app",
 "นำเข้า": "Import",
 "ยังไม่ได้รัน migration-audit-round12.sql — ตาราง Modify/Material ฯลฯ ในไฟล์ยังไม่ได้นำเข้า": "migration-audit-round12.sql has not been run — the Modify/Material etc. tables in the file were not imported",
 "นำเข้าตารางเสริมไม่สำเร็จ:": "Failed to import extra tables:",
 "นำเข้าไม่สำเร็จ:": "Import failed:",
 "— ตรวจว่ารัน migration-backup-import.sql ใน Supabase แล้วหรือยัง": "— check that migration-backup-import.sql has been run in Supabase",
 "สำรองข้อมูลไม่สำเร็จ:": "Backup failed:",
 "· (ข้อมูลในไฟล์มีอยู่ในระบบครบแล้ว ไม่มีอะไรต้องเติม)": "· (all data in the file already exists in the system, nothing to fill in)",
 "กัด": "Milling",
 "เฉือน": "Shearing",
 "ปั๊ม": "Punching",
 "ต๊าป": "Tapping",
 "เซาะร่อง": "Grooving",
 "ผ่า": "Slitting",
 "โหลดขั้นตอนที่เครื่องทำได้ไม่สำเร็จ — กดรีเฟรชหน้า:": "Failed to load the machine's steps — refresh the page:",
 "กรอกรหัสและชื่อเครื่องให้ครบ": "Enter both machine code and name",
 "สถานี": "Station",
 "กรอกชื่อเครื่องให้ครบ": "Enter the machine name",
 "สร้างขั้นตอนไม่สำเร็จ": "Failed to create step",
 "ยังไม่ได้รัน migration-scan-mode.sql ใน Supabase — รันก่อนแล้วตั้งรูปแบบการสแกนใหม่": "migration-scan-mode.sql has not been run in Supabase — run it first, then set the scan mode again",
 "เฉพาะแอดมินตั้งรูปแบบการสแกนได้": "Only admins can set the scan mode",
 "ตั้งรูปแบบการสแกนไม่สำเร็จ": "Failed to set scan mode",
 "ลบเครื่อง": "Delete machine",
 "⚠️ ถ้าลบ ตัวเลขการผลิตของเครื่องนี้จะหายจากรายงานถาวร (กู้คืนไม่ได้)\n": "⚠️ If deleted, this machine's production figures will be permanently removed from reports (cannot be undone)\n",
 "ถ้าเครื่องแค่เลิกใช้ แนะนำให้เก็บไว้เฉยๆ จะดีกว่า\n\nยืนยันลบเครื่องพร้อมประวัติทั้งหมด?": "If the machine is just retired, it's better to simply keep it\n\nDelete the machine with all its history?",
 "ลบพร้อมประวัติ": "Delete with history",
 "ลบไม่สำเร็จ": "Delete failed",
 "เพิ่มเครื่องแล้ว ✓ — ตั้งรูปแบบการสแกน + ขั้นตอนที่ทำได้ต่อเลย หรือกด \"ข้าม\" ไว้ตั้งทีหลังด้วยปุ่ม แก้ไข": "Machine added ✓ — set the scan mode + steps now, or press \"Skip\" to set them later with the Edit button",
 "เพิ่มขั้นตอนไม่สำเร็จ:": "Failed to add step:",
 "• ประวัติสแกนเดิมของขั้นตอนนี้จะไปนับในรายงานแผนกใหม่ทั้งหมด\n\nยืนยันหรือไม่?": "• All past scan history of this step will count in the new department's report\n\nConfirm?",
 "เปลี่ยนประเภท": "Change type",
 "เปลี่ยนประเภทไม่สำเร็จ:": "Failed to change type:",
 "ลบขั้นตอนนี้?": "Delete this step?",
 "แผนก/หน้าปลายทาง": "Department/target screen",
 "เพิ่มไม่ได้ — มีชื่อนี้อยู่แล้ว": "Can't add — this name already exists",
 "เพิ่มไม่สำเร็จ:": "Failed to add:",
 "ลบรายการนี้?": "Delete this item?",
 "เลือกเครื่อง/สถานีก่อน — ขั้นตอนหลายอันเก็บไว้กับเครื่อง (ถ้าไม่ผูกเครื่อง จะเก็บได้ขั้นตอนเดียว)": "Select a machine/station first — multiple steps are stored with the machine (without a machine, only one step can be stored)",
 "⚠️ โหลดสถานะไม่สำเร็จ (เน็ตสะดุด) — ปิดหน้าต่างแล้วเปิดใหม่ก่อนแก้ช่องนี้": "⚠️ Failed to load status (network glitch) — close and reopen the window before editing this field",
 "กรอกชื่อให้ครบ": "Enter the name",
 "เฉพาะแอดมินตั้ง \"ล็อกอินได้หลายเครื่อง\" ได้": "Only admins can set \"Sign in on multiple devices\"",
 "ตั้งล็อกอินหลายเครื่องไม่สำเร็จ": "Failed to set multi-device sign-in",
 "ล็อกอินหลายเครื่อง": "Multi-device sign-in",
 "แนะนำให้ \"ปิดใช้งาน\" แทนการลบ เพื่อเก็บชื่อผู้ทำไว้ในประวัติ\n\n": "\"Deactivate\" is recommended instead of deleting, to keep the worker's name in history\n\n",
 "ถ้ายืนยันลบ: ตัวเลขการผลิตจะยังอยู่ครบ แต่ประวัติจะไม่ระบุว่าใครเป็นคนทำ\n\nยืนยันลบ?": "If you delete: production figures stay intact, but history won't show who did the work\n\nConfirm delete?",
 "ลบบัญชีตัวเองไม่ได้ — ให้บัญชี Admin อื่นลบให้": "You can't delete your own account — ask another Admin account to do it",
 "เครื่อง (ผูกตามรหัส)": "Machine (assign by code)",
 "กรอกรหัส/ชื่อ/รหัสผ่านให้ครบ": "Enter code/name/password",
 "เพิ่มพนักงานไม่สำเร็จ:": "Failed to add employee:",
 "มีลูกตัวนี้อยู่แล้ว — แก้จำนวนในตารางแทน": "This child already exists — edit the qty in the table instead",
 "เพิ่มลูก (Part / ซับ ในโปรเจคนี้)": "Add child (part / sub in this project)",
 "จำนวน/ชุด": "Qty/set",
 "บันทึก BOM": "Save BOM",
 "น้ำหนัก/ชิ้นไม่ถูกต้อง": "Invalid weight/pc",
 "ความยาว/ชิ้นไม่ถูกต้อง": "Invalid length/pc",
 "เพิ่ม Part ไม่สำเร็จ:": "Failed to add part:",
 "เปลี่ยน": "Change",
 "เปลี่ยนชนิดไม่สำเร็จ:": "Failed to change type:",
 "ลบ Part": "Delete part",
 "— ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่": "— offline, reconnect and try again",
 "— อัปเดตเพื่อใช้เวอร์ชันล่าสุด": "— update to use the latest version",
 "บัญชีถูกใช้ที่อื่น หรือเซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่": "Account used elsewhere or session expired — please sign in again",
 "กำลังเปิดหน้างาน…": "Opening work screen…",
 "— ตัวเลขด้านล่างยังไม่ใช่ข้อมูลจริง (ไม่ใช่ว่าไม่มีงาน) · ลองใหม่อีกครั้ง หรือเลือกช่วงเวลาที่สั้นลง": "— the numbers below are not real data yet (it doesn't mean there's no work) · try again or pick a shorter period",
 "กำลังโหลดข้อมูล…": "Loading data…",
 "ไม่พบรายการที่ตรงกับ “": "No items match “",
 "🔑 เข้าสู่ระบบด้วย": "🔑 Sign in with",
 "บัญชี Admin": "an Admin account",
 "เพื่อตั้งเครื่อง/สถานีประจำ": "to set the assigned machine/station",
 "ให้บัญชี": "Have the account",
 "— ระบบจะเปิดหน้า ตั้งค่า → พนักงาน ให้เลย": "— the system will open Settings → Employees for you",
 "กำลังเข้าสู่ระบบ": "Signing in",
 "✓ เปลี่ยนรหัสผ่านเรียบร้อยแล้ว — ครั้งต่อไปให้ใช้รหัสผ่านใหม่ในการเข้าสู่ระบบ": "✓ Password changed — use your new password next time you sign in",
 "เสร็จสิ้น": "Done",
 "ใหม่)": "new)",
 "วางจาก Excel ได้ (Ctrl+V) · Weight/M ว่าง = เติมจาก": "Paste from Excel (Ctrl+V) · blank Weight/M = filled from",
 "· จำนวนว่าง = 1": "· blank qty = 1",
 "วางจาก Excel ได้ทั้งบล็อก —": "Paste a whole block from Excel —",
 "เรียงตามคอลัมน์บนจอ": "in on-screen column order",
 "เริ่มจากช่องที่คลิก (ลากหัวคอลัมน์ ⠿ ให้ตรงกับไฟล์ Excel ได้ · มีหัวตาราง = จับจากชื่อหัว) · คอลัมน์ที่ระบบคำนวณ (Total Kg · น้ำหนัก/ชิ้น) ข้ามค่าที่วางมา · น้ำหนัก/ชิ้น = (Length ÷ 1,000) × Weight/M": "starting at the clicked cell (drag column headers ⠿ to match your Excel file · with a header row = matched by header name) · calculated columns (Total Kg · weight/pc) ignore pasted values · weight/pc = (Length ÷ 1,000) × Weight/M",
 "Weight/M เว้นว่าง = เติมจาก": "Blank Weight/M = filled from",
 "ตาม INV (โปรเจคนี้ก่อน → Center Stock) ·": "per INV (this project first → Center Stock) ·",
 "OFF CUT (เศษ) กรอก Weight/M เอง": "OFF CUT: enter Weight/M manually",
 "ไม่เติม/ไม่บันทึก · จำนวนเว้นว่างได้ = 1 อัตโนมัติ · ขั้นตอนการทำงานขึ้นกับ \"เครื่อง\" ที่ทำ": "not filled/not saved · blank qty = 1 automatically · process steps depend on the \"machine\" doing the work",
 "↩ ย้อนกลับแล้ว": "↩ Reverted",
 "ในไฟล์เขียน “": "File says “",
 "” → จัดรูปแบบเป็น": "” → formatted as",
 "ไม่พบโปรเจค \"": "Project \"",
 "\" ที่ตรงกันในระบบ — กรุณาเลือกโปรเจคเป้าหมายเอง": "\" not found in the system — please choose the target project manually",
 "พบ": "Found",
 "รายการ Part · รวม": "Part items · total",
 "Part จะถูกสร้างใหม่อัตโนมัติ": "Parts will be created automatically",
 "⚠ ไฟล์": "⚠ File",
 "/ชุด": "/set",
 "พร้อมบันทึก": "Ready to save",
 "ยูนิต — แตะการ์ดเพื่อดูรายละเอียด": "units — tap a card for details",
 "ยูนิต ·": "units ·",
 "ยูนิต": "Units",
 "ตำแหน่ง": "Location",
 "ขนาด (มม.)": "Size (mm)",
 "× ล้างตัวกรอง": "× Clear filters",
 "โปรเจค / Part": "Project / Part",
 "ไม่พบในรายการที่กำลังทำ — ถ้าเบอร์เสร็จแล้ว ให้สแกน/พิมพ์ QR ในช่องด้านบน": "Not found in work in progress — if the code is finished, scan/type the QR in the box above",
 "ตัว · แผน = ต่อชุด×": "pcs · plan = per set ×",
 "พาร์ทนี้ทำจากเครื่องไหน ขั้นตอนไหนบ้าง —": "Which machines and steps make this part —",
 "= ทุกสถานะ ·": "= all statuses ·",
 "= กด Finished · เทียบกับจำนวนสั่ง": "= Finished pressed · compared with ordered qty",
 "กำลังทำ:": "In progress:",
 "หมายเหตุทั้งหมด:": "All notes:",
 "กำลังเปิด Release…": "Opening Release…",
 "กำลังเปิดหน้าปล่อยงานใหม่…": "Opening new release page…",
 "ค้นหา Release ที่เคยปล่อยงาน หรือกด \"ปล่อยงานใหม่\" (ลงที่อยู่ + อัพ PDF แบบ → ระบบสร้าง BOM และ QR ให้) · แตะแถวเพื่อดูความคืบหน้า แก้ไข หรือลบ": "Search past Releases, or click \"New release\" (enter addresses + upload drawing PDF → system builds BOM and QR) · tap a row to view progress, edit or delete",
 "ตรงที่ค้น": "matching search",
 "= ชิ้นที่หน้าเครื่องกด Finished · ยอดสะสมทั้งหมด": "= pcs with Finished pressed at the machine · all-time total",
 "= ชิ้นที่หน้าเครื่องกด": "= pcs pressed at the machine",
 "ตามรูทของเครื่อง (เครื่องติ๊กขั้นตอนไหนไว้ก็ตามนั้น) · ชิ้นเดียวกันกด Finished หลายเครื่อง/หลายครั้ง นับครั้งเดียว · ไม่เกินจำนวนสั่ง (ส่วนเกิน = สแปร์) · ยอด": "per machine route (follows the steps each machine has ticked) · the same piece Finished on several machines/times counts once · capped at ordered qty (excess = spare) · total",
 "สะสมทั้งหมด": "all-time total",
 "ไม่ขึ้นกับช่วงเวลาด้านบน · กรองตามโปรเจค / Part / Release ที่เลือก": "Not affected by the period above · filtered by selected project / Part / Release",
 "⚠ ยังไม่ได้รัน": "⚠ Not yet run",
 "ใน Supabase — ตอนนี้เป็นค่าประมาณ (ขั้นตอนที่มีชิ้นเสร็จมากสุด) และยังไม่แสดงเครื่อง": "in Supabase — currently an estimate (step with most finished pcs) and machines not shown yet",
 "⚠ ป้ายรายชิ้นรวม": "⚠ Per-piece labels total",
 "ใบ — พิมพ์เยอะมาก อาจใช้เวลาโหลด/พิมพ์นาน (เลือกเฉพาะพาร์ทที่ต้องการได้)": "sheets — a large print job, may take long to load/print (you can select only the parts you need)",
 "* แสดงตัวอย่าง 600 ใบแรก — เวลาพิมพ์จะพิมพ์ครบทุกใบที่เลือก (": "* Previewing first 600 sheets — printing will include all selected sheets (",
 "แก้ค่าหัวเอกสารที่ใช้ “ทั้งใบ” — บันทึกครั้งเดียวจะเปลี่ยนให้ครบทุก Part (": "Edit the header values for the “whole sheet” — one save updates every Part (",
 "รายการ) ในใบนี้พร้อมกัน": "items) in this sheet at once",
 "เลข M ตั้งโดยระบบ Modify — แก้ไม่ได้ที่นี่": "M no. is set by the Modify system — cannot be edited here",
 "ใบนี้มีประวัติ Modify แล้ว — เปลี่ยนเลขไม่ได้ (ประวัติผูกกับเลขเดิม)": "This sheet has Modify history — number cannot be changed (history is tied to the original number)",
 "แก้จำนวนที่ปุ่ม": "Edit qty with the button",
 "(บันทึกเป็น M ใหม่ เก็บของเดิมเป็นหลักฐาน)": "(saved as a new M, original kept as record)",
 "ใบนี้มีประวัติ Modify — แก้ INV ที่": "This sheet has Modify history — edit INV via",
 "(จะได้เก็บเป็น M ใหม่)": "(so it is kept as a new M)",
 "มีผลกับทุก Release ของพาร์ทนี้ (QR ที่พิมพ์แล้วยังสแกนได้) ·": "Applies to every Release of this part (printed QRs still scan) ·",
 "ความยาว material": "Material length",
 "ตั้งค่าเดียวให้ทุกสแกนของล็อตนี้ (ไม่กระทบน้ำหนัก/จำนวน)": "Set one value for every scan in this lot (does not affect weight/qty)",
 "· เกิน": "· over",
 "(สแปร์)": "(spare)",
 "· ยังไม่สแกน": "· not scanned",
 "จะสร้าง QR เพิ่มอีก": "Will create",
 "ใบ ต่อท้ายล็อตเดิม": "more QR sheets, appended to the existing lot",
 "จะลบ QR ที่ยังไม่สแกนออก": "Will delete unscanned QRs",
 "มี Part ที่ยังไม่ได้ตั้งน้ำหนัก/ชิ้น — น้ำหนักจะถูกนับเป็น 0 กก.": "Some Parts have no weight/pc set — their weight will count as 0 kg.",
 "ตั้งน้ำหนัก/ชิ้นได้ที่ ✎ แก้ไข ในหน้า Release (หรือ Setup → Part Master) · ตั้งแล้วรายงานนับ กก. ให้ทันที": "Set weight/pc via ✎ Edit on the Release page (or Setup → Part Master) · reports count kg immediately once set",
 "สแกนในช่วงนี้บันทึกไว้ 0 กก.": "Scans in this period saved with 0 kg",
 "(ตอนสแกนยังไม่ได้ตั้งน้ำหนัก) — หน้านี้คิดจากน้ำหนัก/ชิ้นปัจจุบันให้แล้ว แต่ยอดหน้าเครื่อง/ยอดรายวันยังเป็น 0 · กดเติมเพื่อบันทึกลงฐานข้อมูล": "(weight not set at scan time) — this page uses the current weight/pc, but machine and daily totals are still 0 · click Fill to save to the database",
 "น้ำหนักเฉลี่ย/วัน": "Avg weight/day",
 "= ปริมาณงานที่ประมวลผล ÷ จำนวนวันที่มีงานจริง · ชิ้นที่ทำหลายขั้นตอนในเครื่องเดียว (สแกนครั้งเดียว) นับครั้งเดียว ·": "= work processed ÷ number of days with actual work · a piece doing several steps on one machine (one scan) counts once ·",
 "= รวมทุกครั้งที่สแกน ชิ้นที่ผ่านหลายขั้นตอน (คนละครั้ง) นับต่อขั้นตอน (วัดภาระงานรวมของสาย)": "= every scan counted; a piece passing several steps (separate scans) counts per step (measures total line workload)",
 "แต่ละเครื่องทำขั้นตอนอะไรไปเท่าไร (ชิ้น·กก.) + เวลาเดินเครื่อง + เฉลี่ย/วัน ในตารางเดียว ·": "What each machine did per step (pcs·kg) + run time + daily avg in one table ·",
 "ตัวเลขคือปริมาณงาน (นับต่อการสแกน) ไม่ใช่จำนวนวัสดุ ·": "figures are workload (counted per scan), not material quantity ·",
 "= เวลาที่จับจากกด START–SAVE บนหน้าเครื่อง (ไม่ใช่เวลาเครื่องเปิดจริง)": "= time captured from START–SAVE on the machine screen (not actual machine power-on time)",
 "แต่ละแถว = Part ในแต่ละ Release · คอลัมน์ขั้นตอน = จำนวนชิ้นที่ผ่านขั้นตอนนั้น ·": "Each row = a Part in a Release · step columns = pcs that passed that step ·",
 "แยกคอลัมน์ ·": "separate column ·",
 "= ชิ้นที่กด Finished": "= pcs with Finished pressed",
 "กด “เพิ่มโปรเจค” เพื่อสร้างโปรเจคแรก": "Click “Add project” to create your first project",
 "ปิดแล้ว": "Closed",
 "เมื่อมีการปล่อยงาน/สแกน จะเห็นสรุปแยกตาม Part ที่นี่": "Once work is released/scanned, a summary by Part appears here",
 "ใต้โปรเจคนี้มี": "This project has",
 "· สแกนไปแล้ว": "· scanned",
 "· งานหน้าเครื่อง": "· machine records",
 "อ่านจำนวนข้อมูลใต้โปรเจคนี้ไม่ได้ (เน็ตสะดุด) — ลบได้แต่ต้องพิมพ์รหัสยืนยัน": "Could not read data counts for this project (network issue) — you can delete, but must type the confirmation code",
 "Release ในโปรเจคนี้": "Releases in this project",
 "กำลังลบ": "Deleting",
 "เซสชัน · ออนไลน์ตอนนี้": "sessions · online now",
 "เครื่องนี้": "This device",
 "จะลบข้อมูลสแกนของ": "Will delete scan data for",
 "ทุก Part / ทุกชุด": "all Parts / all sets",
 "ในโปรเจคนี้ —": "in this project —",
 "ชุด ·": "sets ·",
 "ไม่มี Part ที่มีข้อมูลสแกนในโปรเจคนี้": "No Parts with scan data in this project",
 "ลบข้อมูลสแกน (": "Delete scan data (",
 "รายการ)": "items)",
 "พบ: บันทึกงานหน้าเครื่อง": "Found: machine records",
 "· สแกนสำนักงาน": "· office scans",
 "· รีเซ็ตชิ้นงาน": "· piece resets",
 "· ครอบคลุม": "· covering",
 "ลากที่จับ ⠿ บนหัวคอลัมน์เพื่อจัดลำดับ ·": "Drag the ⠿ handle on a column header to reorder ·",
 "คลิกขวาที่หัวตาราง": "Right-click the table header",
 "(หรือปุ่ม ▥ มุมขวาบนของตาราง) เพื่อ": "(or the ▥ button at top right of the table) to",
 "ติ๊กเปิด-ปิดคอลัมน์": "show/hide columns",
 "• คุณเป็น": "• You are an",
 "แอดมิน": "admin",
 "— ลากที่ตารางไหน จะกลายเป็น": "— any table you rearrange becomes the",
 "ค่ากลาง": "default",
 "ให้ทุกเครื่องเห็นเหมือนกันทันที": "for every device immediately",
 "• คุณลากเอง = จำเป็น": "• Your own changes = saved as",
 "ของคุณเอง": "your own",
 "(ตามติดทุกเครื่องที่ล็อกอินบัญชีนี้)": "(follows you on every device signed in to this account)",
 "ลำดับที่ใช้จริง:": "Order applied:",
 "ของฉัน": "Mine",
 "ก่อน · ถ้าไม่ได้ตั้งเองใช้": "first · if not set, use",
 "(ที่แอดมินจัด) · ถ้าไม่มีใช้": "(set by admin) · if none, use",
 "ค่าเริ่มต้น": "Default",
 "ตอนนี้: ตั้งลำดับเอง": "Now: custom order",
 "ตาราง · ค่ากลาง": "tables · default",
 "ตาราง · ซ่อนคอลัมน์ไว้: ของฉัน": "tables · hidden columns: mine",
 "เลือกวิธีกู้คืนสำหรับโปรเจคนี้ (สแนปช็อตนี้มี": "Choose a restore method for this project (this snapshot has",
 "แถว):": "rows):",
 "คืนเฉพาะ Part / Release / QR ที่ถูกลบไป —": "Restore only deleted Parts / Releases / QRs —",
 "ข้อมูลเดิมและงานที่สแกนใหม่ทั้งหมดยังอยู่ครบ": "existing data and all new scans stay intact",
 "ไม่ทับข้อมูลปัจจุบัน": "Does not overwrite current data",
 "โครงโปรเจคกลับเป็นสภาพวันนั้นเป๊ะ —": "Project structure returns exactly to that day —",
 "การสแกนที่เกิดหลังวันนั้นบนโปรเจคนี้จะหายไป": "scans made on this project after that day will be lost",
 "(ต้องพิมพ์รหัสยืนยัน)": "(confirmation code required)",
 "ยืนยันกู้คืนแบบ": "Confirm restore:",
 "เฉพาะที่หายไป": "missing items only",
 "— ระบบจะเติมข้อมูลที่ถูกลบกลับมา โดยไม่แตะข้อมูลปัจจุบันและการสแกนใหม่ทั้งหมด": "— the system will restore deleted data without touching current data or any new scans",
 "⚠ ย้อนทั้งโปรเจคกลับไปวันนั้น — การสแกนที่เกิดหลัง": "⚠ Revert the whole project to that day — scans made after",
 "บนโปรเจคนี้จะหายไปถาวร": "on this project will be permanently lost",
 "พิมพ์รหัสโปรเจค": "Type project code",
 "เพื่อยืนยัน": "to confirm",
 "✓ สำรองข้อมูลล่าสุดสำเร็จ —": "✓ Latest backup succeeded —",
 "ไฟล์:": "File:",
 "· เวลา": "· time",
 "✓ นำเข้าสำเร็จ — เพิ่มข้อมูลที่หายไปกลับมา": "✓ Import succeeded — missing data restored",
 "จากไฟล์:": "from file:",
 "⚠️ เลือกข้ามหลายแผนก — 1 สเตชันควรทำแผนกเดียว (ไม่งั้นพนักงานจะถูกเด้งไปหน้าแรกที่ตรงเท่านั้น)": "⚠️ Multiple departments selected to skip — a station should handle one department (otherwise employees are only sent to the first matching page)",
 "ขั้นตอนที่ติ๊กใหม่ (แพ็กแผง / แพ็กไซต์ไอเทม / MILLING) ถ้ายังไม่มีในระบบ กด \"บันทึก\" แล้วจะสร้างให้อัตโนมัติ": "Newly ticked steps (panel pack / site item pack / MILLING) not yet in the system will be created automatically when you click \"Save\"",
 "ติดกระจก (Glazing)": "Glazing",
 ": เลือกประเภท": ": choose type",
 "(→ /glazing) · สแกนหน้าต่าง (ซับ) หรือแผงที่": "(→ /glazing) · scan a window (sub) or panel that is",
 "ประกอบเสร็จแล้ว": "fully assembled",
 "→ ใส่จำนวนที่ติดกระจก → สแกนกระจกถ้ามี QR (ไม่บังคับ) → บันทึก = นับยอดติดกระจกแยก · สเตชันซับไม่ต้องรอกระจกก่อนปิดงานเฟรม": "→ enter glazed qty → scan glass if it has a QR (optional) → save = glazing counted separately · sub stations don't wait for glass before closing frame work",
 "ยังไม่มีขั้นตอน": "No steps yet",
 "เพิ่มขั้นตอนแรกด้านบน": "Add the first step above",
 "โหลด BOM เดิมไม่สำเร็จ — ยังแก้ไม่ได้ (กันบันทึกทับ BOM จริง) ·": "Failed to load existing BOM — editing disabled (prevents overwriting the real BOM) ·",
 "ยังไม่มีลูกใน BOM": "No children in BOM yet",
 "เลือกลูกด้านบนแล้วกด “เพิ่มลูก”": "Choose a child above and click “Add child”",
 "ลูก (Part No.)": "Child (Part No.)",
 "เติมน้ำหนักให้สแกนเดิมของเบอร์นี้ที่บันทึกไว้ 0 กก. (ตอนสแกนยังไม่มีน้ำหนัก)": "Fill weight for this code's earlier scans saved with 0 kg (no weight at scan time)",
 "‹ ก่อนหน้า": "‹ Previous",
 "หน้า": "Page",
 "ถัดไป ›": "Next ›",
 "ยังไม่มี Part": "No Parts yet",
 "กรอกฟอร์มด้านบนแล้วกด “เพิ่ม Part” เพื่อเพิ่มรายการแรก": "Fill in the form above and click “Add Part” to add the first item",
 "เกิดข้อผิดพลาดในการแสดงผล": "Display error",
 "ลองกด “โหลดใหม่” — ถ้ายังพบปัญหา ให้แคปข้อความด้านล่างส่งให้ผู้ดูแลระบบ": "Try “Reload” — if the problem persists, screenshot the message below and send it to the system admin",
 "โหลดใหม่ (ล้างแคช)": "Reload (clear cache)",
 "ชม.": "h",
 "น.": "m",
 "จอแสดงการผลิตแบบเรียลไทม์": "Real-time production display",
 "ชิ้นงานที่ทำวันนี้": "Pieces made today",
 "น้ำหนักรวมวันนี้": "Total weight today",
 "เวลาเดินเครื่องรวม (หน้าเครื่อง)": "Total run time (machines)",
 "การสแกนวันนี้": "Scans today",
 "ครั้ง": "times",
 "ยังไม่มีงานวันนี้": "No work today yet",
 "ยังไม่มีงานเข้าวันนี้ — รอเครื่องเริ่มสแกน…": "No work in today yet — waiting for machines to start scanning…",
 "การผลิตรายชั่วโมง · วันนี้": "Hourly production · today",
 "รอข้อมูลการผลิต…": "Waiting for production data…",
 "◉ ฟีดการผลิตสด": "◉ Live production feed",
 "รอการสแกนจากหน้าเครื่อง…": "Waiting for scans from machines…",
 "กำลังเชื่อมต่อสายการผลิต…": "Connecting to the production line…",
 "หยุด": "Stopped",
 "พัก": "Break",
 "ว่าง": "Idle",
 "ไม่มีสัญญาณ": "No signal",
 "เดิน": "Running",
 "ว่าง/ปิด": "Idle/Off",
 "ไม่มีเครื่องหยุด": "No machines stopped",
 "เครื่องที่หยุดอยู่": "Stopped machines",
 "เครื่องที่มีงานวันนี้": "Machines with work today",
 "การเชื่อมต่ออาจหลุด — กำลังลองใหม่": "Connection may be lost — retrying",
 "อัปเดตสด": "Live updates",
 "กำลังเชื่อมต่อใหม่": "Reconnecting",
 "กดเพื่อเปิด/ปิดเส้น": "Click to show/hide line",
 "ซ่อนรหัสผ่าน": "Hide password",
 "แสดงรหัสผ่าน": "Show password",
 "เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต popup แล้วลองใหม่": "The browser blocked the print window — please allow pop-ups and try again"
};

const TPLS = [
[
"ซ่อนอยู่ {1} คอลัมน์ — กดเพื่อเลือก",
"{1} columns hidden — click to choose"
],
[
"ไม่พบรายการที่ตรงกับ “{1}”",
"No items match “{1}”"
],
[
"(ใช้งานล่าสุด {1} น.)",
"(last active {1})"
],
[
"บัญชีนี้กำลังใช้งานอยู่ที่เครื่องอื่น{1} — เข้าไม่ได้ · ให้กด “ออกจากระบบ” ที่เครื่องนั้นก่อน หรือรอสักครู่หากเครื่องนั้นปิดไปแล้ว (แอดมินสั่งเด้งออกจากเมนู ตั้งค่า → ผู้ใช้ออนไลน์ ได้)",
"This account is in use on another device{1} — can't sign in · Press “Sign out” on that device first, or wait a moment if it has been closed (an admin can force sign-out in Settings → Online users)"
],
[
"ตั้งค่า → พนักงาน: กด “แก้ไข” ที่ {1} แล้วเลือกเครื่อง/สถานีประจำ",
"Settings → Employees: click “Edit” on {1}, then choose the assigned machine/station"
],
[
"รหัสโปรเจค \"{1}\" มีอยู่แล้ว กรุณาใช้รหัสอื่น",
"Project code \"{1}\" already exists — please use another code"
],
[
"ความยาว {1} มม.",
"Length {1} mm"
],
[
"ค่าที่ดูผิดปกติ (Weight/M เกิน {1} กก./ม. หรือความยาวน้อยกว่า {2} มม.) — พิมพ์ผิดหน่วยหรือเปล่า?\n\n",
"Values look unusual (Weight/M over {1} kg/m or length under {2} mm) — wrong unit?\n\n"
],
[
"+ อีก {1}",
"+ {1} more"
],
[
"วางแล้ว {1} แถว",
"Pasted {1} rows"
],
[
"แถว {1}: ไม่มี INV Code",
"Row {1}: no INV Code"
],
[
"แถว {1}: INV ซ้ำในตาราง",
"Row {1}: duplicate INV in table"
],
[
"แถว {1}: {2} ไม่ใช่ตัวเลข{3}",
"Row {1}: {2} is not a number{3}"
],
[
"มี {1} แถวที่ยังไม่มี INV Code (ช่องสีแดง)",
"{1} rows have no INV Code (red cells)"
],
[
"ตัวเลขไม่ถูกต้อง {1} แถว (ช่องสีแดง)",
"{1} rows have invalid numbers (red cells)"
],
[
"INV ซ้ำกับที่มีอยู่แล้ว {1} รายการ",
"{1} INV already exist"
],
[
"INV เหล่านี้มีอยู่แล้วใน{1} — จะทับค่าเดิม หรือข้ามไป?",
"These INV already exist in {1} — overwrite the old values or skip?"
],
[
"(INV ใหม่ {1} รายการยังบันทึกตามปกติ)",
"({1} new INV will still be saved as normal)"
],
[
"ทับ = ใช้ค่าที่กรอกใหม่แทนค่าเดิม (ช่องที่เว้นว่างไม่ลบค่าเดิม) · ข้าม = ไม่บันทึกแถวที่ซ้ำ{1}",
"Overwrite = use the new values instead of the old ones (blank cells don't clear old values) · Skip = don't save duplicate rows{1}"
],
[
"ทับค่าเดิม ({1})",
"Overwrite ({1})"
],
[
"ข้าม {1} รายการที่มีอยู่แล้ว — ไม่มี INV ใหม่ให้บันทึก",
"Skipped {1} existing items — no new INV to save"
],
[
"แก้ {1}",
"Edited {1}"
],
[
"เพิ่ม {1}",
"Added {1}"
],
[
"ข้าม {1} ที่มีแล้ว ({2}{3})",
"Skipped {1} existing ({2}{3})"
],
[
"บันทึกไม่ผ่าน {1}:",
"Save failed {1}:"
],
[
"วางแล้ว {1} แถว — ตรวจว่าแต่ละคอลัมน์ลงช่องถูก",
"Pasted {1} rows — check each column landed in the right field"
],
[
"คอลัมน์ {1}",
"Column {1}"
],
[
"คอลัมน์ {1} ไปที่",
"Column {1} goes to"
],
[
"มีแล้วในรายการนี้{1} — ตอนบันทึกจะถามว่าทับค่าเดิมหรือข้าม",
"Already in this list{1} — you'll be asked to overwrite or skip when saving"
],
[
"เดิม: {1}",
"Old: {1}"
],
[
"มีแล้ว {1}",
"Exists {1}"
],
[
"บันทึกการแก้ไข ({1})",
"Save changes ({1})"
],
[
"บันทึก ({1})",
"Save ({1})"
],
[
"ลบ {1} ออกจาก{2}?\n\n(ไม่กระทบ Release/Part ที่ใช้ INV นี้อยู่)",
"Delete {1} from {2}?\n\n(Releases/Parts using this INV are not affected)"
],
[
"ลบ {1} แล้ว",
"Deleted {1}"
],
[
"ลบ {1} รายการออกจาก{2}?\n\n{3}\n\n(ไม่กระทบ Release/Part ที่ใช้ INV เหล่านี้อยู่)",
"Delete {1} items from {2}?\n\n{3}\n\n(Releases/Parts using these INV are not affected)"
],
[
"ลบ {1} รายการ",
"Delete {1} items"
],
[
"ลบแล้ว {1} · ไม่สำเร็จ {2} ({3})",
"Deleted {1} · failed {2} ({3})"
],
[
"ลบแล้ว {1} รายการ",
"Deleted {1} items"
],
[
"จาก Release {1}",
"From Release {1}"
],
[
"ดึง INV ที่ Part ในโปรเจคนี้ใช้อยู่ แต่ยังไม่มีในรายการ ({1} รายการ)\n\n{2}{3}\n\nWeight/M คิดจาก น้ำหนัก/ชิ้น ÷ ความยาว ของ Release เดิม (ใส่ให้เฉพาะที่ทุก Release ตรงกัน) · ความยาว/จำนวนเส้น กรอกเองต่อ",
"Pull INV used by Parts in this project but not yet in the list ({1} items)\n\n{2}{3}\n\nWeight/M is calculated from weight/pc ÷ length of the existing Releases (filled only where all Releases agree) · enter length/bar qty yourself"
],
[
"เพิ่ม {1} INV จาก Release เดิม",
"Add {1} INV from existing Releases"
],
[
"บันทึกอัตโนมัติตอนสร้าง Release {1}",
"Auto-saved when creating Release {1}"
],
[
"มีใน Center Stock ด้วย (W/M {1}) — ตอนสร้าง Release โปรเจคนี้ใช้ค่าของโปรเจคก่อน",
"Also in Center Stock (W/M {1}) — when creating a Release, this project's value is used first"
],
[
"{1} โปรเจค",
"{1} projects"
],
[
"ดึง INV จาก Release เดิม ({1})",
"Pull INV from existing Releases ({1})"
],
[
"เลือกทั้งหมด ({1})",
"Select all ({1})"
],
[
"ลบที่เลือก ({1})",
"Delete selected ({1})"
],
[
"แถว {1} · {2}{3}",
"Row {1} · {2}{3}"
],
[
"ยังบันทึกไม่ได้ — มี {1} จุดที่ต้องแก้ (ช่องสีแดง · กดชื่อในรายการเพื่อไปที่ช่องนั้น)",
"Can't save yet — {1} fields need fixing (red cells · click a name in the list to jump to it)"
],
[
"จำนวนของ Part \"{1}\" ไม่ถูกต้อง — ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป",
"Qty of Part \"{1}\" is invalid — must be a whole number of 1 or more"
],
[
"ตัวเลขของ Part \"{1}\" ไม่ถูกต้อง (ความยาว / Weight/M ต้องเป็นตัวเลข ≥ 0)",
"Numbers of Part \"{1}\" are invalid (length / Weight/M must be numbers ≥ 0)"
],
[
"มี {1} แถวที่กรอกข้อมูลแต่ไม่มี Part No. — แถวเหล่านี้จะไม่ถูกบันทึก\n",
"{1} rows have data but no Part No. — these rows won't be saved\n"
],
[
"Part No. ซ้ำในใบนี้: {1}{2} — จะรวมเป็น Part เดียวกัน (จำนวนแยกเป็นหลายล็อต)\n",
"Duplicate Part No. in this sheet: {1}{2} — will be merged into one Part (qty split into several lots)\n"
],
[
"Release Order \"{1}\" มีอยู่แล้วในโปรเจคนี้ — ถ้าเพิ่งกดแล้วเน็ตหลุด อาจบันทึกไปแล้ว · รีเฟรช/ตรวจในรายการ Release ก่อนกดซ้ำ (กันบันทึกซ้ำ)",
"Release Order \"{1}\" already exists in this project — if you just pressed save and the connection dropped, it may already be saved · refresh/check the Release list before pressing again (avoids duplicates)"
],
[
"· เติม Weight/M {1}",
"· Weight/M filled {1}"
],
[
"บันทึก Material ของโปรเจค: INV ใหม่ {1}{2}{3} — ไปกรอกความยาว/จำนวนได้ที่เมนู \"บันทึก Material\"",
"Project Material saved: new INV {1}{2}{3} — enter length/qty in the \"Material\" menu"
],
[
"ความยาวน้อยกว่า {1} มม. — พิมพ์เป็นเมตรหรือเปล่า?",
"Length under {1} mm — entered in meters?"
],
[
"เติมอัตโนมัติจาก {1} ({2}) — พิมพ์ทับได้",
"Auto-filled from {1} ({2}) — you can overwrite"
],
[
"ไม่ตรงกับที่บันทึกไว้ของ {1}: {2} ({3}) — ใช้ค่าในแถวนี้",
"Doesn't match saved value of {1}: {2} ({3}) — using this row's value"
],
[
"Weight/M เกิน {1} กก./ม. — ผิดหน่วยหรือเปล่า?",
"Weight/M over {1} kg/m — wrong unit?"
],
[
"มีในบันทึก Material ของโปรเจคนี้{1}{2}",
"In this project's Material records{1}{2}"
],
[
"มีใน Center Stock{1}{2}",
"In Center Stock{1}{2}"
],
[
"Weight/M เติมอัตโนมัติ {1} แถว",
"Weight/M auto-filled in {1} rows"
],
[
"Weight/M ไม่ตรงกับที่บันทึกไว้ {1} แถว — ใช้ค่าในแถว",
"Weight/M differs from saved value in {1} rows — using row values"
],
[
"OFF CUT (เศษ) {1} แถว — ยังไม่กรอก Weight/M {2} แถว (กรอกเอง ไม่บันทึกเข้า Material)",
"OFF CUT (offcut) {1} rows — Weight/M not entered in {2} rows (enter manually, not saved to Material)"
],
[
"OFF CUT (เศษ) {1} แถว — กรอก Weight/M เอง ไม่บันทึกเข้า Material",
"OFF CUT (offcut) {1} rows — enter Weight/M manually, not saved to Material"
],
[
"INV ใหม่ {1} รายการ — จะบันทึกเข้า Material ของโปรเจคนี้",
"{1} new INV — will be saved to this project's Material"
],
[
"Release Order \"{1}\" มีอยู่แล้วในโปรเจคนี้ — อาจนำเข้าไปแล้ว · ตรวจในรายการ Release ก่อนนำเข้าซ้ำ",
"Release Order \"{1}\" already exists in this project — it may already be imported · check the Release list before importing again"
],
[
"บันทึก INV ใหม่ {1} รายการเข้า Material ของโปรเจค — กรอกความยาว/จำนวนได้ที่เมนู \"บันทึก Material\"",
"Saved {1} new INV to project Material — enter length/qty in the \"Material\" menu"
],
[
"INV ใหม่ {1} รายการ → บันทึกเข้า Material ของโปรเจค",
"{1} new INV → saved to project Material"
],
[
"นำเข้าและสร้าง QR ทั้งหมด ({1} ใบ)",
"Import and create all QR ({1} labels)"
],
[
"{1}: ฟอร์ม BOM แผง {2} แผง · ซับ {3} เบอร์ — ตรวจแล้วกดบันทึก",
"{1}: panel BOM form, {2} panels · {3} sub codes — check, then press Save"
],
[
"{1} {2} เบอร์แม่ — ตรวจแล้วกดบันทึก",
"{1} {2} parent codes — check, then press Save"
],
[
"ข้อมูลนี้ดูเหมือนฟอร์ม BOM (เบอร์แผงซ้ำ {1} แถว) แต่อ่านไม่ผ่าน: {2} — ก็อปให้มีแถวหัวตาราง Panel / Panel Quantity / Code / Quantity (หรือ Sum) มาด้วย",
"This looks like a BOM form ({1} repeated panel-code rows) but couldn't be read: {2} — copy it including the header row Panel / Panel Quantity / Code / Quantity (or Sum)"
],
[
"{1} {2} แผง (ปล่อยงานเฉยๆ) — ตรวจแล้วกดบันทึก",
"{1} {2} panels (release only) — check, then press Save"
],
[
"ไม่พบเบอร์แม่ {1} หลังสร้าง",
"Parent code {1} not found after creation"
],
[
"สร้าง/หาลูก {1} ไม่สำเร็จ",
"Failed to create/find child {1}"
],
[
"ตั้ง BOM ของ {1} ไม่สำเร็จ ({2})",
"Failed to set BOM of {1} ({2})"
],
[
"ลูก {1} รายการมีเบอร์แต่ยังไม่กรอก \"ต่อชุด\": {2}{3} — กรอกจำนวน หรือลบแถวนั้นก่อนบันทึก",
"{1} children have a code but no \"per set\" qty: {2}{3} — enter the qty or delete those rows before saving"
],
[
"จำนวนแม่ของ \"{1}\" ต้องเป็นจำนวนเต็ม ≥ 1",
"Parent qty of \"{1}\" must be a whole number ≥ 1"
],
[
"จำนวนต่อชุดของลูก \"{1}\" ใน \"{2}\" ต้องเป็นจำนวนเต็ม ≥ 1",
"Per-set qty of child \"{1}\" in \"{2}\" must be a whole number ≥ 1"
],
[
"ลูก \"{1}\" ซ้ำ 2 แถวใน \"{2}\" — รวมจำนวนเป็นแถวเดียวก่อนบันทึก",
"Child \"{1}\" appears in 2 rows in \"{2}\" — combine into one row before saving"
],
[
"เบอร์แม่ \"{1}\" ซ้ำ 2 กลุ่ม — รวมจำนวนเป็นกลุ่มเดียวก่อนบันทึก",
"Parent code \"{1}\" appears in 2 groups — combine into one group before saving"
],
[
"ลูก {1} รายการ หารต่อชุดไม่ลงตัว — BOM เก็บได้แค่จำนวนเต็ม จึงต่างจากไฟล์:\n\n{2}{3}\n\nหน้าประกอบจะตรวจครบตาม BOM นี้ · แก้ \"ต่อชุด\" ในฟอร์มก่อนได้ หรือกดบันทึกตามนี้",
"{1} children don't divide evenly per set — BOM stores whole numbers only, so it differs from the file:\n\n{2}{3}\n\nThe assembly page will check completeness against this BOM · you can fix \"per set\" in the form first, or press Save as is"
],
[
"เบอร์แม่ {1} เบอร์มีอยู่แล้วในโปรเจคนี้ — จะ \"ไม่ปล่อยงาน/ไม่สร้าง QR ใหม่\" ให้ (อัปเดตชนิด + BOM เท่านั้น):\n",
"{1} parent codes already exist in this project — they will \"not be released / no new QR\" (type + BOM update only):\n"
],
[
"\n\nถ้าต้องการปล่อยงานเพิ่มของเบอร์เดิม ใช้ปุ่ม ✎ Modify ที่หน้า Release · {1} เบอร์ที่เหลือจะปล่อยงานตามปกติ",
"\n\nTo release more of an existing code, use the ✎ Modify button on the Release page · the other {1} codes will be released as normal"
],
[
"กำลังบันทึก {1} ({2}/{3})...",
"Saving {1} ({2}/{3})..."
],
[
"บันทึกไม่สำเร็จที่เบอร์ \"{1}\": {2}",
"Save failed at code \"{1}\": {2}"
],
[
"· บันทึกสำเร็จไปแล้ว {1} เบอร์ (เอาออกจากฟอร์มให้แล้ว ไม่ต้องทำซ้ำ)",
"· {1} codes already saved (removed from the form, no need to redo)"
],
[
"อ่านเป็นฟอร์ม BOM แผง: {1} แถว → แผง {2} · ซับ {3} เบอร์ (ลูกของแต่ละซับอยู่ในกลุ่มซับ) · จำนวน = ต่อแผง 1 ชุด × Panel Quantity",
"Read as panel BOM form: {1} rows → {2} panels · {3} sub codes (each sub's children are in its sub group) · qty = 1 set per panel × Panel Quantity"
],
[
"ซับซ้อนซับ {1} เบอร์ — แยกชั้นตามคอลัมน์ Sub-01 / Sub-02 · บันทึกซับชั้นในก่อนให้เอง",
"{1} nested sub codes — layered by Sub-01 / Sub-02 columns · inner subs are saved first automatically"
],
[
"ซับซ้อนซับ {1} เบอร์ (SUB 2nd) — แยกชั้นตามย่อหน้าในช่อง Part No. · บันทึกซับชั้นในก่อนให้เอง",
"{1} nested sub codes (SUB 2nd) — layered by indentation in the Part No. cell · inner subs are saved first automatically"
],
[
"ซับซ้อนซับ {1} เบอร์ (SUB 2nd) — บันทึกซับชั้นในก่อนให้เอง",
"{1} nested sub codes (SUB 2nd) — inner subs are saved first automatically"
],
[
"ซับที่อยู่ในคอลัมน์ Sub แต่ไม่มีแถวของตัวเอง (ไม่รู้จำนวน · ตั้งเป็น 1) {1} เบอร์:",
"{1} subs listed in the Sub column but without their own row (qty unknown · set to 1):"
],
[
"ช่อง Quantity ว่าง/ไม่ใช่ตัวเลข {1} แถว (นับเป็น 0 — ลูกที่ต่อชุดว่างจะบันทึกไม่ได้ ต้องกรอกก่อน):",
"Quantity blank/not a number in {1} rows (counted as 0 — children with blank per-set qty can't be saved, fill in first):"
],
[
"ข้ามแถวที่ขีดฆ่า (แก้ Rev แล้ว) {1} แถว:",
"Skipped {1} struck-through rows (Rev changed):"
],
[
"มี Description แต่ย่อหน้าอยู่ใต้ซับ {1} แถว — จัดเป็นลูกของซับตามย่อหน้า ตรวจว่าถูก:",
"{1} rows have a Description but are indented under a sub — treated as children of that sub by indentation, please check:"
],
[
"ข้ามแถวที่ซ่อนอยู่ในไฟล์ {1} แถว (เช่นกรองไว้) — ถ้าต้องการ ให้ยกเลิกตัวกรอง/เลิกซ่อนแล้วนำเข้าใหม่",
"Skipped {1} hidden rows in the file (e.g. filtered) — if needed, clear the filter/unhide and import again"
],
[
"จำนวนต่อชุดหารไม่ลงตัว {1} รายการ — ปัดเป็นจำนวนเต็มให้แล้ว ตรวจ/แก้ก่อนบันทึก:",
"{1} per-set qty don't divide evenly — rounded to whole numbers, check/fix before saving:"
],
[
"(ซ้ำ {1} บั้ง — แทนที่ของเดิม)",
"({1} duplicate bundles — replacing existing)"
],
[
"{1} {2} บั้ง{3} · รวมทั้งหมด {4} บั้ง {5} ยูนิต — ตรวจแล้วกดบันทึก",
"{1} {2} bundles{3} · total {4} bundles, {5} units — check, then press Save"
],
[
"ไม่พบบั้ง {1} หลังสร้าง",
"Bundle {1} not found after creation"
],
[
"สร้าง/หายูนิต {1} ไม่สำเร็จ",
"Failed to create/find unit {1}"
],
[
"ตั้ง BOM ของบั้ง {1} ไม่สำเร็จ ({2})",
"Failed to set BOM of bundle {1} ({2})"
],
[
"บันทึกรายการในบั้ง {1} ไม่สำเร็จ ({2})",
"Failed to save items in bundle {1} ({2})"
],
[
"BUNK NO. ซ้ำในไฟล์: {1} — รวมเป็นบั้งเดียว/แก้เลขก่อนบันทึก",
"Duplicate BUNK NO. in file: {1} — merge into one bundle/fix the number before saving"
],
[
"บั้ง {1} บั้งมีอยู่แล้วในโปรเจคนี้ — จะอัปเดตรายการในบั้งให้ (ไม่สร้าง QR ใหม่):\n",
"{1} bundles already exist in this project — their items will be updated (no new QR):\n"
],
[
"กำลังบันทึกบั้ง {1} ({2}/{3})...",
"Saving bundle {1} ({2}/{3})..."
],
[
"บันทึกไม่สำเร็จที่บั้ง \"{1}\": {2}",
"Save failed at bundle \"{1}\": {2}"
],
[
"· บันทึกสำเร็จไปแล้ว {1} บั้ง (เอาออกให้แล้ว)",
"· {1} bundles already saved (removed)"
],
[
"บันทึก {1} + ปล่อยงาน",
"Save {1} + release"
],
[
"รวมของทุกชั้น {1} ชิ้น · บั้งข้างใน {2} ใบ (แผง/ซับนับเป็นชิ้น · ไม่นับตัวบั้ง)",
"All levels total {1} pcs · {2} labels inside bundles (panels/subs counted as pcs · bundle itself not counted)"
],
[
"เกิน +{1}",
"Over +{1}"
],
[
"ขาด {1}",
"Short {1}"
],
[
"{1}{2}ทั้งหมด {3} ชิ้น",
"{1}{2}total {3} pcs"
],
[
"เลข {1} มีอยู่แล้ว — ใช้เลขอื่น",
"No. {1} already exists — use another number"
],
[
"{1}: ลดต่ำกว่าจำนวนที่ทำไปแล้ว ({2} ชิ้น) ไม่ได้",
"{1}: can't decrease below the qty already done ({2} pcs)"
],
[
"{1}: ลดจนเหลือ 0 ไม่ได้ — ใช้ “ยกเลิก Part” แทน",
"{1}: can't decrease to 0 — use “Cancel Part” instead"
],
[
"{1}: QR ที่ยังไม่ถูกใช้มีแค่ {2} ใบ (ใบที่สแกนแล้วยกเลิก/ย้ายไม่ได้)",
"{1}: only {2} unused QR labels (scanned labels can't be cancelled/moved)"
],
[
"{1}: ย้ายได้เฉพาะชิ้นที่ยังไม่ทำ (สูงสุด {2} ชิ้น)",
"{1}: only pieces not yet made can be moved (max {2} pcs)"
],
[
"{1}: Part นี้ถูกยกเลิกไปแล้ว",
"{1}: this Part is already cancelled"
],
[
"{1}: เบอร์ปลายทางถูกยกเลิกไปแล้ว",
"{1}: target code is already cancelled"
],
[
"{1}: ปลายทางต้องต่างจากเบอร์เดิม",
"{1}: target must differ from the original code"
],
[
"{1}: INV ใหม่ต้องต่างจากเดิม",
"{1}: new INV must differ from the old one"
],
[
"ไม่พบ {1}",
"{1} not found"
],
[
"{1} ถูกยกเลิกไปแล้ว",
"{1} is already cancelled"
],
[
"{1} ถูกยกเลิกแล้ว — ย้อนกลับไปเวอร์ชันที่ถูกยกเลิกไม่ได้ เลือกเวอร์ชันอื่น",
"{1} is cancelled — can't revert to a cancelled version, choose another version"
],
[
"ไม่มี M ที่ใหม่กว่า {1} ให้ยกเลิก — ตอนนี้เป็น {2} อยู่แล้ว",
"No M newer than {1} to cancel — it's already at {2}"
],
[
"{1}: M ที่บันทึกหลังจากนี้ ({2}) แก้ Part เดียวกัน — ต้องยกเลิก {3} ก่อน หรือใช้ “ย้อนกลับ” ทั้งช่วง",
"{1}: a later M ({2}) edits the same Part — cancel {3} first, or use “Revert” for the whole range"
],
[
"{1}: ชิ้นงาน {2} ชิ้นที่มาจาก M นี้ถูกสแกน/ใช้ไปแล้ว — ยกเลิกไม่ได้ เพื่อไม่ให้งานที่ทำไปแล้วหาย (ถ้าจำเป็นให้ Modify ใหม่ เช่น ลดจำนวน)",
"{1}: {2} pieces from this M have already been scanned/used — can't cancel, to avoid losing completed work (if needed, make a new Modify, e.g. decrease qty)"
],
[
"{1}: INV ถูกแก้ต่อจากที่อื่นแล้ว (ตอนนี้ {2}) — ยกเลิกไม่ได้",
"{1}: INV was edited again elsewhere (now {2}) — can't cancel"
],
[
"{1}: Part นี้ถูกแก้หลัง M นี้แล้ว — ยกเลิกไม่ได้",
"{1}: this Part was edited after this M — can't cancel"
],
[
"{1}: ไม่พบ Part/Release นี้แล้ว (อาจถูกลบ) — ยกเลิกไม่ได้",
"{1}: this Part/Release no longer exists (may be deleted) — can't cancel"
],
[
"{1}: QR {2} ใบไม่อยู่ในระบบแล้ว — ยกเลิกไม่ได้",
"{1}: {2} QR labels no longer in the system — can't cancel"
],
[
"{1}: QR {2} มีอยู่แล้ว — คืนซ้ำไม่ได้",
"{1}: QR {2} already exists — can't restore twice"
],
[
"{1}: Release ปลายทางมีงานผูกอยู่ — ย้ายกลับไม่ได้",
"{1}: target Release has linked work — can't move back"
],
[
"{1} มีอยู่แล้ว — ใช้เลขอื่น",
"{1} already exists — use another number"
],
[
"ข้ามเลข (ปกติคือ {1})",
"Skips a number (normally {1})"
],
[
"→ ใหม่ {1} ชิ้น",
"→ new {1} pcs"
],
[
"ทำไปแล้ว {1} ชิ้น — ลดได้ถึง {2}",
"{1} pcs already done — can decrease to {2}"
],
[
"QR ที่ยังไม่ใช้มี {1} ใบ",
"{1} unused QR labels"
],
[
"→ เหลือ {1} (ทำแล้ว · {2})",
"→ {1} remaining (done · {2})"
],
[
"ย้ายได้เฉพาะชิ้นที่ยังไม่ทำ (สูงสุด {1})",
"Only pcs not yet done can be moved (max {1})"
],
[
"→ เหลือ {1}",
"→ {1} remaining"
],
[
"{1} → {2} ชิ้น (+{3}) · สร้าง QR ใหม่ {4} ใบ",
"{1} → {2} pcs (+{3}) · create {4} new QR"
],
[
"{1} → {2} ชิ้น (−{3}) · ยกเลิก QR ที่ยังไม่ใช้ {4} ใบ (เก็บเป็นหลักฐาน)",
"{1} → {2} pcs (−{3}) · cancel {4} unused QR (kept as record)"
],
[
"INV {1} → {2} · จำนวน/QR ไม่เปลี่ยน (มีผลทุก Release ของเบอร์นี้)",
"INV {1} → {2} · qty/QR unchanged (applies to every Release of this code)"
],
[
"ยกเลิก QR ที่ยังไม่ใช้ {1} ใบ",
"Cancel {1} unused QR"
],
[
"· ทำแล้ว {1} ชิ้น → {2}",
"· {1} pcs done → {2}"
],
[
"ย้าย {1} ชิ้น → {2} · {3} · เหลือ {4} · QR เดิม",
"Move {1} pcs → {2} · {3} · {4} remaining · same QR"
],
[
"ตั้ง “{1}” ให้ {2} Part",
"Set “{1}” for {2} Parts"
],
[
"· ข้าม {1} Part (ชนกับการแก้อื่น)",
"· Skipped {1} Parts (conflict with other edits)"
],
[
"ก่อนวันปล่อยงาน ({1})",
"Before release date ({1})"
],
[
"มี {1} รายการไม่ถูกต้อง (แดง) — แก้ก่อนบันทึก",
"{1} invalid items (red) — fix before saving"
],
[
"ยังกรอกไม่ครบ {1} แถว — กรอกให้ครบ หรือกด ✕ เอาเบอร์ที่ไม่แก้ออก",
"{1} rows incomplete — fill them in or press ✕ to remove codes you are not editing"
],
[
"บันทึก {1} · {2} รายการ ({3} Part) · วันที่ M {4}",
"Save {1} · {2} items ({3} Parts) · M date {4}"
],
[
"\n• ยกเลิก QR ที่ยังไม่ใช้ {1} ใบ (เก็บเป็นหลักฐาน · หน้าเครื่องสแกนแล้วจะแจ้งว่ายกเลิก)",
"\n• Cancel {1} unused QR (kept as record · machine scan will show cancelled)"
],
[
"\n• ย้าย {1} ชิ้นไปเบอร์ใหม่ (QR เดิม)",
"\n• Move {1} pcs to new code (same QR)"
],
[
"\n\nค่าก่อนแก้เก็บไว้ใน M ก่อนหน้า · ถ้าผิด ยกเลิก {1} ได้ภายหลังจากประวัติการแก้ไข",
"\n\nPrevious values are kept in the previous M · if wrong, cancel {1} later from edit history"
],
[
"บันทึก {1}",
"Save {1}"
],
[
"บันทึก {1} แล้ว ({2} รายการ) · ของเดิมเก็บเป็นหลักฐาน",
"{1} saved ({2} items) · original kept as record"
],
[
"{1} · เลือก Part → เลือกการแก้ไขท้ายแต่ละเบอร์ (แยกกันอิสระ) → บันทึกทีเดียวเป็น M ใหม่ · ของเดิมเก็บเป็นหลักฐาน",
"{1} · Select Parts → choose an edit at the end of each code (independent) → save all at once as a new M · original kept as record"
],
[
"วันที่ M {1} · ลงแอปวันนี้",
"M date {1} · entered in app today"
],
[
"เลือกแล้ว {1} Part",
"{1} Parts selected"
],
[
"สรุปก่อนบันทึก — {1}",
"Summary before saving — {1}"
],
[
"{1} รายการ · {2} Part",
"{1} items · {2} Parts"
],
[
"({1} รายการ)",
"({1} items)"
],
[
"ยืนยัน · บันทึก {1}{2}",
"Confirm · Save {1}{2}"
],
[
"ยกเลิกทุก M ที่ใหม่กว่า {1}",
"Cancel all M newer than {1}"
],
[
"ย้อนกลับเป็น {1}",
"Revert to {1}"
],
[
"ย้อนเฉพาะการแก้ใน {1}",
"Undo only the edits in {1}"
],
[
"ยกเลิก {1}",
"Cancel {1}"
],
[
"{1} รายการ · {2} Part · เทียบกับ {3} (ค่าก่อนแก้)",
"{1} items · {2} Parts · compared with {3} (before edit)"
],
[
"{1} (ค่าก่อนแก้) ยังเก็บอยู่ ลบทับไม่ได้ · บันทึกงานหน้าเครื่องที่ทำไปแล้วจำค่าตอนที่ทำ · QR ของชิ้นเดิมไม่เปลี่ยน",
"{1} (before edit) is still kept and cannot be overwritten · recorded machine work keeps the values from when it was done · existing piece QRs unchanged"
],
[
"ย้ายไป {1} · {2}",
"Moved to {1} · {2}"
],
[
"Part ปัจจุบัน ({1})",
"Current Parts ({1})"
],
[
"Part ณ {1}",
"Parts as of {1}"
],
[
"ย้อนกลับเป็นต้นฉบับ ({1})",
"Revert to original ({1})"
],
[
"ย้อนเฉพาะการแก้ใน {1} · {2} ยังอยู่ในประวัติ (ขึ้นว่า “ยกเลิกแล้ว”) · เลข {3} จะไม่ถูกนำกลับมาใช้ซ้ำ",
"Undo only the edits in {1} · {2} stays in history (shown as “Cancelled”) · no. {3} will not be reused"
],
[
"ยกเลิกทุก M ที่ใหม่กว่า {1} ทีเดียว (ไล่จาก M ล่าสุดลงมา) · ทุก M ยังอยู่ในประวัติ",
"Cancel all M newer than {1} at once (from latest M down) · all M stay in history"
],
[
"ก่อนวันที่ของ M ที่จะยกเลิก ({1})",
"Before the date of the M being cancelled ({1})"
],
[
"{1} ถูกยกเลิกแล้ว · ตอนนี้ {2}",
"{1} already cancelled · now {2}"
],
[
"ย้อนกลับเป็น {1} แทน",
"Revert to {1} instead"
],
[
"คืน QR {1} ใบ",
"Restore {1} QR"
],
[
"ยกเลิก QR {1} ใบ",
"Cancel {1} QR"
],
[
"ย้ายกลับ {1} ชิ้น",
"Move back {1} pcs"
],
[
"ยืนยัน · ยกเลิก {1}",
"Confirm · Cancel {1}"
],
[
"ยืนยัน · ย้อนกลับเป็น {1}",
"Confirm · Revert to {1}"
],
[
"{1} วัน",
"{1} days"
],
[
"{1} ชม.",
"{1} hr"
],
[
"กำลังทำชุดที่ {1} · เริ่ม {2} · ผ่านไป {3}",
"Working on set {1} · started {2} · elapsed {3}"
],
[
"· เกิน {1} (สแปร์)",
"· {1} over (spare)"
],
[
"พักอยู่ · ทำไป {1} จาก {2} · รออีก {3} ชิ้น · หยุดมาแล้ว {4}",
"Paused · done {1} of {2} · {3} pcs waiting · stopped for {4}"
],
[
"เครื่องที่ทำ {1}",
"Machines used {1}"
],
[
"{1} เครื่อง · เรียงตามเวลาที่เริ่มทำ · สั่ง {2} ชิ้น",
"{1} machines · sorted by start time · ordered {2} pcs"
],
[
"Export — รายละเอียดแต่ละ Part × เครื่องจักร{1}",
"Export — details per Part × machine{1}"
],
[
"สร้างเมื่อ {1} · ตัวกรองสถานะ: {2} · {3} เบอร์ · {4} แถว",
"Created {1} · status filter: {2} · {3} codes · {4} rows"
],
[
"{1} หมายเหตุ",
"{1} notes"
],
[
"(สแกน {1} ชิ้น)",
"(scanned {1} pcs)"
],
[
"· บันทึกงานหน้าเครื่อง {1} รายการ",
"· {1} machine work records"
],
[
"ล็อตนี้มี {1} ชิ้น · มีประวัติการทำงานแล้ว{2}{3}\n\nการลบ Release นี้จะลบ QR และประวัติการทำงานทั้งหมดของล็อตนี้ไปด้วย และกู้คืนไม่ได้\n\nยืนยันที่จะลบหรือไม่?",
"This lot has {1} pcs · work history exists{2}{3}\n\nDeleting this Release also deletes all QR and work history of this lot and cannot be undone.\n\nDelete anyway?"
],
[
"ล็อตนี้มี {1} ชิ้น (ยังไม่มีการสแกน)\n\nต้องการลบ Release นี้พร้อม QR ทั้งหมดหรือไม่? การลบกู้คืนไม่ได้",
"This lot has {1} pcs (not scanned yet)\n\nDelete this Release along with all its QR? This cannot be undone."
],
[
"· ยกเลิก {1}",
"· cancel {1}"
],
[
"· ย้อนกลับเป็น {1}",
"· revert to {1}"
],
[
"จาก {1} เบอร์",
"of {1} codes"
],
[
"บันทึก {1} แล้ว — {2} รายการ · จำนวนเดิมขีดฆ่า · เบอร์ที่ยกเลิกเป็นสีแดง (หน้า Release และล็อต)",
"{1} saved — {2} items · old qty struck through · cancelled codes in red (Release and lot pages)"
],
[
"ปล่อย {1} สำเร็จ — {2} เบอร์ · สร้าง QR {3} ดวง",
"Released {1} — {2} codes · {3} QR created"
],
[
"บันทึก Release {1} + ปล่อยทั้งหมดเป็น {2} แล้ว",
"Release {1} saved + all released as {2}"
],
[
"บันทึก Release {1} แล้ว — เลือกปล่อยล็อตแรกได้เลย",
"Release {1} saved — you can release the first lot now"
],
[
"บันทึก {1} สำเร็จ — สร้าง QR {2} ดวง (แผง {3} · ซับ {4} · พาร์ท {5}) · ตั้ง BOM แล้ว",
"{1} saved — {2} QR created (panels {3} · subs {4} · parts {5}) · BOM set"
],
[
"บันทึก {1} สำเร็จ: {2} รายการ Part",
"{1} saved: {2} Part items"
],
[
"· สร้าง QR {1} ใบ",
"· {1} QR created"
],
[
"· สร้าง Part ใหม่ {1} รายการ",
"· {1} new Parts created"
],
[
"นำเข้าสำเร็จ: สร้าง {1} release ({2} QR)",
"Import done: {1} releases created ({2} QR)"
],
[
"· สร้าง Part ใหม่ {1} รายการ · ⚠ Part ใหม่ยังไม่มี Routing — ไปตั้งขั้นตอนที่ Setup > Part Master ก่อน ไม่งั้นชิ้นงานจะไม่ขึ้นสถานะ \"เสร็จ\"",
"· {1} new Parts created · ⚠ New Parts have no Routing yet — set steps in Setup > Part Master first, otherwise pieces will not show \"Done\""
],
[
"บันทึก {1} สำเร็จ — {2} เบอร์ (ตั้ง BOM/ปล่อยงานแล้ว)",
"{1} saved — {2} codes (BOM set / released)"
],
[
"· {1} เบอร์มีอยู่แล้ว: อัปเดต BOM เท่านั้น ไม่ได้ปล่อยงานใหม่ ({2}{3})",
"· {1} codes already exist: BOM updated only, not re-released ({2}{3})"
],
[
"{1} บั้งมีอยู่แล้ว — อัปเดตรายการในบั้งเท่านั้น ไม่ได้สร้าง QR ใหม่ ({2}{3})",
"{1} bundles already exist — bundle contents updated only, no new QR created ({2}{3})"
],
[
"นำเข้าบั้งสำเร็จ: {1} บั้ง ({2})",
"Bundle import done: {1} bundles ({2})"
],
[
"· ⚠ สร้างยูนิตใหม่ {1} รายการที่ยังไม่มีในระบบ (ยังไม่มี QR ให้สแกน) — {2}{3} · ปล่อยงานยูนิตเหล่านี้ก่อนถึงจะสแกนแพ็กได้",
"· ⚠ Created {1} new units not yet in the system (no QR to scan yet) — {2}{3} · release these units before packs can be scanned"
],
[
"ผลการค้นหา ({1})",
"Search results ({1})"
],
[
"สแปร์ {1}",
"Spare {1}"
],
[
"เสร็จ {1}",
"Done {1}"
],
[
"แบบผสม · 1 OF N {1} เบอร์ / รวมล็อต {2} เบอร์",
"Mixed · 1 OF N {1} codes / lot total {2} codes"
],
[
"ย้าย{1} →",
"Move{1} →"
],
[
"← ย้าย{1}",
"← Move{1}"
],
[
"แบบผสม — {1} เบอร์ได้ป้ายรายชิ้น 1 OF N ครบทุกชิ้น · {2} เบอร์ได้ป้ายรวมล็อต 1 ใบ (โชว์จำนวนทั้งล็อต)",
"Mixed — {1} codes get per-piece 1 OF N labels for every piece · {2} codes get 1 lot label (shows whole-lot qty)"
],
[
"ใบนี้มีประวัติ Modify แล้ว — เปลี่ยนเลข Release Order ไม่ได้ (ประวัติ M ผูกกับเลข {1})",
"This sheet has Modify history — Release Order no. cannot be changed (M history is tied to no. {1})"
],
[
"Release Order \"{1}\" มีอยู่แล้วในโปรเจคนี้\nบันทึกแล้วสองใบจะรวมเป็นใบเดียว — ยืนยันหรือไม่?",
"Release Order \"{1}\" already exists in this project\nSaving will merge the two into one sheet — continue?"
],
[
"บันทึกหัวเอกสารแล้ว — อัปเดต {1} Part",
"Header saved — {1} Parts updated"
],
[
"{1} — {2} · {3} Part ในใบนี้",
"{1} — {2} · {3} Parts on this sheet"
],
[
"ลดจำนวนต่ำกว่านี้ไม่ได้ — มีชิ้นที่สแกนไปแล้ว {1} ชิ้นในล็อตนี้",
"Cannot reduce below this — {1} pcs in this lot are already scanned"
],
[
"ลบได้สูงสุด {1} ชิ้น (เหลือเฉพาะชิ้นที่ยังไม่สแกน)",
"Max {1} pcs can be removed (unscanned pcs only)"
],
[
"ลดจำนวนล็อตนี้ลง {1} ชิ้น\nจะลบ QR {2} ชิ้นที่ยังไม่ได้สแกนออกถาวร · กู้คืนไม่ได้",
"Reduce this lot by {1} pcs\nThis permanently deletes {2} unscanned QR · cannot be undone"
],
[
"ใบ {1} มีประวัติ Modify แล้ว — เปลี่ยนเลข Release Order ของ Part นี้ไม่ได้",
"Sheet {1} has Modify history — cannot change this Part's Release Order no."
],
[
"Part No. \"{1}\" มีอยู่แล้วในโปรเจคนี้ — ใช้เบอร์อื่น (ยังไม่ได้บันทึกอะไร)",
"Part No. \"{1}\" already exists in this project — use another code (nothing saved yet)"
],
[
"ยืนยันเพิ่มงานเครื่อง {1} อีก {2} ชิ้น?\nระบบจะสร้างบันทึกการทำ (สแกน) ให้ชิ้นที่ยังไม่ทำ",
"Add {2} more pcs of work for machine {1}?\nThe system will create work (scan) records for pcs not yet done"
],
[
"ยืนยันเอางานเครื่อง {1} ออก {2} ชิ้น?\nลบสแกนของเครื่องนี้ · ลบแล้วกู้คืนไม่ได้",
"Remove {2} pcs of work from machine {1}?\nDeletes this machine's scans · cannot be undone"
],
[
"ลดยอดเครื่องนี้ให้ตรง {1} ไม่ได้ — มีป้ายล็อต (สแกนทีละหลายชิ้น) · ใกล้สุด {2} · ถ้าต้องการตัวเลขนี้ ให้แก้จำนวนสแกนที่หน้า \"สแกนของเครื่อง\" (ยังไม่ได้บันทึกอะไร)",
"Cannot set this machine's count to exactly {1} — it has lot labels (multi-piece scans) · closest {2} · for this number, edit the scan qty on the \"Machine scans\" page (nothing saved yet)"
],
[
"คิดน้ำหนักในประวัติสแกนใหม่ {1} แถว",
"Recalculate weight in scan history for {1} rows"
],
[
"ยืนยันลบข้อมูลสแกนของ Part นี้ ({1} รายการ · {2} ชิ้น)?\nยอดสแกนจะกลับเป็น 0 · QR/ล็อตยังอยู่ครบ · ลบแล้วกู้คืนไม่ได้ — แนะนำสำรองข้อมูลก่อน",
"Delete scan data for this Part ({1} records · {2} pcs)?\nScan count returns to 0 · QR/lot remain intact · cannot be undone — back up first"
],
[
"หลายค่า: {1}",
"Multiple values: {1}"
],
[
"เพิ่มงานเครื่องนี้อีก {1} ชิ้น (สร้างบันทึกการทำ)",
"Add {1} more pcs of work for this machine (create work records)"
],
[
"เอางานเครื่องนี้ออก {1} ชิ้น",
"Remove {1} pcs of work from this machine"
],
[
"เปลี่ยนสถานะเครื่อง {1} เป็น “{2}”",
"Change machine {1} status to “{2}”"
],
[
"ปิดงาน — นับทุกชิ้น ({1}) เป็นเสร็จ",
"Close job — count all pcs ({1}) as done"
],
[
"รายการ{1}",
"Items {1}"
],
[
"ราย{1}",
"By {1}"
],
[
"จำนวนเบอร์แม่ ({1})",
"Parent code qty ({1})"
],
[
"รายการ{1} — เบอร์ลูกที่ใส่เข้าแต่ละเบอร์แม่",
"Items {1} — child codes placed in each parent code"
],
[
"ดูทุกสแกนของ {1}",
"View all scans of {1}"
],
[
"{1} · สรุปจากฐานข้อมูลโดยตรง (เร็ว — ไม่ต้องโหลดสแกนทุกแถว) · จำนวน = ชิ้นที่บันทึก (ขั้นตอนที่ติ๊กร่วมไม่นับซ้ำ) · ชิ้น/ชม. คิดจากเวลาเดินเครื่องที่จับจากหน้าเครื่อง · แตะแถวเพื่อดูรายวัน",
"{1} · summarized directly from the database (fast — no need to load every scan row) · qty = pcs recorded (co-ticked steps not double-counted) · pcs/hr based on machine run time captured at the machine · tap a row for daily view"
],
[
"เฉลี่ยต่อช่วง ({1})",
"Average per period ({1})"
],
[
"(รวม {1} โปรเจค)",
"({1} projects total)"
],
[
"ยังเติมไม่ได้ {1} แถว — เบอร์ยังไม่มีน้ำหนัก/ชิ้น",
"{1} rows cannot be filled — code has no weight/pc yet"
],
[
"\n\nยังเติมไม่ได้ {1} แถว (เบอร์ยังไม่มีน้ำหนัก/ชิ้น)",
"\n\n{1} rows cannot be filled (code has no weight/pc yet)"
],
[
"เติมน้ำหนักให้สแกนที่บันทึกเป็น 0 กก. จำนวน {1} แถว (รวม {2} กก.)\nคิด = จำนวน × น้ำหนัก/ชิ้นปัจจุบันของป้าย/เบอร์{3}",
"Fill weight for {1} scan rows recorded as 0 kg (total {2} kg)\nCalculated = qty × current weight/pc of the label/code{3}"
],
[
"เติมน้ำหนักแล้ว {1} แถว",
"Weight filled for {1} rows"
],
[
"{1} ({2} ชิ้น)",
"{1} ({2} pcs)"
],
[
"ใบ {1} มีประวัติ Modify แล้ว — เปลี่ยนเลข Release ไม่ได้ (ประวัติผูกกับเลขเดิม)",
"Sheet {1} has Modify history — cannot change Release no. (history is tied to the original no.)"
],
[
"ยืนยันลบสแกนนี้ทั้งแถว?\n{1} · {2} ชิ้น → ชิ้นกลับเป็น \"ยังไม่ทำ\" (QR/ล็อตยังอยู่) · ลบแล้วกู้คืนไม่ได้",
"Delete this whole scan row?\n{1} · {2} pcs → pcs return to \"not done\" (QR/lot remain) · cannot be undone"
],
[
"ยืนยันบันทึกการแก้ไขแถวนี้?\n{1} · {2}",
"Save changes to this row?\n{1} · {2}"
],
[
"บันทึกแล้วบางส่วน ({1}) · ส่วนที่เหลือไม่สำเร็จ: {2}",
"Partially saved ({1}) · rest failed: {2}"
],
[
"ไม่สำเร็จ: Part No. \"{1}\" มีอยู่แล้วในโปรเจคนี้",
"Failed: Part No. \"{1}\" already exists in this project"
],
[
"รายการสแกน — {1}",
"Scan list — {1}"
],
[
"จำนวน +{1} → {2} ชิ้น",
"Qty +{1} → {2} pcs"
],
[
"จำนวน −{1} → {2} ชิ้น",
"Qty −{1} → {2} pcs"
],
[
"{1} ชม. {2} น.",
"{1} h {2} min"
],
[
"เป้า {1}/ชม.",
"Target {1}/h"
],
[
"สัปดาห์ {1}",
"Week {1}"
],
[
"ปี {1}",
"Year {1}"
],
[
"{1} จุด",
"{1} points"
],
[
"จาก {1}",
"of {1}"
],
[
"{1}% ของเป้า {2} {3} ({4} วันทำงาน)",
"{1}% of {2} {3} target ({4} working days)"
],
[
"{1}% ของเป้า {2} {3} · ณ ตอนนี้ควรได้ {4}",
"{1}% of {2} {3} target · should be at {4} by now"
],
[
"{1}% ของเป้า {2} {3}",
"{1}% of {2} {3} target"
],
[
"หยุด {1} ครั้ง",
"{1} stops"
],
[
"รอบช้า {1}",
"{1} slow cycles"
],
[
"· ถึงวันนี้ (ยังไม่จบ{1})",
"· To date ({1} not over yet)"
],
[
"· วันทำงาน {1} วัน",
"· {1} working days"
],
[
"กด Finished {1} · กำลังทำ {2}",
"Pressed Finished {1} · In progress {2}"
],
[
"เฉลี่ย {1} กก./ชิ้น",
"Avg {1} kg/pc"
],
[
"· {1} วันทำงาน",
"· {1} working days"
],
[
"เดิน {1} จากเวลาตามแผน {2} ({3} เครื่อง{4})",
"Running {1} of planned time {2} ({3} machines{4})"
],
[
"· หยุดอยู่ {1} เครื่อง",
"· {1} machines stopped"
],
[
"{1} ครั้ง{2}",
"{1} times{2}"
],
[
"⛔ {1} หยุดอยู่ตอนนี้",
"⛔ {1} stopped now"
],
[
"เป้า {1}/วัน",
"Target {1}/day"
],
[
"มีเหตุผลแนบ {1} จาก {2} งาน — หน้าเครื่องแนบเหตุผลค้างไว้กับทุกงานถัดไปจนกด \"ยกเลิก\" ตรวจว่าคนงานลืมยกเลิกหรือไม่",
"{1} of {2} jobs have a reason attached — the machine screen keeps a reason attached to every next job until \"Cancel\" is pressed. Check whether workers forgot to cancel it"
],
[
"แสดง {1} จาก {2} รายการ (ตามการเรียงที่เลือก) — ตัวเลขด้านบนนับครบทุกรายการ · Export Excel ได้ครบ · หรือใช้ตัวกรองให้แคบลง",
"Showing {1} of {2} items (in the selected sort order) — totals above count all items · Excel export includes all · or narrow down with filters"
],
[
"ยังไม่มีงาน {1} ในโปรเจคนี้",
"No {1} jobs in this project yet"
],
[
"ลบ Release Order \"{1}\" ทั้งชุด?\n({2} Part · {3} ชิ้น)\n\nจะลบ QR และประวัติสแกนของทุกชิ้นในชุดนี้ไปด้วย · กู้คืนไม่ได้",
"Delete the whole Release Order \"{1}\"?\n({2} parts · {3} pcs)\n\nThis also deletes the QR codes and scan history of every piece in this set · cannot be undone"
],
[
"ลบไม่ครบ — สำเร็จ {1} · ไม่สำเร็จ {2} · ลองอีกครั้งได้",
"Not fully deleted — done {1} · failed {2} · you can try again"
],
[
"ลบ {1}: สำเร็จ {2} · พลาด {3}",
"Delete {1}: done {2} · failed {3}"
],
[
"ลบ Release Order \"{1}\" แล้ว ({2} รายการ)",
"Release Order \"{1}\" deleted ({2} items)"
],
[
"ปิดโปรเจค \"{1} — {2}\"?\nหน้าเครื่องจะบันทึกงานเพิ่มไม่ได้ จนกว่าจะเปิดใหม่",
"Close project \"{1} — {2}\"?\nMachine screens can't record more work until it is reopened"
],
[
"สแกนแล้ว {1} ชิ้น",
"{1} pcs scanned"
],
[
"บันทึกงานหน้าเครื่อง {1} รายการ",
"{1} machine work records"
],
[
"อ่านจำนวนข้อมูลของโปรเจคนี้ไม่ได้ (อาจมีประวัติการทำงาน)\n\nการลบโปรเจคจะลบข้อมูลทั้งหมดทิ้ง และกู้คืนไม่ได้\n\nพิมพ์รหัสโปรเจค \"{1}\" เพื่อยืนยันการลบ",
"Couldn't read this project's data counts (it may have work history)\n\nDeleting the project deletes all its data and cannot be undone\n\nType the project code \"{1}\" to confirm deletion"
],
[
"โปรเจคนี้มี {1} Part, {2} Release, {3} ชิ้น (QR) และมีประวัติการทำงาน ({4})\n\nการลบโปรเจคจะลบข้อมูลทั้งหมดนี้ทิ้งไปด้วย และกู้คืนไม่ได้\n\nพิมพ์รหัสโปรเจค \"{5}\" เพื่อยืนยันการลบ",
"This project has {1} parts, {2} Releases, {3} pcs (QR) and work history ({4})\n\nDeleting the project also deletes all of this data and cannot be undone\n\nType the project code \"{5}\" to confirm deletion"
],
[
"โปรเจคนี้มี {1} Part และ {2} ชิ้น (QR) · ตรวจงานหน้าเครื่องไม่ได้ (ยังไม่ได้อัปเดตฐานข้อมูล)\n\nการลบกู้คืนไม่ได้ — พิมพ์รหัสโปรเจค \"{3}\" เพื่อยืนยันการลบ",
"This project has {1} parts and {2} pcs (QR) · couldn't check machine work (database not updated yet)\n\nDeletion cannot be undone — type the project code \"{3}\" to confirm deletion"
],
[
"โปรเจคนี้มี {1} Part และ {2} ชิ้น (QR) แต่ยังไม่มีการสแกน\n\nต้องการลบโปรเจคนี้พร้อมข้อมูลทั้งหมดหรือไม่? การลบกู้คืนไม่ได้",
"This project has {1} parts and {2} pcs (QR) but no scans yet\n\nDelete this project with all its data? This cannot be undone"
],
[
"ต้องการลบโปรเจค \"{1} — {2}\" หรือไม่?",
"Delete project \"{1} — {2}\"?"
],
[
"สร้างเมื่อ {1}",
"Created {1}"
],
[
"{1} นาที",
"{1} min"
],
[
"นาฬิกาเครื่องเพี้ยน {1} นาที",
"Device clock off by {1} min"
],
[
"มีปัญหา {1} เครื่อง",
"{1} machines with issues"
],
[
"{1} นาทีที่แล้ว",
"{1} min ago"
],
[
"{1} ชม.ที่แล้ว",
"{1} h ago"
],
[
"{1} วันที่แล้ว",
"{1} days ago"
],
[
"บังคับ \"{1}\" ออกจากระบบ?\n\nเครื่องนั้นจะซิงค์งานที่ค้างให้เสร็จก่อน แล้วเด้งออกเอง (ข้อมูลไม่หาย) — ต้องล็อกอินใหม่ถึงจะใช้ต่อได้",
"Force \"{1}\" to sign out?\n\nThat device will finish syncing pending work first, then sign out by itself (no data lost) — they must sign in again to continue"
],
[
"บังคับ {1} ออกจากระบบแล้ว — เครื่องนั้นจะเด้งออกภายใน 1 นาที",
"{1} forced to sign out — that device will sign out within 1 minute"
],
[
"แก้: {1}",
"Edit: {1}"
],
[
"ขอบเขต: {1}",
"Scope: {1}"
],
[
"บันทึกหน้าเครื่อง {1}",
"Machine record {1}"
],
[
"ประวัติ {1} รายการ",
"{1} history entries"
],
[
"โหมด {1}",
"Mode {1}"
],
[
"วันที่ {1}",
"Date {1}"
],
[
"เครื่อง {1}",
"Machine {1}"
],
[
"กำลังตรวจ {1}/{2}",
"Checking {1}/{2}"
],
[
"ทั้งโปรเจค “{1}”",
"Whole project “{1}”"
],
[
"ยืนยันลบข้อมูลสแกนของ{1} ({2} รายการ)?\nลบแล้วกู้คืนไม่ได้ — แนะนำสำรองข้อมูลก่อน",
"Delete scan data of {1} ({2} items)?\nThis cannot be undone — backing up first is recommended"
],
[
"กำลังลบ {1}/{2}",
"Deleting {1}/{2}"
],
[
"ลบแล้ว — บันทึกงานหน้าเครื่อง {1} · สแกนสำนักงาน {2} รายการ · รีเซ็ตสถานะชิ้นงานแล้ว",
"Deleted — {1} machine work records · {2} office scans · piece status reset"
],
[
"(ลบไปแล้ว {1}/{2} ชุด — กด “ลบข้อมูลสแกน” ซ้ำเพื่อลบส่วนที่เหลือ)",
"(Deleted {1}/{2} batches — press “Delete scan data” again to delete the rest)"
],
[
"{1}{2} — {3} Part × {4} ชิ้น{5}",
"{1}{2} — {3} parts × {4} pcs{5}"
],
[
"(มีข้อมูลสแกน {1})",
"(has scan data {1})"
],
[
"{1} — {2} · จุดกู้คืนวันที่ {3}",
"{1} — {2} · restore point of {3}"
],
[
"สร้างจุดกู้คืนแล้ว {1} โปรเจค",
"Restore points created for {1} projects"
],
[
"นำเข้าไฟล์ \"{1}\" ({2} แถว)?\n\nระบบจะ \"เติมเฉพาะข้อมูลที่หายไป\" กลับเข้าระบบ — ของเดิมและงานที่ทำใหม่ทั้งหมดจะไม่ถูกทับ",
"Import file \"{1}\" ({2} rows)?\n\nThe system will \"fill in only missing data\" — existing data and all new work will not be overwritten"
],
[
"ตารางเสริมนำเข้าไม่ได้ {1} แถว (ข้อมูลอ้างอิงไม่ครบ) — ส่วนอื่นนำเข้าแล้ว",
"{1} extra-table rows could not be imported (missing reference data) — everything else was imported"
],
[
"กำลังดึง {1} ({2}/{3})...",
"Fetching {1} ({2}/{3})..."
],
[
"รหัสเครื่อง \"{1}\" มีอยู่แล้ว",
"Machine code \"{1}\" already exists"
],
[
"บันทึกชื่อ/ขั้นตอนแล้ว · แต่ตั้งรูปแบบการสแกนไม่สำเร็จ: {1}",
"Name/steps saved · but setting scan mode failed: {1}"
],
[
"ลบเครื่อง \"{1} — {2}\" ?",
"Delete machine \"{1} — {2}\"?"
],
[
"เครื่องนี้มีประวัติงานผลิต {1} รายการ\n\n",
"This machine has {1} production records\n\n"
],
[
"ลบเครื่องแล้ว · ปลดพนักงาน {1} คนออกจากเครื่องนี้ — อย่าลืมไปตั้งเครื่องใหม่ให้เขาที่ Setup › พนักงาน",
"Machine deleted · {1} employees unassigned from it — remember to set a new machine for them in Setup › Employees"
],
[
"เปลี่ยนประเภทงานของ \"{1}\"\n{2} → {3}\n\n",
"Change job type of \"{1}\"\n{2} → {3}\n\n"
],
[
"• สเตชันที่ติ๊กขั้นตอนนี้จะเปิดหน้า {1} ({2}) แทน\n",
"• Stations with this step ticked will open the {1} ({2}) screen instead\n"
],
[
"บันทึกชื่อ/สิทธิ์/รหัสผ่านแล้ว · แต่ส่วนที่เหลือ (ขั้นตอน/ล็อกอินหลายเครื่อง) ไม่สำเร็จ: {1}",
"Name/role/password saved · but the rest (steps/multi-device sign-in) failed: {1}"
],
[
"ลบพนักงาน \"{1} — {2}\" ?",
"Delete employee \"{1} — {2}\"?"
],
[
"พนักงานคนนี้มีประวัติงานหน้าเครื่อง {1} รายการ\n\n",
"This employee has {1} machine work records\n\n"
],
[
"ขั้นตอนเก็บไว้กับเครื่อง {1} — ใช้ร่วมกับทุกคนที่ผูกเครื่องนี้",
"Steps are stored with machine {1} — shared by everyone assigned to this machine"
],
[
"✓ เลือกเครื่อง {1} ให้แล้ว (รหัสตรงกับพนักงาน) — กด \"บันทึก\" เพื่อผูก · เปลี่ยนได้ที่ช่องเครื่อง/สถานี",
"✓ Machine {1} selected (code matches employee) — press \"Save\" to assign · change it in the Machine/Station field"
],
[
"ผูกเครื่องให้ {1} คน (รหัสพนักงานตรงกับรหัสเครื่อง):\n\n{2}\n\nขั้นตอนที่ทำได้ = ตามที่ตั้งไว้กับเครื่อง (ตั้งค่า › เครื่อง/สถานี)",
"Assign machines to {1} employees (employee code matches machine code):\n\n{2}\n\nAllowed steps = as set on the machine (Settings › Machines/Stations)"
],
[
"ผูกแล้ว {1} คน · ไม่สำเร็จ {2}: {3}",
"{1} assigned · {2} failed: {3}"
],
[
"ผูกเครื่องแล้ว {1} คน",
"Machines assigned to {1} employees"
],
[
"รหัสพนักงาน \"{1}\" มีอยู่แล้ว",
"Employee code \"{1}\" already exists"
],
[
"(แต่ตั้งความสามารถเครื่องไม่สำเร็จ: {1} — แก้ได้ที่ปุ่ม \"แก้ไข\")",
"(but setting machine capabilities failed: {1} — fix it with the \"Edit\" button)"
],
[
"เพิ่มพนักงานแล้ว{1}",
"Employee added{1}"
],
[
"เพิ่มพนักงาน \"{1}\" สำเร็จ{2}",
"Employee \"{1}\" added{2}"
],
[
"เพิ่มพนักงาน \"{1}\" สำเร็จ",
"Employee \"{1}\" added"
],
[
"ปิดใช้งานบัญชี {1} {2}?\nปิดแล้วล็อกอินไม่ได้ (ประวัติงานยังอยู่ · เปิดคืนได้)",
"Deactivate account {1} {2}?\nThey won't be able to sign in (work history is kept · can be reactivated)"
],
[
"✓ เลือกเครื่อง {1} ให้แล้ว (รหัสตรงกับพนักงาน)",
"✓ Machine {1} selected (code matches employee)"
],
[
"⚠ พนักงาน {1} คนยังไม่ผูกเครื่อง แต่มีเครื่องรหัสเดียวกัน ({2}) — ยังสแกนงานไม่ได้",
"⚠ {1} employees have no machine assigned, but machines with the same code exist ({2}) — they can't scan work yet"
],
[
"ผูกเครื่องตามรหัส ({1})",
"Assign machines by code ({1})"
],
[
"มีเครื่อง {1} รหัสตรงกัน",
"Machine {1} has a matching code"
],
[
"{1} · ประกอบจากลูก (ต้องอยู่โปรเจคเดียวกัน)",
"{1} · assembled from children (must be in the same project)"
],
[
"เติมน้ำหนักให้สแกนเดิม {1} แถว",
"Weight filled in for {1} existing scan rows"
],
[
"บันทึก {1} แล้ว",
"{1} saved"
],
[
"มี Part \"{1}\" ในโปรเจคนี้แล้ว",
"Part \"{1}\" already exists in this project"
],
[
"เปลี่ยนชนิดของ \"{1}\" จาก {2} เป็น {3}?\n(มีผลกับหน้าเครื่อง/ประกอบ/แพ็ก และ BOM)",
"Change the type of \"{1}\" from {2} to {3}?\n(Affects machine/assembly/packing screens and BOM)"
],
[
"ลบ Part \"{1}\" ไม่ได้ — ยังมี {2} Release และ {3} ชิ้น (QR) ผูกอยู่ · ให้ลบ Release ของ Part นี้ก่อน (ที่หน้า \"ปล่อยงาน (Release)\") แล้วจึงลบ Part ได้",
"Can't delete part \"{1}\" — {2} Releases and {3} pcs (QR) are still linked · delete this part's Releases first (on the \"Release\" page), then delete the part"
],
[
"ลบ Part \"{1}\"?\n(ยังไม่มี Release/ชิ้นงานผูกอยู่ — ลบได้ปลอดภัย)",
"Delete part \"{1}\"?\n(No Releases/pieces linked — safe to delete)"
],
[
"· {1} วิ",
"· {1}s"
]
];

// เก็บตก (tooltip สูตรจำนวนต่อชุด)
const FIX_TPLS = [
  ["ไฟล์ {1} ชิ้น ÷ {2} ชุด = {3}/ชุด", "File {1} pcs ÷ {2} sets = {3}/set"],
  ["{1} › {2}: ไฟล์ {3} ชิ้น = {4}/ชุด → BOM {5}/ชุด (= {6} ชิ้น)", "{1} › {2}: file {3} pcs = {4}/set → BOM {5}/set (= {6} pcs)"],
];
// รอบ 2 (2026-10-26 "ทั้งแอพ"): หน้าเครื่อง/แท็บเล็ต (Station) · ข้อความที่ยังขาดใน App · นำเข้า Excel · ข้อความจากฐานข้อมูล
const DICT2 = {
 "หน้าประกอบ (ซับ)": "Assembly page (sub)",
 "หน้าแพ็ก": "Packing page",
 "ลองรหัสผิดหลายครั้ง — ระบบพักบัญชีนี้ไว้ 5 นาที แล้วลองใหม่": "Too many wrong passwords — account locked for 5 minutes, then try again",
 "เช่น ประกอบ-01": "e.g. ASSY-01",
 "เช่น แผง-01": "e.g. PANEL-01",
 "เช่น กระจก-01": "e.g. GLASS-01",
 "เช่น แพ็กแผง-01": "e.g. PACKPANEL-01",
 "เช่น แพ็กไซต์-01": "e.g. PACKSITE-01",
 "เช่น แพ็ก-01": "e.g. PACK-01",
 "ลดจำนวน": "Decrease qty",
 "เลือกอย่างน้อย 1 ขั้นตอนก่อนบันทึก": "Select at least 1 step before saving",
 "กู้รายการที่สแกนค้างไว้ (": "Restore pending scans (",
 "ลูกนี้": "this child",
 "ใส่ต่อ": "Add anyway",
 "ซับ (subassembly)": "Sub (subassembly)",
 "ไซต์ไอเทม": "Site item",
 "หรือ": "or",
 "ไม่ใส่": "Don't add",
 "ออฟไลน์": "Offline",
 "ค้างซิงค์": "Pending sync",
 "บัญชีอื่น": "Other account",
 "ซิงค์ไม่สำเร็จ": "Sync failed",
 "เลือกอย่างน้อย 1 ขั้นตอน": "Select at least 1 step",
 "แยกขั้นตอน": "Separate steps",
 "รายงานวันนี้": "Today's report",
 "ทำงาน": "Working",
 "ทำเสร็จ": "Finished",
 "ความยาววัสดุ": "Material length",
 "เริ่ม": "Start",
 "สแกน": "Scan",
 "① สแกนเพื่อเริ่ม": "① Scan to start",
 "สแกนของเข้าบั้ง": "Scan items into bundle",
 "ยาว": "Length",
 "ทิ้ง": "Discard",
 "เบอร์แม่ (ซับ)": "Parent code (sub)",
 "ใส่ของเพิ่มในชิ้นเดิม (ไม่ได้ทำเพิ่ม)": "Add items to existing piece (no extra made)",
 "ซับประกอบ": "Assembly sub",
 "ขนาด/ยาว": "Size/Length",
 "เบอร์แม่ที่กำลังทำ": "Current parent code",
 "สแกนเข้าไปแล้ว": "Scanned in",
 "ประกอบแล้ว": "Assembled",
 "ใส่ของเพิ่มในชิ้นเดิม · ยอดทำไม่เพิ่ม": "Add items to existing piece · done qty unchanged",
 "จำนวนที่จะทำ": "Qty to make",
 "ลูกที่สแกนเข้าไปแล้ว": "Scanned children",
 "เอาคืน": "Take back",
 "ถ่ายรูปแพ็ก": "Pack photo",
 "ถ่าย": "Take",
 "หน้าต่าง/แผง": "Window/Panel",
 "รอติดกระจก": "Awaiting glazing",
 "ติดแล้ว": "Glazed",
 "เริ่มแล้ว": "Started",
 "ของที่ใส่": "Items added",
 "ลูก": "Child",
 "ไม่ต้องกรอกความยาว · ไม่จับเวลา": "No length entry · no timing",
 "สแกนครั้งเดียวตอนเสร็จ": "Scan once when finished",
 "เข้ายอดวันนี้ทันที": "Counts toward today immediately",
 "ช่องขวามือ (มม.)": "Right-hand box (mm)",
 "เปิดกล้องสแกน": "Open camera to scan",
 "เวลาเริ่มนับตอนสแกน": "Timer starts at scan",
 "ใส่จำนวน + เลือกสถานะ": "Enter qty + pick status",
 "พร้อมเริ่มงาน": "Ready to start",
 "นี้": "this",
 "ไม่": "No",
 "← กลับ": "← Back",
 "อยู่": "active",
 "ยังไม่ได้ทำขั้นตอนนี้": "Step not done yet",
 "คิวซิงค์ไม่สำเร็จ": "Sync queue failed",
 "ล้างทิ้ง": "Clear",
 "อยู่ต่อ": "Stay",
 "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่ (งานที่ค้างจะซิงค์อัตโนมัติหลังล็อกอินด้วยบัญชีเดิม)": "Session expired — please sign in again (pending work syncs automatically after signing in with the same account)",
 "กำลังไปหน้าเข้าสู่ระบบ…": "Going to sign-in page…",
 "ไปหน้าแอดมิน (ตั้งค่า → พนักงาน)": "Go to admin (Settings → Employees)",
 "— เข้าสู่ระบบ": "— Sign in",
 "จอนี้สำหรับติดหน้า": "This screen is mounted at",
 "(แนวนอน)": "(landscape)",
 "→ ไปหน้าปกติ (สำนักงาน)": "→ Go to normal page (office)",
 "ทำงานให้": "Working for",
 "→ สแกน QR": "→ Scan QR",
 "ใส่จำนวน + สถานะ →": "Enter qty + status →",
 "กรอก": "Enter",
 "สแกน QR ชิ้นงาน": "Scan piece QR",
 "ทำเสร็จ → สแกนอีกครั้ง →": "Finished → scan again →",
 "แล้วสแกน QR ของชิ้นงาน — เวลาเริ่มนับตอนสแกน": "then scan the piece QR — timer starts at scan",
 "(ป้ายไหนก็ได้ของเบอร์": "(any label of code",
 "② สแกนจบงาน — ป้ายไหนก็ได้ของ": "② Scan to finish — any label of",
 "หน้าจอมีปัญหาชั่วคราว": "Screen error (temporary)",
 "งานที่บันทึกไปแล้วไม่หาย · กด “โหลดใหม่” เพื่อใช้งานต่อ — ถ้ายังไม่หาย แคปข้อความด้านล่างส่งแอดมิน": "Saved work is not lost · Tap “Reload” to continue — if it persists, screenshot the message below and send it to admin",
 "❌ ยังไม่ได้ตั้งค่า Supabase!\n": "❌ Supabase is not configured!\n",
 "สร้างไฟล์ .env.local แล้วใส่:\n": "Create a .env.local file and add:\n",
 "impact_unknown: อ่านจำนวนข้อมูลที่จะถูกลบไม่ได้ — ลองใหม่อีกครั้ง (ยังไม่ได้ลบอะไร)": "impact_unknown: Could not read how many records would be deleted — please try again (nothing was deleted)",
 "ที่เก็บข้อมูลเต็ม — บันทึกไม่สำเร็จ": "Storage is full — save failed",
 "station_job_set ยังไม่มีใน DB (รัน migration-part-machine-status.sql) — ข้ามการแจ้งงานที่กำลังทำ": "station_job_set not in DB yet (run migration-part-machine-status.sql) — skipping current-job update",
 "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ / หมดเวลา": "Cannot connect to server / timed out",
 "หัวหน้างาน (เดิม)": "Supervisor (legacy)",
 "หาหัวตาราง (คอลัมน์ Code / Qty) ในไฟล์ไม่เจอ — ตรวจสอบว่าเป็นไฟล์ฟอร์มที่ถูกต้อง": "Table header (Code / Qty columns) not found in file — check that it is the correct form file",
 "ไม่พบรายการ Part ในไฟล์ — ตรวจสอบว่ากรอกจำนวน (Qty) ไว้ครบ": "No Part items found in file — check that all quantities (Qty) are filled in",
 "หาหัวตาราง (Code / Quantity) ไม่เจอ — ก็อป/เลือกไฟล์ให้มีแถวหัวตาราง (Code, Quantity/Sum) มาด้วย": "Table header (Code / Quantity) not found — copy/select the file including the header row (Code, Quantity/Sum)",
 "ไม่พบกลุ่มเบอร์แม่–ลูก — ตรวจว่าแถวแม่มีเลข Item/จำนวน และแถวลูกมีจำนวน": "No parent–child code groups found — check that parent rows have Item no./qty and child rows have qty",
 "อ่านฟอร์มแผงไม่พบรายการ — ตรวจว่ามีคอลัมน์ Code/Sum และกรอกจำนวนใน Sum": "No items found in panel form — check that Code/Sum columns exist and quantities are filled in Sum",
 "หาหัวตาราง (Panel No / Qty) ไม่เจอ — ก็อปให้มีแถวหัว (Panel No + Qty) มาด้วย": "Table header (Panel No / Qty) not found — copy including the header row (Panel No + Qty)",
 "ไม่พบรายชื่อแผง — ตรวจว่ากรอก Panel No + Qty ครบ": "No panel list found — check that Panel No + Qty are all filled in",
 "ไม่พบข้อมูลบั้ง — ตรวจว่ามีหัว 'BUNK NO.' + ตาราง Unit No/Weight": "No bundle data found — check for the 'BUNK NO.' header + Unit No/Weight table",
 "(ไม่มีข้อมูลในช่วงนี้)": "(No data in this period)",
 "<div style=\"color:#9db1a8;font-family:system-ui,sans-serif;text-align:center;font-size:16px;line-height:1.6\">โหลดแอปไม่สำเร็จ<br>กำลังลองใหม่อัตโนมัติ…</div>": "<div style=\"color:#9db1a8;font-family:system-ui,sans-serif;text-align:center;font-size:16px;line-height:1.6\">App failed to load<br>Retrying automatically…</div>",
 "โหลดแอปไม่สำเร็จ": "App failed to load",
 "กำลังลองใหม่อัตโนมัติ…": "Retrying automatically…",
 "เลือกคอลัมน์": "Choose columns",
 "กำหนดเอง": "Custom",
 "เดือน": "Month",
 "โหลดข้อมูลล่าสุด": "Load latest data",
 "ซ่อน": "Hide",
 "ข้ามตัวที่ซ้ำ": "Skip duplicates",
 "ไม่มี INV": "No INV",
 "บันทึกแล้ว": "Saved",
 "INV ซ้ำกันในตาราง": "Duplicate INV in table",
 "แก้": "Edit",
 "ใหม่": "New",
 "ที่มา": "Source",
 "กรอกเอง": "Manual entry",
 "INV ที่ Part ในโปรเจคนี้ใช้อยู่ แต่ยังไม่มีในรายการ": "INVs used by Parts in this project but not yet in the list",
 "ตามโปรเจค": "By project",
 "ตอนสร้าง Release: Weight/M ที่เว้นว่างจะเติมจาก INV ของโปรเจคก่อน ไม่มีค่อยใช้ Center Stock · INV ใหม่ที่ยังไม่มีทั้ง 2 ที่ จะถูกบันทึกเข้าโปรเจคให้อัตโนมัติ — มากรอกความยาว/จำนวนต่อที่นี่ · OFF CUT (เศษ) ไม่บันทึกน้ำหนัก กรอกเองตอนสร้าง Release": "When creating a Release: blank Weight/M is filled from the project's INV first, otherwise from Center Stock · New INVs not found in either are saved to the project automatically — fill in length/qty here · OFF CUT (offcut) has no saved weight; enter it when creating the Release",
 "คอลัมน์": "Columns",
 "ลองใหม่": "Retry",
 "ไม่พบรายการที่ตรงกับตัวกรอง": "No items match the filter",
 "ลากที่จับ ⠿ เพื่อย้ายคอลัมน์ — วางจาก Excel (ไม่มีหัวตาราง) จะเรียงตามลำดับนี้": "Drag the ⠿ handle to move columns — pasting from Excel (without header) follows this order",
 "ต้องเป็นตัวเลข ≥ 0": "Must be a number ≥ 0",
 "ลำดับคอลัมน์": "Column order",
 "บัญชีนี้ยังไม่มีสิทธิ์ Modify ฝั่งฐานข้อมูล — ให้แอดมินรัน migration-office-release-rights.sql (เปิดสิทธิ์ให้พนักงานออฟฟิศ)": "This account has no Modify rights in the database yet — ask admin to run migration-office-release-rights.sql (grants rights to office staff)",
 "ยังไม่ได้รัน migration-release-modify-revert.sql เวอร์ชันล่าสุด (มีวันที่ของ M) ใน Supabase": "Latest migration-release-modify-revert.sql (with M date) has not been run in Supabase yet",
 "ยังไม่ได้ติดตั้งส่วน “ยกเลิก/ย้อน M” — รัน migration-release-modify-revert.sql ใน Supabase ก่อน": "The “Cancel/Revert M” feature is not installed — run migration-release-modify-revert.sql in Supabase first",
 "เลือกการแก้ไข": "Select edit",
 "Release Order ต้องเป็นรูปแบบ P-ตัวเลข": "Release Order must be in the format P-number",
 "บันทึกเป็น": "Save as",
 "เดิม": "Original",
 "ยกเลิก QR ที่ยังไม่ใช้": "Cancel unused QR",
 "ยังไม่เลือก": "Not selected",
 "ลงแอป": "Into app",
 "การแก้ไข": "Edit",
 "ใช้อยู่": "In use",
 "หัวข้อ": "Item",
 "ค่า": "Value",
 "แก้ใน M นี้": "Edited in this M",
 "เพิ่มใหม่": "Add new",
 "เหตุผล": "Reason",
 "วิธี": "Method",
 "ประวัติ": "History",
 "สรุป": "Summary",
 "ตอนนี้": "Now",
 "เบอร์พาร์ท": "Part No.",
 "ไม่มีงานหน้าเครื่อง (ยอดจากการสแกนออฟฟิศ)": "No machine work (qty from office scans)",
 "1 แถว = 1 เบอร์ + 1 เครื่อง · เบอร์ที่ผ่าน 2 เครื่อง = 2 แถว (ข้อมูลของเบอร์ซ้ำในทุกแถว → sort / filter ใน Excel ได้ทันที)": "1 row = 1 code + 1 machine · a code through 2 machines = 2 rows (code data repeats on every row → sort / filter in Excel right away)",
 "อ่านก่อน": "Read first",
 "คำอธิบาย": "Description",
 "ยังไม่ได้ติดตั้งส่วน Modify — รัน migration-release-modify.sql ใน Supabase ก่อน": "Modify feature is not installed — run migration-release-modify.sql in Supabase first",
 "ยังไม่ได้ติดตั้งส่วน Modify — รัน migration-release-modify.sql ใน Supabase": "Modify feature is not installed — run migration-release-modify.sql in Supabase",
 "ทำไปบางส่วน รอชุดถัดไป": "Partly done, waiting for next set",
 "ยังไม่ได้ติดตั้งส่วนสถานะเครื่อง — รัน migration-part-machine-status.sql ใน Supabase": "Machine status feature is not installed — run migration-part-machine-status.sql in Supabase",
 "เบอร์": "Code",
 "กำลังโหลด…": "Loading…",
 "สั่ง": "Ordered",
 "สแกนสำนักงาน": "Office scan",
 "ยังไม่มีสแกน": "No scans yet",
 "รายละเอียดการสแกน": "Scan details",
 "จำนวนสแกน": "Scan qty",
 "แถว": "Rows",
 "รวมจำนวน": "Total qty",
 "ไม่มีการสแกน": "No scans",
 "วันทำงาน": "Work days",
 "คน": "People",
 "มี.ค.": "Mar",
 "เม.ย.": "Apr",
 "พ.ค.": "May",
 "มิ.ย.": "Jun",
 "ก.ค.": "Jul",
 "ส.ค.": "Aug",
 "ก.ย.": "Sep",
 "รายสัปดาห์": "Weekly",
 "ไม่ขึ้นกับช่วงเวลาด้านบน (ใช้ตัวกรองโปรเจค/Part/Release/แผนก เดียวกัน) · สัปดาห์เริ่มวันจันทร์ · ช่วงล่าสุดยังไม่จบ": "Independent of the period above (uses the same Project/Part/Release/Department filters) · Weeks start Monday · Latest period not yet complete",
 "เดือนก่อน": "Previous month",
 "เวลาเครื่อง": "Machine time",
 "ยังไม่ได้รัน migration-audit-round11.sql — เติมย้อนหลังไม่ได้": "migration-audit-round11.sql has not been run — cannot backfill",
 "ขั้นตอนเดียว": "Single step",
 "หลายขั้นตอนพร้อมกัน": "Multiple steps at once",
 "ภาพรวม": "Overview",
 "แนวโน้มรายสัปดาห์ / รายเดือน": "Weekly / monthly trend",
 "รายงานการทำงาน": "Work report",
 "รายการสแกน": "Scan list",
 "วัน-เวลา": "Date-time",
 "ปัจจุบัน": "Current",
 "คิดจากจำนวน": "Based on qty",
 "ทุกเครื่อง": "All machines",
 "ระหว่างทำงาน": "Working",
 "ปัญหาระหว่างทำงาน": "Problems during work",
 "เวลาหยุด": "Stop time",
 "ชิ้นงาน": "Piece",
 "เป้า": "Target",
 "ยังไม่ได้รัน migration-daily-report-settings.sql ใน Supabase": "migration-daily-report-settings.sql has not been run in Supabase yet",
 "เลิก": "End",
 "เป้า ณ ตอนนี้": "Target so far",
 "ยังไม่มีงาน": "No work yet",
 "ปกติ": "Normal",
 "เฉลี่ย 7 วัน": "7-day avg",
 "เวลาเดินเครื่อง %": "Machine run time %",
 "นาที/ชิ้น": "min/pc",
 "ช่วงรายงาน": "Report period",
 "ชิ้นที่กด Finished": "Pcs marked Finished",
 "เวลากะ": "Shift time",
 "สาเหตุ": "Cause",
 "นาที": "min",
 "สัปดาห์": "Week",
 "วันก่อนหน้า": "Previous day",
 "กะ": "Shift",
 "รายวัน": "Daily",
 "เลือกเดือน": "Select month",
 "โหลดใหม่": "Reload",
 "ทุกแผนก": "All departments",
 "ทุกสถานะ": "All statuses",
 "เทียบ": "Compare",
 "ต้องดู": "Needs attention",
 "เป้า/ชม.": "Target/hr",
 "เดินเครื่อง": "Running",
 "ตามแผน": "On plan",
 "รายงานการทำงาน (รอบช้า) ตามเหตุผล": "Work report (slow cycles) by reason",
 "รายสัปดาห์ / รายเดือน / รายปี": "Weekly / monthly / yearly",
 "▲▼ เทียบ": "▲▼ Compare",
 "Release ทั้งหมดในโปรเจคนี้ · แตะแถวเพื่อดู Part และรายละเอียด · สร้างงานใหม่ในโปรเจคนี้ได้จากปุ่ม เพิ่ม / นำเข้า": "All Releases in this project · Tap a row to see Parts and details · Create new work in this project with the Add / Import buttons",
 "ยังไม่ได้รัน migration-round13.sql — ยังไม่มีข้อมูลสถานะหน้าเครื่อง": "migration-round13.sql has not been run — no machine status data yet",
 "ซิงค์ไม่ขึ้น": "Sync failed",
 "แอปรุ่นเก่า": "Old app version",
 "เฉพาะที่มีปัญหา": "Problems only",
 "นาฬิกาเพี้ยน": "Clock off",
 "ไม่สำเร็จ": "Failed",
 "ผูกเครื่อง": "Bind machine",
 "ผู้ดูแลระบบ": "System administrator",
 "ฝ่ายผลิต": "Production"
};

const TPLS2 = [
[
"กำลังเปิด{1}…",
"Opening {1}…"
],
[
"(ใช้งานล่าสุด {1})",
"(last used {1})"
],
[
"มีเครื่องอื่นใช้บัญชีนี้อยู่{1} — เข้าไม่ได้ · ให้ออกจากระบบที่เครื่องนั้นก่อน หรือรอสักครู่หากเครื่องนั้นปิดไปแล้ว",
"Another device is using this account{1} — can't sign in · Sign out on that device first, or wait a moment if it was turned off"
],
[
"ล็อกอินด้วยบัญชีของแผนก{1} (บัญชีที่ผูกสถานี{2}ไว้)",
"Sign in with the department account{1} (the account linked to station{2})"
],
[
"รหัสสถานี{1} / พนักงาน",
"Station{1} / employee ID"
],
[
"⛔ {1} ถูกย้ายไปเบอร์อื่นหมดแล้วใน {2} — สแกนชิ้นที่ติดป้ายใหม่ หรือแจ้งออฟฟิศ",
"⛔ {1} was fully moved to other codes in {2} — scan the piece with the new label, or tell the office"
],
[
"⛔ {1} ถูกยกเลิกใน {2} — หยุดทำ · ชิ้นที่ทำแล้วแยกเก็บตามที่ออฟฟิศกำหนด",
"⛔ {1} was cancelled in {2} — stop · keep finished pieces apart as the office instructs"
],
[
"ป้ายนี้ ({1}) เพิ่งบันทึกไปเมื่อ {2} วินาทีที่แล้ว — ทำชิ้นนี้เพิ่มอีกจริงไหม?\n\nถ้าป้ายเดิมยังอยู่หน้ากล้อง กด \"ไม่ใช่\"",
"This label ({1}) was saved {2} seconds ago — really make another piece?\n\nIf the same label is still in front of the camera, tap \"No\""
],
[
"สแกนป้ายของ {1} · โปรเจค {2} · Release {3}",
"Scan labels of {1} · Project {2} · Release {3}"
],
[
"⛔ QR นี้ถูกยกเลิกใน {1} ({2}{3}) — ไม่ต้องทำชิ้นนี้ · แยกออก · แจ้งออฟฟิศถ้าทำไปแล้ว",
"⛔ This QR was cancelled in {1} ({2}{3}) — don't make this piece · set it aside · tell the office if already made"
],
[
"ยังไม่ครบจำนวน ({1}/{2}) — เลือก Finished ได้เมื่อครบ",
"Qty not complete ({1}/{2}) — Finished is available when complete"
],
[
"จำนวน {1} ชิ้นในการบันทึกครั้งเดียว มากผิดปกติ — ยืนยันหรือไม่?",
"{1} pcs in one entry is unusually high — confirm?"
],
[
"· ปกติ ~{1} ต่อชิ้น",
"· usually ~{1} per pc"
],
[
"⏱ เวลาเร็วผิดปกติ: {1} สำหรับ {2} ชิ้น{3}\n\nลืมสแกนรอบแรกตอนเริ่มงาน หรือใส่จำนวนผิดหรือเปล่า?",
"⏱ Unusually fast: {1} for {2} pcs{3}\n\nForgot the first scan at start, or entered the wrong qty?"
],
[
"⏱ เวลานานผิดปกติ: {1} สำหรับ {2} ชิ้น{3}\n\nลืมกด \"พักงาน/แจ้งหยุด\" หรือเปล่า? ถ้ารอบนี้ช้าจริง กด \"กลับไปตรวจ\" แล้วใช้ปุ่ม แจ้งปัญหา → ใส่เหตุผล",
"⏱ Unusually long: {1} for {2} pcs{3}\n\nForgot to tap \"Pause/Report stop\"? If this round really was slow, tap \"Go back to check\" then use Report problem → enter a reason"
],
[
"⛔ {1} — ออฟฟิศเพิ่งแก้ Release นี้ · สแกนใหม่",
"⛔ {1} — the office just edited this Release · scan again"
],
[
"บันทึก {1}/{2} ขั้นตอน · พลาด {3} ({4}){5}",
"Saved {1}/{2} steps · failed {3} ({4}){5}"
],
[
"บันทึกครบ {1} ขั้นตอน ✓",
"All {1} steps saved ✓"
],
[
"เอา {1} ออกจากเบอร์แม่? (ลบชิ้นที่บันทึกไปแล้ว)",
"Remove {1} from the parent code? (deletes saved pieces)"
],
[
"{1}: ในใบบั้งมี {2} · ใส่รอบนี้แล้วรวมจะเป็น {3} (เกิน {4})\nใส่ต่อไหม?",
"{1}: bundle sheet has {2} · adding this round makes {3} (over by {4})\nAdd anyway?"
],
[
"สเตชันติดกระจกเปิดได้เฉพาะเบอร์ ซับ (หน้าต่าง) หรือ แผง — เบอร์นี้เป็น {1}",
"Glazing station only accepts sub (window) or panel codes — this code is {1}"
],
[
"{1} ยังไม่มีบันทึกที่สเตชัน{2} — บันทึกที่นั่นก่อน แล้วค่อยติดกระจก",
"{1} has no record at station{2} yet — record it there first, then glaze"
],
[
"บั้ง: {1}",
"Bundle: {1}"
],
[
"เบอร์แม่นี้ต้องใส่ {1} — เบอร์นี้เป็น {2} ใส่ไม่ได้",
"This parent code needs {1} — this code is {2}, can't add"
],
[
"{1} ครบแล้ว",
"{1} complete"
],
[
"{1} ยังไม่มีบันทึกที่สเตชัน{2}",
"{1} has no record at station{2} yet"
],
[
"{1} อยู่ในบั้ง {2} แล้ว",
"{1} is already in bundle {2}"
],
[
"✓ ติดกระจก {1} ชิ้น — เก็บเข้าคิว รอซิงค์",
"✓ Glazed {1} pcs — queued, waiting to sync"
],
[
"✓ ติดกระจกแล้ว {1} ชิ้น",
"✓ Glazed {1} pcs"
],
[
"ใส่ {1} รายการ",
"Add {1} items"
],
[
"ทำ {1} ชิ้น · ใส่ {2} รายการ",
"Make {1} pcs · add {2} items"
],
[
"ใส่เพิ่ม {1} รายการ",
"Add {1} more items"
],
[
"✓ บันทึกแล้ว {1} — {2} · เก็บเข้าคิว รอซิงค์",
"✓ Saved {1} — {2} · queued, waiting to sync"
],
[
"✓ บันทึกแล้ว {1} — {2}",
"✓ Saved {1} — {2}"
],
[
"✓ บันทึกแล้ว {1} รายการ — เก็บเข้าคิว รอซิงค์",
"✓ Saved {1} items — queued, waiting to sync"
],
[
"✓ เก็บเข้าคิว {1} ชิ้น (เน็ตหลุด) — จะซิงค์ให้อัตโนมัติ",
"✓ Queued {1} pcs (offline) — will sync automatically"
],
[
"✓ บันทึกแล้ว {1} รายการ",
"✓ Saved {1} items"
],
[
"✓ บันทึกแล้ว {1} ชิ้น — ยังไม่ครบ BOM (ส่งต่อสเตชันถัดไปได้)",
"✓ Saved {1} pcs — BOM not complete (can go to next station)"
],
[
"งานของ {1}{2} {3} รายการ รอซิงค์",
"Work of {1}{2}: {3} items waiting to sync"
],
[
"เปลี่ยนเป็น \"{1}\"?\nเบอร์แม่ + ลูกที่สแกนไว้ (ยังไม่ยืนยัน) จะถูกล้าง",
"Switch to \"{1}\"?\nThe parent code + scanned children (not confirmed) will be cleared"
],
[
"เบอร์นี้มีอยู่แล้ว {1} ชิ้น — กรอกจำนวนที่จะเพิ่ม",
"This code already has {1} pcs — enter qty to add"
],
[
"รอบก่อนใส่ไปแล้ว {1} ชิ้น — กรอกจำนวนที่ใส่รอบนี้",
"Last round added {1} pcs — enter qty for this round"
],
[
"✓ เพิ่ม (รวม {1})",
"✓ Add (total {1})"
],
[
"ประกอบไว้ {1} ชิ้น · ใส่จำนวนที่ติดกระจกรอบนี้",
"Assembled {1} pcs · enter qty glazed this round"
],
[
"ทำไว้แล้ว {1} ชิ้น · ใส่จำนวนที่ทำรอบนี้ แล้วสแกนลูก",
"Already made {1} pcs · enter qty for this round, then scan children"
],
[
"ต่อไป (ติดกระจก {1} ชิ้น)",
"Next (glaze {1} pcs)"
],
[
"เริ่มสแกนลูก (จะทำ {1} ชิ้น)",
"Start scanning children (making {1} pcs)"
],
[
"ทิ้ง{1}ที่สแกนไว้รอบนี้ {2} ชิ้น แล้วย้อนกลับ?",
"Discard the {1} scanned this round ({2} pcs) and go back?"
],
[
"ทำไว้แล้ว {1} ชิ้น",
"Already made {1} pcs"
],
[
"สแกน{1}ที่ประกอบ",
"Scan {1} assembled"
],
[
"· {1} รายการที่สแกน",
"· {1} items scanned"
],
[
"✓ บันทึกติดกระจก {1} ชิ้น{2}",
"✓ Glazing saved {1} pcs{2}"
],
[
"สแกน{1}ที่ใส่รอบนี้ก่อน",
"Scan the {1} added this round first"
],
[
"สแกน{1}ที่ประกอบรอบนี้ก่อน",
"Scan the {1} assembled this round first"
],
[
"✓ บันทึก (ทำ {1} ชิ้น · {2} รายการ)",
"✓ Save (made {1} pcs · {2} items)"
],
[
"✓ บันทึก (ใส่เพิ่ม {1} รายการ)",
"✓ Save (added {1} items)"
],
[
"✓ บันทึก ({1} รายการ)",
"✓ Save ({1} items)"
],
[
"✓ {1} — ครบ ปิดงาน ({2})",
"✓ {1} — complete, job closed ({2})"
],
[
"ไปที่ แอป → {1} → เปิดสวิตช์ \"กล้อง\" (Camera)",
"Go to Apps → {1} → turn on the \"Camera\" switch"
],
[
"เลือก{1}ที่จะประกอบ",
"Select {1} to assemble"
],
[
"ไม่มี{1}ที่ค้างอยู่ — สแกน QR เพื่อเริ่ม",
"No pending {1} — scan a QR to start"
],
[
"ใส่แล้ว {1} รายการ",
"Added {1} items"
],
[
"ทำแล้ว {1} จาก {2}",
"Done {1} of {2}"
],
[
"เวลาที่จับไว้ ({1}) จะถูกล้างและเริ่มใหม่",
"Recorded time ({1}) will be cleared and restarted"
],
[
"⚠ เกินจำนวนสั่ง +{1} ชิ้น",
"⚠ Over order qty +{1} pcs"
],
[
"ทำให้ครบ {1} ชิ้นก่อน ถึงจะเลือก \"เสร็จแล้ว\" ได้ (ตอนนี้ {2})",
"Finish all {1} pcs before choosing \"Done\" (now {2})"
],
[
"ครบ {1} แล้ว — กด \"เสร็จแล้ว\" เพื่อปิดงาน หรือทำสแปร์ต่อได้ (กำลังทำ)",
"All {1} done — tap \"Done\" to close the job, or keep making spares (In progress)"
],
[
"ยังมีงานค้างซิงค์ {1} ชิ้น — จะซิงค์อัตโนมัติเมื่อบัญชีนี้ล็อกอินอีกครั้ง (ข้อมูลไม่หาย)",
"{1} pcs still pending sync — will sync automatically when this account signs in again (no data lost)"
],
[
"บัญชี {1} ยังไม่มีเครื่อง — ให้แอดมินตั้งค่าให้ก่อน",
"Account {1} has no machine yet — ask an admin to set it up first"
]
];

// รอบ 3: ข้อความที่ยังเป็นไทยล้วน (flash/toast บนแท็บเล็ต · หัวคอลัมน์ · เดือนย่อ)
const DICT3 = {
 "ฐานข้อมูลยังไม่รู้จักประเภทงานนี้ (เช่น ติดกระจก) — รัน migration-glazing-optype.sql ใน Supabase › SQL Editor ก่อน แล้วกดบันทึกใหม่": "The database doesn't know this operation type yet (e.g. Glazing) — run migration-glazing-optype.sql in Supabase › SQL Editor, then save again",
 "รูปแบบการสแกน": "Scan mode",
 "สแกนเบอร์แม่ → สแกนเบอร์ลูก → บันทึก": "Scan parent → scan children → Save",
 "· ไม่จับเวลา ไม่ต้องกรอกความยาว": "· no timer, no length entry",
 "สเตชันประกอบ / แผง / ติดกระจก / แพ็ก ใช้แบบนี้เสมอ — \"สแกน 2 ครั้ง · จับเวลา\" ใช้กับงานเครื่องเท่านั้น": "Assembly / panel / glazing / packing stations always work this way — \"Scan twice · timed\" is for machining only",
 "ทำงานต่อ": "Resume",
 "เลือกขั้นตอน (ตัด/เจาะ/บาก) ก่อน": "Pick a step (cut/drill/notch) first",
 "ไม่พบ QR/เบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง": "QR / part code not found — scan again or type it correctly",
 "ไม่พบเบอร์พาร์ทนี้ในระบบ — สแกนใหม่ หรือพิมพ์ให้ถูกต้อง": "Part code not found — scan again or type it correctly",
 "กลับไปตรวจ": "Go back and check",
 "ถูกยกเลิกใน Modify": "cancelled in Modify",
 "— เก็บไว้ที่ \"ซิงค์ไม่สำเร็จ\" แล้ว": "— kept under \"Sync failed\"",
 ") กลับมาแล้ว — ตรวจแล้วกดยืนยันได้เลย": ") restored — check it, then confirm",
 "part ธรรมดา": "a plain part",
 "· รูปยังไม่อัป (ออนไลน์แล้วถ่ายซ้ำ)": "· photo not uploaded (retake when online)",
 "· แนบรูปไม่สำเร็จ (รูปไม่บังคับ)": "· photo upload failed (photo is optional)",
 "กำลังซิงค์งานค้าง": "Syncing pending work",
 "รอซิงค์": "Waiting to sync",
 "· รอซิงค์": "· waiting to sync",
 "พร้อมทำงาน": "Ready",
 "สแกนเมื่อทำเสร็จ": "Scan when done",
 "กด เริ่ม ก่อน": "Press Start first",
 "แจ้งปัญหา": "Report a problem",
 "แพ็กแล้ว": "Packed",
 "เบราว์เซอร์ที่ใช้": "Browser in use",
 "แล้วแตะเปิดกล้องอีกครั้ง (ถ้ายังไม่ได้ ให้โหลดหน้าใหม่)": "then tap to open the camera again (if it still fails, reload the page)",
 "หน้าต่าง/ซับ": "Window/sub",
 "ติดกระจกแล้ว": "Glazed",
 "✕ ยกเลิก": "✕ Cancel",
 "· ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่": "· offline — reconnect and try again",
 "— กดอัปเดตเมื่อพร้อม (งานที่ทำอยู่ไม่หาย)": "— press Update when ready (current work is kept)",
 "บน GitHub ตอนนี้เป็นโค้ดของหน้าเครื่อง (Station.jsx)": "on GitHub is currently the machine-screen code (Station.jsx)",
 "ยกชิ้นงานขึ้นเครื่อง · ทำเสร็จแล้วกด": "Load the piece on the machine · when done press",
 "สแกนอีกครั้ง": "Scan again",
 "เปลี่ยนรหัสผ่านแล้ว": "Password changed",
 "(ว่าง)": "(empty)",
 "ใช้ได้ทุกโปรเจค": "Usable in every project",
 "ยังไม่กรอก": "Not filled in",
 "กก./ม.": "kg/m",
 "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป": "Quantity must be a whole number ≥ 1",
 "เกิน (สแปร์)": "Extra (spare)",
 "โปรเจคนี้ปิดแล้ว — เปิดโปรเจคก่อนถึงแก้ได้": "This project is closed — reopen it before editing",
 "ลดจนเหลือ 0 ไม่ได้ — ใช้ “ยกเลิก Part”": "Can't reduce to 0 — use “Cancel part”",
 "เบอร์ปลายทาง": "Target code",
 "(ไม่ได้ระบุ = วันที่ลงแอป)": "(blank = date entered in app)",
 "ลงแอป:": "Entered:",
 "จำนวนก่อน": "Qty before",
 "ย้ายหมดแล้ว": "All moved",
 "การกระทำ": "Action",
 "เวอร์ชัน": "Version",
 "ลงแอปเมื่อ": "Entered on",
 "ยกเลิกไม่ได้": "Can't cancel",
 "สถานะเครื่อง": "Machine status",
 "Mat. Length (มม.)": "Mat. Length (mm)",
 "ยังไม่มีเครื่องเริ่ม": "No machine started yet",
 "ล็อตนี้ไม่มี Release แบบใหม่ (ปล่อยด้วยวิธีเก่า) — ไม่มีข้อมูลใบงานให้สร้างใบปล่อย": "This lot wasn't released with the new Release (old method) — no sheet data to build a release sheet",
 "ไม่พบรายการของล็อตนี้": "No items found for this lot",
 "ต้องมีเลขที่ Release Order ก่อน": "A Release Order number is required first",
 "เก็บเป็นหลักฐาน": "kept as record",
 "สแกนรอบแรกแล้ว เวลากำลังเดิน": "First scan done, timer running",
 "ครบจำนวนสั่ง หรือกด Finished": "Ordered qty reached, or Finished pressed",
 "ยังไม่มีข้อมูล": "No data yet",
 "โหลด QR บางส่วนไม่สำเร็จ — ป้ายอาจไม่ครบ กด “ค้นหา QR” อีกครั้ง": "Some QRs failed to load — labels may be incomplete; press “Search QR” again",
 "กก./ชิ้น": "kg/pc",
 "วัน · เวลา": "Date · time",
 "สร้างไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง": "Couldn't create the file — try again",
 "ชิ้น/ชม.": "pcs/h",
 "ต.ค.": "Oct",
 "พ.ย.": "Nov",
 "วันที่มีงาน": "Days with work",
 "สัปดาห์ก่อน": "Previous week",
 "ไม่มีแถวที่ต้องเติม": "No rows to fill",
 "ทุกโปรเจค": "All projects",
 "ทุก Release": "All Releases",
 "ทุก Part": "All parts",
 "กำลังโหลดข้อมูลล็อต — รอสักครู่แล้วกดอีกครั้ง": "Loading lot data — wait a moment and press again",
 "เปลี่ยนจำนวนสั่งใช้ปุ่ม ✎ Modify ที่หน้า Release (สร้าง/ยกเลิก QR + เก็บประวัติให้)": "Change ordered qty with ✎ Modify on the Release page (creates/cancels QR + keeps history)",
 "ตรวจประวัติ Modify ไม่สำเร็จ — ลองอีกครั้ง": "Couldn't check Modify history — try again",
 "ไม่พบข้อมูลพาร์ทของล็อตนี้ — แก้ Part No./INV ไม่ได้ (โหลดหน้าใหม่แล้วลองอีกครั้ง)": "No part data for this lot — can't edit Part No./INV (reload and try again)",
 "ต่อเครื่องต่อวัน": "per machine per day",
 "▼ ต่ำกว่าเป้า": "▼ Below target",
 "ชื่อเครื่อง": "Machine name",
 "ว่าง/อื่นๆ": "Blank/other",
 "เวลาหยุด (นาที)": "Downtime (min)",
 "แตะแถวเครื่องเพื่อดูการสแกนทั้งหมดของเครื่องนั้น": "Tap a machine row to see all its scans",
 "อ่านจำนวนข้อมูลของโปรเจคไม่ได้ — การลบจะต้องพิมพ์รหัสยืนยัน": "Couldn't read the project's data count — deleting requires typing the code to confirm",
 "รหัสโปรเจคไม่ตรง ยกเลิกการลบ": "Project code doesn't match — delete cancelled",
 "เมื่อสักครู่": "just now",
 "บัญชี": "Account",
 "นานสุด": "Longest",
 "ที่แล้ว": "ago",
 "บังคับออกจากระบบแล้ว": "Signed out remotely",
 "เตะเครื่องที่กำลังใช้อยู่ไม่ได้": "Can't sign out the device you're using",
 "เครื่องนั้นออกไปแล้ว หรือไม่พบเซสชัน": "That device already signed out, or the session wasn't found",
 "จุดเขียว = กำลังออนไลน์": "Green dot = online",
 "กรอกชื่อขั้นตอน": "Enter a step name",
 "ลบไม่ได้ — ขั้นตอนนี้ถูกใช้งานอยู่ (มีเครื่อง/งาน/การสแกนอ้างอิงถึง)": "Can't delete — this step is in use (machines/jobs/scans refer to it)",
 "ลบไม่ได้ — รายการนี้ถูกใช้งานอยู่ (มีเครื่องจักร/งาน/การสแกนอ้างอิงถึง) · ต้องเอาการอ้างอิงออกก่อน หรือปล่อยไว้เพื่อรักษาประวัติ": "Can't delete — this item is in use (machines/jobs/scans refer to it) · remove the references first, or keep it to preserve history",
 "กรอกโปรเจคและรหัส Part ให้ครบ": "Fill in both project and part code",
 "ตรวจข้อมูลที่ผูกกับ Part นี้ไม่ได้ — ลองใหม่อีกครั้ง (ยังไม่ได้ลบ)": "Couldn't check data linked to this part — try again (nothing deleted)",
 "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่": "Session expired — please sign in again",
 "ม.ค.": "Jan",
 "ก.พ.": "Feb",
 "มี.ค.": "Mar",
 "เม.ย.": "Apr",
 "พ.ค.": "May",
 "มิ.ย.": "Jun",
 "ก.ค.": "Jul",
 "ส.ค.": "Aug",
 "ก.ย.": "Sep",
 "ธ.ค.": "Dec"
};
const TPLS3 = [
[
"ไป{1}",
"Go to {1}"
],
[
"{1} — บันทึกไว้แล้ว {2} รายการ · ใส่เพิ่มได้",
"{1} — {2} items saved · you can add more"
],
[
"{1} ยังประกอบไม่เสร็จ — ใส่ไม่ได้",
"{1} isn't fully assembled — can't add"
],
[
"{1} อยู่ในบั้งนี้แล้ว (บันทึกไว้ก่อนหน้า)",
"{1} is already in this bundle (saved before)"
],
[
"{1} ไม่อยู่ในใบบั้งนี้",
"{1} isn't on this bundle sheet"
],
[
"{1} ใส่ครบตามใบแล้ว ({2} ชิ้น) — ชิ้นนี้จะเกิน",
"{1} already complete per sheet ({2} pcs) — this piece would be extra"
],
[
"สแกน{1}",
"Scan {1}"
],
[
"{1}ต้องใช้บัญชีที่ตั้ง \"เครื่อง/สถานีประจำ\" ไว้ที่ ตั้งค่า → พนักงาน",
"{1}needs an account with a \"home machine/station\" set in Setup → Employees"
]
];

registerI18n({ dict: { ...DICT, ...DICT2, ...DICT3 }, tpls: [...FIX_TPLS, ...TPLS3, ...TPLS, ...TPLS2] });
export default true;
