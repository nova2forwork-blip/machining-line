"""TC-UNIT — Address & Unit (วางจาก Excel · ชั้น · Mockup · ตรวจซ้ำ) และตัวแปลงความยาวนิ้ว

ที่มาของผลที่คาด: ผู้ใช้ 2026-11-12 "Address ขึ้นก่อน" · S6 ชั้นเขียนได้หลายแบบ = ตัวเดียวกัน · S10 (2026-11-18) วางแถวเดียว
Mockup PMU/VMU/EMU ไม่ต้องมี Address ระบบออก MOCK-xxx-n ให้ · "PMU-01 | 4" = 4 แผง
"""
import pytest

from conftest import jmap

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression


def rows(js, text):
    return js("parseUnitsPaste", text)


@P
def test_paste_with_header(js):
    """TC-UNIT-001 มีหัวตาราง Unit | Address (สลับลำดับได้)"""
    r = rows(js, "Unit\tAddress\nUA1001\t25-E-301\nUA1002\t25-E-302")
    assert r["rows"] == [{"unit": "UA1001", "addr": "25-E-301"}, {"unit": "UA1002", "addr": "25-E-302"}]
    assert r["skipped"] == 0


@P
def test_paste_no_header_detects_unit_column(js):
    """TC-UNIT-002 ไม่มีหัว: คอลัมน์ที่หน้าตาเป็น UAxxxx = Unit (อยู่ซ้ายหรือขวาก็ได้)"""
    a = rows(js, "25-E-301\tUA1001\n25-E-302\tUA1002")["rows"]
    b = rows(js, "UA1001\t25-E-301\nUA1002\t25-E-302")["rows"]
    assert a == b == [{"unit": "UA1001", "addr": "25-E-301"}, {"unit": "UA1002", "addr": "25-E-302"}]


@R
def test_paste_address_first_when_unknown(js):
    """TC-UNIT-003 ผู้ใช้ 2026-11-12: ดูไม่ออกว่าคอลัมน์ไหนเป็น Unit → ถือว่า Address | Unit"""
    r = rows(js, "A-101\tMTG01-5001\nA-102\tMTG01-5002")["rows"]
    assert r == [{"unit": "MTG01-5001", "addr": "A-101"}, {"unit": "MTG01-5002", "addr": "A-102"}]


@R
def test_paste_single_row_not_treated_as_header(js):
    """TC-UNIT-004 (S10 2026-11-18) วางแถวเดียวที่ Unit ไม่ใช่ UAxxxx ต้องได้ 1 แถว ไม่ใช่ "ไม่พบข้อมูล\""""
    assert rows(js, "A-101\tMTG01-5001")["rows"] == [{"unit": "MTG01-5001", "addr": "A-101"}]


@P
def test_paste_lowercase_and_spaces(js):
    """TC-UNIT-005 ตัวพิมพ์เล็ก / ช่องว่างหัวท้าย → ตัวพิมพ์ใหญ่ ตัดช่องว่าง"""
    assert rows(js, " 25-e-301 \t ua1001 \r\n")["rows"] == [{"unit": "UA1001", "addr": "25-E-301"}]


@N
@pytest.mark.parametrize("tid,text", [("TC-UNIT-006", ""), ("TC-UNIT-007", "\n\n  \n"), ("TC-UNIT-008", None)])
def test_paste_empty(js, tid, text):
    assert rows(js, text)["rows"] == [], tid


@B
def test_paste_blank_lines_between_rows(js):
    """TC-UNIT-009 บรรทัดว่างคั่นกลาง ไม่ทำให้แถวหาย"""
    assert len(rows(js, "25-E-301\tUA1001\n\n25-E-302\tUA1002\n")["rows"]) == 2


@P
def test_paste_floor_with_header(js):
    """TC-UNIT-010 คอลัมน์ ชั้น (มีหัว)"""
    r = rows(js, "Address\tUnit\tFloor\n25-E-301\tUA1001\tL14\n25-E-302\tUA1002\tLOB")["rows"]
    assert r == [{"unit": "UA1001", "addr": "25-E-301", "floor": "L14"}, {"unit": "UA1002", "addr": "25-E-302", "floor": "LOB"}]


@R
def test_paste_numeric_floor_without_header(js):
    """TC-UNIT-011 (S6) ไม่มีหัว + ชั้นเป็นตัวเลขล้วน ต้องไม่หายเงียบ"""
    r = rows(js, "25-E-301\tUA1001\t14\n25-E-302\tUA1002\t14")["rows"]
    assert [x.get("floor") for x in r] == ["L14", "L14"]


@P
def test_paste_mockup_quantity(js):
    """TC-UNIT-012 "PMU-01 | 4" = Mockup 4 แผง ไม่ใช่ที่อยู่ชื่อ 4"""
    assert rows(js, "PMU-01\t4")["rows"] == [{"unit": "PMU-01", "addr": "", "mock": True, "qty": 4}]


@B
def test_paste_extra_columns_reported(js):
    """TC-UNIT-013 คอลัมน์ที่ไม่รู้ว่าเป็นอะไร ต้องบอกผู้ใช้ (extraCols) ไม่ทิ้งเงียบ"""
    r = rows(js, "25-E-301\tUA1001\tหมายเหตุอะไรสักอย่าง\n25-E-302\tUA1002\tอีกอัน")
    assert len(r["rows"]) == 2 and r["extraCols"] == [3]


# ── ชั้น ──
@P
@pytest.mark.parametrize("tid,raw", [
    ("TC-UNIT-020", "1"), ("TC-UNIT-021", "01"), ("TC-UNIT-022", "L1"), ("TC-UNIT-023", "L01"),
    ("TC-UNIT-024", "ชั้น 1"), ("TC-UNIT-025", "Floor 1"), ("TC-UNIT-026", "Level 1"), ("TC-UNIT-027", "LV1"), ("TC-UNIT-028", " l1 "),
])
def test_norm_floor_same_floor(js, tid, raw):
    assert js("normFloor", raw) == "L1", tid


@B
@pytest.mark.parametrize("tid,raw,exp", [
    ("TC-UNIT-029", "B1", "B1"), ("TC-UNIT-030", "lob", "LOB"), ("TC-UNIT-031", "", ""), ("TC-UNIT-032", None, ""),
    ("TC-UNIT-033", "14", "L14"), ("TC-UNIT-034", "L14", "L14"), ("TC-UNIT-035", "Roof", "ROOF"),
])
def test_norm_floor_others(js, tid, raw, exp):
    assert js("normFloor", raw) == exp, tid


@R
def test_floors_of_merges_same_floor(js):
    """TC-UNIT-036 (S6) "14" กับ "L14" นับเป็นชั้นเดียวกัน"""
    f = js("floorsOf", [{"floor": "14"}, {"floor": "L14"}, {"floor": "L2"}, {}])
    assert f == [{"f": "L2", "n": 1}, {"f": "L14", "n": 2}, {"f": "", "n": 1}]


# ── ตรวจ Address & Unit ──
@P
def test_unit_issues_clean(js):
    """TC-UNIT-040"""
    r = js("unitIssues", [{"unit": "UA1001", "addr": "25-E-301"}, {"unit": "UA1001A", "addr": "25-E-302"}], None)
    assert r == {"row": {}, "block": [], "warn": []}


@N
def test_unit_issues_incomplete(js):
    """TC-UNIT-041 ไม่มี Address / ไม่มี Unit = บันทึกไม่ได้"""
    r = js("unitIssues", [{"unit": "UA1001", "addr": ""}, {"unit": "", "addr": "25-E-302"}], None)
    assert r["block"] == ["ข้อมูลไม่ครบ 2 แถว"]


@N
def test_unit_issues_duplicate_address(js):
    """TC-UNIT-042 ที่อยู่ซ้ำในใบ (ไม่สนตัวพิมพ์) = บันทึกไม่ได้"""
    r = js("unitIssues", [{"unit": "UA1001", "addr": "25-E-301"}, {"unit": "UA1002", "addr": "25-e-301"}], None)
    assert r["block"] == ["ที่อยู่ซ้ำ 2 แถว"]


@N
def test_unit_issues_address_used_in_other_release(js):
    """TC-UNIT-043 ที่อยู่ที่ใช้ใน Release อื่นแล้ว = บันทึกไม่ได้ และบอกว่าอยู่ใบไหน"""
    r = js("unitIssues", [{"unit": "UA1001", "addr": "25-E-301"}], jmap([("25-E-301", "P-001")]))
    assert r["block"] == ["ที่อยู่ใช้ใน Release อื่นแล้ว 1 แถว"]
    assert r["row"]["0"] == [["bad", "อยู่ใน P-001 แล้ว"]]


@B
def test_unit_issues_odd_unit_is_warning_only(js):
    """TC-UNIT-044 Unit รูปแบบแปลก = เตือน ไม่ห้ามบันทึก"""
    r = js("unitIssues", [{"unit": "UAO123", "addr": "25-E-301"}], None)
    assert r["block"] == [] and r["warn"] == ["Unit รูปแบบแปลก 1 แถว"]


@P
def test_unit_issues_mockup_needs_no_address(js):
    """TC-UNIT-045 แผง Mockup ไม่ต้องมี Address"""
    r = js("unitIssues", [{"unit": "PMU-01", "addr": "", "mock": True}], None)
    assert r["block"] == []


# ── Mockup ──
@P
def test_mock_units_get_running_address(js):
    """TC-UNIT-050 ระบบออกที่อยู่สมมติ MOCK-EMU-1, -2 ให้"""
    r = js("normMockUnits", [{"unit": "EMU-01", "addr": ""}, {"unit": "EMU-02", "addr": ""}, {"unit": "UA1001", "addr": "25-E-301"}], None)
    assert [(x["addr"], x.get("mock")) for x in r] == [("MOCK-EMU-1", True), ("MOCK-EMU-2", True), ("25-E-301", None)]


@R
def test_mock_address_not_reused_across_releases(js):
    """TC-UNIT-051 ที่อยู่สมมติต้องไม่ซ้ำกับ Release อื่น"""
    r = js("normMockUnits", [{"unit": "EMU-01", "addr": ""}], jmap([("MOCK-EMU-1", "P-001")]))
    assert r[0]["addr"] == "MOCK-EMU-2"


@P
def test_expand_mock_quantity(js):
    """TC-UNIT-052 Mockup จำนวน 3 → 3 แผง 3 ที่อยู่ (1 QR ต่อแผง)"""
    r = js("expandUnits", [{"unit": "PMU-01", "addr": "", "mock": True, "qty": 3}], None)
    assert [x["addr"] for x in r] == ["MOCK-PMU-1", "MOCK-PMU-2", "MOCK-PMU-3"]


@B
@pytest.mark.parametrize("tid,u,exp", [
    ("TC-UNIT-053", {"mock": True, "qty": 0}, 1),
    ("TC-UNIT-054", {"mock": True, "qty": -5}, 1),
    ("TC-UNIT-055", {"mock": True, "qty": 999}, 999),
    ("TC-UNIT-056", {"mock": True, "qty": 1000}, 999),
    ("TC-UNIT-057", {"mock": False, "qty": 5}, 1),       # ไม่ใช่ Mockup = 1 แผงต่อแถวเสมอ
    ("TC-UNIT-058", {"mock": True, "qty": "abc"}, 1),
])
def test_mock_qty_limits(js, tid, u, exp):
    assert js("mockQty", u) == exp, tid


@P
def test_count_units(js):
    """TC-UNIT-060 นับแผงต่อแบบ + บอกว่าแบบไหนยังไม่มี BOM"""
    bom = {"panels": {"UA1001": {"items": []}}, "subs": {}, "parts": {}}
    r = js("countUnits", [{"unit": "UA1002", "addr": "a"}, {"unit": "UA1001", "addr": "b"}, {"unit": "UA1001", "addr": "c"}, {"unit": "", "addr": "d"}], bom)
    assert r == [{"unit": "UA1001", "qty": 2, "has": True}, {"unit": "UA1002", "qty": 1, "has": False}]


# ── นิ้ว → มม. ──
@P
@pytest.mark.parametrize("tid,raw,exp", [
    ("TC-UNIT-070", "16'-2\"", 4927.6),
    ("TC-UNIT-071", "2 9/16\"", 65.1),
    ("TC-UNIT-072", "8'-0\"", 2438.4),
    ("TC-UNIT-073", "3'-5 1/2\"", 1054.1),
    ("TC-UNIT-074", "1/2\"", 12.7),
    ("TC-UNIT-075", "10\"", 254.0),
    ("TC-UNIT-076", "7'-11 1/2\"", 2425.7),
])
def test_inch_to_mm(js, tid, raw, exp):
    assert js("inchToMm", raw) == pytest.approx(exp, abs=0.05), tid


@N
@pytest.mark.parametrize("tid,raw", [
    ("TC-UNIT-077", "abc"), ("TC-UNIT-078", ""), ("TC-UNIT-079", None),
    ("TC-UNIT-080", "100"),        # ตัวเลขธรรมดา = มม. อยู่แล้ว ไม่แปลง
    ("TC-UNIT-081", "1/0\""),      # หารศูนย์
])
def test_inch_to_mm_not_inch(js, tid, raw):
    assert js("inchToMm", raw) is None, tid


@B
@pytest.mark.parametrize("tid,v,exp", [
    ("TC-UNIT-085", 1, True), ("TC-UNIT-086", 40, True), ("TC-UNIT-087", 41, False),
    ("TC-UNIT-088", 0, False), ("TC-UNIT-089", 3.5, False), ("TC-UNIT-090", 1054.1, False), ("TC-UNIT-091", None, False),
])
def test_suspect_len(js, tid, v, exp):
    """ความยาวจำนวนเต็ม 1–40 มม. = น่าจะอ่านฟุตผิด ให้คนตรวจ"""
    assert js("suspectLen", v) is exp, tid
