"""Tests for the password-reset flow (issue #176).

API tests use httpx against the running Docker stack (localhost:32900).
UI tests use Playwright via the pg_page fixture.

Requires: docker compose up (postgres stack at localhost:32900).
"""
import re
import pytest
import httpx
from playwright.async_api import expect

pytestmark = pytest.mark.asyncio

BASE = 'http://localhost:32900'


async def test_forgot_password_always_returns_200_for_unknown_email():
    """Never reveals whether the email is registered."""
    async with httpx.AsyncClient() as client:
        r = await client.post(f'{BASE}/auth/forgot-password',
                              json={'email': 'nobody@example.com'})
    assert r.status_code == 200
    assert r.json().get('ok') is True


async def test_forgot_password_returns_200_for_empty_email():
    """Missing email is not an error — same generic success response."""
    async with httpx.AsyncClient() as client:
        r = await client.post(f'{BASE}/auth/forgot-password', json={})
    assert r.status_code == 200


async def test_reset_password_with_invalid_token_returns_400():
    async with httpx.AsyncClient() as client:
        r = await client.post(f'{BASE}/auth/reset-password',
                              json={'token': 'notavalidtoken000000',
                                    'newPassword': 'newpassword123456'})
    assert r.status_code == 400
    body = r.json()
    assert body['error']['code'] == 'INVALID_TOKEN'


async def test_reset_password_short_password_returns_400():
    async with httpx.AsyncClient() as client:
        r = await client.post(f'{BASE}/auth/reset-password',
                              json={'token': 'anytoken', 'newPassword': 'short'})
    assert r.status_code == 400
    body = r.json()
    assert body['error']['code'] == 'VALIDATION_FAILED'


async def test_reset_password_missing_fields_returns_400():
    async with httpx.AsyncClient() as client:
        r = await client.post(f'{BASE}/auth/reset-password', json={})
    assert r.status_code == 400


async def test_forgot_password_ui_shows_link_on_login_gate(pg_page, base_url):
    """Login gate shows a 'Forgot password?' button."""
    await pg_page.goto(base_url)
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)

    forgot_btn = pg_page.locator('#loginGateForgotBtn')
    await forgot_btn.wait_for(state='visible', timeout=5000)
    assert await forgot_btn.is_visible()


async def test_forgot_password_ui_shows_confirmation_after_submit(pg_page, base_url):
    """Submitting the forgot-password form shows a generic confirmation message."""
    await pg_page.goto(base_url)
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)

    await pg_page.locator('#loginGateForgotBtn').click()

    forgot_form = pg_page.locator('#loginGateForgotForm')
    await forgot_form.wait_for(state='visible', timeout=3000)

    await pg_page.fill('#loginGateForgotEmail', 'test@example.com')
    await pg_page.locator('#loginGateForgotForm button[type=submit]').click()

    # replaceChildren() swaps the form's content with a single confirmation <p>,
    # removing the submit button in the process — wait for that as the signal.
    await pg_page.locator('#loginGateForgotForm button[type=submit]').wait_for(
        state='hidden', timeout=5000
    )
    content = await pg_page.locator('#loginGateForgotForm p').first.text_content()
    assert content and len(content.strip()) > 0


async def test_reset_password_ui_shown_when_token_in_url(pg_page, base_url):
    """Navigating with ?reset_token=... shows the reset-password form."""
    await pg_page.goto(f'{base_url}/?reset_token=sometoken123')
    await pg_page.locator('#loginGate').wait_for(state='visible', timeout=8000)

    reset_form = pg_page.locator('#loginGateResetForm')
    await reset_form.wait_for(state='visible', timeout=3000)
    assert await reset_form.is_visible()

    # Login form should be hidden
    assert not await pg_page.locator('#loginGateForm').is_visible()
