"""The weekly schedule: saving it (GET / PUT /pumps/{id}/schedule) and the runner that sends START and STOP when a time comes due.

Runs against the local development database; every pump, command and schedule row created here is removed again.
Times are fixed: Monday 2026-11-09, and 06:00 / 09:00 in India time (UTC+5:30), which is 00:30 / 03:30 UTC.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import SessionLocal
from app.models import Command, Pump
from app.models.schedule import PumpSchedule, PumpScheduleEntry, PumpScheduleRun
from app.services import schedule_service as ss
from test_farmer_app import FarmerAppBase, client

UTC = timezone.utc
MON_0600 = datetime(2026, 11, 9, 0, 30, tzinfo=UTC)   # Monday 06:00 India time
MON_0900 = datetime(2026, 11, 9, 3, 30, tzinfo=UTC)   # Monday 09:00 India time
ENTRY = {"day_of_week": 0, "on_time": "06:00", "off_time": "09:00", "enabled": True}


def put(headers, pump_id, entries, enabled=True, **extra):
    return client.put(f"/api/v1/pumps/{pump_id}/schedule", json={"enabled": enabled, "entries": entries, **extra}, headers=headers)


class TestScheduleApi(FarmerAppBase):
    def test_a_pump_with_no_schedule_says_so(self):
        r = client.get(f"/api/v1/pumps/{self.pa1.id}/schedule", headers=self.ha)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["pump_id"], self.pa1.id)
        self.assertFalse(body["enabled"])
        self.assertEqual(body["entries"], [])
        self.assertIsNone(body["next"])
        self.assertEqual(body["recent"], [])
        self.assertEqual(body["timezone"], "Asia/Kolkata")
        self.assertEqual(body["limits"], {"min_window_minutes": 5, "min_gap_minutes": 5, "max_rows": 50})

    def test_saving_replaces_the_whole_schedule_and_says_what_is_next(self):
        r = put(self.ha, self.pa1.id, [ENTRY, {**ENTRY, "day_of_week": 2}, {**ENTRY, "day_of_week": 4, "on_time": "17:30", "off_time": "19:00"}])
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["enabled"])
        self.assertEqual([(e["day_of_week"], e["on_time"], e["off_time"]) for e in body["entries"]],
                         [(0, "06:00", "09:00"), (2, "06:00", "09:00"), (4, "17:30", "19:00")])
        self.assertTrue(all(e["id"] for e in body["entries"]))
        self.assertIn(body["next"]["kind"], ("START", "STOP"))
        self.assertRegex(body["next"]["local"], r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d$")
        again = client.get(f"/api/v1/pumps/{self.pa1.id}/schedule", headers=self.ha).json()
        self.assertEqual(len(again["entries"]), 3)
        # A second save replaces, it does not add.
        r = put(self.ha, self.pa1.id, [ENTRY], enabled=False)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(len(r.json()["entries"]), 1)
        self.assertFalse(r.json()["enabled"])
        self.assertIsNone(r.json()["next"], "a switched-off schedule has no next time")

    def test_the_rules_the_app_shows_are_enforced_by_the_server(self):
        cases = {
            "off not after on": [{**ENTRY, "on_time": "09:00", "off_time": "06:00"}],
            "too short": [{**ENTRY, "on_time": "06:00", "off_time": "06:04"}],
            "overlap": [ENTRY, {**ENTRY, "on_time": "08:00", "off_time": "10:00"}],
            "no gap": [ENTRY, {**ENTRY, "on_time": "09:03", "off_time": "10:00"}],
            "not a time": [{**ENTRY, "on_time": "6am"}],
            "hour 24": [{**ENTRY, "off_time": "24:00"}],
        }
        for why, entries in cases.items():
            r = put(self.ha, self.pa1.id, entries)
            self.assertEqual(r.status_code, 422, f"{why}: {r.text}")
        self.assertEqual(put(self.ha, self.pa1.id, [{**ENTRY, "day_of_week": 7}]).status_code, 422)
        self.assertEqual(put(self.ha, self.pa1.id, [ENTRY] * 51).status_code, 422)
        self.assertEqual(put(self.ha, self.pa1.id, [ENTRY], timezone="Not/AZone").status_code, 422)
        # A time that is switched off may overlap: it is never carried out.
        self.assertEqual(put(self.ha, self.pa1.id, [ENTRY, {**ENTRY, "on_time": "08:00", "off_time": "10:00", "enabled": False}]).status_code, 200)

    def test_a_refused_save_changes_nothing(self):
        self.assertEqual(put(self.ha, self.pa2.id, [ENTRY]).status_code, 200)
        self.assertEqual(put(self.ha, self.pa2.id, [{**ENTRY, "off_time": "05:00"}]).status_code, 422)
        kept = client.get(f"/api/v1/pumps/{self.pa2.id}/schedule", headers=self.ha).json()
        self.assertEqual([(e["on_time"], e["off_time"]) for e in kept["entries"]], [("06:00", "09:00")])

    def test_another_farmers_pump_is_invisible(self):
        self.assertEqual(client.get(f"/api/v1/pumps/{self.pb.id}/schedule", headers=self.ha).status_code, 404)
        self.assertEqual(put(self.ha, self.pb.id, [ENTRY]).status_code, 404)

    def test_remote_control_paused_means_no_schedule_changes(self):
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(Pump).filter(Pump.id == self.pb.id).update({"lifecycle_state": "SUSPENDED"})
        self.db.commit()
        try:
            self.assertEqual(put(self.hb, self.pb.id, [ENTRY]).status_code, 403)
        finally:
            self.db.query(Pump).filter(Pump.id == self.pb.id).update({"lifecycle_state": "ACTIVE"})
            self.db.commit()


class TestScheduleRunner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]
        cls.pump_ids = []
        from app.models import User
        cls.owner = User(
            id=uuid.uuid4(), full_name=f"Schedule Farmer {cls.sfx}", phone=f"+91{uuid.uuid4().int % 10**10:010d}", role="customer",
            hierarchy_path=f"/customers/{uuid.uuid4()}", account_status="ACTIVE", session_version=1, password_hash="notused",
        )
        cls.db.add(cls.owner)
        cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        from app.models import User
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(Command).filter(Command.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id == cls.owner.id).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    def setUp(self):
        self.db.execute(text("SET app.bypass_rls = 'on';"))

    def scheduled_pump(self, *, status="STOPPED", online=True, seen=MON_0600, lifecycle="ACTIVE", enabled=True, entries=None):
        pid = f"PUMP-SCH-{self.sfx}-{uuid.uuid4().hex[:5]}"
        self.db.add(Pump(
            id=pid, name="Schedule test pump", owner_user_id=self.owner.id, hierarchy_path="/SA", status=status, lifecycle_state=lifecycle,
            # The runner is given a made-up "now" (Monday morning), so "seen" is measured against that, not the real clock.
            last_seen_at=seen if online else seen - timedelta(days=1),
        ))
        self.db.flush()
        self.db.add(PumpSchedule(pump_id=pid, enabled=enabled, timezone="Asia/Kolkata"))
        for e in entries or [ENTRY]:
            self.db.add(PumpScheduleEntry(id=uuid.uuid4(), pump_id=pid, **e))
        self.db.commit()
        type(self).pump_ids.append(pid)
        return pid

    def runs(self, pid):
        self.db.expire_all()
        return self.db.query(PumpScheduleRun).filter(PumpScheduleRun.pump_id == pid).order_by(PumpScheduleRun.due_at).all()

    def commands(self, pid):
        self.db.expire_all()
        return self.db.query(Command).filter(Command.pump_id == pid).all()

    def test_a_start_that_comes_due_is_sent_once(self):
        pid = self.scheduled_pump()
        published = ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        runs = self.runs(pid)
        self.assertEqual([(r.kind, r.outcome, r.local_time, r.day_of_week) for r in runs], [("START", "SENT", "06:00", 0)])
        self.assertEqual(runs[0].due_at, MON_0600)
        cmds = self.commands(pid)
        self.assertEqual([(c.action, c.payload) for c in cmds], [("START", {"source": "schedule"})])
        self.assertEqual(published, [cmds[0].cid])
        self.assertEqual(runs[0].command_cid, cmds[0].cid)
        # The next look must not send it again.
        self.assertEqual(ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=2)), [])
        self.assertEqual(len(self.commands(pid)), 1)
        self.assertEqual(len(self.runs(pid)), 1)

    def test_nothing_is_sent_before_the_time_or_on_another_day(self):
        pid = self.scheduled_pump(entries=[{**ENTRY, "day_of_week": 1}])           # Tuesday only
        self.assertEqual(ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1)), [])
        self.assertEqual(self.runs(pid), [])
        pid2 = self.scheduled_pump()
        self.assertEqual(ss.run_schedule_tick(self.db, MON_0600 - timedelta(minutes=1)), [])
        self.assertEqual(self.runs(pid2), [])

    def test_a_stop_is_sent_when_the_pump_is_running(self):
        pid = self.scheduled_pump(status="RUNNING", seen=MON_0900)
        published = ss.run_schedule_tick(self.db, MON_0900 + timedelta(minutes=1))
        self.assertEqual([(r.kind, r.outcome) for r in self.runs(pid)], [("STOP", "SENT")])
        self.assertEqual([c.action for c in self.commands(pid)], ["STOP"])
        self.assertEqual(len(published), 1)

    def test_a_pump_already_in_the_wanted_state_is_left_alone(self):
        running = self.scheduled_pump(status="RUNNING")
        stopped = self.scheduled_pump(status="STOPPED", seen=MON_0900)
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        self.assertEqual([r.outcome for r in self.runs(running)], ["ALREADY_ON"])
        self.assertEqual(self.commands(running), [])
        ss.run_schedule_tick(self.db, MON_0900 + timedelta(minutes=1))
        self.assertEqual([r.outcome for r in self.runs(stopped)], ["SENT", "ALREADY_OFF"])

    def test_a_pump_with_a_fault_is_never_started(self):
        pid = self.scheduled_pump(status="FAULT")
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["SKIPPED_FAULT"])
        self.assertEqual(self.commands(pid), [])

    def test_a_paused_pump_is_blocked(self):
        pid = self.scheduled_pump(lifecycle="SUSPENDED")
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["BLOCKED"])
        self.assertEqual(self.commands(pid), [])

    def test_an_offline_pump_is_tried_for_ten_minutes_and_then_given_up_on(self):
        pid = self.scheduled_pump(online=False)
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["PENDING"])
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=8))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["PENDING"])
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=11))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["GAVE_UP"])
        self.assertEqual(self.commands(pid), [], "never sent late")

    def test_a_pump_that_comes_online_in_time_is_started(self):
        pid = self.scheduled_pump(online=False)
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        self.db.query(Pump).filter(Pump.id == pid).update({"last_seen_at": MON_0600 + timedelta(minutes=2)})
        self.db.commit()
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=3))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["SENT"])
        self.assertEqual([c.action for c in self.commands(pid)], ["START"])

    def test_a_time_the_server_slept_through_is_written_down_as_missed(self):
        pid = self.scheduled_pump()
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=30))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["MISSED"])
        self.assertEqual(self.commands(pid), [])

    def test_switching_the_schedule_off_cancels_a_time_still_waiting(self):
        pid = self.scheduled_pump(online=False)
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        self.db.query(PumpSchedule).filter(PumpSchedule.pump_id == pid).update({"enabled": False})
        self.db.commit()
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=2))
        self.assertEqual([r.outcome for r in self.runs(pid)], ["CANCELLED"])

    def test_a_switched_off_schedule_sends_nothing(self):
        pid = self.scheduled_pump(enabled=False)
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        self.assertEqual(self.runs(pid), [])
        self.assertEqual(self.commands(pid), [])

    def test_the_app_sees_what_happened_and_the_commands_own_state(self):
        pid = self.scheduled_pump()
        ss.run_schedule_tick(self.db, MON_0600 + timedelta(minutes=1))
        pump = self.db.query(Pump).filter(Pump.id == pid).first()
        body = ss.get_schedule(self.db, pump, now=MON_0600 + timedelta(minutes=2))
        self.assertEqual(len(body["recent"]), 1)
        run = body["recent"][0]
        self.assertEqual((run["kind"], run["outcome"], run["local"], run["time"], run["day_of_week"]), ("START", "SENT", "Mon 06:00", "06:00", 0))
        self.assertEqual(run["command_status"], "QUEUED", "the pump has not confirmed anything yet")
        self.assertEqual(body["next"]["kind"], "STOP")
        self.assertEqual(body["next"]["local"], "Mon 09:00")
        self.assertEqual(body["next"]["at"], MON_0900.isoformat())


if __name__ == "__main__":
    unittest.main()
