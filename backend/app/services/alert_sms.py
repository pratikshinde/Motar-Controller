"""SMS alerts to the person who owns a pump, for the cases where the app is not open (or the owner has no smartphone):

  * the pump has been silent for OFFLINE_AFTER_SECONDS: no contact, the power may be off
  * the pump reports again after that: it is back, with the supply voltage it reported
  * a fault stopped the pump: the starter's own fault name

Off until ALERT_SMS_ENABLED is true and a Twilio account is set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER).
While ALERT_SMS_TO holds a number, every message goes there instead of to the owners: use it to try the alerts on your own phone.
Nothing here ever raises: a failed SMS is logged and must not hold up the sweep or the ingest worker.
"""
import logging
from typing import Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Pump, TelemetryHistory, User

logger = logging.getLogger(__name__)

# The starter's own wording (MotorProtection.c), the same names the app shows.
FAULT_NAMES: Dict[int, str] = {
    1: "Phase Fail",
    2: "Phase Fail",
    3: "Over voltage",
    4: "Line reverse: interchange R and B",
    5: "Dry Run Fault",
    6: "Cable open",
    7: "Cable open (OR) Motor Faults",
    8: "Over load",
    9: "Motor Fault",
    10: "Low voltage",
}

_NO_CONTACT = "{name}: no contact for {minutes} minutes. The power may be off, or there is no mobile signal."
_BACK = "{name} is back online{volts}. The pump is {state}."
_FAULT = "{name} stopped: {fault}."


def enabled() -> bool:
    return bool(
        settings.ALERT_SMS_ENABLED and settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER
    )


def send_sms(to: str, body: str) -> bool:
    """One text through Twilio. True when Twilio accepted it."""
    number = to.strip().replace(" ", "")
    try:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
        with httpx.Client(timeout=8.0) as client:
            res = client.post(
                url,
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                data={"From": settings.TWILIO_PHONE_NUMBER, "To": number, "Body": body},
            )
        if res.status_code >= 300:
            logger.warning("SMS to %s was refused by Twilio (%s)", _masked(number), res.status_code)
            return False
        return True
    except Exception as exc:  # network, TLS, anything: the alert is best effort
        logger.warning("SMS to %s could not be sent: %s", _masked(number), exc)
        return False


def _masked(number: str) -> str:
    return "*" * (len(number) - 4) + number[-4:] if len(number) > 4 else "****"


def recipients(db: Session, pump: Pump) -> List[str]:
    """The test number while one is set, otherwise the pump's owner."""
    if settings.ALERT_SMS_TO.strip():
        return [settings.ALERT_SMS_TO.strip()]
    owner = db.query(User).filter(User.id == pump.owner_user_id).first()
    number = (getattr(owner, "phone_number", None) or getattr(owner, "phone", None)) if owner else None
    return [number] if number else []


def _send_to_owner(db: Session, pump_id: str, text: str) -> int:
    if not enabled():
        logger.info("SMS alert not sent (switched off or no Twilio account): %s", text)
        return 0
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    if not pump:
        return 0
    sent = 0
    for number in recipients(db, pump):
        if send_sms(number, text):
            sent += 1
    return sent


def _name(pump: Optional[Pump], pump_id: str) -> str:
    return (getattr(pump, "name", None) or pump_id) if pump else pump_id


def text_no_contact(db: Session, pump_id: str) -> str:
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    minutes = max(1, settings.OFFLINE_AFTER_SECONDS // 60)
    return _NO_CONTACT.format(name=_name(pump, pump_id), minutes=minutes)


def text_back(db: Session, pump_id: str) -> str:
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    latest = (
        db.query(TelemetryHistory)
        .filter(TelemetryHistory.pump_id == pump_id, TelemetryHistory.v_ry.isnot(None))
        .order_by(TelemetryHistory.recorded_at.desc())
        .first()
    )
    volts = f" (supply {round(float(latest.v_ry))} V)" if latest is not None else ""
    state = "running" if latest is not None and latest.pump_on else "stopped"
    return _BACK.format(name=_name(pump, pump_id), volts=volts, state=state)


def text_fault(db: Session, pump_id: str, fault_code: Optional[int]) -> str:
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    fault = FAULT_NAMES.get(int(fault_code)) if fault_code is not None else None
    return _FAULT.format(name=_name(pump, pump_id), fault=fault or f"fault {fault_code}")


def notify_no_contact(db: Session, pump_id: str) -> int:
    return _send_to_owner(db, pump_id, text_no_contact(db, pump_id))


def notify_back(db: Session, pump_id: str) -> int:
    return _send_to_owner(db, pump_id, text_back(db, pump_id))


def notify_fault(db: Session, pump_id: str, fault_code: Optional[int]) -> int:
    return _send_to_owner(db, pump_id, text_fault(db, pump_id, fault_code))
