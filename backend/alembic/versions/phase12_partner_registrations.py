"""registering a distributor or a dealer: a pending registration that becomes an account only after the QR is scanned and the password is typed

Revision ID: phase12_partner_registrations
Revises: phase11_starter_details

The admin (or a distributor, for a dealer) types the new person's name, address and mobile number. That saves a pending registration and shows a QR; no
account exists yet. When the new person scans the QR a one-time password is made and shown to the admin, who sends it to them. They type their mobile
number and that password, then choose their own password: only then is the account created. Only hashes of the QR secret, the password and the
activation ticket are kept; the password is also held in clear until the admin has seen it once.
"""
from alembic import op

revision = "phase12_partner_registrations"
down_revision = "phase11_starter_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.partner_registrations (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            role              varchar(20) NOT NULL,
            full_name         varchar(100) NOT NULL,
            address           text NOT NULL,
            phone             varchar(20) NOT NULL,
            parent_user_id    uuid NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
            created_by        uuid REFERENCES agripump.users(id) ON DELETE SET NULL,
            token_hash        varchar(64) NOT NULL,
            created_at        timestamptz NOT NULL DEFAULT now(),
            expires_at        timestamptz NOT NULL,
            scanned_at        timestamptz,
            code_hash         varchar(64),
            code_plain        varchar(20),
            code_expires_at   timestamptz,
            code_revealed_at  timestamptz,
            attempts          integer NOT NULL DEFAULT 0,
            ticket_hash       varchar(64),
            ticket_expires_at timestamptz,
            completed_at      timestamptz,
            user_id           uuid REFERENCES agripump.users(id) ON DELETE SET NULL,
            revoked_at        timestamptz,
            CONSTRAINT uq_partner_registrations_token_hash UNIQUE (token_hash)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_partner_registrations_parent_user_id ON agripump.partner_registrations (parent_user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_partner_registrations_phone ON agripump.partner_registrations (phone)")


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP TABLE IF EXISTS agripump.partner_registrations")
