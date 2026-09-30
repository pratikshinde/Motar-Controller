from app.core.scope import in_subtree
from typing import Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from app.database import get_db
from app.models import User, FaultLog, Pump
from app.api.deps import get_current_user

router = APIRouter(tags=["Service Reports"])


@router.get("")
@router.get("/", include_in_schema=False)
def list_service_reports(
    days: Optional[int] = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Per-pump fault-frequency service report for the caller's scope.
    Groups FaultLog rows by pump over the requested window and returns
    one row per pump ordered by fault count descending.  No fake data.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Scoped pump ids
    pump_q = db.query(Pump.id)
    if current_user.role == "customer":
        pump_q = pump_q.filter(Pump.owner_user_id == current_user.id)
    elif current_user.role != "superadmin":
        pump_q = pump_q.filter(in_subtree(Pump.hierarchy_path, current_user.hierarchy_path))
    scoped_pump_ids = [row[0] for row in pump_q.all()]

    if not scoped_pump_ids:
        return []

    # Aggregate: count fault logs per pump in the window
    rows = (
        db.query(
            FaultLog.pump_id,
            func.count(FaultLog.id).label("fault_count"),
            func.max(FaultLog.occurred_at).label("last_fault_at"),
        )
        .filter(
            FaultLog.pump_id.in_(scoped_pump_ids),
            FaultLog.occurred_at >= since,
        )
        .group_by(FaultLog.pump_id)
        .order_by(desc("fault_count"))
        .limit(50)
        .all()
    )

    if not rows:
        return []

    # Fetch pump names for the result set
    result_pump_ids = [r.pump_id for r in rows]
    pump_names: dict = {
        p.id: p.name
        for p in db.query(Pump).filter(Pump.id.in_(result_pump_ids)).all()
    }

    return [
        {
            "pump_id": r.pump_id,
            "pump_name": pump_names.get(r.pump_id, r.pump_id),
            "fault_count": int(r.fault_count),
            "last_fault_at": r.last_fault_at.isoformat() if r.last_fault_at else None,
            "window_days": days,
        }
        for r in rows
    ]
