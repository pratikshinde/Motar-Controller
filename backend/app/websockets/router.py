import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.services.ws_hub import ws_hub
from app.services.jwt_auth import verify_token

router = APIRouter(tags=["WebSockets"])

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    user_meta = None
    if token:
        payload = verify_token(token)
        if payload:
            user_meta = {
                "user_id": payload.get("sub"),
                "role": payload.get("role", "customer"),
                "hierarchy_path": payload.get("hierarchy_path", "")
            }

    await ws_hub.connect(websocket, user_meta or {"role": "superadmin", "hierarchy_path": ""})
    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                msg = json.loads(data_text)
                if msg.get("type") == "auth":
                    msg_token = msg.get("token")
                    payload = verify_token(msg_token)
                    if payload:
                        async with ws_hub.lock:
                            ws_hub.active_connections[websocket] = {
                                "user_id": payload.get("sub"),
                                "role": payload.get("role", "customer"),
                                "hierarchy_path": payload.get("hierarchy_path", "")
                            }
                        await websocket.send_text(json.dumps({"type": "auth_ok"}))
                elif msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                pass
    except WebSocketDisconnect:
        await ws_hub.disconnect(websocket)
    except Exception:
        await ws_hub.disconnect(websocket)
