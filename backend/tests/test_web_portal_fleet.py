"""What the portal shows about a fleet has to be true: connectivity, counts over everything in scope, no invented values.

Also the white-label settings (branding), which end up on other people's screens.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models import Alert, Branding, Pump
from test_web_portal_hardening import MfaBase  # noqa: E402
from test_web_portal_users import _h, _partner  # noqa: E402

client = TestClient(app)
NOW = datetime.now(timezone.utc)


class FleetBase(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.pump_ids = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(Alert).filter(Alert.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Branding).filter(Branding.org_id.in_(cls.user_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            pass
        super().tearDownClass()

    def add_pump(self, dealer, owner, tag, status="RUNNING", last_seen=None, **kw):
        pid = f"PUMP-FL-{tag}-{uuid.uuid4().hex[:6]}"
        p = Pump(id=pid, name=f"Pump {tag}", supply_type="3-phase", hp_rating=5, owner_user_id=owner.id,
                 hierarchy_path=f"{dealer.hierarchy_path}/{pid}", status=status, lifecycle_state="ACTIVE", last_seen_at=last_seen, **kw)
        self.db.add(p)
        self.db.commit()
        type(self).pump_ids.append(pid)
        return p


class TestFleetTruth(FleetBase):
    def setUp(self):
        self.dealer = _partner(self, "dealer", "fleet")
        self.owner = self.make_user("customer", "fleet-owner")
        self.online = self.add_pump(self.dealer, self.owner, "on", "RUNNING", NOW - timedelta(seconds=30))
        self.quiet = self.add_pump(self.dealer, self.owner, "quiet", "RUNNING", NOW - timedelta(minutes=40))
        self.never = self.add_pump(self.dealer, self.owner, "never", "STOPPED", None)
        self.faulty = self.add_pump(self.dealer, self.owner, "flt", "FAULT", NOW - timedelta(minutes=1))

    def test_a_pump_that_stopped_reporting_is_offline_whatever_it_last_said(self):
        rows = {p["id"]: p for p in client.get("/api/v1/pumps", headers=_h(self.dealer)).json()["pumps"]}
        self.assertEqual(rows[self.online.id]["connectivity"], "ONLINE")
        self.assertEqual(rows[self.quiet.id]["connectivity"], "OFFLINE")   # last said RUNNING, 40 minutes ago
        self.assertEqual(rows[self.never.id]["connectivity"], "NEVER_SEEN")

    def test_counts_are_over_everything_in_scope_not_just_the_page(self):
        r = client.get("/api/v1/pumps?limit=1", headers=_h(self.dealer)).json()
        self.assertEqual(len(r["pumps"]), 1)
        self.assertEqual(r["meta"]["stats"], {"total": 4, "offline": 1, "no_data": 1, "fault": 1, "running": 1, "stopped": 0})

    def test_every_pump_is_in_exactly_one_bucket(self):
        stats = client.get("/api/v1/pumps", headers=_h(self.dealer)).json()["meta"]["stats"]
        self.assertEqual(stats["offline"] + stats["no_data"] + stats["fault"] + stats["running"] + stats["stopped"], stats["total"])

    def test_the_fleet_dashboard_says_the_same(self):
        d = client.get("/api/v1/fleet/dashboard", headers=_h(self.dealer)).json()
        self.assertEqual((d["summary"]["total"], d["summary"]["offline"], d["summary"]["no_data"]), (4, 1, 1))
        self.assertEqual(d["connectivity"]["offline_count"], 1)
        self.assertEqual(d["connectivity"]["online_count"], 2, "reported recently: the running one and the faulted one")
        self.assertEqual(d["connectivity"]["never_seen_count"], 1)

    def test_nothing_is_invented_for_a_pump_that_has_not_said(self):
        row = next(p for p in client.get("/api/v1/pumps", headers=_h(self.dealer)).json()["pumps"] if p["id"] == self.never.id)
        self.assertIsNone(row["firmware_version"])
        self.assertIsNone(row["latitude"])
        self.assertIsNone(row["longitude"])
        self.assertEqual(client.get(f"/api/v1/pumps/{self.never.id}", headers=_h(self.dealer)).status_code, 200)

    def test_reported_values_are_passed_through(self):
        p = self.add_pump(self.dealer, self.owner, "real", "RUNNING", NOW, firmware_version="1.0.400", latitude=18.5, longitude=73.8)
        row = next(x for x in client.get("/api/v1/pumps", headers=_h(self.dealer)).json()["pumps"] if x["id"] == p.id)
        self.assertEqual((row["firmware_version"], row["latitude"], row["longitude"]), ("1.0.400", 18.5, 73.8))

    def test_active_faults_by_type_counts_every_open_alert_not_the_ten_newest(self):
        for i in range(12):
            self.db.add(Alert(pump_id=self.faulty.id, alert_type="FAULT", severity="HIGH", fault_code=5, dedup_bucket=990000 + i,
                              first_occurred_at=NOW, last_occurred_at=NOW))
        self.db.commit()
        d = client.get("/api/v1/fleet/dashboard", headers=_h(self.dealer)).json()
        dry_run = [f for f in d["active_faults_by_type"] if f["fault_code"] == 5]
        self.assertEqual(len(dry_run), 1)
        self.assertEqual(dry_run[0]["count"], 12)
        self.assertNotEqual(dry_run[0]["name"], "FAULT", "named from the fault catalogue")

    def test_firmware_distribution_says_unknown_for_pumps_that_have_not_reported_one(self):
        d = client.get("/api/v1/fleet/dashboard", headers=_h(self.dealer)).json()
        self.assertEqual({f["firmware_version"]: f["count"] for f in d["firmware_distribution"]}, {"unknown": 4})


class TestBrandingIsChecked(FleetBase):
    def setUp(self):
        self.dealer = _partner(self, "dealer", "brand1")
        self.other = _partner(self, "dealer", "brand2")
        self.farmer = self.make_user("customer", "brand-farmer")
        self.sub = f"brand-{uuid.uuid4().hex[:8]}"

    def put(self, actor, **body):
        return client.put("/api/v1/branding/mine", json=body, headers=_h(actor))

    def test_the_resolve_endpoint_works_on_this_database(self):
        r = client.get("/api/v1/branding/resolve", headers={"host": "no-such-tenant.example.com"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNone(r.json()["branding"])

    def test_a_partner_can_brand_itself_and_be_found_by_its_subdomain(self):
        ok = self.put(self.dealer, primary_color="#112233", notification_sender_name="Acme Pumps", subdomain=self.sub,
                      logo_url="https://cdn.example.com/logo.png")
        self.assertEqual(ok.status_code, 200, ok.text)
        found = client.get("/api/v1/branding/resolve", headers={"host": f"{self.sub}.agripump.example"}).json()["branding"]
        self.assertEqual((found["primary_color"], found["notification_sender_name"]), ("#112233", "Acme Pumps"))

    def test_a_farmer_is_not_a_brand(self):
        self.assertEqual(self.put(self.farmer, primary_color="#112233").status_code, 403)

    def test_values_that_could_deface_or_track_are_refused(self):
        for body in ({"primary_color": "red; background:url(//evil)"}, {"primary_color": "#12"},
                     {"logo_url": "http://plain.example.com/x.png"}, {"logo_url": "javascript:alert(1)"},
                     {"logo_url": "https://x.example.com/a b.png"}, {"subdomain": "Has Spaces"}, {"subdomain": "a"},
                     {"notification_sender_name": ""}):
            self.assertEqual(self.put(self.dealer, **body).status_code, 422, body)

    def test_a_subdomain_belongs_to_one_partner_and_platform_names_are_reserved(self):
        self.assertEqual(self.put(self.dealer, subdomain=self.sub).status_code, 200)
        self.assertEqual(self.put(self.other, subdomain=self.sub).status_code, 409)
        self.assertEqual(self.put(self.dealer, subdomain=self.sub).status_code, 200, "keeping your own is fine")
        for name in ("admin", "portal", "api"):
            self.assertEqual(self.put(self.other, subdomain=name).status_code, 422, name)


class TestRegisteringADevice(FleetBase):
    def setUp(self):
        self.dealer = _partner(self, "dealer", "reg1")
        self.farmer = self.make_user("customer", "reg-farmer")

    def register(self, actor, **body):
        body.setdefault("id", f"PUMP-RG-{uuid.uuid4().hex[:8]}")
        body.setdefault("name", "Registered")
        r = client.post("/api/v1/pumps", json=body, headers=_h(actor))
        if r.status_code == 201:
            type(self).pump_ids.append(body["id"])
        return r, body["id"]

    def test_a_farmer_cannot_register_a_device(self):
        r, _ = self.register(self.farmer)
        self.assertEqual(r.status_code, 403)

    def test_the_device_key_is_a_real_secret_that_only_its_hash_survives(self):
        r, pid = self.register(self.dealer)
        self.assertEqual(r.status_code, 201, r.text)
        key = r.json()["device_key"]
        self.assertGreaterEqual(len(key), 32)
        self.assertNotIn(pid, key, "not derived from the device id")
        self.assertNotIn("DEV_KEY", key)
        self.db.expire_all()
        stored = self.db.query(Pump).filter(Pump.id == pid).one()
        self.assertIsNotNone(stored.device_key_hash)
        self.assertNotIn(key, stored.device_key_hash)

        # ...and it is what the device has to present.
        body = {"dev_id": pid, "vl": [415, 412, 410], "mot": 0, "flt": 0}
        self.assertEqual(client.post("/api/v1/telemetry", json=body, headers={"X-Device-Id": pid, "X-Device-Key": "wrong"}).status_code, 401)
        self.assertEqual(client.post("/api/v1/telemetry", json={**body, "seq": 3}, headers={"X-Device-Id": pid, "X-Device-Key": key}).status_code, 200)

    def test_a_new_device_has_not_been_seen_and_has_no_made_up_facts(self):
        r, pid = self.register(self.dealer)
        row = r.json()
        self.assertEqual(row["connectivity"], "NEVER_SEEN")
        self.assertIsNone(row["last_seen_at"])
        self.assertIsNone(row["firmware_version"])
        self.assertIsNone(row["latitude"])
        self.assertIsNone(row["longitude"])

        r2, _ = self.register(self.dealer, latitude=18.5, longitude=73.8)
        self.assertEqual((r2.json()["latitude"], r2.json()["longitude"]), (18.5, 73.8))

    def test_claim_credentials_do_not_pretend(self):
        sa = _partner(self, "superadmin", "reg-sa")
        r, pid = self.register(sa)
        claim = client.post(f"/api/v1/pumps/{pid}/claim-credentials", headers=_h(sa))
        self.assertEqual(claim.status_code, 501)
        self.assertNotIn("PEM", claim.text)


if __name__ == "__main__":
    unittest.main()
