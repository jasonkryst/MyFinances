# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyFinances is a privacy-first, client-side-only personal finance tracker (debt payoff planning, accounts, income, budgets, savings, net worth, cash flow forecasting). It is **vanilla ES6+ JavaScript with no build step, no framework, and no backend** — all data lives in browser `localStorage`. The only external dependency is Chart.js, loaded via CDN.

## Commands

### Run the app locally
```bash
python -m http.server 5500
# or
docker compose up -d   # http://localhost:5500
```
Tests assume the app is being served at `http://localhost:5500/` (see `tests/conftest.py` `BASE_URL`) — start the server before running Playwright-based tests.

### Tests
```bash
pip install playwright pytest pytest-asyncio
playwright install chromium

pytest tests/ -v                  # all tests
pytest tests/security/ -v         # XSS, CSP, input validation, static scan
pytest tests/features/ -v         # per-feature CRUD/business logic tests
pytest tests/ui/ -v                # mobile, modals, dark mode, accessibility
pytest tests/integration/ -v       # end-to-end workflows / smoke tests
pytest -m "not slow" -v             # skip slow tests

# Single file / single test
pytest tests/features/test_debts.py -v
pytest tests/features/test_debts.py::test_add_debt -v
```
`pytest.ini` sets `asyncio_mode = auto`. Custom markers (`security`, `feature`, `ui`, `integration`, `slow`) are registered in `tests/conftest.py`.

### Mutation testing
```bash
npm install
npm run test:unit       # Jest unit tests — tests/unit/*.test.js
npm run test:mutation    # Stryker — mutates the tested functions in src/debtCalculator.js, src/utils.js, src/sanitizers.js and re-runs the Jest suite per mutant
```
This is a separate, dev-only toolchain from the Python/Playwright suite above — Node/Jest/Stryker are never shipped to the browser (`index.html` is unaffected). `stryker.config.mjs`'s `mutate` array uses line-range globs scoped to exactly the functions covered by `tests/unit/*.test.js` (not whole files) — the pure, DOM-free `calculatePaymentPlan`/`formatDate`/`calculateMonthsBetweenDates` in `debtCalculator.js`, most of `utils.js`'s formatting/sanitizing helpers, and the record-shape sanitizers in `sanitizers.js` that don't need `app`/DOM state. Feature modules taking `app`/DOM state are out of scope. See `docs/superpowers/specs/2026-08-02-stryker-js-mutation-testing-design.md`.

## Architecture

### No build step — two script-loading modes
`index.html` loads scripts in a specific order that matters:
```html
<script src="src/debtCalculator.js"></script>           <!-- classic script, global DebtCalculator -->
<script src="...chart.umd.min.js"></script>             <!-- Chart.js from CDN -->
<script type="module" src="src/app.js"></script>        <!-- ES module entry point -->
```
`debtCalculator.js` is the only non-module file (pure, side-effect-free calculation engine) and is exposed as a global. Everything else is an ES module imported from `src/app.js`.

### Central app object + feature-module delegation pattern
`src/app.js` defines `DebtTrackerApp`, instantiated once as `window.app` on `DOMContentLoaded`. It holds **all application state** (`this.debts`, `this.accounts`, `this.incomes`, `this.bills`, `this.expenses`, `this.recurringTemplates`, `this.emergencyFunds`, `this.sinkingFunds`, `this.monthlySnapshots`, `this.reconciliations`, `this.ledgerAmountOverrides`, etc.) plus UI state (`editingDebtId`, `liabilitiesSubTab`, `_reportMonthOffset`, `_forecastRangeMonths`, ...).

Every feature module (`debts.js`, `debtBreakEven.js`, `accounts.js`, `income.js`, `bonusAdvisor.js`, `bills.js`, `recurring.js`, `savings.js`, `reports.js`, `reportsNetWorth.js`, `reportsCalendar.js`, `reportsCashFlow.js`, `reportsMoneyFlowSankey.js`, `reportsVariance.js`, `reportsSummary.js`, `forecast.js`, `health.js`, `spending.js`, `ledger.js`, `ledgerTransactions.js`, `ledgerOverrides.js`, `reconciliation.js`, `strategy.js`, `strategyPlanCalculation.js`, `strategyCalendar.js`, `strategyComparison.js`, `strategySummaryTable.js`, `strategyScheduleTable.js`, `charts.js`, `ui.js`, `storage.js`, `sanitizers.js`, `dataExport.js`, `commandPalette.js`) exports plain functions that take the app instance as their **first argument** (e.g. `addDebt(app)`, `computeAccountBalance(app, accountId, year, month)`). `DebtTrackerApp` methods are thin wrappers that call these functions with `this`. When adding a feature, follow this same pattern — put logic in a module function `featureFn(app, ...)` and add a one-line delegating method on `DebtTrackerApp`.

### Page navigation
Top-level pages (`data-page` buttons in `index.html`): `health`, `accounts`, `income`, `liabilities` (Debts + Budget sub-tabs), `recurring`, `savings`, `strategy` (Plan), `reports`, `ledger`, `reconcile`. `switchPage(app, pageName)` in `src/ui.js` shows/hides page sections, records `app._currentPage`, and calls `renderPageData(app, pageName)` — the per-page `render*` dispatch — when adding a new page, register it there. `renderPageData` takes a `{ resetToDefaults }` option (default `true`) guarding view-state resets that should only happen when navigating into a page (Liabilities defaulting to its Debts subtab, Reports zeroing its month offset); `app.refreshCurrentPageData()` calls it with `resetToDefaults: false` to re-render the currently visible page in place after data changes underneath it (e.g. a JSON import) without disturbing the user's current view.

### Storage & data flow
- `storage.js` persists app state under key `debtTrackerData` through a storage-adapter abstraction (`src/storageAdapters.js`), and is now scoped to save/load/quota/clear — sanitization lives in `sanitizers.js` and JSON export/import (current format version `"3.0"`) plus CSV export live in `dataExport.js`.
- **Storage adapters**: `app.storageAdapter` is either a `LocalStorageAdapter` (default) or `SessionStorageAdapter`, chosen at startup from `getStorageBackendPreference()` — a dedicated `debtTrackerStorageBackend` key always read/written directly against `localStorage` (never through the adapter, since it decides which adapter to build). Users switch backends from the Settings modal, which calls `app.switchStorageBackend(kind)`; this migrates current data into the new backend and removes it from the old one. The adapter interface (`get`/`set`/`remove`) is deliberately synchronous to match `localStorage`/`sessionStorage`; a future async backend (IndexedDB, a remote API) would require promoting the interface to Promises and updating every `saveToStorage()`/`loadFromStorage()` call site — see `docs/superpowers/specs/2026-07-14-storage-abstraction-design.md`.
- Every record type has a `sanitizeX()` function in `sanitizers.js` (e.g. `sanitizeAccount`, `sanitizeDebt`, `sanitizeIncome`, `sanitizeBill`, `sanitizeExpense`, `sanitizeLedgerOverrides`) that runs on **both load and import**, using the shared sanitizers from `utils.js` (`normalizeText`, `sanitizeFiniteNumber`, `sanitizeInteger`, `sanitizeDateISO`). New persisted fields must get a sanitizer entry or they won't survive export/import round-trips.
- Import enforces a 2 MB max file size and supports legacy v1.0 (debts-only) files.
- `saveToStorage()` estimates the serialized payload size against a conservative 5MB quota on every save and calls `app.showStorageQuotaWarning()` (defined in `ui.js`) once usage crosses ~80%, or on an actual `setItem` failure.
- `utils.js` also hosts shared formatting/date/number helpers (`formatShortDate`, `formatMonthYear`, `dateToISO`, `parseFiniteOrNull`, `getReportDate`, `incomeDaysInMonth`, `dailyCompoundInterest`) — check there before adding a new local date/number formatter in a feature module.

### Versioning
`APP_VERSION` (`src/utils.js`) is a hand-maintained semver string shown in the app footer — there's no `package.json`/build step to derive it from, so it's the single source of truth for the running app's version. Every bump must land alongside a matching `## [x.y.z] — YYYY-MM-DD` entry at the top of `CHANGELOG.md`; `tests/features/test_versioning.py` enforces that the two stay in sync (and that changelog headings stay in descending order), since nothing else previously caught a version-only commit with no changelog entry (see #59).

### Calculation engine
`src/debtCalculator.js` (`DebtCalculator`, global) is a pure, side-effect-free engine for payoff schedules — daily-compounding interest, four strategies (Avalanche, Snowball, Priority-Lowest, Priority-Highest), per-month stimulus, and a binary-search back-calculator for target payoff dates. Keep it free of DOM/state access; all rendering happens in `strategy.js`.

### Cross-cutting features
- **Accounts** (`accounts.js`) are the hub: income, debts, bills, expenses, bonuses, and recurring templates can all link to an `accountId`, and `computeAccountBalance()` projects an account's end-of-month balance from all linked items.
- **Ledger** (`ledger.js`) aggregates income, debts, bills, expenses, and recurring templates into a unified transaction list, with a modal-based amount-override system (`ledgerAmountOverrides`, keyed `type|id|accountId|date`).
- **Reports/Forecast/Health** (`reports.js`, `forecast.js`, `health.js`) all derive from the same underlying account/income/debt/recurring data — when changing a data shape, check all three for consumers.
- **Command palette** (`commandPalette.js`) — Ctrl/Cmd+K or the toolbar `#commandPaletteBtn` opens a searchable jump list across all pages plus common actions; initialized once from `ui.js`'s `initializeEventListeners()`. New pages should be added to its command list alongside `switchPage()`'s page-name mapping.
- **Chart accessibility** — every Chart.js canvas should have a `renderChartDataTable(canvasId, { caption, columns, rows })` call (from `utils.js`) immediately after construction, so screen-reader users get an equivalent `.sr-only` `<table>`. New chart-rendering code should follow this pattern.
- **Responsive tables/grids** — wide data tables/grids come in two flavors, and picking the wrong one on a narrow-column layout causes silent content clipping (not an ugly-but-visible overflow) whenever the container also has `overflow: hidden` for rounded corners. (1) Genuinely wide multi-column data (Net Worth History, Cash Flow Forecast, Ledger, Strategy schedule, comparison tables): wrap in a `.table-wrapper`/`-wrap` class (`overflow-x: auto`) so it scrolls horizontally — see `ledger-table`, `comparison-table`, `nw-history-table` (non-`--compact`), `recon-table-wrap`. (2) Few-column summary rows meant to be read top-to-bottom on mobile (Debt Overview categories, Account Balances/Money Flow, Budget Variance, Summary Report tables): below the mobile breakpoint, hide the header row and restack each row into a single-column label/value card via `content: attr(data-label)` on a `::before` — see `.nw-history-table--compact`, `.var-row`/`.var-header`, `.debt-overview-cat-row`, `.acct-mf-row`. Never leave a summary grid on fixed-px `grid-template-columns` with no mobile treatment — that's what caused the clipping bug fixed in 4.19.0.
- **Reduced motion** — `app.js` disables `Chart.defaults.animation` at startup when `prefers-reduced-motion: reduce` is set; `styles.css` has a matching global media query for CSS transitions/animations. New animated CSS should rely on the existing global rule rather than adding a bespoke override.
- **Internationalization** — `src/i18n.js` provides `t(key, vars)` string lookup (falls back to English, then to the raw key, so a missing/mistyped key never crashes or renders blank), `getCurrentLocale()`/`getIntlLocale()`, and `applyStaticTranslations()` which walks `[data-i18n]` (textContent) and `[data-i18n-attr]` (comma-separated `attr:key` pairs, e.g. `"title:toolbar.settingsTitle,aria-label:toolbar.settingsAriaLabel"`) elements and sets translated text via `textContent`/`setAttribute` — never `innerHTML`, so the CSP is unaffected. Locale dictionaries live in `src/locales/{en,es,pl}.js` as flat dot-keyed string maps; `en.js` is canonical, `es.js`/`pl.js` only need pilot-scope keys. The locale preference is stored directly under `debtTrackerLocale` in `localStorage` (same pattern as `debtTrackerTheme`/`debtTrackerStorageBackend` — a device preference, not app data). Only nav, the toolbar, the Settings modal, and the Health page (`health.js`) are translated so far; other pages remain English pending follow-up issues. `formatCurrency`/`formatShortDate`/`formatMonthYear` in `utils.js` read `getIntlLocale()` instead of a hardcoded `'en-US'`, so number/date formatting conventions follow the active locale app-wide with no call-site changes. See `docs/superpowers/specs/2026-08-04-i18n-support-design.md`.
- **PWA (installability + offline)** — `manifest.json` (icons generated by `tools/generate-icons.js`) plus a root-level `sw.js` service worker (classic script, not a module, so its scope covers `/`) precache the app shell and runtime-cache the Chart.js CDN script; registration lives in `src/serviceWorker.js`, called once from `app.js`'s `DOMContentLoaded` handler. `sw.js`'s `CACHE_NAME` is manually kept in sync with `APP_VERSION` — bump both together, or stale assets never get evicted (enforced by `tests/features/test_pwa.py`). New service worker versions wait rather than auto-activating; `ui.js`'s `showUpdateAvailableBanner()` prompts the user to reload. See `docs/superpowers/specs/2026-08-06-pwa-support-design.md`.
- **Backend service (optional, Phase 1)** — `server/` is a self-hosted Node.js + PostgreSQL API added under issue #53, providing multi-device sync/durability as an *additional* opt-in deployment option. It does not change the frontend's core architecture: the browser app still runs fully offline against `localStorage`/`sessionStorage` with zero setup, and Postgres is a third storage backend a user can point the app at, not a replacement. Relational tables mirror each `sanitizers.js` record shape 1:1; every write re-runs the matching `sanitize*` function server-side (imported by relative path from `server/src/sanitizers/index.js`, which is why the Docker build context is the repo root, not `server/`) so there's one source of truth for validation, not duplicated rules. Auth is argon2id password hashing + server-side sessions (opaque token hashed before storage, httpOnly/Secure/SameSite=Strict cookie) with a CSRF double-submit token on every mutating request; `server/scripts/create-user.js` bootstraps the single user (no open self-registration endpoint). See `docs/superpowers/specs/2026-08-19-postgresql-storage-phase1-design.md` and `server/README.md`. Frontend integration (an async `PostgresAdapter`, login UI, Settings backend picker) is a separate, not-yet-built Phase 2.

## Security constraints (enforced by tests in `tests/security/`)

- **Strict CSP** in `index.html`: `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'` — no inline `<script>`, no inline `style="..."`, no `eval`/`Function()`. All dynamic styling must use CSS classes/variables (see `styles-csp-classes.css`) toggled via `classList`.
- **All user-supplied data rendered via `innerHTML` must go through `escapeHtml()`** (from `utils.js`). Prefer `textContent` where possible.
- **All persisted/imported fields must be sanitized** via the `sanitize*` functions in `sanitizers.js` / `utils.js` — never trust raw `localStorage` or imported JSON.
