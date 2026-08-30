"""
Tests for issue #93: Liabilities (expenses) don't always save.

Root cause: addExpense and saveEditExpense stored expense.date as a Date
object, which JSON.stringify serialised as a full UTC ISO timestamp
(e.g. "2026-08-30T05:00:00.000Z"). On reload sanitizeDateISO rejected
the timestamp because its regex only accepted bare YYYY-MM-DD strings,
so the date became null and sanitizeParsedState's !!e.date filter
silently dropped every expense.

Positive tests verify the happy path end-to-end; negative tests verify
validation guards at the form boundary and that the self-healing path
handles already-corrupted localStorage records.
"""

import pytest


# ───────────────────────────── helpers ────────────────────────────────

def _navigate_to_expenses(page):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="expenses"]')
    page.wait_for_selector('#expensesPanel', state='visible')


def _add_expense_via_ui(page, name="Groceries", amount="250.00", date="2026-09-01"):
    _navigate_to_expenses(page)
    page.click('#expenseFormToggle')
    page.wait_for_selector('#expenseFormBody:not([hidden])')
    page.fill('#expenseName', name)
    page.fill('#expenseBudget', amount)
    page.fill('#expenseDate', date)
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(300)


# ─────────────────────────── positive tests ───────────────────────────

@pytest.mark.feature
def test_expense_appears_on_screen_after_add(app_page):
    """An expense added via the form appears in the expense list immediately."""
    page = app_page
    _add_expense_via_ui(page, name="Groceries", amount="250.00", date="2026-09-01")
    assert page.query_selector('text=Groceries'), "Expense should render in the list right after add"


@pytest.mark.feature
def test_expense_written_to_localstorage_immediately(app_page):
    """addExpense writes the expense to localStorage before the page reloads."""
    page = app_page
    _add_expense_via_ui(page, name="Dining Out", amount="80.00", date="2026-09-15")

    in_storage = page.evaluate("""(name) => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        return (d.expenses || []).some(e => e.name === name);
    }""", "Dining Out")

    assert in_storage, "Expense should be present in localStorage immediately after add"


@pytest.mark.feature
def test_expense_survives_page_reload(app_page):
    """An expense added via the UI is still present after a full page reload (issue #93)."""
    page = app_page
    _add_expense_via_ui(page, name="Utilities", amount="120.00", date="2026-10-01")

    page.reload(wait_until="networkidle")
    _navigate_to_expenses(page)
    page.wait_for_timeout(400)

    assert page.query_selector('text=Utilities'), \
        "Expense should survive a page reload (was silently dropped by date sanitisation bug)"


@pytest.mark.feature
def test_expense_date_stored_as_iso_string(app_page):
    """addExpense stores date as a YYYY-MM-DD string, not a Date object."""
    page = app_page
    _add_expense_via_ui(page, name="Phone Bill", amount="55.00", date="2026-11-05")

    raw_date = page.evaluate("""(name) => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        const exp = (d.expenses || []).find(e => e.name === name);
        return exp ? exp.date : null;
    }""", "Phone Bill")

    assert raw_date == "2026-11-05", \
        f"Stored date should be bare ISO string '2026-11-05', got: {repr(raw_date)}"


@pytest.mark.feature
def test_self_healing_corrupted_utc_date_on_reload(app_page):
    """
    Expenses already in localStorage with a full UTC ISO timestamp date
    (the pre-fix format from Date.toISOString()) are healed on the next
    load by the updated sanitizeDateISO and still appear in the list.
    """
    page = app_page

    page.evaluate("""() => {
        const key = 'debtTrackerData';
        const d = JSON.parse(localStorage.getItem(key) || '{}');
        d.expenses = [{
            id: 9999, name: 'Legacy Corrupted', budgetAmount: 99,
            date: '2026-08-30T05:00:00.000Z',
            category: 'Other', accountId: null
        }];
        localStorage.setItem(key, JSON.stringify(d));
    }""")

    page.reload(wait_until="networkidle")
    _navigate_to_expenses(page)
    page.wait_for_timeout(400)

    assert page.query_selector('text=Legacy Corrupted'), \
        "Expense with corrupted UTC date should survive reload after self-healing fix"


@pytest.mark.feature
def test_edited_expense_date_survives_reload(app_page):
    """Editing an expense via inline edit also stores date as an ISO string."""
    page = app_page
    _add_expense_via_ui(page, name="Car Insurance", amount="180.00", date="2026-09-20")

    expense_id = page.evaluate(
        "(name) => window.app.expenses.find(e => e.name === name)?.id",
        "Car Insurance"
    )

    if expense_id:
        page.evaluate(f"() => window.app.startEditExpense({expense_id})")
        page.wait_for_timeout(200)
        page.fill(f'#ee-date-{expense_id}', '2026-10-20')
        page.evaluate(f"() => window.app.saveEditExpense({expense_id})")
        page.wait_for_timeout(200)

    page.reload(wait_until="networkidle")
    _navigate_to_expenses(page)
    page.wait_for_timeout(400)

    assert page.query_selector('text=Car Insurance'), \
        "Edited expense should survive reload after date edit"


# ─────────────────────────── negative tests ───────────────────────────

@pytest.mark.feature
def test_expense_add_rejected_when_name_empty(app_page):
    """The form rejects submission when expense name is empty."""
    page = app_page
    _navigate_to_expenses(page)
    page.click('#expenseFormToggle')
    page.wait_for_selector('#expenseFormBody:not([hidden])')
    page.fill('#expenseBudget', '50.00')
    page.fill('#expenseDate', '2026-09-01')

    initial_count = page.evaluate("() => window.app.expenses.length")
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(200)

    assert page.evaluate("() => window.app.expenses.length") == initial_count, \
        "Expense should not be added when name is empty"


@pytest.mark.feature
def test_expense_add_rejected_when_date_empty(app_page):
    """The form rejects submission when the date field is empty."""
    page = app_page
    _navigate_to_expenses(page)
    page.click('#expenseFormToggle')
    page.wait_for_selector('#expenseFormBody:not([hidden])')
    page.fill('#expenseName', 'No Date Expense')
    page.fill('#expenseBudget', '75.00')
    # Explicitly clear any browser- or app-set default on the date field
    page.evaluate("() => { document.getElementById('expenseDate').value = ''; }")

    initial_count = page.evaluate("() => window.app.expenses.length")
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(200)

    assert page.evaluate("() => window.app.expenses.length") == initial_count, \
        "Expense should not be added when date is empty"


@pytest.mark.feature
def test_expense_add_rejected_when_amount_negative(app_page):
    """The form rejects submission when the budget amount is negative."""
    page = app_page
    _navigate_to_expenses(page)
    page.click('#expenseFormToggle')
    page.wait_for_selector('#expenseFormBody:not([hidden])')
    page.fill('#expenseName', 'Bad Amount')
    page.fill('#expenseBudget', '-50')
    page.fill('#expenseDate', '2026-09-01')

    initial_count = page.evaluate("() => window.app.expenses.length")
    page.click('#expenseFormSubmit')
    page.wait_for_timeout(200)

    assert page.evaluate("() => window.app.expenses.length") == initial_count, \
        "Expense should not be added when amount is negative"


@pytest.mark.feature
def test_corrupted_expense_with_null_date_is_dropped(app_page):
    """
    An expense with a completely unrecoverable date is filtered out on reload
    rather than crashing or rendering garbled data.
    """
    page = app_page

    page.evaluate("""() => {
        const key = 'debtTrackerData';
        const d = JSON.parse(localStorage.getItem(key) || '{}');
        d.expenses = [
            { id: 1, name: 'Good Expense', budgetAmount: 50, date: '2026-08-01', category: 'Other' },
            { id: 2, name: 'Null Date Expense', budgetAmount: 50, date: null, category: 'Other' }
        ];
        localStorage.setItem(key, JSON.stringify(d));
    }""")

    page.reload(wait_until="networkidle")
    _navigate_to_expenses(page)
    page.wait_for_timeout(400)

    counts = page.evaluate("""() => ({
        good: window.app.expenses.filter(e => e.name === 'Good Expense').length,
        bad: window.app.expenses.filter(e => e.name === 'Null Date Expense').length
    })""")

    assert counts['good'] == 1, "Valid expense should be loaded"
    assert counts['bad'] == 0, "Expense with null date should be dropped by sanitiser filter"