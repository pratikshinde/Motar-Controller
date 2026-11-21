"""scripts/add_solar_logger.py: a dry run changes nothing, --apply creates a SOLAR_VFD device for the admin's brand, bad input is refused."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from app.models import DeviceConfig, Pump
from test_brand_hierarchy import BrandBase  # noqa: E402
import add_solar_logger as tool  # noqa: E402

IMEI = "862818041287022"


class TestAddSolarLogger(BrandBase):
    def setUp(self):
        super().setUp() if hasattr(super(), "setUp") else None
        self.db.query(Pump).filter(Pump.id == IMEI).delete()
        self.db.commit()
        self.brand = self.make_brand(admin_login="email_code", hierarchy="admin_users")
        self.admin = self.admin_in(self.brand)

    def tearDown(self):
        self.db.rollback()
        self.db.query(Pump).filter(Pump.id == IMEI).delete()
        self.db.commit()

    def pump(self):
        self.db.expire_all()
        return self.db.query(Pump).filter(Pump.id == IMEI).first()

    def test_a_dry_run_creates_nothing(self):
        msg = tool.add_logger(self.db, IMEI, self.admin.email)
        self.assertTrue(msg.startswith("Would create"))
        self.assertIsNone(self.pump())

    def test_apply_creates_a_solar_device_in_the_admins_tree_and_brand(self):
        tool.add_logger(self.db, IMEI, self.admin.email.upper(), apply=True)
        p = self.pump()
        self.assertEqual((p.device_type, p.owner_user_id, p.brand_id, p.hierarchy_path), ("SOLAR_VFD", self.admin.id, self.brand.id, self.admin.hierarchy_path))
        self.assertIsNone(p.last_seen_at, "creating it is not seeing it")
        self.assertIsNotNone(self.db.query(DeviceConfig).filter(DeviceConfig.pump_id == IMEI).first())

    def test_refusals(self):
        with self.assertRaises(ValueError):
            tool.add_logger(self.db, "12345", self.admin.email)
        with self.assertRaises(ValueError):
            tool.add_logger(self.db, IMEI, "nobody@example.com")
        tool.add_logger(self.db, IMEI, self.admin.email, apply=True)
        with self.assertRaises(ValueError):
            tool.add_logger(self.db, IMEI, self.admin.email, apply=True)

    def test_only_an_admin_may_own_it(self):
        customer = self.account("customer", "cus", brand_id=self.brand.id)
        if customer.email:
            with self.assertRaises(ValueError):
                tool.add_logger(self.db, IMEI, customer.email)


if __name__ == "__main__":
    unittest.main()
