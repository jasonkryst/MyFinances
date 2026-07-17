// Ledger amount-override subsystem: per-transaction manual amount overrides.

import { formatCurrency, parseFiniteOrNull, formatShortDate } from './utils.js';

export function getOverrideAmount(app, txId) {
    if (!txId) return null;
    const map = app.ledgerAmountOverrides || {};
    const entry = map[txId];
    if (!entry) return null;
    return parseFiniteOrNull(entry.amount);
}

export function getEffectiveAmount(app, tx) {
    const overrideAmount = getOverrideAmount(app, tx.transactionId);
    return overrideAmount !== null ? overrideAmount : tx.originalAmount;
}

export function setLedgerAmountOverride(app, transactionId, amount, metadata = {}) {
    if (!transactionId) return;
    const parsed = parseFiniteOrNull(amount);
    if (parsed === null) return;
    if (!app.ledgerAmountOverrides) app.ledgerAmountOverrides = {};

    app.ledgerAmountOverrides[transactionId] = {
        amount: parsed,
        originalAmount: parseFiniteOrNull(metadata.originalAmount),
        transactionName: metadata.transactionName || null,
        accountId: metadata.accountId || null,
        date: metadata.date || null,
        updatedAt: new Date().toISOString()
    };
}

export function clearLedgerAmountOverride(app, transactionId) {
    if (!transactionId || !app.ledgerAmountOverrides) return;
    delete app.ledgerAmountOverrides[transactionId];
}

export function openLedgerOverrideModal(app, tx, onApplied) {
    const modal = document.getElementById('ledgerOverrideModal');
    if (!modal || !tx || tx.isRollover || !tx.transactionId) return;

    const nameEl = document.getElementById('ledgerOverrideTxName');
    const accountEl = document.getElementById('ledgerOverrideAccount');
    const dateEl = document.getElementById('ledgerOverrideDate');
    const originalEl = document.getElementById('ledgerOverrideOriginal');
    const input = document.getElementById('ledgerOverrideAmountInput');
    const confirmBtn = document.getElementById('ledgerOverrideConfirmBtn');
    const cancelBtn = document.getElementById('ledgerOverrideCancelBtn');
    const closeBtn = document.getElementById('ledgerOverrideCloseBtn');

    if (!nameEl || !accountEl || !dateEl || !originalEl || !input || !confirmBtn || !cancelBtn || !closeBtn) {
        return;
    }

    nameEl.textContent = tx.name || '';
    accountEl.textContent = tx.account || '';
    dateEl.textContent = tx.date ? formatShortDate(tx.date) : '';
    originalEl.textContent = formatCurrency(tx.originalAmount);
    input.value = Number(tx.amount || 0).toFixed(2);

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };

    confirmBtn.onclick = () => {
        const parsed = parseFiniteOrNull(input.value);
        if (parsed === null) {
            alert('Please enter a valid number.');
            return;
        }
        setLedgerAmountOverride(app, tx.transactionId, parsed, {
            originalAmount: tx.originalAmount,
            transactionName: tx.name,
            accountId: tx.accountId,
            date: tx.date
        });
        app.saveToStorage();
        close();
        if (typeof onApplied === 'function') onApplied();
        if (typeof app.renderReportsPage === 'function') app.renderReportsPage();
        if (typeof app.renderAccountsList === 'function') app.renderAccountsList();
    };

    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            confirmBtn.click();
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 30);
}
