// Pure, DOM-free builders for the reconciliation report export (#318).
// reconciliation.js gathers the data and does the download/print; everything
// that decides what goes into the file lives here so it can be unit tested.
// The CSV header/section labels deliberately stay English (like every other
// CSV export).

// Quote a CSV field per RFC 4180.
function quote(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

// Free text from the user (names, notes) that a spreadsheet could execute as
// a formula: prefix a single quote when it starts with = + - @ tab or CR.
export function csvTextField(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return quote(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
}

function money(value) {
    const n = Number(value);
    return quote(Number.isFinite(n) ? n.toFixed(2) : '');
}

function isoDay(value) {
    return typeof value === 'string' ? value.slice(0, 10) : '';
}

// Legacy reconciliations have no statementStartDate: fall back to the first of
// the end date's month (the same default the Reconcile form uses).
export function effectiveStatementStart(entry) {
    if (entry && entry.statementStartDate) return entry.statementStartDate;
    const end = isoDay(entry && (entry.statementEndDate || entry.date));
    return end ? `${end.slice(0, 8)}01` : '';
}

export function effectiveStatementEnd(entry) {
    return isoDay(entry && (entry.statementEndDate || entry.date));
}

// Keeps the transactions dated inside [start, end] (inclusive) that are
// Cleared, oldest first. `isClearedFn(id)` and `clearedAtFn(id)` are the
// ledgerStateCore lookups bound to the app.
export function selectClearedTransactions(transactions, start, end, isClearedFn, clearedAtFn) {
    if (!start || !end || !Array.isArray(transactions)) return [];
    return transactions
        .filter(tx => {
            const day = isoDay(tx && tx.date);
            return day && day >= start && day <= end && isClearedFn(tx.transactionId);
        })
        .map(tx => ({
            date: isoDay(tx.date),
            name: tx.name || '',
            amount: Number(tx.amount) || 0,
            clearedAt: clearedAtFn(tx.transactionId) || ''
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Everything the report shows, derived once so CSV and print agree.
export function buildReconciliationReport({ account, entry, transactions, history, isClearedFn, clearedAtFn }) {
    const start = effectiveStatementStart(entry);
    const end = effectiveStatementEnd(entry);
    const cleared = selectClearedTransactions(transactions, start, end, isClearedFn, clearedAtFn);
    const log = (Array.isArray(history) ? history : [])
        .filter(r => r && entry && r.accountId === entry.accountId)
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map(r => ({
            date: isoDay(r.date),
            statementBalance: Number(r.statementBalance),
            difference: Number(r.difference),
            note: r.note || ''
        }));
    return {
        accountName: account ? account.name : '',
        start,
        end,
        previousBalance: entry ? Number(entry.previousBalance) : NaN,
        statementBalance: entry ? Number(entry.statementBalance) : NaN,
        difference: entry ? Number(entry.difference) : NaN,
        note: entry && entry.note ? entry.note : '',
        cleared,
        history: log
    };
}

export function buildReconciliationCsv(report) {
    const lines = [];
    lines.push(quote('Reconciliation Summary'));
    lines.push(`${quote('Account')},${csvTextField(report.accountName)}`);
    lines.push(`${quote('Statement Start')},${quote(report.start)}`);
    lines.push(`${quote('Statement End')},${quote(report.end)}`);
    lines.push(`${quote('Previous Balance')},${money(report.previousBalance)}`);
    lines.push(`${quote('Statement Balance')},${money(report.statementBalance)}`);
    lines.push(`${quote('Difference')},${money(report.difference)}`);
    lines.push(`${quote('Note')},${csvTextField(report.note)}`);
    lines.push('');
    lines.push(quote('Cleared Transactions'));
    lines.push(['Date', 'Name', 'Amount', 'Cleared At'].map(quote).join(','));
    for (const tx of report.cleared) {
        lines.push([quote(tx.date), csvTextField(tx.name), money(tx.amount), quote(tx.clearedAt)].join(','));
    }
    lines.push('');
    lines.push(quote('Reconciliation History'));
    lines.push(['Date', 'Statement Balance', 'Difference', 'Note'].map(quote).join(','));
    for (const r of report.history) {
        lines.push([quote(r.date), money(r.statementBalance), money(r.difference), csvTextField(r.note)].join(','));
    }
    return lines.join('\n') + '\n';
}

// reconciliation-<account>-<YYYY-MM-DD>.csv with the account name made safe.
export function reconciliationFilename(accountName, endDate) {
    const slug = String(accountName || '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'account';
    return `reconciliation-${slug}-${endDate || 'undated'}.csv`;
}
