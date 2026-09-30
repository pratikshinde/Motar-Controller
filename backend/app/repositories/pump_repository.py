from datetime import datetime, timedelta, timezone
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, case, func, text
from app.core.scope import in_subtree
from app.models import Pump, User, DeviceAccess, Organisation

class PumpRepository:
    """
    Repository encapsulating all Pump querying and persistence.
    Enforces tenant isolation by construction (FR-CLD-042).
    """

    def __init__(self, actor: User, db: Session):
        self.actor = actor
        self.db = db

    @classmethod
    def for_actor(cls, actor: User, db: Session) -> "PumpRepository":
        return cls(actor=actor, db=db)

    def _base_query(self):
        from app.services.authorization_service import AuthorizationService
        return AuthorizationService.apply_tenant_scope(self.db.query(Pump), Pump, self.actor, self.db)

    def get_by_id(self, pump_id: str) -> Optional[Pump]:
        """Fetch a pump by ID within the actor's scope."""
        return self._base_query().filter(Pump.id == pump_id).first()

    def list(
        self,
        page: int = 1,
        limit: int = 50,
        cursor: Optional[str] = None,
        search: Optional[str] = None,
        status: Optional[str] = None
    ) -> List[Pump]:
        """List paginated pumps within actor's scope (supports page/offset or cursor)."""
        query = self._base_query()

        if search:
            s = f"%{search.strip()}%"
            query = query.filter(or_(Pump.name.ilike(s), Pump.id.ilike(s)))

        if status:
            query = query.filter(Pump.status == status)

        if cursor:
            # ID-based cursor pagination
            return query.filter(Pump.id > cursor).order_by(Pump.id.asc()).limit(limit).all()

        offset = max(0, (page - 1) * limit)
        return query.order_by(Pump.id.asc()).offset(offset).limit(limit).all()

    def count(
        self,
        search: Optional[str] = None,
        status: Optional[str] = None
    ) -> int:
        """Count total pumps within actor's scope matching filter."""
        query = self._base_query()

        if search:
            s = f"%{search.strip()}%"
            query = query.filter(or_(Pump.name.ilike(s), Pump.id.ilike(s)))

        if status:
            query = query.filter(Pump.status == status)

        return query.count()

    def fleet_counts(self, offline_after_seconds: int, search: Optional[str] = None) -> dict:
        """Exclusive counts over EVERY pump in scope, in one query. A pump lands in exactly one bucket:

        offline   reported before, but not within `offline_after_seconds` (its last known state means nothing now)
        no_data   never reported
        fault / running / stopped   online, by its own reported status
        """
        query = self._base_query()
        if search:
            s = f"%{search.strip()}%"
            query = query.filter(or_(Pump.name.ilike(s), Pump.id.ilike(s)))
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=offline_after_seconds)
        never = Pump.last_seen_at.is_(None)
        offline = Pump.last_seen_at.isnot(None) & (Pump.last_seen_at < cutoff)
        online = Pump.last_seen_at.isnot(None) & (Pump.last_seen_at >= cutoff)
        status = func.upper(func.coalesce(Pump.status, ""))
        row = query.with_entities(
            func.count(Pump.id),
            func.count(case((offline, 1))),
            func.count(case((never, 1))),
            func.count(case((online & (status == "FAULT"), 1))),
            func.count(case((online & (status == "RUNNING"), 1))),
        ).one()
        total, off, no_data, fault, running = (int(x or 0) for x in row)
        return {
            "total": total, "offline": off, "no_data": no_data, "fault": fault, "running": running,
            "stopped": total - off - no_data - fault - running,
        }

    def get_accessible_ids(self) -> List[str]:
        """Return list of device IDs visible to the actor."""
        rows = self._base_query().with_entities(Pump.id).all()
        return [r[0] for r in rows]

    def create(self, pump: Pump) -> Pump:
        """Create a new pump record."""
        self.db.add(pump)
        self.db.commit()
        self.db.refresh(pump)
        return pump

    def update(self, pump: Pump, **kwargs) -> Pump:
        """Update an existing pump record."""
        for key, value in kwargs.items():
            if hasattr(pump, key):
                setattr(pump, key, value)
        self.db.commit()
        self.db.refresh(pump)
        return pump

    def delete(self, pump: Pump) -> None:
        """Delete a pump record (restricted to superadmin via router)."""
        self.db.delete(pump)
        self.db.commit()
