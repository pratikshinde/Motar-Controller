import json
import logging
from typing import Callable
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from app.services.cache_service import cache_service

logger = logging.getLogger("agripump.idempotency")

class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    Idempotency middleware (FR-CLD-046).
    Enforces that repeated requests presenting the same Idempotency-Key
    within 24 hours return the identical cached response.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        idempotency_key = request.headers.get("Idempotency-Key")

        # Idempotency only applies to state-changing methods with the header present
        if not idempotency_key or request.method not in ["POST", "PUT", "PATCH"]:
            return await call_next(request)

        # Build scoping key using client identity (user ID from header/auth or IP) + path
        client_id = request.client.host if request.client else "unknown"
        auth_header = request.headers.get("Authorization", "")
        if auth_header:
            client_id = auth_header[-16:]  # Use last 16 chars of token as fingerprint

        cache_key = f"idempotency:{client_id}:{request.url.path}:{idempotency_key}"

        # 1. Check for cached response
        cached_raw = cache_service.get(cache_key)
        if cached_raw:
            try:
                cached_data = json.loads(cached_raw)
                logger.info("Idempotency cache hit for key: %s", idempotency_key)
                return Response(
                    content=cached_data["body"],
                    status_code=cached_data["status"],
                    media_type="application/json",
                    headers={"X-Cache-Lookup": "HIT", "X-Idempotent-Replay": "true"}
                )
            except Exception as e:
                logger.warning("Failed to deserialize idempotency payload: %s", e)

        # 2. Execute downstream handler
        response = await call_next(request)

        # 3. Only cache successful responses (2xx) for 24 hours (86400 seconds)
        if 200 <= response.status_code < 300:
            # Buffer the response body to cache and return
            body = [chunk async for chunk in response.body_iterator]
            full_body = b"".join(body)

            try:
                cache_payload = json.dumps({
                    "status": response.status_code,
                    "body": full_body.decode("utf-8", errors="replace")
                })
                cache_service.set(cache_key, cache_payload, ex=86400)
            except Exception as e:
                logger.warning("Failed to store idempotency record: %s", e)

            # Reconstruct response since iterator was consumed
            return Response(
                content=full_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type
            )

        return response
