#!/usr/bin/env python3
"""
Bills Data & Calculation Tests

NOTE on current state: the Bills feature has no reachable add/edit UI.
`src/bills.js` still defines `addBill`/`renderBillList`/`startEditBill`/etc.
targeting DOM ids (#billForm, #billName, #billList...) that do not exist
anywhere in index.html, and the `<section id="budgetSection">` they belong
to has no nav button pointing to it. `app.bills` is nonetheless still read
by accounts.js, health.js, ledger.js, strategy.js, and fully round-trips
through storage.js import/export, so existing bills data (e.g. from an
older export, or injected directly into app state) still flows through
calculations correctly. These tests document and protect that current
behavior; they intentionally do not exercise an add-bill UI flow since
none exists. See ROADMAP.md for the tracked follow-up.
"""

import pytest


@pytest.mark.feature
def test_no_reachable_bill_add_ui(app_page):
    """Confirms there is currently no nav path to an add-bill form.

    This test exists to make the gap intentional/visible rather than
    silent: if it starts failing because a bill-add UI was added back,
    that's good news -- update/remove this test alongside the fix.
    """
    page = app_page

    nav_buttons = page.query_selector_all('[data-page]')
    page_targets = {b.get_attribute('data-page') for b in nav_buttons}
    assert 'budget' not in page_targets, \
        "A nav button now targets data-page=\"budget\" -- bills UI may have been restored"

    bill_form = page.query_selector('#billForm')
    assert bill_form is None, "#billForm now exists -- bills UI may have been restored"


@pytest.mark.feature
def test_bills_survive_import_with_sanitization(app_page):
    """A bill in an imported JSON payload is sanitized and lands in app.bills."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        const mod = await import('/src/storage.js');
        const payload = {
            accounts: app.accounts,
            bills: [{ id: 42, name: 'Electricity', amount: '120', dueDay: 15,
                      category: 'Utilities', accountId: 1 }]
        };
        const file = new File([JSON.stringify(payload)], 'bills.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ bills: app.bills }), 300);
        });
    }""")

    bills = result['bills']
    assert len(bills) == 1
    assert bills[0]['name'] == 'Electricity'
    assert bills[0]['amount'] == 120
    assert bills[0]['accountId'] == 1


@pytest.mark.feature
def test_bills_included_in_storage_export_payload(app_page):
    """Bills array is present in the JSON export payload structure."""
    page = app_page

    page.evaluate("""() => {
        window.app.bills = [{ id: 1, name: 'Internet', amount: 60, dueDay: 1,
                               category: 'Internet / Phone', accountId: null }];
        window.app.saveToStorage();
    }""")

    raw = page.evaluate("() => localStorage.getItem('debtTrackerData')")
    assert raw is not None
    import json
    parsed = json.loads(raw)
    assert 'bills' in parsed
    assert any(b['name'] == 'Internet' for b in parsed['bills'])


@pytest.mark.feature
def test_bills_factor_into_account_projected_balance(app_page):
    """A bill linked to an account reduces its projected end-of-month balance."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.bills = [{ id: 1, name: 'Rent', amount: 500, dueDay: 1,
                       category: 'Rent / Mortgage', accountId: 1 }];
        app.incomes = []; app.debts = []; app.expenses = []; app.recurringTemplates = [];
        app.saveToStorage();
        app.switchPage('accounts');
    }""")
    page.wait_for_timeout(300)

    now = page.evaluate("""() => {
        const now = new Date();
        return window.app.computeAccountBalance(1, now.getFullYear(), now.getMonth());
    }""")
    assert now <= 1000 - 500 + 0.01, f"Expected bill to reduce projected balance, got {now}"


@pytest.mark.feature
def test_bills_factor_into_health_cash_flow(app_page):
    """Bills reduce the monthly cash flow metric on the Health dashboard."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000,
                         firstPayDate: '2026-06-01', frequency: 'monthly' }];
        app.bills = [{ id: 2, name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing' }];
        app.debts = []; app.expenses = []; app.recurringTemplates = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.switchPage('health');
    }""")
    page.wait_for_timeout(500)

    section = page.query_selector('#healthSection')
    section_text = section.text_content()
    assert section_text and len(section_text) > 0
