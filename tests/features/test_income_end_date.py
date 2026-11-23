"""Income end date (issue #679).

An income keeps its past paydays (and their Ledger override/Cleared keys) once
it ends; it has no paydays after its end date, drops out of this month's totals,
and hides behind a persisted "Show ended" toggle on the Income page.
"""
from datetime import date, timedelta

import pytest

from tests.conftest import expect_alert_and_dismiss, seed_state, wait_for_api


def _shift_months(d, months, day):
    y, m = divmod(d.year * 12 + (d.month - 1) + months, 12)
    return date(y, m + 1, day)


TODAY = date.today()
FIRST = _shift_months(TODAY, -6, 10)          # first payday, six months ago
LAST = _shift_months(TODAY, -2, 10)           # end date: a payday two months ago
PAST = _shift_months(TODAY, -4, 10)           # a payday inside the paid window
AFTER = _shift_months(TODAY, -1, 10)          # a payday that would follow the end

ACCOUNT_ID = 701
ENDED_ID = 702
ACTIVE_ID = 703
PAST_KEY = f'income|{ENDED_ID}|{ACCOUNT_ID}|{PAST.isoformat()}'


def _state(**extra):
    state = {
        'accounts': [{'id': ACCOUNT_ID, 'name': 'Paycheck Checking', 'type': 'Checking', 'startingBalance': 1000}],
        'incomes': [
            {'id': ENDED_ID, 'name': 'Old Contract', 'amount': 1000, 'firstPayDate': FIRST.isoformat(),
             'endDate': LAST.isoformat(), 'frequency': 'monthly', 'accountId': ACCOUNT_ID, 'category': 'Freelance'},
            {'id': ACTIVE_ID, 'name': 'Day Job', 'amount': 3000, 'firstPayDate': FIRST.isoformat(),
             'frequency': 'monthly', 'accountId': ACCOUNT_ID, 'category': 'Salary'},
        ],
        'ledgerAmountOverrides': {PAST_KEY: {'amount': 950, 'originalAmount': 1000}},
        'ledgerClearedTransactions': {PAST_KEY: {'clearedAt': f'{PAST.isoformat()}T00:00:00.000Z'}},
    }
    state.update(extra)
    return state


def _open_income(page):
    page.click('button[data-page="income"]')
    page.wait_for_selector('#incomeSection.active', timeout=5000)


def _income_id(page, name):
    return page.evaluate("(n) => window.app.incomes.find(i => i.name === n)?.id", name)


def _paydays(page, name, d):
    """The Ledger rows for one income (by name; seeding remaps ids) in d's
    month: [(isoDate, amount, cleared)]."""
    return page.evaluate("""async ([name, y, m]) => {
        const { getLedgerTransactionsForMonth } = await import('/src/projectionCore.js');
        const id = window.app.incomes.find(i => i.name === name).id;
        return getLedgerTransactionsForMonth(window.app, y, m)
            .filter(tx => tx.type === 'income' && tx.sourceId === id)
            .map(tx => [tx.transactionId.split('|')[3], tx.amount, tx.cleared]);
    }""", [name, d.year, d.month - 1])


@pytest.mark.feature
def test_ended_income_keeps_past_paydays_and_keys_but_none_after(app_page):
    page = app_page
    seed_state(page, _state())
    # The override and Cleared mark on a payday before the end still apply.
    assert _paydays(page, 'Old Contract', PAST) == [[PAST.isoformat(), 950, True]]
    # The end date is inclusive.
    assert _paydays(page, 'Old Contract', LAST) == [[LAST.isoformat(), 1000, False]]
    # Nothing after it, while the other income keeps paying.
    assert _paydays(page, 'Old Contract', AFTER) == []
    assert _paydays(page, 'Old Contract', TODAY) == []
    assert len(_paydays(page, 'Day Job', AFTER)) == 1


@pytest.mark.feature
def test_ended_income_excluded_from_current_month_totals(app_page):
    page = app_page
    seed_state(page, _state())
    totals = page.evaluate("""async () => {
        const { computeMonthlyIncomeForMonth } = await import('/src/utils.js');
        const now = new Date();
        return computeMonthlyIncomeForMonth(window.app.incomes, window.app.bonuses, now.getFullYear(), now.getMonth()).monthlyTotal;
    }""")
    assert totals == 3000, f'only the active income counts this month, got {totals}'
    _open_income(page)
    page.wait_for_selector('#incomeSummary.visible', timeout=5000)
    sources = page.locator('#incomeSummary .income-summary-item').nth(2).locator('.income-summary-value').inner_text()
    assert sources.strip() == '1', f'source count should leave out the ended income, got {sources!r}'


@pytest.mark.feature
def test_ended_income_hidden_until_show_ended(app_page):
    page = app_page
    seed_state(page, _state())
    _open_income(page)
    page.wait_for_selector('#incomeList >> text=Day Job', timeout=5000)
    ended_id = _income_id(page, 'Old Contract')
    assert page.locator(f'#income-card-{ended_id}').count() == 0, 'ended income should be hidden by default'

    toggle = page.locator('#incomeToggleEnded')
    assert toggle.inner_text().strip() == 'Show 1 ended'
    assert toggle.get_attribute('aria-pressed') == 'false'
    toggle.click()

    card = page.locator(f'#income-card-{ended_id}')
    card.wait_for(state='visible', timeout=5000)
    assert 'income-card--ended' in (card.get_attribute('class') or '')
    end_text = card.locator('.income-card-end').inner_text()
    assert end_text.startswith('Ended '), end_text
    assert card.locator('.income-upcoming-chip').count() == 0, 'an ended income has no upcoming paydays'
    assert page.locator('#incomeToggleEnded').get_attribute('aria-pressed') == 'true'
    assert page.locator('#incomeToggleEnded').inner_text().strip() == 'Hide ended'

    # The choice is a saved setting, so it survives a reload.
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r.get('key') == 'showEndedIncomes' and r.get('value') is True for r in rows))
    page.reload()
    _open_income(page)
    page.locator(f'#income-card-{ended_id}').wait_for(state='visible', timeout=5000)


@pytest.mark.feature
def test_no_toggle_without_ended_incomes(app_page):
    page = app_page
    state = _state()
    state['incomes'] = [state['incomes'][1]]
    seed_state(page, state)
    _open_income(page)
    page.wait_for_selector('#incomeList >> text=Day Job', timeout=5000)
    assert page.locator('#incomeToggleEnded').count() == 0
    assert page.locator('.income-card-end').count() == 0, 'no end date, no end line'


@pytest.mark.feature
def test_add_income_with_future_end_date_shows_ends(app_page):
    page = app_page
    seed_state(page, {'accounts': _state()['accounts']})
    _open_income(page)
    end = TODAY + timedelta(days=90)
    page.fill('#incomeName', 'Short Contract')
    page.fill('#incomeAmount', '1500')
    page.fill('#incomeFirstDate', TODAY.isoformat())
    page.fill('#incomeEndDate', end.isoformat())
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector('#incomeList >> text=Short Contract', timeout=10000)

    rows = wait_for_api(page, '/api/incomes',
                        lambda rows: any(r.get('name') == 'Short Contract' and r.get('endDate') == end.isoformat() for r in rows))
    assert rows
    end_text = page.locator('#incomeList .income-card-end').inner_text()
    assert end_text.startswith('Ends '), end_text
    assert page.locator('#incomeToggleEnded').count() == 0, 'a future end date has not ended yet'
    assert page.input_value('#incomeEndDate') == '', 'the form resets after a save'


@pytest.mark.feature
def test_add_income_end_before_first_pay_date_rejected(app_page):
    page = app_page
    seed_state(page, {'accounts': _state()['accounts']})
    _open_income(page)
    page.fill('#incomeName', 'Backwards Income')
    page.fill('#incomeAmount', '1500')
    page.fill('#incomeFirstDate', '2026-05-10')
    page.fill('#incomeEndDate', '2026-05-09')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')  # submit-no-wait: validation rejects the end date, so no save runs
    expect_alert_and_dismiss(page, 'The end date must be on or after the first pay date.')
    wait_for_api(page, '/api/incomes', lambda rows: not any(r.get('name') == 'Backwards Income' for r in rows))
    assert page.locator('#incomeList >> text=Backwards Income').count() == 0


@pytest.mark.feature
def test_edit_income_sets_and_clears_end_date(app_page):
    page = app_page
    state = _state()
    state['incomes'] = [state['incomes'][1]]
    seed_state(page, state)
    _open_income(page)
    active_id = _income_id(page, 'Day Job')
    page.click(f'[data-income-action="edit"][data-income-id="{active_id}"]')
    end_input = page.locator(f'#ie-end-{active_id}')
    end_input.wait_for(state='visible', timeout=5000)
    assert end_input.input_value() == ''

    # Before the first pay date: rejected, nothing saved, still editing.
    end_input.fill((FIRST - timedelta(days=1)).isoformat())
    page.click(f'[data-income-action="save"][data-income-id="{active_id}"]')
    expect_alert_and_dismiss(page, 'The end date must be on or after the first pay date.')
    assert page.evaluate("(id) => window.app.incomes.find(i => i.id === id).endDate ?? null", active_id) is None

    # A past end date: saved, and the card stays visible after the save
    # only once "Show ended" is on (it is hidden by default).
    end_input.fill(LAST.isoformat())
    page.click(f'[data-income-action="save"][data-income-id="{active_id}"]')
    wait_for_api(page, '/api/incomes',
                 lambda rows: any(r.get('id') == active_id and r.get('endDate') == LAST.isoformat() for r in rows))
    page.wait_for_selector('#incomeToggleEnded', timeout=5000)
    assert page.locator(f'#income-card-{active_id}').count() == 0

    # Show it, edit again and clear the end date: it is active again.
    page.click('#incomeToggleEnded')
    page.click(f'[data-income-action="edit"][data-income-id="{active_id}"]')
    end_input = page.locator(f'#ie-end-{active_id}')
    assert end_input.input_value() == LAST.isoformat()
    end_input.fill('')
    page.click(f'[data-income-action="save"][data-income-id="{active_id}"]')
    wait_for_api(page, '/api/incomes',
                 lambda rows: any(r.get('id') == active_id and r.get('endDate') is None for r in rows))
    assert page.locator('#incomeToggleEnded').count() == 0
    assert len(_paydays(page, 'Day Job', TODAY)) == 1
