"""Sinking fund target date (#680): the goal date is stored, the monthly amount
it needs is recomputed from what is left and the months remaining, and the card
shows the deadline, the live amount and a status."""
import datetime

import pytest

from tests.conftest import seed_state, wait_for_api, wait_for_app_ready

pytestmark = pytest.mark.feature


def _month_start(offset):
    """First day of the month `offset` months from now (so months-left is exactly `offset`)."""
    today = datetime.date.today()
    index = today.year * 12 + (today.month - 1) + offset
    return datetime.date(index // 12, index % 12 + 1, 1).isoformat()


def _fund(**extra):
    fund = {'id': 1, 'name': 'House', 'allocationMethod': 'target_date', 'monthlyAllocation': 200,
            'targetAmount': 1200, 'currentAmount': 0, 'accountId': 10, 'autoContribute': False,
            'targetDate': _month_start(6)}
    fund.update(extra)
    return fund


def _state(*funds):
    return {
        'accounts': [{'id': 10, 'name': 'Savings', 'type': 'Savings', 'startingBalance': 5000}],
        'sinkingFunds': list(funds),
    }


def _open_sinking(page, state):
    seed_state(page, state)
    wait_for_app_ready(page)
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active')
    page.click('[data-savings-subtab="sinking"]')
    page.wait_for_selector('#sinkingList')


def _card_status(page):
    return page.get_attribute('.sinking-card [data-sinking-status]', 'data-sinking-status')


def _required(page):
    return page.text_content('.sinking-card [data-required-monthly]').strip()


def _add_target_date_fund(page, target_date, amount='1200', current='0'):
    page.click('#sinkingFormToggle')
    page.fill('#sinkingName', 'House')
    page.select_option('#sinkingAllocationMethod', 'target_date')
    page.fill('#sinkingTargetAmount', amount)
    if target_date:
        page.fill('#sinkingTargetDate', target_date)
    page.fill('#sinkingCurrentAmount', current)
    page.select_option('#sinkingAccount', index=1)
    page.click('#sinkingFormSubmit')


def test_add_shows_deadline_required_amount_and_status(app_page):
    page = app_page
    _open_sinking(page, _state())
    _add_target_date_fund(page, _month_start(6))
    page.wait_for_selector('.sinking-card')
    assert _required(page) == '$200.00'
    assert _card_status(page) == 'onTrack'
    assert 'On track' in page.text_content('.sinking-status')
    card_text = page.text_content('.sinking-card')
    assert str(datetime.date.fromisoformat(_month_start(6)).year) in card_text
    rows = wait_for_api(page, '/api/sinking-funds', lambda r: len(r) == 1)
    assert rows[0]['targetDate'] == _month_start(6)
    assert rows[0]['monthlyAllocation'] == 200


def test_contributing_lowers_the_required_amount_and_survives_reload(app_page):
    page = app_page
    _open_sinking(page, _state(_fund()))
    assert _required(page) == '$200.00'
    page.click('[data-sinking-action="contribute"]')
    page.wait_for_selector('#contributeModal:not(.hidden)')
    page.fill('#contributeAmountInput', '600')
    page.click('#contributeConfirmBtn')
    page.wait_for_selector('#contributeModal', state='hidden')
    assert _required(page) == '$100.00'
    assert _card_status(page) == 'ahead'
    wait_for_api(page, '/api/sinking-funds', lambda r: r[0]['currentAmount'] == 600)
    page.reload()
    page.click('button[data-page="savings"]')
    page.click('[data-savings-subtab="sinking"]')
    page.wait_for_selector('.sinking-card')
    assert _required(page) == '$100.00'


def test_behind_when_the_need_has_grown(app_page):
    page = app_page
    # Saved at $100/month, but 6 months and $1200 are left: $200 a month is needed.
    _open_sinking(page, _state(_fund(monthlyAllocation=100)))
    assert _card_status(page) == 'behind'
    assert _required(page) == '$200.00'


def test_editing_the_date_recalculates_and_persists(app_page):
    page = app_page
    _open_sinking(page, _state(_fund()))
    page.click('[data-sinking-action="edit"]')
    assert page.input_value('#sinkingTargetDate') == _month_start(6)
    page.fill('#sinkingTargetDate', _month_start(12))
    page.click('#sinkingFormSubmit')
    page.wait_for_function("() => document.querySelector('.sinking-card [data-required-monthly]')?.textContent.trim() === '$100.00'")
    assert page.locator('.sinking-card').count() == 1
    rows = wait_for_api(page, '/api/sinking-funds',
                        lambda r: len(r) == 1 and r[0]['targetDate'] == _month_start(12))
    assert rows[0]['monthlyAllocation'] == 100
    page.reload()
    page.click('button[data-page="savings"]')
    page.click('[data-savings-subtab="sinking"]')
    page.wait_for_selector('.sinking-card')
    assert _required(page) == '$100.00'
    assert page.locator('.sinking-card').count() == 1


def test_past_due_unfunded_goal_is_flagged(app_page):
    page = app_page
    past = (datetime.date.today() - datetime.timedelta(days=40)).isoformat()
    _open_sinking(page, _state(_fund(targetDate=past, currentAmount=200)))
    assert _card_status(page) == 'pastDue'
    assert 'Past due' in page.text_content('.sinking-status')
    assert page.locator('.sinking-card.sinking-card--pastdue').count() == 1
    assert '$1,000.00' in page.text_content('.sinking-pastdue-note')


def test_funded_goal_is_not_flagged_past_due(app_page):
    page = app_page
    past = (datetime.date.today() - datetime.timedelta(days=40)).isoformat()
    _open_sinking(page, _state(_fund(targetDate=past, currentAmount=1200)))
    assert _card_status(page) == 'funded'
    assert page.locator('.sinking-pastdue-note').count() == 0


def test_missing_date_is_rejected(app_page):
    page = app_page
    _open_sinking(page, _state())
    _add_target_date_fund(page, None)
    page.wait_for_selector('#alertModalOkBtn', state='visible')
    page.click('#alertModalOkBtn')
    assert page.locator('.sinking-card').count() == 0
    assert page.evaluate('window.app.sinkingFunds.length') == 0


def test_past_date_is_rejected_on_add(app_page):
    page = app_page
    _open_sinking(page, _state())
    past = (datetime.date.today() - datetime.timedelta(days=3)).isoformat()
    _add_target_date_fund(page, past)
    page.wait_for_selector('#alertModalOkBtn', state='visible')
    page.click('#alertModalOkBtn')
    assert page.locator('.sinking-card').count() == 0
    assert page.evaluate('window.app.sinkingFunds.length') == 0


def test_target_date_round_trips_through_import_and_other_methods_drop_it(app_page):
    page = app_page
    date = _month_start(9)
    fixed = _fund(id=2, name='Fixed', allocationMethod='fixed', monthlyAllocation=50, targetDate=date)
    seed_state(page, _state(_fund(targetDate=date), fixed))
    rows = wait_for_api(page, '/api/sinking-funds', lambda r: len(r) == 2)
    by_name = {r['name']: r for r in rows}
    assert by_name['House']['targetDate'] == date
    assert by_name['Fixed']['targetDate'] is None
