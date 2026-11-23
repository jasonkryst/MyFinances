"""The browser-storage allowlist (spec section 3), in ONE place.

Used by tests/security/test_no_browser_financial_storage.py (static scan of the shipped
JavaScript) and tests/features/test_server_only_storage.py (runtime check of what
localStorage actually holds). Financial data never goes in browser storage; a new key
must be added here, with the operations and files it may use.
"""

# key -> (allowed operations, allowed file basenames or None for any scanned file)
ALLOWED_KEYS = {
    # Device preferences / transient UI state (spec section 3)
    'debtTrackerTheme': ({'getItem', 'setItem', 'removeItem'}, None),
    'debtTrackerLocale': ({'getItem', 'setItem'}, None),
    'debtTrackerCurrency': ({'getItem', 'setItem'}, None),
    'debtTrackerLastSeenVersion': ({'getItem', 'setItem'}, None),
    # Migration only (#571): filters live on the server; read + remove, never write
    'debtTrackerLedgerFilters': ({'getItem', 'removeItem'}, {'ledger.js'}),
    'ledgerHiddenColumns': ({'getItem', 'setItem', 'removeItem'}, None),
    'debtTrackerReconInProgress': ({'getItem', 'setItem', 'removeItem'}, None),
    # Migration only: read + remove, never write
    'debtTrackerData': ({'getItem', 'removeItem'}, {'app.js', 'pgMigrationModal.js'}),
    # Stale-preference cleanup at boot: remove only
    'debtTrackerStorageBackend': ({'removeItem'}, {'app.js'}),
}

# Keys the app may actually WRITE, so the only ones that can show up in a browser's
# localStorage at runtime (the read/remove-only migration keys never do).
WRITABLE_LOCAL_KEYS = frozenset(k for k, (ops, _files) in ALLOWED_KEYS.items() if 'setItem' in ops)

# Root-level JavaScript that ships to the browser and is therefore scanned like src/.
BROWSER_ROOT_JS = ('sw.js', 'env-config.js')
# Root-level JavaScript that is Node tooling and never reaches the browser.
NODE_ROOT_JS = ('jest.config.js', 'stryker.config.mjs', 'babel.config.cjs')
