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
from app.workers.ingest import frame_kind, normalise, process_batch

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
        for cmd in ("fault", "settings", "nonsense"):
            assert frame_kind({"cmd": cmd}) == "unknown", cmd


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
