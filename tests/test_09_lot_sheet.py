"""TC-LOT — ใบปล่อย (PRODUCTION ORDER) ของล็อต: ลำดับใบ · ใบวัตถุดิบต่อท้ายใบงาน · วันที่ในหัวใบ

ที่มาของผลที่คาด
- ผู้ใช้ 24/11/2026: "mat ต้องมาต่อแต่ละงานเลย ไม่ว่าจะเป็น MACHINING PART หรือ Bending" → ใบวัตถุดิบของแต่ละใบงานอยู่ถัดจากใบงานนั้นทันที
- ผู้ใช้ 24/11/2026: "วันที่ต้องตรงกัน" (ใบปะหน้า Date 03/11/2026 · หัวใบงาน Print date 24/11/2026) → ทั้งสองใบใช้วันที่ปล่อยล็อต
- วัตถุดิบงานตัดคิดเป็นจำนวนเส้น (ของเดิม) · งานพับ / เหล็กรวมตามรหัสวัตถุดิบ บอกจำนวนเบอร์ / จำนวนชิ้น (ของเดิมในใบปะหน้า)
"""
import pytest

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression

BOM = {
    "panels": {},
    "subs": {},
    "parts": {
        "MAT550-5001 A": {"d": "MULLION", "l": 2500, "m": "AL01500A", "k": "part"},
        "MAT550-5002 A": {"d": "TRANSOM", "l": 1200, "m": "AL01500A", "k": "part"},
        "BD01-001": {"d": "FLASHING", "l": 300, "m": "SH-2.0-AL", "k": "part"},
        "BD01-002": {"d": "FLASHING", "l": 320, "m": "SH-2.0-AL", "k": "part"},
        "BD01-003": {"d": "COVER", "l": 500, "m": "SH-3.0-GI", "k": "part"},
        "ST01-001": {"d": "BRACKET", "l": 200, "m": "ST-FB-50", "k": "part"},
    },
}
PLAN = {"ro": "P-005", "projectCode": "Z90001-US", "by": "ผู้ทดสอบ", "units": [], "bom": BOM, "picks": {}, "extra": {}}
NEED_PARTS = [
    {"code": "MAT550-5001 A", "qty": 2, "d": "MULLION", "l": 2500, "inv": "AL01500A", "dest": "CUTTING"},
    {"code": "MAT550-5002 A", "qty": 2, "d": "TRANSOM", "l": 1200, "inv": "AL01500A", "dest": "CUTTING"},
    {"code": "BD01-001", "qty": 4, "d": "FLASHING", "l": 300, "inv": "SH-2.0-AL", "dest": "BENDING"},
    {"code": "BD01-002", "qty": 6, "d": "FLASHING", "l": 320, "inv": "SH-2.0-AL", "dest": "BENDING"},
    {"code": "BD01-003", "qty": 1, "d": "COVER", "l": 500, "inv": "SH-3.0-GI", "dest": "BENDING"},
    {"code": "ST01-001", "qty": 3, "d": "BRACKET", "l": 200, "inv": "ST-FB-50", "dest": "STEEL"},
]
NEED = {"parts": NEED_PARTS, "subs": [], "panels": [], "glass": [], "hw": [], "other": []}


def row(code, qty, sheet, **k):
    return {"code": code, "qty": qty, "kind": "part", "note": f"ใบ: {sheet}", **k}


ROWS = [row("MAT550-5001 A", 2, "MACHINING PART"), row("MAT550-5002 A", 2, "MACHINING PART"),
        row("BD01-001", 4, "BENDING PART"), row("BD01-002", 6, "BENDING PART"), row("BD01-003", 1, "BENDING PART"),
        row("ST01-001", 3, "STEEL PART")]


def model(js, rows=ROWS, date="2026-11-03", **kw):
    lot = {"no": "P-005", "date": date, "rows": rows}
    return js("buildLotModel", {"plan": PLAN, "need": NEED, "lot": lot, "userName": "ผู้ทดสอบ", **kw}, m="lot")


@P
def test_material_sheet_follows_each_job(js):
    """TC-LOT-001 ลำดับใบ: MACHINING → วัตถุดิบงานตัด → BENDING → วัตถุดิบงานพับ → STEEL → วัตถุดิบงานเหล็ก"""
    assert [s["key"] for s in model(js)["sheets"]] == ["CUTTING", "MAT", "BENDING", "MAT-BENDING", "STEEL", "MAT-STEEL"]


@P
def test_bending_material_rows(js):
    """TC-LOT-002 วัตถุดิบงานพับ: รวมตามรหัสวัตถุดิบ → จำนวนเบอร์ / ชิ้น + เบอร์ที่ใช้ · ช่องเบิกจริงเว้นว่าง"""
    sh = next(s for s in model(js)["sheets"] if s["key"] == "MAT-BENDING")
    assert [c["en"] for c in sh["cols"]] == ["NO.", "MATERIAL CODE", "PARTS / PCS", "PART CODES", "ACTUAL ISSUE", "REMARK"]
    assert [r["vals"][:5] for r in sh["rows"]] == [[1, "SH-2.0-AL", "2 / 10", "BD01-001, BD01-002", ""], [2, "SH-3.0-GI", "1 / 1", "BD01-003", ""]]
    assert sh["kind"] == "mat" and sh["line2"] == "(ISSUE MATERIAL)" and sh["t1"] == "MATERIAL LIST FOR BENDING"


@P
def test_steel_material_rows(js):
    """TC-LOT-003 วัตถุดิบงานเหล็ก: 1 รหัส 1 เบอร์ 3 ชิ้น"""
    sh = next(s for s in model(js)["sheets"] if s["key"] == "MAT-STEEL")
    assert [r["vals"][1:4] for r in sh["rows"]] == [["ST-FB-50", "1 / 3", "ST01-001"]]


@P
def test_cutting_material_is_unchanged_but_moved(js):
    """TC-LOT-004 วัตถุดิบงานตัด: เนื้อหาเดิม (คิดเป็นเส้นต่อรหัสวัตถุดิบ) แต่อยู่ถัดจากใบ MACHINING PART"""
    m = model(js)
    sh = m["sheets"][1]
    assert sh["key"] == "MAT" and [r["vals"][1] for r in sh["rows"]] == ["AL01500A"] and sh["rows"][0]["vals"][4] == "2 / 4"


@B
def test_only_machining_job(js):
    """TC-LOT-005 ล็อตมีแต่งานตัด → 2 ใบ (ใบงาน + วัตถุดิบ) ไม่มีใบวัตถุดิบของงานอื่น"""
    assert [s["key"] for s in model(js, rows=ROWS[:2])["sheets"]] == ["CUTTING", "MAT"]


@B
def test_only_bending_job(js):
    """TC-LOT-006 ล็อตมีแต่งานพับ → ใบงานพับ + วัตถุดิบงานพับ"""
    assert [s["key"] for s in model(js, rows=ROWS[2:5])["sheets"]] == ["BENDING", "MAT-BENDING"]


@N
def test_cancelled_rows_not_in_job_material(js):
    """TC-LOT-007 แถวที่ยกเลิก / จำนวน 0 ไม่ถูกนับในวัตถุดิบของใบงาน · ยกเลิกทั้งใบ = ไม่มีใบวัตถุดิบ"""
    rows = [row("BD01-001", 4, "BENDING PART"), row("BD01-002", 6, "BENDING PART", mod_cancelled_at="2026-11-10"), row("BD01-003", 0, "BENDING PART")]
    sh = next(s for s in model(js, rows=rows)["sheets"] if s["key"] == "MAT-BENDING")
    assert [r["vals"][1:4] for r in sh["rows"]] == [["SH-2.0-AL", "1 / 4", "BD01-001"]]
    all_cancelled = [row("BD01-001", 4, "BENDING PART", mod_cancelled_at="2026-11-10")]
    assert [s["key"] for s in model(js, rows=all_cancelled)["sheets"]] == ["BENDING"]


@B
def test_part_without_material_code(js):
    """TC-LOT-008 พาร์ทที่ไม่มีรหัสวัตถุดิบ → รวมไว้แถว "(ไม่มี INV)" ไม่หายไป"""
    rows = [row("BD-NOINV", 2, "BENDING PART")]
    sh = next(s for s in model(js, rows=rows)["sheets"] if s["key"] == "MAT-BENDING")
    assert [r["vals"][1:4] for r in sh["rows"]] == [["(ไม่มี INV)", "1 / 2", "BD-NOINV"]]


@R
def test_only_filter_keeps_order(js):
    """TC-LOT-009 เลือกพิมพ์เฉพาะบางใบ (only) → ได้เฉพาะใบที่เลือก ตามลำดับเดิม · รายการใบทั้งหมด (all) ยังครบ"""
    m = model(js, only=["MAT-BENDING", "CUTTING"])
    assert [s["key"] for s in m["sheets"]] == ["CUTTING", "MAT-BENDING"]
    assert [a["key"] for a in m["all"]] == ["CUTTING", "MAT", "BENDING", "MAT-BENDING", "STEEL", "MAT-STEEL"]


@R
def test_header_date_is_lot_date_same_as_cover(js):
    """TC-LOT-010 วันที่ในหัวใบงาน = วันที่ปล่อยล็อต = วันที่ในใบปะหน้า (ไม่ขึ้นกับวันที่เปิดดู / พิมพ์)"""
    m = model(js, date="2026-11-03")
    assert m["meta"]["date"] == "03/11/2026"
    covers = [s["cover"]["date"] for s in m["sheets"] if s.get("cover")]
    assert covers and all(d == "03/11/2026" for d in covers)


@B
@pytest.mark.parametrize("tid,date", [("TC-LOT-011", ""), ("TC-LOT-012", None), ("TC-LOT-013", "ไม่ใช่วันที่")])
def test_header_date_falls_back_but_still_matches_cover(js, tid, date):
    """ล็อตไม่มีวันที่ / วันที่อ่านไม่ได้ → ใช้วันที่พิมพ์ทั้งสองใบ (ยังตรงกัน)"""
    m = model(js, date=date)
    assert m["meta"]["date"] and len(m["meta"]["date"]) == 10, tid
    assert all(s["cover"]["date"] == m["meta"]["date"] for s in m["sheets"] if s.get("cover")), tid


@B
def test_header_date_timestamp_form(js):
    """TC-LOT-014 วันที่ล็อตแบบมีเวลา (2026-11-03T08:15:00+07:00) → 03/11/2026"""
    assert model(js, date="2026-11-03T08:15:00+07:00")["meta"]["date"] == "03/11/2026"
