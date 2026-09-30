"""branding: one shape for databases built from schema.sql and from Alembic

Revision ID: b9d1f3a5c7e9
Revises: a7c9e1b3d5f7
Create Date: 2026-09-28

`schema.sql` created `branding(id, user_id, primary_color NOT NULL, notification_sender_name, updated_by, ...)`,
the ORM model and the Alembic baseline use `branding(org_id, theme_color, sender_name, ...)`. On a database built
from `schema.sql` every page load of the portal called GET /branding/resolve, which failed with
"column branding.org_id does not exist" (HTTP 500).

This renames the old columns to the model's names in place, keeping any rows, and does nothing on a database
that already has the model's shape. `id` and `updated_by` are kept (unused by the model, harmless).
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b9d1f3a5c7e9'
down_revision: Union[str, Sequence[str], None] = 'a7c9e1b3d5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'agripump' AND table_name = 'branding' AND column_name = 'user_id'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'agripump' AND table_name = 'branding' AND column_name = 'org_id'
        ) THEN
            ALTER TABLE agripump.branding DROP CONSTRAINT IF EXISTS branding_pkey;
            ALTER TABLE agripump.branding DROP CONSTRAINT IF EXISTS branding_user_id_key;
            ALTER TABLE agripump.branding RENAME COLUMN user_id TO org_id;
            ALTER TABLE agripump.branding RENAME COLUMN primary_color TO theme_color;
            ALTER TABLE agripump.branding RENAME COLUMN notification_sender_name TO sender_name;
            ALTER TABLE agripump.branding ALTER COLUMN theme_color DROP NOT NULL;
            ALTER TABLE agripump.branding ADD PRIMARY KEY (org_id);
        END IF;
    END $$;
    """)


def downgrade() -> None:
    # The two shapes cannot both be served by one model; going back would only bring the 500 back.
    pass
