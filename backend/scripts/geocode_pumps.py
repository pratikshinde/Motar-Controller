"""Put a pin on the map for every pump whose farmer gave an address but whose pump has no position yet.

    python scripts/geocode_pumps.py            # shows what it would look up, changes nothing
    python scripts/geocode_pumps.py --apply    # looks each address up (one a second) and saves the position

Only the address text is sent to the lookup service. Safe to run again: a pump that already has a position is left alone.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.services.geocode import geocode_address  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="really look the addresses up and save the positions")
    args = ap.parse_args()

    db = SessionLocal()
    db.execute(text("SELECT set_config('app.bypass_rls', 'on', true)"))
    rows = db.execute(text(
        "SELECT p.id, u.address FROM agripump.pumps p JOIN agripump.users u ON u.id = p.owner_user_id "
        "WHERE p.latitude IS NULL AND u.role = 'customer' AND COALESCE(TRIM(u.address), '') <> '' ORDER BY p.id"
    )).all()
    print(f"{len(rows)} pump(s) have an address and no position.")
    done = 0
    for pump_id, address in rows:
        if not args.apply:
            print(f"  would look up: {pump_id}  ->  {address}")
            continue
        spot = geocode_address(address.strip())
        if spot is None:
            print(f"  not found: {pump_id}  ->  {address}")
            continue
        db.execute(text("UPDATE agripump.pumps SET latitude = :la, longitude = :lo WHERE id = :id AND latitude IS NULL"),
                   {"la": round(spot[0], 6), "lo": round(spot[1], 6), "id": pump_id})
        db.commit()
        done += 1
        print(f"  placed: {pump_id}  ->  {spot[0]:.4f}, {spot[1]:.4f}")
    if args.apply:
        print(f"{done} pump(s) now have a pin.")
    db.close()


if __name__ == "__main__":
    main()
