#!/usr/bin/env python3
"""
Weekend due-date shift (issue #165).

Recurring templates and debts carry a weekendRule ('none' | 'before' | 'after').
A due date that falls on Saturday or Sunday moves to the Friday before or the
Monday after, staying inside its month. The shifted date feeds the Ledger, the
Recurring paid <-> Ledger keys (#434), and both calendar feeds.

The tests pick a Saturday in the CURRENT month (day 8..26, so neither shift
leaves the month), so they never depend on a hard-coded date.
"""

import re
from datetime import date

import pytest

from tests.conftest import BASE_URL, assert_no_errors, seed_state, wait_for_api

TODAY = date.today()
SAT = next(d for d in range(8, 27) if date(TODAY.year, TODAY.month, d).weekday() == 5)
MONTH_KEY = f"{TODAY.year}-{TODAY.month:02d}"


def _iso(day):
    return f"{TODAY.year}-{TODAY.month:02d}-{day:02d}"


def _ymd(day):
    return f"{TODAY.year}{TODAY.month:02d}{day:02d}"


def _tmpl(name, rule=None, day=SAT):
    t = {
        "id": 1, "name": name, "type": "subscription", "amount": 40,
        "frequency": "monthly", "dayOfMonth": day, "category": "Bills",
        "accountId": 1, "targetAccountId": None,
        "startDate": f"{TODAY.year - 1}-01-01", "endDate": None,
        "paused": False, "archived": False, "skippedMonths": [], "paidMonths": [], "paidAmounts": {},
    }
    if rule is not None:
        t["weekendRule"] = rule
    return t


def _debt(name, rule=None, day=SAT):
    d = {
        "id": 1, "name": name, "category": "Credit Card", "debtType": "creditCard", "accountId": 1,
        "accountBalance": 1000, "originalBalance": 1000, "interestRate": 10,
        "minimumPayment": 50, "originalMinimumPayment": 50, "dueDate": day,
    }
    if rule is not None:
        d["weekendRule"] = rule
    return d


ACCOUNT = {"id": 1, "name": "Weekend Checking", "type": "Checking", "startingBalance": 5000}


def _seed(page, templates=(), debts=()):
    seed_state(page, {"accounts": [ACCOUNT], "recurringTemplates": list(templates), "debts": list(debts)})


def _ids(page):
    return page.evaluate("""() => ({
        acct: window.app.accounts[0].id,
        templates: Object.fromEntries(window.app.recurringTemplates.map(t => [t.name, t.id])),
        debts: Object.fromEntries(window.app.debts.map(d => [d.name, d.id])),
    })""")


def _ledger_tx_ids(page, acct, kind, source_id):
    return page.evaluate("""async ({ acct, kind, sourceId }) => {
        const m = await import('/src/ledgerTransactions.js');
        const now = new Date();
        const map = m.buildProjectedAccountTransactions(window.app, now.getFullYear(), now.getMonth(), 1);
        return (map[acct]?.txs || []).filter(t => t.type === kind && t.sourceId === sourceId).map(t => t.transactionId);
    }""", {"acct": acct, "kind": kind, "sourceId": source_id})


def _is_cleared(page, tx_id):
    return page.evaluate("""async (id) => {
        const m = await import('/src/ledgerCleared.js');
        return m.isCleared(window.app, id);
    }""", tx_id)


def _ics_dates(content, kind, item_id):
    return re.findall(rf"UID:{kind}-{item_id}-(\d{{8}})@myfinances", content)


# ── Ledger dates and the #434 paid keys ──────────────────────────────────────

@pytest.mark.feature
def test_recurring_before_moves_to_friday_and_paid_keys_line_up(app_page):
    page = app_page
    _seed(page, [_tmpl("Rent Friday", "before")])
    ids = _ids(page)
    tid, acct = ids["templates"]["Rent Friday"], ids["acct"]

    assert _ledger_tx_ids(page, acct, "recurring", tid) == [f"recurring|{tid}|{acct}|{_iso(SAT - 1)}"]

    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click(f'[data-recurring-action="mark-paid"][data-recurring-id="{tid}"]')
    page.wait_for_selector('#recurringMarkPaidModal', timeout=5000)
    page.click('#recurringMarkPaidConfirmBtn')
    page.wait_for_selector('#recurringMarkPaidModal', state='detached', timeout=5000)

    leg = f"recurring|{tid}|{acct}|{_iso(SAT - 1)}"
    assert _is_cleared(page, leg), "the Friday ledger leg should be Cleared"
    assert not _is_cleared(page, f"recurring|{tid}|{acct}|{_iso(SAT)}"), "nothing is cleared on the unshifted Saturday"
    paid = page.evaluate(f"() => window.app.recurringTemplates.find(t => t.id === {tid}).paidMonths")
    assert MONTH_KEY in paid
    # No assert_no_errors here: confirming the template amount DELETEs an amount
    # override that does not exist, a silent keyed-DELETE 404 that Chromium logs.


@pytest.mark.feature
def test_recurring_after_moves_to_monday(app_page):
    page = app_page
    _seed(page, [_tmpl("Rent Monday", "after")])
    ids = _ids(page)
    tid, acct = ids["templates"]["Rent Monday"], ids["acct"]
    assert _ledger_tx_ids(page, acct, "recurring", tid) == [f"recurring|{tid}|{acct}|{_iso(SAT + 2)}"]


@pytest.mark.feature
def test_recurring_none_and_missing_rule_stay_on_the_weekend_date(app_page):
    """Negative: 'none' (and a record with no rule at all) keeps the Saturday."""
    page = app_page
    _seed(page, [_tmpl("Keep None", "none"), {**_tmpl("Keep Missing"), "id": 2}])
    ids = _ids(page)
    acct = ids["acct"]
    for name in ("Keep None", "Keep Missing"):
        tid = ids["templates"][name]
        assert _ledger_tx_ids(page, acct, "recurring", tid) == [f"recurring|{tid}|{acct}|{_iso(SAT)}"]
    assert page.evaluate("() => window.app.recurringTemplates.every(t => t.weekendRule === 'none')")


@pytest.mark.feature
def test_debt_after_moves_to_monday_and_can_be_cleared(app_page):
    page = app_page
    _seed(page, debts=[_debt("Weekend Visa", "after")])
    ids = _ids(page)
    did, acct = ids["debts"]["Weekend Visa"], ids["acct"]
    leg = f"debt|{did}|{acct}|{_iso(SAT + 2)}"
    assert _ledger_tx_ids(page, acct, "debt", did) == [leg]
    page.evaluate("""async (id) => {
        const m = await import('/src/ledgerCleared.js');
        m.setLedgerCleared(window.app, id, true);
    }""", leg)
    assert _is_cleared(page, leg)


@pytest.mark.feature
def test_debt_none_stays_on_the_weekend_date(app_page):
    page = app_page
    _seed(page, debts=[_debt("Plain Visa"), {**_debt("Before Visa", "before"), "id": 2}])
    ids = _ids(page)
    acct = ids["acct"]
    assert _ledger_tx_ids(page, acct, "debt", ids["debts"]["Plain Visa"]) == [f"debt|{ids['debts']['Plain Visa']}|{acct}|{_iso(SAT)}"]
    assert _ledger_tx_ids(page, acct, "debt", ids["debts"]["Before Visa"]) == [f"debt|{ids['debts']['Before Visa']}|{acct}|{_iso(SAT - 1)}"]


@pytest.mark.feature
def test_weekday_due_date_is_not_moved(app_page):
    """Negative: a due date on a weekday ignores the rule."""
    page = app_page
    monday = SAT - 5
    _seed(page, [_tmpl("Weekday Rent", "after", day=monday)])
    ids = _ids(page)
    tid, acct = ids["templates"]["Weekday Rent"], ids["acct"]
    assert _ledger_tx_ids(page, acct, "recurring", tid) == [f"recurring|{tid}|{acct}|{_iso(monday)}"]


# ── UI: forms persist the rule ───────────────────────────────────────────────

@pytest.mark.feature
def test_recurring_add_form_saves_rule_and_it_survives_reload(app_page):
    page = app_page
    _seed(page)
    acct = _ids(page)["acct"]
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click('#recurringFormToggle')
    page.wait_for_selector('#recurringFormBody:not([hidden])', timeout=5000)
    assert page.input_value('#recurringWeekendRule') == 'none', "default is Keep the date"
    page.fill('#recurringName', 'Form Rule Rent')
    page.fill('#recurringAmount', '75')
    page.fill('#recurringDayOfMonth', str(SAT))
    page.select_option('#recurringWeekendRule', 'before')
    page.select_option('#recurringAccount', str(acct))
    page.fill('#recurringStartDate', f"{TODAY.year - 1}-01-01")
    page.click('#recurringFormSubmit')
    page.wait_for_selector('#recurringList >> text=Form Rule Rent', timeout=10000)
    wait_for_api(page, '/api/recurring-templates',
                 lambda rows: any(r['name'] == 'Form Rule Rent' and r['weekendRule'] == 'before' for r in rows))
    page.reload()
    row = page.evaluate("() => window.app.recurringTemplates.find(t => t.name === 'Form Rule Rent')")
    assert row['weekendRule'] == 'before'
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector('#recurringList >> text=Form Rule Rent', timeout=10000)
    assert 'Friday before' in page.inner_text(f'#recurring-card-{row["id"]}')
    assert_no_errors(page)


@pytest.mark.feature
def test_recurring_inline_edit_changes_rule(app_page):
    page = app_page
    _seed(page, [_tmpl("Edit Me", "none")])
    tid = _ids(page)["templates"]["Edit Me"]
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click(f'[data-recurring-action="edit"][data-recurring-id="{tid}"]')
    page.select_option(f'#re-weekend-{tid}', 'after')
    page.click(f'[data-recurring-action="save"][data-recurring-id="{tid}"]')
    wait_for_api(page, '/api/recurring-templates',
                 lambda rows: any(r['id'] == tid and r['weekendRule'] == 'after' for r in rows))
    assert_no_errors(page)


@pytest.mark.feature
def test_debt_inline_edit_changes_rule(app_page):
    page = app_page
    _seed(page, debts=[_debt("Edit Visa", "none")])
    did = _ids(page)["debts"]["Edit Visa"]
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.click(f'[data-debt-action="edit"][data-debt-id="{did}"]')
    page.select_option(f'#inline-weekend-{did}', 'before')
    page.click(f'[data-debt-action="save-inline"][data-debt-id="{did}"]')
    wait_for_api(page, '/api/debts', lambda rows: any(r['id'] == did and r['weekendRule'] == 'before' for r in rows))
    page.reload()
    assert page.evaluate(f"() => window.app.debts.find(d => d.id === {did}).weekendRule") == 'before'
    assert_no_errors(page)


# ── Calendar feeds ───────────────────────────────────────────────────────────

def _client_ics(page):
    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuCalendarFeedBtn')
    page.wait_for_selector('#calendarFeedModal:not(.hidden)', timeout=5000)
    with page.expect_download() as dl_info:
        page.click('#calendarDownloadBtn')
    with open(dl_info.value.path(), 'r', encoding='utf-8') as f:
        return f.read()


def _server_ics(page):
    base = BASE_URL.rstrip('/')
    csrf = page.evaluate("document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || ''")
    r = page.request.post(f'{base}/api/calendar/token', headers={'X-CSRF-Token': csrf})
    assert r.status == 200
    token = r.json()['token']
    feed = page.request.get(f'{base}/calendar.ics', params={'token': token})
    assert feed.status == 200
    return feed.text()


@pytest.mark.feature
def test_client_and_server_calendar_feeds_show_the_shifted_date(app_page):
    page = app_page
    _seed(page,
          [_tmpl("Feed Before", "before"), {**_tmpl("Feed None"), "id": 2}],
          [_debt("Feed Debt After", "after")])
    ids = _ids(page)
    tb, tn, did = ids["templates"]["Feed Before"], ids["templates"]["Feed None"], ids["debts"]["Feed Debt After"]

    for label, content in (("client", _client_ics(page)), ("server", _server_ics(page))):
        assert _ymd(SAT - 1) in _ics_dates(content, "recurring", tb), f"{label}: Friday expected"
        assert _ymd(SAT) not in _ics_dates(content, "recurring", tb), f"{label}: unshifted Saturday must be gone"
        assert _ymd(SAT) in _ics_dates(content, "recurring", tn), f"{label}: 'none' keeps Saturday"
        assert _ymd(SAT + 2) in _ics_dates(content, "debt", did), f"{label}: Monday expected for the debt"
        assert _ymd(SAT) not in _ics_dates(content, "debt", did), f"{label}: unshifted Saturday must be gone"
        page.keyboard.press('Escape')
