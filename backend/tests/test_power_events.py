"""Power events: the farmer's phone is told when the power came, when it went, and when a fault stops the pump.

Runs against the local development database; every pump, event and alert created here is removed again.
"""
import asyncio
import json
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.models import Alert, FaultCodeCatalog, Pump
from app.models.power import PumpPowerEvent
from app.services import power_service as ps, pump_notify
from app.services.connectivity_sweep import sweep_connectivity
from app.workers.ingest import process_batch
from test_farmer_app import FarmerAppBase, client

UTC = timezone.utc


class TestPowerRules(unittest.TestCase):
    def test_power_is_on_when_any_line_voltage_is_present(self):
        self.assertEqual(ps.state_from_voltages(415, 412, 410), "ON")
        self.assertEqual(ps.state_from_voltages(0, 0, 410), "ON", "one phase left is still power; a lost phase is a fault, not a power cut")
        self.assertEqual(ps.state_from_voltages(0, 0, 0), "OFF")
        self.assertEqual(ps.state_from_voltages(5, 19.9, 3), "OFF")
        self.assertIsNone(ps.state_from_voltages(None, None, None), "no voltages reported is not 'no power'")


class PowerBase(FarmerAppBase):
    def setUp(self):
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.pushes = []
        patcher = mock.patch("app.services.push.notify_pump", side_effect=lambda db, pid, title, body, extra=None: self.pushes.append((pid, title, body, extra)) or 1)
        patcher.start()
        self.addCleanup(patcher.stop)

    def pump(self, tag, **fields):
        p = self._pump(tag, self.a, **fields)
        self.db.expire_all()
        return p

    def events(self, pid):
        self.db.expire_all()
        return [(e.state, e.source) for e in self.db.query(PumpPowerEvent).filter(PumpPowerEvent.pump_id == pid).order_by(PumpPowerEvent.occurred_at)]

    def pump_in(self, tag, lifecycle_state):
        pid = self.pump(tag).id
        self.db.query(Pump).filter(Pump.id == pid).update({"lifecycle_state": lifecycle_state})
        self.db.commit()
        return pid

    def fresh(self, pid):
        self.db.expire_all()
        return self.db.query(Pump).filter(Pump.id == pid).first()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(PumpPowerEvent).filter(PumpPowerEvent.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            super().tearDownClass()


class TestPowerState(PowerBase):
    def test_the_first_reading_sets_the_state_silently_and_a_change_is_announced(self):
        pid = self.pump("PW1").id
        pump = self.fresh(pid)
        first = ps.observe_reading(self.db, pump, 415, 412, 410, False)
        self.assertFalse(first.notify, "nothing changed yet: it is just the first thing we know")
        self.db.commit()
        self.assertEqual((self.fresh(pid).power_state, self.fresh(pid).power_source), ("ON", "VOLTAGE"))
        self.assertIsNone(ps.observe_reading(self.db, self.fresh(pid), 410, 411, 409, False), "still on: no event")

        gone = ps.observe_reading(self.db, self.fresh(pid), 0, 0, 0, False)
        self.db.commit()
        self.assertEqual((gone.state, gone.source, gone.notify), ("OFF", "VOLTAGE", True))
        ps.announce(self.db, gone)
        self.assertEqual(len(self.pushes), 1)
        self.assertEqual(self.pushes[0][1], "Power gone")
        self.assertIn("the power went at", self.pushes[0][2])
        self.assertEqual(self.pushes[0][3], {"type": "POWER", "state": "OFF"})

        back = ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        self.db.commit()
        ps.announce(self.db, back)
        self.assertEqual(self.pushes[1][1], "Power is back")
        self.assertIn("the power came at", self.pushes[1][2])
        self.assertEqual(self.events(pid), [("ON", "VOLTAGE"), ("OFF", "VOLTAGE"), ("ON", "VOLTAGE")])

    def test_a_replayed_reading_from_the_buffer_changes_nothing(self):
        pid = self.pump("PW2").id
        ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        self.db.commit()
        self.assertIsNone(ps.observe_reading(self.db, self.fresh(pid), 0, 0, 0, True))
        self.assertEqual(self.fresh(pid).power_state, "ON")

    def test_a_pump_that_goes_quiet_may_have_lost_power_and_is_on_again_when_it_is_heard(self):
        pid = self.pump("PW3").id
        ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        self.db.commit()
        quiet = ps.observe_silence(self.db, self.fresh(pid))
        self.db.commit()
        self.assertEqual((quiet.state, quiet.source), ("OFF", "CONTACT"))
        ps.announce(self.db, quiet)
        self.assertEqual(self.pushes[-1][1], "Power may be off", "silence is not proof, so it says 'may'")
        self.assertIsNone(ps.observe_silence(self.db, self.fresh(pid)), "already off: one event per outage")
        alive = ps.observe_alive(self.db, self.fresh(pid))
        self.db.commit()
        self.assertEqual((alive.state, alive.source), ("ON", "CONTACT"))
        ps.announce(self.db, alive)
        self.assertEqual(self.pushes[-1][1], "Power is back")
        self.assertIsNone(ps.observe_alive(self.db, self.fresh(pid)), "nothing to undo")

    def test_a_pump_that_says_it_has_no_voltage_is_not_flipped_on_by_a_heartbeat(self):
        pid = self.pump("PW4").id
        ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        ps.observe_reading(self.db, self.fresh(pid), 0, 0, 0, False)
        self.db.commit()
        self.assertIsNone(ps.observe_alive(self.db, self.fresh(pid)))
        self.assertEqual(self.fresh(pid).power_state, "OFF")

    def test_a_solar_pump_has_no_mains_power_to_lose(self):
        pid = self.pump("PW5", device_type="SOLAR_VFD").id
        self.assertIsNone(ps.observe_reading(self.db, self.fresh(pid), 0, 0, 0, False))
        self.assertIsNone(ps.observe_silence(self.db, self.fresh(pid)))
        self.assertIsNone(self.fresh(pid).power_state)

    def test_the_pump_says_whether_the_power_is_on(self):
        pid = self.pump("PW6").id
        ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        ps.observe_reading(self.db, self.fresh(pid), 0, 0, 0, False)
        self.db.commit()
        pump = client.get(f"/api/v1/pumps/{pid}", headers=self.ha).json()["pump"]
        self.assertEqual((pump["power_state"], pump["power_source"]), ("OFF", "VOLTAGE"))
        self.assertTrue(pump["power_changed_at"])
        listed = {p["id"]: p for p in client.get("/api/v1/pumps", headers=self.ha).json()["pumps"]}
        self.assertEqual(listed[pid]["power_state"], "OFF")


class TestWhatIsPushed(PowerBase):
    def frame(self, pid, volts, seq):
        return {"clientid": pid, "dev_id": pid, "vl": volts, "i": [0, 0, 0], "mot": 0, "st": 0, "flt": 0, "rt": 10, "rssi": -70, "seq": seq}

    def send(self, body):
        handled = asyncio.run(process_batch([{"Body": json.dumps(body), "ReceiptHandle": f"r-{body.get('seq')}"}]))
        self.assertTrue(handled)

    def test_readings_from_the_starter_tell_when_the_power_came_and_went(self):
        pid = self.pump("PW7").id
        base = 7_000_000 + int(self.sfx[:3], 16)
        self.send(self.frame(pid, [415, 412, 410], base))
        self.assertEqual(self.pushes, [], "the first reading is not a change")
        self.send(self.frame(pid, [0, 0, 0], base + 1))
        self.send(self.frame(pid, [0, 0, 0], base + 2))
        self.send(self.frame(pid, [414, 413, 412], base + 3))
        self.assertEqual([p[1] for p in self.pushes], ["Power gone", "Power is back"], "one push per change, none for repeats")
        self.assertEqual(self.events(pid), [("ON", "VOLTAGE"), ("OFF", "VOLTAGE"), ("ON", "VOLTAGE")])

    def test_a_fault_is_an_alert_and_one_push_however_often_it_repeats(self):
        if not self.db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == 5).first():
            self.db.add(FaultCodeCatalog(code=5, name="DryRun", severity="HIGH", description="DryRun"))
            self.db.commit()
        pid = self.pump("PW8").id
        before = len(self.pushes)
        for n in range(3):
            asyncio.run(process_batch([{"Body": json.dumps({"clientid": pid, "cmd": "fault", "code": 5, "desc": "DryRun", "vl": [415, 412, 410], "i": [2, 0, 2]}), "ReceiptHandle": f"r-flt-{n}"}]))
        self.db.expire_all()
        self.assertTrue(self.db.query(Alert).filter(Alert.pump_id == pid, Alert.alert_type == "FAULT").first(), "it is in the Alerts list")
        mine = self.pushes[before:]
        self.assertEqual([(p[0], p[1], p[3]) for p in mine], [(pid, "Pump fault", {"type": "FAULT", "fault_code": "5"})], "the phone is pushed once")
        self.assertIn("Dry Run Fault", mine[0][2], "in the starter's own words")

    def test_a_fault_that_comes_back_after_it_was_cleared_is_told_again(self):
        if not self.db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == 5).first():
            self.db.add(FaultCodeCatalog(code=5, name="DryRun", severity="HIGH", description="DryRun"))
            self.db.commit()
        pid = self.pump("PW8C").id
        base = 7_300_000 + int(self.sfx[:3], 16)
        trip = lambda n: asyncio.run(process_batch([{"Body": json.dumps({"clientid": pid, "cmd": "fault", "code": 5, "desc": "DryRun", "vl": [415, 412, 410], "i": [0, 0, 0]}), "ReceiptHandle": f"r-again-{n}"}]))
        self.send(self.frame(pid, [415, 412, 410], base))                  # healthy, stopped
        before = len(self.pushes)
        trip(1)
        self.assertEqual([p[1] for p in self.pushes[before:]], ["Pump fault"], "the trip is told")
        trip(2)
        self.assertEqual(len(self.pushes[before:]), 1, "the same trip repeating while it is still active is not")
        self.send(self.frame(pid, [415, 412, 410], base + 1))              # the fault was cleared: healthy again
        trip(3)
        self.assertEqual([p[1] for p in self.pushes[before:]], ["Pump fault", "Pump fault"], "it came back: told again")

    def test_while_the_power_is_gone_only_that_is_pushed_and_with_power_a_fault_is(self):
        pid = self.pump("PW8B").id
        ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        self.db.commit()
        before = len(self.pushes)
        pump_notify.fault(self.db, pid, 8)
        self.assertEqual([p[1] for p in self.pushes[before:]], ["Pump fault"], "power is there and a fault stopped the pump: the fault is told")
        ps.observe_reading(self.db, self.fresh(pid), 0, 0, 0, False)       # power gone: that is what the phone is told
        self.db.commit()
        before = len(self.pushes)
        for code in (1, 2, 8):
            pump_notify.fault(self.db, pid, code)
        self.assertEqual(self.pushes[before:], [], "'Power gone' says it; no fault message while there is no supply")

    def test_a_pump_silent_for_two_minutes_is_taken_to_have_lost_power_even_before_it_is_commissioned(self):
        from app.services import connectivity_sweep as cswp
        pid = self.pump_in("PW11", "ALLOCATED")
        ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        self.db.commit()
        self.db.query(Pump).filter(Pump.id == pid).update({"last_seen_at": datetime.now(UTC) - timedelta(seconds=settings.POWER_SILENCE_SECONDS - 30)})
        self.db.commit()
        self.assertEqual(cswp.sweep_power_silence(self.db), [], "not silent long enough yet")
        self.db.query(Pump).filter(Pump.id == pid).update({"last_seen_at": datetime.now(UTC) - timedelta(seconds=settings.POWER_SILENCE_SECONDS + 5)})
        self.db.commit()
        changes = cswp.sweep_power_silence(self.db)
        self.assertEqual([(c.pump_id, c.state, c.source) for c in changes if c.pump_id == pid], [(pid, "OFF", "CONTACT")])
        for c in changes:
            ps.announce(self.db, c)
        self.assertIn("Power may be off", [p[1] for p in self.pushes if p[0] == pid])
        self.assertEqual([c for c in cswp.sweep_power_silence(self.db) if c.pump_id == pid], [], "one message per outage")

    def test_a_pump_in_stock_is_not_watched_for_power(self):
        from app.services import connectivity_sweep as cswp
        pid = self.pump_in("PW12", "IN_STOCK")
        ps.observe_reading(self.db, self.fresh(pid), 415, 415, 415, False)
        self.db.query(Pump).filter(Pump.id == pid).update({"last_seen_at": datetime.now(UTC) - timedelta(hours=1)})
        self.db.commit()
        self.assertEqual([c for c in cswp.sweep_power_silence(self.db) if c.pump_id == pid], [])

    def test_a_pump_that_stops_reporting_gets_an_alert_and_a_power_may_be_off_push_only(self):
        pid = self.pump("PW9", last_seen_at=datetime.now(UTC) - timedelta(seconds=settings.OFFLINE_AFTER_SECONDS + 60)).id
        self.send(self.frame(pid, [415, 412, 410], 7_100_000 + int(self.sfx[:3], 16)))     # powered, reporting
        self.db.query(Pump).filter(Pump.id == pid).update({"last_seen_at": datetime.now(UTC) - timedelta(seconds=settings.OFFLINE_AFTER_SECONDS + 60)})
        self.db.commit()
        from app.services import connectivity_sweep as cswp
        with mock.patch.object(cswp, "system_session") as fake:
            fake.return_value.__enter__.return_value = self.db
            fake.return_value.__exit__.return_value = False
            cswp._sweep()
        self.db.expire_all()
        self.assertTrue(self.db.query(Alert).filter(Alert.pump_id == pid, Alert.alert_type == "OFFLINE", Alert.resolved_at.is_(None)).first())
        mine = [p for p in self.pushes if p[0] == pid]
        self.assertEqual([p[1] for p in mine], ["Power may be off"], "no 'Pump offline' push any more")

    def test_pump_notify_pushes_a_fault_but_not_offline_or_back_online(self):
        pid = self.pump("PW10").id
        before = len(self.pushes)
        pump_notify.no_contact(self.db, pid)
        pump_notify.back_online(self.db, pid)
        self.assertEqual(self.pushes[before:], [], "offline and back-online are only in the Alerts list")
        pump_notify.fault(self.db, pid, 5)
        self.assertEqual([p[1] for p in self.pushes[before:]], ["Pump fault"])


if __name__ == "__main__":
    unittest.main()
