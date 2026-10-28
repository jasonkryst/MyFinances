#!/usr/bin/env python3
"""
Tests for Bonus Advisor discoverability improvements (issue #267).
Covers command palette keyword search and Health page CTA link.
"""

import pytest

from tests.conftest import assert_no_errors


def _open_command_palette(page):
    page.keyboard.press("Control+k")
    page.wait_for_selector('#commandPaletteOverlay:not(.hidden)', timeout=5000)


def _close_command_palette(page):
    page.keyboard.press("Escape")
    page.wait_for_selector('#commandPaletteOverlay.hidden', state='attached', timeout=3000)


# ── Command palette keyword search ─────────────────────────────────────────────

@pytest.mark.feature
def test_bonus_advisor_command_found_by_label(app_page):
    """'Open Bonus Advisor' command is returned when searching 'Bonus'."""
    page = app_page
    _open_command_palette(page)
    page.fill('#commandPaletteInput', 'Bonus')
    page.wait_for_timeout(300)
    results = page.query_selector_all('#commandPaletteList li')
    labels = [r.text_content() for r in results]
    assert any('Bonus Advisor' in l for l in labels), (
        f"Expected 'Bonus Advisor' in results for 'Bonus', got: {labels}"
    )
    _close_command_palette(page)


@pytest.mark.feature
def test_bonus_advisor_command_found_by_keyword_windfall(app_page):
    """'Open Bonus Advisor' is found via the keyword 'windfall'."""
    page = app_page
    _open_command_palette(page)
    page.fill('#commandPaletteInput', 'windfall')
    page.wait_for_timeout(300)
    results = page.query_selector_all('#commandPaletteList li')
    labels = [r.text_content() for r in results]
    assert any('Bonus Advisor' in l for l in labels), (
        f"Expected 'Bonus Advisor' found via keyword 'windfall', got: {labels}"
    )
    _close_command_palette(page)


@pytest.mark.feature
def test_bonus_advisor_command_found_by_keyword_lump_sum(app_page):
    """'Open Bonus Advisor' is found via the keyword 'lump sum'."""
    page = app_page
    _open_command_palette(page)
    page.fill('#commandPaletteInput', 'lump')
    page.wait_for_timeout(300)
    results = page.query_selector_all('#commandPaletteList li')
    labels = [r.text_content() for r in results]
    assert any('Bonus Advisor' in l for l in labels), (
        f"Expected 'Bonus Advisor' found via keyword 'lump', got: {labels}"
    )
    _close_command_palette(page)


@pytest.mark.feature
def test_unrelated_search_does_not_show_bonus_advisor(app_page):
    """Searching for 'budget' does not include Bonus Advisor in results."""
    page = app_page
    _open_command_palette(page)
    page.fill('#commandPaletteInput', 'zzznomatch')
    page.wait_for_timeout(300)
    results = page.query_selector_all('#commandPaletteList li')
    labels = [r.text_content() for r in results]
    assert not any('Bonus Advisor' in l for l in labels), (
        f"Did not expect 'Bonus Advisor' for unmatched query, got: {labels}"
    )
    _close_command_palette(page)


# ── Health page CTA ────────────────────────────────────────────────────────────

def _seed_surplus(page):
    """Seed a funded account (the Health surplus section analyzes an account's
    balance against its upcoming window) so the CTA renders."""
    page.evaluate("""() => {
        window.app.accounts = [{
            id: 9000, name: 'Surplus Checking', type: 'Checking',
            startingBalance: 50000, balance: 50000
        }];
        window.app.incomes = [{
            id: 9001, name: 'Main Job', amount: 10000, frequency: 'monthly',
            accountId: null, startDate: null, endDate: null, notes: ''
        }];
        window.app.saveToStorage();
    }""")


@pytest.mark.feature
def test_health_bonus_cta_visible_with_surplus(app_page):
    """Bonus Advisor CTA link is visible on the Health page when there is a surplus."""
    page = app_page
    _seed_surplus(page)
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.wait_for_timeout(500)

    cta = page.query_selector('#healthBonusAdvisorLink')
    assert cta, "Expected #healthBonusAdvisorLink when there is a surplus"
    assert cta.is_visible(), "CTA link should be visible"
    text = cta.text_content()
    assert 'Bonus' in text or 'Advisor' in text, f"CTA text should mention bonus/advisor, got: {text}"


@pytest.mark.feature
def test_health_bonus_cta_absent_with_no_income(app_page):
    """Bonus Advisor CTA is not shown when there is no surplus (no income)."""
    page = app_page
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.wait_for_timeout(500)

    cta = page.query_selector('#healthBonusAdvisorLink')
    assert cta is None or not cta.is_visible(), (
        "CTA link should not be visible when there is no surplus"
    )


@pytest.mark.feature
def test_health_bonus_cta_navigates_to_income(app_page):
    """Clicking the Bonus Advisor CTA navigates to the Income page."""
    page = app_page
    _seed_surplus(page)
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.wait_for_timeout(500)

    cta = page.query_selector('#healthBonusAdvisorLink')
    assert cta and cta.is_visible(), "CTA link must be visible to click"
    cta.click()
    page.wait_for_selector('#incomeSection.active', timeout=5000)
    section = page.query_selector('#incomeSection')
    assert section, "Expected income section to be active after clicking CTA"

    assert_no_errors(page)


@pytest.mark.feature
def test_no_console_errors_on_health_with_surplus(app_page):
    """No JS errors on the Health page when surplus CTA is rendered."""
    page = app_page
    _seed_surplus(page)
    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)
    page.wait_for_timeout(500)
    assert_no_errors(page)
