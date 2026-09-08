#!/usr/bin/env python3
"""
Retirement Accounts Dashboard tests (issue: retirement accounts + charts).
Covers the account type/fields, snapshot logging, charts, projection, and
export/import round-trip for the local/session storage backends.
"""

import json
import pytest

from tests.conftest import assert_no_errors


def _add_retirement_account(page, name="401k Test", rate="7", match="50"):
    page.click('button[data-page="accounts"]')
    page.fill('#accountName', name)
    page.select_option('#accountType', 'Retirement')
    page.fill('#accountStartingBalance', '10000')
    page.fill('#accountRateOfReturn', rate)
    page.fill('#accountEmployerMatch', match)
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

    page.wait_for_timeout(300)
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
    page.wait_for_timeout(300)
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
    page.wait_for_timeout(300)

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


@pytest.mark.feature
def test_reload_persists_retirement_data(app_page):
    """Retirement account, snapshot, and target date survive a page reload (localStorage)."""
    page = app_page
    _add_retirement_account(page)
    account_id = page.evaluate("() => window.app.accounts.find(a => a.type === 'Retirement').id")
    page.evaluate(f"() => window.app.addRetirementSnapshot({account_id}, '2026-01-01', 10000, 300)")
    page.evaluate("() => { window.app.retirementTargetDate = '2050-01-01'; window.app.saveToStorage(); }")

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(500)
    snapshots = page.evaluate("() => window.app.retirementSnapshots")
    target = page.evaluate("() => window.app.retirementTargetDate")
    assert len(snapshots) == 1
    assert target == "2050-01-01"
    assert_no_errors(page)
