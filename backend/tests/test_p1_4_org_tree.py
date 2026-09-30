import os
import sys
import uuid
import unittest
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.database import SessionLocal, text
from app.models import User, Pump, Organisation, DeviceAccess

class TestOrgTreeAndDeviceAccess(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.execute(text("SET app.bypass_rls = 'on';"))

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def test_01_dealer_depth_limit_and_cycle_guard(self):
        """Test dealer depth <= 6 and explicit error when creating 7th level, plus cycle prevention."""
        root = self.db.query(Organisation).filter(Organisation.depth == 0).first()
        self.assertIsNotNone(root, "Root organisation must exist")

        chain_orgs = []
        current_parent_id = root.id

        # Create dealer levels 1 through 6
        for d in range(1, 7):
            new_org = Organisation(
                id=uuid.uuid4(),
                parent_id=current_parent_id,
                type="dealer",
                name=f"Automated Test Dealer Level {d}"
            )
            self.db.add(new_org)
            self.db.commit()
            self.db.refresh(new_org)

            self.assertEqual(new_org.depth, d, f"Expected depth {d}, got {new_org.depth}")
            chain_orgs.append(new_org)
            current_parent_id = new_org.id

        # Attempt to create 7th level -> MUST FAIL with documented error
        level_7_org = Organisation(
            id=uuid.uuid4(),
            parent_id=current_parent_id,
            type="dealer",
            name="Automated Test Dealer Level 7 (Illegal)"
        )
        self.db.add(level_7_org)
        with self.assertRaises(Exception) as ctx:
            self.db.commit()
        
        err_msg = str(ctx.exception)
        self.assertIn("Dealer depth cannot exceed 6 levels", err_msg)
        self.db.rollback()

        # Clean up test chain
        for org in reversed(chain_orgs):
            self.db.execute(text("DELETE FROM agripump.organisations WHERE id = :id"), {"id": org.id})
        self.db.commit()

    def test_02_farmer_multi_dealer_device_access(self):
        """Acceptance: A farmer can have devices from two dealers, and each device shows its own dealer."""
        root = self.db.query(Organisation).filter(Organisation.depth == 0).first()

        # 1. Create two separate dealers
        dealer_a = Organisation(
            id=uuid.uuid4(),
            parent_id=root.id,
            type="dealer",
            name="Kisan Sahay Kendra (Dealer A)"
        )
        dealer_b = Organisation(
            id=uuid.uuid4(),
            parent_id=root.id,
            type="dealer",
            name="Krishi Vikas Kendra (Dealer B)"
        )
        self.db.add_all([dealer_a, dealer_b])
        self.db.commit()

        # 2. Create farmer user
        farmer_id = uuid.uuid4()
        farmer = User(
            id=farmer_id,
            phone="+919888877777",
            full_name="Gopal Rao (Multi-dealer Farmer)",
            role="customer",
            hierarchy_path="/SA/TEST"
        )
        self.db.add(farmer)
        self.db.commit()

        # 3. Create two pumps, one belonging to Dealer A, one to Dealer B
        pump_a_id = f"PUMP-DEALER-A-{uuid.uuid4().hex[:6]}"
        pump_b_id = f"PUMP-DEALER-B-{uuid.uuid4().hex[:6]}"

        pump_a = Pump(
            id=pump_a_id,
            name="North Borewell (from Dealer A)",
            owner_user_id=farmer.id,
            org_id=dealer_a.id,
            hierarchy_path=str(dealer_a.path),
            lifecycle_state="ACTIVE",
            latitude=19.0,
            longitude=73.0
        )
        pump_b = Pump(
            id=pump_b_id,
            name="South River Pump (from Dealer B)",
            owner_user_id=farmer.id,
            org_id=dealer_b.id,
            hierarchy_path=str(dealer_b.path),
            lifecycle_state="ACTIVE",
            latitude=19.1,
            longitude=73.1
        )
        self.db.add_all([pump_a, pump_b])
        self.db.commit()

        # 4. Grant farmer access to both pumps via device_access
        access_a = DeviceAccess(
            user_id=farmer.id,
            device_id=pump_a.id,
            role="owner",
            nickname="North Borewell",
            sort_order=1
        )
        access_b = DeviceAccess(
            user_id=farmer.id,
            device_id=pump_b.id,
            role="owner",
            nickname="South River",
            sort_order=2
        )
        self.db.add_all([access_a, access_b])
        self.db.commit()

        # 5. Query devices accessible to farmer
        accessible_devices = (
            self.db.query(Pump, DeviceAccess, Organisation)
            .join(DeviceAccess, DeviceAccess.device_id == Pump.id)
            .join(Organisation, Organisation.id == Pump.org_id)
            .filter(DeviceAccess.user_id == farmer.id)
            .all()
        )

        self.assertEqual(len(accessible_devices), 2)
        device_dealer_map = {pump.id: org.name for pump, da, org in accessible_devices}

        self.assertEqual(device_dealer_map[pump_a.id], "Kisan Sahay Kendra (Dealer A)")
        self.assertEqual(device_dealer_map[pump_b.id], "Krishi Vikas Kendra (Dealer B)")
        print(f"\n[PASS] Verified Farmer can hold devices from two dealers: {device_dealer_map}")

        # Clean up
        self.db.query(DeviceAccess).filter(DeviceAccess.user_id == farmer.id).delete()
        self.db.query(Pump).filter(Pump.id.in_([pump_a_id, pump_b_id])).delete()
        self.db.query(User).filter(User.id == farmer.id).delete()
        self.db.query(Organisation).filter(Organisation.id.in_([dealer_a.id, dealer_b.id])).delete()
        self.db.commit()

if __name__ == "__main__":
    unittest.main()
