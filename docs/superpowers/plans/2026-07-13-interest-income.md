# Interest Income Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounts get an optional annual interest rate (% APY); the ledger projection auto-generates a monthly interest deposit on the last day of each month, compounding month-over-month and honoring ledger amount overrides.

**Architecture:** The ledger is fully projected (no stored transactions), so interest transactions are *generated* inside `buildProjectedAccountTransactions()` in `src/ledger.js`, which every consumer (Ledger page, account projections, Forecast, CSV export) flows through. The only persisted change is a new `interestRate` field on account records, sanitized in `src/storage.js`. Reports aggregate by explicit `tx.type` checks, so the new `'interest'` type is added to income-side sites in `src/reports.js`.

**Tech Stack:** Vanilla ES6+ JS (no build step), Playwright + pytest (`asyncio_mode = auto`, sync fixtures used here).

**Spec:** `docs/superpowers/specs/2026-07-13-interest-income-design.md`

## Global Constraints

- Serve the app before running any test: `python -m http.server 5500` (tests hit `http://localhost:5500/`).
- All user-supplied data rendered via `innerHTML` must go through `escapeHtml()`; strict CSP — no inline styles/scripts, dynamic styling via CSS classes only.
- New persisted fields MUST get a sanitizer entry in `src/storage.js` or they won't survive export/import.
- `interestRate`: annual APY percent, finite number, clamped to `[0, 100]`, default `0`.
- Interest transaction shape: `type: 'interest'`, `name: 'Interest'`, `category: 'Interest'`, `sourceId: <account.id>`, dated `new Date(year, month + 1, 0)` (last day of month).
- Zero/negative balance months generate no interest transaction. Sub-cent interest (rounds to ≤ 0) generates no transaction.
- Feature logic lives in module functions `fn(app, ...)`; `DebtTrackerApp` methods are thin delegates (no new delegates needed by this plan).
- Commit after every task; commit messages follow existing style (`Adds ...`, `Fixes ...` or `feat:` — match recent history, e.g. `Adds monthly interest income generation per #30`).

---

### Task 1: Persist `interestRate` on account records

**Files:**
- Modify: `src/storage.js:26-33` (`sanitizeAccount`)
- Test: `tests/features/test_storage_import.py` (append)

**Interfaces:**
- Consumes: `sanitizeFiniteNumber(value, fallback, { min, max })` from `src/utils.js:25`.
- Produces: every loaded/imported account object carries a numeric `interestRate` in `[0, 100]` (default `0`). Tasks 2–5 rely on `account.interestRate` existing after any load/import.

- [ ] **Step 1: Write the failing tests**

Append to `tests/features/test_storage_import.py`:

```python
@pytest.mark.feature
def test_import_sanitizes_account_interest_rate(app_page):
    """interestRate is clamped to [0,100]; non-numeric/missing defaults to 0."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            accounts: [
                { id: 1, name: 'Neg Rate', type: 'Savings', startingBalance: 100, interestRate: -5 },
                { id: 2, name: 'Huge Rate', type: 'Savings', startingBalance: 100, interestRate: 200 },
                { id: 3, name: 'Junk Rate', type: 'Savings', startingBalance: 100, interestRate: 'abc' },
                { id: 4, name: 'No Rate', type: 'Savings', startingBalance: 100 },
                { id: 5, name: 'Valid Rate', type: 'Savings', startingBalance: 100, interestRate: 4.5 }
            ]
        };
        const file = new File([JSON.stringify(payload)], 'rates.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve(app.accounts.map(a => a.interestRate)), 300);
        });
    }""")

    assert result == [0, 100, 0, 0, 4.5], \
        f"interestRate sanitization wrong: {result} (expected [0, 100, 0, 0, 4.5])"


@pytest.mark.feature
def test_interest_rate_survives_storage_round_trip(app_page):
    """A valid interestRate persists through saveToStorage -> reload."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'HYSA', type: 'Savings', startingBalance: 1000, interestRate: 4.5 }];
        app.saveToStorage();
    }""")
    page.reload(wait_until="networkidle")

    rate = page.evaluate("() => window.app.accounts[0]?.interestRate")
    assert rate == 4.5, f"interestRate lost on reload: {rate}"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest "tests/features/test_storage_import.py::test_import_sanitizes_account_interest_rate" "tests/features/test_storage_import.py::test_interest_rate_survives_storage_round_trip" -v`
Expected: both FAIL — sanitized accounts have no `interestRate` key, so the first returns `[None, None, None, None, None]` and the round-trip returns `None`.

- [ ] **Step 3: Add the sanitizer field**

In `src/storage.js`, change `sanitizeAccount` to:

```javascript
function sanitizeAccount(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        type: normalizeText(record?.type, 30) || 'Other',
        startingBalance: sanitizeFiniteNumber(record?.startingBalance, 0),
        interestRate: sanitizeFiniteNumber(record?.interestRate, 0, { min: 0, max: 100 })
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest "tests/features/test_storage_import.py" -v`
Expected: ALL PASS (new tests plus the existing import tests — regression check).

- [ ] **Step 5: Commit**

```bash
git add src/storage.js tests/features/test_storage_import.py
git commit -m "Adds interestRate account field with import/load sanitization per #30"
```

---

### Task 2: Generate monthly interest transactions in the ledger engine

**Files:**
- Modify: `src/ledger.js:77-301` (`buildProjectedAccountTransactions`)
- Test: Create `tests/features/test_interest_income.py`

**Interfaces:**
- Consumes: `account.interestRate` (Task 1); existing `addTx(...)`, `getEffectiveAmount(app, tx)`, `makeLedgerTransactionId(tx)` — all already inside `src/ledger.js`.
- Produces: transactions with `type: 'interest'`, `name: 'Interest'`, `category: 'Interest'`, `sourceId: <account.id>`, `accountId: <account.id>`, positive `amount`, dated last day of month, deterministic `transactionId` of the form `interest|<acctId>|<acctId>|<YYYY-MM-DD>`. Emitted by `getLedgerTransactionsForMonth`, `getLedgerTransactions`, and therefore visible to `computeAccountBalance` and `getAccountForecastSeries`. Task 4 (reports) and Task 5 (integration) rely on this exact type string and shape.

- [ ] **Step 1: Write the failing engine tests**

Create `tests/features/test_interest_income.py`:

```python
#!/usr/bin/env python3
"""
Interest Income Tests (Issue #30)
Accounts with a non-zero interestRate generate a monthly interest deposit
in the projected ledger: last day of month, APY/12 on the projected
end-of-month balance, compounding across the projection window,
override-aware. Zero/negative balances and sub-cent interest generate
nothing.
"""

import pytest


def _seed_account(page, rate, balance=1000):
    """Replace app state with a single Savings account and save."""
    page.evaluate("""([rate, balance]) => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'HYSA', type: 'Savings',
                          startingBalance: balance, interestRate: rate }];
        app.incomes = []; app.bonuses = []; app.debts = []; app.bills = [];
        app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = []; app.ledgerAmountOverrides = {};
        app.saveToStorage();
    }""", [rate, balance])


def _interest_txs(page):
    """All type='interest' rows from the 12-month ledger, oldest first."""
    return page.evaluate("""async () => {
        const mod = await import('/src/ledger.js');
        return mod.getLedgerTransactions(window.app)
            .filter(t => t.type === 'interest')
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(t => ({
                amount: t.amount, date: t.date, name: t.name,
                category: t.category, transactionId: t.transactionId,
                accountId: t.accountId, hasOverride: t.hasOverride
            }));
    }""")


# ---------- positive ----------

@pytest.mark.feature
def test_interest_posts_on_last_day_of_month(app_page):
    """$1,000 @ 12% APY -> $10.00 interest dated the last day of the current month."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)

    tx = page.evaluate("""async () => {
        const mod = await import('/src/ledger.js');
        const now = new Date();
        const txs = mod.getLedgerTransactionsForMonth(
            window.app, now.getFullYear(), now.getMonth());
        const t = txs.find(x => x.type === 'interest');
        if (!t) return null;
        const d = new Date(t.date);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return {
            amount: t.amount, name: t.name, category: t.category,
            day: d.getDate(), month: d.getMonth(),
            expectedDay: lastDay.getDate(), expectedMonth: lastDay.getMonth()
        };
    }""")

    assert tx is not None, "No interest transaction generated"
    assert abs(tx["amount"] - 10.00) < 0.001, f"Expected $10.00, got {tx['amount']}"
    assert tx["name"] == "Interest"
    assert tx["category"] == "Interest"
    assert tx["day"] == tx["expectedDay"] and tx["month"] == tx["expectedMonth"], \
        "Interest not dated the last day of the month"


@pytest.mark.feature
def test_interest_compounds_month_over_month(app_page):
    """Month 2 interest is computed on month 1's balance including interest."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)

    txs = _interest_txs(page)
    assert len(txs) == 12, f"Expected 12 monthly interest txs, got {len(txs)}"
    assert abs(txs[0]["amount"] - 10.00) < 0.001
    assert abs(txs[1]["amount"] - 10.10) < 0.001, \
        f"Month 2 should compound on $1,010 -> $10.10, got {txs[1]['amount']}"
    assert txs[1]["amount"] > txs[0]["amount"]


@pytest.mark.feature
def test_interest_transaction_id_is_deterministic(app_page):
    """transactionId follows interest|<acctId>|<acctId>|<YYYY-MM-DD> so overrides can key on it."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)

    result = page.evaluate("""async () => {
        const mod = await import('/src/ledger.js');
        const txs = mod.getLedgerTransactions(window.app)
            .filter(t => t.type === 'interest')
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const now = new Date();
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const y = last.getFullYear();
        const m = String(last.getMonth() + 1).padStart(2, '0');
        const d = String(last.getDate()).padStart(2, '0');
        return { actual: txs[0].transactionId, expected: `interest|1|1|${y}-${m}-${d}` };
    }""")

    assert result["actual"] == result["expected"], \
        f"transactionId {result['actual']} != {result['expected']}"


@pytest.mark.feature
def test_override_feeds_next_months_compounding(app_page):
    """Overriding month 1's interest changes month 2's computed interest."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)

    result = page.evaluate("""async () => {
        const mod = await import('/src/ledger.js');
        const app = window.app;
        const before = mod.getLedgerTransactions(app)
            .filter(t => t.type === 'interest')
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        mod.setLedgerAmountOverride(app, before[0].transactionId, 50, {
            originalAmount: before[0].originalAmount
        });
        const after = mod.getLedgerTransactions(app)
            .filter(t => t.type === 'interest')
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        return {
            firstAmount: after[0].amount,
            firstHasOverride: after[0].hasOverride,
            secondAmount: after[1].amount
        };
    }""")

    assert result["firstHasOverride"] is True
    assert abs(result["firstAmount"] - 50.0) < 0.001
    # Month 2 base: 1000 + 50 (overridden interest) = 1050 -> 1% = 10.50
    assert abs(result["secondAmount"] - 10.50) < 0.001, \
        f"Month 2 should compound on override -> $10.50, got {result['secondAmount']}"


@pytest.mark.feature
def test_interest_included_in_projected_account_balance(app_page):
    """computeAccountBalance for the current month includes the interest deposit."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)

    balance = page.evaluate("() => window.app.computeAccountBalance(1)")
    assert abs(balance - 1010.00) < 0.001, \
        f"Projected balance should include $10 interest: {balance}"


@pytest.mark.feature
def test_interest_only_after_balance_turns_positive(app_page):
    """An account that starts negative earns interest only once inflows push it positive."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
        app.accounts = [{ id: 1, name: 'Recovering', type: 'Checking',
                          startingBalance: -500, interestRate: 12 }];
        app.incomes = [{ id: 2, name: 'Salary', amount: 2000, firstPayDate: iso,
                         frequency: 'monthly', accountId: 1 }];
        app.bonuses = []; app.debts = []; app.bills = []; app.expenses = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.reconciliations = []; app.ledgerAmountOverrides = {};
        app.saveToStorage();
    }""")

    txs = _interest_txs(page)
    # Month 1 balance: -500 + 2000 = 1500 -> positive, earns 1% = $15.00
    assert len(txs) == 12
    assert abs(txs[0]["amount"] - 15.00) < 0.001, \
        f"Expected $15.00 on recovered balance, got {txs[0]['amount']}"


# ---------- negative ----------

@pytest.mark.feature
def test_zero_rate_generates_no_interest(app_page):
    """Rate 0 (the default) never generates interest transactions."""
    page = app_page
    _seed_account(page, rate=0, balance=100000)
    assert _interest_txs(page) == []


@pytest.mark.feature
def test_negative_balance_generates_no_interest(app_page):
    """Balance <= 0 months are skipped (no negative-interest charges)."""
    page = app_page
    _seed_account(page, rate=12, balance=-500)
    assert _interest_txs(page) == []


@pytest.mark.feature
def test_zero_balance_generates_no_interest(app_page):
    page = app_page
    _seed_account(page, rate=12, balance=0)
    assert _interest_txs(page) == []


@pytest.mark.feature
def test_sub_cent_interest_generates_no_transaction(app_page):
    """Interest that rounds below one cent is not posted."""
    page = app_page
    # $0.40 @ 1% APY -> 0.40 * 0.01/12 = $0.0003/month -> rounds to $0.00
    _seed_account(page, rate=1, balance=0.40)
    assert _interest_txs(page) == []


@pytest.mark.feature
def test_interest_is_projection_only_not_persisted(app_page):
    """Interest transactions are generated at read time; localStorage gains no transaction records."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)
    # Force a full ledger build, then re-save
    page.evaluate("""async () => {
        const mod = await import('/src/ledger.js');
        mod.getLedgerTransactions(window.app);
        window.app.saveToStorage();
    }""")

    stored = page.evaluate("() => localStorage.getItem('debtTrackerData')")
    assert '"type":"interest"' not in stored and "'type':'interest'" not in stored, \
        "Interest transactions must not be persisted"
    assert '"interestRate":12' in stored.replace(" ", ""), \
        "The account's interestRate should be persisted"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_interest_income.py -v`
Expected: the positive tests FAIL (no `interest` transactions generated); the four "generates no interest" negative tests PASS vacuously (that's fine — they guard the implementation); `test_interest_is_projection_only_not_persisted` FAILS only on the `interestRate` persistence assert if Task 1 is missing, otherwise PASSES vacuously.

- [ ] **Step 3: Implement interest generation in `buildProjectedAccountTransactions`**

In `src/ledger.js`, three edits inside `buildProjectedAccountTransactions` (lines 77–301):

**(a)** After the `accountMap` setup (after line 82 `accountMap[UNLINKED_KEY] = ...`), add:

```javascript
    // Running balances used to compute monthly interest deposits (#30).
    // Seeded from startingBalance and carried across the projected window so
    // interest compounds month over month.
    const interestBalances = {};
    for (const acct of app.accounts || []) {
        interestBalances[acct.id] = Number(acct.startingBalance) || 0;
    }
```

**(b)** At the top of the month loop (immediately after `const month = (startMonth + m) % 12;`), add:

```javascript
        // Snapshot per-account tx counts so "this month's transactions" is
        // defined by generation pass, not by date — a bill with dueDay 31
        // generated for February date-overflows into March but still belongs
        // to February's balance.
        const monthStartTxCounts = {};
        for (const acctId in accountMap) {
            monthStartTxCounts[acctId] = accountMap[acctId].txs.length;
        }
```

**(c)** At the end of the month loop (after the sinking-funds `for` block, still inside `for (let m = 0; ...)`), add:

```javascript
        // Monthly interest deposits (#30): APY/12 on the projected
        // end-of-month balance, posted on the last day of the month.
        // Override-aware in both directions — the base balance uses effective
        // amounts, and an overridden interest amount feeds later months.
        for (const acct of app.accounts || []) {
            const monthTxs = accountMap[acct.id].txs.slice(monthStartTxCounts[acct.id]);
            let balance = interestBalances[acct.id];
            for (const tx of monthTxs) {
                balance += getEffectiveAmount(app, tx);
            }
            const rate = Number(acct.interestRate) || 0;
            if (rate > 0 && balance > 0) {
                const interest = Math.round(balance * (rate / 100 / 12) * 100) / 100;
                if (interest > 0) {
                    addTx({
                        accountId: acct.id,
                        date: new Date(year, month + 1, 0),
                        name: 'Interest',
                        amount: interest,
                        type: 'interest',
                        sourceId: acct.id,
                        category: 'Interest'
                    });
                    const txList = accountMap[acct.id].txs;
                    balance += getEffectiveAmount(app, txList[txList.length - 1]);
                }
            }
            interestBalances[acct.id] = balance;
        }
```

No changes are needed in `renderLedgerPage` — interest rows are positive (green income styling) and get the override button automatically because they carry a `transactionId` and are neither rollover nor reconciliation rows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/features/test_interest_income.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Regression-check the ledger/account/forecast suites**

Run: `pytest tests/features/test_ledger.py tests/features/test_accounts.py tests/features/test_forecast.py tests/features/test_networth.py -v`
Expected: ALL PASS (no existing test seeds an `interestRate`, so generated data is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/ledger.js tests/features/test_interest_income.py
git commit -m "Adds monthly interest deposit generation to ledger projection per #30"
```

---

### Task 3: Accounts UI — rate input, inline edit, card badge

**Files:**
- Modify: `index.html:120-150` (Add Account form)
- Modify: `src/accounts.js` (`renderAccountsList`, `addAccount`, `saveEditAccount`)
- Test: `tests/features/test_interest_income.py` (append)

**Interfaces:**
- Consumes: `sanitizeFiniteNumber` from `src/utils.js` (already imported in `accounts.js`); `account.interestRate` (Task 1).
- Produces: form input `#accountInterestRate`, edit input `ac-rate-${id}`, and a card badge `<span class="acct-rate-badge">📈 X.XX% APY</span>` rendered only when `interestRate > 0`. Task 5's integration test fills `#accountInterestRate`.

- [ ] **Step 1: Write the failing UI tests**

Append to `tests/features/test_interest_income.py`:

```python
# ---------- accounts UI ----------

@pytest.mark.feature
def test_add_account_with_interest_rate_shows_badge(app_page):
    """Creating an account with a rate persists it and shows the APY badge."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)

    page.fill('#accountName', 'Rate Savings')
    page.select_option('#accountType', label='Savings')
    page.fill('#accountStartingBalance', '1000')
    page.fill('#accountInterestRate', '2.5')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Rate Savings', timeout=10000)

    rate = page.evaluate(
        "() => window.app.accounts.find(a => a.name === 'Rate Savings')?.interestRate")
    assert rate == 2.5, f"interestRate not saved from form: {rate}"

    badge = page.text_content('.acct-rate-badge')
    assert badge is not None and '2.50% APY' in badge, f"APY badge missing/wrong: {badge}"


@pytest.mark.feature
def test_edit_account_interest_rate_inline(app_page):
    """The inline edit card exposes the rate and saves changes."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'EditMe', type: 'Savings',
                          startingBalance: 500, interestRate: 1 }];
        app.saveToStorage();
        app.switchPage('accounts');
    }""")
    page.wait_for_selector('text=EditMe')

    page.click('[data-account-action="edit"][data-account-id="1"]')
    page.wait_for_selector('#ac-rate-1')
    page.fill('#ac-rate-1', '3.75')
    page.click('[data-account-action="save"][data-account-id="1"]')
    page.wait_for_selector('.acct-rate-badge')

    rate = page.evaluate("() => window.app.accounts[0].interestRate")
    assert rate == 3.75, f"Edited rate not saved: {rate}"
    assert '3.75% APY' in page.text_content('.acct-rate-badge')


@pytest.mark.feature
def test_zero_rate_account_shows_no_badge(app_page):
    """Leaving the rate blank stores 0 and renders no badge."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)

    page.fill('#accountName', 'Plain Checking')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '100')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Plain Checking', timeout=10000)

    rate = page.evaluate(
        "() => window.app.accounts.find(a => a.name === 'Plain Checking')?.interestRate")
    assert rate == 0, f"Blank rate should store 0: {rate}"
    assert page.query_selector('.acct-rate-badge') is None, \
        "No APY badge should render for a 0% account"


@pytest.mark.feature
def test_negative_rate_input_clamped_to_zero(app_page):
    """A negative rate typed into the form is clamped to 0 (no badge)."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)

    page.fill('#accountName', 'Neg Rate')
    page.select_option('#accountType', label='Savings')
    page.fill('#accountStartingBalance', '100')
    page.fill('#accountInterestRate', '-3')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Neg Rate', timeout=10000)

    rate = page.evaluate(
        "() => window.app.accounts.find(a => a.name === 'Neg Rate')?.interestRate")
    assert rate == 0, f"Negative rate should clamp to 0: {rate}"
    assert page.query_selector('.acct-rate-badge') is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/features/test_interest_income.py -k "badge or inline or clamped" -v`
Expected: FAIL — `#accountInterestRate` does not exist (`page.fill` times out) and no `.acct-rate-badge` renders.

- [ ] **Step 3: Add the form field to `index.html`**

In the Add Account form grid (`index.html`, inside `.account-form-grid`, after the Starting Balance `form-group` ending at line 146), add:

```html
                            <div class="form-group">
                                <label for="accountInterestRate">Interest Rate (% APY)
                                    <span class="help-icon" tabindex="0" aria-label="Optional annual interest rate for this account. When set above zero, a monthly interest deposit is automatically added to the Ledger on the last day of each month. You can override any month's amount in the Ledger with the true value from your statement.">?</span>
                                </label>
                                <input type="number" id="accountInterestRate" placeholder="0.00" step="0.01" min="0" max="100">
                            </div>
```

- [ ] **Step 4: Wire the field through `src/accounts.js`**

**(a)** In `addAccount(app)` (line 144), read and store the rate:

```javascript
export function addAccount(app) {
    const name = normalizeText(document.getElementById('accountName').value, 80);
    const type = normalizeText(document.getElementById('accountType').value, 30);
    const startingBalance = sanitizeFiniteNumber(document.getElementById('accountStartingBalance').value, NaN);
    const interestRate = sanitizeFiniteNumber(document.getElementById('accountInterestRate')?.value, 0, { min: 0, max: 100 });

    if (!name) { alert('Please enter an account name.'); return; }
    if (isNaN(startingBalance)) { alert('Please enter a starting balance (use 0 if unknown).'); return; }

    app.accounts.push({ id: Date.now(), name, type, startingBalance, interestRate });
    ...
```

(Only the two `interestRate` lines change; the rest of the function body stays as-is.)

Note: `sanitizeFiniteNumber('')` → `Number('')` is `0`, so a blank field stores `0` without special-casing.

**(b)** In the editing branch of `renderAccountsList` (the `acct-edit-grid` template around line 57–78), add a fourth field after the Starting Balance group:

```javascript
                    <div class="form-group form-no-margin">
                        <label class="label-compact">Interest Rate (% APY)</label>
                        <input type="number" id="ac-rate-${a.id}" value="${Number(a.interestRate) || 0}" step="0.01" min="0" max="100" class="form-full-width">
                    </div>
```

**(c)** In the display branch of `renderAccountsList`, right after the type badge `<span class="acct-type-badge">${escapeHtml(a.type)}</span>` (line 106), add:

```javascript
                    ${Number(a.interestRate) > 0 ? `<span class="acct-rate-badge">📈 ${Number(a.interestRate).toFixed(2)}% APY</span>` : ''}
```

**(d)** In `saveEditAccount(app, id)` (line 179), read and store the rate:

```javascript
    const interestRate = sanitizeFiniteNumber(document.getElementById(`ac-rate-${id}`)?.value, 0, { min: 0, max: 100 });
    ...
    app.accounts[idx] = { ...app.accounts[idx], name, type, startingBalance, interestRate };
```

**(e)** Style the badge in `styles.css` — find the `.acct-type-badge` rule and add alongside it:

```css
.acct-rate-badge {
    display: inline-block;
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--success-bg, rgba(16, 185, 129, 0.15));
    color: var(--success-text, #059669);
    margin-left: 6px;
    white-space: nowrap;
}
```

(Match the file's existing badge pattern — if `.acct-type-badge` uses different variable names for its colors, reuse those conventions. No inline styles: CSP forbids them.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/features/test_interest_income.py tests/features/test_accounts.py -v`
Expected: ALL PASS (including pre-existing account CRUD tests).

- [ ] **Step 6: Visual sanity check for dark mode**

Load `http://localhost:5500`, add an account with a rate, toggle dark mode, and confirm the badge is legible. If contrast is poor, add a dark-mode override next to the existing dark-mode badge rules in `styles.css` (search for `[data-theme="dark"] .acct-type-badge` or the file's dark-mode convention) using green-400 `#4ade80` for text — the palette CHANGELOG 4.3.0 established.

- [ ] **Step 7: Commit**

```bash
git add index.html src/accounts.js styles.css tests/features/test_interest_income.py
git commit -m "Adds interest rate field, inline edit, and APY badge to accounts per #30"
```

---

### Task 4: Count interest as income in Reports

**Files:**
- Modify: `src/reports.js:103,406,598,646,939,957`
- Test: `tests/features/test_interest_income.py` (append)

**Interfaces:**
- Consumes: `'interest'`-typed transactions from Task 2.
- Produces: interest included in net-worth snapshot `incomeReceived`, the calendar's income (payday) day-cells, the Income vs Expenses stat strip + income-by-source chart, and both months of the month-over-month summary. `spending.js` needs no change (it categorizes outflows only; positive interest returns no category).

- [ ] **Step 1: Write the failing test**

Append to `tests/features/test_interest_income.py`:

```python
# ---------- reports ----------

@pytest.mark.feature
def test_interest_counts_as_income_in_reports(app_page):
    """The Reports Income stat includes the interest deposit."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_selector('.rpt-stat--income .rpt-stat-value')

    income_text = page.text_content('.rpt-stat--income .rpt-stat-value')
    assert '10.00' in income_text, \
        f"Reports income should include $10.00 interest, got: {income_text}"


@pytest.mark.feature
def test_interest_absent_from_reports_when_rate_zero(app_page):
    """No phantom income appears for 0%-rate accounts."""
    page = app_page
    _seed_account(page, rate=0, balance=1000)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_selector('.rpt-stat--income .rpt-stat-value')

    income_text = page.text_content('.rpt-stat--income .rpt-stat-value')
    assert '$0.00' in income_text, \
        f"Reports income should be $0.00 with no income sources, got: {income_text}"
```

- [ ] **Step 2: Run tests to verify the positive one fails**

Run: `pytest tests/features/test_interest_income.py -k "reports" -v`
Expected: `test_interest_counts_as_income_in_reports` FAILS (income shows `$0.00` — reports don't recognize `'interest'`); the zero-rate negative test PASSES.

- [ ] **Step 3: Add `'interest'` to the income-side type checks**

Six edits in `src/reports.js` (line numbers pre-edit):

1. Line 103 (`computeSnapshotMetrics`):
```javascript
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest' || (tx.type === 'recurring' && tx.amount > 0)) {
```
2. Line 406 (calendar day-bucketing — interest deposits render as income/payday events):
```javascript
        if (tx.type === 'income' || tx.type === 'interest') {
```
3. Line 598 (Income vs Expenses totals):
```javascript
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
```
4. Line 646 (income-by-source chart):
```javascript
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
```
5. Line 939 (month-over-month, current month):
```javascript
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
```
6. Line 957 (month-over-month, previous month):
```javascript
        if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/features/test_interest_income.py tests/features/test_reports.py -v`
Expected: ALL PASS (reports regression suite included).

- [ ] **Step 5: Commit**

```bash
git add src/reports.js tests/features/test_interest_income.py
git commit -m "Counts interest deposits as income in Reports per #30"
```

---

### Task 5: End-to-end integration test

**Files:**
- Create: `tests/integration/test_interest_income_workflow.py`

**Interfaces:**
- Consumes: `#accountInterestRate` form field (Task 3), `'interest'` ledger rows (Task 2), Reports income stat (Task 4).
- Produces: nothing new — locks the whole flow together.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/test_interest_income_workflow.py`:

```python
#!/usr/bin/env python3
"""
Interest Income end-to-end workflow (Issue #30):
create an interest-bearing account through the UI, then verify the
auto-generated deposit flows to the Ledger, Reports income, and the
account's projected balance.
"""

import pytest


@pytest.mark.integration
def test_interest_income_end_to_end(app_page):
    page = app_page

    # 1. Create the account through the real form
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'HY Savings')
    page.select_option('#accountType', label='Savings')
    page.fill('#accountStartingBalance', '1000')
    page.fill('#accountInterestRate', '12')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=HY Savings', timeout=10000)

    # 2. Accounts page: projected balance includes the $10 deposit
    acct_id = page.evaluate("() => window.app.accounts.find(a => a.name === 'HY Savings').id")
    projected = page.evaluate(f"() => window.app.computeAccountBalance({acct_id})")
    assert abs(projected - 1010.00) < 0.001, f"Projected balance missing interest: {projected}"

    # 3. Ledger page: an 'Interest' row exists
    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector('.ledger-table')
    page.select_option('#ledgerDateRange', 'all')
    page.wait_for_selector('text=Interest', timeout=10000)
    assert page.query_selector('.ledger-table >> text=Interest'), \
        "Interest transaction not visible in the Ledger"

    # 4. Reports page: income stat includes the interest
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_selector('.rpt-stat--income .rpt-stat-value')
    income_text = page.text_content('.rpt-stat--income .rpt-stat-value')
    assert '10.00' in income_text, f"Reports income missing interest: {income_text}"

    # 5. Survives reload
    page.reload(wait_until="networkidle")
    rate = page.evaluate("() => window.app.accounts.find(a => a.name === 'HY Savings').interestRate")
    assert rate == 12
```

- [ ] **Step 2: Run it**

Run: `pytest tests/integration/test_interest_income_workflow.py -v`
Expected: PASS (all prior tasks complete). If the Ledger step can't find the row, check that the date-range filter step ran — the default "Next 30 Days" window can exclude a month-end date early in a month; `all` always includes it.

- [ ] **Step 3: Run the full suite as a final regression gate**

Run: `pytest tests/ -v -m "not slow"`
Expected: ALL PASS. Investigate any failure before proceeding — do not skip.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_interest_income_workflow.py
git commit -m "Adds interest income end-to-end workflow test per #30"
```

---

### Task 6: Documentation and version bump

**Files:**
- Modify: `guide.html:140-161` (Setting Up Accounts)
- Modify: `README.md` (Account Management features)
- Modify: `CHANGELOG.md` (new 4.4.0 entry at top)
- Modify: `src/utils.js:3` (`APP_VERSION`)

**Interfaces:**
- Consumes: final behavior from Tasks 1–5.
- Produces: user-facing docs; version `4.4.0` in the footer.

- [ ] **Step 1: Update `guide.html`**

In the "Setting Up Accounts" fields table (line 152–156), add a row after Starting Balance:

```html
                            <tr><td>Interest Rate (% APY)</td><td>Optional annual rate for interest-bearing accounts (e.g. 4.5 for a high-yield savings account); leave blank for 0%</td></tr>
```

After the existing guide-note (line 160), add a second note:

```html
                <div class="guide-note"><strong>Interest Income:</strong> When an account has an interest rate above 0%, a monthly <em>Interest</em> deposit is automatically added to the Ledger on the last day of each month — calculated as APY ÷ 12 on the account's projected end-of-month balance, compounding month over month. The projection is an estimate: when your bank posts the real amount, use the Ledger's <em>Override</em> button on the Interest row to record the true value, and future months will compound on it. Months where the projected balance is zero or negative earn no interest.</div>
```

- [ ] **Step 2: Update `README.md`**

In the "Account Management" feature section (after the "Account types" bullet), add:

```markdown
- **Interest income** — optional per-account interest rate (% APY); auto-generates a monthly Interest deposit in the Ledger (last day of month, APY ÷ 12 on projected end-of-month balance, compounding), overridable with the true posted amount
```

Also update the "Account types" bullet's field list from "name and starting balance" to "name, starting balance, and optional interest rate (% APY)".

- [ ] **Step 3: Add the CHANGELOG entry**

At the top of `CHANGELOG.md` (after the `---` following the intro), insert:

```markdown
## [4.4.0] — 2026-07-13

### Added
- **Interest Income (#30)** — accounts can now carry an annual interest rate (% APY). Non-zero rates auto-generate a monthly *Interest* deposit in the Ledger on the last day of each month, computed as APY ÷ 12 on the account's projected end-of-month balance and compounding month over month. Interest rows support the existing ledger amount override, and an overridden (true) amount feeds subsequent months' compounding. Interest counts as income in Reports (stat strip, income-by-source chart, month-over-month summary, calendar, and net-worth snapshot income). Zero/negative-balance months and sub-cent amounts generate nothing; debt-side interest remains modeled in the Debts module
- **Accounts UI** — Interest Rate (% APY) field on the Add Account form and inline edit card; accounts with a rate show a 📈 APY badge
- **17 Playwright tests** (`tests/features/test_interest_income.py`, `tests/features/test_storage_import.py`, `tests/integration/test_interest_income_workflow.py`) — engine math, compounding, override feedback, last-day posting, projection-only persistence, UI CRUD, reports integration, import sanitization (clamping −5 → 0, 200 → 100, junk → 0), and an end-to-end workflow

---
```

(Adjust the test count to the real number added before committing.)

- [ ] **Step 4: Bump the version**

`src/utils.js` line 3:

```javascript
export const APP_VERSION = '4.4.0';
```

- [ ] **Step 5: Verify docs render and version shows**

Load `http://localhost:5500` — footer shows `v4.4.0`. Load `http://localhost:5500/guide.html` — new table row and note render correctly in light and dark themes.

Run: `pytest tests/features/test_settings.py -v` (version/footer coverage lives near settings tests; expected: PASS).

- [ ] **Step 6: Commit**

```bash
git add guide.html README.md CHANGELOG.md src/utils.js
git commit -m "Documents interest income and bumps version to 4.4.0 per #30"
```
