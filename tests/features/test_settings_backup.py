"""Settings-only export/import (issue #326): Settings -> Data & Storage."""

import json

import pytest

from tests.conftest import open_settings, switch_settings_tab

SEED_DATA = """() => {
    const app = window.app;
    app.accounts = [{ id: 7001, name: 'Backup Acct', type: 'Checking', startingBalance: 500 }];
    app.debts = [{ id: 7002, name: 'Backup Debt', balance: 1000, interestRate: 10, minimumPayment: 25, debtType: 'loan' }];
    window.__dataBefore = JSON.stringify({ a: app.accounts, d: app.debts });
}"""

DATA_UNCHANGED = "() => JSON.stringify({ a: window.app.accounts, d: window.app.debts }) === window.__dataBefore"


def _open_data_tab(page):
    open_settings(page)
    switch_settings_tab(page, 'data')


def _import(page, payload):
    text = payload if isinstance(payload, str) else json.dumps(payload)
    page.set_input_files('#settingsImportFile', files=[
        {'name': 'settings.json', 'mimeType': 'application/json', 'buffer': text.encode('utf-8')}
    ])


def _status(page):
    page.wait_for_function("() => document.getElementById('settingsBackupStatus').textContent.trim() !== ''")
    return page.inner_text('#settingsBackupStatus')


@pytest.mark.feature
def test_export_contains_toggles_and_no_financial_data(app_page):
    page = app_page
    page.evaluate(SEED_DATA)
    page.evaluate("""async () => {
        const s = await import('/src/settings.js');
        s.setSetting(window.app, s.SHOW_ARCHIVED_DEBTS, true);
        s.setSetting(window.app, s.AUTO_NW_SNAPSHOT, true);
        s.setSetting(window.app, s.SURPLUS_ACCOUNT_ID, 7001);
        s.setSetting(window.app, s.ZERO_AMOUNT_POLICY, 'warn');
    }""")
    _open_data_tab(page)
    with page.expect_download() as dl:
        page.click('#settingsExportBtn')
    download = dl.value
    assert download.suggested_filename.startswith('myfinances-settings-')
    assert download.suggested_filename.endswith('.json')
    with open(download.path(), encoding='utf-8') as fh:
        data = json.load(fh)
    assert data['type'] == 'settings' and data['version'] == '1.0'
    assert data['settings']['showArchivedDebts'] is True
    assert data['settings']['autoNwSnapshot'] is True
    assert data['settings']['zeroAmountPolicy'] == 'warn'
    assert 'surplusAccountId' not in data['settings']
    assert set(data['preferences']) == {'theme', 'locale', 'currency'}
    for forbidden in ('debts', 'accounts', 'incomes', 'bills', 'expenses'):
        assert forbidden not in data
    assert 'Backup Debt' not in json.dumps(data)


@pytest.mark.feature
def test_import_applies_prefs_and_settings_without_touching_data(app_page):
    page = app_page
    page.evaluate(SEED_DATA)
    _open_data_tab(page)
    _import(page, {
        'type': 'settings', 'version': '1.0',
        'preferences': {'theme': 'dark', 'locale': 'es', 'currency': 'EUR'},
        'settings': {'showArchivedDebts': True, 'zeroAmountPolicy': 'block', 'surplusWindowDays': 45,
                     'bct:food:healthy': 12, 'bct:food:warn': 20},
    })
    status = _status(page)
    assert '8' in status  # 3 preferences + 5 settings
    assert page.evaluate("() => document.body.classList.contains('dark-mode')")
    assert page.evaluate("() => localStorage.getItem('debtTrackerTheme')") == 'dark'
    assert page.evaluate("() => localStorage.getItem('debtTrackerLocale')") == 'es'
    assert page.evaluate("() => localStorage.getItem('debtTrackerCurrency')") == 'EUR'
    vals = page.evaluate("""async () => {
        const s = await import('/src/settings.js');
        return [s.getSetting(window.app, 'showArchivedDebts'), s.getSetting(window.app, 'zeroAmountPolicy'),
                s.getSetting(window.app, 'surplusWindowDays'), s.getSetting(window.app, 'bct:food:warn')];
    }""")
    assert vals == [True, 'block', 45, 20]
    assert page.evaluate("() => document.getElementById('settingShowArchivedDebts').checked")
    assert page.input_value('#settingZeroAmountPolicy') == 'block'
    assert page.input_value('#settingLocale') == 'es'
    assert page.input_value('#settingCurrency') == 'EUR'
    assert page.input_value('#themeSwitcher') == 'dark'
    assert page.evaluate(DATA_UNCHANGED)


@pytest.mark.feature
def test_import_full_data_export_is_rejected_and_changes_nothing(app_page):
    page = app_page
    page.evaluate(SEED_DATA)
    before = page.evaluate("() => JSON.stringify(window.app.settings)")
    _open_data_tab(page)
    _import(page, {'version': '3.0', 'debts': [{'name': 'X'}], 'accounts': []})
    assert 'full data export' in _status(page).lower()
    assert page.evaluate("() => document.getElementById('settingsBackupStatus').className").endswith('target-result--error')
    assert page.evaluate("() => JSON.stringify(window.app.settings)") == before
    assert page.evaluate(DATA_UNCHANGED)


@pytest.mark.feature
def test_import_bad_values_applied_partially_and_listed(app_page):
    page = app_page
    _open_data_tab(page)
    _import(page, {
        'type': 'settings', 'version': '1.0', 'preferences': {'theme': 'neon'},
        'settings': {'showArchivedRecurring': True, 'surplusCushionPct': 500, 'mystery': 1, 'surplusAccountId': 4},
    })
    _status(page)
    items = page.eval_on_selector_all('#settingsBackupStatus li', 'els => els.map(e => e.textContent)')
    joined = '\n'.join(items)
    for k in ('theme', 'surplusCushionPct', 'mystery', 'surplusAccountId'):
        assert k in joined
    assert page.evaluate("""async () => {
        const s = await import('/src/settings.js');
        return s.getSetting(window.app, 'showArchivedRecurring') === true
            && s.getSetting(window.app, 'surplusCushionPct') === undefined
            && s.getSetting(window.app, 'surplusAccountId') === undefined;
    }""")


@pytest.mark.feature
def test_import_rejects_malformed_and_wrong_version(app_page):
    page = app_page
    _open_data_tab(page)
    _import(page, '{not json')
    assert 'not valid json' in _status(page).lower()
    _import(page, {'type': 'settings', 'version': '2.0', 'settings': {}})
    page.wait_for_function(
        "() => /version/i.test(document.getElementById('settingsBackupStatus').textContent)")


@pytest.mark.feature
def test_import_oversized_file_rejected(app_page):
    page = app_page
    _open_data_tab(page)
    _import(page, ' ' * (101 * 1024))
    assert 'too large' in _status(page).lower()


@pytest.mark.feature
def test_settings_backup_controls_are_labelled(app_page):
    page = app_page
    _open_data_tab(page)
    assert page.get_attribute('#settingsBackupStatus', 'role') == 'status'
    assert page.inner_text('#settingsExportBtn').strip()
    assert page.inner_text('#settingsImportBtn').strip()
    assert page.get_attribute('#settingsImportFile', 'accept') == 'application/json,.json'


@pytest.mark.feature
def test_imported_bct_key_cannot_retarget_postgres_request(app_page):
    """A free-text bct category is URL-encoded, so '/', '..' and '?' from an
    imported file can't redirect the settings PUT to another endpoint (#326)."""
    page = app_page
    urls = page.evaluate("""async () => {
        const seen = [];
        const realFetch = window.fetch;
        window.fetch = (url, opts) => {
            if (opts && opts.method === 'PUT') { seen.push(String(url)); return Promise.resolve(new Response('{}')); }
            return realFetch(url, opts);
        };
        const app = window.app;
        try {
            const sb = await import('/src/settingsBackup.js');
            sb.importSettingsText(app, JSON.stringify({
                type: 'settings', version: '1.0', preferences: {},
                settings: { 'bct:../../auth/x?y=1#z:healthy': 50 }
            }));
            await new Promise(r => setTimeout(r, 50));
        } finally {
            window.fetch = realFetch;
        }
        return seen;
    }""")
    assert len(urls) == 1, urls
    path = urls[0]
    assert path.startswith('/api/settings/bct'), path
    tail = path[len('/api/settings/'):]
    assert '/' not in tail and '?' not in tail and '#' not in tail, path
