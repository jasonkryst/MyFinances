from playwright.sync_api import sync_playwright

pages = ['accounts', 'income', 'liabilities', 'recurring', 'savings', 'strategy', 'reports', 'ledger']

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5600', wait_until='networkidle', timeout=60000)

    for name in pages:
        page.click(f'button[data-page="{name}"]')
        page.wait_for_timeout(150)
        active = page.eval_on_selector_all('.page-section.active', 'els => els.map(e => e.id)')
        print(name, active)

    browser.close()
