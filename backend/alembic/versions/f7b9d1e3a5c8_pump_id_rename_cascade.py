"""Make every reference to pumps.id follow a rename of the pump's id (bridge swap, FR-WEB-034).

A bridge (modem) swap moves a site's whole history onto the identity of the replacement device by renaming the pump's
primary key. Most tables already had ON UPDATE CASCADE; these five did not, so the rename would have failed for any
pump that had access rows, daily summaries, alert subscriptions, a panel or an invite:
alert_subscriptions, panels, invites, device_access, daily_summary. Their ON DELETE rules are kept as they are.

Revision ID: f7b9d1e3a5c8
Revises: e6a8c0d2f4b6
"""
from typing import Sequence, Union

from alembic import op

revision: str = "f7b9d1e3a5c8"
down_revision: Union[str, Sequence[str], None] = "e6a8c0d2f4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "agripump"
# (table, column) of each foreign key to pumps(id) that has to follow a rename.
REFERENCES = [
    ("alert_subscriptions", "pump_id"),
    ("panels", "pump_id"),
    ("invites", "device_id"),
    ("device_access", "device_id"),
    ("daily_summary", "device_id"),
]


def _set_on_update(table: str, column: str, cascade: bool) -> None:
    """Re-create the foreign key on table.column with the wanted ON UPDATE rule, keeping its name and ON DELETE rule.

    Only touches a key whose rule differs (re-adding one validates every row, and daily_summary is not small).
    A database that has no such key is left alone: the schema migrations own creating it.
    """
    want = "c" if cascade else "a"
    update_rule = "CASCADE" if cascade else "NO ACTION"
    op.execute(f"""
    DO $$
    DECLARE
        col_no smallint := (SELECT attnum FROM pg_attribute WHERE attrelid = '{S}.{table}'::regclass AND attname = '{column}');
        r record;
        del_rule text;
    BEGIN
        FOR r IN SELECT conname, confdeltype, confupdtype FROM pg_constraint
                 WHERE conrelid = '{S}.{table}'::regclass AND confrelid = '{S}.pumps'::regclass
                   AND contype = 'f' AND conkey = ARRAY[col_no]
        LOOP
            IF r.confupdtype <> '{want}' THEN
                del_rule := CASE r.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                                               WHEN 'r' THEN 'RESTRICT' WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END;
                EXECUTE format('ALTER TABLE {S}.{table} DROP CONSTRAINT %I', r.conname);
                EXECUTE format(
                    'ALTER TABLE {S}.{table} ADD CONSTRAINT %I FOREIGN KEY ({column}) REFERENCES {S}.pumps(id) '
                    || 'ON DELETE %s ON UPDATE {update_rule}', r.conname, del_rule);
            END IF;
        END LOOP;
    END $$;
    """)


def upgrade() -> None:
    for table, column in REFERENCES:
        _set_on_update(table, column, cascade=True)


def downgrade() -> None:
    for table, column in REFERENCES:
        _set_on_update(table, column, cascade=False)
