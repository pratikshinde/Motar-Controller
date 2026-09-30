"""Command lifecycle (P2.4): creation, the state machine, and how a pump's own answers move a command along.

    QUEUED -> SENT -> DELIVERED -> ACKNOWLEDGED -> APPLIED
       \\        \\         \\            \\
        `--------`---------`------------`--> REJECTED | EXPIRED | FAILED | NOT_CONFIRMED

A command only advances on evidence:

  QUEUED        we recorded the request
  SENT          the broker accepted the publish (says nothing about the pump)
  DELIVERED     the device / bridge said it received it
  ACKNOWLEDGED  the pump's controller answered ok (correlated to the command)
  APPLIED       the pump's own reading shows the requested state, or it said so itself

Nothing here ever reports success it has not seen. A command nobody answered ends NOT_CONFIRMED (or
EXPIRED if it was never sent in time); FAILED means the broker refused it, so the pump was never asked.

Interim mode (until firmware F2 correlates acks to a `cid`): for START / STOP, a reading taken after the
command was sent that shows the requested motor state moves it to APPLIED. A device that has ever answered
with an ack carrying a `cid` is switched to ack-only for good (`Pump.supports_command_ack`).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AuditLog, Command, Pump

logger = logging.getLogger("agripump.commands")

QUEUED, SENT, DELIVERED, ACKNOWLEDGED, APPLIED = "QUEUED", "SENT", "DELIVERED", "ACKNOWLEDGED", "APPLIED"
REJECTED, EXPIRED, FAILED, NOT_CONFIRMED = "REJECTED", "EXPIRED", "FAILED", "NOT_CONFIRMED"

FORWARD = (QUEUED, SENT, DELIVERED, ACKNOWLEDGED, APPLIED)
OPEN_STATES = (QUEUED, SENT, DELIVERED, ACKNOWLEDGED)
TERMINAL_STATES = (APPLIED, REJECTED, EXPIRED, FAILED, NOT_CONFIRMED)

# Steps may be skipped (a bridge without delivery receipts goes SENT -> ACKNOWLEDGED), never taken backwards.
_ALLOWED: Dict[str, Tuple[str, ...]] = {
    QUEUED: (SENT, FAILED, EXPIRED),
    SENT: (DELIVERED, ACKNOWLEDGED, APPLIED, REJECTED, EXPIRED, NOT_CONFIRMED),
    DELIVERED: (ACKNOWLEDGED, APPLIED, REJECTED, EXPIRED, NOT_CONFIRMED),
    ACKNOWLEDGED: (APPLIED, REJECTED, EXPIRED, NOT_CONFIRMED),
}
_TIMESTAMP = {SENT: "sent_at", DELIVERED: "delivered_at", ACKNOWLEDGED: "acked_at", APPLIED: "applied_at"}

# Seconds a farmer must wait between commands to one pump. The server decides; clients only display it.
COMMAND_COOLDOWN_SECONDS = 45

# Layer A (MCU) names for what a bare `ack` frame is answering (SRS §6.1).
_ACK_REF = {"START": "motor_cmd", "STOP": "motor_cmd", "SET_TIMER": "settings", "SET_CONFIG": "settings"}
# Motor state a START / STOP asks for; the only commands whose effect a reading can prove.
_EXPECTED_MOTOR = {"START": True, "STOP": False}


class IllegalTransition(Exception):
    """A command was asked to move somewhere its current state does not allow."""


def aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    dt = aware(dt)
    return dt.isoformat() if dt else None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Cooldown
# ---------------------------------------------------------------------------
def check_command_cooldown(db: Session, pump_id: str) -> Tuple[bool, int]:
    """Returns (can_execute, seconds still to wait)."""
    # The pause protects the motor's starter from rapid cycling. A command that never left the server (the broker
    # refused it, or it expired unsent) cannot have cycled anything, so it does not hold the next attempt back.
    latest = (
        db.query(Command)
        .filter(Command.pump_id == pump_id)
        .filter(~(Command.sent_at.is_(None) & Command.status.in_((FAILED, EXPIRED))))
        .order_by(desc(Command.issued_at))
        .first()
    )
    issued = aware(latest.issued_at) if latest else None
    if not issued:
        return True, 0
    elapsed = (now_utc() - issued).total_seconds()
    if elapsed < COMMAND_COOLDOWN_SECONDS:
        return False, max(1, int(COMMAND_COOLDOWN_SECONDS - elapsed + 0.999))
    return True, 0


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------
def find_by_idempotency_key(db: Session, pump_id: str, key: Optional[str]) -> Optional[Command]:
    if not key:
        return None
    return db.query(Command).filter(Command.pump_id == pump_id, Command.idempotency_key == key).first()


def create_command(
    db: Session,
    pump_id: str,
    command_str: str,
    payload: Optional[Dict[str, Any]],
    actor_user_id: Optional[uuid.UUID],
    ttl_seconds: Optional[int] = None,
    idempotency_key: Optional[str] = None,
) -> Command:
    """Records a command as QUEUED. Publishing is a separate step (`command_dispatch.dispatch_command`)."""
    now = now_utc()
    cmd = Command(
        pump_id=pump_id,
        action=command_str.upper(),
        actor_id=actor_user_id,
        status=QUEUED,
        payload=payload or {},
        idempotency_key=(idempotency_key or None) and idempotency_key[:100],
        issued_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds or settings.COMMAND_TTL_SECONDS),
    )
    db.add(cmd)
    db.flush()  # the audit row's policy looks the command up
    _audit(db, cmd, "COMMAND_QUEUED", before=None, actor_id=actor_user_id)
    db.commit()
    db.refresh(cmd)
    return cmd


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------
def can_transition(current: str, new: str) -> bool:
    return new in _ALLOWED.get(current, ())


def _audit(db: Session, cmd: Command, action: str, before: Optional[str], actor_id: Optional[uuid.UUID] = None) -> None:
    db.add(AuditLog(
        actor_id=actor_id,
        actor_role=None if actor_id else "system",
        entity_type="command",
        entity_id=str(cmd.cid),
        action=action,
        before_json={"status": before} if before else None,
        after_json={"status": cmd.status, "pump_id": cmd.pump_id, "command": cmd.action, "reason": cmd.failure_reason or cmd.reject_reason},
    ))


def transition(
    db: Session,
    cmd: Command,
    new: str,
    *,
    reason: Optional[str] = None,
    at: Optional[datetime] = None,
) -> bool:
    """Moves `cmd` to `new`. Returns False when it is already there; raises IllegalTransition otherwise if not allowed.

    The caller commits: several commands may move in one batch. `reason` is a stable code, not prose.
    """
    if cmd.status == new:
        return False
    if not can_transition(cmd.status, new):
        raise IllegalTransition(f"{cmd.status} -> {new} is not allowed for command {cmd.cid}")
    before = cmd.status
    cmd.status = new
    stamp = _TIMESTAMP.get(new)
    if stamp:
        setattr(cmd, stamp, at or now_utc())
    if new == REJECTED:
        cmd.reject_reason = (reason or "rejected")[:50]
    elif new in (FAILED, NOT_CONFIRMED, EXPIRED):
        cmd.failure_reason = (reason or new.lower())[:50]
    _audit(db, cmd, f"COMMAND_{new}", before=before)
    return True


def advance(db: Session, cmd: Command, new: str, **kw) -> bool:
    """`transition` for events that can arrive late or twice (acks, readings): a stale one is ignored."""
    try:
        return transition(db, cmd, new, **kw)
    except IllegalTransition:
        logger.info("Ignoring stale %s for command %s (already %s)", new, cmd.cid, cmd.status)
        return False


def command_event(cmd: Command) -> Dict[str, Any]:
    """The command as clients see it: the HTTP response body and the WebSocket `command` message."""
    return {
        "cid": str(cmd.cid),
        "pump_id": cmd.pump_id,
        "command": cmd.action,
        "status": cmd.status,
        "reject_reason": cmd.reject_reason,
        "failure_reason": cmd.failure_reason,
        "payload": cmd.payload or {},
        "created_at": _iso(cmd.issued_at),
        "issued_at": _iso(cmd.issued_at),
        "sent_at": _iso(cmd.sent_at),
        "delivered_at": _iso(cmd.delivered_at),
        "acked_at": _iso(cmd.acked_at),
        "applied_at": _iso(cmd.applied_at),
        "expires_at": _iso(cmd.expires_at),
    }


# ---------------------------------------------------------------------------
# What the pump says
# ---------------------------------------------------------------------------
def _open_commands(db: Session, pump_id: str) -> List[Command]:
    return (
        db.query(Command)
        .filter(Command.pump_id == pump_id, Command.status.in_(OPEN_STATES), Command.status != QUEUED)
        .order_by(desc(Command.issued_at))
        .all()
    )


def parse_ack(frame: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Recognises a command answer in either shape and returns a normalised form, or None if it is not one.

    * layer A, forwarded verbatim by today's bridge: {"cmd":"ack","ref":"motor_cmd","ok":1}
    * layer B (firmware F2): {"v":1,"type":"CMD_ACK","cid":"<uuid>","stage":"delivered|acknowledged|applied|rejected",
      "reason":"expired"}   ("cmd":"ack" with a "cid" is accepted too)
    """
    if not isinstance(frame, dict):
        return None
    kind = str(frame.get("type") or frame.get("cmd") or frame.get("event") or "").lower()
    if kind not in ("ack", "cmd_ack", "command_ack"):
        return None
    stage = str(frame.get("stage") or "").lower()
    ok = frame.get("ok")
    ok = (ok in (1, True, "1")) if ok is not None else stage != "rejected"
    if stage not in ("delivered", "acknowledged", "applied", "rejected"):
        stage = "acknowledged" if ok else "rejected"
    return {
        "cid": str(frame["cid"]) if frame.get("cid") else None,
        "ref": str(frame.get("ref") or "") or None,
        "stage": "rejected" if not ok else stage,
        "reason": (str(frame.get("reason") or frame.get("reject_reason") or "") or None),
    }


def apply_ack(db: Session, pump_id: str, frame: Dict[str, Any], at: Optional[datetime] = None) -> Optional[Command]:
    """Applies a device answer to the command it is about. Returns the command it changed, or None.

    With a `cid` the match is exact. Without one (today's firmware) it can only be "the newest open command
    of the kind `ref` names": that is honest for START / STOP one at a time, and is why the cooldown exists.
    """
    ack = parse_ack(frame)
    if not ack:
        return None
    at = at or now_utc()

    cmd: Optional[Command] = None
    if ack["cid"]:
        try:
            cid = uuid.UUID(ack["cid"])
        except ValueError:
            return None
        cmd = db.query(Command).filter(Command.cid == cid, Command.pump_id == pump_id).first()
        if cmd:
            pump = db.query(Pump).filter(Pump.id == pump_id).first()
            if pump and not pump.supports_command_ack:
                pump.supports_command_ack = True
                logger.info("Device %s answers with command ids: interim confirmation is off for it", pump_id)
    elif ack["ref"]:
        for candidate in _open_commands(db, pump_id):
            if _ACK_REF.get(candidate.action) == ack["ref"]:
                cmd = candidate
                break
    if not cmd:
        logger.info("Ack from %s matches no open command: %s", pump_id, frame)
        return None

    stage = ack["stage"]
    if stage == "rejected":
        changed = advance(db, cmd, REJECTED, reason=ack["reason"] or "device_refused", at=at)
    elif stage == "delivered":
        changed = advance(db, cmd, DELIVERED, at=at)
    elif stage == "applied":
        # An explicit "applied" implies it was acknowledged: keep every step's evidence honest.
        if cmd.status in (QUEUED, SENT, DELIVERED):
            advance(db, cmd, ACKNOWLEDGED, at=at)
        changed = advance(db, cmd, APPLIED, at=at)
    else:
        changed = advance(db, cmd, ACKNOWLEDGED, at=at)
    return cmd if changed else None


def observe_reading(
    db: Session,
    pump_id: str,
    pump_on: Optional[bool],
    recorded_at: Optional[datetime],
    *,
    buffered: bool = False,
) -> List[Command]:
    """A telemetry reading arrived: settle any START / STOP it proves. Returns the commands that moved.

    Only a reading taken AFTER the command was sent counts, and never a replayed (buffered) one.
    """
    if pump_on is None or buffered or recorded_at is None:
        return []
    recorded = aware(recorded_at)
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    ack_capable = bool(pump and pump.supports_command_ack)

    moved: List[Command] = []
    for cmd in _open_commands(db, pump_id):
        expected = _EXPECTED_MOTOR.get(cmd.action)
        sent = aware(cmd.sent_at)
        if expected is None or sent is None or recorded < sent or expected != pump_on:
            continue
        # Ack-capable devices must say so themselves, except that an ack already given plus the pump's own state is proof.
        if ack_capable and cmd.status != ACKNOWLEDGED:
            continue
        if not settings.COMMAND_INTERIM_CONFIRM and cmd.status != ACKNOWLEDGED:
            continue
        if advance(db, cmd, APPLIED, at=recorded):
            moved.append(cmd)
    return moved


def sweep_open_commands(
    db: Session, now: Optional[datetime] = None, pump_ids: Optional[Iterable[str]] = None
) -> List[Command]:
    """Closes commands that ran out of time. Safe to run often, from any number of workers.

    * never sent within their lifetime            -> EXPIRED
    * sent to an ack-capable device, past their lifetime: unanswered -> EXPIRED, acknowledged but unseen -> NOT_CONFIRMED
    * sent, no proof within COMMAND_CONFIRM_SECONDS (interim devices)  -> NOT_CONFIRMED
    """
    now = now or now_utc()
    confirm = timedelta(seconds=settings.COMMAND_CONFIRM_SECONDS)
    moved: List[Command] = []

    query = db.query(Command).filter(Command.status.in_(OPEN_STATES))
    if pump_ids is not None:
        query = query.filter(Command.pump_id.in_(list(pump_ids)))
    open_rows = (
        query
        .order_by(Command.issued_at)
        .with_for_update(skip_locked=True)
        .limit(500)
        .all()
    )
    ack_capable = {
        p.id for p in db.query(Pump.id, Pump.supports_command_ack)
        .filter(Pump.id.in_({c.pump_id for c in open_rows} or {""}), Pump.supports_command_ack.is_(True))
    } if open_rows else set()

    for cmd in open_rows:
        expires = aware(cmd.expires_at)
        if cmd.status == QUEUED:
            if expires and now > expires and advance(db, cmd, EXPIRED, reason="not_sent_in_time"):
                moved.append(cmd)
            continue
        sent = aware(cmd.sent_at) or aware(cmd.issued_at)
        if cmd.pump_id in ack_capable:
            if not (expires and now > expires):
                continue
            # The controller took it but its own reading never showed the change, versus it never answering.
            if cmd.status == ACKNOWLEDGED:
                changed = advance(db, cmd, NOT_CONFIRMED, reason="applied_not_seen")
            else:
                changed = advance(db, cmd, EXPIRED, reason="no_response")
            if changed:
                moved.append(cmd)
        elif sent and now - sent > confirm:
            if advance(db, cmd, NOT_CONFIRMED, reason="no_confirmation"):
                moved.append(cmd)
    if moved:
        db.commit()
    return moved
