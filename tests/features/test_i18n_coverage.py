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
    const check = (text, where) => {
        const words = strip(text).match(/\\p{L}{2,}/gu) || [];
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
           'accounts.sortApyDesc', 'homePurchase.pmiBelowValue', 'income.estBadge', 'savings.autoTag'},
    'pl': {'nav.strategy', 'health.personDti', 'retirement.coastTitle', 'accounts.apyBadge',
           'accounts.sortApyAsc', 'accounts.sortApyDesc', 'savings.autoTag'},
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
    seeded = BASE_SEEDED_STATE if page_name in _BASE_STATE_PAGES else SEEDED_STATE
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
