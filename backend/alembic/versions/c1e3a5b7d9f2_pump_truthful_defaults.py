"""pumps: a pump that never reported has no last_seen_at, and an unknown position is NULL, not (0, 0)

Revision ID: c1e3a5b7d9f2
Revises: b9d1f3a5c7e9
Create Date: 2026-09-28

`pumps.last_seen_at` defaulted to the moment the row was created, so a pump that had never sent a single reading
showed as online right after commissioning. `latitude` / `longitude` were NOT NULL, so "position unknown" was stored
as (0, 0) (or as the default position of one particular city).

* last_seen_at loses its default; rows that have no telemetry and no daily summary at all go back to NULL
  (they never reported; the timestamp was only their creation time).
* latitude / longitude may be NULL; the (0, 0) placeholder and the old create-a-pump default (19.9975, 73.7898)
  become NULL.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c1e3a5b7d9f2'
down_revision: Union[str, Sequence[str], None] = 'b9d1f3a5c7e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # `pumps` has FORCE row-level security: without this the UPDATEs below would match nothing.
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")

    op.execute("ALTER TABLE agripump.pumps ALTER COLUMN last_seen_at DROP DEFAULT")
    op.execute("""
        UPDATE agripump.pumps p SET last_seen_at = NULL
        WHERE NOT EXISTS (SELECT 1 FROM agripump.telemetry_history t WHERE t.pump_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM agripump.daily_summary d WHERE d.device_id = p.id)
    """)

    op.execute("ALTER TABLE agripump.pumps ALTER COLUMN latitude DROP NOT NULL")
    op.execute("ALTER TABLE agripump.pumps ALTER COLUMN longitude DROP NOT NULL")
    op.execute("""
        UPDATE agripump.pumps SET latitude = NULL, longitude = NULL
        WHERE (latitude = 0 AND longitude = 0) OR (latitude = 19.9975 AND longitude = 73.7898)
    """)


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("UPDATE agripump.pumps SET latitude = 0 WHERE latitude IS NULL")
    op.execute("UPDATE agripump.pumps SET longitude = 0 WHERE longitude IS NULL")
    op.execute("ALTER TABLE agripump.pumps ALTER COLUMN latitude SET NOT NULL")
    op.execute("ALTER TABLE agripump.pumps ALTER COLUMN longitude SET NOT NULL")
    op.execute("ALTER TABLE agripump.pumps ALTER COLUMN last_seen_at SET DEFAULT CURRENT_TIMESTAMP")
