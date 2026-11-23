// #681: the pure promotional-APR helpers shared by the app and the server.
const {
    hasPromo, isPromoActive, getDebtRateOn, daysUntilPromoEnd,
    promoPaymentsLeft, payoffPayment, promoPayoffHint,
} = require('../../src/promoApr.js');

const card = (fields = {}) => ({ interestRate: 24.99, promoRate: 0, promoEndDate: '2027-06-30', accountBalance: 1200, ...fields });

describe('hasPromo', () => {
    test('needs a 0-100 rate and a YYYY-MM-DD end date', () => {
        expect(hasPromo(card())).toBe(true);
        expect(hasPromo(card({ promoRate: 100 }))).toBe(true);
        expect(hasPromo(card({ promoRate: 2.9 }))).toBe(true);
        expect(hasPromo(card({ promoRate: -0.01 }))).toBe(false);
        expect(hasPromo(card({ promoRate: 100.01 }))).toBe(false);
        expect(hasPromo(card({ promoRate: null }))).toBe(false);
        expect(hasPromo(card({ promoRate: '0' }))).toBe(false);
        expect(hasPromo(card({ promoRate: NaN }))).toBe(false);
        expect(hasPromo(card({ promoRate: Infinity }))).toBe(false);
        expect(hasPromo(card({ promoEndDate: null }))).toBe(false);
        expect(hasPromo(card({ promoEndDate: '2027-6-30' }))).toBe(false);
        expect(hasPromo(card({ promoEndDate: 'x2027-06-30' }))).toBe(false);
        expect(hasPromo(card({ promoEndDate: '2027-06-30x' }))).toBe(false);
        expect(hasPromo(null)).toBe(false);
        expect(hasPromo(undefined)).toBe(false);
    });
});

describe('isPromoActive / getDebtRateOn', () => {
    test('the promo rate applies through the end date, inclusive', () => {
        expect(isPromoActive(card(), '2027-06-29')).toBe(true);
        expect(isPromoActive(card(), '2027-06-30')).toBe(true);
        expect(isPromoActive(card(), '2027-07-01')).toBe(false);
        expect(getDebtRateOn(card(), '2027-06-30')).toBe(0);
        expect(getDebtRateOn(card(), '2027-07-01')).toBe(24.99);
    });

    test('without a promo or a usable date, the regular rate', () => {
        expect(isPromoActive(card(), null)).toBe(false);
        expect(isPromoActive(card({ promoRate: null }), '2026-01-01')).toBe(false);
        expect(getDebtRateOn(card({ promoRate: null }), '2026-01-01')).toBe(24.99);
        expect(getDebtRateOn({}, '2026-01-01')).toBe(0);
        expect(getDebtRateOn({ interestRate: '7.5' }, '2026-01-01')).toBe(7.5);
        expect(getDebtRateOn(null, '2026-01-01')).toBe(0);
    });
});

describe('daysUntilPromoEnd', () => {
    test('whole days to the end date, across month and year ends', () => {
        expect(daysUntilPromoEnd(card(), '2027-06-30')).toBe(0);
        expect(daysUntilPromoEnd(card(), '2027-06-29')).toBe(1);
        expect(daysUntilPromoEnd(card(), '2027-05-31')).toBe(30);
        expect(daysUntilPromoEnd(card({ promoEndDate: '2027-01-14' }), '2026-11-15')).toBe(60);
        expect(daysUntilPromoEnd(card({ promoEndDate: '2028-03-01' }), '2028-02-28')).toBe(2);
    });

    test('null once ended or without a promo', () => {
        expect(daysUntilPromoEnd(card(), '2027-07-01')).toBeNull();
        expect(daysUntilPromoEnd(card({ promoEndDate: null }), '2027-01-01')).toBeNull();
    });
});

describe('promoPaymentsLeft', () => {
    test('monthly payments from this month to the end month, at least 1', () => {
        expect(promoPaymentsLeft(card(), '2026-11-23')).toBe(7);
        expect(promoPaymentsLeft(card(), '2026-12-01')).toBe(6);
        expect(promoPaymentsLeft(card(), '2027-05-31')).toBe(1);
        expect(promoPaymentsLeft(card(), '2027-06-30')).toBe(1);
        expect(promoPaymentsLeft(card(), '2027-06-01')).toBe(1);
        expect(promoPaymentsLeft(card({ promoEndDate: '2028-01-15' }), '2027-01-15')).toBe(12);
    });

    test('null once ended', () => {
        expect(promoPaymentsLeft(card(), '2027-07-01')).toBeNull();
    });
});

describe('payoffPayment', () => {
    test('0% splits the balance evenly, rounded up to the cent', () => {
        expect(payoffPayment(1200, 0, 7)).toBe(171.43);
        expect(payoffPayment(1200, 0, 12)).toBe(100);
        expect(payoffPayment('600', null, 3)).toBe(200);
    });

    test('a non-zero rate amortizes monthly', () => {
        // 1000 at 12% over 12 months: the standard 88.85 payment.
        expect(payoffPayment(1000, 12, 12)).toBe(88.85);
        expect(payoffPayment(1000, 12, 1)).toBe(1010);
    });

    test('no balance is 0; an invalid month count is null', () => {
        expect(payoffPayment(0, 0, 5)).toBe(0);
        expect(payoffPayment(-5, 0, 5)).toBe(0);
        expect(payoffPayment(undefined, 0, 5)).toBe(0);
        expect(payoffPayment(100, 0, 0)).toBeNull();
        expect(payoffPayment(100, 0, 1.5)).toBeNull();
        expect(payoffPayment(100, 0, null)).toBeNull();
    });
});

describe('promoPayoffHint', () => {
    test('the months left and the payment that clears the balance', () => {
        expect(promoPayoffHint(card(), '2026-11-23')).toEqual({ months: 7, payment: 171.43 });
        expect(promoPayoffHint(card({ promoRate: 12, accountBalance: 1000, promoEndDate: '2027-11-30' }), '2026-11-01'))
            .toEqual({ months: 12, payment: 88.85 });
    });

    test('null when it does not apply', () => {
        expect(promoPayoffHint(card(), '2027-07-01')).toBeNull();
        expect(promoPayoffHint(card({ accountBalance: 0 }), '2026-11-23')).toBeNull();
        expect(promoPayoffHint(card({ accountBalance: undefined }), '2026-11-23')).toBeNull();
        expect(promoPayoffHint(card({ debtType: 'fixedAmount' }), '2026-11-23')).toBeNull();
        expect(promoPayoffHint(null, '2026-11-23')).toBeNull();
    });
});
