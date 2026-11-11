// Legacy browser-only data (v7.0.0, spec section 5 step 4). Browsers that used
// the old local mode still hold localStorage.debtTrackerData. Two variants of
// #pgMigrationModal handle it: import (the server dataset is empty) and
// cleanup (the server already has data: download a backup, or remove).
// Nothing from the legacy JSON ever reaches innerHTML; every string is set with
// textContent from t()/plural().
import { sanitizeParsedState } from './sanitizers.js';
import { replaceForPostgres } from './postgresImport.js';
import { t, plural, getIntlLocale } from './i18n.js';

const LEGACY_KEY = 'debtTrackerData';

function removeLegacyKey() {
    try { window.localStorage.removeItem(LEGACY_KEY); } catch (_) { /* storage blocked */ }
}

function buildCountsSummary(clean) {
    const parts = [
        [clean.debts, 'pgMigration.debt'],
        [clean.accounts, 'pgMigration.account'],
        [clean.incomes, 'pgMigration.income'],
        [clean.bills, 'pgMigration.bill'],
        [clean.expenses, 'pgMigration.expense'],
        [clean.recurringTemplates, 'pgMigration.recurring'],
        [clean.emergencyFunds, 'pgMigration.emergencyFund'],
        [clean.sinkingFunds, 'pgMigration.sinkingFund'],
    ]
        .filter(([arr]) => arr?.length)
        .map(([arr, key]) => plural(key, arr.length));
    return parts.length
        ? t('pgMigration.found', { list: new Intl.ListFormat(getIntlLocale(), { type: 'conjunction' }).format(parts) })
        : t('pgMigration.foundGeneric');
}

function getEls() {
    return {
        modal: document.getElementById('pgMigrationModal'),
        title: document.getElementById('pgMigrationTitle'),
        desc: document.getElementById('pgMigrationDescription'),
        counts: document.getElementById('pgMigrationCounts'),
        error: document.getElementById('pgMigrationError'),
        importActions: document.getElementById('pgMigrationImportActions'),
        cleanupActions: document.getElementById('pgMigrationCleanupActions'),
        transferBtn: document.getElementById('pgMigrationTransferBtn'),
        skipBtn: document.getElementById('pgMigrationSkipBtn'),
        downloadBtn: document.getElementById('pgLegacyDownloadBtn'),
        removeBtn: document.getElementById('pgLegacyRemoveBtn'),
    };
}

function openModal(els, variant) {
    const cleanup = variant === 'cleanup';
    els.title.textContent = t(cleanup ? 'pgMigration.cleanupTitle' : 'pgMigration.title');
    els.desc.textContent = t(cleanup ? 'pgMigration.cleanupDescription' : 'pgMigration.description');
    els.importActions.classList.toggle('hidden', cleanup);
    els.cleanupActions.classList.toggle('hidden', !cleanup);
    els.error.textContent = '';
    els.error.classList.add('hidden');
    els.modal.classList.add('flex-visible');
    els.modal.classList.remove('hidden');
    const first = cleanup ? els.downloadBtn : els.transferBtn;
    setTimeout(() => first.focus(), 30);
}

// Hides the modal and detaches every handler this call installed.
function makeCloser(els, onKeydown) {
    return () => {
        document.removeEventListener('keydown', onKeydown, true);
        [els.transferBtn, els.skipBtn, els.downloadBtn, els.removeBtn].forEach((b) => { b.onclick = null; });
        els.modal.classList.add('hidden');
        els.modal.classList.remove('flex-visible');
    };
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Saves the raw legacy JSON through a temporary <a download>. A Blob URL is
// same-origin, so it needs no CSP exception.
function downloadLegacyBackup(localJson) {
    const blob = new Blob([localJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `myfinances-browser-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Import variant. Resolves 'imported' | 'declined' | 'failed' | 'dismissed'.
// The key is removed on 'imported' and 'declined' only (declining downloads
// the raw JSON first). A failed transfer
// keeps the modal open (so the user can retry or decline); it resolves
// 'failed' only if the modal is then dismissed with Escape.
export async function showPgMigrationModal(app, localJson) {
    return new Promise((resolve) => {
        const els = getEls();
        if (!els.modal) { resolve('dismissed'); return; }

        let clean;
        try {
            clean = sanitizeParsedState(JSON.parse(localJson));
        } catch {
            removeLegacyKey();
            resolve('declined');
            return;
        }

        let failed = false;
        const onKeydown = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            close();
            resolve(failed ? 'failed' : 'dismissed');
        };
        const close = makeCloser(els, onKeydown);

        els.counts.textContent = buildCountsSummary(clean);

        const setLoading = (isLoading) => {
            els.transferBtn.disabled = isLoading;
            els.skipBtn.disabled = isLoading;
            els.transferBtn.textContent = t(isLoading ? 'pgMigration.transferring' : 'pgMigration.transfer');
        };

        els.transferBtn.onclick = async () => {
            els.error.textContent = '';
            els.error.classList.add('hidden');
            setLoading(true);
            try {
                await replaceForPostgres(app, clean, {
                    paymentStrategy: clean.strategy,
                    monthlyPayment: clean.monthlyPayment,
                });
                removeLegacyKey();
                close();
                resolve('imported');
            } catch (err) {
                console.error('Legacy data transfer failed:', err);
                failed = true;
                setLoading(false);
                els.error.textContent = t('pgMigration.failed');
                els.error.classList.remove('hidden');
                // The button had focus and was disabled while loading, which
                // drops focus to <body> (#490). Put it back so Enter retries
                // and Tab stays inside the dialog; the error is announced by
                // its live region.
                els.transferBtn.focus();
            }
        };
        els.skipBtn.onclick = () => {
            // Declining must not destroy the browser's only copy: save the raw
            // legacy JSON first, then remove the key.
            downloadLegacyBackup(localJson);
            removeLegacyKey();
            close();
            resolve('declined');
        };

        document.addEventListener('keydown', onKeydown, true);
        setLoading(false);
        openModal(els, 'import');
    });
}

// Cleanup variant (server already has data). Resolves 'downloaded' | 'removed'
// | 'dismissed'. Escape keeps the key so the prompt returns next load.
export async function showLegacyDataCleanupModal(localJson) {
    return new Promise((resolve) => {
        const els = getEls();
        if (!els.modal) { resolve('dismissed'); return; }

        const onKeydown = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            close();
            resolve('dismissed');
        };
        const close = makeCloser(els, onKeydown);

        els.counts.textContent = '';
        els.downloadBtn.onclick = () => {
            downloadLegacyBackup(localJson);
            removeLegacyKey();
            close();
            resolve('downloaded');
        };
        els.removeBtn.onclick = () => {
            removeLegacyKey();
            close();
            resolve('removed');
        };

        document.addEventListener('keydown', onKeydown, true);
        openModal(els, 'cleanup');
    });
}
