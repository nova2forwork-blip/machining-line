"""TC-MAT — ความยาวเส้นวัตถุดิบ / จัดชิ้นลงเส้น / Total Mat.

ที่มาของผลที่คาด
- ผู้ใช้ 2026-11-18: ความยาวเส้นที่กรอกในหน้า "บันทึก Material" ต้องไหลเข้า Total Mat.
  ลำดับ: ค่าที่ระบุในใบ > หน้า Material > อ่านจากรหัส INV (3 หลัก ×10) > 6,000
- จัดลงเส้น: ชิ้นละ ยาว + รอยตัด 5 มม. · เส้นสุดท้ายไม่ต้องเผื่อรอยตัด · เศษ ≥ 500 มม. เก็บใช้ต่อได้
"""
import pytest

from conftest import jmap

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression

REG = {"fn": "setMatLens", "args": ["PRJ1", jmap([("23HZ02600C", 5800), ("NOCODE", 4500), ("ZERO600C", 0)])]}


def stock(js, inv, ml=None, pid=None):
    return js.steps([REG, {"fn": "stockLen", "args": [inv, ml, pid]}])[1]


@P
def test_stock_len_from_plan_value(js):
    """TC-MAT-001 ค่าที่ระบุในใบมาก่อนเสมอ"""
    assert stock(js, "23HZ02600C", 5500, "PRJ1") == {"len": 5500, "src": "bom"}


@R
def test_stock_len_from_material_page(js):
    """TC-MAT-002 (ผู้ใช้ 2026-11-18) ไม่ได้ระบุในใบ → ใช้ค่าจากหน้า บันทึก Material ก่อนค่าจากรหัส"""
    assert stock(js, "23HZ02600C", None, "PRJ1") == {"len": 5800, "src": "material"}


@P
def test_stock_len_material_page_key_ignores_case_and_spaces(js):
    """TC-MAT-003"""
    assert stock(js, " 23hz02 600c ", None, "PRJ1") == {"len": 5800, "src": "material"}


@P
def test_stock_len_material_page_for_code_without_length(js):
    """TC-MAT-004 รหัสที่อ่านความยาวไม่ได้ แต่หน้า Material กรอกไว้"""
    assert stock(js, "NOCODE", None, "PRJ1") == {"len": 4500, "src": "material"}


@N
def test_stock_len_other_project_registry_not_used(js):
    """TC-MAT-005 ค่าของโปรเจคอื่นต้องไม่ไหลข้ามโปรเจค"""
    assert stock(js, "23HZ02600C", None, "PRJ2") == {"len": 6000, "src": "code"}
    assert stock(js, "23HZ02600C", None, None) == {"len": 6000, "src": "code"}


@B
def test_stock_len_zero_in_material_page_ignored(js):
    """TC-MAT-006 หน้า Material กรอก 0 = ยังไม่กรอก → ถอยไปใช้ค่าจากรหัส"""
    assert stock(js, "ZERO600C", None, "PRJ1") == {"len": 6000, "src": "code"}


@P
@pytest.mark.parametrize("tid,inv,exp", [
    ("TC-MAT-010", "23HZ02600C", 6000),
    ("TC-MAT-011", "23BL01327B+C", 3270),
    ("TC-MAT-012", "AB100C", 1000),
])
def test_stock_len_from_inv_code(js, tid, inv, exp):
    assert stock(js, inv) == {"len": exp, "src": "code"}, tid


@B
@pytest.mark.parametrize("tid,inv", [("TC-MAT-013", "XYZ"), ("TC-MAT-014", ""), ("TC-MAT-015", None), ("TC-MAT-016", "AB050C")])
def test_stock_len_default(js, tid, inv):
    """อ่านจากรหัสไม่ได้ / ต่ำกว่า 100 → 6,000"""
    assert stock(js, inv) == {"len": 6000, "src": "default"}, tid


@B
@pytest.mark.parametrize("tid,ml", [("TC-MAT-017", 0), ("TC-MAT-018", -100), ("TC-MAT-019", "")])
def test_stock_len_bad_plan_value_ignored(js, tid, ml):
    assert stock(js, "23HZ02600C", ml)["src"] == "code", tid


# ── จัดชิ้นลงเส้น ──
def pack(js, pieces, stock_len=6000):
    return js("packBars", pieces, stock_len)


@P
def test_pack_three_2500(js):
    """TC-MAT-030 2,500 ×3 ในเส้น 6,000: เส้น 1 ลง 2 ชิ้น (เหลือ 990) เส้น 2 ลง 1 ชิ้น (เหลือ 3,495)"""
    r = pack(js, [{"len": 2500, "qty": 3}])
    assert (r["bars"], r["over"], r["used"], r["waste"]) == (2, 0, 7500, 4500)
    assert r["offLens"] == [3495, 990] and r["off"] == 2


@B
def test_pack_piece_equal_to_stock(js):
    """TC-MAT-031 ชิ้นยาวเท่าเส้นพอดี = 1 เส้น (เส้นสุดท้ายไม่เผื่อรอยตัด)"""
    r = pack(js, [{"len": 6000, "qty": 1}])
    assert (r["bars"], r["over"], r["waste"]) == (1, 0, 0)


@N
def test_pack_piece_longer_than_stock(js):
    """TC-MAT-032 ชิ้นยาวกว่าเส้น = นับเป็น "ยาวเกิน" ไม่จัดลงเส้น"""
    r = pack(js, [{"len": 6001, "qty": 2}])
    assert (r["bars"], r["over"]) == (0, 2)


@B
@pytest.mark.parametrize("tid,length,bars", [
    ("TC-MAT-033", 2997, 1),      # 2997 + 5 + 2997 = 5999 ≤ 6000
    ("TC-MAT-034", 2998, 2),      # 2998 + 5 + 2998 = 6001 > 6000
    ("TC-MAT-035", 3000, 2),
])
def test_pack_two_pieces_kerf_boundary(js, tid, length, bars):
    assert pack(js, [{"len": length, "qty": 2}])["bars"] == bars, tid


@B
@pytest.mark.parametrize("tid,length,off", [
    ("TC-MAT-036", 5495, [500]),   # เหลือ 6000 − 5495 − 5 = 500 → เก็บได้
    ("TC-MAT-037", 5496, []),      # เหลือ 499 → ไม่นับเป็นเศษใช้ต่อ
])
def test_pack_offcut_threshold(js, tid, length, off):
    assert pack(js, [{"len": length, "qty": 1}])["offLens"] == off, tid


@N
def test_pack_ignores_zero_rows(js):
    """TC-MAT-038 ความยาว 0 / จำนวน 0 / ไม่มีรายการ = ไม่ใช้เส้น"""
    assert pack(js, [{"len": 0, "qty": 5}, {"len": 1000, "qty": 0}])["bars"] == 0
    assert pack(js, [])["bars"] == 0


@P
def test_pack_mixed_lengths_first_fit_decreasing(js):
    """TC-MAT-039 4,000 + 1,900 ลงเส้นเดียวกัน (4005 + 1900 = 5905) ×2 → 2 เส้น"""
    r = pack(js, [{"len": 1900, "qty": 2}, {"len": 4000, "qty": 2}])
    assert (r["bars"], r["used"], r["waste"]) == (2, 11800, 200)


@P
def test_pack_respects_given_stock_length(js):
    """TC-MAT-040 เส้น 3,270: 1,600 ×2 = 1605 + 1600 = 3205 → 1 เส้น"""
    assert pack(js, [{"len": 1600, "qty": 2}], 3270)["bars"] == 1


# ── Total Mat. › วัตถุดิบงานตัด ──
PARTS = [
    {"code": "HZ02-025", "qty": 3, "l": 2500, "inv": "23HZ02600C", "dest": "CUTTING", "d": "MULLION"},
    {"code": "HZ02-026", "qty": 1, "l": 1000, "inv": "23HZ02600C", "dest": "CUTTING", "d": "MULLION"},
    {"code": "SF01-010", "qty": 9, "l": 300, "inv": "23SF01600C", "dest": "BENDING"},                    # ไม่ใช่งานตัด
    {"code": "HZ02-027", "qty": 4, "l": 500, "inv": "23HZ02600C", "dest": "CUTTING", "cancelled": "M-001"},   # ยกเลิก
    {"code": "HZ02-028", "qty": 0, "l": 500, "inv": "23HZ02600C", "dest": "CUTTING"},                    # จำนวน 0
    {"code": "NOINV-1", "qty": 2, "l": 0, "inv": "", "dest": "CUTTING"},                                  # ไม่มี INV ไม่มีความยาว
]


@P
def test_cut_materials_groups_by_inv(js):
    """TC-MAT-050 รวมเฉพาะพาร์ทงานตัดที่ยังไม่ยกเลิก ตาม INV"""
    r = js("cutMaterials", PARTS)
    g = next(x for x in r if x["inv"] == "23HZ02600C")
    assert (g["pcs"], g["len"], g["stock"], g["src"]) == (4, 8500, 6000, "code")
    assert [p["code"] for p in g["parts"]] == ["HZ02-025", "HZ02-026"]
    # 2500×3 + 1000 → เส้น 1: 2500+2500 (เหลือ 995 → ไม่พอ 1005) · เส้น 2: 2500 + 1000
    assert g["bars"] == 2
    assert g["req"] == pytest.approx((2505 * 3 + 1005) / 6000, abs=0.005)


@N
def test_cut_materials_excludes_non_cutting_cancelled_zero(js):
    """TC-MAT-051 งานพับ / แถวยกเลิก / จำนวน 0 ต้องไม่อยู่ในใบเบิกวัตถุดิบงานตัด"""
    codes = [p["code"] for g in js("cutMaterials", PARTS) for p in g["parts"]]
    assert "SF01-010" not in codes and "HZ02-027" not in codes and "HZ02-028" not in codes


@B
def test_cut_materials_no_inv_listed_last(js):
    """TC-MAT-052 พาร์ทที่ไม่มี INV ยังต้องขึ้น (ท้ายตาราง) + นับชิ้นที่ไม่มีความยาว"""
    r = js("cutMaterials", PARTS)
    assert r[-1]["inv"] == "" and r[-1]["pcs"] == 2 and r[-1]["noLen"] == 2 and r[-1]["bars"] == 0


@N
def test_cut_materials_empty(js):
    """TC-MAT-053"""
    assert js("cutMaterials", []) == [] and js("cutMaterials", None) == []


@P
def test_cut_materials_uses_plan_stock_length(js):
    """TC-MAT-054 พาร์ทระบุความยาวเส้นเอง (ml) → ใช้ค่านั้นจัดลงเส้น"""
    r = js("cutMaterials", [{"code": "A", "qty": 2, "l": 1600, "inv": "23HZ02600C", "ml": 3270, "dest": "CUTTING"}])
    assert (r[0]["stock"], r[0]["src"], r[0]["bars"]) == (3270, "bom", 1)


@R
def test_need_of_carries_material_page_length_to_total_mat(js):
    """TC-MAT-055 (ผู้ใช้ 2026-11-18) ความยาวเส้นจากหน้า Material ต้องถึง Total Mat. ของใบ (ผ่าน needOf ของโปรเจคนั้น)"""
    plan = {"projectId": "PRJ1", "units": [{"unit": "UA1001", "addr": "A1"}],
            "bom": {"panels": {"UA1001": {"items": [["part", "HZ02-025", 2]]}}, "subs": {}, "parts": {"HZ02-025": {"l": 2000, "m": "23HZ02600C", "k": "part"}}}}
    need = js.steps([REG, {"fn": "needOf", "args": [plan]}])[1]
    part = next(p for p in need["parts"] if p["code"] == "HZ02-025")
    assert part["ml"] == 5800, "needOf ต้องเติมความยาวเส้นจากหน้า Material ให้พาร์ทที่ไม่ได้ระบุเอง"
    mat = js("cutMaterials", need["parts"])
    assert (mat[0]["inv"], mat[0]["stock"]) == ("23HZ02600C", 5800)


@N
def test_need_of_plan_value_beats_material_page(js):
    """TC-MAT-056 พาร์ทระบุความยาวเส้นในใบแล้ว → หน้า Material ต้องไม่ทับ"""
    plan = {"projectId": "PRJ1", "units": [{"unit": "UA1001", "addr": "A1"}],
            "bom": {"panels": {"UA1001": {"items": [["part", "HZ02-025", 2]]}}, "subs": {}, "parts": {"HZ02-025": {"l": 2000, "m": "23HZ02600C", "ml": 5500, "k": "part"}}}}
    need = js.steps([REG, {"fn": "needOf", "args": [plan]}])[1]
    assert need["parts"][0]["ml"] == 5500
