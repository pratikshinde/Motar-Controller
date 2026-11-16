"""Switching off and removing people: only someone above, only below them in their own branch, always with a reason (kept in the log), and a permanent removal
also needs the person's name typed in and is refused while anyone or any pump is still under them. Runs against the local development database."""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app
from app.models import AppBrand, AuditLog, Pump, RefreshToken, User
from test_web_portal_users import _h, _partner  # noqa: E402
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)

client = TestClient(app)
API = "/api/v1/users"
REASON = "Registered by mistake"


class RemoveBase(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.pump_ids = []
        cls.brand_keys = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(__import__("sqlalchemy").text("SET app.bypass_rls = 'on';"))
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            super().tearDownClass()
            from app.database import SessionLocal

            db = SessionLocal()
            try:
                db.execute(__import__("sqlalchemy").text("SET app.bypass_rls = 'on';"))
                db.query(AppBrand).filter(AppBrand.key.in_(cls.brand_keys)).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

    def setUp(self):
        cls = type(self)
        if getattr(cls, "sa", None) is None:
            cls.sa = _partner(self, "superadmin", "rm-owner")
        self.admin = _partner(self, "manufacturer", "rm-admin", parent=self.sa)
        self.dist = _partner(self, "distributor", "rm-dist", parent=self.admin)
        self.dealer = _partner(self, "dealer", "rm-dealer", parent=self.dist)
        self.farmer = _partner(self, "customer", "rm-farmer", parent=self.dealer)

    def add_pump(self, owner, under):
        pid = f"PUMP-RM-{uuid.uuid4().hex[:8]}"
        self.db.add(Pump(id=pid, name="Owned", supply_type="3-phase", hp_rating=5, owner_user_id=owner.id, hierarchy_path=f"{under.hierarchy_path}/{pid}", status="STOPPED", lifecycle_state="ACTIVE"))
        self.db.commit()
        type(self).pump_ids.append(pid)

    def fresh(self, user):
        self.db.expire_all()
        return self.db.query(User).filter(User.id == user.id).first()

    def preview(self, actor, target):
        return client.get(f"{API}/{target.id}/removal-preview", headers=_h(actor))

    def switch_off(self, actor, target, reason=REASON):
        return client.post(f"{API}/{target.id}/suspend", json={"reason": reason}, headers=_h(actor))

    def switch_on(self, actor, target, reason="Back again"):
        res = client.post(f"{API}/{target.id}/reactivate", json={"reason": reason}, headers=_h(actor))
        self.db.expire_all()
        return res

    def remove(self, actor, target, reason=REASON, name="__use_name__"):
        confirm = target.full_name if name == "__use_name__" else name
        return client.post(f"{API}/{target.id}/remove", json={"reason": reason, "confirm_name": confirm}, headers=_h(actor))


class TestWhoCanRemoveWhom(RemoveBase):
    def test_everyone_above_can_switch_off_and_remove_someone_below_them_in_their_own_branch(self):
        for actor, target in ((self.admin, self.dist), (self.admin, self.dealer), (self.admin, self.farmer), (self.dist, self.dealer), (self.dist, self.farmer), (self.dealer, self.farmer), (self.sa, self.admin)):
            self.assertEqual(self.preview(actor, target).status_code, 200, f"{actor.role} -> {target.role}")
            self.assertEqual(self.switch_off(actor, target).status_code, 200, f"{actor.role} -> {target.role}")
            self.assertEqual(self.switch_on(actor, target).status_code, 200)

    def test_nobody_can_touch_someone_above_beside_or_themselves(self):
        sibling = _partner(self, "dealer", "rm-sibling", parent=self.dist)
        for actor, target in ((self.dealer, self.dist), (self.dealer, self.admin), (self.farmer, self.dealer), (self.dist, self.admin), (self.dealer, sibling), (self.admin, self.sa)):
            r = self.switch_off(actor, target)
            self.assertIn(r.status_code, (403, 404), f"{actor.role} -> {target.role}: {r.text}")
            self.assertIn(self.remove(actor, target).status_code, (403, 404))
        self.assertEqual(self.switch_off(self.dealer, self.dealer).status_code, 403, "not even themselves")
        self.assertEqual(self.remove(self.sa, self.sa).status_code, 403, "the platform owner cannot be removed")

    def test_someone_in_another_branch_is_not_visible_at_all(self):
        other_admin = _partner(self, "manufacturer", "rm-other-admin", parent=self.sa)
        other_dealer = _partner(self, "dealer", "rm-other-dealer", parent=other_admin)
        self.assertEqual(self.switch_off(self.admin, other_dealer).status_code, 404)
        self.assertEqual(self.remove(self.admin, other_dealer).status_code, 404)
        self.assertEqual(self.preview(self.admin, other_dealer).status_code, 404)

    def test_it_needs_a_signed_in_partner(self):
        self.assertEqual(client.post(f"{API}/{self.dealer.id}/suspend", json={"reason": REASON}).status_code, 401)
        self.assertEqual(self.switch_off(self.farmer, self.farmer).status_code, 403)


class TestSwitchingOff(RemoveBase):
    def test_it_blocks_sign_in_ends_sessions_keeps_everything_and_can_be_undone(self):
        self.db.add(RefreshToken(user_id=self.dealer.id, token_hash=uuid.uuid4().hex, expires_at=__import__("datetime").datetime.utcnow() + __import__("datetime").timedelta(days=5)))
        self.db.commit()
        old_token = _h(self.dealer)
        self.assertEqual(self.switch_off(self.dist, self.dealer).status_code, 200)
        user = self.fresh(self.dealer)
        self.assertEqual(user.account_status, "SUSPENDED")
        live = self.db.query(RefreshToken).filter(RefreshToken.user_id == self.dealer.id, RefreshToken.revoked_at.is_(None)).count()
        self.assertEqual(live, 0, "every sign-in of theirs ended")
        self.assertIn(client.get(f"{API}", headers=old_token).status_code, (401, 403), "their old session no longer works")
        self.assertIsNotNone(self.fresh(self.farmer), "everything under them stays")
        self.assertEqual(self.switch_on(self.dist, self.dealer).status_code, 200)
        self.assertEqual(self.fresh(self.dealer).account_status, "ACTIVE")

    def test_a_reason_is_required_and_kept_in_the_log(self):
        self.assertEqual(self.switch_off(self.dist, self.dealer, reason="").status_code, 422)
        self.assertEqual(self.switch_off(self.dist, self.dealer, reason="no").status_code, 422)
        self.assertEqual(self.switch_off(self.dist, self.dealer, reason="Left the company").status_code, 200)
        row = self.db.query(AuditLog).filter(AuditLog.entity_id == str(self.dealer.id), AuditLog.action == "USER_SWITCHED_OFF").order_by(AuditLog.id.desc()).first()
        self.assertIsNotNone(row)
        self.assertEqual(row.actor_id, self.dist.id)
        self.assertEqual(row.after_json["reason"], "Left the company")


class TestRemovingForGood(RemoveBase):
    def test_the_preview_says_what_sits_under_a_person(self):
        self.add_pump(self.farmer, self.dealer)
        body = self.preview(self.admin, self.dist).json()
        self.assertEqual(body["role"], "distributor")
        self.assertEqual((body["beneath"]["dealers"], body["beneath"]["farmers"], body["beneath"]["pumps"]), (1, 1, 1))
        self.assertFalse(body["can_delete"])
        self.assertIn("still people or pumps", body["blocked_reason"])
        empty = self.preview(self.dealer, self.farmer).json()
        self.assertEqual(empty["beneath"]["accounts"], 0)

    def test_a_person_with_nothing_under_them_is_removed_with_a_reason_and_their_name(self):
        fid = self.farmer.id
        r = self.remove(self.dealer, self.farmer)
        self.assertEqual(r.status_code, 200, r.text)
        self.db.expire_all()
        self.assertIsNone(self.db.query(User).filter(User.id == fid).first())
        type(self).user_ids = [i for i in type(self).user_ids if i != fid]
        row = self.db.query(AuditLog).filter(AuditLog.entity_id == str(fid), AuditLog.action == "USER_DELETED").first()
        self.assertEqual((row.actor_id, row.after_json["reason"], row.before_json["role"]), (self.dealer.id, REASON, "customer"))

    def test_the_name_must_be_typed_exactly_but_case_does_not_matter(self):
        self.assertEqual(self.remove(self.dealer, self.farmer, name="Somebody Else").status_code, 422)
        self.assertEqual(self.remove(self.dealer, self.farmer, name="").status_code, 422)
        self.assertIsNotNone(self.fresh(self.farmer))
        upper = self.farmer.full_name.upper()
        self.assertEqual(self.remove(self.dealer, self.farmer, name=f"  {upper} ").status_code, 200)

    def test_a_reason_is_required(self):
        self.assertEqual(self.remove(self.dealer, self.farmer, reason="").status_code, 422)
        self.assertEqual(self.remove(self.dealer, self.farmer, reason="x").status_code, 422)
        self.assertIsNotNone(self.fresh(self.farmer))

    def test_it_is_refused_while_people_are_under_them(self):
        for target, actor in ((self.dist, self.admin), (self.dealer, self.dist)):
            r = self.remove(actor, target)
            self.assertEqual(r.status_code, 409, r.text)
            self.assertIn("Switch them off instead", r.json()["detail"])
            self.assertIsNotNone(self.fresh(target))

    def test_it_is_refused_while_a_pump_is_theirs(self):
        lonely = _partner(self, "customer", "rm-lonely", parent=self.dealer)
        self.add_pump(lonely, self.dealer)
        self.assertEqual(self.remove(self.dealer, lonely).status_code, 409)
        self.assertIsNotNone(self.fresh(lonely))

    def test_an_admin_made_by_mistake_is_removed_with_their_empty_company(self):
        bkey = f"rm-{uuid.uuid4().hex[:6]}"
        brand = AppBrand(key=bkey, name="Mistake Co", status="ACTIVE", features={})
        self.db.add(brand)
        self.db.commit()
        type(self).brand_keys.append(bkey)
        mistake = _partner(self, "manufacturer", "rm-mistake", parent=self.sa)
        self.db.query(User).filter(User.id == mistake.id).update({"brand_id": brand.id})
        self.db.query(AppBrand).filter(AppBrand.id == brand.id).update({"owner_user_id": mistake.id})
        self.db.commit()
        mid = mistake.id
        r = self.remove(self.sa, mistake)
        self.assertEqual(r.status_code, 200, r.text)
        self.db.expire_all()
        self.assertIsNone(self.db.query(User).filter(User.id == mid).first())
        self.assertIsNone(self.db.query(AppBrand).filter(AppBrand.key == bkey).first(), "the empty company goes too")

    def test_a_brand_with_its_own_farmers_app_is_never_deleted(self):
        brand = AppBrand(key=f"rm-{uuid.uuid4().hex[:6]}", name="Has An App", status="ACTIVE", features={}, android_package="com.example.hasapp")
        self.db.add(brand)
        self.db.commit()
        type(self).brand_keys.append(brand.key)
        gone = _partner(self, "manufacturer", "rm-hasapp", parent=self.sa)
        self.db.query(User).filter(User.id == gone.id).update({"brand_id": brand.id})
        self.db.query(AppBrand).filter(AppBrand.id == brand.id).update({"owner_user_id": gone.id})
        self.db.commit()
        self.assertEqual(self.remove(self.sa, gone).status_code, 200)
        self.db.expire_all()
        kept = self.db.query(AppBrand).filter(AppBrand.key == brand.key).first()
        self.assertIsNotNone(kept)
        self.assertIsNone(kept.owner_user_id)


if __name__ == "__main__":
    unittest.main()
