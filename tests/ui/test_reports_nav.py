import pytest


def _go_to_reports(page):
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)


@pytest.mark.ui
def test_active_group_label_highlights_when_tab_in_group_is_active(app_page):
    """When a tab is active, its parent group label chip reaches full opacity (opacity=1)."""
    page = app_page
    _go_to_reports(page)

    # Click a Trends tab — Money Flow
    page.click('[data-rptab="moneyflow"]')
    page.wait_for_timeout(150)

    # The Trends group label should be full opacity (has active child)
    trends_opacity = page.evaluate("""
        () => {
            const groups = document.querySelectorAll('.rpt-tab-group');
            for (const g of groups) {
                const label = g.querySelector('.rpt-tab-group-label');
                if (label && label.textContent.trim() === 'Trends') {
                    return parseFloat(window.getComputedStyle(g.querySelector('.rpt-tab-group-label')).opacity);
                }
            }
            return null;
        }
    """)
    assert trends_opacity is not None, "Trends group label not found"
    assert trends_opacity == pytest.approx(1.0, abs=0.05), \
        f"Expected Trends label opacity=1.0 when active, got {trends_opacity}"


@pytest.mark.ui
def test_inactive_group_label_is_dimmed(app_page):
    """Group labels whose group does not contain the active tab are dimmed (opacity < 1)."""
    page = app_page
    _go_to_reports(page)

    # Calendar is active by default — Activity group is full opacity, others are dimmed
    planning_opacity = page.evaluate("""
        () => {
            const groups = document.querySelectorAll('.rpt-tab-group');
            for (const g of groups) {
                const label = g.querySelector('.rpt-tab-group-label');
                if (label && label.textContent.trim() === 'Planning') {
                    return parseFloat(window.getComputedStyle(label).opacity);
                }
            }
            return null;
        }
    """)
    assert planning_opacity is not None, "Planning group label not found"
    assert planning_opacity < 0.9, \
        f"Expected Planning label to be dimmed when Calendar is active, got opacity={planning_opacity}"


@pytest.mark.ui
def test_cross_group_tab_switching_updates_active_class(app_page):
    """Switching from a tab in one group to a tab in another group moves rpt-tab-btn--active."""
    page = app_page
    _go_to_reports(page)

    # Start on calendar (Activity group)
    page.click('[data-rptab="calendar"]')
    page.wait_for_timeout(150)

    # Switch to Net Worth (Trends group)
    page.click('[data-rptab="networth"]')
    page.wait_for_timeout(150)

    calendar_active = page.evaluate(
        '() => document.querySelector("[data-rptab=\'calendar\']").classList.contains("rpt-tab-btn--active")'
    )
    networth_active = page.evaluate(
        '() => document.querySelector("[data-rptab=\'networth\']").classList.contains("rpt-tab-btn--active")'
    )
    assert not calendar_active, "Calendar tab should no longer be active"
    assert networth_active, "Net Worth tab should be active"


@pytest.mark.ui
def test_only_one_tab_active_at_a_time(app_page):
    """Exactly one .rpt-tab-btn--active exists at any time."""
    page = app_page
    _go_to_reports(page)

    for tab_id in ['calendar', 'spending', 'moneyflow', 'forecast']:
        page.click(f'[data-rptab="{tab_id}"]')
        page.wait_for_timeout(100)
        active_count = page.evaluate(
            '() => document.querySelectorAll(".rpt-tab-btn--active").length'
        )
        assert active_count == 1, \
            f"Expected exactly 1 active tab after clicking {tab_id}, got {active_count}"


@pytest.mark.ui
def test_tab_bar_is_sticky_positioned(app_page):
    """The .rpt-tab-bar has position:sticky in its computed style."""
    page = app_page
    _go_to_reports(page)

    position = page.evaluate(
        '() => window.getComputedStyle(document.querySelector(".rpt-tab-bar")).position'
    )
    assert position == 'sticky', f"Expected position:sticky, got {position}"


@pytest.mark.ui
def test_tab_bar_dark_mode_background(app_page):
    """In dark mode, .rpt-tab-bar gets a dark background so content scrolls cleanly under it."""
    page = app_page
    _go_to_reports(page)

    page.evaluate('() => document.body.classList.add("dark-mode")')
    page.wait_for_timeout(100)

    bg = page.evaluate(
        '() => window.getComputedStyle(document.querySelector(".rpt-tab-bar")).backgroundColor'
    )
    # bg-color in dark mode is #0f172a = rgb(15, 23, 42)
    assert bg != 'rgba(0, 0, 0, 0)', f"Dark mode tab bar should have a solid background, got: {bg}"

    # Restore
    page.evaluate('() => document.body.classList.remove("dark-mode")')


@pytest.mark.ui
def test_group_separators_are_hidden_on_mobile(app_page):
    """On a 480px viewport, .rpt-tab-group-sep elements are not displayed."""
    page = app_page
    # Navigate to reports at desktop size first, then resize to mobile
    _go_to_reports(page)
    page.wait_for_timeout(200)

    page.set_viewport_size({'width': 480, 'height': 800})
    page.wait_for_timeout(200)

    sep_display = page.evaluate("""
        () => {
            const seps = document.querySelectorAll('.rpt-tab-group-sep');
            return Array.from(seps).map(s => window.getComputedStyle(s).display);
        }
    """)
    assert all(d == 'none' for d in sep_display), \
        f"Expected all separators display:none on mobile, got: {sep_display}"

    page.set_viewport_size({'width': 1280, 'height': 800})
