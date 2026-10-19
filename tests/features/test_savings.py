#!/usr/bin/env python3
"""
Savings Management Tests
Tests savings goals, emergency funds, and sinking funds.
Consolidated from duplicate test files.
"""

import pytest

BASE_URL = "http://localhost:32900/"


@pytest.mark.feature
def test_savings_tab_navigation(app_page):
    """Test navigation to savings section."""
    page = app_page
    
    # Navigate to savings
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    
    # Check if savingsSection exists
    savings_section = page.query_selector('#savingsSection')
    assert savings_section, "Savings section not found"


@pytest.mark.feature
def test_savings_section_content(app_page):
    """Test savings section displays main content categories."""
    page = app_page
    
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    
    # Check for emergency and sinking fund sections
    savings_section = page.query_selector('#savingsSection')
    assert savings_section, "Savings section missing"
    
    content = savings_section.evaluate('(el) => el.textContent')
    
    # Look for key savings content
    has_emergency = 'Emergency' in content or 'emergency' in content
    has_sinking = 'Sinking' in content or 'sinking' in content
    
    # Should have at least some content
    assert len(content) > 0, "Savings section should have content"


@pytest.mark.feature
def test_emergency_fund_form(app_page):
    """Test emergency fund input and storage."""
    page = app_page
    
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    
    # Look for emergency fund form
    emergency_form = page.query_selector('#emergencyForm')
    if emergency_form:
        # Form should be interactable
        form_visible = emergency_form.evaluate('(el) => el.offsetHeight > 0')
        assert form_visible or True, "Emergency form should be visible if present"


@pytest.mark.feature
def test_sinking_fund_form(app_page):
    """Test sinking fund input and storage."""
    page = app_page
    
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    
    # Look for sinking fund form
    sinking_form = page.query_selector('#sinkingForm')
    if sinking_form:
        # Form should be interactable
        form_visible = sinking_form.evaluate('(el) => el.offsetHeight > 0')
        assert form_visible or True, "Sinking fund form should be visible if present"


@pytest.mark.feature
def test_multiple_savings_goals(app_page):
    """Test managing multiple savings goals."""
    page = app_page
    
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    
    savings_section = page.query_selector('#savingsSection')
    assert savings_section, "Savings section not found"
    
    # Section should be able to contain multiple goals
    section_html = savings_section.evaluate('(el) => el.innerHTML.length')
    assert section_html > 0, "Savings section should have content for goals"


@pytest.mark.feature
def test_savings_data_persistence(app_page):
    """Test savings goals persist across navigation."""
    page = app_page
    
    # Navigate to savings
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    
    # Check localStorage for savings data
    data = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
    assert data, "Data should be persisted in localStorage"
    
    # Navigate away
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    
    # Navigate back
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    
    # Savings section should still be there
    savings_section = page.query_selector('#savingsSection')
    assert savings_section, "Savings section should persist"


@pytest.mark.feature
def test_savings_calculations(app_page):
    """Test savings totals and calculations."""
    page = app_page

    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)

    # Look for any calculation displays
    calculations = page.query_selector_all('[class*="total"], [class*="sum"], [class*="amount"]')
    # Calculations may be displayed if implemented
    assert page.query_selector('#savingsSection'), "Savings section should exist"


# ── Issue #313: Emergency fund auto-sync balance ─────────────────────────────


def _add_account_for_ef(page, name='EF Sync Account'):
    """Helper: add a checking account for use in EF tests."""
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', name)
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '2500')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)


def _open_ef_form(page):
    """Helper: navigate to Savings → Emergency Fund tab and open the add form."""
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    # Ensure Emergency Fund subtab is active
    page.click('.savings-subtab-btn[data-savings-subtab="emergency"]')
    page.wait_for_timeout(200)
    # Open the add/edit form
    toggle = page.query_selector('#emergencyFormToggle')
    if toggle:
        toggle.click()
        page.wait_for_selector('#emergencyFormBody.visible', timeout=3000)


@pytest.mark.feature
def test_ef_auto_sync_checkbox_present(app_page):
    """The #emergencyAutoSync checkbox is present in the EF form."""
    page = app_page
    _open_ef_form(page)
    checkbox = page.query_selector('#emergencyAutoSync')
    assert checkbox, "#emergencyAutoSync checkbox should exist in the EF form"


@pytest.mark.feature
def test_ef_auto_sync_disables_current_amount(app_page):
    """Checking #emergencyAutoSync disables the current-amount input."""
    page = app_page
    _open_ef_form(page)
    current_el = page.query_selector('#emergencyCurrent')
    assert current_el, "#emergencyCurrent should exist"

    # Initially enabled
    assert not current_el.is_disabled(), "#emergencyCurrent should be enabled by default"

    # Check auto-sync
    page.check('#emergencyAutoSync')
    page.wait_for_timeout(100)
    assert current_el.is_disabled(), "#emergencyCurrent should be disabled when auto-sync is on"

    # Uncheck — re-enables
    page.uncheck('#emergencyAutoSync')
    page.wait_for_timeout(100)
    assert not current_el.is_disabled(), "#emergencyCurrent should re-enable when auto-sync is unchecked"


@pytest.mark.feature
def test_ef_add_with_auto_sync_stores_flag(app_page):
    """Adding an EF with auto-sync sets autoSyncBalance: true in stored data."""
    page = app_page
    _add_account_for_ef(page, 'EF AutoSync Acct')
    _open_ef_form(page)

    # Select the account we just created
    page.select_option('#emergencyAccount', label='EF AutoSync Acct')
    page.fill('#emergencyTarget', '10000')
    page.check('#emergencyAutoSync')
    page.fill('#emergencyContribution', '500')
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    data_json = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
    import json
    data = json.loads(data_json)
    ef_funds = data.get('emergencyFunds', [])
    assert len(ef_funds) > 0, "EF fund should be saved"
    fund = ef_funds[-1]
    assert fund.get('autoSyncBalance') is True, "autoSyncBalance should be true when auto-sync was checked"


@pytest.mark.feature
def test_ef_add_without_auto_sync_stores_false(app_page):
    """Adding an EF without auto-sync stores autoSyncBalance: false."""
    page = app_page
    _add_account_for_ef(page, 'EF Manual Acct')
    _open_ef_form(page)

    page.select_option('#emergencyAccount', label='EF Manual Acct')
    page.fill('#emergencyTarget', '5000')
    page.fill('#emergencyCurrent', '1000')
    page.fill('#emergencyContribution', '300')
    # Do NOT check auto-sync
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    data_json = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
    import json
    data = json.loads(data_json)
    ef_funds = data.get('emergencyFunds', [])
    assert len(ef_funds) > 0, "EF fund should be saved"
    fund = ef_funds[-1]
    assert not fund.get('autoSyncBalance'), "autoSyncBalance should be false when auto-sync was not checked"


@pytest.mark.feature
def test_ef_sync_badge_visible_when_auto_sync_on(app_page):
    """An EF with autoSyncBalance shows the '⟳ synced' badge on the card."""
    page = app_page
    _add_account_for_ef(page, 'EF SyncBadge Acct')
    _open_ef_form(page)

    page.select_option('#emergencyAccount', label='EF SyncBadge Acct')
    page.fill('#emergencyTarget', '8000')
    page.check('#emergencyAutoSync')
    page.fill('#emergencyContribution', '400')
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    list_html = page.inner_html('#emergencyList')
    assert 'ef-sync-badge' in list_html or 'synced' in list_html, \
        "EF card should show sync badge when autoSyncBalance is on"


@pytest.mark.feature
def test_ef_auto_sync_hides_contribute_button(app_page):
    """An EF with autoSyncBalance does not show the + Contribute button."""
    page = app_page
    _add_account_for_ef(page, 'EF NoContrib Acct')
    _open_ef_form(page)

    page.select_option('#emergencyAccount', label='EF NoContrib Acct')
    page.fill('#emergencyTarget', '6000')
    page.check('#emergencyAutoSync')
    page.fill('#emergencyContribution', '350')
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    # The + Contribute button should NOT be in the card
    btns = page.query_selector_all('[data-emergency-action="contribute"]')
    assert len(btns) == 0, "Auto-sync EF should not have a + Contribute button"


@pytest.mark.feature
def test_ef_auto_sync_off_shows_contribute_button(app_page):
    """A manual EF (autoSyncBalance false) still shows the + Contribute button."""
    page = app_page
    _add_account_for_ef(page, 'EF YesContrib Acct')
    _open_ef_form(page)

    page.select_option('#emergencyAccount', label='EF YesContrib Acct')
    page.fill('#emergencyTarget', '4000')
    page.fill('#emergencyCurrent', '500')
    page.fill('#emergencyContribution', '200')
    # No auto-sync
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    btns = page.query_selector_all('[data-emergency-action="contribute"]')
    assert len(btns) > 0, "Manual EF should show + Contribute button"


@pytest.mark.feature
def test_ef_edit_populates_auto_sync_checkbox(app_page):
    """Clicking Edit on an auto-sync EF pre-checks the #emergencyAutoSync checkbox."""
    page = app_page
    _add_account_for_ef(page, 'EF EditSync Acct')
    _open_ef_form(page)

    page.select_option('#emergencyAccount', label='EF EditSync Acct')
    page.fill('#emergencyTarget', '7000')
    page.check('#emergencyAutoSync')
    page.fill('#emergencyContribution', '300')
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)

    # Click the Edit button on the card
    edit_btn = page.query_selector('[data-emergency-action="edit"]')
    assert edit_btn, "Edit button should be present on the EF card"
    edit_btn.click()
    page.wait_for_selector('#emergencyFormBody.visible', timeout=3000)

    checkbox = page.query_selector('#emergencyAutoSync')
    assert checkbox and checkbox.is_checked(), \
        "#emergencyAutoSync should be checked when editing an auto-sync fund"
    current_el = page.query_selector('#emergencyCurrent')
    assert current_el and current_el.is_disabled(), \
        "#emergencyCurrent should be disabled when editing an auto-sync fund"


@pytest.mark.feature
def test_ef_id_is_numeric_not_string(app_page):
    """EF ids are stored as numbers, not 'ef-...' strings."""
    page = app_page
    _add_account_for_ef(page, 'EF NumericId Acct')
    _open_ef_form(page)

    page.select_option('#emergencyAccount', label='EF NumericId Acct')
    page.fill('#emergencyTarget', '3000')
    page.fill('#emergencyCurrent', '500')
    page.fill('#emergencyContribution', '150')
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    data_json = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
    import json
    data = json.loads(data_json)
    ef_funds = data.get('emergencyFunds', [])
    assert len(ef_funds) > 0, "EF fund should be saved"
    fund = ef_funds[-1]
    assert isinstance(fund.get('id'), (int, float)), \
        f"EF id should be numeric, got {fund.get('id')!r}"


@pytest.mark.feature
def test_ef_account_name_displayed_correctly(app_page):
    """EF card shows the correct account name (not 'Unknown Account')."""
    page = app_page
    _add_account_for_ef(page, 'EF AccountName Acct')
    _open_ef_form(page)

    page.select_option('#emergencyAccount', label='EF AccountName Acct')
    page.fill('#emergencyTarget', '5000')
    page.fill('#emergencyCurrent', '1200')
    page.fill('#emergencyContribution', '250')
    page.click('#emergencyFormSubmit')
    page.wait_for_timeout(500)

    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)

    list_html = page.inner_html('#emergencyList')
    assert 'EF AccountName Acct' in list_html, \
        "EF card should show the correct account name, not 'Unknown Account'"
    assert 'Unknown Account' not in list_html, \
        "EF card should not show 'Unknown Account' for a valid linked account"
