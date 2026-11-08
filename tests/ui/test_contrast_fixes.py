#!/usr/bin/env python3
"""
Text contrast fixes from the November 2026 a11y audit (WCAG 2.1 AA 1.4.3 /
1.4.11): #484 dark-mode error text, #485 dark-mode "Forgot password?" link,
#486 dark-mode login focus ring, #487 Reports tab-group labels, #488 positive
amounts in light mode, #489 Plan net breakdown.

Ratios are measured from computed styles (see contrast_utils.py), not from
the stylesheet, so a later override or opacity is caught too.
"""

import pytest

from tests.conftest import BASE_URL, open_settings, seed_state, wait_for_app_ready
from tests.ui.contrast_utils import color_contrast, set_theme, text_contrast

AA_TEXT = 4.5
AA_NON_TEXT = 3.0
THEMES = [pytest.param(False, id='light'), pytest.param(True, id='dark')]


def _signed_out_page(page):
    """A fresh context with no session, so the login gate is really shown."""
    context = page.context.browser.new_context()
    gate = context.new_page()
    gate.goto(BASE_URL)
    wait_for_app_ready(gate)
    gate.wait_for_selector('#loginGate:not(.hidden)', timeout=15000)
    return gate


def _ratio(page, selector):
    return text_contrast(page.locator(selector))['ratio']


# --- #484: error text -------------------------------------------------------

@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
def test_login_error_text_contrast(page, stack_user, dark):
    gate = _signed_out_page(page)
    try:
        set_theme(gate, dark=dark)
        gate.fill('#loginGateEmail', 'nobody@example.com')
        gate.fill('#loginGatePassword', 'definitely-the-wrong-password')
        gate.click('#loginGateSubmit')
        gate.wait_for_function("() => document.getElementById('loginGateError').textContent.trim().length > 0",
                               timeout=10000)
        assert _ratio(gate, '#loginGateError') >= AA_TEXT
    finally:
        gate.context.close()


@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
def test_settings_password_error_contrast(app_page, dark):
    page = app_page
    set_theme(page, dark=dark)
    open_settings(page)
    page.click('[data-settings-tab="security"]')
    page.evaluate("() => { document.getElementById('settingsChangePasswordError').textContent = 'Error'; }")
    assert _ratio(page, '#settingsChangePasswordError') >= AA_TEXT


@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
def test_legacy_import_error_contrast(app_page, dark):
    page = app_page
    set_theme(page, dark=dark)
    page.evaluate("""() => {
        document.getElementById('pgMigrationModal').classList.remove('hidden');
        const e = document.getElementById('pgMigrationError');
        e.textContent = 'Transfer failed'; e.classList.remove('hidden');
    }""")
    assert _ratio(page, '#pgMigrationError') >= AA_TEXT


@pytest.mark.ui
def test_error_text_colour_unchanged_in_light_mode(app_page):
    """Negative: only dark mode changed; light error text keeps #dc2626."""
    page = app_page
    set_theme(page, dark=False)
    color = page.evaluate("() => getComputedStyle(document.getElementById('loginGateError')).color")
    assert color == 'rgb(220, 38, 38)'


@pytest.mark.ui
def test_danger_buttons_keep_their_background_in_dark_mode(app_page):
    """Negative: the error-text fix must not lighten --danger-color, which is
    the background of white-text danger buttons (they would drop below AA)."""
    page = app_page
    set_theme(page, dark=True)
    assert page.evaluate(
        "() => getComputedStyle(document.body).getPropertyValue('--danger-color').trim()") == '#dc2626'
    page.evaluate("""() => {
        const b = document.createElement('button');
        b.id = 'probeDeleteBtn'; b.className = 'btn-delete'; b.textContent = 'Delete';
        document.querySelector('.container').appendChild(b);
    }""")
    bg = page.evaluate("() => getComputedStyle(document.getElementById('probeDeleteBtn')).backgroundColor")
    assert bg == 'rgb(220, 38, 38)'
    assert _ratio(page, '#probeDeleteBtn') >= AA_TEXT


@pytest.mark.ui
def test_high_contrast_keeps_its_error_colour(app_page):
    page = app_page
    set_theme(page, dark=True, high_contrast=True)
    color = page.evaluate("() => getComputedStyle(document.getElementById('loginGateError')).color")
    assert color == 'rgb(255, 107, 107)'


# --- #485 / #486: login gate link and focus ring ----------------------------

@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
def test_forgot_password_link_contrast(page, stack_user, dark):
    gate = _signed_out_page(page)
    try:
        set_theme(gate, dark=dark)
        link = '.login-gate .link-btn:visible'
        assert _ratio(gate, link) >= AA_TEXT
        gate.hover(link)
        assert _ratio(gate, link) >= AA_TEXT, 'hover state'
        gate.focus(link)
        assert _ratio(gate, link) >= AA_TEXT, 'focus state'
    finally:
        gate.context.close()


@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
def test_login_input_focus_indicator_contrast(page, stack_user, dark):
    gate = _signed_out_page(page)
    try:
        set_theme(gate, dark=dark)
        gate.focus('#loginGateEmail')
        info = gate.evaluate("""() => {
            const el = document.getElementById('loginGateEmail');
            const cs = getComputedStyle(el);
            let n = el.parentElement, bg = 'rgba(0, 0, 0, 0)';
            while (n && (bg = getComputedStyle(n).backgroundColor).endsWith(', 0)')) n = n.parentElement;
            return { border: cs.borderTopColor, card: bg, shadow: cs.boxShadow };
        }""")
        assert color_contrast(info['border'], info['card']) >= AA_NON_TEXT, info
    finally:
        gate.context.close()


# --- #487: Reports tab-group labels -----------------------------------------

@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
def test_reports_group_labels_contrast(app_page, dark):
    page = app_page
    set_theme(page, dark=dark)
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    labels = page.locator('.rpt-tab-group-label')
    assert labels.count() >= 3
    for i in range(labels.count()):
        m = text_contrast(labels.nth(i))
        assert m['opacity'] == 1, f'label {i} is dimmed with opacity {m["opacity"]}'
        assert m['ratio'] >= AA_TEXT, (i, m)


@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
def test_active_reports_group_is_visually_distinct(app_page, dark):
    """Removing the opacity dimming must not lose the active-group cue."""
    page = app_page
    set_theme(page, dark=dark)
    page.click('button[data-page="reports"]')
    page.wait_for_selector('#reportsSection.active', timeout=5000)
    styles = page.evaluate("""() => Array.from(document.querySelectorAll('.rpt-tab-group')).map(g => ({
        active: !!g.querySelector('.rpt-tab-btn--active'),
        bg: getComputedStyle(g.querySelector('.rpt-tab-group-label')).backgroundColor
    }))""")
    active = [s['bg'] for s in styles if s['active']]
    inactive = {s['bg'] for s in styles if not s['active']}
    assert len(active) == 1, styles
    assert active[0] not in inactive, styles


# --- #488: positive amounts -------------------------------------------------

def _seed_positive_amounts(page):
    seed_state(page, {
        'version': '3.0',
        'accounts': [{'id': 1, 'name': 'Contrast Checking', 'type': 'Checking', 'startingBalance': 2500}],
        'incomes': [{'id': 1, 'name': 'Contrast Salary', 'amount': 4000, 'firstPayDate': '2026-01-01',
                     'frequency': 'monthly', 'accountId': 1}],
        'bonuses': [{'id': 1, 'name': 'Contrast Bonus', 'amount': 1000, 'date': '2026-03-01', 'accountId': 1}],
        'recurringTemplates': [{'id': 1, 'name': 'Contrast Refund', 'type': 'income', 'amount': 40,
                                'frequency': 'monthly', 'dayOfMonth': 5, 'category': 'Income',
                                'accountId': 1, 'startDate': '2026-01-01'}],
    })


@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
@pytest.mark.parametrize('page_name,selector', [
    ('accounts', '.acct-balance--pos'),
    ('income', '.income-card-amount'),
    ('income', '.bonus-card-amount'),
    ('recurring', '.recurring-amount--pos'),
])
def test_positive_amount_contrast(app_page, dark, page_name, selector):
    page = app_page
    _seed_positive_amounts(page)
    set_theme(page, dark=dark)
    page.click(f'button[data-page="{page_name}"]')
    page.wait_for_selector(f'{selector}:visible', timeout=10000)
    assert _ratio(page, f'{selector}:visible') >= AA_TEXT


@pytest.mark.ui
def test_positive_and_negative_balances_stay_distinguishable(app_page):
    page = app_page
    set_theme(page, dark=False)
    colors = page.evaluate("""() => {
        const mk = (cls) => { const s = document.createElement('span'); s.className = cls;
            document.querySelector('.container').appendChild(s); return getComputedStyle(s).color; };
        return [mk('acct-balance--pos'), mk('acct-balance--neg')];
    }""")
    assert colors[0] != colors[1], colors


# --- #489: Plan net breakdown -----------------------------------------------

@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
@pytest.mark.parametrize('variant', ['positive', 'negative'])
def test_plan_net_breakdown_contrast(app_page, dark, variant):
    page = app_page
    set_theme(page, dark=dark)
    page.evaluate("""(variant) => {
        const box = document.createElement('div');
        box.className = `strategy-net strategy-net--${variant}`;
        box.innerHTML = '<strong>Net</strong> <span id="probeBreakdown" class="strategy-net-breakdown">$5,000 income − $3,000 spending</span>';
        document.querySelector('.container').appendChild(box);
    }""", variant)
    m = text_contrast(page.locator('#probeBreakdown'))
    assert m['opacity'] == 1
    assert m['ratio'] >= AA_TEXT, m


# --- Same-pattern fixes found while auditing #488 / #484 ---------------------

@pytest.mark.ui
@pytest.mark.parametrize('dark', THEMES)
@pytest.mark.parametrize('tag,cls', [
    ('button', 'btn sinking-complete-btn'),
    ('button', 'btn debt-paid-off-btn'),
    ('div', 'cal-income-event'),
    ('span', 'text-income'),
    ('span', 'text-expense'),
    ('span', 'stimulus-badge'),
])
def test_amount_and_status_text_contrast(app_page, dark, tag, cls):
    """Green action buttons and the calendar income chip (white on #059669 was
    3.8:1), Ledger income amounts (#059669 text) and dark-mode expense amounts
    (#ef4444 was 4.0:1)."""
    page = app_page
    set_theme(page, dark=dark)
    page.evaluate("""([tag, cls]) => {
        const el = document.createElement(tag);
        el.id = 'probeAmount'; el.className = cls; el.textContent = '$1,234.56';
        const card = document.createElement('div');
        card.className = 'card';
        card.appendChild(el);
        document.querySelector('.container').appendChild(card);
    }""", [tag, cls])
    m = text_contrast(page.locator('#probeAmount'))
    assert m['ratio'] >= AA_TEXT, m
