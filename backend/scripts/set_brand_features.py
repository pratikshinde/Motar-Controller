"""Turn on a brand's own rules (brands.features) without a second backend.

    python scripts/set_brand_features.py --key swati --set hierarchy=admin_users --set admin_login=email_code            # dry run
    python scripts/set_brand_features.py --key swati --set hierarchy=admin_users --set admin_login=email_code --apply

Rules the backend reads today:
    hierarchy=admin_users     super admin > admin > users: the admin adds users directly, no distributors or dealers.
    admin_login=email_code    the admin signs in with a code emailed to them, never with a password.
(Other keys, such as push or qrScan, are for the mobile app's own settings and are kept as they are.)
Use --unset <name> to remove a rule. The API reads brand settings with a short cache (30 s), so a change shows within half a minute.

Run it on the server with:
    docker compose exec api python scripts/set_brand_features.py --key swati --set hierarchy=admin_users --set admin_login=email_code [--apply]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.models import AppBrand  # noqa: E402

KNOWN = {
    "hierarchy": {"admin_users", "full"},
    "admin_login": {"email_code", "password"},
}


def parse_sets(pairs):
    out = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise ValueError(f"--set {pair!r}: use name=value")
        name, value = pair.split("=", 1)
        name, value = name.strip(), value.strip()
        if name in KNOWN and value not in KNOWN[name]:
            raise ValueError(f"{name}: allowed values are {', '.join(sorted(KNOWN[name]))}")
        if not name or len(name) > 40 or len(value) > 40:
            raise ValueError(f"--set {pair!r}: name and value must be short")
        out[name] = True if value.lower() == "true" else False if value.lower() == "false" else value
    return out


def change(db, key, sets, unsets, apply=False):
    """(before, after) features of the brand; saved only with apply=True. Raises LookupError for an unknown brand."""
    db.execute(text("SET app.bypass_rls = 'on';"))
    brand = db.query(AppBrand).filter(AppBrand.key == key.strip().lower()).first()
    if brand is None:
        raise LookupError(f"There is no brand '{key}'.")
    before = dict(brand.features or {})
    after = dict(before)
    after.update(sets)
    for name in unsets or []:
        after.pop(name, None)
    if apply and after != before:
        brand.features = after
        db.commit()
    return before, after


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--key", required=True, help="the brand key, for example swati")
    ap.add_argument("--set", action="append", dest="sets", metavar="NAME=VALUE")
    ap.add_argument("--unset", action="append", dest="unsets", metavar="NAME")
    ap.add_argument("--apply", action="store_true", help="really save it (without this nothing changes)")
    args = ap.parse_args(argv)
    try:
        sets = parse_sets(args.sets)
    except ValueError as exc:
        print(f"STOPPED: {exc}")
        return 2
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        before, after = change(db, args.key, sets, args.unsets, apply=args.apply)
    except LookupError as exc:
        print(f"STOPPED: {exc}")
        return 2
    finally:
        db.close()
    print(f"Brand        : {args.key}")
    print(f"Features now : {before}")
    print(f"Features then: {after}")
    if before == after:
        print("Nothing to change.")
    elif args.apply:
        print("Saved.")
    else:
        print("This was a dry run. Add --apply to save it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
