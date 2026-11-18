"""TC-CODE — เบอร์พาร์ท / ตัวอักษรท้ายเบอร์ / Rev ของแบบ / หมวดและใบงานอัตโนมัติ

ที่มาของผลที่คาด
- ผู้ใช้ยืนยัน 2026-11-17: ตัวอักษรท้ายเบอร์ ("MFA183-5001 A") เป็นส่วนของเบอร์ ไม่ใช่ Rev — A กับ B คือคนละชิ้น
  Rev จริง = ช่อง REV. ในแบบ
- กติกาหมวดตามรหัสเบอร์ (หัวไฟล์ releaseCore.js "ตรงไฟล์ Excel จริง")
"""
import pytest

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression


@P
@pytest.mark.parametrize("tid,raw,exp", [
    ("TC-CODE-001", "  mfa183-5001   a ", "MFA183-5001 A"),
    ("TC-CODE-002", "HZ02-025", "HZ02-025"),
    ("TC-CODE-003", "", ""),
    ("TC-CODE-004", None, ""),
])
def test_nc_normalizes_code(js, tid, raw, exp):
    assert js("NC", raw) == exp, tid


@P
@pytest.mark.parametrize("tid,raw,exp", [
    ("TC-CODE-010", "HZ02-025 A", "HZ02-025"),
    ("TC-CODE-011", "HZ02-025", "HZ02-025"),
    ("TC-CODE-012", "hz02-025 b*", "HZ02-025"),
    ("TC-CODE-013", "HZ02-025*", "HZ02-025"),
])
def test_base_of(js, tid, raw, exp):
    assert js("baseOf", raw) == exp, tid


# ── ตัวอักษรท้ายเบอร์ = ส่วนของเบอร์ ──
@P
def test_find_latest_exact_key(js):
    """TC-CODE-020 มีทั้ง A และ B → ขอ A ได้ A, ขอ B ได้ B"""
    lib = {"MFA183-5001 A": 1, "MFA183-5001 B": 1}
    assert js("findLatest", lib, "MFA183-5001 A") == "MFA183-5001 A"
    assert js("findLatest", lib, "MFA183-5001 B") == "MFA183-5001 B"


@R
@N
def test_find_latest_does_not_swap_letter(js):
    """TC-CODE-021 (กันบั๊กเดิม 2026-11-03) BOM เขียน A แต่คลังมีแค่ B → ต้องไม่ถูกเปลี่ยนเป็น B"""
    assert js("findLatest", {"MFA183-5001 B": 1}, "MFA183-5001 A") is None


@P
def test_find_latest_no_letter_single_candidate(js):
    """TC-CODE-022 ใบเขียนเบอร์ไม่มีตัวอักษรท้าย และมีเบอร์ฐานนี้ตัวเดียว → ใช้ตัวนั้น"""
    assert js("findLatest", {"MFA183-5001 A": 1, "HZ02-025": 1}, "MFA183-5001") == "MFA183-5001 A"


@B
def test_find_latest_no_letter_two_candidates(js):
    """TC-CODE-023 เขียนไม่มีตัวอักษรท้าย แต่มีทั้ง A และ B → ไม่เดา (null)"""
    assert js("findLatest", {"MFA183-5001 A": 1, "MFA183-5001 B": 1}, "MFA183-5001") is None


@B
@pytest.mark.parametrize("tid,lib,code,exp", [
    ("TC-CODE-024", {"MFA183-5001 A": 1}, "mfa183-5001  a", "MFA183-5001 A"),   # ไม่สนตัวพิมพ์ / ช่องว่างซ้อน
    ("TC-CODE-025", {"MFA183-5001 A": 1}, "", None),
    ("TC-CODE-026", None, "MFA183-5001 A", None),
    ("TC-CODE-027", {}, "MFA183-5001", None),
])
def test_find_latest_edges(js, tid, lib, code, exp):
    assert js("findLatest", lib, code) == exp, tid


@R
def test_newer_rev_of_is_always_none(js):
    """TC-CODE-028 ไม่มี "รุ่นใหม่กว่า" ของเบอร์อื่นอีกแล้ว → ไฟล์ A ไม่ถูกข้ามเพราะมี B"""
    assert js("newerRevOf", {"MFA183-5001 B": {}}, "MFA183-5001 A") is None


# ── Rev ของแบบ = ช่อง REV. ──
@P
@pytest.mark.parametrize("tid,doc,exp", [
    ("TC-CODE-030", {"title": {"REV.": "b"}}, "B"),
    ("TC-CODE-031", {"title": {"REV.": "-", "SHEET_REV": "a"}}, "A"),
    ("TC-CODE-032", {"title": {"REV.": "B", "SHEET_REV": "A"}}, "B"),
])
def test_dwg_rev_from_rev_box(js, tid, doc, exp):
    assert js("dwgRev", doc) == exp, tid


@N
@pytest.mark.parametrize("tid,doc", [
    ("TC-CODE-033", {"title": {}}),
    ("TC-CODE-034", {"title": {"REV.": "-"}}),
    ("TC-CODE-035", {}),
    ("TC-CODE-036", None),
])
def test_dwg_rev_empty_when_no_rev(js, tid, doc):
    assert js("dwgRev", doc) == "", tid


@R
def test_dwg_rev_ignores_code_letter(js):
    """TC-CODE-037 ผู้ใช้: "แบบใช้ไม่มี rev ทำไมถึงเป็น A" — เบอร์ลงท้าย A แต่ช่อง REV. ว่าง → ไม่มี Rev"""
    assert js("dwgRev", {"code": "MFA183-5001 A", "title": {"PART NO.": "MFA183-5001 A", "REV.": "-"}}) == ""


# ── หมวดอัตโนมัติ ──
@P
@pytest.mark.parametrize("tid,code,kind,exp", [
    ("TC-CODE-040", "GL-01", "part", "GLASS"),
    ("TC-CODE-041", "UA-123", "part", "VENT"),
    ("TC-CODE-042", "HP-001", "part", "FASTENER & GASKET"),
    ("TC-CODE-043", "R&D-ACS800", "part", "FASTENER & GASKET"),
    ("TC-CODE-044", "SF01-010", "part", "BENDING PART"),
    ("TC-CODE-045", "AP01-001", "part", "BENDING PART"),
    ("TC-CODE-046", "FS01-001", "part", "STEEL PART"),
    ("TC-CODE-047", "MFA183-5001 A", "part", "MACHINING PART"),
    ("TC-CODE-048", "HZ02-025*", "part", "SITE ITEM"),
    ("TC-CODE-049", "SA01-001", "sub", "SUB-ASSEMBLY PART"),
    ("TC-CODE-050", "SA01-001*", "sub", "SUB-ASSEMBLY PART"),      # ซับมี * ก็ยังเป็นซับ
    ("TC-CODE-051", "ANYTHING", "hw", "FASTENER & GASKET"),
    ("TC-CODE-052", "gl-01", "part", "GLASS"),                     # ตัวพิมพ์เล็ก
])
def test_rule_cat(js, tid, code, kind, exp):
    assert js("ruleCat", code, kind) == exp, tid


@P
@pytest.mark.parametrize("tid,code,exp", [
    ("TC-CODE-060", "SAAL-002", "เชื่อม"),
    ("TC-CODE-061", "SAAP-001", "พับ"),
    ("TC-CODE-062", "SASF-001", "พับ"),
    ("TC-CODE-063", "SA01-001", "ยิง"),
    ("TC-CODE-064", "SAAL-002*", "Site Item"),
])
def test_rule_proc(js, tid, code, exp):
    assert js("ruleProc", code) == exp, tid


@P
@pytest.mark.parametrize("tid,cat,code,exp", [
    ("TC-CODE-070", "MACHINING PART", "X", "CUTTING"),
    ("TC-CODE-071", "BENDING PART", "X", "BENDING"),
    ("TC-CODE-072", "STEEL PART", "X", "STEEL"),
    ("TC-CODE-073", "SITE ITEM", "FS01-001*", "STEEL"),       # Site Item → ใบงานตามรหัสเบอร์
    ("TC-CODE-074", "SITE ITEM", "HZ02-025*", "CUTTING"),
    ("TC-CODE-075", "หมวดตั้งเอง", "SF01-010", "BENDING"),
])
def test_rule_dest(js, tid, cat, code, exp):
    assert js("ruleDest", cat, code) == exp, tid


@P
@pytest.mark.parametrize("tid,name,exp", [
    ("TC-CODE-080", "MACHINING PART", "CUTTING"),
    ("TC-CODE-081", "BENDING", "BENDING"),                    # ชื่อเดิมในหมายเหตุของล็อตเก่า
    ("TC-CODE-082", "SUB A'ssy (พับ)", "พับ"),
    ("TC-CODE-083", "SUB-ASSEMBLY (ยิง)", "ยิง"),
    ("TC-CODE-084", "ใบที่ไม่รู้จัก", "ใบที่ไม่รู้จัก"),
])
def test_sheet_key_of(js, tid, name, exp):
    assert js("sheetKeyOf", name) == exp, tid


@P
def test_group_cat_of_longest_prefix_and_star(js):
    """TC-CODE-090..093 หมวดตั้งเอง: ตัวหน้ายาวสุดชนะ · * ชนะทุกตัวหน้า · ไม่เข้าพวก = ยังไม่จัดหมวด"""
    groups = [{"name": "G-H", "prefixes": ["H"]}, {"name": "G-HZ", "prefixes": ["HZ"]}, {"name": "G-SITE", "prefixes": ["*"]}]
    assert js("groupCatOf", groups, "HZ02-025") == "G-HZ"
    assert js("groupCatOf", groups, "HA01-001") == "G-H"
    assert js("groupCatOf", groups, "HZ02-025*") == "G-SITE"
    assert js("groupCatOf", groups, "ZZ-1") == "ยังไม่จัดหมวด"
    assert js("groupCatOf", [], "ZZ-1") == "ยังไม่จัดหมวด"


@P
@pytest.mark.parametrize("tid,row,exp", [
    ("TC-CODE-095", {"code": "SA01-001", "len": 100}, "sub"),
    ("TC-CODE-096", {"code": "HP-001", "qty_unit": "pcs"}, "hw"),
    ("TC-CODE-097", {"code": "XX-1"}, "hw"),                       # ไม่มีความยาว / ผิว = อุปกรณ์
    ("TC-CODE-098", {"code": "GL-01"}, "part"),
    ("TC-CODE-099", {"code": "HZ02-025", "len": 1200}, "part"),
])
def test_guess_kind(js, tid, row, exp):
    assert js("guessKind", row) == exp, tid
