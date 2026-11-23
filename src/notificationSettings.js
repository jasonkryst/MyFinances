// Settings -> Notifications (#211): the alert preferences form. Loaded when
// Settings opens; each control saves on change and only a changed value is
// written. "Check now" asks the server to run this user's check right away.

import {
    setSetting,
    NOTIFY_BILL_DUE, NOTIFY_LOW_BALANCE, NOTIFY_ZERO_BALANCE, NOTIFY_PROJECTED_LOW, NOTIFY_PROMO_ENDING,
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
    ['settingNotifyPromoEnding', NOTIFY_PROMO_ENDING, 'promoEnding'],
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

// Writes one control's value when it differs from what is stored (each control
// saves on change). An invalid "Days ahead" writes nothing: it shows the
// field's error and returns false; a valid one clears the error.
export function saveNotificationField(app, id) {
    const prefs = getNotificationPrefs(app.settings);
    const write = (key, value, current) => {
        if (value !== current) setSetting(app, key, value);
    };
    const toggle = TOGGLES.find(([tid]) => tid === id);
    if (toggle) {
        const box = el(id);
        if (box) write(toggle[1], box.checked, prefs[toggle[2]]);
        return true;
    }
    if (id === 'settingNotifyDaysAhead') {
        const input = el(id);
        if (!input) return true;
        const days = parseDaysAhead(input.value);
        if (days === null) {
            setDaysError(true);
            return false;
        }
        setDaysError(false);
        write(NOTIFY_DAYS_AHEAD, days, prefs.daysAhead);
        return true;
    }
    if (id === 'settingNotifyChannel') {
        const v = el(id)?.value;
        if (v) write(NOTIFY_CHANNEL, v, prefs.channel);
        return true;
    }
    if (id === 'settingNotifyDelivery') {
        const v = el(id)?.value;
        if (v) write(NOTIFY_DELIVERY, v, prefs.delivery);
        return true;
    }
    return true;
}

export function initNotificationSettings(app) {
    for (const id of ['settingNotifyBillDue', 'settingNotifyLowBalance', 'settingNotifyZeroBalance', 'settingNotifyProjectedLow', 'settingNotifyPromoEnding',
        'settingNotifyDaysAhead', 'settingNotifyChannel', 'settingNotifyDelivery']) {
        el(id)?.addEventListener('change', () => saveNotificationField(app, id));
    }
    // Days ahead shows its error while typing; it writes only on change, once valid.
    el('settingNotifyDaysAhead')?.addEventListener('input', () => {
        setDaysError(parseDaysAhead(el('settingNotifyDaysAhead').value) === null);
    });
    const btn = el('settingNotifyCheckNowBtn');
    const status = el('settingNotifyCheckStatus');
    if (!btn || !status) return;
    btn.addEventListener('click', async () => {
        if (!saveNotificationField(app, 'settingNotifyDaysAhead')) return;
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
