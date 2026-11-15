// Ledger projection core (#579): builds every account's projected
// transactions for a window of months, and the per-month list and balance
// derived from it. Pure and DOM-free, so the browser and the server (the
// monthly net-worth snapshot job) run exactly the same code.
// ledgerTransactions.js and accounts.js re-export these, so existing imports
// keep working. Every import here must stay import-safe in Node: no ui.js,
// postgresSync.js, settings.js or other DOM/network module.

import { getIncomePaydaysInMonth, dateToISO, computeNetIncomeAmount, isRecurringInflow, getBonusDatesInMonth } from './utils.js';
import { t } from './i18n.js';
import { getDebtDueDateInMonth } from './weekendRule.js';
import { getRecurringOccurrencesInMonth } from './recurringOccurrences.js';
import { getOverrideAmount, getEffectiveAmount, isCleared, getClearedAt } from './ledgerStateCore.js';
import { getCachedProjection } from './projectionCache.js';

export function makeLedgerTransactionId(tx) {
    const dateKey = dateToISO(new Date(tx.date));
    const account = String(tx.accountId ?? '');
    const type = String(tx.type ?? 'other');
    const source = String(tx.sourceId ?? 'none');
    return `${type}|${source}|${account}|${dateKey}`;
}

// Sentinel key for transactions that have no account linked.
// These appear in report-wide queries (accountId = null) but are excluded
// from the per-account ledger view and per-account balance calculations.
export const UNLINKED_KEY = '__unlinked__';

// Number of real (uncached) projection builds since load. Read by tests to
// prove a render builds once instead of once per account (#518).
let projectionBuildCount = 0;
export function getProjectionBuildCount() {
    return projectionBuildCount;
}

// Inside a withProjectionCache() scope (projectionCache.js) the same window is
// built once and shared; callers must treat the returned map as read-only.
export function buildProjectedAccountTransactions(app, startYear, startMonth, monthsToProject = 12) {
    return getCachedProjection(app, `${startYear}|${startMonth}|${monthsToProject}`,
        () => buildProjectionUncached(app, startYear, startMonth, monthsToProject));
}

function buildProjectionUncached(app, startYear, startMonth, monthsToProject) {
    projectionBuildCount++;
    const accountMap = {};
    for (const acct of app.accounts || []) {
        accountMap[acct.id] = { ...acct, txs: [] };
    }
    accountMap[UNLINKED_KEY] = { id: UNLINKED_KEY, name: null, txs: [] };

    // Running balances used to compute monthly interest deposits (#30).
    // Seeded from startingBalance and carried across the projected window so
    // interest compounds month over month.
    const interestBalances = {};
    for (const acct of app.accounts || []) {
        interestBalances[acct.id] = Number(acct.startingBalance) || 0;
    }

    function addTx({ accountId, date, name, amount, type, sourceId, category, isTransferLeg, counterpartAccountId }) {
        const key = accountId && accountMap[accountId] ? accountId : UNLINKED_KEY;
        const txDate = new Date(date);
        const tx = {
            date: txDate,
            name,
            originalAmount: Number(amount),
            type,
            sourceId,
            category
        };
        if (isTransferLeg) tx.isTransferLeg = true;
        if (counterpartAccountId !== undefined && counterpartAccountId !== null) tx.counterpartAccountId = counterpartAccountId;
        tx.transactionId = makeLedgerTransactionId({
            accountId: key,
            date: txDate,
            type,
            sourceId
        });
        accountMap[key].txs.push(tx);
    }

    for (let m = 0; m < monthsToProject; m++) {
        const year = startYear + Math.floor((startMonth + m) / 12);
        const month = (startMonth + m) % 12;

        // Snapshot per-account tx counts so "this month's transactions" is
        // defined by generation pass, not by date — a bill with dueDay 31
        // generated for February date-overflows into March but still belongs
        // to February's balance.
        const monthStartTxCounts = {};
        for (const acctId in accountMap) {
            monthStartTxCounts[acctId] = accountMap[acctId].txs.length;
        }

        for (const inc of app.incomes || []) {
            if (!inc.amount) continue;
            const paydays = getIncomePaydaysInMonth(inc, year, month);
            for (const payDate of paydays) {
                addTx({
                    accountId: inc.accountId,
                    date: payDate,
                    name: inc.name || t('ledger.txIncome'),
                    // #251: posted/projected amount is net of withholding —
                    // a 0% (or unset) withholdingPercent leaves this equal
                    // to the raw gross amount, same as before.
                    amount: computeNetIncomeAmount(inc),
                    type: 'income',
                    sourceId: inc.id,
                    category: inc.category || 'Income'
                });
            }
        }

        for (const bonus of app.bonuses || []) {
            if (!bonus.date || !bonus.amount) continue;
            // One leg per occurrence (#290); each year's key embeds its own date.
            for (const bonusDate of getBonusDatesInMonth(bonus, year, month)) {
                addTx({
                    accountId: bonus.accountId,
                    date: bonusDate,
                    name: bonus.name || t('ledger.txBonus'),
                    amount: Number(bonus.amount),
                    type: 'bonus',
                    sourceId: bonus.id,
                    category: bonus.category || 'Bonus'
                });
            }
        }

        for (const debt of (app.debts || []).filter(d => !d.archived)) {
            if (debt.dueDate && debt.minimumPayment) {
                const due = getDebtDueDateInMonth(debt, year, month);
                addTx({
                    accountId: debt.accountId,
                    date: due,
                    name: debt.name || t('ledger.txDebtPayment'),
                    amount: -Math.abs(Number(debt.minimumPayment)),
                    type: 'debt',
                    sourceId: debt.id,
                    category: debt.name || 'Debt'
                });
            }
        }

        for (const bill of app.bills || []) {
            if (bill.dueDay && bill.amount) {
                const due = new Date(year, month, bill.dueDay);
                addTx({
                    accountId: bill.accountId,
                    date: due,
                    name: bill.name || t('ledger.txBill'),
                    amount: -Math.abs(Number(bill.amount)),
                    type: 'bill',
                    sourceId: bill.id,
                    category: bill.category || 'Other'
                });
            }
        }

        for (const exp of app.expenses || []) {
            if (exp.budgetAmount && exp.date) {
                const expDate = new Date(String(exp.date).includes('T') ? exp.date : exp.date + 'T00:00:00');
                if (expDate.getFullYear() === year && expDate.getMonth() === month) {
                    addTx({
                        accountId: exp.accountId,
                        date: expDate,
                        name: exp.name || t('ledger.txExpense'),
                        amount: -Math.abs(Number(exp.budgetAmount)),
                        type: 'expense',
                        sourceId: exp.id,
                        category: exp.category || 'Other'
                    });
                }
            }
        }

        // One-off transfers (issue #248) -- a dated pair of opposite-signed
        // legs, same shape as the recurring-template transfer type below but
        // for a single exact date rather than a recurring schedule. Reusing
        // addTx() for both legs is what makes computeAccountBalance() and
        // every Reports/Forecast consumer correct for transfers automatically:
        // they already just sum whatever this generator produces per account.
        for (const xfer of app.transfers || []) {
            if (!xfer.date) continue;
            const tDate = new Date(String(xfer.date).includes('T') ? xfer.date : xfer.date + 'T00:00:00');
            if (tDate.getFullYear() !== year || tDate.getMonth() !== month) continue;
            const toAcct = (app.accounts || []).find(a => a.id === xfer.toAccountId);
            const fromAcct = (app.accounts || []).find(a => a.id === xfer.fromAccountId);
            addTx({
                accountId: xfer.fromAccountId,
                date: tDate,
                name: t('ledger.txTransferTo', { name: toAcct?.name || t('ledger.txAccountFallback') }),
                amount: -Math.abs(Number(xfer.amount)),
                type: 'transfer',
                sourceId: xfer.id,
                category: 'Transfer',
                counterpartAccountId: xfer.toAccountId
            });
            addTx({
                accountId: xfer.toAccountId,
                date: tDate,
                name: t('ledger.txTransferFrom', { name: fromAcct?.name || t('ledger.txAccountFallback') }),
                amount: Math.abs(Number(xfer.amount)),
                type: 'transfer',
                sourceId: xfer.id,
                category: 'Transfer',
                counterpartAccountId: xfer.fromAccountId
            });
        }

        // Manual one-off transactions (#584): actuals entered in the Ledger.
        // One signed leg on the record's own date, so balances, Reports and
        // Forecast include them like any other source.
        for (const mt of app.manualTransactions || []) {
            if (!mt.date) continue;
            const mDate = new Date(`${String(mt.date).slice(0, 10)}T00:00:00`);
            if (mDate.getFullYear() !== year || mDate.getMonth() !== month) continue;
            addTx({
                accountId: mt.accountId,
                date: mDate,
                name: mt.name || t('ledger.txManual'),
                amount: Number(mt.amount),
                type: 'manual',
                sourceId: mt.id,
                category: mt.category || 'Other'
            });
        }

        for (const tmpl of (app.recurringTemplates || []).filter(r => !r.archived)) {
            const occurrences = getRecurringOccurrencesInMonth(tmpl, year, month);
            for (const occDate of occurrences) {
                if (isRecurringInflow(tmpl)) {
                    addTx({
                        accountId: tmpl.accountId,
                        date: occDate,
                        name: tmpl.name || t('ledger.txRecurring'),
                        amount: Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || (tmpl.type === 'income' ? 'Income' : 'Reimbursement')
                    });
                } else if (tmpl.type === 'transfer' && tmpl.targetAccountId) {
                    addTx({
                        accountId: tmpl.accountId,
                        date: occDate,
                        name: tmpl.name || t('ledger.txTransferOut'),
                        amount: -Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || 'Transfer',
                        isTransferLeg: true,
                        counterpartAccountId: tmpl.targetAccountId
                    });
                    addTx({
                        accountId: tmpl.targetAccountId,
                        date: occDate,
                        name: tmpl.name || t('ledger.txTransferIn'),
                        amount: Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || 'Transfer',
                        isTransferLeg: true,
                        counterpartAccountId: tmpl.accountId
                    });
                } else {
                    addTx({
                        accountId: tmpl.accountId,
                        date: occDate,
                        name: tmpl.name || t('ledger.txRecurring'),
                        amount: -Math.abs(Number(tmpl.amount)),
                        type: 'recurring',
                        sourceId: tmpl.id,
                        category: tmpl.category || 'Subscription'
                    });
                }
            }
        }

        // Add auto-contributing savings to ledger
        for (const fund of app.emergencyFunds || []) {
            if (fund.autoContribute && fund.monthlyContribution > 0 && fund.currentAmount < fund.targetAmount) {
                const savingDate = new Date(year, month, 1); // First day of month
                addTx({
                    accountId: fund.accountId,
                    date: savingDate,
                    name: t('ledger.txEmergencyFund'),
                    amount: -Math.abs(Number(fund.monthlyContribution)),
                    type: 'savings',
                    sourceId: fund.id,
                    category: 'Savings'
                });
            }
        }

        for (const fund of app.sinkingFunds || []) {
            if (fund.autoContribute && fund.monthlyAllocation > 0 && fund.currentAmount < fund.targetAmount) {
                const savingDate = new Date(year, month, 1); // First day of month
                addTx({
                    accountId: fund.accountId,
                    date: savingDate,
                    name: fund.name || t('ledger.txSinkingFund'),
                    amount: -Math.abs(Number(fund.monthlyAllocation)),
                    type: 'savings',
                    sourceId: fund.id,
                    category: 'Savings'
                });
            }
        }

        // Monthly interest deposits (#30): APY/12 on the projected
        // end-of-month balance, posted on the last day of the month.
        // Override-aware in both directions — the base balance uses effective
        // amounts, and an overridden interest amount feeds later months.
        for (const acct of app.accounts || []) {
            const monthTxs = accountMap[acct.id].txs.slice(monthStartTxCounts[acct.id]);
            let balance = interestBalances[acct.id];
            for (const tx of monthTxs) {
                balance += getEffectiveAmount(app, tx);
            }
            const rate = Number(acct.interestRate) || 0;
            if (rate > 0 && balance > 0) {
                const interest = Math.round(balance * (rate / 100 / 12) * 100) / 100;
                if (interest > 0) {
                    addTx({
                        accountId: acct.id,
                        date: new Date(year, month + 1, 0),
                        name: t('ledger.txInterest'),
                        amount: interest,
                        type: 'interest',
                        sourceId: acct.id,
                        category: 'Interest'
                    });
                    const txList = accountMap[acct.id].txs;
                    balance += getEffectiveAmount(app, txList[txList.length - 1]);
                }
            }
            interestBalances[acct.id] = balance;
        }
    }

    // Reconciliation entries are recorded against real calendar dates rather
    // than generated per projected month, so they're folded in separately
    // here and only kept if their date falls inside the projected window.
    const windowMonths = new Set();
    for (let m = 0; m < monthsToProject; m++) {
        const y = startYear + Math.floor((startMonth + m) / 12);
        const mo = (startMonth + m) % 12;
        windowMonths.add(`${y}-${mo}`);
    }
    for (const recon of app.reconciliations || []) {
        if (!recon.accountId || !accountMap[recon.accountId]) continue;
        const reconDate = new Date(`${recon.date}T00:00:00`);
        if (!windowMonths.has(`${reconDate.getFullYear()}-${reconDate.getMonth()}`)) continue;
        accountMap[recon.accountId].txs.push({
            date: reconDate,
            name: t('ledger.txReconciliation'),
            originalAmount: 0,
            type: 'reconciliation',
            sourceId: recon.id,
            category: 'Reconciliation',
            transactionId: null,
            meta: {
                previousBalance: recon.previousBalance,
                statementBalance: recon.statementBalance,
                difference: recon.difference,
                note: recon.note
            }
        });
    }

    for (const acctId in accountMap) {
        accountMap[acctId].txs.sort((a, b) => a.date - b.date);
    }

    return accountMap;
}

export function getLedgerTransactionsForMonth(app, year, month, accountId = null) {
    const accountMap = buildProjectedAccountTransactions(app, year, month, 1);
    const out = [];
    for (const acctId in accountMap) {
        // When filtering by a specific account, skip the unlinked sentinel
        // (it never matches a numeric id anyway, but be explicit)
        if (acctId === UNLINKED_KEY && accountId !== null) continue;
        if (accountId !== null && String(acctId) !== String(accountId)) continue;
        const acct = accountMap[acctId];
        for (const tx of acct.txs) {
            const amount = getEffectiveAmount(app, tx);
            out.push({
                date: tx.date.toISOString(),
                account: acct.name,
                accountId: acctId === UNLINKED_KEY ? null : acctId,
                name: tx.name,
                amount,
                originalAmount: tx.originalAmount,
                hasOverride: amount !== tx.originalAmount,
                overrideAmount: amount !== tx.originalAmount ? amount : null,
                type: tx.type,
                isTransferLeg: tx.isTransferLeg === true,
        counterpartAccountId: tx.counterpartAccountId ?? null,
                category: tx.category,
                sourceId: tx.sourceId,
                transactionId: tx.transactionId,
                cleared: isCleared(app, tx.transactionId),
                clearedAt: getClearedAt(app, tx.transactionId)
            });
        }
    }
    out.sort((a, b) => new Date(a.date) - new Date(b.date));
    return out;
}

// An account's projected end-of-month balance: its starting balance plus every
// (override-aware) transaction the projection posts to it in that month.
export function computeAccountBalance(app, accountId, year = null, month = null) {
    const acct = app.accounts.find(a => a.id === accountId);
    if (!acct) return 0;
    let balance = Number(acct.startingBalance) || 0;

    const now = new Date();
    const yr = year !== null ? year : now.getFullYear();
    const mo = month !== null ? month : now.getMonth();
    const monthTxs = getLedgerTransactionsForMonth(app, yr, mo, accountId);

    for (const tx of monthTxs) {
        balance += Number(tx.amount) || 0;
    }

    return balance;
}
