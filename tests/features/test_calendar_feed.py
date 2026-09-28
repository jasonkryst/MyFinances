"""
Tests for the Calendar Feed feature (issue #212).

Covers:
  - Positive: ICS download contains expected VCALENDAR structure
  - Positive: Events for bills, debts, recurring templates, and expenses appear
  - Positive: Paid months are excluded from the feed
  - Positive: Toolbar button opens the calendar feed modal
  - Negative: Empty app state produces a valid (but event-free) ICS
  - Negative: XSS / special characters in item names are escaped in ICS output
  - Negative: Items without a due date are skipped
"""

import pytest
from tests.conftest import assert_no_errors, BASE_URL


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _seed_calendar_data(page):
    """Seed one of each item type into app state via evaluate."""
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000, interestRate: 0 }];
        app.bills = [{ id: 101, name: 'Rent', amount: 1200, dueDay: 1, category: 'Rent / Mortgage', accountId: 1 }];
        app.debts = [{ id: 201, name: 'Visa Card', accountBalance: 5000, minimumPayment: 150,
                       interestRate: 19.99, dueDate: 15, category: 'Credit Card',
                       debtType: 'creditCard', accountId: 1, originalBalance: 5000 }];
        app.recurringTemplates = [{
            id: 301, name: 'Netflix', type: 'subscription', amount: 15.99,
            frequency: 'monthly', dayOfMonth: 5, category: 'Subscription',
            accountId: 1, targetAccountId: null, startDate: null, endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        // One-time expense this calendar month
        const today = new Date();
        app.expenses = [{
            id: 401, name: 'Car Repair', budgetAmount: 300, category: 'Transport',
            accountId: 1,
            date: new Date(today.getFullYear(), today.getMonth(), 10)
        }];
        app.saveToStorage();
    }""")


def _open_calendar_modal(page):
    page.click('#calendarFeedBtn')
    page.wait_for_selector('#calendarFeedModal:not(.hidden)', timeout=5000)


def _download_ics(page):
    """Open the modal and trigger the ICS download; return (content, download) tuple."""
    _open_calendar_modal(page)
    with page.expect_download() as dl_info:
        page.click('#calendarDownloadBtn')
    download = dl_info.value
    path = download.path()
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    return content, download


# ─── Positive tests ───────────────────────────────────────────────────────────

@pytest.mark.feature
def test_calendar_toolbar_button_opens_modal(app_page):
    """Toolbar calendar icon is present and clicking it shows the modal."""
    page = app_page
    assert page.is_visible('#calendarFeedBtn')
    page.click('#calendarFeedBtn')
    page.wait_for_selector('#calendarFeedModal:not(.hidden)', timeout=5000)
    assert page.is_visible('#calendarFeedModal')
    assert page.is_visible('#calendarDownloadBtn')
    assert_no_errors(page)


@pytest.mark.feature
def test_ics_download_has_valid_vcalendar_structure(app_page):
    """Downloaded .ics file starts with BEGIN:VCALENDAR and ends with END:VCALENDAR."""
    page = app_page
    _seed_calendar_data(page)
    content, download = _download_ics(page)

    assert download.suggested_filename.endswith('.ics')
    assert 'BEGIN:VCALENDAR' in content
    assert 'VERSION:2.0' in content
    assert 'PRODID:-//MyFinances//MyFinances Calendar Feed//EN' in content
    assert 'END:VCALENDAR' in content
    assert_no_errors(page)


@pytest.mark.feature
def test_ics_contains_bill_event(app_page):
    """A bill with a dueDay generates a 'Bill - Name' VEVENT in the feed."""
    page = app_page
    _seed_calendar_data(page)
    content, _ = _download_ics(page)

    assert 'BEGIN:VEVENT' in content
    assert 'SUMMARY:Bill - Rent' in content
    assert 'Amount Due: $1200.00' in content


@pytest.mark.feature
def test_ics_contains_debt_event(app_page):
    """A debt with a dueDate generates a 'Debt - Name' VEVENT."""
    page = app_page
    _seed_calendar_data(page)
    content, _ = _download_ics(page)

    assert 'SUMMARY:Debt - Visa Card' in content
    assert 'Amount Due: $150.00' in content


@pytest.mark.feature
def test_ics_contains_recurring_event(app_page):
    """A recurring subscription generates a 'Subscription - Name' VEVENT."""
    page = app_page
    _seed_calendar_data(page)
    content, _ = _download_ics(page)

    assert 'SUMMARY:Subscription - Netflix' in content
    assert 'Amount Due: $15.99' in content


@pytest.mark.feature
def test_ics_contains_expense_event(app_page):
    """A one-time expense generates an 'Expense - Name' VEVENT."""
    page = app_page
    _seed_calendar_data(page)
    content, _ = _download_ics(page)

    assert 'SUMMARY:Expense - Car Repair' in content


@pytest.mark.feature
def test_ics_events_are_all_day(app_page):
    """All events use RFC 5545 DATE value type (all-day, no time component)."""
    page = app_page
    _seed_calendar_data(page)
    content, _ = _download_ics(page)

    assert 'DTSTART;VALUE=DATE:' in content
    assert 'DTEND;VALUE=DATE:' in content
    # No time component — these must not appear
    assert 'T090000' not in content
    assert 'T100000' not in content


@pytest.mark.feature
def test_ics_description_includes_app_link(app_page):
    """Each event description contains a 'View in MyFinances:' link to the app root."""
    page = app_page
    _seed_calendar_data(page)
    content, _ = _download_ics(page)

    assert 'View in MyFinances:' in content
    # The link must include the origin (http://localhost:32900 in test env)
    assert 'localhost' in content


@pytest.mark.feature
def test_ics_includes_account_name_in_description(app_page):
    """Description includes 'Account: <name>' when an account is linked."""
    page = app_page
    _seed_calendar_data(page)
    content, _ = _download_ics(page)

    assert 'Account: Checking' in content


@pytest.mark.feature
def test_paid_months_excluded_from_feed(app_page):
    """Recurring items whose current month is in paidMonths are not emitted."""
    page = app_page
    from datetime import date
    today = date.today()
    paid_month = f"{today.year}-{str(today.month).zfill(2)}"

    page.evaluate(f"""() => {{
        const app = window.app;
        app.accounts = [];
        app.bills = [];
        app.debts = [];
        app.expenses = [];
        app.recurringTemplates = [{{
            id: 999, name: 'PaidSub', type: 'subscription', amount: 9.99,
            frequency: 'monthly', dayOfMonth: 10, category: 'Other',
            accountId: null, targetAccountId: null, startDate: null, endDate: null,
            paused: false, skippedMonths: [], paidMonths: ['{paid_month}']
        }}];
        app.saveToStorage();
    }}""")
    content, _ = _download_ics(page)

    # The event for the current month should not appear (paid)
    assert 'SUMMARY:Subscription - PaidSub' not in content


@pytest.mark.feature
def test_empty_app_state_produces_valid_ics(app_page):
    """With no data at all the ICS is still structurally valid (no events)."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.bills = [];
        app.debts = [];
        app.recurringTemplates = [];
        app.expenses = [];
        app.saveToStorage();
    }""")
    content, download = _download_ics(page)

    assert 'BEGIN:VCALENDAR' in content
    assert 'END:VCALENDAR' in content
    assert 'BEGIN:VEVENT' not in content
    assert_no_errors(page)


@pytest.mark.feature
def test_modal_closes_on_escape(app_page):
    """Pressing Escape while the calendar modal is open closes it."""
    page = app_page
    _open_calendar_modal(page)
    page.keyboard.press('Escape')
    page.wait_for_selector('#calendarFeedModal.hidden', timeout=3000)
    assert not page.is_visible('#calendarFeedModal')


# ─── Negative / edge-case tests ───────────────────────────────────────────────

@pytest.mark.feature
def test_bill_without_due_day_is_skipped(app_page):
    """A bill with dueDay=null produces no VEVENT."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.bills = [{ id: 1, name: 'NoDayBill', amount: 50, dueDay: null, category: 'Other', accountId: null }];
        app.debts = [];
        app.recurringTemplates = [];
        app.expenses = [];
        app.saveToStorage();
    }""")
    content, _ = _download_ics(page)
    assert 'SUMMARY:Bill - NoDayBill' not in content


@pytest.mark.feature
def test_debt_without_due_date_is_skipped(app_page):
    """A debt with dueDate=null produces no VEVENT."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.bills = [];
        app.debts = [{ id: 1, name: 'NoDueDebt', minimumPayment: 200, dueDate: null,
                       accountBalance: 1000, interestRate: 0, category: 'Other',
                       debtType: 'creditCard', accountId: null, originalBalance: 1000 }];
        app.recurringTemplates = [];
        app.expenses = [];
        app.saveToStorage();
    }""")
    content, _ = _download_ics(page)
    assert 'SUMMARY:Debt - NoDueDebt' not in content


@pytest.mark.feature
def test_paused_recurring_template_is_skipped(app_page):
    """A paused recurring template generates no events."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.bills = [];
        app.debts = [];
        app.expenses = [];
        app.recurringTemplates = [{
            id: 1, name: 'PausedSub', type: 'subscription', amount: 5,
            frequency: 'monthly', dayOfMonth: 1, category: 'Other',
            accountId: null, targetAccountId: null, startDate: null, endDate: null,
            paused: true, skippedMonths: [], paidMonths: []
        }];
        app.saveToStorage();
    }""")
    content, _ = _download_ics(page)
    assert 'SUMMARY:Subscription - PausedSub' not in content


@pytest.mark.security
def test_ics_escapes_special_characters_in_names(app_page):
    """Commas and semicolons in item names are backslash-escaped per RFC 5545."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [];
        app.bills = [{ id: 1, name: 'Gas, Water; Electric', amount: 100, dueDay: 5,
                       category: 'Utilities', accountId: null }];
        app.debts = [];
        app.recurringTemplates = [];
        app.expenses = [];
        app.saveToStorage();
    }""")
    content, _ = _download_ics(page)
    # In ICS, commas and semicolons in values must be escaped
    assert r'Gas\, Water\; Electric' in content
    # Unescaped form should not appear as the raw SUMMARY value
    assert 'SUMMARY:Bill - Gas, Water; Electric' not in content


@pytest.mark.feature
def test_subscription_section_shows_security_warning(app_page):
    """
    After generating a token the modal must display a warning that the URL
    should be treated like a password.  This is static HTML; it does not
    require the Postgres backend to be active.
    """
    page = app_page
    # The warning is inside #calendarTokenUrlRow which is hidden until a token
    # is generated. Verify the text is present in the DOM regardless.
    warning_count = page.locator('.cal-token-warning').count()
    assert warning_count >= 1, 'Security warning element (.cal-token-warning) not found in modal'
    text = page.locator('.cal-token-warning').first.inner_text()
    assert 'password' in text.lower(), f'Warning should mention "password", got: {text!r}'
    assert_no_errors(page)


@pytest.mark.security
def test_ics_xss_payload_in_name_does_not_appear_verbatim(app_page):
    """
    An XSS-style payload in an item name must not appear verbatim in the ICS
    output — at minimum the angle brackets must be absent (normalizeText strips them).
    """
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        // normalizeText() in sanitizers.js strips < > ` " from names
        app.recurringTemplates = [{
            id: 1, name: '<script>alert(1)</script>Evil', type: 'subscription',
            amount: 1, frequency: 'monthly', dayOfMonth: 1, category: 'Other',
            accountId: null, targetAccountId: null, startDate: null, endDate: null,
            paused: false, skippedMonths: [], paidMonths: []
        }];
        app.bills = [];
        app.debts = [];
        app.expenses = [];
        app.accounts = [];
        // Save and reload so normalizeText sanitization runs on load
        app.saveToStorage();
        app.loadFromStorage();
    }""")
    content, _ = _download_ics(page)
    assert '<script>' not in content
    assert '</script>' not in content
