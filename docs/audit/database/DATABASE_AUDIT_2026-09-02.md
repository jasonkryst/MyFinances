# MyFinances Server — Database/Backend Configuration Audit

**Date:** 2026-09-02
**Scope:** `server/` (optional self-hosted Node.js + Express + PostgreSQL API), root `docker-compose.yml`, `server/Dockerfile`, `server/docker-entrypoint.sh`, `nginx.conf`.
**Method:** Live test run against a real `postgres:16-alpine` container (`server/docker-compose.test.yml`, port 5433) with migrations applied via `node-pg-migrate`, plus a full static read of every migration, the generic CRUD/keyed-resource routers, connection pooling config, and the production Docker/nginx deployment files.

> **Post-audit update:** the `clearedAt` truncation bug documented below (§ Failing test) was fixed the same day, per this report's own recommendation — a new `sanitizeTimestampISO()` helper was added to `src/utils.js` and wired into both `src/sanitizers.js` and `server/src/routes/ledgerCleared.js` in place of the date-only `sanitizeDateISO()`, including the `ledgerAmountOverrides.updatedAt` sibling instance this report also flagged. Re-running `server/test/` against a fresh migrated test container afterward showed **86/86 passing** (previously 85/86). The findings below are left as-written since they're the audit trail that led to the fix.
>
> **Second post-audit update (v4.41.0, PR #139):** findings H1 (indexes), H2 (backup/restore), and M3 (enum `CHECK` constraints) are now resolved — see their entries under "Findings by severity" below.
>
> **Third post-audit update (2026-09-04, PR #144):** M1 (`trust proxy`) and M2 (`statement_timeout`/pool sizing/SSL) are now also resolved — see their entries below.
>
> **Fourth post-audit update (2026-09-04):** the remaining open items (M4, L1, L2, L3) now have tracked GitHub issues ([#154](https://github.com/jasonkryst/MyFinances/issues/154) for M4/L1, [#155](https://github.com/jasonkryst/MyFinances/issues/155) for L2/L3) — see their entries below.

---

## Executive summary

The backend is well-structured for a single-tenant, self-hosted deployment: every generic route (`crudRouter.js`, `keyedRouter.js`) correctly scopes reads/writes with `WHERE user_id = $1`, foreign keys are ownership-checked before insert/update, CSRF + session auth is enforced ahead of every `/api/*` route, and migrations run automatically and idempotently on every server boot (`server/src/index.js`). 85 of 86 server tests pass live against a real database.

The one live failure is a genuine data-loss bug, not a test or infra problem: the shared `sanitizeDateISO()` helper — reused by both the frontend and the server for the newly-added "ledger cleared" timestamp — silently truncates a full ISO timestamp down to a bare calendar date, discarding the time-of-day the feature was built to capture. This affects the frontend (`localStorage`) path identically to the Postgres path, since the server sanitizer is a re-export of the frontend one.

Beyond that, the schema has **zero indexes beyond primary keys** across all six migrations, several enum-shaped columns lack the `CHECK` constraints the sanitizers imply, the connection pool has no `statement_timeout`/SSL configuration, and there is no documented or automated backup strategy for the Postgres data volume (the only mention is an unchecked checklist box in `DEPLOYMENT.md`). The reverse proxy also doesn't establish a `trust proxy` chain with Express, so the login/register rate limiters key off nginx's container IP rather than the real client IP.

---

## Live test results

Command: `npm test` (Node's built-in test runner, `--test-concurrency=1`) against `postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test`, migrated with `npm run migrate up`.

```
tests 86
pass  85
fail  1
duration_ms 116955.6
```

All auth, session/CSRF middleware, IDOR (cross-user), required-field, and delete-all tests passed, including every `crudRouter`/`keyedRouter`-backed resource (bills, expenses, incomes, bonuses, debts, recurring-templates, emergency-funds, sinking-funds, reconciliations, net-worth-snapshots, settings, ledger-overrides, plan-settings/milestones).

### Failing test: `ledger-cleared: PUT upserts a compound-key entry and GET lists it`

`server/test/keyedResources.test.js:108-120`

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual:   '2026-08-02T00:00:00.000Z'
- expected: '2026-08-02T10:00:00.000Z'
```

**Root cause (confirmed, not a test bug):** the shared `sanitizeDateISO()` function truncates any full ISO timestamp to a bare `YYYY-MM-DD` calendar date before it ever reaches the database.

- `src/utils.js:67-82` — `sanitizeDateISO()` accepts a `YYYY-MM-DD` string directly, and for anything else matches `^(\d{4}-\d{2}-\d{2})T` and **returns only the date part**, explicitly documented as "Heal legacy full ISO timestamps stored by `Date.toISOString()`". This function was designed for genuinely date-only fields (transaction `date`, bill `dueDay`, etc.).
- `server/src/routes/ledgerCleared.js:4-9` — `sanitizeClearedEntry()` feeds the client-supplied `clearedAt` (a real timestamp, e.g. `2026-08-02T10:00:00.000Z`) through `sanitizeDateISO()`, which truncates it to `'2026-08-02'` before insert.
- `server/migrations/1755600000005_create-ledger-cleared-transactions.js:8` — `cleared_at timestamptz NOT NULL DEFAULT now()`. Postgres accepts the bare date string and stores it as local midnight, converted to UTC — hence the observed `T00:00:00.000Z`.
- **The same bug exists on the frontend**, independent of the server: `src/sanitizers.js:114-123` (`sanitizeLedgerClearedTransactions`) runs the identical `sanitizeDateISO()` truncation, and this sanitizer runs on every `load`/`import` via `sanitizeParsedState()` (`src/sanitizers.js:233,243`). `src/ledgerCleared.js:26` sets `clearedAt: new Date().toISOString()` (a precise timestamp) when the user checks "Cleared" — so the precise time set by the frontend is silently downgraded to midnight the very next time the data round-trips through save/load, in **both** storage backends.
- This is functionally a regression introduced by the current branch's own feature: `git log` shows `aa6ead3 feat(ledger): add cleared-transaction tracking with timestamp` — the commit message promises timestamp tracking, but the shared sanitizer it reused discards the time-of-day. `server/test/keyedResources.test.js:108-120` is correctly written and caught a real defect that also affects the browser-only (no-server) deployment mode.

**Recommendation:** add a dedicated `sanitizeTimestampISO()` (or similar) helper in `src/utils.js` that validates/normalizes a full ISO-8601 datetime without truncating to a date, and use it for `clearedAt` in both `src/sanitizers.js` and `server/src/routes/ledgerCleared.js`. Do **not** reuse `sanitizeDateISO()` for timestamp fields going forward — audit other callers (e.g. `ledgerAmountOverrides.updatedAt`, `src/sanitizers.js:107`) for the same class of bug, since `updatedAt` there is also run through `sanitizeDateISO()` and would suffer identical time-of-day loss.

---

## Findings by severity

### High

**H1 — RESOLVED (v4.41.0, PR #139).** `server/migrations/1755600000006_add-user-and-account-indexes.js` adds the recommended indexes. **No indexes anywhere except primary keys; FK columns are unindexed.**
All six migrations (`server/migrations/1755600000000`–`1755600000005`) create tables with `bigserial PRIMARY KEY` / composite `PRIMARY KEY` only — there is not a single `CREATE INDEX` statement in the entire migration history (confirmed via full-text search). Every `account_id` foreign key (`bills.account_id`, `expenses.account_id`, `incomes.account_id`, `bonuses.account_id`, `debts.account_id`, `recurring_templates.account_id`/`target_account_id`, `emergency_funds.account_id`, `sinking_funds.account_id`, `reconciliations.account_id`, `ledger_amount_overrides.account_id`) is unindexed. Two concrete consequences:
- `ON DELETE SET NULL` on every `account_id` FK (e.g. `server/migrations/1755600000001_create-first-crud-tables.js:17`) means deleting an account triggers a full sequential scan of each referencing table to find rows to null out.
- `crudRouter.js:36` (`SELECT ... WHERE user_id = $1 ORDER BY id`) and `keyedRouter.js:30` (`SELECT ... WHERE user_id = $1`) run on every `GET /api/<resource>` call and currently sequential-scan their table; harmless today at self-hosted single-user scale, but the design should not rely on staying small — a household with years of ledger/expense history is exactly the growth case this app targets.
- **Fix:** add `CREATE INDEX ON <table> (user_id)` for every user-scoped table, and `CREATE INDEX ON <table> (account_id)` for every table with an `account_id` FK, in a new migration (never edit an already-applied one).

**H2 — RESOLVED (v4.41.0, PR #139).** `backup.sh`/`backup.ps1` + `restore.sh`/`restore.ps1` now provide this, documented in `DEPLOYMENT.md`'s "Backup and Restore" section. **No backup/restore story for the Postgres data volume.**
`DEPLOYMENT.md:383` lists "Regular backups implemented" as an **unchecked** checklist item with no accompanying instructions, script, or cron job anywhere in the repo (`server/scripts/`, `setup.sh`, `setup.ps1`, `docker-compose.yml` all searched — no `pg_dump`/backup reference found). The `postgres-data` named volume (`docker-compose.yml:41,71-72`) is the sole durability layer once a user migrates off `localStorage` to Postgres; there is currently no documented way to recover from volume loss/corruption. **Fix:** document (and ideally script) a `pg_dump`-based backup — e.g. a scheduled `docker compose exec postgres pg_dump ...` writing to a bind-mounted host directory — and a matching restore procedure, then check the DEPLOYMENT.md box for real.

### Medium

**M1 — RESOLVED 2026-09-04.** `app.set('trust proxy', 1)` added to `createApp()` (`server/src/app.js`). This also enabled a proper fix for the Security audit's `NODE_ENV`/Secure-cookie finding — see that report's addendum. Verified via `server/test/app.test.js`'s `trust proxy is set to trust exactly one hop`. **Express `trust proxy` is never set; rate limiters key off nginx's IP, not the real client.**
`server/src/app.js` never calls `app.set('trust proxy', ...)`. `nginx.conf:43` forwards `X-Forwarded-For: $proxy_add_x_forwarded_for` to `/api/` and `/auth/`, but without `trust proxy` configured, Express's `req.ip` (which `express-rate-limit` keys on by default — see `loginLimiter`/`registerLimiter`/`setupStatusLimiter` in `server/src/routes/auth.js:21-45`) resolves to the immediate socket peer, i.e. the nginx container, identical for every real client. Effect: the 5-attempts/15-min login and register limiters are shared across **all** clients behind the proxy rather than per-client — one failed brute-force burst from any source exhausts the bucket for the legitimate self-hosted user too, and per-IP lockout provides no actual attacker isolation. **Fix:** `app.set('trust proxy', 1)` in `createApp()` (one hop — nginx is the only proxy in front of it) so `req.ip` reflects `X-Forwarded-For`'s real client address.

**M2 — RESOLVED 2026-09-04.** `server/src/db.js`'s `Pool` now sets `statement_timeout: 30000`, `max: 10`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 10000`, and conditional `ssl` (skipped only for the `postgres`/`localhost`/`127.0.0.1` hosts this app's own deployment paths ever produce; required with full certificate validation — no opt-out — for any other host). **No `statement_timeout`, pool-size, or SSL configuration in `db.js`.**
`server/src/db.js:21` constructs `new Pool({ connectionString: process.env.DATABASE_URL })` with no `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `statement_timeout`, or `ssl` option — all left at `pg` library defaults (`max: 10`, no query timeout at all). A runaway/blocked query can hold a pool connection indefinitely, and there is no enforced encryption in transit between `server` and `postgres` even if a future deployment puts them on separate hosts. Consistent with `server/docker-entrypoint.sh:9`'s constructed URL, which also has no `?sslmode=`. Low urgency while both containers share one Docker bridge network, but worth hardening before any non-local Postgres target is supported. **Fix:** set a conservative `statement_timeout` (e.g. via `SET statement_timeout` per-connection or a `-c statement_timeout=30000` in the connection string), and make `ssl` conditional on the connection host not being the local Docker network.

**M3 — RESOLVED (v4.41.0, PR #139).** `server/migrations/1755600000007_add-enum-check-constraints.js` adds the recommended constraints. **Enum-shaped columns lack `CHECK` constraints that sanitizers imply, inconsistently with the one column that does.**
`server/migrations/1755600000001_create-first-crud-tables.js:52` gives `bonuses.purpose` a `CHECK (purpose IN ('cashFlow','savings'))` matching its sanitizer's allow-list, but the same pattern is not applied to other enum-like fields whose sanitizers enforce a fixed value set at the application layer only:
- `recurring_templates.frequency` / `.type` — `src/sanitizers.js:129-130` (`['weekly','biweekly','monthly','quarterly','yearly']`, `['subscription','reimbursement','transfer']`) vs. plain `text NOT NULL DEFAULT` columns (`server/migrations/1755600000002_create-remaining-crud-tables.js:32,34`).
- `sinking_funds.allocation_method` — `src/sanitizers.js:162` (`['fixed','annual','target_date']`) vs. plain `text` (`server/migrations/1755600000002...:60`).
- `incomes.frequency` — `src/sanitizers.js:47` vs. plain `text` (`server/migrations/1755600000001...:41`).
This isn't reachable through the API today (every route funnels through `sanitize()` first — see `crudRouter.js:47,82`), but it means DB-level integrity depends entirely on every current and future write path remembering to sanitize; a bypass (admin script, future bulk-import path, migration bug) can silently persist an invalid value that the frontend's own sanitizer would then quietly coerce away on next load, masking corruption rather than surfacing it. **Fix:** add matching `CHECK` constraints for at least these enum columns in a follow-up migration.

**M4 — Tracked: [#154](https://github.com/jasonkryst/MyFinances/issues/154).** `nginx.conf`'s `/api/` and `/auth/` blocks have no explicit proxy timeouts or body-size limit.
`nginx.conf:39-53` sets no `proxy_read_timeout`/`proxy_connect_timeout`/`proxy_send_timeout` (defaults to nginx's built-in 60s) and no `client_max_body_size` for these two locations (defaults to nginx's built-in 1m), while `express.json({ limit: '1mb' })` (`server/src/app.js:23`) matches that default coincidentally. If a future bulk-import/export payload (Phase 2c's `replaceForPostgres`/`mergeForPostgres`, per root `CLAUDE.md`) ever needs to POST a larger single JSON body than 1 MB, nginx will reject it with 413 before it reaches Express, and the two limits would need to be raised together. Not a bug today, but the coincidental alignment is fragile and undocumented. **Fix:** set `client_max_body_size` in `nginx.conf` explicitly (even if still `1m`) with a comment cross-referencing `express.json()`'s limit, so the two can't silently drift.

### Low

**L1 — Tracked: [#154](https://github.com/jasonkryst/MyFinances/issues/154).** No resource limits (`cpus`/`memory`) on any `docker-compose.yml` service.
`postgres`, `server`, and `myfinances` all lack `deploy.resources.limits`. Low risk for a self-hosted single-user tool, but a runaway query or leak in any one container could still starve the host. Worth a documented recommendation for users deploying alongside other services on the same box.

**L2 — Tracked: [#155](https://github.com/jasonkryst/MyFinances/issues/155).** `sessions` has no index on `expires_at`.
`server/migrations/1755600000000_create-users-and-sessions.js:12-17` — nothing currently prunes expired sessions (no cron/sweep job found), so the table only grows; when one is added, `expires_at` will need an index to avoid a full scan per sweep. Low priority at single-user scale.

**L3 — Tracked: [#155](https://github.com/jasonkryst/MyFinances/issues/155).** Migration `down()` functions are all destructive `DROP TABLE`, with no guard against use on a populated database.
This is expected/idiomatic for `CREATE TABLE`-only migrations (there is nothing "softer" a down-migration for a brand-new table could do), and no migration in the set performs a risky in-place `ALTER` on a populated table — worth confirming this stays true as future migrations start altering existing tables (e.g. adding a `NOT NULL` column to a populated table) rather than only creating new ones.

---

## What's solid (no action needed)

- **`crudRouter.js`/`keyedRouter.js` user-scoping** — every `SELECT`/`UPDATE`/`DELETE` is parameterized with `WHERE user_id = $1` (`crudRouter.js:36,75,94,108,120`; `keyedRouter.js:30,54-56,68,82`), and `findUnownedForeignKey()` (both routers) independently verifies any client-supplied `accountId` belongs to the authenticated user before insert/update — confirmed live by the passing IDOR tests across all nine CRUD resources plus `ledger-overrides`.
- **Migrations run automatically and idempotently on every boot** — `server/src/index.js:6-15` calls `node-pg-migrate` with `direction: 'up'` before `app.listen()`, tracked in `pgmigrations`, and fails fast (`process.exit(1)`) rather than serving against a stale schema. `server/docker-entrypoint.sh` itself only resolves the Docker secret into `DATABASE_URL`; the actual migrate-on-start logic lives in `index.js`, not the shell entrypoint — worth knowing if that script is ever changed, since it's easy to assume otherwise from the entrypoint alone.
- **Secrets handling** — Postgres password is a Docker secret (`docker-compose.yml:39,74-76`), read once by `docker-entrypoint.sh:8` and never placed in an env var visible to `docker inspect`.
- **`ON DELETE CASCADE` vs `SET NULL` choice** — `users`→everything cascades (correct: deleting the one account should erase all their data), while `accounts`→dependents use `SET NULL` (correct: deleting one account shouldn't destroy the debt/bill/income history that referenced it).
- **CSRF + session middleware ordering** — `server/src/app.js:34` applies `requireSession, requireCsrf` to the whole `/api` router before any resource route is mounted, so no route can accidentally skip auth.

---

## Prioritized recommendations

1. **Fix the `clearedAt` truncation bug** (both `src/sanitizers.js` and `server/src/routes/ledgerCleared.js`) before merging `feature/ledger-cleared-transactions` — this is a real, currently-shipping data-loss defect in the feature the branch is named for, not a server-only issue.
2. **Add indexes** on every `user_id` and `account_id` column via a new migration (H1).
3. **Document and script a Postgres backup/restore procedure** (H2) — currently the single biggest durability gap for anyone who opts into the Postgres backend.
4. **Set `app.set('trust proxy', 1)`** in `server/src/app.js` (M1) so rate limiting is per-real-client, not per-nginx-hop.
5. Add `statement_timeout` and consider SSL for the pool (M2); add the missing `CHECK` constraints (M3); pin down `client_max_body_size` explicitly in `nginx.conf` (M4).
