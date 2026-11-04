# Security Audit — v7.0.0 (PostgreSQL-only storage)

**Date:** 2026-11-04
**App version audited:** 7.0.0
**Scope:** every non-test change in PR #458 (`13c72cd..3d156a1`), which made the self-hosted PostgreSQL server the only storage backend. The review covered `src/`, `server/`, `sw.js`, `index.html`, `guide.html`, `manifest.json`, `nginx.conf`, the compose files, both Dockerfiles and `.github/`. Code in `tests/**` was out of scope as a target, though the security test suite was run.
**Method:** a manual diff review focused on exploitable vulnerabilities, using a >0.8 confidence bar at High/Medium severity. The review was checked against the repository's live security tooling. DoS, rate limiting, hardening-only suggestions and outdated libraries were excluded from the diff review, as with earlier audits. Dependency status is reported separately below.

## Result

**No High or Medium vulnerabilities were introduced by 7.0.0.** No findings reached the reporting bar, so no false-positive filtering pass was needed.

Risk level: **LOW** (unchanged).

## Live tooling at audit time

| Check | Result |
|---|---|
| CodeQL (`Analyze JavaScript`) on PR #458 | pass, **0** open code-scanning alerts on the repository |
| Trivy (image + secret scan) | pass |
| `dependency-review` | pass |
| Secret scanning | **0** open alerts |
| `pytest tests/security/test_static_scan.py tests/security/test_no_browser_financial_storage.py` | **28 passed** |
| Full `tests/security/` suite in CI (`test-security`) | pass |
| Dependabot | 2 open alerts, both in the **dev-only** Jest/Stryker toolchain (`package-lock.json`, development scope; never shipped to the browser or server): `minimatch` (medium, ReDoS-class DoS, fix 11.0.1) and `deepmerge` (low, prototype poisoning, no fix yet) |

## Security-relevant changes reviewed and judged safe

### Authentication and session handling
- **Retry after re-login** (`src/postgresSync.js` `pgFetch`, `src/storage.js` `saveToStorage`).
  - A write is retried at most once, and only after a 401.
  - `server/src/app.js` mounts `requireSession` and `requireCsrf` before every `/api` router, so a 401 is returned before any handler runs. A retried POST therefore cannot apply a change twice.
  - A second failure falls through to the error banner without looping.
  - The CSRF token is re-read for each attempt.
- **`requestLogin`** (`src/loginGate.js`) only de-duplicates concurrent gate requests into one promise. `/auth/register` stays gated server-side: single user, `ALLOW_SETUP`, atomic insert.
- **Boot probe** (`probeServer`) only chooses which gate to show. Data access is still enforced by server sessions. Treating a `/auth/setup-status` 429 as "reachable" grants nothing, because the next step is the login gate.
- **`loadFromPostgres`** throws on any non-2xx instead of assigning an error body as data. A 401 raises `SessionExpiredError`, and the re-probe is capped at 2 attempts.
- **`passwordPolicyLimiter`** gives `/auth/password-policy` its own limiter. That endpoint returns a static summary of the password rules with no secrets. The login and register limiters are unchanged.

### Injection and XSS
- **Legacy browser data** (`_handleLegacyBrowserData`, `src/pgMigrationModal.js`).
  - The JSON comes from same-origin `localStorage`. It is run through `sanitizeParsedState` before import, and the server re-runs its sanitizers on every write.
  - The modal sets text only through `textContent`, using `t()` and `plural()`. None of the legacy JSON reaches `innerHTML`.
  - The backup download is a same-origin Blob URL. Its filename is built from the date only, and the URL is revoked after the click.
  - The import variant, which wipes and replaces server data, runs only when the server dataset is empty.
- **New UI** (`src/serverUnreachableGate.js`, `#syncErrorBanner`, new `WHATS_NEW_ENTRIES`): static markup and i18n text set via `textContent` and `classList`. The What's New HTML is developer-written and contains no user data.
- **Newly persisted fields** (migration 031):
  - Debt `notes` is rendered through `escapeHtml`.
  - `nextPaymentDue` is an ISO date, so it cannot carry markup or quotes.
  - The ledger override `memo` is escaped in both its `title` and `aria-label` attributes.
- **SQL**:
  - Migration `1755600000031` is static DDL through `pgm.sql()`, with no SQL built from input.
  - The new `columns` entries are static identifier maps used by `crudRouter`. All values are bound parameters, and rows stay scoped by `user_id`.
  - `sinking_funds.order` maps to `sort_order`, which avoids a reserved word.

### Data exposure
- **Service worker** (`sw.js`): `/api/`, `/auth/` and `/calendar.ics` are network-only, matched on the pathname so `?token=` queries are covered too.
  - **This fixes a pre-7.0 exposure:** before, financial JSON could land in Cache Storage.
  - `CACHE_NAME` was bumped so the old caches are evicted.
- **`Cache-Control: no-store`** is set by Express middleware on every `/api` and `/auth` response, error responses included. Setting it in Express rather than nginx leaves nginx's inherited security headers intact.
  - It also stops a not-yet-updated 6.x service worker caching API responses during the upgrade window, because its `networkFirst` path already skips `no-store`.
- **Browser storage:** financial data is no longer written to `localStorage`/`sessionStorage`.
  - `tests/security/test_no_browser_financial_storage.py` (static) and `test_server_only_storage.py::test_no_financial_keys_after_crud_pass` (runtime) enforce the spec §3 allowlist.
  - Leftover 6.x `debtTrackerData` is removed after import or decline, and decline downloads a backup first.
- **`discardBody`** reads the response into an ArrayBuffer and discards it. Nothing is logged, stored or rendered.

### Configuration and CI
- **`nginx.conf`:** only the unused `X-Myfinances-Backend` header was removed. The CSP and the other security headers are unchanged and still in sync with the `index.html` meta tag (`test_csp_meta_and_nginx_header_stay_in_sync`).
- **CI** (`build-images` job, `.github/actions/start-stack`): runs only on `push` and `pull_request` to `main` (no `pull_request_target`), and interpolates no `github.event` input.
  - The test password is a dummy credential for an ephemeral CI stack.
  - `ALLOW_SETUP` is never set; the test user is created with `server/scripts/create-user.js`.
- **`docker-compose.dev.yml`:** a dev-only override with read-only bind mounts of public static assets.
- **Test harness safety** (`tests/conftest.py`): the harness wipes server data before every test. To avoid wiping a real deployment, it registers a user only when `needsSetup` is true. Otherwise it logs in with the test credentials, and if that fails it calls `pytest.exit` and wipes nothing. **Never point the suite at a production server.**

## Open security-tagged follow-ups (all Low, tracked)

| Issue | Item |
|---|---|
| #473 | Harden the browser-storage static scanner: regex-literal stripping, scope-aware constant resolution, scanning `sw.js`, `Storage.prototype` calls, one shared allowlist |
| #475 | Test-harness session cache: atomic writes with mode 0600 (it holds only the throwaway test user's session) |
| #477 | Ledger override PUT/DELETE URL doesn't `encodeURIComponent` its key (inconsistent with `postgresImport.js`; not exploitable with current key formats) |

The other v7 follow-ups (#459–#479, label `v7-follow-up`) are functional or hygiene items, not security findings.

## Operator guidance added for 7.0.0
- The server is now mandatory, so its hardening now applies to every deployment. Serve it only over HTTPS (session cookies are `Secure`), and keep `ALLOW_SETUP` unset except while creating the first account.
- Test-only variables (`TEST_BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD`) belong on the machine that runs `pytest` or in CI, never in the production stack's environment.
- Database volume, `pg_dump` backups and the downloaded `myfinances-browser-backup-*.json` files contain the full financial dataset. Protect them like the database itself.
