#!/bin/sh
# Copies the whole database into a file, now and then every BACKUP_INTERVAL_HOURS, and deletes copies older than BACKUP_KEEP_DAYS.
# Runs inside the `backup` container (see docker-compose.yml). The files land in ./backups on the server: copy that folder off the server too
# (see deploy/README.md), because a backup that lives only on the machine that fails is not a backup.
#   BACKUP_RUN_ONCE=1   make one copy and stop (handy for a manual backup or a test)
set -eu

HOST="${PGHOST:-db}"
NAME="${BACKUP_DB_NAME:-agripump}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_HOURS:-24}"
DIR="${BACKUP_DIR:-/backups}"
export PGPASSWORD="${PGPASSWORD:?PGPASSWORD is needed}"
USER_NAME="${PGUSER:-postgres}"

mkdir -p "$DIR"
while true; do
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  file="$DIR/${NAME}-${stamp}.dump"
  if pg_dump -h "$HOST" -U "$USER_NAME" -d "$NAME" -Fc -f "$file.partial"; then
    mv "$file.partial" "$file"
    echo "backup written: $file ($(wc -c < "$file") bytes)"
  else
    rm -f "$file.partial"
    echo "BACKUP FAILED at $stamp" >&2
  fi
  find "$DIR" -name "${NAME}-*.dump" -mtime +"$KEEP_DAYS" -delete
  [ "${BACKUP_RUN_ONCE:-0}" = "1" ] && exit 0
  sleep $((INTERVAL * 3600))
done
