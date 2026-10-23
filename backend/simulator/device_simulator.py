import os
import sys
import time
import random
import httpx

import math
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

API_BASE = os.environ.get("API_BASE", "http://localhost:5000/api")
TICK_SECONDS = float(os.environ.get("TICK_SECONDS", "3.0"))
# How the simulated controller answers commands (needs the API in IOT_PUBLISH_MODE=outbox, the development default):
#   legacy  today's firmware: a bare layer-A ack, {"cmd":"ack","ref":"motor_cmd","ok":1}
#   f2      firmware F2: layer-B answers that carry the command's cid, "delivered" then "acknowledged"
#   silent  receives commands and never answers (what a pump with a dead controller looks like)
SIM_FIRMWARE = os.environ.get("SIM_FIRMWARE", "legacy").lower()

PUMP_DEVICES = [
    {"id": "PUMP-4G-3P-8821", "hp": 15.0, "is_running": True, "seq": 1000, "rt": 1450, "profile": "ac_3ph"},
    {"id": "PUMP-4G-3P-9912", "hp": 7.5, "is_running": False, "seq": 2000, "rt": 820, "profile": "ac_3ph"},
    {"id": "PUMP-4G-3P-9001", "hp": 5.0, "is_running": True, "seq": 3000, "rt": 340, "profile": "ac_3ph"},
    {"id": "SWATI-DEMO-01", "hp": 7.5, "is_running": True, "seq": 4000, "rt": 600, "profile": "solar"},
]

# SIM_PUMPS="DEMO-PUMP-01:on:ac_3ph,SWATI-DEMO-01:on:solar" simulates those pumps instead of the defaults.
if os.environ.get("SIM_PUMPS"):
    PUMP_DEVICES = []
    for i, item in enumerate(os.environ["SIM_PUMPS"].split(",")):
        parts = [part.strip() for part in item.split(":")]
        pump_id = parts[0]
        state = parts[1] if len(parts) > 1 else "on"
        prof = parts[2] if len(parts) > 2 else os.environ.get("SIM_PROFILE", "solar" if ("SWATI" in pump_id.upper() or "SOLAR" in pump_id.upper()) else "ac_3ph")
        PUMP_DEVICES.append({
            "id": pump_id,
            "hp": 7.5 if prof == "solar" else 10.0,
            "is_running": state.lower() == "on",
            "seq": 5000 + i * 1000,
            "rt": 1000,
            "profile": prof
        })

# 10 SRS §6.2 Fault Codes for AC_3PH pumps
FAULT_CODES = [
    {"code": 1, "name": "YPhase"},
    {"code": 2, "name": "PhaseLoss"},
    {"code": 3, "name": "OverVolt"},
    {"code": 4, "name": "PhaseSeq"},
    {"code": 5, "name": "DryRun"},
    {"code": 6, "name": "CableAll"},
    {"code": 7, "name": "CablePart"},
    {"code": 8, "name": "OverLoad"},
    {"code": 9, "name": "Imbalance"},
    {"code": 10, "name": "UnderVolt"},
]

# VFD Fault Codes (100+) for SOLAR_VFD pumps (Fuji FRENIC-Ace alarms)
VFD_FAULT_CODES = [
    {"code": 100, "name": "VfdDcOverVolt", "fuji": "OU"},
    {"code": 101, "name": "VfdDcUnderVolt", "fuji": "LU"},
    {"code": 102, "name": "VfdOverCurrent", "fuji": "OC"},
    {"code": 103, "name": "VfdDryRun", "fuji": "Er4"},
    {"code": 104, "name": "VfdOverHeat", "fuji": "OH1"},
    {"code": 105, "name": "VfdCommsLoss", "fuji": "Er8"},
    {"code": 106, "name": "VfdOverLoad", "fuji": "OL1"},
]


def get_sun_factor() -> float:
    """Returns solar irradiance factor (0.0 to 1.0) following a daytime sun curve.

    Daytime: 06:00 to 18:00 (peak at 12:00 noon). Zero at night.
    Can be overridden via SIM_SOLAR_HOUR (float 0-24) or SIM_SOLAR_FACTOR (float 0.0-1.0).
    """
    if "SIM_SOLAR_FACTOR" in os.environ:
        return max(0.0, min(1.0, float(os.environ["SIM_SOLAR_FACTOR"])))
    if "SIM_SOLAR_HOUR" in os.environ:
        hour = float(os.environ["SIM_SOLAR_HOUR"])
    else:
        now = datetime.now()
        hour = now.hour + (now.minute / 60.0) + (now.second / 3600.0)

    if 6.0 <= hour < 18.0:
        return math.sin((hour - 6.0) / 12.0 * math.pi)
    return 0.0


def answer_commands(client, pump, fault):
    """Collects commands addressed to this pump, applies START / STOP the way the panel would, and answers.

    Returns False when the API has no device command channel (not in outbox mode), so the caller stops asking.
    """
    pid = pump["id"]
    headers = {"X-Device-Id": pid}
    try:
        resp = client.get(f"{API_BASE}/telemetry/commands", headers=headers)
    except Exception as e:
        print(f"⚠️ [{pid}] Command poll failed: {e}")
        return True
    if resp.status_code == 404:
        return False
    if resp.status_code != 200:
        return True

    def ack(frame):
        client.post(f"{API_BASE}/telemetry/ack", json=frame, headers=headers)

    for msg in resp.json().get("commands", []):
        cmd, cid = msg.get("cmd"), msg.get("cid")
        print(f"📥 [{pid}] Command {cmd} ({cid})")
        if SIM_FIRMWARE == "silent":
            continue
        if SIM_FIRMWARE == "f2":
            ack({"v": 1, "type": "CMD_ACK", "cid": cid, "stage": "delivered"})

        if cmd in ("START", "STOP"):
            # A panel refuses to start while a fault is latched (SRS §6.1 motor_cmd).
            ok = not (cmd == "START" and fault)
            if ok:
                pump["is_running"] = cmd == "START"
            frame = {"cmd": "ack", "ref": "motor_cmd", "ok": 1 if ok else 0}
            if SIM_FIRMWARE == "f2":
                frame = {"v": 1, "type": "CMD_ACK", "cid": cid, "stage": "acknowledged" if ok else "rejected",
                         **({} if ok else {"reason": "fault_active"})}
            ack(frame)
        else:
            # Timers, fault reset and the rest are not implemented by the simulated panel: it stays quiet,
            # exactly like a controller that does not understand the message.
            print(f"   [{pid}] {cmd} is not supported by the simulated panel: no answer")
    return True


def simulate_loop():
    print(f"📡 Starting AgriPump Multi-Device Simulator...")
    print(f"Target API: {API_BASE}/telemetry | Tick rate: {TICK_SECONDS}s per fleet cycle")
    print(f"Simulating {len(PUMP_DEVICES)} devices: {[p['id'] for p in PUMP_DEVICES]}\n")
    
    # Sequence numbers are de-duplicated per device by the API: start from the clock so a restart never reuses them.
    for p in PUMP_DEVICES:
        p["seq"] = int(time.time())

    client = httpx.Client(timeout=4.0)
    active_faults = {p["id"]: 0 for p in PUMP_DEVICES}
    has_command_channel = True

    try:
        while True:
            for p in PUMP_DEVICES:
                pid = p["id"]
                p["seq"] += 1

                if has_command_channel:
                    has_command_channel = answer_commands(client, p, active_faults[pid])
                    if not has_command_channel:
                        print("ℹ️ API has no device command channel (IOT_PUBLISH_MODE is not outbox): commands will not be collected.")
                
                profile = p.get("profile", "ac_3ph")
                is_running = p["is_running"]
                fault = active_faults[pid]

                if profile == "solar":
                    sun_factor = get_sun_factor()

                    # 2% chance of random VFD fault injection while running in daylight
                    if is_running and sun_factor > 0.02 and random.random() < 0.02 and fault == 0:
                        f_item = random.choice(VFD_FAULT_CODES)
                        fault = f_item["code"]
                        active_faults[pid] = fault
                        print(f"⚡ [{pid} VFD FAULT INJECTED] {f_item['name']} (Fuji {f_item['fuji']}, Code {fault})")
                    elif fault != 0 and random.random() < 0.25:
                        print(f"✅ [{pid} VFD FAULT CLEARED] Returning to normal operation.")
                        fault = 0
                        active_faults[pid] = 0

                    if is_running and fault == 0 and sun_factor > 0.02:
                        p["rt"] += int(TICK_SECONDS)
                        vfd_status = "RUNNING"
                        hz = round(min(50.0, max(15.0, 50.0 * sun_factor + random.uniform(-0.2, 0.2))), 1)
                        kw = round(max(0.1, 5.5 * (sun_factor ** 1.3) + random.uniform(-0.05, 0.05)), 2)
                        v_dc = round(420.0 + 260.0 * sun_factor + random.uniform(-4.0, 4.0), 1)
                        v_ac = round(min(415.0, (hz / 50.0) * 415.0 + random.uniform(-2.0, 2.0)), 1)
                        i_out = round(11.0 * sun_factor + random.uniform(-0.2, 0.2), 1)
                        mot = 1
                        st = 2
                    else:
                        vfd_status = "FAULT" if fault > 0 else ("STANDBY" if is_running else "STOPPED")
                        hz = 0.0
                        kw = 0.0
                        v_dc = round(520.0 * sun_factor + random.uniform(-3.0, 3.0), 1) if sun_factor > 0.02 else 0.0
                        v_ac = 0.0
                        i_out = 0.0
                        mot = 0
                        st = 4 if fault > 0 else 1

                    payload = {
                        "dev_id": pid,
                        "mot": mot,
                        "st": st,
                        "flt": fault,
                        "rt": p["rt"] // 60,
                        "rssi": random.randint(-85, -60),
                        "seq": p["seq"],
                        "vfd": {
                            "hz": hz,
                            "i_out": i_out,
                            "v_ac": v_ac,
                            "v_dc": v_dc,
                            "kw": kw,
                            "status": vfd_status,
                            "fault_code": fault if fault >= 100 else 0
                        }
                    }

                    try:
                        resp = client.post(f"{API_BASE}/telemetry", json=payload)
                        status_icon = "🔴" if fault > 0 else ("🟢" if (is_running and sun_factor > 0.02) else "⚪")
                        print(f"{status_icon} [{pid} SOLAR] Sun: {sun_factor:.2f} | {hz}Hz {kw}kW {v_dc}Vdc {v_ac}Vac {i_out}A St: {vfd_status} Flt: {fault} -> HTTP {resp.status_code}")
                    except Exception as e:
                        print(f"⚠️ [{pid}] Solar telemetry send failed: {e}")

                else:
                    # AC_3PH device simulation
                    if is_running and fault == 0:
                        p["rt"] += int(TICK_SECONDS)
                        v_ry = round(random.uniform(410.0, 425.0), 1)
                        v_yb = round(random.uniform(408.0, 423.0), 1)
                        v_br = round(random.uniform(412.0, 426.0), 1)

                        # Current scaled by HP
                        base_i = 1.8 * (p["hp"] / 5.0) * 10
                        i_r = round(random.uniform(base_i - 0.5, base_i + 1.2), 1)
                        i_y = round(random.uniform(base_i - 0.4, base_i + 1.1), 1)
                        i_b = round(random.uniform(base_i - 0.6, base_i + 1.0), 1)
                    else:
                        v_ry = round(random.uniform(415.0, 422.0), 1)
                        v_yb = round(random.uniform(415.0, 422.0), 1)
                        v_br = round(random.uniform(415.0, 422.0), 1)
                        i_r, i_y, i_b = 0.0, 0.0, 0.0

                    # 2% chance of random fault injection while running
                    if is_running and random.random() < 0.02 and fault == 0:
                        f_item = random.choice(FAULT_CODES)
                        fault = f_item["code"]
                        active_faults[pid] = fault
                        print(f"⚡ [{pid} FAULT INJECTED] {f_item['name']} (Code {fault})")
                    elif fault != 0 and random.random() < 0.25:
                        print(f"✅ [{pid} FAULT CLEARED] Returning to normal operation.")
                        fault = 0
                        active_faults[pid] = 0

                    payload = {
                        "dev_id": pid,
                        "vl": [v_ry, v_yb, v_br],
                        "i": [i_r, i_y, i_b],
                        "mot": 1 if is_running else 0,
                        "st": 4 if fault > 0 else (2 if is_running else 1),
                        "flt": fault,
                        "rt": p["rt"] // 60,
                        "ol": 25.0,
                        "rssi": random.randint(-85, -60),
                        "seq": p["seq"]
                    }

                    try:
                        resp = client.post(f"{API_BASE}/telemetry", json=payload)
                        status_icon = "🔴" if fault > 0 else ("🟢" if is_running else "⚪")
                        print(f"{status_icon} [{pid}] V: [{v_ry},{v_yb},{v_br}] I: [{i_r},{i_y},{i_b}] Fault: {fault} -> HTTP {resp.status_code}")
                    except Exception as e:
                        print(f"⚠️ [{pid}] Telemetry send failed: {e}")

            time.sleep(TICK_SECONDS)
    except KeyboardInterrupt:
        print("\nMulti-Device Simulator stopped.")
    finally:
        client.close()

if __name__ == "__main__":
    simulate_loop()
