"""Factory tool: create each starter's AWS IoT identity (thing + certificate + key) from the factory list of starter IDs.

    python scripts/provision_devices.py --file starters.txt                 # DRY RUN: shows what it would do, creates nothing
    python scripts/provision_devices.py --file starters.txt --apply         # really creates them
    python scripts/provision_devices.py --ids AJ-0001,AJ-0002 --apply
    python scripts/provision_devices.py --revoke AJ-0001 --apply            # switch a starter's certificate off (lost / stolen / returned)

The starter ID is the barcode on the box. It becomes the AWS thing name, the MQTT client id and the pump id (one string, everywhere).
Output: one folder per starter under --out (default %USERPROFILE%\\.aws\\iot-factory\\<ID>\\) holding its certificate, private key,
public key and the Amazon root CA, ready to be loaded onto that module; and a manifest-*.csv that lists what happened (no keys in it).

Credentials: a separate AWS profile for the factory (default `agripump-factory`), never the backend's. The tool refuses to run as the
backend user. See aws/FACTORY_PROVISIONING.md for what that profile needs (aws/policies/factory-provisioning-iam-policy.json).
Private keys are never printed and never go anywhere but the output folder. Keep that folder out of git (*.pem / *.key already are).
"""
import argparse
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.services.device_provisioning import (
    CREATED, EXISTS, FAILED, FactoryProvisioner, INVALID, ProvisioningError, REVOKED, WOULD_CREATE, WOULD_REVOKE, parse_ids,
)
from app.services.iot_publisher import apply_network_preference

ROOT_CA_URL = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"
BACKEND_USER = "agripump-backend"


def default_out() -> str:
    return os.path.join(os.path.expanduser("~"), ".aws", "iot-factory")


def find_root_ca(explicit):
    """The Amazon root CA: the file given, else one saved next to an earlier device's files, else downloaded from Amazon."""
    if explicit:
        with open(explicit, "rb") as fh:
            return fh.read()
    for base in (os.path.join(os.path.expanduser("~"), ".aws", "iot"), default_out()):
        if os.path.isdir(base):
            for name in os.listdir(base):
                path = os.path.join(base, name, "AmazonRootCA1.pem")
                if os.path.isfile(path):
                    with open(path, "rb") as fh:
                        return fh.read()
    try:
        with urllib.request.urlopen(ROOT_CA_URL, timeout=10) as res:       # a public certificate, not a secret
            data = res.read()
        return data if b"BEGIN CERTIFICATE" in data else None
    except Exception:
        return None


def backend_stock(ids):
    """Which of these starter IDs already exist as pumps in the backend (read only). None when the database cannot be reached."""
    try:
        from sqlalchemy import text
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            db.execute(text("SET app.bypass_rls = 'on'"))
            rows = db.execute(text("SELECT id FROM agripump.pumps WHERE id = ANY(:ids)"), {"ids": list(ids)}).fetchall()
            return {r[0] for r in rows}
        finally:
            db.close()
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--file", help="text or CSV file with one starter ID per line (a header line such as starter_id is skipped)")
    src.add_argument("--ids", help="starter IDs separated by commas")
    src.add_argument("--revoke", help="starter IDs (commas) whose certificates should be switched off")
    ap.add_argument("--apply", action="store_true", help="really do it (without this nothing is created or changed)")
    ap.add_argument("--profile", default="agripump-factory", help="AWS profile in %%USERPROFILE%%\\.aws\\credentials (default: agripump-factory)")
    ap.add_argument("--region", default=settings.AWS_REGION)
    ap.add_argument("--policy", default="agripump-device-policy", help="the IoT policy attached to each certificate")
    ap.add_argument("--out", default=default_out(), help="where the per-starter folders and the manifest go")
    ap.add_argument("--root-ca", help="path to AmazonRootCA1.pem (default: reuse one already on this PC, else download it)")
    ap.add_argument("--no-backend-check", action="store_true", help="do not look the IDs up in the backend database")
    args = ap.parse_args()

    if args.revoke:
        ids, refused = parse_ids(args.revoke.replace(",", "\n"))
    elif args.ids:
        ids, refused = parse_ids(args.ids.replace(",", "\n"))
    else:
        with open(args.file, encoding="utf-8-sig") as fh:
            ids, refused = parse_ids(fh.read())
    for r in refused:
        print(f"REFUSED  {r}")
    if not ids:
        print("No valid starter IDs to work on.")
        return 2

    apply_network_preference()
    import boto3
    from botocore.exceptions import NoCredentialsError, ProfileNotFound

    try:
        session = boto3.Session(profile_name=args.profile, region_name=args.region)
        who = session.client("sts").get_caller_identity()["Arn"]
    except ProfileNotFound:
        print(f"The AWS profile '{args.profile}' does not exist. Add a [{args.profile}] section to %USERPROFILE%\\.aws\\credentials "
              "(see aws/FACTORY_PROVISIONING.md).")
        return 2
    except NoCredentialsError:
        print(f"The AWS profile '{args.profile}' has no credentials.")
        return 2
    except Exception as exc:
        print(f"Could not log in to AWS with profile '{args.profile}': {type(exc).__name__}: {str(exc)[:200]}")
        return 2
    if who.endswith(f"/{BACKEND_USER}"):
        print(f"Refusing to run as the backend user ({who}). Use the separate factory profile (--profile).")
        return 2

    print(f"AWS identity : {who}")
    print(f"Region       : {args.region}")
    print(f"Policy       : {args.policy}")
    print(f"Output folder: {args.out}")
    print(f"Mode         : {'APPLY (changes AWS)' if args.apply else 'DRY RUN (nothing is created)'}")
    print(f"Starters     : {len(ids)}\n")

    root_ca = None if args.revoke else find_root_ca(args.root_ca)
    if not args.revoke and root_ca is None:
        print("Note: the Amazon root CA could not be found or downloaded; it will not be saved with the keys (pass --root-ca).")

    tool = FactoryProvisioner(session.client("iot"), args.policy, args.out, root_ca_pem=root_ca, apply=args.apply)
    try:
        if not args.revoke:
            tool.check_policy()
        results = tool.revoke(ids) if args.revoke else tool.provision(ids)
    except ProvisioningError as exc:
        print(f"STOPPED: {exc}")
        return 2

    in_stock = None if (args.revoke or args.no_backend_check) else backend_stock(ids)
    for r in results:
        line = f"{r.status.upper():12} {r.starter_id:24} {r.detail}"
        if in_stock is not None and r.status in (CREATED, WOULD_CREATE, EXISTS) and r.starter_id not in in_stock:
            line += "  [NOT in the backend yet: import the factory list on the website, or its readings are ignored]"
        print(line)

    kind = "revoke" if args.revoke else "provision"
    manifest = tool.write_manifest(results, kind)
    done = {s: sum(1 for r in results if r.status == s) for s in {r.status for r in results}}
    print(f"\nSummary: {done}")
    print(f"Manifest: {manifest}")
    if not args.apply and any(r.status in (WOULD_CREATE, WOULD_REVOKE) for r in results):
        print("\nThis was a dry run. Add --apply to do it.")
    if args.apply and any(r.status == CREATED for r in results):
        print("\nThe private keys are in the output folder, one per starter. They cannot be downloaded from AWS again: back that folder up securely.")
    return 1 if any(r.status in (FAILED, INVALID) for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
