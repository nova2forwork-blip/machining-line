// ─── 2 ภาษา (ไทย/อังกฤษ) แบบครอบทั้งแอปสำนักงาน ──────────────────────────────
// วิธี: แปลที่ระดับ DOM (text node + placeholder/title) ด้วยพจนานุกรม เมื่อสลับเป็น EN
//   → ไม่ต้องแก้ JSX ทีละจุด (มีข้อความ ~250 จุด) และเพิ่มคำแปลได้ง่ายแค่เติมใน DICT
//   คำที่ยังไม่มีคำแปลจะคงเป็นไทย (graceful) · MutationObserver คอยแปลของที่เพิ่ง render
import { useState, useEffect } from "react";

const THAI = /[฀-๿]/;

// ── พจนานุกรม ไทย → อังกฤษ (คีย์ = ข้อความไทยที่ตัดช่องว่างหัวท้ายแล้ว) ──────────
const DICT = {
  // ทั่วไป / ปุ่ม
  "ยกเลิก": "Cancel", "บันทึก": "Save", "ลบ": "Delete", "แก้ไข": "Edit", "เพิ่ม": "Add",
  "ปิด": "Close", "รีเฟรช": "Refresh", "ค้นหา": "Search", "ล้าง": "Clear", "รวม": "Total",
  "จำนวน": "Qty", "จำนวนรวม": "Total qty", "จำนวนทั้งหมด": "Total qty", "จำนวนชิ้น": "Pieces",
  "ชื่อ": "Name", "รหัส": "Code", "วันที่": "Date", "สถานะ": "Status", "หมายเหตุ": "Remark",
  "ประเภท": "Type", "ลำดับ": "Order", "สิทธิ์": "Role", "สิทธิ์การใช้งาน": "Role",
  "แผนก": "Department", "ชื่อแผนก": "Department name", "ความสามารถ": "Capabilities",
  "กำลังโหลด...": "Loading…", "กำลังบันทึก...": "Saving…", "กำลังสร้าง...": "Creating…",
  "กำลังลบ...": "Deleting…", "กำลังนำเข้า...": "Importing…", "กำลังอัปเดต…": "Updating…",
  "กำลังเข้าสู่ระบบ...": "Signing in…", "กำลังบันทึกทั้งใบ...": "Saving all…", "กำลังนำเข้าทั้งใบ...": "Importing all…",
  "— เลือก —": "— Select —", "ยกเลิกทั้งหมด": "Deselect all", "เลือกทั้งหมด": "Select all",
  "เพิ่มเติม": "More", "จัดการ": "Manage", "รายงาน": "Reports", "ขั้นตอนงาน": "Workflow",
  "เพิ่มแถว": "Add row", "ลบแถว": "Delete row", "เพิ่มรายการใหม่": "Add new item",
  "หน้าแรก": "Home", "กลับหน้าแรก": "Back to home", "ดูขั้นตอน": "View steps",

  // เมนู / หัวข้อหลัก
  "โปรเจค": "Projects", "เครื่องจักร": "Machine", "เครื่อง/สถานี": "Machine/Station", "หน้าเครื่อง": "Machine terminal", "มือถือ": "Mobile",
  "พิมพ์ QR": "Print QR", "พิมพ์ QR / ป้าย": "Print QR / Labels", "รายงาน": "Reports",
  "Report (ข้อมูลสแกน)": "Report (scans)", "ระบบบันทึกการทำงานเครื่องจักร": "Machine production logging",
  "ออกจากระบบ": "Log out", "เข้าสู่ระบบ": "Sign in", "รหัสผ่าน": "Password",
  "พนักงาน": "Employees", "พนักงานหน้าเครื่อง": "Machine operator", "หัวหน้างาน": "Supervisor",

  // น้ำหนัก / ความยาว / หน่วย
  "น้ำหนัก": "Weight", "ความยาว": "Length", "วัสดุ": "Material",
  "น้ำหนัก/ชิ้น": "Weight/pc", "น้ำหนักรวม": "Total weight", "ความยาว/ชิ้น": "Length/pc",
  "น้ำหนัก/ชิ้น (กก.)": "Weight/pc (kg)", "ความยาว/ชิ้น (มม.)": "Length/pc (mm)",
  "น้ำหนักวัสดุ (กก.)": "Material weight (kg)", "น้ำหนักวัสดุ": "Material weight",
  "เวลาเดินเครื่อง": "Machine time", "เฉลี่ย/วัน": "Avg/day",
  "ชิ้น": "pcs", "กก.": "kg", "มม.": "mm", "ใบ": "labels", "พาร์ท": "parts", "Part": "parts",
  "ยาว (มม.)": "Length (mm)", "Length (มม.)": "Length (mm)", "กว้าง (มม.)": "Width (mm)", "สูง (มม.)": "Height (mm)",

  // Part / Release / โปรเจค
  "ชื่อ Part": "Part name", "รหัส Part": "Part code", "รหัส Part *": "Part code *",
  "ชื่อโปรเจค": "Project name", "รหัสโปรเจค": "Project code", "ชื่อโปรเจค *": "Project name *", "รหัสโปรเจค *": "Project code *",
  "เพิ่ม Release": "Add Release", "เพิ่ม Part": "Add Part", "เพิ่มโปรเจค": "Add Project",
  "สร้างโปรเจคใหม่": "New Project", "สร้างโปรเจค": "Create Project", "โปรเจคใหม่": "New Project",
  "สร้าง Part": "Create Part", "Part ใหม่": "New Part", "สร้างใหม่": "New", "มีอยู่แล้ว": "Exists",
  "แก้ไขโปรเจค": "Edit Project", "เพิ่มโปรเจคใหม่": "Add new project", "ลบโปรเจคนี้": "Delete this project",
  "แก้ไข Release": "Edit Release", "บันทึก Release": "Save Release", "ปล่อยงาน": "Released", "ปล่อยงาน (ชิ้น)": "Released (pcs)",
  "ลบ Part นี้": "Delete this Part", "ลบ Release นี้": "Delete this Release", "ลบพนักงานนี้": "Delete this employee",
  "สำรองข้อมูล": "Backup", "สำรองข้อมูล (ดาวน์โหลดเก็บเอง)": "Backup (download your own copy)",
  "ดาวน์โหลดไฟล์สำรองข้อมูล (JSON)": "Download backup file (JSON)",
  "ตารางที่รวมอยู่ในไฟล์สำรอง": "Tables included in the backup",
  "กำลังเตรียมข้อมูล...": "Preparing data…",
  "จุดกู้คืนในแอป (ย้อนหลัง 7 วัน)": "In-app restore points (last 7 days)",
  "สร้างจุดกู้คืนตอนนี้": "Create restore point now", "กำลังสร้าง...": "Creating…",
  "กู้คืน": "Restore", "กู้คืนข้อมูลโปรเจค": "Restore project data",
  "อัตโนมัติ": "Auto", "สร้างเอง": "Manual", "ชนิด": "Type", "จำนวนแถว": "Rows", "วันที่/เวลา": "Date/Time",
  "กู้เฉพาะที่หายไป (แนะนำ)": "Restore missing only (recommended)",
  "ย้อนทั้งโปรเจคกลับวันนั้น": "Revert entire project to that day",
  "ยืนยันกู้คืน": "Confirm restore", "กำลังกู้คืน...": "Restoring…",
  "ยืนยันย้อนทั้งโปรเจค": "Confirm full revert", "กำลังย้อนข้อมูล...": "Reverting…",
  "ย้อนกลับ": "Back", "ยังไม่มีจุดกู้คืน": "No restore points yet",
  "โปรเจคนี้ยังไม่มีจุดกู้คืน": "No restore points for this project",
  "นำเข้าไฟล์สำรอง (กู้คืนจากไฟล์ JSON)": "Import backup (restore from JSON file)",
  "เลือกไฟล์สำรอง แล้วนำเข้า": "Choose backup file & import", "กำลังนำเข้า...": "Importing…",
  "เลขที่ Release Order": "Release Order no.", "เลขที่ Release Order *": "Release Order no. *",
  "จำนวน (ชิ้น)": "Qty (pcs)", "% เสร็จ": "% done", "เสร็จแล้ว": "Finished", "เสร็จ": "Finished", "ทำแล้ว": "Done",
  "กำลังทำ": "In Progress", "ยังไม่เริ่ม": "Not started", "ความคืบหน้า": "Progress",
  "เสร็จแล้ว (ภาพรวม)": "Done (overall)", "ยังไม่มี Release": "No releases yet", "ยังไม่มีโปรเจค": "No projects yet",

  // สถานะ / ข้อความ
  "มีเวอร์ชันใหม่ของระบบ": "A new version is available", "อัปเดตเดี๋ยวนี้": "Update now",
  "ยังไม่ตั้ง": "Not set", "ยังไม่ได้กำหนด Routing สำหรับ Part นี้": "No routing set for this part",
  "ไม่บังคับ": "Optional", "ปิด": "Close", "ใช่": "Yes", "ไม่ใช่": "No", "ทั้งหมด": "All",

  // เครื่องจักร / setup
  "เครื่อง/สถานีประจำ": "Assigned machine/station", "ขั้นตอนประจำ": "Assigned operation",
  "เครื่อง/สถานีประจำ *": "Assigned machine/station *", "ขั้นตอนประจำ *": "Assigned operation *",
  "ขั้นตอนประจำ (เลือกได้หลายขั้นตอน)": "Assigned operations (select multiple)",
  "ขั้นตอนประจำ (เลือกได้หลายขั้นตอน) *": "Assigned operations (select multiple) *",
  "เลือกเครื่อง/สถานีก่อน จึงจะบันทึกหลายขั้นตอนได้": "Select a machine/station first to save multiple operations",
  "ยังไม่มีขั้นตอนงาน — ไปเพิ่มที่แท็บ \"ขั้นตอนงาน\" ก่อน": "No operations yet — add them in the \"Workflow\" tab first",
  "พนักงานที่ยังไม่ได้ตั้งเครื่อง/สถานี/ขั้นตอนประจำ จะสแกนงานไม่ได้ (ตั้งภายหลังได้ที่ปุ่ม \"แก้ไข\") · เลือกได้หลายขั้นตอนถ้าเครื่องนี้ทำได้หลายอย่าง":
    "Employees without an assigned machine/operation can't scan (you can set it later via \"Edit\") · select multiple operations if this machine does more than one",
  "รหัสเครื่อง": "Machine code", "ชื่อเครื่อง/สถานี": "Machine/station name", "รหัสพนักงาน": "Employee code",
  "ขั้นตอนที่ทำได้": "Operations", "ขั้นตอนที่เครื่องนี้ทำได้": "Operations this machine can do",
  "แก้ชื่อและประเภทงานได้ · รหัสเครื่องแก้ไม่ได้ (เป็นตัวระบุตัวตน)": "Edit name and work type · machine code can't be changed (it's the identifier)",
  "แก้ชื่อ/ประเภท · เลือกขั้นตอนที่ทำได้ · หรือลบเครื่อง — รหัสเครื่องแก้ไม่ได้": "Edit name/type · select operations · or delete — machine code can't be changed",
  "ขั้นตอนที่เครื่องนี้ทำได้ (เลือกได้หลายอย่าง)": "Operations this machine can do (select multiple)",
  "ไม่เลือกเลย = ไม่จำกัด (เครื่องนี้สแกนขั้นตอนใดก็ได้) — เลือกอย่างน้อย 1 อย่างเพื่อเปิดการตรวจสอบ": "None selected = unlimited (any operation) — select at least 1 to enable checking",
  "ลบเครื่องนี้": "Delete this machine", "กดเพื่อเรียงลำดับ": "Click to sort",
  "เรียงโดย": "Sort by", "— ค่าเริ่มต้น —": "— Default —",
  "▲ น้อย→มาก": "▲ Low→High", "▼ มาก→น้อย": "▼ High→Low", "สลับ น้อย↔มาก": "Toggle low↔high",
  "↶ กด Ctrl+Z เพื่อย้อนการแก้ไข": "↶ Press Ctrl+Z to undo edits",
  "เครื่อง/สถานีหนึ่งทำได้หลายขั้นตอน · งานประกอบ/แพ็กสร้างเป็น \"สถานี\" ที่นี่ (เช่น ประกอบ-01, แพ็ก-01) — กด \"แก้ไข\" เพื่อตั้งชื่อ/ประเภท เลือกขั้นตอนที่ทำได้ หรือลบเครื่อง": "A machine/station can do several operations · create assembly/packing stations here (e.g. ประกอบ-01, แพ็ก-01) — press \"Edit\" to set name/type, choose operations, or delete",
  "ประเภทงาน (คำอธิบาย · ไม่บังคับ)": "Work type (description · optional)",
  "เช่น CUTTING / NOTCHING": "e.g. CUTTING / NOTCHING",
  "ไม่จำกัด (ยังไม่ตั้ง)": "Unlimited (not set)", "ประเภทงาน": "Work type",
  "เพิ่มพนักงาน": "Add employee", "เพิ่มพนักงานใหม่": "Add new employee", "เพิ่มเครื่อง/สถานีใหม่ + ตั้งความสามารถ": "Add machine/station + capabilities",
  "รหัสผ่านเริ่มต้น": "Default password", "ใช้งาน": "Active", "ปิดใช้งาน": "Disabled",
  "ตั้งรหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)": "Set new password (blank = keep)",

  // Report
  "สรุปผลการสแกนตามช่วงเวลาและ Part ที่เลือก": "Scan summary by period and selected Part",
  "ช่วงเวลาที่ต้องการดู": "Period to view", "ช่วงเวลาด่วน": "Quick range", "รายเดือน": "Monthly",
  "กำหนดเอง (จาก–ถึง)": "Custom (from–to)", "วันนี้": "Today", "7 วันล่าสุด": "Last 7 days",
  "30 วันล่าสุด": "Last 30 days", "12 เดือนล่าสุด": "Last 12 months", "จากวันที่": "From", "ถึงวันที่": "To",
  "จำนวนชิ้นที่ทำ · รวมทุกขั้นตอน": "Pieces done · all operations", "งาน/ล็อตที่มีความเคลื่อนไหว": "Active lots",
  "น้ำหนักวัสดุ · นับต่อชิ้น (กก.)": "Material weight · per piece (kg)",
  "ปริมาณงานที่ประมวลผล · ทุกขั้นตอน (กก.)": "Processed workload · all ops (kg)",
  "เวลาเดินเครื่องรวม (จับจากหน้าเครื่อง)": "Total machine time (from terminal)",
  "เครื่องจักร × ขั้นตอน (ปริมาณงานที่ประมวลผล)": "Machine × operation (processed workload)",
  "ปริมาณงานที่แต่ละเครื่องประมวลผล": "Workload processed by each machine",
  "รวมทุกขั้นตอน": "All operations", "ปริมาณงานที่ประมวลผล": "Processed workload",
  "สรุปแยกตามชนิด Part (สะสมทั้งหมด)": "Summary by Part (cumulative)",
  "Finished Part — ชิ้นงานที่เสร็จสมบูรณ์": "Finished Parts — completed pieces",

  // Machines/Parts summary + Projects page
  "เพิ่ม / แก้ไข / ลบ โปรเจค + ดูความคืบหน้าแยกตามโปรเจค": "Add / edit / delete projects + progress by project",
  "ยังไม่มีการสแกนในช่วงเวลานี้": "No scans in this period",
  "แต่ละเครื่องทำได้กี่กิโล/กี่ชิ้น และใช้เวลาเท่าไร ในแต่ละวัน ·": "kg/pieces/time per machine, per day ·",
  "คิดจากเฉพาะวันที่มีงานจริง": "based on days with activity only", "หมายเหตุ:": "Note:",

  // QR labels
  "พิมพ์ QR / ป้าย": "Print QR / Labels", "เลือกล็อตที่ต้องการพิมพ์": "Select lot to print",
  "ค้นหา QR": "Search QR", "ป้ายที่จะพิมพ์": "Labels to print", "ชนิดป้าย": "Label type",
  "ขนาดป้าย": "Label size", "รูปแบบการพิมพ์": "Print mode", "แสดงรหัสใต้ QR": "Show code under QR",
  "ป้ายรายชิ้น · รันเบอร์ 1 OF N (ชิ้นใหญ่)": "Per-piece · running 1 OF N (large)",
  "ป้ายรวมล็อต · 1 ใบต่อพาร์ท (ชิ้นเล็ก)": "Lot label · 1 per part (small)",
  "1 ป้าย/หน้า · เท่าจริง": "1 label/page · actual size", "หลายป้าย/แผ่น A4": "Many/sheet A4",
  "ไม่พบชิ้นงาน (QR) ในตัวกรองนี้": "No pieces (QR) match this filter",
  "ตัวกรองเปลี่ยนแล้ว — กด “ค้นหา QR” เพื่ออัปเดต": "Filter changed — press “Search QR” to update",
  "ไม่พบล็อตที่ตรงกับการค้นหา — กด “ล้าง” เพื่อดูทั้งหมด": "No lots match — press “Clear” to see all",
  "ค้นหา Part No. / Release Order / โปรเจค / วันที่...": "Search Part No. / Release Order / Project / date…",
  "นำเข้าจาก Excel (หลาย Part)": "Import from Excel (multi-Part)", "ล้างตัวกรอง": "Clear filters",
  "กรุณาเลือกอย่างน้อย 1 ใบ": "Please select at least 1 label",

  // Release detail / progress modal
  "กลับไปหน้า Release": "Back to Releases", "โหลดความคืบหน้าล่าสุด": "Load latest progress",
  "กลับไปหน้า Projects": "Back to Projects", "น้ำหนักรวม (กก.)": "Total weight (kg)",
  // ชื่อขั้นตอน (operation) — แปลในตาราง/ป้ายเมื่อสลับ EN
  "ตัด": "Cut", "เจาะ": "Drill", "บาก": "Notch", "พับ": "Bend", "เชื่อม": "Weld", "ประกอบ": "Assemble", "ไม่ระบุ": "Unspecified",
  // หัวข้อ + คำอธิบายแต่ละหน้า (2 ภาษา)
  "พิมพ์ QR / ป้าย": "Print QR / Labels", "สแกนหน้าเครื่องจักร": "Scan at machine",
  "เพิ่ม / แก้ไข / ลบ โปรเจค + ดูความคืบหน้าแยกตามโปรเจค · แตะแถวเพื่อดู Release และ Part ในโปรเจคนั้น":
    "Add / edit / delete projects + view progress by project · tap a row to see releases and parts",
  "Release ทั้งหมดในโปรเจคนี้ · แตะแถวเพื่อดู Part และรายละเอียด":
    "All releases in this project · tap a row to view parts and details",
  "สรุปผลการสแกนตามช่วงเวลาและ Part ที่เลือก": "Scan summary by period and selected Part",
  "ค้นหาล็อตที่เคย Release แล้วพิมพ์ป้ายซ้ำได้ทุกเมื่อ — ค่าเริ่มต้นขนาด 2×2 ซม.":
    "Find a lot you released before and reprint labels anytime — default size 2×2 cm",
  "ค้นหา Release ที่เคยปล่อยงาน หรือกด \"เพิ่ม Release\" เพื่อปล่อยงานใหม่ (วางข้อมูลจาก Excel ได้) · แตะแถวเพื่อดูความคืบหน้า แก้ไข หรือลบ":
    "Search past releases, or press \"Add Release\" to release new work (paste from Excel) · tap a row to view progress, edit, or delete",
  "เลือกโหมดให้ตรงกับวิธีใช้งาน แล้วกด \"เริ่มสแกน\"": "Choose the mode that fits, then press \"Start scan\"",
  "ปล่อยงาน (Release)": "Release Production", "ตั้งค่า": "Setup", "รายงานข้อมูลสแกน": "Scan Report",
  "สรุปภาพรวม": "Overview", "สรุปเครื่องจักร": "Machines Summary", "สรุป Part": "Parts Summary",
  "ผู้ดูแลระบบ (Admin)": "Administrator",
  "จำนวน (นับต่อขั้นตอน)": "Count (per operation)", "จำนวนที่บันทึก · นับต่อขั้นตอน": "Recorded · per operation",
  "ยังไม่มี Release ในโปรเจคนี้": "No releases in this project",
  "ปล่อยงานที่หน้า Release Production เพื่อสร้าง Release แรก": "Create the first release on the Release Production page",
  "ยังไม่มี Part — เพิ่มที่ Setup › Part Master": "No parts yet — add them in Setup › Part Master",
  "ยังไม่มีข้อมูลการปล่อยงาน": "No release data yet",
  "จำนวนทั้งหมด": "Total qty", "ทำแต่ละขั้นตอนไปแล้วกี่ชิ้น": "Pieces done per operation",
  "ยังไม่มีการบันทึกงานหน้าเครื่องสำหรับ Part นี้": "No terminal work recorded for this part",
  "กดเพื่อดูความคืบหน้าแยกขั้นตอน": "Tap to view per-operation progress",
  "ชิ้นที่เสร็จทั้งหมด": "Total finished", "รายการชิ้นงานที่เสร็จสมบูรณ์": "Completed pieces list",
  "ยังไม่มีชิ้นงานที่เสร็จสมบูรณ์": "No completed pieces yet",

  // Setup
  "ชื่อขั้นตอน (เช่น ตัด/เจาะ/บาก)": "Operation name (e.g. cut/drill/notch)",
  "ยังไม่มีขั้นตอนงาน — ไปตั้งค่าที่ Setup ก่อน": "No operations — set them up in Setup first",
  "จำนวนต้องมากกว่า 0": "Qty must be greater than 0",

  // หัวข้อการ์ด / หัวข้อตาราง เพิ่มเติม
  "ค้นหา Release": "Search Release",
  "ประวัติการ Release ล่าสุด": "Recent Releases",
  "รายละเอียดแต่ละ Part ในล็อตนี้": "Details of each Part in this lot",
  "ความคืบหน้าตามขั้นตอน (งานหน้าเครื่อง)": "Progress by operation (terminal)",
  "นำเข้า Release จาก Excel": "Import Release from Excel",
  "รายวัน × เครื่องจักร (กก. / จำนวน / เวลา ต่อวัน)": "Daily × Machine (kg / qty / time per day)",
  "แยกตามขั้นตอนการทำงาน": "By operation",
  "Part No. × ขั้นตอน (จำนวนชิ้น)": "Part No. × Operation (pieces)",
  "Release × Part × ขั้นตอน": "Release × Part × Operation",
  "เครื่องจักร × ขั้นตอน (ปริมาณงาน + เฉลี่ย/วัน)": "Machine × Operation (workload + avg/day)",
  "เฉลี่ย/วัน": "Avg/day",
  "รวม (ชิ้น)": "Total (pcs)", "น้ำหนัก (กก.)": "Weight (kg)", "เสร็จ (ชิ้น)": "Finished (pcs)",
  "กด Ctrl+Z เพื่อย้อนกลับการแก้ไขตาราง": "Press Ctrl+Z to undo table edits",
  "สถานีของคุณ": "Your station", "เลือกโหมดสแกน": "Select scan mode",
  "สแกนที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ (จะซิงค์อัตโนมัติเมื่อเน็ตกลับ)": "Scans not yet uploaded (auto-sync when back online)",
  "ค้นหา Release Order / Part / หมายเหตุ": "Search Release Order / Part / Remark",
  "เช่น P-009": "e.g. P-009", "เช่น P-009 (ไม่บังคับ)": "e.g. P-009 (optional)",
  "เช่น admin": "e.g. admin", "เช่น M-001": "e.g. M-001", "เช่น PRJ001": "e.g. PRJ001",
  "เช่น สายการผลิตชิ้นส่วน A": "e.g. Part line A", "P-ตัวเลข": "P-number",
  "รายละเอียด": "Details", "จากวันที่": "From", "ถึงวันที่": "To",
  "ค้นหา Release ที่เคยปล่อยงาน หรือกด": "Search released lots, or press",
  "เพื่อปล่อยงานใหม่ (วางข้อมูลจาก Excel ได้) · แตะแถวเพื่อดูความคืบหน้า แก้ไข หรือลบ": "to release new work (paste from Excel) · tap a row for progress, edit, or delete",

  // ═══ หน้าเครื่องจักร (Station / Machine terminal) ═══════════════════════════
  // — หน้าล็อกอิน —
  "หน้าเครื่อง — เข้าสู่ระบบ": "Machine Terminal — Sign in",
  "ล็อกอินด้วยบัญชีของเครื่อง/สถานีนี้ (บัญชีที่ผูกเครื่อง/สถานีไว้)": "Sign in with this machine/station's account (the account bound to it)",
  "รหัสเครื่อง / พนักงาน": "Machine / employee code",
  "จอนี้สำหรับติดหน้าเครื่อง/สถานี (แนวนอน)": "This screen mounts on the machine/station (landscape)",
  "ไปหน้าปกติ (สำนักงาน) →": "Go to the normal (office) page →",
  "เช่น CT-001": "e.g. CT-001",
  "รหัสเครื่อง/พนักงาน หรือรหัสผ่านไม่ถูกต้อง": "Machine/employee code or password is incorrect",
  "บัญชีนี้ยังไม่เคยล็อกอินในเครื่องนี้ — ต้องล็อกอินตอนมีเน็ต 1 ครั้งก่อน แล้วครั้งต่อไปจะออฟไลน์ได้":
    "This account hasn't signed in on this device yet — sign in once while online, then it can work offline next time",
  "บัญชีนี้ถูกใช้ล็อกอินที่เครื่องอื่น — กรุณาเข้าสู่ระบบใหม่": "This account was signed in on another device — please sign in again",
  // — บัญชีไม่ได้ผูกเครื่อง —
  "บัญชีนี้ยังไม่ได้ผูกเครื่อง/สถานี": "This account isn't bound to a machine/station",
  "หน้าเครื่องต้องใช้บัญชีที่กำหนด \"เครื่อง/สถานีประจำ\" ไว้ที่ Setup → พนักงาน":
    "The terminal needs an account with an assigned machine (Setup → Employees)",
  "แจ้ง Admin ให้ตั้งค่า machine ให้บัญชีนี้ก่อน": "Ask an Admin to set a machine for this account first",
  "ไปหน้าสำนักงาน (ล็อกอินใหม่ด้วยบัญชี Admin) →": "Go to the office page (sign in again as Admin) →",
  // — ปุ่มเลือกขั้นตอน —
  "ขั้นตอน:": "Operation:",
  "← แตะเลือกก่อนสแกน": "← tap to select before scanning",
  // — มุมบน / รหัสเครื่อง —
  "⏻ ออก": "⏻ Exit", "⛶ เต็มจอ": "⛶ Fullscreen", "เต็มจอ": "Fullscreen",
  "— ไม่มีเครื่อง —": "— No machine —",
  // — แถบเตือน —
  "⏳ ค้างซิงค์": "⏳ Pending sync",
  "⛔ ที่เก็บข้อมูลเต็ม — งานอาจไม่ถูกบันทึก! ปิดแอปอื่น/ล้างข้อมูลเบราว์เซอร์ แล้วลองใหม่ · แจ้งผู้ดูแล (แตะเพื่อซ่อน)":
    "⛔ Storage full — work may not be saved! Close other apps / clear browser data and retry · notify admin (tap to hide)",
  "ที่เก็บข้อมูลในเครื่องเต็ม": "Device storage is full",
  "⚠️ ซิงค์ไม่สำเร็จ": "⚠️ Sync failed",
  "— QR ถูกลบ/แก้ฝั่งออฟฟิศ · แตะเพื่อลองใหม่": "— QR deleted/edited at office · tap to retry",
  "แตะเพื่อลองซิงค์อีกครั้ง (หลังออฟฟิศกู้/แก้ข้อมูลแล้ว)": "Tap to retry sync (after office restores/fixes data)",
  // — ตาราง —
  "ยังไม่มีบันทึกวันนี้ — เริ่มงานแรกได้เลย": "No records today — start your first job",
  "ยังไม่ซิงค์ — รอเน็ตกลับมา": "Not synced yet — waiting for connection",
  "โหลดข้อมูลไม่สำเร็จ": "Failed to load data",
  // — พื้นที่ทำงาน (WorkArea) —
  "พร้อมเริ่มงาน — กรอก": "Ready — enter",
  "แล้วกด": "then press", "เพื่อเริ่มจับเวลา": "to start the timer",
  "● กำลังบันทึกเวลา": "● Recording time",
  "กด": "Press", "เพื่อสแกนชิ้นงาน": "to scan a part",
  "ยกเลิกการบันทึก?": "Cancel this recording?",
  "เวลาที่จับไว้ (": "The elapsed time (",
  ") จะถูกล้างและเริ่มใหม่": ") will be cleared and the timer restarts",
  // — กล้องสแกน —
  "หรือพิมพ์รหัส QR": "Or type QR code", "ตกลง": "OK",
  "✕ ปิดกล้อง / ยกเลิก": "✕ Close camera / Cancel", "ปิดกล้อง": "Close camera",
  "เปิดกล้องไม่ได้ — พิมพ์รหัส QR ด้านล่างแทนได้": "Can't open camera — type the QR code below instead",
  // — แถบอัปเดต —
  "● มีเวอร์ชันใหม่ — กดอัปเดตเมื่อพร้อม": "● New version available — update when ready",
  "● มีเวอร์ชันใหม่ · ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่": "● New version available · you're offline, reconnect and retry",
  "อัปเดต": "Update",
  // — ข้อความแจ้งเตือน (toast/flash) —
  "กด START ก่อนเริ่มสแกน": "Press START before scanning",
  "เลือกขั้นตอน (ตัด/เจาะ/บาก) ก่อนสแกน": "Select an operation (cut/drill/notch) before scanning",
  "ไม่พบ QR นี้ในระบบ — สแกนใหม่ หรือพิมพ์รหัสด้านล่าง": "This QR isn't in the system — scan again or type the code below",
  "เลือกสถานะ In Process หรือ Finished": "Select status: In Process or Finished",
  "ระบุจำนวนมากกว่า 0": "Enter a quantity greater than 0",
  "จำนวนต้องเป็นจำนวนเต็ม": "Quantity must be a whole number",
  "จำนวนมากเกินไป (สูงสุด 100,000/ครั้ง)": "Too many (max 100,000 per record)",
  "กรอกความยาววัสดุ (Material Length) ก่อน": "Enter Material Length first",
  "เน็ตสะดุด — เก็บเข้าคิวแล้ว จะซิงค์ให้อัตโนมัติ": "Connection dropped — queued, will sync automatically",
  "บันทึกแล้ว ✓ พร้อมงานถัดไป": "Saved ✓ ready for the next job",
  "บันทึกไม่สำเร็จ": "Save failed",
  "บัญชีถูกใช้ที่เครื่องอื่น — กำลังซิงค์งานค้างก่อนออก": "Account used on another device — syncing pending work before exit",

  // ── ปิด/เปิด/ลบ โปรเจค (admin) + สถานะ ──
  "พนักงานออฟฟิศ": "Office staff",
  "ปิดโปรเจค": "Close project", "ปิดโปรเจค (เสร็จ)": "Close project (done)",
  "เปิดโปรเจค": "Reopen project", "เปิดโปรเจคอีกครั้ง": "Reopen project",
  "ลบโปรเจค": "Delete project", "ปิดโปรเจคแล้ว": "Project closed",
  "เปิดโปรเจคอีกครั้งแล้ว": "Project reopened", "โปรเจคถูกปิด": "Project is closed",
  "โปรเจคนี้ปิดแล้ว — เปิด/แก้ได้ในปุ่มแก้ไข": "This project is closed — reopen/edit via Edit",
  "สถานะ:": "Status:", "ปิดแล้ว (เสร็จ)": "Closed (done)",
  "หน้าเครื่องบันทึกงานเพิ่มไม่ได้": "Terminal can't record more work",
  "ปิดเมื่อทำเสร็จ เพื่อกันบันทึกงานเพิ่ม": "Close when done to prevent more records",

  // ── ล้างข้อมูลสแกน (Clear scans · admin) ──
  "ล้างข้อมูลสแกน (เฉพาะ Admin)": "Clear scan data (Admin only)",
  "1) เลือกโปรเจค": "1) Select project", "2) ขอบเขตที่จะลบ": "2) Scope to clear",
  "ทั้งโปรเจค": "Whole project", "รายชุด Release": "By Release batch",
  "ราย Part": "By Part", "รายชิ้น (QR)": "By piece (QR)",
  "เลือกชุด Release": "Select Release batch", "เลือก Part": "Select Part",
  "รหัส QR ของชิ้นงาน": "Piece QR code", "สแกน/พิมพ์รหัส QR": "Scan/type QR code",
  "ตรวจจำนวนก่อนลบ": "Check count before deleting", "ลบข้อมูลสแกน": "Clear scan data",
  "ไม่มีข้อมูลสแกนให้ลบ": "No scan data to delete",
  "— เลือกโปรเจค —": "— Select project —", "— เลือกชุด —": "— Select batch —", "— เลือก Part —": "— Select Part —",
  "เลือกโปรเจคก่อน": "Select a project first", "เลือกชุด Release ก่อน": "Select a Release batch first",
  "เลือก Part ก่อน": "Select a Part first", "พิมพ์/สแกน QR ก่อน": "Type/scan a QR first",
  "ไม่พบ QR นี้ในระบบ": "This QR isn't in the system",

  "รุ่นของเว็บที่เปิดอยู่ (เปลี่ยนทุกครั้งที่ deploy)": "Web build in use (changes on every deploy)", "รุ่นของเว็บ": "Web build",
  // ── รอบ 13 (2026-09-25): คำที่ยังตกหล่น — เก็บจากการไล่ทุกหน้า/ป็อปอัปในโหมด EN (บอทไล่หน้าจอ) ──
  "สลับภาษา / Switch language": "Switch language",
  "ตรวจงานประกอบ": "Assembly check",
  "เปลี่ยนรหัสผ่าน": "Change password",
  "รายงานปัญหาเครื่อง": "Machine issues",
  "แผง": "Panel",
  "สลับทิศทางการเรียง": "Toggle sort direction",
  "แพ็ก": "Packing",
  "งานตัด / เจาะ": "Cutting / drilling",
  "ซับ": "Sub",
  "ออก": "Exit",
  "ขั้นตอน": "Operations",
  "ผู้ใช้ออนไลน์ / หน้าเครื่อง": "Online users / stations",
  "ประวัติการแก้ไข": "Audit log",
  "คอลัมน์ตาราง": "Table columns",
  "แก้ไขหัวเอกสาร": "Edit header",
  "น้ำหนักที่ทำแล้ว:": "Weight done:",
  "แก้เลขที่ Release Order / วันที่ / Modify ของทั้งใบ": "Edit the Release Order / date / Modify of the whole document",
  "ช่วงเวลา": "Period",
  "ดาวน์โหลด Excel": "Download Excel",
  "บันทึก Material": "Materials",
  "หน้าเครื่อง (ตัด/เจาะ/บาก…) (/station)": "Machine station (cut/drill/notch…) (/station)",
  "ซับแอสเซมบลี": "Sub-assembly",
  "เบอร์ประกอบ / แผง": "Assembly / panel no.",
  "นำเข้าฟอร์มบั้ง (แพ็ก)": "Import bundle form (packing)",
  "ค้นหา Release / Part / INV / รหัสโปรเจค / หมายเหตุ": "Search Release / Part / INV / project code / remark",
  "เช่น P-009 · AN04-001 · INV 6063 · A10035": "e.g. P-009 · AN04-001 · INV 6063 · A10035",
  "วินาที/ชิ้น": "sec/pc",
  "เฉลี่ย กก./วัน": "Avg kg/day",
  "เฉลี่ย ชิ้น/วัน": "Avg pcs/day",
  "เลือกตารางแล้วดาวน์โหลดเป็นไฟล์ Excel": "Pick tables and download as Excel",
  "เครื่องเสีย": "Machine breakdown",
  "นับตามจำนวนชิ้นที่ทำในแต่ละขั้นตอน — ชิ้นเดียวที่ผ่านหลายเครื่องจะถูกนับที่ทุกเครื่องที่ทำ (งานหน้าเครื่องนับตามจำนวนที่กรอก)": "Counted by pieces done in each operation — a piece that goes through several machines is counted at every machine that worked on it (station work counts the quantity entered)",
  "รายงานประจำวัน": "Daily Report",
  "พนักงานยกอลูมิเนียมไปวางบนเครื่องตัด": "Worker carrying aluminium to the saw",
  "กดเพื่อดู Release ในโปรเจคนี้": "Click to see the releases in this project",
  "วันที่ *": "Date *",
  "โปรเจค *": "Project *",
  "จำนวนลูกที่ใส่รวม (ชิ้น)": "Total children fitted (pcs)",
  "ความยาวรวม (มม.)": "Total length (mm)",
  "ไม่มีข้อมูลในช่วงนี้": "No data in this period",
  "แพ็กแผง": "Pack panel",
  "แพ็กไซต์ไอเทม": "Pack site item",
  "งานเครื่อง (machining)": "Machining",
  "ประกอบ · ซับ (subassembly)": "Assembly · sub (subassembly)",
  "แผง (panel)": "Panel",
  "แพ็กแผง (pack panel)": "Pack panel",
  "แพ็กไซต์ไอเทม (pack site item)": "Pack site item",
  "แพ็ก · รวมทุกบั้ง (packing)": "Packing · all bundles",
  "หน้าต่างนี้ล็อกไว้ — กด \"ยกเลิก\" หรือ ✕ เพื่อออก": "This window is locked — press \"Cancel\" or ✕ to leave",
  "นำเข้าจากไฟล์ Excel": "Import from Excel file",
  "กด Ctrl+V": "press Ctrl+V",
  "(ช่องด้านล่างพร้อมวางแล้ว)": "(the box below is ready to paste)",
  "จำนวนเบอร์แม่ (ซับ)": "Parent count (sub)",
  "รายการซับ — เบอร์ลูกที่ใส่เข้าแต่ละเบอร์แม่": "Sub list — children fitted to each parent",
  "แต่ละเบอร์แม่มีเบอร์ลูกอะไร ยาวเท่าไร กี่ชิ้น — ใช้เช็คว่าประกอบถูกไหม": "What children each parent has, their length and count — to check the assembly",
  "ตรวจงานประกอบ / แพ็ก": "Assembly / packing check",
  "เทียบ \"ที่สั่งจาก release (แผน)\" กับ \"ที่หน้างานสแกนมาจริง\" — ดูว่าทำถูก + ครบไหม · เลือกเบอร์จากรายการ หรือสแกน/พิมพ์ QR (ดูของที่เสร็จแล้วได้)": "Compare \"ordered in the release (plan)\" with \"actually scanned on the floor\" — see whether it's right and complete · pick a number from the list or scan/type a QR (finished ones too)",
  "เลือกเบอร์แม่ / เบอร์แพ็ก": "Pick a parent / package number",
  "เบอร์ (Part)": "Number (Part)",
  "หรือสแกน / พิมพ์ QR ตรงๆ (เสร็จแล้วก็ดูได้)": "or scan / type a QR directly (finished ones too)",
  "โหลด": "Load",
  "เลือก": "Select",
  "โปรเจค / parts": "Project / parts",
  "หรือพิมพ์ค้นหาด้านบน เพื่อดูรายการ": "or type to search above to see the list",
  "· หรือสแกน / พิมพ์ QR ตรง ๆ (ดูเบอร์ที่เสร็จแล้วก็ได้)": "· or scan / type a QR directly (finished numbers too)",
  "เช่น UA3011B / QR": "e.g. UA3011B / QR",
  "ค้นหาเพิ่ม (เบอร์ / โปรเจค / QR)": "Search more (number / project / QR)",
  "เครื่อง/สถานีหนึ่งทำได้หลายขั้นตอน · งานประกอบ/แพ็กสร้างเป็น \"สถานี\" ที่นี่ (เช่น ประกอบ-01, แพ็ก-01) — กด \"แก้ไข\" เพื่อตั้งชื่อ/ประเภท เลือกขั้นตอนที่ทำได้ หรือลบเครื่อง ·": "A machine/station can do several operations · assembly/packing are set up as \"stations\" here (e.g. ASM-01, PACK-01) — press \"Edit\" to set the name/type, pick the operations it can do, or delete it ·",
  "ปุ่มลัด:": "Shortcut:",
  "กด \"แก้ไข\" ที่สเตชันแล้วติ๊กปุ่ม": "Press \"Edit\" on the station and tick the button",
  "(ถ้ายังไม่มีขั้นตอน ระบบสร้างให้ตอนบันทึก)": "(if the operation doesn't exist yet it's created on save)",
  "ชื่อขั้นตอน": "Operation name",
  "หน้าเครื่อง (ตัด/เจาะ/บาก…)": "Machine station (cut/drill/notch…)",
  "ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ": "Forgot your password? Contact the administrator",
  "1 โปรเจคสามารถมีได้หลาย Part และหลาย Release": "One project can have many parts and many releases",
  "กรอกหัวเอกสาร แล้ววางข้อมูล Part จาก Excel ลงตารางได้เลย (Ctrl+V)": "Fill in the header, then paste the part data from Excel into the table (Ctrl+V)",
  "หน้าต่างนี้ล็อกไว้ — คลิกนอกกรอบจะไม่ปิด กด \"ยกเลิก\" หรือ ✕ เพื่อออก": "This window is locked — clicking outside won't close it; press \"Cancel\" or ✕ to leave",
  "ชิ้น ·": "pcs ·",
  "สร้าง QR ต่อชิ้น": "Create a QR per piece",
  "เลือกโปรเจคก่อน แล้วจึงกรอก/วางข้อมูล Part — ระบบต้องรู้โปรเจคเพื่อแยก Part เดิม/ใหม่ให้ถูกต้อง": "Select the project first, then type/paste the parts — the system needs the project to tell existing parts from new ones",
  "(เบอร์เดียวกันคนละโปรเจค = คนละ Part คนละ Routing)": "(the same number in another project = a different part with its own routing)",
  "Ctrl+Z ย้อนกลับได้": "Ctrl+Z to undo",
  "เปิดสร้าง QR — จะได้ป้ายทุกชิ้นอัตโนมัติ": "Turn on QR — every piece gets a label automatically",
  "ขึ้นบนสุด": "Back to top",
  "เพิ่ม / นำเข้า เบอร์ประกอบ + แผง": "Add / import assembly numbers + panels",
  "ฟอร์มเดียวใช้ได้ทั้งคู่: ใส่ลูก = ตั้ง BOM + ปล่อยงาน (ซับ/แผง) · ไม่ใส่ลูก = ปล่อยงานเฉยๆ (เช่นแผง) · นำเข้า/วางจาก Excel ได้ทั้งฟอร์ม BOM และรายชื่อแผง — ระบบแยกให้เอง": "One form for both: with children = set BOM + release (sub/panel) · without children = release only (e.g. panels) · import/paste from Excel works for BOM forms and panel lists — the system tells them apart",
  "หรือก็อปตารางจาก Excel แล้ว": "or copy the table from Excel and",
  "หรือกรอกมือด้านล่าง · รวม": "or type below · total",
  "เบอร์ · ปล่อยงาน": "numbers · release",
  "ชิ้น (QR)": "pcs (QR)",
  "ชนิด #1": "Type #1",
  "ซับ (Sub)": "Sub",
  "แผง (Panel)": "Panel",
  "แพ็ก (Pack)": "Pack",
  "เบอร์แม่ (Code) *": "Parent no. (Code) *",
  "L (มม.)": "L (mm)",
  "จำนวนแม่ *": "Parent qty *",
  "＋ ใส่ลูก (ตั้ง BOM) — ไม่ใส่ = ปล่อยงานเฉยๆ": "＋ Add children (set BOM) — none = release only",
  "เพิ่มเบอร์แม่": "Add parent",
  "บันทึก + ปล่อยงาน": "Save + release",
  "เช่น P-076": "e.g. P-076",
  "⬇ วางตารางที่นี่ด้วย Ctrl+V — ก็อปจาก Excel รวมแถวหัว (Code / Quantity / Sum) · ได้ทั้งฟอร์ม BOM และรายชื่อแผง": "⬇ Paste the table here with Ctrl+V — copy from Excel including the header row (Code / Quantity / Sum) · works for BOM forms and panel lists",
  "เช่น SAAN04-001 / UA1501B": "e.g. SAAN04-001 / UA1501B",
  "ลบเบอร์แม่นี้": "Remove this parent",
  "นำเข้าฟอร์มบั้ง (Packing List)": "Import bundle form (Packing List)",
  "1 บั้ง = 1 แพ็ก (package + QR) · ยูนิตในบั้งจะตั้งเป็น BOM ให้อัตโนมัติ · ฟอร์มเต็ม (ตำแหน่ง/ขนาด/น้ำหนัก) เก็บไว้โชว์ที่หน้าแพ็ก — ไฟล์เดียวหลายบั้งได้": "1 bundle = 1 package (package + QR) · the units in a bundle become its BOM automatically · the full form (position/size/weight) is kept for the packing screen — one file can hold several bundles",
  "ชนิดการแพ็ก *": "Packing type *",
  "แพ็กแผง (panel)": "Pack panel (panel)",
  "แพ็กไซต์ไอเทม (site item)": "Pack site item (site item)",
  "หน่วยน้ำหนักในฟอร์ม": "Weight unit in the form",
  "ปอนด์ (Lbs) → แปลงเป็นกก.": "Pounds (Lbs) → converted to kg",
  "กิโลกรัม (kg)": "Kilograms (kg)",
  "หรือก็อปฟอร์มบั้งจาก Excel แล้ว": "or copy the bundle form from Excel and",
  "ยังไม่มีบั้ง — นำเข้าไฟล์ Excel หรือวางฟอร์มบั้งด้านบน": "No bundles yet — import an Excel file or paste a bundle form above",
  "บันทึก  + ปล่อยงาน": "Save + release",
  "เช่น P-100": "e.g. P-100",
  "⬇ วางฟอร์มบั้งที่นี่ด้วย Ctrl+V — ก็อปจาก Excel รวมหัว BUNK NO. + ตาราง Unit No/Position/Weight · หลายบั้งในครั้งเดียวได้": "⬇ Paste the bundle form here with Ctrl+V — copy from Excel including the BUNK NO. header + the Unit No/Position/Weight table · several bundles at once is fine",
  "จำนวนเบอร์แม่ (แพ็ก)": "Parent count (packing)",
  "รายการแพ็ก — เบอร์ลูกที่ใส่เข้าแต่ละเบอร์แม่": "Packing list — children fitted to each parent",
  "แต่ละแพ็กมีลูก/แผงอะไรบ้าง ยาวเท่าไร กี่ชิ้น": "What each package contains, their length and count",
  "เลือกตารางที่จะดาวน์โหลด": "Pick the tables to download",
  "ติ๊กเฉพาะตารางที่ต้องการ แล้วดาวน์โหลดเป็นไฟล์ Excel (.xlsx)": "Tick only the tables you need, then download as an Excel file (.xlsx)",
  "เลือกแล้ว": "Selected",
  "ตาราง": "tables",
  "สรุปตามขั้นตอน": "Summary by operation",
  "เครื่องจักรxขั้นตอน": "Machine × operation",
  "Cycle-time วินาทีต่อชิ้น": "Cycle time (sec per piece)",
  "รายวันต่อเครื่อง": "Daily per machine",
  "ไปบนสุด": "Back to top",
  "เช่น 1.845": "e.g. 1.845",
  "เช่น 6000": "e.g. 6000",
  "ขั้นตอนการทำงาน (machining / ประกอบ / แพ็ก)": "Operations (machining / assembly / packing)",
  "งานเครื่อง": "Machining",
  "= ตัด/เจาะ/บาก (สแกนต่อชิ้นปกติ) ·": "= cut/drill/notch (normal per-piece scanning) ·",
  "ประกอบ/แพ็ก": "Assembly/packing",
  "= หน้าเครื่องสลับเป็นโหมดประกอบ (สแกนลูกเข้าเบอร์แม่ตาม BOM) — ตั้งประเภทที่นี่แทนการรัน SQL": "= the station switches to assembly mode (scan children into the parent per BOM) — set the type here instead of running SQL",
  "สำคัญ: \"แผนก/หน้าปลายทาง\" มาจาก \"ประเภทงาน\" ของขั้นตอน ไม่ใช่ชื่อสเตชัน": "Important: the \"department / landing page\" comes from the operation's \"work type\", not the station name",
  "— ดูคอลัมน์": "— see the column",
  "หน้าปลายทาง": "Landing page",
  "ด้านล่าง": "below",
  "• อยากแยกแพ็กเป็น 2 หน้า ต้องมี": "• To split packing into 2 pages you need",
  "2 ขั้นตอนคนละประเภท": "2 operations of different types",
  "(→ /packing-panel) และ": "(→ /packing-panel) and",
  "(→ /packing-site) แล้วตั้งให้สเตชันละอัน · ประเภท": "(→ /packing-site), one per station · the type",
  "แพ็ก · รวมทุกบั้ง": "Packing · all bundles",
  "(→ /packing) เห็นทุกบั้ง ไม่แยก": "(→ /packing) shows every bundle, not split",
  "• ถ้าหลายสเตชันใช้ขั้นตอนประเภทเดียวกัน จะเข้า": "• If several stations use operations of the same type they land on",
  "หน้าเดียวกัน": "the same page",
  "(ไม่แยกกัน)": "(not split)",
  "Glazing/ติดกระจก": "Glazing",
  ": เลือก": ": choose",
  "ถ้าเบอร์แม่ที่กระจกไปติดเป็นชนิด \"แผง\" · เลือก": "if the parent the glass goes into is a \"panel\" · choose",
  "ประกอบ · ซับ": "Assembly · sub",
  "ถ้าเป็นชนิด \"ซับ\" — ทั้งสองแบบ": "if it's a \"sub\" — either way",
  "ใส่ part ที่ไม่ใช่กระจกได้อยู่แล้ว": "non-glass parts can still be added",
  "(ไม่บล็อก)": "(not blocked)",
  "หน้าปลายทาง (แผนก/URL)": "Landing page (department/URL)",
  "เช่น ตัด / ประกอบ / แพ็ก": "e.g. Cut / Assemble / Pack",
  "เพิ่ม Part ใหม่": "Add a new part",
  "น้ำหนักโดยประมาณ/ชิ้น (กก.)": "Approx. weight/pc (kg)",
  "ความยาวโดยประมาณ/ชิ้น (มม.)": "Approx. length/pc (mm)",
  ": พาร์ท = ชิ้นส่วนปกติ · ซับ/แผง/แพ็ก = เบอร์ประกอบ (ประกอบจากลูก) — เลือกเป็นเบอร์ประกอบแล้วจะกำหนด BOM ได้ในตารางด้านล่าง": ": part = normal piece · sub/panel/pack = assembly number (built from children) — choose an assembly type to set its BOM in the table below",
  "ทุกโปรเจค (": "All projects (",
  "แสดง": "Show",
  "จาก": "of",
  "ค้นหา Part No. / ชื่อ / INV": "Search Part No. / name / INV",
  "ผู้ใช้ที่กำลังใช้งาน (เฉพาะ Admin)": "Active users (admin only)",
  "รายชื่อบัญชีที่ยัง “ถือเซสชันอยู่” (ยังไม่หมดอายุ/ยังไม่ถูกตัด) · จุดเขียว = กำลังออนไลน์ (มีสัญญาณใน 3 นาที) · กด": "Accounts still \"holding a session\" (not expired / not cut) · green dot = online (signal within 3 min) · press",
  "บังคับออกจากระบบ": "Force log out",
  "เพื่อเตะเครื่องนั้น — เครื่องนั้นจะซิงค์งานค้างให้เสร็จก่อนแล้วเด้งออกเอง": "to kick that device — it syncs its pending work first and then logs itself out",
  "(ข้อมูลไม่หาย)": "(no data lost)",
  "ยังไม่มีใครล็อกอินอยู่": "Nobody is logged in",
  "เมื่อมีเครื่อง/บัญชีเข้าใช้งาน จะแสดงที่นี่": "Devices/accounts appear here when they're in use",
  "งานค้างซิงค์ (stranded) — เฉพาะ Admin": "Stranded sync items — admin only",
  "งานที่ทำหน้าเครื่อง (ตอนออฟไลน์) แล้ว": "Work done at a station (while offline) that",
  "ซิงค์เข้าระบบไม่ได้ถาวร": "can never be synced",
  "— มักเพราะ QR/ล็อตถูกลบหรือแก้ฝั่งออฟฟิศ · แก้ต้นเหตุ (เช่นกู้ล็อตคืน) แล้วให้เครื่องนั้นกด “ลองซิงค์ใหม่” ในแถบงานค้าง · เคลียร์แล้วกด ✓ จัดการแล้ว": "— usually because the QR/lot was deleted or edited in the office · fix the cause (e.g. restore the lot), then have that station press \"Retry sync\" in its pending bar · when cleared press ✓ Resolved",
  "ไม่มีงานค้างซิงค์": "No stranded items",
  "ทุกเครื่องซิงค์งานเข้าระบบครบ": "Every station has synced its work",
  "ประวัติการแก้ไข (เฉพาะ Admin)": "Audit log (admin only)",
  "บันทึกการกระทำสำคัญ/ที่ลบข้อมูลได้ — ใครทำ อะไร เมื่อไหร่ (ลบโปรเจค/Release, ล้างสแกน, บังคับออกจากระบบ, แก้หัวเอกสาร, ปิด/เปิดโปรเจค, กู้คืน)": "Important/destructive actions — who did what and when (deleting projects/releases, clearing scans, forced logouts, editing headers, closing/reopening projects, restores)",
  "ยังไม่มีประวัติ": "No history yet",
  "เมื่อมีการลบ/แก้/กู้คืนข้อมูลสำคัญ จะบันทึกที่นี่": "Deletes/edits/restores of important data are recorded here",
  "ระบบเก็บ": "The system keeps",
  "สแนปช็อตอัตโนมัติทุกวัน (เที่ยงคืน)": "an automatic daily snapshot (midnight)",
  "แยกตามโปรเจค เก็บย้อนหลัง 7 วัน — admin กดกู้คืนได้เองในแอป โดยเลือกได้ว่าจะ": "per project for 7 days — an admin can restore it in the app, choosing to",
  "กู้เฉพาะที่หายไป": "restore only what's missing",
  "(งานสแกนใหม่ยังอยู่) หรือ": "(new scans are kept) or",
  "ย้อนทั้งโปรเจค": "roll the whole project back",
  "กลับไปวันนั้น": "to that day",
  "กด “สร้างจุดกู้คืนตอนนี้” เพื่อสำรองครั้งแรก": "Press \"Create a restore point now\" for the first backup",
  "กดปุ่มด้านล่างเพื่อดึงข้อมูล": "Press the button below to pull",
  "ทุกตารางหลัก": "every main table",
  "(โปรเจค · Part · Release · QR · ประวัติสแกน · งานหน้าเครื่อง · พนักงาน ฯลฯ) ออกมาเป็นไฟล์": "(projects · parts · releases · QR · scan history · station work · employees etc.) into",
  "ไฟล์เดียว เก็บไว้ในเครื่อง/ไดรฟ์ของคุณเองได้ เป็นการสำรองอีกชั้นนอกเหนือจากแบ็คอัพอัตโนมัติของฐานข้อมูล": "one file you can keep on your own computer/drive — an extra layer besides the database's automatic backups",
  "แนะนำ:": "Recommended:",
  "เวลาทำงาน 8:00–17:00 น. — ควรดาวน์โหลดสำรอง": "working hours 8:00–17:00 — download a backup",
  "ช่วงหลังเลิกงาน (~18:00–21:00)": "after work (~18:00–21:00)",
  "ของทุกวันทำงาน เพราะข้อมูลของวันนั้นครบและนิ่งแล้ว · และควรกดสำรองเพิ่มก่อนนำเข้า Excel ชุดใหญ่ หรือก่อนลบโปรเจค/Release": "every working day, when that day's data is complete and settled · and back up again before a big Excel import or before deleting a project/release",
  "เลือกไฟล์": "Pick a file",
  "ที่เคยดาวน์โหลดไว้ เพื่อนำข้อมูลกลับเข้าระบบ — ระบบจะ": "you downloaded before to bring data back — the system will",
  "เติมเฉพาะข้อมูลที่หายไป": "only add what's missing",
  "(id ที่ยังไม่มี)": "(ids that don't exist)",
  "ไม่ทับของเดิมและงานที่ทำใหม่": "without overwriting existing data or new work",
  "เหมาะกับกรณีเผลอลบข้อมูลแล้วอยากได้กลับมา": "for when data was deleted by mistake and you want it back",
  "ลบเฉพาะ “ข้อมูลการสแกน/บันทึกงาน” ของขอบเขตที่เลือก แล้วรีเซ็ตสถานะชิ้นงานกลับเป็น “ยังไม่ทำ” — โปรเจค / Release / Part / QR ยังอยู่ครบ ·": "Deletes only the \"scan / work records\" of the chosen scope and resets the pieces back to \"not started\" — projects / releases / parts / QR stay ·",
  "ลบแล้วกู้คืนไม่ได้": "cannot be undone",
  "แนะนำสำรองข้อมูลก่อน": "back up first",
  "พิมพ์ชื่อ/รหัสโปรเจคเพื่อค้นหา…": "Type a project name/code to search…",
  "เปลี่ยนรหัสผ่านของบัญชีคุณเอง": "Change the password of your own account",
  "รหัสผ่านเดิม": "Current password",
  "รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)": "New password (at least 4 characters)",
  "ยืนยันรหัสผ่านใหม่": "Confirm new password",
  "ไฟดับ / ไฟตก": "Power outage",
  "บำรุงรักษา (PM)": "Maintenance (PM)",
  "อื่นๆ": "Other",
  "ปั้มลมมีปัญหา": "Air pump problem",
  "เครื่องเดินไม่เต็มที่ / รวน": "Machine unstable",
  "ดอก/ใบมีดสึก": "Tool worn",
  "วัตถุดิบไม่ได้ขนาด/มีตำหนิ": "Material off-spec",
  "แบบ/ดรออิงไม่ชัด": "Drawing unclear",
  "งานยาก/ซับซ้อนกว่าปกติ": "Harder job than usual",
  "พักงาน": "Break",
  // รอบ 16: ปุ่มรวมบนมือถือ / ตัวกรอง / ปุ่มในแถว
  "+ เพิ่ม / นำเข้า": "+ Add / Import", "+ เพิ่ม": "+ Add", "ตัวกรอง": "Filters",
  "ลบ Release Order นี้ทั้งชุด": "Delete this whole Release Order",
  "สเตชันนี้จะเข้า:": "This station opens:", "INV Code / วัสดุ": "INV Code / material",
  "น้ำหนัก/ความยาวของเบอร์ = ค่าเริ่มต้น · Release ที่ตั้งน้ำหนักเองไว้ ใช้ค่าของ Release ก่อน (แก้ที่ ✎ แก้ไข ในหน้า Release)":
    "Part weight/length = the default · a release with its own weight uses that first (change it with ✎ Edit on the Release page)",
  "ตั้งเครื่อง/สถานี/ขั้นตอนประจำที่นี่ — หน้าสแกนจะใช้ค่านี้แทนการเลือกเอง": "Set the home machine/station/operation here — the scan screen uses it instead of asking",
  "* ถ้าไม่ตั้งเครื่อง/สถานี/ขั้นตอนประจำ พนักงานคนนี้จะสแกนงานไม่ได้": "* without a home machine/station/operation this employee can't scan work",
};

// ── กฎ regex สำหรับข้อความที่มีตัวเลข/ตัวแปรแทรก (node เดียว) ─────────────────
const RULES = [
  // ── รอบ 16 (หน้าต่างแก้ไขที่เปิดจากปุ่มในแถว) ──
  [/^แก้ไข Part (.+)$/, (m) => `Edit Part ${m[1]}`],
  [/^โปรเจค ([A-Za-z0-9][\w.\-/]*)$/, (m) => `Project ${m[1]}`],
  // ── รอบ 13 ──
  [/^([\d.,]+)\s*วิ$/, (m) => `${m[1]} s`],
  [/^([\d,]+)\s*แถว$/, (m) => `${m[1]} rows`],
  [/^Release ทั้งหมด\s*\((.+)\)$/, (m) => `All releases (${m[1]})`],
  [/^บันทึก \+ QR \((.+)\)$/, (m) => `Save + QR (${m[1]})`],
  [/^ดาวน์โหลด Excel \((.+)\)$/, (m) => `Download Excel (${m[1]})`],
  [/^โหลดไม่สำเร็จ:\s*(.+)$/, (m) => `Load failed: ${m[1]}`],
  [/^โหลดรายชื่อไม่สำเร็จ:\s*(.+)$/, (m) => `Couldn't load the list: ${m[1]}`],
  [/^ผิดพลาด:\s*(.+)$/, (m) => `Error: ${m[1]}`],
  [/^โหลดจุดกู้คืนไม่สำเร็จ — ตรวจว่ารัน (.+?) ใน Supabase แล้วหรือยัง \((.+)\)$/, (m) => `Couldn't load restore points — check that ${m[1]} was run in Supabase (${m[2]})`],
  [/^(.+?):\s*(\d+ min · \d+×)$/, (m) => (DICT[m[1]] != null ? `${DICT[m[1]]}: ${m[2]}` : null)],
  [/^ทั้งหมด\s+(.+?)\s+ชิ้น$/, (m) => `Total ${m[1]} pcs`],
  [/^รวม\s+(.+?)\s+ชิ้น$/, (m) => `Total ${m[1]} pcs`],
  [/^(.+?)\s+ชิ้น$/, (m) => `${m[1]} pcs`],
  [/^(.+?)\s+พาร์ท$/, (m) => `${m[1]} parts`],
  [/^(.+?)\s+Part$/, (m) => `${m[1]} parts`],
  [/^(.+?)\s+ใบ$/, (m) => `${m[1]} labels`],
  [/^(.+?)\s+กก\.$/, (m) => `${m[1]} kg`],
  [/^(.+?)\s+มม\.$/, (m) => `${m[1]} mm`],
  [/^(.+?)\s+เครื่อง$/, (m) => `${m[1]} machines`],
  [/^(\d+)\s*ชม\.\s*(\d+)\s*น\.$/, (m) => `${m[1]} h ${m[2]} min`],   // เวลาเดินเครื่อง 2 ชม. 05 น.
  [/^(\d+)\s*น\.$/, (m) => `${m[1]} min`],
  [/^เลือก\s+(.+)$/, (m) => `Selected ${m[1]}`],
  [/^Part\s*\((\d[\d,]*)\)$/, (m) => `Part (${m[1]})`],
  [/^Release\s*\((\d[\d,]*)\)$/, (m) => `Release (${m[1]})`],
  [/^โปรเจคทั้งหมด\s*\((.+)\)$/, (m) => `All projects (${m[1]})`],
  [/^ป้ายที่จะพิมพ์\s*\((.+)\)$/, (m) => `Labels to print (${m[1]})`],
  [/^ชิ้นงานในล็อตนี้\s*\((.+)\)$/, (m) => `Pieces in this lot (${m[1]})`],
  [/^ความคืบหน้า\s*—\s*(.+)$/, (m) => `Progress — ${m[1]}`],
  [/^ความสามารถของเครื่อง\s*—\s*(.+)$/, (m) => `Machine capabilities — ${m[1]}`],
  [/^แก้ไขพนักงาน\s*—\s*(.+)$/, (m) => `Edit employee — ${m[1]}`],
  [/^แก้ไขเครื่อง\/สถานี\s*—\s*(.+)$/, (m) => `Edit machine/station — ${m[1]}`],
  [/^หมายเหตุทั้งหมด:\s*(.+)$/, (m) => `All remarks: ${m[1]}`],
  [/^ทั้งหมด\s+(.+)$/, (m) => `all ${m[1]}`],
  [/^⚠\s*ชิ้นนี้เคยทำขั้นตอนนี้แล้ว\s+(\d+)\s*ครั้ง$/, (m) => `⚠ This piece already ran this step ${m[1]}×`],
  [/^ลบข้อมูลสแกน\s*\((\d[\d,]*)\s*รายการ\)$/, (m) => `Clear scan data (${m[1]} items)`],
  [/^กำลังตรวจ\s+(\d+\/\d+)$/, (m) => `Checking ${m[1]}`],
  [/^กำลังลบ\s+(\d+\/\d+)$/, (m) => `Deleting ${m[1]}`],
];

function toEN(trimmed) {
  if (DICT[trimmed] != null) return DICT[trimmed];
  for (const [re, fn] of RULES) { const m = trimmed.match(re); if (m) return fn(m); }
  return null;
}

// ── เครื่องมือแปล DOM ────────────────────────────────────────────────────────
let LANG = "th";
try { LANG = localStorage.getItem("mls-lang") === "en" ? "en" : "th"; } catch { /* ignore */ }
const listeners = new Set();
const origText = new Map();   // textNode -> ไทยต้นฉบับ
const origAttr = new Map();   // el -> { placeholder?, title? }
const touched = new Set();    // node/el ที่แปลไปแล้ว (ไว้ restore ตอนกลับเป็นไทย)
let observer = null;
let busy = false;             // กัน observer วนซ้ำระหว่างที่เราแก้เอง

function translateTextNode(n) {
  const raw = n.nodeValue; if (!raw) return;
  const trimmed = raw.trim();
  if (!trimmed || !THAI.test(trimmed)) return;   // ไม่มีไทย = ข้าม (แปลแล้ว/ตัวเลข)
  const en = toEN(trimmed); if (en == null) return;
  if (!origText.has(n)) { origText.set(n, raw); touched.add(n); }
  const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
  n.nodeValue = lead + en + trail;
}
function translateAttrs(el) {
  for (const a of ["placeholder", "title", "aria-label"]) {   // ★ รอบ 13: + aria-label (โปรแกรมอ่านหน้าจอ)
    const v = el.getAttribute && el.getAttribute(a);
    if (!v || !THAI.test(v)) continue;
    const en = toEN(v.trim()); if (en == null) continue;
    const cur = origAttr.get(el) || {};
    if (cur[a] == null) { cur[a] = v; origAttr.set(el, cur); touched.add(el); }
    el.setAttribute(a, en);
  }
}
function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { translateTextNode(root); return; }
  if (root.nodeType !== 1) return;
  translateAttrs(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let n; while ((n = tw.nextNode())) translateTextNode(n);
  root.querySelectorAll && root.querySelectorAll("[placeholder],[title],[aria-label]").forEach(translateAttrs);
}
function restoreAll() {
  for (const node of touched) {
    if (node.nodeType === 3) { if (origText.has(node)) node.nodeValue = origText.get(node); }
    else { const a = origAttr.get(node); if (a) { for (const k in a) node.setAttribute(k, a[k]); } }
  }
  origText.clear(); origAttr.clear(); touched.clear();
}
function applyLang() {
  busy = true;
  try {
    if (LANG === "en") walk(document.body);
    else restoreAll();
  } finally { busy = false; }
}
function ensureObserver() {
  if (observer) return;
  observer = new MutationObserver((muts) => {
    if (busy || LANG !== "en") return;
    busy = true;
    try {
      for (const m of muts) {
        if (m.type === "characterData") translateTextNode(m.target);
        else m.addedNodes && m.addedNodes.forEach((nd) => walk(nd));
      }
    } finally { busy = false; }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function setLang(l) {
  LANG = l === "en" ? "en" : "th";
  try { localStorage.setItem("mls-lang", LANG); } catch { /* ignore */ }
  applyLang();
  listeners.forEach((f) => { try { f(LANG); } catch { /* ignore */ } });
}
export function getLang() { return LANG; }

// เริ่มทำงานเมื่อ DOM พร้อม (เรียกจาก App.jsx ด้วยการ import)
if (typeof window !== "undefined") {
  const boot = () => { ensureObserver(); if (LANG === "en") applyLang(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
}

// React hook สำหรับปุ่มสลับ
export function useLang() {
  const [l, setL] = useState(LANG);
  useEffect(() => { listeners.add(setL); return () => listeners.delete(setL); }, []);
  return [l, setLang];
}
