"""daily_summary RLS: tolerate a blank app.user_id

Revision ID: f5a7c9e1b3d5
Revises: e3b5c7d9f1a2
Create Date: 2026-09-26

`current_setting('app.user_id', true)::uuid` raises "invalid input syntax for type uuid" whenever the
variable exists but is empty, which is exactly what a pooled connection holds after RESET ALL (or after
a session that once set it). PostgreSQL does not promise to evaluate the OR branches left to right, so
the cast could run even when `app.bypass_rls` was already 'on'. NULLIF turns a blank into NULL, which
simply matches no user.
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'f5a7c9e1b3d5'
down_revision: Union[str, Sequence[str], None] = 'e3b5c7d9f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_POLICY = """
    DROP POLICY IF EXISTS rls_daily_summary_policy ON agripump.daily_summary;
    CREATE POLICY rls_daily_summary_policy ON agripump.daily_summary
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR device_id = current_setting('app.device_id', true)
        OR EXISTS (
            SELECT 1 FROM agripump.device_access da
            WHERE da.device_id = daily_summary.device_id
              AND da.user_id = {user_id}
        )
    );
"""


def upgrade() -> None:
    op.execute(_POLICY.format(user_id="NULLIF(current_setting('app.user_id', true), '')::uuid"))


def downgrade() -> None:
    op.execute(_POLICY.format(user_id="current_setting('app.user_id', true)::uuid"))
