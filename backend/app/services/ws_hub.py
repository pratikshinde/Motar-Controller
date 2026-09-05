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

    def _is_in_scope(self, user_meta: Dict[str, Any], pump_hierarchy_path: str) -> bool:
        if not user_meta:
            return False
        role = user_meta.get("role")
        if role == "superadmin":
            return True
        user_path = user_meta.get("hierarchy_path", "")
        # Non-superadmin: pump must be within their sub-tree
        return pump_hierarchy_path.startswith(user_path)

    async def broadcast_to_scoped(self, message: Dict[str, Any], pump_hierarchy_path: Optional[str] = None):
        msg_str = json.dumps(message)
        dead_connections = []
        
        async with self.lock:
            targets = list(self.active_connections.items())
            
        for ws, meta in targets:
            try:
                if pump_hierarchy_path:
                    if not self._is_in_scope(meta, pump_hierarchy_path):
                        continue
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
