"""Recurring annual bonuses (issue #290).

An annual bonus lands on its date's month and day every year, optionally until
an end date. Covers the add form and inline edit, persistence, the Income-page
badge and next date, the Ledger / account balance / Forecast in future years,
the one-time negative cases, the until date, and export then import.
"""
import json

import pytest

from tests.conftest import seed_state, wait_for_api

pytestmark = pytest.mark.feature

ACCOUNT = 'Bonus Checking'


def _year(page):
    return page.evaluate("() => new Date().getFullYear()")


def _seed(page, bonuses=None):
    """Replace server data with one account (and optional bonuses); return (year, account id)."""
    year = _year(page)
    state = {'accounts': [{'id': 1, 'name': ACCOUNT, 'type': 'Checking', 'startingBalance': 1000}]}
    if bonuses:
        state['bonuses'] = [{'id': 1, 'category': 'Bonus', 'accountId': 1, **b} for b in bonuses]
    seed_state(page, state)
    acct = page.evaluate(f"() => window.app.accounts.find(a => a.name === '{ACCOUNT}').id")
    return year, acct


def _annual(year, **extra):
    return {'name': 'Year-end', 'amount': 5000, 'date': f'{year}-12-15', 'recurringAnnually': True, **extra}


def _open_bonus_form(page):
    page.click('[data-page="income"]')
    page.click('#bonusFormToggle')
    page.wait_for_selector('#bonusFormBody:not([hidden])')


def _fill_bonus(page, name, amount, date, *, annual=False, until=None):
    page.fill('#bonusName', name)
    page.fill('#bonusAmount', str(amount))
    page.fill('#bonusDate', date)
    page.select_option('#bonusAccount', str(page.evaluate(
        f"() => window.app.accounts.find(a => a.name === '{ACCOUNT}').id")))
    if annual:
        page.check('#bonusRecurring')
    if until:
        page.fill('#bonusUntil', until)


def _submit_bonus(page, name):
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_selector(f'#bonusList .bonus-card:has-text("{name}")')


def _december_bonus_legs(page, year):
    """The Ledger's bonus legs for December of `year`, as [[y, m, d, amount, transactionId]]."""
    return page.evaluate("""async (year) => {
        const mod = await import('/src/ledgerTransactions.js');
        return mod.getLedgerTransactionsForMonth(window.app, year, 11)
            .filter(tx => tx.type === 'bonus')
            .map(tx => { const d = new Date(tx.date); return [d.getFullYear(), d.getMonth(), d.getDate(), tx.amount, tx.transactionId]; });
    }""", year)


def test_add_annual_bonus_persists_and_shows_badge_and_next_date(app_page):
    page = app_page
    year, _ = _seed(page)
    _open_bonus_form(page)
    # The Until field only shows while "Repeats every year" is checked.
    assert page.locator('#bonusUntilGroup').is_hidden()
    page.check('#bonusRecurring')
    assert page.locator('#bonusUntilGroup').is_visible()
    page.uncheck('#bonusRecurring')
    assert page.locator('#bonusUntilGroup').is_hidden()

    _fill_bonus(page, 'Year-end', 5000, f'{year}-12-15', annual=True)
    _submit_bonus(page, 'Year-end')

    card = page.locator('#bonusList .bonus-card', has_text='Year-end')
    assert card.locator('[data-bonus-recur-badge]').count() == 1
    assert 'Every year' in card.locator('[data-bonus-recur-badge]').inner_text()
    assert 'Next:' in card.inner_text()
    # The form reset hides the Until field again.
    assert page.locator('#bonusUntilGroup').is_hidden()
    assert not page.is_checked('#bonusRecurring')

    saved = wait_for_api(page, '/api/bonuses', lambda rows: len(rows) == 1)[0]
    assert saved['recurringAnnually'] is True
    assert saved['recurUntil'] is None

    page.reload()
    page.click('[data-page="income"]')
    page.wait_for_selector('#bonusList .bonus-card:has-text("Year-end")')
    card = page.locator('#bonusList .bonus-card', has_text='Year-end')
    assert card.locator('[data-bonus-recur-badge]').count() == 1
    assert page.evaluate("() => window.app.bonuses[0].recurringAnnually") is True


def test_annual_bonus_appears_in_ledger_balance_and_forecast_in_future_years(app_page):
    page = app_page
    year, acct = _seed(page, [_annual(page.evaluate("() => new Date().getFullYear()"))])
    # Seeded bonus runs in the current year and every year after.
    ids = set()
    for y in (year, year + 1, year + 2):
        legs = _december_bonus_legs(page, y)
        assert [leg[:4] for leg in legs] == [[y, 11, 15, 5000]], f'December {y}'
        ids.add(legs[0][4])
    assert len(ids) == 3, 'each year has its own ledger key'
    # Not in any other month of the following year.
    assert page.evaluate("""async (year) => {
        const mod = await import('/src/ledgerTransactions.js');
        let n = 0;
        for (let m = 0; m < 11; m++) n += mod.getLedgerTransactionsForMonth(window.app, year, m).filter(t => t.type === 'bonus').length;
        return n;
    }""", year + 1) == 0

    # Account projection: December next year rises by exactly the bonus.
    delta = page.evaluate(f"""() => window.app.computeAccountBalance({acct}, {year + 1}, 11)
        - window.app.computeAccountBalance({acct}, {year + 1}, 10)""")
    assert delta == pytest.approx(5000)

    # Forecast: next December's income includes it.
    income = page.evaluate(f"""async () => {{
        const mod = await import('/src/forecast.js');
        const series = mod.computeForecastSeries(window.app, 'total', 36);
        return series.find(s => s.year === {year + 1} && s.month === 11).income;
    }}""")
    assert income == pytest.approx(5000)

    # A different amount in one year is a Ledger override of that year only.
    key = page.evaluate(f"async () => {{ const mod = await import('/src/ledgerTransactions.js'); return mod.getLedgerTransactionsForMonth(window.app, {year + 1}, 11).find(t => t.type === 'bonus').transactionId; }}")
    page.evaluate("(key) => { window.app.ledgerAmountOverrides[key] = { amount: 6000 }; }", key)
    assert _december_bonus_legs(page, year + 1)[0][3] == 6000
    assert _december_bonus_legs(page, year + 2)[0][3] == 5000


def test_one_time_bonus_does_not_repeat(app_page):
    page = app_page
    year, _ = _seed(page)
    _open_bonus_form(page)
    _fill_bonus(page, 'Refund', 700, f'{year}-12-15')
    _submit_bonus(page, 'Refund')

    saved = wait_for_api(page, '/api/bonuses', lambda rows: len(rows) == 1)[0]
    assert saved['recurringAnnually'] is False
    card = page.locator('#bonusList .bonus-card', has_text='Refund')
    assert card.locator('[data-bonus-recur-badge]').count() == 0
    assert 'Next:' not in card.inner_text()

    assert [leg[:4] for leg in _december_bonus_legs(page, year)] == [[year, 11, 15, 700]]
    assert _december_bonus_legs(page, year + 1) == []
    assert _december_bonus_legs(page, year + 2) == []


def test_until_date_stops_the_series_and_shows_in_the_badge(app_page):
    page = app_page
    year, _ = _seed(page)
    _open_bonus_form(page)
    _fill_bonus(page, 'Limited', 900, f'{year}-12-15', annual=True, until=f'{year + 1}-12-15')
    _submit_bonus(page, 'Limited')

    card = page.locator('#bonusList .bonus-card', has_text='Limited')
    assert 'until' in card.locator('[data-bonus-recur-badge]').inner_text().lower()
    saved = wait_for_api(page, '/api/bonuses', lambda rows: len(rows) == 1)[0]
    assert saved['recurUntil'] == f'{year + 1}-12-15'

    assert len(_december_bonus_legs(page, year)) == 1
    assert len(_december_bonus_legs(page, year + 1)) == 1, 'the until date is inclusive'
    assert _december_bonus_legs(page, year + 2) == []
    assert _december_bonus_legs(page, year + 10) == []


def test_until_before_the_date_is_rejected(app_page):
    page = app_page
    year, _ = _seed(page)
    _open_bonus_form(page)
    _fill_bonus(page, 'Backwards', 900, f'{year}-12-15', annual=True, until=f'{year}-06-01')
    page.click('#bonusForm button[type="submit"]')  # submit-no-wait: validation rejects it
    page.wait_for_selector('#alertModalOkBtn', state='visible')
    page.click('#alertModalOkBtn')
    assert page.evaluate("() => window.app.bonuses.length") == 0
    assert wait_for_api(page, '/api/bonuses', lambda rows: rows == []) == []


def test_editing_an_annual_bonus_back_to_one_time_removes_future_occurrences(app_page):
    page = app_page
    year, _ = _seed(page, [_annual(page.evaluate("() => new Date().getFullYear()"), recurUntil=None)])
    assert len(_december_bonus_legs(page, year + 3)) == 1

    page.click('[data-page="income"]')
    page.wait_for_selector('#bonusList [data-bonus-action="edit"]')
    page.click('#bonusList [data-bonus-action="edit"]')
    bonus_id = page.evaluate("() => window.app.bonuses[0].id")
    # Inline editor: the Until field follows the checkbox.
    assert page.is_checked(f'#be-recurring-{bonus_id}')
    assert page.locator(f'#be-until-{bonus_id}').is_hidden() is False
    page.uncheck(f'#be-recurring-{bonus_id}')
    assert page.locator(f'#be-until-{bonus_id}').is_hidden()
    page.click('#bonusList [data-bonus-action="save"]')

    wait_for_api(page, '/api/bonuses', lambda rows: rows[0]['recurringAnnually'] is False)
    assert page.locator('#bonusList .bonus-card [data-bonus-recur-badge]').count() == 0
    assert len(_december_bonus_legs(page, year)) == 1
    assert _december_bonus_legs(page, year + 1) == []
    assert _december_bonus_legs(page, year + 3) == []


def test_editing_can_make_a_one_time_bonus_annual_with_an_end_date(app_page):
    page = app_page
    year, _ = _seed(page, [{'name': 'Refund', 'amount': 300, 'date': f'{_year(page)}-12-15'}])
    assert _december_bonus_legs(page, year + 1) == []

    page.click('[data-page="income"]')
    page.wait_for_selector('#bonusList [data-bonus-action="edit"]')
    page.click('#bonusList [data-bonus-action="edit"]')
    bonus_id = page.evaluate("() => window.app.bonuses[0].id")
    assert page.locator(f'#be-until-{bonus_id}').is_hidden()
    page.check(f'#be-recurring-{bonus_id}')
    page.fill(f'#be-until-{bonus_id}', f'{year + 1}-12-15')
    page.click('#bonusList [data-bonus-action="save"]')

    row = wait_for_api(page, '/api/bonuses', lambda rows: rows[0]['recurringAnnually'] is True)[0]
    assert row['recurUntil'] == f'{year + 1}-12-15'
    assert len(_december_bonus_legs(page, year + 1)) == 1
    assert _december_bonus_legs(page, year + 2) == []


def test_export_and_import_round_trip_the_recurrence_fields(app_page):
    page = app_page
    year, _ = _seed(page, [
        _annual(_year(page), recurUntil=f'{_year(page) + 4}-12-15'),
        {'id': 2, 'name': 'One off', 'amount': 50, 'date': f'{_year(page)}-03-01'},
    ])
    with page.expect_download() as dl:
        page.evaluate("async () => (await import('/src/dataExport.js')).exportAllJSON(window.app)")
    with open(dl.value.path(), encoding='utf-8') as fh:
        state = json.load(fh)
    exported = {b['name']: b for b in state['bonuses']}
    assert exported['Year-end']['recurringAnnually'] is True
    assert exported['Year-end']['recurUntil'] == f'{year + 4}-12-15'
    assert exported['One off']['recurringAnnually'] is False
    assert exported['One off']['recurUntil'] is None

    seed_state(page, state)
    rows = {b['name']: b for b in wait_for_api(page, '/api/bonuses', lambda r: len(r) == 2)}
    assert rows['Year-end']['recurringAnnually'] is True
    assert rows['Year-end']['recurUntil'] == f'{year + 4}-12-15'
    assert rows['One off']['recurringAnnually'] is False
    assert len(_december_bonus_legs(page, year + 4)) == 1
    assert _december_bonus_legs(page, year + 5) == []
