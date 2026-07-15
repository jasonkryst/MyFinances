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
