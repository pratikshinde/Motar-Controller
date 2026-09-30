import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool, text
from alembic import context

# Ensure app is importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config import settings
from app.database import Base
import app.models  # noqa: F401 - ensure all models are registered on Base

# Alembic Config object
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def include_object(object, name, type_, reflected, compare_to):
    """
    Ensure Alembic only operates on the agripump schema and leaves public / other schemas untouched.
    """
    if type_ == "table":
        return object.schema == settings.PGSCHEMA
    return True

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = settings.get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=settings.PGSCHEMA,
        include_schemas=True,
        include_object=include_object
    )

    with context.begin_transaction():
        context.run_migrations()

def bootstrap(connection) -> None:
    """What every migration assumes exists, created here so an empty database needs no manual step first.

    The version table itself lives in the application schema, so the schema must exist before Alembic can even
    record where it is. `ltree` (hierarchy paths) is installed into that schema. Both statements are no-ops on a
    database that already has them.
    """
    schema = settings.PGSCHEMA
    connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    connection.execute(text(f'CREATE EXTENSION IF NOT EXISTS ltree SCHEMA "{schema}"'))
    connection.commit()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.get_database_url()

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        bootstrap(connection)
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=settings.PGSCHEMA,
            include_schemas=True,
            include_object=include_object
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
