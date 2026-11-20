const { monthKeyOf, addMonths, estimateNetWorthByMonth, buildNetWorthTrend } = require('../../src/netWorthEstimate.js');

const debt = (id, date, balance) => ({ id: id * 100000 + Number(date.replace(/-/g, '').slice(2)), debtId: id, accountId: null, date, balance, minimumPayment: 0 });
const acct = (id, date, balance) => ({ id: id * 100000 + Number(date.replace(/-/g, '').slice(2)), debtId: null, accountId: id, date, balance, minimumPayment: 0 });

describe('monthKeyOf / addMonths', () => {
    test('slices and rolls over years', () => {
        expect(monthKeyOf('2026-03-15')).toBe('2026-03');
        expect(monthKeyOf(null)).toBe('');
        expect(addMonths('2026-01', -1)).toBe('2025-12');
        expect(addMonths('2026-11', 2)).toBe('2027-01');
        expect(addMonths('2026-05', 0)).toBe('2026-05');
    });
});

describe('estimateNetWorthByMonth', () => {
    test('carries a balance forward through months without an entry', () => {
        const r = estimateNetWorthByMonth([debt(1, '2026-01-10', 1000)], ['2026-01', '2026-02', '2026-03'], 5000);
        expect([...r.keys()]).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(r.get('2026-03')).toEqual({ totalAssets: 5000, totalLiabilities: 1000, netWorth: 4000 });
    });
    test('uses the latest entry on or before the month, ordering by date', () => {
        const entries = [debt(1, '2026-03-20', 400), debt(1, '2026-01-10', 1000), debt(1, '2026-02-01', 700)];
        const r = estimateNetWorthByMonth(entries, ['2026-01', '2026-02', '2026-03', '2026-04'], 0);
        expect(r.get('2026-01').totalLiabilities).toBe(1000);
        expect(r.get('2026-02').totalLiabilities).toBe(700);
        expect(r.get('2026-04').totalLiabilities).toBe(400);
    });
    test('same-day entries order by id (higher id wins)', () => {
        const a = { id: 1, debtId: 1, accountId: null, date: '2026-01-05', balance: 10 };
        const b = { id: 2, debtId: 1, accountId: null, date: '2026-01-05', balance: 20 };
        expect(estimateNetWorthByMonth([b, a], ['2026-01'], 0).get('2026-01').totalLiabilities).toBe(20);
    });
    test('mixes debts (liabilities) and tracked accounts (positive balance = asset)', () => {
        const entries = [debt(1, '2026-01-01', 300), debt(2, '2026-01-01', 200), acct(7, '2026-01-01', 150), acct(8, '2026-01-01', -90)];
        const r = estimateNetWorthByMonth(entries, ['2026-01'], 1000).get('2026-01');
        expect(r).toEqual({ totalAssets: 1150, totalLiabilities: 500, netWorth: 650 });
    });
    test('a later-starting owner only counts from its first entry', () => {
        const entries = [debt(1, '2026-01-01', 300), debt(2, '2026-03-01', 200)];
        const r = estimateNetWorthByMonth(entries, ['2026-02', '2026-03'], 0);
        expect(r.get('2026-02').totalLiabilities).toBe(300);
        expect(r.get('2026-03').totalLiabilities).toBe(500);
    });
    test('months before the first entry get no estimate', () => {
        const r = estimateNetWorthByMonth([debt(1, '2026-03-01', 100)], ['2026-01', '2026-02', '2026-03'], 50);
        expect([...r.keys()]).toEqual(['2026-03']);
    });
    test('entries dated after the month are ignored', () => {
        const r = estimateNetWorthByMonth([debt(1, '2026-05-01', 100)], ['2026-04'], 0);
        expect(r.size).toBe(0);
    });
    test('a history of only non-positive account balances cannot be estimated from', () => {
        expect(estimateNetWorthByMonth([acct(8, '2026-01-01', -90), acct(9, '2026-01-01', 0)], ['2026-01'], 500).size).toBe(0);
    });
    test('an account that later went non-positive no longer contributes its old balance', () => {
        const r = estimateNetWorthByMonth([acct(7, '2026-01-01', 150), acct(7, '2026-02-01', -5), debt(1, '2026-01-01', 10)], ['2026-02'], 0).get('2026-02');
        expect(r).toEqual({ totalAssets: 0, totalLiabilities: 10, netWorth: -10 });
    });
    test('a Savings account (tracked) is a positive asset, never a liability (#307)', () => {
        const r = estimateNetWorthByMonth([acct(5, '2026-01-01', 3000), acct(5, '2026-02-01', 3500)], ['2026-01', '2026-02'], 100);
        expect(r.get('2026-01')).toEqual({ totalAssets: 3100, totalLiabilities: 0, netWorth: 3100 });
        expect(r.get('2026-02')).toEqual({ totalAssets: 3600, totalLiabilities: 0, netWorth: 3600 });
    });
    test('an overdrawn Savings balance adds nothing and is not a liability', () => {
        const r = estimateNetWorthByMonth([debt(1, '2026-01-01', 50), acct(5, '2026-01-01', -200)], ['2026-01'], 0).get('2026-01');
        expect(r).toEqual({ totalAssets: 0, totalLiabilities: 50, netWorth: -50 });
    });
    test('a tracked account adopted later is held flat at its first entry for earlier months', () => {
        const entries = [debt(1, '2026-01-01', 100), acct(5, '2026-03-01', 800)];
        const r = estimateNetWorthByMonth(entries, ['2026-01', '2026-02', '2026-03'], 0);
        expect(r.get('2026-01')).toEqual({ totalAssets: 800, totalLiabilities: 100, netWorth: 700 });
        expect(r.get('2026-03')).toEqual({ totalAssets: 800, totalLiabilities: 100, netWorth: 700 });
    });
    test('first-entry backfill never creates an estimate on its own, nor from a non-positive balance', () => {
        expect(estimateNetWorthByMonth([acct(5, '2026-03-01', 800)], ['2026-01', '2026-02'], 0).size).toBe(0);
        const r = estimateNetWorthByMonth([debt(1, '2026-01-01', 100), acct(5, '2026-03-01', -40)], ['2026-01'], 0).get('2026-01');
        expect(r).toEqual({ totalAssets: 0, totalLiabilities: 100, netWorth: -100 });
    });
    test('empty or non-array history gives no points', () => {
        expect(estimateNetWorthByMonth([], ['2026-01'], 100).size).toBe(0);
        expect(estimateNetWorthByMonth(null, ['2026-01'], 100).size).toBe(0);
        expect(estimateNetWorthByMonth(undefined, ['2026-01'], 100).size).toBe(0);
    });
    test('malformed entries are ignored', () => {
        const bad = [
            null, 'x', 5, {},
            { debtId: 1, accountId: null, date: 'nope', balance: 10 },
            { debtId: 1, accountId: null, date: '2026-01-01', balance: null },
            { debtId: 1, accountId: null, date: '2026-01-01', balance: 'abc' },
            { debtId: 1, accountId: null, date: '2026-01-01', balance: Infinity },
            { debtId: 1, accountId: 2, date: '2026-01-01', balance: 10 },
            { debtId: null, accountId: null, date: '2026-01-01', balance: 10 },
            { debtId: 1, accountId: null, date: '2026-01-01', balance: '' },
        ];
        expect(estimateNetWorthByMonth(bad, ['2026-01'], 100).size).toBe(0);
        const r = estimateNetWorthByMonth([...bad, debt(3, '2026-01-01', 40)], ['2026-01'], 100).get('2026-01');
        expect(r.totalLiabilities).toBe(40);
    });
    test('negative debt balance counts as zero liability; negative baseline as zero', () => {
        const r = estimateNetWorthByMonth([debt(1, '2026-01-01', -50)], ['2026-01'], -10).get('2026-01');
        expect(r).toEqual({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
    });
    test('rounds to cents', () => {
        const r = estimateNetWorthByMonth([debt(1, '2026-01-01', 0.1), debt(2, '2026-01-01', 0.2)], ['2026-01'], 0).get('2026-01');
        expect(r.totalLiabilities).toBe(0.3);
    });
});

describe('buildNetWorthTrend', () => {
    const now = { year: 2026, month: 10 }; // November 2026
    const snap = (date, nw) => ({ date, totalAssets: nw + 100, totalLiabilities: 100, netWorth: nw, incomeReceived: 1, debtPaymentMade: 2 });
    const base = { snapshots: [], entries: [], baselineAssets: 1000, now, horizon: 6, live: null };

    test('snapshot overrides the estimate for the same month', () => {
        const pts = buildNetWorthTrend({ ...base, snapshots: [snap('2026-09-28', 777), snap('2026-11-02', 900)], entries: [debt(1, '2026-08-01', 500)] });
        const sep = pts.find(p => p.monthKey === '2026-09');
        expect(sep.kind).toBe('snapshot');
        expect(sep.netWorth).toBe(777);
        expect(pts.find(p => p.monthKey === '2026-10')).toMatchObject({ kind: 'estimated', netWorth: 500 });
    });
    test('fills gaps and earlier months with estimates, in month order', () => {
        const pts = buildNetWorthTrend({ ...base, snapshots: [snap('2026-10-15', 800)], entries: [debt(1, '2026-08-01', 500)] });
        expect(pts.map(p => `${p.monthKey}:${p.kind}`)).toEqual(['2026-08:estimated', '2026-09:estimated', '2026-10:snapshot']);
    });
    test('no snapshots: estimates for past months and a live current point', () => {
        const live = { totalAssets: 1200, totalLiabilities: 400, netWorth: 800 };
        const pts = buildNetWorthTrend({ ...base, entries: [debt(1, '2026-09-01', 450)], live });
        expect(pts.map(p => `${p.monthKey}:${p.kind}`)).toEqual(['2026-09:estimated', '2026-10:estimated', '2026-11:live']);
        expect(pts[2].netWorth).toBe(800);
    });
    test('no snapshots and no history: just the live point', () => {
        const live = { totalAssets: 10, totalLiabilities: 0, netWorth: 10 };
        const pts = buildNetWorthTrend({ ...base, live });
        expect(pts).toHaveLength(1);
        expect(pts[0]).toMatchObject({ kind: 'live', monthKey: '2026-11', netWorth: 10 });
    });
    test('nothing at all (no live, no history, no snapshots) is empty', () => {
        expect(buildNetWorthTrend(base)).toEqual([]);
    });
    test('history without a live point never invents a current-month estimate', () => {
        const pts = buildNetWorthTrend({ ...base, entries: [debt(1, '2026-10-01', 450)] });
        expect(pts.map(p => p.monthKey)).toEqual(['2026-10']);
    });
    test('future months are never estimated', () => {
        const pts = buildNetWorthTrend({ ...base, snapshots: [snap('2027-02-01', 1)], entries: [debt(1, '2026-01-01', 5)], horizon: 3 });
        expect(pts.filter(p => p.kind === 'estimated').every(p => p.monthKey <= '2026-11')).toBe(true);
    });
    test('real snapshots are kept untouched; malformed snapshots dropped', () => {
        const pts = buildNetWorthTrend({ ...base, snapshots: [snap('2026-10-01', 5), { date: 'bad', netWorth: 1 }, { date: '2026-09-01', netWorth: NaN }, null] });
        expect(pts).toHaveLength(1);
        expect(pts[0]).toMatchObject({ kind: 'snapshot', netWorth: 5, incomeReceived: 1 });
    });
    test('horizon limits total points and real snapshots to the latest N', () => {
        const snaps = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((d, i) => snap(d, i));
        const pts = buildNetWorthTrend({ ...base, snapshots: snaps, horizon: 2 });
        expect(pts.map(p => p.monthKey)).toEqual(['2026-08', '2026-09']);
        const est = buildNetWorthTrend({ ...base, entries: [debt(1, '2025-01-01', 9)], live: { totalAssets: 0, totalLiabilities: 0, netWorth: 0 }, horizon: 4 });
        expect(est).toHaveLength(4);
    });
    test('a server-written auto snapshot is treated like any other snapshot', () => {
        const pts = buildNetWorthTrend({ ...base, snapshots: [{ ...snap('2026-10-01', 42), source: 'auto' }] });
        expect(pts[0]).toMatchObject({ kind: 'snapshot', source: 'auto', netWorth: 42 });
    });
});
