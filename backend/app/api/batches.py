from typing import Dict, Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from app.database import get_db
from app.models import DeviceBatch, BatchImei, User
from app.api.deps import get_current_user

router = APIRouter(tags=["Factory Batches & Provisioning"])

def serialize_batch(b: DeviceBatch, db: Session) -> Dict[str, Any]:
    imported_count = db.query(func.count(BatchImei.id)).filter(BatchImei.batch_id == b.id).scalar() or 0
    claimed_count = db.query(func.count(BatchImei.id)).filter(BatchImei.batch_id == b.id, BatchImei.claimed.is_(True)).scalar() or 0
    return {
        "id": str(b.id),
        "batch_code": b.batch_code,
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

    batch = DeviceBatch(
        batch_code=batch_code.strip(),
        model=model,
        hw_rev=payload.get("hw_rev"),
        quantity=int(payload.get("quantity") or payload.get("total_devices") or 0),
        manufacture_date=m_date,
        created_by=current_user.id
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
