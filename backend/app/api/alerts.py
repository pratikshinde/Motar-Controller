import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import get_db
from app.models import Alert, AlertSubscription, Pump, User
from app.schemas import AlertResolveRequest, AlertAssignRequest, AlertSubscriptionCreate
from app.api.deps import get_current_user

router = APIRouter(tags=["Alerts & Notifications"])

@router.get("")
def list_alerts(
    unresolved_only: bool = Query(True),
    severity: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Alert)
    
    if current_user.role == "customer":
        user_pumps = db.query(Pump.id).filter(Pump.owner_user_id == current_user.id).all()
        query = query.filter(Alert.pump_id.in_([p[0] for p in user_pumps]))
    elif current_user.role != "superadmin":
        scoped_pumps = db.query(Pump.id).filter(Pump.hierarchy_path.startswith(current_user.hierarchy_path)).all()
        query = query.filter(Alert.pump_id.in_([p[0] for p in scoped_pumps]))

    if unresolved_only:
        query = query.filter(Alert.resolved_at.is_(None))

    if severity:
        query = query.filter(Alert.severity == severity.upper())

    alerts = query.order_by(desc(Alert.last_occurred_at)).limit(100).all()

    formatted_alerts = [
        {
            "id": str(a.id),
            "pump_id": a.pump_id,
            "pump_name": f"Pump {a.pump_id}",
            "alert_type": a.alert_type or "FAULT",
            "severity": a.severity or "MEDIUM",
            "fault_code": a.fault_code or 0,
            "occurrence_count": a.occurrence_count or 1,
            "first_occurred_at": a.first_occurred_at.isoformat() if a.first_occurred_at else None,
            "last_occurred_at": a.last_occurred_at.isoformat() if a.last_occurred_at else datetime.utcnow().isoformat(),
            "acknowledged_by": str(a.acknowledged_by) if a.acknowledged_by else None,
            "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
            "assigned_to": str(a.assigned_to) if a.assigned_to else None,
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
            "resolution_note": a.resolution_note,
        }
        for a in alerts
    ]

    return {
        "alerts": formatted_alerts,
        "data": formatted_alerts
    }

@router.post("/{id}/ack")
def acknowledge_alert(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    alert = db.query(Alert).filter(Alert.id == id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged_by = current_user.id
    alert.acknowledged_at = datetime.utcnow()
    db.commit()
    return {"message": "Alert acknowledged"}

@router.post("/{id}/assign")
def assign_alert(
    id: str,
    req: AlertAssignRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    alert = db.query(Alert).filter(Alert.id == id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    assignee = db.query(User).filter(User.id == req.assigned_to).first()
    if not assignee:
        raise HTTPException(status_code=404, detail="Assigned user not found")
    alert.assigned_to = assignee.id
    db.commit()
    return {"message": f"Alert assigned to {assignee.full_name}"}

@router.post("/{id}/resolve")
def resolve_alert(
    id: str,
    req: AlertResolveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    alert = db.query(Alert).filter(Alert.id == id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.resolved_at = datetime.utcnow()
    alert.resolution_note = req.resolution_note
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
