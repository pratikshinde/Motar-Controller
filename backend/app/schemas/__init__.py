from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

# Auth Schemas
class SendOtpRequest(BaseModel):
    phone_number: str

class VerifyOtpRequest(BaseModel):
    phone_number: str
    otp_code: str

class LoginPasswordRequest(BaseModel):
    phone_number: str
    password: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class MfaVerifyRequest(BaseModel):
    temp_token: str
    totp_code: str

class MfaCodeRequest(BaseModel):
    code: str

class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100, description="User's full name")
    phone_number: Optional[str] = Field(None, min_length=5, max_length=20, description="Phone number")
    phone: Optional[str] = Field(None, min_length=5, max_length=20, description="Alternative phone number field")
    email: Optional[str] = Field(None, description="Optional unique email address")
    password: str = Field(..., min_length=6, description="Plaintext password")

class TimerConfigRequest(BaseModel):
    on_duration_minutes: int = Field(..., ge=0, description="Timer ON duration in minutes")
    off_duration_minutes: Optional[int] = Field(0, ge=0, description="Timer OFF duration in minutes")
    cycle_count: Optional[int] = Field(1, ge=1, description="Cycle count")
    mode: Optional[str] = Field("ON_TIMER", description="Timer mode: ON_TIMER, OFF_TIMER, CYCLIC")

# Pump & Device Schemas
class PumpCreate(BaseModel):
    id: str
    name: str
    supply_type: str = "3-phase"
    hp_rating: float = 10.0
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class PumpUpdate(BaseModel):
    name: Optional[str] = None
    supply_type: Optional[str] = None
    hp_rating: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    lifecycle_state: Optional[str] = None

class PumpLocationUpdate(BaseModel):
    latitude: float
    longitude: float

class PumpWarrantyUpdate(BaseModel):
    warranty_start_at: datetime
    warranty_end_at: datetime

class PumpLifecycleUpdate(BaseModel):
    lifecycle_state: str
    note: Optional[str] = None

class BridgeSwapRequest(BaseModel):
    new_device_id: str
    reason: str

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
    theme_color: Optional[str] = None
    logo_url: Optional[str] = None
    sender_name: Optional[str] = None
    subdomain: Optional[str] = None
