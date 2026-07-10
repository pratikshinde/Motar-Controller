# IoT Agri Pump Control and Monitoring

IoT-based agricultural pump control and monitoring system.

Farmers can remotely monitor and control irrigation/borewell pumps from an
Android app — pump ON/OFF state, run hours, electrical health (voltage,
current, phase), and fault conditions (dry run, overload, phase failure) —
without walking to the pump house.

## Repository layout

| Directory | Contents |
|---|---|
| `android/` | Android app (monitoring + control UI) |
| `web/` | Web dashboard design mockup (static HTML, demo data) |
| `firmware/` | Pump-side controller firmware (ESP32 / ESP-IDF) |
| `hardware/` | Schematics, PCB design files, BOM |
| `docs/` | System design, app design, protocol specs |

## System overview

```
[Pump + sensors] ── [Controller (GSM)] ── MQTT ── [AWS IoT Core] ── [Android app]
                                                       │
                                    IoT Rules → Timestream (history)
                                              → Lambda → FCM (push alerts)
```

- **Controller** reads pump electricals (3-phase voltages/currents, phase
  sequence) and status, executes protection logic locally (cutoffs must not
  depend on connectivity), publishes telemetry to
  `pumps/<THING_NAME>/telemetry`, and follows AWS IoT Device Shadow deltas
  for remote ON/OFF (see `android/README.md` §3 for the exact contract).
- **Android app** (`android/`) — Kotlin + Jetpack Compose, live MQTT dashboard,
  shadow-based pump control, Timestream-backed history charts, FCM alerts.
  Setup instructions in `android/README.md`; AWS-side pieces (IoT policy,
  Lambdas) in `android/aws-setup/`.

## Status

- [x] Android app — implemented (`android/`), needs AWS IDs filled into `AwsConfig.kt`
- [x] Android app v2 — phone OTP login (Firebase Auth), multi-pump list per customer, 6 languages (en/hi/kn/mr/ta/te)
- [ ] AWS setup — Cognito pool, IoT policy, Timestream rule, Lambdas (history/alerts/pumps), DynamoDB `PumpOwners`, Firebase project
- [ ] Firmware — not started (must implement the telemetry/shadow contract)
- [ ] Hardware — not started
