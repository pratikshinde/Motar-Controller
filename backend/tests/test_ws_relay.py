"""A push made by the ingest worker (another process) reaches the browsers held by the web server, through Redis."""
import asyncio
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.ws_hub import RELAY_CHANNEL, WebSocketHub


class FakeSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


class FakeRedis:
    def __init__(self):
        self.published = []

    def publish(self, channel, payload):
        self.published.append((channel, json.loads(payload)))


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class TestWsRelay(unittest.TestCase):
    def hub_with_a_superadmin(self):
        hub = WebSocketHub()
        ws = FakeSocket()
        hub.active_connections[ws] = {"role": "superadmin"}
        return hub, ws

    def test_a_push_is_delivered_here_and_handed_to_redis(self):
        hub, ws = self.hub_with_a_superadmin()
        fake = FakeRedis()
        hub._redis = lambda: fake
        run(hub.broadcast_pump_update("AJ-1", {"status": "RUNNING"}, "/SA"))
        self.assertEqual(ws.sent[0]["data"]["status"], "RUNNING")
        channel, payload = fake.published[0]
        self.assertEqual(channel, RELAY_CHANNEL)
        self.assertEqual(payload["origin"], hub.origin)
        self.assertEqual(payload["message"]["pump_id"], "AJ-1")

    def test_a_push_from_the_worker_reaches_the_browser_of_the_web_server(self):
        worker, _ = self.hub_with_a_superadmin()      # the ingest process: nobody is connected to it
        worker.active_connections.clear()
        fake = FakeRedis()
        worker._redis = lambda: fake
        run(worker.broadcast_pump_update("AJ-1", {"status": "RUNNING"}, "/SA"))

        web, ws = self.hub_with_a_superadmin()
        run(web.handle_relayed(json.dumps(fake.published[0][1])))
        self.assertEqual(len(ws.sent), 1)
        self.assertEqual(ws.sent[0]["type"], "telemetry")
        self.assertEqual(ws.sent[0]["pump_id"], "AJ-1")

    def test_a_process_ignores_its_own_relayed_message(self):
        hub, ws = self.hub_with_a_superadmin()
        own = json.dumps({"origin": hub.origin, "message": {"type": "telemetry", "pump_id": "X", "data": {}}, "path": "/SA", "alert_event": False})
        run(hub.handle_relayed(own))
        self.assertEqual(ws.sent, [])

    def test_without_redis_the_push_still_works_locally(self):
        hub, ws = self.hub_with_a_superadmin()
        hub._redis = lambda: None
        run(hub.broadcast_pump_update("AJ-2", {"status": "STOPPED"}, "/SA"))
        self.assertEqual(len(ws.sent), 1)

    def test_a_garbled_relayed_message_is_ignored(self):
        hub, ws = self.hub_with_a_superadmin()
        run(hub.handle_relayed("not json"))
        self.assertEqual(ws.sent, [])


if __name__ == "__main__":
    unittest.main()
