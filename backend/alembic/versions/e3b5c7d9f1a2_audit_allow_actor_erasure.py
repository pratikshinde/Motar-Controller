"""audit_log: allow the actor to be cleared when an account is erased

Revision ID: e3b5c7d9f1a2
Revises: d2a4b6c8e0f1
Create Date: 2026-09-26

trg_audit_log_immutable rejected every UPDATE on agripump.audit_log, including the one PostgreSQL
itself issues for `actor_id ... ON DELETE SET NULL` when a user row is deleted. As a result no
account that had ever written an audit row could be erased, which makes a farmer's "delete my data"
request (DPDP Act) impossible to complete.

The trigger now lets exactly one kind of update through: actor_id going from a value to NULL with
every other column unchanged. Any other UPDATE, and every DELETE, is still refused, so audit rows
remain unalterable apart from anonymising who acted.
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'e3b5c7d9f1a2'
down_revision: Union[str, Sequence[str], None] = 'd2a4b6c8e0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    CREATE OR REPLACE FUNCTION agripump.fn_prevent_audit_tampering()
    RETURNS TRIGGER AS $$
    BEGIN
        IF TG_OP = 'UPDATE'
           AND OLD.actor_id IS NOT NULL
           AND NEW.actor_id IS NULL
           AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'audit_log is append-only: updates and deletes are strictly prohibited';
    END;
    $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    op.execute("""
    CREATE OR REPLACE FUNCTION agripump.fn_prevent_audit_tampering()
    RETURNS TRIGGER AS $$
    BEGIN
        RAISE EXCEPTION 'audit_log is append-only: updates and deletes are strictly prohibited';
    END;
    $$ LANGUAGE plpgsql;
    """)
