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
  "โปรเจค": "Projects", "เครื่องจักร": "Machine", "หน้าเครื่อง": "Machine terminal", "มือถือ": "Mobile",
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
  "ลบ Part นี้": "Delete this Part", "ลบ Release นี้": "Delete this Release",
  "สำรองข้อมูล": "Backup", "สำรองข้อมูล (ดาวน์โหลดเก็บเอง)": "Backup (download your own copy)",
  "ดาวน์โหลดไฟล์สำรองข้อมูล (JSON)": "Download backup file (JSON)",
  "ตารางที่รวมอยู่ในไฟล์สำรอง": "Tables included in the backup",
  "กำลังเตรียมข้อมูล...": "Preparing data…",
  "จุดกู้คืนในแอป (ย้อนหลัง 30 วัน)": "In-app restore points (last 30 days)",
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
  "เครื่องจักรประจำ": "Assigned machine", "ขั้นตอนประจำ": "Assigned operation",
  "เครื่องจักรประจำ *": "Assigned machine *", "ขั้นตอนประจำ *": "Assigned operation *",
  "รหัสเครื่อง": "Machine code", "ชื่อเครื่องจักร": "Machine name", "รหัสพนักงาน": "Employee code",
  "ขั้นตอนที่ทำได้": "Operations", "ขั้นตอนที่เครื่องนี้ทำได้": "Operations this machine can do",
  "ไม่จำกัด (ยังไม่ตั้ง)": "Unlimited (not set)", "ประเภทงาน": "Work type",
  "เพิ่มพนักงาน": "Add employee", "เพิ่มพนักงานใหม่": "Add new employee", "เพิ่มเครื่องจักรใหม่ + ตั้งความสามารถ": "Add machine + capabilities",
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
  "ผู้ดูแลระบบ (Admin)": "Administrator", "หัวหน้างาน": "Supervisor", "พนักงาน": "Operator",
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
  "ล็อกอินด้วยบัญชีของเครื่องจักรนี้ (บัญชีที่ผูกเครื่องไว้)": "Sign in with this machine's account (the account bound to it)",
  "รหัสเครื่อง / พนักงาน": "Machine / employee code",
  "จอนี้สำหรับติดหน้าเครื่องจักร (แนวนอน)": "This screen mounts on the machine (landscape)",
  "ไปหน้าปกติ (สำนักงาน) →": "Go to the normal (office) page →",
  "เช่น CT-001": "e.g. CT-001",
  "รหัสเครื่อง/พนักงาน หรือรหัสผ่านไม่ถูกต้อง": "Machine/employee code or password is incorrect",
  "บัญชีนี้ยังไม่เคยล็อกอินในเครื่องนี้ — ต้องล็อกอินตอนมีเน็ต 1 ครั้งก่อน แล้วครั้งต่อไปจะออฟไลน์ได้":
    "This account hasn't signed in on this device yet — sign in once while online, then it can work offline next time",
  "บัญชีนี้ถูกใช้ล็อกอินที่เครื่องอื่น — กรุณาเข้าสู่ระบบใหม่": "This account was signed in on another device — please sign in again",
  // — บัญชีไม่ได้ผูกเครื่อง —
  "บัญชีนี้ยังไม่ได้ผูกเครื่องจักร": "This account isn't bound to a machine",
  "หน้าเครื่องต้องใช้บัญชีที่กำหนด \"เครื่องจักรประจำ\" ไว้ที่ Setup → พนักงาน":
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
};

// ── กฎ regex สำหรับข้อความที่มีตัวเลข/ตัวแปรแทรก (node เดียว) ─────────────────
const RULES = [
  [/^ทั้งหมด\s+(.+?)\s+ชิ้น$/, (m) => `Total ${m[1]} pcs`],
  [/^รวม\s+(.+?)\s+ชิ้น$/, (m) => `Total ${m[1]} pcs`],
  [/^(.+?)\s+ชิ้น$/, (m) => `${m[1]} pcs`],
  [/^(.+?)\s+พาร์ท$/, (m) => `${m[1]} parts`],
  [/^(.+?)\s+Part$/, (m) => `${m[1]} parts`],
  [/^(.+?)\s+ใบ$/, (m) => `${m[1]} labels`],
  [/^(.+?)\s+กก\.$/, (m) => `${m[1]} kg`],
  [/^(.+?)\s+มม\.$/, (m) => `${m[1]} mm`],
  [/^(.+?)\s+เครื่อง$/, (m) => `${m[1]} machines`],
  [/^เลือก\s+(.+)$/, (m) => `Selected ${m[1]}`],
  [/^Part\s*\((\d[\d,]*)\)$/, (m) => `Part (${m[1]})`],
  [/^Release\s*\((\d[\d,]*)\)$/, (m) => `Release (${m[1]})`],
  [/^โปรเจคทั้งหมด\s*\((.+)\)$/, (m) => `All projects (${m[1]})`],
  [/^ป้ายที่จะพิมพ์\s*\((.+)\)$/, (m) => `Labels to print (${m[1]})`],
  [/^ชิ้นงานในล็อตนี้\s*\((.+)\)$/, (m) => `Pieces in this lot (${m[1]})`],
  [/^ความคืบหน้า\s*—\s*(.+)$/, (m) => `Progress — ${m[1]}`],
  [/^ความสามารถของเครื่อง\s*—\s*(.+)$/, (m) => `Machine capabilities — ${m[1]}`],
  [/^แก้ไขพนักงาน\s*—\s*(.+)$/, (m) => `Edit employee — ${m[1]}`],
  [/^หมายเหตุทั้งหมด:\s*(.+)$/, (m) => `All remarks: ${m[1]}`],
  [/^ทั้งหมด\s+(.+)$/, (m) => `all ${m[1]}`],
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
  for (const a of ["placeholder", "title"]) {
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
  root.querySelectorAll && root.querySelectorAll("[placeholder],[title]").forEach(translateAttrs);
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
