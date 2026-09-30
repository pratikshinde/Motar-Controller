from datetime import date, datetime, timedelta, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status, File, UploadFile, Response
from fastapi.responses import FileResponse
import calendar
import logging
import re
import secrets
import uuid
import csv
import io
import os
from sqlalchemy.orm import Session, aliased
from sqlalchemy import bindparam, desc, text, func
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import (
    Pump, DeviceConfig, Command, TelemetryHistory, FaultLog,
    AllocationLog, AuditLog, ConfigTemplate, Panel, User,
    Alert, AlertSubscription, BatchImei, DailySummary, Site, McuSwapLog, BridgeSwapLog, DeviceBatch, SCHEMA
)
from app.core.scope import path_in_scope
from app.core.errors import AppError
from app.config import settings
from app.services.jwt_auth import hash_secret
from app.services.pump_view import build_user_views
from app.models.device_access import DeviceAccess
from app.models.organisation import Organisation
from app.schemas import (
    PumpCreate, PumpUpdate, PumpLocationUpdate, PumpWarrantyUpdate,
    PumpLifecycleUpdate, CommandRequest, BridgeSwapRequest,
    ApplyTemplateRequest, TimerConfigRequest, McuSwapRequest, PumpPanelUpdate, BulkAllocateRequest
)
from app.schemas.pump import (
    PumpResponse, PumpListResponse, PumpDetailResponse,
    DeviceSettingsUpdate, DeviceSettingsResponse,
    CommandDispatchResponse, CommandDispatchInfo, CommandDetailResponse,
    TimerConfigResponse, TimerConfigDetail,
    FaultRecordResponse, SupportContactResponse,
    HistoryResponse, HistoryPoint
)
from app.api.deps import get_current_user, require_roles, get_pump_in_scope, set_db_actor_context
from app.services.command_service import (
    check_command_cooldown, command_event, create_command, find_by_idempotency_key,
)
from app.services.command_dispatch import dispatch_command
from app.services.fault_catalog import load_fault_catalog
from app.services.ws_hub import ws_hub
from app.repositories import PumpRepository, TelemetryRepository

logger = logging.getLogger("agripump.pumps")
router = APIRouter(tags=["Pumps & Devices"])

def _ensure_remote_control_allowed(pump: Pump) -> None:
    """Remote START / STOP / timer is paused for suspended, RMA and retired devices (FR-CLD-073)."""
    blocked = ("SUSPENDED", "RMA", "RETIRED")
    if (pump.lifecycle_state or "").upper() in blocked or (pump.status or "").upper() in blocked:
        raise AppError(
            code="DEVICE_SUSPENDED",
            message_key="errors.device_suspended",
            status_code=403,
            detail="Remote control is paused for this device.",
        )


def connectivity_of(last_seen) -> str:
    """ONLINE, OFFLINE (reported before, but not recently) or NEVER_SEEN. Same rule as the fleet counts."""
    if last_seen is None:
        return "NEVER_SEEN"
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - last_seen).total_seconds()
    return "OFFLINE" if age > settings.OFFLINE_AFTER_SECONDS else "ONLINE"


def format_pump(pump: Pump, latest_telem: Optional[dict] = None) -> dict:
    w_start = getattr(pump, "warranty_start_date", None)
    last_seen = getattr(pump, "last_seen_at", None)
    created = getattr(pump, "created_at", None)
    res = {
        "id": pump.id,
        "name": pump.name,
        "supply_type": pump.supply_type,
        "hp_rating": float(pump.hp_rating) if pump.hp_rating is not None else None,
        "owner_user_id": str(pump.owner_user_id) if pump.owner_user_id else None,
        "hierarchy_path": pump.hierarchy_path,
        # Unknown stays unknown: no (0, 0) position and no made-up firmware version.
        "latitude": float(pump.latitude) if pump.latitude is not None else None,
        "longitude": float(pump.longitude) if pump.longitude is not None else None,
        "status": pump.status or "STOPPED",
        "connectivity": connectivity_of(getattr(pump, "last_seen_at", None)),
        "lifecycle_state": pump.lifecycle_state or "ACTIVE",
        "firmware_version": pump.firmware_version,
        "panel_serial": getattr(pump, "panel_serial", None),
        "warranty_start_at": w_start.isoformat() if (w_start and hasattr(w_start, 'isoformat')) else None,
        "warranty_period_months": getattr(pump, "warranty_period_months", None),
        "last_seen_at": last_seen.isoformat() if (last_seen and hasattr(last_seen, 'isoformat')) else None,
        "created_at": created.isoformat() if (created and hasattr(created, 'isoformat')) else None,
    }
    expires = getattr(pump, "subscription_expires_at", None)
    res["total_runtime_min"] = getattr(pump, "total_runtime_min", None)
    res["subscription_expires_at"] = expires.isoformat() if expires else None
    res["subscription_days_left"] = (expires - datetime.now(expires.tzinfo)).days if expires else None
    # Attach telemetry if available
    if latest_telem:
        res.update(latest_telem)
    elif getattr(pump, "last_telemetry", None):
        res.update(pump.last_telemetry)
    return res

@router.get("", response_model=PumpListResponse)
def list_pumps(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    cursor: Optional[str] = Query(None, description="Opaque pagination cursor"),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = PumpRepository.for_actor(actor=current_user, db=db)
    total = repo.count(search=search, status=status_filter)
    pumps = repo.list(page=page, limit=limit, cursor=cursor, search=search, status=status_filter)

    # Retrieve latest telemetry for these scoped pumps
    pump_ids = [p.id for p in pumps]
    telemetry_repo = TelemetryRepository.for_actor(actor=current_user, db=db)
    telemetry_map = telemetry_repo.get_latest_telemetry_map(pump_ids)
    data = [format_pump(p, telemetry_map.get(p.id)) for p in pumps]
    views = build_user_views(db, current_user, pumps)
    for d in data:
        d.update(views.get(d["id"], {}))
    if current_user.role == "customer":
        data.sort(key=lambda d: (d.get("sort_order") or 0, (d.get("display_name") or "").lower()))

    # Counts over everything in scope, not just this page.
    meta_stats = repo.fleet_counts(settings.OFFLINE_AFTER_SECONDS, search=search)

    next_cursor = pumps[-1].id if (len(pumps) == limit and pumps) else None

    return {
        "pumps": data,
        "data": data,
        "meta": {
            "total": total,
            "page": page if not cursor else None,
            "limit": limit,
            "cursor": cursor,
            "next_cursor": next_cursor,
            "stats": meta_stats
        }
    }

@router.get("/{id}", response_model=PumpDetailResponse)
def get_pump(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found or out of scope")

    from app.services.authorization_service import AuthorizationService
    from app.core.permissions import Permission
    AuthorizationService.authorize(current_user, Permission.VIEW_DEVICE, resource=pump, db=db)

    telem_dict = TelemetryRepository.for_actor(actor=current_user, db=db).get_latest_telemetry_map([id]).get(id)

    open_fault_count = (
        db.query(func.count(FaultLog.id))
        .filter(FaultLog.pump_id == id, FaultLog.ack_at.is_(None))
        .scalar() or 0
    )

    formatted = format_pump(pump, telem_dict)
    formatted.update(build_user_views(db, current_user, [pump]).get(pump.id, {}))
    return {
        "pump": formatted,
        "latest_telemetry": telem_dict,
        "config": None,
        "open_fault_count": open_fault_count
    }

@router.delete("/{id}")
def delete_pump(
    id: str,
    current_user: User = Depends(require_roles("superadmin")),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found or out of scope")

    db.add(AuditLog(
        actor_id=current_user.id,
        actor_role=current_user.role,
        entity_type="PUMP",
        entity_id=id,
        action="DELETE_PUMP",
        before_json={"name": pump.name, "status": pump.status},
        after_json=None
    ))

    # Delete/disassociate related records to avoid FK / ORM cascade errors
    db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).delete(synchronize_session=False)
    db.query(Command).filter(Command.pump_id == id).delete(synchronize_session=False)
    db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == id).delete(synchronize_session=False)
    db.query(FaultLog).filter(FaultLog.pump_id == id).delete(synchronize_session=False)
    db.query(Alert).filter(Alert.pump_id == id).delete(synchronize_session=False)
    db.query(AlertSubscription).filter(AlertSubscription.pump_id == id).delete(synchronize_session=False)
    db.query(AllocationLog).filter(AllocationLog.pump_id == id).delete(synchronize_session=False)
    db.query(Panel).filter(Panel.pump_id == id).update({"pump_id": None}, synchronize_session=False)

    db.delete(pump)
    db.commit()

    return {"message": f"Pump '{id}' deleted successfully"}

@router.post("", status_code=201)
def create_pump(
    req: PumpCreate,
    current_user: User = Depends(require_roles(["superadmin", "manufacturer", "distributor", "dealer"])),
    db: Session = Depends(get_db)
):
    # Registering a device is a partner's job: a farmer who could do it could squat on the id of a pump that is
    # about to be installed for someone else. Farmers get pumps through their dealer.
    try:
        existing = db.query(Pump).filter(Pump.id == req.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Pump with this ID already exists")

        h_path = (current_user.hierarchy_path if current_user and current_user.hierarchy_path else "/SA")
        u_id = current_user.id if current_user else None

        # A real secret, shown to the operator once: only its hash is kept, and the device must present it.
        device_key = secrets.token_urlsafe(32)

        s_type = req.supply_type or "3-phase"
        if s_type in ["3P", "3P"]:
            s_type = "3-phase"
        elif s_type in ["1P"]:
            s_type = "1-phase"

        pump = Pump(
            id=req.id,
            name=req.name,
            supply_type=s_type,
            hp_rating=req.hp_rating or 5.0,
            owner_user_id=u_id,
            hierarchy_path=h_path,
            latitude=req.latitude,
            longitude=req.longitude,
            status="STOPPED",
            lifecycle_state="ACTIVE",
            firmware_version=None,          # the device reports its own firmware version; nothing is assumed
            device_key_hash=hash_secret(device_key),
        )
        db.add(pump)
        
        # Initialize default config
        cfg = DeviceConfig(
            pump_id=req.id,
            desired_json={"ol": 25.0, "ov": 480, "dr": 1, "dr_t": 5},
            reported_json={},
            status="APPLIED"
        )
        db.add(cfg)
        db.commit()
        db.refresh(pump)
        
        formatted = format_pump(pump)
        formatted["device_key"] = device_key
        return formatted
    except HTTPException:
        raise
    except Exception:
        logger.exception("Creating pump %s failed", req.id)
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not create the device.")

@router.patch("/{id}/my-settings", response_model=DeviceSettingsResponse)
def update_pump_my_settings(
    id: str,
    req: DeviceSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found or out of scope")

    if req.site_id:
        import uuid as _uuid_chk
        try:
            site_chk = _uuid_chk.UUID(req.site_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid site id")
        if not db.query(Site).filter(Site.id == site_chk, Site.owner_user_id == current_user.id).first():
            raise HTTPException(status_code=404, detail="Site not found")

    access = (
        db.query(DeviceAccess)
        .filter(DeviceAccess.user_id == current_user.id, DeviceAccess.device_id == id)
        .first()
    )

    if not access:
        import uuid as _uuid
        site_uuid = _uuid.UUID(req.site_id) if req.site_id else None
        role = "owner" if pump.owner_user_id == current_user.id else "viewer"
        access = DeviceAccess(
            user_id=current_user.id,
            device_id=id,
            role=role,
            nickname=(req.nickname.strip() or None) if req.nickname else None,
            site_id=site_uuid,
            sort_order=req.sort_order if req.sort_order is not None else 0
        )
        db.add(access)
    else:
        if req.nickname is not None:
            access.nickname = req.nickname.strip() or None
        if req.site_id is not None:
            import uuid as _uuid
            access.site_id = _uuid.UUID(req.site_id) if req.site_id else None
        if req.sort_order is not None:
            access.sort_order = req.sort_order

    db.commit()
    db.refresh(access)

    return {
        "device_id": id,
        "nickname": access.nickname,
        "site_id": str(access.site_id) if access.site_id else None,
        "sort_order": access.sort_order,
        "role": access.role,
        "message": "Device settings updated successfully"
    }

from fastapi import BackgroundTasks, Request

def _enqueue_command(
    db: Session,
    request: Request,
    background_tasks: BackgroundTasks,
    pump: Pump,
    user: User,
    action: str,
    payload: dict,
):
    """Queues one command for a pump and schedules its publication. Returns (command, already_existed).

    A retried request (same Idempotency-Key for this pump) returns the first command and sends nothing new.
    The cooldown is the server's decision: the 429 carries the seconds to wait, in the body and in Retry-After.
    """
    key = (request.headers.get("Idempotency-Key") or "").strip() or None
    existing = find_by_idempotency_key(db, pump.id, key)
    if existing:
        return existing, True

    can_exec, cooldown_rem = check_command_cooldown(db, pump.id)
    if not can_exec:
        raise AppError(
            code="COOLDOWN_ACTIVE",
            message_key="errors.cooldown",
            status_code=429,
            params={"seconds": cooldown_rem, "retry_after": cooldown_rem},
            detail=f"Command cooldown active. Please wait {cooldown_rem}s.",
            headers={"Retry-After": str(cooldown_rem)},
        )

    try:
        cmd = create_command(db, pump.id, action, payload, user.id, idempotency_key=key)
    except IntegrityError:
        # Two identical retries raced: the other one won. Hand back its command.
        db.rollback()
        set_db_actor_context(db, user)
        existing = find_by_idempotency_key(db, pump.id, key)
        if existing:
            return existing, True
        raise
    background_tasks.add_task(dispatch_command, cmd.cid)
    return cmd, False


@router.post("/{id}/commands", response_model=CommandDispatchResponse)
@router.post("/{id}/command", response_model=CommandDispatchResponse)
def send_pump_command(
    id: str,
    req: CommandRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    from app.services.authorization_service import AuthorizationService
    from app.core.permissions import Permission
    AuthorizationService.authorize(current_user, Permission.CONTROL_DEVICE, resource=pump, db=db)

    _ensure_remote_control_allowed(pump)
    cmd, repeated = _enqueue_command(db, request, background_tasks, pump, current_user, req.action_name, req.payload)
    return {
        "message": "Command already received" if repeated else "Command dispatched successfully",
        "command": command_event(cmd),
    }

@router.get("/{id}/commands/{cid}", response_model=CommandDetailResponse)
def get_pump_command_status(
    id: str,
    cid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    import uuid as _uuid
    try:
        cmd_uuid = _uuid.UUID(cid)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid command ID format")

    cmd = db.query(Command).filter(Command.cid == cmd_uuid, Command.pump_id == id).first()
    if not cmd:
        raise HTTPException(status_code=404, detail="Command not found")

    return command_event(cmd)

@router.get("/{id}/timer", response_model=TimerConfigResponse)
def get_pump_timer(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).first()
    desired_timer = (cfg.desired_json or {}).get("timer") if cfg else None
    if not desired_timer:
        # Nothing has been sent to this pump: say so rather than inventing a default timer.
        return {"message": "No timer has been sent to this pump", "timer": None, "command": None}
    timer_payload = {
        "on_duration_minutes": desired_timer.get("on_duration_minutes", 1),
        "off_duration_minutes": desired_timer.get("off_duration_minutes", 0),
        "cycle_count": desired_timer.get("cycle_count", 1),
        "mode": desired_timer.get("mode", "ON_TIMER")
    }
    return {
        "message": "Last timer sent to the pump",
        "timer": timer_payload,
        "command": None
    }

@router.put("/{id}/timer", response_model=TimerConfigResponse)
@router.post("/{id}/timer", response_model=TimerConfigResponse)
def set_pump_timer(
    id: str,
    req: TimerConfigRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    _ensure_remote_control_allowed(pump)
    timer_payload = {
        "on_duration_minutes": req.on_duration_minutes,
        "off_duration_minutes": req.off_duration_minutes or 0,
        "cycle_count": req.cycle_count if req.cycle_count is not None else 1,
        "mode": req.mode or "ON_TIMER"
    }

    # Queue first: a retry (same Idempotency-Key) or the cooldown must not change the saved timer.
    cmd, repeated = _enqueue_command(db, request, background_tasks, pump, current_user, "SET_TIMER", timer_payload)
    if not repeated:
        cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).first()
        if not cfg:
            cfg = DeviceConfig(pump_id=id, desired_json={"timer": timer_payload}, status="PENDING")
            db.add(cfg)
        else:
            current_desired = dict(cfg.desired_json or {})
            current_desired["timer"] = timer_payload
            cfg.desired_json = current_desired
            cfg.status = "PENDING"
        db.commit()

    return {
        "message": "Timer configuration already received" if repeated else "Timer configuration updated and command dispatched",
        "timer": timer_payload,
        "command": command_event(cmd),
    }

@router.get("/{id}/telemetry")
def get_pump_telemetry(
    id: str,
    hours: int = Query(24, ge=1, le=720),
    limit: int = Query(2000, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Telemetry history for the TrendsTab.  Returns a time-windowed slice
    (newest `limit` rows within the last `hours` hours) in ascending time order
    so the chart x-axis runs left→right."""
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    from datetime import timezone as _tz
    cutoff = datetime.now(_tz.utc) - timedelta(hours=hours)

    records = (
        db.query(TelemetryHistory)
        .filter(TelemetryHistory.pump_id == id, TelemetryHistory.recorded_at >= cutoff)
        .order_by(desc(TelemetryHistory.recorded_at))
        .limit(limit)
        .all()
    )
    records.reverse()  # ascending time order for charts

    rows = [
        {
            "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
            "v_ry": float(r.v_ry) if r.v_ry is not None else None,
            "v_yb": float(r.v_yb) if r.v_yb is not None else None,
            "v_br": float(r.v_br) if r.v_br is not None else None,
            "i_r": float(r.i_r) if r.i_r is not None else None,
            "i_y": float(r.i_y) if r.i_y is not None else None,
            "i_b": float(r.i_b) if r.i_b is not None else None,
            "pump_on": bool(r.pump_on),
            "fault_active": bool(r.fault_active),
            "gsm_rssi": r.gsm_rssi,
            "seq": r.seq,
            "ts_approx": bool(r.ts_approx),
            "buffered": bool(r.buffered),
        }
        for r in records
    ]
    return {"pump_id": id, "hours": hours, "count": len(rows), "telemetry": rows}

@router.get("/{id}/history", response_model=HistoryResponse)
def get_pump_history(
    id: str,
    period: str = Query("day", pattern="^(day|week|month)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns telemetry history for a pump.

    - period=day   → raw telemetry_history rows from last 24 h (newest 2 000 pts)
    - period=week  → daily_summary rows from last 7 days (one row per device-day)
    - period=month → daily_summary rows from last 30 days (one row per device-day)

    Week/month views read pre-computed rollups (P2.3 / FR-CLD-025).
    Raw data is only served within the 30-day retention window.
    """
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    from datetime import timezone as _tz
    now = datetime.now(_tz.utc)

    if period == "day":
        # Raw telemetry — last 24 h
        cutoff = now - timedelta(days=1)
        # A pump reporting once a minute sends ~1 440 rows a day: keep the NEWEST rows if we must cut,
        # so the chart always ends at "now" rather than stopping part-way through the day.
        records = (
            db.query(TelemetryHistory)
            .filter(TelemetryHistory.pump_id == id, TelemetryHistory.recorded_at >= cutoff)
            .order_by(TelemetryHistory.recorded_at.desc())
            .limit(2000)
            .all()
        )
        records.reverse()
        data = [
            {
                "id": r.id,
                "v_ry": float(r.v_ry) if r.v_ry is not None else None,
                "v_yb": float(r.v_yb) if r.v_yb is not None else None,
                "v_br": float(r.v_br) if r.v_br is not None else None,
                "i_r": float(r.i_r) if r.i_r is not None else None,
                "i_y": float(r.i_y) if r.i_y is not None else None,
                "i_b": float(r.i_b) if r.i_b is not None else None,
                "pump_on": r.pump_on or False,
                "fault_active": r.fault_active or False,
                "gsm_rssi": r.gsm_rssi,
                "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
                "source": "raw",
            }
            for r in records
        ]
    else:
        # Daily rollup — week (7 days) or month (30 days)
        days_back = 7 if period == "week" else 30
        cutoff_date = (now - timedelta(days=days_back)).date()

        rollups = (
            db.query(DailySummary)
            .filter(
                DailySummary.device_id == id,
                DailySummary.day >= cutoff_date,
            )
            .order_by(DailySummary.day.asc())
            .all()
        )

        data = [
            {
                "id": r.id,
                # Use mean voltage as representative reading for chart
                "v_ry": float(r.v_mean) if r.v_mean is not None else None,
                "v_yb": None,
                "v_br": None,
                "i_r": float(r.i_mean) if r.i_mean is not None else None,
                "i_y": None,
                "i_b": None,
                "pump_on": r.runtime_min > 0,
                "fault_active": r.fault_count > 0,
                "gsm_rssi": None,
                "recorded_at": r.day.isoformat(),
                "source": "daily_summary",
                # Extra rollup fields for richer chart rendering
                "runtime_min": r.runtime_min,
                "start_count": r.start_count,
                "fault_count": r.fault_count,
                "offline_min": r.offline_min,
                "v_min": float(r.v_min) if r.v_min is not None else None,
                "v_max": float(r.v_max) if r.v_max is not None else None,
                "v_mean": float(r.v_mean) if r.v_mean is not None else None,
                "i_min": float(r.i_min) if r.i_min is not None else None,
                "i_max": float(r.i_max) if r.i_max is not None else None,
                "i_mean": float(r.i_mean) if r.i_mean is not None else None,
                "sample_count": r.sample_count,
            }
            for r in rollups
        ]

    return {
        "pump_id": id,
        "period": period,
        "count": len(data),
        "records": data
    }

@router.get("/{id}/history.csv")
def export_pump_history_csv(
    id: str,
    period: str = Query("month", pattern="^(day|week|month)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    now = datetime.utcnow()
    if period == "day":
        cutoff = now - timedelta(days=1)
    elif period == "week":
        cutoff = now - timedelta(days=7)
    else:
        cutoff = now - timedelta(days=30)

    records = (
        db.query(TelemetryHistory)
        .filter(TelemetryHistory.pump_id == id, TelemetryHistory.recorded_at >= cutoff)
        .order_by(TelemetryHistory.recorded_at.asc())
        .limit(2000)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "recorded_at", "v_ry", "v_yb", "v_br", "i_r", "i_y", "i_b", "pump_on", "fault_active", "gsm_rssi"])
    for r in records:
        writer.writerow([
            r.id,
            r.recorded_at.isoformat() if r.recorded_at else "",
            r.v_ry, r.v_yb, r.v_br,
            r.i_r, r.i_y, r.i_b,
            r.pump_on, r.fault_active, r.gsm_rssi
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=pump_{id}_history.csv"}
    )

@router.get("/{id}/faults", response_model=List[FaultRecordResponse])
def get_pump_faults(
    id: str,
    status: Optional[str] = Query(None, description="'open' or 'all'"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    query = db.query(FaultLog).filter(FaultLog.pump_id == id)
    if status == "open":
        query = query.filter(FaultLog.ack_at.is_(None))

    logs = query.order_by(desc(FaultLog.occurred_at)).limit(100).all()
    catalog = load_fault_catalog(db)

    return [
        {
            "id": log.id,
            "fault_code": log.fault_code,
            "fault_name": catalog[log.fault_code].name if log.fault_code in catalog else None,
            "severity": catalog[log.fault_code].severity if log.fault_code in catalog else None,
            "fault_description": log.fault_description or log.description,
            "v_ry": float(log.v_ry) if log.v_ry is not None else None,
            "v_yb": float(log.v_yb) if log.v_yb is not None else None,
            "v_br": float(log.v_br) if log.v_br is not None else None,
            "i_r": float(log.i_r) if log.i_r is not None else None,
            "i_y": float(log.i_y) if log.i_y is not None else None,
            "i_b": float(log.i_b) if log.i_b is not None else None,
            "occurred_at": log.occurred_at.isoformat() if log.occurred_at else None,
            "resolved_at": log.resolved_at.isoformat() if log.resolved_at else None,
            "ack_at": log.ack_at.isoformat() if log.ack_at else None,
        }
        for log in logs
    ]

@router.post("/{id}/faults/{fault_id}/ack")
def ack_pump_fault(
    id: str,
    fault_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    log = db.query(FaultLog).filter(FaultLog.id == fault_id, FaultLog.pump_id == id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Fault log record not found")

    log.ack_by_user_id = current_user.id
    log.ack_at = datetime.utcnow()
    db.commit()
    return {"message": "Fault acknowledged", "id": fault_id}

@router.post("/{id}/faults/{fault_id}/reset")
def reset_pump_fault(
    id: str,
    fault_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    log = db.query(FaultLog).filter(FaultLog.id == fault_id, FaultLog.pump_id == id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Fault log record not found")

    log.ack_by_user_id = current_user.id
    log.ack_at = datetime.utcnow()
    log.resolved_at = datetime.utcnow()

    cmd, _ = _enqueue_command(db, request, background_tasks, pump, current_user, "RESET_FAULT", {"fault_id": fault_id})
    db.commit()

    return {"message": "Fault acknowledged and reset command dispatched", "fault_id": fault_id, "command": command_event(cmd)}

@router.get("/{id}/support-contact", response_model=SupportContactResponse)
def get_pump_support_contact(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    dealer_name = dealer_phone = dealer_email = None
    dealer_user = None
    if pump.org_id:
        org = db.query(Organisation).filter(Organisation.id == pump.org_id).first()
        if org:
            dealer_name = org.name
            dealer_user = db.query(User).filter(User.org_id == org.id, User.role == "dealer").first()
    if dealer_user is None and pump.installed_by_user_id:
        dealer_user = db.query(User).filter(User.id == pump.installed_by_user_id).first()
    if dealer_user is not None:
        dealer_name = dealer_name or dealer_user.full_name
        dealer_phone = dealer_user.phone_number or dealer_user.phone
        dealer_email = dealer_user.email

    # Nothing is filled in when unknown: the app then says "ask your dealer" instead of
    # offering a number that goes nowhere.
    return {
        "dealer_name": dealer_name,
        "dealer_phone": dealer_phone,
        "dealer_email": dealer_email,
        "escalation_name": settings.SUPPORT_ESCALATION_NAME or None,
        "escalation_phone": settings.SUPPORT_ESCALATION_PHONE or None,
        "escalation_email": settings.SUPPORT_ESCALATION_EMAIL or None,
        "hierarchy_path": pump.hierarchy_path,
    }

@router.get("/{id}/config")
def get_pump_config(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).first()
    if not cfg:
        cfg = DeviceConfig(pump_id=id, desired_json={}, reported_json={}, status="APPLIED")
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    return {
        "pump_id": id,
        "desired": cfg.desired_json,
        "reported": cfg.reported_json,
        "status": cfg.status,
        "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None
    }

@router.put("/{id}/config")
def update_pump_config(
    id: str,
    desired_config: dict,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).first()
    if not cfg:
        cfg = DeviceConfig(pump_id=id)
        db.add(cfg)

    cfg.desired_json = desired_config
    cfg.status = "PENDING"
    cfg.updated_by = current_user.id
    cfg.updated_at = datetime.utcnow()
    db.commit()

    async def _bcast():
        await ws_hub.broadcast_config_update(id, {"status": "PENDING", "desired": desired_config}, pump.hierarchy_path)

    background_tasks.add_task(_bcast)

    return {"message": "Desired configuration saved", "status": "PENDING"}

@router.post("/{id}/config/report")
def report_pump_config(
    id: str,
    reported_config: dict,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found or out of scope")

    cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).first()
    if not cfg:
        cfg = DeviceConfig(pump_id=id)
        db.add(cfg)

    cfg.reported_json = reported_config
    cfg.status = "APPLIED"
    cfg.updated_at = datetime.utcnow()
    h_path = pump.hierarchy_path
    db.commit()

    async def _bcast():
        await ws_hub.broadcast_config_update(id, {"status": "APPLIED", "reported": reported_config}, h_path)

    background_tasks.add_task(_bcast)

    return {"message": "Reported configuration synchronized"}

@router.post("/{id}/location")
def update_pump_location(
    id: str,
    req: PumpLocationUpdate,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db)
):
    pump = db.query(Pump).filter(Pump.id == id).first()
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")
    pump.latitude = req.latitude
    pump.longitude = req.longitude
    db.commit()
    return {"message": "Location updated"}

@router.put("/{id}/warranty")
def update_pump_warranty(
    id: str,
    req: PumpWarrantyUpdate,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db)
):
    pump = db.query(Pump).filter(Pump.id == id).first()
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")
    if (req.warranty_start_date is None) != (req.warranty_period_months is None):
        raise HTTPException(
            status_code=422,
            detail="Give both a start date and a period in months, or neither to clear the warranty.",
        )
    before = {
        "warranty_start_date": pump.warranty_start_date.isoformat() if pump.warranty_start_date else None,
        "warranty_period_months": pump.warranty_period_months,
    }
    pump.warranty_start_date = req.warranty_start_date
    pump.warranty_period_months = req.warranty_period_months
    after = {
        "warranty_start_date": req.warranty_start_date.isoformat() if req.warranty_start_date else None,
        "warranty_period_months": req.warranty_period_months,
    }
    _pump_audit(db, current_user, pump.id, "WARRANTY_UPDATED", before=before, after=after)
    db.commit()
    return {"message": "Warranty updated", **after}

LIFECYCLE_TRANSITIONS = {
    "MANUFACTURED": {"ALLOCATED", "IN_STOCK", "RETIRED"},
    "ALLOCATED": {"IN_STOCK", "COMMISSIONED", "ALLOCATED", "RETIRED"},
    "IN_STOCK": {"COMMISSIONED", "ALLOCATED", "RETIRED"},
    "COMMISSIONED": {"ACTIVE", "SUSPENDED", "RMA", "RETIRED"},
    "ACTIVE": {"SUSPENDED", "RMA", "RETIRED"},
    "SUSPENDED": {"ACTIVE", "RMA", "RETIRED"},
    "RMA": {"ACTIVE", "IN_STOCK", "RETIRED"},
    "RETIRED": set(),  # Terminal state per FR-SEC-010
}

@router.put("/{id}/lifecycle")
def update_pump_lifecycle(
    id: str,
    req: PumpLifecycleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    curr_state = (pump.lifecycle_state or "ACTIVE").upper()
    next_state = req.lifecycle_state.strip().upper()

    if curr_state == next_state:
        return {"message": f"Lifecycle already in state {next_state}", "lifecycle_state": next_state}

    valid_targets = LIFECYCLE_TRANSITIONS.get(curr_state, set())
    if next_state not in valid_targets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid lifecycle transition: Cannot transition device from '{curr_state}' to '{next_state}'. Valid transitions: {sorted(valid_targets) if valid_targets else 'None (terminal state)'}"
        )

    if next_state == "RETIRED" and current_user.role not in ("superadmin", "manufacturer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Decommissioning/retiring a device requires superadmin or manufacturer role."
        )

    pump.lifecycle_state = next_state
    db.commit()
    return {"message": f"Lifecycle transitioned from {curr_state} to {next_state}", "lifecycle_state": next_state}

# ---------------------------------------------------------------------------------------------------------------------
# Install-time and lifecycle actions the partner portal offers (FR-WEB-013, 031, 034)
# ---------------------------------------------------------------------------------------------------------------------
INSTALL_ROLES = ["superadmin", "manufacturer", "distributor", "dealer"]
STOCK_STATES = {"MANUFACTURED", "IN_STOCK", "ALLOCATED"}     # a device that has not been commissioned yet
OPEN_COMMAND_STATES = ("QUEUED", "SENT", "DELIVERED", "ACKNOWLEDGED")
IMEI_PATTERN = re.compile(r"^\d{15}$")
MCU_UID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{4,30}$")


def _utc_iso(value: Optional[datetime]) -> Optional[str]:
    """ISO 8601 in UTC that a browser reads correctly, whether the value came from the database (timezone-aware)
    or was just created here (naive UTC)."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _pump_audit(db: Session, actor: User, pump_id: str, action: str, before=None, after=None) -> None:
    db.add(AuditLog(
        actor_id=actor.id, actor_role=actor.role, entity_type="pump", entity_id=pump_id,
        action=action, before_json=before, after_json=after,
    ))


def _panel_view(pump: Pump) -> dict:
    return {
        "id": pump.id, "panel_serial": pump.panel_serial, "motor_rating": pump.motor_rating,
        "starter_type": pump.starter_type, "pump_make": pump.pump_make, "pump_model": pump.pump_model,
    }


@router.put("/{id}/panel")
def update_pump_panel(
    id: str,
    req: PumpPanelUpdate,
    current_user: User = Depends(require_roles(INSTALL_ROLES)),
    db: Session = Depends(get_db),
):
    """Bind the device to its panel record: install-time facts, never editable by the farmer."""
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")
    changes = {
        key: ((value.strip() or None) if isinstance(value, str) else value)
        for key, value in req.model_dump(exclude_unset=True).items()
    }
    before = {key: getattr(pump, key) for key in changes}
    for key, value in changes.items():
        setattr(pump, key, value)
    _pump_audit(db, current_user, pump.id, "PANEL_BOUND", before=before, after=changes)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That panel serial is already bound to another device.")
    db.refresh(pump)
    return {"message": "Panel binding updated", "pump": _panel_view(pump)}


@router.get("/{id}/mcu-swap-history")
def get_mcu_swap_history(
    id: str,
    current_user: User = Depends(require_roles(INSTALL_ROLES)),
    db: Session = Depends(get_db),
):
    if not get_pump_in_scope(db, id, current_user):
        raise HTTPException(status_code=404, detail="Pump not found")
    rows = (
        db.query(McuSwapLog, User.full_name)
        .outerjoin(User, User.id == McuSwapLog.performed_by)
        .filter(McuSwapLog.pump_id == id)
        .order_by(desc(McuSwapLog.occurred_at))
        .limit(200)
        .all()
    )
    return {
        # Only what the swaps say: nothing records a controller's id before the first one is logged.
        "current_mcu_uid": rows[0][0].new_mcu_uid if rows else None,
        "history": [
            {
                "id": str(log.id), "old_mcu_uid": log.old_mcu_uid, "new_mcu_uid": log.new_mcu_uid,
                "reason": log.reason, "occurred_at": _utc_iso(log.occurred_at),
                "performed_by_name": name,
            }
            for log, name in rows
        ],
    }


@router.post("/{id}/mcu-swap", status_code=201)
def post_mcu_swap(
    id: str,
    req: McuSwapRequest,
    current_user: User = Depends(require_roles(INSTALL_ROLES)),
    db: Session = Depends(get_db),
):
    """Log a routine controller replacement. History only: the device keeps its identity and its data."""
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")
    if (pump.lifecycle_state or "").upper() == "RETIRED":
        raise HTTPException(status_code=409, detail="A retired device cannot be changed.")
    new_uid = (req.new_mcu_uid or "").strip().upper()
    if not MCU_UID_PATTERN.match(new_uid):
        raise HTTPException(status_code=422, detail="The MCU UID must be 4 to 30 letters, digits, dashes or underscores.")
    latest = (
        db.query(McuSwapLog).filter(McuSwapLog.pump_id == id).order_by(desc(McuSwapLog.occurred_at)).first()
    )
    if latest and latest.new_mcu_uid == new_uid:
        raise HTTPException(status_code=409, detail="That controller is already the current one.")
    log = McuSwapLog(
        pump_id=id, old_mcu_uid=latest.new_mcu_uid if latest else None, new_mcu_uid=new_uid,
        reason=(req.reason or "").strip() or None, performed_by=current_user.id,
    )
    db.add(log)
    db.flush()
    _pump_audit(db, current_user, id, "MCU_SWAPPED", before={"mcu_uid": log.old_mcu_uid}, after={"mcu_uid": new_uid})
    db.commit()
    return {
        "message": "MCU swap logged",
        "swap": {
            "id": str(log.id), "old_mcu_uid": log.old_mcu_uid, "new_mcu_uid": log.new_mcu_uid,
            "reason": log.reason, "occurred_at": _utc_iso(log.occurred_at),
        },
    }


@router.post("/{id}/bridge-swap")
def post_bridge_swap(
    id: str,
    req: BridgeSwapRequest,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Replace the whole device (bridge / modem) under RMA or warranty.

    The site keeps its history: the pump's id (its IMEI) is renamed and every table that points at it follows, so
    telemetry, faults, configuration, commands, access and allocation all carry over to the new identity. The old id
    stops existing and a new device key is issued, shown once.
    """
    new_id = (req.new_imei or "").strip()
    if not IMEI_PATTERN.match(new_id):
        raise HTTPException(status_code=422, detail="The new IMEI must be exactly 15 digits.")
    pump = db.query(Pump).filter(Pump.id == id).first()
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")
    if new_id == pump.id:
        raise HTTPException(status_code=422, detail="That is already this device's identity.")
    if (pump.lifecycle_state or "").upper() == "RETIRED":
        raise HTTPException(status_code=409, detail="A retired device cannot be swapped.")
    if db.query(Pump.id).filter(Pump.id == new_id).first():
        raise HTTPException(status_code=409, detail="A device with that IMEI is already registered.")

    reason = (req.reason or "").strip() or None
    device_key = secrets.token_urlsafe(32)
    db.expunge(pump)          # its primary key is about to change under it
    # Renaming a busy pump rewrites every reading it has; give that more room than an ordinary request gets.
    db.execute(text("SET LOCAL statement_timeout = '120s'"))
    # Whatever was still on its way to the old device must never reach the new one.
    db.execute(
        text(f"UPDATE {SCHEMA}.commands SET status = 'FAILED', failure_reason = 'device_replaced' "
             "WHERE pump_id = :old AND status IN :open").bindparams(bindparam("open", expanding=True)),
        {"old": id, "open": list(OPEN_COMMAND_STATES)},
    )
    db.execute(
        text(f"UPDATE {SCHEMA}.pumps SET id = :new, device_key_hash = :key_hash, supports_command_ack = false, "
             "firmware_version = NULL WHERE id = :old"),
        {"new": new_id, "old": id, "key_hash": hash_secret(device_key)},
    )
    swap = BridgeSwapLog(old_pump_id=id, new_pump_id=new_id, reason=reason, performed_by=current_user.id)
    db.add(swap)
    db.flush()
    _pump_audit(db, current_user, new_id, "BRIDGE_SWAPPED", before={"pump_id": id}, after={"pump_id": new_id, "reason": reason})
    db.commit()
    return {
        "message": f"Device migrated from {id} to {new_id}",
        "swap": {
            "id": str(swap.id), "old_pump_id": id, "new_pump_id": new_id, "reason": reason,
            "occurred_at": _utc_iso(swap.occurred_at),
        },
        "new_pump_id": new_id,
        "device_key": device_key,
    }


@router.post("/bulk-allocate")
def bulk_allocate_pumps(
    req: BulkAllocateRequest,
    current_user: User = Depends(require_roles(INSTALL_ROLES)),
    db: Session = Depends(get_db),
):
    """Hand stock devices to one account below the caller. Each device succeeds or fails on its own."""
    try:
        target_id = uuid.UUID(req.to_user_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="to_user_id is not a valid id")
    target = db.query(User).filter(User.id == target_id).first()
    below_caller = target is not None and target.id != current_user.id and path_in_scope(
        current_user.hierarchy_path, target.hierarchy_path
    )
    # One answer for "no such account" and "not in your tree": do not confirm that an id exists elsewhere.
    if (
        not target or target.role == "superadmin" or target.account_status != "ACTIVE" or target.is_active is False
        or not (current_user.role == "superadmin" or below_caller)
    ):
        raise HTTPException(status_code=404, detail="Target account not found")

    note = (req.note or "").strip() or None
    results = []
    for pump_id in dict.fromkeys(pid.strip() for pid in req.pump_ids if pid and pid.strip()):
        pump = get_pump_in_scope(db, pump_id, current_user)
        if not pump:
            results.append({"pump_id": pump_id, "success": False, "reason": "Device not found in your account tree"})
            continue
        state = (pump.lifecycle_state or "ACTIVE").upper()
        if state not in STOCK_STATES:
            results.append({
                "pump_id": pump_id, "success": False,
                "reason": f"Device is {state.lower().replace('_', ' ')}; only stock devices can be allocated in bulk",
            })
            continue
        if pump.owner_user_id == target.id:
            results.append({"pump_id": pump_id, "success": False, "reason": "Already allocated to this account"})
            continue
        try:
            with db.begin_nested():
                db.add(AllocationLog(
                    pump_id=pump.id, from_user_id=pump.owner_user_id, to_user_id=target.id,
                    actor_id=current_user.id, note=note,
                ))
                before = {"owner": str(pump.owner_user_id), "hierarchy_path": pump.hierarchy_path, "state": state}
                pump.owner_user_id = target.id
                pump.hierarchy_path = target.hierarchy_path
                # Visibility also follows the organisation: a stale one would leave the previous holder able to see it.
                pump.org_id = getattr(target, "org_id", None)
                if state in ("MANUFACTURED", "IN_STOCK"):
                    pump.lifecycle_state = "ALLOCATED"
                _pump_audit(db, current_user, pump.id, "DEVICE_ALLOCATED", before=before,
                            after={"owner": str(target.id), "hierarchy_path": target.hierarchy_path})
            results.append({"pump_id": pump_id, "success": True})
        except Exception:
            logger.exception("Allocating %s to %s failed", pump_id, target.id)
            results.append({"pump_id": pump_id, "success": False, "reason": "Could not be allocated"})
    db.commit()

    done = sum(1 for r in results if r["success"])
    return {"message": f"{done} of {len(results)} device{'s' if len(results) != 1 else ''} allocated", "results": results}


def _add_months(day: date, months: int) -> date:
    """`day` plus whole calendar months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb)."""
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


@router.get("/{id}/provenance")
def get_pump_provenance(
    id: str,
    current_user: User = Depends(require_roles(INSTALL_ROLES)),
    db: Session = Depends(get_db)
):
    """Who owns the device, where it came from, its warranty, and how it got here (portal Ownership / Diagnostics tabs)."""
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    owner = db.query(User).filter(User.id == pump.owner_user_id).first() if pump.owner_user_id else None

    from_user, to_user, actor = aliased(User), aliased(User), aliased(User)
    allocations = (
        db.query(AllocationLog, from_user.full_name, to_user.full_name, actor.full_name)
        .outerjoin(from_user, from_user.id == AllocationLog.from_user_id)
        .outerjoin(to_user, to_user.id == AllocationLog.to_user_id)
        .outerjoin(actor, actor.id == AllocationLog.actor_id)
        .filter(AllocationLog.pump_id == id)
        .order_by(desc(AllocationLog.occurred_at), desc(AllocationLog.id))
        .all()
    )

    warranty = None
    if pump.warranty_start_date and pump.warranty_period_months:
        ends = _add_months(pump.warranty_start_date, pump.warranty_period_months)
        warranty = {
            "start_date": pump.warranty_start_date.isoformat(),
            "period_months": pump.warranty_period_months,
            "end_date": ends.isoformat(),
            "expired": ends < datetime.utcnow().date(),
        }

    # Only a device that was claimed from a tracked manufacturing batch has one; a hand-registered device has none.
    origin = (
        db.query(BatchImei, DeviceBatch)
        .join(DeviceBatch, DeviceBatch.id == BatchImei.batch_id)
        .filter(BatchImei.pump_id == id)
        .first()
    )

    return {
        "pump_id": id,
        "owner": {
            "id": str(owner.id), "full_name": owner.full_name,
            "phone_number": owner.phone_number or owner.phone, "role": owner.role,
        } if owner else None,
        "allocation_history": [
            {
                "id": str(a.id), "occurred_at": _utc_iso(a.occurred_at), "note": a.note,
                "from_user_id": str(a.from_user_id) if a.from_user_id else None, "from_full_name": from_name,
                "to_user_id": str(a.to_user_id), "to_full_name": to_name,
                "actor_id": str(a.actor_id) if a.actor_id else None, "actor_full_name": actor_name,
            }
            for a, from_name, to_name, actor_name in allocations
        ],
        "warranty": warranty,
        "batch": {
            "imei": origin[0].imei, "mcu_uid": origin[0].mcu_uid, "claimed_at": _utc_iso(origin[0].claimed_at),
            "batch_code": origin[1].batch_code, "model": origin[1].model, "hw_rev": origin[1].hw_rev,
        } if origin else None,
    }

@router.get("/sample-csv/download")
def download_sample_csv():
    file_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "sample_device_import.csv")
    if not os.path.exists(file_path):
        # Fallback inline generation if file missing
        content = "serial,model,hw_rev,batch_id,manufacture_date,supply_type,hp_rating\nPUMP-4G-3P-9001,PCD-A7672S-V1,1.0,BATCH-2026-08,2026-08-15,3P,5.0\n"
        return Response(content=content, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=sample_device_import.csv"})
    return FileResponse(file_path, filename="sample_device_import.csv", media_type="text/csv")

@router.post("/bulk-import")
def bulk_import_pumps(
    file: UploadFile = File(...),
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db)
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Uploaded file must be a .csv file")
    
    contents = file.file.read()
    decoded = contents.decode('utf-8')
    reader = csv.DictReader(io.StringIO(decoded))
    
    imported_count = 0
    skipped_count = 0
    errors = []

    for idx, row in enumerate(reader, start=2):
        serial = row.get("serial", "").strip()
        if not serial:
            errors.append(f"Line {idx}: Missing serial number")
            continue
        
        # Check if already exists
        existing = db.query(Pump).filter(Pump.id == serial).first()
        if existing:
            skipped_count += 1
            continue
        
        raw_st = row.get("supply_type", "3-phase").strip()
        supply_type = "3-phase" if raw_st in ["3P", "3-phase"] else "1-phase"
        try:
            hp = float(row.get("hp_rating", "5.0"))
        except ValueError:
            hp = 5.0

        new_pump = Pump(
            id=serial,
            name=f"Pump {serial}",
            supply_type=supply_type,
            hp_rating=hp,
            owner_user_id=current_user.id,
            hierarchy_path=current_user.hierarchy_path or "/SA",
            latitude=19.9975,
            longitude=73.7898,
            status="STOPPED",
            lifecycle_state="MANUFACTURED",
            firmware_version="1.0.367"
        )
        db.add(new_pump)

        # Create default device config
        db.add(DeviceConfig(
            pump_id=serial,
            desired_json={"ol": 25.0, "ov": 480, "dr": 1, "dr_t": 5},
            status="APPLIED"
        ))

        # Add audit log
        db.add(AuditLog(
            actor_user_id=current_user.id,
            action="BULK_IMPORT_DEVICE",
            target_type="PUMP",
            target_id=serial,
            details=f"Imported from batch {row.get('batch_id', 'N/A')}"
        ))

        imported_count += 1

    db.commit()

    return {
        "success": True,
        "imported_count": imported_count,
        "skipped_count": skipped_count,
        "errors": errors
    }

@router.post("/{id}/claim-credentials")
def generate_claim_credentials(
    id: str,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db)
):
    """Claim credentials come from AWS IoT Fleet Provisioning, which this server is not connected to yet.

    This used to return a made-up certificate and private key. Something that looks like a credential and is not one
    is worse than an honest refusal, so it says what is missing.
    """
    if not db.query(Pump.id).filter(Pump.id == id).first():
        raise HTTPException(status_code=404, detail="Pump not found")
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Claim credentials are issued by AWS IoT Fleet Provisioning, which is not connected to this server yet.",
    )
