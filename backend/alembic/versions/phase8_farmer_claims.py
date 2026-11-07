"""farmer registration by a dealer: the farmer's address, and the one-time QR code that gives the farmer's phone access

Revision ID: phase8_farmer_claims
Revises: phase7_push_tokens

A dealer registers a farmer on the website (name, address, phone, starter, pump capacity) and gets a QR code. The farmer scans it in
the app once. Only a hash of the QR's secret is kept (like a password), so a database leak does not leak working QR codes.
One row per QR issued; a new QR for the same farmer revokes the older ones.
"""
from alembic import op

revision = "phase8_farmer_claims"
down_revision = "phase7_push_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS address text")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.farmer_claims (
            id                  bigserial PRIMARY KEY,
            user_id             uuid NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
            token_hash          varchar(64) NOT NULL,
            created_by          uuid REFERENCES agripump.users(id) ON DELETE SET NULL,
            created_at          timestamptz NOT NULL DEFAULT now(),
            expires_at          timestamptz NOT NULL,
            claimed_at          timestamptz,
            claimed_install_id  varchar(100),
            revoked_at          timestamptz,
            attempts            integer NOT NULL DEFAULT 0,
            CONSTRAINT uq_farmer_claims_token_hash UNIQUE (token_hash)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_farmer_claims_user_id ON agripump.farmer_claims (user_id)")


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP TABLE IF EXISTS agripump.farmer_claims")
    op.execute("ALTER TABLE agripump.users DROP COLUMN IF EXISTS address")
