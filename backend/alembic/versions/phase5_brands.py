"""brands: one server, many manufacturers' apps

Revision ID: phase5_brands
Revises: phase4_device_inventory

Each manufacturer that sells controllers has its own mobile app (one codebase, built once per brand). The app tells the
server which brand it is (X-App-Brand) and the server answers with that manufacturer's data and settings.

* `brands`: one row per manufacturer's app. Holds only what is not secret (name, colours, support contacts, the
  WhatsApp/SMS sender identifiers); the secrets themselves (API tokens) are environment variables named
  BRAND_<KEY>_<SETTING>, never database columns. No row-level security: the app needs it before anyone has signed in.
* `pumps.brand_id`, `device_batches.brand_id`: whose device it is. A farmer's app lists only its own brand's pumps.
* `users.brand_id`: set for partner accounts (manufacturer / distributor / dealer / support): which brand's tree they
  belong to. A partner cannot sign in to another brand's farmer app. Farmers are not tied to a brand (one account,
  and each brand's app shows that brand's pumps).
* Everything that exists today belongs to the first brand, "ajanta".
"""
from alembic import op

revision = "phase5_brands"
down_revision = "phase4_device_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pumps / users / device_batches have FORCE row-level security: without this the backfill UPDATEs match nothing.
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.brands (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            key varchar(30) NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9-]{1,29}$'),
            org_id uuid REFERENCES agripump.organisations(id) ON DELETE SET NULL,
            name varchar(100) NOT NULL,
            short_name varchar(30),
            logo_url text,
            primary_color varchar(7),
            support_name varchar(100),
            support_phone varchar(20),
            support_email varchar(100),
            whatsapp_phone_id varchar(50),
            whatsapp_template varchar(60),
            whatsapp_language varchar(10),
            sms_sender_id varchar(11),
            msg91_flow_id varchar(60),
            android_package varchar(100),
            min_app_version varchar(20),
            features jsonb NOT NULL DEFAULT '{}'::jsonb,
            status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    """)

    for table in ("pumps", "device_batches", "users"):
        op.execute(f"ALTER TABLE agripump.{table} ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES agripump.brands(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pumps_brand ON agripump.pumps (brand_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_brand ON agripump.users (brand_id) WHERE brand_id IS NOT NULL")

    # The first brand, and everything that exists today belongs to it.
    op.execute("""
        INSERT INTO agripump.brands (key, name, short_name, android_package)
        VALUES ('ajanta', 'Ajanta Pump Controller', 'AJANTA', 'com.agripump.farmer')
        ON CONFLICT (key) DO NOTHING
    """)
    op.execute("UPDATE agripump.pumps SET brand_id = (SELECT id FROM agripump.brands WHERE key = 'ajanta') WHERE brand_id IS NULL")
    op.execute("UPDATE agripump.device_batches SET brand_id = (SELECT id FROM agripump.brands WHERE key = 'ajanta') WHERE brand_id IS NULL")
    op.execute("""
        UPDATE agripump.users SET brand_id = (SELECT id FROM agripump.brands WHERE key = 'ajanta')
        WHERE brand_id IS NULL AND role IN ('manufacturer', 'distributor', 'dealer', 'support')
    """)


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP INDEX IF EXISTS agripump.ix_users_brand")
    op.execute("DROP INDEX IF EXISTS agripump.ix_pumps_brand")
    for table in ("users", "device_batches", "pumps"):
        op.execute(f"ALTER TABLE agripump.{table} DROP COLUMN IF EXISTS brand_id")
    op.execute("DROP TABLE IF EXISTS agripump.brands")
