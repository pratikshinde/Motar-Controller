"""The tool that gives an admin or the super admin a new password. Runs against the local development database."""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from fastapi.testclient import TestClient

from app.main import app
from app.models import AuditLog, RefreshToken, User
from app.services.jwt_auth import hash_secret, verify_secret
from reset_portal_password import MIN_PASSWORD, ResetError, reset_password  # noqa: E402
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)

client = TestClient(app)
NEW = "A-Brand-New-Pass-77"


class TestResetPortalPassword(MfaBase):
    def person(self, role="manufacturer", tag="reset"):
        user = self.db.query(User).filter(User.id == self.make_user(role, f"{tag}-{uuid.uuid4().hex[:6]}").id).one()
        user.email = f"{tag}-{uuid.uuid4().hex[:8]}@example.test"
        user.password_hash = hash_secret("Old-Password-12345")
        self.db.commit()
        return user

    def test_the_new_password_works_and_the_old_one_does_not(self):
        user = self.person()
        reset_password(self.db, user.email, NEW)
        self.db.commit()
        self.db.refresh(user)
        self.assertTrue(verify_secret(NEW, user.password_hash))
        self.assertFalse(verify_secret("Old-Password-12345", user.password_hash))

    def test_the_account_can_sign_in_with_it_through_the_website_route(self):
        user = self.person("superadmin", "reset-sa")
        self.db.query(User).filter(User.id == user.id).update({"totp_enabled": False, "totp_secret": None})
        reset_password(self.db, user.email, NEW)
        self.db.commit()
        r = client.post("/api/v1/auth/login-email", json={"email": user.email, "password": NEW})
        self.assertEqual(r.status_code, 200, r.text)

    def test_every_earlier_session_is_ended(self):
        user = self.person()
        before = user.session_version or 1
        self.db.add(RefreshToken(user_id=user.id, token_hash=uuid.uuid4().hex, expires_at=__import__("datetime").datetime.utcnow() + __import__("datetime").timedelta(days=5)))
        self.db.commit()
        reset_password(self.db, user.email, NEW)
        self.db.commit()
        self.db.refresh(user)
        self.assertEqual(user.session_version, before + 1)
        live = self.db.query(RefreshToken).filter(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).count()
        self.assertEqual(live, 0)

    def test_the_authenticator_is_removed_only_when_asked(self):
        user = self.person()
        self.db.query(User).filter(User.id == user.id).update({"totp_secret": "JBSWY3DPEHPK3PXP", "totp_enabled": True})
        self.db.commit()
        reset_password(self.db, user.email, NEW)
        self.db.commit()
        self.db.refresh(user)
        self.assertTrue(user.totp_enabled)
        reset_password(self.db, user.email, NEW, reset_authenticator=True)
        self.db.commit()
        self.db.refresh(user)
        self.assertFalse(user.totp_enabled)
        self.assertIsNone(user.totp_secret)

    def test_it_is_recorded_in_the_activity_log(self):
        user = self.person()
        reset_password(self.db, user.email, NEW)
        self.db.commit()
        row = self.db.query(AuditLog).filter(AuditLog.entity_id == str(user.id), AuditLog.action == "PASSWORD_RESET").first()
        self.assertIsNotNone(row)

    def test_a_short_password_or_the_wrong_kind_of_account_is_refused_alike_for_unknown_emails(self):
        user = self.person()
        with self.assertRaises(ResetError):
            reset_password(self.db, user.email, "x" * (MIN_PASSWORD - 1))
        for who in (self.person("dealer", "reset-dl"), self.person("distributor", "reset-ds"), self.person("customer", "reset-fm")):
            with self.assertRaises(ResetError) as ctx:
                reset_password(self.db, who.email, NEW)
            self.assertEqual(str(ctx.exception), "No admin or super admin has that email.")
        with self.assertRaises(ResetError) as ctx:
            reset_password(self.db, "nobody@example.test", NEW)
        self.assertEqual(str(ctx.exception), "No admin or super admin has that email.")

    def test_the_email_is_matched_without_regard_to_case_and_spaces(self):
        user = self.person()
        reset_password(self.db, f"  {user.email.upper()} ", NEW)
        self.db.commit()
        self.db.refresh(user)
        self.assertTrue(verify_secret(NEW, user.password_hash))


if __name__ == "__main__":
    unittest.main()
