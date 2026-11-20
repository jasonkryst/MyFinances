// First-run setup wizard and the Settings modal that lets users change their
// choice later. Both are plain static modals following the same
// show/hide-via-classList pattern as reconcileModal etc. (see reconciliation.js).
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE, SHOW_ARCHIVED_DEBTS, SHOW_ARCHIVED_RECURRING, AUTO_NW_SNAPSHOT, ZERO_AMOUNT_POLICY, getZeroAmountPolicy } from './settings.js';
import { getCurrentLocale, getCurrencyCode, setCurrencyCode } from './i18n.js';
import { getCsrfCookie, discardBody } from './storage.js';
import { requestLogin } from './loginGate.js';
import { showEmailTestToast, openWhatsNewModal } from './ui.js';
import { initSettingsBackup } from './settingsBackup.js';
import { initSecuritySettings, refreshSecuritySettingsPanel } from './securitySettings.js';
import { initNotificationSettings, loadNotificationSettingsForm } from './notificationSettings.js';
import { resetBackupPage } from './dataTransferModal.js';
import { initSettingsNav, showSettingsPage, showSettingsListQuiet, handleSettingsEscape, isSettingsNarrow, getActiveSettingsPage, refreshSettingsRowValues } from './settingsNav.js';
import { APP_VERSION } from './utils.js';

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

let openSettingsImpl = null;

// Opens Settings; `page` selects a page (a deep link). With no page, wide
// screens show the last page used this session and narrow ones the list.
export function openSettings(app, opts = {}) {
    if (openSettingsImpl) openSettingsImpl(opts && opts.page);
}

export function initSettingsModal(app) {
    const modal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsModalCloseBtn');
    const adjustsCheckbox = document.getElementById('settingReconciliationAdjusts');
    const showArchivedCheckbox = document.getElementById('settingShowArchivedDebts');
    const showArchivedRecurringCheckbox = document.getElementById('settingShowArchivedRecurring');
    const autoNwSnapshotCheckbox = document.getElementById('settingAutoNwSnapshot');
    const zeroPolicySelect = document.getElementById('settingZeroAmountPolicy');
    const sendTestEmailBtn = document.getElementById('settingsSendTestEmailBtn');
    const localeSelect = document.getElementById('settingLocale');
    const currencySelect = document.getElementById('settingCurrency');
    const themeSelect = document.getElementById('themeSwitcher');
    if (!modal || !settingsBtn || !closeBtn || !adjustsCheckbox || !localeSelect || !currencySelect) return;

    initSettingsBackup(app);
    initSecuritySettings(app);
    initNotificationSettings(app);
    initSettingsNav(modal);

    const versionEl = document.getElementById('settingsAboutVersion');
    if (versionEl) versionEl.textContent = APP_VERSION;

    let lastFocused = null;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    const open = (page) => {
        lastFocused = document.activeElement;
        adjustsCheckbox.checked = Boolean(getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false));
        if (showArchivedCheckbox) showArchivedCheckbox.checked = Boolean(getSetting(app, SHOW_ARCHIVED_DEBTS, false));
        if (showArchivedRecurringCheckbox) showArchivedRecurringCheckbox.checked = Boolean(getSetting(app, SHOW_ARCHIVED_RECURRING, false));
        if (autoNwSnapshotCheckbox) autoNwSnapshotCheckbox.checked = Boolean(getSetting(app, AUTO_NW_SNAPSHOT, false));
        if (zeroPolicySelect) zeroPolicySelect.value = getZeroAmountPolicy(app);
        refreshSecuritySettingsPanel(app);
        loadNotificationSettingsForm(app);
        localeSelect.value = getCurrentLocale();
        currencySelect.value = getCurrencyCode();
        refreshSettingsRowValues();
        resetBackupPage();
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        if (page) showSettingsPage(page, { focus: false });
        else if (isSettingsNarrow()) showSettingsListQuiet();
        else showSettingsPage(getActiveSettingsPage(), { focus: false });
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!handleSettingsEscape()) close();
            }
        };
        // Focus right away (the modal is already displayed), so Tab pressed
        // immediately after opening is inside the dialog.
        const target = (page || !isSettingsNarrow())
            ? document.getElementById(`settingsPageTitle-${getActiveSettingsPage()}`)
            : modal.querySelector('.settings-row');
        (target || closeBtn).focus();
    };
    openSettingsImpl = open;

    // Every control saves on change; there is no Done button (7.20.0).
    // A setting can change what a page shows (archived items, reconciliation
    // mode, $0 policy), so the open page re-renders in place, as Done used to.
    const onSetting = (el, key, read) => {
        if (el) el.addEventListener('change', () => {
            setSetting(app, key, read(el));
            app.refreshCurrentPageData();
        });
    };
    onSetting(adjustsCheckbox, RECONCILIATION_ADJUSTS_BALANCE, el => el.checked);
    onSetting(showArchivedCheckbox, SHOW_ARCHIVED_DEBTS, el => el.checked);
    onSetting(showArchivedRecurringCheckbox, SHOW_ARCHIVED_RECURRING, el => el.checked);
    onSetting(autoNwSnapshotCheckbox, AUTO_NW_SNAPSHOT, el => el.checked);
    onSetting(zeroPolicySelect, ZERO_AMOUNT_POLICY, el => el.value);
    localeSelect.addEventListener('change', () => {
        app.setLocale(localeSelect.value);
        refreshSettingsRowValues();
        localeSelect.focus();
    });
    currencySelect.addEventListener('change', () => {
        setCurrencyCode(currencySelect.value);
        app.refreshCurrentPageData();
        refreshSettingsRowValues();
    });
    if (themeSelect) themeSelect.addEventListener('change', refreshSettingsRowValues);

    const whatsNewBtn = document.getElementById('settingsAboutWhatsNewBtn');
    if (whatsNewBtn) whatsNewBtn.addEventListener('click', () => openWhatsNewModal());
    const shortcutsBtn = document.getElementById('settingsAboutShortcutsBtn');
    if (shortcutsBtn) shortcutsBtn.addEventListener('click', () => app.openKeyboardShortcuts());

    settingsBtn.onclick = () => openSettings(app);
    closeBtn.onclick = close;
    if (sendTestEmailBtn) {
        sendTestEmailBtn.onclick = async () => {
            sendTestEmailBtn.disabled = true;
            try {
                const res = await fetch('/api/notifications/test-email', {
                    method: 'POST',
                    headers: { 'X-CSRF-Token': getCsrfCookie() }
                });
                await discardBody(res);
                if (res.status === 401) {
                    await requestLogin(app);
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


