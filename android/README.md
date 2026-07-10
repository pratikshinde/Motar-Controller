# Water Pump Monitor — Android (Kotlin + AWS IoT Core)

Native Android app for an IoT water pump monitoring system. Features:

- **Phone OTP login** — Firebase Authentication (Phone provider); users sign in once with an SMS OTP and stay signed in
- **Multiple pumps per user** — after login the app fetches the user's pump list (`GET /pumps` → DynamoDB) and shows a card per pump; tapping a card opens that pump's dashboard
- **Live monitoring** — MQTT over WebSockets subscription to the selected pump's telemetry topic: 3-phase line voltages (RY/YB/BR) as ring gauges, phase currents (R/Y/B) as bars, phase-sequence status, GSM signal, run-time counters
- **Remote control** — glowing ON/OFF power button via the AWS IoT **Device Shadow** (commands survive the pump being offline; UI shows pending vs confirmed state)
- **History & charts** — REST call to API Gateway → Lambda → Timestream
- **Push alerts** — IoT Rules → Lambda → Firebase Cloud Messaging (phase reverse, phase missing, overcurrent, voltage out of range, firmware faults); the app subscribes to one FCM topic per owned pump
- **Indian languages** — in-app language picker: English, हिन्दी, ಕನ್ನಡ, मराठी, தமிழ், తెలుగు (all UI strings live in `res/values-*/strings.xml`; add a language by adding a folder + one entry in `i18n/LocalePrefs.kt`)

Stack: Kotlin, Jetpack Compose (Material 3), MVVM with StateFlow, AWS Android SDK (IoT + Cognito), Firebase (Auth + FCM), Retrofit.

---

## 1. Configure the app

Everything you must change is in **one file**:
`app/src/main/java/com/example/pumpmonitor/aws/AwsConfig.kt`

| Constant | Where to get it |
|---|---|
| `REGION` | Your AWS region |
| `COGNITO_IDENTITY_POOL_ID` | Cognito → Identity pools |
| `IOT_ENDPOINT` | `aws iot describe-endpoint --endpoint-type iot:Data-ATS` |
| `DEFAULT_THING_NAME` | Fallback pump shown while the pumps API (step 6) isn't deployed |
| `API_BASE_URL` | API Gateway stage URL — serves `GET /history` (step 4) and `GET /pumps` (step 6) |

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
3. **API Gateway**: HTTP API → route `GET /history` → Lambda proxy. Copy the invoke URL into `AwsConfig.API_BASE_URL`.

DynamoDB works too if you prefer — keep the same response shape.

## 5. Push alerts (FCM) + phone OTP login (Firebase)

One Firebase project serves both features:

1. Create a Firebase project, add an Android app with package `com.example.pumpmonitor`, download **`google-services.json`** into `app/`, and uncomment the `google-services` plugin lines in both `build.gradle.kts` files.
2. **Authentication → Sign-in method → enable "Phone"**. Add your SHA-1/SHA-256 fingerprints (Project settings → Your apps) so Play Integrity verification works; add test phone numbers there to develop without sending real SMS.
3. For push alerts: deploy `aws-setup/alert-lambda.py` (needs the Firebase service-account JSON in Secrets Manager).
4. Create IoT Rules for each alert condition — phase reverse, phase missing, overcurrent, voltage window (SQL examples are in the Lambda header) — with the Lambda as the action.
5. The app auto-subscribes to FCM topic `pump-<thingName>` for **every pump** the user owns — no token management needed.

> Until `google-services.json` is added, the app still builds; the login screen shows a **demo mode** button instead of OTP, and push alerts are off.

## 6. Pumps registry (multi-pump per customer)

Which pumps a customer sees after login comes from DynamoDB:

1. **DynamoDB**: create table `PumpOwners`, partition key `userId` (String). One item per customer, keyed by their **phone number in E.164** (`+919876543210`), with a `pumps` list — item shape is documented in `aws-setup/pumps-lambda.py`.
2. **Lambda**: deploy `aws-setup/pumps-lambda.py` (Python 3.12, role with `dynamodb:GetItem`).
3. **API Gateway**: add route `GET /pumps` → Lambda proxy on the **same** HTTP API as `/history`.
4. Provisioning a new customer = inserting one DynamoDB item. No app change needed.

If the API isn't reachable, the app falls back to a single pump named by `AwsConfig.DEFAULT_THING_NAME` so bring-up works before any backend exists. Make sure the IoT policy (`aws-setup/iot-policy.json`) keeps wildcard `pumps/*` topic scoping so one identity can subscribe to all of a user's pumps.

## 7. Build & run

Open the folder in Android Studio (Koala or newer), let Gradle sync, run on a device/emulator with Google Play services. Min SDK 26.

## Project layout

```
app/src/main/java/com/example/pumpmonitor/
├── PumpApp.kt                  # singletons + notification channel
├── aws/
│   ├── AwsConfig.kt            # ← EDIT THIS
│   └── IotMqttClient.kt        # Cognito + MQTT/WSS + Device Shadow (per-pump)
├── data/                       # models + Retrofit backend API (/history, /pumps)
├── fcm/PumpMessagingService.kt # push alerts
├── i18n/LocalePrefs.kt         # in-app language selection (en/hi/kn/mr/ta/te)
└── ui/
    ├── MainActivity.kt         # nav: login -> pump list -> per-pump tabs
    ├── PumpViewModel.kt        # pump list + selected-pump StateFlows
    ├── login/                  # phone OTP (Firebase Auth) + AuthViewModel
    ├── pumps/                  # pump list screen
    ├── common/                 # language dialog
    ├── theme/                  # neon dark theme (matches web UI)
    ├── dashboard/  history/  alerts/
aws-setup/                      # IoT policy + Lambda samples (history, alerts, pumps)
```
