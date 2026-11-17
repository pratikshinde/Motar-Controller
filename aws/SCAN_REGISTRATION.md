# Scan a barcode, and the starter's identity is made by itself

On the website, **Factory Station**: scan (or type) a starter's barcode. If the starter is on an uploaded sheet, its batch is not revoked and it has not
been registered, the server then, with no person doing anything:

1. makes the pump in the system as stock in the tree of the admin who uploaded the sheet (so that admin, and their distributors and dealers, can give it to a farmer);
2. makes in AWS IoT a thing named exactly like the starter ID, a new certificate and private key, attaches the device policy `agripump-device-policy`,
   and attaches the certificate to the thing;
3. marks the starter registered and writes `STARTER_REGISTERED_IN_AWS` to the audit log (the certificate id, never the key);
4. sends the browser one zip: `<ID>/certificate.pem.crt`, `<ID>/private.pem.key`, `<ID>/AmazonRootCA1.pem`, `<ID>/README.txt`.

It is plain program logic (`backend/app/services/starter_registration.py`), the same every time. No AI is involved, on purpose: issuing a certificate must be
predictable, logged and impossible to talk into doing something else.

The **private key is shown once** (in that zip) and is not stored by the server or in AWS. Whoever puts the certificate on the module keeps the zip private.

If any AWS step fails, what was made is removed and the starter stays unregistered, so scanning again simply tries again. A starter that is already registered, in a
revoked batch, or whose thing already exists in AWS is refused with a plain reason and nothing is changed.

## One-time setup (you, in the AWS console)

1. IAM > Roles > `agripump-server-role` (the role of the EC2 server) > Add permissions > Create inline policy > JSON: paste
   `aws/policies/server-starter-registration-iam-policy.json` with `<ACCOUNT_ID>` replaced by `267834697472`. Name it `agripump-server-starter-registration`.
2. On the server, in `~/Motar-Controller/.env` set `STARTER_REGISTRATION=true`, then
   `docker compose --profile db up -d --build`.
3. Check: Factory Station > scan a starter from an uploaded sheet. The page says "Registered in AWS" and the zip is downloaded.

Revoking a lost starter is still done with `backend/scripts/provision_devices.py --revoke <ID> --apply` (see FACTORY_PROVISIONING.md).

## What is still done by hand

Putting the certificate and key onto the module (flashing). Fleet provisioning by claim removes even that, but needs firmware work (CLAIM_PROVISIONING.md).
