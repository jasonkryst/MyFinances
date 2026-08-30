// First-run setup wizard and the Settings modal that lets users change their
// choice later. Both are plain static modals following the same
// show/hide-via-classList pattern as reconcileModal etc. (see reconciliation.js).
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { getStorageBackendPreference, setStorageBackendPreference } from './storageAdapters.js';
import { getCurrentLocale } from './i18n.js';

export function maybeShowSetupWizard(app, isFirstRun) {
    if (!isFirstRun) return;
    const modal = document.getElementById('setupWizardModal');
    const adjustBtn = document.getElementById('setupWizardAdjustBtn');
    const visibleBtn = document.getElementById('setupWizardVisibleBtn');
    if (!modal || !adjustBtn || !visibleBtn) return;

    const choose = (adjusts) => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjusts);
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
    };

    adjustBtn.onclick = () => choose(true);
    visibleBtn.onclick = () => choose(false);

    modal.classList.add('flex-visible');
    modal.classList.remove('hidden');
    setTimeout(() => adjustBtn.focus(), 30);
}

export function initSettingsModal(app) {
    const modal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsModalCloseBtn');
    const doneBtn = document.getElementById('settingsModalDoneBtn');
    const adjustsCheckbox = document.getElementById('settingReconciliationAdjusts');
    const storageSelect = document.getElementById('settingStorageBackend');
    const postgresLockNote = document.getElementById('settingsStoragePostgresNote');
    const localeSelect = document.getElementById('settingLocale');
    if (!modal || !settingsBtn || !closeBtn || !doneBtn || !adjustsCheckbox || !storageSelect || !localeSelect) return;

    let lastFocused = null;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    const open = () => {
        lastFocused = document.activeElement;
        adjustsCheckbox.checked = Boolean(getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false));
        const isPostgres = getStorageBackendPreference() === 'postgres';
        if (isPostgres) {
            storageSelect.value = 'postgres';
            storageSelect.classList.add('hidden');
            if (postgresLockNote) postgresLockNote.classList.remove('hidden');
        } else {
            storageSelect.value = getStorageBackendPreference();
            storageSelect.classList.remove('hidden');
            if (postgresLockNote) postgresLockNote.classList.add('hidden');
        }
        localeSelect.value = getCurrentLocale();
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        setTimeout(() => adjustsCheckbox.focus(), 30);
    };

    const save = () => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
        if (storageSelect.value === 'postgres') {
            if (getStorageBackendPreference() !== 'postgres') {
                const ok = window.confirm(
                    'Switching to PostgreSQL is permanent.\n\n' +
                    'Once switched, you will not be able to switch back to local or session storage. ' +
                    'Any existing local data can be transferred to the server on your next login.\n\n' +
                    'Continue?'
                );
                if (!ok) return;
                setStorageBackendPreference('postgres');
                location.reload();
            } else {
                app.setLocale(localeSelect.value);
                close();
            }
            return;
        }
        app.switchStorageBackend(storageSelect.value);
        app.setLocale(localeSelect.value);
        close();
    };

    settingsBtn.onclick = open;
    closeBtn.onclick = close;
    doneBtn.onclick = save;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };
}


