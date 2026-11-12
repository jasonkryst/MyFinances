// Every server collection, the table behind it, and the order in which they can
// be wiped without deadlocking (#608). Pure: no imports, no DOM; Jest-tested and
// checked against the database's real foreign keys by server/test/resourceDeletion.test.js.

// Collection path -> Postgres table.
export const RESOURCE_TABLES = {
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
};

export const ALL_RESOURCE_PATHS = Object.keys(RESOURCE_TABLES);

// The collections each one references through a foreign key (the users table is
// left out: every row has one). Deleting a parent while its children are being
// deleted in parallel deadlocks: the parent's ON DELETE SET NULL / CASCADE
// updates the very child rows another request is deleting.
// Every foreign key between two of these tables must be listed here; the server
// test fails otherwise.
export const RESOURCE_PARENTS = {
    '/api/debts': ['/api/accounts'],
    '/api/incomes': ['/api/accounts', '/api/persons'],
    '/api/bonuses': ['/api/accounts'],
    '/api/bills': ['/api/accounts'],
    '/api/expenses': ['/api/accounts'],
    '/api/recurring-templates': ['/api/accounts'],
    '/api/emergency-funds': ['/api/accounts'],
    '/api/sinking-funds': ['/api/accounts'],
    '/api/reconciliations': ['/api/accounts'],
    '/api/retirement-snapshots': ['/api/accounts'],
    '/api/transfers': ['/api/accounts'],
    '/api/manual-transactions': ['/api/accounts'],
    '/api/ledger-overrides': ['/api/accounts'],
    '/api/balance-history': ['/api/accounts', '/api/debts'],
};

// Split `paths` into layers that can each be deleted in parallel: every layer
// holds only collections that nothing still waiting references, so children
// always go before their parents. Throws on a parent that isn't in `paths` or on
// a reference cycle, rather than returning an order that could deadlock.
export function deletionLayers(paths = ALL_RESOURCE_PATHS, parents = RESOURCE_PARENTS) {
    const remaining = new Set(paths);
    for (const [child, refs] of Object.entries(parents)) {
        if (!remaining.has(child)) continue;
        for (const parent of refs) {
            if (!remaining.has(parent)) throw new Error(`${child} references unknown collection ${parent}`);
        }
    }
    const layers = [];
    while (remaining.size) {
        const referenced = new Set();
        for (const [child, refs] of Object.entries(parents)) {
            if (remaining.has(child)) refs.forEach(parent => referenced.add(parent));
        }
        const layer = [...remaining].filter(path => !referenced.has(path));
        if (!layer.length) throw new Error(`reference cycle among ${[...remaining].join(', ')}`);
        layers.push(layer);
        for (const path of layer) remaining.delete(path);
    }
    return layers;
}
