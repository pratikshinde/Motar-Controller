"""brands.owner_user_id: which account IS the manufacturer

Revision ID: phase5_brand_owner
Revises: phase5_brands

The platform owner (super admin) opens a manufacturer's dashboard from the "Manufacturers" page. That needs to be exact:
a brand points at the one account that is the manufacturer, and the dashboard is that account's tree (its distributors,
dealers, farmers and pumps) and nothing else. Guessing it from "some manufacturer-role user with this brand" is unsafe,
because a platform can hold several manufacturer-role accounts (staff, test accounts, a manufacturer's second login).

Backfill: a brand that has no owner yet gets the oldest active manufacturer account of its own that sits in a real tree
(not the bare platform root). Brands with none are left empty and shown as "no account yet" until one is created.
"""
from alembic import op

revision = "phase5_brand_owner"
down_revision = "phase5_brands"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("""
        ALTER TABLE agripump.brands
        ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES agripump.users(id) ON DELETE SET NULL
    """)
    op.execute("""
        UPDATE agripump.brands b SET owner_user_id = (
            SELECT u.id FROM agripump.users u
            WHERE u.brand_id = b.id AND lower(u.role) = 'manufacturer' AND u.is_active
              AND coalesce(u.org_role, 'owner') = 'owner'
              AND u.hierarchy_path LIKE '/%/%'
            ORDER BY u.created_at ASC LIMIT 1
        )
        WHERE b.owner_user_id IS NULL
    """)


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("ALTER TABLE agripump.brands DROP COLUMN IF EXISTS owner_user_id")
