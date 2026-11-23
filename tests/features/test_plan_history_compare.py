"""Plan History per-debt comparison (issue #312).

Each Calculate records per-debt results (payoff month, interest) on its Plan
History entry; any two entries can be compared debt by debt, with the change
marked by arrows and colour. Entries saved before #312 say they have no
per-debt data.
"""
import pytest

from tests.conftest import seed_state, wait_for_api

DEBTS = [
    {'id': 1, 'name': 'Visa', 'debtType': 'creditCard', 'accountBalance': 3000, 'originalBalance': 3000,
     'minimumPayment': 60, 'interestRate': 24, 'dueDate': 15},
    {'id': 2, 'name': 'Car Loan', 'debtType': 'creditCard', 'accountBalance': 6000, 'originalBalance': 6000,
     'minimumPayment': 150, 'interestRate': 6, 'dueDate': 20},
]


def _open_plan(page):
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)


def _calculate(page, payment):
    before = page.evaluate("() => (window.app.planHistory || []).length")
    page.fill('#monthlyPayment', payment)
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_function("(n) => (window.app.planHistory || []).length > n", arg=before, timeout=15000)


def _open_history(page):
    if page.get_attribute('#planHistoryToggle', 'aria-expanded') != 'true':
        page.click('#planHistoryToggle')


@pytest.mark.feature
def test_calculate_records_per_debt_results(app_page):
    page = app_page
    seed_state(page, {'debts': DEBTS})
    _open_plan(page)
    _calculate(page, '400')
    rows = wait_for_api(page, '/api/plan-history', lambda rows: len(rows) == 1 and len(rows[0].get('debts') or []) == 2)
    debts = {d['name']: d for d in rows[0]['debts']}
    assert set(debts) == {'Visa', 'Car Loan'}
    assert debts['Visa']['totalInterest'] > 0
    assert debts['Visa']['payoffDate'].endswith('-01')
    # One entry: nothing to compare yet.
    _open_history(page)
    assert page.locator('#planCompare').get_attribute('class').split().count('hidden') == 1


@pytest.mark.feature
def test_compare_two_plans_per_debt(app_page):
    page = app_page
    seed_state(page, {'debts': DEBTS})
    _open_plan(page)
    _calculate(page, '300')
    _calculate(page, '600')
    _open_history(page)
    page.wait_for_selector('#planCompareTable', timeout=5000)

    # Defaults: A = the previous plan, B = the latest.
    assert page.input_value('#planCompareA') == page.evaluate("() => String(window.app.planHistory[0].id)")
    assert page.input_value('#planCompareB') == page.evaluate("() => String(window.app.planHistory[1].id)")
    assert page.locator('#planCompareB option').first.inner_text().startswith('#2 ')

    rows = page.locator('#planCompareTable tbody tr')
    assert rows.count() == 2
    visa = page.locator('#planCompareTable tbody tr', has_text='Visa')
    # Paying more pays Visa off sooner and with less interest: both deltas are "better".
    payoff_delta, interest_delta = visa.locator('td.plan-delta').all()
    assert 'plan-delta--better' in payoff_delta.get_attribute('class')
    assert 'sooner' in payoff_delta.inner_text() and '↓' in payoff_delta.inner_text()
    assert 'plan-delta--better' in interest_delta.get_attribute('class')
    assert interest_delta.inner_text().endswith(' less')
    total = page.locator('#planCompareTable tfoot td.plan-delta')
    assert 'plan-delta--better' in total.get_attribute('class')

    # Swapping the plans flips the direction.
    a_val = page.input_value('#planCompareA')
    b_val = page.input_value('#planCompareB')
    page.select_option('#planCompareA', b_val)
    page.select_option('#planCompareB', a_val)
    visa = page.locator('#planCompareTable tbody tr', has_text='Visa')
    payoff_delta = visa.locator('td.plan-delta').first
    assert 'plan-delta--worse' in payoff_delta.get_attribute('class')
    assert 'later' in payoff_delta.inner_text() and '↑' in payoff_delta.inner_text()

    # The same plan on both sides asks for two different ones.
    page.select_option('#planCompareB', b_val)
    page.wait_for_selector('#planCompareSame', timeout=5000)
    assert page.locator('#planCompareTable').count() == 0


@pytest.mark.feature
def test_a_debt_in_only_one_plan_and_an_old_entry(app_page):
    page = app_page
    seed_state(page, {
        'debts': DEBTS,
        'planHistory': [
            {'id': 1, 'monthlyPayment': 300, 'strategy': 'avalanche', 'totalInterest': 2000, 'monthsToPayOff': 30,
             'totalDebt': 9000, 'createdAt': '2026-01-05T12:00:00.000Z'},
            {'id': 2, 'monthlyPayment': 350, 'strategy': 'snowball', 'totalInterest': 1500, 'monthsToPayOff': 28,
             'totalDebt': 9000, 'createdAt': '2026-02-05T12:00:00.000Z',
             'debts': [{'debtId': 1, 'name': 'Visa', 'payoffDate': '2027-01-01', 'totalInterest': 800},
                       {'debtId': 7, 'name': 'Old Card', 'payoffDate': None, 'totalInterest': 100}]},
            {'id': 3, 'monthlyPayment': 400, 'strategy': 'avalanche', 'totalInterest': 1200, 'monthsToPayOff': 24,
             'totalDebt': 9000, 'createdAt': '2026-03-05T12:00:00.000Z',
             'debts': [{'debtId': 1, 'name': 'Visa', 'payoffDate': '2027-01-01', 'totalInterest': 800}]},
        ],
    })
    _open_plan(page)
    _open_history(page)
    page.wait_for_selector('#planCompareTable', timeout=5000)
    # Import remaps the stored debt ids with the debts: Visa still matches; the
    # unknown Old Card id becomes null and matches by name.
    visa = page.locator('#planCompareTable tbody tr', has_text='Visa')
    assert visa.locator('td.plan-delta').first.inner_text().endswith('Same month')
    assert 'plan-delta--same' in visa.locator('td.plan-delta').first.get_attribute('class')
    old = page.locator('#planCompareTable tbody tr', has_text='Old Card')
    cells = old.locator('td').all_inner_texts()
    assert cells[0] == 'Not paid off' and cells[1] == 'Not in this plan', cells
    assert cells[2] == '—'

    # The oldest entry predates per-debt results.
    # Plan #1 is the oldest by createdAt (the page numbers entries that way).
    # Never take planHistory[0]: the seed import POSTs records concurrently, so
    # server ids, and the array order, are not the seeded order (CI flake).
    oldest = page.evaluate(
        "() => String([...window.app.planHistory]"
        ".sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0].id)"
    )
    page.select_option('#planCompareA', oldest)
    page.wait_for_selector('#planCompareNoData', timeout=5000)
    assert page.inner_text('#planCompareNoData').startswith('Plan #1 was saved before per-debt results were recorded')
