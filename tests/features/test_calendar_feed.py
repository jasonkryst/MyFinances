"""
Tests for the Calendar Feed feature (issue #212).

Covers:
  - Positive: ICS download contains expected VCALENDAR structure
  - Positive: Events for bills, debts, recurring templates, and expenses appear
  - Positive: Paid months are excluded from the feed
  - Positive: Archived debts follow Settings -> Show archived debts (issue #217)
  - Positive: Income paydays appear as 'Payday - Name' events (issue #217)
  - Positive: Toolbar button opens the calendar feed modal
  - Negative: Empty app state produces a valid (but event-free) ICS
  - Negative: XSS / special characters in item names are escaped in ICS output
  - Negative: Items without a due date are skipped
  - Negative: Archived debts omitted while the setting is off; paydays before
    firstPayDate / incomes without firstPayDate produce no events (issue #217)
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
    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuCalendarFeedBtn')
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
def test_calendar_account_menu_opens_modal(app_page):
    """Calendar Feed item in account dropdown is present and opens the modal."""
    page = app_page
    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    assert page.is_visible('#accountMenuCalendarFeedBtn')
    page.click('#accountMenuCalendarFeedBtn')
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

    # Only the paid month is suppressed; other months still emit the event.
    this_month = f"{today.year}{str(today.month).zfill(2)}10"
    assert f'UID:recurring-999-{this_month}@myfinances' not in content
    assert 'SUMMARY:Subscription - PaidSub' in content


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
    page.wait_for_selector('#calendarFeedModal.hidden', state='attached', timeout=3000)
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


def _seed_archived_debts(page, show_archived):
    """One archived + one active debt; show_archived drives the Settings value."""
    page.evaluate("""async (showArchived) => {
        const app = window.app;
        const { setSetting, SHOW_ARCHIVED_DEBTS } = await import('/src/settings.js');
        app.accounts = [];
        app.bills = [];
        app.incomes = [];
        app.debts = [
            { id: 1, name: 'ArchivedVisa', minimumPayment: 100, dueDate: 10,
              accountBalance: 1000, interestRate: 0, category: 'Credit Card',
              debtType: 'creditCard', accountId: null, originalBalance: 1000,
              archived: true },
            { id: 2, name: 'ActiveLoan', minimumPayment: 200, dueDate: 15,
              accountBalance: 2000, interestRate: 5, category: 'Loan',
              debtType: 'personal', accountId: null, originalBalance: 2000,
              archived: false }
        ];
        app.recurringTemplates = [];
        app.expenses = [];
        setSetting(app, SHOW_ARCHIVED_DEBTS, showArchived);
    }""", show_archived)


@pytest.mark.feature
def test_archived_debt_excluded_when_show_archived_off(app_page):
    """Show archived debts off: archived debts are omitted from the ICS."""
    page = app_page
    _seed_archived_debts(page, False)
    content, _ = _download_ics(page)
    assert 'ArchivedVisa' not in content
    assert 'SUMMARY:Debt - ActiveLoan' in content


@pytest.mark.feature
def test_archived_debt_excluded_when_setting_never_set(app_page):
    """No settings entry at all behaves like 'off' -- archived debts are omitted."""
    page = app_page
    _seed_archived_debts(page, False)
    page.evaluate("() => { window.app.settings = []; window.app.saveToStorage(); }")
    content, _ = _download_ics(page)
    assert 'ArchivedVisa' not in content
    assert 'SUMMARY:Debt - ActiveLoan' in content


@pytest.mark.feature
def test_archived_debt_included_and_labeled_when_show_archived_on(app_page):
    """Show archived debts on: archived debts appear titled 'Debt (Archived) - Name';
    active debts keep the plain 'Debt - Name' title."""
    page = app_page
    _seed_archived_debts(page, True)
    content, _ = _download_ics(page)
    assert 'SUMMARY:Debt (Archived) - ArchivedVisa' in content
    assert 'SUMMARY:Debt - ArchivedVisa' not in content
    assert 'SUMMARY:Debt - ActiveLoan' in content
    assert 'SUMMARY:Debt (Archived) - ActiveLoan' not in content


# ─── Paydays (issue #217) ─────────────────────────────────────────────────────

def _seed_incomes(page, incomes):
    page.evaluate("""(incomes) => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Payroll Checking', type: 'Checking', startingBalance: 0, interestRate: 0 }];
        app.bills = [];
        app.debts = [];
        app.recurringTemplates = [];
        app.expenses = [];
        app.incomes = incomes;
        app.saveToStorage();
    }""", incomes)


def _ymd(d):
    return d.strftime('%Y%m%d')


def _unfold(content):
    # _download_ics reads in text mode, so CRLF arrives as '\n'.
    return content.replace('\r\n ', '').replace('\n ', '')


@pytest.mark.feature
def test_monthly_payday_appears_in_feed(app_page):
    """A monthly income emits a 'Payday - Name' all-day event on its pay day,
    with 'Amount:' (not 'Amount Due:') and the linked account in the description."""
    from datetime import date
    today = date.today()
    first = date(today.year - 1, today.month, 5)
    page = app_page
    _seed_incomes(page, [{
        'id': 7, 'name': 'Acme Salary', 'amount': 2500, 'frequency': 'monthly',
        'firstPayDate': first.isoformat(), 'accountId': 1, 'personId': None,
    }])
    content, _ = _download_ics(page)
    this_month = _ymd(date(today.year, today.month, 5))
    assert f'UID:income-7-{this_month}@myfinances' in content
    assert f'DTSTART;VALUE=DATE:{this_month}' in content
    assert 'SUMMARY:Payday - Acme Salary' in content
    unfolded = _unfold(content)
    assert 'Amount: $2500.00' in unfolded
    assert 'Account: Payroll Checking' in unfolded
    assert 'Amount Due: $2500.00' not in unfolded


@pytest.mark.feature
def test_biweekly_payday_emits_every_occurrence(app_page):
    """A biweekly income emits one event per payday (every 14 days), not one per month."""
    from datetime import date, timedelta
    today = date.today()
    first = date(today.year, today.month, 1) - timedelta(days=70)
    page = app_page
    _seed_incomes(page, [{
        'id': 8, 'name': 'Biweekly Pay', 'amount': 1200, 'frequency': 'biweekly',
        'firstPayDate': first.isoformat(), 'accountId': None, 'personId': None,
    }])
    content, _ = _download_ics(page)
    for n in range(5, 10):
        assert f'UID:income-8-{_ymd(first + timedelta(days=14 * n))}@myfinances' in content
    # Nothing on the day midway between two paydays
    assert f'UID:income-8-{_ymd(first + timedelta(days=14 * 6 + 7))}@myfinances' not in content


@pytest.mark.feature
def test_twice_monthly_payday_on_15th_and_last_day(app_page):
    """twice_monthly paydays land on the 15th and the last day of the month."""
    import calendar as pycal
    from datetime import date
    today = date.today()
    page = app_page
    _seed_incomes(page, [{
        'id': 9, 'name': 'Semi Pay', 'amount': 1000, 'frequency': 'twice_monthly',
        'firstPayDate': f'{today.year - 1}-01-01', 'accountId': None, 'personId': None,
    }])
    content, _ = _download_ics(page)
    last = pycal.monthrange(today.year, today.month)[1]
    assert f'UID:income-9-{_ymd(date(today.year, today.month, 15))}@myfinances' in content
    assert f'UID:income-9-{_ymd(date(today.year, today.month, last))}@myfinances' in content
    assert f'UID:income-9-{_ymd(date(today.year, today.month, 1))}@myfinances' not in content


@pytest.mark.feature
def test_no_payday_before_first_pay_date(app_page):
    """Paydays before an income's firstPayDate are not emitted."""
    from datetime import date
    today = date.today()
    # First pay date ~3 months in the future (still inside the +12-month window)
    m0 = today.month - 1 + 3
    first = date(today.year + m0 // 12, m0 % 12 + 1, 10)
    page = app_page
    _seed_incomes(page, [{
        'id': 10, 'name': 'Future Job', 'amount': 3000, 'frequency': 'biweekly',
        'firstPayDate': first.isoformat(), 'accountId': None, 'personId': None,
    }])
    content, _ = _download_ics(page)
    prefix = 'UID:income-10-'
    uids = [ln for ln in content.splitlines() if ln.startswith(prefix)]
    assert f'{prefix}{_ymd(first)}@myfinances' in uids
    assert all(ln[len(prefix):len(prefix) + 8] >= _ymd(first) for ln in uids)


@pytest.mark.feature
def test_income_without_first_pay_date_is_skipped(app_page):
    """An income with no (or an invalid) firstPayDate generates no payday events."""
    page = app_page
    _seed_incomes(page, [
        {'id': 11, 'name': 'NoDate', 'amount': 100, 'frequency': 'monthly',
         'firstPayDate': '', 'accountId': None, 'personId': None},
        {'id': 12, 'name': 'BadDate', 'amount': 100, 'frequency': 'monthly',
         'firstPayDate': 'not-a-date', 'accountId': None, 'personId': None},
    ])
    content, _ = _download_ics(page)
    assert 'Payday - NoDate' not in content
    assert 'Payday - BadDate' not in content
    assert content.strip().endswith('END:VCALENDAR')
    assert_no_errors(page)


@pytest.mark.feature
def test_zero_amount_payday_omits_amount_line(app_page):
    """A $0 income still gets a payday event but no 'Amount:' description line."""
    from datetime import date
    today = date.today()
    page = app_page
    _seed_incomes(page, [{
        'id': 13, 'name': 'Unpaid Intern', 'amount': 0, 'frequency': 'monthly',
        'firstPayDate': f'{today.year - 1}-{today.month:02d}-01', 'accountId': None, 'personId': None,
    }])
    content, _ = _download_ics(page)
    assert 'SUMMARY:Payday - Unpaid Intern' in content
    assert 'Amount: $0.00' not in _unfold(content)


@pytest.mark.security
def test_payday_name_special_characters_escaped(app_page):
    """RFC 5545 special characters in an income name are escaped in SUMMARY."""
    from datetime import date
    today = date.today()
    page = app_page
    _seed_incomes(page, [{
        'id': 14, 'name': 'Pay; Bonus, Inc', 'amount': 50, 'frequency': 'monthly',
        'firstPayDate': f'{today.year - 1}-{today.month:02d}-01', 'accountId': None, 'personId': None,
    }])
    content, _ = _download_ics(page)
    assert 'SUMMARY:Payday - Pay\\; Bonus\\, Inc' in content


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
