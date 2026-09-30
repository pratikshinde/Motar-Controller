"""
Dashboard API - Phase 3
=======================
Versioned REST endpoints (mounted at /api/v1/dashboard) for the global and subtree dashboards.

Authentication   Bearer JWT, the same as every other endpoint.
Authorization    checked in `DashboardService` before any query runs:
    GET /global                       SUPER_ADMIN only
    GET /organisations/{id}           SUPER_ADMIN only (a partner cannot pick an organisation)
    every other endpoint              PANEL_MANUFACTURER, DISTRIBUTOR, DEALER, SUPPORT_ENGINEER -> their own subtree
                                      END_USER -> 403 DASHBOARD_ACCESS_DENIED
Scope            derived from the authenticated user, never from a query parameter.
Rate limiting    the global RateLimitMiddleware (per-user, 429 + Retry-After).
Errors           project envelope: {"error": {"code", "message_key", "params"}, "detail"}
                 DASHBOARD_ACCESS_DENIED 403, ORGANISATION_NOT_FOUND 404, RATE_LIMIT_EXCEEDED 429,
                 DASHBOARD_QUERY_FAILED 500 (never a SQL error or stack trace).
Observability    one structured log line per request (user id, role, scope type, elapsed ms; never tokens/OTP),
                 plus `dashboard.requests.*`, `dashboard.errors.*` and `dashboard.request_ms.*` in /system/metrics.
"""
import logging
import time
from typing import Any, Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.errors import AppError
from app.core.metrics import metrics_collector
from app.database import get_db
from app.models import User
from app.schemas import dashboard as schemas
from app.services.dashboard_service import DashboardService

logger = logging.getLogger("agripump.dashboard.api")

router = APIRouter(tags=["Dashboard"])

DeviceState = Literal["MANUFACTURED", "ALLOCATED", "IN_STOCK", "COMMISSIONED", "ACTIVE", "SUSPENDED", "RMA", "RETIRED"]

_ERRORS = {
    403: {"description": "DASHBOARD_ACCESS_DENIED"},
    404: {"description": "ORGANISATION_NOT_FOUND"},
    429: {"description": "RATE_LIMIT_EXCEEDED (see Retry-After)"},
    500: {"description": "DASHBOARD_QUERY_FAILED"},
}


def _run(name: str, user: User, db: Session, fn: Callable[[DashboardService], Any]) -> Any:
    """Authenticate-then-authorise-then-query wrapper: timing, structured log, metrics, safe error mapping."""
    t0 = time.monotonic()
    metrics_collector.incr(f"dashboard.requests.{name}")
    try:
        result = fn(DashboardService(db=db, user=user))
    except HTTPException:  # includes AppError (403 / 404): already the right shape
        metrics_collector.incr(f"dashboard.errors.{name}")
        raise
    except Exception:
        db.rollback()
        metrics_collector.incr(f"dashboard.errors.{name}")
        logger.exception("dashboard.%s failed user_id=%s role=%s", name, user.id, user.role)
        raise AppError(code="DASHBOARD_QUERY_FAILED", message_key="errors.dashboardQueryFailed", status_code=500,
                       detail="DASHBOARD_QUERY_FAILED")
    elapsed_ms = (time.monotonic() - t0) * 1000
    metrics_collector.observe(f"dashboard.request_ms.{name}", elapsed_ms)
    logger.info("dashboard.%s user_id=%s role=%s elapsed_ms=%d", name, user.id, user.role, int(elapsed_ms))
    return result


# --------------------------------------------------------------------------------------- main dashboards
@router.get(
    "/global",
    response_model=schemas.GlobalDashboard,
    summary="Global fleet dashboard (SUPER_ADMIN only)",
    description=(
        "Fleet-wide aggregation: devices by lifecycle state, online/offline/unknown, active faults by type, top "
        "faulting devices, firmware distribution and connectivity-map cells.\n\n"
        "**Access:** SUPER_ADMIN only; every other role gets 403 `DASHBOARD_ACCESS_DENIED`.\n\n"
        "**Filters** (applied in SQL): `state`, `firmware_version`; `window_days` sets the top-faulting window.\n\n"
        "`freshness` says when the numbers were computed and how old the newest device report is (`stale` is true when "
        "it is older than `stale_after_seconds`). Responses are cached briefly (`cache.hit`)."
    ),
    responses=_ERRORS,
)
def get_global_dashboard(
    state: Optional[DeviceState] = Query(None, description="Only devices in this lifecycle state"),
    firmware_version: Optional[str] = Query(None, max_length=50),
    window_days: int = Query(30, ge=1, le=365, description="Top-faulting-devices window"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("global", current_user, db, lambda s: s.get_global_dashboard(state, firmware_version, window_days))


@router.get(
    "/subtree",
    response_model=schemas.PartnerDashboard,
    summary="Subtree dashboard (the caller's own organisation subtree)",
    description=(
        "Devices by state, connectivity, faults today and active faults, top faulting devices, firmware distribution, "
        "runtime hours, warranty and subscription expiring soon, and connectivity-map cells - for the authenticated "
        "user's organisation and its descendants only.\n\n"
        "**Access:** PANEL_MANUFACTURER, DISTRIBUTOR, DEALER, SUPPORT_ENGINEER. END_USER gets 403. There is no "
        "organisation parameter: scope always comes from the token.\n\n"
        "\"Today\" is a calendar day in the platform timezone (`timezone` in the response), not the client's."
    ),
    responses=_ERRORS,
)
def get_subtree_dashboard(
    state: Optional[DeviceState] = Query(None, description="Only devices in this lifecycle state"),
    firmware_version: Optional[str] = Query(None, max_length=50),
    window_days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("subtree", current_user, db, lambda s: s.get_subtree_dashboard(state, firmware_version, window_days))


@router.get(
    "/organisations/{organisation_id}",
    response_model=schemas.PartnerDashboard,
    summary="One organisation's subtree (SUPER_ADMIN only)",
    description=(
        "The subtree dashboard for a chosen organisation. **SUPER_ADMIN only** - a partner may not supply another "
        "organisation's id (403). Unknown id: 404 `ORGANISATION_NOT_FOUND`."
    ),
    responses=_ERRORS,
)
def get_org_dashboard(
    organisation_id: str,
    state: Optional[DeviceState] = Query(None),
    firmware_version: Optional[str] = Query(None, max_length=50),
    window_days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("org", current_user, db,
                lambda s: s.get_org_dashboard(organisation_id, state, firmware_version, window_days))


# ---------------------------------------------------------------------------------- single-metric endpoints
@router.get("/connectivity", response_model=schemas.Connectivity, summary="Online / offline / unknown counts for the caller's subtree",
            description="Only in-service devices are classified; the rest are `not_in_service`.", responses=_ERRORS)
def get_connectivity(
    state: Optional[DeviceState] = Query(None),
    firmware_version: Optional[str] = Query(None, max_length=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("connectivity", current_user, db, lambda s: s.get_connectivity_only(state, firmware_version))


@router.get("/faults", response_model=schemas.FaultsPage, summary="Active-fault summary, faults today and a paginated recent-fault list",
            responses=_ERRORS)
def get_faults(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    fault_code: Optional[int] = Query(None, ge=1, description="Only this fault code (see the fault catalogue)"),
    state: Optional[DeviceState] = Query(None),
    firmware_version: Optional[str] = Query(None, max_length=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("faults", current_user, db,
                lambda s: s.get_faults_list(limit, offset, fault_code, state, firmware_version))


@router.get("/firmware-distribution", response_model=schemas.FirmwareDistributionResponse, summary="Devices per firmware version (count and percentage)",
            responses=_ERRORS)
def get_firmware_distribution(
    state: Optional[DeviceState] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("firmware", current_user, db, lambda s: {"firmware_distribution": s.get_firmware_only(state)})


@router.get("/top-faulting-devices", response_model=schemas.TopFaultingPage, summary="Devices with the most faults in a window (paginated)",
            responses=_ERRORS)
def get_top_faulting_devices(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    window_days: int = Query(30, ge=1, le=365),
    state: Optional[DeviceState] = Query(None),
    firmware_version: Optional[str] = Query(None, max_length=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("top_faulting", current_user, db,
                lambda s: s.get_top_faulting_devices_list(limit, offset, window_days, state, firmware_version))


@router.get("/offline-devices", response_model=schemas.OfflineDevicePage, summary="Offline devices (paginated, oldest report first)", responses=_ERRORS)
def get_offline_devices(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    state: Optional[DeviceState] = Query(None),
    firmware_version: Optional[str] = Query(None, max_length=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("offline", current_user, db,
                lambda s: s.get_offline_devices(limit, offset, state, firmware_version))


@router.get("/warranty-expiring", response_model=schemas.WarrantyPage, summary="Devices whose warranty ends soon (paginated)", responses=_ERRORS)
def get_warranty_expiring(
    within_days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("warranty", current_user, db, lambda s: s.get_warranty_expiring_list(within_days, limit, offset))


@router.get("/subscription-expiring", response_model=schemas.SubscriptionPage, summary="Devices whose subscription ends soon (paginated)", responses=_ERRORS)
def get_subscription_expiring(
    within_days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run("subscription", current_user, db, lambda s: s.get_subscription_expiring_list(within_days, limit, offset))
