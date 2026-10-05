// Pure balance-history helpers — no DOM/app state access (same convention as
// retirementCalculator.js), so they can be unit- and mutation-tested.
// Owner refs are { kind: 'debt' | 'account', id }.

export const HISTORY_TRACKED_ACCOUNT_TYPES = ['Credit Card', 'Loan'];

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function roundCents(value) {
    return Math.round(value * 100) / 100;
}

function sameValues(a, b) {
    return a.balance === b.balance && a.minimumPayment === b.minimumPayment;
}

export function isHistoryTrackedAccount(account) {
    return !!account && HISTORY_TRACKED_ACCOUNT_TYPES.includes(account.type);
}

export function ownerOfEntry(entry) {
    return entry.debtId != null
        ? { kind: 'debt', id: entry.debtId }
        : { kind: 'account', id: entry.accountId };
}

export function entryBelongsTo(entry, owner) {
    return owner.kind === 'debt'
        ? entry.debtId != null && Number(entry.debtId) === Number(owner.id)
        : entry.accountId != null && Number(entry.accountId) === Number(owner.id);
}

export function sortHistory(entries) {
    return [...entries].sort((a, b) =>
        a.date.localeCompare(b.date) || (Number(a.id) || 0) - (Number(b.id) || 0));
}

export function buildHistoryEntry(owner, record, date) {
    if (owner.kind === 'account') {
        return { debtId: null, accountId: owner.id, date, balance: toNumber(record.startingBalance), minimumPayment: toNumber(record.minimumPayment) };
    }
    if (record.debtType === 'fixedAmount') {
        return { debtId: owner.id, accountId: null, date, balance: null, minimumPayment: toNumber(record.fixedAmount) };
    }
    return { debtId: owner.id, accountId: null, date, balance: toNumber(record.accountBalance), minimumPayment: toNumber(record.minimumPayment) };
}

export function upsertHistoryEntry(entries, entry, newId) {
    const own = sortHistory(entries.filter(e => entryBelongsTo(e, ownerOfEntry(entry))));
    const sameDay = own.find(e => e.date === entry.date);
    if (sameDay) {
        if (sameValues(sameDay, entry)) return { entries, action: 'none', target: sameDay };
        const updated = { ...sameDay, balance: entry.balance, minimumPayment: entry.minimumPayment };
        return { entries: entries.map(e => (e === sameDay ? updated : e)), action: 'update', target: updated };
    }
    const latest = own[own.length - 1];
    if (latest && sameValues(latest, entry)) return { entries, action: 'none', target: latest };
    const inserted = { id: newId, ...entry };
    return { entries: [...entries, inserted], action: 'insert', target: inserted };
}

export function seedHistoryForDebt(debt, today) {
    // Slice to YYYY-MM-DD: Postgres API returns updatedAt as a full ISO timestamp
    const currentDate = debt.updatedAt ? String(debt.updatedAt).slice(0, 10) : today;
    const current = buildHistoryEntry({ kind: 'debt', id: debt.id }, debt, currentDate);
    if (debt.debtType === 'fixedAmount') return [current];
    const original = {
        ...current,
        date: debt.debtStartDate,
        balance: toNumber(debt.originalBalance ?? debt.accountBalance),
        minimumPayment: toNumber(debt.originalMinimumPayment ?? debt.minimumPayment)
    };
    if (debt.debtStartDate && debt.debtStartDate < current.date && !sameValues(original, current)) {
        return [original, current];
    }
    return [current];
}

export function seedHistoryForAccount(account, today) {
    return [buildHistoryEntry({ kind: 'account', id: account.id }, account, today)];
}

export function remapHistoryOwners(entries, debtIdMap, accountIdMap) {
    const out = [];
    for (const entry of entries) {
        if (entry.debtId != null) {
            const debtId = debtIdMap.get(entry.debtId);
            if (debtId != null) out.push({ ...entry, debtId, accountId: null });
        } else if (entry.accountId != null) {
            const accountId = accountIdMap.get(entry.accountId);
            if (accountId != null) out.push({ ...entry, debtId: null, accountId });
        }
    }
    return out;
}

export function excludeExistingHistory(existing, incoming) {
    const keyOf = e => (e.debtId != null ? `d${e.debtId}` : `a${e.accountId}`) + `|${e.date}`;
    const seen = new Set(existing.map(keyOf));
    return incoming.filter(e => !seen.has(keyOf(e)));
}

export function computeHistoryDeltas(sortedEntries) {
    return sortedEntries.map((entry, i) => {
        const prev = i > 0 ? sortedEntries[i - 1] : null;
        const balanceDelta = prev && entry.balance !== null && prev.balance !== null
            ? roundCents(entry.balance - prev.balance) : null;
        const minimumPaymentDelta = prev ? roundCents(entry.minimumPayment - prev.minimumPayment) : null;
        return { ...entry, balanceDelta, minimumPaymentDelta };
    });
}
