from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Pump, TelemetryHistory, FaultLog, FaultCodeCatalog
from app.schemas import TelemetryIngest
from app.services.alert_engine import raise_alert
from app.services.ws_hub import ws_hub
from app.services.jwt_auth import verify_secret

router = APIRouter(tags=["Telemetry Ingestion"])

@router.post("")
async def ingest_telemetry(
    req: TelemetryIngest,
    request: Request,
    x_device_id: Optional[str] = Header(None, alias="X-Device-Id"),
    x_device_key: Optional[str] = Header(None, alias="X-Device-Key"),
    db: Session = Depends(get_db)
):
    pump_id = x_device_id or req.dev_id
    if not pump_id:
        raise HTTPException(status_code=400, detail="Device ID is required")

    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    if not pump:
        raise HTTPException(status_code=404, detail="Pump device not found")

    # If device has a key configured, verify it
    if pump.device_key_hash:
        if not x_device_key or not verify_secret(x_device_key, pump.device_key_hash):
            raise HTTPException(status_code=401, detail="Invalid X-Device-Key")

    now = datetime.utcnow()
    vl = req.vl or [0.0, 0.0, 0.0]
    i = req.i or [0.0, 0.0, 0.0]
    v_ry = float(vl[0]) if len(vl) > 0 else 0.0
    v_yb = float(vl[1]) if len(vl) > 1 else 0.0
    v_br = float(vl[2]) if len(vl) > 2 else 0.0
    i_r = float(i[0]) if len(i) > 0 else 0.0
    i_y = float(i[1]) if len(i) > 1 else 0.0
    i_b = float(i[2]) if len(i) > 2 else 0.0

    pump_on = bool(req.mot == 1) if req.mot is not None else False
    fault_active = bool(req.flt and req.flt > 0)
    current_status = "FAULT" if fault_active else ("RUNNING" if pump_on else "IDLE")

    # 1. Insert into telemetry_history (TimescaleDB hypertable)
    telem = TelemetryHistory(
        pump_id=pump_id,
        v_ry=v_ry,
        v_yb=v_yb,
        v_br=v_br,
        i_r=i_r,
        i_y=i_y,
        i_b=i_b,
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
        "recorded_at": now.isoformat()
    }
    if hasattr(Pump, "last_telemetry"):
        pump.last_telemetry = pump_telem_dict

    # 3. Handle fault condition
    fault_log_id = None
    if fault_active:
        fault_info = db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == req.flt).first()
        f_name = fault_info.name if fault_info else f"Fault {req.flt}"
        f_sev = fault_info.severity if fault_info else "HIGH"

        f_log = FaultLog(
            pump_id=pump_id,
            fault_code=req.flt,
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
        await raise_alert(
            db=db,
            pump_id=pump_id,
            alert_type="FAULT",
            severity=f_sev,
            fault_code=req.flt,
            source_fault_log_id=fault_log_id
        )

    db.commit()

    # 4. Broadcast live update to scoped WebSocket subscribers
    await ws_hub.broadcast_pump_update(pump_id, pump_telem_dict, pump.hierarchy_path)

    return {"message": "Telemetry processed successfully", "status": current_status}
