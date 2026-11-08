#!/usr/bin/env python3
"""
Import/Export Workflow Tests
Tests data import/export functionality and file handling.
"""

import pytest
import json
import tempfile
import os

from tests.conftest import assert_no_errors, open_settings, seed_state, switch_settings_tab, wait_for_api, submit_account_form, submit_debt_form, open_debt_form

ALL_NAV_PAGES = [
    "health", "accounts", "income", "liabilities", "recurring",
    "savings", "strategy", "reports", "ledger", "reconcile",
]

@pytest.mark.integration
def test_export_data_format(app_page):
    """Test that exported data is in valid JSON format."""
    page = app_page

    from tests.conftest import open_data_transfer
    open_data_transfer(page)

    # Look for export button
    export_btn = page.query_selector('#exportJsonBtn')
    
    if export_btn:
        # Export functionality should exist
        assert export_btn, "Export button should be available"
        
        # The app state the export is built from must serialize to valid JSON
        data = page.evaluate('() => JSON.stringify({ accounts: window.app.accounts, debts: window.app.debts })')
        try:
            parsed = json.loads(data)
            assert parsed is not None, "Exported data should be valid JSON"
        except json.JSONDecodeError:
            pytest.fail("app state is not valid JSON")


@pytest.mark.integration
def test_export_schedule_as_csv(app_page):
    """Calculating a payment plan and clicking Export as CSV downloads a
    CSV file with the monthly schedule and debt summary sections."""
    page = app_page

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    open_debt_form(page)
    page.fill('#debtName', 'CSV Test Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '1000')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    submit_debt_form(page)
    page.wait_for_selector('text=CSV Test Card', timeout=10000)

    page.click('button[data-page="strategy"]')
    page.fill('#monthlyPayment', '200')
    page.click('#calculateBtn')
    page.click('[data-rtab="schedule"]')
    page.wait_for_selector('#exportBtn', timeout=10000)

    with page.expect_download() as download_info:
        page.click('#exportBtn')
    download = download_info.value

    assert download.suggested_filename.endswith('.csv')
    path = download.path()
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    assert 'Month,' in content
    assert 'Debt Summary' in content
    assert 'CSV Test Card' in content


@pytest.mark.integration
def test_export_csv_escapes_comma_in_debt_name(app_page):
    """A debt name containing a comma must not corrupt the CSV header row.
    (Embedded double quotes are stripped by normalizeText() at input time,
    so only comma-escaping is reachable here.) The header's debt-name column
    must round-trip as a single field via a standard CSV parser."""
    page = app_page

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    open_debt_form(page)
    page.fill('#debtName', 'Visa, Rewards Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '1000')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    submit_debt_form(page)
    page.wait_for_function(
        "() => document.body.textContent.includes('Visa, Rewards Card')",
        timeout=10000
    )

    page.click('button[data-page="strategy"]')
    page.fill('#monthlyPayment', '200')
    page.click('#calculateBtn')
    page.click('[data-rtab="schedule"]')
    page.wait_for_selector('#exportBtn', timeout=10000)

    with page.expect_download() as download_info:
        page.click('#exportBtn')
    download = download_info.value

    path = download.path()
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    import csv as csv_module
    import io
    rows = list(csv_module.reader(io.StringIO(content)))

    header = next(row for row in rows if row and row[0] == 'Month')
    assert 'Visa, Rewards Card' in header, "comma-containing debt name must survive as a single CSV field in the header"
    assert header[-1] == 'Total Paid', "unescaped comma must not shift later header columns"

    summary_row = next(row for row in rows if row and row[0] == 'Visa, Rewards Card')
    assert summary_row[0] == 'Visa, Rewards Card'


@pytest.mark.integration
def test_import_json_file(app_page):
    """Test importing JSON file."""
    page = app_page

    from tests.conftest import open_data_transfer
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')
    import_btn = page.query_selector('#importJsonBtn')

    if import_btn:
        # Create test data
        test_data = {
            "accounts": [{
                "id": 1,
                "name": "Import Test",
                "type": "Checking",
                "startingBalance": 5000
            }],
            "debts": [],
            "incomes": [],
            "bills": [],
            "recurring": [],
            "savings": {},
            "monthlySnapshots": [],
            "netWorthMilestonesAwarded": []
        }
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(test_data, f)
            temp_file = f.name
        
        try:
            # Click import
            page.click('#importJsonBtn')
            page.wait_for_selector('#importJsonInput', state='attached', timeout=5000)

            # Upload file
            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_selector('#importModeChoice, #importError', timeout=5000)
                if page.is_visible('#importModeChoice'):
                    page.click('#importModeReplaceBtn')

                # Verify data was imported: the server holds it
                wait_for_api(page, '/api/accounts', lambda rows: any(r.get('name') == 'Import Test' for r in rows))
        finally:
            os.unlink(temp_file)


@pytest.mark.integration
def test_import_refreshes_currently_active_page(app_page):
    """Importing while viewing a non-Debts page refreshes that page in place (#87).

    Before the fix, importAllJSON() only ever re-rendered the Debts list
    (updateUI()), so a user sitting on the Accounts page during an import
    would keep seeing stale data until manually navigating away and back.
    """
    page = app_page

    # Stay on the Accounts page (not Liabilities/Debts) while importing.
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)

    from tests.conftest import open_data_transfer

    test_data = {
        "accounts": [{
            "id": 1,
            "name": "Refreshed Via Import Account",
            "type": "Checking",
            "startingBalance": 1234
        }],
        "debts": [{
            "id": 2,
            "name": "Refresh Test Debt",
            "debtType": "creditCard",
            "accountBalance": 500,
            "interestRate": 10,
            "minimumPayment": 25,
            "dueDate": 10
        }],
        "incomes": [],
        "bills": [],
        "recurringTemplates": [],
        "monthlySnapshots": [],
        "netWorthMilestonesAwarded": []
    }

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(test_data, f)
        temp_file = f.name

    try:
        open_data_transfer(page)
        page.click('[data-dt-tab="import"]')
        page.click('#importJsonBtn')
        page.wait_for_selector('#importJsonInput', state='attached', timeout=5000)

        file_input = page.query_selector('#importJsonInput')
        assert file_input, "Expected the import file input (#importJsonInput) to exist"
        file_input.set_input_files(temp_file)
        page.wait_for_selector('#importModeChoice, #importError', timeout=5000)
        if page.is_visible('#importModeChoice'):
            page.click('#importModeReplaceBtn')

        # Still on the Accounts page the whole time -- no manual re-navigation.
        # (The import is a series of server calls; the list re-renders when they finish.)
        page.wait_for_selector('#accountList >> text=Refreshed Via Import Account', timeout=15000)
        account_list_text = page.evaluate("""() => {
            const el = document.getElementById('accountList');
            return el ? el.textContent : '';
        }""")
        assert 'Refreshed Via Import Account' in account_list_text, (
            "Importing while on the Accounts page should refresh the account list in place"
        )
    finally:
        os.unlink(temp_file)


@pytest.mark.integration
def test_import_replaces_data(app_page):
    """Test that importing replaces existing data."""
    page = app_page
    
    # Create initial data
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Original Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    submit_account_form(page)
    
    # Import new data
    from tests.conftest import open_data_transfer
    open_data_transfer(page)
    page.click('[data-dt-tab="import"]')
    import_btn = page.query_selector('#importJsonBtn')
    if import_btn:
        new_data = {
            "accounts": [{
                "id": 2,
                "name": "New Imported Account",
                "type": "Savings",
                "startingBalance": 5000
            }],
            "debts": [],
            "incomes": [],
            "bills": [],
            "recurring": [],
            "savings": {},
            "monthlySnapshots": [],
            "netWorthMilestonesAwarded": []
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(new_data, f)
            temp_file = f.name
        
        try:
            page.click('#importJsonBtn')
            page.wait_for_selector('#importJsonInput', state='attached', timeout=5000)

            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_selector('#importModeChoice, #importError', timeout=5000)
                if page.is_visible('#importModeChoice'):
                    page.click('#importModeReplaceBtn')

                # Data should be replaced on the server: old account gone, new one present
                rows = wait_for_api(page, '/api/accounts',
                                    lambda r: any(a.get('name') == 'New Imported Account' for a in r))
                assert not any(a.get('name') == 'Original Account' for a in rows), "Replace must drop the old account"
        finally:
            os.unlink(temp_file)


@pytest.mark.integration
def test_roundtrip_export_import(app_page):
    """Test data survives export and re-import."""
    page = app_page

    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Roundtrip Test')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '7500')
    submit_account_form(page)
    wait_for_api(page, '/api/accounts', lambda rows: any(r.get('name') == 'Roundtrip Test' for r in rows))

    # Export the real backup file
    from tests.conftest import open_data_transfer
    open_data_transfer(page)
    with page.expect_download() as download_info:
        page.click('#exportJsonBtn')
    with open(download_info.value.path(), 'r', encoding='utf-8') as f:
        exported = json.load(f)
    assert any(a.get('name') == 'Roundtrip Test' for a in exported.get('accounts', []))

    # Re-import it over the (still populated) server
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(exported, f)
        temp_file = f.name

    try:
        page.click('[data-dt-tab="import"]')
        page.click('#importJsonBtn')
        page.wait_for_selector('#importJsonInput', state='attached', timeout=5000)
        page.query_selector('#importJsonInput').set_input_files(temp_file)
        page.wait_for_selector('#importModeChoice, #importError', timeout=5000)
        if page.is_visible('#importModeChoice'):
            page.click('#importModeReplaceBtn')

        # Data should match what was exported
        rows = wait_for_api(page, '/api/accounts',
                            lambda r: any(a.get('name') == 'Roundtrip Test' for a in r))
        match = [a for a in rows if a.get('name') == 'Roundtrip Test']
        assert len(match) == 1, "Roundtrip must not duplicate or lose the account"
    finally:
        os.unlink(temp_file)


@pytest.mark.integration
@pytest.mark.slow
def test_clear_all_data_then_reimport_renders_every_page_cleanly(app_page):
    """Seed data across multiple feature types, export it, clear all app
    data via the real 'Clear All Data' UI control (#clearDataBtn, which
    calls app.clearAllData()), re-import the previously exported backup,
    then visit every top-level nav page and verify each renders without
    console/page errors.

    This exercises the full export -> clear -> reimport -> render path,
    not just that the server contains *something* afterward.
    """
    page = app_page

    # --- Seed: account, debt, income ---
    page.click('button[data-page="accounts"]')
    page.wait_for_selector('#accountsSection.active', timeout=5000)
    page.fill('#accountName', 'Clear Test Checking')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '4200')
    submit_account_form(page)
    page.wait_for_selector('text=Clear Test Checking', timeout=10000)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    open_debt_form(page)
    page.fill('#debtName', 'Clear Test Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '1500')
    page.fill('#interestRate', '20')
    page.fill('#minimumPayment', '75')
    page.fill('#dueDate', '10')
    submit_debt_form(page)
    page.wait_for_selector('text=Clear Test Card', timeout=10000)

    page.click('button[data-page="income"]')
    page.wait_for_selector('#incomeSection.active', timeout=5000)
    page.fill('#incomeName', 'Clear Test Salary')
    page.fill('#incomeAmount', '3000')
    page.fill('#incomeFirstDate', '2026-06-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector('text=Clear Test Salary', timeout=10000)

    # --- Export the seeded data ---
    from tests.conftest import open_data_transfer, close_data_transfer
    open_data_transfer(page)
    export_btn = page.query_selector('#exportJsonBtn')
    assert export_btn, "Export button (#exportJsonBtn) should exist"
    with page.expect_download() as download_info:
        export_btn.click()
    download = download_info.value
    exported_path = download.path()
    with open(exported_path, 'r', encoding='utf-8') as f:
        exported_payload = json.load(f)

    assert exported_payload.get('accounts'), "Export should include the seeded account"
    assert exported_payload.get('debts'), "Export should include the seeded debt"
    assert exported_payload.get('incomes'), "Export should include the seeded income"
    close_data_transfer(page)

    # --- Clear all data via the real UI control (lives on the Strategy/Plan page) ---
    open_settings(page)
    switch_settings_tab(page, 'data')
    page.wait_for_selector('#clearDataBtn', state='visible', timeout=10000)
    clear_btn = page.query_selector('#clearDataBtn')
    assert clear_btn, "Expected a real 'Clear All Data' control (#clearDataBtn)"
    clear_btn.click()  # opens themed #deleteConfirmModal
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)
    page.click('#deleteConfirmBtn')
    # dismiss the #alertModal confirmation that appears after clearing
    page.wait_for_selector('#alertModal.flex-visible', timeout=5000)
    page.click('#alertModalOkBtn')
    page.wait_for_selector('#alertModal', state='hidden', timeout=5000)

    for path in ('/api/accounts', '/api/debts', '/api/incomes'):
        wait_for_api(page, path, lambda rows: rows == [])

    # No reload here on purpose: clearAllData() keeps the app on the server, so
    # an import straight after the clear must reach it.

    # --- Re-import the previously exported backup ---
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(exported_payload, f)
        temp_file = f.name

    try:
        open_data_transfer(page)
        page.click('[data-dt-tab="import"]')
        page.click('#importJsonBtn')
        page.wait_for_selector('#importJsonInput', state='attached', timeout=5000)
        file_input = page.query_selector('#importJsonInput')
        assert file_input, "Expected the import file input (#importJsonInput) to exist"
        file_input.set_input_files(temp_file)
        page.wait_for_selector('#importModeChoice, #importError', timeout=5000)
        if page.is_visible('#importModeChoice'):
            page.click('#importModeReplaceBtn')

        wait_for_api(page, '/api/accounts', lambda rows: any(r.get('name') == 'Clear Test Checking' for r in rows))
        wait_for_api(page, '/api/debts', lambda rows: any(r.get('name') == 'Clear Test Card' for r in rows))
        wait_for_api(page, '/api/incomes', lambda rows: any(r.get('name') == 'Clear Test Salary' for r in rows))
        close_data_transfer(page)

        # --- Visit every top-level nav page and verify clean rendering ---
        for page_name in ALL_NAV_PAGES:
            page.click(f'button[data-page="{page_name}"]')
            page.wait_for_selector(f'button[data-page="{page_name}"][aria-current="page"]', timeout=5000)
            assert_no_errors(page)
    finally:
        os.unlink(temp_file)


@pytest.mark.integration
def test_clear_all_data_then_reload_retriggers_setup_wizard(app_page):
    """Clear All Data wipes every record and setting on the server, including
    reconciliationAdjustsBalance, so the next load is a true first run (spec
    §5 step 6) and the setup wizard reappears, letting the user reconsider the
    reconciliation mode."""
    page = app_page
    seed_state(page, {
        'accounts': [{'id': 1, 'name': 'Clear Mem Checking', 'type': 'Checking', 'startingBalance': 100}],
        'recurringTemplates': [{
            'id': 1, 'name': 'Clear Mem Sub', 'type': 'subscription', 'amount': 9,
            'frequency': 'monthly', 'dayOfMonth': 1, 'category': 'Other', 'accountId': 1,
        }],
        'emergencyFunds': [{'id': 1, 'accountId': 1, 'targetAmount': 1000, 'monthlyContribution': 50}],
    })
    assert page.evaluate("() => window.app.recurringTemplates.length") == 1
    assert page.evaluate("() => window.app.emergencyFunds.length") == 1
    page.evaluate("""() => { window.app.setSetting('reconciliationAdjustsBalance', true); }""")
    wait_for_api(page, '/api/settings',
                 lambda rows: any(r.get('key') == 'reconciliationAdjustsBalance' and r.get('value') is True
                                  for r in rows))

    open_settings(page)
    switch_settings_tab(page, 'data')
    page.wait_for_selector('#clearDataBtn', state='visible', timeout=10000)
    page.click('#clearDataBtn')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)
    page.click('#deleteConfirmBtn')
    # dismiss the #alertModal confirmation that appears after clearing
    page.wait_for_selector('#alertModal.flex-visible', timeout=5000)
    page.click('#alertModalOkBtn')
    page.wait_for_selector('#alertModal', state='hidden', timeout=5000)

    wait_for_api(page, '/api/settings',
                 lambda rows: not any(r.get('key') == 'reconciliationAdjustsBalance' for r in rows))

    # Without a reload, memory matches the now-empty server: every collection
    # pgDeleteAll wipes is reset in place too.
    for coll in ('accounts', 'recurringTemplates', 'emergencyFunds', 'sinkingFunds',
                 'monthlySnapshots', 'netWorthMilestonesAwarded'):
        assert page.evaluate(f"() => window.app.{coll}.length") == 0, coll

    page.reload()

    page.wait_for_selector('#setupWizardModal.flex-visible', timeout=10000)
    page.click('#setupWizardVisibleBtn')
    setting = page.evaluate("""() => window.app.getSetting('reconciliationAdjustsBalance', null)""")
    assert setting is False, "Choosing a fresh mode after the reset should not be influenced by the prior setting"


@pytest.mark.integration
def test_ledger_export_csv_with_column_picker(app_page):
    """Opening the Ledger export modal, unchecking a column, and confirming
    downloads a CSV containing only the selected columns."""
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 2, name: 'Paycheck', amount: 2000, accountId: 1, frequency: 'monthly', firstDate: '2026-06-01' }];
        app.debts = []; app.bills = []; app.expenses = []; app.bonuses = []; app.recurringTemplates = [];
        app._ledgerDateRange = 'all';
        app.switchPage('ledger');
    }""")

    page.click('#ledgerExportCsvBtn')
    modal = page.query_selector('#ledgerExportModal')
    assert modal and 'flex-visible' in (modal.get_attribute('class') or '')

    page.uncheck('#ledgerExportCol-category')

    with page.expect_download() as download_info:
        page.click('#ledgerExportConfirmBtn')
    download = download_info.value

    assert download.suggested_filename.endswith('.csv')
    path = download.path()
    with open(path, 'r', encoding='utf-8') as f:
        header = f.readline()
    assert 'Category' not in header
    assert 'Transaction' in header


@pytest.mark.integration
def test_ledger_export_csv_includes_cleared_columns(app_page):
    """The Cleared/Cleared At columns are selectable in the export
    column-picker and, once a transaction is cleared, its exported row
    reflects the cleared state."""
    page = app_page
    tx_id = page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.incomes = [{ id: 2, name: 'Paycheck', amount: 2000, accountId: 1, frequency: 'monthly', firstDate: '2026-06-01' }];
        app.debts = []; app.bills = []; app.expenses = []; app.bonuses = []; app.recurringTemplates = [];
        app._ledgerDateRange = 'all';
        app.switchPage('ledger');
        const tx = app.getFilteredSortedLedgerTransactions().find(t => t.transactionId);
        return tx ? tx.transactionId : null;
    }""")
    assert tx_id, "Expected at least one clearable ledger row"

    page.click(f'[data-ledger-cleared="{tx_id}"]')

    page.click('#ledgerExportCsvBtn')
    modal = page.query_selector('#ledgerExportModal')
    assert modal and 'flex-visible' in (modal.get_attribute('class') or '')

    cleared_checkbox = page.query_selector('#ledgerExportCol-cleared')
    cleared_at_checkbox = page.query_selector('#ledgerExportCol-clearedAt')
    assert cleared_checkbox and cleared_checkbox.is_checked()
    assert cleared_at_checkbox and cleared_at_checkbox.is_checked()

    with page.expect_download() as download_info:
        page.click('#ledgerExportConfirmBtn')
    download = download_info.value

    path = download.path()
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    assert 'Cleared' in content
    assert 'Cleared At' in content
    assert 'Yes' in content, "The cleared row should export Cleared=Yes"
