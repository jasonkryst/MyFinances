# PostgreSQL Storage Layer — Phase 1: Backend Service (Issue #53)

**Date:** 2026-08-19
**Issue:** [#53 STORAGE - SQL Storage Layer Implementation](https://github.com/jasonkryst/MyFinances/issues/53) (milestone V5.0.0)

## Summary

MyFinances is currently privacy-first and client-side-only: all data lives in
`localStorage`/`sessionStorage`, there is no backend, and `index.html` can be
opened directly with zero setup. Issue #53 asks for PostgreSQL as a storage
option, driven by three needs the browser-only model can't meet: multi-device
sync, durability/backup, and room to grow into better transactional
integrity than a single JSON blob offers.

Browsers cannot speak Postgres's wire protocol directly, so this requires a
server component. This document specs **Phase 1 only**: a standalone,
self-hosted Node.js API + Postgres database with real relational tables and
granular REST endpoints, buildable and testable entirely on its own —
**no changes to the existing browser app**. A follow-up Phase 2 (not
specced here) will promote `src/storageAdapters.js` to async, add a
`PostgresAdapter`, and wire a login UI + one-time data-migration flow, at
which point local-only mode remains a permanent, equally-supported option
(never a required backend) so the zero-setup experience for users who don't
want sync is unaffected.

## Decisions

| Question | Decision |
|---|---|
| Where does Postgres run? | Self-hosted only for v1 (added to the project's existing `docker-compose.yml`). Schema/API design stays cloud-agnostic (plain `DATABASE_URL`) so a managed Postgres (Supabase/Neon/RDS) is a config change later, not a rewrite — but that's explicitly not being built now. |
| Does local-only mode still work? | Yes, permanently. Postgres becomes a third backend choice (alongside Local/Session Storage) in Phase 2's Settings UI, following the same pattern the July 2026 storage-abstraction work established. |
| Offline / multi-device conflict handling | Online-required, last-write-wins. No offline queueing, no merge/CRDT logic — matches the app's existing single-writer mental model and keeps Phase 1/2 scope bounded. |
| Multi-tenancy | Single user for v1, but a real `users` table exists from day one so cloud/multi-user later is a config change, not a schema rewrite. |
| Data shape | Relational tables — one per record type, matching the shapes `sanitizers.js` already defines, not a relocated JSON blob. |
| API granularity | Granular per-resource REST (`GET/POST/PATCH/DELETE`), not bulk whole-state `GET/PUT /api/state`. Chosen deliberately over the lower-effort bulk option; Phase 2 will need to convert each feature module's add/edit/delete call sites to network calls instead of local-array mutation — that conversion is out of scope here but is the acknowledged cost of this choice. |
| Auth | No open self-registration endpoint. A one-time bootstrap script creates the single user. Argon2id password hashing + server-side sessions (opaque ID, Postgres-backed, httpOnly/Secure/SameSite=Strict cookie) — not JWT, so logout/revocation is instant. |
| ID generation | Server-generated `bigserial`, not client-generated `Date.now()`-based integers. The online-required model means the client always waits for the create response and uses the server-assigned ID, so there's no collision-reconciliation logic to write. |
| Validation | Every write runs the existing `sanitize*` function from `src/sanitizers.js` server-side (plain ESM, no DOM dependency, directly importable under Node) before touching Postgres — one source of truth for "what's a valid debt," not duplicated rules in SQL and JS. |
| Migrations | `node-pg-migrate` — plain SQL/JS migration files, no extra binary/toolchain beyond npm, fits the "minimal dependencies" ethos better than Flyway/Sqitch. |

## Architecture

### New directory: `server/`

A self-contained Node.js service, deliberately **not** part of the existing
root `package.json` (that's the dev-only Jest/Stryker toolchain per
CLAUDE.md) or the no-build-step frontend — this is ordinary server-side
Node with its own dependency tree.

```
server/
  package.json
  Dockerfile
  src/
    index.js            # Express app entry point, route mounting, error handler
    db.js                # pg Pool, exported query() using parameterized queries only
    auth/
      middleware.js       # requireSession() — validates cookie, attaches req.userId
      sessions.js          # createSession, destroySession, session-table queries
      argon2.js             # hash/verify wrappers
    routes/
      auth.js              # POST /auth/login, POST /auth/logout
      accounts.js, debts.js, incomes.js, bonuses.js, bills.js, expenses.js,
      recurringTemplates.js, emergencyFunds.js, sinkingFunds.js,
      netWorthSnapshots.js, reconciliations.js, settings.js,
      ledgerOverrides.js, planSettings.js
    sanitizers/           # thin re-export of ../../src/sanitizers.js + utils.js
  migrations/
    *.sql                 # node-pg-migrate files, one per schema change
  scripts/
    create-user.js        # interactive bootstrap: prompts email/password, argon2-hashes, inserts
  test/
    *.test.js              # integration tests against a real Postgres test container
```

`server/src/sanitizers/` re-exports the existing `src/sanitizers.js` and
`src/utils.js` directly (both are dependency-free ESM) rather than
duplicating validation logic — a relative import across the `server/`
boundary, no npm package needed.

### Schema

Every table has `user_id bigint references users(id) on delete cascade` even
though exactly one user row exists in the v1 deployment. Money columns are
`numeric`, never `float`/`double precision`, to avoid rounding drift on
balances. Dates that are calendar dates (no time-of-day meaning, e.g. a
due-date) use `date`; timestamps that recorded "when was this written" use
`timestamptz`.

```sql
CREATE TABLE users (
    id bigserial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id text PRIMARY KEY,              -- opaque random token (32 bytes, base64url)
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL DEFAULT 'Other',
    starting_balance numeric NOT NULL DEFAULT 0,
    interest_rate numeric NOT NULL DEFAULT 0
);

CREATE TABLE debts (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    name text NOT NULL,
    category text,
    debt_type text NOT NULL DEFAULT 'creditCard',
    priority integer,
    account_balance numeric NOT NULL DEFAULT 0,
    original_balance numeric NOT NULL DEFAULT 0,
    interest_rate numeric NOT NULL DEFAULT 0,
    minimum_payment numeric NOT NULL DEFAULT 0,
    original_minimum_payment numeric NOT NULL DEFAULT 0,
    due_date integer,
    debt_start_date date,
    fixed_amount numeric,
    fixed_start_date date,
    fixed_end_date date,
    updated_at timestamptz
);

CREATE TABLE incomes (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    name text NOT NULL,
    amount numeric NOT NULL DEFAULT 0,
    first_pay_date date,
    frequency text NOT NULL DEFAULT 'biweekly'
);

CREATE TABLE bonuses (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    name text NOT NULL,
    amount numeric NOT NULL DEFAULT 0,
    date date,
    category text NOT NULL DEFAULT 'Other',
    purpose text CHECK (purpose IN ('cashFlow', 'savings'))
);

CREATE TABLE bills (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    name text NOT NULL,
    amount numeric NOT NULL DEFAULT 0,
    due_day integer,
    category text NOT NULL DEFAULT 'Other'
);

CREATE TABLE expenses (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    name text NOT NULL,
    budget_amount numeric NOT NULL DEFAULT 0,
    date date,
    category text NOT NULL DEFAULT 'Other'
);

CREATE TABLE recurring_templates (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    target_account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    name text NOT NULL,
    type text NOT NULL DEFAULT 'subscription',
    amount numeric NOT NULL DEFAULT 0,
    frequency text NOT NULL DEFAULT 'monthly',
    day_of_month integer,
    category text NOT NULL DEFAULT 'Other',
    start_date date,
    end_date date,
    paused boolean NOT NULL DEFAULT false,
    skipped_months text[] NOT NULL DEFAULT '{}',
    paid_months text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE emergency_funds (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    target_amount numeric NOT NULL DEFAULT 0,
    current_amount numeric NOT NULL DEFAULT 0,
    monthly_contribution numeric NOT NULL DEFAULT 0,
    auto_contribute boolean NOT NULL DEFAULT false,
    notes text
);

CREATE TABLE sinking_funds (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    name text NOT NULL,
    allocation_method text NOT NULL DEFAULT 'fixed',
    monthly_allocation numeric NOT NULL DEFAULT 0,
    target_amount numeric NOT NULL DEFAULT 0,
    current_amount numeric NOT NULL DEFAULT 0,
    auto_contribute boolean NOT NULL DEFAULT false,
    notes text
);

CREATE TABLE net_worth_snapshots (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date date NOT NULL,
    total_assets numeric NOT NULL DEFAULT 0,
    total_liabilities numeric NOT NULL DEFAULT 0,
    net_worth numeric NOT NULL DEFAULT 0,
    debt_payment_made numeric NOT NULL DEFAULT 0,
    income_received numeric NOT NULL DEFAULT 0,
    source text NOT NULL DEFAULT 'auto',
    PRIMARY KEY (user_id, date)
);

CREATE TABLE reconciliations (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    date date NOT NULL,
    previous_balance numeric NOT NULL DEFAULT 0,
    statement_balance numeric NOT NULL,
    difference numeric NOT NULL DEFAULT 0,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key text NOT NULL,
    value jsonb NOT NULL,
    PRIMARY KEY (user_id, key)
);

CREATE TABLE ledger_amount_overrides (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    override_key text NOT NULL,   -- "type|id|accountId|date"
    amount numeric NOT NULL,
    original_amount numeric,
    transaction_name text,
    account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    date date,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, override_key)
);

CREATE TABLE plan_settings (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    strategy text,
    monthly_payment numeric,
    per_month_stimulus numeric[] NOT NULL DEFAULT '{}',
    ledger_settings jsonb NOT NULL DEFAULT '{"accountFilter":"all","dateRange":"all","sortKey":"date","sortDir":"desc"}',
    forecast_settings jsonb NOT NULL DEFAULT '{"rangeMonths":1,"accountId":"total","notableThresholdPct":130}'
);

CREATE TABLE net_worth_milestones_awarded (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    milestone integer NOT NULL,
    PRIMARY KEY (user_id, milestone)
);
```

### API surface

All routes are mounted under `/api/`, all require a valid session (except
`/auth/login`), and every query is scoped by `WHERE user_id = req.userId`
from session middleware — never a client-supplied user ID.

| Resource | Endpoints | Notes |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout` | Login sets the session cookie; rate-limited 5 attempts/15min/IP. |
| accounts, debts, incomes, bonuses, bills, expenses, recurringTemplates, emergencyFunds, sinkingFunds, reconciliations | `GET /api/<resource>`, `POST /api/<resource>`, `PATCH /api/<resource>/:id`, `DELETE /api/<resource>/:id` | Standard CRUD. `POST`/`PATCH` bodies pass through the resource's `sanitize*` function before insert/update. |
| Net worth history | `GET /api/net-worth-snapshots`, `PUT /api/net-worth-snapshots/:date`, `DELETE /api/net-worth-snapshots/:date` | Keyed by date, not `id` — upsert semantics on `PUT`. |
| Settings | `GET /api/settings`, `PUT /api/settings/:key`, `DELETE /api/settings/:key` | Small key/value list. |
| Ledger overrides | `GET /api/ledger-overrides`, `PUT /api/ledger-overrides/:key`, `DELETE /api/ledger-overrides/:key` | `:key` is the existing `type\|id\|accountId\|date` compound string, URL-encoded. |
| Plan settings | `GET /api/plan-settings`, `PATCH /api/plan-settings`, `POST /api/plan-settings/milestones` | Singleton per user; milestones endpoint appends one `{ milestone }`, insert-only (ignores duplicates via `ON CONFLICT DO NOTHING`). |

**Error shape:** `{ "error": { "code": "VALIDATION_FAILED", "message": "..." } }`
consistently across all routes.

| HTTP status | Meaning |
|---|---|
| 400 | Sanitizer rejected the payload (e.g. missing required `name`) |
| 401 | No/expired session cookie |
| 404 | Resource ID not found for this user |
| 500 | Unexpected server error — logged server-side, generic message returned, never a raw stack trace or SQL error text to the client |

### Auth flow detail

- `server/scripts/create-user.js`: run via `docker compose exec server node scripts/create-user.js`. Prompts for email + password (Node `readline`, password input not echoed), enforces a minimum length (12 chars), hashes with `argon2.hash(password, { type: argon2.argon2id })`, inserts into `users`. Refuses to run if a user already exists (single-user v1).
- `POST /auth/login`: looks up by email, `argon2.verify`, on success creates a `sessions` row (`id` = `crypto.randomBytes(32).toString('base64url')`, `expires_at` = now + 7 days), sets cookie (`httpOnly`, `Secure`, `SameSite=Strict`, `Path=/`). On failure, generic "invalid credentials" for both unknown-email and wrong-password cases (no user enumeration).
- `express-rate-limit` on `/auth/login`: 5 requests/15min per IP, `429` beyond that.
- `requireSession()` middleware: reads the cookie, looks up the session row, checks `expires_at > now()`, attaches `req.userId`; expired sessions are deleted lazily on lookup. Missing/invalid/expired → `401`.
- `POST /auth/logout`: deletes the session row, clears the cookie.
- CSRF: double-submit cookie token issued alongside the session cookie on login (a second, non-httpOnly cookie whose value the frontend must echo back in an `X-CSRF-Token` header on every mutating request); middleware rejects mismatches with `403`.
- Transport: `server` container is only reachable on the docker-internal network; `nginx.conf` gains a `location /api/ { proxy_pass http://server:4000/; }` block (plus `proxy_set_header` for `Host`/`X-Forwarded-*`) so the API is same-origin from the browser's perspective and never directly published to the host. TLS termination happens at nginx (out of scope here to add a cert — assumes the existing deployment already fronts nginx with TLS, or documents that self-hosting without TLS in front means the `Secure` cookie flag will silently prevent login from working over plain HTTP, which is intentional, not a bug).

### Deployment

`docker-compose.yml` gains two services:

```yaml
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: myfinances
      POSTGRES_USER: myfinances
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    secrets:
      - postgres_password

  server:
    build:
      context: ./server
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://myfinances:${POSTGRES_PASSWORD}@postgres:5432/myfinances
      SESSION_TTL_DAYS: "7"
    depends_on:
      - postgres

volumes:
  postgres-data:

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
```

(Illustrative — final compose file also needs the existing `myfinances`
service's healthcheck/hardening options applied to `server`, and
`.env`/`secrets/` gitignored.) Migrations run via
`docker compose exec server npx node-pg-migrate up` as a manual deploy step
documented in the repo (not auto-run on container start, to avoid a broken
migration silently taking down the API on every restart).

## Testing

New `server/test/` suite (Node's built-in test runner, `node --test`, to
avoid pulling Jest into a service that has nothing to do with the mutation-
testing toolchain), run against a real Postgres instance (a
`docker-compose.test.yml` override, or `testcontainers-node` if the
dependency is acceptable):

- Login: correct credentials succeed, wrong password / unknown email both
  return the same generic error, rate limiting kicks in after 5 attempts.
- Session: valid cookie required on every `/api/*` route; expired session
  rejected and deleted; logout invalidates immediately.
- Per resource (accounts, debts, ...): create/list/update/delete round-trip;
  sanitizer rejection on invalid payloads (matching existing sanitizer test
  expectations in `tests/unit/`); a second user (test-only second row in
  `users`) cannot see or modify the first user's rows even with a guessed ID.
- Cascade behavior: deleting an account nulls `account_id` on dependent
  debts/bills/etc. rather than failing or orphaning rows.
- Migration apply runs cleanly against an empty database.

This is a separate suite from the existing Playwright tests under `tests/`,
which stay scoped to the browser app and are Phase 2's responsibility to
extend once the frontend actually talks to this API.

## Out of scope (this document)

- Any change to `src/storageAdapters.js`, `src/storage.js`, or any feature
  module — Phase 1 ships a backend with zero frontend integration.
- Login UI, Settings backend-picker UI, or the one-time
  localStorage-to-server data migration flow.
- Bulk export/import reconciliation between `dataExport.js`'s v3.0 JSON
  format and this API.
- Managed/cloud Postgres hosting, multi-user accounts, granular
  per-field permissions.
- Offline support / conflict resolution beyond last-write-wins.
- Automatic migration execution on deploy (kept manual deliberately).

## Documentation updates

- `CLAUDE.md`: new "Backend service (optional, Phase 1)" section under
  Architecture, describing `server/` as a self-hosted, opt-in addition —
  explicit that the frontend's "no backend" architecture is unchanged;
  Postgres is an *additional* deployment option, not a replacement.
- `CHANGELOG.md` + `APP_VERSION` bump per repo convention, once Phase 1 lands.
- `ROADMAP.md`: mark the "formal storage-schema migration framework" BED
  item as delivered by this work (in the sense that Postgres now has one;
  the localStorage JSON blob's sanitizer-based migration is unaffected and
  continues to serve local-only users).
