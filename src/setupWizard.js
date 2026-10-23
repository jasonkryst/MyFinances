// First-run setup wizard and the Settings modal that lets users change their
// choice later. Both are plain static modals following the same
// show/hide-via-classList pattern as reconcileModal etc. (see reconciliation.js).
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE, SHOW_ARCHIVED_DEBTS, SHOW_ARCHIVED_RECURRING, AUTO_NW_SNAPSHOT } from './settings.js';
import { getStorageBackendPreference, setStorageBackendPreference } from './storageAdapters.js';
import { getCurrentLocale, getCurrencyCode, setCurrencyCode } from './i18n.js';
import { getCsrfCookie } from './storage.js';
import { showLoginGate } from './loginGate.js';
import { showEmailTestToast } from './ui.js';

export function maybeShowSetupWizard(app, isFirstRun) {
    if (!isFirstRun) return;
    const modal = document.getElementById('setupWizardModal');
    const adjustBtn = document.getElementById('setupWizardAdjustBtn');
    const visibleBtn = document.getElementById('setupWizardVisibleBtn');
    if (!modal || !adjustBtn || !visibleBtn) return;

    // Persist a default immediately so a page refresh before the user picks an
    // option doesn't re-show the wizard and block the UI again. The default
    // matches the "No, keep visible" button (false = don't auto-adjust).
    setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false);

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        modal.onclick = null;
    };

    const choose = (adjusts) => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjusts);
        close();
    };

    adjustBtn.onclick = () => choose(true);
    visibleBtn.onclick = () => choose(false);
    modal.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    modal.onclick = (event) => { if (event.target === modal) close(); };

    modal.classList.add('flex-visible');
    modal.classList.remove('hidden');
    setTimeout(() => adjustBtn.focus(), 30);
}

function showPgSwitchConfirmModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('pgSwitchConfirmModal');
        const confirmBtn = document.getElementById('pgSwitchConfirmBtn');
        const cancelBtn = document.getElementById('pgSwitchCancelBtn');
        if (!modal) { resolve(false); return; }

        const dismiss = (result) => {
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onkeydown = null;
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
            resolve(result);
        };

        confirmBtn.onclick = () => dismiss(true);
        cancelBtn.onclick = () => dismiss(false);
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); dismiss(false); }
        };

        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        setTimeout(() => cancelBtn.focus(), 30);
    });
}

export function initSettingsModal(app) {
    const modal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsModalCloseBtn');
    const doneBtn = document.getElementById('settingsModalDoneBtn');
    const adjustsCheckbox = document.getElementById('settingReconciliationAdjusts');
    const showArchivedCheckbox = document.getElementById('settingShowArchivedDebts');
    const showArchivedRecurringCheckbox = document.getElementById('settingShowArchivedRecurring');
    const autoNwSnapshotCheckbox = document.getElementById('settingAutoNwSnapshot');
    const storageSelect = document.getElementById('settingStorageBackend');
    const postgresLockNote = document.getElementById('settingsStoragePostgresNote');
    const emailTestGroup = document.getElementById('settingsEmailTestGroup');
    const sendTestEmailBtn = document.getElementById('settingsSendTestEmailBtn');
    const localeSelect = document.getElementById('settingLocale');
    const currencySelect = document.getElementById('settingCurrency');
    if (!modal || !settingsBtn || !closeBtn || !doneBtn || !adjustsCheckbox || !storageSelect || !localeSelect || !currencySelect) return;

    // #322: tabbed layout — same data-attribute/classList pattern as the
    // Data Transfer modal's Export/Import tabs, under its own class
    // namespace (settings-tab-*, not dt-tab-*).
    const tabBtns = modal.querySelectorAll('.settings-tab-btn');
    const tabPanels = modal.querySelectorAll('.settings-tab-panel');
    let activeSettingsTab = 'appearance';
    function showSettingsTab(tab) {
        activeSettingsTab = tab;
        tabBtns.forEach(b => {
            const active = b.getAttribute('data-settings-tab') === tab;
            b.classList.toggle('settings-tab-btn--active', active);
            b.setAttribute('aria-selected', String(active));
        });
        tabPanels.forEach(p => {
            p.classList.toggle('settings-tab-panel--active', p.id === `settingsPanel-${tab}`);
        });
    }
    tabBtns.forEach(btn => btn.addEventListener('click', () => showSettingsTab(btn.getAttribute('data-settings-tab'))));

    let lastFocused = null;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    const open = () => {
        lastFocused = document.activeElement;
        showSettingsTab(activeSettingsTab);
        adjustsCheckbox.checked = Boolean(getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false));
        if (showArchivedCheckbox) showArchivedCheckbox.checked = Boolean(getSetting(app, SHOW_ARCHIVED_DEBTS, false));
        if (showArchivedRecurringCheckbox) showArchivedRecurringCheckbox.checked = Boolean(getSetting(app, SHOW_ARCHIVED_RECURRING, false));
        if (autoNwSnapshotCheckbox) autoNwSnapshotCheckbox.checked = Boolean(getSetting(app, AUTO_NW_SNAPSHOT, false));
        const isPostgres = getStorageBackendPreference() === 'postgres';
        if (isPostgres) {
            storageSelect.value = 'postgres';
            storageSelect.classList.add('hidden');
            if (postgresLockNote) postgresLockNote.classList.remove('hidden');
            if (emailTestGroup) emailTestGroup.classList.remove('hidden');
        } else {
            storageSelect.value = getStorageBackendPreference();
            storageSelect.classList.remove('hidden');
            if (postgresLockNote) postgresLockNote.classList.add('hidden');
            if (emailTestGroup) emailTestGroup.classList.add('hidden');
        }
        localeSelect.value = getCurrentLocale();
        currencySelect.value = getCurrencyCode();
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        setTimeout(() => {
            const panel = modal.querySelector(`#settingsPanel-${activeSettingsTab}`);
            const first = panel ? panel.querySelector('input, select, button, a[href]') : null;
            (first || closeBtn).focus();
        }, 30);
    };

    const save = async () => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
        if (showArchivedCheckbox) setSetting(app, SHOW_ARCHIVED_DEBTS, showArchivedCheckbox.checked);
        if (showArchivedRecurringCheckbox) setSetting(app, SHOW_ARCHIVED_RECURRING, showArchivedRecurringCheckbox.checked);
        if (autoNwSnapshotCheckbox) setSetting(app, AUTO_NW_SNAPSHOT, autoNwSnapshotCheckbox.checked);
        if (storageSelect.value === 'postgres') {
            if (getStorageBackendPreference() !== 'postgres') {
                close();
                const ok = await showPgSwitchConfirmModal();
                if (!ok) return;
                setStorageBackendPreference('postgres');
                location.reload();
            } else {
                app.setLocale(localeSelect.value);
                setCurrencyCode(currencySelect.value);
                app.refreshCurrentPageData();
                close();
            }
            return;
        }
        app.switchStorageBackend(storageSelect.value);
        app.setLocale(localeSelect.value);
        setCurrencyCode(currencySelect.value);
        app.refreshCurrentPageData();
        close();
    };

    settingsBtn.onclick = open;
    closeBtn.onclick = close;
    doneBtn.onclick = save;
    if (sendTestEmailBtn) {
        sendTestEmailBtn.onclick = async () => {
            sendTestEmailBtn.disabled = true;
            try {
                const res = await fetch('/api/notifications/test-email', {
                    method: 'POST',
                    headers: { 'X-CSRF-Token': getCsrfCookie() }
                });
                if (res.status === 401) {
                    await showLoginGate(app);
                    return;
                }
                if (res.status === 200) {
                    showEmailTestToast('success', 'Test email sent — check your inbox.');
                } else if (res.status === 503) {
                    showEmailTestToast('info', "SMTP isn't configured on this server.");
                } else if (res.status === 429) {
                    showEmailTestToast('info', 'Too many requests — try again in a few minutes.');
                } else {
                    showEmailTestToast('error', 'Failed to send test email.');
                }
            } catch {
                showEmailTestToast('error', 'Failed to send test email.');
            } finally {
                sendTestEmailBtn.disabled = false;
            }
        };
    }
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };
}


