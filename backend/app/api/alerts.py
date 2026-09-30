import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import get_db
from app.models import Alert, AlertSubscription, Pump, User
from app.schemas import AlertResolveRequest, AlertAssignRequest, AlertSubscriptionCreate
from app.schemas.farmer import AlertListResponse, MessageResponse
from app.services.fault_catalog import load_fault_catalog
from app.api.deps import get_current_user
from app.repositories import PumpRepository
from app.services.pump_view import build_user_views

router = APIRouter(tags=["Alerts & Notifications"])


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _scoped_alert(db: Session, user: User, alert_id: str) -> Alert:
    """An alert the caller may act on: only alerts on pumps inside their own scope."""
    try:
        key = uuid.UUID(alert_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert = db.query(Alert).filter(Alert.id == key).first()
    if not alert or alert.pump_id not in set(PumpRepository.for_actor(actor=user, db=db).get_accessible_ids()):
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("", response_model=AlertListResponse)
def list_alerts(
    unresolved_only: bool = Query(True),
    severity: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Same visibility as the pump list: a farmer sees alerts on every pump they own or have
    # been given, and nothing else; channel partners see their sub-tree.
    pump_ids = PumpRepository.for_actor(actor=current_user, db=db).get_accessible_ids()
    if not pump_ids:
        return {"alerts": [], "data": []}

    query = db.query(Alert).filter(Alert.pump_id.in_(pump_ids))
    if unresolved_only:
        query = query.filter(Alert.resolved_at.is_(None))
    if severity:
        query = query.filter(Alert.severity == severity.upper())

    alerts = query.order_by(desc(Alert.last_occurred_at)).limit(100).all()

    pumps = db.query(Pump).filter(Pump.id.in_({a.pump_id for a in alerts})).all() if alerts else []
    views = build_user_views(db, current_user, pumps)
    catalog = load_fault_catalog(db)

    formatted_alerts = [
        {
            "id": str(a.id),
            "pump_id": a.pump_id,
            "pump_name": views.get(a.pump_id, {}).get("display_name") or a.pump_id,
            "alert_type": a.alert_type or "FAULT",
            "severity": a.severity or "MEDIUM",
            "fault_code": a.fault_code or 0,
            "fault_name": catalog[a.fault_code].name if a.fault_code in catalog else None,
            "occurrence_count": a.occurrence_count or 1,
            "first_occurred_at": _iso(a.first_occurred_at),
            "last_occurred_at": _iso(a.last_occurred_at) or _iso(a.first_occurred_at),
            "acknowledged_by": str(a.acknowledged_by) if a.acknowledged_by else None,
            "acknowledged_at": _iso(a.acknowledged_at),
            "assigned_to": str(a.assigned_to) if a.assigned_to else None,
            "resolved_at": _iso(a.resolved_at),
            "resolution_note": a.resolution_note,
        }
        for a in alerts
    ]

    return {"alerts": formatted_alerts, "data": formatted_alerts}


@router.post("/{id}/ack", response_model=MessageResponse)
def acknowledge_alert(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    alert = _scoped_alert(db, current_user, id)
    if alert.acknowledged_at is None:
        alert.acknowledged_by = current_user.id
        alert.acknowledged_at = datetime.now(timezone.utc)
        db.commit()
    return {"message": "Alert acknowledged"}


@router.post("/{id}/assign", response_model=MessageResponse)
def assign_alert(
    id: str,
    req: AlertAssignRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role == "customer":
        raise HTTPException(status_code=403, detail="Not permitted")
    alert = _scoped_alert(db, current_user, id)
    assignee = db.query(User).filter(User.id == req.assigned_to).first()
    if not assignee:
        raise HTTPException(status_code=404, detail="Assigned user not found")
    alert.assigned_to = assignee.id
    db.commit()
    return {"message": f"Alert assigned to {assignee.full_name}"}


@router.post("/{id}/resolve", response_model=MessageResponse)
def resolve_alert(
    id: str,
    req: AlertResolveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    alert = _scoped_alert(db, current_user, id)
    if alert.resolved_at is None:
        alert.resolved_at = datetime.now(timezone.utc)
        alert.resolution_note = req.resolution_note
        if alert.acknowledged_at is None:
            alert.acknowledged_by = current_user.id
            alert.acknowledged_at = alert.resolved_at
        db.commit()
    return {"message": "Alert resolved"}


@router.get("/subscriptions")
def list_alert_subscriptions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    subs = db.query(AlertSubscription).filter(AlertSubscription.user_id == current_user.id).all()
    return [
        {
            "id": str(s.id),
            "pump_id": s.pump_id,
            "alert_type": s.alert_type,
            "min_severity": s.min_severity,
            "muted": s.muted,
            "created_at": s.created_at.isoformat() if s.created_at else None
        }
        for s in subs
    ]


@router.post("/subscriptions")
def create_alert_subscription(
    req: AlertSubscriptionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if req.pump_id and req.pump_id not in set(PumpRepository.for_actor(actor=current_user, db=db).get_accessible_ids()):
        raise HTTPException(status_code=404, detail="Pump not found or out of scope")
    sub = AlertSubscription(
        user_id=current_user.id,
        pump_id=req.pump_id,
        alert_type=req.alert_type,
        min_severity=req.min_severity
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return {"message": "Subscription created", "id": str(sub.id)}


@router.delete("/subscriptions/{id}")
def delete_alert_subscription(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    sub = db.query(AlertSubscription).filter(
        AlertSubscription.id == id,
        AlertSubscription.user_id == current_user.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.delete(sub)
    db.commit()
    return {"message": "Subscription removed"}
