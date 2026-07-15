#!/usr/bin/env python3
"""
Storage Adapter Abstraction Tests
storage.js persists through app.storageAdapter (src/storageAdapters.js)
instead of calling localStorage directly, so the app can be backed by either
localStorage (default) or sessionStorage. These tests exercise the adapter
selection, the default/backward-compatible path, and (later in this file)
the switchStorageBackend migration behavior.
"""

import pytest

from tests.conftest import BASE_URL

_TEST_DEBT = (
    "{ id: 1, name: 'Test Debt', category: 'Other', debtType: 'creditCard', "
    "accountBalance: 100, originalBalance: 100, interestRate: 0, "
    "minimumPayment: 10, originalMinimumPayment: 10, priority: 1 }"
)


@pytest.mark.feature
def test_default_backend_is_local_storage(app_page):
    """With no backend preference set, the app persists via localStorage,
    matching pre-abstraction behavior."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT}];
        window.app.saveToStorage();
        return {{
            backend: window.app._storageBackendKind,
            local: localStorage.getItem('debtTrackerData'),
            session: sessionStorage.getItem('debtTrackerData')
        }};
    }}""")

    assert result['backend'] == 'local'
    assert result['local'] is not None
    assert 'Test Debt' in result['local']
    assert result['session'] is None


@pytest.mark.feature
def test_session_preference_makes_app_read_write_session_storage(page):
    """When debtTrackerStorageBackend is 'session' before the app boots, it
    builds a SessionStorageAdapter and saves/loads through sessionStorage."""
    page.add_init_script("""
        try {
            localStorage.setItem('debtTrackerStorageBackend', 'session');
            sessionStorage.setItem('debtTrackerData', JSON.stringify({ accounts: [], debts: [], settings: [] }));
        } catch (e) {}
    """)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    backend = page.evaluate("() => window.app._storageBackendKind")
    assert backend == 'session'

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT}];
        window.app.saveToStorage();
        return {{
            session: sessionStorage.getItem('debtTrackerData'),
            local: localStorage.getItem('debtTrackerData')
        }};
    }}""")
    assert result['session'] is not None
    assert 'Test Debt' in result['session']
    assert result['local'] is None


@pytest.mark.feature
def test_switch_to_session_migrates_data_and_clears_local(app_page):
    """switchStorageBackend('session') copies current data into
    sessionStorage and removes the localStorage copy."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT.replace("Test Debt", "Migrate Me")}];
        window.app.saveToStorage();
        window.app.switchStorageBackend('session');
        return {{
            local: localStorage.getItem('debtTrackerData'),
            session: sessionStorage.getItem('debtTrackerData'),
            pref: localStorage.getItem('debtTrackerStorageBackend'),
            backend: window.app._storageBackendKind
        }};
    }}""")

    assert result['backend'] == 'session'
    assert result['local'] is None
    assert result['session'] is not None
    assert 'Migrate Me' in result['session']
    assert result['pref'] == 'session'


@pytest.mark.feature
def test_switch_back_to_local_migrates_data_and_clears_session(app_page):
    """Switching session -> local migrates again and clears the session
    copy, so no stale copy is left in either backend."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT.replace("Test Debt", "Round Trip")}];
        window.app.switchStorageBackend('session');
        window.app.switchStorageBackend('local');
        return {{
            local: localStorage.getItem('debtTrackerData'),
            session: sessionStorage.getItem('debtTrackerData')
        }};
    }}""")

    assert result['session'] is None
    assert result['local'] is not None
    assert 'Round Trip' in result['local']


@pytest.mark.feature
def test_switch_to_same_backend_is_noop(app_page):
    """Switching to the currently-active backend doesn't wipe data."""
    page = app_page

    result = page.evaluate(f"""() => {{
        window.app.debts = [{_TEST_DEBT.replace("Test Debt", "Stay Put")}];
        window.app.saveToStorage();
        window.app.switchStorageBackend('local');
        return localStorage.getItem('debtTrackerData');
    }}""")

    assert result is not None
    assert 'Stay Put' in result


@pytest.mark.feature
def test_backend_preference_persists_across_reload(app_page):
    """The chosen backend survives a page reload."""
    page = app_page

    page.evaluate("() => window.app.switchStorageBackend('session')")
    page.reload(wait_until="networkidle")

    backend = page.evaluate("() => window.app._storageBackendKind")
    assert backend == 'session'


@pytest.mark.feature
def test_clear_all_data_clears_active_backend_and_resets_preference(app_page):
    """clearAllData wipes whichever backend is active and resets the
    preference back to 'local', mirroring how it already resets the theme
    preference to a blank-slate state."""
    page = app_page

    result = page.evaluate("""() => {
        window.app.switchStorageBackend('session');
        window.app.clearAllData();
        return {
            session: sessionStorage.getItem('debtTrackerData'),
            local: localStorage.getItem('debtTrackerData'),
            pref: localStorage.getItem('debtTrackerStorageBackend'),
            backend: window.app._storageBackendKind
        };
    }""")

    assert result['session'] is None
    assert result['local'] is None
    assert result['pref'] == 'local'
    assert result['backend'] == 'local'


@pytest.mark.feature
def test_switch_storage_backend_failed_write_preserves_old_copy(app_page):
    """If the write to the new backend fails (e.g. quota exceeded, storage
    blocked), switchStorageBackend must not delete the old backend's copy or
    flip the active backend/preference — the user's only persisted data must
    survive the failed switch attempt."""
    page = app_page

    result = page.evaluate("""() => {
        window.app.debts = [{ id: 1, name: 'Keep Me', category: 'Other', debtType: 'creditCard', accountBalance: 15, originalBalance: 15, interestRate: 0, minimumPayment: 5, originalMinimumPayment: 5, priority: 1 }];
        window.app.saveToStorage();

        const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
        window.sessionStorage.setItem = () => { throw new Error('simulated quota exceeded'); };

        window.app.switchStorageBackend('session');

        window.sessionStorage.setItem = originalSetItem;

        return {
            backend: window.app._storageBackendKind,
            local: localStorage.getItem('debtTrackerData'),
            session: sessionStorage.getItem('debtTrackerData'),
            pref: localStorage.getItem('debtTrackerStorageBackend')
        };
    }""")

    assert result['backend'] == 'local'
    assert result['local'] is not None
    assert 'Keep Me' in result['local']
    assert result['session'] is None
    assert result['pref'] == 'local'
