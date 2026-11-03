#!/usr/bin/env python3
"""
Recurring "Mark as paid" ↔ Ledger two-way sync (issue #434).

Paid state lives on the Ledger: an occurrence is paid when every ledger leg
for it is Cleared, and the actual amount is that leg's amount override. Both
are keyed by the occurrence date (recurring|<id>|<account>|<YYYY-MM-DD>).
template.paidMonths is a derived cache kept in step by every write path.
"""

import json
from datetime import date

import pytest

from tests.conftest import assert_no_errors, seed_state, wait_for_api

# Seed ids. The server assigns its own ids when data is seeded, so _seed()
# rebinds these to the real ids and every helper below reads them at call time.
ACCT = 7341
ACCT2 = 7342
TID = 9341


def _mk():
    t = date.today()
    return f"{t.year}-{t.month:02d}"


def _tx_id(account=None, day=1, tid=None):
    account = ACCT if account is None else account
    tid = TID if tid is None else tid
    t = date.today()
    return f"recurring|{tid}|{account}|{t.year}-{t.month:02d}-{day:02d}"


def _seed_server(page, templates, accounts=None):
    """Seed accounts + recurring templates through the server (no reload). Returns the accounts list."""
    accounts = accounts or [{"id": ACCT, "name": "Sync Checking", "type": "Checking", "startingBalance": 1000}]
    seed_state(page, {"accounts": accounts, "recurringTemplates": templates}, reload=False)
    return accounts


def _rebind_ids(page, accounts, templates):
    global ACCT, ACCT2, TID
    real = page.evaluate("""() => ({
        accounts: Object.fromEntries(window.app.accounts.map(a => [a.name, a.id])),
        templates: window.app.recurringTemplates.map(t => ({ name: t.name, id: t.id })),
    })""")
    mapping = {}
    for a in accounts:
        mapping[a["id"]] = real["accounts"][a["name"]]
    old_tid = templates[0]["id"] if templates else TID
    if templates:
        mapping[old_tid] = next(t["id"] for t in real["templates"] if t["name"] == templates[0]["name"])
    ACCT = mapping.get(ACCT, ACCT)
    ACCT2 = mapping.get(ACCT2, ACCT2)
    TID = mapping.get(old_tid, TID)
    return mapping


def _remap_key(key, mapping):
    kind, tid, acct, day = key.split("|")
    return "|".join([kind, str(mapping.get(int(tid), tid)), str(mapping.get(int(acct), acct)) if acct.isdigit() else acct, day])


def _seed(page, templates, accounts=None, cleared=None, overrides=None):
    accounts = _seed_server(page, templates, accounts)
    page.reload()
    mapping = _rebind_ids(page, accounts, templates)
    if cleared or overrides:
        page.evaluate("""async ({ cleared, overrides }) => {
            const app = window.app;
            const { pgPut } = await import('/src/postgresSync.js');
            for (const [k, v] of Object.entries(cleared)) {
                app.ledgerClearedTransactions[k] = { clearedKey: k, ...v };
                await pgPut(app, `/api/ledger-cleared/${k}`, v);
            }
            for (const [k, v] of Object.entries(overrides)) {
                app.ledgerAmountOverrides[k] = { overrideKey: k, ...v };
                await pgPut(app, `/api/ledger-overrides/${k}`, { ...v, overrideKey: k });
            }
        }""", {
            "cleared": {_remap_key(k, mapping): v for k, v in (cleared or {}).items()},
            "overrides": {_remap_key(k, mapping): v for k, v in (overrides or {}).items()},
        })
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector('#recurringSection.active', timeout=5000)


def _tmpl(**kw):
    t = date.today()
    base = {
        "id": TID, "name": "Sync Phone Bill", "type": "subscription", "amount": 50,
        "frequency": "monthly", "dayOfMonth": 1, "category": "Bills",
        "accountId": ACCT, "targetAccountId": None,
        "startDate": f"{t.year - 1}-01-01", "endDate": None,
        "paused": False, "archived": False, "skippedMonths": [], "paidMonths": [], "paidAmounts": {},
    }
    base.update(kw)
    return base


def _state(page):
    return page.evaluate(f"""() => {{
        const app = window.app;
        const t = app.recurringTemplates.find(x => x.id === {TID});
        return {{
            cleared: app.ledgerClearedTransactions || {{}},
            overrides: app.ledgerAmountOverrides || {{}},
            paidMonths: t?.paidMonths || [],
            paidAmounts: t?.paidAmounts || {{}},
            badge: document.querySelector('#recurring-card-{TID} .recurring-card-status')?.textContent || ''
        }};
    }}""")


def _open_modal(page):
    page.click(f'[data-recurring-action="mark-paid"][data-recurring-id="{TID}"]')
    page.wait_for_selector('#recurringMarkPaidModal', timeout=5000)


# ── Recurring → Ledger ───────────────────────────────────────────────────────

@pytest.mark.feature
def test_mark_paid_with_different_amount_clears_and_overrides_ledger(app_page):
    """Marking paid with an actual amount clears the ledger row and overrides its amount."""
    page = app_page
    _seed(page, [_tmpl()])
    _open_modal(page)
    page.fill('#recurringActualAmountInput', '65')
    page.click('#recurringMarkPaidConfirmBtn')
    page.wait_for_selector('#recurringMarkPaidModal', state='detached', timeout=5000)

    s = _state(page)
    assert _tx_id() in s['cleared'], f"ledger row not cleared: {list(s['cleared'])}"
    assert s['overrides'][_tx_id()]['amount'] == -65, "outflow override should be signed negative"
    assert _mk() in s['paidMonths']
    assert 'Paid this month' in s['badge'] and '65.00' in s['badge']

    # The amount reaches the ledger-derived numbers (balances, reports, forecast).
    ledger_amount = page.evaluate(f"""async () => {{
        const m = await import('./src/ledgerTransactions.js');
        const now = new Date();
        const map = m.buildProjectedAccountTransactions(window.app, now.getFullYear(), now.getMonth(), 1);
        const tx = map[{ACCT}].txs.find(t => t.transactionId === '{_tx_id()}');
        return m.toLedgerTxOutput(window.app, tx).amount;
    }}""")
    assert ledger_amount == -65
    assert_no_errors(page)


@pytest.mark.feature
def test_mark_paid_with_budgeted_amount_sets_no_override(app_page):
    """Confirming the prefilled (template) amount clears the row without an override."""
    page = app_page
    _seed(page, [_tmpl()])
    _open_modal(page)
    assert page.input_value('#recurringActualAmountInput') == '50'
    page.click('#recurringMarkPaidConfirmBtn')

    s = _state(page)
    assert _tx_id() in s['cleared']
    assert _tx_id() not in s['overrides']
    assert 'actual' not in s['badge']


@pytest.mark.feature
def test_unmark_paid_unclears_and_removes_override(app_page):
    """Unmark paid reverses both the Cleared flag and the amount override."""
    page = app_page
    _seed(page, [_tmpl()])
    _open_modal(page)
    page.fill('#recurringActualAmountInput', '80')
    page.click('#recurringMarkPaidConfirmBtn')
    page.click(f'[data-recurring-action="unmark-paid"][data-recurring-id="{TID}"]')

    s = _state(page)
    assert _tx_id() not in s['cleared']
    assert _tx_id() not in s['overrides']
    assert _mk() not in s['paidMonths']
    assert page.query_selector(f'[data-recurring-action="mark-paid"][data-recurring-id="{TID}"]')


@pytest.mark.feature
def test_paid_state_survives_reload(app_page):
    page = app_page
    _seed(page, [_tmpl()])
    _open_modal(page)
    page.fill('#recurringActualAmountInput', '61.5')
    page.click('#recurringMarkPaidConfirmBtn')
    page.evaluate("() => window.flushStorageSave && window.flushStorageSave()")
    # Mutations are fire-and-forget: be sure the server has both before reloading.
    wait_for_api(page, '/api/ledger-cleared', lambda rows: any(r['clearedKey'] == _tx_id() for r in rows))
    wait_for_api(page, '/api/ledger-overrides', lambda rows: any(r['overrideKey'] == _tx_id() for r in rows))
    page.reload(wait_until="networkidle")
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector(f'#recurring-card-{TID}', timeout=5000)

    s = _state(page)
    assert _tx_id() in s['cleared']
    assert s['overrides'][_tx_id()]['amount'] == -61.5
    assert 'Paid this month' in s['badge']


# ── Ledger → Recurring ───────────────────────────────────────────────────────

@pytest.mark.feature
def test_ledger_cleared_checkbox_marks_recurring_paid_and_back(app_page):
    """Checking Cleared on the Ledger row marks the recurring item paid; unchecking reverts it."""
    page = app_page
    _seed(page, [_tmpl()])
    page.evaluate("() => window.app.switchPage('ledger')")
    sel = f'[data-ledger-cleared="{_tx_id()}"]'
    page.wait_for_selector(sel, timeout=10000)

    page.click(sel)
    assert _mk() in _state(page)['paidMonths']
    page.evaluate("() => window.app.switchPage('recurring')")
    assert 'Paid this month' in _state(page)['badge']

    page.evaluate("() => window.app.switchPage('ledger')")
    page.wait_for_selector(sel, timeout=10000)
    page.click(sel)
    assert _mk() not in _state(page)['paidMonths']
    page.evaluate("() => window.app.switchPage('recurring')")
    assert 'Paid this month' not in _state(page)['badge']
    assert_no_errors(page)


@pytest.mark.feature
def test_ledger_override_shows_as_actual_on_paid_card(app_page):
    """An amount override entered on the Ledger shows as the card's actual amount."""
    page = app_page
    _seed(page, [_tmpl()],
          cleared={_tx_id(): {"clearedAt": "2026-01-01T00:00:00.000Z"}},
          overrides={_tx_id(): {"amount": -72, "originalAmount": -50, "memo": ""}})
    s = _state(page)
    assert _mk() in s['paidMonths'], "reconcile should derive paidMonths from the cleared ledger row"
    assert 'Paid this month' in s['badge'] and '72.00' in s['badge']


# ── Multiple occurrences per month: tied to each date ────────────────────────

@pytest.mark.feature
def test_weekly_template_has_one_row_per_date_and_partial_badge(app_page):
    """A weekly template gets one row per occurrence; paying only some shows 'Paid N of M'."""
    page = app_page
    t = date.today()
    _seed(page, [_tmpl(frequency="weekly", startDate=f"{t.year}-{t.month:02d}-01")])
    _open_modal(page)
    rows = page.query_selector_all('#recurringMarkPaidModal .recurring-paid-row')
    assert len(rows) >= 4, f"expected one row per weekly occurrence, got {len(rows)}"

    isos = page.eval_on_selector_all(
        '#recurringMarkPaidModal input[type="checkbox"][data-paid-iso]',
        'els => els.map(e => e.getAttribute("data-paid-iso"))')
    # Pay only the first date, at a different amount; untick the rest.
    for i in range(1, len(isos)):
        page.uncheck(f'#recurringPaidCheck-{i}')
    page.fill('#recurringActualAmountInput', '55')
    page.click('#recurringMarkPaidConfirmBtn')

    s = _state(page)
    first = f"recurring|{TID}|{ACCT}|{isos[0]}"
    assert first in s['cleared'] and s['overrides'][first]['amount'] == -55
    for iso in isos[1:]:
        key = f"recurring|{TID}|{ACCT}|{iso}"
        assert key not in s['cleared'] and key not in s['overrides'], f"{iso} should be untouched"
    assert _mk() not in s['paidMonths'], "a partly paid month is not cached as paid"
    assert f"Paid 1 of {len(isos)}" in s['badge']


@pytest.mark.feature
def test_transfer_template_clears_both_legs_with_signed_overrides(app_page):
    page = app_page
    accounts = [
        {"id": ACCT, "name": "Sync Checking", "type": "Checking", "startingBalance": 1000},
        {"id": ACCT2, "name": "Sync Savings", "type": "Savings", "startingBalance": 0},
    ]
    _seed(page, [_tmpl(type="transfer", targetAccountId=ACCT2, category="Transfer")], accounts=accounts)
    _open_modal(page)
    page.fill('#recurringActualAmountInput', '75')
    page.click('#recurringMarkPaidConfirmBtn')

    s = _state(page)
    out_leg, in_leg = _tx_id(ACCT), _tx_id(ACCT2)
    assert out_leg in s['cleared'] and in_leg in s['cleared']
    assert s['overrides'][out_leg]['amount'] == -75
    assert s['overrides'][in_leg]['amount'] == 75


@pytest.mark.feature
def test_unlinked_template_uses_unlinked_ledger_key(app_page):
    """A template with no account still syncs under the ledger's __unlinked__ key."""
    page = app_page
    _seed(page, [_tmpl(accountId=None)])
    _open_modal(page)
    page.click('#recurringMarkPaidConfirmBtn')
    assert _tx_id(account='__unlinked__') in _state(page)['cleared']


# ── Legacy data migration ────────────────────────────────────────────────────

@pytest.mark.feature
def test_legacy_paid_month_and_amount_migrate_to_ledger_on_load(app_page):
    """Pre-#434 data (paidMonths + paidAmounts on the template) migrates into the ledger maps on reload."""
    page = app_page
    mk = _mk()
    accounts = _seed_server(page, [_tmpl(paidMonths=[mk])])
    page.reload()
    _rebind_ids(page, accounts, [_tmpl()])
    # paidAmounts was never persisted to Postgres, so the server can't hand legacy amounts
    # back on load (and the load-time reconcile has already cleared the month from paidMonths
    # alone). Rewind to the pre-#434 shape in memory -- paidMonths + paidAmounts, nothing
    # cleared -- and run the same reconcile that runs on load.
    changed = page.evaluate("""async ([tid, mk]) => {
        const app = window.app;
        const { pgDelete } = await import('/src/postgresSync.js');
        for (const k of Object.keys(app.ledgerClearedTransactions)) {
            delete app.ledgerClearedTransactions[k];
            pgDelete(app, `/api/ledger-cleared/${k}`);
        }
        const t = app.recurringTemplates.find(x => x.id === tid);
        t.paidMonths = [mk];
        t.paidAmounts = { [mk]: 70 };
        return app.reconcileRecurringPaidState();
    }""", [TID, mk])
    assert changed is True
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector(f'#recurring-card-{TID}', timeout=5000)

    s = _state(page)
    assert _tx_id() in s['cleared']
    assert s['overrides'][_tx_id()]['amount'] == -70
    assert s['paidAmounts'] == {}, "legacy paidAmounts should be emptied after migration"
    assert mk in s['paidMonths']
    assert 'Paid this month' in s['badge'] and '70.00' in s['badge']


@pytest.mark.feature
def test_reconcile_is_idempotent(app_page):
    page = app_page
    _seed(page, [_tmpl(paidMonths=[_mk()])])
    first = _state(page)
    changed = page.evaluate("() => window.app.reconcileRecurringPaidState()")
    assert changed is False
    assert _state(page)['cleared'].keys() == first['cleared'].keys()


@pytest.mark.feature
def test_new_occurrence_in_paid_month_is_not_auto_paid(app_page):
    """Once the Ledger owns a month (some leg cleared), an occurrence added later
    (e.g. a start-date edit) must not be marked paid by reconcile."""
    page = app_page
    t = date.today()
    if t.day > 20:
        pytest.skip("needs room for a later weekly start date this month")
    mid = t.day + 7 if t.day + 7 <= 28 else 28
    tmpl = _tmpl(frequency="weekly", startDate=f"{t.year}-{t.month:02d}-{mid:02d}")
    _seed(page, [tmpl])
    _open_modal(page)
    page.click('#recurringMarkPaidConfirmBtn')
    assert _mk() in _state(page)['paidMonths']
    before = set(_state(page)['cleared'])

    # Move the start date back to the 1st: the month gains earlier occurrences.
    page.evaluate(f"""() => {{
        const t = window.app.recurringTemplates.find(x => x.id === {TID});
        t.startDate = '{t.year}-{t.month:02d}-01';
        window.app.renderRecurringPage();
    }}""")
    s = _state(page)
    assert set(s['cleared']) == before, "new occurrences must stay unpaid"
    assert _mk() not in s['paidMonths']
    assert 'Paid this month' not in s['badge']


@pytest.mark.feature
def test_moved_occurrences_in_paid_month_are_not_auto_paid(app_page):
    """Date-independent variant of the test above: weekly from the 2nd, then
    moved to the 1st, so no new occurrence shares a date with a cleared leg.
    The month is still Ledger-owned (a leg for this template/month is
    cleared), so reconcile must not clear the moved occurrences. Before the
    fix this failed whenever the dates didn't overlap."""
    page = app_page
    t = date.today()
    tmpl = _tmpl(frequency="weekly", startDate=f"{t.year}-{t.month:02d}-02")
    _seed(page, [tmpl])
    _open_modal(page)
    page.click('#recurringMarkPaidConfirmBtn')
    assert _mk() in _state(page)['paidMonths']
    before = set(_state(page)['cleared'])
    assert before, "marking paid should clear at least one leg"

    page.evaluate(f"""() => {{
        const t = window.app.recurringTemplates.find(x => x.id === {TID});
        t.startDate = '{t.year}-{t.month:02d}-01';
        window.app.renderRecurringPage();
    }}""")
    s = _state(page)
    assert set(s['cleared']) == before, "moved occurrences must stay unpaid"
    assert _mk() not in s['paidMonths']


@pytest.mark.feature
def test_paused_template_keeps_paid_history(app_page):
    """A paused template has no occurrences right now; its paid months must not be dropped."""
    page = app_page
    mk = _mk()
    _seed(page, [_tmpl(paused=True, paidMonths=[mk])])
    assert mk in _state(page)['paidMonths']


# ── Negative cases ───────────────────────────────────────────────────────────

@pytest.mark.feature
def test_negative_amount_is_rejected_and_nothing_changes(app_page):
    page = app_page
    _seed(page, [_tmpl()])
    _open_modal(page)
    page.fill('#recurringActualAmountInput', '-5')
    page.click('#recurringMarkPaidConfirmBtn')

    assert page.is_visible('#recurringMarkPaidError')
    assert page.query_selector('#recurringMarkPaidModal'), "modal should stay open"
    s = _state(page)
    assert _tx_id() not in s['cleared'] and _tx_id() not in s['overrides']
    assert _mk() not in s['paidMonths']


@pytest.mark.feature
def test_zero_amount_blocked_by_policy_changes_nothing(app_page):
    page = app_page
    _seed(page, [_tmpl()])
    page.evaluate("""() => {
        const app = window.app;
        app.settings = (app.settings || []).filter(s => s.key !== 'zeroAmountPolicy');
        app.settings.push({ key: 'zeroAmountPolicy', value: 'block' });
    }""")
    _open_modal(page)
    page.fill('#recurringActualAmountInput', '0')
    page.click('#recurringMarkPaidConfirmBtn')
    page.wait_for_selector('#alertModalOkBtn', state='visible', timeout=5000)
    page.click('#alertModalOkBtn')

    s = _state(page)
    assert _tx_id() not in s['cleared'] and _tx_id() not in s['overrides']


@pytest.mark.feature
def test_ledger_clear_of_non_recurring_row_does_not_touch_templates(app_page):
    page = app_page
    _seed(page, [_tmpl()])
    changed = page.evaluate(f"""() => window.app.syncRecurringPaidFromLedger([
        'income|5|{ACCT}|2026-01-01', 'garbage', null, 'recurring|abc|x|bad'
    ])""")
    assert changed is False
    assert _state(page)['paidMonths'] == []


@pytest.mark.feature
def test_cancel_leaves_ledger_untouched(app_page):
    page = app_page
    _seed(page, [_tmpl()])
    _open_modal(page)
    page.fill('#recurringActualAmountInput', '99')
    page.click('#recurringMarkPaidCancelBtn')
    s = _state(page)
    assert s['cleared'] == {} and s['overrides'] == {}
