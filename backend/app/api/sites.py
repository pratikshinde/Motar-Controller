"""A farmer's own groups of pumps ("Sites": North field, Farm 2 ...).

Sites belong to the person who created them and are never visible to anyone else, even to another
user who shares one of the pumps. A pump's membership of a site is the caller's private view of it
(device_access.site_id), so grouping a shared pump does not move it for its owner.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.errors import AppError
from app.api.deps import get_current_user
from app.database import get_db
from app.models import DeviceAccess, Site, User
from app.schemas.farmer import MessageResponse, SiteIn, SiteListResponse, SiteOut, SiteUpdate

router = APIRouter(tags=["Sites"])

MAX_SITES_PER_USER = 50


def _out(site: Site, pump_count: int) -> dict:
    return {
        "id": str(site.id),
        "name": site.name,
        "lat": float(site.lat) if site.lat is not None else None,
        "lng": float(site.lng) if site.lng is not None else None,
        "pump_count": pump_count,
    }


def _own_site(db: Session, user: User, site_id: str) -> Site:
    try:
        key = uuid.UUID(site_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Site not found")
    site = db.query(Site).filter(Site.id == key, Site.owner_user_id == user.id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


def _pump_count(db: Session, user: User, site_id) -> int:
    return (
        db.query(func.count(DeviceAccess.id))
        .filter(DeviceAccess.user_id == user.id, DeviceAccess.site_id == site_id)
        .scalar() or 0
    )


def _ensure_name_free(db: Session, user: User, name: str, ignore_id=None) -> None:
    q = db.query(Site.id).filter(Site.owner_user_id == user.id, func.lower(Site.name) == name.lower())
    if ignore_id is not None:
        q = q.filter(Site.id != ignore_id)
    if q.first():
        raise AppError(
            code="SITE_NAME_EXISTS",
            message_key="errors.site_name_exists",
            status_code=409,
            detail="You already have a site with this name.",
        )


@router.get("", response_model=SiteListResponse)
def list_sites(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sites = db.query(Site).filter(Site.owner_user_id == current_user.id).order_by(func.lower(Site.name)).all()
    counts = dict(
        db.query(DeviceAccess.site_id, func.count(DeviceAccess.id))
        .filter(DeviceAccess.user_id == current_user.id, DeviceAccess.site_id.isnot(None))
        .group_by(DeviceAccess.site_id)
        .all()
    )
    return {"sites": [_out(s, counts.get(s.id, 0)) for s in sites]}


@router.post("", response_model=SiteOut, status_code=201)
def create_site(req: SiteIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    if db.query(func.count(Site.id)).filter(Site.owner_user_id == current_user.id).scalar() >= MAX_SITES_PER_USER:
        raise HTTPException(status_code=400, detail="Too many sites")
    _ensure_name_free(db, current_user, name)
    site = Site(owner_user_id=current_user.id, name=name, lat=req.lat, lng=req.lng)
    db.add(site)
    db.commit()
    db.refresh(site)
    return _out(site, 0)


@router.patch("/{id}", response_model=SiteOut)
def update_site(id: str, req: SiteUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    site = _own_site(db, current_user, id)
    if req.name is not None:
        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        _ensure_name_free(db, current_user, name, ignore_id=site.id)
        site.name = name
    if req.lat is not None:
        site.lat = req.lat
    if req.lng is not None:
        site.lng = req.lng
    db.commit()
    db.refresh(site)
    return _out(site, _pump_count(db, current_user, site.id))


@router.delete("/{id}", response_model=MessageResponse)
def delete_site(id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Removes the group only; its pumps stay in the farmer's list, ungrouped."""
    site = _own_site(db, current_user, id)
    db.query(DeviceAccess).filter(
        DeviceAccess.user_id == current_user.id, DeviceAccess.site_id == site.id
    ).update({"site_id": None}, synchronize_session=False)
    db.delete(site)
    db.commit()
    return {"message": "Site removed"}
