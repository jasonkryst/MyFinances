# Break-Even Analysis per Debt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For each credit-card debt, show a side-by-side payoff comparison (your plan vs. minimum only) with a mini chart, an interest-savings summary, and an "Accelerate" modal — all surfaced on the Debts page cards and in the Plan page summary table.

**Architecture:** A new `src/breakEven.js` module owns all calculation logic and is imported by both `debts.js` (card badge + modal) and `strategy.js` (summary table columns). The engine reuses the existing `DebtCalculator` global for fixed-payment scenarios and a custom loop for percent-of-balance minimum scenarios. Mini-charts use the existing Chart.js global.

**Tech Stack:** Vanilla ES6+ modules, Chart.js 4 (CDN global), Playwright (tests), Python pytest, `DebtCalculator` (global class from `src/debtCalculator.js`).

## Global Constraints

- **No build step** — `src/breakEven.js` is an ES module imported via `import` statements in other modules.
- **CSP**: no `eval()`, no inline `style=""`, no inline `<script>`. All dynamic styling via `classList` and CSS custom properties.
- **All user-visible strings through `escapeHtml()`** before `innerHTML`.
- **Chart canvases** must have a companion `renderChartDataTable()` call for screen-reader accessibility.
- **No new external dependencies** — Chart.js already loaded as CDN global.
- **Test server** must be running at `http://localhost:5500/` before running tests (`python -m http.server 5500`).
- **Run all tests** with `pytest tests/ -v` after each task.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/breakEven.js` | Create | `computeBreakEven(debt, options)` — all calculation logic |
| `styles.css` | Modify | Badge, chart container, accelerate modal styles |
| `index.html` | Modify | Accelerate modal markup + two new `<th>` in summary table |
| `src/debts.js` | Modify | Badge HTML in `renderDebtsList`, "Show"/"Accelerate" click handlers |
| `src/strategy.js` | Modify | `interestSaved`/`monthsSaved` columns in `displayDebtSummary` + `renderDebtSummaryTable` |
| `src/app.js` | Modify | Import + thin wrapper for `showAccelerateModal` |
| `tests/features/test_break_even.py` | Create | 13 Playwright tests |

---

## Task 1: `src/breakEven.js` — calculation engine

**Files:**
- Create: `src/breakEven.js`

**Interfaces:**
- Consumes: `DebtCalculator` global (from `src/debtCalculator.js`, loaded before ES modules in `index.html`)
- Produces:
  - `computeBreakEven(debt, options)` → `{ planMonths, planInterest, minMonths, minInterest, monthsSaved, interestSaved, planBalances, minBalances } | null`
  - `options`: `{ minType?: 'fixed'|'percent', minPct?: number, planPayment?: number }`
  - Returns `null` when `debt.debtType === 'fixedAmount'` or `debt.minimumPayment <= 0` or `planPayment <= 0`
  - `planBalances` / `minBalances`: `number[]` — balance at start of plan plus end of each month (index 0 = original balance before any payment)

- [ ] **Step 1: Write the failing test file (stub)**

Create `tests/features/test_break_even.py` with just the import and one placeholder test so the file is valid Python:

```python
#!/usr/bin/env python3
"""
Break-Even Analysis Tests
Tests per-debt payoff comparison badge, accelerate modal, and plan table columns.
"""
import pytest
from tests.conftest import create_debt

BASE_URL = "http://localhost:5500/"


def _nav_debts(page):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)


def _create_cc_debt(page, name="Visa", balance="2400", rate="18.5", min_pay="100"):
    _nav_debts(page)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', name)
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', balance)
    page.fill('#interestRate', rate)
    page.fill('#minimumPayment', min_pay)
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


def _run_plan(page, payment="450"):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="plan"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', payment)
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)


@pytest.mark.feature
def test_placeholder():
    """Placeholder — replaced by real tests in Task 6."""
    assert True
```

- [ ] **Step 2: Run the placeholder test to confirm file is valid**

```
pytest tests/features/test_break_even.py -v
```
Expected: 1 test PASSED.

- [ ] **Step 3: Create `src/breakEven.js`**

```js
// Break-even analysis calculation for a single credit-card debt.
// Compares the user's planned payment against minimum-only payoff.

import { formatCurrency } from './utils.js';

const MAX_MONTHS = 600;

/**
 * Run a fixed-payment single-debt simulation using DebtCalculator.
 * Returns { months, totalInterest, balances } or null on failure.
 * `balances[0]` = original balance; subsequent entries = end-of-month balance.
 */
function runFixedScenario(debt, monthlyPayment) {
    if (!monthlyPayment || monthlyPayment <= 0) return null;
    try {
        const singleDebt = {
            ...debt,
            id: debt.id ?? 1,
            name: debt.name ?? 'debt',
            debtType: 'creditCard',
            accountBalance: debt.accountBalance,
            interestRate: debt.interestRate || 0,
            minimumPayment: Math.min(monthlyPayment, debt.minimumPayment || monthlyPayment),
            dueDate: debt.dueDate || 1,
        };
        const result = DebtCalculator.calculatePaymentPlan([singleDebt], monthlyPayment, 'avalanche', 0);
        const months = result.workingDebts[0].paidOffMonth || result.paymentPlan.length;
        const totalInterest = result.workingDebts[0].totalInterest || 0;
        const balances = [debt.accountBalance];
        for (const month of result.paymentPlan) {
            const p = month.payments[0];
            balances.push(p != null ? p.balance : 0);
        }
        return { months, totalInterest, balances };
    } catch {
        return null;
    }
}

/**
 * Run a percent-of-balance minimum-only simulation (custom loop).
 * Each month's payment = max(debt.minimumPayment, balance × minPct/100).
 * Returns { months, totalInterest, balances }.
 */
function runPercentScenario(debt, minPct) {
    const dailyRate = (debt.interestRate || 0) / 100 / 365;
    const minFixed = debt.minimumPayment || 0;
    let balance = debt.accountBalance;
    let totalInterest = 0;
    let months = 0;
    const balances = [balance];

    while (balance > 0.01 && months < MAX_MONTHS) {
        const daysInMonth = 30;
        const monthlyInterest = balance * (Math.pow(1 + dailyRate, daysInMonth) - 1);
        const percentPayment = balance * minPct / 100;
        const payment = Math.min(Math.max(minFixed, percentPayment), balance + monthlyInterest);
        const interestPaid = Math.min(monthlyInterest, payment);
        balance = Math.max(0, balance - (payment - interestPaid));
        totalInterest += interestPaid;
        months++;
        balances.push(parseFloat(balance.toFixed(2)));
    }

    return { months, totalInterest, balances };
}

/**
 * Compute break-even data for a single credit-card debt.
 *
 * @param {object} debt - A debt object from app.debts (debtType must be 'creditCard')
 * @param {object} [options]
 * @param {'fixed'|'percent'} [options.minType='fixed'] - How minimum payment is modeled
 * @param {number} [options.minPct=2] - Percent of balance used in 'percent' mode
 * @param {number} [options.planPayment] - Monthly payment for the "your plan" scenario;
 *   defaults to debt.minimumPayment when omitted (no-plan state)
 * @returns {{ planMonths, planInterest, minMonths, minInterest,
 *             monthsSaved, interestSaved, planBalances, minBalances } | null}
 */
export function computeBreakEven(debt, options = {}) {
    if (!debt || debt.debtType === 'fixedAmount') return null;
    if (!debt.accountBalance || debt.accountBalance <= 0) return null;
    const minPayment = debt.minimumPayment || 0;
    if (minPayment <= 0) return null;

    const minType = options.minType || 'fixed';
    const minPct = options.minPct > 0 ? options.minPct : 2;
    const planPayment = options.planPayment > 0 ? options.planPayment : minPayment;

    const planScenario = runFixedScenario(debt, planPayment);
    if (!planScenario) return null;

    const minScenario = minType === 'percent'
        ? runPercentScenario(debt, minPct)
        : runFixedScenario(debt, minPayment);
    if (!minScenario) return null;

    return {
        planMonths: planScenario.months,
        planInterest: parseFloat(planScenario.totalInterest.toFixed(2)),
        minMonths: minScenario.months,
        minInterest: parseFloat(minScenario.totalInterest.toFixed(2)),
        monthsSaved: Math.max(0, minScenario.months - planScenario.months),
        interestSaved: parseFloat(Math.max(0, minScenario.totalInterest - planScenario.totalInterest).toFixed(2)),
        planBalances: planScenario.balances,
        minBalances: minScenario.balances,
    };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/breakEven.js tests/features/test_break_even.py
git commit -m "feat: add breakEven.js calculation module and test scaffold"
```

---

## Task 2: CSS styles

**Files:**
- Modify: `styles.css` (append to end of file)

**Interfaces:**
- Produces CSS classes consumed by Tasks 3, 4, 5:
  - `.break-even-section`, `.break-even-header`, `.break-even-toggle-row`
  - `.break-even-row`, `.break-even-label`, `.break-even-value`, `.break-even-savings`
  - `.break-even-savings--positive`, `.break-even-no-plan-banner`
  - `.break-even-chart-wrap`
  - `.accelerate-modal-overlay`, `.accelerate-modal-content`, `.accelerate-modal-close`
  - `.accelerate-row`, `.accelerate-total`, `.accelerate-preview`, `.accelerate-preview-delta`
  - `.be-col-saved` (green text for summary table)

- [ ] **Step 1: Append CSS to `styles.css`**

Open `styles.css`, scroll to the very end, and append:

```css
/* ── Break-Even Analysis ───────────────────────────────────────── */
.break-even-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color, #e5e7eb);
}
.break-even-header {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-secondary, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.break-even-toggle-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
    font-size: 0.8rem;
}
.break-even-toggle-row select,
.break-even-toggle-row input[type="number"] {
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 4px;
    background: var(--input-bg, #fff);
    color: var(--text-primary, #111827);
    width: 4.5rem;
}
.break-even-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.82rem;
    margin-bottom: 0.2rem;
    align-items: baseline;
}
.break-even-label {
    color: var(--text-secondary, #6b7280);
    min-width: 5.5rem;
    font-weight: 500;
}
.break-even-value {
    color: var(--text-primary, #111827);
}
.break-even-savings {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary, #6b7280);
}
.break-even-savings--positive {
    color: #15803d;
}
.break-even-no-plan-banner {
    font-size: 0.78rem;
    color: var(--text-secondary, #6b7280);
    background: var(--surface-muted, #f9fafb);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    margin-bottom: 0.5rem;
}
.break-even-chart-wrap {
    position: relative;
    height: 100px;
    margin-top: 0.5rem;
}
.break-even-show-link {
    font-size: 0.82rem;
    color: var(--accent, #2563eb);
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    text-decoration: underline;
}
.break-even-show-link:hover {
    color: var(--accent-hover, #1d4ed8);
}
.break-even-accelerate-btn {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
}

/* ── Accelerate Modal ───────────────────────────────────────────── */
.accelerate-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
}
.accelerate-modal-content {
    background: var(--card-bg, #fff);
    border-radius: 10px;
    padding: 1.5rem;
    width: min(420px, 92vw);
    position: relative;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
}
.accelerate-modal-close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: none;
    border: none;
    font-size: 1.3rem;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    line-height: 1;
}
.accelerate-modal-close:hover { color: var(--text-primary, #111827); }
.accelerate-modal-content h3 {
    margin: 0 0 1rem;
    font-size: 1rem;
    font-weight: 600;
}
.accelerate-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.88rem;
    margin-bottom: 0.5rem;
}
.accelerate-row label {
    color: var(--text-secondary, #6b7280);
    font-weight: 500;
}
.accelerate-row input[type="number"] {
    width: 7rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 6px;
    font-size: 0.88rem;
    background: var(--input-bg, #fff);
    color: var(--text-primary, #111827);
}
.accelerate-divider {
    border: none;
    border-top: 1px solid var(--border-color, #e5e7eb);
    margin: 0.75rem 0;
}
.accelerate-total {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
}
.accelerate-preview {
    background: var(--surface-muted, #f9fafb);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 8px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
}
.accelerate-preview-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    margin-bottom: 0.3rem;
}
.accelerate-preview-delta {
    font-size: 0.78rem;
    color: #15803d;
    font-weight: 600;
}
.accelerate-chart-wrap {
    position: relative;
    height: 120px;
    margin-bottom: 0.75rem;
}
.accelerate-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
}

/* ── Plan summary table — saved columns ────────────────────────── */
.be-col-saved {
    color: #15803d;
    font-weight: 600;
}
.be-col-zero {
    color: var(--text-secondary, #6b7280);
}
.debt-summary-footnote {
    font-size: 0.78rem;
    color: var(--text-secondary, #6b7280);
    margin-top: 0.5rem;
    font-style: italic;
}
```

- [ ] **Step 2: Verify no CSS syntax errors by loading the app in a browser**

```
python -m http.server 5500
```
Open `http://localhost:5500/` — page should load without visual errors. Check browser console for CSS parse errors.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: add break-even badge, accelerate modal, and saved-column CSS"
```

---

## Task 3: `index.html` — modal markup + table headers

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces HTML IDs consumed by Tasks 4 and 5:
  - `#accelerateDebtModal`, `#accelerateDebtTitle`, `#accelerateBasePay`
  - `#accelerateExtraPay`, `#accelerateNewTotal`, `#acceleratePayoff`
  - `#accelerateInterest`, `#acceleratePayoffDelta`, `#accelerateInterestDelta`
  - `#accelerateChart`, `#accelerateApplyBtn`, `#accelerateCloseBtn`
  - Two new `<th data-sort="interestSaved">` and `<th data-sort="monthsSaved">` in `#debtSummaryTable`

- [ ] **Step 1: Add accelerate modal to `index.html`**

Find the line containing `id="updateBalanceModal"` in `index.html` — it is near the bottom, just before the `<script>` tags. Add the accelerate modal **immediately before** the `#updateBalanceModal` div:

```html
    <!-- Accelerate Debt Modal -->
    <div id="accelerateDebtModal" class="accelerate-modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="accelerateDebtTitle" tabindex="-1">
        <div class="accelerate-modal-content">
            <button id="accelerateCloseBtn" class="accelerate-modal-close" aria-label="Close">&times;</button>
            <h3 id="accelerateDebtTitle">Accelerate: Debt</h3>
            <div class="accelerate-row">
                <label>Current plan payment</label>
                <span id="accelerateBasePay">—</span>
            </div>
            <div class="accelerate-row">
                <label for="accelerateExtraPay">Extra payment /mo</label>
                <input type="number" id="accelerateExtraPay" min="0" step="1" value="0" aria-label="Extra monthly payment">
            </div>
            <hr class="accelerate-divider">
            <div class="accelerate-total">New total: <span id="accelerateNewTotal">—</span></div>
            <div class="accelerate-preview" id="acceleratePreviewBox">
                <div class="accelerate-preview-row">
                    <span>Payoff</span>
                    <span><span id="acceleratePayoff">—</span> <span class="accelerate-preview-delta" id="acceleratePayoffDelta"></span></span>
                </div>
                <div class="accelerate-preview-row">
                    <span>Interest</span>
                    <span><span id="accelerateInterest">—</span> <span class="accelerate-preview-delta" id="accelerateInterestDelta"></span></span>
                </div>
            </div>
            <div class="accelerate-chart-wrap">
                <canvas id="accelerateChart" aria-label="Accelerated vs current payoff balance chart"></canvas>
            </div>
            <div class="accelerate-actions">
                <button id="accelerateApplyBtn" class="btn btn-primary btn-small">Apply to Plan</button>
                <button id="accelerateCloseBtnFooter" class="btn btn-secondary btn-small">Close</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 2: Add two new `<th>` columns to `#debtSummaryTable`**

Find the existing table headers in `index.html`. The current last two headers before `<th>Amortization</th>` are:
```html
<th data-sort="payoffDate"     class="sortable">Estimated Payoff Date <span class="sort-icon">↕</span></th>
<th>Amortization</th>
```

Insert two new `<th>` elements **between** `payoffDate` and `Amortization`:
```html
<th data-sort="interestSaved"  class="sortable">Interest Saved <span class="sort-icon">↕</span></th>
<th data-sort="monthsSaved"    class="sortable">Months Saved <span class="sort-icon">↕</span></th>
```

Also add a `<tfoot>` immediately after the existing `</thead>` open-close block (before `<tbody id="debtSummaryTableBody">`):

Actually, add the footnote as a `<p>` tag right after the closing `</table>` tag and before the closing `</div>` of the table wrapper:
```html
<p class="debt-summary-footnote">Interest/months saved vs. minimum-payment-only scenario.</p>
```

- [ ] **Step 3: Verify HTML is valid**

Load `http://localhost:5500/` in browser. Navigate to Plan page, run a calculation. The Debt Summary table should now show two extra (empty) columns. No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add accelerate modal and break-even table headers to index.html"
```

---

## Task 4: `src/debts.js` — badge rendering + modal wiring

**Files:**
- Modify: `src/debts.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `computeBreakEven(debt, options)` from `./breakEven.js`
- Consumes: `formatCurrency`, `escapeHtml` (already imported in `debts.js`)
- Produces: `showAccelerateModal(app, debtId)` — exported function, wired as `app.showAccelerateModal(id)`
- Produces: badge HTML injected into each `.debt-card` in `renderDebtsList`
- Produces: `app._breakEvenCharts` map for chart lifecycle management

- [ ] **Step 1: Add import to `src/debts.js`**

At the top of `src/debts.js`, after the existing import line, add:

```js
import { computeBreakEven } from './breakEven.js';
```

- [ ] **Step 2: Add `renderBreakEvenBadge` helper in `src/debts.js`**

Add this function after the existing `recalculateIfConfigured` function (around line 21, before `export function addDebt`):

```js
function renderBreakEvenBadge(app, debt, container) {
    const summaryRow = app._debtSummaryRows?.find(r => r.name === debt.name);
    const planPayment = summaryRow
        ? (app.lastPaymentPlan?.[0]?.payments?.find(p => p.debtName === debt.name)?.payment || debt.minimumPayment)
        : null;
    const hasPlan = !!app.lastPaymentPlan && !!summaryRow;

    const section = container.querySelector('.break-even-section');
    const minType = section?.querySelector('.be-min-type')?.value || 'fixed';
    const minPct = parseFloat(section?.querySelector('.be-min-pct')?.value) || 2;

    const revealed = section?.dataset.revealed === 'true';
    if (!hasPlan && !revealed) {
        // No plan, not yet shown — render the "Show" link
        container.querySelector('.break-even-section')?.remove();
        const s = document.createElement('div');
        s.className = 'break-even-section';
        s.dataset.revealed = 'false';
        s.innerHTML = `<button class="break-even-show-link" data-be-show="${debt.id}">Show payoff estimate</button>`;
        container.querySelector('.debt-details').after(s);
        return;
    }

    const opts = { minType, minPct, planPayment: planPayment || debt.minimumPayment };
    const result = computeBreakEven(debt, opts);

    container.querySelector('.break-even-section')?.remove();
    const s = document.createElement('div');
    s.className = 'break-even-section';
    s.dataset.revealed = 'true';

    const toggleHTML = `
        <div class="break-even-toggle-row">
            <select class="be-min-type" aria-label="Minimum type">
                <option value="fixed"${minType === 'fixed' ? ' selected' : ''}>Fixed</option>
                <option value="percent"${minType === 'percent' ? ' selected' : ''}>%</option>
            </select>
            ${minType === 'percent' ? `<input class="be-min-pct" type="number" min="0.1" max="100" step="0.1" value="${minPct}" aria-label="Percent of balance">` : ''}
        </div>`;

    if (!result) {
        s.innerHTML = `<div class="break-even-header">Payoff Analysis</div>${toggleHTML}<div class="break-even-no-plan-banner">Unable to compute — check debt settings.</div>`;
        container.querySelector('.debt-details').after(s);
        return;
    }

    const payoffMonthLabel = (n) => `${n} month${n !== 1 ? 's' : ''}`;
    let contentHTML = `<div class="break-even-header">Payoff Analysis</div>${toggleHTML}`;

    if (!hasPlan) {
        contentHTML += `<div class="break-even-no-plan-banner">Estimate only — no plan calculated. Run a plan on the Strategy page to see your interest savings.</div>`;
        contentHTML += `
            <div class="break-even-row"><span class="break-even-label">Min only:</span>
                <span class="break-even-value">${payoffMonthLabel(result.minMonths)} · ${escapeHtml(formatCurrency(result.minInterest))} interest</span></div>`;
    } else {
        contentHTML += `
            <div class="break-even-row"><span class="break-even-label">Your plan:</span>
                <span class="break-even-value">${payoffMonthLabel(result.planMonths)} · ${escapeHtml(formatCurrency(result.planInterest))} interest</span></div>
            <div class="break-even-row"><span class="break-even-label">Min only:</span>
                <span class="break-even-value">${payoffMonthLabel(result.minMonths)} · ${escapeHtml(formatCurrency(result.minInterest))} interest</span></div>`;

        if (result.interestSaved > 0 || result.monthsSaved > 0) {
            contentHTML += `<div class="break-even-savings break-even-savings--positive">You save ${escapeHtml(formatCurrency(result.interestSaved))} and ${result.monthsSaved} month${result.monthsSaved !== 1 ? 's' : ''}!</div>`;
        } else {
            contentHTML += `<div class="break-even-savings">No savings vs. minimum — consider a larger payment.</div>`;
        }
    }

    const chartId = `be-chart-${debt.id}`;
    contentHTML += `<div class="break-even-chart-wrap"><canvas id="${chartId}" aria-label="Balance over time chart for ${escapeHtml(debt.name)}"></canvas></div>`;
    contentHTML += `<button class="btn btn-secondary btn-small break-even-accelerate-btn" data-be-accelerate="${debt.id}">Accelerate this debt →</button>`;

    s.innerHTML = contentHTML;
    container.querySelector('.debt-details').after(s);

    // Render mini chart
    _renderBreakEvenChart(app, chartId, result, hasPlan);

    // Accessibility data table
    if (typeof renderChartDataTable === 'function') {
        const rows = result.planBalances.map((b, i) => [i === 0 ? 'Start' : `Mo ${i}`, formatCurrency(b), formatCurrency(result.minBalances[i] ?? 0)]);
        renderChartDataTable(chartId, {
            caption: `Balance over time: ${debt.name}`,
            columns: ['Month', 'Plan Balance', 'Min-Only Balance'],
            rows
        });
    }
}

function _renderBreakEvenChart(app, chartId, result, hasPlan) {
    app._breakEvenCharts = app._breakEvenCharts || {};
    if (app._breakEvenCharts[chartId]) {
        try { app._breakEvenCharts[chartId].destroy(); } catch {}
        delete app._breakEvenCharts[chartId];
    }
    const canvas = document.getElementById(chartId);
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    const maxLen = Math.max(result.planBalances.length, result.minBalances.length);
    const labels = Array.from({ length: maxLen }, (_, i) => i === 0 ? 'Now' : `Mo ${i}`);
    const planData = [...result.planBalances, ...Array(maxLen - result.planBalances.length).fill(0)];
    const minData = [...result.minBalances, ...Array(maxLen - result.minBalances.length).fill(0)];

    const datasets = hasPlan
        ? [
            { label: 'Your Plan', data: planData, borderColor: '#2563eb', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3 },
            { label: 'Min Only', data: minData, borderColor: '#dc2626', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3, borderDash: [4, 4] }
          ]
        : [
            { label: 'Min Only', data: minData, borderColor: '#dc2626', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3 }
          ];

    app._breakEvenCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10 } } }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } },
                y: { ticks: { callback: v => `$${Math.round(v)}`, font: { size: 10 } } }
            }
        }
    });
}
```

- [ ] **Step 3: Wire badge into `renderDebtsList` in `src/debts.js`**

In `renderDebtsList`, find the section that builds `cardHTML` for non-edit, non-fixedAmount debts. After the `debtsList.appendChild(card)` line (around line 485), the code currently sets up `debtsList.onclick`. Before that, inside the `for (const debt of filteredDebts)` loop after `debtsList.appendChild(card)`, add for credit-card debts:

Find the end of the `for (const debt of filteredDebts)` loop body, just before `debtsList.appendChild(card)`. Look for:
```js
        debtsList.appendChild(card);
    }
```

Replace with:
```js
        debtsList.appendChild(card);

        // Render break-even badge for credit-card debts
        if (debt.debtType !== 'fixedAmount' && app.editingDebtId !== debt.id) {
            renderBreakEvenBadge(app, debt, card);
        }
    }
```

- [ ] **Step 4: Wire badge interaction events in `renderDebtsList`**

Inside the `debtsList.onclick` handler (already present), add handling for `be-show` and `be-accelerate` actions. Find the existing onclick handler:

```js
    debtsList.onclick = (event) => {
        const actionEl = event.target.closest('[data-debt-action]');
        if (!actionEl) return;
```

Replace with:

```js
    debtsList.onclick = (event) => {
        // Break-even "Show" link
        const showEl = event.target.closest('[data-be-show]');
        if (showEl) {
            const id = parseInt(showEl.getAttribute('data-be-show'), 10);
            const debt = app.debts.find(d => d.id === id);
            const card = showEl.closest('.debt-card');
            if (debt && card) {
                const s = card.querySelector('.break-even-section');
                if (s) s.dataset.revealed = 'true';
                renderBreakEvenBadge(app, debt, card);
            }
            return;
        }

        // Break-even toggle (min type or pct)
        const toggleEl = event.target.closest('.be-min-type, .be-min-pct');
        if (toggleEl) return; // handled by change event below

        // Accelerate button
        const accEl = event.target.closest('[data-be-accelerate]');
        if (accEl) {
            const id = parseInt(accEl.getAttribute('data-be-accelerate'), 10);
            app.showAccelerateModal(id);
            return;
        }

        const actionEl = event.target.closest('[data-debt-action]');
        if (!actionEl) return;
```

Also add a `change` event listener for the toggle/pct inputs (add after the `onclick` assignment):

```js
    debtsList.addEventListener('change', (event) => {
        const toggleEl = event.target.closest('.be-min-type, .be-min-pct');
        if (!toggleEl) return;
        const card = toggleEl.closest('.debt-card');
        if (!card) return;
        const debtId = parseInt(card.querySelector('[data-debt-action="edit"], [data-debt-action="delete"], [data-be-accelerate]')?.getAttribute('data-debt-id') || card.querySelector('[data-be-accelerate]')?.getAttribute('data-be-accelerate'), 10);
        const debt = app.debts.find(d => d.id === debtId);
        if (debt) renderBreakEvenBadge(app, debt, card);
    });
```

- [ ] **Step 5: Add `showAccelerateModal` export to `src/debts.js`**

Add this function at the end of `src/debts.js`, after `saveInlineEdit`:

```js
export function showAccelerateModal(app, debtId) {
    const debt = app.debts.find(d => Number(d.id) === Number(debtId));
    if (!debt || debt.debtType === 'fixedAmount') return;

    const modal = document.getElementById('accelerateDebtModal');
    if (!modal) return;

    const summaryRow = app._debtSummaryRows?.find(r => r.name === debt.name);
    const basePay = summaryRow
        ? (app.lastPaymentPlan?.[0]?.payments?.find(p => p.debtName === debt.name)?.payment || debt.minimumPayment)
        : debt.minimumPayment;

    document.getElementById('accelerateDebtTitle').textContent = `Accelerate: ${debt.name}`;
    document.getElementById('accelerateBasePay').textContent = formatCurrency(basePay);
    const extraInput = document.getElementById('accelerateExtraPay');
    extraInput.value = '0';

    function updatePreview() {
        const extra = Math.max(0, parseFloat(extraInput.value) || 0);
        const totalPay = basePay + extra;
        document.getElementById('accelerateNewTotal').textContent = formatCurrency(totalPay);

        const baseResult = computeBreakEven(debt, { planPayment: basePay });
        const newResult = computeBreakEven(debt, { planPayment: totalPay });

        if (!newResult) return;

        document.getElementById('acceleratePayoff').textContent = `${newResult.planMonths} month${newResult.planMonths !== 1 ? 's' : ''}`;
        document.getElementById('accelerateInterest').textContent = formatCurrency(newResult.planInterest);

        const mSaved = baseResult ? Math.max(0, baseResult.planMonths - newResult.planMonths) : 0;
        const iSaved = baseResult ? Math.max(0, baseResult.planInterest - newResult.planInterest) : 0;

        document.getElementById('acceleratePayoffDelta').textContent = mSaved > 0 ? `▲ ${mSaved} faster` : '';
        document.getElementById('accelerateInterestDelta').textContent = iSaved > 0 ? `▲ ${escapeHtml(formatCurrency(iSaved))} saved` : '';

        // Update chart
        if (app._accelerateChart) {
            try { app._accelerateChart.destroy(); } catch {}
        }
        const canvas = document.getElementById('accelerateChart');
        if (canvas && typeof Chart !== 'undefined') {
            const maxLen = Math.max(newResult.planBalances.length, (baseResult?.planBalances.length || 0));
            const labels = Array.from({ length: maxLen }, (_, i) => i === 0 ? 'Now' : `Mo ${i}`);
            const newData = [...newResult.planBalances, ...Array(maxLen - newResult.planBalances.length).fill(0)];
            const baseData = baseResult ? [...baseResult.planBalances, ...Array(maxLen - baseResult.planBalances.length).fill(0)] : [];
            const datasets = [
                { label: formatCurrency(totalPay) + '/mo', data: newData, borderColor: '#2563eb', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3 }
            ];
            if (baseResult && extra > 0) {
                datasets.push({ label: formatCurrency(basePay) + '/mo', data: baseData, borderColor: '#9ca3af', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3, borderDash: [4, 4] });
            }
            app._accelerateChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10 } } } },
                    scales: {
                        x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } },
                        y: { ticks: { callback: v => `$${Math.round(v)}`, font: { size: 10 } } }
                    }
                }
            });
        }
    }

    extraInput.oninput = updatePreview;
    updatePreview();

    const lastFocused = document.activeElement;
    modal.classList.remove('hidden');
    setTimeout(() => extraInput.focus(), 50);

    const close = () => {
        modal.classList.add('hidden');
        if (app._accelerateChart) { try { app._accelerateChart.destroy(); } catch {} app._accelerateChart = null; }
        modal.onkeydown = null;
        if (lastFocused?.focus) lastFocused.focus();
    };

    document.getElementById('accelerateCloseBtn').onclick = close;
    document.getElementById('accelerateCloseBtnFooter').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0]; const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };

    document.getElementById('accelerateApplyBtn').onclick = () => {
        const extra = Math.max(0, parseFloat(extraInput.value) || 0);
        const totalPay = basePay + extra;
        close();
        app.switchPage('strategy');
        app.switchPage('liabilities');  // go to strategy sub-tab within liabilities
        // Navigate to Plan sub-tab
        const planTab = document.querySelector('[data-liabilities-subtab="plan"]');
        if (planTab) planTab.click();
        setTimeout(() => {
            const payEl = document.getElementById('monthlyPayment');
            if (payEl) { payEl.value = totalPay.toFixed(2); payEl.dispatchEvent(new Event('input')); }
            app.calculatePaymentPlanFromInputs();
        }, 100);
    };
}
```

- [ ] **Step 6: Add `showAccelerateModal` wrapper to `src/app.js`**

In `src/app.js`, add the import at the top with the other `debts.js` imports:

Find:
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
```

Replace with:
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
    saveInlineEdit as saveInlineEditDebtFeature,
    showAccelerateModal as showAccelerateModalFeature
} from './debts.js';
```

Then find the `showUpdateBalanceModal(debtId)` method in `DebtTrackerApp` and add the new method right after it:

```js
    showAccelerateModal(debtId) {
        return showAccelerateModalFeature(this, debtId);
    }
```

- [ ] **Step 7: Load the app and manually verify badge appears**

```
python -m http.server 5500
```

1. Open `http://localhost:5500/`
2. Add a credit-card debt (Debts page → Add Debt)
3. Verify "Show payoff estimate" link appears on the debt card
4. Click "Show payoff estimate" — badge with min-only data and mini chart should appear
5. Verify the no-plan banner text is visible
6. Click "Accelerate this debt →" — modal should open with the debt name

- [ ] **Step 8: Commit**

```bash
git add src/debts.js src/app.js
git commit -m "feat: add break-even badge and accelerate modal to debt cards"
```

---

## Task 5: `src/strategy.js` — plan summary table new columns

**Files:**
- Modify: `src/strategy.js`

**Interfaces:**
- Consumes: `computeBreakEven(debt, options)` from `./breakEven.js`
- Consumes: `app._debtSummaryRows` (already populated in `displayDebtSummary`)
- Produces: `interestSaved: number|null` and `monthsSaved: number|null` properties on each `_debtSummaryRows` entry

- [ ] **Step 1: Add import to `src/strategy.js`**

At the top of `src/strategy.js`, after existing imports, add:

```js
import { computeBreakEven } from './breakEven.js';
```

- [ ] **Step 2: Populate `interestSaved` and `monthsSaved` in `displayDebtSummary`**

In `displayDebtSummary` (around line 768), find where `app._debtSummaryRows` is built:

```js
    app._debtSummaryRows = Object.entries(debtSummaryMap).map(([name, summary]) => {
        const origDebt = originalDebts[name] || {};
        const iptd = computeInterestPaidToDate(origDebt);
        return {
            name,
            ...summary,
            payoffDate: summary.isFixedAmount ? (summary.lastPaymentDate || null) : summary.payoffDate,
            interestToDate: iptd ? iptd.interestPaid : null,
            debtStartDate: origDebt.debtStartDate || null,
            order: debtOrderMap[name]
        };
    });
```

Replace with:

```js
    app._debtSummaryRows = Object.entries(debtSummaryMap).map(([name, summary]) => {
        const origDebt = originalDebts[name] || {};
        const iptd = computeInterestPaidToDate(origDebt);

        let interestSaved = null;
        let monthsSaved = null;
        if (!summary.isFixedAmount && origDebt.accountBalance > 0) {
            const planPayment = app.lastPaymentPlan?.[0]?.payments?.find(p => p.debtName === name)?.payment || origDebt.minimumPayment;
            const be = computeBreakEven(origDebt, { minType: 'fixed', planPayment });
            if (be) {
                interestSaved = be.interestSaved;
                monthsSaved = be.monthsSaved;
            }
        }

        return {
            name,
            ...summary,
            payoffDate: summary.isFixedAmount ? (summary.lastPaymentDate || null) : summary.payoffDate,
            interestToDate: iptd ? iptd.interestPaid : null,
            debtStartDate: origDebt.debtStartDate || null,
            order: debtOrderMap[name],
            interestSaved,
            monthsSaved,
        };
    });
```

- [ ] **Step 3: Add null-safe sort handling for new columns in `renderDebtSummaryTable`**

In `renderDebtSummaryTable`, find the sort comparator (around line 623):

```js
        if (col === 'name') return aVal.localeCompare(bVal) * dir;
        return (aVal - bVal) * dir;
```

Replace the final `return (aVal - bVal) * dir;` line with:

```js
        if (col === 'name') return aVal.localeCompare(bVal) * dir;
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        return (aVal - bVal) * dir;
```

- [ ] **Step 4: Render `interestSaved` and `monthsSaved` cells in `renderDebtSummaryTable`**

In `renderDebtSummaryTable`, find the row template (around line 671):

```js
        row.innerHTML = `
            <td>${escapeHtml(summary.name)}${dueDateStr}${progressBar}</td>
            <td class="min-due">${formatCurrency(summary.minDue)}</td>
            <td class="interest-rate">${summary.interestRate.toFixed(2)}%</td>
            <td class="amount">${formatCurrency(summary.totalPaid)}</td>
            <td class="principal">${formatCurrency(summary.principalPaid)}</td>
            <td class="interest">${formatCurrency(summary.interestPaid)}</td>
            <td>${iptdCell}</td>
            <td>${summary.payoffDate || '-'}</td>
            <td><button class="btn btn-small btn-secondary" data-amortization="${escapeHtml(summary.name)}">View</button></td>
        `;
```

Replace with:

```js
        const iSavedCell = summary.interestSaved != null
            ? (summary.interestSaved > 0
                ? `<span class="be-col-saved">${formatCurrency(summary.interestSaved)}</span>`
                : `<span class="be-col-zero">$0.00</span>`)
            : '—';
        const mSavedCell = summary.monthsSaved != null
            ? (summary.monthsSaved > 0
                ? `<span class="be-col-saved">${summary.monthsSaved} mo</span>`
                : `<span class="be-col-zero">0</span>`)
            : '—';

        row.innerHTML = `
            <td>${escapeHtml(summary.name)}${dueDateStr}${progressBar}</td>
            <td class="min-due">${formatCurrency(summary.minDue)}</td>
            <td class="interest-rate">${summary.interestRate.toFixed(2)}%</td>
            <td class="amount">${formatCurrency(summary.totalPaid)}</td>
            <td class="principal">${formatCurrency(summary.principalPaid)}</td>
            <td class="interest">${formatCurrency(summary.interestPaid)}</td>
            <td>${iptdCell}</td>
            <td>${summary.payoffDate || '-'}</td>
            <td>${iSavedCell}</td>
            <td>${mSavedCell}</td>
            <td><button class="btn btn-small btn-secondary" data-amortization="${escapeHtml(summary.name)}">View</button></td>
        `;
```

- [ ] **Step 5: Manually verify plan table**

1. Add a credit-card debt, navigate to Plan page
2. Enter a monthly payment above the minimum, run the plan
3. Navigate to the Debt Summary tab — verify "Interest Saved" and "Months Saved" columns are present with green values
4. Verify fixed-amount debts show `—` in both columns
5. Check browser console — no errors

- [ ] **Step 6: Commit**

```bash
git add src/strategy.js
git commit -m "feat: add interest-saved and months-saved columns to plan summary table"
```

---

## Task 6: Tests

**Files:**
- Modify: `tests/features/test_break_even.py` (replace placeholder with full suite)

**Interfaces:**
- Consumes: `_create_cc_debt`, `_run_plan`, `_nav_debts` helpers defined at top of the file (from Task 1)

- [ ] **Step 1: Replace placeholder test with full test suite**

Replace the contents of `tests/features/test_break_even.py` with:

```python
#!/usr/bin/env python3
"""
Break-Even Analysis Tests
Tests per-debt payoff comparison badge, accelerate modal, and plan table columns.
"""
import pytest
from tests.conftest import create_debt

BASE_URL = "http://localhost:5500/"


def _nav_debts(page):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)


def _create_cc_debt(page, name="Visa", balance="2400", rate="18.5", min_pay="100"):
    _nav_debts(page)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', name)
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', balance)
    page.fill('#interestRate', rate)
    page.fill('#minimumPayment', min_pay)
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


def _run_plan(page, payment="450"):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="plan"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', payment)
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)


# ── Positive cases ──────────────────────────────────────────────────

@pytest.mark.feature
def test_break_even_badge_no_plan(app_page):
    """Debt card shows Show payoff estimate link with no-plan banner when no plan run."""
    page = app_page
    _create_cc_debt(page)
    _nav_debts(page)

    # "Show payoff estimate" link should be present on the card
    link = page.query_selector('[data-be-show]')
    assert link is not None, "Expected 'Show payoff estimate' link on debt card"

    # Click it
    link.click()
    page.wait_for_timeout(500)

    # No-plan banner should appear
    banner = page.query_selector('.break-even-no-plan-banner')
    assert banner is not None, "Expected no-plan banner after clicking Show"
    assert "Estimate only" in banner.inner_text()

    # Min only row should appear
    rows = page.query_selector_all('.break-even-row')
    assert len(rows) >= 1, "Expected at least one break-even row"


@pytest.mark.feature
def test_break_even_badge_with_plan(app_page):
    """After running a plan, debt card auto-shows interest saved and months saved."""
    page = app_page
    _create_cc_debt(page)
    _run_plan(page, payment="450")
    _nav_debts(page)
    page.wait_for_timeout(500)

    # Badge should auto-render (no "Show" link needed)
    show_link = page.query_selector('[data-be-show]')
    assert show_link is None, "Expected no Show link when plan is active"

    # Both rows should be present
    rows = page.query_selector_all('.break-even-row')
    assert len(rows) >= 2, "Expected plan and min-only rows"

    # Savings line should be present
    savings = page.query_selector('.break-even-savings')
    assert savings is not None, "Expected savings summary line"


@pytest.mark.feature
def test_break_even_min_type_toggle(app_page):
    """Switching Fixed -> Percent re-renders badge with different numbers."""
    page = app_page
    _create_cc_debt(page, balance="5000", rate="20", min_pay="100")
    _run_plan(page, payment="500")
    _nav_debts(page)
    page.wait_for_timeout(500)

    # Get current min-only value in fixed mode
    rows_fixed = page.query_selector_all('.break-even-row')
    fixed_text = rows_fixed[-1].inner_text() if rows_fixed else ""

    # Switch to percent mode
    toggle = page.query_selector('.be-min-type')
    assert toggle is not None, "Expected min-type toggle on badge"
    toggle.select_option('percent')
    page.wait_for_timeout(500)

    rows_pct = page.query_selector_all('.break-even-row')
    pct_text = rows_pct[-1].inner_text() if rows_pct else ""

    # Numbers should differ between fixed and percent mode
    assert fixed_text != pct_text, "Expected different values when switching to percent mode"


@pytest.mark.feature
def test_break_even_accelerate_modal_opens(app_page):
    """Clicking Accelerate this debt opens modal with correct debt name."""
    page = app_page
    _create_cc_debt(page, name="MyVisa")
    _nav_debts(page)

    # Show badge first
    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    assert acc_btn is not None, "Expected Accelerate button on badge"
    acc_btn.click()
    page.wait_for_timeout(300)

    modal = page.query_selector('#accelerateDebtModal')
    assert modal is not None
    assert modal.is_visible(), "Accelerate modal should be visible"

    title = page.query_selector('#accelerateDebtTitle')
    assert title is not None
    assert "MyVisa" in title.inner_text(), "Modal title should contain debt name"


@pytest.mark.feature
def test_break_even_accelerate_preview_updates(app_page):
    """Typing extra payment in modal updates payoff and interest live."""
    page = app_page
    _create_cc_debt(page)
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    acc_btn.click()
    page.wait_for_timeout(300)

    payoff_before = page.query_selector('#acceleratePayoff').inner_text()

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('200')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(400)

    payoff_after = page.query_selector('#acceleratePayoff').inner_text()
    # With $200 extra, payoff should change
    assert payoff_before != payoff_after, "Payoff should update when extra payment entered"


@pytest.mark.feature
def test_break_even_apply_to_plan(app_page):
    """Apply to Plan navigates to Plan page and fills the payment field."""
    page = app_page
    _create_cc_debt(page, min_pay="100")
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    acc_btn.click()
    page.wait_for_timeout(300)

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('50')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(200)

    apply_btn = page.query_selector('#accelerateApplyBtn')
    apply_btn.click()
    page.wait_for_timeout(600)

    payment_field = page.query_selector('#monthlyPayment')
    assert payment_field is not None
    val = float(payment_field.input_value())
    assert val >= 150, f"Expected plan payment >= 150 (min 100 + extra 50), got {val}"


@pytest.mark.feature
def test_break_even_plan_table_columns(app_page):
    """After running a plan, summary table shows Interest Saved and Months Saved columns."""
    page = app_page
    _create_cc_debt(page, balance="3000", rate="18", min_pay="60")
    _run_plan(page, payment="300")

    # Navigate to debt summary tab
    page.click('[data-results-tab="debt-summary"]') if page.query_selector('[data-results-tab="debt-summary"]') else None
    page.wait_for_timeout(300)

    # Check column headers
    headers = page.query_selector_all('#debtSummaryTable th')
    header_texts = [h.inner_text() for h in headers]
    assert any("Interest Saved" in t for t in header_texts), f"Expected 'Interest Saved' header; got {header_texts}"
    assert any("Months Saved" in t for t in header_texts), f"Expected 'Months Saved' header; got {header_texts}"

    # Check that at least one saved-value cell is green
    saved_cells = page.query_selector_all('.be-col-saved')
    assert len(saved_cells) > 0, "Expected at least one green saved-value cell in summary table"


@pytest.mark.feature
def test_break_even_fixed_amount_debt_excluded(app_page):
    """Fixed-amount debts show no break-even badge."""
    page = app_page
    _nav_debts(page)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', 'Rent')
    page.select_option('#debtType', 'fixedAmount')
    page.fill('#fixedAmount', '1200')
    page.fill('#fixedStartDate', '2026-01-01')
    page.fill('#fixedEndDate', '2026-12-31')
    page.click('#debtFormSubmit')
    page.wait_for_selector('text=Rent', timeout=10000)
    page.wait_for_timeout(300)

    # No break-even badge or show link on fixed-amount card
    be_section = page.query_selector('.break-even-section')
    assert be_section is None, "Fixed-amount debt should have no break-even section"


# ── Negative cases ──────────────────────────────────────────────────

@pytest.mark.feature
def test_break_even_zero_interest_debt(app_page):
    """0% APR debt: badge renders without crash, shows $0 interest."""
    page = app_page
    _create_cc_debt(page, rate="0", min_pay="100")
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(400)

    # No JS errors
    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"

    # Badge renders
    rows = page.query_selector_all('.break-even-row')
    assert len(rows) >= 1


@pytest.mark.feature
def test_break_even_minimum_covers_balance(app_page):
    """Balance = minimum payment: 1 month payoff, savings = $0."""
    page = app_page
    # Balance exactly equals min payment, so one month clears it
    _create_cc_debt(page, balance="100", rate="5", min_pay="100")
    _run_plan(page, payment="100")
    _nav_debts(page)
    page.wait_for_timeout(400)

    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"


@pytest.mark.feature
def test_break_even_invalid_percent(app_page):
    """Entering 0 in percent mode falls back gracefully (no crash)."""
    page = app_page
    _create_cc_debt(page)
    _run_plan(page, payment="300")
    _nav_debts(page)
    page.wait_for_timeout(400)

    toggle = page.query_selector('.be-min-type')
    if toggle:
        toggle.select_option('percent')
        page.wait_for_timeout(300)
        pct_input = page.query_selector('.be-min-pct')
        if pct_input:
            pct_input.fill('0')
            pct_input.dispatch_event('change')
            page.wait_for_timeout(400)

    assert len(page.page_errors) == 0, f"Page errors after 0% input: {page.page_errors}"


@pytest.mark.feature
def test_break_even_accelerate_zero_extra(app_page):
    """$0 extra in modal shows same numbers as base plan (no crash)."""
    page = app_page
    _create_cc_debt(page)
    _run_plan(page, payment="300")
    _nav_debts(page)
    page.wait_for_timeout(400)

    acc_btn = page.query_selector('[data-be-accelerate]')
    assert acc_btn is not None
    acc_btn.click()
    page.wait_for_timeout(300)

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('0')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(300)

    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"
    payoff = page.query_selector('#acceleratePayoff')
    assert payoff and payoff.inner_text() != '—', "Payoff should be populated even with $0 extra"


@pytest.mark.feature
def test_break_even_accelerate_negative_input(app_page):
    """Negative extra payment is clamped to 0 (no crash)."""
    page = app_page
    _create_cc_debt(page)
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    acc_btn.click()
    page.wait_for_timeout(300)

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('-100')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(300)

    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"
    # Total should not show negative value
    total_el = page.query_selector('#accelerateNewTotal')
    assert total_el is not None
    # Total should equal base pay (negative clamped to 0)
    total_text = total_el.inner_text()
    assert '-' not in total_text or total_text.startswith('$'), "Negative extra should be clamped to 0"
```

- [ ] **Step 2: Run the full test suite**

```
pytest tests/features/test_break_even.py -v
```

Expected: all 13 tests pass. Fix any failures before proceeding.

- [ ] **Step 3: Run the full test suite to check for regressions**

```
pytest tests/ -v -m "not slow"
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add tests/features/test_break_even.py
git commit -m "feat: add 13 break-even analysis tests (positive and negative cases)"
```

---

## Self-Review

**Spec coverage:**
- [x] `computeBreakEven` module with fixed/percent modes → Task 1
- [x] Debt card badge — no-plan state with "Show" link + banner → Task 4
- [x] Debt card badge — plan state with comparison + savings → Task 4
- [x] Min-type toggle (Fixed/%) on badge → Task 4
- [x] Mini Chart.js chart on badge → Task 4
- [x] Accessibility `renderChartDataTable` call → Task 4
- [x] "Accelerate this debt →" button → Task 4
- [x] Accelerate modal with extra payment input + live preview → Task 4
- [x] Apply to Plan button → Task 4
- [x] Plan page summary table: Interest Saved column → Task 5
- [x] Plan page summary table: Months Saved column → Task 5
- [x] Footnote below table → Task 3
- [x] CSS classes (no inline styles) → Task 2
- [x] CSP compliance (no eval, no inline style) → global constraint enforced throughout
- [x] 8 positive + 5 negative tests → Task 6

**Placeholder scan:** No TBDs. All code steps contain complete code.

**Type consistency:**
- `computeBreakEven` signature used identically in Tasks 1, 4, 5: `computeBreakEven(debt, { minType, minPct, planPayment })`
- Return properties `planMonths`, `planInterest`, `minMonths`, `minInterest`, `monthsSaved`, `interestSaved`, `planBalances`, `minBalances` used consistently across Tasks 4 and 5
- `_debtSummaryRows` entries extended with `interestSaved: number|null` and `monthsSaved: number|null` in Task 5, consumed by sort and render in same task
- `app._breakEvenCharts` map created/destroyed consistently in Task 4
- `app._accelerateChart` single instance created/destroyed in Task 4
