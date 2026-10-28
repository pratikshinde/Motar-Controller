"""AWS IoT Fleet Provisioning pre-provisioning hook (SRS 5.2.1, FR-CLD-010..019).

AWS calls this before it issues a device certificate. The factory whitelist lives in the backend, so this only forwards
the request to `POST /api/v1/batches/provisioning/pre-hook` and relays the verdict. It fails closed: anything other
than a clear "allow" from the backend means no certificate.

Identity: the serial the device presents is its dev_id. It is the thing name, the MQTT client id and the pump id, so
the hook refuses a verdict whose ThingName differs from the serial that was asked about.

Environment (Lambda configuration):
    BACKEND_HOOK_URL   https://<backend>/api/v1/batches/provisioning/pre-hook
    HOOK_SECRET        same value as the backend's PROVISIONING_HOOK_SECRET (sent as X-Hook-Secret)
    HOOK_TIMEOUT_S     optional, seconds to wait for the backend (default 8; the Lambda timeout should be higher)
"""
import json
import os
import urllib.request

_FORWARDED = ("claimCertificateId", "certificateId", "clientId", "parameters")


def _deny(reason):
    # Goes to CloudWatch Logs. Never log the secret or the backend's raw body.
    print(json.dumps({"event": "provisioning_denied", "reason": reason}))
    return {"allowProvisioning": False}


def lambda_handler(event, context):
    params = event.get("parameters") if isinstance(event, dict) else None
    serial = str((params or {}).get("SerialNumber") or "").strip()
    if not serial:
        return _deny("no SerialNumber in the request")

    try:
        request = urllib.request.Request(
            os.environ["BACKEND_HOOK_URL"],
            data=json.dumps({key: event.get(key) for key in _FORWARDED}).encode(),
            headers={"Content-Type": "application/json", "X-Hook-Secret": os.environ["HOOK_SECRET"]},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=float(os.environ.get("HOOK_TIMEOUT_S", "8"))) as response:
            verdict = json.load(response)
    except Exception as exc:  # HTTP 4xx/5xx, timeout, DNS, bad JSON, missing configuration: all mean "no"
        return _deny(f"backend call failed: {type(exc).__name__}")

    if verdict.get("allowProvisioning") is not True:
        return _deny(str(verdict.get("error") or "backend refused"))

    overrides = verdict.get("parameterOverrides") or {}
    if overrides.get("ThingName") != serial:
        return _deny("ThingName does not equal the serial that was presented")

    print(json.dumps({"event": "provisioning_allowed", "thing": serial}))
    return {
        "allowProvisioning": True,
        # AWS wants string values
        "parameterOverrides": {key: str(value) for key, value in overrides.items()},
    }
