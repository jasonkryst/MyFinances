# Quick Wins Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the two remaining Quick Wins — (1) a Debt Payoff Date display on
every debt card, and (2) a "Mark as paid this month" toggle for Recurring
Templates — and bring `ROADMAP.md`, `README.md`, and `guide.html` up to date so
the status of every roadmap item is easy to scan.

**Architecture:** Both features extend existing records with no new top-level
app-state collections. Feature 1 reads the existing transient
`app._debtSummaryRows` (populated by `displayDebtSummary()`) inside
`renderDebtsList()` in `src/debts.js`. Feature 2 adds a `paidMonths: []` array
to each recurring template (mirroring the existing `skippedMonths` pattern),
with a new `markRecurringPaid()` function in `src/recurring.js`, sanitization
in `src/storage.js`, a new badge/button in `_buildReadCard`, and delegation
wiring in `src/app.js`. Tasks 1-4 follow TDD (failing test → implement →
passing test) for `src/storage.js`, `src/recurring.js`, and `src/debts.js`.
Task 5 is a one-line version bump with no dedicated test. Tasks 6-8 are
documentation-only edits to `ROADMAP.md`, `README.md`, and `guide.html`
(verified by visual/grep checks rather than automated tests).

**Tech Stack:** Vanilla ES6 modules, Playwright + pytest (sync `app_page` and
async `async_app_page` fixtures from `tests/conftest.py`), served via
`python -m http.server 5500`.

---

## Setup (do this once, before Task 1)

Start the dev server in its own terminal and leave it running for the whole
plan — every test step below assumes `http://localhost:5500/` is reachable:

```bash
python -m http.server 5500
```

---

### Task 1: `paidMonths` sanitization in `src/storage.js`

**Files:**
- Modify: `src/storage.js:110-129`
- Test: `tests/security/test_input_validation.py` (append after line 439)

- [ ] **Step 1: Write the failing test**

Append this to the end of `tests/security/test_input_validation.py`:

```python
@pytest.mark.security
async def test_sanitize_recurring_template_paid_months(async_app_page):
    """sanitizeRecurringTemplate (via save/reload) strips malformed paidMonths
    entries, keeping only 'YYYY-MM' strings."""
    page = async_app_page

    result = await page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 8301, name: 'Paid Months Sanitize', type: 'Checking', startingBalance: 100 }];
        app.incomes = []; app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.reconciliations = [];
        app.recurringTemplates = [{
            id: 8302, name: 'Sanitize Sub', type: 'subscription', amount: 10,
            frequency: 'monthly', dayOfMonth: 1, category: 'Subscription',
            accountId: 8301, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [],
            paidMonths: ['2026-06', 123, 'not-a-month', '26-06', '2026-006']
        }];
        app.saveToStorage();
        app.loadFromStorage();
        const t = app.recurringTemplates.find(x => x.id === 8302);
        return { paidMonths: t ? t.paidMonths : null };
    }""")

    assert result['paidMonths'] == ['2026-06'], f"Expected only '2026-06' to survive sanitization, got {result['paidMonths']}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/security/test_input_validation.py::test_sanitize_recurring_template_paid_months -v`

Expected: FAIL — `result['paidMonths']` is `None` (or `undefined` via Playwright's
JSON conversion to `None`), because `sanitizeRecurringTemplate` currently
returns an object literal that has no `paidMonths` key at all, so the field is
dropped entirely on save/reload.

- [ ] **Step 3: Implement `paidMonths` sanitization**

In `src/storage.js`, replace the `sanitizeRecurringTemplate` function
(lines 110-129):

```js
function sanitizeRecurringTemplate(record, idFallback) {
    const skippedMonths = Array.isArray(record?.skippedMonths) ? record.skippedMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
    const paidMonths = Array.isArray(record?.paidMonths) ? record.paidMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
    const frequency = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].includes(record?.frequency) ? record.frequency : 'monthly';
    const type = ['subscription', 'reimbursement', 'transfer'].includes(record?.type) ? record.type : 'subscription';
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        type,
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        frequency,
        dayOfMonth: sanitizeInteger(record?.dayOfMonth, null, { min: 1, max: 31 }),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null),
        targetAccountId: sanitizeInteger(record?.targetAccountId, null),
        startDate: sanitizeDateISO(record?.startDate),
        endDate: sanitizeDateISO(record?.endDate),
        paused: Boolean(record?.paused),
        skippedMonths,
        paidMonths
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/security/test_input_validation.py::test_sanitize_recurring_template_paid_months -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage.js tests/security/test_input_validation.py
git commit -m "Add paidMonths sanitization for recurring templates"
```

---

### Task 2: `markRecurringPaid` core logic in `src/recurring.js`

**Files:**
- Modify: `src/recurring.js:307-343` (addRecurringTemplate), `src/recurring.js:360-371` (insert after skipRecurringOccurrence)
- Test: `tests/features/test_recurring_occurrences.py` (append after line 100)

- [ ] **Step 1: Write the failing test**

Append this to the end of `tests/features/test_recurring_occurrences.py`:

```python
@pytest.mark.feature
def test_mark_and_unmark_recurring_paid(app_page):
    """markRecurringPaid toggles a month-key in paidMonths without affecting
    getRecurringOccurrencesInMonth."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/recurring.js');
        const template = {
            id: 1, name: 'Streaming', type: 'subscription', amount: 15,
            frequency: 'monthly', dayOfMonth: 1, category: 'Subscription',
            accountId: 1, targetAccountId: null,
            startDate: '2026-01-01', endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        };
        const app = {
            recurringTemplates: [template],
            saveToStorage: () => {},
            renderRecurringPage: () => {}
        };

        const before = mod.getRecurringOccurrencesInMonth(template, 2026, 5).length;

        mod.markRecurringPaid(app, 1, '2026-06', false);
        const afterMark = [...template.paidMonths];

        mod.markRecurringPaid(app, 1, '2026-06', true);
        const afterUnmark = [...template.paidMonths];

        const after = mod.getRecurringOccurrencesInMonth(template, 2026, 5).length;

        return { before, after, afterMark, afterUnmark };
    }""")

    assert result['afterMark'] == ['2026-06']
    assert result['afterUnmark'] == []
    assert result['before'] == result['after'] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/features/test_recurring_occurrences.py::test_mark_and_unmark_recurring_paid -v`

Expected: FAIL — `mod.markRecurringPaid` is not a function (it doesn't exist
yet), so `page.evaluate` throws a `TypeError` which Playwright surfaces as a
test failure.

- [ ] **Step 3: Implement `markRecurringPaid` and seed `paidMonths` on new templates**

In `src/recurring.js`, in `addRecurringTemplate` (around line 337), change the
new-template object literal's last line from:

```js
        paused: false,
        skippedMonths: []
    });
```

to:

```js
        paused: false,
        skippedMonths: [],
        paidMonths: []
    });
```

Then, immediately after `skipRecurringOccurrence` (after line 371, before
`export function startEditRecurring`), add a new exported function:

```js
export function markRecurringPaid(app, id, monthKey, unmark = false) {
    const t = app.recurringTemplates?.find(x => x.id === id);
    if (!t || !monthKey) return;
    if (!t.paidMonths) t.paidMonths = [];
    if (unmark) {
        t.paidMonths = t.paidMonths.filter(m => m !== monthKey);
    } else if (!t.paidMonths.includes(monthKey)) {
        t.paidMonths.push(monthKey);
    }
    app.saveToStorage();
    app.renderRecurringPage();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/features/test_recurring_occurrences.py::test_mark_and_unmark_recurring_paid -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/recurring.js tests/features/test_recurring_occurrences.py
git commit -m "Add markRecurringPaid core logic for recurring templates"
```

---

### Task 3: Recurring Templates UI — badge, button, click handler, wiring, CSS

**Files:**
- Modify: `src/recurring.js:152-153` (click handler), `src/recurring.js:168-179` (status badge), `src/recurring.js:219-230` (card actions)
- Modify: `src/app.js:75` (import), `src/app.js:764` (delegation)
- Modify: `styles.css:4801-4802` (new badge CSS)
- Test: `tests/ui/test_recurring_actions.py` (append after line 108)

- [ ] **Step 1: Write the failing test**

Append this to the end of `tests/ui/test_recurring_actions.py`:

```python
@pytest.mark.ui
def test_recurring_mark_and_unmark_paid(app_page):
    """Test marking and unmarking the current month as paid for a recurring template."""
    page = app_page
    _seed_recurring_template(page)

    mark_btn = page.query_selector('[data-recurring-action="mark-paid"][data-recurring-id="90"]')
    assert mark_btn, "Expected a Mark as paid button"
    mark_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paid this month' in badge_text, "Template should show a Paid this month badge after marking as paid"

    unmark_btn = page.query_selector('[data-recurring-action="unmark-paid"][data-recurring-id="90"]')
    assert unmark_btn, "Expected an Unmark paid button after marking as paid"
    unmark_btn.click()
    page.wait_for_timeout(300)

    badge_text = page.evaluate('() => document.querySelector("#recurringList .recurring-badge")?.textContent || ""')
    assert 'Paid this month' not in badge_text, "Template should no longer show a Paid this month badge after unmarking"
    assert page.query_selector('[data-recurring-action="mark-paid"][data-recurring-id="90"]'), \
        "Expected a Mark as paid button again after unmarking"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/ui/test_recurring_actions.py::test_recurring_mark_and_unmark_paid -v`

Expected: FAIL — `mark_btn` is `None` because no element with
`[data-recurring-action="mark-paid"]` exists yet.

- [ ] **Step 3: Implement the status badge and `isPaidThisMonth` flag**

In `src/recurring.js`, in `_buildReadCard`, change lines 168-179 from:

```js
    const isSkippedThisMonth = Array.isArray(t.skippedMonths) && t.skippedMonths.includes(monthKey);

    let statusBadge;
    if (t.paused) {
        statusBadge = `<span class="recurring-badge recurring-badge--paused">⏸ Paused</span>`;
    } else if (isSkippedThisMonth) {
        statusBadge = `<span class="recurring-badge recurring-badge--skipped">⏭ Skipped this month</span>`;
    } else if (occurrences.length > 0) {
        statusBadge = `<span class="recurring-badge recurring-badge--active">✅ Active</span>`;
    } else {
        statusBadge = `<span class="recurring-badge recurring-badge--pending">⏳ No hits this month</span>`;
    }
```

to:

```js
    const isSkippedThisMonth = Array.isArray(t.skippedMonths) && t.skippedMonths.includes(monthKey);
    const isPaidThisMonth = Array.isArray(t.paidMonths) && t.paidMonths.includes(monthKey);

    let statusBadge;
    if (t.paused) {
        statusBadge = `<span class="recurring-badge recurring-badge--paused">⏸ Paused</span>`;
    } else if (isSkippedThisMonth) {
        statusBadge = `<span class="recurring-badge recurring-badge--skipped">⏭ Skipped this month</span>`;
    } else if (occurrences.length > 0 && isPaidThisMonth) {
        statusBadge = `<span class="recurring-badge recurring-badge--paid">✅ Paid this month</span>`;
    } else if (occurrences.length > 0) {
        statusBadge = `<span class="recurring-badge recurring-badge--active">✅ Active</span>`;
    } else {
        statusBadge = `<span class="recurring-badge recurring-badge--pending">⏳ No hits this month</span>`;
    }
```

- [ ] **Step 4: Add the "Mark as paid" / "Unmark paid" button**

In `src/recurring.js`, in `_buildReadCard`, change the card actions block
(lines 219-230) from:

```js
        <div class="recurring-card-actions">
            <button class="btn btn-secondary btn-small" data-recurring-action="edit" data-recurring-id="${t.id}">Edit</button>
            ${t.paused
                ? `<button class="btn btn-secondary btn-small" data-recurring-action="unpause" data-recurring-id="${t.id}">▶ Resume</button>`
                : `<button class="btn btn-secondary btn-small" data-recurring-action="pause" data-recurring-id="${t.id}">⏸ Pause</button>`}
            ${isSkippedThisMonth
                ? `<button class="btn btn-secondary btn-small" data-recurring-action="unskip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">↩ Unskip</button>`
                : !t.paused
                    ? `<button class="btn btn-secondary btn-small" data-recurring-action="skip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">⏭ Skip month</button>`
                    : ''}
            <button class="btn btn-danger btn-small" data-recurring-action="delete" data-recurring-id="${t.id}">Delete</button>
        </div>
```

to:

```js
        <div class="recurring-card-actions">
            <button class="btn btn-secondary btn-small" data-recurring-action="edit" data-recurring-id="${t.id}">Edit</button>
            ${t.paused
                ? `<button class="btn btn-secondary btn-small" data-recurring-action="unpause" data-recurring-id="${t.id}">▶ Resume</button>`
                : `<button class="btn btn-secondary btn-small" data-recurring-action="pause" data-recurring-id="${t.id}">⏸ Pause</button>`}
            ${(!t.paused && !isSkippedThisMonth && occurrences.length > 0)
                ? (isPaidThisMonth
                    ? `<button class="btn btn-secondary btn-small" data-recurring-action="unmark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">↩ Unmark paid</button>`
                    : `<button class="btn btn-secondary btn-small" data-recurring-action="mark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">✅ Mark as paid</button>`)
                : ''}
            ${isSkippedThisMonth
                ? `<button class="btn btn-secondary btn-small" data-recurring-action="unskip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">↩ Unskip</button>`
                : !t.paused
                    ? `<button class="btn btn-secondary btn-small" data-recurring-action="skip" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">⏭ Skip month</button>`
                    : ''}
            <button class="btn btn-danger btn-small" data-recurring-action="delete" data-recurring-id="${t.id}">Delete</button>
        </div>
```

- [ ] **Step 5: Wire up the click handler dispatches**

In `src/recurring.js`, in `renderRecurringPage`'s `container.onclick` handler,
change lines 152-153 from:

```js
        else if (action === 'skip') app.skipRecurringOccurrence(id, mk, false);
        else if (action === 'unskip') app.skipRecurringOccurrence(id, mk, true);
```

to:

```js
        else if (action === 'skip') app.skipRecurringOccurrence(id, mk, false);
        else if (action === 'unskip') app.skipRecurringOccurrence(id, mk, true);
        else if (action === 'mark-paid') app.markRecurringPaid(id, mk, false);
        else if (action === 'unmark-paid') app.markRecurringPaid(id, mk, true);
```

- [ ] **Step 6: Wire `markRecurringPaid` into `src/app.js`**

In `src/app.js`, in the `./recurring.js` import block (lines 70-80), change:

```js
    skipRecurringOccurrence as skipRecurringOccurrenceFeature,
    startEditRecurring as startEditRecurringFeature,
```

to:

```js
    skipRecurringOccurrence as skipRecurringOccurrenceFeature,
    markRecurringPaid as markRecurringPaidFeature,
    startEditRecurring as startEditRecurringFeature,
```

Then, in the `DebtTrackerApp` class, in the "RECURRING TRANSACTION TEMPLATES"
delegation block, change line 764 from:

```js
    skipRecurringOccurrence(id, monthKey, unskip) { return skipRecurringOccurrenceFeature(this, id, monthKey, unskip); }
    startEditRecurring(id) { return startEditRecurringFeature(this, id); }
```

to:

```js
    skipRecurringOccurrence(id, monthKey, unskip) { return skipRecurringOccurrenceFeature(this, id, monthKey, unskip); }
    markRecurringPaid(id, monthKey, unmark) { return markRecurringPaidFeature(this, id, monthKey, unmark); }
    startEditRecurring(id) { return startEditRecurringFeature(this, id); }
```

- [ ] **Step 7: Add `.recurring-badge--paid` CSS**

In `styles.css`, after line 4801
(`body.dark-mode .recurring-badge--pending { background: #1f2937; color: #9ca3af; }`)
and before line 4802 (`.recurring-this-month {`), insert:

```css
.recurring-badge--paid { background: #dbeafe; color: #1e40af; }
body.dark-mode .recurring-badge--paid { background: #1e3a5f; color: #93c5fd; }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pytest tests/ui/test_recurring_actions.py::test_recurring_mark_and_unmark_paid -v`

Expected: PASS

- [ ] **Step 9: Run the full recurring test suite to check for regressions**

Run: `pytest tests/ui/test_recurring_actions.py tests/features/test_recurring_occurrences.py -v`

Expected: All PASS (including `test_recurring_pause_and_resume`,
`test_recurring_skip_and_unskip_month`, `test_recurring_inline_edit_and_save`).

- [ ] **Step 10: Commit**

```bash
git add src/recurring.js src/app.js styles.css tests/ui/test_recurring_actions.py
git commit -m "Add Mark as paid this month toggle for recurring templates"
```

---

### Task 4: Debt Payoff Date display on debt cards

**Files:**
- Modify: `src/debts.js:335` (insert computation), `src/debts.js:399` (fixedAmount branch), `src/debts.js:446` (creditCard branch)
- Modify: `styles.css:2006` (new `.text-muted` / `.debt-payoff-detail--muted` rules)
- Test: `tests/features/test_debts.py` (append two new tests)

- [ ] **Step 1: Write the failing tests**

Append this to the end of `tests/features/test_debts.py`:

```python
@pytest.mark.feature
def test_debt_card_shows_run_a_plan_hint_before_calculation(app_page, debt_data):
    """Before any payment plan is calculated, debt cards show a 'Run a plan to see' payoff hint."""
    page = app_page
    create_debt(page, debt_data)

    card_text = page.evaluate("""() => {
        const card = document.querySelector('#debtsList .debt-card');
        return card ? card.textContent : '';
    }""")
    assert '📅 Payoff Date' in card_text, "Expected a Payoff Date label even before calculating a plan"
    assert 'Run a plan to see' in card_text, "Expected a 'Run a plan to see' payoff hint before calculating a plan"


@pytest.mark.feature
def test_debt_card_shows_payoff_date_after_plan_calculation(app_page, debt_data):
    """After calculating a payment plan, each debt card shows its projected payoff date."""
    page = app_page
    create_debt(page, debt_data)

    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_timeout(500)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    card_text = page.evaluate("""() => {
        const card = document.querySelector('#debtsList .debt-card');
        return card ? card.textContent : '';
    }""")
    assert '📅 Payoff Date' in card_text, "Expected a Payoff Date label after calculating a plan"
    assert 'Run a plan to see' not in card_text, "Expected the 'Run a plan to see' hint to be replaced by an actual date"

    summary_payoff_date = page.evaluate(
        """(name) => {
            const row = window.app._debtSummaryRows?.find(r => r.name === name);
            return row ? row.payoffDate : null;
        }""",
        debt_data["name"]
    )
    assert summary_payoff_date, "Expected _debtSummaryRows to contain a payoffDate"
    assert summary_payoff_date in card_text, "Debt card should display the same payoff date as the summary table"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_debts.py::test_debt_card_shows_run_a_plan_hint_before_calculation tests/features/test_debts.py::test_debt_card_shows_payoff_date_after_plan_calculation -v`

Expected: Both FAIL — neither `'📅 Payoff Date'` nor `'Run a plan to see'`
currently appear in the debt card markup.

- [ ] **Step 3: Compute the payoff detail row**

In `src/debts.js`, inside the `for (const debt of filteredDebts) {` loop,
change:

```js
        const card = document.createElement('div');
        card.className = 'debt-card';

        if (app.editingDebtId === debt.id) {
```

to:

```js
        const card = document.createElement('div');
        card.className = 'debt-card';

        const summaryRow = app._debtSummaryRows?.find(r => r.name === debt.name);
        const payoffDetailHTML = (summaryRow && summaryRow.payoffDate)
            ? `<div class="debt-detail debt-payoff-detail"><strong>📅 Payoff Date:</strong> ${summaryRow.payoffDate}</div>`
            : `<div class="debt-detail debt-payoff-detail debt-payoff-detail--muted"><strong>📅 Payoff Date:</strong> <span class="text-muted">Run a plan to see</span></div>`;

        if (app.editingDebtId === debt.id) {
```

- [ ] **Step 4: Render the payoff detail row for Fixed Amount debts**

In `src/debts.js`, in the `debt.debtType === 'fixedAmount'` branch, change:

```js
                cardHTML += `
                        <div class="debt-detail">
                            <strong>Monthly Amount:</strong> ${formatCurrency(debt.fixedAmount)}
                        </div>
                        <div class="debt-detail">
                            <strong>Period:</strong> ${debt.fixedStartDate} to ${debt.fixedEndDate}
                        </div>
                        ${debt.priority ? `
                            <div class="debt-detail">
                                <strong>Priority:</strong> ${debt.priority}/100
                            </div>
                        ` : ''}`;
```

to:

```js
                cardHTML += `
                        <div class="debt-detail">
                            <strong>Monthly Amount:</strong> ${formatCurrency(debt.fixedAmount)}
                        </div>
                        <div class="debt-detail">
                            <strong>Period:</strong> ${debt.fixedStartDate} to ${debt.fixedEndDate}
                        </div>
                        ${payoffDetailHTML}
                        ${debt.priority ? `
                            <div class="debt-detail">
                                <strong>Priority:</strong> ${debt.priority}/100
                            </div>
                        ` : ''}`;
```

- [ ] **Step 5: Render the payoff detail row for Credit Card debts**

In `src/debts.js`, in the `else` (credit card) branch, change:

```js
                        ${iptd ? `
                        <div class="debt-detail iptd-detail">
                            <strong>Est. interest paid to date:</strong>
                            <span class="iptd-value">${formatCurrency(iptd.interestPaid)}</span>
                            <span class="iptd-sub">over ${iptd.days} days since ${iptd.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                        </div>` : ''}
                        ${debt.priority ? `
                            <div class="debt-detail">
                                <strong>Priority:</strong> ${debt.priority}/100
                            </div>
                        ` : ''}`;
```

to:

```js
                        ${iptd ? `
                        <div class="debt-detail iptd-detail">
                            <strong>Est. interest paid to date:</strong>
                            <span class="iptd-value">${formatCurrency(iptd.interestPaid)}</span>
                            <span class="iptd-sub">over ${iptd.days} days since ${iptd.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                        </div>` : ''}
                        ${payoffDetailHTML}
                        ${debt.priority ? `
                            <div class="debt-detail">
                                <strong>Priority:</strong> ${debt.priority}/100
                            </div>
                        ` : ''}`;
```

- [ ] **Step 6: Add `.text-muted` and `.debt-payoff-detail--muted` CSS**

In `styles.css`, after line 2006 (`.debt-detail strong { color: var(--text-primary); }`)
and before line 2008 (`.debt-actions {`), insert:

```css
.text-muted {
    color: var(--text-muted, #9ca3af);
}
body.dark-mode .text-muted {
    color: #94a3b8;
}
.debt-payoff-detail--muted {
    font-size: 0.82rem;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/features/test_debts.py::test_debt_card_shows_run_a_plan_hint_before_calculation tests/features/test_debts.py::test_debt_card_shows_payoff_date_after_plan_calculation -v`

Expected: Both PASS

- [ ] **Step 8: Run the full debts test suite to check for regressions**

Run: `pytest tests/features/test_debts.py -v`

Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/debts.js styles.css tests/features/test_debts.py
git commit -m "Show projected payoff date on debt cards"
```

---

### Task 5: Bump `APP_VERSION` to 3.5.0

**Files:**
- Modify: `src/utils.js:3`

- [ ] **Step 1: Bump the version constant**

In `src/utils.js`, change line 3 from:

```js
export const APP_VERSION = '3.4.0';
```

to:

```js
export const APP_VERSION = '3.5.0';
```

- [ ] **Step 2: Verify the version renders in the UI**

Run: `pytest tests/integration/test_smoke.py -v`

Expected: All PASS — the smoke test exercises page navigation without errors,
confirming `APP_VERSION` is referenced correctly in `index.html` (no test
asserts the literal string, this is a sanity check that nothing broke).

- [ ] **Step 3: Commit**

```bash
git add src/utils.js
git commit -m "Bump APP_VERSION to 3.5.0"
```

---

### Task 6: `ROADMAP.md` — status legend, at-a-glance table, Quick Wins, Bill Payment Tracker, version/date

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update the header version and date**

In `ROADMAP.md`, change lines 3-4 from:

```
**Last Updated**: June 10, 2026  
**Current Version**: v3.2.0  
```

to:

```
**Last Updated**: June 14, 2026  
**Current Version**: v3.5.0  
```

- [ ] **Step 2: Insert the Status Legend and At a Glance table**

In `ROADMAP.md`, between line 18 (`---`, end of Strategic Vision) and line 20
(`## 📊 Feature Tiers`), insert the following two new sections (keep the
existing blank line between them and the surrounding `---` separators):

```markdown
## 🔑 Status Legend

| Symbol | Meaning |
|---|---|
| ✅ | **Implemented** — shipped and available today |
| 📋 | **Proposed** — not yet started |
| ⏭️ | **Deferred** — folded into another roadmap item |

---

## 📌 At a Glance

| Feature | Tier | Status | Notes |
|---|---|---|---|
| Net Worth Tracker & Historical Snapshots | 1 | ✅ | Delivered May 30, 2026 |
| Financial Health Dashboard | 1 | ✅ | Delivered June 8, 2026 |
| Budget Alerts & Overspend Warnings | 1 | 📋 | Absorbs Quick Wins #2 and #5 |
| Savings Goals with Progress Tracking | 2 | 📋 | |
| Spending Analysis by Category | 2 | 📋 | |
| Multiple Scenario Comparison | 2 | 📋 | |
| Cash Flow Forecasting | 2 | ✅ | Delivered June 10, 2026 — shipped early, was planned for v3.3 |
| Break-Even Analysis per Debt | 2 | 📋 | |
| Advanced Ledger Features | 3 | 📋 | |
| Bill Payment Tracker | 3 | 📋 | "Mark as paid" seeded for Recurring Templates via Quick Win #4 |
| Income Growth Projections | 3 | 📋 | |
| Account Reconciliation Tool | 3 | ✅ | Delivered June 13, 2026 — shipped early, was planned for v3.4+ |
| Debt Consolidation Calculator | 3 | 📋 | |
| Custom Categories for Transactions | 4 | 📋 | |
| Tax Planning Helpers | 4 | 📋 | |
| Retirement Planning | 4 | 📋 | |
| Credit Score Estimator | 4 | 📋 | |
| Inflation Calculator | 4 | 📋 | |
| Enhanced Data Export | 4 | 📋 | |
| Quick Win #1: Debt Payoff Timeline Display | Quick Win | ✅ | Delivered June 14, 2026 |
| Quick Win #2: Month-to-Date Spending Summary | Quick Win | ⏭️ | Folded into Budget Alerts & Overspend Warnings (Tier 1) |
| Quick Win #3: Dashboard Page | Quick Win | ✅ | Delivered in v3.1 as Financial Health Dashboard |
| Quick Win #4: Bill Payment Status | Quick Win | ✅ | Delivered June 14, 2026 — retargeted to Recurring Templates "Mark as paid" |
| Quick Win #5: Budget Overspend Badges | Quick Win | ⏭️ | Folded into Budget Alerts & Overspend Warnings (Tier 1) |
```

- [ ] **Step 3: Update the Tier 3 "Bill Payment Tracker" section**

In `ROADMAP.md`, replace the "Bill Payment Tracker" section (originally
lines 284-293):

```markdown
#### 📅 Bill Payment Tracker
**Priority**: MEDIUM | **Effort**: LOW | **Status**: PROPOSED

**Features**:
- Mark bills as "due" vs. "paid"
- Track payment history and dates
- Late payment warnings (bill due date passed)
- Confirmation dates when payment sent
- Monthly payment checklist
```

with:

```markdown
#### 📅 Bill Payment Tracker
**Priority**: MEDIUM | **Effort**: LOW | **Status**: PROPOSED (partially seeded)

**Note**: The standalone "Bills" feature this item was originally written
against (`#billForm`/`#billList`) was removed from the UI on May 29, 2026 in
favor of Recurring Templates (`src/recurring.js`). The "mark as paid" piece of
this item has been delivered for Recurring Templates via Quick Win #4
(`paidMonths`). The remaining items below stay PROPOSED, but would need to be
redefined against Recurring Templates rather than the old Bills model if
pursued.

**Features**:
- [x] Mark items as "due" vs. "paid" — delivered for Recurring Templates (Quick Win #4)
- [ ] Track payment history and dates
- [ ] Late payment warnings (occurrence date passed without being marked paid)
- [ ] Confirmation dates when payment sent
- [ ] Monthly payment checklist
```

- [ ] **Step 4: Rewrite the Quick Wins section**

In `ROADMAP.md`, replace the "Quick Wins" section (originally lines 468-489):

```markdown
## 📋 Quick Wins (Low Effort, Noticeable Impact)

These can be implemented quickly and add immediate value:

1. **Debt Payoff Timeline Display** (30 min)
   - Show "Payoff date: Dec 2026" on each debt card
   - Already calculated, just needs display

2. **Month-to-Date Spending Summary** (1 hour)
   - Add totals by category below budget section
   - Show % of budget used

3. ~~**Dashboard Page** (2-3 hours)~~ ✅ **Delivered in v3.1** — Financial Health Dashboard (`src/health.js`)

4. **Bill Payment Status** (1 hour)
   - Add checkbox "Paid this month" to bills
   - Toggle state persistence

5. **Budget Overspend Badges** (1-2 hours)
   - Red badge with count of overspent categories
   - Click to see details
```

with:

```markdown
## 📋 Quick Wins (Low Effort, Noticeable Impact)

These can be implemented quickly and add immediate value:

1. ~~**Debt Payoff Timeline Display** (30 min)~~ ✅ **Delivered June 14, 2026** — each debt card shows a "📅 Payoff Date" row sourced from `app._debtSummaryRows` (populated when the user clicks "Calculate Payment Plan" on the Plan page)

2. ⏭️ **Month-to-Date Spending Summary** — **Deferred**, folded into Tier 1 "🛑 Budget Alerts & Overspend Warnings" (requires a per-category monthly budget limit concept that doesn't exist yet)

3. ~~**Dashboard Page** (2-3 hours)~~ ✅ **Delivered in v3.1** — Financial Health Dashboard (`src/health.js`)

4. ~~**Bill Payment Status** (1 hour)~~ ✅ **Delivered June 14, 2026** — retargeted to Recurring Templates: a "Mark as paid this month" toggle (`paidMonths` per template, mirrors `skippedMonths`). The standalone Bills feature this item originally targeted was removed in favor of Recurring Templates (May 29, 2026).

5. ⏭️ **Budget Overspend Badges** — **Deferred**, folded into Tier 1 "🛑 Budget Alerts & Overspend Warnings" (same underlying budget-limit concept as #2)
```

- [ ] **Step 5: Update the footer date**

In `ROADMAP.md`, change the last line from:

```
**Last Updated**: June 10, 2026
```

to:

```
**Last Updated**: June 14, 2026
```

- [ ] **Step 6: Verify formatting**

Run: `grep -n "v3.2.0\|June 10, 2026" ROADMAP.md`

Expected: No output (all stale version/date references replaced). Visually
re-read the file to confirm the new Status Legend and At a Glance table render
as valid Markdown tables.

- [ ] **Step 7: Commit**

```bash
git add ROADMAP.md
git commit -m "Update ROADMAP with status legend, at-a-glance table, and Quick Wins status"
```

---

### Task 7: `README.md` — new feature subsections, footer version bump

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add two new "Key Product Updates" subsections**

In `README.md`, in the "🎯 Key Product Updates" section, immediately after the
end of the "### Cash Flow Forecast (NEW)" subsection's last bullet
(`- **Settings Persisted** — ...`) and before the `---` separator that follows
it, insert two new subsections:

```markdown

### Debt Payoff Date Display (NEW)
- **Payoff Date on Every Debt Card** — Credit Card and Fixed Amount debts both show a "📅 Payoff Date" once a payment plan has been calculated on the Plan page
- **"Run a Plan to See" Hint** — Shown until a plan is calculated, consistent with the existing "Total Interest (projected)" hint

### Recurring Template "Mark as Paid This Month" (NEW)
- **Paid Status Toggle** — Mark a subscription, reimbursement, or transfer as paid for the current month with a single click
- **Distinct from Skip Month** — "Paid" confirms an occurrence that happened; "Skip" suppresses an occurrence that won't happen — both can be tracked independently
- **Automatic Monthly Reset** — Paid status is tracked per `'YYYY-MM'` month key (`paidMonths`), so each new month starts unmarked
- **Export/Import Ready** — `paidMonths` round-trips through JSON backup like `skippedMonths`
```

- [ ] **Step 2: Update the footer version and date**

In `README.md`, change the last line from:

```
*MyFinances v3.2.0 — Updated June 10, 2026*
```

to:

```
*MyFinances v3.5.0 — Updated June 14, 2026*
```

- [ ] **Step 3: Verify formatting**

Run: `grep -n "v3.2.0\|June 10, 2026" README.md`

Expected: No output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document Debt Payoff Date and Recurring mark-as-paid features in README"
```

---

### Task 8: `guide.html` — Debts and Recurring Templates guide notes

**Files:**
- Modify: `guide.html`

- [ ] **Step 1: Add a payoff-date guide note to the Debts section**

In `guide.html`, in the "Adding Debts" section (`id="adding-debts"`), change:

```html
                <h3>Editing and Deleting</h3>
                <ul>
                    <li>Use Edit to load existing values and update</li>
                    <li>Use Delete to remove a debt entry</li>
                </ul>
            </section>
```

to:

```html
                <h3>Editing and Deleting</h3>
                <ul>
                    <li>Use Edit to load existing values and update</li>
                    <li>Use Delete to remove a debt entry</li>
                </ul>

                <div class="guide-note">Once you calculate a payment plan on the Plan page, each debt card shows a "📅 Payoff Date" row with its projected payoff date. Until then, it shows "Run a plan to see".</div>
            </section>
```

- [ ] **Step 2: Add a "Marking as Paid" section to Recurring Templates**

In `guide.html`, in the "Recurring Transaction Templates" section
(`id="recurring-templates"`), change:

```html
                <h3>Pausing and Skipping</h3>
                <ul>
                    <li><strong>Pause</strong> — click the pause icon on a template card to temporarily deactivate it (skip all occurrences in all months)</li>
                    <li><strong>Skip Month</strong> — click skip on a template's monthly occurrence card to skip just that one month</li>
                    <li><strong>Unskip</strong> — click the unskipped badge to restore a skipped month</li>
                </ul>

                <div class="guide-note">Recurring templates automatically appear in the Ledger's projected transactions, Reports calendar, Money Flow chart, and Variance Dashboard for complete cash flow visibility.</div>
            </section>
```

to:

```html
                <h3>Pausing and Skipping</h3>
                <ul>
                    <li><strong>Pause</strong> — click the pause icon on a template card to temporarily deactivate it (skip all occurrences in all months)</li>
                    <li><strong>Skip Month</strong> — click skip on a template's monthly occurrence card to skip just that one month</li>
                    <li><strong>Unskip</strong> — click the unskipped badge to restore a skipped month</li>
                </ul>

                <h3>Marking as Paid</h3>
                <ul>
                    <li><strong>Mark as Paid</strong> — click "✅ Mark as paid" on an active template's card to flag this month's occurrence as paid; the card shows a "✅ Paid this month" badge</li>
                    <li><strong>Unmark Paid</strong> — click "↩ Unmark paid" to clear the paid status for this month</li>
                    <li>Paid status resets automatically at the start of each calendar month and does not affect Ledger totals or projections — it's a tracking aid, distinct from Skip Month (which suppresses the occurrence entirely)</li>
                </ul>

                <div class="guide-note">Recurring templates automatically appear in the Ledger's projected transactions, Reports calendar, Money Flow chart, and Variance Dashboard for complete cash flow visibility.</div>
            </section>
```

- [ ] **Step 3: Verify the guide loads without errors**

Run: `pytest tests/integration/test_smoke.py -v`

Expected: All PASS. Optionally open `http://localhost:5500/guide.html` in a
browser and visually confirm both new notes render correctly (light and dark
mode).

- [ ] **Step 4: Commit**

```bash
git add guide.html
git commit -m "Document payoff date and mark-as-paid features in user guide"
```

---

## Final Check

- [ ] Run the full test suite: `pytest tests/ -v`

Expected: All PASS (no regressions introduced across security, feature, UI, and
integration suites).
