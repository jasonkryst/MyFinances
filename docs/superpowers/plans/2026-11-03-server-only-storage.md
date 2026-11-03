# Server-only Storage (v7.0.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove browser `localStorage`/`sessionStorage` persistence so the self-hosted PostgreSQL server is the app's only data store, shipped as 7.0.0.

**Architecture:** The harness and CI move onto the real Docker stack first, while today's code already runs in Postgres mode on that stack (`checkPostgresBackendPresent` auto-detects it), so every intermediate commit stays green. Then the `_storageBackendKind` guards become unconditional, the local/session code paths and adapters are deleted, and the new boot probe, unreachable gate, legacy-data cleanup and sync-error banner land. Docs and version come last.

**Tech Stack:** Vanilla ES modules (no build), Node/Express + PostgreSQL server, Docker Compose + nginx, pytest + Playwright, Jest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-server-only-storage-design.md`

## Global Constraints

- Version `7.0.0`: `APP_VERSION` (`src/utils.js`), `sw.js` `CACHE_NAME`, `CHANGELOG.md` `## [7.0.0] — 2026-11-03`, top `WHATS_NEW_ENTRIES` entry in `src/ui.js`.
- Browser-storage allowlist (spec §3): theme, locale, currency, last-seen-version, `debtTrackerLedgerFilters`, `LEDGER_COLS_LS_KEY`, collapsible keys, `debtTrackerReconInProgress`; migration-only read/remove of `debtTrackerData`, remove of `debtTrackerStorageBackend`. Nothing else.
- Never probe `/auth/setup-status` on a load that already has a session (20 req / 15 min limiter).
- Every new user-visible string: keys in `src/locales/{en,es,pl}.js` with real translations; new gate/banner covered by the i18n render guard.
- CSP: no inline styles/scripts; show/hide via `classList` (`hidden` / `flex-visible`), like `#loginGate`.
- Exports in `ui.js` / `postgresSync.js` stay hoisted `function` declarations (import-cycle rule in CLAUDE.md).
- Every new `tests/features|ui/*.py` file listed in exactly one `ci.yml` shard; every new CI job added to `ci-complete` `needs:`.
- CI test credentials: `TEST_EMAIL=testuser@example.com`, `TEST_PASSWORD=ci-Test-Passphrase-2026!` (≥15 chars, not on the common-password list, per #456 policy).
- Commits end with the session's Co-Authored-By / Claude-Session trailer lines.

## Review Focus

1. **Session lost mid-suite.** A test that logs out, resets or changes the password (`tests/postgres/test_password_reset.py`, `tests/ui/test_password_security.py`) invalidates the shared session. `app_page` must re-login when `/api/plan-settings` returns 401, and password-changing tests must restore `TEST_PASSWORD`. Test: Task 1's `test_harness_relogs_after_logout`.
2. **Rate limiters in CI.** `loginLimiter` allows 5 per 15 min and `setupStatusLimiter` 20 per 15 min. The harness must log in once per session plus re-login only on a 401, and the boot path must not hit setup-status when it already has a session. Test: Task 5's `test_reload_does_not_hit_setup_status`.
3. **Wipe/seed races.** The old `clearAllData` fires `pgDeleteAll` without awaiting it, so a following seed can interleave with the delete. The harness must `await` the deletes and reload before seeding. Test: Task 1's `test_seed_replaces_previous_state`.
4. **Server down mid-session.** Today's console-only errors leave the user believing an edit was saved. Test: Task 7's `test_mutation_500_shows_sync_banner` and its `test_mutation_network_error_shows_sync_banner`.
5. **Legacy import fails halfway.** `replaceForPostgres` rolls back, so the local copy must survive for a retry. Test: Task 6's `test_legacy_import_failure_keeps_key`.

---

### Task 1: Real-stack test harness

**Files:**
- Modify: `tests/conftest.py` (replace `SKIP_FIRST_RUN_WIZARD_SCRIPT`, `_intercept_head_root`, `app_page`, `async_app_page`)
- Modify: `tests/postgres/conftest.py` (read the shared credentials; delete `bypass_postgres_detection_once`)
- Create: `tests/features/test_harness.py`
- Modify: `.github/workflows/ci.yml` (register `test_harness.py` in a features shard)

**Interfaces:**
- Produces (Python, `tests/conftest.py`):
  - `TEST_EMAIL`, `TEST_PASSWORD`: module constants read from env with the CI defaults above.
  - `stack_user` (session fixture) → `dict` of cookies. On a 2xx `GET /auth/setup-status` with `needsSetup: true`, it calls `POST /auth/register`; otherwise it calls `POST /auth/login`. Uses `urllib`/`requests` outside the browser.
  - `ensure_session(context) -> None`: adds cookies to the context; re-logs in and refreshes `stack_user`'s cache if `GET /api/plan-settings` returns 401.
  - `reset_server_state(page) -> None`: in the page, `await (await import('/src/postgresSync.js')).pgDeleteAll(window.app)`, then `PUT /api/settings/reconciliationAdjustsBalance` `{value:false}` (so the setup wizard won't block), then `page.reload()`.
  - `seed_state(page, state: dict, *, reload=True) -> None`: in the page, `sanitizeParsedState(state)` → `replaceForPostgres(app, clean, {paymentStrategy: state.get('strategy'), monthlyPayment: state.get('monthlyPayment')})`. It always seeds the `reconciliationAdjustsBalance` setting unless `state['settings']` already has it, then reloads with the wrapped reload.
  - `app_page` → `Page`: `ensure_session` → `goto` → `wait_for_app_ready` → `reset_server_state` → wrapped `reload`.
  - `async_app_page`: same contract, async.

- [ ] **Step 1: Write the failing tests** in `tests/features/test_harness.py`:
  - `test_app_page_starts_empty_and_signed_in`: after load, `app.debts`/`app.accounts` lengths are 0, `#loginGate` is hidden, `#setupWizardModal` is hidden.
  - `test_seed_state_persists_across_reload`: seed one account `{"name":"Harness Checking","type":"Checking","balance":100}`, reload, then `app.accounts[0].name == "Harness Checking"` and its `id` is a server id (not the seed's id).
  - `test_seed_replaces_previous_state`: seed two accounts, then seed one; after reload `len(app.accounts) == 1`.
  - `test_harness_relogs_after_logout`: `POST /auth/logout` from the page, then call `ensure_session(page.context)` and reload; `#loginGate` is hidden.
- [ ] **Step 2: Run them; they fail.** `docker compose up -d --build`, then `pytest tests/features/test_harness.py -v`. Expected: FAIL (`seed_state`/`ensure_session` not defined).
- [ ] **Step 3: Implement the fixtures and helpers above.** Delete `SKIP_FIRST_RUN_WIZARD_SCRIPT` and the HEAD-stripping route. Keep the `page.reload` wrapper. Point `tests/postgres/conftest.py`'s `TEST_EMAIL`/`TEST_PASSWORD` at the shared constants.
- [ ] **Step 4: Run** `pytest tests/features/test_harness.py tests/postgres -v`. Expected: PASS. Postgres tests that relied on `bypass_postgres_detection_once` (manual Settings switch) may fail. Delete those tests now: that flow is removed in Task 5. List the deleted tests in the commit body.
- [ ] **Step 5: Commit** `test(harness): run Playwright against the real Postgres stack (#v7)`.

### Task 2: Shared stack in CI and the dev compose override

**Files:**
- Create: `.github/actions/start-stack/action.yml`
- Create: `docker-compose.dev.yml`
- Modify: `.github/workflows/ci.yml` (new `build-images` job; every Playwright job; `test-postgres`; `test-a11y`; `lighthouse`; `ci-complete.needs`)
- Modify: `tests/features/test_ci_shard_coverage.py` only if it hard-codes job names it shouldn't

**Interfaces:**
- `build-images` job: `docker compose build`, then `docker save myfinances:latest myfinances-server:latest | zstd -T0 > images.tar.zst`, then `actions/upload-artifact` with name `stack-images` and `retention-days: 1`.
- `start-stack` composite action, no inputs:
  - Steps: download `stack-images` → `zstd -d | docker load` → `mkdir -p secrets`, write `secrets/postgres_password.txt` and an empty `secrets/smtp_password.txt` → `docker compose up -d --no-build` → wait for `curl -sf localhost:32900/` and `docker inspect` health `healthy` on `myfinances-server` (same loops as today's `test-postgres`).
  - Writes `TEST_BASE_URL=http://localhost:32900/`, `TEST_EMAIL` and `TEST_PASSWORD` to `$GITHUB_ENV`.
- `docker-compose.dev.yml`: a `myfinances` service override that bind-mounts `./index.html`, `./guide.html`, `./src`, `./styles*.css`, `./guide.css`, `./sw.js`, `./manifest.json` and `./icons` read-only into nginx's html root (confirm the root path in `Dockerfile`).

- [ ] **Step 1:** Write the action and the `build-images` job. In every job that has a "Start static server" step (features a–k, integration, ui a–d, security, a11y), replace that step with `- uses: ./.github/actions/start-stack` (after checkout), add `needs: build-images`, and add an `if: always()` `docker compose down -v` step. In `test-postgres`, swap its build/migrate/create-user steps for the action and keep its `COMPOSE_FILE` (mailpit). In `lighthouse`, use the action instead of `up --build myfinances`.
- [ ] **Step 2:** Add `build-images` to `ci-complete.needs`.
- [ ] **Step 3: Verify locally:**
  - `python -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))"` exits 0.
  - `pytest tests/features/test_ci_shard_coverage.py -v` passes.
  - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`; edit a comment in `src/utils.js`; `curl -s localhost:32900/src/utils.js` shows the edit without a rebuild. Revert the edit.
- [ ] **Step 4: Commit** `ci: build stack images once and run every Playwright shard against Postgres`.
- [ ] **Step 5:** Push the branch and open a **draft** PR. CI only runs on PRs (see memory). Confirm `build-images` succeeds and at least one features shard starts the stack. Shard failures from unconverted tests are expected until Task 3.

### Task 3: Convert localStorage-seeding tests to `seed_state`

Three commits, one per directory group, so a reviewer can reject one batch independently: (a) `tests/features/`, (b) `tests/ui/` + `tests/a11y/`, (c) `tests/integration/` + `tests/security/` + `tests/postgres/`.

**Files:** every test file matching `rg -l "localStorage|sessionStorage|debtTrackerData" tests --glob '*.py'`.

**Interfaces:** Consumes `seed_state`, `reset_server_state`, `ensure_session` from Task 1.

**Conversion rules:**
- `localStorage.setItem('debtTrackerData', JSON.stringify(X)); location.reload()` (and similar `evaluate` + `page.reload()`) → `seed_state(page, X)`.
- A test that reads `localStorage.getItem('debtTrackerData')` to assert persistence → reload, then assert on `window.app.<collection>` (now server-backed).
- A test that clears storage to get "first run" → `reset_server_state(page)` plus deleting the `reconciliationAdjustsBalance` setting (`DELETE /api/settings/reconciliationAdjustsBalance`), then reload.
- Leave allowlisted device-preference keys (theme, locale, ledger filters, …) as they are.
- Leave tests of local/session backends, quota warnings or the backend selector alone. Tasks 5 and 8 delete them.

- [ ] **Step 1 (per group):** Convert the files.
- [ ] **Step 2 (per group):** Run that group against the local stack, e.g. `pytest tests/features -v -m "not slow"`, then the slow ones. Expected: same pass set as on `main` before the change, apart from the tests reserved for Tasks 5/8, which are listed in the commit body.
- [ ] **Step 3 (per group):** Commit `test: seed <group> through the Postgres API`, push, and confirm those CI shards are green.

### Task 4: Make Postgres sync unconditional in feature modules

**Files:** remove every `app._storageBackendKind === 'postgres'` guard (keep the guarded body) in `src/accounts.js`, `balanceHistory.js`, `bills.js`, `calendarFeed.js`, `dataExport.js`, `debts.js`, `income.js`, `ledgerCleared.js`, `ledgerOverrides.js`, `people.js`, `reconciliation.js`, `recurring.js`, `recurringPaid.js`, `reportsNetWorth.js`, `retirement.js`, `savings.js`, `settings.js`, `strategyPlanCalculation.js`. In `dataExport.js` and `calendarFeed.js`, delete the non-Postgres `else` branch rather than keeping both.
**Test:** `tests/unit/*.test.js` (Jest). Any test that now reaches `fetch` gets a `global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 204, json: async () => null }))` in its setup.

- [ ] **Step 1:** Run `rg -n "_storageBackendKind" src --glob '!storage.js' --glob '!app.js'` and edit each hit. After that, the only remaining hits are in `storage.js`/`app.js`.
- [ ] **Step 2:** `node --check` each edited file; `npm run test:unit` → all pass (fix unit tests that now hit `fetch` as above).
- [ ] **Step 3:** `pytest tests/features/test_debts.py tests/features/test_accounts.py tests/postgres/test_postgres_mutations.py -v` → PASS.
- [ ] **Step 4: Commit** `refactor: Postgres sync is unconditional in feature modules`.

### Task 5: Server-only boot: probe, unreachable gate, delete local backends

**Files:**
- Create: `src/serverUnreachableGate.js`
- Delete: `src/storageAdapters.js`, `tests/features/test_storage_backend.py`, `tests/postgres/test_postgres_forced_detection.py`
- Modify: `src/storage.js`, `src/app.js`, `src/setupWizard.js`, `src/securitySettings.js`, `src/ui.js` (delete `showStorageQuotaWarning`), `src/i18n.js` (comment), `index.html` (gate markup; remove `#settingStorageBackend`, `#pgSwitchConfirmModal` and quota-warning markup; add the static "Storage: PostgreSQL server" line), `styles.css`, `src/locales/{en,es,pl}.js`, `sw.js` (`PRECACHE_URLS`: add the new module, drop the deleted one)
- Create: `tests/features/test_server_only_storage.py`
- Modify: `tests/unit/storage.test.js`, `tests/features/test_i18n_coverage.py` (`TRANSLATED_PAGES` entry for the gate), `.github/workflows/ci.yml` (shard registration)

**Interfaces:**
- `storage.js`:
  - `export async function probeServer(): Promise<{reachable: boolean, hasSession?: boolean, needsSetup?: boolean}>`, implemented per spec §5 step 1 (429 on setup-status → `{reachable:true, hasSession:false, needsSetup:false}`).
  - `export async function saveToStorage(app): Promise<boolean>`: the former Postgres branch only.
  - `export async function clearAllData(app, options)`: resets in-memory state, `await pgDeleteAll(app)`, removes `debtTrackerTheme`/`debtTrackerReconInProgress`, no backend-preference writes.
  - Deleted: `loadFromStorage`, `switchStorageBackend`, `_writeNow`, the debounce (`flushStorageSave`/`cancelStorageSave` and the `beforeunload` hook in `app.js`), `getStorageUsageInfo`, `STORAGE_*` quota constants, `checkPostgresBackendPresent`, `checkPostgresSession`.
- `serverUnreachableGate.js`: `export function showServerUnreachable(app): Promise<void>` resolves once a Retry's `probeServer()` returns `reachable: true`. Markup `#serverUnreachableGate` with `role="alertdialog"`, `aria-labelledby`, `#serverUnreachableRetryBtn` and a polite `#serverUnreachableStatus`. Strings: `serverGate.title`, `serverGate.body`, `serverGate.retry`, `serverGate.retrying`, `serverGate.stillUnreachable`.
- `app.js` `init()` follows spec §5 steps 1–3, 5, 6. A failure in `loadFromPostgres` → `await showServerUnreachable(this)`, then the load is retried. Step 4 (legacy data) is Task 6. Leave a single `await this._handleLegacyBrowserData()` stub that does nothing yet. The `data-app-ready` marker is set while a gate is up too.
- The `app.js` constructor drops `storageKey`, `_storageBackendKind`, `storageAdapter` and `_isFirstRun`. `switchStorageBackend` and `showStorageQuotaWarning` wrappers are deleted.
- Settings → Data & Storage: `<p id="settingStorageInfo" data-i18n="settings.storageServer">` with the text "Storage: PostgreSQL server". The `securitySettings.js` check `getStorageBackendPreference() === 'postgres'` becomes "always show the form".

- [ ] **Step 1: Write the failing tests.**
  - Jest, `tests/unit/storage.test.js` (delete the debounce/adapter suites):
    - `probeServer` → plan-settings 200 ⇒ `{reachable:true, hasSession:true}` and `fetch` called once.
    - 401 + setup-status `{needsSetup:true}` ⇒ `needsSetup:true`.
    - 401 + setup-status 429 ⇒ `{reachable:true, hasSession:false, needsSetup:false}`.
    - plan-settings 502 ⇒ `{reachable:false}`.
    - Network reject ⇒ `{reachable:false}`.
    - 200 with a non-JSON body ⇒ `{reachable:false}`.
  - Playwright, `tests/features/test_server_only_storage.py`:
    - `test_added_account_persists_across_reload` (UI add through `#accountForm`, reload, the card is shown).
    - `test_json_export_import_round_trip` (seed, export through `app.exportAllJSON` download, `reset_server_state`, import the file through the Backup & Restore modal in replace mode, records are back).
    - `test_settings_shows_server_storage_only`: `#settingStorageInfo` is visible, and `#settingStorageBackend` count is 0.
    - `test_stale_backend_preference_ignored_and_removed`, parametrized `local`/`session`: set the key with `add_init_script`, load; the data comes from the server and the key is `null` after ready.
    - `test_reload_does_not_hit_setup_status`: record requests; after a signed-in reload there are no `/auth/setup-status` requests.
    - `test_unreachable_when_probe_aborted`: `page.route('**/api/plan-settings', abort)` before `goto`; `#serverUnreachableGate` visible, `#debtsList` has no cards, `html[data-app-ready=true]`. Then `unroute`, click Retry, the gate is hidden and the seeded account is rendered.
    - `test_unreachable_on_502`: fulfill plan-settings with 502 → the gate.
    - `test_unreachable_when_load_fails`: allow plan-settings, fulfill `/api/debts` with 500 → the gate.
    - `test_no_session_shows_login_gate`: clear cookies → `#loginGate` visible, the unreachable gate hidden.
    - Expected-console-error tests read `page.console_errors` deliberately; don't assert it's empty there.
- [ ] **Step 2: Run** `npm run test:unit -- storage` and `pytest tests/features/test_server_only_storage.py -v`. Expected: FAIL (`probeServer` is undefined, the gate is missing).
- [ ] **Step 3: Implement** the interfaces above. Run `node --check` on every edited module. Add the i18n keys and the `TRANSLATED_PAGES` entry, add the gate CSS (reuse the `.login-gate` overlay classes where possible), and update `sw.js` precache.
- [ ] **Step 4: Run** the step-2 tests plus `pytest tests/features/test_i18n_coverage.py tests/features/test_pwa.py tests/features/test_settings_backup.py tests/ui/test_setup_wizard.py tests/ui/test_password_security.py tests/postgres -v` → PASS. Then run `rg -n "storageAdapter|_storageBackendKind|getStorageBackendPreference|loadFromStorage|switchStorageBackend|showStorageQuotaWarning" src tests`; the only acceptable hits are in deleted-test history or comments you are about to fix.
- [ ] **Step 5:** Register `test_server_only_storage.py` in a shard, then commit `feat!: server-only storage boot; remove local/session backends`.

### Task 6: Legacy browser data (migration prompt + removal)

**Files:**
- Modify: `src/pgMigrationModal.js`, `src/app.js` (`_handleLegacyBrowserData`), `index.html` (modal variant buttons), `src/locales/{en,es,pl}.js`
- Create: `tests/postgres/test_legacy_local_data.py`

**Interfaces:**
- `pgMigrationModal.js`:
  - `export async function showPgMigrationModal(app, localJson): Promise<'imported'|'declined'|'failed'|'dismissed'>`. It removes `debtTrackerData` on `imported` and `declined` only.
  - `export async function showLegacyDataCleanupModal(localJson): Promise<'downloaded'|'removed'|'dismissed'>`. "Download as JSON backup" (`#pgLegacyDownloadBtn`) saves a `Blob` as `myfinances-browser-backup-YYYY-MM-DD.json` through a temporary `<a download>`, then removes the key. "Remove it" (`#pgLegacyRemoveBtn`) removes the key. Escape → `dismissed`, and the key is kept.
  - The existing hardcoded English (`'Transferring…'`, the counts summary, the error text) moves to `pgMigration.*` keys.
- `app._handleLegacyBrowserData()`:
  - No key → no-op.
  - Unparseable JSON → remove the key.
  - Empty dataset (the existing `postgresIsEmpty` check, now also counting `persons`/`transfers`/`balanceHistory`) → `showPgMigrationModal`.
  - Otherwise → `showLegacyDataCleanupModal`.
  - It returns `true` if a modal was shown, which `init()` step 6 uses to skip the setup wizard.

- [ ] **Step 1: Write the failing tests** in `tests/postgres/test_legacy_local_data.py`. Set `debtTrackerData` with `add_init_script` before `goto` on a reset server.
  - `test_empty_db_shows_migration_modal`.
  - `test_legacy_import_moves_data_and_removes_key`: click Transfer; after a reload the account exists on the server, and `localStorage.getItem('debtTrackerData') is None`.
  - `test_legacy_decline_removes_key`.
  - `test_legacy_import_failure_keeps_key`: route `POST /api/accounts` → 500; the error is shown and the key is still present.
  - `test_nonempty_db_shows_cleanup_variant`: seed one account first; `#pgLegacyDownloadBtn` is visible.
  - `test_cleanup_download_saves_file_and_removes_key`: `expect_download`, the filename matches `myfinances-browser-backup-\d{4}-\d{2}-\d{2}\.json`, and its content equals the legacy JSON.
  - `test_cleanup_remove_removes_key`.
  - `test_cleanup_escape_keeps_key`.
  - `test_unparseable_legacy_key_removed_silently`: value `"{not json"`; no modal, and the key is gone.
- [ ] **Step 2: Run** `pytest tests/postgres/test_legacy_local_data.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above, add the i18n keys, and update `test_i18n_coverage.py` if it scans this modal.
- [ ] **Step 4: Run** the step-1 tests plus `tests/postgres/test_postgres_migration.py` and `tests/features/test_i18n_coverage.py` → PASS.
- [ ] **Step 5: Commit** `feat: one-time cleanup of legacy browser-only data`.

### Task 7: Persistent sync-error banner

**Files:**
- Modify: `src/ui.js` (replace `showPgErrorToast` with `showSyncErrorBanner`; keep it a hoisted `function`), `src/postgresSync.js`, `src/postgresImport.js`, `src/storage.js` (`saveToStorage` on non-2xx / reject), `index.html` (`#syncErrorBanner` with a dismiss button `#syncErrorBannerDismiss`), `styles.css`, `src/locales/{en,es,pl}.js` (`sync.errorBanner`, `sync.dismiss`)
- Create: `tests/features/test_sync_error_banner.py`; register it in a shard.

**Interfaces:** `export function showSyncErrorBanner(): void` is idempotent: it shows `#syncErrorBanner` (`role="alert"`) if hidden and does nothing if already shown. Dismiss hides it until the next failure. `saveToStorage`'s plan-settings PATCH now checks `res.ok` and calls `showLoginGate` on a 401 or `showSyncErrorBanner` otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `test_mutation_500_shows_sync_banner`: route `POST /api/debts` → 500, add a debt through the form; `#syncErrorBanner` is visible with the en text.
  - `test_mutation_network_error_shows_sync_banner`: `abort`.
  - `test_plan_settings_patch_failure_shows_banner`: route `PATCH /api/plan-settings` → 500, change the strategy select.
  - `test_banner_not_stacked`: two failures → `#syncErrorBanner` count == 1.
  - `test_banner_dismiss`.
  - `test_mutation_401_shows_login_gate_not_banner`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `rg -n showPgErrorToast src tests` returns nothing afterwards.
- [ ] **Step 4: Run** the step-1 tests plus `tests/postgres/test_postgres_import.py` → PASS.
- [ ] **Step 5: Commit** `feat: persistent banner when a change fails to save`.

### Task 8: Guard against browser financial storage

**Files:**
- Create: `tests/security/test_no_browser_financial_storage.py`
- Modify: `tests/features/test_server_only_storage.py` (add the runtime test)

**Interfaces:**
- Static test: walk `src/**/*.js`, find every `(local|session)Storage.(getItem|setItem|removeItem)(ARG`, and resolve `ARG` against the spec §3 allowlist. Resolve a constant identifier by its `const NAME = '…'` declaration in the same file, or allowlist the constant names `THEME_PREF_KEY`, `LOCALE_PREF_KEY`, `CURRENCY_PREF_KEY`, `LAST_SEEN_VERSION_KEY`, `LEDGER_COLS_LS_KEY`, `RECON_IN_PROGRESS_KEY`.
  - Allowlisted generic `key` callers are `utils.js` collapsible helpers only, asserted by file and function name.
  - `debtTrackerData` may only be read or removed (never `setItem`), and only in `pgMigrationModal.js` and `app.js`.
  - `sessionStorage` must have zero uses.
- Runtime test `test_no_financial_keys_after_crud_pass`: through the UI, add an account, a debt, an income, a recurring template and an emergency fund. Reload. Every `localStorage` key must be in the allowlist (collapsible keys matched by their prefix in `utils.js`), and `sessionStorage.length == 0`.

- [ ] **Step 1:** Write both tests.
- [ ] **Step 2: Run** `pytest tests/security/test_no_browser_financial_storage.py tests/features/test_server_only_storage.py::test_no_financial_keys_after_crud_pass -v` → PASS (the code is already clean after Tasks 4–7). To prove the static test bites, temporarily add `localStorage.setItem('debtTrackerData','x')` to `src/debts.js`, see it FAIL, then revert.
- [ ] **Step 3:** Register the security test in the `test-security` job if that job lists files, then commit `test(security): forbid financial data in browser storage`.

### Task 9: 7.0.0 release metadata

**Files:** `src/utils.js` (`APP_VERSION = '7.0.0'`), `sw.js` (`CACHE_NAME`), `CHANGELOG.md`, `src/ui.js` (`WHATS_NEW_ENTRIES`), `src/locales/{en,es,pl}.js` if What's New entries are keyed.

- [ ] **Step 1:** Make the version bumps. CHANGELOG `## [7.0.0] — 2026-11-03` gets three sections:
  - **BREAKING:** browser-only storage removed; a running server is required.
  - **Upgrade:** optionally export JSON from 6.x → deploy the Docker stack (DEPLOYMENT.md) → sign in → accept the migration prompt.
  - **Added:** unreachable gate, sync-error banner, legacy cleanup prompt.
  - **Removed:** the storage selector, quota warning and `python -m http.server` support.

  The What's New entry is user-facing and mentions the migration prompt.
- [ ] **Step 2: Run** `pytest tests/features/test_versioning.py tests/features/test_whats_new.py tests/features/test_pwa.py -v` → PASS.
- [ ] **Step 3: Commit** `chore(release): 7.0.0`.

### Task 10: Documentation

**Files:** `README.md`, `CLAUDE.md`, `DEPLOYMENT.md`, `SECURITY.md`, `AGENTS.md`, `tests/README.md`, `docs/README.md`, `server/README.md`, `docs/superpowers/specs/2026-07-14-storage-abstraction-design.md` (a "Superseded by 2026-11-03-server-only-storage-design.md" banner at the top).

Required content changes:
- Remove every claim of "client-side only", "no backend", "all calculations happen locally / no accounts required", "works offline", and "optional backend". Run `rg -n -i "client-side|no backend|localStorage|offline|optional.*(backend|postgres)|http\.server" *.md docs/README.md tests/README.md server/README.md` and resolve each hit.
- Commands: `docker compose up -d` (+ `-f docker-compose.dev.yml` for development) replaces `python -m http.server`. Tests need the stack plus `TEST_EMAIL`/`TEST_PASSWORD`, and there is no port-32901 workaround. Describe the `seed_state`/`reset_server_state`/`ensure_session` harness.
- CLAUDE.md:
  - Rewrite Project Overview, Commands, and "Storage & data flow".
  - Collapse the Phase 2a–2e bullets into one "Storage (PostgreSQL)" section: boot probe (with the rate-limit reason), the gates, the sync banner, legacy cleanup, and the §3 allowlist plus its static guard.
  - Drop the storage-adapter, quota, and "Login gate strips the header" notes.
  - Update the `app_page` readiness note.
  - Keep sanitizers/import-warnings content (still true).
- The privacy statement becomes "self-hosted: your data lives in your own PostgreSQL server".

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2: Run** the `rg` above and confirm the only remaining hits are allowlisted device-preference mentions or historical CHANGELOG entries. Run `pytest tests/features/test_versioning.py -v` → PASS.
- [ ] **Step 3: Commit** `docs: PostgreSQL is the only storage backend (7.0.0)`.

### Task 11: Full verification and PR

- [ ] **Step 1:** Run `npm run test:unit`, server suite (Docker recipe from memory), and `pytest tests/ -v` against the local stack. Everything must pass.
- [ ] **Step 2:** Push, update the draft PR body (summary, BREAKING note, test plan), and wait for CI to go fully green, including `build-images` and `ci-complete`. If a shard exceeds its timeout, rebalance the files between shards.
- [ ] **Step 3:** Mark the PR ready. Do not merge (the owner merges).

### Task 12: Postgres field parity (added during execution; runs after Task 3, before Task 4)

Task 3a found that Postgres mode silently drops fields that local storage kept. Once Postgres is the only backend, that is data loss for every migrating user, and it would break spec §1's migration criterion.

**Files:**
- Create: `server/migrations/1755600000031_add-missing-persisted-fields.js`
  - The number must sort above the newest migration on `main` at merge time.
  - Idempotent `ADD COLUMN IF NOT EXISTS`.
  - `down()` drops only the columns it added.
- Modify: `server/src/routes/{recurringTemplates,sinkingFunds,emergencyFunds,ledgerOverrides,debts}.js` (`columns` maps), plus every other route whose sanitizer emits a field without a column, as found by the parity test below.
- Modify: `src/storage.js` `loadFromPostgres` and `src/postgresImport.js`, only if a field needs special handling (e.g. a jsonb column).
- Create: `server/test/fieldParity.test.js`

**Interfaces:**
- Known gaps:
  - `recurring_templates.archived` (boolean, default false)
  - `sinking_funds.order` / `archived` / `completed_date` (pick column names that avoid the SQL reserved word `order`, e.g. `sort_order`)
  - `emergency_funds.auto_sync_balance`
  - `ledger_overrides.memo`
  - `debts.notes` and `debts.next_payment_due`
- Types follow the sanitizer: text, boolean, date, integer.
- `paidAmounts` stays unpersisted; it is legacy, per CLAUDE.md #434.

- [ ] **Step 1: Write the failing parity test.**
  - For every CRUD resource that uses `createCrudResource`, build a fully populated record, run it through the resource's frontend `sanitize*`, and take the output keys.
  - Assert that every key is in that route's `columns` map, or in an explicit `NOT_PERSISTED = { resource: { field: 'reason' } }` allowlist.
  - Also add a round-trip test per known gap: POST a record carrying the field, GET it, and check the field equals the value sent. Use the existing `server/test/helpers` app/session helpers.
- [ ] **Step 2: Run** the server suite (Docker recipe in `local-test-env-quirks` memory). The parity test is expected to FAIL, naming each gap.
- [ ] **Step 3: Implement** the migration and the `columns` entries. Keep `NOT_PERSISTED` minimal, with a reason on every entry.
- [ ] **Step 4: Run** the server suite. Expected: PASS. Also run `server/scripts/check-migration-order.sh origin/main`. Then run the 8 previously failing Playwright tests from Task 3a's report against a rebuilt local stack (`docker compose build server`). Expected: PASS.
- [ ] **Step 5: Commit** `fix(server): persist fields Postgres mode silently dropped`.
