from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Branding, User
from app.schemas import BrandingUpdate
from app.api.deps import get_current_user

router = APIRouter(tags=["White-label Branding"])

@router.get("/resolve")
def resolve_branding(db: Session = Depends(get_db)):
    return {
        "org_id": "default",
        "app_title": "Ajanta Pump Controller",
        "theme_color": "#00e5ff",
        "logo_url": None,
        "sender_name": "AgriPump"
    }

@router.get("")
def get_branding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    b = db.query(Branding).filter(Branding.org_id == current_user.id).first()
    if not b:
        return {
            "org_id": str(current_user.id),
            "theme_color": "#0066cc",
            "logo_url": None,
            "sender_name": "AgriPump"
        }
    return {
        "org_id": str(b.org_id),
        "theme_color": b.theme_color,
        "logo_url": b.logo_url,
        "sender_name": b.sender_name,
        "subdomain": b.subdomain
    }

@router.put("")
def update_branding(
    req: BrandingUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    b = db.query(Branding).filter(Branding.org_id == current_user.id).first()
    if not b:
        b = Branding(org_id=current_user.id)
        db.add(b)
    if req.theme_color:
        b.theme_color = req.theme_color
    if req.logo_url:
        b.logo_url = req.logo_url
    if req.sender_name:
        b.sender_name = req.sender_name
    if req.subdomain:
        b.subdomain = req.subdomain
    db.commit()
    return {"message": "Branding updated"}
