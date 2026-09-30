"""Connectivity alerts (FR-CLD-024, planner P2.6): tell people when a pump has stopped reporting, and when it is back.

A pump that has reported before but not within `OFFLINE_AFTER_SECONDS` is offline. That is the same rule the API applies
when it shows "Offline" (`connectivity_of`), so what the alert says and what the screen shows cannot disagree.

One open alert per outage. It is raised once when the pump goes quiet, not every sweep and not every 15-minute dedup
bucket, and it is resolved by the sweep itself as soon as the pump reports again (or is taken out of service).
A pump that has never reported has nothing to be "offline" from: it is "No data yet", not an outage.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database import system_session
from app.models import Alert, Pump
from app.services.alert_engine import get_dedup_bucket
from app.services.ws_hub import ws_hub

logger = logging.getLogger("agripump.connectivity")

OFFLINE_ALERT = "OFFLINE"
IN_SERVICE = ("COMMISSIONED", "ACTIVE")       # stock, suspended and retired devices are expected to be quiet
# Any constant: only one API worker at a time may run the sweep, or every worker would raise its own alert.
SWEEP_LOCK_KEY = 5_119_207


def sweep_connectivity(db: Session, now: Optional[datetime] = None) -> Tuple[List[Alert], List[Alert]]:
    """Raise an alert for each pump that has gone quiet and resolve the ones that have recovered.

    Returns (raised, resolved). Commits. Returns nothing at all when another worker holds the sweep.
    """
    now = now or datetime.now(timezone.utc)
    if not db.execute(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": SWEEP_LOCK_KEY}).scalar():
        return [], []

    cutoff = now - timedelta(seconds=settings.OFFLINE_AFTER_SECONDS)
    quiet = {
        pump_id for (pump_id,) in db.query(Pump.id).filter(
            Pump.last_seen_at.isnot(None), Pump.last_seen_at < cutoff, Pump.lifecycle_state.in_(IN_SERVICE)
        )
    }
    open_alerts = {
        a.pump_id: a for a in db.query(Alert).filter(Alert.alert_type == OFFLINE_ALERT, Alert.resolved_at.is_(None))
    }

    raised = []
    for pump_id in sorted(quiet - open_alerts.keys()):
        alert = Alert(
            pump_id=pump_id, alert_type=OFFLINE_ALERT, severity="HIGH", dedup_bucket=get_dedup_bucket(),
            occurrence_count=1, first_occurred_at=now, last_occurred_at=now,
        )
        db.add(alert)
        raised.append(alert)

    resolved = []
    recovered = [pid for pid in open_alerts if pid not in quiet]
    if recovered:
        state = {
            pid: lifecycle for pid, lifecycle in db.query(Pump.id, Pump.lifecycle_state).filter(Pump.id.in_(recovered))
        }
        for pump_id in recovered:
            alert = open_alerts[pump_id]
            alert.resolved_at = now
            alert.resolution_note = (
                "The device is reporting again." if state.get(pump_id) in IN_SERVICE
                else "The device is no longer in service."
            )
            resolved.append(alert)

    db.commit()
    for alert in raised + resolved:
        db.refresh(alert)
    return raised, resolved


def _announcement(db: Session, alert: Alert) -> Tuple[str, Dict[str, Any], Optional[str]]:
    pump = db.query(Pump.hierarchy_path).filter(Pump.id == alert.pump_id).first()
    payload = {
        "id": str(alert.id), "pump_id": alert.pump_id, "alert_type": alert.alert_type, "severity": alert.severity,
        "fault_code": None, "occurrence_count": alert.occurrence_count,
        "first_occurred_at": alert.first_occurred_at.isoformat() if alert.first_occurred_at else None,
        "last_occurred_at": alert.last_occurred_at.isoformat() if alert.last_occurred_at else None,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
    }
    return alert.pump_id, payload, pump[0] if pump else None


def _sweep() -> List[Tuple[str, Dict[str, Any], Optional[str]]]:
    with system_session() as db:
        raised, resolved = sweep_connectivity(db)
        for alert in raised:
            logger.info("Pump %s stopped reporting: connectivity alert raised", alert.pump_id)
        for alert in resolved:
            logger.info("Pump %s: connectivity alert resolved (%s)", alert.pump_id, alert.resolution_note)
        return [_announcement(db, a) for a in raised + resolved]


async def connectivity_sweep_once() -> int:
    """One sweep, then tell connected clients (the same live channel faults use). Returns how many alerts changed."""
    announcements = await run_in_threadpool(_sweep)
    for pump_id, payload, hierarchy_path in announcements:
        try:
            await ws_hub.broadcast_fault(pump_id, payload, hierarchy_path)
        except Exception:
            logger.exception("Could not announce the connectivity alert for %s", pump_id)
    return len(announcements)
