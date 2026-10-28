"""UX B (#427): numbers and copy clarity on Health / Savings / Reports / Recurring / Plan."""
import json
import re
from datetime import date

import pytest

from tests.conftest import create_debt


def _seed_base(page, extra=""):
    page.evaluate("""() => {
        const app = window.app;
        const d = new Date();
        const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
        app.accounts = [
            { id: 7001, name: 'Checking', type: 'Checking', startingBalance: 5000 },
            { id: 7002, name: '401k', type: 'Retirement', startingBalance: 20000 }
        ];
        app.incomes = [{ id: 1, name: 'Salary', amount: 4000, firstPayDate: first, frequency: 'monthly' }];
        app.bonuses = []; app.bills = []; app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = [{ id: 1, name: 'EF', accountId: 7001, currentAmount: 100, targetAmount: 5000, monthlyContribution: 250 }];
        app.sinkingFunds = []; app.persons = []; app.settings = [];
        app.debts = [{ id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 2000, originalBalance: 2500,
                       creditLimit: 5000, minimumPayment: 80, interestRate: 20, dueDate: 5, category: 'Credit Card' }];
    }""")
    if extra:
        page.evaluate(extra)


def _health_text(page):
    page.evaluate("() => window.app.switchPage('health')")
    return page.inner_text('#healthSection')


@pytest.mark.feature
def test_health_payoff_date_is_formatted_not_raw_date_string(app_page):
    page = app_page
    _seed_base(page)
    text = _health_text(page)
    assert 'Estimated payoff' in text
    for raw in ('GMT', 'Standard Time', 'Daylight Time', '00:00:00'):
        assert raw not in text, f"raw Date string leaked into Health: {raw}"
    assert re.search(r'Estimated payoff: [A-Z][a-z]{2} \d{1,2}, \d{4}', text)


@pytest.mark.feature
def test_savings_rate_identical_on_health_and_savings_pages(app_page):
    page = app_page
    # A recurring inflow changes Health's cash-flow income; the savings rate must ignore it.
    _seed_base(page, """() => {
        const app = window.app;
        const d = new Date();
        app.recurringTemplates = [{ id: 1, name: 'Refund', amount: 500, frequency: 'monthly', dayOfMonth: 15,
            type: 'reimbursement', category: 'Other', accountId: 7001,
            startDate: `${d.getFullYear() - 1}-01-01`, paused: false, archived: false, skippedMonths: [], paidMonths: [] }];
    }""")
    _health_text(page)
    health_pct = page.inner_text('#healthSavingsGauge ~ .health-gauge-center .health-gauge-value').strip()
    page.evaluate("() => window.app.switchPage('savings')")
    summary = page.inner_text('.savings-rate-summary-value').strip()
    assert summary == health_pct
    assert summary == '6.3%'  # 250 / 4000
    assert '$4,000.00/mo' in page.inner_text('.savings-rate-summary-detail')


@pytest.mark.feature
def test_savings_rate_zero_income_is_zero_on_both(app_page):
    page = app_page
    _seed_base(page, "() => { window.app.incomes = []; }")
    _health_text(page)
    assert page.inner_text('#healthSavingsGauge ~ .health-gauge-center .health-gauge-value').strip() == '0.0%'
    page.evaluate("() => window.app.switchPage('savings')")
    assert page.inner_text('.savings-rate-summary-value').strip() == '0.0%'


def _open_forecast(page):
    page.evaluate("() => { window.app.switchPage('reports'); }")
    page.click('[data-rptab="forecast"]')
    page.wait_for_selector('#rptPanel-forecast.rpt-tab-panel--active', timeout=5000)
    page.wait_for_selector('#reportsCashFlowForecast .nw-report-stat', timeout=5000)


@pytest.mark.feature
def test_forecast_total_labels_and_breaks_out_retirement(app_page):
    page = app_page
    _seed_base(page)
    _open_forecast(page)
    text = page.inner_text('#reportsCashFlowForecast')
    assert 'Current Balance (all asset accounts)' in text
    assert '$25,000.00' in text
    note = page.inner_text('#cfRetirementNote')
    assert '$20,000.00' in note and 'retirement' in note


@pytest.mark.feature
def test_forecast_no_retirement_note_without_retirement_accounts(app_page):
    page = app_page
    _seed_base(page, "() => { window.app.accounts = window.app.accounts.filter(a => a.type !== 'Retirement'); }")
    _open_forecast(page)
    assert page.query_selector('#cfRetirementNote') is None
    assert 'Current Balance' in page.inner_text('#reportsCashFlowForecast')


@pytest.mark.feature
def test_net_worth_snapshot_labelled_as_snapshot(app_page):
    page = app_page
    _seed_base(page)
    page.evaluate("""() => {
        window.app.monthlySnapshots = [{ date: '2026-09-30', netWorth: 74000, totalAssets: 80000, totalLiabilities: 6000, incomeReceived: 0, debtPaymentMade: 0 }];
        window.app.switchPage('accounts');
        window.app.renderNetWorthWidget();
    }""")
    widget = page.inner_text('#netWorthWidget')
    assert 'Snapshot as of Sep 30, 2026' in widget
    assert '2026-09-30' not in widget


@pytest.mark.feature
def test_health_person_utilization_rows_are_labelled(app_page):
    page = app_page
    _seed_base(page, """() => {
        const app = window.app;
        app.persons = [{ id: 11, name: 'Alex' }];
        app.debts[0].personIds = [11];
        app.incomes[0].personId = 11;
    }""")
    _health_text(page)
    row = page.inner_text('.health-person-util-row')
    assert 'Alex' in row
    assert '40% utilized' in row  # 2000 / 5000
    assert 'DTI 2%' in row  # 80 / 4000


@pytest.mark.feature
def test_health_person_row_without_income_has_no_dti_label(app_page):
    page = app_page
    _seed_base(page, """() => {
        const app = window.app;
        app.persons = [{ id: 11, name: 'Alex' }];
        app.debts[0].personIds = [11];
    }""")
    _health_text(page)
    row = page.inner_text('.health-person-util-row')
    assert '40% utilized' in row
    assert 'DTI' not in row


@pytest.mark.feature
def test_mortgage_empty_housing_cost_shows_prompt_not_zero_percent(app_page):
    page = app_page
    _seed_base(page)
    _health_text(page)
    text = page.inner_text('#healthMortgageDtiPanel')
    assert text.count('Enter a housing cost') == 2
    assert '0.0%' not in text
    assert page.query_selector('#healthMortgageDtiPanel .health-badge') is None


@pytest.mark.feature
def test_mortgage_with_housing_cost_shows_ratios(app_page):
    page = app_page
    _seed_base(page)
    _health_text(page)
    page.evaluate("""() => {
        const inp = document.getElementById('healthHousingCostInput');
        inp.value = '1000'; inp.dispatchEvent(new Event('change'));
    }""")
    text = page.inner_text('#healthMortgageDtiPanel')
    assert '25.0%' in text
    assert 'Enter a housing cost' not in text


def _seed_overdue(page):
    today = date.today()
    mk = f"{today.year}-{today.month:02d}"

    def tpl(i, name, paid):
        return {
            "id": i, "name": name, "amount": 50, "frequency": "monthly", "dayOfMonth": 1, "type": "subscription",
            "category": "Bills", "accountId": 7001, "startDate": f"{today.year}-01-01", "paused": False,
            "archived": False, "skippedMonths": [], "paidMonths": [mk] if paid else []}

    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [{{ id: 7001, name: 'Checking', type: 'Checking', startingBalance: 1000 }}];
        app.recurringTemplates = {json.dumps([tpl(1, 'LateOne', False), tpl(2, 'PaidOne', True)])};
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.switchPage('recurring');
    }}""")
    page.wait_for_selector('#recurringOverdueFilterBtn', timeout=5000)


@pytest.mark.feature
def test_recurring_overdue_is_filter_with_helper_text(app_page):
    if date.today().day <= 1:
        pytest.skip("Cannot test overdue on the 1st")
    page = app_page
    _seed_overdue(page)
    assert "isn't marked paid or skipped" in page.inner_text('#recurringOverdueHelp')
    assert page.get_attribute('#recurringOverdueFilterBtn', 'aria-pressed') == 'false'
    listing = page.inner_text('#recurringList')
    assert 'LateOne' in listing and 'PaidOne' in listing
    page.click('#recurringOverdueFilterBtn')
    assert page.get_attribute('#recurringOverdueFilterBtn', 'aria-pressed') == 'true'
    listing = page.inner_text('#recurringList')
    assert 'LateOne' in listing and 'PaidOne' not in listing
    page.click('#recurringOverdueFilterBtn')
    assert 'PaidOne' in page.inner_text('#recurringList')


@pytest.mark.feature
def test_recurring_no_overdue_means_no_filter_button(app_page):
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 7001, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.recurringTemplates = []; app._recurringOverdueOnly = true;
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.switchPage('recurring');
    }""")
    assert page.query_selector('#recurringOverdueFilterBtn') is None
    assert page.query_selector('#recurringOverdueHelp') is None


def _plan(page, debt_data):
    create_debt(page, debt_data)
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#strategySection.active', timeout=5000)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)


@pytest.mark.feature
def test_whatif_slider_shows_headline_and_none_at_zero(app_page, debt_data):
    page = app_page
    _plan(page, debt_data)
    assert page.query_selector('#whatifHeadline') is None
    page.eval_on_selector('#whatifSlider', "el => { el.value = 100; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.wait_for_selector('#whatifHeadline', timeout=3000)
    text = page.inner_text('#whatifHeadline')
    assert re.match(r'Saves \$[\d,]+\.\d\d interest · \d+ months? sooner', text), text
    page.eval_on_selector('#whatifSlider', "el => { el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.wait_for_function("() => !document.getElementById('whatifHeadline')", timeout=3000)
    assert 'Saves' not in page.inner_text('#whatifResult')
