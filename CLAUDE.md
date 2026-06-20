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

Every feature module (`debts.js`, `accounts.js`, `income.js`, `bills.js`, `recurring.js`, `savings.js`, `reports.js`, `forecast.js`, `health.js`, `spending.js`, `ledger.js`, `reconciliation.js`, `strategy.js`, `charts.js`, `ui.js`, `storage.js`, `commandPalette.js`) exports plain functions that take the app instance as their **first argument** (e.g. `addDebt(app)`, `computeAccountBalance(app, accountId, year, month)`). `DebtTrackerApp` methods are thin wrappers that call these functions with `this`. When adding a feature, follow this same pattern — put logic in a module function `featureFn(app, ...)` and add a one-line delegating method on `DebtTrackerApp`.

### Page navigation
Top-level pages (`data-page` buttons in `index.html`): `health`, `accounts`, `income`, `liabilities` (Debts + Budget sub-tabs), `recurring`, `savings`, `strategy` (Plan), `reports`, `ledger`, `reconcile`. `switchPage(app, pageName)` in `src/ui.js` shows/hides page sections and calls the relevant `render*` method(s) for that page — when adding a new page, register it there.

### Storage & data flow
- `storage.js` handles `localStorage` persistence under key `debtTrackerData`, plus JSON export/import (current format version `"3.0"`) and CSV export.
- Every record type has a `sanitizeX()` function in `storage.js` (e.g. `sanitizeAccount`, `sanitizeDebt`, `sanitizeIncome`, `sanitizeBill`, `sanitizeExpense`, `sanitizeLedgerOverrides`) that runs on **both load and import**, using the shared sanitizers from `utils.js` (`normalizeText`, `sanitizeFiniteNumber`, `sanitizeInteger`, `sanitizeDateISO`). New persisted fields must get a sanitizer entry or they won't survive export/import round-trips.
- Import enforces a 2 MB max file size and supports legacy v1.0 (debts-only) files.
- `saveToStorage()` estimates the serialized payload size against a conservative 5MB quota on every save and calls `app.showStorageQuotaWarning()` (defined in `ui.js`) once usage crosses ~80%, or on an actual `setItem` failure.

### Calculation engine
`src/debtCalculator.js` (`DebtCalculator`, global) is a pure, side-effect-free engine for payoff schedules — daily-compounding interest, four strategies (Avalanche, Snowball, Priority-Lowest, Priority-Highest), per-month stimulus, and a binary-search back-calculator for target payoff dates. Keep it free of DOM/state access; all rendering happens in `strategy.js`.

### Cross-cutting features
- **Accounts** (`accounts.js`) are the hub: income, debts, bills, expenses, bonuses, and recurring templates can all link to an `accountId`, and `computeAccountBalance()` projects an account's end-of-month balance from all linked items.
- **Ledger** (`ledger.js`) aggregates income, debts, bills, expenses, and recurring templates into a unified transaction list, with a modal-based amount-override system (`ledgerAmountOverrides`, keyed `type|id|accountId|date`).
- **Reports/Forecast/Health** (`reports.js`, `forecast.js`, `health.js`) all derive from the same underlying account/income/debt/recurring data — when changing a data shape, check all three for consumers.
- **Command palette** (`commandPalette.js`) — Ctrl/Cmd+K or the toolbar `#commandPaletteBtn` opens a searchable jump list across all pages plus common actions; initialized once from `ui.js`'s `initializeEventListeners()`. New pages should be added to its command list alongside `switchPage()`'s page-name mapping.
- **Chart accessibility** — every Chart.js canvas should have a `renderChartDataTable(canvasId, { caption, columns, rows })` call (from `utils.js`) immediately after construction, so screen-reader users get an equivalent `.sr-only` `<table>`. New chart-rendering code should follow this pattern.
- **Reduced motion** — `app.js` disables `Chart.defaults.animation` at startup when `prefers-reduced-motion: reduce` is set; `styles.css` has a matching global media query for CSS transitions/animations. New animated CSS should rely on the existing global rule rather than adding a bespoke override.

## Security constraints (enforced by tests in `tests/security/`)

- **Strict CSP** in `index.html`: `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'` — no inline `<script>`, no inline `style="..."`, no `eval`/`Function()`. All dynamic styling must use CSS classes/variables (see `styles-csp-classes.css`) toggled via `classList`.
- **All user-supplied data rendered via `innerHTML` must go through `escapeHtml()`** (from `utils.js`). Prefer `textContent` where possible.
- **All persisted/imported fields must be sanitized** via the `sanitize*` functions in `storage.js` / `utils.js` — never trust raw `localStorage` or imported JSON.
