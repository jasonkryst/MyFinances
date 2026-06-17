#!/usr/bin/env python3
"""
Behavioral UI tests: Main nav grouped structure.
Tests the three nav groups (Overview, Manage, Analyze) with active states,
cross-group navigation, and mobile responsiveness.
"""
import pytest

pytestmark = pytest.mark.ui


async def test_active_group_label_highlights(async_app_page):
    """When health (Overview group) is active, the Overview nav-group-label should have a light background."""
    page = async_app_page

    # Health is active by default — Overview group label should be "active"
    # Get the Overview nav-group (the one whose label text is "Overview")
    label = await page.evaluate('''() => {
        const labels = [...document.querySelectorAll('#topNav .nav-group-label')];
        const overviewLabel = labels.find(l => l.textContent.trim() === 'Overview');
        if (!overviewLabel) return null;
        const style = window.getComputedStyle(overviewLabel);
        return { bg: style.backgroundColor, color: style.color };
    }''')
    assert label is not None, "Overview nav-group-label not found"
    # Active state = white-ish background (rgba(255,255,255,0.90))
    # The background should NOT be the inactive rgba(255,255,255,0.18)
    # Check it has meaningful background (not transparent)
    assert label['bg'] != 'rgba(0, 0, 0, 0)' and label['bg'] != 'transparent', \
        f"Overview label should have active background, got: {label['bg']}"


async def test_inactive_group_labels_dimmed(async_app_page):
    """After loading (health active), the Manage and Analyze group labels should have lower-opacity/different background than Overview."""
    page = async_app_page

    result = await page.evaluate('''() => {
        const labels = [...document.querySelectorAll('#topNav .nav-group-label')];
        return labels.map(l => ({
            text: l.textContent.trim(),
            bg: window.getComputedStyle(l).backgroundColor,
        }));
    }''')
    assert len(result) == 3, f"Expected 3 group labels, got {len(result)}"
    overview = next(r for r in result if r['text'] == 'Overview')
    manage   = next(r for r in result if r['text'] == 'Manage')
    analyze  = next(r for r in result if r['text'] == 'Analyze')
    # Active (Overview) and inactive labels should differ
    assert overview['bg'] != manage['bg'], "Overview and Manage labels should have different backgrounds"
    assert overview['bg'] != analyze['bg'], "Overview and Analyze labels should have different backgrounds"


async def test_cross_group_navigation(async_app_page):
    """Click a button in the Manage group; exactly one .page-button.active should exist and it should be in the Manage group."""
    page = async_app_page

    # Click "Savings" (Manage group)
    await page.click('[data-page="savings"]')
    await page.wait_for_timeout(200)
    active_btns = await page.query_selector_all('.page-button.active')
    assert len(active_btns) == 1, f"Exactly 1 active button expected, got {len(active_btns)}"
    active_page = await active_btns[0].get_attribute('data-page')
    assert active_page == 'savings', f"Active button should be 'savings', got '{active_page}'"


async def test_only_one_page_active_at_a_time(async_app_page):
    """Cycle through several pages; after each click exactly one .page-button has .active."""
    page = async_app_page

    for page_name in ['health', 'reports', 'liabilities', 'reconcile', 'income']:
        await page.click(f'[data-page="{page_name}"]')
        await page.wait_for_timeout(150)
        active = await page.query_selector_all('.page-button.active')
        assert len(active) == 1, \
            f"After clicking '{page_name}', expected 1 active button but got {len(active)}"
        page_attr = await active[0].get_attribute('data-page')
        assert page_attr == page_name, \
            f"Active button should be '{page_name}', got '{page_attr}'"


async def test_nav_group_separators_hidden_on_mobile(async_app_page):
    """At 480px viewport width, .nav-group-sep elements should be hidden (display: none)."""
    page = async_app_page

    await page.set_viewport_size({'width': 480, 'height': 800})
    await page.wait_for_timeout(200)
    seps = await page.query_selector_all('.nav-group-sep')
    assert len(seps) > 0, "No .nav-group-sep elements found"
    for sep in seps:
        display = await sep.evaluate('el => window.getComputedStyle(el).display')
        assert display == 'none', f"nav-group-sep should be display:none on mobile, got '{display}'"
