#!/usr/bin/env python3
"""
Service-worker update-available banner tests (GitHub issue #75).

The banner is triggered from src/serviceWorker.js's updatefound/statechange
listener, which is awkward to force deterministically in Playwright (it
depends on real SW lifecycle timing). Since app.showUpdateAvailableBanner(waitingWorker)
is a plain, directly-callable method (same pattern as app.showStorageQuotaWarning
in tests/features/test_storage_quota.py), these tests call it directly with a
stub waitingWorker object rather than forcing a real SW update cycle.
"""

import pytest

from tests.conftest import assert_no_errors


def _show_banner(page):
    page.evaluate("""() => {
        window.__swPostMessageCalls = window.__swPostMessageCalls || [];
        const fakeWorker = { postMessage: (msg) => window.__swPostMessageCalls.push(msg) };
        window.app.showUpdateAvailableBanner(fakeWorker);
    }""")


@pytest.mark.ui
def test_update_banner_absent_by_default(app_page):
    assert not app_page.is_visible('#swUpdateBanner')


@pytest.mark.ui
def test_update_banner_appears(app_page):
    page = app_page
    _show_banner(page)
    page.wait_for_timeout(100)

    assert page.is_visible('#swUpdateBanner'), "Expected the update-available banner to appear"
    assert_no_errors(page)


@pytest.mark.ui
def test_update_banner_is_dismissible(app_page):
    page = app_page
    _show_banner(page)
    page.wait_for_timeout(100)
    assert page.is_visible('#swUpdateBanner')

    page.click('.sw-update-banner-close')
    page.wait_for_timeout(100)
    assert not page.is_visible('#swUpdateBanner')


@pytest.mark.ui
def test_update_banner_does_not_duplicate(app_page):
    page = app_page
    _show_banner(page)
    _show_banner(page)
    page.wait_for_timeout(100)

    banners = page.query_selector_all('#swUpdateBanner')
    assert len(banners) == 1, f"Expected exactly one banner element, got {len(banners)}"


@pytest.mark.ui
def test_reload_button_posts_skip_waiting_to_waiting_worker(app_page):
    page = app_page
    _show_banner(page)
    page.wait_for_timeout(100)

    page.click('.sw-update-banner-reload')
    page.wait_for_timeout(100)

    calls = page.evaluate("() => window.__swPostMessageCalls")
    assert calls == [{'type': 'SKIP_WAITING'}], f"Expected a single SKIP_WAITING postMessage call, got {calls}"
