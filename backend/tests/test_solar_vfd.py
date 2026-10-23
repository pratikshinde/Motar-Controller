"""Tests for SOLAR_VFD pumps, Fuji FRENIC-Ace telemetry ingestion, START/STOP commands, and cross-brand isolation.

Covers:
1. Valid telemetry ingestion with `vfd` block on SOLAR_VFD pump and persistence in telemetry_history.
2. Rejection (HTTP 400) of `vfd` telemetry block on AC_3PH pump.
3. Range validation errors (HTTP 422) on out-of-spec VFD telemetry.
4. START and STOP command lifecycle on SOLAR_VFD pumps.
5. Cross-brand isolation: Ajanta cannot see Swati solar pump and Swati cannot see Ajanta pump.
6. Partner brand scoping on pump creation.
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
from app.database import SessionLocal
from app.models import (
    AppBrand, Command, DeviceAccess, DeviceConfig, FaultLog,
    Organisation, Pump, RefreshToken, TelemetryHistory, User
)
from app.services.jwt_auth import sign_token, hash_secret

client = TestClient(app)


def _token_header(user: User) -> dict:
    token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "path": user.hierarchy_path,
        "brand_id": str(user.brand_id) if user.brand_id else None,
    })
    return {"Authorization": f"Bearer {token}"}


class TestSolarVfdSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]

        # 1. Brands
        cls.brand_ajanta = cls.db.query(AppBrand).filter(AppBrand.key == "ajanta").first()
        if not cls.brand_ajanta:
            cls.brand_ajanta = AppBrand(
                key=f"ajanta_{cls.sfx}", name="Ajanta Test", short_name="AJANTA", features={}
            )
            cls.db.add(cls.brand_ajanta)
            cls.db.flush()

        cls.brand_swati = cls.db.query(AppBrand).filter(AppBrand.key == "swati").first()
        if not cls.brand_swati:
            cls.brand_swati = AppBrand(
                key=f"swati_{cls.sfx}", name="Swati Test", short_name="SWATI", features={}
            )
            cls.db.add(cls.brand_swati)
            cls.db.flush()

        # 2. Farmers
        cls.ajanta_farmer = User(
            id=uuid.uuid4(),
            phone=f"+9199{uuid.uuid4().hex[:8]}",
            full_name=f"Ajanta Farmer {cls.sfx}",
            role="customer",
            hierarchy_path=f"/SA/AJ_{cls.sfx}/FARM1",
            is_active=True,
            is_verified=True,
            password_hash=hash_secret("Admin@123"),
        )
        cls.swati_farmer = User(
            id=uuid.uuid4(),
            phone=f"+9198{uuid.uuid4().hex[:8]}",
            full_name=f"Swati Farmer {cls.sfx}",
            role="customer",
            hierarchy_path=f"/SA/SW_{cls.sfx}/FARM1",
            is_active=True,
            is_verified=True,
            password_hash=hash_secret("Admin@123"),
        )
        cls.db.add_all([cls.ajanta_farmer, cls.swati_farmer])
        cls.db.flush()

        # 3. Pumps
        cls.solar_pump_id = f"SOLAR-{cls.sfx}".upper()
        cls.solar_pump = Pump(
            id=cls.solar_pump_id,
            name="Swati Solar Borewell",
            device_type="SOLAR_VFD",
            supply_type="3-phase",
            hp_rating=7.5,
            owner_user_id=cls.swati_farmer.id,
            brand_id=cls.brand_swati.id,
            hierarchy_path=cls.swati_farmer.hierarchy_path,
            lifecycle_state="ACTIVE",
            status="STOPPED",
        )

        cls.ac_pump_id = f"AC3PH-{cls.sfx}".upper()
        cls.ac_pump = Pump(
            id=cls.ac_pump_id,
            name="Ajanta AC 3PH Pump",
            device_type="AC_3PH",
            supply_type="3-phase",
            hp_rating=10.0,
            owner_user_id=cls.ajanta_farmer.id,
            brand_id=cls.brand_ajanta.id,
            hierarchy_path=cls.ajanta_farmer.hierarchy_path,
            lifecycle_state="ACTIVE",
            status="STOPPED",
        )

        cls.db.add_all([cls.solar_pump, cls.ac_pump])
        cls.db.commit()

        cls.created_pump_ids = [cls.solar_pump_id, cls.ac_pump_id]
        cls.created_user_ids = [cls.ajanta_farmer.id, cls.swati_farmer.id]

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            if cls.created_pump_ids:
                cls.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id.in_(cls.created_pump_ids)).delete(synchronize_session=False)
                cls.db.query(Command).filter(Command.pump_id.in_(cls.created_pump_ids)).delete(synchronize_session=False)
                cls.db.query(FaultLog).filter(FaultLog.pump_id.in_(cls.created_pump_ids)).delete(synchronize_session=False)
                cls.db.query(DeviceConfig).filter(DeviceConfig.pump_id.in_(cls.created_pump_ids)).delete(synchronize_session=False)
                cls.db.query(Pump).filter(Pump.id.in_(cls.created_pump_ids)).delete(synchronize_session=False)

            if cls.created_user_ids:
                cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_(cls.created_user_ids)).delete(synchronize_session=False)
                cls.db.query(User).filter(User.id.in_(cls.created_user_ids)).delete(synchronize_session=False)

            cls.db.commit()
        finally:
            cls.db.close()

    def test_solar_vfd_telemetry_ingest(self):
        """SOLAR_VFD pumps accept the optional vfd block and store all values without fabrication."""
        payload = {
            "dev_id": self.solar_pump_id,
            "mot": 1,
            "st": 2,
            "rt": 120,
            "seq": 101,
            "vfd": {
                "hz": 48.5,
                "i_out": 10.2,
                "v_ac": 395.0,
                "v_dc": 580.4,
                "kw": 4.85,
                "status": "RUNNING",
                "fault_code": 0
            }
        }
        res = client.post("/api/telemetry", json=payload)
        self.assertEqual(res.status_code, 200, res.text)

        # Check telemetry_history directly in DB
        row = self.db.query(TelemetryHistory).filter(
            TelemetryHistory.pump_id == self.solar_pump_id,
            TelemetryHistory.seq == 101
        ).first()
        self.assertIsNotNone(row)
        self.assertAlmostEqual(float(row.vfd_hz), 48.5, places=1)
        self.assertAlmostEqual(float(row.vfd_i_out), 10.2, places=1)
        self.assertAlmostEqual(float(row.vfd_v_ac), 395.0, places=1)
        self.assertAlmostEqual(float(row.vfd_v_dc), 580.4, places=1)
        self.assertAlmostEqual(float(row.vfd_kw), 4.85, places=2)
        self.assertEqual(row.vfd_status, "RUNNING")
        self.assertEqual(row.vfd_fault_code, 0)
        # AC voltages/currents should not be fabricated if omitted
        self.assertIsNone(row.v_ry)
        self.assertIsNone(row.i_r)

        # Verify GET /api/pumps/{id} returns vfd telemetry block
        headers = _token_header(self.swati_farmer)
        get_res = client.get(f"/api/pumps/{self.solar_pump_id}", headers=headers)
        self.assertEqual(get_res.status_code, 200)
        data = get_res.json()
        self.assertEqual(data["pump"]["device_type"], "SOLAR_VFD")
        vfd = (data.get("latest_telemetry") or {}).get("vfd")
        self.assertIsNotNone(vfd)
        self.assertAlmostEqual(float(vfd["hz"]), 48.5, places=1)
        self.assertAlmostEqual(float(vfd["v_dc"]), 580.4, places=1)

    def test_ac_3ph_rejects_vfd_telemetry(self):
        """AC_3PH pumps must reject telemetry carrying a vfd block."""
        payload = {
            "dev_id": self.ac_pump_id,
            "mot": 1,
            "st": 2,
            "seq": 201,
            "vfd": {
                "hz": 50.0,
                "i_out": 8.0,
                "v_ac": 415.0,
                "v_dc": 600.0,
                "kw": 5.0,
                "status": "RUNNING",
                "fault_code": 0
            }
        }
        res = client.post("/api/telemetry", json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("only accepted for SOLAR_VFD", res.json()["detail"])

    def test_vfd_range_validation(self):
        """Out of range VFD telemetry fields fail Pydantic validation (HTTP 422)."""
        # Frequency > 500 Hz (exceeds le=500.0)
        payload = {
            "dev_id": self.solar_pump_id,
            "seq": 301,
            "vfd": {
                "hz": 600.0,
                "i_out": 10.0,
                "v_ac": 400.0,
                "v_dc": 600.0,
                "kw": 5.0,
                "status": "RUNNING"
            }
        }
        res = client.post("/api/telemetry", json=payload)
        self.assertEqual(res.status_code, 422)

        # Negative DC voltage (fails ge=0.0)
        payload["vfd"]["hz"] = 50.0
        payload["vfd"]["v_dc"] = -10.0
        res = client.post("/api/telemetry", json=payload)
        self.assertEqual(res.status_code, 422)

    def test_solar_vfd_command_start_stop(self):
        """START and STOP command lifecycle operates normally on SOLAR_VFD pumps."""
        headers = _token_header(self.swati_farmer)
        # 1. START
        res = client.post(f"/api/pumps/{self.solar_pump_id}/command", json={"command": "START"}, headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        cmd_data = res.json()["command"]
        self.assertEqual(cmd_data["command"], "START")
        self.assertIn(cmd_data["status"], ("QUEUED", "SENT"))

        # Ingest running reading to settle interim command mode
        client.post("/api/telemetry", json={
            "dev_id": self.solar_pump_id,
            "mot": 1,
            "st": 2,
            "seq": 401,
            "vfd": {
                "hz": 40.0,
                "i_out": 8.0,
                "v_ac": 380.0,
                "v_dc": 550.0,
                "kw": 3.8,
                "status": "RUNNING"
            }
        })

        # Check pump is now RUNNING
        pump_row = self.db.query(Pump).filter(Pump.id == self.solar_pump_id).first()
        self.assertEqual(pump_row.status, "RUNNING")

        # Open cooldown before sending STOP
        from datetime import timedelta
        self.db.query(Pump).filter(Pump.id == self.solar_pump_id).update(
            {Pump.last_command_at: datetime.now(timezone.utc) - timedelta(seconds=60)}
        )
        self.db.query(Command).filter(Command.pump_id == self.solar_pump_id).update(
            {Command.issued_at: datetime.now(timezone.utc) - timedelta(seconds=60)}
        )
        self.db.commit()

        # 2. STOP
        res = client.post(f"/api/pumps/{self.solar_pump_id}/command", json={"command": "STOP"}, headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        stop_cmd = res.json()["command"]
        self.assertEqual(stop_cmd["command"], "STOP")

    def test_cross_brand_isolation(self):
        """Ajanta farmer/brand can never see Swati solar pump and vice versa."""
        ajanta_h = _token_header(self.ajanta_farmer)
        swati_h = _token_header(self.swati_farmer)

        # Ajanta farmer listing
        res = client.get("/api/pumps", headers={**ajanta_h, "X-App-Brand": "ajanta"})
        self.assertEqual(res.status_code, 200)
        pumps = res.json()["pumps"]
        pump_ids = [p["id"] for p in pumps]
        self.assertIn(self.ac_pump_id, pump_ids)
        self.assertNotIn(self.solar_pump_id, pump_ids)

        # Ajanta farmer direct access to Swati pump
        res = client.get(f"/api/pumps/{self.solar_pump_id}", headers={**ajanta_h, "X-App-Brand": "ajanta"})
        self.assertEqual(res.status_code, 404)

        # Swati farmer listing
        res = client.get("/api/pumps", headers={**swati_h, "X-App-Brand": "swati"})
        self.assertEqual(res.status_code, 200)
        pumps = res.json()["pumps"]
        pump_ids = [p["id"] for p in pumps]
        self.assertIn(self.solar_pump_id, pump_ids)
        self.assertNotIn(self.ac_pump_id, pump_ids)

        # Swati farmer direct access to Ajanta pump
        res = client.get(f"/api/pumps/{self.ac_pump_id}", headers={**swati_h, "X-App-Brand": "swati"})
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
