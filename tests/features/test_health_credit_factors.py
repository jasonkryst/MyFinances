#!/usr/bin/env python3
"""Health Credit Utilization card: "What affects your credit?" explainer (#337).

Education only -- five standard credit factors, a one-line status where the
app has data (utilization, oldest account, credit mix), a link to
AnnualCreditReport.com, and never a score, gauge or meter.
"""

import json
import re

import pytest

CARD = '#healthCreditUtilCard'
EXPLAINER = '#healthCreditFactors'


def _debt(**kw):
    base = {
        "id": 1, "name": "Card", "debtType": "creditCard", "accountBalance": 1000,
        "originalBalance": 1000, "interestRate": 20, "minimumPayment": 25,
        "originalMinimumPayment": 25, "dueDate": 15, "creditLimit": None,
        "debtStartDate": None, "archived": False, "personIds": [],
    }
    base.update(kw)
    return base


def _setup(page, debts):
    page.wait_for_function("() => window.app && window.app.switchPage")
    page.evaluate(f"""() => {{
        const app = window.app;
        app.debts = {json.dumps(debts)};
        app.incomes = []; app.bills = []; app.expenses = []; app.accounts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.persons = [];
        app.switchPage('health');
    }}""")
    page.wait_for_selector(f'{CARD} {EXPLAINER}', state='attached', timeout=5000)


def _status(page, key):
    return page.text_content(f'{EXPLAINER} [data-credit-factor="{key}"] .health-credit-factor-status').strip()


def _expand(page):
    page.click(f'{EXPLAINER} summary')
    page.wait_for_function(f"() => document.querySelector('{EXPLAINER}').open")


# ── Positive ─────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_explainer_collapsed_by_default_with_five_factors(app_page):
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200)])
    assert app_page.evaluate(f"() => document.querySelector('{EXPLAINER}').open") is False
    assert app_page.text_content(f'{EXPLAINER} summary').strip() == 'What affects your credit?'
    keys = app_page.evaluate(
        f"() => Array.from(document.querySelectorAll('{EXPLAINER} [data-credit-factor]')).map(e => e.dataset.creditFactor)"
    )
    assert keys == ['util', 'payment', 'age', 'mix', 'new']


@pytest.mark.feature
def test_expanding_explainer_stays_on_health_page(app_page):
    """The card is click-to-navigate (data-card-nav); toggling the <details>
    must not send the user to Liabilities."""
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200)])
    _expand(app_page)
    assert app_page.is_visible(f'{EXPLAINER} .health-credit-factors-list')
    # Clicking text inside the open body must not navigate either.
    app_page.click(f'{EXPLAINER} .health-credit-factors-intro')
    app_page.wait_for_timeout(150)
    assert app_page.evaluate("() => window.app._currentPage") == 'health'


@pytest.mark.feature
def test_card_click_outside_explainer_still_navigates(app_page):
    """Regression guard on the handler change: clicking the card itself still
    navigates to Liabilities."""
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200)])
    app_page.click(f'{CARD} .health-card-desc')
    app_page.wait_for_function("() => window.app._currentPage === 'liabilities'", timeout=5000)


@pytest.mark.feature
def test_utilization_status_above_threshold(app_page):
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200)])
    s = _status(app_page, 'util')
    assert '42%' in s and 'above' in s


@pytest.mark.feature
def test_utilization_status_at_threshold_is_ok(app_page):
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=3000)])
    s = _status(app_page, 'util')
    assert '30%' in s and 'at or below' in s


@pytest.mark.feature
def test_age_status_uses_oldest_start_date(app_page):
    _setup(app_page, [
        _debt(id=1, creditLimit=5000, debtStartDate='2019-06-01'),
        _debt(id=2, name='Auto Loan', debtStartDate='2015-03-10'),
    ])
    assert 'Mar 2015' in _status(app_page, 'age')


@pytest.mark.feature
def test_mix_counts_revolving_and_installment(app_page):
    _setup(app_page, [
        _debt(id=1, creditLimit=5000),
        _debt(id=2, name='Auto Loan'),
        _debt(id=3, name='Student Loan'),
    ])
    s = _status(app_page, 'mix')
    assert '1 credit card' in s and '2 other' in s


@pytest.mark.feature
def test_annual_credit_report_link_is_safe_new_tab(app_page):
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200)])
    attrs = app_page.evaluate("""() => {
        const a = document.getElementById('healthCreditReportLink');
        return { href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent };
    }""")
    assert attrs['href'] == 'https://www.annualcreditreport.com'
    assert attrs['target'] == '_blank'
    assert set(attrs['rel'].split()) >= {'noopener', 'noreferrer'}
    assert 'AnnualCreditReport.com' in attrs['text']
    assert 'opens in a new tab' in attrs['text']


@pytest.mark.feature
def test_explainer_translated_in_spanish(app_page):
    app_page.evaluate("() => localStorage.setItem('debtTrackerLocale', 'es')")
    try:
        app_page.reload()
        _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200)])
        assert app_page.text_content(f'{EXPLAINER} summary').strip() == '¿Qué afecta a tu crédito?'
        assert '42%' in _status(app_page, 'util')
    finally:
        app_page.evaluate("() => localStorage.removeItem('debtTrackerLocale')")


# ── Negative ─────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_explainer_present_without_utilization_data(app_page):
    """No credit limit set: the card is in its empty state but the explainer
    still renders, with a prompt instead of a percentage."""
    _setup(app_page, [_debt(creditLimit=None)])
    s = _status(app_page, 'util')
    assert 'Set a credit limit' in s
    assert '%' not in s


@pytest.mark.feature
def test_no_debts_shows_fallback_statuses(app_page):
    _setup(app_page, [])
    assert 'Add a start date' in _status(app_page, 'age')
    assert 'No interest-bearing debts' in _status(app_page, 'mix')


@pytest.mark.feature
def test_fixed_amount_and_archived_debts_excluded(app_page):
    _setup(app_page, [
        _debt(id=1, name='Daycare', debtType='fixedAmount', debtStartDate='2010-01-01'),
        _debt(id=2, name='Old Card', creditLimit=5000, archived=True, debtStartDate='2008-01-01'),
        _debt(id=3, name='Current Card', creditLimit=5000, debtStartDate='2020-07-01'),
    ])
    assert 'Jul 2020' in _status(app_page, 'age')
    s = _status(app_page, 'mix')
    assert '1 credit card' in s and '0 other' in s


@pytest.mark.feature
def test_invalid_start_date_ignored(app_page):
    _setup(app_page, [_debt(id=1, creditLimit=5000, debtStartDate='not-a-date')])
    assert 'Add a start date' in _status(app_page, 'age')


@pytest.mark.feature
def test_no_score_gauge_or_meter(app_page):
    """The explainer must never show a score, a score-like number, a gauge
    or a meter (#337 acceptance criterion)."""
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200, debtStartDate='2015-03-10')])
    _expand(app_page)
    graphics = app_page.evaluate(
        f"() => document.querySelectorAll('{EXPLAINER} meter, {EXPLAINER} progress, "
        f"{EXPLAINER} .progress-bar, {EXPLAINER} canvas, {EXPLAINER} svg').length"
    )
    assert graphics == 0
    text = app_page.text_content(EXPLAINER)
    assert not re.search(r'score\s*(of|:|is)?\s*\d', text, re.I), text
    assert not re.search(r'\d+\s*points?', text, re.I), text


@pytest.mark.feature
def test_explainer_has_no_inline_styles(app_page):
    _setup(app_page, [_debt(creditLimit=10000, accountBalance=4200)])
    assert app_page.evaluate(f"() => document.querySelectorAll('{EXPLAINER} [style]').length") == 0
