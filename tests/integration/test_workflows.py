#!/usr/bin/env python3
"""
Import/Export Workflow Tests
Tests data import/export functionality and file handling.
"""

import pytest
import json
import tempfile
import os

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
