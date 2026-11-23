#!/usr/bin/env python3
"""List pagination on Liabilities (debts) and Recurring (issue #330).

25 items per page; controls only when the list needs more than one page;
filter and sort act on the whole list; a filter or sort change resets to
page 1; leaving the page and coming back shows page 1; shrinking the list
clamps the page. Grouped debts paginate the flat grouped order.
"""

from datetime import date

from tests.conftest import seed_state

ACCOUNT = {"id": 1, "name": "Pager Checking", "type": "Checking", "startingBalance": 5000}
TODAY = date.today()


def _debt(i, category="Credit Card", name=None):
    return {
        "id": i, "name": name or f"Debt {i:03d}", "category": category, "debtType": "creditCard",
        "accountId": 1, "accountBalance": 100 + i,
        "originalBalance": 5000, "interestRate": 10, "minimumPayment": 25,
        "originalMinimumPayment": 25, "dueDate": 10,
    }


def _tmpl(i, category="Bills"):
    return {
        "id": i, "name": f"Tmpl {i:03d}", "type": "subscription", "amount": 10 + i,
        "frequency": "monthly", "dayOfMonth": 10, "category": category,
        "accountId": 1, "targetAccountId": None,
        "startDate": f"{TODAY.year - 1}-01-01", "endDate": None,
        "paused": False, "archived": False, "skippedMonths": [], "paidMonths": [], "paidAmounts": {},
    }


def _go(page, name):
    page.click(f'button[data-page="{name}"]')


def _debt_cards(page):
    return page.locator("#debtsList .debt-card").count()


def _recurring_cards(page):
    return page.locator("#recurringList .recurring-card").count()


def _debt_names(page):
    return page.eval_on_selector_all("#debtsList .debt-card .debt-name", "els => els.map(e => e.textContent.trim())")


def _seed_debts(page, n):
    seed_state(page, {"accounts": [ACCOUNT], "debts": [_debt(i) for i in range(1, n + 1)]})
    _go(page, "liabilities")
    page.wait_for_selector("#debtsList .debt-card")


def _seed_tmpls(page, n):
    seed_state(page, {"accounts": [ACCOUNT], "recurringTemplates": [_tmpl(i) for i in range(1, n + 1)]})
    _go(page, "recurring")
    page.wait_for_selector("#recurringList [data-recurring-action]")


def _pager(page, root):
    return page.locator(f"{root} .list-pager")


def _status(page, root):
    return _pager(page, root).locator(".ledger-page-summary").inner_text()


def _wait_page(page, root, n, of):
    page.wait_for_function(
        "([root, txt]) => document.querySelector(root + ' .list-pager')?.textContent.includes(txt)",
        arg=[root, f"Page {n} of {of}"],
    )


# ---------------------------------------------------------------- debts

def test_debts_paginate_25_per_page(app_page):
    _seed_debts(app_page, 60)
    assert _debt_cards(app_page) == 25
    assert _pager(app_page, "#debtsList").count() == 1
    assert "1-25 of 60" in _status(app_page, "#debtsList")
    _wait_page(app_page, "#debtsList", 1, 3)
    next_btn = app_page.locator("#debtsList [data-pager-dir=next]")
    prev_btn = app_page.locator("#debtsList [data-pager-dir=prev]")
    assert prev_btn.is_disabled()
    assert next_btn.get_attribute("aria-label") == "Next page of debts"
    next_btn.click()
    _wait_page(app_page, "#debtsList", 2, 3)
    assert _debt_cards(app_page) == 25
    assert "26-50 of 60" in _status(app_page, "#debtsList")
    assert not prev_btn.is_disabled()
    next_btn.click()
    _wait_page(app_page, "#debtsList", 3, 3)
    assert _debt_cards(app_page) == 10
    assert "51-60 of 60" in _status(app_page, "#debtsList")
    assert next_btn.is_disabled()
    prev_btn.click()
    _wait_page(app_page, "#debtsList", 2, 3)
    assert _debt_cards(app_page) == 25


def test_debts_no_controls_at_25_or_fewer(app_page):
    _seed_debts(app_page, 25)
    assert _debt_cards(app_page) == 25
    assert _pager(app_page, "#debtsList").count() == 0
    seed_state(app_page, {"accounts": [ACCOUNT], "debts": []})
    _go(app_page, "liabilities")
    app_page.wait_for_selector("#debtsList .empty-state")
    assert _pager(app_page, "#debtsList").count() == 0


def test_debts_26_has_a_second_page_of_one(app_page):
    _seed_debts(app_page, 26)
    assert _debt_cards(app_page) == 25
    app_page.click("#debtsList [data-pager-dir=next]")
    app_page.wait_for_function("() => document.querySelectorAll('#debtsList .debt-card').length === 1")


def test_debts_sort_spans_all_pages_and_resets_page(app_page):
    _seed_debts(app_page, 40)
    app_page.click("#debtsList [data-pager-dir=next]")
    _wait_page(app_page, "#debtsList", 2, 2)
    app_page.select_option("#debtSortBy", "balance-desc")
    _wait_page(app_page, "#debtsList", 1, 2)
    names = _debt_names(app_page)
    # Highest balance (Debt 040) first: the sort ran over the whole dataset.
    assert "Debt 040" in names[0]
    assert "Debt 016" in names[-1]


def test_debts_filter_spans_all_pages_and_resets_page(app_page):
    debts = [_debt(i, category="Credit Card" if i <= 30 else "Medical") for i in range(1, 41)]
    seed_state(app_page, {"accounts": [ACCOUNT], "debts": debts})
    _go(app_page, "liabilities")
    app_page.wait_for_selector("#debtsList .debt-card")
    app_page.click("#debtsList [data-pager-dir=next]")
    _wait_page(app_page, "#debtsList", 2, 2)
    app_page.select_option("#categoryFilter", "Medical")
    app_page.wait_for_function("() => document.querySelectorAll('#debtsList .debt-card').length === 10")
    assert _pager(app_page, "#debtsList").count() == 0  # 10 matches: no controls
    app_page.select_option("#categoryFilter", "Credit Card")
    _wait_page(app_page, "#debtsList", 1, 2)
    assert "1-25 of 30" in _status(app_page, "#debtsList")


def test_debts_back_to_page_one_after_navigating_away(app_page):
    _seed_debts(app_page, 40)
    app_page.click("#debtsList [data-pager-dir=next]")
    _wait_page(app_page, "#debtsList", 2, 2)
    _go(app_page, "accounts")
    _go(app_page, "liabilities")
    _wait_page(app_page, "#debtsList", 1, 2)


def test_debts_in_place_refresh_keeps_page_and_clamps(app_page):
    _seed_debts(app_page, 40)
    app_page.click("#debtsList [data-pager-dir=next]")
    _wait_page(app_page, "#debtsList", 2, 2)
    # In-place refresh (no reset): the page is kept.
    app_page.evaluate("() => window.app.refreshCurrentPageData()")
    _wait_page(app_page, "#debtsList", 2, 2)
    # The list shrinks below the current page: clamp to the new last page.
    app_page.evaluate("() => { window.app.debts = window.app.debts.slice(0, 30); window.app.refreshCurrentPageData(); }")
    app_page.wait_for_function("() => document.querySelectorAll('#debtsList .debt-card').length === 5")
    _wait_page(app_page, "#debtsList", 2, 2)
    app_page.evaluate("() => { window.app.debts = window.app.debts.slice(0, 10); window.app.refreshCurrentPageData(); }")
    app_page.wait_for_function("() => !document.querySelector('#debtsList .list-pager')")
    assert _debt_cards(app_page) == 10


def test_debts_delete_on_last_page_clamps(app_page):
    _seed_debts(app_page, 26)
    app_page.click("#debtsList [data-pager-dir=next]")
    app_page.wait_for_function("() => document.querySelectorAll('#debtsList .debt-card').length === 1")
    app_page.evaluate("() => { window.app.debts.pop(); window.app.renderDebtsList(); }")
    app_page.wait_for_function("() => document.querySelectorAll('#debtsList .debt-card').length === 25")
    assert _pager(app_page, "#debtsList").count() == 0


def test_debts_grouped_paginates_flat_order_and_repeats_heading(app_page):
    # 10 debts under "Ally" (sorts first) and 30 under "Chase".
    debts = [_debt(i, name=f"Chase - Card {i:03d}") for i in range(1, 31)]
    debts += [_debt(100 + i, name=f"Ally - Loan {i:03d}") for i in range(1, 11)]
    seed_state(app_page, {"accounts": [ACCOUNT], "debts": debts})
    _go(app_page, "liabilities")
    app_page.wait_for_selector("#debtsList .debt-card")
    app_page.select_option("#debtGroupBy", "institution")
    app_page.wait_for_function("() => document.querySelectorAll('#debtsList .debt-group-header').length > 0")
    assert _debt_cards(app_page) == 25
    assert "1-25 of 40" in _status(app_page, "#debtsList")
    first_headers = app_page.eval_on_selector_all(
        "#debtsList .debt-group-header-name", "els => els.map(e => e.textContent.trim())")
    assert first_headers == ["Ally", "Chase"]  # Ally (10) then the first 15 of Chase
    app_page.click("#debtsList [data-pager-dir=next]")
    _wait_page(app_page, "#debtsList", 2, 2)
    assert _debt_cards(app_page) == 15
    second_headers = app_page.eval_on_selector_all(
        "#debtsList .debt-group-header-name", "els => els.map(e => e.textContent.trim())")
    # Chase spans the boundary: its heading repeats, with the whole group's count.
    assert second_headers == ["Chase"]
    assert "30" in app_page.locator("#debtsList .debt-group-header").inner_text()


def test_debts_pager_accessible_names_and_focus(app_page):
    _seed_debts(app_page, 40)
    nav = app_page.locator("#debtsList nav.list-pager")
    assert nav.get_attribute("aria-label")
    assert nav.locator(".ledger-page-summary").get_attribute("aria-live") == "polite"
    nxt = app_page.locator("#debtsList [data-pager-dir=next]")
    assert nxt.inner_text().strip() == "Next"
    assert nxt.get_attribute("aria-label").startswith("Next")
    nxt.click()
    _wait_page(app_page, "#debtsList", 2, 2)
    # Next is now disabled; focus moved to Previous rather than being lost.
    assert app_page.evaluate("() => document.activeElement?.getAttribute('data-pager-dir')") == "prev"


# ------------------------------------------------------------- recurring

def test_recurring_paginate_25_per_page(app_page):
    _seed_tmpls(app_page, 60)
    assert _recurring_cards(app_page) == 25
    assert "1-25 of 60" in _status(app_page, "#recurringList")
    prev_btn = app_page.locator("#recurringList [data-pager-dir=prev]")
    next_btn = app_page.locator("#recurringList [data-pager-dir=next]")
    assert prev_btn.is_disabled()
    assert next_btn.get_attribute("aria-label") == "Next page of recurring templates"
    next_btn.click()
    _wait_page(app_page, "#recurringList", 2, 3)
    next_btn.click()
    _wait_page(app_page, "#recurringList", 3, 3)
    assert _recurring_cards(app_page) == 10
    assert next_btn.is_disabled()
    prev_btn.click()
    _wait_page(app_page, "#recurringList", 2, 3)


def test_recurring_no_controls_at_25(app_page):
    _seed_tmpls(app_page, 25)
    assert _recurring_cards(app_page) == 25
    assert _pager(app_page, "#recurringList").count() == 0


def test_recurring_sort_and_filter_reset_page_and_span_all(app_page):
    tmpls = [_tmpl(i, category="Bills" if i <= 30 else "Insurance") for i in range(1, 41)]
    seed_state(app_page, {"accounts": [ACCOUNT], "recurringTemplates": tmpls})
    _go(app_page, "recurring")
    app_page.wait_for_selector("#recurringList [data-recurring-action]")
    app_page.click("#recurringList [data-pager-dir=next]")
    _wait_page(app_page, "#recurringList", 2, 2)
    app_page.select_option("#recurringSortBy", "amount-desc")
    _wait_page(app_page, "#recurringList", 1, 2)
    first = app_page.locator("#recurringList .recurring-card").first.inner_text()
    assert "Tmpl 040" in first  # highest amount, from the far end of the list
    app_page.click("#recurringList [data-pager-dir=next]")
    _wait_page(app_page, "#recurringList", 2, 2)
    app_page.select_option("#recurringCategoryFilter", "Insurance")
    app_page.wait_for_function("() => document.querySelectorAll('#recurringList .recurring-card').length === 10")
    assert _pager(app_page, "#recurringList").count() == 0


def test_recurring_back_to_page_one_and_refresh_clamp(app_page):
    _seed_tmpls(app_page, 40)
    app_page.click("#recurringList [data-pager-dir=next]")
    _wait_page(app_page, "#recurringList", 2, 2)
    app_page.evaluate("() => window.app.refreshCurrentPageData()")
    _wait_page(app_page, "#recurringList", 2, 2)
    _go(app_page, "accounts")
    _go(app_page, "recurring")
    _wait_page(app_page, "#recurringList", 1, 2)
    app_page.click("#recurringList [data-pager-dir=next]")
    _wait_page(app_page, "#recurringList", 2, 2)
    app_page.evaluate(
        "() => { window.app.recurringTemplates = window.app.recurringTemplates.slice(0, 10); window.app.refreshCurrentPageData(); }")
    app_page.wait_for_function("() => document.querySelectorAll('#recurringList .recurring-card').length === 10")
    assert _pager(app_page, "#recurringList").count() == 0
