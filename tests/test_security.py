#!/usr/bin/env python3
"""
Security Test Suite for MyFinances
Tests for XSS, input validation, and data sanitization vulnerabilities
"""

from playwright.async_api import async_playwright
import asyncio

async def test_xss_protection():
    """Test XSS vulnerability prevention"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        try:
            await page.goto('http://localhost:5500', timeout=10000)
            await page.wait_for_load_state('networkidle', timeout=5000)
            
            print("=== XSS Protection Tests ===\n")
            
            # Test 1: Account name with HTML/script tags
            print("Test 1: XSS in account name")
            await page.fill('#accountName', '<script>alert("xss")</script>')
            await page.select_option('#accountType', 'Checking')
            await page.fill('#accountStartingBalance', '1000')
            await page.click('button:has-text("Add Account")')
            await page.wait_for_timeout(500)
            
            # Check if script was rendered as text (escaped)
            account_text = await page.evaluate("""
                () => document.querySelector('.acct-card-name')?.textContent
            """)
            assert account_text and '<script>' not in account_text, "Script tag was not escaped!"
            assert 'script' in account_text.lower() or '<' not in account_text, "XSS attempt detected as unescaped"
            print(f"✓ Account name sanitized: {account_text}\n")
            
            # Test 2: Income name with HTML
            print("Test 2: XSS in income name")
            await page.click('button[data-page="income"]')
            await page.wait_for_timeout(300)
            
            await page.fill('#incomeName', '<img src=x onerror="alert(\'xss\')">')
            await page.fill('#incomeAmount', '5000')
            await page.fill('#incomeFirstDate', '2025-01-01')
            await page.select_option('#incomeAccount', '')
            await page.select_option('#incomeFrequency', 'monthly')
            await page.click('button[type="submit"]:has-text("Add Income")')
            await page.wait_for_timeout(500)
            
            income_text = await page.evaluate("""
                () => {
                    const cards = document.querySelectorAll('.income-card-name');
                    return cards.length > 0 ? cards[0].textContent : '';
                }
            """)
            assert '<img' not in income_text, "IMG tag was not escaped!"
            print(f"✓ Income name sanitized: {income_text}\n")
            
            # Test 3: Check for console errors
            console_errors = []
            page.on('console', lambda msg: (
                console_errors.append(msg.text) if msg.type == 'error' else None
            ))
            
            print("Test 3: No console errors")
            await page.wait_for_timeout(1000)
            if console_errors:
                print(f"✗ Console errors found: {console_errors}")
            else:
                print("✓ No console errors\n")
            
            # Test 4: Import with malicious JSON
            print("Test 4: Malicious data in JSON import")
            malicious_json = """{
                "debts": [{
                    "id": 1,
                    "name": "<script>alert('xss')</script>",
                    "accountBalance": 5000,
                    "minimumPayment": 100,
                    "interestRate": 18.5,
                    "debtType": "creditCard",
                    "dueDate": 15
                }],
                "accounts": [{
                    "id": 1,
                    "name": "<img src=x onerror=alert('xss')>",
                    "type": "Credit Card",
                    "startingBalance": 0
                }],
                "monthlySnapshots": [{
                    "date": "<script>2026-05-01</script>",
                    "totalAssets": "10000",
                    "totalLiabilities": "5000",
                    "netWorth": "5000",
                    "debtPaymentMade": "900",
                    "incomeReceived": "2500"
                }],
                "netWorthMilestonesAwarded": [5000, "<img src=x>", 10000]
            }"""
            
            # Create a temporary file for import
            import json
            import tempfile
            import os
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                f.write(malicious_json)
                temp_file = f.name
            
            try:
                # Set up file upload
                await page.click('#importJsonBtn')
                await page.wait_for_timeout(300)
                
                # Upload file
                file_input = await page.query_selector('#importJsonInput')
                if file_input:
                    await file_input.set_input_files(temp_file)
                    await page.wait_for_timeout(1000)
                    
                    # Check if data was imported safely
                    debts_count = await page.evaluate('() => document.querySelectorAll(".debt-card").length')
                    print(f"✓ Imported {debts_count} debt(s) safely\n")

                    # Check snapshot fields were sanitized
                    snapshot_sanitized = await page.evaluate("""
                        () => {
                            const raw = localStorage.getItem('debtTrackerData');
                            if (!raw) return false;
                            const parsed = JSON.parse(raw);
                            const snapshots = Array.isArray(parsed.monthlySnapshots) ? parsed.monthlySnapshots : [];
                            const milestones = Array.isArray(parsed.netWorthMilestonesAwarded) ? parsed.netWorthMilestonesAwarded : [];
                            const hasUnsafeDate = snapshots.some(s => typeof s.date === 'string' && s.date.includes('<'));
                            const hasUnsafeMilestone = milestones.some(m => typeof m === 'string');
                            return !hasUnsafeDate && !hasUnsafeMilestone;
                        }
                    """)
                    assert snapshot_sanitized, "Net worth snapshot import sanitization failed"
                    print("✓ Net worth snapshot data sanitized during import\n")

                    # Check snapshot history table is rendered safely in Reports > Net Worth
                    await page.click('button[data-page="reports"]')
                    await page.wait_for_timeout(300)
                    await page.click('button[data-rptab="networth"]')
                    await page.wait_for_timeout(300)
                    await page.click('#captureSnapshotBtn')
                    await page.wait_for_timeout(500)

                    table_present = await page.evaluate("""
                        () => !!document.querySelector('#netWorthHistoryTable')
                    """)
                    assert table_present, "Net worth history table missing in Reports"

                    table_safe = await page.evaluate("""
                        () => {
                            const html = document.querySelector('#netWorthHistoryTable tbody')?.innerHTML || '';
                            return !html.includes('<script') && !html.includes('onerror=');
                        }
                    """)
                    assert table_safe, "Unsafe HTML found in net worth snapshot history table"
                    print("✓ Net worth snapshot history table renders safely\n")
            finally:
                os.unlink(temp_file)
            
            print("=== All XSS Protection Tests Passed ===")
            
        except AssertionError as e:
            print(f"✗ Security test failed: {e}")
            return False
        except Exception as e:
            print(f"✗ Test error: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            await browser.close()
    
    return True


async def test_input_validation():
    """Test input validation and bounds checking"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        try:
            await page.goto('http://localhost:5500', timeout=10000)
            await page.wait_for_load_state('networkidle', timeout=5000)
            
            print("\n=== Input Validation Tests ===\n")
            
            # Test 1: Negative balance
            print("Test 1: Negative account balance")
            await page.fill('#accountName', 'Test Account')
            await page.select_option('#accountType', 'Checking')
            await page.fill('#accountStartingBalance', '-99999')
            await page.click('button:has-text("Add Account")')
            await page.wait_for_timeout(500)
            
            starting_balance = await page.evaluate("""
                () => {
                    const bal = document.querySelector('.acct-balance-value');
                    return bal ? bal.textContent : '';
                }
            """)
            assert starting_balance, "Starting balance not displayed"
            print(f"✓ Negative balance stored (allowed): {starting_balance}\n")
            
            # Test 2: Special characters in names
            print("Test 2: Special characters in input")
            await page.fill('#accountName', "O'Reilly & Associates <Co.>")
            await page.select_option('#accountType', 'Savings')
            await page.fill('#accountStartingBalance', '5000')
            await page.click('button:has-text("Add Account")')
            await page.wait_for_timeout(500)
            
            account_name = await page.evaluate("""
                () => {
                    const names = document.querySelectorAll('.acct-card-name');
                    return names.length > 1 ? names[1].textContent : '';
                }
            """)
            # Should preserve safe special characters but remove dangerous ones
            assert account_name and '&' in account_name, "Special characters not preserved"
            print(f"✓ Special characters handled: {account_name}\n")
            
            print("=== All Input Validation Tests Passed ===")
            
        except Exception as e:
            print(f"✗ Validation test error: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            await browser.close()
    
    return True


async def test_data_persistence():
    """Test that data is properly persisted in localStorage"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        
        try:
            # Create page with persistent context
            page = await browser.new_page()
            await page.goto('http://localhost:5500', timeout=10000)
            await page.wait_for_load_state('networkidle', timeout=5000)
            
            print("\n=== Data Persistence Tests ===\n")
            
            # Add account
            await page.fill('#accountName', 'Persistence Test Account')
            await page.select_option('#accountType', 'Checking')
            await page.fill('#accountStartingBalance', '2500')
            await page.click('button:has-text("Add Account")')
            await page.wait_for_timeout(500)
            
            # Get localStorage data
            stored_data = await page.evaluate('() => localStorage.getItem("debtTrackerData")')
            assert stored_data and 'Persistence Test Account' in stored_data, \
                   "Data not properly stored in localStorage"
            print("✓ Data stored in localStorage\n")
            
            # Verify data is not exposed in console
            console_errors = []
            page.on('console', lambda msg: console_errors.append(f"{msg.type}: {msg.text}"))
            await page.wait_for_timeout(500)
            
            # Check localStorage format is valid JSON
            try:
                import json
                parsed = json.loads(stored_data)
                assert 'debts' in parsed or 'accounts' in parsed or 'incomes' in parsed, \
                       "Invalid localStorage format"
                print("✓ localStorage data is valid JSON\n")

                # New schema fields should exist for net worth tracking
                assert 'monthlySnapshots' in parsed, "monthlySnapshots missing from localStorage"
                assert 'netWorthMilestonesAwarded' in parsed, "netWorthMilestonesAwarded missing from localStorage"
                print("✓ Net worth storage fields present\n")
            except json.JSONDecodeError:
                raise AssertionError("localStorage contains invalid JSON")
            
            # Test export functionality
            print("Test 3: Export/Import functionality")
            export_btn = await page.query_selector('#exportJsonBtn')
            assert export_btn is not None, "Export button not found"
            print("✓ Export button is available\n")
            
            import_btn = await page.query_selector('#importJsonBtn')
            assert import_btn is not None, "Import button not found"
            print("✓ Import button is available\n")
            
            await page.close()
            
            print("=== All Data Persistence Tests Passed ===")
            
        except Exception as e:
            print(f"✗ Persistence test error: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            await browser.close()
    
    return True


async def main():
    print("=" * 60)
    print("MYFINANCES SECURITY TEST SUITE")
    print("=" * 60 + "\n")
    
    results = []
    
    # Run tests
    results.append(("XSS Protection", await test_xss_protection()))
    results.append(("Input Validation", await test_input_validation()))
    results.append(("Data Persistence", await test_data_persistence()))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    for test_name, passed in results:
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{test_name}: {status}")
    
    all_passed = all(passed for _, passed in results)
    print("\n" + ("All tests passed! ✓" if all_passed else "Some tests failed! ✗"))
    print("=" * 60)


if __name__ == '__main__':
    asyncio.run(main())
