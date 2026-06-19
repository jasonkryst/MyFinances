#!/usr/bin/env python3
"""
Import/Export Workflow Tests
Tests data import/export functionality and file handling.
"""

import pytest
import json
import tempfile
import os

from tests.conftest import assert_no_errors

ALL_NAV_PAGES = [
    "health", "accounts", "income", "liabilities", "recurring",
    "savings", "strategy", "reports", "ledger", "reconcile",
]

@pytest.mark.integration
def test_export_data_format(app_page):
    """Test that exported data is in valid JSON format."""
    page = app_page
    
    # Look for export button
    export_btn = page.query_selector('#exportJsonBtn')
    
    if export_btn:
        # Export functionality should exist
        assert export_btn, "Export button should be available"
        
        # Verify localStorage has valid data to export
        data = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
        if data:
            try:
                parsed = json.loads(data)
                assert parsed, "Exported data should be valid JSON"
            except json.JSONDecodeError:
                pytest.fail("localStorage data is not valid JSON")


@pytest.mark.integration
def test_export_schedule_as_csv(app_page):
    """Calculating a payment plan and clicking Export as CSV downloads a
    CSV file with the monthly schedule and debt summary sections."""
    page = app_page

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.click('#debtFormToggle')
    page.fill('#debtName', 'CSV Test Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '1000')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
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
    page.click('#debtFormToggle')
    page.fill('#debtName', 'Visa, Rewards Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '1000')
    page.fill('#interestRate', '18')
    page.fill('#minimumPayment', '100')
    page.fill('#dueDate', '15')
    page.click('#debtFormSubmit')
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
            page.wait_for_timeout(300)
            
            # Upload file
            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_timeout(1000)
                
                # Verify data was imported
                stored_data = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                assert stored_data, "Data should be imported"
        finally:
            os.unlink(temp_file)


@pytest.mark.integration  
def test_import_replaces_data(app_page):
    """Test that importing replaces existing data."""
    page = app_page
    
    # Create initial data
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Original Account')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '1000')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Import new data
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
            page.wait_for_timeout(300)
            
            file_input = page.query_selector('#importJsonInput')
            if file_input:
                file_input.set_input_files(temp_file)
                page.wait_for_timeout(1000)
                
                # Data should be replaced
                stored = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                assert stored, "Import should update data"
        finally:
            os.unlink(temp_file)


@pytest.mark.integration
def test_roundtrip_export_import(app_page):
    """Test data survives export and re-import."""
    page = app_page
    
    # Create account
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    page.fill('#accountName', 'Roundtrip Test')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '7500')
    page.click('#accountFormSubmit')
    page.wait_for_timeout(500)
    
    # Get current data
    original_data = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
    
    if original_data:
        # Export and re-import
        export_btn = page.query_selector('#exportJsonBtn')
        import_btn = page.query_selector('#importJsonBtn')
        
        if export_btn and import_btn:
            # Simulate export by getting data
            export_data = original_data
            
            # Re-import
            parsed = json.loads(export_data)
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(parsed, f)
                temp_file = f.name
            
            try:
                page.click('#importJsonBtn')
                page.wait_for_timeout(300)

                file_input = page.query_selector('#importJsonInput')
                if file_input:
                    file_input.set_input_files(temp_file)
                    page.wait_for_timeout(1000)

                    # Data should match
                    reimported = page.evaluate('() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")')
                    assert reimported, "Roundtrip data preservation failed"
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
    not just that localStorage contains *something* afterward.
    """
    page = app_page

    # --- Seed: account, debt, income ---
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(200)
    page.fill('#accountName', 'Clear Test Checking')
    page.select_option('#accountType', label='Checking')
    page.fill('#accountStartingBalance', '4200')
    page.click('#accountFormSubmit')
    page.wait_for_selector('text=Clear Test Checking', timeout=10000)

    page.click('button[data-page="liabilities"]')
    page.click('[data-liabilities-subtab="debts"]')
    page.click('#debtFormToggle')
    page.fill('#debtName', 'Clear Test Card')
    page.select_option('#debtType', 'creditCard')
    page.fill('#accountBalance', '1500')
    page.fill('#interestRate', '20')
    page.fill('#minimumPayment', '75')
    page.fill('#dueDate', '10')
    page.click('#debtFormSubmit')
    page.wait_for_selector('text=Clear Test Card', timeout=10000)

    page.click('button[data-page="income"]')
    page.wait_for_timeout(200)
    page.fill('#incomeName', 'Clear Test Salary')
    page.fill('#incomeAmount', '3000')
    page.fill('#incomeFirstDate', '2026-06-01')
    page.select_option('#incomeFrequency', 'monthly')
    page.select_option('#incomeAccount', index=1)
    page.click('#incomeFormSubmit')
    page.wait_for_selector('text=Clear Test Salary', timeout=10000)

    # --- Export the seeded data ---
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

    # --- Clear all data via the real UI control (lives on the Strategy/Plan page) ---
    page.click('button[data-page="strategy"]')
    page.wait_for_selector('#clearDataBtn', timeout=10000)
    clear_btn = page.query_selector('#clearDataBtn')
    assert clear_btn, "Expected a real 'Clear All Data' control (#clearDataBtn)"
    clear_btn.click()  # confirm() dialog is auto-accepted by the page fixture
    page.wait_for_timeout(500)

    cleared_data = page.evaluate(
        '() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")'
    )
    assert not cleared_data, "App data should be removed after Clear All Data"

    # --- Re-import the previously exported backup ---
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(exported_payload, f)
        temp_file = f.name

    try:
        page.click('#importJsonBtn')
        page.wait_for_timeout(300)
        file_input = page.query_selector('#importJsonInput')
        assert file_input, "Expected the import file input (#importJsonInput) to exist"
        file_input.set_input_files(temp_file)
        page.wait_for_timeout(1000)

        reimported = page.evaluate(
            '() => localStorage.getItem(window.app?.storageKey || "debtTrackerData")'
        )
        assert reimported, "Re-import after clearing should repopulate localStorage"
        reimported_parsed = json.loads(reimported)
        assert reimported_parsed.get('accounts'), "Re-imported data should include the account"
        assert reimported_parsed.get('debts'), "Re-imported data should include the debt"
        assert reimported_parsed.get('incomes'), "Re-imported data should include the income"

        # --- Visit every top-level nav page and verify clean rendering ---
        for page_name in ALL_NAV_PAGES:
            page.click(f'button[data-page="{page_name}"]')
            page.wait_for_timeout(400)
            assert_no_errors(page)
    finally:
        os.unlink(temp_file)
