#!/usr/bin/env python3
"""
ARIA label audit (issue #331).

Every interactive control (button / [role=button] / [role=tab]) must expose a
non-empty accessible name; icon-only and per-item action buttons must name the
item they act on; toggle buttons must expose aria-pressed in sync with their
state; sort headers must expose their direction. Item names are user data and
must reach aria-label attributes as literal text (never as markup).
"""

import pytest

EVIL = "<img src=x onerror=alert(1)>"

# JS accessible-name approximation: aria-labelledby > aria-label > text > title > img alt > value
ACCESSIBLE_NAME_JS = """
() => {
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };
  const nameOf = el => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (t) return t;
    }
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    const tx = (el.textContent || '').trim();
    if (tx) return tx;
    const img = el.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    return (el.getAttribute('title') || el.value || '').trim();
  };
  const bad = [];
  document.querySelectorAll('button, [role=button], [role=tab]').forEach(el => {
    if (!visible(el)) return;
    if (!nameOf(el)) bad.push((el.id ? '#' + el.id : el.className || el.tagName) + ' :: ' + el.outerHTML.slice(0, 120));
  });
  return bad;
}
"""


def _seed(page):
    page.wait_for_function('() => window.app && typeof window.app.updateUI === "function"', timeout=10000)
    page.evaluate("""(evil) => {
        const app = window.app;
        const d = new Date();
        const iso = (day) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        app.accounts = [
            { id: 7001, name: 'Main Checking', type: 'Checking', startingBalance: 2000, interestRate: 0 },
            { id: 7002, name: 'Retire 401k', type: 'Retirement', retirementSubtype: '401k', startingBalance: 5000, rateOfReturn: 6, employerMatchPercent: 0 }
        ];
        app.incomes = [{ id: 7101, name: 'Paycheck', amount: 3000, firstPayDate: iso(1), frequency: 'monthly', accountId: 7001 }];
        app.bonuses = [{ id: 7102, name: 'Spot Bonus', amount: 500, date: iso(10), accountId: 7001 }];
        app.debts = [
            { id: 7201, name: 'Visa card', accountBalance: 800, originalBalance: 800, minimumPayment: 40, interestRate: 20, dueDate: 15, debtType: 'creditCard', accountId: 7001 },
            { id: 7202, name: evil, accountBalance: 3000, originalBalance: 3000, minimumPayment: 100, interestRate: 8, dueDate: 20, debtType: 'loan', accountId: 7001 }
        ];
        app.bills = [];
        app.expenses = [{ id: 7301, name: 'Groceries', budgetAmount: 300, date: iso(12), category: 'Food', accountId: 7001 }];
        app.recurringTemplates = [{ id: 7401, name: 'Netflix', amount: 16, type: 'Subscription', frequency: 'monthly', startDate: iso(1), accountId: 7001 }];
        app.persons = [{ id: 7501, name: 'Alice' }];
        app.emergencyFunds = [{ id: 7601, name: 'Rainy Day', accountId: 7001, currentAmount: 1000, targetAmount: 5000, monthlyContribution: 100 }];
        app.sinkingFunds = [{ id: 7602, name: 'Vacation Fund', accountId: 7001, currentAmount: 500, targetAmount: 3000, monthlyAllocation: 100 }];
        app.retirementSnapshots = [{ id: 7701, accountId: 7002, date: iso(1), balance: 5000, contribution: 100 }];
        app.updateUI();
    }""", EVIL)


def _go(page, name):
    page.click(f'button[data-page="{name}"]')
    page.wait_for_selector(f'[data-page="{name}"].active', timeout=5000)
    page.wait_for_timeout(250)


@pytest.fixture
def seeded(app_page):
    page = app_page
    _seed(page)
    return page


@pytest.mark.ui
@pytest.mark.parametrize("pageName", [
    "health", "accounts", "income", "people", "liabilities", "recurring",
    "savings", "strategy", "reports", "ledger", "reconcile", "retirement",
])
def test_every_visible_control_has_accessible_name(seeded, pageName):
    page = seeded
    _go(page, pageName)
    bad = page.evaluate(ACCESSIBLE_NAME_JS)
    assert bad == [], f"Controls without an accessible name on {pageName}: {bad}"


@pytest.mark.ui
def test_liabilities_budget_subtab_has_names(seeded):
    page = seeded
    _go(page, "liabilities")
    page.click('[data-liabilities-subtab="expenses"]')
    page.wait_for_timeout(250)
    assert page.evaluate(ACCESSIBLE_NAME_JS) == []


@pytest.mark.ui
@pytest.mark.parametrize("tab", ["calendar", "spending", "incomeexp", "moneyflow", "variance", "networth", "forecast", "summary"])
def test_reports_subtabs_have_names(seeded, tab):
    page = seeded
    _go(page, "reports")
    page.click(f'[data-rptab="{tab}"]')
    page.wait_for_timeout(400)
    assert page.evaluate(ACCESSIBLE_NAME_JS) == []
    # month nav buttons carry an aria-label, not just a title
    assert page.get_attribute('#rptPrevMonth', 'aria-label') == 'Previous month'
    assert page.get_attribute('#rptNextMonth', 'aria-label') == 'Next month'


@pytest.mark.ui
def test_item_action_buttons_name_the_item(seeded):
    page = seeded
    _go(page, "accounts")
    assert page.locator('[data-account-action="edit"][aria-label="Edit Main Checking"]').count() == 1
    assert page.locator('[data-account-action="delete"][aria-label="Delete Main Checking"]').count() == 1
    assert page.locator('[data-account-action="transfer"][aria-label="Transfer from Main Checking"]').count() == 1
    _go(page, "income")
    assert page.locator('[data-income-action="edit"][aria-label="Edit Paycheck"]').count() == 1
    assert page.locator('[data-bonus-action="delete"][aria-label="Delete Spot Bonus"]').count() == 1
    _go(page, "people")
    assert page.locator('[data-person-action="edit"][aria-label="Edit Alice"]').count() == 1
    _go(page, "liabilities")
    assert page.locator('[data-debt-action="edit"][aria-label="Edit Visa card"]').count() == 1
    assert page.locator('[data-debt-action="delete"][aria-label="Delete Visa card"]').count() == 1
    _go(page, "recurring")
    assert page.locator('[data-recurring-action="pause"][aria-label="Pause Netflix"]').count() == 1
    assert page.locator('[data-recurring-action="delete"][aria-label="Delete Netflix"]').count() == 1
    _go(page, "savings")
    page.click('[data-savings-subtab="sinking"]')
    page.wait_for_selector('[data-sinking-action="edit"]', timeout=5000)
    assert page.locator('[data-sinking-action="edit"][aria-label="Edit Vacation Fund"]').count() == 1
    assert page.locator('[data-sinking-action="contribute"][aria-label="Contribute to Vacation Fund"]').count() == 1


@pytest.mark.ui
def test_inline_edit_save_cancel_include_item_name(seeded):
    page = seeded
    _go(page, "liabilities")
    page.click('[data-debt-action="edit"][data-debt-id="7201"]')
    page.wait_for_selector('[data-debt-action="save-inline"]', timeout=5000)
    assert page.get_attribute('[data-debt-action="save-inline"]', 'aria-label') == 'Save changes to Visa card'
    assert page.get_attribute('[data-debt-action="cancel-inline"]', 'aria-label') == 'Cancel editing Visa card'
    # visible text preserved (label does not replace the visible word)
    assert page.inner_text('[data-debt-action="save-inline"]').strip() == 'Save'

    _go(page, "accounts")
    page.click('[data-account-action="edit"][data-account-id="7001"]')
    page.wait_for_selector('[data-account-action="save"]', timeout=5000)
    assert page.get_attribute('[data-account-action="save"]', 'aria-label') == 'Save changes to Main Checking'
    assert page.get_attribute('[data-account-action="cancel"]', 'aria-label') == 'Cancel editing Main Checking'


@pytest.mark.ui
def test_item_name_is_escaped_in_aria_label(seeded):
    """Negative: a hostile name is literal text in the label, never injected markup."""
    page = seeded
    _go(page, "liabilities")
    page.wait_for_selector('[data-debt-id="7202"]', timeout=5000)
    label = page.get_attribute('[data-debt-action="delete"][data-debt-id="7202"]', 'aria-label')
    assert label == f"Delete {EVIL}"
    assert page.locator('#debtsList img').count() == 0
    assert page.get_attribute('[data-debt-action="edit"][data-debt-id="7202"]', 'aria-label') == f"Edit {EVIL}"
    # same for accounts and ledger rows
    page.evaluate("""(evil) => { window.app.accounts[0].name = evil; window.app.updateUI(); }""", EVIL)
    _go(page, "accounts")
    assert page.get_attribute('[data-account-action="delete"][data-account-id="7001"]', 'aria-label') == f"Delete {EVIL}"
    assert page.locator('#accountsSection img[src="x"]').count() == 0
    _go(page, "ledger")
    assert page.locator('#ledgerSection img[src="x"]').count() == 0


@pytest.mark.ui
def test_range_toggle_aria_pressed_flips(seeded):
    page = seeded
    _go(page, "reports")
    page.click('[data-rptab="networth"]')
    page.wait_for_selector('#captureSnapshotBtn', timeout=5000)
    if page.locator('[data-networth-range]').count() == 0:
        page.click('#captureSnapshotBtn')  # ranges only render once a snapshot exists
    page.wait_for_selector('[data-networth-range]', timeout=5000)
    initial = page.eval_on_selector_all(
        '[data-networth-range]',
        'els => els.filter(e => e.getAttribute("aria-pressed") === "true").map(e => e.dataset.networthRange)')
    assert len(initial) == 1
    target = '12' if initial[0] != '12' else '3'
    page.click(f'[data-networth-range="{target}"]')
    page.wait_for_selector(f'[data-networth-range="{target}"][aria-pressed="true"]', timeout=5000)
    assert page.get_attribute(f'[data-networth-range="{initial[0]}"]', 'aria-pressed') == 'false'
    assert page.get_attribute(f'[data-networth-range="{target}"]', 'aria-label') == f'Last {target} months ({target}M)'
    # every chip in the group has an explicit aria-pressed (never missing)
    states = page.eval_on_selector_all('[data-networth-range]', 'els => els.map(e => e.getAttribute("aria-pressed"))')
    assert sorted(states) == ['false', 'false', 'true']


@pytest.mark.ui
def test_subtab_toggle_aria_pressed_flips(seeded):
    page = seeded
    _go(page, "liabilities")
    assert page.get_attribute('[data-liabilities-subtab="debts"]', 'aria-pressed') == 'true'
    assert page.get_attribute('[data-liabilities-subtab="expenses"]', 'aria-pressed') == 'false'
    page.click('[data-liabilities-subtab="expenses"]')
    page.wait_for_selector('[data-liabilities-subtab="expenses"][aria-pressed="true"]', timeout=5000)
    assert page.get_attribute('[data-liabilities-subtab="debts"]', 'aria-pressed') == 'false'
    _go(page, "savings")
    page.click('[data-savings-subtab="sinking"]')
    page.wait_for_selector('[data-savings-subtab="sinking"][aria-pressed="true"]', timeout=5000)
    assert page.get_attribute('[data-savings-subtab="emergency"]', 'aria-pressed') == 'false'


@pytest.mark.ui
def test_ledger_sort_header_label_includes_direction(seeded):
    page = seeded
    _go(page, "ledger")
    page.wait_for_selector('th[data-key="amount"]', timeout=5000)
    # Default sort is date; amount is unsorted -> no direction in label, no aria-sort
    assert page.get_attribute('th[data-key="amount"]', 'aria-label') == 'Sort by Amount'
    assert page.get_attribute('th[data-key="amount"]', 'aria-sort') is None
    page.click('th[data-key="amount"]')
    page.wait_for_selector('th[data-key="amount"][aria-sort="descending"]', timeout=5000)
    assert page.get_attribute('th[data-key="amount"]', 'aria-label') == 'Sort by Amount, descending'
    page.click('th[data-key="amount"]')
    page.wait_for_selector('th[data-key="amount"][aria-sort="ascending"]', timeout=5000)
    assert page.get_attribute('th[data-key="amount"]', 'aria-label') == 'Sort by Amount, ascending'
    # the previously sorted column drops its direction
    assert page.get_attribute('th[data-key="date"]', 'aria-label') == 'Sort by Date'


@pytest.mark.ui
def test_text_buttons_keep_their_visible_name(seeded):
    """Negative: untouched text buttons are not given an overriding aria-label."""
    page = seeded
    _go(page, "liabilities")
    for sel in ['#debtFormSubmit', '#cancelEditBtn']:
        assert page.get_attribute(sel, 'aria-label') is None
    _go(page, "strategy")
    assert page.get_attribute('#calculateBtn', 'aria-label') is None
    _go(page, "accounts")
    assert page.get_attribute('#accountFormSubmit', 'aria-label') is None
