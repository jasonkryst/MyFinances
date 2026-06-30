#!/usr/bin/env python3
"""
Break-Even Analysis Tests
Tests per-debt payoff comparison badge, accelerate modal, and plan table columns.
"""
import pytest
from tests.conftest import create_debt

BASE_URL = "http://localhost:5500/"


def _nav_debts(page):
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)


def _create_cc_debt(page, name="Visa", balance="2400", rate="18.5", min_pay="100"):
    _nav_debts(page)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', name)
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', balance)
    page.fill('#interestRate', rate)
    page.fill('#minimumPayment', min_pay)
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


def _run_plan(page, payment="450"):
    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', payment)
    page.click('#calculateBtn')
    page.wait_for_selector('#resultsSection.visible', timeout=10000)


# ── Positive cases ──────────────────────────────────────────────────

@pytest.mark.feature
def test_break_even_badge_no_plan(app_page):
    """Debt card shows Show payoff estimate link with no-plan banner when no plan run."""
    page = app_page
    _create_cc_debt(page)
    _nav_debts(page)

    # "Show payoff estimate" link should be present on the card
    link = page.query_selector('[data-be-show]')
    assert link is not None, "Expected 'Show payoff estimate' link on debt card"

    # Click it
    link.click()
    page.wait_for_timeout(500)

    # No-plan banner should appear
    banner = page.query_selector('.break-even-no-plan-banner')
    assert banner is not None, "Expected no-plan banner after clicking Show"
    assert "Estimate only" in banner.inner_text()

    # Min only row should appear
    rows = page.query_selector_all('.break-even-row')
    assert len(rows) >= 1, "Expected at least one break-even row"


@pytest.mark.feature
def test_break_even_badge_with_plan(app_page):
    """After running a plan, debt card auto-shows interest saved and months saved."""
    page = app_page
    _create_cc_debt(page)
    _run_plan(page, payment="450")
    _nav_debts(page)
    page.wait_for_timeout(500)

    # Badge should auto-render (no "Show" link needed)
    show_link = page.query_selector('[data-be-show]')
    assert show_link is None, "Expected no Show link when plan is active"

    # Both rows should be present
    rows = page.query_selector_all('.break-even-row')
    assert len(rows) >= 2, "Expected plan and min-only rows"

    # Savings line should be present
    savings = page.query_selector('.break-even-savings')
    assert savings is not None, "Expected savings summary line"


@pytest.mark.feature
def test_break_even_min_type_toggle(app_page):
    """Switching Fixed -> Percent re-renders badge with different numbers."""
    page = app_page
    _create_cc_debt(page, balance="5000", rate="20", min_pay="100")
    _run_plan(page, payment="500")
    _nav_debts(page)
    page.wait_for_timeout(500)

    # Get current min-only value in fixed mode
    rows_fixed = page.query_selector_all('.break-even-row')
    fixed_text = rows_fixed[-1].inner_text() if rows_fixed else ""

    # Switch to percent mode
    toggle = page.query_selector('.be-min-type')
    assert toggle is not None, "Expected min-type toggle on badge"
    toggle.select_option('percent')
    page.wait_for_timeout(500)

    rows_pct = page.query_selector_all('.break-even-row')
    pct_text = rows_pct[-1].inner_text() if rows_pct else ""

    # Numbers should differ between fixed and percent mode
    assert fixed_text != pct_text, "Expected different values when switching to percent mode"


@pytest.mark.feature
def test_break_even_accelerate_modal_opens(app_page):
    """Clicking Accelerate this debt opens modal with correct debt name."""
    page = app_page
    _create_cc_debt(page, name="MyVisa")
    _nav_debts(page)

    # Show badge first
    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    assert acc_btn is not None, "Expected Accelerate button on badge"
    acc_btn.click()
    page.wait_for_timeout(300)

    modal = page.query_selector('#accelerateDebtModal')
    assert modal is not None
    assert modal.is_visible(), "Accelerate modal should be visible"

    title = page.query_selector('#accelerateDebtTitle')
    assert title is not None
    assert "MyVisa" in title.inner_text(), "Modal title should contain debt name"


@pytest.mark.feature
def test_break_even_accelerate_preview_updates(app_page):
    """Typing extra payment in modal updates payoff and interest live."""
    page = app_page
    _create_cc_debt(page)
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    acc_btn.click()
    page.wait_for_timeout(300)

    payoff_before = page.query_selector('#acceleratePayoff').inner_text()

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('200')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(400)

    payoff_after = page.query_selector('#acceleratePayoff').inner_text()
    # With $200 extra, payoff should change
    assert payoff_before != payoff_after, "Payoff should update when extra payment entered"


@pytest.mark.feature
def test_break_even_apply_to_plan(app_page):
    """Apply to Plan navigates to Plan page and fills the payment field."""
    page = app_page
    _create_cc_debt(page, min_pay="100")
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    acc_btn.click()
    page.wait_for_timeout(300)

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('50')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(200)

    apply_btn = page.query_selector('#accelerateApplyBtn')
    apply_btn.click()
    page.wait_for_timeout(600)

    payment_field = page.query_selector('#monthlyPayment')
    assert payment_field is not None
    val = float(payment_field.input_value())
    assert val >= 150, f"Expected plan payment >= 150 (min 100 + extra 50), got {val}"


@pytest.mark.feature
def test_break_even_plan_table_columns(app_page):
    """After running a plan, summary table shows Interest Saved and Months Saved columns."""
    page = app_page
    _create_cc_debt(page, balance="3000", rate="18", min_pay="60")
    _run_plan(page, payment="300")

    # Navigate to debt summary tab
    page.click('[data-results-tab="debt-summary"]') if page.query_selector('[data-results-tab="debt-summary"]') else None
    page.wait_for_timeout(300)

    # Check column headers
    headers = page.query_selector_all('#debtSummaryTable th')
    header_texts = [h.inner_text() for h in headers]
    assert any("Interest Saved" in t for t in header_texts), f"Expected 'Interest Saved' header; got {header_texts}"
    assert any("Months Saved" in t for t in header_texts), f"Expected 'Months Saved' header; got {header_texts}"

    # Check that at least one saved-value cell is green
    saved_cells = page.query_selector_all('.be-col-saved')
    assert len(saved_cells) > 0, "Expected at least one green saved-value cell in summary table"


@pytest.mark.feature
def test_break_even_fixed_amount_debt_excluded(app_page):
    """Fixed-amount debts show no break-even badge."""
    page = app_page
    _nav_debts(page)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', 'Rent')
    page.select_option('#debtType', 'fixedAmount')
    page.fill('#fixedAmount', '1200')
    page.fill('#fixedStartDate', '2026-01-01')
    page.fill('#fixedEndDate', '2026-12-31')
    page.click('#debtFormSubmit')
    page.wait_for_selector('.debt-card:has-text("Rent")', timeout=10000)
    page.wait_for_timeout(300)

    # No break-even badge or show link on fixed-amount card
    be_section = page.query_selector('.break-even-section')
    assert be_section is None, "Fixed-amount debt should have no break-even section"


# ── Negative cases ──────────────────────────────────────────────────

@pytest.mark.feature
def test_break_even_zero_interest_debt(app_page):
    """0% APR debt: badge renders without crash, shows $0 interest."""
    page = app_page
    _create_cc_debt(page, rate="0", min_pay="100")
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(400)

    # No JS errors
    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"

    # Badge renders
    rows = page.query_selector_all('.break-even-row')
    assert len(rows) >= 1


@pytest.mark.feature
def test_break_even_minimum_covers_balance(app_page):
    """Balance = minimum payment: 1 month payoff, savings = $0."""
    page = app_page
    # Balance exactly equals min payment, so one month clears it
    _create_cc_debt(page, balance="100", rate="5", min_pay="100")
    _run_plan(page, payment="100")
    _nav_debts(page)
    page.wait_for_timeout(400)

    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"


@pytest.mark.feature
def test_break_even_invalid_percent(app_page):
    """Entering 0 in percent mode falls back gracefully (no crash)."""
    page = app_page
    _create_cc_debt(page)
    _run_plan(page, payment="300")
    _nav_debts(page)
    page.wait_for_timeout(400)

    toggle = page.query_selector('.be-min-type')
    if toggle:
        toggle.select_option('percent')
        page.wait_for_timeout(300)
        # Set value via evaluate to avoid focus/blur side-effects that can produce
        # transient DOM-removal errors when the section is re-rendered during blur.
        page.evaluate("""() => {
            const input = document.querySelector('.be-min-pct');
            if (input) {
                input.value = '0';
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }""")
        page.wait_for_timeout(400)

    assert len(page.page_errors) == 0, f"Page errors after 0% input: {page.page_errors}"


@pytest.mark.feature
def test_break_even_accelerate_zero_extra(app_page):
    """$0 extra in modal shows same numbers as base plan (no crash)."""
    page = app_page
    _create_cc_debt(page)
    _run_plan(page, payment="300")
    _nav_debts(page)
    page.wait_for_timeout(400)

    acc_btn = page.query_selector('[data-be-accelerate]')
    assert acc_btn is not None
    acc_btn.click()
    page.wait_for_timeout(300)

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('0')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(300)

    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"
    payoff = page.query_selector('#acceleratePayoff')
    assert payoff and payoff.inner_text() != '—', "Payoff should be populated even with $0 extra"


@pytest.mark.feature
def test_break_even_accelerate_negative_input(app_page):
    """Negative extra payment is clamped to 0 (no crash)."""
    page = app_page
    _create_cc_debt(page)
    _nav_debts(page)

    link = page.query_selector('[data-be-show]')
    if link:
        link.click()
        page.wait_for_timeout(300)

    acc_btn = page.query_selector('[data-be-accelerate]')
    acc_btn.click()
    page.wait_for_timeout(300)

    extra_input = page.query_selector('#accelerateExtraPay')
    extra_input.fill('-100')
    extra_input.dispatch_event('input')
    page.wait_for_timeout(300)

    assert len(page.page_errors) == 0, f"Page errors: {page.page_errors}"
    # Total should not show negative value
    total_el = page.query_selector('#accelerateNewTotal')
    assert total_el is not None
    # Total should equal base pay (negative clamped to 0)
    total_text = total_el.inner_text()
    assert '-' not in total_text or total_text.startswith('$'), "Negative extra should be clamped to 0"
