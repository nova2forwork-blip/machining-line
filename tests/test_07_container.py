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
    # 23/11/2026 ผลลัพธ์มีช่องวันที่ของชิปเพิ่ม (dates / dateSheet) — ไม่มีชีตก็ต้องว่างเช่นกัน
    assert cp(js, "parseContainerSheets", []) == {"rows": [], "warn": [], "sheets": [], "dates": {}, "dateSheet": {}}


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


# ───────────────────────── Excel แผนส่งของ (Shipment / Pallet No.) ─────────────────────────
PLAN_SHEET = {"name": "Shipment Tower B", "rows": [
    ["Plan Ship", "", "", "", "TOWER B"],
    ["No.", "Shipment", "LOADING", "Description", "Pallet No.", "Q'ty  (Bunk)", "Q'ty  (Unit)", "Q'ty  (Box)", "Q'ty Container"],
    [1, "#BB02", "16 Jul 2026", "Starter Sill", "BB-L01-SE, BB-L01-SW  (ไปกับ Shipment 25)", "", "", "", "1X40'"],
    ["", "", "", "", "BB-L02-SW", "", "", 3],
    ["", "", "", "", "TOTAL", "", "", 3],
    [6, "#BB06", "14 Nov 26", "L3", "BB-L04-C01,BB-L03-C02", 2, 8, "", "1X40'", "Con No.13"],
    ["", "", "", "", "BB-L03-C07, BB-L03-C08", 2, 8, "", "1X40'", "Con No.14"],
    ["", "", "", "CASTOR CAGE", "CAGE-01 #01, CAGE-01 #02", "", "", 2],
]}


@P
def test_excel_plan_sheet(js):
    """TC-CNTR-100 ชีตแผนส่งของ: 1 ช่องหลายบั้ง · shipment ว่าง = ของแถวบน · "Con No.13" = CNTR-013 · ไม่มี Con No. = ยังไม่ระบุตู้"""
    r = cp(js, "parseContainerSheets", [PLAN_SHEET])
    got = [(x["bunk_no"], x["shipment"], x["container_no"]) for x in r["rows"]]
    assert got == [
        ("BB-L01-SE", "#BB02", ""), ("BB-L01-SW", "#BB02", ""), ("BB-L02-SW", "#BB02", ""),
        ("BB-L04-C01", "#BB06", "CNTR-013"), ("BB-L03-C02", "#BB06", "CNTR-013"),
        ("BB-L03-C07", "#BB06", "CNTR-014"), ("BB-L03-C08", "#BB06", "CNTR-014"),
        ("CAGE-01 #01", "#BB06", ""), ("CAGE-01 #02", "#BB06", ""),
    ]


@N
def test_excel_plan_sheet_skips_total_and_notes(js):
    """TC-CNTR-101 แถว TOTAL และข้อความในวงเล็บ ไม่กลายเป็นบั้ง"""
    names = [x["bunk_no"] for x in cp(js, "parseContainerSheets", [PLAN_SHEET])["rows"]]
    assert "TOTAL" not in names and not any("SHIPMENT 25" in n or "(" in n for n in names)


@R
def test_excel_plan_sheets_are_tagged_for_choice(js):
    """TC-CNTR-102 ไฟล์มี 2 ตึกคนละชีต → แถวติดชื่อชีต + ชีตถูกระบุว่าเป็นแผนส่งของ (ให้หน้าจอถามว่าจะเอาชีตไหน)"""
    a = {"name": "Shipment Tower A", "rows": [["No.", "Shipment", "LOADING", "Description", "Pallet No."], [1, "#6", "", "ANCHOR", "BP-L2-A1, BP-L3-A1"]]}
    r = cp(js, "parseContainerSheets", [a, PLAN_SHEET])
    assert [(s["name"], s["n"], s.get("kind")) for s in r["sheets"]] == [("Shipment Tower A", 2, "plan"), ("Shipment Tower B", 9, "plan")]
    assert {x["sheet"] for x in r["rows"]} == {"Shipment Tower A", "Shipment Tower B"}
    assert [x["shipment"] for x in r["rows"][:2]] == ["#06", "#06"]


# ───────────────────────── ฐานข้อมูล: ย้ายแผงข้ามบั้ง ─────────────────────────
MOVE = "select public.bunk_move_units(%s,%s,%s,%s,%s::jsonb)"
BOARD = "select public.bunk_board(%s,%s)"


@pytest.fixture()
def need_bm(db, need_cp):
    if not has_fn(db, "bunk_move_units"):
        pytest.skip("ยังไม่ได้รัน migration-bunk-edit-2026-11-23.sql")


def _row(unit, pos, w=100.0):
    return {"no": 0, "unit_no": unit, "position": pos, "address_seq": f"03-N-{unit[-3:]}", "qty": 1, "weight": w, "sqm": 2.5}


def _bunk(db, pid, no, rows):
    """สร้างบั้ง (package) + ใบบั้ง + QR 1 ดวง → (pm_id, unit_id)"""
    pm = one(db, "insert into part_master(project_id, part_no, part_name, kind, pkg_manifest, pkg_meta) values(%s,%s,%s,'package',%s::jsonb,%s::jsonb) returning id",
             (pid, no, no, json.dumps(rows), json.dumps({"bunk_no": no, "pack_type": "panel", "total_qty": len(rows)})))
    rel = one(db, "insert into releases(part_master_id, qty, release_order) values(%s,1,'P-100') returning id", (pm,))
    u = one(db, "insert into part_units(release_id, part_master_id, unit_no, qr_code) values(%s,%s,1,%s) returning id", (rel, pm, f"PYT-{no}-{str(pm)[:8]}"))
    return pm, u


def _panel(db, pid, no, qty=1):
    pm = one(db, "insert into part_master(project_id, part_no, part_name, kind) values(%s,%s,'panel','panel') returning id", (pid, no))
    rel = one(db, "insert into releases(part_master_id, qty, release_order) values(%s,%s,'P-005') returning id", (pm, qty))
    us = [one(db, "insert into part_units(release_id, part_master_id, unit_no, qr_code) values(%s,%s,%s,%s) returning id", (rel, pm, i, f"PYT-{no}-{i}-{str(pm)[:8]}")) for i in range(1, qty + 1)]
    return pm, us


@pytest.fixture()
def two_bunks(db, actors, project, need_bm):
    """บั้ง A: UA1 (A) · UA2 (B) · UA2 (C) · UA3 (D)   ·   บั้ง B: UA1 (A)"""
    panels = {"PYT-UA1": _panel(db, project, "PYT-UA1", 2), "PYT-UA2": _panel(db, project, "PYT-UA2", 2), "PYT-UA3": _panel(db, project, "PYT-UA3", 1)}
    a = _bunk(db, project, "PYT-BK-A", [_row("PYT-UA1", "A"), _row("PYT-UA2", "B"), _row("PYT-UA2", "C"), _row("PYT-UA3", "D", 50.5)])
    b = _bunk(db, project, "PYT-BK-B", [_row("PYT-UA1", "A")])
    yield {"a": a, "b": b, "panels": panels}
    db.execute("delete from assembly_links where parent_unit_id in (%s,%s)", (a[1], b[1]))


def move(db, tok, pid, frm, to, moves):
    return one(db, MOVE, (tok, pid, frm, to, json.dumps(moves)))


def manifest(db, pm):
    return [(x.get("no"), x["unit_no"], x.get("position")) for x in one(db, "select pkg_manifest from part_master where id=%s", (pm,))]


def bom(db, pm):
    return q(db, "select c.part_no, b.qty from bom_components b join part_master c on c.id=b.child_pm_id where b.parent_pm_id=%s order by 1", (pm,))


@dbm
@P
def test_db_move_one_panel(db, actors, project, two_bunks):
    """TC-CNTR-110 ย้ายแผง 1 แผง (UA3) จากบั้ง A → B: ใบบั้ง · BOM · ยอดรวม ของทั้งสองบั้งเปลี่ยนตาม"""
    a, b = two_bunks["a"][0], two_bunks["b"][0]
    r = move(db, actors.tok["office"], project, a, b, [{"idx": 3, "unit_no": "PYT-UA3"}])
    assert (r["ok"], r["moved"], r["from_left"], r["to_total"]) == (True, 1, 3, 2)
    assert manifest(db, a) == [(1, "PYT-UA1", "A"), (2, "PYT-UA2", "B"), (3, "PYT-UA2", "C")]
    assert manifest(db, b) == [(1, "PYT-UA1", "A"), (2, "PYT-UA3", "D")]
    assert bom(db, a) == [("PYT-UA1", 1), ("PYT-UA2", 2)] and bom(db, b) == [("PYT-UA1", 1), ("PYT-UA3", 1)]
    ma, mb = (one(db, "select pkg_meta from part_master where id=%s", (x,)) for x in (a, b))
    assert (float(ma["total_qty"]), float(ma["total_weight"]), ma["bunk_no"], ma["pack_type"]) == (3.0, 300.0, "PYT-BK-A", "panel")
    assert (float(mb["total_qty"]), float(mb["total_weight"])) == (2.0, 150.5)


@dbm
@B
def test_db_move_position_clash_is_cleared(db, actors, project, two_bunks):
    """TC-CNTR-111 แผงที่ย้ายมีตำแหน่ง A ชนกับบั้งปลายทาง (มี A แล้ว) → ล้างตำแหน่ง ให้กำหนดใหม่"""
    a, b = two_bunks["a"][0], two_bunks["b"][0]
    assert move(db, actors.tok["office"], project, a, b, [{"idx": 0, "unit_no": "PYT-UA1"}])["ok"] is True
    assert manifest(db, b) == [(1, "PYT-UA1", "A"), (2, "PYT-UA1", "")]
    assert bom(db, b) == [("PYT-UA1", 2)]


@dbm
@B
def test_db_move_everything_leaves_empty_bunk(db, actors, project, two_bunks):
    """TC-CNTR-112 ย้ายทุกแผงออก → บั้งต้นทางว่าง (ใบบั้งว่าง · ไม่มี BOM · ยอด 0)"""
    a, b = two_bunks["a"][0], two_bunks["b"][0]
    r = move(db, actors.tok["office"], project, a, b, [{"idx": i, "unit_no": u} for i, u in enumerate(["PYT-UA1", "PYT-UA2", "PYT-UA2", "PYT-UA3"])])
    assert (r["ok"], r["from_left"], r["to_total"]) == (True, 0, 5)
    assert manifest(db, a) == [] and bom(db, a) == []
    assert float(one(db, "select pkg_meta->>'total_qty' from part_master where id=%s", (a,))) == 0


@dbm
@N
def test_db_move_packed_panel_rejected(db, actors, project, two_bunks):
    """TC-CNTR-113 แผงที่สแกนแพ็กเข้าบั้งแล้ว ย้ายไม่ได้ และไม่มีอะไรเปลี่ยน"""
    a, b = two_bunks["a"], two_bunks["b"]
    pm3, us3 = two_bunks["panels"]["PYT-UA3"]
    db.execute("insert into assembly_links(parent_unit_id, child_unit_id, child_pm_id, qty) values(%s,%s,%s,1)", (a[1], us3[0], pm3))
    r = move(db, actors.tok["office"], project, a[0], b[0], [{"idx": 3, "unit_no": "PYT-UA3"}])
    assert (r["ok"], r["reason"], r["unit"], r["packed"]) == (False, "packed", "PYT-UA3", 1)
    assert len(manifest(db, a[0])) == 4 and len(manifest(db, b[0])) == 1


@dbm
@B
def test_db_move_unpacked_copy_of_partly_packed_panel(db, actors, project, two_bunks):
    """TC-CNTR-114 เบอร์เดียวกัน 2 แถว สแกนแล้ว 1 → ย้ายได้ 1 แถว · แถวสุดท้ายย้ายไม่ได้"""
    a, b = two_bunks["a"], two_bunks["b"]
    pm2, us2 = two_bunks["panels"]["PYT-UA2"]
    db.execute("insert into assembly_links(parent_unit_id, child_unit_id, child_pm_id, qty) values(%s,%s,%s,1)", (a[1], us2[0], pm2))
    assert move(db, actors.tok["office"], project, a[0], b[0], [{"idx": 2, "unit_no": "PYT-UA2"}])["ok"] is True
    r = move(db, actors.tok["office"], project, a[0], b[0], [{"idx": 1, "unit_no": "PYT-UA2"}])
    assert (r["ok"], r["reason"]) == (False, "packed")
    assert [m[1] for m in manifest(db, a[0])] == ["PYT-UA1", "PYT-UA2", "PYT-UA3"]


@dbm
@R
def test_db_move_stale_screen_rejected(db, actors, project, two_bunks):
    """TC-CNTR-115 หน้าจอค้างข้อมูลเก่า (ลำดับไม่ตรงกับเบอร์) → stale ไม่ย้ายผิดแผง"""
    a, b = two_bunks["a"][0], two_bunks["b"][0]
    for mv in ([{"idx": 0, "unit_no": "PYT-UA3"}], [{"idx": 9, "unit_no": "PYT-UA1"}]):
        r = move(db, actors.tok["office"], project, a, b, mv)
        assert (r["ok"], r["reason"]) == (False, "stale")
    assert len(manifest(db, a)) == 4


@dbm
@N
@pytest.mark.parametrize("tid,moves", [
    ("TC-CNTR-116", []),
    ("TC-CNTR-117", [{"idx": 0, "unit_no": "PYT-UA1"}, {"idx": 0, "unit_no": "PYT-UA1"}]),
    ("TC-CNTR-118", [{"idx": "x", "unit_no": "PYT-UA1"}]),
])
def test_db_move_bad_input(db, actors, project, two_bunks, tid, moves):
    r = move(db, actors.tok["office"], project, two_bunks["a"][0], two_bunks["b"][0], moves)
    assert (r["ok"], r["reason"]) == (False, "bad_input"), tid
    assert len(manifest(db, two_bunks["a"][0])) == 4, tid


@dbm
@N
def test_db_move_same_bunk_or_not_a_bunk(db, actors, project, two_bunks):
    """TC-CNTR-119 ปลายทางเป็นบั้งเดียวกัน → bad_input · ปลายทางเป็นแผง (ไม่ใช่บั้ง) → not_bunk"""
    a = two_bunks["a"][0]
    assert move(db, actors.tok["office"], project, a, a, [{"idx": 0, "unit_no": "PYT-UA1"}])["reason"] == "bad_input"
    assert move(db, actors.tok["office"], project, a, two_bunks["panels"]["PYT-UA1"][0], [{"idx": 0, "unit_no": "PYT-UA1"}])["reason"] == "not_bunk"
    assert len(manifest(db, a)) == 4


@dbm
@R
def test_db_move_other_project_bunk_rejected(db, actors, project, two_bunks):
    """TC-CNTR-120 ย้ายไปบั้งของโปรเจคอื่นไม่ได้"""
    other = one(db, "insert into projects(code,name) values(%s,%s) returning id", ("PYT-BM2-" + actors.tag, "pytest (ข้อมูลจำลอง)"))
    try:
        ob = _bunk(db, other, "PYT-BK-X", [])
        r = move(db, actors.tok["office"], project, two_bunks["a"][0], ob[0], [{"idx": 0, "unit_no": "PYT-UA1"}])
        assert (r["ok"], r["reason"]) == (False, "not_found")
        assert manifest(db, ob[0]) == []
    finally:
        db.execute("delete from part_units where part_master_id in (select id from part_master where project_id=%s)", (other,))
        db.execute("delete from releases where part_master_id in (select id from part_master where project_id=%s)", (other,))
        db.execute("delete from part_master where project_id=%s", (other,))
        db.execute("delete from projects where id=%s", (other,))


@dbm
@N
def test_db_move_and_board_need_office(db, actors, project, two_bunks):
    """TC-CNTR-121 พนักงานหน้าเครื่อง ย้ายแผง / เปิดหน้าจัดบั้งไม่ได้"""
    for fn in (lambda: move(db, actors.tok["operator"], project, two_bunks["a"][0], two_bunks["b"][0], [{"idx": 3, "unit_no": "PYT-UA3"}]),
               lambda: one(db, BOARD, (actors.tok["operator"], project))):
        with pytest.raises(Exception) as e:
            fn()
        assert "forbidden" in str(e.value)
    assert len(manifest(db, two_bunks["a"][0])) == 4


@dbm
@P
def test_db_board_lists_bunks_with_plan_and_packed(db, actors, project, two_bunks):
    """TC-CNTR-122 หน้าจัดบั้ง: ได้บั้งทั้งหมด + ใบบั้ง + ที่สแกนแล้ว + ชิป / ตู้ / ขนาดจากแผนลงตู้"""
    a = two_bunks["a"]
    pm3, us3 = two_bunks["panels"]["PYT-UA3"]
    db.execute("insert into assembly_links(parent_unit_id, child_unit_id, child_pm_id, qty) values(%s,%s,%s,1)", (a[1], us3[0], pm3))
    save(db, actors.tok["office"], project, [{**ROW, "bunk_no": "pyt-bk-a"}])
    got = {x["bunk_no"]: x for x in one(db, BOARD, (actors.tok["office"], project))}
    assert sorted(got) == ["PYT-BK-A", "PYT-BK-B"]
    assert len(got["PYT-BK-A"]["manifest"]) == 4 and got["PYT-BK-A"]["packed"] == [{"part_no": "PYT-UA3", "qty": 1}]
    pl = got["PYT-BK-A"]["plan"]
    assert (pl["shipment"], pl["container_no"], pl["row_no"], float(pl["len_mm"])) == ("#BB06", "CNTR-013", 1, 3440.0)
    assert got["PYT-BK-B"]["plan"] is None and got["PYT-BK-B"]["packed"] == []


# ───────────────────────── ส่งออก Excel / หน้าพิมพ์ ─────────────────────────
def px(js, fn, *args):
    return js(fn, *args, m="px")


ITEMS = [
    {"bunk_no": "BB-L03-C03", "shipment": "#BB06", "container_no": "CNTR-014", "row_no": None, "col_no": None, "len_mm": 3820, "w_mm": 1140, "packed": 0,
     "manifest": [{"position": "A", "unit_no": "UA0315", "address_seq": "03-N-258", "width": 1600.2, "height": 3276.6, "weight": 597.44, "qty": 1}]},
    {"bunk_no": "BB-L03-C02", "shipment": "#BB06", "load_date": "2026-11-14", "container_no": "CNTR-013", "row_no": 1, "col_no": 1, "len_mm": 3440, "w_mm": 1140, "packed": 2,
     "manifest": [{"position": "A", "unit_no": "UA0315", "address_seq": "03-N-258", "width": 1600.2, "height": 3276.6, "weight": 100.5},
                  {"position": "C", "unit_no": "UA0336", "address_seq": "03-N-260", "width": 1066.8, "height": 3276.6, "weight": 200.25, "qty": 2}]},
    {"bunk_no": "BB-L01-C01", "shipment": "#BB04", "container_no": "", "manifest": []},
]


@P
def test_export_sheets(js):
    """TC-CNTR-130 ตาราง Excel: เรียง ชิป → ตู้ · 1 แถวต่อบั้ง (วันที่ชิป · จำนวนแผง · น้ำหนักรวม) · 1 แถวต่อแผง"""
    r = px(js, "packSheets", ITEMS)
    assert r["bunks"][0] == ["Shipment", "Loading date", "Container", "Bunk No.", "Row", "Slot", "Length (mm)", "Width (mm)", "Units", "Packed", "Weight"]
    assert r["bunks"][1:] == [
        ["#BB04", "", "", "BB-L01-C01", "", "", "", "", "", "", ""],
        ["#BB06", "2026-11-14", "CNTR-013", "BB-L03-C02", 1, 1, 3440, 1140, 3, 2, 300.75],
        ["#BB06", "", "CNTR-014", "BB-L03-C03", "", "", 3820, 1140, 1, 0, 597.44],
    ]
    assert r["units"][0][:2] == ["Shipment", "Loading date"]
    assert [u[3:7] for u in r["units"][1:]] == [["BB-L03-C02", "A", "UA0315", "03-N-258"], ["BB-L03-C02", "C", "UA0336", "03-N-260"], ["BB-L03-C03", "A", "UA0315", "03-N-258"]]
    assert r["units"][1][1] == "2026-11-14" and r["units"][2][9] == 2 and r["units"][1][9] == 1   # ไม่มี qty = 1


@B
def test_export_sheets_empty(js):
    """TC-CNTR-131 ไม่มีรายการ → มีแต่หัวตาราง"""
    r = px(js, "packSheets", [])
    assert len(r["bunks"]) == 1 and len(r["units"]) == 1


@P
def test_export_print_html(js):
    """TC-CNTR-132 หน้าพิมพ์: มีหัวเรื่อง · ชิป · ตู้ · บั้ง · แผง · บั้งไม่มีเลขตู้อยู่ใต้ "ยังไม่ระบุตู้\""""
    h = px(js, "packPrintHtml", ITEMS, {"title": "A100 แผนแพ็ก", "sub": "ทดสอบ"})
    for word in ("A100 แผนแพ็ก", "Shipment #BB06 — 14/11/2026", "Shipment #BB04", "ตู้ CNTR-013", "ตู้ CNTR-014", "ยังไม่ระบุตู้", "BB-L03-C02", "UA0336", "03-N-260", "แพ็กแล้ว 2"):
        assert word in h, word
    assert h.index("Shipment #BB04") < h.index("Shipment #BB06") and h.index("CNTR-013") < h.index("CNTR-014")


@N
def test_export_print_html_escapes(js):
    """TC-CNTR-133 ข้อความที่มี < > & ในเลขบั้ง / หัวเรื่อง ไม่กลายเป็นโค้ดในหน้าพิมพ์"""
    h = px(js, "packPrintHtml", [{"bunk_no": "<img src=x onerror=alert(1)>", "shipment": "#1&2", "container_no": "", "manifest": []}], {"title": "<b>x</b>"})
    assert "<img src=x" not in h and "&lt;img src=x" in h and "#1&amp;2" in h and "<b>x</b>" not in h


# ───────────────────────── วันที่ของชิป ─────────────────────────
@pytest.mark.parametrize("tid,raw,exp", [
    pytest.param("TC-CNTR-140", "16 Jul 2026", "2026-07-16", marks=P),
    pytest.param("TC-CNTR-141", "5 Aug 26", "2026-08-05", marks=P),
    pytest.param("TC-CNTR-142", "14-Nov-26", "2026-11-14", marks=P),
    pytest.param("TC-CNTR-143", "2026-11-14", "2026-11-14", marks=P),
    pytest.param("TC-CNTR-144", "14/11/2026", "2026-11-14", marks=P),      # วัน/เดือน/ปี
    pytest.param("TC-CNTR-145", "14/11/2569", "2026-11-14", marks=P),      # ปี พ.ศ.
    pytest.param("TC-CNTR-146", 46340, "2026-11-14", marks=P),             # เลขวันที่ของ Excel
    pytest.param("TC-CNTR-147", 36526, "2000-01-01", marks=B),             # ขอบล่าง
    pytest.param("TC-CNTR-148", 73415, "2100-12-31", marks=B),             # ขอบบน
    pytest.param("TC-CNTR-149", 36525, "", marks=B),                       # ต่ำกว่าช่วง 1 วัน
    pytest.param("TC-CNTR-150", 73416, "", marks=B),                       # เกินช่วง 1 วัน
    pytest.param("TC-CNTR-151", "29 Feb 2028", "2028-02-29", marks=B),     # ปีอธิกสุรทิน
    pytest.param("TC-CNTR-152", "29 Feb 2027", "", marks=N),
    pytest.param("TC-CNTR-153", "31 Apr 26", "", marks=N),
    pytest.param("TC-CNTR-154", "TBA", "", marks=N),
    pytest.param("TC-CNTR-155", "", "", marks=B),
    pytest.param("TC-CNTR-156", None, "", marks=B),
    pytest.param("TC-CNTR-157", "13/13/2026", "", marks=N),
])
def test_parse_load_date(js, tid, raw, exp):
    assert cp(js, "parseLoadDate", raw) == exp, tid


@P
def test_excel_plan_sheet_dates(js):
    """TC-CNTR-158 แผนส่งของ: วันที่อยู่คอลัมน์ LOADING แถวเดียวกับเลขชิป → ได้วันที่ต่อชิป · ชิปที่อ่านวันที่ไม่ออกไม่มีค่า"""
    sh = {"name": "Shipment Tower B", "rows": [
        ["No.", "Shipment", "LOADING", "Description", "Pallet No."],
        [1, "#BB02", "16 Jul 2026", "Starter Sill", "BB-L01-SE"],
        ["", "", "", "", "BB-L02-SW"],
        [6, "#BB06", 46340, "L3", "BB-L03-C02", "", "", "", "", "Con No.13"],
        [7, "#BB07", "TBA", "L4", "BB-L04-C02"],
    ]}
    r = cp(js, "parseContainerSheets", [sh])
    assert r["dates"] == {"#BB02": "2026-07-16", "#BB06": "2026-11-14"}
    assert r["dateSheet"]["#BB06"] == "Shipment Tower B"


DSET = "select public.shipment_dates_set(%s,%s,%s::jsonb)"
DGET = "select public.shipment_dates_get(%s,%s)"


@pytest.fixture()
def need_sd(db, need_cp):
    if not has_fn(db, "shipment_dates_set"):
        pytest.skip("ยังไม่ได้รัน migration-container-plan-2026-11-23.sql (ส่วนวันที่ชิป)")


@dbm
@P
def test_db_shipment_dates_set_get_clear(db, actors, project, need_sd):
    """TC-CNTR-160 ตั้งวันที่ 2 ชิป → อ่านกลับ · แก้ 1 ชิป · ค่าว่าง = ลบวันที่ของชิปนั้น"""
    tok = actors.tok["office"]
    assert one(db, DSET, (tok, project, json.dumps({"#BB06": "2026-11-14", "#BB07": "2026-11-23"})))["ok"] is True
    assert one(db, DGET, (tok, project)) == {"#BB06": "2026-11-14", "#BB07": "2026-11-23"}
    assert one(db, DSET, (tok, project, json.dumps({"#BB06": "2026-11-15", "#BB07": ""})))["ok"] is True
    assert one(db, DGET, (tok, project)) == {"#BB06": "2026-11-15"}


@dbm
@N
@pytest.mark.parametrize("tid,dates,reason", [
    ("TC-CNTR-161", {"#BB06": "14/11/2026"}, "bad_date"),
    ("TC-CNTR-162", {"#BB06": "2026-02-30"}, "bad_date"),
    ("TC-CNTR-163", {"#BB06": "1999-12-31"}, "bad_date"),
    ("TC-CNTR-164", {"#BB06": "2101-01-01"}, "bad_date"),
    ("TC-CNTR-165", {"": "2026-11-14"}, "bad_shipment"),
    ("TC-CNTR-166", {"S" * 41: "2026-11-14"}, "bad_shipment"),
])
def test_db_shipment_dates_bad_all_or_nothing(db, actors, project, need_sd, tid, dates, reason):
    r = one(db, DSET, (actors.tok["office"], project, json.dumps({"#OK01": "2026-11-14", **dates})))
    assert (r["ok"], r["reason"]) == (False, reason), tid
    assert one(db, DGET, (actors.tok["office"], project)) == {}, tid   # ชิปที่ถูกต้องในชุดเดียวกันก็ไม่ถูกบันทึก


@dbm
@B
def test_db_shipment_dates_edges(db, actors, project, need_sd):
    """TC-CNTR-167 ค่าขอบ: 2000-01-01 · 2100-12-31 · ชื่อชิป 40 ตัวอักษร"""
    d = {"#A": "2000-01-01", "#B": "2100-12-31", "S" * 40: "2026-01-01"}
    assert one(db, DSET, (actors.tok["office"], project, json.dumps(d)))["ok"] is True
    assert one(db, DGET, (actors.tok["office"], project)) == d


@dbm
@N
def test_db_shipment_dates_need_office_and_are_per_project(db, actors, project, need_sd):
    """TC-CNTR-168 พนักงานหน้าเครื่องอ่าน / เขียนไม่ได้ · วันที่ของโปรเจคหนึ่งไม่โผล่ในอีกโปรเจค · anon อ่านตารางตรงไม่ได้"""
    for fn in (lambda: one(db, DSET, (actors.tok["operator"], project, json.dumps({"#BB06": "2026-11-14"}))), lambda: one(db, DGET, (actors.tok["operator"], project))):
        with pytest.raises(Exception) as e:
            fn()
        assert "forbidden" in str(e.value)
    other = one(db, "insert into projects(code,name) values(%s,%s) returning id", ("PYT-SD2-" + actors.tag, "pytest (ข้อมูลจำลอง)"))
    try:
        one(db, DSET, (actors.tok["office"], other, json.dumps({"#BB06": "2026-11-14"})))
        assert one(db, DGET, (actors.tok["office"], project)) == {}
    finally:
        db.execute("delete from projects where id=%s", (other,))
    assert one(db, "select count(*) from container_shipment where project_id=%s", (other,)) == 0   # ลบโปรเจค = วันที่หายตาม
    assert one(db, "select has_table_privilege('anon', 'public.container_shipment', 'select')") is False
