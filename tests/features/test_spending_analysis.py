import pytest

@pytest.mark.feature
def test_spending_aggregates_all_outflow_types(app_page):
    """expenses + bills + recurring outflows + debt minimums + savings all count."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [{ id: 1, name: 'Groceries', category: 'Food', budgetAmount: 100, date: '2026-06-05', accountId: null }];
        app.bills = [{ id: 2, name: 'Electric', category: 'Utilities', amount: 80, dueDay: 10, accountId: null }];
        app.recurringTemplates = [{
            id: 3, name: 'Netflix', type: 'subscription', amount: 15,
            frequency: 'monthly', dayOfMonth: 1, category: 'Subscriptions',
            accountId: null, targetAccountId: null, startDate: '2026-01-01',
            endDate: null, paused: false, skippedMonths: [], paidMonths: []
        }];
        app.debts = [{ id: 4, name: 'Car Loan', minimumPayment: 200, dueDate: 15, accountId: null, debtType: 'creditCard', accountBalance: 5000, interestRate: 5 }];
        app.emergencyFunds = [{ id: 5, name: 'Emergency', monthlyContribution: 50, currentAmount: 100, targetAmount: 1000, autoContribute: true, accountId: null }];
        app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        const out = {};
        for (const c of cats) out[c.category] = Math.round(c.total * 100) / 100;
        return out;
    }""")
    assert result.get('Food', 0) == pytest.approx(100, rel=0.01)
    assert result.get('Utilities', 0) == pytest.approx(80, rel=0.01)
    assert result.get('Subscriptions', 0) == pytest.approx(15, rel=0.01)
    assert result.get('Debt Payments', 0) == pytest.approx(200, rel=0.01)
    assert result.get('Savings', 0) == pytest.approx(50, rel=0.01)


@pytest.mark.feature
def test_spending_excludes_income(app_page):
    """Income, bonus, and reimbursement (positive recurring) are not counted."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.incomes = [{ id: 1, name: 'Salary', amount: 3000, firstPayDate: '2026-06-01', frequency: 'monthly', accountId: null, category: 'Income' }];
        app.bonuses = [{ id: 2, name: 'Bonus', amount: 500, date: '2026-06-15', accountId: null }];
        app.recurringTemplates = [{
            id: 3, name: 'Rental Income', type: 'reimbursement', amount: 200,
            frequency: 'monthly', dayOfMonth: 1, category: 'Income',
            accountId: null, targetAccountId: null, startDate: '2026-01-01',
            endDate: null, paused: false, skippedMonths: [], paidMonths: []
        }];
        app.expenses = []; app.bills = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        return mod.computeSpendingByCategory(app, 2026, 5);
    }""")
    assert result == [], f"Expected no spending for income-only data, got {result}"


@pytest.mark.feature
def test_spending_sorted_by_total_desc(app_page):
    """Result array is sorted highest total first."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [
            { id: 1, name: 'Coffee', category: 'Coffee', budgetAmount: 30, date: '2026-06-01', accountId: null },
            { id: 2, name: 'Rent', category: 'Housing', budgetAmount: 950, date: '2026-06-01', accountId: null },
            { id: 3, name: 'Gas', category: 'Transport', budgetAmount: 60, date: '2026-06-01', accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        return mod.computeSpendingByCategory(app, 2026, 5).map(c => c.category);
    }""")
    assert result == ['Housing', 'Transport', 'Coffee']


@pytest.mark.feature
def test_spending_other_fallback(app_page):
    """Blank category falls back to 'Other'."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [{ id: 1, name: 'Mystery', category: '', budgetAmount: 42, date: '2026-06-10', accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        return cats.length === 1 ? cats[0].category : null;
    }""")
    assert result == 'Other'


@pytest.mark.feature
def test_spending_change_vs_last_month(app_page):
    """changeVsLastMonth = (this - prior) / prior for categories present both months."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        // Bill appears every month; expense only in June.
        // June Food = $100 (bill) + $120 (expense) = $220
        // May Food = $100 (bill only) = $100
        // change = (220-100)/100 = 1.2
        app.expenses = [{ id: 1, name: 'Extra shop', category: 'Food', budgetAmount: 120, date: '2026-06-10', accountId: null }];
        app.bills = [{ id: 2, name: 'Grocery budget', category: 'Food', amount: 100, dueDay: 10, accountId: null }];
        app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        const food = cats.find(c => c.category === 'Food');
        return food ? { total: food.total, change: food.changeVsLastMonth } : null;
    }""")
    assert result is not None
    assert result['total'] == pytest.approx(220, rel=0.01)
    assert result['change'] == pytest.approx(1.2, rel=0.01)


@pytest.mark.feature
def test_spending_change_vs_last_month_null_when_no_prior(app_page):
    """changeVsLastMonth is None when the category had no prior-month spending."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [{ id: 1, name: 'New thing', category: 'BrandNew', budgetAmount: 50, date: '2026-06-01', accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const cats = mod.computeSpendingByCategory(app, 2026, 5);
        const cat = cats.find(c => c.category === 'BrandNew');
        return cat ? cat.changeVsLastMonth : 'not found';
    }""")
    assert result is None


@pytest.mark.feature
def test_spending_range_aggregates_across_months(app_page):
    """computeSpendingByCategoryRange sums a category's spending across every
    month in the range (issue #329)."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        // April ($50), May ($75), June ($60) - a 3-month range ending in June
        // (month index 5) should total $185; April alone should be excluded
        // once the range narrows to 2 months (May+June = $135).
        app.expenses = [
            { id: 1, name: 'Apr grocery', category: 'Food', budgetAmount: 50, date: '2026-04-10', accountId: null },
            { id: 2, name: 'May grocery', category: 'Food', budgetAmount: 75, date: '2026-05-10', accountId: null },
            { id: 3, name: 'Jun grocery', category: 'Food', budgetAmount: 60, date: '2026-06-10', accountId: null }
        ];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};

        const threeMonth = mod.computeSpendingByCategoryRange(app, 2026, 5, 3);
        const twoMonth = mod.computeSpendingByCategoryRange(app, 2026, 5, 2);
        return {
            threeMonthTotal: threeMonth.find(c => c.category === 'Food')?.total ?? 0,
            twoMonthTotal: twoMonth.find(c => c.category === 'Food')?.total ?? 0,
        };
    }""")
    assert result['threeMonthTotal'] == pytest.approx(185, rel=0.01)
    assert result['twoMonthTotal'] == pytest.approx(135, rel=0.01)


@pytest.mark.feature
def test_spending_range_of_one_matches_single_month(app_page):
    """computeSpendingByCategoryRange(..., 1) is identical to
    computeSpendingByCategory (single-month mode is unchanged, per AC)."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = [{ id: 1, name: 'Rent', category: 'Housing', budgetAmount: 950, date: '2026-06-01', accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        const single = mod.computeSpendingByCategory(app, 2026, 5);
        const range = mod.computeSpendingByCategoryRange(app, 2026, 5, 1);
        return {
            singleTotal: single[0]?.total,
            rangeTotal: range[0]?.total,
        };
    }""")
    assert result['singleTotal'] == result['rangeTotal'] == pytest.approx(950, rel=0.01)


# ─────────────────────────── negative tests ───────────────────────────

@pytest.mark.feature
def test_spending_range_excludes_months_outside_range(app_page):
    """A category with spending only outside the requested range contributes
    nothing to the aggregate."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        // January spending is 5 months before a range ending in June - well
        // outside even a 3-month range - and must not appear in the total.
        app.expenses = [{ id: 1, name: 'Old purchase', category: 'Food', budgetAmount: 999, date: '2026-01-10', accountId: null }];
        app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        return mod.computeSpendingByCategoryRange(app, 2026, 5, 3);
    }""")
    assert result == []


@pytest.mark.feature
def test_spending_empty_state(app_page):
    """Returns empty array when there are no outflow transactions."""
    page = app_page
    result = page.evaluate("""async () => {
        const mod = await import('/src/spending.js');
        const app = window.app;
        app.expenses = []; app.bills = []; app.recurringTemplates = []; app.debts = [];
        app.emergencyFunds = []; app.sinkingFunds = [];
        app.incomes = []; app.bonuses = []; app.accounts = [];
        app.ledgerAmountOverrides = {};
        return mod.computeSpendingByCategory(app, 2026, 5);
    }""")
    assert result == []
