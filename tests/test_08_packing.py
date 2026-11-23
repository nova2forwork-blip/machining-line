"""TC-PACK — ตารางแพ็กกิ้ง: อ่านใบแพ็ก (Excel / PDF) · รวมกับตารางเดิม · หาสิ่งที่เปลี่ยน · ตรวจก่อนบันทึก · บันทึกปกติ / Modify

ที่มาของผลที่คาด
- ผู้ใช้ 23/11/2026: "ให้ลงข้อมูลคล้าย ๆ ปล่อยงาน แต่เป็น packing ให้ลงไฟล์ pdf หรือ excel แล้วจะได้ตารางแพ็กกิ้งมา ให้แก้ตารางได้
  แล้วเลือกว่าจะแก้เป็น modify หรือแก้ธรรมดาได้"
- ฟอร์มใบแพ็กจริง: BOX NO. / BUNK NO. · LOCATION · LEVEL · PROJECT NO. (ชื่องาน) · ตาราง No. | Part Name | Description | Length (mm) | … | Quantity | UoM · จบด้วยแถว TOTAL
- กติกา (migration-packing-table-2026-11-23.sql): Modify ต้องมีเหตุผล และถูกเก็บเป็น M-เลขที่ถัดไป · กล่องที่เป็นบั้งของหน้าเครื่อง แก้แล้วใบบั้ง + BOM เปลี่ยนตาม
  · ของที่สแกนแพ็กแล้วเอาออกไม่ได้ · ผิดจุดเดียวไม่บันทึกอะไรเลย · office ขึ้นไปเท่านั้น
"""
import json

import pytest

from conftest import has_fn, one, q

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression
dbm = pytest.mark.db


def pf(js, fn, *args):
    return js(fn, *args, m="pf")


# ───────────────────────── อ่านใบแพ็กจาก Excel ─────────────────────────
ANCHOR = [
    ["BOX NO.", "", "", "", "", "BB-L01-A1"],
    ["LOCATION:", "", "", "", "", "TG05-101B, TG05-102B"],
    ["LEVEL", "", "", "", "", "L01"],
    ["PROJECT NO.", "", "ANCHOR", "", "", "Sample Building B"],
    ["No.", "Part Name", "Description", "Length (Inch)", "Length (mm)", "TG05-101B", "TG05-102B", "", "Quantity", "UoM", "", "kg/mm.", "kg/pcs", "total kg"],
    [1, "SAAN04-001", "SUB-ASSEMBLY ANCHOR BASE PLATE", 8, 203.2, 28, 50, "", 78, "pcs.", "", "", 0, 0],
    [2, "an05-002", "SERRATED WASHER", 1.75, 44.45, 92, 150, "", 242, "pcs.", "", "", 0, 0],
    ["", "", "", "", "", "", "", "", "", "", "", "", 0, 0],
    ["", "", "TOTAL", "", "", "", "", "", 320],
    ["", "Total", "Kg.", "Lbs", "(N.W.)"],
    ["", "Box Size"],
]
BUNK = [
    ["BUNK NO.", "", "", "", "", "", "", "BB-L03-C02"],
    ["ELEVATION", "", "", "", "", "", "", "NORTH"],
    ["LEVEL", "", "", "", "", "", "", 3],
    ["PROJECT.", "", "", "", "", "", "", "SAMPLE"],
    ["No.", "Unit  No.", "Bunk Position", "Address Sequence", "Description", "Width mm", "Height mm", "Sqm", "Quantity Unit", "Weight (Lbs)", "", "Unit #", "Bunk Position"],
    [1, "UA0315", "A", "03-N-258", "Curtain Wall Unit", 1600.2, 3276.6, 5.24, 1, 597.44, "", "UA0315", "A"],
    [2, "UA0336", "B", "03-N-259", "Curtain Wall Unit", 1066.8, 3276.6, 3.5, 1, 363.75, "", "UA0336", "B"],
    ["", "TOTAL", "", "", "", "", "", 8.74, 2, 961.19],
    ["", "Total", "", "", "Kg.", "", "Lbs", "(N.W.)"],
]


@P
def test_box_form_loose(js):
    """TC-PACK-001 ใบ Ship loose: เลขกล่อง · ชื่องาน · ตำแหน่ง · ชั้น · รายการ (ใช้ Length (mm) ไม่ใช่นิ้ว · Quantity ไม่ใช่คอลัมน์รายตำแหน่ง)"""
    b = pf(js, "parseBoxRows", ANCHOR, "s")[0]
    assert (b["box_no"], b["kind"], b["title"], b["location"], b["level"]) == ("BB-L01-A1", "loose", "ANCHOR", "TG05-101B, TG05-102B", "L01")
    assert [(i["item"], i["desc"], i["len"], i["qty"], i["unit"]) for i in b["items"]] == [
        ("SAAN04-001", "SUB-ASSEMBLY ANCHOR BASE PLATE", 203.2, 78, "pcs."), ("AN05-002", "SERRATED WASHER", 44.45, 242, "pcs.")]


@P
def test_box_form_panel(js):
    """TC-PACK-002 ใบบั้งแผง (BUNK NO.): ชนิด panel · ตำแหน่ง · ที่อยู่ · กว้าง / สูง · น้ำหนัก · ไม่อ่านตารางข้าง ๆ ซ้ำ"""
    b = pf(js, "parseBoxRows", BUNK, "s")[0]
    assert (b["box_no"], b["kind"], b["location"], b["level"]) == ("BB-L03-C02", "panel", "NORTH", "3")
    assert [(i["pos"], i["item"], i["addr"], i["w"], i["h"], i["qty"], i["wt"]) for i in b["items"]] == [
        ("A", "UA0315", "03-N-258", 1600.2, 3276.6, 1, 597.44), ("B", "UA0336", "03-N-259", 1066.8, 3276.6, 1, 363.75)]


@N
def test_box_form_stops_at_total(js):
    """TC-PACK-003 แถว TOTAL และแถวใต้ตาราง (Total Kg. / Box Size) ไม่กลายเป็นรายการ"""
    for rows in (ANCHOR, BUNK):
        items = pf(js, "parseBoxRows", rows, "s")[0]["items"]
        assert len(items) == 2 and not any("TOTAL" in i["item"] or "BOX" in i["item"] for i in items)


@P
def test_box_form_many_boxes_in_one_sheet(js):
    """TC-PACK-004 ชีตเดียวหลายกล่องต่อกัน → แยกเป็นกล่องละใบ"""
    second = [["BOX NO.", "", "", "", "", "BB-L02-A1"]] + ANCHOR[1:]
    bs = pf(js, "parseBoxRows", ANCHOR + [[]] + second, "s")
    assert [b["box_no"] for b in bs] == ["BB-L01-A1", "BB-L02-A1"] and [len(b["items"]) for b in bs] == [2, 2]


@B
def test_box_form_total_column_when_no_quantity(js):
    """TC-PACK-005 ฟอร์ม Louvre: ไม่มีคอลัมน์ Quantity มีแต่ TOTAL → ใช้ TOTAL · หัว "LV Name" คือเบอร์"""
    rows = [["BOX NO.", "", "", "", "", "", "BB-L01-LV1"], ["LEVEL", "", "", "", "", "", 1],
            ["No.", "LV Name", "Description", "Length (mm)", "Height (mm)", "Unit", "TG04-100", "TG04-101", "TOTAL"],
            [1, "LV-5003.1", "LOUVER ASSEMBLY", 964.88, 290, "SET", 2, 2, 4], [2, "LV-5001.1", "LOUVER ASSEMBLY", 812.48, 290, "SET", "", 6, 6],
            ["", "", "TOTAL", "", "", "", 2, 8, 10]]
    b = pf(js, "parseBoxRows", rows, "s")[0]
    assert [(i["item"], i["len"], i["h"], i["unit"], i["qty"]) for i in b["items"]] == [("LV-5003.1", 964.88, 290, "SET", 4), ("LV-5001.1", 812.48, 290, "SET", 6)]


@B
@pytest.mark.parametrize("tid,rows,n", [
    ("TC-PACK-006", [], 0),
    ("TC-PACK-007", [["No.", "Part Name"], [1, "X-1"]], 0),                       # ไม่มีหัว BOX NO.
    ("TC-PACK-008", [["BOX NO.", "", "BB-X-01"]], 1),                              # มีหัวกล่อง แต่ไม่มีตาราง = กล่องเปล่า
    ("TC-PACK-009", [["BOX NO.", "", ""], ["No.", "Part Name"], [1, "X-1"]], 0),   # ไม่มีเลขกล่อง = ข้าม
])
def test_box_form_edges(js, tid, rows, n):
    assert len(pf(js, "parseBoxRows", rows, "s")) == n, tid


@B
def test_box_form_blank_or_zero_qty_is_one(js):
    """TC-PACK-010 จำนวนว่าง / 0 → 1 (ของมีอยู่จริงในใบ)"""
    rows = [["BOX NO.", "", "BB-X-01"], ["No.", "Part Name", "Quantity"], [1, "X-1", ""], [2, "X-2", 0], [3, "X-3", 2.5]]
    assert [i["qty"] for i in pf(js, "parseBoxRows", rows, "s")[0]["items"]] == [1, 1, 2.5]


@R
def test_box_sheets_ship_from_sheet_name_and_duplicates(js):
    """TC-PACK-011 ชื่อชีต "L3 Ship#BB06" = ชิปของกล่องในชีต · เลขกล่องซ้ำข้ามชีต = ใช้ใบแรก + เตือน · ชีต OLD ข้าม"""
    r = pf(js, "parseBoxSheets", [{"name": "L3 Ship#BB06", "rows": BUNK}, {"name": "L3 (2)", "rows": BUNK}, {"name": "L3 Ship#BB06 OLD", "rows": ANCHOR}])
    assert [(b["box_no"], b["ship"]) for b in r["boxes"]] == [("BB-L03-C02", "#BB06")]
    assert len(r["warn"]) == 1 and "BB-L03-C02" in r["warn"][0]
    assert [(s["name"], s["n"]) for s in r["sheets"]] == [("L3 Ship#BB06", 1), ("L3 (2)", 0), ("L3 Ship#BB06 OLD", 0)]


# ───────────────────────── อ่านใบแพ็กจาก PDF ─────────────────────────
# ตำแหน่งข้อความคัดจากใบ Louvre จริง (หัว "Length" / "Height" อยู่บรรทัดบน · "(mm)" อยู่บรรทัดล่าง · แถวที่ 2 เลขลำดับเยื้องจากบรรทัดเบอร์ 2 pt)
def _t(s, x, y):
    return {"s": s, "x": x, "y": y}


PDF_PAGE = [
    _t("BOX NO.", 60, 60), _t("BB-L01-LV1", 420, 60), _t("LOCATION:", 60, 78), _t("TG04-100,101", 420, 78), _t("LEVEL", 60, 96), _t("1", 420, 96),
    _t("PROJECT NO.", 60, 114), _t("Sample Tower B", 420, 114),
    _t("Length", 330, 136), _t("Height", 400, 136),
    _t("No.", 60, 146), _t("LV Name", 110, 146), _t("Description", 200, 146), _t("Unit", 460, 146), _t("TG04-100", 520, 146), _t("TG04-101", 590, 146), _t("TOTAL", 660, 146),
    _t("(mm)", 332, 156), _t("(mm)", 402, 156),
    _t("1", 62, 180), _t("LV-5003.1", 110, 180), _t("LOUVER ASSEMBLY", 200, 180), _t("964.88", 330, 180), _t("290", 402, 180), _t("SET", 460, 180), _t("2", 530, 180), _t("2", 600, 180), _t("4", 668, 180),
    _t("LV-5013", 110, 199), _t("1244.28", 330, 199), _t("290", 402, 199), _t("4", 668, 199),
    _t("2", 62, 201), _t("LOUVER ASSEMBLY", 200, 201), _t("SET", 460, 201), _t("4", 600, 201),
    _t("TOTAL", 200, 240), _t("2", 530, 240), _t("6", 600, 240), _t("8", 668, 240),
    _t("Total", 110, 270), _t("Kg.", 200, 270),
]


@P
def test_pdf_box_form(js):
    """TC-PACK-020 ใบแพ็ก PDF: หัวกล่อง · หัวตารางสองบรรทัด ("Length" + "(mm)") · บรรทัดที่เยื้องกันนิดเดียวเป็นแถวเดียวกัน · จบที่ TOTAL"""
    bs = pf(js, "parseBoxPdfPage", PDF_PAGE, "LV.pdf")
    assert len(bs) == 1
    b = bs[0]
    assert (b["box_no"], b["location"], b["level"], b["kind"]) == ("BB-L01-LV1", "TG04-100,101", "1", "loose")
    assert [(i["item"], i["desc"], i["len"], i["h"], i["unit"], i["qty"]) for i in b["items"]] == [
        ("LV-5003.1", "LOUVER ASSEMBLY", 964.88, 290, "SET", 4), ("LV-5013", "LOUVER ASSEMBLY", 1244.28, 290, "SET", 4)]


@R
def test_pdf_inch_column_not_used_as_mm(js):
    """TC-PACK-021 หัว "Length (Inc)" กับ "Length (mm)" อยู่คู่กัน → ความยาวต้องมาจากคอลัมน์ มม."""
    page = [_t("BOX NO.", 60, 60), _t("BB-GK-01", 300, 60),
            _t("Length", 300, 100), _t("Length", 360, 100),
            _t("No.", 60, 110), _t("Part Name", 110, 110), _t("Description", 200, 110), _t("Unit", 420, 110), _t("Quantity", 470, 110),
            _t("(Inc)", 300, 120), _t("(mm)", 362, 120),
            _t("1", 60, 140), _t("HS323-2", 110, 140), _t("THERMAL SEPARATOR", 200, 140), _t("86.6", 300, 140), _t("2200", 362, 140), _t("Pcs", 420, 140), _t("13", 474, 140)]
    it = pf(js, "parseBoxPdfPage", page, "x")[0]["items"][0]
    assert (it["item"], it["len"], it["qty"], it["unit"]) == ("HS323-2", 2200, 13, "Pcs")


@N
def test_pdf_wrapped_text_line_is_not_an_item(js):
    """TC-PACK-022 บรรทัดที่ตัดคำลงมา (ไม่มีเลขลำดับนำ) ไม่กลายเป็นรายการ"""
    page = [_t("BOX NO.", 60, 60), _t("BB-GK-01", 300, 60), _t("No.", 60, 110), _t("Part Name", 110, 110), _t("Description", 200, 110), _t("Quantity", 470, 110),
            _t("1", 60, 140), _t("HS381-1", 110, 140), _t("ISOLATOR AT PANEL", 200, 140), _t("3", 474, 140),
            _t("CONNECTION RIGID PVC (ORDER 2200)", 150, 154)]
    assert [i["item"] for i in pf(js, "parseBoxPdfPage", page, "x")[0]["items"]] == ["HS381-1"]


@B
@pytest.mark.parametrize("tid,items", [("TC-PACK-023", []), ("TC-PACK-024", [_t("PLAN", 10, 10), _t("CNTR-013", 20, 30)])])
def test_pdf_not_a_box_form(js, tid, items):
    assert pf(js, "parseBoxPdfPage", items, "x") == [], tid


@R
def test_pdf_same_box_on_two_pages(js):
    """TC-PACK-025 กล่องเลขเดียวกันสองหน้า → ใช้หน้าแรก + เตือน"""
    r = pf(js, "parseBoxPdfPages", [PDF_PAGE, PDF_PAGE], "x")
    assert len(r["boxes"]) == 1 and len(r["warn"]) == 1 and "BB-L01-LV1" in r["warn"][0]


# ───────────────────────── รวมกับตารางเดิม ─────────────────────────
def it(item, qty=1, **k):
    return {"item": item, "desc": "", "pos": "", "addr": "", "len": None, "w": None, "h": None, "unit": "", "qty": qty, "wt": None, **k}


CUR = [{"id": "x1", "box_no": "BB-1", "kind": "loose", "title": "ANCHOR", "location": "", "level": "L01", "ship": "#BB01", "cntr": "CNTR-001", "items": [it("A-1", 5)]}]


@P
def test_merge_new_box(js):
    """TC-PACK-030 กล่องใหม่ = เพิ่ม (ติด _dirty / _new ไม่มี id)"""
    r = pf(js, "mergeBoxes", CUR, [{"box_no": "bb-2", "kind": "loose", "title": "", "location": "", "level": "", "ship": "", "items": [it("B-1")]}])
    assert (r["added"], r["replaced"], r["same"]) == (1, 0, 0) and r["boxes"][1]["_new"] is True and "id" not in r["boxes"][1]


@P
def test_merge_replaces_items_keeps_placement(js):
    """TC-PACK-031 กล่องเดิม: รายการถูกแทนด้วยของไฟล์ · ชิป / ตู้ / id / หัวกล่องที่ไฟล์ไม่มีค่า คงเดิม"""
    r = pf(js, "mergeBoxes", CUR, [{"box_no": "BB-1", "kind": "loose", "title": "", "location": "TG05", "level": "", "ship": "", "items": [it("A-1", 7), it("A-2", 1)]}])
    b = r["boxes"][0]
    assert r["replaced"] == 1 and (b["id"], b["ship"], b["cntr"], b["title"], b["level"], b["location"]) == ("x1", "#BB01", "CNTR-001", "ANCHOR", "L01", "TG05")
    assert [(i["item"], i["qty"]) for i in b["items"]] == [("A-1", 7), ("A-2", 1)] and b["_dirty"] is True


@B
def test_merge_same_file_again_changes_nothing(js):
    """TC-PACK-032 วางไฟล์เดิมซ้ำ = ไม่มีอะไรเปลี่ยน (ไม่ติด _dirty)"""
    r = pf(js, "mergeBoxes", CUR, [{"box_no": " bb-1 ", "kind": "loose", "title": "ANCHOR", "location": "", "level": "L01", "ship": "", "items": [it("A-1", 5)]}])
    assert (r["added"], r["replaced"], r["same"]) == (0, 0, 1) and "_dirty" not in r["boxes"][0]


@R
def test_merge_empty_file_box_does_not_wipe_items(js):
    """TC-PACK-033 ไฟล์ที่มีแต่หัวกล่อง (ไม่มีรายการ) ไม่ล้างรายการเดิม"""
    r = pf(js, "mergeBoxes", CUR, [{"box_no": "BB-1", "kind": "loose", "title": "", "location": "", "level": "", "ship": "", "items": []}])
    assert len(r["boxes"][0]["items"]) == 1 and r["same"] == 1


# ───────────────────────── สิ่งที่เปลี่ยน (บันทึก Modify) ─────────────────────────
def bx(no, items, ship="#BB01", cntr="CNTR-001", **k):
    return {"box_no": no, "ship": ship, "cntr": cntr, "title": "", "location": "", "level": "", "items": items, **k}


@B
def test_diff_nothing(js):
    """TC-PACK-040 ไม่เปลี่ยน → ไม่มีรายการ"""
    a = [bx("BB-1", [it("A-1", 5)])]
    assert pf(js, "diffPacking", a, a) == []


@P
@pytest.mark.parametrize("tid,after,typ,word", [
    ("TC-PACK-041", [bx("BB-1", [it("A-1", 7)])], "qty", "A-1 จำนวน 5 → 7"),
    ("TC-PACK-042", [bx("BB-1", [it("A-1", 5), it("A-2", 2)])], "item_add", "เพิ่ม A-2"),
    ("TC-PACK-043", [bx("BB-1", [])], "item_del", "เอา A-1 ออก"),
    ("TC-PACK-044", [bx("BB-1", [it("A-1", 5)], ship="#BB02", cntr="CNTR-009")], "box_move", "#BB01 · CNTR-001 → #BB02 · CNTR-009"),
    ("TC-PACK-045", [bx("BB-1", [it("A-1", 5)]), bx("BB-2", [it("B-1", 1)])], "box_add", "เพิ่มกล่อง BB-2"),
    ("TC-PACK-046", [], "box_del", "ลบกล่อง BB-1"),
    ("TC-PACK-047", [bx("BB-1", [it("A-1", 5)], title="ANCHOR")], "box_edit", "ชื่องาน"),
])
def test_diff_one_change(js, tid, after, typ, word):
    d = pf(js, "diffPacking", [bx("BB-1", [it("A-1", 5)])], after)
    assert len(d) == 1 and d[0]["type"] == typ and word in d[0]["text"], tid


@P
def test_diff_move_between_boxes(js):
    """TC-PACK-048 แผงหายจากบั้งหนึ่งไปโผล่อีกบั้ง (เบอร์ + ที่อยู่เดียวกัน) = "ย้าย" ข้อเดียว ไม่ใช่ลบ + เพิ่ม"""
    a = [bx("BB-1", [it("UA1", 1, pos="A", addr="03-N-1"), it("UA2", 1, pos="B", addr="03-N-2")]), bx("BB-2", [it("UA3", 1, pos="A", addr="03-N-3")])]
    b = [bx("BB-1", [it("UA1", 1, pos="A", addr="03-N-1")]), bx("BB-2", [it("UA3", 1, pos="A", addr="03-N-3"), it("UA2", 1, pos="", addr="03-N-2")])]
    d = pf(js, "diffPacking", a, b)
    assert [x["type"] for x in d] == ["move"] and "UA2" in d[0]["text"] and "BB-1 → BB-2" in d[0]["text"]


@R
def test_diff_ignores_deleted_marker_rows(js):
    """TC-PACK-049 กล่องที่ติด _del ในรายการหลัง = นับว่าถูกลบ"""
    d = pf(js, "diffPacking", [bx("BB-1", [it("A-1", 5)])], [bx("BB-1", [it("A-1", 5)], _del=True)])
    assert [x["type"] for x in d] == ["box_del"]


# ───────────────────────── ตรวจก่อนบันทึก ─────────────────────────
@P
def test_validate_ok(js):
    """TC-PACK-050 ครบ → ผ่าน (กล่องเปล่าก็ผ่าน)"""
    assert pf(js, "validateBoxes", [bx("BB-1", [it("A-1", 5)]), bx("BB-2", [])]) == []


@N
@pytest.mark.parametrize("tid,boxes,word", [
    ("TC-PACK-051", [bx("", [])], "ไม่มีเลขกล่อง"),
    ("TC-PACK-052", [bx("BB-1", []), bx("bb-1 ", [])], "ซ้ำ"),
    ("TC-PACK-053", [bx("BB-1", [it("", 1)])], "ไม่มีเบอร์"),
    ("TC-PACK-054", [bx("BB-1", [it("A-1", 0)])], "จำนวน"),
    ("TC-PACK-055", [bx("BB-1", [it("A-1", -1)])], "จำนวน"),
    ("TC-PACK-056", [bx("B" * 61, [])], "ยาวเกิน"),
    ("TC-PACK-057", [bx("BB-1", [it("A-1", 1, len=-5)])], "ตัวเลข"),
])
def test_validate_rejects(js, tid, boxes, word):
    errs = pf(js, "validateBoxes", boxes)
    assert errs and any(word in e for e in errs), tid


@B
@pytest.mark.parametrize("tid,boxes", [
    ("TC-PACK-058", [bx("B" * 60, [it("A-1", 1000000, len=0, wt=1000000)])]),
    ("TC-PACK-059", [bx("BB-1", [it("A-1", 0.5)])]),
    ("TC-PACK-060", [bx("BB-1", []), bx("BB-1", [], _del=True)]),
])
def test_validate_edges_pass(js, tid, boxes):
    assert pf(js, "validateBoxes", boxes) == [], tid


# ───────────────────────── ฐานข้อมูล ─────────────────────────
SAVE = "select public.packing_save(%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s::jsonb)"
LIST = "select public.packing_list(%s,%s)"


@pytest.fixture()
def need_pk(db):
    if not has_fn(db, "packing_save"):
        pytest.skip("ยังไม่ได้รัน migration-packing-table-2026-11-23.sql")


def save(db, tok, pid, boxes, delete=(), mode="normal", reason="", changes=()):
    return one(db, SAVE, (tok, pid, json.dumps(boxes), json.dumps([str(x) for x in delete]), mode, reason, json.dumps(list(changes))))


def lst(db, tok, pid):
    return one(db, LIST, (tok, pid))


def dbox(no="PYT-BX-01", items=None, **k):
    return {"box_no": no, "kind": "loose", "title": "ANCHOR", "location": "TG05", "level": "L01", "ship": "#BB01", "cntr": "CNTR-001", "items": [it("PYT-A1", 5, len=203.2, unit="pcs.")] if items is None else items, **k}


@dbm
@P
def test_db_save_normal_and_list(db, actors, project, need_pk):
    """TC-PACK-070 บันทึกปกติ 2 กล่อง → อ่านกลับครบ (หัวกล่อง · รายการ · ชิป / ตู้) · ไม่มีบันทึก Modify"""
    tok = actors.tok["office"]
    r = save(db, tok, project, [dbox(), dbox("PYT-BX-02", [], ship="", cntr="")])
    assert (r["ok"], r["saved"], r["mod_no"]) == (True, 2, None)
    got = lst(db, tok, project)
    assert [(b["box_no"], b["kind"], b["title"], b["location"], b["level"], b["ship"], b["cntr"], len(b["items"]), b["has_bunk"]) for b in got["boxes"]] == [
        ("PYT-BX-01", "loose", "ANCHOR", "TG05", "L01", "#BB01", "CNTR-001", 1, False), ("PYT-BX-02", "loose", "ANCHOR", "TG05", "L01", "", "", 0, False)]
    assert (got["boxes"][0]["items"][0]["item"], got["boxes"][0]["items"][0]["qty"], got["boxes"][0]["items"][0]["len"]) == ("PYT-A1", 5, 203.2)
    assert got["mods"] == []


@dbm
@P
def test_db_save_modify_numbers_and_history(db, actors, project, need_pk):
    """TC-PACK-071 บันทึกเป็น Modify 2 ครั้ง → M-1, M-2 เก็บเหตุผล + สิ่งที่เปลี่ยน + ชื่อผู้บันทึก · รายการล่าสุดอยู่บน"""
    tok = actors.tok["office"]
    r1 = save(db, tok, project, [dbox()], mode="modify", reason=" ลูกค้าแก้แบบ ", changes=[{"type": "box_add", "box": "PYT-BX-01", "text": "เพิ่มกล่อง"}])
    bid = one(db, "select id from packing_box where project_id=%s", (project,))
    r2 = save(db, tok, project, [dbox(id=str(bid), items=[it("PYT-A1", 7)])], mode="modify", reason="เพิ่มจำนวน", changes=[{"type": "qty", "box": "PYT-BX-01", "text": "5 → 7"}])
    assert (r1["mod_no"], r2["mod_no"]) == (1, 2)
    mods = lst(db, tok, project)["mods"]
    assert [(m["mod_no"], m["reason"], m["changes"][0]["text"], m["by"]) for m in mods] == [(2, "เพิ่มจำนวน", "5 → 7", "pytest office"), (1, "ลูกค้าแก้แบบ", "เพิ่มกล่อง", "pytest office")]
    assert one(db, "select count(*) from packing_box where project_id=%s", (project,)) == 1


@dbm
@N
@pytest.mark.parametrize("tid,reason", [("TC-PACK-072", ""), ("TC-PACK-073", "   ")])
def test_db_modify_needs_reason(db, actors, project, need_pk, tid, reason):
    r = save(db, actors.tok["office"], project, [dbox()], mode="modify", reason=reason)
    assert (r["ok"], r["reason"]) == (False, "need_reason"), tid
    assert one(db, "select count(*) from packing_box where project_id=%s", (project,)) == 0, tid


@dbm
@N
@pytest.mark.parametrize("tid,box,reason", [
    ("TC-PACK-074", {"box_no": ""}, "bad_box"),
    ("TC-PACK-075", {"box_no": "B" * 61}, "bad_box"),
    ("TC-PACK-076", {"items": [it("", 1)]}, "bad_item"),
    ("TC-PACK-077", {"items": [it("PYT-A1", 0)]}, "bad_qty"),
    ("TC-PACK-078", {"items": [it("PYT-A1", 1000001)]}, "bad_qty"),
    ("TC-PACK-079", {"items": [it("PYT-A1", 1, len="abc")]}, "bad_number"),
])
def test_db_bad_box_all_or_nothing(db, actors, project, need_pk, tid, box, reason):
    r = save(db, actors.tok["office"], project, [dbox("PYT-BX-OK"), {**dbox(), **box}], mode="modify", reason="x")
    assert (r["ok"], r["reason"]) == (False, reason), tid
    assert one(db, "select count(*) from packing_box where project_id=%s", (project,)) == 0, tid      # กล่องที่ถูกต้องในชุดเดียวกันก็ไม่ถูกบันทึก
    assert one(db, "select count(*) from packing_mod where project_id=%s", (project,)) == 0, tid
    assert one(db, "select count(*) from container_plan where project_id=%s", (project,)) == 0, tid


@dbm
@B
def test_db_edge_values(db, actors, project, need_pk):
    """TC-PACK-080 ค่าขอบ: เลขกล่อง 60 ตัว · จำนวน 1,000,000 · จำนวนทศนิยม 0.5 · ความยาว 0"""
    r = save(db, actors.tok["office"], project, [dbox("B" * 60, [it("PYT-A1", 1000000, len=0), it("PYT-A2", 0.5)])])
    assert (r["ok"], r["saved"]) == (True, 1)


@dbm
@N
def test_db_mode_must_be_known(db, actors, project, need_pk):
    """TC-PACK-081 โหมดบันทึกที่ไม่รู้จัก → bad_input"""
    assert save(db, actors.tok["office"], project, [dbox()], mode="whatever")["reason"] == "bad_input"


@dbm
@P
def test_db_same_box_again_updates(db, actors, project, need_pk):
    """TC-PACK-082 บันทึกกล่องเลขเดิมซ้ำ (ไม่มี id · ตัวพิมพ์เล็ก) = แก้กล่องเดิม ไม่เพิ่มกล่อง"""
    tok = actors.tok["office"]
    save(db, tok, project, [dbox()])
    save(db, tok, project, [dbox("pyt-bx-01", [it("PYT-A1", 9)])])
    assert q(db, "select box_no, items->0->>'qty' from packing_box where project_id=%s", (project,)) == [("PYT-BX-01", "9")]


@dbm
@N
def test_db_rename_to_existing_rejected(db, actors, project, need_pk):
    """TC-PACK-083 แก้เลขกล่องไปชนกล่องอื่น → duplicate ไม่มีอะไรเปลี่ยน"""
    tok = actors.tok["office"]
    save(db, tok, project, [dbox(), dbox("PYT-BX-02")])
    bid = one(db, "select id from packing_box where project_id=%s and box_no='PYT-BX-02'", (project,))
    r = save(db, tok, project, [dbox("PYT-BX-01", id=str(bid))])
    assert (r["ok"], r["reason"]) == (False, "duplicate")
    assert sorted(x[0] for x in q(db, "select box_no from packing_box where project_id=%s", (project,))) == ["PYT-BX-01", "PYT-BX-02"]


@dbm
@P
def test_db_ship_container_goes_to_container_plan_and_keeps_size(db, actors, project, need_pk):
    """TC-PACK-084 ชิป / ตู้ของกล่องลงตารางแผนลงตู้ · ย้ายตู้ = ล้างแถว / ช่อง แต่ขนาดบั้งเดิมอยู่ · ตู้เดิม = ตำแหน่งคงเดิม"""
    tok = actors.tok["office"]
    db.execute("insert into container_plan(project_id, shipment, container_no, bunk_no, row_no, col_no, len_mm, w_mm) values(%s,'#BB01','CNTR-001','PYT-BX-01',1,2,3440,1140)", (project,))
    save(db, tok, project, [dbox()])
    assert q(db, "select shipment, container_no, row_no, col_no, len_mm from container_plan where project_id=%s", (project,)) == [("#BB01", "CNTR-001", 1, 2, 3440)]
    save(db, tok, project, [dbox(ship="#BB02", cntr="cntr-009")])
    assert q(db, "select shipment, container_no, row_no, col_no, len_mm from container_plan where project_id=%s", (project,)) == [("#BB02", "CNTR-009", None, None, 3440)]


@dbm
@P
def test_db_delete_box(db, actors, project, need_pk):
    """TC-PACK-085 ลบกล่อง → แถวในตาราง + ที่อยู่ชิป / ตู้ของกล่องนั้นหาย · กล่องอื่นอยู่ครบ"""
    tok = actors.tok["office"]
    save(db, tok, project, [dbox(), dbox("PYT-BX-02")])
    bid = one(db, "select id from packing_box where project_id=%s and box_no='PYT-BX-01'", (project,))
    r = save(db, tok, project, [], delete=[bid])
    assert (r["ok"], r["deleted"]) == (True, 1)
    assert q(db, "select box_no from packing_box where project_id=%s", (project,)) == [("PYT-BX-02",)]
    assert q(db, "select bunk_no from container_plan where project_id=%s", (project,)) == [("PYT-BX-02",)]


def _station_bunk(db, pid, no="PYT-BK-01", units=("PYT-UA1", "PYT-UA2")):
    """บั้งของหน้าเครื่อง (package + QR) มีแผงตาม units · คืน (pm_id, unit_id, {unit: (pm, unit_id)})"""
    panels = {}
    for u in ("PYT-UA1", "PYT-UA2", "PYT-UA3"):
        pm = one(db, "insert into part_master(project_id, part_no, part_name, kind) values(%s,%s,'panel','panel') returning id", (pid, u))
        rel = one(db, "insert into releases(part_master_id, qty, release_order) values(%s,1,'P-005') returning id", (pm,))
        panels[u] = (pm, one(db, "insert into part_units(release_id, part_master_id, unit_no, qr_code) values(%s,%s,1,%s) returning id", (rel, pm, f"{u}-{str(pm)[:8]}")))
    man = [{"no": i + 1, "unit_no": u, "position": "AB"[i], "address_seq": f"03-N-{i}", "description": "panel", "width": 1000, "height": 3000, "qty": 1, "weight": 100} for i, u in enumerate(units)]
    bpm = one(db, "insert into part_master(project_id, part_no, part_name, kind, pkg_manifest, pkg_meta) values(%s,%s,%s,'package',%s::jsonb,%s::jsonb) returning id",
              (pid, no, no, json.dumps(man), json.dumps({"bunk_no": no, "pack_type": "panel", "elevation": "NORTH", "level": "3"})))
    rel = one(db, "insert into releases(part_master_id, qty, release_order) values(%s,1,'P-100') returning id", (bpm,))
    bu = one(db, "insert into part_units(release_id, part_master_id, unit_no, qr_code) values(%s,%s,1,%s) returning id", (rel, bpm, f"{no}-{str(bpm)[:8]}"))
    return bpm, bu, panels


def pit(unit, pos, addr):
    return it(unit, 1, pos=pos, addr=addr, w=1000, h=3000, wt=100, desc="panel")


@dbm
@P
def test_db_station_bunk_appears_in_list(db, actors, project, need_pk):
    """TC-PACK-086 บั้งของหน้าเครื่องที่ยังไม่เคยลงในตารางนี้ ก็ขึ้นในตาราง (รายการมาจากใบบั้ง)"""
    _station_bunk(db, project)
    b = lst(db, actors.tok["office"], project)["boxes"][0]
    assert (b["box_no"], b["kind"], b["has_bunk"], b["id"], b["location"], b["level"]) == ("PYT-BK-01", "panel", True, None, "NORTH", "3")
    assert [(i["pos"], i["item"], i["addr"], i["w"], i["qty"]) for i in b["items"]] == [("A", "PYT-UA1", "03-N-0", 1000, 1), ("B", "PYT-UA2", "03-N-1", 1000, 1)]


@dbm
@P
def test_db_edit_station_bunk_updates_manifest_and_bom(db, actors, project, need_pk):
    """TC-PACK-087 แก้กล่องที่เป็นบั้งหน้าเครื่อง (เพิ่ม UA3) → ใบบั้ง + BOM + ยอดรวมของหน้าเครื่องเปลี่ยนตาม · อ่านกลับได้ 3 รายการ"""
    bpm, _, _ = _station_bunk(db, project)
    tok = actors.tok["office"]
    r = save(db, tok, project, [dbox("PYT-BK-01", [pit("PYT-UA1", "A", "03-N-0"), pit("PYT-UA2", "B", "03-N-1"), pit("PYT-UA3", "C", "03-N-2")], kind="panel")])
    assert r["ok"] is True
    man, meta = q(db, "select pkg_manifest, pkg_meta from part_master where id=%s", (bpm,))[0]
    assert [(m["no"], m["unit_no"], m["position"], m["address_seq"]) for m in man] == [(1, "PYT-UA1", "A", "03-N-0"), (2, "PYT-UA2", "B", "03-N-1"), (3, "PYT-UA3", "C", "03-N-2")]
    assert (float(meta["total_qty"]), float(meta["total_weight"]), meta["pack_type"]) == (3.0, 300.0, "panel")
    assert q(db, "select c.part_no, b.qty from bom_components b join part_master c on c.id=b.child_pm_id where b.parent_pm_id=%s order by 1", (bpm,)) == [("PYT-UA1", 1), ("PYT-UA2", 1), ("PYT-UA3", 1)]
    assert len(lst(db, tok, project)["boxes"][0]["items"]) == 3


@dbm
@N
def test_db_cannot_remove_packed_panel_from_station_bunk(db, actors, project, need_pk):
    """TC-PACK-088 แผงที่สแกนแพ็กแล้ว เอาออกจากใบของบั้งหน้าเครื่องไม่ได้ · ไม่มีอะไรเปลี่ยน (รวมกล่องอื่นในชุดเดียวกัน)"""
    bpm, bu, panels = _station_bunk(db, project)
    db.execute("insert into assembly_links(parent_unit_id, child_unit_id, child_pm_id, qty) values(%s,%s,%s,1)", (bu, panels["PYT-UA1"][1], panels["PYT-UA1"][0]))
    try:
        r = save(db, actors.tok["office"], project, [dbox("PYT-BX-OTHER"), dbox("PYT-BK-01", [pit("PYT-UA2", "B", "03-N-1")], kind="panel")])
        assert (r["ok"], r["reason"], r["box"], r["unit"]) == (False, "packed", "PYT-BK-01", "PYT-UA1")
        assert one(db, "select jsonb_array_length(pkg_manifest) from part_master where id=%s", (bpm,)) == 2
        assert one(db, "select count(*) from packing_box where project_id=%s", (project,)) == 0
    finally:
        db.execute("delete from assembly_links where parent_unit_id=%s", (bu,))


@dbm
@N
def test_db_station_bunk_unknown_unit_rejected(db, actors, project, need_pk):
    """TC-PACK-089 ใส่เบอร์ที่ไม่มีในโปรเจคลงบั้งหน้าเครื่อง → unit_not_found · ใบบั้ง + BOM เดิมไม่เปลี่ยน"""
    bpm, _, _ = _station_bunk(db, project)
    db.execute("insert into bom_components(parent_pm_id, child_pm_id, qty) select %s, id, 1 from part_master where project_id=%s and part_no in ('PYT-UA1','PYT-UA2')", (bpm, project))
    r = save(db, actors.tok["office"], project, [dbox("PYT-BK-01", [pit("PYT-UA1", "A", "03-N-0"), pit("PYT-NOPE", "B", "x")], kind="panel")])
    assert (r["ok"], r["reason"], r["unit"]) == (False, "unit_not_found", "PYT-NOPE")
    assert one(db, "select jsonb_array_length(pkg_manifest) from part_master where id=%s", (bpm,)) == 2
    assert one(db, "select count(*) from bom_components where parent_pm_id=%s", (bpm,)) == 2


@dbm
@N
def test_db_operator_and_no_session(db, actors, project, need_pk):
    """TC-PACK-090 พนักงานหน้าเครื่อง / ไม่มี session บันทึกและอ่านไม่ได้ · anon อ่านตารางตรงไม่ได้"""
    for fn in (lambda: save(db, actors.tok["operator"], project, [dbox()]), lambda: lst(db, actors.tok["operator"], project)):
        with pytest.raises(Exception) as e:
            fn()
        assert "forbidden" in str(e.value)
    with pytest.raises(Exception) as e:
        save(db, None, project, [dbox()])
    assert "unauthorized" in str(e.value)
    assert one(db, "select count(*) from packing_box where project_id=%s", (project,)) == 0
    for t in ("packing_box", "packing_mod"):
        assert one(db, f"select has_table_privilege('anon', 'public.{t}', 'select')") is False


@dbm
@R
def test_db_other_project_untouched_and_cascade(db, actors, project, need_pk):
    """TC-PACK-091 ส่ง id / รายการลบของโปรเจคอื่นไม่มีผล · ลบโปรเจค = ตาราง + ประวัติ Modify หายตาม"""
    tok = actors.tok["office"]
    other = one(db, "insert into projects(code,name) values(%s,%s) returning id", ("PYT-PK2-" + actors.tag, "pytest (ข้อมูลจำลอง)"))
    try:
        save(db, tok, other, [dbox()], mode="modify", reason="x")
        oid = one(db, "select id from packing_box where project_id=%s", (other,))
        assert save(db, tok, project, [dbox("PYT-HACK", id=str(oid))])["reason"] == "not_found"
        assert save(db, tok, project, [], delete=[oid])["deleted"] == 0
        assert q(db, "select box_no from packing_box where project_id=%s", (other,)) == [("PYT-BX-01",)]
        assert lst(db, tok, project) == {"boxes": [], "mods": [], "dates": {}}
    finally:
        db.execute("delete from projects where id=%s", (other,))
    assert one(db, "select (select count(*) from packing_box where project_id=%s) + (select count(*) from packing_mod where project_id=%s)", (other, other)) == 0
