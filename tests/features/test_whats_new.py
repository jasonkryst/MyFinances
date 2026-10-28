#!/usr/bin/env python3
"""
What's New notification tests (issue #289)
Tests the version-change notification dot, modal, and localStorage persistence.
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
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
    """The newest What's New entry must be for the running app's major.minor
    version (patch releases don't need their own entry), so this list can't
    silently go stale again — it drifted 7 minor versions behind once (6.41→6.48)."""
    page = app_page

    page.click('#accountMenuBtn')
    page.wait_for_selector('#accountMenuDropdown:not(.hidden)', timeout=3000)
    page.click('#accountMenuWhatsNewBtn')
    page.wait_for_selector('#whatsNewModal:not(.hidden)', timeout=3000)

    app_version_text = page.inner_text('#appVersion')  # e.g. "v6.32.0"
    app_major_minor = tuple(int(p) for p in app_version_text.lstrip('v').split('.')[:2])

    first_heading = page.query_selector('.wn-version-heading')
    assert first_heading, "Expected at least one version heading in the What's New modal"
    heading_major_minor = tuple(int(p) for p in first_heading.inner_text().split('—')[0].strip().split('.')[:2])

    assert heading_major_minor == app_major_minor, (
        f"Newest What's New entry is {heading_major_minor} but the app is {app_major_minor} — "
        f"add a WHATS_NEW_ENTRIES entry in src/ui.js for this release."
    )


def _whats_new_versions():
    src = (REPO_ROOT / 'src' / 'ui.js').read_text(encoding='utf-8')
    block = src.split('const WHATS_NEW_ENTRIES = [', 1)[1]
    return [tuple(int(p) for p in m) for m in re.findall(r"version: '(\d+)\.(\d+)\.(\d+)", block)]


def _changelog_versions():
    text = (REPO_ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    return [tuple(int(p) for p in m) for m in re.findall(r'^## \[(\d+)\.(\d+)\.(\d+)\]', text, re.M)]


@pytest.mark.feature
def test_whats_new_has_no_gaps_vs_changelog():
    """Every minor release in CHANGELOG.md from the oldest What's New entry up
    to the newest must have its own What's New entry (no skipped versions)."""
    wn = _whats_new_versions()
    assert wn, "WHATS_NEW_ENTRIES appears empty or unparseable"
    oldest = min(wn)
    wn_minors = {v[:2] for v in wn}
    missing = sorted({v[:2] for v in _changelog_versions() if v >= oldest and v[2] == 0} - wn_minors)
    assert not missing, (
        f"CHANGELOG minor releases with no What's New entry: "
        f"{['.'.join(map(str, m)) + '.0' for m in missing]} — add them to WHATS_NEW_ENTRIES in src/ui.js."
    )


@pytest.mark.feature
def test_whats_new_entries_descending_and_not_ahead_of_app():
    """Negative guard: entries must be newest-first and never newer than APP_VERSION."""
    wn = _whats_new_versions()
    assert wn == sorted(wn, reverse=True), f"WHATS_NEW_ENTRIES out of order: {wn}"
    app_src = (REPO_ROOT / 'src' / 'utils.js').read_text(encoding='utf-8')
    app_version = tuple(int(p) for p in re.search(r"APP_VERSION = '(\d+)\.(\d+)\.(\d+)'", app_src).groups())
    assert wn[0] <= app_version, f"Newest What's New entry {wn[0]} is ahead of APP_VERSION {app_version}"
