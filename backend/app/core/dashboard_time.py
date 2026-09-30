"""The one definition of "today" for dashboards.

A day is a calendar day in `settings.DASHBOARD_TIMEZONE` (default Asia/Kolkata, the same clock the farmer app's
"ran today" figure already uses). Everything is converted to timezone-aware UTC instants for SQL; a bare
`date.today()` (the server's local day) or a UTC midnight must not be used for a dashboard boundary.
"""
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import settings


@lru_cache(maxsize=8)
def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        # A typo in configuration must not take every dashboard down; fall back to UTC and say so once.
        import logging

        logging.getLogger("agripump.dashboard").error("Unknown DASHBOARD_TIMEZONE %r; using UTC", name)
        return ZoneInfo("UTC")


def dashboard_zone() -> ZoneInfo:
    return _zone(settings.DASHBOARD_TIMEZONE)


def local_today(now: datetime | None = None) -> date:
    """The current calendar date in the dashboard timezone."""
    now = now or datetime.now(timezone.utc)
    return now.astimezone(dashboard_zone()).date()


def day_start_utc(day: date) -> datetime:
    """The UTC instant at which `day` (a dashboard-timezone date) begins."""
    return datetime.combine(day, datetime.min.time(), tzinfo=dashboard_zone()).astimezone(timezone.utc)


def today_start_utc(now: datetime | None = None) -> datetime:
    return day_start_utc(local_today(now))


def days_ago(n: int, now: datetime | None = None) -> date:
    return local_today(now) - timedelta(days=n)
