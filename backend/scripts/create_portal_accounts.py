"""Create the two website logins: the Ajanta admin and the super admin. Each signs in with an email and a code emailed to it; there is no password.

    python scripts/create_portal_accounts.py --role superadmin    --name "Platform Owner" --email owner@example.com
    python scripts/create_portal_accounts.py --role ajanta-admin  --name "Ajanta Admin"   --email admin@ajanta.example

* The Ajanta admin registers farmers, manages the starters and sees everything of Ajanta. It is the Ajanta brand's own account.
* The super admin only monitors (see SUPERADMIN_MONITOR_ONLY in backend/.env) and can open the Ajanta dashboard read-only.

The super admin enters the emailed code and then the code of an authenticator app (set up at the first sign-in). The admin enters only the emailed
code. The server needs EMAIL_FROM set and the sender verified in Amazon SES (see deploy/README.md).
Only if you really want one, `--with-password` asks for a password (hidden, typed twice, at least 10 characters, stored only as a hash; or set
PORTAL_PASSWORD for a non-interactive run); it then also works on the old email-and-password sign-in.
"""
import argparse
import getpass
import os
import sys
import uuid
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, text

from app.database import SessionLocal
from app.models import AppBrand, User
from app.services.jwt_auth import hash_secret

MIN_PASSWORD = 10
BRAND_KEY = "ajanta"


class AccountError(Exception):
    """Something the person running the script can fix (message is for them)."""


def create_account(db, role_key: str, name: str, email: str, password: Optional[str] = None, replace_owner: bool = False) -> User:
    """Add the account (no commit). `role_key` is "superadmin" or "ajanta-admin". No password by default: the account signs in with an emailed code."""
    email = (email or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise AccountError("Enter a valid email address.")
    if password is not None and len(password) < MIN_PASSWORD:
        raise AccountError(f"The password must be at least {MIN_PASSWORD} characters.")
    password_hash = hash_secret(password) if password else None
    if db.query(User.id).filter(func.lower(User.email) == email).first():
        raise AccountError(f"{email} already has an account.")
    new_id = uuid.uuid4()

    if role_key == "superadmin":
        user = User(
            id=new_id, full_name=name.strip(), email=email, password_hash=password_hash, role="superadmin",
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
        id=new_id, full_name=name.strip(), email=email, password_hash=password_hash, role="manufacturer",
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
    ap.add_argument("--with-password", action="store_true", help="also give the account a password (not needed: it signs in with an emailed code)")
    ap.add_argument("--replace-owner", action="store_true", help="ajanta-admin: take over as the Ajanta brand's owner account")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
        user = create_account(db, args.role, args.name, args.email, _ask_password() if args.with_password else None, replace_owner=args.replace_owner)
        db.commit()
        print(f"Created {args.role}: {user.email}. Sign in on the website with that email: a code is emailed to it.")
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
