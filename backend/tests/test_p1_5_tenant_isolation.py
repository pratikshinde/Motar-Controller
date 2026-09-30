import os
import sys
import uuid
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, text
from app.models import User, Pump, DeviceAccess, TelemetryHistory, Command
from app.services.jwt_auth import sign_token, hash_secret

client = TestClient(app)

class TestTenantIsolationNegativeSuite(unittest.TestCase):
    """
    Negative test suite asserting tenant isolation across all endpoints.
    Enforces FR-CLD-042 and SRS §3.2 (Tenant isolation, twice).
    """

    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))

        # 1. Create Tenant A (Farmer A)
        cls.farmer_a_id = uuid.uuid4()
        cls.farmer_a = User(
            id=cls.farmer_a_id,
            phone="+919111111111",
            full_name="Farmer Tenant A",
            role="customer",
            hierarchy_path="/SA/TENANT_A",
            is_active=True,
            is_verified=True
        )
        cls.db.add(cls.farmer_a)

        # 2. Create Tenant B (Farmer B)
        cls.farmer_b_id = uuid.uuid4()
        cls.farmer_b = User(
            id=cls.farmer_b_id,
            phone="+919222222222",
            full_name="Farmer Tenant B",
            role="customer",
            hierarchy_path="/SA/TENANT_B",
            is_active=True,
            is_verified=True
        )
        cls.db.add(cls.farmer_b)
        cls.db.commit()

        # 3. Create Pump A (owned by A) and Pump B (owned by B)
        cls.pump_a_id = f"PUMP-TENANT-A-{uuid.uuid4().hex[:6]}"
        cls.pump_b_id = f"PUMP-TENANT-B-{uuid.uuid4().hex[:6]}"

        cls.pump_a = Pump(
            id=cls.pump_a_id,
            name="Field Pump Tenant A",
            supply_type="3-phase",
            latitude=18.5,
            longitude=73.8,
            owner_user_id=cls.farmer_a_id,
            hierarchy_path="/SA/TENANT_A",
            lifecycle_state="ACTIVE",
            status="STOPPED"
        )
        cls.pump_b = Pump(
            id=cls.pump_b_id,
            name="Field Pump Tenant B",
            supply_type="3-phase",
            latitude=18.6,
            longitude=73.9,
            owner_user_id=cls.farmer_b_id,
            hierarchy_path="/SA/TENANT_B",
            lifecycle_state="ACTIVE",
            status="STOPPED"
        )
        cls.db.add_all([cls.pump_a, cls.pump_b])
        cls.db.commit()

        # 4. Create DeviceAccess mappings
        cls.access_a = DeviceAccess(
            id=uuid.uuid4(),
            user_id=cls.farmer_a_id,
            device_id=cls.pump_a_id,
            role="owner"
        )
        cls.access_b = DeviceAccess(
            id=uuid.uuid4(),
            user_id=cls.farmer_b_id,
            device_id=cls.pump_b_id,
            role="owner"
        )
        cls.db.add_all([cls.access_a, cls.access_b])
        cls.db.commit()

        # 5. Generate JWTs
        cls.token_a = sign_token({"sub": str(cls.farmer_a_id), "role": "customer", "hierarchy_path": "/SA/TENANT_A"})
        cls.token_b = sign_token({"sub": str(cls.farmer_b_id), "role": "customer", "hierarchy_path": "/SA/TENANT_B"})
        cls.headers_a = {"Authorization": f"Bearer {cls.token_a}"}
        cls.headers_b = {"Authorization": f"Bearer {cls.token_b}"}

    @classmethod
    def tearDownClass(cls):
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.db.query(DeviceAccess).filter(DeviceAccess.user_id.in_([cls.farmer_a_id, cls.farmer_b_id])).delete()
        cls.db.query(Pump).filter(Pump.id.in_([cls.pump_a_id, cls.pump_b_id])).delete()
        cls.db.query(User).filter(User.id.in_([cls.farmer_a_id, cls.farmer_b_id])).delete()
        cls.db.commit()
        cls.db.close()

    def test_01_tenant_a_cannot_list_tenant_b_pump(self):
        """Farmer A querying GET /api/v1/pumps must only see Pump A, never Pump B."""
        r = client.get("/api/v1/pumps", headers=self.headers_a)
        self.assertEqual(r.status_code, 200)
        data = r.json().get("data", [])
        visible_ids = [p["id"] for p in data]
        self.assertIn(self.pump_a_id, visible_ids)
        self.assertNotIn(self.pump_b_id, visible_ids)

    def test_02_negative_suite_all_openapi_pump_endpoints(self):
        """
        Dynamically extracts all OpenAPI endpoints containing {id} or {pump_id}.
        Asserts that Tenant A gets HTTP 404 (or 403) when attempting to access Tenant B's pump.
        """
        openapi_schema = app.openapi()
        tested_routes = 0

        for path, path_item in openapi_schema.get("paths", {}).items():
            if not ("/pumps/{" in path or "/pumps/v1/{" in path):
                continue

            # Target Tenant B's pump id and fill any nested route params
            test_path = (
                path.replace("{id}", self.pump_b_id)
                .replace("{pump_id}", self.pump_b_id)
                .replace("{fault_id}", "1")
                .replace("{command_id}", str(uuid.uuid4()))
            )

            for method, operation in path_item.items():
                if method.lower() not in ["get", "post", "put", "delete", "patch"]:
                    continue

                tested_routes += 1
                req_fn = getattr(client, method.lower())

                kwargs = {"headers": self.headers_a}
                if method.lower() in ["post", "put", "patch"]:
                    if "/timer" in path:
                        kwargs["json"] = {"on_duration_minutes": 15, "off_duration_minutes": 0, "mode": "ON_TIMER"}
                    elif "/lifecycle" in path:
                        kwargs["json"] = {"lifecycle_state": "SUSPENDED"}
                    elif "/location" in path:
                        kwargs["json"] = {"latitude": 19.0, "longitude": 73.0}
                    elif "/warranty" in path:
                        now_str = datetime.now(timezone.utc).isoformat()
                        kwargs["json"] = {"warranty_start_at": now_str, "warranty_end_at": now_str}
                    elif "/swap" in path:
                        kwargs["json"] = {"new_device_id": "NEW-DEV-001", "reason": "Defective hardware"}
                    elif "/template" in path:
                        kwargs["json"] = {"template_id": str(uuid.uuid4())}
                    elif "/panel" in path:
                        kwargs["json"] = {"panel_serial": "PNL-9999"}
                    else:
                        kwargs["json"] = {"action_name": "START", "action": "START", "command": "START", "payload": {}}

                r = req_fn(test_path, **kwargs)

                # Must return 404 (Not Found / out of scope) or 403 (Forbidden)
                self.assertIn(
                    r.status_code,
                    [404, 403],
                    f"Tenant A accessed Tenant B resource at {method.upper()} {test_path}! Status: {r.status_code}, Body: {r.text}"
                )
                print(f"  [PASS] {method.upper()} {test_path} -> HTTP {r.status_code} (access denied/isolated)")

        self.assertGreater(tested_routes, 0, "Expected at least 1 pump route in OpenAPI")
        print(f"\n[PASS] Verified {tested_routes} OpenAPI endpoints dynamically against cross-tenant access.")

    def test_03_rls_works_when_repository_filter_bypassed(self):
        """
        Acceptance: Disabling the repository filter in a test still returns nothing (RLS works).
        Simulates an engineer running raw db.query(Pump) with no WHERE clause.
        """
        db = SessionLocal()
        try:
            # Set actor context for Tenant A and ensure bypass is strictly off
            db.execute(text("SET app.bypass_rls = 'off';"))
            db.execute(text(f"SET app.user_id = '{self.farmer_a_id}';"))
            db.execute(text("SET app.user_role = 'customer';"))

            # Bypassed query: raw SELECT * FROM pumps with NO owner/tenant filter
            raw_pumps = db.query(Pump).all()
            visible_ids = [p.id for p in raw_pumps]

            # RLS at the database engine level MUST hide Pump B!
            self.assertIn(self.pump_a_id, visible_ids, "Tenant A should see their own pump")
            self.assertNotIn(self.pump_b_id, visible_ids, "Postgres RLS MUST block Tenant B's pump even with NO repository filter!")
            print(f"\n[PASS] Acceptance criteria verified: Raw query without repository filter returned {len(visible_ids)} pumps; Tenant B's pump was completely blocked by Postgres RLS!")
        finally:
            db.close()

if __name__ == "__main__":
    unittest.main()
