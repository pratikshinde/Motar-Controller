from typing import Literal, Optional, List, Dict, Any
from datetime import date, datetime
from pydantic import BaseModel, Field

# Auth Schemas
class SendOtpRequest(BaseModel):
    phone_number: Optional[str] = None
    phone: Optional[str] = None

class OtpRequestIn(BaseModel):
    phone: Optional[str] = None
    phone_number: Optional[str] = None

class OtpVerifyIn(BaseModel):
    phone: Optional[str] = None
    phone_number: Optional[str] = None
    otp: Optional[str] = None
    otp_code: Optional[str] = None
    app_install_id: Optional[str] = None
    device_info: Optional[str] = None

class RegisterRequestIn(BaseModel):
    phone: Optional[str] = None
    phone_number: Optional[str] = None
    role: str = "customer"
    full_name: Optional[str] = None
    organisation_name: Optional[str] = None

class RegisterVerifyIn(BaseModel):
    phone: Optional[str] = None
    phone_number: Optional[str] = None
    otp: Optional[str] = None
    otp_code: Optional[str] = None
    role: str = "customer"
    full_name: Optional[str] = None
    organisation_name: Optional[str] = None
    app_install_id: Optional[str] = None
    device_info: Optional[str] = None

class OrgInvitationCreate(BaseModel):
    phone: str
    role: str = "dealer"

# FR-WEB-001-adjacent: proving a phone at registration, and a partner's forgot-password — never the everyday
# farmer login OTP above, which is untouched.
class PhoneVerificationSendRequest(BaseModel):
    phone_number: str
    purpose: Literal["registration", "password_reset"]

class PhoneVerificationConfirmRequest(BaseModel):
    phone_number: str
    purpose: Literal["registration", "password_reset"]
    code: str

class ResetPasswordRequest(BaseModel):
    phone_number: str
    verification_token: str
    new_password: str = Field(min_length=8)

class VerifyOtpRequest(BaseModel):
    phone_number: Optional[str] = None
    phone: Optional[str] = None
    otp_code: Optional[str] = None
    otp: Optional[str] = None
    language: Optional[str] = None
    app_install_id: Optional[str] = None
    device_info: Optional[str] = None

class LoginPasswordRequest(BaseModel):
    phone_number: str
    password: str
    app_install_id: Optional[str] = None
    device_info: Optional[str] = None

class RefreshTokenRequest(BaseModel):
    refresh_token: str
    app_install_id: Optional[str] = None
    device_info: Optional[str] = None

class InviteCreateRequest(BaseModel):
    phone: str
    device_id: Optional[str] = None
    role: str = "viewer"  # 'owner' or 'viewer'

class MfaVerifyRequest(BaseModel):
    challenge_id: Optional[str] = None
    temp_token: Optional[str] = None
    code: Optional[str] = None
    totp_code: Optional[str] = None

class MfaCodeRequest(BaseModel):
    code: str
    # Only for /auth/mfa/enable: the secret the setup step returned. In the body, not the URL, so it never reaches access logs.
    secret: Optional[str] = None

class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100, description="User's full name")
    phone_number: Optional[str] = Field(None, min_length=5, max_length=20, description="Phone number")
    phone: Optional[str] = Field(None, min_length=5, max_length=20, description="Alternative phone number field")
    email: Optional[str] = Field(None, description="Optional unique email address")
    password: Optional[str] = Field(None, description="Optional plaintext password")
    role: Optional[str] = Field("customer", description="Role tier")
    phone_verification_token: Optional[str] = None

class TimerConfigRequest(BaseModel):
    # Limits are the panel's own: ON 1-250 min, OFF 0-250 min, 0-999 cycles.
    on_duration_minutes: int = Field(..., ge=1, le=250, description="Timer ON duration in minutes")
    off_duration_minutes: Optional[int] = Field(0, ge=0, le=250, description="Timer OFF duration in minutes")
    cycle_count: Optional[int] = Field(1, ge=0, le=999, description="Cycle count")
    mode: Optional[str] = Field("ON_TIMER", description="Timer mode: ON_TIMER, OFF_TIMER, CYCLIC")

# Pump & Device Schemas
class PumpCreate(BaseModel):
    id: str
    name: str
    device_type: Optional[str] = "AC_3PH"
    supply_type: str = "3-phase"
    hp_rating: float = 10.0
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    # Which manufacturer's device this is. Partners get their own brand; only the platform's super admin names one.
    brand: Optional[str] = None

class PumpUpdate(BaseModel):
    name: Optional[str] = None
    device_type: Optional[str] = None
    supply_type: Optional[str] = None
    hp_rating: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    lifecycle_state: Optional[str] = None

class PumpLocationUpdate(BaseModel):
    latitude: float
    longitude: float

class PumpWarrantyUpdate(BaseModel):
    """Both fields together, or both null to clear the warranty (what the portal's Ownership tab sends)."""
    warranty_start_date: Optional[date] = None
    warranty_period_months: Optional[int] = Field(default=None, ge=1, le=120)

class PumpLifecycleUpdate(BaseModel):
    lifecycle_state: str
    note: Optional[str] = None

class BridgeSwapRequest(BaseModel):
    new_imei: str
    reason: Optional[str] = Field(default=None, max_length=500)


class McuSwapRequest(BaseModel):
    new_mcu_uid: str
    reason: Optional[str] = Field(default=None, max_length=500)


class PumpPanelUpdate(BaseModel):
    """Install-time panel binding (FR-WEB-031). A field left out is unchanged; an explicit null clears it."""
    panel_serial: Optional[str] = Field(default=None, max_length=50)
    motor_rating: Optional[str] = Field(default=None, max_length=50)
    starter_type: Optional[str] = Field(default=None, max_length=30)
    pump_make: Optional[str] = Field(default=None, max_length=50)
    pump_model: Optional[str] = Field(default=None, max_length=50)


class BulkAllocateRequest(BaseModel):
    pump_ids: List[str] = Field(min_length=1, max_length=500)
    to_user_id: str
    note: Optional[str] = Field(default=None, max_length=500)


class PartnerInviteCreate(BaseModel):
    role: str
    parent_user_id: Optional[str] = None


class PartnerInviteRedeem(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    phone_number: str = Field(min_length=1, max_length=20)
    password: Optional[str] = Field(default=None, max_length=128)
    # Ticket from POST /auth/verify-phone/confirm (purpose "registration") for this exact phone_number - the
    # redeeming person is the phone's own owner here, unlike a dealer typing someone else's number.
    phone_verification_token: str

class PanelBindingRequest(BaseModel):
    panel_serial: str
    motor_hp: Optional[float] = None
    starter_type: Optional[str] = None
    ct_ratio: Optional[int] = None
    make_model: Optional[str] = None

# Command Schemas
class CommandRequest(BaseModel):
    command: Optional[str] = None
    action: Optional[str] = None
    payload: Dict[str, Any] = {}

    @property
    def action_name(self) -> str:
        return (self.command or self.action or "START").upper()

class CommandAckRequest(BaseModel):
    ok: int
    status: Optional[str] = None
    reject_reason: Optional[str] = None

# VFD Telemetry block for SOLAR_VFD pumps
class VfdTelemetry(BaseModel):
    hz: Optional[float] = Field(None, ge=0.0, le=500.0, description="Output frequency in Hz")
    i_out: Optional[float] = Field(None, ge=0.0, le=500.0, description="Output current in Amperes")
    v_ac: Optional[float] = Field(None, ge=0.0, le=1000.0, description="AC output voltage in Volts")
    v_dc: Optional[float] = Field(None, ge=0.0, le=1500.0, description="DC bus voltage in Volts")
    kw: Optional[float] = Field(None, ge=0.0, le=500.0, description="Motor output power in kW")
    status: Optional[str] = Field(None, max_length=30, description="VFD operating status")
    fault_code: Optional[int] = Field(None, ge=0, le=9999, description="VFD alarm / fault code")

# Telemetry Ingest Schema
class TelemetryIngest(BaseModel):
    dev_id: Optional[str] = None
    vl: Optional[List[float]] = None
    i: Optional[List[float]] = None
    mot: Optional[int] = None
    st: Optional[int] = None
    flt: Optional[int] = None
    rt: Optional[int] = None
    ol: Optional[float] = None
    rssi: Optional[int] = None
    seq: Optional[int] = None
    vfd: Optional[VfdTelemetry] = None

# Alert Schemas
class AlertResolveRequest(BaseModel):
    resolution_note: Optional[str] = None

class AlertAssignRequest(BaseModel):
    assigned_to: str

class AlertSubscriptionCreate(BaseModel):
    pump_id: Optional[str] = None
    alert_type: Optional[str] = None
    min_severity: Optional[str] = None

# User Schemas
from app.schemas.user import UserCreate, UserResponse

class InviteCreate(BaseModel):
    role: str
    expires_in_days: int = 7

class InviteRedeemRequest(BaseModel):
    token: str
    full_name: str
    phone_number: str
    password: Optional[str] = None

# Template Schema
class ConfigTemplateCreate(BaseModel):
    name: str
    hp_rating: Optional[float] = None
    supply_type: str = "3-phase"
    config_json: Dict[str, Any]

class ApplyTemplateRequest(BaseModel):
    template_id: str

# Batch Schema
class BatchCreate(BaseModel):
    batch_number: str
    total_devices: int = 0

class ImeiImportRequest(BaseModel):
    imeis: List[str]

# Branding Schema
class BrandingUpdate(BaseModel):
    """White-label settings. Everything here ends up on other people's screens, so it is checked."""
    primary_color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    logo_url: Optional[str] = Field(None, max_length=500, pattern=r"^https://[^\s\"'<>]+$")
    notification_sender_name: Optional[str] = Field(None, min_length=1, max_length=50)
    subdomain: Optional[str] = Field(None, pattern=r"^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$")

# Appendix H Pump & Device Schemas
from app.schemas.pump import (
    TelemetrySnapshot, PumpResponse, PumpMetaStats, PumpMeta,
    PumpListResponse, PumpDetailResponse, DeviceSettingsUpdate,
    DeviceSettingsResponse, CommandDispatchInfo, CommandDispatchResponse,
    CommandDetailResponse, TimerConfigDetail, TimerConfigResponse,
    FaultRecordResponse, SupportContactResponse, HistoryPoint,
    HistoryResponse
)
