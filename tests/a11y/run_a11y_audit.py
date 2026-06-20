#!/usr/bin/env python3
"""
Accessibility audit script for MyFinances.

Seeds the app with a realistic dataset (so every page renders populated
cards/tables/charts), then walks every SPA page (light + dark mode),
the mobile nav, key modals, and guide.html, running a battery of
accessibility checks via the Playwright/Chrome accessibility APIs and
small evaluate_script snippets (heading hierarchy, orphaned form
inputs, unnamed interactive elements, image alt text, color contrast,
dangling ARIA references, tap-target size, focus management).

Usage:
    python tests/a11y/run_a11y_audit.py > docs/audit/a11y/raw_findings.json

Requires the app to be served at http://localhost:5500/ (e.g.
`python -m http.server 5500` from the repo root).
"""

import json
import sys
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5500/"

PAGES = [
    "health", "accounts", "income", "liabilities", "recurring",
    "savings", "strategy", "reports", "ledger", "reconcile",
]

SAMPLE_DATA = {
    "version": "3.0",
    "accounts": [
        {"id": 1, "name": "Chase Checking", "type": "Checking", "startingBalance": 3500},
        {"id": 2, "name": "Ally Savings", "type": "Savings", "startingBalance": 12000},
        {"id": 3, "name": "Vanguard Brokerage", "type": "Investment", "startingBalance": 25000},
        {"id": 4, "name": "Visa Credit Card", "type": "Credit Card", "startingBalance": -1200},
    ],
    "debts": [
        {
            "id": 1, "name": "Visa Card", "debtType": "creditCard",
            "accountBalance": 4200, "originalBalance": 5000,
            "interestRate": 22.99, "minimumPayment": 120, "originalMinimumPayment": 120,
            "dueDate": 15, "category": "Credit Card", "priority": 50,
            "accountId": 1, "debtStartDate": "2024-01-15"
        },
        {
            "id": 2, "name": "Car Loan", "debtType": "fixedAmount",
            "fixedAmount": 350, "fixedStartDate": "2025-01-01", "fixedEndDate": "2028-01-01",
            "category": "Auto", "accountId": 1, "minimumPayment": 350,
            "originalMinimumPayment": 350, "accountBalance": 0, "originalBalance": 0,
            "interestRate": 0, "priority": 30
        },
    ],
    "incomes": [
        {"id": 1, "name": "Main Job", "amount": 3200, "firstPayDate": "2026-06-05", "frequency": "biweekly", "accountId": 1},
        {"id": 2, "name": "Side Gig", "amount": 600, "firstPayDate": "2026-06-15", "frequency": "monthly", "accountId": 1},
    ],
    "bonuses": [
        {"id": 1, "name": "Tax Refund", "amount": 1500, "date": "2026-06-20", "category": "Other", "accountId": 2},
    ],
    "bills": [
        {"id": 1, "name": "Rent", "amount": 1450, "dueDay": 1, "category": "Rent / Mortgage", "accountId": 1},
        {"id": 2, "name": "Electricity", "amount": 120, "dueDay": 10, "category": "Utilities", "accountId": 1},
    ],
    "expenses": [
        {"id": 1, "name": "Groceries", "budgetAmount": 450, "date": "2026-06-05", "category": "Food & Groceries", "accountId": 1},
        {"id": 2, "name": "Gym", "budgetAmount": 50, "date": "2026-06-01", "category": "Health & Fitness", "accountId": 1},
    ],
    "recurringTemplates": [
        {"id": 1, "name": "Netflix", "type": "subscription", "amount": 15.99, "frequency": "monthly", "dayOfMonth": 5, "category": "Subscription", "accountId": 1, "startDate": "2025-01-01", "endDate": None},
        {"id": 2, "name": "Freelance Reimbursement", "type": "reimbursement", "amount": 200, "frequency": "monthly", "dayOfMonth": 20, "category": "Other", "accountId": 1, "startDate": "2025-01-01", "endDate": None},
        {"id": 3, "name": "Savings Transfer", "type": "transfer", "amount": 300, "frequency": "monthly", "dayOfMonth": 1, "category": "Other", "accountId": 1, "targetAccountId": 2, "startDate": "2025-01-01", "endDate": None},
    ],
    "emergencyFunds": [
        {"id": 1, "accountId": 2, "targetAmount": 10000, "currentAmount": 6000, "monthlyContribution": 200, "autoContribute": True, "notes": "6-month cushion"},
    ],
    "sinkingFunds": [
        {"id": 1, "name": "Vacation", "allocationMethod": "target_date", "targetAmount": 3000, "currentAmount": 500, "accountId": 2, "autoContribute": True, "monthlyAllocation": 208, "notes": ""},
        {"id": 2, "name": "Car Maintenance", "allocationMethod": "annual", "targetAmount": 1200, "currentAmount": 300, "accountId": 2, "autoContribute": False, "monthlyAllocation": 100, "notes": ""},
    ],
    "reconciliations": [
        {"id": 1, "accountId": 1, "date": "2026-05-30", "previousBalance": 3400, "statementBalance": 3450, "difference": 50, "note": "May statement", "createdAt": "2026-05-30T12:00:00.000Z"},
    ],
    "monthlySnapshots": [
        {"date": "2026-04-30", "totalAssets": 40000, "totalLiabilities": 5500, "netWorth": 34500, "debtPaymentMade": 470, "incomeReceived": 6800, "source": "auto"},
        {"date": "2026-05-31", "totalAssets": 40800, "totalLiabilities": 5200, "netWorth": 35600, "debtPaymentMade": 470, "incomeReceived": 6800, "source": "auto"},
    ],
    "netWorthMilestonesAwarded": [],
    "perMonthStimulus": [],
    "monthlyPayment": 800,
    "strategy": "avalanche",
    "ledgerAmountOverrides": {},
    "ledgerSettings": {"accountFilter": "all", "dateRange": "all", "sortKey": "date", "sortDir": "desc"},
    "forecastSettings": {"rangeMonths": 3, "accountId": "total", "notableThresholdPct": 130},
}


# ── Evaluate-script snippets ────────────────────────────────────────────────

JS_HEADINGS = """
() => Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(h => h.offsetParent !== null || h.getClientRects().length > 0)
    .map(h => ({ level: parseInt(h.tagName[1], 10), text: h.textContent.trim().slice(0, 70) }))
"""

JS_ORPHANED_INPUTS = """
() => {
    const out = [];
    document.querySelectorAll('input,select,textarea').forEach(el => {
        if (el.type === 'hidden') return;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const id = el.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = el.getAttribute('aria-label');
        const hasAriaLabelledby = el.getAttribute('aria-labelledby') &&
            document.getElementById(el.getAttribute('aria-labelledby'));
        const wrappedInLabel = el.closest('label');
        if (!hasLabel && !hasAriaLabel && !hasAriaLabelledby && !wrappedInLabel) {
            out.push({
                tag: el.tagName, id: id || null, name: el.name || null,
                type: el.type || null, placeholder: el.placeholder || null
            });
        }
    });
    return out;
}
"""

JS_UNNAMED_INTERACTIVE = """
() => {
    const out = [];
    document.querySelectorAll('button, a[href], [role="button"], [role="tab"]').forEach(el => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const text = (el.textContent || '').trim();
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledby = el.getAttribute('aria-labelledby');
        const title = el.getAttribute('title');
        if (!text && !ariaLabel && !ariaLabelledby && !title) {
            out.push({ tag: el.tagName, id: el.id || null, class: el.className || null,
                       html: el.outerHTML.slice(0, 160) });
        }
    });
    return out;
}
"""

JS_IMAGES_NO_ALT = """
() => Array.from(document.querySelectorAll('img'))
    .filter(img => !img.hasAttribute('alt'))
    .map(img => ({ src: img.src, class: img.className }))
"""

JS_DANGLING_ARIA_REFS = """
() => {
    const out = [];
    const attrs = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns'];
    document.querySelectorAll('*').forEach(el => {
        attrs.forEach(attr => {
            const val = el.getAttribute(attr);
            if (!val) return;
            val.split(/\\s+/).forEach(refId => {
                if (!document.getElementById(refId)) {
                    out.push({ tag: el.tagName, id: el.id || null, attr, refId });
                }
            });
        });
    });
    return out;
}
"""

JS_DUPLICATE_IDS = """
() => {
    const seen = {};
    document.querySelectorAll('[id]').forEach(el => {
        seen[el.id] = (seen[el.id] || 0) + 1;
    });
    return Object.entries(seen).filter(([id, n]) => n > 1).map(([id, n]) => ({ id, count: n }));
}
"""

JS_CONTRAST = """
() => {
    function parseColor(str) {
        const m = str.match(/[\\d.]+/g);
        return m ? m.map(Number) : [0, 0, 0];
    }
    function luminance([r, g, b]) {
        const a = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }
    function ratio(fg, bg) {
        const l1 = luminance(fg), l2 = luminance(bg);
        const [a, b] = [Math.max(l1, l2), Math.min(l1, l2)];
        return (a + 0.05) / (b + 0.05);
    }
    function getBg(el) {
        let node = el;
        while (node) {
            const c = getComputedStyle(node).backgroundColor;
            const rgba = c.match(/[\\d.]+/g);
            if (rgba && (rgba.length < 4 || parseFloat(rgba[3]) > 0)) return c;
            node = node.parentElement;
        }
        return 'rgb(255,255,255)';
    }
    const out = [];
    const seen = new Set();
    document.querySelectorAll('body *').forEach(el => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (parseFloat(style.opacity) === 0) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const text = Array.from(el.childNodes)
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim()).join('');
        if (!text) return;
        const fg = parseColor(style.color);
        const bgStr = getBg(el);
        const bg = parseColor(bgStr);
        const r = ratio(fg, bg);
        const fontSize = parseFloat(style.fontSize);
        const fontWeight = parseInt(style.fontWeight) || 400;
        const isLarge = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
        const threshold = isLarge ? 3 : 4.5;
        if (r < threshold) {
            const key = `${el.tagName}|${el.className}|${style.color}|${bgStr}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({
                tag: el.tagName, class: el.className || null,
                text: text.slice(0, 40), color: style.color, bg: bgStr,
                ratio: Math.round(r * 100) / 100, threshold, fontSize, fontWeight
            });
        }
    });
    return out;
}
"""

JS_LANDMARKS = """
() => ({
    lang: document.documentElement.getAttribute('lang'),
    hasMain: !!document.querySelector('main, [role="main"]'),
    navCount: document.querySelectorAll('nav, [role="navigation"]').length,
    h1Count: Array.from(document.querySelectorAll('h1')).filter(h => h.offsetParent !== null).length,
    title: document.title
})
"""

JS_TAP_TARGETS = """
() => Array.from(document.querySelectorAll('.page-button, .nav-toggle, button'))
    .map(b => {
        const r = b.getBoundingClientRect();
        return { text: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24),
                 id: b.id || null, w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter(b => b.w > 0 && b.h > 0 && (b.w < 44 || b.h < 44))
"""


def run_checks(page, label, results, include_contrast=True, include_structure=True):
    entry = {}
    if include_structure:
        entry["headings"] = page.evaluate(JS_HEADINGS)
        entry["orphaned_inputs"] = page.evaluate(JS_ORPHANED_INPUTS)
        entry["unnamed_interactive"] = page.evaluate(JS_UNNAMED_INTERACTIVE)
        entry["images_no_alt"] = page.evaluate(JS_IMAGES_NO_ALT)
        entry["dangling_aria_refs"] = page.evaluate(JS_DANGLING_ARIA_REFS)
        entry["duplicate_ids"] = page.evaluate(JS_DUPLICATE_IDS)
    if include_contrast:
        entry["contrast_issues"] = page.evaluate(JS_CONTRAST)
    results[label] = entry


def collect_audit_findings(headless=True):
    """Run the full accessibility audit and return the raw findings dict.

    This is the reusable core of the standalone script: it seeds the app
    with SAMPLE_DATA, walks every SPA page (light + dark mode), the mobile
    nav, key modals, and guide.html, and returns the same structure that
    `main()` prints as JSON. Factored out so it can be called both from the
    CLI entry point below and from `tests/a11y/test_a11y_audit.py`.
    """
    results = {"console_errors": [], "pages": {}, "dark_mode_contrast": {},
                "modals": {}, "mobile": {}, "guide": {}, "landmarks": {}}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)

        # ── Desktop pass ────────────────────────────────────────────────
        page = browser.new_page(viewport={"width": 1366, "height": 900})
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
        page.evaluate("(data) => localStorage.setItem('debtTrackerData', JSON.stringify(data))", SAMPLE_DATA)
        page.evaluate("() => localStorage.setItem('debtTrackerTheme', 'light')")
        page.reload(wait_until="networkidle")

        results["landmarks"]["index"] = page.evaluate(JS_LANDMARKS)

        for name in PAGES:
            page.evaluate("(p) => window.app.switchPage(p)", name)
            page.wait_for_timeout(250)
            run_checks(page, name, results["pages"])

        # ── Dark mode contrast pass ────────────────────────────────────
        page.click("#themeSwitcher")
        page.wait_for_timeout(150)
        for name in PAGES:
            page.evaluate("(p) => window.app.switchPage(p)", name)
            page.wait_for_timeout(150)
            results["dark_mode_contrast"][name] = page.evaluate(JS_CONTRAST)
        page.click("#themeSwitcher")  # back to light
        page.wait_for_timeout(150)

        # ── Modal checks ────────────────────────────────────────────────
        # Update Balance modal (Liabilities > Debts)
        page.evaluate("(p) => window.app.switchPage(p)", "liabilities")
        page.wait_for_timeout(200)
        update_btn = page.query_selector('[data-debt-action="update-balance"]')
        modal_result = {}
        if update_btn:
            update_btn.click()
            page.wait_for_timeout(200)
            modal_result["update_balance_focus"] = page.evaluate(
                "() => ({ id: document.activeElement.id, tag: document.activeElement.tagName, "
                "modalHidden: document.getElementById('updateBalanceModal')?.classList.contains('hidden') })"
            )
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            modal_result["update_balance_after_escape"] = page.evaluate(
                "() => ({ modalHidden: document.getElementById('updateBalanceModal')?.classList.contains('hidden'), "
                "activeId: document.activeElement.id })"
            )
        else:
            modal_result["update_balance_focus"] = "trigger not found"
        results["modals"]["update_balance"] = modal_result

        # Reconcile modal
        page.evaluate("(p) => window.app.switchPage(p)", "reconcile")
        page.wait_for_timeout(200)
        recon_modal = {}
        try:
            page.evaluate("() => window.app.openReconcileModal(1)")
            page.wait_for_timeout(200)
            recon_modal["open_focus"] = page.evaluate(
                "() => ({ id: document.activeElement.id, modalHidden: document.getElementById('reconcileModal')?.classList.contains('hidden') })"
            )
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            recon_modal["after_escape"] = page.evaluate(
                "() => ({ modalHidden: document.getElementById('reconcileModal')?.classList.contains('hidden') })"
            )
        except Exception as e:
            recon_modal["error"] = str(e)
        results["modals"]["reconcile"] = recon_modal

        # Amortization modal (Plan page) - requires a calculated plan
        page.evaluate("(p) => window.app.switchPage(p)", "strategy")
        page.wait_for_timeout(200)
        amort = {}
        try:
            page.evaluate("() => { window.app.calculatePaymentPlanFromInputs(); }")
            page.wait_for_timeout(300)
            # The "View" amortization button lives in the Debt Summary results
            # tab, which is not the default-active tab (Overview is) - switch
            # to it first or the button is present but zero-size/unclickable.
            debt_summary_tab = page.query_selector('[data-rtab="debt-summary"]')
            if debt_summary_tab:
                debt_summary_tab.click()
                page.wait_for_timeout(200)
            amort_btn = page.query_selector('[data-amortization]')
            if amort_btn:
                amort_btn.click()
                page.wait_for_timeout(200)
                amort["open_focus"] = page.evaluate(
                    "() => ({ id: document.activeElement.id, tag: document.activeElement.tagName, "
                    "modalHidden: document.getElementById('amortizationModal')?.classList.contains('hidden') })"
                )
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)
                amort["after_escape"] = page.evaluate(
                    "() => ({ modalHidden: document.getElementById('amortizationModal')?.classList.contains('hidden'), "
                    "activeId: document.activeElement.id })"
                )
            else:
                amort["note"] = "amortization trigger [data-amortization] not found"
        except Exception as e:
            amort["error"] = str(e)
        results["modals"]["amortization"] = amort

        # ── Keyboard tab order on Accounts page ────────────────────────
        page.evaluate("(p) => window.app.switchPage(p)", "accounts")
        page.wait_for_timeout(200)
        page.evaluate("() => document.body.focus()")
        tab_order = []
        for _ in range(8):
            page.keyboard.press("Tab")
            tab_order.append(page.evaluate(
                "() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, "
                "text: (document.activeElement.textContent||'').trim().slice(0,30) })"
            ))
        results["modals"]["tab_order_accounts"] = tab_order

        results["console_errors"] = console_errors
        page.close()

        # ── Mobile pass ─────────────────────────────────────────────────
        mpage = browser.new_page(viewport={"width": 375, "height": 667})
        mpage.goto(BASE_URL, wait_until="networkidle", timeout=60000)
        mpage.evaluate("(data) => localStorage.setItem('debtTrackerData', JSON.stringify(data))", SAMPLE_DATA)
        mpage.reload(wait_until="networkidle")

        results["mobile"]["tap_targets"] = mpage.evaluate(JS_TAP_TARGETS)
        nav_toggle = mpage.query_selector("#navToggle")
        if nav_toggle:
            before = mpage.evaluate("() => document.getElementById('navToggle').getAttribute('aria-expanded')")
            nav_toggle.click()
            mpage.wait_for_timeout(200)
            after = mpage.evaluate("() => document.getElementById('navToggle').getAttribute('aria-expanded')")
            results["mobile"]["nav_toggle_aria_expanded"] = {"before": before, "after": after}
            results["mobile"]["nav_menu_visible_after_open"] = mpage.evaluate(
                "() => { const m = document.getElementById('navMenu'); "
                "return m ? getComputedStyle(m).display !== 'none' : null; }"
            )
        mpage.close()

        # ── guide.html ──────────────────────────────────────────────────
        gpage = browser.new_page(viewport={"width": 1366, "height": 900})
        gpage.goto(BASE_URL + "guide.html", wait_until="networkidle", timeout=60000)
        results["landmarks"]["guide"] = gpage.evaluate(JS_LANDMARKS)
        run_checks(gpage, "guide", results["guide"])
        gpage.close()

        browser.close()

    return results


def main():
    results = collect_audit_findings(headless=True)
    print(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main()
