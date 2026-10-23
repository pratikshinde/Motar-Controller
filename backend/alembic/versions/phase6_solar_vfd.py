"""solar vfd: pumps.device_type, telemetry VFD columns, and VFD fault catalog codes

Revision ID: phase6_solar_vfd
Revises: phase5_brand_owner

Adds support for solar pump controllers with Fuji FRENIC-Ace VFD:
- pumps.device_type varchar NOT NULL DEFAULT 'AC_3PH' CHECK in ('AC_3PH', 'SOLAR_VFD')
- device_batches.device_type varchar NOT NULL DEFAULT 'AC_3PH' CHECK in ('AC_3PH', 'SOLAR_VFD')
- Nullable VFD columns on agripump.telemetry_history (NO DEFAULT VALUES):
  vfd_hz, vfd_i_out, vfd_v_ac, vfd_v_dc, vfd_kw, vfd_status, vfd_fault_code
- Seed fault_code_catalog rows from code 100 upward for VFD faults
"""
from alembic import op
import sqlalchemy as sa

revision = "phase6_solar_vfd"
down_revision = "phase5_brand_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")

    # 1. pumps.device_type
    op.execute("""
        ALTER TABLE agripump.pumps
        ADD COLUMN IF NOT EXISTS device_type varchar(20) DEFAULT 'AC_3PH'
    """)
    op.execute("""
        UPDATE agripump.pumps
        SET device_type = 'AC_3PH'
        WHERE device_type IS NULL
    """)
    op.execute("""
        ALTER TABLE agripump.pumps
        ALTER COLUMN device_type SET NOT NULL,
        ALTER COLUMN device_type SET DEFAULT 'AC_3PH'
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'pumps_device_type_check' AND conrelid = 'agripump.pumps'::regclass
            ) THEN
                ALTER TABLE agripump.pumps
                ADD CONSTRAINT pumps_device_type_check CHECK (device_type IN ('AC_3PH', 'SOLAR_VFD'));
            END IF;
        END $$;
    """)

    # 2. device_batches.device_type
    op.execute("""
        ALTER TABLE agripump.device_batches
        ADD COLUMN IF NOT EXISTS device_type varchar(20) DEFAULT 'AC_3PH'
    """)
    op.execute("""
        UPDATE agripump.device_batches
        SET device_type = 'AC_3PH'
        WHERE device_type IS NULL
    """)
    op.execute("""
        ALTER TABLE agripump.device_batches
        ALTER COLUMN device_type SET NOT NULL,
        ALTER COLUMN device_type SET DEFAULT 'AC_3PH'
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'device_batches_device_type_check' AND conrelid = 'agripump.device_batches'::regclass
            ) THEN
                ALTER TABLE agripump.device_batches
                ADD CONSTRAINT device_batches_device_type_check CHECK (device_type IN ('AC_3PH', 'SOLAR_VFD'));
            END IF;
        END $$;
    """)

    # 3. Nullable VFD columns on agripump.telemetry_history (NO DEFAULT VALUES)
    op.execute("""
        ALTER TABLE agripump.telemetry_history
        ADD COLUMN IF NOT EXISTS vfd_hz numeric(5, 2) NULL,
        ADD COLUMN IF NOT EXISTS vfd_i_out numeric(5, 2) NULL,
        ADD COLUMN IF NOT EXISTS vfd_v_ac numeric(5, 1) NULL,
        ADD COLUMN IF NOT EXISTS vfd_v_dc numeric(5, 1) NULL,
        ADD COLUMN IF NOT EXISTS vfd_kw numeric(5, 2) NULL,
        ADD COLUMN IF NOT EXISTS vfd_status varchar(30) NULL,
        ADD COLUMN IF NOT EXISTS vfd_fault_code smallint NULL
    """)

    # 4. Seed fault_code_catalog for VFD faults (code >= 100)
    op.execute("""
        INSERT INTO agripump.fault_code_catalog (code, name, severity, description) VALUES
            (100, 'VfdDcOverVolt', 'CRITICAL', 'VFD DC bus over-voltage'),
            (101, 'VfdDcUnderVolt', 'HIGH', 'VFD DC bus under-voltage'),
            (102, 'VfdOverCurrent', 'CRITICAL', 'VFD overcurrent'),
            (103, 'VfdDryRun', 'HIGH', 'VFD dry run / low solar underload'),
            (104, 'VfdOverHeat', 'HIGH', 'VFD heatsink / motor overheat'),
            (105, 'VfdCommsLoss', 'CRITICAL', 'VFD RS-485 Modbus communication loss'),
            (106, 'VfdOverLoad', 'HIGH', 'VFD motor / drive overload')
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")

    # 1. Remove seeded VFD fault codes
    op.execute("DELETE FROM agripump.fault_code_catalog WHERE code >= 100")

    # 2. Remove VFD columns from telemetry_history
    op.execute("""
        ALTER TABLE agripump.telemetry_history
        DROP COLUMN IF EXISTS vfd_hz,
        DROP COLUMN IF EXISTS vfd_i_out,
        DROP COLUMN IF EXISTS vfd_v_ac,
        DROP COLUMN IF EXISTS vfd_v_dc,
        DROP COLUMN IF EXISTS vfd_kw,
        DROP COLUMN IF EXISTS vfd_status,
        DROP COLUMN IF EXISTS vfd_fault_code
    """)

    # 3. Remove device_batches.device_type
    op.execute("ALTER TABLE agripump.device_batches DROP CONSTRAINT IF EXISTS device_batches_device_type_check")
    op.execute("ALTER TABLE agripump.device_batches DROP COLUMN IF EXISTS device_type")

    # 4. Remove pumps.device_type
    op.execute("ALTER TABLE agripump.pumps DROP CONSTRAINT IF EXISTS pumps_device_type_check")
    op.execute("ALTER TABLE agripump.pumps DROP COLUMN IF EXISTS device_type")
