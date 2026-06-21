#!/usr/bin/env python3
"""
prefers-reduced-motion Tests
Verifies the app respects the OS-level reduced-motion preference: CSS
transitions/animations collapse to near-zero duration, and Chart.js disables
its render/update animations.
"""

import pytest

from tests.conftest import create_debt, SKIP_FIRST_RUN_WIZARD_SCRIPT


def _make_tracked_page(browser, reduced_motion=None):
    ctx = browser.new_context(reduced_motion=reduced_motion)
    page = ctx.new_page()
    page.add_init_script(SKIP_FIRST_RUN_WIZARD_SCRIPT)
    page.console_errors = []
    page.page_errors = []
    page.on('console', lambda msg: page.console_errors.append(msg.text)
            if msg.type == 'error' and 'favicon' not in (msg.text or '').lower() else None)
    page.on('pageerror', lambda exc: page.page_errors.append(str(exc)))
    page.on('dialog', lambda d: d.accept())
    return ctx, page


def _assert_no_errors(page):
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"
    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"


@pytest.mark.ui
def test_css_transition_duration_collapses_under_reduced_motion(browser):
    """A reduced-motion context shrinks transition-duration on an animated element."""
    ctx, page = _make_tracked_page(browser, reduced_motion='reduce')
    page.goto('http://localhost:5500/', wait_until='networkidle', timeout=60000)

    duration = page.evaluate("""
        () => {
            const btn = document.querySelector('.header-icon-btn');
            return window.getComputedStyle(btn).transitionDuration;
        }
    """)
    ctx.close()

    # Browsers report sub-millisecond durations in different notations
    # ("1e-05s", "0.01ms", "0s") depending on rounding — parse numerically
    # and assert it's effectively instant rather than matching exact strings.
    seconds = float(duration.replace('ms', 'e-3').rstrip('s')) if 'ms' in duration else float(duration.rstrip('s') or 0)
    assert seconds < 0.001, f"Expected ~instant transition under reduced motion, got {duration!r}"


@pytest.mark.ui
def test_chart_animation_disabled_under_reduced_motion(browser, debt_data):
    """Chart.defaults.animation is false when the OS prefers reduced motion."""
    ctx, page = _make_tracked_page(browser, reduced_motion='reduce')
    page.goto('http://localhost:5500/', wait_until='networkidle', timeout=60000)

    create_debt(page, debt_data)
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_timeout(400)

    animation_disabled = page.evaluate("() => Chart.defaults.animation === false")
    assert animation_disabled, "Chart.defaults.animation should be false under prefers-reduced-motion: reduce"

    _assert_no_errors(page)
    ctx.close()


@pytest.mark.ui
def test_chart_animation_enabled_without_reduced_motion(app_page):
    """Without the reduced-motion preference, Chart.js animation defaults are left alone."""
    page = app_page
    animation_disabled = page.evaluate("() => Chart.defaults.animation === false")
    assert not animation_disabled, "Chart.defaults.animation should not be forced off by default"
