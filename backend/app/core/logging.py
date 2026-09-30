import re
import json
import time
import uuid
import logging
from typing import Callable, Optional
from contextvars import ContextVar
from datetime import datetime, timezone
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from app.core.metrics import metrics_collector

# Context variables for distributed request tracing
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")
user_id_ctx: ContextVar[str] = ContextVar("user_id", default="")
device_id_ctx: ContextVar[str] = ContextVar("device_id", default="")

# Regular expressions for data sanitization (FR-CLD-047)
RE_BEARER = re.compile(r'(Bearer\s+)[A-Za-z0-9\-_.]+', re.IGNORECASE)
RE_JWT = re.compile(r'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}')
RE_PASSWORD = re.compile(r'("(?:password|secret|key)"\s*:\s*")[^"]+(")', re.IGNORECASE)
RE_PASSWORD_KV = re.compile(r'(password\s*=\s*)[^\s,]+', re.IGNORECASE)
RE_OTP = re.compile(r'("(?:otp|otp_code|code)"\s*:\s*")[^"]+(")', re.IGNORECASE)
RE_PHONE = re.compile(r'(\+?\d{2,4})\d{4,6}(\d{3})')

def mask_sensitive_data(text: str) -> str:
    """
    Masks authorization tokens, OTPs, passwords, and phone numbers in log messages.
    """
    if not isinstance(text, str):
        return text

    text = RE_BEARER.sub(r'\1***', text)
    text = RE_JWT.sub('[JWT_REDACTED]', text)
    text = RE_PASSWORD.sub(r'\1***\2', text)
    text = RE_PASSWORD_KV.sub(r'\1***', text)
    text = RE_OTP.sub(r'\1***\2', text)
    text = RE_PHONE.sub(r'\1****\2', text)
    return text

class StructuredJSONFormatter(logging.Formatter):
    """
    Emits log records as compact, single-line JSON adhering to FR-CLD-047.
    """

    def format(self, record: logging.LogRecord) -> str:
        # Base log message
        message = mask_sensitive_data(record.getMessage())

        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
            "request_id": request_id_ctx.get() or getattr(record, "request_id", None),
            "user_id": user_id_ctx.get() or getattr(record, "user_id", None),
            "device_id": device_id_ctx.get() or getattr(record, "device_id", None),
        }

        # Include exception traceback if present
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        # Include custom extra fields if provided
        for key, val in record.__dict__.items():
            if key not in ("msg", "args", "levelname", "levelno", "pathname", "filename",
                           "module", "exc_info", "exc_text", "stack_info", "lineno",
                           "funcName", "created", "msecs", "relativeCreated", "thread",
                           "threadName", "processName", "process", "message", "request_id",
                           "user_id", "device_id"):
                try:
                    json.dumps(val)
                    log_entry[key] = val
                except (TypeError, OverflowError):
                    log_entry[key] = str(val)

        return json.dumps(log_entry)

def setup_structured_logging():
    """
    Configures root logger and application loggers to use StructuredJSONFormatter.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredJSONFormatter())

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Replace existing handlers
    root_logger.handlers = [handler]

    # Set specific levels for third-party loggers
    logging.getLogger("uvicorn.access").handlers = [handler]
    logging.getLogger("uvicorn.error").handlers = [handler]
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

logger = logging.getLogger("agripump.access")

class LoggingMiddleware(BaseHTTPMiddleware):
    """
    HTTP Logging and Request Tracing Middleware.
    Enriches requests with X-Request-ID, measures duration, and writes structured logs.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        t0 = time.time()

        # 1. Resolve or generate request_id
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        req_token = request_id_ctx.set(request_id)

        # 2. Extract user_id from token if present (without full signature check)
        user_id = ""
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            try:
                import jwt
                unverified = jwt.decode(token, options={"verify_signature": False})
                user_id = str(unverified.get("sub", ""))
            except Exception:
                pass
        usr_token = user_id_ctx.set(user_id)

        # 3. Extract device_id if present in path (e.g. /pumps/{id}...)
        device_id = request.headers.get("X-Device-Id", "")
        if not device_id:
            path_parts = request.url.path.strip("/").split("/")
            if "pumps" in path_parts:
                idx = path_parts.index("pumps")
                if idx + 1 < len(path_parts):
                    candidate = path_parts[idx + 1]
                    if candidate not in ("bulk-import", "sample-csv"):
                        device_id = candidate
        dev_token = device_id_ctx.set(device_id)

        client_ip = request.client.host if request.client else "unknown"

        try:
            response = await call_next(request)
            duration_ms = round((time.time() - t0) * 1000, 2)

            # Record in metrics collector
            metrics_collector.record_request(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            # Attach X-Request-ID to response header for distributed tracing
            response.headers["X-Request-ID"] = request_id

            # Log request
            log_level = logging.INFO
            if response.status_code >= 500:
                log_level = logging.ERROR
            elif response.status_code >= 400:
                log_level = logging.WARNING

            logger.log(
                log_level,
                f"{request.method} {request.url.path} -> {response.status_code} ({duration_ms}ms)",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                    "client_ip": client_ip,
                }
            )

            return response
        except Exception as exc:
            duration_ms = round((time.time() - t0) * 1000, 2)
            metrics_collector.record_request(
                method=request.method,
                path=request.url.path,
                status_code=500,
                duration_ms=duration_ms
            )
            logger.error(
                f"Unhandled Exception in {request.method} {request.url.path}: {str(exc)}",
                exc_info=exc,
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": 500,
                    "duration_ms": duration_ms,
                    "client_ip": client_ip,
                }
            )
            raise
        finally:
            request_id_ctx.reset(req_token)
            user_id_ctx.reset(usr_token)
            device_id_ctx.reset(dev_token)
