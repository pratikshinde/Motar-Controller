"""Tell people about a pump: a WhatsApp message to its owner (alert_whatsapp), an SMS (alert_sms) and a push to every phone that has the app (push). Each is switched on
by its own settings and does nothing without them; neither ever raises."""
from typing import Optional

from sqlalchemy.orm import Session

from app.services import alert_sms, alert_whatsapp, push


def no_contact(db: Session, pump_id: str) -> None:
    alert_whatsapp.notify_no_contact(db, pump_id)
    alert_sms.notify_no_contact(db, pump_id)
    push.notify_pump(db, pump_id, "Pump offline", alert_sms.text_no_contact(db, pump_id))


def back_online(db: Session, pump_id: str) -> None:
    alert_whatsapp.notify_back(db, pump_id)
    alert_sms.notify_back(db, pump_id)
    push.notify_pump(db, pump_id, "Pump back online", alert_sms.text_back(db, pump_id))


def fault(db: Session, pump_id: str, fault_code: Optional[int]) -> None:
    alert_whatsapp.notify_fault(db, pump_id, fault_code)
    alert_sms.notify_fault(db, pump_id, fault_code)
    push.notify_pump(db, pump_id, "Pump stopped", alert_sms.text_fault(db, pump_id, fault_code))
