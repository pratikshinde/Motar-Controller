"""SMS alerts to a pump's owner: off by default, the right words, the test number, and never an exception."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.config import settings
from app.services import alert_sms


def _db(pump_name="Rameshwar borewell", phone="+919999900006", latest=None):
    """A database stand-in: Pump, User and the latest reading come back in the order the service asks for them."""
    pump = SimpleNamespace(name=pump_name, owner_user_id="u1")
    owner = SimpleNamespace(phone_number=phone, phone=None)

    def query(model):
        q = MagicMock()
        name = getattr(model, "__name__", "")
        if name == "Pump":
            q.filter.return_value.first.return_value = pump
        elif name == "User":
            q.filter.return_value.first.return_value = owner
        else:  # the latest telemetry row
            q.filter.return_value.order_by.return_value.first.return_value = latest
        return q

    db = MagicMock()
    db.query.side_effect = query
    return db


class AlertSmsTests(unittest.TestCase):
    def setUp(self):
        self._saved = (settings.ALERT_SMS_ENABLED, settings.ALERT_SMS_TO, settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_PHONE_NUMBER)

    def tearDown(self):
        (settings.ALERT_SMS_ENABLED, settings.ALERT_SMS_TO, settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_PHONE_NUMBER) = self._saved

    def _on(self, to=""):
        settings.ALERT_SMS_ENABLED = True
        settings.ALERT_SMS_TO = to
        settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_PHONE_NUMBER = "ACtest", "token", "+10000000000"

    def test_off_by_default_sends_nothing(self):
        settings.ALERT_SMS_ENABLED = False
        with patch.object(alert_sms, "send_sms") as send:
            self.assertEqual(alert_sms.notify_fault(_db(), "AJANTA-DEMO-01", 6), 0)
        send.assert_not_called()

    def test_switched_on_without_a_twilio_account_sends_nothing(self):
        settings.ALERT_SMS_ENABLED = True
        settings.TWILIO_ACCOUNT_SID = ""
        with patch.object(alert_sms, "send_sms") as send:
            self.assertEqual(alert_sms.notify_no_contact(_db(), "AJANTA-DEMO-01"), 0)
        send.assert_not_called()

    def test_fault_text_uses_the_starters_own_name_and_goes_to_the_owner(self):
        self._on()
        with patch.object(alert_sms, "send_sms", return_value=True) as send:
            self.assertEqual(alert_sms.notify_fault(_db(), "AJANTA-DEMO-01", 6), 1)
        send.assert_called_once_with("+919999900006", "Rameshwar borewell stopped: Cable open.")

    def test_no_contact_text_names_the_minutes(self):
        self._on()
        with patch.object(alert_sms, "send_sms", return_value=True) as send:
            alert_sms.notify_no_contact(_db(), "AJANTA-DEMO-01")
        body = send.call_args[0][1]
        self.assertIn("no contact for", body)
        self.assertIn("power may be off", body)

    def test_back_online_text_says_the_supply_voltage_and_the_state(self):
        self._on()
        latest = SimpleNamespace(v_ry=410.4, pump_on=False)
        with patch.object(alert_sms, "send_sms", return_value=True) as send:
            alert_sms.notify_back(_db(latest=latest), "AJANTA-DEMO-01")
        self.assertEqual(send.call_args[0][1], "Rameshwar borewell is back online (supply 410 V). The pump is stopped.")

    def test_the_test_number_replaces_the_owner(self):
        self._on(to="+911111111111")
        with patch.object(alert_sms, "send_sms", return_value=True) as send:
            alert_sms.notify_fault(_db(), "AJANTA-DEMO-01", 3)
        self.assertEqual(send.call_args[0][0], "+911111111111")

    def test_an_owner_without_a_number_gets_nothing_and_no_error(self):
        self._on()
        with patch.object(alert_sms, "send_sms") as send:
            self.assertEqual(alert_sms.notify_fault(_db(phone=None), "AJANTA-DEMO-01", 6), 0)
        send.assert_not_called()

    def test_twilio_failure_is_logged_not_raised(self):
        self._on()
        with patch("app.services.alert_sms.httpx.Client", side_effect=RuntimeError("network down")):
            self.assertFalse(alert_sms.send_sms("+919999900006", "x"))
        res = MagicMock(status_code=400)
        client = MagicMock()
        client.__enter__.return_value.post.return_value = res
        with patch("app.services.alert_sms.httpx.Client", return_value=client):
            self.assertFalse(alert_sms.send_sms("+919999900006", "x"))

    def test_an_unknown_fault_code_still_makes_a_message(self):
        self._on()
        with patch.object(alert_sms, "send_sms", return_value=True) as send:
            alert_sms.notify_fault(_db(), "AJANTA-DEMO-01", 42)
        self.assertEqual(send.call_args[0][1], "Rameshwar borewell stopped: fault 42.")


if __name__ == "__main__":
    unittest.main()
