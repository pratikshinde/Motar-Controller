"""START / STOP for a SolarLogger go out in the short form {"on":1} / {"on":0}: its module hands over only the first ~58 bytes of a downlink."""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import Command, Pump
from app.services import command_dispatch


class FakePump:
    def __init__(self, device_type):
        self.device_type = device_type


class FakeDb:
    def __init__(self, pump):
        self.pump = pump

    def query(self, *_):
        return self

    def filter(self, *_):
        return self

    def first(self):
        return self.pump


def cmd(action):
    now = datetime.now(timezone.utc)
    return Command(cid=uuid.uuid4(), pump_id="862818041287022", action=action, payload={}, issued_at=now, expires_at=now + timedelta(minutes=2), actor_id=None)


class TestSolarCommandMessage(unittest.TestCase):
    def test_start_and_stop_are_the_short_form_for_a_solar_logger(self):
        db = FakeDb(FakePump("SOLAR_VFD"))
        self.assertEqual(command_dispatch._message_for(db, cmd("START"))["on"], 1)
        self.assertEqual(command_dispatch._message_for(db, cmd("STOP"))["on"], 0)

    def test_it_fits_in_what_the_module_hands_over(self):
        import json
        topic = "devices/862818041287022/commands"
        prefix = len("\r\n+QMTRECV: 0,1,") + len(topic) + 1
        for action in ("START", "STOP"):
            payload = json.dumps(command_dispatch._message_for(FakeDb(FakePump("SOLAR_VFD")), cmd(action)), separators=(",", ":"))
            self.assertGreater(prefix + len(payload), 58, action)
            self.assertTrue(payload.startswith('{"on":%d,"' % (1 if action == "START" else 0)), payload)

    def test_other_devices_and_other_commands_keep_the_full_envelope(self):
        for pump, action in ((FakePump("AC_3PH"), "START"), (FakePump("SOLAR_VFD"), "SET_TIMER")):
            msg = command_dispatch._message_for(FakeDb(pump), cmd(action))
            self.assertEqual(msg["cmd"], action)
            self.assertIn("cid", msg)


if __name__ == "__main__":
    unittest.main()
