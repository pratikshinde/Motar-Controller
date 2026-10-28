# AWS IoT setup files

Paste-in material for the manual AWS console setup (region `ap-south-1`). Replace `<ACCOUNT_ID>` first.
Nothing here is applied automatically.

**One identity string.** The serial a device presents is its `dev_id`. It is the IoT thing name, the MQTT client id
and `pumps.id`. The IoT policy binds the connection to the thing name, and the ingest worker finds the pump by the
authenticated client id, so these must be the same string.

| File | Where it goes |
|------|---------------|
| `policies/device-policy.json` | IoT Core > Security > Policies, name `agripump-device-policy` |
| `policies/claim-policy.json` | IoT Core > Security > Policies, name `agripump-claim-policy`; attach to the claim certificate only |
| `policies/iot-service-trust.json` | Trust policy for the two IAM roles below |
| `policies/rule-sqs-iam-policy.json` | Inline policy of role `agripump-iot-rule-sqs` |
| (managed policy `AWSIoTThingsRegistration`) | Role `agripump-iot-provisioning` |
| `policies/backend-iam-policy.json` | IAM user or role the backend runs as |
| `iot-rule.sql` | IoT Core > Message routing > Rules, action SQS to queue `agripump-ingest` |
| `provisioning-template.json` | IoT Core > Connect > Fleet provisioning templates, name `agripump-fleet` |
| `lambda/provisioning_hook.py` | Lambda `agripump-provisioning-hook` (Python 3.12), set as the template's pre-provisioning action |

Lambda environment: `BACKEND_HOOK_URL` and `HOOK_SECRET` (the backend's `PROVISIONING_HOOK_SECRET`).
Test the Lambda code without AWS: `python -m unittest aws/lambda/test_provisioning_hook.py`.

## Trying the whole loop without hardware

A virtual pump stands in for the controller and its bridge and talks to AWS IoT with its own certificate:

1. Create the queue `agripump-ingest` (with its dead-letter queue), the rule above, the device policy, and a thing named
   exactly like the pump id (for example `SWATI-DEMO-01`) with an auto-generated certificate that has the device policy
   attached. Save the three downloaded files in `%USERPROFILE%\.aws\iot\<thing>\`.
2. `backend/.env`: `SQS_INGEST_URL=<queue url>` and `IOT_PUBLISH_MODE=aws`.
3. Run, each in its own window, from the `backend` folder: `python simulator/virtual_pump.py` (the pump) and
   `python -m app.workers.ingest` (reads the queue). Do not run `simulator/device_simulator.py` for the same pump.
4. Press Start or Stop in the app. `python scripts/show_commands.py` shows each command's status.

Never put certificates or private keys in this folder.
