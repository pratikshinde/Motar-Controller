# Android App Design

The app is implemented in [`../android/`](../android/) — see
[`android/README.md`](../android/README.md) for the full design, AWS setup
steps, and the firmware telemetry/shadow contract.

Summary:

- **Stack** — Kotlin, Jetpack Compose (Material 3), MVVM with StateFlow,
  AWS Android SDK (IoT + Cognito), Retrofit, Firebase Cloud Messaging.
- **Screens** — Monitor (ring gauges for RY/YB/BR voltages, phase current
  bars, ON/OFF power button), History (charts via API Gateway → Lambda →
  Timestream), Alerts.
- **Control path** — AWS IoT Device Shadow, so commands survive the pump
  controller being offline; UI distinguishes pending vs confirmed state.
- **Auth** — Cognito Identity Pool (no device certificates in the app).
- **Alerts** — IoT Rules → Lambda → FCM topic `pump-<THING_NAME>`
  (phase reverse/missing, overcurrent, voltage window, firmware faults).
