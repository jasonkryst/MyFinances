"""
Postgres migration negative-path test.

The legacy browser-data prompts (import, decline, failure, cleanup variant,
Escape, unparseable key) live in tests/postgres/test_legacy_local_data.py since
v7.0.0 (server-only storage). This file keeps only the "no prompt without a
legacy key" check.
"""
import pytest

from tests.postgres.conftest import sign_in

pytestmark = pytest.mark.asyncio


async def test_migration_not_shown_when_no_local_data(pg_page, base_url):
    """No migration modal when localStorage has no debtTrackerData."""
    await sign_in(pg_page, base_url, wipe=True)
    await pg_page.wait_for_function(
        "() => window.app && window.app._currentPage === 'health'", timeout=15000
    )
    assert not await pg_page.locator("#pgMigrationModal").is_visible(), \
        "Migration modal shown unexpectedly when no local data present"
