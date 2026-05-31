from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('console', lambda m: errors.append(('console', m.type, m.text)) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(('pageerror', 'error', str(e))))

    page.goto('http://localhost:5600', wait_until='networkidle', timeout=60000)
    print('active sections on load:', page.eval_on_selector_all('.page-section.active', 'els => els.map(e => e.id)'))
    print('account visible on load:', page.is_visible('#accountName'))
    page.click('button[data-page="accounts"]')
    page.wait_for_timeout(300)
    print('active sections after click:', page.eval_on_selector_all('.page-section.active', 'els => els.map(e => e.id)'))
    print('account visible after click:', page.is_visible('#accountName'))
    print('errors:', errors)

    browser.close()
