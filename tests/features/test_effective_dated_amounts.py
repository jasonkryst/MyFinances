#!/usr/bin/env python3
"""
Effective-dated amounts (issue #678).

Editing the amount of an income or recurring template asks "Applies from";
months before that date keep the old amount. "All occurrences" corrects every
month, and a scheduled future change can be deleted from the card.
"""

from datetime import date

from tests.conftest import assert_no_errors, seed_state, wait_for_api


def _iso(d):
    return d.isoformat()


def _month_offset(n, day):
    t = date.today()
    y, m = t.year, t.month - 1 + n
    y += m // 12
    m = m % 12
    return date(y, m + 1, day)


START = _month_offset(-3, 1)
THIS_5 = _month_offset(0, 5)
NEXT_1 = _month_offset(1, 1)
NEXT_5 = _month_offset(1, 5)
ACCOUNT = {"id": 9601, "name": "EDA Checking", "type": "Checking", "startingBalance": 1000}


def _template(**extra):
    t = {"id": 9611, "name": "EDA Streaming", "type": "subscription", "amount": 15, "frequency": "monthly",
         "dayOfMonth": 5, "category": "Subscriptions", "accountId": ACCOUNT["id"], "startDate": _iso(START)}
    t.update(extra)
    return t


def _income(**extra):
    i = {"id": 9621, "name": "EDA Salary", "amount": 1000, "frequency": "monthly",
         "firstPayDate": _iso(date(START.year, START.month, 5)), "accountId": ACCOUNT["id"], "category": "Salary"}
    i.update(extra)
    return i


def _seed(page, templates=(), incomes=()):
    seed_state(page, {"accounts": [ACCOUNT], "recurringTemplates": list(templates), "incomes": list(incomes)})


def _id_of(page, collection, name):
    return page.evaluate("([c, n]) => window.app[c].find(r => r.name === n).id", [collection, name])


def _ledger_amounts(page, source_type, source_id, d):
    return page.evaluate(
        """async ([type, id, y, m]) => {
            const mod = await import('/src/ledgerTransactions.js');
            return mod.getLedgerTransactionsForMonth(window.app, y, m)
                .filter(t => t.type === type && String(t.sourceId) === String(id))
                .map(t => t.amount);
        }""",
        [source_type, source_id, d.year, d.month - 1],
    )


def _open_recurring_editor(page, tid):
    page.evaluate("() => window.app.switchPage('recurring')")
    page.click(f'[data-recurring-action="edit"][data-recurring-id="{tid}"]')
    page.wait_for_selector(f"#re-amount-{tid}")


def _open_income_editor(page, iid):
    page.evaluate("() => window.app.switchPage('income')")
    page.click(f'[data-income-action="edit"][data-income-id="{iid}"]')
    page.wait_for_selector(f"#ie-amount-{iid}")


def test_applies_from_hidden_until_amount_changes(app_page):
    page = app_page
    _seed(page, templates=[_template()])
    tid = _id_of(page, "recurringTemplates", "EDA Streaming")
    _open_recurring_editor(page, tid)
    assert not page.is_visible(f"#re-applies-row-{tid}")
    page.fill(f"#re-amount-{tid}", "18")
    page.wait_for_selector(f"#re-applies-row-{tid}", state="visible")
    page.fill(f"#re-amount-{tid}", "15")
    page.wait_for_selector(f"#re-applies-row-{tid}", state="hidden")
    assert_no_errors(page)


def test_recurring_future_change_keeps_past_months(app_page):
    page = app_page
    _seed(page, templates=[_template()])
    tid = _id_of(page, "recurringTemplates", "EDA Streaming")
    _open_recurring_editor(page, tid)
    page.fill(f"#re-amount-{tid}", "18")
    page.fill(f"#re-applies-from-{tid}", _iso(NEXT_1))
    page.click(f'[data-recurring-action="save"][data-recurring-id="{tid}"]')
    wait_for_api(page, "/api/recurring-templates", lambda rows: any(
        r["id"] == tid and r["amountChanges"] == [{"from": _iso(NEXT_1), "amount": 18}] and float(r["amount"]) == 15
        for r in rows))
    page.reload()
    assert _ledger_amounts(page, "recurring", tid, THIS_5) == [-15]
    assert _ledger_amounts(page, "recurring", tid, NEXT_5) == [-18]
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector(f"#recurring-card-{tid} .amount-changes")
    assert_no_errors(page)


def test_income_change_from_date(app_page):
    page = app_page
    _seed(page, incomes=[_income()])
    iid = _id_of(page, "incomes", "EDA Salary")
    _open_income_editor(page, iid)
    page.fill(f"#ie-amount-{iid}", "1200")
    page.fill(f"#ie-applies-from-{iid}", _iso(NEXT_1))
    page.click(f'[data-income-action="save"][data-income-id="{iid}"]')
    wait_for_api(page, "/api/incomes", lambda rows: any(
        r["id"] == iid and r["amountChanges"] == [{"from": _iso(NEXT_1), "amount": 1200}] for r in rows))
    page.reload()
    assert _ledger_amounts(page, "income", iid, THIS_5) == [1000]
    assert _ledger_amounts(page, "income", iid, NEXT_5) == [1200]
    page.evaluate("() => window.app.switchPage('income')")
    page.wait_for_selector(f"#income-card-{iid} .amount-changes")
    assert_no_errors(page)


def test_all_occurrences_resets(app_page):
    page = app_page
    _seed(page, templates=[_template(amountChanges=[{"from": _iso(NEXT_1), "amount": 20}])])
    tid = _id_of(page, "recurringTemplates", "EDA Streaming")
    _open_recurring_editor(page, tid)
    page.fill(f"#re-amount-{tid}", "18")
    page.check(f"#re-applies-all-{tid}")
    page.wait_for_selector(f"#re-applies-note-{tid}", state="visible")
    page.click(f'[data-recurring-action="save"][data-recurring-id="{tid}"]')
    wait_for_api(page, "/api/recurring-templates", lambda rows: any(
        r["id"] == tid and r["amountChanges"] == [] and float(r["amount"]) == 18 for r in rows))
    page.reload()
    assert _ledger_amounts(page, "recurring", tid, THIS_5) == [-18]
    assert _ledger_amounts(page, "recurring", tid, NEXT_5) == [-18]
    assert_no_errors(page)


def test_delete_scheduled_change(app_page):
    page = app_page
    _seed(page, templates=[_template(amountChanges=[{"from": _iso(NEXT_1), "amount": 20}])])
    tid = _id_of(page, "recurringTemplates", "EDA Streaming")
    page.evaluate("() => window.app.switchPage('recurring')")
    page.click(f"#recurring-card-{tid} .amount-changes summary")
    page.click(f'#recurring-card-{tid} [data-amount-change-delete="recurring"]')
    wait_for_api(page, "/api/recurring-templates", lambda rows: any(
        r["id"] == tid and r["amountChanges"] == [] for r in rows))
    page.wait_for_selector(f"#recurring-card-{tid} .amount-changes", state="detached")
    assert_no_errors(page)
