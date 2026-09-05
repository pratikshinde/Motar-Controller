from typing import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from app.config import settings

# Engine configuration with schema option in search_path
db_url = settings.get_database_url()

engine = create_engine(
    db_url,
    connect_args={
        "options": f"-csearch_path={settings.PGSCHEMA},public"
    },
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def setup_timescaledb(db_session: Session) -> bool:
    """
    Applies schema migrations and attempts to enable TimescaleDB hypertable for telemetry_history.
    """
    # 1. Update commands table constraint and fault_logs schema if present
    try:
        db_session.execute(text("ALTER TABLE agripump.commands ALTER COLUMN action TYPE VARCHAR(30);"))
        db_session.execute(text("ALTER TABLE agripump.commands DROP CONSTRAINT IF EXISTS commands_action_check;"))
        db_session.execute(text("ALTER TABLE agripump.commands ADD CONSTRAINT commands_action_check CHECK (action IN ('START', 'STOP', 'SET_TIMER', 'UPDATE_CONFIG'));"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS fault_description TEXT;"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS v_ry NUMERIC(6,2);"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS v_yb NUMERIC(6,2);"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS v_br NUMERIC(6,2);"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS i_r NUMERIC(6,2);"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS i_y NUMERIC(6,2);"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS i_b NUMERIC(6,2);"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS ack_by_user_id UUID;"))
        db_session.execute(text("ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS ack_at TIMESTAMP WITH TIME ZONE;"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS hp_rating NUMERIC(4,1);"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS supply_type VARCHAR(20) DEFAULT '3-phase';"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS config_json JSONB DEFAULT '{}';"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS description TEXT;"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS desired_json JSONB DEFAULT '{}';"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS owner_user_id UUID;"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS owner_hierarchy_path TEXT;"))
        db_session.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;"))
        db_session.commit()
    except Exception as e:
        db_session.rollback()

    # 2. Check if timescaledb is an available extension
    try:
        res = db_session.execute(text("SELECT name FROM pg_available_extensions WHERE name = 'timescaledb'")).scalar()
        if not res:
            return False
            
        db_session.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"))
        db_session.commit()
        
        # Turn telemetry_history into a hypertable partitioned by recorded_at
        db_session.execute(text(
            "SELECT create_hypertable('agripump.telemetry_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE);"
        ))
        db_session.commit()
        return True
    except Exception as e:
        db_session.rollback()
        print(f"Notice: TimescaleDB setup skipped or fallback active: {e}")
        return False
