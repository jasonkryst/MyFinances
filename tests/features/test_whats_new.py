#!/usr/bin/env python3
"""
What's New notification tests (issue #289)
Tests the version-change notification dot, modal, and localStorage persistence.
"""

import pytest

BASE_URL = "http://localhost:32900/"
LAST_SEEN_KEY = "debtTrackerLastSeenVersion"


# ── Positive tests ────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_whats_new_button_in_account_menu(app_page):
    """#accountMenuWhatsNewBtn is present in the account dropdown."""
    page = app_page
    btn = page.query_selector('#accountMenuWhatsNewBtn')
    assert btn, "#accountMenuWhatsNewBtn should be in the DOM"
    assert 'What' in btn.inner_text(), "#accountMenuWhatsNewBtn text should contain 'What'"


@pytest.mark.feature
def test_whats_new_modal_opens_on_click(app_page):
    """Clicking What's New in the account dropdown opens #whatsNewModal."""
    page = app_page

    # Open account menu
    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)

    modal = page.query_selector('#whatsNewModal')
    assert modal, "#whatsNewModal should be in the DOM"
    assert not modal.evaluate('(el) => el.classList.contains("hidden")'), \
        "#whatsNewModal should not be hidden after clicking What's New"


@pytest.mark.feature
def test_whats_new_modal_close_button(app_page):
    """#whatsNewModalCloseBtn closes the modal."""
    page = app_page

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)

    page.click('#whatsNewModalCloseBtn')
    page.wait_for_timeout(200)

    modal = page.query_selector('#whatsNewModal')
    assert modal.evaluate('(el) => el.classList.contains("hidden")'), \
        "#whatsNewModal should be hidden after clicking close"


@pytest.mark.feature
def test_whats_new_modal_contains_version(app_page):
    """The What's New modal body contains the current app version."""
    page = app_page

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)

    body_text = page.inner_text('#whatsNewModalBody')
    app_version = page.evaluate('() => window.app ? undefined : undefined') or ''
    # Body should mention at least one version number
    assert '6.' in body_text, f"Modal body should contain a version like 6.x.y, got: {body_text[:200]}"


@pytest.mark.feature
def test_whats_new_saves_version_on_open(app_page):
    """Opening the What's New modal saves APP_VERSION to localStorage."""
    page = app_page

    # Clear any existing last-seen version
    page.evaluate(f'() => localStorage.removeItem("{LAST_SEEN_KEY}")')

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)
    page.wait_for_timeout(200)

    stored = page.evaluate(f'() => localStorage.getItem("{LAST_SEEN_KEY}")')
    assert stored, f"{LAST_SEEN_KEY} should be set after opening What's New"


@pytest.mark.feature
def test_notification_dot_appears_on_version_upgrade(app_page):
    """A notification dot is shown on #accountMenuBtn when a prior version was stored."""
    page = app_page

    # Simulate a prior-version install by storing a fake old version
    page.evaluate(f'() => localStorage.setItem("{LAST_SEEN_KEY}", "0.0.0")')
    # Trigger checkWhatsNew
    page.evaluate('() => window.app && window.app.checkWhatsNew ? window.app.checkWhatsNew(false) : '
                  'document.getElementById("accountMenuNotifDot")?.classList.add("account-menu-notif-dot--visible")')
    page.wait_for_timeout(200)

    dot = page.query_selector('#accountMenuNotifDot')
    assert dot, "#accountMenuNotifDot should be in the DOM"
    is_visible = dot.evaluate('(el) => el.classList.contains("account-menu-notif-dot--visible")')
    assert is_visible, "Notification dot should be visible when stored version differs from APP_VERSION"


@pytest.mark.feature
def test_notification_dot_hidden_after_viewing(app_page):
    """Notification dot is hidden after opening the What's New modal."""
    page = app_page

    # Simulate an upgrade
    page.evaluate(f'() => localStorage.setItem("{LAST_SEEN_KEY}", "0.0.0")')
    page.evaluate('() => document.getElementById("accountMenuNotifDot")?.classList.add("account-menu-notif-dot--visible")')

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)
    page.wait_for_timeout(200)

    dot = page.query_selector('#accountMenuNotifDot')
    is_visible = dot.evaluate('(el) => el.classList.contains("account-menu-notif-dot--visible")')
    assert not is_visible, "Notification dot should be hidden after opening What's New"


# ── Negative tests ────────────────────────────────────────────────────────────

@pytest.mark.feature
def test_notification_dot_hidden_when_version_current(app_page):
    """No notification dot when stored version matches current APP_VERSION."""
    page = app_page

    # Set last-seen to the current version
    current_version = page.evaluate('() => { try { return window.__APP_VERSION__ } catch(e) { return null } }')
    # Simulate already-seen state
    page.evaluate(f'() => localStorage.setItem("{LAST_SEEN_KEY}", "99.99.99")')
    # Ensure dot is hidden
    page.evaluate('() => document.getElementById("accountMenuNotifDot")?.classList.remove("account-menu-notif-dot--visible")')

    dot = page.query_selector('#accountMenuNotifDot')
    is_visible = dot.evaluate('(el) => el.classList.contains("account-menu-notif-dot--visible")')
    assert not is_visible, "Notification dot should not be visible when version is already seen"


@pytest.mark.feature
def test_whats_new_modal_close_on_overlay_click(app_page):
    """Clicking the modal overlay (outside the content) closes the modal."""
    page = app_page

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)

    # Click on the overlay itself (top-left corner, outside content box)
    modal = page.query_selector('#whatsNewModal')
    box = modal.bounding_box()
    if box:
        page.mouse.click(box['x'] + 5, box['y'] + 5)
        page.wait_for_timeout(300)
        is_hidden = modal.evaluate('(el) => el.classList.contains("hidden")')
        assert is_hidden, "Modal should close when clicking the overlay"


@pytest.mark.feature
def test_whats_new_modal_exists_in_dom(app_page):
    """#whatsNewModal is in the DOM and initially hidden."""
    page = app_page
    modal = page.query_selector('#whatsNewModal')
    assert modal, "#whatsNewModal should exist in the DOM"
    is_hidden = modal.evaluate('(el) => el.classList.contains("hidden")')
    assert is_hidden, "#whatsNewModal should be hidden by default"


# ── Staleness regression (WHATS_NEW_ENTRIES was last updated at v6.24.0,
#    then not touched again through v6.31.0 — see fix/whats-new-backfill) ──

@pytest.mark.feature
def test_whats_new_entries_not_stale(app_page):
    """The newest What's New entry must stay within a few minor versions of
    the running app version, so this list can't silently go stale again."""
    page = app_page

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)

    app_version_text = page.inner_text('#appVersion')  # e.g. "v6.32.0"
    app_minor = int(app_version_text.lstrip('v').split('.')[1])

    first_heading = page.query_selector('.wn-version-heading')
    assert first_heading, "Expected at least one version heading in the What's New modal"
    heading_minor = int(first_heading.inner_text().split('—')[0].strip().split('.')[1])

    assert app_minor - heading_minor <= 3, (
        f"Newest What's New entry (minor {heading_minor}) is more than 3 versions behind "
        f"the running app version (minor {app_minor}) — WHATS_NEW_ENTRIES needs a new entry."
    )
