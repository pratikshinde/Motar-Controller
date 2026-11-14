"""The platform owner signs in with a code emailed to them and then the authenticator code (no password).
Runs against the local development database; no email is really sent (the sender is replaced)."""
import os
import re
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pyotp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app
from app.models import User
from app.models.email_login_code import EmailLoginCode
from app.services import email_login
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)

client = TestClient(app)
API = "/api/v1/auth"


class Inbox:
    """Stands in for the email sender: keeps what would have been sent."""

    def __init__(self):
        self.sent = []

    def __call__(self, to, subject, body):
        self.sent.append((to, subject, body))

    def code(self):
        return re.search(r"\b(\d{6})\b", self.sent[-1][2]).group(1)


class EmailBase(MfaBase):
    def setUp(self):
        self.inbox = Inbox()
        patcher = patch("app.services.email_service.send_email", self.inbox)
        patcher.start()
        self.addCleanup(patcher.stop)

    def account(self, role="superadmin", tag="mail", **fields):
        u = self.make_user(role, tag)
        u = self.db.query(User).filter(User.id == u.id).one()
        u.email = f"{tag}-{uuid.uuid4().hex[:8]}@example.com"
        u.password_hash = None
        for key, value in fields.items():
            setattr(u, key, value)
        self.db.commit()
        type(self).user_ids.append(u.id)
        return u

    def ask(self, email):
        return client.post(f"{API}/email-code/request", json={"email": email})

    def enter(self, email, code):
        return client.post(f"{API}/email-code/verify", json={"email": email, "code": code})


class TestAskingForACode(EmailBase):
    def test_the_platform_owners_address_gets_a_six_digit_code_by_email(self):
        admin = self.account()
        r = self.ask(admin.email)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(len(self.inbox.sent), 1)
        to, subject, body = self.inbox.sent[0]
        self.assertEqual(to, admin.email)
        self.assertRegex(body, r"\b\d{6}\b")

    def test_a_stranger_gets_the_same_answer_and_no_email(self):
        known = self.ask(self.account().email)
        unknown = self.ask("nobody-here@example.com")
        self.assertEqual((known.status_code, known.json()), (unknown.status_code, unknown.json()))
        self.assertEqual(len(self.inbox.sent), 1, "only the real admin was emailed")

    def test_only_the_platform_owner_signs_in_this_way(self):
        farmer = self.account("customer", "farmer")
        dealer = self.account("dealer", "dealer")
        admin = self.account("manufacturer", "admin")
        for who in (farmer, dealer, admin):
            self.assertEqual(self.ask(who.email).status_code, 200)
        self.assertEqual(self.inbox.sent, [])
        self.assertEqual(self.enter(farmer.email, "123456").status_code, 400, "not even the development code")

    def test_a_suspended_admin_gets_nothing(self):
        admin = self.account(account_status="SUSPENDED")
        self.ask(admin.email)
        self.assertEqual(self.inbox.sent, [])
        self.assertEqual(self.enter(admin.email, "123456").status_code, 400)

    def test_the_address_may_be_typed_in_any_case_with_spaces(self):
        admin = self.account()
        self.ask(f"  {admin.email.upper()} ")
        self.assertEqual(len(self.inbox.sent), 1)
        self.assertEqual(self.enter(f" {admin.email.upper()}", self.inbox.code()).status_code, 200)

    def test_no_more_than_five_codes_in_fifteen_minutes(self):
        admin = self.account()
        for _ in range(8):
            self.ask(admin.email)
        self.assertEqual(len(self.inbox.sent), email_login.MAX_SENDS)

    def test_a_failing_email_service_does_not_show_in_the_answer(self):
        admin = self.account()
        with patch("app.services.email_service.send_email", side_effect=__import__("app.services.email_service", fromlist=["x"]).EmailNotSent("down")):
            r = self.ask(admin.email)
        self.assertEqual(r.status_code, 200)


class TestEnteringTheCode(EmailBase):
    def test_a_right_code_signs_the_owner_in_with_no_password_while_no_authenticator_is_set_up(self):
        admin = self.account()
        self.ask(admin.email)
        r = self.enter(admin.email, self.inbox.code())
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["access_token"] and body["refresh_token"])
        self.assertEqual(body["user"]["role"], "superadmin")
        self.assertTrue(body.get("mfa_setup_required"), "a setup-only session: the authenticator comes next")
        self.assertEqual(client.get(f"{API}/me", headers={"Authorization": f"Bearer {body['access_token']}"}).status_code, 200)

    def test_a_code_works_once(self):
        admin = self.account()
        self.ask(admin.email)
        code = self.inbox.code()
        self.assertEqual(self.enter(admin.email, code).status_code, 200)
        self.assertEqual(self.enter(admin.email, code).status_code, 400)

    def test_a_wrong_code_is_refused_and_five_burn_the_real_one(self):
        admin = self.account()
        self.ask(admin.email)
        real = self.inbox.code()
        wrong = "000000" if real != "000000" else "111111"
        for _ in range(5):
            r = self.enter(admin.email, wrong)
            self.assertEqual(r.status_code, 400)
        self.assertEqual(self.enter(admin.email, real).status_code, 400, "burned: even the right code is refused now")
        self.ask(admin.email)
        self.assertEqual(self.enter(admin.email, self.inbox.code()).status_code, 200, "a new code starts fresh")

    def test_an_expired_code_is_refused(self):
        admin = self.account()
        self.ask(admin.email)
        self.db.query(EmailLoginCode).filter(EmailLoginCode.email == admin.email.lower()).update({"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
        self.db.commit()
        self.assertEqual(self.enter(admin.email, self.inbox.code()).status_code, 400)

    def test_a_new_code_replaces_the_old_one(self):
        admin = self.account()
        self.ask(admin.email)
        first = self.inbox.code()
        self.ask(admin.email)
        second = self.inbox.code()
        if first != second:
            self.assertEqual(self.enter(admin.email, first).status_code, 400)
        self.assertEqual(self.enter(admin.email, second).status_code, 200)

    def test_a_code_made_for_one_email_does_not_open_another(self):
        one, two = self.account(tag="one"), self.account(tag="two")
        self.ask(one.email)
        self.assertEqual(self.enter(two.email, self.inbox.code()).status_code, 400)

    def test_the_answer_is_the_same_whatever_was_wrong(self):
        admin = self.account()
        self.ask(admin.email)
        a = self.enter(admin.email, "999999")
        b = self.enter("nobody@example.com", "999999")
        c = self.enter(admin.email, "12")
        self.assertEqual(a.status_code, 400)
        self.assertEqual(b.json()["detail"], a.json()["detail"])
        self.assertIn(c.status_code, (400, 422))

    def test_in_development_the_fixed_code_works_for_a_real_owner_only(self):
        admin = self.account()
        self.assertEqual(self.enter(admin.email, "123456").status_code, 200)
        self.assertEqual(self.enter("nobody@example.com", "123456").status_code, 400)

    def test_only_a_keyed_hash_of_the_code_is_stored(self):
        admin = self.account()
        self.ask(admin.email)
        code = self.inbox.code()
        row = self.db.query(EmailLoginCode).filter(EmailLoginCode.email == admin.email.lower()).one()
        self.assertNotIn(code, row.code_hash)
        self.assertEqual(len(row.code_hash), 64)


class TestThePlatformOwnerNeedsTheAuthenticatorToo(EmailBase):
    def owner(self):
        secret = pyotp.random_base32()
        return self.account("superadmin", "owner", totp_secret=secret, totp_enabled=True, mfa_enabled=True), secret

    def test_the_emailed_code_alone_gives_no_session(self):
        owner, secret = self.owner()
        self.ask(owner.email)
        r = self.enter(owner.email, self.inbox.code())
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body.get("mfa_required") or body.get("requires_mfa"), body)
        self.assertFalse(body.get("access_token"), "no session yet")
        self.assertTrue(body["temp_token"])

    def test_then_the_authenticator_code_completes_the_sign_in(self):
        owner, secret = self.owner()
        self.ask(owner.email)
        challenge = self.enter(owner.email, self.inbox.code()).json()
        bad = client.post(f"{API}/mfa/verify", json={"temp_token": challenge["temp_token"], "code": "000000"})
        self.assertEqual(bad.status_code, 400)
        good = client.post(f"{API}/mfa/verify", json={"temp_token": challenge["temp_token"], "code": pyotp.TOTP(secret).now()})
        self.assertEqual(good.status_code, 200, good.text)
        self.assertEqual(good.json()["user"]["role"], "superadmin")
        self.assertTrue(good.json()["access_token"])

    def test_the_authenticator_alone_is_not_enough_without_the_emailed_code(self):
        owner, secret = self.owner()
        r = client.post(f"{API}/mfa/verify", json={"email": owner.email, "code": pyotp.TOTP(secret).now()})
        self.assertIn(r.status_code, (401, 422))


class TestRealEmail(EmailBase):
    def test_with_real_email_on_the_fixed_development_code_does_not_work(self):
        from app.config import settings

        admin = self.account()
        with patch.object(settings, "EMAIL_BACKEND", "smtp"):
            self.assertEqual(self.enter(admin.email, "123456").status_code, 400)

    def test_with_real_email_on_the_fixed_development_code_is_refused_at_the_authenticator_step_too(self):
        from app.config import settings

        secret = pyotp.random_base32()
        owner = self.account("superadmin", "realmfa", totp_secret=secret, totp_enabled=True, mfa_enabled=True)
        self.ask(owner.email)
        challenge = self.enter(owner.email, self.inbox.code()).json()
        with patch.object(settings, "EMAIL_BACKEND", "smtp"):
            refused = client.post(f"{API}/mfa/verify", json={"temp_token": challenge["temp_token"], "code": "123456"})
            self.assertEqual(refused.status_code, 400)
            real = client.post(f"{API}/mfa/verify", json={"temp_token": challenge["temp_token"], "code": pyotp.TOTP(secret).now()})
            self.assertEqual(real.status_code, 200, real.text)

    def test_smtp_sends_the_message_to_the_admin_through_the_configured_account(self):
        from app.config import settings
        from app.services import email_service

        sent = []

        class FakeSmtp:
            def __init__(self, host, port, timeout=None, context=None):
                sent.append(("connect", host, port))

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def starttls(self, context=None):
                sent.append(("tls",))

            def login(self, user, password):
                sent.append(("login", user))

            def send_message(self, message):
                sent.append(("mail", message["From"], message["To"], message["Subject"], message.get_content()))

        with patch.object(settings, "EMAIL_BACKEND", "smtp"), patch.object(settings, "SMTP_HOST", "smtp.example.com"), patch.object(
            settings, "SMTP_PORT", 587
        ), patch.object(settings, "SMTP_USER", "sender@example.com"), patch.object(settings, "SMTP_PASSWORD", "app-password"), patch.object(
            settings, "EMAIL_FROM", ""
        ), patch("app.services.email_service._Smtp", FakeSmtp):
            email_service._send_smtp("admin@example.com", "Your sign-in code", "Your sign-in code is 123456.")
        self.assertEqual(sent[0], ("connect", "smtp.example.com", 587))
        self.assertIn(("tls",), sent)
        self.assertIn(("login", "sender@example.com"), sent)
        mail = [x for x in sent if x[0] == "mail"][0]
        self.assertEqual(mail[1:4], ("sender@example.com", "admin@example.com", "Your sign-in code"))
        self.assertIn("123456", mail[4])

    def test_smtp_that_is_not_fully_set_up_fails_without_leaking_anything(self):
        from app.config import settings
        from app.services import email_service

        with patch.object(settings, "EMAIL_BACKEND", "smtp"), patch.object(settings, "SMTP_HOST", ""), patch.object(settings, "SMTP_PASSWORD", ""):
            with self.assertRaises(email_service.EmailNotSent):
                email_service._send_smtp("admin@example.com", "x", "y")


class TestAccountsMadeWithoutAPassword(EmailBase):
    def test_the_script_makes_an_account_with_no_password_that_signs_in_by_code(self):
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
        import create_portal_accounts as script

        address = f"owner-{uuid.uuid4().hex[:8]}@example.com"
        user = script.create_account(self.db, "superadmin", "Platform Owner", address)
        self.db.commit()
        type(self).user_ids.append(user.id)
        try:
            self.assertIsNone(user.password_hash)
            self.assertEqual(client.post(f"{API}/login-email", json={"email": address, "password": "anything-at-all-1"}).status_code, 401)
            self.ask(address)
            self.assertEqual(len(self.inbox.sent), 1)
            r = self.enter(address, self.inbox.code())
            self.assertEqual(r.status_code, 200, r.text)
            self.assertTrue(r.json().get("mfa_setup_required"), "no authenticator yet: the first sign-in is a setup-only session")
        finally:
            self.db.rollback()


if __name__ == "__main__":
    unittest.main()
