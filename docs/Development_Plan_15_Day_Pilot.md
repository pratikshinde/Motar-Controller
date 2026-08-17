# Development Plan — 15-Day Pilot

**Goal:** pilot devices in the field, talking to the production AWS cloud, safely.
**Resource:** one developer.
**Constraint:** 15 working days.
**Priority:** connectivity and safety. Commercial features deferred.

---

## 1. The scope contract

Fifteen days solo is enough for a pilot **only** if "pilot" means this:

| In | Out |
|---|---|
| **5–10 devices**, hand-flashed, installed nearby | Volume manufacture, batch provisioning |
| Per-device certificates written at flash time | Fleet provisioning by claim (§5.2.1) |
| TLS to AWS IoT, mutual auth, validated commands | Public broker, verbatim forwarding |
| Live telemetry, fault alerts, remote start/stop/reset | OTA, subscriptions, white-labelling |
| Web dashboard, superadmin + customer only | Full 6-tier dealer hierarchy, allocation flows |
| Android app hardened, not rearchitected | App migration to the backend API |
| Postgres history, no retention job yet | Compaction, rollups, 30-day automation |

If the pilot needs to be 100 devices, or needs partner onboarding, or needs OTA, this is not a 15-day plan. Say so now rather than on day 12.

**The four non-negotiables.** Everything else on this page can slip. These cannot, because each is a live exposure or a safety defect:

1. GAP-31 — overload and imbalance trips currently fire only by timing luck
2. SEC-1 — `POST /api/telemetry` is unauthenticated
3. SEC-2 — committed superadmin credentials
4. Bridge: TLS to AWS + command validation (GAP-22, GAP-23)

---

## 2. Day 0 — four decisions, before any code

Each blocks work that starts on day 1. Recommendations given so you can decide in an hour, not a week.

| # | Decision | Recommendation for the pilot |
|---|---|---|
| **D-4** | Device identity / thing name | **Use the MCU 96-bit UID.** It already exists, is unique, is what the bridge sends, and needs no allocation scheme. `dev_id` = thing name = certificate CN. Store it as `pumps.id`. Cosmetic names like `PUMP-4G-3P-8821` become a separate display column. |
| **D-5** | Topic namespace | **Keep `devices/{dev_id}/...` as built.** It works today. Rewrite the IoT policy and rules to match rather than changing bridge code. |
| **D-1** | Shadow vs command topic | **Command topic for the pilot.** Shadow is the better long-term design and should be adopted afterwards, but it is unbuilt in the bridge and adds days. Mitigate its absence with a server-side command expiry. |
| **Certs** | Provisioning approach | **Per-device certificates at flash time.** Provisioning by claim depends on runtime NVS write (OI-30, unverified) and needs a Lambda hook, a template and testing. For 5–10 nearby units, hand-flashing is faster and strictly more secure. Build claim provisioning after the pilot. |

Write these into the SRS as decisions so the pilot doesn't quietly become the architecture by default.

---

## 3. Week 1 — device side (days 1–5)

Goal: one unit publishing over TLS to AWS IoT and accepting validated commands. **Freeze the device side on day 5.**

### Day 1 — MCU firmware
- Fix **GAP-31** in `MotorProtection.c`: replace `CONST - unsigned > 0` with `elapsed_s >= CONST` at both the overload (line 930) and imbalance (line 957) sites. Grep the file for any other instance of the pattern.
- Add **remote fault reset**: a `reset` action on `motor_cmd` clearing `activeFaultCode` and returning `STATE_FAULT` → `STATE_IDLE`. Without it, every pilot trip needs a site visit and the pilot looks worse than the product is.
- Suppress debug `printf` in the production build — measure the flash recovered (FR-DEV-088); you need that number for the OTA plan later.
- Build, verify flash usage against the 47 KB baseline.

*Deliberately not included:* under-voltage protection, `get_settings`, enumerated acks. All wanted, none pilot-blocking. Batch them into the post-pilot MCU release.

### Day 2 — bridge to AWS
- Delete `MQTT_MODE_GENERIC`, `MQTT_BROKER_DOMAIN`, `MQTT_BROKER_PORT`, `MQTT_BROKER_FALLBACK_IP`. Not `#ifdef` them out — delete them.
- Populate `MQTT_MODE_AWS_IOT` with the real `ap-south-1` endpoint and certificate paths.
- Write certificates to one module by whatever mechanism works; document the exact steps as you go — this becomes the production flashing procedure.
- Get **one unit connected end to end**. Confirm the LZMA pipeline (§5.0.35) — a raw binary flashes fine and silently does nothing.

*This is the highest-risk day.* `sAPI_MqttSslCfg` is confirmed working, which removes the main unknown, but certificate installation is untested. If it slips, it slips here — budget for that rather than assuming day 3 starts on time.

### Day 3 — bridge hardening
- Replace verbatim forwarding in `MqttRecvTask` with cJSON validation (§6.6): whitelist `cmd`, range-check `settings` keys against the §6.1 table, re-serialise from the parsed form. **Do not forward original bytes.**
- Fix **GAP-24**: cap `McuDebugPrint` below 256 bytes and compile it out; move `PeriodicReporterTask` output off the MCU UART.
- Add LWT on `devices/{dev_id}/status`.
- Remove the duplicate `reg_ack`.

### Day 4 — enrichment
- NTP sync on connect; stamp every published record with `ts`, `seq`, `tsApprox`.
- Publish diagnostics (CSQ, CGREG, operator) to `devices/{dev_id}/diag` instead of the UART.
- **If time allows:** a simple offline buffer — last N records to module flash, replayed with `buf: true`. If it doesn't fit, defer it and accept the gap for the pilot, but write it down so nobody assumes it works.

### Day 5 — device integration and freeze
- Full end-to-end test on one unit: telemetry arriving, faults arriving immediately, start/stop/reset working, reconnect after a forced network drop, behaviour across a power cut.
- **AC-01a regression:** delay the main loop artificially and confirm overload still trips.
- Tag both firmware images. **Device side is now frozen** — everything after this is cloud and UI.

---

## 4. Week 2 — cloud (days 6–10)

### Day 6 — AWS foundation
- Create Things named by MCU UID; generate and attach per-device certificates.
- IoT policy with **client-ID policy variables** (§6.7) — `iot:Connect` on `client/${iot:ClientId}`, publish/subscribe scoped to `devices/${iot:ClientId}/*`. Do not use wildcards.
- Pilot Thing group. CloudWatch alarms on connection failures and rejected publishes.

### Day 7 — ingestion, and closing SEC-1
- IoT Rule: `devices/+/telemetry` and `devices/+/faults` → Lambda → Postgres.
- **Delete or authenticate `POST /api/telemetry`.** Deleting it is cleaner — with the IoT path live it has no reason to exist.
- Reject any message whose payload `dev_id` disagrees with the connection's client ID (FR-SEC-032).

### Day 8 — schema and SEC-2
- Move seed data out of `schema.sql` into a dev-only script. Rotate the superadmin password. Replace the real phone number.
- Drop `power_factor`, `frequency` — not measured, and defaults of `0.88` / `50.0` fabricate data that will end up on a chart.
- Make `gsm_rssi`, `firmware_version` nullable with no default.
- Store fault codes as the numeric `0`–`9` key, names resolved in code.
- Add `thing_name`, `cert_id`, and a minimal `lifecycle_state`.

### Day 9 — command path
- `POST /api/pumps/:id/command` → publish to `devices/{dev_id}/commands` with `cid` and `expiry`; correlate the ack back; surface sent → delivered → applied in the API.
- Implement the **45-second cooldown** server-side (your telemetry spec §2) with `REJECTED / COOLDOWN_ACTIVE` and `remainingSec`. Server-side is enough for the pilot; the firmware interlock can follow.
- Fault alerts → FCM, reusing the existing notification service.

### Day 10 — hierarchy, minimally
- Replace `dealer1`…`dealer5` with a single `dealer` role plus `depth` computed from `hierarchy_path`; enforce `depth <= 6`.
- Fix the `POST /api/users` role list — `dealer2`, `dealer3`, `dealer4` are currently missing, so mid-tier dealers cannot create subordinates.
- For the pilot only superadmin and customer are exercised, but getting the model right now avoids a migration later.

---

## 5. Week 3 — surfaces and field (days 11–15)

### Day 11–12 — web dashboard
The React app is a skeleton (`App.tsx`, i18n, types — no screens). Build only:
- Device list with live status, scoped by `hierarchy_path`
- Device detail: per-phase V and I, run state, fault, last seen
- Start / stop / reset with the cooldown countdown
- Fault history

No trends, no config editor, no allocation UI, no templates. Those are post-pilot.

### Day 13 — Android, hardened not rebuilt
The app works and is in six languages. **Do not migrate it to the backend API now** — that is a week of work.
- Disable Cognito guest/unauthenticated access.
- Replace wildcard `pumps/*` scoping with per-identity policy variables.
- Update topics to `devices/{dev_id}/...`.
- Confirm it still connects and controls.

If day 13 overruns, **ship the pilot on the web app** — it works in a phone browser — and finish the Android app after. Decide this on day 12, not day 15.

### Day 14 — provision and install
- Flash and provision the pilot units following the day-2 procedure.
- Record serial → certificate → panel → customer for every unit. This is your inventory and you will want it later.
- Install. Verify each unit end to end on site before leaving.

### Day 15 — validate and buffer
- 24-hour soak: telemetry arriving, faults propagating, commands working, reconnection after outages.
- Deliberately trip one unit and confirm the whole chain to notification.
- **Keep this day genuinely free.** Something will need it.

---

## 6. Exit criteria

The pilot is live when all of these hold:

- [ ] All traffic TLS 1.2 with mutual auth; no plain-text path exists in the source
- [ ] No unauthenticated write path into telemetry or commands
- [ ] A device cannot publish as another device (policy variables verified by attempting it)
- [ ] Overload trips reliably with the main loop artificially delayed (AC-01a)
- [ ] A fault reaches the user's phone within 30 seconds
- [ ] Start / stop / reset work, with the cooldown enforced
- [ ] Every unit's serial, certificate and owner are recorded
- [ ] Known gaps written down — no offline buffer, no OTA, no under-voltage — so nobody assumes otherwise

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Certificate installation onto the module (day 2) | **High** | The one genuinely untested step. Start day 1 evening if possible. Fallback: bench-broker with TLS to unblock cloud work while it is resolved. |
| Android hardening overruns (day 13) | Medium | Pre-decided fallback: ship on web, finish the app after. |
| No offline buffer | Medium | Accept for pilot; sites are nearby. Do not let it become permanent. |
| MCU change introduces a regression | Low–Medium | Only two small changes; AC-01a and AC-01b cover them. Keep one unit on the old firmware as a control. |
| Scope creep from the SRS | **High** | The SRS describes the destination, not the pilot. Re-read §1 of this plan when tempted. |

---

## 8. Immediately after the pilot

In dependency order, not importance:

1. **Offline buffering** in the bridge — the pilot's most visible gap
2. **MCU batch release** — under-voltage (FR-DEV-021a), `get_settings`, enumerated acks, firmware cooldown interlock
3. **Fleet provisioning by claim** — required before volume manufacture; verify OI-30 first
4. **OTA** — module-staged (§4.6.1); every deferred MCU fix currently costs a site visit
5. **Device Shadow** (D-1) — replaces the command topic; commands survive offline devices
6. **Portal depth** — allocation, templates, config editor, trends
7. **Subscriptions** (§2.7), retention automation (§12.7), audit log, DLT registration for SMS

---

## 9. Honest assessment

The plan fits fifteen days because the hard parts are already done: the protection firmware is proven, the bridge works, TLS to AWS is confirmed, the backend and app exist. What remains for the pilot is **hardening and connecting**, not building.

The two places it will hurt: day 2 if certificate installation fights back, and day 13 if the Android app resists. Both have pre-planned fallbacks — use them early rather than working late.

What you should not do is carry the four non-negotiables into the pilot unfixed. Everything else here can be renegotiated.
