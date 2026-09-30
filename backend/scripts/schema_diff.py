"""Compare the `agripump` schema of two PostgreSQL databases and say what differs.

    python scripts/schema_diff.py --left postgresql://... --right postgresql://...

Typical use: LEFT = a database built by `alembic upgrade head` from empty (what the migrations promise),
RIGHT = a database that has been running (what you actually have). Only reads catalog tables and the small
reference-data tables named below; it never writes.

Exit code 0 = no differences, 1 = differences (each printed), 2 = could not connect.
Names of constraints and indexes are ignored (a database built one way names them differently); what they enforce
is compared.
"""
import argparse
import re
import sys
from collections import defaultdict

from sqlalchemy import create_engine, text

SCHEMA = "agripump"
REFERENCE_TABLES = {"fault_code_catalog": "code"}          # rows that the application cannot work without
IGNORED_TABLES = {"alembic_version"}


def _q(conn, sql, **params):
    return [tuple(r) for r in conn.execute(text(sql), params)]


def _norm(sql: str) -> str:
    """Whitespace, casing of keywords and schema qualification do not change what a definition means."""
    s = re.sub(r"\s+", " ", sql or "").strip()
    s = s.replace(f"{SCHEMA}.", "").replace('"', "")
    return re.sub(r"\b(?:public)\.", "", s)


def snapshot(url: str) -> dict:
    eng = create_engine(url)
    snap = {}
    with eng.connect() as c:
        c.execute(text("SELECT set_config('app.bypass_rls', 'on', true)"))   # count reference rows through row-level security
        tables = {r[0] for r in _q(c, "select tablename from pg_tables where schemaname = :s", s=SCHEMA)} - IGNORED_TABLES
        snap["tables"] = tables

        cols = {}
        for t, col, typ, nullable in _q(c, """
                select table_name, column_name, format_type(a.atttypid, a.atttypmod), (a.attnotnull = false)
                from information_schema.columns ic
                join pg_attribute a on a.attrelid = (quote_ident(ic.table_schema) || '.' || quote_ident(ic.table_name))::regclass
                                   and a.attname = ic.column_name
                where table_schema = :s""", s=SCHEMA):
            if t in tables:
                cols[(t, col)] = (typ, "NULL" if nullable else "NOT NULL")
        snap["columns"] = cols

        defaults = {}
        for t, col, d in _q(c, """
                select table_name, column_name, column_default from information_schema.columns
                where table_schema = :s and column_default is not null""", s=SCHEMA):
            if t in tables:
                defaults[(t, col)] = _norm(d)
        snap["defaults"] = defaults

        cons = defaultdict(set)
        for t, definition in _q(c, """
                select cl.relname, pg_get_constraintdef(co.oid)
                from pg_constraint co join pg_class cl on cl.oid = co.conrelid
                join pg_namespace n on n.oid = cl.relnamespace
                where n.nspname = :s and co.contype in ('p', 'u', 'f', 'c')""", s=SCHEMA):
            if t in tables:
                cons[t].add(_norm(definition))
        snap["constraints"] = cons

        idx = defaultdict(set)
        for t, definition in _q(c, "select tablename, indexdef from pg_indexes where schemaname = :s", s=SCHEMA):
            if t in tables:
                # CREATE [UNIQUE] INDEX <name> ON ... -> drop the name
                idx[t].add(_norm(re.sub(r"(INDEX)\s+\S+\s+(ON)", r"\1 \2", definition)))
        snap["indexes"] = idx

        pol = {}
        for t, name, cmd, qual, check in _q(c, """
                select cl.relname, p.polname, p.polcmd::text, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
                from pg_policy p join pg_class cl on cl.oid = p.polrelid join pg_namespace n on n.oid = cl.relnamespace
                where n.nspname = :s""", s=SCHEMA):
            if t in tables:
                pol[(t, name)] = (cmd, _norm(qual or ""), _norm(check or ""))
        snap["policies"] = pol
        snap["rls"] = {r[0]: (r[1], r[2]) for r in _q(c, """
                select relname, relrowsecurity, relforcerowsecurity from pg_class cl
                join pg_namespace n on n.oid = cl.relnamespace where n.nspname = :s and relkind = 'r'""", s=SCHEMA)
                       if r[0] in tables}

        trg = {}
        for t, name, definition in _q(c, """
                select cl.relname, tg.tgname, pg_get_triggerdef(tg.oid)
                from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace
                where n.nspname = :s and not tg.tgisinternal""", s=SCHEMA):
            if t in tables:
                trg[(t, name)] = _norm(re.sub(r"CREATE (CONSTRAINT )?TRIGGER \S+", "CREATE TRIGGER", definition))
        snap["triggers"] = trg

        snap["functions"] = {
            (name, args): _norm(src) for name, args, src in _q(c, """
                select p.proname, pg_get_function_identity_arguments(p.oid), p.prosrc
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = :s""", s=SCHEMA)
        }
        snap["extensions"] = {r[0] for r in _q(c, "select extname from pg_extension")}

        ref = {}
        for table, key in REFERENCE_TABLES.items():
            if table in tables:
                ref[table] = {r[0] for r in _q(c, f'select {key} from {SCHEMA}.{table}')}
        snap["reference"] = ref
    eng.dispose()
    return snap


def compare(left: dict, right: dict, left_name: str, right_name: str) -> list:
    out = []

    def add(kind, what, detail=""):
        out.append(f"[{kind}] {what}" + (f": {detail}" if detail else ""))

    for t in sorted(left["tables"] - right["tables"]):
        add("table", f"{t} only in {left_name}")
    for t in sorted(right["tables"] - left["tables"]):
        add("table", f"{t} only in {right_name}")
    common = left["tables"] & right["tables"]

    for key in sorted(set(left["columns"]) | set(right["columns"])):
        if key[0] not in common:
            continue
        a, b = left["columns"].get(key), right["columns"].get(key)
        if a is None:
            add("column", f"{key[0]}.{key[1]} only in {right_name}", f"{b[0]} {b[1]}")
        elif b is None:
            add("column", f"{key[0]}.{key[1]} only in {left_name}", f"{a[0]} {a[1]}")
        elif a != b:
            add("column", f"{key[0]}.{key[1]}", f"{left_name}={a[0]} {a[1]} | {right_name}={b[0]} {b[1]}")

    for key in sorted(set(left["defaults"]) | set(right["defaults"])):
        if key[0] in common and left["defaults"].get(key) != right["defaults"].get(key):
            if (key in left["columns"]) and (key in right["columns"]):
                add("default", f"{key[0]}.{key[1]}", f"{left_name}={left['defaults'].get(key)} | {right_name}={right['defaults'].get(key)}")

    for section, label in (("constraints", "constraint"), ("indexes", "index")):
        for t in sorted(common):
            a, b = left[section].get(t, set()), right[section].get(t, set())
            for d in sorted(a - b):
                add(label, f"{t} only in {left_name}", d)
            for d in sorted(b - a):
                add(label, f"{t} only in {right_name}", d)

    for key in sorted(set(left["policies"]) | set(right["policies"])):
        if key[0] not in common:
            continue
        a, b = left["policies"].get(key), right["policies"].get(key)
        if a != b:
            add("policy", f"{key[0]}.{key[1]}", "missing on one side" if (a is None or b is None) else "definitions differ")
    for t in sorted(common):
        if left["rls"].get(t) != right["rls"].get(t):
            add("rls", t, f"{left_name}={left['rls'].get(t)} | {right_name}={right['rls'].get(t)} (enabled, forced)")

    for key in sorted(set(left["triggers"]) | set(right["triggers"])):
        a, b = left["triggers"].get(key), right["triggers"].get(key)
        if a != b:
            add("trigger", f"{key[0]}.{key[1]}", "missing on one side" if (a is None or b is None) else "definitions differ")
    for key in sorted(set(left["functions"]) | set(right["functions"])):
        a, b = left["functions"].get(key), right["functions"].get(key)
        if a != b:
            add("function", f"{key[0]}({key[1]})", "missing on one side" if (a is None or b is None) else "body differs")

    for ext in sorted(left["extensions"] ^ right["extensions"]):
        add("extension", f"{ext} only in {left_name if ext in left['extensions'] else right_name}")
    for table in sorted(set(left["reference"]) & set(right["reference"])):
        for k in sorted(left["reference"][table] - right["reference"][table]):
            add("reference data", f"{table} row {k} only in {left_name}")
        for k in sorted(right["reference"][table] - left["reference"][table]):
            add("reference data", f"{table} row {k} only in {right_name}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--left", required=True, help="SQLAlchemy URL, usually the database built by alembic from empty")
    ap.add_argument("--right", required=True, help="SQLAlchemy URL of the database to check")
    ap.add_argument("--left-name", default="left")
    ap.add_argument("--right-name", default="right")
    args = ap.parse_args()

    try:
        left, right = snapshot(args.left), snapshot(args.right)
    except Exception as exc:  # connection or permission problems
        print(f"Could not read a database: {exc}", file=sys.stderr)
        return 2
    diffs = compare(left, right, args.left_name, args.right_name)
    for line in diffs:
        print(line)
    print(f"\n{len(diffs)} difference(s)" if diffs else "No differences.")
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main())
