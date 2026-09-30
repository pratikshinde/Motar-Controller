import sys
import os
import unittest
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import app
from app.database import SessionLocal
from app.models import DeviceBatch, BatchImei, Pump, User

client = TestClient(app)

class TestP2_1FleetProvisioning(unittest.TestCase):
    """
    Test suite for P2.1 AWS IoT Fleet Provisioning and Pre-Provisioning Hook (SRS §5.2.1, FR-SEC-030-034).
    """

    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.suffix = uuid.uuid4().hex[:6]

        # 0. Create batch creator user
        cls.creator = User(
            id=uuid.uuid4(),
            full_name=f"Batch Creator {cls.suffix}",
            phone=f"+91986{cls.suffix[:7]}",
            role="manufacturer",
            hierarchy_path="/SA",
            account_status="ACTIVE"
        )
        cls.db.add(cls.creator)
        cls.db.commit()

        # 1. Create a valid device batch
        cls.batch_valid = DeviceBatch(
            id=uuid.uuid4(),
            batch_code=f"BATCH-VALID-{cls.suffix}",
            model="AgriPump 4G 3P",
            hw_rev="1.0",
            quantity=10,
            created_by=cls.creator.id
        )
        cls.db.add(cls.batch_valid)

        # 2. Create a revoked device batch
        cls.batch_revoked = DeviceBatch(
            id=uuid.uuid4(),
            batch_code=f"BATCH-REVOKED-{cls.suffix}",
            model="AgriPump 4G 3P",
            hw_rev="1.0",
            quantity=5,
            created_by=cls.creator.id,
            revoked=True,
            revoked_at=datetime.now(timezone.utc)
        )
        cls.db.add(cls.batch_revoked)
        cls.db.commit()

        # Whitelist IMEI in valid batch
        cls.valid_serial = f"8600123456{cls.suffix[:4]}"
        cls.imei_valid = BatchImei(
            batch_id=cls.batch_valid.id,
            imei=cls.valid_serial,
            claimed=False
        )
        cls.db.add(cls.imei_valid)

        # Whitelist IMEI in revoked batch
        cls.revoked_serial = f"8600999999{cls.suffix[:4]}"
        cls.imei_revoked = BatchImei(
            batch_id=cls.batch_revoked.id,
            imei=cls.revoked_serial,
            claimed=False
        )
        cls.db.add(cls.imei_revoked)

        cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            pump_id = f"PUMP-{cls.valid_serial}"
            cls.db.query(Pump).filter(Pump.id == pump_id).delete()
            cls.db.query(BatchImei).filter(BatchImei.batch_id.in_([cls.batch_valid.id, cls.batch_revoked.id])).delete()
            cls.db.query(DeviceBatch).filter(DeviceBatch.id.in_([cls.batch_valid.id, cls.batch_revoked.id])).delete()
            cls.db.commit()
        finally:
            cls.db.close()

    def test_01_pre_provisioning_hook_valid_device(self):
        """Valid whitelisted device serial should be granted provisioning and commissioned."""
        payload = {
            "claimCertificateId": "claim-cert-mock-123",
            "certificateId": "target-cert-mock-456",
            "parameters": {
                "SerialNumber": self.valid_serial,
                "DeviceModel": "AgriPump 4G 3P"
            }
        }
        resp = client.post("/api/v1/batches/provisioning/pre-hook", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertTrue(data["allowProvisioning"])
        self.assertEqual(data["parameterOverrides"]["ThingName"], f"PUMP-{self.valid_serial}")
        self.assertEqual(data["parameterOverrides"]["ThingGroupName"], "production")

        # Verify device record is created in state COMMISSIONED
        pump = self.db.query(Pump).filter(Pump.id == f"PUMP-{self.valid_serial}").first()
        self.assertIsNotNone(pump)
        self.assertEqual(pump.lifecycle_state, "COMMISSIONED")
        print(f"\n[PASS] Pre-provisioning hook approved valid device {self.valid_serial} and commissioned {pump.id}!")

    def test_02_pre_provisioning_hook_replay_already_claimed(self):
        """Device serial that has already been claimed must be rejected."""
        payload = {
            "claimCertificateId": "claim-cert-mock-123",
            "certificateId": "target-cert-mock-789",
            "parameters": {
                "SerialNumber": self.valid_serial,
                "DeviceModel": "AgriPump 4G 3P"
            }
        }
        resp = client.post("/api/v1/batches/provisioning/pre-hook", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertFalse(data["allowProvisioning"])
        self.assertIn("already been claimed", data.get("error", ""))
        print(f"[PASS] Replay rejected: Claimed device {self.valid_serial} rejected from re-provisioning!")

    def test_03_pre_provisioning_hook_revoked_batch(self):
        """Device serial from a revoked batch must be rejected."""
        payload = {
            "claimCertificateId": "claim-cert-mock-123",
            "certificateId": "target-cert-mock-000",
            "parameters": {
                "SerialNumber": self.revoked_serial,
                "DeviceModel": "AgriPump 4G 3P"
            }
        }
        resp = client.post("/api/v1/batches/provisioning/pre-hook", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertFalse(data["allowProvisioning"])
        self.assertIn("revoked", data.get("error", ""))
        print(f"[PASS] Revocation guard: Serial {self.revoked_serial} from revoked batch denied provisioning!")

    def test_04_pre_provisioning_hook_unknown_serial(self):
        """Unknown device serial not present in any batch must be rejected."""
        payload = {
            "claimCertificateId": "claim-cert-mock-123",
            "certificateId": "target-cert-mock-000",
            "parameters": {
                "SerialNumber": "860000000000000",
                "DeviceModel": "Unknown"
            }
        }
        resp = client.post("/api/v1/batches/provisioning/pre-hook", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertFalse(data["allowProvisioning"])
        self.assertIn("not in factory whitelist", data.get("error", ""))
        print("[PASS] Unknown device blocked: Unwhitelisted serial denied provisioning!")

if __name__ == "__main__":
    unittest.main()
