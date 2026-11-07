# Sign-in by mobile number + SMS code

Farmers have no email and no password. They enter a mobile number, get a 6-digit code by SMS, and are in. A number that has no
account yet gets one the first time its code is verified. (Ajanta app; the other brands keep their old sign-in.)

There are two ways the code is sent. The Ajanta Android app uses **Firebase Phone Authentication** (below) and falls back to the
backend's own SMS route (MSG91, further down) wherever Firebase is not set up.

## 0. Firebase Phone Authentication (no DLT, Google sends the SMS)

1. Firebase console > Authentication > Sign-in method: **Phone** enabled.
2. Project settings > Your apps > `com.agripump.farmer`: the app's **SHA-1** added (debug key used by `build-solarlogger-apk.ps1`:
   `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`; a Play Store release key needs its own).
3. Authentication > Settings > SMS region policy: allow **India** only.
4. Optional, for testing without a real SMS: Phone provider > Phone numbers for testing (a fake number and a fixed code).
5. The backend needs the project id: it is taken from `FIREBASE_SERVICE_ACCOUNT_FILE` (already set for push) or `FIREBASE_PROJECT_ID`.
6. A new project may send only **10 real SMS a day** until a billing account is added to it (test numbers are not counted).

How it works: the app asks Firebase to text the code, the farmer types it, Firebase gives the app a signed ID token, and the app posts it
to `POST /api/v1/auth/firebase-phone`. The backend checks the token (Google's signing keys, this project, a phone sign-in, verified in the
last 10 minutes; `services/firebase_phone.py`) and then signs the farmer in exactly as the SMS-code login does. New numbers need
`OPEN_PHONE_SIGNUP=true` outside development.

## MSG91 (the backend's own SMS route)

## 1. MSG91 and DLT

1. MSG91 account, service **OTP**.
2. Register on a telecom DLT portal (Jio / Airtel / Vi): your company (entity), a 6-letter sender ID (e.g. `AJNTAP`) and one
   **OTP template**. Template text, keeping `##OTP##` exactly:

       Your Ajanta Pump Controller verification code is ##OTP##. Valid for 5 minutes. Do not share it with anyone.

3. In MSG91, add that approved template to the OTP product and copy its **template ID**.

## 2. Settings (backend/.env, never in git)

    MSG91_AUTH_KEY=<MSG91 auth key>
    MSG91_OTP_TEMPLATE_ID=<the OTP template ID>
    OPEN_PHONE_SIGNUP=true          # lets a NEW number get a code and an account (outside ENV=development)
    ALERT_SMS_ENABLED=false         # pump alerts go by Firebase push, not SMS
    # optional
    OTP_MAX_PER_PHONE_PER_HOUR=5    # SMS costs money: codes one number can be sent per hour
    OTP_SEND_IN_DEV=true            # only to try real SMS from a developer machine (ENV=development); default: nothing is sent

MSG91 is tried before Twilio, so leftover `TWILIO_*` lines do no harm. Restart the backend after changing `.env`.

## 3. Trying it

* Developer machine (`ENV=development`): nothing is sent; the code `123456` works and the app shows it.
* Real SMS from a developer machine: set `OTP_SEND_IN_DEV=true`, with the MSG91 settings above and DLT approved.
* Server (`ENV=production`): `OPEN_PHONE_SIGNUP=true` is required, otherwise only numbers that already have an account get a code.

The MSG91 request (`POST https://control.msg91.com/api/v5/otp`) is covered by unit tests with a mocked MSG91; it has not been
run against the live service yet.
