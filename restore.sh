#!/usr/bin/env bash
# Restore the Postgres data volume from a backup.sh dump. DESTRUCTIVE: drops
# and recreates every object in the target database before loading the dump.
set -euo pipefail

# Prevent Git Bash on Windows from rewriting the container-internal /tmp/...
# path below into a host Windows path before it reaches `docker compose exec`.
# No-op on Linux/macOS.
export MSYS_NO_PATHCONV=1

if [ $# -ne 1 ]; then
    echo "Usage: ./restore.sh <path-to-dump-file>" >&2
    exit 1
fi

FILE="$1"
if [ ! -f "$FILE" ]; then
    echo "ERROR: $FILE not found" >&2
    exit 1
fi

echo "This will REPLACE all data in the myfinances-postgres database with the"
echo "contents of $FILE."
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

CONTAINER_TMP="/tmp/myfinances-restore-$(date +%Y%m%d-%H%M%S).dump"
docker compose cp "$FILE" "postgres:$CONTAINER_TMP"

echo "Restoring $FILE -> myfinances-postgres"
docker compose exec -T postgres pg_restore -U myfinances -d myfinances --clean --if-exists "$CONTAINER_TMP"
docker compose exec -T postgres rm -f "$CONTAINER_TMP"

echo "Done. Restart the server so it reconnects with a clean connection pool:"
echo "  docker compose restart server"
