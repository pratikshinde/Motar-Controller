# ProEmbSys_MQTT_4G_Bridge_A7672S

A professional-grade, high-performance, non-blocking bidirectional MQTT bridge running natively on the **SIMCOM A7672S** LTE-CAT1 OpenSDK. It bridges physical **M031 MCU** UART JSON communications to local or remote MQTT brokers (such as HiveMQ or AWS IoT Core).

---

## 📐 Bidirectional Architecture

```
┌──────────────┐     UART (115200 8N1)     ┌──────────────┐      MQTT (TCP/TLS)     ┌──────────────────────┐
│   M031 MCU   │ ◄────────────────────────►│  A7672S LTE  │ ◄─────────────────────► │  HiveMQ / AWS IoT    │
│ (Telemetry)  │    JSON Line Buffering    │ (Bridge App) │      Port 1883/8883     │  (Web Client/Cloud)  │
└──────────────┘                           └──────────────┘                         └──────────────────────┘
```

* **Upstream Flow:** The MCU transmits JSON strings containing system parameters or faults. The A7672S decodes the payload, dynamically extracts the registered `dev_id` as its MQTT Client ID, and instantly publishes it to the appropriate telemetry or fault topic.
* **Downstream Flow:** Remote cloud commands published to the device's command topic are received by the A7672S's background thread, validated, and forwarded **verbatim** to the MCU UART.

---

## ✨ Key Features

1. **Non-Blocking Architecture:** Network PDP context and MQTT connections are established asynchronously in the background. The bridge task never locks up on boot, ensuring the UART callback is always responsive to incoming registration commands.
2. **Dynamic Client ID Resolution:** Captures the `"dev_id"` dynamically from the MCU's registration packet (e.g. `"Swathi_001"`) and sets it as the MQTT Client ID and topic parameter on-the-fly.
3. **Real-Time UART Diagnostic Logging:** Implements `McuDebugPrint()` which captures internal SDK return codes and prints them to the physical MCU UART as formatted JSON log events for extreme visibility.
4. **Resilient Reconnections:** Automatic recovery logic with exponential backoff handles network drops or broker disconnections transparently.

---

## 📡 Message Routing & Topics

| Direction | MQTT Topic | Trigger JSON Command | Description |
|-----------|------------|-----------------------|-------------|
| **MCU ➡️ Cloud** | `devices/{dev_id}/telemetry` | `{"cmd":"reg", "dev_id":"..."}` | Dynamic registration & initialization. |
| **MCU ➡️ Cloud** | `devices/{dev_id}/telemetry` | `{"cmd":"status", ...}` | Periodic metrics (voltage, current, etc.). |
| **MCU ➡️ Cloud** | `devices/{dev_id}/telemetry` | `{"cmd":"ack", ...}` | Command response confirmation. |
| **MCU ➡️ Cloud** | `devices/{dev_id}/faults` | `{"cmd":"fault", ...}` | Real-time alarm reports (overload, trip). |
| **Cloud ➡️ MCU** | `devices/{dev_id}/commands` | `{"cmd":"control", ...}` | Verbatim command forwarding to MCU UART. |

---

## 🛠️ Major Debug Milestones & Fixes

### 1. Username/Password Parameter Validation (Error Code `12`)
* **Symptom:** Synchronous calls to `sAPI_MqttConnect()` failed instantly returning error `12` (`SC_MQTT_RESULT_INVALID_PARAMETER`).
* **Root Cause:** When connecting to public brokers that do not require credentials, passing empty strings `""` for `MQTT_USERNAME` and `MQTT_PASSWORD` was rejected by the SIMCOM SDK parameter validator (which expects length $\ge 1$).
* **Resolution:** Implemented dynamic credential sanitization in `mqtt_bridge.c` to pass `NULL` instead of empty strings when credentials are empty.

### 2. Downstream URC Packet Filter Blocker (`SC_SRV_MQTT = 6`)
* **Symptom:** Inbound commands printed `URC message filtered out!` and failed to reach the MCU.
* **Root Cause:** A duplicate preprocessor definition in `app_config.h` defined `#define SC_SRV_MQTT 0x0006`, overriding the native SDK enum value (`54`). This forced the comparison `if (SC_SRV_MQTT != msgQ.msg_id)` to evaluate as `6 != 54` (True), causing the bridge to silently filter out all valid MQTT packets.
* **Resolution:** Deleted the duplicate macro redefinition, restoring `SC_SRV_MQTT` to its correct SDK enum definition and instantly unlocking downstream command routing.

---

## 🏗️ Build & Package Instructions

Compilation is managed using **Ninja** and the **ARM GCC cross-toolchain** provided inside the SDK environment:

1. **Clean/Compile:**
   ```powershell
   ninja
   ```
2. **Compress Application Binary:**
   ```powershell
   arm-none-eabi-objcopy -O binary customer_app.elf customer_app.bin
   lzma e customer_app.bin customer_app_lzma.bin
   ```
3. **Calculate CRC & Package:**
   ```powershell
   crc_set customer_app_lzma.bin customer_app_crc.bin
   python pack_image.py
   ```
   *This automatically generates the flashable production file `SC_A7672S_LASC_8M_CUSTOMER_APP.zip` in the root of the project.*
