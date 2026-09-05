from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status, File, UploadFile, Response
from fastapi.responses import FileResponse
import csv
import io
import os
from sqlalchemy.orm import Session
from sqlalchemy import desc, text, func
from app.database import get_db
from app.models import (
    Pump, DeviceConfig, Command, TelemetryHistory, FaultLog,
    AllocationLog, AuditLog, ConfigTemplate, Panel, User,
    Alert, AlertSubscription, BatchImei
)
from app.schemas import (
    PumpCreate, PumpUpdate, PumpLocationUpdate, PumpWarrantyUpdate,
    PumpLifecycleUpdate, CommandRequest, BridgeSwapRequest,
    ApplyTemplateRequest, TimerConfigRequest
)
from app.api.deps import get_current_user, require_roles, get_pump_in_scope
from app.services.command_service import check_command_cooldown, create_command
from app.services.ws_hub import ws_hub

router = APIRouter(tags=["Pumps & Devices"])

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
        "latitude": float(pump.latitude) if pump.latitude is not None else 0.0,
        "longitude": float(pump.longitude) if pump.longitude is not None else 0.0,
        "status": pump.status or "IDLE",
        "lifecycle_state": pump.lifecycle_state or "ACTIVE",
        "firmware_version": pump.firmware_version or "1.0.367",
        "panel_serial": getattr(pump, "panel_serial", None),
        "warranty_start_at": w_start.isoformat() if (w_start and hasattr(w_start, 'isoformat')) else None,
        "warranty_period_months": getattr(pump, "warranty_period_months", None),
        "last_seen_at": last_seen.isoformat() if (last_seen and hasattr(last_seen, 'isoformat')) else None,
        "created_at": created.isoformat() if (created and hasattr(created, 'isoformat')) else None,
    }
    # Attach telemetry if available
    if latest_telem:
        res.update(latest_telem)
    elif getattr(pump, "last_telemetry", None):
        res.update(pump.last_telemetry)
    return res

@router.get("")
def list_pumps(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Pump)

    # Scoping
    if current_user.role == "customer":
        query = query.filter(Pump.owner_user_id == current_user.id)
    elif current_user.role != "superadmin":
        query = query.filter(Pump.hierarchy_path.startswith(current_user.hierarchy_path))

    if search:
        s = f"%{search.strip()}%"
        query = query.filter((Pump.name.ilike(s)) | (Pump.id.ilike(s)))

    if status_filter:
        query = query.filter(Pump.status == status_filter)

    total = query.count()
    pumps = query.order_by(Pump.name.asc()).offset((page - 1) * limit).limit(limit).all()

    # Retrieve latest telemetry for these pumps
    pump_ids = [p.id for p in pumps]
    telemetry_map = {}
    if pump_ids:
        # Query latest telemetry using DISTINCT ON
        stmt = text("""
            SELECT DISTINCT ON (pump_id)
                pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, gsm_rssi, recorded_at
            FROM agripump.telemetry_history
            WHERE pump_id = ANY(:p_ids)
            ORDER BY pump_id, recorded_at DESC
        """)
        rows = db.execute(stmt, {"p_ids": pump_ids}).fetchall()
        for r in rows:
            telemetry_map[r[0]] = {
                "v_ry": float(r[1]) if r[1] is not None else None,
                "v_yb": float(r[2]) if r[2] is not None else None,
                "v_br": float(r[3]) if r[3] is not None else None,
                "i_r": float(r[4]) if r[4] is not None else None,
                "i_y": float(r[5]) if r[5] is not None else None,
                "i_b": float(r[6]) if r[6] is not None else None,
                "gsm_rssi": r[7],
                "recorded_at": r[8].isoformat() if r[8] else None,
            }

    data = [format_pump(p, telemetry_map.get(p.id)) for p in pumps]

    # Calculate fleet overview stats
    meta_stats = {
        "total": total,
        "running": db.query(Pump).filter(Pump.status == "RUNNING").count(),
        "fault": db.query(Pump).filter(Pump.status == "FAULT").count(),
        "offline": db.query(Pump).filter(Pump.status == "OFFLINE").count(),
    }

    return {
        "pumps": data,
        "data": data,
        "meta": {
            "total": total,
            "page": page,
            "limit": limit,
            "stats": meta_stats
        }
    }

@router.get("/{id}")
def get_pump(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found or out of scope")

    latest_telem = (
        db.query(TelemetryHistory)
        .filter(TelemetryHistory.pump_id == id)
        .order_by(desc(TelemetryHistory.recorded_at))
        .first()
    )
    telem_dict = None
    if latest_telem:
        telem_dict = {
            "v_ry": float(latest_telem.v_ry) if latest_telem.v_ry is not None else None,
            "v_yb": float(latest_telem.v_yb) if latest_telem.v_yb is not None else None,
            "v_br": float(latest_telem.v_br) if latest_telem.v_br is not None else None,
            "i_r": float(latest_telem.i_r) if latest_telem.i_r is not None else None,
            "i_y": float(latest_telem.i_y) if latest_telem.i_y is not None else None,
            "i_b": float(latest_telem.i_b) if latest_telem.i_b is not None else None,
            "gsm_rssi": latest_telem.gsm_rssi,
            "recorded_at": latest_telem.recorded_at.isoformat() if latest_telem.recorded_at else None,
        }

    open_fault_count = (
        db.query(func.count(FaultLog.id))
        .filter(FaultLog.pump_id == id, FaultLog.ack_at.is_(None))
        .scalar() or 0
    )

    formatted = format_pump(pump, telem_dict)
    return {
        "pump": formatted,
        "latest_telemetry": telem_dict,
        "config": None,
        "open_fault_count": open_fault_count
    }

@router.delete("/{id}")
def delete_pump(
    id: str,
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        existing = db.query(Pump).filter(Pump.id == req.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Pump with this ID already exists")

        h_path = (current_user.hierarchy_path if current_user and current_user.hierarchy_path else "/SA")
        u_id = current_user.id if current_user else None

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
            latitude=req.latitude if req.latitude is not None else 19.9975,
            longitude=req.longitude if req.longitude is not None else 73.7898,
            status="STOPPED",
            lifecycle_state="ACTIVE",
            firmware_version="1.0.367"
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
        formatted["device_key"] = f"DEV_KEY_{req.id}_8821"
        return formatted
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("❌ [CREATE PUMP ERROR]:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Create pump error: {str(e)}")

@router.post("/{id}/command")
async def send_pump_command(
    id: str,
    req: CommandRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    can_exec, cooldown_rem = check_command_cooldown(db, id)
    if not can_exec:
        raise HTTPException(
            status_code=429,
            detail=f"Command cooldown active. Please wait {cooldown_rem}s."
        )

    cmd = create_command(db, id, req.action_name, req.payload, current_user.id)

    # Broadcast command status
    cmd_data = {
        "cid": str(cmd.cid),
        "command": cmd.command,
        "status": cmd.status,
        "created_at": cmd.created_at.isoformat()
    }
    await ws_hub.broadcast_command_update(id, cmd_data, pump.hierarchy_path)

    return {"message": "Command dispatched successfully", "command": cmd_data}

@router.post("/{id}/timer")
async def set_pump_timer(
    id: str,
    req: TimerConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    can_exec, cooldown_rem = check_command_cooldown(db, id)
    if not can_exec:
        raise HTTPException(
            status_code=429,
            detail=f"Command cooldown active. Please wait {cooldown_rem}s."
        )

    timer_payload = {
        "on_duration_minutes": req.on_duration_minutes,
        "off_duration_minutes": req.off_duration_minutes or 0,
        "cycle_count": req.cycle_count or 1,
        "mode": req.mode or "ON_TIMER"
    }

    cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).first()
    if not cfg:
        cfg = DeviceConfig(pump_id=id, desired_json={"timer": timer_payload}, status="PENDING")
        db.add(cfg)
    else:
        current_desired = dict(cfg.desired_json or {})
        current_desired["timer"] = timer_payload
        cfg.desired_json = current_desired
        cfg.status = "PENDING"

    cmd = create_command(db, id, "SET_TIMER", timer_payload, current_user.id)

    cmd_data = {
        "cid": str(cmd.cid),
        "command": cmd.command,
        "payload": timer_payload,
        "status": cmd.status,
        "created_at": cmd.created_at.isoformat()
    }
    await ws_hub.broadcast_command_update(id, cmd_data, pump.hierarchy_path)

    return {
        "message": "Timer configuration updated and command dispatched",
        "timer": timer_payload,
        "command": cmd_data
    }

@router.get("/{id}/telemetry")
def get_pump_telemetry(
    id: str,
    limit: int = Query(500, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    # Time-series telemetry points from TimescaleDB / telemetry_history
    records = (
        db.query(TelemetryHistory)
        .filter(TelemetryHistory.pump_id == id)
        .order_by(desc(TelemetryHistory.recorded_at))
        .limit(limit)
        .all()
    )
    # Return chronologically ascending
    records.reverse()
    return [
        {
            "id": r.id,
            "v_ry": float(r.v_ry) if r.v_ry is not None else None,
            "v_yb": float(r.v_yb) if r.v_yb is not None else None,
            "v_br": float(r.v_br) if r.v_br is not None else None,
            "i_r": float(r.i_r) if r.i_r is not None else None,
            "i_y": float(r.i_y) if r.i_y is not None else None,
            "i_b": float(r.i_b) if r.i_b is not None else None,
            "pump_on": r.pump_on,
            "fault_active": r.fault_active,
            "gsm_rssi": r.gsm_rssi,
            "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
        }
        for r in records
    ]

@router.get("/{id}/faults")
def get_pump_faults(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        pump = get_pump_in_scope(db, id, current_user)
        if not pump:
            raise HTTPException(status_code=404, detail="Pump not found")

        logs = (
            db.query(FaultLog)
            .filter(FaultLog.pump_id == id)
            .order_by(desc(FaultLog.occurred_at))
            .limit(100)
            .all()
        )
        return [
            {
                "id": log.id,
                "fault_code": log.fault_code,
                "fault_description": log.fault_description,
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
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Faults fetch error: {str(e)}")

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
async def update_pump_config(
    id: str,
    desired_config: dict,
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

    await ws_hub.broadcast_config_update(id, {"status": "PENDING", "desired": desired_config}, pump.hierarchy_path)

    return {"message": "Desired configuration saved", "status": "PENDING"}

@router.post("/{id}/config/report")
async def report_pump_config(
    id: str,
    reported_config: dict,
    db: Session = Depends(get_db)
):
    cfg = db.query(DeviceConfig).filter(DeviceConfig.pump_id == id).first()
    if not cfg:
        cfg = DeviceConfig(pump_id=id)
        db.add(cfg)

    cfg.reported_json = reported_config
    cfg.status = "APPLIED"
    cfg.updated_at = datetime.utcnow()
    db.commit()

    pump = db.query(Pump).filter(Pump.id == id).first()
    h_path = pump.hierarchy_path if pump else None
    await ws_hub.broadcast_config_update(id, {"status": "APPLIED", "reported": reported_config}, h_path)

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
    pump.warranty_start_at = req.warranty_start_at
    pump.warranty_end_at = req.warranty_end_at
    db.commit()
    return {"message": "Warranty updated"}

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
    pump.lifecycle_state = req.lifecycle_state
    db.commit()
    return {"message": f"Lifecycle transitioned to {req.lifecycle_state}"}

@router.get("/{id}/provenance")
def get_pump_provenance(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    pump = get_pump_in_scope(db, id, current_user)
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    allocations = (
        db.query(AllocationLog)
        .filter(AllocationLog.pump_id == id)
        .order_by(desc(AllocationLog.occurred_at))
        .all()
    )
    return {
        "pump_id": id,
        "current_owner": str(pump.owner_user_id) if pump.owner_user_id else None,
        "chain_of_custody": [
            {
                "id": a.id,
                "from_user": str(a.from_user_id) if a.from_user_id else None,
                "to_user": str(a.to_user_id),
                "actor": str(a.actor_user_id),
                "occurred_at": a.occurred_at.isoformat() if a.occurred_at else None,
                "note": a.note
            }
            for a in allocations
        ]
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
async def bulk_import_pumps(
    file: UploadFile = File(...),
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db)
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Uploaded file must be a .csv file")
    
    contents = await file.read()
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
    pump = db.query(Pump).filter(Pump.id == id).first()
    if not pump:
        raise HTTPException(status_code=404, detail="Pump not found")

    claim_package = {
        "device_id": pump.id,
        "claim_certificate_pem": f"-----BEGIN CERTIFICATE-----\nCLAIM_CERT_{pump.id}_MOCK_PEM_DATA_FOR_PROVISIONING\n-----END CERTIFICATE-----",
        "claim_private_key_pem": f"-----BEGIN RSA PRIVATE KEY-----\nCLAIM_KEY_{pump.id}_MOCK_KEY_DATA\n-----END RSA PRIVATE KEY-----",
        "aws_iot_endpoint": "ap-south-1.amazonaws.com",
        "thing_group": "production_agri_pumps",
        "provisioning_template": "AgriPumpProvisioningByClaimTemplate"
    }

    # Record audit log
    db.add(AuditLog(
        actor_user_id=current_user.id,
        action="GENERATE_CLAIM_CREDENTIALS",
        target_type="PUMP",
        target_id=pump.id,
        details="Generated Fleet Provisioning Claim Certificate Package"
    ))
    db.commit()

    return claim_package

