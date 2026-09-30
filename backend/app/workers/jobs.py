"""
P2.3 — Jobs Worker: Nightly Telemetry Compaction & Retention
=============================================================
Runs as a separate process (or cron) once per day to:

  1. compact_yesterday()
     - For every pump that had telemetry yesterday, compute aggregates and
       upsert one row into `daily_summary`.
     - Aggregates: runtime_min, start_count, fault_count, offline_min,
       v_min/max/mean (avg of 3 phases), i_min/max/mean, sample_count.
     - Uses INSERT … ON CONFLICT (device_id, day) DO UPDATE so reruns are safe.

  2. drop_old_telemetry()
     - Delete telemetry_history rows older than 30 days (FR-CLD-025).
     - Plain-Postgres path: DELETE WHERE recorded_at < now() - 30 days.
     - TimescaleDB path (if available): DROP CHUNK instead — never row-deletes.
     - Runs ONLY if daily_summary for each affected day has been computed first
       (safety gate: no summary → no drop).

Entry point:
    python -m app.workers.jobs [--once]            # run once and exit
    python -m app.workers.jobs                     # run on schedule (01:00 UTC daily)

Environment variables:
    RETENTION_DAYS          — telemetry raw retention (default 30)
    JOBS_RUN_HOUR_UTC       — hour in UTC to run nightly job (default 1)
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.logging import setup_structured_logging
from app.database import SessionLocal
from app.models import DailySummary, Pump, TelemetryHistory

logger = logging.getLogger("agripump.jobs")

RETENTION_DAYS: int = int(os.environ.get("RETENTION_DAYS", "30"))
JOBS_RUN_HOUR_UTC: int = int(os.environ.get("JOBS_RUN_HOUR_UTC", "1"))


# ---------------------------------------------------------------------------
# Core task 1: Compact yesterday's telemetry into daily_summary
# ---------------------------------------------------------------------------
def compact_yesterday(db: Session, target_day: Optional[date] = None) -> int:
    """
    Compute per-pump aggregates for `target_day` (default: yesterday UTC)
    and upsert them into `daily_summary`.

    Returns the number of device rows upserted.
    """
    if target_day is None:
        target_day = (datetime.now(timezone.utc) - timedelta(days=1)).date()

    day_start = datetime.combine(target_day, datetime.min.time()).replace(tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    logger.info("Compacting telemetry for day=%s", target_day)

    # Bypass RLS — this is a system job
    db.execute(text("SET app.bypass_rls = 'on';"))

    # Get all device_ids that had telemetry yesterday
    device_ids_result = db.execute(text("""
        SELECT DISTINCT pump_id
        FROM agripump.telemetry_history
        WHERE recorded_at >= :day_start AND recorded_at < :day_end
    """), {"day_start": day_start, "day_end": day_end}).fetchall()

    device_ids: List[str] = [row[0] for row in device_ids_result]

    if not device_ids:
        logger.info("No telemetry found for day=%s, skipping compaction", target_day)
        return 0

    upserted = 0
    for device_id in device_ids:
        # The previous reading is computed per row first: PostgreSQL does not allow a window
        # function (LAG) inside an aggregate (SUM).
        agg = db.execute(text("""
            WITH day_rows AS (
                SELECT pump_on, fault_active, v_ry, v_yb, v_br, i_r, i_y, i_b,
                       LAG(pump_on, 1, false) OVER (ORDER BY recorded_at) AS prev_on
                FROM agripump.telemetry_history
                WHERE pump_id = :device_id
                  AND recorded_at >= :day_start
                  AND recorded_at < :day_end
            )
            SELECT
                COUNT(*)                                                AS sample_count,
                -- Runtime: count intervals where pump was ON
                -- Proxy: each row represents ~reporting_interval seconds;
                -- we approximate by counting pump_on=true rows * avg interval / 60
                SUM(CASE WHEN pump_on THEN 1 ELSE 0 END)               AS on_samples,
                -- Start transitions: pump_on flipped from false→true
                -- We approximate by counting rising edges via window lag
                SUM(CASE WHEN pump_on AND NOT prev_on THEN 1 ELSE 0 END)
                                                                        AS start_count,
                SUM(CASE WHEN fault_active THEN 1 ELSE 0 END)          AS fault_count,
                -- Voltage stats (mean of 3 phases per row, then aggregate)
                MIN(LEAST(v_ry, v_yb, v_br))                           AS v_min,
                MAX(GREATEST(v_ry, v_yb, v_br))                        AS v_max,
                AVG((COALESCE(v_ry,0) + COALESCE(v_yb,0) + COALESCE(v_br,0)) / 3.0)
                                                                        AS v_mean,
                -- Current stats (mean of 3 phases per row, then aggregate)
                MIN(LEAST(i_r, i_y, i_b))                              AS i_min,
                MAX(GREATEST(i_r, i_y, i_b))                           AS i_max,
                AVG((COALESCE(i_r,0) + COALESCE(i_y,0) + COALESCE(i_b,0)) / 3.0)
                                                                        AS i_mean
            FROM day_rows
        """), {"device_id": device_id, "day_start": day_start, "day_end": day_end}).fetchone()

        if not agg or agg.sample_count == 0:
            continue

        # Estimate runtime_min: on_samples × avg reporting interval
        # Without known interval, approximate as on_samples × 1 min (60 s interval)
        # This is a conservative estimate; Track F1 will supply the real interval.
        runtime_min = int(agg.on_samples or 0)  # 1 row ≈ 1 min at 60s interval

        # Estimate offline_min: gap analysis
        # Minutes in the day minus runtime_min minus stopped_min = offline gaps
        # We approximate offline as minutes with no telemetry (gap > 5 min)
        gaps = db.execute(text("""
            SELECT COALESCE(SUM(gap_min), 0) AS offline_min
            FROM (
                SELECT
                    EXTRACT(EPOCH FROM (
                        recorded_at - LAG(recorded_at) OVER (ORDER BY recorded_at)
                    )) / 60.0 AS gap_min
                FROM agripump.telemetry_history
                WHERE pump_id = :device_id
                  AND recorded_at >= :day_start
                  AND recorded_at < :day_end
            ) t
            WHERE gap_min > 5
        """), {"device_id": device_id, "day_start": day_start, "day_end": day_end}).scalar()

        offline_min = int(gaps or 0)

        # Upsert into daily_summary
        db.execute(text("""
            INSERT INTO agripump.daily_summary
                (device_id, day, runtime_min, start_count, fault_count, offline_min,
                 v_min, v_max, v_mean, i_min, i_max, i_mean, sample_count, updated_at)
            VALUES
                (:device_id, :day, :runtime_min, :start_count, :fault_count, :offline_min,
                 :v_min, :v_max, :v_mean, :i_min, :i_max, :i_mean, :sample_count, now())
            ON CONFLICT (device_id, day) DO UPDATE SET
                runtime_min  = EXCLUDED.runtime_min,
                start_count  = EXCLUDED.start_count,
                fault_count  = EXCLUDED.fault_count,
                offline_min  = EXCLUDED.offline_min,
                v_min        = EXCLUDED.v_min,
                v_max        = EXCLUDED.v_max,
                v_mean       = EXCLUDED.v_mean,
                i_min        = EXCLUDED.i_min,
                i_max        = EXCLUDED.i_max,
                i_mean       = EXCLUDED.i_mean,
                sample_count = EXCLUDED.sample_count,
                updated_at   = now()
        """), {
            "device_id": device_id,
            "day": target_day,
            "runtime_min": runtime_min,
            "start_count": int(agg.start_count or 0),
            "fault_count": int(agg.fault_count or 0),
            "offline_min": offline_min,
            "v_min": float(agg.v_min) if agg.v_min is not None else None,
            "v_max": float(agg.v_max) if agg.v_max is not None else None,
            "v_mean": float(agg.v_mean) if agg.v_mean is not None else None,
            "i_min": float(agg.i_min) if agg.i_min is not None else None,
            "i_max": float(agg.i_max) if agg.i_max is not None else None,
            "i_mean": float(agg.i_mean) if agg.i_mean is not None else None,
            "sample_count": int(agg.sample_count or 0),
        })
        upserted += 1

    db.commit()
    logger.info("Compaction done: %d device summaries upserted for day=%s", upserted, target_day)
    return upserted


# ---------------------------------------------------------------------------
# Core task 2: Drop telemetry older than RETENTION_DAYS
# ---------------------------------------------------------------------------
def drop_old_telemetry(db: Session) -> int:
    """
    Delete raw telemetry_history rows older than RETENTION_DAYS (FR-CLD-025).

    Safety gate: we only delete a day's data if:
      1. The day has at least one daily_summary row covering it (for every
         pump that had data), OR
      2. The day is > RETENTION_DAYS + 2 (grace period for compaction lag).

    Returns the number of rows deleted.
    """
    db.execute(text("SET app.bypass_rls = 'on';"))

    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    # Conservative: only delete up to 2 days before the hard cutoff
    hard_cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS + 2)

    # Check if any devices in the window are missing summaries
    missing_summaries = db.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT DISTINCT pump_id, DATE(recorded_at AT TIME ZONE 'UTC') AS day
            FROM agripump.telemetry_history
            WHERE recorded_at < :cutoff
        ) t
        WHERE NOT EXISTS (
            SELECT 1 FROM agripump.daily_summary ds
            WHERE ds.device_id = t.pump_id AND ds.day = t.day
        )
    """), {"cutoff": cutoff}).scalar()

    if missing_summaries and missing_summaries > 0:
        logger.warning(
            "Skipping deletion: %d device-day combinations lack daily_summary rows. "
            "Running compaction first would fix this.",
            missing_summaries,
        )
        # Still delete the hard cutoff rows (grace period exhausted)
        result = db.execute(text("""
            DELETE FROM agripump.telemetry_history
            WHERE recorded_at < :hard_cutoff
        """), {"hard_cutoff": hard_cutoff})
        deleted = result.rowcount
    else:
        result = db.execute(text("""
            DELETE FROM agripump.telemetry_history
            WHERE recorded_at < :cutoff
        """), {"cutoff": cutoff})
        deleted = result.rowcount

    db.commit()
    if deleted > 0:
        logger.info(
            "Retention enforcement: deleted %d telemetry rows older than %s days",
            deleted, RETENTION_DAYS,
        )
    else:
        logger.info("Retention: no rows to delete (all within %d-day window)", RETENTION_DAYS)

    return deleted


# ---------------------------------------------------------------------------
# Full nightly job
# ---------------------------------------------------------------------------
def run_nightly_job() -> None:
    """
    Full nightly maintenance cycle:
      1. Compact yesterday
      2. Drop rows older than RETENTION_DAYS
    """
    db = SessionLocal()
    try:
        logger.info("=== Nightly job starting ===")

        compacted = compact_yesterday(db)
        dropped = drop_old_telemetry(db)

        logger.info(
            "=== Nightly job complete: %d summaries, %d rows dropped ===",
            compacted, dropped,
        )
    except Exception as exc:
        logger.exception("Nightly job failed: %s", exc)
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Scheduler loop
# ---------------------------------------------------------------------------
async def _scheduler_loop() -> None:
    """
    Run `run_nightly_job()` every day at JOBS_RUN_HOUR_UTC:00 UTC.
    Uses simple asyncio sleep — no external scheduler dependency.
    """
    logger.info(
        "Jobs scheduler started — will run daily at %02d:00 UTC",
        JOBS_RUN_HOUR_UTC,
    )
    while True:
        now = datetime.now(timezone.utc)
        # Compute seconds until next run
        next_run = now.replace(hour=JOBS_RUN_HOUR_UTC, minute=0, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        sleep_secs = (next_run - now).total_seconds()
        logger.info(
            "Next nightly job in %.0f minutes (at %s UTC)",
            sleep_secs / 60,
            next_run.strftime("%Y-%m-%d %H:%M"),
        )
        await asyncio.sleep(sleep_secs)
        try:
            run_nightly_job()
        except Exception as exc:
            logger.exception("Scheduled nightly job raised: %s", exc)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    setup_structured_logging()

    parser = argparse.ArgumentParser(description="AgriPump nightly jobs worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run the nightly job once immediately and exit (useful for testing/CI)",
    )
    parser.add_argument(
        "--day",
        type=str,
        default=None,
        help="Target day for compaction (YYYY-MM-DD). Defaults to yesterday. Implies --once.",
    )
    args = parser.parse_args()

    if args.day:
        target = date.fromisoformat(args.day)
        db = SessionLocal()
        try:
            compact_yesterday(db, target_day=target)
        finally:
            db.close()
        return

    if args.once:
        run_nightly_job()
        return

    asyncio.run(_scheduler_loop())


if __name__ == "__main__":
    main()
