"""One-time AWS setup for provisioning by claim: policies, roles, the Lambda, the template and the claim certificate.

    python scripts/deploy_claim_provisioning.py --backend-url https://api.example.com/api/v1/batches/provisioning/pre-hook          # DRY RUN
    python scripts/deploy_claim_provisioning.py --backend-url https://api.example.com/api/v1/batches/provisioning/pre-hook --apply

The backend URL must be public HTTPS: AWS calls it when a starter asks for its certificate. The Lambda is given the backend's
PROVISIONING_HOOK_SECRET (backend/.env), which the backend checks on every call.

Credentials: an AWS profile with permission to create IAM roles, Lambda functions and IoT resources (default profile `agripump-admin`). It is used for
this one setup and can then be switched off. The tool refuses to run as the backend user. Safe to rerun: it only creates what is missing.
The claim certificate and key are saved to %USERPROFILE%\\.aws\\iot-claim\\ (they go into the module firmware); they are shown to nobody.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.services.claim_deployment import ClaimDeployer, DeploymentError, Files
from app.services.iot_publisher import apply_network_preference

BACKEND_USER = "agripump-backend"
HERE = os.path.dirname(os.path.abspath(__file__))
AWS_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "aws"))


def _save_root_ca(claim_dir: str) -> None:
    """Amazon's public root CA goes next to the claim certificate (the module needs it to trust AWS). Reuses one already on this PC, else downloads it."""
    target = os.path.join(claim_dir, "AmazonRootCA1.pem")
    if os.path.isfile(target) or not os.path.isdir(claim_dir):
        return
    data = None
    base = os.path.join(os.path.expanduser("~"), ".aws", "iot")
    for name in (os.listdir(base) if os.path.isdir(base) else []):
        path = os.path.join(base, name, "AmazonRootCA1.pem")
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                data = fh.read()
            break
    if data is None:
        try:
            import urllib.request
            with urllib.request.urlopen("https://www.amazontrust.com/repository/AmazonRootCA1.pem", timeout=10) as res:
                data = res.read()
        except Exception:
            print("Note: could not get AmazonRootCA1.pem; copy it next to the claim certificate by hand.")
            return
    with open(target, "wb") as fh:
        fh.write(data)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend-url", required=True, help="the public HTTPS address of the backend's pre-provisioning hook")
    ap.add_argument("--apply", action="store_true", help="really create things (without it nothing is changed)")
    ap.add_argument("--update", action="store_true", help="also replace things that exist but differ from the project's files (needs --apply)")
    ap.add_argument("--profile", default="agripump-admin", help="AWS profile to use (default: agripump-admin)")
    ap.add_argument("--region", default=settings.AWS_REGION)
    ap.add_argument("--claim-dir", default=os.path.join(os.path.expanduser("~"), ".aws", "iot-claim"))
    args = ap.parse_args()

    apply_network_preference()
    import boto3
    from botocore.exceptions import NoCredentialsError, ProfileNotFound

    try:
        session = boto3.Session(profile_name=args.profile, region_name=args.region)
        identity = session.client("sts").get_caller_identity()
    except ProfileNotFound:
        print(f"The AWS profile '{args.profile}' does not exist in %USERPROFILE%\\.aws\\credentials (see aws/CLAIM_PROVISIONING.md).")
        return 2
    except NoCredentialsError:
        print(f"The AWS profile '{args.profile}' has no credentials.")
        return 2
    except Exception as exc:
        print(f"Could not log in to AWS with profile '{args.profile}': {type(exc).__name__}: {str(exc)[:200]}")
        return 2
    arn, account = identity["Arn"], identity["Account"]
    if arn.endswith(f"/{BACKEND_USER}"):
        print(f"Refusing to run as the backend user ({arn}). Use an administrator profile for this one-time setup (--profile).")
        return 2

    print(f"AWS identity : {arn}")
    print(f"Region       : {args.region}")
    print(f"Backend hook : {args.backend_url}")
    print(f"Mode         : {'APPLY (changes AWS)' if args.apply else 'DRY RUN (nothing is created)'}{' + update differing items' if args.update else ''}\n")

    try:
        deployer = ClaimDeployer(
            {name: session.client(name) for name in ("iot", "iam", "lambda")}, account, args.region, Files.load(AWS_DIR),
            args.claim_dir, args.backend_url, settings.PROVISIONING_HOOK_SECRET, apply=args.apply, update=args.update,
        )
        steps = deployer.run()
    except DeploymentError as exc:
        print(f"STOPPED: {exc}")
        return 2
    for s in steps:
        print(f"{s.status.upper():13} {s.name}" + (f"  - {s.detail}" if s.detail else ""))
    if args.apply:
        _save_root_ca(args.claim_dir)
    if not args.apply:
        print("\nThis was a dry run. Add --apply to do it.")
    else:
        print("\nDone. Next: put the claim certificate and key (from the claim folder) into the module firmware, and run simulator/claim_device.py to try the whole claim.")
    return 1 if any(s.status == "differs" for s in steps) else 0


if __name__ == "__main__":
    sys.exit(main())
