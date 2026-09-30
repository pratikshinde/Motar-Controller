from contextlib import contextmanager
from typing import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from app.config import settings

# Engine configuration with schema option in search_path
db_url = settings.get_database_url()

engine = create_engine(
    db_url,
    connect_args={
        # timezone=UTC: the code stores naive UTC datetimes (datetime.utcnow()); with any other session
        # timezone PostgreSQL would read them as local time and every timestamp would be off by the offset.
        "options": f"-csearch_path={settings.PGSCHEMA},public -cstatement_timeout=10000 -ctimezone=UTC"
    },
    pool_pre_ping=True,
    pool_size=50,
    max_overflow=20,
    pool_timeout=30,
    pool_recycle=1800,
)



class PinnedSession(Session):
    """A Session that keeps ONE pooled connection for its whole lifetime.

    Row-level security keys off session variables set on the connection (app.user_id, app.bypass_rls ...).
    A plain Session gives its connection back to the pool on every commit() and takes whichever is free
    next, so a read after a commit (refresh(), lazy attributes) could run on a connection that carries no
    actor context and silently find nothing, or worse, on one that still carries someone else's.
    """

    def __init__(self, **kwargs):
        self._owned_connection = None
        if kwargs.get("bind") is None:
            self._owned_connection = engine.connect()
            kwargs["bind"] = self._owned_connection
        super().__init__(**kwargs)

    def close(self):
        super().close()
        conn, self._owned_connection = self._owned_connection, None
        if conn is not None:
            try:
                # Whatever actor context this session set (a user, or the bypass) must not travel with the
                # connection back into the pool, whoever forgot to clear it.
                conn.execute(text("RESET ALL"))
                conn.commit()
            except Exception:
                conn.invalidate()      # cannot vouch for its state: never hand it to the next request
            conn.close()


SessionLocal = sessionmaker(class_=PinnedSession, autocommit=False, autoflush=False)

Base = declarative_base()

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            # Clear the actor context for good (committed), so it cannot leak to the next request.
            db.rollback()
            db.execute(text("RESET ALL;"))
            db.commit()
        except Exception:
            pass
        db.close()

@contextmanager
def system_session() -> Generator[Session, None, None]:
    """A session for background work that is not on behalf of any user (sweeps, dispatch, ingestion).

    Row-level security is bypassed for it, and the bypass is cleared before the connection goes back to the pool.
    """
    db = SessionLocal()
    try:
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
        yield db
    finally:
        try:
            db.rollback()
            db.execute(text("RESET ALL;"))
            db.commit()
        except Exception:
            pass
        db.close()


def check_timescaledb_extension(db_session: Session) -> bool:
    """
    Checks if timescaledb extension is available and enabled.
    DDL migrations are managed exclusively by Alembic, never at application startup.
    """
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
