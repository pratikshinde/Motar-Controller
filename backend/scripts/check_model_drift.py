"""Fail if the SQLAlchemy models and the database (as built by the migrations) disagree.

    DATABASE_URL=postgresql://... python scripts/check_model_drift.py

Run it after `alembic upgrade head` on an empty database: whatever it prints is a model change with no migration
(or a migration the models do not know about). Exit 0 = they agree, 1 = they differ.

Only the application schema is compared (and not Alembic's own version table). Indexes, CHECK constraints, defaults,
policies and triggers are written in SQL in the migrations and are compared by scripts/schema_diff.py instead.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.config import settings
from app.database import Base
import app.models  # noqa: F401 - registers every model on Base

def describe(diff) -> str:
    if isinstance(diff, list):  # a batch of modify_* ops on one column
        return "; ".join(describe(d) for d in diff)
    kind = diff[0]
    if kind in ("add_table", "remove_table"):
        return f"{kind}: {diff[1].name}"
    if kind in ("add_column", "remove_column"):
        return f"{kind}: {diff[2]}.{diff[3].name}"
    if kind.startswith("modify_"):
        return f"{kind}: {diff[2]}.{diff[3]} {diff[-2]!r} -> {diff[-1]!r}"
    if kind in ("add_fk", "remove_fk"):
        return f"{kind}: {diff[1].table.name}({','.join(diff[1].column_keys)})"
    if kind in ("add_constraint", "remove_constraint"):
        c = diff[1]
        return f"{kind}: {getattr(c.table, 'name', '?')} {getattr(c, 'name', None) or type(c).__name__}"
    return str(diff)[:200]


def main() -> int:
    engine = create_engine(settings.get_database_url())
    with engine.connect() as conn:
        ctx = MigrationContext.configure(
            conn,
            opts={
                "compare_type": True,
                "compare_server_default": False,          # defaults live in the migrations (documented there)
                "include_schemas": True,
                "include_object": lambda obj, name, type_, reflected, compare_to:
                    (obj.schema == settings.PGSCHEMA and name != "alembic_version") if type_ == "table" else True,
            },
        )
        diffs = compare_metadata(ctx, Base.metadata)

    kept = []
    for d in diffs:
        first = d[0] if not isinstance(d, list) else d[0][0]
        text = describe(d)
        # indexes and check constraints written in SQL are compared by scripts/schema_diff.py, not here
        if first in ("add_index", "remove_index", "remove_constraint", "add_constraint") and ("Index" in text or "Check" in text or "index" in text):
            continue
        kept.append(text)

    for line in sorted(kept):
        print(line)
    print(f"\n{len(kept)} difference(s) between the models and the migrated database" if kept else "Models and migrations agree.")
    return 1 if kept else 0


if __name__ == "__main__":
    sys.exit(main())
