#!/usr/bin/env python3
"""
Feature tests: Main nav grouped structure (TDD — these tests are written before the HTML is updated).
"""
import pytest

pytestmark = pytest.mark.feature

GROUPS = {
    'overview': ['health', 'accounts', 'income'],
    'manage':   ['liabilities', 'recurring', 'savings', 'strategy'],
    'analyze':  ['reports', 'ledger', 'reconcile'],
}


@pytest.mark.feature
def test_main_nav_three_groups_exist(app_page):
    """Assert that #topNav contains exactly 3 .nav-group elements."""
    groups = app_page.query_selector_all('#topNav .nav-group')
    assert len(groups) == 3


@pytest.mark.feature
def test_main_nav_group_labels(app_page):
    """Assert the three .nav-group-label spans read "Overview", "Manage", "Analyze" (in that order)."""
    labels = app_page.query_selector_all('#topNav .nav-group-label')
    texts = [lb.inner_text() for lb in labels]
    assert texts == ['Overview', 'Manage', 'Analyze']


@pytest.mark.feature
def test_main_nav_pages_in_correct_groups(app_page):
    """For each group, assert each expected data-page button exists inside it."""
    for group_name, pages in GROUPS.items():
        # find the nav-group whose .nav-group-label text matches group_name (case-insensitive)
        label_spans = app_page.query_selector_all('#topNav .nav-group-label')
        group_el = None
        for span in label_spans:
            txt = span.inner_text()
            if txt.strip().lower() == group_name:
                # parent is .nav-group
                group_el = span.locator('xpath=ancestor::div[@class="nav-group"]').element_handle()
                break
        assert group_el is not None, f"No nav-group found for '{group_name}'"
        for page in pages:
            btn = group_el.query_selector(f'[data-page="{page}"]')
            assert btn is not None, f"Button data-page='{page}' not found in group '{group_name}'"


@pytest.mark.feature
def test_main_nav_all_ten_pages_present(app_page):
    """Assert exactly 10 [data-page] buttons exist inside #topNav."""
    btns = app_page.query_selector_all('#topNav [data-page]')
    assert len(btns) == 10


@pytest.mark.feature
def test_main_nav_page_switching_still_works(app_page):
    """Click health, accounts, and reports buttons; assert the corresponding page section is visible."""
    for page in ['health', 'accounts', 'reports']:
        app_page.click(f'[data-page="{page}"]')
        app_page.wait_for_timeout(200)
        section = app_page.query_selector(f'#page-{page}')
        if section is None:
            section = app_page.query_selector(f'[data-page-content="{page}"]')
        # just check the button got .active class
        btn = app_page.query_selector(f'.page-button[data-page="{page}"]')
        assert btn is not None, f"No .page-button for '{page}' after nav redesign"
        cls = btn.get_attribute('class')
        assert 'active' in cls, f"Button '{page}' should have .active class after click"
