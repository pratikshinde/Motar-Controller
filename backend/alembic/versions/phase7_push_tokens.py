"""push tokens: the phones that get notifications (Firebase Cloud Messaging)

Revision ID: phase7_push_tokens
Revises: phase6_solar_vfd

One row per phone (its FCM registration token) per signed-in person. A phone that signs out, or that Firebase says no longer
exists, loses its row. Row-level security: a person sees only their own tokens; the background workers bypass it.
"""
from alembic import op

revision = "phase7_push_tokens"
down_revision = "phase6_solar_vfd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.push_tokens (
            id          bigserial PRIMARY KEY,
            user_id     uuid NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
            token       text NOT NULL,
            platform    varchar(10) NOT NULL DEFAULT 'android',
            created_at  timestamptz NOT NULL DEFAULT now(),
            updated_at  timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_push_tokens_token UNIQUE (token)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_push_tokens_user_id ON agripump.push_tokens (user_id)")
    op.execute("ALTER TABLE agripump.push_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS rls_push_tokens_policy ON agripump.push_tokens")
    op.execute("""
        CREATE POLICY rls_push_tokens_policy ON agripump.push_tokens
        FOR ALL
        USING (
            current_setting('app.bypass_rls', true) = 'on'
            OR user_id::text = current_setting('app.user_id', true)
        )
    """)


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP TABLE IF EXISTS agripump.push_tokens")
