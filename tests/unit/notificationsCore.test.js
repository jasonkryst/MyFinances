// #211: the pure notification rules shared by the server's notifications job.
const {
    NOTIFICATION_TYPES, NON_ALERTABLE_ACCOUNT_TYPES,
    getNotificationPrefs, isAlertableAccount, getLowBalanceThreshold,
    computeBalanceToday, findProjectedBreach, isBillTransaction, computeNotificationEvents,
} = require('../../src/notificationsCore.js');
const { buildProjectedAccountTransactions } = require('../../src/projectionCore.js');
const { sanitizeLowBalanceThreshold } = require('../../src/sanitizers.js');
const { isAllowedSetting } = require('../../src/settingsSchema.js');

// Sunday 15 Nov 2026, noon local time.
const NOW = new Date(2026, 10, 15, 12, 0, 0);
const DEFAULT_PREFS = getNotificationPrefs([]);

function makeApp(overrides = {}) {
    return {
        accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000, lowBalanceThreshold: null }],
        debts: [],
        incomes: [],
        bonuses: [],
        bills: [],
        expenses: [],
        transfers: [],
        manualTransactions: [],
        recurringTemplates: [],
        emergencyFunds: [],
        sinkingFunds: [],
        reconciliations: [],
        settings: [],
        ledgerAmountOverrides: {},
        ledgerClearedTransactions: {},
        ...overrides,
    };
}

const debt = (fields = {}) => ({ id: 10, name: 'Visa', accountId: 1, dueDate: 17, minimumPayment: 50, accountBalance: 900, ...fields });
const events = (app, prefs = DEFAULT_PREFS, now = NOW) => computeNotificationEvents(app, now, prefs).events;
const ofType = (list, type) => list.filter(e => e.type === type);
const txsFor = (app, id) => buildProjectedAccountTransactions(app, 2026, 10, 3)[id].txs;

describe('getNotificationPrefs', () => {
    test('defaults: every type on, 3 days ahead, both channels, one email per alert', () => {
        expect(getNotificationPrefs(undefined)).toEqual({
            billDue: true, lowBalance: true, zeroBalance: true, projectedLow: true,
            daysAhead: 3, channel: 'both', delivery: 'perEvent',
        });
    });

    test('stored values are used', () => {
        const prefs = getNotificationPrefs([
            { key: 'notifyBillDue', value: false },
            { key: 'notifyProjectedLow', value: false },
            { key: 'notifyDaysAhead', value: 0 },
            { key: 'notifyChannel', value: 'inApp' },
            { key: 'notifyDelivery', value: 'digest' },
        ]);
        expect(prefs).toMatchObject({ billDue: false, lowBalance: true, projectedLow: false, daysAhead: 0, channel: 'inApp', delivery: 'digest' });
    });

    test('invalid stored values fall back to the defaults', () => {
        const prefs = getNotificationPrefs([
            { key: 'notifyDaysAhead', value: 31 },
            { key: 'notifyChannel', value: 'sms' },
            { key: 'notifyDelivery', value: 'weekly' },
            { key: 'notifyLowBalance', value: 'no' },
        ]);
        expect(prefs).toMatchObject({ daysAhead: 3, channel: 'both', delivery: 'perEvent', lowBalance: true });
        expect(getNotificationPrefs([{ key: 'notifyDaysAhead', value: 2.5 }]).daysAhead).toBe(3);
        expect(getNotificationPrefs([{ key: 'notifyDaysAhead', value: -1 }]).daysAhead).toBe(3);
    });
});

describe('settings schema accepts only valid notification preferences', () => {
    test.each([
        ['notifyBillDue', true], ['notifyLowBalance', false], ['notifyZeroBalance', true], ['notifyProjectedLow', false],
        ['notifyDaysAhead', 0], ['notifyDaysAhead', 30], ['notifyChannel', 'both'], ['notifyChannel', 'email'],
        ['notifyChannel', 'inApp'], ['notifyDelivery', 'perEvent'], ['notifyDelivery', 'digest'],
    ])('%s = %p is allowed', (key, value) => {
        expect(isAllowedSetting(key, value)).toBe(true);
    });

    test.each([
        ['notifyBillDue', 'true'], ['notifyDaysAhead', 31], ['notifyDaysAhead', -1], ['notifyDaysAhead', 1.5],
        ['notifyChannel', 'sms'], ['notifyDelivery', 'hourly'], ['notifyChannel', null],
    ])('%s = %p is refused', (key, value) => {
        expect(isAllowedSetting(key, value)).toBe(false);
    });
});

describe('accounts', () => {
    test('liabilities, retirement and archived accounts are never alerted on', () => {
        expect(NON_ALERTABLE_ACCOUNT_TYPES).toEqual(['Credit Card', 'Loan', 'Retirement']);
        expect(isAlertableAccount({ type: 'Checking' })).toBe(true);
        expect(isAlertableAccount({ type: 'Savings' })).toBe(true);
        expect(isAlertableAccount({ type: 'Other' })).toBe(true);
        for (const type of NON_ALERTABLE_ACCOUNT_TYPES) expect(isAlertableAccount({ type })).toBe(false);
        expect(isAlertableAccount({ type: 'Checking', archived: true })).toBe(false);
        expect(isAlertableAccount(null)).toBe(false);
    });

    test('getLowBalanceThreshold: a positive amount, else null', () => {
        expect(getLowBalanceThreshold({ lowBalanceThreshold: 250 })).toBe(250);
        expect(getLowBalanceThreshold({ lowBalanceThreshold: '75.5' })).toBe(75.5);
        for (const v of [null, undefined, 0, -5, 'abc', NaN, Infinity]) {
            expect(getLowBalanceThreshold({ lowBalanceThreshold: v })).toBeNull();
        }
        expect(getLowBalanceThreshold(null)).toBeNull();
    });

    test('sanitizeLowBalanceThreshold keeps a positive amount (2 dp) and nulls anything else', () => {
        expect(sanitizeLowBalanceThreshold(100)).toBe(100);
        expect(sanitizeLowBalanceThreshold('49.999')).toBe(50);
        expect(sanitizeLowBalanceThreshold(1e12)).toBe(1e12);
        for (const v of [null, undefined, '', 0, -1, 'x', NaN, Infinity, 1e12 + 1, {}]) {
            expect(sanitizeLowBalanceThreshold(v)).toBeNull();
        }
    });
});

describe('balances', () => {
    test('balance today counts this month\'s transactions dated today or earlier only', () => {
        const app = makeApp({
            debts: [debt({ dueDate: 10, minimumPayment: 100 }), debt({ id: 11, dueDate: 15, minimumPayment: 40 }), debt({ id: 12, dueDate: 16, minimumPayment: 999 })],
        });
        expect(computeBalanceToday(app, app.accounts[0], txsFor(app, 1), NOW)).toBe(860);
    });

    test('an override changes the balance', () => {
        const app = makeApp({
            debts: [debt({ dueDate: 10, minimumPayment: 100 })],
            ledgerAmountOverrides: { 'debt|10|1|2026-11-10': { amount: -300 } },
        });
        expect(computeBalanceToday(app, app.accounts[0], txsFor(app, 1), NOW)).toBe(700);
    });

    test('findProjectedBreach returns the first date at or below the limit inside the window', () => {
        const app = makeApp({ debts: [debt({ dueDate: 17, minimumPayment: 950 })] });
        const txs = txsFor(app, 1);
        expect(findProjectedBreach(app, app.accounts[0], txs, NOW, 3, 100)).toEqual({ date: '2026-11-17', balance: 50 });
        expect(findProjectedBreach(app, app.accounts[0], txs, NOW, 1, 100)).toBeNull();
        expect(findProjectedBreach(app, app.accounts[0], txs, NOW, 3, 10)).toBeNull();
        expect(findProjectedBreach(app, app.accounts[0], txs, NOW, 0, 100)).toBeNull();
    });

    test('findProjectedBreach with no threshold needs a balance below zero, not at zero', () => {
        const toZero = makeApp({ debts: [debt({ dueDate: 17, minimumPayment: 1000 })] });
        expect(findProjectedBreach(toZero, toZero.accounts[0], txsFor(toZero, 1), NOW, 3, null)).toBeNull();
        const below = makeApp({ debts: [debt({ dueDate: 17, minimumPayment: 1000.01 })] });
        expect(findProjectedBreach(below, below.accounts[0], txsFor(below, 1), NOW, 3, null)).toEqual({ date: '2026-11-17', balance: -0.01 });
        expect(findProjectedBreach(toZero, toZero.accounts[0], txsFor(toZero, 1), NOW, 3, 0)).toEqual({ date: '2026-11-17', balance: 0 });
    });
});

describe('bill alerts', () => {
    test('a bill due today and one due within the window; later ones are ignored', () => {
        const app = makeApp({ debts: [debt({ id: 10, dueDate: 15 }), debt({ id: 11, name: 'Car', dueDate: 18 }), debt({ id: 12, dueDate: 19 })] });
        const list = events(app);
        expect(ofType(list, 'billDueToday')).toEqual([{
            type: 'billDueToday',
            dedupeKey: 'billDueToday|debt|10|1|2026-11-15',
            episodeKey: null,
            params: { name: 'Visa', amount: 50, dueDate: '2026-11-15', daysUntil: 0, accountId: 1, accountName: 'Checking', sourceType: 'debt', sourceId: 10 },
        }]);
        const soon = ofType(list, 'billDueSoon');
        expect(soon.map(e => e.params.name)).toEqual(['Car']);
        expect(soon[0]).toMatchObject({ dedupeKey: 'billDueSoon|debt|11|1|2026-11-18', params: { daysUntil: 3, dueDate: '2026-11-18' } });
    });

    test('bills already due earlier this month are not alerted', () => {
        const app = makeApp({ debts: [debt({ dueDate: 14 })] });
        expect(ofType(events(app), 'billDueToday')).toEqual([]);
        expect(ofType(events(app), 'billDueSoon')).toEqual([]);
    });

    test('a Cleared occurrence is not alerted', () => {
        const app = makeApp({
            debts: [debt({ dueDate: 16 })],
            ledgerClearedTransactions: { 'debt|10|1|2026-11-16': { clearedAt: '2026-11-14' } },
        });
        expect(ofType(events(app), 'billDueSoon')).toEqual([]);
    });

    test('the window crosses into next month', () => {
        const now = new Date(2026, 10, 29, 9);
        const app = makeApp({ debts: [debt({ dueDate: 1 })] });
        const soon = ofType(events(app, DEFAULT_PREFS, now), 'billDueSoon');
        expect(soon.map(e => e.params.dueDate)).toEqual(['2026-12-01']);
        expect(soon[0].params.daysUntil).toBe(2);
    });

    test('recurring subscriptions alert; inflows and transfer legs do not', () => {
        const app = makeApp({
            accounts: [
                { id: 1, name: 'Checking', type: 'Checking', startingBalance: 5000 },
                { id: 2, name: 'Savings', type: 'Savings', startingBalance: 5000 },
            ],
            recurringTemplates: [
                { id: 20, name: 'Netflix', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 16, accountId: 1 },
                { id: 21, name: 'Refund', type: 'reimbursement', amount: 30, frequency: 'monthly', dayOfMonth: 16, accountId: 1 },
                { id: 22, name: 'Side gig', type: 'income', amount: 300, frequency: 'monthly', dayOfMonth: 16, accountId: 1 },
                { id: 23, name: 'To savings', type: 'transfer', amount: 100, frequency: 'monthly', dayOfMonth: 16, accountId: 1, targetAccountId: 2 },
                { id: 24, name: 'Archived', type: 'subscription', amount: 9, frequency: 'monthly', dayOfMonth: 16, accountId: 1, archived: true },
            ],
        });
        const soon = ofType(events(app), 'billDueSoon');
        expect(soon.map(e => e.params.name)).toEqual(['Netflix']);
        expect(soon[0].params).toMatchObject({ amount: 15, sourceType: 'recurring', daysUntil: 1 });
    });

    test('a bill with no account is still alerted, with no account name', () => {
        const app = makeApp({ debts: [debt({ accountId: null, dueDate: 15 })] });
        const today = ofType(events(app), 'billDueToday');
        expect(today).toHaveLength(1);
        expect(today[0].params).toMatchObject({ accountId: null, accountName: null });
    });

    test('archived debts and legacy bills: archived skipped, bills alerted', () => {
        const app = makeApp({
            debts: [debt({ archived: true, dueDate: 15 })],
            bills: [{ id: 30, name: 'Rent', amount: 1200, dueDay: 16, accountId: 1 }],
        });
        const list = events(app);
        expect(ofType(list, 'billDueToday')).toEqual([]);
        expect(ofType(list, 'billDueSoon').map(e => e.params.name)).toEqual(['Rent']);
    });

    test('the alert carries the overridden amount', () => {
        const app = makeApp({
            debts: [debt({ dueDate: 16 })],
            ledgerAmountOverrides: { 'debt|10|1|2026-11-16': { amount: -75.5 } },
        });
        expect(ofType(events(app), 'billDueSoon')[0].params.amount).toBe(75.5);
    });

    test('0 days ahead alerts only on the due date; the switch turns bills off', () => {
        const app = makeApp({ debts: [debt({ id: 10, dueDate: 15 }), debt({ id: 11, dueDate: 16 })] });
        const zero = events(app, { ...DEFAULT_PREFS, daysAhead: 0 });
        expect(ofType(zero, 'billDueToday')).toHaveLength(1);
        expect(ofType(zero, 'billDueSoon')).toEqual([]);
        const off = events(app, { ...DEFAULT_PREFS, billDue: false });
        expect(off.filter(e => e.type.startsWith('billDue'))).toEqual([]);
    });

    test('isBillTransaction', () => {
        const app = makeApp();
        expect(isBillTransaction(app, { type: 'debt', originalAmount: -1 })).toBe(true);
        expect(isBillTransaction(app, { type: 'bill', originalAmount: -1 })).toBe(true);
        expect(isBillTransaction(app, { type: 'recurring', originalAmount: -1 })).toBe(true);
        expect(isBillTransaction(app, { type: 'recurring', originalAmount: 5 })).toBe(false);
        expect(isBillTransaction(app, { type: 'recurring', originalAmount: -5, isTransferLeg: true })).toBe(false);
        for (const type of ['income', 'bonus', 'expense', 'transfer', 'manual', 'savings', 'interest']) {
            expect(isBillTransaction(app, { type, originalAmount: -5 })).toBe(false);
        }
    });
});

describe('balance alerts', () => {
    const acct = fields => ({ id: 1, name: 'Checking', type: 'Checking', startingBalance: 1000, lowBalanceThreshold: null, ...fields });

    test('at or below the threshold (and above zero) raises lowBalance with an episode', () => {
        const app = makeApp({ accounts: [acct({ startingBalance: 200, lowBalanceThreshold: 200 })] });
        const { events: list, activeEpisodes } = computeNotificationEvents(app, NOW, DEFAULT_PREFS);
        expect(list).toEqual([{
            type: 'lowBalance',
            dedupeKey: 'lowBalance|1|2026-11-15',
            episodeKey: 'lowBalance|1',
            params: { accountId: 1, accountName: 'Checking', balance: 200, threshold: 200 },
        }]);
        expect(activeEpisodes).toEqual(['lowBalance|1']);
    });

    test('above the threshold: no alert and no open episode', () => {
        const app = makeApp({ accounts: [acct({ startingBalance: 200.01, lowBalanceThreshold: 200 })] });
        expect(computeNotificationEvents(app, NOW, DEFAULT_PREFS)).toEqual({ events: [], activeEpisodes: [] });
    });

    test('below zero (overdrawn) raises zeroBalance only, even with a threshold', () => {
        for (const startingBalance of [-0.01, -25]) {
            const app = makeApp({ accounts: [acct({ startingBalance, lowBalanceThreshold: 100 })] });
            const { events: list, activeEpisodes } = computeNotificationEvents(app, NOW, DEFAULT_PREFS);
            expect(list.map(e => e.type)).toEqual(['zeroBalance']);
            expect(list[0].params.balance).toBe(startingBalance);
            expect(activeEpisodes).toEqual(['zeroBalance|1']);
        }
    });

    test('exactly $0 is not overdrawn: no alert without a threshold', () => {
        const app = makeApp({ accounts: [acct({ startingBalance: 0 })] });
        expect(computeNotificationEvents(app, NOW, DEFAULT_PREFS)).toEqual({ events: [], activeEpisodes: [] });
    });

    test('exactly $0 with a threshold is a lowBalance alert, not zeroBalance', () => {
        const app = makeApp({ accounts: [acct({ startingBalance: 0, lowBalanceThreshold: 100 })] });
        expect(events(app).map(e => e.type)).toEqual(['lowBalance']);
    });

    test('a muted account raises no balance alert of any kind and opens no episode', () => {
        for (const fields of [
            { startingBalance: -50 },
            { startingBalance: 50, lowBalanceThreshold: 100 },
            { startingBalance: 500, lowBalanceThreshold: 100 },
        ]) {
            const app = makeApp({ accounts: [acct({ ...fields, muteBalanceAlerts: true })], debts: [debt({ dueDate: 17, minimumPayment: 450 })] });
            const result = computeNotificationEvents(app, NOW, DEFAULT_PREFS);
            expect(result.events.filter(e => e.type !== 'billDueSoon' && e.type !== 'billDueToday')).toEqual([]);
            expect(result.activeEpisodes).toEqual([]);
        }
    });

    test('muting keeps bill alerts for debts paid from the account', () => {
        const app = makeApp({ accounts: [acct({ startingBalance: -50, muteBalanceAlerts: true })], debts: [debt({ dueDate: 16 })] });
        expect(events(app).map(e => e.type)).toEqual(['billDueSoon']);
    });

    test('isAlertableAccount: muted is not alertable; unmuted (false or missing) is', () => {
        expect(isAlertableAccount({ type: 'Checking', muteBalanceAlerts: true })).toBe(false);
        expect(isAlertableAccount({ type: 'Checking', muteBalanceAlerts: false })).toBe(true);
        expect(isAlertableAccount({ type: 'Checking' })).toBe(true);
    });

    test('no threshold: only zero alerts', () => {
        const app = makeApp({ accounts: [acct({ startingBalance: 5 })] });
        expect(events(app)).toEqual([]);
    });

    test('liability, retirement and archived accounts never alert', () => {
        const app = makeApp({
            accounts: [
                acct({ id: 1, type: 'Credit Card', startingBalance: -500, lowBalanceThreshold: 100 }),
                acct({ id: 2, type: 'Loan', startingBalance: -9000 }),
                acct({ id: 3, type: 'Retirement', startingBalance: 0 }),
                acct({ id: 4, type: 'Checking', startingBalance: -1, archived: true }),
            ],
        });
        expect(computeNotificationEvents(app, NOW, DEFAULT_PREFS)).toEqual({ events: [], activeEpisodes: [] });
    });

    test('switched-off types raise nothing and leave no open episode', () => {
        const low = makeApp({ accounts: [acct({ startingBalance: 50, lowBalanceThreshold: 100 })] });
        expect(computeNotificationEvents(low, NOW, { ...DEFAULT_PREFS, lowBalance: false })).toEqual({ events: [], activeEpisodes: [] });
        const zero = makeApp({ accounts: [acct({ startingBalance: -1 })] });
        expect(computeNotificationEvents(zero, NOW, { ...DEFAULT_PREFS, zeroBalance: false })).toEqual({ events: [], activeEpisodes: [] });
    });

    test('projectedLow: fine today, reaches the threshold within the window', () => {
        const app = makeApp({
            accounts: [acct({ startingBalance: 500, lowBalanceThreshold: 100 })],
            debts: [debt({ dueDate: 17, minimumPayment: 450 })],
        });
        const projected = ofType(events(app), 'projectedLow');
        expect(projected).toEqual([{
            type: 'projectedLow',
            dedupeKey: 'projectedLow|1|2026-11-15',
            episodeKey: 'projectedLow|1',
            params: { accountId: 1, accountName: 'Checking', balance: 500, threshold: 100, projectedBalance: 50, date: '2026-11-17' },
        }]);
    });

    test('projectedLow without a threshold fires only below zero', () => {
        const app = makeApp({ accounts: [acct({ startingBalance: 40 })], debts: [debt({ dueDate: 16, minimumPayment: 50 })] });
        expect(ofType(events(app), 'projectedLow')[0].params).toMatchObject({ threshold: null, projectedBalance: -10, date: '2026-11-16' });
        const toZero = makeApp({ accounts: [acct({ startingBalance: 50 })], debts: [debt({ dueDate: 16, minimumPayment: 50 })] });
        expect(ofType(events(toZero), 'projectedLow')).toEqual([]);
    });

    test('projectedLow: not raised when already low, outside the window, at 0 days or switched off', () => {
        const alreadyLow = makeApp({ accounts: [acct({ startingBalance: 90, lowBalanceThreshold: 100 })], debts: [debt({ dueDate: 17, minimumPayment: 80 })] });
        expect(ofType(events(alreadyLow), 'projectedLow')).toEqual([]);
        const later = makeApp({ accounts: [acct({ startingBalance: 500, lowBalanceThreshold: 100 })], debts: [debt({ dueDate: 25, minimumPayment: 450 })] });
        expect(ofType(events(later), 'projectedLow')).toEqual([]);
        const soon = makeApp({ accounts: [acct({ startingBalance: 500, lowBalanceThreshold: 100 })], debts: [debt({ dueDate: 16, minimumPayment: 450 })] });
        expect(ofType(events(soon, { ...DEFAULT_PREFS, daysAhead: 0 }), 'projectedLow')).toEqual([]);
        expect(ofType(events(soon, { ...DEFAULT_PREFS, projectedLow: false }), 'projectedLow')).toEqual([]);
        expect(ofType(events(soon), 'projectedLow')).toHaveLength(1);
    });

    test('the default prefs come from app.settings', () => {
        const app = makeApp({
            accounts: [acct({ startingBalance: -1 })],
            settings: [{ key: 'notifyZeroBalance', value: false }],
        });
        expect(computeNotificationEvents(app, NOW).events).toEqual([]);
    });

    test('every event type is a known type', () => {
        const app = makeApp({
            accounts: [acct({ id: 1, startingBalance: 50, lowBalanceThreshold: 100 }), acct({ id: 2, startingBalance: -1 }), acct({ id: 3, startingBalance: 500, lowBalanceThreshold: 100 })],
            debts: [debt({ id: 10, accountId: 3, dueDate: 15 }), debt({ id: 11, accountId: 3, dueDate: 17, minimumPayment: 400 })],
        });
        const types = new Set(events(app).map(e => e.type));
        expect([...types].sort()).toEqual([...NOTIFICATION_TYPES].sort());
    });
});
