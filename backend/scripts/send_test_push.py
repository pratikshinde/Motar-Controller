"""Send a test notification to the phones of the people who can see one pump, and say what happened.

    docker compose exec api python scripts/send_test_push.py --pump AJ-TEST-0001

Use it to check the whole push path: close the Ajanta app on the phone (swipe it away, lock the screen) and run this. A notification
should arrive in the phone's notification shade like any other app's. It does not change any data.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models.push_token import PushToken  # noqa: E402
from app.services import push  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pump", required=True, help="the pump's ID, for example AJ-TEST-0001")
    ap.add_argument("--title", default="Power is back")
    ap.add_argument("--body", default="Test: this is how the power alert looks on your phone.")
    args = ap.parse_args()

    print(f"Firebase key on the server: {'found' if push.enabled() else 'NOT found (FIREBASE_SERVICE_ACCOUNT_FILE) - nothing can be sent'}")
    if not push.enabled():
        return 1
    db = SessionLocal()
    try:
        db.execute(text("SET app.bypass_rls = 'on';"))
        ids = push.pump_user_ids(db, args.pump)
        print(f"people who can see {args.pump}: {len(ids)}")
        tokens = db.query(PushToken).filter(PushToken.user_id.in_(ids)).all() if ids else []
        print(f"phones registered for them: {len(tokens)}")
        if not tokens:
            print("No phone has registered. Open the Ajanta app, sign in, and allow notifications when asked.")
            return 1
        for row in tokens:
            outcome = push.send_to_token(row.token, args.title, args.body, {"pump_id": args.pump, "type": "POWER", "state": "ON"})
            print(f"  phone ...{row.token[-6:]}: {outcome}")
            if outcome == "invalid":
                db.delete(row)
        db.commit()
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
