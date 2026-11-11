"""Tell people about a pump. Two kinds of message, and they do not mix:

  Push to the phones that have the app: ONLY "the power came" and "the power went" (`power`). Faults, offline and everything else stay in
  the Alerts list of the app and the admin dashboard, and are never pushed.
  WhatsApp and SMS to the pump's owner (alert_whatsapp, alert_sms): faults and offline, each switched on by its own settings (off by default).

None of it ever raises.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.services import alert_sms, alert_whatsapp, push
from app.services.schedule_service import DEFAULT_TIMEZONE, _zone


def no_contact(db: Session, pump_id: str) -> None:
    alert_whatsapp.notify_no_contact(db, pump_id)
    alert_sms.notify_no_contact(db, pump_id)


def back_online(db: Session, pump_id: str) -> None:
    alert_whatsapp.notify_back(db, pump_id)
    alert_sms.notify_back(db, pump_id)


def fault(db: Session, pump_id: str, fault_code: Optional[int]) -> None:
    alert_whatsapp.notify_fault(db, pump_id, fault_code)
    alert_sms.notify_fault(db, pump_id, fault_code)


def _clock(at) -> str:
    """"6:42 AM" in India time (where the pumps are), without a leading zero."""
    text = at.astimezone(_zone(DEFAULT_TIMEZONE)).strftime("%I:%M %p")
    return text[1:] if text.startswith("0") else text


def power(db: Session, change) -> int:
    """Push "the power came" / "the power went" to everyone who can see the pump. Tapping it opens that pump."""
    when = _clock(change.at)
    if change.state == "ON":
        title, body = "Power is back", f"{change.pump_name}: the power came at {when}."
    elif change.source == "VOLTAGE":
        title, body = "Power gone", f"{change.pump_name}: the power went at {when}."
    else:
        title, body = "Power may be off", f"{change.pump_name} stopped reporting at {when}. The power may have gone."
    return push.notify_pump(db, change.pump_id, title, body, {"type": "POWER", "state": change.state})
