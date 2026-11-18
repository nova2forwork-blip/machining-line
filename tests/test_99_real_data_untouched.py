"""TC-SAFE — ยืนยันว่าชุดทดสอบไม่แตะข้อมูลจริง (รันเป็นไฟล์สุดท้าย)"""
import pytest

from conftest import DSN, REAL_SNAPSHOT_SQL, q

pytestmark = pytest.mark.db


def test_dsn_is_local():
    """TC-SAFE-001 ที่อยู่ฐานข้อมูลที่ใช้ทดสอบต้องเป็นเครื่องนี้เท่านั้น"""
    assert any(h in DSN for h in ("@127.0.0.1:", "@localhost:")), "ห้ามรันกับฐานข้อมูลที่ไม่ใช่ในเครื่อง"
    assert "supabase.co" not in DSN


def test_real_data_unchanged(db, actors, real_before):
    """TC-SAFE-002 จำนวนโปรเจค / Part / แถวปล่อย / ยอดปล่อย / QR / ใบ Release / พนักงาน ของข้อมูลจริง (ที่ไม่ใช่ PYT-) เท่าเดิม"""
    assert q(db, REAL_SNAPSHOT_SQL)[0] == real_before
