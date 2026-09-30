from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Branding, User
from app.schemas import BrandingUpdate
from app.api.deps import get_current_user, require_roles

# Who may brand their own portal. A farmer is not a brand.
BRANDING_ROLES = ["superadmin", "manufacturer", "distributor", "dealer"]
# Names that must never be claimed: they would shadow the platform's own hosts.
RESERVED_SUBDOMAINS = {"www", "api", "app", "admin", "portal", "static", "cdn", "mail", "login", "auth", "status"}


def _apply(db: Session, b: Branding, req: BrandingUpdate) -> None:
    if req.subdomain is not None:
        if req.subdomain in RESERVED_SUBDOMAINS:
            raise HTTPException(status_code=422, detail="That subdomain is reserved.")
        taken = db.query(Branding).filter(Branding.subdomain == req.subdomain, Branding.org_id != b.org_id).first()
        if taken:
            raise HTTPException(status_code=409, detail="That subdomain is already in use.")
    if req.primary_color is not None:
        b.theme_color = req.primary_color
    if req.logo_url is not None:
        b.logo_url = req.logo_url
    if req.notification_sender_name is not None:
        b.sender_name = req.notification_sender_name
    if req.subdomain is not None:
        b.subdomain = req.subdomain

router = APIRouter(tags=["White-label Branding"])

def _format_branding(b: Branding):
    if not b:
        return None
    return {
        "org_id": str(b.org_id),
        "primary_color": b.theme_color,  # frontend expects primary_color
        "logo_url": b.logo_url,
        "notification_sender_name": b.sender_name,
        "subdomain": b.subdomain
    }

@router.get("/resolve")
def resolve_branding(request: Request, db: Session = Depends(get_db)):
    # Simple resolution: if they come in on a subdomain, look it up.
    # We could also use the Host header or X-Forwarded-Host
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    subdomain = host.split(".")[0] if "." in host else host
    
    b = db.query(Branding).filter(Branding.subdomain == subdomain).first()
    if not b:
        # Fallback to the first available branding or default
        return {"branding": None}
    
    return {"branding": _format_branding(b)}

@router.get("/mine")
def get_my_branding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    b = db.query(Branding).filter(Branding.org_id == current_user.id).first()
    return {"branding": _format_branding(b)}

@router.put("/mine")
def update_my_branding(
    req: BrandingUpdate,
    current_user: User = Depends(require_roles(BRANDING_ROLES)),
    db: Session = Depends(get_db)
):
    b = db.query(Branding).filter(Branding.org_id == current_user.id).first()
    if not b:
        b = Branding(org_id=current_user.id)
    _apply(db, b, req)
    db.add(b)
    db.commit()
    db.refresh(b)
    return {"message": "Branding updated", "branding": _format_branding(b)}

@router.get("/{org_id}")
def get_user_branding(
    org_id: str,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db)
):
    b = db.query(Branding).filter(Branding.org_id == org_id).first()
    return {"branding": _format_branding(b)}

@router.put("/{org_id}")
def update_user_branding(
    org_id: str,
    req: BrandingUpdate,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db)
):
    b = db.query(Branding).filter(Branding.org_id == org_id).first()
    if not b:
        b = Branding(org_id=org_id)
    _apply(db, b, req)
    db.add(b)
    db.commit()
    db.refresh(b)
    return {"message": "Branding updated", "branding": _format_branding(b)}
