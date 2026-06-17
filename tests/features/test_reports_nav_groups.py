import pytest

GROUPS = {
    'activity': ['calendar', 'spending', 'incomeexp'],
    'trends':   ['moneyflow', 'variance', 'networth'],
    'planning': ['forecast'],
}

@pytest.mark.feature
def test_reports_nav_three_groups_exist(app_page):
    """Three .rpt-tab-group elements exist inside .rpt-tab-bar."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    count = page.evaluate('() => document.querySelectorAll(".rpt-tab-group").length')
    assert count == 3, f"Expected 3 tab groups, got {count}"


@pytest.mark.feature
def test_reports_nav_group_labels(app_page):
    """Group chip labels read Activity, Trends, Planning."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    labels = page.evaluate("""
        () => Array.from(document.querySelectorAll('.rpt-tab-group-label'))
                   .map(el => el.textContent.trim())
    """)
    assert labels == ['Activity', 'Trends', 'Planning'], f"Got: {labels}"


@pytest.mark.feature
def test_reports_nav_tabs_in_correct_groups(app_page):
    """Each tab button lives inside the correct .rpt-tab-group."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    for group_id, expected_tabs in GROUPS.items():
        for tab_id in expected_tabs:
            in_group = page.evaluate(f"""
                () => {{
                    const btn = document.querySelector('[data-rptab="{tab_id}"]');
                    if (!btn) return false;
                    return btn.closest('.rpt-tab-group') !== null;
                }}
            """)
            assert in_group, f"Tab '{tab_id}' not inside a .rpt-tab-group"


@pytest.mark.feature
def test_reports_nav_all_seven_tabs_present(app_page):
    """All 7 original tabs are still reachable after restructure."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    all_tabs = [tab for tabs in GROUPS.values() for tab in tabs]
    for tab_id in all_tabs:
        btn = page.query_selector(f'[data-rptab="{tab_id}"]')
        assert btn, f"Tab button data-rptab='{tab_id}' not found"


@pytest.mark.feature
def test_reports_nav_tab_switching_still_works(app_page):
    """Clicking each tab activates its panel — regression test for switchTab()."""
    page = app_page
    page.click('button[data-page="reports"]')
    page.wait_for_timeout(200)

    all_tabs = [tab for tabs in GROUPS.values() for tab in tabs]
    for tab_id in all_tabs:
        page.click(f'[data-rptab="{tab_id}"]')
        page.wait_for_timeout(150)

        is_active = page.evaluate(f"""
            () => document.getElementById('rptPanel-{tab_id}')
                          ?.classList.contains('rpt-tab-panel--active')
        """)
        assert is_active, f"Panel rptPanel-{tab_id} not active after clicking its tab"
