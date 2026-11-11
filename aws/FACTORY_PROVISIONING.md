# Factory provisioning: an AWS identity for every starter

Each starter needs its own AWS IoT identity: a **thing** named exactly like the starter ID on its box, and its **own certificate and private key**.
`backend/scripts/provision_devices.py` creates them from the factory list, so nobody clicks through the AWS console for each one.

The starter ID is one string everywhere: AWS thing name = MQTT client id = `pumps.id` = the barcode (see `README.md`).

## What it does, and does not do

| It does | It does not |
|---|---|
| creates the thing, an active certificate and key, attaches the device policy, attaches the certificate to the thing | create the IoT policy, the IoT rule, the queues or the roles (a one-time console job, `README.md`) |
| saves one folder per starter: certificate, private key, public key, Amazon root CA | put the certificate on the module (a factory flashing step, see below) |
| writes `manifest-*.csv` (what happened, no keys in it) | create the pump in the website (import the factory list there) |
| switches a starter's certificate off (`--revoke`) | delete anything in AWS |

It is **safe to rerun**: a thing that already exists is skipped, a folder that already holds files is never overwritten, and if one step fails for a starter
everything created for that starter is removed again.

## One-time setup (you, in the AWS console)

1. **Make sure the device policy exists**: IoT Core > Security > Policies > `agripump-device-policy` (from `policies/device-policy.json`). You already have it.
2. **Create a separate IAM user for the factory**, for example `agripump-factory`:
   IAM > Users > Create user > attach an inline policy from `policies/factory-provisioning-iam-policy.json` (replace `<ACCOUNT_ID>` with `267834697472`).
   Do **not** reuse `agripump-backend` (the tool refuses to run as it) and do **not** use an administrator user.
3. Create an access key for that user (use case: "Command Line Interface") and add it to `%USERPROFILE%\.aws\credentials` as a **named profile**:

       [agripump-factory]
       aws_access_key_id = ...
       aws_secret_access_key = ...

   Never paste the secret into a chat or commit it. When the factory work is finished, set the key to inactive in IAM.

## Using it (from the `backend` folder)

    python scripts/provision_devices.py --file starters.txt            # dry run: shows what it would do, creates nothing
    python scripts/provision_devices.py --file starters.txt --apply    # really creates them

`starters.txt` is one starter ID per line (or a CSV whose first column is the ID; a header line such as `starter_id` is skipped, `#` starts a comment).
You can also pass `--ids AJ-0001,AJ-0002`.

Output goes to `%USERPROFILE%\.aws\iot-factory\<starter ID>\` (change with `--out`):

    <certId>-certificate.pem.crt   <certId>-private.pem.key   <certId>-public.pem.key   AmazonRootCA1.pem

**The private key cannot be downloaded from AWS again.** Back that folder up somewhere safe and private. Certificates, keys and `.pem` / `.key` / `.crt`
files are git-ignored; never commit them.

The tool also tells you, per starter, whether the backend already has a pump with that ID. A starter that is **not** in the backend yet has its
readings thrown away, so import the factory list on the website too.

## Lost, stolen or returned starter

    python scripts/provision_devices.py --revoke AJ-0001 --apply

This switches the certificate off and detaches it. The starter can no longer connect. Nothing is deleted, so it can be undone in the console.

## Order of the factory process

1. Import the factory list on the website (the pumps now exist as stock).
2. Run the tool on the same list (dry run, then `--apply`).
3. Put each starter's certificate and key onto its module and print the ID on the box. **This step is not automated yet:** today the module's firmware
   carries one certificate (`A7672S_MQTT/.../swathi_mqtt/iot-certficate`), so a per-starter flashing process still has to be defined.
4. The dealer registers the farmer with the starter ID (barcode). Nothing in AWS changes at that point.

## Later: no certificate handling at all

Fleet provisioning by claim (`provisioning-template.json`, `lambda/provisioning_hook.py`) lets each module obtain its own certificate on first power-up.
It needs firmware work and an AWS deployment that are not done yet. This tool is the step before it.
