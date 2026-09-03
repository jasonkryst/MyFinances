# MyFinances Server (Phase 1)

Self-hosted Node.js + PostgreSQL backend for MyFinances multi-device sync.
Optional — the browser app works fully without this; see the root
`CLAUDE.md` for how it fits into the overall architecture.

## First-time setup

Use `setup.sh` (Linux/macOS) or `setup.ps1` (Windows) from the repo root.
This generates a secure Postgres password as a Docker secret, starts the
stack, runs migrations, and creates the admin user in one step:

    # Linux / macOS
    ./setup.sh

    # Windows
    .\setup.ps1

See the "PostgreSQL Backend Deployment" section in `DEPLOYMENT.md` for
full prerequisites and Portainer GitOps wiring.

## Local development (bare Node, no Docker)

Set `DATABASE_URL` directly and run the server without the Docker entrypoint:

    export DATABASE_URL="postgres://myfinances:yourpassword@localhost:5432/myfinances"
    npm install
    npm run migrate up
    npm start
    # Then open http://localhost:4000 in a browser (default PORT; override via the PORT env var)
    # The app will show a setup wizard to create the first user.
    # Alternatively, run:  node scripts/create-user.js  for headless setup.

## Tests

Tests require a real Postgres instance (never mocked):

    docker compose -f docker-compose.test.yml up -d
    export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
    npm run migrate up
    npm test

## Production

See the root `docker-compose.yml` (`postgres` and `server` services) and
`nginx.conf`'s `/api/` and `/auth/` proxy blocks. The `server` service's
Docker build context is the repo root (not `server/`) because
`src/sanitizers/index.js` reuses the frontend's `src/sanitizers.js` and
`src/utils.js` by relative import rather than duplicating validation
logic — the Dockerfile copies that directory into the image at `/src`.

Secrets are handled via Docker secrets (`/run/secrets/postgres_password`),
not environment variables. `server/docker-entrypoint.sh` reads the secret
at startup and constructs `DATABASE_URL` internally so the password never
appears in `docker inspect` output or shell history.

The `postgres-data` volume is the only durability layer for this backend —
use the root-level `backup.sh`/`backup.ps1` and `restore.sh`/`restore.ps1`
scripts to back it up; see "Backup and Restore" in the root `DEPLOYMENT.md`.

## Email notifications (optional)

The server can send email over SMTP — currently just a "send test email"
action from the app's Settings modal, plus an automatic welcome email when
an account is created. It's off by default; automated bill/balance
notifications are a future feature built on top of this foundation. See
`docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md`
for the full design.

### Configuring SMTP

Run `setup.sh`/`setup.ps1` and answer "y" when asked to configure SMTP, or
configure manually:

- Set `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_FROM`,
  and `SMTP_SECURE` (`true`/`false`) as environment variables on the
  `server` service — a root `.env` file works with the provided
  `docker-compose.yml`.
- Place the SMTP account's password in `secrets/smtp_password.txt`, a
  Docker secret using the same pattern as
  `secrets/postgres_password.txt` — `docker-entrypoint.sh` reads it into
  `SMTP_PASSWORD` at container startup.

Leaving `SMTP_HOST` unset disables the feature entirely — nothing fails
to start, and the test-email endpoint just returns
`503 EMAIL_NOT_CONFIGURED`. `secrets/smtp_password.txt` must still exist
(even empty) because Docker Compose requires every file a service's
`secrets:` list references to be present — `setup.sh`/`setup.ps1` create
it either way.

### Verifying it works

Log in, open Settings, and click "Send test email" — it emails the
logged-in account's own address (never an arbitrary address the client
supplies, so the endpoint can't be used as an open relay).