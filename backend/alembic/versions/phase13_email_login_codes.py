"""emailed sign-in codes for the admin and the platform owner

Revision ID: phase13_email_login_codes
Revises: phase12_partner_registrations

An admin signs in with an email and a code sent to that email (no password); the platform owner does the same and then also enters the authenticator
code. Only a keyed hash of each code is kept.
"""
from alembic import op

revision = "phase13_email_login_codes"
down_revision = "phase12_partner_registrations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.email_login_codes (
            id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email      varchar(254) NOT NULL,
            code_hash  varchar(64) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL,
            attempts   integer NOT NULL DEFAULT 0,
            used_at    timestamptz
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_email_login_codes_email ON agripump.email_login_codes (email)")


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP TABLE IF EXISTS agripump.email_login_codes")
