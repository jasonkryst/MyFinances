#!/usr/bin/env python3
"""
Home Purchase Planning Tests (#249)
Covers the Savings > Home Purchase sub-tab: down payment goal tracker,
mortgage affordability calculator, PMI threshold tracker, and the
"debts to clear before qualifying" panel.
"""

import pytest

from tests.conftest import assert_no_errors

BASE_URL = "http://localhost:32900/"


def _open_home_purchase_tab(page):
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    page.click('[data-savings-subtab="home"]')
    page.wait_for_selector('[data-savings-subtab="home"].active', timeout=5000)


def _open_form(page):
    page.click('#hpFormToggle')
    page.wait_for_selector('#hpFormBody.visible', timeout=5000)


def _fill_and_save_plan(page, target_price=400000, down_pct=10, savings=10000, contribution=500, housing_cost=2200, notes=''):
    _open_form(page)
    page.fill('#hpTargetPrice', str(target_price))
    page.fill('#hpDownPaymentPct', str(down_pct))
    page.fill('#hpCurrentSavings', str(savings))
    page.fill('#hpMonthlyContribution', str(contribution))
    page.fill('#hpHousingCostEstimate', str(housing_cost))
    if notes:
        page.fill('#hpNotes', notes)
    page.click('#hpSaveBtn')
    page.wait_for_selector('.hp-card', timeout=5000)


def _seed_income_and_debts(page, monthly_income, debts):
    """debts: list of dicts with name/balance/minimumPayment."""
    page.evaluate("""(args) => {
        const app = window.app;
        app.incomes = [{ id: 9801, name: 'Salary', amount: args.monthlyIncome, firstPayDate: '2026-01-01', frequency: 'monthly' }];
        app.bonuses = [];
        app.debts = args.debts.map((d, i) => ({
            id: 9810 + i, name: d.name, debtType: 'creditCard',
            accountBalance: d.balance, originalBalance: d.balance,
            minimumPayment: d.minimumPayment, interestRate: 15, dueDate: 15,
            archived: false
        }));
    }""", {"monthlyIncome": monthly_income, "debts": debts})


@pytest.mark.feature
def test_home_purchase_subtab_exists_and_navigates(app_page):
    """Positive: the Home Purchase sub-tab button exists under Savings and
    clicking it activates its panel."""
    page = app_page
    _open_home_purchase_tab(page)

    heading = page.evaluate('() => document.querySelector(".savings-content h3")?.textContent || ""')
    assert 'Home Purchase' in heading, f"Expected Home Purchase heading, got: {heading}"
    assert_no_errors(page)


@pytest.mark.feature
def test_home_purchase_empty_state_shown_when_no_plan(app_page):
    """Negative: with no plan set up, the empty-state message shows and no
    calculator cards render."""
    page = app_page
    _open_home_purchase_tab(page)

    empty = page.query_selector('.empty-message')
    assert empty, "Expected an empty-state message when no plan exists"
    cards = page.query_selector_all('.hp-card')
    assert len(cards) == 0, "Expected no calculator cards before a plan is saved"


@pytest.mark.feature
def test_home_purchase_save_without_target_price_shows_alert(app_page):
    """Negative: submitting the form with a target home price of 0 (passes
    HTML5 'required' since the field isn't blank, but fails the app's own
    > 0 validation) shows an alert and does not create a plan."""
    page = app_page
    _open_home_purchase_tab(page)
    _open_form(page)
    page.fill('#hpTargetPrice', '0')
    page.click('#hpSaveBtn')
    page.wait_for_selector('#alertModal.flex-visible', timeout=5000)

    message = page.evaluate('() => document.getElementById("alertModalMessage")?.textContent || ""')
    assert 'target home price' in message.lower()
    page.click('#alertModalOkBtn')

    plan_exists = page.evaluate('() => !!window.app.homePurchasePlan')
    assert not plan_exists, "No plan should be created when validation fails"


@pytest.mark.feature
def test_home_purchase_save_plan_creates_plan_and_shows_cards(app_page):
    """Positive: saving a valid plan creates app.homePurchasePlan and
    renders the Down Payment Goal, Mortgage Affordability, PMI Threshold,
    and Debts to Clear cards."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page)

    plan = page.evaluate('() => window.app.homePurchasePlan')
    assert plan['targetHomePrice'] == 400000
    assert plan['targetDownPaymentPct'] == 10
    assert plan['currentSavings'] == 10000
    assert plan['monthlyContribution'] == 500
    assert plan['housingCostEstimate'] == 2200

    cards = page.query_selector_all('.hp-card')
    assert len(cards) == 4, f"Expected 4 calculator cards, got {len(cards)}"
    assert_no_errors(page)


@pytest.mark.feature
def test_home_purchase_down_payment_progress_calculation(app_page):
    """Positive: down payment progress math — $400k home, 10% target down
    ($40,000), $10,000 saved, $500/mo → $30,000 remaining, 60 months."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=400000, down_pct=10, savings=10000, contribution=500)

    text = page.evaluate('() => document.getElementById("savingsSection").textContent')
    assert '$10,000.00' in text and '$40,000.00' in text
    assert '$30,000.00' in text  # remaining


@pytest.mark.feature
def test_home_purchase_mortgage_affordability_ratios(app_page):
    """Positive: front-end/back-end ratios are computed from real income
    and debt data — $6,000/mo income, $1,800/mo housing estimate, $200/mo
    other debt minimums → front-end 30% (yellow, >=28%<36%), back-end
    ~33.3% (green, <43%)."""
    page = app_page
    _seed_income_and_debts(page, monthly_income=6000, debts=[{"name": "Car Loan", "balance": 8000, "minimumPayment": 200}])
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=500000, down_pct=15, savings=20000, contribution=600, housing_cost=1800)

    front_end = page.evaluate("() => document.querySelectorAll('.hp-card')[1].querySelectorAll('.health-badge')[0].textContent")
    back_end = page.evaluate("() => document.querySelectorAll('.hp-card')[1].querySelectorAll('.health-badge')[1].textContent")
    assert '30.0%' in front_end, f"Expected front-end ratio 30.0%, got {front_end}"
    assert '33.3%' in back_end, f"Expected back-end ratio 33.3%, got {back_end}"

    front_end_cls = page.evaluate("() => document.querySelectorAll('.hp-card')[1].querySelectorAll('.health-badge')[0].className")
    assert 'health-status--yellow' in front_end_cls, f"Expected yellow status for 30% front-end, got {front_end_cls}"


@pytest.mark.feature
def test_home_purchase_pmi_tracker_shows_estimate_when_below_20pct(app_page):
    """Positive: with a 10% down payment plan, PMI is required — shows the
    percentage-point gap to 20% and an estimated monthly PMI cost."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=400000, down_pct=10)

    pmi_card_text = page.evaluate("() => document.querySelectorAll('.hp-card')[2].textContent")
    assert '10.0 pts' in pmi_card_text, f"Expected '10.0 pts' gap to 20% down, got: {pmi_card_text}"
    assert '$40,000.00' in pmi_card_text  # 10 pts of $400k needed to reach 20%
    # loanAmount = 400000 * 0.9 = 360000; PMI = 360000 * 0.01 / 12 = 300.00
    assert '$300.00' in pmi_card_text, f"Expected $300.00 estimated monthly PMI, got: {pmi_card_text}"


@pytest.mark.feature
def test_home_purchase_pmi_tracker_no_pmi_when_20pct_or_more(app_page):
    """Negative: a 20%+ down payment plan shows 'No PMI required' instead
    of an estimate."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=400000, down_pct=20)

    pmi_card_text = page.evaluate("() => document.querySelectorAll('.hp-card')[2].textContent")
    assert 'No PMI required' in pmi_card_text, f"Expected 'No PMI required' message, got: {pmi_card_text}"


@pytest.mark.feature
def test_home_purchase_debts_to_clear_already_qualifies(app_page):
    """Negative: with no other debts, the back-end ratio is already under
    43% and the panel shows the 'already qualify' message rather than a
    payoff list."""
    page = app_page
    _seed_income_and_debts(page, monthly_income=6000, debts=[])
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=400000, down_pct=10, housing_cost=1800)

    qualifying_text = page.evaluate("() => document.getElementById('hpQualifyingCard').textContent")
    assert 'already qualify' in qualifying_text.lower(), f"Expected already-qualifies message, got: {qualifying_text}"


@pytest.mark.feature
def test_home_purchase_debts_to_clear_lists_steps_in_snowball_order(app_page):
    """Positive: when back-end DTI exceeds 43%, the panel lists debts
    smallest-balance-first (snowball order), stopping at the first point
    the cumulative ratio drops under 43%."""
    page = app_page
    # income 4000/mo, housing 1200/mo, two debts each with a $300 minimum
    # payment: (300+300+1200)/4000 = 45% (over 43%). Removing the
    # smallest-BALANCE debt first (snowball order) drops it to
    # (300+1200)/4000 = 37.5% (under 43%) in a single step.
    _seed_income_and_debts(page, monthly_income=4000, debts=[
        {"name": "Big Balance", "balance": 20000, "minimumPayment": 300},
        {"name": "Small Balance", "balance": 1000, "minimumPayment": 300},
    ])
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=300000, down_pct=10, housing_cost=1200)

    qualifying_card = page.evaluate("() => document.getElementById('hpQualifyingCard').textContent")
    assert 'already qualify' not in qualifying_card.lower(), "This scenario should NOT already qualify"

    first_debt_mentioned = page.evaluate(
        "() => document.getElementById('hpQualifyingCard').querySelectorAll('.detail-row')[0]?.textContent || ''"
    )
    assert 'Small Balance' in first_debt_mentioned, (
        f"Expected the smallest-balance debt listed first (snowball order), got: {first_debt_mentioned}"
    )


@pytest.mark.feature
def test_home_purchase_edit_plan_prefills_form(app_page):
    """Positive: reopening the form after a plan exists pre-fills every
    field with the saved values."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=350000, down_pct=15, savings=5000, contribution=300, housing_cost=1900, notes='Starter home')

    page.click('#hpFormToggle')
    page.wait_for_selector('#hpFormBody.visible', timeout=5000)

    assert page.input_value('#hpTargetPrice') == '350000'
    assert page.input_value('#hpDownPaymentPct') == '15'
    assert page.input_value('#hpCurrentSavings') == '5000'
    assert page.input_value('#hpMonthlyContribution') == '300'
    assert page.input_value('#hpHousingCostEstimate') == '1900'
    assert page.input_value('#hpNotes') == 'Starter home'


@pytest.mark.feature
def test_home_purchase_clear_plan_cancel_keeps_plan(app_page):
    """Negative: canceling the Clear Plan confirmation leaves the plan
    untouched."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page)

    page.click('#hpClearBtn')
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    page.click('#deleteConfirmCancelBtn')

    plan_exists = page.evaluate('() => !!window.app.homePurchasePlan')
    assert plan_exists, "Plan should still exist after canceling the clear confirmation"


@pytest.mark.feature
def test_home_purchase_clear_plan_confirm_removes_plan(app_page):
    """Positive: confirming Clear Plan resets app.homePurchasePlan to null
    and the empty state reappears."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page)

    page.click('#hpClearBtn')
    page.wait_for_selector('#deleteConfirmModal.flex-visible', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_selector('.empty-message', timeout=5000)

    plan_exists = page.evaluate('() => !!window.app.homePurchasePlan')
    assert not plan_exists, "Plan should be null after confirming Clear Plan"


@pytest.mark.feature
def test_home_purchase_plan_persists_after_reload(app_page):
    """Positive: the saved plan round-trips through localStorage/sanitizer
    on a full page reload."""
    page = app_page
    _open_home_purchase_tab(page)
    _fill_and_save_plan(page, target_price=425000, down_pct=12, savings=8000, contribution=450, housing_cost=2100)

    page.reload(wait_until="networkidle")
    page.wait_for_function("() => window.app && window.app.homePurchasePlan !== undefined", timeout=10000)

    plan = page.evaluate('() => window.app.homePurchasePlan')
    assert plan is not None, "Expected the plan to survive a reload"
    assert plan['targetHomePrice'] == 425000
    assert plan['targetDownPaymentPct'] == 12
    assert plan['currentSavings'] == 8000
    assert plan['monthlyContribution'] == 450
    assert plan['housingCostEstimate'] == 2100


@pytest.mark.feature
def test_home_purchase_command_palette_navigates_to_tab(app_page):
    """Positive: the command palette's Home Purchase Planning entry jumps
    straight to the Savings page with the Home Purchase sub-tab active."""
    page = app_page
    page.keyboard.press('Control+k')
    page.wait_for_selector('#commandPaletteOverlay:not(.hidden)', timeout=5000)
    page.fill('#commandPaletteInput', 'Home Purchase')
    page.wait_for_selector('.cmdpal-item', timeout=5000)
    page.keyboard.press('Enter')

    page.wait_for_selector('#savingsSection.active', timeout=5000)
    active_subtab = page.evaluate(
        '() => document.querySelector(".savings-subtab-btn.active")?.getAttribute("data-savings-subtab")'
    )
    assert active_subtab == 'home', f"Expected the Home Purchase sub-tab to be active, got: {active_subtab}"
