// #678: the downloadable calendar (.ics) describes each event with the amount
// in effect on its date, like the server's webcal feed.
jest.mock('../../src/postgresSync.js', () => ({
    pgPut: jest.fn(() => Promise.resolve(true)),
    pgPatch: jest.fn(() => Promise.resolve(true)),
    pgDelete: jest.fn(() => Promise.resolve(true)),
    pgPost: jest.fn(() => Promise.resolve(true)),
    pgCreate: jest.fn(() => Promise.resolve(null))
}));
jest.mock('../../src/ui.js', () => ({ showAlertModal: jest.fn(), confirmZeroAmountAllowed: jest.fn(), showDeleteConfirmModal: jest.fn() }));
jest.mock('../../src/storage.js', () => ({ getCsrfCookie: jest.fn(() => '') }));

global.window = { location: { origin: 'http://localhost' } };

const { generateIcs } = require('../../src/calendarFeed.js');

function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function eventDescription(ics, uidPrefix) {
    const unfolded = ics.replace(/\r\n[ \t]/g, '');
    const block = unfolded.split('BEGIN:VEVENT').find(b => b.includes(`UID:${uidPrefix}`));
    expect(block).toBeDefined();
    return block.match(/DESCRIPTION:([^\r\n]*)/)[1];
}

test('recurring and payday events use the amount in effect on their date', () => {
    const now = new Date();
    const thisMonth5 = new Date(now.getFullYear(), now.getMonth(), 5);
    const nextMonth1 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth5 = new Date(now.getFullYear(), now.getMonth() + 1, 5);
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const app = {
        accounts: [{ id: 1, name: 'Checking' }],
        bills: [], debts: [], expenses: [], settings: [],
        recurringTemplates: [{
            id: 7, name: 'Netflix', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 5,
            category: 'Subscriptions', accountId: 1, startDate: iso(start), skippedMonths: [], paidMonths: [],
            amountChanges: [{ from: iso(nextMonth1), amount: 18 }]
        }],
        incomes: [{
            id: 3, name: 'Pay', amount: 1000, frequency: 'monthly', firstPayDate: iso(new Date(start.getFullYear(), start.getMonth(), 5)),
            accountId: 1, amountChanges: [{ from: iso(nextMonth1), amount: 1200 }]
        }]
    };
    const ics = generateIcs(app);
    const ymd = d => iso(d).replace(/-/g, '');
    expect(eventDescription(ics, `recurring-7-${ymd(thisMonth5)}`)).toMatch(/Amount Due: \$15\.00/);
    expect(eventDescription(ics, `recurring-7-${ymd(nextMonth5)}`)).toMatch(/Amount Due: \$18\.00/);
    expect(eventDescription(ics, `income-3-${ymd(thisMonth5)}`)).toMatch(/Amount: \$1000\.00/);
    expect(eventDescription(ics, `income-3-${ymd(nextMonth5)}`)).toMatch(/Amount: \$1200\.00/);
});
