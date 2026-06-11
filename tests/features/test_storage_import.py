#!/usr/bin/env python3
"""
Storage Import Sanitization Tests
Tests importAllJSON (src/storage.js) against malformed and adversarial
JSON payloads: invalid JSON, oversized files, XSS/out-of-range field
values, bare-array payloads, and payloads with no recognizable data.

Calls importAllJSON directly via dynamic import of src/storage.js so
custom callbacks can be observed without going through the app.js
wrapper, which hardcodes alert()/confirm()-based callbacks.
"""

import pytest


@pytest.mark.feature
def test_import_malformed_json_triggers_invalid_callback(app_page):
    """Malformed JSON triggers onInvalidJSON and leaves existing data untouched."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Existing', type: 'Checking', startingBalance: 100 }];
    }""")

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const file = new File(['{ this is not valid json'], 'bad.json', { type: 'application/json' });
        return new Promise(resolve => {
            let invalidCalled = false;
            mod.importAllJSON(app, file, { onInvalidJSON: () => { invalidCalled = true; } });
            setTimeout(() => resolve({
                invalidCalled,
                accountsLen: app.accounts.length,
                accountName: app.accounts[0]?.name
            }), 300);
        });
    }""")

    assert result['invalidCalled'], "Expected onInvalidJSON callback for malformed JSON"
    assert result['accountsLen'] == 1
    assert result['accountName'] == 'Existing', "Existing data should be untouched on invalid JSON"


@pytest.mark.feature
def test_import_sanitizes_adversarial_account_and_debt_fields(app_page):
    """XSS payloads and out-of-range numeric fields are sanitized on import."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            accounts: [{
                id: 'not-a-number', name: '<script>alert(1)</script>Checking',
                type: 'Checking', startingBalance: 'NaN'
            }],
            debts: [{
                id: 'abc', name: '<img src=x onerror=alert(1)>Visa', debtType: 'creditCard',
                accountBalance: -500, interestRate: 99999, minimumPayment: -50,
                dueDate: 999, accountId: 'abc'
            }]
        };
        const file = new File([JSON.stringify(payload)], 'adversarial.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({
                account: app.accounts[0],
                debt: app.debts[0]
            }), 300);
        });
    }""")

    account = result['account']
    debt = result['debt']

    assert '<' not in account['name'] and '>' not in account['name'], \
        "Account name should have unsafe characters stripped"
    assert account['startingBalance'] == 0, "Non-numeric startingBalance should fall back to 0"
    assert isinstance(account['id'], int), "Account id should be sanitized to an integer"

    assert '<' not in debt['name'] and '>' not in debt['name'], \
        "Debt name should have unsafe characters stripped"
    assert debt['accountBalance'] == 0, "Negative accountBalance should clamp to 0"
    assert debt['interestRate'] == 100, "interestRate should clamp to max 100"
    assert debt['minimumPayment'] == 0, "Negative minimumPayment should clamp to 0"
    assert debt['dueDate'] == 31, "dueDate should clamp to max 31"
    assert isinstance(debt['id'], int), "Debt id should be sanitized to an integer"


@pytest.mark.feature
def test_import_bare_array_payload_treated_as_debts(app_page):
    """A bare JSON array payload is treated as a list of debts."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.debts = [];
    }""")

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = [
            { id: 1, name: 'Array Debt', debtType: 'creditCard',
              accountBalance: 1000, interestRate: 10, minimumPayment: 25, dueDate: 5 }
        ];
        const file = new File([JSON.stringify(payload)], 'array.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({
                debtCount: app.debts.length,
                debtName: app.debts[0]?.name
            }), 300);
        });
    }""")

    assert result['debtCount'] == 1, "Expected the bare array to be imported as one debt"
    assert result['debtName'] == 'Array Debt'


@pytest.mark.feature
def test_import_empty_payload_triggers_no_data_callback(app_page):
    """A JSON payload with no recognizable fields triggers onNoData and changes nothing."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Existing', type: 'Checking', startingBalance: 100 }];
        app.debts = [];
    }""")

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = { foo: 'bar', randomField: 123 };
        const file = new File([JSON.stringify(payload)], 'empty.json', { type: 'application/json' });
        return new Promise(resolve => {
            let noDataCalled = false;
            mod.importAllJSON(app, file, { onNoData: () => { noDataCalled = true; } });
            setTimeout(() => resolve({
                noDataCalled,
                accountName: app.accounts[0]?.name
            }), 300);
        });
    }""")

    assert result['noDataCalled'], "Expected onNoData callback for a payload with no recognizable data"
    assert result['accountName'] == 'Existing', "Existing data should be untouched"


@pytest.mark.feature
def test_import_oversized_file_triggers_too_large_callback(app_page):
    """Files larger than the 2MB import limit trigger onTooLarge and are not parsed."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const bigArray = new Array(200000).fill({
            id: 1, name: 'Pad', debtType: 'creditCard',
            accountBalance: 1, interestRate: 1, minimumPayment: 1, dueDate: 1
        });
        const payload = JSON.stringify({ debts: bigArray });
        const file = new File([payload], 'big.json', { type: 'application/json' });
        return new Promise(resolve => {
            let tooLargeCalled = false;
            mod.importAllJSON(app, file, { onTooLarge: () => { tooLargeCalled = true; } });
            setTimeout(() => resolve({ tooLargeCalled, fileSize: file.size }), 300);
        });
    }""")

    assert result['fileSize'] > 2 * 1024 * 1024, f"Test file should exceed 2MB, got {result['fileSize']}"
    assert result['tooLargeCalled'], "Expected onTooLarge callback for files exceeding the 2MB limit"
