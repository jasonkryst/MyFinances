#!/usr/bin/env sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/myfinances-$TIMESTAMP.dump"

PARTIAL="$FILE.partial"

mkdir -p "$BACKUP_DIR"

# A failed pg_dump must never leave a file that looks like a backup (#656: a
# failed run left a 0-byte .dump). Dump to .partial, rename only on success.
trap 'rm -f "$PARTIAL"' EXIT

# Strip CR/LF: a secret file saved on Windows ends in CRLF, and initdb drops the
# CR when it sets the password, so a raw $(cat) fails to authenticate (#656).
PGPASSWORD=$(tr -d '\r\n' < /run/secrets/postgres_password) \
    pg_dump -h postgres -U myfinances -d myfinances -Fc -f "$PARTIAL"

mv "$PARTIAL" "$FILE"
echo "Backup written: $FILE ($(wc -c < "$FILE") bytes)"

# Prune files older than RETENTION_DAYS
find "$BACKUP_DIR" -name "myfinances-*.dump" -mtime +"$RETENTION_DAYS" -delete
# A run killed mid-dump (container stopped) can't reach its EXIT trap.
find "$BACKUP_DIR" -name "myfinances-*.dump.partial" -mmin +60 -delete
echo "Pruned backups older than $RETENTION_DAYS days"
