"""Moving an admin, with their people, pumps and factory batches, from a brand made by a different company name to the right brand."""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text

from app.models import AppBrand, DeviceBatch, Pump, User
from move_admin_to_brand import MoveError, move  # noqa: E402
from test_web_portal_hardening import MfaBase  # noqa: E402
from test_web_portal_users import _partner  # noqa: E402


class TestMoveAdminToBrand(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.keys, cls.pumps, cls.batches = [], [], []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            for b in cls.batches:
                cls.db.query(DeviceBatch).filter(DeviceBatch.id == b).delete(synchronize_session=False)
            if cls.pumps:
                cls.db.execute(text("DELETE FROM agripump.device_configs WHERE pump_id = ANY(:ids)"), {"ids": cls.pumps})
                cls.db.query(Pump).filter(Pump.id.in_(cls.pumps)).delete(synchronize_session=False)
            cls.db.commit()
        except Exception:
            cls.db.rollback()
        finally:
            super().tearDownClass()
            from app.database import SessionLocal

            db = SessionLocal()
            try:
                db.execute(text("SET app.bypass_rls = 'on';"))
                db.query(AppBrand).filter(AppBrand.key.in_(cls.keys)).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

    def brand(self, owner=None, android=None):
        key = f"mv{uuid.uuid4().hex[:8]}"
        b = AppBrand(key=key, name=key, short_name=key.upper(), status="ACTIVE", features={}, owner_user_id=owner.id if owner else None, android_package=android,
                     support_phone="+919000000000")
        self.db.add(b)
        self.db.commit()
        type(self).keys.append(key)
        return b

    def world(self):
        """An admin whose own brand 'wrong' holds a pump, a batch and a farmer; a free brand 'right'."""
        sa = _partner(self, "superadmin", "mv-sa")
        admin = _partner(self, "manufacturer", "mv-admin", parent=sa)
        admin.email = f"mv-{uuid.uuid4().hex[:8]}@example.com"
        wrong = self.brand(owner=admin)
        admin.brand_id = wrong.id
        farmer = self.make_user("customer", "mv-farmer")
        farmer = self.db.query(User).filter(User.id == farmer.id).one()
        farmer.brand_id = None
        pid = f"MV-{uuid.uuid4().hex[:8].upper()}"
        self.db.add(Pump(id=pid, name="p", device_type="AC_3PH", supply_type="3-phase", hp_rating=5, owner_user_id=admin.id, hierarchy_path=admin.hierarchy_path,
                         status="STOPPED", lifecycle_state="MANUFACTURED", brand_id=wrong.id))
        batch = DeviceBatch(id=uuid.uuid4(), batch_code=f"MVB-{uuid.uuid4().hex[:6]}", model="m", hw_rev="1", quantity=1, created_by=admin.id, brand_id=wrong.id)
        self.db.add(batch)
        self.db.commit()
        type(self).pumps.append(pid)
        type(self).batches.append(batch.id)
        right = self.brand()
        return admin, wrong, right, pid, batch

    def test_a_dry_run_says_what_would_move_and_changes_nothing(self):
        admin, wrong, right, pid, batch = self.world()
        r = move(self.db, admin.email, right.key, apply=False)
        self.assertFalse(r["applied"])
        self.assertEqual((r["from"], r["to"], r["pumps"], r["batches"]), (wrong.key, right.key, 1, 1))
        self.db.expire_all()
        self.assertEqual(self.db.query(Pump).filter(Pump.id == pid).one().brand_id, wrong.id)
        self.assertEqual(self.db.query(AppBrand).filter(AppBrand.key == right.key).one().owner_user_id, None)

    def test_apply_moves_the_admin_the_pump_and_the_batch_and_removes_the_empty_brand(self):
        admin, wrong, right, pid, batch = self.world()
        wrong_id, right_id = wrong.id, right.id
        r = move(self.db, admin.email, right.key, apply=True)
        self.assertTrue(r["applied"])
        self.db.expire_all()
        self.assertEqual(self.db.query(AppBrand).filter(AppBrand.key == right.key).one().owner_user_id, admin.id)
        self.assertEqual(self.db.query(User).filter(User.id == admin.id).one().brand_id, right_id)
        self.assertEqual(self.db.query(Pump).filter(Pump.id == pid).one().brand_id, right_id)
        self.assertEqual(self.db.query(DeviceBatch).filter(DeviceBatch.id == batch.id).one().brand_id, right_id)
        self.assertIsNone(self.db.query(AppBrand).filter(AppBrand.id == wrong_id).first(), "the empty old brand is gone")

    def test_it_can_keep_the_old_brand(self):
        admin, wrong, right, pid, batch = self.world()
        move(self.db, admin.email, right.key, apply=True, remove_old=False)
        self.db.expire_all()
        old = self.db.query(AppBrand).filter(AppBrand.key == wrong.key).first()
        self.assertIsNotNone(old)
        self.assertIsNone(old.owner_user_id)

    def test_a_brand_that_already_has_another_admin_is_refused_and_nothing_changes(self):
        admin, wrong, right, pid, batch = self.world()
        other = _partner(self, "manufacturer", "mv-other")
        right.owner_user_id = other.id
        self.db.commit()
        with self.assertRaisesRegex(MoveError, "another admin"):
            move(self.db, admin.email, right.key, apply=True)
        self.db.expire_all()
        self.assertEqual(self.db.query(Pump).filter(Pump.id == pid).one().brand_id, wrong.id)

    def test_a_brand_with_an_app_of_its_own_is_never_moved_away_from(self):
        admin, wrong, right, pid, batch = self.world()
        wrong.android_package = "com.example.real"
        self.db.commit()
        with self.assertRaisesRegex(MoveError, "Android app of its own"):
            move(self.db, admin.email, right.key, apply=True)

    def test_an_unknown_email_brand_or_the_same_brand_is_refused(self):
        admin, wrong, right, pid, batch = self.world()
        with self.assertRaisesRegex(MoveError, "No admin"):
            move(self.db, "nobody@example.com", right.key)
        with self.assertRaisesRegex(MoveError, "no brand"):
            move(self.db, admin.email, "no-such-brand")
        with self.assertRaisesRegex(MoveError, "already on the brand"):
            move(self.db, admin.email, wrong.key)


if __name__ == "__main__":
    unittest.main()
