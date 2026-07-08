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
| `firmware/` | Pump-side controller firmware (ESP32 / ESP-IDF) |
| `hardware/` | Schematics, PCB design files, BOM |
| `docs/` | System design, app design, protocol specs |

## System overview

```
[Pump + sensors] ── [Controller (ESP32)] ── WiFi/GSM ── [Cloud broker] ── [Android app]
```

- **Controller** reads pump electricals and status, executes protection logic
  locally (dry-run / overload cutoff must not depend on connectivity), and
  publishes telemetry.
- **Android app** shows live status, history, and alerts, and sends start/stop
  commands.

## Status

- [ ] Android app — design complete (see `docs/android-app-design.md`), implementation pending
- [ ] Firmware — not started
- [ ] Hardware — not started
- [ ] Cloud/broker selection — not decided
