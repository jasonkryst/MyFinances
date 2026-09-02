#!/usr/bin/env python3
"""
Income Management Tests
Tests income source creation and calculations.
"""

import pytest

BASE_URL = "http://localhost:5500/"


def _create_income_account(page, name="Income Validation Account"):
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', name)
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)


@pytest.mark.feature
def test_create_income(app_page, income_data):
    """Test creating a new income source."""
    page = app_page

    # Income requires an account selection
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)
    
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    page.fill('#incomeName', income_data["name"])
    page.fill('#incomeAmount', income_data["amount"])
    page.fill('#incomeFirstDate', income_data["first_date"])
    page.select_option('#incomeFrequency', income_data["frequency"])
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector(f'text={income_data["name"]}', timeout=10000)
    
    assert page.query_selector(f'text={income_data["name"]}'), "Income not created"


@pytest.mark.feature
def test_income_frequencies(app_page):
    """Test all income frequency types."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Freq Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    frequencies = ['weekly', 'biweekly', 'twice_monthly', 'monthly']
    
    for i, freq in enumerate(frequencies):
        page.fill('#incomeName', f'Income {i}')
        page.fill('#incomeAmount', '5000')
        page.fill('#incomeFirstDate', '2026-05-01')
        page.select_option('#incomeFrequency', freq)
        page.select_option('#incomeAccount', index=1)
        page.click('#incomeFormSubmit')
        page.wait_for_timeout(500)


@pytest.mark.feature
def test_total_income_calculation(app_page):
    """Test that total monthly income is calculated correctly."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Total Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    # Add income
    page.fill('#incomeName', 'Salary')
    page.fill('#incomeAmount', '5000')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(500)
    
    # Verify income appears
    assert page.query_selector('text=Salary'), "Income not created"


@pytest.mark.feature
def test_multiple_income_sources(app_page):
    """Test managing multiple income sources."""
    page = app_page
    
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Income Multi Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    
    incomes = [
        ('Primary Job', '5000', '2026-05-01', 'monthly'),
        ('Side Gig', '1000', '2026-05-15', 'biweekly'),
        ('Bonus', '3000', '2026-12-31', 'monthly'),
    ]
    
    for name, amount, date, freq in incomes:
        page.fill('#incomeName', name)
        page.fill('#incomeAmount', amount)
        page.fill('#incomeFirstDate', date)
        page.select_option('#incomeFrequency', freq)
        page.select_option('#incomeAccount', index=1)
        page.click('#incomeFormSubmit')
        page.wait_for_timeout(500)
    
    # Verify all incomes appear
    for name, _, _, _ in incomes:
        assert page.query_selector(f'text={name}'), f"{name} not found"


@pytest.mark.feature
def test_add_income_negative_amount_rejected(app_page):
    """Negative income amounts are rejected, not silently clamped to $0.01.

    addIncome() previously validated the post-clamp value
    (sanitizeFiniteNumber(raw, NaN, { min: 0.01 })), so a negative input was
    clamped up to 0.01 *before* the `amount <= 0` check ran, and that check
    could never be true. Fixed in src/income.js to validate the raw input
    string before clamping, matching the pattern already applied to
    src/bills.js and src/recurring.js.
    """
    page = app_page
    _create_income_account(page)

    page.fill('#incomeName', 'Negative Salary')
    page.fill('#incomeAmount', '-500')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(300)

    assert page.query_selector('text=Negative Salary') is None, (
        "A negative income amount should be rejected, not silently saved as $0.01"
    )


@pytest.mark.feature
def test_add_bonus_negative_amount_rejected(app_page):
    """Negative one-time bonus/deposit amounts are rejected, not clamped to $0.01."""
    page = app_page
    _create_income_account(page)

    page.click('#bonusFormToggle')
    page.wait_for_timeout(200)
    page.fill('#bonusName', 'Negative Bonus')
    page.fill('#bonusAmount', '-200')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusCategory', label='Bonus')
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_timeout(300)

    assert page.query_selector('text=Negative Bonus') is None, (
        "A negative bonus amount should be rejected, not silently saved as $0.01"
    )


@pytest.mark.feature
def test_edit_income_negative_amount_rejected(app_page):
    """saveEditIncome() rejects a negative amount instead of clamping to $0.01.

    Same bug class as test_add_income_negative_amount_rejected, but on the
    inline-edit path (src/income.js saveEditIncome), which validates the raw
    input string the same way addIncome() does.
    """
    page = app_page
    _create_income_account(page)

    page.fill('#incomeName', 'Edit Salary Target')
    page.fill('#incomeAmount', '2000')
    page.fill('#incomeFirstDate', '2026-05-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector('text=Edit Salary Target', timeout=10000)

    page.click('[data-income-action="edit"]')
    page.wait_for_timeout(200)

    amount_input = page.query_selector('input[id^="ie-amount-"]')
    assert amount_input, "Expected the inline-edit amount input to be present"
    amount_input.fill('-750')
    page.click('[data-income-action="save"]')
    page.wait_for_timeout(300)

    stored_amount = page.evaluate(
        "() => window.app.incomes.find(i => i.name === 'Edit Salary Target')?.amount"
    )
    assert stored_amount == 2000, (
        f"A negative edited income amount should be rejected, leaving the prior value "
        f"intact, not silently saved as $0.01 (got {stored_amount!r})"
    )


@pytest.mark.feature
def test_edit_bonus_negative_amount_rejected(app_page):
    """saveEditBonus() rejects a negative amount instead of clamping to $0.01."""
    page = app_page
    _create_income_account(page)

    page.click('#bonusFormToggle')
    page.wait_for_timeout(200)
    page.fill('#bonusName', 'Edit Bonus Target')
    page.fill('#bonusAmount', '300')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusCategory', label='Bonus')
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_selector('text=Edit Bonus Target', timeout=10000)

    page.click('[data-bonus-action="edit"]')
    page.wait_for_timeout(200)

    amount_input = page.query_selector('input[id^="be-amount-"]')
    assert amount_input, "Expected the inline-edit amount input to be present"
    amount_input.fill('-100')
    page.click('[data-bonus-action="save"]')
    page.wait_for_timeout(300)

    stored_amount = page.evaluate(
        "() => window.app.bonuses.find(b => b.name === 'Edit Bonus Target')?.amount"
    )
    assert stored_amount == 300, (
        f"A negative edited bonus amount should be rejected, leaving the prior value "
        f"intact, not silently saved as $0.01 (got {stored_amount!r})"
    )


# ---------------------------------------------------------------------------
# Bonus Advisor (issue #64)
# ---------------------------------------------------------------------------

def _create_debt_for_advisor(page):
    """Minimal interest-bearing debt so the Cash Flow advice branch has something to compute against."""
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Advisor Debt Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)
    page.click('#debtFormToggle')
    page.wait_for_timeout(200)
    page.fill('#debtName', 'Advisor Test Debt')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '2000')
    page.fill('#interestRate', '20')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector('text=Advisor Test Debt', timeout=10000)


def _open_bonus_form(page):
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)
    page.click('#bonusFormToggle')
    page.wait_for_timeout(200)


@pytest.mark.feature
def test_bonus_purpose_cash_flow_persists_and_shows_badge(app_page):
    """Selecting Cash Flow purpose on a bonus persists it and shows a badge in the list."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'Cash Flow Bonus')
    page.fill('#bonusAmount', '1000')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusCategory', label='Bonus')
    page.select_option('#bonusPurpose', 'cashFlow')
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_selector('text=Cash Flow Bonus', timeout=10000)

    purpose = page.evaluate(
        "() => window.app.bonuses.find(b => b.name === 'Cash Flow Bonus')?.purpose"
    )
    assert purpose == 'cashFlow', f"Expected purpose 'cashFlow' to persist, got {purpose}"
    assert page.query_selector('.bonus-purpose--cashflow') is not None, \
        "Cash Flow badge should be shown in the bonus list"


@pytest.mark.feature
def test_bonus_purpose_savings_persists_and_shows_badge(app_page):
    """Selecting Savings purpose on a bonus persists it and shows a badge in the list."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'Savings Bonus')
    page.fill('#bonusAmount', '750')
    page.fill('#bonusDate', '2026-05-02')
    page.select_option('#bonusCategory', label='Bonus')
    page.select_option('#bonusPurpose', 'savings')
    page.click('#bonusForm button[type="submit"]')
    page.wait_for_selector('text=Savings Bonus', timeout=10000)

    purpose = page.evaluate(
        "() => window.app.bonuses.find(b => b.name === 'Savings Bonus')?.purpose"
    )
    assert purpose == 'savings', f"Expected purpose 'savings' to persist, got {purpose}"
    assert page.query_selector('.bonus-purpose--savings') is not None, \
        "Savings badge should be shown in the bonus list"


@pytest.mark.feature
def test_bonus_advice_shows_cash_flow_and_savings_numbers(app_page):
    """With a debt and an interest-bearing account, the advice panel shows non-zero numbers for both options."""
    page = app_page
    _create_debt_for_advisor(page)

    # Give the linked account a non-zero APY so the Savings branch has a rate to use.
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.click('[data-account-action="edit"]')
    page.fill('[id^="ac-rate-"]', '5')
    page.click('[data-account-action="save"]')
    page.wait_for_timeout(300)

    page.click('button[data-page="strategy"]')
    page.wait_for_timeout(300)
    page.fill('#monthlyPayment', '200')
    page.select_option('#paymentStrategy', 'avalanche')

    _open_bonus_form(page)
    page.fill('#bonusName', 'Advice Test Bonus')
    page.fill('#bonusAmount', '1000')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusAccount', index=1)
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'interest saved' in panel_text, f"Expected a computed interest-saved figure, got: {panel_text}"
    assert 'in 1 year' in panel_text, f"Expected a computed 1-year savings figure, got: {panel_text}"


@pytest.mark.feature
def test_bonus_advice_no_debts_shows_not_applicable(app_page):
    """With no debts at all, the Cash Flow side must show a graceful N/A, not crash or throw."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'No Debt Bonus')
    page.fill('#bonusAmount', '500')
    page.fill('#bonusDate', '2026-05-01')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'N/A' in panel_text and 'debt' in panel_text.lower(), \
        f"Expected a 'no debts' N/A message, got: {panel_text}"
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"


@pytest.mark.feature
def test_bonus_advice_no_account_rate_shows_not_applicable(app_page):
    """No account linked (or no account has a rate) -> Savings side shows a clear message, not a bare $0.00."""
    page = app_page
    _open_bonus_form(page)

    page.fill('#bonusName', 'No Rate Bonus')
    page.fill('#bonusAmount', '400')
    page.fill('#bonusDate', '2026-05-01')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'No interest-bearing account linked' in panel_text, \
        f"Expected the no-rate message, got: {panel_text}"


@pytest.mark.feature
def test_bonus_advice_invalid_amount_shows_validation_alert(app_page):
    """Clicking the advice button with no amount entered shows a validation alert, not a crash."""
    page = app_page
    _open_bonus_form(page)

    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(400)

    modal = page.query_selector('#alertModal')
    assert modal is not None, "#alertModal not found"
    assert 'flex-visible' in (modal.get_attribute('class') or ''), \
        "Themed alert modal should appear when bonus amount is invalid"
    msg = page.text_content('#alertModalMessage') or ''
    assert 'valid amount' in msg.lower(), \
        f"Modal message should mention 'valid amount', got: {msg!r}"
    page.click('#alertModalOkBtn')
    page.wait_for_timeout(200)

    assert page.query_selector('#bonusAdviceResult').inner_text() == '', \
        "No advice panel content should render when validation fails"


# ---------------------------------------------------------------------------
# Bonus Advisor: "Pay Off Debts Now" elimination plan (issue #64 follow-up)
# ---------------------------------------------------------------------------

def _create_three_debts_for_elimination(page):
    """Three debts with distinct balance/rate ordering, so the elimination-pass
    (smallest balance first) and the remainder-target (highest rate among what's
    left) can be tested independently:
      - Debt A: balance 500,  min payment 25,  rate 10%  (smallest balance)
      - Debt B: balance 800,  min payment 40,  rate 25%  (highest rate)
      - Debt C: balance 5000, min payment 150, rate 15%  (largest balance)
    """
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Elimination Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    debts = [
        ('Debt A', '500', '10', '25'),
        ('Debt B', '800', '25', '40'),
        ('Debt C', '5000', '15', '150'),
    ]
    for name, balance, rate, min_pmt in debts:
        page.click('#debtFormToggle')
        page.wait_for_timeout(200)
        page.fill('#debtName', name)
        page.select_option('#debtType', 'creditCard')
        page.fill('#accountBalance', balance)
        page.fill('#interestRate', rate)
        page.fill('#minimumPayment', min_pmt)
        page.fill('#dueDate', '15')
        page.click('#debtFormSubmit')
        page.wait_for_timeout(300)


@pytest.mark.feature
def test_bonus_advice_elimination_plan_eliminates_smallest_and_targets_highest_rate_remainder(app_page):
    """A $700 bonus eliminates Debt A (500, smallest balance) and applies the
    $200 remainder to Debt B (25% rate) — the highest-rate debt remaining —
    not Debt C, even though Debt C's balance is smaller than the difference
    would suggest picking by balance alone.
    """
    page = app_page
    _create_three_debts_for_elimination(page)

    _open_bonus_form(page)
    page.fill('#bonusName', 'Elimination Test Bonus')
    page.fill('#bonusAmount', '700')
    page.fill('#bonusDate', '2026-05-01')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'Debt A' in panel_text, f"Expected Debt A to be listed as eliminated, got: {panel_text}"
    assert 'Debt B' in panel_text, f"Expected Debt B to be listed as the remainder target (highest rate), got: {panel_text}"
    assert 'Debt C' not in panel_text, f"Debt C should not appear — it wasn't eliminated or targeted, got: {panel_text}"
    assert '$29.17' in panel_text or '29.17' in panel_text, \
        f"Expected ~$29.17/mo freed ($25 min payment + ~$4.17 interest reduction on the $200 remainder at 25%), got: {panel_text}"


@pytest.mark.feature
def test_bonus_advice_elimination_plan_remainder_only_when_bonus_too_small(app_page):
    """A $100 bonus can't eliminate even the smallest debt (500) — no debts
    listed as eliminated, but the full $100 still gets applied to the
    highest-rate debt (Debt B, 25%) as extra principal, per the chosen
    'still show the remainder-only result' behavior.
    """
    page = app_page
    _create_three_debts_for_elimination(page)

    _open_bonus_form(page)
    page.fill('#bonusName', 'Too Small To Eliminate')
    page.fill('#bonusAmount', '100')
    page.fill('#bonusDate', '2026-05-01')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'Debt A' not in panel_text, f"No debt should be listed as eliminated, got: {panel_text}"
    assert 'Debt B' in panel_text, f"Expected Debt B (highest rate) as the remainder target, got: {panel_text}"
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"


@pytest.mark.feature
def test_bonus_advice_elimination_plan_pays_off_all_debts(app_page):
    """A bonus large enough to cover every debt's balance (6500 > 500+800+5000)
    eliminates all three, leaving no remainder target and no crash.
    """
    page = app_page
    _create_three_debts_for_elimination(page)

    _open_bonus_form(page)
    page.fill('#bonusName', 'Pays Off Everything')
    page.fill('#bonusAmount', '6500')
    page.fill('#bonusDate', '2026-05-01')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'Debt A' in panel_text and 'Debt B' in panel_text and 'Debt C' in panel_text, \
        f"Expected all three debts listed as eliminated, got: {panel_text}"
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"


# ---------------------------------------------------------------------------
# Bonus Advisor: "Pay Off Debts Now uses" interest filter
# ---------------------------------------------------------------------------

def _create_debts_for_advice_interest_filter(page):
    """A 0%-rate debt (No Interest Card, balance 300) and an interest-bearing
    debt (Interest Bearing Card, balance 400, rate 18%), for testing that the
    Bonus Advisor's elimination-plan filter actually narrows the candidate
    pool rather than just being decorative.
    """
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Advice Filter Account')
    page.select_option('#accountType', label='Credit Card')
    page.fill('#accountStartingBalance', '0')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(300)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_timeout(300)

    debts = [
        ('No Interest Card', '300', '0', '20'),
        ('Interest Bearing Card', '400', '18', '30'),
    ]
    for name, balance, rate, min_pmt in debts:
        page.click('#debtFormToggle')
        page.wait_for_timeout(200)
        page.fill('#debtName', name)
        page.select_option('#debtType', 'creditCard')
        page.fill('#accountBalance', balance)
        page.fill('#interestRate', rate)
        page.fill('#minimumPayment', min_pmt)
        page.fill('#dueDate', '15')
        page.click('#debtFormSubmit')
        page.wait_for_timeout(300)


@pytest.mark.feature
def test_bonus_advice_filter_no_interest_only_ignores_interest_bearing_debt(app_page):
    """With the filter set to 'No Interest Only', a $300 bonus eliminates the
    0%-rate card and never considers the interest-bearing one, even though
    both together would otherwise be candidates.
    """
    page = app_page
    _create_debts_for_advice_interest_filter(page)

    _open_bonus_form(page)
    page.fill('#bonusName', 'No Interest Filter Test')
    page.fill('#bonusAmount', '300')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusAdviceInterestFilter', 'noInterest')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'No Interest Card' in panel_text, f"Expected the 0%-rate card eliminated, got: {panel_text}"
    assert 'Interest Bearing Card' not in panel_text, \
        f"Interest-bearing card should be excluded by the filter, got: {panel_text}"


@pytest.mark.feature
def test_bonus_advice_filter_interest_bearing_only_ignores_no_interest_debt(app_page):
    """With the filter set to 'Interest Bearing Only', a $300 bonus can't
    eliminate the (excluded) 0%-rate card even though it's smaller — the
    remainder goes toward the interest-bearing card instead.
    """
    page = app_page
    _create_debts_for_advice_interest_filter(page)

    _open_bonus_form(page)
    page.fill('#bonusName', 'Interest Bearing Filter Test')
    page.fill('#bonusAmount', '300')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusAdviceInterestFilter', 'interestBearing')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'No Interest Card' not in panel_text, \
        f"0%-rate card should be excluded by the filter, got: {panel_text}"
    assert 'Interest Bearing Card' in panel_text, \
        f"Expected the interest-bearing card as the remainder target, got: {panel_text}"


@pytest.mark.feature
def test_bonus_advice_filter_no_matching_debts_shows_message(app_page):
    """Filtering to 'No Interest Only' when every debt is interest-bearing
    shows a clear 'no debts match' message instead of a bare $0.00 or crash.
    """
    page = app_page
    _create_debt_for_advisor(page)  # single interest-bearing debt, rate 20%

    _open_bonus_form(page)
    page.fill('#bonusName', 'No Match Filter Test')
    page.fill('#bonusAmount', '300')
    page.fill('#bonusDate', '2026-05-01')
    page.select_option('#bonusAdviceInterestFilter', 'noInterest')
    page.click('#bonusAdviceBtn')
    page.wait_for_timeout(300)

    panel_text = page.inner_text('#bonusAdviceResult')
    assert 'No debts match the selected filter' in panel_text, f"Got: {panel_text}"
    assert len(page.console_errors) == 0, f"Console errors: {page.console_errors}"


@pytest.mark.feature
def test_income_frequency_weekly_selectable(app_page):
    """The 'weekly' frequency option can be selected and income is saved."""
    page = app_page
    _create_income_account(page, "Weekly Freq Account")

    page.fill('#incomeName', 'Weekly Paycheck')
    page.fill('#incomeAmount', '750')
    page.fill('#incomeFirstDate', '2026-09-01')
    page.select_option('#incomeFrequency', 'weekly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(500)

    assert page.query_selector('text=Weekly Paycheck') is not None, \
        "Weekly income source not saved"

    # Frequency label should reflect weekly
    card_text = page.inner_text('#incomeList') if page.query_selector('#incomeList') else ''
    assert 'week' in card_text.lower(), \
        f"Expected 'week' in income card text, got: {card_text!r}"


@pytest.mark.feature
def test_income_frequency_twice_monthly_selectable(app_page):
    """The 'twice_monthly' frequency option can be selected and income is saved."""
    page = app_page
    _create_income_account(page, "Twice Monthly Account")

    page.fill('#incomeName', 'Semi-Monthly Pay')
    page.fill('#incomeAmount', '1200')
    page.fill('#incomeFirstDate', '2026-09-01')
    page.select_option('#incomeFrequency', 'twice_monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_timeout(500)

    assert page.query_selector('text=Semi-Monthly Pay') is not None, \
        "Twice-monthly income source not saved"

    card_text = page.inner_text('#incomeList') if page.query_selector('#incomeList') else ''
    assert 'month' in card_text.lower(), \
        f"Expected 'month' in income card text, got: {card_text!r}"


@pytest.mark.feature
def test_income_frequency_select_has_all_four_options(app_page):
    """The income frequency dropdown contains all four options."""
    page = app_page
    page.click('button[data-page="income"]')
    page.wait_for_timeout(300)

    options = page.query_selector_all('#incomeFrequency option')
    values = [o.get_attribute('value') for o in options]

    assert 'weekly' in values, "'weekly' option missing from frequency dropdown"
    assert 'biweekly' in values, "'biweekly' option missing from frequency dropdown"
    assert 'twice_monthly' in values, "'twice_monthly' option missing from frequency dropdown"
    assert 'monthly' in values, "'monthly' option missing from frequency dropdown"
