"""starter details on the factory list: HP, supply, model, notes, and the factory test result

Revision ID: phase11_starter_details
Revises: phase10_power_events

The factory uploads one Excel sheet per batch: each starter's ID (the barcode on its box) with its details. They live on the factory list
(`batch_imeis`): the starter ID is `mcu_uid` (the module's own id, which is also the AWS thing name and the pump id), and `imei` becomes optional, since
a sheet need not list the modem's IMEI. The factory station records the bench test (`tested_at`, `test_result`, `test_note`). When the module claims
its certificate, the pump is created from these details.
"""
from alembic import op

revision = "phase11_starter_details"
down_revision = "phase10_power_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("ALTER TABLE agripump.batch_imeis ALTER COLUMN imei DROP NOT NULL")
    for ddl in (
        "ADD COLUMN IF NOT EXISTS hp_rating numeric(4,1)",
        "ADD COLUMN IF NOT EXISTS supply_type varchar(10)",
        "ADD COLUMN IF NOT EXISTS model varchar(100)",
        "ADD COLUMN IF NOT EXISTS hw_rev varchar(20)",
        "ADD COLUMN IF NOT EXISTS manufacture_date date",
        "ADD COLUMN IF NOT EXISTS notes text",
        "ADD COLUMN IF NOT EXISTS tested_at timestamptz",
        "ADD COLUMN IF NOT EXISTS tested_by uuid REFERENCES agripump.users(id) ON DELETE SET NULL",
        "ADD COLUMN IF NOT EXISTS test_result varchar(4)",
        "ADD COLUMN IF NOT EXISTS test_note text",
    ):
        op.execute(f"ALTER TABLE agripump.batch_imeis {ddl}")
    op.execute("ALTER TABLE agripump.batch_imeis DROP CONSTRAINT IF EXISTS ck_batch_imeis_test_result")
    op.execute("ALTER TABLE agripump.batch_imeis ADD CONSTRAINT ck_batch_imeis_test_result CHECK (test_result IS NULL OR test_result IN ('PASS', 'FAIL'))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_batch_imeis_mcu_uid ON agripump.batch_imeis (mcu_uid) WHERE mcu_uid IS NOT NULL")


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP INDEX IF EXISTS agripump.ix_batch_imeis_mcu_uid")
    op.execute("ALTER TABLE agripump.batch_imeis DROP CONSTRAINT IF EXISTS ck_batch_imeis_test_result")
    for col in ("test_note", "test_result", "tested_by", "tested_at", "notes", "manufacture_date", "hw_rev", "model", "supply_type", "hp_rating"):
        op.execute(f"ALTER TABLE agripump.batch_imeis DROP COLUMN IF EXISTS {col}")
    # imei stays nullable: rows without one may exist by now
