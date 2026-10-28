#!/usr/bin/env python3
"""
Import person-id remapping (issue #421).

Persons get fresh ids on JSON import, so every record that references a person
(income.personId, debt.personIds/ownershipSplit) must be remapped through the
same old->new map. A reference that does not resolve becomes null / is dropped
(never a dangling id).
"""

import json

import pytest


def _import(page, payload, replace):
    return page.evaluate(
        """([json, replace]) => new Promise((resolve) => {
            const app = window.app;
            const orig = app.refreshCurrentPageData;
            app.refreshCurrentPageData = function (...args) {
                app.refreshCurrentPageData = orig;
                const r = orig.apply(app, args);
                resolve('imported');
                return r;
            };
            const file = new File([new Blob([json], { type: 'application/json' })], 'b.json', { type: 'application/json' });
            import('/src/dataExport.js').then(({ importAllJSON }) => {
                importAllJSON(app, file, {
                    requestImportMode: async () => replace,
                    onNoData: () => resolve('no-data'),
                    onInvalidJSON: () => resolve('invalid'),
                    onImportError: () => resolve('error')
                });
            });
        })""",
        [json.dumps(payload), replace])


def _income(name, person_id=None, **extra):
    inc = {"id": 900 + len(name), "name": name, "amount": 1000, "firstPayDate": "2026-01-02",
           "frequency": "monthly"}
    if person_id is not None:
        inc["personId"] = person_id
    inc.update(extra)
    return inc


def _income_person_names(page):
    return page.evaluate("""() => {
        const app = window.app;
        return Object.fromEntries(app.incomes.map(i => [i.name, i.personId == null ? null : (app.persons.find(p => p.id === i.personId)?.name ?? 'DANGLING')]));
    }""")


PERSONS = [{"id": 5, "name": "Alex"}, {"id": 6, "name": "Sam"}]


@pytest.mark.feature
def test_replace_import_remaps_income_person(app_page):
    page = app_page
    payload = {"persons": PERSONS, "incomes": [_income("Paycheck", 5), _income("Side", 6)]}
    assert _import(page, payload, True) == 'imported'
    assert _income_person_names(page) == {"Paycheck": "Alex", "Side": "Sam"}
    # Not the stale file id.
    assert page.evaluate("window.app.incomes.every(i => i.personId !== 5 && i.personId !== 6)")
    # Income card shows the right person pill.
    page.evaluate("window.app.switchPage('income')")
    page.wait_for_selector('#incomeList .income-card', timeout=5000)
    cards = page.eval_on_selector_all('#incomeList .income-card', "els => els.map(e => e.innerText)")
    assert any('Paycheck' in c and 'Alex' in c for c in cards), cards
    assert any('Side' in c and 'Sam' in c for c in cards), cards


@pytest.mark.feature
def test_merge_import_maps_income_to_existing_person_by_name(app_page):
    page = app_page
    page.evaluate("window.app.persons = [{ id: 777, name: 'Alex' }]")
    payload = {"persons": PERSONS, "incomes": [_income("Paycheck", 5)]}
    assert _import(page, payload, False) == 'imported'
    assert page.evaluate("window.app.incomes.find(i => i.name === 'Paycheck').personId") == 777


@pytest.mark.feature
def test_merge_import_maps_income_to_newly_created_person(app_page):
    page = app_page
    page.evaluate("window.app.persons = [{ id: 777, name: 'Alex' }]")
    payload = {"persons": PERSONS, "incomes": [_income("Side", 6)]}
    assert _import(page, payload, False) == 'imported'
    assert _income_person_names(page)["Side"] == "Sam"
    assert page.evaluate("window.app.incomes.find(i => i.name === 'Side').personId") != 6


@pytest.mark.feature
def test_merge_import_leaves_existing_income_untouched(app_page):
    page = app_page
    page.evaluate("""() => {
        window.app.persons = [{ id: 777, name: 'Alex' }];
        window.app.incomes = [{ id: 1, name: 'Paycheck', amount: 5, firstPayDate: '2026-01-02', frequency: 'monthly', personId: 777 }];
    }""")
    payload = {"persons": PERSONS, "incomes": [_income("Paycheck", 6)]}
    assert _import(page, payload, False) == 'imported'
    assert page.evaluate("window.app.incomes.filter(i => i.name === 'Paycheck').map(i => i.personId)") == [777]


@pytest.mark.feature
@pytest.mark.parametrize("replace", [True, False])
def test_income_with_unknown_person_becomes_null(app_page, replace):
    page = app_page
    payload = {"persons": PERSONS, "incomes": [_income("Ghost", 99)]}
    assert _import(page, payload, replace) == 'imported'
    assert _income_person_names(page)["Ghost"] is None


@pytest.mark.feature
@pytest.mark.parametrize("replace", [True, False])
def test_income_without_person_stays_null(app_page, replace):
    page = app_page
    payload = {"persons": PERSONS, "incomes": [_income("Plain")]}
    assert _import(page, payload, replace) == 'imported'
    assert _income_person_names(page)["Plain"] is None


@pytest.mark.feature
def test_income_person_without_persons_in_file_becomes_null(app_page):
    page = app_page
    payload = {"incomes": [_income("Orphan", 5)]}
    assert _import(page, payload, True) == 'imported'
    assert _income_person_names(page)["Orphan"] is None


@pytest.mark.feature
def test_debts_still_remap_and_drop_unknown_person_ids(app_page):
    page = app_page
    debt = {"id": 100, "name": "Mortgage", "debtType": "creditCard", "accountBalance": 800,
            "minimumPayment": 30, "interestRate": 5, "dueDate": 5,
            "personIds": [5, 6, 99], "ownershipSplit": {"5": 0.6, "6": 0.4, "99": 0.5}}
    assert _import(page, {"persons": PERSONS, "debts": [debt]}, True) == 'imported'
    out = page.evaluate("""() => {
        const app = window.app;
        const name = id => app.persons.find(p => p.id === id)?.name;
        const d = app.debts.find(x => x.name === 'Mortgage');
        return { people: d.personIds.map(name),
                 split: Object.fromEntries(Object.entries(d.ownershipSplit || {}).map(([k, v]) => [name(Number(k)), v])) };
    }""")
    assert out['people'] == ['Alex', 'Sam']
    assert out['split'] == {'Alex': 0.6, 'Sam': 0.4}


@pytest.mark.feature
def test_malicious_person_id_values_sanitize_to_null(app_page):
    page = app_page
    bad = ["<img src=x onerror=alert(1)>", "5", -3, {"a": 1}, [5], True, "__proto__"]
    incomes = [_income(f"Bad{i}", v) for i, v in enumerate(bad)]
    payload = {"persons": PERSONS, "incomes": incomes}
    assert _import(page, payload, True) == 'imported'
    names = _income_person_names(page)
    for i, v in enumerate(bad):
        # No value may survive as a dangling id; a numeric string may only resolve to a real person.
        assert names[f"Bad{i}"] in (None, "Alex", "Sam"), (v, names[f"Bad{i}"])
    # ("5" and [5] coerce to the integer 5, which is a real person in the file.)
    for i in (0, 2, 3, 5, 6):
        assert names[f"Bad{i}"] is None, (bad[i], names[f"Bad{i}"])


@pytest.mark.feature
def test_remap_helpers_direct(app_page):
    page = app_page
    out = page.evaluate("""async () => {
        const { remapIncomePersonRef, remapDebtPersonRefs } = await import('/src/sanitizers.js');
        return {
            hit: remapIncomePersonRef({ name: 'a', personId: 5 }, { 5: 50 }).personId,
            miss: remapIncomePersonRef({ name: 'a', personId: 6 }, { 5: 50 }).personId,
            none: remapIncomePersonRef({ name: 'a' }, { 5: 50 }).personId,
            noMap: remapIncomePersonRef({ name: 'a', personId: 5 }).personId,
            proto: remapIncomePersonRef({ name: 'a', personId: 'constructor' }, {}).personId,
            debt: remapDebtPersonRefs({ personIds: [5, 6], ownershipSplit: { 5: 0.5, 6: 0.5 } }, { 5: 50 })
        };
    }""")
    assert out['hit'] == 50
    assert out['miss'] is None and out['none'] is None and out['noMap'] is None and out['proto'] is None
    assert out['debt']['personIds'] == [50]
    assert out['debt']['ownershipSplit'] is None
