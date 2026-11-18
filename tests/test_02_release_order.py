"""TC-RO — เลข Release / เลขล็อต / ใบปะหน้า

ที่มาของผลที่คาด: หมายเหตุในโค้ด "P-9 = P-09 = P-009 เลขเดียวกัน" · ล็อต = P-142.1 / .2 · R6 (2026-11-12) เก็บรหัสโปรเจคเต็ม
"""
import pytest

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression


@P
@pytest.mark.parametrize("tid,raw,exp", [
    ("TC-RO-001", "7", "P-007"),
    ("TC-RO-002", "p-12", "P-012"),
    ("TC-RO-003", "P-12 (A)", "P-012 (A)"),
    ("TC-RO-004", "P 9", "P-009"),
    ("TC-RO-005", " p-0009 ", "P-009"),
])
def test_normalize_ro(js, tid, raw, exp):
    assert js("normalizeRO", raw) == exp, tid


@B
@pytest.mark.parametrize("tid,raw,exp", [
    ("TC-RO-006", "", ""),
    ("TC-RO-007", None, ""),
    ("TC-RO-008", "P-1234", "P-1234"),      # เกิน 3 หลัก ไม่ตัด
    ("TC-RO-009", "0", "P-000"),
])
def test_normalize_ro_edges(js, tid, raw, exp):
    assert js("normalizeRO", raw) == exp, tid


@N
def test_normalize_ro_non_release_text_kept(js):
    """TC-RO-010 ข้อความที่ไม่ใช่เลข Release → คืนตามเดิม (ตัวพิมพ์ใหญ่) ไม่แต่งเป็น P-xxx"""
    assert js("normalizeRO", "abc") == "ABC"


@P
def test_ro_key_same_number_same_key(js):
    """TC-RO-011 P-9 = P-09 = P-009 (กันสร้างใบซ้ำ)"""
    keys = js.steps([{"fn": "roKey", "args": [x]} for x in ("P-9", "P-09", "P-009", "p - 009")])
    assert len(set(keys)) == 1, keys


@P
@pytest.mark.parametrize("tid,a,b,same", [
    ("TC-RO-012", "P-002.01", "P-2.1", True),
    ("TC-RO-013", "P-002.1", "P-002.10", False),
    ("TC-RO-014", "P-002", "P-020", False),
    ("TC-RO-015", "P-002 (A)", "P-2(A)", True),
    ("TC-RO-016", "P-002 (A)", "P-002", False),
])
def test_ro_key_compare(js, tid, a, b, same):
    ka, kb = js.steps([{"fn": "roKey", "args": [a]}, {"fn": "roKey", "args": [b]}])
    assert (ka == kb) is same, (tid, ka, kb)


@P
@pytest.mark.parametrize("tid,ro,exp", [
    ("TC-RO-020", "P-002", 0),
    ("TC-RO-021", "P-002.3", 3),
    ("TC-RO-022", "P-002.03", 3),
    ("TC-RO-023", "P-002.12", 12),
    ("TC-RO-024", "", 0),
])
def test_lot_of(js, tid, ro, exp):
    assert js("lotOf", ro) == exp, tid


@P
@pytest.mark.parametrize("tid,lot,plan,exp", [
    ("TC-RO-030", "P-002.1", "P-002", True),
    ("TC-RO-031", "P-2.1", "P-002", True),
    ("TC-RO-032", "P-002", "P-002", True),
])
def test_in_plan_true(js, tid, lot, plan, exp):
    assert js("inPlan", lot, plan) is exp, tid


@R
@N
@pytest.mark.parametrize("tid,lot,plan", [
    ("TC-RO-033", "P-020.1", "P-002"),     # เลขขึ้นต้นเหมือนกัน แต่คนละใบ
    ("TC-RO-034", "P-0021", "P-002"),
    ("TC-RO-035", "", "P-002"),
    ("TC-RO-036", "ABC", "P-002"),
])
def test_in_plan_false(js, tid, lot, plan):
    assert js("inPlan", lot, plan) is False, tid


@P
@pytest.mark.parametrize("tid,plan,lots,exp", [
    ("TC-RO-040", "P-002", [], "P-002.1"),
    ("TC-RO-041", "P-002", [{"no": "P-002.1"}, {"no": "P-002.2"}], "P-002.3"),
    ("TC-RO-042", "P-002", [{"no": "P-002.1"}, {"no": "P-002.3"}], "P-002.2"),     # ใช้เลขที่ว่าง
    ("TC-RO-043", "P-002 (A)", [{"no": "P-002.1"}], "P-002.2"),
    ("TC-RO-044", "2", [], "P-002.1"),
])
def test_next_lot_no(js, tid, plan, lots, exp):
    assert js("nextLotNo", plan, lots) == exp, tid


# ── ใบปะหน้า ──
@P
def test_split_release_production(js):
    """TC-RO-050"""
    r = js("splitRelease", "A10042- P-002", m="order")
    assert (r["project"], r["ro"]) == ("A10042", "P-002")


@P
def test_split_release_modify(js):
    """TC-RO-051 ใบ Modify: A10035 - M-060"""
    r = js("splitRelease", "A10035 - M-060", m="order")
    assert (r["project"], r["ro"], r["mNo"], r["mVer"]) == ("A10035", "", 60, "M-060")


@R
def test_split_release_keeps_full_project_code(js):
    """TC-RO-052 (R6 2026-11-12) A10035-AU ต้องเก็บรหัสเต็มไว้ ไม่ปนกับ -US"""
    r = js("splitRelease", "A10035-AU- P-069", m="order")
    assert (r["project"], r["full"], r["ro"]) == ("A10035", "A10035-AU", "P-069")


@B
def test_split_release_ro_only(js):
    """TC-RO-053 มีแต่เลขใบ"""
    r = js("splitRelease", "P-69", m="order")
    assert (r["project"], r["ro"]) == ("", "P-069")


@N
@pytest.mark.parametrize("tid,raw", [("TC-RO-054", ""), ("TC-RO-055", "ไม่ใช่เลขใบ"), ("TC-RO-056", None)])
def test_split_release_garbage(js, tid, raw):
    r = js("splitRelease", raw, m="order")
    assert (r["project"], r["ro"]) == ("", ""), tid


@P
def test_addr_note_round_trip(js):
    """TC-RO-060 ที่อยู่แผงเก็บในหมายเหตุ แล้วอ่านกลับได้ครบ (ตัวพิมพ์ใหญ่)"""
    note = js("addrNote", ["25-E-301", "25-e-302"])
    assert js("addrsFromNote", "ใบ: ASSEMBLY · " + note) == ["25-E-301", "25-E-302"]


@N
def test_addrs_from_note_without_tag(js):
    """TC-RO-061"""
    assert js("addrsFromNote", "หมายเหตุทั่วไป 25-E-301") == []
    assert js("addrsFromNote", None) == []


@P
@pytest.mark.parametrize("tid,item,exp", [
    ("TC-RO-070", {"code": "MTG01-5001", "d": "MARKING DRAWING TYPE 1"}, "panel"),
    ("TC-RO-071", {"code": "MSA101-5001", "d": "ASSEMBLY"}, "sub"),
    ("TC-RO-072", {"code": "SA01-001", "d": ""}, "sub"),
    ("TC-RO-073", {"code": "MFA183-5001 A", "d": "MULLION"}, "part"),
    ("TC-RO-074", {"code": "X-1", "d": "SUB-ASSEMBLY"}, "sub"),
])
def test_order_item_kind(js, tid, item, exp):
    assert js("orderItemKind", item, m="order") == exp, tid


@P
def test_order_kinds_mode(js):
    """TC-RO-080..082 ผู้ใช้ 2026-11-17: ดูจากใบปะหน้าว่ารอบนี้เป็นแผง / ซับ / พาร์ท แล้วเลือกให้เอง"""
    panel = {"items": [{"code": "MTG01-5001", "d": "MARKING DRAWING"}, {"code": "MFA1", "d": "MULLION"}]}
    items = {"items": [{"code": "MSA101-5001", "d": "ASSEMBLY"}, {"code": "MFA1", "d": "MULLION"}]}
    assert js("orderKinds", panel, m="order") == {"panel": 1, "sub": 0, "part": 1, "mode": "panel"}
    assert js("orderKinds", items, m="order") == {"panel": 0, "sub": 1, "part": 1, "mode": "items"}
    assert js("orderKinds", {"items": []}, m="order")["mode"] is None
    assert js("orderKinds", None, m="order")["mode"] is None
