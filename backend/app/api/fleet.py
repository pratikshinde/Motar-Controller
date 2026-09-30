from datetime import datetime, timedelta, date
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, text, cast, Integer
from app.database import get_db
from app.config import settings
from app.models import Pump, Alert, User, FaultLog
from app.api.deps import get_current_user
from app.repositories.pump_repository import PumpRepository
from app.services.fault_catalog import load_fault_catalog

router = APIRouter(tags=["Fleet Dashboard"])

@router.get("/dashboard")
def get_fleet_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = PumpRepository.for_actor(actor=current_user, db=db)
    pumps = repo._base_query().all()
    pump_ids = [p.id for p in pumps]

    counts = repo.fleet_counts(settings.OFFLINE_AFTER_SECONDS)
    total, running, fault = counts["total"], counts["running"], counts["fault"]
    offline, stopped, no_data = counts["offline"], counts["stopped"], counts["no_data"]
    online_count = running + stopped + fault

    # Faults raised since midnight today (local UTC)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    faults_today = (
        db.query(func.count(FaultLog.id))
        .filter(FaultLog.pump_id.in_(pump_ids), FaultLog.occurred_at >= today_start)
        .scalar() or 0
    ) if pump_ids else 0

    # Map pins
    map_pins = [
        {
            "id": p.id,
            "name": p.name,
            "latitude": float(p.latitude) if p.latitude is not None else 19.9975,
            "longitude": float(p.longitude) if p.longitude is not None else 73.7898,
            "status": p.status,
            "supply_type": p.supply_type,
            "hp_rating": float(p.hp_rating) if p.hp_rating is not None else 5.0,
        }
        for p in pumps
        if p.latitude is not None and p.longitude is not None
    ]

    # Active alerts
    pump_ids = [p.id for p in pumps]
    alert_query = db.query(Alert).filter(Alert.resolved_at.is_(None))
    if pump_ids:
        alert_query = alert_query.filter(Alert.pump_id.in_(pump_ids))
    active_alerts = alert_query.order_by(desc(Alert.last_occurred_at)).limit(10).all()

    # Lifecycle state counts
    lifecycle_map = {}
    for p in pumps:
        state = p.lifecycle_state or "ACTIVE"
        lifecycle_map[state] = lifecycle_map.get(state, 0) + 1
    lifecycle_counts = [{"lifecycle_state": k, "count": v} for k, v in lifecycle_map.items()]

    # Active faults by type: every open alert in scope, grouped in the database.
    fault_type_rows = (
        db.query(Alert.fault_code, Alert.alert_type, func.max(Alert.severity), func.count(Alert.id))
        .filter(Alert.resolved_at.is_(None), Alert.pump_id.in_(pump_ids))
        .group_by(Alert.fault_code, Alert.alert_type)
        .order_by(desc(func.count(Alert.id)))
        .all()
    ) if pump_ids else []
    catalog = load_fault_catalog(db)
    active_faults_by_type = [
        {
            "fault_code": code,
            "name": (catalog[code].name if code in catalog else None)
                    or (f"Fault {code}" if code is not None else (alert_type or "Alert")),
            "count": int(n),
            "severity": severity or (catalog[code].severity if code in catalog else None) or "MEDIUM",
        }
        for code, alert_type, severity, n in fault_type_rows
    ]

    # Firmware distribution: what pumps report, and "unknown" for the ones that have not said.
    firmware_distribution = [
        {"firmware_version": fw or "unknown", "count": int(n)}
        for fw, n in repo._base_query().with_entities(Pump.firmware_version, func.count(Pump.id))
        .group_by(Pump.firmware_version).order_by(desc(func.count(Pump.id))).all()
    ]

    # Top faulting devices over last 30 days (real DB query)
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    top_fault_rows = (
        db.query(FaultLog.pump_id, func.count(FaultLog.id).label("fault_count"))
        .filter(
            FaultLog.pump_id.in_(pump_ids),
            FaultLog.occurred_at >= thirty_days_ago,
        )
        .group_by(FaultLog.pump_id)
        .order_by(desc("fault_count"))
        .limit(5)
        .all()
    )
    pump_name_map = {p.id: p.name for p in pumps}
    top_faulting_devices = [
        {"id": r.pump_id, "name": pump_name_map.get(r.pump_id, r.pump_id), "fault_count": int(r.fault_count)}
        for r in top_fault_rows
    ]

    # Warranty expiring within next 30 days (computed from start_date + period_months)
    today = datetime.utcnow().date()
    expiring = []
    for p in pumps:
        if p.warranty_start_date and p.warranty_period_months:
            try:
                ws = p.warranty_start_date if isinstance(p.warranty_start_date, date) else p.warranty_start_date.date()
                # approximate: add months as 30-day blocks
                end = datetime(
                    ws.year + (ws.month - 1 + p.warranty_period_months) // 12,
                    (ws.month - 1 + p.warranty_period_months) % 12 + 1,
                    ws.day
                ).date()
                days_left = (end - today).days
                if 0 <= days_left <= 30:
                    expiring.append({"id": p.id, "name": p.name, "warranty_end_date": end.isoformat(), "days_left": days_left})
            except (ValueError, OverflowError):
                pass

    return {
        "summary": {
            "total": total,
            "running": running,
            "idle": stopped,
            "fault": fault,
            "offline": offline,
            "no_data": no_data
        },
        "connectivity": {
            "online_count": online_count,
            "offline_count": offline,
            "never_seen_count": no_data,
            "offline_after_seconds": settings.OFFLINE_AFTER_SECONDS
        },
        "lifecycle_counts": lifecycle_counts,
        "active_faults_by_type": active_faults_by_type,
        "faults_today_count": faults_today,
        "warranty_expiring_30d": expiring,
        "top_faulting_devices_30d": top_faulting_devices,
        "firmware_distribution": firmware_distribution,
        "map": map_pins,
        "recent_alerts": [
            {
                "id": str(a.id),
                "pump_id": a.pump_id,
                "alert_type": a.alert_type,
                "severity": a.severity,
                "fault_code": a.fault_code,
                "occurrence_count": a.occurrence_count,
                "last_occurred_at": a.last_occurred_at.isoformat() if a.last_occurred_at else None
            }
            for a in active_alerts
        ]
    }
