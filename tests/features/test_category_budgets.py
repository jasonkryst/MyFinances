#!/usr/bin/env python3
"""
Category Budgets Tests (#255)
Covers app.budgetCategories: sanitizer, the Category Budgets panel on
Liabilities -> Expenses (Budget) sub-tab, and the Budget vs. Actual table on
Reports -> Variance.
"""

import json

import pytest

from tests.conftest import wait_for_api


SEED_JS = """() => {
    const app = window.app;
    const now = new Date();
    const y = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    app.accounts = [{ id: 9301, name: 'Checking', type: 'Checking', startingBalance: 5000 }];
    app.incomes = []; app.bonuses = []; app.bills = []; app.debts = [];
    app.recurringTemplates = []; app.emergencyFunds = []; app.sinkingFunds = [];
    app.monthlySnapshots = [];
    app.expenses = [
        { id: 1, name: 'Rent', budgetAmount: 1500, date: `${y}-${mm}-05`, category: 'Housing', accountId: 9301 },
        { id: 2, name: 'Groceries', budgetAmount: 200, date: `${y}-${mm}-06`, category: 'Food', accountId: 9301 }
    ];
    app.budgetCategories = {};
    app._reportMonthOffset = 0;
    app._reportRangeMonths = 1;
}"""


def _seed(page):
    page.wait_for_function("() => window.app && window.app.accounts", timeout=10000)
    page.evaluate(SEED_JS)


def _open_panel(page):
    page.evaluate("() => window.app.switchPage('liabilities')")
    page.click('[data-liabilities-subtab="expenses"]')
    page.wait_for_selector('#categoryBudgetsPanel .cb-row', timeout=5000)


def _row(page, category):
    return page.locator(f'#categoryBudgetsPanel .cb-row[data-category="{category}"]')


def _open_variance(page):
    page.evaluate("() => window.app.switchPage('reports')")
    page.click('[data-rptab="variance"]')
    page.wait_for_selector('#rptPanel-variance.rpt-tab-panel--active', timeout=5000)
    page.wait_for_selector('#budgetVsActual', timeout=5000)


def _bva(page, category):
    return page.locator(f'#budgetVsActual .bva-row[data-category="{category}"]')


def _set_fixed(page, category, amount):
    row = _row(page, category)
    row.locator('.cb-mode').select_option('fixed')
    row.locator('.cb-amount').fill(str(amount))
    row.locator('.cb-save').click()
    page.wait_for_function(
        "(c) => (window.app.budgetCategories[c] || {}).mode === 'fixed'", arg=category, timeout=5000)


@pytest.mark.feature
def test_defaults_are_derived_and_match_scheduled_amounts(app_page):
    page = app_page
    _seed(page)
    assert page.evaluate("() => window.app.budgetCategories") == {}
    _open_variance(page)
    row = _bva(page, 'Housing')
    assert row.locator('.bva-budget').inner_text() == '$1,500.00'
    assert row.locator('.bva-actual').inner_text() == '$1,500.00'
    assert row.locator('.bva-mode').inner_text() == 'Derived'
    assert 'bva-row--over' not in (row.get_attribute('class') or '')


@pytest.mark.feature
def test_fixed_budget_shows_in_variance_with_difference(app_page):
    page = app_page
    _seed(page)
    _open_panel(page)
    _set_fixed(page, 'Housing', 2000)
    _open_variance(page)
    row = _bva(page, 'Housing')
    assert row.locator('.bva-budget').inner_text() == '$2,000.00'
    assert row.locator('.bva-diff').inner_text() == '$500.00'
    assert row.locator('.bva-pct').inner_text() == '75%'
    assert row.locator('.bva-mode').inner_text() == 'Fixed'
    assert 'bva-row--over' not in (row.get_attribute('class') or '')


@pytest.mark.feature
def test_over_budget_row_is_highlighted(app_page):
    page = app_page
    _seed(page)
    _open_panel(page)
    _set_fixed(page, 'Housing', 1000)
    _open_variance(page)
    row = _bva(page, 'Housing')
    assert 'bva-row--over' in row.get_attribute('class')
    assert row.locator('.bva-diff').inner_text().startswith('-$500.00')
    assert row.locator('.bva-pct').inner_text() == '150%'


@pytest.mark.feature
def test_reset_returns_category_to_derived(app_page):
    page = app_page
    _seed(page)
    _open_panel(page)
    _set_fixed(page, 'Housing', 2000)
    row = _row(page, 'Housing')
    row.locator('.cb-reset').click()
    page.wait_for_function("() => !('Housing' in window.app.budgetCategories)", timeout=5000)
    _open_variance(page)
    assert _bva(page, 'Housing').locator('.bva-budget').inner_text() == '$1,500.00'
    assert _bva(page, 'Housing').locator('.bva-mode').inner_text() == 'Derived'


@pytest.mark.feature
def test_multi_month_range_multiplies_fixed_budget(app_page):
    page = app_page
    _seed(page)
    page.evaluate("() => { window.app.budgetCategories = { Housing: { mode: 'fixed', amount: 2000 } }; }")
    _open_variance(page)
    page.select_option('#varianceRangeMonths', '3')
    page.wait_for_function("() => document.querySelector('#budgetVsActual .bva-budget').textContent === '$6,000.00'", timeout=5000)
    row = _bva(page, 'Housing')
    assert row.locator('.bva-budget').inner_text() == '$6,000.00'
    # One dated expense falls inside the 3-month window.
    assert row.locator('.bva-actual').inner_text() == '$1,500.00'
    assert row.locator('.bva-diff').inner_text() == '$4,500.00'


@pytest.mark.feature
def test_validation_rejects_blank_negative_and_nonnumeric_inline(app_page):
    page = app_page
    _seed(page)
    _open_panel(page)
    row = _row(page, 'Housing')
    row.locator('.cb-mode').select_option('fixed')
    # blank
    row.locator('.cb-save').click()
    assert 'amount' in row.locator('.cb-error').inner_text().lower()
    # negative
    row.locator('.cb-amount').fill('-5')
    row.locator('.cb-save').click()
    assert 'negative' in row.locator('.cb-error').inner_text().lower()
    # nothing was saved
    assert page.evaluate("() => window.app.budgetCategories") == {}
    # non-numeric text cannot be typed into a number input; same path as blank
    # add form: blank name rejected
    page.fill('#cbNewName', '')
    page.fill('#cbNewAmount', '10')
    page.click('#cbAddBtn')
    assert page.locator('#cbAddError').inner_text() != ''
    assert page.evaluate("() => window.app.budgetCategories") == {}


@pytest.mark.feature
def test_add_new_category_budget_and_reset_buttons_are_labelled(app_page):
    page = app_page
    _seed(page)
    _open_panel(page)
    page.fill('#cbNewName', 'Pets')
    page.fill('#cbNewAmount', '75.5')
    page.click('#cbAddBtn')
    page.wait_for_selector('#categoryBudgetsPanel .cb-row[data-category="Pets"]', timeout=5000)
    assert page.evaluate("() => window.app.budgetCategories.Pets") == {'mode': 'fixed', 'amount': 75.5}
    row = _row(page, 'Pets')
    assert row.locator('.cb-save').get_attribute('aria-label') == 'Save budget for Pets'
    assert row.locator('.cb-reset').get_attribute('aria-label') == 'Reset Pets to derived'
    # Derived rows have a disabled amount input
    assert _row(page, 'Food').locator('.cb-amount').is_disabled()


@pytest.mark.feature
def test_budget_persists_across_reload(app_page):
    page = app_page
    _seed(page)
    page.evaluate("() => { window.app.budgetCategories = { Housing: { mode: 'fixed', amount: 2000 } }; window.app.saveToStorage(['budgetCategories']); }")
    wait_for_api(page, '/api/plan-settings', lambda d: d.get('budgetCategories', {}).get('Housing') == {'mode': 'fixed', 'amount': 2000})
    page.reload(wait_until='networkidle')
    assert page.evaluate("() => window.app.budgetCategories") == {'Housing': {'mode': 'fixed', 'amount': 2000}}


IMPORT_JS = """async ({ payload, replace }) => {
    const app = window.app;
    const mod = await import('/src/dataExport.js');
    const file = new File([JSON.stringify(payload)], 'b.json', { type: 'application/json' });
    return new Promise(resolve => {
        mod.importAllJSON(app, file, { requestImportMode: async () => replace });
        setTimeout(() => resolve(app.budgetCategories), 400);
    });
}"""


@pytest.mark.feature
def test_export_contains_budget_categories_and_replace_import_roundtrips(app_page):
    page = app_page
    _seed(page)
    page.evaluate("() => { window.app.budgetCategories = { Housing: { mode: 'fixed', amount: 2000 }, Food: { mode: 'derived', amount: 0 } }; }")
    with page.expect_download() as dl:
        page.evaluate("() => window.app.exportAllJSON()")
    with open(dl.value.path(), encoding='utf-8') as f:
        payload = json.load(f)
    assert payload['budgetCategories'] == {'Housing': {'mode': 'fixed', 'amount': 2000}, 'Food': {'mode': 'derived', 'amount': 0}}
    page.evaluate("() => { window.app.budgetCategories = { Other: { mode: 'fixed', amount: 1 } }; }")
    result = page.evaluate(IMPORT_JS, {'payload': payload, 'replace': True})
    assert result == payload['budgetCategories']


@pytest.mark.feature
def test_merge_import_overwrites_and_adds_keeping_existing(app_page):
    page = app_page
    _seed(page)
    # #529: a merge runs on the server against what the server holds, so the existing
    # budgets must be saved there (an in-memory edit alone is not part of the merge).
    page.evaluate("""async () => {
        const { saveToStorage } = await import('/src/storage.js');
        window.app.budgetCategories = { Housing: { mode: 'fixed', amount: 100 }, Keep: { mode: 'fixed', amount: 5 } };
        await saveToStorage(window.app, ['budgetCategories']);
    }""")
    payload = {'budgetCategories': {'Housing': {'mode': 'fixed', 'amount': 2000}, 'Food': {'mode': 'fixed', 'amount': 300}},
               'accounts': [{'id': 1, 'name': 'A', 'type': 'Checking', 'startingBalance': 1}]}
    result = page.evaluate(IMPORT_JS, {'payload': payload, 'replace': False})
    assert result['Housing']['amount'] == 2000
    assert result['Food']['amount'] == 300
    assert result['Keep']['amount'] == 5


@pytest.mark.security
def test_sanitizer_rejects_invalid_entries(app_page):
    page = app_page
    result = page.evaluate("""async () => {
        const { sanitizeBudgetCategories } = await import('/src/sanitizers.js');
        const raw = JSON.parse('{"__proto__": {"mode":"fixed","amount":5}, "constructor": {"mode":"fixed","amount":5}, "prototype": {"mode":"fixed","amount":5}}');
        Object.assign(raw, {
            Neg: { mode: 'fixed', amount: -1 },
            Nan: { mode: 'fixed', amount: NaN },
            Str: { mode: 'fixed', amount: 'abc' },
            Blank: { mode: 'fixed', amount: '' },
            BadMode: { mode: 'evil', amount: 5 },
            Good: { mode: 'fixed', amount: '42.5' },
            Der: { mode: 'derived', amount: 999 },
            Huge: { mode: 'fixed', amount: 1e15 },
            Scalar: 7
        });
        raw['x'.repeat(300)] = { mode: 'fixed', amount: 1 };
        const warnings = [];
        const out = sanitizeBudgetCategories(raw, warnings);
        const many = {};
        for (let i = 0; i < 300; i++) many['c' + i] = { mode: 'fixed', amount: 1 };
        return {
            keys: Object.keys(out).sort(),
            good: out.Good, der: out.Der, huge: out.Huge,
            long: out['x'.repeat(40)],
            polluted: ({}).amount !== undefined || Object.prototype.mode !== undefined,
            ownProto: Object.prototype.hasOwnProperty.call(out, '__proto__'),
            warned: warnings.length,
            nonObjects: [null, undefined, 5, 'str', [1, 2], true].map(v => Object.keys(sanitizeBudgetCategories(v)).length),
            capped: Object.keys(sanitizeBudgetCategories(many)).length
        };
    }""")
    assert result['good'] == {'mode': 'fixed', 'amount': 42.5}
    assert result['der'] == {'mode': 'derived', 'amount': 0}
    assert result['huge']['amount'] == 1e9
    assert result['long'] == {'mode': 'fixed', 'amount': 1}
    assert result['keys'] == sorted(['Good', 'Der', 'Huge', 'x' * 40])
    assert not result['polluted']
    assert not result['ownProto']
    assert result['warned'] >= 9
    assert result['nonObjects'] == [0, 0, 0, 0, 0, 0]
    assert result['capped'] == 200


@pytest.mark.security
def test_category_name_is_escaped_in_panel_and_variance(app_page):
    page = app_page
    _seed(page)
    page.evaluate("""() => {
        window.app.expenses.push({ id: 3, name: 'x', budgetAmount: 10, date: new Date().toISOString().slice(0, 8) + '07',
            category: "Tom's &lt;b&gt;bold&lt;/b&gt; \\"q\\"", accountId: 9301 });
        window.__xss = 0;
        window.app.budgetCategories = { "Tom's &lt;b&gt;bold&lt;/b&gt; q": { mode: 'fixed', amount: 5 } };
    }""")
    _open_panel(page)
    assert page.locator('#categoryBudgetsPanel b').count() == 0
    assert '&lt;b&gt;' in page.locator('#categoryBudgetsPanel').inner_text()
    # category with attribute-breaking quote round-trips through data-category
    label = page.evaluate("() => document.querySelector('#categoryBudgetsPanel .cb-save[aria-label^=\"Save budget for Tom\"]').getAttribute('aria-label')")
    assert label.startswith("Save budget for Tom's")
    _open_variance(page)
    assert page.locator('#budgetVsActual b').count() == 0
    assert '&lt;b&gt;' in page.locator('#budgetVsActual').inner_text()


@pytest.mark.feature
def test_variance_empty_state_without_categories(app_page):
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = []; app.incomes = []; app.bills = []; app.debts = [];
        app.expenses = []; app.recurringTemplates = []; app.budgetCategories = {};
        app._reportMonthOffset = 0; app._reportRangeMonths = 1;
    }""")
    _open_variance(page)
    assert page.locator('#budgetVsActual .bva-empty').count() == 1


# ── Rollover (#687) ────────────────────────────────────────────────────────
# Clock pinned to 2026-06-15. SEED_JS gives Food a $200 expense in June; one more
# $120 Food expense in May makes May's carry-out: fixed $300 - $120 = $180.

def _seed_rollover(page):
    from tests.conftest import pin_clock
    pin_clock(page, '2026-06-15')
    _seed(page)
    page.evaluate("""() => {
        window.app.expenses.push({ id: 11, name: 'May food', budgetAmount: 120, date: '2026-05-06', category: 'Food', accountId: 9301 });
    }""")


def _set_rollover(page, category, amount, mode, start=None):
    row = _row(page, category)
    row.locator('.cb-mode').select_option('fixed')
    row.locator('.cb-amount').fill(str(amount))
    row.locator('.cb-rollover-mode').select_option(mode)
    if start is not None:
        row.locator('.cb-rollover-start').fill(start)
    row.locator('.cb-save').click()


@pytest.mark.feature
def test_rollover_on_defaults_start_to_current_month_and_shows_carried(app_page):
    page = app_page
    _seed_rollover(page)
    _open_panel(page)
    row = _row(page, 'Food')
    assert row.locator('.cb-rollover-start').is_hidden()
    row.locator('.cb-rollover-mode').select_option('both')
    assert row.locator('.cb-rollover-start').is_visible()
    assert row.locator('.cb-rollover-start').input_value() == '2026-06'
    assert row.locator('.cb-rollover-mode').get_attribute('aria-label') == 'Rollover for Food'
    _set_rollover(page, 'Food', 300, 'both', '2026-05')
    page.wait_for_function("() => (window.app.budgetCategories.Food || {}).rollover === 'both'", timeout=5000)
    assert page.evaluate("() => window.app.budgetCategories.Food") == {
        'mode': 'fixed', 'amount': 300, 'rollover': 'both', 'rolloverStart': '2026-05'}
    note = _row(page, 'Food').locator('.cb-carried')
    assert note.inner_text() == 'Carried: $180.00 · Available: $480.00'


@pytest.mark.feature
def test_rollover_persists_after_reload(app_page):
    page = app_page
    _seed_rollover(page)
    _open_panel(page)
    _set_rollover(page, 'Food', 300, 'overspend', '2026-05')
    expected = {'mode': 'fixed', 'amount': 300, 'rollover': 'overspend', 'rolloverStart': '2026-05'}
    wait_for_api(page, '/api/plan-settings', lambda d: d.get('budgetCategories', {}).get('Food') == expected)
    page.reload(wait_until='networkidle')
    assert page.evaluate("() => window.app.budgetCategories.Food") == expected
    _open_panel(page)
    row = _row(page, 'Food')
    assert row.locator('.cb-rollover-mode').input_value() == 'overspend'
    assert row.locator('.cb-rollover-start').input_value() == '2026-05'
    # Overspend-only: May's unspent $180 does not carry, so nothing is carried.
    assert row.locator('.cb-carried').inner_text() == 'Carried: $0.00 · Available: $300.00'


@pytest.mark.feature
def test_rollover_off_restores_the_plain_display(app_page):
    page = app_page
    _seed_rollover(page)
    _open_panel(page)
    _set_rollover(page, 'Food', 300, 'both', '2026-05')
    page.wait_for_function("() => (window.app.budgetCategories.Food || {}).rollover === 'both'", timeout=5000)
    _row(page, 'Food').locator('.cb-rollover-mode').select_option('')
    assert _row(page, 'Food').locator('.cb-rollover-start').is_hidden()
    _row(page, 'Food').locator('.cb-save').click()
    page.wait_for_function("() => !('rollover' in window.app.budgetCategories.Food)", timeout=5000)
    assert page.evaluate("() => window.app.budgetCategories.Food") == {'mode': 'fixed', 'amount': 300}
    assert _row(page, 'Food').locator('.cb-carried').inner_text() == ''
    _open_variance(page)
    row = _bva(page, 'Food')
    assert row.locator('.bva-carry').count() == 0
    assert row.locator('.bva-budget').inner_text() == '$300.00'
    assert row.locator('.bva-diff').inner_text() == '$100.00'
    assert row.locator('.bva-pct').inner_text() == '67%'


@pytest.mark.feature
def test_rollover_invalid_start_month_is_rejected_inline(app_page):
    page = app_page
    _seed_rollover(page)
    _open_panel(page)
    _set_rollover(page, 'Food', 300, 'both', '')
    row = _row(page, 'Food')
    assert 'start month' in row.locator('.cb-error').inner_text().lower()
    assert page.evaluate("() => window.app.budgetCategories") == {}


@pytest.mark.feature
def test_variance_shows_carried_and_uses_available(app_page):
    page = app_page
    _seed_rollover(page)
    page.evaluate("""() => { window.app.budgetCategories = {
        Food: { mode: 'fixed', amount: 300, rollover: 'both', rolloverStart: '2026-05' },
        Housing: { mode: 'fixed', amount: 1000 } }; }""")
    _open_variance(page)
    food = _bva(page, 'Food')
    assert food.locator('.bva-budget').inner_text() == '$300.00'
    assert food.locator('.bva-actual').inner_text() == '$200.00'
    assert food.locator('.bva-carry').inner_text() == 'Carried in: $180.00 · Available: $480.00'
    assert food.locator('.bva-carry').get_attribute('data-label') == 'Carried'
    assert food.locator('.bva-diff').inner_text() == '$280.00'
    assert food.locator('.bva-pct').inner_text() == '42%'
    # A category without rollover keeps the plain row.
    housing = _bva(page, 'Housing')
    assert housing.locator('.bva-carry').count() == 0
    assert housing.locator('.bva-diff').inner_text().startswith('-$500.00')


@pytest.mark.feature
def test_variance_overspend_carry_reduces_available_and_flags_over(app_page):
    page = app_page
    _seed_rollover(page)
    # May budget $100 vs $120 spent: -$20 carries into June, so $80 is available vs $200 spent.
    page.evaluate("""() => { window.app.budgetCategories = {
        Food: { mode: 'fixed', amount: 100, rollover: 'overspend', rolloverStart: '2026-05' } }; }""")
    _open_variance(page)
    food = _bva(page, 'Food')
    assert 'bva-row--over' in food.get_attribute('class')
    assert food.locator('.bva-carry').inner_text() == 'Carried in: -$20.00 · Available: $80.00'
    assert food.locator('.bva-diff').inner_text().startswith('-$120.00')
