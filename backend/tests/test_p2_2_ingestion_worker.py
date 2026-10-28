"""
P2.2 Ingestion Worker — Unit + Integration tests
=================================================

Tests:
  1. Normaliser — v1 envelope parsed correctly
  2. Normaliser — legacy MCU format parsed correctly
  3. FR-SEC-032 — spoofed dev_id rejected
  4. FR-CLD-026 — duplicate (pump_id, seq) row is idempotent (not doubled)
  5. Fault events — FaultLog created + alert raised
  6. process_batch — unknown device skipped gracefully
  7. SUSPENDED/RETIRED devices skipped
"""
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

import pytest
from httpx import AsyncClient
from sqlalchemy.orm import Session

# ── app imports ──────────────────────────────────────────────────────────────
from app.database import SessionLocal, engine, Base
from app.models import (
    Pump, TelemetryHistory, FaultLog, User, DeviceBatch, BatchImei,
    FaultCodeCatalog,
)
from app.workers.ingest import frame_kind, normalise, parse_fault, parse_vfd, process_batch

# ── helpers ──────────────────────────────────────────────────────────────────
TEST_DEVICE_ID = "IMEI_TEST_INGEST_001"
TEST_CLIENT_ID = TEST_DEVICE_ID

LEGACY_PAYLOAD = {
    "dev_id": TEST_DEVICE_ID,
    "vl": [415.0, 412.0, 410.0],
    "i": [12.1, 11.9, 12.0],
    "mot": 1,
    "st": 2,
    "flt": 0,
    "rt": 100,
    "rssi": -78,
    "seq": 1001,
}

V1_PAYLOAD = {
    "v": 1,
    "id": TEST_DEVICE_ID,
    "ts": 1766000000,
    "seq": 2001,
    "tsApprox": False,
    "buf": False,
    "st": {"mot": 1, "state": 2, "fault": 0},
    "el": {"vl": [415, 412, 410], "i": [12, 11, 12]},
    "rt": {"totalMin": 100},
    "net": {"rssi": -78, "op": "40410", "tech": "LTE"},
}

FAULT_PAYLOAD = {
    "dev_id": TEST_DEVICE_ID,
    "vl": [415.0, 0.0, 410.0],
    "i": [2.0, 0.0, 2.0],
    "mot": 0,
    "st": 3,
    "flt": 5,         # DryRun fault code
    "rt": 100,
    "rssi": -82,
    "seq": 3001,
}


def _make_sqs_msg(payload: Dict[str, Any], client_id: str = TEST_CLIENT_ID, receipt: str = "r1") -> Dict:
    import json
    body = dict(payload)
    body["clientid"] = client_id
    return {"Body": json.dumps(body), "ReceiptHandle": receipt}


class TestNormaliser:
    """Unit tests for the normalise() function — no DB needed."""

    def test_legacy_format(self):
        telem, spoofed = normalise(LEGACY_PAYLOAD, TEST_CLIENT_ID)
        assert not spoofed
        assert telem.device_id == TEST_CLIENT_ID
        assert telem.pump_on is True
        assert telem.fault_active is False
        assert telem.v_ry == 415.0
        assert telem.seq == 1001
        assert telem.gsm_rssi == -78

    def test_v1_envelope(self):
        telem, spoofed = normalise(V1_PAYLOAD, TEST_CLIENT_ID)
        assert not spoofed
        assert telem.device_id == TEST_CLIENT_ID
        assert telem.pump_on is True
        assert telem.fault_active is False
        assert telem.v_ry == 415.0
        assert telem.seq == 2001
        assert telem.ts_approx is False
        assert telem.buffered is False
        assert telem.gsm_rssi == -78

    def test_spoofed_dev_id_detected(self):
        payload = dict(LEGACY_PAYLOAD)
        payload["dev_id"] = "ANOTHER_DEVICE"
        _, spoofed = normalise(payload, TEST_CLIENT_ID)
        assert spoofed is True

    def test_v1_fault_parsed(self):
        payload = dict(V1_PAYLOAD)
        payload["st"] = {"mot": 0, "state": 3, "fault": 5}
        telem, _ = normalise(payload, TEST_CLIENT_ID)
        assert telem.fault_active is True
        assert telem.fault_code == 5

    def test_missing_client_id_not_spoofed(self):
        """A payload with no dev_id field is not treated as spoofed (client_id wins)."""
        payload = {k: v for k, v in LEGACY_PAYLOAD.items() if k != "dev_id"}
        _, spoofed = normalise(payload, TEST_CLIENT_ID)
        assert spoofed is False


class TestFrameKinds:
    """Which uplink frames are readings. No DB needed."""

    def test_only_status_frames_and_the_v1_envelope_are_readings(self):
        assert frame_kind(LEGACY_PAYLOAD) == "telemetry"                     # no `cmd`: what the bridge forwards today
        assert frame_kind({**LEGACY_PAYLOAD, "cmd": "status"}) == "telemetry"
        assert frame_kind(V1_PAYLOAD) == "telemetry"
        assert frame_kind({"cmd": "reg", "dev_id": "0123456789ABCDEF01234567", "fw": "1.0.367"}) == "registration"
        for cmd in ("heartbeat", "pong", "ping", "net_status", "reg_ack", "HEARTBEAT"):
            assert frame_kind({"cmd": cmd}) == "liveness", cmd
        for cmd in ("settings", "nonsense"):
            assert frame_kind({"cmd": cmd}) == "unknown", cmd

    def test_a_trip_is_a_fault_in_either_shape_and_not_a_reading(self):
        assert frame_kind({"cmd": "fault", "code": 5, "vl": [415, 0, 410], "i": [2, 0, 2]}) == "fault"
        assert frame_kind({"v": 1, "ts": 1766001234, "type": "TRIP", "code": 5}) == "fault"   # layer B event: no `cmd`


SOLAR_FRAME = {"cmd": "status", "mot": 1, "st": 2, "flt": 0, "rt": 600,
               "vfd": {"hz": 49.8, "i_out": 10.9, "v_ac": 412.5, "v_dc": 679.0, "kw": 5.45, "status": "RUNNING", "fault_code": 0}}


class TestSolarReadings:
    """A solar drive's `vfd` object, no DB needed."""

    def test_the_drive_is_read_from_a_legacy_frame_and_from_the_v1_envelope(self):
        legacy, _ = normalise(SOLAR_FRAME, TEST_CLIENT_ID)
        assert legacy.vfd == {"hz": 49.8, "i_out": 10.9, "v_ac": 412.5, "v_dc": 679.0, "kw": 5.45, "status": "RUNNING", "fault_code": 0}
        assert legacy.v_ry is None, "a solar pump sends no three-phase voltages"
        v1, _ = normalise({"v": 1, "ts": 1766000000, "seq": 9, "st": {"mot": 1, "state": 2, "fault": 0}, "vfd": SOLAR_FRAME["vfd"]}, TEST_CLIENT_ID)
        assert v1.vfd["kw"] == 5.45 and v1.pump_on is True

    def test_a_bad_value_is_dropped_and_the_rest_of_the_reading_is_kept(self):
        vfd = parse_vfd({"hz": 49.8, "kw": 9999, "v_dc": "abc", "i_out": -3, "status": "RUNNING", "fault_code": 123456})
        assert vfd == {"hz": 49.8, "i_out": None, "v_ac": None, "v_dc": None, "kw": None, "status": "RUNNING", "fault_code": None}

    def test_nothing_usable_means_no_vfd(self):
        for raw in (None, "x", [], {}, {"kw": "n/a"}):
            assert parse_vfd(raw) is None, raw

    def test_without_mot_the_drive_decides_whether_the_motor_is_on(self):
        running, _ = normalise({"cmd": "status", "vfd": {"status": "RUNNING", "hz": 0}}, TEST_CLIENT_ID)
        stopped, _ = normalise({"cmd": "status", "vfd": {"status": "STOPPED", "hz": 50}}, TEST_CLIENT_ID)
        by_frequency, _ = normalise({"cmd": "status", "vfd": {"hz": 30.0}}, TEST_CLIENT_ID)
        assert (running.pump_on, stopped.pump_on, by_frequency.pump_on) == (True, False, True)

    def test_a_drive_fault_code_wins_over_the_devices_own_flt(self):
        telemetry, _ = normalise({**SOLAR_FRAME, "mot": 0, "flt": 3, "vfd": {**SOLAR_FRAME["vfd"], "fault_code": 105}}, TEST_CLIENT_ID)
        assert (telemetry.fault_active, telemetry.fault_code) == (True, 105)
        plain, _ = normalise({**SOLAR_FRAME, "flt": 3}, TEST_CLIENT_ID)
        assert plain.fault_code == 3, "no drive fault: the device's own code stands"


class TestSolarPumpThroughTheWorker:
    """process_batch with a SOLAR_VFD pump and an AC pump: the readings reach telemetry_history and the live snapshot."""

    SOLAR_ID = "IMEI_TEST_SOLAR_001"

    @classmethod
    def setup_class(cls):
        from sqlalchemy import text as _text
        cls.db: Session = SessionLocal()
        cls.db.execute(_text("SET app.bypass_rls = 'on';"))
        owner = cls.db.query(User).filter(User.role == "superadmin").first()
        cls.db.query(Pump).filter(Pump.id == cls.SOLAR_ID).delete()
        cls.db.add(Pump(id=cls.SOLAR_ID, name="Solar ingest test", status="STOPPED", owner_user_id=owner.id, hierarchy_path="SA",
                        device_type="SOLAR_VFD"))
        cls.db.commit()

    @classmethod
    def teardown_class(cls):
        cls.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == cls.SOLAR_ID).delete()
        cls.db.query(Pump).filter(Pump.id == cls.SOLAR_ID).delete()
        cls.db.commit()
        cls.db.close()

    def test_the_drive_readings_are_stored_and_the_pump_is_running(self):
        frame = {**SOLAR_FRAME, "seq": 424242}
        handled = asyncio.run(process_batch([_make_sqs_msg(frame, client_id=self.SOLAR_ID, receipt="r_solar")]))
        assert handled == ["r_solar"]
        self.db.expire_all()
        row = self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == self.SOLAR_ID, TelemetryHistory.seq == 424242).one()
        assert (float(row.vfd_hz), float(row.vfd_kw), float(row.vfd_v_dc), row.vfd_status, row.vfd_fault_code) == (49.8, 5.45, 679.0, "RUNNING", 0)
        assert row.v_ry is None and row.pump_on is True
        assert self.db.query(Pump).filter(Pump.id == self.SOLAR_ID).one().status == "RUNNING"

    def test_a_drive_fault_makes_the_pump_faulted(self):
        frame = {**SOLAR_FRAME, "mot": 0, "seq": 424243, "vfd": {**SOLAR_FRAME["vfd"], "hz": 0, "kw": 0, "status": "FAULT", "fault_code": 104}}
        asyncio.run(process_batch([_make_sqs_msg(frame, client_id=self.SOLAR_ID, receipt="r_solar_fault")]))
        self.db.expire_all()
        assert self.db.query(Pump).filter(Pump.id == self.SOLAR_ID).one().status == "FAULT"

    def test_an_ac_pump_ignores_a_vfd_object(self):
        TestProcessBatch.setup_class()
        try:
            asyncio.run(process_batch([_make_sqs_msg({**SOLAR_FRAME, "seq": 424244, "dev_id": TEST_DEVICE_ID}, receipt="r_ac_with_vfd")]))
            db = TestProcessBatch.db
            db.expire_all()
            row = db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == TEST_DEVICE_ID, TelemetryHistory.seq == 424244).one()
            assert row.vfd_hz is None and row.vfd_kw is None
        finally:
            TestProcessBatch.teardown_class()


class TestParseFault:
    """The two trip shapes, no DB needed."""

    NOW = datetime(2026, 10, 28, 6, 0, tzinfo=timezone.utc)

    def test_layer_a(self):
        code, readings, at = parse_fault({"cmd": "fault", "code": 5, "desc": "DryRun", "vl": [415, 0, 410], "i": [2, 0, 2]}, self.NOW)
        assert code == 5
        assert readings == (415.0, 0.0, 410.0, 2.0, 0.0, 2.0)
        assert at == self.NOW, "layer A has no clock: stamped on arrival"

    def test_layer_b_event_uses_its_own_timestamp_and_snapshot(self):
        code, readings, at = parse_fault(
            {"v": 1, "ts": 1766001234, "type": "TRIP", "code": 8, "snapshot": {"vl": [400, 401, 402], "i": [30, 29, 31]}}, self.NOW)
        assert code == 8
        assert readings == (400.0, 401.0, 402.0, 30.0, 29.0, 31.0)
        assert at == datetime.fromtimestamp(1766001234, tz=timezone.utc)

    def test_missing_short_or_garbage_readings_become_zero_and_a_bad_code_is_refused(self):
        _, readings, _ = parse_fault({"cmd": "fault", "code": 3, "vl": [415], "i": ["x"]}, self.NOW)
        assert readings == (415.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        for bad in ({"cmd": "fault"}, {"cmd": "fault", "code": 0}, {"cmd": "fault", "code": 999}, {"cmd": "fault", "code": "abc"}):
            assert parse_fault(bad, self.NOW) is None, bad


class TestProcessBatch:
    """Integration tests for process_batch() — requires a live DB."""

    @classmethod
    def setup_class(cls):
        """Create a test pump and fault code catalog entry."""
        from sqlalchemy import text as _text
        cls.db: Session = SessionLocal()
        # Bypass RLS for test data setup (same pattern as P2.1 tests)
        cls.db.execute(_text("SET app.bypass_rls = 'on';"))

        # Create superadmin user for pump ownership
        cls.user = cls.db.query(User).filter(User.role == "superadmin").first()
        if not cls.user:
            cls.user = User(
                phone_number="+919900001234",
                full_name="Ingest Test SA",
                role="superadmin",
                hierarchy_path="SA",
                is_active=True,
                password_hash="notused",
            )
            cls.db.add(cls.user)
            cls.db.flush()

        # Create test pump
        cls.pump = cls.db.query(Pump).filter(Pump.id == TEST_DEVICE_ID).first()
        if not cls.pump:
            cls.pump = Pump(
                id=TEST_DEVICE_ID,
                name="Ingest Test Pump",
                status="STOPPED",  # pumps_status_check only allows RUNNING/STOPPED/FAULT
                owner_user_id=cls.user.id,
                hierarchy_path="SA",
            )
            cls.db.add(cls.pump)
            cls.db.flush()

        # Ensure fault catalog has code 5
        fc = cls.db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == 5).first()
        if not fc:
            cls.db.add(FaultCodeCatalog(
                code=5, name="DryRun", severity="HIGH", description="Motor ran dry"
            ))
            cls.db.flush()

        cls.db.commit()

    @classmethod
    def teardown_class(cls):
        # Cleanup test data
        cls.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == TEST_DEVICE_ID).delete()
        cls.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).delete()
        cls.db.query(Pump).filter(Pump.id == TEST_DEVICE_ID).delete()
        cls.db.commit()
        cls.db.close()

    def _run(self, coro):
        return asyncio.run(coro)

    def test_valid_legacy_message_inserted(self):
        """A valid legacy MCU message should be inserted into telemetry_history."""
        # Clean slate
        self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == TEST_DEVICE_ID).delete()
        self.db.commit()

        msg = _make_sqs_msg(LEGACY_PAYLOAD, receipt="r_valid_legacy")
        handled = self._run(process_batch([msg]))
        assert "r_valid_legacy" in handled

        rows = self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == TEST_DEVICE_ID).all()
        assert len(rows) == 1
        assert rows[0].v_ry == 415.0
        assert rows[0].seq == 1001

    def _reset(self, **fields):
        self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == TEST_DEVICE_ID).delete()
        if fields:
            self.db.query(Pump).filter(Pump.id == TEST_DEVICE_ID).update(fields)
        self.db.commit()
        self.db.expire_all()

    def _pump(self):
        self.db.expire_all()
        return self.db.query(Pump).filter(Pump.id == TEST_DEVICE_ID).one()

    def _rows(self):
        return self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == TEST_DEVICE_ID).count()

    def test_a_heartbeat_is_not_a_reading_and_does_not_stop_a_running_pump(self):
        self._reset(status="RUNNING", last_seen_at=None)
        handled = self._run(process_batch([_make_sqs_msg({"cmd": "heartbeat"}, receipt="r_hb"),
                                           _make_sqs_msg({"cmd": "pong"}, receipt="r_pong")]))
        assert set(handled) == {"r_hb", "r_pong"}, "consumed, so it is not delivered again"
        assert self._rows() == 0
        pump = self._pump()
        assert pump.status == "RUNNING"
        assert pump.last_seen_at is not None, "but it does prove the device is alive"

    def test_a_registration_updates_the_firmware_version_even_though_its_id_is_the_mcu_uid(self):
        self._reset(status="RUNNING", firmware_version=None)
        reg = {"cmd": "reg", "dev_id": "0123456789ABCDEF01234567", "fw": "1.0.367"}
        handled = self._run(process_batch([_make_sqs_msg(reg, receipt="r_reg")]))
        assert handled == ["r_reg"]
        assert self._rows() == 0
        pump = self._pump()
        assert (pump.firmware_version, pump.status) == ("1.0.367", "RUNNING")

    def test_an_unknown_frame_is_consumed_and_stored_nowhere(self):
        self._reset()
        handled = self._run(process_batch([_make_sqs_msg({"cmd": "settings", "hp": 7}, receipt="r_unknown")]))
        assert handled == ["r_unknown"]
        assert self._rows() == 0

    def test_a_status_frame_is_still_a_reading(self):
        self._reset(status="STOPPED")
        handled = self._run(process_batch([_make_sqs_msg({**LEGACY_PAYLOAD, "cmd": "status", "seq": 8801}, receipt="r_status")]))
        assert handled == ["r_status"]
        assert self._rows() == 1
        assert self._pump().status == "RUNNING"

    def _faults(self):
        self.db.expire_all()
        return self.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).order_by(FaultLog.id).all()

    def test_a_fault_frame_logs_the_trip_at_once_and_marks_the_pump_faulted(self):
        self.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).delete()
        self._reset(status="RUNNING")
        frame = {"cmd": "fault", "code": 5, "desc": "DryRun", "vl": [415, 0, 410], "i": [2, 0, 2]}
        handled = self._run(process_batch([_make_sqs_msg(frame, receipt="r_trip")]))
        assert handled == ["r_trip"]
        rows = self._faults()
        assert [(r.fault_code, float(r.v_yb), float(r.i_r)) for r in rows] == [(5, 0.0, 2.0)]
        assert self._pump().status == "FAULT"
        assert self._rows() == 0, "a trip is not a telemetry row"

    def test_a_layer_b_trip_event_keeps_its_own_time(self):
        self.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).delete()
        self._reset(status="RUNNING")
        event = {"v": 1, "ts": 1766001234, "type": "TRIP", "code": 5, "snapshot": {"vl": [415, 0, 410], "i": [2, 0, 2]}}
        self._run(process_batch([_make_sqs_msg(event, receipt="r_trip_b")]))
        (row,) = self._faults()
        assert row.occurred_at == datetime.fromtimestamp(1766001234, tz=timezone.utc)

    def test_a_fault_with_a_code_nobody_defined_is_consumed_and_changes_nothing(self):
        self.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).delete()
        self._reset(status="RUNNING")
        handled = self._run(process_batch([_make_sqs_msg({"cmd": "fault", "code": 200}, receipt="r_trip_x")]))
        assert handled == ["r_trip_x"], "consumed, so it is not delivered again"
        assert self._faults() == []
        assert self._pump().status == "RUNNING"

    def test_a_fault_naming_another_device_is_rejected(self):
        self.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).delete()
        self._reset(status="RUNNING")
        frame = {"cmd": "fault", "code": 5, "dev_id": "EVIL_DEVICE"}
        handled = self._run(process_batch([_make_sqs_msg(frame, receipt="r_trip_spoof")]))
        assert handled == ["r_trip_spoof"]
        assert self._faults() == []
        assert self._pump().status == "RUNNING"

    def test_valid_v1_message_inserted(self):
        """A valid v1 envelope message should be inserted into telemetry_history."""
        self.db.query(TelemetryHistory).filter(
            TelemetryHistory.pump_id == TEST_DEVICE_ID, TelemetryHistory.seq == 2001
        ).delete()
        self.db.commit()

        msg = _make_sqs_msg(V1_PAYLOAD, receipt="r_valid_v1")
        handled = self._run(process_batch([msg]))
        assert "r_valid_v1" in handled

        rows = self.db.query(TelemetryHistory).filter(
            TelemetryHistory.pump_id == TEST_DEVICE_ID,
            TelemetryHistory.seq == 2001,
        ).all()
        assert len(rows) == 1
        assert rows[0].pump_on is True

    def test_spoofed_dev_id_rejected(self):
        """FR-SEC-032: message with dev_id != client_id is rejected but receipt is returned (deleted from SQS)."""
        spoofed_payload = dict(LEGACY_PAYLOAD)
        spoofed_payload["dev_id"] = "EVIL_DEVICE"
        spoofed_payload["seq"] = 9999

        msg = _make_sqs_msg(spoofed_payload, client_id=TEST_CLIENT_ID, receipt="r_spoofed")
        handled = self._run(process_batch([msg]))
        # Receipt is "handled" (deleted from SQS to avoid poison pill)
        assert "r_spoofed" in handled
        # But NO row written for the spoofed device
        rows = self.db.query(TelemetryHistory).filter(
            TelemetryHistory.pump_id == TEST_DEVICE_ID,
            TelemetryHistory.seq == 9999
        ).all()
        assert len(rows) == 0

    def test_deduplication_on_conflict(self):
        """FR-CLD-026: sending the same (pump_id, seq) twice must NOT create two rows."""
        # Ensure clean state for seq=1001
        self.db.query(TelemetryHistory).filter(
            TelemetryHistory.pump_id == TEST_DEVICE_ID, TelemetryHistory.seq == 1001
        ).delete()
        self.db.commit()

        msg = _make_sqs_msg(LEGACY_PAYLOAD, receipt="r_dup1")
        msg2 = _make_sqs_msg(LEGACY_PAYLOAD, receipt="r_dup2")

        self._run(process_batch([msg]))
        self._run(process_batch([msg2]))  # same seq → should be ignored

        rows = self.db.query(TelemetryHistory).filter(
            TelemetryHistory.pump_id == TEST_DEVICE_ID,
            TelemetryHistory.seq == 1001,
        ).all()
        assert len(rows) == 1, f"Expected 1 row but found {len(rows)}"

    def test_unknown_device_skipped(self):
        """Messages for unknown devices are skipped gracefully (receipt still returned)."""
        payload = dict(LEGACY_PAYLOAD)
        payload["dev_id"] = "UNKNOWN_IMEI_XYZ"
        payload["seq"] = 7777
        msg = _make_sqs_msg(payload, client_id="UNKNOWN_IMEI_XYZ", receipt="r_unknown")
        handled = self._run(process_batch([msg]))
        assert "r_unknown" in handled

    def test_fault_creates_fault_log(self):
        """A fault telemetry message should create a FaultLog row."""
        self.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).delete()
        self.db.query(TelemetryHistory).filter(
            TelemetryHistory.pump_id == TEST_DEVICE_ID, TelemetryHistory.seq == 3001
        ).delete()
        self.db.commit()

        msg = _make_sqs_msg(FAULT_PAYLOAD, receipt="r_fault")
        handled = self._run(process_batch([msg]))
        assert "r_fault" in handled

        fault_rows = self.db.query(FaultLog).filter(FaultLog.pump_id == TEST_DEVICE_ID).all()
        assert len(fault_rows) >= 1
        assert fault_rows[0].fault_code == 5


if __name__ == "__main__":
    import unittest

    # Run normaliser tests (no DB)
    print("=== Normaliser tests ===")
    t = TestNormaliser()
    tests = [
        ("v1 envelope parsed", t.test_v1_envelope),
        ("legacy format parsed", t.test_legacy_format),
        ("spoofed dev_id detected", t.test_spoofed_dev_id_detected),
        ("v1 fault parsed", t.test_v1_fault_parsed),
        ("missing client_id not spoofed", t.test_missing_client_id_not_spoofed),
    ]
    passed = failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  [PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"  [FAIL] {name}: {e}")
            failed += 1

    print("\n=== process_batch integration tests ===")
    p = TestProcessBatch()
    TestProcessBatch.setup_class()
    batch_tests = [
        ("valid legacy message inserted", p.test_valid_legacy_message_inserted),
        ("valid v1 message inserted", p.test_valid_v1_message_inserted),
        ("spoofed dev_id rejected (FR-SEC-032)", p.test_spoofed_dev_id_rejected),
        ("deduplication on conflict (FR-CLD-026)", p.test_deduplication_on_conflict),
        ("unknown device skipped", p.test_unknown_device_skipped),
        ("fault creates FaultLog", p.test_fault_creates_fault_log),
    ]
    for name, fn in batch_tests:
        try:
            fn()
            print(f"  [PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"  [FAIL] {name}: {e}")
            import traceback
            traceback.print_exc()
            failed += 1

    TestProcessBatch.teardown_class()
    print(f"\nTotal: {passed} passed, {failed} failed")
    if failed:
        raise SystemExit(1)
