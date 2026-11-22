#!/usr/bin/env python3
"""
Label in Name (WCAG 2.5.3, issue #496).

A control's accessible name (aria-label) must contain its visible text, and
should start with it, so speech-input users can say what they see. Covers the
Accounts "See breakdown" and "Go to linked" buttons, the debt-card "Accelerate
this debt" button, the Recurring Overdue filter and the Reports calendar day
cells, plus a negative test proving the checker flags a mismatch.
"""

from datetime import date

import pytest

# Returns {label, text, ok} for each element matching `sel`. Visible text is
# innerText with whitespace collapsed, lowercased, decorative arrows and
# symbols (arrows, the transfer glyph) trimmed from the ends.
CHECK_JS = """
(sel) => {
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const strip = s => norm(s).replace(/^[\\u2190-\\u21ff\\u2200-\\u22ff]+\\s*/, '').replace(/\\s*[\\u2190-\\u21ff]+$/, '').trim();
  return [...document.querySelectorAll(sel)].map(el => {
    const label = norm(el.getAttribute('aria-label'));
    const text = strip(el.innerText);
    return { id: el.outerHTML.slice(0, 100), label, text, ok: !!label && label.startsWith(text) };
  });
}
"""


def _seed(page):
    page.wait_for_function('() => window.app && typeof window.app.updateUI === "function"', timeout=10000)
    page.evaluate("""() => {
        const app = window.app;
        const d = new Date();
        const iso = (day) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        app.accounts = [{ id: 9001, name: 'Main Checking', type: 'Checking', startingBalance: 2000, interestRate: 0 }];
        app.incomes = [{ id: 9101, name: 'Paycheck', amount: 3000, firstPayDate: iso(1), frequency: 'monthly', accountId: 9001 }];
        app.bonuses = []; app.bills = []; app.expenses = [];
        app.debts = [{ id: 9201, name: 'Visa card', accountBalance: 800, originalBalance: 800, minimumPayment: 40,
                       interestRate: 20, dueDate: 15, debtType: 'creditCard', accountId: 9001 }];
        app.recurringTemplates = [{ id: 9401, name: 'Past Due Bill', amount: 50, frequency: 'monthly', dayOfMonth: 1,
            type: 'subscription', category: 'Bills', accountId: 9001, startDate: `${d.getFullYear()}-01-01`,
            paused: false, archived: false, skippedMonths: [], paidMonths: [] }];
        app.updateUI();
    }""")


def _go(page, name):
    page.click(f'button[data-page="{name}"]')
    page.wait_for_selector(f'[data-page="{name}"].active', timeout=5000)
    page.wait_for_timeout(250)


def _assert_all_ok(page, sel, minimum=1):
    rows = page.evaluate(CHECK_JS, sel)
    assert len(rows) >= minimum, f"No elements matched {sel}"
    bad = [r for r in rows if not r["ok"]]
    assert bad == [], f"Accessible name does not start with visible text for {sel}: {bad}"


@pytest.fixture
def seeded(app_page):
    _seed(app_page)
    return app_page


@pytest.mark.ui
def test_accounts_buttons_label_in_name(seeded):
    page = seeded
    _go(page, "accounts")
    _assert_all_ok(page, '[data-account-action="breakdown"]')
    _assert_all_ok(page, "[data-account-nav-page]")


@pytest.mark.ui
def test_accounts_breakdown_modal_view_in_ledger_label_in_name(seeded):
    page = seeded
    _go(page, "accounts")
    page.click('[data-account-action="breakdown"]')
    page.wait_for_selector("#acctBreakdownViewLedgerBtn", timeout=5000)
    _assert_all_ok(page, "#acctBreakdownViewLedgerBtn")
    _assert_all_ok(page, "#acctBreakdownClose")


@pytest.mark.ui
def test_accelerate_button_label_in_name(seeded):
    page = seeded
    _go(page, "liabilities")
    page.wait_for_selector("[data-be-show]", timeout=5000)
    _assert_all_ok(page, "[data-be-show]")
    page.click("[data-be-show]")
    page.wait_for_selector("[data-be-accelerate]", timeout=5000)
    _assert_all_ok(page, "[data-be-accelerate]")


@pytest.mark.ui
def test_recurring_overdue_filter_label_in_name(seeded):
    if date.today().day <= 1:
        pytest.skip("Overdue needs a due day that has already passed this month")
    page = seeded
    page.evaluate("() => window.app.switchPage('recurring')")
    page.wait_for_selector("#recurringOverdueFilterBtn", timeout=5000)
    _assert_all_ok(page, "#recurringOverdueFilterBtn")
    page.click("#recurringOverdueFilterBtn")
    page.wait_for_selector('#recurringOverdueFilterBtn[aria-pressed="true"]', timeout=5000)
    _assert_all_ok(page, "#recurringOverdueFilterBtn")


@pytest.mark.ui
def test_reports_calendar_day_cells_label_in_name(seeded):
    page = seeded
    page.click('button[data-page="reports"]')
    page.wait_for_selector("#reportsSection.active", timeout=5000)
    page.click('[data-rptab="calendar"]')
    page.wait_for_selector("#rptPanel-calendar.rpt-tab-panel--active", timeout=5000)
    page.wait_for_selector("[data-cal-day]", timeout=10000)
    _assert_all_ok(page, "[data-cal-day]")


@pytest.mark.ui
def test_checker_flags_mismatched_name(seeded):
    """Negative: a control whose aria-label does not start with its text is flagged."""
    page = seeded
    page.evaluate("""() => {
        const b = document.createElement('button');
        b.id = 'lcnBad';
        b.setAttribute('aria-label', 'Something else');
        b.textContent = 'Visible';
        document.body.appendChild(b);
        const g = document.createElement('button');
        g.id = 'lcnGood';
        g.setAttribute('aria-label', 'Visible: more context');
        g.textContent = 'Visible \u2192';
        document.body.appendChild(g);
    }""")
    bad = page.evaluate(CHECK_JS, "#lcnBad")
    good = page.evaluate(CHECK_JS, "#lcnGood")
    assert bad[0]["ok"] is False
    assert good[0]["ok"] is True
