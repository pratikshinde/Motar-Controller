"""scripts/set_brand_features.py: dry run changes nothing, --apply saves, bad input is refused. Local development database."""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import SessionLocal
from app.models import AppBrand
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import set_brand_features as tool  # noqa: E402


class TestSetBrandFeatures(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.brand = AppBrand(key=f"t{uuid.uuid4().hex[:8]}", name="Test", features={"push": False, "hierarchy": "full"}, status="ACTIVE")
        self.db.add(self.brand)
        self.db.commit()

    def tearDown(self):
        self.db.rollback()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(AppBrand).filter(AppBrand.id == self.brand.id).delete()
        self.db.commit()
        self.db.close()

    def stored(self):
        self.db.expire_all()
        return dict(self.db.query(AppBrand).filter(AppBrand.id == self.brand.id).one().features)

    def test_a_dry_run_changes_nothing(self):
        before, after = tool.change(self.db, self.brand.key, {"hierarchy": "admin_users"}, [], apply=False)
        self.assertEqual(after["hierarchy"], "admin_users")
        self.assertEqual(self.stored()["hierarchy"], "full")

    def test_apply_saves_and_keeps_the_other_settings(self):
        tool.change(self.db, self.brand.key, {"hierarchy": "admin_users", "admin_login": "email_code"}, [], apply=True)
        saved = self.stored()
        self.assertEqual(saved, {"push": False, "hierarchy": "admin_users", "admin_login": "email_code"})

    def test_unset_removes_a_rule(self):
        tool.change(self.db, self.brand.key, {}, ["hierarchy"], apply=True)
        self.assertNotIn("hierarchy", self.stored())

    def test_unknown_brand_and_bad_values_are_refused(self):
        with self.assertRaises(LookupError):
            tool.change(self.db, "no-such-brand", {}, [], apply=True)
        with self.assertRaises(ValueError):
            tool.parse_sets(["hierarchy=everybody"])
        with self.assertRaises(ValueError):
            tool.parse_sets(["justaword"])
        self.assertEqual(tool.parse_sets(["push=false", "x=y"]), {"push": False, "x": "y"})


if __name__ == "__main__":
    unittest.main()
