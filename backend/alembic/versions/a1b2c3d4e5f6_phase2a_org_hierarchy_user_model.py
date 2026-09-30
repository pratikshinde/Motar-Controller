"""phase2a_org_hierarchy_user_model

Revision ID: a1b2c3d4e5f6
Revises: b3d5f7a9c1e3
Create Date: 2026-09-30 12:00:00.000000

Phase 2A: Organisation Hierarchy & User/Role Data Model
- Add branding_id to organisations table with FK to branding(id)
- Support extended dealer depth up to 6 levels under distributor (tree depth <= 10)
- Allow canonical organisation types (SUPERADMIN, MANUFACTURER, DISTRIBUTOR, DEALER)
- Update tree guard trigger with explicit DEALER_DEPTH_LIMIT_REACHED error message
- Add required indexes for organisation.parent_id, organisation.type, organisation.status
- Add required indexes for user.phone, user.org_id, user.role, user.status
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "agripump"


def upgrade() -> None:
    # 1. Ensure branding(id) has a unique constraint so it can be referenced by FK
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_branding_id' AND connamespace = '{SCHEMA}'::regnamespace
            ) THEN
                ALTER TABLE {SCHEMA}.branding ADD CONSTRAINT uq_branding_id UNIQUE (id);
            END IF;
        END $$;
    """)

    # 2. Add branding_id to organisations table
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = '{SCHEMA}' AND table_name = 'organisations' AND column_name = 'branding_id'
            ) THEN
                ALTER TABLE {SCHEMA}.organisations ADD COLUMN branding_id UUID NULL;
                ALTER TABLE {SCHEMA}.organisations
                    ADD CONSTRAINT fk_organisations_branding_id
                    FOREIGN KEY (branding_id) REFERENCES {SCHEMA}.branding(id) ON DELETE SET NULL;
            END IF;
        END $$;
    """)

    # 3. Update organisation type constraint to support canonical OrgType
    op.execute(f"""
        ALTER TABLE {SCHEMA}.organisations DROP CONSTRAINT IF EXISTS ck_organisations_type;
        ALTER TABLE {SCHEMA}.organisations ADD CONSTRAINT ck_organisations_type
            CHECK (UPPER(type) IN ('SUPERADMIN', 'MANUFACTURER', 'DISTRIBUTOR', 'DEALER', 'ROOT'));
    """)

    # 4. Update organisation depth constraint to allow up to depth 10
    op.execute(f"""
        ALTER TABLE {SCHEMA}.organisations DROP CONSTRAINT IF EXISTS ck_organisations_depth_max_6;
        ALTER TABLE {SCHEMA}.organisations DROP CONSTRAINT IF EXISTS ck_organisations_depth;
        ALTER TABLE {SCHEMA}.organisations ADD CONSTRAINT ck_organisations_depth
            CHECK (depth >= 0 AND depth <= 10);
    """)

    # 5. Update trigger function agripump.fn_organisations_tree_guard()
    op.execute(f"""
    CREATE OR REPLACE FUNCTION {SCHEMA}.fn_organisations_tree_guard()
    RETURNS TRIGGER AS $$
    DECLARE
        v_parent_path {SCHEMA}.ltree;
        v_parent_depth smallint;
        v_parent_type text;
        v_label text;
        v_dealer_ancestor_count integer;
    BEGIN
        -- Disallow self-parenting
        IF NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id THEN
            RAISE EXCEPTION 'Cycle detected in organisation hierarchy: organisation cannot be its own parent';
        END IF;

        -- Form label from UUID (hex with underscores for ltree compliance)
        v_label := replace(NEW.id::text, '-', '_');

        IF NEW.parent_id IS NULL THEN
            NEW.depth := 0;
            IF NEW.path IS NULL THEN
                NEW.path := v_label::{SCHEMA}.ltree;
            END IF;
        ELSE
            SELECT path, depth, type INTO v_parent_path, v_parent_depth, v_parent_type
            FROM {SCHEMA}.organisations
            WHERE id = NEW.parent_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Parent organisation with ID % not found', NEW.parent_id;
            END IF;

            -- Cycle check on update: NEW.parent_id cannot be a descendant of NEW.id
            IF TG_OP = 'UPDATE' AND OLD.path IS NOT NULL THEN
                IF v_parent_path <@ OLD.path THEN
                    RAISE EXCEPTION 'Cycle detected in organisation hierarchy: cannot make organisation a child of its own descendant';
                END IF;
            END IF;

            -- Dealer depth check: If child is a dealer, check count of dealer ancestors
            IF UPPER(NEW.type) = 'DEALER' THEN
                SELECT COUNT(*) INTO v_dealer_ancestor_count
                FROM {SCHEMA}.organisations
                WHERE path @> v_parent_path AND UPPER(type) = 'DEALER';

                -- v_dealer_ancestor_count is number of dealer ancestors already in parent path
                IF v_dealer_ancestor_count >= 6 THEN
                    RAISE EXCEPTION 'Dealer depth cannot exceed 6 levels: DEALER_DEPTH_LIMIT_REACHED';
                END IF;
            END IF;

            NEW.depth := (v_parent_depth + 1)::smallint;
            IF TG_OP = 'INSERT' OR OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
                NEW.path := (v_parent_path::text || '.' || v_label)::{SCHEMA}.ltree;
            END IF;
        END IF;

        IF NEW.depth > 10 THEN
            RAISE EXCEPTION 'Organisation hierarchy depth cannot exceed 10 levels: maximum allowed depth is 10';
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    # 6. Update subtree move trigger
    op.execute(f"""
    CREATE OR REPLACE FUNCTION {SCHEMA}.fn_organisations_sub_tree_move()
    RETURNS TRIGGER AS $$
    DECLARE
        v_depth_diff integer;
    BEGIN
        IF TG_OP = 'UPDATE' AND OLD.path IS DISTINCT FROM NEW.path THEN
            v_depth_diff := NEW.depth - OLD.depth;

            -- Atomically update all descendants
            UPDATE {SCHEMA}.organisations
            SET path = (NEW.path::text || '.' || subpath(path, nlevel(OLD.path))::text)::{SCHEMA}.ltree,
                depth = (depth + v_depth_diff)::smallint,
                updated_at = CURRENT_TIMESTAMP
            WHERE path <@ OLD.path AND id != NEW.id;

            -- Check if any descendant exceeded depth 10
            IF EXISTS (SELECT 1 FROM {SCHEMA}.organisations WHERE path <@ NEW.path AND depth > 10) THEN
                RAISE EXCEPTION 'Moving sub-tree causes descendants to exceed maximum depth 10';
            END IF;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    # 7. Add indexes on organisations
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_organisations_parent_id ON {SCHEMA}.organisations (parent_id);")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_organisations_type ON {SCHEMA}.organisations (type);")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_organisations_status ON {SCHEMA}.organisations (status);")

    # 8. Add indexes on users
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_users_org_id ON {SCHEMA}.users (org_id);")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_users_role ON {SCHEMA}.users (role);")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_users_account_status ON {SCHEMA}.users (account_status);")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_users_phone ON {SCHEMA}.users (phone);")

    # 9. Update users_role_check to support support engineer role
    op.execute(f"""
        ALTER TABLE {SCHEMA}.users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE {SCHEMA}.users ADD CONSTRAINT users_role_check
            CHECK (((role)::text = ANY ((ARRAY['superadmin'::character varying, 'manufacturer'::character varying, 'distributor'::character varying, 'dealer'::character varying, 'customer'::character varying, 'support'::character varying])::text[])));
    """)


def downgrade() -> None:
    # Drop indexes
    op.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_users_phone;")
    op.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_users_account_status;")
    op.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_users_role;")
    op.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_users_org_id;")

    op.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_organisations_status;")
    op.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_organisations_type;")
    op.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_organisations_parent_id;")

    # Drop branding_id and constraint
    op.execute(f"ALTER TABLE {SCHEMA}.organisations DROP CONSTRAINT IF EXISTS fk_organisations_branding_id;")
    op.execute(f"ALTER TABLE {SCHEMA}.organisations DROP COLUMN IF EXISTS branding_id;")
    op.execute(f"ALTER TABLE {SCHEMA}.branding DROP CONSTRAINT IF EXISTS uq_branding_id;")

    # Restore depth and type constraints
    op.execute(f"ALTER TABLE {SCHEMA}.organisations DROP CONSTRAINT IF EXISTS ck_organisations_depth;")
    op.execute(f"ALTER TABLE {SCHEMA}.organisations ADD CONSTRAINT ck_organisations_depth_max_6 CHECK (depth >= 0 AND depth <= 6);")

    op.execute(f"ALTER TABLE {SCHEMA}.organisations DROP CONSTRAINT IF EXISTS ck_organisations_type;")
    op.execute(f"ALTER TABLE {SCHEMA}.organisations ADD CONSTRAINT ck_organisations_type CHECK (type IN ('root', 'manufacturer', 'distributor', 'dealer'));")
