"""Dashboard benchmark at realistic scale, in a throwaway schema (`bench`), never touching real data.

    python scripts/bench_dashboard.py [--devices 100000] [--runs 30] [--keep] [--indexes none|current|proposed]

What it does
  1. Builds schema `bench` as a structural copy of the dashboard's tables (columns, defaults, existing indexes) and copies
     the real row-level-security policies onto it, so measurements include RLS exactly as production applies it.
  2. Fills it with a synthetic fleet: an organisation tree, devices with mixed lifecycle/connectivity/firmware/location,
     a month of fault logs and daily rollups, open alerts and today's telemetry.
  3. Times every dashboard aggregate the way the API runs them (repository calls under a partner's RLS context) and
     the assembled dashboards, N runs each, reporting p50/p95/p99, plus EXPLAIN (ANALYZE) of the heaviest statements.
  4. Drops the schema (unless --keep).

The synthetic data only stands in for shape and volume. Numbers are for this machine's Postgres 18 without TimescaleDB;
they are evidence about query plans and scaling, not a production SLA.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.core.dashboard_time import local_today, today_start_utc  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.repositories import dashboard_repository as repo_mod  # noqa: E402
from app.repositories.dashboard_repository import DashboardRepository  # noqa: E402

B = "bench"
TABLES = ("organisations", "pumps", "fault_logs", "alerts", "daily_summary", "telemetry_history", "fault_code_catalog",
          "device_access", "dashboard_runtime")
def _migration_indexes():
    """The DDL the migration will run, retargeted at the bench schema (a bench build needs no CONCURRENTLY)."""
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic", "versions",
                        "phase3_dashboard_indexes.py")
    spec = importlib.util.spec_from_file_location("phase3_dashboard_indexes", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ddl = [*mod.INDEXES.values(), mod.TELEMETRY_TIME_INDEX]
    return [d.replace(" CONCURRENTLY", "").replace("agripump.", "{s}.") for d in ddl]


PROPOSED_INDEXES = _migration_indexes()


def pct(vals, q):
    s = sorted(vals)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


def build(db, n_devices, log):
    db.execute(text("SET app.bypass_rls = 'on'"))
    db.execute(text("SET statement_timeout = 0"))  # building only: measurements keep the application's own limit
    db.execute(text(f"DROP SCHEMA IF EXISTS {B} CASCADE"))
    db.execute(text(f"CREATE SCHEMA {B}"))
    for t in TABLES:
        db.execute(text(f"CREATE TABLE {B}.{t} (LIKE agripump.{t} INCLUDING DEFAULTS INCLUDING INDEXES INCLUDING CONSTRAINTS)"))
    for t in ("fault_logs", "daily_summary", "telemetry_history"):
        db.execute(text(f"ALTER TABLE {B}.{t} ALTER COLUMN id DROP DEFAULT"))
    db.commit()

    # Copy RLS: same expressions, with unqualified table names resolving to bench.* through search_path.
    for t in ("pumps", "fault_logs", "alerts", "daily_summary", "telemetry_history", "dashboard_runtime"):
        row = db.execute(text(
            "SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p WHERE p.polrelid = CAST(:r AS regclass)"
        ), {"r": f"agripump.{t}"}).fetchall()
        db.execute(text(f"ALTER TABLE {B}.{t} ENABLE ROW LEVEL SECURITY"))
        db.execute(text(f"ALTER TABLE {B}.{t} FORCE ROW LEVEL SECURITY"))
        for name, qual in row:
            db.execute(text(f'CREATE POLICY "{name}" ON {B}.{t} USING ({qual})'))
    db.commit()
    db.execute(text(f"SET search_path TO {B}, agripump, public"))

    t0 = time.time()
    # ---- organisation tree: 1 root, 5 manufacturers x 5 distributors x 10 dealers = 281 orgs
    db.execute(text(f"""
        CREATE TEMP TABLE _org AS
        WITH m AS (SELECT gen_random_uuid() id, g n FROM generate_series(1,5) g),
             d AS (SELECT gen_random_uuid() id, m.id mid, m.n mn, g n FROM m, generate_series(1,5) g),
             x AS (SELECT gen_random_uuid() id, d.id did, d.mid mid, d.mn mn, d.n dn, g n FROM d, generate_series(1,10) g)
        SELECT 'M' t, id, NULL::uuid parent, n mn, 0 dn, 0 xn, 1 depth FROM m
        UNION ALL SELECT 'D', id, mid, mn, n, 0, 2 FROM d
        UNION ALL SELECT 'X', id, did, mn, dn, n, 3 FROM x"""))
    db.execute(text(f"""
        INSERT INTO {B}.organisations (id, parent_id, type, name, path, depth)
        SELECT id, parent, CASE t WHEN 'M' THEN 'MANUFACTURER' WHEN 'D' THEN 'DISTRIBUTOR' ELSE 'DEALER' END,
               t || mn || '.' || dn || '.' || xn,
               CASE t WHEN 'M' THEN ('root.m' || mn)
                      WHEN 'D' THEN ('root.m' || mn || '.d' || dn)
                      ELSE ('root.m' || mn || '.d' || dn || '.x' || xn) END::agripump.ltree,
               depth FROM _org"""))
    db.execute(text("CREATE TEMP TABLE _dealers AS SELECT row_number() over (order by id) rn, id, mn, dn, xn "
                    "FROM _org WHERE t = 'X'"))
    n_dealers = db.execute(text("SELECT count(*) FROM _dealers")).scalar()
    log(f"  organisations: {db.execute(text(f'select count(*) from {B}.organisations')).scalar()}  ({time.time()-t0:.1f}s)")

    # ---- devices. 92% of devices are owned by a dealer org; 8% are legacy (no org_id, path only).
    owner = db.execute(text("SELECT id FROM agripump.users LIMIT 1")).scalar()
    db.execute(text(f"""
        INSERT INTO {B}.pumps (id, name, supply_type, hp_rating, owner_user_id, hierarchy_path, latitude, longitude,
                               firmware_version, status, last_seen_at, lifecycle_state, warranty_start_date,
                               warranty_period_months, org_id, total_runtime_min, subscription_expires_at)
        SELECT 'BP-' || g, 'Pump ' || g, '3-phase', 7.5, :owner,
               '/SA/M' || d.mn || '/D' || d.dn || '/X' || d.xn || '/P' || g,
               CASE WHEN g % 10 < 8 THEN 8 + (g % 2900) / 100.0 END,
               CASE WHEN g % 10 < 8 THEN 68 + (g % 2900) / 100.0 END,
               (ARRAY['1.0.4','1.0.4','1.0.3','1.0.2','1.1.0','1.0.4'])[1 + g % 6],
               'RUNNING',
               CASE WHEN g % 100 < 3 THEN NULL
                    WHEN g % 100 < 15 THEN now() - ((g % 720 + 11) * interval '1 minute')
                    ELSE now() - ((g % 9) * interval '1 minute') END,
               (ARRAY['ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','COMMISSIONED','IN_STOCK','RMA'])[1 + g % 10],
               CASE WHEN g % 4 = 0 THEN current_date - (g % 400) END,
               CASE WHEN g % 4 = 0 THEN 12 END,
               CASE WHEN g % 100 < 92 THEN d.id END,
               (g % 5000) * 60,
               CASE WHEN g % 3 = 0 THEN now() + ((g % 90) * interval '1 day') END
        FROM generate_series(1, :n) g JOIN _dealers d ON d.rn = 1 + g % :nd"""),
        {"owner": owner, "n": n_devices, "nd": n_dealers})
    log(f"  devices: {n_devices}  ({time.time()-t0:.1f}s)")

    # ---- a month of fault logs (~10 per device): 40% concentrated on ~3% "hot" devices, the rest spread evenly;
    #      5% unresolved.
    db.execute(text(f"""
        INSERT INTO {B}.fault_logs (id, pump_id, occurred_at, description, fault_code, resolved_at)
        SELECT g, 'BP-' || CASE WHEN g % 10 < 4 THEN 1 + (g % :hot) ELSE 1 + (g % :n) END,
               now() - (random() * interval '30 days'), 'bench', 1 + (g % 10),
               CASE WHEN g % 20 = 0 THEN NULL ELSE now() END
        FROM generate_series(1, :f) g"""), {"n": n_devices, "hot": max(1, n_devices // 33), "f": n_devices * 10})
    log(f"  fault logs: {db.execute(text(f'select count(*) from {B}.fault_logs')).scalar()}  ({time.time()-t0:.1f}s)")

    # ---- open + resolved alerts (unique on pump, type, code, bucket)
    db.execute(text(f"""
        INSERT INTO {B}.alerts (pump_id, alert_type, severity, dedup_bucket, fault_code, first_occurred_at,
                                last_occurred_at, resolved_at)
        SELECT 'BP-' || (1 + (g % :n)), CASE WHEN g % 12 = 0 THEN 'OFFLINE' ELSE 'FAULT' END, 'HIGH', g,
               CASE WHEN g % 12 = 0 THEN NULL ELSE 1 + (g % 10) END, now(), now(),
               CASE WHEN g % 5 = 0 THEN NULL ELSE now() END
        FROM generate_series(1, :a) g"""), {"n": n_devices, "a": int(n_devices * 1.5)})
    log(f"  alerts: {db.execute(text(f'select count(*) from {B}.alerts')).scalar()}  ({time.time()-t0:.1f}s)")

    # ---- 30 days of rollups for every device
    db.execute(text(f"""
        INSERT INTO {B}.daily_summary (id, device_id, day, runtime_min)
        SELECT (p - 1) * 30 + d, 'BP-' || p, current_date - d, 60 + (p + d) % 600
        FROM generate_series(1, :n) p, generate_series(1, 30) d"""), {"n": n_devices})
    log(f"  daily rollups: {db.execute(text(f'select count(*) from {B}.daily_summary')).scalar()}  ({time.time()-t0:.1f}s)")

    # ---- today's telemetry: a sampled subset (5,000 devices x 144 readings = 10-minute cadence, whole day)
    day0 = today_start_utc()
    db.execute(text(f"""
        INSERT INTO {B}.telemetry_history (id, pump_id, recorded_at, pump_on)
        SELECT p * 144 + r + 1, 'BP-' || (1 + p * :step), :t0 + (r * interval '10 minutes'), (p + r) % 3 <> 0
        FROM generate_series(0, :sample - 1) p, generate_series(0, 143) r"""),
        {"step": max(1, n_devices // min(5000, n_devices)), "sample": min(5000, n_devices), "t0": day0})
    log(f"  telemetry today: {db.execute(text(f'select count(*) from {B}.telemetry_history')).scalar()}  ({time.time()-t0:.1f}s)")

    # the per-device rollup the dashboard reads for runtime (what the background refresher maintains): minutes run today
    # and over the completed days of the 7-day window
    today = local_today()
    db.execute(text(f"""
        INSERT INTO {B}.dashboard_runtime (device_id, day, runtime_min, history_min, history_days)
        SELECT p.id, :day, COALESCE(t.m, 0), COALESCE(h.m, 0), 7 FROM {B}.pumps p
        LEFT JOIN (SELECT pump_id, COUNT(*) FILTER (WHERE pump_on) AS m FROM {B}.telemetry_history GROUP BY 1) t
               ON t.pump_id = p.id
        LEFT JOIN (SELECT device_id, SUM(runtime_min) AS m FROM {B}.daily_summary
                   WHERE day >= :hs AND day < :day GROUP BY 1) h ON h.device_id = p.id"""),
        {"day": today, "hs": today - timedelta(days=6)})
    db.execute(text(f"INSERT INTO {B}.fault_code_catalog SELECT * FROM agripump.fault_code_catalog"))
    db.commit()
    for t in TABLES:
        db.execute(text(f"ANALYZE {B}.{t}"))
    db.commit()
    log(f"  analysed ({time.time()-t0:.1f}s)")
    return owner


def context(db, role, org_path=None, hier=None, user="00000000-0000-0000-0000-0000000000aa"):
    """Set the same session variables the API sets for an authenticated caller (RLS applies as in production)."""
    db.execute(text("RESET app.bypass_rls"))
    for k, v in (("app.user_id", user), ("app.user_role", role), ("app.org_path", org_path or ""),
                 ("app.hierarchy_path", hier or "")):
        db.execute(text("SELECT set_config(:k, :v, false)"), {"k": k, "v": v})
    db.commit()  # a later rollback (after a timeout) must not undo the session settings


def run(db, label, fn, runs, results):
    from sqlalchemy.exc import OperationalError
    times = []
    try:
        fn()  # warm-up: plan cache and buffers
        for _ in range(runs):
            t = time.perf_counter()
            fn()
            times.append((time.perf_counter() - t) * 1000)
    except OperationalError as exc:
        db.rollback()
        reason = "TIMEOUT (>10 s statement limit)" if "statement timeout" in str(exc) else "ERROR"
        results.append({"scenario": label, "error": reason})
        print(f"  {label:<58} {reason}")
        return
    results.append({"scenario": label, "runs": runs, "p50_ms": round(pct(times, .5), 1), "p95_ms": round(pct(times, .95), 1),
                    "p99_ms": round(pct(times, .99), 1), "max_ms": round(max(times), 1)})
    r = results[-1]
    print(f"  {label:<58} p50 {r['p50_ms']:>8} ms  p95 {r['p95_ms']:>8} ms  p99 {r['p99_ms']:>8} ms")


def scenarios(db, runs, results, only=frozenset()):
    repo_mod.SCHEMA = B
    db.execute(text("SET statement_timeout = 10000"))  # the application's own 10 s limit (app/database.py)
    db.commit()
    repo = DashboardRepository(db)
    sub = lambda p: [r[0] for r in db.execute(text(  # noqa: E731
        f"SELECT id::text FROM {B}.organisations WHERE path OPERATOR(agripump.<@) CAST(:p AS agripump.ltree)"),
        {"p": p}).fetchall()]
    mfr, dist, dealer = "root.m1", "root.m1.d1", "root.m1.d1.x1"
    today0, today = today_start_utc(), local_today()
    since = datetime.now(timezone.utc) - timedelta(days=30)

    def battery(name, org_path, ids, hp=None):
        agg = {
            "device states": lambda: repo.get_device_state_summary(ids, hp),
            "connectivity": lambda: repo.get_connectivity_summary(ids, 600, hp),
            "active faults by type": lambda: repo.get_active_fault_summary(ids, hp),
            "faults today": lambda: repo.get_faults_today(ids, today0, hp),
            "top faulting (top 10, 30 d)": lambda: repo.get_top_faulting_devices(ids, since, 10, 0, hp),
            "firmware distribution": lambda: repo.get_firmware_distribution(ids, hp),
            "connectivity map": lambda: repo.get_connectivity_map(ids, 600, 2, hp),
            "runtime (history + live today)": lambda: repo.get_runtime_summary(ids, today, 7, hp, today0),
            "warranty expiring": lambda: repo.get_warranty_expiring_count(ids, 30, hp, today),
            "subscription expiring": lambda: repo.get_subscription_expiring_count(ids, 30, hp),
            "offline list (page of 50)": lambda: repo.get_offline_device_list(ids, 600, 50, 0, hp),
            "freshness (max last_seen)": lambda: repo.get_last_telemetry_update(ids, hp),
        }
        for k, fn in agg.items():
            run(db, f"{name}: {k}", fn, runs, results)

        def whole():
            repo.get_device_state_summary(ids, hp)
            repo.get_connectivity_summary(ids, 600, hp)
            repo.get_faults_today(ids, today0, hp)
            repo.get_active_fault_summary(ids, hp)
            repo.get_top_faulting_page(ids, since, 10, 0, hp)
            repo.get_firmware_distribution(ids, hp)
            repo.get_runtime_summary(ids, today, 7, hp, today0)
            repo.get_warranty_expiring_count(ids, 30, hp, today)
            repo.get_subscription_expiring_count(ids, 30, hp)
            repo.get_connectivity_map(ids, 600, 2, hp)
            repo.get_last_telemetry_update(ids, hp)

        run(db, f"{name}: WHOLE dashboard (uncached)", whole, max(5, runs // 3), results)

    print("\n== Manufacturer (25% of the fleet) ==")
    context(db, "manufacturer", mfr, "/SA/M1")
    battery("manufacturer", mfr, sub(mfr), "/SA/M1")
    print("\n== Distributor (5%) ==")
    context(db, "distributor", dist, "/SA/M1/D1")
    battery("distributor", dist, sub(dist), "/SA/M1/D1")
    print("\n== Dealer (0.5%) ==")
    context(db, "dealer", dealer, "/SA/M1/D1/X1")
    battery("dealer", dealer, sub(dealer), "/SA/M1/D1/X1")
    print("\n== Legacy dealer (no organisation, path only) ==")
    context(db, "dealer", None, "/SA/M1/D1/X1")
    battery("legacy dealer", None, [], "/SA/M1/D1/X1")
    print("\n== Super admin, global ==")
    context(db, "superadmin")
    battery("superadmin", None, None)


def explain(db, out):
    """EXPLAIN ANALYZE of the heaviest statements, as a manufacturer."""
    mfr = "root.m1"
    context(db, "manufacturer", mfr)
    ids = [r[0] for r in db.execute(text(
        f"SELECT id::text FROM {B}.organisations WHERE path <@ CAST(:p AS agripump.ltree)"), {"p": mfr}).fetchall()]
    today0 = today_start_utc()
    since = datetime.now(timezone.utc) - timedelta(days=30)
    plans = {}
    stmts = {
        "connectivity summary": (
            f"SELECT COUNT(*) FILTER (WHERE p.lifecycle_state IN ('COMMISSIONED','ACTIVE') AND p.last_seen_at >= :cutoff) "
            f"FROM {B}.pumps p WHERE p.org_id = ANY(CAST(:org_ids AS uuid[]))", {"cutoff": since, "org_ids": ids}),
        "faults today": (
            f"SELECT COUNT(*) FROM {B}.fault_logs fl JOIN {B}.pumps p ON p.id = fl.pump_id "
            f"WHERE p.org_id = ANY(CAST(:org_ids AS uuid[])) AND fl.occurred_at >= :t AND fl.fault_code > 0",
            {"t": today0, "org_ids": ids}),
        "top faulting": (
            f"SELECT fl.pump_id, COUNT(*) c FROM {B}.fault_logs fl JOIN {B}.pumps p ON p.id = fl.pump_id "
            f"WHERE p.org_id = ANY(CAST(:org_ids AS uuid[])) AND fl.occurred_at >= :s AND fl.fault_code > 0 "
            f"GROUP BY 1 ORDER BY c DESC LIMIT 10", {"s": since, "org_ids": ids}),
        "runtime live today": (
            f"SELECT COUNT(*) FILTER (WHERE t.pump_on) FROM {B}.telemetry_history t JOIN {B}.pumps p ON p.id = t.pump_id "
            f"WHERE p.org_id = ANY(CAST(:org_ids AS uuid[])) AND t.recorded_at >= :t", {"t": today0, "org_ids": ids}),
        "runtime history": (
            f"SELECT COALESCE(SUM(ds.runtime_min),0) FROM {B}.daily_summary ds JOIN {B}.pumps p ON p.id = ds.device_id "
            f"WHERE p.org_id = ANY(CAST(:org_ids AS uuid[])) AND ds.day >= current_date - 29 AND ds.day < current_date",
            {"org_ids": ids}),
    }
    for name, (sql, params) in stmts.items():
        rows = db.execute(text("EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) " + sql), params).fetchall()
        plans[name] = "\n".join(r[0] for r in rows)
    with open(out, "w", encoding="utf-8") as fh:
        for k, v in plans.items():
            fh.write(f"### {k}\n{v}\n\n")
    return plans


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--devices", type=int, default=100_000)
    ap.add_argument("--runs", type=int, default=30)
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--reuse", action="store_true", help="measure an existing bench schema instead of rebuilding it")
    ap.add_argument("--only", default="", help="comma-separated scopes: manufacturer,distributor,dealer,legacy,superadmin")
    ap.add_argument("--indexes", choices=("none", "current", "proposed"), default="current")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "bench_results"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    log = lambda m: print(m, flush=True)  # noqa: E731

    db = SessionLocal()
    try:
        if a.reuse:
            db.execute(text(f"SET search_path TO {B}, agripump, public"))
            db.commit()
        else:
            log(f"Building bench schema with {a.devices:,} devices ...")
            build(db, a.devices, log)
        if a.indexes == "proposed":
            for ddl in PROPOSED_INDEXES:
                t = time.time()
                db.execute(text(ddl.format(s=B)))
                db.commit()
                log(f"  + {ddl.split(' ON ')[0].split()[-1]}  ({time.time()-t:.1f}s)")
            raw = db.connection().connection.driver_connection
            raw.commit()
            raw.autocommit = True
            cur = raw.cursor()
            cur.execute(f"SET search_path TO {B}, agripump, public")
            for t in ("pumps", "fault_logs", "telemetry_history", "daily_summary", "dashboard_runtime"):
                cur.execute(f"VACUUM (ANALYZE) {B}.{t}")  # visibility map for index-only scans
            raw.autocommit = False
            db.execute(text(f"SET search_path TO {B}, agripump, public"))
            db.commit()
        results = []
        scenarios(db, a.runs, results, {x for x in a.only.split(',') if x})
        plans = explain(db, os.path.join(a.out, f"explain_{a.indexes}.txt"))
        with open(os.path.join(a.out, f"bench_{a.indexes}.json"), "w", encoding="utf-8") as fh:
            json.dump({"devices": a.devices, "runs": a.runs, "indexes": a.indexes,
                       "rows": {t: db.execute(text(f"SELECT count(*) FROM {B}.{t}")).scalar()
                                for t in ("organisations", "pumps", "fault_logs", "alerts", "daily_summary",
                                          "telemetry_history")},
                       "results": results}, fh, indent=2)
        print(f"\nWrote {a.out}")
    finally:
        try:
            db.rollback()
            db.execute(text("RESET ALL"))
            if not a.keep:
                db.execute(text("SET app.bypass_rls = 'on'"))
                db.execute(text(f"DROP SCHEMA IF EXISTS {B} CASCADE"))
                db.commit()
        finally:
            db.close()


if __name__ == "__main__":
    main()
