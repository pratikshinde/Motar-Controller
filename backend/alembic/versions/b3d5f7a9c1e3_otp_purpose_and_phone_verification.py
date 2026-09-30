"""Multi-purpose OTP challenges + phone-verification tickets (WhatsApp registration/password-reset, planned).

`otp_challenges` went from one row per phone (whatever the newest OTP request was, for login only) to one row
per (phone, purpose) — a phone can now have a pending login challenge and a pending registration challenge at
once. `phone_number` can no longer be the primary key; the table is rebuilt with a surrogate `id`, plus
`purpose`, `channel` and `consumed_at`. New `phone_verifications`: a short-lived, single-use ticket minted after
a correct OTP for `registration` or `password_reset`, spent to finish that specific action (mirrors
`invite_tokens`).

`otp_challenges` holds nothing but in-flight, minutes-lived challenges (rows are deleted by the app itself on
every outcome today); rebuilding it loses at most a handful of OTPs someone requested in roughly the last five
minutes, who would simply need to ask for a new one. Not a concern for durable data the way any other table in
this schema is.

Revision ID: b3d5f7a9c1e3
Revises: a8c0e2f4b6d9
"""
from typing import Sequence, Union

from alembic import op

revision: str = "b3d5f7a9c1e3"
down_revision: Union[str, Sequence[str], None] = "a8c0e2f4b6d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "agripump"


def upgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {S}.otp_challenges")
    op.execute(f"""
        CREATE TABLE {S}.otp_challenges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone_number VARCHAR(20) NOT NULL,
            purpose VARCHAR(20) NOT NULL DEFAULT 'login'
                CHECK (purpose IN ('login', 'registration', 'password_reset')),
            channel VARCHAR(10) NOT NULL DEFAULT 'sms'
                CHECK (channel IN ('sms', 'whatsapp')),
            code_hash VARCHAR(64) NOT NULL,
            attempts INTEGER DEFAULT 0,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_otp_challenges_phone ON {S}.otp_challenges (phone_number)")
    # At most one unconsumed challenge per (phone, purpose) — the DB-level form of "look one up, overwrite it,
    # else insert" the app already did for login, now scoped by purpose too.
    op.execute(f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_otp_challenges_active ON {S}.otp_challenges (phone_number, purpose)
        WHERE consumed_at IS NULL
    """)

    op.execute(f"""
        CREATE TABLE IF NOT EXISTS {S}.phone_verifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone_number VARCHAR(20) NOT NULL,
            purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('registration', 'password_reset')),
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            created_at TIMESTAMPTZ DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ
        )
    """)
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_phone_verifications_phone ON {S}.phone_verifications (phone_number)")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {S}.phone_verifications")
    op.execute(f"DROP TABLE IF EXISTS {S}.otp_challenges")
    op.execute(f"""
        CREATE TABLE {S}.otp_challenges (
            phone_number VARCHAR(20) PRIMARY KEY,
            otp_code VARCHAR(64) NOT NULL,
            attempts INTEGER DEFAULT 0,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
