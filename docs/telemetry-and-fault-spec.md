# Telemetry, Fault & Command Interlock Specifications

## 1. Adaptive Data Ingestion Intervals & Cellular Optimization

To minimize cellular data consumption and AWS IoT Core costs while ensuring instant emergency response, the 4G MCU module enforces adaptive telemetry reporting intervals:

| Pump Condition | Reporting Interval | Purpose |
| :--- | :--- | :--- |
| **Pump OFF (Idle)** | **Every 5 Minutes (300s)** | Periodic heartbeat & grid voltage monitoring without wasting cellular data. |
| **Pump ON (Running)** | **Every 2 Minutes (120s)** | Active 3-phase power health tracking ($V_{RY}, V_{YB}, V_{BR}, I_R, I_Y, I_B, \text{PF}$). |
| **Fault Occurrence** | **IMMEDIATE (< 100ms)** | Instant event packet published upon Phase Loss, Overload, Dry-Run, or Phase Reversal. |
| **Start / Stop Event** | **IMMEDIATE (< 100ms)** | Instant state change notification published when contactor engages or disengages. |

---

## 2. Motor Protection Interlock: 45-Second Command Cooldown

To prevent rapid contactor toggling ("contactor chatter") that damages motor windings, contactor tips, and electrical grid infrastructure:

1. **Firmware Interlock (Hardware Controller Level)**:
   - The MCU ignores ON/OFF remote cloud commands or local push-button triggers issued within **45 seconds** of the previous command execution.
   - Responds with error payload: `{"status": "REJECTED", "reason": "COOLDOWN_ACTIVE", "remainingSec": 32}`.

2. **Web & Mobile App UI Interlock**:
   - Upon engaging or disengaging the remote contactor switch, the UI locks the toggle switch for **45 seconds**.
   - Displays a live countdown timer badge: `⏳ Cooldown: 45s` $\rightarrow$ `⏳ Cooldown: 44s` ... `✅ Ready`.

---

## 3. Revised Fleet Message & Cost Impact (100 Devices)

- **Old 30s Fixed Publishing**: 2,880 messages/day/device = 8.64 Million msg/month $\rightarrow$ AWS IoT Cost: **$15.70 / mo**
- **New Adaptive Ingestion (5m Off / 2m On)**: ~500 messages/day/device = 1.5 Million msg/month $\rightarrow$ AWS IoT Cost: **$3.20 / mo**
- **Cellular Data Savings**: **> 80% reduction** in 4G SIM data usage (now under **5 MB / month per pump**)!
