import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.models import Alert, AlertSubscription, Pump, FaultLog
from app.services.ws_hub import ws_hub

DEDUP_WINDOW_SECONDS = 900  # 15 minutes

def get_dedup_bucket(now_ts: Optional[float] = None) -> int:
    ts = now_ts or time.time()
    return int(ts // DEDUP_WINDOW_SECONDS)

async def raise_alert(
    db: Session,
    pump_id: str,
    alert_type: str,
    severity: str,
    fault_code: Optional[int] = None,
    source_fault_log_id: Optional[int] = None,
    resolution_note: Optional[str] = None
) -> Alert:
    now = datetime.utcnow()
    bucket = get_dedup_bucket()

    # Find existing matching alert in the same 15-minute bucket
    alert = (
        db.query(Alert)
        .filter(
            Alert.pump_id == pump_id,
            Alert.alert_type == alert_type,
            Alert.fault_code == fault_code,
            Alert.dedup_bucket == bucket
        )
        .first()
    )

    if alert:
        alert.occurrence_count += 1
        alert.last_occurred_at = now
        if source_fault_log_id:
            alert.source_fault_log_id = source_fault_log_id
        db.commit()
        db.refresh(alert)
    else:
        alert = Alert(
            pump_id=pump_id,
            alert_type=alert_type,
            severity=severity,
            fault_code=fault_code,
            source_fault_log_id=source_fault_log_id,
            dedup_bucket=bucket,
            occurrence_count=1,
            first_occurred_at=now,
            last_occurred_at=now,
            resolution_note=resolution_note
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)

    # Fetch pump hierarchy for scoped broadcast
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    h_path = pump.hierarchy_path if pump else None

    # Broadcast alert over WebSocket
    alert_payload = {
        "id": str(alert.id),
        "pump_id": alert.pump_id,
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "fault_code": alert.fault_code,
        "occurrence_count": alert.occurrence_count,
        "first_occurred_at": alert.first_occurred_at.isoformat() if alert.first_occurred_at else None,
        "last_occurred_at": alert.last_occurred_at.isoformat() if alert.last_occurred_at else None,
    }
    await ws_hub.broadcast_fault(pump_id, alert_payload, h_path)

    return alert

async def run_offline_sweep(db: Session, offline_threshold_minutes: int = 15):
    cutoff = datetime.utcnow() - timedelta(minutes=offline_threshold_minutes)
    offline_pumps = (
        db.query(Pump)
        .filter(Pump.last_seen_at < cutoff, Pump.status != "OFFLINE", Pump.lifecycle_state == "ACTIVE")
        .all()
    )
    for pump in offline_pumps:
        pump.status = "OFFLINE"
        db.commit()
        await raise_alert(
            db=db,
            pump_id=pump.id,
            alert_type="OFFLINE",
            severity="HIGH"
        )
