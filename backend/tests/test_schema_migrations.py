"""The migrations are the only way a database is created or changed, so they are tested as a product of their own.

Each test builds a throwaway database, runs `alembic` against it as a subprocess (exactly what a deploy does) and
inspects the result. Needs a role that may CREATE DATABASE: CI has one; locally set
SCHEMA_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres (or the tests are skipped).
"""
import os
import subprocess
import sys
import unittest
import uuid

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import psycopg
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

import schema_diff

FIXTURE = os.path.join(BACKEND, "tests", "fixtures", "legacy_schema_original.sql")
CREATE_ALL_FIXTURE = os.path.join(BACKEND, "tests", "fixtures", "create_all_2026_09_05.sql")
LAST_BEFORE_RECONCILE = "d4f6b8a0c2e4"


def _admin_url() -> str:
    explicit = os.environ.get("SCHEMA_TEST_ADMIN_URL")
    if explicit:
        return explicit
    from app.config import settings
    return make_url(settings.get_database_url()).set(database="postgres").render_as_string(hide_password=False)


def _sa(url: str) -> str:
    """postgresql://... -> postgresql+psycopg://... (the driver this project uses)."""
    return url if "+psycopg" in url else url.replace("postgresql://", "postgresql+psycopg://", 1)


def _plain(url: str) -> str:
    """postgresql+psycopg://... -> postgresql://... (what alembic's env and psycopg both accept)."""
    return url.replace("postgresql+psycopg://", "postgresql://")


class Scratch(unittest.TestCase):
    admin = None

    @classmethod
    def setUpClass(cls):
        try:
            cls.admin = create_engine(_sa(_admin_url()), isolation_level="AUTOCOMMIT")
            with cls.admin.connect() as c:
                if not c.execute(text("select rolcreatedb or rolsuper from pg_roles where rolname = current_user")).scalar():
                    raise unittest.SkipTest("the database role may not CREATE DATABASE (set SCHEMA_TEST_ADMIN_URL)")
        except unittest.SkipTest:
            raise
        except Exception as exc:
            raise unittest.SkipTest(f"no admin connection for scratch databases: {exc}")
        cls.created = []

    @classmethod
    def tearDownClass(cls):
        if cls.admin is None:
            return
        with cls.admin.connect() as c:
            for name in cls.created:
                c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        cls.admin.dispose()

    def new_db(self) -> str:
        name = f"mig_{uuid.uuid4().hex[:10]}"
        with self.admin.connect() as c:
            c.execute(text(f'CREATE DATABASE "{name}"'))
        type(self).created.append(name)
        return make_url(_admin_url()).set(database=name).render_as_string(hide_password=False)

    def alembic(self, url: str, *args, expect_ok=True):
        env = {**os.environ, "DATABASE_URL": _plain(url), "PYTHONIOENCODING": "utf-8", "ENV": "development"}
        r = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True,
                           text=True, encoding="utf-8", timeout=300)
        if expect_ok:
            self.assertEqual(r.returncode, 0, f"alembic {' '.join(args)} failed:\n{r.stderr[-1500:]}")
        return r

    def q(self, url: str, sql: str):
        eng = create_engine(_sa(url))
        try:
            with eng.begin() as c:
                c.execute(text("select set_config('app.bypass_rls', 'on', true)"))
                result = c.execute(text(sql))
                return [tuple(r) for r in result] if result.returns_rows else []
        finally:
            eng.dispose()


USER_COLS = ("id, full_name, phone_number, role, hierarchy_path, dealer_depth, session_version, locale, totp_enabled, "
             "account_status, is_active, is_verified, created_at, updated_at")


def user_row(uid, name, phone, role="customer", path="/a"):
    """Every NOT NULL column filled in: before the last migration the database supplies no defaults of its own."""
    ph = f"'{phone}'" if phone else "null"
    return f"('{uid}', '{name}', {ph}, '{role}', '{path}', 0, 1, 'en', false, 'ACTIVE', true, false, now(), now())"


class TestEmptyDatabase(Scratch):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.url = None

    def build(self):
        if type(self).url is None:
            type(self).url = self.new_db()
            self.alembic(self.url, "upgrade", "head")
        return self.url

    def test_migrates_from_nothing_to_a_single_head(self):
        url = self.build()
        heads = self.alembic(url, "heads").stdout.split()
        self.assertEqual(len([h for h in heads if h and h != "(head)"]), 1, f"more than one head: {heads}")
        self.assertIn("(head)", self.alembic(url, "current").stdout)

    def test_the_rules_the_application_relies_on_are_really_there(self):
        url = self.build()
        # fault-code reference data (SRS 6.2 + VFD fault codes 100-106)
        self.assertEqual(self.q(url, "select count(*) from agripump.fault_code_catalog")[0][0], 18)
        # one account per phone number, and a role has to be one of the five
        # (the database now supplies defaults itself: a bare insert with only the essentials works)
        self.q(url, "insert into agripump.users (full_name, role, hierarchy_path, phone_number) values "
                    "('a', 'customer', '/x', '+919000000001')")
        for bad in ("insert into agripump.users (full_name, role, hierarchy_path, phone_number) values ('b', 'customer', '/y', '+919000000001')",
                    "insert into agripump.users (full_name, role, hierarchy_path) values ('c', 'emperor', '/z')"):
            with self.assertRaises(Exception):
                self.q(url, bad)
        # alerts are de-duplicated by the database, not just by the code
        idx = self.q(url, "select indexdef from pg_indexes where schemaname='agripump' and indexname='idx_alerts_dedup'")
        self.assertTrue(idx and "UNIQUE" in idx[0][0])
        # invented defaults are gone
        defaults = dict(self.q(url, """select table_name || '.' || column_name, column_default from information_schema.columns
                                        where table_schema='agripump' and (table_name, column_name) in
                                        (('pumps','hp_rating'), ('telemetry_history','gsm_rssi'), ('fault_code_catalog','code'))"""))
        self.assertTrue(all(v is None for v in defaults.values()), defaults)

    def test_the_models_and_the_migrations_agree(self):
        url = self.build()
        env = {**os.environ, "DATABASE_URL": _plain(url), "PYTHONIOENCODING": "utf-8", "ENV": "development"}
        r = subprocess.run([sys.executable, os.path.join("scripts", "check_model_drift.py")], cwd=BACKEND, env=env,
                           capture_output=True, text=True, encoding="utf-8", timeout=200)
        self.assertEqual(r.returncode, 0, r.stdout[-1500:])

    def test_running_the_last_migration_again_changes_nothing(self):
        url = self.build()
        before = schema_diff.snapshot(_sa(url))
        self.alembic(url, "downgrade", LAST_BEFORE_RECONCILE)
        self.alembic(url, "upgrade", "head")
        self.assertEqual(schema_diff.compare(before, schema_diff.snapshot(_sa(url)), "before", "after"), [])


class TestExistingDatabases(Scratch):
    def test_a_database_built_from_the_original_schema_sql_is_brought_up_to_date(self):
        clean = self.new_db()
        self.alembic(clean, "upgrade", "head")

        legacy = self.new_db()
        with psycopg.connect(_plain(legacy), autocommit=True) as conn:
            conn.execute(open(FIXTURE, encoding="utf-8").read())
        # No version table, exactly as such a database is found in the field: upgrade from nothing.
        self.alembic(legacy, "upgrade", "head")

        diffs = schema_diff.compare(schema_diff.snapshot(_sa(clean)), schema_diff.snapshot(_sa(legacy)), "clean", "adopted")
        # Left on purpose: two unused legacy columns (and their key) on branding, and extensions the old file installed.
        allowed = ("[column] branding.id only in adopted", "[column] branding.updated_by only in adopted",
                   "[constraint] branding only in adopted", "[extension]")
        unexpected = [d for d in diffs if not d.startswith(allowed)]
        self.assertEqual(unexpected, [], "the adopted database differs from a clean build")

    def test_a_database_built_by_the_first_create_all_is_brought_up_to_date_with_its_data(self):
        """How the first server database was most likely made (init_db.py on 2026-09-05), with the kind of rows it holds."""
        clean = self.new_db()
        self.alembic(clean, "upgrade", "head")

        old = self.new_db()
        with psycopg.connect(_plain(old), autocommit=True) as conn:
            conn.execute(open(CREATE_ALL_FIXTURE, encoding="utf-8").read())
        self.q(old, """
            insert into agripump.users (id, full_name, email, phone, password_hash, role, hierarchy_path, is_active, is_verified,
                                        totp_enabled, created_at, updated_at) values
              ('aaaaaaaa-0000-0000-0000-000000000001', 'Owner', 'o@example.com', '9741000001', 'x', 'superadmin', '/SA', true, true, false, now(), now()),
              ('aaaaaaaa-0000-0000-0000-000000000002', 'Farmer', null, '9741000002', 'x', 'customer', '/SA', true, false, false, now(), now())""")
        self.q(old, """
            insert into agripump.pumps (id, name, supply_type, owner_user_id, hierarchy_path, latitude, longitude, status,
                                        lifecycle_state, created_at, last_seen_at) values
              ('OLD-1', 'Reported', '3-phase', 'aaaaaaaa-0000-0000-0000-000000000002', '/SA', 18.52, 73.86, 'RUNNING', 'ACTIVE', now(), now()),
              ('OLD-2', 'Never reported, default position', '3-phase', 'aaaaaaaa-0000-0000-0000-000000000002', '/SA', 19.9975, 73.7898, 'STOPPED', 'ACTIVE', now(), now()),
              ('OLD-3', 'Never reported, zero position', '3-phase', 'aaaaaaaa-0000-0000-0000-000000000002', '/SA', 0, 0, 'STOPPED', 'ACTIVE', now(), now())""")
        self.q(old, "insert into agripump.telemetry_history (pump_id, v_ry, pump_on, seq, recorded_at) values ('OLD-1', 415.5, true, 1, now())")
        self.q(old, """
            insert into agripump.commands (cid, pump_id, action, status, issued_at, expires_at) values
              ('cccccccc-0000-0000-0000-000000000001', 'OLD-1', 'START', 'PENDING', now() - interval '2 days', now() - interval '2 days'),
              ('cccccccc-0000-0000-0000-000000000002', 'OLD-1', 'STOP', 'ACKED', now() - interval '1 day', now() - interval '1 day'),
              ('cccccccc-0000-0000-0000-000000000003', 'OLD-1', 'START', 'REJECTED', now() - interval '1 day', now() - interval '1 day')""")
        self.q(old, "insert into agripump.fault_logs (pump_id, fault_description, occurred_at) values ('OLD-1', 'DryRun', now())")

        self.alembic(old, "upgrade", "head")     # no version table: exactly as found

        # the data survived and was corrected where it was wrong
        self.assertEqual(self.q(old, "select count(*) from agripump.users")[0][0], 2)
        self.assertEqual(self.q(old, "select phone, phone_number from agripump.users order by phone"),
                         [("9741000001", "9741000001"), ("9741000002", "9741000002")])
        pumps = {r[0]: r[1:] for r in self.q(old, "select id, latitude, longitude, last_seen_at is null from agripump.pumps")}
        self.assertEqual(float(pumps["OLD-1"][0]), 18.52)                    # a real position stays
        self.assertEqual(pumps["OLD-1"][2], False)                          # it did report: last_seen stays
        self.assertEqual((pumps["OLD-2"][0], pumps["OLD-2"][2]), (None, True))   # the invented default position is gone
        self.assertEqual((pumps["OLD-3"][0], pumps["OLD-3"][2]), (None, True))   # so is (0, 0), and "seen" at creation
        self.assertEqual(dict(self.q(old, "select cid::text, status from agripump.commands")), {
            "cccccccc-0000-0000-0000-000000000001": "EXPIRED",              # was waiting forever
            "cccccccc-0000-0000-0000-000000000002": "ACKNOWLEDGED",
            "cccccccc-0000-0000-0000-000000000003": "REJECTED"})
        self.assertEqual(self.q(old, "select count(*) from agripump.fault_code_catalog")[0][0], 18)
        self.assertEqual(self.q(old, "select description from agripump.fault_logs")[0][0], "Fault")

        diffs = schema_diff.compare(schema_diff.snapshot(_sa(clean)), schema_diff.snapshot(_sa(old)), "clean", "adopted")
        # Left on purpose: the old columns are wider than the models say (never narrowed on a live time-series table),
        # and the first code also made phone / email uniquely indexed on their own.
        allowed = ("[column] telemetry_history.", "[column] users.email", "[index] users only in adopted",
                   "[constraint] users only in adopted", "[extension]",
                   # the same rule, enforced there as a unique index rather than a named constraint
                   "[constraint] users only in clean: UNIQUE (phone)")
        unexpected = [d for d in diffs if not d.startswith(allowed)]
        self.assertEqual(unexpected, [], "the adopted database differs from a clean build")

    def test_copying_a_phone_number_between_the_two_columns_never_creates_a_duplicate(self):
        """Found on a real messy database: an account's `phone` equal to another account's `phone_number`."""
        url = self.new_db()
        self.alembic(url, "upgrade", LAST_BEFORE_RECONCILE)
        self.q(url, "alter table agripump.users add column if not exists phone varchar(20)")
        rows = [
            ("11111111-0000-0000-0000-000000000001", "owns X as phone_number", "'+919000000010'", "null"),
            ("11111111-0000-0000-0000-000000000002", "has X only as phone", "null", "'+919000000010'"),
            ("11111111-0000-0000-0000-000000000003", "shares Z with the next, phone only", "null", "'+919000000020'"),
            ("11111111-0000-0000-0000-000000000004", "shares Z", "null", "'+919000000020'"),
        ]
        for uid, name, phone_number, phone in rows:
            self.q(url, f"insert into agripump.users ({USER_COLS}, phone) values "
                        f"('{uid}', '{name}', {phone_number}, 'customer', '/p', 0, 1, 'en', false, 'ACTIVE', true, false, now(), now(), {phone})")
        self.alembic(url, "upgrade", "head")          # must not fail
        numbers = self.q(url, "select phone_number from agripump.users where phone_number is not null")
        self.assertEqual(len(numbers), len(set(numbers)), "no number is held by two accounts")
        # the account that owned +919000000010 as phone_number was not disturbed
        self.assertEqual(self.q(url, "select phone_number from agripump.users where id = '11111111-0000-0000-0000-000000000001'"),
                         [("+919000000010",)])

    def test_data_that_breaks_a_new_rule_is_reported_and_does_not_stop_the_upgrade(self):
        url = self.new_db()
        self.alembic(url, "upgrade", LAST_BEFORE_RECONCILE)
        # What a live database can contain: two accounts on one phone number, a pump in a state nothing defines.
        self.q(url, f"""
            insert into agripump.users ({USER_COLS}) values
              {user_row('11111111-1111-1111-1111-111111111111', 'one', '+919111111111', path='/a')},
              {user_row('22222222-2222-2222-2222-222222222222', 'two', '+919111111111', path='/b')}""")
        self.q(url, """
            insert into agripump.pumps (id, name, supply_type, owner_user_id, hierarchy_path, status, lifecycle_state)
            values ('DIRTY-1', 'p', '3-phase', '11111111-1111-1111-1111-111111111111', '/a', 'STOPPED', 'BOGUS_STATE')""")

        result = self.alembic(url, "upgrade", "head")
        self.assertIn("schema:", result.stderr, "problems are reported, not swallowed")

        # not made unique (it cannot be), but the check that new rows are held to exists, marked as not yet validated
        self.assertEqual(self.q(url, "select count(*) from pg_constraint where conname = 'users_phone_number_key'")[0][0], 0)
        valid = self.q(url, "select convalidated from pg_constraint where conname = 'pumps_lifecycle_state_check'")
        self.assertEqual(valid, [(False,)])
        with self.assertRaises(Exception):
            self.q(url, """insert into agripump.pumps (id, name, supply_type, owner_user_id, hierarchy_path, status, lifecycle_state)
                           values ('DIRTY-2', 'p', '3-phase', '11111111-1111-1111-1111-111111111111', '/a', 'STOPPED', 'ALSO_BOGUS')""")
        # ...and the drift report tells the operator what is left to fix
        self.assertIn("head", self.alembic(url, "current").stdout)


if __name__ == "__main__":
    unittest.main()
