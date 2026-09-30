"""Web portal hardening: mandatory TOTP for privileged roles (FR-WEB-001), the session contract the portal relies on.

Runs against the local development database; every account created here is removed again.
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pyotp
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.main import app
from app.database import SessionLocal
from app.models import RefreshToken, User
from app.services.cache_service import cache_service
from app.services.jwt_auth import hash_secret

client = TestClient(app)
PASSWORD = "Portal-Test-9x"


class MfaBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]
        cls.users = []
        cls.user_ids = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            ids = list(cls.user_ids)
            cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    def make_user(self, role, tag):
        u = User(
            id=uuid.uuid4(), full_name=f"Portal {tag} {self.sfx}", phone=f"+91{uuid.uuid4().int % 10**10:010d}",
            role=role, hierarchy_path=f"/{role}/{uuid.uuid4()}", account_status="ACTIVE", session_version=1,
            password_hash=hash_secret(PASSWORD),
        )
        self.db.add(u)
        self.db.commit()
        type(self).users.append(u)
        type(self).user_ids.append(u.id)
        return u

    def login(self, user):
        return client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": PASSWORD})

    @staticmethod
    def bearer(login_json):
        return {"Authorization": f"Bearer {login_json['access_token']}"}


class TestMandatoryMfa(MfaBase):
    """The rule under test is the one a production server runs with, whatever a developer's local .env says."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._saved_roles = settings.MFA_REQUIRED_ROLES
        settings.MFA_REQUIRED_ROLES = "superadmin,manufacturer"

    @classmethod
    def tearDownClass(cls):
        settings.MFA_REQUIRED_ROLES = cls._saved_roles
        super().tearDownClass()

    def test_superadmin_without_totp_can_only_set_it_up(self):
        u = self.make_user("superadmin", "sa")
        r = self.login(u)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["mfa_setup_required"])
        h = self.bearer(body)

        blocked = client.get("/api/v1/pumps", headers=h)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["error"]["code"], "MFA_SETUP_REQUIRED")
        self.assertEqual(client.get("/api/v1/fleet/dashboard", headers=h).status_code, 403)

        # What it may do: read its own profile, log out, and set TOTP up.
        self.assertEqual(client.get("/api/v1/auth/me", headers=h).status_code, 200)
        setup = client.post("/api/v1/auth/mfa/setup", headers=h)
        self.assertEqual(setup.status_code, 200, setup.text)
        secret = setup.json()["secret"]

        # A wrong code changes nothing.
        bad = client.post("/api/v1/auth/mfa/enable", json={"code": "000000", "secret": secret}, headers=h)
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(client.get("/api/v1/pumps", headers=h).status_code, 403)

        # The secret travels in the body; the same token works the moment TOTP is on.
        ok = client.post("/api/v1/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now(), "secret": secret}, headers=h)
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(client.get("/api/v1/pumps", headers=h).status_code, 200)

    def test_manufacturer_is_covered_too_but_a_customer_is_not(self):
        m = self.make_user("manufacturer", "mf")
        self.assertEqual(client.get("/api/v1/pumps", headers=self.bearer(self.login(m).json())).status_code, 403)

        c = self.make_user("customer", "cu")
        body = self.login(c).json()
        self.assertFalse(body["mfa_setup_required"])
        self.assertEqual(client.get("/api/v1/pumps", headers=self.bearer(body)).status_code, 200)

    def test_with_totp_login_is_a_challenge_and_a_token_from_an_old_login_is_not_a_way_round(self):
        u = self.make_user("superadmin", "sa2")
        old = self.login(u).json()
        secret = pyotp.random_base32()
        self.db.execute(text("SELECT set_config('app.bypass_rls','on',false)"))
        u = self.db.query(User).filter(User.id == u.id).one()
        u.totp_secret, u.totp_enabled = secret, True
        self.db.commit()

        again = self.login(u).json()
        self.assertTrue(again["mfa_required"])
        self.assertIsNone(again["access_token"])
        self.assertIsNone(again.get("mfa_setup_required"))
        # The challenge token is not a session.
        self.assertEqual(client.get("/api/v1/pumps", headers={"Authorization": f"Bearer {again['temp_token']}"}).status_code, 401)

        done = client.post("/api/v1/auth/mfa/verify", json={"temp_token": again["temp_token"], "totp_code": pyotp.TOTP(secret).now()})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertFalse(done.json()["mfa_setup_required"])
        self.assertEqual(client.get("/api/v1/pumps", headers=self.bearer(done.json())).status_code, 200)
        # A token issued before TOTP was on is fine now too: the rule follows the account.
        self.assertEqual(client.get("/api/v1/pumps", headers=self.bearer(old)).status_code, 200)

    def test_a_session_after_mfa_survives_a_sign_out_everywhere_only_if_it_is_newer(self):
        """The MFA-verified token used to carry no session version, so it was refused after any 'log out everywhere'."""
        u = self.make_user("superadmin", "sa3")
        secret = pyotp.random_base32()
        u = self.db.query(User).filter(User.id == u.id).one()
        u.totp_secret, u.totp_enabled = secret, True
        self.db.commit()
        first = client.post("/api/v1/auth/mfa/verify", json={
            "temp_token": self.login(u).json()["temp_token"], "totp_code": pyotp.TOTP(secret).now()}).json()
        self.assertEqual(client.post("/api/v1/auth/logout", headers=self.bearer(first)).status_code, 200)  # everywhere
        self.assertEqual(client.get("/api/v1/pumps", headers=self.bearer(first)).status_code, 401)

        second = client.post("/api/v1/auth/mfa/verify", json={
            "temp_token": self.login(u).json()["temp_token"], "totp_code": pyotp.TOTP(secret).now()})
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(client.get("/api/v1/pumps", headers=self.bearer(second.json())).status_code, 200)

    def test_wrong_codes_are_limited(self):
        u = self.make_user("superadmin", "sa4")
        secret = pyotp.random_base32()
        u = self.db.query(User).filter(User.id == u.id).one()
        u.totp_secret, u.totp_enabled = secret, True
        self.db.commit()
        cache_service.delete(f"mfa_fail:{u.id}")
        temp = self.login(u).json()["temp_token"]
        for _ in range(5):
            r = client.post("/api/v1/auth/mfa/verify", json={"temp_token": temp, "totp_code": "000000"})
            self.assertEqual(r.status_code, 400)
        locked = client.post("/api/v1/auth/mfa/verify", json={"temp_token": temp, "totp_code": pyotp.TOTP(secret).now()})
        self.assertEqual(locked.status_code, 429, "even the right code is refused while locked")
        self.assertEqual(locked.json()["error"]["code"], "MFA_LOCKED")
        cache_service.delete(f"mfa_fail:{u.id}")

    def test_the_secret_may_still_come_in_the_url_for_older_clients(self):
        u = self.make_user("superadmin", "sa5")
        h = self.bearer(self.login(u).json())
        secret = client.post("/api/v1/auth/mfa/setup", headers=h).json()["secret"]
        ok = client.post(f"/api/v1/auth/mfa/enable?secret={secret}", json={"code": pyotp.TOTP(secret).now()}, headers=h)
        self.assertEqual(ok.status_code, 200, ok.text)
        missing = client.post("/api/v1/auth/mfa/enable", json={"code": "123456"}, headers=h)
        self.assertEqual(missing.status_code, 422)


if __name__ == "__main__":
    unittest.main()
