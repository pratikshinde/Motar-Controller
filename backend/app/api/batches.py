from typing import Dict, Any, List, Optional
from datetime import datetime
import hmac
import re
from fastapi import APIRouter, Depends, HTTPException, Body, Header
from app.config import settings
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, text
from app.database import get_db
from app.models import DeviceBatch, BatchImei, User, Pump, DeviceConfig, AuditLog
from app.api.deps import get_current_user
from app.services import brand_service

router = APIRouter(tags=["Factory Batches & Provisioning"])

# The serial a device presents becomes its IoT thing name, its MQTT client id and `pumps.id` (SRS 6.7 / FR-SEC-030).
# AWS allows these characters in a thing name; pumps.id is 50 characters.
_THING_NAME = re.compile(r"^[A-Za-z0-9:_-]{1,50}$")

def serialize_batch(b: DeviceBatch, db: Session) -> Dict[str, Any]:
    imported_count = db.query(func.count(BatchImei.id)).filter(BatchImei.batch_id == b.id).scalar() or 0
    claimed_count = db.query(func.count(BatchImei.id)).filter(BatchImei.batch_id == b.id, BatchImei.claimed.is_(True)).scalar() or 0
    return {
        "id": str(b.id),
        "batch_code": b.batch_code,
        "device_type": getattr(b, "device_type", "AC_3PH") or "AC_3PH",
        "model": b.model,
        "hw_rev": b.hw_rev,
        "quantity": b.quantity,
        "manufacture_date": b.manufacture_date.isoformat() if b.manufacture_date else None,
        "created_by": str(b.created_by) if b.created_by else None,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "revoked": b.revoked or False,
        "revoked_at": b.revoked_at.isoformat() if b.revoked_at else None,
        "imported_count": imported_count,
        "claimed_count": claimed_count
    }

def serialize_imei(i: BatchImei) -> Dict[str, Any]:
    return {
        "id": str(i.id),
        "imei": i.imei,
        "mcu_uid": i.mcu_uid,
        "claimed": i.claimed or False,
        "claimed_at": i.claimed_at.isoformat() if i.claimed_at else None,
        "pump_id": i.pump_id,
        "created_at": i.created_at.isoformat() if i.created_at else None
    }

@router.get("")
def list_batches(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    batches = db.query(DeviceBatch).order_by(desc(DeviceBatch.created_at)).all()
    serialized = [serialize_batch(b, db) for b in batches]
    return {"batches": serialized}

@router.get("/{id}")
def get_batch_detail(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    batch = db.query(DeviceBatch).filter(DeviceBatch.id == id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    imeis = db.query(BatchImei).filter(BatchImei.batch_id == batch.id).all()
    return {
        "batch": serialize_batch(batch, db),
        "imeis": [serialize_imei(i) for i in imeis]
    }

@router.post("", status_code=201)
def create_batch(
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    batch_code = payload.get("batch_code") or payload.get("batch_number")
    model = payload.get("model") or "AgriPump Standard"
    if not batch_code:
        raise HTTPException(status_code=422, detail="batch_code is required")

    existing = db.query(DeviceBatch).filter(DeviceBatch.batch_code == batch_code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Batch code '{batch_code}' already exists")

    m_date = None
    if payload.get("manufacture_date"):
        try:
            m_date = datetime.strptime(payload["manufacture_date"][:10], "%Y-%m-%d").date()
        except ValueError:
            pass

    d_type = (payload.get("device_type") or "AC_3PH").strip().upper()
    if d_type not in ("AC_3PH", "SOLAR_VFD"):
        raise HTTPException(status_code=400, detail="device_type must be 'AC_3PH' or 'SOLAR_VFD'")

    batch = DeviceBatch(
        batch_code=batch_code.strip(),
        device_type=d_type,
        model=model,
        hw_rev=payload.get("hw_rev"),
        quantity=int(payload.get("quantity") or payload.get("total_devices") or 0),
        manufacture_date=m_date,
        created_by=current_user.id,
        brand_id=brand_service.brand_id_for_new_device(db, current_user, payload.get("brand")),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {"message": "Batch created", "batch": serialize_batch(batch, db)}

@router.post("/{id}/imeis")
def import_imeis(
    id: str,
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    batch = db.query(DeviceBatch).filter(DeviceBatch.id == id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    raw = payload.get("raw") or payload.get("imeis") or ""
    lines = []
    if isinstance(raw, list):
        lines = [str(x).strip() for x in raw]
    else:
        lines = [line.strip() for line in str(raw).splitlines() if line.strip()]

    inserted = []
    errors = []

    for idx, line in enumerate(lines, start=1):
        parts = [p.strip() for p in line.split(",") if p.strip()]
        if not parts:
            continue
        imei = parts[0]
        mcu_uid = parts[1] if len(parts) > 1 else None

        if len(imei) < 14 or not imei.isdigit():
            errors.append({"row": idx, "imei": imei, "reason": "Invalid IMEI digit format"})
            continue

        existing = db.query(BatchImei).filter(BatchImei.imei == imei).first()
        if existing:
            errors.append({"row": idx, "imei": imei, "reason": "IMEI already whitelisted"})
            continue

        item = BatchImei(
            batch_id=batch.id,
            imei=imei,
            mcu_uid=mcu_uid
        )
        db.add(item)
        inserted.append({"id": str(item.id), "imei": imei, "mcu_uid": mcu_uid})

    db.commit()
    return {
        "message": f"Processed {len(inserted)} valid IMEI(s)",
        "inserted": inserted,
        "errors": errors
    }

@router.post("/{id}/revoke")
def revoke_batch(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    batch = db.query(DeviceBatch).filter(DeviceBatch.id == id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch.revoked = True
    batch.revoked_at = datetime.utcnow()
    db.commit()
    db.refresh(batch)
    return {"message": "Batch revoked", "batch": serialize_batch(batch, db)}

@router.post("/provisioning/pre-hook")
def fleet_provisioning_pre_hook(
    payload: Dict[str, Any] = Body(...),
    x_hook_secret: Optional[str] = Header(None, alias="X-Hook-Secret"),
    db: Session = Depends(get_db)
):
    """
    AWS IoT Fleet Provisioning pre-provisioning hook (SRS §5.2.1 / P2.1).
    Validates that the connecting device's serial exists in whitelist batch,
    is not revoked, and has not already been claimed.

    Identity: the serial the device presents is its `dev_id`, and it is used verbatim as the thing name, the MQTT client
    id and the pump id. It is matched against the factory whitelist by MCU UID first (SRS 5.2.1) and by IMEI second.
    The ingest worker looks a pump up by the authenticated client id, so these four must be one string.
    """
    # Otherwise this is a public oracle for which serial numbers are valid. Outside development the hook's own
    # secret is mandatory: the Lambda that calls it sends it in X-Hook-Secret.
    expected = settings.PROVISIONING_HOOK_SECRET
    if expected or settings.ENV != "development":
        if not expected or not x_hook_secret or not hmac.compare_digest(x_hook_secret, expected):
            raise HTTPException(status_code=401, detail="Invalid provisioning hook credentials")

    params = payload.get("parameters", {})
    serial = str(params.get("SerialNumber") or params.get("serial") or params.get("imei") or "").strip()

    if not serial:
        return {
            "allowProvisioning": False,
            "parameterOverrides": {},
            "error": "Missing SerialNumber in provisioning parameters"
        }

    if not _THING_NAME.match(serial):
        return {
            "allowProvisioning": False,
            "parameterOverrides": {},
            "error": "Serial is not a valid thing name (letters, digits, ':', '_' and '-' only, at most 50 characters)"
        }

    # Query factory whitelist: the MCU UID is the device's own id; the IMEI is the fallback for units listed by IMEI.
    # mcu_uid is not unique in the table, so a UID listed twice is refused rather than guessed at.
    matches = db.query(BatchImei).filter(BatchImei.mcu_uid == serial).all()
    if not matches:
        matches = db.query(BatchImei).filter(BatchImei.imei == serial).all()
    if len(matches) > 1:
        return {
            "allowProvisioning": False,
            "parameterOverrides": {},
            "error": f"Device serial '{serial}' matches more than one whitelist entry"
        }
    imei_record = matches[0] if matches else None
    if not imei_record:
        return {
            "allowProvisioning": False,
            "parameterOverrides": {},
            "error": f"Device serial '{serial}' is not in factory whitelist"
        }

    # Verify batch not revoked
    batch = db.query(DeviceBatch).filter(DeviceBatch.id == imei_record.batch_id).first()
    if not batch or batch.revoked:
        return {
            "allowProvisioning": False,
            "parameterOverrides": {},
            "error": "Device batch is revoked or invalid"
        }

    # Check if already claimed
    if imei_record.claimed:
        return {
            "allowProvisioning": False,
            "parameterOverrides": {},
            "error": f"Device serial '{serial}' has already been claimed"
        }

    # Enable system provisioning context for RLS
    db.execute(text("SET app.bypass_rls = 'on';"))

    # Ensure pump record exists in state COMMISSIONED first to satisfy FK constraint
    pump_id = serial
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    if not pump:
        owner_id = batch.created_by
        if not owner_id:
            superadmin = db.query(User).filter(User.role == "superadmin").first()
            owner_id = superadmin.id if superadmin else None

        pump = Pump(
            id=pump_id,
            name=f"Pump {serial[-6:]}",
            device_type=getattr(batch, "device_type", "AC_3PH") or "AC_3PH",
            supply_type="3-phase",
            hp_rating=7.5,
            owner_user_id=owner_id,
            hierarchy_path="/SA",
            status="STOPPED",
            lifecycle_state="COMMISSIONED",
            brand_id=batch.brand_id,   # the manufacturer whose factory batch this unit came from
            firmware_version=None   # the device reports its own firmware version in its first frame
        )
        db.add(pump)
        db.add(DeviceConfig(
            pump_id=pump_id,
            desired_json={"ol": 25.0, "ov": 480, "dr": 1, "dr_t": 5},
            status="APPLIED"
        ))
        db.flush()

    # Mark IMEI as claimed
    imei_record.claimed = True
    imei_record.claimed_at = datetime.utcnow()
    imei_record.pump_id = pump_id

    db.commit()

    return {
        "allowProvisioning": True,
        "parameterOverrides": {
            "ThingName": pump_id,
            "ThingGroupName": "dev" if "dev" in (batch.model or "").lower() else "production"
        }
    }
