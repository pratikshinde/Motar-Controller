from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings
from app.database import SessionLocal, setup_timescaledb
from app.api import auth, pumps, fleet, telemetry, alerts, users, batches, templates, audit, health, branding, panels, service_reports
from app.websockets import router as ws_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Auto-create database tables if not existing & check TimescaleDB setup
    from app.database import engine, Base
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"Startup DB schema notice: {e}")

    db = SessionLocal()
    try:
        setup_timescaledb(db)
    except Exception as e:
        print(f"Startup TimescaleDB notice: {e}")
    finally:
        db.close()
    yield
    # Shutdown

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS Middleware - Universal access for Web, Mobile & Expo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

# Mount users router at root /users as well as /api/v1/users and /api/users
app.include_router(users.router, prefix="/users")

# Include routers under both /api/v1 (standard) and /api (legacy alias for web/mobile compatibility)
for prefix in ["/api/v1", "/api"]:
    app.include_router(auth.router, prefix=f"{prefix}/auth")
    app.include_router(pumps.router, prefix=f"{prefix}/pumps")
    app.include_router(fleet.router, prefix=f"{prefix}/fleet")
    app.include_router(telemetry.router, prefix=f"{prefix}/telemetry")
    app.include_router(alerts.router, prefix=f"{prefix}/alerts")
    app.include_router(users.router, prefix=f"{prefix}/users")
    app.include_router(batches.router, prefix=f"{prefix}/batches")
    app.include_router(templates.router, prefix=f"{prefix}/config-templates")
    app.include_router(audit.router, prefix=f"{prefix}/audit-log")
    app.include_router(health.router, prefix=f"{prefix}/system")
    app.include_router(branding.router, prefix=f"{prefix}/branding")
    app.include_router(panels.router, prefix=f"{prefix}/panels")
    app.include_router(service_reports.router, prefix=f"{prefix}/service-reports")

# WebSocket Hub
app.include_router(ws_router.router)
