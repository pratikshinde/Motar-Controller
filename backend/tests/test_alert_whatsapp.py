"""WhatsApp alerts through Meta's Cloud API: off by default, the template and its variables, number formats, and never an exception."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.config import settings
from app.services import alert_whatsapp as wa


def _db(pump_name="Rameshwar borewell", phone="+919999900006", latest=None):
    pump = SimpleNamespace(name=pump_name, owner_user_id="u1")
    owner = SimpleNamespace(phone_number=phone, phone=None)

    def query(model):
        q = MagicMock()
        name = getattr(model, "__name__", "")
        if name == "Pump":
            q.filter.return_value.first.return_value = pump
        elif name == "User":
            q.filter.return_value.first.return_value = owner
        else:
            q.filter.return_value.order_by.return_value.first.return_value = latest
        return q

    db = MagicMock()
    db.query.side_effect = query
    return db


class WhatsAppAlertTests(unittest.TestCase):
    KEYS = ("ALERT_WHATSAPP_ENABLED", "ALERT_WHATSAPP_TO", "WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_ID")

    def setUp(self):
        self._saved = {k: getattr(settings, k) for k in self.KEYS}

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(settings, k, v)

    def _on(self, to=""):
        settings.ALERT_WHATSAPP_ENABLED = True
        settings.ALERT_WHATSAPP_TO = to
        settings.WHATSAPP_API_TOKEN, settings.WHATSAPP_PHONE_ID = "token", "1234567890"

    def test_numbers_become_digits_with_the_country_code(self):
        for raw in ("+91 99999 00006", "09999900006", "9999900006", "919999900006", "+919999900006"):
            self.assertEqual(wa.whatsapp_number(raw), "919999900006", raw)

    def test_off_by_default_sends_nothing(self):
        settings.ALERT_WHATSAPP_ENABLED = False
        with patch.object(wa, "send_template") as send:
            self.assertEqual(wa.notify_fault(_db(), "AJANTA-DEMO-01", 6), 0)
        send.assert_not_called()

    def test_switched_on_without_a_token_sends_nothing(self):
        settings.ALERT_WHATSAPP_ENABLED = True
        settings.WHATSAPP_API_TOKEN = ""
        with patch.object(wa, "send_template") as send:
            self.assertEqual(wa.notify_no_contact(_db(), "AJANTA-DEMO-01"), 0)
        send.assert_not_called()

    def test_fault_uses_the_fault_template_with_the_starters_name(self):
        self._on()
        with patch.object(wa, "send_template", return_value=True) as send:
            self.assertEqual(wa.notify_fault(_db(), "AJANTA-DEMO-01", 6), 1)
        send.assert_called_once_with("+919999900006", settings.WHATSAPP_TPL_FAULT, ["Rameshwar borewell", "Cable open"])

    def test_no_contact_passes_the_pump_and_the_minutes(self):
        self._on()
        with patch.object(wa, "send_template", return_value=True) as send:
            wa.notify_no_contact(_db(), "AJANTA-DEMO-01")
        self.assertEqual(send.call_args[0][1:], (settings.WHATSAPP_TPL_NO_CONTACT, ["Rameshwar borewell", str(settings.OFFLINE_AFTER_SECONDS // 60)]))

    def test_back_online_passes_supply_and_state(self):
        self._on()
        with patch.object(wa, "send_template", return_value=True) as send:
            wa.notify_back(_db(latest=SimpleNamespace(v_ry=410.4, pump_on=True)), "AJANTA-DEMO-01")
        self.assertEqual(send.call_args[0][1:], (settings.WHATSAPP_TPL_BACK_ONLINE, ["Rameshwar borewell", "410", "running"]))

    def test_the_test_number_replaces_the_owner(self):
        self._on(to="+911111111111")
        with patch.object(wa, "send_template", return_value=True) as send:
            wa.notify_fault(_db(), "AJANTA-DEMO-01", 3)
        self.assertEqual(send.call_args[0][0], "+911111111111")

    def test_the_request_to_meta_is_a_template_message(self):
        self._on()
        client = MagicMock()
        client.__enter__.return_value.post.return_value = MagicMock(status_code=200, text="{}")
        with patch("app.services.alert_whatsapp.httpx.Client", return_value=client):
            self.assertTrue(wa.send_template("9999900006", "pump_fault_stop", ["Borewell", "Cable open"]))
        post = client.__enter__.return_value.post
        self.assertEqual(post.call_args[0][0], "https://graph.facebook.com/v21.0/1234567890/messages")
        self.assertEqual(post.call_args[1]["headers"]["Authorization"], "Bearer token")
        body = post.call_args[1]["json"]
        self.assertEqual(body["to"], "919999900006")
        self.assertEqual(body["type"], "template")
        self.assertEqual(body["template"]["name"], "pump_fault_stop")
        self.assertEqual(body["template"]["components"][0]["parameters"], [{"type": "text", "text": "Borewell"}, {"type": "text", "text": "Cable open"}])

    def test_meta_refusing_or_the_network_failing_is_logged_not_raised(self):
        self._on()
        refused = MagicMock()
        refused.__enter__.return_value.post.return_value = MagicMock(status_code=400, text='{"error":{"code":132001}}')
        with patch("app.services.alert_whatsapp.httpx.Client", return_value=refused):
            self.assertFalse(wa.send_template("9999900006", "t", ["a"]))
        with patch("app.services.alert_whatsapp.httpx.Client", side_effect=RuntimeError("network down")):
            self.assertFalse(wa.send_template("9999900006", "t", ["a"]))

    def test_an_owner_without_a_number_gets_nothing_and_no_error(self):
        self._on()
        with patch.object(wa, "send_template") as send:
            self.assertEqual(wa.notify_fault(_db(phone=None), "AJANTA-DEMO-01", 6), 0)
        send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
