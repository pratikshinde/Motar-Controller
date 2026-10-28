"""
P2.2 — Ingestion Worker
=======================
Consumes telemetry messages from SQS (or a local simulator queue) and:

  1. Normalises both the **legacy MCU raw** format (`vl`, `i`, `mot`, `st`, `flt`, `rt`)
     and the **target v1 enriched envelope** (SRS §6.3 / FR-CON-021) into one internal model.
  2. Enforces FR-SEC-032: rejects any message where `dev_id` ≠ the authenticated IoT
     client_id injected by the IoT Rule (field `clientid` added by AWS IoT topic-rule SQL).
  3. De-duplicates on `(device_id, seq)` when `seq` is present (FR-CLD-026) via the
     UNIQUE INDEX `idx_telemetry_dedup` — INSERT … ON CONFLICT DO NOTHING.
  4. Batch-inserts into `telemetry_history`; updates Redis latest-state
     (`HSET pump:{id}:latest …`); publishes to `pump:{id}` WebSocket channel;
     emits fault events to the alerts engine.
  5. SQS consumer loop — long-poll, visibility timeout, explicit delete on success,
     dead-letter on repeated failure.

Entry point:
    python -m app.workers.ingest

Environment variables consumed (all optional with sane dev defaults):
    SQS_INGEST_URL          — SQS queue URL for telemetry messages
    SQS_BATCH_SIZE          — messages per receive call (max 10, default 10)
    SQS_VISIBILITY_TIMEOUT  — seconds to hide a message while processing (default 60)
    INGEST_BATCH_SIZE       — DB insert batch size (default 50)
    AWS_REGION              — AWS region (default ap-south-1)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import settings
from app.core.logging import setup_structured_logging
from app.database import SessionLocal
from app.models import FaultCodeCatalog, FaultLog, Pump, TelemetryHistory
from app.services.alert_engine import raise_alert
from app.services.cache_service import cache_service
from app.services.command_dispatch import announce as announce_commands, announcements as command_announcements
from app.services.command_service import apply_ack, observe_reading, parse_ack
from app.services.ws_hub import ws_hub

logger = logging.getLogger("agripump.ingest")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# The environment wins; otherwise backend/.env (loaded into `settings`, not into the process environment).
SQS_INGEST_URL: str = os.environ.get("SQS_INGEST_URL") or settings.SQS_INGEST_URL
SQS_BATCH_SIZE: int = int(os.environ.get("SQS_BATCH_SIZE", "10"))
SQS_VISIBILITY_TIMEOUT: int = int(os.environ.get("SQS_VISIBILITY_TIMEOUT", "60"))
INGEST_BATCH_SIZE: int = int(os.environ.get("INGEST_BATCH_SIZE", "50"))
AWS_REGION: str = os.environ.get("AWS_REGION", "ap-south-1")

# ---------------------------------------------------------------------------
# Internal normalised telemetry model
# ---------------------------------------------------------------------------
@dataclass
class NormalisedTelemetry:
    device_id: str
    recorded_at: datetime
    pump_on: bool = False
    fault_active: bool = False
    v_ry: Optional[float] = None
    v_yb: Optional[float] = None
    v_br: Optional[float] = None
    i_r: Optional[float] = None
    i_y: Optional[float] = None
    i_b: Optional[float] = None
    gsm_rssi: Optional[int] = None
    seq: Optional[int] = None
    ts_approx: bool = False
    buffered: bool = False
    fault_code: Optional[int] = None
    runtime_minutes: Optional[int] = None
    # A solar drive's readings (SRS Addendum A1): hz, i_out, v_ac, v_dc, kw, status, fault_code. None for an AC panel.
    vfd: Optional[Dict[str, Any]] = None
    # Raw payload kept for forensics
    raw: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Normaliser — handles both legacy and v1 envelope
# ---------------------------------------------------------------------------
def _safe_float(val: Any) -> Optional[float]:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(val: Any) -> Optional[int]:
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None


# Ranges /api/telemetry enforces for a drive's readings (and what telemetry_history can hold).
_VFD_LIMITS = {"hz": (0.0, 500.0), "i_out": (0.0, 500.0), "v_ac": (0.0, 1000.0), "v_dc": (0.0, 1500.0), "kw": (0.0, 500.0)}


def parse_vfd(raw: Any) -> Optional[Dict[str, Any]]:
    """The `vfd` object of a status frame, cleaned; None when it holds nothing usable.

    /api/telemetry answers 400 to an out-of-range value. A frame that has already travelled through AWS cannot be
    refused, so here the bad value alone is dropped and the rest of the reading is kept.
    """
    if not isinstance(raw, dict):
        return None
    out: Dict[str, Any] = {}
    for key, (low, high) in _VFD_LIMITS.items():
        value = _safe_float(raw.get(key))
        out[key] = value if value is not None and low <= value <= high else None
    status = raw.get("status")
    out["status"] = str(status).strip()[:30] if status not in (None, "") else None
    code = _safe_int(raw.get("fault_code"))
    out["fault_code"] = code if code is not None and 0 <= code <= 9999 else None
    return out if any(value is not None for value in out.values()) else None


def _motor_and_fault(mot: Any, fault: Optional[int], vfd: Optional[Dict[str, Any]]) -> Tuple[bool, Optional[int]]:
    """(motor on, effective fault code or None). The same rules as /api/telemetry.

    A solar drive reports through `vfd`: with no `mot` the drive's own status (RUNNING) or its output frequency decides,
    and a non-zero drive fault code wins over the device's own `flt`."""
    drive = vfd or {}
    if mot is not None:
        on = mot == 1
    elif drive.get("status"):
        on = str(drive["status"]).upper() == "RUNNING"
    elif drive.get("hz") is not None:
        on = drive["hz"] > 0.5
    else:
        on = False
    drive_fault = drive.get("fault_code") or 0
    code = drive_fault if drive_fault > 0 else (fault if fault and fault > 0 else None)
    return bool(on), code


# Uplink frames that only say "I am here" (SRS §6.3). They carry no readings.
LIVENESS_FRAMES = {"heartbeat", "pong", "ping", "net_status", "reg_ack"}


def frame_kind(body: Dict[str, Any]) -> str:
    """What an uplink frame is: `telemetry`, `fault`, `registration`, `liveness` or `unknown`.

    Only `status` frames (and the v1 envelope, which has no `cmd`) carry readings. Storing a heartbeat as a reading
    would put a row of blanks in the history and mark a running pump as stopped. Acks are routed before this.
    A `fault` frame (layer A) or a `TRIP` event (layer B) reports a trip the moment it happens, between status frames.
    """
    if isinstance(body.get("v"), int) and "st" in body:
        return "telemetry"
    cmd = str(body.get("cmd") or "").strip().lower()
    if cmd == "fault" or str(body.get("type") or "").strip().upper() in ("TRIP", "FAULT"):
        return "fault"
    if cmd in ("", "status"):
        return "telemetry"
    if cmd == "reg":
        return "registration"
    if cmd in LIVENESS_FRAMES:
        return "liveness"
    return "unknown"


def parse_fault(body: Dict[str, Any], now: datetime) -> Optional[Tuple[int, Tuple[float, ...], datetime]]:
    """A trip report in either shape, as (code, (v_ry, v_yb, v_br, i_r, i_y, i_b), occurred_at); None if it names no code.

    layer A  {"cmd":"fault","code":5,"desc":"DryRun","vl":[415,0,410],"i":[2,0,2]}
    layer B  {"v":1,"ts":<epoch>,"type":"TRIP","code":5,"name":"DryRun","snapshot":{"vl":[...],"i":[...]}}
    Layer A carries no clock and the device's own is not trusted, so a trip without `ts` is stamped on arrival.
    """
    code = _safe_int(body.get("code"))
    if code is None or not 1 <= code <= 255:
        return None
    snap = body.get("snapshot") if isinstance(body.get("snapshot"), dict) else body
    vl = snap.get("vl") or []
    amps = snap.get("i") or []
    readings = tuple(
        (_safe_float(arr[idx]) or 0.0) if len(arr) > idx else 0.0
        for arr in (vl, amps) for idx in range(3)
    )
    occurred_at = now
    if body.get("ts"):
        try:
            occurred_at = datetime.fromtimestamp(float(body["ts"]), tz=timezone.utc)
        except (OSError, ValueError, OverflowError):
            pass
    return code, readings, occurred_at


def normalise(payload: Dict[str, Any], client_id: str) -> Tuple[NormalisedTelemetry, bool]:
    """
    Normalise raw IoT message payload into NormalisedTelemetry.

    Returns (telemetry, is_spoofed).
    is_spoofed is True when `dev_id` field ≠ `client_id` (FR-SEC-032).
    """
    now = datetime.now(timezone.utc)

    # -----------------------------------------------------------------------
    # Detect envelope version
    # v1 envelope has top-level `v` (int) and nested `st`/`el`/`net` objects.
    # Legacy MCU raw format has top-level `mot`, `vl`, `i`, `flt` directly.
    # -----------------------------------------------------------------------
    is_v1 = isinstance(payload.get("v"), int) and "st" in payload

    if is_v1:
        return _normalise_v1(payload, client_id, now)
    else:
        return _normalise_legacy(payload, client_id, now)


def _normalise_v1(
    p: Dict[str, Any], client_id: str, now: datetime
) -> Tuple[NormalisedTelemetry, bool]:
    """
    Parse v1 enriched envelope (SRS §6.3).

    Schema:
      {"v":1,"id":"<imei>","ts":<epoch>,"seq":<int>,"tsApprox":<bool>,
       "buf":<bool>,
       "st":{"mot":<0|1>,"state":<int>,"fault":<0-10>},
       "el":{"vl":[v_ry,v_yb,v_br],"i":[i_r,i_y,i_b]},
       "rt":{"totalMin":<int>},
       "cfg":{"ol":<int>},
       "net":{"rssi":<dBm>,"op":"<str>","tech":"<str>"}}
    """
    dev_id: str = str(p.get("id", "")).strip()
    spoofed = bool(dev_id and dev_id != client_id)

    ts_epoch = p.get("ts")
    if ts_epoch:
        try:
            recorded_at = datetime.fromtimestamp(float(ts_epoch), tz=timezone.utc)
        except (OSError, ValueError, OverflowError):
            recorded_at = now
    else:
        recorded_at = now

    st = p.get("st") or {}
    el = p.get("el") or {}
    net = p.get("net") or {}
    rt = p.get("rt") or {}

    vl = el.get("vl") or []
    i_arr = el.get("i") or []
    vfd = parse_vfd(p.get("vfd"))
    pump_on, fault_code = _motor_and_fault(st.get("mot"), _safe_int(st.get("fault")), vfd)
    fault_active = fault_code is not None

    return NormalisedTelemetry(
        device_id=client_id,                   # always use the verified client_id
        recorded_at=recorded_at,
        pump_on=pump_on,
        fault_active=fault_active,
        v_ry=_safe_float(vl[0]) if len(vl) > 0 else None,
        v_yb=_safe_float(vl[1]) if len(vl) > 1 else None,
        v_br=_safe_float(vl[2]) if len(vl) > 2 else None,
        i_r=_safe_float(i_arr[0]) if len(i_arr) > 0 else None,
        i_y=_safe_float(i_arr[1]) if len(i_arr) > 1 else None,
        i_b=_safe_float(i_arr[2]) if len(i_arr) > 2 else None,
        gsm_rssi=_safe_int(net.get("rssi")),
        seq=_safe_int(p.get("seq")),
        ts_approx=bool(p.get("tsApprox", False)),
        buffered=bool(p.get("buf", False)),
        fault_code=fault_code,
        runtime_minutes=_safe_int(rt.get("totalMin")),
        vfd=vfd,
        raw=p,
    ), spoofed


def _normalise_legacy(
    p: Dict[str, Any], client_id: str, now: datetime
) -> Tuple[NormalisedTelemetry, bool]:
    """
    Parse legacy MCU raw status format (as currently forwarded verbatim by the bridge).

    Schema:
      {"dev_id":"<imei>","vl":[v_ry,v_yb,v_br],"i":[i_r,i_y,i_b],
       "mot":<0|1>,"st":<int>,"flt":<0-10>,"rt":<total_min>,
       "rssi":<dBm>,"seq":<int>}
    """
    dev_id_field: str = str(p.get("dev_id") or p.get("id") or "").strip()
    spoofed = bool(dev_id_field and dev_id_field != client_id)

    vl = p.get("vl") or []
    i_arr = p.get("i") or []
    vfd = parse_vfd(p.get("vfd"))
    pump_on, fault_code = _motor_and_fault(p.get("mot"), _safe_int(p.get("flt")), vfd)
    fault_active = fault_code is not None

    return NormalisedTelemetry(
        device_id=client_id,
        recorded_at=now,
        pump_on=pump_on,
        fault_active=fault_active,
        v_ry=_safe_float(vl[0]) if len(vl) > 0 else None,
        v_yb=_safe_float(vl[1]) if len(vl) > 1 else None,
        v_br=_safe_float(vl[2]) if len(vl) > 2 else None,
        i_r=_safe_float(i_arr[0]) if len(i_arr) > 0 else None,
        i_y=_safe_float(i_arr[1]) if len(i_arr) > 1 else None,
        i_b=_safe_float(i_arr[2]) if len(i_arr) > 2 else None,
        gsm_rssi=_safe_int(p.get("rssi")),
        seq=_safe_int(p.get("seq")),
        ts_approx=bool(p.get("tsApprox", False)),
        buffered=bool(p.get("buf", False)),
        fault_code=fault_code,
        runtime_minutes=_safe_int(p.get("rt")),
        vfd=vfd,
        raw=p,
    ), spoofed


# ---------------------------------------------------------------------------
# DB ingest — batch insert + pump state update
# ---------------------------------------------------------------------------
def _compute_status(t: NormalisedTelemetry) -> str:
    if t.fault_active:
        return "FAULT"
    if t.pump_on:
        return "RUNNING"
    return "STOPPED"


def _update_redis_latest(pump_id: str, snapshot: Dict[str, Any]) -> None:
    """
    HSET pump:{id}:latest <fields…>  (FR-CLD-026 / live-state cache).
    Falls back silently if Redis is unavailable.
    """
    try:
        if cache_service._redis:
            mapping = {k: str(v) for k, v in snapshot.items() if v is not None}
            cache_service._redis.hset(f"pump:{pump_id}:latest", mapping=mapping)
    except Exception as exc:
        logger.debug("Redis HSET failed for pump %s: %s", pump_id, exc)


async def process_batch(messages: List[Dict[str, Any]]) -> List[str]:
    """
    Process a batch of raw SQS messages.

    Returns list of SQS receipt handles that were processed successfully
    (so the caller can delete them).

    Each SQS message body is a JSON object with:
      - `clientid`: added by the IoT Rule SQL (verified device identity)
      - The rest is the device payload.
    """
    handled_receipts: List[str] = []
    telemetry_rows: List[TelemetryHistory] = []
    fault_events: List[Tuple[str, int, str, float, float, float, float, float, float]] = []
    pump_updates: Dict[str, Tuple[str, str, Dict[str, Any]]] = {}  # pump_id → (status, h_path, snapshot)
    readings: List[Tuple[str, bool, bool]] = []   # (pump_id, pump_on, buffered): what settles START / STOP commands
    moved_commands: List[Any] = []                # commands whose state changed because of this batch
    command_events: List[Any] = []                # their WebSocket announcements, built before the session closes

    db: Session = SessionLocal()
    try:
        # The ingest worker is a system process (not a user request). Set bypass_rls
        # so the RLS policies don't block device lookups and telemetry inserts.
        from sqlalchemy import text as _sa_text
        db.execute(_sa_text("SET app.bypass_rls = 'on';"))

        for msg in messages:
            receipt = msg.get("ReceiptHandle", "")
            body_raw = msg.get("Body", "{}")
            try:
                body = json.loads(body_raw)
            except json.JSONDecodeError:
                logger.warning("Malformed JSON in SQS message, skipping: %s", body_raw[:200])
                continue

            # client_id injected by IoT Rule (FR-SEC-032)
            client_id: str = str(body.get("clientid") or body.get("dev_id") or "").strip()
            if not client_id:
                logger.warning("Message missing clientid, skipping")
                continue

            # A pump's answer to a command is not telemetry: route it to the command it belongs to.
            if parse_ack(body):
                moved = apply_ack(db, client_id, body)
                if moved is not None:
                    moved_commands.append(moved)
                handled_receipts.append(receipt)
                continue

            kind = frame_kind(body)
            if kind in ("registration", "liveness"):
                # Proof of life, no readings: it refreshes "last seen" (and a registration's firmware version) and is
                # never a telemetry row. A registration carries the MCU's own id in `dev_id`, so the identity check
                # below does not apply to it; who sent it is the verified client id.
                alive = db.query(Pump).filter(Pump.id == client_id).first()
                if alive:
                    alive.last_seen_at = datetime.now(timezone.utc)
                    if kind == "registration" and body.get("fw"):
                        alive.firmware_version = str(body["fw"]).strip()[:20]
                handled_receipts.append(receipt)
                continue
            if kind == "unknown":
                logger.warning("Ignoring '%s' frame from '%s': not a reading", body.get("cmd"), client_id)
                handled_receipts.append(receipt)
                continue
            if kind == "fault":
                # A trip arrives on its own topic the moment it happens; waiting for the next status frame would
                # delay the alert by up to the idle reporting interval (300 s). It is a fault, not a reading: no
                # telemetry row, and the pump's latest readings stay as the last status frame left them.
                claimed_id = str(body.get("dev_id") or body.get("id") or "").strip()
                if claimed_id and claimed_id != client_id:       # FR-SEC-032, as for readings
                    logger.warning("FR-SEC-032 violation: fault dev_id='%s' != client_id='%s' — rejected", claimed_id, client_id)
                    handled_receipts.append(receipt)
                    continue
                trip = parse_fault(body, datetime.now(timezone.utc))
                trip_pump = db.query(Pump).filter(Pump.id == client_id).first()
                if trip is None:
                    logger.warning("Ignoring fault frame from '%s': no usable code", client_id)
                elif not trip_pump:
                    logger.warning("Unknown device '%s', skipping its fault", client_id)
                elif trip_pump.status in ("SUSPENDED", "RETIRED", "RMA"):
                    logger.info("Ignoring fault from %s device '%s'", trip_pump.status, client_id)
                elif not db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == trip[0]).first():
                    # The code must be in the catalog (SRS 6.2 FR-CON-033): a code nobody has defined has no severity
                    logger.warning("Fault code %s from '%s' is not in the catalog, skipped", trip[0], client_id)
                else:
                    code, (v_ry, v_yb, v_br, i_r, i_y, i_b), occurred_at = trip
                    fault_events.append((client_id, code, v_ry, v_yb, v_br, i_r, i_y, i_b, occurred_at))
                    trip_pump.status = "FAULT"
                    trip_pump.last_seen_at = datetime.now(timezone.utc)
                handled_receipts.append(receipt)
                continue

            telem, spoofed = normalise(body, client_id)

            # FR-SEC-032: reject spoofed dev_id
            if spoofed:
                logger.warning(
                    "FR-SEC-032 violation: dev_id='%s' != client_id='%s' — message rejected",
                    body.get("dev_id") or body.get("id"),
                    client_id,
                )
                # Still count as handled so we delete it from SQS (do not reprocess)
                handled_receipts.append(receipt)
                continue

            # Verify pump exists
            pump = db.query(Pump).filter(Pump.id == telem.device_id).first()
            if not pump:
                logger.warning("Unknown device '%s', skipping", telem.device_id)
                handled_receipts.append(receipt)
                continue

            # Reject commands for suspended/retired/RMA devices (defensive — ingestion side)
            if pump.status in ("SUSPENDED", "RETIRED", "RMA"):
                logger.info(
                    "Ignoring telemetry from %s device '%s'",
                    pump.status, telem.device_id,
                )
                handled_receipts.append(receipt)
                continue

            # A drive's readings belong to a solar pump only, as in /api/telemetry
            device_type = getattr(pump, "device_type", "AC_3PH") or "AC_3PH"
            if telem.vfd is not None and device_type != "SOLAR_VFD":
                logger.warning("Ignoring the vfd readings from '%s': it is a %s pump, not SOLAR_VFD", telem.device_id, device_type)
                telem.vfd = None
            drive = telem.vfd or {}

            # Build ORM row; ON CONFLICT DO NOTHING handles dedup (FR-CLD-026)
            row = TelemetryHistory(
                pump_id=telem.device_id,
                v_ry=telem.v_ry,
                v_yb=telem.v_yb,
                v_br=telem.v_br,
                i_r=telem.i_r,
                i_y=telem.i_y,
                i_b=telem.i_b,
                vfd_hz=drive.get("hz"),
                vfd_i_out=drive.get("i_out"),
                vfd_v_ac=drive.get("v_ac"),
                vfd_v_dc=drive.get("v_dc"),
                vfd_kw=drive.get("kw"),
                vfd_status=drive.get("status"),
                vfd_fault_code=drive.get("fault_code"),
                pump_on=telem.pump_on,
                fault_active=telem.fault_active,
                gsm_rssi=telem.gsm_rssi,
                seq=telem.seq,
                ts_approx=telem.ts_approx,
                buffered=telem.buffered,
                recorded_at=telem.recorded_at,
            )
            telemetry_rows.append(row)

            status = _compute_status(telem)
            snapshot = {
                "pump_id": telem.device_id,
                "v_ry": telem.v_ry,
                "v_yb": telem.v_yb,
                "v_br": telem.v_br,
                "i_r": telem.i_r,
                "i_y": telem.i_y,
                "i_b": telem.i_b,
                "pump_on": telem.pump_on,
                "fault_active": telem.fault_active,
                "gsm_rssi": telem.gsm_rssi,
                "signal_dbm": telem.gsm_rssi,
                "fault_code": telem.fault_code if telem.fault_active else None,
                # Cumulative run time as the device reports it; buffered (replayed) rows are old.
                "total_runtime_min": None if telem.buffered else telem.runtime_minutes,
                "status": status,
                "device_type": device_type,
                # The same keys /api/telemetry broadcasts, so a solar pump's live card updates from either path
                "vfd": telem.vfd,
                "vfd_hz": drive.get("hz"),
                "vfd_i_out": drive.get("i_out"),
                "vfd_v_ac": drive.get("v_ac"),
                "vfd_v_dc": drive.get("v_dc"),
                "vfd_kw": drive.get("kw"),
                "vfd_status": drive.get("status"),
                "vfd_fault_code": drive.get("fault_code"),
                "recorded_at": telem.recorded_at.isoformat(),
            }
            pump_updates[telem.device_id] = (status, pump.hierarchy_path, snapshot)
            readings.append((telem.device_id, bool(telem.pump_on), bool(telem.buffered)))

            if telem.fault_active and telem.fault_code is not None:
                fault_events.append((
                    telem.device_id, telem.fault_code,
                    telem.v_ry or 0.0, telem.v_yb or 0.0, telem.v_br or 0.0,
                    telem.i_r or 0.0, telem.i_y or 0.0, telem.i_b or 0.0,
                    telem.recorded_at,
                ))

            handled_receipts.append(receipt)

        # ------------------------------------------------------------------
        # Batch insert into telemetry_history (ON CONFLICT DO NOTHING dedup)
        # ------------------------------------------------------------------
        if telemetry_rows:
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from app.models import TelemetryHistory as TH
            values = [
                {c.key: getattr(row, c.key) for c in TH.__table__.columns if c.key != "id"}
                for row in telemetry_rows
            ]
            stmt = pg_insert(TH.__table__).values(values)
            stmt = stmt.on_conflict_do_nothing(
                index_elements=None,
                index_where=None,
                constraint=None,
            )
            # Use raw text for the partial-index conflict target
            from sqlalchemy import text as sa_text
            db.execute(
                sa_text("""
                    INSERT INTO agripump.telemetry_history
                        (pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b,
                         vfd_hz, vfd_i_out, vfd_v_ac, vfd_v_dc, vfd_kw, vfd_status, vfd_fault_code,
                         pump_on, fault_active, gsm_rssi, seq, ts_approx, buffered, recorded_at)
                    VALUES
                        (:pump_id, :v_ry, :v_yb, :v_br, :i_r, :i_y, :i_b,
                         :vfd_hz, :vfd_i_out, :vfd_v_ac, :vfd_v_dc, :vfd_kw, :vfd_status, :vfd_fault_code,
                         :pump_on, :fault_active, :gsm_rssi, :seq, :ts_approx, :buffered, :recorded_at)
                    ON CONFLICT (pump_id, seq) WHERE seq IS NOT NULL
                    DO NOTHING
                """),
                values,
            )
            logger.info("Inserted/skipped %d telemetry rows", len(values))

        # ------------------------------------------------------------------
        # Update pump latest state + Redis
        # ------------------------------------------------------------------
        for pump_id, (status, h_path, snapshot) in pump_updates.items():
            pump = db.query(Pump).filter(Pump.id == pump_id).with_for_update(skip_locked=True).first()
            if pump:
                pump.status = status
                pump.last_seen_at = datetime.now(timezone.utc)
                if snapshot.get("total_runtime_min") is not None:
                    pump.total_runtime_min = snapshot["total_runtime_min"]
            _update_redis_latest(pump_id, snapshot)

        # ------------------------------------------------------------------
        # Handle fault events (deduplicated by alert engine)
        # ------------------------------------------------------------------
        fault_log_ids: List[int] = []
        for (pump_id, fault_code, v_ry, v_yb, v_br, i_r, i_y, i_b, occurred_at) in fault_events:
            fault_info = db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == fault_code).first()
            f_name = fault_info.name if fault_info else f"Fault {fault_code}"
            f_sev = fault_info.severity if fault_info else "HIGH"

            f_log = FaultLog(
                pump_id=pump_id,
                fault_code=fault_code,
                description=f_name,       # NOT NULL column
                fault_description=f_name,
                v_ry=v_ry, v_yb=v_yb, v_br=v_br,
                i_r=i_r, i_y=i_y, i_b=i_b,
                occurred_at=occurred_at,
            )
            db.add(f_log)
            db.flush()
            fault_log_ids.append((pump_id, f_sev, fault_code, f_log.id))

        # A reading that shows the requested motor state settles the START / STOP that asked for it.
        # Timed by when we received it: the device's own clock is not trusted to compare with ours.
        received_at = datetime.now(timezone.utc)
        for pump_id, pump_on, buffered in readings:
            moved_commands.extend(observe_reading(db, pump_id, pump_on, received_at, buffered=buffered))

        db.commit()
        command_events = command_announcements(db, moved_commands)

        # Alert engine (async) — runs after commit so fault_log rows are visible
        for (pump_id, severity, fault_code, fault_log_id) in fault_log_ids:
            raise_alert(
                db=db,
                pump_id=pump_id,
                alert_type="FAULT",
                severity=severity,
                fault_code=fault_code,
                source_fault_log_id=fault_log_id,
            )

    except Exception as exc:
        logger.exception("Batch processing failed, rolling back: %s", exc)
        db.rollback()
        # Return empty — none of this batch counted as successfully handled
        return []
    finally:
        db.close()

    # ------------------------------------------------------------------
    # WebSocket fan-out (after DB commit, best-effort)
    # ------------------------------------------------------------------
    for pump_id, (status, h_path, snapshot) in pump_updates.items():
        try:
            await ws_hub.broadcast_pump_update(pump_id, snapshot, h_path)
        except Exception as exc:
            logger.warning("WS broadcast failed for pump %s: %s", pump_id, exc)
    await announce_commands(command_events)

    return handled_receipts


# ---------------------------------------------------------------------------
# SQS consumer loop
# ---------------------------------------------------------------------------
async def _sqs_consumer_loop() -> None:
    """
    Long-poll SQS for telemetry messages and process them in batches.
    Requires boto3 and SQS_INGEST_URL to be set.
    """
    from app.services.iot_publisher import apply_network_preference

    apply_network_preference()  # IOT_FORCE_IPV4: no 20 s wait for IPv6 on a network without it
    try:
        import boto3  # type: ignore
    except ImportError:
        logger.error("boto3 is not installed. Run: pip install boto3")
        return

    if not SQS_INGEST_URL:
        logger.error("SQS_INGEST_URL is not set. Cannot start consumer.")
        return

    sqs = boto3.client("sqs", region_name=AWS_REGION)
    logger.info("SQS ingest consumer started. Queue: %s", SQS_INGEST_URL)

    while True:
        try:
            response = sqs.receive_message(
                QueueUrl=SQS_INGEST_URL,
                MaxNumberOfMessages=SQS_BATCH_SIZE,
                WaitTimeSeconds=20,                   # long-poll
                VisibilityTimeout=SQS_VISIBILITY_TIMEOUT,
            )
            messages = response.get("Messages", [])
            if not messages:
                continue

            logger.debug("Received %d messages from SQS", len(messages))
            t0 = time.monotonic()
            handled = await process_batch(messages)
            elapsed_ms = (time.monotonic() - t0) * 1000
            logger.info(
                "Processed %d/%d messages in %.1fms",
                len(handled), len(messages), elapsed_ms,
            )

            # Delete successfully processed messages
            if handled:
                receipts_set = set(handled)
                to_delete = [
                    {"Id": str(i), "ReceiptHandle": m["ReceiptHandle"]}
                    for i, m in enumerate(messages)
                    if m["ReceiptHandle"] in receipts_set
                ]
                if to_delete:
                    sqs.delete_message_batch(QueueUrl=SQS_INGEST_URL, Entries=to_delete)

        except KeyboardInterrupt:
            logger.info("Ingest worker shutting down.")
            break
        except Exception as exc:
            logger.exception("SQS receive error: %s", exc)
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    setup_structured_logging()
    logger.info("Starting AgriPump ingest worker (P2.2)")
    asyncio.run(_sqs_consumer_loop())


if __name__ == "__main__":
    main()
