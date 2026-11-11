#!/usr/bin/env python3
"""
Partial plan-settings saves (issues #564, #521).

saveToStorage(app, fields) PATCHes only the named plan-settings fields, and
record mutations no longer PATCH /api/plan-settings at all. Before, every save
sent the whole row, so a stale tab or device reverted category budgets, the
home-purchase plan, the retirement target and the strategy set elsewhere.

Also covers two values that were never saved at all: schedule-table stimulus
amounts and awarded net-worth milestones.
"""

from datetime import date

import pytest

from tests.conftest import BASE_URL, ensure_session, seed_state, submit_account_form, wait_for_api, wait_for_app_ready
from tests.features.test_category_budgets import _open_panel, _seed, _set_fixed
from tests.features.test_strategy import _calculate, _create_two_debts


PLAN = '/api/plan-settings'


def _record_plan_patches(page):
    """Collect the JSON body of every PATCH /api/plan-settings this page sends."""
    bodies = []

    def on_request(req):
        if req.method == 'PATCH' and req.url.rstrip('/').endswith(PLAN):
            bodies.append(req.post_data_json)

    page.on('request', on_request)
    return bodies


def _open_second_tab(page):
    """A second signed-in tab (its own browser context, like a second device),
    loaded now, so it goes stale as soon as the first tab changes anything.
    Close it with `other.context.close()`."""
    context = page.context.browser.new_context()
    ensure_session(context)
    other = context.new_page()
    other.goto(BASE_URL)
    wait_for_app_ready(other)
    return other


def _ledger_state():
    today = date.today().isoformat()
    return {
        'version': '3.0',
        'accounts': [{'id': 1, 'name': 'Partial Save Checking', 'type': 'Checking', 'startingBalance': 1000}],
        'incomes': [{'id': 1, 'name': 'Partial Save Salary', 'amount': 2500,
                     'firstPayDate': today, 'frequency': 'monthly', 'accountId': 1}],
    }


# --- #564: a stale tab no longer overwrites other fields --------------------

@pytest.mark.feature
def test_stale_tab_strategy_save_keeps_budget_set_in_other_tab(app_page):
    """Acceptance (#564): tab A sets a category budget; stale tab B saves a
    strategy change; after a reload both persist."""
    page_a = app_page
    page_b = _open_second_tab(page_a)
    try:
        _seed(page_a)
        _open_panel(page_a)
        _set_fixed(page_a, 'Housing', 2000)
        wait_for_api(page_a, PLAN, lambda d: d.get('budgetCategories', {}).get('Housing', {}).get('amount') == 2000)

        # Tab B never saw the budget. Save a strategy change the way the Plan
        # page's Calculate does.
        assert page_b.evaluate("() => Object.keys(window.app.budgetCategories || {}).length") == 0
        page_b.evaluate("""() => {
            document.getElementById('monthlyPayment').value = '750';
            document.getElementById('paymentStrategy').value = 'snowball';
            return window.app.saveToStorage(['monthlyPayment', 'strategy']);
        }""")

        data = wait_for_api(page_a, PLAN, lambda d: d.get('strategy') == 'snowball')
        assert data['monthlyPayment'] == 750
        assert data['budgetCategories'].get('Housing') == {'mode': 'fixed', 'amount': 2000}, \
            'the stale tab must not wipe the budget set in the other tab'

        page_a.reload()
        assert page_a.evaluate("() => window.app.budgetCategories.Housing.amount") == 2000
        assert page_a.evaluate("() => window.app._savedStrategy") == 'snowball'
    finally:
        page_b.context.close()


@pytest.mark.feature
def test_stale_tab_record_mutation_leaves_plan_settings_alone(app_page):
    """A stale tab adding an account sends no plan-settings PATCH, so a
    retirement target and home plan saved in another tab survive."""
    page_a = app_page
    page_b = _open_second_tab(page_a)
    try:
        page_a.evaluate("""() => {
            window.app.retirementTargetDate = '2049-07-01';
            window.app.homePurchasePlan = { targetHomePrice: 400000, targetDownPaymentPct: 20,
                currentSavings: 0, monthlyContribution: 0, housingCostEstimate: 0, notes: '' };
            return window.app.saveToStorage(['retirementTargetDate', 'homePurchasePlan']);
        }""")
        wait_for_api(page_a, PLAN, lambda d: d.get('retirementTargetDate') == '2049-07-01')

        patches = _record_plan_patches(page_b)
        page_b.click('button[data-page="accounts"]')
        page_b.wait_for_selector('#accountsSection.active', timeout=5000)
        page_b.fill('#accountName', 'Stale Tab Account')
        page_b.select_option('#accountType', label='Checking')
        page_b.fill('#accountStartingBalance', '10')
        submit_account_form(page_b)

        page_b.wait_for_timeout(500)
        assert patches == [], f'adding an account must not PATCH plan settings, sent {patches!r}'
        data = wait_for_api(page_a, PLAN, lambda d: True)
        assert data['retirementTargetDate'] == '2049-07-01'
        assert (data['homePurchasePlan'] or {}).get('targetHomePrice') == 400000
    finally:
        page_b.context.close()


# --- #521: record mutations send no plan-settings PATCH ----------------------

@pytest.mark.feature
def test_record_mutations_send_no_plan_settings_patch(app_page):
    """Acceptance (#521): adding an account, editing a debt and toggling a
    Ledger Cleared checkbox send no PATCH /api/plan-settings."""
    page = app_page
    seed_state(page, _ledger_state())
    patches = _record_plan_patches(page)

    # Add an account.
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'No Patch Account')
    page.select_option('#accountType', label='Savings')
    page.fill('#accountStartingBalance', '25')
    submit_account_form(page)

    # Toggle Cleared on a Ledger row.
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    checkbox = page.wait_for_selector('[data-ledger-cleared]', timeout=10000)
    tx_id = checkbox.get_attribute('data-ledger-cleared')
    checkbox.click()
    wait_for_api(page, '/api/ledger-cleared', lambda d: tx_id in str(d))

    # Edit a debt (the same code path as the inline editor's Save).
    page.evaluate("""async () => {
        const app = window.app;
        app.debts.push({ id: Date.now(), name: 'No Patch Debt', debtType: 'creditCard',
            accountBalance: 900, interestRate: 10, minimumPayment: 30 });
        const debt = app.debts[app.debts.length - 1];
        const { pgPost } = await import('/src/postgresSync.js');
        const saved = await pgPost(app, '/api/debts', debt);
        if (saved?.id) debt.id = saved.id;
        await app.updateDebtBalance(debt.id, 850, 30);
    }""")
    wait_for_api(page, '/api/debts', lambda rows: any(r['accountBalance'] == 850 for r in rows))

    page.wait_for_timeout(500)
    assert patches == [], f'record mutations must not PATCH plan settings, sent {patches!r}'


# --- Plan-settings changes send only their own field ------------------------

@pytest.mark.feature
def test_budget_save_sends_only_budget_categories(app_page):
    """A category-budget save PATCHes budgetCategories alone, and a payment
    typed into the Plan form but never calculated is not sent with it."""
    page = app_page
    _seed(page)
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.fill('#monthlyPayment', '999')  # typed, not calculated

    patches = _record_plan_patches(page)
    _open_panel(page)
    _set_fixed(page, 'Food', 300)
    wait_for_api(page, PLAN, lambda d: d.get('budgetCategories', {}).get('Food', {}).get('amount') == 300)

    assert patches, 'the budget save should PATCH plan settings'
    assert all(set(b) == {'budgetCategories'} for b in patches), patches
    assert wait_for_api(page, PLAN, lambda d: True).get('monthlyPayment') != 999


@pytest.mark.feature
def test_ledger_sort_is_saved_to_server(app_page):
    """Ledger view settings reach the server on an explicit change, now that
    record saves no longer carry them along."""
    page = app_page
    seed_state(page, _ledger_state())
    patches = _record_plan_patches(page)
    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.click('#ledgerSection th[data-key="amount"]')

    data = wait_for_api(page, PLAN, lambda d: (d.get('ledgerSettings') or {}).get('sortKey') == 'amount')
    assert data['ledgerSettings']['sortDir'] == 'desc'
    assert all(set(b) == {'ledgerSettings'} for b in patches), patches


# --- Values that were never saved before ------------------------------------

@pytest.mark.feature
def test_schedule_stimulus_persists_across_reload(app_page):
    """A stimulus typed into the payment schedule is saved and reloaded
    (saveToStorage never sent perMonthStimulus before)."""
    page = app_page
    _create_two_debts(page)
    _calculate(page, 'avalanche')
    page.click('[data-rtab="schedule"]')
    page.wait_for_selector('#rPanel-schedule', timeout=5000)
    page.click('button[data-tab="tabular"]')
    page.wait_for_selector('button[data-tab="tabular"].active', timeout=5000)

    page.fill('#stimulus-input-0', '300')
    page.dispatch_event('#stimulus-input-0', 'change')

    data = wait_for_api(page, PLAN, lambda d: (d.get('perMonthStimulus') or [None])[0] == 300)
    assert data['strategy'] == 'avalanche'  # the earlier Calculate save is untouched
    page.reload()
    assert page.evaluate("() => window.app.perMonthStimulus[0]") == 300


@pytest.mark.feature
def test_net_worth_milestone_award_persists(app_page):
    """An awarded milestone is POSTed to the milestones table and survives a
    reload (the old saveToStorage call never sent milestones)."""
    page = app_page
    first = date.today().replace(day=1)
    earlier = first.replace(year=first.year - 1) if first.month <= 2 else first.replace(month=first.month - 2)
    seed_state(page, {
        'version': '3.0',
        'accounts': [{'id': 1, 'name': 'Milestone Savings', 'type': 'Savings', 'startingBalance': 0}],
        'monthlySnapshots': [{'date': earlier.isoformat(), 'totalAssets': 0, 'totalLiabilities': 0,
                              'netWorth': 0, 'debtPaymentMade': 0, 'incomeReceived': 0, 'source': 'manual'}],
    })
    page.evaluate("""() => {
        // In memory only, so no balance history exists for it to override.
        window.app.accounts.push({ id: 99, name: 'Windfall', type: 'Savings', startingBalance: 6000 });
        window.app.captureNetWorthSnapshot({ source: 'manual', silent: true });
    }""")
    assert page.evaluate("() => window.app.netWorthMilestonesAwarded") == [5000]
    wait_for_api(page, PLAN, lambda d: 5000 in (d.get('netWorthMilestonesAwarded') or []))
    page.reload()
    assert 5000 in page.evaluate("() => window.app.netWorthMilestonesAwarded")


# --- Negative cases ---------------------------------------------------------

@pytest.mark.feature
def test_save_without_known_fields_sends_nothing(app_page):
    """saveToStorage() with no field, or only unknown ones, sends no request:
    a forgotten argument must never fall back to writing the whole row."""
    page = app_page
    patches = _record_plan_patches(page)
    results = page.evaluate("""async () => [
        await window.app.saveToStorage(),
        await window.app.saveToStorage([]),
        await window.app.saveToStorage(['notAField', '__proto__'])
    ]""")
    page.wait_for_timeout(300)
    assert results == [True, True, True]
    assert patches == []
