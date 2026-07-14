# GitHub Copilot Instructions — MyFinances

## Project overview

MyFinances is a **privacy-first, client-side-only** personal finance tracker (debt payoff planning, accounts, income, budgets, savings, net worth, cash flow forecasting). It is **vanilla ES6+ JavaScript with no build step, no framework, and no backend**. All data lives in browser `localStorage`. The only external dependency is Chart.js, loaded via CDN.

---

## Commands

### Serve locally
```bash
python -m http.server 5500
# or
docker compose up -d   # http://localhost:5500
```
Tests hard-code `BASE_URL = "http://localhost:5500/"` in `tests/conftest.py`. **The server must be running before any test run.**

### Tests (Playwright + pytest)
```bash
pip install playwright pytest pytest-asyncio
playwright install chromium

pytest tests/ -v                    # full suite
pytest tests/security/ -v           # XSS, CSP, input validation, static scan
pytest tests/features/ -v           # per-feature CRUD / business logic
pytest tests/ui/ -v                 # mobile, modals, dark mode, accessibility
pytest tests/integration/ -v        # end-to-end workflows / smoke tests
pytest -m "not slow" -v             # skip slow tests

# Single file or single test
pytest tests/features/test_debts.py -v
pytest tests/features/test_debts.py::test_create_debt -v
```
`pytest.ini` sets `asyncio_mode = auto`. Custom markers: `security`, `feature`, `ui`, `integration`, `slow`, `a11y`.

---

## Architecture

### Script-loading order (do not change)
`index.html` loads scripts in this exact order:
```html
<script src="src/debtCalculator.js"></script>        <!-- classic script — global DebtCalculator -->
<script src="...chart.umd.min.js"></script>          <!-- Chart.js from CDN — global Chart -->
<script type="module" src="src/app.js"></script>     <!-- ES module entry point -->
```
`debtCalculator.js` is the **only non-module file**. It exposes a global `DebtCalculator` class and must stay free of DOM/state access. Everything else in `src/` is an ES module imported (directly or transitively) from `app.js`. Because `debtCalculator.js` is a classic script it is available to ES modules via the global `DebtCalculator`, not via `import`.

### Central app object + delegation pattern
`src/app.js` exports `DebtTrackerApp`, instantiated once as `window.app` on `DOMContentLoaded`.

**`DebtTrackerApp` holds all application state:**
```
// Data arrays
this.debts, this.accounts, this.incomes, this.bonuses,
this.bills, this.expenses, this.recurringTemplates,
this.emergencyFunds, this.sinkingFunds,
this.monthlySnapshots, this.netWorthMilestonesAwarded,
this.reconciliations, this.settings,
// Object maps
this.ledgerAmountOverrides,   // keyed "type|sourceId|accountId|YYYY-MM-DD"
// Transient calculation cache
this.lastPaymentPlan, this.lastSummary, this.perMonthStimulus,
// UI state
this.editingDebtId, this.editingIncomeId, this.editingAccountId,
this.editingRecurringId, this.savingsSubTab, this.liabilitiesSubTab,
this._reportMonthOffset, this._netWorthRangeMonths,
this._forecastRangeMonths, this._forecastAccountId,
this._forecastNotableThresholdPct, this._reconciliationAccountFilter,
this._ledgerAccountFilter, this._ledgerDateRange,
this._ledgerSortKey, this._ledgerSortDir
```

Every feature module exports plain functions that receive `app` as their **first argument**. `DebtTrackerApp` methods are one-line wrappers:
```js
// In accounts.js:
export function computeAccountBalance(app, accountId, year, month) { ... }

// In app.js:
computeAccountBalance(accountId, year, month) {
    return computeAccountBalanceFeature(this, accountId, year, month);
}
```
**When adding a feature:** put logic in `featureFn(app, ...)` inside the relevant module, then add a one-line delegating method to `DebtTrackerApp`.

### Module map

| File | Responsibility |
|---|---|
| `app.js` | `DebtTrackerApp` class — state, delegation methods, startup sequence |
| `debtCalculator.js` | Pure payoff engine (global, classic script) |
| `storage.js` | `localStorage` read/write, JSON export/import, CSV export, all `sanitize*` functions |
| `utils.js` | Shared helpers: `escapeHtml`, `formatCurrency`, `normalizeText`, `sanitizeFiniteNumber`, `sanitizeInteger`, `sanitizeDateISO`, `todayISO`, `renderChartDataTable`, income payday math |
| `ui.js` | `initializeEventListeners`, `switchPage`, `switchTab`, `updateUI`, `updateFormVisibility`, theme toggling, modal focus trapping |
| `accounts.js` | Account CRUD, `computeAccountBalance`, `refreshAccountSelectors` |
| `debts.js` | Debt CRUD, inline edit, accelerate modal, break-even badge rendering |
| `income.js` | Income and bonus CRUD |
| `bills.js` | Bill and expense CRUD, budget page rendering |
| `recurring.js` | Recurring template CRUD, `getRecurringOccurrencesInMonth` |
| `savings.js` | Emergency fund and sinking fund CRUD |
| `strategy.js` | Plan page: payment plan display, amortization modal, what-if simulator, calendar view |
| `charts.js` | Chart.js rendering for strategy tabs (balance, pie, progress, distribution, DTI) |
| `reports.js` | Reports page: month navigation, calendar, income/expense charts, net-worth trend, `captureNetWorthSnapshot` |
| `forecast.js` | Cash flow forecasting: account-level and total projected balance series |
| `spending.js` | Spending-by-category aggregation and chart rendering |
| `health.js` | Health dashboard: DTI, savings rate, emergency fund, payoff timeline, cash flow, budget breakdown |
| `ledger.js` | Transaction aggregation, ledger page rendering, `makeLedgerTransactionId`, `getLedgerTransactionsForMonth`, amount-override system |
| `reconciliation.js` | Account reconciliation CRUD, expected-transactions comparison |
| `breakEven.js` | Single-debt break-even analysis (uses global `DebtCalculator`) |
| `commandPalette.js` | Ctrl+K quick-jump palette across all pages and common actions |
| `settings.js` | Generic key/value settings store (array of `{key, value}`) with `getSetting`/`setSetting` |
| `setupWizard.js` | First-run setup wizard and Settings modal |

### Page navigation
Top-level pages are identified by `data-page` attribute on `.page-button` nav elements:
`health`, `accounts`, `income`, `liabilities` (Debts + Budget sub-tabs), `recurring`, `savings`, `strategy` (Plan), `reports`, `ledger`, `reconcile`.

`switchPage(app, pageName)` in `src/ui.js` shows/hides page `<section>` elements and calls the relevant `render*` method(s). **When adding a new page, register it in both `switchPage()` and the `buildCommands()` list in `commandPalette.js`.**

The Liabilities page uses a sub-tab system (`app.liabilitiesSubTab`): `'debts'` and `'budget'`. The Savings page uses `app.savingsSubTab`: `'emergency'` and `'sinking'`.

### `DebtCalculator` — the calculation engine
Located in `src/debtCalculator.js` (classic script, exposed as global `DebtCalculator`).

- **Interest model:** daily compounding — `balance × ((1 + APR/365)^daysInMonth − 1)` per month.
- **Four strategies:** `'avalanche'` (highest APR first), `'snowball'` (lowest balance first), `'priority-lowest'`, `'priority-highest'`.
- **Payment allocation per month:** (1) minimum payments to all active debts, (2) remaining overage applied in strategy order, (3) per-month stimulus applied in strategy order.
- **`fixedAmount` debts** (e.g., rent, subscriptions) are date-range-driven and not subject to interest or payoff logic.
- **Safety limit:** 600 months. Throws if exceeded.
- `generateSummary(workingDebts, paymentPlan)` → summary stats stored in `app.lastSummary`.
- Keep this file free of DOM/state access forever.

### Storage & data persistence
- `storage.js` persists to `localStorage` under key `debtTrackerData` (current export format version `"4.0.0"`, runtime format `"3.0"`-compatible).
- `saveToStorage(app)` serializes all state arrays plus `forecastSettings`, `ledgerSettings`, and the two DOM inputs (`#monthlyPayment`, `#paymentStrategy`).
- `loadFromStorage(app)` parses, passes through `sanitizeParsedState()`, and assigns clean values back to `app.*`.
- Every record type has a corresponding private `sanitize*` function in `storage.js` that enforces types, bounds, and allowed enum values. All call the shared primitives from `utils.js`: `normalizeText`, `sanitizeFiniteNumber`, `sanitizeInteger`, `sanitizeDateISO`.
- **New persisted fields must be added to the relevant `sanitize*` function** or they will be silently dropped on import/reload.
- Post-sanitization filters (in `sanitizeParsedState`): debts must have a `name`; incomes must have a `name` and `firstPayDate`; bonuses must have a `name` and `date`; etc.
- Storage quota: warns at ~80% of an estimated 5 MB ceiling; calls `app.showStorageQuotaWarning(usageInfo)` once per session; shows an error on a hard `setItem` failure.
- Import: max 2 MB; supports legacy v1.0 (debts-only) files in addition to current format.

### Ledger transaction system
`ledger.js` is the central data bus:
- `buildProjectedAccountTransactions(app, startYear, startMonth, monthsToProject)` projects all income, bonuses, debts, bills, expenses, recurring templates, and savings contributions forward into per-account transaction lists.
- `getLedgerTransactionsForMonth(app, year, month, accountId?)` returns sorted, balance-running transactions for a given account and month. Used by `computeAccountBalance`, `forecast.js`, `reconciliation.js`, and `reports.js`.
- **Transaction ID format:** `"type|sourceId|accountId|YYYY-MM-DD"` — generated by `makeLedgerTransactionId(tx)`. Used as the key in `app.ledgerAmountOverrides`.
- **Amount overrides:** `app.ledgerAmountOverrides` is an object keyed by transaction ID. An override replaces the transaction's original amount in all balance and ledger calculations. Stored and sanitized by `sanitizeLedgerOverrides`.
- **`transfer` recurring templates** generate two transactions: a debit on `accountId` and a credit on `targetAccountId`.
- **`reimbursement` templates** generate a positive (income-direction) transaction.
- Unlinked transactions (no `accountId`) are assigned to an internal sentinel key `'__unlinked__'` and excluded from per-account views.

---

## Key conventions

### Security — CSP-enforced rules
The `Content-Security-Policy` meta tag in `index.html` sets:
- `script-src 'self' https://cdn.jsdelivr.net` — **no inline `<script>` tags, no `eval()`, no `new Function()`**.
- `style-src 'self'` — **no inline `style="..."` attributes on any element**.

All dynamic styling must go through CSS classes/variables defined in `styles.css` or `styles-csp-classes.css`, toggled via `classList`. Tests in `tests/security/test_csp.py` and `tests/security/test_static_scan.py` enforce these rules.

**When generating HTML strings for `innerHTML`:**
- All user-supplied values must pass through `escapeHtml(value)` from `utils.js`.
- Prefer `element.textContent = value` over `innerHTML` when no markup is needed.
- `normalizeText` (strips `<>"`` ` + control chars + trims + enforces max length) is used in sanitizers, not as an HTML-output escape — use `escapeHtml` for rendering.

### Sanitizing new data fields
The full sanitizer pipeline lives in `storage.js`. When adding a field to any record type:
1. Add it to the relevant `sanitize*` function with an appropriate `sanitize*` call.
2. Add it to `sanitizeParsedState`'s reconstruction of the record array.
3. Add it to `saveToStorage`'s serialized payload.

Enum fields must be validated against an explicit allowlist (see `sanitizeRecurringTemplate` for frequency/type validation pattern).

### Record IDs
All record IDs are integers generated via `Date.now() + arrayIndex` at creation time. Never use sequential `0, 1, 2` — time-based IDs prevent collision during import merges.

### Modal show/hide pattern
Modals are shown/hidden by toggling **two classes** — never just one:
```js
modal.classList.add('flex-visible');
modal.classList.remove('hidden');     // open

modal.classList.add('hidden');
modal.classList.remove('flex-visible'); // close
```
All modals must trap focus (Tab/Shift+Tab cycle within the modal) and restore focus to the previously-focused element on close. See `ui.js`'s amortization modal for the reference implementation. Escape key should always close a modal.

### Chart lifecycle
- Before rendering a chart, **destroy the previous instance** if it exists on `app`:
  ```js
  if (app._myChart) { app._myChart.destroy(); app._myChart = null; }
  ```
- After construction, call `renderChartDataTable(canvasId, { caption, columns, rows })` (from `utils.js`) to insert a `.sr-only` `<table>` equivalent for screen readers. The table is keyed `${canvasId}-sr-table` and auto-replaced on each render.
- Do **not** add per-chart reduced-motion logic. `app.js` disables `Chart.defaults.animation` globally at startup when `prefers-reduced-motion: reduce` is detected.

### CSS animation / transitions
`styles.css` contains a global `@media (prefers-reduced-motion: reduce)` rule that sets `transition-duration` and `animation-duration` to `0.01ms`. **New animated CSS must rely on this rule** — do not add a separate `prefers-reduced-motion` override per component.

### `settings.js` — app-wide configuration
Generic key/value store (`app.settings` is an array of `{ key, value }`). Use `getSetting(app, key, defaultValue)` and `setSetting(app, key, value)` from `settings.js`. Currently used only for `RECONCILIATION_ADJUSTS_BALANCE`. New boolean/numeric/string config goes here rather than as bare `app.*` properties.

### Forecast — asset accounts only
`forecast.js` only projects **asset-type accounts** (not `'Credit Card'` or `'Loan'` types). Check `getForecastAssetAccounts(app)` when building account selectors for the forecast page.

### `computeAccountBalance` vs ledger
`computeAccountBalance(app, accountId, year, month)` in `accounts.js` adds the account's `startingBalance` plus all ledger transactions for that month via `getLedgerTransactionsForMonth`. It does **not** roll forward across months — it's a point-in-time month view. The forecast engine uses `getAccountForecastSeries` (from `ledger.js`) for multi-month projections.

### `computeMonthlyIncomeForMonth` return shape
Returns `{ monthlyTotal, paydaysByIncome }`. The `monthlyTotal` field is the aggregate across all income sources and bonuses for the given month. Always destructure — don't assume it returns a plain number.

---

## Test conventions

### Fixtures
- **`app_page`** (sync) / **`async_app_page`** (async): navigates to the app and seeds `localStorage` to bypass the first-run setup wizard. Use for nearly all tests.
- **`page`** / **`async_page`**: raw page with no seeding. Use only when testing the setup wizard or first-run behavior — clear storage yourself before use.
- Standard data fixtures: `account_data`, `debt_data`, `income_data`, `expense_data`, `recurring_data`, `health_data`.
- Helper functions in `conftest.py`: `create_account(page, data)`, `create_debt(page, data)`, `create_income(page, data)`, `assert_no_errors(page)`.

### Test markers
`@pytest.mark.security` / `@pytest.mark.feature` / `@pytest.mark.ui` / `@pytest.mark.integration` / `@pytest.mark.slow` / `@pytest.mark.a11y`

### Async vs sync
Most feature tests use sync fixtures (`app_page`). Security tests use async fixtures (`async_app_page`). `pytest.ini` sets `asyncio_mode = auto` — async tests need no special decorator.

### Accessing app state in tests
Inject data by calling `page.evaluate(js)` with JavaScript that mutates `window.app.*` or `localStorage` directly, then trigger a re-render with `app.updateUI()` or `app.switchPage(...)`.

### Console errors
The `page` and `async_page` fixtures collect console errors (excluding favicon 404s) into `page.console_errors`. Call `assert_no_errors(page)` at the end of tests where clean console output matters.

---

## Data model reference

### Debt
```
{ id, name, category, debtType ('creditCard'|'fixedAmount'),
  accountBalance, originalBalance, interestRate, minimumPayment,
  originalMinimumPayment, dueDate (1–31), debtStartDate (ISO),
  fixedAmount, fixedStartDate (ISO), fixedEndDate (ISO),
  accountId, priority (1–100) }
```

### Income
```
{ id, name, amount, firstPayDate (ISO), frequency ('monthly'|'biweekly'), accountId }
```

### Bonus
```
{ id, name, amount, date (ISO), category, accountId }
```

### Bill
```
{ id, name, amount, dueDay (1–31), category, accountId }
```

### Expense
```
{ id, name, budgetAmount, date (Date object after load, ISO in storage), category, accountId }
```

### RecurringTemplate
```
{ id, name, type ('subscription'|'reimbursement'|'transfer'),
  amount, frequency ('weekly'|'biweekly'|'monthly'|'quarterly'|'yearly'),
  dayOfMonth (1–31), category, accountId, targetAccountId,
  startDate (ISO), endDate (ISO), paused (bool),
  skippedMonths (string[] 'YYYY-MM'), paidMonths (string[] 'YYYY-MM') }
```

### Account
```
{ id, name, type ('Checking'|'Savings'|'Cash'|'Investment'|'Credit Card'|'Loan'|'Other'),
  startingBalance }
```

### EmergencyFund
```
{ id, accountId, targetAmount, currentAmount, monthlyContribution, autoContribute (bool), notes }
```

### SinkingFund
```
{ id, name, allocationMethod ('fixed'|'annual'|'target_date'), monthlyAllocation,
  targetAmount, currentAmount, autoContribute (bool), accountId, notes }
```

### NetWorthSnapshot
```
{ date (ISO), totalAssets, totalLiabilities, netWorth,
  debtPaymentMade, incomeReceived, source ('auto'|'manual') }
```

### Reconciliation
```
{ id, accountId, date (ISO), previousBalance, statementBalance,
  difference, note, createdAt (ISO) }
```

### LedgerAmountOverride (value shape)
```
{ amount, originalAmount, transactionName, accountId, date (ISO), updatedAt (ISO) }
```
Keyed by transaction ID string `"type|sourceId|accountId|YYYY-MM-DD"`.
