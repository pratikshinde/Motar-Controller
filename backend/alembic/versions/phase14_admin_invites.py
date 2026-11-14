"""adding an admin: a code emailed to them, verified by the platform owner, then the admin chooses a password

Revision ID: phase14_admin_invites
Revises: phase13_email_login_codes

The platform owner enters the new admin's name, company, address, phone and email; a 6-digit code is emailed to the admin, who reads it out. The owner types it in, which proves the
email and creates the account (no password). The admin then chooses their own password with the same code, once. Only a keyed hash of the code is kept.
"""
from alembic import op

revision = "phase14_admin_invites"
down_revision = "phase13_email_login_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.admin_invites (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email        varchar(254) NOT NULL,
            full_name    varchar(100) NOT NULL,
            company_name varchar(100),
            address      text,
            phone        varchar(20),
            brand_key    varchar(30),
            code_hash    varchar(64) NOT NULL,
            created_by   uuid REFERENCES agripump.users(id) ON DELETE SET NULL,
            created_at   timestamptz NOT NULL DEFAULT now(),
            expires_at   timestamptz NOT NULL,
            attempts     integer NOT NULL DEFAULT 0,
            verified_at  timestamptz,
            completed_at timestamptz,
            revoked_at   timestamptz,
            user_id      uuid REFERENCES agripump.users(id) ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_admin_invites_email ON agripump.admin_invites (email)")


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP TABLE IF EXISTS agripump.admin_invites")
