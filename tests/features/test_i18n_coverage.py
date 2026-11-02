#!/usr/bin/env python3
"""
i18n coverage guards (issue #317).

1. Dictionary parity: es.js/pl.js carry exactly en.js's key set, and every
   translation keeps the same {placeholder} tokens as its English source.
2. Pseudo-locale render: es.js is replaced by en.js with every value wrapped
   in ⟦…⟧, the app is loaded in 'es' with seeded data (names wrapped too), and
   every text node/aria-label/title/placeholder under a translated page's
   roots must be fully bracketed. Any leftover word means a string that never
   went through t() or data-i18n. Grow TRANSLATED_PAGES as pages convert.
"""

import datetime
import json

import pytest

from tests.conftest import BASE_URL, SKIP_FIRST_RUN_WIZARD_SCRIPT, wait_for_app_ready

LOCALES_URL = BASE_URL.rstrip('/') + '/src/locales/'

PSEUDO_ES_MODULE = """
import en from './en.js';
const out = {};
for (const [k, v] of Object.entries(en)) out[k] = '⟦' + v + '⟧';
export default out;
"""

# Proper nouns/acronyms rendered as-is in every locale. Keep this short — a
# word belongs here only if no locale would ever translate it.
NON_TRANSLATABLE = {'ira', 'roth', 'hsa', 'fire', 'us', 'usd'}

_SEED_ACCOUNTS = [
    {'id': 1, 'name': '⟦Checking⟧', 'type': 'Checking', 'startingBalance': 2500},
    {'id': 2, 'name': '⟦Roth⟧', 'type': 'Retirement', 'retirementSubtype': 'Roth IRA',
     'startingBalance': 40000, 'rateOfReturn': 7},
    {'id': 3, 'name': '⟦Work Plan⟧', 'type': 'Retirement', 'retirementSubtype': '401k',
     'startingBalance': 90000, 'rateOfReturn': 6, 'employerMatchPercent': 4, 'catchUpEligible': True},
    {'id': 4, 'name': '⟦Pension⟧', 'type': 'Retirement', 'retirementSubtype': 'Pension',
     'pensionAnnualSalary': 80000, 'pensionContributionRatePct': 6, 'pensionVestingYears': 5,
     'pensionEstimatedMonthlyBenefit': 1800, 'pensionYearsOfService': 3},
    {'id': 5, 'name': '⟦Health⟧', 'type': 'Retirement', 'retirementSubtype': 'HSA',
     'startingBalance': 3000, 'rateOfReturn': 5},
    {'id': 6, 'name': '⟦Visa⟧', 'type': 'Credit Card', 'startingBalance': -800, 'minimumPayment': 35},
    {'id': 7, 'name': '⟦Rainy Day⟧', 'type': 'Savings', 'startingBalance': 5000, 'interestRate': 2.5},
    {'id': 8, 'name': '⟦Old Account⟧', 'type': 'Other', 'startingBalance': 10, 'archived': True},
]

_TODAY = datetime.date.today().isoformat()

SEEDED_STATE = {
    'accounts': _SEED_ACCOUNTS,
    'settings': [],
    'incomes': [
        {'id': 1, 'name': '⟦Salary⟧', 'amount': 3000, 'frequency': 'biweekly',
         'firstPayDate': '2026-01-02', 'accountId': 7},
        {'id': 2, 'name': '⟦Side Gig⟧', 'amount': 5000, 'frequency': 'monthly', 'firstPayDate': '2026-01-15',
         'accountId': 7, 'category': 'Freelance', 'isVariable': True, 'withholdingPercent': 20},
    ],
    'debts': [{'id': 1, 'name': '⟦Car Loan⟧', 'debtType': 'creditCard', 'accountBalance': 9000,
               'minimumPayment': 3000, 'interestRate': 6}],
    'bonuses': [
        {'id': 1, 'name': '⟦Refund⟧', 'amount': 2000, 'date': _TODAY, 'category': 'Tax Refund',
         'accountId': 1, 'purpose': 'cashFlow'},
        {'id': 2, 'name': '⟦Gift⟧', 'amount': 100, 'date': '2025-06-01', 'category': '⟦Gift⟧', 'purpose': 'savings'},
    ],
    'emergencyFunds': [
        {'id': 1, 'accountId': 7, 'targetAmount': 15000, 'currentAmount': 5000, 'monthlyContribution': 250,
         'autoContribute': True, 'notes': '⟦Three months⟧'},
        {'id': 2, 'accountId': 1, 'targetAmount': 3000, 'currentAmount': 0, 'monthlyContribution': 50,
         'autoSyncBalance': True},
    ],
    'sinkingFunds': [
        {'id': 1, 'name': '⟦Vacation⟧', 'allocationMethod': 'fixed', 'monthlyAllocation': 100,
         'targetAmount': 1200, 'currentAmount': 300, 'autoContribute': True, 'accountId': 7,
         'notes': '⟦Beach⟧', 'order': 1},
        {'id': 2, 'name': '⟦Car Repairs⟧', 'allocationMethod': 'annual', 'monthlyAllocation': 50,
         'targetAmount': 600, 'currentAmount': 600, 'accountId': 7},
        {'id': 3, 'name': '⟦Old Goal⟧', 'allocationMethod': 'fixed', 'monthlyAllocation': 10,
         'targetAmount': 100, 'currentAmount': 100, 'accountId': 7, 'archived': True,
         'completedDate': '2026-01-15'},
    ],
    'homePurchasePlan': {'targetHomePrice': 400000, 'targetDownPaymentPct': 10, 'currentSavings': 15000,
                         'monthlyContribution': 500, 'housingCostEstimate': 2500, 'notes': '⟦Dream house⟧'},
    'transfers': [{'id': 1, 'fromAccountId': 7, 'toAccountId': 6, 'amount': 200, 'date': _TODAY,
                   'memo': '⟦Savings top-up⟧'}],
    'balanceHistory': [
        {'id': 1, 'accountId': 6, 'date': '2026-01-31', 'balance': -900, 'minimumPayment': 30},
        {'id': 2, 'accountId': 6, 'date': '2026-02-28', 'balance': -800, 'minimumPayment': 35},
    ],
    'monthlySnapshots': [
        {'date': '2026-01-31', 'totalAssets': 50000, 'totalLiabilities': 10000, 'netWorth': 40000},
        {'date': '2026-02-28', 'totalAssets': 52000, 'totalLiabilities': 9000, 'netWorth': 43000},
    ],
    'retirementSnapshots': [
        {'id': 1, 'accountId': 2, 'date': '2026-01-31', 'balance': 41000, 'contribution': 500},
        {'id': 2, 'accountId': 2, 'date': '2026-02-28', 'balance': 42100, 'contribution': 500},
        {'id': 3, 'accountId': 3, 'date': '2026-02-28', 'balance': 91000, 'contribution': 800},
        {'id': 4, 'accountId': 4, 'date': '2026-02-28', 'balance': 0, 'contribution': 400,
         'annualSalary': 80000},
    ],
    'retirementTargetDate': '2050-01-01',
    'reconciliations': [
        {'id': 1, 'accountId': 1, 'date': '2026-02-28', 'statementStartDate': '2026-02-01',
         'statementEndDate': '2026-02-28', 'previousBalance': 2400, 'statementBalance': 2500,
         'difference': 100, 'note': '⟦Bank fee⟧', 'createdAt': '2026-03-01T00:00:00.000Z'},
    ],
}

# Retirement/Reconcile were converted against the smaller original seed. The extended seed above feeds
# the Accounts/Income/Savings entries; its transfers, auto-contributions and categorised bonuses would
# surface Ledger-generated English names ("Transfer to ...", "Emergency Fund Contribution", ...) in the
# Reconcile expected-transactions table, which belongs to the Ledger conversion.
BASE_SEEDED_STATE = {
    'accounts': _SEED_ACCOUNTS[:5],
    'debts': [],
    'settings': [],
    'incomes': [{'id': 1, 'name': '⟦Salary⟧', 'amount': 3000, 'frequency': 'biweekly',
                 'startDate': '2026-01-02', 'accountId': 1}],
    'retirementSnapshots': SEEDED_STATE['retirementSnapshots'],
    'retirementTargetDate': SEEDED_STATE['retirementTargetDate'],
    'reconciliations': SEEDED_STATE['reconciliations'],
}
_BASE_STATE_PAGES = {'retirement', 'reconcile'}


# Liabilities (Debts + Expenses sub-tabs) and Recurring. Names/categories/notes wrapped in the pseudo-locale
# brackets are user data; built-in categories ('Food', 'Utilities', 'Income', ...) are deliberately left
# bare so the render guard proves they go through categoryLabel().
_MONTH_KEY = _TODAY[:7]
LIABILITIES_STATE = dict(SEEDED_STATE)
LIABILITIES_STATE.update({
    'persons': [{'id': 1, 'name': '⟦Alex⟧'}, {'id': 2, 'name': '⟦Sam⟧'}],
    'debts': [
        {'id': 1, 'name': '⟦Visa Card⟧', 'debtType': 'creditCard', 'accountBalance': 4000, 'originalBalance': 5000,
         'minimumPayment': 80, 'originalMinimumPayment': 100, 'interestRate': 24, 'dueDate': 15,
         'creditLimit': 5000, 'category': '⟦Cards⟧', 'accountId': 1, 'personIds': [1, 2],
         'ownershipSplit': {'1': 0.7, '2': 0.3}, 'debtStartDate': '2024-01-01', 'nextPaymentDue': _TODAY,
         'notes': '⟦Pay early⟧', 'priority': 5},
        {'id': 2, 'name': '⟦Min Trap⟧', 'debtType': 'creditCard', 'accountBalance': 20000, 'originalBalance': 20000,
         'minimumPayment': 400, 'interestRate': 19, 'dueDate': 1, 'category': '⟦Loans⟧', 'personIds': [1]},
        {'id': 3, 'name': '⟦Neg Amort⟧', 'debtType': 'creditCard', 'accountBalance': 9000, 'originalBalance': 1000,
         'minimumPayment': 50, 'interestRate': 20, 'dueDate': 22, 'creditLimit': 9000},
        {'id': 4, 'name': '⟦Daycare⟧', 'debtType': 'fixedAmount', 'fixedAmount': 800,
         'fixedStartDate': '2025-01-01', 'fixedEndDate': '2099-12-31', 'priority': 2, 'category': '⟦Kids⟧'},
        {'id': 5, 'name': '⟦Old Loan⟧', 'debtType': 'creditCard', 'accountBalance': 0, 'originalBalance': 500,
         'minimumPayment': 0, 'interestRate': 5, 'dueDate': 3, 'archived': True},
        {'id': 6, 'name': '⟦Paid Card⟧', 'debtType': 'creditCard', 'accountBalance': 0, 'originalBalance': 300,
         'minimumPayment': 0, 'interestRate': 5, 'dueDate': 9},
    ],
    'expenses': [
        {'id': 1, 'name': '⟦Groceries⟧', 'budgetAmount': 250, 'date': _TODAY, 'category': 'Food', 'accountId': 1},
        {'id': 2, 'name': '⟦Gym⟧', 'budgetAmount': 40, 'date': _TODAY, 'category': '⟦Fitness⟧', 'accountId': 1},
        {'id': 3, 'name': '⟦Power⟧', 'budgetAmount': 90, 'date': _TODAY, 'category': 'Utilities'},
    ],
    'budgetCategories': {'Food': {'mode': 'fixed', 'amount': 500}, '⟦Fitness⟧': {'mode': 'derived', 'amount': 0}},
    'recurringTemplates': [
        {'id': 1, 'name': '⟦Streaming⟧', 'type': 'subscription', 'amount': 15, 'frequency': 'monthly',
         'dayOfMonth': 1, 'category': 'Entertainment', 'accountId': 1, 'startDate': '2025-01-01',
         'paidMonths': [_MONTH_KEY]},
        {'id': 2, 'name': '⟦Side Pay⟧', 'type': 'income', 'amount': 200, 'frequency': 'monthly',
         'dayOfMonth': 1, 'category': 'Income', 'accountId': 1, 'startDate': '2025-01-01'},
        {'id': 3, 'name': '⟦Gym Refund⟧', 'type': 'reimbursement', 'amount': 30, 'frequency': 'weekly',
         'category': 'Health', 'accountId': 1, 'startDate': '2025-01-01', 'endDate': '2099-01-01'},
        {'id': 4, 'name': '⟦Savings Move⟧', 'type': 'transfer', 'amount': 100, 'frequency': 'biweekly',
         'category': 'Transfer', 'accountId': 1, 'targetAccountId': 7, 'startDate': '2025-01-01'},
        {'id': 5, 'name': '⟦Paused One⟧', 'type': 'subscription', 'amount': 9, 'frequency': 'monthly',
         'dayOfMonth': 5, 'category': 'Utilities', 'accountId': 1, 'startDate': '2025-01-01',
         'paused': True, 'pauseUntil': '2099-01-01'},
        {'id': 6, 'name': '⟦Skipped One⟧', 'type': 'subscription', 'amount': 12, 'frequency': 'monthly',
         'dayOfMonth': 20, 'category': '⟦Misc⟧', 'accountId': 1, 'startDate': '2025-01-01',
         'skippedMonths': [_MONTH_KEY]},
        {'id': 7, 'name': '⟦Archived One⟧', 'type': 'subscription', 'amount': 5, 'frequency': 'yearly',
         'dayOfMonth': 2, 'category': 'Other', 'accountId': 1, 'startDate': '2024-01-01', 'archived': True},
        {'id': 8, 'name': '⟦Quarterly One⟧', 'type': 'subscription', 'amount': 20, 'frequency': 'quarterly',
         'dayOfMonth': 1, 'category': 'Insurance', 'accountId': 1, 'startDate': _TODAY[:7] + '-01'},
        {'id': 9, 'name': '⟦Overdue Monthly⟧', 'type': 'subscription', 'amount': 20, 'frequency': 'monthly',
         'dayOfMonth': 1, 'category': 'Insurance', 'accountId': 1, 'startDate': '2025-01-01'},
    ],
})
_LIABILITIES_PREFIXES = ('liabilities-', 'recurring')

_DEBT_NEEDED = """
            if (!window.app.debts.length) {
                window.app.debts.push({ id: 901, name: '⟦Seed Debt⟧', debtType: 'creditCard', accountBalance: 500,
                    originalBalance: 500, minimumPayment: 25, interestRate: 18, dueDate: 5, creditLimit: 1000 });
            }
"""

_RECURRING_NEEDED = """
            if (!window.app.recurringTemplates.length) {
                window.app.recurringTemplates.push({ id: 901, name: '⟦Seed Template⟧', type: 'subscription',
                    amount: 10, frequency: 'monthly', dayOfMonth: 1, category: 'Other', accountId: null,
                    startDate: '2025-01-01', skippedMonths: [], paidMonths: [], paidAmounts: {} });
            }
"""

# Plan (strategy) page: two interest-bearing debts (one without a start date), a fixed-amount debt that ends
# soon, a bill/expense/bonus so the calendar legend shows every event type, and prior plan history.
_PLAN_FIXED_END = (datetime.date.today() + datetime.timedelta(days=400)).isoformat()
PLAN_STATE = dict(SEEDED_STATE)
PLAN_STATE.update({
    'persons': [{'id': 1, 'name': '⟦Alex⟧'}],
    'debts': [
        {'id': 1, 'name': '⟦Visa Card⟧', 'debtType': 'creditCard', 'accountBalance': 4000, 'originalBalance': 5000,
         'minimumPayment': 80, 'interestRate': 24, 'dueDate': 15, 'creditLimit': 5000, 'personIds': [1],
         'debtStartDate': '2024-01-01'},
        {'id': 2, 'name': '⟦Car Loan⟧', 'debtType': 'creditCard', 'accountBalance': 9000, 'originalBalance': 9000,
         'minimumPayment': 200, 'interestRate': 8, 'dueDate': 3},
        {'id': 3, 'name': '⟦Daycare⟧', 'debtType': 'fixedAmount', 'fixedAmount': 300,
         'fixedStartDate': '2025-01-01', 'fixedEndDate': _PLAN_FIXED_END},
    ],
    'bills': [{'id': 1, 'name': '⟦Rent⟧', 'amount': 900, 'dueDay': 1, 'category': 'Housing', 'accountId': 1}],
    'expenses': [{'id': 1, 'name': '⟦Groceries⟧', 'budgetAmount': 250, 'date': _TODAY, 'category': 'Food',
                  'accountId': 1}],
    'planHistory': [
        {'id': 1, 'monthlyPayment': 600, 'strategy': 'avalanche', 'totalInterest': 1500, 'monthsToPayOff': 1,
         'payoffDate': '2027-01-15T00:00:00.000Z', 'totalDebt': 13000, 'createdAt': '2026-01-01T00:00:00.000Z'},
        {'id': 2, 'monthlyPayment': 650, 'strategy': 'priority-highest', 'totalInterest': 1400, 'monthsToPayOff': 24,
         'payoffDate': '2028-01-15T00:00:00.000Z', 'totalDebt': 13000, 'createdAt': '2026-02-01T00:00:00.000Z'},
    ],
})

_PLAN_CALC = """
            window.app.switchPage('strategy');
            document.getElementById('monthlyPayment').value = '700';
            document.getElementById('paymentStrategy').value = 'snowball';
            // not awaited: with no debts this opens the alert modal, which only resolves on OK
            window.app.calculatePaymentPlanFromInputs();
            await new Promise(r => setTimeout(r, 500));
"""

_PLAN_ROOTS = ['#strategySection', '#alertModal']


def _plan_refi(apr):
    return _PLAN_CALC + """
            const rd = document.getElementById('refiDetails'); if (rd) rd.open = true;
            const sel = document.getElementById('refiDebtSelect');
            if (sel && sel.options.length > 1) sel.value = sel.options[1].value;
            if (sel) sel.dispatchEvent(new Event('change'));
            const apr = document.getElementById('refiAprInput');
            if (apr) { apr.value = '%s'; apr.dispatchEvent(new Event('input')); }
""" % apr

EMPTY_STATE = {'accounts': [], 'debts': [], 'settings': []}

# page name -> (DOM roots to scan, async JS run after load to render/open everything)
_ACCOUNT_OVERLAYS = """
            window.app.showAccountBalanceBreakdown(1, null);
            window.app.showBalanceHistoryModal({ kind: 'account', id: 6 });
            await window.app.openTransferModal({ fromAccountId: 1 });
"""

_ADVICE = """
            document.getElementById('bonusFormToggle').click();
            document.getElementById('bonusAmount').value = '500';
            document.getElementById('bonusAccount').value = '7';
            document.getElementById('bonusAdviceBtn').click();
            await new Promise(r => setTimeout(r, 200));
"""

_SAVINGS_ROOTS = ['#savingsSection']


def _savings_setup(sub_tab, extra=''):
    return """async () => {
            window.app.savingsSubTab = '%s';
            %s
            window.app.switchPage('savings');
            window.app.renderSavingsPage();
            window.app.attachSavingsEventListeners();
            %s
        }""" % (sub_tab, '', extra)


TRANSLATED_PAGES = {
    'accounts': (
        ['#accountsSection', '#acctBreakdownModal', '#balanceHistoryModal', '#transferModal'],
        """async () => {
            window.app.switchPage('accounts');
            window.app.renderAccountsList();
            window.app.renderNetWorthWidget();
            document.getElementById('acctToggleArchived')?.click();
""" + _ACCOUNT_OVERLAYS + """
        }""",
    ),
    'accounts-edit': (
        ['#accountsSection'],
        """async () => {
            window.app.switchPage('accounts');
            window.app.editingAccountId = 3;
            window.app.renderAccountsList();
        }""",
    ),
    'accounts-filter': (
        ['#accountsSection'],
        """async () => {
            window.app.switchPage('accounts');
            document.getElementById('accountTypeFilter').value = 'Cash';
            window.app.renderAccountsList();
        }""",
    ),
    'income': (
        ['#incomeSection'],
        """async () => {
            window.app.switchPage('income');
            window.app.renderIncomeList();
            window.app.renderBonusList();
            const yoy = document.getElementById('incomeTrendYoYToggle');
            if (yoy) { yoy.checked = true; if (yoy.onchange) yoy.onchange(); }
""" + _ADVICE + """
        }""",
    ),
    'income-edit': (
        ['#incomeSection'],
        """async () => {
            window.app.switchPage('income');
            window.app.editingIncomeId = 1;
            window.app.editingBonusId = 1;
            window.app.renderIncomeList();
            window.app.renderBonusList();
        }""",
    ),
    'savings-emergency': (_SAVINGS_ROOTS, _savings_setup('emergency')),
    'savings-sinking': (
        _SAVINGS_ROOTS + ['div[aria-labelledby="sinkingCompleteTitle"]'],
        _savings_setup('sinking', """if (!document.querySelector('[data-sinking-action="complete"]')) {
                window.app.sinkingFunds.push({ id: 99, name: '⟦Funded Goal⟧', allocationMethod: 'fixed',
                    monthlyAllocation: 10, targetAmount: 100, currentAmount: 100, accountId: 1 });
                window.app.renderSavingsPage();
                window.app.attachSavingsEventListeners();
            }
            document.querySelector('[data-sinking-action="complete"]')?.click();
            await new Promise(r => setTimeout(r, 100));"""),
    ),
    'savings-sinking-archived': (
        _SAVINGS_ROOTS,
        _savings_setup('sinking', "document.getElementById('toggleArchivedSinkingFunds')?.click();"),
    ),
    'savings-home': (_SAVINGS_ROOTS, _savings_setup('home')),
    'savings-home-ok': (
        _SAVINGS_ROOTS,
        """async () => {
            window.app.savingsSubTab = 'home';
            window.app.homePurchasePlan = { targetHomePrice: 400000, targetDownPaymentPct: 25,
                currentSavings: 100000, monthlyContribution: 0, housingCostEstimate: 0, notes: '' };
            window.app.debts = [];
            window.app.switchPage('savings');
            window.app.renderSavingsPage();
            window.app.attachSavingsEventListeners();
        }""",
    ),
    'liabilities-debts': (
        ['#liabilitiesSection'],
        """async () => {
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('debts');
            window.openDebtForm?.();
            document.getElementById('debtFiltersBody')?.classList.add('is-open');
            window.app.renderDebtsList();
            document.querySelectorAll('[data-be-shortcut]').forEach(b => b.click());
            document.querySelectorAll('.debt-row-select').forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change')); });
        }""",
    ),
    'liabilities-debts-filtered': (
        ['#liabilitiesSection'],
        """async () => {
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('debts');
            window.app.renderDebtsList();
            document.getElementById('debtInterestFilter').value = 'noInterest';
            document.getElementById('debtProgressFilter').value = 'paid';
            window.app.renderDebtsList();
        }""",
    ),
    'liabilities-debts-grouped': (
        ['#liabilitiesSection'],
        """async () => {
            const settings = await import('/src/settings.js');
            settings.setSetting(window.app, settings.SHOW_ARCHIVED_DEBTS, true);
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('debts');
            document.getElementById('debtGroupBy').value = 'person';
            window.app.renderDebtsList();
        }""",
    ),
    'liabilities-debts-edit': (
        ['#liabilitiesSection'],
        """async () => {
""" + _DEBT_NEEDED + """
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('debts');
            window.app.editingDebtId = window.app.debts[0].id;
            window.app.renderDebtsList();
        }""",
    ),
    'liabilities-debts-edit-fixed': (
        ['#liabilitiesSection'],
        """async () => {
            if (!window.app.debts.some(d => d.debtType === 'fixedAmount')) {
                window.app.debts.push({ id: 902, name: '⟦Seed Fixed⟧', debtType: 'fixedAmount', fixedAmount: 100,
                    fixedStartDate: '2025-01-01', fixedEndDate: '2099-12-31' });
            }
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('debts');
            window.app.editingDebtId = window.app.debts.find(d => d.debtType === 'fixedAmount').id;
            window.app.renderDebtsList();
        }""",
    ),
    'liabilities-modals': (
        ['#alertModal', '#deleteConfirmModal', '#archiveConfirmModal', 'div[aria-labelledby="debtPaidOffTitle"]'],
        """async () => {
            if (!window.app.debts.some(d => d.debtType !== 'fixedAmount' && !d.archived && d.accountBalance <= 0)) {
                window.app.debts.push({ id: 904, name: '⟦Seed Paid⟧', debtType: 'creditCard', accountBalance: 0,
                    originalBalance: 100, minimumPayment: 0, interestRate: 5, dueDate: 5 });
            }
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('debts');
            window.app.renderDebtsList();
            document.querySelector('[data-debt-action="celebrate"]').click();
        }""",
    ),
    'liabilities-update-balance': (
        ['#updateBalanceModal'],
        """async () => {
""" + _DEBT_NEEDED + """
            window.app.switchPage('liabilities');
            window.app.showUpdateBalanceModal(window.app.debts.find(d => d.debtType !== 'fixedAmount').id);
        }""",
    ),
    'liabilities-accelerate': (
        ['#accelerateDebtModal'],
        """async () => {
""" + _DEBT_NEEDED + """
            window.app.switchPage('liabilities');
            window.app.showAccelerateModal(window.app.debts.find(d => d.debtType !== 'fixedAmount').id);
        }""",
    ),
    'liabilities-expenses': (
        ['#liabilitiesSection'],
        """async () => {
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('expenses');
            document.getElementById('expenseFormToggle').click();
            window.app.renderBudgetPage();
            document.querySelector('.cashflow-tab[data-tab="charts"]')?.click();
        }""",
    ),
    'liabilities-expenses-edit': (
        ['#liabilitiesSection'],
        """async () => {
            if (!window.app.expenses.length) {
                window.app.expenses.push({ id: 903, name: '⟦Seed Expense⟧', budgetAmount: 20,
                    date: new Date().toISOString().slice(0, 10), category: 'Food', accountId: null });
            }
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('expenses');
            window.app.editingExpenseId = window.app.expenses[0].id;
            window.app.renderBudgetPage();
        }""",
    ),
    'liabilities-expenses-empty-month': (
        ['#liabilitiesSection'],
        """async () => {
            window.app.switchPage('liabilities');
            window.app.switchLiabilitiesSubTab('expenses');
            window.app._expenseMonthOffset = 3;
            window.app.renderBudgetPage();
            window.app._expenseMonthOffset = 0;
        }""",
    ),
    'recurring': (
        ['#recurringSection'],
        """async () => {
            const settings = await import('/src/settings.js');
            settings.setSetting(window.app, settings.SHOW_ARCHIVED_RECURRING, true);
            window.app.switchPage('recurring');
            document.getElementById('recurringFormToggle').click();
            document.getElementById('recurringFiltersBody')?.classList.add('is-open');
            window.app.renderRecurringPage();
        }""",
    ),
    'recurring-hidden-archived': (
        ['#recurringSection'],
        """async () => {
            window.app.switchPage('recurring');
            window.app.renderRecurringPage();
        }""",
    ),
    'recurring-overdue': (
        ['#recurringSection'],
        """async () => {
            window.app.switchPage('recurring');
            window.app.renderRecurringPage();
            document.getElementById('recurringOverdueFilterBtn')?.click();
        }""",
    ),
    'recurring-edit': (
        ['#recurringSection'],
        """async () => {
""" + _RECURRING_NEEDED + """
            window.app.switchPage('recurring');
            window.app.editingRecurringId = window.app.recurringTemplates[0].id;
            window.app.renderRecurringPage();
        }""",
    ),
    'recurring-mark-paid': (
        ['#recurringSection', '#recurringMarkPaidModal'],
        """async () => {
""" + _RECURRING_NEEDED + """
            window.app.switchPage('recurring');
            window.app.renderRecurringPage();
            const now = new Date();
            const key = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
            const t = window.app.recurringTemplates.find(x => x.frequency === 'weekly') || window.app.recurringTemplates[0];
            await window.app.openRecurringMarkPaidModal(t.id, key);
            // the error line is shown on a bad amount
            const amt = document.querySelector('#recurringMarkPaidModal input[type="number"]');
            if (amt) { amt.value = '-5'; document.getElementById('recurringMarkPaidConfirmBtn').click(); }
            await new Promise(r => setTimeout(r, 100));
        }""",
    ),
    'recurring-pause': (
        ['#recurringSection', '#recurringPauseModal'],
        """async () => {
""" + _RECURRING_NEEDED + """
            window.app.switchPage('recurring');
            window.app.renderRecurringPage();
            window.app.openRecurringPauseModal(window.app.recurringTemplates[0].id);
        }""",
    ),
    'retirement': (
        ['#retirementSection', '#retirementSnapshotModal'],
        """async () => {
            window.app.switchPage('retirement');
            await window.app.renderRetirementPage();
        }""",
    ),
    'reconcile': (
        ['#reconcileSection', '#reconcileModal', '#reconSaveProgressModal'],
        """async () => {
            window.app.switchPage('reconcile');
            await window.app.renderReconciliationPage();
            if (window.app.accounts.length) {
                await window.app.openReconcileModal(window.app.accounts[0].id);
                const details = document.querySelector('#reconcileModal details');
                if (details) details.open = true;
            }
        }""",
    ),
    'strategy': (
        _PLAN_ROOTS + ['.milestone-host'],
        """async () => {
""" + _PLAN_CALC + """
            document.getElementById('targetDateToggle').click();
            document.getElementById('planHistoryToggle').click();
            window.app.showMilestone('⟦Paid Debt⟧');
        }""",
    ),
    'strategy-overview': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            const slider = document.getElementById('whatifSlider');
            if (slider) { slider.value = '150'; slider.dispatchEvent(new Event('input')); }
            await new Promise(r => setTimeout(r, 400));
        }""",
    ),
    'strategy-refi': (_PLAN_ROOTS, "async () => {\n" + _plan_refi('5') + "}"),
    'strategy-refi-worse': (_PLAN_ROOTS, "async () => {\n" + _plan_refi('30') + "}"),
    'strategy-refi-nochange': (_PLAN_ROOTS, "async () => {\n" + _plan_refi('24') + "}"),
    'strategy-refi-invalid': (_PLAN_ROOTS, "async () => {\n" + _plan_refi('500') + "}"),
    'strategy-summary': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            document.querySelector('[data-rtab="debt-summary"]').click();
            document.querySelector('#debtSummaryTable th[data-sort="minDue"]').click();
            document.querySelector('#debtSummaryTable th[data-sort="minDue"]').click();
            document.querySelector('[data-amortization]')?.click();
        }""",
    ),
    'strategy-schedule': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            document.querySelector('[data-rtab="schedule"]').click();
            document.querySelector('button[data-tab="tabular"]').click();
        }""",
    ),
    'strategy-calendar': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            document.querySelector('[data-rtab="schedule"]').click();
            document.querySelector('button[data-tab="calendar"]').click();
            await window.app.renderCalendarView(0);
            document.querySelector('.cal-next')?.click();
            await new Promise(r => setTimeout(r, 300));
        }""",
    ),
    'strategy-charts': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            document.querySelector('[data-rtab="schedule"]').click();
            document.querySelector('button[data-tab="chart"]').click();
            await new Promise(r => setTimeout(r, 300));
        }""",
    ),
    'strategy-target': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            document.getElementById('targetDateToggle').click();
            const d = new Date(); d.setFullYear(d.getFullYear() + 2);
            document.getElementById('targetPayoffDate').value = d.toISOString().slice(0, 10);
            document.getElementById('calcTargetBtn').click();
            await new Promise(r => setTimeout(r, 300));
        }""",
    ),
    'strategy-target-nodate': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            document.getElementById('targetDateToggle').click();
            document.getElementById('targetPayoffDate').value = '';
            document.getElementById('calcTargetBtn').click();
            await new Promise(r => setTimeout(r, 300));
        }""",
    ),
    'strategy-target-past': (
        _PLAN_ROOTS,
        """async () => {
            window.app.switchPage('strategy');
            document.getElementById('targetDateToggle').click();
            document.getElementById('targetPayoffDate').value = '2020-01-01';
            document.getElementById('calcTargetBtn').click();
        }""",
    ),
    'strategy-target-soon': (
        _PLAN_ROOTS,
        """async () => {
            window.app.switchPage('strategy');
            document.getElementById('targetDateToggle').click();
            const d = new Date(); d.setDate(d.getDate() + 2);
            document.getElementById('targetPayoffDate').value = d.toISOString().slice(0, 10);
            document.getElementById('calcTargetBtn').click();
        }""",
    ),
    'strategy-target-unreachable': (
        _PLAN_ROOTS,
        """async () => {
            window.app.switchPage('strategy');
            document.getElementById('monthlyPayment').value = '1';
            document.getElementById('targetDateToggle').click();
            const d = new Date(); d.setMonth(d.getMonth() + 2);
            document.getElementById('targetPayoffDate').value = d.toISOString().slice(0, 10);
            window.app.debts.forEach(x => { if (x.debtType !== 'fixedAmount') x.accountBalance = 1e9; });
            document.getElementById('calcTargetBtn').click();
        }""",
    ),
    'strategy-stale': (
        _PLAN_ROOTS,
        """async () => {
""" + _PLAN_CALC + """
            window.app.debts.forEach(x => { x.accountBalance = (x.accountBalance || 0) + 1; });
            window.app.renderStrategyIncomeWidget();
        }""",
    ),
    'strategy-income-warn': (
        _PLAN_ROOTS,
        """async () => {
            window.app.switchPage('strategy');
            window.app.debts.forEach(x => { x.minimumPayment = 9000; });
            window.app.renderStrategyIncomeWidget();
        }""",
    ),
    'strategy-alert-invalid': (
        _PLAN_ROOTS,
        """async () => {
            window.app.switchPage('strategy');
            document.getElementById('monthlyPayment').value = '';
            window.app.calculatePaymentPlanFromInputs();
            await new Promise(r => setTimeout(r, 200));
        }""",
    ),
}

SCAN_JS = """
({ roots, allow }) => {
    const allowSet = new Set(allow);
    const months = new Set();
    for (let m = 0; m < 12; m++) {
        const d = new Date(2026, m, 15);
        for (const opt of [{ month: 'short' }, { month: 'long' }]) {
            months.add(d.toLocaleDateString('es-ES', opt).replace('.', '').toLowerCase());
        }
    }
    const strip = (s) => {
        let prev;
        do { prev = s; s = s.replace(/⟦[^⟦⟧]*⟧/g, ' '); } while (s !== prev);
        return s;
    };
    const describe = (el) => el.id ? '#' + el.id
        : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    const bad = [];
    // es-ES long dates ("15 de enero de 2026", "enero de 2026") carry the connector "de"; it is part of the
    // locale's own date format (month names above are already allowed), so strip whole month-anchored dates.
    const dateRe = new RegExp(String.raw`(?<!\\p{L})(?:\\d{1,2} de )?(?:` + [...months].join('|') + String.raw`)(?: de \\d{4})?(?!\\p{L})`, 'giu');
    const check = (text, where) => {
        const words = strip(text).replace(dateRe, ' ').match(/\\p{L}{2,}/gu) || [];
        const left = words.filter(w => !allowSet.has(w.toLowerCase()) && !months.has(w.toLowerCase()));
        if (left.length) bad.push(where + ' :: ' + text.trim().replace(/\\s+/g, ' ').slice(0, 140));
    };
    for (const sel of roots) {
        const root = document.querySelector(sel);
        if (!root) { bad.push(sel + ' :: MISSING ROOT'); continue; }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            if (!n.textContent.trim() || n.parentElement.closest('script,style')) continue;
            check(n.textContent, describe(n.parentElement));
        }
        for (const el of [root, ...root.querySelectorAll('[aria-label],[title],[placeholder]')]) {
            for (const attr of ['aria-label', 'title', 'placeholder']) {
                const v = el.getAttribute(attr);
                if (v) check(v, describe(el) + '@' + attr);
            }
        }
    }
    return bad;
}
"""


@pytest.fixture
def pseudo_page(browser):
    """A page whose 'es' dictionary is pseudo-localised en.js. Service workers
    are blocked so the route always serves the pseudo module."""
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    page.page_errors = []
    page.on('pageerror', lambda e: page.page_errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.route(LOCALES_URL + 'es.js', lambda route: route.fulfill(
        status=200, content_type='application/javascript', body=PSEUDO_ES_MODULE))
    page.route(BASE_URL, lambda route: route.fulfill(status=200)
               if route.request.method == 'HEAD' else route.continue_())
    yield page
    context.close()


def _load_pseudo(page, state):
    page.add_init_script(
        "try { localStorage.setItem('debtTrackerLocale', 'es');"
        f" localStorage.setItem('debtTrackerData', {json.dumps(json.dumps(state))}); }} catch (e) {{}}")
    page.add_init_script(SKIP_FIRST_RUN_WIZARD_SCRIPT)
    page.goto(BASE_URL, wait_until='networkidle', timeout=60000)
    wait_for_app_ready(page)


def _load_dicts(page):
    return page.evaluate(f"""async () => {{
        const load = async (c) => (await import('{LOCALES_URL}' + c + '.js?parity')).default;
        return {{ en: await load('en'), es: await load('es'), pl: await load('pl') }};
    }}""")


# ---------------------------------------------------------------- parity

@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_has_every_english_key(app_page, locale):
    dicts = _load_dicts(app_page)
    missing = sorted(set(dicts['en']) - set(dicts[locale]))
    assert not missing, f'{locale}.js is missing {len(missing)} key(s): {missing[:20]}'


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_has_no_orphan_keys(app_page, locale):
    dicts = _load_dicts(app_page)
    extra = sorted(set(dicts[locale]) - set(dicts['en']))
    assert not extra, f'{locale}.js has keys not in en.js: {extra[:20]}'


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_placeholders_match_english(app_page, locale):
    import re
    dicts = _load_dicts(app_page)
    tok = re.compile(r'\{(\w+)\}')
    bad = [k for k, v in dicts['en'].items()
           if k in dicts[locale] and set(tok.findall(v)) != set(tok.findall(dicts[locale][k]))]
    assert not bad, f'{locale}.js placeholder mismatch: {bad[:20]}'


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_values_are_nonempty_strings(app_page, locale):
    dicts = _load_dicts(app_page)
    bad = [k for k, v in dicts[locale].items() if not isinstance(v, str) or not v.strip()]
    assert not bad, f'{locale}.js has empty/non-string values: {bad[:20]}'


# Keys whose translation legitimately equals the English text (acronyms,
# proper nouns, words spelled the same). Anything else identical to en.js is
# an untranslated stub — #317 found 54 Retirement "stubs" hiding behind parity.
SAME_AS_ENGLISH = {
    'es': {'nav.strategy', 'health.personDti', 'retirement.coastTitle', 'accounts.sortApyAsc',
           'accounts.sortApyDesc', 'homePurchase.pmiBelowValue', 'income.estBadge', 'savings.autoTag',
           'debts.updateOriginal', 'recurring.total', 'ownership.totalLabel'},
    'pl': {'nav.strategy', 'health.personDti', 'retirement.coastTitle', 'accounts.apyBadge',
           'accounts.sortApyAsc', 'accounts.sortApyDesc', 'savings.autoTag',
           'modals.ok', 'breakEven.start', 'category.transport'},
}


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_locale_values_are_not_english_stubs(app_page, locale):
    dicts = _load_dicts(app_page)
    same = sorted(k for k, v in dicts['en'].items()
                  if dicts[locale].get(k) == v and k not in SAME_AS_ENGLISH[locale])
    assert not same, (f'{locale}.js has {len(same)} value(s) identical to English — translate them '
                      f'or add to SAME_AS_ENGLISH: {same[:20]}')


@pytest.mark.feature
@pytest.mark.parametrize('locale', ['es', 'pl'])
def test_same_as_english_allowlist_has_no_stale_entries(app_page, locale):
    dicts = _load_dicts(app_page)
    stale = sorted(k for k in SAME_AS_ENGLISH[locale] if dicts[locale].get(k) != dicts['en'].get(k))
    assert not stale, f'remove from SAME_AS_ENGLISH[{locale!r}]: {stale}'


# ---------------------------------------------------------------- render guard

@pytest.mark.feature
@pytest.mark.parametrize('state_name', ['seeded', 'empty'])
@pytest.mark.parametrize('page_name', sorted(TRANSLATED_PAGES))
def test_translated_page_has_no_untranslated_text(pseudo_page, page_name, state_name):
    roots, setup = TRANSLATED_PAGES[page_name]
    seeded = (BASE_SEEDED_STATE if page_name in _BASE_STATE_PAGES
              else LIABILITIES_STATE if page_name.startswith(_LIABILITIES_PREFIXES)
              else PLAN_STATE if page_name.startswith('strategy') else SEEDED_STATE)
    _load_pseudo(pseudo_page, seeded if state_name == 'seeded' else EMPTY_STATE)
    pseudo_page.evaluate(setup)
    pseudo_page.wait_for_timeout(300)
    bad = pseudo_page.evaluate(SCAN_JS, {'roots': roots, 'allow': sorted(NON_TRANSLATABLE)})
    assert not bad, f'{page_name} ({state_name}): {len(bad)} untranslated string(s):\n' + '\n'.join(bad[:40])
    assert not pseudo_page.page_errors, pseudo_page.page_errors


@pytest.mark.feature
def test_scan_detects_hardcoded_english(pseudo_page):
    """Negative control: an injected unkeyed string must be reported, so a
    passing render guard actually means something."""
    _load_pseudo(pseudo_page, EMPTY_STATE)
    pseudo_page.evaluate("""() => {
        const p = document.createElement('p');
        p.textContent = 'Hardcoded English';
        p.setAttribute('aria-label', '⟦ok⟧');
        document.getElementById('retirementSection').appendChild(p);
    }""")
    bad = pseudo_page.evaluate(SCAN_JS, {'roots': ['#retirementSection'], 'allow': []})
    assert any('Hardcoded English' in b for b in bad)


@pytest.mark.feature
def test_pseudo_locale_route_is_active(pseudo_page):
    """Sanity check: the nav is wrapped in brackets, proving the pseudo 'es'
    dictionary is the one actually loaded."""
    _load_pseudo(pseudo_page, EMPTY_STATE)
    text = pseudo_page.inner_text('.page-button[data-page="health"]').strip()
    assert text.startswith('⟦') and text.endswith('⟧'), text


@pytest.mark.feature
def test_set_locale_rerenders_current_non_health_page(app_page):
    """setLocale re-renders whichever page is open, not just Health."""
    page = app_page
    page.evaluate("""async () => {
        window.app.switchPage('retirement');
        await window.app.renderRetirementPage();
    }""")
    page.wait_for_selector('#retirementSection h2')
    before = page.inner_text('#retirementSection h2').strip()
    page.evaluate("() => window.app.setLocale('es')")
    page.wait_for_function(
        "(b) => document.querySelector('#retirementSection h2')?.textContent.trim() !== b", arg=before)
    assert 'Jubilación' in page.inner_text('#retirementSection h2')
