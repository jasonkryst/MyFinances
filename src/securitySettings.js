// Settings -> Security tab (issue #456): change password while signed in.
// The app always runs against the PostgreSQL server (v7.0.0), so the form is
// always shown.
import { t } from './i18n.js';
import { getCsrfCookie, discardBody } from './storage.js';
import { requestLogin } from './loginGate.js';
import {
    attachPasswordStrengthMeter, newPasswordError, passwordResponseMessage, showBreachCheckNote
} from './passwordUi.js';

let meter = null;

function els() {
    return {
        form: document.getElementById('settingsChangePasswordForm'),
        username: document.getElementById('settingsSecurityUsername'),
        current: document.getElementById('settingsCurrentPassword'),
        next: document.getElementById('settingsNewPassword'),
        confirm: document.getElementById('settingsConfirmPassword'),
        error: document.getElementById('settingsChangePasswordError'),
        status: document.getElementById('settingsChangePasswordStatus'),
        submit: document.getElementById('settingsChangePasswordBtn'),
        breachNote: document.getElementById('settingsSecurityBreachNote')
    };
}

function clearFields(e) {
    e.current.value = '';
    e.confirm.value = '';
    if (meter) meter.reset(); else e.next.value = '';
}

// Called each time the Settings modal opens: wipes any password left in the
// fields from a previous visit.
export function refreshSecuritySettingsPanel(app) {
    const e = els();
    if (!e.form) return;
    if (e.username) e.username.value = app?.userEmail || '';
    e.error.textContent = '';
    e.status.textContent = '';
    clearFields(e);
    showBreachCheckNote(e.breachNote);
}

export function initSecuritySettings(app) {
    const e = els();
    if (!e.form || !e.current || !e.next || !e.confirm || !e.submit) return;
    meter = attachPasswordStrengthMeter(e.next, { getEmail: () => app?.userEmail || '' });

    e.form.addEventListener('submit', async (event) => {
        event.preventDefault();
        e.error.textContent = '';
        e.status.textContent = '';
        if (!e.current.value) {
            e.error.textContent = t('settings.security.currentRequired');
            e.current.focus();
            return;
        }
        const clientError = newPasswordError(e.next.value, e.confirm.value, app?.userEmail || '');
        if (clientError) {
            e.error.textContent = clientError;
            e.next.focus();
            return;
        }
        if (e.next.value === e.current.value) {
            e.error.textContent = t('password.reason.unchanged');
            e.next.focus();
            return;
        }

        e.submit.disabled = true;
        try {
            let res;
            try {
                res = await fetch('/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfCookie() },
                    body: JSON.stringify({ currentPassword: e.current.value, newPassword: e.next.value })
                });
            } catch {
                e.error.textContent = t('login.networkError');
                return;
            }
            if (res.ok) {
                await discardBody(res);
                clearFields(e);
                e.status.textContent = t('settings.security.success');
                return;
            }
            if (res.status === 401) {
                await discardBody(res);
                await requestLogin(app);
                return;
            }
            const body = await res.json().catch(() => ({}));
            if (res.status === 429) {
                e.error.textContent = t('login.tooManyAttempts');
            } else if (body?.error?.code === 'INVALID_CURRENT_PASSWORD') {
                e.error.textContent = t('settings.security.wrongCurrent');
                e.current.value = '';
                e.current.focus();
            } else {
                e.error.textContent = passwordResponseMessage(body, 'settings.security.failed');
            }
        } finally {
            e.submit.disabled = false;
        }
    });
}
