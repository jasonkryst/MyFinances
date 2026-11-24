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

import { sanitizeFiniteNumber, sanitizeDateISO, normalizeText, todayISO, withBusy, formatCurrency, escapeHtml, markFieldInvalid } from './utils.js';
import { MANUAL_SPLIT_MIN, MANUAL_SPLIT_MAX, toCents } from './manualSplits.js';
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
export function validateManualTransactionInput({ accountId, amount, name, date, splits }) {
    if (!Number.isFinite(accountId)) return t('manualTx.errAccount');
    if (!normalizeText(name, 100)) return t('manualTx.errName');
    if (!Number.isFinite(amount) || amount <= 0 || amount > MANUAL_TX_MAX_AMOUNT) return t('manualTx.errAmount');
    if (!sanitizeDateISO(date)) return t('manualTx.errDate');
    return validateSplitInput(amount, splits).message;
}

// #688: cents still to allocate (positive = left over, negative = over).
export function splitRemainingCents(amount, splits) {
    const total = Number.isFinite(amount) ? toCents(amount) : 0;
    const used = (splits || []).reduce((sum, s) => sum + (Number.isFinite(s.amount) ? toCents(s.amount) : 0), 0);
    return total - used;
}

// No splits (null/undefined) is valid. Otherwise the splits' positive
// amounts must each have a category and add up to `amount` in whole cents.
// Returns { message, field } where field names the first offender
// ('category' | 'amount') so the modal can mark it.
export function validateSplitInput(amount, splits) {
    if (splits === null || splits === undefined) return { message: '', field: null };
    if (!Array.isArray(splits) || splits.length < MANUAL_SPLIT_MIN || splits.length > MANUAL_SPLIT_MAX) {
        return { message: t('manualTx.errSplitUnbalanced', { amount: formatCurrency(Number.isFinite(amount) ? amount : 0) }), field: 'amount' };
    }
    if (splits.some(s => !normalizeText(s.category, 40))) return { message: t('manualTx.errSplitCategory'), field: 'category' };
    if (splits.some(s => !Number.isFinite(s.amount) || s.amount <= 0 || s.amount > MANUAL_TX_MAX_AMOUNT)) {
        return { message: t('manualTx.errSplitAmount'), field: 'amount' };
    }
    const remaining = splitRemainingCents(amount, splits);
    if (remaining !== 0) {
        return { message: t('manualTx.errSplitUnbalanced', { amount: formatCurrency(remaining / 100) }), field: 'amount' };
    }
    return { message: '', field: null };
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

function buildRecord({ accountId, direction, amount, date, name, category, memo, splits }) {
    const magnitude = Math.abs(Number(amount));
    const sign = direction === 'income' ? 1 : -1;
    // #688: split amounts are stored with the transaction's sign. The record's
    // own category is the first split's, for readers that ignore splits.
    const hasSplits = Array.isArray(splits) && splits.length > 0;
    const signedSplits = hasSplits ? splits.map(s => {
        const out = { category: normalizeText(s.category, 40), amount: sign * Math.round(Math.abs(Number(s.amount)) * 100) / 100 };
        const splitMemo = normalizeText(s.memo, 200);
        if (splitMemo) out.memo = splitMemo;
        return out;
    }) : null;
    return {
        accountId,
        date: sanitizeDateISO(date),
        amount: sign * magnitude,
        name: normalizeText(name, 100),
        category: hasSplits ? signedSplits[0].category : (normalizeText(category, 40) || (direction === 'income' ? 'Income' : 'Other')),
        memo: normalizeText(memo, 200),
        splits: signedSplits
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
        'manualTxConfirmBtn', 'manualTxCancelBtn', 'manualTxCloseBtn',
        'manualTxSplitToggle', 'manualTxSplitEditor', 'manualTxSplitRows', 'manualTxSplitAdd', 'manualTxSplitRemaining'];
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

    // #688: the split editor. `splitRows` is null while the transaction has a
    // single category; otherwise one { category, amount, memo } per split, the
    // amounts typed as positive magnitudes (the record stores them signed).
    let splitRows = editing && Array.isArray(editing.splits) && editing.splits.length > 0
        ? editing.splits.map(s => ({ category: s.category, amount: String(Math.abs(s.amount)), memo: s.memo || '' }))
        : null;
    const categoryGroup = el.manualTxCategory.closest('.form-group');
    const parsedSplits = () => (splitRows || []).map(r => ({
        category: r.category, amount: sanitizeFiniteNumber(r.amount, NaN), memo: r.memo
    }));
    const updateRemaining = () => {
        const out = el.manualTxSplitRemaining;
        const remaining = splitRemainingCents(sanitizeFiniteNumber(el.manualTxAmount.value, NaN), parsedSplits());
        out.classList.toggle('manual-tx-split-remaining--over', remaining < 0);
        if (remaining === 0) out.textContent = t('manualTx.splitBalanced');
        else if (remaining > 0) out.textContent = t('manualTx.splitRemaining', { amount: formatCurrency(remaining / 100) });
        else out.textContent = t('manualTx.splitOver', { amount: formatCurrency(-remaining / 100) });
    };
    const renderSplitEditor = () => {
        const on = splitRows !== null;
        el.manualTxSplitToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.manualTxSplitEditor.classList.toggle('hidden', !on);
        categoryGroup.classList.toggle('hidden', on);
        el.manualTxSplitAdd.disabled = on && splitRows.length >= MANUAL_SPLIT_MAX;
        if (!on) { el.manualTxSplitRows.innerHTML = ''; return; }
        el.manualTxSplitRows.innerHTML = splitRows.map((r, i) => `
            <fieldset class="manual-tx-split-row" data-split-index="${i}">
                <legend>${escapeHtml(t('manualTx.splitRowTitle', { n: i + 1 }))}</legend>
                <div class="manual-tx-split-fields">
                    <div><label for="manualTxSplitCat${i}">${escapeHtml(t('manualTx.categoryLabel'))}</label>
                        <input type="text" id="manualTxSplitCat${i}" data-split-field="category" maxlength="40" list="categoryOptions" autocomplete="off" value="${escapeHtml(r.category)}"></div>
                    <div><label for="manualTxSplitAmt${i}">${escapeHtml(t('manualTx.amountLabel'))}</label>
                        <input type="number" id="manualTxSplitAmt${i}" data-split-field="amount" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" value="${escapeHtml(r.amount)}"></div>
                    <div class="manual-tx-split-memo"><label for="manualTxSplitMemo${i}">${escapeHtml(t('manualTx.memoLabel'))}</label>
                        <input type="text" id="manualTxSplitMemo${i}" data-split-field="memo" maxlength="200" value="${escapeHtml(r.memo)}"></div>
                    <button type="button" class="btn btn-secondary btn-small manual-tx-split-remove" data-split-remove="${i}" aria-label="${escapeHtml(t('manualTx.splitRemoveAria', { n: i + 1 }))}">${escapeHtml(t('manualTx.splitRemove'))}</button>
                </div>
            </fieldset>`).join('');
        el.manualTxSplitRows.querySelectorAll('input[data-split-field]').forEach(input => {
            input.addEventListener('input', () => {
                const row = splitRows[parseInt(input.closest('[data-split-index]').getAttribute('data-split-index'), 10)];
                if (row) row[input.getAttribute('data-split-field')] = input.value;
                updateRemaining();
            });
        });
        el.manualTxSplitRows.querySelectorAll('[data-split-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.getAttribute('data-split-remove'), 10);
                if (splitRows.length <= MANUAL_SPLIT_MIN) {
                    // Fewer than two splits is no split: back to one category.
                    const keep = splitRows[index === 0 ? 1 : 0];
                    el.manualTxCategory.value = keep ? keep.category : '';
                    splitRows = null;
                    renderSplitEditor();
                    el.manualTxSplitToggle.focus();
                    return;
                }
                splitRows.splice(index, 1);
                renderSplitEditor();
                const next = el.manualTxSplitRows.querySelector('[data-split-field="category"]');
                if (next) next.focus();
            });
        });
        updateRemaining();
    };
    el.manualTxSplitToggle.onclick = () => {
        if (splitRows === null) {
            splitRows = [
                { category: normalizeText(el.manualTxCategory.value, 40), amount: '', memo: '' },
                { category: '', amount: '', memo: '' }
            ];
            renderSplitEditor();
            const firstAmount = el.manualTxSplitRows.querySelector('[data-split-field="amount"]');
            if (firstAmount) firstAmount.focus();
        } else {
            el.manualTxCategory.value = splitRows[0] ? splitRows[0].category : '';
            splitRows = null;
            renderSplitEditor();
        }
    };
    el.manualTxSplitAdd.onclick = () => {
        if (splitRows === null || splitRows.length >= MANUAL_SPLIT_MAX) return;
        splitRows.push({ category: '', amount: '', memo: '' });
        renderSplitEditor();
        const inputs = el.manualTxSplitRows.querySelectorAll('[data-split-field="category"]');
        if (inputs.length) inputs[inputs.length - 1].focus();
    };
    el.manualTxAmount.oninput = () => { if (splitRows !== null) updateRemaining(); };
    renderSplitEditor();

    const setError = (message) => {
        el.manualTxError.textContent = message || '';
        el.manualTxError.classList.toggle('hidden', !message);
    };
    setError('');

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        el.manualTxAmount.oninput = null;
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
            memo: el.manualTxMemo.value,
            splits: splitRows === null ? null : parsedSplits()
        };
        const result = editing
            ? await editManualTransaction(app, editing.id, fields)
            : await addManualTransaction(app, fields);
        if (result.success) close();
        else if (result.error) {
            setError(result.error);
            // #688: a split problem marks the offending split field.
            if (splitRows !== null) {
                const { field } = validateSplitInput(fields.amount, fields.splits);
                if (field) {
                    const rows = [...el.manualTxSplitRows.querySelectorAll('[data-split-field="' + field + '"]')];
                    const bad = field === 'category'
                        ? rows.find(r => !normalizeText(r.value, 40))
                        : (rows.find(r => !(sanitizeFiniteNumber(r.value, NaN) > 0)) || rows[0]);
                    if (bad) { markFieldInvalid(bad, el.manualTxError); bad.focus(); }
                }
            }
        }
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
