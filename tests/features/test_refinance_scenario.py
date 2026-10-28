#!/usr/bin/env python3
"""Plan page What-If: Refinancing scenario (#320)."""

import json
import pytest

STRATEGIES = ['avalanche', 'snowball', 'priority-lowest', 'priority-highest']

DEBTS_JS = """() => {
    window.app.debts = [
        { id: 1, name: 'Card <b>A</b>', debtType: 'creditCard', accountBalance: 5000, interestRate: 24,
          minimumPayment: 100, priority: 1, dueDate: 15 },
        { id: 2, name: 'Loan B', debtType: 'creditCard', accountBalance: 3000, interestRate: 8,
          minimumPayment: 60, priority: 2, dueDate: 10 },
        { id: 3, name: 'Old Card', debtType: 'creditCard', accountBalance: 900, interestRate: 20,
          minimumPayment: 25, priority: 3, dueDate: 5, archived: true }
    ];
}"""


def _plan(page, strategy='avalanche'):
    page.wait_for_function("() => window.app && window.app.switchPage")
    page.evaluate(DEBTS_JS)
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.fill('#monthlyPayment', '400')
    page.select_option('#paymentStrategy', strategy)
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)
    page.wait_for_selector('#refiDebtSelect', state='attached')
    page.evaluate("() => { document.getElementById('refiDetails').open = true; }")


def _refi(page, debt_id, apr):
    page.select_option('#refiDebtSelect', debt_id)
    page.fill('#refiAprInput', apr)


def _metric(page, sel):
    return page.text_content(sel).strip()


def _money(text):
    return float(text.replace('$', '').replace(',', ''))


@pytest.mark.feature
@pytest.mark.parametrize('strategy', STRATEGIES)
def test_lower_apr_saves_interest_all_strategies(app_page, strategy):
    _plan(app_page, strategy)
    before = app_page.evaluate("() => JSON.stringify(window.app.debts)")
    _refi(app_page, '1', '5')
    app_page.wait_for_selector('#refiInterest')
    assert _metric(app_page, '#refiInterestLabel') == 'Interest Saved'
    assert _money(_metric(app_page, '#refiInterest')) > 0
    months = _metric(app_page, '#refiMonths')
    assert 'later' not in months
    assert 'fixed' in _metric(app_page, '#refiPaymentNote')
    assert app_page.evaluate("() => JSON.stringify(window.app.debts)") == before


@pytest.mark.feature
@pytest.mark.parametrize('strategy', STRATEGIES)
def test_higher_apr_shows_extra_cost(app_page, strategy):
    _plan(app_page, strategy)
    _refi(app_page, '1', '30')
    app_page.wait_for_selector('#refiInterest')
    assert _metric(app_page, '#refiInterestLabel') == 'Extra Interest Cost'
    assert _money(_metric(app_page, '#refiInterest')) > 0
    assert 'sooner' not in _metric(app_page, '#refiMonths')


@pytest.mark.feature
def test_matches_direct_engine_run_and_does_not_mutate_debts(app_page):
    _plan(app_page)
    res = app_page.evaluate("""() => {
        const app = window.app;
        const snapshot = JSON.stringify(app.debts);
        const active = app.debts.filter(d => !d.archived);
        const mod = active.map(d => d.id === 1 ? { ...d, interestRate: 10 } : d);
        const run = ds => { const r = DebtCalculator.calculatePaymentPlan(ds, 400, 'avalanche', 0);
            return DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan).totalInterest; };
        const expected = run(active) - run(mod);
        return { snapshot, expected };
    }""")
    _refi(app_page, '1', '10')
    app_page.wait_for_selector('#refiInterest')
    assert abs(_money(_metric(app_page, '#refiInterest')) - res['expected']) < 0.02
    assert app_page.evaluate("() => JSON.stringify(window.app.debts)") == res['snapshot']


@pytest.mark.feature
def test_only_active_non_archived_debts_offered_and_names_escaped(app_page):
    _plan(app_page)
    opts = app_page.eval_on_selector_all('#refiDebtSelect option', 'els => els.map(e => e.textContent)')
    joined = ' | '.join(opts)
    assert 'Loan B' in joined
    assert 'Old Card' not in joined
    assert app_page.locator('#refiDebtSelect b').count() == 0
    assert '<b>A</b>' in joined  # rendered as literal text


@pytest.mark.feature
def test_same_apr_shows_no_change(app_page):
    _plan(app_page)
    _refi(app_page, '1', '24')
    app_page.wait_for_selector('#refiNoChange')
    assert app_page.locator('#refiInterest').count() == 0


@pytest.mark.feature
@pytest.mark.parametrize('bad', ['-1', '101', '1e5'])
def test_invalid_apr_rejected(app_page, bad):
    _plan(app_page)
    _refi(app_page, '1', bad)
    app_page.wait_for_selector('#refiError')
    assert app_page.locator('#refiInterest').count() == 0
    assert app_page.get_attribute('#refiAprInput', 'aria-invalid') == 'true'


@pytest.mark.feature
def test_blank_apr_and_no_debt_compute_nothing(app_page):
    _plan(app_page)
    app_page.fill('#refiAprInput', '5')  # no debt selected
    assert app_page.locator('#refiInterest').count() == 0
    app_page.select_option('#refiDebtSelect', '1')
    app_page.fill('#refiAprInput', '')
    assert app_page.locator('#refiInterest').count() == 0
    assert app_page.locator('#refiError').count() == 0


@pytest.mark.feature
def test_clear_button_resets(app_page):
    _plan(app_page)
    _refi(app_page, '1', '5')
    app_page.wait_for_selector('#refiInterest')
    app_page.click('#refiClearBtn')
    assert app_page.input_value('#refiAprInput') == ''
    assert app_page.input_value('#refiDebtSelect') == ''
    assert app_page.locator('#refiInterest').count() == 0


@pytest.mark.feature
def test_navigating_away_and_back_resets(app_page):
    _plan(app_page)
    _refi(app_page, '1', '5')
    app_page.wait_for_selector('#refiInterest')
    app_page.evaluate("() => window.app.switchPage('health')")
    app_page.evaluate("() => window.app.switchPage('strategy')")
    assert app_page.input_value('#refiAprInput') == ''
    assert app_page.locator('#refiInterest').count() == 0


@pytest.mark.feature
def test_recalculate_resets(app_page):
    _plan(app_page)
    _refi(app_page, '1', '5')
    app_page.wait_for_selector('#refiInterest')
    app_page.click('#calculateBtn')
    app_page.wait_for_function("() => document.getElementById('refiAprInput').value === ''")
    assert app_page.locator('#refiInterest').count() == 0


@pytest.mark.feature
def test_label_and_clear_button_accessible(app_page):
    _plan(app_page)
    assert app_page.locator('label[for="refiDebtSelect"]').count() == 1
    assert app_page.locator('label[for="refiAprInput"]').count() == 1
    assert app_page.get_attribute('#refiClearBtn', 'aria-label')
