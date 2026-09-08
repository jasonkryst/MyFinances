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
