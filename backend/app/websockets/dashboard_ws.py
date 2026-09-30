"""
Dashboard WebSocket Channel - Phase 3
======================================
GET (upgrade) /ws/dashboard - live dashboard events, scoped per connection.

Authentication (same model as /ws)
  1. Token in the query string: /ws/dashboard?token=<access_token>
     (prefer 2: query strings end up in proxy and access logs)
  2. Or, as the first frame: {"type": "auth", "token": "<access_token>"}
An unauthenticated socket is closed after AUTH_TIMEOUT_S. END_USER accounts cannot connect. A session that ends
(logout everywhere, password change, suspension) is dropped at the next revalidation, whichever way it authenticated.

Events pushed (JSON text frames)
  {"type": "auth_ok"}
  {"type": "DEVICE_STATUS_UPDATED", "device_id", "status": "ONLINE" | "OFFLINE", "timestamp"}
  {"type": "FAULT_CREATED", "device_id", "fault": {...}}
  {"type": "FAULT_RESOLVED", "device_id", "fault_id"}

Scope
  A connection is scoped exactly like the REST dashboards: SUPER_ADMIN gets everything; anyone else gets only devices
  in their organisation subtree or under their legacy hierarchy path. The server resolves each event's device scope
  itself; nothing a client sends can widen it.
"""
import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional, Set, Tuple

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text

from app.core.metrics import metrics_collector
from app.core.roles import UserRole, normalize_role
from app.core.scope import path_in_scope
from app.database import SessionLocal, system_session
from app.models import Organisation, Pump, User
from app.repositories.dashboard_repository import DashboardRepository
from app.services.cache_service import cache_service
from app.services.dashboard_service import scope_hier_path
from app.services.jwt_auth import verify_token

logger = logging.getLogger("agripump.dashboard.ws")

router = APIRouter(tags=["Dashboard WebSocket"])

AUTH_TIMEOUT_S = 10
REVALIDATE_S = 60
_SCOPE_CACHE_S = 60


class DashboardHub:
    """In-process hub. Each connection carries {user_id, role, org_ids, hier_path}; None = not yet authenticated."""

    def __init__(self):
        self._conns: Dict[WebSocket, Optional[Dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, meta: Optional[Dict[str, Any]]):
        async with self._lock:
            self._conns[ws] = meta

    async def update_meta(self, ws: WebSocket, meta: Dict[str, Any]):
        async with self._lock:
            if ws in self._conns:
                self._conns[ws] = meta

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._conns.pop(ws, None)

    @staticmethod
    def _in_scope(meta: Optional[Dict[str, Any]], device_org_id: Optional[str],
                  device_hier_path: Optional[str] = None) -> bool:
        if not meta:
            return False
        if meta.get("role") in (UserRole.SUPER_ADMIN, "superadmin"):
            return True
        org_ids: Set[str] = meta.get("org_ids") or set()
        if device_org_id and str(device_org_id) in org_ids:
            return True
        hp = meta.get("hier_path")
        return bool(hp and device_hier_path and path_in_scope(hp, device_hier_path))

    async def broadcast(self, event: Dict[str, Any], device_org_id: Optional[str] = None,
                        device_hier_path: Optional[str] = None):
        msg = json.dumps(event, default=str)
        dead = []
        async with self._lock:
            targets = list(self._conns.items())
        for ws, meta in targets:
            if not self._in_scope(meta, device_org_id, device_hier_path):
                continue
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
                metrics_collector.incr("dashboard.ws.send_errors")
        if dead:
            async with self._lock:
                for ws in dead:
                    self._conns.pop(ws, None)

    async def broadcast_device_status(self, device_id: str, device_org_id: Optional[str], status: str, ts: str,
                                      device_hier_path: Optional[str] = None):
        await self.broadcast(
            {"type": "DEVICE_STATUS_UPDATED", "device_id": device_id, "status": status, "timestamp": ts},
            device_org_id, device_hier_path,
        )

    async def broadcast_fault(self, device_id: str, device_org_id: Optional[str], fault: Dict[str, Any],
                              device_hier_path: Optional[str] = None):
        await self.broadcast({"type": "FAULT_CREATED", "device_id": device_id, "fault": fault},
                             device_org_id, device_hier_path)

    async def broadcast_fault_resolved(self, device_id: str, device_org_id: Optional[str], fault_id: Any,
                                       device_hier_path: Optional[str] = None):
        await self.broadcast({"type": "FAULT_RESOLVED", "device_id": device_id, "fault_id": fault_id},
                             device_org_id, device_hier_path)

    @property
    def connection_count(self) -> int:
        return len(self._conns)


dashboard_hub = DashboardHub()

# ---------------------------------------------------------------- publishing (called by the server, never by clients)
_scope_cache: Dict[str, Tuple[float, Optional[str], Optional[str]]] = {}


def _device_scope(pump_id: str) -> Tuple[Optional[str], Optional[str]]:
    """(org_id, hierarchy_path) of a device, from the database, cached briefly. A device that no longer exists has no
    scope, so only a super admin would see its event."""
    hit = _scope_cache.get(pump_id)
    now = time.monotonic()
    if hit and hit[0] > now:
        return hit[1], hit[2]
    with system_session() as db:
        row = db.query(Pump.org_id, Pump.hierarchy_path).filter(Pump.id == pump_id).first()
    org_id = str(row[0]) if row and row[0] else None
    hier = row[1] if row else None
    if len(_scope_cache) > 20_000:
        _scope_cache.clear()
    _scope_cache[pump_id] = (now + _SCOPE_CACHE_S, org_id, hier)
    return org_id, hier


async def publish_alert_event(pump_id: str, alert: Dict[str, Any]) -> None:
    """Turn an alert announcement (the payload `WebSocketHub.broadcast_fault` already carries) into dashboard events
    for exactly the connections allowed to see that device. Never raises: a failure here must not affect ingest."""
    try:
        if dashboard_hub.connection_count == 0:
            return
        org_id, hier = await run_in_threadpool(_device_scope, pump_id)
        alert_type = (alert.get("alert_type") or "").upper()
        resolved = alert.get("resolved_at")
        ts = resolved or alert.get("last_occurred_at") or alert.get("first_occurred_at")
        if alert_type == "OFFLINE":
            await dashboard_hub.broadcast_device_status(pump_id, org_id, "ONLINE" if resolved else "OFFLINE",
                                                        ts, hier)
        elif resolved:
            await dashboard_hub.broadcast_fault_resolved(pump_id, org_id, alert.get("id"), hier)
        else:
            await dashboard_hub.broadcast_fault(pump_id, org_id, alert, hier)
    except Exception:
        logger.exception("Could not publish the dashboard event for %s", pump_id)


# ------------------------------------------------------------------------------------------------ identity
def _load_identity(token: str) -> Optional[Dict[str, Any]]:
    payload = verify_token(token) if token else None
    if not payload or "sub" not in payload or payload.get("mfa_pending"):
        return None
    with SessionLocal() as db:
        try:
            user = db.query(User).filter(User.id == payload["sub"]).first()
            if not user or not user.role:
                return None
            if getattr(user, "account_status", "ACTIVE") == "SUSPENDED" or user.is_active is False:
                return None
            token_ver = payload.get("session_ver", 1)
            if token_ver < cache_service.get_user_session_version(str(user.id)):
                return None
            role = normalize_role(user.role)
            if role == UserRole.END_USER:
                return None

            org_ids: Set[str] = set()
            if role != UserRole.SUPER_ADMIN and user.org_id:
                org = db.query(Organisation).filter(Organisation.id == user.org_id).first()
                if org and org.path:
                    org_ids = set(DashboardRepository(db).resolve_subtree_org_ids(str(org.path)))

            return {
                "user_id": str(user.id),
                "role": role,
                "org_ids": org_ids,
                "hier_path": scope_hier_path(role, user.hierarchy_path),
                "session_ver": token_ver,
            }
        finally:
            try:
                db.execute(text("RESET ALL;"))
            except Exception:
                pass


@router.websocket("/ws/dashboard")
async def dashboard_websocket(ws: WebSocket, token: str = Query(None)):
    await ws.accept()
    metrics_collector.incr("dashboard.ws.opened")
    state: Dict[str, Any] = {"meta": None, "token": None}

    async def authenticate(raw_token: Optional[str]) -> bool:
        if not raw_token:
            return False
        meta = await run_in_threadpool(_load_identity, raw_token)
        if not meta:
            metrics_collector.incr("dashboard.ws.auth_failed")
            return False
        await dashboard_hub.connect(ws, meta)
        state["meta"] = meta
        state["token"] = raw_token  # kept (in memory only) so revalidation works however the client authenticated
        return True

    await dashboard_hub.connect(ws, None)

    if token and await authenticate(token):
        await ws.send_text(json.dumps({"type": "auth_ok"}))

    async def revalidate():
        while True:
            await asyncio.sleep(REVALIDATE_S)
            if not state.get("meta") or not state.get("token"):
                continue
            fresh = await run_in_threadpool(_load_identity, state["token"])
            if not fresh:
                try:
                    await ws.close(code=4401, reason="Session ended")
                except Exception:
                    pass
                return
            state["meta"] = fresh
            await dashboard_hub.update_meta(ws, fresh)

    revalidate_task = asyncio.create_task(revalidate())

    async def auth_timeout():
        await asyncio.sleep(AUTH_TIMEOUT_S)
        if not state.get("meta"):
            try:
                await ws.close(code=4401, reason="Authentication timeout")
            except Exception:
                pass

    guard = asyncio.create_task(auth_timeout()) if not state.get("meta") else None

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "auth":
                if await authenticate(msg.get("token")):
                    if guard and not guard.done():
                        guard.cancel()
                    await ws.send_text(json.dumps({"type": "auth_ok"}))
                else:
                    await ws.close(code=4401, reason="Invalid token")
                    return
            elif msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    except Exception:
        metrics_collector.incr("dashboard.ws.errors")
        logger.exception("dashboard websocket error")
    finally:
        for t in (guard, revalidate_task):
            if t and not t.done():
                t.cancel()
        await dashboard_hub.disconnect(ws)
        metrics_collector.incr("dashboard.ws.closed")
