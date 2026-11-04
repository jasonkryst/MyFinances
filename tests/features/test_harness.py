"""Tests for the real-stack Playwright harness (v7.0.0 server-only storage).

The app has no local storage mode any more, so every test runs against the real
nginx + Node + Postgres stack, signed in as the single test user. These tests
pin the harness contract that every other test file builds on: `app_page` starts
empty and signed in, `seed_state` writes through the real REST API, and
`ensure_session` recovers from a lost session.
"""

from tests.conftest import ensure_session, seed_state


def test_app_page_starts_empty_and_signed_in(app_page):
    counts = app_page.evaluate(
        "() => ({ debts: app.debts.length, accounts: app.accounts.length })"
    )
    assert counts == {"debts": 0, "accounts": 0}
    assert app_page.locator("#loginGate").is_hidden()
    assert app_page.locator("#setupWizardModal").is_hidden()


def test_seed_state_persists_across_reload(app_page):
    seed_state(
        app_page,
        {"accounts": [{"id": 987654, "name": "Harness Checking", "type": "Checking", "balance": 100}]},
    )
    account = app_page.evaluate("() => ({ ...app.accounts[0] })")
    assert account["name"] == "Harness Checking"
    assert account["id"] != 987654, "id should be the server-assigned id, not the seed's"

    app_page.reload()
    assert app_page.evaluate("() => app.accounts.map(a => a.name)") == ["Harness Checking"]


def test_seed_replaces_previous_state(app_page):
    seed_state(
        app_page,
        {"accounts": [
            {"id": 1, "name": "First", "type": "Checking", "balance": 1},
            {"id": 2, "name": "Second", "type": "Savings", "balance": 2},
        ]},
    )
    assert app_page.evaluate("() => app.accounts.length") == 2

    seed_state(app_page, {"accounts": [{"id": 3, "name": "Only", "type": "Checking", "balance": 3}]})
    assert app_page.evaluate("() => app.accounts.map(a => a.name)") == ["Only"]


def test_harness_relogs_after_logout(app_page):
    status = app_page.evaluate(
        """async () => {
            const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf='))?.slice(5) || '';
            const r = await fetch('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } });
            return r.status;
        }"""
    )
    assert status < 400

    ensure_session(app_page.context)
    app_page.reload()
    assert app_page.locator("#loginGate").is_hidden()
