#!/usr/bin/env python3
"""Health FIRE card: adjustable years-of-expenses / withdrawal-rate target (#361)."""

import pytest

SETUP = """() => {
    const app = window.app;
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    app.incomes = [{ id: 1, name: 'Salary', amount: %(income)s, frequency: 'monthly',
                     firstPayDate: `${now.getFullYear()}-${mm}-01` }];
    app.bills = [{ id: 1, name: 'Rent', amount: %(bills)s, category: 'Housing', dueDate: 1 }];
    app.expenses = [{ id: 1, name: 'Food', budgetAmount: 200, category: 'Food' }];
    app.accounts = []; app.debts = []; app.recurringTemplates = [];
    app.emergencyFunds = []; app.sinkingFunds = [];
    app.settings = [];
    app.switchPage('health');
}"""


def _setup(page, income=5000, bills=500):
    page.wait_for_function("() => window.app && window.app.switchPage")
    page.evaluate(SETUP % {'income': income, 'bills': bills})
    page.wait_for_selector('#healthFireCard #healthFireMultiplier', timeout=5000)


def _card_text(page):
    return page.text_content('#healthFireCard')


def _commit(page, selector, value):
    page.fill(selector, value)
    page.dispatch_event(selector, 'change')
    page.wait_for_timeout(100)


def _stored(page):
    return page.evaluate("() => (window.app.settings.find(s => s.key === 'fireMultiplier') || {}).value")


def _years(page):
    return page.text_content('#healthFireCard .health-timeline-value').strip()


@pytest.mark.feature
def test_fire_default_is_25x(app_page):
    _setup(app_page)
    assert app_page.input_value('#healthFireMultiplier') == '25'
    assert app_page.input_value('#healthFireRate') == '4'
    # (500 + 200) * 12 * 25 = 210,000
    assert '$210,000' in _card_text(app_page)


@pytest.mark.feature
def test_fire_multiplier_updates_rate_and_number(app_page):
    _setup(app_page)
    _commit(app_page, '#healthFireMultiplier', '30')
    assert app_page.input_value('#healthFireRate') == '3.33'
    assert '$252,000' in _card_text(app_page)  # 8400 * 30
    assert _stored(app_page) == 30


@pytest.mark.feature
def test_fire_rate_updates_multiplier(app_page):
    _setup(app_page)
    _commit(app_page, '#healthFireRate', '5')
    assert app_page.input_value('#healthFireMultiplier') == '20'
    assert '$168,000' in _card_text(app_page)  # 8400 * 20
    assert _stored(app_page) == 20


@pytest.mark.feature
def test_fire_years_away_recalculates(app_page):
    _setup(app_page, income=5000, bills=1800)  # surplus 3000/mo, expenses 2000/mo
    base = int(_years(app_page))  # 24000*25 = 600k / 3000 = 200 months ~ 17 years
    _commit(app_page, '#healthFireMultiplier', '10')
    assert int(_years(app_page)) < base


@pytest.mark.feature
@pytest.mark.parametrize('field,bad', [
    ('#healthFireMultiplier', '-5'), ('#healthFireMultiplier', '0'),
    ('#healthFireMultiplier', ''), ('#healthFireMultiplier', '1001'),
    ('#healthFireRate', '0'), ('#healthFireRate', '-4'),
    ('#healthFireRate', ''), ('#healthFireRate', '101'),
])
def test_fire_invalid_input_rejected(app_page, field, bad):
    _setup(app_page)
    _commit(app_page, '#healthFireMultiplier', '30')
    _commit(app_page, field, bad)
    err = app_page.locator('#healthFireError')
    assert err.is_visible()
    assert err.text_content().strip() != ''
    assert _stored(app_page) == 30
    assert app_page.input_value('#healthFireMultiplier') == '30'
    assert app_page.input_value('#healthFireRate') == '3.33'
    assert app_page.get_attribute(field, 'aria-describedby') == 'healthFireError'


@pytest.mark.feature
def test_fire_non_numeric_value_rejected(app_page):
    _setup(app_page)
    app_page.evaluate("() => { document.getElementById('healthFireMultiplier').value = 'abc'; }")
    app_page.dispatch_event('#healthFireMultiplier', 'change')
    assert app_page.locator('#healthFireError').is_visible()
    assert _stored(app_page) is None


@pytest.mark.feature
def test_fire_error_clears_on_edit(app_page):
    _setup(app_page)
    _commit(app_page, '#healthFireMultiplier', '-1')
    assert app_page.locator('#healthFireError').is_visible()
    app_page.fill('#healthFireMultiplier', '12')
    assert not app_page.locator('#healthFireError').is_visible()


@pytest.mark.feature
def test_fire_very_large_multiplier_shows_999_plus(app_page):
    _setup(app_page, income=5000, bills=4790)  # tiny surplus, big annual expenses
    _commit(app_page, '#healthFireMultiplier', '1000')
    assert '999+' in _card_text(app_page)
    assert _stored(app_page) == 1000


@pytest.mark.feature
def test_fire_persists_across_reload(app_page):
    _setup(app_page)
    _commit(app_page, '#healthFireMultiplier', '30')
    app_page.wait_for_function(
        "() => (JSON.parse(localStorage.getItem('debtTrackerData') || '{}').settings || []).some(s => s.key === 'fireMultiplier' && s.value === 30)")
    app_page.reload(wait_until='networkidle')
    assert app_page.evaluate("() => window.app.settings.find(s => s.key === 'fireMultiplier').value") == 30


@pytest.mark.feature
def test_fire_invalid_stored_value_falls_back_to_25(app_page):
    out = app_page.evaluate("""async () => {
        const m = await import('/src/settings.js');
        const out = [];
        for (const v of [-3, 0, 'abc', 5000, null]) {
            window.app.settings = [{ key: 'fireMultiplier', value: v }];
            out.push(m.getFireMultiplier(window.app));
        }
        window.app.settings = [];
        out.push(m.getFireMultiplier(window.app));
        return out;
    }""")
    assert out == [25] * 6


@pytest.mark.feature
def test_fire_input_click_does_not_navigate(app_page):
    _setup(app_page)
    app_page.click('#healthFireMultiplier')
    app_page.click('#healthFireRate')
    app_page.keyboard.press('Enter')
    assert app_page.evaluate("() => window.app._currentPage") == 'health'
    assert app_page.locator('#healthSection.active').count() == 1


@pytest.mark.feature
def test_fire_label_association(app_page):
    _setup(app_page)
    for field in ('healthFireMultiplier', 'healthFireRate'):
        assert app_page.locator(f'label[for="{field}"]').count() == 1


@pytest.mark.feature
def test_fire_setting_survives_import_sanitizer(app_page):
    res = app_page.evaluate("""async () => {
        const m = await import('/src/sanitizers.js');
        const s = m.sanitizeParsedState({ settings: [{ key: 'fireMultiplier', value: 30 }] });
        return s.settings.find(x => x.key === 'fireMultiplier');
    }""")
    assert res == {'key': 'fireMultiplier', 'value': 30}
