"""Turning the address typed when a farmer is registered into a place on the map.

Registration takes an address (a village, a taluka, a district), not coordinates, so the pump would never get a pin. This looks the address up
once (OpenStreetMap's free Nominatim service, India only) and keeps the coordinates on the pump. Only the address text is sent, nothing about
the farmer, and never more than one request a second. An address that cannot be found falls back to a wider one ("Plot 12, Hadapsar, Pune"
-> "Hadapsar, Pune" -> "Pune"), so a pump still lands in the right region. If the service is down the registration is not affected: the pump
simply has no pin until the address is looked up again.
"""
import json
import logging
import time
import urllib.parse
import urllib.request
from functools import lru_cache
from typing import Iterator, Optional, Tuple

from sqlalchemy import text

from app.config import settings

logger = logging.getLogger("agripump.geocode")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "AgriPumpController/1.0 (pump map)"
MAX_TRIES = 3
PAUSE_SECONDS = 1.1          # the service's rule: at most one request a second
TIMEOUT_SECONDS = 5


def candidates(address: str) -> Iterator[str]:
    """The address, then each wider version of it (leading parts dropped), at most MAX_TRIES in all."""
    parts = [p.strip() for p in (address or "").split(",") if p.strip()]
    for i in range(min(len(parts), MAX_TRIES)):
        yield ", ".join(parts[i:])


def _ask(query: str) -> Optional[Tuple[float, float]]:
    params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "in"})
    req = urllib.request.Request(f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - a fixed https address
        hits = json.load(resp)
    if not hits:
        return None
    lat, lon = float(hits[0]["lat"]), float(hits[0]["lon"])
    # India sits inside this box: a hit outside it is a lookup gone wrong, not a pump.
    return (lat, lon) if 6.0 <= lat <= 37.5 and 67.0 <= lon <= 98.0 else None


@lru_cache(maxsize=512)
def geocode_address(address: str) -> Optional[Tuple[float, float]]:
    """(latitude, longitude) for an address, or None when it cannot be found or looking it up is switched off."""
    if not settings.GEOCODE_ENABLED:
        return None
    first = True
    for query in candidates(address):
        if not first:
            time.sleep(PAUSE_SECONDS)
        first = False
        try:
            found = _ask(query)
        except Exception as exc:  # the service is down or slow: the pump just has no pin yet
            logger.warning("address lookup failed (%s)", exc.__class__.__name__)
            return None
        if found:
            return found
    return None


def place_pumps_for_address(pump_ids, address: str, overwrite: bool = False) -> int:
    """Look the address up and put the result on these pumps (only the ones with no position yet, unless `overwrite`). Runs after the response
    has gone, with a session of its own. Returns how many pumps got a position."""
    if not pump_ids or not (address or "").strip():
        return 0
    spot = geocode_address(address.strip())
    if spot is None:
        return 0
    from app.database import SessionLocal
    from app.models import Pump

    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', true)"))
        query = db.query(Pump).filter(Pump.id.in_(list(pump_ids)))
        if not overwrite:
            query = query.filter(Pump.latitude.is_(None))
        placed = query.update({"latitude": round(spot[0], 6), "longitude": round(spot[1], 6)}, synchronize_session=False)
        db.commit()
        return int(placed or 0)
    except Exception:
        db.rollback()
        logger.exception("could not save a pump's position")
        return 0
    finally:
        db.close()
