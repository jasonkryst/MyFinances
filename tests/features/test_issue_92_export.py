"""
Tests for issue #92: Import/Export missing items.

Gaps fixed:
- perMonthStimulus was saved to localStorage but absent from both
  exportAllJSON payload and importAllJSON restoration.
- Export version was hardcoded '4.0.0' instead of reading APP_VERSION.
- The "no data" guard rejected valid files containing only accounts,
  savings goals, or reconciliations (no debts/income/bills).
- Merge mode replaced all non-debt collections instead of merging them.

Positive tests verify the fixes; negative tests verify backward-compat
and that corrupt/empty payloads are still rejected or handled gracefully.
"""

import json
import pytest


# ─────────────────────────── positive tests ───────────────────────────

@pytest.mark.feature
def test_export_includes_per_month_stimulus(app_page):
    """exportAllJSON includes perMonthStimulus in the exported payload."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        app.perMonthStimulus = [100, 50, 25];
        app.debts = [{ id: 1, name: 'Test Card', debtType: 'creditCard',
                       accountBalance: 1000, originalBalance: 1000,
                       interestRate: 18, minimumPayment: 50,
                       originalMinimumPayment: 50, dueDate: 15,
                       category: 'Credit Card' }];

        const mod = await import('/src/dataExport.js');
        let captured = null;
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { captured = blob; return 'blob:mock'; };
        try {
            mod.exportAllJSON(app);
        } finally {
            URL.createObjectURL = origCreate;
        }
        const text = await captured.text();
        return JSON.parse(text);
    }""")

    assert 'perMonthStimulus' in result, "exportAllJSON payload must include perMonthStimulus"
    assert result['perMonthStimulus'] == [100, 50, 25], \
        "perMonthStimulus values should be preserved in the export"


@pytest.mark.feature
def test_export_version_matches_app_version(app_page):
    """The version field in the export matches the running APP_VERSION."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        app.debts = [{ id: 1, name: 'Visa', debtType: 'creditCard',
                       accountBalance: 500, originalBalance: 500,
                       interestRate: 20, minimumPayment: 25,
                       originalMinimumPayment: 25, dueDate: 10,
                       category: 'Credit Card' }];
        const [exportMod, utilsMod] = await Promise.all([
            import('/src/dataExport.js'),
            import('/src/utils.js')
        ]);
        let captured = null;
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { captured = blob; return 'blob:mock'; };
        try {
            exportMod.exportAllJSON(app);
        } finally {
            URL.createObjectURL = origCreate;
        }
        const payload = JSON.parse(await captured.text());
        return { exportVersion: payload.version, appVersion: utilsMod.APP_VERSION };
    }""")

    assert result['exportVersion'] == result['appVersion'], \
        f"Export version '{result['exportVersion']}' should match APP_VERSION '{result['appVersion']}'"


@pytest.mark.feature
def test_import_restores_per_month_stimulus(app_page):
    """importAllJSON restores perMonthStimulus onto app.perMonthStimulus."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        const payload = {
            debts: [{ id: 1, name: 'Import Visa', debtType: 'creditCard',
                      accountBalance: 2000, originalBalance: 2000,
                      interestRate: 19, minimumPayment: 60,
                      originalMinimumPayment: 60, dueDate: 15,
                      category: 'Credit Card' }],
            perMonthStimulus: [200, 150, 0, 75]
        };
        const file = new File([JSON.stringify(payload)], 'backup.json',
                              { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {
                requestImportMode: () => true,
                onImported: () => {}
            });
            setTimeout(() => resolve({
                perMonthStimulus: app.perMonthStimulus
            }), 400);
        });
    }""")

    assert result['perMonthStimulus'] == [200, 150, 0, 75], \
        f"perMonthStimulus should be restored after import, got: {result['perMonthStimulus']}"


@pytest.mark.feature
def test_import_per_month_stimulus_roundtrip(app_page):
    """perMonthStimulus survives a full export -> import roundtrip."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');

        app.perMonthStimulus = [300, 0, 150];
        app.debts = [{ id: 1, name: 'Round Trip Card', debtType: 'creditCard',
                       accountBalance: 3000, originalBalance: 3000,
                       interestRate: 15, minimumPayment: 80,
                       originalMinimumPayment: 80, dueDate: 20,
                       category: 'Credit Card' }];

        let capturedBlob = null;
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { capturedBlob = blob; return 'blob:mock'; };
        try { mod.exportAllJSON(app); } finally { URL.createObjectURL = origCreate; }

        const exportedText = await capturedBlob.text();
        app.perMonthStimulus = [];

        const file = new File([exportedText], 'roundtrip.json', { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {
                requestImportMode: () => true,
                onImported: () => {}
            });
            setTimeout(() => resolve({ perMonthStimulus: app.perMonthStimulus }), 400);
        });
    }""")

    assert result['perMonthStimulus'] == [300, 0, 150], \
        f"perMonthStimulus should survive export->import roundtrip, got: {result['perMonthStimulus']}"


@pytest.mark.feature
def test_import_accepts_accounts_only_file(app_page):
    """A file containing only accounts is no longer rejected as 'no data'."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        const payload = {
            accounts: [{ id: 1, name: 'Savings', type: 'Savings', startingBalance: 5000 }]
        };
        const file = new File([JSON.stringify(payload)], 'accounts-only.json',
                              { type: 'application/json' });
        return new Promise(resolve => {
            let noDataCalled = false;
            mod.importAllJSON(app, file, {
                requestImportMode: () => true,
                onNoData: () => { noDataCalled = true; },
                onImported: () => {}
            });
            setTimeout(() => resolve({
                noDataCalled,
                accountsLength: app.accounts.length
            }), 400);
        });
    }""")

    assert not result['noDataCalled'], \
        "onNoData should NOT fire for a file containing only accounts"
    assert result['accountsLength'] >= 1, "Accounts should be imported from accounts-only file"


@pytest.mark.feature
def test_merge_mode_deduplicates_accounts_by_name(app_page):
    """In merge mode, incoming accounts with the same name as existing accounts are skipped."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        app.accounts = [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000 }];
        app.debts = [{ id: 1, name: 'Existing Debt', debtType: 'creditCard',
                       accountBalance: 500, originalBalance: 500,
                       interestRate: 15, minimumPayment: 25,
                       originalMinimumPayment: 25, dueDate: 10,
                       category: 'Credit Card' }];

        const mod = await import('/src/dataExport.js');
        const payload = {
            accounts: [
                { id: 2, name: 'Checking', type: 'Checking', startingBalance: 2000 },
                { id: 3, name: 'Savings', type: 'Savings', startingBalance: 5000 }
            ],
            debts: [{ id: 2, name: 'New Debt', debtType: 'creditCard',
                      accountBalance: 800, originalBalance: 800,
                      interestRate: 20, minimumPayment: 30,
                      originalMinimumPayment: 30, dueDate: 5,
                      category: 'Credit Card' }]
        };
        const file = new File([JSON.stringify(payload)], 'merge.json',
                              { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {
                requestImportMode: () => false,
                onImported: () => {}
            });
            setTimeout(() => resolve({
                accountNames: app.accounts.map(a => a.name)
            }), 400);
        });
    }""")

    checking_count = result['accountNames'].count('Checking')
    assert checking_count == 1, \
        f"Duplicate 'Checking' account should not be added in merge mode, got: {result['accountNames']}"
    assert 'Savings' in result['accountNames'], \
        "New 'Savings' account should be added in merge mode"


# ─────────────────────────── negative tests ───────────────────────────

@pytest.mark.feature
def test_import_missing_per_month_stimulus_defaults_to_empty(app_page):
    """Importing a file without perMonthStimulus resets it to an empty array."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        app.perMonthStimulus = [500, 200];

        const mod = await import('/src/dataExport.js');
        const payload = {
            debts: [{ id: 1, name: 'Card Without Stimulus', debtType: 'creditCard',
                      accountBalance: 1000, originalBalance: 1000,
                      interestRate: 18, minimumPayment: 40,
                      originalMinimumPayment: 40, dueDate: 10,
                      category: 'Credit Card' }]
        };
        const file = new File([JSON.stringify(payload)], 'no-stimulus.json',
                              { type: 'application/json' });
        return new Promise(resolve => {
            mod.importAllJSON(app, file, {
                requestImportMode: () => true,
                onImported: () => {}
            });
            setTimeout(() => resolve({ perMonthStimulus: app.perMonthStimulus }), 400);
        });
    }""")

    assert result['perMonthStimulus'] == [], \
        f"perMonthStimulus should default to [] when absent from import file, got: {result['perMonthStimulus']}"


@pytest.mark.feature
def test_import_truly_empty_file_triggers_no_data(app_page):
    """A file with no recognisable data at all still triggers onNoData."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/dataExport.js');
        const payload = { version: '4.25.0', exportedAt: '2026-08-30T00:00:00Z' };
        const file = new File([JSON.stringify(payload)], 'empty.json',
                              { type: 'application/json' });
        return new Promise(resolve => {
            let noDataCalled = false;
            mod.importAllJSON(window.app, file, {
                requestImportMode: () => true,
                onNoData: () => { noDataCalled = true; }
            });
            setTimeout(() => resolve({ noDataCalled }), 400);
        });
    }""")

    assert result['noDataCalled'], \
        "A payload with no records and no strategy should trigger onNoData"


@pytest.mark.feature
def test_import_oversized_file_triggers_too_large(app_page):
    """A file over 2 MB triggers onTooLarge and does not modify app state."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        app.debts = [];
        const mod = await import('/src/dataExport.js');
        const bigContent = 'x'.repeat(2 * 1024 * 1024 + 1);
        const file = new File([bigContent], 'huge.json', { type: 'application/json' });
        return new Promise(resolve => {
            let tooLargeCalled = false;
            mod.importAllJSON(app, file, {
                onTooLarge: () => { tooLargeCalled = true; },
                requestImportMode: () => true,
                onImported: () => {}
            });
            setTimeout(() => resolve({ tooLargeCalled, debtsLen: app.debts.length }), 300);
        });
    }""")

    assert result['tooLargeCalled'], "Oversized file should trigger onTooLarge"
    assert result['debtsLen'] == 0, "App state should be unchanged after oversized file rejection"