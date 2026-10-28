#!/usr/bin/env python3
"""
Recurring income type tests (issue #252)

'income' is a 4th recurring-template type next to subscription / reimbursement /
transfer. Inflow types (income + reimbursement) post positive ledger entries and,
as of this issue, feed Health's cash-flow card; DTI deliberately does not change.
"""

import re

import pytest

from tests.conftest import assert_no_errors


def _seed(page, templates, incomes=None):
    """Reset state to one account + the given recurring templates (JS array literal)."""
    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: 8800, name: 'RI Checking', type: 'Checking', startingBalance: 1000 }}];
        app.incomes = {incomes or '[]'};
        app.bonuses = []; app.bills = []; app.expenses = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.transfers = [];
        app.ledgerAmountOverrides = {{}};
        app.recurringTemplates = {templates};
    }}""")


def _tmpl(tid, name, ttype, amount, frequency='monthly', extra=''):
    return (
        f"{{ id: {tid}, name: '{name}', type: '{ttype}', amount: {amount}, frequency: '{frequency}', "
        f"dayOfMonth: 15, startDate: '2026-01-01', endDate: null, category: 'Other', accountId: 8800, "
        f"targetAccountId: null, paused: false, archived: false, skippedMonths: [], paidMonths: [], "
        f"paidAmounts: {{}} {extra} }}"
    )


def _health_net(page):
    """Render Health and return (net, hero_text) parsed from the cash-flow card."""
    page.evaluate("() => { window.app.switchPage('recurring'); window.app.switchPage('health'); }")
    page.wait_for_selector('#healthSection .health-cashflow-hero', timeout=5000)
    text = page.inner_text('#healthSection .health-cashflow-hero')
    num = float(re.sub(r'[^0-9.\-]', '', text.replace('−', '-')))
    return num, text


def _dti_text(page):
    return page.inner_text('#healthSection')


# --- UI ---------------------------------------------------------------------

@pytest.mark.feature
def test_income_type_in_form_select(app_page):
    page = app_page
    opts = page.evaluate("() => [...document.querySelectorAll('#recurringType option')].map(o => [o.value, o.textContent.trim()])")
    assert ['income', 'Income'] in opts
    assert ['reimbursement', 'Reimbursement'] in opts


@pytest.mark.feature
def test_income_card_shows_badge_and_plus_sign(app_page):
    page = app_page
    _seed(page, "[" + _tmpl(1, 'Retainer', 'income', 500) + "," + _tmpl(2, 'Netflix', 'subscription', 15) + "]")
    page.evaluate("() => window.app.switchPage('recurring')")
    page.evaluate("() => window.app.renderRecurringPage()")
    page.wait_for_selector('#recurringList .recurring-card', timeout=5000)
    cards = page.evaluate("""() => [...document.querySelectorAll('#recurringList .recurring-card')].map(c => ({
        text: c.innerText, pos: !!c.querySelector('.recurring-amount--pos'), neg: !!c.querySelector('.recurring-amount--neg') }))""")
    income = next(c for c in cards if 'Retainer' in c['text'])
    sub = next(c for c in cards if 'Netflix' in c['text'])
    assert 'Income' in income['text'] and income['pos'] and not income['neg']
    assert '+' in income['text']
    assert sub['neg'] and not sub['pos']
    assert_no_errors(page)


@pytest.mark.feature
def test_reimbursement_still_inflow_and_relabelled(app_page):
    page = app_page
    _seed(page, "[" + _tmpl(1, 'Gym refund', 'reimbursement', 40) + "]")
    page.evaluate("() => { window.app.switchPage('recurring'); window.app.renderRecurringPage(); }")
    page.wait_for_selector('#recurringList .recurring-card', timeout=5000)
    text = page.inner_text('#recurringList .recurring-card')
    assert 'Reimbursement' in text and 'Reimbursement / Income' not in text
    assert page.query_selector('#recurringList .recurring-amount--pos')


@pytest.mark.feature
def test_add_income_template_via_form(app_page):
    page = app_page
    _seed(page, "[]")
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click('#recurringFormToggle')
    page.wait_for_selector('#recurringFormBody:not([hidden])', timeout=5000)
    page.fill('#recurringName', 'Side gig')
    page.select_option('#recurringType', 'income')
    page.fill('#recurringAmount', '250')
    page.fill('#recurringStartDate', '2026-01-01')
    page.select_option('#recurringAccount', '8800')
    page.click('#recurringFormSubmit')
    page.wait_for_selector('#recurringList .recurring-card', timeout=5000)
    t = page.evaluate("() => window.app.recurringTemplates[0]")
    assert t['type'] == 'income' and t['amount'] == 250


# --- Ledger / accounts -------------------------------------------------------

@pytest.mark.feature
def test_income_template_is_positive_ledger_inflow_and_raises_balance(app_page):
    page = app_page
    _seed(page, "[]")
    before = page.evaluate("""() => { const n = new Date(); return window.app.computeAccountBalance(8800, n.getFullYear(), n.getMonth()); }""")
    _seed(page, "[" + _tmpl(1, 'Retainer', 'income', 500) + "]")
    res = page.evaluate("""async () => {
        const n = new Date();
        const txs = await import('/src/ledgerTransactions.js').then(m => m.getLedgerTransactions(window.app));
        const t = txs.find(x => x.name === 'Retainer' && String(x.date).startsWith(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`));
        return { amount: t && t.amount, category: t && t.category,
                 bal: window.app.computeAccountBalance(8800, n.getFullYear(), n.getMonth()) };
    }""")
    assert res['amount'] == 500
    assert res['category'] == 'Other'  # explicit category respected
    assert res['bal'] == pytest.approx(before + 500)


@pytest.mark.feature
def test_income_default_category_is_income(app_page):
    page = app_page
    _seed(page, "[" + _tmpl(1, 'Retainer', 'income', 500).replace("category: 'Other'", "category: ''") + "]")
    cat = page.evaluate("""async () => {
        const txs = await import('/src/ledgerTransactions.js').then(m => m.getLedgerTransactions(window.app));
        return txs.find(x => x.name === 'Retainer').category;
    }""")
    assert cat == 'Income'


@pytest.mark.feature
def test_spending_report_excludes_income_template(app_page):
    page = app_page
    _seed(page, "[" + _tmpl(1, 'Retainer', 'income', 500) + "]")
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const n = new Date();
        return mod.computeSpendingByCategory(window.app, n.getFullYear(), n.getMonth());
    }""")
    assert result == []


# --- Health cash flow -------------------------------------------------------

@pytest.mark.feature
def test_health_net_increases_with_monthly_income_template(app_page):
    page = app_page
    _seed(page, "[]")
    base, _ = _health_net(page)
    _seed(page, "[" + _tmpl(1, 'Retainer', 'income', 500) + "]")
    net, _ = _health_net(page)
    assert net == pytest.approx(base + 500)
    assert 'Recurring income' in page.inner_text('#healthSection')


@pytest.mark.feature
def test_health_net_includes_reimbursement_inflow(app_page):
    page = app_page
    _seed(page, "[]")
    base, _ = _health_net(page)
    _seed(page, "[" + _tmpl(1, 'Refund', 'reimbursement', 80) + "]")
    net, _ = _health_net(page)
    assert net == pytest.approx(base + 80)


@pytest.mark.feature
def test_health_net_decreases_with_subscription(app_page):
    page = app_page
    _seed(page, "[]")
    base, _ = _health_net(page)
    _seed(page, "[" + _tmpl(1, 'Netflix', 'subscription', 15) + "]")
    net, _ = _health_net(page)
    assert net == pytest.approx(base - 15)


@pytest.mark.feature
def test_health_weekly_counts_each_occurrence(app_page):
    page = app_page
    _seed(page, "[]")
    base, _ = _health_net(page)
    _seed(page, "[" + _tmpl(1, 'Tutoring', 'income', 100, 'weekly') + "]")
    count = page.evaluate("""async () => {
        const m = await import('/src/recurring.js'); const n = new Date();
        return m.getRecurringOccurrencesInMonth(window.app.recurringTemplates[0], n.getFullYear(), n.getMonth()).length;
    }""")
    assert count in (4, 5)
    net, _ = _health_net(page)
    assert net == pytest.approx(base + 100 * count)


@pytest.mark.feature
@pytest.mark.parametrize('extra,ttype', [
    (", archived: true", 'income'),
    (", paused: true", 'income'),
    ("", 'transfer'),
])
def test_health_ignores_archived_paused_and_transfer(app_page, extra, ttype):
    page = app_page
    _seed(page, "[]")
    base, _ = _health_net(page)
    tmpl = _tmpl(1, 'Ignored', ttype, 700, extra=extra)
    if ttype == 'transfer':
        tmpl = tmpl.replace('targetAccountId: null', 'targetAccountId: 8801')
    _seed(page, "[" + tmpl + "]")
    net, _ = _health_net(page)
    assert net == pytest.approx(base)


@pytest.mark.feature
def test_dti_unchanged_by_recurring_income(app_page):
    """Negative: recurring income must not lower the DTI ratio (DTI stays on salary/bonus income)."""
    page = app_page
    incomes = "[{ id: 1, name: 'Salary', amount: 3000, firstPayDate: '2026-01-01', frequency: 'monthly', accountId: null }]"
    page.evaluate("""() => { window.app.debts = [{ id: 5, name: 'Loan', debtType: 'creditCard', accountBalance: 1000,
        originalBalance: 1000, interestRate: 10, minimumPayment: 300, dueDate: 15, creditLimit: null, archived: false }]; }""")
    _seed(page, "[]", incomes)
    page.evaluate("""() => { window.app.debts = [{ id: 5, name: 'Loan', debtType: 'creditCard', accountBalance: 1000,
        originalBalance: 1000, interestRate: 10, minimumPayment: 300, dueDate: 15, creditLimit: null, archived: false }]; }""")
    _health_net(page)
    dti_before = page.evaluate("() => document.getElementById('healthDtiGauge').closest('.health-metric-card').innerText")
    income_before = page.evaluate("""async () => { const n = new Date(); const u = await import('/src/utils.js');
        return u.computeMonthlyIncomeForMonth(window.app.incomes, window.app.bonuses, n.getFullYear(), n.getMonth()).monthlyTotal; }""")
    page.evaluate("() => { window.app.recurringTemplates = [" + _tmpl(1, 'Retainer', 'income', 5000) + "]; }")
    _health_net(page)
    dti_after = page.evaluate("() => document.getElementById('healthDtiGauge').closest('.health-metric-card').innerText")
    income_after = page.evaluate("""async () => { const n = new Date(); const u = await import('/src/utils.js');
        return u.computeMonthlyIncomeForMonth(window.app.incomes, window.app.bonuses, n.getFullYear(), n.getMonth()).monthlyTotal; }""")
    assert '%' in dti_before and income_before > 0
    assert income_before == income_after
    assert dti_before == dti_after


# --- Sanitizer / persistence --------------------------------------------------

@pytest.mark.feature
def test_sanitizer_keeps_income_and_rejects_unknown_type(app_page):
    page = app_page
    types = page.evaluate("""async () => {
        const m = await import('/src/sanitizers.js');
        const mk = (type) => m.sanitizeRecurringTemplate({ id: 1, name: 'x', type, amount: 5 }, 1).type;
        return { income: mk('income'), reimb: mk('reimbursement'), transfer: mk('transfer'), sub: mk('subscription'),
                 legacyMissing: mk(undefined), bogus: mk('refund'), xss: mk('<script>alert(1)</script>'), upper: mk('INCOME') };
    }""")
    assert types['income'] == 'income'
    assert types['reimb'] == 'reimbursement'
    assert types['transfer'] == 'transfer'
    assert types['sub'] == 'subscription'
    assert types['legacyMissing'] == 'subscription'
    assert types['bogus'] == 'subscription'
    assert types['xss'] == 'subscription'
    assert types['upper'] == 'subscription'


@pytest.mark.feature
def test_income_type_survives_storage_and_import_sanitize_round_trip(app_page):
    page = app_page
    _seed(page, "[" + _tmpl(1, 'Retainer', 'income', 500) + "," + _tmpl(2, 'Old refund', 'reimbursement', 20) + "]")
    page.evaluate("() => window.app.saveToStorage()")
    page.wait_for_function("() => (localStorage.getItem('debtTrackerData') || '').includes('Retainer')", timeout=5000)
    types = page.evaluate("""async () => {
        window.app.loadFromStorage();
        const m = await import('/src/sanitizers.js');
        const imported = m.sanitizeParsedState({ recurringTemplates: JSON.parse(JSON.stringify(window.app.recurringTemplates)) });
        return { loaded: window.app.recurringTemplates.map(t => t.type), imported: imported.recurringTemplates.map(t => t.type) };
    }""")
    assert types['loaded'] == ['income', 'reimbursement']
    assert types['imported'] == ['income', 'reimbursement']


# --- Calendar feed ------------------------------------------------------------

@pytest.mark.feature
def test_client_ics_labels_income_template(app_page):
    page = app_page
    _seed(page, "[" + _tmpl(1, 'Retainer', 'income', 500) + "," + _tmpl(2, 'Refund', 'reimbursement', 20) + "]")
    ics = page.evaluate("""async () => (await import('/src/calendarFeed.js')).generateIcs(window.app)""")
    assert 'SUMMARY:Income - Retainer' in ics
    assert 'SUMMARY:Reimbursement - Refund' in ics


# --- Zero-amount policy -------------------------------------------------------

@pytest.mark.feature
def test_zero_amount_policy_treats_income_like_other_types(app_page):
    """Default ('allow') policy accepts a $0 income template like subscription/reimbursement."""
    page = app_page
    _seed(page, "[]")
    page.evaluate("() => { window.app.setSetting && window.app.setSetting('zeroAmountPolicy', 'allow'); }")
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click('#recurringFormToggle')
    page.wait_for_selector('#recurringFormBody:not([hidden])', timeout=5000)
    page.fill('#recurringName', 'Zero income')
    page.select_option('#recurringType', 'income')
    page.fill('#recurringAmount', '0')
    page.fill('#recurringStartDate', '2026-01-01')
    page.select_option('#recurringAccount', '8800')
    page.click('#recurringFormSubmit')
    page.wait_for_selector('#recurringList .recurring-card', timeout=5000)
    assert page.evaluate("() => window.app.recurringTemplates[0].type") == 'income'
