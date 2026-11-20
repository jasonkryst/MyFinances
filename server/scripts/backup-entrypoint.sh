#!/usr/bin/env sh
# Entrypoint for the docker-compose `backup` service (#159, #656).
#
# No arguments: install the crontab from BACKUP_SCHEDULE and run crond in the
# foreground (PID 1). Each run's output goes to PID 1's stdout, so
# `docker logs myfinances-backup` shows it.
#
# With arguments: run them instead, so a one-off backup is
#   docker compose run --rm backup sh /usr/local/bin/docker-backup.sh
#
# Both scripts are bind-mounted read-only, so they are always run through `sh`
# and never chmod-ed. Keep this file LF-only (.gitattributes: *.sh eol=lf).
set -eu

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

SCHEDULE="${BACKUP_SCHEDULE:-0 2 * * *}"
echo "$SCHEDULE sh /usr/local/bin/docker-backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "Backup schedule: $SCHEDULE (keeping ${BACKUP_RETENTION_DAYS:-7} days of dumps in /backups)"
exec crond -f -l 2
