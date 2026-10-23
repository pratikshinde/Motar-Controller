"""Configuration templates: named, reusable sets of device settings that a partner applies to many devices at once.

Who sees what: a template belongs to the account that made it. It can be used by that account and by everyone below it
(a manufacturer's template is there for its distributors and dealers), and managed (changed, deleted) by its owner and
by anyone above the owner. A sibling's templates are not visible at all. Only roles that may configure devices (not the
farmer) can use any of it.
"""
from typing import Dict, Any
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ConfigTemplate, User, Pump, DeviceConfig
from app.api.deps import get_current_user
from app.core.permissions import Permission
from app.core.scope import path_in_scope
from app.services.authorization_service import AuthorizationService
from app.services.ws_hub import ws_hub

router = APIRouter(tags=["Config Templates"])

MAX_PUMPS_PER_APPLY = 500


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


def _require_configure(user: User) -> None:
    AuthorizationService.authorize(user, Permission.CONFIGURE_DEVICE)


def _can_use(user: User, tmpl: ConfigTemplate) -> bool:
    """The owner's own account and everything below it."""
    return user.role == "superadmin" or path_in_scope(tmpl.owner_hierarchy_path, user.hierarchy_path)


def _can_manage(user: User, tmpl: ConfigTemplate) -> bool:
    """The owner, and anyone whose subtree contains the owner."""
    return (
        user.role == "superadmin"
        or (tmpl.owner_user_id is not None and tmpl.owner_user_id == user.id)
        or path_in_scope(user.hierarchy_path, tmpl.owner_hierarchy_path)
    )


def _find(db: Session, user: User, id: str) -> ConfigTemplate:
    """The template, or 404 - a template outside the caller's reach looks exactly like one that does not exist."""
    try:
        tmpl = db.query(ConfigTemplate).filter(ConfigTemplate.id == id).first()
    except Exception:
        db.rollback()
        tmpl = None
    if not tmpl or not _can_use(user, tmpl):
        raise HTTPException(status_code=404, detail="Template not found")
    return tmpl


def _checked_settings(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail="desired_json must be an object of setting names and values")
    return value


@router.get("")
def list_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_configure(current_user)
    templates = [t for t in db.query(ConfigTemplate).order_by(ConfigTemplate.created_at.desc()).all() if _can_use(current_user, t)]
    return {"templates": [serialize_template(t) for t in templates]}

@router.post("", status_code=201)
def create_template(
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_configure(current_user)
    name = payload.get("name")
    if not name or not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="Template name is required")
    if len(name.strip()) > 100:
        raise HTTPException(status_code=422, detail="Template name must be 100 characters or fewer")

    desired_json = _checked_settings(payload.get("desired_json") or payload.get("config_json") or {})
    description = payload.get("description")
    hp_rating = payload.get("hp_rating")
    supply_type = payload.get("supply_type") or "3-phase"

    tmpl = ConfigTemplate(
        name=name.strip(),
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
    _require_configure(current_user)
    tmpl = _find(db, current_user, id)
    if not _can_manage(current_user, tmpl):
        raise HTTPException(status_code=403, detail="Only the template's owner, or an account above the owner, can change it")

    if "name" in payload:
        if not isinstance(payload["name"], str) or not payload["name"].strip():
            raise HTTPException(status_code=422, detail="Template name is required")
        tmpl.name = payload["name"].strip()
    if "description" in payload:
        tmpl.description = payload["description"]
    if "desired_json" in payload:
        settings_json = _checked_settings(payload["desired_json"])
        tmpl.desired_json = settings_json
        tmpl.config_json = settings_json
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
    _require_configure(current_user)
    tmpl = _find(db, current_user, id)
    if not _can_manage(current_user, tmpl):
        raise HTTPException(status_code=403, detail="Only the template's owner, or an account above the owner, can delete it")
    db.delete(tmpl)
    db.commit()
    return {"message": "Template deleted"}

@router.post("/{id}/apply")
def apply_template(
    id: str,
    background_tasks: BackgroundTasks,
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Merge the template's settings into each chosen device's desired configuration and mark it PENDING - the same
    thing a manual save of the configuration does (PUT /pumps/{id}/config); the device picks it up from there."""
    _require_configure(current_user)
    tmpl = _find(db, current_user, id)

    pump_ids = payload.get("pump_ids") or []
    if not isinstance(pump_ids, list) or not all(isinstance(p, str) for p in pump_ids):
        raise HTTPException(status_code=422, detail="pump_ids must be a list of device ids")
    if not pump_ids:
        raise HTTPException(status_code=422, detail="No pump_ids specified")
    if len(pump_ids) > MAX_PUMPS_PER_APPLY:
        raise HTTPException(status_code=422, detail=f"A template can be applied to at most {MAX_PUMPS_PER_APPLY} devices at once")

    template_desired = tmpl.desired_json or tmpl.config_json or {}
    results = []
    changed = []

    from app.repositories.pump_repository import PumpRepository
    repo = PumpRepository.for_actor(actor=current_user, db=db)

    for pump_id in dict.fromkeys(pump_ids):
        pump = repo._base_query().filter(Pump.id == pump_id).first()
        if not pump:
            results.append({"pump_id": pump_id, "success": False, "reason": "Pump not found or access denied"})
            continue

        cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == pump_id).first()
        if not cfg:
            cfg = DeviceConfig(pump_id=pump_id, desired_json=dict(template_desired), reported_json={})
            db.add(cfg)
        else:
            cfg.desired_json = {**(cfg.desired_json or {}), **template_desired}
        cfg.status = "PENDING"
        cfg.updated_by = current_user.id
        cfg.updated_at = datetime.utcnow()

        changed.append((pump_id, cfg.desired_json, pump.hierarchy_path))
        results.append({"pump_id": pump_id, "success": True})

    db.commit()

    async def _broadcast():
        for pump_id, desired, path in changed:
            await ws_hub.broadcast_config_update(pump_id, {"status": "PENDING", "desired": desired}, path)

    if changed:
        background_tasks.add_task(_broadcast)

    applied = sum(1 for r in results if r["success"])
    return {"message": f"Template applied to {applied} device(s)", "results": results}
