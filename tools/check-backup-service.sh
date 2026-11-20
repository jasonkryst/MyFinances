#!/usr/bin/env bash
# Runtime check for the docker-compose `backup` service (#656), run by CI's
# test-integration job after start-stack. The service crash-looped for two
# months unnoticed because CI started it but never looked at it.
#
# Checks: the container stays up without restarting, crond is running, and a
# manual backup (the command server/README.md documents) writes a non-empty
# dump that pg_restore can read. Run it by hand against any stack:
#   BACKUP_CONTAINER=myfinances-backup tools/check-backup-service.sh
set -euo pipefail

CONTAINER="${BACKUP_CONTAINER:-myfinances-backup}"
SETTLE_SECONDS="${BACKUP_SETTLE_SECONDS:-15}"

fail() {
    echo "::error::backup service check failed: $1"
    echo "--- docker logs $CONTAINER (last 50 lines)"
    docker logs --tail 50 "$CONTAINER" 2>&1 || true
    exit 1
}

# A crash-looping container restarts within seconds; give it time to show that.
sleep "$SETTLE_SECONDS"

state=$(docker inspect -f '{{.State.Status}} {{.State.Restarting}} {{.RestartCount}}' "$CONTAINER") \
    || fail "container $CONTAINER not found"
read -r status restarting restarts <<< "$state"
echo "backup container: status=$status restarting=$restarting restarts=$restarts"
[ "$status" = "running" ] || fail "container is $status, not running"
[ "$restarting" = "false" ] || fail "container is restarting"
[ "$restarts" = "0" ] || fail "container restarted $restarts time(s)"

docker exec "$CONTAINER" pgrep -x crond > /dev/null || fail "crond is not running"
echo "crond is running"

docker compose run --rm -T backup sh /usr/local/bin/docker-backup.sh \
    || fail "manual backup command failed"

docker exec "$CONTAINER" sh -c '
    f=$(ls -t /backups/myfinances-*.dump | head -1)
    test -s "$f" || { echo "newest dump $f is empty"; exit 1; }
    pg_restore -l "$f" > /dev/null || { echo "pg_restore cannot read $f"; exit 1; }
    echo "verified $f ($(wc -c < "$f") bytes)"
' || fail "no readable dump in /backups"

echo "backup service OK"
