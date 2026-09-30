"""Farmers now register with a password (WhatsApp-verified) and can reset it the same way partners do —
`/auth/register` and `/auth/reset-password` both now require a phone_verification_token.

Runs against the local development database; every account created here is removed again.
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.main import app
from app.models.user import User
from test_web_portal_users import _verify_phone  # noqa: E402

client = TestClient(app)


def _phone():
    return f"+9198{uuid.uuid4().int % 10**8:08d}"


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app.database import SessionLocal
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.user_ids = []
        cls._saved_self_reg = settings.ALLOW_SELF_REGISTRATION
        settings.ALLOW_SELF_REGISTRATION = True

    @classmethod
    def tearDownClass(cls):
        settings.ALLOW_SELF_REGISTRATION = cls._saved_self_reg
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(User).filter(User.id.in_(cls.user_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    def track(self, user_id):
        type(self).user_ids.append(uuid.UUID(str(user_id)))


class TestFarmerRegistration(Base):
    def test_registering_without_a_verification_token_is_refused(self):
        r = client.post("/api/v1/auth/register", json={
            "full_name": "No Verify", "phone_number": _phone(), "password": "Strong-Pass-1",
        })
        self.assertEqual(r.status_code, 400, r.text)

    def test_a_verified_phone_creates_a_working_farmer_account(self):
        phone = _phone()
        token = _verify_phone(phone)
        r = client.post("/api/v1/auth/register", json={
            "full_name": "New Farmer", "phone_number": phone, "password": "Strong-Pass-1",
            "phone_verification_token": token,
        })
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["access_token"])
        self.track(body["user"]["id"])
        made = self.db.query(User).filter(User.id == body["user"]["id"]).one()
        self.assertEqual((made.role, made.is_verified), ("customer", True))
        self.assertTrue(made.password_hash)

        # The password they chose actually works.
        login = client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": "Strong-Pass-1"})
        self.assertEqual(login.status_code, 200, login.text)

    def test_a_ticket_cannot_be_reused_for_a_second_account(self):
        phone = _phone()
        token = _verify_phone(phone)
        first = client.post("/api/v1/auth/register", json={
            "full_name": "First", "phone_number": phone, "password": "Strong-Pass-1",
            "phone_verification_token": token,
        })
        self.assertEqual(first.status_code, 200, first.text)
        self.track(first.json()["user"]["id"])

        second = client.post("/api/v1/auth/register", json={
            "full_name": "Second", "phone_number": _phone(), "password": "Strong-Pass-1",
            "phone_verification_token": token,  # same ticket, different phone entirely
        })
        self.assertEqual(second.status_code, 400, second.text)


class TestFarmerForgotPassword(Base):
    def test_a_farmer_can_reset_their_own_password(self):
        phone = _phone()
        token = _verify_phone(phone)
        created = client.post("/api/v1/auth/register", json={
            "full_name": "Reset Me", "phone_number": phone, "password": "Old-Pass-1",
            "phone_verification_token": token,
        })
        self.track(created.json()["user"]["id"])

        # Forgot-password: send -> confirm -> reset, the same shape as the partner flow.
        sent = client.post("/api/v1/auth/verify-phone/send", json={"phone_number": phone, "purpose": "password_reset"})
        self.assertEqual(sent.status_code, 200, sent.text)
        self.assertIn("dev_otp", sent.json(), "a farmer with a password is eligible for password_reset")
        confirmed = client.post("/api/v1/auth/verify-phone/confirm",
                                 json={"phone_number": phone, "purpose": "password_reset", "code": sent.json()["dev_otp"]})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)

        reset = client.post("/api/v1/auth/reset-password", json={
            "phone_number": phone, "verification_token": confirmed.json()["verification_token"],
            "new_password": "New-Pass-1",
        })
        self.assertEqual(reset.status_code, 200, reset.text)

        old_login = client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": "Old-Pass-1"})
        new_login = client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": "New-Pass-1"})
        self.assertEqual(old_login.status_code, 401)
        self.assertEqual(new_login.status_code, 200, new_login.text)

    def test_a_phone_with_no_password_at_all_is_not_eligible(self):
        # No account exists for this phone at all - same non-committal response as before.
        phone = _phone()
        sent = client.post("/api/v1/auth/verify-phone/send", json={"phone_number": phone, "purpose": "password_reset"})
        self.assertEqual(sent.status_code, 200, sent.text)
        self.assertNotIn("dev_otp", sent.json())


if __name__ == "__main__":
    unittest.main()
