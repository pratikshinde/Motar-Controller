"""Move an admin (with everything of theirs) from the brand they were registered under to another brand.

    python scripts/move_admin_to_brand.py --email harish@example.com --brand ajanta            # dry run: shows what would change, changes nothing
    python scripts/move_admin_to_brand.py --email harish@example.com --brand ajanta --apply

For when an admin was registered under a company name that made a brand of its own (for example "Manya Pump Controllers" gave a brand "manya") but belongs to an
existing manufacturer's app (the Ajanta app only lists pumps of the brand "ajanta"). Everything of the admin follows: the admin and every person under them, their
pumps, their factory batches. The empty brand left behind is removed (never one that has an Android app of its own, and never one with another owner).

One transaction: either everything moves or nothing does. Run it on the server with:
    docker compose exec api python scripts/move_admin_to_brand.py --email <email> --brand ajanta [--apply]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, text  # noqa: E402

from app.models import AppBrand, DeviceBatch, Pump, User  # noqa: E402
from app.models.admin_invite import AdminInvite  # noqa: E402


class MoveError(Exception):
    pass


def move(db, email: str, target_key: str, apply: bool = False, remove_old: bool = True) -> dict:
    """Returns what was (or, in a dry run, would be) changed. Raises MoveError with a plain reason."""
    db.execute(text("SET app.bypass_rls = 'on';"))
    email = (email or "").strip().lower()
    admin = db.query(User).filter(func.lower(User.email) == email, User.role == "manufacturer").first()
    if admin is None:
        raise MoveError(f"No admin (manufacturer account) with the email {email}.")
    target = db.query(AppBrand).filter(AppBrand.key == target_key.strip().lower()).first()
    if target is None:
        raise MoveError(f"There is no brand '{target_key}'.")
    source = db.query(AppBrand).filter(AppBrand.owner_user_id == admin.id).first()
    if source is None and admin.brand_id is not None:
        source = db.query(AppBrand).filter(AppBrand.id == admin.brand_id).first()
    if source is None:
        raise MoveError("That admin has no brand to move away from.")
    if source.id == target.id:
        raise MoveError(f"The admin is already on the brand '{target.key}'. Nothing to do.")
    if target.owner_user_id is not None and target.owner_user_id != admin.id:
        raise MoveError(f"The brand '{target.key}' already has another admin. Nothing was changed.")
    if source.android_package:
        raise MoveError(f"The brand '{source.key}' has an Android app of its own ({source.android_package}); it is not moved.")

    counts = {
        "users": db.query(User).filter(User.brand_id == source.id).count(),
        "pumps": db.query(Pump).filter(Pump.brand_id == source.id).count(),
        "batches": db.query(DeviceBatch).filter(DeviceBatch.brand_id == source.id).count(),
    }
    result = {"admin": admin.email, "from": source.key, "to": target.key, **counts, "removes_old_brand": bool(remove_old), "applied": False}
    if not apply:
        return result

    try:
        source_key, source_phone, source_email = source.key, source.support_phone, source.support_email
        source.owner_user_id = None
        db.flush()
        target.owner_user_id = admin.id
        if not target.support_phone and source_phone:
            target.support_phone = source_phone
        if not target.support_email and source_email:
            target.support_email = source_email
        db.query(User).filter(User.brand_id == source.id).update({"brand_id": target.id}, synchronize_session=False)
        db.query(Pump).filter(Pump.brand_id == source.id).update({"brand_id": target.id}, synchronize_session=False)
        db.query(DeviceBatch).filter(DeviceBatch.brand_id == source.id).update({"brand_id": target.id}, synchronize_session=False)
        db.query(AdminInvite).filter(AdminInvite.brand_key == source_key).update({"brand_key": target.key}, synchronize_session=False)
        db.flush()
        if remove_old:
            db.delete(source)
        db.commit()
    except Exception:
        db.rollback()
        raise
    try:
        from app.services import brand_service

        brand_service.forget(target.key)
        brand_service.forget(source_key)
    except Exception:
        pass
    result["applied"] = True
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--email", required=True, help="the admin's email")
    ap.add_argument("--brand", required=True, help="the brand key to move them to (for example ajanta)")
    ap.add_argument("--apply", action="store_true", help="really make the change (without it nothing is changed)")
    ap.add_argument("--keep-old-brand", action="store_true", help="do not remove the now-empty old brand")
    args = ap.parse_args()

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        try:
            r = move(db, args.email, args.brand, apply=args.apply, remove_old=not args.keep_old_brand)
        except MoveError as exc:
            print(f"Refused: {exc}")
            return 1
    finally:
        db.close()
    print(("DONE" if r["applied"] else "DRY RUN (nothing changed)") + f": {r['admin']}: brand '{r['from']}' -> '{r['to']}'")
    print(f"  people on the brand: {r['users']}   pumps: {r['pumps']}   factory batches: {r['batches']}")
    print(f"  the old brand '{r['from']}' is {'removed' if r['removes_old_brand'] else 'kept'}")
    if not r["applied"]:
        print("Run it again with --apply to make the change.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
