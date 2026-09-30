"""row-level security: partner scope by path boundary, and a blank setting matches nothing

Revision ID: d4f6b8a0c2e4
Revises: c1e3a5b7d9f2
Create Date: 2026-09-28

The pumps policy let a dealer / distributor / manufacturer see a pump when
`hierarchy_path LIKE <own path> || '%'`. Two defects:

1. No path boundary: a dealer at /SA/D1 also matched /SA/D10 (and /SA/D1x...), so one dealer could read, and through
   the API command, a neighbour's pumps. `_` and `%` inside a path were also LIKE wildcards.
2. A blank setting matched everything. After RESET ALL a custom setting reads as '' rather than NULL, and the policy
   only tested IS NOT NULL: an empty `app.hierarchy_path` made `LIKE '%'` true for every row, and an empty
   `app.org_path` (cast to an empty ltree, the ancestor of every path) matched every pump that has an organisation.

The other tables (telemetry, commands, alerts, faults, config) decide by "is the pump visible", so this one policy
covers them. Same rule now: own path or below, compared exactly, and blank means no access.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd4f6b8a0c2e4'
down_revision: Union[str, Sequence[str], None] = 'c1e3a5b7d9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_POLICY = """
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
                {org_test}
            )
            OR (
                {path_test}
            )
        )
    )
);
"""

_NEW_ORG = """NULLIF(current_setting('app.org_path', true), '') IS NOT NULL
                AND org_id IN (
                    SELECT id FROM agripump.organisations
                    WHERE path OPERATOR(agripump.<@) NULLIF(current_setting('app.org_path', true), '')::agripump.ltree
                )"""
_NEW_PATH = """NULLIF(rtrim(current_setting('app.hierarchy_path', true), '/'), '') IS NOT NULL
                AND (
                    hierarchy_path = rtrim(current_setting('app.hierarchy_path', true), '/')
                    OR left(hierarchy_path, length(rtrim(current_setting('app.hierarchy_path', true), '/')) + 1)
                       = rtrim(current_setting('app.hierarchy_path', true), '/') || '/'
                )"""

_OLD_ORG = """current_setting('app.org_path', true) IS NOT NULL
                AND org_id IN (
                    SELECT id FROM agripump.organisations
                    WHERE path OPERATOR(agripump.<@) current_setting('app.org_path', true)::agripump.ltree
                )"""
_OLD_PATH = """current_setting('app.hierarchy_path', true) IS NOT NULL
                AND hierarchy_path LIKE current_setting('app.hierarchy_path', true) || '%'"""


def upgrade() -> None:
    op.execute(_POLICY.format(org_test=_NEW_ORG, path_test=_NEW_PATH))


def downgrade() -> None:
    op.execute(_POLICY.format(org_test=_OLD_ORG, path_test=_OLD_PATH))
