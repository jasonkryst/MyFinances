"""Path-address routing (#730): nested deep links must load the app.

Later routing tasks append to this file. Shared helpers live at the top.
"""

import time

from tests.conftest import BASE_URL, wait_for_app_ready

BASE = BASE_URL if BASE_URL.endswith("/") else BASE_URL + "/"


def _wait_for_active_service_worker(page, timeout_ms=15000):
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        active = page.evaluate("""
            async () => {
                const reg = await navigator.serviceWorker.getRegistration();
                return !!(reg && reg.active);
            }
        """)
        if active:
            return True
    return False


def test_nested_path_boots_without_errors(app_page):
    page = app_page
    errors = []
    bad_scripts = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    def check_response(resp):
        if "/src/" in resp.url and resp.url.endswith(".js") and resp.status == 200:
            ctype = resp.headers.get("content-type", "")
            if "javascript" not in ctype:
                bad_scripts.append((resp.url, resp.status, ctype))

    page.on("response", check_response)
    page.goto(BASE + "liabilities/expenses", wait_until="networkidle", timeout=60000)
    wait_for_app_ready(page)

    assert page.evaluate("() => !!window.app")
    assert not bad_scripts, f"non-JavaScript src responses: {bad_scripts}"
    assert not errors, f"console errors on a nested path: {errors}"


def test_offline_deep_link_serves_shell(browser, stack_user):
    from tests.conftest import ensure_session

    context = browser.new_context()
    ensure_session(context)
    page = context.new_page()
    try:
        page.goto(BASE, wait_until="networkidle", timeout=60000)
        wait_for_app_ready(page)
        assert _wait_for_active_service_worker(page), "service worker never became active"
        page.evaluate("async () => { await navigator.serviceWorker.ready; }")

        context.set_offline(True)
        page.goto(BASE + "reports/forecast", wait_until="load", timeout=15000)

        assert page.locator("#healthSection").count() == 1, "expected the cached app shell offline"
    finally:
        context.set_offline(False)
        context.close()
