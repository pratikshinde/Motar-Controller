"""The numbers behind the website's dashboards and people cards: for the signed-in account and for everyone below it.

One pass over the people and the pumps in the caller's own tree (never anyone else's): each pump is counted for every account above its owner,
the same way each farmer, dealer and distributor is counted for the accounts above them. So a distributor's card says what is under that
distributor, and the admin's summary says what is under the admin.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.core.scope import in_subtree
from app.models import BatchImei, Pump, User
from app.repositories.pump_repository import PumpRepository

PEOPLE_ROLES = ("distributor", "dealer", "customer")


class _Counts:
    __slots__ = ("pumps", "running", "stopped", "fault", "offline", "no_data", "gsm_pumps", "gsm_online", "distributors", "dealers", "farmers")

    def __init__(self) -> None:
        self.pumps = self.running = self.stopped = self.fault = self.offline = self.no_data = 0
        self.gsm_pumps = self.gsm_online = self.distributors = self.dealers = self.farmers = 0

    def as_dict(self) -> dict:
        return {
            "pumps": {"total": self.pumps, "running": self.running, "stopped": self.stopped, "fault": self.fault, "offline": self.offline, "no_data": self.no_data},
            "gsm_pumps": self.gsm_pumps, "gsm_online": self.gsm_online,
            "distributors": self.distributors, "dealers": self.dealers, "farmers": self.farmers,
        }


def _norm(path: Optional[str]) -> str:
    return (path or "").strip().rstrip("/")


def _prefixes(path: str) -> List[str]:
    """/SA/a/b -> ['/SA', '/SA/a', '/SA/a/b']: this node and every node above it."""
    parts = [p for p in path.split("/") if p]
    return ["/" + "/".join(parts[: i + 1]) for i in range(len(parts))]


def _months(db: Session, scope_pumps, months: int = 6) -> List[dict]:
    now = datetime.now(timezone.utc)
    firsts, y, m = [], now.year, now.month
    for _ in range(months):
        firsts.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    firsts.reverse()
    since = datetime(firsts[0][0], firsts[0][1], 1, tzinfo=timezone.utc)
    month = func.to_char(func.date_trunc("month", Pump.created_at), "YYYY-MM")
    ids = scope_pumps.with_entities(Pump.id).subquery()
    rows = db.query(month, func.count(Pump.id)).filter(Pump.id.in_(db.query(ids.c.id)), Pump.created_at >= since).group_by(month).all()
    found = {r[0]: int(r[1]) for r in rows}
    return [{"month": f"{y}-{m:02d}", "pumps": found.get(f"{y}-{m:02d}", 0)} for y, m in firsts]


def team_overview(db: Session, actor: User) -> dict:
    """{"summary": what is under the caller, "people": every distributor, dealer and farmer under the caller, each with the same numbers}."""
    root = _norm(actor.hierarchy_path)
    users_q = db.query(User)
    if actor.role != "superadmin":
        users_q = users_q.filter(in_subtree(User.hierarchy_path, root)) if root else users_q.filter(User.id == actor.id)
    users: List[User] = users_q.all()
    by_path: Dict[str, User] = {_norm(u.hierarchy_path): u for u in users if _norm(u.hierarchy_path)}

    counts: Dict[str, _Counts] = defaultdict(_Counts)

    # the people: each one is counted for everyone above them
    for u in users:
        role = (u.role or "").lower()
        if role not in PEOPLE_ROLES:
            continue
        for above in _prefixes(_norm(u.hierarchy_path))[:-1]:
            c = counts[above]
            if role == "distributor":
                c.distributors += 1
            elif role == "dealer":
                c.dealers += 1
            else:
                c.farmers += 1

    # the pumps: each one is counted for everyone above its owner (and for the owner)
    scope = PumpRepository.for_actor(actor, db)._base_query()
    gsm_ids = {
        r[0] for r in db.query(BatchImei.pump_id).filter(BatchImei.pump_id.isnot(None), or_(BatchImei.imei.isnot(None), BatchImei.claimed.is_(True))).all()
    }
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.OFFLINE_AFTER_SECONDS)
    for pid, path, status, seen in scope.with_entities(Pump.id, Pump.hierarchy_path, Pump.status, Pump.last_seen_at).all():
        online = seen is not None and (seen if seen.tzinfo else seen.replace(tzinfo=timezone.utc)) >= cutoff
        state = "no_data" if seen is None else ("offline" if not online else {"RUNNING": "running", "FAULT": "fault"}.get((status or "").upper(), "stopped"))
        is_gsm = pid in gsm_ids
        for node in _prefixes(_norm(path)):
            c = counts[node]
            c.pumps += 1
            setattr(c, state, getattr(c, state) + 1)
            if is_gsm:
                c.gsm_pumps += 1
                if online:
                    c.gsm_online += 1

    people = []
    for u in sorted(users, key=lambda x: (x.created_at is None, x.created_at)):
        role = (u.role or "").lower()
        path = _norm(u.hierarchy_path)
        if role not in PEOPLE_ROLES or path == root:
            continue
        above = [by_path[p] for p in _prefixes(path)[:-1] if p in by_path and p != root and (by_path[p].role or "").lower() in PEOPLE_ROLES]
        people.append({
            "id": str(u.id), "role": role, "full_name": u.full_name, "phone_number": u.phone_number or u.phone, "email": u.email,
            "address": u.address, "account_status": (u.account_status or "ACTIVE").upper(),
            "has_signed_in": bool(u.password_hash) if role != "customer" else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "above": [{"id": str(a.id), "name": a.full_name, "role": (a.role or "").lower()} for a in above],
            **counts[path].as_dict(),
        })

    summary = counts[root].as_dict() if root else _Counts().as_dict()
    summary["monthly_pumps"] = _months(db, scope)
    summary["waiting_to_sign_in"] = sum(1 for p in people if p["role"] in ("distributor", "dealer") and p["has_signed_in"] is False)
    return {"summary": summary, "people": people}
