# Development Plan — FINAL

**Project:** IoT Agri Pump Control and Monitoring
**Basis:** SRS v7.0 · one developer, full-time, ~20 productive days/month
**Priority order (set by product owner):** 1. Web portal · 2. Android app · 3. MQTT bridge · 4. M031 firmware
**Supersedes:** `SRS_Compliance_Roadmap.md` (phase ordering) and `Development_Plan_15_Day_Pilot.md` (absorbed as Sprint 0–1)
**Last revised:** 17 August 2026 — D-4 revised (§4.1); D-6 / P-1 / C-0 / C-1 / C-2 / F-2 / F-1 decided and F-3 added (§12); Stream 1A+1B rescoped against the code as-built (`Backend_Pending_Items.md`); Stream 1C+1D replaced by the item-level breakdown in `Web_App_Pending_Items.md`

---

## 1. What this ordering means

Your priority is top-of-stack down. That is a defensible choice, and for one specific reason it is the *right* one: **the backend and portal are 37 of the 89 person-weeks.** They are the critical path. Starting the longest pole first is correct scheduling, and the firmware and bridge already work well enough that they are not the constraint.

Two consequences follow, and the plan is built around them.

**The portal cannot be built against nothing.** Priority 1 is really *backend + portal* — the frontend is meaningless without the API beneath it. And both need device data to develop against. Since real devices arrive late in your ordering, **a device simulator becomes a load-bearing part of the plan**, not a nicety (§3).

**Four items cannot wait behind the portal.** GAP-31 is a live protection defect on 300+ units in service. SEC-1 is an unauthenticated write endpoint. SEC-2 is committed credentials. The bridge runs plain-text to a public broker. None of these are features to be scheduled — they are defects to be closed, and they sit in Sprint 0 regardless of priority order.

---

## 2. Sprint 0 — safety floor · weeks 1–2

Not negotiable, not reorderable. Two weeks, then the priority order takes over.

| # | Item | Effort | Why it cannot wait |
|---|---|---|---|
| 1 | **GAP-31** — overload and imbalance wraparound (`MotorProtection.c:930`, `:957`) | 0.5 day | Motor-burnout protection fires only if a loop iteration lands on the exact timeout second. Live on 300+ units. |
| 2 | **SEC-1** — authenticate or delete `POST /api/telemetry` | 0.5 day | Anyone reachable can set any pump's status and inject history |
| 3 | **SEC-2** — remove seeded credentials, rotate superadmin password, replace the real phone number | 0.5 day | Working admin password sits in git with the password in a comment |
| 4 | **Bridge minimum** — delete generic/public-broker mode, enable AWS mode with TLS, add cJSON command validation, cap `McuDebugPrint` (GAP-24) | 4 days | Unvalidated payloads forwarded verbatim to a motor controller over an unauthenticated public broker |
| 5 | **Device simulator** (§3) | 2 days | Unblocks all of priorities 1 and 2 |
| 6 | **Contract freeze** (§4) | 1 day | Everything built afterwards depends on it |

**Exit:** no live security exposure, no known protection defect, and the portal work can start immediately.

### 2.1 Sprint 0 status — 17 August 2026

| # | Item | Status |
|---|---|---|
| 2 | SEC-1 | **Closed.** `POST /api/telemetry` now runs behind `authenticateDevice((req) => req.body && req.body.pump_id)` (`server.js:846`). Device-authenticated command-poll, ack and config-report endpoints were added alongside it. |
| 3 | SEC-2 | **Closed.** `schema.sql` seeds a placeholder number and `password_hash NULL`; `setup-db.js` generates a random superadmin password at deploy and prints it once. The v1 `admin123` hash and the real mobile number are gone from the seed — **but they remain in git history**, so rotation is still required if that seed ever reached a reachable database. |
| 5 | Device simulator | **Exists** — `backend/simulator/deviceSimulator.js`. Confirm it covers the adversarial cases in §3 (offline mid-command, out-of-order buffered replay, reconnect with time jump, trip while a command is in flight), not only the happy path. |
| 1 | GAP-31 | **Not verified in this pass.** `MotorProtection.c:930/:957` have been edited since the finding was written; confirm against a bench test rather than by reading. |
| 4 | Bridge minimum | **Not verified in this pass.** |
| 6 | Contract freeze | **Reopened by the D-4 revision** (§4.1) — re-freeze item 1 before any certificate is issued. |

Schema work has also run well ahead of what §5's 1A table assumes: `lifecycle_state`, `allocation_log`, `audit_log` (with an append-only `DO INSTEAD NOTHING` delete rule), `device_config`, `commands`, `fault_code_catalog`, `refresh_tokens` and the single `dealer` role with computed `dealer_depth ≤ 6` all exist. Re-scope 1A against the schema as-built before planning its 10 weeks.

---

## 3. The device simulator — the enabler for this ordering

Because real devices arrive in month 12+ under your priority order, the simulator is what makes portal-first viable. Two days of work that removes a twelve-month dependency.

**Requirements:**

- Publishes to `devices/{dev_id}/telemetry` and `/faults` using the **exact** payload schema of SRS §6.3, including `ts`, `seq`, `tsApprox`, `buf`
- Subscribes to `devices/{dev_id}/commands` and responds with realistic acks and state transitions
- Models the real 8-state machine (§4.7) and all 10 fault codes (§6.2)
- Simulates the conditions that break naive UIs: going offline mid-command, replaying buffered records out of order, reconnecting with a time jump, tripping while a command is in flight
- Runs N instances so the portal can be developed and load-tested against hundreds of devices

**Rule: the simulator implements the contract, never the other way round.** If the simulator and firmware ever disagree, the firmware is right and the simulator is a bug. Enforce this by keeping the payload schema in one place and generating both sides from it where practical.

---

## 4. Contract freeze — day 10

Before writing portal code, freeze the interfaces. Under this ordering, integration happens *last*, which is the ordering's main weakness — a frozen contract is what keeps that from becoming a big-bang integration failure.

Freeze and version-control:

1. **Device identity** — `dev_id` = **modem IMEI** = thing name = certificate CN (Decision D-4, **revised 17 Aug** — see below)
2. **Topic namespace** — `devices/{dev_id}/{telemetry,faults,status,diag,commands}` (D-5)
3. **Telemetry and event payload schemas** — SRS §6.3
4. **Command vocabulary and validation rules** — SRS §6.6
5. **Configuration schema** — the layer-A key table, SRS §6.1
6. **Fault codes** — numeric 0–10, SRS §6.2, one source of truth across all five layers
7. **Control mechanism** — command topic for now; Device Shadow migration scheduled in Stream 3 (D-1)

Any later change to these is a cross-stream change and should be treated as such.

### 4.1 D-4 revised — identity is the IMEI, not the MCU UID

**Changed 17 August 2026.** The original freeze named the M031's 96-bit die UID as `dev_id`. Field data from the product owner reverses it: **MCU boards are replaced frequently in service; 4G bridge PCBs rarely.**

The chain is live in code — `firmware/IoT_Comm.c:186` reads `FMC_ReadUID(0..2)`, announces it at `IoT_Comm.c:205`, and the bridge adopts it as both MQTT client ID (`mqtt_bridge.c:191`) and topic root (`:263–265`). Meanwhile the **certificate lives on the modem** (`C:/clientcert.pem`). That puts identity on the board that changes most and the credential on the board that changes least, so a routine MCU swap yields a new client ID and topic namespace against an unchanged certificate CN — the device is refused at connect or denied on publish. **The most common service action silently kills connectivity.**

With `dev_id` = IMEI, identity and credential sit on the same board (a swap changes both or neither), and the bridge no longer needs the MCU to learn its own name — so a unit with a dead MCU still reports in rather than vanishing. The MCU UID is retained as a *reported attribute* with swap history, for warranty and RMA traceability.

**Cross-stream cost: ~2 days** across firmware (`IoT_Comm.c` registration), bridge (derive `g_device_id` from IMEI, not the MCU `reg` message), backend (`pumps.id`) and portal. **Do it before any certificate is issued** — every CN written under the old scheme is a reissue.

Full argument: `Web_App_Pending_Items.md` §5.2.1.

---

## 5. Stream 1 — Backend + Web portal · months 1–9 · 37 weeks

The largest block and your stated first priority.

### 1A + 1B — Backend · 18 weeks scoped → **~11 weeks remaining**

**Rescoped 17 Aug against the code as-built — see `Backend_Pending_Items.md`.** The original tables assumed a greenfield backend; roughly **7 weeks are already banked**, almost all of it in the schema, which now carries lifecycle states, allocation history, an append-only audit log, desired/reported configuration, the commands table, the numeric fault-code catalog with a v1 migration, refresh tokens, and the single `dealer` role with computed depth.

| Item | Scoped | Remaining |
|---|---|---|
| Schema completion (partitioning + certificate/batch identity; feature tables ride with their features) | 2 | 0.5 |
| Tenancy and RBAC — **the mandatory tenant predicate is the one real gap** | 3 | 1 |
| Ingestion — IoT Rule → Lambda → Postgres, dedup by `seq`, idempotent writes, offline sweep | 2 | 2 |
| Versioned API — auth **done**; versioning, per-user/API-key rate limits, idempotency keys remain | 2 | 1.5 |
| Observability — structured logs, metrics, traces | 1 | 1 |
| Configuration service — table and endpoints done; templates remain | 2 | 0.5 |
| Command dispatch — **essentially done**, incl. server-side 45 s cooldown; expiry sweep remains | 1 | 0.25 |
| Alert engine — rules, severity, dedup window, storm digests, acknowledge/assign/resolve | 2 | 2 |
| Notifications — **DLT SMS and WhatsApp already implemented**; push, email, delivery tracking remain | 2 | 1 |
| Retention — partition drops, daily compaction, exports | 1 | 1 |
| | **18** | **~11** |

**Four items gate portal work and get more expensive with delay** (`Backend_Pending_Items.md` §9):

1. **Telemetry dedup index** — the schema has no UNIQUE except `users.phone_number`, and the bridge is specified to replay buffered records. Ten minutes now; a data-cleanup exercise after the pilot runs.
2. **Partitioning `telemetry_history`** — retention by partition drop presumes partitioning that does not exist. Trivial on today's near-empty table, a migration on a full one.
3. **Row-Level Security** — FR-CLD-042 requires the data layer to make a missing tenant filter impossible. Today `getPumpInScope` is a helper each route must remember to call; it is used correctly everywhere, but the plan adds ~30 endpoints. Retrofitting RLS under 30 endpoints means re-testing 30 endpoints.
4. **Observability** — FR-WEB-017's system health view has no data source without it, and would ship as empty panels.

Items 1–2 (~half a week) run alongside portal W0. Items 3–4 (2 weeks) sit between portal W3 and W4.

**Broken down item-by-item in `Web_App_Pending_Items.md`** (17 Aug), which supersedes the two tables previously here. That document is source-verified against `web/index.html` and `backend/server.js` rather than estimated, and it credits work already done — the portal is at 5 of 34 FR-WEB requirements, not zero.

**A Material Design requirement was added on 17 August** (product owner): modern, polished, responsive, strict compliance with Material Design guidelines. This is a new requirement — SRS §8 specifies behaviour, not visual language — and should be recorded as an amendment (**FR-WEB-006, proposed**). It resolves F-1 toward React + MUI and adds a design-system phase. Rationale in `Web_App_Pending_Items.md` §11.

| Phase | Weeks | Delivers |
|---|---|---|
| W0 | 0.25 | Backend `LATERAL` join for per-phase V/I; delete the client-side fault injector |
| W1 | 4 | **Design system + port** — MD3 theme, React/MUI, responsive shell, accessibility, feature parity plus real telemetry binding |
| W2 | 2 | Device detail shell + Overview/Trends/Configuration/Events; audit log — against four endpoints already implemented and unused |
| W3 | 2 | Common layer — WebSocket + stale indicator, i18n framework, TOTP MFA (list/sort/filter/export now largely from MUI `DataGrid`) |
| W4 | 5 | Fleet dashboard, CSV import, bulk allocation, lifecycle state machine, system health, support console, **factory provisioning console**, multi-staff partner accounts |
| W5 | 5 | Schedule/Ownership/Diagnostics tabs; partner stock, panel binding, templates, sub-tree dashboard, RMA, service reports |
| W6 | 2 | Alert subscription/ack/assign/resolve; white-labelling (now a theme seed) |
| | **~20.25** | |

Takes the portal from 5 to **32 of 34 FR-WEB**. The two that remain are gated on other streams, not on effort: FR-WEB-015 (needs Stream 4 OTA) and FR-WEB-060…064 (needs the alert engine, which is why W6 sits last).

**Why the design phase sits at W1 and not later.** Strict Material Design compliance rewrites the presentation layer regardless of stack, so it is done once against ~5 views now or against ~30 views later — including two dashboards, a seven-tab device detail and two consoles. Net cost is **+3 weeks**, since roughly a week of it displaces work already budgeted: MUI `DataGrid` delivers FR-WEB-004's pagination/sort/filter/export, and MD3 dynamic colour makes per-partner white-labelling (FR-WEB-036) a seed colour derived from the partner's logo rather than a bespoke CSS-variable scheme.

**Ordering principle, unchanged:** W0–W3 front-load what everything later inherits — the design system and component model, real data binding, the WebSocket stale-state contract, the i18n framework.

**Milestone M1 (month 9):** portal complete against simulated devices. Every SRS §8 requirement demonstrable except the two gated above.

---

## 6. Stream 2 — Android app · months 9–12 · 11 weeks

Starts from the existing app — six languages, working Compose UI, phone-OTP auth. Rework, not rewrite.

| Work | Weeks |
|---|---|
| Migrate from direct Cognito MQTT to the backend API; remove guest access and wildcard topic scoping | 2 |
| End-user screens — home, live detail, plain-language faults with suggested actions, control with progress states, cooldown countdown | 3 |
| History and reports | 1 |
| Dealer commissioning — QR scan, site capture, GPS, template apply, self-test, handover | 2 |
| BLE offline commissioning (module BLE confirmed available, §5.0.3) | 2 |
| Offline queue, push with deep links, accessibility pass | 1 |

**Milestone M2 (month 12):** app complete against simulated devices.

---

## 7. Stream 3 — MQTT bridge · months 12–14 · 9 weeks

Where simulation ends and reality begins.

| Work | Weeks |
|---|---|
| Offline buffering to module flash, replay with `buf: true` | 2 |
| NTP time sync, `ts`/`seq`/`tsApprox` enrichment | 1 |
| Device Shadow adoption; retire the command topic (D-1) | 2 |
| Fleet provisioning by claim — **client side only**; the portal/factory side moves forward to Stream 1 W3 (verify OI-30 first) | 1 |
| IoT Jobs handling and bridge FOTA | 1 |
| **Integration against real devices** — the first true end-to-end test | 2 |

**Milestone M3 (month 14):** real devices driving the real portal and app.

> **This is the riskiest milestone in the plan.** Everything before it was validated against a simulator you wrote. Budget the full 2 integration weeks and expect to spend them.

---

## 8. Stream 4 — M031 firmware · months 14–16 · 8 weeks

| Work | Weeks |
|---|---|
| Batch release — under-voltage (FR-DEV-021a/c), `get_settings`, enumerated acks, runtime intervals, flash debounce, cooldown interlock, module reset line, promote compile-time setpoints | 3 |
| Flash reclamation — compile out debug `printf`, measure recovery (FR-DEV-088) | 1 |
| Bootloader — module-staged OTA, signature/CRC verification, recoverable failure path | 3 |
| Power-cut and recovery testing | 1 |

**Milestone M4 (month 16):** firmware updatable over the air; no further site visits for software.

---

## 9. Cross-cutting · months 16–22 · 24 weeks

| Work | Weeks | Start |
|---|---|---|
| Hardware-in-loop rig and protection test suite | 3 | Month 14 (parallel) |
| Load, soak, security and RBAC authorisation testing | 4 | Month 16 |
| EMC and safety pre-testing, remediation | 4 | Month 16 — **needs hardware freeze** |
| WPC/ETA submission | 2 | Month 17 — **2–4 month external lead** |
| BIS assessment | 1 | Month 17 |
| DPDP — consent, data-subject rights, grievance, breach process | 3 | Month 18 |
| Penetration test and remediation | 3 | Month 18 — book 4–8 weeks ahead |
| SBOM, CVE monitoring, patch SLA | 1 | Month 19 |
| Documentation set | 3 | Month 19 |

**Milestone M5 (month 22):** certified, security-tested, documented. GA.

---

## 10. Timeline

Revised 17 Aug for the Stream 1 rescope. Stream 1 was scoped at 37 weeks; **~31.5 remain** (backend ~11 + portal ~20.25), so roughly **5.5 weeks are banked** — about 4 months of prior work recovered, less the 3 weeks the Material Design requirement adds back.

| Months | Stream | Milestone | Change |
|---|---|---|---|
| 0–0.5 | Sprint 0 — safety floor + simulator | Exposures closed | SEC-1, SEC-2, simulator **done** (§2.1) |
| 0.5–8 | **Backend + Web portal** (priority 1) | **M1** — portal complete | was 0.5–9 |
| 8–11 | **Android app** (priority 2) | **M2** — app complete | was 9–12 |
| 11–13 | **MQTT bridge** (priority 3) | **M3** — real devices end to end | was 12–14 |
| 13–15 | **M031 firmware** (priority 4) | **M4** — OTA capable | was 14–16 |
| 15–21 | Test, compliance, documentation | **M5** — GA | was 16–22 |
| 21–23 | Contingency | — | was 22–24 |

**Total: 21–23 months solo**, down about a month.

**Treat that month as provisional.** It comes entirely from source-verifying Stream 1 — Streams 2, 3 and 4 have not had the same pass, and there are reasons to think they would also come back lower: the bridge already implements MQTT over TLS, SSL context setup, topic construction and MCU routing (`mqtt_bridge.c`), and the M031 firmware is in production on 300+ units. Equally, a source-verified pass on the Android app may find the Cognito migration (D-2) costs more than the 2 weeks allowed. **Do not re-plan the GA date on this line until Streams 2–4 have been checked the same way.**

The certification lead times in §9 are unaffected — WPC/ETA and penetration-test booking have their own clocks and do not move because development finished sooner.

---

## 11. What this ordering costs, and how to mitigate it

Honest accounting. Each of these is a real consequence of portal-first, and each has a mitigation that mostly works.

| Risk | Consequence | Mitigation |
|---|---|---|
| **No field learning for ~12 months** | You will not discover what rural connectivity, real farmers, or real dealers do to your assumptions until month 12 — and by then the portal and app are built on those assumptions | **Run a 10-device pilot at month 1** using the Sprint 0 hardened bridge. Not a stream, just 10 units in the field feeding real data. Cheap insurance, and it makes the portal work better because it is built against real data rather than only simulation. **This is the single most valuable amendment to your ordering.** |
| **Big-bang integration at month 12** | The classic failure mode of top-down ordering | Contract freeze (§4); simulator models adversarial conditions, not happy paths; the month-1 pilot keeps a thin thread of reality running throughout |
| **Simulator drift** | Portal works beautifully against fiction | Firmware is always authoritative; single schema source; re-verify the simulator against a real device monthly using the pilot units |
| **Revenue deferred to month 9+** | Nothing sellable for three quarters | The month-1 pilot can become a paid friendly-customer deployment around month 4–5 if you carve out a thin device-detail view early |
| **OTA arrives at month 16** | Every unit shipped before then needs a site visit for firmware | Accept, but cap pilot fleet size until M4. Do not scale deployment ahead of OTA. |
| **Hardware freeze at month 16** | Late for a 2–4 month certification lead | Decide RTC, BLE and MCU-size questions by month 12 at the latest |

---

## 12. Decision log

Updated 17 August 2026. Portal-related decisions are argued in `Web_App_Pending_Items.md` at the sections cited.

| # | Decision | Status |
|---|---|---|
| D-4 | Device identity = thing name = certificate CN | **Revised 17 Aug — `dev_id` = modem IMEI**, not the MCU UID. MCU boards are the frequently-replaced part and the certificate lives on the modem. §4.1 above; `Web_App_Pending_Items.md` §5.2.1. **Awaiting sign-off; ~2 days, cross-stream. Do before any certificate is issued.** |
| D-5 | Topic namespace `devices/{dev_id}/...` | Decided — as-built in the bridge |
| D-1 | Command topic now, Device Shadow in Stream 3 | Decided |
| D-2 | App moves to backend API; Cognito direct-MQTT retired | Decided (Stream 2) |
| D-3 | Postgres/TimescaleDB, not Timestream | Decided |
| D-6 | Users carry hierarchy; no separate organisation entity | **Decided 17 Aug — no organisation entity.** Multiple manufacturing partners, each branded with their own logo; branding attaches to the partner's node and resolves by walking `hierarchy_path`. `Web_App_Pending_Items.md` §8.1 |
| P-1 | Multiple staff logins per partner | **Decided 17 Aug — yes, one login per employee.** Several logins share one hierarchy node via a nullable `org_node_id`; the scoping predicate is unchanged and `hierarchy_path` has no UNIQUE constraint, so nothing migrates. ~2–3 days in W3. §8.1.2 |
| C-0 | Provisioning method | **Decided 17 Aug — AWS IoT fleet provisioning by claim, performed in the Superadmin factory.** Portal/factory side is buildable now and moves to Stream 1 W3; the device-side claim exchange stays in Stream 3. §5.1 |
| C-1 | Claim gating | **Decided 17 Aug — whitelisted IMEIs**, uploaded as CSV/Excel and checked by the pre-provisioning hook. Same import pipeline as FR-WEB-010 batch inventory — build once. Single-use claim is the anti-replay control. §5.2 |
| C-2 | IMEI ↔ MCU UID binding | **Resolved by the D-4 revision** — no binding required. Whitelist on IMEI alone; MCU UID becomes a tracked attribute with swap history. The factory rig needs to talk only to the modem, not the M031. §5.2.1 |
| F-2 | Locale scope | **Decided 17 Aug — official languages of India: 22 Eighth Schedule + English.** Urdu, Kashmiri and Sindhi deferred to a later phase, which defers RTL entirely — **20 locales in scope, all LTR.** Adopt CSS logical properties from W1 so the eventual RTL retrofit stays small. §4.1 |
| F-1 | `web/index.html` vs the dormant `web/src/` React scaffold | **Decided 17 Aug — move to React + MUI.** Forced by the new Material Design requirement below: a strict-MD3 rebuild rewrites the presentation layer either way, so the argument that favoured `index.html` (its working integration) is the part being replaced. The API contract knowledge ports; the markup does not. `Web_App_Pending_Items.md` §8.2, §11.2 |
| F-3 | UI design language | **New requirement 17 Aug — modern, polished, responsive, strict Material Design compliance.** Propose as **FR-WEB-006**; SRS §8 currently specifies behaviour, not visual language. Costs +3 weeks net, placed at portal W1 so it is done against ~5 views rather than ~30. Casualties to name now: the three custom themes (incl. “Cyber Neon”, which cannot meet MD3 contrast), emoji-as-iconography, and the hard-coded gauge palette. `Web_App_Pending_Items.md` §11 |
| OI-30 | Runtime certificate write on the module | **Assumed true, untested — now the highest-value open item.** Evidence: certs load by filesystem path (`app_config.h:24–26`) and `CONFIG_HAS_DEMO_FS=y`. Not yet shown that the *running app* can write them. **Half-day bench test, runnable now**; it decides whether W3's console does per-batch claim bundles or per-device certificate generation. §5.3 |
| OI-14 | Module flash free for app + certs + buffer | Verify before Stream 3 |
| OI-32 | Module RTC survives power cycle | Decide by month 12 (hardware freeze) |
| OI-18/20 | Plan tiers, pricing, who collects | Before 1B subscriptions |
| OI-19 | SIM partner terms and M2MSP evidence | Before pilot scale-up |
| — | Translation procurement — 20 locales × ~800 strings, native speakers with electrical vocabulary | **Start during W2.** External lead time in the same category as DLT registration. Translation quality is a safety property here: a farmer misreading a protection setpoint is worse off than one reading English. |

---

## 13. Two amendments I would make to this ordering

I have built the plan to your priorities. Two changes would improve it materially without disturbing that order:

**Add the 10-device pilot at month 1.** Two weeks of effort. It converts a twelve-month blind spot into a continuous feedback signal, and it means the portal you spend eight months building is validated against real device behaviour rather than only your own simulator. If you take one suggestion from this document, take this one.

**Move under-voltage protection into Sprint 0.** It is roughly three days of firmware work. It is absent today (source-verified), customers are expected to require it, and on rural feeders it is a primary motor-burnout cause. Waiting until month 14 means every unit sold in the interim lacks a protection your customers will assume is present — which is a warranty and reputation exposure rather than a scheduling question.

Neither changes the ordering you set. Both reduce the risk of arriving at month 12 and discovering the previous year was built on assumptions.
