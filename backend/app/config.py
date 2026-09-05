import os
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    PROJECT_NAME: str = "AgriPump SmartSpace IoT Platform"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    PORT: int = 5000
    HOST: str = "127.0.0.1"
    
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

    class Config:
        env_file = str(BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "allow"

settings = Settings()

# Ensure JWT secret exists or is loaded from .jwt-secret
jwt_secret_path = BASE_DIR / ".jwt-secret"
if not settings.JWT_SECRET:
    if jwt_secret_path.exists():
        settings.JWT_SECRET = jwt_secret_path.read_text(encoding="utf-8").strip()
    else:
        import secrets
        new_secret = secrets.token_hex(32)
        jwt_secret_path.write_text(new_secret, encoding="utf-8")
        settings.JWT_SECRET = new_secret
