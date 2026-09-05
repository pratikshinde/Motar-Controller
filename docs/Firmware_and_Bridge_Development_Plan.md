# MCU Firmware & MQTT Bridge — Development Plan

**Date:** 18 August 2026
**Scope:** `firmware/` (Nuvoton M031LD2AE, v1.0.367) and
`MQTT Bridge A7672 Firmware/` (`swathi_mqtt` V1.0.1, SIMCom A7672S OpenSDK),
plus the cloud-side ingestion path that currently connects neither to the other.
**Method:** direct source reading, 18 Aug 2026. Every finding below cites the
line it came from. Where this plan disagrees with `SRS_v7.0.md` Appendix D, the
disagreement is called out explicitly — Appendix D remains an excellent audit
and most of it is confirmed here.

---

## 0. Context and the one governing constraint

The MCU is a **shipping product with 300+ units in the field and no OTA**.
Every MCU change is a truck roll. The bridge, by contrast, has stock FOTA
available in the SDK (`CONFIG_HAS_DEMO_OTA=y`, SRS §5.0.3).

**Therefore: complexity belongs in the bridge.** This plan pushes every fix
that *can* live in the bridge into the bridge, and reduces the MCU to one
urgent safety release plus one batched functional release. That is not a
stylistic preference; it is the difference between a software deploy and
300 site visits.

The product owner has stated that AWS IoT certificates are theirs to provision
and that they will supply the required information. **Two findings below change
what "just certificates" means** — §2 (identity must be decided *before* certs
are issued) and §3 (nothing currently carries data from AWS IoT into the
backend). Both are called out early for that reason.

---

## 1. Audit findings

Ordered by risk. **[MCU]**, **[BRIDGE]**, **[CLOUD]** mark where the fix lands.

### 1.1 Critical

| # | Finding | Evidence |
|---|---|---|
| **F-1** | **[MCU] Overload and imbalance trips can be permanently disabled for an entire run cycle.** This is SRS GAP-31, but the mechanism is worse than documented and it is not only an arithmetic wraparound. Three compounding defects: **(a)** `OVERLOAD_TIMEOUT - ((getMillis() - overloadInitMillis) / 1000) > 0` promotes the `int` 3 to `uint32_t` (`getMillis()` returns `uint32_t`), so once elapsed exceeds 3 s the expression wraps to ~4.29e9 and the `> 0` test is **permanently true** — the trip branch becomes unreachable. **(b)** The inner reset `else { overloadInitFlag = 0; }` is **dead code**: its guarding condition (lines 932-934) is byte-identical to the outer condition (lines 921-923) that must already be true to reach it, so the flag is never cleared here. **(c)** Because the flag is never cleared and the timestamp never refreshed, a brief overload excursion that ends before 3 s leaves `overloadInitFlag = 1` with a stale `overloadInitMillis`. **Net effect:** a transient overload early in a run silently disarms overload protection for the rest of that run — a later *sustained* overload computes elapsed ≫ 3 s, wraps, and never trips. The motor burns. Identical structure for imbalance. | `MotorProtection.c:921-949` (overload), `:950-976` (imbalance); `Timer3_Int.h:5` (`uint32_t getMillis(void)`); `config.h:65-66`. Flags only reset on motor start (`:551`), entry to `STATE_IDLE` (`:710`), and manual button reset (`:1158`) — never mid-run. |
| **F-2** | **[CLOUD] There is no ingestion path from AWS IoT Core to the backend. The wire is cut in the middle.** The bridge publishes MQTT to `devices/{dev_id}/telemetry`. The backend ingests via `POST /api/telemetry` over HTTP with an `X-Device-Key` header. **Nothing connects them** — no IoT Rule, no Lambda, no subscriber anywhere in this repository. The `android/aws-setup/*.py` Lambdas belong to the retired DynamoDB/Timestream stack and do not write to Postgres. Additionally the two payload schemas are **entirely disjoint** (§3.2). A real device today would publish successfully to AWS IoT and the portal would never see a row. | `mqtt_bridge.c:263-274`; `backend/server.js:2337-2341`; no rule/subscriber found in `backend/`. |
| **F-3** | **[CLOUD/BRIDGE] Device identity is contradictory three ways, and certificates bake the choice in permanently.** SRS §6.7 FR-SEC-030 requires `dev_id` == AWS IoT thing name == certificate CN. The MCU asserts `dev_id` = its **96-bit MCU UID** (`FMC_ReadUID`). The backend and portal key everything on **IMEI** (decision D-4, already implemented — `pumps.id` is the IMEI, and the whole factory/batch/whitelist flow is IMEI-based). These cannot all be true. Because the CN and thing name are fixed at certificate issuance, **choosing wrong means re-issuing every certificate in the fleet.** | `IoT_Comm.c:203-206` (dev_id = UID); `backend/schema.sql` `pumps.id`; SRS §6.7. |
| **F-4** | **[BRIDGE] Anyone on the internet can start or stop any pump.** The enabled build is `MQTT_MODE_GENERIC` — plain TCP, port 1883, to the **public broker `mqtt-dashboard.com`**, no TLS, no credentials. Inbound payloads are forwarded to the MCU UART **verbatim and unparsed**. The MCU applies `motor_cmd` **unconditionally** with no validation. Client ID and topics are derived from a guessable `dev_id`. Confirms SRS GAP-22 + GAP-23. | `app_config.h:14,34-42` (generic mode enabled); `mqtt_bridge.c:320-329` (`SendToMCU(copy)` with no parsing); `IoT_Comm.c:291-302` (`motor_cmd` applied unconditionally). |

### 1.2 High

| # | Finding | Evidence |
|---|---|---|
| **F-5** | **[BRIDGE] No offline buffering — a fault during an outage is lost permanently.** `MqttPublish()` returns −1 when `g_mqtt_connected` is false, and `RouteMcuToMqtt()` **discards the return value entirely** for `status`, `fault` and `ack`. Nothing is queued at either end. This defeats the core proposition in exactly the rural conditions the product targets. Confirms GAP-1. | `mqtt_bridge.c:246` (early −1), `:268-274` (return value ignored). |
| **F-6** | **[BRIDGE] The debug log on the command path can corrupt the command that follows it.** `McuDebugPrint` builds a **320-byte** JSON line; the MCU's RX ring is **256 bytes**. Critically, it is called *from inside the command handler with the full command payload* immediately before the command is delivered — so every inbound command is preceded by an oversized log line down the same UART. Separately, `PeriodicReporterTask` writes a `net_update` line to the MCU UART **every 2 seconds**. This sharpens GAP-24 from "background noise" to "a specific corruption mechanism on the control path." | `mqtt_bridge.c:73-74` (320 B buffer), `:325-326` (log then send, same UART), `:474-481` (2 s reporter to `SC_UART` = `MCU_UART_PORT`). |
| **F-21** | **[MCU] Fault promotion silently converts a manual-reset fault into an auto-reset one, contradicting the customer requirement that overload and imbalance be cleared only by a human.** The manual/auto split itself is implemented correctly: `current_fault` faults (OVER_LOAD, IMBALANCE, CABLE_OPEN_ALL/PARTIAL) latch and require a physical `BUTTON_PREV`/`BUTTON_NEXT` press; `voltage_fault` faults auto-recover once the voltage condition clears. **However**, while latched in OVER_LOAD or IMBALANCE, if any voltage flag becomes set the promotion block reassigns `activeFaultCode` to the voltage fault and executes `voltage_fault = 1; current_fault = 0;` — **clearing the manual-reset latch**. Recovery then takes the auto branch and returns to `STATE_IDLE` with no button press. This is *deliberate* (the source comment reads "upgrade it to a voltage fault (auto reset). Root cause is usually the voltage"), and as a **diagnosis** it is usually right — a lost phase does drive the healthy phases into overcurrent, and in that case the winding is fine and auto-recovery is correct. The problem is that promotion couples **diagnosis** to **reset policy**. **Severity comes from the latch window, not from winding faults:** the promotion triggers require a genuine supply event (`COMPARE_VALUE_VOLT_PHASE_LOSS` is 90 V — on a 415 V system that is essentially a lost phase, not a load-induced sag), so a winding fault on a normal supply will *not* promote. The realistic sequence is instead: an overload latches → the panel sits waiting for a human for hours or days → an *independent* supply event occurs during that window (routine on rural feeders) → the latch is silently cleared → the supply recovers and the pump restarts with no inspection. Probability over a multi-hour latch is not low, which is why this is rated High. **Detectable in existing field data:** the portal showing a pump `RUNNING` while an unacknowledged `OverLoad`/`Imbalance` fault is still open is evidence of this path firing. **DECISION (G-7, 18 Aug 2026): accepted as-is, not fixed** — a genuine winding fault re-trips on the next run, so the latch is a service convenience rather than the safety net. Recorded here because the reasoning is load-bearing: it assumes the overload trip works reliably on that next run, which is precisely what F-1 defeats. | Promotion: `MotorProtection.c:999-1019` (esp. `:1007,1011,1015,1019` clearing `current_fault`). Correct split: `:1069-1086` (sets `current_fault`), `:1121-1127` (voltage auto-recovery), `:1130-1164` (manual button reset). |
| **F-7** | **[BRIDGE] No timestamps, no sequence numbers, no schema version.** The MCU sends none and the bridge adds none — it republishes the MCU's JSON byte-for-byte. Buffered replay (F-5) would be unorderable and dedup has nothing to key on. The SDK provides NTP and RTC (`CONFIG_HAS_DEMO_NTP=y`), so this needs no invention. Confirms GAP-2/GAP-11. | `mqtt_bridge.c:269-273` (raw `json` republished). |

### 1.3 Medium

| # | Finding | Evidence |
|---|---|---|
| **F-8** | **[MCU/CLOUD] Under-voltage is advertised but not implemented — and the cloud already defines a fault code the firmware can never emit.** `Voltage_Under` exists in the settings struct, defaults to 180 V, and is printed in a debug dump — but is **never read by any protection logic**, and there is no fault code for it (codes stop at 9). Meanwhile `fault_code_catalog` in the backend defines **code 10 = 'UnderVolt'**. The portal can therefore display a protection that does not exist. Under-voltage is a primary motor-burnout cause in rural India. Confirms GAP-3 and adds the cloud-side half. | `Init_Settings.h:13`, `Init_Settings.c:139` (default 180), `:111` (debug print only); no reader in `MotorProtection.c`; `MotorProtection.h:23-32` (codes 0-9); `backend/schema.sql` catalog row `(10,'UnderVolt',...)`. |
| **F-9** | **[MCU] `Timing_OverLoad` is a dead setting that actively misleads.** Declared, defaulted to **7 s**, printed in the settings dump — and never read. The real delay is the compile-time `OVERLOAD_TIMEOUT` = **3 s**. A user or the cloud can set "overload delay = 7 s" and the device will trip at 3 s. Confirms GAP-10. | `Init_Settings.h:23`, `Init_Settings.c:146`; `config.h:65`; only consumer is `MotorProtection.c:930` using the macro. |
| **F-10** | **[MCU] Phase currents are rounded to whole amps on the wire.** `(int)(Cur_R + 0.5f)` discards everything below 1 A before transmission, while the backend column is `NUMERIC(5,2)`. On a 3 HP motor (~4-5 A FLC) that is >20 % quantisation, which degrades overload diagnostics and trend charts. The measurement itself is true-RMS float — the precision is thrown away only at the serialisation step. **Not previously recorded in Appendix D.** | `IoT_Comm.c:220-221`, `:239`; `schema.sql` `telemetry_history.i_r NUMERIC(5,2)`. |
| **F-11** | **[CLOUD] The MCU already reports total runtime and the backend has nowhere to put it.** `IoT_SendStatus` emits `"rt"` (total runtime seconds); `telemetry_history` has **no runtime column**, so it is silently dropped. This is the same data the Android plan had to omit from the Pump screen for lack of a source. One column closes a gap in three layers at once. | `IoT_Comm.c:219,222`; `schema.sql` §5 column list. |
| **F-12** | **[BRIDGE] GSM signal is measured but never reaches the cloud.** The bridge computes `GetSignalDbm()` and reports it *to the MCU* over UART, but never adds it to a published payload; the MCU's `status` has no RSSI field. `telemetry_history.gsm_rssi` will therefore always be NULL, and the app's signal chip will never render. | `mqtt_bridge.c:117-123`, `:78-83` (to MCU only); `IoT_Comm.c:213-223` (no rssi field). |
| **F-13** | **[BRIDGE] The first `reg_ack` is always a failure ack.** On `reg`, `RouteMcuToMqtt` calls `SendRegAck(MqttPublish(...) == 0 ? 1 : 0)` — but MQTT connection is deliberately deferred until *after* registration, so `g_mqtt_connected` is 0 and `MqttPublish` returns −1. The MCU therefore always receives `reg_ack:0` first, then `reg_ack:1` later from `MqttConnect()`. The registration record itself is never published. Sharpens GAP-28 (which noted the duplicate but not that the first is a *failure*). | `mqtt_bridge.c:267` vs `:246` and `:422` (connect gated on `g_registered`); second ack at `:231`. |
| **F-14** | **[BRIDGE] No Last Will and Testament; `clean_session = 1`.** No LWT is registered on connect, so the cloud cannot distinguish "dropped off" from "quiet" and offline detection rests entirely on missed-telemetry timeouts (5 min when idle). With `clean_session = 1` the broker holds no queued QoS-1 downlink, so a command issued while the device is briefly offline is silently dropped. Confirms GAP-25/GAP-26. | `mqtt_bridge.c:215-217`; `app_config.h:51`. |

### 1.4 Low / hygiene

| # | Finding |
|---|---|
| F-15 | **[BRIDGE]** `sAPI_Malloc` is called **twice per UART RX event** inside `McuUartCallback` (a driver callback). Heap allocation on the hot serial path is a fragmentation and latency risk over months of uptime; a static ring buffer is the conventional fix. `mqtt_bridge.c:283,290`. **Not in Appendix D.** |
| F-16 | **[BRIDGE]** `MQTT_CLIENT_ID "SwathiSwitchgear_001"` is defined in both modes and **never used** — `sAPI_MqttAccq` passes `g_device_id`. Dead config that contradicts actual behaviour. `app_config.h:21,38` vs `mqtt_bridge.c:191`. |
| F-17 | **[BRIDGE]** Hard-coded fallback broker IP `3.120.11.244`. A stale third-party address that could silently carry production traffic. Deleted with the generic-mode block. `app_config.h:37`. |
| F-18 | **[BRIDGE]** `MqttDisconnect()` (which calls `sAPI_MqttStop()`) runs before the *first* connection attempt, stopping a stack never started. Harmless but noisy. `mqtt_bridge.c:425`. |
| F-19 | **[MCU]** Settings integrity is a two-field magic check (`state==1 && state2==90`). Any struct layout change must bump `state2` or field-shifted garbage reads as valid — this becomes dangerous the moment OTA can change the struct. A CRC is the right answer. (GAP-18.) |
| F-20 | **[MCU]** `CABLE_OPEN_LOAD_IMBALANCE 500` carries a `// Percent?` comment — the unit is genuinely unclear in source. (GAP-16.) `config.h:74`. |

### 1.5 What works and should not be touched

Confirmed by reading, and consistent with Appendix D.4. **MCU:** true-RMS measurement with dynamic offset tracking; the 8-state protection machine; phase-sequence detection by zero-crossing timing; the non-blocking JSON parser with no dynamic allocation; cyclic-timer persistence across reboot; the fault-promotion logic (`MotorProtection.c:995-1019`), which correctly upgrades a latched current fault to the underlying voltage fault. **Bridge:** the three-task non-blocking structure; deferring MQTT connect until the MCU registers (correct — the client ID comes from `reg`); exponential backoff with a connection-lost callback; line reassembly across UART read boundaries; the LZMA + CRC packaging pipeline.

The remaining work should route around these.

---

## 2. Decide identity before a single certificate is issued

This is the highest-leverage decision in the plan and it is **cheap now and expensive later** (F-3).

| Option | Consequence |
|---|---|
| **A — `dev_id` = IMEI (recommended)** | Matches the backend, portal, factory batch import, IMEI whitelist and the entire already-built provisioning flow (D-4). The bridge **already knows its own IMEI** and would assert it directly rather than relaying the MCU's claim — which also removes the MCU from the identity path entirely, strengthening §6.7. Cost: one bridge change; the MCU's `dev_id` becomes diagnostic-only. **Consequence to accept:** identity follows the modem, so a modem swap changes device identity — which is exactly what the already-built `bridge_swap_log` + `ON UPDATE CASCADE` migration path in the backend was designed to handle. |
| **B — `dev_id` = MCU UID** | Matches the current firmware and SRS §6.7 as written. Requires re-keying the backend, portal, batch import and IMEI whitelist off IMEI — undoing shipped, verified work. Not recommended. |
| **C — Both (thing name = IMEI, MCU UID carried as an attribute)** | Recommended **in addition to A**: keep the MCU UID in the payload as `mcu_uid` for panel-binding and RMA traceability (the backend already has `mcu_swap_log`), while identity/authentication is IMEI. |

**Recommendation: A + C.** Thing name = certificate CN = MQTT client ID = **IMEI**; MCU UID travels as a payload attribute for traceability. This needs to be settled before the AWS account is provisioned.

---

## 3. The missing middle: ingestion (F-2)

### 3.1 Transport

An AWS IoT **Rule** with an **HTTPS action** posting to the backend is the
simplest path that works and needs no new compute:

```
device --mTLS--> AWS IoT Core --Rule (SQL SELECT on devices/+/telemetry)--> HTTPS POST /api/v1/telemetry --> Postgres
```

Two consequences to plan for, neither optional:

1. **The backend must be publicly reachable over HTTPS with a valid certificate.** It runs on `localhost:5000` today. Hosting/TLS termination is a prerequisite for ingestion, not a later concern.
2. **`X-Device-Key` does not fit this model.** The backend authenticates ingestion with a per-device shared key (`authenticateDevice`). An IoT Rule cannot easily hold 300 different keys. The clean resolution is to trust the mTLS-authenticated IoT connection and have the Rule inject `${clientid()}` as an attested `pump_id`, with the backend accepting a single Rule-level credential over HTTPS **plus** the requirement that `pump_id` equal the injected client ID (this is FR-SEC-032 — the application-layer half of identity binding). Keep `X-Device-Key` for the simulator/direct-HTTP path.

Alternative if per-device keys must be preserved: Rule → Lambda → look up key → POST. More moving parts and a per-message cost; recommended only if a specific requirement demands it.

### 3.2 Schema translation — the payloads are disjoint today

| MCU sends (`IoT_Comm.c:213-223`) | Backend expects (`server.js:2341`) | Action |
|---|---|---|
| — | `pump_id` | **Inject** from client ID / IMEI |
| `vl:[VRY,VYB,VRB]` | `v_ry`, `v_yb`, `v_br` | Unpack array |
| `i:[R,Y,B]` | `i_r`, `i_y`, `i_b` | Unpack array; **restore decimals (F-10)** |
| `mot` | `pump_on` | Map |
| `flt` | `fault_code` + `fault_active` | Map; `fault_active = flt != 0` |
| `st` (machine state) | — | Add column or carry in `diag` |
| `rt` (total runtime) | — | **Add `total_run_sec` column (F-11)** |
| `ol` (overload setpoint echo) | — | Superseded by `get_settings` |
| — | `gsm_rssi` | **Bridge enriches (F-12)** |
| — | `seq`, `ts_approx` | **Bridge enriches (F-7)** |

**Where should translation live — bridge or cloud?** Recommend **the bridge**:
it already must add `ts`/`seq`/RSSI (F-7, F-12), it is the only place that knows
whether a record was buffered, and doing it there keeps the Rule a dumb pipe and
keeps the MCU untouched. The cost is a slightly larger bridge payload; the
benefit is that the cloud contract becomes the backend's existing, already-tested
`POST /api/v1/telemetry` shape.

---

## 4. Phased plan

Phases F0 and F1 are independent and can run in parallel; F2 gates any real
field test.

### Phase F0 — MCU safety release (~0.5-1 week) · **do first, independent of everything**

Fix F-1 only. Deliberately a single-purpose release so it can be reasoned about
and bench-tested in isolation, and shipped to existing panels without waiting
on any cloud work.

The corrected pattern (compare elapsed against the threshold rather than
counting down through zero, and move the reset to a reachable branch):

```c
uint32_t now = getMillis();
int overload_now = (Cur_R > GlobalSettings.Current_OverLoad ||
                    Cur_Y > GlobalSettings.Current_OverLoad ||
                    Cur_B > GlobalSettings.Current_OverLoad);

if (overload_now) {
    if (!overloadInitFlag) {
        overloadInitFlag  = 1;
        overloadInitMillis = now;
    } else if ((now - overloadInitMillis) >= (uint32_t)OVERLOAD_TIMEOUT * 1000u) {
        Motor_Stop();
        activeFaultCode = FAULT_OVER_LOAD;
        state = STATE_FAULT;
    }
} else {
    overloadInitFlag = 0;      /* reachable: condition cleared, restart timer */
}
```

Three properties this restores: no unsigned wraparound is possible (`now - start`
is a genuine elapsed value compared against a constant); the reset is reachable;
and the comparison is in milliseconds so the `/1000` truncation disappears.
Apply the identical shape to imbalance. **Audit the same idiom elsewhere** —
dry-run (`:899-902`) uses the same countdown form and is only saved
*accidentally* by its `< 30` upper bound catching the wrapped value; it should
be normalised to the same pattern rather than left relying on that.

**Exit:** bench test — sustained overload trips at 3 s; a 2 s excursion followed
by a later sustained overload **still trips** (today it does not); same for
imbalance at 10 s.

### Phase F1 — Bridge security (~2-2.5 weeks) · parallel with F0

**Implemented 18 Aug 2026** (`mqtt_bridge.c`, `app_config.h`, `swathi_mqtt/CMakeLists.txt`). `firmware/` was **not touched** — the product owner is verifying F-1 independently on a live pump and asked for it to stay untouched pending that result; this phase is bridge-only and has no dependency on it. Not build-verified — no ARM GCC/Ninja/OpenSDK toolchain is available in this environment; see the note at the end of this section.

What landed: generic broker mode deleted from the tree (not just disabled) — single always-on AWS IoT mutual-TLS path; a cJSON-based inbound command validator (whitelist `motor_cmd`/`settings`/`ping`, exact 16-key range table mirrored from `IoT_Comm.c`, message rebuilt from parsed form rather than forwarded verbatim); debug logging (renamed `McuDebugPrint` → `BridgeDebugLog`) no longer touches the MCU UART at all, closing the corruption path in F-6; the 2 s periodic reporter no longer writes to `SC_UART` (=`MCU_UART_PORT`), only `SC_UART2` + the module's own debug console; registration ack is now sent exactly once, from the one place that knows the true outcome (F-13); the disconnect-before-first-connect no-op is skipped (F-18); the dead `MQTT_CLIENT_ID` macro and hardcoded fallback IP are gone (F-16/F-17).

**Deliberately not done in this pass:** device identity (`g_device_id` is still asserted by the MCU's `reg` message, unchanged) — decision G-1 is still open and this code does not presuppose an answer. AWS endpoint and certificate paths in `app_config.h` are `REPLACE-ME` placeholders, same convention as the Android app's `AppConfig.kt` — fill in once the account is provisioned.

**Build-verified 18 Aug 2026**, after the user added the full SDK (`sc_lib`/`sc_demo`/`kernel`, previously absent — see §1 caveat about `.gitignore`d SDK content) and confirmed ARM GCC was installed. Full pipeline run end-to-end with the SDK's own pinned toolchain (ARM GCC 9.2.1 from `tools/win32/cross_tool.zip`, matching `ToolChain.cmake`'s `GCC_VERSION 9.2.1` exactly; CMake 3.22 from `tools/win32/cmake.zip`; `tools/win32/ninja.exe`) — `cmake -G Ninja` configure, `ninja` (57/57 targets, exit 0, `mqtt_bridge.c` and the cJSON validator compiled and linked clean), `arm-none-eabi-objcopy` → `lzma.exe` → `crc_set.exe` → `pack_image.py`, producing `SC_A7672S_LASC_8M_CUSTOMER_APP.zip` (the exact filename the bridge's own README documents) with the LZMA magic byte (`5D 00 00` at offset 8) verified present — the precise signature whose absence caused the silent-boot-failure incident this project's own README already documents. Repeated twice (different build-directory layouts) with identical results.

**A second, independent bug found only by attempting the build, not by reading source:** the root `CMakeLists.txt` never actually wired `application/swathi_mqtt` into the build at all — no `add_subdirectory`, no `target_link_libraries`, and `sc_application.c`'s `userSpace_Main()` never called `sAPP_MqttBridgeInit()`. The library source was complete and correct; nothing reachable ever invoked it. Fixed (both files, alongside the four other add_subdirectory/target_link_libraries blocks already in the vendor CMakeLists for SIMCom's own unrelated reference projects, none of which have source present in this checkout). This gap predates Phase F1 entirely — it would have blocked a build of the pre-F1 code too — and was invisible to a source-only audit.

**Two Windows-specific build environment issues hit and worked around, not code problems:** (1) `Expand-Archive` on the vendor toolchain zips failed with `MAX_PATH` (260-char) errors because this project's own path is already long before the toolchain's deeply-nested `arm-none-eabi/include/c++/...` paths are appended — worked around by extracting to `C:\a7672_build\` instead. (2) `pack_image.py`'s bootloader-image copy step hit the same limit for the same reason — worked around with a temporary `subst X:` drive mapping to the SDK directory (removed after the build completed). Neither affects the flashable output; both are purely about this checkout's absolute path length on this machine.

**One real ambiguity remains, not resolved by a successful build:** `cJSON_Print()`'s returned buffer is freed with plain `free()` per the vendored header's documented contract, not `sAPI_Free()` — a successful *link* doesn't prove this is correct, since both are valid libc-level symbols the linker resolves regardless. Isolated to one helper function (`CopyPrintedJson`) so it's a one-line fix if wrong. A mismatch would show up as intermittent heap corruption at runtime, not a build error — worth a specific watch during hardware bring-up, not something this build run could rule out.

**Worth a product decision, found only via real build sizes:** the resulting image is substantially larger than this project's own previously-documented working baseline — `customer_app.bin` is 211,736 bytes here vs. the ~100 KB factory baseline and ~206 KB "broken" build `CompileInfo_read.me` records, and LZMA-compressed the difference is starker: ~103 KB here vs. the ~30 KB that same document reports for the actual working build. The cause is visible in the build log: `config/.config` has `CONFIG_HAS_DEMO=y` plus dozens of `CONFIG_HAS_DEMO_*=y` flags, which pull SIMCom's entire demo/reference suite (SMS, call, camera, BLE, audio, TTS, POC, WiFi-AP, ~35 unrelated modules) into the image alongside the actual bridge. This is very likely leftover from the SDK's stock example configuration, never trimmed for a production bridge-only build — worth deciding deliberately (trim to just what the bridge needs, keeping only what's wanted for field debugging via the existing CLI) rather than shipping by default. Not fixed here — it's a scope/config decision, not a code defect this pass should make unilaterally.



Closes F-4, F-6, F-16, F-17, F-18.

- Delete `MQTT_MODE_GENERIC`, `MQTT_BROKER_DOMAIN`, `MQTT_BROKER_PORT`, `MQTT_BROKER_FALLBACK_IP` and the dead `MQTT_CLIENT_ID` **from the tree** — a mode that cannot be selected cannot be selected by accident (FR-CON-020). Bench brokers go on a short-lived branch, never a build flag on `main`.
- Complete the AWS path: `sslversion 3` (TLS 1.2), `authmode 2` (mutual), regional endpoint, certificate paths on the module filesystem. The SDK ships working TLS/MQTTS reference code (`CONFIG_HAS_DEMO_SSL=y`, `CONFIG_HAS_DEMO_MQTTS=y`).
- **Inbound command validation** per SRS §6.6: parse with cJSON (already vendored and enabled), whitelist `cmd`, range-check every key, and **re-serialise from the parsed form** rather than forwarding original bytes. Verbatim forwarding is deleted.
- **F-6 is part of this phase, not a nicety:** remove `McuDebugPrint` from the command path, cap any remaining line below 256 B, and move `net_update` off the MCU UART to the `diag` topic. Validating a command and then corrupting it with a 320-byte log line would be self-defeating.
- Identity per §2: assert IMEI as client ID; emit a **distinct diagnostic** for identity mismatch so it is not misread as a network fault in the field (FR-CON-030a).

**Exit:** device connects to AWS IoT with mutual TLS; a malformed or unknown command is rejected and counted, never reaching the MCU; a valid `motor_cmd` arrives intact under sustained load.

### Phase F2 — Ingestion path (~1-1.5 weeks, cloud-side) · **gates any field test**

Closes F-2, F-11, F-12 (cloud half).

- Backend deployed to a public HTTPS endpoint (prerequisite, §3.1).
- IoT Rule with `SELECT ... FROM 'devices/+/telemetry'`, injecting `${clientid()}`.
- Backend: accept the Rule credential; enforce `pump_id == clientid()` (FR-SEC-032); add `total_run_sec` (and optionally `machine_state`) to `telemetry_history`.
- Same for `devices/+/faults`.

**Exit:** a real device publishes and the row appears in the portal — verified live end to end, the same standard applied to every web feature.

### Phase F3 — Bridge reliability (~2-2.5 weeks)

Closes F-5, F-7, F-13, F-14, F-15.

- **Offline buffering** to module flash with replay on reconnect, flagged `buf: true`. The filesystem is available (`CONFIG_HAS_DEMO_FS=y`). Needs a bounded ring with an explicit overflow policy — **drop oldest telemetry, never drop a fault**.
- **NTP time sync + `ts`/`seq`/schema version enrichment**, with `tsApprox` when time is not yet synced. Prerequisite for meaningful replay.
- **RSSI enrichment** (F-12) into the published payload.
- **LWT** on the status topic; re-evaluate `clean_session` for QoS-1 downlink retention.
- **Single `reg_ack`** from one place, reflecting the true outcome (F-13).
- Replace the per-interrupt `sAPI_Malloc` pair with a static ring buffer (F-15).

**Exit:** power the modem down mid-fault, restore, and confirm the fault arrives with a correct timestamp, in order, marked buffered.

### Phase F4 — MCU batched functional release (~2-3 weeks)

Everything that requires touching the MCU, batched into **one** release because
each one costs a site visit until OTA exists.

- **Under-voltage protection** (F-8) — implement, allocate fault code 10 to match the cloud catalog already in place, wire `Voltage_Under`. *This should be confirmed as a product decision first: is it wanted, at what threshold and delay?*
- **`get_settings`** (GAP-5) — the highest-value small change in the list; without it the shadow's `reported` state cannot be populated and config drift is undetectable.
- **`reset_fault`** (GAP-4) — **scope constrained by the manual-reset requirement (F-21).** A remote reset must *not* be able to clear a manual-reset-class fault (OVER_LOAD, IMBALANCE, CABLE_OPEN_*): those mean "inspect the motor", and clearing them from a phone defeats the requirement. Design: the command carries the fault code being cleared; the MCU refuses if it does not match, and refuses manual-class codes outright. Remote reset is therefore useful mainly for latched conditions that do *not* imply physical damage. If a supervised override is wanted later, gate it to technician/dealer roles behind an explicit "I have physically inspected this pump" confirmation with an audit entry — the backend already has the RBAC and `audit_log` to do this. Note this narrows SRS §6.6's `reset_fault` ("no arguments permitted") to a code-carrying form.
- ~~Decouple fault promotion from reset policy (F-21)~~ — **not doing this**, see decision G-7. Promotion stays as built.
- **Promote `Timing_OverLoad` to the live value** (F-9).
- **Send currents with decimals** (F-10) — one format-string change.
- **Per-field settings ack** with reasons (GAP-7), and **debounce flash writes** (GAP-8) — today every settings message writes flash immediately, exposing endurance to a chatty cloud.
- **CRC over the settings struct** (F-19) — do this *before* OTA can change the layout.

**Exit:** portal reads back what the device actually holds; a fault clears remotely; the overload delay a user sets is the delay that runs.

### Phase F5 — OTA (~3-4 weeks) · sequenced last, deliberately

Per SRS §4.6.1: **A/B OTA with rollback is impossible on this part** (47 KB of
64 KB used, ~17 KB free; two images plus a bootloader needs ~100 KB). The
module-staged pattern is the viable option — the A7672S downloads and verifies
the complete signed image to its own filesystem, then a small MCU bootloader
pulls it over UART in chunks.

Sequencing note: **reclaim flash first** (FR-DEV-088 — compiling out the
`printf` debug output in `MotorProtection.c` and `Init_Settings.c` is typically
several KB on a Cortex-M0) and **measure** before sizing the bootloader.
Bridge FOTA is a stock SDK capability and is much easier — worth doing first as
it removes bridge truck rolls immediately.

---

## 5. What is needed from the AWS account

To be supplied by the product owner:

1. **AWS account ID and region** (confirm `ap-south-1`).
2. **IoT Data-ATS endpoint** — `aws iot describe-endpoint --endpoint-type iot:Data-ATS`.
3. **Identity decision from §2** — required *before* certificates are issued (thing name and CN are fixed at issuance).
4. **Provisioning approach** — fleet provisioning by claim (`docs/aws-iot-fleet-provisioning-architecture.md` already designs this) vs. per-device certificates written at manufacture. Claim-based scales; pre-baked is simpler for a small first batch.
5. **A public HTTPS endpoint for the backend** (§3.1) — needed by the IoT Rule; hosting is a real prerequisite, not a detail.
6. **Amazon Root CA 1** plus per-device certificate/key, to be placed at the module filesystem paths.

The IoT policy itself should use client-ID policy variables exactly as SRS
§6.7 FR-SEC-031 specifies, so a device can only ever connect as itself.

---

## 6. Effort and sequencing

| Phase | Estimate | Depends on |
|---|---|---|
| F0 — MCU safety fix | 0.5-1 wk | nothing |
| F1 — Bridge security | 2-2.5 wk | §2 identity decision; AWS endpoint + certs |
| F2 — Ingestion path | 1-1.5 wk | backend hosted publicly; F1 |
| F3 — Bridge reliability | 2-2.5 wk | F1 |
| F4 — MCU batched release | 2-3 wk | product decisions (under-voltage) |
| F5 — OTA | 3-4 wk | flash reclamation measured first |
| **Total** | **~11-14.5 wk** | F0 ∥ F1; F4 ∥ F2/F3 |

Estimates are engineering judgement from the source read, not measured — the
bridge phases carry the most uncertainty because the OpenSDK's exact API
surface for filesystem and NTP has not been verified against `sc_demo/`
(excluded by `.gitignore`; SRS OI-30 flags the same caveat).

**Shortest path to a genuine field pilot:** F0 → F1 → F2. That is roughly
4-5 weeks and yields a device that trips correctly, connects securely, and lands
data in the portal. F3 makes it trustworthy in poor coverage; F4 makes it
complete; F5 makes it maintainable at scale.

---

## 7. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| **G-1** | Device identity (§2) | **IMEI** as thing name/CN/client ID; MCU UID as a traceability attribute. Blocks certificate issuance. |
| **G-2** | Ingestion auth model (§3.1) | IoT Rule + `${clientid()}` attestation; keep `X-Device-Key` for simulator/HTTP. |
| **G-3** | Where translation lives (§3.2) | Bridge — it already must enrich, and it keeps the MCU untouched. |
| **G-7** | Should fault promotion (F-21) keep clearing the manual-reset latch? | **RESOLVED 18 Aug 2026 — leave as-is.** Product owner: "if any motor generates overload flag it will wait for user check; if power is lost and reconnects, if something wrong with windings it will generate fault again." The latch is a service-workflow convenience, not the safety mechanism — protection re-arms on restart and a genuine winding fault re-trips. Losing the latch to a supply event costs one restart cycle, not safety. **This rationale depends on the overload trip working reliably on the next run, which is exactly what F-1 breaks — so it raises, not lowers, the priority of F0.** |
| **G-4** | Under-voltage: implement or remove? | **Implement** (fault code 10 already exists cloud-side). If not, remove `Voltage_Under` from the struct so nothing advertises a protection that does not exist. Needs a product answer on threshold/delay. |
| **G-5** | Ship F0 to fielded units now, or bundle with F4? | **Ship now.** It is a protection defect on 300+ live panels; bundling it behind a multi-week functional release to save a truck roll is the wrong trade. |
| **G-6** | Bridge FOTA before or after MCU OTA? | **Before** — stock SDK capability, removes bridge truck rolls immediately, and F5 depends on the bridge being able to stage images anyway. |

---

## 8. Out of scope

Hardware revision (larger MCU — FR-DEV-090, a certification and production
decision); the cyclic-timer/calendar-scheduling feature reopened by the module
RTC; BLE commissioning (Android Phase 3); OTA *delivery* orchestration via AWS
IoT Jobs beyond what F5 needs.
