#!/usr/bin/env python3
"""
Debt card layout: fact tiles, footer action bar, clamped payoff progress.

Before: the card was a horizontally centered flex row, so Edit/Update Balance/
History/Delete floated mid-card next to the payoff chart, facts wrapped
unevenly, and a balance that had grown past its starting balance showed
"Payoff progress -21%".
"""

import pytest

PHONE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}

SEED = """([orig]) => {
    const app = window.app;
    app.debts = [{ id: 9301, name: 'Layout Card', accountBalance: 1300, originalBalance: orig, minimumPayment: 100,
                   interestRate: 19.99, dueDate: 5, debtType: 'creditCard', creditLimit: 5000, priority: 40,
                   category: 'Credit Card', updatedAt: '2026-10-26' }];
    app.updateUI();
    app.switchPage('liabilities');
}"""


def _seed(page, orig=2000):
    page.evaluate(SEED, [orig])
    page.wait_for_selector('#debt-card-9301 .debt-details--tiles', timeout=5000)


def _rect(page, sel):
    return page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right}; }", sel)


@pytest.mark.ui
@pytest.mark.parametrize("viewport", [PHONE, DESKTOP], ids=["phone", "desktop"])
def test_actions_form_a_footer_below_all_content(app_page, viewport):
    page = app_page
    page.set_viewport_size(viewport)
    _seed(page)
    info = _rect(page, '#debt-card-9301 .debt-info')
    actions = _rect(page, '#debt-card-9301 .debt-actions')
    card = _rect(page, '#debt-card-9301')
    assert actions['top'] >= info['bottom'] - 1, f"actions {actions} should sit below the card content {info}"
    assert actions['bottom'] <= card['bottom'] + 1
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "debt card causes horizontal scroll"


@pytest.mark.ui
def test_facts_render_as_labelled_tiles_with_primary_balance(app_page):
    page = app_page
    _seed(page)
    labels = page.eval_on_selector_all('#debt-card-9301 .debt-detail-label', 'els => els.map(e => e.textContent.trim())')
    for expected in ('Balance', 'Min Payment', 'Interest', 'Due Date', '📅 Payoff Date', 'Priority'):
        assert expected in labels, f"missing tile label {expected!r}: {labels}"
    bal_size = page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('#debt-card-9301 .debt-detail--primary .debt-detail-value')).fontSize)")
    due_size = page.evaluate("""() => {
        const tiles = [...document.querySelectorAll('#debt-card-9301 .debt-detail')];
        const due = tiles.find(t => t.querySelector('.debt-detail-label')?.textContent.trim() === 'Due Date');
        return parseFloat(getComputedStyle(due.querySelector('.debt-detail-value')).fontSize);
    }""")
    assert bal_size > due_size, "Balance should be visually emphasised over secondary facts"


@pytest.mark.ui
def test_action_buttons_share_one_height(app_page):
    page = app_page
    _seed(page)
    heights = page.eval_on_selector_all('#debt-card-9301 .debt-actions button', 'els => els.map(e => Math.round(e.getBoundingClientRect().height))')
    assert len(set(heights)) == 1, f"action buttons have mismatched heights: {heights}"
    assert heights[0] >= 40, f"action buttons should be >= 40px tap targets, got {heights[0]}"


@pytest.mark.ui
def test_payoff_progress_never_negative_when_balance_grew(app_page):
    """Negative: balance above its starting balance shows 0% plus an explanation, not '-21%'."""
    page = app_page
    _seed(page, orig=1074)
    label = page.inner_text('#debt-card-9301 .debt-progress-wrap .debt-progress-label')
    assert '-' not in label, f"payoff progress went negative: {label!r}"
    assert '0%' in label
    note = page.inner_text('#debt-card-9301 .debt-progress-note')
    assert 'up 21%' in note


@pytest.mark.ui
def test_normal_progress_has_no_growth_note(app_page):
    page = app_page
    _seed(page, orig=2000)
    assert '35%' in page.inner_text('#debt-card-9301 .debt-progress-wrap .debt-progress-label')
    assert page.query_selector('#debt-card-9301 .debt-progress-note') is None
