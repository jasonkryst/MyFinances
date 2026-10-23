#!/usr/bin/env python3
"""
Settings Model Tests
Tests the generic app.settings array (src/settings.js): getSetting/setSetting
defaults and overrides, sanitizeSetting round-tripping through storage, and
the data format version bump to 4.0.0.
"""

import pytest


@pytest.mark.feature
def test_get_setting_returns_default_when_absent(app_page):
    """getSetting returns the provided default when no entry exists."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        app.settings = [];
        return app.getSetting('reconciliationAdjustsBalance', false);
    }""")

    assert result is False


@pytest.mark.feature
def test_set_setting_then_get_setting_round_trips(app_page):
    """setSetting upserts an entry that getSetting then returns."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        app.settings = [];
        app.setSetting('reconciliationAdjustsBalance', true);
        return {
            value: app.getSetting('reconciliationAdjustsBalance', false),
            settings: app.settings
        };
    }""")

    assert result['value'] is True
    assert result['settings'] == [{'key': 'reconciliationAdjustsBalance', 'value': True}]


@pytest.mark.feature
def test_set_setting_updates_existing_entry_in_place(app_page):
    """Calling setSetting twice for the same key updates the value rather
    than appending a duplicate entry."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        app.settings = [];
        app.setSetting('reconciliationAdjustsBalance', true);
        app.setSetting('reconciliationAdjustsBalance', false);
        return app.settings;
    }""")

    assert len(result) == 1
    assert result[0]['value'] is False


@pytest.mark.feature
def test_sanitize_setting_drops_invalid_entries_keeps_valid(app_page):
    """sanitizeSetting (via loadFromStorage) drops entries with empty keys
    or non-primitive values, keeping valid boolean/number/string entries."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        const data = {
            accounts: [], debts: [], incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            settings: [
                { key: '', value: true },
                { key: 'validBool', value: true },
                { key: 'validNumber', value: 42 },
                { key: 'validString', value: 'hello' },
                { key: 'invalidObject', value: { nested: 1 } },
                { key: 'invalidFunction', value: () => {} },
                { value: true }
            ]
        };
        localStorage.setItem(app.storageKey, JSON.stringify(data));
        app.loadFromStorage();
        return app.settings;
    }""")

    keys = sorted(s['key'] for s in result)
    assert keys == ['validBool', 'validNumber', 'validString']


@pytest.mark.feature
def test_sanitize_setting_truncates_oversized_string_value(app_page):
    """An oversized string setting value is truncated rather than rejected."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        const longValue = 'x'.repeat(500);
        const data = {
            accounts: [], debts: [], incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            settings: [{ key: 'longSetting', value: longValue }]
        };
        localStorage.setItem(app.storageKey, JSON.stringify(data));
        app.loadFromStorage();
        return app.settings[0].value.length;
    }""")

    assert result <= 200


@pytest.mark.feature
def test_export_json_reports_app_version(app_page):
    """exportAllJSON's payload version field matches the running APP_VERSION."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const [exportMod, utilsMod] = await Promise.all([
            import('/src/dataExport.js'),
            import('/src/utils.js')
        ]);
        let captured = null;
        const originalCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = (blob) => { captured = blob; return 'blob:mock'; };
        try {
            app.settings = [{ key: 'reconciliationAdjustsBalance', value: true }];
            exportMod.exportAllJSON(app);
        } finally {
            URL.createObjectURL = originalCreateObjectURL;
        }
        const text = await captured.text();
        const payload = JSON.parse(text);
        return { exportVersion: payload.version, appVersion: utilsMod.APP_VERSION, settings: payload.settings };
    }""")

    assert result['exportVersion'] == result['appVersion'], (
        f"Export version '{result['exportVersion']}' should match APP_VERSION '{result['appVersion']}'"
    )
    assert result['settings'] == [{'key': 'reconciliationAdjustsBalance', 'value': True}]


@pytest.mark.feature
def test_export_import_round_trip_preserves_settings(app_page):
    """importAllJSON preserves the settings array on a full-replace import."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        app.accounts = [];
        app.settings = [];

        const payload = {
            version: '4.0.0',
            accounts: [],
            debts: [{ id: 1, name: 'Dummy Debt', debtType: 'creditCard', accountBalance: 100, interestRate: 5, minimumPayment: 10, dueDate: 1 }],
            incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
            settings: [{ key: 'reconciliationAdjustsBalance', value: true }]
        };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });

        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({ settings: app.settings }), 300);
        });
    }""")

    assert result['settings'] == [{'key': 'reconciliationAdjustsBalance', 'value': True}]


@pytest.mark.feature
def test_legacy_import_without_settings_key_defaults_cleanly(app_page):
    """A legacy export (pre-4.0.0, no settings key at all) imports without
    error and leaves settings as an empty array, which getSetting then
    treats as visible-mode default."""
    page = app_page

    result = page.evaluate("""async () => {
        const app = window.app;
        const mod = await import('/src/dataExport.js');
        app.accounts = [];
        app.settings = [{ key: 'reconciliationAdjustsBalance', value: true }];

        const payload = {
            version: '3.0',
            accounts: [],
            debts: [{ name: 'Legacy Card', balance: 500, interestRate: 10, minimumPayment: 25, dueDate: 1, type: 'creditCard' }],
            incomes: [], bonuses: [], bills: [], expenses: [],
            recurringTemplates: [], emergencyFunds: [], sinkingFunds: []
        };
        const file = new File([JSON.stringify(payload)], 'legacy.json', { type: 'application/json' });

        return new Promise(resolve => {
            mod.importAllJSON(app, file, {});
            setTimeout(() => resolve({
                settings: app.settings,
                adjustsBalance: app.getSetting('reconciliationAdjustsBalance', false)
            }), 300);
        });
    }""")

    assert result['settings'] == []
    assert result['adjustsBalance'] is False


@pytest.mark.feature
def test_ledger_export_columns_setting_round_trips_through_storage(app_page):
    """ledgerExportColumns is a comma-joined string value persisted via the
    generic setSetting/sanitizeSetting pipeline (no per-key sanitizer needed,
    since storage.js's sanitizeSetting already constrains it to a bounded
    string). It must survive a save/reload round-trip intact."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        app.settings = [];
        app.setSetting('ledgerExportColumns', 'date,account,amount');
        app.saveToStorage();
        app.loadFromStorage();
        return app.getSetting('ledgerExportColumns', null);
    }""")

    assert result == 'date,account,amount'


@pytest.mark.feature
def test_ledger_export_columns_setting_with_garbage_value_is_bounded_string(app_page):
    """Even if localStorage/import contains a garbage value for
    ledgerExportColumns, sanitizeSetting still constrains it to a bounded
    string (<=200 chars) rather than allowing arbitrary objects through —
    the read-time whitelist in openLedgerExportModal then filters it against
    the known column keys."""
    page = app_page

    result = page.evaluate("""() => {
        const app = window.app;
        app.settings = [{ key: 'ledgerExportColumns', value: 'bogus,columns,not,real' }];
        app.saveToStorage();
        app.loadFromStorage();
        return app.getSetting('ledgerExportColumns', null);
    }""")

    # sanitizeSetting accepts any bounded string value at the storage layer;
    # the column whitelist is enforced at read-time in openLedgerExportModal.
    assert result == 'bogus,columns,not,real'


# ── Settings modal tabbed layout (#322) ─────────────────────────────────────────

@pytest.mark.feature
def test_settings_modal_has_four_tabs(app_page):
    page = app_page
    from tests.conftest import open_settings
    open_settings(page)
    labels = page.eval_on_selector_all('.settings-tab-btn', 'els => els.map(e => e.getAttribute("data-settings-tab"))')
    assert labels == ['appearance', 'data', 'notifications', 'advanced']


@pytest.mark.feature
def test_settings_default_tab_is_appearance_and_others_hidden(app_page):
    page = app_page
    from tests.conftest import open_settings
    open_settings(page)
    assert page.is_visible('#settingsPanel-appearance')
    assert not page.is_visible('#settingsPanel-advanced')
    assert page.is_visible('#themeSwitcher')
    assert not page.is_visible('#settingReconciliationAdjusts')


@pytest.mark.feature
def test_settings_tab_switch_shows_correct_panel(app_page):
    page = app_page
    from tests.conftest import open_settings, switch_settings_tab
    open_settings(page)
    switch_settings_tab(page, 'advanced')
    assert page.is_visible('#settingsPanel-advanced')
    assert not page.is_visible('#settingsPanel-appearance')
    assert page.is_visible('#settingReconciliationAdjusts')


@pytest.mark.feature
def test_settings_active_tab_remembered_across_reopen(app_page):
    """Positive: switching to a tab, closing, and reopening Settings within
    the same page load keeps that tab active (not reset to Appearance)."""
    page = app_page
    from tests.conftest import open_settings, close_settings, switch_settings_tab
    open_settings(page)
    switch_settings_tab(page, 'data')
    close_settings(page)
    open_settings(page)
    assert page.is_visible('#settingsPanel-data')
    assert not page.is_visible('#settingsPanel-appearance')


@pytest.mark.feature
def test_settings_tabs_have_required_aria_attributes(app_page):
    page = app_page
    from tests.conftest import open_settings
    open_settings(page)
    assert page.get_attribute('.settings-tabs', 'role') == 'tablist'
    tab_roles = page.eval_on_selector_all('.settings-tab-btn', 'els => els.map(e => e.getAttribute("role"))')
    assert all(r == 'tab' for r in tab_roles)
    panel_roles = page.eval_on_selector_all('.settings-tab-panel', 'els => els.map(e => e.getAttribute("role"))')
    assert all(r == 'tabpanel' for r in panel_roles)
    assert page.get_attribute('.settings-tab-btn[data-settings-tab="appearance"]', 'aria-selected') == 'true'
    assert page.get_attribute('.settings-tab-btn[data-settings-tab="data"]', 'aria-selected') == 'false'


@pytest.mark.feature
def test_settings_modal_focus_lands_in_visible_tab(app_page):
    """Negative/regression: opening Settings must not focus a control that's
    hidden inside an inactive tab panel."""
    page = app_page
    from tests.conftest import open_settings
    open_settings(page)
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'themeSwitcher'",
        timeout=2000
    )
    focused_id = page.evaluate('() => document.activeElement.id')
    assert focused_id == 'themeSwitcher'


@pytest.mark.feature
def test_settings_modal_focus_falls_back_when_first_control_is_hidden(app_page):
    """Negative/regression (review finding #5): the Notifications tab's only
    control (#settingsSendTestEmailBtn) is itself hidden outside Postgres
    mode. Since the active tab is remembered across reopens, reopening
    Settings on that tab must fall back to the Close button rather than
    focus()-ing a hidden element, which silently does nothing and leaves
    focus stuck behind the modal."""
    page = app_page
    from tests.conftest import open_settings, close_settings, switch_settings_tab
    open_settings(page)
    switch_settings_tab(page, 'notifications')
    assert page.is_hidden('#settingsSendTestEmailBtn')
    close_settings(page)

    open_settings(page)
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'settingsModalCloseBtn'",
        timeout=2000
    )
    focused_id = page.evaluate('() => document.activeElement.id')
    assert focused_id == 'settingsModalCloseBtn'
