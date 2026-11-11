"""Farmers registered by a dealer on the website.

A dealer (or distributor, manufacturer) fills one form: the farmer's name, address and mobile number, the starter's ID (read from the
barcode on the starter's box) and the pump's capacity. That one request creates the farmer, hands the starter to the farmer, and
returns a one-time QR code. The farmer scans the QR in the app and sees the pump; no OTP is involved (POST /auth/claim).

Nothing here ever lets a farmer reach another farmer's pump: the starter must be in the caller's own stock, and a QR belongs to one farmer.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_pump_in_scope, require_roles
from app.api.pumps import STOCK_STATES, _pump_audit, _utc_iso

# Only the manufacturer's own admin (the Ajanta admin) registers farmers. The platform owner (super admin) can look at them.
FARMER_WRITE_ROLES = ["manufacturer"]
FARMER_READ_ROLES = ["manufacturer", "superadmin"]
from app.core.phone import get_phone_variants, india_phone
from app.core.scope import in_subtree, path_in_scope
from app.database import get_db
from app.models import AllocationLog, AuditLog, Pump, RefreshToken, User
from app.models.farmer_claim import FarmerClaim
from app.services import farmer_claims
from app.services.cache_service import cache_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Farmers"])


class FarmerUpdate(BaseModel):
    """Fix a farmer's details: any of the three (at least one)."""
    full_name: Optional[str] = Field(None, min_length=2, max_length=100)
    address: Optional[str] = Field(None, min_length=3, max_length=300)
    phone: Optional[str] = Field(None, min_length=10, max_length=20)


class FarmerCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100)
    address: str = Field(..., min_length=3, max_length=300)
    phone: str = Field(..., min_length=10, max_length=20, description="10-digit Indian mobile number")
    starter_id: str = Field(..., min_length=3, max_length=50, description="The starter's unique ID, from the barcode on its box")
    capacity_hp: float = Field(..., gt=0, le=200, description="Pump capacity in HP")
    pump_name: Optional[str] = Field(None, max_length=100)


def _qr_view(claim: Optional[FarmerClaim], token: Optional[str] = None) -> dict:
    view = {
        "state": farmer_claims.state_of(claim),
        "expires_at": _utc_iso(claim.expires_at) if claim else None,
        "claimed_at": _utc_iso(claim.claimed_at) if claim else None,
    }
    if token:  # only ever returned when the QR is made: it cannot be read back later
        view["payload"] = farmer_claims.payload_for(token)
    return view


def _pump_view(pump: Pump) -> dict:
    return {
        "id": pump.id, "name": pump.name, "hp_rating": float(pump.hp_rating) if pump.hp_rating is not None else None,
        "status": pump.status, "lifecycle_state": pump.lifecycle_state,
    }


def _farmer_view(user: User) -> dict:
    return {
        "id": str(user.id), "full_name": user.full_name, "phone_number": user.phone_number or user.phone, "address": user.address,
        # ACTIVE, or SUSPENDED when the Ajanta admin has stopped the farmer's access
        "status": (user.account_status or "ACTIVE").upper(),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def register_farmer(req: FarmerCreate, current_user: User = Depends(require_roles(FARMER_WRITE_ROLES)), db: Session = Depends(get_db)):
    """Create the farmer, give them the starter, and return the QR code (shown once)."""
    phone = india_phone(req.phone)
    if not phone:
        raise HTTPException(status_code=422, detail="Enter the farmer's 10-digit mobile number.")

    starter_id = req.starter_id.strip()
    pump = get_pump_in_scope(db, starter_id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="That starter was not found in your stock. Check the barcode on the box.")
    state = (pump.lifecycle_state or "ACTIVE").upper()
    owner = db.query(User).filter(User.id == pump.owner_user_id).first() if pump.owner_user_id else None
    if state not in STOCK_STATES or (owner is not None and (owner.role or "").lower() == "customer"):
        raise HTTPException(status_code=409, detail="That starter is already given to a farmer.")

    if db.query(User.id).filter((User.phone.in_(get_phone_variants(phone))) | (User.phone_number.in_(get_phone_variants(phone)))).first():
        raise HTTPException(status_code=409, detail="A farmer with this mobile number is already registered.")

    new_id = uuid.uuid4()
    farmer = User(
        id=new_id,
        full_name=req.full_name.strip(),
        phone=phone,
        phone_number=phone,
        address=req.address.strip(),
        role="customer",
        hierarchy_path=f"{(current_user.hierarchy_path or '').rstrip('/')}/{new_id}",
        parent_user_id=current_user.id,
        dealer_depth=0,
        org_role="owner",
        brand_id=None,           # farmers are not tied to a brand: the pump's brand decides which app lists it
        account_status="ACTIVE",
        is_active=True,
        is_verified=False,       # the number was typed by the dealer, nobody proved it
    )
    db.add(farmer)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A farmer with this mobile number is already registered.")

    # Hand the starter to the farmer, the same way a stock allocation does.
    before = {"owner": str(pump.owner_user_id) if pump.owner_user_id else None, "hierarchy_path": pump.hierarchy_path, "state": state}
    db.add(AllocationLog(
        pump_id=pump.id, from_user_id=pump.owner_user_id, to_user_id=farmer.id, actor_id=current_user.id,
        note="Registered with the farmer on the website",
    ))
    pump.owner_user_id = farmer.id
    pump.hierarchy_path = farmer.hierarchy_path
    pump.org_id = getattr(farmer, "org_id", None)
    if state in ("MANUFACTURED", "IN_STOCK"):
        pump.lifecycle_state = "ALLOCATED"
    pump.hp_rating = req.capacity_hp
    pump.name = (req.pump_name or "").strip() or f"{farmer.full_name.split()[0]}'s pump"
    _pump_audit(db, current_user, pump.id, "DEVICE_ALLOCATED", before=before,
                after={"owner": str(farmer.id), "hierarchy_path": farmer.hierarchy_path, "hp_rating": req.capacity_hp})
    db.add(AuditLog(
        actor_id=current_user.id, actor_role=current_user.role, entity_type="user", entity_id=str(farmer.id),
        action="FARMER_REGISTERED", after_json={"starter_id": pump.id, "parent": str(current_user.id)},
    ))

    claim, token = farmer_claims.issue_claim(db, farmer.id, current_user.id)
    db.commit()
    db.refresh(farmer)
    db.refresh(pump)
    return {"message": "Farmer registered", "farmer": _farmer_view(farmer), "pump": _pump_view(pump), "qr": _qr_view(claim, token)}


def _farmer_in_scope(db: Session, actor: User, farmer_id: str) -> User:
    try:
        uid = uuid.UUID(farmer_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Farmer not found")
    farmer = db.query(User).filter(User.id == uid).first()
    # One answer for "no such farmer" and "not yours": do not confirm that an id exists elsewhere.
    if not farmer or (farmer.role or "").lower() != "customer" or not (
        (actor.role or "").lower() == "superadmin" or path_in_scope(actor.hierarchy_path, farmer.hierarchy_path)
    ):
        raise HTTPException(status_code=404, detail="Farmer not found")
    return farmer


@router.post("/{farmer_id}/qr")
def new_qr(farmer_id: str, current_user: User = Depends(require_roles(FARMER_WRITE_ROLES)), db: Session = Depends(get_db)):
    """A new QR for this farmer (lost phone, expired QR). Every older QR that was not used yet stops working."""
    farmer = _farmer_in_scope(db, current_user, farmer_id)
    claim, token = farmer_claims.issue_claim(db, farmer.id, current_user.id)
    db.add(AuditLog(actor_id=current_user.id, actor_role=current_user.role, entity_type="user", entity_id=str(farmer.id),
                    action="FARMER_QR_REISSUED", after_json=None))
    db.commit()
    return {"message": "New QR created. The old one no longer works.", "farmer": _farmer_view(farmer), "qr": _qr_view(claim, token)}


@router.patch("/{farmer_id}")
def update_farmer(farmer_id: str, req: FarmerUpdate, current_user: User = Depends(require_roles(FARMER_WRITE_ROLES)), db: Session = Depends(get_db)):
    """Correct a farmer's name, address or mobile number (a typo, a new number)."""
    farmer = _farmer_in_scope(db, current_user, farmer_id)
    changes = req.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to change.")
    before = {"full_name": farmer.full_name, "address": farmer.address, "phone": farmer.phone_number or farmer.phone}

    if "phone" in changes:
        phone = india_phone(changes["phone"])
        if not phone:
            raise HTTPException(status_code=422, detail="Enter the farmer's 10-digit mobile number.")
        variants = get_phone_variants(phone)
        taken = db.query(User.id).filter(
            User.id != farmer.id, (User.phone.in_(variants)) | (User.phone_number.in_(variants))
        ).first()
        if taken:
            raise HTTPException(status_code=409, detail="A farmer with this mobile number is already registered.")
        farmer.phone = farmer.phone_number = phone
    if "full_name" in changes:
        farmer.full_name = changes["full_name"].strip()
    if "address" in changes:
        farmer.address = changes["address"].strip()

    db.add(AuditLog(
        actor_id=current_user.id, actor_role=current_user.role, entity_type="user", entity_id=str(farmer.id),
        action="FARMER_UPDATED", before_json=before,
        after_json={"full_name": farmer.full_name, "address": farmer.address, "phone": farmer.phone_number or farmer.phone},
    ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A farmer with this mobile number is already registered.")
    db.refresh(farmer)
    return {"message": "Farmer updated", "farmer": _farmer_view(farmer)}


def _set_access(db: Session, actor: User, farmer: User, stopped: bool) -> User:
    """Stop (or restore) a farmer's access. A stopped farmer cannot sign in or scan a QR, and a phone that is already signed in is
    signed out at once. The farmer, the pump and the history are kept."""
    before = {"status": farmer.account_status}
    farmer.account_status = "SUSPENDED" if stopped else "ACTIVE"
    farmer.is_active = not stopped
    if stopped:
        # Every token the farmer holds stops working: the session version moves on and the refresh tokens are revoked.
        cache_service.increment_user_session_version(str(farmer.id))
        farmer.session_version = (farmer.session_version or 1) + 1
        db.query(RefreshToken).filter(RefreshToken.user_id == farmer.id, RefreshToken.revoked_at.is_(None)).update(
            {"revoked_at": datetime.now(timezone.utc)}, synchronize_session=False
        )
    db.add(AuditLog(
        actor_id=actor.id, actor_role=actor.role, entity_type="user", entity_id=str(farmer.id),
        action="FARMER_STOPPED" if stopped else "FARMER_RESTORED", before_json=before, after_json={"status": farmer.account_status},
    ))
    db.commit()
    db.refresh(farmer)
    return farmer


@router.post("/{farmer_id}/deactivate")
def deactivate_farmer(farmer_id: str, current_user: User = Depends(require_roles(FARMER_WRITE_ROLES)), db: Session = Depends(get_db)):
    """Stop a farmer's access (their phone is signed out at once). The farmer, the pump and the history are kept."""
    farmer = _farmer_in_scope(db, current_user, farmer_id)
    return {"message": "Farmer deactivated", "farmer": _farmer_view(_set_access(db, current_user, farmer, stopped=True))}


@router.post("/{farmer_id}/activate")
def activate_farmer(farmer_id: str, current_user: User = Depends(require_roles(FARMER_WRITE_ROLES)), db: Session = Depends(get_db)):
    """Give a deactivated farmer their access back."""
    farmer = _farmer_in_scope(db, current_user, farmer_id)
    return {"message": "Farmer activated", "farmer": _farmer_view(_set_access(db, current_user, farmer, stopped=False))}


@router.get("")
def list_farmers(current_user: User = Depends(require_roles(FARMER_READ_ROLES)), db: Session = Depends(get_db)):
    """The farmers in the caller's tree with their pumps and whether the QR was scanned yet (newest first)."""
    query = db.query(User).filter(User.role == "customer")
    if (current_user.role or "").lower() != "superadmin":
        query = query.filter(in_subtree(User.hierarchy_path, current_user.hierarchy_path))
    farmers: List[User] = query.order_by(User.created_at.desc()).limit(300).all()
    ids = [f.id for f in farmers]
    pumps_by_owner: Dict[uuid.UUID, List[dict]] = {}
    latest_claim: Dict[uuid.UUID, FarmerClaim] = {}
    if ids:
        for pump in db.query(Pump).filter(Pump.owner_user_id.in_(ids)).all():
            pumps_by_owner.setdefault(pump.owner_user_id, []).append(_pump_view(pump))
        for claim in db.query(FarmerClaim).filter(FarmerClaim.user_id.in_(ids)).order_by(FarmerClaim.created_at.asc(), FarmerClaim.id.asc()).all():
            latest_claim[claim.user_id] = claim  # ascending, so the last one written is the newest
    return {"farmers": [
        {**_farmer_view(f), "created_at": _utc_iso(f.created_at), "pumps": pumps_by_owner.get(f.id, []), "qr": _qr_view(latest_claim.get(f.id))}
        for f in farmers
    ]}
