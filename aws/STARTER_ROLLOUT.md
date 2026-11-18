# Putting the current starter firmware on more starters

The test starter (AJ-TEST-0001) runs the current module firmware: **Basic Ingest** (readings go straight to the rule) and the
**heartbeat** (an idle pump is heard every minute, so it is not shown offline). Every other starter must be reflashed to get them.
Starters that are not reflashed keep working the old way; nothing breaks.

## Why the old and new firmware can run side by side

* The rule `agripump_ingest` reads `devices/+/+`. Old firmware publishes to `devices/<ID>/telemetry`; Basic Ingest publishes to
  `$aws/rules/agripump_ingest/devices/<ID>/telemetry`. The rule sees the same topic either way, so the backend needs no change and
  old and new readings land in the same table.
* The device policy (`agripump-device-policy`, active version 2) allows both topics, for every certificate that has this policy
  attached (a policy's active version applies to all of them). Check that a new starter's certificate has it attached: the
  provisioning script does this for you; a certificate made by hand in the console may not.

## One starter, step by step

1. Make its identity (once per starter, creates the AWS thing, certificate and key; dry run first, then `--apply`):

       python backend\scripts\provision_devices.py --ids AJ-0001            # dry run
       python backend\scripts\provision_devices.py --ids AJ-0001 --apply

   The files go to `%USERPROFILE%\.aws\iot-factory\AJ-0001\`. The private key cannot be downloaded from AWS again: back that folder up.
2. Put the ID on the factory list (website > Factory station), or its readings are ignored.
3. Build that starter's firmware (the zip is written next to its keys, not into OneDrive):

       cd A7672S_MQTT
       .\make-starter-firmware.ps1 -StarterId AJ-0001

4. Flash it (the module in download mode on its USB port), then check the module's USB log for the connect line and the dashboard for a reading:

       adownload.exe -q -u -a -f -r -s 115200 "%USERPROFILE%\.aws\iot-factory\AJ-0001\firmware-AJ-0001.zip"

## Rules

* The zip contains that starter's **private key**. Never commit it, never e-mail it, delete it when the unit is flashed (the key
  folder stays as the master copy).
* One zip per starter. A zip flashed onto a different starter makes two modules fight over one identity.
* To go back to the broker route on one build, remove the `BASIC_INGEST_RULE` line in `app_config.h`.
* To switch a starter off for good: `python backend\scripts\provision_devices.py --revoke AJ-0001 --apply`.
