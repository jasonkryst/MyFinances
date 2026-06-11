#!/usr/bin/env python3
"""
Cash Flow Forecasting Tests
Tests the Forecast tab on the Reports page: tab/panel wiring, empty state,
controls, summary stats, chart, table, negative-balance warning, notable
months, account selection, and horizon switching.
"""

import pytest

BASE_URL = "http://localhost:5500/"


@pytest.mark.feature
def test_forecast_tab_exists(app_page):
    """Forecast tab button and panel exist in the Reports page tab bar."""
    page = app_page

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)

    tab = page.query_selector('[data-rptab="forecast"]')
    assert tab, "Forecast tab button not found"

    tab.click()
    page.wait_for_timeout(300)

    panel = page.query_selector('#rptPanel-forecast')
    assert panel and panel.evaluate('(el) => el.offsetParent !== null'), \
        "Forecast panel should be visible after clicking its tab"


@pytest.mark.feature
def test_forecast_empty_state_with_no_accounts(app_page):
    """Forecast tab shows an empty state when there are no asset-type accounts."""
    page = app_page

    page.evaluate("""() => {
        window.app.accounts = [];
        window.app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Go to Accounts' in section_text, \
        "Expected empty-state message directing to Accounts page"


@pytest.mark.feature
def test_forecast_default_render_with_account(app_page):
    """Default 1-month/Total view renders controls, chart, summary, and one table row."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, firstPayDate: '2026-01-01', frequency: 'monthly', accountId: 9001 }];
        app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section = page.query_selector('#reportsCashFlowForecast')
    assert section.query_selector('.cf-controls'), "Forecast controls not rendered"
    assert section.query_selector('#cfForecastChart'), "Forecast chart canvas not rendered"

    rows = section.query_selector_all('.nw-history-table tbody tr')
    assert len(rows) == 1, f"Expected 1 table row for default 1-month horizon, got {len(rows)}"

    section_text = section.text_content()
    assert '$5,000.00' in section_text, "Expected current balance ($5,000.00) in summary"
    assert '$8,000.00' in section_text, "Expected projected balance ($5,000 + $3,000 income) in summary/table"


@pytest.mark.feature
def test_forecast_account_dropdown_excludes_liabilities(app_page):
    """Account dropdown lists Total Cash Position and asset accounts, excluding Credit Card/Loan."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 },
            { id: 9002, name: 'Visa', type: 'Credit Card', startingBalance: -1000 }
        ];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    options = page.query_selector_all('#forecastAccountSelect option')
    option_texts = [o.text_content() for o in options]
    assert 'Total Cash Position' in option_texts
    assert 'Checking' in option_texts
    assert 'Visa' not in option_texts


@pytest.mark.feature
def test_forecast_account_selector_switches_view(app_page):
    """Selecting a specific account updates the Current Balance stat."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 },
            { id: 9002, name: 'Savings', type: 'Savings', startingBalance: 2000 }
        ];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert '$7,000.00' in section_text, "Total Cash Position should sum both accounts (5000 + 2000)"

    page.select_option('#forecastAccountSelect', label='Checking')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert '$5,000.00' in section_text, "Selecting Checking should show its balance alone"
    assert '$7,000.00' not in section_text, "Total should no longer be shown after selecting an account"


@pytest.mark.feature
def test_forecast_negative_balance_warning(app_page):
    """A projected negative balance shows a warning banner and highlights the table row."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 100 }];
        app.bills = [{ id: 10, name: 'Rent', amount: 500, dueDay: 1, category: 'Housing', accountId: 9001 }];
        app.incomes = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section = page.query_selector('#reportsCashFlowForecast')
    section_text = section.text_content()
    assert 'Projected to go negative' in section_text
    assert '-$400.00' in section_text, "Expected projected balance of -$400.00 (100 - 500)"
    assert section.query_selector('.cf-row--negative'), "Expected a negative-balance row in the table"
    assert 'Dips to' not in section_text, \
        "No separate intra-month dip note expected when the low equals the ending balance"


@pytest.mark.feature
def test_forecast_intramonth_dip_warning_when_recovers(app_page):
    """A bill early in the month can push the balance negative even though
    income later in the month brings it back positive by month-end. The
    forecast should surface this intra-month low, not just the ending balance."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const targetMonths = now.getMonth() + 1;
        const year = now.getFullYear() + Math.floor(targetMonths / 12);
        const month = targetMonths % 12;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-15`;

        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.bills = [{ id: 10, name: 'Rent', amount: 1800, dueDay: 1, category: 'Housing', accountId: 9001 }];
        app.incomes = [{ id: 1, name: 'Paycheck', amount: 2000, firstPayDate: dateStr, frequency: 'monthly', accountId: 9001 }];
        app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 1;
        app._forecastAccountId = 'total';
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Projected to dip negative' in section_text, "Expected an intra-month dip warning"
    assert 'before recovering' in section_text
    assert '-$800.00' in section_text, "Expected the intra-month low of -$800.00 (1000 - 1800)"
    assert '$1,200.00' in section_text, "Expected the recovered ending balance of $1,200.00 (-800 + 2000)"


@pytest.mark.feature
def test_forecast_total_view_intramonth_dip_across_accounts(app_page):
    """The Total Cash Position's intra-month low must be computed by merging
    every account's transactions chronologically, not by summing each
    account's individual low (which can occur on different days)."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const targetMonths = now.getMonth() + 1;
        const year = now.getFullYear() + Math.floor(targetMonths / 12);
        const month = targetMonths % 12;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-20`;

        app.accounts = [
            { id: 9001, name: 'Checking', type: 'Checking', startingBalance: 1000 },
            { id: 9002, name: 'Savings', type: 'Savings', startingBalance: 500 }
        ];
        app.bills = [{ id: 10, name: 'Rent', amount: 1800, dueDay: 1, category: 'Housing', accountId: 9001 }];
        app.incomes = [{ id: 1, name: 'Bonus Payout', amount: 2000, firstPayDate: dateStr, frequency: 'monthly', accountId: 9002 }];
        app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 1;
        app._forecastAccountId = 'total';
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Projected to dip negative' in section_text, "Expected the combined total to dip negative on the 1st"
    assert 'before recovering' in section_text
    assert '-$300.00' in section_text, "Expected the combined intra-month low of -$300.00 (1500 - 1800)"
    assert '$1,700.00' in section_text, "Expected the recovered ending balance of $1,700.00 (-300 + 2000)"


@pytest.mark.feature
def test_forecast_no_dip_when_balance_monotonic(app_page):
    """When income only increases the balance during the month, no
    intra-month dip indicators should be shown."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, firstPayDate: '2026-01-01', frequency: 'monthly', accountId: 9001 }];
        app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 1;
        app._forecastAccountId = 'total';
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Dips to' not in section_text
    assert 'Projected to dip negative' not in section_text


@pytest.mark.feature
def test_forecast_income_only_months_no_notable_drivers(app_page):
    """When every projected month has zero outflow, no notable-month drivers
    are shown and the projected balance simply accumulates income."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9003, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 1, name: 'Salary', amount: 500, firstPayDate: '2026-01-01', frequency: 'monthly', accountId: 9003 }];
        app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 6;
        app._forecastAccountId = 'total';
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Driven by' not in section_text, "No notable-month drivers should appear when there is no outflow"
    assert 'NaN' not in section_text and 'Infinity' not in section_text, \
        "Forecast should not produce NaN/Infinity with zero outflow"

    rows = page.query_selector_all('#reportsCashFlowForecast .nw-history-table tbody tr')
    assert len(rows) == 6, f"Expected 6 rows for a 6-month horizon, got {len(rows)}"

    assert '$4,000.00' in section_text, "Expected ending balance of $4,000 after 6 months of $500 income"


@pytest.mark.feature
def test_forecast_total_view_sums_multiple_accounts_over_horizon(app_page):
    """The Total Cash Position series sums each account's projected balance
    across a multi-month horizon, and switching to a single account shows
    that account's balance alone."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [
            { id: 9101, name: 'Checking', type: 'Checking', startingBalance: 1000 },
            { id: 9102, name: 'Savings', type: 'Savings', startingBalance: 2000 }
        ];
        app.incomes = [
            { id: 1, name: 'Salary', amount: 500, firstPayDate: '2026-01-01', frequency: 'monthly', accountId: 9101 },
            { id: 2, name: 'Interest', amount: 100, firstPayDate: '2026-01-05', frequency: 'monthly', accountId: 9102 }
        ];
        app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 3;
        app._forecastAccountId = 'total';
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    # Total view: (1000 + 2000) starting + 3 months * (500 + 100) income = 4800
    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert '$4,800.00' in section_text, "Expected combined ending balance of $4,800.00 across both accounts"

    # Switch to Checking only and verify its individual ending balance
    page.select_option('#forecastAccountSelect', label='Checking')
    page.wait_for_timeout(300)
    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert '$2,500.00' in section_text, "Expected Checking ending balance of $2,500.00 (1000 + 3*500)"


@pytest.mark.feature
def test_forecast_notable_month_shows_drivers(app_page):
    """A month with unusually high outflow is flagged with its top spending drivers."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const targetMonths = now.getMonth() + 3;
        const year = now.getFullYear() + Math.floor(targetMonths / 12);
        const month = targetMonths % 12;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-15`;

        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 10000 }];
        app.bills = [{ id: 10, name: 'Subscription', amount: 100, dueDay: 1, category: 'Other', accountId: 9001 }];
        app.expenses = [{ id: 20, name: 'Property Tax', budgetAmount: 1200, date: dateStr, category: 'Other', accountId: 9001 }];
        app.incomes = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 6;
        app._forecastAccountId = 'total';
        app._forecastNotableThresholdPct = 130;
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Driven by' in section_text, "Expected a notable-month driver row"
    assert 'Property Tax' in section_text, "Expected Property Tax listed as a driver"
    assert '$1,200.00' in section_text, "Expected Property Tax amount in drivers"


@pytest.mark.feature
def test_forecast_threshold_input_updates_notable_months(app_page):
    """Changing the notable-month threshold input updates which months show 'Driven by' drivers."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        const now = new Date();
        const targetMonths = now.getMonth() + 3;
        const year = now.getFullYear() + Math.floor(targetMonths / 12);
        const month = targetMonths % 12;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-15`;

        app.accounts = [{ id: 9002, name: 'Checking', type: 'Checking', startingBalance: 10000 }];
        app.bills = [{ id: 11, name: 'Subscription', amount: 100, dueDay: 1, category: 'Other', accountId: 9002 }];
        app.expenses = [{ id: 21, name: 'Property Tax', budgetAmount: 1200, date: dateStr, category: 'Other', accountId: 9002 }];
        app.incomes = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 6;
        app._forecastAccountId = 'total';
        delete app._forecastNotableThresholdPct;
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Driven by' in section_text, "Expected a notable-month driver row at the default threshold"

    page.fill('#forecastThresholdInput', '500')
    page.dispatch_event('#forecastThresholdInput', 'change')
    page.wait_for_timeout(300)

    section_text = page.query_selector('#reportsCashFlowForecast').text_content()
    assert 'Driven by' not in section_text, "Raising the threshold to 500% should clear the notable-month row"

    threshold_value = page.evaluate('() => window.app._forecastNotableThresholdPct')
    assert threshold_value == 500, "App state should reflect the updated threshold from the input"


@pytest.mark.feature
def test_forecast_horizon_button_changes_table_rows(app_page):
    """Clicking a horizon button changes the number of table rows."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    rows = page.query_selector_all('#reportsCashFlowForecast .nw-history-table tbody tr')
    assert len(rows) == 1, f"Expected 1 row for default 1-month horizon, got {len(rows)}"

    page.click('[data-forecast-range="6"]')
    page.wait_for_timeout(300)

    rows = page.query_selector_all('#reportsCashFlowForecast .nw-history-table tbody tr')
    assert len(rows) == 6, f"Expected 6 rows after selecting 6-month horizon, got {len(rows)}"

    active_btn = page.query_selector('[data-forecast-range="6"].active')
    assert active_btn, "6-month horizon button should be marked active"


@pytest.mark.feature
def test_forecast_settings_persist_after_reload(app_page):
    """Forecast horizon and notable threshold settings persist across a page reload."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app.saveToStorage();
        app.switchPage('reports');
    }""")
    page.wait_for_timeout(300)

    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    page.click('[data-forecast-range="3"]')
    page.wait_for_timeout(300)

    page.fill('#forecastThresholdInput', '200')
    page.dispatch_event('#forecastThresholdInput', 'change')
    page.wait_for_timeout(300)

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(500)

    page.click('button[data-page="reports"]')
    page.wait_for_timeout(300)
    page.click('[data-rptab="forecast"]')
    page.wait_for_timeout(300)

    active_btn = page.query_selector('[data-forecast-range="3"].active')
    assert active_btn, "3-month horizon should remain selected after reload"

    threshold_value = page.input_value('#forecastThresholdInput')
    assert threshold_value == '200', f"Expected threshold 200 to persist, got {threshold_value}"


@pytest.mark.feature
def test_forecast_settings_export_import_roundtrip(app_page):
    """forecastSettings round-trips through importAllJSON."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 9001, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
        app.incomes = []; app.bills = []; app.expenses = []; app.debts = [];
        app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
        app._forecastRangeMonths = 12;
        app._forecastAccountId = 'total';
        app._forecastNotableThresholdPct = 250;
        app.saveToStorage();
    }""")
    page.wait_for_timeout(300)

    result = page.evaluate("""async () => {
        const app = window.app;
        const payload = {
            version: '3.0',
            accounts: app.accounts,
            debts: [],
            incomes: [{ id: 1, name: 'Salary', amount: 1000, firstPayDate: '2026-01-01', frequency: 'monthly' }],
            bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            forecastSettings: { rangeMonths: 3, accountId: 'total', notableThresholdPct: 175 }
        };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });

        return new Promise(resolve => {
            app.importAllJSON(file);
            setTimeout(() => {
                resolve({
                    rangeMonths: app._forecastRangeMonths,
                    accountId: app._forecastAccountId,
                    notableThresholdPct: app._forecastNotableThresholdPct
                });
            }, 300);
        });
    }""")

    assert result['rangeMonths'] == 3
    assert result['accountId'] == 'total'
    assert result['notableThresholdPct'] == 175
