"""A user's own view of their pumps: nickname, group, order and role (device_access + sites).

Shared by the pump list/detail and the alerts endpoints so a farmer sees the same name for a
pump everywhere.
"""
from typing import Dict, Iterable, Optional
from sqlalchemy.orm import Session
from app.models import DeviceAccess, Pump, Site, User


def build_user_views(db: Session, user: User, pumps: Iterable[Pump]) -> Dict[str, Dict[str, Optional[object]]]:
    pumps = list(pumps)
    if not pumps:
        return {}
    ids = [p.id for p in pumps]
    access = {
        a.device_id: a
        for a in db.query(DeviceAccess)
        .filter(DeviceAccess.user_id == user.id, DeviceAccess.device_id.in_(ids))
        .all()
    }
    site_ids = {a.site_id for a in access.values() if a.site_id}
    sites = {}
    if site_ids:
        sites = {s.id: s.name for s in db.query(Site).filter(Site.id.in_(site_ids)).all()}

    views: Dict[str, Dict[str, Optional[object]]] = {}
    for p in pumps:
        a = access.get(p.id)
        nickname = (a.nickname or None) if a else None
        role = a.role if a else ("owner" if p.owner_user_id == user.id else None)
        views[p.id] = {
            "display_name": nickname or p.name,
            "nickname": nickname,
            "site_id": str(a.site_id) if (a and a.site_id) else None,
            "site_name": sites.get(a.site_id) if (a and a.site_id) else None,
            "sort_order": a.sort_order if a else 0,
            "access_role": role,
            "device_type": getattr(p, "device_type", "AC_3PH") or "AC_3PH",
        }
    return views
