"""Back closes the innermost thing first (#731, phase 2 Task 1).

An open dialog or inline edit is closed by Back before the page changes: the
router restores the address it just left and sends the dialog Escape (or
cancels the edit exactly as its Cancel button does). The sign-in and
server-unreachable gates are never closed by Back.
"""

import pytest
from playwright.sync_api import expect

from tests.conftest import BASE_URL, seed_state, wait_for_app_ready

BASE = BASE_URL if BASE_URL.endswith("/") else BASE_URL + "/"


def _path(page):
    return page.evaluate("() => location.pathname + location.search")


def _wait_path(page, expected):
    # expect() polls from Python: after page.goto the app's CSP blocks wait_for_function.
    expect(page).to_have_url(BASE.rstrip("/") + expected, timeout=5000)


def _nav(page, name, section_id):
    page.click(f'.page-button[data-page="{name}"]')
    page.wait_for_selector(f'#{section_id}.active', timeout=5000)


def test_back_closes_dialog_and_keeps_page(app_page):
    page = app_page
    _nav(page, "accounts", "accountsSection")
    _nav(page, "ledger", "ledgerSection")
    page.click("#ledgerExportCsvBtn")
    expect(page.locator("#ledgerExportModal")).to_be_visible(timeout=5000)
    page.go_back()
    expect(page.locator("#ledgerExportModal")).to_be_hidden(timeout=5000)
    _wait_path(page, "/ledger")
    assert page.evaluate("() => document.getElementById('ledgerSection').classList.contains('active')")
    page.go_back()
    page.wait_for_selector("#accountsSection.active", timeout=5000)
    _wait_path(page, "/accounts")


def test_back_closes_stacked_dialog_first(app_page):
    # Review Focus 1: Keyboard Shortcuts opened from Settings -> About.
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    page.click("#accountMenuBtn")
    page.click("#accountMenuSettingsBtn")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=5000)
    page.click('#settingsModal .settings-row[data-settings-page="about"]')
    page.wait_for_selector("#settingsPage-about", state="visible", timeout=5000)
    page.click("#settingsAboutShortcutsBtn")
    expect(page.locator("#keyboardShortcutsModal")).to_be_visible(timeout=5000)
    page.wait_for_function("() => document.getElementById('keyboardShortcutsModal').contains(document.activeElement)",
                           timeout=5000)

    page.go_back()
    expect(page.locator("#keyboardShortcutsModal")).to_be_hidden(timeout=5000)
    expect(page.locator("#settingsModal")).to_be_visible()
    _wait_path(page, "/ledger?settings=about")
    assert page.evaluate("() => document.getElementById('settingsModal').contains(document.activeElement)")

    page.go_back()
    expect(page.locator("#settingsModal")).to_be_hidden(timeout=5000)
    _wait_path(page, "/ledger")
    assert page.evaluate("() => document.getElementById('ledgerSection').classList.contains('active')")


def test_back_restores_canonical_address(app_page):
    # Review Focus 2: the dialog opens right after a canonicalising replace.
    # Back must stay inside one document to reach the router (a page.goto
    # starts a new one), so the non-canonical /reports is reached by Forward
    # to an entry that names it; applying it replaces it with /reports/calendar.
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    page.evaluate("() => { history.pushState(null, '', '/reports'); history.back(); }")
    _wait_path(page, "/ledger")
    page.go_forward()
    page.wait_for_selector("#reportsSection.active", timeout=5000)
    _wait_path(page, "/reports/calendar")
    page.click("#accountMenuBtn")
    page.wait_for_selector("#accountMenuDropdown:not(.hidden)", timeout=3000)
    page.click("#accountMenuCalendarFeedBtn")
    expect(page.locator("#calendarFeedModal")).to_be_visible(timeout=5000)
    page.go_back()
    expect(page.locator("#calendarFeedModal")).to_be_hidden(timeout=5000)
    _wait_path(page, "/reports/calendar")
    assert page.evaluate("() => document.getElementById('reportsSection').classList.contains('active')")


def test_back_with_gate_keeps_gate(app_page):
    # Review Focus 3: Back never closes the sign-in gate.
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    _nav(page, "accounts", "accountsSection")
    page.route("**/api/**", lambda r: r.fulfill(status=401, body="{}", content_type="application/json"))
    if page.locator("#accountFormBody[hidden]").count():
        page.click("#accountFormToggle")
    page.fill("#accountName", "Gate Account")
    page.fill("#accountStartingBalance", "100")
    page.click("#accountFormSubmit")  # submit-no-wait: the 401 opens the sign-in gate instead of saving
    expect(page.locator("#loginGate")).to_be_visible(timeout=15000)
    page.go_back()
    _wait_path(page, "/ledger")
    expect(page.locator("#loginGate")).to_be_visible()
    page.wait_for_function("() => document.getElementById('loginGate').contains(document.activeElement)",
                           timeout=5000)


# ── Inline edits: Back cancels exactly as Cancel does ────────────────────────

SEED = {
    "accounts": [{"id": 1, "name": "Back Checking", "type": "Checking", "startingBalance": 1000}],
    "incomes": [{"id": 1, "name": "Back Salary", "amount": 2000, "firstPayDate": "2026-01-02",
                 "frequency": "monthly", "accountId": 1, "personId": None, "category": "Salary",
                 "isVariable": False, "withholdingPercent": 0}],
    "recurringTemplates": [{"id": 1, "name": "Back Rent", "type": "subscription", "amount": 40,
                            "frequency": "monthly", "dayOfMonth": 10, "category": "Bills",
                            "accountId": 1, "targetAccountId": None, "startDate": "2025-01-01",
                            "endDate": None, "paused": False, "archived": False,
                            "skippedMonths": [], "paidMonths": [], "paidAmounts": {}}],
    "persons": [{"id": 1, "name": "Back Person"}],
    "debts": [{"id": 1, "name": "Back Visa", "category": "Credit Card", "debtType": "creditCard",
               "accountId": 1, "accountBalance": 900, "originalBalance": 900, "interestRate": 10,
               "minimumPayment": 40, "originalMinimumPayment": 40, "dueDate": 12}],
}

# (case, nav page, section, address, collection, endpoint, original name, edit button, name input prefix)
EDITS = [
    ("accounts", "accounts", "accountsSection", "/accounts", "accounts", "/api/accounts", "Back Checking",
     '[data-account-action="edit"][data-account-id="{id}"]', "#ac-name-"),
    ("income", "income", "incomeSection", "/income", "incomes", "/api/incomes", "Back Salary",
     '[data-income-action="edit"][data-income-id="{id}"]', "#ie-name-"),
    ("recurring", "recurring", "recurringSection", "/recurring", "recurringTemplates", "/api/recurring-templates",
     "Back Rent", '[data-recurring-action="edit"][data-recurring-id="{id}"]', "#re-name-"),
    ("people", "people", "peopleSection", "/people", "persons", "/api/persons", "Back Person",
     '[data-person-action="edit"][data-person-id="{id}"]', "#pe-name-"),
    ("debt", "liabilities", "liabilitiesSection", "/liabilities/debts", "debts", "/api/debts", "Back Visa",
     '[data-debt-action="edit"][data-debt-id="{id}"]', "#inline-name-"),
]


@pytest.mark.parametrize("case,nav,section,address,collection,endpoint,original,edit_btn,name_input",
                         EDITS, ids=[e[0] for e in EDITS])
def test_back_cancels_inline_edit(app_page, case, nav, section, address, collection, endpoint, original,
                                  edit_btn, name_input):
    page = app_page
    seed_state(page, SEED)
    wait_for_app_ready(page)
    _nav(page, "ledger", "ledgerSection")
    _nav(page, nav, section)
    _wait_path(page, address)
    record_id = page.evaluate("(c) => window.app[c][0].id", collection)
    page.click(edit_btn.format(id=record_id))
    field = page.locator(f"{name_input}{record_id}")
    expect(field).to_be_visible(timeout=5000)
    field.fill("Changed By Back")

    page.go_back()
    expect(page.locator(f"{name_input}{record_id}")).to_have_count(0, timeout=5000)
    _wait_path(page, address)
    assert page.evaluate("(id) => document.getElementById(id).classList.contains('active')", section)
    rows = page.evaluate("async (p) => (await fetch(p)).json()", endpoint)
    assert [r["name"] for r in rows if r["id"] == record_id] == [original]
    assert page.evaluate("(c) => window.app[c][0].name", collection) == original


def test_hidden_edit_on_other_sub_tab_does_not_swallow_back(app_page):
    # The sub-tabs leave editingDebtId set: a debt edit hidden behind the
    # Expenses panel must not eat Back, which returns to Debts.
    page = app_page
    seed_state(page, SEED)
    wait_for_app_ready(page)
    _nav(page, "liabilities", "liabilitiesSection")
    _wait_path(page, "/liabilities/debts")
    debt_id = page.evaluate("() => window.app.debts[0].id")
    page.click(f'[data-debt-action="edit"][data-debt-id="{debt_id}"]')
    expect(page.locator(f"#inline-name-{debt_id}")).to_be_visible(timeout=5000)
    page.click('#liabilitiesSection .liabilities-subtab-btn[data-liabilities-subtab="expenses"]')
    page.wait_for_selector('#liabilitiesSection [data-subtab="expenses"].visible', timeout=5000)
    _wait_path(page, "/liabilities/expenses")

    page.go_back()
    _wait_path(page, "/liabilities/debts")
    page.wait_for_selector('#liabilitiesSection [data-subtab="debts"].visible', timeout=5000)
    expect(page.locator(f"#inline-name-{debt_id}")).to_be_visible()


# ── Every overlay closes on Escape (Back relies on it) ───────────────────────

OVERLAY_SEED = dict(SEED)
OVERLAY_SEED["accounts"] = [
    {"id": 1, "name": "Back Checking", "type": "Checking", "startingBalance": 1000},
    {"id": 2, "name": "Back Savings", "type": "Savings", "startingBalance": 500},
    {"id": 3, "name": "Back 401k", "type": "Retirement", "startingBalance": 5000, "retirementSubtype": "401k"},
]

_UI = "(await import('/src/ui.js'))"
_RECURRING_ID = "window.app.recurringTemplates[0].id"

# (overlay id, JS that opens it, run inside an async function with `app` bound).
# Promise-returning dialogs are deliberately not awaited: they settle on close.
OVERLAYS = [
    ("whatsNewModal", "app.openWhatsNewModal()"),
    ("keyboardShortcutsModal", "app.openKeyboardShortcuts()"),
    ("alertModal", f"{_UI}.showAlertModal('Back test')"),
    ("deleteConfirmModal", f"{_UI}.showDeleteConfirmModal('Back test')"),
    ("archiveConfirmModal", f"{_UI}.showArchiveConfirmModal('Back Visa')"),
    ("syncConflictModal", f"{_UI}.showSyncConflictModal('Back Visa')"),
    ("reconSaveProgressModal", f"{_UI}.showReconSaveProgressModal()"),
    ("accountReplacementModal", f"{_UI}.showAccountReplacementModal(app, app.accounts[0].id)"),
    ("personReplacementModal", f"{_UI}.showPersonReplacementModal(app, app.persons[0].id, [], [{{name: 'Back Visa'}}])"),
    ("amortizationModal", "app.showAmortizationModal('Back Visa')"),
    ("accelerateDebtModal", "(await import('/src/debtBreakEven.js')).showAccelerateModal(app, app.debts[0].id)"),
    ("acctBreakdownModal", "(await import('/src/accounts.js')).renderAccountBalanceBreakdown(app, app.accounts[0].id)"),
    ("balanceHistoryModal", "app.showBalanceHistoryModal({kind: 'account', id: app.accounts[0].id})"),
    ("calendarDayModal",
     "app._reportsCalendarDayData = {year: 2026, month: 0, dayDataMap: {5: {incomes: [], bills: [], expenses: [], "
     "recurring: [], debts: [], bonuses: []}}}; (await import('/src/reportsCalendar.js')).openCalendarDayModal(app, 5)"),
    ("contributeModal", "(await import('/src/savings.js')).openContributeModal('Back fund')"),
    ("ledgerOverrideModal",
     "(await import('/src/ledgerOverrides.js')).openLedgerOverrideModal(app, {transactionId: 'income|1|1|2026-01-02', "
     "name: 'Back Salary', accountId: 1, date: '2026-01-02', amount: 2000, type: 'income'})"),
    ("manualTxModal", "(await import('/src/manualTransactions.js')).openManualTransactionModal(app, {})"),
    ("transferModal", "(await import('/src/transfers.js')).openTransferModal(app, {})"),
    ("reconcileModal", "(await import('/src/reconciliation.js')).openReconcileModal(app, app.accounts[0].id)"),
    ("retirementSnapshotModal", "(await import('/src/retirement.js')).openRetirementSnapshotModal(app, app.accounts.find(a => a.type === 'Retirement').id)"),
    ("updateBalanceModal", "(await import('/src/debts.js')).showUpdateBalanceModal(app, app.debts[0].id)"),
    ("setupWizardModal", "(await import('/src/setupWizard.js')).maybeShowSetupWizard(app, true)"),
    ("recurringPauseModal", f"(await import('/src/recurring.js')).openRecurringPauseModal(app, {_RECURRING_ID})"),
    # Opened from a button, not a function the test can call.
    ("calendarFeedModal", "document.getElementById('accountMenuCalendarFeedBtn').click()"),
    ("ledgerExportModal", "document.getElementById('ledgerExportCsvBtn').click()"),
    # skip-ok: private opener behind seeded Ledger rows; its keydown handler is at ledger.js (Escape -> close)
    ("ledgerMarkAllClearedModal", None),
    # skip-ok: private opener behind seeded Reports spending rows; Escape handled in spending.js
    ("spendingDrilldownModal", None),
    # skip-ok: private opener behind a Health budget card; Escape handled in health.js
    ("budgetThresholdsModal", None),
    # skip-ok: the debt paid-off celebration (debts.js) opens on a balance state change; its opener is private
    ("debtPaidOffModal", None),
    # skip-ok: the sinking-fund completion modal (savings.js) opens on a state change; its opener is private
    ("sinkingFundCompleteModal", None),
    ("pgMigrationModal", "(await import('/src/pgMigrationModal.js')).showLegacyDataCleanupModal('{}')"),
    ("recurringMarkPaidModal",
     f"(await import('/src/recurringPaid.js')).openRecurringMarkPaidModal(app, {_RECURRING_ID}, '2026-01')"),
]


@pytest.mark.parametrize("overlay,opener", OVERLAYS, ids=[o[0] for o in OVERLAYS])
def test_every_overlay_closes_on_escape(app_page, overlay, opener):
    if opener is None:
        pytest.skip("skip-ok: no test-drivable opener (see the comment in OVERLAYS)")
    page = app_page
    seed_state(page, OVERLAY_SEED)
    wait_for_app_ready(page)
    if overlay == "ledgerExportModal":
        _nav(page, "ledger", "ledgerSection")
    if overlay == "amortizationModal":
        # The modal lives inside the Plan page, which must be showing.
        _nav(page, "strategy", "strategySection")
    if overlay == "calendarFeedModal":
        page.click("#accountMenuBtn")
        page.wait_for_selector("#accountMenuDropdown:not(.hidden)", timeout=3000)
    page.evaluate("() => { const app = window.app; (async () => { " + opener + "; })(); }")
    target = page.locator(f"#{overlay}")
    expect(target).to_be_visible(timeout=5000)
    page.wait_for_function(
        "(id) => document.getElementById(id).contains(document.activeElement)", arg=overlay, timeout=5000)
    page.keyboard.press("Escape")
    expect(target).to_be_hidden(timeout=5000)


def test_palette_page_choice_closes_settings(app_page):
    page = app_page
    _nav(page, "ledger", "ledgerSection")
    page.click("#accountMenuBtn")
    page.click("#accountMenuSettingsBtn")
    page.wait_for_selector("#settingsModal.flex-visible", timeout=5000)
    page.keyboard.press("Control+k")
    expect(page.locator("#commandPaletteOverlay")).to_be_visible(timeout=5000)
    page.fill("#commandPaletteInput", "Accounts")
    page.keyboard.press("Enter")
    expect(page.locator("#settingsModal")).to_be_hidden(timeout=5000)
    page.wait_for_selector("#accountsSection.active", timeout=5000)
    _wait_path(page, "/accounts")
    # No stray ?settings entry: one Back leaves /accounts for the page before Settings.
    page.go_back()
    page.wait_for_selector("#ledgerSection.active", timeout=5000)
    _wait_path(page, "/ledger")
    expect(page.locator("#settingsModal")).to_be_hidden()
