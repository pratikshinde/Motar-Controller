"""Tell people about a pump. Two kinds of message:

  Push to the phones that have the app: "the power came", "the power went" (`power`) and a fault that stopped the pump (`fault`, once per
  fault in its window, not once per repeat). "Offline" and everything else stay in the Alerts list of the app and the admin dashboard.
  WhatsApp and SMS to the pump's owner (alert_whatsapp, alert_sms): faults and offline, each switched on by its own settings (off by default).

None of it ever raises.
"""
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Pump
from app.services import alert_sms, alert_whatsapp, push
from app.services.schedule_service import DEFAULT_TIMEZONE, _zone

logger = logging.getLogger(__name__)

PHASE_FAIL_CODES = (1, 2)


def no_contact(db: Session, pump_id: str) -> None:
    alert_whatsapp.notify_no_contact(db, pump_id)
    alert_sms.notify_no_contact(db, pump_id)


def back_online(db: Session, pump_id: str) -> None:
    alert_whatsapp.notify_back(db, pump_id)
    alert_sms.notify_back(db, pump_id)


def fault(db: Session, pump_id: str, fault_code: Optional[int]) -> None:
    alert_whatsapp.notify_fault(db, pump_id, fault_code)
    alert_sms.notify_fault(db, pump_id, fault_code)
    try:
        pump = db.query(Pump).filter(Pump.id == pump_id).first()
        if fault_code in PHASE_FAIL_CODES and pump is not None and pump.power_state == "OFF":
            return       # the supply is gone and "Power gone" already says so; a second message about the same thing is noise
        push.notify_pump(
            db, pump_id, "Pump fault", alert_sms.text_fault(db, pump_id, fault_code) + " Open the app to see what to do.",
            {"type": "FAULT", "fault_code": "" if fault_code is None else str(fault_code)},
        )
    except Exception:
        logger.exception("Could not push the fault of %s", pump_id)


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
