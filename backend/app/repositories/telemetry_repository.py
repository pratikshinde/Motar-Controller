from typing import Optional, List, Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.models import TelemetryHistory, User
from app.repositories.pump_repository import PumpRepository

class TelemetryRepository:
    """
    Repository for telemetry operations with tenant scoping.
    """

    def __init__(self, actor: User, db: Session):
        self.actor = actor
        self.db = db
        self.pump_repo = PumpRepository.for_actor(actor=actor, db=db)

    @classmethod
    def for_actor(cls, actor: User, db: Session) -> "TelemetryRepository":
        return cls(actor=actor, db=db)

    def get_history(
        self,
        pump_id: str,
        limit: int = 100,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> Optional[List[TelemetryHistory]]:
        """
        Fetch telemetry history for a specific pump.
        Returns None if pump is not within actor's scope.
        """
        pump = self.pump_repo.get_by_id(pump_id)
        if not pump:
            return None

        query = self.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id == pump_id)
        if start_time:
            query = query.filter(TelemetryHistory.recorded_at >= start_time)
        if end_time:
            query = query.filter(TelemetryHistory.recorded_at <= end_time)

        return query.order_by(TelemetryHistory.recorded_at.desc()).limit(limit).all()

    def get_latest_telemetry_map(self, pump_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Latest telemetry per pump (filtered to the actor's scope), with the live fields the
        farmer app renders: motor state, open fault code, signal, and run time today.

        - fault_code: only while the latest reading reports a fault, taken from the newest
          unresolved fault log (falling back to the newest unresolved alert). Never guessed.
        - runtime_today_min: running rows since local midnight (IST), one row ~ one minute
          (the same estimate the nightly rollup uses until the device reports intervals).
        """
        if not pump_ids:
            return {}

        accessible_ids = set(self.pump_repo.get_accessible_ids())
        scoped_ids = [pid for pid in pump_ids if pid in accessible_ids]
        if not scoped_ids:
            return {}

        stmt = text("""
            WITH latest AS (
                SELECT DISTINCT ON (pump_id)
                    pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, pump_on, fault_active, gsm_rssi, recorded_at,
                    vfd_hz, vfd_i_out, vfd_v_ac, vfd_v_dc, vfd_kw, vfd_status, vfd_fault_code
                FROM agripump.telemetry_history
                WHERE pump_id = ANY(:p_ids)
                ORDER BY pump_id, recorded_at DESC
            ),
            today AS (
                SELECT pump_id, COUNT(*) FILTER (WHERE pump_on) AS on_rows
                FROM agripump.telemetry_history
                WHERE pump_id = ANY(:p_ids)
                  AND recorded_at >= (date_trunc('day', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata')
                GROUP BY pump_id
            ),
            open_fault AS (
                SELECT DISTINCT ON (pump_id) pump_id, fault_code
                FROM agripump.fault_logs
                WHERE pump_id = ANY(:p_ids) AND resolved_at IS NULL AND fault_code IS NOT NULL AND fault_code > 0
                ORDER BY pump_id, occurred_at DESC
            ),
            open_alert AS (
                SELECT DISTINCT ON (pump_id) pump_id, fault_code
                FROM agripump.alerts
                WHERE pump_id = ANY(:p_ids) AND resolved_at IS NULL AND fault_code IS NOT NULL AND fault_code > 0
                ORDER BY pump_id, last_occurred_at DESC
            )
            SELECT l.pump_id, l.v_ry, l.v_yb, l.v_br, l.i_r, l.i_y, l.i_b,
                   l.pump_on, l.fault_active, l.gsm_rssi, l.recorded_at,
                   COALESCE(t.on_rows, 0) AS on_rows,
                   CASE WHEN l.fault_active THEN COALESCE(f.fault_code, a.fault_code, l.vfd_fault_code) END AS fault_code,
                   l.vfd_hz, l.vfd_i_out, l.vfd_v_ac, l.vfd_v_dc, l.vfd_kw, l.vfd_status, l.vfd_fault_code
            FROM latest l
            LEFT JOIN today t      ON t.pump_id = l.pump_id
            LEFT JOIN open_fault f ON f.pump_id = l.pump_id
            LEFT JOIN open_alert a ON a.pump_id = l.pump_id
        """)
        rows = self.db.execute(stmt, {"p_ids": scoped_ids}).fetchall()

        def num(v):
            return float(v) if v is not None else None

        result = {}
        for r in rows:
            vfd_hz = num(r[13])
            vfd_i_out = num(r[14])
            vfd_v_ac = num(r[15])
            vfd_v_dc = num(r[16])
            vfd_kw = num(r[17])
            vfd_status = r[18]
            vfd_fault_code = int(r[19]) if r[19] is not None else None
            vfd_dict = None
            if any(x is not None for x in [vfd_hz, vfd_i_out, vfd_v_ac, vfd_v_dc, vfd_kw, vfd_status, vfd_fault_code]):
                vfd_dict = {
                    "hz": vfd_hz,
                    "i_out": vfd_i_out,
                    "v_ac": vfd_v_ac,
                    "v_dc": vfd_v_dc,
                    "kw": vfd_kw,
                    "status": vfd_status,
                    "fault_code": vfd_fault_code,
                }

            result[r[0]] = {
                "v_ry": num(r[1]), "v_yb": num(r[2]), "v_br": num(r[3]),
                "i_r": num(r[4]), "i_y": num(r[5]), "i_b": num(r[6]),
                "pump_on": bool(r[7]) if r[7] is not None else None,
                "fault_active": bool(r[8]) if r[8] is not None else None,
                "gsm_rssi": r[9],
                "signal_dbm": r[9],
                "recorded_at": r[10].isoformat() if r[10] else None,
                "runtime_today_min": int(r[11] or 0),
                "fault_code": int(r[12]) if r[12] is not None else None,
                "vfd": vfd_dict,
                "vfd_hz": vfd_hz,
                "vfd_i_out": vfd_i_out,
                "vfd_v_ac": vfd_v_ac,
                "vfd_v_dc": vfd_v_dc,
                "vfd_kw": vfd_kw,
                "vfd_status": vfd_status,
                "vfd_fault_code": vfd_fault_code,
            }
        return result
