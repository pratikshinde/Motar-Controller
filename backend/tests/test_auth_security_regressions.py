"""Regression tests for the sign-in hardening pass (2026-10-16). Each test names a hole that was open and must stay shut:

  * an active authenticator could be replaced with only a first factor (password or code) - an MFA bypass;
  * a WhatsApp code alone signed an existing account in at /auth/register/verify, a super admin included;
  * the fixed code 123456 and the `dev_otp` field worked wherever ENV or a stray AUTH_PROVIDER said so;
  * a password reset left the account's refresh tokens alive;
  * password sign-in told "no such number" from "wrong password" and could be guessed at without limit;
  * the code-sending routes would message any number, and an account made from a code got a hierarchy path shared with
    everyone whose phone ends in the same four digits.

Runs against the local development database; every row created here is removed again.
"""
import contextlib
import hashlib
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pyotp
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.auth import LOGIN_MAX_FAILURES, _login_fail_key
from app.config import Settings, settings
from app.main import app
from app.models import OtpChallenge, PhoneVerification, RefreshToken, User
from app.services.cache_service import cache_service
from app.services.whatsapp_provider import MockWhatsAppOtpProvider, RealWhatsAppOtpProvider, get_whatsapp_provider
from test_web_portal_hardening import PASSWORD, MfaBase  # noqa: E402
from test_web_portal_users import _verify_phone  # noqa: E402

client = TestClient(app)


def _phone():
    return f"+91{uuid.uuid4().int % 10**10:010d}"


@contextlib.contextmanager
def switches(**values):
    """Flip settings for the length of a block, whatever happens inside it."""
    saved = {name: getattr(settings, name) for name in values}
    for name, value in values.items():
        setattr(settings, name, value)
    try:
        yield
    finally:
        for name, value in saved.items():
            setattr(settings, name, value)


@contextlib.contextmanager
def no_messages():
    """Nothing is sent anywhere: the senders are replaced, and the test can count what would have gone out."""
    with patch("app.api.auth.get_whatsapp_provider") as whatsapp, \
            patch("app.api.auth.send_sms_otp") as sms, \
            patch("app.services.phone_verification.send_whatsapp_otp") as ticket_whatsapp:
        whatsapp.return_value.send_otp.return_value = {"status": "dispatched"}
        sms.return_value = {"status": "queued"}
        ticket_whatsapp.return_value = {"status": "not_configured"}
        yield whatsapp.return_value.send_otp, sms, ticket_whatsapp


class SignInBase(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.phones = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            made = [row[0] for row in cls.db.query(User.id).filter(User.phone.in_(cls.phones)).all()] if cls.phones else []
            cls.user_ids.extend(made)
            if made:
                cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_(made)).delete(synchronize_session=False)
            if cls.phones:
                cls.db.query(OtpChallenge).filter(OtpChallenge.phone_number.in_(cls.phones)).delete(synchronize_session=False)
                cls.db.query(PhoneVerification).filter(PhoneVerification.phone_number.in_(cls.phones)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            super().tearDownClass()

    def fresh_phone(self):
        phone = _phone()
        type(self).phones.append(phone)
        return phone

    def make_user(self, role, tag):
        user = super().make_user(role, tag)
        type(self).phones.append(user.phone)
        return user

    def enrolled_superadmin(self, tag):
        user = self.make_user("superadmin", tag)
        user = self.db.query(User).filter(User.id == user.id).one()
        user.totp_secret, user.totp_enabled = pyotp.random_base32(), True
        self.db.commit()
        return user


class TestAuthenticatorCannotBeReplacedWithoutItself(SignInBase):
    def test_a_first_factor_cannot_swap_an_active_authenticator(self):
        sa = self.enrolled_superadmin("swap")
        original = sa.totp_secret
        first = self.login(sa).json()
        self.assertTrue(first["mfa_required"])
        with switches(ENV="development"), no_messages():
            client.post("/api/v1/auth/send-otp", json={"phone": sa.phone})
            by_code = client.post("/api/v1/auth/verify-otp", json={"phone": sa.phone, "otp": "123456"}).json()
        self.assertEqual(by_code["status"], "MFA_REQUIRED")

        # With only a first factor in hand (the password, or a WhatsApp code): neither the challenge token nor the challenge
        # id can start a new enrolment.
        for body in ({"temp_token": first["temp_token"]}, {"temp_token": by_code["temp_token"]}, {"challenge_id": by_code["challenge_id"]}):
            refused = client.post("/api/v1/auth/mfa/setup", json=body)
            self.assertEqual(refused.status_code, 409, refused.text)

        # ...and a fully signed-in session cannot do it either: replacing an authenticator goes through /mfa/disable.
        done = client.post("/api/v1/auth/mfa/verify", json={"temp_token": first["temp_token"], "totp_code": pyotp.TOTP(original).now()})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(client.post("/api/v1/auth/mfa/enroll", headers=self.bearer(done.json())).status_code, 409)

        self.db.expire_all()
        self.assertEqual(self.db.query(User).filter(User.id == sa.id).one().totp_secret, original)

    def test_enabling_over_an_active_authenticator_is_refused_even_with_a_valid_new_code(self):
        sa = self.enrolled_superadmin("rekey")
        done = client.post("/api/v1/auth/mfa/verify", json={
            "temp_token": self.login(sa).json()["temp_token"], "totp_code": pyotp.TOTP(sa.totp_secret).now()})
        mine = pyotp.random_base32()
        refused = client.post("/api/v1/auth/mfa/enable", json={"code": pyotp.TOTP(mine).now(), "secret": mine}, headers=self.bearer(done.json()))
        self.assertEqual(refused.status_code, 409, refused.text)

    def test_an_account_with_no_authenticator_can_still_enrol_one(self):
        """The guard must not lock out the very first enrolment."""
        sa = self.make_user("superadmin", "first")
        session = self.login(sa).json()
        self.assertTrue(session["mfa_setup_required"])
        secret = client.post("/api/v1/auth/mfa/setup", headers=self.bearer(session)).json()["secret"]
        enabled = client.post("/api/v1/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now(), "secret": secret}, headers=self.bearer(session))
        self.assertEqual(enabled.status_code, 200, enabled.text)


class TestACodeAloneIsNotASuperAdminSession(SignInBase):
    def request_and_verify(self, user, role="customer"):
        sent = client.post("/api/v1/auth/register/request", json={"phone": user.phone, "role": role})
        self.assertEqual(sent.status_code, 200, sent.text)
        return client.post("/api/v1/auth/register/verify", json={"phone": user.phone, "otp": sent.json()["dev_otp"]})

    def test_register_verify_asks_a_super_admin_for_the_authenticator(self):
        sa = self.enrolled_superadmin("regsa")
        with switches(ENV="development", ALLOW_SELF_REGISTRATION=True), no_messages():
            r = self.request_and_verify(sa)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "MFA_REQUIRED")
        self.assertNotIn("access_token", r.json())

    def test_register_verify_refuses_a_suspended_account(self):
        farmer = self.make_user("customer", "suspended")
        farmer = self.db.query(User).filter(User.id == farmer.id).one()
        farmer.account_status = "SUSPENDED"
        self.db.commit()
        with switches(ENV="development", ALLOW_SELF_REGISTRATION=True), no_messages():
            r = self.request_and_verify(farmer)
        self.assertEqual(r.status_code, 403, r.text)

    def test_register_verify_still_signs_an_ordinary_farmer_in(self):
        farmer = self.make_user("customer", "ordinary")
        with switches(ENV="development", ALLOW_SELF_REGISTRATION=True), no_messages():
            r = self.request_and_verify(farmer)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["access_token"])


class TestDevShortcutsAreDevelopmentOnly(SignInBase):
    def test_no_fixed_code_and_no_dev_otp_outside_development(self):
        farmer = self.make_user("customer", "prod-farmer")
        sa = self.enrolled_superadmin("prod-sa")
        try:
            with switches(ENV="production"), no_messages():
                sent = client.post("/api/v1/auth/send-otp", json={"phone": farmer.phone})
                self.assertEqual(sent.status_code, 200, sent.text)
                self.assertNotIn("dev_otp", sent.json())
                guessed = client.post("/api/v1/auth/verify-otp", json={"phone": farmer.phone, "otp": "123456"})
                self.assertEqual(guessed.status_code, 400, guessed.text)

                registering = client.post("/api/v1/auth/register/request", json={"phone": farmer.phone, "role": "customer"})
                self.assertNotIn("dev_otp", registering.json())

                ticket = client.post("/api/v1/auth/verify-phone/send", json={"phone_number": self.fresh_phone(), "purpose": "registration"})
                self.assertNotIn("dev_otp", ticket.text)

                temp = self.login(sa).json()["temp_token"]
                mfa = client.post("/api/v1/auth/mfa/verify", json={"temp_token": temp, "totp_code": "123456"})
                self.assertEqual(mfa.status_code, 400, mfa.text)
        finally:
            cache_service.delete(f"mfa_fail:{sa.id}")

    def test_the_codes_reach_the_response_in_development(self):
        farmer = self.make_user("customer", "dev-farmer")
        with switches(ENV="development"), no_messages():
            sent = client.post("/api/v1/auth/send-otp", json={"phone": farmer.phone})
        self.assertEqual(sent.json().get("dev_otp"), "123456")

    def test_a_stray_setting_cannot_turn_the_shortcuts_on(self):
        with switches(ENV="production"), patch.object(settings, "AUTH_PROVIDER", "mock", create=True):
            self.assertFalse(settings.dev_codes_enabled)

    def test_the_settings_refuse_to_start_unsafe(self):
        def build(**given):
            return Settings(_env_file=None, **given)

        strong = "x" * 40
        for env in ("production", "Production", "prod", "staging", ""):
            with self.assertRaises(ValueError, msg=f"ENV={env!r} without a real JWT_SECRET must not start"):
                build(ENV=env, JWT_SECRET="")
            with self.assertRaises(ValueError):
                build(ENV=env, JWT_SECRET="too-short")
        with self.assertRaises(ValueError):
            build(ENV="production", JWT_SECRET=strong, AUTH_PROVIDER="mock")
        with self.assertRaises(ValueError):
            build(ENV="prod", JWT_SECRET=strong, AUTH_PROVIDER="MOCK")

        closed = build(ENV="production", JWT_SECRET=strong, ALLOW_SELF_REGISTRATION=True)
        self.assertFalse(closed.ALLOW_SELF_REGISTRATION, "self-registration cannot be switched on outside development")
        self.assertFalse(closed.dev_codes_enabled)
        self.assertFalse(build(ENV="test", JWT_SECRET="").dev_codes_enabled)

        dev = build(ENV="development", JWT_SECRET="", AUTH_PROVIDER="whatsapp")
        self.assertTrue(dev.dev_codes_enabled)
        self.assertTrue(dev.ALLOW_SELF_REGISTRATION)

    def test_a_misspelt_provider_is_never_the_console_logger(self):
        with switches(ENV="production"), patch.object(settings, "AUTH_PROVIDER", "mok", create=True):
            self.assertIsInstance(get_whatsapp_provider(), RealWhatsAppOtpProvider)
        with switches(ENV="development"), patch.object(settings, "AUTH_PROVIDER", "mock", create=True):
            self.assertIsInstance(get_whatsapp_provider(), MockWhatsAppOtpProvider)


class TestResetPasswordEndsEverySession(SignInBase):
    def test_old_refresh_and_access_tokens_die_with_the_old_password(self):
        user = self.make_user("dealer", "resetter")
        old = self.login(user).json()
        new_password = "Brand-New-Pass-7"
        with switches(ENV="development"), no_messages():
            ticket = _verify_phone(user.phone, "password_reset")
        reset = client.post("/api/v1/auth/reset-password", json={
            "phone_number": user.phone, "verification_token": ticket, "new_password": new_password})
        self.assertEqual(reset.status_code, 200, reset.text)

        self.assertEqual(client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]}).status_code, 401,
                         "a refresh token from before the reset must not mint a new session")
        self.assertEqual(client.get("/api/v1/auth/me", headers=self.bearer(old)).status_code, 401)
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": PASSWORD}).status_code, 401)
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": new_password}).status_code, 200)

    def test_resetting_the_password_lifts_a_sign_in_lock(self):
        user = self.make_user("dealer", "unlocker")
        key = _login_fail_key(user.phone)
        try:
            for _ in range(LOGIN_MAX_FAILURES):
                client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": "wrong-password-1"})
            self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": PASSWORD}).status_code, 429)
            with switches(ENV="development"), no_messages():
                ticket = _verify_phone(user.phone, "password_reset")
            client.post("/api/v1/auth/reset-password", json={"phone_number": user.phone, "verification_token": ticket, "new_password": "Another-Pass-8"})
            self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": "Another-Pass-8"}).status_code, 200)
        finally:
            cache_service.delete(key)


class TestPasswordSignInIsNotAnOracle(SignInBase):
    def test_wrong_password_and_unknown_number_look_the_same_and_guessing_is_limited(self):
        user = self.make_user("dealer", "oracle")
        ghost = self.fresh_phone()
        keys = [_login_fail_key(user.phone), _login_fail_key(ghost)]
        for key in keys:
            cache_service.delete(key)
        try:
            wrong = client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": "wrong-password-1"})
            unknown = client.post("/api/v1/auth/login-password", json={"phone_number": ghost, "password": "wrong-password-1"})
            self.assertEqual((wrong.status_code, unknown.status_code), (401, 401))
            self.assertEqual(wrong.json()["detail"], unknown.json()["detail"])

            for _ in range(LOGIN_MAX_FAILURES - 1):
                client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": "wrong-password-1"})
            locked = client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": PASSWORD})
            self.assertEqual(locked.status_code, 429, "once locked, even the right password waits")
            self.assertEqual(locked.json()["error"]["code"], "LOGIN_LOCKED")
            self.assertTrue(locked.headers.get("retry-after"))

            # An unknown number is limited in exactly the same way, so the lock itself does not give accounts away.
            for _ in range(LOGIN_MAX_FAILURES - 1):
                client.post("/api/v1/auth/login-password", json={"phone_number": ghost, "password": "wrong-password-1"})
            self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": ghost, "password": "wrong-password-1"}).status_code, 429)

            # The lock is per number: another account is unaffected.
            other = self.make_user("dealer", "bystander")
            self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": other.phone, "password": PASSWORD}).status_code, 200)
        finally:
            for key in keys:
                cache_service.delete(key)

    def test_a_right_password_clears_the_count(self):
        user = self.make_user("dealer", "forgetful")
        key = _login_fail_key(user.phone)
        cache_service.delete(key)
        try:
            for _ in range(LOGIN_MAX_FAILURES - 1):
                client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": "wrong-password-1"})
            self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": PASSWORD}).status_code, 200)
            self.assertIsNone(cache_service.get(key))
        finally:
            cache_service.delete(key)


class TestCodesAreOnlyForRealAccountsWhenRegistrationIsClosed(SignInBase):
    def test_no_code_is_sent_to_a_stranger_and_the_answer_does_not_say_so(self):
        known = self.make_user("customer", "known")
        stranger = self.fresh_phone()
        with switches(ENV="development", ALLOW_SELF_REGISTRATION=False), no_messages() as (whatsapp, _sms, _ticket):
            a = client.post("/api/v1/auth/send-otp", json={"phone": known.phone})
            b = client.post("/api/v1/auth/send-otp", json={"phone": stranger})
            c = client.post("/api/v1/auth/register/request", json={"phone": stranger, "role": "customer"})
            sent_to = [call.args[0] for call in whatsapp.call_args_list]
        self.assertEqual((a.status_code, b.status_code, c.status_code), (200, 200, 200))
        self.assertEqual(sent_to, [known.phone], "only the number with an account was messaged")
        self.assertEqual(set(a.json()) - {"dev_otp"}, set(b.json()), "the reply does not reveal which numbers have accounts")
        self.assertEqual(self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == stranger).count(), 0)

    def test_a_code_cannot_create_an_account_when_registration_is_closed(self):
        stranger = self.fresh_phone()
        # A code left over from before registration was closed.
        self.db.add(OtpChallenge(
            phone_number=stranger, purpose="login", channel="whatsapp", code_hash=hashlib.sha256(b"654321").hexdigest(),
            expires_at=datetime.utcnow() + timedelta(minutes=5), attempts=0, created_at=datetime.utcnow()))
        self.db.commit()
        with switches(ENV="development", ALLOW_SELF_REGISTRATION=False):
            r = client.post("/api/v1/auth/verify-otp", json={"phone": stranger, "otp": "654321"})
        self.assertEqual(r.status_code, 403, r.text)
        self.assertEqual(self.db.query(User).filter(User.phone == stranger).count(), 0)

    def test_an_unreachable_sender_is_reported_not_swallowed(self):
        known = self.make_user("customer", "unreachable")
        with switches(ENV="production"), \
                patch("app.api.auth.get_whatsapp_provider") as whatsapp, patch("app.api.auth.send_sms_otp") as sms:
            whatsapp.return_value.send_otp.return_value = {"status": "not_configured"}
            sms.return_value = {"status": "mock_dispatched"}
            r = client.post("/api/v1/auth/send-otp", json={"phone": known.phone})
        self.assertEqual(r.status_code, 503, r.text)
        self.assertEqual(self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == known.phone).count(), 0,
                         "a code nobody can receive must not block the retry")

    def test_sms_takes_over_when_whatsapp_is_not_set_up(self):
        known = self.make_user("customer", "sms-fallback")
        with switches(ENV="production"), \
                patch("app.api.auth.get_whatsapp_provider") as whatsapp, patch("app.api.auth.send_sms_otp") as sms:
            whatsapp.return_value.send_otp.return_value = {"status": "not_configured"}
            sms.return_value = {"status": "queued"}
            r = client.post("/api/v1/auth/send-otp", json={"phone": known.phone})
        self.assertEqual(r.status_code, 200, r.text)
        sms.assert_called_once()


class TestAccountsMadeFromACode(SignInBase):
    def test_each_gets_a_hierarchy_path_of_its_own(self):
        tail = f"{uuid.uuid4().int % 10**4:04d}"
        first, second = f"+91{uuid.uuid4().int % 10**6:06d}{tail}", f"+91{uuid.uuid4().int % 10**6:06d}{tail}"
        type(self).phones.extend([first, second])
        made = []
        with switches(ENV="development", ALLOW_SELF_REGISTRATION=True), no_messages():
            for phone in (first, second):
                self.assertEqual(client.post("/api/v1/auth/send-otp", json={"phone": phone}).status_code, 200)
                r = client.post("/api/v1/auth/verify-otp", json={"phone": phone, "otp": "123456"})
                self.assertEqual(r.status_code, 200, r.text)
                made.append(r.json()["user"]["id"])
        self.db.expire_all()
        paths = [self.db.query(User).filter(User.id == uid).one().hierarchy_path for uid in made]
        self.assertEqual(paths, [f"/customers/{uid}" for uid in made])
        self.assertEqual(len(set(paths)), 2)


if __name__ == "__main__":
    unittest.main()
