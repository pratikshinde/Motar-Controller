"""Register a SolarLogger (M66 module) as a SOLAR_VFD device, so its readings are kept and show in the app.

    python scripts/add_solar_logger.py --imei 862818041287022 --admin-email admin@example.com            # dry run
    python scripts/add_solar_logger.py --imei 862818041287022 --admin-email admin@example.com --apply

The device id is the module's IMEI: it is also the AWS IoT thing name, the MQTT client id and `dev_id` in every frame. The device is created in the
admin's account tree, with the admin's brand. The admin then gives it to a user on the website (Devices > Allocate).

Run it on the server with:
    docker compose exec api python scripts/add_solar_logger.py --imei <IMEI> --admin-email <email> [--apply]
"""
import argparse
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, text  # noqa: E402

from app.models import DeviceConfig, Pump, User  # noqa: E402
from app.services.jwt_auth import hash_secret  # noqa: E402


def add_logger(db, imei: str, admin_email: str, name: str = "", hp: float = 7.5, apply: bool = False):
    """Returns a one-line description of what was (or would be) created. Raises ValueError with the reason when it cannot be done."""
    imei = (imei or "").strip()
    if not (imei.isdigit() and len(imei) == 15):
        raise ValueError("The IMEI must be 15 digits.")
    db.execute(text("SET app.bypass_rls = 'on';"))
    email = (admin_email or "").strip().lower()
    admin = db.query(User).filter(func.lower(User.email) == email).first() if email else None
    if admin is None or admin.role != "manufacturer":
        raise ValueError(f"There is no admin (manufacturer) account with the email '{admin_email}'.")
    if admin.brand_id is None:
        raise ValueError("That admin has no brand, so the logger would not belong to any app.")
    if db.query(Pump.id).filter(Pump.id == imei).first():
        raise ValueError(f"A device with id {imei} already exists.")
    label = (name or "").strip() or f"SolarLogger {imei[-4:]}"
    summary = f"SOLAR_VFD device {imei} '{label}' for admin {admin.email} (brand id {admin.brand_id})"
    if not apply:
        return "Would create " + summary
    pump = Pump(
        id=imei,
        name=label,
        device_type="SOLAR_VFD",
        supply_type="3-phase",
        hp_rating=hp,
        owner_user_id=admin.id,
        hierarchy_path=admin.hierarchy_path,
        org_id=getattr(admin, "org_id", None),
        brand_id=admin.brand_id,
        status="STOPPED",
        lifecycle_state="ACTIVE",
        firmware_version=None,                       # the logger reports its own
        device_key_hash=hash_secret(secrets.token_urlsafe(32)),   # the logger signs in to AWS IoT with its certificate, not this key
    )
    db.add(pump)
    db.add(DeviceConfig(pump_id=imei, desired_json={}, reported_json={}, status="APPLIED"))
    db.commit()
    return "Created " + summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--imei", required=True, help="the module's 15-digit IMEI (= the AWS thing name)")
    ap.add_argument("--admin-email", required=True, help="the email of the brand's admin who owns the device")
    ap.add_argument("--name", default="", help="a name for the device (default: SolarLogger plus the last 4 digits)")
    ap.add_argument("--hp", type=float, default=7.5, help="pump rating in HP (default 7.5)")
    ap.add_argument("--apply", action="store_true", help="really create it (without this nothing changes)")
    args = ap.parse_args(argv)
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        print(add_logger(db, args.imei, args.admin_email, args.name, args.hp, apply=args.apply))
    except ValueError as exc:
        print(f"STOPPED: {exc}")
        return 2
    finally:
        db.close()
    if not args.apply:
        print("This was a dry run. Add --apply to create it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
