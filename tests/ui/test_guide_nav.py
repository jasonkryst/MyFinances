#!/usr/bin/env python3
"""
Guide Navigation & Accessibility Tests
guide.html's table of contents is a sticky left sidebar on desktop and a
fixed-to-top dropdown on mobile (src/guideNav.js), plus a "Back to top"
button and a skip link for keyboard/screen-reader users on this long page.
"""

import pytest

from tests.conftest import BASE_URL


def _goto_guide(page, viewport=None):
    if viewport:
        page.set_viewport_size(viewport)
    page.goto(BASE_URL + 'guide.html', wait_until='networkidle', timeout=60000)
    return page


@pytest.mark.ui
def test_skip_link_targets_guide_content(page):
    """A skip link is present and points at the main content container."""
    _goto_guide(page, {'width': 1280, 'height': 900})

    skip = page.query_selector('a.skip-link')
    assert skip is not None, "Expected a .skip-link element"
    assert skip.get_attribute('href') == '#guideContent'
    assert page.query_selector('#guideContent') is not None


@pytest.mark.ui
def test_desktop_toc_is_sticky_sidebar_and_toggle_hidden(page):
    """On desktop, the TOC renders as a sticky sidebar; the dropdown toggle is hidden."""
    _goto_guide(page, {'width': 1280, 'height': 900})

    position = page.eval_on_selector('.toc', 'el => getComputedStyle(el).position')
    toggle_display = page.eval_on_selector('.toc-toggle', 'el => getComputedStyle(el).display')
    assert position == 'sticky', f"Expected .toc to be position:sticky on desktop, got {position}"
    assert toggle_display == 'none', "Dropdown toggle should be hidden on desktop"


@pytest.mark.ui
def test_mobile_toc_is_fixed_dropdown(page):
    """On mobile, the TOC becomes a fixed-to-top bar with a collapsed dropdown list."""
    _goto_guide(page, {'width': 390, 'height': 844})

    position = page.eval_on_selector('.toc', 'el => getComputedStyle(el).position')
    toggle_display = page.eval_on_selector('.toc-toggle', 'el => getComputedStyle(el).display')
    list_display = page.eval_on_selector('#tocList', 'el => getComputedStyle(el).display')
    assert position == 'fixed', f"Expected .toc to be position:fixed on mobile, got {position}"
    assert toggle_display == 'flex'
    assert list_display == 'none', "Dropdown list should start collapsed on mobile"


@pytest.mark.ui
def test_mobile_toc_toggle_opens_and_focuses_first_link(page):
    """Opening the mobile dropdown expands the list and focuses its first link."""
    _goto_guide(page, {'width': 390, 'height': 844})

    page.click('#tocToggle')
    page.wait_for_timeout(150)

    expanded = page.get_attribute('#tocToggle', 'aria-expanded')
    list_display = page.eval_on_selector('#tocList', 'el => getComputedStyle(el).display')
    focused_href = page.evaluate('() => document.activeElement.getAttribute("href")')

    assert expanded == 'true'
    assert list_display == 'block'
    assert focused_href == '#getting-started'


@pytest.mark.ui
def test_mobile_toc_escape_closes_and_returns_focus(page):
    """Escape closes the open dropdown and returns focus to the toggle button."""
    _goto_guide(page, {'width': 390, 'height': 844})

    page.click('#tocToggle')
    page.wait_for_timeout(150)
    page.keyboard.press('Escape')
    page.wait_for_timeout(150)

    expanded = page.get_attribute('#tocToggle', 'aria-expanded')
    focused_id = page.evaluate('() => document.activeElement.id')
    assert expanded == 'false'
    assert focused_id == 'tocToggle'


@pytest.mark.ui
def test_mobile_toc_outside_click_closes_dropdown(page):
    """Clicking outside the nav closes an open mobile dropdown."""
    _goto_guide(page, {'width': 390, 'height': 844})

    page.click('#tocToggle')
    page.wait_for_timeout(150)
    page.evaluate('() => document.body.click()')
    page.wait_for_timeout(150)

    is_open = page.eval_on_selector('#tocList', 'el => el.classList.contains("toc-list--open")')
    assert not is_open


@pytest.mark.ui
def test_mobile_toc_link_click_closes_dropdown_and_navigates(page):
    """Clicking a TOC link closes the dropdown and jumps to the target section."""
    _goto_guide(page, {'width': 390, 'height': 844})

    page.click('#tocToggle')
    page.wait_for_timeout(150)
    page.click('#tocList a[href="#tracking-income"]')
    page.wait_for_timeout(200)

    is_open = page.eval_on_selector('#tocList', 'el => el.classList.contains("toc-list--open")')
    assert not is_open
    assert page.evaluate('() => location.hash') == '#tracking-income'


@pytest.mark.ui
def test_back_to_top_hidden_until_scrolled(page):
    """The 'Back to top' button is hidden at the top of the page and appears after scrolling."""
    _goto_guide(page, {'width': 1280, 'height': 900})

    visible_before = page.eval_on_selector(
        '#backToTop', 'el => el.classList.contains("back-to-top--visible")'
    )
    assert not visible_before

    page.evaluate('() => window.scrollTo(0, 800)')
    page.wait_for_timeout(200)
    visible_after = page.eval_on_selector(
        '#backToTop', 'el => el.classList.contains("back-to-top--visible")'
    )
    assert visible_after


@pytest.mark.ui
def test_back_to_top_scrolls_to_top(page):
    """Clicking 'Back to top' scrolls the page back to the very top."""
    _goto_guide(page, {'width': 1280, 'height': 900})

    page.evaluate('() => window.scrollTo(0, 800)')
    page.wait_for_timeout(200)
    page.click('#backToTop')
    page.wait_for_timeout(500)

    assert page.evaluate('() => window.scrollY') == 0


@pytest.mark.ui
def test_guide_tables_have_column_header_scope(page):
    """Every <th> in a guide table declares scope="col" for screen-reader table navigation."""
    _goto_guide(page, {'width': 1280, 'height': 900})

    scopes = page.eval_on_selector_all(
        '.guide-table th', 'els => els.map(e => e.getAttribute("scope"))'
    )
    assert len(scopes) > 0, "Expected at least one table header in the guide"
    assert all(s == 'col' for s in scopes), f"All guide-table <th> should have scope=col, got {scopes}"


@pytest.mark.ui
def test_back_to_top_has_accessible_label(page):
    """The 'Back to top' button exposes an accessible name via aria-label."""
    _goto_guide(page, {'width': 1280, 'height': 900})

    label = page.get_attribute('#backToTop', 'aria-label')
    assert label == 'Back to top'
