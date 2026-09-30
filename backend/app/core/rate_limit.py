import time
import logging
from typing import Callable, Optional
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from app.services.cache_service import cache_service

logger = logging.getLogger("agripump.ratelimit")

class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Per-user and per-IP rate limiting middleware (FR-CLD-043).
    Returns HTTP 429 with 'Retry-After' header and error envelope when limit is exceeded.
    """

    def __init__(self, app, default_limit: int = 120, window_seconds: int = 60):
        super().__init__(app)
        self.default_limit = default_limit
        self.window_seconds = window_seconds

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Exempt preflight OPTIONS, health check, and telemetry ingestion from standard user limits
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if "/system/health" in path or "/telemetry" in path or path == "/api" or path == "/":
            return await call_next(request)

        # Identify client by user token or client IP
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            client_id = f"user:{auth_header[-16:]}"
            limit = self.default_limit
        else:
            client_ip = request.client.host if request.client else "unknown"
            client_id = f"ip:{client_ip}"
            limit = self.default_limit // 2  # Anonymous IP has tighter limit (60 req/min)

        now = int(time.time())
        current_window = now // self.window_seconds
        cache_key = f"ratelimit:{client_id}:{current_window}"

        # Increment count
        count = cache_service.incr(cache_key, ex=self.window_seconds * 2)

        if count > limit:
            seconds_remaining = ((current_window + 1) * self.window_seconds) - now
            logger.warning("Rate limit exceeded for %s: count=%d, limit=%d", client_id, count, limit)
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message_key": "errors.rate_limit_exceeded",
                        "params": {"retry_after": seconds_remaining}
                    },
                    "detail": f"Rate limit exceeded. Please wait {seconds_remaining} seconds before retrying."
                },
                headers={
                    "Retry-After": str(seconds_remaining),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(seconds_remaining)
                }
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
        return response
