import os
import secrets
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
from pathlib import Path
from sqlalchemy import text
from app.database import engine, SessionLocal, setup_timescaledb, Base
from app.models import User, Pump, DeviceConfig, FaultCodeCatalog
from app.services.jwt_auth import hash_secret

def init_db():
    print("🔄 Initializing database with SQLAlchemy...")
    db = SessionLocal()
    try:
        # Create schema if not exists
        db.execute(text("CREATE SCHEMA IF NOT EXISTS agripump;"))
        db.commit()

        # Run TimescaleDB setup
        is_timescale = setup_timescaledb(db)
        if is_timescale:
            print("🚀 TimescaleDB hypertable successfully enabled for telemetry_history!")
        else:
            print("ℹ️ TimescaleDB extension not available on this PG instance; standard indexed time-series table active.")

        # Check for superadmin
        superadmin = db.query(User).filter(User.role == "superadmin").order_by(User.created_at.asc()).first()
        if superadmin and not superadmin.password_hash:
            plain_pass = secrets.token_urlsafe(9)
            superadmin.password_hash = hash_secret(plain_pass)
            db.commit()
            print("\n============================================================")
            print("🔐 SUPERADMIN PASSWORD GENERATED (save it now):")
            print(f"   phone:    {superadmin.phone_number}")
            print(f"   password: {plain_pass}")
            print("============================================================\n")

        print("🎉 Database initialization complete!")
    except Exception as e:
        print(f"❌ Error during DB init: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
