"""A partner sees its own sub-tree and nothing else: /SA/D1 must never cover /SA/D10.

Checked twice on purpose: through the API, and against the database policy itself with no application filter
in the way (row-level security is the second lock, and it had the same bug as the first).
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pyotp
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.deps import set_db_actor_context
from app.core.scope import in_subtree, path_in_scope
from app.database import SessionLocal
from app.main import app
from app.models import Command, Organisation, Pump, User
from app.services.jwt_auth import hash_secret, sign_token

client = TestClient(app)
NOW = datetime.now(timezone.utc)


def bearer(user):
    return {"Authorization": "Bearer " + sign_token(
        {"sub": str(user.id), "role": user.role, "hierarchy_path": user.hierarchy_path, "session_ver": 1})}


class ScopeBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]
        cls.user_ids, cls.pump_ids, cls.org_ids = [], [], []
        # Two dealers whose paths share a prefix, and one whose path contains a LIKE wildcard.
        cls.d1 = cls.make_user("dealer", "D1", f"/SA/T{cls.sfx}D1")
        cls.d10 = cls.make_user("dealer", "D10", f"/SA/T{cls.sfx}D10")
        cls.under = cls.make_user("dealer", "U", f"/SA/T{cls.sfx}X_B")
        cls.wild = cls.make_user("dealer", "W", f"/SA/T{cls.sfx}XaB")
        cls.owner = cls.make_user("customer", "owner", f"/SA/T{cls.sfx}D1/owner")
        cls.p1 = cls.make_pump("p1", f"/SA/T{cls.sfx}D1/p1")
        cls.p1_deep = cls.make_pump("p1deep", f"/SA/T{cls.sfx}D1/sub/deeper/p")
        cls.p1_own = cls.make_pump("p1own", f"/SA/T{cls.sfx}D1")            # exactly the dealer's own node
        cls.p10 = cls.make_pump("p10", f"/SA/T{cls.sfx}D10/p10")
        cls.p_under = cls.make_pump("pu", f"/SA/T{cls.sfx}X_B/pu")
        cls.p_wild = cls.make_pump("pw", f"/SA/T{cls.sfx}XaB/pw")
        cls.p_sibling_prefix = cls.make_pump("psib", f"/SA/T{cls.sfx}D1x/psib")

    @classmethod
    def make_user(cls, role, tag, path):
        u = User(id=uuid.uuid4(), full_name=f"Scope {tag} {cls.sfx}", phone_number=f"+9155{abs(hash((tag, cls.sfx))) % 10**8:08d}",
                 phone=None, role=role, hierarchy_path=path, account_status="ACTIVE", session_version=1,
                 password_hash=hash_secret("Scope-Test-9x"), totp_secret=pyotp.random_base32(), totp_enabled=True)
        cls.db.add(u)
        cls.db.commit()
        cls.user_ids.append(u.id)
        return u

    @classmethod
    def make_pump(cls, tag, path, **kw):
        pid = f"PUMP-SC-{tag}-{cls.sfx}"
        p = Pump(id=pid, name=f"Scope {tag}", supply_type="3-phase", hp_rating=5, owner_user_id=cls.owner.id,
                 hierarchy_path=path, status="RUNNING", lifecycle_state="ACTIVE", last_seen_at=NOW, **kw)
        cls.db.add(p)
        cls.db.commit()
        cls.pump_ids.append(pid)
        return p

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(Command).filter(Command.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Organisation).filter(Organisation.id.in_(cls.org_ids)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id.in_(cls.user_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    def ids_seen_by(self, user, url="/api/v1/pumps"):
        r = client.get(url, headers=bearer(user))
        self.assertEqual(r.status_code, 200, r.text)
        return {p["id"] for p in r.json()["pumps"]} & set(self.pump_ids)


class TestHelpers(unittest.TestCase):
    def test_python_helper_has_a_boundary(self):
        self.assertTrue(path_in_scope("/SA/D1", "/SA/D1"))
        self.assertTrue(path_in_scope("/SA/D1", "/SA/D1/x/y"))
        self.assertTrue(path_in_scope("/SA/D1/", "/SA/D1/x"))
        for other in ("/SA/D10", "/SA/D1x/p", "/SA/D", "", None):
            self.assertFalse(path_in_scope("/SA/D1", other), other)
        self.assertFalse(path_in_scope("", "/SA/D1"), "an empty scope covers nothing")
        self.assertFalse(path_in_scope(None, "/SA/D1"))

    def test_sql_helper_compiles_to_an_exact_or_slash_prefix_match(self):
        sql = str(in_subtree(Pump.hierarchy_path, "/SA/D1").compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("hierarchy_path = '/SA/D1'", sql)
        self.assertIn("LIKE", sql)
        self.assertIn("ESCAPE", sql, "wildcards inside the path are escaped")
        self.assertEqual(str(in_subtree(Pump.hierarchy_path, "")), "false")


class TestThroughTheApi(ScopeBase):
    def test_a_dealer_sees_its_own_tree_and_not_a_neighbour_with_a_longer_name(self):
        seen = self.ids_seen_by(self.d1)
        self.assertEqual(seen, {self.p1.id, self.p1_deep.id, self.p1_own.id})
        self.assertNotIn(self.p10.id, seen)
        self.assertNotIn(self.p_sibling_prefix.id, seen)

    def test_and_the_neighbour_sees_only_theirs(self):
        self.assertEqual(self.ids_seen_by(self.d10), {self.p10.id})

    def test_a_wildcard_character_in_a_path_is_just_a_character(self):
        self.assertEqual(self.ids_seen_by(self.under), {self.p_under.id})
        self.assertEqual(self.ids_seen_by(self.wild), {self.p_wild.id})

    def test_a_neighbours_pump_cannot_be_read_or_commanded(self):
        h = bearer(self.d1)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.p10.id}", headers=h).status_code, 404)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.p10.id}/faults", headers=h).status_code, 404)
        self.assertEqual(client.post(f"/api/v1/pumps/{self.p10.id}/commands", json={"command": "STOP"}, headers=h).status_code, 404)
        self.assertEqual(client.put(f"/api/v1/pumps/{self.p10.id}/timer", json={"on_duration_minutes": 5}, headers=h).status_code, 404)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.p1.id}", headers=h).status_code, 200)

    def test_dashboards_and_reports_count_only_the_callers_tree(self):
        d = client.get("/api/v1/fleet/dashboard", headers=bearer(self.d1)).json()
        self.assertEqual(d["summary"]["total"], 3)
        stats = client.get("/api/v1/pumps", headers=bearer(self.d1)).json()["meta"]["stats"]
        self.assertEqual(stats["total"], 3)
        rows = client.get("/api/v1/service-reports?days=30", headers=bearer(self.d1)).json()
        self.assertTrue({r["pump_id"] for r in rows} <= {self.p1.id, self.p1_deep.id, self.p1_own.id} if rows and "pump_id" in rows[0] else True)

    def test_users_are_scoped_the_same_way(self):
        ids = {u["id"] for u in client.get("/api/v1/users", headers=bearer(self.d1)).json()}
        self.assertIn(str(self.owner.id), ids)
        self.assertNotIn(str(self.d10.id), ids)


class TestInTheDatabase(ScopeBase):
    """No repository, no route: what the row-level policy alone lets each actor read."""

    def visible_to(self, *, user=None, settings=None):
        db = SessionLocal()
        try:
            if user is not None:
                set_db_actor_context(db, user=db.query(User).filter(User.id == user.id).one())
            for name, value in (settings or {}).items():
                db.execute(text("SELECT set_config(:n, :v, false)"), {"n": name, "v": value})
            return {p.id for p in db.query(Pump).filter(Pump.id.in_(self.pump_ids)).all()}
        finally:
            db.rollback()
            db.execute(text("RESET ALL"))
            db.commit()
            db.close()

    def test_policy_has_the_boundary(self):
        self.assertEqual(self.visible_to(user=self.d1), {self.p1.id, self.p1_deep.id, self.p1_own.id})
        self.assertEqual(self.visible_to(user=self.d10), {self.p10.id})

    def test_underscore_in_a_path_is_not_a_wildcard(self):
        self.assertEqual(self.visible_to(user=self.under), {self.p_under.id})

    def test_a_blank_path_or_org_setting_sees_nothing(self):
        # What a pooled connection holds after RESET ALL: '' rather than NULL.
        base = {"app.user_role": "dealer", "app.user_id": str(uuid.uuid4())}
        self.assertEqual(self.visible_to(settings={**base, "app.hierarchy_path": "", "app.org_path": ""}), set())
        self.assertEqual(self.visible_to(settings={**base, "app.hierarchy_path": "/", "app.org_path": ""}), set())

    def test_a_blank_org_path_does_not_match_every_organisation(self):
        org = Organisation(id=uuid.uuid4(), type="dealer", name=f"scope org {self.sfx}", path=f"t{self.sfx}", depth=0)
        self.db.add(org)
        self.db.commit()
        type(self).org_ids.append(org.id)
        self.db.query(Pump).filter(Pump.id == self.p10.id).update({Pump.org_id: org.id})
        self.db.commit()
        try:
            seen = self.visible_to(settings={"app.user_role": "dealer", "app.user_id": str(uuid.uuid4()),
                                             "app.hierarchy_path": f"/SA/T{self.sfx}D1", "app.org_path": ""})
            self.assertEqual(seen, {self.p1.id, self.p1_deep.id, self.p1_own.id}, "an empty org path is not 'every organisation'")
        finally:
            self.db.query(Pump).filter(Pump.id == self.p10.id).update({Pump.org_id: None})
            self.db.commit()


if __name__ == "__main__":
    unittest.main()
