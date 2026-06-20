#!/usr/bin/env python3
"""
localStorage Quota Monitoring Tests
storage.js estimates the serialized payload size on every save against a
conservative 5MB browser-quota threshold and surfaces a dismissible warning
banner once usage crosses 80%, instead of silently risking a future failed
write.
"""

import pytest

from tests.conftest import assert_no_errors


def _inject_large_blob(page, size_bytes):
    page.evaluate(f"""() => {{
        const app = window.app;
        app.ledgerAmountOverrides = {{
            blob: {{ amount: 1, originalAmount: 1, note: 'x'.repeat({size_bytes}) }}
        }};
        app.saveToStorage();
    }}""")


@pytest.mark.feature
def test_no_warning_banner_under_normal_usage(app_page):
    """A normal, small amount of saved data does not trigger the quota banner."""
    page = app_page
    page.evaluate("() => window.app.saveToStorage()")
    page.wait_for_timeout(200)

    assert not page.is_visible('#storageQuotaBanner')
    assert_no_errors(page)


@pytest.mark.feature
def test_warning_banner_appears_above_threshold(app_page):
    """Crossing ~80% of the estimated 5MB quota shows a dismissible warning banner."""
    page = app_page
    _inject_large_blob(page, 4_600_000)
    page.wait_for_timeout(200)

    assert page.is_visible('#storageQuotaBanner'), "Expected the quota warning banner to appear"
    text = page.text_content('#storageQuotaBanner')
    assert '%' in text and 'MB' in text

    assert_no_errors(page)


@pytest.mark.feature
def test_warning_banner_is_dismissible(app_page):
    """Clicking the close button removes the quota warning banner."""
    page = app_page
    _inject_large_blob(page, 4_600_000)
    page.wait_for_timeout(200)
    assert page.is_visible('#storageQuotaBanner')

    page.click('.storage-quota-banner-close')
    page.wait_for_timeout(100)

    assert not page.is_visible('#storageQuotaBanner')


@pytest.mark.feature
def test_warning_banner_does_not_duplicate_on_repeated_saves(app_page):
    """Saving repeatedly while over threshold shows only a single banner instance."""
    page = app_page
    _inject_large_blob(page, 4_600_000)
    page.wait_for_timeout(200)

    page.evaluate("() => window.app.saveToStorage()")
    page.evaluate("() => window.app.saveToStorage()")
    page.wait_for_timeout(200)

    banners = page.query_selector_all('#storageQuotaBanner')
    assert len(banners) == 1, f"Expected exactly one banner element, got {len(banners)}"


@pytest.mark.feature
def test_usage_drops_below_threshold_resets_warned_flag(app_page):
    """Once usage drops back under 80%, a fresh crossing of the threshold warns again."""
    page = app_page
    _inject_large_blob(page, 4_600_000)
    page.wait_for_timeout(200)
    page.click('.storage-quota-banner-close')
    page.wait_for_timeout(100)

    # Drop back under threshold.
    page.evaluate("""() => {
        window.app.ledgerAmountOverrides = {};
        window.app.saveToStorage();
    }""")
    page.wait_for_timeout(100)
    assert not page.is_visible('#storageQuotaBanner')

    # Cross the threshold again — should warn a second time.
    _inject_large_blob(page, 4_600_000)
    page.wait_for_timeout(200)
    assert page.is_visible('#storageQuotaBanner'), "Expected the banner to reappear after re-crossing the threshold"
