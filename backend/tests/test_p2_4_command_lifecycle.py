"""P2.4 command lifecycle: state machine, publishing, idempotency, cooldown, acks, interim confirmation, sweep.

Runs against the local development database with a recording publisher: nothing here talks to AWS.
"""
import asyncio
import json
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.main import app
from app.database import SessionLocal
from app.models import AuditLog, Command, Pump, TelemetryHistory, User
from app.services import command_service as cs
from app.services.command_dispatch import announcements
from app.services.iot_publisher import (
    BothPublisher, PublishError, apply_network_preference, build_envelope, command_topic, set_publisher,
)
from app.services.jwt_auth import hash_secret, sign_token
from app.workers.ingest import process_batch

client = TestClient(app)


class RecordingPublisher:
    def __init__(self, fail_with=None):
        self.sent = []
        self.fail_with = fail_with

    def publish(self, topic, message):
        if self.fail_with:
            raise PublishError(self.fail_with)
        self.sent.append((topic, message))


def _bearer(user: User) -> dict:
    token = sign_token({"sub": str(user.id), "role": user.role, "hierarchy_path": user.hierarchy_path, "session_ver": 1})
    return {"Authorization": f"Bearer {token}"}


class LifecycleBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]
        cls.user = User(
            id=uuid.uuid4(), full_name=f"Lifecycle {cls.sfx}", phone=f"+9177{cls.sfx}0"[:14], role="customer",
            hierarchy_path=f"/customers/{uuid.uuid4()}", account_status="ACTIVE", session_version=1,
            password_hash=hash_secret("Lifecycle-Test-9x"),
        )
        cls.db.add(cls.user)
        cls.db.commit()
        cls.headers = _bearer(cls.user)
        cls.pump_ids = []

    def setUp(self):
        self.pub = RecordingPublisher()
        set_publisher(self.pub)
        self._mode = settings.IOT_PUBLISH_MODE

    def tearDown(self):
        settings.IOT_PUBLISH_MODE = self._mode
        set_publisher(None)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(Command).filter(Command.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id == cls.user.id).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    # -- helpers ------------------------------------------------------------------------------------------------
    def new_pump(self, **kw) -> Pump:
        pid = f"PUMP-LC-{uuid.uuid4().hex[:8]}"
        pump = Pump(id=pid, name="Lifecycle pump", supply_type="3-phase", hp_rating=7.5, owner_user_id=self.user.id,
                    hierarchy_path="/SA", status="STOPPED", lifecycle_state="ACTIVE", **kw)
        self.db.add(pump)
        self.db.commit()
        type(self).pump_ids.append(pid)
        return pump

    def send(self, pump, action="START", key=None, url="commands", payload=None):
        headers = dict(self.headers)
        if key:
            headers["Idempotency-Key"] = key
        body = {"command": action}
        if payload:
            body["payload"] = payload
        return client.post(f"/api/v1/pumps/{pump.id}/{url}", json=body, headers=headers)

    def row(self, cid) -> Command:
        self.db.expire_all()
        return self.db.query(Command).filter(Command.cid == uuid.UUID(str(cid))).one()

    def open_cooldown(self, pump):
        """Pretend the previous command was long ago, so the next request is not held by the 45 s cooldown."""
        self.db.query(Command).filter(Command.pump_id == pump.id).update(
            {Command.issued_at: datetime.now(timezone.utc) - timedelta(seconds=cs.COMMAND_COOLDOWN_SECONDS + 5)}
        )
        self.db.commit()

    def reading(self, pump, mot, at=None, buffered=False):
        """A telemetry reading arriving now, the way the ingestion worker hands it to the lifecycle."""
        moved = cs.observe_reading(self.db, pump.id, bool(mot), at or datetime.now(timezone.utc), buffered=buffered)
        self.db.commit()
        return moved


class TestStateMachine(LifecycleBase):
    def make(self, status=cs.QUEUED):
        pump = self.new_pump()
        cmd = cs.create_command(self.db, pump.id, "START", {}, self.user.id)
        if status != cs.QUEUED:
            cmd.status = status
            self.db.commit()
        return cmd

    def test_forward_path_stamps_each_step(self):
        cmd = self.make()
        self.assertEqual(cmd.status, cs.QUEUED)
        for state, column in [(cs.SENT, "sent_at"), (cs.DELIVERED, "delivered_at"),
                              (cs.ACKNOWLEDGED, "acked_at"), (cs.APPLIED, "applied_at")]:
            self.assertTrue(cs.transition(self.db, cmd, state))
            self.assertIsNotNone(getattr(cmd, column), column)
        self.db.commit()

    def test_steps_may_be_skipped_and_leave_no_false_timestamp(self):
        cmd = self.make()
        cs.transition(self.db, cmd, cs.SENT)
        cs.transition(self.db, cmd, cs.APPLIED)
        self.assertIsNone(cmd.delivered_at)
        self.assertIsNone(cmd.acked_at)
        self.assertIsNotNone(cmd.applied_at)

    def test_illegal_transitions_are_refused(self):
        cmd = self.make()
        with self.assertRaises(cs.IllegalTransition):
            cs.transition(self.db, cmd, cs.APPLIED)          # never sent
        cs.transition(self.db, cmd, cs.SENT)
        cs.transition(self.db, cmd, cs.ACKNOWLEDGED)
        with self.assertRaises(cs.IllegalTransition):
            cs.transition(self.db, cmd, cs.SENT)             # backwards
        with self.assertRaises(cs.IllegalTransition):
            cs.transition(self.db, cmd, cs.QUEUED)
        cs.transition(self.db, cmd, cs.NOT_CONFIRMED, reason="no_confirmation")
        for later in (cs.APPLIED, cs.REJECTED, cs.EXPIRED, cs.SENT):
            with self.assertRaises(cs.IllegalTransition):     # terminal states stay terminal
                cs.transition(self.db, cmd, later)

    def test_same_state_is_a_no_op_and_stale_events_are_ignored(self):
        cmd = self.make()
        cs.transition(self.db, cmd, cs.SENT)
        self.assertFalse(cs.transition(self.db, cmd, cs.SENT))
        cs.transition(self.db, cmd, cs.APPLIED)
        self.assertFalse(cs.advance(self.db, cmd, cs.DELIVERED))     # a late "delivered" after "applied"
        self.assertEqual(cmd.status, cs.APPLIED)

    def test_failure_states_record_a_reason(self):
        cmd = self.make()
        cs.transition(self.db, cmd, cs.FAILED, reason="publish_failed")
        self.assertEqual(cmd.failure_reason, "publish_failed")
        rej = self.make(cs.SENT)
        cs.transition(self.db, rej, cs.REJECTED, reason="expired")
        self.assertEqual(rej.reject_reason, "expired")

    def test_every_change_is_audited(self):
        cmd = self.make()
        cs.transition(self.db, cmd, cs.SENT)
        cs.transition(self.db, cmd, cs.APPLIED)
        self.db.commit()
        actions = [a.action for a in self.db.query(AuditLog).filter(AuditLog.entity_id == str(cmd.cid)).order_by(AuditLog.id)]
        self.assertEqual(actions, ["COMMAND_QUEUED", "COMMAND_SENT", "COMMAND_APPLIED"])

    def test_event_shape_for_clients(self):
        cmd = self.make()
        event = cs.command_event(cmd)
        for key in ("cid", "pump_id", "command", "status", "created_at", "sent_at", "applied_at", "expires_at", "payload"):
            self.assertIn(key, event)
        self.assertEqual(event["status"], "QUEUED")
        (announced, path), = announcements(self.db, [cmd])
        self.assertEqual(announced["cid"], event["cid"])
        self.assertEqual(path, "/SA")


class TestPublishing(LifecycleBase):
    def test_start_is_queued_then_sent_on_the_srs_topic(self):
        pump = self.new_pump()
        r = self.send(pump, "START")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()["command"]
        self.assertEqual(body["status"], "QUEUED")       # the response is honest: nothing has reached a pump

        cmd = self.row(body["cid"])
        self.assertEqual(cmd.status, cs.SENT)
        self.assertIsNotNone(cmd.sent_at)
        (topic, message), = self.pub.sent
        self.assertEqual(topic, f"devices/{pump.id}/commands")
        self.assertEqual(message["v"], 1)
        self.assertEqual(message["cid"], str(cmd.cid))
        self.assertEqual(message["cmd"], "START")
        self.assertTrue(message["actor"].startswith("usr_"))
        self.assertGreater(message["expiry"], message["ts"])
        self.assertNotIn("params", message)

    def test_timer_carries_its_values(self):
        pump = self.new_pump()
        r = client.put(f"/api/v1/pumps/{pump.id}/timer", json={"on_duration_minutes": 30, "off_duration_minutes": 10,
                                                              "cycle_count": 2, "mode": "CYCLIC"}, headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        (_, message), = self.pub.sent
        self.assertEqual(message["cmd"], "SET_TIMER")
        self.assertEqual(message["params"]["on_duration_minutes"], 30)
        self.assertEqual(self.row(r.json()["command"]["cid"]).status, cs.SENT)

    def test_a_refused_publish_is_failed_not_sent(self):
        pump = self.new_pump()
        set_publisher(RecordingPublisher(fail_with="publish_failed"))
        cid = self.send(pump).json()["command"]["cid"]
        cmd = self.row(cid)
        self.assertEqual((cmd.status, cmd.failure_reason), (cs.FAILED, "publish_failed"))
        self.assertIsNone(cmd.sent_at)

    def test_with_no_channel_configured_the_command_fails_visibly(self):
        pump = self.new_pump()
        settings.IOT_PUBLISH_MODE = "off"
        set_publisher(None)
        cid = self.send(pump).json()["command"]["cid"]
        cmd = self.row(cid)
        self.assertEqual((cmd.status, cmd.failure_reason), (cs.FAILED, "publisher_disabled"))

    def test_expired_before_it_could_be_sent(self):
        pump = self.new_pump()
        cmd = cs.create_command(self.db, pump.id, "START", {}, self.user.id, ttl_seconds=1)
        cmd.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
        self.db.commit()
        from app.services.command_dispatch import _dispatch
        _dispatch(cmd.cid)
        self.assertEqual(self.row(cmd.cid).status, cs.EXPIRED)
        self.assertEqual(self.pub.sent, [])

    def test_a_command_is_published_once(self):
        pump = self.new_pump()
        cid = self.send(pump).json()["command"]["cid"]
        from app.services.command_dispatch import _dispatch
        _dispatch(uuid.UUID(cid))                       # a duplicate task: nothing more to do
        self.assertEqual(len(self.pub.sent), 1)


class TestIdempotencyAndCooldown(LifecycleBase):
    def test_same_key_never_sends_twice(self):
        pump = self.new_pump()
        key = f"key-{uuid.uuid4().hex}"
        first = self.send(pump, key=key)
        # The other route alias skips the HTTP replay cache, so this exercises the database guard itself.
        second = self.send(pump, key=key, url="command")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()["command"]["cid"], second.json()["command"]["cid"])
        self.assertEqual(len(self.pub.sent), 1)
        self.assertEqual(self.db.query(Command).filter(Command.pump_id == pump.id).count(), 1)

    def test_cooldown_is_the_servers_decision(self):
        pump = self.new_pump()
        self.assertEqual(self.send(pump, "START").status_code, 200)
        r = self.send(pump, "STOP")
        self.assertEqual(r.status_code, 429)
        seconds = r.json()["error"]["params"]["seconds"]
        self.assertTrue(1 <= seconds <= cs.COMMAND_COOLDOWN_SECONDS)
        self.assertEqual(r.json()["error"]["params"]["retry_after"], seconds)
        self.assertEqual(int(r.headers["Retry-After"]), seconds)
        self.assertEqual(len(self.pub.sent), 1)

    def test_a_command_that_never_left_the_server_does_not_hold_the_next_one_back(self):
        pump = self.new_pump()
        set_publisher(RecordingPublisher(fail_with="publish_failed"))
        self.assertEqual(self.row(self.send(pump, "START").json()["command"]["cid"]).status, cs.FAILED)
        set_publisher(self.pub)
        retry = self.send(pump, "START")            # no 45 s wait: the pump was never asked
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(self.row(retry.json()["command"]["cid"]).status, cs.SENT)
        self.assertEqual(self.send(pump, "STOP").status_code, 429)   # but a command that WAS sent still does

    def test_a_held_timer_does_not_change_the_saved_timer(self):
        pump = self.new_pump()
        self.assertEqual(self.send(pump, "START").status_code, 200)
        r = client.put(f"/api/v1/pumps/{pump.id}/timer", json={"on_duration_minutes": 99}, headers=self.headers)
        self.assertEqual(r.status_code, 429)
        saved = client.get(f"/api/v1/pumps/{pump.id}/timer", headers=self.headers).json()
        self.assertIsNone(saved["timer"])

    def test_retrying_a_timer_with_its_key_does_not_send_it_again(self):
        pump = self.new_pump()
        headers = {**self.headers, "Idempotency-Key": f"t-{uuid.uuid4().hex}"}
        a = client.put(f"/api/v1/pumps/{pump.id}/timer", json={"on_duration_minutes": 15}, headers=headers)
        b = client.post(f"/api/v1/pumps/{pump.id}/timer", json={"on_duration_minutes": 15}, headers=headers)
        self.assertEqual((a.status_code, b.status_code), (200, 200), b.text)
        self.assertEqual(a.json()["command"]["cid"], b.json()["command"]["cid"])
        self.assertEqual(len(self.pub.sent), 1)


class TestAcks(LifecycleBase):
    def sent(self, pump, action="START"):
        self.open_cooldown(pump)
        cid = self.send(pump, action).json()["command"]["cid"]
        return self.row(cid)

    def test_bare_layer_a_ack_settles_the_newest_matching_command(self):
        pump = self.new_pump()
        cmd = self.sent(pump)
        moved = cs.apply_ack(self.db, pump.id, {"cmd": "ack", "ref": "motor_cmd", "ok": 1})
        self.db.commit()
        self.assertEqual(moved.cid, cmd.cid)
        self.assertEqual(self.row(cmd.cid).status, cs.ACKNOWLEDGED)
        self.assertIsNotNone(self.row(cmd.cid).acked_at)

    def test_ack_for_another_kind_of_command_is_not_guessed_at(self):
        pump = self.new_pump()
        cmd = self.sent(pump, "START")
        self.assertIsNone(cs.apply_ack(self.db, pump.id, {"cmd": "ack", "ref": "settings", "ok": 1}))
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)

    def test_ack_with_ok_zero_rejects(self):
        pump = self.new_pump()
        cmd = self.sent(pump)
        cs.apply_ack(self.db, pump.id, {"cmd": "ack", "ref": "motor_cmd", "ok": 0})
        self.db.commit()
        row = self.row(cmd.cid)
        self.assertEqual((row.status, row.reject_reason), (cs.REJECTED, "device_refused"))

    def test_ack_with_cid_is_exact_and_switches_off_interim_mode(self):
        pump = self.new_pump()
        cmd = self.sent(pump)
        cs.apply_ack(self.db, pump.id, {"v": 1, "type": "CMD_ACK", "cid": str(cmd.cid), "stage": "delivered"})
        self.db.commit()
        self.assertEqual(self.row(cmd.cid).status, cs.DELIVERED)
        self.db.expire_all()
        self.assertTrue(self.db.query(Pump).filter(Pump.id == pump.id).one().supports_command_ack)
        # From now on a matching reading alone proves nothing for this device: it must say so itself.
        self.assertEqual(self.reading(pump, 1), [])
        cs.apply_ack(self.db, pump.id, {"type": "CMD_ACK", "cid": str(cmd.cid), "stage": "acknowledged"})
        self.db.commit()
        self.assertEqual([c.status for c in self.reading(pump, 1)], [cs.APPLIED])

    def test_explicit_applied_and_rejected_stages(self):
        pump = self.new_pump()
        cmd = self.sent(pump)
        cs.apply_ack(self.db, pump.id, {"type": "CMD_ACK", "cid": str(cmd.cid), "stage": "applied"})
        self.db.commit()
        row = self.row(cmd.cid)
        self.assertEqual(row.status, cs.APPLIED)
        self.assertIsNotNone(row.acked_at)          # applying implies it was acknowledged

        other = self.sent(pump, "STOP")
        cs.apply_ack(self.db, pump.id, {"type": "CMD_ACK", "cid": str(other.cid), "stage": "rejected", "reason": "expired"})
        self.db.commit()
        self.assertEqual((self.row(other.cid).status, self.row(other.cid).reject_reason), (cs.REJECTED, "expired"))

    def test_late_ack_after_the_command_settled_changes_nothing(self):
        pump = self.new_pump()
        cmd = self.sent(pump)
        cs.apply_ack(self.db, pump.id, {"type": "CMD_ACK", "cid": str(cmd.cid), "stage": "applied"})
        self.db.commit()
        self.assertIsNone(cs.apply_ack(self.db, pump.id, {"type": "CMD_ACK", "cid": str(cmd.cid), "stage": "delivered"}))
        self.assertEqual(self.row(cmd.cid).status, cs.APPLIED)

    def test_ack_from_another_pump_cannot_touch_this_command(self):
        pump, other = self.new_pump(), self.new_pump()
        cmd = self.sent(pump)
        self.assertIsNone(cs.apply_ack(self.db, other.id, {"type": "CMD_ACK", "cid": str(cmd.cid), "stage": "applied"}))
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)

    def test_parse_ack_recognises_only_acks(self):
        self.assertIsNone(cs.parse_ack({"cmd": "status", "mot": 1}))
        self.assertIsNone(cs.parse_ack({"v": 1, "st": {"mot": 1}}))
        self.assertEqual(cs.parse_ack({"cmd": "ack", "ref": "motor_cmd", "ok": 1})["stage"], "acknowledged")
        self.assertEqual(cs.parse_ack({"cmd": "ack", "ref": "motor_cmd", "ok": 0})["stage"], "rejected")


class TestInterimConfirmation(LifecycleBase):
    def sent(self, pump, action):
        self.open_cooldown(pump)
        return self.row(self.send(pump, action).json()["command"]["cid"])

    def test_reading_after_send_that_matches_settles_start_and_stop(self):
        pump = self.new_pump()
        start = self.sent(pump, "START")
        self.assertEqual([c.status for c in self.reading(pump, 1)], [cs.APPLIED])
        self.assertIsNotNone(self.row(start.cid).applied_at)
        stop = self.sent(pump, "STOP")
        self.assertEqual([c.cid for c in self.reading(pump, 0)], [stop.cid])

    def test_a_reading_in_the_wrong_state_proves_nothing(self):
        pump = self.new_pump()
        cmd = self.sent(pump, "START")
        self.assertEqual(self.reading(pump, 0), [])
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)

    def test_a_reading_from_before_the_send_or_a_replayed_one_proves_nothing(self):
        pump = self.new_pump()
        cmd = self.sent(pump, "START")
        self.assertEqual(self.reading(pump, 1, at=cmd.sent_at - timedelta(seconds=30)), [])
        self.assertEqual(self.reading(pump, 1, buffered=True), [])
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)

    def test_values_are_never_inferred_from_a_reading(self):
        pump = self.new_pump()
        self.open_cooldown(pump)
        r = client.put(f"/api/v1/pumps/{pump.id}/timer", json={"on_duration_minutes": 20}, headers=self.headers)
        cid = r.json()["command"]["cid"]
        self.reading(pump, 1)
        self.assertEqual(self.row(cid).status, cs.SENT)      # a timer cannot be proven by "the motor is on"

    def test_the_flag_switches_inference_off(self):
        pump = self.new_pump()
        cmd = self.sent(pump, "START")
        settings.COMMAND_INTERIM_CONFIRM = False
        try:
            self.assertEqual(self.reading(pump, 1), [])
        finally:
            settings.COMMAND_INTERIM_CONFIRM = True
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)

    def test_http_telemetry_settles_the_command_too(self):
        pump = self.new_pump()
        cmd = self.sent(pump, "START")
        r = client.post("/api/v1/telemetry", json={"dev_id": pump.id, "vl": [415, 412, 410], "i": [12, 11, 12], "mot": 1,
                                                  "flt": 0, "rt": 100}, headers={"X-Device-Id": pump.id})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.row(cmd.cid).status, cs.APPLIED)

    def test_http_telemetry_repeating_a_sequence_number_is_ignored_not_an_error(self):
        pump = self.new_pump()
        body = {"dev_id": pump.id, "vl": [415, 412, 410], "i": [0, 0, 0], "mot": 0, "flt": 0, "seq": 424242}
        first = client.post("/api/v1/telemetry", json=body, headers={"X-Device-Id": pump.id})
        again = client.post("/api/v1/telemetry", json=body, headers={"X-Device-Id": pump.id})
        self.assertEqual((first.status_code, again.status_code), (200, 200), again.text)
        self.assertEqual(again.json()["message"], "Duplicate reading ignored")
        self.assertEqual(self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == pump.id).count(), 1)

    def test_http_telemetry_without_motor_state_settles_nothing(self):
        pump = self.new_pump()
        cmd = self.sent(pump, "STOP")     # would match a missing "mot" read as off
        r = client.post("/api/v1/telemetry", json={"dev_id": pump.id, "vl": [415, 412, 410]}, headers={"X-Device-Id": pump.id})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)


class TestSweep(LifecycleBase):
    def sweep(self, pump, seconds_from_now):
        moved = cs.sweep_open_commands(self.db, now=datetime.now(timezone.utc) + timedelta(seconds=seconds_from_now),
                                       pump_ids=[pump.id])
        self.db.commit()
        return {c.cid: c for c in moved}

    def test_nothing_happens_before_the_confirmation_window(self):
        pump = self.new_pump()
        cmd = self.row(self.send(pump).json()["command"]["cid"])
        self.assertEqual(self.sweep(pump, 5), {})
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)

    def test_no_proof_within_the_window_is_not_confirmed_never_applied(self):
        pump = self.new_pump()
        cmd = self.row(self.send(pump).json()["command"]["cid"])
        moved = self.sweep(pump, settings.COMMAND_CONFIRM_SECONDS + 5)
        self.assertEqual(moved[cmd.cid].status, cs.NOT_CONFIRMED)
        self.assertEqual(self.row(cmd.cid).failure_reason, "no_confirmation")
        self.assertIsNone(self.row(cmd.cid).applied_at)
        # A late reading cannot turn it into a success after the fact.
        self.assertEqual(self.reading(pump, 1), [])
        self.assertEqual(self.row(cmd.cid).status, cs.NOT_CONFIRMED)

    def test_a_command_never_sent_expires(self):
        pump = self.new_pump()
        cmd = cs.create_command(self.db, pump.id, "START", {}, self.user.id)
        moved = self.sweep(pump, settings.COMMAND_TTL_SECONDS + 5)
        self.assertEqual(moved[cmd.cid].status, cs.EXPIRED)
        self.assertEqual(self.row(cmd.cid).failure_reason, "not_sent_in_time")

    def test_ack_capable_device_expires_at_its_deadline_not_at_60_seconds(self):
        pump = self.new_pump(supports_command_ack=True)
        cmd = self.row(self.send(pump).json()["command"]["cid"])
        self.assertEqual(self.sweep(pump, settings.COMMAND_CONFIRM_SECONDS + 5), {})
        moved = self.sweep(pump, settings.COMMAND_TTL_SECONDS + 5)
        self.assertEqual(moved[cmd.cid].status, cs.EXPIRED)
        self.assertEqual(self.row(cmd.cid).failure_reason, "no_response")

    def test_ack_capable_device_that_acked_but_never_showed_the_change(self):
        pump = self.new_pump(supports_command_ack=True)
        cmd = self.row(self.send(pump).json()["command"]["cid"])
        cs.apply_ack(self.db, pump.id, {"type": "CMD_ACK", "cid": str(cmd.cid), "stage": "acknowledged"})
        self.db.commit()
        moved = self.sweep(pump, settings.COMMAND_TTL_SECONDS + 5)
        self.assertEqual((moved[cmd.cid].status, self.row(cmd.cid).failure_reason), (cs.NOT_CONFIRMED, "applied_not_seen"))

    def test_settled_commands_are_left_alone(self):
        pump = self.new_pump()
        cmd = self.row(self.send(pump).json()["command"]["cid"])
        self.reading(pump, 1)
        self.assertEqual(self.sweep(pump, 3600), {})
        self.assertEqual(self.row(cmd.cid).status, cs.APPLIED)


class TestDeviceChannelAndIngest(LifecycleBase):
    def sent(self, pump, action="START"):
        self.open_cooldown(pump)
        return self.row(self.send(pump, action).json()["command"]["cid"])

    def test_outbox_channel_round_trip_as_the_simulator_does_it(self):
        settings.IOT_PUBLISH_MODE = "outbox"
        set_publisher(None)
        pump = self.new_pump()
        headers = {"X-Device-Id": pump.id}
        cid = self.send(pump, "START").json()["command"]["cid"]
        self.assertEqual(self.row(cid).status, cs.SENT)

        got = client.get("/api/v1/telemetry/commands", headers=headers)
        self.assertEqual(got.status_code, 200, got.text)
        (message,) = got.json()["commands"]
        self.assertEqual((message["cid"], message["cmd"]), (cid, "START"))
        self.assertEqual(self.row(cid).status, cs.DELIVERED)
        self.assertEqual(client.get("/api/v1/telemetry/commands", headers=headers).json()["commands"], [])

        ack = client.post("/api/v1/telemetry/ack", json={"cmd": "ack", "ref": "motor_cmd", "ok": 1}, headers=headers)
        self.assertEqual((ack.status_code, ack.json()["status"]), (200, cs.ACKNOWLEDGED), ack.text)
        client.post("/api/v1/telemetry", json={"dev_id": pump.id, "vl": [415, 412, 410], "i": [12, 11, 12], "mot": 1, "flt": 0},
                    headers=headers)
        row = self.row(cid)
        self.assertEqual(row.status, cs.APPLIED)
        self.assertTrue(row.sent_at <= row.delivered_at <= row.acked_at <= row.applied_at)
        # The whole journey is in the audit trail, written by the device's own context.
        actions = [a.action for a in self.db.query(AuditLog).filter(AuditLog.entity_id == cid).order_by(AuditLog.id)]
        self.assertEqual(actions, ["COMMAND_QUEUED", "COMMAND_SENT", "COMMAND_DELIVERED", "COMMAND_ACKNOWLEDGED", "COMMAND_APPLIED"])

    def test_the_http_device_channel_does_not_exist_outside_outbox_mode(self):
        settings.IOT_PUBLISH_MODE = "aws"
        pump = self.new_pump()
        self.assertEqual(client.get("/api/v1/telemetry/commands", headers={"X-Device-Id": pump.id}).status_code, 404)
        self.assertEqual(client.post("/api/v1/telemetry/ack", json={"cmd": "ack", "ok": 1}, headers={"X-Device-Id": pump.id}).status_code, 404)

    def test_both_mode_publishes_to_aws_and_keeps_the_simulator_channel(self):
        settings.IOT_PUBLISH_MODE = "both"
        aws = RecordingPublisher()
        set_publisher(BothPublisher(aws=aws))
        pump = self.new_pump()
        cid = self.send(pump, "STOP").json()["command"]["cid"]
        self.assertEqual(self.row(cid).status, cs.SENT)
        self.assertEqual([(topic, message["cid"]) for topic, message in aws.sent], [(command_topic(pump.id), cid)])
        got = client.get("/api/v1/telemetry/commands", headers={"X-Device-Id": pump.id})
        self.assertEqual(got.status_code, 200, got.text)
        self.assertEqual([m["cid"] for m in got.json()["commands"]], [cid])

    def test_both_mode_fails_the_command_when_aws_refuses_it(self):
        settings.IOT_PUBLISH_MODE = "both"
        set_publisher(BothPublisher(aws=RecordingPublisher(fail_with="publish_failed")))
        pump = self.new_pump()
        cid = self.send(pump, "STOP").json()["command"]["cid"]
        row = self.row(cid)
        self.assertEqual((row.status, row.failure_reason), (cs.FAILED, "publish_failed"))
        got = client.get("/api/v1/telemetry/commands", headers={"X-Device-Id": pump.id})
        self.assertEqual(got.json()["commands"], [], "a command AWS refused is not offered to the simulator either")

    def test_ack_endpoint_refuses_frames_that_are_not_acks(self):
        settings.IOT_PUBLISH_MODE = "outbox"
        pump = self.new_pump()
        r = client.post("/api/v1/telemetry/ack", json={"cmd": "status", "mot": 1}, headers={"X-Device-Id": pump.id})
        self.assertEqual(r.status_code, 422)

    def test_sqs_ingest_routes_acks_to_commands_and_readings_settle_them(self):
        pump = self.new_pump()
        cmd = self.sent(pump)

        def message(body):
            return {"ReceiptHandle": uuid.uuid4().hex, "Body": json.dumps({"clientid": pump.id, **body})}

        rows_before = self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == pump.id).count()
        ack = message({"cmd": "ack", "ref": "motor_cmd", "ok": 1})
        handled = asyncio.run(process_batch([ack]))
        self.assertEqual(handled, [ack["ReceiptHandle"]])
        self.assertEqual(self.row(cmd.cid).status, cs.ACKNOWLEDGED)
        # An ack is not a reading: no telemetry row, and the pump's status is untouched.
        self.assertEqual(self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == pump.id).count(), rows_before)

        status = message({"v": 1, "id": pump.id, "ts": int(datetime.now(timezone.utc).timestamp()), "seq": 7,
                          "st": {"mot": 1, "state": 2, "fault": 0}, "el": {"vl": [415, 412, 410], "i": [12, 11, 12]}})
        asyncio.run(process_batch([status]))
        self.assertEqual(self.row(cmd.cid).status, cs.APPLIED)

    def test_sqs_replayed_reading_does_not_settle_a_command(self):
        pump = self.new_pump()
        cmd = self.sent(pump)
        buffered = {"ReceiptHandle": uuid.uuid4().hex, "Body": json.dumps({
            "clientid": pump.id, "v": 1, "id": pump.id, "ts": int(datetime.now(timezone.utc).timestamp()), "seq": 8, "buf": True,
            "st": {"mot": 1, "state": 2, "fault": 0}, "el": {"vl": [415, 412, 410], "i": [12, 11, 12]}})}
        asyncio.run(process_batch([buffered]))
        self.assertEqual(self.row(cmd.cid).status, cs.SENT)


class TestStatusEndpoints(LifecycleBase):
    def test_both_status_routes_report_the_new_fields(self):
        pump = self.new_pump()
        cid = self.send(pump).json()["command"]["cid"]
        for url in (f"/api/v1/pumps/{pump.id}/commands/{cid}", f"/api/v1/commands/{cid}"):
            body = client.get(url, headers=self.headers).json()
            self.assertEqual(body["status"], cs.SENT)
            self.assertIsNotNone(body["sent_at"])
            self.assertIsNone(body["applied_at"])
            self.assertIn("failure_reason", body)

    def test_envelope_builder(self):
        pump = self.new_pump()
        cmd = cs.create_command(self.db, pump.id, "SET_TIMER", {"on_duration_minutes": 5}, None)
        env = build_envelope(cmd)
        self.assertEqual(env["actor"], "system")
        self.assertEqual(env["params"], {"on_duration_minutes": 5})
        self.assertEqual(command_topic("ABC"), "devices/ABC/commands")


class TestPublisherSettings(unittest.TestCase):
    def test_both_is_a_development_convenience_only(self):
        saved = (settings.IOT_PUBLISH_MODE, settings.ENV)
        try:
            settings.IOT_PUBLISH_MODE = "both"
            settings.ENV = "development"
            self.assertEqual(settings.publish_mode(), "both")
            settings.ENV = "test"
            self.assertEqual(settings.publish_mode(), "aws", "anywhere but development, 'both' means the real broker only")
        finally:
            settings.IOT_PUBLISH_MODE, settings.ENV = saved

    def test_force_ipv4_makes_urllib3_skip_ipv6(self):
        import urllib3.util.connection as urllib3_connection

        saved = (settings.IOT_FORCE_IPV4, urllib3_connection.HAS_IPV6)
        try:
            settings.IOT_FORCE_IPV4, urllib3_connection.HAS_IPV6 = False, True
            apply_network_preference()
            self.assertTrue(urllib3_connection.HAS_IPV6, "off by default: nothing changes")
            settings.IOT_FORCE_IPV4 = True
            apply_network_preference()
            self.assertFalse(urllib3_connection.HAS_IPV6)
        finally:
            settings.IOT_FORCE_IPV4, urllib3_connection.HAS_IPV6 = saved


if __name__ == "__main__":
    unittest.main()
