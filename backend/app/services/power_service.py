"""Power at the pump: "the power came" and "the power went". The only thing the farmer's phone is notified about.

A pump is in one of two power states, ON or OFF, and a change of state is one event (a row in `pump_power_events`, and a push). Two things can tell us:

  VOLTAGE  the starter is reporting and its three line voltages are all under POWER_ABSENT_VOLTS (power gone), or any of them is above it (power
           back). Replayed (buffered) readings are old news and are ignored.
  CONTACT  the starter stopped reporting altogether (the connectivity sweep), which on a pump that runs from the mains is how a power cut looks
           from here; and it is reporting again (a heartbeat or a reading), which is how power coming back looks.

Only a change tells: the first reading a pump ever sends just sets the state, silently. Faults, "offline", and every other alert stay in the Alerts
list and are not pushed (`pump_notify`).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import NamedTuple, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Pump
from app.models.power import PumpPowerEvent

logger = logging.getLogger("agripump.power")

ON, OFF = "ON", "OFF"
VOLTAGE, CONTACT = "VOLTAGE", "CONTACT"


class PowerChange(NamedTuple):
    pump_id: str
    pump_name: str
    state: str
    source: str
    at: datetime
    notify: bool          # False for a pump's very first state: nothing "changed"


def state_from_voltages(v_ry: Optional[float], v_yb: Optional[float], v_br: Optional[float]) -> Optional[str]:
    """ON when any line voltage is present, OFF when all are absent, None when the starter reported no voltages at all."""
    seen = [v for v in (v_ry, v_yb, v_br) if v is not None]
    if not seen:
        return None
    return ON if max(seen) >= settings.POWER_ABSENT_VOLTS else OFF


def update_state(db: Session, pump: Pump, state: str, source: str, at: Optional[datetime] = None) -> Optional[PowerChange]:
    """Sets the pump's power state. Returns the change (to announce after the caller commits), or None when nothing changed."""
    if (getattr(pump, "device_type", None) or "AC_3PH") == "SOLAR_VFD":
        return None          # a solar pump has no mains supply to lose: its "power" is the sun, not an event to tell the farmer about
    at = at or datetime.now(timezone.utc)
    if pump.power_state == state:
        # Still the same state; but "off because it went quiet" becomes "off, and the starter itself says so" when it reports no voltage.
        if state == OFF and source == VOLTAGE and pump.power_source != VOLTAGE:
            pump.power_source = VOLTAGE
        return None
    first = pump.power_state is None
    pump.power_state = state
    pump.power_changed_at = at
    pump.power_source = source
    db.add(PumpPowerEvent(id=uuid.uuid4(), pump_id=pump.id, state=state, source=source, occurred_at=at))
    return PowerChange(pump.id, pump.name, state, source, at, notify=not first)


def observe_reading(db: Session, pump: Pump, v_ry, v_yb, v_br, buffered: bool, at: Optional[datetime] = None) -> Optional[PowerChange]:
    """A status reading arrived: its line voltages say whether the power is on."""
    if buffered:
        return None
    state = state_from_voltages(v_ry, v_yb, v_br)
    if state is None:
        return None
    return update_state(db, pump, state, VOLTAGE, at)


def observe_alive(db: Session, pump: Pump, at: Optional[datetime] = None) -> Optional[PowerChange]:
    """A heartbeat or registration arrived. If the pump was "off" only because it had gone quiet, it has power again."""
    if pump.power_state == OFF and pump.power_source == CONTACT:
        return update_state(db, pump, ON, CONTACT, at)
    return None


def observe_silence(db: Session, pump: Pump, at: Optional[datetime] = None) -> Optional[PowerChange]:
    """The pump stopped reporting (the connectivity sweep): the power may have gone."""
    if pump.power_state == OFF:
        return None
    return update_state(db, pump, OFF, CONTACT, at)


def announce(db: Session, change: Optional[PowerChange]) -> None:
    """Pushes the change to everyone who can see the pump. Call after the change is committed. Never raises."""
    if change is None or not change.notify:
        return
    try:
        from app.services import pump_notify
        pump_notify.power(db, change)
    except Exception:
        logger.exception("Could not announce the power change for %s", change.pump_id)


def announce_in_new_session(change: Optional[PowerChange]) -> None:
    """`announce` for a request that is about to end: opens its own session, so it can run as a background task."""
    if change is None or not change.notify:
        return
    from app.database import system_session
    with system_session() as db:
        announce(db, change)
