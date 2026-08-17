# Reconciliation Report — Existing Work vs. SRS v7.0

**Date:** 16 August 2026
**Scope reviewed:** `D:\Projects\IoT Agri Pump Control and Monitoring` — `backend/`, `web/`, `android/`, `docs/`, root `README.md`, `.gitignore`
**Not reviewed:** `hardware/`, Kotlin sources (the staging tool rejected `.kt` files), `graphify-out/`

---

## 1. Headline

Considerably more exists than the SRS assumed. v7.0 recorded the cloud, portal and app as "not started"; in fact there is a **working Node/Express + PostgreSQL backend**, a **built Android app in six languages**, and **four design documents** including a well-developed fleet-provisioning architecture.

However, the earlier work was written against **a different system architecture** — an ESP32 controller, AWS Timestream, Device Shadow control, and app-direct MQTT over Cognito. The firmware reality (Nuvoton M031 + A7672S bridge, `devices/{dev_id}/commands`) arrived later. The two halves have not been reconciled, and the seams are where the risk sits.

**Two findings need attention before anything else** (§2). The rest is alignment work.

---

## 2. Security findings

### SEC-1 — `POST /api/telemetry` is unauthenticated

`backend/server.js:429`. No `authenticateToken`, no device authentication, no ownership check.

```js
app.post('/api/telemetry', async (req, res) => {
  const { pump_id, v_ry, ... , pump_on, fault_active } = req.body;
  // inserts, then:
  const status = fault_active ? 'FAULT' : (pump_on ? 'RUNNING' : 'STOPPED');
  await pool.query(`UPDATE agripump.pumps SET status = $1 ... WHERE id = $2`, [status, pump_id]);
```

Anyone who can reach the server can insert telemetry for **any** `pump_id` and change that pump's displayed status. A farmer can be shown `RUNNING` when the pump is stopped, or `FAULT` when it is healthy. Fabricated history is also injectable, which matters if runtime data ever supports a warranty or service claim.

This is the same class of defect as GAP-22 in the bridge — an unauthenticated path into a trusted system — and it should be closed the same way.

**Fix:** telemetry must arrive via the AWS IoT ingestion path with the device authenticated by certificate (SRS §6.7), not by an open HTTP endpoint. If a direct HTTP path is retained for testing, it needs device authentication and an ownership check, and must not exist in a production build.

### SEC-2 — Credentials committed in `schema.sql`

The seed block contains a working superadmin account whose password is documented in a comment (`-- admin123`), and a real personal mobile number (`+919741323830`).

**Fix:** move seed data to a separate development-only script, generate the superadmin password at deploy time, and use a placeholder number. Since this is in git history, rotate the password and consider whether history needs rewriting.

> `.gitignore` correctly excludes `.env` and `backend/.env` — worth confirming they were never committed before that rule existed.

---

## 3. Architectural divergences

These are genuine forks in the road, not documentation drift. Each needs a decision.

| # | Divergence | Existing work | SRS v7.0 | Notes |
|---|---|---|---|---|
| **D-1** | **Control path** | AWS IoT **Device Shadow** deltas for pump ON/OFF (`android/README.md` §3, `IotMqttClient.kt`) | `devices/{dev_id}/commands` topic, verbatim → validated forwarding | The bridge implements neither shadow subscription nor shadow reporting. Shadow is arguably better (commands survive the device being offline, and `clean_session=1` makes GAP-26 moot). But it is unbuilt in the bridge. **Decide before the bridge release is cut.** |
| **D-2** | **App ↔ cloud path** | App connects **directly to AWS IoT** over MQTT/WSS using **Cognito** identities, with `iot-policy.json` attached per identity | App talks to the backend API; backend owns IoT | Two very different security models. The Cognito path puts IoT topic authorisation in AWS policy rather than in your RBAC layer — and `android/README.md` §2 suggests enabling *unauthenticated guest access* for bring-up, with wildcard `pumps/*` scoping "so one identity can subscribe to all of a user's pumps". That wildcard plus guest access would let any identity subscribe to every pump. Fine for a demo, unacceptable in production. |
| **D-3** | **History store** | **Timestream** (README, android README §5, `history-lambda.py`) | PostgreSQL/TimescaleDB, 30-day retention, daily compaction | The backend already writes `agripump.telemetry_history` in Postgres, so Timestream appears to be the older plan. Confirm Timestream is dead and remove the references, or reopen the decision. |
| **D-4** | **Identity / naming** | Thing names like `PUMP-4G-3P-8821`; `pumps.id VARCHAR(50)` | `dev_id` = MCU 96-bit UID = thing name = certificate CN (§6.7) | Three naming schemes exist across firmware, docs and DB. Identity binding depends on exactly one. **This must be settled before certificates are issued** — it is baked into every certificate CN thereafter. |
| **D-5** | **Topic namespace** | `pumps/<THING_NAME>/telemetry` (README, IoT rule, `iot-policy.json`) | `devices/{dev_id}/telemetry` (bridge as-built) | Straight conflict. The IoT policy and rules will not match what the bridge publishes. |
| **D-6** | **Tenancy model** | Users carry `hierarchy_path` directly; no organisation entity | Organisations form the tree; users belong to organisations | The existing model is simpler and works, but cannot express "this dealer company has three staff logins" or per-organisation branding (FR-WEB-036). Decide whether that matters commercially. |

---

## 4. Hierarchy: 5 dealer tiers vs 6

`docs/9-tier-rbac-architecture.md` and the schema define **five** dealer tiers (`dealer1`…`dealer5`); you specified **six**, and SRS FR-SEC-000a says six.

More importantly, the schema encodes tiers as a **fixed role enum**:

```sql
role IN ('superadmin','manufacturer','distributor','dealer1',...,'dealer5','customer')
```

This is a ladder, not a tree. Consequences:

- Adding the sixth tier means a schema migration and a code change, not a data change.
- Nothing prevents a `dealer4` being parented under a `dealer1`, creating a path whose depth disagrees with the role name.
- Depth is enforced by the enum rather than computed, so SRS FR-SEC-000b (materialised path + computed `depth`) is unimplemented.

**Recommendation:** replace the five dealer roles with a single `dealer` role plus a computed `depth` derived from `hierarchy_path`, and enforce `depth <= 6` at write time. That satisfies the requirement, removes the migration-per-tier problem, and matches FR-SEC-000a/b. The `hierarchy_path` design itself is good and should stay — the `text_pattern_ops` index on it is the right call.

**Also note:** `POST /api/users` allows roles `['superadmin','manufacturer','distributor','dealer1','dealer5']` — `dealer2`, `dealer3` and `dealer4` are missing, so mid-tier dealers cannot create subordinates. Looks like a typo rather than a decision.

---

## 5. Data model gaps

The schema covers users, pumps, telemetry and faults. Against the SRS it is missing:

| Missing | Requirement | Why it matters |
|---|---|---|
| Device lifecycle state | §7.3 | `pumps.status` is only `RUNNING`/`STOPPED`/`FAULT` — operational state, not lifecycle. No `MANUFACTURED`, `IN_STOCK`, `COMMISSIONED`, `SUSPENDED`, `RMA`, `RETIRED`. |
| Allocation history | FR-SEC-003 | Ownership moves are `UPDATE`s with no trail. Chain of custody cannot be reconstructed — a problem for warranty disputes. |
| Audit log | FR-CLD-062 | No append-only record of who did what. |
| Subscription | §2.7 | No plan, expiry or suspension state. The commercial model has no data behind it. |
| Configuration | §6.4 | No storage of desired vs reported setpoints; no pending/applied state. |
| Panel record | FR-WEB-031 | No link from device to panel serial, motor rating, starter type. |
| Device certificate identity | §6.7 | No `cert_id` / thing ARN on `pumps`. |

### Fabricated defaults

```sql
power_factor NUMERIC(3,2) DEFAULT 0.88,
frequency    NUMERIC(4,1) DEFAULT 50.0,
gsm_rssi     INT          DEFAULT 24,
firmware_version VARCHAR(20) DEFAULT 'v2.4.1'
```

Power factor is **not measured** — it is explicitly out of scope (SRS §1.2) and the hardware does not compute it. Every row will nonetheless carry a plausible-looking `0.88`. Same for frequency and RSSI. Data that looks measured but is invented is worse than a null: it will be charted, exported and eventually believed.

**Fix:** drop the columns that are out of scope, and make the rest nullable with no default.

### Fault code representation — a third scheme

| Layer | Representation |
|---|---|
| Firmware | Numeric `0`–`9` (`FAULT_DRY_RUN = 5`) |
| SRS §6.2 | Numeric + canonical name (`5` / `DryRun`) |
| `fault_logs` | Free-text `VARCHAR(30)` (`'ERR_PHASE_LOSS'`) |

SRS FR-CON-033 requires one source of truth. The DB should store the numeric code as the key, with the display name resolved from it.

---

## 6. Where the existing work is ahead of the SRS

These should be folded **into** the SRS, not changed.

| Item | Detail |
|---|---|
| **Six languages** | `values-hi`, `-kn`, `-mr`, `-ta`, `-te` plus English — Hindi, Kannada, Marathi, Tamil, Telugu. The SRS says English + Hindi at launch. The app is ahead; update FR-APP-003. |
| **45-second command cooldown** | `docs/telemetry-and-fault-spec.md` §2 — prevents contactor chatter, with a firmware interlock, a `REJECTED / COOLDOWN_ACTIVE` response carrying `remainingSec`, and a UI countdown. This is a genuinely good idea that is **absent from the SRS and absent from the firmware**. It should become a requirement. Note the firmware's existing `minOffS` protects the motor between stop and start, but nothing rate-limits *commands*. |
| **DLT SMS/WhatsApp templates** | `docs/dlt-sms-whatsapp-templates.md`. DLT registration is mandatory for transactional SMS in India and has a lead time. The SRS mentions SMS as a channel but has no DLT requirement. Add to §13. |
| **Fleet provisioning architecture** | `docs/aws-iot-fleet-provisioning-architecture.md` is thorough — template JSON, pre-provisioning hook, scoped policy, factory flashing for 100-unit batches. It closely matches SRS §5.2.1, which is reassuring: two independent derivations agreeing. **It also assumes the device stores its permanent certificate in NVS, i.e. it assumes runtime certificate write is possible** — the same assumption as OI-30. |
| **Cost modelling** | The telemetry spec models AWS IoT message cost per fleet size. The SRS has a data budget but no cost model. Worth incorporating. |

---

## 7. Stale documentation

Root `README.md` describes a system that no longer exists:

- `firmware/` — "Pump-side controller firmware (**ESP32 / ESP-IDF**)" and "Firmware — not started". It is Nuvoton M031LD2AE + SIMCom A7672S, in production on 300+ units.
- `web/` — "Web dashboard design mockup (static HTML, demo data)". It is now a Vite/React/TypeScript app.
- Architecture diagram shows Timestream and shadow-based control (see D-1, D-3).

Anyone joining the project would be misled on the first page.

---

## 8. Recommended sequence

1. **Close SEC-1 and SEC-2.** Small, self-contained, and both are live exposures.
2. **Settle D-4 (device identity naming).** Everything downstream — certificates, topics, IoT policy, DB keys — depends on it, and it becomes expensive to change once certificates are issued.
3. **Settle D-1 (shadow vs command topic) and D-5 (topic namespace)** before the hardened bridge release is cut, since both change bridge code.
4. **Decide D-2 (Cognito direct-MQTT vs backend API).** If Cognito stays, remove guest access and replace wildcard `pumps/*` scoping with per-identity policy variables.
5. **Refactor the hierarchy** to a single `dealer` role with computed depth ≤ 6, and fix the `POST /api/users` role list.
6. **Extend the schema** — lifecycle state, allocation history, audit log, subscription, configuration; drop the fabricated columns.
7. **Update the root README** and mark the superseded design docs.

---

## 9. Suggested SRS amendments

| Section | Change |
|---|---|
| §1.1, §2.1.1 | Record that backend, web and Android exist; remove "not started" |
| FR-APP-003 | Six languages, not two |
| New FR-DEV / FR-CON | 45-second command cooldown with `REJECTED / COOLDOWN_ACTIVE` and UI countdown |
| §13 | DLT registration for SMS/WhatsApp in India |
| §5.2.1 | Cross-reference `docs/aws-iot-fleet-provisioning-architecture.md`; note the shared NVS-write assumption with OI-30 |
| §11 | Reconcile the data model against `schema.sql`; add the missing entities |
| §6.3 | Resolve the topic namespace conflict |
| §12 | Add the AWS cost model from the telemetry spec |
| New open issues | D-1 … D-6 as decisions required |
