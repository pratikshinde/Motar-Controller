# Software Requirements Specification (SRS)

## IoT-Based Agricultural Pump Control & Monitoring System

| Field | Value |
|---|---|
| Document Title | SRS — IoT Agri Pump Control and Monitoring System |
| Version | 7.0 (Draft) |
| Date | 16 August 2026 |
| Prepared for | Pratik |
| Status | For Review |
| Standard | IEEE Std 830-1998 (structure), ISO/IEC/IEEE 29148:2018 (requirement style) |

### Revision History

| Ver | Date | Author | Description |
|---|---|---|---|
| 0.1 | 2026-08-16 | — | Initial skeleton |
| 1.0 | 2026-08-16 | — | First complete draft |
| 7.0 | 2026-08-16 | — | TLS path to AWS **confirmed working** (OI-29 closed). **M031 flash measured at 47 KB of 64 KB used — 17 KB free**, making conventional A/B OTA with rollback infeasible; new §4.6.1 and GAP-32 specify the module-staged alternative. Under-voltage confirmed as MCU work with specified values. |
| 6.0 | 2026-08-16 | — | Firmware verification round. OI-23 and OI-24 closed by source inspection (under-voltage **not implemented**; overload delay **3 s**, `Timing_OverLoad` is a dead field). **New GAP-31: unsigned-arithmetic wraparound defeats the overload and imbalance trips.** SDK capability audit from `config/.config` resolves OI-3, OI-21, OI-25, OI-30 and GAP-2. |
| 5.0 | 2026-08-16 | — | Security architecture **decided and locked**: AWS IoT with mutual TLS only (generic broker mode removed), bridge-side command validation, certificate-bound identity, fleet provisioning by claim. Confirmed **no field units run the bridge**, so no exposure and no migration burden. Added §5.2.1 provisioning design and §6.6 command validation spec. |
| 4.0 | 2026-08-16 | — | **Reconciled against the A7672S bridge application** (`swathi_mqtt` V1.0.1, SIMCom OpenSDK A156B01V01A7672M6). §5.0 and §6.3 rewritten as-built: the bridge exists and works, but runs plain TCP to a public broker, forwards cloud payloads verbatim, and adds no id/ts/seq. Appendix D updated with 8 new findings. |
| 3.0 | 2026-08-16 | — | **Reconciled against the actual firmware** (`Autostarter_Display_M031LD2AE` v1.0.367). Setpoints, fault codes, ranges and defaults now taken from source. Protocol section rewritten: the MCU speaks line-delimited JSON over UART2 to the A7672X, which is the MQTT bridge. Added §4.7 as-built baseline, Appendix D gap analysis, and the modem-side application spec (§5.0). |
| 2.0 | 2026-08-16 | — | Scope revised: power/energy/PF metering removed; RTC calendar schedules removed (no RTC hardware); modem fixed to A7672; dealer chain up to 6 levels; 30-day retention; India-only certification; PCD reclassified as an existing shipping product |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [System Architecture](#3-system-architecture)
4. [Device / Firmware Requirements](#4-device--firmware-requirements)
5. [Connectivity & Cloud Requirements](#5-connectivity--cloud-requirements)
6. [Protocol Design](#6-protocol-design)
7. [User Hierarchy & RBAC](#7-user-hierarchy--rbac)
8. [Web Portal Requirements](#8-web-portal-requirements)
9. [Android Application Requirements](#9-android-application-requirements)
10. [Backend & API Requirements](#10-backend--api-requirements)
11. [Data Model](#11-data-model)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Compliance & Standards](#13-compliance--standards)
14. [Acceptance Criteria & Test Strategy](#14-acceptance-criteria--test-strategy)
15. [Assumptions, Constraints & Open Issues](#15-assumptions-constraints--open-issues)
16. [Appendices](#16-appendices)
    - Appendix D — Gap Analysis: firmware as-built vs. this SRS

---

# 1. Introduction

## 1.1 Purpose

This document specifies the functional and non-functional requirements for an IoT-enabled pump control and monitoring system for agricultural and light-industrial water pumps. The system covers:

- An existing, in-production embedded **Pump Controller Device (PCD)** installed inside a pump control panel, protecting and controlling single-phase and three-phase motors. **The PCD is already a shipping product with 300+ units in the field** (firmware repository: `github.com/pratikshinde/Autostarter_Display_M031LD2AE`, Nuvoton M031LD2AE MCU). This project adds an IoT layer to it; device requirements in §4 therefore distinguish *existing behaviour to be preserved* from *new work*.
- A **cellular connectivity layer** based on a SIMCom A7672 4G LTE Cat-1 module bridging the device to **AWS IoT Core**.
- A **cloud backend** for telemetry ingestion, command dispatch, device lifecycle and tenancy management.
- A **Web Portal** used by the OEM (Superadmin) and channel partners for device onboarding, allocation, monitoring and support.
- An **Android mobile application** used primarily by end customers (farmers) and field technicians.

The document is intended for product management, firmware engineers, cloud/backend engineers, mobile and web developers, QA engineers, certification consultants and channel partners.

## 1.2 Scope

**In scope**

- Real-time monitoring of supply health: line voltages, per-phase current, phase sequence and phase loss.
- Motor protection: dry run, overload, under-load, locked rotor, over/under voltage, voltage imbalance, current imbalance, phase reversal, single phasing, earth/leakage fault (optional CT), over temperature.
- Local and remote control: start/stop, auto/manual mode, cyclic (ON/OFF) timers, auto-restart with configurable retry policy.
- Remote configuration of all protection setpoints and timers.
- Fault event logging with timestamps, and upload to cloud on reconnect.
- Multi-tenant SaaS platform with a five-level channel hierarchy.
- OTA firmware update for the controller and the modem application.

**Out of scope (v1.0)**

- **Energy and power metering** — active power (kW), apparent power (kVA), power factor and cumulative energy (kWh) are deliberately excluded from v1.0 to keep the device BOM economical. Deferred to a higher-tier hardware variant.
- **Wall-clock calendar scheduling** — the PCD has no battery-backed RTC, so day-of-week / time-of-day schedules are out of scope (see §4.3).
- Variable frequency drive (VFD) speed control and closed-loop PID pressure control.
- Solar/hybrid inverter MPPT control.
- Billing/payment collection from end customers.
- Soil moisture sensing, weather-based irrigation scheduling (planned v2.0).
- iOS application (planned v1.1).
- Markets outside India — CE / FCC / RED certification is not pursued in this release.

## 1.3 Definitions, Acronyms and Abbreviations

| Term | Meaning |
|---|---|
| PCD | Pump Controller Device — the embedded controller in the panel |
| Panel Manufacturer / OEM Partner | Company assembling pump control panels using the PCD |
| Distributor | Regional partner buying from a panel manufacturer |
| Dealer | Local retailer/installer serving end customers |
| End User | Farmer / owner-operator of the pump |
| Dry Run | Pump running without water — detected via under-current / power threshold |
| Single Phasing | Loss of one phase in a three-phase supply |
| Phase Sequence | Order of R-Y-B phases; reversal causes reverse pump rotation |
| Cyclic Timer | Repeating ON/OFF duty cycle applied to the pump |
| Device Shadow | AWS IoT persistent JSON state document for a device |
| JITP / JITR | Just-In-Time Provisioning / Registration on AWS IoT |
| RBAC | Role-Based Access Control |
| SoC | State of Connectivity/Charge, context dependent |
| MQTT | Message Queuing Telemetry Transport |
| OTA | Over-The-Air firmware update |

## 1.4 References

- IEEE Std 830-1998, *Recommended Practice for Software Requirements Specifications*
- ISO/IEC/IEEE 29148:2018, *Requirements engineering*
- IS 8544 / IEC 60947-4-1 — Motor starters and contactors
- IS 12615 — Energy-efficient induction motors
- IEC 61000-4 series — EMC immunity
- AWS IoT Core Developer Guide — Device Shadow, Jobs, Fleet Provisioning
- SIMCom A7672 Series AT Command Manual
- SIMCom OpenSDK `A156B01V01A7672M6_SDK_250407` (sAPI reference)
- Bridge application: `swathi_mqtt` V1.0.1 — reviewed directly for this revision
- Nuvoton NuMicro M031 Series Technical Reference Manual
- Existing PCD firmware: `Autostarter_Display_M031LD2AE`, build v1.0.367 — reviewed directly for this revision
- Product branding: Swathi Switchgear
- Digital Personal Data Protection Act, 2023 (India)

## 1.5 Document Conventions

Requirements use the identifiers below and the keywords **shall** (mandatory), **should** (recommended), **may** (optional).

| Prefix | Area |
|---|---|
| FR-DEV | Device / firmware functional |
| FR-CON | Connectivity |
| FR-CLD | Cloud / backend |
| FR-WEB | Web portal |
| FR-APP | Android app |
| FR-SEC | Security |
| NFR | Non-functional |
| CMP | Compliance |

---

# 2. Overall Description

## 2.1 Product Perspective

### 2.1.1 Brownfield Context

This is **not a greenfield product**. The PCD (Autostarter with display, Nuvoton M031LD2AE) is in volume production with **over 300 units operating in the field**. The scope of this programme is to add cellular connectivity, a cloud platform, a web portal and a mobile app *around* that proven controller.

Consequences that shape every requirement in this document:

| Constraint | Implication |
|---|---|
| Protection and control logic is field-proven | It **shall not** be redesigned. §4.1–§4.4 restate existing behaviour as the baseline; changes are limited to what connectivity demands. |
| M031LD2AE has 64 KB flash / 8 KB SRAM | **Confirmed resolved:** the MQTT/TLS stack already runs on the A7672X; the MCU exchanges only line-delimited JSON over UART2. The MCU's stack was already raised to 2048 B to accommodate the IoT buffers, so headroom remains tight but the architecture is sound. |
| 300+ units are deployed; IoT support landed in v1.0.365 | It is **not known how many field units run v1.0.365+ and have a module fitted**. The retrofit and firmware-uplift population must be established (OI-11). |
| Existing firmware has no OTA capability | A bootloader with signed-image update and rollback is **new work** on the MCU and a prerequisite for FR-DEV-080. Module-side FOTA is separate and easier. |
| Existing setpoint set is defined in firmware | **Done** — §4.2, §6.1 and §6.2 are now taken directly from `Init_Settings.c`, `UI_Menu.c`, `IoT_Comm.c` and `MotorProtection.h` at v1.0.367. |
| Layer A is shipping code | Changes to the MCU↔module JSON are expensive; changes in the bridge app are cheap. Absorb complexity into the bridge wherever possible. |
| The bridge app exists (`swathi_mqtt` V1.0.1) | Connectivity is proven end-to-end. The remaining work is hardening — TLS to AWS, message enrichment, inbound validation, offline buffering — not greenfield construction. |

### 2.1.2 System Context

The system is a multi-tenant platform built around this product family. The PCD replaces or supplements conventional electro-mechanical starters and analog protection relays inside a pump control panel. It is sold to panel manufacturers as a component; the panel is then sold down the channel to end users. The software platform is multi-tenant: a single cloud deployment serves all partners, with strict data isolation between tenant sub-trees.

```
   ┌──────────────┐    RS485/IO    ┌──────────────┐   UART/AT   ┌───────────┐
   │ CT / PT      │───────────────▶│              │────────────▶│ SIMCom    │
   │ Sensors      │                │  PCD MCU     │             │ A7672 4G  │
   └──────────────┘                │  (firmware)  │◀────────────│           │
   ┌──────────────┐   Digital IO   │              │             └─────┬─────┘
   │ Contactor /  │◀───────────────│              │                   │ MQTT/TLS
   │ Starter      │                └──────┬───────┘                   ▼
   └──────────────┘                       │ BLE            ┌──────────────────┐
                                          ▼                │  AWS IoT Core    │
                                   ┌────────────┐          └────────┬─────────┘
                                   │ Android App│                   │
                                   └────────────┘          ┌────────▼─────────┐
                                                           │ Backend Services │
                                                           │ (API, Rules, DB) │
                                                           └───┬──────────┬───┘
                                                     REST/WSS  │          │ REST/WSS
                                                    ┌──────────▼──┐   ┌───▼────────┐
                                                    │ Web Portal  │   │ Android App│
                                                    └─────────────┘   └────────────┘
```

## 2.2 Product Functions (Summary)

| # | Function |
|---|---|
| F1 | True-RMS measurement of line voltages, per-phase currents and phase sequence |
| F2 | Protection and automatic trip on abnormal conditions |
| F3 | Local control (panel keypad/HMI) and remote control (app, portal) |
| F4 | Scheduling: elapsed-time cyclic timers (no wall-clock calendar scheduling — no RTC) |
| F5 | Remote configuration of all setpoints |
| F6 | Event and fault logging with offline buffering |
| F7 | Cellular telemetry to AWS IoT Core with store-and-forward |
| F8 | Device onboarding, inventory and allocation across the channel |
| F9 | Multi-tenant RBAC across five hierarchy levels |
| F10 | Alerts and notifications (push, SMS, email) |
| F11 | OTA firmware updates via AWS IoT Jobs |
| F12 | Reports: runtime hours, fault history, uptime |

## 2.3 User Classes and Characteristics

| Class | Technical Level | Primary Needs | Access Channel |
|---|---|---|---|
| Superadmin (OEM) | High | Full fleet visibility, provisioning, firmware release, partner management | Web |
| Panel Manufacturer | Medium | Receive device stock, bind devices to panels, allocate to distributors, warranty support | Web |
| Distributor | Medium | Sub-allocate to dealers, regional dashboards | Web + App |
| Dealer / Installer | Low–Medium | Commission devices on site, configure setpoints, hand over to customer | App (primary) + Web |
| End User (Farmer) | Low | Start/stop pump, see status, get alerts, view runtime & energy | App (primary) |
| Support Engineer | High | Diagnostics, logs, remote assist | Web |

## 2.4 Operating Environment

- **Hardware:** Nuvoton M031LD2AE (Cortex-M0, 64 KB flash, 8 KB SRAM), SIMCom A7672X on UART2, 16×2 LCD, 5-button ADC keypad, dual relays, isolated 3-phase V and I sensing. Motor range 3–50 HP.
- **Device:** panel-mounted, ambient −10 °C to +60 °C, up to 95 % RH non-condensing, dusty rural environment, IP20 device inside IP54/IP65 panel. Supply 90–300 V AC (single phase reference) or derived from three-phase.
- **Network:** LTE Cat-1 / Cat-M, frequently marginal rural coverage; system must tolerate long offline periods.
- **Cloud:** AWS (single primary region, e.g. ap-south-1 Mumbai), managed services.
- **Android:** Android 9 (API 28) and above, low-end handsets (2 GB RAM), Hindi/English/regional locales.
- **Web:** Latest two versions of Chrome, Edge, Firefox, Safari; responsive down to 1280 px, usable on tablets.

## 2.5 Design and Implementation Constraints

- Modem is fixed to the **SIMCom A7672**; MQTT with mutual TLS must be feasible over the module's AT command stack, since the M031LD2AE MCU has limited headroom for an MCU-side TLS library.
- The MCU is the **Nuvoton M031LD2AE** already used in production; a change of MCU is out of scope for this release.
- **Current transformers are internal to the panel** and are supplied and wired by the panel manufacturer; CT ratio is a commissioning-time configuration item.
- **SIM cards are partner-supplied M2M SIMs**; the data plan and its cost are borne per the commercial model in §2.7.
- Cellular data plan is low-volume; telemetry payload budget of **≤ 30 MB/device/month** at default reporting rates.
- Device may be powered only when supply is present; behaviour on power loss must be defined (last-gasp message where hardware permits).
- The safety-critical protection loop **shall** execute entirely on the device and **shall not** depend on cloud availability.
- All personal data of Indian end users to be stored in an India region to simplify data-residency posture.

## 2.6 Assumptions and Dependencies

- Each PCD ships with a unique immutable serial number and a factory-provisioned X.509 credential or claim certificate.
- The SIM is a **partner-supplied M2M SIM**, with the APN configurable at manufacture and remotely updatable.
- Panel manufacturers supply the internal CTs and are responsible for wiring correctness; the system reports but cannot correct miswiring or an incorrect CT ratio.
- Push notifications rely on Firebase Cloud Messaging availability.

## 2.7 Commercial Model

The platform is sold as an **annual per-device subscription, tiered by feature**.

| ID | Requirement |
|---|---|
| FR-CLD-070 | Each device **shall** carry a subscription record with a plan tier, start date, expiry date and the paying organisation. |
| FR-CLD-071 | Feature availability (e.g. remote control, historical reports, alert channels, API access, white-labelling) **shall** be gated by plan tier, enforced server-side and reflected in both UIs. |
| FR-CLD-072 | The platform **shall** warn the paying organisation at 60, 30 and 7 days before expiry, and warn the end user at 7 days. |
| FR-CLD-073 | On expiry, the device **shall** move to `SUSPENDED`: cloud telemetry ingestion and remote control are withdrawn, but **all on-device protection, local control and cyclic timers continue to operate unchanged**. Expiry **shall never** disable a protective function or stop a running pump. |
| FR-CLD-074 | A suspended device **shall** be restored to `ACTIVE` within 5 minutes of renewal, with buffered device data ingested where still within the device's retention window. |
| FR-CLD-075 | Plan tiers, prices and renewal terms **shall** be configurable by the Superadmin per panel-manufacturer contract. |

*Plan tier definitions are a commercial decision and are recorded outside this SRS; the requirement here is that the platform enforces whatever tiers are configured.*

---

# 3. System Architecture

## 3.1 Logical Layers

| Layer | Responsibility | Key Technology (indicative) |
|---|---|---|
| Sensing & Actuation | CT/PT measurement, relay/contactor drive, digital inputs | Energy metering AFE, MCU ADC |
| Control & Protection | Real-time protection, timers, state machine, local HMI | MCU firmware (bare-metal/RTOS) |
| Edge Connectivity | UART JSON bridge, MQTT client, TLS, store-and-forward | A7672S OpenSDK app (`swathi_mqtt`) |
| Ingestion | Device authN/authZ, MQTT broker, rules routing | AWS IoT Core, Rules Engine |
| Processing | Telemetry normalisation, alert evaluation, aggregation | Lambda / container services, Kinesis or SQS |
| Storage | Time-series telemetry (30-day window), relational tenancy data, blob/logs | PostgreSQL + TimescaleDB (single store, cost-optimised), S3 |
| Application Services | REST/GraphQL API, WebSocket, auth, notification | API Gateway + service tier |
| Presentation | Web portal, Android app | React/Angular SPA; Kotlin Android |

## 3.2 Deployment View

- **Environments:** Development, Staging, Production — fully isolated AWS accounts.
- **Device fleets:** `dev`, `pilot`, `production` IoT thing groups; OTA jobs are targeted per group with staged rollout.
- **Multi-tenancy model:** shared database, tenant-scoped rows with mandatory tenant/organisation predicates enforced at the data-access layer, plus row-level security in PostgreSQL.

## 3.3 Operating Modes of the Device

| Mode | Description |
|---|---|
| OFF | Output de-energised, protection idle, monitoring active |
| MANUAL | Start/stop by local button or remote command only |
| AUTO-CYCLIC | Repeating ON/OFF timer cycle |
| TRIPPED | Output locked out after a fault; awaiting auto-reset timer or manual reset |
| LOCKOUT | Repeated trips exceeded retry count; manual reset mandatory |
| COMMISSIONING | Elevated logging, relaxed timers, used by dealer during install |
| OTA | Firmware download/apply; pump forced OFF during apply |

---

# 4. Device / Firmware Requirements

## 4.1 Measurement

| ID | Requirement | Priority |
|---|---|---|
| FR-DEV-001 | The PCD **shall** measure true-RMS voltage over a 128-sample window with dynamic DC-offset tracking, and **shall** derive line voltages (`VRY`, `VYB`, `VRB`) by 120° vector sum. Accuracy target ±1 % of reading. *(As built.)* | Must |
| FR-DEV-002 | The PCD **shall** measure true-RMS current per phase (`Cur_R`, `Cur_Y`, `Cur_B`) via internal panel CTs scaled by `CTRatio`, accuracy target ±1.5 % over 10–120 % of the CT range. *(As built.)* | Must |
| FR-DEV-003 | The PCD **shall** determine phase sequence from zero-crossing timing and inhibit start on reversal when `Voltage_PhaseSequenceCheck` is enabled. *(As built.)* | Must |
| FR-DEV-004 | Supply frequency is **not currently computed or reported**, although zero-crossing timing is already available to derive it cheaply. Adding it is optional. Power factor, active power (kW), apparent power (kVA) and cumulative energy (kWh) are **out of scope** (§1.2). | Could |
| FR-DEV-005 | The PCD **shall** compute voltage imbalance and trip when it exceeds `Voltage_Imbalance` for `IMBALANCE_TIMEOUT`. Current imbalance is used for partial cable-open detection. *(As built.)* | Must |
| FR-DEV-006 | Runtime counters (today, cumulative) and the event log **shall** persist across power cycles in non-volatile memory with wear-levelling, retaining at least 10 years of daily writes. | Must |
| FR-DEV-008 | Earth-leakage measurement is **not implemented** and requires additional hardware. Out of scope for this release. | Won't |
| FR-DEV-009 | For single-phase installations, phase-sequence, phase-loss and imbalance protections **shall** be individually disabled by configuration (per FR-DEV-030). No automatic mode-based suppression is required. | Must |

## 4.2 Protection Functions

> **Source of truth:** the values below are taken from `Init_Settings.c` (defaults), `UI_Menu.c` (local edit ranges) and `IoT_Comm.c` (remote edit ranges) at firmware v1.0.367. Where the three disagree, the discrepancy is flagged in Appendix D.

| ID | Function | Firmware field | Default | Range (local UI) | Range (remote) |
|---|---|---|---|---|---|
| FR-DEV-020 | **Over-voltage trip** | `Voltage_Over` | 500 V | 300–600 | 300–600 (`ov`) |
| FR-DEV-021 | **Under-voltage trip — NOT IMPLEMENTED** (see FR-DEV-021a) | `Voltage_Under` | 180 V (dead field) | — | — |
| FR-DEV-022 | **Overload trip** | `Current_OverLoad` | 25 A | derived from HP via `MAX_AMPS_LIMIT[]` | 2–140 A (`ol`) |
| FR-DEV-022a | Overload trip delay — **`OVERLOAD_TIMEOUT` = 3 s is in force**; `Timing_OverLoad` is a dead field | `OVERLOAD_TIMEOUT` | 3 s | compile-time | compile-time |
| FR-DEV-023 | **Dry-run trip current** | `Current_DryRun` | 1 A | 1–50 | 1–50 (`dr`) |
| FR-DEV-023a | Dry-run trip delay | `Timing_DryRun` | 5 s | 0–25 | 0–25 (`dr_t`) |
| FR-DEV-023b | Dry-run auto-reset period | `Timing_DryRunReset` | 0 min | 0–250 | 0–250 (`dr_rst`) |
| FR-DEV-025 | **Phase loss** | fixed threshold | 90 V (`COMPARE_VALUE_VOLT_PHASE_LOSS`) | compile-time | compile-time |
| FR-DEV-026 | **Phase-sequence protection** | `Voltage_PhaseSequenceCheck` | Enabled | 0/1 | 0/1 (`ps`) |
| FR-DEV-027 | **Voltage imbalance trip** | `Voltage_Imbalance` | 35 % | 1–80 | 1–80 (`imb`) |
| FR-DEV-027a | Imbalance confirm window | `IMBALANCE_TIMEOUT` | 10 s | compile-time | compile-time |
| FR-DEV-034 | **Cable open — all phases** | `CABLE_OPEN_CURRENT_THRESHOLD` | 1.3 A | compile-time | compile-time |
| FR-DEV-035 | **Cable open — partial** | `CABLE_OPEN_LOAD_IMBALANCE` | 500 | compile-time | compile-time |
| FR-DEV-036 | **Motor rating (HP)** | `HP_Settings` | index 3 (7.5 HP) | index 1–4 in low-load build, 1–13 otherwise | 1–13 (`hp`) |
| FR-DEV-037 | **CT ratio** | `CTRatio` | 4 (i.e. 4/100) | 1–50 | 1–50 (`ct`) |
| FR-DEV-038 | **PH ratio** | `PHRatio` | 10 % | 0–15 | 0–15 (`ph`) |
| FR-DEV-039 | **Star-delta transition delay** | `Timing_StarDeltaDelay` | 5 s | 1–60 | 1–60 (`sd`) |

**Motor rating → overload limit table** (`MAX_AMPS_LIMIT[]`, index 0–13):

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Max A | 80 | 10 | 15 | 25 | 35 | 40 | 50 | 60 | 70 | 80 | 100 | 110 | 120 | 140 |

Rated motor range is **3 HP – 50 HP**; the `ENABLE_LOW_LOAD_SETTINGS` build restricts the selectable range to indices 1–4 (3–10 HP).

| ID | Requirement |
|---|---|
| FR-DEV-030 | Every protection function that is currently compile-time fixed (phase-loss threshold, overload delay, imbalance window, cable-open thresholds) **shall** be reviewed for promotion to a runtime setting, since the cloud cannot tune what the firmware hard-codes. See Appendix D. |
| FR-DEV-031 | On trip, the PCD **shall** de-energise the output and latch `activeFaultCode`, and **shall** publish a fault message containing the fault code, name and a snapshot of line voltages and phase currents (already implemented — `IoT_SendFault()`). |
| FR-DEV-031a | The fault snapshot **shall** be extended to include the trip timestamp and the elapsed time in the tripped condition. *(New work.)* |
| FR-DEV-021a | **Under-voltage protection shall be implemented.** Verified absent at v1.0.367: `Voltage_Under` is written at defaults and printed in the debug dump, and is read by no protection logic; there is no fault code. Between the 90 V phase-loss threshold and normal voltage there is currently **no under-voltage protection at all**. Since customers are expected to require it, the implementation **shall** add: a settable threshold, a settable delay, a new fault code `FAULT_UNDER_VOLT` (code 10), and `uv` / `uv_t` keys in the layer-A `settings` vocabulary (§6.1). **Confirmed as M031 firmware work.** |
| FR-DEV-021c | **Under-voltage values.** Comparison **shall** be against **line voltages** (`VRY`, `VYB`, `VRB`), consistent with the existing over-voltage check at `Measurement.c:322` — not against phase voltages. Against 415 V nominal: default trip **340 V** (≈ −18 %), range **250–400 V**, default delay **5 s**, range 1–60 s, enabled by default. Detection **shall** follow the over-voltage pattern (flag set in `Measurement.c`, consumed by the state machine) so that start is inhibited while the condition persists, not merely tripped while running. |
| FR-DEV-021b | Under-voltage **shall** be individually enable/disable-able, since some installations on chronically weak feeders may prefer to run rather than trip. The default **shall** be enabled. |
| FR-DEV-022b | `Timing_OverLoad` **shall** either be wired to the overload timer (replacing the compile-time `OVERLOAD_TIMEOUT`) or removed from the settings struct. A field that appears in the settings dump but controls nothing will mislead every future engineer who reads it. Promoting it to the live value is preferred, since it makes the delay remotely tunable. |
| FR-DEV-032 | Dry-run recovery **shall** auto-reset after `Timing_DryRunReset` minutes. Other faults require manual reset. A generalised retry-count-with-lockout policy is **new work** and **shall** be specified before implementation. |

## 4.3 Control & Scheduling

| ID | Requirement |
|---|---|
| FR-DEV-040 | The PCD **shall** accept START and STOP commands from (a) local panel button, (b) remote cloud command, (c) BLE from the mobile app when in range. |
| FR-DEV-041 | Local STOP and any hardware emergency stop **shall** always override remote commands. |
| FR-DEV-042 | The PCD **shall** support a cyclic timer (`CyclicTimer` on/off) with ON duration `Timing_MotOnTime` (1–250 min) and restart interval `Timing_MotRestartTime` (0–250 min). The timer operates on elapsed-minute counters and does not depend on wall-clock time. Cycle progress **shall** persist to flash (`TotalRunTime[1]`) so a reboot does not cause an immediate restart trip. *(As built.)* |
| FR-DEV-043 | The PCD has **no battery-backed RTC**. Day-of-week / time-of-day calendar scheduling is therefore **out of scope for v1.0** and the `AUTO-SCHEDULE` mode is not implemented. |
| FR-DEV-044 | The PCD **shall** maintain a **volatile soft clock** seeded from network time (modem NITZ / `AT+CCLK`, or a cloud `SYNC_TIME` command) within 60 s of registration. The soft clock is used only to timestamp buffered telemetry and events; it is lost on power removal. Records created before the first sync of a power cycle **shall** carry a relative uptime offset and the flag `tsApprox: true`, and the cloud **shall** reconcile them against the reconnection time. |
| FR-DEV-045 | Cyclic timers **shall** continue to operate correctly with no network connectivity, since they depend on elapsed time rather than wall-clock time. |
| FR-DEV-046 | The PCD **shall** support auto-restart on power restore (`AutoRestart` on/off) with an auto-start delay `Timing_AutoStart` (2–600 s). *(As built.)* |
| FR-DEV-046a | A **randomised** component **should** be added to the auto-start delay so that a whole feeder does not restart simultaneously on grid restoration. *(New work — see also NFR-S-002.)* |
| FR-DEV-048 | The PCD **shall** apply a power-on delay (`STATE_POWER_ON_DELAY`) before entering normal operation. *(As built.)* |
| FR-DEV-049 | Remote START **shall** be honoured only when no fault is active; remote START and STOP requests are consumed by the motor state machine via `iot_motor_on_request` / `iot_motor_off_request`. *(As built.)* |
| FR-DEV-047 | The PCD **shall** expose a commissioning mode entered only by physical access (button sequence) or an authenticated dealer session. |

## 4.4 Local HMI

| ID | Requirement |
|---|---|
| FR-DEV-060 | The PCD **shall** display live voltage, current, run state and last fault on a local display. |
| FR-DEV-061 | Fault conditions **shall** be indicated by a distinct LED/buzzer pattern documented in the user manual. |
| FR-DEV-062 | All setpoints **shall** be viewable locally; local editing **may** be restricted by a PIN. |
| FR-DEV-063 | The HMI **shall** display connectivity status: modem registered, MQTT connected, signal strength bars. |

## 4.5 Logging & Buffering

| ID | Requirement |
|---|---|
| FR-DEV-070 | The PCD currently stores **no event history** — only the latched `activeFaultCode` and runtime counters. An on-device event log is **new work** and is constrained by available flash; given GAP-1, buffering **should** live in the module rather than the MCU. |
| FR-DEV-071 | Offline buffering of at least 72 h **shall** be implemented **in the A7672X module application** (FR-CON-024), not on the MCU. The MCU has no buffer beyond its 256-byte UART ring. |
| FR-DEV-072 | Buffered upload **shall** be rate-limited so that backlog delivery does not delay live telemetry by more than 60 s. |
| FR-DEV-073 | The cloud **shall** log every configuration change with its originating actor. The device does not record actor identity and **shall not** be relied on for this. |

## 4.6 Firmware Update

| ID | Requirement |
|---|---|
| FR-DEV-080 | The PCD **shall** support OTA firmware update delivered via AWS IoT Jobs with a signed image. |
| FR-DEV-081 | The bootloader **shall** verify image signature and integrity before activation and **shall** roll back to the previous image if the new image fails to check in within a watchdog window. |
| FR-DEV-082 | OTA **shall not** be applied while the pump output is energised; the device **shall** defer application until the pump is off, or request an operator-confirmed stop. |
| FR-DEV-083 | The PCD **shall** report firmware version, hardware revision and bootloader version in its shadow. |
| FR-DEV-084 | The A7672 modem firmware **should** be updatable via FOTA independently of the MCU application. |

### 4.6.1 OTA Strategy Under the 17 KB Flash Constraint

**Measured: 47 KB of 64 KB used on the M031LD2AE — approximately 17 KB free.**

This rules out the conventional approach. Dual-bank (A/B) OTA needs room for two complete images plus a bootloader; at 47 KB per image that is ~100 KB on a 64 KB part. **A/B OTA with automatic rollback is not achievable on this MCU**, and FR-DEV-081 as written in earlier revisions is unimplementable.

| Option | Assessment |
|---|---|
| **A — No MCU OTA.** Service visits for MCU firmware. | Tolerable today (units are nearby) but cost scales linearly with the fleet, and every fix in the batched MCU release needs a physical visit. A deferral, not a strategy. |
| **B — Small bootloader, single image, no rollback.** Stream the new image over the running application. | **Rejected.** Power loss mid-write bricks the unit, and these installations lose supply routinely — that is the environment the product exists for. The failure mode is a dead panel in a field. |
| **C — Module-staged update (recommended).** The A7672S downloads and verifies the complete image to its own filesystem; a small MCU bootloader then pulls it over UART in chunks and writes MCU flash. | **Viable.** Uses storage the module already has (§5.0.3). The bootloader needs only a UART driver, flash-write routine and CRC/signature check — plausibly 6–8 KB. The image is fully received and verified *before* MCU flash is touched, shrinking the vulnerable window from a whole download to a single write pass. |
| **D — Larger MCU** in a future hardware revision. | The clean long-term answer, but a hardware change with certification and production consequences. Plan it, don't rush it. |

| ID | Requirement |
|---|---|
| FR-DEV-085 | MCU firmware update **shall** use the module-staged pattern (option C). The bridge **shall** download and verify the complete signed image to module flash before any MCU write begins. |
| FR-DEV-086 | The MCU bootloader **shall** verify a signature or CRC over the received image before jumping to it, and **shall** remain resident and recoverable if the application area is invalid — so a failed update leaves a unit re-flashable over UART rather than one that must be opened. |
| FR-DEV-087 | Full rollback **shall not** be claimed as a capability. The mitigation is verify-before-write plus a recoverable bootloader, not a golden image. This limitation **shall** be stated in the service documentation. |
| FR-DEV-088 | **Flash reclamation shall be attempted before the bootloader is sized.** The codebase carries substantial `printf` debug output (settings dumps in `Init_Settings.c`, state and fault tracing in `MotorProtection.c`); format strings plus the `printf` implementation are typically several KB on a Cortex-M0. Compiling debug output out of production builds **should** be the first measure and **shall** be quantified before concluding the bootloader does not fit. |
| FR-DEV-089 | MCU flash and RAM usage **shall** be reported by the build and tracked per release, with a defined reserve below which a release is not cut. At 17 KB free this is no longer a background concern. |
| FR-DEV-090 | A larger-flash MCU **should** be evaluated for the next hardware revision. |

> **Certificates live on the A7672S filesystem, never on the M031.** The MCU flash constraint does not affect certificate storage; the two should not be conflated when scoping.

---

## 4.7 As-Built Firmware Baseline (v1.0.367)

This section records what the shipping firmware already does, so that §5–§11 are understood as *additions* rather than a fresh build.

| Aspect | As built |
|---|---|
| MCU | Nuvoton M031LD2AE, Cortex-M0, **64 KB flash, 8 KB SRAM**, HIRC clock |
| Stack | 2048 bytes (raised in v1.0.365 to fix an overflow caused by the IoT buffers) |
| Measurement | True-RMS over a 128-sample window, dynamic DC-offset tracking, 16-point moving average with fast-response bypass, line voltages by 120° vector sum, phase sequence by zero-crossing timing |
| Reported quantities | Line voltages `VRY`/`VYB`/`VRB`, phase currents `Cur_R`/`Cur_Y`/`Cur_B`, motor state, machine state, fault code, total runtime |
| Protection | Phase loss, phase sequence, over-voltage, voltage imbalance, overload, dry run, cable open (full and partial), Y-phase fault |
| State machine | 8 states (`STATE_POWER_ON_DELAY`, `IDLE`, `AUTOSTART`, `RUNNING_FAULT_CHECK`, `FAULT`, `STOP`, `RESET`, `DRY_RUN_RESET`) |
| Storage | Nuvoton Data Flash; `GlobalSettings_t` struct with a two-field integrity check (`state==1`, `state2==90`); runtime counters written separately |
| HMI | 16×2 LCD, 5-button ADC-sampled keypad, 3 status LEDs, dual relays (motor + aux) |
| Connectivity | **UART2 (PC.0/PC.1) @ 115200 to a SIMCom A7672X**, line-delimited JSON, non-blocking parser, no dynamic allocation |
| Telemetry cadence | 60 s running / 300 s idle; 60 s heartbeat |
| Identity | MCU 96-bit unique ID (`FMC_ReadUID`) as `dev_id`, plus module IMEI |
| Buffers | 256-byte RX ring, 256-byte TX, 256-byte static message buffer |

**Critical architectural consequence:** the MCU does **not** implement MQTT, TLS or any cloud protocol. It exchanges application-level JSON with the A7672S over a serial link, and the **`swathi_mqtt` bridge application (§5.0) is the MQTT/TLS bridge to the cloud**. Everything in §5 and §6 concerning MQTT, certificates, shadows, jobs and buffering is a requirement on the bridge, not on the M031 firmware. This contains the flash/RAM risk raised in v2.0 and is the single most important structural fact in this document.

---

# 5. Connectivity & Cloud Requirements

## 5.0 Bridge Application (A7672S — `swathi_mqtt` V1.0.1)

**Status: exists and works.** Built on the SIMCom OpenSDK (`A156B01V01A7672M6_SDK_250407`), ARM GCC + Ninja, packaged via LZMA + CRC into `SC_A7672S_LASC_8M_CUSTOMER_APP.zip`. This supersedes v3.0's assessment that the module application was unbuilt.

### 5.0.1 As-built architecture

Three OpenSDK tasks plus two message queues:

| Task | Role |
|---|---|
| `MqttBridgeTask` | Network attach → PDP activation → topic setup → main loop: drains the MCU RX queue, reassembles newline-delimited lines, routes to MQTT, emits periodic `net_status` and `ping`, and drives connect/reconnect with exponential backoff (5 s → 120 s) |
| `MqttRecvTask` | Blocks on the MQTT URC queue; on an inbound publish, copies the payload and writes it to the MCU UART |
| `PeriodicReporterTask` | Every 2 s, writes a `{"event":"net_update",...}` JSON line to **both** `SC_UART` and `SC_UART2` |

Connection sequencing is asynchronous and correct: the bridge never blocks on boot, and MQTT connection is deferred until the MCU has registered, because the **MCU's `dev_id` becomes the MQTT client ID**.

### 5.0.2 As-built behaviour

| Aspect | As built |
|---|---|
| Broker mode | Two compile-time modes. `MQTT_MODE_GENERIC` (plain TCP, public HiveMQ) is currently enabled; `MQTT_MODE_AWS_IOT` is a stub. **Decided: generic mode is to be removed entirely — see FR-CON-020.** |
| Identity | Client ID captured dynamically from the MCU's `reg` message (`dev_id`) |
| Topics | `devices/{dev_id}/telemetry`, `devices/{dev_id}/faults`, `devices/{dev_id}/commands` |
| Routing (up) | `reg`, `status`, `ack` → telemetry topic; `fault` → faults topic; `heartbeat`/`pong` consumed internally |
| Routing (down) | Inbound payload on the commands topic is written to the MCU UART **verbatim, unparsed and unvalidated** |
| QoS / session | QoS 1, `clean_session = 1`, keep-alive 60 s |
| Reconnect | Exponential backoff 5 s → 120 s, plus a connection-lost callback |
| Link reporting | `net_status` every 30 s; `ping` to MCU every 60 s; signal from CSQ converted to dBm |
| Diagnostics | `McuDebugPrint()` emits `{"event":"log","msg":"..."}` lines to the MCU UART |
| DNS | Three retries with a hard-coded fallback IP |
| Libraries available | cJSON, zlib, miracl, sm2 are present in the SDK tree, though the bridge uses a hand-rolled parser copied from the MCU |

### 5.0.3 SDK Capability Audit

Read from `config/.config` in the SDK tree. Several capabilities assumed unavailable in earlier revisions are in fact provided by the OpenSDK and are already enabled in this build configuration.

| Capability | Kconfig flag | Consequence for this project |
|---|---|---|
| **Filesystem** | `CONFIG_HAS_DEMO_FS=y`, `CONFIG_HAS_DEMO_FLASH=y`, `CONFIG_HAS_DEMO_EXFLASHMOUNTFS=y` | A writable filesystem exists. The SSL certificate paths in `app_config.h` (`C:/cacert.pem`, …) are filesystem paths, so certificates must already be written by *some* mechanism. **Runtime certificate writing is very likely possible**, which keeps fleet provisioning by claim (§5.2.1) viable and also provides the medium for the offline buffer (GAP-1). |
| **NTP** | `CONFIG_HAS_DEMO_NTP=y` | Network time is available on the module. This is the mechanism for FR-CON-025 / FR-DEV-044 — **GAP-2 is solved with a stock SDK feature**, no invention required. |
| **RTC** | `CONFIG_HAS_DEMO_RTC=y` | The module has a real-time clock. Combined with NTP, calendar scheduling becomes feasible **without adding hardware** — reopening a feature closed in v2.0 (OI-21). Note the module's RTC is only maintained while the module is powered, so the same battery question applies. |
| **BLE** | `CONFIG_HAS_DEMO_BLE=y`, `CONFIG_HAS_DEMO_BT=y` | BLE is available on the A7672S. **OI-3 resolves in favour of offline commissioning by phone** (FR-APP-032), with no additional hardware. Significant for dealers working in no-coverage areas. |
| **GNSS** | `CONFIG_HAS_DEMO_GNSS=y` | Device location without manual GPS capture at commissioning (OI-25). |
| **OTA / app update** | `CONFIG_HAS_DEMO_OTA=y`, `CONFIG_HAS_DEMO_APP_DOWNLOAD=y`, `CONFIG_HAS_DEMO_APP_UPDATE=y` | Bridge FOTA is a stock capability (FR-CON-028). |
| **SSL / MQTTS** | `CONFIG_HAS_DEMO_SSL=y`, `CONFIG_HAS_DEMO_MQTTS=y` | Working reference code for the TLS path exists in the SDK demos — the fastest route to closing OI-29. |
| **cJSON** | `CONFIG_HAS_CJSON=y` | Already enabled in the build; adopting it (FR-CON-022) is a usage change only. |

> **Caveat.** These are Kconfig demo flags, which establish that the SDK *provides* each subsystem, not the exact API surface. `sc_demo/` and `sc_lib/` are excluded by `.gitignore` and were not available for inspection. Each capability **shall** be confirmed against the demo sources in the full SDK before being committed to a plan (OI-30).

### 5.0.35 Build & Release Pipeline (bridge)

The bridge image will not boot unless it is post-processed correctly, and the failure is silent — no debug output, no NETLIGHT, no error. This was diagnosed once already (`CompileInfo_read.me`) and **shall not** be left as tribal knowledge.

The A7672S bootloader expects an **LZMA-compressed** payload in the application partition. A raw binary is quietly discarded and the customer application never starts.

```
customer_app.elf → objcopy → customer_app.bin → lzma → customer_app_lzma.bin
                 → crc_set → customer_app_crc.bin → pack_image.py → …CUSTOMER_APP.zip
```

| ID | Requirement |
|---|---|
| FR-CON-050 | The bridge release pipeline **shall** be a single scripted, version-controlled command producing the flashable package, with no manual steps. Omitting the LZMA stage produces a package that flashes successfully and then does nothing. |
| FR-CON-051 | The pipeline **shall** verify the LZMA magic (`5D 00 00`) at offset 8 of the packaged payload and **shall** fail the build if absent. A five-line check prevents a full re-diagnosis of a silent boot failure. |
| FR-CON-052 | Bridge application size **shall** be reported per build and tracked. The reference baseline is ~100 KB (factory) against ~206 KB (early custom build); free module flash must accommodate the application **plus** certificates **plus** the offline buffer (GAP-1) — see OI-14. |
| FR-CON-053 | The toolchain (Ninja, ARM GCC, `lzma`, `crc_set`, `arelease`) and SDK version **shall** be pinned and documented so a release is reproducible from a tagged commit (NFR-M-002). |

### 5.0.4 Requirements — remaining work on the bridge

| ID | Requirement |
|---|---|
| FR-CON-020 | **AWS IoT Core with mutual TLS is the only supported transport.** The bridge **shall** connect with `sslversion 3` (TLS 1.2), `authmode 2` (mutual authentication) and a regional AWS IoT endpoint (`ap-south-1`). `MQTT_MODE_GENERIC`, `MQTT_BROKER_DOMAIN`, `MQTT_BROKER_PORT` and `MQTT_BROKER_FALLBACK_IP` **shall be deleted from the source tree**, not merely disabled — a mode that cannot be selected cannot be selected by accident. Bench testing against a local broker **shall** use a separate short-lived branch, never a build flag on `main`. |
| FR-CON-021 | The bridge **shall** enrich MCU messages before publishing — adding `ts`, `seq`, `tsApprox` and a schema version — rather than republishing the MCU's JSON unchanged. Without this, the cloud cannot order, deduplicate or reconcile records (GAP-2, GAP-11). |
| FR-CON-022 | The bridge **shall parse and validate** every inbound cloud command before writing anything to the MCU UART, per §6.6. Verbatim forwarding **shall be removed**. The bridge **shall** use cJSON (already vendored in `public_libs/cjson`) rather than the hand-rolled string parser, which cannot handle nested objects. |
| FR-CON-023 | Device certificates **shall** be provisioned by **fleet provisioning by claim** (§5.2.1). The module ships with a shared claim credential and exchanges it for a unique per-device certificate on first connection. The per-device private key **shall** be generated on, or written once into, the module and **shall never** leave it or transit the UART link. |
| FR-CON-024 | The bridge **shall** persist telemetry and fault records to module flash when `g_mqtt_connected` is false, and replay them on reconnect with `buf: true`. `MqttPublish()` currently returns −1 and the record is **discarded** (GAP-1 — still open). |
| FR-CON-025 | The bridge **shall** obtain network time and stamp every record before publication (FR-DEV-044). |
| FR-CON-026 | `net_status` reporting to the MCU is **as built** and satisfies the LCD connectivity indicator. |
| FR-CON-027 | Exponential backoff is **as built**. An LWT **shall** be added so the cloud learns of an ungraceful disconnect (FR-CON-007) — currently there is none, so offline detection rests entirely on missed telemetry. |
| FR-CON-028 | The bridge **shall** support FOTA of its own application image, and **shall** handle AWS IoT Jobs on behalf of the MCU once the MCU bootloader exists. |
| FR-CON-029 | `clean_session` **shall** be reviewed: with `1`, the broker retains no subscription or queued QoS 1 downlink across a disconnect, so a command issued while the device is briefly offline is lost. Persistent sessions would let the broker hold it. |
| FR-CON-030a | The MCU's `dev_id` **shall** equal the AWS IoT thing name and the operational certificate's common name. A device asserting any other `dev_id` **shall** fail to connect, by policy (§6.7). The bridge **shall** emit a distinct diagnostic for identity mismatch so it is not mistaken for a network fault in the field. |
| FR-CON-031a | The bridge **shall** rate-limit or suppress `McuDebugPrint` and `net_update` output in production builds (GAP-23). |

## 5.1 Modem & Link

| ID | Requirement |
|---|---|
| FR-CON-001 | The PCD **shall** use the SIMCom **A7672** module (LTE Cat-1 with 2G fallback), operating on a **partner-supplied M2M SIM** with a pre-configured APN. |
| FR-CON-002 | The MCU↔module link **shall** be UART2 (PC.0 RXD / PC.1 TXD) at 115200 8N1 with newline-delimited JSON. *(As built.)* |
| FR-CON-002a | The MCU **shall** detect a non-responsive module (no `net_status` or `ping` within a defined window) and **shall** be able to hardware-reset it. *(New work — currently the MCU only retries registration.)* |
| FR-CON-002b | The 256-byte RX ring **shall** be verified as sufficient for the largest command the module will send, or the module **shall** be required to fragment. A dropped byte currently corrupts a whole message with no retransmission. *(New work.)* |
| FR-CON-003 | The PCD **shall** report RSSI/RSRP, network operator, cell ID, IMEI and ICCID in periodic diagnostics. |
| FR-CON-004 | The PCD **shall** re-establish MQTT with exponential backoff (base 5 s, cap 15 min, ±20 % jitter). |
| FR-CON-005 | The link **shall** use MQTT 3.1.1 over TLS 1.2 or later with mutual X.509 authentication. |
| FR-CON-006 | Telemetry interval **shall** be 60 s when the motor is running and 300 s when idle (`IOT_STATUS_INTERVAL_RUN_MS` / `_IDLE_MS`). These are currently **compile-time constants** and **shall** be promoted to runtime settings so the cloud can trade data cost against resolution. Fault messages are sent immediately. |
| FR-CON-007 | MQTT keep-alive **shall** be configurable (default 120 s) with LWT publishing an offline status to the device status topic. |

## 5.2 Provisioning

| ID | Requirement |
|---|---|
| FR-CLD-010 | Devices **shall** be provisioned using AWS IoT Fleet Provisioning by claim: a shared claim certificate at manufacture is exchanged for a unique per-device certificate on first connection. |
| FR-CLD-011 | The provisioning hook **shall** validate the serial number against the manufacturing inventory and reject unknown or already-claimed serials. |
| FR-CLD-012 | Each device **shall** be created as an IoT Thing with attributes: serial, model, hwRev, manufacturedAt, and placed into the appropriate thing group. |
| FR-CLD-013 | Certificates **shall** be revocable individually; a revoked device **shall** be denied connection within 5 minutes. |
| FR-CLD-014 | An IoT policy **shall** restrict each device to topics containing its own device ID only (policy variables on the client ID / thing name). |

### 5.2.1 Fleet Provisioning by Claim — Design

**Decision: fleet provisioning by claim.** Rationale: panel manufacturers assemble panels at their own sites, so any per-unit manual certificate step would leave OEM control at exactly the point it is needed. A claim credential lets a partner power up a panel and have it self-provision, while the OEM retains the authority to refuse an unknown serial.

**Flow**

| Step | Actor | Action |
|---|---|---|
| 1 | Manufacture | Module is flashed with the bridge image and the **shared claim certificate** + key |
| 2 | Manufacture | MCU serial (96-bit UID) is recorded in the OEM manufacturing inventory against the panel and batch |
| 3 | First power-on | Bridge connects to AWS IoT using the **claim credential only** |
| 4 | Device | Publishes a `CreateCertificateFromCsr` / `RegisterThing` request carrying its `dev_id` (MCU UID) as the template parameter |
| 5 | Cloud | A **pre-provisioning Lambda hook** validates the serial against inventory: known, not already provisioned, not marked RMA or stolen |
| 6 | Cloud | On success, issues a unique per-device certificate, creates the Thing named `dev_id`, attaches the operational policy, and places it in the correct Thing group |
| 7 | Device | Persists the operational certificate to module flash and **reconnects using it**; the claim credential is never used again |
| 8 | Cloud | Marks the device `MANUFACTURED → IN_STOCK` and records the provisioning event in the audit log |

| ID | Requirement |
|---|---|
| FR-CLD-015 | The pre-provisioning hook **shall** reject any serial not present in the manufacturing inventory, any serial already provisioned, and any device whose lifecycle state forbids provisioning (`RETIRED`, `RMA`). Rejections **shall** be logged with the claiming IP and timestamp and **shall** raise an alert — repeated rejections indicate either a process failure or an attempt to forge devices. |
| FR-CLD-016 | The claim certificate's policy **shall** permit **only** the provisioning topics (`$aws/certificates/create-from-csr/*`, `$aws/provisioning-templates/*`) — never telemetry, command or shadow topics. A stolen claim credential must not be able to publish as, or command, any device. |
| FR-CLD-017 | The claim certificate **shall** be rotatable without a firmware rebuild where the SDK permits, and **shall** be rotated on a defined schedule and immediately on suspected compromise. Rotation **shall not** affect already-provisioned devices, since they no longer use it. |
| FR-CLD-018 | Provisioning **shall** be rate-limited per claim credential to bound the damage from a leak. |
| FR-CLD-019 | The bridge **shall** treat provisioning as idempotent and resumable: a power cut between certificate issue and successful persistence **shall not** leave the device unable to provision again. This is the most likely field failure in the whole flow and **shall** have an explicit test (AC-20). |
| FR-CLD-019a | Re-provisioning of an already-provisioned device (board replacement, certificate corruption) **shall** be possible via an explicit Superadmin action that revokes the old certificate and re-arms the serial, and **shall** be audited. |

**Residual risk, stated plainly:** the claim credential is a shared secret present on every module. Extracting it from one module allows an attacker to attempt provisioning — but the pre-provisioning hook (FR-CLD-015) is what actually gates it, and it will only issue certificates for serials the OEM manufactured and has not yet seen. The security of this design rests on the inventory check, not on the claim credential's secrecy. That is the correct place for it to rest.

## 5.3 Ingestion & Processing

| ID | Requirement |
|---|---|
| FR-CLD-020 | An IoT Rule **shall** route telemetry to the time-series store and to the stream processor for alert evaluation. |
| FR-CLD-021 | Device state **shall** be maintained in the AWS IoT Device Shadow with `desired` (configuration set by users) and `reported` (acknowledged by device) sections. |
| FR-CLD-022 | The backend **shall** treat a configuration change as *pending* until the device reports the matching value, and **shall** surface pending/applied/failed state in the UI. |
| FR-CLD-023 | Pending configuration older than 24 h without device acknowledgement **shall** be flagged and optionally expired. |
| FR-CLD-024 | The backend **shall** detect device offline within 3 missed reporting intervals and raise a connectivity alert. |
| FR-CLD-025 | Raw telemetry **shall** be retained for **30 days only** and compacted into daily summaries before deletion (see §12.7). This is a deliberate cost constraint. |
| FR-CLD-026 | Duplicate messages (same device, same timestamp, same sequence number) **shall** be idempotently discarded. |

---

# 6. Protocol Design

The protocol has **two distinct layers**. Conflating them was the main error in earlier drafts of this document.

```
   MCU (M031)  ──── layer A: line-delimited JSON over UART2 ────▶  A7672X module app
                                                                        │
                                                    layer B: MQTT/TLS over LTE
                                                                        ▼
                                                                 AWS IoT Core
```

Layer A is **already implemented and in the field**. Layer B is new work. Changes to layer A are expensive (they touch shipping firmware on 300+ units); changes to layer B are cheap. **Design rule: absorb complexity into layer B wherever possible.**

## 6.1 Layer A — MCU ↔ Module (as built)

Newline-delimited JSON, 115200 8N1, no acknowledgement or retransmission at the transport level.

### MCU → Module

| `cmd` | Payload | When |
|---|---|---|
| `reg` | `{"cmd":"reg","dev_id":"<96-bit MCU UID hex>","fw":"1.0.367"}` | On boot / network up / retry |
| `status` | `{"cmd":"status","vl":[415,412,410],"i":[12,11,12],"mot":1,"st":2,"flt":0,"rt":1234,"ol":25}` | Every 60 s running / 300 s idle |
| `fault` | `{"cmd":"fault","code":5,"desc":"DryRun","vl":[415,0,410],"i":[2,0,2]}` | Immediately on trip |
| `ack` | `{"cmd":"ack","ref":"motor_cmd","ok":1}` | After a command is applied |
| `pong` | `{"cmd":"pong"}` | Reply to module `ping` |
| `heartbeat` | `{"cmd":"heartbeat"}` | Every 60 s |

Field semantics: `vl` = line voltages RY/YB/RB (V, integer); `i` = phase currents R/Y/B (A, integer); `mot` = motor relay state; `st` = state-machine state (§4.7); `flt` = latched fault code; `rt` = total runtime minutes; `ol` = current overload setpoint.

### Module → MCU

| `cmd` | Payload | Effect |
|---|---|---|
| `net_status` | `{"cmd":"net_status","conn":1,"sig":-78}` | Sets link state and signal strength; triggers registration on first connect |
| `reg_ack` | `{"cmd":"reg_ack","ok":1}` | Moves the MCU to `IOT_STATE_CONNECTED` |
| `motor_cmd` | `{"cmd":"motor_cmd","action":"on"\|"off"}` | Requests start/stop; start is refused if a fault is active |
| `settings` | `{"cmd":"settings","hp":7,"ov":480,"ol":22,"dr":5,...}` | Updates accepted fields, writes to flash, acks |
| `ping` | `{"cmd":"ping"}` | MCU replies `pong` |

### Accepted `settings` fields and ranges (authoritative — from `IoT_Comm.c`)

| Key | Setting | Range |
|---|---|---|
| `hp` | Motor rating index | 1–13 |
| `as` | Auto-start delay (s) | 2–600 |
| `sd` | Star-delta delay (s) | 1–60 |
| `ov` | Over-voltage trip (V) | 300–600 |
| `dr` | Dry-run trip current (A) | 1–50 |
| `dr_t` | Dry-run trip delay (s) | 0–25 |
| `dr_rst` | Dry-run restart delay (min) | 0–250 |
| `imb` | Imbalance trip (%) | 1–80 |
| `ar` | Auto restart | 0/1 |
| `cyc` | Cyclic timer | 0/1 |
| `on_t` | Motor ON time (min) | 1–250 |
| `rst_t` | Motor restart time (min) | 0–250 |
| `ct` | CT ratio | 1–50 |
| `ph` | PH ratio | 0–15 |
| `ps` | Phase-sequence check | 0/1 |
| `ol` | Overload trip (A) | 2–140 |
| `uv` | Under-voltage trip (V) | 250–400 *(new — FR-DEV-021a)* |
| `uv_t` | Under-voltage delay (s) | 1–60 *(new)* |

A `settings` message is applied **field by field**; out-of-range fields are silently ignored and the ack reports only whether *any* field changed.

| ID | Requirement |
|---|---|
| FR-CON-030 | Per-field silent rejection **shall** be replaced by an ack that enumerates accepted and rejected keys, so the cloud can show a truthful *applied* state rather than assuming success. *(New work — layer A change.)* |
| FR-CON-031 | The MCU **shall** echo its full current settings on request (`get_settings`), so the cloud can reconcile rather than assume. Without this, the shadow's `reported` state cannot be trusted. *(New work — layer A change, required for FR-CLD-022.)* |
| FR-CON-032 | Every `settings` write currently commits to flash immediately. A rate limit **shall** be enforced to protect flash endurance against a misbehaving or chatty cloud. *(New work.)* |

## 6.2 Fault Codes (authoritative — from `MotorProtection.h`)

| Code | Name | Severity | Meaning |
|---|---|---|---|
| 0 | `None` | — | No fault |
| 1 | `YPhase` | Critical | Y-phase fault |
| 2 | `PhaseLoss` | Critical | Phase loss / single phasing |
| 3 | `OverVolt` | Medium | Over-voltage |
| 4 | `PhaseSeq` | Critical | Phase sequence wrong |
| 5 | `DryRun` | High | Dry run / underload |
| 6 | `CableAll` | Critical | Cable open, all phases |
| 7 | `CablePart` | Critical | Cable open, partial |
| 8 | `OverLoad` | High | Overload |
| 9 | `Imbalance` | Medium | Voltage imbalance |
| 10 | `UnderVolt` | Medium | Under-voltage *(new — FR-DEV-021a)* |

**FR-CON-033** — This list is the single source of truth for fault codes across firmware, module, cloud, portal and app. Severity is assigned by the cloud, not the device. Adding a code **shall** be a coordinated release across all five.

**FR-CON-034** — There is **no under-voltage fault code**, although `Voltage_Under` exists in the settings struct (default 180 V). Either the protection is unimplemented or it reports under another code. This **shall** be resolved before the cloud exposes an under-voltage setting to users (Appendix D, GAP-3).

## 6.3 Layer B — Module ↔ AWS IoT Core

`{dev_id}` is the identifier the MCU supplies in its `reg` message; it becomes the MQTT client ID.

**As built** (`app_config.h`):

| Direction | Topic | QoS | Carries |
|---|---|---|---|
| D→C | `devices/{dev_id}/telemetry` | 1 | `reg`, `status`, `ack` — republished verbatim |
| D→C | `devices/{dev_id}/faults` | 1 | `fault` — republished verbatim |
| C→D | `devices/{dev_id}/commands` | 1 | Forwarded to the MCU UART verbatim |

**Target.** The additions below are required for shadows, jobs, offline detection and diagnostics. Topic strings are three `#define`s in `app_config.h`, so this is a cheap change and **should** be made before the fleet grows.

| Direction | Topic | QoS | Purpose |
|---|---|---|---|
| D→C | `devices/{dev_id}/telemetry` | 1 | Enriched `status` |
| D→C | `devices/{dev_id}/faults` | 1 | Enriched `fault` |
| D→C | `devices/{dev_id}/status` | 1, retained | Online/offline + **LWT** *(new)* |
| D→C | `devices/{dev_id}/diag` | 0 | CSQ/dBm, CGREG, CREG, operator, IMEI *(new — currently only printed to UART)* |
| C→D | `devices/{dev_id}/commands` | 1 | Validated commands |
| both | `$aws/things/{dev_id}/shadow/#` | 1 | Configuration state *(new)* |
| both | `$aws/things/{dev_id}/jobs/#` | 1 | OTA *(new)* |

**FR-CON-039** — An AWS IoT policy using client-ID policy variables **shall** restrict each device to its own `devices/{dev_id}/*` subtree. This is compatible with the dynamic client ID as built, provided `dev_id` equals the registered thing name.

### Telemetry (layer B)

```json
{
  "v": 1,
  "id": "001A2B3C4D5E6F708192A3B4",
  "ts": 1766000000,
  "seq": 48213,
  "tsApprox": false,
  "buf": false,
  "st": { "mot": 1, "state": 2, "fault": 0 },
  "el": {
    "vl": [415, 412, 410],
    "i":  [12, 11, 12]
  },
  "rt": { "totalMin": 1234 },
  "cfg": { "ol": 25 },
  "net": { "rssi": -78, "op": "40410", "tech": "LTE" }
}
```

> **Not yet implemented.** The bridge republishes the MCU's `status` JSON **unchanged** — no `id`, `ts`, `seq`, `tsApprox`, `buf` or `net` fields are added. The schema above is the target for FR-CON-021. Cloud ingestion must either wait for it or tolerate the raw MCU format initially.

### Event (layer B)

```json
{
  "v": 1,
  "id": "001A2B3C4D5E6F708192A3B4",
  "ts": 1766001234,
  "seq": 48219,
  "type": "TRIP",
  "code": 5,
  "name": "DryRun",
  "snapshot": { "vl": [415, 0, 410], "i": [2, 0, 2] }
}
```

### Command (layer B)

```json
{ "v": 1, "cid": "8f3c1b6e-...", "ts": 1766001300,
  "actor": "usr_91823", "cmd": "START", "expiry": 1766001360 }
```

| Cloud command | Maps to layer A |
|---|---|
| `START` | `{"cmd":"motor_cmd","action":"on"}` |
| `STOP` | `{"cmd":"motor_cmd","action":"off"}` |
| `SET_CONFIG` | `{"cmd":"settings",...}` filtered to accepted keys and ranges |
| `PING` | `{"cmd":"ping"}` |
| `GET_CONFIG` | `{"cmd":"get_settings"}` *(requires FR-CON-031)* |

**FR-CON-035** — Commands carry a UUID `cid` and an `expiry`. The **bridge** enforces expiry and generates the `REJECTED — expired` ack; the MCU has no clock for this. The bridge **shall** correlate the MCU's `ack` back to the originating `cid`, since layer A's ack carries only a `ref` string. *(Not implemented — the bridge forwards payloads without inspecting them.)*

**FR-CON-036** — There is currently **no fault-reset command**. Resetting a latched fault remotely is not possible. This **shall** be added to layer A and mapped to a `RESET_FAULT` cloud command (Appendix D, GAP-4).

## 6.4 Shadow Document

The `desired` section uses the layer-A key names so that translation is a filter rather than a mapping:

```json
{
  "state": {
    "desired": { "cfg": {
      "hp": 3, "ol": 25, "ov": 500,
      "dr": 1, "dr_t": 5, "dr_rst": 0,
      "imb": 35, "ps": 1, "ar": 0,
      "cyc": 0, "on_t": 0, "rst_t": 0,
      "as": 10, "sd": 5, "ct": 4, "ph": 10
    }},
    "reported": { "cfg": { "...": "from get_settings" },
                  "fw": "1.0.367", "modApp": "0.1.0" }
  }
}
```

**FR-CON-037** — Until FR-CON-031 (`get_settings`) exists, `reported` can only be populated from the `ol` field echoed in each `status` message plus optimistic assumption. The UI **shall not** claim a setting is *applied* on that basis; it **shall** show *sent, unconfirmed*.

## 6.5 Payload Budget

Layer A `status` is ~110 bytes; layer B telemetry ~250 bytes. At 60 s running / 300 s idle with a realistic duty cycle, this is well inside the 30 MB/device/month budget (NFR). Adding TLS handshake overhead on frequent reconnects is the dominant cost in poor coverage — **FR-CON-038**: the module **shall** use TLS session resumption where the stack supports it.

## 6.6 Inbound Command Validation (bridge)

**Rule: the bridge is the trust boundary.** Nothing reaches the MCU UART that has not been parsed, whitelisted and range-checked. The MCU's own checks are defence in depth, not the primary control — note that the MCU applies `motor_cmd` unconditionally, so `motor_cmd` is protected *only* here.

| ID | Requirement |
|---|---|
| FR-CON-040 | The bridge **shall** parse each inbound payload with cJSON and **shall** discard it if parsing fails, if the root is not an object, or if it exceeds `MQTT_PAYLOAD_BUF_SIZE`. |
| FR-CON-041 | The bridge **shall** accept only `cmd` values in the vocabulary below. Any other value **shall** be discarded and counted. |
| FR-CON-042 | For `motor_cmd`, `action` **shall** be exactly `"on"` or `"off"`. No other value, no absent field, no numeric equivalent. |
| FR-CON-043 | For `settings`, **every** key **shall** be in the layer-A table (§6.1) and **every** value **shall** be re-range-checked in the bridge against the same bounds the MCU enforces. Unknown keys **shall** cause the whole message to be rejected, not silently dropped — an unknown key means the cloud and the device disagree about schema, which is worth surfacing. |
| FR-CON-044 | The bridge **shall** re-serialise the validated command from its parsed form rather than forwarding the original bytes. This guarantees that only well-formed, known-shape JSON reaches the MCU, and eliminates smuggling via duplicate keys, trailing data or comments. |
| FR-CON-045 | Rejected commands **shall** be counted by reason and published on the `diag` topic. A device rejecting commands is either misconfigured or under attack, and neither should be silent. |
| FR-CON-046 | Validation limits **shall** be defined in one header shared conceptually with the MCU's table, and any change **shall** be made in both places in the same release (§6.1, OI-26). |

**Accepted vocabulary**

| `cmd` | Validation |
|---|---|
| `motor_cmd` | `action` ∈ {`on`, `off`} |
| `settings` | All keys in the §6.1 table; all values in range |
| `ping` | No arguments permitted |
| `get_settings` | No arguments permitted *(pending FR-CON-031)* |
| `reset_fault` | No arguments permitted *(pending GAP-4)* |

Everything else — including anything resembling a debug, shell, AT or firmware command — is rejected.

## 6.7 Identity Binding

| ID | Requirement |
|---|---|
| FR-SEC-030 | The MCU `dev_id`, the AWS IoT thing name and the operational certificate's common name **shall** be the same value. |
| FR-SEC-031 | The IoT policy **shall** use client-ID policy variables so that a device may connect only as itself and publish or subscribe only within its own subtree:<br>`iot:Connect` on `arn:...:client/${iot:ClientId}`<br>`iot:Publish` on `arn:...:topic/devices/${iot:ClientId}/*`<br>`iot:Subscribe` on `arn:...:topicfilter/devices/${iot:ClientId}/commands` |
| FR-SEC-032 | The cloud **shall** additionally reject any message whose in-payload `dev_id` disagrees with the authenticated connection's client ID. Policy variables stop a device impersonating another at the transport layer; this stops a compromised-but-valid device forging payloads at the application layer. |
| FR-SEC-033 | With FR-SEC-031 in force, the MCU's unauthenticated assertion of `dev_id` over UART is **no longer security-relevant**: a wrong value simply fails to connect. GAP-13 and GAP-27 are closed by this control rather than by hardening the serial link. |
| FR-SEC-034 | Certificate revocation **shall** take effect within 5 minutes (FR-CLD-013) and **shall** be exercised as part of the RMA and stolen-device workflows, not only documented. |

---

# 7. User Hierarchy & RBAC

## 7.1 Hierarchy

```
Superadmin (OEM)
   └── Panel Manufacturer  (tenant root)
          └── Distributor
                 └── Dealer L1
                        └── Dealer L2
                               └── Dealer L3
                                      └── Dealer L4
                                             └── Dealer L5
                                                    └── Dealer L6
                                                           └── End User  ──▶ Device(s)
```

The dealer tier is **recursive**: a dealer may have sub-dealers beneath it, to a maximum of **6 nested dealer levels** under any one distributor. Deeper levels are rejected.

| ID | Requirement |
|---|---|
| FR-SEC-000a | The organisation tree **shall** support a recursive `DEALER` node type nested up to **6 levels** below a `DISTRIBUTOR`. An attempt to create a 7th level **shall** be rejected with an explicit error naming the depth limit. |
| FR-SEC-000b | Each organisation record **shall** store a materialised path and a computed `depth` so that sub-tree queries and the depth check are O(1) at write time and index-assisted at read time. |
| FR-SEC-000c | All dealer levels **shall** share the same permission set (§7.2, "Dealer" column); depth confers no additional privilege, only a narrower sub-tree. |
| FR-SEC-000d | Moving a dealer sub-tree to a new parent **shall** be permitted only if the resulting maximum depth of the moved sub-tree remains ≤ 6, and **shall** be atomic across all descendants and their devices. |
| FR-SEC-000e | The UI **shall** render the full chain of custody for any device (Superadmin → … → end user), however deep, in a breadcrumb form. |

Rules:

- **FR-SEC-001** — Every organisation node **shall** have exactly one parent (except Superadmin) forming a strict tree; an entity **shall** only see data at or below its own node.
- **FR-SEC-002** — A device **shall** at any time be owned by exactly one node in the tree; ownership moves down the tree as it is sold/allocated, and can be moved back up only by an actor at or above the current owner.
- **FR-SEC-003** — Every allocation, re-allocation and de-allocation **shall** be recorded in an immutable audit trail with actor, timestamp, source node and destination node.
- **FR-SEC-004** — Each organisation **may** define internal sub-roles (Owner, Manager, Technician, Viewer) scoped within its own node.
- **FR-SEC-005** — An end user **may** be granted access to a device by the dealer or by the current owner sharing an invite; an end user **may** hold devices sourced from more than one dealer. Each device retains its own servicing dealer; the app **shall** show the correct dealer contact per device, not a single account-level contact.
- **FR-SEC-005a** — **Support routing for multi-dealer end users:** where one end user holds devices from two or more dealers, first-line support for each device remains with that device's own dealer. If those dealers share a **common distributor** (at any dealer depth), that distributor **shall** be the escalation and coordination point and **shall** be able to see all of that user's devices within its own sub-tree in a single consolidated view. If the dealers do not share a common ancestor below the panel-manufacturer level, escalation **shall** route to the nearest common ancestor organisation, and no consolidated cross-tenant view **shall** be created — the user simply sees their devices grouped by servicing dealer in the app.
- **FR-SEC-006** — Impersonation ("view as") by Superadmin or support **shall** be explicitly logged, time-boxed and visibly banner-marked in the UI.

## 7.2 Permission Matrix

Legend: **F** = full, **R** = read only, **S** = scoped to own sub-tree, **—** = no access, **A** = with approval/audit.

| Capability | Superadmin | Panel Mfr | Distributor | Dealer | End User |
|---|---|---|---|---|---|
| Create/import device inventory | F | — | — | — | — |
| View global fleet | F | — | — | — | — |
| View own sub-tree devices | F | S | S | S | own only |
| Allocate device to child node | F | S | S | S (to end user) | — |
| Return device to parent node | F | S | S | S | — |
| Create child organisation | F | S | S | — | — |
| Create users within own org | F | S | S | S | — |
| Invite end user | F | S | S | S | — |
| View live telemetry | F | S | S | S | own only |
| View historical reports | F | S | S | S | own only |
| Start / Stop pump | A | A | A | S | own only |
| Reset fault | F | S | S | S | own only |
| Edit protection setpoints | F | S | S | S | limited¹ |
| Edit FLC / motor rating | F | S | S | S | — |
| Edit cyclic timers & schedules | F | S | S | S | own only |
| Factory reset device | F | A | — | — | — |
| Clear runtime counter | F | — | — | — | — |
| Trigger OTA update | F | A² | — | — | — |
| Manage firmware releases | F | — | — | — | — |
| Manage alert rules | F | S | S | S | own only |
| Configure notification channels | F | S | S | S | own only |
| View audit log | F | S | S | R (own actions) | R (own device) |
| Manage branding / white-label | F | S | — | — | — |
| Billing / subscription mgmt | F | S | R | R | R |
| Renew device subscription | F | S | S | S | — |
| Create sub-dealer (to depth 6) | F | S | S | S | — |
| API key issuance | F | S | — | — | — |
| Bulk configuration templates | F | S | S | R | — |

¹ End users may adjust only a whitelisted subset (e.g. cyclic timers, dry-run delay) within a range fenced by the dealer.
² Panel manufacturers may schedule OTA only for their own sub-tree and only with firmware approved by the Superadmin.

## 7.3 Device Lifecycle States

| State | Meaning | Who can change |
|---|---|---|
| `MANUFACTURED` | In OEM inventory, not yet connected | Superadmin |
| `ALLOCATED` | Assigned to a partner node | Current owner |
| `IN_STOCK` | Received by partner, unbound | Owner |
| `COMMISSIONED` | Installed on a site, bound to a pump profile | Dealer |
| `ACTIVE` | Handed to end user, in service | Dealer/End user |
| `SUSPENDED` | Cloud service paused (subscription expired, dispute). On-device protection and local control continue (FR-CLD-073). | Superadmin / Panel Mfr |
| `RMA` | Returned for service | Any owner, flows up |
| `RETIRED` | Permanently decommissioned; certificate revoked | Superadmin |

**FR-SEC-010** — Allowed transitions **shall** be enforced server-side as a state machine; illegal transitions **shall** be rejected with an explicit error.

---

# 8. Web Portal Requirements

## 8.1 Common

| ID | Requirement |
|---|---|
| FR-WEB-001 | The portal **shall** authenticate users with email/phone and password plus optional TOTP MFA; MFA **shall** be mandatory for Superadmin and panel-manufacturer Owner roles. |
| FR-WEB-002 | The portal **shall** present a navigation and dataset scoped automatically to the signed-in user's node. |
| FR-WEB-003 | The portal **shall** support English and Hindi at launch, with a string-externalised i18n framework for further locales. |
| FR-WEB-004 | All list views **shall** support server-side search, filter, sort, pagination and CSV/XLSX export. |
| FR-WEB-005 | Live telemetry views **shall** update via WebSocket without page refresh, with a visible "last updated" and stale-data indicator. |

## 8.2 Superadmin Functions

| ID | Requirement |
|---|---|
| FR-WEB-010 | Bulk-import device inventory from CSV (serial, model, hwRev, batch, manufacture date) with validation and an error report. |
| FR-WEB-011 | Generate and download provisioning artefacts / claim credentials per batch. |
| FR-WEB-012 | Create, edit, suspend and delete panel-manufacturer organisations, including contract details and device quotas. |
| FR-WEB-013 | Allocate devices in bulk to a panel manufacturer by serial range, batch ID or CSV. |
| FR-WEB-014 | Global fleet dashboard: total devices by state, online/offline counts, active faults by type, connectivity heat map, top faulting devices, firmware version distribution. |
| FR-WEB-015 | Firmware release management: upload signed image, set target hardware revisions and minimum current version, define staged rollout (canary % → full), monitor job success/failure, abort a rollout. |
| FR-WEB-016 | Global audit log with filtering by actor, org, device, action type and date range. |
| FR-WEB-017 | System health view: ingestion lag, message error rate, provisioning failures, notification delivery rates. |
| FR-WEB-018 | Support console: open any device, view raw last N messages, shadow delta, connection history, and issue diagnostic commands. |

## 8.3 Channel Partner Functions (Panel Manufacturer / Distributor / Dealer)

| ID | Requirement |
|---|---|
| FR-WEB-030 | View received device stock and allocate to child nodes individually or in bulk. Dealers **shall** additionally be able to allocate to their own sub-dealers, subject to the 6-level depth limit (FR-SEC-000a). |
| FR-WEB-031 | Bind a device to a *panel record* (panel serial, motor rating, starter type, pump make/model, HP) — the panel manufacturer's assembly step. |
| FR-WEB-032 | Define reusable **configuration templates** per motor rating/pump type and apply them to one or many devices. |
| FR-WEB-033 | Dashboard scoped to the partner's sub-tree (all dealer depths beneath it): devices by state, faults today, offline devices, runtime hours, warranty and subscription expiring soon. |
| FR-WEB-034 | Warranty and RMA workflow: raise RMA, track status, record replacement device swap preserving the site's history. |
| FR-WEB-035 | Manage own users and sub-roles; invite child organisations by email/phone with an onboarding link. |
| FR-WEB-036 | White-label branding for panel manufacturers: logo, colour, sender name on notifications, custom subdomain. |
| FR-WEB-037 | Service reports per device: fault frequency, MTBF, runtime hours and uptime, to support field service planning. |

## 8.4 Device Detail View

**FR-WEB-050** — The device detail page **shall** provide the following tabs:

| Tab | Contents |
|---|---|
| Overview | Live state, run/stop control, per-phase V/I, frequency, today's and cumulative runtime, active faults, connectivity |
| Trends | Time-series charts for per-phase voltage, per-phase current and frequency over the retained 30-day window, with zoom and CSV export |
| Configuration | All setpoints grouped by protection/timers/reporting, with pending vs applied state, change history and template apply |
| Events | Filterable event and fault log with snapshot expansion |
| Schedule | Cyclic timer editor (ON/OFF durations, cycle limit) with a visual duty-cycle preview |
| Ownership | Current owner, allocation history, site & customer details, warranty status |
| Diagnostics | Firmware/hardware versions, signal history, shadow document, raw message viewer, OTA history |

## 8.5 Alerts & Notifications

| ID | Requirement |
|---|---|
| FR-WEB-060 | Users **shall** be able to subscribe to alert types per device or per device group. |
| FR-WEB-061 | Channels **shall** include in-app, push (via app), email and SMS; SMS **should** be restricted to critical severities to control cost. |
| FR-WEB-062 | The system **shall** deduplicate repeated identical alerts within a configurable window (default 15 min) and **shall** send a single digest for storm conditions. |
| FR-WEB-063 | Alerts **shall** support acknowledgement, assignment and resolution notes for partner support workflows. |
| FR-WEB-064 | Notification templates **shall** be localisable and white-labelled per panel manufacturer. |

---

# 9. Android Application Requirements

## 9.1 General

| ID | Requirement |
|---|---|
| FR-APP-001 | The app **shall** support Android 9 (API 28) and above and **shall** be usable on a 720p display with 2 GB RAM. |
| FR-APP-002 | The app **shall** authenticate by mobile number with OTP, and **shall** persist a secure session with refresh tokens stored in the Android Keystore-backed encrypted storage. |
| FR-APP-003 | The app UI **shall** be available in English and Hindi at launch, with the architecture supporting additional regional languages. |
| FR-APP-004 | The app **shall** adapt its feature set to the signed-in user's role, hiding rather than merely disabling unauthorised actions. |
| FR-APP-005 | The app **shall** function in a degraded read-only mode without network, showing the last known device state with a clear timestamp and "offline" badge. |

## 9.2 End-User Features

| ID | Requirement |
|---|---|
| FR-APP-010 | Home screen listing all pumps the user has access to, each showing name, running state, current draw and connectivity, refreshed live. |
| FR-APP-011 | One-tap START/STOP with a confirmation step, showing command progress: sent → delivered → acknowledged → applied, with timeout handling and a clear failure reason. |
| FR-APP-012 | Live detail screen with per-phase voltage and current, supply frequency, phase-sequence indicator and today's and cumulative runtime. |
| FR-APP-013 | Fault display in plain language with a probable cause and a suggested corrective action (e.g. "Dry run — the borewell may have no water. Wait for recovery or call your dealer."). |
| FR-APP-014 | Fault reset from the app where the user's role permits. |
| FR-APP-015 | Cyclic timer editor (ON duration, OFF duration, cycle limit) with a simple visual interface suited to low-literacy users — large controls, icons, and optional voice-over of the current setting. The UI **shall not** imply clock-time scheduling, since the device has no RTC. |
| FR-APP-016 | Push notifications for critical events, delivered within 30 s of cloud detection; notification tap deep-links to the device. |
| FR-APP-017 | History screen: daily/weekly/monthly runtime hours and a fault history list, over the retained window (§12.7). |
| FR-APP-018 | "Call my dealer" action showing the contact for **that specific device's** servicing dealer, with distributor escalation contact where applicable (FR-SEC-005a). |
| FR-APP-019 | Multi-pump users **shall** be able to name, reorder and group their pumps by farm/site. |

## 9.3 Dealer / Technician Features

| ID | Requirement |
|---|---|
| FR-APP-030 | Commissioning flow: scan device QR/serial → verify ownership → capture site details and GPS location → select motor rating → apply configuration template → run a self-test → hand over to customer by phone number. |
| FR-APP-031 | The self-test **shall** verify supply presence on all phases, phase sequence, internal CT wiring and ratio sanity (measured current is plausible for the declared motor FLC when running) and cellular connectivity, and produce a pass/fail commissioning report stored against the device. |
| FR-APP-032 | Local BLE connection to the PCD **shall** allow configuration and diagnostics when there is no cellular coverage, subject to the same role permissions, with changes synced to the cloud when the technician regains connectivity. |
| FR-APP-033 | Bulk view of assigned devices with filters for "offline", "faulted today", "in lockout" to drive a service round. |
| FR-APP-034 | Ability to capture photos of the installation attached to the device record. |
| FR-APP-035 | Offline queue: actions taken without connectivity **shall** be queued and reconciled on reconnect with conflict reporting. |

## 9.4 Distributor / Manufacturer Features (App)

| ID | Requirement |
|---|---|
| FR-APP-040 | Sub-tree dashboard with device counts, faults and offline lists. |
| FR-APP-041 | Allocate devices to a child node by scanning serials. |
| FR-APP-042 | Approve or reject RMA requests raised by dealers. |

---

# 10. Backend & API Requirements

| ID | Requirement |
|---|---|
| FR-CLD-040 | The backend **shall** expose a versioned REST (or GraphQL) API over HTTPS consumed by both the web portal and the Android app; there **shall** be no client-only enforcement of permissions. |
| FR-CLD-041 | Authentication **shall** use short-lived access tokens (≤ 15 min) and rotating refresh tokens with device binding; token revocation **shall** take effect within 60 s. |
| FR-CLD-042 | Every API request **shall** be authorised against the caller's node and role; the data-access layer **shall** apply a mandatory tenant predicate so that a missing filter cannot leak cross-tenant data. |
| FR-CLD-043 | The API **shall** be rate-limited per user and per API key, with clear 429 responses and retry-after headers. |
| FR-CLD-044 | A webhook/subscription mechanism **should** be provided so partners can receive fault events into their own systems. |
| FR-CLD-045 | A partner-facing public API **may** be offered with scoped API keys, documented via OpenAPI. |
| FR-CLD-046 | All write operations **shall** be idempotent where a client retry is plausible (command dispatch, allocation), keyed by a client-supplied idempotency key. |
| FR-CLD-047 | The backend **shall** emit structured logs, metrics and traces for every request and every device message path. |
| FR-CLD-048 | Background jobs **shall** compute daily rollups, warranty expiry checks, offline-device sweeps and notification digests. |

---

# 11. Data Model

## 11.1 Core Entities (indicative)

| Entity | Key Attributes |
|---|---|
| `organisation` | id, parent_id, type (SUPERADMIN/MANUFACTURER/DISTRIBUTOR/DEALER), name, gstin, address, status, branding_id |
| `user` | id, org_id, phone, email, name, role, status, mfa_enabled, locale |
| `device` | id, serial, model, hw_rev, batch_id, iot_thing_name, cert_id, state, owner_org_id, end_user_id, commissioned_at |
| `panel` | id, panel_serial, manufacturer_org_id, device_id, motor_hp, motor_flc, starter_type, pump_make, pump_model |
| `site` | id, end_user_id, name, lat, lng, address, crop_type |
| `device_config` | device_id, version, desired_json, reported_json, status, updated_by, updated_at |
| `config_template` | id, org_id, name, motor_hp, config_json |
| `telemetry` | device_id, ts, phase metrics… (time-series store) |
| `event` | id, device_id, ts, type, code, severity, snapshot_json, ack_by, ack_at |
| `allocation` | id, device_id, from_org_id, to_org_id, actor_id, ts, note |
| `alert_rule` | id, scope (device/group/org), event_codes, severity_min, channels, quiet_hours |
| `notification` | id, user_id, event_id, channel, status, sent_at, delivered_at |
| `audit_log` | id, actor_id, org_id, entity_type, entity_id, action, before_json, after_json, ip, ts |
| `firmware` | id, version, hw_rev, s3_key, signature, release_notes, status, approved_by |
| `ota_job` | id, firmware_id, target_group, strategy, started_at, stats_json |
| `rma` | id, device_id, raised_by, reason, status, replacement_device_id, timeline_json |

## 11.2 Data Integrity Rules

- **FR-CLD-060** — `organisation.parent_id` **shall** form an acyclic tree; cycle creation **shall** be rejected.
- **FR-CLD-061** — A device **shall** have at most one `ACTIVE` panel binding and one current owner at any time.
- **FR-CLD-062** — `audit_log` **shall** be append-only; no API **shall** permit update or delete.
- **FR-CLD-063** — Deleting an organisation **shall** be a soft delete requiring that all its devices are first re-allocated.

---

# 12. Non-Functional Requirements

## 12.1 Performance

| ID | Requirement |
|---|---|
| NFR-P-001 | Protection trip decision latency on device: ≤ 100 ms from threshold breach confirmation to output de-energisation. |
| NFR-P-002 | End-to-end telemetry latency (device publish → visible in UI): p95 ≤ 5 s under normal network conditions. |
| NFR-P-003 | Remote command round-trip (user tap → device ack shown): p95 ≤ 10 s when the device is online. |
| NFR-P-004 | Web portal page interactive: p95 ≤ 2.5 s on a 10 Mbps connection; API p95 ≤ 400 ms for list endpoints. |
| NFR-P-005 | Android cold start ≤ 3 s on a mid-range device; home screen populated ≤ 2 s after auth. |
| NFR-P-006 | Ingestion **shall** sustain the design fleet size at default reporting rates with ≤ 60 s lag at peak. |

## 12.2 Scalability

| ID | Requirement |
|---|---|
| NFR-S-001 | The platform **shall** support 100,000 devices and 250,000 users in the first three years, with a design that scales horizontally beyond that without re-architecture. |
| NFR-S-002 | The system **shall** tolerate a mass reconnection event (e.g. grid restoration across a region reconnecting 20 % of the fleet within 5 minutes) without message loss, aided by device-side connect jitter. |
| NFR-S-003 | Time-series storage **shall** use time-partitioned tables (PostgreSQL + TimescaleDB or equivalent) sized for a fixed 30-day window, so storage cost is bounded and does not grow with programme age — only with fleet size. |

## 12.3 Availability & Reliability

| ID | Requirement |
|---|---|
| NFR-A-001 | Cloud platform availability target 99.5 % monthly for control and monitoring APIs. |
| NFR-A-002 | Loss of cloud connectivity **shall not** affect device protection, local control or scheduled operation. |
| NFR-A-003 | RPO ≤ 15 min, RTO ≤ 4 h for the relational store; automated backups retained 35 days with quarterly restore drills. |
| NFR-A-004 | No single message **shall** be lost between IoT Core and durable storage; the ingestion path **shall** use at-least-once delivery with idempotent writes. |
| NFR-A-005 | Device MTBF target ≥ 50,000 hours; field failure rate target < 1 % per year. |

## 12.4 Security

| ID | Requirement |
|---|---|
| FR-SEC-020 | All data in transit **shall** use TLS 1.2+; all data at rest **shall** be encrypted (AES-256, managed keys). |
| FR-SEC-021 | Device credentials **shall** be unique per device and held in the A7672X module's protected storage; no shared operational credentials. |
| FR-SEC-021a | **The MCU UID + IMEI pair is an identifier, not a secret.** It is transmitted in clear over the UART link and is not resistant to spoofing. Device authentication to the cloud **shall** rest entirely on the module's X.509 client certificate; the `dev_id` in the `reg` message **shall** be treated as a claim to be validated against the certificate's subject, never as proof of identity. |
| FR-SEC-021b | The cloud **shall** reject any message whose claimed `dev_id` does not match the device identity bound to the authenticated MQTT connection. |
| FR-SEC-022 | Debug interfaces (JTAG/SWD) **shall** be disabled or locked in production firmware; serial console **shall not** expose credentials. |
| FR-SEC-023 | Passwords **shall** be stored with a memory-hard KDF (Argon2id or bcrypt cost ≥ 12); OTPs **shall** expire in ≤ 5 min with attempt throttling. |
| FR-SEC-024 | The system **shall** enforce account lockout/backoff after repeated failed authentications and **shall** alert on credential-stuffing patterns. |
| FR-SEC-025 | Sensitive actions (device factory reset, energy clear, ownership transfer, OTA to full fleet) **shall** require re-authentication or a second approver. |
| FR-SEC-026 | The platform **shall** undergo third-party penetration testing before general availability and annually thereafter; device firmware **shall** be reviewed against IoT security baselines. |
| FR-SEC-027 | Personal data **shall** be minimised; end-user PII limited to name, phone, location of pump and preferred language. |
| FR-SEC-028 | The system **shall** support data export and deletion requests for end users, subject to legal retention of transactional records. |

## 12.5 Usability & Accessibility

| ID | Requirement |
|---|---|
| NFR-U-001 | The end-user app **shall** be operable by a user with low literacy: critical states conveyed by colour **and** icon **and** text; no reliance on colour alone. |
| NFR-U-002 | Text contrast **shall** meet WCAG 2.1 AA; the web portal **should** meet WCAG 2.1 AA overall. |
| NFR-U-003 | Destructive actions **shall** require explicit confirmation naming the device. |
| NFR-U-004 | Error messages **shall** state what happened, why, and what the user can do next. |

## 12.6 Maintainability & Supportability

| ID | Requirement |
|---|---|
| NFR-M-001 | Backend, web and app codebases **shall** maintain ≥ 70 % unit-test coverage on business logic. |
| NFR-M-002 | Firmware **shall** be built reproducibly from a tagged commit with a recorded toolchain version. |
| NFR-M-003 | All environments **shall** be provisioned as infrastructure-as-code. |
| NFR-M-004 | Every deployed component **shall** expose a version endpoint; every device reports its firmware version. |
| NFR-M-005 | Support **shall** be able to reconstruct any device's detailed state timeline for the last **30 days**, and its daily summary and fault history for 13 months. |

## 12.7 Data Retention

Retention is deliberately short to keep storage cost low at fleet scale.

| Data | Retention | Rationale |
|---|---|---|
| Raw telemetry | **30 days** | Rolling operational window; oldest partition dropped daily |
| Daily runtime/uptime summaries | 13 months | Small footprint; supports year-on-year service reporting |
| Events & faults | 13 months | Warranty and RMA evidence |
| Audit log | 7 years | Traceability and dispute resolution |
| Notification records | 90 days | Delivery troubleshooting only |
| Backups | 35 days | RPO/RTO per NFR-A-003 |

| ID | Requirement |
|---|---|
| NFR-D-001 | Raw telemetry older than 30 days **shall** be deleted automatically by a partition-drop job, not by row-level deletes. |
| NFR-D-002 | Before deletion, each day's raw telemetry **shall** be compacted into a daily summary (runtime minutes, start count, fault count, min/max/mean voltage and current, offline minutes) which is retained per the table above. |
| NFR-D-003 | The UI **shall** clearly indicate that detailed trend data is available for the last 30 days only, and **shall** offer CSV export so users can retain their own copies. |
| NFR-D-004 | A longer-retention option **may** be offered as a paid plan tier (§2.7) without re-architecture. |

---

# 13. Compliance & Standards

## 13.1 Product / Electrical

| ID | Requirement |
|---|---|
| CMP-001 | The PCD **shall** be designed and tested to IEC 60947-4-1 / IS 8544 as applicable to motor control and protective gear. |
| CMP-002 | The PCD **shall** meet IEC 61000-4-2 (ESD), -4-4 (EFT), -4-5 (surge, ≥ 2 kV line-to-earth), -4-6 (conducted RF) and -4-11 (voltage dips/interruptions) at levels appropriate for a rural grid installation. |
| CMP-003 | Emissions **shall** comply with CISPR 11 / CISPR 32 Class A or B as applicable. |
| CMP-004 | Safety and insulation coordination **shall** follow IEC 61010-1 (creepage/clearance for the operating voltage and pollution degree 2). |
| CMP-005 | Enclosure protection of the PCD assembly within the panel **shall** be verified to IEC 60529 for the target IP rating. |
| CMP-006 | Where the product is placed on the Indian market, applicable **BIS** requirements and the mandatory-registration status of the product category **shall** be verified before launch. |
| CMP-007 | Markets outside India are **out of scope for this release**; CE, FCC and RED certification are deferred. The design **should** nevertheless avoid choices that would preclude later CE/FCC submission. |
| CMP-008 | The product does not measure or report energy (§1.2) and **shall not** be represented as a metering or legal-metrology instrument in any marketing, UI or documentation. |

## 13.2 Radio & Telecom

| ID | Requirement |
|---|---|
| CMP-020 | The SIMCom **A7672** module **shall** be used within its certified configuration; the integrated product **shall** obtain **WPC/ETA** approval in India. Foreign radio approvals are out of scope for this release. |
| CMP-021 | The product **shall** comply with applicable RF exposure (SAR/MPE) requirements for its antenna configuration and installation distance. |
| CMP-022 | Partner-supplied M2M SIM usage **shall** comply with DoT/TRAI M2M and KYC requirements. Since the SIM is partner-supplied, the **SIM partner's M2MSP registration and KYC compliance shall be contractually confirmed and evidenced** before commercial launch; this obligation cannot be assumed to transfer automatically to the OEM. |

## 13.3 Data Protection & IT

| ID | Requirement |
|---|---|
| CMP-040 | Processing of personal data of Indian users **shall** comply with the **Digital Personal Data Protection Act, 2023**: notice at collection, purpose limitation, consent capture with withdrawal, grievance officer contact, and breach notification to the Data Protection Board and affected users. |
| CMP-041 | Consent artefacts **shall** be versioned and auditable per user. |
| CMP-042 | GDPR is not in scope while the product is sold only in India, but personal-data handling **should** be designed to a GDPR-compatible baseline so that expansion does not require redesign. |
| CMP-043 | The platform **should** be operated under an ISMS aligned to **ISO/IEC 27001**, with certification targeted before enterprise/utility sales. |
| CMP-044 | IoT security controls **should** be benchmarked against **ETSI EN 303 645** (consumer IoT baseline) and **IEC 62443-4-1/4-2** where the product is deployed in industrial contexts. |
| CMP-045 | Third-party/open-source components **shall** be tracked in an SBOM with monitored CVE feeds and a documented patch SLA (critical ≤ 14 days). |
| CMP-046 | Cloud data residency **shall** default to an India region; cross-border transfer **shall** occur only where permitted and documented. |

## 13.4 Operational

| ID | Requirement |
|---|---|
| CMP-060 | Every shipped device **shall** be traceable by serial to its batch, firmware at dispatch, test record and channel allocation history. |
| CMP-061 | User documentation **shall** include electrical safety warnings, installation instructions and a statement that the product does not replace mandatory statutory protective devices where such are required. |
| CMP-062 | The system **shall not** be represented as a safety-instrumented function; the specification **shall** state that primary short-circuit and personnel protection remains with the panel's MCB/MCCB/RCCB. |

---

# 14. Acceptance Criteria & Test Strategy

## 14.1 Test Levels

| Level | Scope |
|---|---|
| Unit | Firmware modules (protection curves, timers), backend services, UI components |
| Integration | Device ↔ IoT Core ↔ backend ↔ UI paths; shadow reconciliation; OTA |
| System | End-to-end user journeys per role |
| Hardware-in-loop | Programmable AC source + motor load bank injecting fault conditions |
| Field pilot | ≥ 50 devices across ≥ 3 districts for ≥ 8 weeks before GA |
| Non-functional | Load, soak, chaos, security |

## 14.2 Representative Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | With a programmable source, each protection function trips within its configured delay ±10 % across 20 repetitions, and does not trip below threshold. |
| AC-01a | **GAP-31 regression:** with the main loop artificially delayed so that iterations straddle the timeout second, the overload and imbalance trips still fire, across 50 repetitions with randomised loop delays of 0.5–2 s. |
| AC-01b | **Under-voltage (FR-DEV-021a):** a source swept from nominal down to 150 V trips within the configured delay; sweeping back up clears the fault per the reset policy. |
| AC-02 | Injecting phase reversal prevents start; the app shows "Phase reversal" within 10 s. |
| AC-03 | Dry-run condition simulated by removing load produces a trip, an event in the app, and a push notification within 30 s. |
| AC-04 | A setpoint changed in the portal appears as *pending*, is applied by the device, and shows *applied* with the device-reported value matching. |
| AC-05 | With the modem disconnected for 24 h, all telemetry and events are recovered after reconnection with original timestamps, no duplicates, no gaps. |
| AC-06 | START issued while the device is offline is either queued with a visible "will apply when online, expires in N min" or rejected — never silently lost. |
| AC-07 | A dealer cannot see any device outside their own sub-tree via UI or direct API call (verified by authorisation test suite). |
| AC-08 | An OTA canary rollout to 5 % succeeds, telemetry continues, and a forced-failure image triggers automatic rollback on the test unit. |
| AC-09 | Monthly data consumption per device measured over the pilot is ≤ 30 MB at default settings. |
| AC-10 | Load test at design fleet scale sustains ingestion with p95 end-to-end latency ≤ 5 s and zero message loss. |
| AC-11 | Cyclic timer of 30 min ON / 60 min OFF runs correctly for 7 days with no network and across at least 5 supply interruptions, verified against the device event log; cycle timing drift over 7 days is ≤ 1 %. |
| AC-12 | Power interruption during OTA download leaves the device on the previous working firmware. |
| AC-13 | Commissioning flow completes in ≤ 5 minutes by a technician on a mid-range Android phone with 3G-class connectivity. |
| AC-14 | All audit-relevant actions appear in the audit log with correct actor and cannot be modified via any API. |
| AC-15 | A 6-level dealer chain can be created; an attempt to create a 7th level is rejected with a clear error; a device allocated to the deepest dealer is visible to every ancestor and to no sibling. |
| AC-16 | Events recorded before the first network-time sync of a power cycle arrive flagged `tsApprox` and are reconciled by the cloud to within ±60 s of true time. |
| AC-17 | On subscription expiry the device moves to `SUSPENDED`, remote control is withdrawn in both UIs, and a running pump continues to run with all protections active; renewal restores control within 5 minutes. |
| AC-18 | Telemetry raw data older than 30 days is absent from queries and from storage after the retention job runs, while the corresponding daily summary is present. |
| AC-19 | A retrofit modem board fitted to an existing field PCD reports telemetry and accepts commands without any change to the PCD's protection behaviour, verified against a control unit. |
| AC-20 | **Provisioning is resumable.** Power is removed between certificate issue and persistence; on next boot the device completes provisioning and connects successfully, with no orphaned certificate left active in AWS. |
| AC-21 | **Claim credential is contained.** A device holding only the claim certificate cannot publish to any `devices/*` topic, cannot subscribe to any command topic, and cannot provision a serial absent from the manufacturing inventory. |
| AC-22 | **Identity binding holds.** A device configured with another device's `dev_id` fails to connect; a device publishing a payload whose `dev_id` differs from its client ID has that message rejected at the cloud. |
| AC-23 | **Command validation holds.** A fuzz corpus published to the commands topic — malformed JSON, unknown `cmd` values, out-of-range settings, duplicate keys, oversized payloads, nested objects — produces zero bytes written to the MCU UART beyond validated commands, and every rejection is counted on the `diag` topic. |
| AC-24 | **No plain-text path exists.** A build audit confirms `MQTT_MODE_GENERIC` and all associated broker constants are absent from the source tree, and a packet capture confirms all traffic is TLS 1.2 with mutual authentication. |

---

# 15. Assumptions, Constraints & Open Issues

## 15.1 Open Issues for Resolution

| # | Issue | Owner | Needed by |
|---|---|---|---|
| OI-30 | **Confirm the filesystem API surface** in `sc_lib/<module>/inc` and `sc_demo/V1`, which live in the full SDK on `E:` and are excluded from the repo by `.gitignore`. `CONFIG_HAS_DEMO_FS/FLASH/EXFLASHMOUNTFS=y` show a writable filesystem exists, and the SSL cert paths are filesystem paths — so runtime certificate writing is very likely possible, contrary to the earlier assumption. Confirm against `sc_demo/` (gitignored, present in the full SDK), and establish how much flash is free for certificates **and** the offline buffer together. This decides whether provisioning by claim proceeds as designed. | Firmware | **Sprint 1** |
| OI-32 | Does the module's RTC survive a power cycle, and is it battery-backed on this hardware? Determines whether §5.0.3's calendar-scheduling opportunity is real or whether it needs the same volatile-clock treatment as FR-DEV-044. | Hardware | Design freeze |
| OI-31 | Where is the claim credential stored during manufacture, who can access it, and what is its rotation schedule (FR-CLD-017)? | Ops / Security | Before first production batch |
| OI-28 | **Has command loss been seen on the bench?** GAP-24 predicts it: bridge debug lines up to 320 B against a 256 B MCU ring, with a 2 s reporter keeping the ring busy. Worth a deliberate test since no field units are affected. | Firmware | Sprint 1 |
| OI-13 | **[PARTLY ANSWERED — 17 KB flash free]** SRAM headroom is still unmeasured; 8 KB with a 2 KB stack is tight and an overflow has already occurred once. Measure free SRAM, and quantify how much flash compiling out debug `printf` recovers (FR-DEV-088) — that number decides whether the bootloader fits at all. | Firmware | **Sprint 1** |
| OI-14 | How much module-side flash is available for the offline buffer, and how many hours does that translate to at 60 s/300 s cadence? Sets the achievable value of FR-CON-024. | Firmware | Design freeze |
| OI-26 | Agree the layer-A change list and cut it **once**. Each MCU protocol change costs a firmware release across the fleet; batching them into a single version is far cheaper than trickling them out. | Firmware / Cloud | Sprint 2 |
| OI-16 | `CTRatio` is a 1–50 integer meaning "n/100" and `PHRatio` is 0–15 — the physical meaning of both, and the CT parts actually fitted in panels, need documenting for the commissioning UI. | Hardware | UI build |
| OI-17 | Confirm whether **single-phase** panels are in scope. The firmware is thoroughly three-phase (line-voltage vector sums, phase sequence, per-phase currents); single-phase support may be a larger change than it appears. | Product | Design freeze |
| OI-18 | Agree plan tier definitions and annual price points (§2.7 specifies enforcement, not the tiers). | Business | GA |
| OI-19 | Confirm with the SIM partner: annual data allowance, overage behaviour, and evidence of M2MSP/KYC registration (CMP-022). | Business / Legal | Pilot |
| OI-20 | Decide who pays the subscription in practice — manufacturer bundling, dealer collecting, or direct — which sets the dunning and suspension UX. | Business | GA |
| OI-8 | Hindi and English display strings for the 10 fault codes in §6.2. | Product | UI build |

### Resolved since v6.0

| Was | Resolution |
|---|---|
| OI-29 (does `sAPI_MqttSslCfg` work against live AWS?) | **Yes — confirmed working.** The largest single technical risk in the programme is closed. |
| OI-33 (under-voltage values) | Specified in FR-DEV-021c: line-voltage comparison, 340 V default, 250–400 V range, 5 s delay. Implementation confirmed as M031 firmware work. |
| OI-13 (MCU headroom) | Flash answered: **17 KB free**. Consequences in §4.6.1 / GAP-32. SRAM still to measure. |

### Resolved since v5.0 (by source and SDK inspection)

| Was | Resolution |
|---|---|
| OI-23 (is under-voltage implemented?) | **No.** Source-verified dead field. Now specified as new work — FR-DEV-021a/021b, fault code 10. |
| OI-24 (which overload delay?) | **3 s** (`OVERLOAD_TIMEOUT`). `Timing_OverLoad` is a dead field — FR-DEV-022b. |
| OI-11 (field unit capability) | **All field units are firmware-capable.** No hardware split to manage. |
| OI-12 (first OTA-capable firmware delivery) | **Manual upload of the first version**, physically. Units are nearby and accessible. |
| OI-3 (BLE availability) | **Available on the A7672S** (`CONFIG_HAS_DEMO_BLE=y`). Offline commissioning by phone (FR-APP-032) is viable with no added hardware. |
| OI-21 (RTC for calendar scheduling) | **The module has an RTC and NTP.** Calendar scheduling is feasible without added hardware — subject to OI-32 on power-cycle behaviour. |
| OI-25 (GNSS for location) | **Available** (`CONFIG_HAS_DEMO_GNSS=y`). A product decision now, not a hardware one. |

### Security decisions locked (v5.0)

| Decision | Requirement |
|---|---|
| **AWS IoT Core with mutual TLS is the only transport.** Generic/public-broker mode is deleted from the source tree, not disabled. | FR-CON-020 |
| **The bridge is the trust boundary.** All inbound commands parsed with cJSON, whitelisted, range-checked and re-serialised before reaching the MCU. | §6.6 |
| **Identity is bound to the certificate.** `dev_id` = thing name = certificate CN, enforced by client-ID policy variables plus a cloud-side payload check. | §6.7 |
| **Fleet provisioning by claim**, gated by a pre-provisioning hook that validates the serial against manufacturing inventory. | §5.2.1 |

These close GAP-13, GAP-22, GAP-23, GAP-27, GAP-29 and GAP-30 by design. Implementation is pending.

### Resolved since v2.0 (by firmware review)

| Was | Resolution |
|---|---|
| OI-1 (does the A7672 handle MQTT/TLS, or must the MCU?) | **Resolved by architecture.** The MCU never speaks MQTT — it exchanges line-delimited JSON over UART2 and the module is the cloud bridge. The flash/RAM risk is contained (residual sizing question is OI-13). |
| OI-15 (reconcile config schema with firmware) | **Done** — §4.2, §6.1 and §6.2 are taken from source. |
| OI-2 / OI-16 (CT arrangement) | Internal panel CTs, configured via `CTRatio` (1–50). Residual documentation question retained as OI-16. |
| OI-4, OI-5, OI-6, OI-7, OI-9, OI-10 | As resolved in v2.0 — see that revision's table. |

### Recommended sequencing

The four highest-value early moves, in order:

0. **Fix GAP-31 immediately.** Two one-line changes restore the overload and imbalance trips, which currently fire only if a loop iteration lands on the exact timeout second. This is a live protection defect on 300+ units and is independent of every other workstream.
0b. **Measure what compiling out debug `printf` recovers (FR-DEV-088).** That single number determines whether an MCU bootloader is possible at all, and therefore whether every future MCU fix needs a service visit. It should be established before the MCU release is scoped, not after.
1. **Build the hardened bridge in one release** — AWS-only transport (FR-CON-020), command validation via cJSON (§6.6), provisioning by claim (§5.2.1), LWT, the GAP-24 debug-output fix and the duplicate `reg_ack`. **No units are in the field, so there is no migration cost and no reason to split this across releases.**
2. **Batch the layer-A changes** (`get_settings`, fault reset, enumerated acks, runtime intervals, flash-write debounce) into one firmware release (OI-26). GAP-5 alone unblocks truthful configuration state in both UIs.
3. **Enrich messages in the bridge (GAP-2, GAP-11) and add buffering (GAP-1).** These are one workstream: `ts`/`seq` are what make replayed records usable, so buffering without them has little value.
4. **Fix GAP-24** — it is a one-line change (suppress debug output in production) and may resolve intermittent command loss you are already seeing.
5. **Plan the bootloader and physical uplift** (OI-12) before the fleet grows; that cost scales linearly with deployed units.

## 15.2 Explicit Constraints

- The device **shall not** rely on cloud availability for any protective function.
- The system **shall not** be marketed as a replacement for statutory electrical protection.
- Development is constrained to the AWS IoT service family for the connectivity layer.
- The existing PCD protection and control logic **shall not** be redesigned; connectivity is additive.
- The MCU (Nuvoton M031LD2AE) and modem (SIMCom A7672S) are fixed for this release.
- The bridge is built on the SIMCom OpenSDK; application size and available module flash bound the offline buffer (OI-14).
- Detailed history is limited to 30 days by deliberate cost constraint; the product **shall not** be marketed as offering long-term data history.

## 15.3 Future Roadmap (non-binding)

- iOS application.
- Energy and power metering on a higher-tier hardware variant (kW, kWh, power factor).
- Battery-backed RTC enabling day-of-week / time-of-day calendar scheduling.
- Soil moisture and water-level sensor integration for closed-loop irrigation.
- Extended data retention as a paid plan tier.
- CE / FCC / RED certification for export markets.
- Solar pump / VFD support with MPPT telemetry.
- Predictive maintenance from current-signature trends.
- Utility/DISCOM integration for demand-response and feeder-level analytics.
- Multi-pump group control and sequencing.

---

# 16. Appendices

## Appendix A — Configuration Parameter Summary

| Parameter | Unit | Default | Range | Editable by |
|---|---|---|---|---|
| Phase mode | — | 3P | 1P / 3P | Dealer+ |
| CT ratio (internal panel CT) | A:A | — | per panel build | Dealer+ |
| Motor FLC | A | — | per CT range | Dealer+ |
| Over-voltage limit / delay | V / s | 270 / 5 | 230–300 / 1–60 | Dealer+ |
| Under-voltage limit / delay | V / s | 180 / 5 | 120–220 / 1–60 | Dealer+ |
| Overload % / delay | % FLC / s | 110 / 10 | 50–200 / 1–120 | Dealer+ |
| Dry-run % / delay | % FLC / s | 55 / 20 | 20–90 / 5–300 | Dealer+, End user (delay only) |
| Locked rotor % / delay | % FLC / s | 300 / 3 | 200–600 / 0.5–10 | Dealer+ |
| Phase-loss delay | s | 2 | 0.5–10 | Dealer+ |
| Voltage imbalance % / delay | % / s | 10 / 10 | 2–20 / 1–60 | Dealer+ |
| Current imbalance % / delay | % / s | 20 / 10 | 5–50 / 1–60 | Dealer+ |
| Over-temperature limit | °C | 85 | 50–110 | Dealer+ |
| Auto-retry count / window / delay | — / min / s | 3 / 60 / 300 | 0–10 / 10–1440 / 30–3600 | Dealer+ |
| Minimum off time | s | 60 | 10–900 | Dealer+ |
| Cyclic ON / OFF | min | 30 / 60 | 1–1440 | End user |
| Cyclic cycle limit (0 = unlimited) | count | 0 | 0–999 | End user |
| Auto restart / random delay | — / s | On / 300 | 0–600 | Dealer+ |
| Reporting interval run / idle | s | 60 / 900 | 30–3600 / 300–86400 | Manufacturer+ |


## Appendix B — Role → Screen Access (Web Portal)

| Screen | SA | PM | Dist | Dealer |
|---|---|---|---|---|
| Global fleet dashboard | ✔ | — | — | — |
| Sub-tree dashboard | ✔ | ✔ | ✔ | ✔ |
| Device inventory / import | ✔ | — | — | — |
| Device allocation | ✔ | ✔ | ✔ | ✔ |
| Panel binding | ✔ | ✔ | — | — |
| Device detail (all tabs) | ✔ | ✔ | ✔ | ✔ |
| Configuration templates | ✔ | ✔ | ✔ | view |
| Firmware releases | ✔ | — | — | — |
| OTA jobs | ✔ | scoped | — | — |
| Organisations & users | ✔ | scoped | scoped | scoped |
| Alert rules | ✔ | ✔ | ✔ | ✔ |
| RMA / warranty | ✔ | ✔ | ✔ | ✔ |
| Audit log | ✔ | scoped | scoped | own |
| Branding / white-label | ✔ | ✔ | — | — |
| System health | ✔ | — | — | — |

## Appendix C — Requirement Traceability Skeleton

| Req ID | Design Element | Test Case | Status |
|---|---|---|---|
| FR-DEV-020 | Protection module `prot_voltage.c` | AC-01 / TC-PROT-004 | Draft |
| FR-CON-005 | MQTT/TLS driver | TC-CONN-002 | Draft |
| FR-SEC-002 | Ownership service | AC-07 / TC-RBAC-011 | Draft |
| FR-WEB-015 | Firmware release module | AC-08 | Draft |
| FR-APP-011 | Command dispatch UI | AC-06 | Draft |
| CMP-020 | WPC/ETA certification | Certification report | Open |
| FR-SEC-000a | Org tree depth guard | AC-15 | Draft |
| FR-CLD-073 | Subscription suspension logic | AC-17 | Draft |
| NFR-D-001 | Retention partition-drop job | AC-18 | Draft |
| FR-DEV-044 | Soft clock / tsApprox reconciliation | AC-16 | Draft |
| FR-CON-020 | AWS-only transport | AC-24 | Draft |
| FR-CON-040..046 | Bridge command validation | AC-23 | Draft |
| FR-CLD-015..019 | Fleet provisioning by claim | AC-20, AC-21 | Draft |
| FR-SEC-030..034 | Identity binding | AC-22 | Draft |

*(Full matrix to be maintained in the project tracker; this table is the template.)*

## Appendix D — Gap Analysis: Firmware As-Built vs. This SRS

Derived from a direct reading of `Autostarter_Display_M031LD2AE` v1.0.367 (MCU) and `swathi_mqtt` V1.0.1 (A7672S bridge). Ordered by risk. **[MCU]**, **[BRIDGE]** and **[CLOUD]** mark where each fix lands.

### D.1 Blocking gaps

| # | Gap | Impact | Fix |
|---|---|---|---|
| GAP-1 | **[BRIDGE] No offline buffering.** Confirmed in code: `MqttPublish()` returns −1 when `g_mqtt_connected` is false and `RouteMcuToMqtt()` discards the record. Nothing is queued at either end. | A dry-run trip during a network outage is lost permanently. This defeats the core value proposition in exactly the rural conditions the product targets. | Persist to module flash and replay on reconnect (FR-CON-024). Do **not** attempt it on the MCU. |
| GAP-2 | **[BRIDGE — solution identified] No timestamps anywhere.** The MCU sends none and the bridge adds none. | Buffered replay would be unorderable; fault forensics ("what tripped first") impossible. | The SDK provides **NTP and an RTC** (§5.0.3). Bridge syncs time and stamps on receipt (FR-CON-025), with GAP-11. No invention required. |
| GAP-3 | **Under-voltage protection is ambiguous.** `Voltage_Under` exists in the settings struct with a 180 V default, but there is no UI item, no IoT settings key, and no fault code for it. | The cloud must not expose a setpoint that may do nothing. Under-voltage is a primary motor-burnout cause in rural India — if it is genuinely absent, that is a product gap, not just a documentation one. | Determine whether it is implemented in `MotorProtection.c`. Decide and document. |
| GAP-4 | **No remote fault reset.** `motor_cmd` handles on/off only. A latched fault can only be cleared at the panel. | A farmer who gets a trip notification must physically walk to the pump — which removes most of the benefit of remote monitoring. | Add a `reset` action to layer A and map it to `RESET_FAULT`. |
| GAP-5 | **No `get_settings`.** The cloud can write settings but cannot read them back; only `ol` is echoed in `status`. | Shadow `reported` state cannot be populated. The portal cannot truthfully show what a device is actually configured to. Config drift is undetectable. | FR-CON-031. This is the highest-value small change in the list. |
| GAP-6 | **[MCU] No OTA.** No bootloader, no image verification, no rollback. | Every MCU fix needs a service visit. The first uplift is physical regardless (decided: manual upload). | New bootloader, module-staged (§4.6.1). Bridge FOTA is separate and easier. |
| **GAP-32** | **[MCU] Only ~17 KB of flash remains** (47 KB of 64 KB used). Dual-bank OTA needs ~100 KB on a 64 KB part. | **A/B OTA with rollback is impossible on this hardware.** The batched MCU changes (under-voltage, `get_settings`, fault reset, acks) will fit, but a bootloader plus a golden image will not. Headroom also constrains every future feature. | §4.6.1: module-staged update (FR-DEV-085), recoverable bootloader instead of rollback (FR-DEV-086/087), reclaim flash by compiling out debug `printf` first (FR-DEV-088), track usage per build (FR-DEV-089), plan a larger MCU (FR-DEV-090). |
| GAP-22 | **[DECIDED — §6.6]** **[BRIDGE] Inbound cloud payloads are forwarded to the MCU verbatim.** `MqttRecvTask` copies the MQTT payload and calls `SendToMCU()` with no parsing or validation, despite the README describing them as "validated". | Anything published to `devices/{dev_id}/commands` reaches the MCU's parser directly. On a public broker with no TLS and a guessable client ID (`SwathiSwitchgear_001`), **anyone can start or stop a pump.** The MCU's range checks are the only defence, and they do not cover `motor_cmd`. | FR-CON-022: parse, whitelist `cmd`, range-check every key against §6.1 before forwarding. Do this together with GAP-23. |
| GAP-23 | **[DECIDED — FR-CON-020]** **[BRIDGE] Plain-text MQTT to a public broker is the enabled build.** `MQTT_MODE_GENERIC` targets `mqtt-dashboard.com:1883` with no TLS and empty credentials; `MQTT_MODE_AWS_IOT` is present but stubbed (placeholder endpoint, unfilled cert paths). | Telemetry is public and commands are unauthenticated. Acceptable on the bench, unacceptable anywhere near a real pump. Combined with GAP-22 this is a remote-control vulnerability, not merely a privacy one. | Complete the AWS mode, provision certificates (FR-CON-023), and make the generic mode impossible to select in a production build. |

### D.2 Significant gaps

| # | Gap | Impact | Fix |
|---|---|---|---|
| GAP-7 | Settings are applied field-by-field with **silent rejection** of out-of-range values; the ack reports only whether anything changed. | The portal cannot show which setting failed and why. Users see "saved" when it wasn't. | FR-CON-030. |
| GAP-8 | **Every settings message writes to flash immediately.** No rate limit, no dirty check. | Flash endurance is exposed to a chatty or looping cloud service. | FR-CON-032: debounce, and skip the write when values are unchanged. |
| GAP-9 | Telemetry intervals are **compile-time constants**. | Data cost cannot be tuned per device or per plan tier without a firmware release. | Promote to runtime settings. |
| GAP-10 | **[RESOLVED — 3 s in force]** Compile-time protection parameters: phase-loss threshold (90 V), overload delay (`OVERLOAD_TIMEOUT` = 3 s, **confirmed**), imbalance window (10 s), cable-open thresholds. `Timing_OverLoad` (7 s) is a **dead field**, never read. | The cloud cannot tune what the firmware hard-codes. A settings field that controls nothing actively misleads whoever reads the settings dump. | Promote `Timing_OverLoad` to the live value (FR-DEV-022b); decide which others become runtime-settable. |
| GAP-11 | **No sequence numbers or dedup** at either layer — confirmed, the bridge adds none. | Retransmission and idempotency (FR-CLD-026) have nothing to key on. | Bridge assigns `seq` (FR-CON-021). |
| GAP-12 | **[MCU] The MCU cannot reset the module.** On bridge lockup the MCU retries registration into the void. The bridge's own recovery covers network and broker faults well, but not an application hang. | A wedged modem needs a site visit. | Hardware reset line plus a watchdog on `net_status`/`ping` liveness (FR-CON-002a). |
| GAP-13 | **[CLOSED by §6.7]** `dev_id` is spoofable — MCU UID and IMEI are identifiers, not secrets. | Closed at the cloud rather than on the wire: the certificate is the identity, policy variables bind the client ID, and FR-SEC-032 rejects mismatched payloads. Hardening the UART link is unnecessary. | §6.7. |
| GAP-24 | **[BRIDGE] `McuDebugPrint` can emit up to 320 bytes; the MCU's RX ring is 256 bytes.** `PeriodicReporterTask` additionally writes a `net_update` line to the MCU UART every 2 s. | A debug line longer than the ring **cannot** be received intact — the MCU drops bytes mid-message, and the 2 s reporter keeps the ring under constant pressure. A genuine command arriving in that window can be corrupted or lost. The MCU ignores these lines (no `cmd` key), so the cost is pure interference. **This may explain intermittent command loss if you have seen any.** | Suppress debug output in production builds, cap line length below 256 B, and move `net_update` to the diag topic instead of the MCU UART (FR-CON-031a). |
| GAP-25 | **[BRIDGE] No Last Will and Testament.** Nothing is configured on connect. | The cloud cannot distinguish "device dropped off" from "device quiet", so offline detection rests entirely on missed-telemetry timeouts — 5+ minutes when idle. | Register an LWT on the `status` topic (FR-CON-027). |
| GAP-26 | **[BRIDGE] `clean_session = 1`.** | The broker keeps no subscription or queued QoS 1 downlink across a disconnect. A command issued while the device is momentarily offline is silently dropped rather than delivered on reconnect. | Evaluate persistent sessions (FR-CON-029), or make command expiry and retry explicit in the cloud. |
| GAP-27 | **[CLOSED by §6.7]** Client ID asserted by the MCU over an unauthenticated serial link. | Closed by certificate binding and client-ID policy variables: a wrong `dev_id` fails to connect. Residual work is only the distinct diagnostic (FR-CON-030a) so the failure is legible in the field. | §6.7. |
| GAP-28 | **[BRIDGE] `reg_ack` is sent twice** — once from `RouteMcuToMqtt()` on publishing the registration, once at the end of `MqttConnect()`. | Harmless today (the MCU is idempotent) but it muddles the connection state machine and will confuse future correlation logic. | Send one, from one place. |
| GAP-29 | **[DECIDED]** cJSON is vendored but unused; the bridge uses the MCU's hand-rolled parser. | It cannot handle nested objects or arrays, which command validation (§6.6), message enrichment (FR-CON-021) and shadow deltas all require. | Adopt cJSON in the bridge (FR-CON-022). The MCU keeps its lightweight parser. |
| GAP-30 | **[DECIDED]** Hard-coded fallback broker IP (`3.120.11.244`). | A stale third-party IP could silently route production traffic. | Deleted along with the whole generic-mode block (FR-CON-020). Fail closed and retry. |

### D.3 Minor / hygiene

| # | Observation |
|---|---|
| GAP-15 | UART2 MFP pin function is set by a raw value (`0x08`) with a source comment noting the named BSP macros were unavailable and that it should be verified against the datasheet. Worth confirming. |
| GAP-16 | `CABLE_OPEN_LOAD_IMBALANCE 500` carries a `// Percent?` comment in `config.h` — the unit is genuinely unclear in the source. |
| GAP-17 | `Current_Load` exists in the settings struct but appears unused alongside `Current_OverLoad`. |
| GAP-18 | Settings integrity is a two-field magic check (`state==1 && state2==90`). Any struct layout change must bump `state2`, or field-shifted garbage will be read as valid. A CRC would be safer, and this becomes critical once OTA can change the struct. |
| GAP-19 | Registration is retried every 15 s indefinitely when disconnected, with no backoff — modest but needless power and airtime cost. |
| GAP-20 | `heartbeat` (MCU→module, 60 s) and `ping`/`pong` (module→MCU) overlap. Only one liveness mechanism is needed. |
| GAP-21 | The status message sends `ol` (overload setpoint) but no other setting, an ad-hoc partial echo that `get_settings` would supersede. |

### D.4 What already works and should not be touched

**MCU:** true-RMS measurement with dynamic offset tracking; the 8-state protection machine; phase-sequence detection by zero-crossing timing; the non-blocking JSON parser with no dynamic allocation; static buffer allocation (added to fix a stack overflow); cyclic-timer persistence across reboot; the settings-integrity check pattern.

**Bridge:** the three-task non-blocking structure; deferring MQTT connection until the MCU registers (correct, since the client ID comes from `reg`); exponential reconnect backoff with a connection-lost callback; line reassembly across UART read boundaries; DNS retry; the LZMA + CRC packaging pipeline. The two documented debug fixes — `NULL`-vs-empty-string credentials, and the `SC_SRV_MQTT` macro collision that silently filtered every inbound packet — are exactly the kind of finding worth keeping in the README.

These represent the working core; the remaining work should route around them.

---

**End of document.**
