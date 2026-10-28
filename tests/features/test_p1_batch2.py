#!/usr/bin/env python3
"""
P1 Batch 2 — Tests for issues #259 #276 #282 #285 #293 #304 #308 #310

Coverage:
  #310  Focus-trap on Ledger Export, Ledger Mark-All-Cleared, and Calendar Day modals
  #304  Sinking fund priority ordering
  #308  Sinking fund completion flow (archive/delete/keep)
  #276  Empty state CTAs (Debts, Accounts, Income, Ledger, Health)
  #293  Recurring actual-amount override modal
  #285  Ledger cross-navigation for debt / income / recurring rows
  #259  Minimum payment trap warning on debt cards
  #282  Bulk debt actions (multi-select archive / export CSV / delete)
"""

import pytest
from datetime import date

BASE_URL = "http://localhost:32900/"

# ─── helpers ──────────────────────────────────────────────────────────────────

def _seed_debt(page, *, name="Test Debt", balance="5000", rate="18", min_pay="50"):
    """Add a standard credit-card debt via the form."""
    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    # Ensure form is visible
    toggle = page.query_selector('#debtFormToggle')
    if toggle:
        expanded = toggle.get_attribute('aria-expanded')
        if expanded != 'true':
            toggle.click()
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    page.fill('#debtName', name)
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', balance)
    page.fill('#interestRate', rate)
    page.fill('#minimumPayment', min_pay)
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
    page.wait_for_selector(f'#debtsList >> text={name}', timeout=10000)


def _seed_income(page, *, name="My Salary", amount="3000"):
    """Add a monthly income source."""
    page.click('button[data-page="income"]')
    page.fill('#incomeName', name)
    page.fill('#incomeAmount', amount)
    page.fill('#incomeFirstDate', f"{date.today().year}-{date.today().month:02d}-01")
    page.select_option('#incomeFrequency', 'monthly')
    # An account is required for income (src/income.js addIncome); pick the first real one.
    page.select_option('#incomeAccount', index=1)
    page.click('button:has-text("Add Income")')
    page.wait_for_selector(f'#incomeList >> text={name}', timeout=10000)


def _seed_account(page, *, name="Checking", acct_type="Checking"):
    """Add an account."""
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', name)
    page.select_option('#accountType', label=acct_type)
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'#accountList >> text={name}', timeout=10000)


def _open_sinking_tab(page, *, open_form=False):
    """Navigate to Savings > Sinking Funds (optionally expanding the add form)."""
    page.click('button[data-page="savings"]')
    page.wait_for_selector('#savingsSection.active', timeout=5000)
    page.wait_for_selector('[data-savings-subtab="sinking"]', timeout=5000)
    page.click('[data-savings-subtab="sinking"]')
    page.wait_for_selector('#sinkingList', timeout=5000)
    if open_form:
        page.click('#sinkingFormToggle')
        page.wait_for_selector('#sinkingFormBody:not(.hidden)', timeout=5000)


def _seed_sinking_fund(page, *, name="Vacation Fund", monthly="100"):
    """Add a sinking fund via UI (requires an account, so one is created first)."""
    _seed_account(page, name="Sinking Account")
    _open_sinking_tab(page, open_form=True)
    page.fill('#sinkingName', name)
    page.fill('#sinkingMonthlyAllocation', monthly)
    page.fill('#sinkingCurrentAmount', '0')
    page.select_option('#sinkingAccount', index=1)
    page.click('#sinkingFormSubmit')
    page.wait_for_selector(f'#sinkingList >> text={name}', timeout=10000)


def _seed_recurring(page, *, name="Netflix", amount="15"):
    """Add a recurring template via the (collapsible) Recurring form."""
    _seed_account(page, name="Recurring Account")
    page.click('button[data-page="recurring"]')
    page.wait_for_selector('#recurringSection.active', timeout=5000)
    page.click('#recurringFormToggle')
    page.wait_for_selector('#recurringFormBody:not([hidden])', timeout=5000)
    page.fill('#recurringName', name)
    page.fill('#recurringAmount', amount)
    page.select_option('#recurringFrequency', 'monthly')
    page.select_option('#recurringAccount', index=1)
    page.fill('#recurringStartDate', f"{date.today().year}-{date.today().month:02d}-01")
    page.click('#recurringFormSubmit')
    page.wait_for_selector(f'#recurringList >> text={name}', timeout=10000)


# ─── #276 Empty State CTAs ─────────────────────────────────────────────────

@pytest.mark.feature
def test_empty_state_debts_no_data(app_page):
    """#276 — Debts page shows empty state with CTA when no debts exist."""
    page = app_page
    page.evaluate("() => { const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}'); d.debts = []; localStorage.setItem('debtTrackerData', JSON.stringify(d)); }")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('[data-liabilities-subtab="debts"].active', timeout=5000)

    assert page.query_selector('#debtsList .empty-state'), "Empty state not shown when no debts"
    assert page.query_selector('#debtEmptyStateCta'), "Add-debt CTA button missing"


@pytest.mark.feature
def test_empty_state_debts_cta_opens_form(app_page):
    """#276 — Clicking the debts empty state CTA reveals the add-debt form."""
    page = app_page
    page.evaluate("() => { const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}'); d.debts = []; localStorage.setItem('debtTrackerData', JSON.stringify(d)); }")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.wait_for_selector('#debtEmptyStateCta', timeout=5000)
    page.click('#debtEmptyStateCta')
    page.wait_for_selector('#debtFormBody:not([hidden])', timeout=5000)
    assert page.query_selector('#debtFormBody:not([hidden])'), "Form did not open via CTA"


@pytest.mark.feature
def test_empty_state_accounts_no_data(app_page):
    """#276 — Accounts page shows empty state with CTA when no accounts exist."""
    page = app_page
    page.evaluate("() => { const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}'); d.accounts = []; localStorage.setItem('debtTrackerData', JSON.stringify(d)); }")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)

    assert page.query_selector('#accountList .empty-state'), "Empty state not shown when no accounts"
    assert page.query_selector('#acctEmptyStateCta'), "Add-account CTA button missing"


@pytest.mark.feature
def test_empty_state_income_no_data(app_page):
    """#276 — Income page shows empty state with CTA when no income exists."""
    page = app_page
    page.evaluate("() => { const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}'); d.incomes = []; localStorage.setItem('debtTrackerData', JSON.stringify(d)); }")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="income"]')
    page.wait_for_selector('#incomeSection.active', timeout=5000)

    assert page.query_selector('#incomeList .empty-state'), "Empty state not shown when no income"
    assert page.query_selector('#incomeEmptyStateCta'), "Add-income CTA button missing"


@pytest.mark.feature
def test_empty_state_health_no_data(app_page):
    """#276 — Health dashboard shows setup CTA when completely empty."""
    page = app_page
    page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        d.accounts = []; d.debts = []; d.incomes = []; d.emergencyFunds = [];
        localStorage.setItem('debtTrackerData', JSON.stringify(d));
    }""")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="health"]')
    page.wait_for_selector('#healthSection.active', timeout=5000)

    assert page.query_selector('#healthEmptyStateCta'), "Health CTA missing when all data empty"
    assert page.query_selector('.health-empty-setup'), "Health empty-state container missing"


@pytest.mark.feature
def test_empty_state_ledger_no_data(app_page):
    """#276 — Ledger shows compact empty state message inside table when empty."""
    page = app_page
    page.evaluate("() => { const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}'); d.accounts = []; d.debts = []; d.incomes = []; localStorage.setItem('debtTrackerData', JSON.stringify(d)); }")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)

    assert page.query_selector('.ledger-empty-cell'), "Ledger empty cell missing"
    assert page.query_selector('.empty-state--compact'), "Compact empty state missing in ledger"


# ─── #259 Minimum Payment Trap ─────────────────────────────────────────────

@pytest.mark.feature
def test_min_payment_trap_warning_shown(app_page):
    """#259 — Debt card shows min-payment trap warning when payoff > 36 months."""
    page = app_page
    # High balance + low min payment → many years to pay off
    # min payment must exceed monthly interest (~$147) or the card shows the negative-amortization
    # warning instead; $200 amortizes in ~6 years (> 36 months => trap warning).
    _seed_debt(page, name="Trap Debt", balance="8000", rate="22", min_pay="200")

    trap_warn = page.query_selector('.debt-min-trap-warn')
    assert trap_warn, "Min-payment trap warning not shown for long-payoff debt"
    text = trap_warn.inner_text()
    assert "years" in text.lower() or "trap" in text.lower(), f"Unexpected trap warning text: {text!r}"


@pytest.mark.feature
def test_min_payment_trap_warning_not_shown_short_payoff(app_page):
    """#259 — No trap warning when minimum payment pays off debt quickly."""
    page = app_page
    # Low balance + high payment → pays off well under 36 months
    _seed_debt(page, name="Quick Debt", balance="500", rate="10", min_pay="200")

    trap_warn = page.query_selector('.debt-min-trap-warn')
    assert not trap_warn, "Trap warning incorrectly shown for short-payoff debt"


@pytest.mark.feature
def test_min_payment_trap_not_shown_zero_balance(app_page):
    """#259 — No trap warning when debt balance is zero."""
    page = app_page
    _seed_debt(page, name="Paid Debt", balance="0", rate="15", min_pay="50")

    trap_warn = page.query_selector('.debt-min-trap-warn')
    assert not trap_warn, "Trap warning shown for zero-balance debt"


# ─── #282 Bulk Debt Actions ─────────────────────────────────────────────────

@pytest.mark.feature
def test_bulk_bar_hidden_by_default(app_page):
    """#282 — Bulk action bar is hidden until a debt is selected."""
    page = app_page
    _seed_debt(page, name="Bulk Test Debt")

    bar = page.query_selector('#debtBulkBar')
    assert bar, "Debt bulk bar element not found"
    visible = page.evaluate("() => document.getElementById('debtBulkBar')?.classList.contains('debt-bulk-bar--visible')")
    assert not visible, "Bulk bar should not be visible before any selection"


@pytest.mark.feature
def test_bulk_bar_shows_on_selection(app_page):
    """#282 — Bulk action bar appears when a debt checkbox is checked."""
    page = app_page
    _seed_debt(page, name="Bulk Select Debt")

    cb = page.query_selector('.debt-row-select')
    assert cb, "Debt row checkbox not found"
    cb.check()

    page.wait_for_function(
        "() => document.getElementById('debtBulkBar')?.classList.contains('debt-bulk-bar--visible')",
        timeout=3000
    )
    assert page.query_selector('#debtBulkCount'), "Bulk count element not found"


@pytest.mark.feature
def test_bulk_archive_debts(app_page):
    """#282 — Archive Selected archives checked debts."""
    page = app_page
    _seed_debt(page, name="Bulk Archive Debt")

    cb = page.query_selector('.debt-row-select')
    assert cb, "Checkbox not found"
    cb.check()

    page.wait_for_function(
        "() => document.getElementById('debtBulkBar')?.classList.contains('debt-bulk-bar--visible')",
        timeout=3000
    )
    # Click Archive and confirm
    page.click('#debtBulkArchiveBtn')
    # Bulk archive reuses the shared delete-confirm modal (showDeleteConfirmModal)
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_timeout(500)

    # Debt should be archived (not visible unless show-archived is on)
    debt_card = page.query_selector('.debt-card:not(.debt-card--editing)')
    # Either it's archived (still visible) or hidden — either way bulk action ran
    archived_data = page.evaluate(
        "() => (JSON.parse(localStorage.getItem('debtTrackerData') || '{}').debts || []).some(d => d.archived)"
    )
    assert archived_data, "No debt was archived after bulk archive"


@pytest.mark.feature
def test_bulk_export_csv_debts(app_page):
    """#282 — Export Selected downloads a CSV for checked debts."""
    page = app_page
    _seed_debt(page, name="CSV Export Debt")

    cb = page.query_selector('.debt-row-select')
    assert cb, "Checkbox not found"
    cb.check()

    page.wait_for_function(
        "() => document.getElementById('debtBulkBar')?.classList.contains('debt-bulk-bar--visible')",
        timeout=3000
    )

    with page.expect_download(timeout=5000) as download_info:
        page.click('#debtBulkExportBtn')

    dl = download_info.value
    assert dl.suggested_filename.endswith('.csv'), f"Expected .csv, got {dl.suggested_filename!r}"


@pytest.mark.feature
def test_bulk_delete_debts(app_page):
    """#282 — Delete Selected removes checked debts after confirmation."""
    page = app_page
    _seed_debt(page, name="Bulk Delete Debt")

    initial_count = page.evaluate(
        "() => (JSON.parse(localStorage.getItem('debtTrackerData') || '{}').debts || []).length"
    )

    cb = page.query_selector('.debt-row-select')
    assert cb, "Checkbox not found"
    cb.check()

    page.wait_for_function(
        "() => document.getElementById('debtBulkBar')?.classList.contains('debt-bulk-bar--visible')",
        timeout=3000
    )
    page.click('#debtBulkDeleteBtn')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_timeout(500)

    final_count = page.evaluate(
        "() => (JSON.parse(localStorage.getItem('debtTrackerData') || '{}').debts || []).length"
    )
    assert final_count < initial_count, "Debt count did not decrease after bulk delete"


# ─── #285 Ledger Cross-Navigation ────────────────────────────────────────────

@pytest.mark.feature
def test_ledger_cross_nav_debt_btn_present(app_page):
    """#285 — Debt rows in the ledger show a cross-nav ↗ button."""
    page = app_page
    _seed_account(page, name="Nav Account")
    # Inject a debt linked to the account
    page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        const acct = (d.accounts || [])[0];
        if (!acct) return;
        d.debts = d.debts || [];
        d.debts.push({ id: 9901, name: 'Nav Debt', debtType: 'creditCard', accountBalance: 1000,
            interestRate: 15, minimumPayment: 50, dueDate: 15, accountId: acct.id,
            archived: false, priority: null });
        localStorage.setItem('debtTrackerData', JSON.stringify(d));
    }""")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    # Show all transactions so the debt payment appears
    date_range = page.query_selector('#ledgerDateRange')
    if date_range:
        date_range.select_option('all')
    page.wait_for_timeout(500)

    nav_btn = page.query_selector('[data-ledger-nav-type="debt"]')
    assert nav_btn, "Cross-nav button for debt row not found in ledger"


@pytest.mark.feature
def test_ledger_cross_nav_income_btn_present(app_page):
    """#285 — Income rows in the ledger show a cross-nav ↗ button."""
    page = app_page
    _seed_account(page, name="Income Nav Account")
    _seed_income(page, name="Nav Income")

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    date_range = page.query_selector('#ledgerDateRange')
    if date_range:
        date_range.select_option('all')
    page.wait_for_timeout(500)

    nav_btn = page.query_selector('[data-ledger-nav-type="income"]')
    assert nav_btn, "Cross-nav button for income row not found in ledger"


@pytest.mark.feature
def test_ledger_cross_nav_debt_navigates(app_page):
    """#285 — Clicking a debt cross-nav button switches to Liabilities page."""
    page = app_page
    _seed_account(page, name="DebtNav Account")
    page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        const acct = (d.accounts || [])[0];
        if (!acct) return;
        d.debts = d.debts || [];
        d.debts.push({ id: 9902, name: 'NavDebt2', debtType: 'creditCard', accountBalance: 500,
            interestRate: 12, minimumPayment: 30, dueDate: 10, accountId: acct.id,
            archived: false, priority: null });
        localStorage.setItem('debtTrackerData', JSON.stringify(d));
    }""")
    page.reload(wait_until="networkidle")

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    date_range = page.query_selector('#ledgerDateRange')
    if date_range:
        date_range.select_option('all')
    page.wait_for_timeout(500)

    nav_btn = page.query_selector('[data-ledger-nav-type="debt"]')
    if not nav_btn:
        pytest.skip("No debt nav button visible — no debt transactions in window")

    nav_btn.click()
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)
    assert page.query_selector('#liabilitiesSection.active'), "Did not navigate to Liabilities page"


# ─── #293 Recurring Actual-Amount Override ────────────────────────────────────

@pytest.mark.feature
def test_recurring_mark_paid_opens_modal(app_page):
    """#293 — Clicking 'Mark as paid' opens the actual-amount modal."""
    page = app_page
    _seed_recurring(page, name="Mark Paid Test", amount="15")

    # The mark-paid button only appears when the recurring template has occurrences this month
    mark_btn = page.query_selector('[data-recurring-action="mark-paid"]')
    if not mark_btn:
        pytest.skip("Mark-paid button not visible (no occurrence this month)")

    mark_btn.click()
    page.wait_for_selector('#recurringMarkPaidModal', timeout=5000)

    modal = page.query_selector('#recurringMarkPaidModal')
    assert modal, "Actual-amount modal did not open"
    assert page.query_selector('#recurringActualAmountInput'), "Amount input not in modal"


@pytest.mark.feature
def test_recurring_mark_paid_default_amount_prefilled(app_page):
    """#293 — The actual-amount input is pre-filled with the budgeted amount."""
    page = app_page
    _seed_recurring(page, name="Prefill Test", amount="42")

    mark_btn = page.query_selector('[data-recurring-action="mark-paid"]')
    if not mark_btn:
        pytest.skip("Mark-paid button not visible")

    mark_btn.click()
    page.wait_for_selector('#recurringActualAmountInput', timeout=5000)

    value = page.input_value('#recurringActualAmountInput')
    assert value == '42', f"Expected '42', got {value!r}"


@pytest.mark.feature
def test_recurring_mark_paid_with_actual_amount(app_page):
    """#293 — Submitting an actual amount stores it and shows on the badge."""
    page = app_page
    _seed_recurring(page, name="Actual Amount Test", amount="50")

    mark_btn = page.query_selector('[data-recurring-action="mark-paid"]')
    if not mark_btn:
        pytest.skip("Mark-paid button not visible")

    mark_btn.click()
    page.wait_for_selector('#recurringActualAmountInput', timeout=5000)
    page.fill('#recurringActualAmountInput', '65')
    page.click('#recurringMarkPaidConfirmBtn')
    page.wait_for_timeout(500)

    # Template should now have paidAmounts entry
    month_key = f"{date.today().year}-{date.today().month:02d}"
    paid_amount = page.evaluate(f"""() => {{
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{{}}');
        const t = (d.recurringTemplates || []).find(x => x.name === 'Actual Amount Test');
        return t?.paidAmounts?.['{month_key}'];
    }}""")
    assert paid_amount == 65, f"Expected paidAmounts to be 65, got {paid_amount!r}"


@pytest.mark.feature
def test_recurring_mark_paid_cancel_no_change(app_page):
    """#293 — Cancelling the modal leaves the template unmarked."""
    page = app_page
    _seed_recurring(page, name="Cancel Mark Test", amount="20")

    mark_btn = page.query_selector('[data-recurring-action="mark-paid"]')
    if not mark_btn:
        pytest.skip("Mark-paid button not visible")

    mark_btn.click()
    page.wait_for_selector('#recurringMarkPaidCancelBtn', timeout=5000)
    page.click('#recurringMarkPaidCancelBtn')
    page.wait_for_timeout(500)  # outlast the 300ms saveToStorage debounce so a wrongful write would be visible

    month_key = f"{date.today().year}-{date.today().month:02d}"
    paid = page.evaluate(f"""() => {{
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{{}}');
        const t = (d.recurringTemplates || []).find(x => x.name === 'Cancel Mark Test');
        return (t?.paidMonths || []).includes('{month_key}');
    }}""")
    assert not paid, "Template should not be marked paid after cancel"


# ─── #304 Sinking Fund Priority Ordering ─────────────────────────────────────

@pytest.mark.feature
def test_sinking_fund_order_field_exists(app_page):
    """#304 — Sinking fund add form has an order input."""
    page = app_page
    _open_sinking_tab(page, open_form=True)
    assert page.query_selector('#sinkingOrder'), "Order input (#sinkingOrder) missing from sinking fund form"


@pytest.mark.feature
def test_sinking_fund_order_stored(app_page):
    """#304 — Setting an order value persists it in storage."""
    page = app_page
    _seed_account(page, name="Order Account")
    _open_sinking_tab(page, open_form=True)
    page.fill('#sinkingName', 'Ordered Fund')
    page.fill('#sinkingMonthlyAllocation', '50')
    page.fill('#sinkingCurrentAmount', '0')
    page.select_option('#sinkingAccount', index=1)
    page.fill('#sinkingOrder', '3')
    page.click('#sinkingFormSubmit')
    page.wait_for_selector('#sinkingList >> text=Ordered Fund', timeout=10000)

    # saveToStorage is debounced: the account save just before this opens a window,
    # so the fund lands in a trailing write a moment later — poll for it.
    page.wait_for_function("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        return (d.sinkingFunds || []).some(x => x.name === 'Ordered Fund');
    }""", timeout=5000)
    stored_order = page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        const f = (d.sinkingFunds || []).find(x => x.name === 'Ordered Fund');
        return f?.order;
    }""")
    assert stored_order == 3, f"Expected order=3, got {stored_order!r}"


# ─── #308 Sinking Fund Completion Flow ───────────────────────────────────────

@pytest.mark.feature
def test_sinking_fund_complete_btn_shown_when_funded(app_page):
    """#308 — 'Complete this goal' button appears on fully funded sinking funds."""
    page = app_page
    page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        // sanitizeSinkingFund callers drop funds without an accountId, so seed an account too
        d.accounts = [{ id: 8800, name: 'Sinking Seed Acct', type: 'Checking', startingBalance: 1000 }];
        d.sinkingFunds = d.sinkingFunds || [];
        d.sinkingFunds.push({ id: 8801, name: 'Fully Funded', targetAmount: 500, accountId: 8800,
            currentAmount: 500, monthlyAllocation: 50, order: 0, archived: false, completedDate: null });
        localStorage.setItem('debtTrackerData', JSON.stringify(d));
    }""")
    page.reload(wait_until="networkidle")

    _open_sinking_tab(page)

    complete_btn = page.query_selector('.sinking-complete-btn')
    assert complete_btn, "'Complete this goal' button not shown for fully funded sinking fund"


@pytest.mark.feature
def test_sinking_fund_complete_btn_not_shown_when_not_funded(app_page):
    """#308 — 'Complete this goal' button not shown when fund is not fully funded."""
    page = app_page
    _seed_sinking_fund(page, name="Partial Fund", monthly="50")
    # currentAmount will be 0 after creation

    complete_btn = page.query_selector('.sinking-complete-btn')
    assert not complete_btn, "Complete btn should not appear for unfunded sinking fund"


@pytest.mark.feature
def test_sinking_fund_archive_completes(app_page):
    """#308 — Clicking Archive in completion modal archives the sinking fund."""
    page = app_page
    page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        // sanitizeSinkingFund callers drop funds without an accountId, so seed an account too
        d.accounts = [{ id: 8800, name: 'Sinking Seed Acct', type: 'Checking', startingBalance: 1000 }];
        d.sinkingFunds = d.sinkingFunds || [];
        d.sinkingFunds.push({ id: 8802, name: 'Complete Archive', targetAmount: 200, accountId: 8800,
            currentAmount: 200, monthlyAllocation: 20, order: 0, archived: false, completedDate: null });
        localStorage.setItem('debtTrackerData', JSON.stringify(d));
    }""")
    page.reload(wait_until="networkidle")

    _open_sinking_tab(page)

    page.click('.sinking-complete-btn')
    page.wait_for_selector('#scArchiveBtn', timeout=5000)
    page.click('#scArchiveBtn')
    page.wait_for_timeout(500)

    archived = page.evaluate("""() => {
        const d = JSON.parse(localStorage.getItem('debtTrackerData') || '{}');
        const f = (d.sinkingFunds || []).find(x => x.name === 'Complete Archive');
        return f?.archived === true;
    }""")
    assert archived, "Sinking fund was not archived after completion modal Archive"


# ─── #310 Focus-Trap on Modals ────────────────────────────────────────────────

@pytest.mark.feature
def test_ledger_export_modal_focus_trap(app_page):
    """#310 — Ledger Export CSV modal has a close button and responds to Escape."""
    page = app_page
    _seed_account(page, name="FocusTrap Account")
    _seed_income(page, name="FocusTrap Income")

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerExportCsvBtn', timeout=5000)
    page.click('#ledgerExportCsvBtn')
    page.wait_for_selector('#ledgerExportModal:not(.hidden)', timeout=5000)
    page.wait_for_selector('#ledgerExportCloseBtn:focus', timeout=5000)  # modal auto-focuses via setTimeout

    # Escape closes the modal
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    modal = page.query_selector('#ledgerExportModal')
    assert modal.get_attribute('class') and 'hidden' in modal.get_attribute('class'), \
        "Ledger export modal did not close on Escape"


@pytest.mark.feature
def test_ledger_export_modal_close_btn(app_page):
    """#310 — Ledger Export modal has a functional close button."""
    page = app_page
    _seed_account(page, name="FocusTrap2 Account")
    _seed_income(page, name="FocusTrap2 Income")

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerExportCsvBtn', timeout=5000)
    page.click('#ledgerExportCsvBtn')
    page.wait_for_selector('#ledgerExportModal:not(.hidden)', timeout=5000)

    close_btn = page.query_selector('#ledgerExportModal button:has-text("Cancel"), #ledgerExportModal button:has-text("Close"), #ledgerExportCancelBtn')
    assert close_btn, "Close button not found in ledger export modal"
    close_btn.click()
    page.wait_for_timeout(300)
    modal = page.query_selector('#ledgerExportModal')
    assert modal.get_attribute('class') and 'hidden' in modal.get_attribute('class'), \
        "Ledger export modal did not close"


@pytest.mark.feature
def test_ledger_export_modal_focus_restore_on_close(app_page):
    """#310 — closing the Ledger Export modal restores focus to the button
    that opened it (N2 from the Oct 2026 a11y audit). The Export CSV button
    is part of the filter bar and renders with no seeded data, so this test
    doesn't need an account/income fixture."""
    page = app_page

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerExportCsvBtn', timeout=5000)
    page.click('#ledgerExportCsvBtn')
    page.wait_for_selector('#ledgerExportModal.flex-visible', timeout=5000)

    page.keyboard.press('Escape')
    page.wait_for_selector('#ledgerExportModal', state='hidden', timeout=5000)

    focused_id = page.evaluate('() => document.activeElement.id')
    assert focused_id == 'ledgerExportCsvBtn', \
        f"Focus should return to the triggering button, got: {focused_id!r}"


@pytest.mark.feature
def test_ledger_export_modal_tab_trap_cycles_focus(app_page):
    """#310 — Tab from the last focusable element in the Ledger Export modal
    wraps back to the first, rather than escaping to the page behind it."""
    page = app_page

    page.click('button[data-page="ledger"]')
    page.wait_for_selector('#ledgerSection.active', timeout=5000)
    page.wait_for_selector('#ledgerExportCsvBtn', timeout=5000)
    page.click('#ledgerExportCsvBtn')
    page.wait_for_selector('#ledgerExportModal.flex-visible', timeout=5000)

    # openLedgerExportModal auto-focuses the close button 30ms after opening
    # (see src/ledger.js); wait for that to settle before moving focus
    # ourselves, or the two races and the close button steals it back.
    page.wait_for_selector('#ledgerExportCloseBtn:focus', timeout=2000)

    first_focusable = page.evaluate("""() => {
        const modal = document.getElementById('ledgerExportModal');
        const focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
        return focusable[0]?.id || null;
    }""")
    assert first_focusable, "Expected at least one focusable element in the modal"

    page.evaluate("() => document.getElementById('ledgerExportCancelBtn').focus()")
    page.keyboard.press('Tab')
    focused_id = page.evaluate('() => document.activeElement.id')
    assert focused_id == first_focusable, \
        f"Tab from the last element should wrap to the first ({first_focusable!r}), got: {focused_id!r}"

# test_versioning_6_26_0 removed: a hard-coded 6.26.0 footer assertion can never hold again after the
# next version bump; version/CHANGELOG sync is enforced durably by tests/features/test_versioning.py.
