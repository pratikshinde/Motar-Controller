from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, text
from app.database import get_db
from app.models import Pump, Alert, User, FaultLog
from app.api.deps import get_current_user

router = APIRouter(tags=["Fleet Dashboard"])

@router.get("/dashboard")
def get_fleet_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Pump)
    if current_user.role == "customer":
        query = query.filter(Pump.owner_user_id == current_user.id)
    elif current_user.role != "superadmin":
        query = query.filter(Pump.hierarchy_path.startswith(current_user.hierarchy_path))

    pumps = query.all()

    total = len(pumps)
    running = sum(1 for p in pumps if p.status == "RUNNING")
    fault = sum(1 for p in pumps if p.status == "FAULT")
    offline = sum(1 for p in pumps if p.status == "OFFLINE")
    stopped = sum(1 for p in pumps if p.status in ["STOPPED", "OFF", "IDLE"])
    online_count = running + stopped

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

    # Active faults by type
    fault_type_map = {}
    for a in active_alerts:
        name = a.alert_type or f"Fault {a.fault_code}"
        if name not in fault_type_map:
            fault_type_map[name] = {"fault_code": a.fault_code, "name": name, "count": 0, "severity": a.severity or "MEDIUM"}
        fault_type_map[name]["count"] += 1
    active_faults_by_type = list(fault_type_map.values())

    # Firmware distribution
    fw_map = {}
    for p in pumps:
        fw = p.firmware_version or "1.0.367"
        fw_map[fw] = fw_map.get(fw, 0) + 1
    firmware_distribution = [{"firmware_version": k, "count": v} for k, v in fw_map.items()]

    return {
        "summary": {
            "total": total,
            "running": running,
            "idle": stopped,
            "fault": fault,
            "offline": offline
        },
        "connectivity": {
            "online_count": online_count,
            "offline_count": offline
        },
        "lifecycle_counts": lifecycle_counts,
        "active_faults_by_type": active_faults_by_type,
        "faults_today_count": fault,
        "warranty_expiring_30d": [],
        "top_faulting_devices_30d": [],
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
