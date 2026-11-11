# Provisioning by claim: a starter gets its own AWS certificate by itself

**Goal:** nobody touches AWS per starter. The module is flashed with one shared *claim certificate*; on its first power-up it asks AWS for a certificate of its
own, AWS asks the backend "is this ID on the factory list, and unused?", and if so creates the thing and the certificate. The module keeps its own key.

## The flow

    module (claim certificate, client id claim-<ID>)          AWS IoT                        Lambda                 backend
      1. makes its own key + a signing request (CSR) ------>  issues a certificate
      2. sends its ID + the ownership token ---------------->  calls the pre-provisioning hook ----->  asks -------->  is <ID> on the factory list,
                                                                                                                       not revoked, not yet claimed?
                                                                 creates the thing <ID>, attaches the  <------ yes / no <-----  (yes: creates the pump as stock, marks it claimed)
                                                                 device policy to the new certificate
      3. keeps certificate + own key, reconnects as <ID>

The private key is made on the module and never travels. The ID must be on the factory list first (website > Factory console > batch > import).

## Files

| File | What it is |
|---|---|
| `provisioning-template.json`, `policies/claim-policy.json`, `policies/device-policy.json`, `lambda/provisioning_hook.py` | the AWS side (already in the project) |
| `backend/scripts/deploy_claim_provisioning.py` | creates all of it in AWS in one go, safe to rerun (`app/services/claim_deployment.py`) |
| `backend/simulator/claim_device.py` | a stand-in for a module: does the claim for real against AWS (`app/services/claim_flow.py` is the same logic the firmware must follow) |
| `backend/app/api/batches.py` (`/provisioning/pre-hook`) | the backend's check |

## One-time setup

1. **A public HTTPS address for the backend.** AWS calls the backend when a starter claims, so it must be reachable from the internet (the laptop on Wi-Fi is not).
   The address AWS needs is `https://<your-backend>/api/v1/batches/provisioning/pre-hook`.
2. **`PROVISIONING_HOOK_SECRET`** in the backend's `.env` (at least 24 random characters; the backend refuses the hook without it outside development).
   The same value is given to the Lambda by the deploy script.
3. **An AWS profile that may create IAM roles, Lambdas and IoT resources**, only for this one setup, for example an administrator user's key saved as the profile
   `[agripump-admin]` in `%USERPROFILE%\.aws\credentials`. Switch that key off in IAM when you are done. The script refuses to run as the backend user.
4. From the `backend` folder:

       python scripts/deploy_claim_provisioning.py --backend-url https://<your-backend>/api/v1/batches/provisioning/pre-hook            # dry run
       python scripts/deploy_claim_provisioning.py --backend-url https://<your-backend>/api/v1/batches/provisioning/pre-hook --apply

   It creates the two policies, the two IAM roles, the Lambda (with the backend address and secret), the thing groups, the template `agripump-fleet` and the claim
   certificate. The claim certificate and key are saved in `%USERPROFILE%\.aws\iot-claim\` (they go into the module firmware; never commit them).
5. Try it with the stand-in module: `python simulator/claim_device.py --serial <an ID on the factory list>`.

## The factory process

1. **Upload the batch's Excel sheet** on the website: *Factory Station* > "1. Upload the batch sheet" (download the template there). One row per starter:
   **Starter ID** (the barcode on the box; required) and optionally IMEI, HP, Supply (3-phase / 1-phase), Model, HW revision, Manufacture date, Notes. The whole
   sheet is checked first: if any row has a problem nothing is saved and every problem is listed by row. This is the factory list that AWS's check uses.
2. Flash every module with the same firmware, which carries the claim certificate.
3. **Scan each starter's barcode** at *Factory Station* > "2. Scan a starter" (a USB scanner types the code and presses Enter; the camera works where the browser supports it).
   The page shows that starter's row from the sheet (HP, supply, model, ...), records the **bench test** (pass / fail with a note), and shows its progress by itself.
4. **First power-up at the factory**, as part of the factory test, with mobile signal: the module claims its own certificate. After this the ID is used up: a
   second claim of the same ID is refused. Nothing unclaimed leaves the factory, so the shared claim certificate has nothing useful left to steal.
5. The dealer registers the farmer with the starter ID (its HP and details already came from the sheet). Nothing in AWS changes.

## Safety rules (why it is built this way)

* The claim certificate may only ask for a certificate; it cannot read data or command anything.
* An ID is claimed once, and only if it is on the factory list and its batch is not revoked.
* The thing name must equal the ID the module presented (`ThingName == SerialNumber`, checked by the Lambda).
* Each starter has its own certificate: a lost or stolen one can be switched off alone (`provision_devices.py --revoke <ID>`).
* If the claim certificate ever leaks, switch it off in IoT Core. Modules that already have their own certificate keep working; only unclaimed ones are affected.

## Still to do (not done yet)

* **The module firmware** has to do steps 1 to 3 (make the key and CSR, the two MQTT exchanges, keep the certificate in flash, reconnect). `claim_flow.py` is the reference.
* **A power cut half way through a claim.** The backend marks the ID claimed before AWS finishes, so a module that lost power at that moment cannot retry. The
  existing note in the hook says this needs a decision (SRS AC-20).
* **Real-AWS test.** Everything above is tested with simulated AWS answers; the real run needs the public backend address and the one-time setup.
