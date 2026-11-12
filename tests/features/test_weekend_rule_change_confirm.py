#!/usr/bin/env python3
"""
Confirm before a weekend-rule change moves paid or adjusted Ledger entries (issue #624).

Cleared and amount-override entries are keyed by date, so changing an item's weekend
rule orphans the entries sitting on dates the new rule would move. The inline edit of
a recurring template or a debt asks first, counting those entries; Cancel aborts the
whole save. Nothing prompts when no entry would move, or when the rule is unchanged.
"""

from datetime import date

import pytest

from tests.conftest import seed_state, wait_for_api

TODAY = date.today()
# A Saturday in the CURRENT month (day 8..26) so neither shift leaves the month.
SAT = next(d for d in range(8, 27) if date(TODAY.year, TODAY.month, d).weekday() == 5)


def _iso(day):
    return f"{TODAY.year}-{TODAY.month:02d}-{day:02d}"


ACCOUNT = {"id": 1, "name": "Confirm Checking", "type": "Checking", "startingBalance": 5000}


def _tmpl(day=SAT):
    return {
        "id": 1, "name": "Confirm Rent", "type": "subscription", "amount": 40,
        "frequency": "monthly", "dayOfMonth": day, "category": "Bills",
        "accountId": 1, "targetAccountId": None, "weekendRule": "none",
        "startDate": f"{TODAY.year - 1}-01-01", "endDate": None,
        "paused": False, "archived": False, "skippedMonths": [], "paidMonths": [], "paidAmounts": {},
    }


def _debt(day=SAT):
    return {
        "id": 1, "name": "Confirm Visa", "category": "Credit Card", "debtType": "creditCard", "accountId": 1,
        "accountBalance": 1000, "originalBalance": 1000, "interestRate": 10,
        "minimumPayment": 50, "originalMinimumPayment": 50, "dueDate": day, "weekendRule": "none",
    }


def _seed(page, kind, day=SAT, entries=("cleared",)):
    """Seed one item and (optionally) a Cleared and/or override entry on its date."""
    state = {"accounts": [ACCOUNT]}
    if kind == "recurring":
        state["recurringTemplates"] = [_tmpl(day)]
    else:
        state["debts"] = [_debt(day)]
    seed_state(page, state)
    ids = page.evaluate("""() => ({
        acct: window.app.accounts[0].id,
        item: (window.app.recurringTemplates[0] || window.app.debts[0]).id,
    })""")
    key = f"{kind == 'recurring' and 'recurring' or 'debt'}|{ids['item']}|{ids['acct']}|{_iso(day)}"
    page.evaluate("""async ({ key, entries }) => {
        const app = window.app;
        const { pgPut } = await import('/src/postgresSync.js');
        if (entries.includes('cleared')) {
            app.ledgerClearedTransactions[key] = { clearedKey: key, clearedDate: null };
            await pgPut(app, `/api/ledger-cleared/${key}`, { clearedDate: null });
        }
        if (entries.includes('override')) {
            app.ledgerAmountOverrides[key] = { overrideKey: key, amount: -45 };
            await pgPut(app, `/api/ledger-overrides/${key}`, { overrideKey: key, amount: -45 });
        }
    }""", {"key": key, "entries": list(entries)})
    return ids["item"]


def _open_inline_edit(page, kind, item_id):
    if kind == "recurring":
        page.evaluate("() => window.app.switchPage('recurring')")
        page.wait_for_selector('#recurringSection.active', timeout=5000)
        page.click(f'[data-recurring-action="edit"][data-recurring-id="{item_id}"]')
        page.wait_for_selector(f'#re-weekend-{item_id}', timeout=5000)
        return f'#re-weekend-{item_id}', f'[data-recurring-action="save"][data-recurring-id="{item_id}"]'
    page.evaluate("() => window.app.switchPage('liabilities')")
    page.wait_for_selector('#debtsList', timeout=5000)
    page.click(f'[data-debt-action="edit"][data-debt-id="{item_id}"]')
    page.wait_for_selector(f'#inline-weekend-{item_id}', timeout=5000)
    return f'#inline-weekend-{item_id}', f'[data-debt-action="save-inline"][data-debt-id="{item_id}"]'


def _server_rule(page, kind, item_id):
    path = '/api/recurring-templates' if kind == 'recurring' else '/api/debts'
    rows = wait_for_api(page, path, lambda r: any(x['id'] == item_id for x in r))
    return next(x['weekendRule'] for x in rows if x['id'] == item_id)


def _modal_visible(page):
    return page.locator('#deleteConfirmModal').is_visible()


@pytest.mark.feature
@pytest.mark.parametrize("kind", ["recurring", "debt"])
def test_rule_change_with_cleared_entry_prompts_and_cancel_keeps_rule(app_page, kind):
    page = app_page
    item = _seed(page, kind)
    select, save = _open_inline_edit(page, kind, item)
    page.select_option(select, 'before')
    page.click(save)
    page.wait_for_selector('#deleteConfirmModal', state='visible', timeout=5000)
    assert '1 paid or adjusted payment' in page.inner_text('#deleteConfirmMessage')
    assert page.inner_text('#deleteConfirmBtn').strip() == 'Change rule'
    page.click('#deleteConfirmCancelBtn')
    page.wait_for_selector('#deleteConfirmModal', state='hidden', timeout=5000)
    # The edit form stays open with the select restored; nothing was saved.
    assert page.input_value(select) == 'none'
    assert page.evaluate("(k) => !!Object.keys(window.app.ledgerClearedTransactions).find(x => x.startsWith(k))",
                         f"{kind}|{item}|"), "the Cleared entry is untouched"
    assert _server_rule(page, kind, item) == 'none'


@pytest.mark.feature
@pytest.mark.parametrize("kind", ["recurring", "debt"])
def test_rule_change_confirm_saves_the_rule(app_page, kind):
    page = app_page
    item = _seed(page, kind, entries=("cleared", "override"))
    select, save = _open_inline_edit(page, kind, item)
    page.select_option(select, 'before')
    page.click(save)
    page.wait_for_selector('#deleteConfirmModal', state='visible', timeout=5000)
    # Cleared and override on the same date count once.
    assert '1 paid or adjusted payment' in page.inner_text('#deleteConfirmMessage')
    page.click('#deleteConfirmBtn')
    page.wait_for_selector('#deleteConfirmModal', state='hidden', timeout=5000)
    deadline_rows = wait_for_api(
        page, '/api/recurring-templates' if kind == 'recurring' else '/api/debts',
        lambda r: any(x['id'] == item and x['weekendRule'] == 'before' for x in r))
    assert deadline_rows


@pytest.mark.feature
def test_escape_counts_as_cancel(app_page):
    page = app_page
    item = _seed(page, "recurring")
    select, save = _open_inline_edit(page, "recurring", item)
    page.select_option(select, 'after')
    page.click(save)
    page.wait_for_selector('#deleteConfirmModal', state='visible', timeout=5000)
    page.keyboard.press('Escape')
    page.wait_for_selector('#deleteConfirmModal', state='hidden', timeout=5000)
    assert page.input_value(select) == 'none'
    assert _server_rule(page, "recurring", item) == 'none'


@pytest.mark.feature
@pytest.mark.parametrize("kind", ["recurring", "debt"])
def test_rule_change_with_no_affected_entries_saves_without_prompt(app_page, kind):
    """Negative: no Cleared/override entry exists, so nothing would be orphaned."""
    page = app_page
    item = _seed(page, kind, entries=())
    select, save = _open_inline_edit(page, kind, item)
    page.select_option(select, 'before')
    page.click(save)
    wait_for_api(page, '/api/recurring-templates' if kind == 'recurring' else '/api/debts',
                 lambda r: any(x['id'] == item and x['weekendRule'] == 'before' for x in r))
    assert not _modal_visible(page)


@pytest.mark.feature
def test_entry_on_a_weekday_does_not_prompt(app_page):
    """Negative: the entry sits on a weekday occurrence, which no rule moves."""
    page = app_page
    monday = SAT - 5
    item = _seed(page, "recurring", day=monday)
    select, save = _open_inline_edit(page, "recurring", item)
    page.select_option(select, 'before')
    page.click(save)
    wait_for_api(page, '/api/recurring-templates',
                 lambda r: any(x['id'] == item and x['weekendRule'] == 'before' for x in r))
    assert not _modal_visible(page)


@pytest.mark.feature
@pytest.mark.parametrize("kind", ["recurring", "debt"])
def test_editing_another_field_without_changing_the_rule_never_prompts(app_page, kind):
    page = app_page
    item = _seed(page, kind)
    select, save = _open_inline_edit(page, kind, item)
    name_sel = f'#re-name-{item}' if kind == 'recurring' else f'#inline-name-{item}'
    page.fill(name_sel, 'Renamed Item')
    page.click(save)
    wait_for_api(page, '/api/recurring-templates' if kind == 'recurring' else '/api/debts',
                 lambda r: any(x['id'] == item and x['name'] == 'Renamed Item' for x in r))
    assert not _modal_visible(page)
    assert _server_rule(page, kind, item) == 'none'
