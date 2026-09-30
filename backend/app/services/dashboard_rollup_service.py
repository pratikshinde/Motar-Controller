"""Runtime rollup for the dashboards, refreshed in the background.

The nightly job (`app.workers.jobs`) compacts each finished day into `daily_summary`, so "runtime today" has no rollup
row until tomorrow, and the dashboard's period figure would otherwise sum several days of per-device rollup rows on
every refresh. At 100,000 devices those two reads alone cost 0.6-1.6 s per request in the benchmark, and they grow with
reporting cadence and fleet size.

Instead this keeps one small row per device (`dashboard_runtime`) current every few minutes - minutes run today plus
minutes run over the completed days of the window - and the dashboards read that. A reading with the motor on counts
as one minute: the same estimate the pump screen and the nightly rollup use. "Today" is the calendar day in
`DASHBOARD_TIMEZONE`, never UTC.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.core.dashboard_time import day_start_utc, local_today
from app.core.metrics import metrics_collector
from app.database import system_session

logger = logging.getLogger("agripump.dashboard.rollup")

# Any constant: only one API worker at a time may refresh, or every worker would repeat the same scan.
REFRESH_LOCK_KEY = 5_119_208


def refresh_dashboard_runtime(db: Session, now: Optional[datetime] = None, period_days: Optional[int] = None) -> int:
    """Recompute every device's runtime for today and for the completed days of the window. Commits. Returns the
    number of devices written, or 0 when another worker is already refreshing. Idempotent: it recomputes, never adds."""
    now = now or datetime.now(timezone.utc)
    if not db.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": REFRESH_LOCK_KEY}).scalar():
        return 0
    period_days = max(1, period_days or settings.DASHBOARD_RUNTIME_PERIOD_DAYS)
    day = local_today(now)
    result = db.execute(
        text(
            "WITH today AS ("
            "  SELECT t.pump_id AS device_id, COUNT(*) FILTER (WHERE t.pump_on) AS minutes "
            "  FROM agripump.telemetry_history t WHERE t.recorded_at >= :start AND t.recorded_at < :end "
            "  GROUP BY t.pump_id), "
            "history AS ("
            "  SELECT ds.device_id, SUM(ds.runtime_min) AS minutes FROM agripump.daily_summary ds "
            "  WHERE ds.day >= :history_start AND ds.day < :day GROUP BY ds.device_id) "
            "INSERT INTO agripump.dashboard_runtime (device_id, day, runtime_min, history_min, history_days, updated_at) "
            "SELECT d.device_id, :day, COALESCE(t.minutes, 0), COALESCE(h.minutes, 0), :period_days, now() "
            "FROM (SELECT device_id FROM today UNION SELECT device_id FROM history) d "
            "LEFT JOIN today t ON t.device_id = d.device_id LEFT JOIN history h ON h.device_id = d.device_id "
            "WHERE EXISTS (SELECT 1 FROM agripump.pumps p WHERE p.id = d.device_id) "
            "ON CONFLICT (device_id) DO UPDATE SET day = EXCLUDED.day, runtime_min = EXCLUDED.runtime_min, "
            "history_min = EXCLUDED.history_min, history_days = EXCLUDED.history_days, "
            "updated_at = EXCLUDED.updated_at"
        ),
        {"day": day, "start": day_start_utc(day), "end": day_start_utc(day + timedelta(days=1)),
         "history_start": day - timedelta(days=period_days - 1), "period_days": period_days},
    )
    db.commit()
    return int(result.rowcount or 0)


def _refresh() -> int:
    with system_session() as db:
        return refresh_dashboard_runtime(db)


async def runtime_refresh_once() -> int:
    import time

    t0 = time.monotonic()
    written = await run_in_threadpool(_refresh)
    metrics_collector.observe("dashboard.runtime_refresh_ms", (time.monotonic() - t0) * 1000)
    metrics_collector.incr("dashboard.runtime_refreshes")
    return written


async def runtime_refresh_loop() -> None:
    interval = settings.DASHBOARD_RUNTIME_REFRESH_SECONDS
    while True:
        try:
            await runtime_refresh_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            metrics_collector.incr("dashboard.runtime_refresh_errors")
            logger.exception("Dashboard runtime refresh failed")
        await asyncio.sleep(max(5, interval))
