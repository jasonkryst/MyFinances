"""Promotional APR on debts (issue #681).

The add form and inline editor take a promo rate, an end date and deferred
interest; the card shows "0% until <month> (then X%)" with the payment that
clears the balance in time; the refinancing what-if accepts an intro rate; and
a promo ending within 60 days raises a promoEnding notification.
"""
from datetime import date, timedelta

import pytest

from tests.conftest import (
    expect_alert_and_dismiss, open_debt_form, seed_state, submit_debt_form, wait_for_api,
)

TODAY = date.today()


def _month_end(months_ahead):
    y, m = divmod(TODAY.year * 12 + (TODAY.month - 1) + months_ahead + 1, 12)
    return date(y, m + 1, 1) - timedelta(days=1)


PROMO_END = _month_end(6)            # six monthly payments left
SOON = TODAY + timedelta(days=30)    # inside the 60-day alert window


def _go_debts(page):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)


def _card(page, name):
    return page.locator('#debtsList .debt-card', has_text=name).first


def _fill_card_debt(page, name, balance='1200', rate='24.99'):
    open_debt_form(page)
    page.fill('#debtName', name)
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', balance)
    page.fill('#interestRate', rate)
    page.fill('#minimumPayment', '40')
    page.fill('#dueDate', '15')


def _state(**debt_fields):
    debt = {'id': 1, 'name': 'Store Card', 'debtType': 'creditCard', 'accountBalance': 1200, 'originalBalance': 1200,
            'minimumPayment': 40, 'interestRate': 24.99, 'dueDate': 15, 'category': 'Credit Card'}
    debt.update(debt_fields)
    return {'accounts': [{'id': 1, 'name': 'Checking', 'type': 'Checking', 'startingBalance': 5000}], 'debts': [debt]}


@pytest.mark.feature
def test_add_debt_with_promo_shows_notice_and_hint(app_page):
    page = app_page
    _go_debts(page)
    _fill_card_debt(page, 'Promo Card')
    page.fill('#debtPromoRate', '0')
    page.fill('#debtPromoEndDate', PROMO_END.isoformat())
    submit_debt_form(page)

    rows = wait_for_api(page, '/api/debts', lambda rows: any(
        r.get('name') == 'Promo Card' and r.get('promoRate') == 0 and r.get('promoEndDate') == PROMO_END.isoformat()
        and r.get('deferredInterest') is False for r in rows))
    assert rows
    note = _card(page, 'Promo Card').locator('.debt-promo-note')
    note.wait_for(state='visible', timeout=5000)
    line = note.locator('.debt-promo-line').inner_text()
    assert line.startswith('0% until ') and line.endswith('(then 24.99%)'), line
    assert note.locator('.debt-promo-hint').inner_text() == 'Pay $200.00/mo to clear it before the promo ends.'
    assert note.locator('.debt-promo-deferred').count() == 0
    # The interest tile shows the rate in effect today.
    assert '0.00%' in _card(page, 'Promo Card').inner_text()


@pytest.mark.feature
def test_add_debt_with_deferred_interest(app_page):
    page = app_page
    _go_debts(page)
    _fill_card_debt(page, 'Deferred Card')
    page.fill('#debtPromoRate', '0')
    page.fill('#debtPromoEndDate', PROMO_END.isoformat())
    page.check('#debtDeferredInterest')
    page.fill('#debtDeferredAccrued', '35.50')
    submit_debt_form(page)
    wait_for_api(page, '/api/debts', lambda rows: any(
        r.get('name') == 'Deferred Card' and r.get('deferredInterest') is True and r.get('deferredInterestAccrued') == 35.5
        for r in rows))
    note = _card(page, 'Deferred Card').locator('.debt-promo-note')
    assert note.locator('.debt-promo-deferred').inner_text() == 'Deferred interest'
    assert 'avoid the deferred interest' in note.locator('.debt-promo-hint').inner_text()


@pytest.mark.feature
@pytest.mark.parametrize('rate,end,message', [
    ('0', '', 'Enter the date the promo ends, or clear both promo fields.'),
    ('', '2030-01-31', 'Enter a promo rate between 0 and 100, or clear both promo fields.'),
    ('150', '2030-01-31', 'Enter a promo rate between 0 and 100, or clear both promo fields.'),
])
def test_add_debt_half_promo_rejected(app_page, rate, end, message):
    page = app_page
    _go_debts(page)
    _fill_card_debt(page, 'Half Promo')
    page.fill('#debtPromoRate', rate)
    page.fill('#debtPromoEndDate', end)
    page.click('#debtFormSubmit')  # submit-no-wait: validation rejects the promo, so no save runs
    expect_alert_and_dismiss(page, message)
    wait_for_api(page, '/api/debts', lambda rows: not any(r.get('name') == 'Half Promo' for r in rows))


@pytest.mark.feature
def test_no_promo_notice_without_promo_or_after_it_ended(app_page):
    page = app_page
    seed_state(page, _state(promoRate=0, promoEndDate=(TODAY - timedelta(days=1)).isoformat()))
    _go_debts(page)
    card = _card(page, 'Store Card')
    card.wait_for(state='visible', timeout=5000)
    assert card.locator('.debt-promo-note').count() == 0
    assert '24.99%' in card.inner_text()


@pytest.mark.feature
def test_inline_edit_sets_rejects_and_clears_promo(app_page):
    page = app_page
    seed_state(page, _state())
    _go_debts(page)
    debt_id = page.evaluate("() => window.app.debts.find(d => d.name === 'Store Card').id")
    page.click(f'[data-debt-action="edit"][data-debt-id="{debt_id}"]')
    page.wait_for_selector(f'#inline-promo-rate-{debt_id}', timeout=5000)

    # Rate without an end date: rejected, nothing applied.
    page.fill(f'#inline-promo-rate-{debt_id}', '0')
    page.click(f'[data-debt-action="save-inline"][data-debt-id="{debt_id}"]')
    expect_alert_and_dismiss(page, 'Enter the date the promo ends, or clear both promo fields.')
    assert page.evaluate(f"() => window.app.debts.find(d => d.id === {debt_id}).promoRate ?? null") is None

    page.fill(f'#inline-promo-end-{debt_id}', PROMO_END.isoformat())
    page.click(f'[data-debt-action="save-inline"][data-debt-id="{debt_id}"]')
    wait_for_api(page, '/api/debts', lambda rows: any(
        r.get('id') == debt_id and r.get('promoRate') == 0 and r.get('promoEndDate') == PROMO_END.isoformat() for r in rows))
    _card(page, 'Store Card').locator('.debt-promo-note').wait_for(state='visible', timeout=5000)

    # Clearing both fields removes the promo.
    page.click(f'[data-debt-action="edit"][data-debt-id="{debt_id}"]')
    page.fill(f'#inline-promo-rate-{debt_id}', '')
    page.fill(f'#inline-promo-end-{debt_id}', '')
    page.click(f'[data-debt-action="save-inline"][data-debt-id="{debt_id}"]')
    wait_for_api(page, '/api/debts', lambda rows: any(
        r.get('id') == debt_id and r.get('promoRate') is None and r.get('promoEndDate') is None for r in rows))
    assert _card(page, 'Store Card').locator('.debt-promo-note').count() == 0


@pytest.mark.feature
def test_plan_charges_no_interest_during_a_promo(app_page):
    page = app_page
    seed_state(page, _state(promoRate=0, promoEndDate=_month_end(3).isoformat()))
    interest = page.evaluate("""() => {
        const r = DebtCalculator.calculatePaymentPlan(window.app.debts, 100, 'avalanche');
        return r.paymentPlan.map(m => m.payments[0].interest);
    }""")
    assert interest[:3] == [0, 0, 0], interest[:4]
    assert interest[4] > 0, interest[:6]


@pytest.mark.feature
def test_refinance_what_if_accepts_an_intro_rate(app_page):
    page = app_page
    seed_state(page, _state())
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.fill('#monthlyPayment', '200')
    page.evaluate("() => window.app.calculatePaymentPlanFromInputs()")
    page.wait_for_selector('#refiDetails', timeout=10000)
    page.evaluate("() => { document.getElementById('refiDetails').open = true; }")
    debt_id = page.evaluate("() => String(window.app.debts[0].id)")
    page.select_option('#refiDebtSelect', debt_id)
    page.fill('#refiAprInput', '18')

    page.fill('#refiPromoRateInput', '0')
    page.wait_for_selector('#refiError', timeout=5000)
    assert page.inner_text('#refiError') == 'Enter the date the intro rate ends, or clear both intro fields.'
    assert page.get_attribute('#refiPromoEndInput', 'aria-invalid') == 'true'

    page.fill('#refiPromoEndInput', _month_end(12).isoformat())
    page.dispatch_event('#refiPromoEndInput', 'change')
    page.wait_for_selector('#refiPromoNote', timeout=5000)
    assert page.inner_text('#refiPromoNote').startswith('With an intro rate of 0% until ')
    with_intro = page.inner_text('#refiInterest')

    page.fill('#refiPromoRateInput', '')
    page.fill('#refiPromoEndInput', '')
    page.dispatch_event('#refiPromoEndInput', 'change')
    page.wait_for_selector('#refiPromoNote', state='detached', timeout=5000)
    assert page.inner_text('#refiInterest') != with_intro, 'an intro rate changes the interest result'

    page.click('#refiClearBtn')
    assert page.input_value('#refiPromoRateInput') == ''
    assert page.input_value('#refiPromoEndInput') == ''


@pytest.mark.feature
def test_promo_ending_notification(app_page):
    page = app_page
    seed_state(page, _state(promoRate=0, promoEndDate=SOON.isoformat()))
    res = page.evaluate("""async () => {
        const csrf = document.cookie.match(/csrf=([^;]+)/)[1];
        const r = await fetch('/api/notifications/check', { method: 'POST', headers: { 'X-CSRF-Token': csrf } });
        await r.text();
        return r.status;
    }""")
    assert res == 200
    rows = wait_for_api(page, '/api/notifications?status=all&type=promo',
                        lambda body: any(n.get('type') == 'promoEnding' for n in body.get('notifications', [])))
    alert = next(n for n in rows['notifications'] if n['type'] == 'promoEnding')
    assert alert['params']['daysUntil'] == 30
    text = page.evaluate("""async (p) => {
        const nc = await import('/src/notificationsCenter.js');
        return nc.notificationMessage('promoEnding', p);
    }""", alert['params'])
    assert text.startswith('The promo rate on Store Card ends in 30 days'), text
    assert text.endswith('then 24.99% applies to $1,200.00.'), text


@pytest.mark.feature
def test_promo_ending_setting_toggle_persists(app_page):
    page = app_page
    page.evaluate("() => window.app.openSettings({ page: 'notifications' })")
    toggle = page.locator('#settingNotifyPromoEnding')
    toggle.wait_for(state='visible', timeout=5000)
    assert toggle.is_checked(), 'on by default'
    toggle.uncheck()
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r.get('key') == 'notifyPromoEnding' and r.get('value') is False for r in rows))
