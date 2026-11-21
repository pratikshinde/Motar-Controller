# SolarLogger (M66) on AWS IoT

The M66 logger (`SolarLogger_M66/`) uses **the same pipeline as the pump starters**: same AWS IoT endpoint, same device
policy, same IoT rule, same queue and ingest worker, same factory provisioning tool. Only the payload is different: the
solar drive's readings travel in a `vfd` object.

* Endpoint: `a2n3rt967x3ye8-ats.iot.ap-south-1.amazonaws.com`, port `8883`, TLS with a device certificate.
* **One identity string:** the module's IMEI is the thing name, the MQTT client id, `dev_id` in every frame and `pumps.id`
  in the backend (first unit `862818041287022`). Same rule as for starters (see `README.md`).
* The logger is a `SOLAR_VFD` device in the backend (`pumps.device_type`).

| Topic | Direction | What |
|-------|-----------|------|
| `devices/<IMEI>/telemetry` | device -> cloud | one reading every `interval` seconds (the existing rule `iot-rule.sql` routes it) |
| `devices/<IMEI>/faults` | device -> cloud | a drive trip, once, the moment it is seen |
| `devices/<IMEI>/commands` | cloud -> device | optional: a settings JSON changes the register map over the air |

Frame (`backend/app/workers/ingest.py`, status frame with a `vfd` object; only values that were read are included):

    {"dev_id":"862818041287022","vfd":{"hz":48.50,"i_out":12.35,"v_ac":400.2,"v_dc":585.0,"kw":4.94,
     "status":"RUNNING","fault_code":0},"rssi":-75,"fw":"1.0.0"}

If the drive cannot be read at all, a heartbeat `{"cmd":"heartbeat","dev_id":"...","rssi":-75}` is sent instead (online, no
readings). A fault: `{"cmd":"fault","code":49,"desc":"mitsubishi drive alarm"}`.

## Per logger (from the `backend` folder)

The logger uses the normal device policy `agripump-device-policy`:

    py -3 scripts/provision_devices.py --ids 862818041287022 --no-backend-check            # dry run
    py -3 scripts/provision_devices.py --ids 862818041287022 --no-backend-check --apply    # creates thing + certificate + attaches the policy

(`--no-backend-check` skips the "is there a pump with this ID" lookup; the logger is added to the backend as a
`SOLAR_VFD` device with `scripts/add_solar_logger.py`, so readings are not thrown away.)
The tool saves the files in `%USERPROFILE%\.aws\iot-factory\862818041287022\`. Then build the firmware with them:

    SolarLogger_M66\make-solar-firmware.ps1 -CertDir $env:USERPROFILE\.aws\iot-factory\862818041287022

**A certificate made by hand in the console** (as for the first unit): attach `agripump-device-policy` to it (the
topics above are inside it). `policies/solar-logger-policy.json` belonged to the first, separate topic scheme
(`solar/<IMEI>/...`) and is not needed any more.

## Brand rules (SolarLogger hierarchy and admin sign-in)

Super admin > admin > users; the admin signs in with an emailed code. These are brand settings, switched on once on the
server (dry run first):

    docker compose exec api python scripts/set_brand_features.py --key swati --set hierarchy=admin_users --set admin_login=email_code
    docker compose exec api python scripts/set_brand_features.py --key swati --set hierarchy=admin_users --set admin_login=email_code --apply

`hierarchy=admin_users`: the admin can create users only (no distributors or dealers). `admin_login=email_code`: the
admin's password sign-in is refused and `POST /auth/email-code/request|verify` signs them in (code sent through
`EMAIL_BACKEND`, see `deploy/env.example`). Other brands are unchanged.

## Website and app for this brand

* **Admin (website):** `/login/admin` has "Sign in with an emailed code instead" (the admin's password sign-in is refused for this brand). After sign-in the
  People page shows **Users** only, with **Add user** (name, mobile number, password: the admin hands the number and the password over). Removing or
  suspending a user is done from the user's card, as for Ajanta.
* **Users (app):** mobile number + the password the admin gave. The app shows frequency, output voltage, current, DC bus, power and the drive
  status; a live drive fault is shown by its name (FR-D700 codes, for example 49 = E.THM motor overload).
* The website learns the rule from `GET /api/v1/brands/mine` (`hierarchy`).
* Drive faults: the logger reports a fault only while the drive's status word says one is active (the Mitsubishi keeps its last fault in a history
  register, which is not a live trip).

## Register the logger in the backend (once per logger)

The website has no screen for this, so use the script (dry run first), on the server:

    docker compose exec api python scripts/add_solar_logger.py --imei 862818041287022 --admin-email <the swati admin's email>
    docker compose exec api python scripts/add_solar_logger.py --imei 862818041287022 --admin-email <the swati admin's email> --apply

It creates a `SOLAR_VFD` device with the admin's brand, owned by the admin. The admin then gives it to a user on the website: Devices > tick it > Give.
