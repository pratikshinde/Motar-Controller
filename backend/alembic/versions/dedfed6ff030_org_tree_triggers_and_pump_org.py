"""org_tree_triggers_and_pump_org

Revision ID: dedfed6ff030
Revises: 0edb97889ebd
Create Date: 2026-09-25 13:16:34.959234

"""
from typing import Sequence, Union
from alembic import op
from app.core.migration_helpers import add_column, create_foreign_key
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'dedfed6ff030'
down_revision: Union[str, Sequence[str], None] = '0edb97889ebd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add org_id to pumps table
    add_column('pumps', sa.Column('org_id', sa.UUID(), nullable=True), schema='agripump')
    create_foreign_key(
        'fk_pumps_org_id', 'pumps', 'organisations',
        ['org_id'], ['id'],
        source_schema='agripump', referent_schema='agripump',
        ondelete='SET NULL'
    )
    # Backfill existing pumps to root organisation
    op.execute("""
        UPDATE agripump.pumps
        SET org_id = 'a0000000-0000-0000-0000-000000000001'
        WHERE org_id IS NULL;
    """)

    # 2. Trigger function to enforce depth <= 6 and acyclic tree
    op.execute("""
    CREATE OR REPLACE FUNCTION agripump.fn_organisations_tree_guard()
    RETURNS TRIGGER AS $$
    DECLARE
        v_parent_path agripump.ltree;
        v_parent_depth smallint;
        v_label text;
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
                NEW.path := v_label::agripump.ltree;
            END IF;
        ELSE
            SELECT path, depth INTO v_parent_path, v_parent_depth
            FROM agripump.organisations
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

            IF v_parent_depth >= 6 THEN
                RAISE EXCEPTION 'Dealer depth cannot exceed 6 levels: parent is already at maximum depth 6';
            END IF;

            NEW.depth := (v_parent_depth + 1)::smallint;
            IF TG_OP = 'INSERT' OR OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
                NEW.path := (v_parent_path::text || '.' || v_label)::agripump.ltree;
            END IF;
        END IF;

        IF NEW.depth > 6 THEN
            RAISE EXCEPTION 'Dealer depth cannot exceed 6 levels: maximum allowed depth is 6';
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    op.execute("""
    DROP TRIGGER IF EXISTS trg_organisations_tree_guard ON agripump.organisations;
    CREATE TRIGGER trg_organisations_tree_guard
    BEFORE INSERT OR UPDATE ON agripump.organisations
    FOR EACH ROW EXECUTE FUNCTION agripump.fn_organisations_tree_guard();
    """)

    # 3. Trigger for atomic subtree moves
    op.execute("""
    CREATE OR REPLACE FUNCTION agripump.fn_organisations_sub_tree_move()
    RETURNS TRIGGER AS $$
    DECLARE
        v_depth_diff integer;
    BEGIN
        IF TG_OP = 'UPDATE' AND OLD.path IS DISTINCT FROM NEW.path THEN
            v_depth_diff := NEW.depth - OLD.depth;

            -- Atomically update all descendants
            UPDATE agripump.organisations
            SET path = (NEW.path::text || '.' || subpath(path, nlevel(OLD.path))::text)::agripump.ltree,
                depth = (depth + v_depth_diff)::smallint,
                updated_at = CURRENT_TIMESTAMP
            WHERE path <@ OLD.path AND id != NEW.id;

            -- Check if any descendant exceeded depth 6
            IF EXISTS (SELECT 1 FROM agripump.organisations WHERE path <@ NEW.path AND depth > 6) THEN
                RAISE EXCEPTION 'Dealer depth cannot exceed 6 levels: moving sub-tree causes descendants to exceed maximum depth 6';
            END IF;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    op.execute("""
    DROP TRIGGER IF EXISTS trg_organisations_sub_tree_move ON agripump.organisations;
    CREATE TRIGGER trg_organisations_sub_tree_move
    AFTER UPDATE ON agripump.organisations
    FOR EACH ROW EXECUTE FUNCTION agripump.fn_organisations_sub_tree_move();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_organisations_sub_tree_move ON agripump.organisations;")
    op.execute("DROP FUNCTION IF EXISTS agripump.fn_organisations_sub_tree_move();")
    op.execute("DROP TRIGGER IF EXISTS trg_organisations_tree_guard ON agripump.organisations;")
    op.execute("DROP FUNCTION IF EXISTS agripump.fn_organisations_tree_guard();")
    op.drop_constraint('fk_pumps_org_id', 'pumps', schema='agripump', type_='foreignkey')
    op.drop_column('pumps', 'org_id', schema='agripump')
