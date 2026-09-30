"""command lifecycle (P2.4): payload, idempotency key, per-state timestamps, ack capability

Revision ID: a7c9e1b3d5f7
Revises: f5a7c9e1b3d5
Create Date: 2026-09-28

`commands` gains the columns the state machine needs (QUEUED -> SENT -> DELIVERED -> ACKNOWLEDGED ->
APPLIED, or REJECTED / EXPIRED / FAILED / NOT_CONFIRMED):

  payload           what was asked (timer values, fault id, ...): the audit trail and the wire message
  idempotency_key   one row per (pump, key): a retried request returns the first command, never a second send
  sent_at           the broker accepted the publish
  delivered_at      the device (bridge) confirmed it received the message
  applied_at        the pump's own state shows the command took effect
  failure_reason    why a command ended FAILED / NOT_CONFIRMED / REJECTED, as a stable code

`pumps.supports_command_ack` switches the interim "infer APPLIED from telemetry" mode off, per device,
the first time that device answers a command with an acknowledgement carrying the command's `cid`.

`audit_log` RLS: state changes come from a pump's own HTTP channel (device context, no actor) as well as from
users and system jobs, so command audit rows are visible / writable to whoever can see the command itself.

Rows written before this revision were never published to any device (nothing did), so the ones still
waiting are closed as EXPIRED rather than left "pending" forever.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a7c9e1b3d5f7'
down_revision: Union[str, Sequence[str], None] = 'f5a7c9e1b3d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_AUDIT_POLICY = """
    DROP POLICY IF EXISTS rls_audit_log_policy ON agripump.audit_log;
    CREATE POLICY rls_audit_log_policy ON agripump.audit_log
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR actor_id::text = current_setting('app.user_id', true)
        OR (
            entity_type = 'pump' AND entity_id IN (SELECT id FROM agripump.pumps)
        )
        {command_clause}
    );
"""
_COMMAND_CLAUSE = "OR (entity_type = 'command' AND entity_id IN (SELECT cid::text FROM agripump.commands))"


_STATES = "'QUEUED','SENT','DELIVERED','ACKNOWLEDGED','APPLIED','REJECTED','EXPIRED','FAILED','NOT_CONFIRMED'"


def _see_every_row() -> None:
    # `commands` has FORCE row-level security: without this the UPDATEs below match no rows (the table owner
    # is subject to the policy too) and the new CHECK would then fail on the old values it never saw.
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")


def upgrade() -> None:
    _see_every_row()
    # Databases bootstrapped from schema.sql carry CHECKs written for the old vocabulary (PENDING / ACKED ...).
    op.execute("ALTER TABLE agripump.commands DROP CONSTRAINT IF EXISTS commands_status_check")
    op.execute("ALTER TABLE agripump.commands DROP CONSTRAINT IF EXISTS commands_action_check")
    op.add_column('commands', sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True), schema='agripump')
    op.add_column('commands', sa.Column('idempotency_key', sa.String(length=100), nullable=True), schema='agripump')
    op.add_column('commands', sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True), schema='agripump')
    op.add_column('commands', sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True), schema='agripump')
    op.add_column('commands', sa.Column('applied_at', sa.DateTime(timezone=True), nullable=True), schema='agripump')
    op.add_column('commands', sa.Column('failure_reason', sa.String(length=50), nullable=True), schema='agripump')
    # The wire name of a command can be longer than the old 10-character `action` (e.g. RESET_FAULT, SET_TIMER).
    op.alter_column('commands', 'action', existing_type=sa.String(length=10), type_=sa.String(length=20), schema='agripump')

    op.create_index(
        'uq_commands_pump_idempotency_key', 'commands', ['pump_id', 'idempotency_key'],
        unique=True, schema='agripump', postgresql_where=sa.text('idempotency_key IS NOT NULL'),
    )
    # The sweep only ever looks at commands that are still open.
    op.create_index(
        'ix_commands_open', 'commands', ['status', 'issued_at'],
        schema='agripump',
        postgresql_where=sa.text("status IN ('QUEUED','SENT','DELIVERED','ACKNOWLEDGED')"),
    )

    op.add_column(
        'pumps', sa.Column('supports_command_ack', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        schema='agripump',
    )

    op.execute(_AUDIT_POLICY.format(command_clause=_COMMAND_CLAUSE))

    op.execute("UPDATE agripump.commands SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < now()")
    op.execute("UPDATE agripump.commands SET status = 'QUEUED' WHERE status = 'PENDING'")
    # Older rows that were "acknowledged" by the previous vocabulary keep meaning the same thing.
    op.execute("UPDATE agripump.commands SET status = 'ACKNOWLEDGED' WHERE status = 'ACKED'")
    op.execute(f"ALTER TABLE agripump.commands ADD CONSTRAINT commands_status_check CHECK (status IN ({_STATES}))")


def downgrade() -> None:
    _see_every_row()
    op.execute("ALTER TABLE agripump.commands DROP CONSTRAINT IF EXISTS commands_status_check")
    op.execute(_AUDIT_POLICY.format(command_clause=""))
    op.execute("UPDATE agripump.commands SET status = 'ACKED' WHERE status IN ('ACKNOWLEDGED', 'APPLIED')")
    op.execute(
        "UPDATE agripump.commands SET status = 'PENDING' "
        "WHERE status IN ('QUEUED','SENT','DELIVERED')"
    )
    op.execute(
        "UPDATE agripump.commands SET status = 'EXPIRED' "
        "WHERE status IN ('NOT_CONFIRMED','FAILED')"
    )
    op.execute(
        "ALTER TABLE agripump.commands ADD CONSTRAINT commands_status_check "
        "CHECK (status IN ('PENDING','ACKED','EXPIRED','REJECTED'))"
    )
    op.drop_column('pumps', 'supports_command_ack', schema='agripump')
    op.drop_index('ix_commands_open', table_name='commands', schema='agripump')
    op.drop_index('uq_commands_pump_idempotency_key', table_name='commands', schema='agripump')
    op.alter_column('commands', 'action', existing_type=sa.String(length=20), type_=sa.String(length=10), schema='agripump')
    for col in ('failure_reason', 'applied_at', 'delivered_at', 'sent_at', 'idempotency_key', 'payload'):
        op.drop_column('commands', col, schema='agripump')
