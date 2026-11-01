"""
UX D (#429): design-system consistency — page headers, nav toggle, button
variants, Clear All Data placement, header chrome, dark-mode contrast.
"""

import pytest

from tests.conftest import open_settings, close_settings, switch_settings_tab

PAGES = ['health', 'accounts', 'income', 'liabilities', 'recurring', 'savings',
         'strategy', 'ledger']


def _page_h2_style(page, name):
    page.evaluate(f"() => window.app.switchPage('{name}')")
    page.wait_for_timeout(300)
    return page.evaluate("""() => {
        const sec = document.querySelector('.page-section.active');
        const h = sec.querySelector('h2');
        const c = getComputedStyle(h);
        return {fs: c.fontSize, color: c.color, bb: c.borderBottomWidth, text: h.textContent};
    }""")


@pytest.mark.ui
def test_all_page_titles_share_one_style(app_page):
    styles = {n: _page_h2_style(app_page, n) for n in PAGES}
    ref = styles['accounts']
    for name, st in styles.items():
        assert st['fs'] == ref['fs'], f"{name} h2 font-size {st['fs']} != {ref['fs']}"
        assert st['color'] == ref['color'], f"{name} h2 color {st['color']} != {ref['color']}"


@pytest.mark.ui
def test_blue_title_overrides_are_gone_negative(app_page):
    """Negative: the old blue-title override must not apply to Recurring/Savings/Ledger."""
    primary = app_page.evaluate(
        "() => getComputedStyle(document.body).getPropertyValue('--primary-color').trim()")
    for name in ('recurring', 'savings', 'ledger'):
        st = _page_h2_style(app_page, name)
        assert st['color'] != 'rgb(37, 99, 235)', f"{name} title still uses the blue override"
    assert primary  # sanity: the token exists, so the comparison above is meaningful


@pytest.mark.ui
def test_savings_has_no_outer_card(app_page):
    app_page.evaluate("() => window.app.switchPage('savings')")
    app_page.wait_for_selector('#savingsSection .page-header')
    outer = app_page.evaluate("""() => {
        const c = getComputedStyle(document.getElementById('savingsSection'));
        return {bs: c.boxShadow, pad: c.paddingLeft, bg: c.backgroundColor};
    }""")
    assert outer['bs'] == 'none'
    assert outer['pad'] == '0px'
    assert outer['bg'] == 'rgba(0, 0, 0, 0)'


@pytest.mark.ui
def test_nav_toggle_is_44px_and_does_not_cover_account_menu(app_page):
    page = app_page
    page.set_viewport_size({'width': 390, 'height': 844})
    box = page.evaluate("""() => {
        const r = document.getElementById('navToggle').getBoundingClientRect();
        return {w: r.width, h: r.height, bg: getComputedStyle(document.getElementById('navToggle')).backgroundColor};
    }""")
    assert box['w'] >= 44 and box['h'] >= 44
    assert box['bg'] != 'rgba(0, 0, 0, 0)' and box['bg'] != 'rgb(239, 239, 239)', "toggle should be styled"

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)')
    result = page.evaluate("""() => {
        const dd = document.getElementById('accountMenuDropdown');
        return [...dd.querySelectorAll('.account-menu-item:not(.hidden)')].map(it => {
            const r = it.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return dd.contains(top);
        });
    }""")
    assert result and all(result), "an element outside the dropdown covers a menu item"


@pytest.mark.ui
def test_nav_toggle_still_toggles_menu(app_page):
    """Negative/regression: restyling must not break the menu toggle."""
    page = app_page
    page.set_viewport_size({'width': 390, 'height': 844})
    page.click('#navToggle')
    page.wait_for_selector('#topNav.menu-open')
    assert page.get_attribute('#navToggle', 'aria-expanded') == 'true'


@pytest.mark.ui
def test_clear_all_data_moved_to_settings(app_page):
    page = app_page
    page.evaluate("() => window.app.switchPage('strategy')")
    in_plan = page.evaluate("() => !!document.querySelector('#strategySection #clearDataBtn')")
    assert not in_plan, "Clear All Data must no longer live on the Plan page"
    assert page.evaluate("() => !!document.querySelector('#settingsPanel-data #clearDataBtn')")
    # not adjacent to Calculate
    assert page.evaluate("""() => {
        const calc = document.getElementById('calculateBtn');
        return !calc.parentElement.querySelector('#clearDataBtn');
    }""")


@pytest.mark.ui
def test_clear_all_data_cancel_does_nothing_confirm_clears(app_page):
    page = app_page
    page.evaluate("""() => { window.app.accounts = [{id: 1, name: 'Keep Me', type: 'Checking',
        startingBalance: 10, archived: false}]; window.app.saveToStorage(); }""")
    open_settings(page)
    switch_settings_tab(page, 'data')
    page.click('#clearDataBtn')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)')
    page.click('#deleteConfirmCancelBtn')
    page.wait_for_selector('#deleteConfirmModal', state='hidden')
    assert page.evaluate("() => window.app.accounts.length") == 1

    page.click('#clearDataBtn')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)')
    page.click('#deleteConfirmBtn')
    page.wait_for_function("() => window.app.accounts.length === 0", timeout=5000)


def _luminance(rgb):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def _parse(rgb):
    return [int(float(x)) for x in rgb[rgb.index('(') + 1:rgb.index(')')].replace('/', ',').split(',')[:3]]


@pytest.mark.ui
def test_dark_mode_muted_text_contrast(app_page):
    page = app_page
    page.evaluate("() => document.body.classList.add('dark-mode')")
    colors = page.evaluate("""() => {
        const probe = document.createElement('span');
        probe.style.setProperty('color', 'var(--text-muted)');
        document.body.appendChild(probe);
        const fg = getComputedStyle(probe).color;
        probe.remove();
        const card = document.createElement('div');
        card.style.setProperty('background-color', 'var(--card-bg)');
        document.body.appendChild(card);
        const bg = getComputedStyle(card).backgroundColor;
        card.remove();
        return {fg, bg};
    }""")
    l1, l2 = _luminance(_parse(colors['fg'])), _luminance(_parse(colors['bg']))
    ratio = (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    assert ratio >= 4.5, f"dark muted text contrast {ratio:.2f}"


@pytest.mark.ui
def test_dark_mode_secondary_button_has_visible_border_light_mode_unchanged(app_page):
    page = app_page
    page.evaluate("() => window.app.switchPage('accounts')")
    page.evaluate("""() => { const b = document.createElement('button'); b.id = 'probeSec';
        b.className = 'btn btn-secondary btn-small'; document.getElementById('accountsSection').appendChild(b); }""")
    light = page.evaluate("() => getComputedStyle(document.getElementById('probeSec')).borderTopColor")
    page.evaluate("() => document.body.classList.add('dark-mode')")
    dark = page.evaluate("() => getComputedStyle(document.getElementById('probeSec')).borderTopColor")
    assert dark == 'rgb(100, 116, 139)'
    assert light != dark


@pytest.mark.ui
@pytest.mark.parametrize('w,h,lo,hi', [(390, 844, 90, 135), (1440, 900, 110, 150)])
def test_header_height_bounds(app_page, w, h, lo, hi):
    app_page.set_viewport_size({'width': w, 'height': h})
    app_page.wait_for_timeout(200)
    height = app_page.evaluate("() => document.querySelector('header').getBoundingClientRect().height")
    assert lo <= height <= hi, f"header height {height} at {w}px"


@pytest.mark.ui
def test_account_menu_hides_empty_email_row(app_page):
    page = app_page
    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)')
    assert page.evaluate("() => document.getElementById('accountMenuEmail').getBoundingClientRect().height") == 0
    # Negative: with an email set the row is shown again.
    page.evaluate("""async () => { window.app.userEmail = 'me@example.com';
        (await import('/src/ui.js')).updateAccountMenuEmail(window.app); }""")
    assert page.evaluate("() => document.getElementById('accountMenuEmail').getBoundingClientRect().height") > 0


@pytest.mark.ui
def test_account_card_edit_uses_shared_secondary_variant(app_page):
    page = app_page
    page.evaluate("""() => { window.app.accounts = [{id: 1, name: 'Chk', type: 'Checking',
        startingBalance: 5, archived: false}]; window.app.switchPage('accounts'); window.app.updateUI && window.app.updateUI(); }""")
    page.wait_for_selector('[data-account-action="edit"]')
    cls = page.get_attribute('[data-account-action="edit"]', 'class')
    assert 'btn-secondary' in cls and 'btn-edit' not in cls
