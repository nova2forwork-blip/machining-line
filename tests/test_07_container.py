"""TC-CNTR — แผนลงตู้ (Container loading plan): อ่าน PDF / Excel · รวมกับแผนเดิม · ตรวจก่อนบันทึก · ฐานข้อมูล

ที่มาของผลที่คาด
- ผู้ใช้ 23/11/2026: "packing ลงแบบนี้ได้ไหม" (แบบลงตู้ PDF ของ Shipment #06) → "ให้ลงได้ทั้ง pdf และ excel แล้วให้แก้ได้ด้วย"
- แบบลงตู้จริง Shipment #06: CNTR-013 = แถวบน C02 C04 C06 · แถวล่าง BB-L04-C01 C03 C05 (ประตูอยู่ขวา) · ใต้เลขบั้ง = ความยาว · ขวาเลขบั้ง = ความกว้าง 1140
- ไฟล์ Pack Unit จริง: ชีต Data มีคอลัมน์ Bunk # / CNTR # / Shipment # · ชีต "L5 Ship#BB08" มีหัว BUNK NO. แต่ไม่มีเลขตู้
- กติกา: เลขบั้งเดียวอยู่ได้ตู้เดียวต่อโปรเจค · ช่องว่างจากไฟล์ใหม่ไม่ทับค่าที่มีอยู่ · เขียนได้เฉพาะ office ขึ้นไป (migration-container-plan-2026-11-23.sql)
"""
import json

import pytest

from conftest import has_fn, one, q

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression


def cp(js, fn, *args):
    return js(fn, *args, m="cp")


# ───────────────────────── รูปแบบเลขตู้ / shipment / เลขบั้ง ─────────────────────────
@P
@pytest.mark.parametrize("tid,raw,exp", [
    ("TC-CNTR-001", "CNTR-013", "CNTR-013"),
    ("TC-CNTR-002", "cntr 13", "CNTR-013"),
    ("TC-CNTR-003", " CNTR#7 ", "CNTR-007"),
    ("TC-CNTR-004", "CNTR-1234", "CNTR-1234"),
    ("TC-CNTR-005", "msku 123456", "MSKU 123456"),
])
def test_norm_container(js, tid, raw, exp):
    assert cp(js, "normContainer", raw) == exp, tid


@B
@pytest.mark.parametrize("tid,raw", [("TC-CNTR-006", ""), ("TC-CNTR-007", "   "), ("TC-CNTR-008", None)])
def test_norm_container_blank(js, tid, raw):
    assert cp(js, "normContainer", raw) == "", tid


@P
@pytest.mark.parametrize("tid,raw,prefix,exp", [
    ("TC-CNTR-010", "#BB04", "", "#BB04"),
    ("TC-CNTR-011", "bb4", "", "#BB04"),
    ("TC-CNTR-012", "06", "BB", "#BB06"),          # PDF เขียน SHIPMENT#06 · คำนำหน้ามาจากเลขบั้ง BB-…
    ("TC-CNTR-013", "BB05-1", "", "#BB05-1"),       # ชีต "L2 Ship#BB05-1"
    ("TC-CNTR-014", "Ship#BB20", "", "#BB20"),
    ("TC-CNTR-015", "", "BB", ""),
])
def test_norm_shipment(js, tid, raw, prefix, exp):
    assert cp(js, "normShipment", raw, prefix) == exp, tid


@pytest.mark.parametrize("tid,raw,exp", [
    pytest.param("TC-CNTR-020", "BB-L03-C02", True, marks=P),
    pytest.param("TC-CNTR-021", "BB-CPG-001", True, marks=P),
    pytest.param("TC-CNTR-022", "BB-L01-L08-SB1", True, marks=P),
    pytest.param("TC-CNTR-023", "CNTR-013", False, marks=N),      # ป้ายตู้ ไม่ใช่บั้ง
    pytest.param("TC-CNTR-024", "-BB-L04-C01", False, marks=N),   # หมายเหตุท้ายแบบ (ขึ้นต้นด้วย -)
    pytest.param("TC-CNTR-025", "3440", False, marks=N),
    pytest.param("TC-CNTR-026", "DOOR", False, marks=N),
    pytest.param("TC-CNTR-027", "CASTOR CAGES", False, marks=N),
    pytest.param("TC-CNTR-028", "-L03 CW", False, marks=N),
])
def test_looks_like_bunk(js, tid, raw, exp):
    assert cp(js, "looksLikeBunk", raw) is exp, tid


# ───────────────────────── อ่านแบบลงตู้ (PDF) ─────────────────────────
# ตำแหน่งข้อความคัดจากแบบจริง Shipment #06 (ตู้ 013 และ 014) — x, y เป็น pt นับจากมุมบนซ้าย
def _cntr(y0, label, top, bot, lens_top, lens_bot):
    it = []
    for i, (b, ln) in enumerate(zip(top, lens_top)):
        x = 156 + 140 * i
        it += [{"s": b, "x": x, "y": y0}, {"s": "1140", "x": x + 85, "y": y0 + 2}, {"s": str(ln), "x": x + 12, "y": y0 + 20}]
    it.append({"s": "DOOR", "x": 598, "y": y0 + 20})
    for i, (b, ln) in enumerate(zip(bot, lens_bot)):
        x = 156 + 147 * i
        it += [{"s": b, "x": x, "y": y0 + 48}, {"s": "1140", "x": x + 85, "y": y0 + 50}, {"s": str(ln), "x": x + 12, "y": y0 + 67}]
    it += [{"s": label, "x": 96, "y": y0 + 50}, {"s": "PLAN", "x": 555, "y": y0 + 86}, {"s": "[3440]", "x": 200, "y": y0 + 100}, {"s": '135.43"', "x": 200, "y": y0 + 95}]
    return it


PAGE = (_cntr(120, "CNTR-013", ["BB-L03-C02", "BB-L03-C04", "BB-L03-C06"], ["BB-L04-C01", "BB-L03-C03", "BB-L03-C05"], [3440, 3440, 3440], [3440, 3820, 3440])
        + _cntr(344, "CNTR-014", ["BB-L03-C08", "BB-L03-C10", "BB-L03-C12"], ["BB-L03-C07", "BB-L03-C09", "BB-L03-C11"], [3440, 3440, 3440], [3440, 3440, 3440])
        + [{"s": "SHIPMENT#06", "x": 650, "y": 900}, {"s": "5x40ft.HQ.", "x": 650, "y": 915}, {"s": "-L03 CW", "x": 650, "y": 930}, {"s": "-BB-L04-C01", "x": 650, "y": 945}])


@P
def test_pdf_page_containers_and_bunks(js):
    """TC-CNTR-030 1 หน้า 2 ตู้ ตู้ละ 6 บั้ง — บั้งเข้าตู้ถูก ไม่ปนกัน"""
    r = cp(js, "parseContainerPage", PAGE)
    by = {}
    for x in r["rows"]:
        by.setdefault(x["container_no"], []).append(x["bunk_no"])
    assert by == {
        "CNTR-013": ["BB-L03-C02", "BB-L03-C04", "BB-L03-C06", "BB-L04-C01", "BB-L03-C03", "BB-L03-C05"],
        "CNTR-014": ["BB-L03-C08", "BB-L03-C10", "BB-L03-C12", "BB-L03-C07", "BB-L03-C09", "BB-L03-C11"],
    }
    assert r["warn"] == []


@P
def test_pdf_page_position_size_shipment(js):
    """TC-CNTR-031 ตำแหน่ง (แถว / ช่อง) · ความยาว · ความกว้าง · shipment ได้ตามแบบ"""
    rows = {x["bunk_no"]: x for x in cp(js, "parseContainerPage", PAGE)["rows"]}
    assert rows["BB-L03-C02"] == {"shipment": "#BB06", "container_no": "CNTR-013", "bunk_no": "BB-L03-C02", "row_no": 1, "col_no": 1, "len_mm": 3440, "w_mm": 1140}
    c03 = rows["BB-L03-C03"]
    assert (c03["row_no"], c03["col_no"], c03["len_mm"], c03["w_mm"]) == (2, 2, 3820, 1140)
    assert rows["BB-L03-C11"]["row_no"] == 2 and rows["BB-L03-C11"]["col_no"] == 3


@N
def test_pdf_legend_note_is_not_a_bunk(js):
    """TC-CNTR-032 หมายเหตุท้ายแบบ "-BB-L04-C01" / "-L03 CW" ไม่ถูกนับเป็นบั้งซ้ำ"""
    rows = cp(js, "parseContainerPage", PAGE)["rows"]
    assert len(rows) == 12
    assert [x["bunk_no"] for x in rows].count("BB-L04-C01") == 1


@N
def test_pdf_page_without_container_label(js):
    """TC-CNTR-033 มีเลขบั้งแต่ไม่มีป้ายตู้ → ไม่ได้แถว + มีคำเตือน"""
    r = cp(js, "parseContainerPage", [{"s": "BB-L03-C02", "x": 100, "y": 100}])
    assert r["rows"] == [] and len(r["warn"]) == 1


@B
@pytest.mark.parametrize("tid,items", [("TC-CNTR-034", []), ("TC-CNTR-035", [{"s": "PLAN", "x": 1, "y": 1}])])
def test_pdf_page_empty(js, tid, items):
    assert cp(js, "parseContainerPage", items) == {"rows": [], "warn": []}, tid


@B
def test_pdf_container_with_no_bunks_warns(js):
    """TC-CNTR-036 ตู้ที่ไม่มีเลขบั้งรอบ ๆ → เตือน ไม่สร้างแถว"""
    r = cp(js, "parseContainerPage", PAGE + [{"s": "CNTR-099", "x": 96, "y": 800}])
    assert len(r["rows"]) == 12
    assert any("CNTR-099" in w for w in r["warn"])


@R
def test_pdf_same_bunk_on_two_pages(js):
    """TC-CNTR-037 บั้งเดียวกันอยู่สองหน้าคนละตู้ → ใช้หน้าแรก + เตือน"""
    p2 = _cntr(120, "CNTR-020", ["BB-L03-C02"], [], [3440], [])
    r = cp(js, "parseContainerPages", [PAGE, p2])
    hit = [x for x in r["rows"] if x["bunk_no"] == "BB-L03-C02"]
    assert len(hit) == 1 and hit[0]["container_no"] == "CNTR-013"
    assert any("BB-L03-C02" in w and "CNTR-020" in w for w in r["warn"])


# ───────────────────────── อ่าน Excel (ไฟล์ Pack Unit) ─────────────────────────
DATA_SHEET = {"name": "Data L1-L4", "rows": [
    ["Information By : (ทีมออกแบบ)"], ["Date :", "10.07.2026"], [],
    ["Unit #", "Bunk Position", "Address #", "Description", "Width", "Height", "Floor", "Elevation", "Bunk #", "CNTR #", "Shipment #"],
    ["UA0117", "A", "01-N-227", "UNIT ASSEMBLY", 1295.4, 3883.03, "B01", "NORTH", "BB-L01-C01", "CNTR-004", "#BB04"],
    ["UA0118", "B", "01-N-228", "UNIT ASSEMBLY", 1219.2, 3883.03, "B01", "NORTH", "BB-L01-C01", "CNTR-004", "#BB04"],
    ["UA0120", "A", "01-N-231", "UNIT ASSEMBLY", 1066.8, 3883.03, "B01", "NORTH", "BB-L01-C02", "CNTR-004", "#BB04"],
    ["UA0200", "A", "02-N-001", "UNIT ASSEMBLY", 1066.8, 3883.03, "B02", "NORTH", "BB-L02-C03", "cntr 8", "#BB05"],
    ["", "", "", "", "", "", "", "", "", "", ""],
]}
SHIP_SHEET = {"name": "L5 Ship#BB08", "rows": [
    ["BUNK NO.", "", "", "", "", "", "", "BB-L05-C01"], ["ELEVATION", "", "", "", "", "", "", "NORTH"],
    ["No.", "Unit  No.", "Bunk Position"], [1, "UA0501", "A"], [],
    ["BUNK NO.", "", "", "", "", "", "", "BB-L05-C02"], [1, "UA0502", "A"],
]}


@P
def test_excel_data_sheet(js):
    """TC-CNTR-040 ชีต Data: 1 บั้งหลายแถวยูนิต = 1 แถวแผน · เลขตู้ / shipment ถูกปรับรูปแบบ"""
    r = cp(js, "parseContainerSheets", [DATA_SHEET])
    got = [(x["bunk_no"], x["container_no"], x["shipment"]) for x in r["rows"]]
    assert got == [("BB-L01-C01", "CNTR-004", "#BB04"), ("BB-L01-C02", "CNTR-004", "#BB04"), ("BB-L02-C03", "CNTR-008", "#BB05")]
    assert all(x["row_no"] is None and x["col_no"] is None for x in r["rows"])   # Excel ไม่มีตำแหน่งในตู้


@P
def test_excel_ship_sheet_has_no_container(js):
    """TC-CNTR-041 ชีต Ship#: ได้บั้ง + shipment จากชื่อชีต · เลขตู้ว่าง"""
    r = cp(js, "parseContainerSheets", [SHIP_SHEET])
    assert [(x["bunk_no"], x["container_no"], x["shipment"]) for x in r["rows"]] == [("BB-L05-C01", "", "#BB08"), ("BB-L05-C02", "", "#BB08")]


@R
def test_excel_data_sheet_wins_over_ship_sheet(js):
    """TC-CNTR-042 บั้งเดียวกันอยู่ทั้งชีต Ship# (ไม่มีตู้) และชีต Data (มีตู้) → ใช้ของชีต Data ไม่ว่าชีตไหนมาก่อน"""
    ship = {"name": "L1 Ship#BB04", "rows": [["BUNK NO.", "", "", "", "", "", "", "BB-L01-C01"]]}
    for order in ([ship, DATA_SHEET], [DATA_SHEET, ship]):
        rows = cp(js, "parseContainerSheets", order)["rows"]
        hit = [x for x in rows if x["bunk_no"] == "BB-L01-C01"]
        assert len(hit) == 1 and hit[0]["container_no"] == "CNTR-004"


@N
def test_excel_old_and_unrelated_sheets_skipped(js):
    """TC-CNTR-043 ชีตชื่อ OLD และชีตที่ไม่มีคอลัมน์ / ชื่อที่ใช้ได้ ถูกข้าม"""
    old = {"name": "L2 Ship#BB05 OLD", "rows": [["BUNK NO.", "", "", "", "", "", "", "BB-OLD-C01"]]}
    other = {"name": "L3", "rows": [["Unit #", "Bunk Position", "Address #", "Elevation", "Bunk #", "WIDTH", "HEIGHT"], ["UA0337", "A", "03-N-254", "NORTH", "BB-L03-C01", 1219.2, 3276.6]]}
    r = cp(js, "parseContainerSheets", [old, other])
    assert r["rows"] == []
    assert len(r["sheets"]) == 2 and all(s["n"] == 0 for s in r["sheets"])


@R
def test_excel_same_bunk_two_containers_warns(js):
    """TC-CNTR-044 ตาราง Data ระบุบั้งเดียวกันสองตู้ → ใช้ตู้แรก + เตือน"""
    sh = {"name": "Data", "rows": [["Bunk #", "CNTR #", "Shipment #"], ["BB-X-C01", "CNTR-001", "#BB01"], ["BB-X-C01", "CNTR-002", "#BB01"]]}
    r = cp(js, "parseContainerSheets", [sh])
    assert len(r["rows"]) == 1 and r["rows"][0]["container_no"] == "CNTR-001"
    assert len(r["warn"]) == 1 and "BB-X-C01" in r["warn"][0]


@B
def test_excel_no_sheets(js):
    """TC-CNTR-045 ไม่มีชีต → ว่าง"""
    assert cp(js, "parseContainerSheets", []) == {"rows": [], "warn": [], "sheets": []}


# ───────────────────────── รวมกับแผนเดิม ─────────────────────────
CUR = [{"id": "a1", "shipment": "#BB06", "container_no": "CNTR-013", "bunk_no": "BB-L03-C02", "row_no": 1, "col_no": 1, "len_mm": 3440, "w_mm": 1140}]


@P
def test_merge_adds_new_bunk(js):
    """TC-CNTR-050 บั้งใหม่ = เพิ่มแถว (ไม่มี id · ติด _dirty)"""
    r = cp(js, "mergePlanRows", CUR, [{"shipment": "#BB06", "container_no": "CNTR-013", "bunk_no": "bb-l03-c04", "row_no": 1, "col_no": 2}])
    assert (r["added"], r["changed"], r["same"]) == (1, 0, 0)
    new = r["rows"][1]
    assert new["bunk_no"] == "BB-L03-C04" and new["_dirty"] is True and "id" not in new


@R
def test_merge_blank_does_not_wipe_existing(js):
    """TC-CNTR-051 นำเข้า Excel ที่ไม่มีเลขตู้ทับ → เลขตู้ / ตำแหน่ง / ขนาดเดิมไม่หาย"""
    r = cp(js, "mergePlanRows", CUR, [{"shipment": "#BB06", "container_no": "", "bunk_no": "BB-L03-C02", "row_no": None, "col_no": None, "len_mm": None, "w_mm": None}])
    assert (r["added"], r["changed"], r["same"]) == (0, 0, 1)
    assert r["rows"][0] == CUR[0]


@P
def test_merge_moves_container_and_clears_position(js):
    """TC-CNTR-052 ไฟล์ใหม่บอกตู้อื่น (ไม่มีตำแหน่ง) → ย้ายตู้ + ล้างแถว / ช่องเดิม · ขนาดเดิมอยู่"""
    r = cp(js, "mergePlanRows", CUR, [{"shipment": "#BB06", "container_no": "CNTR-014", "bunk_no": "BB-L03-C02", "row_no": None, "col_no": None}])
    o = r["rows"][0]
    assert r["changed"] == 1 and o["id"] == "a1"
    assert (o["container_no"], o["row_no"], o["col_no"], o["len_mm"], o["_dirty"]) == ("CNTR-014", None, None, 3440, True)


@B
def test_merge_matches_bunk_ignoring_case_and_spaces(js):
    """TC-CNTR-053 เทียบเลขบั้งไม่สนตัวพิมพ์ / ช่องว่าง"""
    r = cp(js, "mergePlanRows", CUR, [{"shipment": "#BB06", "container_no": "CNTR-013", "bunk_no": " bb-l03-c02 "}])
    assert (r["added"], r["same"]) == (0, 1) and len(r["rows"]) == 1


@B
def test_merge_does_not_mutate_input(js):
    """TC-CNTR-054 รายการเดิมที่ส่งเข้าไปไม่ถูกแก้ในที่"""
    out = js.steps([{"m": "cp", "fn": "mergePlanRows", "args": [CUR, [{"container_no": "CNTR-099", "bunk_no": "BB-L03-C02"}]]}])[0]
    assert out["rows"][0]["container_no"] == "CNTR-099" and CUR[0]["container_no"] == "CNTR-013"


# ───────────────────────── ตรวจก่อนบันทึก / เรียง ─────────────────────────
@P
def test_validate_ok(js):
    """TC-CNTR-060 ข้อมูลครบ → ไม่มีข้อผิดพลาด"""
    assert cp(js, "validatePlanRows", CUR + [{"bunk_no": "CAGE-01 #01", "container_no": ""}]) == []


@N
@pytest.mark.parametrize("tid,rows,word", [
    ("TC-CNTR-061", [{"bunk_no": ""}], "ไม่มีเลขบั้ง"),
    ("TC-CNTR-062", [{"bunk_no": "BB-1"}, {"bunk_no": "bb-1 "}], "ซ้ำ"),
    ("TC-CNTR-063", [{"bunk_no": "BB-1", "len_mm": 0}], "ขนาด"),
    ("TC-CNTR-064", [{"bunk_no": "BB-1", "w_mm": 30001}], "ขนาด"),
    ("TC-CNTR-065", [{"bunk_no": "BB-1", "row_no": 0}], "แถว"),
    ("TC-CNTR-066", [{"bunk_no": "BB-1", "col_no": 1.5}], "แถว"),
    ("TC-CNTR-067", [{"bunk_no": "B" * 61}], "ยาวเกิน"),
])
def test_validate_rejects(js, tid, rows, word):
    errs = cp(js, "validatePlanRows", rows)
    assert errs and any(word in e for e in errs), tid


@B
@pytest.mark.parametrize("tid,rows", [
    ("TC-CNTR-068", [{"bunk_no": "BB-1", "len_mm": 30000, "w_mm": 1, "row_no": 99, "col_no": 1}]),
    ("TC-CNTR-069", [{"bunk_no": "B" * 60}]),
    ("TC-CNTR-070", [{"bunk_no": "BB-1"}, {"bunk_no": "BB-1", "_del": True}]),   # แถวที่ลบแล้วไม่นับซ้ำ
])
def test_validate_edges_pass(js, tid, rows):
    assert cp(js, "validatePlanRows", rows) == [], tid


@P
def test_sort_rows(js):
    """TC-CNTR-071 เรียง shipment → ตู้ (ไม่มีเลขตู้ไว้ท้าย) → แถว → ช่อง · เลขเรียงแบบตัวเลข (CNTR-9 ก่อน CNTR-10)"""
    rows = [
        {"shipment": "#BB06", "container_no": "", "bunk_no": "Z"},
        {"shipment": "#BB06", "container_no": "CNTR-010", "bunk_no": "B", "row_no": 1, "col_no": 1},
        {"shipment": "#BB06", "container_no": "CNTR-9", "bunk_no": "C", "row_no": 2, "col_no": 1},
        {"shipment": "#BB06", "container_no": "CNTR-9", "bunk_no": "D", "row_no": 1, "col_no": 2},
        {"shipment": "#BB04", "container_no": "CNTR-020", "bunk_no": "A"},
    ]
    assert [x["bunk_no"] for x in cp(js, "sortPlanRows", rows)] == ["A", "D", "C", "B", "Z"]


# ───────────────────────── ฐานข้อมูล (ในเครื่อง) ─────────────────────────
dbm = pytest.mark.db
SAVE = "select public.container_plan_save(%s,%s,%s::jsonb,%s::jsonb)"
LIST = "select public.container_plan_list(%s,%s)"


@pytest.fixture()
def need_cp(db):
    if not has_fn(db, "container_plan_save"):
        pytest.skip("ยังไม่ได้รัน migration-container-plan-2026-11-23.sql")


def save(conn, tok, pid, rows, delete=()):
    return one(conn, SAVE, (tok, pid, json.dumps(rows), json.dumps([str(x) for x in delete])))


def plan(conn, tok, pid):
    return one(conn, LIST, (tok, pid))


ROW = {"shipment": "#BB06", "container_no": "CNTR-013", "bunk_no": "PYT-BK-01", "row_no": 1, "col_no": 2, "len_mm": 3440, "w_mm": 1140}


@dbm
@P
def test_db_save_and_list(db, actors, project, need_cp):
    """TC-CNTR-080 บันทึก 2 บั้ง → อ่านกลับได้ครบทุกช่อง"""
    r = save(db, actors.tok["office"], project, [ROW, {**ROW, "bunk_no": "PYT-BK-02", "col_no": 3}])
    assert (r["ok"], r["saved"]) == (True, 2)
    got = plan(db, actors.tok["office"], project)
    assert [(x["bunk_no"], x["container_no"], x["shipment"], x["row_no"], x["col_no"], float(x["len_mm"]), float(x["w_mm"])) for x in got] == [
        ("PYT-BK-01", "CNTR-013", "#BB06", 1, 2, 3440.0, 1140.0), ("PYT-BK-02", "CNTR-013", "#BB06", 1, 3, 3440.0, 1140.0)]
    assert got[0]["bunk"] is None   # ยังไม่มีบั้งนี้ในระบบ


@dbm
@P
def test_db_same_bunk_again_updates_not_duplicates(db, actors, project, need_cp):
    """TC-CNTR-081 นำเข้าบั้งเดิมซ้ำ (ไม่มี id · ตัวพิมพ์เล็ก) = แก้แถวเดิม ไม่เพิ่มแถว"""
    save(db, actors.tok["office"], project, [ROW])
    r = save(db, actors.tok["office"], project, [{**ROW, "bunk_no": "pyt-bk-01", "container_no": "cntr-014"}])
    assert r["ok"] is True
    assert q(db, "select bunk_no, container_no from container_plan where project_id=%s", (project,)) == [("PYT-BK-01", "CNTR-014")]


@dbm
@P
def test_db_edit_by_id_and_delete(db, actors, project, need_cp):
    """TC-CNTR-082 แก้เลขบั้งของแถวเดิม (ส่ง id) + ลบอีกแถว"""
    save(db, actors.tok["office"], project, [ROW, {**ROW, "bunk_no": "PYT-BK-02"}])
    ids = dict(q(db, "select bunk_no, id from container_plan where project_id=%s", (project,)))
    r = save(db, actors.tok["office"], project, [{**ROW, "id": str(ids["PYT-BK-01"]), "bunk_no": "PYT-BK-01X"}], delete=[ids["PYT-BK-02"]])
    assert (r["ok"], r["saved"], r["deleted"]) == (True, 1, 1)
    assert q(db, "select bunk_no from container_plan where project_id=%s", (project,)) == [("PYT-BK-01X",)]


@dbm
@N
def test_db_rename_to_existing_bunk_rejected_all_or_nothing(db, actors, project, need_cp):
    """TC-CNTR-083 แก้เลขบั้งไปชนแถวอื่น → ไม่ผ่าน และแถวอื่นในชุดเดียวกันไม่ถูกบันทึกด้วย"""
    save(db, actors.tok["office"], project, [ROW, {**ROW, "bunk_no": "PYT-BK-02"}])
    ids = dict(q(db, "select bunk_no, id from container_plan where project_id=%s", (project,)))
    r = save(db, actors.tok["office"], project, [{**ROW, "bunk_no": "PYT-BK-03"}, {**ROW, "id": str(ids["PYT-BK-02"]), "bunk_no": "PYT-BK-01"}])
    assert (r["ok"], r["reason"]) == (False, "duplicate")
    assert sorted(x[0] for x in q(db, "select bunk_no from container_plan where project_id=%s", (project,))) == ["PYT-BK-01", "PYT-BK-02"]


@dbm
@N
@pytest.mark.parametrize("tid,patch,reason", [
    ("TC-CNTR-084", {"bunk_no": ""}, "bad_bunk"),
    ("TC-CNTR-085", {"bunk_no": "B" * 61}, "bad_bunk"),
    ("TC-CNTR-086", {"len_mm": "abc"}, "bad_number"),
    ("TC-CNTR-087", {"len_mm": 0}, "bad_number"),
    ("TC-CNTR-088", {"row_no": 100}, "bad_number"),
    ("TC-CNTR-089", {"w_mm": 30001}, "bad_number"),
])
def test_db_bad_rows_rejected(db, actors, project, need_cp, tid, patch, reason):
    r = save(db, actors.tok["office"], project, [{**ROW, **patch}])
    assert (r["ok"], r["reason"]) == (False, reason), tid
    assert one(db, "select count(*) from container_plan where project_id=%s", (project,)) == 0, tid


@dbm
@B
def test_db_edge_values_accepted(db, actors, project, need_cp):
    """TC-CNTR-090 ค่าขอบ: เลขบั้ง 60 ตัว · ขนาด 30000 / 1 · แถว 99 · ช่องว่างทั้งหมด"""
    r = save(db, actors.tok["office"], project, [
        {**ROW, "bunk_no": "B" * 60, "len_mm": 30000, "w_mm": 1, "row_no": 99, "col_no": 1},
        {"bunk_no": "PYT-BK-EMPTY", "shipment": "", "container_no": "", "row_no": "", "col_no": "", "len_mm": "", "w_mm": ""}])
    assert (r["ok"], r["saved"]) == (True, 2)
    assert q(db, "select container_no, row_no, len_mm from container_plan where project_id=%s and bunk_no='PYT-BK-EMPTY'", (project,)) == [("", None, None)]


@dbm
@N
def test_db_operator_cannot_save_or_list(db, actors, project, need_cp):
    """TC-CNTR-091 พนักงานหน้าเครื่อง บันทึก / อ่านแผนลงตู้ไม่ได้"""
    for fn in (lambda: save(db, actors.tok["operator"], project, [ROW]), lambda: plan(db, actors.tok["operator"], project)):
        with pytest.raises(Exception) as e:
            fn()
        assert "forbidden" in str(e.value)
    assert one(db, "select count(*) from container_plan where project_id=%s", (project,)) == 0


@dbm
@N
def test_db_no_session(db, project, need_cp):
    """TC-CNTR-092 ไม่มี session → ไม่ผ่าน"""
    with pytest.raises(Exception) as e:
        save(db, None, project, [ROW])
    assert "unauthorized" in str(e.value)


@dbm
@N
def test_db_anon_cannot_read_table(db, need_cp):
    """TC-CNTR-093 anon อ่านตาราง container_plan ตรง ๆ ไม่ได้ (ต้องผ่าน RPC)"""
    assert one(db, "select has_table_privilege('anon', 'public.container_plan', 'select')") is False


@dbm
@R
def test_db_cannot_touch_other_project_rows(db, actors, project, need_cp):
    """TC-CNTR-094 ส่ง id / รายการลบ ของโปรเจคอื่น → ไม่แตะแถวของโปรเจคนั้น"""
    other = one(db, "insert into projects(code,name) values(%s,%s) returning id", ("PYT-CP2-" + actors.tag, "pytest (ข้อมูลจำลอง)"))
    try:
        save(db, actors.tok["office"], other, [ROW])
        oid = one(db, "select id from container_plan where project_id=%s", (other,))
        r = save(db, actors.tok["office"], project, [{**ROW, "id": str(oid), "bunk_no": "PYT-HACK"}])
        assert (r["ok"], r["reason"]) == (False, "not_found")
        r = save(db, actors.tok["office"], project, [], delete=[oid])
        assert (r["ok"], r["deleted"]) == (True, 0)
        assert q(db, "select bunk_no from container_plan where project_id=%s", (other,)) == [("PYT-BK-01",)]
    finally:
        db.execute("delete from projects where id=%s", (other,))


@dbm
@P
def test_db_list_shows_bunk_in_system(db, actors, project, need_cp):
    """TC-CNTR-095 มีบั้ง (package) เลขเดียวกันในโปรเจค → รายการบอกจำนวนยูนิตในบั้ง + ที่แพ็กแล้ว"""
    db.execute("insert into part_master(project_id, part_no, part_name, kind, pkg_manifest) values(%s,'PYT-BK-01','bunk','package',%s::jsonb)",
               (project, json.dumps([{"unit_no": "U1"}, {"unit_no": "U2"}, {"unit_no": "U3"}])))
    save(db, actors.tok["office"], project, [ROW])
    b = plan(db, actors.tok["office"], project)[0]["bunk"]
    assert (b["kind"], b["units"], b["packed"]) == ("package", 3, 0)


@dbm
@R
def test_db_project_delete_removes_plan(db, actors, need_cp):
    """TC-CNTR-096 ลบโปรเจค → แผนลงตู้ของโปรเจคนั้นหายตาม (ไม่ค้างเป็นขยะ)"""
    pid = one(db, "insert into projects(code,name) values(%s,%s) returning id", ("PYT-CP3-" + actors.tag, "pytest (ข้อมูลจำลอง)"))
    save(db, actors.tok["office"], pid, [ROW])
    db.execute("delete from projects where id=%s", (pid,))
    assert one(db, "select count(*) from container_plan where project_id=%s", (pid,)) == 0
