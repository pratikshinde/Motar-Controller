"""Create the two website logins: the Ajanta admin and the super admin. Each signs in with an email and a password.

    python scripts/create_portal_accounts.py --role superadmin    --name "Platform Owner" --email owner@example.com
    python scripts/create_portal_accounts.py --role ajanta-admin  --name "Ajanta Admin"   --email admin@ajanta.example

* The Ajanta admin registers farmers, manages the starters and sees everything of Ajanta. It is the Ajanta brand's own account.
* The super admin only monitors (see SUPERADMIN_MONITOR_ONLY in backend/.env) and can open the Ajanta dashboard read-only.

The password is asked for here (hidden) and typed twice; it is never printed, never put on the command line and stored only as a
hash. For a non-interactive run set PORTAL_PASSWORD in the environment instead. At least 10 characters.
A superadmin has no authenticator yet, so its first sign-in is forced through authenticator (TOTP) setup.
"""
import argparse
import getpass
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, text

from app.database import SessionLocal
from app.models import AppBrand, User
from app.services.jwt_auth import hash_secret

MIN_PASSWORD = 10
BRAND_KEY = "ajanta"


class AccountError(Exception):
    """Something the person running the script can fix (message is for them)."""


def create_account(db, role_key: str, name: str, email: str, password: str, replace_owner: bool = False) -> User:
    """Add the account (no commit). `role_key` is "superadmin" or "ajanta-admin"."""
    email = (email or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise AccountError("Enter a valid email address.")
    if len(password or "") < MIN_PASSWORD:
        raise AccountError(f"The password must be at least {MIN_PASSWORD} characters.")
    if db.query(User.id).filter(func.lower(User.email) == email).first():
        raise AccountError(f"{email} already has an account.")
    new_id = uuid.uuid4()

    if role_key == "superadmin":
        user = User(
            id=new_id, full_name=name.strip(), email=email, password_hash=hash_secret(password), role="superadmin",
            hierarchy_path="/SA", account_status="ACTIVE", is_active=True, is_verified=True,
        )
        db.add(user)
        return user

    if role_key != "ajanta-admin":
        raise AccountError("The role must be superadmin or ajanta-admin.")
    brand = db.query(AppBrand).filter(AppBrand.key == BRAND_KEY).first()
    if brand is None:
        raise AccountError("The Ajanta brand does not exist yet. Run `alembic upgrade head` first.")
    if brand.owner_user_id is not None and not replace_owner:
        raise AccountError("The Ajanta brand already has an owner account. Pass --replace-owner to make this one the owner.")
    user = User(
        id=new_id, full_name=name.strip(), email=email, password_hash=hash_secret(password), role="manufacturer",
        hierarchy_path=f"/SA/{new_id}", brand_id=brand.id, account_status="ACTIVE", is_active=True, is_verified=True,
    )
    db.add(user)
    db.flush()
    # The brand's owner account IS the manufacturer: its tree is what the super admin sees when opening the Ajanta dashboard.
    brand.owner_user_id = user.id
    return user


def _ask_password() -> str:
    env = os.environ.get("PORTAL_PASSWORD")
    if env:
        return env
    first = getpass.getpass("Password (hidden, at least 10 characters): ")
    if first != getpass.getpass("Type it again: "):
        raise AccountError("The two passwords are not the same.")
    return first


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--role", required=True, choices=["superadmin", "ajanta-admin"])
    ap.add_argument("--name", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--replace-owner", action="store_true", help="ajanta-admin: take over as the Ajanta brand's owner account")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
        user = create_account(db, args.role, args.name, args.email, _ask_password(), replace_owner=args.replace_owner)
        db.commit()
        print(f"Created {args.role}: {user.email}. Sign in on the website with that email and the password you typed.")
        return 0
    except AccountError as exc:
        db.rollback()
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        db.execute(text("RESET ALL"))
        db.commit()
        db.close()


if __name__ == "__main__":
    sys.exit(main())
