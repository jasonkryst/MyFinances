# MyFinances Server

Self-hosted Node.js + PostgreSQL API for MyFinances. Since 7.0.0 it is
**required**: it is the app's only storage, and the browser keeps no financial
data. See the root `CLAUDE.md` ("Storage (PostgreSQL)") for how the frontend
boots against it.

## First-time setup

Use `setup.sh` (Linux/macOS) or `setup.ps1` (Windows) from the repo root.
This generates a secure Postgres password as a Docker secret, starts the
stack, runs migrations, and creates the admin user in one step:

    # Linux / macOS
    ./setup.sh

    # Windows
    .\setup.ps1

See the "PostgreSQL Server Setup (Required)" section in `DEPLOYMENT.md` for
full prerequisites and Portainer GitOps wiring.

## Local development (bare Node, no Docker)

Set `DATABASE_URL` directly and run the server without the Docker entrypoint:

    export DATABASE_URL="postgres://myfinances:yourpassword@localhost:5432/myfinances"
    npm install
    npm run migrate up
    npm start
    # Serves the API only on http://localhost:4000 (default PORT; override via the PORT env var).
    # The frontend is served by the stack's nginx container, which proxies /api/, /auth/
    # and /calendar.ics here; run the full stack (docker compose up -d) to use the app.
    # Create the first user with:  node scripts/create-user.js

## Tests

Tests require a real Postgres instance (never mocked):

    docker compose -f docker-compose.test.yml up -d
    export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
    npm run migrate up
    npm test

## Production

`POST /auth/register` is disabled (returns 404) unless `ALLOW_SETUP=true` is set in the
server container's environment. The `setup.sh` / `setup.ps1` scripts set this automatically
during the guided setup flow and prompt you to remove it after account creation. For manual
deployments, set it before `docker compose up`, then remove it and restart the server
(`docker compose restart server`) once your account is created.

> **Don't expose the server/API port publicly until setup is complete.** Even with the
> `ALLOW_SETUP` gate, `POST /auth/register` creates the single admin account — run setup
> immediately after `docker compose up`, or keep the port firewalled/VPN-only until it's done.

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

## Password security (issue #456)

New passwords follow NIST SP 800-63B rev 4. The rules apply wherever a password
is *set*: `POST /auth/register`, `POST /auth/reset-password`,
`POST /auth/change-password` and `scripts/create-user.js`. Login never checks
them, so an existing shorter password keeps working until it is changed.

- 15 to 128 characters, counted as Unicode code points. Spaces and any
  character are allowed, and there are no composition rules.
- Rejected: repetitive or sequential passwords (`aaaa…`, `12345…`, `qwerty…`,
  a block typed twice), anything on the bundled 10,000 most common passwords
  list (also matched after stripping leading/trailing digits and symbols), and
  passwords containing the app name or the email name (3+ characters).
- The rules live in `src/passwordPolicy.js`, shared with the browser's
  strength meter, and `src/auth/passwordCheck.js` adds the common list and the
  breach check.
- A rejection is `400 { error: { code: 'VALIDATION_FAILED', reason, message } }`.
  `reason` is one of `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`,
  `PASSWORD_REPETITIVE`, `PASSWORD_COMMON`, `PASSWORD_CONTEXT`,
  `PASSWORD_BREACHED` or `PASSWORD_UNCHANGED`. The browser shows its own
  en/es/pl text for each.
- `GET /auth/password-policy` (anonymous) returns
  `{ minLength, maxLength, breachedCheckEnabled }`.

### Breached-password check (optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECURITY_CHECK_BREACHED_PASSWORDS` | off | `true` checks each new password against Have I Been Pwned's Pwned Passwords range API (the issue's `Security:CheckBreachedPasswords`). |
| `SECURITY_BREACH_CHECK_URL` | `https://api.pwnedpasswords.com/range/` | Range endpoint. Point it at a self-hosted mirror of the HIBP dataset if the server has no internet access. |
| `SECURITY_BREACH_CHECK_TIMEOUT_MS` | `3000` | Per-request timeout. |

- **k-anonymity:** only the first 5 hex characters of the password's SHA-1
  leave the server, with `Add-Padding: true`; the match happens locally.
- **Fails open:** a timeout, network error or non-2xx response accepts the
  password and logs a warning with no password data. It runs last, after the
  local rules, and on reset only after the token is valid.
- **No egress:** leave it off (the default), or use a mirror.

### Locked out, or forgot the password

- **Emails are not case-sensitive.** They are stored trimmed and lowercase; sign-in, setup and forgot-password compare the same way (`src/auth/email.js`).
- **The lockout.** Sign-in allows 5 failed attempts per 15 minutes per address. The app says how many minutes are left (from `Retry-After`), and the server logs `[auth] login rate limit reached for <ip>`. The counter lives in memory, so `docker compose restart server` clears it at once.
- **Reset the password without email:**

      docker compose run --rm server node scripts/reset-password.js

  It asks for the account email and a new password (or pipe both lines on stdin), applies the sign-up password policy, and signs out every session.
- **Behind another reverse proxy** (Traefik, Nginx Proxy Manager, Caddy, a tunnel), set `TRUST_PROXY_HOPS=2`. With the default 1, the server sees that proxy's address for every visitor, so every device shares one lockout counter. Never set it higher than the real number of proxies, since each extra hop lets a client forge its address.

### Change password and sessions

`POST /auth/change-password` (session + CSRF, rate-limited to 5 failures per
15 minutes) takes `{ currentPassword, newPassword }`. A wrong current password
is `400 INVALID_CURRENT_PASSWORD`. On success it signs out every *other*
session, spends any outstanding reset link and clears the calendar feed token.
A successful reset now signs out *every* session. The UI is Settings ->
Security.

## Background jobs (issue #579)

`src/index.js` starts an in-process scheduler (`src/jobs/runner.js`) after the
server starts listening: one tick 30 seconds after startup, then hourly.
`createApp()` never starts it, so tests don't run jobs unless they call
`runJob()` directly.

| Variable | Default | Effect |
|---|---|---|
| `JOBS_ENABLED` | `true` | `false` (or `0`/`no`/`off`) starts no jobs. |
| `TZ` | `UTC` | Time zone of the period keys (`YYYY-MM`, `YYYY-MM-DDTHH`). |

- **Claiming.** Each run claims `(job_name, period_key)` in the `job_runs`
  table (migration `1755600000039`) with `INSERT ... ON CONFLICT`. The unique
  key makes a job run once per period across restarts and across several
  server processes.
- **Failures.** A thrown error is logged and stored in `job_runs.error`; the
  server keeps running. The next tick in the same period retries it, up to 5
  attempts. A run still `running` after 60 minutes (a dead process) can be
  taken over. Jobs must therefore be idempotent.
- **Jobs** (`src/jobs/index.js`, the registry where new jobs go):
  - `prune-sessions` (hourly): `DELETE FROM sessions WHERE expires_at < now()`
    (#536), plus `job_runs` rows that finished over 90 days ago and
    notifications older than 90 days (an open balance alert is kept).
  - `notifications` (hourly, #211): see "Notifications" below.
  - `net-worth-snapshot` (monthly): for each user who has no snapshot in the
    current month (regardless of the `autoNwSnapshot` setting, which governs
    only the app's own capture on load), computes the
    snapshot with the browser's own pure code (`src/netWorthCore.js`) over the
    data each route's `listForUser()` returns (the same shape as the browser's
    `loadFromPostgres`), and inserts it through `sanitizeNetWorthSnapshot`
    without overwriting an existing row. No milestones are awarded.

## Automated Backups

`docker-compose.yml` includes a `backup` service that runs `pg_dump` on a
cron schedule inside its own container — no host-level cron job required.
Backup files are written to the `backup-data` Docker named volume, on the same
host as the database: copy them off the host if they must survive losing it.

The container runs `server/scripts/backup-entrypoint.sh`: with no arguments it
installs the schedule and runs `crond` in the foreground; with arguments it runs
them, which is what the commands below rely on. Each scheduled run is logged to
`docker logs myfinances-backup`. A failed run exits non-zero and leaves no file,
so every `.dump` in the volume is a complete backup. (Before 7.18.3 this
container crash-looped and never ran a scheduled backup, #656.)

**Environment variables** (set in your shell or `.env` file):

| Variable | Default | Description |
|---|---|---|
| `BACKUP_SCHEDULE` | `0 2 * * *` | Cron schedule (2 am daily). Standard 5-field cron syntax. |
| `BACKUP_RETENTION_DAYS` | `7` | Days of backups to keep; older `.dump` files are pruned automatically. |

**Check that it is running and see recent runs:**
```bash
docker compose ps backup          # Up (healthy), not Restarting
docker logs --tail 20 myfinances-backup
```

**To trigger an immediate backup:**
```bash
docker compose run --rm backup sh /usr/local/bin/docker-backup.sh
```

**To list existing backups:**
```bash
docker compose exec backup ls -l /backups
```

**To copy a backup off the volume** (for off-host storage, or for the root-level
`restore.sh`/`restore.ps1` scripts):
```bash
docker compose cp backup:/backups/<file>.dump ./
```

**To restore from a backup file** (destructive: it replaces every object in the
database, like `restore.sh`), then restart the server:
```bash
docker compose run --rm backup sh -c 'PGPASSWORD=$(tr -d "\r\n" < /run/secrets/postgres_password) pg_restore -h postgres -U myfinances -d myfinances --clean --if-exists /backups/<file>.dump'
docker compose restart server
```

## Notifications (issue #211)

The hourly `notifications` job (`src/jobs/notifications.js`) runs the pure
rules in `../src/notificationsCore.js` (the browser's own projection code)
for every user, and raises five kinds of alert:

| Type | When |
|---|---|
| `billDueSoon` / `billDueToday` | A debt minimum payment, recurring subscription or legacy bill that isn't Cleared is due within `notifyDaysAhead` days (default 3) or today |
| `lowBalance` | An account's balance today is at or below its `lowBalanceThreshold` (and not overdrawn) |
| `zeroBalance` | An account is overdrawn: its balance today is below $0 (exactly $0 never alerts) |
| `projectedLow` | Fine today, but projected to reach the threshold (below $0 without one) within `notifyDaysAhead` days |

Credit Card, Loan, Retirement and archived accounts are never alerted on, nor is an account with
`muteBalanceAlerts` ("Don't notify", migration `1755600000042`); muting resolves its open balance alerts
and cancels their pending emails on the next check. Bill alerts are not affected.

- **Storage:** rows go in `notifications` (migration `1755600000040`), unique
  on `(user_id, dedupe_key)`, so a repeated or retried check never repeats an
  alert.
- **Balance episodes:** a balance alert has an `episode_key`. It is skipped
  while an earlier one for the same account and type is open, and resolved
  (`resolved_at`) by the first check where the condition no longer holds.
- **Preferences** are ordinary settings, validated by `isAllowedSetting`:
  - `notifyBillDue`, `notifyLowBalance`, `notifyZeroBalance` and
    `notifyProjectedLow` are booleans, all on by default.
  - `notifyDaysAhead` is 0-30.
  - `notifyChannel` is `both` (the default), `email` or `inApp`.
  - `notifyDelivery` is `perEvent` (the default) or `digest`.
- **Email** needs SMTP (below). Alerts are stored as params and the browser
  translates the in-app text; emails are English, with amounts that carry no
  currency symbol. A failed send leaves the row `pending`; it is retried on
  later checks, up to 3 attempts within 48 hours, and never fails the job.
- **API** (session + CSRF):
  - `GET /api/notifications[?limit=N]` returns the newest in-app alerts
    (`limit` 1-500, default 50; anything else is a 400), `unreadCount`,
    `total` (all in-app alerts) and `emailConfigured`.
    Optional filters (#649), each given once, else a 400: `type`
    (`all|bill|lowBalance|overdrawn|projected`, mapped to alert types by
    `typesForCategory` in `../src/notificationsFilter.js`), `status`
    (`unread|read|active|resolved|all`) and `account` (a positive integer or
    `all`). Missing means all. `total` and the list follow all three;
    `unreadCount` counts unread rows matching `type` and `account` and ignores
    `status`. No filter params behaves exactly as before.
  - `POST /api/notifications/read` and `/unread`, body `{ ids }` (1-500
    unique positive integers, else 400), mark those of the signed-in user's
    alerts; unknown or foreign ids are ignored. They return
    `{ ok, updated, unreadCount }`.
  - `POST /api/notifications/:id/read` and `POST /api/notifications/read-all`.
    `read-all` takes the same `type` and `account` params and then marks only
    the unread alerts matching them (`status` is ignored; with no params it
    marks everything, as before).
  - `DELETE /api/notifications` (Clear All Data).
  - `POST /api/notifications/check` runs the check for the signed-in user now
    (Settings → Check now). It is rate-limited and works with
    `JOBS_ENABLED=false`.

## Email notifications (optional)

The server can send email over SMTP: the notification alerts above, a "send
test email" action in the app's Settings modal, and an automatic welcome email
when an account is created. It's off by default. See
`docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md` and
`docs/superpowers/specs/2026-11-15-notifications-design.md` for the designs.

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