#!/bin/sh
# Writes /tmp/env-config.js (served at /env-config.js by nginx.conf) from
# optional env vars. Runs automatically -- the base nginx image's own
# /docker-entrypoint.sh executes every script in this directory before
# starting nginx. /tmp is the container's writable tmpfs mount
# (docker-compose.yml); the rest of the filesystem is read-only.
#
#   GA_MEASUREMENT_ID         optional Google Analytics id (issue #131)
#   REFRESH_ON_FOCUS_SECONDS  how long a tab must be hidden before it re-reads
#                             the server on return (issue #575); the app
#                             defaults to 60 when unset or invalid
set -eu

# ENV_CONFIG_OUT only exists so tests can write somewhere other than /tmp.
OUT="${ENV_CONFIG_OUT:-/tmp/env-config.js}"
GA_ID="${GA_MEASUREMENT_ID:-}"
REFRESH="${REFRESH_ON_FOCUS_SECONDS:-}"

# Google Analytics measurement ids are alphanumeric plus hyphens/underscores
# (e.g. G-XXXXXXXXXX). Reject anything else rather than embed an
# operator-supplied env var into a JS file unescaped.
case "$GA_ID" in
    '') ;;
    *[!A-Za-z0-9_-]*)
        echo "40-ga-env-config.sh: GA_MEASUREMENT_ID has unexpected characters, ignoring it" >&2
        GA_ID=""
        ;;
esac

# Whole seconds only, so the value is embedded as a bare number.
case "$REFRESH" in
    '') ;;
    *[!0-9]*)
        echo "40-ga-env-config.sh: REFRESH_ON_FOCUS_SECONDS must be a whole number of seconds, ignoring it" >&2
        REFRESH=""
        ;;
    *)
        # Drop leading zeros: 010 would be a legacy octal literal in JS.
        REFRESH=$(printf '%s' "$REFRESH" | sed 's/^0*\([0-9]\)/\1/')
        ;;
esac

ENTRIES=""
if [ -n "$GA_ID" ]; then
    ENTRIES="GA_MEASUREMENT_ID: \"$GA_ID\""
fi
if [ -n "$REFRESH" ]; then
    ENTRIES="${ENTRIES:+$ENTRIES, }REFRESH_ON_FOCUS_SECONDS: $REFRESH"
fi

if [ -n "$ENTRIES" ]; then
    printf 'window.__ENV__ = Object.assign({ %s }, window.__ENV__);\n' "$ENTRIES" > "$OUT"
else
    printf 'window.__ENV__ = window.__ENV__ || {};\n' > "$OUT"
fi
