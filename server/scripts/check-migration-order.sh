#!/bin/sh
# Fails if a migration added by this branch sorts BEFORE the newest migration
# already on the base branch. node-pg-migrate refuses to start the server when
# an unapplied migration precedes an applied one, so a lower-numbered
# migration that merges after a higher-numbered one crash-loops every
# deployment that already ran the higher one (this happened with
# 1755600000026 vs 1755600000027 — see server/migrations/1755600000029_*).
#
# Usage: check-migration-order.sh <base-ref>   (e.g. origin/main)
set -eu
BASE="${1:?usage: check-migration-order.sh <base-ref>}"
DIR="server/migrations"

base_list=$(git ls-tree --name-only "$BASE" "$DIR/" | sed "s#^$DIR/##" | grep -E '^[0-9]+_.*\.js$' | sort)
head_list=$(ls "$DIR" | grep -E '^[0-9]+_.*\.js$' | sort)
base_max=$(printf '%s\n' "$base_list" | tail -n 1 | cut -d_ -f1)

status=0
for f in $(printf '%s\n' "$head_list" | grep -vxF "$base_list" || true); do
    n=$(printf '%s' "$f" | cut -d_ -f1)
    if [ "$n" -le "$base_max" ]; then
        echo "::error file=$DIR/$f::Migration $f is numbered at or below $BASE's newest migration ($base_max). Renumber it above $base_max, or deployments that already applied $base_max will refuse to start."
        status=1
    else
        echo "ok: $f > $base_max"
    fi
done
[ "$status" -eq 0 ] && echo "Migration order OK (base newest: $base_max)"
exit "$status"
