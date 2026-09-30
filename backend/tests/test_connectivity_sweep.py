"""Connectivity alerts (FR-CLD-024, planner P2.6): raised when a pump stops reporting, resolved when it reports again.

Runs against the local development database; every pump and alert created here is removed again.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.models import Alert, Pump, User
from app.services.connectivity_sweep import sweep_connectivity

OFFLINE_AFTER = settings.OFFLINE_AFTER_SECONDS


class TestConnectivitySweep(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:8]
        cls.pump_ids = []
        cls.owner = cls.db.query(User).filter(User.role == "superadmin").first()
        if not cls.owner:
            cls.owner = User(
                phone_number=f"+9198{uuid.uuid4().int % 10**8:08d}", full_name="Sweep Test SA",
                role="superadmin", hierarchy_path="/SA", is_active=True, password_hash="notused",
            )
            cls.db.add(cls.owner)
            cls.db.flush()
            cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(Alert).filter(Alert.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    def pump(self, **fields):
        pid = f"SWEEP-{self.sfx}-{uuid.uuid4().hex[:6]}"
        defaults = dict(id=pid, name="Sweep test pump", owner_user_id=self.owner.id, hierarchy_path="/SA",
                        lifecycle_state="ACTIVE", status="RUNNING")
        defaults.update(fields)
        self.db.add(Pump(**defaults))
        self.db.commit()
        type(self).pump_ids.append(pid)
        return pid

    def open_alert(self, pump_id):
        return (
            self.db.query(Alert)
            .filter(Alert.pump_id == pump_id, Alert.alert_type == "OFFLINE", Alert.resolved_at.is_(None))
            .first()
        )

    def test_a_pump_that_has_gone_quiet_gets_one_open_alert(self):
        quiet = self.pump(last_seen_at=datetime.now(timezone.utc) - timedelta(seconds=OFFLINE_AFTER + 30))
        raised, resolved = sweep_connectivity(self.db)
        self.assertIn(quiet, [a.pump_id for a in raised])
        self.assertEqual(resolved, [])
        alert = self.open_alert(quiet)
        self.assertIsNotNone(alert)
        self.assertEqual(alert.severity, "HIGH")

        # A second sweep does not raise a second one.
        raised2, _ = sweep_connectivity(self.db)
        self.assertNotIn(quiet, [a.pump_id for a in raised2])
        self.assertEqual(self.db.query(Alert).filter(Alert.pump_id == quiet, Alert.alert_type == "OFFLINE").count(), 1)

    def test_a_pump_that_never_reported_is_not_offline(self):
        never = self.pump(last_seen_at=None)
        raised, _ = sweep_connectivity(self.db)
        self.assertNotIn(never, [a.pump_id for a in raised])
        self.assertIsNone(self.open_alert(never))

    def test_a_pump_within_the_window_is_not_offline(self):
        fresh = self.pump(last_seen_at=datetime.now(timezone.utc) - timedelta(seconds=OFFLINE_AFTER - 60))
        raised, _ = sweep_connectivity(self.db)
        self.assertNotIn(fresh, [a.pump_id for a in raised])

    def test_reporting_again_resolves_the_alert(self):
        pump_id = self.pump(last_seen_at=datetime.now(timezone.utc) - timedelta(seconds=OFFLINE_AFTER + 30))
        sweep_connectivity(self.db)
        self.assertIsNotNone(self.open_alert(pump_id))

        self.db.query(Pump).filter(Pump.id == pump_id).update({"last_seen_at": datetime.now(timezone.utc)})
        self.db.commit()
        raised, resolved = sweep_connectivity(self.db)
        self.assertIn(pump_id, [a.pump_id for a in resolved])
        self.assertIsNone(self.open_alert(pump_id))
        resolved_row = self.db.query(Alert).filter(Alert.pump_id == pump_id, Alert.alert_type == "OFFLINE").order_by(Alert.first_occurred_at.desc()).first()
        self.assertIsNotNone(resolved_row.resolved_at)
        self.assertIn("reporting again", resolved_row.resolution_note)

    def test_taking_a_device_out_of_service_also_resolves_the_alert(self):
        pump_id = self.pump(last_seen_at=datetime.now(timezone.utc) - timedelta(seconds=OFFLINE_AFTER + 30))
        sweep_connectivity(self.db)
        self.assertIsNotNone(self.open_alert(pump_id))

        self.db.query(Pump).filter(Pump.id == pump_id).update({"lifecycle_state": "RETIRED"})
        self.db.commit()
        _, resolved = sweep_connectivity(self.db)
        self.assertIn(pump_id, [a.pump_id for a in resolved])
        self.assertIsNone(self.open_alert(pump_id))

    def test_stock_and_suspended_devices_are_never_flagged(self):
        for state in ("MANUFACTURED", "IN_STOCK", "ALLOCATED", "SUSPENDED", "RMA", "RETIRED"):
            pid = self.pump(lifecycle_state=state, last_seen_at=datetime.now(timezone.utc) - timedelta(seconds=OFFLINE_AFTER + 30))
            raised, _ = sweep_connectivity(self.db)
            self.assertNotIn(pid, [a.pump_id for a in raised], state)

    def test_only_one_worker_runs_the_sweep_at_a_time(self):
        """A second connection trying to sweep while one already holds the lock does nothing, and does not block."""
        other = SessionLocal()
        try:
            other.execute(text("SELECT pg_advisory_lock(5119207)"))
            raised, resolved = sweep_connectivity(self.db)
            self.assertEqual((raised, resolved), ([], []))
        finally:
            other.execute(text("SELECT pg_advisory_unlock(5119207)"))
            other.rollback()
            other.close()


if __name__ == "__main__":
    unittest.main()
