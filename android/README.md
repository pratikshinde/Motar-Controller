# Water Pump Monitor — Android (Kotlin + AWS IoT Core)

Native Android app for an IoT water pump monitoring system. Features:

- **Live monitoring** — MQTT over WebSockets subscription to the pump's telemetry topic: 3-phase line voltages (RY/YB/BR) as ring gauges, phase currents (R/Y/B) as bars, phase-sequence status, GSM signal, run-time counters
- **Remote control** — glowing ON/OFF power button via the AWS IoT **Device Shadow** (commands survive the pump being offline; UI shows pending vs confirmed state)
- **History & charts** — REST call to API Gateway → Lambda → Timestream
- **Push alerts** — IoT Rules → Lambda → Firebase Cloud Messaging (phase reverse, phase missing, overcurrent, voltage out of range, firmware faults)

Stack: Kotlin, Jetpack Compose (Material 3), MVVM with StateFlow, AWS Android SDK (IoT + Cognito), Retrofit, FCM.

---

## 1. Configure the app

Everything you must change is in **one file**:
`app/src/main/java/com/example/pumpmonitor/aws/AwsConfig.kt`

| Constant | Where to get it |
|---|---|
| `REGION` | Your AWS region |
| `COGNITO_IDENTITY_POOL_ID` | Cognito → Identity pools |
| `IOT_ENDPOINT` | `aws iot describe-endpoint --endpoint-type iot:Data-ATS` |
| `THING_NAME` | Your IoT Thing name |
| `HISTORY_API_BASE_URL` | API Gateway stage URL (step 4) |

If your firmware's telemetry JSON uses different field names, adjust `data/Models.kt`.

## 2. Cognito → IoT Core auth (no certificates in the app)

1. **Cognito → Identity pools → Create**. For a quick start enable *guest (unauthenticated) access*; for production add an authentication provider (Cognito User Pool) so users sign in.
2. Note the **Identity Pool ID** → put in `AwsConfig.kt`.
3. Attach IoT permissions to the pool's IAM role: edit the role and add `iot:Connect`, `iot:Subscribe`, `iot:Receive`, `iot:Publish` scoped as in `aws-setup/iot-policy.json` (replace `REGION`/`ACCOUNT_ID`).
4. Additionally, IoT requires an **IoT policy attached to each Cognito identity** when using unauthenticated identities. Easiest path: create the policy in IoT Core (paste `aws-setup/iot-policy.json`), then attach it at first connect via a small Lambda, or manually for testing:
   ```bash
   aws iot attach-policy --policy-name PumpAppPolicy --target "<cognito-identity-id>"
   ```
   (The identity ID is printed in Logcat by the AWS SDK on first connect.)

## 3. Pump firmware contract

- Publish telemetry JSON every few seconds to `pumps/<THING_NAME>/telemetry`:
  ```json
  {"ts":1720000000,
   "vRY":423.4,"vYB":437.4,"vBR":424.9,
   "pRY":true,"pYB":true,"pBR":true,
   "iR":9.1,"iY":10.4,"iB":9.4,
   "seqReverse":false,
   "totalRunSec":84745,"lastCycleRunSec":3737,
   "pumpOn":true,"gsmRssi":24,"faults":[]}
  ```
- Subscribe to `$aws/things/<THING_NAME>/shadow/update/delta`; on delta, actuate the contactor, then report:
  ```json
  {"state":{"reported":{"pump":"ON"}}}
  ```
- If the GSM module drops, buffered `desired` state is delivered by the shadow on reconnect.

## 4. History backend (charts)

1. **IoT Rule**: `SELECT vRY, vYB, vBR, iR, iY, iB, totalRunSec, pumpOn FROM 'pumps/WaterPump01/telemetry'` → action: **Timestream** (DB `PumpTelemetry`, table `readings`, dimension `pumpId = WaterPump01`).
2. **Lambda**: deploy `aws-setup/history-lambda.py` (Python 3.12, role with `timestream:Select`).
3. **API Gateway**: HTTP API → route `GET /history` → Lambda proxy. Copy the invoke URL into `AwsConfig.HISTORY_API_BASE_URL`.

DynamoDB works too if you prefer — keep the same response shape.

## 5. Push alerts (FCM)

1. Create a Firebase project, add Android app with package `com.example.pumpmonitor`, download **`google-services.json`** into `app/`, and uncomment the `google-services` plugin lines in both `build.gradle.kts` files.
2. Deploy `aws-setup/alert-lambda.py` (needs the Firebase service-account JSON in Secrets Manager).
3. Create IoT Rules for each alert condition — phase reverse, phase missing, overcurrent, voltage window (SQL examples are in the Lambda header) — with the Lambda as the action.
4. The app auto-subscribes to FCM topic `pump-<THING_NAME>` — no token management needed.

## 6. Build & run

Open the folder in Android Studio (Koala or newer), let Gradle sync, run on a device/emulator with Google Play services. Min SDK 26.

> **Note:** until you add `google-services.json`, the FCM plugin lines stay commented out — the app still builds and everything except push alerts works.

## Project layout

```
app/src/main/java/com/example/pumpmonitor/
├── PumpApp.kt                  # singletons + notification channel
├── aws/
│   ├── AwsConfig.kt            # ← EDIT THIS
│   └── IotMqttClient.kt        # Cognito + MQTT/WSS + Device Shadow
├── data/                       # models + Retrofit history API
├── fcm/PumpMessagingService.kt # push alerts
└── ui/
    ├── MainActivity.kt         # bottom nav (Monitor / History / Alerts)
    ├── PumpViewModel.kt        # StateFlows for all screens
    ├── theme/                  # neon dark theme (matches web UI)
    ├── dashboard/  history/  alerts/
aws-setup/                      # IoT policy + Lambda samples
```
