# Server-only storage (v7.0.0) — design

**Status:** approved in brainstorming 2026-11-03, pending spec review
**Supersedes:** `2026-07-14-storage-abstraction-design.md` (local/session adapters), and the "optional" framing of the Phase 2a–2e Postgres specs.

## 1. Intent

MyFinances has grown in data volume and setup complexity. Browser-only storage (`localStorage`/`sessionStorage`) is removed; the self-hosted Node.js + PostgreSQL server becomes the **only** persistence backend. This is a breaking change and ships as **7.0.0**.

Success criteria:

- No code path stores financial data in `localStorage`/`sessionStorage`.
- With the server unreachable, the app shows a blocking "can't reach your server" screen, never stale/empty/local data.
- Existing users with browser-only data get a one-time path to move it into Postgres, after which the browser copy is removed.
- The whole Playwright suite runs against a real Postgres stack in CI.
- Docs no longer describe the app as client-side-only / works offline / no backend required.

Non-goals (YAGNI): offline read cache, offline edit queue, multi-user, rollback/retry of failed mutations, a dev proxy server.

## 2. Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Legacy `debtTrackerData` in the browser | Keep the migration prompt; wipe the local key once imported **or** declined |
| Test data | Real Postgres in every Playwright CI shard |
| Seeding/isolation | Through the app's real import path (`importAllJSON` replace → `postgresImport.js` → REST); wipe via `clearAllData` between tests |
| CI build cost | Build Docker images once per CI run, share as an artifact |
| Server unreachable | Blocking full-page error screen with Retry |
| Local dev | `docker compose` only; add `docker-compose.dev.yml` bind-mounting the frontend into nginx so edits need only a refresh |

## 3. What stays in the browser

Device preferences and transient UI state only, never persisted app data. Allowlist (as found in `src/` on 2026-11-03):

- Preferences: `debtTrackerTheme` / `THEME_PREF_KEY`, `LOCALE_PREF_KEY`, `CURRENCY_PREF_KEY`, `LAST_SEEN_VERSION_KEY` (What's New), `debtTrackerLedgerFilters`, `LEDGER_COLS_LS_KEY`, collapsible open-state keys (`utils.js` `isCollapsibleOpen`/`setCollapsibleOpen`).
- Transient draft: `debtTrackerReconInProgress` (`reconciliation.js`) — an unfinished reconciliation's checked rows/statement balance on this device, cleared when the reconciliation is applied or cancelled. Kept as-is: it is a per-device in-progress draft, not app data, and moving it server-side is out of scope.
- Migration only: read + remove of legacy `debtTrackerData` (§5 step 4), and remove of `debtTrackerStorageBackend` (§5 step 5).

Anything else is a violation caught by the static scan (§7).

## 4. Removed

- `src/storageAdapters.js` (`LocalStorageAdapter`, `SessionStorageAdapter`, `createStorageAdapter`, `getStorageBackendPreference`, `setStorageBackendPreference`, `STORAGE_BACKEND_PREF_KEY`).
- `app.storageAdapter`, `app._storageBackendKind`, `app._isFirstRun` (derived from local storage).
- `storage.js`: `loadFromStorage`, `switchStorageBackend`, the local branch of `saveToStorage`/`_writeNow`, `getStorageUsageInfo`, `STORAGE_ESTIMATED_QUOTA_BYTES`, `STORAGE_QUOTA_WARNING_RATIO`; `checkPostgresBackendPresent` (replaced by `probeServer`).
- `ui.js` `showStorageQuotaWarning` and its markup.
- Settings → Data & Storage backend `<select id="settingStorageBackend">` and its wiring; `app.switchStorageBackend`.
- Local first-run path `maybeShowSetupWizard(app, isFirstRun)` keyed on an empty local store (the onboarding wizard is instead triggered by an empty Postgres dataset after login — see §5).
- All `if (app._storageBackendKind === 'postgres')` guards around `pgPost`/`pgPatch`/`pgDelete`/`pgPut` in feature modules become unconditional calls.
- Docs/commands: `python -m http.server`.

`saveToStorage(app)` keeps its name (dozens of call sites) and only performs the plan-settings PATCH.

## 5. Boot flow (`app.js` `init()`)

1. **Probe.** `probeServer()` (new, `storage.js`). `/auth/setup-status` is rate-limited to 20 requests / 15 min (`server/src/routes/auth.js` `setupStatusLimiter`), so it must **not** be hit on every page load. Instead:
   - `GET /api/plan-settings` → 200: `{ reachable: true, hasSession: true }`; 401: reachable, no session.
   - Only when there is no session: `GET /auth/setup-status` → 2xx JSON with boolean `needsSetup` gives `{ reachable: true, hasSession: false, needsSetup }`; a **429** is treated as reachable with `needsSetup: false` (show sign-in, never the unreachable gate).
   - Network error, timeout, non-JSON body, or any other non-2xx (incl. nginx 502) on either request: `{ reachable: false }`.
   
   Unreachable → `showServerUnreachable(app)` (new `src/serverUnreachableGate.js`): full-page `#serverUnreachableGate` overlay (same pattern as `#loginGate`), translated text, a Retry button that re-runs the probe and resumes `init()` on success. `init()` renders no data while the gate is up.
2. **Auth.** `hasSession` → continue. Else `needsSetup` → login gate in setup mode (exists); otherwise login gate in sign-in mode (exists). `checkPostgresSession()` is folded into `probeServer()`.
3. **Load.** `loadFromPostgres(app)`. A throw → unreachable gate.
4. **Legacy browser data.** If `localStorage.debtTrackerData` exists:
   - Postgres dataset empty → existing `pgMigrationModal` (import into Postgres). Import success **or** decline → `localStorage.removeItem('debtTrackerData')`.
   - Postgres dataset non-empty → `pgMigrationModal` variant: "Older browser-only data found on this device." Buttons **Download as JSON backup** (downloads the raw JSON as `myfinances-browser-backup-YYYY-MM-DD.json`, then removes the key) and **Remove it** (removes the key). Either path removes the key; closing via Escape does not remove it (prompt reappears next load).
   - An import failure keeps the key and shows the error, so no data is lost.
5. **Stale preference.** `localStorage.removeItem('debtTrackerStorageBackend')` unconditionally.
6. **Onboarding.** First run is defined as "the `reconciliationAdjustsBalance` setting is absent after load **and** the loaded dataset is empty" (amended during execution: existing Postgres users who never opened Settings lack the setting, and must not get the wizard or have v7's What's New silently marked seen) (the wizard persists a default for it immediately — `setupWizard.js`), replacing the old "no local key" test. If first run and no legacy prompt was shown, call `maybeShowSetupWizard(app, true)`. The test harness's reset seeds this setting so the wizard doesn't block tests.
7. Remainder unchanged (What's New, auto NW snapshot, `seedMissingBalanceHistory`, modal init, `updateUI`, `switchPage('health')`). Always set `data-app-ready="true"` (also when stopped at a gate), per issue #422.

## 6. Runtime error handling

- `postgresSync.js` `pgPost`/`pgPatch`/`pgDelete`/`pgPut` and the plan-settings PATCH: on 401 → `showLoginGate(app)`; on network error or other non-2xx → `showSyncErrorBanner()` — a persistent, dismissible `#syncErrorBanner` (`role="alert"`): "Couldn't save your last change — check your connection. Reload to see what's saved." Shown once until dismissed/reloaded, not stacked. Optimistic in-memory state is not rolled back (unchanged from Phase 2b).
- Service worker keeps precaching the shell (so the unreachable gate renders offline); `/api`, `/auth`, `/calendar.ics` stay network-only.
- Settings → Data & Storage shows static text "Storage: PostgreSQL server", then Backup & Restore and the Danger zone.

All new strings get keys in `en`/`es`/`pl`; the new gate and banner are added to the i18n render guard (`TRANSLATED_PAGES` or equivalent).

## 7. Tests

**Harness (`tests/conftest.py`):**
- `stack_user` (session scope): `GET /auth/setup-status`; `needsSetup` → `POST /auth/register`, else `POST /auth/login`. Credentials from `TEST_EMAIL`/`TEST_PASSWORD` (CI defaults). Yields the session cookie(s).
- `app_page`: add cookies to the context → `goto` → `wait_for_app_ready` → wipe via `app.clearAllData` (`pgDeleteAll`) → reload/ready. The `_intercept_head_root` header strip and the empty `debtTrackerData` seed are deleted.
- `seed_state(page, state)`: `importAllJSON` (replace mode) with the given state, then `app.refreshCurrentPageData()`. A codemod converts existing `localStorage.setItem('debtTrackerData', …)` + reload patterns; tests that reload to prove persistence keep reloading (now against Postgres).
- `tests/postgres/conftest.py` folds into the shared fixtures; the manual "switch to Postgres in Settings" tests and `bypass_postgres_detection_once` are deleted.

**New / rewritten:**
- `tests/features/test_storage_backend.py` → `tests/features/test_server_only_storage.py`
  - Positive: add record → reload → persists; JSON export/import round-trip; Settings shows "Storage: PostgreSQL server".
  - Negative: no local/session option in Settings; stale `debtTrackerStorageBackend=local|session` ignored and removed; after a CRUD pass across every record type, no `localStorage`/`sessionStorage` key outside the §3 allowlist; `/auth/setup-status` aborted → unreachable gate, no data rendered, Retry recovers after the route is unblocked; `/auth/setup-status` 502 → gate; `loadFromPostgres` endpoint 500 → gate; mutation 500 → `#syncErrorBanner`; mutation 401 → login gate.
- `tests/postgres/test_legacy_local_data.py`: empty DB + legacy key → migration modal; import → data in DB, key removed; decline → key removed; import failure → key kept; non-empty DB → download/remove variant, both remove the key; Escape keeps it.
- `tests/security/test_no_browser_financial_storage.py` (static scan): `src/**/*.js` references to `localStorage`/`sessionStorage` only in an allowlisted set of modules/keys.
- `tests/unit/storage.test.js`: drop adapter tests; add `probeServer` cases (2xx JSON, non-JSON, 502, network error).
- Every new file registered in a `ci.yml` shard (`test_ci_shard_coverage.py`).
- Server suite unchanged.

## 8. CI

- New `build-images` job: `docker compose build` → `docker save myfinances:latest myfinances-server:latest | zstd` → `upload-artifact`.
- New composite action `.github/actions/start-stack`: download + `docker load`, create `secrets/`, `docker compose up -d --no-build`, wait for nginx + server health. Exports `TEST_BASE_URL`/`TEST_EMAIL`/`TEST_PASSWORD`.
- Every Playwright job (features a–k, integration, ui a–d, security, a11y, postgres, lighthouse) `needs: build-images` and uses `start-stack` instead of `python -m http.server`. Each job tears down with `docker compose down -v`.
- `build-images` added to `ci-complete`'s `needs:`. `docker-build` stays as the release-image check.

## 9. Docs

Rewrite the client-only/offline framing in: `README.md`, `CLAUDE.md` (Project Overview, Commands, Storage & data flow; Phase 2a–2e bullets collapsed into one "Storage (PostgreSQL)" section; login-gate/test notes), `DEPLOYMENT.md`, `SECURITY.md`, `AGENTS.md`, `tests/README.md`, `docs/README.md`, `server/README.md`. Mark the 2026-07-14 storage-abstraction spec superseded.

## 10. Versioning

`APP_VERSION` 7.0.0; `sw.js` `CACHE_NAME` matches; `CHANGELOG.md` `## [7.0.0] — 2026-11-03` with a **BREAKING** section and upgrade steps (export JSON from 6.x if desired → deploy the Docker stack → sign in → accept the migration prompt); `WHATS_NEW_ENTRIES` entry for 7.0.

## 11. Risks

- **CI duration:** every shard now boots the stack (~30–60 s) and seeds over HTTP. Mitigated by the shared image artifact; shard rebalance if any exceeds its timeout.
- **Single-user server:** tests share one user per stack, so tests must not run in parallel within a job (they don't today).
- **Codemod breadth:** 56 test files; behavior-preserving conversion, verified shard by shard.
