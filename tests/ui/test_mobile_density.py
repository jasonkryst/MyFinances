#!/usr/bin/env python3
"""
Mobile density (issue #428): filter disclosures, collapsible add forms, 2-line
Ledger rows, 40px tap-target floor, account-card actions, scrollable Reports
tab strip, Reconcile accordion. Each behavior is asserted on a phone viewport
(positive) and on desktop (the unchanged layout, negative).
"""

import pytest

PHONE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}

SEED = """() => {
    const app = window.app;
    app.accounts = [
        { id: 7001, name: 'Everyday Checking', type: 'Checking', startingBalance: 3000, archived: false },
        { id: 7002, name: 'Rainy Savings', type: 'Savings', startingBalance: 9000, archived: false },
        { id: 7003, name: 'Work 401k', type: 'Retirement', retirementSubtype: '401k', startingBalance: 50000, rateOfReturn: 7, archived: false }
    ];
    app.incomes = [{ id: 7101, name: 'Paycheck', amount: 2500, firstPayDate: '2026-10-02', frequency: 'biweekly', accountId: 7001, withholdingPercent: 0 }];
    app.recurringTemplates = [{ id: 7201, name: 'Netflix', type: 'subscription', amount: 15.49, frequency: 'monthly', dayOfMonth: 9,
        category: 'Entertainment', accountId: 7001, targetAccountId: null, startDate: '2026-01-01', endDate: null, paused: false,
        pauseUntil: null, archived: false, skippedMonths: [], paidMonths: [], paidAmounts: {} }];
    app.debts = [{ id: 7301, name: 'Test Card', category: 'Credit Card', debtType: 'creditCard', accountId: 7001, accountBalance: 1200,
        originalBalance: 1500, interestRate: 19.9, minimumPayment: 40, originalMinimumPayment: 40, dueDate: 12, creditLimit: 3000, archived: false }];
    app._ledgerDateRange = 'all';
    app.updateUI();
}"""


def _go(page, name, viewport):
    page.set_viewport_size(viewport)
    page.evaluate(SEED)
    page.evaluate("async (n) => { window.app.switchPage(n); }", name)


def _visible(page, sel):
    return page.evaluate(
        """(s) => { const e = document.querySelector(s); if (!e) return false;
            const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }""", sel)


# ── C6: filter disclosures ──────────────────────────────────────────────────

@pytest.mark.ui
def test_ledger_filters_collapsed_on_phone_and_toggle_open(app_page):
    page = app_page
    _go(page, 'ledger', PHONE)
    page.wait_for_selector('#ledgerFiltersToggle', state='visible')
    assert page.get_attribute('#ledgerFiltersToggle', 'aria-expanded') == 'false'
    assert page.get_attribute('#ledgerFiltersToggle', 'aria-controls') == 'ledgerFiltersBody'
    assert not _visible(page, '#ledgerAccountFilter'), "filters must start collapsed on phone"
    page.click('#ledgerFiltersToggle')
    assert page.get_attribute('#ledgerFiltersToggle', 'aria-expanded') == 'true'
    assert _visible(page, '#ledgerAccountFilter')
    # 2-column grid: account and category selects share a row
    tops = page.evaluate("() => ['ledgerAccountFilter','ledgerCategoryFilter'].map(i => Math.round(document.getElementById(i).getBoundingClientRect().top))")
    assert tops[0] == tops[1], tops


@pytest.mark.ui
def test_ledger_filter_count_and_value_survive_rerender(app_page):
    page = app_page
    _go(page, 'ledger', PHONE)
    page.click('#ledgerFiltersToggle')
    before = page.inner_text('#ledgerFiltersToggle').strip()
    assert before.startswith('Filters')
    page.select_option('#ledgerClearedFilter', 'uncleared')
    page.wait_for_selector('#ledgerFiltersToggle')
    # the bar re-rendered: still open, value kept, count reflects non-default filters
    assert page.get_attribute('#ledgerFiltersToggle', 'aria-expanded') == 'true'
    assert page.input_value('#ledgerClearedFilter') == 'uncleared'
    after = page.inner_text('#ledgerFiltersToggle').strip()
    assert 'active' in after and after != before
    page.click('#ledgerClearFiltersBtn')
    assert page.input_value('#ledgerClearedFilter') == 'all'
    assert page.inner_text('#ledgerFiltersToggle').strip() == 'Filters'


@pytest.mark.ui
def test_ledger_filters_inline_and_compact_on_desktop(app_page):
    page = app_page
    _go(page, 'ledger', DESKTOP)
    page.wait_for_selector('#ledgerAccountFilter', state='visible')
    assert not _visible(page, '#ledgerFiltersToggle'), "disclosure toggle is phone-only"
    for sel in ['#ledgerAccountFilter', '#ledgerDateRange', '#ledgerClearedFilter']:
        w = page.evaluate("(s) => document.querySelector(s).getBoundingClientRect().width", sel)
        assert w <= 201, f"{sel} should be compact on desktop, got {w}"


@pytest.mark.ui
@pytest.mark.parametrize("page_name,toggle,body,select,value", [
    ('liabilities', '#debtFiltersToggle', '#debtFiltersBody', '#categoryFilter', None),
    ('recurring', '#recurringFiltersToggle', '#recurringFiltersBody', '#recurringAccountFilter', '7001'),
])
def test_static_filter_disclosure_counts_active_filters(app_page, page_name, toggle, body, select, value):
    page = app_page
    _go(page, page_name, PHONE)
    page.wait_for_selector(toggle, state='visible')
    assert page.inner_text(toggle).strip() == 'Filters'
    assert not _visible(page, select)
    page.click(toggle)
    assert _visible(page, select)
    if value is None:
        value = page.evaluate("(s) => { const o = [...document.querySelector(s).options].find(o => o.value); return o ? o.value : null; }", select)
    page.select_option(select, value)
    assert page.inner_text(toggle).strip() == 'Filters (1 active)'
    assert page.input_value(select) == value  # value preserved, not reset by collapsing
    page.click(toggle)
    assert not _visible(page, select)
    assert page.input_value(select) == value
    page.click(toggle)
    page.select_option(select, index=0)
    assert page.inner_text(toggle).strip() == 'Filters'


@pytest.mark.ui
def test_static_filters_always_visible_on_desktop(app_page):
    page = app_page
    _go(page, 'recurring', DESKTOP)
    page.wait_for_selector('#recurringAccountFilter', state='visible')
    assert not _visible(page, '#recurringFiltersToggle')


# ── M3: collapsed add forms ────────────────────────────────────────────────

@pytest.mark.ui
def test_account_form_collapsed_then_opens_and_submits(app_page):
    page = app_page
    _go(page, 'accounts', PHONE)
    page.wait_for_selector('#accountFormToggle', state='visible')
    assert page.get_attribute('#accountFormToggle', 'aria-expanded') == 'false'
    assert not _visible(page, '#accountName'), "form fields hidden until toggled"
    page.click('#accountFormToggle')
    assert page.get_attribute('#accountFormToggle', 'aria-expanded') == 'true'
    page.fill('#accountName', 'Phone Added Account')
    page.fill('#accountStartingBalance', '123')
    page.click('#accountFormSubmit')
    page.wait_for_selector('#accountList >> text=Phone Added Account', timeout=10000)


@pytest.mark.ui
def test_income_form_collapsed_then_opens_and_submits(app_page):
    page = app_page
    _go(page, 'income', PHONE)
    page.wait_for_selector('#incomeFormToggle', state='visible')
    assert not _visible(page, '#incomeName')
    page.click('#incomeFormToggle')
    assert _visible(page, '#incomeName')
    page.fill('#incomeName', 'Phone Side Gig')
    page.fill('#incomeAmount', '400')
    page.fill('#incomeFirstDate', '2026-11-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector('#incomeList >> text=Phone Side Gig', timeout=10000)


@pytest.mark.ui
@pytest.mark.parametrize("page_name,toggle,field", [('accounts', '#accountFormToggle', '#accountName'), ('income', '#incomeFormToggle', '#incomeName')])
def test_add_forms_open_and_toggleless_on_desktop(app_page, page_name, toggle, field):
    page = app_page
    _go(page, page_name, DESKTOP)
    page.wait_for_selector(field, state='visible')
    assert not _visible(page, toggle)


# ── H3: Ledger rows ────────────────────────────────────────────────────────

@pytest.mark.ui
def test_ledger_phone_row_shows_amount_and_balance_inside_viewport(app_page):
    page = app_page
    _go(page, 'ledger', PHONE)
    page.wait_for_selector('.ledger-table tbody td[data-col="amount"]', state='visible')
    info = page.evaluate("""() => {
        const tr = [...document.querySelectorAll('.ledger-table tbody tr')].find(r => r.querySelector('td[data-col="amount"]'));
        const rect = s => { const r = tr.querySelector(s).getBoundingClientRect(); return {l: r.left, r: r.right, t: r.top, b: r.bottom}; };
        return { amount: rect('td[data-col="amount"]'), balance: rect('td[data-col="balance"]'), name: rect('td[data-col="name"]'),
                 date: rect('td[data-col="date"]'), iw: innerWidth, sw: document.documentElement.scrollWidth,
                 dateWrap: getComputedStyle(tr.querySelector('td[data-col="date"]')).whiteSpace };
    }""")
    assert info['amount']['r'] <= info['iw'] and info['amount']['l'] >= 0, info
    assert info['balance']['r'] <= info['iw'] and info['balance']['l'] >= 0, info
    assert info['sw'] <= info['iw'] + 1, "no horizontal page scroll"
    assert info['dateWrap'] == 'nowrap'
    # two-line layout: name above date, amount above balance
    assert info['name']['t'] < info['date']['t'] and info['amount']['t'] < info['balance']['t']


@pytest.mark.ui
def test_ledger_phone_keeps_sort_headers_and_controls_labelled(app_page):
    page = app_page
    _go(page, 'ledger', PHONE)
    page.wait_for_selector('.ledger-table th[data-key="amount"]', state='visible')
    for key in ['date', 'account', 'name', 'amount', 'balance']:
        assert _visible(page, f'.ledger-table th[data-key="{key}"]')
        assert page.get_attribute(f'.ledger-table th[data-key="{key}"]', 'aria-label').startswith('Sort by')
    assert _visible(page, '.ledger-cleared-checkbox')
    assert page.get_attribute('.ledger-cleared-checkbox', 'aria-label')
    assert _visible(page, '.ledger-override-btn')
    page.click('.ledger-table th[data-key="amount"]')
    assert page.get_attribute('.ledger-table th[data-key="amount"]', 'aria-sort') in ('ascending', 'descending')


@pytest.mark.ui
def test_ledger_desktop_keeps_real_table(app_page):
    page = app_page
    _go(page, 'ledger', DESKTOP)
    page.wait_for_selector('.ledger-table tbody td[data-col="amount"]', state='visible')
    assert page.evaluate("() => getComputedStyle(document.querySelector('.ledger-table')).display") == 'table'
    assert page.evaluate("() => getComputedStyle(document.querySelector('.ledger-table tbody tr')).display") == 'table-row'


# ── C7: tap-target floor ───────────────────────────────────────────────────

SMALL_JS = """() => {
    const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('.sr-only, [hidden]'); };
    return [...document.querySelectorAll('button, select:not([multiple]), input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .btn-small, .rpt-tab-btn, [role=tab]')]
        .filter(vis).filter(e => e.getBoundingClientRect().height < 39.5)
        .map(e => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
}"""


@pytest.mark.ui
@pytest.mark.parametrize("page_name", ['ledger', 'accounts', 'income', 'recurring', 'liabilities', 'reports'])
def test_tap_targets_at_least_40px_on_phone(app_page, page_name):
    page = app_page
    _go(page, page_name, PHONE)
    if page_name == 'reports':
        page.wait_for_selector('.rpt-tab-btn', state='visible')
    elif page_name == 'liabilities':
        page.click('[data-liabilities-subtab="expenses"]')
        page.wait_for_timeout(300)
    else:
        page.wait_for_timeout(500)
    small = page.evaluate(SMALL_JS)
    assert small == [], f"{page_name}: controls under 40px: {small}"


@pytest.mark.ui
def test_tap_target_floor_not_applied_on_desktop(app_page):
    page = app_page
    _go(page, 'ledger', DESKTOP)
    page.wait_for_selector('.ledger-override-btn', state='visible')
    h = page.evaluate("() => document.querySelector('.ledger-override-btn').getBoundingClientRect().height")
    assert h < 40, f"desktop small buttons keep their compact size, got {h}"


@pytest.mark.ui
def test_help_icon_hit_area_is_40px_without_growing(app_page):
    page = app_page
    _go(page, 'income', PHONE)
    page.click('#incomeFormToggle')
    page.wait_for_selector('#incomeForm .help-icon', state='visible')
    res = page.evaluate("""() => {
        const el = document.querySelector('#incomeForm .help-icon'); const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = (dx, dy) => { const t = document.elementFromPoint(cx + dx, cy + dy); return t === el; };
        return { w: r.width, h: r.height, near: hit(14, 0) || hit(0, 14) || hit(-14, 0), far: hit(60, 0) && hit(0, 60) };
    }""")
    assert res['w'] < 30 and res['h'] < 30, "badge must not grow visually"
    assert res['near'], "a tap ~14px off-centre still lands on the badge"
    assert not res['far'], "hit area must stay bounded"


# ── M2: account card actions ───────────────────────────────────────────────

@pytest.mark.ui
def test_transfer_hidden_for_retirement_present_for_checking(app_page):
    page = app_page
    _go(page, 'accounts', DESKTOP)
    page.wait_for_selector('#accountList .acct-card')
    assert page.locator('[data-account-action="transfer"][data-account-id="7001"]').count() == 1
    assert page.locator('[data-account-action="transfer"][data-account-id="7002"]').count() == 1
    assert page.locator('[data-account-action="transfer"][data-account-id="7003"]').count() == 0
    assert page.locator('[data-account-action="delete"][data-account-id="7003"]').count() == 1


@pytest.mark.ui
def test_account_actions_are_a_two_column_grid_on_phone(app_page):
    page = app_page
    _go(page, 'accounts', PHONE)
    page.wait_for_selector('#accountList .acct-card-actions')
    res = page.evaluate("""() => {
        const box = document.querySelector('#accountList .acct-card-actions');
        const kids = [...box.children].map(k => k.getBoundingClientRect());
        const b = box.getBoundingClientRect();
        return { display: getComputedStyle(box).display, inside: kids.every(k => k.left >= b.left - 1 && k.right <= b.right + 1),
                 firstRowShared: Math.round(kids[0].top) === Math.round(kids[1].top) };
    }""")
    assert res['display'] == 'grid' and res['inside'] and res['firstRowShared'], res


# ── L1: Reports tab strip ──────────────────────────────────────────────────

@pytest.mark.ui
def test_reports_tabs_single_scrollable_row_on_phone(app_page):
    page = app_page
    _go(page, 'reports', PHONE)
    page.wait_for_selector('.rpt-tab-btn', state='visible')
    res = page.evaluate("""() => {
        const bar = document.querySelector('.rpt-tab-bar');
        const tops = [...document.querySelectorAll('.rpt-tab-btn')].map(b => Math.round(b.getBoundingClientRect().top));
        return { rows: new Set(tops).size, scroll: bar.scrollWidth > bar.clientWidth + 4, ox: getComputedStyle(bar).overflowX };
    }""")
    assert res['rows'] == 1 and res['scroll'] and res['ox'] == 'auto', res


@pytest.mark.ui
def test_reports_tabs_not_a_scroller_on_desktop(app_page):
    page = app_page
    _go(page, 'reports', DESKTOP)
    page.wait_for_selector('.rpt-tab-btn', state='visible')
    assert page.evaluate("() => getComputedStyle(document.querySelector('.rpt-tab-bar')).overflowX") != 'auto'


# ── L4: Reconcile accordion ────────────────────────────────────────────────

def _go_reconcile(page, viewport):
    page.set_viewport_size(viewport)
    page.evaluate(SEED)
    page.evaluate("async () => { window.app.switchPage('reconcile'); await window.app.renderReconciliationPage(); }")
    page.wait_for_selector('#recon-balance-7001', state='attached', timeout=10000)


@pytest.mark.ui
def test_reconcile_collapses_all_but_first_account_on_phone(app_page):
    page = app_page
    _go_reconcile(page, PHONE)
    assert _visible(page, '#recon-balance-7001'), "first account form open"
    assert not _visible(page, '#recon-balance-7002'), "later accounts collapsed"
    toggle = '[data-collapse-toggle="recon-card-body-7002"]'
    assert page.get_attribute(toggle, 'aria-expanded') == 'false'
    assert 'tracked' in page.inner_text(toggle)
    page.click(toggle)
    assert _visible(page, '#recon-balance-7002')
    assert page.get_attribute(toggle, 'aria-expanded') == 'true'


@pytest.mark.ui
def test_reconcile_all_forms_visible_on_desktop(app_page):
    page = app_page
    _go_reconcile(page, DESKTOP)
    assert _visible(page, '#recon-balance-7001') and _visible(page, '#recon-balance-7002')
    assert not _visible(page, '[data-collapse-toggle="recon-card-body-7002"]')
