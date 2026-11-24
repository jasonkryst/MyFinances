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

# SMTP is optional; email stays off until SMTP_HOST is set
# (server/src/email/transport.js's isEmailConfigured()). Since 8.0.0 the
# password comes only from the SMTP_PASSWORD environment variable. Warn when
# a mail-server user is set without one, so failed sign-ins to the mail
# server are explained in the log.
if [ -n "${SMTP_HOST:-}" ] && [ -n "${SMTP_USER:-}" ] && [ -z "${SMTP_PASSWORD:-}" ]; then
    echo "WARNING: SMTP_HOST and SMTP_USER are set but SMTP_PASSWORD is empty, so the mail server will likely reject sign-in. Set SMTP_PASSWORD (.env or your stack variables); see DEPLOYMENT.md, Email Notifications." >&2
fi

exec "$@"