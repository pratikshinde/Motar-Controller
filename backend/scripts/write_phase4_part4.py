"""
Phase 4 - Part 4: Device Inventory API Router
Writes: app/api/devices.py
"""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, "app")

files = {}

files[os.path.join(APP, "api", "devices.py")] = r'''"""
Device Inventory API - Phase 4
================================
Complete device management REST endpoints.

Authentication: Bearer JWT required on all endpoints.
Authorization: enforced inside DeviceService (role + org scope).

Route map:
  GET    /devices                      - List/search devices (scoped)
  POST   /devices                      - Create single device
  POST   /devices/import               - Bulk CSV import (SUPER_ADMIN, MANUFACTURER only)
  POST   /devices/import/dry-run       - Validate CSV without writes
  GET    /devices/export               - Scoped CSV export
  GET    /devices/sample-csv           - Download sample import CSV
  GET    /devices/{id}                 - Device detail
  PATCH  /devices/{id}                 - Update metadata (no lifecycle/owner)
  POST   /devices/{id}/transition      - Lifecycle state machine transition
  POST   /devices/{id}/allocate        - Allocate to org
  POST   /devices/{id}/return          - Return to parent org
  POST   /devices/bulk-allocate        - Bulk allocation (with idempotency)
  GET    /devices/{id}/history         - Consolidated history
  GET    /devices/{id}/ownership-history - Chain of custody
  POST   /devices/{id}/panel           - Bind panel
  GET    /devices/{id}/panel/history   - Panel binding history
  GET    /devices/{id}/allowed-transitions - What states are reachable?

Security:
  - device IDs are validated by the service layer — no IDOR possible
  - lifecycle_state / org_id / owner cannot be set via PATCH
  - cross-tenant access is blocked at repository level (org_ids predicate)
  - target_org_id in allocation requests is validated server-side
"""
import io
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, Body, Depends, File, Header, HTTPException,
    Query, Request, Response, UploadFile, status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models import User
from app.services.device_service import DeviceService
from app.services.device_lifecycle_service import DeviceLifecycleService

logger = logging.getLogger("agripump.devices.api")
router = APIRouter(tags=["Device Inventory"])


def _svc(user: User, db: Session) -> DeviceService:
    return DeviceService(db=db, actor=user)


# ── List / Search ─────────────────────────────────────────────────────────────

@router.get(
    "",
    summary="List / search devices (scoped)",
    description=(
        "Returns paginated, filtered, sorted device list within the caller's org scope.\n\n"
        "**Filters**: serial/name search, lifecycle_state, firmware_version, connectivity, "
        "org_id, commissioned\n\n"
        "**Sort**: any device field (id, name, lifecycle_state, created_at, last_seen_at)\n\n"
        "**Scope**: SUPER_ADMIN sees all; partners see their subtree only.\n\n"
        "> Never loads all devices into memory — uses server-side pagination."
    ),
)
def list_devices(
    q: Optional[str] = Query(None, description="Search serial or name"),
    state: Optional[str] = Query(None, description="Lifecycle state filter"),
    model: Optional[str] = Query(None, description="Model filter"),
    hw_rev: Optional[str] = Query(None, description="Hardware revision filter"),
    batch_code: Optional[str] = Query(None, description="Batch code filter"),
    org_id: Optional[str] = Query(None, description="Owner org UUID filter"),
    connectivity: Optional[str] = Query(None, description="ONLINE|OFFLINE|UNKNOWN"),
    firmware_version: Optional[str] = Query(None),
    commissioned: Optional[bool] = Query(None),
    sort_by: str = Query("id", description="Sort field"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t0 = time.monotonic()
    try:
        result = _svc(current_user, db).list_devices(
            q=q, state=state, model=model, hw_rev=hw_rev,
            batch_code=batch_code, org_id=org_id,
            connectivity=connectivity, firmware_version=firmware_version,
            commissioned=commissioned,
            sort_by=sort_by, sort_dir=sort_dir,
            limit=limit, offset=offset,
        )
        logger.info("devices.list user=%s total=%s elapsed_ms=%d",
                    current_user.id, result["total"], int((time.monotonic() - t0) * 1000))
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.list failed: %s", exc)
        raise HTTPException(status_code=500, detail="DEVICE_LIST_FAILED")


# ── Single device ─────────────────────────────────────────────────────────────

@router.get(
    "/sample-csv",
    summary="Download sample import CSV",
)
def download_sample_csv():
    """Returns a sample CSV for bulk device import."""
    content = (
        "serial,model,hw_rev,batch_id,manufacture_date,supply_type,hp_rating\n"
        "PUMP-4G-3P-9001,AgriPump-7.5HP,1.0,BATCH-2026-08,2026-08-15,3P,7.5\n"
        "PUMP-4G-3P-9002,AgriPump-5HP,1.1,,2026-08-15,3P,5.0\n"
    )
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sample_device_import.csv"},
    )


@router.get(
    "/export",
    summary="Export device list as CSV",
    description=(
        "Exports scoped device inventory as CSV. Respects all permission/scope rules.\n\n"
        "**Security**: DEALER cannot export another org's devices.\n\n"
        "Implementation uses streaming batches — does not load entire table."
    ),
)
def export_devices(
    q: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        csv_data = _svc(current_user, db).export_csv(q=q, state=state)
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=device_inventory.csv"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.export failed: %s", exc)
        raise HTTPException(status_code=500, detail="DEVICE_EXPORT_FAILED")


@router.get(
    "/{device_id}",
    summary="Device detail",
    description=(
        "Returns full device detail including:\n"
        "- lifecycle state and allowed transitions\n"
        "- current org ownership\n"
        "- connectivity status (ONLINE/OFFLINE/UNKNOWN)\n"
        "- panel binding\n"
        "- warranty / subscription info\n\n"
        "**Security**: private keys, cert_pem, device_key_hash are NEVER returned."
    ),
)
def get_device(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _svc(current_user, db).get_device(device_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.get failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="DEVICE_QUERY_FAILED")


@router.patch(
    "/{device_id}",
    summary="Update device metadata",
    description=(
        "Updates editable device fields.\n\n"
        "**CANNOT** be used to change:\n"
        "- `lifecycle_state` / `state` → use `POST /{id}/transition`\n"
        "- `org_id` / `owner_org_id` / `owner_user_id` → use `POST /{id}/allocate`\n"
        "- `device_key_hash` (secrets)\n\n"
        "Attempts to set prohibited fields result in `422 FIELD_NOT_PATCHABLE`."
    ),
)
def update_device(
    device_id: str,
    updates: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _svc(current_user, db).update_device(device_id, updates)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.patch failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="DEVICE_UPDATE_FAILED")


# ── CSV Import ────────────────────────────────────────────────────────────────

@router.post(
    "/import",
    status_code=200,
    summary="Bulk CSV device import",
    description=(
        "Imports device inventory from a CSV file.\n\n"
        "**Access**: SUPER_ADMIN and PANEL_MANUFACTURER only.\n\n"
        "**CSV format**: `serial,model,hw_rev,batch_id,manufacture_date,supply_type,hp_rating`\n\n"
        "**Returns** structured import result:\n"
        "- `total_rows`, `successful`, `failed`, `skipped`\n"
        "- `errors`: per-row error with `row`, `field`, `code`, `message`\n\n"
        "**Duplicate handling**: existing serials are reported as `DUPLICATE_SERIAL` and skipped.\n\n"
        "**Transaction safety**: each row is wrapped in a savepoint. A failing row does not rollback others."
    ),
    responses={
        200: {"description": "Import result with per-row error report"},
        403: {"description": "IMPORT_FORBIDDEN"},
        400: {"description": "Invalid file format"},
    },
)
async def import_devices_csv(
    file: UploadFile = File(..., description="CSV file with device inventory"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="INVALID_FILE_TYPE: file must be a .csv")
    try:
        contents = await file.read()
        csv_content = contents.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="ENCODING_ERROR: file must be UTF-8 encoded")
    try:
        return _svc(current_user, db).import_csv(csv_content, dry_run=False)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.import failed: %s", exc)
        raise HTTPException(status_code=500, detail="IMPORT_FAILED")


@router.post(
    "/import/dry-run",
    summary="Validate CSV import without writing",
    description=(
        "Validates a CSV import file and returns what would succeed/fail, without any DB changes.\n\n"
        "Use this to preview errors before a real import."
    ),
)
async def import_devices_dry_run(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="INVALID_FILE_TYPE: file must be a .csv")
    try:
        contents = await file.read()
        csv_content = contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="ENCODING_ERROR: file must be UTF-8 encoded")
    try:
        result = _svc(current_user, db).import_csv(csv_content, dry_run=True)
        result["dry_run"] = True
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.import_dry_run failed: %s", exc)
        raise HTTPException(status_code=500, detail="IMPORT_VALIDATION_FAILED")


# ── Lifecycle transition ──────────────────────────────────────────────────────

@router.post(
    "/{device_id}/transition",
    summary="Transition device lifecycle state",
    description=(
        "Applies a lifecycle state machine transition.\n\n"
        "Valid transitions (from current state):\n"
        "- MANUFACTURED → ALLOCATED, IN_STOCK, RETIRED\n"
        "- ALLOCATED → IN_STOCK, COMMISSIONED, RETIRED\n"
        "- IN_STOCK → COMMISSIONED, ALLOCATED, RETIRED\n"
        "- COMMISSIONED → ACTIVE, SUSPENDED, RMA, RETIRED\n"
        "- ACTIVE → SUSPENDED, RMA, RETIRED\n"
        "- SUSPENDED → ACTIVE, RMA, RETIRED\n"
        "- RMA → ACTIVE, IN_STOCK, RETIRED\n"
        "- RETIRED → (none — terminal)\n\n"
        "Invalid transitions return `400 DEVICE_INVALID_STATE_TRANSITION`.\n\n"
        "**IMPORTANT**: `PATCH /{id}` cannot change lifecycle state — this endpoint is the ONLY way."
    ),
    responses={
        200: {"description": "Transition applied"},
        400: {"description": "DEVICE_INVALID_STATE_TRANSITION"},
        403: {"description": "DEVICE_TRANSITION_FORBIDDEN"},
        404: {"description": "DEVICE_NOT_FOUND"},
    },
)
def transition_device(
    device_id: str,
    body: Dict[str, Any] = Body(..., example={"state": "ACTIVE", "note": "Device passed QA"}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    next_state = body.get("state") or body.get("lifecycle_state") or body.get("to_state")
    if not next_state:
        raise HTTPException(status_code=422, detail="MISSING_FIELD: 'state' is required")
    note = body.get("note")
    try:
        return _svc(current_user, db).transition(device_id, next_state.upper(), note=note)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.transition failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="TRANSITION_FAILED")


# ── Allocation ────────────────────────────────────────────────────────────────

@router.post(
    "/{device_id}/allocate",
    summary="Allocate device to an organisation",
    description=(
        "Allocates a device to a target organisation.\n\n"
        "**Hierarchy rules**:\n"
        "- SUPER_ADMIN can allocate to any org\n"
        "- MANUFACTURER → DISTRIBUTOR or DEALER in own subtree\n"
        "- DISTRIBUTOR → DEALER in own subtree\n"
        "- DEALER → sub-DEALER in own subtree\n\n"
        "**Security**: `target_org_id` is validated server-side — cannot be tampered by client.\n\n"
        "**Idempotency**: pass `Idempotency-Key` header to safely retry without double-allocation.\n\n"
        "**Lifecycle**: only MANUFACTURED/IN_STOCK/ALLOCATED devices can be allocated (unless SUPER_ADMIN)."
    ),
    responses={
        200: {"description": "Allocation successful"},
        403: {"description": "ALLOCATION_FORBIDDEN"},
        404: {"description": "DEVICE_NOT_FOUND or TARGET_ORG_NOT_FOUND"},
        409: {"description": "DEVICE_ALREADY_AT_TARGET or DEVICE_NOT_ALLOCATABLE"},
    },
)
def allocate_device(
    device_id: str,
    body: Dict[str, Any] = Body(..., example={"target_org_id": "uuid-of-target-org", "note": "Monthly batch"}),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_org_id = body.get("target_org_id")
    if not target_org_id:
        raise HTTPException(status_code=422, detail="MISSING_FIELD: 'target_org_id' is required")
    note = body.get("note")
    try:
        return _svc(current_user, db).allocate(
            device_id, target_org_id, note=note,
            idempotency_key=idempotency_key,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.allocate failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="ALLOCATION_FAILED")


@router.post(
    "/{device_id}/return",
    summary="Return device to parent organisation",
    description=(
        "Returns a device to the parent organisation in the hierarchy.\n\n"
        "DEALER → DISTRIBUTOR, DISTRIBUTOR → MANUFACTURER, MANUFACTURER → OEM inventory (unallocated).\n\n"
        "Cross-sibling allocation (DEALER_A → DEALER_B) is not permitted through this endpoint."
    ),
)
def return_device(
    device_id: str,
    body: Dict[str, Any] = Body(default={}, example={"note": "Customer returned device"}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _svc(current_user, db).return_device(device_id, note=body.get("note"))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.return failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="RETURN_FAILED")


@router.post(
    "/bulk-allocate",
    summary="Bulk allocate devices to an organisation",
    description=(
        "Allocates multiple devices to the same target org in a single call.\n\n"
        "Each device is processed independently — partial success is allowed and clearly reported.\n\n"
        "**Idempotency**: pass `Idempotency-Key` header to safely retry. Each device's idempotency key\n"
        "is derived as `<key>:<device_id>` so per-device retries are safe.\n\n"
        "**Returns**:\n"
        "```json\n"
        "{ \"total\": 100, \"successful\": 95, \"failed\": 5, \"errors\": [...] }\n"
        "```"
    ),
)
def bulk_allocate_devices(
    body: Dict[str, Any] = Body(
        ...,
        example={
            "target_org_id": "uuid",
            "device_ids": ["PUMP-001", "PUMP-002"],
            "note": "October batch",
        },
    ),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_org_id = body.get("target_org_id")
    device_ids = body.get("device_ids") or body.get("pump_ids") or []
    if not target_org_id:
        raise HTTPException(status_code=422, detail="MISSING_FIELD: 'target_org_id' is required")
    if not device_ids:
        raise HTTPException(status_code=422, detail="MISSING_FIELD: 'device_ids' must be a non-empty list")
    note = body.get("note")
    try:
        return _svc(current_user, db).bulk_allocate(
            device_ids, target_org_id, note=note,
            idempotency_key=idempotency_key,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.bulk_allocate failed: %s", exc)
        raise HTTPException(status_code=500, detail="BULK_ALLOCATION_FAILED")


# ── History ───────────────────────────────────────────────────────────────────

@router.get(
    "/{device_id}/history",
    summary="Consolidated device history",
    description=(
        "Returns a unified history of:\n"
        "- Audit events (state changes, imports, updates)\n"
        "- Org-level allocation chain\n"
        "- Panel binding history\n\n"
        "Records are append-only. This endpoint CANNOT be used to modify history."
    ),
)
def get_device_history(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _svc(current_user, db).get_device_history(device_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.history failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="HISTORY_QUERY_FAILED")


@router.get(
    "/{device_id}/ownership-history",
    summary="Device chain of custody",
    description=(
        "Returns the complete org-level ownership chain for the device:\n\n"
        "```\n"
        "SUPER_ADMIN → MANUFACTURER → DISTRIBUTOR → DEALER → (end_user access)\n"
        "```\n\n"
        "Records cannot be modified or deleted via public API — immutable chain of custody."
    ),
)
def get_ownership_history(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _svc(current_user, db).get_ownership_history(device_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.ownership_history failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="OWNERSHIP_HISTORY_QUERY_FAILED")


# ── Panel binding ─────────────────────────────────────────────────────────────

@router.post(
    "/{device_id}/panel",
    summary="Bind panel to device",
    description=(
        "Binds a panel serial to the device.\n\n"
        "**Rules**:\n"
        "- A device can have at most ONE active panel binding at a time\n"
        "- A panel serial can only be bound to ONE device at a time\n"
        "- Binding a new panel closes the existing binding (history preserved)\n\n"
        "**Access**: SUPER_ADMIN, PANEL_MANUFACTURER, DISTRIBUTOR, DEALER\n\n"
        "**History**: every binding/unbinding is preserved in `panel_binding_history`."
    ),
    responses={
        200: {"description": "Panel bound"},
        403: {"description": "PANEL_BIND_FORBIDDEN"},
        409: {"description": "PANEL_ALREADY_BOUND to another device"},
    },
)
def bind_panel(
    device_id: str,
    body: Dict[str, Any] = Body(
        ...,
        example={
            "panel_serial": "PNL-001-2026",
            "motor_rating": "7.5HP",
            "starter_type": "DOL",
            "pump_make": "CRI",
            "pump_model": "4W8X1504T",
            "note": "Initial installation",
        },
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    panel_serial = body.get("panel_serial")
    if not panel_serial:
        raise HTTPException(status_code=422, detail="MISSING_FIELD: 'panel_serial' is required")
    try:
        return _svc(current_user, db).bind_panel(
            device_id=device_id,
            panel_serial=panel_serial,
            motor_rating=body.get("motor_rating"),
            starter_type=body.get("starter_type"),
            pump_make=body.get("pump_make"),
            pump_model=body.get("pump_model"),
            note=body.get("note"),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.panel_bind failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="PANEL_BIND_FAILED")


@router.get(
    "/{device_id}/panel/history",
    summary="Panel binding history",
)
def get_panel_history(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        from app.repositories.device_repository import DeviceRepository
        from app.services.device_service import DeviceService
        svc = _svc(current_user, db)
        pump = svc._repo.find_by_id(device_id)
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
        return {"device_id": device_id, "panel_history": svc._repo.get_panel_history(device_id)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("devices.panel_history failed device=%s: %s", device_id, exc)
        raise HTTPException(status_code=500, detail="PANEL_HISTORY_QUERY_FAILED")


@router.get(
    "/{device_id}/allowed-transitions",
    summary="Get allowed lifecycle transitions",
)
def get_allowed_transitions(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = _svc(current_user, db)
    pump = svc._repo.find_by_id(device_id)
    if not pump:
        raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
    lc_svc = DeviceLifecycleService(db)
    curr = pump.lifecycle_state or "MANUFACTURED"
    return {
        "device_id": device_id,
        "current_state": curr,
        "allowed_transitions": sorted(lc_svc.get_allowed_transitions(curr)),
    }
'''

for path, content in files.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"WRITTEN: {os.path.relpath(path, BASE)}")

print("Part 4 done.")
