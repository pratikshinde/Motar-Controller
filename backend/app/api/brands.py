"""Brands: each manufacturer's own app on the one server (alembic phase5_brands, mobile/brands/README.md).

* GET /app/config            public: what a brand's app may read before anyone signs in (its name, logo, support contact,
                             minimum version, feature switches). The brand comes from the X-App-Brand header.
* /brands (super admin only) list, create and change brands. A brand is never deleted (pumps and accounts point at it);
                             it is suspended instead, which stops that manufacturer's app at once.
"""
import re
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from datetime import datetime, timedelta, timezone

from sqlalchemy import distinct, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.config import settings
from app.database import get_db
from app.models import Alert, AppBrand, AuditLog, BatchImei, Organisation, Pump, User
from app.repositories.pump_repository import PumpRepository
from app.services import brand_service, view_as

router = APIRouter(tags=["Brands"])
app_router = APIRouter(tags=["Brands"])

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
PHONE = re.compile(r"^\+?\d{7,15}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ANDROID_PACKAGE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
VERSION = re.compile(r"^\d+(\.\d+){0,2}$")
SENDER_ID = re.compile(r"^[A-Za-z0-9]{3,11}$")


def _optional(pattern: re.Pattern, label: str):
    def check(cls, value):
        if value is None or value == "":
            return None
        if not pattern.match(value):
            raise ValueError(f"{label} is not valid")
        return value
    return check


class BrandFields(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    short_name: Optional[str] = Field(None, max_length=30)
    org_id: Optional[uuid.UUID] = None
    owner_user_id: Optional[uuid.UUID] = None
    logo_url: Optional[str] = Field(None, max_length=2000)
    primary_color: Optional[str] = None
    support_name: Optional[str] = Field(None, max_length=100)
    support_phone: Optional[str] = None
    support_email: Optional[str] = Field(None, max_length=100)
    whatsapp_phone_id: Optional[str] = Field(None, max_length=50)
    whatsapp_template: Optional[str] = Field(None, max_length=60)
    whatsapp_language: Optional[str] = Field(None, max_length=10)
    sms_sender_id: Optional[str] = None
    msg91_flow_id: Optional[str] = Field(None, max_length=60)
    android_package: Optional[str] = Field(None, max_length=100)
    min_app_version: Optional[str] = None
    features: Optional[Dict[str, Any]] = None

    _color = field_validator("primary_color")(_optional(HEX, "primary_color (#RRGGBB)"))
    _phone = field_validator("support_phone")(_optional(PHONE, "support_phone"))
    _email = field_validator("support_email")(_optional(EMAIL, "support_email"))
    _package = field_validator("android_package")(_optional(ANDROID_PACKAGE, "android_package"))
    _version = field_validator("min_app_version")(_optional(VERSION, "min_app_version"))
    _sender = field_validator("sms_sender_id")(_optional(SENDER_ID, "sms_sender_id"))

    @field_validator("features")
    @classmethod
    def _features(cls, value):
        if value is None:
            return value
        if len(value) > 50 or any(not isinstance(k, str) or len(k) > 50 for k in value):
            raise ValueError("features: too many or too long")
        if any(not isinstance(v, (bool, int, float, str)) or (isinstance(v, str) and len(v) > 200) for v in value.values()):
            raise ValueError("features: values must be true/false, numbers or short text")
        return value


class BrandCreate(BrandFields):
    key: str
    name: str = Field(min_length=2, max_length=100)

    @field_validator("key")
    @classmethod
    def _key(cls, value):
        value = value.strip().lower()
        if not brand_service.KEY_PATTERN.match(value):
            raise ValueError("key must be 2-30 lowercase letters, digits or dashes, starting with a letter")
        if value in brand_service.RESERVED_KEYS:
            raise ValueError("that key is reserved")
        return value


class BrandUpdate(BrandFields):
    status: Optional[str] = Field(None, pattern="^(ACTIVE|SUSPENDED)$")


def _serialize(b: AppBrand) -> dict:
    return {
        "id": str(b.id), "key": b.key, "org_id": str(b.org_id) if b.org_id else None,
        "owner_user_id": str(b.owner_user_id) if b.owner_user_id else None, "name": b.name,
        "short_name": b.short_name, "logo_url": b.logo_url, "primary_color": b.primary_color,
        "support_name": b.support_name, "support_phone": b.support_phone, "support_email": b.support_email,
        "whatsapp_phone_id": b.whatsapp_phone_id, "whatsapp_template": b.whatsapp_template,
        "whatsapp_language": b.whatsapp_language, "sms_sender_id": b.sms_sender_id, "msg91_flow_id": b.msg91_flow_id,
        "android_package": b.android_package, "min_app_version": b.min_app_version, "features": b.features or {},
        "status": b.status,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


def _audit(db: Session, actor: User, brand: AppBrand, action: str, after: dict) -> None:
    db.add(AuditLog(actor_id=actor.id, actor_role=actor.role, entity_type="brand", entity_id=brand.key,
                    action=action, after_json=after))


def _check_owner(db: Session, owner_user_id: Optional[uuid.UUID]) -> None:
    """The brand's owner must be a manufacturer account: its tree becomes the manufacturer's dashboard."""
    if owner_user_id is None:
        return
    owner = db.query(User).filter(User.id == owner_user_id).first()
    if not owner or (owner.role or "").lower() != "manufacturer":
        raise HTTPException(status_code=422, detail="owner_user_id must be a manufacturer account")


def _check_org(db: Session, org_id: Optional[uuid.UUID]) -> None:
    if org_id and not db.query(Organisation.id).filter(Organisation.id == org_id).first():
        raise HTTPException(status_code=422, detail="org_id is not an organisation")


# -- public ----------------------------------------------------------------------------------------------------------

@app_router.get("/config")
def app_config(request: Request):
    """The calling app's own settings. The brand comes from X-App-Brand; an unknown or switched-off brand is refused by
    the middleware before this runs."""
    brand = getattr(request.state, "brand", None)
    if brand is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The X-App-Brand header is required.")
    return {"brand": brand_service.public_config(brand)}


@router.get("/mine")
def my_brand(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The manufacturer the signed-in partner belongs to (its name and colour for the portal's header), or null for a farmer
    or the platform's super admin. Read-only, and only ever the caller's own brand."""
    if (current_user.role or "").lower() == "customer":
        return {"brand": None}
    info = brand_service.info_for_id(db, getattr(current_user, "brand_id", None))
    if not info:
        return {"brand": None}
    return {"brand": {
        "key": info.key, "name": info.name, "short_name": info.short_name,
        "primary_color": info.primary_color, "logo_url": info.logo_url,
    }}


# -- super admin -----------------------------------------------------------------------------------------------------

@router.get("")
def list_brands(current_user: User = Depends(require_roles(["superadmin"])), db: Session = Depends(get_db)):
    return {"brands": [_serialize(b) for b in db.query(AppBrand).order_by(AppBrand.key).all()]}


@router.get("/overview")
def overview(current_user: User = Depends(require_roles(["superadmin"])), db: Session = Depends(get_db)):
    """The platform's main page: every manufacturer with its farmers, pumps and what is wrong right now.

    Each manufacturer is measured exactly as its own dashboard measures it (its account's tree, the same pump buckets:
    running / stopped / fault / offline / never reported), so the number the platform owner sees here is the number the
    manufacturer sees."""
    empty = {"total": 0, "running": 0, "stopped": 0, "fault": 0, "offline": 0, "no_data": 0}
    rows = []
    all_farmers = set()  # one person who farms with two manufacturers is still one farmer in the platform total
    for b in db.query(AppBrand).order_by(AppBrand.name).all():
        owner = db.query(User).filter(User.id == b.owner_user_id).first() if b.owner_user_id else None
        counts, farmers, team, open_alerts = dict(empty), 0, 0, 0
        distributors = dealers = gsm_pumps = gsm_online = 0
        if owner is not None:
            repo = PumpRepository.for_actor(owner, db)
            counts = repo.fleet_counts(settings.OFFLINE_AFTER_SECONDS)
            in_tree = repo._base_query().with_entities(Pump.id).subquery()
            owner_ids = {r[0] for r in db.query(distinct(Pump.owner_user_id)).filter(Pump.id.in_(db.query(in_tree.c.id))).all() if r[0]}
            farmers = len(owner_ids)
            all_farmers |= owner_ids
            open_alerts = (
                db.query(func.count(Alert.id))
                .filter(Alert.resolved_at.is_(None), Alert.pump_id.in_(db.query(in_tree.c.id))).scalar() or 0
            )
            gsm_pumps, gsm_online = _gsm_counts(db, in_tree)
            path = (owner.hierarchy_path or "").rstrip("/")
            if path.count("/") >= 2:
                team = db.query(func.count(User.id)).filter(
                    (User.hierarchy_path == path) | User.hierarchy_path.like(path + "/%"), User.id != owner.id,
                    func.lower(User.role) != "customer",
                ).scalar() or 0
                by_role = dict(db.query(func.lower(User.role), func.count(User.id)).filter(
                    (User.hierarchy_path == path) | User.hierarchy_path.like(path + "/%"), User.id != owner.id,
                ).group_by(func.lower(User.role)).all())
                distributors, dealers = int(by_role.get("distributor", 0)), int(by_role.get("dealer", 0))
        rows.append({
            "key": b.key, "name": b.name, "short_name": b.short_name, "logo_url": b.logo_url,
            "primary_color": b.primary_color, "status": b.status,
            "owner": {"name": owner.full_name, "phone": owner.phone_number or owner.phone, "email": owner.email} if owner else None,
            "farmers": int(farmers), "team": int(team), "distributors": distributors, "dealers": dealers, "open_alerts": int(open_alerts), "pumps": counts,
            "gsm_pumps": gsm_pumps, "gsm_online": gsm_online,
            "joined": b.created_at.isoformat() if b.created_at else None,
        })
    totals = {k: sum(r["pumps"][k] for r in rows) for k in empty}
    totals.update(
        farmers=len(all_farmers), open_alerts=sum(r["open_alerts"] for r in rows),
        manufacturers=len(rows),
        distributors=sum(r["distributors"] for r in rows), dealers=sum(r["dealers"] for r in rows),
        gsm_pumps=sum(r["gsm_pumps"] for r in rows), gsm_online=sum(r["gsm_online"] for r in rows),
        monthly_pumps=_pumps_per_month(db),
    )
    return {"manufacturers": rows, "totals": totals}


def _gsm_counts(db: Session, in_tree) -> tuple:
    """(pumps on the GSM service, of those the ones online now) among the pumps in `in_tree` (a subquery of pump ids).

    A pump is on the GSM service when its starter record carries a modem: the modem's IMEI is on the factory's sheet, or the module has already
    claimed its certificate. Online means it reported within the offline window, the same rule every dashboard uses."""
    on_gsm = db.query(BatchImei.pump_id).filter(BatchImei.pump_id.isnot(None), or_(BatchImei.imei.isnot(None), BatchImei.claimed.is_(True)))
    base = db.query(func.count(distinct(Pump.id))).filter(Pump.id.in_(db.query(in_tree.c.id)), Pump.id.in_(on_gsm))
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.OFFLINE_AFTER_SECONDS)
    return int(base.scalar() or 0), int(base.filter(Pump.last_seen_at.isnot(None), Pump.last_seen_at >= cutoff).scalar() or 0)


def _pumps_per_month(db: Session, months: int = 6) -> list:
    """How many pumps were added in each of the last `months` months (oldest first, empty months as 0), for the dashboard's growth graph."""
    now = datetime.now(timezone.utc)
    first = []
    y, m = now.year, now.month
    for _ in range(months):
        first.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    first.reverse()
    since = datetime(first[0][0], first[0][1], 1, tzinfo=timezone.utc)
    month = func.to_char(func.date_trunc("month", Pump.created_at), "YYYY-MM")
    rows = db.query(month, func.count(Pump.id)).filter(Pump.created_at >= since).group_by(month).all()
    found = {r[0]: int(r[1]) for r in rows}
    return [{"month": f"{y}-{m:02d}", "pumps": found.get(f"{y}-{m:02d}", 0)} for y, m in first]


@router.get("/map")
def platform_map(current_user: User = Depends(require_roles(["superadmin"])), db: Session = Depends(get_db)):
    """Every pump on the platform that has a known position, for the platform owner's map: one red pin each. Pumps without a position are not listed."""
    brands = {b.id: b for b in db.query(AppBrand).all()}
    rows = db.query(Pump.id, Pump.latitude, Pump.longitude, Pump.brand_id).filter(Pump.latitude.isnot(None), Pump.longitude.isnot(None)).all()
    pumps = [
        {"id": r[0], "lat": float(r[1]), "lng": float(r[2]), "manufacturer": (brands[r[3]].name if r[3] in brands else None)}
        for r in rows
    ]
    return {"total": len(pumps), "pumps": pumps}


@router.get("/{key}")
def get_brand(key: str, current_user: User = Depends(require_roles(["superadmin"])), db: Session = Depends(get_db)):
    brand = db.query(AppBrand).filter(AppBrand.key == key.lower()).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    return {"brand": _serialize(brand)}


@router.post("", status_code=201)
def create_brand(req: BrandCreate, current_user: User = Depends(require_roles(["superadmin"])), db: Session = Depends(get_db)):
    if db.query(AppBrand.id).filter(AppBrand.key == req.key).first():
        raise HTTPException(status_code=409, detail="A brand with that key already exists")
    _check_org(db, req.org_id)
    _check_owner(db, req.owner_user_id)
    brand = AppBrand(key=req.key, status="ACTIVE", features={})
    for name, value in req.model_dump(exclude={"key"}, exclude_unset=True).items():
        setattr(brand, name, value)
    db.add(brand)
    try:
        db.flush()
        _audit(db, current_user, brand, "BRAND_CREATED", {"name": brand.name})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A brand with that key already exists")
    db.refresh(brand)
    brand_service.forget(brand.key)
    return {"message": "Brand created", "brand": _serialize(brand)}


@router.put("/{key}")
def update_brand(key: str, req: BrandUpdate, current_user: User = Depends(require_roles(["superadmin"])), db: Session = Depends(get_db)):
    brand = db.query(AppBrand).filter(AppBrand.key == key.lower()).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    changes = req.model_dump(exclude_unset=True)
    if "org_id" in changes:
        _check_org(db, changes["org_id"])
    if "owner_user_id" in changes:
        _check_owner(db, changes["owner_user_id"])
    previous_status = brand.status
    for name, value in changes.items():
        if name == "features" and value is None:
            continue
        setattr(brand, name, value)
    action = "BRAND_UPDATED"
    if brand.status != previous_status:
        action = "BRAND_SUSPENDED" if brand.status == "SUSPENDED" else "BRAND_ACTIVATED"
    _audit(db, current_user, brand, action, {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in changes.items() if k != "features"})
    db.commit()
    db.refresh(brand)
    brand_service.forget(brand.key)
    return {"message": "Brand updated", "brand": _serialize(brand)}
