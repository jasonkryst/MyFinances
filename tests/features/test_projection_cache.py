"""Issue #518: render-scoped projection cache.

Per-account balances and the Forecast used to rebuild every account's ledger
projection once per account (and per month). These tests run the real renders
in the browser on the audit dataset (30 accounts, 200 recurring templates,
50 debts) and count real projection builds through the module's own counter.
"""
import pytest

pytestmark = pytest.mark.feature

# Injected in memory: the renders under test only read app state, and seeding
# 280 records through the API would only slow the test down.
_AUDIT_DATASET_JS = """
() => {
    const accounts = [];
    for (let i = 0; i < 30; i++) {
        accounts.push({ id: 9000 + i, name: `Acct ${i}`, type: i % 5 === 4 ? 'Credit Card' : 'Checking',
            startingBalance: 1000 + i * 250, interestRate: i % 3 === 0 ? 4.5 : 0 });
    }
    const recurringTemplates = [];
    for (let i = 0; i < 200; i++) {
        recurringTemplates.push({ id: 8000 + i, name: `Sub ${i}`, amount: 5 + (i % 40), accountId: 9000 + (i % 30),
            type: i % 10 === 0 ? 'income' : 'subscription', frequency: 'monthly', dayOfMonth: (i % 28) + 1,
            category: 'Subscription' });
    }
    const debts = [];
    for (let i = 0; i < 50; i++) {
        debts.push({ id: 7000 + i, name: `Debt ${i}`, balance: 1000, interestRate: 10, dueDate: (i % 28) + 1,
            minimumPayment: 25 + i, accountId: 9000 + (i % 30), debtType: 'loan' });
    }
    app.accounts = accounts;
    app.recurringTemplates = recurringTemplates;
    app.debts = debts;
}
"""

# Named actions, because the page CSP forbids eval/new Function in page code.
_ACTIONS_JS = """
async (action) => {
    const lt = await import('/src/ledgerTransactions.js');
    const forecast = await import('/src/forecast.js');
    const actions = {
        oneBalance: () => app.computeAccountBalance(9001),
        accounts: () => app.renderAccountsList(),
        forecast: () => forecast.renderCashFlowForecast(app),
        health: () => app.renderHealthDashboard(),
    };
    const before = lt.getProjectionBuildCount();
    const start = performance.now();
    actions[action]();
    return { builds: lt.getProjectionBuildCount() - before, ms: performance.now() - start };
}
"""


def _builds_during(page, action):
    """Real projection builds (and wall time) while the named render runs."""
    return page.evaluate(_ACTIONS_JS, action)


def test_module_counter_is_the_apps_instance(app_page):
    """The counter imported by the test is the same module instance the app uses."""
    page = app_page
    page.evaluate(_AUDIT_DATASET_JS)
    result = _builds_during(page, "oneBalance")
    assert result["builds"] == 1


def test_accounts_balance_sort_builds_once(app_page):
    page = app_page
    page.evaluate(_AUDIT_DATASET_JS)
    page.click('[data-page="accounts"]')
    page.select_option('#accountSortBy', 'balance-desc')
    result = _builds_during(page, "accounts")
    # Sort and cards share one build (was two per comparison plus one per card).
    assert result["builds"] == 1, result
    assert page.locator('#accountList .acct-card').count() == 30


def test_accounts_balance_sort_order_matches_balances(app_page):
    page = app_page
    page.evaluate(_AUDIT_DATASET_JS)
    page.click('[data-page="accounts"]')
    page.select_option('#accountSortBy', 'balance-asc')
    page.evaluate("app.renderAccountsList()")
    balances = page.evaluate(
        """() => [...document.querySelectorAll('#accountList .acct-card')].map(card => {
            const id = Number(card.querySelector('[data-account-id]').getAttribute('data-account-id'));
            return app.computeAccountBalance(id);
        })"""
    )
    assert len(balances) == 30
    assert balances == sorted(balances)


def test_forecast_total_twelve_months_is_fast(app_page):
    page = app_page
    page.evaluate(_AUDIT_DATASET_JS)
    page.evaluate("() => { app._forecastAccountId = 'total'; app._forecastRangeMonths = 12; }")
    page.click('[data-page="reports"]')
    page.click('[data-rptab="forecast"]')
    page.wait_for_selector('#forecastAccountSelect', state='attached')
    _builds_during(page, "forecast")  # warm up (JIT, Chart.js) before measuring
    result = _builds_during(page, "forecast")
    # One 12-month horizon shared by all accounts, plus one per month for the
    # intra-month low (was one per account per month).
    assert result["builds"] <= 13, result
    print(f"forecast total 12m: {result['ms']:.0f} ms, {result['builds']} builds")
    assert result["ms"] < 1000, result


def test_health_dashboard_builds_bounded(app_page):
    page = app_page
    page.evaluate(_AUDIT_DATASET_JS)
    result = _builds_during(page, "health")
    # Debt-to-asset ratio used to build once per account (30 here).
    assert result["builds"] < 10, result


def test_balance_follows_override_and_cleared_changes(app_page):
    """Invalidation: a later render sees an override set through the real setter."""
    page = app_page
    page.evaluate(_AUDIT_DATASET_JS)
    page.click('[data-page="accounts"]')
    before = page.evaluate("app.computeAccountBalance(9001)")
    changed = page.evaluate(
        """async () => {
            const lt = await import('/src/ledgerTransactions.js');
            const now = new Date();
            const tx = lt.getLedgerTransactionsForMonth(app, now.getFullYear(), now.getMonth(), 9001)
                .find(t => t.type === 'debt');
            const pc = await import('/src/projectionCache.js');
            const ov = await import('/src/ledgerOverrides.js');
            // Inside one scope: warm the cache, override through the real setter, re-read.
            return pc.withProjectionCache(app, () => {
                app.computeAccountBalance(9001);
                ov.setLedgerAmountOverride(app, tx.transactionId, tx.amount - 100, { originalAmount: tx.amount });
                return app.computeAccountBalance(9001);
            });
        }"""
    )
    assert changed == pytest.approx(before - 100, abs=0.01)


def test_new_record_mid_scope_is_seen_after_a_write(app_page):
    """Negative + positive: without a write the scope keeps its projection; the
    write helper's invalidation makes the new record visible."""
    page = app_page
    page.evaluate(_AUDIT_DATASET_JS)
    result = page.evaluate(
        """async () => {
            const pc = await import('/src/projectionCache.js');
            const sync = await import('/src/postgresSync.js');
            return pc.withProjectionCache(app, () => {
                const before = app.computeAccountBalance(9002);
                app.debts.push({ id: 6999, name: 'Mid', dueDate: 2, minimumPayment: 40, accountId: 9002, debtType: 'loan' });
                const stale = app.computeAccountBalance(9002);
                // Any write invalidates; the PATCH itself 404s harmlessly for this in-memory id.
                sync.pgPatch(app, '/api/debts/6999', { minimumPayment: 40 });
                const fresh = app.computeAccountBalance(9002);
                return { before, stale, fresh };
            });
        }"""
    )
    assert result["stale"] == result["before"]
    assert result["fresh"] == pytest.approx(result["before"] - 40, abs=0.01)
