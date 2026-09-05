from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Panel, Pump, User
from app.schemas import PanelBindingRequest
from app.api.deps import get_current_user, require_roles

router = APIRouter(tags=["Panel Assembly"])

@router.get("")
def list_panels(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    panels = db.query(Panel).all()
    return [
        {
            "id": str(p.id),
            "panel_serial": p.panel_serial,
            "pump_id": p.pump_id,
            "motor_hp": float(p.motor_hp) if p.motor_hp is not None else None,
            "starter_type": p.starter_type,
            "ct_ratio": p.ct_ratio,
            "make_model": p.make_model,
            "created_at": p.created_at.isoformat() if p.created_at else None
        }
        for p in panels
    ]

@router.post("", status_code=201)
def bind_panel(
    req: PanelBindingRequest,
    pump_id: str = None,
    current_user: User = Depends(require_roles(["superadmin", "manufacturer"])),
    db: Session = Depends(get_db)
):
    existing = db.query(Panel).filter(Panel.panel_serial == req.panel_serial).first()
    if existing:
        raise HTTPException(status_code=400, detail="Panel serial already registered")

    panel = Panel(
        panel_serial=req.panel_serial,
        pump_id=pump_id,
        motor_hp=req.motor_hp,
        starter_type=req.starter_type,
        ct_ratio=req.ct_ratio,
        make_model=req.make_model
    )
    db.add(panel)
    db.commit()
    db.refresh(panel)
    return {"id": str(panel.id), "panel_serial": panel.panel_serial}
