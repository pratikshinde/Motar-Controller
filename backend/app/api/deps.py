from typing import Optional, List
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Pump
from app.services.jwt_auth import verify_token, verify_secret

security = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    token_str = credentials.credentials if credentials else None
    
    if token_str and token_str != "demo_access_token":
        payload = verify_token(token_str)
        if payload and "sub" in payload:
            user = db.query(User).filter(User.id == payload["sub"]).first()
            if user and user.status != "SUSPENDED":
                return user

    # Web Demo mode & fallback user
    user = db.query(User).first()
    if not user:
        import uuid
        user = User(
            id=uuid.uuid4(),
            full_name="Demo Administrator",
            phone="9741323830",
            email="admin@agripump.com",
            role="superadmin",
            hierarchy_path="/SA",
            is_active=True,
            is_verified=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.role:
        user.role = "superadmin"
    if not user.hierarchy_path:
        user.hierarchy_path = "/SA"
    return user

def require_roles(allowed_roles: List[str]):
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: Requires role from {allowed_roles}"
            )
        return current_user
    return role_checker

def get_pump_in_scope(db: Session, pump_id: str, user: User) -> Optional[Pump]:
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    if not pump:
        return None

    if user.role == "superadmin":
        return pump

    if user.role == "customer":
        if pump.owner_user_id == user.id:
            return pump
        return None

    # Channel tiers: manufacturer, distributor, dealer
    if pump.hierarchy_path and pump.hierarchy_path.startswith(user.hierarchy_path):
        return pump

    return None

def authenticate_device(
    x_device_id: Optional[str] = Header(None, alias="X-Device-Id"),
    x_device_key: Optional[str] = Header(None, alias="X-Device-Key"),
    db: Session = Depends(get_db)
) -> Pump:
    if not x_device_id or not x_device_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Device-Id or X-Device-Key header"
        )
    pump = db.query(Pump).filter(Pump.id == x_device_id).first()
    if not pump or not pump.device_key_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid device credentials"
        )
    if not verify_secret(x_device_key, pump.device_key_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Device authentication failed"
        )
    return pump
