// Settings -> Notifications (#211): the alert preferences form. Loaded when
// Settings opens and saved with Done (setupWizard.js), like every other
// setting; only values that changed are written. "Check now" saves first,
// then asks the server to run this user's check right away.

import {
    setSetting,
    NOTIFY_BILL_DUE, NOTIFY_LOW_BALANCE, NOTIFY_ZERO_BALANCE, NOTIFY_PROJECTED_LOW,
    NOTIFY_DAYS_AHEAD, NOTIFY_DAYS_AHEAD_MAX, NOTIFY_CHANNEL, NOTIFY_DELIVERY,
} from './settings.js';
import { getNotificationPrefs } from './notificationsCore.js';
import { getNotificationsState, refreshNotifications, runNotificationCheck } from './notificationsCenter.js';
import { plural, t } from './i18n.js';
import { pendingWriteCount, WRITES_CHANGED_EVENT } from './postgresSync.js';

// Resolves once no write is pending (or after `timeoutMs`), so "Check now"
// runs against the preferences just saved.
function writesSettled(timeoutMs = 5000) {
    if (pendingWriteCount() === 0) return Promise.resolve();
    return new Promise(resolve => {
        const done = () => {
            window.removeEventListener(WRITES_CHANGED_EVENT, onChange);
            clearTimeout(timer);
            resolve();
        };
        const onChange = () => { if (pendingWriteCount() === 0) done(); };
        const timer = setTimeout(done, timeoutMs);
        window.addEventListener(WRITES_CHANGED_EVENT, onChange);
    });
}

const TOGGLES = [
    ['settingNotifyBillDue', NOTIFY_BILL_DUE, 'billDue'],
    ['settingNotifyLowBalance', NOTIFY_LOW_BALANCE, 'lowBalance'],
    ['settingNotifyZeroBalance', NOTIFY_ZERO_BALANCE, 'zeroBalance'],
    ['settingNotifyProjectedLow', NOTIFY_PROJECTED_LOW, 'projectedLow'],
];

const el = id => document.getElementById(id);

// A whole number 0..NOTIFY_DAYS_AHEAD_MAX, or null when the input is invalid.
export function parseDaysAhead(raw) {
    const s = String(raw ?? '').trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n <= NOTIFY_DAYS_AHEAD_MAX ? n : null;
}

function showEmailNote() {
    const note = el('settingNotifyEmailOff');
    if (!note) return;
    const { loaded, emailConfigured } = getNotificationsState();
    note.classList.toggle('hidden', !loaded || emailConfigured);
}

function setDaysError(visible) {
    el('settingNotifyDaysAheadError')?.classList.toggle('hidden', !visible);
    el('settingNotifyDaysAhead')?.setAttribute('aria-invalid', visible ? 'true' : 'false');
}

export function loadNotificationSettingsForm(app) {
    const prefs = getNotificationPrefs(app.settings);
    for (const [id, , field] of TOGGLES) {
        const box = el(id);
        if (box) box.checked = prefs[field];
    }
    if (el('settingNotifyDaysAhead')) el('settingNotifyDaysAhead').value = String(prefs.daysAhead);
    if (el('settingNotifyChannel')) el('settingNotifyChannel').value = prefs.channel;
    if (el('settingNotifyDelivery')) el('settingNotifyDelivery').value = prefs.delivery;
    if (el('settingNotifyCheckStatus')) el('settingNotifyCheckStatus').textContent = '';
    setDaysError(false);
    showEmailNote();
    refreshNotifications().then(showEmailNote);
}

// Writes the values that differ from what is stored. An invalid "Days ahead"
// saves nothing: it shows the field's error and returns false.
export function saveNotificationSettingsForm(app) {
    const daysInput = el('settingNotifyDaysAhead');
    const days = daysInput ? parseDaysAhead(daysInput.value) : undefined;
    if (days === null) {
        setDaysError(true);
        return false;
    }
    setDaysError(false);
    const prefs = getNotificationPrefs(app.settings);
    const write = (key, value, current) => {
        if (value !== current) setSetting(app, key, value);
    };
    for (const [id, key, field] of TOGGLES) {
        const box = el(id);
        if (box) write(key, box.checked, prefs[field]);
    }
    if (days !== undefined) write(NOTIFY_DAYS_AHEAD, days, prefs.daysAhead);
    const channel = el('settingNotifyChannel')?.value;
    if (channel) write(NOTIFY_CHANNEL, channel, prefs.channel);
    const delivery = el('settingNotifyDelivery')?.value;
    if (delivery) write(NOTIFY_DELIVERY, delivery, prefs.delivery);
    return true;
}

export function initNotificationSettings(app) {
    const btn = el('settingNotifyCheckNowBtn');
    const status = el('settingNotifyCheckStatus');
    if (!btn || !status) return;
    btn.addEventListener('click', async () => {
        if (!saveNotificationSettingsForm(app)) return;
        btn.disabled = true;
        status.textContent = t('settings.notify.checking');
        try {
            await writesSettled();
            const result = await runNotificationCheck();
            const created = Number(result?.created) || 0;
            status.textContent = created > 0
                ? plural('settings.notify.checkResult', created, { count: created })
                : t('settings.notify.checkNone');
        } catch {
            status.textContent = t('settings.notify.checkFailed');
        } finally {
            btn.disabled = false;
        }
    });
}
