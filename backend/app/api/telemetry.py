from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import settings
from app.models import Command, Pump, TelemetryHistory, FaultLog, FaultCodeCatalog
from app.schemas import TelemetryIngest
from app.services.alert_engine import raise_alert
from app.services.ws_hub import ws_hub
from app.services.jwt_auth import verify_secret
from app.api.deps import set_db_actor_context
from app.services import command_service as cs
from app.services.command_dispatch import announce, announcements
from app.services.iot_publisher import build_envelope

router = APIRouter(tags=["Telemetry Ingestion"])

from fastapi import BackgroundTasks

@router.post("")
def ingest_telemetry(
    req: TelemetryIngest,
    request: Request,
    background_tasks: BackgroundTasks,
    x_device_id: Optional[str] = Header(None, alias="X-Device-Id"),
    x_device_key: Optional[str] = Header(None, alias="X-Device-Key"),
    db: Session = Depends(get_db)
):
    pump_id = x_device_id or req.dev_id
    if not pump_id:
        raise HTTPException(status_code=400, detail="Device ID is required")

    set_db_actor_context(db, device_id=pump_id)
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    if not pump:
        raise HTTPException(status_code=404, detail="Pump device not found")

    # A device must prove who it is. Only local development accepts a device that has no key on record yet
    # (the simulator); anywhere else a keyless pump could have its readings, and so its command results, forged.
    if pump.device_key_hash:
        if not x_device_key or not verify_secret(x_device_key, pump.device_key_hash):
            raise HTTPException(status_code=401, detail="Invalid X-Device-Key")
    elif settings.ENV != "development":
        raise HTTPException(status_code=401, detail="Device has no credentials on record")

    # A reading this device already sent (same sequence number) is ignored, exactly as the SQS worker does
    # (FR-CLD-026): a retry after a lost response, or a restart, must not turn into a 500.
    if req.seq is not None and db.query(TelemetryHistory.id).filter(
        TelemetryHistory.pump_id == pump_id, TelemetryHistory.seq == req.seq
    ).first():
        return {"message": "Duplicate reading ignored", "status": pump.status}

    device_type = getattr(pump, "device_type", "AC_3PH") or "AC_3PH"

    # Reject or accept vfd object based on device_type
    if req.vfd is not None:
        if device_type != "SOLAR_VFD":
            raise HTTPException(
                status_code=400,
                detail=f"VFD telemetry is only accepted for SOLAR_VFD pumps (pump '{pump_id}' is {device_type})"
            )
        # Validate ranges
        v = req.vfd
        if v.hz is not None and (v.hz < 0.0 or v.hz > 500.0):
            raise HTTPException(status_code=400, detail="vfd.hz out of range [0.0, 500.0]")
        if v.i_out is not None and (v.i_out < 0.0 or v.i_out > 500.0):
            raise HTTPException(status_code=400, detail="vfd.i_out out of range [0.0, 500.0]")
        if v.v_ac is not None and (v.v_ac < 0.0 or v.v_ac > 1000.0):
            raise HTTPException(status_code=400, detail="vfd.v_ac out of range [0.0, 1000.0]")
        if v.v_dc is not None and (v.v_dc < 0.0 or v.v_dc > 1500.0):
            raise HTTPException(status_code=400, detail="vfd.v_dc out of range [0.0, 1500.0]")
        if v.kw is not None and (v.kw < 0.0 or v.kw > 500.0):
            raise HTTPException(status_code=400, detail="vfd.kw out of range [0.0, 500.0]")
        if v.fault_code is not None and (v.fault_code < 0 or v.fault_code > 9999):
            raise HTTPException(status_code=400, detail="vfd.fault_code out of range [0, 9999]")

    # Timezone-aware: a naive UTC value would be read as local time by a database whose timezone is not UTC.
    now = datetime.now(timezone.utc)
    vl = req.vl or [0.0, 0.0, 0.0]
    i = req.i or [0.0, 0.0, 0.0]
    v_ry = float(vl[0]) if len(vl) > 0 else 0.0
    v_yb = float(vl[1]) if len(vl) > 1 else 0.0
    v_br = float(vl[2]) if len(vl) > 2 else 0.0
    i_r = float(i[0]) if len(i) > 0 else 0.0
    i_y = float(i[1]) if len(i) > 1 else 0.0
    i_b = float(i[2]) if len(i) > 2 else 0.0

    vfd_dict = None
    vfd_hz = None
    vfd_i_out = None
    vfd_v_ac = None
    vfd_v_dc = None
    vfd_kw = None
    vfd_status = None
    vfd_fault_code = None

    if device_type == "SOLAR_VFD" and req.vfd is not None:
        vfd_hz = req.vfd.hz
        vfd_i_out = req.vfd.i_out
        vfd_v_ac = req.vfd.v_ac
        vfd_v_dc = req.vfd.v_dc
        vfd_kw = req.vfd.kw
        vfd_status = req.vfd.status
        vfd_fault_code = req.vfd.fault_code
        vfd_dict = {
            "hz": vfd_hz,
            "i_out": vfd_i_out,
            "v_ac": vfd_v_ac,
            "v_dc": vfd_v_dc,
            "kw": vfd_kw,
            "status": vfd_status,
            "fault_code": vfd_fault_code,
        }

    # Determine motor and fault state
    if req.mot is not None:
        pump_on = bool(req.mot == 1)
    elif vfd_status:
        pump_on = (vfd_status.upper() == "RUNNING")
    elif vfd_hz is not None:
        pump_on = bool(vfd_hz > 0.5)
    else:
        pump_on = False

    effective_fault_code = vfd_fault_code if (vfd_fault_code is not None and vfd_fault_code > 0) else (req.flt if req.flt and req.flt > 0 else None)
    fault_active = bool(effective_fault_code and effective_fault_code > 0)
    # pumps.status only allows RUNNING / STOPPED / FAULT (same rule as the SQS ingestion worker)
    current_status = "FAULT" if fault_active else ("RUNNING" if pump_on else "STOPPED")

    # 1. Insert into telemetry_history (TimescaleDB hypertable)
    telem = TelemetryHistory(
        pump_id=pump_id,
        v_ry=v_ry if (device_type != "SOLAR_VFD" or req.vl) else None,
        v_yb=v_yb if (device_type != "SOLAR_VFD" or req.vl) else None,
        v_br=v_br if (device_type != "SOLAR_VFD" or req.vl) else None,
        i_r=i_r if (device_type != "SOLAR_VFD" or req.i) else None,
        i_y=i_y if (device_type != "SOLAR_VFD" or req.i) else None,
        i_b=i_b if (device_type != "SOLAR_VFD" or req.i) else None,
        vfd_hz=vfd_hz,
        vfd_i_out=vfd_i_out,
        vfd_v_ac=vfd_v_ac,
        vfd_v_dc=vfd_v_dc,
        vfd_kw=vfd_kw,
        vfd_status=vfd_status,
        vfd_fault_code=vfd_fault_code,
        pump_on=pump_on,
        fault_active=fault_active,
        gsm_rssi=req.rssi,
        seq=req.seq,
        recorded_at=now
    )
    db.add(telem)

    # 2. Update pump latest state
    pump.status = current_status
    pump.last_seen_at = now
    if req.rt is not None:
        pump.total_runtime_min = req.rt
    pump_telem_dict = {
        "v_ry": v_ry,
        "v_yb": v_yb,
        "v_br": v_br,
        "i_r": i_r,
        "i_y": i_y,
        "i_b": i_b,
        "pump_on": pump_on,
        "fault_active": fault_active,
        "gsm_rssi": req.rssi,
        "signal_dbm": req.rssi,
        "fault_code": effective_fault_code,
        "total_runtime_min": req.rt,
        "status": current_status,
        "device_type": device_type,
        "vfd": vfd_dict,
        "vfd_hz": vfd_hz,
        "vfd_i_out": vfd_i_out,
        "vfd_v_ac": vfd_v_ac,
        "vfd_v_dc": vfd_v_dc,
        "vfd_kw": vfd_kw,
        "vfd_status": vfd_status,
        "vfd_fault_code": vfd_fault_code,
        "recorded_at": now.isoformat()
    }
    if hasattr(Pump, "last_telemetry"):
        pump.last_telemetry = pump_telem_dict

    # 3. Handle fault condition
    fault_log_id = None
    if fault_active:
        fault_info = db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == effective_fault_code).first()
        f_name = fault_info.name if fault_info else f"Fault {effective_fault_code}"
        f_sev = fault_info.severity if fault_info else "HIGH"

        f_log = FaultLog(
            pump_id=pump_id,
            fault_code=effective_fault_code,
            description=f_name,        # NOT NULL column
            fault_description=f_name,
            v_ry=v_ry,
            v_yb=v_yb,
            v_br=v_br,
            i_r=i_r,
            i_y=i_y,
            i_b=i_b,
            occurred_at=now
        )
        db.add(f_log)
        db.commit()
        db.refresh(f_log)
        fault_log_id = f_log.id

        # Trigger alert engine
        raise_alert(
            db=db,
            pump_id=pump_id,
            alert_type="FAULT",
            severity=f_sev,
            fault_code=effective_fault_code,
            source_fault_log_id=fault_log_id,
            background_tasks=background_tasks
        )

    # A reading that shows the requested motor state settles the START / STOP that asked for it.
    moved_commands = cs.observe_reading(db, pump_id, pump_on if (req.mot is not None or vfd_status or vfd_hz is not None) else None, now)

    h_path = pump.hierarchy_path
    db.commit()
    background_tasks.add_task(announce, announcements(db, moved_commands))

    # 4. Broadcast live update to scoped WebSocket subscribers
    async def _bcast():
        await ws_hub.broadcast_pump_update(pump_id, pump_telem_dict, h_path)
    
    background_tasks.add_task(_bcast)

    return {"message": "Telemetry processed successfully", "status": current_status}


# ---------------------------------------------------------------------------
# Device command channel over HTTP: development and the simulator only.
#
# In production a pump receives commands on MQTT (devices/{id}/commands) and answers on its telemetry topic.
# With IOT_PUBLISH_MODE=outbox there is no broker, so the simulator collects commands here and answers
# with the same ack frame it would publish. Both go through the exact same lifecycle code.
# ---------------------------------------------------------------------------
def _outbox_device(db: Session, x_device_id: Optional[str], x_device_key: Optional[str]) -> Pump:
    if settings.publish_mode() != "outbox":
        raise HTTPException(status_code=404, detail="Not found")
    if not x_device_id:
        raise HTTPException(status_code=400, detail="X-Device-Id is required")
    set_db_actor_context(db, device_id=x_device_id)
    pump = db.query(Pump).filter(Pump.id == x_device_id).first()
    if not pump:
        raise HTTPException(status_code=404, detail="Pump device not found")
    if pump.device_key_hash and (not x_device_key or not verify_secret(x_device_key, pump.device_key_hash)):
        raise HTTPException(status_code=401, detail="Invalid X-Device-Key")
    return pump


@router.get("/commands")
def device_collect_commands(
    background_tasks: BackgroundTasks,
    x_device_id: Optional[str] = Header(None, alias="X-Device-Id"),
    x_device_key: Optional[str] = Header(None, alias="X-Device-Key"),
    db: Session = Depends(get_db),
):
    """Commands sent to this device and not yet collected, as MQTT messages. Collecting marks them DELIVERED."""
    pump = _outbox_device(db, x_device_id, x_device_key)
    now = cs.now_utc()
    rows = (
        db.query(Command)
        .filter(Command.pump_id == pump.id, Command.status == cs.SENT, Command.expires_at > now)
        .order_by(Command.issued_at)
        .all()
    )
    messages = [build_envelope(c) for c in rows]
    moved = [c for c in rows if cs.advance(db, c, cs.DELIVERED, at=now)]
    db.commit()
    background_tasks.add_task(announce, announcements(db, moved))
    return {"commands": messages}


@router.post("/ack")
def device_ack(
    frame: Dict[str, Any],
    background_tasks: BackgroundTasks,
    x_device_id: Optional[str] = Header(None, alias="X-Device-Id"),
    x_device_key: Optional[str] = Header(None, alias="X-Device-Key"),
    db: Session = Depends(get_db),
):
    """A device's answer to a command: {"cmd":"ack","ref":"motor_cmd","ok":1} or a layer-B ack carrying the `cid`."""
    pump = _outbox_device(db, x_device_id, x_device_key)
    if not cs.parse_ack(frame):
        raise HTTPException(status_code=422, detail="Not an ack frame")
    moved = cs.apply_ack(db, pump.id, frame)
    db.commit()
    if moved is not None:
        background_tasks.add_task(announce, announcements(db, [moved]))
    return {"matched": moved is not None, "status": moved.status if moved is not None else None}
