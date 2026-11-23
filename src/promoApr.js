// Promotional APR helpers (#681). Pure, import-free and DOM-free, so the
// server's notifications job can import it by relative path. The payoff
// engine (debtCalculator.js, a classic script) carries its own copy of the
// "has a promo" rule and the per-day split; keep the two in step.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A promo needs a rate from 0 to 100 and a YYYY-MM-DD end date.
export function hasPromo(debt) {
    const rate = debt?.promoRate;
    return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 100
        && typeof debt.promoEndDate === 'string' && ISO_DATE.test(debt.promoEndDate);
}

// The promo applies through its end date (inclusive).
export function isPromoActive(debt, iso) {
    return hasPromo(debt) && typeof iso === 'string' && iso <= debt.promoEndDate;
}

// The APR in effect on `iso` (YYYY-MM-DD).
export function getDebtRateOn(debt, iso) {
    return isPromoActive(debt, iso) ? debt.promoRate : (Number(debt?.interestRate) || 0);
}

function dayNumber(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
}

// Whole days from `iso` to the promo end (0 on the end date), or null
// without an active promo.
export function daysUntilPromoEnd(debt, iso) {
    if (!isPromoActive(debt, iso)) return null;
    return dayNumber(debt.promoEndDate) - dayNumber(iso);
}

// Monthly payments left before the promo ends, counting from `iso`'s month:
// at least 1 while the promo is active, null otherwise.
export function promoPaymentsLeft(debt, iso) {
    if (!isPromoActive(debt, iso)) return null;
    const [ey, em] = debt.promoEndDate.split('-').map(Number);
    const [fy, fm] = iso.split('-').map(Number);
    return Math.max(1, (ey * 12 + em) - (fy * 12 + fm));
}

// The level monthly payment that clears `balance` in `months` payments at
// `ratePct` APR (monthly compounding), rounded up to the cent. 0 for no
// balance; null for an invalid month count.
export function payoffPayment(balance, ratePct, months) {
    if (!Number.isInteger(months) || months < 1) return null;
    const b = Number(balance) || 0;
    if (b <= 0) return 0;
    const r = (Number(ratePct) || 0) / 100 / 12;
    const raw = r === 0 ? b / months : b * r / (1 - Math.pow(1 + r, -months));
    return Math.ceil(raw * 100 - 1e-9) / 100;
}

// What the debt card's hint needs: the payment that clears the current
// balance before the promo ends, or null when it doesn't apply (no active
// promo, no balance, a fixed-amount debt).
export function promoPayoffHint(debt, iso) {
    if (!debt || debt.debtType === 'fixedAmount') return null;
    const months = promoPaymentsLeft(debt, iso);
    if (months === null) return null;
    const balance = Number(debt.accountBalance) || 0;
    if (balance <= 0) return null;
    return { months, payment: payoffPayment(balance, debt.promoRate, months) };
}
