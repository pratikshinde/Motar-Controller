"""Show the latest commands sent from the app to a pump and what became of each. Read-only.

    python scripts/show_commands.py [--pump-id SWATI-DEMO-01] [--limit 6]

status says how far a command got:
    QUEUED        saved by the backend, not yet published
    SENT          the broker (AWS IoT Core) accepted the publish: it reached AWS
    DELIVERED / ACKNOWLEDGED / APPLIED   the pump answered
    FAILED        the broker refused it, so the pump was never asked. `why` = publisher_unavailable (no AWS
                  credentials or boto3) or publish_failed (AWS refused: policy, keys or endpoint); run
                  scripts/check_aws_iot.py for AWS's own message
    NOT_CONFIRMED sent, but no sign from the pump within COMMAND_CONFIRM_SECONDS (expected with no hardware)
    EXPIRED       never sent within COMMAND_TTL_SECONDS
The cid is the id inside the message AWS shows in the MQTT test client, so the two can be matched.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.models import Command

IST = ZoneInfo("Asia/Kolkata")


def _t(value):
    if value is None:
        return "-"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST).strftime("%H:%M:%S")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pump-id", default="SWATI-DEMO-01")
    ap.add_argument("--limit", type=int, default=6)
    args = ap.parse_args()

    print(f"Backend publishes commands via: {settings.publish_mode()}   (aws = AWS IoT Core, outbox = local simulator)")
    db = SessionLocal()
    try:
        db.execute(text("SET app.bypass_rls = 'on'"))  # developer tool: sees every pump
        rows = (
            db.query(Command)
            .filter(Command.pump_id == args.pump_id)
            .order_by(Command.issued_at.desc())
            .limit(args.limit)
            .all()
        )
        if not rows:
            print(f"No commands for {args.pump_id} yet.")
            return 0
        print(f"\nLatest commands for {args.pump_id} (times are IST):")
        print(f"{'issued':15}  {'cmd':9} {'status':13} {'sent':8}  {'applied':8}  {'why':20} cid")
        for c in rows:
            why = c.failure_reason or c.reject_reason or "-"
            issued = c.issued_at if c.issued_at.tzinfo else c.issued_at.replace(tzinfo=timezone.utc)
            issued = issued.astimezone(IST).strftime("%d %b %H:%M:%S")
            print(f"{issued:15}  {c.action:9} {c.status:13} {_t(c.sent_at):8}  {_t(c.applied_at):8}  {why:20} {c.cid}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
