"""auth_hardening_and_invites

Revision ID: 0bb2f7da69cd
Revises: b8367a6be91d
Create Date: 2026-09-25 13:32:36.129987

"""
from typing import Sequence, Union
from alembic import op
from app.core.migration_helpers import add_column, create_index, create_foreign_key
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0bb2f7da69cd'
down_revision: Union[str, Sequence[str], None] = 'b8367a6be91d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. users: add session_version
    add_column(
        'users',
        sa.Column('session_version', sa.Integer(), server_default='1', nullable=False),
        schema='agripump'
    )

    # 2. refresh_tokens: add family_id, app_install_id, device_info, last_used_at
    add_column(
        'refresh_tokens',
        sa.Column('family_id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        schema='agripump'
    )
    add_column(
        'refresh_tokens',
        sa.Column('app_install_id', sa.String(length=100), nullable=True),
        schema='agripump'
    )
    add_column(
        'refresh_tokens',
        sa.Column('device_info', sa.String(length=255), nullable=True),
        schema='agripump'
    )
    add_column(
        'refresh_tokens',
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        schema='agripump'
    )
    create_index(
        'ix_refresh_tokens_family_id',
        'refresh_tokens',
        ['family_id'],
        unique=False,
        schema='agripump'
    )

    # 3. invites: add phone, device_id, invited_by, status
    add_column(
        'invites',
        sa.Column('phone', sa.String(length=20), nullable=True),
        schema='agripump'
    )
    add_column(
        'invites',
        sa.Column('device_id', sa.String(length=50), nullable=True),
        schema='agripump'
    )
    add_column(
        'invites',
        sa.Column('invited_by', sa.UUID(), nullable=True),
        schema='agripump'
    )
    add_column(
        'invites',
        sa.Column('status', sa.String(length=20), server_default='PENDING', nullable=False),
        schema='agripump'
    )
    create_foreign_key(
        'fk_invites_invited_by',
        'invites', 'users',
        ['invited_by'], ['id'],
        source_schema='agripump', referent_schema='agripump',
        ondelete='SET NULL'
    )
    create_foreign_key(
        'fk_invites_device_id',
        'invites', 'pumps',
        ['device_id'], ['id'],
        source_schema='agripump', referent_schema='agripump',
        ondelete='CASCADE'
    )


def downgrade() -> None:
    op.drop_constraint('fk_invites_device_id', 'invites', schema='agripump', type_='foreignkey')
    op.drop_constraint('fk_invites_invited_by', 'invites', schema='agripump', type_='foreignkey')
    op.drop_column('invites', 'status', schema='agripump')
    op.drop_column('invites', 'invited_by', schema='agripump')
    op.drop_column('invites', 'device_id', schema='agripump')
    op.drop_column('invites', 'phone', schema='agripump')

    op.drop_index('ix_refresh_tokens_family_id', table_name='refresh_tokens', schema='agripump')
    op.drop_column('refresh_tokens', 'last_used_at', schema='agripump')
    op.drop_column('refresh_tokens', 'device_info', schema='agripump')
    op.drop_column('refresh_tokens', 'app_install_id', schema='agripump')
    op.drop_column('refresh_tokens', 'family_id', schema='agripump')

    op.drop_column('users', 'session_version', schema='agripump')
