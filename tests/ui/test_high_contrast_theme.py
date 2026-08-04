#!/usr/bin/env python3
"""
High Contrast Theme Tests (GitHub issue #33)

#themeSwitcher was a Light/Dark toggle button; it's now a 3-option <select>
(Light / Dark / High Contrast). High Contrast is implemented as Dark Mode
plus extra overrides -- selecting it applies BOTH `dark-mode` and
`high-contrast-mode` classes to <body> (see applyTheme() in src/ui.js and
the `body.dark-mode.high-contrast-mode` CSS section in styles.css) -- so it
inherits dark mode's existing surface colors/JS chart-color branching and
layers a pure black/white/bright-accent palette on top.
"""

import pytest

from tests.conftest import assert_no_errors


@pytest.mark.ui
def test_theme_switcher_has_three_labeled_options(app_page):
    """The switcher exposes exactly Light/Dark/High Contrast, each with its
    own accessible option text (not a single cycling icon button)."""
    page = app_page
    options = page.evaluate("""
        () => Array.from(document.getElementById('themeSwitcher').options)
            .map(o => ({ value: o.value, text: o.textContent.trim() }))
    """)
    assert [o['value'] for o in options] == ['light', 'dark', 'high-contrast']
    assert all(o['text'] for o in options), "Every option needs visible label text"


@pytest.mark.ui
def test_selecting_high_contrast_applies_both_body_classes(app_page):
    """Selecting High Contrast adds dark-mode AND high-contrast-mode (it's
    built as an extension of dark mode, not a standalone third palette)."""
    page = app_page
    page.select_option('#themeSwitcher', 'high-contrast')
    page.wait_for_timeout(200)

    classes = page.evaluate("() => document.body.className")
    assert 'dark-mode' in classes
    assert 'high-contrast-mode' in classes
    assert_no_errors(page)


@pytest.mark.ui
def test_selecting_plain_dark_does_not_add_high_contrast_class(app_page):
    """Negative case: plain Dark must not accidentally also apply the
    stronger high-contrast-mode overrides."""
    page = app_page
    page.select_option('#themeSwitcher', 'dark')
    page.wait_for_timeout(200)

    classes = page.evaluate("() => document.body.className")
    assert 'dark-mode' in classes
    assert 'high-contrast-mode' not in classes


@pytest.mark.ui
def test_switching_high_contrast_to_light_removes_both_classes(app_page):
    """Negative/regression case: no stale dark-mode or high-contrast-mode
    class should survive a switch back to Light."""
    page = app_page
    page.select_option('#themeSwitcher', 'high-contrast')
    page.wait_for_timeout(150)
    page.select_option('#themeSwitcher', 'light')
    page.wait_for_timeout(150)

    classes = page.evaluate("() => document.body.className")
    assert 'dark-mode' not in classes
    assert 'high-contrast-mode' not in classes


@pytest.mark.ui
def test_high_contrast_persists_across_reload(app_page):
    """The choice is saved to localStorage and re-applied (both classes,
    correct <select> value) after a full page reload."""
    page = app_page
    page.select_option('#themeSwitcher', 'high-contrast')
    page.wait_for_timeout(150)

    stored = page.evaluate("() => localStorage.getItem('debtTrackerTheme')")
    assert stored == 'high-contrast'

    page.reload(wait_until="networkidle")

    classes = page.evaluate("() => document.body.className")
    assert 'dark-mode' in classes
    assert 'high-contrast-mode' in classes
    select_value = page.evaluate("() => document.getElementById('themeSwitcher').value")
    assert select_value == 'high-contrast'
    assert_no_errors(page)


@pytest.mark.ui
def test_corrupted_theme_value_does_not_apply_high_contrast(page):
    """Negative case: a garbage debtTrackerTheme value (e.g. from an old/
    corrupted write) must not apply dark-mode or high-contrast-mode, and
    must not crash the app. Mirrors
    test_dark_mode.py::test_dark_mode_corrupted_localStorage_value_falls_back_safely
    for the new 3-way theme."""
    from tests.conftest import BASE_URL

    page.add_init_script("window.localStorage.setItem('debtTrackerTheme', 'solarized');")
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    assert_no_errors(page)
    classes = page.evaluate("() => document.body.className")
    assert 'dark-mode' not in classes
    assert 'high-contrast-mode' not in classes

    select_value = page.evaluate("() => document.getElementById('themeSwitcher').value")
    assert select_value == 'light', "Switcher should show its default option, not the garbage value"


@pytest.mark.ui
def test_high_contrast_uses_pure_black_surfaces(app_page):
    """Positive, deterministic regression guard: the declared High Contrast
    surface colors are actually applied (not just the body classes), so a
    future CSS refactor that silently drops the override is caught."""
    page = app_page
    page.select_option('#themeSwitcher', 'high-contrast')
    page.wait_for_timeout(200)

    colors = page.evaluate("""
        () => ({
            body: getComputedStyle(document.body).backgroundColor,
            container: getComputedStyle(document.querySelector('.container')).backgroundColor,
        })
    """)
    assert colors['body'] == 'rgb(0, 0, 0)'
    assert colors['container'] == 'rgb(0, 0, 0)'


@pytest.mark.ui
def test_light_and_dark_container_background_unaffected_by_high_contrast_css(app_page):
    """Negative/regression case: adding the high-contrast-mode CSS block
    must not change what plain Light or Dark look like (the new rules are
    scoped to the compound .dark-mode.high-contrast-mode selector)."""
    page = app_page

    page.select_option('#themeSwitcher', 'light')
    page.wait_for_timeout(150)
    light_bg = page.evaluate("() => getComputedStyle(document.querySelector('.container')).backgroundColor")
    assert light_bg != 'rgb(0, 0, 0)'

    page.select_option('#themeSwitcher', 'dark')
    page.wait_for_timeout(150)
    dark_bg = page.evaluate("() => getComputedStyle(document.querySelector('.container')).backgroundColor")
    assert dark_bg != 'rgb(0, 0, 0)', "Plain dark mode's own container color should be untouched"
    assert dark_bg != light_bg


@pytest.mark.ui
def test_nav_group_label_no_longer_uses_translucent_white_on_white(app_page):
    """Regression guard for the real bug found while building this feature:
    .nav-group-label used to be rgba(255,255,255,0.60) text on
    rgba(255,255,255,0.18) background in every theme -- both channel-
    identical to white, which measures ~2.9:1 against the light-mode header
    gradient (fails WCAG 1.4.3's 4.5:1). It's now a dark badge whose real
    composited contrast clears 4.5:1 in both base themes (see the CSS
    comment above .nav-group-label in styles.css for the compositing math)."""
    page = app_page
    style = page.evaluate("""
        () => {
            const el = document.querySelector('.nav-group-label');
            const s = getComputedStyle(el);
            return { color: s.color, background: s.backgroundColor };
        }
    """)
    assert style['color'] != 'rgba(255, 255, 255, 0.6)'
    assert style['background'] != 'rgba(255, 255, 255, 0.18)'


@pytest.mark.ui
def test_high_contrast_focus_visible_outline_is_bold(app_page):
    """Positive case: focusable elements get the shared bold HC focus ring
    (WCAG 2.4.7) rather than each component's own (often subtle) outline."""
    page = app_page
    page.select_option('#themeSwitcher', 'high-contrast')
    page.wait_for_timeout(150)

    page.focus('#exportJsonBtn')
    outline = page.evaluate("""
        () => {
            const s = getComputedStyle(document.getElementById('exportJsonBtn'));
            return { style: s.outlineStyle, width: s.outlineWidth };
        }
    """)
    assert outline['style'] == 'solid'
    assert outline['width'] == '3px'
