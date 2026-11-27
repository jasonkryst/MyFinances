# Database Audit: v8.8.6 (2026-11-27)

**Baseline:** [DATABASE_AUDIT_2026-09-02.md](DATABASE_AUDIT_2026-09-02.md) and the DB items in [PERFORMANCE_SUSTAINABILITY_AUDIT_2026-11-04.md](../performance/PERFORMANCE_SUSTAINABILITY_AUDIT_2026-11-04.md). **Method:** static review of 51 migrations, `server/src/db.js`, the generic routers, the job registry and compose. No query plans, no `EXPLAIN`, no live database.

## Summary
Schema, indexing and write paths are in good shape. One new Low finding (unpruned housekeeping tables). Backups remain on the same host by default (#582).

## Schema and migrations
- **51 migrations**, all `1755600000NNN_*`. `check-migration-order.sh` runs in CI and the server refuses an out-of-order migration (a past incident crash-looped production; see the migration numbering note).
- **Tables:** accounts, api_tokens, audit_log, balance_history, bills, bonuses, debts, emergency_funds, expenses, incomes, job_runs, known_devices, ledger_amount_overrides, ledger_cleared_transactions, manual_transactions, net_worth_milestones_awarded, net_worth_snapshots, notifications, password_reset_tokens, persons, plan_history, plan_settings, reconciliations, recurring_templates, retirement_snapshots, sessions, settings, sinking_funds, transfers, users.
- **Row versions** (`row_version integer NOT NULL DEFAULT 1`) give optimistic concurrency on every CRUD resource.
- **Time zone:** migration 031 is exact only if the database zone never changed; documented in DEPLOYMENT.md ("Database time zone", #472) and covered by `migration031Timezone.test.js`.

## Indexes (resolved or confirmed)
- `user_id` indexed on every user-owned table; every `account_id` foreign key indexed (migration 006); `incomes.person_id` indexed (migration 038, was PERF-18); sessions have `expires_at` and `user_id` indexes; notifications and audit log have composite `(user_id, ...)` indexes plus a partial index for open episodes.
- No missing foreign-key index found in the migrations reviewed.

## Connection and query safety
- Pool `max: 10`, `statement_timeout: 30000`, `connectionTimeoutMillis: 10000`, `idleTimeoutMillis: 30000` (`db.js`). TLS is mandatory for any host other than `postgres`/`localhost`/`127.0.0.1`, with no weakening switch.
- All values are bound parameters; dynamic identifiers come from code constants (see the security audit).
- Audit rows are written by the same SQL statement as the change (CTE), so they commit or roll back together.
- Import runs in one transaction through the shared `insertRecord`/`upsertEntry` functions.

## Housekeeping
The hourly job (`jobs/pruneSessions.js`) deletes expired sessions (was PERF-19, **resolved**), `job_runs` older than 90 days, notifications older than 90 days (open balance alerts kept), and audit rows older than 90 days.

## Findings

### DB-01 (Low): `password_reset_tokens` and `known_devices` are never pruned
- `password_reset_tokens`: rows are inserted on each forgot-password request (`routes/auth.js:217`) and marked `used_at` on use or password change (`:267`, `:324`), but never deleted. Expired and used tokens accumulate. They hold only token hashes, so this is growth and hygiene, not exposure. The forgot-password limiter bounds the rate, so growth is slow.
- `known_devices`: one row per distinct browser/OS pair per user (`auth/newSignIn.js`), never removed, including when the matching session is revoked.
**Fix:** extend `pruneSessionsJob` with `DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'` and a retention for `known_devices` (for example rows not seen in 180 days, which needs a `last_seen_at` column if absent, or delete on "sign out everywhere"). Add jobs tests following the existing prune tests.

### DB-02 (Info, carried): backups share the host
The `backup` service writes nightly `pg_dump` to a named volume on the same Docker host, 7-day retention by default. Off-host copy and a restore drill are tracked as #582 (open, p3). Until then a host or disk loss loses data and backups together. DEPLOYMENT.md documents the scheduled-backup scripts and `restore.sh`/`restore.ps1` exist.

### DB-03 (Info): Postgres 16
`postgres:16-alpine` (not digest-pinned; Dependabot tracks the tag). Supported through November 2028. Plan the major-version upgrade procedure into DEPLOYMENT.md before then.

## Recommendation
Fix DB-01 together with OTH-01 (graceful shutdown) as one small maintenance PR; consider #582 for operators with off-site storage.
