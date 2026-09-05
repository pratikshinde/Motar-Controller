import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models import Command, Pump

COMMAND_COOLDOWN_SECONDS = 45

def check_command_cooldown(db: Session, pump_id: str) -> Tuple[bool, int]:
    """
    Returns (can_execute: bool, remaining_cooldown_seconds: int).
    """
    latest = (
        db.query(Command)
        .filter(Command.pump_id == pump_id)
        .order_by(desc(Command.issued_at))
        .first()
    )
    if not latest or not latest.issued_at:
        return True, 0

    elapsed = (datetime.utcnow() - latest.issued_at.replace(tzinfo=None)).total_seconds()
    if elapsed < COMMAND_COOLDOWN_SECONDS:
        remaining = int(COMMAND_COOLDOWN_SECONDS - elapsed)
        return False, remaining
    return True, 0

def create_command(
    db: Session,
    pump_id: str,
    command_str: str,
    payload: Dict[str, Any],
    actor_user_id: Optional[uuid.UUID],
    ttl_seconds: int = 120
) -> Command:
    now = datetime.utcnow()
    expires_at = now + timedelta(seconds=ttl_seconds)
    cmd = Command(
        pump_id=pump_id,
        action=command_str.upper(),
        actor_id=actor_user_id,
        status="PENDING",
        issued_at=now,
        expires_at=expires_at
    )
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    return cmd
