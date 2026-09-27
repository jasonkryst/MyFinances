"""Server-side security tests for the calendar feed public endpoint (issue #212).

Requires: docker compose up (postgres stack at localhost:32900).
Tests verify response headers and token lifecycle behavior.
"""
import pytest

pytestmark = pytest.mark.asyncio

BASE = 'http://localhost:32900'


async def _wait_for_app_ready(page):
    await page.wait_for_function(
        "() => window.app && window.app._currentPage === 'health'",
        timeout=15000
    )


async def _login(page, base_url, credentials):
    await page.goto(base_url)
    await page.locator('#loginGate').wait_for(state='visible', timeout=8000)
    await page.fill('#loginGateEmail', credentials['email'])
    await page.fill('#loginGatePassword', credentials['password'])
    async with page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await page.click('.login-gate-submit')
    await page.locator('#loginGate').wait_for(state='hidden', timeout=12000)
    await _wait_for_app_ready(page)


async def _csrf(page):
    return await page.evaluate(
        "document.cookie.split('; ').find(r => r.startsWith('csrf='))?.split('=')[1] || ''"
    )


# ─── Public endpoint — no auth required ───────────────────────────────────────

async def test_public_calendar_invalid_token_returns_401(pg_page, base_url, credentials):
    """A malformed token is rejected before any DB query."""
    await _login(pg_page, base_url, credentials)
    r = await pg_page.request.get(f'{base_url}/calendar.ics', params={'token': 'notahextoken'})
    assert r.status == 401


async def test_public_calendar_missing_token_returns_401(pg_page, base_url, credentials):
    """A request with no token returns 401."""
    await _login(pg_page, base_url, credentials)
    r = await pg_page.request.get(f'{base_url}/calendar.ics')
    assert r.status == 401


async def test_public_calendar_unknown_token_returns_401(pg_page, base_url, credentials):
    """A correctly formatted but unrecognized 32-hex-char token returns 401."""
    await _login(pg_page, base_url, credentials)
    r = await pg_page.request.get(f'{base_url}/calendar.ics',
                                  params={'token': 'deadbeefdeadbeefdeadbeefdeadbeef'})
    assert r.status == 401


# ─── Response header tests ────────────────────────────────────────────────────

async def _get_calendar_token(page, base_url):
    """Generate (or regenerate) a calendar token for the authenticated session."""
    csrf = await _csrf(page)
    r = await page.request.post(f'{base_url}/api/calendar/token',
                                headers={'X-CSRF-Token': csrf})
    assert r.status == 200
    return (await r.json())['token']


async def test_public_calendar_cache_control_no_store(pg_page, base_url, credentials):
    """Valid token response must carry Cache-Control: no-store to prevent
    proxy/CDN caching of financial calendar data."""
    await _login(pg_page, base_url, credentials)
    token = await _get_calendar_token(pg_page, base_url)
    r = await pg_page.request.get(f'{base_url}/calendar.ics', params={'token': token})
    assert r.status == 200
    cc = r.headers.get('cache-control', '')
    assert 'no-store' in cc, f'Expected no-store in Cache-Control, got: {cc!r}'


async def test_public_calendar_x_robots_tag_noindex(pg_page, base_url, credentials):
    """Valid token response must carry X-Robots-Tag: noindex so search engines
    don't index the token URL if it ever appears in a shared link."""
    await _login(pg_page, base_url, credentials)
    token = await _get_calendar_token(pg_page, base_url)
    r = await pg_page.request.get(f'{base_url}/calendar.ics', params={'token': token})
    assert r.status == 200
    robots = r.headers.get('x-robots-tag', '')
    assert 'noindex' in robots, f'Expected noindex in X-Robots-Tag, got: {robots!r}'


async def test_public_calendar_content_type_is_text_calendar(pg_page, base_url, credentials):
    """Valid token response Content-Type must be text/calendar."""
    await _login(pg_page, base_url, credentials)
    token = await _get_calendar_token(pg_page, base_url)
    r = await pg_page.request.get(f'{base_url}/calendar.ics', params={'token': token})
    assert r.status == 200
    ct = r.headers.get('content-type', '')
    assert 'text/calendar' in ct, f'Expected text/calendar in Content-Type, got: {ct!r}'
