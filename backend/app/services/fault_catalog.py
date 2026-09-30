"""Fault-code -> human name/severity, shared by every response that promises them.

`fleet.py`'s dashboard aggregate already built this lookup inline; `pumps.py`'s `/faults` and
`alerts.py`'s `/alerts` never did, so the web portal showed "Code 8 · Unknown" (or just the bare
code) everywhere a fault was named, while the same code has a real name in the catalog. One place
to look it up keeps the three call sites from drifting again.
"""
from typing import Dict, NamedTuple, Optional

from sqlalchemy.orm import Session

from app.models import FaultCodeCatalog


class FaultInfo(NamedTuple):
    name: Optional[str]
    severity: Optional[str]


def load_fault_catalog(db: Session) -> Dict[int, FaultInfo]:
    """Every fault code known to the database, fetched once per request."""
    return {c.code: FaultInfo(c.name, c.severity) for c in db.query(FaultCodeCatalog).all()}
