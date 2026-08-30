import { sanitizeParsedState } from './sanitizers.js';
import { replaceForPostgres } from './postgresImport.js';

function buildCountsSummary(clean) {
    const parts = [
        [clean.debts, 'debt'],
        [clean.accounts, 'account'],
        [clean.incomes, 'income record'],
        [clean.bills, 'bill'],
        [clean.expenses, 'expense'],
        [clean.recurringTemplates, 'recurring template'],
        [clean.emergencyFunds, 'emergency fund'],
        [clean.sinkingFunds, 'sinking fund'],
    ]
        .filter(([arr]) => arr?.length)
        .map(([arr, label]) => `${arr.length} ${label}${arr.length !== 1 ? 's' : ''}`);
    return parts.length ? `Found: ${parts.join(', ')}.` : 'Found existing local data.';
}

export async function showPgMigrationModal(app, localJson) {
    return new Promise((resolve) => {
        const modal = document.getElementById('pgMigrationModal');
        const countsEl = document.getElementById('pgMigrationCounts');
        const errorEl = document.getElementById('pgMigrationError');
        const transferBtn = document.getElementById('pgMigrationTransferBtn');
        const skipBtn = document.getElementById('pgMigrationSkipBtn');

        if (!modal) { resolve(); return; }

        let clean;
        try {
            clean = sanitizeParsedState(JSON.parse(localJson));
        } catch {
            resolve();
            return;
        }

        countsEl.textContent = buildCountsSummary(clean);

        const showError = (msg) => {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
        };
        const clearError = () => {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
        };
        const setLoading = (isLoading) => {
            transferBtn.disabled = isLoading;
            skipBtn.disabled = isLoading;
            transferBtn.textContent = isLoading ? 'Transferring\u2026' : 'Transfer Data';
        };
        const dismiss = () => {
            transferBtn.onclick = null;
            skipBtn.onclick = null;
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
        };

        const doTransfer = async () => {
            clearError();
            setLoading(true);
            try {
                await replaceForPostgres(app, clean, {
                    paymentStrategy: clean.strategy,
                    monthlyPayment: clean.monthlyPayment
                });
                window.localStorage.removeItem('debtTrackerData');
                dismiss();
                resolve();
            } catch {
                setLoading(false);
                showError('Transfer failed. Check your connection and try again.');
            }
        };

        transferBtn.onclick = doTransfer;
        skipBtn.onclick = () => { dismiss(); resolve(); };

        clearError();
        setLoading(false);
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        setTimeout(() => transferBtn.focus(), 30);
    });
}
