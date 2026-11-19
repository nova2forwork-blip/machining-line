"""TC-PLAN — แตก BOM ทั้งใบ (needOf) · ปล่อยเฉพาะซับ/พาร์ท (picks) · Modify · แบบ MARKING · เทียบใบปะหน้า

ที่มาของผลที่คาด: คำนวณมือจาก BOM ตัวอย่างข้างล่าง (จำนวนแผง × จำนวนต่อชุด ไล่ลงทุกชั้น)
+ กติกาที่ผู้ใช้ยืนยัน (ตัวอักษรท้ายเบอร์ = ส่วนของเบอร์ · MARKING drawing = แผงที่มีรายการลูกใน BILL OF EXTRUSION)
"""
import copy

import pytest

from conftest import jmap, jset

P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression

# แผง UA1001 ×3 : ซับ SA01-001 ×2 · พาร์ท MFA183-5001 A ×4 · สกรู HP-001 ×10 · กระจก GL-01 ×1
#   SA01-001 : HZ02-025 ×3 · SF01-010 ×1 · ซับ SAAL-002 ×1
#   SAAL-002 : FS01-001 ×2
BOM = {
    "panels": {"UA1001": {"d": "PANEL TYPE 1", "items": [["sub", "SA01-001", 2], ["part", "MFA183-5001 A", 4], ["hw", "HP-001", 10], ["part", "GL-01", 1]]}},
    "subs": {
        "SA01-001": {"d": "FRAME", "l": 1000, "items": [["part", "HZ02-025", 3], ["part", "SF01-010", 1], ["sub", "SAAL-002", 1]]},
        "SAAL-002": {"d": "BRACKET", "items": [["part", "FS01-001", 2]]},
    },
    "parts": {
        "MFA183-5001 A": {"d": "MULLION", "l": 2500, "m": "23HZ02600C", "k": "part"},
        "HZ02-025": {"d": "TRANSOM", "l": 1200, "m": "23HZ02600C", "k": "part"},
        "SF01-010": {"d": "FLASHING", "l": 300, "k": "part"},
        "FS01-001": {"d": "STEEL", "k": "part"},
        "HP-001": {"d": "SCREW", "k": "hw", "u": "pcs."},
        "GL-01": {"d": "GLASS", "k": "part"},
    },
}
UNITS = [{"unit": "UA1001", "addr": "25-E-301"}, {"unit": "UA1001", "addr": "25-E-302"}, {"unit": "UA1001", "addr": "25-E-303"}]


def plan_of(**kw):
    p = {"ro": "P-900", "units": copy.deepcopy(UNITS), "bom": copy.deepcopy(BOM)}
    p.update(kw)
    return p


def qty(rows):
    return {r["code"]: r["qty"] for r in rows}


def row(rows, code):
    return next(r for r in rows if r["code"] == code)


# ── แตก BOM ──
@P
def test_need_panel_mode_quantities(js):
    """TC-PLAN-001 ยอดต้องใช้ทั้งใบ = จำนวนแผง × ต่อชุด ไล่ลงทุกชั้น"""
    n = js("needOf", plan_of())
    assert [(p["code"], p["qty"], p["has"]) for p in n["panels"]] == [("UA1001", 3, True)]
    assert n["panels"][0]["addrs"] == ["25-E-301", "25-E-302", "25-E-303"]
    assert qty(n["subs"]) == {"SA01-001": 6, "SAAL-002": 6}
    assert qty(n["parts"]) == {"FS01-001": 12, "HZ02-025": 18, "MFA183-5001 A": 12, "SF01-010": 6}
    assert qty(n["hw"]) == {"HP-001": 30}
    assert qty(n["glass"]) == {"GL-01": 3}


@P
def test_need_destinations_and_processes(js):
    """TC-PLAN-002 ใบงานของพาร์ท / งานของซับ ตามรหัสเบอร์"""
    n = js("needOf", plan_of())
    assert {p["code"]: p["dest"] for p in n["parts"]} == {"FS01-001": "STEEL", "HZ02-025": "CUTTING", "MFA183-5001 A": "CUTTING", "SF01-010": "BENDING"}
    assert {s["code"]: s["procs"] for s in n["subs"]} == {"SA01-001": ["ยิง"], "SAAL-002": ["เชื่อม"]}


@N
def test_need_skips_cancelled_bom_line(js):
    """TC-PLAN-003 บรรทัด BOM ที่ "ยกเลิก" ไม่ถูกนับ"""
    p = plan_of()
    p["bom"]["panels"]["UA1001"]["items"].append(["part", "HZ99-999", 5, None, "ยกเลิก"])
    assert "HZ99-999" not in qty(js("needOf", p)["parts"])


@B
def test_need_unit_without_bom(js):
    """TC-PLAN-004 แบบแผงที่ยังไม่มี BOM: ยังนับแผง แต่ has = false และไม่แตกลูก"""
    p = plan_of(units=UNITS + [{"unit": "UA2002", "addr": "25-E-999"}])
    n = js("needOf", p)
    assert {x["code"]: (x["qty"], x["has"]) for x in n["panels"]} == {"UA1001": (3, True), "UA2002": (1, False)}
    assert qty(n["parts"])["HZ02-025"] == 18


@N
def test_need_empty_plan(js):
    """TC-PLAN-005 ไม่มีแผง ไม่มีรายการ → ทุกตารางว่าง"""
    n = js("needOf", plan_of(units=[]))
    assert n["panels"] == [] and n["subs"] == [] and n["parts"] == [] and n["hw"] == []


@B
def test_need_sub_referencing_itself_does_not_loop(js):
    """TC-PLAN-006 ซับอ้างถึงตัวเอง (ข้อมูลผิด) ต้องไม่วนไม่จบ"""
    p = plan_of()
    p["bom"]["subs"]["SAAL-002"]["items"].append(["sub", "SAAL-002", 1])
    n = js("needOf", p)
    assert qty(n["parts"])["FS01-001"] == 12


# ── ตัวอักษรท้ายเบอร์ ──
@R
def test_explode_keeps_letter_a_when_library_has_only_b(js):
    """TC-PLAN-010 (กันบั๊ก 2026-11-03) BOM เขียน "X A" คลังมี "X B" → ต้องปล่อย "X A" ไม่ใช่ B"""
    p = plan_of()
    p["bom"]["parts"]["MFA183-5001 B"] = p["bom"]["parts"].pop("MFA183-5001 A")
    q = qty(js("needOf", p)["parts"])
    assert q.get("MFA183-5001 A") == 12 and "MFA183-5001 B" not in q


@P
def test_explode_a_and_b_are_separate_parts(js):
    """TC-PLAN-011 A กับ B คือคนละชิ้น → คนละแถว ยอดไม่รวมกัน"""
    p = plan_of()
    p["bom"]["parts"]["MFA183-5001 B"] = {"d": "MULLION B", "l": 2600, "m": "23HZ02600C", "k": "part"}
    p["bom"]["panels"]["UA1001"]["items"].append(["part", "MFA183-5001 B", 2])
    q = qty(js("needOf", p)["parts"])
    assert (q["MFA183-5001 A"], q["MFA183-5001 B"]) == (12, 6)


@P
def test_explode_code_without_letter_uses_single_candidate(js):
    """TC-PLAN-012 BOM เขียนเบอร์ไม่มีตัวอักษรท้าย และคลังมีตัวเดียว → ใช้ตัวนั้น"""
    p = plan_of()
    p["bom"]["panels"]["UA1001"]["items"][1] = ["part", "MFA183-5001", 4]
    assert qty(js("needOf", p)["parts"])["MFA183-5001 A"] == 12


# ── ปล่อยเฉพาะซับ / พาร์ท ──
@P
def test_picks_only_mode(js):
    """TC-PLAN-020 ไม่มีแผง: ซับ 2 ชุด แตกลูกทุกชั้น + พาร์ทปล่อยตรง 5"""
    p = plan_of(units=[], picks=[{"code": "SA01-001", "kind": "sub", "qty": 2}, {"code": "MFA183-5001 A", "kind": "part", "qty": 5}])
    n = js("needOf", p)
    assert n["panels"] == []
    assert qty(n["subs"]) == {"SA01-001": 2, "SAAL-002": 2}
    assert qty(n["parts"]) == {"FS01-001": 4, "HZ02-025": 6, "MFA183-5001 A": 5, "SF01-010": 2}


@P
def test_picks_add_to_panel_mode(js):
    """TC-PLAN-021 ใบที่มีแผง + ซับปล่อยตรงเพิ่ม 1 ชุด → ยอดบวกกัน"""
    n = js("needOf", plan_of(picks=[{"code": "SA01-001", "kind": "sub", "qty": 1}]))
    assert qty(n["subs"])["SA01-001"] == 7 and qty(n["parts"])["HZ02-025"] == 21


@N
@pytest.mark.parametrize("tid,q", [("TC-PLAN-022", 0), ("TC-PLAN-023", -3), ("TC-PLAN-024", "abc"), ("TC-PLAN-025", None)])
def test_picks_bad_quantity_ignored(js, tid, q):
    n = js("needOf", plan_of(units=[], picks=[{"code": "SA01-001", "kind": "sub", "qty": q}]))
    assert n["subs"] == [] and n["parts"] == [], tid


@B
def test_picks_sub_without_bom_still_listed(js):
    """TC-PLAN-026 ซับที่ยังไม่มีรายการลูก ยังต้องขึ้นเป็นแถวซับ"""
    n = js("needOf", plan_of(units=[], picks=[{"code": "SA77-001", "kind": "sub", "qty": 4}]))
    assert qty(n["subs"]) == {"SA77-001": 4} and n["parts"] == []


# ── Modify ──
@P
def test_modify_cancel_address(js):
    """TC-PLAN-030 ยกเลิกที่อยู่ 1 แผง → ยอดลดเหลือ 2 แผง · ยอดเดิมยังจำไว้ (ขีดฆ่า)"""
    n = js("needOf", plan_of(cancelAddr={"25-E-303": "M-001"}))
    assert (n["panels"][0]["qty"], n["panels"][0]["orig"]) == (2, 3)
    r = row(n["parts"], "HZ02-025")
    assert (r["qty"], r["orig"]) == (12, 18)


@P
def test_modify_adjust_quantity(js):
    """TC-PLAN-031 แก้จำนวนใน Modify → ยอดใหม่ + รุ่น M + ยอดเดิม"""
    r = row(js("needOf", plan_of(adj={"HZ02-025": {"qty": 20, "ver": "M-001"}}))["parts"], "HZ02-025")
    assert (r["qty"], r["orig"], r["modVer"]) == (20, 18, "M-001")


@P
def test_modify_cancel_code(js):
    """TC-PLAN-032 ยกเลิกเบอร์ → ยอด 0 แต่แถวยังอยู่ (ล็อตที่ปล่อยไปแล้วอ้างถึงได้)"""
    r = row(js("needOf", plan_of(cancel={"SF01-010": "M-002"}))["parts"], "SF01-010")
    assert (r["qty"], r["cancelled"], r["orig"]) == (0, "M-002", 6)


@P
def test_modify_add_new_part(js):
    """TC-PLAN-033 เพิ่มเบอร์ใหม่ใน Modify → แถวใหม่ติดป้ายรุ่น M"""
    n = js("needOf", plan_of(extra=[{"code": "HZ55-001", "kind": "part", "qty": 7, "mod": "M-003"}]))
    r = row(n["parts"], "HZ55-001")
    assert (r["qty"], r["added"], r["dest"]) == (7, "M-003", "CUTTING")


@P
def test_add_existing_part_adds_quantity(js):
    """TC-PLAN-034 เพิ่มเบอร์ที่มีอยู่แล้ว → บวกจำนวน ไม่ขึ้นเป็นการแก้จำนวน"""
    r = row(js("needOf", plan_of(extra=[{"code": "HZ02-025", "kind": "part", "qty": 2}]))["parts"], "HZ02-025")
    assert (r["qty"], r["orig"], r["extraQty"]) == (20, 20, 2)


@P
def test_add_existing_hardware_adds_quantity(js):
    """TC-PLAN-035 อุปกรณ์เพิ่ม (สกรู) เบอร์เดิม → บวกจำนวน"""
    r = row(js("needOf", plan_of(extra=[{"code": "HP-001", "kind": "hw", "qty": 5}]))["hw"], "HP-001")
    assert r["qty"] == 35


@P
def test_modify_length_override(js):
    """TC-PLAN-036 Modify เปลี่ยนความยาวตามแบบ → ค่าใหม่ + จำค่าเดิม"""
    r = row(js("needOf", plan_of(lenOv={"HZ02-025": {"to": 1300, "ver": "M-004"}}))["parts"], "HZ02-025")
    assert (r["l"], r["lOrig"], r["lenVer"]) == (1300, 1200, "M-004")


@P
def test_material_override(js):
    """TC-PLAN-037 เปลี่ยนวัสดุของพาร์ท → INV ใหม่ (ตัวพิมพ์ใหญ่) + จำ INV เดิม + เหตุผล"""
    r = row(js("needOf", plan_of(matOv={"HZ02-025": {"to": " ab99600c ", "r": "ของหมด"}}))["parts"], "HZ02-025")
    assert (r["inv"], r["invOrig"], r["matNote"]) == ("AB99600C", "23HZ02600C", "ของหมด")


@N
def test_material_override_blank_is_ignored(js):
    """TC-PLAN-038 เปลี่ยนวัสดุเป็นค่าว่าง = ไม่เปลี่ยน"""
    r = row(js("needOf", plan_of(matOv={"HZ02-025": {"to": "   "}}))["parts"], "HZ02-025")
    assert r["inv"] == "23HZ02600C" and "invOrig" not in r


@P
def test_material_swap_for_hardware(js):
    """TC-PLAN-039 ใช้อุปกรณ์เบอร์อื่นแทน → ใบเบิกแสดงเบอร์ใหม่ ยอดเดิม"""
    n = js("needOf", plan_of(matSwap={"HP-001": {"to": "hp-002", "d": "SCREW NEW"}}))
    assert [(h["code"], h["qty"], h["from"]) for h in n["hw"]] == [("HP-002", 30, "HP-001")]


# ── BOM ที่ตั้งในระบบ ──
@P
def test_bom_for_save_only_qr_children(js):
    """TC-PLAN-050 ลูกใน BOM ระบบ = ซับ + พาร์ทที่มี QR เท่านั้น (กระจก / สกรู ไม่อยู่ ไม่งั้นหน้าตรวจประกอบรอของที่สแกนไม่ได้)"""
    p = plan_of()
    r = js.steps([{"fn": "needOf", "args": [p]}, {"fn": "bomForSave", "args": [p["bom"], {"$ref": 0}, None]}])[1]
    by = {x["code"]: {c["code"]: c["qty"] for c in x["children"]} for x in r["list"]}
    assert by["UA1001"] == {"SA01-001": 2, "MFA183-5001 A": 4}
    assert by["SA01-001"] == {"HZ02-025": 3, "SF01-010": 1, "SAAL-002": 1}
    assert by["SAAL-002"] == {"FS01-001": 2}
    assert r["frac"] == []


@B
def test_bom_for_save_reports_fraction_rounding(js):
    """TC-PLAN-051 จำนวนต่อชุดเป็นเศษ → ปัดเป็นจำนวนเต็ม และต้องแจ้งรายการที่ปัด"""
    p = plan_of()
    p["bom"]["subs"]["SAAL-002"]["items"] = [["part", "FS01-001", 2.5]]
    r = js.steps([{"fn": "needOf", "args": [p]}, {"fn": "bomForSave", "args": [p["bom"], {"$ref": 0}, None]}])[1]
    kid = next(x for x in r["list"] if x["code"] == "SAAL-002")["children"][0]
    assert kid["qty"] == 3 and len(r["frac"]) == 1 and "SAAL-002" in r["frac"][0]


# ── เทียบใบปะหน้า ──
@P
def test_compare_order_statuses(js):
    """TC-PLAN-060 ตรง / มากกว่า / น้อยกว่า / ไม่มีในใบ"""
    order = {"items": [
        {"code": "UA1001", "qty": 3}, {"code": "SA01-001", "qty": 5}, {"code": "HZ02-025", "qty": 20},
        {"code": "ZZ-404", "qty": 1}, {"code": "SF01-010", "qty": None}]}
    r = js.steps([{"fn": "needOf", "args": [plan_of()]}, {"m": "order", "fn": "compareOrder", "args": [order, {"$ref": 0}]}])[1]
    assert [(x["code"], x["status"], x["have"]) for x in r] == [
        ("UA1001", "ok", 3), ("SA01-001", "more", 6), ("HZ02-025", "less", 18), ("ZZ-404", "missing", 0), ("SF01-010", "ok", 6)]


@R
def test_compare_order_code_written_without_letter(js):
    """TC-PLAN-061 (2026-11-17) ใบเขียน "MFA183-5001" ในใบเป็น "MFA183-5001 A" → ต้องจับคู่ได้"""
    order = {"items": [{"code": "MFA183-5001", "qty": 12}]}
    r = js.steps([{"fn": "needOf", "args": [plan_of()]}, {"m": "order", "fn": "compareOrder", "args": [order, {"$ref": 0}]}])[1]
    assert (r[0]["status"], r[0]["have"]) == ("ok", 12)


@N
def test_compare_order_without_inputs(js):
    """TC-PLAN-062"""
    assert js("compareOrder", None, None, m="order") == []


# ── แบบ MARKING (BILL OF EXTRUSION) ──
LOOSE = {"file": "MTG01-5001.pdf", "kind": "loose", "code": "MTG01-5001", "title": {"REV.": "-", "SHEET_REV": "A"},
         "site": [{"code": "msa101-5001", "desc": "ASSEMBLY", "qty": 2, "len": 3000}, {"code": "MFA183-5001 A", "desc": "MULLION", "qty": 4, "len": 2500}, {"code": "", "qty": 1}],
         "hw": [{"code": "HP-001", "desc": "SCREW", "qty": 12, "u": "pcs."}, {"code": "GK-01", "desc": "GASKET", "qty": 3.5, "u": "m."}]}
PART_PDF = {"file": "HZ02-025.pdf", "kind": "part", "code": "HZ02-025", "title": {"LENGTH": "1200", "INV.CODE": "23HZ02600C", "REV.": "-", "SHEET_REV": "b", "DESC": "TRANSOM"}, "bom": []}


@R
def test_marking_drawing_becomes_panel(js):
    """TC-PLAN-070 (ผู้ใช้ 2026-11-18) MTG01-5001 ใช้เป็น Unit → เป็นแผง มีรายการลูกจาก BILL OF EXTRUSION"""
    out = js("markingAsPanel", [LOOSE, PART_PDF], jset(["MTG01-5001"]))
    d = out[0]
    assert (d["kind"], d["marking"]) == ("panel", True)
    assert [(b["code"], b["qty"], b["_k"]) for b in d["bom"]] == [
        ("MSA101-5001", 2, "sub"), ("MFA183-5001 A", 4, "part"), ("HP-001", 12, "hw"), ("GK-01", 3.5, "hw")]
    assert [b.get("qty_unit") for b in d["bom"][2:]] == ["pcs", "m"]
    assert out[1] == PART_PDF


@N
def test_marking_drawing_not_a_unit_stays_loose(js):
    """TC-PLAN-071 แบบ loose ที่ไม่ได้เป็น Unit ของใบ → ไม่ถูกเปลี่ยน"""
    assert js("markingAsPanel", [LOOSE], jset(["UA1001"]))[0]["kind"] == "loose"
    assert js("markingAsPanel", [LOOSE], jset([]))[0]["kind"] == "loose"


@R
def test_marking_drawing_builds_panel_bom_and_explodes(js):
    """TC-PLAN-072 MARKING → BOM ของแผง → ยอดทั้งใบ = จำนวนแผง × จำนวนในแบบ (ผู้ใช้ยืนยัน 2026-11-18: QTY ในแบบ = ต่อ 1 แผง · 12 ลง 2 แผง = 24)"""
    out = js.steps([
        {"fn": "markingAsPanel", "args": [[LOOSE], jset(["MTG01-5001"])]},
        {"fn": "buildBom", "args": [{"lib": None, "pdfs": {"$ref": 0}, "ack": {}, "useLib": False}]},
    ])
    bom = out[1]
    assert [(i[0], i[1], i[2]) for i in bom["panels"]["MTG01-5001"]["items"]] == [
        ("sub", "MSA101-5001", 2), ("part", "MFA183-5001 A", 4), ("hw", "HP-001", 12), ("hw", "GK-01", 3.5)]
    assert bom["parts"]["HP-001"]["k"] == "hw" and bom["parts"]["HP-001"]["u"] == "pcs." and bom["parts"]["GK-01"]["u"] == "m."
    n = js("needOf", {"ro": "P-900", "units": [{"unit": "MTG01-5001", "addr": "A-101"}, {"unit": "MTG01-5001", "addr": "A-102"}], "bom": bom})
    assert qty(n["subs"]) == {"MSA101-5001": 4}
    assert qty(n["parts"]) == {"MFA183-5001 A": 8}
    assert qty(n["hw"]) == {"GK-01": 7, "HP-001": 24}


@P
def test_build_bom_part_drawing_fields_and_rev(js):
    """TC-PLAN-073 แบบพาร์ท: ความยาว / INV / Rev จากช่อง REV. (ไม่ใช่ตัวอักษรท้ายเบอร์)"""
    bom = js("buildBom", {"lib": None, "pdfs": [PART_PDF], "ack": {}, "useLib": False})
    p = bom["parts"]["HZ02-025"]
    assert (p["l"], p["m"], p["rev"], p["d"], p["pdf"]) == (1200, "23HZ02600C", "B", "TRANSOM", "HZ02-025.pdf")


@R
def test_build_bom_keeps_part_a_when_b_exists(js):
    """TC-PLAN-074 (2026-11-17) วางแบบ "X A" ขณะคลังมี "X B" → ต้องได้ทั้งสองเบอร์ ไฟล์ A ไม่ถูกข้าม"""
    lib = {"panels": {}, "subs": {}, "parts": {"MFA183-5001 B": {"d": "B", "l": 2600, "k": "part"}}}
    pdf = {"file": "a.pdf", "kind": "part", "code": "MFA183-5001 A", "title": {"LENGTH": "2500", "INV.CODE": "23HZ02600C"}, "bom": []}
    bom = js("buildBom", {"lib": lib, "pdfs": [pdf], "ack": {}, "useLib": True})
    assert bom["parts"]["MFA183-5001 A"]["l"] == 2500 and bom["parts"]["MFA183-5001 B"]["l"] == 2600


# ── ของที่ปล่อยไปแล้ว ──
def rel(ro, code, q, kind="part", note="", cancelled=None, prj="PYT-X"):
    return {"id": f"{ro}|{code}", "release_order": ro, "release_date": "2026-11-18", "qty": q, "note": note, "mod_cancelled_at": cancelled,
            "part_master": {"part_no": code, "kind": kind, "projects": {"code": prj}}}


@P
def test_released_of_groups_lots(js):
    """TC-PLAN-080 ของที่ปล่อยแล้ว: แยกล็อต · รวมยอดต่อเบอร์ · ที่อยู่แผงที่ปล่อยแล้ว"""
    rows = [rel("P-900.1", "HZ02-025", 5), rel("P-900.2", "HZ02-025", 4), rel("P-900.2", "SA01-001", 2, "subassembly"),
            rel("P-900.1", "UA1001", 2, "panel", "ที่อยู่: 25-E-301, 25-E-302")]
    r = js("releasedOf", rows, {"ro": "P-900", "projectCode": "PYT-X"})
    assert [(L["no"], L["panels"], L["subs"], L["parts"]) for L in r["lots"]] == [("P-900.1", 2, 0, 1), ("P-900.2", 0, 1, 1)]
    by = dict(r["byCode"]["$map"])
    assert by["HZ02-025"]["qty"] == 9 and by["HZ02-025"]["lots"] == ["P-900.1", "P-900.2"]
    assert dict(r["addrLot"]["$map"]) == {"25-E-301": "P-900.1", "25-E-302": "P-900.1"}


@R
@N
def test_released_of_ignores_other_release_and_project(js):
    """TC-PLAN-081 ล็อตของใบอื่น (P-9001 / P-90) และของโปรเจคอื่น ต้องไม่ปนมาเป็นของใบ P-900"""
    rows = [rel("P-9001.1", "HZ02-025", 5), rel("P-90.1", "HZ02-025", 5), rel("P-900.1", "HZ02-025", 7, prj="PYT-OTHER")]
    r = js("releasedOf", rows, {"ro": "P-900", "projectCode": "PYT-X"})
    assert r["lots"] == [] and r["byCode"]["$map"] == []
    assert dict(r["other"]["$map"])["HZ02-025"]["qty"] == 10      # ปล่อยไว้ในใบอื่นของโปรเจคเดียวกัน = ใช้เป็นลูกได้


@R
def test_issued_hardware_counts_glass(js):
    """TC-PLAN-082 (2026-11-18) ช่อง "ปล่อยแล้ว" ของกระจกต้องมีค่า เมื่อปล่อยแผงไปแล้ว"""
    p = plan_of()
    rows = [rel("P-900.1", "UA1001", 2, "panel", "ที่อยู่: 25-E-301, 25-E-302")]
    out = js.steps([
        {"fn": "needOf", "args": [p]},
        {"fn": "releasedOf", "args": [rows, p]},
        {"fn": "hwIssuedOf", "args": [p, {"$ref": 0}, {"$ref": 1}]},
    ])[2]
    m = dict(out["$map"])
    assert m["GL-01"]["qty"] == 2 and m["HP-001"]["qty"] == 20


# ── Site Item ไม่มี INV (sim-test 2026-11-18) ──
@R
def test_inv_filled_from_released_rows(js):
    """TC-PLAN-090 พาร์ทที่ใบไม่รู้ INV (Site Item เพิ่มจากแบบ) แต่แถวที่ปล่อยแล้วมีวัสดุ → Total Mat. ต้องรู้ INV"""
    p = plan_of(extra=[{"code": "MMT004-002 A", "kind": "part", "qty": 1, "l": 652, "inv": "", "cat": "SITE ITEM", "dest": "CUTTING"}])
    r = rel("P-900.1", "MMT004-002 A", 1)
    r["material"] = "mt004480d"
    out = js.steps([
        {"fn": "needOf", "args": [p]},
        {"fn": "releasedOf", "args": [[r], p]},
        {"fn": "fillInvFromReleased", "args": [{"$ref": 0}, {"$ref": 1}, p]},
    ])
    assert row(js("needOf", p)["parts"], "MMT004-002 A")["inv"] == ""      # ก่อนเติม (เรียกแยก — ขั้นเติมแก้ค่าในก้อนเดิม)
    x = row(out[2]["parts"], "MMT004-002 A")
    assert (x["inv"], x["invSrc"]) == ("MT004480D", "released")
    mats = js("cutMaterials", out[2]["parts"])
    assert any(m["inv"] == "MT004480D" and m["pcs"] == 1 for m in mats)


@N
def test_inv_from_released_does_not_override_plan_inv(js):
    """TC-PLAN-091 เบอร์ที่ใบรู้ INV อยู่แล้ว → ไม่ถูกทับด้วยวัสดุของแถวที่ปล่อย · แถวที่ยกเลิกไม่ใช้"""
    p = plan_of(extra=[{"code": "MMT004-003 A", "kind": "part", "qty": 1, "inv": ""}])
    a = rel("P-900.1", "HZ02-025", 5)
    a["material"] = "OTHER600C"
    b = rel("P-900.1", "MMT004-003 A", 1, cancelled="2026-11-18")
    b["material"] = "MT004480D"
    out = js.steps([
        {"fn": "needOf", "args": [p]},
        {"fn": "releasedOf", "args": [[a, b], p]},
        {"fn": "fillInvFromReleased", "args": [{"$ref": 0}, {"$ref": 1}, p]},
    ])[2]
    assert row(out["parts"], "HZ02-025")["inv"] == "23HZ02600C"
    assert row(out["parts"], "MMT004-003 A")["inv"] == ""


@P
def test_added_part_takes_inv_from_plan_library(js):
    """TC-PLAN-092 เบอร์ที่เพิ่มโดยไม่ใส่ INV แต่คลังของใบรู้วัสดุ → ใช้วัสดุจากคลังของใบ"""
    p = plan_of(extra=[{"code": "HZ77-001", "kind": "part", "qty": 2, "inv": ""}])
    p["bom"]["parts"]["HZ77-001"] = {"d": "X", "l": 500, "m": "23HZ77600C", "k": "part"}
    assert row(js("needOf", p)["parts"], "HZ77-001")["inv"] == "23HZ77600C"


# ── Modify: ลูกใหม่ที่เป็นอุปกรณ์ (แบบ MARKING) ──
@R
def test_bom_edit_add_hardware_child_has_no_qr(js):
    """TC-PLAN-095 เพิ่มสกรูเป็นลูกของแผงผ่าน Modify → เข้าใบเบิกอุปกรณ์ ไม่กลายเป็นพาร์ทมี QR"""
    p = plan_of()
    edits = [{"scope": "panel", "owner": "UA1001", "type": "add", "kind": "hw", "code": "HP-777", "qty": 4, "d": "SCREW", "u": "pcs."},
             {"scope": "panel", "owner": "UA1001", "type": "add", "kind": "part", "code": "HZ88-001", "qty": 1, "d": "NEW PART"},
             {"scope": "panel", "owner": "UA1001", "type": "add", "kind": "sub", "code": "MSA101-5001", "qty": 2}]
    bom = js("applyBomEdits", p["bom"], edits, "M-001")
    assert bom["parts"]["HP-777"]["k"] == "hw" and bom["parts"]["HZ88-001"]["k"] == "part"
    n = js("needOf", {**p, "bom": bom})
    assert qty(n["hw"])["HP-777"] == 12 and "HP-777" not in qty(n["parts"])
    assert qty(n["parts"])["HZ88-001"] == 3 and qty(n["subs"])["MSA101-5001"] == 6


# ── QR กระจกของแผง (ผู้ใช้ 2026-11-19: 1 QR ต่อแผ่น · ป้ายบอกแบบแผง + ที่อยู่) ──
def glass_plan():
    p = plan_of()
    # กระจกอีกเบอร์อยู่ในซับ (หน้าต่าง) ×2 ต่อซับ → ต่อแผง = 2 ซับ × 2 = 4
    p["bom"]["subs"]["SA01-001"]["items"].append(["part", "GL-02", 2])
    p["bom"]["parts"]["GL-02"] = {"d": "GLASS IN SUB", "k": "part"}
    return p


def lot_rows(js, p, addrs):
    return js.steps([{"fn": "needOf", "args": [p]},
                     {"fn": "lotRows", "args": [p, {"$ref": 0}, {"addrs": jset(addrs), "subs": jmap([]), "parts": jmap([])}, ""]},
                     {"fn": "glassQrRows", "args": [p, {"$ref": 0}, {"$ref": 1}]}])


@P
def test_glass_qr_rows_one_per_panel_address(js):
    """TC-PLAN-100 ปล่อยแผง 2 ที่อยู่ → แถว QR กระจกต่อ (เบอร์กระจก · ที่อยู่): GL-01 ×1 และ GL-02 ×4 (อยู่ในซับ) ต่อแผง"""
    _, rows, glass = lot_rows(js, glass_plan(), ["25-E-301", "25-E-303"])
    assert [(r["kind"], r["code"], r["qty"]) for r in rows] == [("panel", "UA1001", 2)]
    assert [(g["code"], g["qty"], g["glassOf"]["unit"], g["glassOf"]["addr"]) for g in glass] == [
        ("GL-01", 1, "UA1001", "25-E-301"), ("GL-02", 4, "UA1001", "25-E-301"),
        ("GL-01", 1, "UA1001", "25-E-303"), ("GL-02", 4, "UA1001", "25-E-303")]
    assert all(g["kind"] == "glass" and g["remark"].startswith("ใบ: GLASS · กระจกของแผง: UA1001 @ ") for g in glass)


@N
def test_glass_qr_rows_none_without_panels_or_glass(js):
    """TC-PLAN-101 ล็อตที่ไม่มีแผง / แผงที่ไม่มีกระจก → ไม่มีแถว QR กระจก"""
    p = glass_plan()
    need = js("needOf", p)
    only_parts = [{"kind": "part", "code": "HZ02-025", "qty": 3, "remark": "ใบ: CUTTING"}]
    assert js.steps([{"fn": "needOf", "args": [p]}, {"fn": "glassQrRows", "args": [p, {"$ref": 0}, only_parts]}])[1] == []
    q = plan_of()
    q["bom"]["panels"]["UA1001"]["items"] = [x for x in q["bom"]["panels"]["UA1001"]["items"] if x[1] != "GL-01"]
    assert lot_rows(js, q, ["25-E-301"])[2] == []
    assert need["glass"]


@B
def test_glass_qr_rows_cancelled_line_and_swap(js):
    """TC-PLAN-102 บรรทัดกระจกที่ยกเลิกไม่ออก QR · กระจกที่เปลี่ยนเบอร์ (ใช้เบอร์อื่นแทน) ออก QR เป็นเบอร์ใหม่"""
    p = glass_plan()
    p["bom"]["subs"]["SA01-001"]["items"][-1] = ["part", "GL-02", 2, None, "ยกเลิก"]
    p["matSwap"] = {"GL-01": {"to": "gl-99", "d": "NEW GLASS"}}
    glass = lot_rows(js, p, ["25-E-302"])[2]
    assert [(g["code"], g["qty"]) for g in glass] == [("GL-99", 1)]


@P
@pytest.mark.parametrize("tid,note,exp", [
    ("TC-PLAN-103", "ใบ: GLASS · กระจกของแผง: UA1001 @ 25-E-301", {"unit": "UA1001", "addr": "25-E-301"}),
    ("TC-PLAN-104", "ใบ: GLASS · กระจกของแผง: MTG01-5001 @ MOCK-EMU-1 · หมายเหตุอื่น", {"unit": "MTG01-5001", "addr": "MOCK-EMU-1"}),
    ("TC-PLAN-105", "ใบ: CUTTING", None),
    ("TC-PLAN-106", None, None),
])
def test_glass_of_note(js, tid, note, exp):
    assert js("glassOfNote", note) == exp, tid


@R
def test_released_of_keeps_glass_qr_out_of_part_totals(js):
    """TC-PLAN-107 แถว QR กระจกไม่นับเป็นพาร์ทของล็อต / ไม่นับยอดปล่อย / ไม่เป็น "ปล่อยไว้ในใบอื่น" — เก็บแยกที่ lot.glassQr"""
    rows = [rel("P-900.1", "UA1001", 1, "panel", "ที่อยู่: 25-E-301"), rel("P-900.1", "HZ02-025", 5),
            rel("P-900.1", "GL-01", 1, note="ใบ: GLASS · กระจกของแผง: UA1001 @ 25-E-301"),
            rel("P-901.1", "GL-01", 1, note="ใบ: GLASS · กระจกของแผง: UA1001 @ 99-X-1")]
    r = js("releasedOf", rows, {"ro": "P-900", "projectCode": "PYT-X"})
    lot = r["lots"][0]
    assert (lot["panels"], lot["parts"], lot["qty"]) == (1, 1, 6)
    assert [(g["code"], g["qty"], g["unit"], g["addr"]) for g in lot["glassQr"]] == [("GL-01", 1, "UA1001", "25-E-301")]
    assert "GL-01" not in dict(r["byCode"]["$map"]) and "GL-01" not in dict(r["other"]["$map"])
    assert [x["code"] for x in lot["rows"]] == ["UA1001", "HZ02-025"]


# ── QR แผงผูกกับที่อยู่ทีละใบ (ผู้ใช้ 2026-11-19: "ผูกทีละใบ") ──
NOTE3 = "ใบ: ASSEMBLY · ที่อยู่: 25-E-301, 25-e-302, 25-E-303"


@P
@pytest.mark.parametrize("tid,unit_no,exp", [("TC-PLAN-110", 1, "25-E-301"), ("TC-PLAN-111", 2, "25-E-302"), ("TC-PLAN-112", 3, "25-E-303"), ("TC-PLAN-113", "2", "25-E-302")])
def test_unit_addr_of_nth_unit(js, tid, unit_no, exp):
    """QR แผงใบที่ n = ที่อยู่ลำดับที่ n ของแถวปล่อย (ตัวพิมพ์ใหญ่)"""
    assert js("unitAddrOf", NOTE3, unit_no) == exp, tid


@B
@pytest.mark.parametrize("tid,note,unit_no", [
    ("TC-PLAN-114", NOTE3, 4),            # ลำดับเกินจำนวนที่อยู่
    ("TC-PLAN-115", NOTE3, 0),
    ("TC-PLAN-116", NOTE3, None),
    ("TC-PLAN-117", "ใบ: CUTTING", 1),    # แถวที่ไม่มีที่อยู่
    ("TC-PLAN-118", None, 1),
])
def test_unit_addr_of_unknown_is_blank(js, tid, note, unit_no):
    """หาไม่ได้ = ว่าง (ไม่เดาที่อยู่)"""
    assert js("unitAddrOf", note, unit_no) == "", tid


@R
def test_unit_addr_matches_glass_rows_of_same_lot(js):
    """TC-PLAN-119 ที่อยู่ของ QR แผงแต่ละใบ ตรงกับที่อยู่ในแถว QR กระจกที่ออกในล็อตเดียวกัน (ใช้เทียบตอนสแกน)"""
    need, rows, glass = lot_rows(js, glass_plan(), ["25-E-303", "25-E-301"])
    panel = rows[0]
    addrs = [js("unitAddrOf", panel["remark"], i + 1) for i in range(panel["qty"])]
    assert sorted(addrs) == ["25-E-301", "25-E-303"]
    assert sorted({g["glassOf"]["addr"] for g in glass}) == sorted(addrs)
