// Deleting every collection without deadlocking (#608).
const {
    RESOURCE_TABLES,
    ALL_RESOURCE_PATHS,
    RESOURCE_PARENTS,
    deletionLayers,
} = require('../../src/resourceDeletion.js');

describe('the declared collections', () => {
    test('every path is an /api/ collection mapped to a table', () => {
        expect(ALL_RESOURCE_PATHS.length).toBe(20);
        for (const path of ALL_RESOURCE_PATHS) {
            expect(path).toMatch(/^\/api\/[a-z-]+$/);
            expect(RESOURCE_TABLES[path]).toMatch(/^[a-z_]+$/);
        }
        expect(new Set(Object.values(RESOURCE_TABLES)).size).toBe(ALL_RESOURCE_PATHS.length);
    });

    test('the parent map matches the schema\'s foreign keys', () => {
        // Mirrors information_schema as of migration 033; server/test/resourceDeletion.test.js
        // checks the map against the live database, so update both when a foreign key changes.
        const accounts = ['/api/accounts'];
        expect(RESOURCE_PARENTS).toEqual({
            '/api/debts': accounts,
            '/api/incomes': ['/api/accounts', '/api/persons'],
            '/api/bonuses': accounts,
            '/api/bills': accounts,
            '/api/expenses': accounts,
            '/api/recurring-templates': accounts,
            '/api/emergency-funds': accounts,
            '/api/sinking-funds': accounts,
            '/api/reconciliations': accounts,
            '/api/retirement-snapshots': accounts,
            '/api/transfers': accounts,
            '/api/manual-transactions': accounts,
            '/api/ledger-overrides': accounts,
            '/api/balance-history': ['/api/accounts', '/api/debts'],
        });
    });

    test('the table map is the server\'s table names', () => {
        expect(RESOURCE_TABLES).toEqual({
            '/api/persons': 'persons',
            '/api/debts': 'debts',
            '/api/accounts': 'accounts',
            '/api/incomes': 'incomes',
            '/api/bonuses': 'bonuses',
            '/api/bills': 'bills',
            '/api/expenses': 'expenses',
            '/api/recurring-templates': 'recurring_templates',
            '/api/emergency-funds': 'emergency_funds',
            '/api/sinking-funds': 'sinking_funds',
            '/api/reconciliations': 'reconciliations',
            '/api/plan-history': 'plan_history',
            '/api/retirement-snapshots': 'retirement_snapshots',
            '/api/transfers': 'transfers',
            '/api/manual-transactions': 'manual_transactions',
            '/api/ledger-overrides': 'ledger_amount_overrides',
            '/api/ledger-cleared': 'ledger_cleared_transactions',
            '/api/net-worth-snapshots': 'net_worth_snapshots',
            '/api/balance-history': 'balance_history',
            '/api/settings': 'settings',
        });
    });

    test('every declared parent is a known collection', () => {
        for (const [child, parents] of Object.entries(RESOURCE_PARENTS)) {
            expect(ALL_RESOURCE_PATHS).toContain(child);
            for (const parent of parents) expect(ALL_RESOURCE_PATHS).toContain(parent);
        }
    });
});

describe('deletionLayers on the real graph', () => {
    const layers = deletionLayers();
    const layerOf = path => layers.findIndex(layer => layer.includes(path));

    test('deletes every collection exactly once', () => {
        const flat = layers.flat();
        expect(flat).toHaveLength(ALL_RESOURCE_PATHS.length);
        expect(new Set(flat)).toEqual(new Set(ALL_RESOURCE_PATHS));
    });

    test('every child is deleted in an earlier layer than each of its parents', () => {
        for (const [child, parents] of Object.entries(RESOURCE_PARENTS)) {
            for (const parent of parents) expect(layerOf(child)).toBeLessThan(layerOf(parent));
        }
    });

    test('is three layers: leaves, then debts and persons, then accounts', () => {
        expect(layers).toHaveLength(3);
        expect(layers[1].sort()).toEqual(['/api/debts', '/api/persons']);
        expect(layers[2]).toEqual(['/api/accounts']);
        expect(layers[0]).toContain('/api/balance-history');
        expect(layers[0]).toContain('/api/incomes');
        expect(layers[0]).toContain('/api/settings');
    });

    test('keeps the input order within a layer', () => {
        const firstLayerOrder = ALL_RESOURCE_PATHS.filter(p => layers[0].includes(p));
        expect(layers[0]).toEqual(firstLayerOrder);
    });
});

describe('deletionLayers on other graphs', () => {
    test('no references is one parallel layer', () => {
        expect(deletionLayers(['/a', '/b', '/c'], {})).toEqual([['/a', '/b', '/c']]);
    });

    test('a chain is one collection per layer, child first', () => {
        expect(deletionLayers(['/top', '/mid', '/leaf'], { '/leaf': ['/mid'], '/mid': ['/top'] }))
            .toEqual([['/leaf'], ['/mid'], ['/top']]);
    });

    test('a collection referenced by two children waits for both', () => {
        expect(deletionLayers(['/p', '/a', '/b'], { '/a': ['/p'], '/b': ['/p'] }))
            .toEqual([['/a', '/b'], ['/p']]);
    });

    test('parents of collections outside the list are ignored', () => {
        expect(deletionLayers(['/a'], { '/gone': ['/a'] })).toEqual([['/a']]);
    });

    test('a collection outside the list may reference another one outside it', () => {
        expect(deletionLayers(['/a'], { '/gone': ['/also-gone'] })).toEqual([['/a']]);
    });

    test('an empty list has no layers', () => {
        expect(deletionLayers([], {})).toEqual([]);
    });

    test('a parent that is not in the list throws instead of risking the order', () => {
        expect(() => deletionLayers(['/a'], { '/a': ['/missing'] }))
            .toThrow('/a references unknown collection /missing');
    });

    test('a reference cycle throws', () => {
        expect(() => deletionLayers(['/a', '/b', '/c'], { '/a': ['/b'], '/b': ['/a'] }))
            .toThrow('reference cycle among /a, /b');
    });

    test('a self-reference throws', () => {
        expect(() => deletionLayers(['/a'], { '/a': ['/a'] })).toThrow('reference cycle among /a');
    });

    test('defaults to the real collections', () => {
        expect(deletionLayers()).toEqual(deletionLayers(ALL_RESOURCE_PATHS, RESOURCE_PARENTS));
    });
});
