"""Path-address routing (#730): nested deep links must load the app.

Later routing tasks append to this file. Shared helpers live at the top.
"""

from tests.conftest import BASE_URL, wait_for_app_ready

BASE = BASE_URL if BASE_URL.endswith("/") else BASE_URL + "/"


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
