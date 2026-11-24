#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "MyFinances — First-Time Setup"
echo "=============================="
echo ""

# Since 8.0.0 the credentials are variables in .env (POSTGRES_PASSWORD,
# SMTP_PASSWORD), not files in secrets/. .env holds them, so it is kept
# readable only by you.
env_has() { [ -f .env ] && grep -q "^$1=" .env; }

# ── 1. Generate the database password ────────────────────────────────────────
if env_has POSTGRES_PASSWORD; then
    echo "→ POSTGRES_PASSWORD already in .env — skipping generation"
else
    if command -v openssl &>/dev/null; then
        pg_password=$(openssl rand -hex 32)
    else
        pg_password=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
    fi
    echo "POSTGRES_PASSWORD=$pg_password" >> .env
    chmod 600 .env
    echo "→ Generated POSTGRES_PASSWORD in .env"
fi

echo ""

# ── 2. Configure SMTP (optional) ────────────────────────────────────────────

# Compose reads a single-quoted .env value literally, so the password can hold
# any character except a single quote.
write_smtp_password() {
    if [[ "$1" == *"'"* ]]; then
        echo "  The SMTP password contains a single quote ('), which a .env file can't hold."
        echo "  Set SMTP_PASSWORD yourself (Portainer stack variable or shell environment)."
        return 1
    fi
    printf "SMTP_PASSWORD='%s'\n" "$1" >> .env
    chmod 600 .env
}

if env_has SMTP_HOST; then
    echo "→ SMTP settings already in .env — skipping SMTP setup"
else
    echo ""
    read -rp "Configure SMTP for email notifications? [y/N] " configure_smtp
    if [[ "$configure_smtp" =~ ^[Yy]$ ]]; then
        read -rp "  SMTP host: " smtp_host
        read -rp "  SMTP port [587]: " smtp_port
        smtp_port=${smtp_port:-587}
        if [ "$smtp_port" = "465" ]; then
            smtp_secure=true
        else
            smtp_secure=false
        fi
        read -rp "  SMTP username (blank if none): " smtp_user
        read -rp "  From address: " smtp_from
        read -rsp "  SMTP password: " smtp_password
        echo ""
        if [ -f .env ]; then
            grep -v '^SMTP_' .env > .env.tmp || true
            mv .env.tmp .env
            chmod 600 .env
        fi
        {
            echo "SMTP_HOST=$smtp_host"
            echo "SMTP_PORT=$smtp_port"
            echo "SMTP_USER=$smtp_user"
            echo "SMTP_FROM=$smtp_from"
            echo "SMTP_SECURE=$smtp_secure"
        } >> .env
        write_smtp_password "$smtp_password" || true
        echo "→ Wrote the SMTP settings to .env (readable only by you)"
    else
        echo "SMTP_HOST=" >> .env
        echo "→ Skipping SMTP setup — email notifications will stay disabled"
    fi
fi

echo ""

# ── 3. Start the stack ────────────────────────────────────────────────────────
echo "Starting containers (this may take a moment on first run)..."
export ALLOW_SETUP=true
echo "→ ALLOW_SETUP=true — /auth/register endpoint is open for first-run setup"
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
echo "Sign in with the credentials you just created."
echo ""
echo "IMPORTANT: Disable the registration endpoint now that setup is complete:"
echo "  export ALLOW_SETUP="
echo "  docker compose restart server"
echo "This closes /auth/register (it will return 404 for all future requests)."
echo ""