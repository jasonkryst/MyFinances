#!/bin/sh
set -e

# Since 8.0.0 the database password is the POSTGRES_PASSWORD environment
# variable (the Docker secret file is no longer read). An explicit DATABASE_URL
# (local dev, test containers) wins. The password is percent-encoded so @, :
# and / can't break the URL, and a trailing CR/LF (a .env saved on Windows) is
# dropped, as initdb drops it when it sets the password (#656).
if [ -z "${DATABASE_URL:-}" ]; then
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        echo "ERROR: POSTGRES_PASSWORD is not set (and DATABASE_URL isn't either). Since 8.0.0 the database password is the POSTGRES_PASSWORD environment variable; see DEPLOYMENT.md." >&2
        exit 1
    fi
    PG_PASS_ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.env.POSTGRES_PASSWORD.replace(/[\r\n]+$/, "")))')
    export DATABASE_URL="postgres://myfinances:${PG_PASS_ENC}@postgres:5432/myfinances"
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