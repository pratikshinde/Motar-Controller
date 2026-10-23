"""Seed demo accounts for local development: one account per role, each placed the way real onboarding would place it.

  9999900001  superadmin    platform root
  9999900002  manufacturer  "Demo Manufacturer"  (an organisation under the root)
  9999900003  distributor   "Demo Distributor"   (under the manufacturer)
  9999900004  dealer        "Demo Dealer"        (under the distributor)
  9999900005  support       platform root
  9999900006  customer      a farmer of the dealer

Password for all of them: Admin@123. The super admin's authenticator step is answered by the fixed development code
123456, which the backend only accepts with ENV=development.

These accounts have a published password, so this script refuses to run anywhere that is not a development machine.
It is safe to run again: existing accounts are brought back to this shape, nothing is duplicated.

    cd backend && ENV=development python scripts/seed_demo_accounts.py
"""
import os
import sys
import uuid

import pyotp
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.core.roles import OrgStatus, OrgType
from app.database import SessionLocal
from app.models import Organisation, User
from app.services.jwt_auth import hash_secret

PASSWORD = "Admin@123"

# The well-known example secret an earlier version of this script wrote for the super admin. Anyone can compute codes
# for it, so it is replaced with a random one if found.
RETIRED_TOTP_SECRET = "JBSWY3DPEHPK3PXP"

# Hierarchy paths are the boundary the row-level security uses to decide who sees whom: a parent's path is a prefix of
# every account below it.
DEMO_USERS = [
    # phone,       e164,           name,                              role,           path,                        email,                       org,           parent
    ("9999900001", "+919999900001", "Keerthi (Super Admin)",          "superadmin",   "/SA",                       "superadmin@agripump.io",    "root",        None),
    ("9999900002", "+919999900002", "Rajesh Sharma (Manufacturer)",   "manufacturer", "/SA/MF",                    "manufacturer@agripump.io",  "manufacturer", "9999900001"),
    ("9999900003", "+919999900003", "Anand Patel (Distributor)",      "distributor",  "/SA/MF/DIST1",              "distributor@agripump.io",   "distributor", "9999900002"),
    ("9999900004", "+919999900004", "Vijay Kumar (Dealer)",           "dealer",       "/SA/MF/DIST1/DLR1",         "dealer@agripump.io",        "dealer",      "9999900003"),
    ("9999900005", "+919999900005", "Vikram Singh (Support Engineer)", "support",     "/SA/SUPPORT",               "support@agripump.io",       "root",        "9999900001"),
    ("9999900006", "+919999900006", "Rameshwar Patil (Farmer)",       "customer",     "/SA/MF/DIST1/DLR1/FARM1",   "farmer@agripump.io",        "dealer",      "9999900004"),
]

# The organisations the partner accounts belong to, outermost first: (key, name, type, parent key).
DEMO_ORGS = [
    ("manufacturer", "Demo Manufacturer", OrgType.MANUFACTURER, "root"),
    ("distributor", "Demo Distributor", OrgType.DISTRIBUTOR, "manufacturer"),
    ("dealer", "Demo Dealer", OrgType.DEALER, "distributor"),
]


def _find_org(db, name, parent):
    return db.query(Organisation).filter(Organisation.name == name, Organisation.parent_id == parent.id).first()


def _ensure_orgs(db):
    root = db.query(Organisation).filter(Organisation.type.in_(["root", "SUPERADMIN"])).order_by(Organisation.depth).first()
    if root is None:
        sys.exit("There is no root organisation. Run `alembic upgrade head` first.")
    orgs = {"root": root}
    for key, name, org_type, parent_key in DEMO_ORGS:
        parent = orgs[parent_key]
        org = _find_org(db, name, parent)
        if org is None:
            new_id = uuid.uuid4()
            org = Organisation(
                id=new_id, parent_id=parent.id, type=org_type.value, name=name,
                path=f"{parent.path}.{str(new_id).replace('-', '_')}", depth=parent.depth + 1, status=OrgStatus.ACTIVE.value,
            )
            db.add(org)
            db.flush()
            print(f"Created organisation: {name}")
        orgs[key] = org
    return orgs


def seed_demo_users():
    if not settings.dev_codes_enabled:
        sys.exit("Refusing to seed demo accounts: they have a published password. Run this with ENV=development only.")

    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
        orgs = _ensure_orgs(db)
        pass_hash = hash_secret(PASSWORD)
        by_phone = {}

        for phone, e164, name, role, path, email, org_key, parent_phone in DEMO_USERS:
            user = db.query(User).filter(
                (User.phone == e164) | (User.phone == phone) | (User.phone_number == e164) | (User.phone_number == phone)
            ).first()
            parent = by_phone.get(parent_phone)
            fields = dict(
                full_name=name, role=role, password_hash=pass_hash, hierarchy_path=path,
                org_id=orgs[org_key].id, parent_user_id=parent.id if parent else None,
                dealer_depth=1 if role == "dealer" else 0, org_role="owner",
                account_status="ACTIVE", is_active=True, is_verified=True,
            )
            if user is None:
                # The email is only decoration; leave it off if another account already uses it (the column is unique).
                taken = db.query(User.id).filter(User.email == email).first() is not None
                user = User(id=uuid.uuid4(), email=None if taken else email, phone=e164, phone_number=e164, **fields)
                db.add(user)
                print(f"Created {role}: {phone}")
            else:
                for key, value in fields.items():
                    setattr(user, key, value)
                print(f"Updated {role}: {phone}")

            # Only the super admin has an authenticator. A random secret, kept if one is already there.
            if role == "superadmin":
                if not user.totp_secret or user.totp_secret == RETIRED_TOTP_SECRET:
                    user.totp_secret = pyotp.random_base32()
                user.totp_enabled = True
            else:
                user.totp_secret, user.totp_enabled = None, False

            db.flush()
            by_phone[phone] = user

        db.commit()
        print("Demo accounts seeded. Password for all: Admin@123 (the super admin's authenticator step takes 123456 in development).")
    finally:
        db.execute(text("RESET ALL"))
        db.commit()
        db.close()


if __name__ == "__main__":
    seed_demo_users()
