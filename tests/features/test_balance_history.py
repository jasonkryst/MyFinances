#!/usr/bin/env python3
"""
Balance history tests — debts and Credit Card / Loan accounts.
See docs/superpowers/specs/2026-09-28-balance-history-design.md.
"""
import json
import pytest

from tests.conftest import assert_no_errors, create_debt


def _reload_app(page):
    page.reload(wait_until="networkidle")
    page.wait_for_function("() => window.app && window.app._currentPage === 'health'", timeout=15000)


def _history(page):
    return page.evaluate("() => window.app.balanceHistory")


@pytest.mark.feature
def test_legacy_data_is_seeded_on_load(app_page):
    """Stored data with no balanceHistory gets entries seeded for debts and tracked accounts."""
    page = app_page
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({
            debts: [
                { id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 800, minimumPayment: 30,
                  originalBalance: 1000, originalMinimumPayment: 40, debtStartDate: '2026-01-15', updatedAt: '2026-09-01',
                  interestRate: 20, dueDate: 5 },
                { id: 2, name: 'Daycare', debtType: 'fixedAmount', fixedAmount: 900, minimumPayment: 900,
                  fixedStartDate: '2026-01-01', fixedEndDate: '2027-01-01', updatedAt: '2026-09-01' }
            ],
            accounts: [
                { id: 7, name: 'Car Loan', type: 'Loan', startingBalance: -9000, minimumPayment: 210 },
                { id: 8, name: 'Checking', type: 'Checking', startingBalance: 500 }
            ]
        }));
    }""")
    _reload_app(page)
    history = _history(page)
    visa = sorted([h for h in history if h['debtId'] == 1], key=lambda h: h['date'])
    assert [(h['date'], h['balance'], h['minimumPayment']) for h in visa] == [
        ('2026-01-15', 1000, 40), ('2026-09-01', 800, 30)]
    daycare = [h for h in history if h['debtId'] == 2]
    assert len(daycare) == 1 and daycare[0]['balance'] is None and daycare[0]['minimumPayment'] == 900
    loan = [h for h in history if h['accountId'] == 7]
    assert len(loan) == 1 and loan[0]['balance'] == -9000 and loan[0]['minimumPayment'] == 210
    assert not [h for h in history if h['accountId'] == 8]


@pytest.mark.feature
def test_seeding_is_idempotent_and_history_persists(app_page):
    page = app_page
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({
            debts: [{ id: 1, name: 'Visa', debtType: 'creditCard', accountBalance: 800, minimumPayment: 30, interestRate: 20, dueDate: 5 }]
        }));
    }""")
    _reload_app(page)
    first = _history(page)
    assert len(first) == 1
    _reload_app(page)
    assert _history(page) == first


@pytest.mark.feature
def test_clear_all_data_resets_history(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.balanceHistory = [{ id: 1, debtId: 1, accountId: null, date: '2026-09-01', balance: 1, minimumPayment: 1 }];
        window.app.saveToStorage();
    }""")
    page.evaluate("() => import('/src/storage.js').then(m => m.clearAllData(window.app))")
    assert _history(page) == []
