"""Seed demo accounts for local development: one account per role, each placed the way real onboarding would place it.

  9999900001  superadmin    platform root
  9999900002  manufacturer  "Demo Manufacturer"  (an organisation under the root)
  9999900003  distributor   "Demo Distributor"   (under the manufacturer)
  9999900004  dealer        "Demo Dealer"        (under the distributor)
  9999900005  support       platform root
  9999900006  customer      a farmer of the dealer

A second manufacturer, Swati (brand "swati"), has its own tree so two brands' apps can be tried against this one server:

  9999900012  manufacturer  "Demo Swati Manufacturer"   brand swati
  9999900013  distributor   "Demo Swati Distributor"
  9999900014  dealer        "Demo Swati Dealer"
  9999900016  customer      a Swati farmer, pump SWATI-DEMO-01
                (and the Ajanta farmer 9999900006 gets pumps AJANTA-DEMO-01 and -02, so each manufacturer has a dashboard to look at)
  9999900019  customer      owns one Ajanta pump (DEMO-SHARED-AJ) and one Swati pump (DEMO-SHARED-SW): one account,
                            each brand's app shows its own pump

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
from app.models import AppBrand, Organisation, Pump, User
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


SWATI_USERS = [
    # phone,       e164,           name,                                 role,           path,                          org,        parent
    ("9999900012", "+919999900012", "Meera Joshi (Swati Manufacturer)",  "manufacturer", "/SA/SW",                      "sw_mfr",   "9999900001"),
    ("9999900013", "+919999900013", "Rohan Desai (Swati Distributor)",   "distributor",  "/SA/SW/DIST1",                "sw_dist",  "9999900012"),
    ("9999900014", "+919999900014", "Sunil Rao (Swati Dealer)",          "dealer",       "/SA/SW/DIST1/DLR1",           "sw_dealer", "9999900013"),
    ("9999900016", "+919999900016", "Kavita More (Swati Farmer)",        "customer",     "/SA/SW/DIST1/DLR1/FARM1",     "sw_dealer", "9999900014"),
    ("9999900019", "+919999900019", "Ganesh Pawar (Farmer, both brands)", "customer",    "/SA/MF/DIST1/DLR1/FARM2",     "dealer",   "9999900004"),
]
SWATI_ORGS = [
    ("sw_mfr", "Demo Swati Manufacturer", OrgType.MANUFACTURER, "root"),
    ("sw_dist", "Demo Swati Distributor", OrgType.DISTRIBUTOR, "sw_mfr"),
    ("sw_dealer", "Demo Swati Dealer", OrgType.DEALER, "sw_dist"),
]
# id, name, owner phone, brand, hierarchy path of the pump, org key, device_type
DEMO_PUMPS = [
    ("AJANTA-DEMO-01", "Rameshwar borewell", "9999900006", "ajanta", "/SA/MF/DIST1/DLR1/FARM1", "dealer", "AC_3PH"),
    ("AJANTA-DEMO-02", "Rameshwar orchard pump", "9999900006", "ajanta", "/SA/MF/DIST1/DLR1/FARM1", "dealer", "AC_3PH"),
    ("SWATI-DEMO-01", "Swati borewell", "9999900016", "swati", "/SA/SW/DIST1/DLR1/FARM1", "sw_dealer", "SOLAR_VFD"),
    ("DEMO-SHARED-AJ", "Shared farm - Ajanta pump", "9999900019", "ajanta", "/SA/MF/DIST1/DLR1/FARM2", "dealer", "AC_3PH"),
    ("DEMO-SHARED-SW", "Shared farm - Swati pump", "9999900019", "swati", "/SA/SW/DIST1/DLR1/FARM2", "sw_dealer", "SOLAR_VFD"),
]


def _seed_swati(db, orgs, by_phone, pass_hash):
    """The second brand: its row, its manufacturer tree, a farmer who owns pumps of both brands, and the pumps."""
    ajanta = db.query(AppBrand).filter(AppBrand.key == "ajanta").one()
    swati = db.query(AppBrand).filter(AppBrand.key == "swati").first()
    if swati is None:
        swati = AppBrand(key="swati", name="Swati Pump Controller", short_name="SWATI", android_package="com.swati.pumpcontroller",
                         primary_color="#1B4FB8", features={})
        db.add(swati)
        db.flush()
        print("Created brand: swati")
    brands = {"ajanta": ajanta, "swati": swati}

    for key, name, org_type, parent_key in SWATI_ORGS:
        parent = orgs[parent_key]
        org = _find_org(db, name, parent)
        if org is None:
            new_id = uuid.uuid4()
            org = Organisation(id=new_id, parent_id=parent.id, type=org_type.value, name=name,
                               path=f"{parent.path}.{str(new_id).replace('-', '_')}", depth=parent.depth + 1, status=OrgStatus.ACTIVE.value)
            db.add(org)
            db.flush()
            print(f"Created organisation: {name}")
        orgs[key] = org
    swati.org_id = orgs["sw_mfr"].id

    for phone, e164, name, role, path, org_key, parent_phone in SWATI_USERS:
        user = db.query(User).filter((User.phone == e164) | (User.phone == phone) | (User.phone_number == e164) | (User.phone_number == phone)).first()
        parent = by_phone.get(parent_phone)
        brand = None if role == "customer" else swati
        fields = dict(full_name=name, role=role, password_hash=pass_hash, hierarchy_path=path, org_id=orgs[org_key].id,
                      parent_user_id=parent.id if parent else None, brand_id=brand.id if brand else None,
                      dealer_depth=1 if role == "dealer" else 0, org_role="owner", account_status="ACTIVE", is_active=True, is_verified=True)
        if user is None:
            user = User(id=uuid.uuid4(), phone=e164, phone_number=e164, **fields)
            db.add(user)
            print(f"Created {role}: {phone}")
        else:
            for k, v in fields.items():
                setattr(user, k, v)
            print(f"Updated {role}: {phone}")
        user.totp_secret, user.totp_enabled = None, False
        db.flush()
        by_phone[phone] = user

    # Each brand points at the account that IS that manufacturer: its tree is what the platform owner sees when opening
    # that manufacturer's dashboard.
    ajanta.owner_user_id = by_phone["9999900002"].id
    swati.owner_user_id = by_phone["9999900012"].id

    for pump_id, name, owner_phone, brand_key, path, org_key, device_type in DEMO_PUMPS:
        owner = by_phone[owner_phone]
        pump = db.query(Pump).filter(Pump.id == pump_id).first()
        values = dict(name=name, owner_user_id=owner.id, hierarchy_path=path, org_id=orgs[org_key].id, brand_id=brands[brand_key].id, device_type=device_type)
        if pump is None:
            db.add(Pump(id=pump_id, supply_type="3-phase", hp_rating=7.5, status="STOPPED", lifecycle_state="ACTIVE", **values))
            print(f"Created pump: {pump_id} ({brand_key}, {device_type})")
        else:
            for k, v in values.items():
                setattr(pump, k, v)
            print(f"Updated pump: {pump_id} ({brand_key}, {device_type})")


def seed_demo_users():
    if not settings.dev_codes_enabled:
        sys.exit("Refusing to seed demo accounts: they have a published password. Run this with ENV=development only.")

    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
        orgs = _ensure_orgs(db)
        pass_hash = hash_secret(PASSWORD)
        by_phone = {}
        first_brand = db.query(AppBrand).filter(AppBrand.key == "ajanta").one()  # created by alembic phase5_brands

        for phone, e164, name, role, path, email, org_key, parent_phone in DEMO_USERS:
            user = db.query(User).filter(
                (User.phone == e164) | (User.phone == phone) | (User.phone_number == e164) | (User.phone_number == phone)
            ).first()
            parent = by_phone.get(parent_phone)
            fields = dict(
                full_name=name, role=role, password_hash=pass_hash, hierarchy_path=path,
                org_id=orgs[org_key].id, parent_user_id=parent.id if parent else None,
                dealer_depth=1 if role == "dealer" else 0, org_role="owner",
                brand_id=first_brand.id if role in ("manufacturer", "distributor", "dealer", "support") else None,
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

        _seed_swati(db, orgs, by_phone, pass_hash)

        db.commit()
        print("Demo accounts seeded. Password for all: Admin@123 (the super admin's authenticator step takes 123456 in development).")
    finally:
        db.execute(text("RESET ALL"))
        db.commit()
        db.close()


if __name__ == "__main__":
    seed_demo_users()
