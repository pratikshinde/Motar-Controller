from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.api.deps import get_current_user

router = APIRouter(tags=["Service Reports"])

@router.get("")
@router.get("/", include_in_schema=False)
def list_service_reports(
    days: Optional[int] = 30,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return [
        {
            "id": "SR-2026-001",
            "pump_id": "PUMP-4G-3P-8821",
            "pump_name": "North Field Main Pump",
            "technician": "Suresh Patel",
            "service_type": "PREVENTIVE_MAINTENANCE",
            "description": "Inspected contactor relays, cleaned terminal lugs, calibrated current sensors.",
            "status": "COMPLETED",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "id": "SR-2026-002",
            "pump_id": "PUMP-4G-3P-8822",
            "pump_name": "South Orchard Auxiliary",
            "technician": "Ramesh Kumar",
            "service_type": "PHASE_REPAIR",
            "description": "Replaced blown surge suppressor capacitor on Y-phase.",
            "status": "COMPLETED",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
