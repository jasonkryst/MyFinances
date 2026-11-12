// Manual one-off transactions (issue #584): actuals the user enters in the
// Ledger -- an unplanned purchase, a refund, a cash withdrawal. This module owns
// the record's CRUD and modal UI only. ledgerTransactions.js emits each record
// as one signed `type: 'manual'` leg, so balances, Reports and Forecast include
// it with no manual-specific balance math.
//
// The amount is stored signed (negative = money out); the modal takes a
// direction plus a positive amount. A new record is Cleared by default: it
// already happened. It is never overridden in the Ledger; editing the record
// is the one way to change its amount.

import { sanitizeFiniteNumber, sanitizeDateISO, normalizeText, todayISO, withBusy } from './utils.js';
import { buildAccountOptionsHtml } from './accounts.js';
import { pgCreate, pgPatch, pgDelete } from './postgresSync.js';
import { showDeleteConfirmModal } from './ui.js';
import { renderLedgerPage } from './ledger.js';
import { makeLedgerTransactionId } from './ledgerTransactions.js';
import { isCleared, setLedgerCleared } from './ledgerCleared.js';
import { refreshCategoryDatalist } from './recurring.js';
import { t } from './i18n.js';

export const MANUAL_TX_MAX_AMOUNT = 1e9;

// Returns '' when valid, otherwise a user-facing error message. `amount` is
// the positive magnitude typed into the form.
export function validateManualTransactionInput({ accountId, amount, name, date }) {
    if (!Number.isFinite(accountId)) return t('manualTx.errAccount');
    if (!normalizeText(name, 100)) return t('manualTx.errName');
    if (!Number.isFinite(amount) || amount <= 0 || amount > MANUAL_TX_MAX_AMOUNT) return t('manualTx.errAmount');
    if (!sanitizeDateISO(date)) return t('manualTx.errDate');
    return '';
}

// The Ledger key of a record's single leg (same shape as every other source).
export function manualTransactionLedgerKey(tx) {
    return makeLedgerTransactionId({
        accountId: tx.accountId,
        date: new Date(`${tx.date}T00:00:00`),
        type: 'manual',
        sourceId: tx.id
    });
}

function buildRecord({ accountId, direction, amount, date, name, category, memo }) {
    const magnitude = Math.abs(Number(amount));
    return {
        accountId,
        date: sanitizeDateISO(date),
        amount: direction === 'income' ? magnitude : -magnitude,
        name: normalizeText(name, 100),
        category: normalizeText(category, 40) || (direction === 'income' ? 'Income' : 'Other'),
        memo: normalizeText(memo, 200)
    };
}

function refreshAfterChange(app) {
    const ledgerSection = document.getElementById('ledgerSection');
    if (ledgerSection && ledgerSection.classList.contains('active')) renderLedgerPage(app);
    if (typeof app.renderAccountsList === 'function') app.renderAccountsList();
    if (typeof app.renderNetWorthWidget === 'function') app.renderNetWorthWidget();
}

/**
 * Create a manual transaction. `fields`: { accountId, direction: 'expense' |
 * 'income', amount (positive), date, name, category, memo }.
 * Returns { success, entry } or { success: false, error }.
 */
export async function addManualTransaction(app, fields) {
    const error = validateManualTransactionInput(fields);
    if (error) return { success: false, error };

    const entry = { id: Date.now(), ...buildRecord(fields), createdAt: new Date().toISOString() };
    // POST first; the record joins app.manualTransactions only with its server
    // id (#460). A failed save keeps the modal filled for a retry.
    if (!(await pgCreate(app, 'manualTransactions', '/api/manual-transactions', entry))) return { success: false };
    setLedgerCleared(app, manualTransactionLedgerKey(entry), true);
    refreshAfterChange(app);
    return { success: true, entry };
}

export async function editManualTransaction(app, id, fields) {
    const error = validateManualTransactionInput(fields);
    if (error) return { success: false, error };

    const entry = (app.manualTransactions || []).find(m => m.id === id);
    if (!entry) return { success: false };

    const oldKey = manualTransactionLedgerKey(entry);
    const wasCleared = isCleared(app, oldKey);
    Object.assign(entry, buildRecord(fields));
    const newKey = manualTransactionLedgerKey(entry);
    // The Cleared flag is keyed by account and date, so carry it over when
    // either changes; otherwise an edit would silently un-clear the record.
    if (newKey !== oldKey && wasCleared) {
        setLedgerCleared(app, oldKey, false);
        setLedgerCleared(app, newKey, true);
    }

    await pgPatch(app, `/api/manual-transactions/${id}`, entry);
    refreshAfterChange(app);
    return { success: true, entry };
}

export async function deleteManualTransaction(app, id) {
    const entry = (app.manualTransactions || []).find(m => m.id === id);
    if (!entry) return { success: false };
    const confirmed = await showDeleteConfirmModal(t('manualTx.confirmDelete', { name: entry.name }), t('common.delete'));
    if (!confirmed) return { success: false };

    const key = manualTransactionLedgerKey(entry);
    if (isCleared(app, key)) setLedgerCleared(app, key, false);
    app.manualTransactions = app.manualTransactions.filter(m => m.id !== id);
    pgDelete(app, `/api/manual-transactions/${id}`);
    refreshAfterChange(app);
    return { success: true };
}

export function openManualTransactionModal(app, { accountId = null, editId = null } = {}) {
    const modal = document.getElementById('manualTxModal');
    const ids = ['manualTxModalTitle', 'manualTxAccount', 'manualTxExpense', 'manualTxIncome', 'manualTxAmount',
        'manualTxDate', 'manualTxName', 'manualTxCategory', 'manualTxMemo', 'manualTxError',
        'manualTxConfirmBtn', 'manualTxCancelBtn', 'manualTxCloseBtn'];
    const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    if (!modal || Object.values(el).some(x => !x)) return;

    const editing = editId !== null ? (app.manualTransactions || []).find(m => m.id === editId) : null;
    refreshCategoryDatalist(app);

    el.manualTxModalTitle.textContent = editing ? t('manualTx.editTitle') : t('manualTx.title');
    el.manualTxConfirmBtn.textContent = editing ? t('manualTx.saveChangesBtn') : t('manualTx.addBtn');
    el.manualTxAccount.innerHTML = buildAccountOptionsHtml(app.accounts, editing ? editing.accountId : accountId,
        { emptyLabel: t('manualTx.selectAccount') });
    const isIncome = editing ? editing.amount > 0 : false;
    el.manualTxExpense.checked = !isIncome;
    el.manualTxIncome.checked = isIncome;
    el.manualTxAmount.value = editing ? Math.abs(editing.amount) : '';
    el.manualTxDate.value = editing ? editing.date : todayISO();
    el.manualTxName.value = editing ? editing.name : '';
    el.manualTxCategory.value = editing ? editing.category : '';
    el.manualTxMemo.value = editing ? editing.memo : '';

    const setError = (message) => {
        el.manualTxError.textContent = message || '';
        el.manualTxError.classList.toggle('hidden', !message);
    };
    setError('');

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    el.manualTxConfirmBtn.onclick = () => withBusy(modal, async () => {
        const fields = {
            accountId: parseInt(el.manualTxAccount.value, 10),
            direction: el.manualTxIncome.checked ? 'income' : 'expense',
            amount: sanitizeFiniteNumber(el.manualTxAmount.value, NaN),
            date: el.manualTxDate.value,
            name: el.manualTxName.value,
            category: el.manualTxCategory.value,
            memo: el.manualTxMemo.value
        };
        const result = editing
            ? await editManualTransaction(app, editing.id, fields)
            : await addManualTransaction(app, fields);
        if (result.success) close();
        else if (result.error) setError(result.error);
    });

    el.manualTxCancelBtn.onclick = close;
    el.manualTxCloseBtn.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type !== 'radio') {
            event.preventDefault();
            if (!el.manualTxConfirmBtn.disabled) el.manualTxConfirmBtn.click();
            return;
        }
        if (event.key === 'Tab') {
            const focusable = [...modal.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])')]
                .filter(f => !f.disabled && !(f.type === 'radio' && !f.checked));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => (editing ? el.manualTxAmount : el.manualTxAccount).focus(), 30);
}
