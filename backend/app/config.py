import os
from pathlib import Path
from pydantic import model_validator
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    PROJECT_NAME: str = "AgriPump SmartSpace IoT Platform"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    PORT: int = 5000
    HOST: str = "127.0.0.1"
    # Default-deny: an unset ENV is treated as production, so a server started
    # without explicit configuration fails closed (JWT_SECRET required, no
    # self-registration, no dev OTP). Local machines opt in with ENV=development.
    ENV: str = "production"
    ALLOW_SELF_REGISTRATION: bool = True
    
    # PostgreSQL Configuration
    PGHOST: str = "localhost"
    PGPORT: int = 5432
    PGUSER: str = "propcb"
    PGPASSWORD: str = "propcb_dev_password"
    PGDATABASE: str = "propcb"
    PGSCHEMA: str = "agripump"
    
    # Fallback or explicit DATABASE_URL
    DATABASE_URL: str = ""
    
    # JWT & Auth
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    
    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
    ]
    
    # SMS / WhatsApp API credentials
    FAST2SMS_API_KEY: str = ""
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""
    MSG91_AUTH_KEY: str = ""
    MSG91_FLOW_ID: str = ""

    # WhatsApp OTP (Meta Cloud API), used only to prove a phone at registration and for a partner's forgot-
    # password — never for the everyday farmer login OTP, which stays SMS-only. Empty = not configured: the
    # send route then answers 503 outside development (ENV=development instead returns dev_otp, exactly like
    # the SMS routes, so the whole flow is buildable before a real WhatsApp Business Account exists).
    WHATSAPP_API_TOKEN: str = ""
    WHATSAPP_PHONE_ID: str = ""
    WHATSAPP_OTP_TEMPLATE: str = "otp_verification"
    WHATSAPP_OTP_LANGUAGE: str = "en_US"
    # How long a phone_verifications ticket is spendable after a correct OTP, before the account-creation /
    # password-reset call that was meant to use it must ask the phone to re-verify.
    PHONE_VERIFICATION_TTL_SECONDS: int = 600

    # Manufacturer / distributor escalation shown after the servicing dealer in the farmer app.
    # Empty = not configured (the app hides the row rather than showing a placeholder number).
    SUPPORT_ESCALATION_NAME: str = ""
    SUPPORT_ESCALATION_PHONE: str = ""
    SUPPORT_ESCALATION_EMAIL: str = ""
    
    # Roles that must use an authenticator app (FR-WEB-001). Until one of them has enabled TOTP its session can only
    # set TOTP up (and read its own profile / log out): every other request is refused with MFA_SETUP_REQUIRED.
    MFA_REQUIRED_ROLES: str = ""

    def mfa_required_for(self, role) -> bool:
        return (role or "") in {r.strip() for r in self.MFA_REQUIRED_ROLES.split(",") if r.strip()}

    # Shared token a metrics scraper sends as X-Metrics-Token. Without one, /system/metrics is superadmin-only
    # (and open only when ENV=development).
    METRICS_TOKEN: str = ""

    # Shared secret the fleet-provisioning Lambda sends to POST /batches/provisioning/pre-hook (X-Hook-Secret).
    PROVISIONING_HOOK_SECRET: str = ""

    # A pump that has reported before but not within this long is shown as Offline (never as Running / Stopped).
    OFFLINE_AFTER_SECONDS: int = 600

    # Commands to pumps (P2.4).
    # IOT_PUBLISH_MODE: "aws" = AWS IoT Core data plane; "outbox" = held for the local simulator to collect over HTTP
    # (development only); "off" = nothing is sent and every command ends FAILED. Empty: outbox in development, else aws.
    IOT_PUBLISH_MODE: str = ""
    AWS_REGION: str = "ap-south-1"
    IOT_DATA_ENDPOINT: str = ""          # e.g. xxxxxxxx-ats.iot.ap-south-1.amazonaws.com (optional; boto3 finds it otherwise)
    COMMAND_TTL_SECONDS: int = 120       # how long a command stays valid; the bridge refuses it after `expiry`
    COMMAND_CONFIRM_SECONDS: int = 60    # interim mode: no proof of effect after this long -> NOT_CONFIRMED
    COMMAND_INTERIM_CONFIRM: bool = True # infer APPLIED from the pump's own reading until firmware acks (F2)
    COMMAND_SWEEP_INTERVAL_SECONDS: int = 5
    # How often the API looks for pumps that stopped reporting (and for ones that came back). 0 turns the sweep off.
    CONNECTIVITY_SWEEP_INTERVAL_SECONDS: int = 60

    # Dashboards (Phase 3). "Today" is a calendar day in DASHBOARD_TIMEZONE (an IANA name), never the browser's or
    # the server's local day. Results are cached briefly per scope; data older than DASHBOARD_STALE_AFTER_SECONDS
    # is flagged stale.
    DASHBOARD_TIMEZONE: str = "Asia/Kolkata"
    DASHBOARD_CACHE_TTL_SECONDS: int = 30
    DASHBOARD_TOP_DEVICES_LIMIT: int = 10
    DASHBOARD_FAULT_WINDOW_DAYS: int = 30
    # Runtime hours are summed over this many days. Summing 30 days x 100k devices from per-device rollups takes seconds
    # (see scripts/bench_results); a longer window needs an org-level rollup first.
    DASHBOARD_RUNTIME_PERIOD_DAYS: int = 7
    # How often the background refresher recomputes each device's runtime for today. 0 turns it off (the dashboard
    # then counts today's readings live, which is slow on a large fleet).
    DASHBOARD_RUNTIME_REFRESH_SECONDS: int = 300
    DASHBOARD_STALE_AFTER_SECONDS: int = 900

    def publish_mode(self) -> str:
        mode = (self.IOT_PUBLISH_MODE or "").strip().lower()
        if mode in ("aws", "outbox", "off"):
            return mode
        return "outbox" if self.ENV == "development" else "aws"

    def get_database_url(self) -> str:
        url = self.DATABASE_URL
        if url:
            # Strip ?schema=... from URL since psycopg doesn't support 'schema' as connection parameter
            if "?" in url:
                base_part, query = url.split("?", 1)
                # Keep any other query params except schema
                params = [p for p in query.split("&") if not p.startswith("schema=")]
                url = base_part + (("?" + "&".join(params)) if params else "")

            if url.startswith("postgresql://"):
                return url.replace("postgresql://", "postgresql+psycopg://", 1)
            elif url.startswith("postgresql+psycopg://"):
                return url
        return f"postgresql+psycopg://{self.PGUSER}:{self.PGPASSWORD}@{self.PGHOST}:{self.PGPORT}/{self.PGDATABASE}"

    @property
    def dev_codes_enabled(self) -> bool:
        """True only on a developer machine (ENV=development): the fixed verification code 123456 is accepted and OTPs are
        returned in API responses. This is the ONE switch for every such shortcut; nothing else (an AUTH_PROVIDER value, a
        header, a client flag) may turn them on."""
        return self.ENV == "development"

    @model_validator(mode="after")
    def validate_environment_settings(self):
        # Anything that is not an explicit developer/test environment is treated as production, so a typo such as
        # ENV=prod or ENV=Production fails closed instead of quietly running with development shortcuts.
        if self.ENV not in ("development", "test"):
            if not self.JWT_SECRET or len(self.JWT_SECRET) < 32:
                raise ValueError("JWT_SECRET must be at least 32 characters outside development.")
            if self.ALLOW_SELF_REGISTRATION:
                object.__setattr__(self, "ALLOW_SELF_REGISTRATION", False)
            if str(getattr(self, "AUTH_PROVIDER", "") or "").strip().lower() == "mock":
                raise ValueError("AUTH_PROVIDER=mock (fixed verification codes) is only allowed with ENV=development.")
        return self

    class Config:
        env_file = str(BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "allow"

settings = Settings()

# Ensure JWT secret is provided or generate in-memory for dev only
if not settings.JWT_SECRET:
    if settings.ENV != "development":
        raise RuntimeError("JWT_SECRET must be configured in environment or Secrets Manager outside development.")
    import secrets
    settings.JWT_SECRET = secrets.token_hex(32)
