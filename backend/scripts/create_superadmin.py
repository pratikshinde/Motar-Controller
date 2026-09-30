"""Create the first platform-owner (superadmin) account on a database that has none.

    python scripts/create_superadmin.py --name "Platform Owner" --phone +919800000000 [--email owner@example.com]

A database built by `alembic upgrade head` starts with no accounts (the old schema.sql seeded a placeholder one).
This prints a generated password ONCE; it is not stored anywhere but as a hash. The account has no authenticator yet,
so its first sign-in is forced through TOTP setup (FR-WEB-001). Refuses to run if a superadmin already exists
(pass --allow-additional to add another deliberately).
"""
import argparse
import os
import secrets
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import SessionLocal
from app.models import User
from app.services.jwt_auth import hash_secret


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True)
    ap.add_argument("--phone", required=True, help="the number the account signs in with, e.g. +919800000000")
    ap.add_argument("--email", default=None)
    ap.add_argument("--allow-additional", action="store_true", help="create one even though a superadmin exists")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
        if not args.allow_additional and db.query(User.id).filter(User.role == "superadmin").first():
            print("A superadmin already exists. Use --allow-additional if you really want another.", file=sys.stderr)
            return 1
        phone = args.phone.strip().replace(" ", "")
        if db.query(User.id).filter((User.phone_number == phone) | (User.phone == phone)).first():
            print(f"{phone} is already registered.", file=sys.stderr)
            return 1

        password = secrets.token_urlsafe(12)
        user = User(
            id=uuid.uuid4(), full_name=args.name.strip(), phone_number=phone, phone=phone,
            email=(args.email or "").strip().lower() or None, password_hash=hash_secret(password),
            role="superadmin", hierarchy_path="/SA", account_status="ACTIVE", is_active=True, is_verified=True,
        )
        db.add(user)
        db.commit()
    finally:
        db.execute(text("RESET ALL"))
        db.commit()
        db.close()

    print("=" * 60)
    print("Superadmin created. Save this password now, it is shown once:")
    print(f"  sign in with: {phone}")
    print(f"  password:     {password}")
    print("You will be asked to set up an authenticator app at the first sign-in.")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
