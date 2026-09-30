"""org_tree_device_access

Revision ID: 0edb97889ebd
Revises: 0001_baseline_schema
Create Date: 2026-09-25 13:08:26.198253

"""
from typing import Sequence, Union
from alembic import op
from app.core.migration_helpers import create_table, add_column, create_index, create_foreign_key
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0edb97889ebd'
down_revision: Union[str, Sequence[str], None] = '0001_baseline_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Ensure ltree extension is enabled
    op.execute("CREATE EXTENSION IF NOT EXISTS ltree;")

    # 2. Create organisations table with depth limit constraint (depth <= 6)
    create_table(
        'organisations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('parent_id', sa.UUID(), nullable=True),
        sa.Column('type', sa.String(length=30), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('path', sa.Text(), nullable=False),
        sa.Column('depth', sa.SmallInteger(), server_default='0', nullable=False),
        sa.Column('status', sa.String(length=20), server_default='ACTIVE', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.CheckConstraint('depth >= 0 AND depth <= 6', name='ck_organisations_depth_max_6'),
        sa.CheckConstraint("type IN ('root', 'manufacturer', 'distributor', 'dealer')", name='ck_organisations_type'),
        sa.ForeignKeyConstraint(['parent_id'], ['agripump.organisations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        schema='agripump'
    )
    op.execute("ALTER TABLE agripump.organisations ALTER COLUMN path TYPE agripump.ltree USING path::agripump.ltree;")
    op.execute("CREATE INDEX idx_organisations_path ON agripump.organisations USING gist (path);")

    # 3. Add org_id and locale to users
    add_column('users', sa.Column('org_id', sa.UUID(), nullable=True), schema='agripump')
    create_foreign_key(
        'fk_users_org_id', 'users', 'organisations',
        ['org_id'], ['id'],
        source_schema='agripump', referent_schema='agripump',
        ondelete='SET NULL'
    )
    add_column('users', sa.Column('locale', sa.String(length=10), server_default='en', nullable=False), schema='agripump')

    # 4. Create sites table
    create_table(
        'sites',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('owner_user_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('lat', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('lng', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['agripump.users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        schema='agripump'
    )
    create_index('ix_sites_owner_user_id', 'sites', ['owner_user_id'], schema='agripump')

    # 5. Create device_access table
    create_table(
        'device_access',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('device_id', sa.String(length=50), nullable=False),
        sa.Column('role', sa.String(length=20), server_default='owner', nullable=False),
        sa.Column('nickname', sa.String(length=100), nullable=True),
        sa.Column('site_id', sa.UUID(), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['agripump.pumps.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['site_id'], ['agripump.sites.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['agripump.users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'device_id', name='uq_device_access_user_device'),
        schema='agripump'
    )
    create_index('ix_device_access_user_id', 'device_access', ['user_id'], schema='agripump')
    create_index('ix_device_access_device_id', 'device_access', ['device_id'], schema='agripump')

    # 6. Data migration: seed root organisation and populate device_access for existing pumps
    op.execute("""
        INSERT INTO agripump.organisations (id, parent_id, type, name, path, depth, status)
        VALUES ('a0000000-0000-0000-0000-000000000001'::uuid, NULL, 'root', 'AgriPump Enterprise', 'root'::agripump.ltree, 0, 'ACTIVE')
        ON CONFLICT DO NOTHING;
    """)

    op.execute("""
        INSERT INTO agripump.device_access (id, user_id, device_id, role, sort_order)
        SELECT gen_random_uuid(), owner_user_id, id, 'owner', 0
        FROM agripump.pumps
        WHERE owner_user_id IS NOT NULL
        ON CONFLICT (user_id, device_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_table('device_access', schema='agripump')
    op.drop_table('sites', schema='agripump')
    op.drop_constraint('fk_users_org_id', 'users', schema='agripump', type_='foreignkey')
    op.drop_column('users', 'locale', schema='agripump')
    op.drop_column('users', 'org_id', schema='agripump')
    op.drop_table('organisations', schema='agripump')
