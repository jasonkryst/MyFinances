// #211: one alert, or a digest of several. English only: the server has no
// locale preference (the in-app list is translated in the browser), and
// amounts carry no currency symbol because currency is a device preference.
import { escapeHtml } from '../../sanitizers/index.js';

const amountFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function formatAmount(n) {
    const v = Number(n);
    return Number.isFinite(v) ? amountFmt.format(v) : '';
}

export function formatIsoDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

function formatIsoMonth(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    return monthFmt.format(new Date(`${iso}T00:00:00Z`));
}

// One line of English describing an alert.
export function describeNotification(type, params = {}) {
    const p = params || {};
    const name = p.name || 'A bill';
    const account = p.accountName || 'An account';
    const from = p.accountName ? ` from ${p.accountName}` : '';
    switch (type) {
    case 'billDueToday':
        return `${name} (${formatAmount(p.amount)}) is due today${from}.`;
    case 'billDueSoon': {
        const days = Number(p.daysUntil);
        const when = days === 1 ? 'tomorrow' : `in ${days} days`;
        return `${name} (${formatAmount(p.amount)}) is due ${when}, on ${formatIsoDate(p.dueDate)}${from}.`;
    }
    case 'lowBalance':
        return `${account} is at ${formatAmount(p.balance)}, at or below your alert amount of ${formatAmount(p.threshold)}.`;
    case 'zeroBalance':
        return `${account} is overdrawn at ${formatAmount(p.balance)}.`;
    case 'projectedLow':
        return p.threshold
            ? `${account} is projected to drop to ${formatAmount(p.projectedBalance)} on ${formatIsoDate(p.date)}, at or below your alert amount of ${formatAmount(p.threshold)}.`
            : `${account} is projected to go below zero (${formatAmount(p.projectedBalance)}) on ${formatIsoDate(p.date)}.`;
    case 'promoEnding': {
        const debt = p.name || 'A debt';
        const rate = `${Number(p.regularRate) || 0}%`;
        const tail = p.deferredInterest
            ? ' Deferred interest is charged back if a balance remains.'
            : '';
        return `The promotional rate on ${debt} ends on ${formatIsoDate(p.promoEndDate)}, then ${rate} APR applies to the ${formatAmount(p.balance)} balance.${tail}`;
    }
    case 'sinkingBehind': {
        const fund = p.name || 'A sinking fund';
        if (p.kind === 'pastDue') {
            return `${fund} passed its target date (${formatIsoDate(p.targetDate)}) with ${formatAmount(p.remaining)} still to save.`;
        }
        return `${fund} is behind: ${formatAmount(p.required)}/mo now needed (planned ${formatAmount(p.planned)}) to reach ${formatAmount(p.targetAmount)} by ${formatIsoMonth(p.targetDate)}.`;
    }
    default:
        return 'You have a new MyFinances alert.';
    }
}

const SUBJECTS = {
    billDueToday: 'Bill due today',
    billDueSoon: 'Upcoming bill',
    lowBalance: 'Low balance',
    zeroBalance: 'Account overdrawn',
    projectedLow: 'Balance projected to run low',
    promoEnding: 'Promotional rate ending',
    sinkingBehind: 'Sinking fund behind',
};

export default function notificationEmail({ items = [] } = {}) {
    const list = Array.isArray(items) ? items : [];
    const lines = list.map(i => describeNotification(i?.type, i?.params));
    const subject = list.length === 1
        ? `MyFinances: ${SUBJECTS[list[0]?.type] || 'Alert'}`
        : `MyFinances: ${list.length} alerts`;
    const footer = 'You can change which alerts you get in Settings > Notifications.';
    const html = list.length === 1
        ? `<p>${escapeHtml(lines[0])}</p><p style="color:#64748b;font-size:12px;">${escapeHtml(footer)}</p>`
        : `<ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul><p style="color:#64748b;font-size:12px;">${escapeHtml(footer)}</p>`;
    const text = list.length === 1
        ? `${lines[0]}\n\n${footer}`
        : `${lines.map(l => `- ${l}`).join('\n')}\n\n${footer}`;
    return { subject, html, text };
}
