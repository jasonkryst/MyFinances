#!/usr/bin/env python3
"""
Debt ownership split tests (issue #272).

Debts linked to 2+ people can carry an optional `ownershipSplit`
({personId: fraction}, summing to 1.0). Absent/null = equal share. Income is
deliberately NOT split (each income keeps a single personId).
"""

import json

import pytest


# -- Helpers ------------------------------------------------------------------

def _nav_people(page):
    page.click('button[data-page="people"]')
    page.wait_for_selector('#peopleSection.active', timeout=5000)


def _add_person(page, name):
    _nav_people(page)
    page.fill('#personName', name)
    page.click('#personFormSubmit')
    page.wait_for_selector(f'#peopleList >> text={name}', timeout=5000)


def _nav_debts(page):
    page.click('button[data-page="liabilities"]')
    page.wait_for_selector('#liabilitiesSection.active', timeout=5000)


def _open_debt_form(page):
    toggle = page.query_selector('#debtFormToggle')
    if toggle and toggle.get_attribute('aria-expanded') == 'false':
        toggle.click()
        page.wait_for_selector('#debtFormBody:not([hidden])', timeout=3000)


def _fill_debt(page, name, balance=1000, minimum=100, limit=None):
    page.fill('#debtName', name)
    if limit is not None:
        page.select_option('#debtType', value='creditCard')
        page.fill('#creditLimit', str(limit))
    page.fill('#accountBalance', str(balance))
    page.fill('#interestRate', '5')
    page.fill('#minimumPayment', str(minimum))
    page.fill('#dueDate', '15')


def _pct_inputs(page, root='#debtOwnership'):
    return page.query_selector_all(f'{root} [data-ownership-pct]')


def _pct_values(page, root='#debtOwnership'):
    return [float(i.input_value()) for i in _pct_inputs(page, root)]


def _seed_people_and_debt(page, split, person_names=('Alex', 'Sam'), **debt_extra):
    """Seeds persons + one debt linked to all of them, returns (person_ids, debt_id)."""
    return page.evaluate(
        """([names, split, extra]) => {
            const app = window.app;
            app.persons = names.map((n, i) => ({ id: 9100 + i, name: n }));
            const ids = app.persons.map(p => p.id);
            const sp = split ? Object.fromEntries(split.map((f, i) => [ids[i], f])) : null;
            app.debts = [{ id: 9200, name: 'Mortgage', debtType: 'creditCard', accountBalance: 1000,
                originalBalance: 1000, interestRate: 5, minimumPayment: 100, originalMinimumPayment: 100,
                dueDate: 5, priority: null, accountId: null, personIds: ids, ownershipSplit: sp, ...extra }];
            app.saveToStorage();
            app.updateUI();
            return [ids, 9200];
        }""",
        [list(person_names), split, debt_extra])


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


def _sanitize(page, record):
    return page.evaluate(
        """async (record) => {
            const { sanitizeDebt } = await import('/src/sanitizers.js');
            const d = sanitizeDebt(JSON.parse(record), 1);
            return d.ownershipSplit === null ? null : JSON.parse(JSON.stringify(d.ownershipSplit));
        }""",
        json.dumps(record))


def _tile_text(page, person_name):
    return page.evaluate(
        """(name) => {
            const card = Array.from(document.querySelectorAll('#peopleList .income-card'))
                .find(c => c.querySelector('.income-card-name')?.textContent === name);
            return card ? card.querySelector('.person-summary-card').innerText : null;
        }""",
        person_name)


# -- Form control -------------------------------------------------------------

@pytest.mark.feature
def test_ownership_control_hidden_with_zero_or_one_person(app_page):
    page = app_page
    _add_person(page, 'Alex')
    _add_person(page, 'Sam')
    _nav_debts(page)
    _open_debt_form(page)
    assert not page.is_visible('#debtOwnership'), "Control must be hidden with no people selected"
    page.select_option('#debtPersons', label=['Alex'])
    assert not page.is_visible('#debtOwnership'), "Control must be hidden with one person selected"
    page.select_option('#debtPersons', label=['Alex', 'Sam'])
    page.wait_for_selector('#debtOwnership:not(.hidden)', timeout=3000)
    assert page.is_visible('#debtOwnership')
    page.select_option('#debtPersons', label=['Sam'])
    page.wait_for_selector('#debtOwnership.hidden', state='attached', timeout=3000)


@pytest.mark.feature
def test_default_is_shared_equally_and_saves_null_split(app_page):
    page = app_page
    _add_person(page, 'Alex')
    _add_person(page, 'Sam')
    _nav_debts(page)
    _open_debt_form(page)
    _fill_debt(page, 'Joint Loan')
    page.select_option('#debtPersons', label=['Alex', 'Sam'])
    page.wait_for_selector('#debtOwnership:not(.hidden)')
    assert page.is_checked('#debtOwnership input[value="equal"]')
    assert not page.is_visible('#debtOwnership [data-ownership-custom]')
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=Joint Loan', timeout=10000)
    debt = page.evaluate("window.app.debts.find(d => d.name === 'Joint Loan')")
    assert len(debt['personIds']) == 2
    assert debt['ownershipSplit'] is None
    assert page.query_selector('#debtsList [data-ownership-split]') is None, "No split line for equal shares"


@pytest.mark.feature
def test_custom_split_saved_and_shown_on_card(app_page):
    page = app_page
    _add_person(page, 'Alex')
    _add_person(page, 'Sam')
    _nav_debts(page)
    _open_debt_form(page)
    _fill_debt(page, 'Mortgage')
    page.select_option('#debtPersons', label=['Alex', 'Sam'])
    page.wait_for_selector('#debtOwnership:not(.hidden)')
    page.check('#debtOwnership input[value="custom"]')
    page.wait_for_selector('#debtOwnership [data-ownership-custom]:not(.hidden)')
    page.fill('#debtOwnership [data-ownership-pct] >> nth=0', '60')
    assert _pct_values(page) == [60.0, 40.0]
    page.click('#debtFormSubmit')
    page.wait_for_selector('#debtsList >> text=Mortgage', timeout=10000)
    debt = page.evaluate("window.app.debts.find(d => d.name === 'Mortgage')")
    shares = sorted(debt['ownershipSplit'].values())
    assert shares == pytest.approx([0.4, 0.6])
    text = page.inner_text('#debtsList [data-ownership-split]')
    assert 'Alex 60%' in text and 'Sam 40%' in text


@pytest.mark.feature
def test_auto_balance_two_and_three_people(app_page):
    page = app_page
    for n in ('Alex', 'Sam', 'Jo'):
        _add_person(page, n)
    _nav_debts(page)
    _open_debt_form(page)
    page.select_option('#debtPersons', label=['Alex', 'Sam'])
    page.wait_for_selector('#debtOwnership:not(.hidden)')
    page.check('#debtOwnership input[value="custom"]')
    page.fill('#debtOwnership [data-ownership-pct] >> nth=0', '70')
    assert _pct_values(page) == [70.0, 30.0]
    # Over 100 clamps; others never go negative.
    page.fill('#debtOwnership [data-ownership-pct] >> nth=1', '150')
    vals = _pct_values(page)
    assert vals[0] == 0 and vals[1] == 150, "Typed value is left alone; others clamp at 0"
    # Three people: remainder shared equally among the other two.
    page.select_option('#debtPersons', label=['Alex', 'Sam', 'Jo'])
    page.check('#debtOwnership input[value="custom"]')
    page.wait_for_selector('#debtOwnership [data-ownership-pct] >> nth=2')
    page.fill('#debtOwnership [data-ownership-pct] >> nth=0', '50')
    vals = _pct_values(page)
    assert vals == [50.0, 25.0, 25.0]
    assert sum(vals) == pytest.approx(100)
    assert page.inner_text('#debtOwnership [data-ownership-total]') == '100'
    page.fill('#debtOwnership [data-ownership-pct] >> nth=2', '100')
    assert _pct_values(page)[2] == 100 and sum(_pct_values(page)) == pytest.approx(100)


@pytest.mark.feature
def test_ownership_inputs_are_labelled_and_names_escaped(app_page):
    page = app_page
    page.evaluate("""() => {
        const app = window.app;
        app.persons = [{ id: 1, name: '<b id="pwn">Alex</b>' }, { id: 2, name: 'Sam' }];
        import('/src/people.js').then(m => m.refreshPersonSelectors(app));
    }""")
    _nav_debts(page)
    _open_debt_form(page)
    page.wait_for_function("document.querySelectorAll('#debtPersons option').length === 2")
    page.select_option('#debtPersons', value=['1', '2'])
    page.wait_for_selector('#debtOwnership:not(.hidden)')
    assert page.query_selector('#debtOwnership #pwn') is None, "Person name must be escaped"
    assert '<b id="pwn">Alex</b>' in page.text_content('#debtOwnership')
    for inp in _pct_inputs(page):
        assert inp.get_attribute('aria-label'), "Each percent input needs an accessible name"
        assert page.query_selector(f'label[for="{inp.get_attribute("id")}"]')


@pytest.mark.feature
def test_inline_edit_prefills_and_saves_split(app_page):
    page = app_page
    ids, debt_id = _seed_people_and_debt(page, [0.7, 0.3])
    _nav_debts(page)
    page.click('[data-debt-action="edit"]')
    root = f'#inline-ownership-{debt_id}'
    page.wait_for_selector(f'{root}:not(.hidden)', timeout=5000)
    assert page.is_checked(f'{root} input[value="custom"]')
    assert _pct_values(page, root) == [70.0, 30.0]
    page.fill(f'{root} [data-ownership-pct] >> nth=0', '20')
    assert _pct_values(page, root) == [20.0, 80.0]
    page.click('[data-debt-action="save-inline"]')
    page.wait_for_selector('#debtsList [data-ownership-split]', timeout=5000)
    split = page.evaluate("window.app.debts[0].ownershipSplit")
    assert split[str(ids[0])] == pytest.approx(0.2) and split[str(ids[1])] == pytest.approx(0.8)
    # Switching to "Shared equally" clears the split.
    page.click('[data-debt-action="edit"]')
    page.wait_for_selector(f'{root}:not(.hidden)')
    page.check(f'{root} input[value="equal"]')
    page.click('[data-debt-action="save-inline"]')
    page.wait_for_function("window.app.editingDebtId === null")
    assert page.evaluate("window.app.debts[0].ownershipSplit") is None
    # Dropping to one person also clears it and hides the control.
    page.evaluate("window.app.debts[0].ownershipSplit = {'%d': 0.7, '%d': 0.3}" % tuple(ids))
    page.evaluate("window.app.updateUI()")
    page.click('[data-debt-action="edit"]')
    page.wait_for_selector(f'{root}:not(.hidden)')
    page.select_option(f'#inline-persons-{debt_id}', value=[str(ids[0])])
    page.wait_for_selector(f'{root}.hidden', state='attached')


@pytest.mark.feature
def test_split_display_escapes_person_names(app_page):
    page = app_page
    _seed_people_and_debt(page, [0.6, 0.4], person_names=('<img src=x onerror="window.__xss=1">', 'Sam'))
    _nav_debts(page)
    el = page.wait_for_selector('#debtsList [data-ownership-split]')
    assert page.evaluate("window.__xss") is None
    assert el.query_selector('img') is None
    assert '<img' in el.inner_text() and '60%' in el.inner_text()


# -- People summaries -----------------------------------------------------------

@pytest.mark.feature
def test_people_tiles_attribute_debt_by_split(app_page):
    page = app_page
    _seed_people_and_debt(page, [0.6, 0.4])
    page.evaluate("window.app.switchPage('people')")
    page.wait_for_selector('#peopleSection.active')
    alex, sam = _tile_text(page, 'Alex'), _tile_text(page, 'Sam')
    assert '$600.00' in alex and '$400.00' in sam, (alex, sam)
    # Monthly net = 0 income - proportional min payment (100)
    assert '-$60.00' in alex and '-$40.00' in sam, (alex, sam)


@pytest.mark.feature
def test_people_tiles_equal_share_when_no_split(app_page):
    page = app_page
    _seed_people_and_debt(page, None)
    page.evaluate("window.app.switchPage('people')")
    page.wait_for_selector('#peopleSection.active')
    assert '$500.00' in _tile_text(page, 'Alex') and '$500.00' in _tile_text(page, 'Sam')


@pytest.mark.feature
def test_people_credit_util_consistent_with_split(app_page):
    page = app_page
    _seed_people_and_debt(page, [0.75, 0.25], creditLimit=2000)
    page.evaluate("window.app.switchPage('people')")
    page.wait_for_selector('#peopleSection.active')
    # share of balance / share of limit == 1000/2000 for both
    assert '50%' in _tile_text(page, 'Alex') and '50%' in _tile_text(page, 'Sam')


# -- Sanitizer ------------------------------------------------------------------

BASE = {"name": "D", "personIds": [1, 2]}


@pytest.mark.feature
def test_sanitizer_valid_split_kept_and_legacy_is_null(app_page):
    page = app_page
    assert _sanitize(page, {**BASE, "ownershipSplit": {"1": 0.6, "2": 0.4}}) == {"1": 0.6, "2": 0.4}
    assert _sanitize(page, BASE) is None, "Legacy debt without the field is an equal share"


@pytest.mark.feature
def test_sanitizer_normalizes_sum_and_drops_unlinked_keys(app_page):
    page = app_page
    assert _sanitize(page, {**BASE, "ownershipSplit": {"1": 0.25, "2": 0.25}}) == {"1": 0.5, "2": 0.5}
    out = _sanitize(page, {**BASE, "ownershipSplit": {"1": 0.5, "2": 0.5, "99": 0.9}})
    assert out == {"1": 0.5, "2": 0.5} and "99" not in out
    # Within tolerance: untouched.
    assert _sanitize(page, {**BASE, "ownershipSplit": {"1": 0.605, "2": 0.4}}) == {"1": 0.605, "2": 0.4}
    # A linked person missing from the map gets 0%.
    assert _sanitize(page, {**BASE, "ownershipSplit": {"1": 1}}) == {"1": 1, "2": 0}


@pytest.mark.feature
def test_sanitizer_rejects_invalid_splits(app_page):
    page = app_page
    for bad in (None, [], "x", 5, {}, {"1": 0, "2": 0}, {"1": "0.5", "2": "0.5"}, {"1": -1, "2": -2}):
        assert _sanitize(page, {**BASE, "ownershipSplit": bad}) is None, bad
    # NaN/Infinity can't be expressed in JSON; check them via direct call.
    out = page.evaluate("""async () => {
        const { sanitizeDebt } = await import('/src/sanitizers.js');
        const d = sanitizeDebt({ name: 'D', personIds: [1, 2], ownershipSplit: { 1: NaN, 2: Infinity } }, 1);
        return d.ownershipSplit;
    }""")
    assert out is None
    # Negative value is clamped to 0 and the rest carry the split.
    assert _sanitize(page, {**BASE, "ownershipSplit": {"1": -0.5, "2": 1}}) == {"1": 0, "2": 1}
    # Single linked person has no split; no linked people either.
    assert _sanitize(page, {"name": "D", "personIds": [1], "ownershipSplit": {"1": 1}}) is None
    assert _sanitize(page, {"name": "D", "personIds": [], "ownershipSplit": {"1": 1}}) is None


@pytest.mark.feature
def test_sanitizer_ignores_prototype_pollution_keys(app_page):
    page = app_page
    result = page.evaluate("""async () => {
        const { sanitizeDebt } = await import('/src/sanitizers.js');
        const raw = JSON.parse('{"name":"D","personIds":[1,2],"ownershipSplit":{"__proto__":{"polluted":1},"constructor":0.5,"1":0.5,"2":0.5}}');
        const d = sanitizeDebt(raw, 1);
        return {
            keys: Object.keys(d.ownershipSplit), polluted: ({}).polluted === undefined ? false : true,
            ownProto: Object.prototype.hasOwnProperty.call(d.ownershipSplit, '__proto__'),
            hasCtor: Object.prototype.hasOwnProperty.call(d.ownershipSplit, 'constructor')
        };
    }""")
    assert result['keys'] == ['1', '2']
    assert not result['polluted'] and not result['ownProto'] and not result['hasCtor']


@pytest.mark.feature
def test_import_warns_when_split_is_coerced(app_page):
    page = app_page
    warnings = page.evaluate("""async () => {
        const { sanitizeParsedState } = await import('/src/sanitizers.js');
        const w = [];
        sanitizeParsedState({ debts: [{ name: 'D', personIds: [1, 2], ownershipSplit: { 1: 0.2, 2: 0.2 } }] }, w);
        return w;
    }""")
    assert any(w['field'] == 'ownershipSplit' and w['kind'] == 'coerced' for w in warnings), warnings


# -- Export / import ------------------------------------------------------------

def _payload():
    return {
        "persons": [{"id": 5, "name": "Alex"}, {"id": 6, "name": "Sam"}],
        "debts": [{"id": 100, "name": "Mortgage", "debtType": "creditCard", "accountBalance": 800,
                   "minimumPayment": 30, "interestRate": 5, "dueDate": 5,
                   "personIds": [5, 6], "ownershipSplit": {"5": 0.6, "6": 0.4}}],
    }


def _name_split(page):
    return page.evaluate("""() => {
        const app = window.app;
        const name = id => app.persons.find(p => p.id === id)?.name;
        const d = app.debts.find(x => x.name === 'Mortgage');
        return {
            people: d.personIds.map(name),
            split: Object.fromEntries(Object.entries(d.ownershipSplit).map(([k, v]) => [name(Number(k)), v]))
        };
    }""")


@pytest.mark.feature
def test_import_replace_remaps_person_ids_in_split(app_page):
    page = app_page
    assert _import(page, _payload(), True) == 'imported'
    out = _name_split(page)
    assert out['people'] == ['Alex', 'Sam']
    assert out['split'] == {'Alex': 0.6, 'Sam': 0.4}


@pytest.mark.feature
def test_import_merge_remaps_person_ids_in_split(app_page):
    page = app_page
    # 'Alex' already exists locally under a different id -> incoming maps onto it by name.
    page.evaluate("window.app.persons = [{ id: 777, name: 'Alex' }]")
    assert _import(page, _payload(), False) == 'imported'
    out = _name_split(page)
    assert out['people'] == ['Alex', 'Sam']
    assert out['split'] == {'Alex': 0.6, 'Sam': 0.4}
    assert page.evaluate("window.app.debts.find(d => d.name === 'Mortgage').personIds[0]") == 777


@pytest.mark.feature
def test_export_import_round_trip_preserves_split(app_page):
    page = app_page
    _seed_people_and_debt(page, [0.6, 0.4])
    exported = page.evaluate("""async () => {
        const app = window.app;
        const dbg = {};
        const origCreate = URL.createObjectURL;
        let blob = null;
        URL.createObjectURL = b => { blob = b; return 'blob:x'; };
        const { exportAllJSON } = await import('/src/dataExport.js');
        try { exportAllJSON(app); } catch (e) { dbg.err = String(e); }
        URL.createObjectURL = origCreate;
        return blob ? await blob.text() : null;
    }""")
    assert exported, "export produced no payload"
    payload = json.loads(exported)
    assert payload['debts'][0]['ownershipSplit']
    page.evaluate("window.app.debts = []; window.app.persons = [];")
    assert _import(page, payload, True) == 'imported'
    out = page.evaluate("""() => {
        const app = window.app;
        const d = app.debts[0];
        return Object.entries(d.ownershipSplit).map(([k, v]) => [app.persons.find(p => p.id === Number(k))?.name, v]);
    }""")
    assert dict(out) == {'Alex': 0.6, 'Sam': 0.4}


@pytest.mark.feature
def test_split_survives_reload(app_page):
    page = app_page
    _seed_people_and_debt(page, [0.6, 0.4])
    page.wait_for_function("(localStorage.getItem('debtTrackerData') || '').includes('ownershipSplit')")
    page.reload()
    page.wait_for_selector('#healthSection.active', timeout=5000)
    split = page.evaluate("window.app.debts[0].ownershipSplit")
    assert sorted(split.values()) == pytest.approx([0.4, 0.6])


@pytest.mark.feature
def test_legacy_debt_without_field_loads_as_equal_share(app_page):
    page = app_page
    page.evaluate("""() => {
        localStorage.setItem('debtTrackerData', JSON.stringify({
            persons: [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sam' }],
            debts: [{ id: 5, name: 'Old', debtType: 'creditCard', accountBalance: 100, minimumPayment: 10,
                      interestRate: 5, dueDate: 3, personIds: [1, 2] }]
        }));
    }""")
    page.reload()
    page.wait_for_selector('#healthSection.active', timeout=5000)
    assert page.evaluate("window.app.debts[0].ownershipSplit") is None
    page.evaluate("window.app.switchPage('people')")
    page.wait_for_selector('#peopleSection.active')
    assert '$50.00' in _tile_text(page, 'Alex')


# -- Person deletion --------------------------------------------------------------

def _delete_person(page, person_id, replacement=None):
    page.evaluate(f"() => {{ window.app.deletePerson({person_id}); }}")
    page.wait_for_selector('#personReplacementModal:not(.hidden)', timeout=5000)
    if replacement is not None:
        page.select_option('#personReplacementSelect', value=str(replacement))
    page.click('#personReplacementConfirmBtn')
    page.wait_for_selector('#deleteConfirmModal:not(.hidden)', timeout=5000)
    page.click('#deleteConfirmBtn')
    page.wait_for_function(f"!window.app.persons.some(p => p.id === {person_id})")


@pytest.mark.feature
def test_delete_person_removes_key_and_renormalizes(app_page):
    page = app_page
    ids, _ = _seed_people_and_debt(page, [0.5, 0.3, 0.2], person_names=('A', 'B', 'C'))
    _delete_person(page, ids[1])
    d = page.evaluate("window.app.debts[0]")
    assert d['personIds'] == [ids[0], ids[2]]
    assert str(ids[1]) not in d['ownershipSplit']
    assert d['ownershipSplit'][str(ids[0])] == pytest.approx(0.5 / 0.7)
    assert d['ownershipSplit'][str(ids[2])] == pytest.approx(0.2 / 0.7)
    assert sum(d['ownershipSplit'].values()) == pytest.approx(1)


@pytest.mark.feature
def test_delete_person_moves_share_to_replacement(app_page):
    page = app_page
    ids, _ = _seed_people_and_debt(page, [0.5, 0.3, 0.2], person_names=('A', 'B', 'C'))
    _delete_person(page, ids[1], replacement=ids[2])
    d = page.evaluate("window.app.debts[0]")
    assert d['personIds'] == [ids[0], ids[2]]
    assert d['ownershipSplit'][str(ids[0])] == pytest.approx(0.5)
    assert d['ownershipSplit'][str(ids[2])] == pytest.approx(0.5)


@pytest.mark.feature
def test_delete_person_leaving_one_owner_clears_split(app_page):
    page = app_page
    ids, _ = _seed_people_and_debt(page, [0.6, 0.4])
    _delete_person(page, ids[1])
    d = page.evaluate("window.app.debts[0]")
    assert d['personIds'] == [ids[0]]
    assert d['ownershipSplit'] is None


@pytest.mark.feature
def test_delete_person_with_replacement_not_yet_linked(app_page):
    page = app_page
    ids, _ = _seed_people_and_debt(page, [0.6, 0.4])
    page.evaluate("window.app.persons.push({ id: 9300, name: 'Newbie' })")
    _delete_person(page, ids[1], replacement=9300)
    d = page.evaluate("window.app.debts[0]")
    assert d['personIds'] == [ids[0], 9300]
    assert d['ownershipSplit'][str(ids[0])] == pytest.approx(0.6)
    assert d['ownershipSplit']['9300'] == pytest.approx(0.4)


# -- Income stays single-owner ---------------------------------------------------

@pytest.mark.feature
def test_income_has_no_ownership_split(app_page):
    page = app_page
    out = page.evaluate("""async () => {
        const { sanitizeIncome } = await import('/src/sanitizers.js');
        return sanitizeIncome({ name: 'Pay', amount: 1, firstPayDate: '2026-01-01', personId: 3, ownershipSplit: { 3: 1 } }, 1);
    }""")
    assert 'ownershipSplit' not in out and out['personId'] == 3
