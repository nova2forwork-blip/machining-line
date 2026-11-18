"""TC-DB — กติกาในฐานข้อมูล (Supabase ในเครื่องเท่านั้น · ข้อมูลจำลองรหัส PYT-)

ที่มาของผลที่คาด
- migration-sim-fixes-2026-11-18.sql: ปล่อยล็อตแบบตรวจยอด (กันสองหน้าต่างปล่อยเกินยอด) · QR ตามน้ำหนัก/ความยาวของแถวปล่อย
- migration-office-rights-2026-11-12.sql: ลบโปรเจค / ยกเลิกใบหลัก / ลบทั้งล็อต = แอดมินเท่านั้น
- release_plan_save: ห้ามเลขใบซ้ำ · สองคนแก้พร้อมกัน คนหลังต้องเจอ conflict
"""
import json
import threading
import uuid

import pytest

from conftest import connect, has_fn, one, q

pytestmark = pytest.mark.db
P, N, B, R = pytest.mark.positive, pytest.mark.negative, pytest.mark.boundary, pytest.mark.regression

CHECKED = "select public.create_release_batch_checked(%s,%s,%s,now(),%s,%s,%s::jsonb,%s,%s::jsonb)"


def release(conn, actors, pid, lot, rows, limits, plan_ro="P-900", role="office", make_qr=True, token=None):
    return one(conn, CHECKED, (token or actors.tok[role], pid, lot, actors.emp[role], make_qr, json.dumps(rows), plan_ro, json.dumps(limits) if limits is not None else None))


def released_qty(conn, pid, code="PYT-A"):
    return one(conn, "select coalesce(sum(r.qty),0) from releases r join part_master m on m.id=r.part_master_id where m.project_id=%s and lower(btrim(m.part_no))=lower(%s) and r.mod_cancelled_at is null", (pid, code))


def unit_count(conn, pid):
    return one(conn, "select count(*) from part_units u join part_master m on m.id=u.part_master_id where m.project_id=%s", (pid,))


@pytest.fixture(autouse=True)
def _need_migration(db):
    if not has_fn(db, "create_release_batch_checked"):
        pytest.skip("ฐานข้อมูลในเครื่องยังไม่ได้รัน migration-sim-fixes-2026-11-18.sql")


# ── ปล่อยล็อตแบบตรวจยอด ──
@P
def test_checked_release_within_limit(db, actors, project):
    """TC-DB-001 ปล่อย 3 จากยอดต้องใช้ 5 → สำเร็จ + QR 3 ดวง"""
    r = release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 3, "unit_weight": 1.5, "length_mm": 1200}], [{"code": "PYT-A", "max": 5}])
    assert (r["releasesCreated"], r["partsCreated"], r["unitsCreated"]) == (1, 1, 3)
    assert released_qty(db, project) == 3 and unit_count(db, project) == 3


@B
def test_checked_release_exactly_at_limit(db, actors, project):
    """TC-DB-002 ปล่อยแล้ว 3 + อีก 2 = 5 พอดียอด → ต้องผ่าน"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 3}], [{"code": "PYT-A", "max": 5}])
    release(db, actors, project, "P-900.2", [{"code": "PYT-A", "qty": 2}], [{"code": "PYT-A", "max": 5}])
    assert released_qty(db, project) == 5


@N
@B
def test_checked_release_one_over_limit_rejected(db, actors, project):
    """TC-DB-003 ปล่อยแล้ว 3 + อีก 3 = 6 > 5 → ปฏิเสธ (over_release) และไม่มีอะไรถูกสร้าง"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 3}], [{"code": "PYT-A", "max": 5}])
    with pytest.raises(Exception) as e:
        release(db, actors, project, "P-900.2", [{"code": "PYT-A", "qty": 3}, {"code": "PYT-B", "qty": 1}], [{"code": "PYT-A", "max": 5}])
    assert "over_release" in str(e.value)
    assert released_qty(db, project) == 3
    assert released_qty(db, project, "PYT-B") == 0, "เบอร์อื่นในล็อตเดียวกันต้องไม่ถูกสร้างเมื่อทั้งล็อตถูกปฏิเสธ"


@P
def test_checked_release_cancelled_rows_not_counted(db, actors, project):
    """TC-DB-004 แถวที่ยกเลิกใน Modify แล้ว ไม่นับเป็นยอดที่ปล่อย"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 5}], [{"code": "PYT-A", "max": 5}], make_qr=False)
    db.execute("update releases set mod_cancelled_at=now() where part_master_id in (select id from part_master where project_id=%s)", (project,))
    release(db, actors, project, "P-900.2", [{"code": "PYT-A", "qty": 5}], [{"code": "PYT-A", "max": 5}], make_qr=False)
    assert released_qty(db, project) == 5


@R
def test_checked_release_other_plan_not_counted(db, actors, project):
    """TC-DB-005 ยอดของใบอื่น (P-9001 · P-90) ต้องไม่ถูกนับเป็นของใบ P-900"""
    release(db, actors, project, "P-9001.1", [{"code": "PYT-A", "qty": 5}], None, plan_ro="P-9001", make_qr=False)
    release(db, actors, project, "P-90.1", [{"code": "PYT-A", "qty": 5}], None, plan_ro="P-90", make_qr=False)
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 5}], [{"code": "PYT-A", "max": 5}], make_qr=False)
    assert released_qty(db, project) == 15


@B
def test_checked_release_code_match_ignores_case_and_spaces(db, actors, project):
    """TC-DB-006 เบอร์เดียวกันเขียนต่างตัวพิมพ์ / มีช่องว่างท้าย → นับเป็นเบอร์เดียวกัน"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 4}], [{"code": "PYT-A", "max": 5}], make_qr=False)
    with pytest.raises(Exception) as e:
        release(db, actors, project, "P-900.2", [{"code": " pyt-a ", "qty": 2}], [{"code": "pyt-a", "max": 5}], make_qr=False)
    assert "over_release" in str(e.value)


@B
def test_checked_release_code_without_limit_not_checked(db, actors, project):
    """TC-DB-007 เบอร์ที่ไม่ได้ส่งยอดต้องใช้มา = ไม่ตรวจ (ตามข้อกำหนดของฟังก์ชัน)"""
    r = release(db, actors, project, "P-900.1", [{"code": "PYT-B", "qty": 99}], [{"code": "PYT-A", "max": 5}], make_qr=False)
    assert r["releasesCreated"] == 1


@R
def test_checked_release_two_windows_at_once(db, actors, project):
    """TC-DB-008 (sim-test R: สองหน้าต่างปล่อยเบอร์เดียวกันพร้อมกัน) ยอดต้องใช้ 5 · สองคนปล่อยคนละ 3 → ผ่านได้คนเดียว"""
    res = []
    gate = threading.Barrier(2)

    def worker(n):
        c = connect()
        try:
            gate.wait(timeout=10)
            release(c, actors, project, f"P-900.{n}", [{"code": "PYT-A", "qty": 3}], [{"code": "PYT-A", "max": 5}], make_qr=False)
            res.append("ok")
        except Exception as e:  # noqa: BLE001
            res.append("over" if "over_release" in str(e) else f"error: {e}")
        finally:
            c.close()

    ts = [threading.Thread(target=worker, args=(i,)) for i in (1, 2)]
    [t.start() for t in ts]
    [t.join(30) for t in ts]
    assert sorted(res) == ["ok", "over"], res
    assert released_qty(db, project) == 3


@N
def test_checked_release_skips_blank_and_zero_rows(db, actors, project):
    """TC-DB-009 แถวไม่มีเบอร์ / จำนวน 0 / ติดลบ ไม่ถูกสร้าง"""
    r = release(db, actors, project, "P-900.1", [{"code": "", "qty": 3}, {"code": "PYT-A", "qty": 0}, {"code": "PYT-C", "qty": -2}], [], make_qr=True)
    assert (r["releasesCreated"], r["unitsCreated"]) == (0, 0)


@N
@pytest.mark.parametrize("tid,token", [("TC-DB-010", "random"), ("TC-DB-011", None)])
def test_checked_release_requires_session(db, actors, project, tid, token):
    """ไม่มี session / session ปลอม → unauthorized และไม่มีอะไรถูกสร้าง"""
    tok = str(uuid.uuid4()) if token == "random" else None
    with pytest.raises(Exception) as e:
        one(db, CHECKED, (tok, project, "P-900.1", actors.emp["office"], False, json.dumps([{"code": "PYT-A", "qty": 1}]), "P-900", "[]"))
    assert "unauthorized" in str(e.value), tid
    assert released_qty(db, project) == 0


@N
def test_checked_release_expired_session(db, actors, project):
    """TC-DB-012 session หมดอายุ → unauthorized"""
    tok = actors.new_session("office")
    db.execute("update sessions set expires_at = now() - interval '1 minute' where token=%s", (tok,))
    with pytest.raises(Exception) as e:
        release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 1}], [], token=tok)
    assert "unauthorized" in str(e.value)


@P
def test_checked_release_reuses_existing_part(db, actors, project):
    """TC-DB-013 เบอร์ที่มีอยู่แล้วในโปรเจค (ต่างตัวพิมพ์) ไม่ถูกสร้างซ้ำใน part_master"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 1}], [], make_qr=False)
    r = release(db, actors, project, "P-900.2", [{"code": "pyt-a", "qty": 1}], [], make_qr=False)
    assert r["partsCreated"] == 0
    assert one(db, "select count(*) from part_master where project_id=%s", (project,)) == 1


# ── QR ตามแถวปล่อย ──
def _two_releases(db, actors, project):
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 2, "unit_weight": 1.0, "length_mm": 1000}], [])
    release(db, actors, project, "P-900.2", [{"code": "PYT-A", "qty": 2, "unit_weight": 1.0, "length_mm": 1000}], [])
    return [r[0] for r in q(db, "select r.id from releases r join part_master m on m.id=r.part_master_id where m.project_id=%s order by r.release_order", (project,))]


@R
def test_units_follow_release_weight(db, actors, project):
    """TC-DB-020 (2026-11-18) แก้น้ำหนัก/ชิ้นของแถวปล่อย → QR ทุกดวงของแถวนั้นตาม · แถวอื่นไม่เปลี่ยน"""
    a, b = _two_releases(db, actors, project)
    db.execute("update releases set unit_weight=2.75 where id=%s", (a,))
    assert {float(x[0]) for x in q(db, "select weight from part_units where release_id=%s", (a,))} == {2.75}
    assert {float(x[0]) for x in q(db, "select weight from part_units where release_id=%s", (b,))} == {1.0}


@R
def test_units_follow_release_length(db, actors, project):
    """TC-DB-021 แก้ความยาวของแถวปล่อย → QR ตาม"""
    a, b = _two_releases(db, actors, project)
    db.execute("update releases set length_mm=1234.5 where id=%s", (a,))
    assert {float(x[0]) for x in q(db, "select length_mm from part_units where release_id=%s", (a,))} == {1234.5}
    assert {float(x[0]) for x in q(db, "select length_mm from part_units where release_id=%s", (b,))} == {1000.0}


@B
def test_units_follow_weight_set_to_null(db, actors, project):
    """TC-DB-022 ล้างน้ำหนักของแถวปล่อย (null) → QR ก็ว่างตาม ไม่ค้างค่าเดิม"""
    a, _ = _two_releases(db, actors, project)
    db.execute("update releases set unit_weight=null where id=%s", (a,))
    assert {x[0] for x in q(db, "select weight from part_units where release_id=%s", (a,))} == {None}


@N
def test_units_not_touched_by_other_edits(db, actors, project):
    """TC-DB-023 แก้หมายเหตุของแถวปล่อย → น้ำหนัก / ความยาวของ QR ไม่เปลี่ยน"""
    a, _ = _two_releases(db, actors, project)
    db.execute("update releases set note='pytest' where id=%s", (a,))
    assert {(float(x[0]), float(x[1])) for x in q(db, "select weight, length_mm from part_units where release_id=%s", (a,))} == {(1.0, 1000.0)}


# ── บันทึกใบ Release ──
SAVE = "select public.release_plan_save(%s,%s,%s,%s::jsonb,%s,%s)"


def save(conn, tok, pid, ro, plan=None, pid_row=None, base_at=None):
    return one(conn, SAVE, (tok, pid, ro, json.dumps(plan or {"ro": ro}), pid_row, base_at))


@P
def test_plan_save_new(db, actors, project):
    """TC-DB-030 สร้างใบใหม่"""
    r = save(db, actors.tok["office"], project, "P-900")
    assert r["ok"] is True and r["id"]


@N
@pytest.mark.parametrize("tid,ro", [("TC-DB-031", "P-900"), ("TC-DB-032", " p-900 ")])
def test_plan_save_duplicate(db, actors, project, tid, ro):
    """เลขใบซ้ำในโปรเจคเดียวกัน (ไม่สนตัวพิมพ์ / ช่องว่าง) → duplicate"""
    save(db, actors.tok["office"], project, "P-900")
    r = save(db, actors.tok["office"], project, ro)
    assert (r["ok"], r.get("reason")) == (False, "duplicate"), tid


@R
@N
def test_plan_save_duplicate_same_number_different_zeros(db, actors, project):
    """TC-DB-033 P-9 กับ P-009 คือเลขเดียวกัน (กติกา "P-9 = P-09 = P-009") → ฐานข้อมูลต้องไม่ยอมให้มีสองใบ"""
    save(db, actors.tok["office"], project, "P-009")
    r = save(db, actors.tok["office"], project, "P-9")
    assert (r["ok"], r.get("reason")) == (False, "duplicate")


@B
def test_plan_save_suffix_makes_a_different_release(db, actors, project):
    """TC-DB-042 ส่วนท้าย "(…)" ต้องตรงกันจึงนับว่าซ้ำ: P-009 กับ P-009 (A) เป็นคนละใบ · P-9(A) ซ้ำกับ P-009 (A)"""
    assert save(db, actors.tok["office"], project, "P-009")["ok"] is True
    assert save(db, actors.tok["office"], project, "P-009 (A)")["ok"] is True
    assert save(db, actors.tok["office"], project, "P-9(A)").get("reason") == "duplicate"


@R
def test_ro_key_same_in_database_and_app(db, js):
    """TC-DB-043 กุญแจเทียบเลขใบในฐานข้อมูล (_ro_key) ต้องให้ผลเดียวกับหน้าจอ (roKey) ทุกรูปแบบ"""
    if not has_fn(db, "_ro_key"):
        pytest.skip("ฐานข้อมูลในเครื่องยังไม่ได้รัน migration-ro-key-2026-11-18.sql")
    samples = ["P-9", "P-09", "P-009", "p - 009", "P-002.01", "P-002.10", "P-012 (A)", "P-12( a b )", "P-000", "P-1234", "LIB", " lib ",
               "DRAFT:abc def", "", "ABC", "P-2.0", "7"]
    app = js.steps([{"fn": "roKey", "args": [s]} for s in samples])
    dbk = [one(db, "select public._ro_key(%s)", (s,)) for s in samples]
    assert dbk == app


@R
def test_plan_save_same_number_two_windows_at_once(db, actors, project):
    """TC-DB-044 สองหน้าต่างสร้างใบเลขเดียวกัน (สะกดต่างกัน) พร้อมกัน → ได้ใบเดียว"""
    res = []
    gate = threading.Barrier(2)

    def worker(ro):
        c = connect()
        try:
            gate.wait(timeout=10)
            r = save(c, actors.tok["office"], project, ro)
            res.append("ok" if r["ok"] else r.get("reason"))
        except Exception as e:  # noqa: BLE001
            res.append(f"error: {e}")
        finally:
            c.close()

    ts = [threading.Thread(target=worker, args=(ro,)) for ro in ("P-009", "P-9")]
    [t.start() for t in ts]
    [t.join(30) for t in ts]
    assert sorted(res) == ["duplicate", "ok"], res
    assert one(db, "select count(*) from release_plans where project_id=%s", (project,)) == 1


@N
@pytest.mark.parametrize("tid,ro", [("TC-DB-034", ""), ("TC-DB-035", "   "), ("TC-DB-036", None)])
def test_plan_save_bad_input(db, actors, project, tid, ro):
    r = save(db, actors.tok["office"], project, ro)
    assert (r["ok"], r.get("reason")) == (False, "bad_input"), tid


@N
def test_plan_save_operator_forbidden(db, actors, project):
    """TC-DB-037 พนักงานหน้าเครื่องบันทึกใบ Release ไม่ได้"""
    with pytest.raises(Exception) as e:
        save(db, actors.tok["operator"], project, "P-900")
    assert "forbidden" in str(e.value)
    assert one(db, "select count(*) from release_plans where project_id=%s", (project,)) == 0


@P
def test_plan_save_update_with_fresh_base(db, actors, project):
    """TC-DB-038 แก้ใบด้วยเวลาล่าสุดที่อ่านมา → บันทึกได้ และเวลาเปลี่ยน"""
    a = save(db, actors.tok["office"], project, "P-900")
    b = save(db, actors.tok["office"], project, "P-900", {"ro": "P-900", "x": 1}, a["id"], a["updated_at"])
    assert b["ok"] is True and b["updated_at"] != a["updated_at"]
    assert one(db, "select plan->>'x' from release_plans where id=%s", (a["id"],)) == "1"


@R
@N
def test_plan_save_conflict_when_someone_else_saved(db, actors, project):
    """TC-DB-039 สองคนเปิดใบเดียวกัน คนแรกบันทึกแล้ว คนที่สองบันทึกด้วยเวลาเก่า → conflict และข้อมูลคนแรกไม่ถูกทับ"""
    a = save(db, actors.tok["office"], project, "P-900")
    save(db, actors.tok["admin"], project, "P-900", {"ro": "P-900", "who": "first"}, a["id"], a["updated_at"])
    r = save(db, actors.tok["office"], project, "P-900", {"ro": "P-900", "who": "second"}, a["id"], a["updated_at"])
    assert (r["ok"], r.get("reason")) == (False, "conflict")
    assert one(db, "select plan->>'who' from release_plans where id=%s", (a["id"],)) == "first"


@N
def test_plan_save_unknown_id(db, actors, project):
    """TC-DB-040"""
    r = save(db, actors.tok["office"], project, "P-900", None, str(uuid.uuid4()), None)
    assert (r["ok"], r.get("reason")) == (False, "not_found")


@B
def test_plan_save_same_number_allowed_after_cancel(db, actors, project):
    """TC-DB-041 ใบที่ยกเลิกแล้ว ไม่กันเลขใบเดิม"""
    a = save(db, actors.tok["office"], project, "P-900")
    db.execute("update release_plans set status='cancelled' where id=%s", (a["id"],))
    assert save(db, actors.tok["office"], project, "P-900")["ok"] is True


# ── สิทธิ์ ──
STATUS = "select public.release_plan_set_status(%s,%s,%s,%s)"


@R
@N
def test_office_cannot_cancel_main_release(db, actors, project):
    """TC-DB-050 (2026-11-12) ลบใบหลัก = แอดมินเท่านั้น"""
    a = save(db, actors.tok["office"], project, "P-900")
    r = one(db, STATUS, (actors.tok["office"], a["id"], "cancelled", False))
    assert (r["ok"], r.get("reason")) == (False, "admin_only")
    assert one(db, "select status from release_plans where id=%s", (a["id"],)) == "active"


@P
def test_admin_can_cancel_release_without_lots(db, actors, project):
    """TC-DB-051"""
    a = save(db, actors.tok["office"], project, "P-900")
    assert one(db, STATUS, (actors.tok["admin"], a["id"], "cancelled", False))["ok"] is True


@N
def test_admin_cancel_blocked_when_lots_exist(db, actors, project):
    """TC-DB-052 ใบที่ปล่อยล็อตไปแล้ว ลบไม่ได้ (has_lots) จนกว่าจะสั่งเก็บล็อตไว้"""
    a = save(db, actors.tok["office"], project, "P-900")
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 1}], [], make_qr=False)
    r = one(db, STATUS, (actors.tok["admin"], a["id"], "cancelled", False))
    assert (r["ok"], r.get("reason")) == (False, "has_lots")
    assert one(db, STATUS, (actors.tok["admin"], a["id"], "cancelled", True))["ok"] is True


@P
def test_office_can_delete_own_draft(db, actors, project):
    """TC-DB-053 ร่าง (DRAFT:) office ลบเองได้"""
    a = save(db, actors.tok["office"], project, f"DRAFT:{actors.emp['office']}", {"kind": "draft"})
    assert one(db, STATUS, (actors.tok["office"], a["id"], "cancelled", False))["ok"] is True


@N
@pytest.mark.parametrize("tid,status,reason", [("TC-DB-054", "deleted", "bad_status"), ("TC-DB-055", "", "bad_status")])
def test_set_status_bad_value(db, actors, project, tid, status, reason):
    a = save(db, actors.tok["office"], project, "P-900")
    r = one(db, STATUS, (actors.tok["admin"], a["id"], status, False))
    assert (r["ok"], r.get("reason")) == (False, reason), tid


@N
def test_set_status_unknown_plan(db, actors):
    """TC-DB-056"""
    r = one(db, STATUS, (actors.tok["admin"], str(uuid.uuid4()), "closed", False))
    assert (r["ok"], r.get("reason")) == (False, "not_found")


@R
@N
@pytest.mark.parametrize("tid,role", [("TC-DB-060", "office"), ("TC-DB-061", "operator")])
def test_only_admin_can_delete_project(db, actors, project, tid, role):
    """(2026-11-12) ลบโปรเจค = แอดมินเท่านั้น"""
    with pytest.raises(Exception) as e:
        db.execute("select public.authz_delete_project(%s,%s)", (actors.tok[role], project))
    assert "forbidden" in str(e.value), tid
    assert one(db, "select count(*) from projects where id=%s", (project,)) == 1


@P
def test_admin_delete_project_removes_children(db, actors, project):
    """TC-DB-062 แอดมินลบโปรเจค → Part / แถวปล่อย / QR / ใบ Release ของโปรเจคนั้นหายหมด"""
    save(db, actors.tok["office"], project, "P-900")
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 2}], [])
    db.execute("select public.authz_delete_project(%s,%s)", (actors.tok["admin"], project))
    assert one(db, "select count(*) from projects where id=%s", (project,)) == 0
    assert one(db, "select count(*) from part_master where project_id=%s", (project,)) == 0
    assert one(db, "select count(*) from release_plans where project_id=%s", (project,)) == 0


def _lot_ids(db, project, lot):
    return [r[0] for r in q(db, "select r.id from releases r join part_master m on m.id=r.part_master_id where m.project_id=%s and r.release_order=%s order by m.part_no", (project, lot))]


@P
def test_office_can_delete_one_code_of_a_lot(db, actors, project):
    """TC-DB-070 office ยกเลิกทีละบางเบอร์ของล็อตได้ (ยังเหลือเบอร์อื่น) → แถว + QR ของเบอร์นั้นหาย"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 2}, {"code": "PYT-B", "qty": 1}], [])
    a, b = _lot_ids(db, project, "P-900.1")
    db.execute("select public.authz_delete_release(%s,%s)", (actors.tok["office"], a))
    assert _lot_ids(db, project, "P-900.1") == [b] and unit_count(db, project) == 1


@R
@N
def test_office_cannot_delete_last_code_of_a_lot(db, actors, project):
    """TC-DB-071 (2026-11-12) ลบจนล็อตไม่เหลือเบอร์ไหน = แอดมินเท่านั้น"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 2}], [])
    (a,) = _lot_ids(db, project, "P-900.1")
    with pytest.raises(Exception) as e:
        db.execute("select public.authz_delete_release(%s,%s)", (actors.tok["office"], a))
    assert "forbidden" in str(e.value)
    assert _lot_ids(db, project, "P-900.1") == [a]


@P
def test_admin_can_delete_whole_lot(db, actors, project):
    """TC-DB-072"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 2}], [])
    (a,) = _lot_ids(db, project, "P-900.1")
    db.execute("select public.authz_delete_release(%s,%s)", (actors.tok["admin"], a))
    assert _lot_ids(db, project, "P-900.1") == [] and unit_count(db, project) == 0


@N
def test_operator_cannot_delete_release_row(db, actors, project):
    """TC-DB-073 พนักงานหน้าเครื่องลบแถวปล่อยไม่ได้"""
    release(db, actors, project, "P-900.1", [{"code": "PYT-A", "qty": 1}, {"code": "PYT-B", "qty": 1}], [], make_qr=False)
    a, _ = _lot_ids(db, project, "P-900.1")
    with pytest.raises(Exception) as e:
        db.execute("select public.authz_delete_release(%s,%s)", (actors.tok["operator"], a))
    assert "forbidden" in str(e.value)
