# MyFinances Server

Self-hosted Node.js + PostgreSQL API for MyFinances. Since 7.0.0 it is
**required**: it is the app's only storage, and the browser keeps no financial
data. See the root `CLAUDE.md` ("Storage (PostgreSQL)") for how the frontend
boots against it.

## First-time setup

Use `setup.sh` (Linux/macOS) or `setup.ps1` (Windows) from the repo root.
This generates a secure Postgres password into `.env` (`POSTGRES_PASSWORD`), starts the
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

Since 8.0.0 the database password is the `POSTGRES_PASSWORD` environment
variable (the Docker secret file is no longer read). `server/docker-entrypoint.sh`
builds `DATABASE_URL` from it at startup, percent-encoded so any character is
safe; an explicitly set `DATABASE_URL` wins (local dev, test containers). Without
either, the server exits with an error naming `POSTGRES_PASSWORD`.

The `postgres-data` volume is the only durability layer for this backend —
use the root-level `backup.sh`/`backup.ps1` and `restore.sh`/`restore.ps1`
scripts to back it up; see "Backup and Restore" in the root `DEPLOYMENT.md`.

## Environment variables

Set these in `.env` (the root `docker-compose.yml` passes them through) or in your deployment tool. `.env.example` lists them too.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `4000` | Port the API listens on. |
| `SESSION_TTL_DAYS` | `7` | How long a sign-in session stays valid. |
| `ALLOW_SETUP` | unset | `true` enables `POST /auth/register`; set it only while creating the first account. |
| `TRUST_PROXY_HOPS` | `1` | Reverse proxies in front of the server; `2` behind one more proxy (see "Locked out" below). |
| `JOBS_ENABLED` | `true` | `false` starts no background jobs (see "Background jobs"). |
| `TZ` | `UTC` | Time zone for job periods and backup file names. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`, `SMTP_SECURE` | host unset, port `587`, secure `false` | Email (see "Email notifications"); an unset host disables it. |
| `SECURITY_CHECK_BREACHED_PASSWORDS`, `SECURITY_BREACH_CHECK_URL`, `SECURITY_BREACH_CHECK_TIMEOUT_MS` | off | Breached-password check (see "Password security"). |

`REFRESH_ON_FOCUS_SECONDS` (default 60) is read by the nginx container, not the server: `docker-entrypoint.d/40-ga-env-config.sh` writes it into `env-config.js`, and a returning tab refreshes after that many seconds away.

## API routes

Every `/api` route needs a browser session and, for mutating requests, the CSRF header. `GET`/`HEAD` also accept a read-only API token (see "Change password and sessions"). The routes are mounted in `src/app.js`.

| Path | What it holds |
|---|---|
| `/auth/*` | Setup status, register, login, logout, forgot/reset/change password and the password policy (`src/routes/auth.js`). |
| `/api/accounts`, `/api/bills`, `/api/expenses`, `/api/incomes`, `/api/bonuses`, `/api/debts`, `/api/recurring-templates`, `/api/emergency-funds`, `/api/sinking-funds`, `/api/persons` | CRUD resources. |
| `/api/reconciliations`, `/api/plan-history`, `/api/retirement-snapshots`, `/api/transfers`, `/api/manual-transactions`, `/api/balance-history`, `/api/net-worth-snapshots` | More CRUD resources. |
| `/api/settings`, `/api/ledger-overrides`, `/api/ledger-cleared` | Keyed resources, written with `PUT` and removed with `DELETE` by key. |
| `/api/plan-settings` | The single settings row (`GET`, `PATCH`) and its milestones (`POST`, `DELETE /milestones`). |
| `/api/notifications` | In-app alerts (see "Notifications"). |
| `/api/audit-log` | Change history: `GET`, `DELETE` (see "Change log"). |
| `/api/sessions` | Active sessions: `GET`, `DELETE /:id`, `DELETE ?others=1`. Cookie session only. |
| `/api/api-tokens` | Read-only API tokens: `GET`, `POST`, `DELETE /:id`. Cookie session only. |
| `/api/calendar` | Calendar feed token: `GET /token`, `POST /token`. Cookie session only. |
| `/calendar.ics` | The token-authenticated public calendar feed (rate-limited, no session). |
| `/health/session-check` | Session and CSRF probe used by tests. |

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

**Active sessions (#683).** `GET /api/sessions` lists the signed-in user's
unexpired sessions: `{ id, createdAt, lastSeenAt, browser, os, ip, current }`,
current first. `id` is an opaque `public_id`, never the token or its hash, and
`ip` is the network only (IPv4 /24, IPv6 /48); the full address is never
stored. `DELETE /api/sessions/:id` signs one out (404 if it isn't yours), and
`DELETE /api/sessions?others=1` signs out all but the caller and returns
`{ revoked }`. `last_seen_at` is refreshed at most every 5 minutes.

A sign-in from a browser/OS pair the account hasn't used before emails the user
(`newSignInEmail`) unless the `notifyNewSignIn` setting is false or
`notifyChannel` is `inApp`. The first device is remembered silently in
`known_devices`, and the email never delays or fails the sign-in.

**Read-only API tokens (#581).** `POST /api/api-tokens` `{ name }` (browser
session + CSRF) returns `{ id, name, prefix, scope, createdAt, lastUsedAt,
token }`. The `token` appears only in this response; the server stores its
SHA-256. `GET /api/api-tokens` lists them, and `DELETE /api/api-tokens/:id`
revokes one. The limit is 25 per user. Use a token as `Authorization: Bearer
mft_...` on `GET`/`HEAD` under `/api`. Other methods are `403
TOKEN_READ_ONLY`; `/api/sessions`, `/api/api-tokens` and `/api/calendar` are
`403 TOKEN_FORBIDDEN`; and `/auth` and `/health` never accept a token. Changing
or resetting the password revokes all tokens. Example:

    curl -H "Authorization: Bearer mft_..." https://finances.example.com/api/accounts

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
    notifications older than 90 days (an open balance alert is kept), and
    change-log rows older than 90 days (#580, `AUDIT_LOG_RETENTION_DAYS`).
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
| `BACKUP_SCHEDULE` | `0 2 * * *` | Cron schedule (2 am daily). Standard 5-field cron syntax, in `TZ`. |
| `TZ` | `UTC` | Time zone the schedule and dump file names use (e.g. `America/Chicago`); the same variable sets the server jobs' time zone. |
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
docker compose run --rm backup sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h postgres -U myfinances -d myfinances --clean --if-exists /backups/<file>.dump'
docker compose restart server
```

## Encryption at rest

MyFinances does not encrypt columns itself, and it isn't planned (#583). The
server computes balances, projections, notifications and net-worth snapshots
from the stored numbers, so encrypting them inside the database would mean
either moving every calculation back to the browser or keeping the key next
to the data, which protects nothing. Encrypt the storage instead:

- **The database volume.** Put Docker's data directory, or at least the
  `postgres-data` and `backup-data` volumes, on an encrypted disk: LUKS/dm-crypt
  on Linux, BitLocker on Windows, FileVault on macOS, or your cloud provider's
  encrypted block storage (for example AWS EBS or GCP persistent disk
  encryption). This covers a stolen disk or a discarded drive; it does not
  protect against someone with access to the running host.
- **Backups that leave the host.** A `.dump` file is a plain copy of every
  record. Encrypt it before it leaves the machine, for example
  `gpg --symmetric --cipher-algo AES256 <file>.dump`, or with a backup tool that
  encrypts client-side (restic, borg, rclone `crypt`). Keep the passphrase
  somewhere other than the backup.
- **In transit** is already covered: put the app behind HTTPS (see
  `DEPLOYMENT.md`), and the Postgres port is not published by the Compose file.

Swap files and Docker's log files can also hold fragments of data; encrypting
the whole disk covers those too.

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

## Change log (issue #580)

Every create, update and delete made through the generic routers
(`src/crudRouter.js`, `src/keyedRouter.js`) and the plan-settings PATCH
writes one row to `audit_log` (migration `1755600000043`): `user_id`,
`table_name`, `row_id` (the id, or the key for keyed tables, `plan` for plan
settings), `op` (`create`/`update`/`delete`), `before`/`after` (jsonb in the
API's field names, without `rowVersion`) and `at`.

- **Same statement.** `src/audit.js` builds an `_audit` data-modifying CTE
  that the router appends to its INSERT/UPDATE/DELETE, so the change and its
  audit row commit or fail together and no route can forget it.
- **Not logged:** an update whose before and after are equal, rejected
  writes (400/404/409), foreign-key cascades and `SET NULL` rewrites,
  background jobs, and plan-settings PATCHes that only change
  `ledgerSettings`/`forecastSettings` (view state).
- **Routes:** `GET /api/audit-log?limit&before&table` (newest first, `limit`
  1-200, default 50, `before` an entry id for paging, `table` one of
  `AUDITED_TABLES`) returns `{ entries, hasMore }`; `DELETE /api/audit-log`
  empties the user's log (Clear All Data runs it last; a replace import does not).
- **Retention:** `prune-sessions` deletes rows older than 90 days.
- **New CRUD table:** add it to `AUDITED_TABLES` (`src/routes/auditLog.js`),
  `AUDIT_TABLE_ORDER` (`../src/changeHistoryCore.js`) and a
  `history.table.<table>` label in every locale; `test/auditLog.test.js`
  checks the lists against `RESOURCE_TABLES`.

## Email notifications (optional)

The server can send email over SMTP: the notification alerts above, a "send
test email" action in the app's Settings modal, and an automatic welcome email
when an account is created. It's off by default. See
`docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md` and
`docs/superpowers/specs/2026-11-15-notifications-design.md` for the designs.

### Configuring SMTP

Run `setup.sh`/`setup.ps1` and answer "y" when asked to configure SMTP, or
configure manually:

- Set `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM` and `SMTP_SECURE` (`true`/`false`) as
  environment variables on the `server` service. A root `.env` file works
  with the provided `docker-compose.yml`; single-quote the password there
  (`SMTP_PASSWORD='...'`) and keep the file private.
- Since 8.0.0 `secrets/smtp_password.txt` is not read. If `SMTP_HOST` and
  `SMTP_USER` are set but `SMTP_PASSWORD` is empty, `docker-entrypoint.sh`
  logs a warning at startup.

Leaving `SMTP_HOST` unset disables the feature entirely: nothing fails
to start, and the test-email endpoint just returns
`503 EMAIL_NOT_CONFIGURED`.

### Verifying it works

Log in, open Settings, and click "Send test email" — it emails the
logged-in account's own address (never an arbitrary address the client
supplies, so the endpoint can't be used as an open relay).