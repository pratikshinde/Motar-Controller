from typing import Optional, List, Union, Any
from fastapi import Depends, HTTPException, Header, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.config import settings
from app.core.errors import AppError
from app.database import get_db
from app.models import User, Pump
from app.services.jwt_auth import verify_token, verify_secret
from app.repositories.pump_repository import PumpRepository

from app.services.cache_service import cache_service

security = HTTPBearer(auto_error=False)

def _set_rls_var(db: Session, name: str, value: object) -> None:
    # set_config with bound parameters — never interpolate values into SQL.
    # is_local=false matches the previous SET semantics; get_db() runs RESET ALL
    # before the connection returns to the pool.
    db.execute(
        text("SELECT set_config(:name, :value, false)"),
        {"name": name, "value": str(value)},
    )


def set_db_actor_context(
    db: Session,
    user: Optional[User] = None,
    device_id: Optional[str] = None
) -> None:
    """
    Sets session variables for PostgreSQL Row-Level Security (FR-CLD-042).
    A failure here is not swallowed: with FORCE ROW LEVEL SECURITY an unset
    context denies access, and callers must see that as an error, not as data.

    Session variables:
    - app.user_id: UUID of authenticated user
    - app.user_role: canonical database role string (superadmin, manufacturer, distributor, dealer, support, customer)
    - app.org_path: ltree path of user's organisation
    - app.hierarchy_path: legacy slash-delimited hierarchy path
    - app.device_id: device identifier when authenticating via device headers
    """
    if user:
        _set_rls_var(db, "app.user_id", user.id)
        from app.core.roles import to_db_role
        canonical_role = to_db_role(user.role)
        _set_rls_var(db, "app.user_role", canonical_role)

        org_path = None
        if getattr(user, "organisation", None) and getattr(user.organisation, "path", None):
            org_path = user.organisation.path
        elif getattr(user, "org_id", None):
            from app.models.organisation import Organisation
            org = db.query(Organisation).filter(Organisation.id == user.org_id).first()
            if org and org.path:
                org_path = org.path

        if org_path:
            _set_rls_var(db, "app.org_path", str(org_path))

        if getattr(user, "hierarchy_path", None):
            _set_rls_var(db, "app.hierarchy_path", user.hierarchy_path)
    elif device_id:
        _set_rls_var(db, "app.device_id", device_id)


_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated. Please sign in.",
    headers={"WWW-Authenticate": "Bearer"},
)


# What a session that still has to set up TOTP may do (matched on the path's tail, so /api and /api/v1 both work).
MFA_SETUP_PATHS = ("/auth/mfa/setup", "/auth/mfa/enroll", "/auth/mfa/enable", "/auth/me", "/auth/logout")


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Resolves the caller from a valid Bearer access token. There is no fallback:
    a missing, malformed, expired or revoked token is always 401, and a
    suspended account is 403. (A former "demo" fallback authenticated every
    unauthenticated request as the first user in the database.)
    """
    token_str = credentials.credentials if credentials else None
    if not token_str:
        raise _UNAUTHORIZED

    payload = verify_token(token_str)
    if not payload or "sub" not in payload or payload.get("mfa_pending"):
        raise _UNAUTHORIZED

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise _UNAUTHORIZED
    if user.status == "SUSPENDED" or user.account_status == "SUSPENDED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended")
    if not user.role:
        # RLS policies key off app.user_role; a role-less account has no scope.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has no role assigned. Contact your dealer.",
        )

    # FR-WEB-001: privileged roles must have TOTP. Derived from the account, not from the token, so it cannot be
    # skipped by holding an older token and it lifts the moment TOTP is enabled.
    if settings.mfa_required_for(user.role) and not user.mfa_enabled:
        if not request.url.path.rstrip("/").endswith(MFA_SETUP_PATHS):
            raise AppError(
                code="MFA_SETUP_REQUIRED",
                message_key="errors.mfa_setup_required",
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Two-factor authentication must be set up before this account can be used.",
            )

    # Session version check: revocation takes effect within 60 s (FR-CLD-041)
    token_ver = payload.get("session_ver", 1)
    active_ver = cache_service.get_user_session_version(str(user.id))
    user_db_ver = getattr(user, "session_version", 1)
    if token_ver < active_ver or token_ver < user_db_ver:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked. Please log in again.",
        )

    set_db_actor_context(db, user=user)
    return user

def require_roles(allowed_roles: Union[List[str], str]):
    if isinstance(allowed_roles, str):
        allowed_roles = [allowed_roles]
    from app.core.roles import to_db_role
    normalized_allowed = {to_db_role(r) for r in allowed_roles}

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        user_role_db = to_db_role(current_user.role)
        if user_role_db not in normalized_allowed and current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: Requires role from {allowed_roles}"
            )
        return current_user
    return role_checker


def require_permission(permission: Union[str, Any]):
    """
    FastAPI dependency factory enforcing centralized RBAC permission check.
    """
    def permission_checker(current_user: User = Depends(get_current_user)) -> User:
        from app.services.authorization_service import AuthorizationService
        if not AuthorizationService.can(current_user, permission):
            perm_str = permission.value if hasattr(permission, "value") else str(permission)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: Missing required permission '{perm_str}'"
            )
        return current_user
    return permission_checker


def require_organisation_scope(org_id_field: str = "id"):
    """
    FastAPI dependency ensuring the organisation specified in path parameters
    is within the caller's authorized organisation subtree.
    """
    def scope_checker(
        request: Request,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> Organisation:
        from app.models.organisation import Organisation
        from app.services.authorization_service import AuthorizationService
        org_id = request.path_params.get(org_id_field)
        if not org_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing organisation ID")

        org = db.query(Organisation).filter(Organisation.id == org_id).first()
        if not org or not AuthorizationService.can(current_user, "MANAGE_ORGANISATIONS", resource=org, db=db):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organisation not found or out of scope"
            )
        return org
    return scope_checker

def get_pump_in_scope(db: Session, pump_id: str, user: User) -> Optional[Pump]:
    """
    Enforces device visibility using the repository layer (FR-CLD-042).
    """
    repo = PumpRepository.for_actor(actor=user, db=db)
    return repo.get_by_id(pump_id)

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
    # Set device context so RLS permits checking device record
    set_db_actor_context(db, device_id=x_device_id)
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
