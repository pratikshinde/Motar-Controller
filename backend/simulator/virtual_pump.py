"""Virtual pump: stands in for the M031 controller + A7672S bridge and talks to AWS IoT Core the way the hardware will.

    python simulator/virtual_pump.py [--thing SWATI-DEMO-01] [--interval 10] [--schema legacy|v1] [--firmware legacy|f2|silent]

It connects with the thing's OWN certificate (mutual TLS, port 8883, client id = thing name), registers, publishes a
status frame every --interval seconds, listens on devices/<thing>/commands and answers START / STOP like the panel:
an ack, then a fresh status frame. Everything goes through AWS: IoT Core -> IoT Rule -> SQS -> ingest worker -> backend.
That is the difference from device_simulator.py, which talks to the backend over HTTP.

The certificate files are read from  %USERPROFILE%\\.aws\\iot\\<thing>\\  (override with --cert-dir): the files the AWS console
offers when a thing is created, named  *-certificate.pem.crt,  *-private.pem.key  and  AmazonRootCA1.pem. Keep them out of
the repository. Nothing secret is printed.

  --schema    legacy  layer-A status frame, what the bridge forwards from the MCU today
              v1      the enriched layer-B envelope of SRS 6.3 (adds ts, seq, net)
  --firmware  legacy  bare layer-A ack {"cmd":"ack","ref":"motor_cmd","ok":1}
              f2      layer-B acks that carry the command's cid ("delivered", then "acknowledged")
              silent  receives commands and never answers
Run it instead of device_simulator.py for the pump it plays, not next to it: two sources would fight over the pump's state.
"""
import argparse
import glob
import json
import math
import os
import random
import socket
import ssl
import sys
import time
from typing import Any, Callable, Dict, List, Optional

TELEMETRY_TOPIC = "devices/{thing}/telemetry"
COMMANDS_TOPIC = "devices/{thing}/commands"


def sun_factor(now: float) -> float:
    """Irradiance 0.0-1.0 on a daytime curve (06:00-18:00 local, peak at noon). SIM_SOLAR_FACTOR overrides it."""
    if "SIM_SOLAR_FACTOR" in os.environ:
        return max(0.0, min(1.0, float(os.environ["SIM_SOLAR_FACTOR"])))
    t = time.localtime(now)
    hour = t.tm_hour + t.tm_min / 60.0 + t.tm_sec / 3600.0
    return math.sin((hour - 6.0) / 12.0 * math.pi) if 6.0 <= hour < 18.0 else 0.0


class VirtualPump:
    """The controller's behaviour, with no network in it: frames in, frames out. Every frame goes to the telemetry topic.

    profile "solar" is a pump driven by a solar inverter (SOLAR_VFD): its status frames carry the drive's readings in a
    `vfd` object, and the motor only turns while the sun is up. "ac" is a three-phase panel reading voltages and currents."""

    def __init__(self, thing: str, schema: str = "legacy", firmware: str = "legacy", running: bool = True,
                 clock: Callable[[], float] = time.time, profile: str = "ac",
                 sun: Callable[[float], float] = sun_factor):
        self.thing, self.schema, self.firmware, self.clock = thing, schema, firmware, clock
        self.profile, self.sun = profile, sun
        self.running = running
        self.fault = 0
        self.runtime_s = 0.0
        self._last_tick = clock()
        self.seq = int(clock())      # starts from the clock so a restart never reuses a number the backend has seen

    # -- what the pump says on its own ---------------------------------------------------------------------------
    def registration(self) -> Dict[str, Any]:
        return {"cmd": "reg", "dev_id": self.thing, "fw": "virtual-0.1"}

    def _on(self, now: float) -> bool:
        """The motor is really turning: commanded on, no fault, and (solar) the sun is up."""
        if not self.running or self.fault:
            return False
        return self.profile != "solar" or self.sun(now) > 0.02

    def _drive(self, now: float, on: bool) -> Dict[str, Any]:
        """A solar inverter's readings, shaped like the ones the simulator posts."""
        sun = self.sun(now)
        if on:
            hz = round(min(50.0, max(15.0, 50.0 * sun + random.uniform(-0.2, 0.2))), 1)
            return {"hz": hz, "i_out": round(11.0 * sun + random.uniform(-0.2, 0.2), 1),
                    "v_ac": round(min(415.0, hz / 50.0 * 415.0 + random.uniform(-2.0, 2.0)), 1),
                    "v_dc": round(420.0 + 260.0 * sun + random.uniform(-4.0, 4.0), 1),
                    "kw": round(max(0.1, 5.5 * sun ** 1.3 + random.uniform(-0.05, 0.05)), 2),
                    "status": "RUNNING", "fault_code": 0}
        return {"hz": 0.0, "i_out": 0.0, "v_ac": 0.0,
                "v_dc": round(520.0 * sun + random.uniform(-3.0, 3.0), 1) if sun > 0.02 else 0.0, "kw": 0.0,
                "status": "FAULT" if self.fault else ("STANDBY" if self.running else "STOPPED"),
                "fault_code": self.fault}

    def status(self) -> Dict[str, Any]:
        self._tick()
        now = self._last_tick
        on = self._on(now)
        state = 4 if self.fault else (2 if on else 1)
        minutes = int(self.runtime_s // 60)
        self.seq += 1
        solar = self.profile == "solar"
        if not solar:
            vl = [round(random.uniform(410, 425), 1), round(random.uniform(408, 423), 1), round(random.uniform(412, 426), 1)]
            amps = [round(random.uniform(10.5, 12.5), 1) for _ in range(3)] if on else [0.0, 0.0, 0.0]
        if self.schema == "v1":
            frame = {"v": 1, "id": self.thing, "ts": int(now), "seq": self.seq, "tsApprox": False, "buf": False,
                     "st": {"mot": 1 if on else 0, "state": state, "fault": self.fault},
                     "rt": {"totalMin": minutes},
                     "net": {"rssi": random.randint(-85, -60), "op": "40410", "tech": "LTE"}}
            if solar:
                frame["vfd"] = self._drive(now, on)
            else:
                frame["el"], frame["cfg"] = {"vl": vl, "i": amps}, {"ol": 25}
            return frame
        frame = {"cmd": "status", "mot": 1 if on else 0, "st": state, "flt": self.fault, "rt": minutes}
        if solar:
            frame["vfd"] = self._drive(now, on)
        else:
            frame.update({"vl": vl, "i": amps, "ol": 25})
        return frame

    # -- what it does with a command ------------------------------------------------------------------------------
    def on_command(self, raw: bytes) -> List[Dict[str, Any]]:
        """Frames to publish in answer to one message received on the commands topic."""
        try:
            msg = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return []
        if not isinstance(msg, dict) or not msg.get("cmd"):
            return []                                   # not a command (for example a connectivity check)
        cmd, cid = str(msg["cmd"]).upper(), msg.get("cid")
        if self.firmware == "silent":
            return []

        out: List[Dict[str, Any]] = []
        expiry = msg.get("expiry")
        if isinstance(expiry, (int, float)) and self.clock() > expiry:
            # The bridge enforces expiry for a controller that has no clock (SRS FR-CON-035).
            return [self._ack(cid, ok=False, reason="expired")]

        if self.firmware == "f2" and cid:
            out.append({"v": 1, "type": "CMD_ACK", "cid": cid, "stage": "delivered"})
        if cmd in ("START", "STOP"):
            ok = not (cmd == "START" and self.fault)    # a panel refuses to start while a fault is latched
            if ok:
                self._tick()
                self.running = cmd == "START"
            out.append(self._ack(cid, ok=ok, reason=None if ok else "fault_active"))
            out.append(self.status())                    # the reading that settles the command
        elif cmd == "PING":
            out.append({"cmd": "pong"})
        # SET_TIMER, SET_CONFIG, RESET_FAULT ...: not implemented by this panel, so no answer
        return out

    def _tick(self) -> None:
        now = self.clock()
        if self._on(now):
            self.runtime_s += now - self._last_tick
        self._last_tick = now

    def _ack(self, cid: Optional[str], ok: bool, reason: Optional[str]) -> Dict[str, Any]:
        if self.firmware == "f2" and cid:
            frame = {"v": 1, "type": "CMD_ACK", "cid": cid, "stage": "acknowledged" if ok else "rejected"}
            if reason:
                frame["reason"] = reason
            return frame
        return {"cmd": "ack", "ref": "motor_cmd", "ok": 1 if ok else 0}


# ------------------------------------------------------------------------------------------------------------------
# Everything below is the network side
# ------------------------------------------------------------------------------------------------------------------
def find_credentials(folder: str):
    """(certificate, private key, root CA) in `folder`, as the AWS console names them."""
    def one(*patterns):
        for pattern in patterns:
            hits = sorted(glob.glob(os.path.join(folder, pattern)))
            if hits:
                return hits[0]
        return None

    cert = one("*-certificate.pem.crt", "*.pem.crt", "*certificate*")
    key = one("*-private.pem.key", "*private*")
    ca = one("AmazonRootCA1.pem", "AmazonRootCA*.pem", "*Root*CA*.pem")
    return cert, key, ca


def prefer_ipv4() -> None:
    """On a network with no working IPv6 the connection otherwise waits about 20 s for IPv6 to time out."""
    original = socket.getaddrinfo

    def ipv4_first(host, *args, **kwargs):
        found = original(host, *args, **kwargs)
        return [item for item in found if item[0] == socket.AF_INET] or found

    socket.getaddrinfo = ipv4_first


def log(text: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--thing", default="SWATI-DEMO-01", help="thing name = MQTT client id = pump id")
    ap.add_argument("--endpoint", default=None, help="AWS IoT data endpoint (default: IOT_DATA_ENDPOINT from backend/.env)")
    ap.add_argument("--cert-dir", default=None, help=r"folder with the thing's certificate files (default: %%USERPROFILE%%\.aws\iot\<thing>)")
    ap.add_argument("--interval", type=float, default=10.0, help="seconds between status frames")
    ap.add_argument("--schema", choices=("legacy", "v1"), default="legacy")
    ap.add_argument("--firmware", choices=("legacy", "f2", "silent"), default="legacy")
    ap.add_argument("--profile", choices=("auto", "ac", "solar"), default="auto",
                    help="solar = a pump driven by a solar inverter (status frames carry a vfd object); auto = solar when the thing name contains SWATI or SOLAR")
    ap.add_argument("--stopped", action="store_true", help="start with the motor off")
    ap.add_argument("--ipv4", action="store_true", help="force IPv4 (also on when IOT_FORCE_IPV4 is set in backend/.env)")
    args = ap.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.config import settings

    endpoint = (args.endpoint or settings.IOT_DATA_ENDPOINT or "").replace("https://", "").replace("tcp://", "").strip("/")
    if not endpoint:
        print("FAIL: no endpoint. Set IOT_DATA_ENDPOINT in backend/.env or pass --endpoint.")
        return 1
    folder = args.cert_dir or os.path.join(os.path.expanduser("~"), ".aws", "iot", args.thing)
    cert, key, ca = find_credentials(folder)
    missing = [name for name, path in (("certificate (*-certificate.pem.crt)", cert), ("private key (*-private.pem.key)", key),
                                       ("root CA (AmazonRootCA1.pem)", ca)) if not path]
    if missing:
        print(f"FAIL: not found in {folder}: {', '.join(missing)}")
        return 1
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        print("FAIL: paho-mqtt is not installed.  python -m pip install paho-mqtt")
        return 1
    if args.ipv4 or settings.IOT_FORCE_IPV4:
        prefer_ipv4()

    profile = args.profile if args.profile != "auto" else ("solar" if any(w in args.thing.upper() for w in ("SWATI", "SOLAR")) else "ac")
    pump = VirtualPump(args.thing, schema=args.schema, firmware=args.firmware, running=not args.stopped, profile=profile)
    telemetry, commands = TELEMETRY_TOPIC.format(thing=args.thing), COMMANDS_TOPIC.format(thing=args.thing)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=args.thing)
    client.tls_set(ca_certs=ca, certfile=cert, keyfile=key, tls_version=ssl.PROTOCOL_TLS_CLIENT)
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    def publish(frame: Dict[str, Any]) -> None:
        client.publish(telemetry, json.dumps(frame, separators=(",", ":")), qos=1)

    def on_connect(c, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            log(f"connect refused: {reason_code}  (is the certificate active and attached to the thing and the policy?)")
            return
        log(f"connected to {endpoint} as {args.thing}")
        c.subscribe(commands, qos=1)
        publish(pump.registration())
        log(f"registered; listening on {commands}; status every {args.interval:g} s ({args.schema}, {profile}, firmware {args.firmware})")

    def on_message(c, userdata, message):
        log(f"command received: {message.payload.decode('utf-8', 'replace')[:160]}")
        for frame in pump.on_command(message.payload):
            publish(frame)
            log(f"  -> {json.dumps(frame, separators=(',', ':'))}")
        log(f"  motor is now {'ON' if pump.running else 'OFF'}")

    def on_disconnect(c, userdata, flags, reason_code, properties):
        log(f"disconnected ({reason_code}); reconnecting")

    client.on_connect, client.on_message, client.on_disconnect = on_connect, on_message, on_disconnect
    log(f"connecting to {endpoint}:8883 with the certificate in {folder} ...")
    client.connect_async(endpoint, 8883, keepalive=60)
    client.loop_start()
    try:
        while True:
            time.sleep(args.interval)
            if client.is_connected():
                publish(pump.status())
    except KeyboardInterrupt:
        log("stopping")
    finally:
        client.loop_stop()
        client.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
