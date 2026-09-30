"""A fault's name and severity must reach the web portal, not just its bare code.

Three response shapes promise `fault_name` (and `/faults` also promises `severity`) and none of them filled it
in: `GET /pumps/{id}/faults` (FaultLogsView, EventsTab, SupportConsoleView), `GET /alerts` (AlertsView,
AppShell's toast), and the fleet dashboard's `active_faults_by_type` built its own separate, working copy of the
same lookup. All three now go through `app.services.fault_catalog.load_fault_catalog`.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models import Alert, FaultLog, Pump
from test_web_portal_hardening import MfaBase  # noqa: E402
from test_web_portal_users import _h, _partner  # noqa: E402

client = TestClient(app)

# code 1 "YPhase"/CRITICAL is seeded by every migrated database (docs/telemetry-and-fault-spec.md); using it
# rather than inserting a catalog row keeps this test from depending on write access to that table.
KNOWN_CODE, KNOWN_NAME, KNOWN_SEVERITY = 1, "YPhase", "CRITICAL"


class Base(MfaBase):
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
            cls.db.query(FaultLog).filter(FaultLog.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            pass
        super().tearDownClass()

    def pump(self, owner):
        pid = f"PUMP-FN-{uuid.uuid4().hex[:8]}"
        self.db.add(Pump(id=pid, name="Fault-name test pump", supply_type="3-phase", hp_rating=5,
                          owner_user_id=owner.id, hierarchy_path=owner.hierarchy_path, lifecycle_state="ACTIVE"))
        self.db.commit()
        type(self).pump_ids.append(pid)
        return pid


class TestFaultLogsHaveNames(Base):
    def test_a_known_code_gets_its_real_name_and_severity(self):
        cls = type(self)
        if getattr(cls, "dealer", None) is None:
            cls.dealer = _partner(self, "dealer", "fn")
        pid = self.pump(self.dealer)
        self.db.add(FaultLog(pump_id=pid, occurred_at=datetime.utcnow(), fault_code=KNOWN_CODE,
                              description="test", fault_description="test"))
        self.db.commit()

        r = client.get(f"/api/v1/pumps/{pid}/faults", headers=_h(self.dealer))
        self.assertEqual(r.status_code, 200, r.text)
        row = r.json()[0]
        self.assertEqual((row["fault_name"], row["severity"]), (KNOWN_NAME, KNOWN_SEVERITY))

    def test_a_log_with_no_code_gets_no_name_rather_than_a_made_up_one(self):
        # fault_logs.fault_code has a foreign key to the catalog, so an out-of-range code cannot exist in a
        # real row; a row with no code at all (legacy/unparsed data) is the real case that must not crash
        # or invent a name.
        cls = type(self)
        if getattr(cls, "dealer", None) is None:
            cls.dealer = _partner(self, "dealer", "fn2")
        pid = self.pump(self.dealer)
        self.db.add(FaultLog(pump_id=pid, occurred_at=datetime.utcnow(), fault_code=None,
                              description="test", fault_description="test"))
        self.db.commit()

        row = client.get(f"/api/v1/pumps/{pid}/faults", headers=_h(self.dealer)).json()[0]
        self.assertEqual((row["fault_code"], row["fault_name"], row["severity"]), (None, None, None))


class TestAlertsHaveNames(Base):
    def test_a_fault_alert_carries_its_real_name(self):
        cls = type(self)
        if getattr(cls, "dealer", None) is None:
            cls.dealer = _partner(self, "dealer", "fn3")
        pid = self.pump(self.dealer)
        self.db.add(Alert(pump_id=pid, alert_type="FAULT", severity=KNOWN_SEVERITY, fault_code=KNOWN_CODE,
                           dedup_bucket=1, occurrence_count=1))
        self.db.commit()

        r = client.get("/api/v1/alerts", headers=_h(self.dealer))
        self.assertEqual(r.status_code, 200, r.text)
        rows = [a for a in r.json()["alerts"] if a["pump_id"] == pid]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["fault_name"], KNOWN_NAME)

    def test_an_offline_alert_has_no_fault_name_and_no_crash(self):
        cls = type(self)
        if getattr(cls, "dealer", None) is None:
            cls.dealer = _partner(self, "dealer", "fn4")
        pid = self.pump(self.dealer)
        self.db.add(Alert(pump_id=pid, alert_type="OFFLINE", severity="HIGH", fault_code=None,
                           dedup_bucket=1, occurrence_count=1))
        self.db.commit()

        r = client.get("/api/v1/alerts", headers=_h(self.dealer))
        self.assertEqual(r.status_code, 200, r.text)
        rows = [a for a in r.json()["alerts"] if a["pump_id"] == pid]
        self.assertEqual((rows[0]["alert_type"], rows[0]["fault_name"]), ("OFFLINE", None))


class TestFleetDashboardStillWorks(Base):
    """The dashboard's own copy of this lookup (fixed to share the same helper) must still behave the same."""

    def test_the_fault_type_breakdown_still_names_and_ranks_faults(self):
        cls = type(self)
        if getattr(cls, "dealer", None) is None:
            cls.dealer = _partner(self, "dealer", "fn5")
        pid = self.pump(self.dealer)
        self.db.add_all([
            Alert(pump_id=pid, alert_type="FAULT", severity=KNOWN_SEVERITY, fault_code=KNOWN_CODE,
                  dedup_bucket=1, occurrence_count=1),
            Alert(pump_id=pid, alert_type="OFFLINE", severity="HIGH", fault_code=None,
                  dedup_bucket=2, occurrence_count=1),
        ])
        self.db.commit()

        r = client.get("/api/v1/fleet/dashboard", headers=_h(self.dealer))
        self.assertEqual(r.status_code, 200, r.text)
        by_type = {row["name"]: row for row in r.json()["active_faults_by_type"]}
        self.assertIn(KNOWN_NAME, by_type)
        self.assertEqual(by_type[KNOWN_NAME]["severity"], KNOWN_SEVERITY)
        self.assertIn("OFFLINE", by_type)


if __name__ == "__main__":
    unittest.main()
