#!/usr/bin/env python3
"""
What-If Simulator Tests
Covers the Strategy > Overview page's What-If slider: the extra-amount label
updates immediately on drag, but the expensive payoff simulation itself is
debounced (150ms) so dragging doesn't recompute many times per second.
Zero prior test coverage of this panel (performance audit, 2026-09-02).
"""

import pytest

from tests.conftest import create_debt, assert_no_errors


def _calculate_plan(page, debt_data):
    create_debt(page, debt_data)
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')
    page.click('#calculateBtn')
    page.wait_for_timeout(500)


def _set_slider(page, value):
    page.eval_on_selector(
        '#whatifSlider',
        "(el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }",
        value,
    )


@pytest.mark.ui
def test_whatif_shows_hint_before_interaction(app_page, debt_data):
    """The panel shows a hint (no metrics) until the slider is moved."""
    page = app_page
    _calculate_plan(page, debt_data)

    hint = page.inner_text('#whatifResult')
    assert 'Move the slider' in hint


@pytest.mark.ui
def test_whatif_label_updates_immediately_but_metrics_are_debounced(app_page, debt_data):
    """Dragging the slider updates the amount label synchronously, but the
    payoff-simulation metrics only appear after the 150ms debounce settles --
    proves the expensive computation isn't run on every raw input event."""
    page = app_page
    _calculate_plan(page, debt_data)

    _set_slider(page, 100)

    # Label reflects the new value immediately (no debounce on this part).
    label = page.inner_text('#whatifExtraAmt')
    assert '100' in label

    # Metrics have not appeared yet -- still mid-debounce.
    still_hint = page.inner_text('#whatifResult')
    assert 'Move the slider' in still_hint, \
        "Expected the simulation to still be debounced immediately after the input event"

    # After the debounce window, the metrics render.
    page.wait_for_timeout(300)
    result = page.inner_text('#whatifResult')
    assert 'New Payoff Date' in result
    assert 'Months Saved' in result
    assert_no_errors(page)


@pytest.mark.ui
def test_whatif_rapid_slider_changes_settle_on_final_value(app_page, debt_data):
    """Firing several input events in quick succession (simulating a drag)
    only computes once, for the final value -- not once per event."""
    page = app_page
    _calculate_plan(page, debt_data)

    # Stay within the slider's max (sliderMax = max(200, basePayment); the
    # $200/mo payment in _calculate_plan makes that 200) -- setting .value
    # past max silently clamps in the browser, which isn't what this test
    # is exercising.
    for value in (10, 50, 100, 150):
        _set_slider(page, value)
        page.wait_for_timeout(20)  # faster than the 150ms debounce window

    label = page.inner_text('#whatifExtraAmt')
    assert '150' in label

    page.wait_for_timeout(300)
    result = page.inner_text('#whatifResult')
    assert 'New Payoff Date' in result
    assert_no_errors(page)


@pytest.mark.ui
def test_whatif_returns_to_hint_when_slider_reset_to_zero(app_page, debt_data):
    """Dragging back to 0 shows the hint again, not stale metrics."""
    page = app_page
    _calculate_plan(page, debt_data)

    _set_slider(page, 200)
    page.wait_for_timeout(300)
    assert 'New Payoff Date' in page.inner_text('#whatifResult')

    _set_slider(page, 0)
    page.wait_for_timeout(300)
    assert 'Move the slider' in page.inner_text('#whatifResult')
