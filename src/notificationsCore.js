// Notification rules (#211): which bill-due and balance alerts are due for a
// user right now. Pure and DOM-free, so the server's notifications job runs
// exactly the projection the browser shows (same contract as projectionCore.js:
// never import ui.js, postgresSync.js, settings.js, storage.js or any other
// DOM/network module from here).
//
// The result is a list of events plus the set of balance "episodes" that are
// currently open. The caller (server/src/jobs/notifications.js) stores events
// with a unique dedupe key, so repeating a check never repeats an alert, and
// resolves stored episodes that are no longer active, so the next dip alerts
// again.

import { buildProjectedAccountTransactions, UNLINKED_KEY } from './projectionCore.js';
import { getEffectiveAmount, isCleared } from './ledgerStateCore.js';
import { dateToISO } from './utils.js';
import { daysUntilPromoEnd } from './promoApr.js';
import { getSinkingAlertState } from './sinkingFundSchedule.js';
import {
    NOTIFY_BILL_DUE, NOTIFY_LOW_BALANCE, NOTIFY_ZERO_BALANCE, NOTIFY_PROJECTED_LOW, NOTIFY_PROMO_ENDING, NOTIFY_SINKING_BEHIND, NOTIFY_NEW_SIGN_IN, PROMO_ALERT_DAYS,
    NOTIFY_DAYS_AHEAD, NOTIFY_DAYS_AHEAD_DEFAULT, NOTIFY_DAYS_AHEAD_MAX,
    NOTIFY_CHANNEL, NOTIFY_CHANNELS, NOTIFY_DELIVERY, NOTIFY_DELIVERIES,
} from './settingsSchema.js';

export const NOTIFICATION_TYPES = ['billDueSoon', 'billDueToday', 'lowBalance', 'zeroBalance', 'projectedLow', 'promoEnding', 'sinkingBehind'];

// Account types whose balance is never alerted on: liabilities (a balance
// there is money owed) and retirement accounts (statement-driven, #245).
export const NON_ALERTABLE_ACCOUNT_TYPES = ['Credit Card', 'Loan', 'Retirement'];

// Three months always covers today + NOTIFY_DAYS_AHEAD_MAX days (Jan 31 + 30
// days is Mar 2).
const PROJECTION_MONTHS = 3;

function settingValue(settings, key) {
    const entry = (Array.isArray(settings) ? settings : []).find(s => s && s.key === key);
    return entry ? entry.value : undefined;
}

// The user's preferences with defaults applied: every type on, 3 days ahead,
// both channels, one email per event. Invalid stored values fall back too.
export function getNotificationPrefs(settings) {
    const flag = key => settingValue(settings, key) !== false;
    const days = settingValue(settings, NOTIFY_DAYS_AHEAD);
    const channel = settingValue(settings, NOTIFY_CHANNEL);
    const delivery = settingValue(settings, NOTIFY_DELIVERY);
    return {
        billDue: flag(NOTIFY_BILL_DUE),
        lowBalance: flag(NOTIFY_LOW_BALANCE),
        zeroBalance: flag(NOTIFY_ZERO_BALANCE),
        projectedLow: flag(NOTIFY_PROJECTED_LOW),
        promoEnding: flag(NOTIFY_PROMO_ENDING),
        sinkingBehind: flag(NOTIFY_SINKING_BEHIND),
        // #683: not an event type; read by the server at sign-in.
        newSignIn: flag(NOTIFY_NEW_SIGN_IN),
        daysAhead: Number.isInteger(days) && days >= 0 && days <= NOTIFY_DAYS_AHEAD_MAX ? days : NOTIFY_DAYS_AHEAD_DEFAULT,
        channel: NOTIFY_CHANNELS.includes(channel) ? channel : 'both',
        delivery: NOTIFY_DELIVERIES.includes(delivery) ? delivery : 'perEvent',
    };
}

// An account the user set to "Don't notify" (muteBalanceAlerts) never raises a
// balance alert either; bill alerts are not affected.
export function isAlertableAccount(account) {
    return Boolean(account) && !account.archived && !account.muteBalanceAlerts
        && !NON_ALERTABLE_ACCOUNT_TYPES.includes(account.type);
}

// The account's alert threshold, or null when none is set.
export function getLowBalanceThreshold(account) {
    const n = Number(account?.lowBalanceThreshold);
    return account?.lowBalanceThreshold !== null && account?.lowBalanceThreshold !== undefined
        && Number.isFinite(n) && n > 0 ? n : null;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

const round2 = n => Math.round(n * 100) / 100;

// Balance today: startingBalance plus this month's override-aware projected
// transactions dated today or earlier (the Accounts breakdown's running
// balance). `txs` is the account's projected list, sorted by date, starting
// at the first of this month.
export function computeBalanceToday(app, account, txs, now) {
    const tomorrow = addDays(startOfDay(now), 1);
    let balance = Number(account?.startingBalance) || 0;
    for (const tx of txs) {
        if (tx.date >= tomorrow) break;
        balance += getEffectiveAmount(app, tx);
    }
    return round2(balance);
}

// The first date after today, through `daysAhead` days, on which the
// projected balance is at or below `threshold`, or below $0 when there is no
// threshold (an account that sits at exactly $0 is normal): { date, balance }
// or null.
export function findProjectedBreach(app, account, txs, now, daysAhead, threshold) {
    const breached = threshold === null || threshold === undefined
        ? b => b < 0
        : b => b <= threshold;
    const tomorrow = addDays(startOfDay(now), 1);
    const windowEnd = addDays(tomorrow, Math.max(0, daysAhead));
    let balance = Number(account?.startingBalance) || 0;
    for (const tx of txs) {
        if (tx.date >= windowEnd) break;
        balance += getEffectiveAmount(app, tx);
        if (tx.date >= tomorrow && breached(round2(balance))) {
            return { date: dateToISO(tx.date), balance: round2(balance) };
        }
    }
    return null;
}

// A "bill" is money going out on a schedule: a debt's minimum payment, a
// legacy bill, or a recurring outflow that is not one leg of a transfer.
export function isBillTransaction(app, tx) {
    if (tx.type === 'debt' || tx.type === 'bill') return true;
    return tx.type === 'recurring' && !tx.isTransferLeg && getEffectiveAmount(app, tx) < 0;
}

// Every alert due at `now`. Returns { events, activeEpisodes }:
//   events: [{ type, dedupeKey, episodeKey, params }]. dedupeKey is unique
//     per alert; episodeKey is set for balance alerts (one open alert per
//     account and type).
//   activeEpisodes: the episode keys whose condition holds right now.
export function computeNotificationEvents(app, now = new Date(), prefs = getNotificationPrefs(app?.settings)) {
    const events = [];
    const activeEpisodes = [];
    const today = startOfDay(now);
    const todayIso = dateToISO(today);
    const daysAhead = prefs.daysAhead;
    const accountMap = buildProjectedAccountTransactions(app, today.getFullYear(), today.getMonth(), PROJECTION_MONTHS);

    if (prefs.billDue) {
        const windowEnd = addDays(today, daysAhead + 1);
        for (const key of Object.keys(accountMap)) {
            const entry = accountMap[key];
            for (const tx of entry.txs) {
                if (tx.date < today || tx.date >= windowEnd) continue;
                if (!tx.transactionId || !isBillTransaction(app, tx)) continue;
                if (isCleared(app, tx.transactionId)) continue;
                const dueIso = dateToISO(tx.date);
                const type = dueIso === todayIso ? 'billDueToday' : 'billDueSoon';
                events.push({
                    type,
                    dedupeKey: `${type}|${tx.transactionId}`,
                    episodeKey: null,
                    params: {
                        name: tx.name,
                        amount: round2(Math.abs(getEffectiveAmount(app, tx))),
                        dueDate: dueIso,
                        daysUntil: Math.round((startOfDay(tx.date) - today) / 86400000),
                        accountId: key === UNLINKED_KEY ? null : entry.id,
                        accountName: key === UNLINKED_KEY ? null : (entry.name || null),
                        sourceType: tx.type,
                        sourceId: tx.sourceId ?? null,
                    },
                });
            }
        }
    }

    for (const account of app.accounts || []) {
        if (!isAlertableAccount(account)) continue;
        const txs = accountMap[account.id]?.txs || [];
        const threshold = getLowBalanceThreshold(account);
        const balance = computeBalanceToday(app, account, txs, now);
        const base = { accountId: account.id, accountName: account.name || null, balance, threshold };
        const balanceEvent = (type, params = base) => {
            const episodeKey = `${type}|${account.id}`;
            activeEpisodes.push(episodeKey);
            events.push({ type, dedupeKey: `${episodeKey}|${todayIso}`, episodeKey, params });
        };

        // 'zeroBalance' means overdrawn: below $0. Many accounts sit at
        // exactly $0 on purpose, so $0 itself never alerts (the type name is
        // kept for stored alerts and the notifyZeroBalance setting).
        const isOverdrawn = balance < 0;
        const isLow = threshold !== null && !isOverdrawn && balance <= threshold;
        if (isOverdrawn && prefs.zeroBalance) balanceEvent('zeroBalance');
        if (isLow && prefs.lowBalance) balanceEvent('lowBalance');

        // Not low today, but projected to reach the threshold (below $0
        // without one) within the window.
        if (prefs.projectedLow && daysAhead > 0 && !isOverdrawn && !isLow) {
            const breach = findProjectedBreach(app, account, txs, now, daysAhead, threshold);
            if (breach) {
                balanceEvent('projectedLow', { ...base, projectedBalance: breach.balance, date: breach.date });
            }
        }
    }

    // #681: a promotional APR ending within PROMO_ALERT_DAYS, once per promo
    // (the end date is in the key, so a new promo alerts again).
    if (prefs.promoEnding) {
        for (const debt of app.debts || []) {
            if (!debt || debt.archived || debt.debtType === 'fixedAmount') continue;
            if (!((Number(debt.accountBalance) || 0) > 0)) continue;
            const days = daysUntilPromoEnd(debt, todayIso);
            if (days === null || days > PROMO_ALERT_DAYS) continue;
            events.push({
                type: 'promoEnding',
                dedupeKey: `promoEnding|${debt.id}|${debt.promoEndDate}`,
                episodeKey: null,
                params: {
                    name: debt.name || null,
                    debtId: debt.id,
                    promoEndDate: debt.promoEndDate,
                    daysUntil: days,
                    promoRate: debt.promoRate,
                    regularRate: Number(debt.interestRate) || 0,
                    balance: round2(Number(debt.accountBalance) || 0),
                    deferredInterest: debt.deferredInterest === true,
                },
            });
        }
    }

    // #701: a target-date sinking fund that fell behind its planned pace (or
    // is past its date). One open episode per fund, date and kind: behind
    // turning into past due is a new alert, a repeat check is not, and the
    // episode resolves when the fund catches up, is funded, archived or
    // deleted, or its date changes (the key no longer matches an active one).
    if (prefs.sinkingBehind) {
        for (const fund of app.sinkingFunds || []) {
            const state = getSinkingAlertState(fund, todayIso);
            if (!state) continue;
            const episodeKey = `sinkingBehind|${fund.id}|${state.targetDate}|${state.kind}`;
            activeEpisodes.push(episodeKey);
            events.push({
                type: 'sinkingBehind',
                dedupeKey: `${episodeKey}|${todayIso}`,
                episodeKey,
                params: {
                    name: fund.name || null,
                    fundId: fund.id,
                    kind: state.kind,
                    targetDate: state.targetDate,
                    targetAmount: round2(state.targetAmount),
                    remaining: round2(state.remaining),
                    required: round2(state.required),
                    planned: round2(state.planned),
                },
            });
        }
    }

    return { events, activeEpisodes };
}
