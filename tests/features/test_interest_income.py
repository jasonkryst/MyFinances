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


# ---------- reports ----------

def _reports_income_stat_text(page):
    """Text of the Income stat card in the Income-vs-Expenses strip."""
    return page.evaluate("""() => {
        const strip = document.querySelector('#reportsIncomeExp');
        if (!strip) return '';
        const card = strip.querySelector('.rpt-stat--income');
        return card ? card.textContent : '';
    }""")


@pytest.mark.feature
def test_interest_counts_as_income_in_reports(app_page):
    """The Reports Income stat includes the interest deposit."""
    page = app_page
    _seed_account(page, rate=12, balance=1000)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)

    income_text = _reports_income_stat_text(page)
    assert '10.00' in income_text, \
        f"Reports income should include $10.00 interest, got: {income_text}"


@pytest.mark.feature
def test_interest_absent_from_reports_when_rate_zero(app_page):
    """No phantom income appears for 0%-rate accounts."""
    page = app_page
    _seed_account(page, rate=0, balance=1000)
    page.evaluate("() => window.app.switchPage('reports')")
    page.wait_for_timeout(300)

    income_text = _reports_income_stat_text(page)
    assert '$0.00' in income_text, \
        f"Reports income should be $0.00 with no income sources, got: {income_text}"
