# Bonus Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user tag a one-time bonus with a Purpose (Cash Flow vs Long-term Savings) and, on request, see computed numbers for each option so the choice is informed.

**Architecture:** A new pure calculation module (`src/bonusAdvisor.js`) reuses two calculation engines that already exist for other features — `DebtCalculator.calculatePaymentPlan` (debt payoff simulation, already supports one-time stimulus payments) for the Cash Flow side, and `dailyCompoundInterest` (already used for account interest) for the Savings side. A thin DOM-input-driven wrapper in the same file reads the live bonus form + Plan page settings and renders a result panel. The bonus record gains a persisted `purpose` field (sanitized, allow-listed) shown as a badge in the existing bonus list.

**Tech Stack:** Vanilla ES6 modules, no build step. Tests: Playwright/pytest (`tests/features/`, `tests/security/`).

## Global Constraints

- No inline `<style>`/`style="..."` attributes — CSP forbids it; all styling via CSS classes in `styles.css`, toggled with `classList`.
- All user-controlled data rendered via `innerHTML` must go through `escapeHtml()` from `src/utils.js`.
- Every persisted/imported field must be sanitized in `src/sanitizers.js` — this session adds `purpose` to `sanitizeBonus`.
- `APP_VERSION` (`src/utils.js`) and `CHANGELOG.md`'s latest `## [x.y.z] — YYYY-MM-DD` heading must match exactly (enforced by `tests/features/test_versioning.py`).
- Follow the existing feature-module pattern: plain functions taking `app` as first argument, with a one-line delegating method added to `DebtTrackerApp` in `src/app.js`.
- Dev server for Playwright tests: `python -m http.server 5500`, tests assume `http://localhost:5500/`.

---

### Task 1: Persist and sanitize the bonus `purpose` field

**Files:**
- Modify: `src/sanitizers.js:56-65` (`sanitizeBonus`)
- Test: `tests/features/test_storage_import.py`

**Interfaces:**
- Produces: `sanitizeBonus(record, idFallback)` now returns an object that also includes `purpose: 'cashFlow' | 'savings' | null`. All later tasks that read `bonus.purpose` rely on this allow-listing already having happened by the time `app.bonuses` is populated (both on load and on import — `sanitizeBonus` is called from the single shared `sanitizeParsedState` in `src/sanitizers.js:216-233`, used by both paths).

- [ ] **Step 1: Write the failing test — extend the existing adversarial-bonus import test**

Open `tests/features/test_storage_import.py` and find `test_import_sanitizes_adversarial_bonus` (around line 475). Add a `purpose` field to the adversarial payload and a new assertion, and add one new positive round-trip test right after it:

```python
def test_import_sanitizes_adversarial_bonus(app_page):
    """XSS/non-finite fields in an imported bonuses entry are sanitized."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            bonuses: [{
                id: 'abc',
                name: '<img src=x onerror=alert(1)>Tax Refund',
                amount: -1000,
                date: '2026-06-18',
                category: '<script>alert(1)</script>',
                accountId: 'not-a-number',
                purpose: '<script>alert(1)</script>'
            }]
        };
        const file = new File([JSON.stringify(payload)], 'bonus.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ bonus: app.bonuses[0] }), 300);
        });
    }""")

    bonus = result['bonus']
    assert bonus is not None, "Bonus with valid name and date should be retained"
    assert '<' not in bonus['name'] and '>' not in bonus['name'], "name should have unsafe characters stripped"
    assert bonus['amount'] == 0, "Negative amount should clamp to 0"
    assert '<' not in bonus['category'] and '>' not in bonus['category'], \
        "category should have unsafe characters stripped"
    assert isinstance(bonus['id'], int), "Bonus id should be sanitized to an integer"
    assert bonus['purpose'] is None, "purpose outside the allow-list should sanitize to null, not pass through raw"


@pytest.mark.feature
def test_import_preserves_valid_bonus_purpose(app_page):
    """A valid purpose value ('cashFlow' or 'savings') survives export -> import round-trip."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            bonuses: [
                { id: 1, name: 'Year-end bonus', amount: 500, date: '2026-06-18', category: 'Bonus', purpose: 'cashFlow' },
                { id: 2, name: 'Tax refund', amount: 300, date: '2026-06-19', category: 'Tax Refund', purpose: 'savings' }
            ]
        };
        const file = new File([JSON.stringify(payload)], 'bonus.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve(app.bonuses.map(b => b.purpose)), 300);
        });
    }""")

    assert result == ['cashFlow', 'savings'], f"Valid purpose values should round-trip unchanged, got {result}"
```

- [ ] **Step 2: Run the tests to verify they fail**

Start the dev server first if it isn't already running: `python -m http.server 5500` (in the repo root, separate terminal/background process).

Run: `pytest tests/features/test_storage_import.py -k "bonus_purpose or adversarial_bonus" -v`
Expected: `test_import_sanitizes_adversarial_bonus` FAILS with a `KeyError: 'purpose'` (the field doesn't exist yet), and `test_import_preserves_valid_bonus_purpose` FAILS the same way.

- [ ] **Step 3: Implement — add `purpose` to `sanitizeBonus`**

In `src/sanitizers.js`, replace the existing function:

```javascript
export function sanitizeBonus(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        date: sanitizeDateISO(record?.date),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null)
    };
}
```

with:

```javascript
export function sanitizeBonus(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        date: sanitizeDateISO(record?.date),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null),
        purpose: (record?.purpose === 'cashFlow' || record?.purpose === 'savings') ? record.purpose : null
    };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/features/test_storage_import.py -k "bonus_purpose or adversarial_bonus" -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sanitizers.js tests/features/test_storage_import.py
git commit -m "Add purpose field to bonus sanitizer (#64)"
```

---

### Task 2: `src/bonusAdvisor.js` — pure calculation function

**Files:**
- Create: `src/bonusAdvisor.js`
- Test: none yet (this task is exercised indirectly by Task 3's UI tests; no Jest unit test — `calculateBonusAdvice` is intentionally out of the Stryker/Jest mutation-testing scope, matching the existing precedent that `sanitizeBonus` and most feature-module logic are Playwright-only, not part of `stryker.config.mjs`'s `mutate` list)

**Interfaces:**
- Consumes: global `DebtCalculator.calculatePaymentPlan(debts, monthlyPayment, strategy, monthlyStimulus)` and `DebtCalculator.generateSummary(workingDebts, paymentPlan)` (both already exist, `src/debtCalculator.js`); `dailyCompoundInterest(balance, aprPct, days)` from `src/utils.js`.
- Produces: `calculateBonusAdvice({ bonusAmount, debts, monthlyPayment, strategy, accountRate })` returning:
  ```js
  {
    cashFlow: { applicable: true, interestSaved: number, monthsSaved: number, freedMonthly: number }
             | { applicable: false, reason: string },
    savings: { applicable: true, rate: number, growth1yr: number, growth5yr: number }
  }
  ```
  Task 3 (`showBonusAdvice`) and Task 4 (rendering) consume this exact shape.

- [ ] **Step 1: Create the file with the pure calculation function**

Create `src/bonusAdvisor.js`:

```javascript
// Bonus advisor: compares putting a one-time bonus toward debt payoff
// (cash flow) vs. leaving it to grow in a savings account (long-term
// savings). Reuses the existing debt payoff engine and account-interest
// helper rather than introducing new calculation logic.

import { dailyCompoundInterest, formatCurrency, escapeHtml, sanitizeFiniteNumber } from './utils.js';

/**
 * Pure calculation — no DOM/app access.
 * @param {object} params
 * @param {number} params.bonusAmount
 * @param {object[]} params.debts
 * @param {number} params.monthlyPayment
 * @param {string} params.strategy
 * @param {number} params.accountRate - annual APY percent, 0 if none available
 * @returns {{ cashFlow: object, savings: object }}
 */
export function calculateBonusAdvice({ bonusAmount, debts, monthlyPayment, strategy, accountRate }) {
    return {
        cashFlow: calculateCashFlowAdvice(bonusAmount, debts, monthlyPayment, strategy),
        savings: calculateSavingsAdvice(bonusAmount, accountRate)
    };
}

function calculateCashFlowAdvice(bonusAmount, debts, monthlyPayment, strategy) {
    const hasDebts = Array.isArray(debts) && debts.length > 0;
    const hasInterestBearingDebt = hasDebts && debts.some(d => d.debtType !== 'fixedAmount');

    if (!hasDebts) {
        return { applicable: false, reason: 'Add a debt first to see the cash flow impact.' };
    }
    if (!hasInterestBearingDebt) {
        return { applicable: false, reason: 'All current debts are fixed-amount and never receive extra payments.' };
    }
    if (!(bonusAmount > 0)) {
        return { applicable: false, reason: 'Enter a bonus amount to see the cash flow impact.' };
    }

    try {
        const baseline = DebtCalculator.calculatePaymentPlan(debts, monthlyPayment, strategy, 0);
        const withBonus = DebtCalculator.calculatePaymentPlan(debts, monthlyPayment, strategy, [bonusAmount]);
        const baselineSummary = DebtCalculator.generateSummary(baseline.workingDebts, baseline.paymentPlan);
        const withBonusSummary = DebtCalculator.generateSummary(withBonus.workingDebts, withBonus.paymentPlan);

        const interestSaved = Math.max(0, parseFloat((baselineSummary.totalInterest - withBonusSummary.totalInterest).toFixed(2)));
        const monthsSaved = Math.max(0, baseline.paymentPlan.length - withBonus.paymentPlan.length);

        let freedMonthly = 0;
        for (const debt of withBonus.workingDebts) {
            const baselineDebt = baseline.workingDebts.find(d => d.id === debt.id);
            if (baselineDebt && debt.paidOffMonth && baselineDebt.paidOffMonth
                && debt.paidOffMonth < baselineDebt.paidOffMonth) {
                freedMonthly += debt.minimumPayment || 0;
            }
        }

        return {
            applicable: true,
            interestSaved,
            monthsSaved,
            freedMonthly: parseFloat(freedMonthly.toFixed(2))
        };
    } catch (err) {
        return { applicable: false, reason: 'Unable to calculate a payment plan for your current debts.' };
    }
}

function calculateSavingsAdvice(bonusAmount, accountRate) {
    const rate = accountRate > 0 ? accountRate : 0;
    return {
        applicable: true,
        rate,
        growth1yr: parseFloat(dailyCompoundInterest(bonusAmount || 0, rate, 365).toFixed(2)),
        growth5yr: parseFloat(dailyCompoundInterest(bonusAmount || 0, rate, 365 * 5).toFixed(2))
    };
}
```

(The DOM-input-driven entry point (`showBonusAdvice`) and HTML renderer are added in the next step of this same task, since they're small and belong in the same file — mirrors `strategyPlanCalculation.js` bundling both the calc entry point and result rendering together.)

- [ ] **Step 2: Add the DOM-input-driven entry point and renderer to the same file**

Append to `src/bonusAdvisor.js`:

```javascript
/**
 * Read the live bonus form + Plan page settings, compute advice, and render
 * the result panel. DOM-input-driven entry point, called from the "What
 * should I do with this?" button in the bonus form.
 */
export function showBonusAdvice(app) {
    const resultEl = document.getElementById('bonusAdviceResult');
    if (!resultEl) return;

    const rawAmount = document.getElementById('bonusAmount')?.value;
    const bonusAmount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) {
        alert('Please enter a valid amount before requesting advice.');
        return;
    }

    const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;
    const advice = calculateBonusAdvice({
        bonusAmount,
        debts: app.debts || [],
        monthlyPayment: getConfiguredMonthlyPayment(app),
        strategy: document.getElementById('paymentStrategy')?.value || 'avalanche',
        accountRate: getAccountRate(app, accountId)
    });

    resultEl.innerHTML = renderAdviceHtml(advice);
}

function getConfiguredMonthlyPayment(app) {
    const totalMinimum = (app.debts || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const configured = parseFloat(document.getElementById('monthlyPayment')?.value);
    return (configured && configured >= totalMinimum) ? configured : totalMinimum;
}

function getAccountRate(app, accountId) {
    const accounts = app.accounts || [];
    if (accountId) {
        const linked = accounts.find(a => a.id === accountId);
        if (linked && linked.interestRate > 0) return linked.interestRate;
    }
    return accounts.reduce((max, a) => Math.max(max, a.interestRate || 0), 0);
}

function renderAdviceHtml(advice) {
    const cf = advice.cashFlow;
    const sv = advice.savings;

    const cashFlowBody = cf.applicable
        ? `<div class="bonus-advice-stat"><strong>${formatCurrency(cf.interestSaved)}</strong> interest saved</div>
           <div class="bonus-advice-stat">${cf.monthsSaved} month${cf.monthsSaved === 1 ? '' : 's'} sooner payoff</div>
           <div class="bonus-advice-stat">${formatCurrency(cf.freedMonthly)}/mo freed up sooner</div>`
        : `<div class="bonus-advice-na">N/A — ${escapeHtml(cf.reason)}</div>`;

    const savingsBody = sv.rate > 0
        ? `<div class="bonus-advice-stat">${formatCurrency(sv.growth1yr)} in 1 year</div>
           <div class="bonus-advice-stat">${formatCurrency(sv.growth5yr)} in 5 years</div>
           <div class="bonus-advice-stat">at ${sv.rate.toFixed(2)}% APY</div>`
        : `<div class="bonus-advice-na">No interest-bearing account linked — link this bonus to an account with an APY to see growth projections.</div>`;

    return `
        <div class="bonus-advice">
            <div class="bonus-advice-card">
                <h5 class="bonus-advice-title">💳 Cash Flow — pay down debt</h5>
                ${cashFlowBody}
            </div>
            <div class="bonus-advice-card">
                <h5 class="bonus-advice-title">🏦 Savings — grow long-term</h5>
                ${savingsBody}
            </div>
        </div>`;
}
```

- [ ] **Step 3: Sanity-check the module loads with no syntax errors**

Run: `node --check src/bonusAdvisor.js`
Expected: no output (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add src/bonusAdvisor.js
git commit -m "Add bonusAdvisor.js: cash-flow vs savings calculation for one-time bonuses (#64)"
```

---

### Task 3: Wire `bonusAdvisor.js` into the app (app.js, ui.js, index.html)

**Files:**
- Modify: `src/app.js` (import + delegating method)
- Modify: `src/ui.js:194-200` (event listener for the advice button)
- Modify: `index.html:454-471` (Purpose select, advice button, result panel)
- Modify: `CLAUDE.md` (feature-module list)

**Interfaces:**
- Consumes: `showBonusAdvice(app)` from Task 2.
- Produces: `app.showBonusAdvice()` — Task 4's `renderBonusList` doesn't call this, but the button wired here does.

- [ ] **Step 1: Add the Purpose select, advice button, and result panel to the bonus form**

In `index.html`, the bonus form grid currently ends with the Account field (around line 464-469) followed by the submit button (line 471). Replace:

```html
                                <div class="form-group form-group-no-margin">
                                    <label for="bonusAccount">Deposit to Account</label>
                                    <select id="bonusAccount">
                                        <option value="">— No account —</option>
                                    </select>
                                </div>
                            </div>
                            <button type="submit" class="btn btn-success submit-button-margin">Add One-time Entry</button>
                        </form>
```

with:

```html
                                <div class="form-group form-group-no-margin">
                                    <label for="bonusAccount">Deposit to Account</label>
                                    <select id="bonusAccount">
                                        <option value="">— No account —</option>
                                    </select>
                                </div>
                                <div class="form-group no-margin">
                                    <label for="bonusPurpose">Purpose</label>
                                    <select id="bonusPurpose">
                                        <option value="">— Not decided —</option>
                                        <option value="cashFlow">💳 Cash Flow (pay down debt)</option>
                                        <option value="savings">🏦 Long-term Savings</option>
                                    </select>
                                </div>
                            </div>
                            <div class="bonus-advice-trigger">
                                <button type="button" id="bonusAdviceBtn" class="btn btn-secondary btn-small">💡 What should I do with this?</button>
                            </div>
                            <div id="bonusAdviceResult"></div>
                            <button type="submit" class="btn btn-success submit-button-margin">Add One-time Entry</button>
                        </form>
```

- [ ] **Step 2: Wire the advice button's click listener**

In `src/ui.js`, find the existing bonus form submit listener (around line 194-200):

```javascript
    const bonusForm = document.getElementById('bonusForm');
    if (bonusForm) {
        bonusForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addBonus();
        });
    }
```

Add immediately after it:

```javascript
    const bonusAdviceBtn = document.getElementById('bonusAdviceBtn');
    if (bonusAdviceBtn) {
        bonusAdviceBtn.addEventListener('click', () => {
            app.showBonusAdvice();
        });
    }
```

- [ ] **Step 3: Register the module in `app.js`**

In `src/app.js`, find the `income.js` import block (around line 38-51):

```javascript
import {
    renderIncomeList,
    addIncome,
    deleteIncome,
    startEditIncome,
    cancelEditIncome,
    saveEditIncome,
    addBonus,
    deleteBonus,
    startEditBonus,
    cancelEditBonus,
    saveEditBonus,
    renderBonusList
} from './income.js';
```

Add a new import line immediately after it:

```javascript
import { showBonusAdvice } from './bonusAdvisor.js';
```

Then find the bonus method block (around line 396-428):

```javascript
    // ── Bonus / Windfall CRUD ────────────────────────────────────────────────

    addBonus() {
        return addBonus(this);
    }
```

...and the `renderBonusList()` wrapper further down (around line 426-428):

```javascript
    renderBonusList() {
        return renderBonusList(this);
    }
```

Add a new delegating method immediately after `renderBonusList()`:

```javascript
    showBonusAdvice() {
        return showBonusAdvice(this);
    }
```

- [ ] **Step 4: Add `bonusAdvisor.js` to the CLAUDE.md module list**

In `CLAUDE.md`, find the feature-module list sentence under "Central app object + feature-module delegation pattern" (`` `debts.js`, `debtBreakEven.js`, `accounts.js`, ... ``) and add `bonusAdvisor.js` immediately after `income.js` in that comma-separated list.

- [ ] **Step 5: Manually verify no console errors**

With the dev server running (`python -m http.server 5500`), open `http://localhost:5500/` in a browser, go to the Income page, expand "Add a one-time bonus / deposit", fill in a name/amount/date, click "💡 What should I do with this?", and confirm a result panel renders below the button with no console errors. (This is the same manual check Task 4's automated tests will assert.)

- [ ] **Step 6: Commit**

```bash
git add index.html src/app.js src/ui.js CLAUDE.md
git commit -m "Wire Bonus Advisor into the app: form fields, button, module registration (#64)"
```

---

### Task 4: Persist `purpose` from the form, render the badge, and add advice/positive/negative feature tests

**Files:**
- Modify: `src/income.js` (`addBonus`, `saveEditBonus`, `renderBonusList`)
- Modify: `styles.css` (badge + advice panel CSS)
- Test: `tests/features/test_income.py`

**Interfaces:**
- Consumes: `calculateBonusAdvice` indirectly via `app.showBonusAdvice()` (Task 3); `#bonusPurpose` / `be-purpose-${id}` DOM ids (this task defines and consumes them together).
- Produces: `bonus.purpose` is read by nothing else in this feature — it's terminal (rendered, not further consumed).

- [ ] **Step 1: Write the failing feature tests**

Add to `tests/features/test_income.py` (append at the end of the file; reuse the existing account/debt-creation helper patterns already in this file and `tests/conftest.py`):

```python
def _create_debt_for_advisor(page):
    """Minimal interest-bearing debt so the Cash Flow advice branch has something to compute against."""
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Advisor Debt Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', 'Advisor Test Debt')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '2000')
    page.fill('#interestRate', '20')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector('text=Advisor Test Debt', timeout=10000)


def _open_bonus_form(page):
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    page.click('#bonusFormToggle')
    page.wait_for_timeout(200)


@pytest.mark.feature
def test_bonus_purpose_cash_flow_persists_and_shows_badge(app_page):
    """Selecting Cash Flow purpose on a bonus persists it and shows a badge in the list."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'Cash Flow Bonus')
    page.fill('#bonusAmount', '1000')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusCategory', label='Bonus')
    page.select_option('#bonusPurpose', 'cashFlow')
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_selector('text=Cash Flow Bonus', timeout=10000)

    purpose = page.evaluate(
        "() => window.app.bonuses.find(b => b.name === 'Cash Flow Bonus')?.purpose"
    )
    assert purpose == 'cashFlow', f"Expected purpose 'cashFlow' to persist, got {purpose}"
    assert page.query_selector('.bonus-purpose--cashflow') is not None, \
        "Cash Flow badge should be shown in the bonus list"


@pytest.mark.feature
def test_bonus_purpose_savings_persists_and_shows_badge(app_page):
    """Selecting Savings purpose on a bonus persists it and shows a badge in the list."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'Savings Bonus')
    page.fill('#bonusAmount', '750')
    page.fill('#bonusDate', '2026-05-02')
    page.select_option('#bonusCategory', label='Bonus')
    page.select_option('#bonusPurpose', 'savings')
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_selector('text=Savings Bonus', timeout=10000)

    purpose = page.evaluate(
        "() => window.app.bonuses.find(b => b.name === 'Savings Bonus')?.purpose"
    )
    assert purpose == 'savings', f"Expected purpose 'savings' to persist, got {purpose}"
    assert page.query_selector('.bonus-purpose--savings') is not None, \
        "Savings badge should be shown in the bonus list"


@pytest.mark.feature
def test_bonus_advice_shows_cash_flow_and_savings_numbers(app_page):
    """With a debt and an interest-bearing account, the advice panel shows non-zero numbers for both options."""
    page = app_page
    _create_debt_for_advisor(page)

    # Give the linked account a non-zero APY so the Savings branch has a rate to use.
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.click('[data-account-action="edit"]')
    page.fill('[id^="ac-rate-"]', '5')
    page.click('[data-account-action="save"]')
    page.wait_for_timeout(300)

    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')

    _open_bonus_form(page)
    page.fill('#bonusName', 'Advice Test Bonus')
    page.fill('#bonusAmount', '1000')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusAccount', index=1)
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'interest saved' in panel_text, f"Expected a computed interest-saved figure, got: {panel_text}"
    assert 'in 1 year' in panel_text, f"Expected a computed 1-year savings figure, got: {panel_text}"


@pytest.mark.feature
def test_bonus_advice_no_debts_shows_not_applicable(app_page):
    """With no debts at all, the Cash Flow side must show a graceful N/A, not crash or throw."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'No Debt Bonus')
    page.fill('#bonusAmount', '500')
    page.fill('#bonusDate', '2026-05-01')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'N/A' in panel_text and 'debt' in panel_text.lower(), \
        f"Expected a 'no debts' N/A message, got: {panel_text}"
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"


@pytest.mark.feature
def test_bonus_advice_no_account_rate_shows_not_applicable(app_page):
    """No account linked (or no account has a rate) -> Savings side shows a clear message, not a bare $0.00."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'No Rate Bonus')
    page.fill('#bonusAmount', '400')
    page.fill('#bonusDate', '2026-05-01')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'No interest-bearing account linked' in panel_text, \
        f"Expected the no-rate message, got: {panel_text}"


@pytest.mark.feature
def test_bonus_advice_invalid_amount_shows_validation_alert(app_page):
    """Clicking the advice button with no amount entered shows a validation alert, not a crash."""
    page = app_page
    _open_bonus_form(page)

    dialog_messages = []
    page.on("dialog", lambda d: (dialog_messages.append(d.message), d.accept()))

    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    assert len(dialog_messages) == 1, "Expected exactly one validation alert"
    assert 'valid amount' in dialog_messages[0].lower()
    assert page.query_selector('#bonusAdviceResult').inner_text() == '', \
        "No advice panel content should render when validation fails"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/features/test_income.py -k "bonus_purpose or bonus_advice" -v`
Expected: all six new tests FAIL (missing `#bonusPurpose` select, missing `#bonusAdviceBtn`, no `.bonus-purpose--*` badges, no `showBonusAdvice` wired up yet — Task 3 covers the wiring but `income.js` hasn't been changed yet in this task, so `purpose` isn't persisted or rendered).

- [ ] **Step 3: Implement — persist `purpose` in `addBonus`**

In `src/income.js`, replace `addBonus`:

```javascript
export function addBonus(app) {
    const name      = normalizeText(document.getElementById('bonusName').value, 80);
    const rawAmount = document.getElementById('bonusAmount').value;
    const amount    = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date      = sanitizeDateISO(document.getElementById('bonusDate').value);
    const category  = normalizeText(document.getElementById('bonusCategory').value, 40);
    const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;

    if (!name)                        { alert('Please enter a label for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
    if (!date)                        { alert('Please enter the date received.'); return; }

    app.bonuses.push({ id: Date.now(), name, amount, date, category, accountId });
    app.saveToStorage();
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
    document.getElementById('bonusForm').reset();
}
```

with:

```javascript
export function addBonus(app) {
    const name      = normalizeText(document.getElementById('bonusName').value, 80);
    const rawAmount = document.getElementById('bonusAmount').value;
    const amount    = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date      = sanitizeDateISO(document.getElementById('bonusDate').value);
    const category  = normalizeText(document.getElementById('bonusCategory').value, 40);
    const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;
    const rawPurpose = document.getElementById('bonusPurpose')?.value;
    const purpose   = (rawPurpose === 'cashFlow' || rawPurpose === 'savings') ? rawPurpose : null;

    if (!name)                        { alert('Please enter a label for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
    if (!date)                        { alert('Please enter the date received.'); return; }

    app.bonuses.push({ id: Date.now(), name, amount, date, category, accountId, purpose });
    app.saveToStorage();
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
    document.getElementById('bonusForm').reset();
    const adviceEl = document.getElementById('bonusAdviceResult');
    if (adviceEl) adviceEl.innerHTML = '';
}
```

- [ ] **Step 4: Implement — persist `purpose` in `saveEditBonus`**

In `src/income.js`, replace `saveEditBonus`:

```javascript
export function saveEditBonus(app, bonusId) {
    const nameEl      = document.getElementById(`be-name-${bonusId}`);
    const amtEl       = document.getElementById(`be-amount-${bonusId}`);
    const dateEl      = document.getElementById(`be-date-${bonusId}`);
    const catEl       = document.getElementById(`be-category-${bonusId}`);
    const accountEl   = document.getElementById(`be-account-${bonusId}`);
    if (!nameEl || !amtEl || !dateEl || !catEl) return;

    const name = normalizeText(nameEl.value, 80);
    const rawAmount = amtEl.value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date = sanitizeDateISO(dateEl.value);
    const category = normalizeText(catEl.value, 40);
    const accountId = accountEl && accountEl.value ? parseInt(accountEl.value) : null;

    if (!name) { alert('Please enter a name for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
    if (!date) { alert('Please enter the date received.'); return; }

    const idx = app.bonuses.findIndex(b => b.id === bonusId);
    if (idx === -1) return;
    app.bonuses[idx] = { ...app.bonuses[idx], name, amount, date, category, accountId };
    app.editingBonusId = null;
    app.saveToStorage();
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
}
```

with:

```javascript
export function saveEditBonus(app, bonusId) {
    const nameEl      = document.getElementById(`be-name-${bonusId}`);
    const amtEl       = document.getElementById(`be-amount-${bonusId}`);
    const dateEl      = document.getElementById(`be-date-${bonusId}`);
    const catEl       = document.getElementById(`be-category-${bonusId}`);
    const accountEl   = document.getElementById(`be-account-${bonusId}`);
    const purposeEl   = document.getElementById(`be-purpose-${bonusId}`);
    if (!nameEl || !amtEl || !dateEl || !catEl) return;

    const name = normalizeText(nameEl.value, 80);
    const rawAmount = amtEl.value;
    const amount = sanitizeFiniteNumber(rawAmount, NaN, { min: 0.01 });
    const date = sanitizeDateISO(dateEl.value);
    const category = normalizeText(catEl.value, 40);
    const accountId = accountEl && accountEl.value ? parseInt(accountEl.value) : null;
    const rawPurpose = purposeEl?.value;
    const purpose = (rawPurpose === 'cashFlow' || rawPurpose === 'savings') ? rawPurpose : null;

    if (!name) { alert('Please enter a name for this one-time entry.'); return; }
    if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
    if (!date) { alert('Please enter the date received.'); return; }

    const idx = app.bonuses.findIndex(b => b.id === bonusId);
    if (idx === -1) return;
    app.bonuses[idx] = { ...app.bonuses[idx], name, amount, date, category, accountId, purpose };
    app.editingBonusId = null;
    app.saveToStorage();
    app.renderBonusList();
    app.renderStrategyIncomeWidget();
}
```

- [ ] **Step 5: Implement — Purpose select in the inline edit card, and the badge in the display card**

In `src/income.js`, inside `renderBonusList`, add a `purposeBadgeMeta` lookup next to the existing `catBadgeClass` lookup:

```javascript
    const catBadgeClass = {
        Bonus: 'bonus-cat--bonus',
        'Tax Refund': 'bonus-cat--tax',
        'Cash Deposit': 'bonus-cat--bonus',
        'Check Deposit': 'bonus-cat--tax',
        Other: 'bonus-cat--other'
    };
```

becomes:

```javascript
    const catBadgeClass = {
        Bonus: 'bonus-cat--bonus',
        'Tax Refund': 'bonus-cat--tax',
        'Cash Deposit': 'bonus-cat--bonus',
        'Check Deposit': 'bonus-cat--tax',
        Other: 'bonus-cat--other'
    };
    const purposeBadgeMeta = {
        cashFlow: { cls: 'bonus-purpose--cashflow', label: '💳 Cash Flow' },
        savings:  { cls: 'bonus-purpose--savings',  label: '🏦 Savings' }
    };
```

Then, in the editing-card template, add a Purpose select field to `.bonus-edit-grid` — replace:

```javascript
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Account</label>
                                <select id="be-account-${b.id}" class="form-full-width">
                                    ${buildAccountOptionsHtml(app.accounts, b.accountId, { emptyLabel: '— No account —' })}
                                </select>
                            </div>
                        </div>
```

with:

```javascript
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Account</label>
                                <select id="be-account-${b.id}" class="form-full-width">
                                    ${buildAccountOptionsHtml(app.accounts, b.accountId, { emptyLabel: '— No account —' })}
                                </select>
                            </div>
                            <div class="form-group form-no-margin">
                                <label class="label-compact">Purpose</label>
                                <select id="be-purpose-${b.id}" class="form-full-width">
                                    <option value=""        ${!b.purpose             ?'selected':''}>— Not decided —</option>
                                    <option value="cashFlow" ${b.purpose==='cashFlow' ?'selected':''}>💳 Cash Flow</option>
                                    <option value="savings"  ${b.purpose==='savings'  ?'selected':''}>🏦 Savings</option>
                                </select>
                            </div>
                        </div>
```

Finally, in the display (non-editing) card template, add the purpose badge next to the category badge — replace:

```javascript
                return `
                <div class="bonus-card${isThisMonth ? ' bonus-card--current' : ''}">
                    <div class="bonus-card-info">
                        <span class="bonus-card-name">${escapeHtml(b.name)}</span>
                        <span class="bonus-card-amount">${formatCurrency(b.amount)}</span>
                        <span class="bonus-card-meta">${escapeHtml(dateStr)} &nbsp;·&nbsp; <span class="bonus-cat-badge ${badgeCls}">${escapeHtml(b.category)}</span></span>
                        ${isThisMonth ? '<span class="bonus-this-month-tag">✅ Included in this month\'s income</span>' : ''}
                    </div>
```

with:

```javascript
                const purposeMeta = purposeBadgeMeta[b.purpose];
                const purposeBadge = purposeMeta
                    ? `<span class="bonus-purpose-badge ${purposeMeta.cls}">${escapeHtml(purposeMeta.label)}</span>`
                    : '';

                return `
                <div class="bonus-card${isThisMonth ? ' bonus-card--current' : ''}">
                    <div class="bonus-card-info">
                        <span class="bonus-card-name">${escapeHtml(b.name)}</span>
                        <span class="bonus-card-amount">${formatCurrency(b.amount)}</span>
                        <span class="bonus-card-meta">${escapeHtml(dateStr)} &nbsp;·&nbsp; <span class="bonus-cat-badge ${badgeCls}">${escapeHtml(b.category)}</span>${purposeBadge ? ' ' + purposeBadge : ''}</span>
                        ${isThisMonth ? '<span class="bonus-this-month-tag">✅ Included in this month\'s income</span>' : ''}
                    </div>
```

- [ ] **Step 6: Add CSS for the purpose badges and the advice panel**

In `styles.css`, find this existing block (around line 3310-3318):

```css
body.dark-mode .bonus-cat--other { background: #1f2937; color: #d1d5db; }

.bonus-this-month-tag {
    font-size: 0.75rem;
    font-weight: 600;
    color: #15803d;
    white-space: nowrap;
}
body.dark-mode .bonus-this-month-tag { color: #4ade80; }
```

Insert new rules immediately after the last line of that block (`body.dark-mode .bonus-this-month-tag { color: #4ade80; }`), before the `/* Strategy bonus chip */` comment:

```css

.bonus-purpose-badge {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 20px;
    letter-spacing: 0.02em;
}
.bonus-purpose--cashflow { background: #dcfce7; color: #166534; }
.bonus-purpose--savings  { background: #e0e7ff; color: #3730a3; }
body.dark-mode .bonus-purpose--cashflow { background: #052e16; color: #86efac; }
body.dark-mode .bonus-purpose--savings  { background: #1e1b4b; color: #a5b4fc; }

.bonus-advice-trigger {
    margin-top: 12px;
}

.bonus-advice {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
}
@media (max-width: 600px) {
    .bonus-advice { grid-template-columns: 1fr; }
}

.bonus-advice-card {
    background: var(--card-background);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 12px 14px;
}

.bonus-advice-title {
    font-size: 0.88rem;
    font-weight: 700;
    margin: 0 0 8px;
}

.bonus-advice-stat {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 4px;
}

.bonus-advice-na {
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-style: italic;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pytest tests/features/test_income.py -k "bonus_purpose or bonus_advice" -v`
Expected: all six tests PASS.

- [ ] **Step 8: Run the full features + security suites to check for regressions**

Run: `pytest tests/features/ tests/security/ -v`
Expected: all PASS (no regressions in existing bonus/income/import tests).

- [ ] **Step 9: Commit**

```bash
git add src/income.js styles.css tests/features/test_income.py
git commit -m "Persist bonus purpose, render badge, add Bonus Advisor feature tests (#64)"
```

---

### Task 5: Documentation and version bump

**Files:**
- Modify: `guide.html` (bonus section)
- Modify: `CHANGELOG.md`
- Modify: `src/utils.js` (`APP_VERSION`)
- Test: `tests/features/test_versioning.py` (verification only, no code changes)

**Interfaces:** None — this task only touches documentation/version metadata that no other task's code depends on.

- [ ] **Step 1: Update the user guide**

In `guide.html`, find the "One-time Bonuses and Deposits" section (around line 196-202):

```html
                <h3>One-time Bonuses and Deposits</h3>
                <p>Use the one-time entry form to add irregular deposits that are not part of a regular paycheck schedule.</p>
                <ul>
                    <li>Examples: bonus, tax refund, cash deposit, check deposit</li>
                    <li>Supported categories: Bonus, Tax Refund, Cash Deposit, Check Deposit, Other</li>
                    <li>Entries can be linked to an account and are included in monthly income totals</li>
                </ul>
            </section>
```

Replace with:

```html
                <h3>One-time Bonuses and Deposits</h3>
                <p>Use the one-time entry form to add irregular deposits that are not part of a regular paycheck schedule.</p>
                <ul>
                    <li>Examples: bonus, tax refund, cash deposit, check deposit</li>
                    <li>Supported categories: Bonus, Tax Refund, Cash Deposit, Check Deposit, Other</li>
                    <li>Entries can be linked to an account and are included in monthly income totals</li>
                    <li>Optionally tag a bonus's Purpose as Cash Flow (pay down debt) or Long-term Savings — purely for your own tracking, shown as a badge in the list</li>
                    <li>Click "What should I do with this?" to see computed numbers for each option: interest saved and months-sooner payoff if applied to your debt plan, vs. projected 1-year/5-year growth if left in a linked interest-bearing account</li>
                </ul>
            </section>
```

- [ ] **Step 2: Add a CHANGELOG.md entry**

In `CHANGELOG.md`, insert a new entry above the existing `## [4.7.3] — 2026-08-02` heading (the changelog is newest-first):

```markdown
## [4.8.0] — 2026-08-02

### Added
- **Bonus Advisor (#64)** — one-time bonuses can now be tagged with a Purpose (Cash Flow or Long-term Savings), shown as a badge in the bonus list. A new "What should I do with this?" button computes real numbers for each option: interest saved and months-sooner debt payoff (via the existing `DebtCalculator` stimulus mechanism) vs. projected 1-year/5-year growth (via the existing account-interest helper) if left in a linked interest-bearing account. New `src/bonusAdvisor.js` module; `purpose` added to the bonus record and sanitized in `src/sanitizers.js`. See `docs/superpowers/specs/2026-08-02-bonus-advisor-design.md`.

---
```

- [ ] **Step 3: Bump `APP_VERSION`**

In `src/utils.js`, change:

```javascript
export const APP_VERSION = '4.7.3';
```

to:

```javascript
export const APP_VERSION = '4.8.0';
```

- [ ] **Step 4: Verify version/changelog sync**

Run: `pytest tests/features/test_versioning.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add guide.html CHANGELOG.md src/utils.js
git commit -m "Update guide and changelog for Bonus Advisor; bump APP_VERSION to 4.8.0 (#64)"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire Python/Playwright suite**

Ensure the dev server is running (`python -m http.server 5500`), then run:

Run: `pytest tests/ -v`
Expected: all PASS, no new failures.

- [ ] **Step 2: Run the Jest unit suite (sanity check — untouched by this feature, but confirm no accidental breakage)**

Run: `npm run test:unit`
Expected: all PASS.

- [ ] **Step 3: Manual smoke test in a real browser**

With the dev server running, open `http://localhost:5500/`:
1. Add a debt with a non-zero interest rate and minimum payment.
2. Add an account with a non-zero APY.
3. Go to Income → expand the bonus form → enter an amount, select the account, click "💡 What should I do with this?" → confirm both cards show non-zero numbers.
4. Select a Purpose, submit the form → confirm the badge appears in the bonus list.
5. Edit that bonus, change the Purpose, save → confirm the badge updates.
6. Toggle dark mode → confirm the badges and advice panel remain legible (no unstyled/invisible text).

- [ ] **Step 4: Final commit if any cleanup was needed**

If steps 1-3 required any fixes, commit them with a descriptive message. Otherwise, no commit needed — this task is verification-only.
