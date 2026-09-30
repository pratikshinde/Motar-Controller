"""
DeviceConnectivityService - Phase 3
====================================
The one definition of online / offline / unknown, for both Python objects and SQL.

Rule (the same one the pump badges and the OFFLINE alert sweep use):
  * A device that is not in service (stock, allocated, suspended, RMA, retired) is expected to be quiet: it is
    NOT_IN_SERVICE, never "offline".
  * An in-service device that has never reported is UNKNOWN (there is no outage to report yet).
  * An in-service device that reported within OFFLINE_AFTER_SECONDS is ONLINE; otherwise it is OFFLINE.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from app.config import settings
from app.models import Pump

_STATUS_ONLINE = "ONLINE"
_STATUS_OFFLINE = "OFFLINE"
_STATUS_UNKNOWN = "UNKNOWN"
_STATUS_NOT_IN_SERVICE = "NOT_IN_SERVICE"

# Kept identical to connectivity_sweep.IN_SERVICE (a test pins the two together).
IN_SERVICE_STATES = ("COMMISSIONED", "ACTIVE")
_IN_SERVICE_SQL = ", ".join(f"'{s}'" for s in IN_SERVICE_STATES)


class DeviceConnectivityService:
    """Classifies device connectivity, in Python and as SQL fragments."""

    @staticmethod
    def cutoff(offline_after_seconds: Optional[int] = None, now: Optional[datetime] = None) -> datetime:
        """Devices last seen before this instant are offline."""
        seconds = settings.OFFLINE_AFTER_SECONDS if offline_after_seconds is None else offline_after_seconds
        return (now or datetime.now(timezone.utc)) - timedelta(seconds=seconds)

    @staticmethod
    def sql_predicates(alias: str = "p") -> Dict[str, str]:
        """SQL conditions (over a pumps row aliased `alias`, with a `:cutoff` bind) for each status."""
        a = f"{alias}." if alias else ""
        in_service = f"{a}lifecycle_state IN ({_IN_SERVICE_SQL})"
        return {
            "online": f"({in_service} AND {a}last_seen_at IS NOT NULL AND {a}last_seen_at >= :cutoff)",
            "offline": f"({in_service} AND {a}last_seen_at IS NOT NULL AND {a}last_seen_at < :cutoff)",
            "unknown": f"({in_service} AND {a}last_seen_at IS NULL)",
            "not_in_service": f"({a}lifecycle_state NOT IN ({_IN_SERVICE_SQL}))",
        }

    @staticmethod
    def classify(
        last_seen_at: Optional[datetime], lifecycle_state: Optional[str], now: Optional[datetime] = None
    ) -> str:
        """ONLINE, OFFLINE, UNKNOWN or NOT_IN_SERVICE."""
        if (lifecycle_state or "").upper() not in IN_SERVICE_STATES:
            return _STATUS_NOT_IN_SERVICE
        if last_seen_at is None:
            return _STATUS_UNKNOWN
        if last_seen_at.tzinfo is None:
            last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
        return _STATUS_ONLINE if last_seen_at >= DeviceConnectivityService.cutoff(now=now) else _STATUS_OFFLINE

    @staticmethod
    def get_connectivity_status(pump: Pump, now: Optional[datetime] = None) -> str:
        """Reporting-only status ('ONLINE' / 'OFFLINE' / 'UNKNOWN'), ignoring lifecycle: what a pump badge shows."""
        if pump.last_seen_at is None:
            return _STATUS_UNKNOWN
        last_seen = pump.last_seen_at
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        return _STATUS_ONLINE if last_seen >= DeviceConnectivityService.cutoff(now=now) else _STATUS_OFFLINE

    @staticmethod
    def is_online(pump: Pump, now: Optional[datetime] = None) -> bool:
        return DeviceConnectivityService.get_connectivity_status(pump, now) == _STATUS_ONLINE

    @staticmethod
    def is_offline(pump: Pump, now: Optional[datetime] = None) -> bool:
        return DeviceConnectivityService.get_connectivity_status(pump, now) == _STATUS_OFFLINE
