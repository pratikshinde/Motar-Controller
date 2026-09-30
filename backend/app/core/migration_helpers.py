"""Migration operations that are safe on a database that already has part of the schema.

A database built by hand (`schema.sql`, `create_all`) has some of what the early migrations create. These wrappers
skip what is already there instead of failing, so such a database can be brought under Alembic by stamping it at the
baseline and upgrading. On an empty database they behave exactly like the plain operations.
"""
from alembic import op
from sqlalchemy import text


def create_table(name, *columns, **kw):
    return op.create_table(name, *columns, if_not_exists=True, **kw)


def add_column(table_name, column, **kw):
    return op.add_column(table_name, column, if_not_exists=True, **kw)


def create_index(index_name, table_name, columns, **kw):
    return op.create_index(index_name, table_name, columns, if_not_exists=True, **kw)


def create_foreign_key(constraint_name, source_table, referent_table, local_cols, remote_cols, **kw):
    """Add the foreign key unless a constraint of that name is already on the table."""
    schema = kw.get("source_schema") or kw.get("schema")
    qualified = f'"{schema}"."{source_table}"' if schema else f'"{source_table}"'
    exists = op.get_bind().execute(
        text("SELECT 1 FROM pg_constraint WHERE conname = :n AND conrelid = CAST(:t AS regclass)"),
        {"n": constraint_name, "t": qualified},
    ).first()
    if exists:
        return None
    return op.create_foreign_key(constraint_name, source_table, referent_table, local_cols, remote_cols, **kw)
