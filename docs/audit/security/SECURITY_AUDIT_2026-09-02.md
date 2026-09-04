# Security Audit — MyFinances

**Date**: September 2, 2026
**Version**: v4.40.0 (branch `feature/ledger-cleared-transactions`, post-commit `aa6ead3`)
**Auditor**: Automated + manual static review (Claude Code)
**Status**: ✅ **LOW RISK** — one **Medium** deployment/doc-drift finding, two **Low** findings, no Critical/High issues
**Scope**: Full source review (`src/*.js`, `index.html`, `nginx.conf`), the entire optional self-hosted backend added since the last audit (`server/` — Phases 1, 2a, 2b, 2c: auth, CSRF, CRUD/keyed routers, IDOR protections, rate limiting), CI security tooling (CodeQL, Trivy, Dependency Review, Dependabot), secrets handling (Docker Compose secrets, `.env.example`, Dockerfiles), and live execution of `pytest tests/security/` (62 tests) and the server's own Jest/Postgres test suite.

This supersedes `SECURITY_AUDIT_2026-06-19.md`, which predates the entire `server/` backend (Phases 1–2c), Dependabot/CodeQL/Trivy CI, i18n, the storage-abstraction/backend-picker work, and this session's newest commit `aa6ead3` ("feat(ledger): add cleared-transaction tracking with timestamp"). Nothing here was auto-fixed — this is audit-only, for review and prioritization.

---

## Executive Summary

MyFinances remains a client-side-only app at its core (no build step, no framework, all data in `localStorage`/`sessionStorage` by default) with a mature, well-defended XSS/injection threat model: the CSP is byte-for-byte in sync between `index.html` and `nginx.conf`, `escapeHtml()` discipline is consistent across every `innerHTML`/`insertAdjacentHTML` site sampled (~90 sites across all modules, including every module added since the June audit — `ledgerCleared.js`, `i18n.js`, `postgresSync.js`, `postgresImport.js`, `loginGate.js`, `commandPalette.js`, `dataTransferModal.js`), and the sanitizer pipeline has full coverage of every persisted/imported field, including the newest `ledgerClearedTransactions` map.

Since June 19, the project has added a substantial **optional self-hosted Node/Express/PostgreSQL backend** (`server/`) enabling multi-device sync. This backend is well-built: argon2id with library-default parameters that exceed OWASP's minimums, 256-bit CSPRNG session tokens hashed before storage, correct `httpOnly`/`Secure`/`SameSite=Strict` cookie flags, a CSRF double-submit implementation enforced structurally (one middleware wrapping every `/api/*` route, not per-route opt-in), fully parameterized SQL with no injection surface found anywhere, and comprehensive IDOR protection (every query scoped to `user_id`, plus a foreign-key-ownership check applied to all ten resources that accept cross-resource references).

**Both prior findings (M1, L1) are confirmed fixed.** L2 (baseline) is now mitigated with a documented contract. Three new items surfaced this cycle:

- **Medium**: `POST /auth/register` (the v4.33.0 first-run setup wizard endpoint) is a live, unauthenticated, network-reachable endpoint that creates the single admin account — this **contradicts CLAUDE.md's Phase 1 bullet**, which still states "no open self-registration endpoint." The endpoint is implemented safely (atomic `INSERT...WHERE NOT EXISTS`, rate-limited), but a deployment that exposes the server port before an operator completes setup has a real first-claim race window, and neither `CLAUDE.md` nor `server/README.md` warns about it.
- **Low**: `sanitizeDebt()` (`src/sanitizers.js`) is the only record sanitizer that spreads the raw input (`...record`) before overriding known fields, instead of building an allowlisted object like every other sanitizer — unrecognized fields from imported JSON currently pass through unsanitized into `app.debts` (not exploitable today; no renderer iterates arbitrary debt keys).
- **Low**: the server's own test suite has one confirmed-failing test — `ledger-cleared: PUT upserts a compound-key entry and GET lists it` — root-caused to `server/src/routes/ledgerCleared.js` reusing the date-only `sanitizeDateISO()` on a field that's supposed to hold a full timestamp, truncating `clearedAt` to midnight. Functional/data-integrity bug only, zero security impact (the field is explicitly informational per CLAUDE.md).

All 62 tests in `tests/security/` pass.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Informational | 10 |

---

## Findings

### M1 (2026-09-02) — Unauthenticated first-run `/auth/register` endpoint contradicts documented threat model (Medium)

**Location**: `server/src/routes/auth.js:63-93` (`POST /auth/register`); `CLAUDE.md` line ~88 ("Backend service (optional, Phase 1)" bullet); `server/README.md:31`.

**Issue**: The Phase 1 design (and `CLAUDE.md`) describes the backend as bootstrapped only via the CLI `server/scripts/create-user.js`, with "no open self-registration endpoint." The v4.33.0 frontend setup wizard (commit `e2a...` "feat: frontend setup wizard for first PostgreSQL user") added a genuine HTTP endpoint, `POST /auth/register`, that is reachable by anyone who can send a request to the server — no auth required, by design (it's how the very first user is created without shelling into the container).

The endpoint itself is implemented safely:
```js
// server/src/routes/auth.js:77-79
const { rows } = await query(
    'INSERT INTO users (email, password_hash) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id',
    [email, hash]
);
```
The atomic `INSERT ... WHERE NOT EXISTS` prevents a TOCTOU race between two concurrent registration attempts — only one can ever win — and it's rate-limited (5/15min, `registerLimiter`, `auth.js:41-48`), and once any user exists the endpoint permanently 409s.

**Impact**: The residual risk is not a code bug but a **deployment-sequencing** one: if a fresh `docker compose up` deployment is reachable on the network (e.g., a public IP, an exposed port before a reverse-proxy/firewall is configured) before the legitimate operator completes the setup wizard, any other party who reaches `/auth/register` first claims the single admin account — permanently locking out the intended owner. This is the same class of risk as WordPress's or Nextcloud's first-run install screens, and is manageable with the right deployment guidance, but currently **no such guidance exists**: `server/README.md:31` just says "The app will show a setup wizard to create the first user," with no caveat about network exposure timing, and `CLAUDE.md`'s architecture summary actively documents the *opposite* of what the code does now.

**Remediation**:
1. Update `CLAUDE.md`'s Phase 1 bullet to accurately describe `/auth/register` as a one-shot, atomic, rate-limited first-run endpoint (not "no open self-registration endpoint") — this is a documentation-accuracy fix, independent of any code change.
2. Add a line to `server/README.md`'s deployment steps: don't expose the server/API port publicly (or put it behind a firewall/VPN) until the setup wizard has been completed; alternatively, consider gating `/auth/register` behind an explicit opt-in env var (e.g. `ALLOW_SETUP=true`, unset by default, so a deliberate step is required before the endpoint is even live) for defense in depth.

---

### L1 (2026-09-02) — `sanitizeDebt()` uses spread-then-override instead of an allowlist, unlike every other sanitizer (Low)

**RESOLVED 2026-09-04.** The `...record` spread was removed; the function already built a complete allowlist of every known field, so this was a pure removal (verified via a new Jest test asserting `Object.keys(result)` is exactly the allowlisted set and that an injected unknown field does not survive).

**Location**: `src/sanitizers.js:15-43`

```js
export function sanitizeDebt(record, idFallback) {
    ...
    return {
        ...record,                 // <-- carries through ANY field present on the raw input
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        ...
    };
}
```

**Issue**: `sanitizeAccount`, `sanitizeIncome`, `sanitizeBonus`, `sanitizeBill`, `sanitizeExpense`, `sanitizeRecurringTemplate`, `sanitizeEmergencyFund`, `sanitizeSinkingFund`, `sanitizeReconciliation`, and `sanitizeLedgerClearedTransactions` all build a fresh object listing only the fields the app knows about (an allowlist) — any unexpected key on the imported/loaded record is simply dropped. `sanitizeDebt` is the sole exception: it spreads the entire raw `record` first, then overwrites only the fields it recognizes. Any additional, unexpected key present on an imported debt JSON object (a field from a future version, a hand-edited export, or a deliberately malicious import) survives into `app.debts` completely unsanitized — untouched by `normalizeText`/`sanitizeFiniteNumber`/`sanitizeInteger`/`sanitizeDateISO`.

**Impact**: Not currently exploitable — no rendering code was found that iterates arbitrary keys of a debt object (`grep` for `Object.entries(debt` / `Object.keys(debt` / `...debt` across `src/*.js` found only call sites operating on already-known, already-sanitized fields in `breakEven.js`/`debtCalculator.js`). This is a latent hygiene gap, not a live vulnerability: any current renderer that touches debt data goes through named, escaped fields. But it's an inconsistency with the "every persisted/imported field must be sanitized" constraint in `CLAUDE.md`'s Security section, and it becomes a real risk the moment any future feature adds a generic key/value display for debts (e.g. a "custom notes" or "extra metadata" panel) without also updating this sanitizer to allowlist the new field explicitly.

**Remediation**: Rewrite `sanitizeDebt` to build an allowlisted object the same way every other sanitizer does — list every currently-supported debt field explicitly instead of spreading `record`. (The current implementation already does most of the necessary per-field sanitization work; only the base spread needs to be dropped.)

---

### L2 (2026-09-02) — Server test regression: `ledger-cleared` PUT truncates `clearedAt` to midnight (Low, functional — not security-relevant)

**Location**: `server/src/routes/ledgerCleared.js:7` (calls `sanitizeDateISO()` on `clearedAt`); `src/utils.js:67-83` (`sanitizeDateISO`, a date-only sanitizer that intentionally strips time-of-day); `server/migrations/1755600000005_create-ledger-cleared-transactions.js:8` (column is `cleared_at timestamptz` — a full timestamp).

**Issue**: The server's own test suite currently fails on `server/test/keyedResources.test.js` — "ledger-cleared: PUT upserts a compound-key entry and GET lists it":
```
AssertionError: Expected values to be strictly equal:
+ actual:   '2026-08-02T00:00:00.000Z'
- expected: '2026-08-02T10:00:00.000Z'
```
`ledgerCleared.js`'s route sanitizes the incoming `clearedAt` value with `sanitizeDateISO()`, but that function is explicitly documented (and tested) as a **date-only** sanitizer that normalizes any input to a bare `YYYY-MM-DD` and discards time-of-day (it even has a "heal legacy full ISO timestamps" branch that strips the time component on purpose). `clearedAt` is meant to record the precise moment a transaction was marked cleared (per the migration's `timestamptz` column type and the client-side `ledgerCleared.js` comment "tracks whether a transaction has posted/cleared the account, plus when it cleared"), so every value written through this route is silently truncated to midnight UTC.

**Verdict**: **Not security-relevant** — no injection, auth bypass, or IDOR is involved; this is a wrong-sanitizer-for-the-field-type bug (using a date sanitizer on a timestamp field). Per `CLAUDE.md`, the Cleared feature is "informational only, it does not affect running balances," so the blast radius is cosmetic (the UI's "Cleared {time}" tooltip always shows midnight instead of the real time) — but it is a real, currently-shipping, currently-failing regression.

**Remediation**: Replace the `sanitizeDateISO()` call in `server/src/routes/ledgerCleared.js` with a full-timestamp validator (e.g. `Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null`) so `clearedAt` round-trips with its time component intact.

*(Aside, out of this finding's scope but worth flagging: the same test run showed unrelated cascading failures in `crudResources.test.js` — `duplicate key value violates unique constraint "users_email_key"` and a downstream `TypeError` in a test helper — consistent with test files racing against a shared Postgres test database rather than a per-test logic bug. Not security-relevant; a test-infrastructure cleanup item.)*

---

### Resolved since June 19, 2026

**M1 (baseline) — Negative-amount validation bypass in Income/Bonus and Fixed-Amount Debt forms**: ✅ **Confirmed fixed.** All 5 call sites (`src/income.js:164` `addIncome`, `:222` `saveEditIncome`, `:246` `addBonus`, and the corresponding `saveEditBonus`, plus `src/debts.js:45` `addDebt`'s fixed-amount branch) now capture the raw input string before calling `sanitizeFiniteNumber` and validate `!raw || isNaN(Number(raw)) || Number(raw) <= 0` against the **raw** value, matching the pattern already used in `bills.js`/`recurring.js`. A negative amount is now correctly rejected instead of silently clamping to `$0.01`.

**L1 (baseline) — Inconsistent escaping of caught-exception messages**: ✅ **Confirmed fixed.** `src/ui.js:140` now reads `` `Error: ${escapeHtml(err && err.message ? err.message : String(err))}` `` — consistent with `strategy.js`/`strategyPlanCalculation.js`'s existing convention.

**L2 (baseline) — `accounts.js` generic `innerHTML` setter takes a raw `opts` argument**: ✅ **Mitigated.** The helper now carries an explicit contract comment (`src/accounts.js:11-12`: "opts must already be fully escaped HTML before reaching el.innerHTML below — account name/type are wrapped in escapeHtml() here, not at the assignment site"), and the sole call site continues to pre-escape via `escapeHtml()`. No live issue found; documented as originally recommended.

---

### Informational

**I1 — CSP unchanged and still in sync**: `index.html`'s CSP meta tag (`script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) and `nginx.conf`'s header remain byte-for-byte in sync, verified by the passing `test_csp_meta_and_nginx_header_stay_in_sync` test and a direct diff. No inline `<script>`/`style="..."` and no `eval(`/`new Function(` were found anywhere in `src/*.js`, `index.html`, or `guide.html`.

**I2 — New modules follow the escaping convention correctly**: Every module added since the baseline was checked for `innerHTML`/`insertAdjacentHTML` usage. `src/loginGate.js`, `src/postgresSync.js`, `src/postgresImport.js`, `src/dataTransferModal.js`, and `src/settings.js` use no `innerHTML` at all (`textContent`/DOM APIs only). `src/i18n.js`'s `applyStaticTranslations()` uses `textContent`/`setAttribute` exclusively, confirmed by its own inline comment and by grep — no escaping gap. `src/commandPalette.js:87` and `src/ledgerCleared.js`-driven rendering in `src/ledger.js:169` (the new Cleared checkbox, including `clearedAt` in a `title` attribute) both wrap all user-derived data in `escapeHtml()`.

**I3 — Sanitizer coverage is complete, including the newest `ledgerClearedTransactions` field**: `sanitizeLedgerClearedTransactions()` (`src/sanitizers.js:114-124`) is called on both the load path (`src/storage.js:51`) and the import path (`src/sanitizers.js:243` inside `sanitizeParsedState`, consumed by `src/dataExport.js`), matches the `sanitizeLedgerOverrides` pattern it was modeled on, and only accepts a `clearedAt` value that passes `sanitizeDateISO`. Every array in `DebtTrackerApp`'s state (cross-referenced against `src/app.js:137-154`) — including `netWorthMilestonesAwarded` and `perMonthStimulus`, both added since the baseline — has full sanitizer coverage on load and import.

**I4 — Import path hardening unchanged and still effective**: The 2 MB size cap, try/catch-wrapped `JSON.parse`, and per-record `sanitizeX()` routing through `sanitizeParsedState()` before touching app state are all still in place and unchanged in `src/dataExport.js`.

**I5 — Server auth architecture is sound**: `argon2.hash(password, { type: argon2.argon2id })` (`server/src/auth/argon2.js:4`) relies on the `argon2` package's library defaults (memoryCost 64 MiB, timeCost 3, parallelism 4), which exceed OWASP's minimum recommendation (m=19 MiB, t=2, p=1). Session tokens are `crypto.randomBytes(32).toString('base64url')` (256 bits of CSPRNG entropy, `server/src/auth/middleware.js:5`), SHA-256 hashed before storage (`middleware.js:13`, `server/src/auth/sessions.js:12`) so a database compromise doesn't yield replayable session cookies. Cookie flags are correct: the session cookie is `httpOnly, secure (in production), sameSite: 'strict'`; the CSRF cookie is necessarily `httpOnly: false` (client JS must read and echo it) but still `secure`/`sameSite: strict` (`server/src/routes/auth.js:9-10`).

**I6 — CSRF protection is structurally enforced, not per-route opt-in**: `server/src/app.js:34` wraps every mounted `/api/*` resource router in `requireSession, requireCsrf` in one place, so a new route file can't accidentally ship without CSRF protection. `requireCsrf` (`server/src/auth/middleware.js:34-42`) exempts only safe methods (`GET`/`HEAD`/`OPTIONS`). `POST /auth/logout` explicitly re-adds `requireCsrf` since it's mounted outside `/api` (`auth.js:117`); `/auth/login`, `/auth/register`, and `/auth/setup-status` correctly have no CSRF check (there's no session yet) but are all rate-limited. No unprotected mutating route was found.

**I7 — No SQL injection surface**: Every value in every query goes through parameterized `$1/$2...` placeholders via `pg`. The only string-interpolated fragments in `server/src/crudRouter.js`/`server/src/keyedRouter.js` (`${table}`, `${dbColumns}`, `${insertCols}`, `${setClauses}`, `${keyColumn}`) come exclusively from hardcoded config objects supplied at router-construction time in each `server/src/routes/*.js` file — never from request input.

**I8 — IDOR protection is comprehensive**: Every `GET`/`PATCH`/`DELETE` in `crudRouter.js`/`keyedRouter.js` filters by `WHERE user_id = $1 AND id = $2` (or the resource's key column). The prior IDOR fix (commit `df3a1a6`, rejecting foreign keys pointing at another user's row) is implemented once via `findUnownedForeignKey()` and applied to all ten resources that declare `foreignKeys` — bills, bonuses, debts, emergencyFunds, expenses, incomes, ledgerOverrides, reconciliations, recurringTemplates (2 FKs), sinkingFunds — confirmed by grep across `server/src/routes/*.js`. `ledger-cleared`, `settings`, and `net-worth-snapshots` correctly have no FK check (no cross-resource reference to validate) but are still scoped by `user_id`.

**I9 — Rate limiting is present and reasonable**: Login (`5/15min`, `skipSuccessfulRequests: true`) and registration (`5/15min`) limiters use standard brute-force-resistant settings; `setup-status` is limited more loosely (`20/15min`) since it's a read-only polling endpoint. No unauthenticated route was found without a limiter.

**I10 — CI security tooling and secrets handling are both mature and sensibly configured**: `.github/workflows/codeql.yml` scans `javascript-typescript` on push/PR to `main` plus a weekly cron. `.github/workflows/trivy.yml` runs three scans (Docker image CRITICAL/HIGH build-breaking + full SARIF upload; filesystem secret scan, build-breaking; IaC/config, informational-only) on push/PR/weekly cron, with SARIF uploads correctly guarded against fork PRs lacking `security-events: write`. `.github/workflows/dependency-review.yml` gates PRs to `main` at `fail-on-severity: high`. `.github/dependabot.yml` covers all five relevant ecosystems (npm root, npm `/server`, Docker root, Docker `/server`, github-actions) on a weekly schedule. `ci.yml`'s `test-security` job runs `pytest tests/security -v` as a real merge gate. Secrets flow through genuine Docker Compose `secrets:` mounts (`/run/secrets/postgres_password`), never hardcoded or baked into an image; `.env.example` documents only a non-secret `SESSION_TTL_DAYS` and explicitly comments why `DATABASE_URL` is deliberately absent; `secrets/*.txt` is gitignored (`.gitignore:35-36`) while the `.example` template is tracked; both `server/Dockerfile` (confirmed still `USER node`) and the root `Dockerfile` (`USER nginx`) run non-root, consistent with the prior Trivy-driven fix. A repo-wide secret-pattern grep found no committed real secrets — only the well-known XKCD placeholder password (`'correct horse battery staple'`) used as a test fixture in `server/test/`.

---

## Test Suite Results

```
pytest tests/security/ -v
62 passed in 535.04s (0:08:55)
```
All CSP (5), input-validation (14), static-scan (18), and XSS (25) tests pass cleanly against the live app at `http://localhost:32900/`, including regression tests for every XSS finding closed in prior audits and the newer `test_ledger_csv_export_quotes_fields_against_csv_injection` and `test_sanitize_setting_rejects_xss_and_object_values` tests.

**Server test suite**: `npm test` in `server/` against the live `postgres-test` container reproduces the known failing test (`ledger-cleared: PUT upserts a compound-key entry and GET lists it`, see L2 above) plus unrelated cascading failures in `crudResources.test.js` traced to test-file races against a shared database (not a security issue — see the aside under L2).

---

## Sanitization Pipeline Cross-Check

Every persisted `DebtTrackerApp` state array/map (`debts`, `accounts`, `incomes`, `bonuses`, `bills`, `expenses`, `recurringTemplates`, `emergencyFunds`, `sinkingFunds`, `monthlySnapshots`, `netWorthMilestonesAwarded`, `reconciliations`, `settings`, `ledgerAmountOverrides`, `ledgerClearedTransactions`, `perMonthStimulus`, `forecastSettings`, `ledgerSettings`) has a corresponding sanitizer invoked from `sanitizeParsedState()` (`src/sanitizers.js:233-261`), confirmed by direct cross-reference against `src/app.js`'s state initialization (lines 137-154). No persisted field was found without sanitizer coverage. The one design inconsistency found (`sanitizeDebt`'s spread-then-override pattern vs. every other sanitizer's allowlist pattern) is documented as L1 above — it's an inconsistency in defensive depth, not a coverage gap.

On the server side, `server/src/sanitizers/index.js` re-runs the equivalent client-side sanitizers on every write (imported by relative path per `CLAUDE.md`), so validation is not duplicated between the two tiers.

## Addendum: NODE_ENV / Secure Cookie Deployment Gap (found post-review by the documentation audit)

**RESOLVED 2026-09-04.** The naive fix — setting `NODE_ENV: production` directly in `docker-compose.yml`'s `server` service — was tried on 2026-09-03 and reverted (see prior note, preserved in git history) after it turned out to conflict with `DEPLOYMENT.md`'s "HTTPS Requirement" section: `NODE_ENV=production` had to be set **only after** HTTPS was terminated in front of the stack, because `auth.js`'s old `SECURE` flag had no protocol-detection fallback — setting it while still testing over plain HTTP silently dropped the session/CSRF cookies (login broke, with no error surfaced). The real fix implemented today pairs `app.set('trust proxy', 1)` (`server/src/app.js`, also closing Database finding M1 below) with a per-request `req.secure` check in `server/src/routes/auth.js` (`sessionCookieOpts(req)`/`csrfCookieOpts(req)`, replacing the static `SECURE` module constant): Express derives `req.secure` from nginx's `X-Forwarded-Proto` header once `trust proxy` is set, so the `Secure` flag is now correct automatically in both plain-HTTP local testing and a real HTTPS deployment — no manual step, no deployment-ordering requirement, no regression either way. Verified with two new `server/test/auth.test.js` cases (plain HTTP → no `Secure`; `X-Forwarded-Proto: https` → `Secure`) plus a `server/test/app.test.js` case asserting `trust proxy` is set; all 113 server tests pass.

The documentation-audit pass (running concurrently with this one) found that `docker-compose.yml` (root) never sets `NODE_ENV` for the `server` service. `server/src/routes/auth.js` gates the session cookie's `Secure` flag on `NODE_ENV === 'production'`, so an operator who deploys via the documented `docker compose up -d` path — without manually adding `NODE_ENV=production` themselves, which no current doc instructs them to do — gets a session cookie sent over plain HTTP with `Secure` unset. This is a **Medium** finding, upgrading the risk posture from "correct cookie flags" (as stated in the Executive Summary above, which was written before this was found) to "correct cookie flags contingent on an undocumented manual step." Recommended fix: set `NODE_ENV=production` directly in `docker-compose.yml`'s `server` service `environment:` block (not just `.env.example`), so the safe default requires no operator action, and add a `DEPLOYMENT.md` callout for anyone running the server outside Docker.

## Overall Risk Rating: **LOW**

The app's core threat model (client-side only, browser storage, strict CSP) remains narrow and thoroughly defended, and the substantial new optional backend (`server/`) was built with correct fundamentals throughout — parameterized queries, comprehensive IDOR checks, sound session/CSRF/hashing design, and mature CI security tooling. The single Medium finding is a documentation/deployment-guidance gap around an otherwise-safe first-run endpoint, not an exploitable code defect; both Low findings are real but narrow (a latent sanitizer-hygiene gap with no current renderer to exploit it, and a functional timestamp-truncation bug with explicitly no effect on financial balances). Recommended before the next audit cycle: fix the `CLAUDE.md` doc-drift and add the deployment-timing caveat (M1), tighten `sanitizeDebt` to the allowlist pattern (L1), and swap the `ledger-cleared` route's sanitizer for a timestamp-aware one (L2).
