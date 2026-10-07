# Security Audit — MyFinances

**Date**: October 6, 2026
**Version**: v6.10.7 (branch `feature/ui-polish-mobile-2026-10`, head commit `12682b5`)
**Auditor**: Automated + manual static review (Claude Code)
**Status**: ✅ **LOW RISK** — one **Low** open finding, no Critical/High/Medium issues
**Scope**: Full source review (`src/*.js`, `index.html`, `nginx.conf`), the optional self-hosted backend (`server/` — auth, CSRF, CRUD/keyed routers, IDOR protections, rate limiting, password reset flow, calendar feed), new features added since the September 2 audit (People/Persons entity, Balance History, Retirement page, Password Reset, Surplus Analysis, Calendar Feed, Account Archiving), sanitizer pipeline cross-check against all current persisted state, Dockerfiles and secrets handling.

This supersedes `SECURITY_AUDIT_2026-09-02.md`. All three findings from that audit (M1, L1, L2) are now confirmed fixed.

---

## Executive Summary

MyFinances retains its LOW overall risk posture. The core frontend threat model (strict CSP, `escapeHtml()` discipline, allowlisted sanitizer pipeline) continues to hold without regression across the 188 commits landed since the September 2 audit.

The September 2 follow-up work was thorough: the `ALLOW_SETUP` env-var gate closes the unauthenticated-register race risk (M1), the `sanitizeDebt` spread-then-override was removed in favor of an explicit allowlist (L1), and the `clearedAt` timestamp truncation was fixed by introducing `sanitizeTimestampISO()` (L2). No prior finding was re-opened.

The substantial new surface added since September 2 — password reset flow (Sept 14), People/Persons entity, Balance History (with a new public-facing server route), Calendar Feed (token-authenticated public endpoint), Retirement page, and Surplus Analysis — all follow the project's established security conventions correctly with **one exception**: the new `POST /auth/reset-password` endpoint was added without a rate limiter. The endpoint is not exploitable for credential theft (the reset token is a 32-byte CSPRNG hex string with a 1-hour TTL and single-use enforcement), but every call to it invokes argon2id hashing (~400ms CPU), making it an unauthenticated amplification surface for application-level DoS.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Informational | 11 |

---

## Resolved Since 2026-09-02

### M1 — Unauthenticated `/auth/register` contradicts documented threat model ✅ RESOLVED

**Resolution (commits `61a8814`, `e841a52`, September 3–4, 2026)**:
- `POST /auth/register` now returns 404 unless the environment variable `ALLOW_SETUP=true` is explicitly set (`server/src/routes/auth.js:77`). This makes the endpoint an intentional opt-in step rather than a permanently-live attack surface.
- `docker-compose.yml` was updated with a clear operator comment: "Set ALLOW_SETUP=true in the environment ONLY during initial account creation."
- `server/README.md`'s Production section now documents the deployment-timing caveat.
- `CLAUDE.md`'s Phase 1 bullet was corrected to accurately describe the one-shot endpoint and its `ALLOW_SETUP` gate.

The endpoint itself remains correctly implemented (atomic `INSERT ... WHERE NOT EXISTS`, argon2id hash, rate-limited at 5/15min, permanent 409 after first user) — the fix was purely the env-var guard and documentation accuracy.

### L1 — `sanitizeDebt()` spread-then-override instead of allowlist ✅ RESOLVED

**Resolution (commit `e841a52`, September 4, 2026)**:
`sanitizeDebt()` in `src/sanitizers.js` was rewritten to build a fully-allowlisted object (identical pattern to every other sanitizer), dropping the `...record` spread that previously passed arbitrary unknown keys through unsanitized. Verified: a grep for `...record` in `src/sanitizers.js` returns no matches.

### L2 — `ledger-cleared` route truncated `clearedAt` to midnight ✅ RESOLVED

**Resolution (commit `61a8814`, September 2, 2026)**:
`sanitizeTimestampISO()` was added to `src/utils.js` and used in both `server/src/routes/ledgerCleared.js` and `src/sanitizers.js:sanitizeLedgerClearedTransactions()` to correctly round-trip full ISO 8601 timestamps. Server test suite went 85/86 → 86/86.

---

## Open Findings

### L1 (2026-10-06) — `POST /auth/reset-password` has no rate limiter (Low)

**Severity**: Low

**Location**: `server/src/routes/auth.js:191` (`POST /auth/reset-password`)

**Issue**: The password reset flow was added on September 14, 2026 (PR #191). It introduces two endpoints:
- `POST /auth/forgot-password` — correctly protected by `forgotPasswordLimiter` (5/15min, `auth.js:151–159`)
- `POST /auth/reset-password` — **no rate limiter applied** (line 191 begins `authRouter.post('/reset-password', async ...`)

Every call to `POST /auth/reset-password` invokes `hashPassword(newPassword)` (`server/src/auth/argon2.js`), which calls `argon2.hash()` with `type: argon2id` and library-default memory parameters (~400ms CPU per call). An unauthenticated attacker who can reach the server can submit unlimited requests to this endpoint, each consuming ~400ms of CPU on the server process.

**Why not exploitable for credential theft**: The reset token is `randomBytes(32).toString('hex')` — 256 bits of CSPRNG entropy, which makes brute-force infeasible. Additionally, the implementation correctly:
- SHA-256 hashes the token before DB lookup (`createHash('sha256').update(token).digest('hex')`)
- Marks tokens `used_at` on first use (single-use enforcement)
- Enforces a 1-hour TTL (`expires_at > NOW()`)
- Invalidates the calendar subscription token on credential reset

**Impact**: Application-level DoS amplification only. An attacker submitting ~150 concurrent requests/second would saturate a single-core server process. Not relevant to a home server behind a VPN/firewall; more relevant to an internet-exposed deployment.

**Recommended fix**: Add a rate limiter (matching the `forgotPasswordLimiter` settings: 5 attempts per 15-minute window per IP) at the route definition site:

```js
const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } }
});

authRouter.post('/reset-password', resetPasswordLimiter, async (req, res, next) => { ... });
```

---

## New Surface Since 2026-09-02

### Password Reset Flow (PR #191, September 14, 2026)

**Endpoints**: `POST /auth/forgot-password`, `POST /auth/reset-password`
**Frontend**: `src/loginGate.js` (`urlParams.get('reset_token')`, `POST /auth/reset-password`), `index.html` (reset-password mode in the login gate)

**Design assessment**: Sound overall. Tokens are 256-bit CSPRNG hex strings, SHA-256-hashed before DB storage. Single-use enforcement (`used_at`). 1-hour TTL. Email-only delivery (token never in a server response). Calendar token invalidated on credential reset (`UPDATE plan_settings SET calendar_token = NULL`). `POST /auth/forgot-password` always returns 200 to avoid confirming whether an email is registered (oracle protection). Password minimum length (12 characters) enforced on both endpoints.

**Open issue**: `POST /auth/reset-password` lacks a rate limiter. See L1 above.

**Note**: `POST /auth/reset-password` does not create a new session after a successful reset — the user must log in again. This is the safer design (forces re-authentication) and is correct.

### People / Persons Entity (PR #207, September 2026)

**New route**: `/api/persons` — `createCrudResource({ table: 'persons', sanitize: sanitizePerson, ... })` (`server/src/routes/persons.js`)
**Frontend**: `src/people.js` — new People page with income and debt linkage

**Design assessment**: Correct. Route uses the standard `crudRouter.js` pattern with `requireSession + requireCsrf` inherited from the `/api` sub-router. `sanitizePerson()` in `src/sanitizers.js` is a minimal allowlist (`id`, `name`). `people.js` uses `escapeHtml()` on all rendered person names. XSS test `test_xss_in_person_name` exercises the People page rendering path. `sanitizeParsedState()` includes `persons` in the load and import pipeline. No IDOR surface: persons scoped by `user_id` via the generic `crudRouter.js` `WHERE user_id = $1` in every query.

### Balance History (PR #226, September/October 2026)

**New route**: `/api/balance-history` — `createCrudResource({ table: 'balance_history', sanitize: sanitizeBalanceHistoryEntry, foreignKeys: { debtId: 'debts', accountId: 'accounts' }, ... })` (`server/src/routes/balanceHistory.js`)
**Frontend**: `src/balanceHistory.js`, `src/balanceHistoryCore.js`, `src/balanceHistoryModal.js`

**Design assessment**: Correct. `sanitizeBalanceHistoryEntry()` in `src/sanitizers.js` enforces the "exactly one of debtId or accountId must be set" invariant by returning `null` on violation (which the `crudRouter.js` converts to a 400). The `balance_history_one_owner` CHECK constraint in the migration backs this up at the database layer. Foreign-key ownership validation via `findUnownedForeignKey()` is wired to both `debtId` and `accountId`. `src/balanceHistoryModal.js` uses only `textContent` for user-derived strings (confirmed by the file's own comment: "All user data is rendered via textContent"). XSS test `test_xss_in_balance_history_modal_names` exercises the modal rendering path.

### Calendar Feed (PRs #212, #213, #214, #217, September/October 2026)

**New endpoints**: `GET /api/calendar/token` (session-authenticated, returns current token), `POST /api/calendar/token` (session-authenticated + CSRF, regenerates token); `GET /calendar.ics?token=xxx` (public, token-authenticated)
**Files**: `server/src/routes/calendar.js`, `server/src/calendarGenerator.js`, `src/calendarFeed.js`

**Design assessment**: Well-designed public endpoint. Token format is validated before DB lookup (`/^[0-9a-f]{32}$/.test(token)`) to prevent timing-oracle queries with malformed inputs. Rate-limited at 60/15min (appropriate for webcal clients that poll on a schedule). Response headers include `Cache-Control: no-store, private` (prevents proxy/CDN caching of financial data) and `X-Robots-Tag: noindex` (prevents indexing of token URLs). Token is 128-bit CSPRNG hex (sufficient entropy for a bearer token). Token is invalidated on password reset. Both `/api/calendar/token` endpoints are inside the session-authenticated `/api` sub-router and inherit `requireSession + requireCsrf`.

**The server-side `calendarGenerator.js` duplicates occurrence/payday logic from the frontend** (noted in `CLAUDE.md`). This is an acknowledged architectural constraint, not a security issue.

### Retirement Page (PRs #171–#183, September/October 2026)

**New route**: `/api/retirement-snapshots` — standard `createCrudResource` pattern with FK to `accounts`
**Frontend**: `src/retirement.js`, `src/retirementCalculator.js`

**Design assessment**: Follows established patterns. `sanitizeRetirementSnapshot()` is an explicit allowlist. `retirementTargetDate` is sanitized via `sanitizeDateISO()` on both load and import paths. `src/retirement.js` uses `escapeHtml()` on all user-derived strings including account names and the target date value attribute. XSS test `test_xss_in_retirement_target_date_input_value` exercises the most likely injection point. Route inherits session/CSRF protection via the `/api` sub-router.

### Surplus Analysis (PRs #238–#241, September/October 2026)

**Frontend-only feature** (no new server endpoints). New section on the Health page computing a projected cash-flow surplus/deficit.

**Design assessment**: The surplus analysis section uses `escapeHtml()` on all rendered user data (names, labels, account names). No new persistence or server interaction. The `_surplusDebtPct` module-level variable (persists allocation slider position across re-renders) holds a number in the 0–100 range (clamped by the slider `<input type="range">`) — no injection surface.

---

## Informational

**I1 — CSP is in sync with one intentional delta**: The `<meta>` CSP in `index.html` and the `add_header Content-Security-Policy` in `nginx.conf` share the same origin allow-lists across all directives present in both. `nginx.conf` additionally carries `frame-ancestors 'none'` — absent from the meta tag by design (browsers do not honor `frame-ancestors` in `<meta>` tags per the CSP3 spec; it requires an HTTP header, which nginx provides). The test `test_csp_meta_and_nginx_header_stay_in_sync` correctly exempts server-only directives from the sync check. No shared directive differs.

**I2 — XSS discipline holds across all 188 new commits**: A comprehensive grep of `src/*.js` for `.innerHTML =` and `insertAdjacentHTML` assignments identified every call site. Each was checked: all user-data interpolations go through `escapeHtml()`. New modules (`src/people.js`, `src/retirement.js`, `src/spending.js`, `src/balanceHistoryModal.js`, `src/calendarFeed.js`) either use `escapeHtml()` or — in the case of `balanceHistoryModal.js` — use `textContent`/DOM API exclusively. The `commandPalette.js` `cmd.icon` field rendered without escaping is populated exclusively from hardcoded emoji literals in `buildCommands()`, never from user data.

**I3 — Sanitizer pipeline is complete and covers all new state fields**: `sanitizeParsedState()` in `src/sanitizers.js` covers every persisted array and map in `DebtTrackerApp`, including the fields added since the September audit: `persons` (via `sanitizePerson`), `balanceHistory` (via `sanitizeBalanceHistoryEntry`). Cross-reference against `src/app.js` state initialization (lines 168–204) confirms no persisted field has been added without a corresponding sanitizer. The `sanitizeParsedState` import pipeline also correctly cross-validates `balanceHistory` entries against known `debtIds` and `accountIds` before committing them to state.

**I4 — Auth architecture unchanged and sound**: argon2id with library-default parameters (memoryCost 64 MiB, timeCost 3, parallelism 4) throughout. 256-bit CSPRNG session tokens SHA-256 hashed before storage. Cookie flags (`httpOnly`, `secure: req.secure`, `sameSite: 'strict'`) derived per-request from `req.secure` following the trust-proxy fix. CSRF double-submit structurally enforced via the `/api` sub-router. No regression found.

**I5 — CSRF protection still structurally sound**: `server/src/app.js` wraps the entire `/api` sub-router in `requireSession, requireCsrf` in one place. `POST /auth/logout` explicitly adds `requireCsrf`. All safe methods (GET/HEAD/OPTIONS) are exempted. The new calendar token routes (`POST /api/calendar/token`) correctly inherit protection. No new route was found that bypasses this.

**I6 — SQL injection surface remains zero**: All parameterized placeholders throughout `crudRouter.js`, `keyedRouter.js`, `planSettings.js`, `calendar.js`, `auth.js` (including the new password reset queries). The only string-interpolated fragments in router SQL (`${table}`, `${dbColumns}`, etc.) are from hardcoded config objects at router-construction time, never from request input. The `balance_history` route's `sanitizeBalanceHistoryEntry` null-return guard ensures no null/malformed row reaches the INSERT path.

**I7 — New `persons` route has correct IDOR protection**: `createCrudResource` scopes all queries by `user_id`. The persons table has no cross-resource foreign keys (persons link to other records, not the other way around for ownership purposes), so `foreignKeys: {}` is correct — no FK ownership check is needed.

**I8 — Password reset token design is secure**: 256-bit CSPRNG hex token. SHA-256 hash stored in DB (raw token only in email). Single-use via `used_at` marker. 1-hour TTL enforced in SQL (`expires_at > NOW()`). Calendar token invalidated on successful reset. Always-200 response on `POST /auth/forgot-password` prevents email enumeration. 12-character minimum password enforced on both set-password endpoints. Token format validated before DB lookup. The one gap (no rate limiter on `POST /auth/reset-password`) is documented as L1 above.

**I9 — `i18n.js` `t()` function does not HTML-escape substitution vars (latent)**: The `t(key, vars)` function (`src/i18n.js:101`) uses `String(vars[name])` without calling `escapeHtml()`, so if `t()` were ever called with user-supplied data as a substitution variable, that data would be rendered unescaped into `innerHTML`. All current call sites with variable substitutions (`health.js:603`, `:622`, `:623`, `:643`, `:644`) pass only browser-computed strings (`toLocaleDateString`, `formatCurrency`) — not user-controlled input. This is latent only, not currently exploitable. Recommendation: add a note to `i18n.js` documenting the no-user-data contract on `vars`, or defensively HTML-escape `vars` in `t()` itself.

**I10 — Secrets handling unchanged and correct**: Docker Compose secrets mounts for `postgres_password` and `smtp_password`. `.gitignore` covers `secrets/*.txt`. No hardcoded credentials found in any tracked file. Both Dockerfiles run non-root (`USER node`, `USER nginx`).

**I11 — `c701e28` reverted `sanitizeDebt.updatedAt` sanitizer change**: A commit (`c701e28`) reverted a change to `sanitizeDebt()`'s `updatedAt` field sanitizer that broke a Jest unit test. The reverted state (`sanitizeDateISO(record?.updatedAt)`) remains correct as-used — `updatedAt` is stored as a date-only string in the local-storage format — and the change that was reverted (switching to `sanitizeTimestampISO`) would only have been needed if the field stored full timestamps. No security regression: `sanitizeDateISO` still sanitizes the value correctly for its actual type.

---

## Sanitization Pipeline Cross-Check

Every persisted `DebtTrackerApp` state field (arrays and maps) cross-referenced against `src/app.js` lines 168–204 and `sanitizeParsedState()` in `src/sanitizers.js`:

| State field | Sanitizer | Load path | Import path |
|---|---|---|---|
| `persons` | `sanitizePerson` | ✅ `storage.js:219` | ✅ `sanitizeParsedState` |
| `debts` | `sanitizeDebt` (allowlisted) | ✅ | ✅ |
| `accounts` | `sanitizeAccount` | ✅ | ✅ |
| `incomes` | `sanitizeIncome` | ✅ | ✅ |
| `bonuses` | `sanitizeBonus` | ✅ | ✅ |
| `bills` | `sanitizeBill` | ✅ | ✅ |
| `expenses` | `sanitizeExpense` | ✅ | ✅ |
| `recurringTemplates` | `sanitizeRecurringTemplate` | ✅ | ✅ |
| `emergencyFunds` | `sanitizeEmergencyFund` | ✅ | ✅ |
| `sinkingFunds` | `sanitizeSinkingFund` | ✅ | ✅ |
| `monthlySnapshots` | `sanitizeNetWorthSnapshot` | ✅ | ✅ |
| `reconciliations` | `sanitizeReconciliation` | ✅ | ✅ |
| `planHistory` | `sanitizePlanHistoryEntry` | ✅ | ✅ |
| `retirementSnapshots` | `sanitizeRetirementSnapshot` | ✅ | ✅ |
| `balanceHistory` | `sanitizeBalanceHistoryEntry` | ✅ | ✅ |
| `ledgerAmountOverrides` | `sanitizeLedgerOverrides` | ✅ | ✅ |
| `ledgerClearedTransactions` | `sanitizeLedgerClearedTransactions` | ✅ | ✅ |
| `netWorthMilestonesAwarded` | inline `sanitizeInteger` | ✅ | ✅ |
| `perMonthStimulus` | inline `sanitizeFiniteNumber` | ✅ | ✅ |
| `settings` | `sanitizeSetting` | ✅ | ✅ |
| `ledgerSettings` | inline per-field | ✅ | ✅ |
| `forecastSettings` | `sanitizeForecastSettings` | ✅ | ✅ |
| `retirementTargetDate` | `sanitizeDateISO` | ✅ | ✅ |

No persisted field without sanitizer coverage was found.

---

## Remediation Priority

| Priority | Finding | Effort |
|---|---|---|
| 1 | L1: Add rate limiter to `POST /auth/reset-password` | ~5 min, add `rateLimit(...)` identical to `forgotPasswordLimiter` |
| 2 | I9: Document no-user-data contract on `t()` vars (or defensively escape) | ~15 min |

---

## Overall Risk Rating: **LOW**

The frontend XSS/injection surface remains narrow and well-defended. The optional backend's auth architecture is sound. All three findings from the September 2 audit were fixed within the same week. The 188-commit feature wave since then (People, Balance History, Retirement, Calendar Feed, Password Reset, Surplus Analysis) followed the established security conventions correctly, with one narrow rate-limiting gap on a new endpoint that is not exploitable for credential theft but does represent an unauthenticated DoS amplification surface. Recommended before the next audit cycle: apply the 5-line rate-limiter fix to `POST /auth/reset-password` (L1).
