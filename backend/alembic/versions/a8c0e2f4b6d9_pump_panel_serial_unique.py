"""A panel serial identifies one physical panel: it can be bound to only one device (FR-WEB-031).

Partial unique index, so the many devices without a panel bound (NULL) do not collide. If existing rows already
share a serial the index is skipped with a warning instead of failing the upgrade; clean those rows and run again.

Revision ID: a8c0e2f4b6d9
Revises: f7b9d1e3a5c8
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a8c0e2f4b6d9"
down_revision: Union[str, Sequence[str], None] = "f7b9d1e3a5c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    DO $$
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_pumps_panel_serial ON agripump.pumps (panel_serial)
            WHERE panel_serial IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'schema: unique index uq_pumps_panel_serial not created, pumps.panel_serial holds duplicates';
    END $$;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS agripump.uq_pumps_panel_serial")
