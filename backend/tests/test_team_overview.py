"""The numbers behind the admin's dashboard and people cards: counted over the caller's own tree only. Runs against the local development database."""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models import BatchImei, DeviceBatch, Pump, User
from test_web_portal_users import _h, _partner  # noqa: E402
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)

client = TestClient(app)


class TeamBase(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.pump_ids = []
        cls.batch_ids = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            if cls.batch_ids:
                cls.db.query(DeviceBatch).filter(DeviceBatch.id.in_(cls.batch_ids)).delete(synchronize_session=False)
            if cls.pump_ids:
                cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            super().tearDownClass()

    def pump(self, owner, status="STOPPED", seen=None, gsm=False):
        pid = f"TM{self.sfx}-{uuid.uuid4().hex[:8]}".upper()
        self.db.add(Pump(id=pid, name="Team test pump", owner_user_id=owner.id, hierarchy_path=owner.hierarchy_path,
                         lifecycle_state="ACTIVE", status=status, last_seen_at=seen))
        self.db.commit()
        type(self).pump_ids.append(pid)
        if gsm:
            batch = DeviceBatch(id=uuid.uuid4(), batch_code=f"TM-{uuid.uuid4().hex[:10]}", model="m", hw_rev="1", quantity=1, created_by=self.sa.id)
            self.db.add(batch)
            self.db.flush()
            type(self).batch_ids.append(batch.id)
            self.db.add(BatchImei(batch_id=batch.id, imei=f"86{uuid.uuid4().int % 10**13:013d}", mcu_uid=pid, pump_id=pid, claimed=True))
            self.db.commit()
        return pid

    def setUp(self):
        cls = type(self)
        if getattr(cls, "sa", None) is None:
            cls.sa = _partner(self, "superadmin", "team-root")
        sa = self.sa
        # admin > dist1 > dealerA > farmer1 (running GSM pump, stopped pump);  admin > dist2 > dealerB > farmer2 (offline pump)
        self.admin = _partner(self, "manufacturer", "team-admin", parent=sa)
        self.dist1 = _partner(self, "distributor", "team-d1", parent=self.admin)
        self.dist2 = _partner(self, "distributor", "team-d2", parent=self.admin)
        self.dealer_a = _partner(self, "dealer", "team-da", parent=self.dist1)
        self.dealer_b = _partner(self, "dealer", "team-db", parent=self.dist2)
        self.direct_dealer = _partner(self, "dealer", "team-dd", parent=self.admin)
        self.farmer1 = _partner(self, "customer", "team-f1", parent=self.dealer_a)
        self.farmer2 = _partner(self, "customer", "team-f2", parent=self.dealer_b)
        # added by QR and not opened yet: no password
        self.db.query(User).filter(User.id.in_([u.id for u in (self.dist1, self.dist2, self.dealer_a, self.dealer_b, self.direct_dealer)])).update(
            {"password_hash": None}, synchronize_session=False)
        self.db.commit()
        now = datetime.now(timezone.utc)
        self.run_gsm = self.pump(self.farmer1, "RUNNING", now - timedelta(seconds=5), gsm=True)
        self.stopped = self.pump(self.farmer1, "STOPPED", now - timedelta(seconds=5))
        self.offline = self.pump(self.farmer2, "RUNNING", now - timedelta(hours=3))
        self.never = self.pump(self.admin)          # in the admin's own stock, never reported

    def team(self, user):
        r = client.get("/api/v1/users/team", headers=_h(user))
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    @staticmethod
    def person(team, user):
        return next(p for p in team["people"] if p["id"] == str(user.id))


class TestAdminSummary(TeamBase):
    def test_the_summary_counts_everything_under_the_admin(self):
        s = self.team(self.admin)["summary"]
        self.assertEqual((s["distributors"], s["dealers"], s["farmers"]), (2, 3, 2))
        self.assertEqual(s["pumps"], {"total": 4, "running": 1, "stopped": 1, "fault": 0, "offline": 1, "no_data": 1})

    def test_the_gsm_counts_say_how_many_pumps_have_a_modem_and_how_many_are_reporting(self):
        s = self.team(self.admin)["summary"]
        self.assertEqual((s["gsm_pumps"], s["gsm_online"]), (1, 1))

    def test_the_summary_has_six_months_of_growth_and_who_has_not_opened_their_qr(self):
        s = self.team(self.admin)["summary"]
        self.assertEqual(len(s["monthly_pumps"]), 6)
        self.assertGreaterEqual(s["monthly_pumps"][-1]["pumps"], 4)
        self.assertEqual(s["waiting_to_sign_in"], 5)   # every distributor and dealer here has no password yet


class TestPeopleCards(TeamBase):
    def test_every_distributor_dealer_and_farmer_is_listed_once_and_the_admin_is_not(self):
        t = self.team(self.admin)
        by_role = {}
        for p in t["people"]:
            by_role.setdefault(p["role"], []).append(p["id"])
        self.assertEqual({k: len(v) for k, v in by_role.items()}, {"distributor": 2, "dealer": 3, "customer": 2})
        self.assertNotIn(str(self.admin.id), [p["id"] for p in t["people"]])

    def test_each_person_carries_the_numbers_for_what_is_under_them(self):
        t = self.team(self.admin)
        d1 = self.person(t, self.dist1)
        self.assertEqual((d1["dealers"], d1["farmers"], d1["pumps"]["total"], d1["pumps"]["running"]), (1, 1, 2, 1))
        self.assertEqual((d1["gsm_pumps"], d1["gsm_online"]), (1, 1))
        d2 = self.person(t, self.dist2)
        self.assertEqual((d2["dealers"], d2["farmers"], d2["pumps"]["total"], d2["pumps"]["offline"]), (1, 1, 1, 1))
        a = self.person(t, self.dealer_a)
        self.assertEqual((a["dealers"], a["farmers"], a["pumps"]["total"]), (0, 1, 2))
        f1 = self.person(t, self.farmer1)
        self.assertEqual((f1["pumps"]["total"], f1["farmers"]), (2, 0))
        self.assertEqual(self.person(t, self.direct_dealer)["pumps"]["total"], 0)

    def test_each_person_says_who_they_sit_under(self):
        t = self.team(self.admin)
        self.assertEqual([a["name"] for a in self.person(t, self.farmer1)["above"]], [self.dist1.full_name, self.dealer_a.full_name])
        self.assertEqual([a["name"] for a in self.person(t, self.dealer_a)["above"]], [self.dist1.full_name])
        self.assertEqual(self.person(t, self.direct_dealer)["above"], [])
        self.assertEqual(self.person(t, self.dist1)["above"], [])

    def test_a_partner_who_has_not_opened_their_qr_is_marked_and_a_farmer_is_not_asked(self):
        t = self.team(self.admin)
        self.assertIs(self.person(t, self.dist1)["has_signed_in"], False)
        self.assertIsNone(self.person(t, self.farmer1)["has_signed_in"])
        self.db.query(User).filter(User.id == self.dist1.id).update({"password_hash": "x"})
        self.db.commit()
        self.assertIs(self.person(self.team(self.admin), self.dist1)["has_signed_in"], True)


class TestEveryoneSeesOnlyTheirOwnTree(TeamBase):
    def test_a_distributor_sees_only_its_own_dealers_and_farmers(self):
        t = self.team(self.dist1)
        ids = {p["id"] for p in t["people"]}
        self.assertEqual(ids, {str(self.dealer_a.id), str(self.farmer1.id)})
        self.assertEqual(t["summary"]["pumps"]["total"], 2)
        self.assertEqual((t["summary"]["dealers"], t["summary"]["farmers"], t["summary"]["distributors"]), (1, 1, 0))
        self.assertEqual((t["summary"]["gsm_pumps"], t["summary"]["gsm_online"]), (1, 1), "a distributor sees its own pumps' modems")

    def test_a_dealer_sees_only_its_own_farmers(self):
        t = self.team(self.dealer_a)
        self.assertEqual({p["id"] for p in t["people"]}, {str(self.farmer1.id)})
        self.assertEqual(t["summary"]["pumps"]["total"], 2)

    def test_a_farmer_and_a_visitor_get_nothing(self):
        self.assertEqual(client.get("/api/v1/users/team", headers=_h(self.farmer1)).status_code, 403)
        self.assertEqual(client.get("/api/v1/users/team").status_code, 401)

    def test_the_other_branch_never_leaks_into_a_distributor(self):
        t = self.team(self.dist2)
        self.assertNotIn(str(self.farmer1.id), {p["id"] for p in t["people"]})
        self.assertEqual(t["summary"]["pumps"]["running"], 0)


if __name__ == "__main__":
    unittest.main()
