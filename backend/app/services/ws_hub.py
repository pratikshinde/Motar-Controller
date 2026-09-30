import json
import asyncio
from typing import Dict, Set, Any, Optional
from fastapi import WebSocket

class WebSocketHub:
    def __init__(self):
        # Maps WebSocket connection to user metadata dict (e.g. {"user_id": ..., "hierarchy_path": ..., "role": ...})
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}
        self.lock = asyncio.Lock()

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
        await self.broadcast_to_scoped(msg, hierarchy_path)
        # Every fault and connectivity alert is announced through here, so this one call also feeds the dashboard
        # channel (imported lazily: that module imports services which import this one).
        from app.websockets.dashboard_ws import publish_alert_event
        await publish_alert_event(pump_id, fault)

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
