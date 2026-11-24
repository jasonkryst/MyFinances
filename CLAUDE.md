# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It holds the rules. The detail lives in three references, moved there verbatim (#539); read the relevant one before changing that area:
- [`docs/architecture/testing.md`](docs/architecture/testing.md): the Playwright harness, CI shards, server tests, mutation testing.
- [`docs/architecture/storage.md`](docs/architecture/storage.md): boot, writes, row versions, live refresh, import, CRUD resources.
- [`docs/architecture/features.md`](docs/architecture/features.md): one entry per feature (search by name or issue number).

[`AGENTS.md`](AGENTS.md) holds the operational notes every agent needs (running the suite locally, branches, PRs, merging); it points back here. When a rule here changes, update the matching reference and AGENTS.md too.

## Project Overview

MyFinances is a privacy-first, self-hosted personal finance tracker (debt payoff planning, accounts, income, budgets, savings, net worth, cash flow forecasting). The frontend is **vanilla ES6+ JavaScript with no build step and no framework**; all calculations run in the browser. Since v7.0.0 the **self-hosted Node.js + PostgreSQL server (`server/`) is the only storage**: the app needs the Docker stack (nginx + server + Postgres) and keeps no financial data in browser storage. The only external frontend dependency is Chart.js, loaded via CDN.

## Commands

### Run the app locally
```bash
docker compose up -d                                                # http://localhost:32900
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d   # bind-mounts the frontend: edit, then refresh
```
A plain static file server does not work: the app needs the API. The stack needs `POSTGRES_PASSWORD` in `.env` (or the stack variables); `setup.sh`/`setup.ps1` generate it (see `DEPLOYMENT.md`). Since 8.0.0 the credentials (`POSTGRES_PASSWORD`, `SMTP_PASSWORD`) are environment variables, not Docker secret files, and compose refuses to start without `POSTGRES_PASSWORD`. Postgres applies it only when its volume is created; changing it later needs an `ALTER ROLE` first. The dev override bind-mounts the frontend read-only into nginx and has been run live; an edited asset needs a `sw.js` `CACHE_NAME` bump (or an unregistered service worker) to show.

### Tests
```bash
pip install -r tests/requirements.txt && playwright install chromium
pytest tests/ -v                                     # all (or tests/security, features, ui, integration)
pytest tests/features/test_debts.py::test_add_debt -v
pytest -m "not slow" -v

cd server && docker compose -f docker-compose.test.yml up -d   # Postgres on :5433
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npm run migrate up && npm test                                  # node:test, server/test/*.test.js

npm install && npm run test:unit                                # Jest, tests/unit/*.test.js
npm run test:mutation                                           # Stryker over the scoped functions
```

**Playwright rules** (details: `docs/architecture/testing.md`):
- Every Playwright test runs against a **real stack**, and `app_page` wipes all server data per test: **never point tests at a deployment holding real data**. Env: `TEST_BASE_URL` (default `http://localhost:32900/`), `TEST_EMAIL`/`TEST_PASSWORD`.
- Create the test user once per fresh stack: `printf '%s\n%s\n' testuser@example.com 'ci-Test-Passphrase-2026!' | docker compose run --rm -T server node scripts/create-user.js`.
- **Never run two pytest processes against one stack** (enforced by a lock; `TEST_SKIP_STACK_LOCK=1` bypasses it).
- Fixtures: `app_page` (signed in, empty server, readiness-waiting reload), `app_page_no_sw` (same, service workers blocked, for `page.route` stubs), `seed_state(page, state)`, `wait_for_api(page, path, check)` before reloading to prove persistence, `pin_clock(page, iso)` for date-dependent tests, `wait_for_app_ready(page)` for a raw `page`.
- **Wait for async saves.** `add*` functions await the POST before the record appears. Use `submit_account_form`/`submit_debt_form`; for other add forms wait for the list entry. A deliberate no-wait click carries `# submit-no-wait: <reason>`.
- **Lazy pages render asynchronously**: await `renderReconciliationPage()`/`renderReportsPage()` or wait for a selector.
- **Guards that fail CI**: no `if not el: pytest.skip(...)` (assert; `# skip-ok:` for genuine cases); no new fixed `wait_for_timeout` (`test_sleep_ratchet.py` caps the total, and lowering it is required when you remove one); no bare `text=` locators in the guarded files (scope them to the page container); no date-dependent skips (pin the clock).
- **Every new `tests/features/` or `tests/ui/` file must be added to a shard in `.github/workflows/ci.yml`**, or it never runs (`test_ci_shard_coverage.py`). Keep shards under about 360 s of pytest, balanced by measured time; don't add a shard with under about 150 s.
- `pytest.ini` sets a 120 s timeout per test; CI jobs use `--maxfail=15` and `timeout-minutes: 15`.

**Mutation testing**: scope is **by function name** in `MUTATE_SCOPE` (`tools/strykerScope.mjs`), never line numbers; an imported-but-unscoped function must be scoped or listed in `EXCLUDED`. Every mutated file needs a floor in `tools/mutationFloors.json` (`floor(score) - 3`), **derived from a CI `mutation-report`/`mutation-report-pr` artifact**, not a local run; never lower one silently.

## Architecture

### No build step: two script-loading modes
`index.html` loads `src/debtCalculator.js` (classic script, global `DebtCalculator`), then Chart.js from the CDN (`defer`), then `src/app.js` as the ES module entry point. Everything except `debtCalculator.js` is an ES module.

### Central app object + feature-module delegation
`src/app.js` defines `DebtTrackerApp`, instantiated once as `window.app`; it holds **all application state** (`app.debts`, `app.accounts`, ...) and UI state. Every feature module in `src/` exports plain functions taking the app as their **first argument** (`addDebt(app)`, `computeAccountBalance(app, accountId, year, month)`), and `DebtTrackerApp` methods are one-line wrappers. Follow this pattern for new features.

### Module import constraints
`ui.js` and `postgresSync.js` are in circular import cycles with feature modules (e.g. `postgresSync.js → ui.js → ledger.js → settings.js → postgresSync.js`; `ui.js → people.js → postgresSync.js → ui.js`). They are safe only because every involved export is a hoisted `function` declaration. **Never convert an export in `ui.js`, `postgresSync.js` or `people.js` to an arrow-function `const`** without auditing the cycle; a TDZ ReferenceError crashes startup. Never import a `const` from `spending.js` into a module on its cycle.

**Pure shared modules** (`recurringOccurrences.js`, `ledgerStateCore.js`, `projectionCore.js`, `netWorthCore.js`, `notificationsCore.js`, `sinkingFundSchedule.js`, `settingsSchema.js`, `passwordPolicy.js`, `weekendRule.js`, `amountSchedule.js`, `promoApr.js`, `importCore.js`, `planSettingsDefaults.js` and similar) are imported by the server by relative path: **never import `ui.js`, `postgresSync.js`, `settings.js`, `storage.js` or any DOM/network module from them**.

### Page navigation
Top-level pages are `data-page` buttons in `index.html`. `switchPage(app, pageName)` (`ui.js`) shows the section and calls `renderPageData(app, pageName, { resetToDefaults })`; **register a new page there**, in the command palette list and (if it has strings) in `TRANSLATED_PAGES`. `app.refreshCurrentPageData()` re-renders in place with `resetToDefaults: false`.

### Storage and data flow (details: `docs/architecture/storage.md`)
- **The server is the only store.** State loads from Postgres at boot (`loadFromPostgres`) and every mutation is written back over the REST API. Browser storage holds only device preferences on the allowlist (theme, locale, currency, last-seen version, legacy-key cleanup; since 8.2.0 the reconcile draft and Ledger hidden columns are on the server, #587); **financial data never goes in browser storage**, and a new key must join the allowlist (`test_no_browser_financial_storage.py`).
- **Sanitize everything.** Every record type has a `sanitizeX()` in `sanitizers.js`, run on import and on every server write. **A new persisted field needs a sanitizer entry, a migration and a `columns` entry in its `server/src/routes/*.js` route**, or the server silently drops it (`fieldParity.test.js`). **A validity rule goes in an exported `isValidX()`** beside the sanitizer, used by both `sanitizeParsedState` and the route via `validatedSanitizer` (`server/src/validity.js`). New array collections in `sanitizeParsedState` use `_sanitizeRecordArray`/`_sanitizeValueArray` so import warnings work.
- **Boot**: `probeServer()` does `GET /api/plan-settings`; only without a session does it call `/auth/setup-status`, which is rate-limited, so **never call setup-status on every load**. Unreachable → `#serverUnreachableGate`; no session → `#loginGate`. `<html data-app-ready="true">` is set even behind a gate. Boot renders only the landing page (`deferHiddenPages`); **never call `toLocaleDateString`/`new Intl.*` per item in a render loop** (use the cached `utils.js` formatters).
- **Writes**: feature modules call `pgPost`/`pgPatch`/`pgDelete`/`pgPut` after the in-memory mutation. Creates use `pgCreate`; **never push a new record into `app.*` before its POST succeeds**. Wrap add forms and modal confirms in `withBusy(root, fn)`. `saveToStorage(app, fields)` PATCHes only named plan-settings fields; **record mutations never call it**. A 401 goes through `requestLogin(app)` only.
- **Row versions**: `pgPatch` diffs against a shadow copy and sends `rowVersion`. **Code that replaces a collection wholesale from server rows must call `seedShadows(app)`.**
- **Live refresh** (`liveRefresh.js`): defers while a write is pending, an `editing…Id` is set, a dialog is open or a text field has focus, and a scheduled refresh re-checks that after its load. **A new `_ledger*`/`_forecast*` field set by `loadFromPostgres` must join `VIEW_STATE_FIELDS`.**
- **Import** (#529): a backup is **one request**, `POST /api/import` (`routes/import.js`), applied in one transaction by the pure `src/importCore.js` (`runImport`, with a `store`: the server's is `importStore.js`), so a rejected record rolls everything back; the browser (`postgresImport.js`) sends it, then `loadFromPostgres`. Never import records one request at a time from the client. The server re-sanitizes `data` and every record goes through its route's own `insertRecord`/`upsertEntry` (sanitizer, validity, ownership, audit row): **a new write path for a collection goes in those shared functions, not in the route handler**. Other per-record client fan-outs (`seedMissingBalanceHistory`, `pgDeleteAll`) still go through `mapWithConcurrency(items, IMPORT_CONCURRENCY, fn)`, **never a bare `Promise.all` over records**. Merge dedupes by natural key: **a new CRUD resource needs a `KEY_FNS` entry** (`mergeDedupe.js`), and **a new keyed Ledger transaction type needs `SOURCE_MAP_BY_TYPE`** (`ledgerKeyRemap.js`). Settings holding an account id are remapped (`settingsRemap.js`).
- **Adding a CRUD resource** (follow `planHistory`): table + migration with `row_version integer NOT NULL DEFAULT 1`; a route with `columns` (plus `foreignKeys`/`foreignKeyArrays`); entries in `POSTGRES_RESOURCE_ENDPOINTS` (`storage.js`), `USER_STATE_COLLECTIONS` (server jobs), `CRUD_RESOURCES` (`importCore.js`), `RESOURCE_TABLES` (`resourceDeletion.js`), `RESOURCE_PARENTS` for a foreign key to another app table, `KEY_FNS`, and the audit log's `AUDITED_TABLES`, `AUDIT_TABLE_ORDER` and a `history.table.<table>` key. Server tests check each list.
- **Read every response body** (`discardBody()` on unused ones), error branches included (#461).
- **Service worker**: precaches the shell, network-only for `/api/`, `/auth/` and `/calendar.ics`. **A new statically imported `src/*.js` module goes into `sw.js` `PRECACHE_URLS`.**

### Migrations
- `server/src/index.js` runs migrations on every startup and refuses an unapplied migration that sorts before an applied one (the server crash-loops, nginx returns 502). **A new migration's number must be higher than the newest one on `main` at merge time**; renumber the later-merging branch. Write migrations idempotently (`IF NOT EXISTS`). `check-migration-order.sh` enforces it in CI.
- For a migration that touches existing data, write a `down()` that cannot fail on real rows and add a `MIGRATION SAFETY NOTE` saying what a rollback discards. Use `pgm.sql()`, not `db.query()`. A `timestamptz` to `date` cast depends on the session time zone: name the zone explicitly (`031` didn't, which is exact only when the database zone never changed; DEPLOYMENT.md "Database time zone", #472).
- A `NOT VALID` CHECK re-checks legacy rows on any UPDATE (including FK `SET NULL`); see the transfers entry in the feature reference.

### Versioning
`APP_VERSION` (`src/utils.js`) is the single version source. **Every bump needs a matching `## [x.y.z] — YYYY-MM-DD` entry at the top of `CHANGELOG.md`** (descending order) **and the same version in `sw.js` `CACHE_NAME`**. Every **minor** bump also needs a user-facing entry at the top of `WHATS_NEW_ENTRIES` (`src/ui.js`). `test_versioning.py`, `test_pwa.py` and `test_whats_new.py` enforce this.

### Calculation engine
`src/debtCalculator.js` is pure and side-effect free (daily-compounding interest, four strategies, stimulus, target-date back-calculation). Keep DOM and state access out of it; rendering is in `strategy.js`. Its promo-APR helpers duplicate `src/promoApr.js`: keep both in step.

## Cross-cutting rules

One line per rule; the feature reference (`docs/architecture/features.md`) has the full entry under the name in brackets.

**Money, dates and projections**
- Income and recurring-template amounts are effective-dated: **never read `.amount` of an income or template directly**; use `getAmountOn(record, date)` (`amountSchedule.js`; `amountReadGuard.test.js`; `// amount-read-ok:` for other records). [Effective-dated amounts]
- **Never generate income paydays another way** than `getIncomePaydaysInMonth`/`getNextIncomePayDates` (they apply the first pay date and the end date); annualized income figures skip `isIncomeEnded`. [Income end date]
- **Never compare `bonus.date` months directly**; use `getBonusDatesInMonth`. [Recurring annual bonus]
- `computeMonthlyIncomeForMonth` returns **net** (withholding applied); the stored `amount` stays gross. [Income gross vs. net]
- Any current-rate display or estimate uses `getDebtRateOn(debt, todayISO())`, never `debt.interestRate`; plan fingerprints include the promo fields. [Promotional APR]
- **Never read a target-date sinking fund's `monthlyAllocation` for a live figure**; use `getEffectiveMonthlyAllocation(fund, todayISO)`. [Sinking fund target date]
- `computeAccountBalance` is starting balance plus one month, not cumulative; charts over time use balance history. [Emergency fund balance history]
- `applyWeekendRule` is the one weekend-shift rule and never leaves the month. [Weekend due-date shift]
- A new render that loops balances per account or month runs inside `withProjectionCache(app, fn)` and treats the map as read-only. [Projection cache]
- Every report classifier skips transfer legs (`isTransferLegTx`) and treats a `manual` outflow as an expense and inflow as income; never route recurring transfer legs through `isTransfer`. [Recurring income type, Manual one-off transactions, Account transfer tracking]
- `computeSavingsRate` is the one savings-rate definition; never interpolate a `Date` object into HTML. [Number clarity]
- Reports, Forecast and Health derive from the same data: when changing a data shape, check all three.
- Coast FIRE's target is never derived from the contribution-inclusive projection. [Coast FIRE]
- The Net Worth trend's live point is computed for display and **never persisted by rendering**; a real snapshot always beats an estimate. [Net Worth trend without snapshots]

**Ledger and recurring paid state**
- The Ledger's override and Cleared maps (keyed `type|id|accountId|date`) are the source of truth for recurring paid state. **Any code that sets Cleared on a recurring row calls `app.syncRecurringPaidFromLedger(txIds)`**; `getRecurringOccurrenceLegs` mirrors the projection builder, so change both. `paidMonths` is a derived cache. [Recurring paid ↔ Ledger sync]
- A new saved Ledger filter goes in its one field table; the Ledger search term is never persisted. Debt and Recurring list pages are session-only too. [Ledger filters live on the server, Ledger search, List pagination]
- Every person reference is remapped on import; a new record type that references a person joins `remapFk` (`importCore.js`). [Debt ownership split]
- A new undoable delete type handles its Ledger key `type` and cascaded children; account deletes are not undoable. [Undo]
- `confirmZeroAmountAllowed` is the single $0 gate. [$0 amount policy]
- The calendar feed's event selection, titles and ICS helpers are duplicated in `calendarFeed.js` and `server/src/calendarGenerator.js`: change both. [Calendar feed]

**Settings, notifications and jobs**
- **A new setting must be in `SETTINGS_EXPORT_SCHEMA` or `isAllowedSetting`** (`settingsSchema.js`), or the server 400s every write. Place its control on the right Settings page with a `change` handler (save on change, no Done button); a new Settings page needs `SETTINGS_PAGES`, a row, a section, locale keys and a `TRANSLATED_PAGES` entry. The settings-only export never includes settings that hold account ids, Ledger filters or financial arrays. [Settings, Settings-only export/import]
- **A new notification type needs** `NOTIFICATION_TYPES`, prefs, the email template, `CATEGORY_BY_TYPE`/`NOTIFY_FILTER_TYPES`, icons, locale keys and the render-guard fixtures. Import `NOTIFY_FILTER_*` from `settingsSchema.js`, not `settings.js`. [Notifications, Promotional APR]
- New background jobs go in the `JOBS` registry, must be idempotent and never start from `createApp()`. [Background jobs]
- A new kind of email is a template sent with `sendTemplatedEmail()`. [Email notifications]

**Security-sensitive code**
- `checkNewPassword()` runs wherever a password is set, **never on login**; the strength meter never goes on the sign-in form; a new rejection reason needs a `password.reason.*` key. [Password security]
- Emails go through `normalizeEmail()` and `EMAIL_MATCH_SQL`; never compare `users.email` directly. [Sign-in recovery]
- A new path that creates a session calls `recordSignIn`. A new `/api` route that reveals or mints a credential joins `TOKEN_DENIED_PATHS`. [Active sessions, Read-only API tokens]

**UI, accessibility and i18n**
- **Never use `prompt()`/`confirm()`/`alert()`**: the test harness auto-accepts native dialogs. Use the app's modals.
- **Every Chart.js canvas gets a `renderChartDataTable(...)`** right after construction. [Chart accessibility]
- Every control needs an accessible name that starts with its visible text; per-item actions name the item (`escapeHtml` the name); toggles carry `aria-pressed`; sort headers need `tabindex`, keys and `aria-sort`. [Control labelling]
- Blocking overlays call `makeBackgroundInert`; field errors use `markFieldInvalid`; never pair `role="alert"` with `aria-live="polite"`. [Overlays, focus and field errors]
- **A new `keydown` shortcut needs a `KEYBOARD_SHORTCUTS` entry.** New pages join the command palette; a new record type in its search needs a `RECORD_TARGETS` entry. [Keyboard shortcuts panel, Command palette]
- Error text uses `var(--danger-text)`, never `var(--danger-color)`; don't dim text with `opacity`; measure new text colours with `tests/ui/contrast_utils.py`. [Text contrast]
- Wide data tables scroll in a `.table-wrapper`; few-column summary grids restack below the mobile breakpoint. Never leave a grid on fixed-px columns with no mobile treatment; tracks holding nowrap content use `minmax(0,1fr)` and `min-width:0`; a new card class joins `CARD_SELECTORS`. [Responsive tables, Phone clipping guard]
- `styles.css` uses **no CSS nesting**, and its end-of-file merge seam is guarded (`test_css_integrity.py`). [CSS merge-seam guard]
- **Every user-visible string goes through `t()`/`data-i18n` with a key in `en.js`, `es.js` and `pl.js`** (real translations); a new page or modal needs a `TRANSLATED_PAGES` entry. Use `plural()`, `accountTypeLabel()`/`categoryLabel()`, the `utils.js` date formatters, one text node per sentence, and `escapeHtml(t(...))` for attributes. Don't widen `NON_TRANSLATABLE`; CSV headers stay English. Don't add `es.js`/`pl.js` back to the modulepreload hints. [Internationalization]
- An expandable inside a Health card uses `<details>`; the credit factors explainer never shows a score. Off the Health page, scope text locators for a credit card's name to the page's container. [Health credit factors explainer, Health per-card credit utilization breakdown]
- Never statically import a lazy-loaded module (`retirement.js`, `reconciliation.js`, `strategyCalendar.js`, the Reports sub-tab modules) from an always-loaded module; route through `lazyModules.js`. [Lazy-loaded (dynamically imported) feature modules]
- The CSP meta tag in `index.html` and the `nginx.conf` header stay in sync. [Optional self-hosted Google Analytics]

## Security constraints (enforced by tests in `tests/security/`)

- **Strict CSP** in `index.html`: `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'`: no inline `<script>`, no inline `style="..."`, no `eval`/`Function()`. All dynamic styling uses CSS classes or variables (see `styles-csp-classes.css`) toggled via `classList`.
- **All user-supplied data rendered via `innerHTML` goes through `escapeHtml()`** (`utils.js`). Prefer `textContent`.
- **All persisted or imported fields are sanitized** via the `sanitize*` functions; never trust imported JSON or legacy browser data.
- **Never interpolate raw DOM input text into `innerHTML`**, even from `<input type="date">`: format the parsed value and `escapeHtml()` it (CodeQL `js/xss-through-dom`).

## Branch protection and merging (issue #380)

- **Rulesets on `main`.** No force-push or deletion. Every change goes through a PR; the admin bypass is pull-request only. Required checks: `ci-complete`, `Analyze JavaScript`, `trivy`, `dependency-review`, plus the code-scanning gate (high or above). Branches must be **up to date** before merging, so every merge reruns CI on the other open PRs. Details are in `SECURITY.md`.
- **Never use the override to merge a red PR, or one with a missing required check.** Fix it or leave it unmerged. Commits land under the owner's identity, so this binds every session.
- **`ci-complete` is the only required `ci.yml` check.** A new job must be added to its `needs:` (`test_ci_shard_coverage.py`); a job that can never run on a PR goes in that test's `NOT_GATING` set.
- **Don't merge PRs yourself** unless the owner asks; open them and mark them ready once CI is green.

## Community files

`CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `ACCESSIBILITY.md`, the issue forms in `.github/ISSUE_TEMPLATE/` and `.github/pull_request_template.md`. `CONTRIBUTING.md` and the PR checklist summarize the conventions above for people; when a convention here changes, update them too. `ACCESSIBILITY.md`'s "Known limitations" lists open `accessibility` issues; remove an entry when its issue closes. `tests/features/test_community_files.py` fails on a broken relative link or anchor, a backticked repo path that no longer exists, or blank issues being re-enabled.
