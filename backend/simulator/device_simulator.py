import os
import sys
import time
import random
import httpx

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

API_BASE = os.environ.get("API_BASE", "http://localhost:5000/api")
TICK_SECONDS = float(os.environ.get("TICK_SECONDS", "3.0"))

PUMP_DEVICES = [
    {"id": "PUMP-4G-3P-8821", "hp": 15.0, "is_running": True, "seq": 1000, "rt": 1450},
    {"id": "PUMP-4G-3P-9912", "hp": 7.5, "is_running": False, "seq": 2000, "rt": 820},
    {"id": "PUMP-4G-3P-9001", "hp": 5.0, "is_running": True, "seq": 3000, "rt": 340},
]

# 10 SRS §6.2 Fault Codes
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

def simulate_loop():
    print(f"📡 Starting AgriPump Multi-Device Simulator...")
    print(f"Target API: {API_BASE}/telemetry | Tick rate: {TICK_SECONDS}s per fleet cycle")
    print(f"Simulating {len(PUMP_DEVICES)} devices: {[p['id'] for p in PUMP_DEVICES]}\n")
    
    client = httpx.Client(timeout=4.0)
    active_faults = {p["id"]: 0 for p in PUMP_DEVICES}

    try:
        while True:
            for p in PUMP_DEVICES:
                pid = p["id"]
                p["seq"] += 1
                
                # Check for active state
                is_running = p["is_running"]
                fault = active_faults[pid]

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
