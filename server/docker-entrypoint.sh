#!/bin/sh
set -e

# Prefer the Docker secret file; fall back to DATABASE_URL if the file isn't
# present (local dev, test containers, Portainer env-var injection).
SECRET_FILE="/run/secrets/postgres_password"
if [ -f "$SECRET_FILE" ]; then
    PG_PASS=$(cat "$SECRET_FILE")
    export DATABASE_URL="postgres://myfinances:${PG_PASS}@postgres:5432/myfinances"
elif [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: /run/secrets/postgres_password not found and DATABASE_URL is not set" >&2
    exit 1
fi

# SMTP is optional -- an empty or missing secret file just means email
# notifications stay disabled (server/src/email/transport.js's
# isEmailConfigured() checks SMTP_HOST, not this password).
SMTP_SECRET_FILE="/run/secrets/smtp_password"
if [ -s "$SMTP_SECRET_FILE" ]; then
    export SMTP_PASSWORD=$(cat "$SMTP_SECRET_FILE")
fi

exec "$@"