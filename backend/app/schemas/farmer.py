"""Typed request/response models for the endpoints the farmer app calls.

Every model here exists so OpenAPI is a real contract: the mobile app generates its
API client and runtime validators from it (mobile/orval.config.ts), so a field that
drifts on either side fails a build instead of showing a blank value on a phone.
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


# ---- auth / profile ---------------------------------------------------------------------
class UserOut(BaseModel):
    id: str
    full_name: str
    phone_number: Optional[str] = None
    email: Optional[str] = None
    role: str
    dealer_depth: Optional[int] = None
    hierarchy_path: Optional[str] = None
    preferred_language: Optional[str] = None
    locale: Optional[str] = None
    mfa_enabled: bool = False
    status: str = "ACTIVE"


class LoginResponse(BaseModel):
    """Either tokens + user, or (for MFA accounts) `mfa_required` + a short-lived `temp_token`."""
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    mfa_required: Optional[bool] = None
    temp_token: Optional[str] = None
    # True for roles that must use TOTP (FR-WEB-001) and have not set it up: the session can only do that until they do.
    mfa_setup_required: Optional[bool] = None
    user: Optional[UserOut] = None


class RefreshResponse(BaseModel):
    access_token: str
    refresh_token: str


class UpdateMeRequest(BaseModel):
    locale: Optional[str] = None
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)


class LogoutRequest(BaseModel):
    """Send the current refresh token to end only THIS session; omit to end every session."""
    refresh_token: Optional[str] = None


class SessionOut(BaseModel):
    family_id: str
    device_info: str
    app_install_id: Optional[str] = None
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None


class SessionsResponse(BaseModel):
    sessions: List[SessionOut]


class DeletionRequestIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)


class DeletionRequestOut(BaseModel):
    id: int
    status: str
    requested_at: str
    message: Optional[str] = None


class DeletionRequestState(BaseModel):
    """`request` is null when the user has no open or past request."""
    request: Optional[DeletionRequestOut] = None


class ExportResponse(BaseModel):
    exported_at: str
    user: UserOut
    pumps: List[Dict[str, Any]]
    alerts: List[Dict[str, Any]]
    sessions: List[SessionOut]
    note: str


# ---- alerts -----------------------------------------------------------------------------
class AlertOut(BaseModel):
    id: str
    pump_id: str
    pump_name: str
    alert_type: str
    severity: str
    fault_code: int = 0
    fault_name: Optional[str] = None
    occurrence_count: int = 1
    first_occurred_at: Optional[str] = None
    last_occurred_at: Optional[str] = None
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[str] = None
    assigned_to: Optional[str] = None
    resolved_at: Optional[str] = None
    resolution_note: Optional[str] = None


class AlertListResponse(BaseModel):
    alerts: List[AlertOut]
    data: List[AlertOut]


# ---- sites (a farmer's own groups of pumps) ---------------------------------------------
class SiteIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    lat: Optional[float] = None
    lng: Optional[float] = None


class SiteUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    lat: Optional[float] = None
    lng: Optional[float] = None


class SiteOut(BaseModel):
    id: str
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    pump_count: int = 0


class SiteListResponse(BaseModel):
    sites: List[SiteOut]
