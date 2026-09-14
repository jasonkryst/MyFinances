"""Tests that /auth/register is gated behind the ALLOW_SETUP env var (issue #156).

The CI postgres job runs the server WITHOUT ALLOW_SETUP=true, so this test
verifies the closed state. Locally, if ALLOW_SETUP is set, the test skips.
"""
import os
import pytest
import httpx

pytestmark = pytest.mark.asyncio

BASE = 'http://localhost:32900'


async def test_register_returns_404_when_allow_setup_not_set():
    """POST /auth/register must return 404 when ALLOW_SETUP is not 'true'."""
    if os.environ.get('ALLOW_SETUP') == 'true':
        pytest.skip('ALLOW_SETUP is set — register gate is open, test not applicable')
    async with httpx.AsyncClient() as client:
        r = await client.post(f'{BASE}/auth/register',
                              json={'email': 'attacker@example.com',
                                    'password': 'password123456'})
    assert r.status_code == 404
    body = r.json()
    assert body['error']['code'] == 'NOT_FOUND'
