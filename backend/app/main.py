import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings
from app.database import SessionLocal, check_timescaledb_extension
from app.api import auth, pumps, commands, fleet, telemetry, alerts, users, batches, templates, audit, health, branding, panels, service_reports, sites, invites, organisations, dashboard
from app.websockets import router as ws_router
from app.websockets import dashboard_ws as dashboard_ws_router

async def _command_sweep_loop():
    from app.services.command_dispatch import sweep_once
    while True:
        try:
            await sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Command sweep failed: {exc}")
        await asyncio.sleep(max(1, settings.COMMAND_SWEEP_INTERVAL_SECONDS))


async def _connectivity_sweep_loop():
    from app.services.connectivity_sweep import connectivity_sweep_once
    while True:
        try:
            await connectivity_sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Connectivity sweep failed: {exc}")
        await asyncio.sleep(max(1, settings.CONNECTIVITY_SWEEP_INTERVAL_SECONDS))


async def _runtime_refresh_loop():
    from app.services.dashboard_rollup_service import runtime_refresh_loop
    await runtime_refresh_loop()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Tune async threadpool capacity limiter for concurrent sync DB queries
    try:
        import anyio
        anyio.to_thread.current_default_thread_limiter().total_tokens = 100
    except Exception as e:
        print(f"Notice: anyio thread limiter adjustment skipped: {e}")

    # Startup: Database schema managed by Alembic. Verify database health & connectivity.
    db = SessionLocal()
    try:
        check_timescaledb_extension(db)
    except Exception as e:
        print(f"Startup TimescaleDB notice: {e}")
    finally:
        db.close()
    # Startup: Initialize Sentry error reporting if configured
    try:
        from app.core.metrics import init_sentry
        init_sentry()
    except Exception as e:
        print(f"Notice: Sentry setup skipped: {e}")

    # Startup: close commands that ran out of time (EXPIRED / NOT_CONFIRMED). Safe with several API workers:
    # each sweep locks the rows it touches and skips the ones another worker holds.
    sweeper = asyncio.create_task(_command_sweep_loop())
    # Startup: raise a connectivity alert for pumps that stopped reporting and resolve it when they are back
    # (FR-CLD-024). One worker at a time does the sweep (a database advisory lock).
    connectivity_sweeper = (
        asyncio.create_task(_connectivity_sweep_loop()) if settings.CONNECTIVITY_SWEEP_INTERVAL_SECONDS > 0 else None
    )

    # Startup: keep each device's "runtime today" rollup current for the dashboards (one worker at a time).
    runtime_refresher = (
        asyncio.create_task(_runtime_refresh_loop()) if settings.DASHBOARD_RUNTIME_REFRESH_SECONDS > 0 else None
    )

    yield
    # Shutdown
    sweeper.cancel()
    if connectivity_sweeper:
        connectivity_sweeper.cancel()
    if runtime_refresher:
        runtime_refresher.cancel()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Exception Handlers
from app.core.errors import AppError, app_error_handler
app.add_exception_handler(AppError, app_error_handler)

# Structured JSON Logging Setup
from app.core.logging import LoggingMiddleware, setup_structured_logging
setup_structured_logging()

# Idempotency Middleware (FR-CLD-046)
from app.core.idempotency import IdempotencyMiddleware
app.add_middleware(IdempotencyMiddleware)

# Rate Limiting Middleware (FR-CLD-043)
from app.core.rate_limit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware, default_limit=120, window_seconds=60)

# Request Logging & Tracing Middleware (FR-CLD-047)
app.add_middleware(LoggingMiddleware)

# CORS Middleware - Universal access for Web, Mobile & Expo (outermost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def api_versioning_deprecation_middleware(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    # RFC 8594 / RFC 9213: If accessing legacy unversioned /api endpoints, notify client
    if path.startswith("/api/") and not path.startswith("/api/v1/"):
        response.headers["Deprecation"] = "true"
        response.headers["Sunset"] = "Wed, 31 Dec 2026 23:59:59 GMT"
        successor_path = path.replace("/api/", "/api/v1/", 1)
        response.headers["Link"] = f'<{successor_path}>; rel="successor-version"'
    return response

# Root status
@app.get("/")
def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "stack": "Python FastAPI + SQLAlchemy + TimescaleDB/PostgreSQL",
        "docs": "/docs"
    }

@app.get("/api")
def api_root():
    return {
        "status": "online",
        "version": settings.VERSION,
        "endpoints": {
            "auth": "/api/v1/auth",
            "pumps": "/api/v1/pumps",
            "fleet": "/api/v1/fleet/dashboard",
            "telemetry": "/api/v1/telemetry",
            "alerts": "/api/v1/alerts",
            "users": "/api/v1/users",
            "batches": "/api/v1/batches",
            "templates": "/api/v1/config-templates",
            "health": "/api/v1/system/health",
            "ws": "/ws"
        }
    }

# Mount root aliases for auth, users, organisations, devices/pumps, and invitations
app.include_router(auth.router, prefix="/auth")
app.include_router(users.router, prefix="/users")
app.include_router(organisations.router, prefix="/organisations")
app.include_router(pumps.router, prefix="/devices")
app.include_router(pumps.router, prefix="/pumps")
app.include_router(invites.router, prefix="/invites")
app.include_router(invites.router, prefix="/invitations")
app.include_router(invites.organisations_router, prefix="/organisations")

# Include routers under both /api/v1 (standard) and /api (legacy alias for web/mobile compatibility)
for prefix in ["/api/v1", "/api"]:
    app.include_router(auth.router, prefix=f"{prefix}/auth")
    app.include_router(pumps.router, prefix=f"{prefix}/pumps")
    app.include_router(pumps.router, prefix=f"{prefix}/devices")
    app.include_router(commands.router, prefix=f"{prefix}/commands")
    app.include_router(fleet.router, prefix=f"{prefix}/fleet")
    app.include_router(telemetry.router, prefix=f"{prefix}/telemetry")
    app.include_router(alerts.router, prefix=f"{prefix}/alerts")
    app.include_router(sites.router, prefix=f"{prefix}/sites")
    app.include_router(organisations.router, prefix=f"{prefix}/organisations")
    app.include_router(users.router, prefix=f"{prefix}/users")
    app.include_router(invites.router, prefix=f"{prefix}/invites")
    app.include_router(invites.router, prefix=f"{prefix}/invitations")
    app.include_router(invites.organisations_router, prefix=f"{prefix}/organisations")
    app.include_router(batches.router, prefix=f"{prefix}/batches")
    app.include_router(templates.router, prefix=f"{prefix}/config-templates")
    app.include_router(audit.router, prefix=f"{prefix}/audit-log")
    app.include_router(health.router, prefix=f"{prefix}/system")
    app.include_router(branding.router, prefix=f"{prefix}/branding")
    app.include_router(panels.router, prefix=f"{prefix}/panels")
    app.include_router(service_reports.router, prefix=f"{prefix}/service-reports")
    app.include_router(dashboard.router, prefix=f"{prefix}/dashboard")

# WebSocket Hub
app.include_router(ws_router.router)
# Dashboard WebSocket (live updates)
app.include_router(dashboard_ws_router.router)
