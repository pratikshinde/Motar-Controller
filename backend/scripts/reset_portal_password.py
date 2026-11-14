"""Set a new password for an admin or the super admin who forgot theirs (they sign in with an email, so there is no code to send).

    python scripts/reset_portal_password.py --email admin@ajanta.example
    python scripts/reset_portal_password.py --email admin@ajanta.example --reset-authenticator     (they lost the authenticator app too)
    python scripts/reset_portal_password.py --email owner@example.com --authenticator-only        (no password involved: they sign in with an emailed code and
                                                                                                    only lost the authenticator app; no password is asked or changed)

Run on the server by whoever looks after it (docker compose exec api python scripts/reset_portal_password.py --email ...). The password is asked for
here (hidden) and typed twice, or taken from PORTAL_PASSWORD for a non-interactive run; it is never printed and stored only as a hash. At least 10
characters. Every sign-in the account had is ended, so whoever else held it is locked out. Distributors and dealers do not need this: the person above
them makes a new QR. Only an admin (manufacturer) or a super admin can be reset here.
"""
import argparse
import getpass
import os
import sys
from datetime import datetime
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, text

from app.database import SessionLocal
from app.models import AuditLog, RefreshToken, User
from app.services.jwt_auth import hash_secret

MIN_PASSWORD = 10
ROLES = ("manufacturer", "superadmin")


class ResetError(Exception):
    """Something the person running the script can fix (the message is for them)."""


def reset_password(db, email: str, password: Optional[str], reset_authenticator: bool = False) -> User:
    """Give the account a new password (when `password` is given) and/or remove its authenticator, and end its sessions (no commit)."""
    email = (email or "").strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first() if email else None
    if user is None or (user.role or "").lower() not in ROLES:
        # One answer for "no such account" and "not an admin": this is not a way to find out which emails exist.
        raise ResetError("No admin or super admin has that email.")
    if password is not None:
        if len(password) < MIN_PASSWORD:
            raise ResetError(f"The password must be at least {MIN_PASSWORD} characters.")
        user.password_hash = hash_secret(password)
    user.session_version = (user.session_version or 1) + 1
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).update(
        {"revoked_at": datetime.utcnow()}, synchronize_session=False)
    if reset_authenticator:
        user.totp_secret, user.totp_enabled = None, False
    db.add(AuditLog(actor_id=None, actor_role="operator", entity_type="user", entity_id=str(user.id),
                    action="PASSWORD_RESET" if password is not None else "MFA_RESET",
                    after_json={"by": "operator", "authenticator_reset": bool(reset_authenticator), "password_changed": password is not None}))
    return user


def _ask_password() -> str:
    env = os.environ.get("PORTAL_PASSWORD")
    if env:
        return env
    first = getpass.getpass("New password (hidden, at least 10 characters): ")
    if first != getpass.getpass("Type it again: "):
        raise ResetError("The two passwords are not the same.")
    return first


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--email", required=True)
    ap.add_argument("--reset-authenticator", action="store_true", help="also remove their authenticator app, so they set it up again at the next sign-in")
    ap.add_argument("--authenticator-only", action="store_true", help="only remove the authenticator app: no password is asked or changed")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
        if args.authenticator_only:
            user = reset_password(db, args.email, None, True)
            db.commit()
            print(f"The authenticator of {user.email} was removed. Every earlier sign-in is ended. They set a new one up at the next sign-in.")
            return 0
        user = reset_password(db, args.email, _ask_password(), args.reset_authenticator)
        db.commit()
        print(f"Password changed for {user.email}. Every earlier sign-in is ended." + (" The authenticator was removed too." if args.reset_authenticator else ""))
        return 0
    except ResetError as exc:
        db.rollback()
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        db.execute(text("RESET ALL"))
        db.commit()
        db.close()


if __name__ == "__main__":
    sys.exit(main())
