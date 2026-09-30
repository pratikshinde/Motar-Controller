import hmac
import sys
import os
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.config import settings
from app.api.deps import get_current_user, security
from app.database import engine, get_db
from app.core.metrics import metrics_collector
from app.services.cache_service import cache_service
from fastapi.security import HTTPAuthorizationCredentials
from typing import Optional

router = APIRouter(tags=["System Health"])
_start_time = time.time()

@router.get("/version")
def get_system_version():
    """
    Returns deployment, service version, and commit information (FR-CLD-047 / P1.8).
    """
    uptime_sec = int(time.time() - _start_time)
    git_commit = os.getenv("GIT_COMMIT", "head-0bb2f7da")
    return {
        "service": "agripump-backend",
        "version": settings.VERSION,
        "git_commit": git_commit,
        "environment": settings.ENV,
        "uptime_seconds": uptime_sec,
        "python_version": sys.version.split()[0],
        "database": "PostgreSQL + TimescaleDB (schema: agripump)",
        "cache": "Redis" if cache_service._redis else "In-Memory Fallback",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

def _is_superadmin(request: Request, credentials: Optional[HTTPAuthorizationCredentials], db: Session) -> bool:
    """True only for a valid superadmin session. Anyone else, signed in or not, is simply 'not'."""
    if not credentials:
        return False
    try:
        from app.core.roles import normalize_role, UserRole
        user = get_current_user(request, credentials, db)
        return normalize_role(user.role) == UserRole.SUPER_ADMIN
    except HTTPException:
        return False


def _pool_stats() -> dict:
    """The real connection pool, not a guess. `waiting` is not something SQLAlchemy exposes, so it is not reported."""
    pool = engine.pool
    try:
        size, out, idle, overflow = pool.size(), pool.checkedout(), pool.checkedin(), max(pool.overflow(), 0)
        return {"pool_total": size + overflow, "pool_idle": idle, "pool_in_use": out, "pool_waiting": None}
    except Exception:
        return {"pool_total": None, "pool_idle": None, "pool_in_use": None, "pool_waiting": None}


def _cache_state() -> dict:
    """Whether the cache actually answers, checked now."""
    if cache_service._redis:
        try:
            cache_service._redis.ping()
            return {"connected": True, "mode": "redis"}
        except Exception:
            return {"connected": False, "mode": "redis"}
    return {"connected": True, "mode": "in_memory"}


def _metrics_access(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_metrics_token: Optional[str] = Header(None, alias="X-Metrics-Token"),
    db: Session = Depends(get_db),
) -> None:
    """A scraper with the shared token, or the platform owner. Only local development (with no token set) is open."""
    expected = settings.METRICS_TOKEN
    if expected and x_metrics_token and hmac.compare_digest(x_metrics_token, expected):
        return
    if _is_superadmin(request, credentials, db):
        return
    if settings.ENV == "development" and not expected:
        return
    raise HTTPException(status_code=401, detail="Metrics require the platform owner or a scrape token.")


@router.get("/metrics", dependencies=[Depends(_metrics_access)])
def get_system_metrics():
    """
    Exposes operational metrics, request latency percentiles, and error counts.
    """
    return {
        "service": "agripump-backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics_collector.get_stats(),
        "cache": {
            "type": "redis" if cache_service._redis else "in_memory",
            "active": True
        }
    }

@router.get("/health")
def get_system_health(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
):
    """Liveness for load balancers (anyone: status only); the full picture for a signed-in superadmin."""
    db_ok = False
    latency_ms = None
    t0 = time.time()
    try:
        db.execute(text("SELECT 1")).scalar()
        latency_ms = round((time.time() - t0) * 1000, 2)
        db_ok = True
    except Exception:
        db_ok = False

    status = "OK" if db_ok else "DEGRADED"
    now = datetime.now(timezone.utc).isoformat()
    if not _is_superadmin(request, credentials, db):
        return {"status": status, "timestamp": now}

    stats = metrics_collector.get_stats()
    return {
        "status": status,
        "timestamp": now,
        "process": {
            "uptime_seconds": int(time.time() - _start_time),
            "version": settings.VERSION,
            "python_version": sys.version.split()[0],
            "env": settings.ENV
        },
        "database": {"connected": db_ok, "latency_ms": latency_ms, **_pool_stats()},
        "cache": _cache_state(),
        "metrics": {
            "requests_total": stats["requests_total"],
            "requests_per_second": stats["requests_per_second"],
            "errors_4xx": stats["errors_4xx"],
            "errors_5xx": stats["errors_5xx"],
            "latency_p95_ms": stats["latency_ms"]["p95"],
        },
        "engine": "FastAPI + SQLAlchemy + TimescaleDB"
    }
