from typing import Dict, Any, List, Optional
from datetime import datetime
import hmac
import re
from fastapi import APIRouter, Depends, HTTPException, Body, Header, File, Form, Query, Response, UploadFile
from pydantic import BaseModel, Field
from typing import Literal
from app.config import settings
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, text
from app.database import get_db
from app.models import DeviceBatch, BatchImei, User, Pump, DeviceConfig, AuditLog
from app.api.deps import get_current_user, require_roles
from app.services import brand_service, starter_sheet

router = APIRouter(tags=["Factory Batches & Provisioning"])

# The serial a device presents becomes its IoT thing name, its MQTT client id and `pumps.id` (SRS 6.7 / FR-SEC-030).
# AWS allows these characters in a thing name; pumps.id is 50 characters.
_THING_NAME = re.compile(r"^[A-Za-z0-9:_-]{1,50}$")


# The factory list is the manufacturer's: only the platform's super admin and a manufacturer's own admin may read or change it (before this, any signed-in
# person could, a farmer included). A manufacturer sees only batches of their own brand.
FACTORY_ROLES = ["superadmin", "manufacturer"]
factory_user = Depends(require_roles(FACTORY_ROLES))


def _scoped_batches(db: Session, user: User):
    q = db.query(DeviceBatch)
    if user.role != "superadmin":
        own = getattr(user, "brand_id", None)
        q = q.filter(DeviceBatch.brand_id == own) if own is not None else q.filter(text("false"))
    return q


def _scoped_starters(db: Session, user: User):
    q = db.query(BatchImei).join(DeviceBatch, DeviceBatch.id == BatchImei.batch_id)
    if user.role != "superadmin":
        own = getattr(user, "brand_id", None)
        q = q.filter(DeviceBatch.brand_id == own) if own is not None else q.filter(text("false"))
    return q

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


# --------------------------------------------------------------------------------------------------------------------------
# The starter sheet (Excel) and the factory station
# --------------------------------------------------------------------------------------------------------------------------
@router.get("/starters/template.xlsx")
def starter_sheet_template(current_user: User = factory_user):
    """An empty starter sheet (Excel) with the column names."""
    return Response(
        content=starter_sheet.template_xlsx(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="starter-sheet-template.xlsx"'},
    )


@router.post("/starters/import")
def import_starter_sheet(
    file: UploadFile = File(...),
    batch_code: str = Form(..., min_length=1, max_length=50),
    model: Optional[str] = Form(None),
    hw_rev: Optional[str] = Form(None),
    device_type: Optional[str] = Form(None),
    current_user: User = factory_user,
    db: Session = Depends(get_db),
):
    """Upload the factory's sheet of starters (Excel or CSV) into a batch (created if the code is new).

    All or nothing: if any row has a problem nothing is saved and every problem is listed with its row number. A starter that is already in the list is
    updated (unless it has been claimed, which freezes it); a starter that belongs to another batch is refused.
    """
    content = file.file.read(starter_sheet.MAX_BYTES + 1)
    try:
        parsed = starter_sheet.parse_sheet(file.filename or "", content)
    except starter_sheet.SheetError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if parsed.errors:
        return {"saved": False, "errors": parsed.errors, "rows_in_sheet": len(parsed.rows) + len(parsed.errors)}

    batch_code = batch_code.strip()
    d_type = (device_type or "AC_3PH").upper()
    if d_type not in ("AC_3PH", "SOLAR_VFD"):
        raise HTTPException(status_code=400, detail="device_type must be AC_3PH or SOLAR_VFD")
    batch = _scoped_batches(db, current_user).filter(DeviceBatch.batch_code == batch_code).first()
    if batch is None and db.query(DeviceBatch.id).filter(DeviceBatch.batch_code == batch_code).first():
        raise HTTPException(status_code=409, detail="That batch code is used by another manufacturer's batch.")
    if batch is not None and batch.revoked:
        raise HTTPException(status_code=409, detail="That batch has been revoked; no starters can be added to it.")

    # Check every row against what is already stored, before writing anything.
    problems = []
    existing: Dict[str, BatchImei] = {}
    for row in parsed.rows:
        found = db.query(BatchImei).filter(BatchImei.mcu_uid == row.starter_id).first()
        if found is not None:
            existing[row.starter_id] = found
            if batch is None or found.batch_id != batch.id:
                other = db.query(DeviceBatch.batch_code).filter(DeviceBatch.id == found.batch_id).scalar()
                problems.append({"row": row.row, "starter_id": row.starter_id, "reason": f"already on the list in batch {other}"})
                continue
            if found.claimed:
                problems.append({"row": row.row, "starter_id": row.starter_id, "reason": "already claimed (its module has its certificate), so its details can no longer be changed"})
                continue
        if row.imei:
            clash = db.query(BatchImei).filter(BatchImei.imei == row.imei)
            if found is not None:
                clash = clash.filter(BatchImei.id != found.id)
            if clash.first() is not None:
                problems.append({"row": row.row, "starter_id": row.starter_id, "reason": f"IMEI {row.imei} is already on the list for another starter"})
    if problems:
        return {"saved": False, "errors": problems, "rows_in_sheet": len(parsed.rows)}

    if batch is None:
        batch = DeviceBatch(
            batch_code=batch_code, device_type=d_type, model=(model or next((r.model for r in parsed.rows if r.model), None) or "Starter"),
            hw_rev=hw_rev, quantity=0, created_by=current_user.id,
            manufacture_date=next((r.manufacture_date for r in parsed.rows if r.manufacture_date), None),
            brand_id=brand_service.brand_id_for_new_device(db, current_user, None),
        )
        db.add(batch)
        db.flush()

    created = updated = unchanged = 0
    for row in parsed.rows:
        fields = {
            "imei": row.imei, "hp_rating": row.hp_rating, "supply_type": row.supply_type, "model": row.model,
            "hw_rev": row.hw_rev, "manufacture_date": row.manufacture_date, "notes": row.notes,
        }
        found = existing.get(row.starter_id)
        if found is None:
            db.add(BatchImei(batch_id=batch.id, mcu_uid=row.starter_id, **fields))
            created += 1
            continue
        changed = False
        for name, value in fields.items():
            if value is not None and getattr(found, name) != value:
                setattr(found, name, value)
                changed = True
        if changed:
            updated += 1
        else:
            unchanged += 1
    db.flush()
    batch.quantity = max(batch.quantity or 0, db.query(func.count(BatchImei.id)).filter(BatchImei.batch_id == batch.id).scalar() or 0)
    db.commit()
    db.refresh(batch)
    return {"saved": True, "created": created, "updated": updated, "unchanged": unchanged, "errors": [], "batch": serialize_batch(batch, db)}


def _station_view(db: Session, row: BatchImei) -> Dict[str, Any]:
    """Everything the factory station shows about one starter, and how far along it is."""
    batch = db.query(DeviceBatch).filter(DeviceBatch.id == row.batch_id).first()
    pump = db.query(Pump).filter(Pump.id == row.pump_id).first() if row.pump_id else None
    owner = db.query(User).filter(User.id == pump.owner_user_id).first() if pump and pump.owner_user_id else None
    tester = db.query(User.full_name).filter(User.id == row.tested_by).scalar() if row.tested_by else None
    connectivity = None
    if pump is not None:
        from app.api.pumps import connectivity_of
        connectivity = connectivity_of(pump.last_seen_at)
    with_farmer = bool(owner and owner.role == "customer")
    made = row.manufacture_date or (batch.manufacture_date if batch else None)
    stages = [
        {"key": "on_sheet", "label": "On the uploaded sheet", "done": True},
        {"key": "tested", "label": "Bench test passed", "done": row.test_result == "PASS", "failed": row.test_result == "FAIL"},
        {"key": "claimed", "label": "Has its own AWS certificate (first power-up done)", "done": bool(row.claimed)},
        {"key": "online", "label": "Reporting to the cloud", "done": connectivity == "ONLINE"},
        {"key": "farmer", "label": "Registered to a farmer", "done": with_farmer},
    ]
    return {
        "found": True,
        "id": row.id,
        "starter_id": row.mcu_uid or row.imei,
        "imei": row.imei,
        "batch": {"id": str(batch.id), "batch_code": batch.batch_code, "revoked": bool(batch.revoked)} if batch else None,
        "details": {
            "hp_rating": float(row.hp_rating) if row.hp_rating is not None else None,
            "supply_type": row.supply_type,
            "model": row.model or (batch.model if batch else None),
            "hw_rev": row.hw_rev or (batch.hw_rev if batch else None),
            "manufacture_date": made.isoformat() if made else None,
            "notes": row.notes,
        },
        "test": {
            "result": row.test_result, "note": row.test_note,
            "tested_at": row.tested_at.isoformat() if row.tested_at else None, "tested_by": tester,
        },
        "claim": {"claimed": bool(row.claimed), "claimed_at": row.claimed_at.isoformat() if row.claimed_at else None, "pump_id": row.pump_id},
        "pump": None if pump is None else {
            "id": pump.id, "status": pump.status, "lifecycle_state": pump.lifecycle_state, "connectivity": connectivity,
            "last_seen_at": pump.last_seen_at.isoformat() if pump.last_seen_at else None,
            "farmer": owner.full_name if with_farmer else None,
        },
        "stages": stages,
    }


@router.get("/starters/lookup")
def lookup_starter(
    code: str = Query(..., min_length=1, max_length=60),
    current_user: User = factory_user,
    db: Session = Depends(get_db),
):
    """The factory station: scan the barcode, get that starter's row from the uploaded sheet and how far along it is."""
    code = code.strip()
    q = _scoped_starters(db, current_user)
    row = q.filter(BatchImei.mcu_uid == code).first() or q.filter(BatchImei.imei == code).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"'{code}' is not on any uploaded sheet. Check the barcode, or upload the batch's sheet first.")
    return _station_view(db, row)


class StarterTestIn(BaseModel):
    result: Literal["PASS", "FAIL"]
    note: Optional[str] = Field(None, max_length=500)


@router.post("/starters/{row_id}/test")
def record_starter_test(
    row_id: int,
    body: StarterTestIn,
    current_user: User = factory_user,
    db: Session = Depends(get_db),
):
    """Record the bench test of one starter (PASS or FAIL, with an optional note); testing again replaces the earlier result."""
    row = _scoped_starters(db, current_user).filter(BatchImei.id == row_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Starter not found")
    batch = db.query(DeviceBatch).filter(DeviceBatch.id == row.batch_id).first()
    if batch is not None and batch.revoked:
        raise HTTPException(status_code=409, detail="That starter's batch has been revoked.")
    row.test_result = body.result
    row.test_note = (body.note or "").strip() or None
    row.tested_at = datetime.utcnow()
    row.tested_by = current_user.id
    db.commit()
    db.refresh(row)
    return _station_view(db, row)


@router.get("")
def list_batches(
    current_user: User = factory_user,
    db: Session = Depends(get_db)
):
    batches = _scoped_batches(db, current_user).order_by(desc(DeviceBatch.created_at)).all()
    serialized = [serialize_batch(b, db) for b in batches]
    return {"batches": serialized}

@router.get("/{id}")
def get_batch_detail(
    id: str,
    current_user: User = factory_user,
    db: Session = Depends(get_db)
):
    batch = _scoped_batches(db, current_user).filter(DeviceBatch.id == id).first()
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
    current_user: User = factory_user,
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
    current_user: User = factory_user,
    db: Session = Depends(get_db)
):
    batch = _scoped_batches(db, current_user).filter(DeviceBatch.id == id).first()
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
    current_user: User = factory_user,
    db: Session = Depends(get_db)
):
    batch = _scoped_batches(db, current_user).filter(DeviceBatch.id == id).first()
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
            supply_type=imei_record.supply_type or "3-phase",      # from the factory's sheet when it said
            hp_rating=imei_record.hp_rating if imei_record.hp_rating is not None else 7.5,
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
