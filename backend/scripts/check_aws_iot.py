"""Check the backend's link to AWS IoT Core, without the app or the database.

    python scripts/check_aws_iot.py [--pump-id aws-check]

It reads the same settings (backend/.env) and uses the same publisher class as the backend, so a pass here means a
command from the app will reach the broker. It publishes ONE harmless message to devices/<pump-id>/commands. The default
id is not a real pump, so nothing listening for a real device can act on it. Watch it arrive in the AWS console:
IoT Core > MQTT test client > subscribe to  devices/#

Credentials come from boto3's normal chain (environment variables, then %USERPROFILE%\\.aws\\credentials), never from
this repository. Nothing secret is printed.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.services.iot_publisher import AwsIotPublisher, PublishError, apply_network_preference, command_topic

HINTS = (
    ("not authorized", "The IAM user may not publish here: it needs iot:Publish on topic/devices/*/commands (aws/policies/backend-iam-policy.json)."),
    ("accessdenied", "The IAM user may not publish here: it needs iot:Publish on topic/devices/*/commands (aws/policies/backend-iam-policy.json)."),
    ("invalidsignature", "The secret access key does not match the access key id. Re-copy both from the IAM console."),
    ("signaturedoesnotmatch", "The secret access key does not match the access key id. Re-copy both from the IAM console."),
    ("unrecognizedclient", "AWS does not know this access key id (typo, or the key was deleted or deactivated)."),
    ("could not connect", "The endpoint is unreachable. Check IOT_DATA_ENDPOINT (IoT Core > Settings > Device data endpoint) and the internet connection."),
    ("name or service", "The endpoint name does not resolve. Check IOT_DATA_ENDPOINT."),
    ("nodename", "The endpoint name does not resolve. Check IOT_DATA_ENDPOINT."),
)


def _masked(key_id: str) -> str:
    return f"{key_id[:4]}...{key_id[-4:]}" if len(key_id) > 8 else "****"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pump-id", default="aws-check", help="topic suffix to publish to (default: a non-existent device)")
    args = ap.parse_args()

    mode = settings.publish_mode()
    print(f"IOT_PUBLISH_MODE : {mode}" + ("" if mode == "aws" else "   <- the backend will NOT publish to AWS; set IOT_PUBLISH_MODE=aws in backend/.env"))
    print(f"AWS_REGION       : {settings.AWS_REGION}")
    print(f"IOT_DATA_ENDPOINT: {settings.IOT_DATA_ENDPOINT or '(not set: boto3 would look it up, which needs iot:DescribeEndpoint)'}")

    apply_network_preference()  # IOT_FORCE_IPV4, so this check is not slowed by an IPv6 timeout either
    try:
        import boto3
    except ImportError:
        print("\nFAIL: boto3 is not installed.  python -m pip install boto3")
        return 1

    session = boto3.Session(region_name=settings.AWS_REGION)
    creds = session.get_credentials()
    if creds is None:
        print("\nFAIL: no AWS credentials found.")
        print("  Create  %USERPROFILE%\\.aws\\credentials  with:")
        print("      [default]")
        print("      aws_access_key_id = <your access key id>")
        print("      aws_secret_access_key = <your secret access key>")
        return 1
    print(f"Credentials      : {_masked(creds.access_key)} (from {getattr(creds, 'method', 'unknown')})")

    try:
        who = session.client("sts").get_caller_identity()
        print(f"AWS identity     : {who['Arn']}  (account {who['Account']})")
    except Exception as exc:
        print(f"\nFAIL: AWS rejected these credentials: {type(exc).__name__}: {exc}")
        return 1

    topic = command_topic(args.pump_id)
    message = {"v": 1, "check": True, "note": "connectivity check from scripts/check_aws_iot.py", "ts": int(time.time())}
    try:
        AwsIotPublisher().publish(topic, message)
    except PublishError as exc:
        text = str(exc)
        print(f"\nFAIL: publish to {topic} was refused ({exc.code}): {text}")
        for needle, hint in HINTS:
            if needle in text.lower():
                print(f"  Hint: {hint}")
                break
        return 1

    print(f"\nOK: published to {topic}. It should now be visible in the MQTT test client (subscribe to  devices/#).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
