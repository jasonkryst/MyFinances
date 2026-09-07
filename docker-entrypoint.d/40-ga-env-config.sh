#!/bin/sh
# Writes /tmp/env-config.js (served at /env-config.js by nginx.conf) from the
# optional GA_MEASUREMENT_ID env var. Runs automatically -- the base nginx
# image's own /docker-entrypoint.sh executes every script in this directory
# before starting nginx. /tmp is the container's writable tmpfs mount
# (docker-compose.yml); the rest of the filesystem is read-only.
set -eu

GA_ID="${GA_MEASUREMENT_ID:-}"

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

if [ -n "$GA_ID" ]; then
    printf 'window.__ENV__ = Object.assign({ GA_MEASUREMENT_ID: "%s" }, window.__ENV__);\n' "$GA_ID" > /tmp/env-config.js
else
    printf 'window.__ENV__ = window.__ENV__ || {};\n' > /tmp/env-config.js
fi
