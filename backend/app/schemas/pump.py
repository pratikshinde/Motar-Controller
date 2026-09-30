from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

class TelemetrySnapshot(BaseModel):
    v_ry: Optional[float] = None
    v_yb: Optional[float] = None
    v_br: Optional[float] = None
    i_r: Optional[float] = None
    i_y: Optional[float] = None
    i_b: Optional[float] = None
    pump_on: Optional[bool] = None
    fault_active: Optional[bool] = None
    gsm_rssi: Optional[int] = None
    recorded_at: Optional[str] = None
    # Added for the farmer app. `signal_dbm` mirrors `gsm_rssi` (the name the app and WS use).
    signal_dbm: Optional[int] = None
    # The open fault's SRS 6.2 code while the pump reports a fault, else null.
    fault_code: Optional[int] = None
    # Estimated from telemetry rows (one running row ~ one minute) since local midnight (IST).
    runtime_today_min: Optional[int] = None

class PumpResponse(BaseModel):
    id: str
    name: str
    supply_type: str
    hp_rating: Optional[float] = None
    owner_user_id: Optional[str] = None
    hierarchy_path: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str
    connectivity: Optional[str] = None
    lifecycle_state: str
    firmware_version: Optional[str] = None
    panel_serial: Optional[str] = None
    warranty_start_at: Optional[str] = None
    warranty_period_months: Optional[int] = None
    last_seen_at: Optional[str] = None
    created_at: Optional[str] = None
    # Embedded telemetry snapshot fields
    v_ry: Optional[float] = None
    v_yb: Optional[float] = None
    v_br: Optional[float] = None
    i_r: Optional[float] = None
    i_y: Optional[float] = None
    i_b: Optional[float] = None
    gsm_rssi: Optional[int] = None
    device_key: Optional[str] = None
    # Live state merged from the latest telemetry row
    pump_on: Optional[bool] = None
    fault_active: Optional[bool] = None
    fault_code: Optional[int] = None
    signal_dbm: Optional[int] = None
    runtime_today_min: Optional[int] = None
    total_runtime_min: Optional[int] = None
    # This user's own view of the pump (device_access): nickname, group, order, role
    display_name: Optional[str] = None
    nickname: Optional[str] = None
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    sort_order: Optional[int] = None
    access_role: Optional[str] = None
    # Plan expiry (null = not tracked)
    subscription_expires_at: Optional[str] = None
    subscription_days_left: Optional[int] = None

    class Config:
        extra = "allow"

class PumpMetaStats(BaseModel):
    total: int
    running: int
    fault: int
    offline: int
    stopped: int = 0
    no_data: int = 0

class PumpMeta(BaseModel):
    total: int
    page: Optional[int] = None
    limit: int
    cursor: Optional[str] = None
    next_cursor: Optional[str] = None
    stats: Optional[PumpMetaStats] = None

class PumpListResponse(BaseModel):
    pumps: List[PumpResponse]
    data: List[PumpResponse]
    meta: PumpMeta

class PumpDetailResponse(BaseModel):
    pump: PumpResponse
    latest_telemetry: Optional[TelemetrySnapshot] = None
    config: Optional[Dict[str, Any]] = None
    open_fault_count: int = 0

class DeviceSettingsUpdate(BaseModel):
    nickname: Optional[str] = Field(None, max_length=100)
    site_id: Optional[str] = None
    sort_order: Optional[int] = None

class DeviceSettingsResponse(BaseModel):
    device_id: str
    nickname: Optional[str] = None
    site_id: Optional[str] = None
    sort_order: int = 0
    role: str = "owner"
    message: str = "Device settings updated successfully"

class CommandDispatchInfo(BaseModel):
    cid: str
    command: str
    status: str
    created_at: str
    payload: Optional[Dict[str, Any]] = None
    reject_reason: Optional[str] = None
    failure_reason: Optional[str] = None
    sent_at: Optional[str] = None
    delivered_at: Optional[str] = None
    acked_at: Optional[str] = None
    applied_at: Optional[str] = None
    expires_at: Optional[str] = None

class CommandDispatchResponse(BaseModel):
    message: str
    command: CommandDispatchInfo

class CommandDetailResponse(BaseModel):
    cid: str
    pump_id: str
    command: str
    status: str
    reject_reason: Optional[str] = None
    failure_reason: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    issued_at: Optional[str] = None
    sent_at: Optional[str] = None
    delivered_at: Optional[str] = None
    expires_at: Optional[str] = None
    acked_at: Optional[str] = None
    applied_at: Optional[str] = None

class TimerConfigDetail(BaseModel):
    on_duration_minutes: int
    off_duration_minutes: int = 0
    cycle_count: int = 1
    mode: str = "ON_TIMER"

class TimerConfigResponse(BaseModel):
    message: str
    # null when no timer has ever been sent to the pump
    timer: Optional[TimerConfigDetail] = None
    command: Optional[Dict[str, Any]] = None

class FaultRecordResponse(BaseModel):
    id: int
    fault_code: Optional[int] = None
    fault_name: Optional[str] = None
    severity: Optional[str] = None
    fault_description: Optional[str] = None
    v_ry: Optional[float] = None
    v_yb: Optional[float] = None
    v_br: Optional[float] = None
    i_r: Optional[float] = None
    i_y: Optional[float] = None
    i_b: Optional[float] = None
    occurred_at: Optional[str] = None
    resolved_at: Optional[str] = None
    ack_at: Optional[str] = None

class SupportContactResponse(BaseModel):
    # All null when the pump has no servicing dealer on record - the app then says so
    # instead of dialling a made-up number.
    dealer_name: Optional[str] = None
    dealer_phone: Optional[str] = None
    dealer_email: Optional[str] = None
    escalation_name: Optional[str] = None
    escalation_phone: Optional[str] = None
    escalation_email: Optional[str] = None
    hierarchy_path: Optional[str] = None

class HistoryPoint(BaseModel):
    id: Optional[int] = None
    v_ry: Optional[float] = None
    v_yb: Optional[float] = None
    v_br: Optional[float] = None
    i_r: Optional[float] = None
    i_y: Optional[float] = None
    i_b: Optional[float] = None
    pump_on: Optional[bool] = None
    fault_active: Optional[bool] = None
    gsm_rssi: Optional[int] = None
    recorded_at: Optional[str] = None
    # Source indicator: "raw" | "daily_summary"
    source: Optional[str] = None
    # Daily rollup extras (present when source == "daily_summary")
    runtime_min: Optional[int] = None
    start_count: Optional[int] = None
    fault_count: Optional[int] = None
    offline_min: Optional[int] = None
    v_min: Optional[float] = None
    v_max: Optional[float] = None
    v_mean: Optional[float] = None
    i_min: Optional[float] = None
    i_max: Optional[float] = None
    i_mean: Optional[float] = None
    sample_count: Optional[int] = None

    class Config:
        extra = "allow"

class HistoryResponse(BaseModel):
    pump_id: str
    period: str
    count: int
    records: List[HistoryPoint]
