// Month-normalized recurring cash flow (issue #252), split out of recurring.js
// (#713) so Health's first paint does not pull the whole Recurring page
// module (and, through it, accounts.js, ledger.js and the page renderers).
// Pure: no DOM, no network, no ui.js/postgresSync.js/settings.js imports.

import { isRecurringInflow, dateToISO } from './utils.js';
import { getAmountOn } from './amountSchedule.js';
import { getRecurringOccurrencesInMonth } from './recurringOccurrences.js';

// #678: each occurrence at the amount in effect on its own date.
export function sumOccurrenceAmounts(tmpl, occurrences) {
    return occurrences.reduce((s, d) => s + (Number(getAmountOn(tmpl, dateToISO(d))) || 0), 0);
}

/**
 * Month-normalized recurring cash flow (issue #252) for Health's cash-flow
 * card: every occurrence from getRecurringOccurrencesInMonth (so frequency,
 * pause, archive, skipped months and start/end dates are all honored).
 * Inflows (income + reimbursement) and outflows (subscription) are summed
 * separately; transfers are zero-sum between own accounts and excluded.
 */
export function computeRecurringCashFlowForMonth(app, year, month) {
    let inflow = 0;
    let outflow = 0;
    for (const tmpl of (app?.recurringTemplates || [])) {
        if (tmpl.type === 'transfer') continue;
        const occurrences = getRecurringOccurrencesInMonth(tmpl, year, month);
        if (!occurrences.length) continue;
        const amt = Math.abs(sumOccurrenceAmounts(tmpl, occurrences));
        if (isRecurringInflow(tmpl)) inflow += amt;
        else outflow += amt;
    }
    return { inflow, outflow };
}
