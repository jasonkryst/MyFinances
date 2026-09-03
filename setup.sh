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

# ── 2. Configure SMTP (optional) ────────────────────────────────────────────
if [ -f secrets/smtp_password.txt ]; then
    echo "→ secrets/smtp_password.txt already exists — skipping SMTP setup"
else
    echo ""
    read -rp "Configure SMTP for email notifications? [y/N] " configure_smtp
    mkdir -p secrets
    if [[ "$configure_smtp" =~ ^[Yy]$ ]]; then
        read -rp "  SMTP host: " smtp_host
        read -rp "  SMTP port [587]: " smtp_port
        smtp_port=${smtp_port:-587}
        read -rp "  SMTP username (blank if none): " smtp_user
        read -rp "  From address: " smtp_from
        read -rsp "  SMTP password: " smtp_password
        echo ""
        printf '%s' "$smtp_password" > secrets/smtp_password.txt
        {
            echo "SMTP_HOST=$smtp_host"
            echo "SMTP_PORT=$smtp_port"
            echo "SMTP_USER=$smtp_user"
            echo "SMTP_FROM=$smtp_from"
            echo "SMTP_SECURE=false"
        } > .env
        echo "→ Generated secrets/smtp_password.txt and .env"
    else
        touch secrets/smtp_password.txt
        echo "→ Skipping SMTP setup — email notifications will stay disabled"
    fi
fi

echo ""

# ── 3. Start the stack ────────────────────────────────────────────────────────
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

# ── 4. Run migrations ─────────────────────────────────────────────────────────
echo ""
echo "Running database migrations..."
docker compose run --rm server npm run migrate up

# ── 5. Create first user ──────────────────────────────────────────────────────
echo ""
echo "Create your login account"
echo "-------------------------"
docker compose run --rm server node scripts/create-user.js

echo ""
echo "=============================="
echo "Setup complete!"
echo "Open http://localhost:32900 to access MyFinances."
echo ""
echo "In the Settings modal, choose 'PostgreSQL' as your storage backend"
echo "and log in with the credentials you just created."
echo ""