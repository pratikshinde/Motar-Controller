#!/usr/bin/env bash
# Collect what is needed to tell how a database was built, without touching it or copying any data.
#
#   PGHOST=... PGPORT=5432 PGUSER=... PGPASSWORD=... PGDATABASE=... bash scripts/collect_schema_report.sh
#   (or:  bash scripts/collect_schema_report.sh "postgresql://user:password@host:5432/dbname")
#
# Writes ./schema_report/ containing:
#   schema.sql       the structure only (tables, columns, constraints, indexes, policies, triggers, functions):
#                    no rows, no owners, no privileges, no passwords
#   facts.txt        server version, extensions, the migration version marker (if any), and row COUNTS per table
# Read-only: it only runs pg_dump --schema-only and SELECT statements.
set -euo pipefail

OUT="${OUT:-schema_report}"
DSN="${1:-}"
mkdir -p "$OUT"

psql_() { if [ -n "$DSN" ]; then psql "$DSN" -X -q -At "$@"; else psql -X -q -At "$@"; fi; }

echo "Reading the structure (no data)..."
if [ -n "$DSN" ]; then
  pg_dump "$DSN" --schema-only --no-owner --no-privileges --no-comments --no-tablespaces \
          --schema=agripump --file "$OUT/schema.sql"
else
  pg_dump --schema-only --no-owner --no-privileges --no-comments --no-tablespaces \
          --schema=agripump --file "$OUT/schema.sql"
fi

echo "Reading a few facts..."
{
  echo "== server"
  psql_ -c "select version();"
  echo
  echo "== extensions"
  psql_ -c "select extname || ' ' || extversion from pg_extension order by 1;"
  echo
  echo "== migration version marker (empty or an error below means the database was never versioned by Alembic)"
  psql_ -c "select version_num from agripump.alembic_version;" 2>&1 || true
  echo
  echo "== tables in the agripump schema and roughly how many rows each holds (planner estimates, so 0 can mean not counted yet)"
  psql_ -F ' ' -c "select relname, n_live_tup from pg_stat_user_tables where schemaname = 'agripump' order by relname;"
  echo
  echo "== row-level security"
  psql_ -F ' ' -c "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'agripump' and c.relkind = 'r' order by 1;"
  echo
  echo "== accounts by role (counts only)"
  psql_ -F ' ' -c "select role, count(*) from agripump.users group by role order by 1;" 2>&1 || true
} > "$OUT/facts.txt"

echo
echo "Done. Send me the two files in ./$OUT/ (schema.sql and facts.txt)."
echo "They contain table and column names and counts, no passwords and no rows."
