from typing import Dict, Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ConfigTemplate, User, Pump, DeviceConfig, Command
from app.api.deps import get_current_user

router = APIRouter(tags=["Config Templates"])

def serialize_template(t: ConfigTemplate) -> Dict[str, Any]:
    desired = t.desired_json if t.desired_json is not None else (t.config_json or {})
    return {
        "id": str(t.id),
        "name": t.name,
        "description": t.description,
        "desired_json": desired,
        "owner_user_id": str(t.owner_user_id) if t.owner_user_id else (str(t.created_by) if t.created_by else None),
        "owner_hierarchy_path": t.owner_hierarchy_path or current_user_path(t),
        "hp_rating": float(t.hp_rating) if t.hp_rating is not None else None,
        "supply_type": t.supply_type or "3-phase",
        "created_by": str(t.created_by) if t.created_by else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None
    }

def current_user_path(t: ConfigTemplate) -> str:
    return t.owner_hierarchy_path or "/"

@router.get("")
def list_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    templates = db.query(ConfigTemplate).all()
    serialized = [serialize_template(t) for t in templates]
    return {"templates": serialized}

@router.post("", status_code=201)
def create_template(
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    name = payload.get("name")
    if not name:
        raise HTTPException(status_code=422, detail="Template name is required")
    
    desired_json = payload.get("desired_json") or payload.get("config_json") or {}
    description = payload.get("description")
    hp_rating = payload.get("hp_rating")
    supply_type = payload.get("supply_type") or "3-phase"

    tmpl = ConfigTemplate(
        name=name,
        description=description,
        desired_json=desired_json,
        config_json=desired_json,
        hp_rating=hp_rating,
        supply_type=supply_type,
        owner_user_id=current_user.id,
        owner_hierarchy_path=current_user.hierarchy_path,
        created_by=current_user.id
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return {"message": "Template created", "template": serialize_template(tmpl)}

@router.put("/{id}")
def update_template(
    id: str,
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    tmpl = db.query(ConfigTemplate).filter(ConfigTemplate.id == id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")

    if "name" in payload:
        tmpl.name = payload["name"]
    if "description" in payload:
        tmpl.description = payload["description"]
    if "desired_json" in payload:
        tmpl.desired_json = payload["desired_json"]
        tmpl.config_json = payload["desired_json"]
    if "hp_rating" in payload:
        tmpl.hp_rating = payload["hp_rating"]
    if "supply_type" in payload:
        tmpl.supply_type = payload["supply_type"]

    tmpl.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tmpl)
    return {"message": "Template updated", "template": serialize_template(tmpl)}

@router.delete("/{id}")
def delete_template(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    tmpl = db.query(ConfigTemplate).filter(ConfigTemplate.id == id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tmpl)
    db.commit()
    return {"message": "Template deleted"}

@router.post("/{id}/apply")
def apply_template(
    id: str,
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    tmpl = db.query(ConfigTemplate).filter(ConfigTemplate.id == id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")

    pump_ids = payload.get("pump_ids") or []
    if not pump_ids:
        raise HTTPException(status_code=422, detail="No pump_ids specified")

    template_desired = tmpl.desired_json or tmpl.config_json or {}
    results = []

    from app.repositories.pump_repository import PumpRepository
    repo = PumpRepository.for_actor(actor=current_user, db=db)

    for pump_id in pump_ids:
        pump = repo._base_query().filter(Pump.id == pump_id).first()
        if not pump:
            results.append({"pump_id": pump_id, "success": False, "reason": "Pump not found or access denied"})
            continue

        cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == pump_id).first()
        if not cfg:
            cfg = DeviceConfig(pump_id=pump_id, desired_json=template_desired, reported_json={}, status="PENDING")
            db.add(cfg)
        else:
            merged = {**(cfg.desired_json or {}), **template_desired}
            cfg.desired_json = merged
            cfg.status = "PENDING"

        # Dispatch command to device
        cmd = Command(
            pump_id=pump_id,
            action="UPDATE_CONFIG",
            payload={"desired_json": cfg.desired_json},
            issued_by_user_id=current_user.id
        )
        db.add(cmd)
        results.append({"pump_id": pump_id, "success": True})

    db.commit()
    return {"message": f"Template applied to {len(results)} device(s)", "results": results}
