#!/usr/bin/env python3
"""
Command palette record search (#686): typing part of a record's name lists
matching accounts, debts, incomes, recurring templates, savings funds and
people, grouped by type with the amount; Enter opens the record's page (and
sub-tab, list page and filters as needed), highlights its card and focuses
its Edit button. Archived records and ended incomes are not listed.
Matching is pure (src/paletteSearch.js, Jest); these tests cover the wiring.
"""

import pytest

from tests.conftest import assert_no_errors, seed_state


def _debt(i, name, **extra):
    d = {'id': i, 'name': name, 'debtType': 'creditCard', 'accountBalance': 1000 + i,
         'originalBalance': 2000, 'minimumPayment': 25, 'interestRate': 10, 'dueDate': 5}
    d.update(extra)
    return d


STATE = {
    'accounts': [
        {'id': 1, 'name': 'Visa Checking', 'type': 'Checking', 'startingBalance': 2500},
        {'id': 2, 'name': 'Old Visa Savings', 'type': 'Savings', 'startingBalance': 10, 'archived': True},
        {'id': 3, 'name': 'Rainy Day', 'type': 'Savings', 'startingBalance': 4000},
    ],
    'debts': [
        _debt(1, 'Visa Card', accountBalance=1234.5, category='Cards'),
        _debt(2, 'Visa Archived', archived=True),
        _debt(3, 'Préstamo Coche', category='Loans'),
    ],
    'incomes': [
        {'id': 1, 'name': 'Visa Bonus Job', 'amount': 3000, 'frequency': 'monthly',
         'firstPayDate': '2026-01-15', 'accountId': 1},
        {'id': 2, 'name': 'Visa Old Job', 'amount': 3000, 'frequency': 'monthly',
         'firstPayDate': '2025-01-15', 'endDate': '2025-06-15', 'accountId': 1},
    ],
    'recurringTemplates': [
        {'id': 1, 'name': 'Netflix', 'type': 'subscription', 'amount': 15.99, 'frequency': 'monthly',
         'dayOfMonth': 3, 'accountId': 1, 'category': 'Entertainment', 'startDate': '2026-01-01'},
    ],
    'emergencyFunds': [
        {'id': 1, 'accountId': 3, 'targetAmount': 10000, 'currentAmount': 4000, 'monthlyContribution': 100},
    ],
    'sinkingFunds': [
        {'id': 1, 'name': 'Vacation Fund', 'allocationMethod': 'fixed', 'monthlyAllocation': 50,
         'targetAmount': 1200, 'currentAmount': 300, 'accountId': 3},
    ],
    'persons': [{'id': 1, 'name': 'Alex Visa'}],
}


def _open(page, query):
    page.click('#commandPaletteBtn')
    page.wait_for_selector('#commandPaletteInput:focus', timeout=5000)
    page.fill('#commandPaletteInput', query)


def _items(page):
    return page.evaluate("""() => [...document.querySelectorAll('#commandPaletteList li')].map(li => ({
        heading: li.classList.contains('cmdpal-group'),
        type: li.dataset.recordType || null,
        label: li.querySelector('.cmdpal-item-label')?.textContent ?? li.textContent.trim(),
        hint: li.querySelector('.cmdpal-item-hint')?.textContent ?? null,
        hidden: li.getAttribute('aria-hidden'),
    }))""")


def _choose(page, label, record_type=None):
    """Arrow down to the option with this label (and record type), then Enter."""
    options = [(i['label'], i['type']) for i in _items(page) if not i['heading']]
    idx = next((n for n, (lab, typ) in enumerate(options)
                if lab == label and (record_type is None or typ == record_type)), None)
    assert idx is not None, options
    for _ in range(idx):
        page.keyboard.press('ArrowDown')
    page.keyboard.press('Enter')


COLLECTIONS = {'account': 'accounts', 'debt': 'debts', 'income': 'incomes', 'recurring': 'recurringTemplates',
               'sinking': 'sinkingFunds', 'person': 'persons'}


def _edit(page, rtype, name):
    """The Edit button selector for a record, by name (the server assigns ids on import)."""
    if rtype == 'emergency':
        rid = page.evaluate("""(n) => {
            const acct = window.app.accounts.find(a => a.name === n);
            return window.app.emergencyFunds.find(f => f.accountId === acct.id).id;
        }""", name)
    else:
        rid = page.evaluate("([c, n]) => window.app[c].find(r => r.name === n).id", [COLLECTIONS[rtype], name])
    return f'[data-{rtype}-action="edit"][data-{rtype}-id="{rid}"]'


@pytest.fixture
def seeded(app_page):
    seed_state(app_page, STATE)
    return app_page


@pytest.mark.ui
def test_typing_a_debt_name_and_enter_lands_on_its_card(seeded):
    """The issue's acceptance: part of a debt's name + Enter focuses that debt's card."""
    page = seeded
    _open(page, 'visa ca')
    page.keyboard.press('Enter')
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)
    edit = _edit(page, 'debt', 'Visa Card')
    page.wait_for_selector(f'{edit}:focus', timeout=5000)
    card = page.locator(f'.debt-card:has({edit})')
    assert 'cmdpal-highlight' in (card.get_attribute('class') or '')
    assert page.is_hidden('#commandPaletteOverlay')
    # The highlight is brief.
    page.wait_for_function(
        "() => !document.querySelector('.cmdpal-highlight')", timeout=5000)
    assert_no_errors(page)


@pytest.mark.ui
def test_results_are_grouped_by_type_with_amounts(seeded):
    page = seeded
    _open(page, 'visa')
    items = _items(page)
    records = [i for i in items if i['type']]
    assert [(r['type'], r['label']) for r in records] == [
        ('account', 'Visa Checking'),
        ('debt', 'Visa Card'),
        ('income', 'Visa Bonus Job'),
        ('person', 'Alex Visa'),
    ]
    hints = {r['label']: r['hint'] for r in records}
    assert hints['Visa Checking'] == 'Account · $2,500.00'
    assert hints['Visa Card'] == 'Debt · $1,234.50'
    assert hints['Visa Bonus Job'] == 'Income · $3,000.00'
    assert hints['Alex Visa'] == 'Person'
    headings = [i for i in items if i['heading']]
    assert [h['label'] for h in headings] == ['Accounts', 'Debts', 'Income', 'People']
    assert all(h['hidden'] == 'true' for h in headings)


@pytest.mark.ui
def test_archived_records_and_ended_incomes_are_not_listed(seeded):
    """Negative: hidden-by-default records never appear."""
    page = seeded
    _open(page, 'visa')
    labels = [i['label'] for i in _items(page)]
    for gone in ('Old Visa Savings', 'Visa Archived', 'Visa Old Job'):
        assert gone not in labels


@pytest.mark.ui
def test_empty_query_lists_commands_only(seeded):
    """Negative: records appear only while typing."""
    page = seeded
    _open(page, '')
    assert not any(i['type'] for i in _items(page))
    page.fill('#commandPaletteInput', 'zzzz-no-such-thing')
    assert page.inner_text('#commandPaletteList').strip() == 'No matching commands'


@pytest.mark.ui
def test_matching_ignores_accents_and_case(seeded):
    page = seeded
    _open(page, 'PRESTAMO')
    assert [i['label'] for i in _items(page) if i['type']] == ['Préstamo Coche']


@pytest.mark.ui
@pytest.mark.parametrize('query,label,rtype,section', [
    ('rainy', 'Rainy Day', 'emergency', '#savingsSection.active'),
    ('rainy', 'Rainy Day', 'account', '#accountsSection.active'),
    ('vacation', 'Vacation Fund', 'sinking', '#savingsSection.active'),
    ('netflix', 'Netflix', 'recurring', '#recurringSection.active'),
    ('alex', 'Alex Visa', 'person', '#peopleSection.active'),
    ('bonus job', 'Visa Bonus Job', 'income', '#incomeSection.active'),
])
def test_each_record_type_jumps_to_its_card(seeded, query, label, rtype, section):
    page = seeded
    if rtype == 'emergency':
        # Start on the Sinking sub-tab so the jump has to switch it.
        page.evaluate("() => { window.app.savingsSubTab = 'sinking'; }")
    _open(page, query)
    _choose(page, label, rtype)
    page.wait_for_selector(section, timeout=5000)
    page.wait_for_selector(f"{_edit(page, rtype, label)}:focus", timeout=5000)
    assert_no_errors(page)


@pytest.mark.ui
def test_jump_opens_the_list_page_that_holds_the_debt(app_page):
    """#330 pagination: a debt on page 2 is revealed, not left off-screen."""
    page = app_page
    debts = [_debt(i, f'Card {i:02d}') for i in range(1, 31)]
    debts.append(_debt(99, 'Zebra Loan'))
    seed_state(page, {'debts': debts})
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#debtsList .debt-card', timeout=5000)
    edit = _edit(page, 'debt', 'Zebra Loan')
    assert page.locator(edit).count() == 0
    _open(page, 'zebra')
    page.keyboard.press('Enter')
    page.wait_for_selector(f'{edit}:focus', timeout=5000)
    assert page.evaluate('() => window.app._revealDebtId') is None


@pytest.mark.ui
def test_jump_clears_a_filter_that_hides_the_debt(seeded):
    page = seeded
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#debtsList .debt-card', timeout=5000)
    page.evaluate("""() => {
        const f = document.getElementById('categoryFilter');
        f.value = 'Loans';
        f.dispatchEvent(new Event('change', { bubbles: true }));
    }""")
    edit = _edit(page, 'debt', 'Visa Card')
    page.wait_for_selector(edit, state='detached', timeout=5000)
    _open(page, 'visa card')
    _choose(page, 'Visa Card')
    page.wait_for_selector(f'{edit}:focus', timeout=5000)
    assert page.input_value('#categoryFilter') == ''


@pytest.mark.ui
def test_record_jump_does_not_return_focus_to_the_toolbar(seeded):
    """Negative: closing for a record jump leaves focus on the record, unlike Escape."""
    page = seeded
    _open(page, 'visa card')
    page.keyboard.press('Enter')
    page.wait_for_selector(f"{_edit(page, 'debt', 'Visa Card')}:focus", timeout=5000)
    assert page.evaluate("() => document.activeElement.id") != 'commandPaletteBtn'


@pytest.mark.ui
def test_record_names_are_escaped(app_page):
    """Security: a record name is text, never markup."""
    page = app_page
    seed_state(page, {'accounts': [
        {'id': 1, 'name': 'Evil <img src=x onerror="window.__pwned=1">', 'type': 'Checking', 'startingBalance': 1}]})
    _open(page, 'evil')
    assert page.locator('#commandPaletteList img').count() == 0
    stored = page.evaluate('() => window.app.accounts[0].name')
    assert page.inner_text('#commandPaletteList .cmdpal-item-label') == stored
    # Bypass the sanitizer too: markup in an in-memory name still renders as text.
    page.keyboard.press('Escape')
    page.evaluate("() => { window.app.accounts[0].name = 'Evil <b>bold</b>'; }")
    _open(page, 'evil')
    assert page.locator('#commandPaletteList b').count() == 0
    assert page.inner_text('#commandPaletteList .cmdpal-item-label') == 'Evil <b>bold</b>'
    assert page.evaluate('() => window.__pwned') is None


@pytest.mark.ui
def test_palette_follows_the_locale(seeded):
    page = seeded
    page.evaluate("() => window.app.setLocale('es')")
    page.wait_for_function(
        "() => document.getElementById('commandPaletteInput').placeholder.startsWith('Ir a')")
    _open(page, 'visa')
    items = _items(page)
    hints = {i['label']: i['hint'] for i in items if i['type']}
    assert hints['Alex Visa'] == 'Persona'
    assert hints['Visa Card'].startswith('Deuda · ')
    assert 'Cuentas' in [i['label'] for i in items if i['heading']]
    page.fill('#commandPaletteInput', 'libro')
    assert 'Ir a la página' in [i['hint'] for i in _items(page)]
    assert page.get_attribute('#commandPaletteList', 'aria-label') == 'Comandos coincidentes'
