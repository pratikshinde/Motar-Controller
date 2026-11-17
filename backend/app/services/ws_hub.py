import json
import asyncio
import logging
import uuid
from typing import Dict, Set, Any, Optional
from fastapi import WebSocket

logger = logging.getLogger("agripump.ws_hub")

# The readings are saved by the `ingest` worker, a different process from the one that holds the browsers' sockets.
# Whatever a worker pushes would reach nobody, so every push is also sent over Redis and each web server hands it on
# to the sockets it holds.
RELAY_CHANNEL = "agripump:ws-relay"


class WebSocketHub:
    def __init__(self):
        # Maps WebSocket connection to user metadata dict (e.g. {"user_id": ..., "hierarchy_path": ..., "role": ...})
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}
        self.lock = asyncio.Lock()
        self.origin = uuid.uuid4().hex    # which process a relayed message came from, so one is not delivered twice

    async def connect(self, websocket: WebSocket, user_meta: Dict[str, Any]):
        await websocket.accept()
        async with self.lock:
            self.active_connections[websocket] = user_meta

    async def disconnect(self, websocket: WebSocket):
        async with self.lock:
            if websocket in self.active_connections:
                del self.active_connections[websocket]

    @staticmethod
    def _path_in_scope(user_path: Optional[str], pump_path: Optional[str]) -> bool:
        """Partner sub-tree test that respects path boundaries: /SA/D1 does not cover /SA/D10,
        and an empty path on either side never matches."""
        user_path = (user_path or "").rstrip("/")
        pump_path = (pump_path or "").rstrip("/")
        if not user_path or not pump_path:
            return False
        return pump_path == user_path or pump_path.startswith(user_path + "/")

    def _is_in_scope(self, user_meta: Optional[Dict[str, Any]], pump_id: Optional[str], pump_hierarchy_path: Optional[str]) -> bool:
        if not user_meta:
            return False
        subscriptions = user_meta.get("subscriptions")
        if subscriptions is not None and pump_id not in subscriptions:
            return False
        role = user_meta.get("role")
        if role == "superadmin":
            return True
        if role == "customer":
            # A farmer's scope is the pumps they own or were given, not a path prefix.
            return pump_id in (user_meta.get("pump_ids") or ())
        return self._path_in_scope(user_meta.get("hierarchy_path"), pump_hierarchy_path)

    async def broadcast_to_scoped(self, message: Dict[str, Any], pump_hierarchy_path: Optional[str] = None):
        await self._deliver_local(message, pump_hierarchy_path)
        await self._relay(message, pump_hierarchy_path, alert_event=False)

    # --- Redis relay (worker process -> web servers) -------------------------------------------------------------
    @staticmethod
    def _redis():
        from app.services.cache_service import cache_service

        return cache_service._redis

    async def _relay(self, message: Dict[str, Any], path: Optional[str], alert_event: bool) -> None:
        client = self._redis()
        if client is None:
            return
        payload = json.dumps({"origin": self.origin, "message": message, "path": path, "alert_event": alert_event})
        try:
            await asyncio.to_thread(client.publish, RELAY_CHANNEL, payload)
        except Exception as exc:
            logger.warning("Could not relay a live update through Redis: %s", exc)

    async def handle_relayed(self, raw: Any) -> None:
        """A message another process published: hand it to the sockets this process holds (never one this process sent)."""
        try:
            data = json.loads(raw)
            if data.get("origin") == self.origin:
                return
            message, path = data["message"], data.get("path")
            await self._deliver_local(message, path)
            if data.get("alert_event"):
                from app.websockets.dashboard_ws import publish_alert_event

                await publish_alert_event(message.get("pump_id"), message.get("data"))
        except Exception as exc:
            logger.warning("Ignoring a relayed live update that could not be read: %s", exc)

    async def run_relay_listener(self) -> None:
        """Runs in each web server for as long as it lives. Starts again by itself when Redis goes away and comes back."""
        from app.config import settings

        url = getattr(settings, "REDIS_URL", None) or "redis://localhost:6379/0"
        while True:
            try:
                import redis.asyncio as aredis

                client = aredis.Redis.from_url(url, decode_responses=True)
                pubsub = client.pubsub()
                await pubsub.subscribe(RELAY_CHANNEL)
                logger.info("Live-update relay listening on Redis")
                async for item in pubsub.listen():
                    if item.get("type") == "message":
                        await self.handle_relayed(item["data"])
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Live-update relay lost Redis (%s); retrying in 3 s", exc)
            await asyncio.sleep(3)

    async def _deliver_local(self, message: Dict[str, Any], pump_hierarchy_path: Optional[str] = None):
        msg_str = json.dumps(message)
        pump_id = message.get("pump_id")
        dead_connections = []

        async with self.lock:
            targets = list(self.active_connections.items())

        for ws, meta in targets:
            # Sockets that have not authenticated (meta is None) never receive fleet data.
            if not self._is_in_scope(meta, pump_id, pump_hierarchy_path):
                continue
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead_connections.append(ws)

        if dead_connections:
            async with self.lock:
                for ws in dead_connections:
                    if ws in self.active_connections:
                        del self.active_connections[ws]

    async def broadcast_pump_update(self, pump_id: str, telemetry: Dict[str, Any], hierarchy_path: Optional[str] = None):
        msg = {
            "type": "telemetry",
            "pump_id": pump_id,
            "data": telemetry
        }
        await self.broadcast_to_scoped(msg, hierarchy_path)

    async def broadcast_fault(self, pump_id: str, fault: Dict[str, Any], hierarchy_path: Optional[str] = None):
        msg = {
            "type": "fault",
            "pump_id": pump_id,
            "data": fault
        }
        await self._deliver_local(msg, hierarchy_path)
        # Every fault and connectivity alert is announced through here, so this one call also feeds the dashboard
        # channel (imported lazily: that module imports services which import this one).
        from app.websockets.dashboard_ws import publish_alert_event
        await publish_alert_event(pump_id, fault)
        await self._relay(msg, hierarchy_path, alert_event=True)

    async def broadcast_config_update(self, pump_id: str, config: Dict[str, Any], hierarchy_path: Optional[str] = None):
        msg = {
            "type": "config",
            "pump_id": pump_id,
            "data": config
        }
        await self.broadcast_to_scoped(msg, hierarchy_path)

    async def broadcast_command_update(self, pump_id: str, command: Dict[str, Any], hierarchy_path: Optional[str] = None):
        msg = {
            "type": "command",
            "pump_id": pump_id,
            "data": command
        }
        await self.broadcast_to_scoped(msg, hierarchy_path)

ws_hub = WebSocketHub()
