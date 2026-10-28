#!/usr/bin/env python3
"""
Mobile layout regressions:
- Plan page: the inline "Suggest" button inherited the mobile full-width
  `.strategy-controls .btn` rule, squeezing #monthlyPayment to ~0px wide and
  overflowing the card.
- Liabilities: the debt card bulk-select checkbox sat top-left over the first
  letter of the debt name; it now sits top-right.
Geometry is asserted at a phone viewport and at desktop width.
"""

import pytest

PHONE = {"width": 390, "height": 844}
DESKTOP = {"width": 1280, "height": 900}


def _rect(page, selector):
    return page.evaluate(
        """(sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        }""",
        selector,
    )


def _overlaps(a, b):
    return not (a['right'] <= b['left'] or b['right'] <= a['left'] or a['bottom'] <= b['top'] or b['bottom'] <= a['top'])


def _seed_debt(page, name='Wells Fargo 2%'):
    page.wait_for_function('() => window.app && typeof window.app.updateUI === "function"', timeout=10000)
    page.evaluate("""(name) => {
        const app = window.app;
        app.debts = [{ id: 9101, name, accountBalance: 1300, originalBalance: 1300, minimumPayment: 725,
                       interestRate: 0, dueDate: 1, debtType: 'creditCard', creditLimit: 23500 }];
        app.updateUI();
    }""", name)


def _show(page, page_name, section_id):
    page.evaluate("(p) => window.app.switchPage(p)", page_name)
    page.wait_for_selector(f'#{section_id}.active', timeout=5000)
    page.wait_for_timeout(200)


@pytest.mark.ui
@pytest.mark.parametrize("viewport", [PHONE, DESKTOP], ids=["phone", "desktop"])
def test_monthly_payment_input_usable_and_suggest_inside_card(app_page, viewport):
    page = app_page
    page.set_viewport_size(viewport)
    _show(page, 'strategy', 'strategySection')

    row = _rect(page, '#strategySection .input-with-action')
    inp = _rect(page, '#monthlyPayment')
    btn = _rect(page, '#suggestPaymentBtn')
    card = _rect(page, '#strategySection .strategy-controls')
    assert row and inp and btn and card

    # Input takes the bulk of the row (was ~0px on phones).
    assert inp['width'] >= row['width'] * 0.5, f"#monthlyPayment too narrow: {inp['width']}px of {row['width']}px row"
    # Suggest sits beside the input on the same line, not full-width, and stays inside the card.
    assert btn['width'] < row['width'] * 0.5, f"Suggest button stretched to {btn['width']}px"
    assert btn['left'] >= inp['right'] - 1, "Suggest should sit to the right of the amount input"
    assert btn['right'] <= card['right'] + 1, f"Suggest overflows the card ({btn['right']} > {card['right']})"
    assert abs(btn['top'] - inp['top']) < inp['height'], "Suggest wrapped onto its own line"


@pytest.mark.ui
def test_monthly_payment_input_accepts_typing_on_phone(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    _show(page, 'strategy', 'strategySection')
    page.fill('#monthlyPayment', '1234.56')
    assert page.input_value('#monthlyPayment') == '1234.56'


@pytest.mark.ui
def test_other_strategy_buttons_still_full_width_on_phone(app_page):
    """Negative guard: the Suggest exemption must not un-stack the primary buttons."""
    page = app_page
    page.set_viewport_size(PHONE)
    _show(page, 'strategy', 'strategySection')
    card = _rect(page, '#strategySection .strategy-controls')
    calc = _rect(page, '#calculateBtn')
    assert calc, "Expected #calculateBtn on the Plan page"
    assert calc['width'] >= (card['width'] - 60), f"Calculate button no longer full width ({calc['width']} of {card['width']})"


@pytest.mark.ui
@pytest.mark.parametrize("viewport", [PHONE, DESKTOP], ids=["phone", "desktop"])
def test_debt_select_checkbox_top_right_not_over_name(app_page, viewport):
    page = app_page
    page.set_viewport_size(viewport)
    _seed_debt(page)
    _show(page, 'liabilities', 'liabilitiesSection')
    page.wait_for_selector('#debtsList .debt-card .debt-row-select', timeout=5000)

    box = _rect(page, '#debtsList .debt-card .debt-row-select')
    card = _rect(page, '#debtsList .debt-card')
    name = page.evaluate("""() => {
        const el = document.querySelector('#debtsList .debt-card .debt-name');
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();   // the text itself, not the padded box
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }""")

    assert not _overlaps(box, name), f"Checkbox {box} overlaps debt name text {name}"
    assert box['left'] > card['left'] + card['width'] / 2, "Checkbox should be on the right half of the card"
    assert box['right'] <= card['right'], "Checkbox should stay inside the card"


@pytest.mark.ui
def test_debt_select_checkbox_still_toggles_bulk_bar(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    _seed_debt(page)
    _show(page, 'liabilities', 'liabilitiesSection')
    page.click('#debtsList .debt-row-select')
    assert page.is_checked('#debtsList .debt-row-select')
    page.wait_for_selector('.debt-bulk-bar--visible', timeout=3000)


@pytest.mark.ui
def test_long_debt_name_wraps_clear_of_checkbox(app_page):
    """Negative: a long name must not run under the checkbox."""
    page = app_page
    page.set_viewport_size(PHONE)
    _seed_debt(page, name='Extremely Long Credit Union Platinum Rewards Visa Signature Card')
    _show(page, 'liabilities', 'liabilitiesSection')
    page.wait_for_selector('#debtsList .debt-card .debt-row-select', timeout=5000)
    box = _rect(page, '#debtsList .debt-card .debt-row-select')
    rects = page.evaluate("""() => {
        const el = document.querySelector('#debtsList .debt-card .debt-name');
        const range = document.createRange();
        range.selectNodeContents(el);
        return Array.from(range.getClientRects()).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
    }""")
    assert rects
    for r in rects:
        assert not _overlaps(box, r), f"Debt name line {r} runs under the checkbox {box}"
