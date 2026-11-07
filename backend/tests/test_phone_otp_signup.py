"""Farmers sign up and sign in with a mobile number and an SMS code: no email, no password, no WhatsApp.

  * the code goes by SMS through MSG91's OTP product, ahead of any leftover Twilio settings, and a refusal is reported;
  * a new number gets a code and an account in production only when OPEN_PHONE_SIGNUP is switched on (closed by default);
  * one number can be sent only a few codes an hour.

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.api.auth import _too_many_codes
from app.config import Settings, settings
from app.main import app
from app.models import OtpChallenge, User
from app.services import notification_service as ns
from app.services.cache_service import cache_service
from app.services.brand_service import current_brand  # noqa: F401
from test_auth_security_regressions import SignInBase, switches

client = TestClient(app)


def _msg91_client(status_code=200, body='{"type":"success","message":"id"}'):
    http = MagicMock()
    reply = MagicMock(status_code=status_code, content=body.encode(), text=body)
    reply.json.return_value = __import__("json").loads(body)
    http.__enter__.return_value.post.return_value = reply
    return http


class TestMsg91Otp(unittest.TestCase):
    def test_the_code_goes_into_the_approved_template_with_the_country_code(self):
        http = _msg91_client()
        with switches(MSG91_AUTH_KEY="key", MSG91_OTP_TEMPLATE_ID="tpl123"), \
                patch("app.services.notification_service.httpx.Client", return_value=http):
            result = ns.send_sms_otp("+91 96065 95604", "482913")
        self.assertEqual(result["status"], "dispatched")
        post = http.__enter__.return_value.post
        self.assertEqual(post.call_args[0][0], "https://control.msg91.com/api/v5/otp")
        self.assertEqual(post.call_args[1]["headers"]["authkey"], "key")
        params = post.call_args[1]["params"]
        self.assertEqual((params["template_id"], params["mobile"], params["otp"]), ("tpl123", "919606595604", "482913"))

    def test_it_goes_ahead_of_twilio_so_leftover_trial_settings_cannot_take_the_code(self):
        http = _msg91_client()
        with switches(MSG91_AUTH_KEY="key", MSG91_OTP_TEMPLATE_ID="tpl", TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_PHONE_NUMBER="+15550001111"), \
                patch("app.services.notification_service.httpx.Client", return_value=http):
            ns.send_sms_otp("9606595604", "111111")
        self.assertIn("msg91", http.__enter__.return_value.post.call_args[0][0])

    def test_a_refusal_or_a_network_failure_is_reported_as_not_sent(self):
        with switches(MSG91_AUTH_KEY="key", MSG91_OTP_TEMPLATE_ID="tpl"):
            refused = _msg91_client(401, '{"type":"error","message":"Authentication failure"}')
            with patch("app.services.notification_service.httpx.Client", return_value=refused):
                self.assertEqual(ns.send_sms_otp("9606595604", "111111")["status"], "send_failed")
            with patch("app.services.notification_service.httpx.Client", side_effect=RuntimeError("network down")):
                self.assertEqual(ns.send_sms_otp("9606595604", "111111")["status"], "send_failed")


class TestPhoneSignup(SignInBase):
    def _sent_code(self, sms):
        return sms.call_args[0][1]

    def test_a_new_number_is_closed_in_production_unless_phone_signup_is_opened(self):
        stranger = self.fresh_phone()
        with switches(ENV="production", ALLOW_SELF_REGISTRATION=False, OPEN_PHONE_SIGNUP=False), \
                patch("app.api.auth.send_sms_otp") as sms:
            r = client.post("/api/v1/auth/otp/request", json={"phone": stranger})
        self.assertEqual(r.status_code, 200)
        sms.assert_not_called()
        self.assertEqual(self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == stranger).count(), 0)

    def test_an_open_signup_sends_the_code_by_sms_and_the_code_makes_a_farmer_account(self):
        stranger = self.fresh_phone()
        with switches(ENV="production", ALLOW_SELF_REGISTRATION=False, OPEN_PHONE_SIGNUP=True), \
                patch("app.api.auth.send_sms_otp") as sms:
            sms.return_value = {"status": "dispatched"}
            asked = client.post("/api/v1/auth/otp/request", json={"phone": stranger})
            self.assertEqual(asked.status_code, 200, asked.text)
            self.assertEqual(asked.json()["channel"], "sms")
            self.assertNotIn("dev_otp", asked.json(), "the code is never in the answer outside development")
            code = self._sent_code(sms)
            self.assertEqual(len(code), 6)
            done = client.post("/api/v1/auth/otp/verify", json={"phone": stranger, "otp": code})
        self.assertEqual(done.status_code, 200, done.text)
        body = done.json()
        self.assertTrue(body["access_token"])
        self.assertTrue(body["is_new_user"])
        self.db.expire_all()
        user = self.db.query(User).filter(User.phone == stranger).one()
        self.assertIsNone(user.password_hash, "a mobile-number account has no password")
        self.assertIsNone(user.email)

    def test_a_wrong_code_signs_nobody_in_and_makes_no_account(self):
        stranger = self.fresh_phone()
        with switches(ENV="production", ALLOW_SELF_REGISTRATION=False, OPEN_PHONE_SIGNUP=True), \
                patch("app.api.auth.send_sms_otp") as sms:
            sms.return_value = {"status": "dispatched"}
            client.post("/api/v1/auth/otp/request", json={"phone": stranger})
            wrong = "000000" if self._sent_code(sms) != "000000" else "111111"
            r = client.post("/api/v1/auth/otp/verify", json={"phone": stranger, "otp": wrong})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.db.query(User).filter(User.phone == stranger).count(), 0)

    def test_one_number_gets_only_a_few_codes_an_hour(self):
        phone = self.fresh_phone()
        key = f"otp_hour:{phone[-10:]}"
        cache_service.delete(key)
        try:
            with switches(ENV="production", OTP_MAX_PER_PHONE_PER_HOUR=2):
                self.assertEqual([_too_many_codes(phone) for _ in range(3)], [False, False, True])
            with switches(ENV="development", OTP_MAX_PER_PHONE_PER_HOUR=2):
                self.assertFalse(_too_many_codes(phone), "nothing is sent on a developer machine, so there is no cap")
        finally:
            cache_service.delete(key)

    def test_the_request_route_refuses_the_extra_code(self):
        phone = self.fresh_phone()
        key = f"otp_hour:{phone[-10:]}"
        cache_service.delete(key)
        try:
            with switches(ENV="production", ALLOW_SELF_REGISTRATION=False, OPEN_PHONE_SIGNUP=True, OTP_MAX_PER_PHONE_PER_HOUR=1), \
                    patch("app.api.auth.send_sms_otp") as sms:
                sms.return_value = {"status": "dispatched"}
                first = client.post("/api/v1/auth/otp/request", json={"phone": phone})
                self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == phone).delete()
                self.db.commit()  # skip the 30 second wait between two codes
                second = client.post("/api/v1/auth/otp/request", json={"phone": phone})
            self.assertEqual((first.status_code, second.status_code), (200, 429), second.text)
            self.assertEqual(sms.call_count, 1)
        finally:
            cache_service.delete(key)


class TestPartnerPhoneVerificationBySms(SignInBase):
    """The partner portal proves a phone (account creation, invites, password reset) by SMS when WhatsApp is not set up."""

    def _send(self, phone):
        return client.post("/api/v1/auth/verify-phone/send", json={"phone_number": phone, "purpose": "registration"})

    def test_without_a_whatsapp_account_the_code_goes_by_sms(self):
        phone = self.fresh_phone()
        with switches(ENV="production", WHATSAPP_API_TOKEN="", WHATSAPP_PHONE_ID=""), \
                patch("app.services.phone_verification.send_sms_otp") as sms, \
                patch("app.services.phone_verification.send_whatsapp_otp") as whatsapp:
            sms.return_value = {"status": "dispatched"}
            r = self._send(phone)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["channel"], "sms")
        sms.assert_called_once()
        whatsapp.assert_not_called()
        self.assertNotIn("dev_otp", r.json())

    def test_a_gateway_that_refuses_is_a_503_and_leaves_no_code_behind(self):
        phone = self.fresh_phone()
        with switches(ENV="production", WHATSAPP_API_TOKEN="", WHATSAPP_PHONE_ID=""), \
                patch("app.services.phone_verification.send_sms_otp") as sms:
            sms.return_value = {"status": "send_failed"}
            r = self._send(phone)
        self.assertEqual(r.status_code, 503, r.text)
        self.assertEqual(self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == phone).count(), 0)

    def test_nothing_is_sent_from_a_developer_machine(self):
        phone = self.fresh_phone()
        with switches(ENV="development", OTP_SEND_IN_DEV=False), \
                patch("app.services.phone_verification.send_sms_otp") as sms, \
                patch("app.services.phone_verification.send_whatsapp_otp") as whatsapp:
            r = self._send(phone)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(len(r.json()["dev_otp"]), 6, "the code is in the answer instead of an SMS")
        sms.assert_not_called()
        whatsapp.assert_not_called()


class TestPartnerSeesTheirManufacturersName(SignInBase):
    """The web portal's header shows the manufacturer (Ajanta Pump Controller) to its distributors, and nothing to farmers."""

    def _brand(self, user, brand_key):
        from app.models import AppBrand
        row = self.db.query(AppBrand).filter(AppBrand.key == brand_key).one()
        user.brand_id = row.id
        self.db.commit()

    def test_an_ajanta_distributor_gets_ajanta_and_a_farmer_gets_nothing(self):
        distributor = self.make_user("distributor", "brand-dist")
        self._brand(distributor, "ajanta")
        farmer = self.make_user("customer", "brand-farmer")
        mine = client.get("/api/v1/brands/mine", headers=self.bearer(self.login(distributor).json()))
        self.assertEqual(mine.status_code, 200, mine.text)
        self.assertEqual(mine.json()["brand"]["key"], "ajanta")
        self.assertEqual(mine.json()["brand"]["name"], "Ajanta Pump Controller")
        theirs = client.get("/api/v1/brands/mine", headers=self.bearer(self.login(farmer).json()))
        self.assertEqual(theirs.json(), {"brand": None})

    def test_it_needs_a_signed_in_user(self):
        self.assertIn(client.get("/api/v1/brands/mine").status_code, (401, 403))


if __name__ == "__main__":
    unittest.main()
