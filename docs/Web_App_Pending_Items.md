# Web App — Pending Items & Delivery Plan

**Date:** 17 August 2026
**Scope:** `web/index.html` (canonical frontend per `web/ARCHITECTURE_DECISION.md`) against SRS v7.0 §8 (FR-WEB-001…064), §7.3 lifecycle, §8.4 device detail.
**Slots into:** `Development_Plan_FINAL.md` Stream 1C (Superadmin portal, 8 wk) + 1D (Device detail & partner portal, 11 wk). This document is the item-level breakdown of those 19 weeks, minus what already exists.
**Effort units:** same basis as the parent plan — one developer, full-time, ~20 productive days/month.

> **Read §11 first.** A Material Design requirement added on 17 August supersedes the phase numbering in §2–§9 and resolves the frontend-stack question (F-1) toward React + MUI. **§11.5 carries the current phasing; the W0…W5 labels in §2–§9 are the pre-redesign sequence.** The *content* of every phase below still stands — what changed is the stack it is built on and the order, not the requirements.

---

## 1. Where the portal actually is

Source-verified against `web/index.html` (1,613 lines) and `backend/server.js` (25 routes).

**Working, real, wired to the API:**

| Capability | Evidence |
|---|---|
| Phone+OTP and password auth, refresh-token retry, logout | `handleAuthSubmit`, `apiFetch` (`web/index.html:777`) |
| Pump list scoped to the caller's node, with search | `fetchPumpsFromApi` → `GET /api/pumps` |
| Command dispatch with server-enforced 45 s cooldown + UI countdown | `togglePump`, `startCooldownDisplay` (`web/index.html:1529`) |
| Fault log read-back and acknowledge | `loadFaultLogsForSelectedPump`, `ackFaultLog` |
| Hierarchy tree from live data | `loadUserTree` → `GET /api/users/tree` |
| Device registry, commissioning modal, subordinate-account creation | `renderDeviceTable`, `submitCommission`, `submitAddUser` |
| Role-based UI gating (server re-validates) | `applyRolePrivileges`, `ASSIGNABLE_ROLES_CLIENT` |

That is five tabs and roughly six endpoints of genuine integration. It is a real base, not a mockup.

**Against SRS §8, the compliance count is 5 of 34 FR-WEB requirements.** The gap is not evenly distributed: the Common layer (§8.1) is half-done, the Superadmin (§8.2) and Partner (§8.3) sections are essentially unstarted, the 7-tab device detail (§8.4) does not exist in any form, and Alerts (§8.5) has no UI.

---

## 2. W0 — The truth pass · 1.5–2 days · do this first

**Not a feature phase. A correctness phase.** Scope is narrow and worth stating precisely, because the portal's data flow is otherwise genuinely dynamic.

**Already dynamic, API-driven, correct:** pump list, name, HP rating, supply type, status, GPS, `lifecycle_state`, `firmware_version`, the four fleet KPI counters (`meta.stats`), fault logs, the hierarchy tree, command dispatch and cooldown state.

**Not bound to anything:** the electrical measurements — per-phase voltage and current — plus two device-table columns. These are the readings the product exists to display, which is the only reason this rates a phase of its own rather than a bug ticket.

The root cause is a backend omission, not UI sloppiness. `GET /api/pumps` (`server.js:464`) selects `id, name, supply_type, hp_rating, latitude, longitude, status, lifecycle_state, firmware_version, last_seen_at` — and no telemetry columns. The grid has nothing to bind to, so the template carries literals. `GET /api/pumps/:id` *does* return latest telemetry, so the data exists in Postgres and is already exposed per-device.

The Reconciliation Report §5 flagged fabricated defaults in `schema.sql` — `power_factor 0.88`, `frequency 50.0`, `gsm_rssi 24`, `firmware_version 'v2.4.1'` — and the schema was correctly fixed (columns dropped or made nullable, no defaults). **The same fabrications now live in the UI instead**, which is worse, because they survived the fix that was supposed to remove them.

| # | Item | Location | What it shows |
|---|---|---|---|
| W0-1 | Hero gauges never written by any code | `index.html:473–515` — `arcVR/VY/VB`, `gaugeVR/VY/VB`, `valIR/IY/IB`, `barIR/IY/IB` | Permanently `418V / 422V / 415V` and `14.2A / 14.5A / 14.1A`. The *only* writes to any gauge are `index.html:1219` and `:1230`, inside the fake fault simulator, setting `gaugeVY` to `'0V'` and back to `'422V'` — also literals. |
| W0-2 | Pump card voltages are string literals | `renderPumpGrid`, `index.html:1080–1082` | `418 V / 422 V / 415 V` in the template. Not a UI bug in isolation — `p.v_ry` doesn't exist on the payload (see above). |
| W0-3 | Device table columns with no source field | `renderDeviceTable`, `index.html:1120–1122` | `5m Off / 2m On` interval and `📶 84% (-68 dBm)` signal are invented outright. `firmware_version \|\| 'v2.4.1'` is dynamic but falls back to the exact default the schema fix removed. |
| W0-4 | Client-side fault injector shipped in the operator UI | `simulateFault`, `resetFaults` (`index.html:1215`) | "⚡ Hardware Fault Testing" buttons that fake a phase-loss or dry-run state locally. A demo control in a protection product's console. |
| W0-5 | Stale identity labels | Tab 4 caption, `txtUserProfile` default | "RBAC **9-Tier** Hierarchy" — the schema is 5 roles + computed `dealer_depth ≤ 6`. Header ships a placeholder person, "Ramesh Patel (Farmer)". |

**Work**

1. **Backend (half a day):** add a `LATERAL` join onto the latest `telemetry_history` row in the `GET /api/pumps` list query, returning per-phase V/I, `gsm_rssi` and `recorded_at`. One query change; the ORDER BY/LIMIT structure already supports it.
2. **Frontend (half a day):** bind the hero gauges and card meters to those fields; render an em-dash and a "no telemetry received" state when null rather than a plausible number. Drop the interval column until reporting intervals are actually modelled, and the `'v2.4.1'` fallback.
3. Move the client-side fault simulator behind a build flag or delete it — the real one is `backend/simulator/deviceSimulator.js`, and a fake fault injector in a protection product's operator console is a support incident waiting to happen.
4. Correct the stale labels.

**Why it leads.** The next 16 weeks build charts, exports, reports and dashboards on this render layer, and Trends (W1) reads the same telemetry the gauges should already be showing. Doing the join now means the device detail view inherits a working binding instead of repeating the workaround. It is the same defect class as the schema fabrications the Reconciliation Report closed — and cheap enough at ~1 day that there is no reason to carry it further.

---

## 3. W1 — Wire what the backend already serves · 2 weeks

Four endpoints are implemented, scoped, tested and have **zero UI**. This is the cheapest compliance in the plan — no backend work, no schema change.

| Endpoint | Status | Unlocks |
|---|---|---|
| `GET /api/pumps/:id/telemetry` (`server.js:703`) — 30-day window, up to 2000 points, returns `seq`/`ts_approx`/`buffered` | Live, unused | FR-WEB-050 **Trends** tab |
| `GET` + `PUT /api/pumps/:id/config` (`server.js:793`, `:805`) — `device_config` carries `desired_json`, `reported_json`, `status` | Live, unused | FR-WEB-050 **Configuration** tab, incl. pending-vs-applied |
| `GET /api/audit-log` (`server.js:1060`) | Live, unused | FR-WEB-016 |
| `commands` table + `POST /api/pumps/:id/command` | Dispatch wired, history not | Command progress: sent → delivered → acked |

**Deliverables**

1. **Device detail shell** — routing/modal from pump card and registry row into a per-device view with the §8.4 tab frame. Three of seven tabs filled this phase.
2. **Overview tab** — promote the hero gauges here, bound to that device's latest telemetry, plus runtime and connectivity.
3. **Trends tab** — per-phase V/I and frequency over the retained window, zoom. *(CSV export lands in W2 with the shared export helper.)*
4. **Configuration tab** — setpoints grouped protection/timers/reporting, `desired_json` vs `reported_json` rendered as an explicit pending/applied/failed state. This is the single most valuable tab: it is what makes configuration state *truthful* rather than optimistic.
5. **Events tab** — reuse the working fault-log renderer, scoped to the device, with snapshot expansion.
6. **Audit log view** — filter by actor, device, action, date range.

`ts_approx` and `buffered` must be visible on the Trends and Events surfaces — the device buffers offline and replays with approximate timestamps, and a chart that hides that is lying about when things happened.

---

## 4. W2 — Common-layer compliance · 2.5 weeks

§8.1 applies to *every* view built afterwards, so it comes before the volume of views grows.

| Req | Gap | Work |
|---|---|---|
| **FR-WEB-004** | `fetchPumpsFromApi` hard-codes `page=1&limit=50`. No pagination control, no sort, no filter chips, **no CSV/XLSX export anywhere**. | Shared list component: server-side page/sort/filter + one export helper reused by every table. Backend needs matching query params. |
| **FR-WEB-005** | **No live update at all.** The only `setInterval` in the file is the cooldown countdown. Data refreshes on login and manual action. | WebSocket channel, "last updated" stamp, stale-data badge on every live surface. Backend: WS server + push on ingest. |
| **FR-WEB-003** | 9 languages in the picker, **4 dictionaries** (`en`, `hi`, `mr`, `gu`). Assamese, Bengali, Kannada, Tamil and Telugu silently fall back to English. Dictionaries cover ~16 keys; most UI strings are hard-coded English. | Externalise all strings; build the framework for the full target set **including RTL**; gate the picker on completeness. See §4.1 |
| **FR-WEB-001** | No TOTP MFA. SRS makes it **mandatory** for Superadmin and panel-manufacturer Owner. | Enrolment + challenge UI; backend TOTP secret storage and verify step. |

FR-WEB-005 is the item most likely to be underestimated. It is not a polling loop — it is a stale-state contract across every live surface, and retrofitting it after twelve more views exist costs several times what it costs now.

### 4.1 F-2 resolved — official languages of India

**Decided:** support the official languages of India — the **22 languages of the Eighth Schedule plus English, 23 locales** — with **Urdu, Kashmiri and Sindhi deferred to a later phase** (product owner, 17 Aug). **In-scope now: 20 locales, all left-to-right.**

This is what the codebase already intended. The existing picker is numbered `1. Assamese … 5. English … 7. Hindi … 14. Marathi … 21. Tamil … 22. Telugu`, which is exactly the Eighth Schedule in alphabetical order with English inserted at position 5. `web/src/i18n/index.ts` carries the same 23-language list. The target was always there; only four dictionaries were ever written.

**Separate the framework decision from the content decision.** They have very different costs and owners:

| | Framework — engineering, W2 | Content — translation, parallel track |
|---|---|---|
| What | String externalisation, locale loading, script/font coverage, **RTL layout**, completeness gating | ~600–900 reviewed strings × 23 |
| Blocks the plan? | Yes — do it once, in W2 | No — rolls in per locale, any time |
| Owner | Developer | Native speakers with domain vocabulary |

**RTL is deferred with the three locales that need it.** Urdu, Kashmiri and Sindhi are the only Eighth Schedule languages written right-to-left in standard Indian usage; deferring them defers `direction: rtl`, mirrored table alignment, mirrored progress bars and gauge sweeps, and flipped icon affordances. **W2 stays at 2.5 weeks.**

**One convention makes the eventual retrofit small, at zero cost now.** As W1–W5 write new CSS, use **logical properties** — `margin-inline-start` rather than `margin-left`, `padding-inline`, `text-align: start` rather than `left`, `inset-inline-end` rather than `right`. Browser support is universal in the targets here, the rules read the same in LTR, and there is no runtime or authoring penalty.

The difference it makes later: with logical properties, enabling RTL becomes setting `dir="rtl"` and hand-fixing the genuinely directional pieces (gauge sweep, progress-bar fill, a few icons) — a few days. Without them, it is a line-by-line rewrite of every rule added between now and then, across roughly 4–5× the CSS that exists today. **Adopt the convention in W1; skip the RTL work itself.**

**Script coverage** still needs a check in the W2 pass for the 20 in scope: **Santali (Ol Chiki)** and **Manipuri (Meitei Mayek)** need webfonts that are actually present, or those locales render as boxes on the low-end Android browsers this product targets. The other 18 are covered by common Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam font stacks.

**Ship on completeness, not on ambition.** The picker must offer only locales whose dictionaries are complete — the current bug (9 offered, 4 delivered) is the failure mode to design out, and it gets worse at 23. Gate each locale on a completeness threshold and hide the rest until they cross it.

**Sequence the content by where the channel actually sells.** Hindi, Marathi, Telugu, Kannada, Tamil and Gujarati cover the states where three-phase agricultural pumping is concentrated; those plus English should be complete first. The rest follow as the channel reaches them. A farmer reading a bad translation of a protection setpoint is worse off than one reading English — so **translation quality is a safety property here, not a polish item.** Use native speakers with electrical vocabulary; "dry run", "phase loss", "overload" and "contactor" have established regional equivalents that machine translation will not find.

**Start procurement early.** 23 locales × ~800 strings is a purchasing exercise with a lead time, in the same category as DLT registration — begin it during W2 rather than discovering it at W5.

---

## 5. W3 — Superadmin portal · 5 weeks · FR-WEB-010…018

Nine requirements, none started.

| Req | Item | Backend needed |
|---|---|---|
| FR-WEB-014 | **Fleet dashboard** — devices by lifecycle state, online/offline, active faults by type, connectivity heat map, top faulting devices, firmware distribution | Aggregate endpoints |
| FR-WEB-010 | Bulk CSV device import with validation + error report | Import endpoint, staging table |
| FR-WEB-013 | Bulk allocation by serial range / batch / CSV | `allocation_log` exists ✓; needs bulk API |
| §7.3 / FR-SEC-010 | **Lifecycle state UI** — `pumps.lifecycle_state` exists with all 8 states and is neither displayed nor editable | State-machine transition endpoint |
| FR-WEB-016 | Audit log | Done in W1 |
| FR-WEB-017 | System health — ingestion lag, error rate, provisioning failures, notification delivery | Metrics endpoints (Stream 1A observability) |
| FR-WEB-018 | Support console — raw last-N messages, connection history, diagnostic commands | Raw message endpoint |
| FR-WEB-012 | Manufacturing-partner accounts: create/edit/suspend, contract details, device quotas | **Unblocked** (D-6 decided) — CRUD on `users` at `manufacturer` role, no org entity |
| FR-WEB-011 | **Factory provisioning console** — batch creation, claim-certificate bundle generation and download, serial validation, claimed/flashed tracking | **Unblocked** (decided) — see §5.1 |
| FR-WEB-015 | Firmware release management, staged rollout, abort | **Blocked** — OTA is Stream 4 (month 14–16) |

Start with FR-WEB-014. A fleet dashboard is the first screen that makes the portal feel like a product rather than a device list, and it is buildable against `backend/simulator/deviceSimulator.js` today.

### 5.1 Factory provisioning console — FR-WEB-011

**Decided:** provisioning uses **AWS IoT fleet provisioning by claim**, performed in the **Superadmin factory**. This matches `docs/aws-iot-fleet-provisioning-architecture.md`, which already specifies the template JSON, pre-provisioning hook, scoped policy and 100-unit batch flashing flow.

This **unblocks the portal side**, which the parent plan had gated behind Stream 3. The split matters:

| Portal side — buildable in W3 | Device side — Stream 3 (month 12–14) |
|---|---|
| Create a manufacturing batch (model, hwRev, quantity, date) | Bridge presents the claim cert on first boot |
| Generate and download the claim-credential bundle for factory flashing | Exchanges it for a permanent per-device cert |
| Register the expected serial list; validate at claim time via the pre-provisioning hook | Stores the permanent cert (**OI-30** — verify runtime NVS write) |
| Track per-unit state: `MANUFACTURED` → flashed → claimed → `ALLOCATED` | Reports back on first connect |
| Revoke a batch; re-issue claim credentials | — |

Because the factory is Superadmin-operated, this console is single-tenant and needs no partner-facing surface — a meaningful simplification. It does, however, harden the **D-4 dependency**: the claim exchange writes the device identity that becomes thing name and certificate CN, so `dev_id` must be settled before the first batch is flashed, not before the first batch is *sold*. The parent plan already places D-4 in Sprint 0; this makes it load-bearing for W3 rather than only for Stream 3.

### 5.2 Claim gating — IMEI whitelist

**Decided:** only whitelisted IMEIs may claim a certificate. The whitelist is uploaded as CSV/Excel and checked by the pre-provisioning hook.

Convenient consequence: **this is the same feature as FR-WEB-010.** Batch inventory upload and claim whitelist are one CSV/XLSX import pipeline with one validation and error-report path, not two. Build it once. (Excel needs a parser dependency; CSV alone does not — worth deciding whether `.xlsx` is required, or whether "save as CSV" is acceptable for a factory-operator workflow.)

Two properties of this design need recording, because both have consequences elsewhere in the plan.

**An IMEI is not a secret, so the whitelist is inventory control — not authentication.** IMEIs are printed on labels, sequential within a purchase batch, and readable over AT. The whitelist stops a leaked claim certificate from provisioning *arbitrary* devices, which is exactly what it is for. It does not stop it provisioning *a whitelisted IMEI that hasn't been claimed yet*. The control that closes that is **single-use claim**: the hook rejects any identity already holding an active certificate, and the console shows claimed/unclaimed per unit. That state tracking is already in §5.1's per-unit table — it just needs to be understood as a security control, not a progress indicator.

**IMEI is the modem's identity; D-4 makes the MCU's 96-bit UID the thing name and certificate CN.** Different numbers on different chips. §5.2.1 resolves how they relate — and concludes D-4 should change.

### 5.2.1 D-4 must be overturned — identity should be the IMEI, not the MCU UID

**Field reality (product owner, 17 Aug):** MCU boards are replaced frequently in service; 4G bridge PCBs are replaced rarely.

That single fact inverts D-4, and the code shows the concern is not theoretical. The identity chain is live today:

| Step | Source |
|---|---|
| M031 reads its own die UID | `firmware/IoT_Comm.c:186` — `FMC_ReadUID(0..2)` |
| …and announces it as `dev_id` | `IoT_Comm.c:205` — `{"cmd":"reg","dev_id":"<MCU UID>","fw":"…"}` |
| Bridge adopts whatever the MCU said | `mqtt_bridge.c:262` — `Json_GetStr(json, "dev_id", g_device_id, …)` |
| …uses it as the **MQTT client ID** | `mqtt_bridge.c:191` — `sAPI_MqttAccq(…, g_device_id, …)` |
| …and builds **all three topics** from it | `mqtt_bridge.c:263–265` |

The MCU dictates the identity; the bridge follows. Meanwhile **the certificate lives on the modem** (`C:/clientcert.pem`, §5.3). The design therefore puts the **identity on the board that changes most often and the credential on the board that changes least** — exactly backwards for the observed service pattern.

**What a routine MCU swap does today:** new die UID → new `dev_id` → new client ID and new topic namespace, while the certificate CN on the untouched modem stays as it was. Under the standard fleet-provisioning policy — client ID = thing name = CN — the device is refused at connect or denied on publish. **A routine board replacement makes the unit go dark**, and the cloud sees an unknown device holding no certificate of its own. The frequent case is the broken one.

**Recommendation: `dev_id` = IMEI.** Three reinforcing reasons:

1. **It is the stable board**, per the service data above.
2. **Identity and credential land on the same board.** A swap then changes both or neither — the mismatch state that breaks connections becomes unrepresentable rather than merely unlikely.
3. **The bridge becomes self-sufficient.** It knows its own IMEI without asking the MCU, so it can connect, subscribe and report before — or without — MCU registration. Today `g_device_id` defaults to `"unknown"` (`mqtt_bridge.c:30`) and no connection is established until the MCU registers, so **a unit with a dead MCU vanishes from the cloud entirely** instead of reporting "modem alive, MCU not responding." That diagnostic feeds the support console (W3) and the Diagnostics tab (W4).

**The MCU UID keeps a job — just not this one.** Carry it as a *reported attribute* with swap history, so the portal shows which board is currently fitted and how many times it has been changed. Warranty and RMA traceability, without identity coupled to it.

**This also simplifies the whitelist and the factory rig.** Gate the claim on **IMEI alone**, readable over AT at the flashing station; record the MCU UID as an attribute at first registration. **The pair-validation recommendation from the previous draft is withdrawn** — its security benefit was modest, and keeping pair accuracy correct across a fleet whose MCUs are routinely swapped is a maintenance burden with no payoff. Single-use claim remains the real anti-replay control. The factory rig no longer needs to talk to the M031 at all.

**Consequences to carry forward**

| Area | Consequence |
|---|---|
| **Contract freeze** | D-4 is item 1 of the parent plan's §4 freeze. This changes it and touches firmware, bridge, backend and portal — make the change **now**, before W3 and before any certificate is issued. |
| **W1 Configuration tab** | A replacement MCU arrives with blank EEPROM, so the cloud's `desired_json` becomes the **field recovery mechanism** after every board swap, not merely a monitoring view. This moves W1's Configuration tab from useful to operationally required. |
| **FR-WEB-037 (W4)** | Runtime hours accumulated in MCU EEPROM reset on swap. Service reports need cloud-side accumulation or they under-report after every replacement. |
| **FR-WEB-034 (W4)** | Two distinct swap types: **MCU swap** = component change, identity preserved, config re-pushed (frequent, cheap). **Bridge PCB swap** = identity change needing history migration (rare, expensive). The expensive path is now attached to the rare event. |
| **Ownership / Diagnostics tabs** | Add fitted-component history (MCU UID over time) alongside allocation history. |

### 5.3 OI-30 — the one unverified assumption

**Status: well-founded expectation, not a verified fact.** The claim flow rests on the module writing a certificate at runtime and using it after reboot.

Evidence in favour, from this repo:

- SRS §5.0.3 records `CONFIG_HAS_DEMO_FS=y`, `CONFIG_HAS_DEMO_FLASH=y`, `CONFIG_HAS_DEMO_EXFLASHMOUNTFS=y` — a writable filesystem exists.
- The bridge loads certificates **by filesystem path**, not compiled in: `AWS_CLIENT_CERT_PATH "C:/clientcert.pem"` (`app_config.h:24–26`), consumed via `sAPI_SslSetContextIdMsg` (`mqtt_bridge.c:133–135`). Something already writes those files.

What that does *not* establish is the specific thing the flow needs: that **the running application** can write them — rather than a factory tool over USB before the app ever starts — and that the SSL context picks up a certificate replaced at runtime. The SDK's `sAPI_*` headers are not checked into this repo, so it cannot be settled by reading source here.

**Test — half a day, no portal dependency, runnable now:** from the bridge app, write a file to `C:/`, reboot, read it back; then write a *different* valid client certificate, point the SSL context at it, and complete a TLS connection to AWS IoT. That sequence is the entire assumption.

**If it fails,** the fallback is per-device certificates generated in the portal and flashed individually at the factory — a worse manufacturing flow, but not a blocked one. It **changes what the W3 console builds**: per-device certificate generation and tracking instead of per-batch claim bundles. Which is exactly why it wants answering before W3 starts rather than during it. There are roughly ten weeks of runway.

---

## 6. W4 — Device detail completion + partner portal · 5 weeks

**Remaining §8.4 tabs (1.5 wk):** Schedule (cyclic ON/OFF/cycle-limit editor with duty-cycle preview — must not imply clock-time scheduling, the device has no RTC), Ownership (current owner, allocation history from `allocation_log`, site/customer, warranty), Diagnostics (firmware/hardware versions, signal history, raw messages, OTA history).

**Partner portal (3.5 wk) — FR-WEB-030…037:**

| Req | Item | Blocker |
|---|---|---|
| FR-WEB-030 | Stock view + allocate to child nodes, depth ≤ 6 enforced | — |
| FR-WEB-033 | Sub-tree dashboard: states, faults today, offline, runtime, expiring warranty/subscription | Subscription tables absent |
| FR-WEB-037 | Service reports — fault frequency, MTBF, runtime, uptime | Daily rollup job (1B) |
| FR-WEB-031 | Panel binding — panel serial, motor rating, starter type, pump make/model, HP | **Panel record table absent** |
| FR-WEB-032 | Configuration templates, apply to many | **Templates table absent** |
| FR-WEB-034 | RMA + warranty, replacement swap preserving site history | **RMA tables absent** |
| FR-WEB-035 | User management + child-org invite links | Partial — add-user modal exists; invites absent |

Four of seven need schema that does not exist yet. Sequence 030/033/037/035 first; 031/032/034 follow their tables.

---

## 7. W5 — Alerts & branding · 2.5 weeks · FR-WEB-060…064, 036

**Alerts (FR-WEB-060…064) are blocked on the Stream 1B alert engine** and notification service — dedup windows, storm digests and delivery status are server concerns, and the UI is a thin layer over them. Build after 1B, not before.

Portal side: per-device and per-group alert subscription, channel selection (in-app/push/email/SMS, SMS restricted to critical), acknowledge/assign/resolve-notes workflow, localisable templates.

**White-labelling (FR-WEB-036) is unblocked** by the D-6 decision and is now a small item — see §8.1. Notification sender name is the one part that stays coupled to 1B, since it is applied at send time by the notification service, not by the portal.

---

## 8. Decisions this plan needs

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| **D-6** | Organisation entity vs. users-carry-hierarchy | FR-WEB-012, 035, 036 | **Decided** — no organisation entity. Branding attaches to the manufacturer node. See §8.1 |
| **D-4** | Device identity = MCU UID | Everything downstream of the contract freeze | **Change recommended — `dev_id` = IMEI.** The MCU is the frequently-replaced board and the certificate lives on the modem. §5.2.1 |
| **C-1** | Claim gating by whitelisted IMEI, CSV/Excel upload | FR-WEB-010/011 | **Decided.** Same import pipeline as batch inventory — see §5.2 |
| **C-2** | How IMEI binds to the MCU UID | Pre-provisioning hook, FR-WEB-034 | **Resolved by §5.2.1** — no binding needed. Whitelist on IMEI; MCU UID becomes a tracked attribute. Factory rig needs only the modem. |
| **OI-30** | Runtime certificate write on the module | Shape of the W3 factory console | **Assumed true, untested.** Half-day bench test, runnable now. §5.3 |
| **F-1** | Stay on `index.html`, or port to the dormant `web/src/` React scaffold | Everything after W1 | See §8.2 |
| **F-2** | How many locales | W2 | **Decided — 20 now** (Eighth Schedule + English, less Urdu/Kashmiri/Sindhi); RTL deferred with them. §4.1 |
| **P-1** | Do partners need multiple staff logins? | FR-WEB-035 invites | **Decided — yes, one login per employee.** Shared node via nullable `org_node_id`. §8.1.2 |

### 8.1 D-6 resolved — branding without an organisation entity

**Decided:** the portal serves **multiple manufacturing partners**, each branded with **their own customer logo**.

This does *not* require the organisation entity the reconciliation report proposed. Branding can attach to the partner's node in the existing `users` tree and resolve by walking up `hierarchy_path` — the same materialised-path mechanism already used for device scoping, and already indexed with `text_pattern_ops`.

**Implementation:** a `branding` table keyed by `user_id` (logo URL, primary colour, notification sender name, optional subdomain), applicable at `manufacturer` role. At login, resolve the caller's branding by finding the nearest ancestor in `hierarchy_path` that has a row, and apply it as CSS custom properties — the theme system in `changeTheme` already drives everything through CSS variables, so per-partner colour is close to free once the lookup exists.

**What this buys:** FR-WEB-012 becomes ordinary CRUD on `users` at `manufacturer` role plus contract/quota columns. FR-WEB-036 becomes a settings form and a resolver. Both drop out of "blocked" into roughly a week of combined work in W3/W5. No migration of the tenancy model, and the strict hierarchy scoping already enforced server-side continues to be the single authorisation mechanism.

### 8.1.1 P-1 explained — can one partner have several staff logins?

**The mechanism today.** Every user is a node in a tree and carries a `hierarchy_path`. Device visibility is one predicate:

```sql
WHERE hierarchy_path LIKE $1 || '%'      -- server.js:465
```

A user sees exactly the devices at or below their own node. Clean, fast, and already enforced server-side. But it hard-wires **one login = one node = one device pool.** There is no concept of a *company* distinct from a *login*.

**Why that becomes a problem.** You've said the portal serves multiple manufacturing partners. Partners are companies, and companies have staff — an owner, a service manager, a storekeeper. Today that leaves two options, both bad:

| Option | What breaks |
|---|---|
| **One shared login** for the whole company | The audit log (FR-WEB-016) records "the company", not a person — so it cannot answer who dispatched a command or changed a setpoint. An employee leaving means changing the password for everyone. No per-person permissions. |
| **One login per employee**, each its own node | Each employee gets a *separate subtree*. Devices allocated to the owner are invisible to the service manager. The company's stock fragments across whoever happened to receive it, and no one sees the whole. |

The second is the one that looks reasonable and quietly fails: it works at demo scale with one person per partner, then breaks the first time a partner hires.

**Decided (product owner, 17 Aug): yes — partners have multiple staff, one login per employee.**

**This is the residue of D-6.** A full organisation entity would have solved branding *and* multi-user partners. We correctly declined the entity for branding, since `hierarchy_path` already resolves that. P-1 is the one piece the entity would also have covered — and a nullable column gets most of the value for a small fraction of the cost.

### 8.1.2 P-1 implementation — one login per employee, shared device pool

Several logins share one hierarchy node. Each employee authenticates as themselves; the company's devices resolve against the shared node.

**The schema is already permissive.** `hierarchy_path` carries **no UNIQUE constraint** — only `idx_users_hierarchy_path (hierarchy_path text_pattern_ops)`. Rows can share a path today, so there is nothing to drop or migrate.

**Add:**

| Column | Purpose |
|---|---|
| `org_node_id UUID` (nullable, self-ref) | Which node this login belongs to. Null = the login *is* its own node, i.e. today's behaviour |
| `org_role` (`owner` / `staff` / `readonly`) | Who inside the company may invite, allocate and manage users |

**The scoping predicate does not change** — `WHERE hierarchy_path LIKE $1 || '%'` keeps working unmodified, which is the main reason this is cheap.

**Three implementation details that will bite if missed:**

1. **A staff login must inherit the node's path verbatim, not extend it.** `POST /api/users` currently builds `newPath = ${parentPath}/${newId}` (`server.js:1003`). Applied to a staff member, that gives them their own empty subtree and they would see **zero devices** — a silent, confusing failure rather than an error. Staff take the org node's path unchanged.
2. **`dealer_depth` is inherited, not incremented.** A staff member is not another rung; incrementing would consume the 6-level budget (FR-SEC-000a) with people instead of dealers.
3. **`POST /api/users` needs a distinct staff mode.** Adding a colleague means creating a user with the *same role at the same node*, which `canAssignRole` correctly rejects as a subordinate creation — `manufacturer` cannot assign `manufacturer`. Add an explicit `membership: 'staff' | 'subordinate'` discriminator, with staff creation gated on `org_role = 'owner'` rather than on the subordinate role table.

**Two things come free.** The audit log already records `actorId` per row (`writeAudit`), so per-person accountability works the moment logins are per-person — no change. And `refresh_tokens` is already keyed by `user_id`, so revoking one departing employee leaves colleagues signed in.

**One UI consequence:** `GET /api/users/tree` will return N users at the same path. The tree renderer must group them as members of one node rather than draw N identical siblings.

**Estimate holds: 2–3 days in W3**, plus the invite flow in FR-WEB-035 (W4), which now invites *a person into an existing company* — a materially simpler screen than inviting a company.

### 8.2 F-1 — resolved by the design requirement

**Decided 17 Aug (product owner):** the current UI is not acceptable. The requirement is a **modern, polished, responsive interface in strict compliance with Material Design guidelines.** That re-prices F-1 and settles it — see §11.

`ARCHITECTURE_DECISION.md` chose `index.html` because it held the working auth and API integration, and finishing two half-built frontends is worse than finishing one. That reasoning was sound while the presentation layer was being *kept*. A strict Material Design rebuild rewrites the presentation layer regardless of stack — so the thing that argued for `index.html` is the thing being replaced.

**What survives the rebuild is the API contract knowledge, not the markup**: the auth flow, `apiFetch` with refresh-token retry, command dispatch with cooldown handling, the fault-log and hierarchy-tree renderers. Those are ported as logic, and they port equally well into either stack.

**Decision: move to the `web/src/` Vite/React/TypeScript scaffold with MUI.** Reasoning in §11.2.

---

## 9. Summary

> **Superseded by §11.5.** The table below is the pre-redesign sequence, kept for the per-phase content. Current phasing and totals are in §11.5 (~20.25 weeks).

| Phase | Weeks | Delivers |
|---|---|---|
| **W0** | 0.5 | Phase V/I bound to real telemetry; no invented measurements |
| **W1** | 2 | Device detail shell + Overview/Trends/Config/Events, audit log |
| **W2** | 2.5 | FR-WEB-001/003/004/005 — the common layer |
| **W3** | 5 | Superadmin: fleet dashboard, inventory, allocation, lifecycle, health, support, **factory provisioning console**, multi-staff partner accounts |
| **W4** | 5 | §8.4 complete; partner portal |
| **W5** | 2.5 | Alerts, white-labelling |
| **Total** | **~17.5 weeks** | 34 of 34 FR-WEB, less the 2 gated on other streams |

Consistent with the 19 weeks the parent plan allocates to 1C+1D — the difference is roughly what already exists.

**Two items remain gated and cannot be pulled forward at any effort:** FR-WEB-015 (firmware releases — needs Stream 4 OTA) and FR-WEB-060…064 (alerts — needs the 1B alert engine). FR-WEB-011 moved out of this list: the factory console is portal-side work that runs ahead of the bridge's claim client.

Everything else is buildable against `backend/simulator/deviceSimulator.js` without waiting for hardware.

**The critical path inside the portal is now D-4 → W3.** With provisioning decided as claim-certificate in the Superadmin factory, device identity stops being a Stream 3 concern and becomes a prerequisite for the first flashed batch — every certificate CN issued before it is settled is a certificate that has to be reissued.

---

## 10. Is this plan finalised?

**Finalised enough to start, not finalised throughout.** The distinction matters because it tells you what to do this week versus what to answer by week five.

**W0, W1 and W2 — the first ~5 weeks — are fully unblocked.** Nothing in the truth pass, the device-detail shell, Trends/Config/Events, the audit view, or the common layer (pagination, export, WebSocket, i18n, MFA) depends on any open question. That work can start immediately.

**Every product decision is now closed.** D-6, C-1, C-2, F-2 and P-1 are all decided; D-4 has a recommendation awaiting sign-off. What remains is one hardware fact, one sign-off, and one procurement:

| Item | Needed by | Cost to close |
|---|---|---|
| **D-4 revision** — `dev_id` = IMEI (§5.2.1) | **Now** — it is a contract-freeze change | Sign-off, then ~2 days across firmware/bridge/backend |
| **OI-30** bench test — runtime cert write + reboot + TLS connect | Before W3 | Half a day, no dependencies |
| **Translation procurement** — 20 locales × ~800 strings, native speakers with electrical vocabulary | Start during W2 | Purchasing lead time, like DLT — not developer weeks |

**One item is a scheduled gate rather than an open question:** F-1, the `index.html` vs React call, is deliberately deferred to the W1/W2 boundary — that is when the shared list component, export helper and WebSocket state layer get built, and it is the last cheap moment to switch.

**Two requirements stay genuinely gated on other streams** and no amount of portal effort moves them: FR-WEB-015 (firmware release management, needs Stream 4 OTA) and FR-WEB-060…064 (alerts, needs the 1B alert engine).

**The one item that is now urgent rather than merely scheduled is the D-4 revision.** It is a contract-freeze change (§5.2.1), it touches four layers, and its cost grows the moment certificates start being issued — every CN written under the old scheme is a reissue. It is also the rare kind of change that makes the system simpler: the bridge stops depending on the MCU to learn its own name, and the frequent service event stops breaking connectivity.

**The one item I would not let drift is OI-30.** Everything else on this list is a decision you can make from the desk; that one is a fact about hardware that is currently an expectation. It is half a day to convert into a fact, it can be done in parallel with W0, and it is the only open item that changes what gets *built* rather than merely what it is called — per-batch claim bundles and per-device certificate generation are different consoles. Test it early and the plan is stable; leave it and W3 carries a fork in it.

---

## 11. Design system — Material Design compliance

**Requirement added 17 August 2026 (product owner):** modern, polished, responsive, **strict compliance with Material Design guidelines**. This is a new requirement — SRS §8 specifies behaviour, not visual language, so it should be recorded as an amendment (FR-WEB-006, proposed).

### 11.1 What "strict compliance" actually commits to

Material Design 3 is a specification, not a look. Strict compliance means adopting all of it:

| Layer | What it requires |
|---|---|
| **Color** | The full role system — `primary` / `on-primary` / `primary-container`, `surface` at five elevation tints, `outline`, `error` roles — generated as tonal palettes from a seed colour, in light and dark |
| **Typography** | The type scale — display/headline/title/body/label × large/medium/small — applied consistently, not ad-hoc font sizes |
| **Shape** | The corner scale (none → extra-large → full) applied per component class |
| **Elevation & state** | Levels 0–5, plus state layers at the specified opacities for hover, focus, pressed and dragged |
| **Components** | Buttons (filled/tonal/outlined/text/elevated/FAB), cards, chips, dialogs, text fields with the specified label and error behaviour, navigation rail / bar / drawer, snackbars, top app bar, data tables, switches, sliders |
| **Motion** | Emphasised and standard easing curves with the specified duration tokens |
| **Layout** | Window size classes — compact / medium / expanded / large / extra-large — with the navigation pattern changing across them |
| **Accessibility** | 4.5:1 contrast minimum, 48 dp touch targets, visible focus indicators |

**Three things in the current UI do not survive this**, and they should be named now rather than discovered mid-build:

1. **The three custom themes** — "Sapphire Dark", "Agro Clean Light", "Cyber Neon". MD3 defines light and dark from one seed; a third decorative theme is outside the system. Cyber Neon in particular cannot meet the contrast requirements.
2. **The emoji-as-iconography** throughout (⚡ 🗺️ 📱 👥 🚨 📶 ✏️ 🗑️). Emoji render differently per platform, carry no semantic role and are not accessible-labelled. MD3 expects Material Symbols.
3. **The custom SVG gauges and progress bars.** These can stay conceptually — a radial voltage gauge is a legitimate data display — but they need re-drawing against the colour roles, elevation and motion tokens rather than the current hard-coded palette.

### 11.2 Why this settles F-1 toward React + MUI

Strict compliance across ~30 views is a component-library problem, not a stylesheet problem. State layers, ripples, floating-label text fields with error states, an adaptive navigation rail and MD3 data tables are each substantial to hand-build and much harder to keep *strictly* correct as thirty views accrete.

| Option | Assessment |
|---|---|
| **React + MUI** (recommended) | The most complete and best-maintained Material implementation. The `web/src/` Vite/TS scaffold already exists. `DataGrid` delivers FR-WEB-004's pagination/sort/filter/export directly. `ThemeProvider` makes per-partner white-labelling (FR-WEB-036) a theme object rather than a CSS-variable scheme. |
| **Material Web components** (`@material/web`) on `index.html` | Preserves the current file. But Google moved this library to maintenance mode, its component coverage is narrower than MUI's, and there is no data-grid. **Verify its current status before considering it** — a 20-month project should not adopt a paused library. |
| **Hand-rolled MD3 tokens + components** | Deliverable for the tokens, not realistic for *strict* component compliance across thirty views. |

**Two requirements get materially cheaper under MUI**, which offsets the port:

- **FR-WEB-004** — the shared list component with pagination, sort, filter and CSV/XLSX export was budgeted in the common layer. `DataGrid` provides it.
- **FR-WEB-036** — per-partner white-labelling was going to be CSS custom properties. Under MD3 it becomes the idiomatic case: **the partner's logo yields a seed colour, and MD3 dynamic colour generates the full tonal palette from it.** Branding-by-seed is exactly what the system is designed for.

### 11.3 This is not only aesthetics

The product's users are farmers on low-end Android devices, often outdoors. MD3's 48 dp touch targets, 4.5:1 contrast floor and mobile-first window size classes serve that context directly — and the current interface is a dense desktop layout with 10–11 px type and emoji affordances. Responsive compliance is a usability requirement for this audience before it is a visual one.

It also compounds with the i18n work (§4.1): a token-driven type scale absorbs the wildly different text metrics of Devanagari, Tamil, Ol Chiki and Meitei Mayek far better than fixed pixel sizes will.

### 11.4 Cost and placement — do it before the views multiply

| Work | Weeks |
|---|---|
| MD3 theme: colour roles from seed, typography scale, shape, elevation, motion tokens; light + dark; per-partner seed hook | 1 |
| Port the working integration into React/MUI — auth, `apiFetch` with refresh retry, pump list, command dispatch + cooldown, fault logs, hierarchy tree, device registry, modals | 2 |
| Responsive shell — navigation rail / drawer / bottom bar across the window size classes | 0.5 |
| Accessibility pass — contrast, touch targets, focus order, screen-reader labels, Material Symbols replacing emoji | 0.5 |
| | **4** |

**Net addition is ~3 weeks**, since roughly a week of this displaces work already budgeted elsewhere (the shared list component in the common layer, white-labelling in W5).

**Placement is the whole game.** This must run *immediately after W0 and before the device detail view*, because every view built beforehand is a view rebuilt afterwards. Done at this point, ~5 views are ported. Done after W4, it is ~30 — including two dashboards, a seven-tab device detail and two consoles.

**W0's frontend half is dropped** as a result: binding the hero gauges in `index.html` would be immediately discarded. W0 keeps only its backend half — the `LATERAL` join on `GET /api/pumps`, which is stack-independent and needed regardless — plus deleting the client-side fault injector. Real telemetry binding then happens once, correctly, in the React build.

### 11.5 Revised phasing

| Phase | Weeks | Delivers |
|---|---|---|
| **W0** | 0.25 | Backend `LATERAL` join for per-phase V/I; delete the client-side fault injector |
| **W1** | 4 | **Design system + port** — MD3 theme, React/MUI, responsive shell, accessibility, feature parity with today plus real telemetry binding |
| **W2** | 2 | Device detail shell + Overview/Trends/Configuration/Events; audit log |
| **W3** | 2 | Common layer — WebSocket + stale indicator, i18n framework, TOTP MFA (list/export now largely from `DataGrid`) |
| **W4** | 5 | Superadmin: fleet dashboard, CSV import, allocation, lifecycle, health, support console, factory provisioning console, multi-staff partner accounts |
| **W5** | 5 | §8.4 complete; partner portal |
| **W6** | 2 | Alerts; white-labelling (now a theme seed) |
| **Total** | **~20.25** | Was ~17.5 |

The **+3 weeks buys more than appearance**: a component model for the thirty views still to come, a test seam that does not exist today, `DataGrid` covering FR-WEB-004, theme-based white-labelling, and an accessibility baseline that the current UI does not meet.
