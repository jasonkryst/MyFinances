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


# ---------------------------------------------------------------------------
# Direct unit tests of src/utils.js primitive sanitizers
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_utils_sanitize_finite_number(app_page):
    """sanitizeFiniteNumber rejects non-finite/non-numeric input and clamps to min/max."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const { sanitizeFiniteNumber } = mod;
        return {
            nan: sanitizeFiniteNumber(NaN, 42),
            posInf: sanitizeFiniteNumber(Infinity, 42),
            negInf: sanitizeFiniteNumber(-Infinity, 42),
            nonNumericString: sanitizeFiniteNumber('not-a-number', 42),
            clampMin: sanitizeFiniteNumber(-50, 0, { min: 0, max: 100 }),
            clampMax: sanitizeFiniteNumber(500, 0, { min: 0, max: 100 }),
            withinRange: sanitizeFiniteNumber(50, 0, { min: 0, max: 100 }),
            validNumericString: sanitizeFiniteNumber('123.5', 0)
        };
    }""")

    assert result['nan'] == 42, "NaN should fall back to default"
    assert result['posInf'] == 42, "Infinity should fall back to default"
    assert result['negInf'] == 42, "-Infinity should fall back to default"
    assert result['nonNumericString'] == 42, "Non-numeric string should fall back to default"
    assert result['clampMin'] == 0, "Value below min should clamp to min"
    assert result['clampMax'] == 100, "Value above max should clamp to max"
    assert result['withinRange'] == 50, "Value within range should pass through unchanged"
    assert result['validNumericString'] == 123.5, "Numeric string should be coerced to a number"


@pytest.mark.feature
def test_utils_sanitize_integer(app_page):
    """sanitizeInteger rejects non-finite/garbage input, truncates floats, and clamps to min/max."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const { sanitizeInteger } = mod;
        return {
            nan: sanitizeInteger(NaN, 7),
            garbage: sanitizeInteger('not-a-number', 7),
            infinity: sanitizeInteger(Infinity, 7),
            truncatesFloat: sanitizeInteger(5.9, 0),
            truncatesFloatString: sanitizeInteger('5.9', 0),
            clampMin: sanitizeInteger(-10, 0, { min: 1, max: 31 }),
            clampMax: sanitizeInteger(99, 0, { min: 1, max: 31 }),
            withinRange: sanitizeInteger(15, 0, { min: 1, max: 31 }),
            nullFallback: sanitizeInteger(null, null)
        };
    }""")

    assert result['nan'] == 7, "NaN should fall back to default"
    assert result['garbage'] == 7, "Non-numeric garbage should fall back to default"
    assert result['infinity'] == 7, "Infinity should fall back to default (parseInt(Infinity) is NaN)"
    assert result['truncatesFloat'] == 5, "Float should be truncated toward zero"
    assert result['truncatesFloatString'] == 5, "Float string should be truncated"
    assert result['clampMin'] == 1, "Value below min should clamp to min"
    assert result['clampMax'] == 31, "Value above max should clamp to max"
    assert result['withinRange'] == 15, "Value within range should pass through unchanged"
    assert result['nullFallback'] is None, "null with null fallback should return null"


@pytest.mark.feature
def test_utils_sanitize_date_iso(app_page):
    """sanitizeDateISO rejects garbage/invalid dates and only accepts strict YYYY-MM-DD."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const { sanitizeDateISO } = mod;
        return {
            invalidCalendarDate: sanitizeDateISO('2026-13-45'),
            notADate: sanitizeDateISO('not-a-date'),
            emptyString: sanitizeDateISO(''),
            nullValue: sanitizeDateISO(null),
            undefinedValue: sanitizeDateISO(undefined),
            wrongFormat: sanitizeDateISO('06/18/2026'),
            validDate: sanitizeDateISO('2026-06-18')
        };
    }""")

    assert result['notADate'] is None, "Non-date string should be rejected"
    assert result['emptyString'] is None, "Empty string should be rejected"
    assert result['nullValue'] is None, "null should be rejected"
    assert result['undefinedValue'] is None, "undefined should be rejected"
    assert result['wrongFormat'] is None, "Non-ISO format should be rejected"
    assert result['validDate'] == '2026-06-18', "Valid ISO date should pass through"
    # Document actual behavior for an invalid calendar date (e.g. month 13, day 45):
    # JS Date rolls these over rather than rejecting them outright, so confirm
    # whatever the real implementation does rather than assuming rejection.
    assert result['invalidCalendarDate'] is None, (
        "Expected sanitizeDateISO('2026-13-45') to be rejected, but got "
        f"{result['invalidCalendarDate']!r} -- if this fails, the function accepts "
        "out-of-range calendar dates that happen to parse via JS Date rollover."
    )


@pytest.mark.feature
def test_utils_normalize_text(app_page):
    """normalizeText strips <>\"` and control characters, and truncates at maxLen."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const { normalizeText } = mod;
        const longString = 'a'.repeat(200);
        return {
            stripsAngleBrackets: normalizeText('<script>alert(1)</script>'),
            stripsQuoteBacktick: normalizeText('He said "hi" and `bye`'),
            stripsControlChars: normalizeText('hello\\u0000\\u001Fworld'),
            truncatesAtMaxLen: normalizeText(longString, 10),
            truncatesAtDefaultMaxLen: normalizeText(longString),
            trimsWhitespace: normalizeText('   padded   '),
            nullValue: normalizeText(null)
        };
    }""")

    assert '<' not in result['stripsAngleBrackets'] and '>' not in result['stripsAngleBrackets']
    assert '"' not in result['stripsQuoteBacktick'] and '`' not in result['stripsQuoteBacktick']
    assert result['stripsControlChars'] == 'helloworld', "Control characters should be stripped"
    assert len(result['truncatesAtMaxLen']) == 10, "Should truncate at exactly the given maxLen"
    assert len(result['truncatesAtDefaultMaxLen']) == 120, "Should truncate at the default maxLen of 120"
    assert result['trimsWhitespace'] == 'padded', "Should trim leading/trailing whitespace"
    assert result['nullValue'] == '', "null should normalize to an empty string"


# ---------------------------------------------------------------------------
# Negative-input import tests for additional record-type sanitizers
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_import_sanitizes_adversarial_net_worth_snapshot(app_page):
    """XSS/non-finite fields in an imported monthlySnapshots entry are sanitized."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            monthlySnapshots: [{
                date: '2026-06-18',
                totalAssets: 'NaN',
                totalLiabilities: Infinity,
                netWorth: 'not-a-number',
                debtPaymentMade: -500,
                incomeReceived: -100,
                source: '<script>alert(1)</script>'
            }, {
                // Missing required date field -- should be dropped entirely.
                totalAssets: 1000,
                totalLiabilities: 200
            }]
        };
        const file = new File([JSON.stringify(payload)], 'snapshot.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ snapshots: app.monthlySnapshots }), 300);
        });
    }""")

    snapshots = result['snapshots']
    assert len(snapshots) == 1, "Snapshot missing required date field should be dropped"
    snap = snapshots[0]
    assert snap['date'] == '2026-06-18'
    assert snap['totalAssets'] == 0, "Non-numeric totalAssets should fall back to 0"
    assert snap['totalLiabilities'] == 0, "Infinity totalLiabilities should fall back to 0"
    assert snap['debtPaymentMade'] == 0, "Negative debtPaymentMade should clamp to 0"
    assert snap['incomeReceived'] == 0, "Negative incomeReceived should clamp to 0"
    assert snap['source'] == 'auto', "Invalid source value should fall back to 'auto'"


@pytest.mark.feature
def test_import_sanitizes_adversarial_forecast_settings(app_page):
    """XSS/out-of-range fields in imported forecastSettings are sanitized."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            forecastSettings: {
                rangeMonths: 999,
                accountId: '<img src=x onerror=alert(1)>',
                notableThresholdPct: 'NaN'
            }
        };
        const file = new File([JSON.stringify(payload)], 'forecast.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({
                rangeMonths: app._forecastRangeMonths,
                accountId: app._forecastAccountId,
                notableThresholdPct: app._forecastNotableThresholdPct
            }), 300);
        });
    }""")

    assert result['rangeMonths'] == 1, "Invalid rangeMonths (not in allowed set) should fall back to 1"
    assert '<' not in result['accountId'] and '>' not in result['accountId'], \
        "accountId should have unsafe characters stripped"
    assert result['notableThresholdPct'] == 130, "Non-numeric notableThresholdPct should fall back to default 130"


@pytest.mark.feature
def test_import_sanitizes_adversarial_emergency_fund(app_page):
    """XSS/non-finite fields in an imported emergencyFunds entry are sanitized."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 100 }],
            emergencyFunds: [{
                id: 'abc',
                accountId: 1,
                targetAmount: 'NaN',
                currentAmount: -500,
                monthlyContribution: Infinity,
                autoContribute: 'yes',
                notes: '<script>alert(1)</script>Emergency notes'
            }]
        };
        const file = new File([JSON.stringify(payload)], 'efund.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ fund: app.emergencyFunds[0] }), 300);
        });
    }""")

    fund = result['fund']
    assert fund is not None, "Emergency fund with valid accountId should be retained"
    assert fund['targetAmount'] == 0, "Non-numeric targetAmount should fall back to 0"
    assert fund['currentAmount'] == 0, "Negative currentAmount should clamp to 0"
    assert fund['monthlyContribution'] == 0, "Infinity monthlyContribution should fall back to 0"
    assert '<' not in fund['notes'] and '>' not in fund['notes'], "notes should have unsafe characters stripped"
    assert isinstance(fund['id'], int), "Fund id should be sanitized to an integer"


@pytest.mark.feature
def test_import_sanitizes_adversarial_sinking_fund(app_page):
    """XSS/non-finite fields and missing required field in an imported sinkingFunds entry are sanitized."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 100 }],
            sinkingFunds: [{
                id: 'abc',
                name: '<script>alert(1)</script>Vacation Fund',
                allocationMethod: 'not-a-real-method',
                monthlyAllocation: 'NaN',
                targetAmount: -1000,
                currentAmount: Infinity,
                autoContribute: 1,
                accountId: 1,
                notes: '<b>bold</b> notes'
            }, {
                // Missing name -- should be dropped entirely.
                id: 'def',
                accountId: 1,
                targetAmount: 500
            }]
        };
        const file = new File([JSON.stringify(payload)], 'sfund.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ funds: app.sinkingFunds }), 300);
        });
    }""")

    funds = result['funds']
    assert len(funds) == 1, "Sinking fund missing required name should be dropped"
    fund = funds[0]
    assert '<' not in fund['name'] and '>' not in fund['name'], "name should have unsafe characters stripped"
    assert fund['allocationMethod'] == 'fixed', "Invalid allocationMethod should fall back to 'fixed'"
    assert fund['monthlyAllocation'] == 0, "Non-numeric monthlyAllocation should fall back to 0"
    assert fund['targetAmount'] == 0, "Negative targetAmount should clamp to 0"
    assert fund['currentAmount'] == 0, "Infinity currentAmount should fall back to 0"
    assert '<' not in fund['notes'] and '>' not in fund['notes'], "notes should have unsafe characters stripped"


@pytest.mark.feature
def test_import_sanitizes_adversarial_bonus(app_page):
    """XSS/non-finite fields in an imported bonuses entry are sanitized."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            bonuses: [{
                id: 'abc',
                name: '<img src=x onerror=alert(1)>Tax Refund',
                amount: -1000,
                date: '2026-06-18',
                category: '<script>alert(1)</script>',
                accountId: 'not-a-number'
            }]
        };
        const file = new File([JSON.stringify(payload)], 'bonus.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ bonus: app.bonuses[0] }), 300);
        });
    }""")

    bonus = result['bonus']
    assert bonus is not None, "Bonus with valid name and date should be retained"
    assert '<' not in bonus['name'] and '>' not in bonus['name'], "name should have unsafe characters stripped"
    assert bonus['amount'] == 0, "Negative amount should clamp to 0"
    assert '<' not in bonus['category'] and '>' not in bonus['category'], \
        "category should have unsafe characters stripped"
    assert isinstance(bonus['id'], int), "Bonus id should be sanitized to an integer"


# ---------------------------------------------------------------------------
# sanitizeLedgerOverrides negative-input tests
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_import_rejects_non_object_ledger_overrides(app_page):
    """A non-object ledgerAmountOverrides blob does not corrupt app state or throw."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            ledgerAmountOverrides: 'this is not an object, it is a string'
        };
        const file = new File([JSON.stringify(payload)], 'badoverrides.json', { type: 'application/json' });
        return new Promise(resolve => {
            let threw = false;
            try {
                mod.importAllJSON(app, file, {});
            } catch (e) {
                threw = true;
            }
            setTimeout(() => resolve({
                threw,
                overrides: app.ledgerAmountOverrides
            }), 300);
        });
    }""")

    assert not result['threw'], "Importing a non-object ledgerAmountOverrides blob should not throw"
    assert isinstance(result['overrides'], dict), "ledgerAmountOverrides should fall back to an empty object"
    assert len(result['overrides']) == 0, "Non-object ledgerAmountOverrides should result in an empty object"


@pytest.mark.feature
def test_import_drops_ledger_override_with_non_finite_amount(app_page):
    """An override entry with a non-finite amount is dropped rather than corrupting app state."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            debts: [{ id: 1, name: 'Anchor Debt', debtType: 'creditCard',
                      accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            ledgerAmountOverrides: {
                'debt|1|1|2026-06-18': { amount: 'not-a-number', transactionName: 'Bad Override' },
                'debt|2|1|2026-06-18': { amount: [1, 2], transactionName: 'Also Bad' },
                'debt|3|1|2026-06-18': { amount: 250, transactionName: '<script>alert(1)</script>Good Override' }
            }
        };
        const file = new File([JSON.stringify(payload)], 'badoverride.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ overrides: app.ledgerAmountOverrides }), 300);
        });
    }""")

    overrides = result['overrides']
    assert 'debt|1|1|2026-06-18' not in overrides, "Override with NaN amount should be dropped"
    assert 'debt|2|1|2026-06-18' not in overrides, "Override with non-numeric string amount should be dropped"
    assert 'debt|3|1|2026-06-18' in overrides, "Override with a valid amount should be retained"
    good = overrides['debt|3|1|2026-06-18']
    assert good['amount'] == 250
    assert '<' not in good['transactionName'] and '>' not in good['transactionName'], \
        "transactionName should have unsafe characters stripped"


# ---------------------------------------------------------------------------
# Legacy v1.0 (debts-only) import format
# ---------------------------------------------------------------------------

@pytest.mark.feature
def test_import_legacy_v1_format_with_version_field(app_page):
    """A legacy v1.0 {version, debts: [...]} payload imports debts with current-format defaults filled in."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.debts = [];
        app.accounts = [];
    }""")

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = {
            version: '1.0',
            debts: [
                { id: 1, name: 'Legacy Visa', debtType: 'creditCard',
                  accountBalance: 2500, interestRate: 18.5, minimumPayment: 75, dueDate: 12 }
            ]
        };
        const file = new File([JSON.stringify(payload)], 'legacy.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({
                debtCount: app.debts.length,
                debt: app.debts[0],
                accounts: app.accounts
            }), 300);
        });
    }""")

    assert result['debtCount'] == 1, "Legacy v1.0 debt should be imported"
    debt = result['debt']
    assert debt['name'] == 'Legacy Visa'
    assert debt['accountBalance'] == 2500
    assert debt['interestRate'] == 18.5
    assert debt['minimumPayment'] == 75
    assert debt['dueDate'] == 12
    # Current-format defaults filled in for fields the legacy format lacked.
    assert debt['accountId'] is None, "accountId should default to None for legacy debts with no account link"
    assert debt['category'] == '', "category should default to empty string when absent"
    assert debt['originalBalance'] == 2500, "originalBalance should default to accountBalance when absent"
    assert debt['originalMinimumPayment'] == 75, "originalMinimumPayment should default to minimumPayment when absent"
    assert result['accounts'] == [], "Legacy debts-only import should leave accounts as an empty array"


@pytest.mark.feature
def test_import_legacy_v1_bare_debts_array_format(app_page):
    """A bare JSON array (the legacy v1.0 debts-only shape with no wrapper object) imports correctly."""
    page = app_page

    page.evaluate("""() => {
        const app = window.app;
        app.debts = [];
    }""")

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/storage.js');
        const payload = [
            { id: 1, name: 'Legacy Card One', debtType: 'creditCard',
              accountBalance: 1000, interestRate: 12, minimumPayment: 30, dueDate: 5 },
            { id: 2, name: 'Legacy Card Two', debtType: 'creditCard',
              accountBalance: 2000, interestRate: 20, minimumPayment: 60, dueDate: 20 }
        ];
        const file = new File([JSON.stringify(payload)], 'legacy_bare.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({
                debtCount: app.debts.length,
                names: app.debts.map(d => d.name)
            }), 300);
        });
    }""")

    assert result['debtCount'] == 2, "Both legacy debts should be imported"
    assert set(result['names']) == {'Legacy Card One', 'Legacy Card Two'}
