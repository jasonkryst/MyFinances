#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "MyFinances — First-Time Setup"
echo "=============================="
echo ""

# ── 1. Generate postgres password ─────────────────────────────────────────────
if [ -f secrets/postgres_password.txt ]; then
    echo "→ secrets/postgres_password.txt already exists — skipping generation"
else
    mkdir -p secrets
    if command -v openssl &>/dev/null; then
        openssl rand -hex 32 > secrets/postgres_password.txt
    else
        node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > secrets/postgres_password.txt
    fi
    echo "→ Generated secrets/postgres_password.txt"
fi

echo ""

# ── 2. Start the stack ────────────────────────────────────────────────────────
echo "Starting containers (this may take a moment on first run)..."
docker compose up -d --build

echo ""
echo "Waiting for server to be healthy..."
for i in $(seq 1 60); do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' myfinances-server 2>/dev/null || true)
    [ "$STATUS" = "healthy" ] && break
    sleep 3
done

STATUS=$(docker inspect --format='{{.State.Health.Status}}' myfinances-server 2>/dev/null || echo "unknown")
if [ "$STATUS" != "healthy" ]; then
    echo "ERROR: Server did not become healthy. Check logs with: docker compose logs server" >&2
    exit 1
fi

# ── 3. Run migrations ─────────────────────────────────────────────────────────
echo ""
echo "Running database migrations..."
docker compose run --rm server npm run migrate up

# ── 4. Create first user ──────────────────────────────────────────────────────
echo ""
echo "Create your login account"
echo "-------------------------"
docker compose run --rm server node scripts/create-user.js

echo ""
echo "=============================="
echo "Setup complete!"
echo "Open http://localhost:5500 to access MyFinances."
echo ""
echo "In the Settings modal, choose 'PostgreSQL' as your storage backend"
echo "and log in with the credentials you just created."
echo ""