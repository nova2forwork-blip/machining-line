"""ชุดทดสอบอัตโนมัติของ Artclad Production (machining-line) — ดู tests/README.md

กติกาความปลอดภัย
- ทดสอบฐานข้อมูลเฉพาะ Supabase "ในเครื่อง" (127.0.0.1 / localhost) เท่านั้น — ที่อยู่อื่น = หยุดทั้งชุด
- ใช้ข้อมูลจำลองที่สร้างเอง: โปรเจค / พนักงาน รหัสขึ้นต้น PYT- แล้วลบทิ้งเมื่อจบ ไม่แตะข้อมูลของโปรเจคจริง
- ไม่มีรหัสผ่านในไฟล์: รหัสผ่านของบัญชีจำลองสุ่มใหม่ทุกครั้ง และไม่ได้ใช้ล็อกอิน (สร้าง session ตรง ๆ)
"""
import json
import os
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import pytest

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = Path(__file__).resolve().parent / "js_bridge.mjs"
DSN = os.environ.get("MLS_TEST_DSN", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
PREFIX = "PYT-"


# ───────────────────────── ตรรกะคำนวณของแอป (ผ่าน node) ─────────────────────────
def _run_steps(steps):
    node = shutil.which("node")
    if not node:
        pytest.skip("ไม่มี node ในเครื่อง — ข้ามการทดสอบตรรกะของแอป")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump({"steps": steps}, f, ensure_ascii=False)
        name = f.name
    try:
        r = subprocess.run([node, str(BRIDGE), name], capture_output=True, text=True, encoding="utf-8", timeout=60, cwd=str(ROOT))
    finally:
        os.unlink(name)
    if r.returncode != 0:
        raise RuntimeError("js_bridge ล้มเหลว: " + (r.stderr or r.stdout)[-800:])
    return json.loads(r.stdout)


class Js:
    """js("baseOf", "X A") → ค่า · js.steps([...]) → รายการค่า (หลายคำสั่งในโปรเซสเดียว)"""

    def __call__(self, fn, *args, m="core"):
        res = _run_steps([{"m": m, "fn": fn, "args": list(args)}])[0]
        if not res["ok"]:
            raise RuntimeError(res["error"])
        return res.get("value")

    def steps(self, steps):
        out = _run_steps(steps)
        bad = [x["error"] for x in out if not x["ok"]]
        if bad:
            raise RuntimeError("; ".join(bad))
        return [x.get("value") for x in out]

    def const(self, name, m="core"):
        return _run_steps([{"m": m, "fn": name, "get": True}])[0].get("value")


@pytest.fixture(scope="session")
def js():
    return Js()


def jmap(pairs):
    return {"$map": [list(p) for p in pairs]}


def jset(items):
    return {"$set": list(items)}


# ───────────────────────── ฐานข้อมูลในเครื่อง ─────────────────────────
def _local_only():
    host = (urlparse(DSN).hostname or "").lower()
    if host not in ("127.0.0.1", "localhost", "::1"):
        pytest.exit(f"หยุด: MLS_TEST_DSN ชี้ไปที่ {host!r} — ชุดทดสอบนี้รันได้เฉพาะฐานข้อมูลในเครื่อง (ห้ามใช้ฐานข้อมูลจริง)", returncode=3)


def connect():
    _local_only()
    try:
        import psycopg
    except ImportError:
        pytest.skip("ยังไม่ได้ติดตั้ง psycopg — ข้ามการทดสอบฐานข้อมูล")
    try:
        return psycopg.connect(DSN, autocommit=True, connect_timeout=5)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"ต่อฐานข้อมูลในเครื่องไม่ได้ (เปิด Docker + supabase start ก่อน): {str(e)[:120]}")


@pytest.fixture(scope="session")
def db():
    c = connect()
    yield c
    c.close()


def q(conn, sql, params=None):
    cur = conn.execute(sql, params or ())
    return cur.fetchall() if cur.description else []


def one(conn, sql, params=None):
    rows = q(conn, sql, params)
    return rows[0][0] if rows else None


def has_fn(conn, name):
    return bool(one(conn, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=%s", (name,)))


REAL_SNAPSHOT_SQL = f"""
select (select count(*) from projects where code not like '{PREFIX}%%'),
       (select count(*) from part_master m join projects p on p.id=m.project_id where p.code not like '{PREFIX}%%'),
       (select count(*) from releases r join part_master m on m.id=r.part_master_id join projects p on p.id=m.project_id where p.code not like '{PREFIX}%%'),
       (select coalesce(sum(r.qty),0) from releases r join part_master m on m.id=r.part_master_id join projects p on p.id=m.project_id where p.code not like '{PREFIX}%%'),
       (select count(*) from part_units u join part_master m on m.id=u.part_master_id join projects p on p.id=m.project_id where p.code not like '{PREFIX}%%'),
       (select count(*) from release_plans rp join projects p on p.id=rp.project_id where p.code not like '{PREFIX}%%'),
       (select count(*) from employees where code not like '{PREFIX}%%')
"""


@pytest.fixture(scope="session")
def real_before(db):
    """ภาพรวมข้อมูลจริง (ที่ไม่ใช่ PYT-) ก่อนเริ่ม — ใช้เทียบตอนจบว่าไม่ถูกแตะ"""
    return q(db, REAL_SNAPSHOT_SQL)[0]


class Actors:
    def __init__(self, conn):
        self.conn = conn
        self.tag = secrets.token_hex(3).upper()
        self.emp = {}
        self.tok = {}
        for role in ("admin", "office", "operator"):
            code = f"{PREFIX}{role[:3].upper()}-{self.tag}"
            eid = one(conn, "insert into employees(code,name,role,active,password_hash,multi_session) values(%s,%s,%s,true,extensions.crypt(%s,extensions.gen_salt('bf',6)),true) returning id",
                      (code, f"pytest {role}", role, secrets.token_urlsafe(12)))
            self.emp[role] = eid
            self.tok[role] = one(conn, "insert into sessions(employee_id, role) values(%s,%s) returning token", (eid, role))

    def new_session(self, role):
        return one(self.conn, "insert into sessions(employee_id, role) values(%s,%s) returning token", (self.emp[role], role))

    def cleanup(self):
        ids = list(self.emp.values())
        for sql in ("delete from release_plans where release_order like 'DRAFT:%%' and substring(release_order from 7) = any(%s::text[])",):
            try:
                self.conn.execute(sql, ([str(i) for i in ids],))
            except Exception:  # noqa: BLE001
                pass
        for sql in ("delete from sessions where employee_id = any(%s)", "delete from audit_log where actor_id = any(%s)", "delete from employees where id = any(%s)"):
            try:
                self.conn.execute(sql, (ids,))
            except Exception:  # noqa: BLE001
                pass


@pytest.fixture(scope="session")
def actors(db, real_before):
    a = Actors(db)
    yield a
    # เก็บกวาดโปรเจคจำลองที่ค้าง (เทสต์ที่ล้มกลางทาง) ก่อนลบบัญชี
    for (pid,) in q(db, f"select id from projects where code like '{PREFIX}%%'"):
        _drop_project(db, a.tok["admin"], pid)
    a.cleanup()


def _drop_project(conn, admin_token, pid):
    try:
        conn.execute("delete from materials where project_id=%s", (pid,))
    except Exception:  # noqa: BLE001
        pass
    try:
        conn.execute("select public.authz_delete_project(%s,%s)", (admin_token, pid))
    except Exception:  # noqa: BLE001
        pass
    try:
        conn.execute("delete from release_plans where project_id=%s", (pid,))
        conn.execute("delete from projects where id=%s", (pid,))
    except Exception:  # noqa: BLE001
        pass


@pytest.fixture()
def project(db, actors):
    """โปรเจคจำลอง 1 โปรเจคต่อเทสต์ (รหัส PYT-xxxxxx) — ลบทิ้งเมื่อเทสต์จบ"""
    code = f"{PREFIX}{secrets.token_hex(3).upper()}"
    pid = one(db, "insert into projects(code,name) values(%s,%s) returning id", (code, "pytest (ข้อมูลจำลอง)"))
    yield pid
    _drop_project(db, actors.tok["admin"], pid)


# ───────────────────────── ป้ายชนิดเทสต์ ─────────────────────────
def pytest_configure(config):
    for m in ("positive: กรณีปกติที่ต้องทำได้", "negative: กรณีที่ต้องถูกปฏิเสธ / ไม่เกิดผล", "boundary: ค่าขอบ", "regression: กันบั๊กที่เคยเจอกลับมา", "db: ต้องมีฐานข้อมูลในเครื่อง"):
        config.addinivalue_line("markers", m)
