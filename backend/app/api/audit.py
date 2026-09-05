from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import get_db
from app.models import AuditLog, User
from app.api.deps import get_current_user

router = APIRouter(tags=["Audit Log"])

@router.get("")
def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    entity_type: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(AuditLog)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    
    logs = query.order_by(desc(AuditLog.occurred_at)).limit(limit).all()

    entries = [
        {
            "id": l.id,
            "actor_id": str(getattr(l, "actor_id", None) or getattr(l, "actor_user_id", "") or ""),
            "actor_role": getattr(l, "actor_role", None) or "admin",
            "entity_type": l.entity_type,
            "entity_id": str(l.entity_id) if l.entity_id else "",
            "action": l.action,
            "before_json": getattr(l, "before_json", None) or getattr(l, "before_state", None),
            "after_json": getattr(l, "after_json", None) or getattr(l, "after_state", None),
            "ip": getattr(l, "ip", None) or getattr(l, "ip_address", None),
            "occurred_at": l.occurred_at.isoformat() if l.occurred_at else None
        }
        for l in logs
    ]

    return {
        "count": len(entries),
        "entries": entries
    }
