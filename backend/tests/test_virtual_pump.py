"""The virtual pump's behaviour, checked against the backend's own parsers. No network, no AWS, no database.

What the virtual pump publishes must be what the ingest worker and the command lifecycle understand, or the full loop
through AWS would fail somewhere nobody can see.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "simulator"))

import virtual_pump  # noqa: E402
from app.services.command_service import parse_ack  # noqa: E402
from app.workers.ingest import frame_kind, normalise  # noqa: E402

THING = "SWATI-DEMO-01"


class Clock:
    def __init__(self, now=1_800_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


def command(cmd, cid="c-1", expiry=None, clock=None):
    body = {"v": 1, "cid": cid, "ts": 1, "actor": "usr_1", "cmd": cmd}
    body["expiry"] = expiry if expiry is not None else (clock.now if clock else 1_800_000_000.0) + 120
    return json.dumps(body).encode()


def make(**kw):
    clock = Clock()
    return virtual_pump.VirtualPump(THING, clock=clock, **kw), clock


class TestAnswers:
    def test_stop_in_legacy_firmware_is_a_bare_ack_then_a_reading_that_shows_the_motor_off(self):
        pump, clock = make()
        ack, reading = pump.on_command(command("STOP", clock=clock))
        assert ack == {"cmd": "ack", "ref": "motor_cmd", "ok": 1}
        assert parse_ack(ack)["stage"] == "acknowledged"
        assert frame_kind(reading) == "telemetry"
        telemetry, spoofed = normalise(reading, THING)
        assert (telemetry.pump_on, spoofed) == (False, False)
        assert pump.running is False

    def test_start_turns_the_motor_back_on(self):
        pump, clock = make(running=False)
        _, reading = pump.on_command(command("START", clock=clock))
        assert normalise(reading, THING)[0].pump_on is True

    def test_f2_firmware_answers_with_the_command_id_delivered_then_acknowledged(self):
        pump, clock = make(firmware="f2")
        delivered, acknowledged, reading = pump.on_command(command("STOP", cid="abc", clock=clock))
        assert (parse_ack(delivered)["cid"], parse_ack(delivered)["stage"]) == ("abc", "delivered")
        assert (parse_ack(acknowledged)["cid"], parse_ack(acknowledged)["stage"]) == ("abc", "acknowledged")
        assert frame_kind(reading) == "telemetry"

    def test_an_expired_command_is_rejected_and_the_motor_is_left_alone(self):
        pump, clock = make(firmware="f2")
        raw = command("STOP", expiry=clock.now - 1, clock=clock)
        (rejected,) = pump.on_command(raw)
        ack = parse_ack(rejected)
        assert (ack["stage"], ack["reason"]) == ("rejected", "expired")
        assert pump.running is True

    def test_a_latched_fault_refuses_start_but_not_stop(self):
        pump, clock = make(running=False)
        pump.fault = 5
        ack, _ = pump.on_command(command("START", clock=clock))
        assert parse_ack(ack)["stage"] == "rejected" and pump.running is False
        pump.running = True
        ack, _ = pump.on_command(command("STOP", clock=clock))
        assert parse_ack(ack)["stage"] == "acknowledged" and pump.running is False

    def test_silent_firmware_never_answers_and_does_not_act(self):
        pump, clock = make(firmware="silent")
        assert pump.on_command(command("STOP", clock=clock)) == []
        assert pump.running is True

    def test_what_a_panel_does_not_support_or_what_is_not_a_command_gets_no_answer(self):
        pump, clock = make()
        assert pump.on_command(command("SET_TIMER", clock=clock)) == []
        assert pump.on_command(b'{"v":1,"check":true,"note":"connectivity check"}') == []
        assert pump.on_command(b"not json") == []
        assert pump.on_command(b"[1,2]") == []
        assert pump.on_command(command("PING", clock=clock)) == [{"cmd": "pong"}]


class TestWhatItSays:
    def test_registration_is_understood_as_a_registration(self):
        assert frame_kind(make()[0].registration()) == "registration"

    def test_v1_status_is_the_enriched_envelope_with_a_rising_sequence(self):
        pump, clock = make(schema="v1")
        first, second = pump.status(), pump.status()
        assert frame_kind(first) == "telemetry"
        assert second["seq"] == first["seq"] + 1
        telemetry, spoofed = normalise(second, THING)
        assert (telemetry.pump_on, telemetry.seq, spoofed) == (True, second["seq"], False)
        assert telemetry.gsm_rssi == second["net"]["rssi"]

    def test_a_stopped_pump_reads_zero_current_and_runtime_counts_only_while_running(self):
        pump, clock = make()
        clock.now += 120
        assert pump.status()["rt"] == 2
        pump.on_command(command("STOP", clock=clock))
        clock.now += 600
        reading = pump.status()
        assert reading["rt"] == 2 and reading["i"] == [0.0, 0.0, 0.0] and reading["mot"] == 0

    def test_a_fault_shows_in_the_reading(self):
        pump, _ = make()
        pump.fault = 8
        telemetry, _ = normalise(pump.status(), THING)
        assert (telemetry.fault_active, telemetry.fault_code, telemetry.pump_on) == (True, 8, False)


def make_solar(sun=1.0, **kw):
    clock = Clock()
    return virtual_pump.VirtualPump(THING, clock=clock, profile="solar", sun=lambda now: sun, **kw), clock


class TestSolarProfile:
    def test_a_running_solar_pump_reports_the_drive_in_a_vfd_object_and_the_worker_reads_it(self):
        pump, _ = make_solar()
        frame = pump.status()
        assert "vl" not in frame and "i" not in frame, "a solar pump has no three-phase measurement"
        telemetry, spoofed = normalise(frame, THING)
        assert not spoofed and telemetry.pump_on is True
        assert telemetry.vfd["status"] == "RUNNING" and telemetry.vfd["kw"] > 0 and telemetry.vfd["hz"] > 15

    def test_the_v1_envelope_carries_the_drive_too(self):
        pump, _ = make_solar(schema="v1")
        frame = pump.status()
        assert frame_kind(frame) == "telemetry" and "el" not in frame
        telemetry, _ = normalise(frame, THING)
        assert telemetry.vfd["kw"] > 0 and telemetry.seq == frame["seq"]

    def test_stop_reads_zero_output_and_stopped(self):
        pump, clock = make_solar()
        pump.on_command(command("STOP", clock=clock))
        telemetry, _ = normalise(pump.status(), THING)
        assert telemetry.pump_on is False
        assert (telemetry.vfd["hz"], telemetry.vfd["kw"], telemetry.vfd["status"]) == (0.0, 0.0, "STOPPED")

    def test_a_motor_commanded_on_at_night_stands_by_instead_of_turning(self):
        pump, _ = make_solar(sun=0.0)
        telemetry, _ = normalise(pump.status(), THING)
        assert telemetry.pump_on is False and telemetry.vfd["status"] == "STANDBY"
        assert pump.running is True, "the command is still on: it will start when the sun comes up"

    def test_a_drive_fault_is_reported_as_the_fault_code(self):
        pump, _ = make_solar()
        pump.fault = 104
        telemetry, _ = normalise(pump.status(), THING)
        assert (telemetry.fault_active, telemetry.fault_code, telemetry.pump_on) == (True, 104, False)


class TestCredentialsLookup:
    def test_finds_the_files_the_aws_console_gives(self, tmp_path):
        for name in ("0d8d593b-certificate.pem.crt", "0d8d593b-private.pem.key", "0d8d593b-public.pem.key", "AmazonRootCA1.pem"):
            (tmp_path / name).write_text("x")
        cert, key, ca = virtual_pump.find_credentials(str(tmp_path))
        assert os.path.basename(cert) == "0d8d593b-certificate.pem.crt"
        assert os.path.basename(key) == "0d8d593b-private.pem.key", "the private key, not the public one"
        assert os.path.basename(ca) == "AmazonRootCA1.pem"

    def test_reports_what_is_missing(self, tmp_path):
        (tmp_path / "AmazonRootCA1.pem").write_text("x")
        cert, key, ca = virtual_pump.find_credentials(str(tmp_path))
        assert (cert, key) == (None, None) and ca is not None
