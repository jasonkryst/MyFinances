#!/usr/bin/env bash
# Back up the Postgres data volume used by the optional self-hosted backend.
# Writes a pg_dump custom-format archive (restorable with restore.sh) to
# BACKUP_DIR (default ./backups). Safe to run against a live stack -- pg_dump
# takes a consistent snapshot without blocking normal reads/writes.
#
# Dumps to a temp path inside the postgres container first, then copies it
# out with `docker compose cp` -- piping pg_dump's binary output straight
# through a shell redirect is not reliably byte-safe on every platform
# (notably PowerShell on Windows), so both backup.sh and backup.ps1 use this
# same two-step approach.
set -euo pipefail

# Prevent Git Bash on Windows from rewriting the container-internal /tmp/...
# path below into a host Windows path before it reaches `docker compose exec`.
# No-op on Linux/macOS.
export MSYS_NO_PATHCONV=1

BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/myfinances-$TIMESTAMP.dump"
CONTAINER_TMP="/tmp/myfinances-backup-$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "Backing up myfinances-postgres -> $FILE"
docker compose exec -T postgres pg_dump -U myfinances -d myfinances -Fc -f "$CONTAINER_TMP"
docker compose cp "postgres:$CONTAINER_TMP" "$FILE"
docker compose exec -T postgres rm -f "$CONTAINER_TMP"

SIZE=$(du -h "$FILE" | cut -f1)
echo "Done ($SIZE). Restore with: ./restore.sh \"$FILE\""
