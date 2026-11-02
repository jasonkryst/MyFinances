jest.mock('../../src/postgresSync.js', () => ({ pgPut: jest.fn() }));

const fs = require('fs');
const path = require('path');
const S = require('../../src/settings.js');
const {
    SETTINGS_EXPORT_SCHEMA, buildSettingsExport, parseSettingsImport, budgetThresholdKey,
    LEDGER_EXPORT_COLUMN_KEYS_COPY, SETTINGS_EXPORT_MAX_BYTES
} = S;

const appWith = (entries) => ({ settings: Object.entries(entries).map(([key, value]) => ({ key, value })) });
const wrap = (settings, extra = {}) => ({ type: 'settings', version: '1.0', preferences: {}, settings, ...extra });

describe('schema coverage', () => {
    test('covers every exported key constant except surplusAccountId', () => {
        const keyConsts = Object.entries(S)
            .filter(([name, v]) => typeof v === 'string' && /^[A-Z_]+$/.test(name)
                && !/_MAX$|_DEFAULT$|^SETTINGS_EXPORT_|_PREF_KEY$/.test(name)
                && name !== 'SURPLUS_ACCOUNT_ID' && name !== 'LEDGER_EXPORT_COLUMNS'
                && !Array.isArray(v))
            .map(([, v]) => v);
        expect(keyConsts.length).toBeGreaterThan(10);
        for (const k of keyConsts) expect(Object.keys(SETTINGS_EXPORT_SCHEMA)).toContain(k);
        expect(SETTINGS_EXPORT_SCHEMA).not.toHaveProperty(S.SURPLUS_ACCOUNT_ID);
        expect(SETTINGS_EXPORT_SCHEMA).toHaveProperty('ledgerExportColumns');
    });

    test('ledger column list copy matches dataExport.js', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../src/dataExport.js'), 'utf8');
        const block = src.match(/LEDGER_EXPORT_COLUMN_LABELS = \{([\s\S]*?)\};/)[1];
        const keys = [...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1]);
        expect(LEDGER_EXPORT_COLUMN_KEYS_COPY).toEqual(keys);
    });
});

describe('buildSettingsExport', () => {
    const good = {
        reconciliationAdjustsBalance: true, showArchivedDebts: false, showArchivedRecurring: true,
        showArchivedAccounts: true, showArchivedSinkingFunds: false, autoNwSnapshot: true,
        surplusWindowDays: 60, surplusCushionPct: 15, retirementWithdrawalRate: 3.5,
        retirementScenarioConservativeDelta: -3, retirementScenarioAggressiveDelta: 4,
        retirementCoastTarget: 1500000, fireMultiplier: 28, healthHousingCostOverride: 1800,
        zeroAmountPolicy: 'warn', ledgerExportColumns: 'date,amount,name',
        [budgetThresholdKey('Groceries', 'healthy')]: 10, [budgetThresholdKey('Groceries', 'warn')]: 18.5,
    };

    test('contains exactly the present schema keys plus preferences', () => {
        const out = buildSettingsExport(appWith(good), { theme: 'dark', locale: 'es', currency: 'EUR' });
        expect(out.type).toBe('settings');
        expect(out.app).toBe('MyFinances');
        expect(out.version).toBe('1.0');
        expect(Number.isNaN(Date.parse(out.exportedAt))).toBe(false);
        expect(out.preferences).toEqual({ theme: 'dark', locale: 'es', currency: 'EUR' });
        expect(out.settings).toEqual(good);
    });

    test('omits unset, excluded, unknown and invalid entries; never emits data arrays', () => {
        const app = appWith({ surplusAccountId: 5, mystery: 1, surplusWindowDays: 9999, showArchivedDebts: true });
        app.debts = [{ id: 1 }]; app.accounts = [{ id: 1 }];
        const out = buildSettingsExport(app, { theme: 'neon', locale: 'xx', currency: 'ZZZ' });
        expect(out.settings).toEqual({ showArchivedDebts: true });
        expect(out.preferences).toEqual({});
        expect(out).not.toHaveProperty('debts');
        expect(out).not.toHaveProperty('accounts');
    });

    test('round-trips every key type through parse', () => {
        const out = buildSettingsExport(appWith(good), { theme: 'high-contrast', locale: 'pl', currency: 'PLN' });
        const parsed = parseSettingsImport(JSON.stringify(out));
        expect(parsed.ok).toBe(true);
        expect(parsed.skipped).toEqual([]);
        expect(parsed.settings).toEqual(good);
        expect(parsed.preferences).toEqual({ theme: 'high-contrast', locale: 'pl', currency: 'PLN' });
    });
});

describe('parseSettingsImport rejections', () => {
    test('full data export gets the specific error', () => {
        const r = parseSettingsImport(JSON.stringify({ version: '3.0', debts: [], accounts: [] }));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/full data export/i);
        expect(r.error).toMatch(/Backup & Restore/);
    });
    test('wrong type', () => {
        const r = parseSettingsImport(JSON.stringify({ type: 'other', version: '1.0' }));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/not a MyFinances settings file/i);
    });
    test.each([null, [], 5, 'x'])('non-object %p', (v) => {
        expect(parseSettingsImport(JSON.stringify(v)).ok).toBe(false);
    });
    test('unsupported major version', () => {
        const r = parseSettingsImport(JSON.stringify({ type: 'settings', version: '2.0', settings: {} }));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/version/i);
    });
    test('missing version', () => {
        expect(parseSettingsImport(JSON.stringify({ type: 'settings', settings: {} })).ok).toBe(false);
    });
    test('malformed JSON', () => {
        const r = parseSettingsImport('{not json');
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/not valid JSON/i);
    });
    test('oversized input is rejected before parsing', () => {
        const big = JSON.stringify(wrap({ pad: 'x'.repeat(SETTINGS_EXPORT_MAX_BYTES) }));
        const r = parseSettingsImport(big);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/too large/i);
    });
});

describe('parseSettingsImport skipping', () => {
    const parse = (settings, extra) => parseSettingsImport(JSON.stringify(wrap(settings, extra)));
    const skippedKeys = r => r.skipped.map(s => s.key);

    test('unknown key skipped and reported', () => {
        const r = parse({ mystery: 1, showArchivedDebts: true });
        expect(r.settings).toEqual({ showArchivedDebts: true });
        expect(skippedKeys(r)).toEqual(['mystery']);
    });
    test.each([
        ['surplusWindowDays', 6], ['surplusWindowDays', 366], ['surplusWindowDays', 30.5],
        ['surplusCushionPct', 101], ['retirementWithdrawalRate', 1], ['retirementWithdrawalRate', 9],
        ['retirementScenarioConservativeDelta', 1], ['retirementScenarioAggressiveDelta', -1],
        ['retirementCoastTarget', -1], ['retirementCoastTarget', 1e13],
        ['fireMultiplier', 0], ['fireMultiplier', 1001], ['healthHousingCostOverride', -5],
        ['bct:food:healthy', 101], ['bct:food:warn', -1],
        ['surplusWindowDays', Infinity], ['surplusWindowDays', NaN],
    ])('out-of-range %s=%p skipped', (key, value) => {
        // Infinity/NaN serialise to null in JSON, still invalid.
        const r = parse({ [key]: value });
        expect(r.settings).toEqual({});
        expect(skippedKeys(r)).toEqual([key]);
    });
    test.each([
        ['showArchivedDebts', 'true'], ['autoNwSnapshot', 1], ['surplusWindowDays', '30'],
        ['zeroAmountPolicy', 5], ['bct:food:healthy', '10'],
    ])('wrong type %s=%p skipped', (key, value) => {
        const r = parse({ [key]: value });
        expect(r.settings).toEqual({});
        expect(skippedKeys(r)).toEqual([key]);
    });
    test('invalid enum value skipped', () => {
        const r = parse({ zeroAmountPolicy: 'maybe' });
        expect(r.settings).toEqual({});
        expect(skippedKeys(r)).toEqual(['zeroAmountPolicy']);
    });
    test.each([
        [{ theme: 'neon' }], [{ locale: 'fr' }], [{ currency: 'XXX' }], [{ theme: 5 }], [{ bogus: 'x' }],
    ])('invalid preference %p skipped', (prefs) => {
        const r = parseSettingsImport(JSON.stringify(wrap({}, { preferences: prefs })));
        expect(r.ok).toBe(true);
        expect(r.preferences).toEqual({});
        expect(r.skipped).toHaveLength(1);
    });
    test('valid preferences are accepted', () => {
        const r = parseSettingsImport(JSON.stringify(wrap({}, { preferences: { theme: 'dark', locale: 'es', currency: 'GBP' } })));
        expect(r.preferences).toEqual({ theme: 'dark', locale: 'es', currency: 'GBP' });
    });
    test('__proto__, constructor and prototype keys are never applied', () => {
        const text = '{"type":"settings","version":"1.0","preferences":{"__proto__":{"theme":"dark"}},'
            + '"settings":{"__proto__":{"polluted":true},"constructor":1,"prototype":2,"bct:__proto__:healthy":5}}';
        const r = parseSettingsImport(text);
        expect(r.ok).toBe(true);
        expect(r.settings).toEqual({});
        expect(r.preferences).toEqual({});
        expect({}.polluted).toBeUndefined();
        expect(skippedKeys(r)).toEqual(expect.arrayContaining(['__proto__', 'constructor', 'prototype']));
    });
    test('surplusAccountId is never imported', () => {
        const r = parse({ surplusAccountId: 3 });
        expect(r.settings).toEqual({});
        expect(skippedKeys(r)).toEqual(['surplusAccountId']);
    });
    test('storage backend is never imported', () => {
        const r = parseSettingsImport(JSON.stringify(wrap({ debtTrackerStorageBackend: 'postgres', storageBackend: 'postgres' },
            { preferences: { storageBackend: 'postgres' } })));
        expect(r.settings).toEqual({});
        expect(r.preferences).toEqual({});
        expect(r.skipped).toHaveLength(3);
    });
    test.each(['date,bogus', '', 'date,,amount', 5, 'Date'])('invalid ledgerExportColumns %p skipped', (v) => {
        const r = parse({ ledgerExportColumns: v });
        expect(r.settings).toEqual({});
        expect(skippedKeys(r)).toEqual(['ledgerExportColumns']);
    });
    test('over-long bct category is skipped', () => {
        const r = parse({ ['bct:' + 'a'.repeat(61) + ':warn']: 10 });
        expect(r.settings).toEqual({});
        expect(r.skipped).toHaveLength(1);
    });
    test('HTML in key or value is only ever data (never altered, never applied)', () => {
        const r = parse({ '<img src=x onerror=alert(1)>': 1, zeroAmountPolicy: '<script>' });
        expect(r.settings).toEqual({});
        expect(r.skipped).toHaveLength(2);
    });
});
