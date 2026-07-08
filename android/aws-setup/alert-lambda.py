"""
Triggered by an AWS IoT Rule, pushes an FCM notification to topic "pump-<thingName>".

IoT Rule SQL examples for the 3-phase system (Message routing -> Rules):

  Phase sequence reverse:
    SELECT * FROM 'pumps/WaterPump01/telemetry' WHERE seqReverse = true

  Phase missing:
    SELECT * FROM 'pumps/WaterPump01/telemetry'
    WHERE pRY = false OR pYB = false OR pBR = false

  Overcurrent (adjust to motor rating):
    SELECT * FROM 'pumps/WaterPump01/telemetry'
    WHERE iR > 15 OR iY > 15 OR iB > 15

  Under/over voltage on a 440V system:
    SELECT * FROM 'pumps/WaterPump01/telemetry'
    WHERE vRY < 380 OR vYB < 380 OR vBR < 380
       OR vRY > 480 OR vYB > 480 OR vBR > 480

  Firmware-reported faults:
    SELECT * FROM 'pumps/WaterPump01/telemetry' WHERE size(faults) > 0

Setup:
 1. Firebase console -> Project settings -> Service accounts -> generate private key.
 2. Store the JSON in AWS Secrets Manager as "fcm-service-account".
 3. Lambda deps: google-auth, requests (package as a layer or zip).
"""
import json
import boto3
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

FCM_PROJECT_ID = "your-firebase-project-id"
SECRET_NAME = "fcm-service-account"
THING_NAME = "WaterPump01"
MAX_CURRENT_A = 15
V_MIN, V_MAX = 380, 480

_secrets = boto3.client("secretsmanager")


def _access_token():
    sa_json = json.loads(_secrets.get_secret_value(SecretId=SECRET_NAME)["SecretString"])
    creds = service_account.Credentials.from_service_account_info(
        sa_json, scopes=["https://www.googleapis.com/auth/firebase.messaging"])
    creds.refresh(Request())
    return creds.token


def _classify(t):
    """Return (title, body, severity) or None. 't' is the telemetry that matched the rule."""
    if t.get("seqReverse"):
        return ("Phase sequence REVERSE",
                "Incorrect phase sequence detected. Pump blocked from starting.", "CRITICAL")

    missing = [n for n, k in (("RY", "pRY"), ("YB", "pYB"), ("BR", "pBR")) if t.get(k) is False]
    if missing:
        return ("Phase missing", f"Line(s) {', '.join(missing)} not present.", "CRITICAL")

    over = {p: t.get(k, 0) for p, k in (("R", "iR"), ("Y", "iY"), ("B", "iB"))
            if t.get(k, 0) > MAX_CURRENT_A}
    if over:
        detail = ", ".join(f"{p}={a} A" for p, a in over.items())
        return ("Motor overcurrent", f"Phase current above {MAX_CURRENT_A} A: {detail}", "CRITICAL")

    volts = {ll: t.get(k, 0) for ll, k in (("RY", "vRY"), ("YB", "vYB"), ("BR", "vBR"))}
    bad = {ll: v for ll, v in volts.items() if v and (v < V_MIN or v > V_MAX)}
    if bad:
        detail = ", ".join(f"{ll}={v} V" for ll, v in bad.items())
        return ("Voltage out of range", f"Outside {V_MIN}-{V_MAX} V: {detail}", "WARNING")

    if t.get("faults"):
        return ("Pump fault", "; ".join(t["faults"]), "CRITICAL")

    return None


def handler(event, context):
    alert = _classify(event)
    if not alert:
        return {"skipped": True}
    title, body, sev = alert

    message = {
        "message": {
            "topic": f"pump-{THING_NAME}",
            "notification": {"title": title, "body": body},
            "data": {"severity": sev, "title": title, "message": body},
            "android": {"priority": "HIGH"},
        }
    }

    resp = requests.post(
        f"https://fcm.googleapis.com/v1/projects/{FCM_PROJECT_ID}/messages:send",
        headers={"Authorization": f"Bearer {_access_token()}",
                 "Content-Type": "application/json"},
        json=message,
        timeout=10,
    )
    return {"fcm_status": resp.status_code}
