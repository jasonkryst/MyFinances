#!/usr/bin/env python3
"""
Year in review (issue #689): a Reports tab summing up one calendar year as
short observations. Real events ("What happened") come before planned ones
("From your plan"), and the tab has its own year stepper.
"""

from datetime import date, timedelta

from tests.conftest import assert_no_errors, seed_state

TODAY = date.today()
YEAR = TODAY.year
ACCOUNT = {"id": 9701, "name": "YR Checking", "type": "Checking", "startingBalance": 2000}
DEBT = {"id": 9711, "name": "YR Visa", "debtType": "creditCard", "accountBalance": 3000,
        "minimumPayment": 100, "interestRate": 18, "accountId": ACCOUNT["id"], "dueDate": 5}


def _open_tab(page, tab="yearreview"):
    page.evaluate("""async (tab) => {
        window.app.switchPage('reports');
        document.getElementById('rptTab-' + tab).click();
        await window.app.renderReportsPage();
    }""", tab)


def _seed_year(page):
    debt_id = DEBT["id"]
    seed_state(page, {
        "accounts": [ACCOUNT],
        "debts": [DEBT],
        "balanceHistory": [
            {"id": 1, "debtId": debt_id, "date": date(YEAR - 1, 12, 1).isoformat(), "balance": 5000, "minimumPayment": 100},
            {"id": 2, "debtId": debt_id, "date": TODAY.isoformat(), "balance": 3000, "minimumPayment": 100},
        ],
        "incomes": [{"id": 9721, "name": "YR Salary", "amount": 4000, "frequency": "monthly",
                     "firstPayDate": date(YEAR - 1, 1, 3).isoformat(), "accountId": ACCOUNT["id"]}],
        "recurringTemplates": [{"id": 9731, "name": "YR Streaming", "type": "subscription", "amount": 20,
                                "frequency": "monthly", "dayOfMonth": 1, "category": "Subscriptions",
                                "accountId": ACCOUNT["id"], "startDate": date(YEAR - 1, 1, 1).isoformat()}],
    })


def test_year_review_renders_actual_then_planned(app_page):
    page = app_page
    _seed_year(page)
    _open_tab(page)
    page.wait_for_selector("#yrActual li")
    actual = page.inner_text("#yrActual")
    assert "2,000" in actual, actual  # paid down 5000 -> 3000
    assert page.locator("#yrPlanned li").count() > 0
    order = page.evaluate("""() => {
        const a = document.getElementById('yrActual'), p = document.getElementById('yrPlanned');
        return !!(a.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
    }""")
    assert order, "What happened must come before From your plan"
    assert_no_errors(page)


def test_year_review_year_stepper(app_page):
    page = app_page
    _seed_year(page)
    _open_tab(page)
    page.wait_for_selector("#yrYearLabel")
    assert page.is_disabled("#yrNextYear")
    assert str(YEAR) in page.inner_text("#yrYearLabel")
    page.click("#yrPrevYear")
    page.wait_for_function("(y) => document.getElementById('yrYearLabel').textContent.trim() === String(y)", arg=YEAR - 1)
    assert page.is_enabled("#yrNextYear")
    assert_no_errors(page)


def test_year_review_empty_state(app_page):
    page = app_page
    _open_tab(page)
    page.wait_for_selector("#yrEmpty", state="visible")
    assert page.is_disabled("#yrPrevYear")
    assert_no_errors(page)


def test_year_review_hides_month_nav(app_page):
    page = app_page
    _open_tab(page)
    page.wait_for_selector("#yrYearLabel")
    assert not page.is_visible("#rptPrevMonth")
    assert page.is_visible("#rptPrintBtn")
    _open_tab(page, "summary")
    page.wait_for_selector("#rptPrevMonth", state="visible")
    assert_no_errors(page)
