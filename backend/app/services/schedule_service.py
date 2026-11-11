"""The weekly schedule (the Timer page of the farmer app): what the farmer sets, and the runner that carries it out.

The controller has no clock, so the cloud keeps the calendar. For each pump, each weekday can have "switch ON at 06:00, switch OFF at 09:00"
(the times are in the schedule's time zone, India time by default). When a time comes due the runner sends the pump an ordinary START or STOP
command, the same one the Home button sends, so it gets the same cooldown, the same delivery steps and the same "applied only when the pump's
own reading shows it" proof.

What happens to a time that comes due is recorded in `pump_schedule_runs`, and is the "what happened lately" list in the app:

  SENT           the command went out (its own state, `command_status`, says whether the pump confirmed it)
  ALREADY_ON     a START came due and the pump was already running; nothing was sent
  ALREADY_OFF    a STOP came due and the pump was already off
  SKIPPED_FAULT  a START came due while the pump has a fault; a stuck motor is never started
  BLOCKED        remote control is paused for this pump (suspended, in repair, retired)
  MISSED         the server was not running when it came due, and the retry time had passed
  GAVE_UP        the pump stayed offline (or cooling down) until the retry time ended
  CANCELLED      the schedule was switched off or the time removed before it could be sent
  PENDING        waiting: the pump is offline or cooling down, and it is still being tried

A pump that is offline at its time is tried again every tick for `SCHEDULE_RETRY_MINUTES` and then given up on, never sent late: a START
an hour after the farmer expected it would be a surprise. Switching the schedule off does not stop a pump that is running.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.core.errors import AppError
from app.models import Command, Pump
from app.models.schedule import PumpSchedule, PumpScheduleEntry, PumpScheduleRun
from app.services import command_service as cs

logger = logging.getLogger("agripump.schedule")

DEFAULT_TIMEZONE = "Asia/Kolkata"
MIN_WINDOW_MINUTES = 5
MIN_GAP_MINUTES = 5
MAX_ROWS = 50
RECENT_RUNS = 10
# A time that came due this long ago with no record (the server was down) is written down as MISSED; older ones are not dug up.
LOOKBACK = timedelta(hours=1)
# Any constant: only one API worker at a time may run the schedule, or every worker would send its own START.
RUN_LOCK_KEY = 5_119_208

START, STOP = "START", "STOP"
PENDING, SENT, ALREADY_ON, ALREADY_OFF = "PENDING", "SENT", "ALREADY_ON", "ALREADY_OFF"
SKIPPED_FAULT, BLOCKED, MISSED, GAVE_UP, CANCELLED = "SKIPPED_FAULT", "BLOCKED", "MISSED", "GAVE_UP", "CANCELLED"

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_BLOCKED_STATES = ("SUSPENDED", "RMA", "RETIRED")


# ---------------------------------------------------------------------------
# Times
# ---------------------------------------------------------------------------
def _zone(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except Exception:
        # A machine without the time zone database (Windows without `tzdata`): India has no daylight saving, so a fixed offset is exact.
        if name == DEFAULT_TIMEZONE:
            return timezone(timedelta(hours=5, minutes=30), "IST")
        raise


def check_timezone(name: str) -> str:
    try:
        _zone(name)
    except Exception:
        raise AppError(
            code="SCHEDULE_INVALID", message_key="errors.schedule_invalid", status_code=422,
            detail=f"'{name}' is not a known time zone.",
        )
    return name


def minutes_of(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _clock(hhmm: str) -> time:
    h, m = hhmm.split(":")
    return time(int(h), int(m))


def _local(day: int, hhmm: str) -> str:
    return f"{_DAYS[day]} {hhmm}"


def _iso(dt: Optional[datetime]) -> Optional[str]:
    dt = cs.aware(dt)
    return dt.isoformat() if dt else None


def _due_at(day: date, hhmm: str, zone: tzinfo) -> datetime:
    return datetime.combine(day, _clock(hhmm), tzinfo=zone).astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# The rules (the same ones the app checks before Save, so a mistake is shown next to its row; the server has the last word)
# ---------------------------------------------------------------------------
def validate_entries(entries: List[Dict[str, Any]]) -> None:
    """Raises AppError 422 (SCHEDULE_INVALID) naming the first problem."""

    def refuse(detail: str):
        raise AppError(code="SCHEDULE_INVALID", message_key="errors.schedule_invalid", status_code=422, detail=detail)

    if len(entries) > MAX_ROWS:
        refuse(f"At most {MAX_ROWS} times can be saved.")
    for e in entries:
        for field in ("on_time", "off_time"):
            if not _HHMM.match(e[field]):
                refuse(f"{field} must be a time like 06:00 (24-hour).")
        length = minutes_of(e["off_time"]) - minutes_of(e["on_time"])
        day = _DAYS[e["day_of_week"]]
        if length <= 0:
            refuse(f"{day}: the pump must switch off later than it switches on.")
        if length < MIN_WINDOW_MINUTES:
            refuse(f"{day}: run the pump for at least {MIN_WINDOW_MINUTES} minutes.")
    for day in range(7):
        same_day = sorted((e for e in entries if e["day_of_week"] == day and e["enabled"]), key=lambda e: minutes_of(e["on_time"]))
        for prev, nxt in zip(same_day, same_day[1:]):
            if minutes_of(nxt["on_time"]) < minutes_of(prev["off_time"]):
                refuse(f"{_DAYS[day]}: two times overlap.")
            if minutes_of(nxt["on_time"]) - minutes_of(prev["off_time"]) < MIN_GAP_MINUTES:
                refuse(f"{_DAYS[day]}: leave {MIN_GAP_MINUTES} minutes between times.")


# ---------------------------------------------------------------------------
# Reading and saving (the two API calls)
# ---------------------------------------------------------------------------
def _next_event(sched: Optional[PumpSchedule], entries: List[PumpScheduleEntry], now: datetime) -> Optional[Dict[str, Any]]:
    if not sched or not sched.enabled:
        return None
    zone = _zone(sched.timezone)
    today = now.astimezone(zone).date()
    best: Optional[Tuple[datetime, str, int, str]] = None
    for offset in range(0, 8):
        day = today + timedelta(days=offset)
        for e in entries:
            if not e.enabled or e.day_of_week != day.weekday():
                continue
            for kind, hhmm in ((START, e.on_time), (STOP, e.off_time)):
                at = _due_at(day, hhmm, zone)
                if at > now and (best is None or at < best[0]):
                    best = (at, kind, e.day_of_week, hhmm)
    if best is None:
        return None
    at, kind, dow, hhmm = best
    return {"kind": kind, "at": _iso(at), "local": _local(dow, hhmm), "day_of_week": dow, "time": hhmm}


def get_schedule(db: Session, pump: Pump, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or cs.now_utc()
    sched = db.query(PumpSchedule).filter(PumpSchedule.pump_id == pump.id).first()
    entries = (
        db.query(PumpScheduleEntry).filter(PumpScheduleEntry.pump_id == pump.id)
        .order_by(PumpScheduleEntry.day_of_week, PumpScheduleEntry.on_time).all()
    )
    runs = (
        db.query(PumpScheduleRun).filter(PumpScheduleRun.pump_id == pump.id)
        .order_by(PumpScheduleRun.due_at.desc()).limit(RECENT_RUNS).all()
    )
    cids = [r.command_cid for r in runs if r.command_cid]
    command_status = {c.cid: c.status for c in db.query(Command).filter(Command.cid.in_(cids))} if cids else {}
    return {
        "pump_id": pump.id,
        "enabled": bool(sched.enabled) if sched else False,
        "timezone": sched.timezone if sched else DEFAULT_TIMEZONE,
        "entries": [
            {"id": str(e.id), "day_of_week": e.day_of_week, "on_time": e.on_time, "off_time": e.off_time, "enabled": e.enabled}
            for e in entries
        ],
        "next": _next_event(sched, entries, now),
        "recent": [
            {
                "kind": r.kind, "due_at": _iso(r.due_at), "local": _local(r.day_of_week, r.local_time),
                "day_of_week": r.day_of_week, "time": r.local_time, "outcome": r.outcome, "detail": r.detail,
                "command_status": command_status.get(r.command_cid) if r.command_cid else None,
            }
            for r in runs
        ],
        "limits": {"min_window_minutes": MIN_WINDOW_MINUTES, "min_gap_minutes": MIN_GAP_MINUTES, "max_rows": MAX_ROWS},
        "server_time": _iso(now),
    }


def save_schedule(db: Session, pump: Pump, *, enabled: bool, entries: List[Dict[str, Any]], timezone_name: Optional[str], actor_id) -> Dict[str, Any]:
    """Replaces the pump's whole schedule with what the farmer sent. Returns what `get_schedule` would."""
    validate_entries(entries)
    sched = db.query(PumpSchedule).filter(PumpSchedule.pump_id == pump.id).first()
    zone_name = check_timezone(timezone_name) if timezone_name else (sched.timezone if sched else DEFAULT_TIMEZONE)
    if sched is None:
        sched = PumpSchedule(pump_id=pump.id)
        db.add(sched)
    sched.enabled = enabled
    sched.timezone = zone_name
    sched.updated_by = actor_id
    db.query(PumpScheduleEntry).filter(PumpScheduleEntry.pump_id == pump.id).delete(synchronize_session=False)
    for e in entries:
        db.add(PumpScheduleEntry(
            id=uuid.uuid4(), pump_id=pump.id, day_of_week=e["day_of_week"], on_time=e["on_time"], off_time=e["off_time"], enabled=e["enabled"],
        ))
    db.commit()
    return get_schedule(db, pump)


# ---------------------------------------------------------------------------
# The runner
# ---------------------------------------------------------------------------
def _record_due_times(db: Session, now: datetime) -> int:
    """Writes a PENDING row for every START / STOP that came due since the last look (or MISSED if its retry time already passed)."""
    retry = timedelta(minutes=settings.SCHEDULE_RETRY_MINUTES)
    created = 0
    schedules = db.query(PumpSchedule).filter(PumpSchedule.enabled.is_(True)).all()
    for sched in schedules:
        try:
            zone = _zone(sched.timezone)
        except Exception:
            logger.warning("Pump %s: unknown schedule time zone %r, skipped", sched.pump_id, sched.timezone)
            continue
        entries = db.query(PumpScheduleEntry).filter(PumpScheduleEntry.pump_id == sched.pump_id, PumpScheduleEntry.enabled.is_(True)).all()
        local_today = now.astimezone(zone).date()
        for day in (local_today - timedelta(days=1), local_today):
            for e in entries:
                if e.day_of_week != day.weekday():
                    continue
                for kind, hhmm in ((START, e.on_time), (STOP, e.off_time)):
                    due = _due_at(day, hhmm, zone)
                    if not (now - LOOKBACK < due <= now):
                        continue
                    exists = db.query(PumpScheduleRun.id).filter(
                        PumpScheduleRun.pump_id == sched.pump_id, PumpScheduleRun.kind == kind, PumpScheduleRun.due_at == due
                    ).first()
                    if exists:
                        continue
                    late = now > due + retry
                    db.add(PumpScheduleRun(
                        id=uuid.uuid4(), pump_id=sched.pump_id, kind=kind, due_at=due, day_of_week=day.weekday(), local_time=hhmm,
                        outcome=MISSED if late else PENDING,
                        detail="The server was not running at this time." if late else None,
                    ))
                    created += 1
    db.commit()
    return created


def _still_wanted(db: Session, run: PumpScheduleRun) -> bool:
    """False when the schedule was switched off, or this time was removed, since it came due."""
    sched = db.query(PumpSchedule).filter(PumpSchedule.pump_id == run.pump_id).first()
    if not sched or not sched.enabled:
        return False
    column = PumpScheduleEntry.on_time if run.kind == START else PumpScheduleEntry.off_time
    return db.query(PumpScheduleEntry.id).filter(
        PumpScheduleEntry.pump_id == run.pump_id, PumpScheduleEntry.enabled.is_(True),
        PumpScheduleEntry.day_of_week == run.day_of_week, column == run.local_time,
    ).first() is not None


def _finish(run: PumpScheduleRun, outcome: str, detail: Optional[str] = None) -> None:
    run.outcome = outcome
    run.detail = detail


def _attempt(db: Session, run: PumpScheduleRun, now: datetime) -> Optional[uuid.UUID]:
    """Tries to carry out one PENDING time. Returns the command id when a command was queued (the caller publishes it)."""
    if not _still_wanted(db, run):
        _finish(run, CANCELLED, "The schedule was changed before this time.")
        return None
    pump = db.query(Pump).filter(Pump.id == run.pump_id).first()
    if pump is None:
        _finish(run, CANCELLED, "The pump no longer exists.")
        return None
    if (pump.lifecycle_state or "").upper() in _BLOCKED_STATES or (pump.status or "").upper() in _BLOCKED_STATES:
        _finish(run, BLOCKED, "Remote control is paused for this pump.")
        return None

    state = (pump.status or "").upper()
    if run.kind == START and state == "RUNNING":
        _finish(run, ALREADY_ON)
        return None
    if run.kind == START and state == "FAULT":
        _finish(run, SKIPPED_FAULT, "The pump has a fault.")
        return None
    if run.kind == STOP and state != "RUNNING":
        _finish(run, ALREADY_OFF)
        return None

    gave_up = now > cs.aware(run.due_at) + timedelta(minutes=settings.SCHEDULE_RETRY_MINUTES)
    seen = cs.aware(pump.last_seen_at)
    offline = seen is None or (now - seen).total_seconds() > settings.OFFLINE_AFTER_SECONDS
    if offline:
        if gave_up:
            _finish(run, GAVE_UP, "The pump stayed offline.")
        else:
            run.detail = "Waiting for the pump to come online."
        return None
    can_send, _wait = cs.check_command_cooldown(db, pump.id)
    if not can_send:
        if gave_up:
            _finish(run, GAVE_UP, "The pump was still cooling down from the last command.")
        else:
            run.detail = "Waiting for the pause after the last command."
        return None

    key = f"schedule:{run.id}"
    cmd = cs.find_by_idempotency_key(db, pump.id, key) or cs.create_command(
        db, pump.id, run.kind, {"source": "schedule"}, None, idempotency_key=key,
    )
    run.command_cid = cmd.cid
    _finish(run, SENT)
    return cmd.cid


def run_schedule_tick(db: Session, now: Optional[datetime] = None) -> List[uuid.UUID]:
    """One look at every schedule: record what came due, then carry out (or retry, or give up on) each pending time.

    Commits as it goes. Returns the commands to publish. Returns nothing at all when another worker holds the run.
    """
    now = now or cs.now_utc()
    # A session-level lock: queuing a command commits, which would end a transaction-level one half way through.
    if not db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": RUN_LOCK_KEY}).scalar():
        return []
    try:
        _record_due_times(db, now)
        to_publish: List[uuid.UUID] = []
        pending = db.query(PumpScheduleRun).filter(PumpScheduleRun.outcome == PENDING).order_by(PumpScheduleRun.due_at).all()
        for run in pending:
            run_id = run.id
            try:
                cid = _attempt(db, run, now)
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Schedule run %s failed; it will be tried again", run_id)
                continue
            if cid is not None:
                to_publish.append(cid)
        return to_publish
    finally:
        db.rollback()
        db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": RUN_LOCK_KEY})
        db.commit()


def _tick() -> List[uuid.UUID]:
    from app.database import system_session
    with system_session() as db:
        return run_schedule_tick(db)


async def schedule_tick_once() -> int:
    """One runner pass, then publish the commands it queued. Returns how many START / STOP commands went out."""
    from starlette.concurrency import run_in_threadpool
    from app.services.command_dispatch import dispatch_command

    cids = await run_in_threadpool(_tick)
    for cid in cids:
        await dispatch_command(cid)
    return len(cids)
