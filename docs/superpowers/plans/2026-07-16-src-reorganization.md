# src/ Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split six oversized `src/` modules into focused files, deduplicate ~13 pieces of copy-pasted logic into shared helpers, fix three misplaced functions, delete confirmed dead code, and update `CLAUDE.md` — with zero behavior change.

**Architecture:** Vanilla ES6 modules, no build step, no bundler. New files are added flat in `src/` (no subfolders) and resolved by the browser via relative-URL ES module imports, same as every existing file. `index.html`'s single `<script type="module" src="src/app.js">` entry point needs no changes — only `app.js`'s own `import` statements change, since it's the only file that imports from every feature module.

**Tech Stack:** Vanilla JS (ES modules), Playwright + pytest for testing (browser-driven, not per-function unit tests).

## Global Constraints

- **No behavior change.** This is a pure refactor. If a step would change what the user sees or how data is stored, stop and flag it — don't proceed silently.
- **Full spec:** `docs/superpowers/specs/2026-07-16-src-reorganization-design.md` — read it before starting if anything below is ambiguous.
- **Flat file layout.** New files go directly in `src/`, named `<feature><Concern>.js` (e.g. `strategyCalendar.js`, not `strategy/calendar.js`).
- **Tests must stay green after every task.** Run the task's cited test file(s) after each task; run the full suite (`pytest tests/ -v`) at the end of every Phase (marked below) and again as the final task.
- **Dev server required for tests:** `python -m http.server 5500` must be running in a separate terminal before any `pytest` command (tests hit `http://localhost:5500/`).
- **Current `APP_VERSION`** (in `src/utils.js`): `4.6.1`. Bump to `4.7.0` only in the final task, not before.
- **Commit after every task**, using `git add <specific files>` (never `git add -A`).

---

## Phase 1: Dedup & Cleanup In Place

No new files in this phase — only edits to existing files. Do these first so the file splits in Phase 2 don't have to touch code that's about to move twice.

### Task 1: Consolidate `escapeHtml` in ledger.js

**Files:**
- Modify: `src/ledger.js`

**Interfaces:**
- Consumes: `escapeHtml` already exported from `src/utils.js:58-65`.

- [ ] **Step 1: Remove the local duplicate**

In `src/ledger.js`, delete the local `escapeHtml` function (currently lines 15-22):

```js
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
```

- [ ] **Step 2: Add `escapeHtml` to the existing utils.js import**

Change:
```js
import { getIncomePaydaysInMonth, formatCurrency } from './utils.js';
```
to:
```js
import { getIncomePaydaysInMonth, formatCurrency, escapeHtml } from './utils.js';
```

- [ ] **Step 3: Verify no other local references broke**

Run: `grep -n "escapeHtml" src/ledger.js`
Expected: only the import line and the 8 existing call sites remain (no local `function escapeHtml` definition).

- [ ] **Step 4: Run tests**

Start the dev server if not already running: `python -m http.server 5500` (separate terminal).
Run: `pytest tests/features/test_ledger.py tests/security/test_xss.py -v`
Expected: all PASS (output is byte-identical since both functions had identical bodies).

- [ ] **Step 5: Commit**

```bash
git add src/ledger.js
git commit -m "Removes duplicate escapeHtml from ledger.js, uses utils.js export"
```

---

### Task 2: Add `dateToISO` to utils.js, remove ledger.js's `getDateKey`

**Files:**
- Modify: `src/utils.js`
- Modify: `src/ledger.js`

**Interfaces:**
- Produces: `dateToISO(date)` in `utils.js` — takes a `Date` object, returns `"YYYY-MM-DD"`.

- [ ] **Step 1: Add `dateToISO` and rewrite `todayISO` in terms of it**

In `src/utils.js`, replace:
```js
export function todayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
```
with:
```js
export function dateToISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function todayISO() {
    return dateToISO(new Date());
}
```

- [ ] **Step 2: Replace ledger.js's `getDateKey` with an import**

In `src/ledger.js`, delete:
```js
function getDateKey(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
```
Add `dateToISO` to the utils.js import (from Task 1: `import { getIncomePaydaysInMonth, formatCurrency, escapeHtml } from './utils.js';` becomes `import { getIncomePaydaysInMonth, formatCurrency, escapeHtml, dateToISO } from './utils.js';`).

Then find every call site of `getDateKey(` in `src/ledger.js` (`grep -n "getDateKey(" src/ledger.js`) and replace each with `dateToISO(new Date(...))` — i.e. wrap the same argument that was passed to `getDateKey` in `new Date(...)` first, since `dateToISO` expects a `Date` object while `getDateKey` accepted anything `new Date()`-coercible internally. Concretely: `getDateKey(x)` → `dateToISO(new Date(x))`.

- [ ] **Step 3: Confirm no remaining references**

Run: `grep -rn "getDateKey" src/`
Expected: no matches.

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_ledger.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/ledger.js
git commit -m "Adds dateToISO to utils.js, removes duplicate getDateKey from ledger.js"
```

---

### Task 3: Relocate `parseFiniteNumber` to utils.js as `parseFiniteOrNull`

**Files:**
- Modify: `src/utils.js`
- Modify: `src/ledger.js`

**Interfaces:**
- Produces: `parseFiniteOrNull(value)` in `utils.js` — returns `Number(value)` if finite, else `null`. **Not** a replacement for `sanitizeFiniteNumber` (different contract — no fallback/clamping); both stay.

- [ ] **Step 1: Add to utils.js**

Add near `sanitizeFiniteNumber` in `src/utils.js`:
```js
export function parseFiniteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 2: Remove from ledger.js, update import and call sites**

Delete from `src/ledger.js`:
```js
function parseFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
```
Add `parseFiniteOrNull` to the utils.js import. Rename all call sites in `ledger.js` from `parseFiniteNumber(` to `parseFiniteOrNull(` (`grep -n "parseFiniteNumber(" src/ledger.js` to find them all — expect `getOverrideAmount` to be the only caller).

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_ledger.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils.js src/ledger.js
git commit -m "Relocates parseFiniteNumber to utils.js as parseFiniteOrNull"
```

---

### Task 4: Add `formatShortDate` to utils.js, replace 7 duplicate copies

**Files:**
- Modify: `src/utils.js`
- Modify: `src/forecast.js`, `src/reconciliation.js`, `src/ledger.js`, `src/income.js`, `src/debts.js`

**Interfaces:**
- Produces: `formatShortDate(value)` in `utils.js` — accepts either a bare `"YYYY-MM-DD"` string, an ISO datetime string, or a `Date` object; returns `"Mon D, YYYY"`.

This fixes a real bug: the existing copies disagree on whether to pad a bare date string with `T12:00:00` before formatting. Without padding, `new Date("2026-07-15")` is parsed as UTC midnight, which can render as the *previous* day in negative-UTC-offset timezones. `reconciliation.js`, `income.js`, and `debts.js`'s copies already pad; `ledger.js`'s and `forecast.js`'s don't. The new helper always does the safe thing.

- [ ] **Step 1: Add to utils.js**

```js
export function formatShortDate(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
```

- [ ] **Step 2: Replace `forecast.js`'s `formatForecastDate`**

In `src/forecast.js`, delete:
```js
function formatForecastDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
```
Add `formatShortDate` to the existing `from './utils.js'` import. Replace every call site of `formatForecastDate(` with `formatShortDate(` (`grep -n "formatForecastDate(" src/forecast.js`).

- [ ] **Step 3: Replace `reconciliation.js`'s `_formatDate`**

In `src/reconciliation.js`, delete:
```js
function _formatDate(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
```
Add `formatShortDate` to the existing `from './utils.js'` import (line 3 currently: `import { formatCurrency, normalizeText, sanitizeFiniteNumber, sanitizeDateISO, escapeHtml, todayISO } from './utils.js';`). Replace every call site of `_formatDate(` with `formatShortDate(`.

- [ ] **Step 4: Replace `ledger.js`'s `_formatLedgerDate`**

In `src/ledger.js`, delete:
```js
// Helper for formatting ledger dates (copied from app.js)
function _formatLedgerDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
```
Add `formatShortDate` to the utils.js import (already being extended in Tasks 1-3). Replace every call site of `_formatLedgerDate(` with `formatShortDate(`.

- [ ] **Step 5: Replace `income.js`'s 3 inline copies**

In `src/income.js`, replace each inline pattern with a `formatShortDate(...)` call, preserving the exact argument each currently receives:

- Line ~70: `new Date(inc.firstPayDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })` → `formatShortDate(inc.firstPayDate)`
- Line ~78: `d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` (where `d` is already a `Date` object) → `formatShortDate(d)`
- Line ~326: `d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })` (where `d = new Date(b.date + 'T12:00:00')`, already constructed one line above) → `formatShortDate(d)`

Add `formatShortDate` to `income.js`'s utils.js import.

- [ ] **Step 6: Replace `debts.js`'s inline copy**

In `src/debts.js` (line ~583): `new Date(debt.debtStartDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })` → `formatShortDate(debt.debtStartDate)`.

Add `formatShortDate` to `debts.js`'s existing utils.js import (line 2: `import { formatCurrency, getDayOrdinal, computeInterestPaidToDate, normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, escapeHtml, renderChartDataTable } from './utils.js';`).

- [ ] **Step 7: Confirm no remaining copies**

Run: `grep -rn "formatForecastDate\|_formatLedgerDate\|function _formatDate" src/`
Expected: no matches.

- [ ] **Step 8: Run tests**

Run: `pytest tests/features/test_forecast.py tests/features/test_reconciliation.py tests/features/test_ledger.py tests/features/test_income.py tests/features/test_debts.py -v`
Expected: all PASS. Pay attention to any date-related assertion that might have depended on the old (buggy, unpadded) behavior in `ledger.js`/`forecast.js` — if a test fails because a displayed date shifted by one day, that test was asserting the bug; fix the test's expected value, don't revert the helper.

- [ ] **Step 9: Commit**

```bash
git add src/utils.js src/forecast.js src/reconciliation.js src/ledger.js src/income.js src/debts.js
git commit -m "Adds formatShortDate to utils.js, consolidates 7 duplicate date formatters"
```

---

### Task 5: Add `formatMonthYear` to utils.js, replace 2 duplicate copies

**Files:**
- Modify: `src/utils.js`, `src/debts.js`, `src/strategy.js`

- [ ] **Step 1: Add to utils.js**

```js
export function formatMonthYear(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
```

- [ ] **Step 2: Replace `debts.js`'s inline copy**

Line ~589: `iptd.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })` → `formatMonthYear(iptd.start)`. Add `formatMonthYear` to `debts.js`'s utils.js import.

- [ ] **Step 3: Replace `strategy.js`'s inline copy**

Line ~673: `new Date(summary.debtStartDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })` → `formatMonthYear(summary.debtStartDate)`. Add `formatMonthYear` to `strategy.js`'s utils.js import (check the current import line with `grep -n "from './utils.js'" src/strategy.js` first — add to whatever's already imported).

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_debts.py tests/features/test_strategy.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/debts.js src/strategy.js
git commit -m "Adds formatMonthYear to utils.js, consolidates 2 duplicate formatters"
```

---

### Task 6: Add `dailyCompoundInterest` to utils.js, replace debts.js reimplementation

**Files:**
- Modify: `src/utils.js`, `src/debts.js`

- [ ] **Step 1: Add to utils.js**

```js
export function dailyCompoundInterest(balance, aprPct, days) {
    const dailyRate = (aprPct || 0) / 100 / 365;
    return balance * (Math.pow(1 + dailyRate, days) - 1);
}
```

- [ ] **Step 2: Replace debts.js's reimplementation**

In `src/debts.js` (line ~556), replace:
```js
const dailyRate = (debt.interestRate || 0) / 100 / 365;
const monthlyInterest = debt.accountBalance * (Math.pow(1 + dailyRate, 30) - 1);
```
with:
```js
const monthlyInterest = dailyCompoundInterest(debt.accountBalance, debt.interestRate, 30);
```
Add `dailyCompoundInterest` to `debts.js`'s utils.js import.

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_debts.py tests/features/test_debt_calculator.py -v`
Expected: all PASS (output identical — same formula, same inputs).

- [ ] **Step 4: Commit**

```bash
git add src/utils.js src/debts.js
git commit -m "Adds dailyCompoundInterest to utils.js, removes debts.js reimplementation"
```

---

### Task 7: Move `getReportDate` to utils.js, delete spending.js's private copy

**Files:**
- Modify: `src/utils.js`, `src/reports.js`, `src/spending.js`

This breaks a would-be circular import: `reports.js` imports `renderReportsSpending` from `spending.js`, so `spending.js` can't import back from `reports.js`. Moving the canonical `getReportDate` to `utils.js` lets both import it from a common source — this also unblocks Phase 2's `reports.js` split, since the extracted `reportsSummary.js` will need it too.

- [ ] **Step 1: Read the current canonical implementation**

Run: `sed -n '17,21p' src/reports.js` (or open the file) to get the exact current body of `getReportDate(app)` before moving it — it depends on `app._reportMonthOffset` and today's date. Copy it verbatim into `utils.js`, changing only `export function getReportDate(app) {`.

- [ ] **Step 2: Remove from reports.js, add import**

Delete the local `getReportDate` definition from `src/reports.js`. Add `getReportDate` to its existing `from './utils.js'` import (check current import list with `grep -n "from './utils.js'" src/reports.js`).

- [ ] **Step 3: Remove spending.js's private copy**

In `src/spending.js`, delete:
```js
function _getReportDate(app) {
```
(and its body — read `src/spending.js:58-61` to confirm the exact lines before deleting). Replace every call site of `_getReportDate(` with `getReportDate(`. Add `getReportDate` to `spending.js`'s existing `from './utils.js'` import (currently `import { escapeHtml, formatCurrency, renderChartDataTable } from './utils.js';`).

- [ ] **Step 4: Confirm no remaining private copies**

Run: `grep -rn "_getReportDate\|^function getReportDate" src/`
Expected: no matches (only the new `utils.js` export and its call sites remain).

- [ ] **Step 5: Run tests**

Run: `pytest tests/features/test_reports.py tests/features/test_spending_analysis.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils.js src/reports.js src/spending.js
git commit -m "Moves getReportDate to utils.js, removes spending.js's private duplicate"
```

---

### Task 8: Move `incomeDaysInMonth` to utils.js

**Files:**
- Modify: `src/utils.js`, `src/reports.js`

- [ ] **Step 1: Read and move**

`reports.js:13-15` currently:
```js
export function incomeDaysInMonth(app, inc, year, month) {
    return getIncomePaydaysInMonth(inc, year, month);
}
```
It never uses `app`. Move it into `utils.js` (near `getIncomePaydaysInMonth`) with the `app` parameter dropped:
```js
export function incomeDaysInMonth(inc, year, month) {
    return getIncomePaydaysInMonth(inc, year, month);
}
```

- [ ] **Step 2: Update reports.js**

Delete the old export from `src/reports.js`. Add `incomeDaysInMonth` to its `from './utils.js'` import.

- [ ] **Step 3: Update call sites for the dropped parameter**

Run: `grep -rn "incomeDaysInMonth(" src/` and update every call site to drop the leading `app` argument (`incomeDaysInMonth(app, inc, year, month)` → `incomeDaysInMonth(inc, year, month)`). If `app.js` re-exports or delegates this method, check `src/app.js` too and update its wrapper's call accordingly (the delegating method's own signature — the one callers of `app.incomeDaysInMonth(...)` use — does not need to change, only the internal call into the feature function).

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_reports.py tests/features/test_income.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/reports.js src/app.js
git commit -m "Moves incomeDaysInMonth to utils.js, drops unused app parameter"
```

---

### Task 9: Add `ACCOUNT_TYPE_ICONS` to accounts.js, replace 2 duplicate copies

**Files:**
- Modify: `src/accounts.js`, `src/reports.js`, `src/reconciliation.js`

The same `{ Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' }` map is copy-pasted verbatim in all three files (`accounts.js:50`, `reports.js:839`, `reconciliation.js:4`). `accounts.js` is the canonical owner (account domain).

- [ ] **Step 1: Export from accounts.js**

In `src/accounts.js`, find the existing local `const typeIcon = { Checking:'🏦', ... }` (line ~50). Change it to a module-level export, placed above the function that currently defines it:
```js
export const ACCOUNT_TYPE_ICONS = { Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' };
```
Update the function that used to declare `const typeIcon = ...` locally to reference `ACCOUNT_TYPE_ICONS` instead (rename its local usages from `typeIcon[...]` to `ACCOUNT_TYPE_ICONS[...]`, or keep a local `const typeIcon = ACCOUNT_TYPE_ICONS;` alias right above its use if that's a smaller diff — either is fine as long as there's exactly one object literal in the file).

- [ ] **Step 2: Replace reports.js's copy**

In `src/reports.js` (line ~839), delete:
```js
const typeIcon = { Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' };
```
Import `ACCOUNT_TYPE_ICONS` from `./accounts.js` and use it directly in place of the deleted local `typeIcon` (rename the two `typeIcon[...]` usages on that line, or add a local `const typeIcon = ACCOUNT_TYPE_ICONS;` immediately where the constant used to be declared).

- [ ] **Step 3: Replace reconciliation.js's copy**

In `src/reconciliation.js` (line ~4), delete:
```js
const TYPE_ICON = { Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' };
```
Add `ACCOUNT_TYPE_ICONS` to `reconciliation.js`'s existing `from './utils.js'`-style import list — but note it comes from `./accounts.js`, not `./utils.js`, so add a new import line: `import { ACCOUNT_TYPE_ICONS } from './accounts.js';`. Replace every `TYPE_ICON[...]` usage with `ACCOUNT_TYPE_ICONS[...]` (`grep -n "TYPE_ICON" src/reconciliation.js` to find them all).

- [ ] **Step 4: Confirm no remaining duplicates**

Run: `grep -rn "Checking: '🏦'\|Checking:'🏦'" src/`
Expected: exactly one match, in `src/accounts.js`.

- [ ] **Step 5: Run tests**

Run: `pytest tests/features/test_accounts.py tests/features/test_reports.py tests/features/test_reconciliation.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/accounts.js src/reports.js src/reconciliation.js
git commit -m "Adds ACCOUNT_TYPE_ICONS to accounts.js, removes 2 duplicate icon maps"
```

---

### Task 10: Add `buildAccountOptionsHtml` to accounts.js, replace duplicated option-list blocks

**Files:**
- Modify: `src/accounts.js`, `src/income.js`, `src/bills.js`, `src/recurring.js`, `src/savings.js`

**Interfaces:**
- Produces: `buildAccountOptionsHtml(accounts, selectedId, { emptyLabel } = {})` in `accounts.js` — returns an HTML string of `<option>` tags. If `emptyLabel` is provided, prepends `<option value="">${emptyLabel}</option>` (unescaped — `emptyLabel` is always a literal string at call sites, never user data). Each account renders as `<option value="${a.id}"${selectedId === a.id ? ' selected' : ''}>${escapeHtml(a.name)}</option>`.

- [ ] **Step 1: Add to accounts.js**

```js
export function buildAccountOptionsHtml(accounts, selectedId, { emptyLabel } = {}) {
    const empty = emptyLabel ? `<option value="">${emptyLabel}</option>` : '';
    const options = (accounts || []).map(a =>
        `<option value="${a.id}"${selectedId === a.id ? ' selected' : ''}>${escapeHtml(a.name)}</option>`
    ).join('');
    return empty + options;
}
```
Add `escapeHtml` to `accounts.js`'s utils.js import if not already present (check with `grep -n "from './utils.js'" src/accounts.js`).

- [ ] **Step 2: Replace income.js's 2 blocks**

Line ~58 (inside the income edit card): replace
```js
<option value="">— No account —</option>
${app.accounts.map(a => `<option value="${a.id}" ${inc.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
```
with:
```js
${buildAccountOptionsHtml(app.accounts, inc.accountId, { emptyLabel: '— No account —' })}
```
Line ~359 (inside the bonus edit card, same pattern using `b.accountId`): replace the equivalent block with:
```js
${buildAccountOptionsHtml(app.accounts, b.accountId, { emptyLabel: '— No account —' })}
```
Add `buildAccountOptionsHtml` to `income.js`'s import from `./accounts.js` (add a new import line if `income.js` doesn't already import from `accounts.js`: `import { buildAccountOptionsHtml } from './accounts.js';`).

- [ ] **Step 3: Replace bills.js's 2 blocks**

Line ~39 (bill edit card) and line ~131 (expense edit card) both have the pattern:
```js
<option value="">— No account —</option>
${app.accounts.map(a => `<option value="${a.id}" ${bill.accountId===a.id?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}
```
(second occurrence uses `exp.accountId` instead of `bill.accountId`). Replace each with:
```js
${buildAccountOptionsHtml(app.accounts, bill.accountId, { emptyLabel: '— No account —' })}
```
and
```js
${buildAccountOptionsHtml(app.accounts, exp.accountId, { emptyLabel: '— No account —' })}
```
respectively. Add the import from `./accounts.js`.

- [ ] **Step 4: Replace recurring.js's 2 blocks**

Line ~245-247 (`accountOptions`, no empty label):
```js
const accountOptions = (app.accounts || []).map(a =>
    `<option value="${a.id}" ${t.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
).join('');
```
becomes:
```js
const accountOptions = buildAccountOptionsHtml(app.accounts, t.accountId);
```
Line ~248-250 (`targetOptions`, empty label `— None —`):
```js
const targetOptions = `<option value="">— None —</option>` + (app.accounts || []).map(a =>
    `<option value="${a.id}" ${t.targetAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
).join('');
```
becomes:
```js
const targetOptions = buildAccountOptionsHtml(app.accounts, t.targetAccountId, { emptyLabel: '— None —' });
```
Add the import from `./accounts.js`.

- [ ] **Step 5: Replace savings.js's 2 blocks**

Line ~57 (emergency fund form) and line ~207 (sinking fund form), both:
```js
<option value="">-- Select Account --</option>
${app.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
```
Note: no `selected` logic (these are add-forms for a new record, not edit-forms) — pass `null` as `selectedId`. Replace each with:
```js
${buildAccountOptionsHtml(app.accounts, null, { emptyLabel: '-- Select Account --' })}
```
Add the import from `./accounts.js`.

- [ ] **Step 6: Confirm no remaining duplicated blocks**

Run: `grep -rn "app.accounts.map(a =>\|(app.accounts || \[\]).map(a =>" src/income.js src/bills.js src/recurring.js src/savings.js`
Expected: no matches (all replaced by `buildAccountOptionsHtml` calls).

- [ ] **Step 7: Run tests**

Run: `pytest tests/features/test_income.py tests/features/test_bills.py tests/features/test_expenses.py tests/features/test_recurring.py tests/features/test_savings.py -v`
Expected: all PASS — rendered HTML must be byte-identical to before (same tag order, same attribute spacing pattern collapses to the new helper's exact format: verify no stray extra space before `selected` breaks any CSS/JS selector logic, since the old code had `${...} ${cond?'selected':''}` with a literal space before the ternary, and the new helper uses `${cond ? ' selected' : ''}` with the space inside the ternary — both produce identical final markup when selected, and both produce a trailing space before `>` when not selected in the old code vs. no trailing space in the new code; if any test does exact-HTML-string matching rather than semantic/attribute checks, it may need a whitespace-only expectation update).

- [ ] **Step 8: Commit**

```bash
git add src/accounts.js src/income.js src/bills.js src/recurring.js src/savings.js
git commit -m "Adds buildAccountOptionsHtml to accounts.js, removes 6 duplicated option-list blocks"
```

---

### Task 11: Replace charts.js's 5 raw currency reimplementations with formatCurrency

**Files:**
- Modify: `src/charts.js`

- [ ] **Step 1: Add formatCurrency to the import**

`src/charts.js` currently imports from `utils.js` for `computeMonthlyIncomeForMonth` but not `formatCurrency` — check the exact current import with `grep -n "from './utils.js'" src/charts.js` and add `formatCurrency` to it.

- [ ] **Step 2: Replace each inline reimplementation**

Run `grep -n "new Intl.NumberFormat" src/charts.js` to find the 5 occurrences (around lines 62, 107, 209-212, 272, 331). Each follows the pattern:
```js
new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ... }).format(value)
```
Replace each with `formatCurrency(value)` (using whatever the actual value expression is at that call site — read each occurrence before replacing to preserve the exact argument).

- [ ] **Step 3: Confirm no remaining reimplementations**

Run: `grep -n "new Intl.NumberFormat" src/charts.js`
Expected: no matches.

- [ ] **Step 4: Run tests**

Run: `pytest tests/ui/test_charts.py -v`
Expected: all PASS (output identical — `formatCurrency` uses the same `Intl.NumberFormat` options).

- [ ] **Step 5: Commit**

```bash
git add src/charts.js
git commit -m "Replaces 5 inline currency reimplementations in charts.js with formatCurrency"
```

---

### Task 12: Remove dead `fmt()` fallback wrapper in strategy.js

**Files:**
- Modify: `src/strategy.js`

- [ ] **Step 1: Remove the fallback wrapper**

In `renderStrategyIncomeWidget` (`src/strategy.js` ~line 553), delete:
```js
const fmt = (value) => {
    if (typeof formatCurrency === 'function') {
        return formatCurrency(value);
    }
    const numeric = Number(value) || 0;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(numeric);
};
```
Replace every `fmt(` call site within `renderStrategyIncomeWidget` with `formatCurrency(` directly (`grep -n "fmt(" src/strategy.js` scoped to this function).

- [ ] **Step 2: Run tests**

Run: `pytest tests/features/test_strategy.py -v`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/strategy.js
git commit -m "Removes dead formatCurrency fallback wrapper in strategy.js"
```

---

### Task 13: Delete dead compatibility shims from app.js

**Files:**
- Modify: `src/app.js`

Confirmed via repo-wide grep (`computeMonthlyIncome()` / `computeMonthlyBonuses()`) that these two methods have zero callers anywhere in `src/`, `index.html`, or `tests/` — they only call themselves internally. Safe to delete.

- [ ] **Step 1: Delete both methods**

In `src/app.js` (~lines 444-454), delete:
```js
    // Compatibility shim for any stale callsites that still expect app.computeMonthlyIncome().
    computeMonthlyIncome() {
        const now = new Date();
        return computeMonthlyIncomeForMonth(this.incomes, this.bonuses, now.getFullYear(), now.getMonth());
    }

    // Compatibility shim for stale callsites expecting app.computeMonthlyBonuses().
    computeMonthlyBonuses() {
        const now = new Date();
        return computeMonthlyBonusesForMonth(this.bonuses, now.getFullYear(), now.getMonth());
    }
```

- [ ] **Step 2: Remove now-unused imports if applicable**

Run: `grep -n "computeMonthlyIncomeForMonth\|computeMonthlyBonusesForMonth" src/app.js`. If no other call sites remain in `app.js`, remove `computeMonthlyIncomeForMonth` and `computeMonthlyBonusesForMonth` from the `from './utils.js'` import (line 72: `import { computeMonthlyIncomeForMonth, computeMonthlyBonusesForMonth, APP_VERSION } from './utils.js';` → `import { APP_VERSION } from './utils.js';` if both are unused elsewhere in the file).

- [ ] **Step 3: Run tests**

Run: `pytest tests/integration/test_smoke.py -v`
Expected: all PASS (this deletion has no behavioral surface — nothing called these methods).

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "Deletes dead computeMonthlyIncome/computeMonthlyBonuses shims from app.js"
```

---

### Task 14: Move `switchLiabilitiesSubTab` DOM logic from app.js to ui.js

**Files:**
- Modify: `src/app.js`, `src/ui.js`

`app.js:842-857`'s `switchLiabilitiesSubTab()` contains real DOM class-toggling logic inline, unlike its siblings `switchTab()`/`switchPage()`, which are thin delegating wrappers into `ui.js`.

- [ ] **Step 1: Read the current method**

Run: `sed -n '842,857p' src/app.js` to get its exact current body before moving.

- [ ] **Step 2: Move the logic into ui.js**

In `src/ui.js`, add a new exported function `switchLiabilitiesSubTab(app, subTab)` containing the DOM logic copied verbatim from `app.js`'s method body (replace every bare `this.` with `app.` inside the copied body, since it's now a standalone function rather than a class method).

- [ ] **Step 3: Replace app.js's method with a one-line delegate**

In `src/app.js`, replace the full `switchLiabilitiesSubTab()` method body with:
```js
    switchLiabilitiesSubTab(subTab) {
        switchLiabilitiesSubTabFeature(this, subTab);
    }
```
Add `switchLiabilitiesSubTab as switchLiabilitiesSubTabFeature` to `app.js`'s existing `from './ui.js'` import (line 71).

- [ ] **Step 4: Run tests**

Run: `pytest tests/ui/test_debt_actions.py tests/features/test_debts.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.js src/ui.js
git commit -m "Moves switchLiabilitiesSubTab DOM logic from app.js to ui.js"
```

---

### Task 15: Move income accountId backfill from app.js constructor to storage.js load path

**Files:**
- Modify: `src/app.js`, `src/storage.js`

`app.js`'s constructor (~lines 165-175) contains a data-backfill loop assigning a default `accountId` to legacy incomes that don't have one — this is load-time migration logic, which belongs alongside every other legacy-data-shape concern in `storage.js`'s `loadFromStorage`/sanitizer path, not in the constructor.

- [ ] **Step 1: Read the current backfill loop**

Run: `sed -n '160,180p' src/app.js` to see the exact current code and its surrounding context (what triggers it, what default it assigns) before moving it.

- [ ] **Step 2: Move it into storage.js**

Add a new function `backfillIncomeAccountIds(app)` in `src/storage.js`, containing the loop's logic copied verbatim (adjusted for `app.incomes` instead of `this.incomes` if the original used `this`). Call it from `loadFromStorage(app)` after incomes are loaded/sanitized, in the same place the constructor used to run it relative to load order (right after `app.incomes` is populated for the session).

- [ ] **Step 3: Remove from app.js constructor**

Delete the backfill loop from `app.js`'s constructor.

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_income.py tests/features/test_storage_import.py tests/integration/test_smoke.py -v`
Expected: all PASS — a fresh app load must still backfill missing `accountId`s exactly as before, just triggered from the storage load path instead of the constructor.

- [ ] **Step 5: Commit**

```bash
git add src/app.js src/storage.js
git commit -m "Moves income accountId backfill from app.js constructor to storage.js load path"
```

---

### Phase 1 checkpoint

- [ ] Run the full suite: `pytest tests/ -v`
- [ ] Expected: all PASS. If anything fails, fix before starting Phase 2 — don't let dedup regressions compound with structural splits.

---

## Phase 2: File Splits

For every task below, follow this same import-fixup discipline: after moving functions out of a file, (a) remove the corresponding names from the source file's own exports/imports if no longer used there, (b) grep the whole `src/` tree for every other file that imports the moved names from the *old* file path and repoint those imports at the *new* file, and (c) update `app.js`'s import block for names it imports directly (the exact current `app.js` import lines affected by each task are given below — they were read directly from the file, not guessed).

### Task 16: Split storage.js — extract sanitizers.js

**Files:**
- Create: `src/sanitizers.js`
- Modify: `src/storage.js`

**Interfaces:**
- Produces: all of `sanitizeAccount`, `sanitizeDebt`, `sanitizeIncome`, `sanitizeBonus`, `sanitizeBill`, `sanitizeExpense`, `sanitizeLedgerOverrides`, `sanitizeRecurringTemplate`, `sanitizeEmergencyFund`, `sanitizeSinkingFund`, `sanitizeNetWorthSnapshot`, `sanitizeForecastSettings`, `sanitizeSetting`, `sanitizeReconciliation`, `sanitizeParsedState` — exported from `src/sanitizers.js`.

- [ ] **Step 1: Create sanitizers.js**

Run: `sed -n '1,270p' src/storage.js` to see the current top-of-file imports and the full body of every `sanitizeX` function (currently lines 27-266 per the design spec) plus `sanitizeParsedState`. Create `src/sanitizers.js` with:
- A one-line file header comment: `// Sanitizers for persisted/imported record shapes — run on both load and import.`
- An import line pulling in only what these functions actually use from `./utils.js` (they compose `normalizeText`, `sanitizeFiniteNumber`, `sanitizeInteger`, `sanitizeDateISO` — confirm the exact set with `grep -oE "normalizeText|sanitizeFiniteNumber|sanitizeInteger|sanitizeDateISO" src/storage.js | sort -u` scoped to the lines being moved).
- All `sanitizeX` functions and `sanitizeParsedState`, each changed from `function sanitizeX(...)` to `export function sanitizeX(...)` (they're currently un-exported, file-private functions in `storage.js`, only called by `sanitizeParsedState` and `loadFromStorage`/`importAllJSON` within the same file — check whether each was already `export function` or plain `function` and preserve/add `export` on all of them since `storage.js` will need to import them back).

- [ ] **Step 2: Update storage.js**

Delete the moved function bodies from `src/storage.js`. Add an import: `import { sanitizeAccount, sanitizeDebt, sanitizeIncome, sanitizeBonus, sanitizeBill, sanitizeExpense, sanitizeLedgerOverrides, sanitizeRecurringTemplate, sanitizeEmergencyFund, sanitizeSinkingFund, sanitizeNetWorthSnapshot, sanitizeForecastSettings, sanitizeSetting, sanitizeReconciliation, sanitizeParsedState } from './sanitizers.js';` (trim to only the names `storage.js` actually calls — confirm with `grep -oE "sanitize[A-Za-z]+" src/storage.js | sort -u` after deleting the function bodies).

- [ ] **Step 3: Check for external consumers**

Run: `grep -rln "sanitize[A-Za-z]*" src/*.js | grep -v "src/storage.js\|src/sanitizers.js"` to check if any other file imports a `sanitizeX` function directly from `storage.js`. If any are found, repoint that file's import to `./sanitizers.js` instead.

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_storage_import.py tests/features/test_storage_backend.py tests/security/test_input_validation.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sanitizers.js src/storage.js
git commit -m "Splits storage.js: extracts sanitizers.js"
```

---

### Task 17: Split storage.js — extract dataExport.js

**Files:**
- Create: `src/dataExport.js`
- Modify: `src/storage.js`, `src/app.js`

**Interfaces:**
- Produces: `exportAllJSON`, `importAllJSON`, `csvField`, `exportToCSV`, `exportLedgerToCSV`, `ledgerExportCellValue` — exported from `src/dataExport.js`.
- Consumes: `sanitizeParsedState` from `src/sanitizers.js` (Task 16) for `importAllJSON`'s validation path.

- [ ] **Step 1: Create dataExport.js**

Move `exportAllJSON`, `csvField`, `exportToCSV`, `ledgerExportCellValue`, `exportLedgerToCSV`, `importAllJSON`, and the `LEDGER_EXPORT_COLUMN_*` constants (grep `LEDGER_EXPORT_COLUMN` in `src/storage.js` to find them) out of `src/storage.js` into a new `src/dataExport.js`. Give it a one-line header comment: `// JSON/CSV export and import.` Bring along whatever imports these functions need from `./utils.js` and `./sanitizers.js` (`importAllJSON` needs `sanitizeParsedState`; check the current top-of-file `storage.js` imports for the full set each moved function references).

- [ ] **Step 2: Update storage.js**

Delete the moved code from `src/storage.js`. `storage.js` keeps `getStorageUsageInfo`, `saveToStorage`, `loadFromStorage`, `switchStorageBackend`, `clearAllData`.

- [ ] **Step 3: Update app.js's import**

`app.js` line 35 currently:
```js
import { saveToStorage, loadFromStorage, exportAllJSON as exportAllJSONFeature, exportToCSV as exportToCSVFeature, exportLedgerToCSV as exportLedgerToCSVFeature, importAllJSON as importAllJSONFeature, clearAllData as clearAllDataFeature, switchStorageBackend as switchStorageBackendFeature } from './storage.js';
```
Split into two import lines:
```js
import { saveToStorage, loadFromStorage, clearAllData as clearAllDataFeature, switchStorageBackend as switchStorageBackendFeature } from './storage.js';
import { exportAllJSON as exportAllJSONFeature, exportToCSV as exportToCSVFeature, exportLedgerToCSV as exportLedgerToCSVFeature, importAllJSON as importAllJSONFeature } from './dataExport.js';
```

- [ ] **Step 4: Check for other external consumers**

Run: `grep -rln "exportAllJSON\|exportToCSV\|exportLedgerToCSV\|importAllJSON" src/*.js | grep -v "src/storage.js\|src/dataExport.js\|src/app.js"` — repoint any hits to `./dataExport.js`.

- [ ] **Step 5: Run tests**

Run: `pytest tests/features/test_storage_import.py tests/features/test_storage_backend.py tests/features/test_ledger.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dataExport.js src/storage.js src/app.js
git commit -m "Splits storage.js: extracts dataExport.js"
```

---

### Task 18: Split ledger.js — extract ledgerTransactions.js

**Files:**
- Create: `src/ledgerTransactions.js`
- Modify: `src/ledger.js`, `src/accounts.js`, `src/reconciliation.js`, `src/spending.js`, `src/reports.js`, `src/forecast.js`, `src/storage.js`, `src/app.js`

**Interfaces:**
- Produces: `buildProjectedAccountTransactions`, `getLedgerTransactionsForMonth`, `getAccountForecastSeries`, `getLedgerTransactions`, `getFilteredSortedLedgerTransactions`, `makeLedgerTransactionId`, `toLedgerTxOutput` — exported from `src/ledgerTransactions.js`. Pure computation, no DOM access.

This is the widest-reaching task in the plan — 7 other files currently import these names from `./ledger.js`. Confirmed by direct grep before writing this plan:
```
src/accounts.js:4:      import { getLedgerTransactionsForMonth } from './ledger.js';
src/reconciliation.js:5: import { getLedgerTransactionsForMonth, renderLedgerPage } from './ledger.js';
src/spending.js:1:       import { getLedgerTransactionsForMonth } from './ledger.js';
src/reports.js:9:        import { getLedgerTransactionsForMonth } from './ledger.js';
src/storage.js:4:        import { getFilteredSortedLedgerTransactions } from './ledger.js';
src/forecast.js:5:       import { getAccountForecastSeries, getLedgerTransactionsForMonth } from './ledger.js';
src/app.js:99:           import { getFilteredSortedLedgerTransactions as getFilteredSortedLedgerTransactionsFeature } from './ledger.js';
```
`renderLedgerPage` (used by `reconciliation.js` and `ui.js`) is **not** moving — it stays in `ledger.js`.

- [ ] **Step 1: Create ledgerTransactions.js**

Move `buildProjectedAccountTransactions`, `getLedgerTransactionsForMonth`, `getAccountForecastSeries`, `getLedgerTransactions`, `getFilteredSortedLedgerTransactions`, `makeLedgerTransactionId`, `toLedgerTxOutput`, plus any private helpers only they use (`getEffectiveAmount`, `getOverrideAmount` — check whether these are only used by the moved functions or also by `renderLedgerPage`/the override modal; if shared, they stay with whichever consolidated override logic Task 19 defines, and both `ledger.js` and `ledgerTransactions.js` import them from `ledgerOverrides.js`) out of `src/ledger.js` into a new `src/ledgerTransactions.js`. Header comment: `// Ledger transaction aggregation: pure computation, no DOM.` Bring along the `./recurring.js` and `./settings.js` imports these functions need (check current `ledger.js` top-of-file imports for the exact set).

- [ ] **Step 2: Update ledger.js**

Delete the moved code from `src/ledger.js`. Add an import from `./ledgerTransactions.js` for whichever of the moved functions `ledger.js`'s remaining code (`renderLedgerPage`, `openLedgerExportModal`) still calls.

- [ ] **Step 3: Update all 7 external consumers**

For each file listed above, change its import from `./ledger.js` to `./ledgerTransactions.js` for the specific moved names, keeping any names that stayed in `ledger.js` (only `reconciliation.js` needs a split import: `getLedgerTransactionsForMonth` from `./ledgerTransactions.js`, `renderLedgerPage` from `./ledger.js`). For `app.js` (line 99):
```js
import { getFilteredSortedLedgerTransactions as getFilteredSortedLedgerTransactionsFeature } from './ledger.js';
```
becomes:
```js
import { getFilteredSortedLedgerTransactions as getFilteredSortedLedgerTransactionsFeature } from './ledgerTransactions.js';
```

- [ ] **Step 4: Confirm no stale imports**

Run: `grep -rn "from './ledger.js'" src/` and verify every remaining hit only imports names that actually still live in `ledger.js` (`renderLedgerPage`, `openLedgerExportModal`, and anything from Task 19's `ledgerOverrides.js` split if that hasn't happened yet — see Task 19 below, do it right after this one).

- [ ] **Step 5: Run tests**

Run: `pytest tests/features/test_ledger.py tests/features/test_reconciliation.py tests/features/test_spending_analysis.py tests/features/test_reports.py tests/features/test_forecast.py tests/features/test_accounts.py tests/features/test_storage_import.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ledgerTransactions.js src/ledger.js src/accounts.js src/reconciliation.js src/spending.js src/reports.js src/forecast.js src/storage.js src/app.js
git commit -m "Splits ledger.js: extracts ledgerTransactions.js, repoints 7 consumer imports"
```

---

### Task 19: Split ledger.js — extract ledgerOverrides.js

**Files:**
- Create: `src/ledgerOverrides.js`
- Modify: `src/ledger.js`

**Interfaces:**
- Produces: `getOverrideAmount`, `getEffectiveAmount`, `setLedgerAmountOverride`, `clearLedgerAmountOverride`, `openLedgerOverrideModal` — exported from `src/ledgerOverrides.js`.
- Consumes: `parseFiniteOrNull` from `./utils.js` (Task 3), `escapeHtml`/`formatCurrency` from `./utils.js`.

- [ ] **Step 1: Create ledgerOverrides.js**

Move `getOverrideAmount`, `getEffectiveAmount`, `setLedgerAmountOverride`, `clearLedgerAmountOverride`, `openLedgerOverrideModal` out of `src/ledger.js` (and out of `src/ledgerTransactions.js` if Task 18 put `getOverrideAmount`/`getEffectiveAmount` there — reconcile: they belong here, not in `ledgerTransactions.js`, since they're part of the override subsystem, not raw transaction aggregation) into a new `src/ledgerOverrides.js`. Header comment: `// Ledger amount-override subsystem: per-transaction manual amount overrides.`

- [ ] **Step 2: Update ledger.js and ledgerTransactions.js**

`ledger.js` imports `getOverrideAmount`/`getEffectiveAmount`/etc. from `./ledgerOverrides.js` wherever `renderLedgerPage`/`openLedgerExportModal` need them. `ledgerTransactions.js` imports `getOverrideAmount`/`getEffectiveAmount` from `./ledgerOverrides.js` for `toLedgerTxOutput`'s use of them (this creates `ledgerTransactions.js` → `ledgerOverrides.js` as a one-way dependency — confirm `ledgerOverrides.js` does not import anything back from `ledgerTransactions.js` to avoid a cycle; it shouldn't need to, since overrides only need `app.ledgerAmountOverrides` and a transaction ID, not the aggregation logic).

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_ledger.py -v`
Expected: all PASS, including override-modal-specific assertions.

- [ ] **Step 4: Commit**

```bash
git add src/ledgerOverrides.js src/ledger.js src/ledgerTransactions.js
git commit -m "Splits ledger.js: extracts ledgerOverrides.js"
```

---

### Task 20: Split strategy.js — extract strategyPlanCalculation.js, consolidate recalculatePaymentPlan

**Files:**
- Create: `src/strategyPlanCalculation.js`
- Modify: `src/strategy.js`, `src/debts.js`, `src/app.js`

**Interfaces:**
- Produces: `calculatePaymentPlanFromInputs`, `calculateRequiredPayment`, `recalculatePaymentPlan(app, { monthlyPayment, strategy, stimulus, onSuccess, onError })` — all exported from `src/strategyPlanCalculation.js`.

This is the riskiest dedup in the plan: the 5 existing "recalculate" blocks look similar but have **real behavioral differences** (which side effects run, what stimulus value is passed, what error message is logged). Read every call site below carefully — the new `recalculatePaymentPlan` helper factors out only the truly-identical core (call `DebtCalculator.calculatePaymentPlan`, store `lastPaymentPlan`/`lastSummary`, try/catch) and takes callbacks for the parts that differ. **Do not** collapse the callbacks away — that would change behavior.

- [ ] **Step 1: Create strategyPlanCalculation.js with the consolidated helper**

```js
// Payment plan calculation: DOM-input-driven entry points plus a shared recalculate core.

export function recalculatePaymentPlan(app, { monthlyPayment, strategy, stimulus, onSuccess, onError } = {}) {
    try {
        const result = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, strategy, stimulus);
        app.lastPaymentPlan = result.paymentPlan;
        app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
        if (onSuccess) onSuccess();
    } catch (err) {
        if (onError) onError(err);
    }
}
```

- [ ] **Step 2: Move `calculatePaymentPlanFromInputs` and rewrite its body to use the helper**

Move the full function out of `src/strategy.js` into `src/strategyPlanCalculation.js` (bring its imports: `formatCurrency` if used, `DebtCalculator` is a global, no import needed). Its current try block (lines ~33-50):
```js
    try {
        const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0
            ? app.perMonthStimulus
            : 0;
        const result = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, strategy, stimulus);
        app.lastPaymentPlan = result.paymentPlan;
        app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);

        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.classList.add('visible'); resultsSection.classList.remove('hidden');
        }

        app.displayPaymentPlan();
        app.saveToStorage();
    } catch (err) {
        alert(err && err.message ? err.message : 'Unable to calculate payment plan.');
    }
```
becomes:
```js
    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0
        ? app.perMonthStimulus
        : 0;
    recalculatePaymentPlan(app, {
        monthlyPayment, strategy, stimulus,
        onSuccess: () => {
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) {
                resultsSection.classList.add('visible'); resultsSection.classList.remove('hidden');
            }
            app.displayPaymentPlan();
            app.saveToStorage();
        },
        onError: (err) => {
            alert(err && err.message ? err.message : 'Unable to calculate payment plan.');
        }
    });
```
(Keep the rest of `calculatePaymentPlanFromInputs` — the parts that read `monthlyPayment`/`strategy` from the DOM and validate `app.debts` — unchanged, above this block.)

- [ ] **Step 3: Move `calculateRequiredPayment` and rewrite its embedded recalculate block**

Move the full function into `src/strategyPlanCalculation.js`. Its inner block (currently ~lines 207-215):
```js
            try {
                const result = DebtCalculator.calculatePaymentPlan(app.debts, requiredPayment, strategy, 0);
                app.lastPaymentPlan = result.paymentPlan;
                app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
                app.displayPaymentPlan();
                app.switchPage('strategy');
            } catch (err) {
                console.error('Error recalculating plan:', err);
            }
```
becomes:
```js
            recalculatePaymentPlan(app, {
                monthlyPayment: requiredPayment, strategy, stimulus: 0,
                onSuccess: () => {
                    app.displayPaymentPlan();
                    app.switchPage('strategy');
                },
                onError: (err) => console.error('Error recalculating plan:', err)
            });
```

- [ ] **Step 4: Leave strategy.js's third call site (stimulus input handler) in place, but use the helper**

This block stays in `strategy.js` itself (it's inside a per-debt event-listener-attaching function that isn't part of this extraction — check which function currently contains it, likely `displayDebtSummary` or similar, and confirm it's *not* one of the two functions moved in Steps 2-3 before leaving it). Its current body (~lines 980-991):
```js
                try {
                    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
                    const strategy = document.getElementById('paymentStrategy').value;
                    if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                        const result = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, strategy, app.perMonthStimulus);
                        app.lastPaymentPlan = result.paymentPlan;
                        app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
                        app.displayPaymentPlan();
                    }
                } catch (err) {
                    console.error('Error recalculating after stimulus change', err);
                }
```
becomes:
```js
                const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
                const strategy = document.getElementById('paymentStrategy').value;
                if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                    recalculatePaymentPlan(app, {
                        monthlyPayment, strategy, stimulus: app.perMonthStimulus,
                        onSuccess: () => app.displayPaymentPlan(),
                        onError: (err) => console.error('Error recalculating after stimulus change', err)
                    });
                }
```
Import `recalculatePaymentPlan` into `strategy.js` from `./strategyPlanCalculation.js`.

- [ ] **Step 5: Replace debts.js's `recalculateIfConfigured`**

`src/debts.js:5-21` currently:
```js
function recalculateIfConfigured(app) {
    try {
        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
        const strategy = document.getElementById('paymentStrategy').value;
        if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
            const result = DebtCalculator.calculatePaymentPlan(
                app.debts,
                monthlyPayment,
                strategy,
                app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0
            );
            app.lastPaymentPlan = result.paymentPlan;
            app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
        }
    } catch (err) {
        console.error('Error recalculating plan after debt change', err);
    }
}
```
Replace with:
```js
function recalculateIfConfigured(app) {
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;
    if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
        recalculatePaymentPlan(app, {
            monthlyPayment, strategy,
            stimulus: app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0,
            onError: (err) => console.error('Error recalculating plan after debt change', err)
        });
    }
}
```
(No `onSuccess` — the original had no success side effect beyond storing the plan, which `recalculatePaymentPlan` always does.) Add `import { recalculatePaymentPlan } from './strategyPlanCalculation.js';` to `debts.js`.

- [ ] **Step 6: Replace debts.js's inline duplicate inside `saveEdit`**

`src/debts.js:345-360` currently:
```js
    try {
        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
        const strategy = document.getElementById('paymentStrategy').value;
        if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
            const result = DebtCalculator.calculatePaymentPlan(
                app.debts,
                monthlyPayment,
                strategy,
                app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0
            );
            app.lastPaymentPlan = result.paymentPlan;
            app.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
        }
    } catch (err) {
        console.error('Error recalculating after saveEdit', err);
    }
```
Replace with a call to the now-updated `recalculateIfConfigured(app)` from Step 5 — since the logic is now identical except for the `console.error` message. **Check first**: if the two error messages ("Error recalculating plan after debt change" vs. "Error recalculating after saveEdit") matter for debugging/log-grepping elsewhere (grep the codebase and any test assertions for these exact strings), keep them distinct by calling `recalculatePaymentPlan` directly here instead of reusing `recalculateIfConfigured`:
```js
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;
    if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
        recalculatePaymentPlan(app, {
            monthlyPayment, strategy,
            stimulus: app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0,
            onError: (err) => console.error('Error recalculating after saveEdit', err)
        });
    }
```

- [ ] **Step 7: Update app.js's import**

Line 51-62 currently imports `calculatePaymentPlanFromInputs` and `calculateRequiredPayment` from `./strategy.js` alongside other strategy exports. Split into two import statements — `app.js` will end up doing this same split incrementally across Tasks 20-24; after this task, it's:
```js
import {
    calculatePaymentPlanFromInputs as calculatePaymentPlanFromInputsFeature,
    calculateRequiredPayment as calculateRequiredPaymentFeature
} from './strategyPlanCalculation.js';
import {
    displayPaymentPlan as displayPaymentPlanFeature,
    displayDebtSummary as displayDebtSummaryFeature,
    showAmortizationModal as showAmortizationModalFeature,
    displayPaymentSchedule as displayPaymentScheduleFeature,
    displayInterestComparison as displayInterestComparisonFeature,
    displayWhatIfSimulator as displayWhatIfSimulatorFeature,
    renderStrategyIncomeWidget as renderStrategyIncomeWidgetFeature,
    renderCalendarView as renderCalendarViewFeature
} from './strategy.js';
```
(The second import will keep shrinking in Tasks 21-24 as more functions move out of `strategy.js`.)

- [ ] **Step 8: Run tests**

Run: `pytest tests/features/test_strategy.py tests/features/test_debts.py -v`
Expected: all PASS. This is the highest-risk task in the plan — if any test fails, read the failure carefully before assuming it's a pre-existing flake; it may be revealing that one of the 5 call sites' side effects wasn't preserved correctly.

- [ ] **Step 9: Commit**

```bash
git add src/strategyPlanCalculation.js src/strategy.js src/debts.js src/app.js
git commit -m "Splits strategy.js: extracts strategyPlanCalculation.js, consolidates 5 duplicate recalculate blocks"
```

---

### Task 21: Split strategy.js — extract strategyCalendar.js

**Files:**
- Create: `src/strategyCalendar.js`
- Modify: `src/strategy.js`, `src/app.js`

- [ ] **Step 1: Move renderCalendarView**

Move `renderCalendarView` (self-contained, ~160 lines) out of `src/strategy.js` into a new `src/strategyCalendar.js`, bringing its needed imports.

- [ ] **Step 2: Update app.js's import**

Move `renderCalendarView as renderCalendarViewFeature` out of the `./strategy.js` import block (from Task 20, Step 7) into a new line: `import { renderCalendarView as renderCalendarViewFeature } from './strategyCalendar.js';`

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_strategy.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/strategyCalendar.js src/strategy.js src/app.js
git commit -m "Splits strategy.js: extracts strategyCalendar.js"
```

---

### Task 22: Split strategy.js — extract strategyComparison.js

**Files:**
- Create: `src/strategyComparison.js`
- Modify: `src/strategy.js`, `src/app.js`

- [ ] **Step 1: Move displayInterestComparison and displayWhatIfSimulator**

Move both out of `src/strategy.js` into a new `src/strategyComparison.js`, bringing their needed imports.

- [ ] **Step 2: Update app.js's import**

Move `displayInterestComparison as displayInterestComparisonFeature, displayWhatIfSimulator as displayWhatIfSimulatorFeature` into a new import line from `./strategyComparison.js`.

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_strategy.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/strategyComparison.js src/strategy.js src/app.js
git commit -m "Splits strategy.js: extracts strategyComparison.js"
```

---

### Task 23: Split strategy.js — extract strategySummaryTable.js

**Files:**
- Create: `src/strategySummaryTable.js`
- Modify: `src/strategy.js`, `src/app.js`

- [ ] **Step 1: Move renderDebtSummaryTable, displayDebtSummary, showAmortizationModal**

Move all three out of `src/strategy.js` into a new `src/strategySummaryTable.js`, bringing their needed imports. `renderDebtSummaryTable` is a private helper `displayDebtSummary` calls — if it's not currently exported, keep it un-exported in the new file too (module-private is fine as long as both live in the same file).

- [ ] **Step 2: Update app.js's import**

Move `displayDebtSummary as displayDebtSummaryFeature, showAmortizationModal as showAmortizationModalFeature` into a new import line from `./strategySummaryTable.js`.

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_strategy.py tests/features/test_break_even.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/strategySummaryTable.js src/strategy.js src/app.js
git commit -m "Splits strategy.js: extracts strategySummaryTable.js"
```

---

### Task 24: Split strategy.js — extract strategyScheduleTable.js

**Files:**
- Create: `src/strategyScheduleTable.js`
- Modify: `src/strategy.js`, `src/app.js`

- [ ] **Step 1: Move displayPaymentSchedule**

Move it out of `src/strategy.js` into a new `src/strategyScheduleTable.js`, bringing its needed imports.

- [ ] **Step 2: Update app.js's import**

Move `displayPaymentSchedule as displayPaymentScheduleFeature` into a new import line from `./strategyScheduleTable.js`. After this task, `app.js`'s import from `./strategy.js` should be down to just `displayPaymentPlan as displayPaymentPlanFeature, renderStrategyIncomeWidget as renderStrategyIncomeWidgetFeature`.

- [ ] **Step 3: Confirm strategy.js is fully reduced**

Run: `grep -n "^export function" src/strategy.js`
Expected: exactly `displayPaymentPlan` and `renderStrategyIncomeWidget` (plus any private, un-exported helpers only they use).

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_strategy.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategyScheduleTable.js src/strategy.js src/app.js
git commit -m "Splits strategy.js: extracts strategyScheduleTable.js, completes strategy.js split"
```

---

### Task 25: Split debts.js — extract debtBreakEven.js

**Files:**
- Create: `src/debtBreakEven.js`
- Modify: `src/debts.js`, `src/app.js`

**Interfaces:**
- Produces: `renderBreakEvenBadge`, `showAccelerateModal` — exported from `src/debtBreakEven.js` (`_renderBreakEvenChart` stays private, only called by `renderBreakEvenBadge`).
- Consumes: `computeBreakEven` from `./breakEven.js`.

- [ ] **Step 1: Move the three functions**

Move `renderBreakEvenBadge`, `_renderBreakEvenChart`, and `showAccelerateModal` out of `src/debts.js` into a new `src/debtBreakEven.js`. Bring the `computeBreakEven` import from `./breakEven.js` and whatever `./utils.js` names these three functions use (check with `grep -n "formatCurrency\|escapeHtml\|renderChartDataTable\|getDayOrdinal\|computeInterestPaidToDate\|normalizeText\|sanitizeFiniteNumber\|sanitizeInteger\|sanitizeDateISO" src/debts.js` scoped to the lines being moved, before deleting them).

- [ ] **Step 2: Update debts.js**

Delete the moved functions from `src/debts.js`. Add an import from `./debtBreakEven.js` for `renderBreakEvenBadge` (called from within `renderDebtsList`, which stays in `debts.js`).

- [ ] **Step 3: Update app.js's import**

Line 1-13 currently imports `showAccelerateModal as showAccelerateModalFeature` from `./debts.js` alongside the CRUD functions. Split it out:
```js
import {
    addDebt as addDebtFeature,
    deleteDebt as deleteDebtFeature,
    showUpdateBalanceModal as showUpdateBalanceModalFeature,
    updateDebtBalance as updateDebtBalanceFeature,
    saveEdit as saveEditFeature,
    cancelEdit as cancelEditFeature,
    renderDebtsList as renderDebtsListFeature,
    startEdit as startEditDebtFeature,
    cancelInlineEdit as cancelInlineEditDebtFeature,
    saveInlineEdit as saveInlineEditDebtFeature
} from './debts.js';
import { showAccelerateModal as showAccelerateModalFeature } from './debtBreakEven.js';
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_debts.py tests/features/test_break_even.py tests/ui/test_debt_actions.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debtBreakEven.js src/debts.js src/app.js
git commit -m "Splits debts.js: extracts debtBreakEven.js"
```

---

### Task 26: Split reports.js — extract reportsNetWorth.js

**Files:**
- Create: `src/reportsNetWorth.js`
- Modify: `src/reports.js`, `src/app.js`

**Interfaces:**
- Produces: `toMonthKey`, `getSnapshotSeries`, `computeSnapshotMetrics`, `captureNetWorthSnapshot`, `renderNetWorthWidget`, `renderReportsNetWorth` — exported from `src/reportsNetWorth.js`.

Do this split first among the `reports.js` splits — `getSnapshotSeries` is needed by `reportsSummary.js` in Task 30.

- [ ] **Step 1: Move the six functions**

Move `toMonthKey`, `getSnapshotSeries`, `computeSnapshotMetrics`, `captureNetWorthSnapshot`, `renderNetWorthWidget`, `renderReportsNetWorth` out of `src/reports.js` into a new `src/reportsNetWorth.js`. Bring whatever `./utils.js` imports these need (`getReportDate` from Task 7, `formatCurrency`, `escapeHtml`, `renderChartDataTable` — check current `reports.js` top-of-file import list for the exact set).

- [ ] **Step 2: Update reports.js**

Delete the moved code. Add an import from `./reportsNetWorth.js` for `renderReportsNetWorth` and `renderNetWorthWidget` (called from `renderReportsPage`).

- [ ] **Step 3: Update app.js's import**

Line 63-70 currently:
```js
import {
    prevReportMonth as prevReportMonthFeature,
    nextReportMonth as nextReportMonthFeature,
    renderReportsPage as renderReportsPageFeature,
    captureNetWorthSnapshot as captureNetWorthSnapshotFeature,
    renderNetWorthWidget as renderNetWorthWidgetFeature,
    computeReportsSummaryMetrics as computeReportsSummaryMetricsFeature
} from './reports.js';
```
Split into:
```js
import {
    prevReportMonth as prevReportMonthFeature,
    nextReportMonth as nextReportMonthFeature,
    renderReportsPage as renderReportsPageFeature
} from './reports.js';
import {
    captureNetWorthSnapshot as captureNetWorthSnapshotFeature,
    renderNetWorthWidget as renderNetWorthWidgetFeature
} from './reportsNetWorth.js';
```
(`computeReportsSummaryMetrics`'s import moves again in Task 30.)

- [ ] **Step 4: Run tests**

Run: `pytest tests/features/test_reports.py tests/features/test_networth.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reportsNetWorth.js src/reports.js src/app.js
git commit -m "Splits reports.js: extracts reportsNetWorth.js"
```

---

### Task 27: Split reports.js — extract reportsCalendar.js

**Files:**
- Create: `src/reportsCalendar.js`
- Modify: `src/reports.js`

**Interfaces:**
- Produces: `renderReportsCalendar`, `openCalendarDayModal` — exported from `src/reportsCalendar.js` (they share `app._reportsCalendarDayData` as state on the app object, not module-private state, so no special handling needed beyond moving both together).

- [ ] **Step 1: Move both functions**

Move `renderReportsCalendar` and `openCalendarDayModal` out of `src/reports.js` into a new `src/reportsCalendar.js`, bringing needed imports.

- [ ] **Step 2: Update reports.js**

Delete the moved code. Add an import from `./reportsCalendar.js` for `renderReportsCalendar` (called from `renderReportsPage`). Check whether `openCalendarDayModal` is called from anywhere else in `src/` (`grep -rn "openCalendarDayModal" src/`) — if `app.js` or another file references it directly, update that import too.

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_reports.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/reportsCalendar.js src/reports.js
git commit -m "Splits reports.js: extracts reportsCalendar.js"
```

---

### Task 28: Split reports.js — extract reportsCashFlow.js

**Files:**
- Create: `src/reportsCashFlow.js`
- Modify: `src/reports.js`

**Interfaces:**
- Produces: `renderReportsIncomeExp`, `renderReportsMoneyFlow` — exported from `src/reportsCashFlow.js`.
- Consumes: `ACCOUNT_TYPE_ICONS` from `./accounts.js` (Task 9 already updated this file's usage of the icon map — carry that import along with the move).

- [ ] **Step 1: Move both functions**

Move `renderReportsIncomeExp` and `renderReportsMoneyFlow` out of `src/reports.js` into a new `src/reportsCashFlow.js`, bringing needed imports including `ACCOUNT_TYPE_ICONS` from `./accounts.js`.

- [ ] **Step 2: Update reports.js**

Delete the moved code. Add an import from `./reportsCashFlow.js` for both functions (called from `renderReportsPage`).

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_reports.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/reportsCashFlow.js src/reports.js
git commit -m "Splits reports.js: extracts reportsCashFlow.js"
```

---

### Task 29: Split reports.js — extract reportsVariance.js

**Files:**
- Create: `src/reportsVariance.js`
- Modify: `src/reports.js`

- [ ] **Step 1: Move renderReportsVariance**

Move it out of `src/reports.js` into a new `src/reportsVariance.js`, bringing needed imports.

- [ ] **Step 2: Update reports.js**

Delete the moved code. Add an import from `./reportsVariance.js` for `renderReportsVariance` (called from `renderReportsPage`).

- [ ] **Step 3: Run tests**

Run: `pytest tests/features/test_reports.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/reportsVariance.js src/reports.js
git commit -m "Splits reports.js: extracts reportsVariance.js"
```

---

### Task 30: Split reports.js — extract reportsSummary.js

**Files:**
- Create: `src/reportsSummary.js`
- Modify: `src/reports.js`, `src/app.js`

**Interfaces:**
- Produces: `computeReportsSummaryMetrics`, `renderReportsSummary` — exported from `src/reportsSummary.js`.
- Consumes: `getSnapshotSeries` from `./reportsNetWorth.js` (Task 26), `getReportDate` from `./utils.js` (Task 7).

- [ ] **Step 1: Move both functions**

Move `computeReportsSummaryMetrics` and `renderReportsSummary` out of `src/reports.js` into a new `src/reportsSummary.js`. Add `import { getSnapshotSeries } from './reportsNetWorth.js';` and bring `getReportDate` and any other needed `./utils.js` imports.

- [ ] **Step 2: Update reports.js**

Delete the moved code. Add an import from `./reportsSummary.js` for `renderReportsSummary` (called from `renderReportsPage`).

- [ ] **Step 3: Update app.js's import**

`computeReportsSummaryMetrics as computeReportsSummaryMetricsFeature` moves out of the `./reports.js` import (from Task 26, Step 3) into a new line: `import { computeReportsSummaryMetrics as computeReportsSummaryMetricsFeature } from './reportsSummary.js';`

- [ ] **Step 4: Confirm reports.js is fully reduced**

Run: `grep -n "^export function" src/reports.js`
Expected: `incomeDaysInMonth` should NOT appear (moved in Task 8); remaining exports should be limited to `prevReportMonth`, `nextReportMonth`, `updateReportMonthNav`, `renderReportsPage`.

- [ ] **Step 5: Run tests**

Run: `pytest tests/features/test_reports.py tests/features/test_networth.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/reportsSummary.js src/reports.js src/app.js
git commit -m "Splits reports.js: extracts reportsSummary.js, completes reports.js split"
```

---

### Phase 2 checkpoint

- [ ] Run the full suite: `pytest tests/ -v`
- [ ] Expected: all PASS.
- [ ] Manually smoke-test in a browser (start `python -m http.server 5500`, open `http://localhost:5500/`, check the browser console for import errors): Reports page (all sub-tabs — net worth, calendar, income/expense, money flow, variance, summary), Ledger page (list, override modal, export), Strategy/Plan page (calendar view, comparison, summary table, amortization modal, schedule), Debts page (add/edit, break-even badge, accelerate modal), Settings → storage backend switch, JSON export/import round-trip.

---

## Phase 3: Finalize

### Task 31: Bump APP_VERSION

**Files:**
- Modify: `src/utils.js`

- [ ] **Step 1: Bump the version**

In `src/utils.js`, change:
```js
export const APP_VERSION = '4.6.1';
```
to:
```js
export const APP_VERSION = '4.7.0';
```

- [ ] **Step 2: Check for other hardcoded version references**

Run: `grep -rn "4\.6\.1" .` (repo root) to confirm nothing else hardcodes the old version string outside of `CHANGELOG`-style files (which should get a new entry, not an edit to old entries).

- [ ] **Step 3: Run tests**

Run: `pytest tests/ -v` (full suite — version bumps can affect any test asserting on displayed version text, e.g. in Settings or an about panel).
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils.js
git commit -m "Bumps version to 4.7.0"
```

---

### Task 32: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the feature-module list**

In the "Central app object + feature-module delegation pattern" section, update the parenthetical list of feature modules to include all new files created in Phase 2: `reportsNetWorth.js`, `reportsCalendar.js`, `reportsCashFlow.js`, `reportsVariance.js`, `reportsSummary.js`, `ledgerTransactions.js`, `ledgerOverrides.js`, `sanitizers.js`, `dataExport.js`, `strategyPlanCalculation.js`, `strategyCalendar.js`, `strategyComparison.js`, `strategySummaryTable.js`, `strategyScheduleTable.js`, `debtBreakEven.js`.

- [ ] **Step 2: Update the Storage & data flow section**

The line `storage.js persists app state...` should note that sanitizers now live in `sanitizers.js` and export/import logic in `dataExport.js`, with `storage.js` itself scoped to save/load/quota/clear.

- [ ] **Step 3: Add a one-line note on shared helpers**

Near the `utils.js` mentions, note that `utils.js` now also hosts `formatShortDate`, `formatMonthYear`, `dateToISO`, `parseFiniteOrNull`, `getReportDate`, `incomeDaysInMonth`, and `dailyCompoundInterest` as shared helpers — so future features should check `utils.js` before adding a new local date/number formatter.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Updates CLAUDE.md for the src/ reorganization"
```

---

### Task 33: Final verification pass

- [ ] **Step 1: Run the full test suite**

Run: `pytest tests/ -v`
Expected: all PASS, zero skips beyond any pre-existing intentional skips.

- [ ] **Step 2: Run the security suite specifically**

Run: `pytest tests/security/ -v`
Expected: all PASS — confirms the `escapeHtml` consolidation (Task 1) didn't introduce any unescaped-output regression, and CSP/static-scan checks are unaffected by the new files.

- [ ] **Step 3: Full browser smoke test**

Start the dev server (`python -m http.server 5500`), open every page (`health`, `accounts`, `income`, `liabilities` → both Debts and Budget sub-tabs, `recurring`, `savings`, `strategy`, `reports` → every sub-tab, `ledger`, `reconcile`), and confirm the browser console shows zero errors on any page load or navigation. Check `index.html`'s CSP doesn't block anything (no inline-script/style errors — the new files are all external `<script type="module">`-resolved imports, so this should be a non-issue, but confirm).

- [ ] **Step 4: Confirm final file sizes**

Run: `wc -l src/*.js | sort -n`
Expected: no single file (other than the necessarily-larger `app.js`, which still holds all state + delegation) should be dramatically larger than the design spec's estimates — flag anything that looks like a split didn't actually happen.
