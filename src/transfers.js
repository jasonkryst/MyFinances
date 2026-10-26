// Account transfer tracking (issue #248): a one-off, dated, zero-sum record
// moving money between two of the user's own accounts. This module owns the
// record's CRUD and modal UI only -- no balance math lives here.
// ledgerTransactions.js's buildProjectedAccountTransactions() generates two
// opposite-signed legs per transfer (same addTx() mechanism every other
// transaction source uses), so computeAccountBalance()/Reports/Forecast are
// correct for transfers automatically, the same way they already are for
// the recurring-template transfer type.

import { sanitizeFiniteNumber, sanitizeDateISO, normalizeText, todayISO } from './utils.js';
import { buildAccountOptionsHtml } from './accounts.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showAlertModal, showDeleteConfirmModal } from './ui.js';
import { renderLedgerPage } from './ledger.js';

// Returns '' when valid, otherwise a user-facing error message.
function validateTransferInput(fromAccountId, toAccountId, amount) {
    if (!Number.isFinite(fromAccountId) || !Number.isFinite(toAccountId)) return 'Please select both accounts.';
    if (fromAccountId === toAccountId) return 'From and To accounts must be different.';
    if (!Number.isFinite(amount) || amount <= 0) return 'Please enter a valid amount greater than zero.';
    return '';
}

function refreshAfterTransferChange(app) {
    const ledgerSection = document.getElementById('ledgerSection');
    if (ledgerSection && ledgerSection.classList.contains('active')) renderLedgerPage(app);
    if (typeof app.renderAccountsList === 'function') app.renderAccountsList();
    if (typeof app.renderNetWorthWidget === 'function') app.renderNetWorthWidget();
}

export async function addTransfer(app, fromAccountId, toAccountId, amount, date, memo) {
    const error = validateTransferInput(fromAccountId, toAccountId, amount);
    if (error) {
        await showAlertModal(error);
        return { success: false, error };
    }

    const entry = {
        id: Date.now(),
        fromAccountId,
        toAccountId,
        amount: Math.abs(Number(amount)),
        date: sanitizeDateISO(date) || todayISO(),
        memo: normalizeText(memo, 200),
        createdAt: new Date().toISOString()
    };
    app.transfers.push(entry);

    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/transfers', entry);
        if (saved?.id) entry.id = saved.id;
    }
    refreshAfterTransferChange(app);

    return { success: true, entry };
}

export async function editTransfer(app, id, { fromAccountId, toAccountId, amount, date, memo }) {
    const error = validateTransferInput(fromAccountId, toAccountId, amount);
    if (error) {
        await showAlertModal(error);
        return { success: false, error };
    }

    const entry = (app.transfers || []).find(t => t.id === id);
    if (!entry) return { success: false };

    entry.fromAccountId = fromAccountId;
    entry.toAccountId = toAccountId;
    entry.amount = Math.abs(Number(amount));
    entry.date = sanitizeDateISO(date) || todayISO();
    entry.memo = normalizeText(memo, 200);

    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        await pgPatch(app, `/api/transfers/${id}`, entry);
    }
    refreshAfterTransferChange(app);

    return { success: true, entry };
}

export async function deleteTransfer(app, id) {
    const confirmed = await showDeleteConfirmModal('Delete this transfer? Both legs will be removed from the Ledger.', 'Delete');
    if (!confirmed) return { success: false };

    app.transfers = (app.transfers || []).filter(t => t.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/transfers/${id}`);
    refreshAfterTransferChange(app);

    return { success: true };
}

export function openTransferModal(app, { fromAccountId = null, editId = null } = {}) {
    const modal = document.getElementById('transferModal');
    const titleEl = document.getElementById('transferModalTitle');
    const fromSelect = document.getElementById('transferModalFrom');
    const toSelect = document.getElementById('transferModalTo');
    const errorEl = document.getElementById('transferModalError');
    const amountInput = document.getElementById('transferModalAmount');
    const dateInput = document.getElementById('transferModalDate');
    const memoInput = document.getElementById('transferModalMemo');
    const confirmBtn = document.getElementById('transferModalConfirmBtn');
    const cancelBtn = document.getElementById('transferModalCancelBtn');
    const closeBtn = document.getElementById('transferModalCloseBtn');

    if (!modal || !titleEl || !fromSelect || !toSelect || !errorEl || !amountInput || !dateInput || !memoInput || !confirmBtn || !cancelBtn || !closeBtn) {
        return;
    }

    const editing = editId !== null ? (app.transfers || []).find(t => t.id === editId) : null;

    titleEl.textContent = editing ? 'Edit Transfer' : 'Transfer Between Accounts';
    confirmBtn.textContent = editing ? 'Save Changes' : 'Transfer';
    errorEl.textContent = '';
    errorEl.classList.add('hidden');

    fromSelect.innerHTML = buildAccountOptionsHtml(app.accounts, editing ? editing.fromAccountId : fromAccountId, { emptyLabel: '— Select account —' });
    toSelect.innerHTML = buildAccountOptionsHtml(app.accounts, editing ? editing.toAccountId : null, { emptyLabel: '— Select account —' });
    amountInput.value = editing ? editing.amount : '';
    dateInput.value = editing ? editing.date : todayISO();
    memoInput.value = editing ? editing.memo : '';

    // Live from/to validation, same pattern as the Reconcile modal's live
    // date-range check -- amount is only validated on submit (via the
    // addTransfer/editTransfer alert path), since it isn't a dropdown pair
    // that can be immediately cross-checked as the user picks it.
    const refreshFromToValidation = () => {
        const from = parseInt(fromSelect.value, 10);
        const to = parseInt(toSelect.value, 10);
        const error = Number.isFinite(from) && Number.isFinite(to) && from === to
            ? 'From and To accounts must be different.'
            : '';
        errorEl.textContent = error;
        errorEl.classList.toggle('hidden', !error);
        confirmBtn.disabled = Boolean(error);
    };
    fromSelect.onchange = refreshFromToValidation;
    toSelect.onchange = refreshFromToValidation;
    refreshFromToValidation();

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    confirmBtn.onclick = async () => {
        const from = parseInt(fromSelect.value, 10);
        const to = parseInt(toSelect.value, 10);
        const amount = sanitizeFiniteNumber(amountInput.value, NaN);
        const result = editing
            ? await editTransfer(app, editing.id, { fromAccountId: from, toAccountId: to, amount, date: dateInput.value, memo: memoInput.value })
            : await addTransfer(app, from, to, amount, dateInput.value, memoInput.value);
        if (result.success) close();
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
        if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
            event.preventDefault();
            if (!confirmBtn.disabled) confirmBtn.click();
            return;
        }
        if (event.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => fromSelect.focus(), 30);
}
