"""Which manufacturer's app is this request from, and what is theirs.

The mobile app of each manufacturer sends `X-App-Brand: <key>` with every request (see mobile/brands/README.md). The
middleware (app/core/brand_middleware.py) resolves it here and keeps the result in `current_brand` for the rest of the
request. It selects a VIEW: which pumps a farmer's app lists, whose logo and support number it shows, which WhatsApp
number sends the codes. It never grants anything: who the user is and what they may reach is still decided by their
login and the tenant scope.
"""
import os
import re
import threading
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.config import settings
from app.database import system_session
from app.models import AppBrand

KEY_PATTERN = re.compile(r"^[a-z][a-z0-9-]{1,29}$")
RESERVED_KEYS = {"platform", "admin", "default", "all", "none", "null", "test"}
CACHE_SECONDS = 30


@dataclass(frozen=True)
class BrandInfo:
    """A brand as the request path needs it (a plain value: it outlives the database session it was read in)."""
    id: Any
    key: str
    name: str
    short_name: Optional[str]
    logo_url: Optional[str]
    primary_color: Optional[str]
    support_name: Optional[str]
    support_phone: Optional[str]
    support_email: Optional[str]
    whatsapp_phone_id: Optional[str]
    whatsapp_template: Optional[str]
    whatsapp_language: Optional[str]
    sms_sender_id: Optional[str]
    msg91_flow_id: Optional[str]
    min_app_version: Optional[str]
    features: Dict[str, Any] = field(default_factory=dict)
    status: str = "ACTIVE"

    @property
    def active(self) -> bool:
        return self.status == "ACTIVE"


# The brand of the request being served, or None (the web portal, devices, an app that predates brands).
current_brand: ContextVar[Optional[BrandInfo]] = ContextVar("current_brand", default=None)

_lock = threading.Lock()
_cache: Dict[str, "tuple[float, Optional[BrandInfo]]"] = {}


def _to_info(b: AppBrand) -> BrandInfo:
    return BrandInfo(
        id=b.id, key=b.key, name=b.name, short_name=b.short_name, logo_url=b.logo_url, primary_color=b.primary_color,
        support_name=b.support_name, support_phone=b.support_phone, support_email=b.support_email,
        whatsapp_phone_id=b.whatsapp_phone_id, whatsapp_template=b.whatsapp_template,
        whatsapp_language=b.whatsapp_language, sms_sender_id=b.sms_sender_id, msg91_flow_id=b.msg91_flow_id,
        min_app_version=b.min_app_version, features=dict(b.features or {}), status=b.status,
    )


def resolve(key: str) -> Optional[BrandInfo]:
    """The brand with this key (cached for a few seconds), or None when there is no such brand."""
    key = (key or "").strip().lower()
    if not KEY_PATTERN.match(key):
        return None
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    with system_session() as db:
        row = db.query(AppBrand).filter(AppBrand.key == key).first()
        info = _to_info(row) if row else None
    with _lock:
        _cache[key] = (now, info)
    return info


def forget(key: Optional[str] = None) -> None:
    """Drop the cache (after a brand was created or changed, so this worker sees it at once; others within seconds)."""
    with _lock:
        if key:
            _cache.pop(key, None)
        else:
            _cache.clear()


def default_key() -> str:
    return (getattr(settings, "DEFAULT_BRAND_KEY", None) or "ajanta").strip().lower()


def public_config(b: BrandInfo) -> dict:
    """What the brand's app may read before anyone signs in (GET /app/config). No sender settings, no secrets."""
    return {
        "key": b.key,
        "name": b.name,
        "short_name": b.short_name,
        "logo_url": b.logo_url,
        "primary_color": b.primary_color,
        "support": {"name": b.support_name, "phone": b.support_phone, "email": b.support_email},
        "min_app_version": b.min_app_version,
        "features": b.features,
    }


# -- per-brand sender settings ---------------------------------------------------------------------------------------

def _env_name(b: BrandInfo, setting: str) -> str:
    return f"BRAND_{b.key.upper().replace('-', '_')}_{setting}"


def channel_setting(setting: str, brand: Optional[BrandInfo] = None) -> str:
    """One sender setting for the brand, falling back to the platform's own setting until the brand has its own.

    Looked up, in order: the environment variable BRAND_<KEY>_<SETTING> (the only place secrets such as
    WHATSAPP_API_TOKEN may come from), then the brand's database column for the non-secret identifiers
    (WHATSAPP_PHONE_ID, WHATSAPP_OTP_TEMPLATE, WHATSAPP_OTP_LANGUAGE, SMS_SENDER_ID, MSG91_FLOW_ID), then the platform
    setting of the same name.
    """
    b = brand if brand is not None else current_brand.get()
    if b is not None:
        from_env = os.environ.get(_env_name(b, setting))
        if from_env:
            return from_env
        column = {
            "WHATSAPP_PHONE_ID": b.whatsapp_phone_id,
            "WHATSAPP_OTP_TEMPLATE": b.whatsapp_template,
            "WHATSAPP_OTP_LANGUAGE": b.whatsapp_language,
            "SMS_SENDER_ID": b.sms_sender_id,
            "MSG91_FLOW_ID": b.msg91_flow_id,
        }.get(setting)
        if column:
            return column
    return str(getattr(settings, setting, "") or "")


def support_contact(brand: Optional[BrandInfo] = None) -> dict:
    """The manufacturer's own support contact when the brand has one, else the platform's (config SUPPORT_ESCALATION_*)."""
    b = brand if brand is not None else current_brand.get()
    return {
        "name": (b.support_name if b and b.support_name else settings.SUPPORT_ESCALATION_NAME) or None,
        "phone": (b.support_phone if b and b.support_phone else settings.SUPPORT_ESCALATION_PHONE) or None,
        "email": (b.support_email if b and b.support_email else settings.SUPPORT_ESCALATION_EMAIL) or None,
    }


def list_brands() -> List[BrandInfo]:
    with system_session() as db:
        return [_to_info(b) for b in db.query(AppBrand).order_by(AppBrand.key).all()]


# -- which brand does something new belong to -------------------------------------------------------------------------

PARTNER_ROLES = ("manufacturer", "distributor", "dealer", "support")


def _id_for_key(db, key: str):
    from fastapi import HTTPException
    row = db.query(AppBrand.id).filter(AppBrand.key == (key or "").strip().lower()).first()
    if not row:
        raise HTTPException(status_code=422, detail=f"Unknown brand '{key}'")
    return row[0]


def brand_id_for_new_device(db, actor, requested_key: Optional[str] = None):
    """The brand a new device (pump, import row, factory batch) belongs to.

    A partner's devices are their brand's: they cannot create one for another brand. The platform's super admin names the
    brand (`requested_key`); if they do not, it is the brand of the app the request came from, else the default brand.
    """
    from fastapi import HTTPException
    own = getattr(actor, "brand_id", None)
    if own is not None:
        if requested_key:
            wanted = _id_for_key(db, requested_key)
            if wanted != own:
                raise HTTPException(status_code=403, detail="You can only create devices for your own brand.")
        return own
    if requested_key:
        return _id_for_key(db, requested_key)
    request_brand = current_brand.get()
    return request_brand.id if request_brand is not None else _id_for_key(db, default_key())


def brand_id_for_new_account(db, role: str, parent=None, creator=None, requested_key: Optional[str] = None):
    """The brand of a new partner account: the one named (super admin only), else its parent's, else its creator's, else
    the default brand. Farmers are not tied to a brand (None)."""
    from fastapi import HTTPException
    if (role or "").lower() not in PARTNER_ROLES:
        return None
    creator_brand = getattr(creator, "brand_id", None)
    if requested_key:
        wanted = _id_for_key(db, requested_key)
        if creator_brand is not None and wanted != creator_brand:
            raise HTTPException(status_code=403, detail="You can only create accounts for your own brand.")
        return wanted
    for source in (parent, creator):
        if getattr(source, "brand_id", None) is not None:
            return source.brand_id
    return _id_for_key(db, default_key())


def info_for_id(db, brand_id) -> Optional[BrandInfo]:
    """The brand with this id (e.g. a pump's brand), read in the caller's own session."""
    if not brand_id:
        return None
    row = db.query(AppBrand).filter(AppBrand.id == brand_id).first()
    return _to_info(row) if row else None
