"""
Phase 3 dashboard: integration tests against the real database.

The existing test_phase3_dashboard.py mocks the database, so it can prove role checks but not one SQL statement or any
tenant isolation. These build the organisation tree from the spec and check exact numbers, plus the awkward cases:

    root
     |- Manufacturer A - Distributor A - Dealer A - Dealer A2 - Dealer A3        (a Support Engineer sits at Dist. A)
     '- Manufacturer B - Distributor B - Dealer B
    + two legacy partners with no organisation, scoped only by hierarchy_path (`/SA/LEG_x`, and the bare `/SA` root),
    + neighbour paths built to fool a wildcard/prefix match (`/SA/LEGX...`, `/SA/LEG_x0`).

Everything created here is removed again. The dashboard cache is switched off except in the one test about it.
"""
import asyncio
import os
import sys
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.dashboard_time import day_start_utc, local_today, today_start_utc
from app.core.roles import OrgStatus
from app.database import SessionLocal
from app.main import app
from app.models import Alert, FaultLog, Organisation, Pump, User
from app.services import dashboard_service
from app.services.cache_service import cache_service
from app.services.jwt_auth import hash_secret, sign_token

client = TestClient(app)
NOW = datetime.now(timezone.utc)
STATES = ("MANUFACTURED", "ALLOCATED", "IN_STOCK", "COMMISSIONED", "ACTIVE", "SUSPENDED", "RMA", "RETIRED")


def auth_header(user: User) -> dict:
    token = sign_token({
        "sub": str(user.id), "role": user.role, "org_id": str(user.org_id) if user.org_id else None,
        "hierarchy_path": user.hierarchy_path, "session_ver": user.session_version or 1,
    })
    return {"Authorization": f"Bearer {token}"}


class _Fixture(unittest.TestCase):
    """The organisation tree, users, pumps, faults and alerts described above. Holds no tests of its own."""

    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]
        cls.org_ids, cls.user_ids, cls.pump_ids, cls.bucket = [], [], [], 0

        root = cls.db.query(Organisation).filter(Organisation.parent_id.is_(None)).first()
        if root is None:
            root = Organisation(id=uuid.uuid4(), parent_id=None, type="SUPERADMIN", name="Root", path="root",
                                depth=0, status=OrgStatus.ACTIVE.value)
            cls.db.add(root)
            cls.db.commit()
            cls.org_ids.append(root.id)
        cls.root = root

        o = cls._org
        cls.mfgA = o("MANUFACTURER", "MfgA", root)
        cls.distA = o("DISTRIBUTOR", "DistA", cls.mfgA)
        cls.dealerA = o("DEALER", "DealerA", cls.distA)
        cls.dealerA2 = o("DEALER", "DealerA2", cls.dealerA)
        cls.dealerA3 = o("DEALER", "DealerA3", cls.dealerA2)
        cls.mfgB = o("MANUFACTURER", "MfgB", root)
        cls.distB = o("DISTRIBUTOR", "DistB", cls.mfgB)
        cls.dealerB = o("DEALER", "DealerB", cls.distB)

        u, s = cls._user, cls.sfx
        cls.sa = u("superadmin", "sa", root.id, "/SA")
        cls.u_mfgA = u("manufacturer", "mfgA", cls.mfgA.id, f"/SA/MA{s}")
        cls.u_distA = u("distributor", "distA", cls.distA.id, f"/SA/MA{s}/DA")
        cls.u_dealerA = u("dealer", "dealerA", cls.dealerA.id, f"/SA/MA{s}/DA/DLA")
        cls.u_dealerA3 = u("dealer", "dealerA3", cls.dealerA3.id, f"/SA/MA{s}/DA/DLA/DLA2/DLA3")
        cls.u_support = u("support", "support", cls.distA.id, f"/SA/MA{s}/DA/SUP")
        cls.u_mfgB = u("manufacturer", "mfgB", cls.mfgB.id, f"/SA/MB{s}")
        cls.u_distB = u("distributor", "distB", cls.distB.id, f"/SA/MB{s}/DB")
        cls.u_dealerB = u("dealer", "dealerB", cls.dealerB.id, f"/SA/MB{s}/DB/DLB")
        cls.farmer = u("customer", "farmer", cls.dealerA.id, f"/SA/MA{s}/DA/DLA/F")
        # Legacy partners: no organisation at all, scoped only by their hierarchy path.
        cls.u_legacy = u("dealer", "legacy", None, f"/SA/LEG_{s}")
        cls.u_rootpath = u("dealer", "rootpath", None, "/SA")

        ago = lambda **k: NOW - timedelta(**k)  # noqa: E731
        p = cls._pump
        # Manufacturer A's own device, Distributor A's, and Dealer A's chain.
        p("mA1", cls.mfgA, cls.u_mfgA, f"/SA/MA{s}/P", "ACTIVE", ago(minutes=1), "1.0.4")
        p("dA1", cls.distA, cls.u_distA, f"/SA/MA{s}/DA/P1", "COMMISSIONED", ago(hours=2), "1.0.3")
        p("dA2", cls.distA, cls.u_distA, f"/SA/MA{s}/DA/P2", "IN_STOCK", None, None)
        p("dlA1", cls.dealerA, cls.u_dealerA, f"/SA/MA{s}/DA/DLA/P1", "ACTIVE", ago(minutes=2), "1.0.4")
        p("dlA2", cls.dealerA, cls.u_dealerA, f"/SA/MA{s}/DA/DLA/P2", "ACTIVE", ago(hours=3), "1.0.3",
          warranty=(date.today() - timedelta(days=355), 12))          # ends in ~10 days
        p("a2_1", cls.dealerA2, cls.u_dealerA, f"/SA/MA{s}/DA/DLA/DLA2/P1", "ACTIVE", ago(minutes=3), "1.0.4",
          latlng=(18.5204, 73.8567), subscription=NOW + timedelta(days=5))
        p("a3_1", cls.dealerA3, cls.u_dealerA3, f"/SA/MA{s}/DA/DLA/DLA2/DLA3/P1", "RMA", None, None)
        # Tree B.
        p("mB1", cls.mfgB, cls.u_mfgB, f"/SA/MB{s}/P", "ACTIVE", ago(minutes=1), "2.0.0")
        p("dB1", cls.distB, cls.u_distB, f"/SA/MB{s}/DB/P", "ACTIVE", ago(hours=5), "2.0.0")
        p("dlB1", cls.dealerB, cls.u_dealerB, f"/SA/MB{s}/DB/DLB/P", "ACTIVE", ago(minutes=1), "2.0.0",
          latlng=(12.9716, 77.5946))
        # Legacy pumps (no org_id) and two neighbours that a sloppy prefix/wildcard match would wrongly include.
        p("leg1", None, cls.u_legacy, f"/SA/LEG_{s}/F1", "ACTIVE", ago(minutes=1), "1.0.4")
        p("nb_x", None, cls.u_legacy, f"/SA/LEGX{s}/F1", "ACTIVE", ago(minutes=1), "9.9.9")   # `_` must not be a wildcard
        p("nb_10", None, cls.u_legacy, f"/SA/LEG_{s}0/F1", "ACTIVE", ago(minutes=1), "9.9.9")  # no path boundary

        cls.today0 = today_start_utc()
        f = cls._fault
        f("dlA1", cls.today0 + timedelta(seconds=1), 1)
        f("dlA1", cls.today0 + timedelta(seconds=2), 1)
        f("dlA1", cls.today0 + timedelta(seconds=3), 2)
        f("dlA1", NOW - timedelta(days=40), 1)                 # outside the 30 day window
        f("dlA1", NOW - timedelta(days=41), 1)
        f("dA1", NOW - timedelta(days=5), 3)                   # in the window, not today
        f("dlA1", cls.today0 - timedelta(seconds=1), 1)        # 23:59:59 the previous day, dashboard timezone
        for _ in range(5):
            f("mB1", cls.today0 + timedelta(seconds=5), 1)
        for _ in range(2):
            f("dlB1", cls.today0 + timedelta(seconds=5), 2)
        f("leg1", cls.today0 + timedelta(seconds=5), 1)
        f("nb_x", cls.today0 + timedelta(seconds=5), 1)
        f("nb_10", cls.today0 + timedelta(seconds=5), 1)

        a = cls._alert
        a("dlA1", "FAULT", 1, open_=True)
        a("dlA2", "FAULT", 2, open_=True)
        a("dA1", "OFFLINE", None, open_=True)                  # an outage, not a fault
        a("mA1", "FAULT", 1, open_=False)                      # resolved
        a("mB1", "FAULT", 1, open_=True)
        a("dlB1", "FAULT", 2, open_=True)
        cls.db.commit()

    # ------------------------------------------------------------------ builders
    @classmethod
    def _org(cls, o_type, name, parent):
        oid = uuid.uuid4()
        org = Organisation(id=oid, parent_id=parent.id, type=o_type, name=f"{name} {cls.sfx}",
                           path=f"{parent.path}.{str(oid).replace('-', '_')}", depth=parent.depth + 1,
                           status=OrgStatus.ACTIVE.value)
        cls.db.add(org)
        cls.db.commit()
        cls.org_ids.append(oid)
        return org

    @classmethod
    def _user(cls, role, tag, org_id, h_path):
        uid = uuid.uuid4()
        phone = f"+9197{abs(hash((tag, cls.sfx))) % 10**8:08d}"
        user = User(id=uid, full_name=f"P3 {tag}", phone=phone, phone_number=phone, role=role, org_id=org_id,
                    hierarchy_path=h_path, account_status="ACTIVE", session_version=1,
                    password_hash=hash_secret("SecPass!123"), is_active=True, is_verified=True)
        cls.db.add(user)
        cls.db.commit()
        cls.user_ids.append(uid)
        return user

    @classmethod
    def _pump(cls, tag, org, owner, h_path, state, seen, fw, latlng=None, warranty=None, subscription=None):
        pid = f"P3-{tag}-{cls.sfx}"
        pump = Pump(id=pid, name=f"Pump {tag}", supply_type="3-phase", hp_rating=5, owner_user_id=owner.id,
                    hierarchy_path=h_path, org_id=org.id if org else None, status="STOPPED", lifecycle_state=state,
                    last_seen_at=seen, firmware_version=fw, subscription_expires_at=subscription)
        if latlng:
            pump.latitude, pump.longitude = latlng
        if warranty:
            pump.warranty_start_date, pump.warranty_period_months = warranty
        cls.db.add(pump)
        cls.db.commit()
        cls.pump_ids.append(pid)
        return pump

    @classmethod
    def _fault(cls, tag, when, code):
        cls.db.add(FaultLog(pump_id=f"P3-{tag}-{cls.sfx}", occurred_at=when, description="test", fault_code=code))

    @classmethod
    def _alert(cls, tag, a_type, code, open_):
        cls.bucket += 1
        cls.db.add(Alert(pump_id=f"P3-{tag}-{cls.sfx}", alert_type=a_type, severity="HIGH", fault_code=code,
                         dedup_bucket=cls.bucket, occurrence_count=1, first_occurred_at=NOW, last_occurred_at=NOW,
                         resolved_at=None if open_ else NOW))

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            ids = tuple(cls.pump_ids)
            cls.db.execute(text("DELETE FROM agripump.alerts WHERE pump_id = ANY(:p)"), {"p": list(ids)})
            cls.db.execute(text("DELETE FROM agripump.fault_logs WHERE pump_id = ANY(:p)"), {"p": list(ids)})
            cls.db.query(Pump).filter(Pump.id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id.in_(cls.user_ids)).delete(synchronize_session=False)
            for org in sorted(cls.db.query(Organisation).filter(Organisation.id.in_(cls.org_ids)).all(),
                              key=lambda x: -x.depth):
                cls.db.delete(org)
            cls.db.commit()
        finally:
            cls.db.close()

    def setUp(self):
        self.db.rollback()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        cache_service.clear_prefix("dash:")
        patcher = patch.object(dashboard_service, "DASHBOARD_CACHE_TTL", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def get(self, path, user, **params):
        return client.get(f"/api/v1/dashboard{path}", headers=auth_header(user), params=params)

    def pid(self, tag):
        return f"P3-{tag}-{self.sfx}"


class DashboardIntegration(_Fixture):
    # ============================================================ subtree numbers (Manufacturer A)
    def test_01_manufacturer_a_sees_exactly_its_subtree(self):
        r = self.get("/subtree", self.u_mfgA)
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual(d["scope"]["type"], "SUBTREE")
        self.assertEqual(d["devices"]["total"], 7)
        self.assertEqual(d["devices"]["by_state"], {
            "MANUFACTURED": 0, "ALLOCATED": 0, "IN_STOCK": 1, "COMMISSIONED": 1, "ACTIVE": 4,
            "SUSPENDED": 0, "RMA": 1, "RETIRED": 0})
        self.assertEqual(d["connectivity"], {"online": 3, "offline": 2, "unknown": 0, "not_in_service": 2})
        self.assertEqual(d["faults_today"], 3)   # dlA1's three; the 23:59:59-yesterday one and Tree B are excluded
        fw = {x["version"]: x["device_count"] for x in d["firmware_distribution"]}
        self.assertEqual(fw, {"1.0.4": 3, "1.0.3": 2, "unknown": 2})
        self.assertAlmostEqual(sum(x["percentage"] for x in d["firmware_distribution"]), 100.0, places=1)
        self.assertEqual(d["warranty_expiring_soon"], 1)
        self.assertEqual(d["subscription_expiring_soon"], 1)
        top = [(x["device_id"], x["fault_count"]) for x in d["top_faulting_devices"]]
        self.assertEqual(top, [(self.pid("dlA1"), 4), (self.pid("dA1"), 1)])   # 40/41-day-old faults are outside 30 days
        self.assertEqual(d["faults"]["active_total"], 2)                        # OFFLINE alert and resolved one excluded
        self.assertEqual({(x["fault_code"], x["count"]) for x in d["faults"]["by_type"]}, {(1, 1), (2, 1)})
        self.assertEqual(len(d["connectivity_map"]), 1)
        cell = d["connectivity_map"][0]
        self.assertEqual((cell["latitude"], cell["longitude"], cell["status"], cell["device_count"]),
                         (18.52, 73.86, "ONLINE", 1))                            # rounded ~1 km, never exact

    def test_02_nobody_sees_a_sibling_tree(self):
        # Every number Manufacturer B sees is Tree B's: 3 devices, 5+2 faults today, and none of A's firmware.
        d = self.get("/subtree", self.u_mfgB).json()
        self.assertEqual(d["devices"]["total"], 3)
        self.assertEqual(d["faults_today"], 7)
        self.assertEqual({x["version"] for x in d["firmware_distribution"]}, {"2.0.0"})
        seen = {x["device_id"] for x in d["top_faulting_devices"]}
        self.assertTrue(seen <= {self.pid("mB1"), self.pid("dlB1")}, seen)
        for u in (self.u_dealerB, self.u_distB):
            self.assertTrue(self.get("/subtree", u).json()["devices"]["total"] <= 3)

    def test_03_each_level_sees_only_its_own_subtree(self):
        totals = {tag: self.get("/subtree", user).json()["devices"]["total"] for tag, user in {
            "distA": self.u_distA, "dealerA": self.u_dealerA, "dealerA3": self.u_dealerA3,
            "distB": self.u_distB, "dealerB": self.u_dealerB}.items()}
        self.assertEqual(totals, {"distA": 6, "dealerA": 4, "dealerA3": 1, "distB": 2, "dealerB": 1})

    def test_04_support_engineer_is_limited_to_their_scope(self):
        d = self.get("/subtree", self.u_support).json()
        self.assertEqual(d["devices"]["total"], 6)           # Distributor A's subtree, not the whole platform
        self.assertEqual(self.get("/global", self.u_support).status_code, 403)

    def test_05_the_explicit_predicate_isolates_tenants_without_rls(self):
        """Row-level security is a second boundary, not the first. Run the service on a session that BYPASSES RLS, so
        only the application's own tenant predicate limits the rows, and check every caller still sees exactly its
        own tree (a missing predicate would return the whole fleet here)."""
        expected = {"mfgA": (self.u_mfgA, 7), "distA": (self.u_distA, 6), "dealerA": (self.u_dealerA, 4),
                    "dealerA3": (self.u_dealerA3, 1), "support": (self.u_support, 6), "mfgB": (self.u_mfgB, 3),
                    "distB": (self.u_distB, 2), "dealerB": (self.u_dealerB, 1), "legacy": (self.u_legacy, 1),
                    "rootpath": (self.u_rootpath, 0)}
        for tag, (user, total) in expected.items():
            d = dashboard_service.DashboardService(db=self.db, user=user).get_subtree_dashboard()
            self.assertEqual(d["devices"]["total"], total, tag)
            ours = {x["device_id"] for x in d["top_faulting_devices"]}
            self.assertTrue(all(i.startswith("P3-") and i.endswith(self.sfx) for i in ours), (tag, ours))
        # ... and the fault-derived numbers, which each come from a different query.
        d = dashboard_service.DashboardService(db=self.db, user=self.u_dealerB).get_subtree_dashboard()
        self.assertEqual((d["faults_today"], d["faults"]["active_total"]), (2, 1))
        d = dashboard_service.DashboardService(db=self.db, user=self.u_legacy).get_subtree_dashboard()
        self.assertEqual((d["faults_today"], d["faults"]["active_total"]), (1, 0))
        for lister in ("get_offline_devices", "get_faults_list", "get_top_faulting_devices_list"):
            out = getattr(dashboard_service.DashboardService(db=self.db, user=self.u_dealerB), lister)()
            self.assertEqual({i["device_id"] for i in out["items"]} - {self.pid("dlB1")}, set(), lister)

    # ====================================================================== authorization
    def test_10_global_is_super_admin_only(self):
        for user in (self.u_mfgA, self.u_distA, self.u_dealerA, self.u_support, self.farmer):
            r = self.get("/global", user)
            self.assertEqual(r.status_code, 403, f"{user.role}: {r.text}")
            self.assertEqual(r.json()["error"]["code"], "DASHBOARD_ACCESS_DENIED")
        self.assertEqual(self.get("/global", self.sa).status_code, 200)

    def test_11_end_user_has_no_partner_dashboard(self):
        for path in ("/subtree", "/connectivity", "/faults", "/firmware-distribution", "/top-faulting-devices",
                     "/offline-devices", "/warranty-expiring", "/subscription-expiring"):
            self.assertEqual(self.get(path, self.farmer).status_code, 403, path)

    def test_12_partners_cannot_inspect_another_organisation(self):
        # By id, on the Super-Admin-only route: the dealer's own org and a rival's are both refused.
        for org in (self.dealerB, self.dealerA, self.mfgB):
            self.assertEqual(self.get(f"/organisations/{org.id}", self.u_dealerA).status_code, 403)
        self.assertEqual(self.get(f"/organisations/{self.dealerB.id}", self.u_mfgA).status_code, 403)

    def test_13_org_id_query_parameter_cannot_change_scope(self):
        base = self.get("/subtree", self.u_dealerA).json()
        for extra in ({"org_id": str(self.dealerB.id)}, {"organisation_id": str(self.mfgB.id)},
                      {"hierarchy_path": f"/SA/MB{self.sfx}"}):
            r = self.get("/subtree", self.u_dealerA, **extra)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["devices"], base["devices"])
            self.assertEqual(r.json()["scope"], base["scope"])

    def test_14_super_admin_can_inspect_an_organisation(self):
        d = self.get(f"/organisations/{self.dealerA.id}", self.sa).json()
        self.assertEqual(d["scope"]["type"], "ORG")
        self.assertEqual(d["devices"]["total"], 4)
        r = self.get(f"/organisations/{uuid.uuid4()}", self.sa)
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (404, "ORGANISATION_NOT_FOUND"))
        self.assertEqual(self.get("/organisations/not-a-uuid", self.sa).status_code, 404)

    def test_15_single_metric_endpoints_are_scoped_the_same_way(self):
        self.assertEqual(self.get("/connectivity", self.u_dealerA).json(),
                         {"online": 2, "offline": 1, "unknown": 0, "not_in_service": 1})
        fw = self.get("/firmware-distribution", self.u_dealerA).json()["firmware_distribution"]
        self.assertEqual({x["version"]: x["device_count"] for x in fw}, {"1.0.4": 2, "1.0.3": 1, "unknown": 1})
        off = self.get("/offline-devices", self.u_mfgA).json()
        self.assertEqual({x["device_id"] for x in off["items"]}, {self.pid("dA1"), self.pid("dlA2")})
        self.assertEqual(off["total"], 2)
        faults = self.get("/faults", self.u_dealerA).json()
        self.assertTrue(all(i["device_id"].startswith("P3-dlA") or i["device_id"].startswith("P3-a") for i in faults["items"]))
        self.assertEqual(faults["faults_today"], 3)

    # ============================================================ legacy (path only) scoping
    def test_20_legacy_partner_sees_its_path_and_nothing_else(self):
        d = self.get("/subtree", self.u_legacy).json()
        self.assertEqual(d["devices"]["total"], 1)                       # leg1 only: not LEGX..., not LEG_x0/...
        self.assertEqual(d["faults_today"], 1)
        self.assertEqual({x["version"] for x in d["firmware_distribution"]}, {"1.0.4"})

    def test_21_a_partner_whose_path_is_the_bare_root_gets_nothing(self):
        d = self.get("/subtree", self.u_rootpath).json()
        self.assertEqual(d["devices"]["total"], 0)

    # ================================================================== global (Super Admin)
    def test_30_global_matches_an_independent_count(self):
        d = self.get("/global", self.sa).json()
        self.db.rollback()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        expected = {s: 0 for s in STATES}
        for (state,) in self.db.query(Pump.lifecycle_state).all():
            expected[state] += 1
        self.assertEqual(d["scope"], {"type": "GLOBAL", "organisation_id": None})
        self.assertEqual(d["devices"]["by_state"], expected)
        self.assertEqual(d["devices"]["total"], sum(expected.values()))
        c = d["connectivity"]
        self.assertEqual(c["online"] + c["offline"] + c["unknown"] + c["not_in_service"], d["devices"]["total"])
        for key in ("top_faulting_devices", "firmware_distribution", "connectivity_map"):
            self.assertIsInstance(d[key], list)

    def test_31_filters_are_applied_in_the_database(self):
        d = self.get("/subtree", self.u_mfgA, state="ACTIVE").json()
        self.assertEqual(d["devices"]["total"], 4)
        self.assertEqual(d["devices"]["by_state"]["ACTIVE"], 4)
        d = self.get("/subtree", self.u_mfgA, firmware_version="1.0.3").json()
        self.assertEqual(d["devices"]["total"], 2)
        self.assertEqual(self.get("/subtree", self.u_mfgA, state="NOPE").status_code, 422)
        f = self.get("/faults", self.u_mfgA, fault_code=3).json()
        self.assertEqual([i["device_id"] for i in f["items"]], [self.pid("dA1")])

    def test_32_pagination_is_server_side(self):
        p1 = self.get("/top-faulting-devices", self.u_mfgA, limit=1, offset=0).json()
        p2 = self.get("/top-faulting-devices", self.u_mfgA, limit=1, offset=1).json()
        self.assertEqual((len(p1["items"]), len(p2["items"]), p1["total"]), (1, 1, 2))
        self.assertNotEqual(p1["items"][0]["device_id"], p2["items"][0]["device_id"])
        self.assertEqual(self.get("/top-faulting-devices", self.u_mfgA, limit=0).status_code, 422)
        self.assertEqual(self.get("/top-faulting-devices", self.u_mfgA, limit=101).status_code, 422)

    # ========================================================== empty / partial data
    def test_40_a_partner_with_no_devices_gets_valid_empty_structures(self):
        empty = self.get("/subtree", self.u_rootpath).json()
        self.assertEqual(empty["devices"]["by_state"], {s: 0 for s in STATES})
        self.assertEqual(empty["connectivity"], {"online": 0, "offline": 0, "unknown": 0, "not_in_service": 0})
        self.assertEqual(empty["faults"], {"active_total": 0, "by_type": []})
        for key in ("top_faulting_devices", "firmware_distribution", "connectivity_map"):
            self.assertEqual(empty[key], [], key)
        self.assertEqual(empty["faults_today"], 0)
        self.assertEqual(empty["warranty_expiring_soon"], 0)
        self.assertEqual(empty["subscription_expiring_soon"], 0)
        self.assertTrue(empty["freshness"]["stale"])                 # nothing has ever reported: not "fresh"
        self.assertIsNone(empty["last_data_update"])

    def test_41_freshness_is_taken_from_real_timestamps(self):
        d = self.get("/subtree", self.u_mfgA).json()
        newest = datetime.fromisoformat(d["last_data_update"])
        self.assertLess(abs((newest - (NOW - timedelta(minutes=1))).total_seconds()), 5)
        self.assertFalse(d["freshness"]["stale"])
        self.assertEqual(d["timezone"], "Asia/Kolkata")
        with patch.object(dashboard_service.settings, "DASHBOARD_STALE_AFTER_SECONDS", 1, create=True):
            self.assertTrue(self.get("/subtree", self.u_mfgA).json()["freshness"]["stale"])

    # ================================================================================ time
    def test_50_today_is_a_calendar_day_in_the_dashboard_timezone(self):
        # 23:59:59 IST the day before is not today; 00:00:01 IST is. (2026-09-29 18:29:59Z == 23:59:59 IST.)
        self.assertEqual(local_today(datetime(2026, 9, 29, 18, 29, 59, tzinfo=timezone.utc)), date(2026, 9, 29))
        self.assertEqual(local_today(datetime(2026, 9, 29, 18, 30, 0, tzinfo=timezone.utc)), date(2026, 9, 30))
        self.assertEqual(today_start_utc(datetime(2026, 9, 30, 2, 0, tzinfo=timezone.utc)),
                         datetime(2026, 9, 29, 18, 30, tzinfo=timezone.utc))
        with patch.object(dashboard_service.settings, "DASHBOARD_TIMEZONE", "UTC"), \
                patch("app.core.dashboard_time.settings.DASHBOARD_TIMEZONE", "UTC"):
            self.assertEqual(day_start_utc(date(2026, 9, 30)), datetime(2026, 9, 30, tzinfo=timezone.utc))

    def test_51_faults_at_the_midnight_boundary_are_split_correctly(self):
        # dlA1 has one fault at today0 - 1s (yesterday, local) and three at today0 + 1..3s. Only the latter count.
        d = self.get("/subtree", self.u_dealerA).json()
        self.assertEqual(d["faults_today"], 3)

    def test_52_runtime_comes_from_the_background_rollup_with_a_direct_fallback(self):
        from app.services.dashboard_rollup_service import refresh_dashboard_runtime

        pid = self.pid("dlA1")
        other = self.pid("dlA2")
        self.db.execute(text("""
            INSERT INTO agripump.telemetry_history (pump_id, recorded_at, pump_on)
            SELECT :p, :t0 + (g * interval '1 second'), true FROM generate_series(1, 120) g
        """), {"p": pid, "t0": self.today0})
        for back, minutes in ((1, 60), (2, 30)):
            self.db.execute(text("""
                INSERT INTO agripump.daily_summary (device_id, day, runtime_min)
                VALUES (:p, :d, :m) ON CONFLICT (device_id, day) DO UPDATE SET runtime_min = :m
            """), {"p": pid, "d": local_today() - timedelta(days=back), "m": minutes})
        self.db.commit()
        try:
            # 1) With no current rollup row for the scope, the figures are computed directly (never silently zero).
            self.db.execute(text("DELETE FROM agripump.dashboard_runtime WHERE device_id = ANY(:p)"),
                            {"p": [pid, other]})
            self.db.commit()
            rt = self.get("/subtree", self.u_dealerA).json()["runtime"]
            self.assertEqual((rt["today_source"], rt["today_hours"], rt["period_hours"]), ("live", 2.0, 3.5))
            # 2) After a refresh it comes from the rollup: today's 120 minutes plus the two completed days.
            self.assertGreaterEqual(refresh_dashboard_runtime(self.db), 1)
            rt = self.get("/subtree", self.u_dealerA).json()["runtime"]
            self.assertEqual((rt["today_source"], rt["today_hours"], rt["period_hours"]), ("rollup", 2.0, 3.5))
            self.assertIsNotNone(rt["today_as_of"])
            self.assertEqual(self.get("/subtree", self.u_dealerB).json()["runtime"]["today_hours"], 0.0)
            # 3) Idempotent: refreshing again recomputes, it does not add.
            refresh_dashboard_runtime(self.db)
            self.assertEqual(self.get("/subtree", self.u_dealerA).json()["runtime"]["period_hours"], 3.5)
            # 4) A row from an earlier day is ignored while a fresh row for another of the dealer's devices counts.
            self.db.execute(text("""
                INSERT INTO agripump.dashboard_runtime (device_id, day, runtime_min, history_min, history_days)
                VALUES (:o, :d, 30, 0, 7) ON CONFLICT (device_id) DO UPDATE
                SET day = :d, runtime_min = 30, history_min = 0, history_days = 7"""), {"o": other, "d": local_today()})
            self.db.execute(text("UPDATE agripump.dashboard_runtime SET day = day - 1 WHERE device_id = :p"),
                            {"p": pid})
            self.db.commit()
            rt = self.get("/subtree", self.u_dealerA).json()["runtime"]
            self.assertEqual((rt["today_source"], rt["today_hours"], rt["period_hours"]), ("rollup", 0.5, 0.5))
            # 5) A row computed for a different window than the configured one is ignored, so the direct path is used.
            self.db.execute(text("UPDATE agripump.dashboard_runtime SET history_days = 3 WHERE device_id = :o"),
                            {"o": other})
            self.db.commit()
            rt = self.get("/subtree", self.u_dealerA).json()["runtime"]
            self.assertEqual((rt["today_source"], rt["today_hours"], rt["period_hours"]), ("live", 2.0, 3.5))
        finally:
            for table, col in (("telemetry_history", "pump_id"), ("daily_summary", "device_id"),
                               ("dashboard_runtime", "device_id")):
                self.db.execute(text(f"DELETE FROM agripump.{table} WHERE {col} = ANY(:p)"), {"p": [pid, other]})
            self.db.commit()

    def test_53_partners_can_read_but_not_write_the_rollup_tables(self):
        """RLS for a real partner session: reads limited to their devices, writes refused."""
        pid = self.pid("dlA1")
        self.db.execute(text("""
            INSERT INTO agripump.dashboard_runtime (device_id, day, runtime_min) VALUES (:p, :d, 5)
            ON CONFLICT (device_id) DO UPDATE SET runtime_min = 5"""), {"p": pid, "d": local_today()})
        self.db.execute(text("""
            INSERT INTO agripump.dashboard_runtime (device_id, day, runtime_min) VALUES (:p, :d, 5)
            ON CONFLICT (device_id) DO UPDATE SET runtime_min = 5"""), {"p": self.pid("dlB1"), "d": local_today()})
        self.db.commit()
        try:
            partner = SessionLocal()
            try:
                for k, v in (("app.user_id", str(self.u_dealerA.id)), ("app.user_role", "dealer"),
                             ("app.org_path", str(self.dealerA.path)),
                             ("app.hierarchy_path", self.u_dealerA.hierarchy_path)):
                    partner.execute(text("SELECT set_config(:k, :v, false)"), {"k": k, "v": v})
                seen = {r[0] for r in partner.execute(text("SELECT device_id FROM agripump.dashboard_runtime"))}
                self.assertIn(pid, seen)
                self.assertNotIn(self.pid("dlB1"), seen)                 # a rival's row is invisible
                # An UPDATE is not refused with an error: the write policy simply hides every row from a partner, so
                # nothing changes. An INSERT is rejected outright.
                res = partner.execute(text("UPDATE agripump.dashboard_runtime SET runtime_min = 999 "
                                           "WHERE device_id = :p"), {"p": pid})
                self.assertEqual(res.rowcount, 0)
                partner.rollback()
                from sqlalchemy.exc import DBAPIError
                with self.assertRaises(DBAPIError):
                    partner.execute(text("INSERT INTO agripump.dashboard_runtime (device_id, day, runtime_min) "
                                         "VALUES (:o, :d, 1)"), {"o": self.pid("dlA2"), "d": local_today()})
                partner.rollback()
                res = partner.execute(text("UPDATE agripump.daily_summary SET runtime_min = 1 WHERE device_id = :p"),
                                      {"p": pid})
                self.assertEqual(res.rowcount, 0)                          # partners can read rollups, never write
                partner.rollback()
            finally:
                partner.close()
        finally:
            self.db.execute(text("DELETE FROM agripump.dashboard_runtime WHERE device_id = ANY(:p)"),
                            {"p": [pid, self.pid("dlA2"), self.pid("dlB1")]})
            self.db.commit()

    # ======================================================================= cache & limits
    def test_60_cache_is_per_scope_and_reports_hits(self):
        with patch.object(dashboard_service, "DASHBOARD_CACHE_TTL", 30):
            a1 = self.get("/subtree", self.u_dealerA).json()
            a2 = self.get("/subtree", self.u_dealerA).json()
            b1 = self.get("/subtree", self.u_dealerB).json()
        self.assertFalse(a1["cache"]["hit"])
        self.assertTrue(a2["cache"]["hit"])
        self.assertEqual(a1["generated_at"], a2["generated_at"])        # generated_at is when it was computed
        self.assertFalse(b1["cache"]["hit"])                              # a different scope never shares an entry
        self.assertNotEqual(a1["devices"], b1["devices"])

    def test_61_rate_limit_applies_to_dashboard_endpoints(self):
        headers = auth_header(self.u_dealerA)
        client_id = f"user:{headers['Authorization'][-16:]}"
        window = int(datetime.now().timestamp()) // 60
        cache_service.set(f"ratelimit:{client_id}:{window}", 10_000, ex=120)
        cache_service.set(f"ratelimit:{client_id}:{window + 1}", 10_000, ex=120)
        r = client.get("/api/v1/dashboard/subtree", headers=headers)
        self.assertEqual(r.status_code, 429)
        self.assertIn("Retry-After", r.headers)
        self.assertEqual(r.json()["error"]["code"], "RATE_LIMIT_EXCEEDED")

    def test_62_a_query_failure_is_a_safe_500_without_sql(self):
        with patch("app.services.dashboard_service.DashboardService.get_subtree_dashboard",
                   side_effect=RuntimeError('relation "agripump.secret" does not exist')):
            r = self.get("/subtree", self.u_dealerA)
        self.assertEqual(r.status_code, 500)
        self.assertEqual(r.json()["error"]["code"], "DASHBOARD_QUERY_FAILED")
        self.assertNotIn("secret", r.text)


class DashboardWebSocketScope(_Fixture):
    """Live events are delivered only to connections allowed to see that device."""

    def test_70_events_reach_only_in_scope_connections(self):
        from app.websockets import dashboard_ws as ws

        class Sock:
            def __init__(self):
                self.got = []

            async def send_text(self, m):
                self.got.append(m)

        def meta(user, org_ids=()):
            return {"role": __import__("app.core.roles", fromlist=["normalize_role"]).normalize_role(user.role),
                    "org_ids": set(org_ids),
                    "hier_path": ws.scope_hier_path(
                        __import__("app.core.roles", fromlist=["normalize_role"]).normalize_role(user.role),
                        user.hierarchy_path)}

        async def run():
            hub = ws.DashboardHub()
            socks = {
                "sa": (Sock(), meta(self.sa)),
                "mfgA": (Sock(), meta(self.u_mfgA, {str(o.id) for o in (self.mfgA, self.distA, self.dealerA,
                                                                        self.dealerA2, self.dealerA3)})),
                "mfgB": (Sock(), meta(self.u_mfgB, {str(o.id) for o in (self.mfgB, self.distB, self.dealerB)})),
                "legacy": (Sock(), meta(self.u_legacy)),
                "anon": (Sock(), None),
            }
            for sock, m in socks.values():
                await hub.connect(sock, m)

            await hub.broadcast_fault("x", str(self.dealerA.id), {"id": "1"})
            await hub.broadcast_device_status("y", None, "OFFLINE", "t", f"/SA/LEG_{self.sfx}/F1")
            await hub.broadcast_device_status("z", None, "OFFLINE", "t", f"/SA/LEGX{self.sfx}/F1")
            await hub.broadcast_device_status("w", None, "OFFLINE", "t", f"/SA/LEG_{self.sfx}0/F1")
            return {k: [__import__("json").loads(m)["device_id"] for m in s.got] for k, (s, _) in socks.items()}

        got = asyncio.new_event_loop().run_until_complete(run())
        self.assertEqual(got["sa"], ["x", "y", "z", "w"])
        self.assertEqual(got["mfgA"], ["x"])                # only its own tree
        self.assertEqual(got["mfgB"], [])                   # never a sibling's
        self.assertEqual(got["legacy"], ["y"])              # exact path only: not LEGX..., not LEG_x0/...
        self.assertEqual(got["anon"], [])                   # not yet authenticated

    def test_71_publisher_resolves_scope_from_the_database(self):
        from app.websockets import dashboard_ws as ws

        class Sock:
            def __init__(self):
                self.got = []

            async def send_text(self, m):
                self.got.append(m)

        async def run():
            old = ws.dashboard_hub
            ws.dashboard_hub = ws.DashboardHub()
            try:
                inside, outside = Sock(), Sock()
                await ws.dashboard_hub.connect(inside, {"role": "manufacturer", "hier_path": None,
                                                        "org_ids": {str(self.dealerA.id)}})
                await ws.dashboard_hub.connect(outside, {"role": "manufacturer", "hier_path": None,
                                                         "org_ids": {str(self.dealerB.id)}})
                await ws.publish_alert_event(self.pid("dlA1"), {"id": "a1", "alert_type": "FAULT", "fault_code": 1})
                await ws.publish_alert_event(self.pid("dlA1"), {"id": "a2", "alert_type": "OFFLINE",
                                                                "last_occurred_at": "2026-01-01T00:00:00+00:00"})
                return inside.got, outside.got
            finally:
                ws.dashboard_hub = old

        inside, outside = asyncio.new_event_loop().run_until_complete(run())
        kinds = [__import__("json").loads(m)["type"] for m in inside]
        self.assertEqual(kinds, ["FAULT_CREATED", "DEVICE_STATUS_UPDATED"])
        self.assertEqual(outside, [])

    def test_73_a_fault_announced_through_the_existing_hub_reaches_the_dashboard_channel(self):
        """Ingest, the alert engine and the connectivity sweep all announce through `ws_hub.broadcast_fault`; that one
        call must also feed the dashboard channel (before this hook nothing ever published to it)."""
        import json

        from app.services.ws_hub import ws_hub
        from app.websockets import dashboard_ws as ws

        class Sock:
            def __init__(self):
                self.got = []

            async def send_text(self, m):
                self.got.append(json.loads(m))

        async def run():
            old = ws.dashboard_hub
            ws.dashboard_hub = ws.DashboardHub()
            try:
                mine, rival = Sock(), Sock()
                await ws.dashboard_hub.connect(mine, {"role": "manufacturer", "hier_path": None,
                                                      "org_ids": {str(self.dealerA.id)}})
                await ws.dashboard_hub.connect(rival, {"role": "manufacturer", "hier_path": None,
                                                       "org_ids": {str(self.dealerB.id)}})
                pid = self.pid("dlA1")
                await ws_hub.broadcast_fault(pid, {"id": "f1", "alert_type": "FAULT", "fault_code": 1,
                                                   "last_occurred_at": "2026-01-01T00:00:00+00:00"}, "/SA/x")
                await ws_hub.broadcast_fault(pid, {"id": "o1", "alert_type": "OFFLINE",
                                                   "last_occurred_at": "2026-01-01T00:01:00+00:00"}, "/SA/x")
                await ws_hub.broadcast_fault(pid, {"id": "o1", "alert_type": "OFFLINE",
                                                   "resolved_at": "2026-01-01T00:02:00+00:00"}, "/SA/x")
                return mine.got, rival.got
            finally:
                ws.dashboard_hub = old

        mine, rival = asyncio.new_event_loop().run_until_complete(run())
        self.assertEqual([(e["type"], e.get("status")) for e in mine],
                         [("FAULT_CREATED", None), ("DEVICE_STATUS_UPDATED", "OFFLINE"),
                          ("DEVICE_STATUS_UPDATED", "ONLINE")])
        self.assertTrue(all(e["device_id"] == self.pid("dlA1") for e in mine))
        self.assertEqual(rival, [])

    def test_72_socket_requires_a_valid_end_user_free_session(self):
        for token in (None, "garbage"):
            with self.assertRaises(Exception):
                with client.websocket_connect("/ws/dashboard" + (f"?token={token}" if token else "")) as w:
                    w.send_text('{"type":"auth","token":"garbage"}')
                    w.receive_text()
        farmer_token = auth_header(self.farmer)["Authorization"].split()[1]
        with client.websocket_connect(f"/ws/dashboard?token={farmer_token}") as w:      # end users get no channel
            w.send_text('{"type":"auth","token":"' + farmer_token + '"}')
            with self.assertRaises(Exception):
                w.receive_text()
        good = auth_header(self.u_dealerA)["Authorization"].split()[1]
        with client.websocket_connect(f"/ws/dashboard?token={good}") as w:
            self.assertEqual(w.receive_json(), {"type": "auth_ok"})
            w.send_text('{"type":"ping"}')
            self.assertEqual(w.receive_json(), {"type": "pong"})


if __name__ == "__main__":
    unittest.main()
