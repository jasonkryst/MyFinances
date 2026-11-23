"""#581: Settings -> Security -> API tokens.

Create a read-only token, see it once, use it from a cookie-less client (GET
works, writes and credential routes are refused), and revoke it.
"""
import re

import pytest

from tests.conftest import BASE_URL, open_settings_page


def _clear_tokens(page):
    page.evaluate("""async () => {
        const { getCsrfCookie } = await import('/src/storage.js');
        const list = await (await fetch('/api/api-tokens')).json();
        for (const t of list) {
            const r = await fetch('/api/api-tokens/' + t.id, { method: 'DELETE', headers: { 'X-CSRF-Token': getCsrfCookie() } });
            await r.text();
        }
    }""")


def _show_security(page):
    open_settings_page(page, 'security')
    page.wait_for_function("() => !document.getElementById('settingsApiTokensEmpty').classList.contains('hidden') "
                           "|| document.querySelectorAll('#settingsApiTokensList > li').length > 0")


def _client(browser, token):
    """A cookie-less API client using only the bearer token."""
    return browser.new_context(base_url=BASE_URL, extra_http_headers={'Authorization': f'Bearer {token}'})


@pytest.mark.feature
def test_empty_state_and_blank_name_is_rejected(app_page):
    page = app_page
    _clear_tokens(page)
    _show_security(page)
    assert page.is_visible('#settingsApiTokensEmpty')
    assert page.locator('#settingsApiTokensList > li').count() == 0
    page.click('#settingsApiTokenCreateBtn')
    assert page.inner_text('#settingsApiTokensError') == 'Enter a name for the token.'
    assert page.get_attribute('#settingsApiTokenName', 'aria-invalid') == 'true'
    assert page.is_hidden('#settingsApiTokenReveal')
    assert page.evaluate("fetch('/api/api-tokens').then(r => r.json()).then(l => l.length)") == 0


@pytest.mark.feature
def test_create_use_and_revoke_a_token(app_page, browser):
    page = app_page
    _clear_tokens(page)
    _show_security(page)
    page.fill('#settingsApiTokenName', 'Home dashboard')
    page.click('#settingsApiTokenCreateBtn')
    page.wait_for_selector('#settingsApiTokenReveal:not(.hidden)')
    token = page.input_value('#settingsApiTokenValue')
    assert re.fullmatch(r'mft_[A-Za-z0-9_-]{43}', token)
    assert page.inner_text('#settingsApiTokensStatus') == 'Created Home dashboard.'
    rows = page.locator('#settingsApiTokensList > li')
    assert rows.count() == 1
    assert 'Home dashboard' in rows.first.inner_text()
    assert 'Last used never' in rows.first.inner_text()
    assert token not in rows.first.inner_text(), 'only the prefix is listed'
    assert page.is_hidden('#settingsApiTokensEmpty')

    client = _client(browser, token)
    try:
        assert client.request.get('api/accounts').status == 200
        write = client.request.post('api/accounts', data={'name': 'Evil', 'type': 'Checking'})
        assert write.status == 403
        assert write.json()['error']['code'] == 'TOKEN_READ_ONLY'
        assert client.request.get('api/sessions').status == 403
        assert client.request.get('api/api-tokens').status == 403

        # Showing the page again never shows the token again, and lists its use.
        open_settings_page(page, 'appearance')
        _show_security(page)
        assert page.is_hidden('#settingsApiTokenReveal')
        assert page.input_value('#settingsApiTokenValue') == ''
        assert 'Last used never' not in page.locator('#settingsApiTokensList > li').first.inner_text()

        page.get_by_role('button', name='Revoke Home dashboard').click()
        page.wait_for_function("() => document.querySelectorAll('#settingsApiTokensList > li').length === 0")
        assert page.inner_text('#settingsApiTokensStatus') == 'Revoked Home dashboard.'
        assert page.is_visible('#settingsApiTokensEmpty')
        assert client.request.get('api/accounts').status == 401
    finally:
        client.close()
