#!/usr/bin/env python3
"""
Retirement Accounts Dashboard tests (issue: retirement accounts + charts).
Covers the account type/fields, snapshot logging, charts, projection, and
export/import round-trip for the local/session storage backends.
"""

import json
import pytest

from tests.conftest import assert_no_errors


def _add_retirement_account(page, name="401k Test", subtype="401k", rate="7", match="50"):
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', name)
    page.select_option('#accountType', 'Retirement')
    page.select_option('#accountRetirementSubtype', subtype)
    page.fill('#accountStartingBalance', '10000')
    page.fill('#accountRateOfReturn', rate)
    page.fill('#accountEmployerMatch', match)
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


def _add_pension_account(page, name="City Pension", salary="80000", contrib_rate="7",
                         vesting="5", benefit="2000", service="10"):
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', name)
    page.select_option('#accountType', 'Retirement')
    page.select_option('#accountRetirementSubtype', 'Pension')
    page.fill('#accountStartingBalance', '0')
    page.fill('#accountPensionSalary', salary)
    page.fill('#accountPensionContributionRate', contrib_rate)
    page.fill('#accountPensionVestingYears', vesting)
    page.fill('#accountPensionMonthlyBenefit', benefit)
    page.fill('#accountPensionYearsOfService', service)
    page.click('#accountFormSubmit')
    page.wait_for_selector(f'text={name}', timeout=10000)


@pytest.mark.feature
def test_export_then_import_round_trips_retirement_data(app_page):
    """Exporting and re-importing preserves retirement accounts, snapshots, and target date."""
    page = app_page
    _add_retirement_account(page)

    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10500, 300)")
    page.evaluate("() => { window.app.retirementTargetDate = '2050-01-01'; window.app.saveToStorage(); }")

    exported = page.evaluate("""
        () => {
            const data = {
                version: window.app.constructor.name,
                accounts: window.app.accounts,
                debts: window.app.debts,
                retirementSnapshots: window.app.retirementSnapshots,
                retirementTargetDate: window.app.retirementTargetDate
            };
            return JSON.stringify(data);
        }
    """)

    # Clear in-memory state, then import the exported JSON back in.
    page.evaluate("""
        () => { window.app.accounts = []; window.app.retirementSnapshots = []; window.app.retirementTargetDate = null; }
    """)

    import_result = page.evaluate(
        """(json) => {
            return new Promise((resolve) => {
                const blob = new Blob([json], { type: 'application/json' });
                const file = new File([blob], 'backup.json', { type: 'application/json' });
                window.app.importFromJSON = window.app.importFromJSON || null;
                import('/src/dataExport.js').then(({ importAllJSON }) => {
                    importAllJSON(window.app, file, {
                        requestImportMode: async () => true,
                        onImported: () => resolve('imported'),
                        onNoData: () => resolve('no-data'),
                        onInvalidJSON: () => resolve('invalid')
                    });
                });
            });
        }""",
        exported
    )
    assert import_result == "imported"

    restored_snapshots = page.evaluate("() => window.app.retirementSnapshots")
    restored_target = page.evaluate("() => window.app.retirementTargetDate")
    assert len(restored_snapshots) == 1
    assert restored_snapshots[0]["balance"] == 10500
    assert restored_target == "2050-01-01"
    assert_no_errors(page)


@pytest.mark.feature
def test_retirement_account_shows_conditional_fields(app_page):
    """Selecting Retirement in the account type dropdown reveals subtype/rate/match fields."""
    page = app_page
    page.click('button[data-page="accounts"]')
    assert page.is_hidden('#accountRateOfReturnGroup')
    page.select_option('#accountType', 'Retirement')
    assert page.is_visible('#accountRateOfReturnGroup')
    assert page.is_visible('#accountRetirementFieldsGroup')
    assert page.is_visible('#accountEmployerMatchGroup')
    page.select_option('#accountType', 'Checking')
    assert page.is_hidden('#accountRateOfReturnGroup')
    assert_no_errors(page)


@pytest.mark.feature
def test_retirement_page_empty_state_links_to_accounts(app_page):
    """With no retirement accounts, the Retirement page prompts to add one."""
    page = app_page
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('text=No retirement accounts yet', timeout=5000)
    page.click('[data-retire-action="goto-accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    assert_no_errors(page)


@pytest.mark.feature
def test_add_and_delete_snapshot_via_modal(app_page):
    """Add Snapshot modal creates a row; Delete removes it."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-card', timeout=5000)

    page.click('[data-retire-action="add-snapshot"]')
    page.wait_for_selector('#retirementSnapshotModal.flex-visible', timeout=5000)
    page.fill('#retirementSnapshotModalBalance', '11000')
    page.fill('#retirementSnapshotModalContribution', '400')
    page.click('#retirementSnapshotModalConfirmBtn')
    page.wait_for_selector('#retirementSnapshotModal', state='hidden', timeout=5000)

    row_count = page.evaluate("() => document.querySelectorAll('.retire-snapshot-table tbody tr').length")
    assert row_count == 1

    page.click('[data-retire-action="delete-snapshot"]')
    snapshots = page.evaluate("() => window.app.retirementSnapshots")
    assert snapshots == []
    assert_no_errors(page)


@pytest.mark.feature
def test_charts_render_with_two_snapshots(app_page):
    """Balance, contribution, and breakdown charts render canvases once data exists."""
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10000, 300)")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-02-01', 10500, 300)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)

    for canvas_id in ['retireBalanceChart', 'retireContributionChart', 'retireBreakdownChart']:
        assert page.locator(f'#{canvas_id}').count() == 1, f'{canvas_id} did not render'
        sr_rows = page.evaluate(f"() => document.querySelectorAll('#{canvas_id}-sr-table tbody tr').length")
        assert sr_rows > 0, f'{canvas_id} has no accessible data table rows'
    assert_no_errors(page)


@pytest.mark.feature
def test_projection_panel_requires_target_date(app_page):
    """Projection panel prompts for a target date until one is set, then shows a number."""
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10000, 300)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('text=Set a target retirement date', timeout=5000)

    page.fill('#retirementTargetDateInput', '2050-01-01')
    page.dispatch_event('#retirementTargetDateInput', 'change')
    page.wait_for_selector('text=Combined Total', timeout=5000)
    assert_no_errors(page)


# ── #345 Withdrawal rate / monthly income in retirement ──────────────────────

def _add_account_with_target_date(page, balance=1000000, rate='7', target_date='2050-01-01'):
    """A single retirement account with a logged balance and a target date,
    so the projection panel (and withdrawal-rate slider within it) renders."""
    _add_retirement_account(page, rate=rate)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', {balance}, 0)")
    page.evaluate(f"""() => {{
        window.app.retirementTargetDate = '{target_date}';
        window.app.saveToStorage();
        window.app.renderRetirementPage();
    }}""")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retireWithdrawalRateSlider', timeout=5000)
    return account_id


@pytest.mark.feature
def test_withdrawal_rate_defaults_to_4_percent_and_shows_monthly_income(app_page):
    """The slider defaults to 4% and the monthly-income estimate matches
    projectedBalance * 4% / 12."""
    page = app_page
    _add_account_with_target_date(page)

    slider_val = page.eval_on_selector('#retireWithdrawalRateSlider', 'el => el.value')
    assert float(slider_val) == 4.0

    projected = page.evaluate("() => window.app.computeAccountProjection(window.app.accounts.find(a => a.type === 'Retirement').id)")
    expected_monthly = projected * 0.04 / 12
    shown = page.inner_text('#retireMonthlyWithdrawalVal')
    # formatCurrency rounds to 2 decimals; compare the numeric part loosely.
    shown_num = float(shown.replace('$', '').replace(',', ''))
    assert abs(shown_num - expected_monthly) < 1.0


@pytest.mark.feature
def test_withdrawal_rate_slider_updates_label_and_income_live(app_page):
    """Dragging the slider updates both the displayed percentage and the
    monthly-income figure immediately (no reload/recompute needed)."""
    page = app_page
    _add_account_with_target_date(page)

    page.eval_on_selector(
        '#retireWithdrawalRateSlider',
        "(el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }",
        6,
    )
    rate_label = page.inner_text('#retireWithdrawalRateVal')
    assert '6' in rate_label

    projected = page.evaluate("() => window.app.computeAccountProjection(window.app.accounts.find(a => a.type === 'Retirement').id)")
    expected_monthly = projected * 0.06 / 12
    shown_num = float(page.inner_text('#retireMonthlyWithdrawalVal').replace('$', '').replace(',', ''))
    assert abs(shown_num - expected_monthly) < 1.0
    assert_no_errors(page)


@pytest.mark.feature
def test_withdrawal_rate_persists_after_reload(app_page):
    """Moving the slider and firing 'change' persists the rate via
    getSetting/setSetting; it survives a page reload."""
    page = app_page
    _add_account_with_target_date(page)

    page.eval_on_selector(
        '#retireWithdrawalRateSlider',
        "(el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }",
        5.5,
    )

    page.reload(wait_until="networkidle")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retireWithdrawalRateSlider', timeout=10000)
    slider_val = page.eval_on_selector('#retireWithdrawalRateSlider', 'el => el.value')
    assert float(slider_val) == 5.5


@pytest.mark.feature
def test_withdrawal_rate_help_icon_has_accessible_explanation(app_page):
    """A help icon explains the safe withdrawal rate concept for screen readers."""
    page = app_page
    _add_account_with_target_date(page)

    help_icon = page.query_selector('.retire-withdrawal-row .help-icon')
    assert help_icon, "Expected a help icon next to the withdrawal rate slider"
    aria_label = help_icon.get_attribute('aria-label')
    assert aria_label and len(aria_label) > 10
    assert '4%' in aria_label


@pytest.mark.feature
def test_reload_persists_retirement_data(app_page):
    """Retirement account, snapshot, and target date survive a page reload (localStorage)."""
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10000, 300)")
    page.evaluate("() => { window.app.retirementTargetDate = '2050-01-01'; window.app.saveToStorage(); }")

    page.reload(wait_until="networkidle")
    snapshots = page.evaluate("() => window.app.retirementSnapshots")
    target = page.evaluate("() => window.app.retirementTargetDate")
    assert len(snapshots) == 1
    assert target == "2050-01-01"
    assert_no_errors(page)


# ── Pension account tests ──────────────────────────────────────────────────────

@pytest.mark.feature
def test_pension_subtype_shows_pension_fields(app_page):
    """Selecting Pension hides rate-of-return/match and shows pension-specific fields."""
    page = app_page
    page.click('button[data-page="accounts"]')
    page.select_option('#accountType', 'Retirement')
    # Default subtype (401k) shows rate-of-return, hides pension fields.
    assert page.is_visible('#accountRateOfReturnGroup')
    assert page.is_hidden('#accountPensionSalaryGroup')

    page.select_option('#accountRetirementSubtype', 'Pension')
    assert page.is_hidden('#accountRateOfReturnGroup')
    assert page.is_hidden('#accountEmployerMatchGroup')
    assert page.is_visible('#accountPensionSalaryGroup')
    assert page.is_visible('#accountPensionContributionRateGroup')
    assert page.is_visible('#accountPensionVestingYearsGroup')
    assert page.is_visible('#accountPensionMonthlyBenefitGroup')
    assert page.is_visible('#accountPensionYearsOfServiceGroup')

    # Switching back hides pension fields again.
    page.select_option('#accountRetirementSubtype', '401k')
    assert page.is_visible('#accountRateOfReturnGroup')
    assert page.is_hidden('#accountPensionSalaryGroup')
    assert_no_errors(page)


@pytest.mark.feature
def test_add_pension_account_persists_all_fields(app_page):
    """Pension account stores salary, contribution rate, vesting, benefit, and service correctly."""
    page = app_page
    _add_pension_account(page)
    acct = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === 'Pension')")
    assert acct is not None
    assert acct['pensionAnnualSalary'] == 80000
    assert acct['pensionContributionRatePct'] == 7
    assert acct['pensionVestingYears'] == 5
    assert acct['pensionEstimatedMonthlyBenefit'] == 2000
    assert acct['pensionYearsOfService'] == 10
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_snapshot_modal_shows_salary_field(app_page):
    """For a pension account the snapshot modal shows Annual Salary and hides Balance/Contribution."""
    page = app_page
    _add_pension_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-card', timeout=5000)

    page.click('[data-retire-action="add-snapshot"]')
    page.wait_for_selector('#retirementSnapshotModal.flex-visible', timeout=5000)

    assert page.is_visible('#retirementSnapshotModalSalaryGroup')
    assert page.is_hidden('#retirementSnapshotModalBalanceGroup')
    assert page.is_hidden('#retirementSnapshotModalContributionGroup')
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_snapshot_logs_salary_and_computes_contribution(app_page):
    """Logging a salary review stores annualSalary and auto-computes the monthly contribution."""
    page = app_page
    _add_pension_account(page, salary="120000", contrib_rate="7")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-card', timeout=5000)

    page.click('[data-retire-action="add-snapshot"]')
    page.wait_for_selector('#retirementSnapshotModal.flex-visible', timeout=5000)
    page.fill('#retirementSnapshotModalAnnualSalary', '120000')
    page.click('#retirementSnapshotModalConfirmBtn')
    page.wait_for_selector('#retirementSnapshotModal', state='hidden', timeout=5000)

    snap = page.evaluate("() => window.app.retirementSnapshots[0]")
    assert snap['annualSalary'] == 120000
    # Monthly contribution = 120000 * 7% / 12 = 700
    assert abs(snap['contribution'] - 700) < 0.01
    assert snap['balance'] == 0
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_snapshot_delete_removes_row(app_page):
    """Delete button removes a pension salary review snapshot."""
    page = app_page
    _add_pension_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === 'Pension').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 0, 466.67, 80000)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-card', timeout=5000)

    page.click('[data-retire-action="delete-snapshot"]')
    assert page.evaluate("() => window.app.retirementSnapshots.length") == 0
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_projection_uses_total_contributions(app_page):
    """Projection panel shows total contributions, not a compounded balance, for pension accounts."""
    page = app_page
    _add_pension_account(page, salary="120000", contrib_rate="7")
    account_id = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === 'Pension').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 0, 700, 120000)")
    page.click('button[data-page="retirement"]')

    page.fill('#retirementTargetDateInput', '2050-01-01')
    page.dispatch_event('#retirementTargetDateInput', 'change')
    page.wait_for_selector('text=total contributions', timeout=5000)

    # Should show some projected total > 0
    projected = page.evaluate("() => window.app.computeAccountProjection(window.app.accounts.find(a => a.retirementSubtype === 'Pension').id)")
    assert projected > 0
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_excluded_from_charts(app_page):
    """Pension accounts are excluded from the three retirement investment charts."""
    page = app_page
    _add_pension_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === 'Pension').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 0, 466.67, 80000)")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-02-01', 0, 466.67, 80000)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)

    # Charts are present in DOM but should be empty (no data) since pension is excluded.
    for canvas_id in ['retireBalanceChart', 'retireContributionChart', 'retireBreakdownChart']:
        assert page.locator(f'#{canvas_id}').count() == 1, f'{canvas_id} missing'

    # The SR table for balance chart should have no data rows (no investment accounts).
    sr_rows = page.evaluate("() => document.querySelectorAll('#retireBalanceChart-sr-table tbody tr').length")
    assert sr_rows == 0
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_account_round_trips_export_import(app_page):
    """All pension fields survive an export/import round-trip."""
    page = app_page
    _add_pension_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === 'Pension').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 0, 466.67, 80000)")

    exported = page.evaluate("""
        () => JSON.stringify({
            version: '3.0',
            accounts: window.app.accounts,
            debts: [],
            retirementSnapshots: window.app.retirementSnapshots
        })
    """)

    page.evaluate("() => { window.app.accounts = []; window.app.retirementSnapshots = []; }")

    result = page.evaluate(
        """(json) => new Promise(resolve => {
            const file = new File([json], 'backup.json', { type: 'application/json' });
            import('/src/dataExport.js').then(({ importAllJSON }) => {
                importAllJSON(window.app, file, {
                    requestImportMode: async () => true,
                    onImported: () => resolve('imported'),
                    onNoData: () => resolve('no-data'),
                    onInvalidJSON: () => resolve('invalid')
                });
            });
        })""",
        exported
    )
    assert result == "imported"

    acct = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === 'Pension')")
    assert acct is not None
    assert acct['pensionAnnualSalary'] == 80000
    assert acct['pensionContributionRatePct'] == 7
    assert acct['pensionVestingYears'] == 5
    assert acct['pensionEstimatedMonthlyBenefit'] == 2000
    assert acct['pensionYearsOfService'] == 10

    snap = page.evaluate("() => window.app.retirementSnapshots[0]")
    assert snap['annualSalary'] == 80000
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_card_shows_salary_history_table(app_page):
    """The retirement page card for a pension shows a salary history table, not a balance table."""
    page = app_page
    _add_pension_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-card', timeout=5000)

    # The salary history table header should be present.
    headers = page.evaluate("""
        () => Array.from(document.querySelectorAll('.retire-snapshot-table th')).map(th => th.textContent.trim())
    """)
    assert 'Annual Salary' in headers
    assert 'Monthly Contribution' in headers
    assert 'Balance' not in headers
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_sanitizer_accepts_valid_fields(app_page):
    """sanitizeAccount correctly round-trips all pension fields through storage."""
    page = app_page
    _add_pension_account(page, salary="95000", contrib_rate="8", vesting="3", benefit="1500", service="7")
    page.evaluate("() => window.app.saveToStorage()")
    page.reload(wait_until="networkidle")

    acct = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === 'Pension')")
    assert acct['pensionAnnualSalary'] == 95000
    assert acct['pensionContributionRatePct'] == 8
    assert acct['pensionVestingYears'] == 3
    assert acct['pensionEstimatedMonthlyBenefit'] == 1500
    assert acct['pensionYearsOfService'] == 7
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_and_investment_coexist_on_retirement_page(app_page):
    """Mixed pension and investment accounts both render without error on the retirement page."""
    page = app_page
    _add_pension_account(page, name="State Pension")
    _add_retirement_account(page, name="401k Fund")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-card', timeout=5000)

    cards = page.evaluate("() => document.querySelectorAll('.retire-cards .retire-card').length")
    assert cards == 2

    # Charts should render with at least the investment account data.
    account_id = page.evaluate("() => window.app.accounts.find(a => a.retirementSubtype === '401k').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 12000, 400)")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-02-01', 12500, 400)")
    page.click('button[data-page="health"]')
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)

    sr_rows = page.evaluate("() => document.querySelectorAll('#retireBalanceChart-sr-table tbody tr').length")
    assert sr_rows > 0, "Investment account data should appear in balance chart"
    assert_no_errors(page)


# ── Contribution limit tracker tests (#280) ────────────────────────────────────

@pytest.mark.feature
def test_contribution_limit_bar_shows_on_401k_card(app_page):
    """A 401k account card on the Retirement page shows the IRS contribution limit section."""
    page = app_page
    _add_retirement_account(page, name="My 401k", subtype="401k")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    assert page.is_visible('.retire-limit-section'), "Limit section should be visible for a 401k"
    assert page.is_visible('.retire-limit-title'), "Limit title should be visible"
    limit_label = page.text_content('.retire-limit-label')
    assert 'of' in limit_label, "Limit label should show 'YTD of limit' format"
    assert_no_errors(page)


@pytest.mark.feature
def test_contribution_limit_ytd_sums_current_year_snapshots(app_page):
    """YTD contributions sum only snapshots in the current calendar year."""
    import datetime
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    current_year = datetime.date.today().year
    prior_year = current_year - 1
    # Add one snapshot this year and one last year.
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '{current_year}-03-01', 10000, 3000)")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '{current_year}-06-01', 12000, 2000)")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '{prior_year}-12-01', 9000, 999)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    # YTD should be $5,000 (3000 + 2000), not $5,999.
    limit_label = page.text_content('.retire-limit-label')
    assert '5,000' in limit_label, f"YTD should be $5,000, got: {limit_label}"
    assert_no_errors(page)


@pytest.mark.feature
def test_near_limit_badge_appears_when_within_20_pct(app_page):
    """'Near limit' badge appears when YTD is between 80% and 100% of the IRS limit."""
    import datetime
    page = app_page
    _add_retirement_account(page, name="IRA Test", subtype="Traditional IRA")
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    current_year = datetime.date.today().year
    # IRA limit is $7,000; 90% = $6,300.
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '{current_year}-06-01', 20000, 6300)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    badge = page.query_selector('.retire-limit-badge--near')
    assert badge is not None, "Near-limit badge should appear at 90% of limit"
    assert_no_errors(page)


@pytest.mark.feature
def test_over_limit_badge_appears_when_exceeded(app_page):
    """'Over limit' badge appears when YTD contributions exceed the IRS limit."""
    import datetime
    page = app_page
    _add_retirement_account(page, name="Over 401k", subtype="401k")
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    current_year = datetime.date.today().year
    # Exceed the $23,500 limit (2025/2026 limit).
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '{current_year}-12-01', 50000, 25000)")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    badge = page.query_selector('.retire-limit-badge--over')
    assert badge is not None, "Over-limit badge should appear when YTD exceeds IRS limit"
    assert_no_errors(page)


@pytest.mark.feature
def test_catch_up_toggle_increases_displayed_limit(app_page):
    """Checking 'Catch-up (50+)' switches the limit to the catch-up amount."""
    import datetime
    page = app_page
    _add_retirement_account(page, name="CatchUp 401k", subtype="401k")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    # Base limit before toggle.
    before = page.text_content('.retire-limit-label')
    # Toggle catch-up checkbox.
    page.check('input[data-retire-action="toggle-catchup"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    after = page.text_content('.retire-limit-label')
    assert before != after, "Displayed limit should change after toggling catch-up"
    assert_no_errors(page)


@pytest.mark.feature
def test_hsa_family_selector_changes_limit(app_page):
    """Switching HSA coverage to 'Family' shows the higher family limit."""
    import datetime
    page = app_page
    _add_retirement_account(page, name="HSA Test", subtype="HSA")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    before = page.text_content('.retire-limit-label')
    page.select_option('select[data-retire-action="set-hsa-coverage"]', 'family')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    after = page.text_content('.retire-limit-label')
    assert before != after, "Displayed limit should change after switching to family coverage"
    assert_no_errors(page)


@pytest.mark.feature
def test_pension_card_has_no_limit_section(app_page):
    """Pension account cards do not show a contribution limit section (no statutory limit)."""
    page = app_page
    # Inject a Pension account directly (UI helper fills rate/match fields hidden for Pension).
    page.evaluate("""() => {
        window.app.accounts.push({
            id: 9901, name: 'My Pension', type: 'Retirement', retirementSubtype: 'Pension',
            startingBalance: 0, interestRate: 0, rateOfReturn: 0, employerMatchPercent: 0,
            pensionAnnualSalary: 60000, pensionContributionRatePct: 5,
            pensionVestingYears: 5, pensionEstimatedMonthlyBenefit: 2000,
            pensionYearsOfService: 10, minimumPayment: 0,
            catchUpEligible: false, hsaCoverageType: 'selfOnly', archived: false
        });
        window.app.saveToStorage();
    }""")
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    assert not page.is_visible('.retire-limit-section'), "Pension cards should not show limit section"
    assert_no_errors(page)


@pytest.mark.feature
def test_catchup_eligible_persists_after_reload(app_page):
    """Setting catch-up eligible on an account persists through a page reload."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    page.check('input[data-retire-action="toggle-catchup"]')
    page.wait_for_selector('.retire-limit-section', timeout=5000)
    # Verify the flag is saved.
    catch_up = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').catchUpEligible")
    assert catch_up is True
    page.reload(wait_until="networkidle")
    catch_up_after = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').catchUpEligible")
    assert catch_up_after is True, "catchUpEligible should persist after reload"
    assert_no_errors(page)


# ── i18n coverage tests (issue #336) ─────────────────────────────────────────

@pytest.mark.feature
def test_retirement_page_no_raw_i18n_keys_rendered(app_page):
    """No raw retirement.* i18n key names appear in the rendered page."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    page.wait_for_timeout(400)

    text = page.text_content('#retirementSection')
    import re
    raw_keys = re.findall(r'retirement\.\w+', text)
    assert not raw_keys, f"Raw i18n keys found in rendered retirement page: {raw_keys}"


@pytest.mark.feature
def test_retirement_page_title_rendered(app_page):
    """The retirement page heading contains the translated 'Retirement' text."""
    page = app_page
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    page.wait_for_timeout(400)

    heading = page.query_selector('#retirementSection h2')
    assert heading, "Expected an h2 heading on the retirement page"
    text = heading.text_content()
    assert 'Retirement' in text, f"Expected 'Retirement' in heading, got: '{text}'"


@pytest.mark.feature
def test_retirement_target_date_label_rendered(app_page):
    """The 'Target Retirement Date' label is visible (not a raw key)."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    page.wait_for_timeout(400)

    label = page.query_selector('label[for="retirementTargetDateInput"]')
    assert label, "Expected label for #retirementTargetDateInput"
    text = label.text_content()
    assert 'retirement.' not in text.lower(), f"Raw key in label: '{text}'"
    assert len(text.strip()) > 3, f"Label text seems too short: '{text}'"


@pytest.mark.feature
def test_retirement_balance_chart_title_rendered(app_page):
    """'Balance Over Time' chart title text is rendered (not a raw key)."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    page.wait_for_timeout(400)

    text = page.text_content('#retirementSection')
    assert 'Balance Over Time' in text, (
        f"Expected 'Balance Over Time' in retirement section, got snippet: {text[:300]}"
    )
    assert 'retirement.balanceChartTitle' not in text


@pytest.mark.feature
def test_retirement_add_snapshot_button_text_rendered(app_page):
    """The '+ Add Snapshot' button shows translated text, not a raw key."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    page.wait_for_timeout(400)

    btn = page.query_selector('button[data-retire-action="add-snapshot"]')
    assert btn, "Expected add-snapshot button"
    text = btn.text_content()
    assert 'retirement.' not in text, f"Raw i18n key in button: '{text}'"
    assert 'Snapshot' in text or 'snapshot' in text.lower(), (
        f"Expected 'Snapshot' text in button, got: '{text}'"
    )


@pytest.mark.feature
def test_retirement_projection_text_not_raw_key(app_page):
    """No-target-date message is a real sentence, not the raw key."""
    page = app_page
    _add_retirement_account(page)
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    page.wait_for_timeout(400)

    panel = page.query_selector('#retireProjectionPanel')
    assert panel, "Expected #retireProjectionPanel"
    text = panel.text_content()
    assert 'retirement.noTargetDateMsg' not in text, f"Raw i18n key in projection panel: '{text}'"
    assert len(text.strip()) > 0, "Projection panel should not be empty"


@pytest.mark.feature
def test_retirement_empty_state_no_raw_keys(app_page):
    """Empty-state message (no retirement accounts) uses translated text."""
    page = app_page
    page.click('button[data-page="retirement"]')
    page.wait_for_selector('#retirementSection.active', timeout=5000)
    page.wait_for_timeout(400)

    text = page.text_content('#retirementSection')
    import re
    raw_keys = re.findall(r'retirement\.\w+', text)
    assert not raw_keys, f"Raw keys in empty-state retirement page: {raw_keys}"
    assert 'No retirement accounts' in text or 'retirement' in text.lower(), (
        "Expected meaningful empty-state text"
    )
