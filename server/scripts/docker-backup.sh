#!/usr/bin/env sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/myfinances-$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"

PGPASSWORD=$(cat /run/secrets/postgres_password) \
    pg_dump -h postgres -U myfinances -d myfinances -Fc -f "$FILE"

echo "Backup written: $FILE"

# Prune files older than RETENTION_DAYS
find "$BACKUP_DIR" -name "myfinances-*.dump" -mtime +"$RETENTION_DAYS" -delete
echo "Pruned backups older than $RETENTION_DAYS days"
