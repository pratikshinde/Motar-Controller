import json
import asyncio
from typing import Any, Dict, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text
from app.database import SessionLocal
from app.models import User
from app.repositories import PumpRepository
from app.core.errors import AppError
from app.services import view_as
from app.services.cache_service import cache_service
from app.services.jwt_auth import verify_token
from app.services.ws_hub import ws_hub
from app.api.deps import set_db_actor_context

router = APIRouter(tags=["WebSockets"])

AUTH_TIMEOUT_S = 5
# A client that sends heartbeats (the mobile app pings every ~25 s) is dropped after this long
# without any frame, so a phone that lost signal does not hold a slot open. Clients that never
# ping (the web portal) are not subject to it.
IDLE_TIMEOUT_S = 75
# Sharing / suspension / logout are re-checked this often on a live socket.
REVALIDATE_S = 60
MAX_SUBSCRIPTIONS = 200


def _access_payload(token):
    # Same rule as deps.get_current_user: an MFA-pending temp token is not a login.
    payload = verify_token(token) if token else None
    if not payload or "sub" not in payload or payload.get("mfa_pending"):
        return None
    return payload


def _load_identity(payload: Dict[str, Any], view_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Resolve a verified token into the connection's scope, from the database, not the token.

    `view_key` is the super admin looking at one manufacturer's portal (see services/view_as.py): the connection then gets
    that manufacturer's scope instead of the platform's, so live events of other manufacturers are not delivered.

    Applies the same gates as REST: the account must exist and be active, and the token's session
    version must not have been revoked. A farmer's scope is the set of pumps they own or were
    given; the token's hierarchy_path is ignored for them.
    """
    with SessionLocal() as db:
        try:
            user = db.query(User).filter(User.id == payload["sub"]).first()
            if not user or not user.role:
                return None
            if user.status == "SUSPENDED" or user.account_status == "SUSPENDED":
                return None
            token_ver = payload.get("session_ver", 1)
            if token_ver < cache_service.get_user_session_version(str(user.id)) or token_ver < (getattr(user, "session_version", 1) or 1):
                return None

            set_db_actor_context(db, user=user)
            if view_key and user.role == "superadmin":
                try:
                    user = view_as.principal_for(db, view_key)
                except AppError:
                    return None  # no such manufacturer / no account: the socket is refused like an unauthenticated one
            pump_ids = None
            if user.role == "customer":
                pump_ids = set(PumpRepository.for_actor(actor=user, db=db).get_accessible_ids())
            return {
                "user_id": str(user.id),
                "role": user.role,
                "hierarchy_path": user.hierarchy_path or "",
                "pump_ids": pump_ids,
                "subscriptions": None,
                "session_ver": token_ver,
            }
        finally:
            try:
                db.execute(text("RESET ALL;"))
            except Exception:
                pass


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None), view: str = Query(None)):
    await websocket.accept()
    state: Dict[str, Any] = {"meta": None, "payload": None, "heartbeat": False}
    view_key = (view or "").strip().lower() or None

    async def authenticate(raw_token: Optional[str]) -> bool:
        payload = _access_payload(raw_token)
        meta = await run_in_threadpool(_load_identity, payload, view_key) if payload else None
        if not meta:
            return False
        async with ws_hub.lock:
            previous = ws_hub.active_connections.get(websocket)
            # Re-authenticating (token refresh) keeps the client's chosen subscriptions.
            if previous:
                meta["subscriptions"] = previous.get("subscriptions")
            ws_hub.active_connections[websocket] = meta
        state["meta"], state["payload"] = meta, payload
        return True

    async def revalidate_loop():
        while True:
            await asyncio.sleep(REVALIDATE_S)
            payload = state["payload"]
            if not payload:
                continue
            fresh = await run_in_threadpool(_load_identity, payload, view_key)
            if not fresh:
                await websocket.close(code=4401, reason="Session ended")
                return
            async with ws_hub.lock:
                current = ws_hub.active_connections.get(websocket)
                if current is not None:
                    current["pump_ids"] = fresh["pump_ids"]
                    current["role"] = fresh["role"]
                    current["hierarchy_path"] = fresh["hierarchy_path"]

    async with ws_hub.lock:
        ws_hub.active_connections[websocket] = None

    # The token may arrive in the URL (web portal) or, preferably, as the first frame (mobile),
    # which keeps it out of proxy and access logs.
    if token and await authenticate(token):
        await websocket.send_text(json.dumps({"type": "auth_ok"}))

    async def auth_timeout_guard():
        await asyncio.sleep(AUTH_TIMEOUT_S)
        if state["meta"] is None:
            try:
                await websocket.close(code=4401, reason="Authentication timeout")
            except Exception:
                pass

    guard_task = None if state["meta"] else asyncio.create_task(auth_timeout_guard())
    revalidate_task = asyncio.create_task(revalidate_loop())

    try:
        while True:
            try:
                if state["heartbeat"]:
                    data_text = await asyncio.wait_for(websocket.receive_text(), timeout=IDLE_TIMEOUT_S)
                else:
                    data_text = await websocket.receive_text()
            except asyncio.TimeoutError:
                await websocket.close(code=4408, reason="Idle timeout")
                break

            try:
                msg = json.loads(data_text)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue

            kind = msg.get("type")
            if kind == "auth":
                if await authenticate(msg.get("token")):
                    if guard_task and not guard_task.done():
                        guard_task.cancel()
                    await websocket.send_text(json.dumps({"type": "auth_ok"}))
                else:
                    await websocket.close(code=4401, reason="Invalid token")
                    break
            elif kind == "ping":
                state["heartbeat"] = True
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif kind == "subscribe" and state["meta"] is not None:
                requested = msg.get("pump_ids")
                if not isinstance(requested, list):
                    continue
                requested = [p for p in requested if isinstance(p, str)][:MAX_SUBSCRIPTIONS]
                async with ws_hub.lock:
                    meta = ws_hub.active_connections.get(websocket)
                    if meta is None:
                        continue
                    if meta.get("role") == "customer":
                        allowed = meta.get("pump_ids") or set()
                        accepted = [p for p in requested if p in allowed]
                    else:
                        # Partners are scoped by hierarchy at delivery time.
                        accepted = requested
                    meta["subscriptions"] = set(accepted)
                await websocket.send_text(json.dumps({
                    "type": "subscribed",
                    "pump_ids": accepted,
                    "rejected": [p for p in requested if p not in accepted],
                }))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        for t in (guard_task, revalidate_task):
            if t and not t.done():
                t.cancel()
        await ws_hub.disconnect(websocket)
