# Registering a farmer (Ajanta admin on the website + QR in the app)

No OTP is needed to register. The **Ajanta admin** registers the farmer on the website, and the farmer scans a one-time QR code in the app.

## The website has two logins only (email + password)

| Login | What it can do |
|---|---|
| **Ajanta admin** (the Ajanta brand's own account, role `manufacturer`) | registers farmers (Farmers > Add farmer), makes new QR codes, manages its starters, sees all monitoring |
| **Super admin** (platform owner) | monitoring only: sees everything, opens the Ajanta dashboard read-only, changes nothing |

There is no sign-up on the website, no distributor/dealer/support accounts, and no account tree screen. Both accounts are created by us:

    python scripts/create_portal_accounts.py --role superadmin   --name "Platform Owner" --email owner@example.com
    python scripts/create_portal_accounts.py --role ajanta-admin --name "Ajanta Admin"    --email admin@example.com [--replace-owner]

The script asks for the password (hidden, typed twice, at least 10 characters); it is never printed and is stored only as a hash.
`--replace-owner` makes the new Ajanta admin the Ajanta brand's owner when the demo manufacturer still owns it. A super admin's first
sign-in is forced through authenticator (TOTP) setup.

**Monitoring only is a server rule:** with `SUPERADMIN_MONITOR_ONLY=true` in `backend/.env` the server refuses every change made by the
super admin (403 "The super admin account is for monitoring only"); reads and the sign-in calls still work. Set it on the server.
(The automated tests ignore this setting; see `tests/conftest.py`.)

Website sign-in: `POST /api/v1/auth/login-email` {email, password}: the same protections as the mobile number sign-in (a wrong password
and an unknown email give the same answer; repeated wrong passwords lock the email for a few minutes).

## The flow

1. **Factory:** each starter has a unique ID (made by the microcontroller on our PCB). It is registered in the factory list (device batch /
   IMEI import) and printed as a **barcode on the starter's box**. The barcode value must be the same ID the pump reports to the cloud
   (the pump's `id`). The barcode is not a secret; it only identifies the pump.
2. **Stock:** the starter reaches the dealer's stock (the existing allocation from manufacturer > distributor > dealer).
3. **Website > Farmers > Add farmer** (distributor, dealer, manufacturer): name, address, mobile number, **starter ID** (scan the barcode, or
   type it) and pump capacity (HP). Saving, in one request (`POST /api/v1/farmers`):
   - creates the farmer (role `customer`, under the dealer; no password, no email),
   - gives the starter to the farmer (the same allocation the stock screens do) and sets its capacity and name,
   - returns a **one-time QR code** (shown once; print it or download the PNG).
4. **App > Scan QR code:** the farmer scans the QR, then types the mobile number the dealer registered, and is signed in
   (`POST /api/v1/auth/claim`). They see their pump.

## What is stored, and where

PostgreSQL (the backend's database), schema `agripump`:

| What | Table |
|---|---|
| name, mobile number, **address**, role, place under the dealer | `users` (`address` added by migration `phase8_farmer_claims`) |
| starter ID, pump name, capacity (HP), owner | `pumps` |
| who gave the starter to whom, and when | `allocation_log` |
| the QR: a **hash** of its secret, expiry, claimed/revoked, wrong-number attempts | `farmer_claims` |
| the registration, QR use and re-issue | `audit_log` |

The QR holds only a random secret (`AGP-CLAIM:<secret>`); the database keeps its SHA-256, never the secret.

## Safeguards

- The QR works **once** and expires after 30 days. A new QR for a farmer (**Farmers > New QR**) revokes the older ones.
- The app also asks for the farmer's registered mobile number. Five wrong numbers burn the QR.
- A starter must be in the caller's own stock, and cannot be given to two farmers. A farmer's mobile number can be registered once.
- A dealer sees only their own farmers (the same tree scoping as everything else).
- The mobile number is typed by the dealer and is not verified. The form checks for 10 digits and refuses a duplicate.

## Signing in again

A farmer on a new phone, or after reinstalling, can use **Already registered? Use your mobile number** (Firebase Phone Authentication, or the
backend's SMS code). That only works for a number a dealer already registered: unknown numbers get no account unless
`OPEN_PHONE_SIGNUP=true` (off by default outside development). Or the dealer makes a new QR.

## Managing a farmer (Ajanta admin, Farmers page)

- **Edit** (`PATCH /api/v1/farmers/{id}`): fix the name, address or mobile number. A new number must be a 10-digit Indian mobile and not used by another
  account. A farmer who has not scanned the QR yet is asked for the new number at the scan.
- **Stop / Restore** (`POST /farmers/{id}/deactivate`, `/activate`): a stopped farmer cannot scan a QR or sign in, and a phone that is already signed
  in is signed out at once (the session version moves on and the refresh tokens are revoked). The farmer, the pump and its history are kept. A
  stopped farmer's QR is not used up by a refused scan.
- **New QR**: replaces the earlier QR (lost phone, expired QR).
- Everything above is for the Ajanta admin only; the super admin can look but not change.

## Not offered yet

"Already registered? Use your mobile number" (Firebase / SMS code) is built but switched off in the app (`mobile/src/config/features.ts`,
`phoneSignInEnabled = false`) until the OTP route is decided. Until then a farmer on a new phone asks the admin for a new QR.
