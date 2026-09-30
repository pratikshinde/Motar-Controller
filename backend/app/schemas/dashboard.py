"""Response models for the dashboard API (Phase 3). They are the contract the frontend codes against, and they are what
the generated OpenAPI document shows. Timestamps are ISO-8601 strings in UTC."""
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class GlobalScope(BaseModel):
    type: Literal["GLOBAL"]
    organisation_id: None = None


class Scope(BaseModel):
    type: Literal["SUBTREE", "ORG"]
    organisation_id: Optional[str] = None
    organisation_name: Optional[str] = None


class DeviceStates(BaseModel):
    total: int
    by_state: Dict[str, int] = Field(description="Always all eight lifecycle states, zero-filled")


class Connectivity(BaseModel):
    online: int
    offline: int
    unknown: int = Field(description="In service but has never reported")
    not_in_service: int = Field(description="Stock, allocated, suspended, RMA or retired: expected to be quiet")


class FaultType(BaseModel):
    code: str = Field(description="Stable name from the fault catalogue, e.g. PhaseLoss")
    fault_code: Optional[int] = None
    fault_name: Optional[str] = None
    severity: Optional[str] = None
    count: int


class FaultSummary(BaseModel):
    active_total: int = Field(description="Open hardware-fault alerts (connectivity outages are not faults)")
    by_type: List[FaultType]


class TopFaultingDevice(BaseModel):
    device_id: str
    serial: str
    name: Optional[str] = None
    fault_count: int
    last_fault: Optional[str] = None
    organisation: Optional[str] = None


class TopFaultingMeta(BaseModel):
    total: int
    limit: int
    window_days: int


class FirmwareShare(BaseModel):
    version: str = Field(description="'unknown' when the device has not reported a version")
    device_count: int
    percentage: float


class MapCell(BaseModel):
    latitude: float = Field(description="Rounded to 2 decimals (~1 km); never a device's exact position")
    longitude: float
    status: Literal["ONLINE", "OFFLINE", "UNKNOWN", "NOT_IN_SERVICE"] = Field(description="Dominant status in the cell")
    online_count: int
    offline_count: int
    unknown_count: int
    not_in_service_count: int
    device_count: int


class Runtime(BaseModel):
    today_hours: float = Field(description="Since local midnight in `timezone`, counted live from telemetry")
    period_hours: float
    period_days: int
    last_rollup_at: Optional[str] = Field(None, description="Newest daily-rollup write included in period_hours")
    today_source: Literal["rollup", "live"] = Field(
        description="'rollup': the background refresher's figure (see today_as_of). 'live': computed directly from "
                    "today's readings and the daily rollups because the refresher has no current row for this scope")
    today_as_of: Optional[str] = Field(None, description="When today_hours was last computed")


class Freshness(BaseModel):
    generated_at: Optional[str] = Field(description="When these numbers were computed (not when they were sent)")
    last_data_update: Optional[str] = Field(description="Newest report from any in-scope device")
    data_age_seconds: Optional[int] = None
    stale: bool = Field(description="True when the newest device report is older than stale_after_seconds, or none exists")
    stale_after_seconds: int


class CacheInfo(BaseModel):
    hit: bool
    ttl_seconds: int


class _Dashboard(BaseModel):
    devices: DeviceStates
    connectivity: Connectivity
    faults: FaultSummary
    top_faulting_devices: List[TopFaultingDevice]
    top_faulting_devices_meta: TopFaultingMeta
    firmware_distribution: List[FirmwareShare]
    connectivity_map: List[MapCell]
    generated_at: str
    last_data_update: Optional[str] = None
    freshness: Freshness
    cache: CacheInfo
    filters: Dict[str, object] = Field(description="The filters that were applied, echoed back")
    timezone: str = Field(description="IANA timezone that defines 'today'")


class GlobalDashboard(_Dashboard):
    """GET /dashboard/global (SUPER_ADMIN)."""
    scope: GlobalScope


class PartnerDashboard(_Dashboard):
    """GET /dashboard/subtree and GET /dashboard/organisations/{id}."""
    scope: Scope
    faults_today: int
    runtime: Runtime
    warranty_expiring_soon: int
    subscription_expiring_soon: int


# ---- paginated lists
class OfflineDevice(BaseModel):
    device_id: str
    serial: str
    name: Optional[str] = None
    status: str
    lifecycle_state: str
    last_seen: Optional[str] = None
    org_name: Optional[str] = None
    firmware_version: Optional[str] = None
    open_fault_count: int


class OfflineDevicePage(BaseModel):
    items: List[OfflineDevice]
    total: int
    limit: int
    offset: int


class TopFaultingPage(BaseModel):
    items: List[TopFaultingDevice]
    total: int
    limit: int
    offset: int
    window_days: int


class FaultItem(BaseModel):
    id: int
    device_id: str
    device_name: Optional[str] = None
    org_name: Optional[str] = None
    fault_code: Optional[int] = None
    fault_name: str
    occurred_at: Optional[str] = None
    resolved_at: Optional[str] = None
    is_active: bool
    contactor_tripped: bool


class FaultsPage(BaseModel):
    summary: FaultSummary
    faults_today: int
    items: List[FaultItem]
    total: int
    limit: int
    offset: int


class WarrantyItem(BaseModel):
    device_id: str
    name: Optional[str] = None
    org_id: Optional[str] = None
    org_name: Optional[str] = None
    warranty_start_date: Optional[str] = None
    warranty_period_months: Optional[int] = None
    warranty_expiry_date: Optional[str] = None
    days_remaining: Optional[int] = None


class WarrantyPage(BaseModel):
    items: List[WarrantyItem]
    total: int
    within_days: int
    limit: int
    offset: int


class SubscriptionItem(BaseModel):
    device_id: str
    name: Optional[str] = None
    org_name: Optional[str] = None
    subscription_expires_at: Optional[str] = None
    days_remaining: Optional[int] = None


class SubscriptionPage(BaseModel):
    items: List[SubscriptionItem]
    total: int
    within_days: int
    limit: int
    offset: int


class FirmwareDistributionResponse(BaseModel):
    firmware_distribution: List[FirmwareShare]
