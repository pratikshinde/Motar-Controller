# IoT Agri Pump Control and Monitoring

IoT-based monitoring and control for three-phase and single-phase agricultural
and domestic water pumps.

Farmers monitor and control borewell and irrigation pumps from a phone — pump
state, run hours, three-phase electrical health (line voltages, phase currents,
phase sequence) and protection faults (dry run, overload, phase loss, phase
reversal, imbalance, cable open) — without walking to the pump house. Panel
manufacturers, distributors and dealers manage their own fleets through a
multi-tenant web portal.

The pump controller itself is an **existing, shipping product** with 300+ units
in the field. This repository adds the IoT layer around it.

---

## Architecture

```
┌──────────────┐   UART2 JSON    ┌──────────────┐   MQTT/TLS   ┌──────────────┐
│  M031 MCU    │◄───115200 8N1──►│   A7672S     │◄────────────►│ AWS IoT Core │
│  (protection │                 │  (bridge     │              └──────┬───────┘
│   + control) │                 │   app)       │                     │
└──────────────┘                 └──────────────┘              IoT Rules
     Layer A                          Layer B                         │
                                                               ┌───────▼───────┐
                                                               │   Backend     │
                                                               │Python FastAPI │
                                                               │ SQLAlchemy +  │
                                                               │ TimescaleDB   │
                                                               └───┬───────┬───┘
                                                                   │       │
                                                         ┌─────────▼──┐ ┌──▼──────────┐
                                                         │ React Web  │ │React Native │
                                                         │   Portal   │ │ Mobile App  │
                                                         └────────────┘ └─────────────┘
```

**Two protocol layers, deliberately separated.** The MCU never speaks MQTT — it
exchanges line-delimited JSON with the modem over UART. The A7672S bridge is the
MQTT/TLS gateway to AWS. Changes to Layer A are expensive (shipping firmware on
300+ units); changes to Layer B are cheap. Complexity belongs in the bridge.

**Protection never depends on connectivity.** All trip logic runs on the MCU and
continues to work with no network, no cloud and no subscription.

MQTT topics: `devices/{dev_id}/telemetry`, `/faults`, `/status`, `/diag`,
`/commands`. `dev_id` is the MCU's 96-bit unique ID.

---

## Repository layout

| Directory | Contents | Stack |
|---|---|---|
| `firmware/` | Pump controller firmware — measurement, protection, state machine, local HMI | Nuvoton M031LD2AE (Cortex-M0), C, Keil/GCC/IAR |
| `MQTT Bridge A7672 Firmware/` | MQTT bridge application | SIMCom A7672S OpenSDK, C |
| `backend/` | REST API, ingestion, auth, RBAC, telemetry, alerts | Python, FastAPI, SQLAlchemy, TimescaleDB, PostgreSQL |
| `web/` | Web portal | React, TypeScript, Vite |
| `mobile/` | Mobile app (Android & iOS) | React Native, Expo, TypeScript |
| `hardware/` | Schematics, PCB, BOM | — |
| `docs/` | Specifications and plans | — |

---

## Hardware

| Component | Part |
|---|---|
| MCU | Nuvoton M031LD2AE — Cortex-M0, 64 KB flash, 8 KB SRAM |
| Modem | SIMCom A7672S — LTE Cat-1, GNSS, BLE, OpenSDK |
| Link | UART2 (PC.0 / PC.1) @ 115200 8N1 |
| Display | 16×2 LCD, 5-button ADC keypad, 3 status LEDs |
| Output | Dual relays (motor contactor + auxiliary) |
| Sensing | Isolated three-phase voltage and current, internal panel CTs |
| Motor range | 3 – 50 HP |

---

## Protection functions

Phase loss · phase sequence / reversal · over-voltage · voltage imbalance ·
overload · dry run · cable open (full and partial) · Y-phase fault

Fault codes are numeric `0`–`9` and are the single source of truth across
firmware, bridge, cloud, portal and app — see `docs/SRS_v7.0.md` §6.2.

Control: manual start/stop (local, app, cloud), auto-restart on power restore
with delay, cyclic timer (elapsed-time based — the MCU has no RTC), star-delta
transition timing, dry-run auto-recovery.

---

## Documentation

### Current

| Document | Purpose |
|---|---|
| **`docs/SRS_v7.0.md`** | Software Requirements Specification — the authoritative reference for requirements, protocol, data model, RBAC and compliance. Appendix D is a gap analysis of the shipping firmware and bridge. |
| **`docs/Development_Plan_FINAL.md`** | The active development plan. Priority order: web portal → Android app → bridge → MCU firmware. |
| **`docs/Web_App_Pending_Items.md`** | Phased, item-level web portal plan (W0–W6) against FR-WEB-001…064 — architecture decisions (D-4, D-6, P-1), what's built vs. deferred, and why |
| **`docs/Backend_Pending_Items.md`** | Backend build-out against FR-CLD-*/FR-SEC-*/1B — what's done, what's scoped but not started (observability, retention, API versioning), effort remaining |
| `docs/Reconciliation_Report.md` | Existing implementation vs. SRS — divergences, security findings, decisions required |
| `docs/Development_Plan_15_Day_Pilot.md` | Narrow-scope pilot plan (absorbed into the final plan as Sprint 0–1) |
| `docs/SRS_Compliance_Roadmap.md` | Full-scope roadmap by dependency order — effort estimates and phasing |
| `docs/aws-iot-fleet-provisioning-architecture.md` | Fleet provisioning by claim — template, pre-provisioning hook, scoped policy, batch flashing |
| `docs/dlt-sms-whatsapp-templates.md` | India DLT-compliant SMS and WhatsApp templates |
| **`docs/Android_App_Development_Plan.md`** | The active Android app plan — source-verified code audit, UI/UX redesign (Pump screen, Command Bar), phased plan (D/0/1 implemented; 2/3/5/6 pending; Partner Console/Phase 4 explicitly deferred), effort estimate, implementation status |
| **`docs/Firmware_and_Bridge_Development_Plan.md`** | The active MCU + A7672S bridge plan — source-verified audit (20 findings, F-1…F-20), the identity decision that gates certificate issuance, the missing AWS IoT → backend ingestion path, and a 6-phase plan (F0 safety fix → F5 OTA) |

### Superseded — read against the SRS

| Document | Superseded by |
|---|---|
| `docs/9-tier-rbac-architecture.md` | SRS §7 — the dealer tier is recursive to **6** levels, not a fixed five-role ladder |
| `docs/telemetry-and-fault-spec.md` | SRS §6 — actual intervals are 60 s running / 300 s idle. The 45-second command cooldown in §2 remains valid and is scheduled. |
| `docs/android-app-design.md` | SRS §9 |

---

## User hierarchy

```
Superadmin (OEM)
  └── Panel manufacturer
        └── Distributor
              └── Dealer (recursive, up to 6 levels)
                    └── End customer
```

Devices are owned by exactly one node and move down the tree as they are sold.
Every allocation is audited. Scoping uses path enumeration — a user sees their
own sub-tree and nothing else.

---

## Status

| Component | State |
|---|---|
| **MCU firmware** | ✅ In production — 300+ units. v1.0.367. |
| **MQTT bridge** | 🟡 Working (V1.0.1) — hardening required before field use: AWS TLS mode, command validation, offline buffering |
| **Backend** | 🟢 Feature-complete for the current scope — JWT auth + rotating refresh tokens, TOTP MFA, `hierarchy_path`-scoped RBAC, lifecycle state machine, audit log, WebSocket live-update hub, device config + reusable templates, bulk allocation, factory batch provisioning + IMEI whitelist, warranty/RMA with bridge-swap identity migration, panel binding, live service reports, and the alert engine (dedup, storm digest, subscriptions, ack/assign/resolve). SMS/WhatsApp senders exist but aren't wired into alerts yet — deferred to a paid tier. Still open: API versioning, per-key rate limits, observability, retention/partitioning — see `docs/Backend_Pending_Items.md`. |
| **Web portal** | 🟢 Feature-complete for the current scope (React + MUI) — live telemetry, device registry and 7-tab device detail, hierarchy/multi-staff accounts, fleet dashboard, factory console, system health, support console, child-org invites, per-partner white-labelling, configuration templates, service reports, and an Alerts inbox. i18n ships with `en`/`hi` only — further locales are being done in the Android app instead, not here. See `docs/Web_App_Pending_Items.md`. |
| **Android app** | 🟡 Rebuilt against the real backend API (JWT + rotating refresh tokens, TOTP MFA, `/ws` live updates, server-enforced 45s command cooldown) — the AWS IoT/Cognito/Firebase-auth stack it previously targeted is gone. Pump screen redesigned so the start/stop control can never scroll off-screen. Builds clean. Not yet field-tested; no push notifications, technician/commissioning flow, or Partner Console yet — see `docs/Android_App_Development_Plan.md`. |
| **AWS setup** | 🔴 Not provisioned — IoT policy, rules, certificates, provisioning template |
| **Hardware** | ✅ In production |
| **OTA** | 🔴 Not started — see SRS §4.6.1 |

### Before field deployment

Two items remain blocking per `docs/Development_Plan_FINAL.md` §2: a
protection-timer defect in the MCU (GAP-31), and the bridge's plain-text
broker mode with unvalidated command forwarding. The other two originally
tracked here are resolved: telemetry ingestion requires a per-device key
(`X-Device-Key`), and the database no longer ships seeded accounts: the first
superadmin is created with `backend/scripts/create_superadmin.py`. How the
database is created and changed: `docs/runbooks/schema-management.md`.

---

## Building

**MCU firmware** — Keil, GCC or IAR project files under `firmware/`. Flash with
Nu-Link (`firmware/Keil/flash.bat`).

**Bridge** — Ninja + ARM GCC from the SimCom OpenSDK. The output **must** be
LZMA-compressed before packaging; a raw binary flashes successfully and then
silently fails to boot. See `docs/SRS_v7.0.md` §5.0.35 and
`MQTT Bridge A7672 Firmware/CompileInfo_read.me`.

```
ninja
arm-none-eabi-objcopy -O binary customer_app.elf customer_app.bin
lzma e customer_app.bin customer_app_lzma.bin
crc_set customer_app_lzma.bin customer_app_crc.bin
python pack_image.py
```

**Backend** — `npm install`, configure `backend/.env`, `node setup-db.js`, `npm start`.

**Web** — `npm install`, `npm run dev`.

**Android** — open `android/` in Android Studio and run. Talks to `backend/server.js` directly (no AWS/Firebase setup needed); edit `data/AppConfig.kt` if your backend isn't reachable at the emulator's default `10.0.2.2:5000`. `firebase-messaging` is included but inert (push notifications are a future phase) — the `google-services` plugin stays commented out in `app/build.gradle.kts` until then.

---

## Licence

Proprietary. © Swathi Switchgear.
