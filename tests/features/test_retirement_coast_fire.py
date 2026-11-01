#!/usr/bin/env python3
"""Retirement page: Coast FIRE date (issue #346).

Aggregate across non-pension retirement accounts, one result per scenario
(conservative / moderate / aggressive). The target is the user's input, or
Health's FIRE number when blank -- never the contribution-inclusive projection.
"""

import json
import re

import pytest

from tests.conftest import assert_no_errors

SECTION = '#retireCoastFire'
INPUT = '#retireCoastTargetInput'
SCENARIOS = ('Conservative', 'Moderate', 'Aggressive')


def _investment(acct_id=9601, name='Coast 401k', rate=7):
    return {
        "id": acct_id, "name": name, "type": "Retirement", "retirementSubtype": "401k",
        "startingBalance": 0, "interestRate": 0, "rateOfReturn": rate, "employerMatchPercent": 0,
        "minimumPayment": 0, "catchUpEligible": False, "hsaCoverageType": "selfOnly", "archived": False,
    }


def _pension(acct_id=9602):
    return {
        "id": acct_id, "name": "Coast Pension", "type": "Retirement", "retirementSubtype": "Pension",
        "startingBalance": 0, "interestRate": 0, "rateOfReturn": 0, "employerMatchPercent": 0,
        "pensionAnnualSalary": 60000, "pensionContributionRatePct": 5, "pensionVestingYears": 5,
        "pensionEstimatedMonthlyBenefit": 2000, "pensionYearsOfService": 10, "minimumPayment": 0,
        "catchUpEligible": False, "hsaCoverageType": "selfOnly", "archived": False,
    }


def _seed(page, accounts, snapshots, bills=1000, settings=None, years=30, target_date=True):
    page.wait_for_function("() => window.app && window.app.switchPage")
    page.evaluate(f"""async () => {{
        const app = window.app;
        const y = new Date().getFullYear();
        app.accounts = {json.dumps(accounts)};
        app.retirementSnapshots = {json.dumps(snapshots)};
        app.bills = {json.dumps([{"id": 1, "name": "Rent", "amount": bills, "category": "Housing", "dueDate": 1}] if bills else [])};
        app.expenses = []; app.incomes = []; app.debts = []; app.recurringTemplates = [];
        app.settings = {json.dumps(settings or [])};
        app.retirementTargetDate = {'`${y + ' + str(years) + '}-01-01`' if target_date else 'null'};
        app.saveToStorage();
        app.switchPage('retirement');
        await app.renderRetirementPage();
    }}""")
    page.wait_for_selector('#retirementSection.active', timeout=5000)


def _snap(acct_id=9601, balance=10000, contribution=1000):
    return {"id": acct_id * 10, "accountId": acct_id, "date": "2026-01-01", "balance": balance, "contribution": contribution}


def _results(page):
    return page.evaluate(f"""() => Object.fromEntries({json.dumps(SCENARIOS)}.map(k => {{
        const el = document.getElementById('retireCoast' + k + 'Val');
        return [k, el ? {{ status: el.dataset.coastStatus, text: el.textContent.trim() }} : null];
    }}))""")


def _stored(page):
    return page.evaluate("() => (window.app.settings.find(s => s.key === 'retirementCoastTarget') || {}).value ?? null")


def _commit(page, value):
    page.fill(INPUT, value)
    page.dispatch_event(INPUT, 'change')


def _months(text):
    m = re.search(r'\((\d+) months from now\)', text)
    return int(m.group(1)) if m else None


# ── Positive ─────────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_defaults_to_health_fire_number(app_page):
    """Blank target -> FIRE number ($1,000/mo bills x 12 x 25 = $300,000)."""
    _seed(app_page, [_investment()], [_snap()])
    app_page.wait_for_selector(SECTION, timeout=5000)
    assert app_page.input_value(INPUT) == ''
    assert app_page.get_attribute(INPUT, 'placeholder') == '300000'
    assert '$300,000' in app_page.text_content('#retireCoastTargetHint')
    r = _results(app_page)
    assert r['Moderate']['status'] == 'coast', r
    assert _months(r['Moderate']['text']) > 0
    assert_no_errors(app_page)


@pytest.mark.feature
def test_scenarios_ordered_aggressive_earliest(app_page):
    _seed(app_page, [_investment()], [_snap()])
    r = _results(app_page)
    assert all(r[k]['status'] == 'coast' for k in SCENARIOS), r
    c, m, a = (_months(r[k]['text']) for k in SCENARIOS)
    assert a <= m <= c and a < c, (c, m, a)


@pytest.mark.feature
def test_custom_target_saved_and_used(app_page):
    _seed(app_page, [_investment()], [_snap()])
    before = _months(_results(app_page)['Moderate']['text'])
    _commit(app_page, '600000')
    app_page.wait_for_function("() => document.getElementById('retireCoastTargetInput')?.value === '600000'")
    assert _stored(app_page) == 600000
    assert 'target you entered' in app_page.text_content('#retireCoastTargetHint')
    after = _months(_results(app_page)['Moderate']['text'])
    assert after is not None and after > before


@pytest.mark.feature
def test_already_reached_coast_fire(app_page):
    _seed(app_page, [_investment()], [_snap(balance=1000000)])
    r = _results(app_page)
    assert all(r[k]['status'] == 'reached' for k in SCENARIOS), r
    assert "You've reached Coast FIRE!" in r['Moderate']['text']


@pytest.mark.feature
def test_unreachable_target_requires_contributions_through_retirement(app_page):
    _seed(app_page, [_investment()], [_snap()], settings=[{"key": "retirementCoastTarget", "value": 900000000000}])
    r = _results(app_page)
    assert all(r[k]['status'] == 'shortfall' for k in SCENARIOS), r
    assert 'Contributions required through retirement' in r['Moderate']['text']


@pytest.mark.feature
def test_clearing_target_reverts_to_fire_number(app_page):
    _seed(app_page, [_investment()], [_snap()], settings=[{"key": "retirementCoastTarget", "value": 600000}])
    assert app_page.input_value(INPUT) == '600000'
    _commit(app_page, '')
    app_page.wait_for_function("() => document.getElementById('retireCoastTargetHint')?.textContent.includes('FIRE number from Health')")
    assert _stored(app_page) == 0
    assert app_page.input_value(INPUT) == ''


@pytest.mark.feature
def test_target_persists_across_reload(app_page):
    _seed(app_page, [_investment()], [_snap()])
    _commit(app_page, '750000')
    app_page.wait_for_function("() => document.getElementById('retireCoastTargetInput')?.value === '750000'")
    app_page.wait_for_timeout(500)  # saveToStorage is debounced
    app_page.reload()
    app_page.evaluate("async () => { window.app.switchPage('retirement'); await window.app.renderRetirementPage(); }")
    app_page.wait_for_selector(INPUT, timeout=5000)
    assert app_page.input_value(INPUT) == '750000'


@pytest.mark.feature
def test_pension_excluded_with_note(app_page):
    _seed(app_page, [_investment(), _pension()], [_snap()])
    assert app_page.is_visible('#retireCoastPensionNote')
    assert _results(app_page)['Moderate']['status'] == 'coast'


# ── Negative ─────────────────────────────────────────────────────────────────

@pytest.mark.feature
@pytest.mark.parametrize('bad', ['-5', '0', '2000000000000'])
def test_invalid_target_rejected_inline(app_page, bad):
    _seed(app_page, [_investment()], [_snap()], settings=[{"key": "retirementCoastTarget", "value": 600000}])
    before = _results(app_page)
    _commit(app_page, bad)
    app_page.wait_for_selector('#retireCoastTargetError:not(.hidden)', timeout=3000)
    assert app_page.get_attribute(INPUT, 'aria-invalid') == 'true'
    assert app_page.input_value(INPUT) == '600000'  # reverted
    assert _stored(app_page) == 600000             # not saved
    assert _results(app_page) == before


@pytest.mark.feature
def test_no_target_and_no_fire_number_prompts_for_target(app_page):
    _seed(app_page, [_investment()], [_snap()], bills=0)
    assert 'Enter a target balance' in app_page.text_content('#retireCoastTargetHint')
    assert all(v is None for v in _results(app_page).values())


@pytest.mark.feature
@pytest.mark.parametrize('stored', ['500000', -100, 0])
def test_invalid_stored_target_falls_back_to_fire_number(app_page, stored):
    _seed(app_page, [_investment()], [_snap()], settings=[{"key": "retirementCoastTarget", "value": stored}])
    assert app_page.input_value(INPUT) == ''
    assert 'FIRE number from Health' in app_page.text_content('#retireCoastTargetHint')


@pytest.mark.feature
def test_pension_only_shows_message_not_results(app_page):
    _seed(app_page, [_pension()], [])
    app_page.wait_for_selector('#retireCoastMsg', timeout=5000)
    assert 'non-pension' in app_page.text_content('#retireCoastMsg')
    assert app_page.query_selector(INPUT) is None


@pytest.mark.feature
def test_no_target_date_hides_coast_section(app_page):
    _seed(app_page, [_investment()], [_snap()], target_date=False)
    assert app_page.query_selector(SECTION) is None
