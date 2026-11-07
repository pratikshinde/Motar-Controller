"""WhatsApp alerts to the person who owns a pump, through Meta's WhatsApp Cloud API (no middleman, no SMS cost):

  * the pump has been silent for OFFLINE_AFTER_SECONDS: no contact, the power may be off
  * the pump reports again after that: it is back, with the supply voltage it reported
  * a fault stopped the pump: the starter's own fault name

Meta only lets a business start a conversation with an approved message TEMPLATE, so each alert is a template with variables
(see backend/WHATSAPP_ALERTS.md for the wording to create). Off until ALERT_WHATSAPP_ENABLED is true and WHATSAPP_API_TOKEN and
WHATSAPP_PHONE_ID are set. While ALERT_WHATSAPP_TO holds a number, every message goes there instead of to the owners (during
Meta's testing stage only numbers you have verified in the developer console can receive anything).
Nothing here ever raises: a failed message is logged and must not hold up the sweep or the ingest worker.
"""
import logging
from typing import List, Optional

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Pump, TelemetryHistory, User
from app.services.alert_sms import FAULT_NAMES

logger = logging.getLogger(__name__)

GRAPH_VERSION = "v21.0"


def enabled() -> bool:
    return bool(settings.ALERT_WHATSAPP_ENABLED and settings.WHATSAPP_API_TOKEN and settings.WHATSAPP_PHONE_ID)


def whatsapp_number(raw: str) -> str:
    """Digits only, with the country code, as WhatsApp wants it: +91 99999 00006, 09999900006 and 9999900006 all become 919999900006."""
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return "91" + digits if len(digits) == 10 else digits


def _masked(number: str) -> str:
    return "*" * (len(number) - 4) + number[-4:] if len(number) > 4 else "****"


def send_template(to: str, template: str, params: List[str]) -> bool:
    """One approved template with its variables filled in. True when Meta accepted it."""
    number = whatsapp_number(to)
    payload = {
        "messaging_product": "whatsapp",
        "to": number,
        "type": "template",
        "template": {
            "name": template,
            "language": {"code": settings.WHATSAPP_ALERT_LANGUAGE},
            "components": [{"type": "body", "parameters": [{"type": "text", "text": str(p)} for p in params]}],
        },
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.post(
                f"https://graph.facebook.com/{GRAPH_VERSION}/{settings.WHATSAPP_PHONE_ID}/messages",
                headers={"Authorization": f"Bearer {settings.WHATSAPP_API_TOKEN}"},
                json=payload,
            )
        if res.status_code >= 300:
            logger.warning("WhatsApp to %s was refused by Meta (%s): %s", _masked(number), res.status_code, res.text[:300])
            return False
        return True
    except Exception as exc:  # network, TLS, anything: the alert is best effort
        logger.warning("WhatsApp to %s could not be sent: %s", _masked(number), exc)
        return False


def recipients(db: Session, pump: Pump) -> List[str]:
    """The test number while one is set, otherwise the pump's owner."""
    if settings.ALERT_WHATSAPP_TO.strip():
        return [settings.ALERT_WHATSAPP_TO.strip()]
    owner = db.query(User).filter(User.id == pump.owner_user_id).first()
    number = (getattr(owner, "phone_number", None) or getattr(owner, "phone", None)) if owner else None
    return [number] if number else []


def _send(db: Session, pump_id: str, template: str, params: List[str]) -> int:
    if not enabled():
        logger.info("WhatsApp alert not sent (switched off or no Meta account): %s %s", template, params)
        return 0
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    if not pump:
        return 0
    return sum(1 for number in recipients(db, pump) if send_template(number, template, params))


def _name(pump: Optional[Pump], pump_id: str) -> str:
    return (getattr(pump, "name", None) or pump_id) if pump else pump_id


def notify_no_contact(db: Session, pump_id: str) -> int:
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    minutes = max(1, settings.OFFLINE_AFTER_SECONDS // 60)
    return _send(db, pump_id, settings.WHATSAPP_TPL_NO_CONTACT, [_name(pump, pump_id), str(minutes)])


def notify_back(db: Session, pump_id: str) -> int:
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    latest = (
        db.query(TelemetryHistory)
        .filter(TelemetryHistory.pump_id == pump_id, TelemetryHistory.v_ry.isnot(None))
        .order_by(TelemetryHistory.recorded_at.desc())
        .first()
    )
    volts = str(round(float(latest.v_ry))) if latest is not None else "unknown"
    state = "running" if latest is not None and latest.pump_on else "stopped"
    return _send(db, pump_id, settings.WHATSAPP_TPL_BACK_ONLINE, [_name(pump, pump_id), volts, state])


def notify_fault(db: Session, pump_id: str, fault_code: Optional[int]) -> int:
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    fault = FAULT_NAMES.get(int(fault_code)) if fault_code is not None else None
    return _send(db, pump_id, settings.WHATSAPP_TPL_FAULT, [_name(pump, pump_id), fault or f"fault {fault_code}"])
