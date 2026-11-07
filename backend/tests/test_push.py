"""Push notifications: off without a key, the message Firebase is sent, dead tokens are dropped, and nothing raises."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.config import settings
from app.services import push

ACCOUNT = {"project_id": "ajanta-pump", "client_email": "x@y.iam.gserviceaccount.com", "private_key": "k"}


def _client(status, text=""):
    client = MagicMock()
    client.__enter__.return_value.post.return_value = MagicMock(status_code=status, text=text)
    return client


class PushTests(unittest.TestCase):
    def setUp(self):
        self._saved = settings.FIREBASE_SERVICE_ACCOUNT_FILE

    def tearDown(self):
        settings.FIREBASE_SERVICE_ACCOUNT_FILE = self._saved

    def test_off_without_a_key_file(self):
        settings.FIREBASE_SERVICE_ACCOUNT_FILE = ""
        self.assertFalse(push.enabled())
        settings.FIREBASE_SERVICE_ACCOUNT_FILE = "C:/no/such/file.json"
        self.assertFalse(push.enabled())

    def test_the_message_goes_to_the_phone_with_the_pump_and_a_high_priority_channel(self):
        client = _client(200)
        with patch.object(push, "_key_file", return_value=ACCOUNT), patch.object(push, "_access_token", return_value="tok"), patch(
            "app.services.push.httpx.Client", return_value=client
        ):
            self.assertEqual(push.send_to_token("phone-token", "Pump stopped", "Cable open.", {"pump_id": "P1"}), "ok")
        post = client.__enter__.return_value.post
        url = post.call_args[0][0]
        body = post.call_args[1]["json"]["message"]
        self.assertTrue(url.endswith("/v1/projects/ajanta-pump/messages:send"))
        self.assertEqual(post.call_args[1]["headers"]["Authorization"], "Bearer tok")
        self.assertEqual(body["token"], "phone-token")
        self.assertEqual(body["notification"], {"title": "Pump stopped", "body": "Cable open."})
        self.assertEqual(body["data"], {"pump_id": "P1"})
        self.assertEqual(body["android"]["priority"], "HIGH")
        self.assertEqual(body["android"]["notification"]["channel_id"], "alerts")

    def test_a_token_firebase_does_not_know_is_reported_invalid(self):
        with patch.object(push, "_key_file", return_value=ACCOUNT), patch.object(push, "_access_token", return_value="tok"), patch(
            "app.services.push.httpx.Client", return_value=_client(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}')
        ):
            self.assertEqual(push.send_to_token("old", "t", "b"), "invalid")

    def test_other_failures_are_errors_not_exceptions(self):
        with patch.object(push, "_key_file", return_value=ACCOUNT), patch.object(push, "_access_token", return_value="tok"):
            with patch("app.services.push.httpx.Client", return_value=_client(500, "boom")):
                self.assertEqual(push.send_to_token("t", "t", "b"), "error")
            with patch("app.services.push.httpx.Client", side_effect=RuntimeError("network down")):
                self.assertEqual(push.send_to_token("t", "t", "b"), "error")
        with patch.object(push, "_key_file", return_value=None):
            self.assertEqual(push.send_to_token("t", "t", "b"), "error")

    def test_dead_tokens_are_deleted_and_live_ones_counted(self):
        live, dead = SimpleNamespace(token="a"), SimpleNamespace(token="b")
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [live, dead]
        outcomes = {"a": "ok", "b": "invalid"}
        with patch.object(push, "enabled", return_value=True), patch.object(
            push, "send_to_token", side_effect=lambda token, *a, **k: outcomes[token]
        ):
            self.assertEqual(push.notify_users(db, ["u1"], "t", "b"), 1)
        db.delete.assert_called_once_with(dead)
        db.commit.assert_called()

    def test_nothing_is_sent_while_push_is_off(self):
        db = MagicMock()
        with patch.object(push, "enabled", return_value=False), patch.object(push, "send_to_token") as send:
            self.assertEqual(push.notify_users(db, ["u1"], "t", "b"), 0)
        send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
