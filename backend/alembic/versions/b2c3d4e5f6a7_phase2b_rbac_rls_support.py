"""Phase 2B: Add support role to PostgreSQL RLS pump policy

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-30
"""
from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_POLICY_UPGRADE = """
DROP POLICY IF EXISTS rls_pumps_policy ON agripump.pumps;
CREATE POLICY rls_pumps_policy ON agripump.pumps
FOR ALL
USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR current_setting('app.user_role', true) = 'superadmin'
    OR current_setting('app.device_id', true) = id
    OR (
        current_setting('app.user_role', true) = 'customer'
        AND (
            owner_user_id::text = current_setting('app.user_id', true)
            OR id IN (
                SELECT device_id FROM agripump.device_access
                WHERE user_id::text = current_setting('app.user_id', true)
            )
        )
    )
    OR (
        current_setting('app.user_role', true) IN ('dealer', 'distributor', 'manufacturer', 'support')
        AND (
            (
                NULLIF(current_setting('app.org_path', true), '') IS NOT NULL
                AND org_id IN (
                    SELECT id FROM agripump.organisations
                    WHERE path OPERATOR(agripump.<@) NULLIF(current_setting('app.org_path', true), '')::agripump.ltree
                )
            )
            OR (
                NULLIF(rtrim(current_setting('app.hierarchy_path', true), '/'), '') IS NOT NULL
                AND (
                    hierarchy_path = rtrim(current_setting('app.hierarchy_path', true), '/')
                    OR left(hierarchy_path, length(rtrim(current_setting('app.hierarchy_path', true), '/')) + 1)
                       = rtrim(current_setting('app.hierarchy_path', true), '/') || '/'
                )
            )
        )
    )
);
"""

_POLICY_DOWNGRADE = """
DROP POLICY IF EXISTS rls_pumps_policy ON agripump.pumps;
CREATE POLICY rls_pumps_policy ON agripump.pumps
FOR ALL
USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR current_setting('app.user_role', true) = 'superadmin'
    OR current_setting('app.device_id', true) = id
    OR (
        current_setting('app.user_role', true) = 'customer'
        AND (
            owner_user_id::text = current_setting('app.user_id', true)
            OR id IN (
                SELECT device_id FROM agripump.device_access
                WHERE user_id::text = current_setting('app.user_id', true)
            )
        )
    )
    OR (
        current_setting('app.user_role', true) IN ('dealer', 'distributor', 'manufacturer')
        AND (
            (
                NULLIF(current_setting('app.org_path', true), '') IS NOT NULL
                AND org_id IN (
                    SELECT id FROM agripump.organisations
                    WHERE path OPERATOR(agripump.<@) NULLIF(current_setting('app.org_path', true), '')::agripump.ltree
                )
            )
            OR (
                NULLIF(rtrim(current_setting('app.hierarchy_path', true), '/'), '') IS NOT NULL
                AND (
                    hierarchy_path = rtrim(current_setting('app.hierarchy_path', true), '/')
                    OR left(hierarchy_path, length(rtrim(current_setting('app.hierarchy_path', true), '/')) + 1)
                       = rtrim(current_setting('app.hierarchy_path', true), '/') || '/'
                )
            )
        )
    )
);
"""

def upgrade() -> None:
    op.execute(_POLICY_UPGRADE)

def downgrade() -> None:
    op.execute(_POLICY_DOWNGRADE)
