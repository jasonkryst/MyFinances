import { updateAccountMenuEmail } from './ui.js';
import { t, plural } from './i18n.js';
import { parseRetryAfterMinutes, markFieldInvalid, clearFieldInvalid } from './utils.js';
import {
    attachPasswordStrengthMeter, newPasswordError, newPasswordErrorKind, passwordResponseMessage, showBreachCheckNote
} from './passwordUi.js';
import { makeBackgroundInert, rememberFocus, restoreFocus } from './overlayFocus.js';

// All gate text is localized (#456): static labels via data-i18n in
// index.html, dynamic messages via t() here. The strength meter is attached
// only where a password is *set* (first-run setup, reset link), never to the
// sign-in form.

// A 429's message, with the minutes left when the server says (Retry-After,
// or RateLimit-Reset): "Too many attempts. Try again in 12 minutes."
export function tooManyAttemptsMessage(res) {
    const headers = res?.headers;
    const minutes = headers
        ? parseRetryAfterMinutes(headers.get('Retry-After') ?? headers.get('RateLimit-Reset'))
        : null;
    return minutes ? plural('login.tooManyAttemptsIn', minutes, { count: minutes }) : t('login.tooManyAttempts');
}

// `options.needsSetup` (boolean) skips the setup-status request when the
// caller already knows the answer: init()'s probeServer() just asked, and that
// route is rate-limited (20 requests per 15 minutes).
// One shared in-flight login request: several saves failing with 401 at once
// must open a single gate (one set of handlers, one setup-status request).
// showLoginGate resolves after sign-in, which clears the slot.
let _loginPromise = null;
// Every caller must go through here (never showLoginGate directly): a second
// showLoginGate while a gate is open replaces form.onsubmit, so the first
// promise would never resolve. `options` is forwarded to showLoginGate.
export function requestLogin(app, options = {}) {
    if (!_loginPromise) {
        // #491: after a mid-session sign-in, return focus to the control the
        // user was on (it may still be disabled while its save is retried;
        // restoreFocus waits for it). At boot there's nothing to return to.
        const returnTo = rememberFocus(document.getElementById('loginGate'));
        _loginPromise = showLoginGate(app, options).finally(() => { _loginPromise = null; });
        _loginPromise.then(() => restoreFocus(returnTo), () => {});
    }
    return _loginPromise;
}

export async function showLoginGate(app, options = {}) {
    let needsSetup = false;
    if (typeof options.needsSetup === 'boolean') {
        needsSetup = options.needsSetup;
    } else {
        try {
            const statusRes = await fetch('/auth/setup-status');
            if (statusRes.ok) {
                const data = await statusRes.json();
                needsSetup = data.needsSetup === true;
            }
        } catch (err) {
            console.error('[loginGate] setup-status fetch error:', err);
        }
    }

    const gate = document.getElementById('loginGate');
    const form = document.getElementById('loginGateForm');
    const emailInput = document.getElementById('loginGateEmail');
    const passwordInput = document.getElementById('loginGatePassword');
    const confirmGroup = document.getElementById('loginGateConfirmGroup');
    const confirmInput = document.getElementById('loginGateConfirm');
    const subtitleEl = document.getElementById('loginGateSubtitle');
    const submitBtn = document.getElementById('loginGateSubmit');
    const errorEl = document.getElementById('loginGateError');

    const forgotLink = document.getElementById('loginGateForgotLink');
    const forgotBtn = document.getElementById('loginGateForgotBtn');
    const forgotForm = document.getElementById('loginGateForgotForm');
    const forgotEmailInput = document.getElementById('loginGateForgotEmail');
    const forgotError = document.getElementById('loginGateForgotError');
    const forgotBack = document.getElementById('loginGateForgotBack');
    const resetForm = document.getElementById('loginGateResetForm');
    const resetPassword = document.getElementById('loginGateResetPassword');
    const resetConfirm = document.getElementById('loginGateResetConfirm');
    const resetError = document.getElementById('loginGateResetError');

    // Determine initial mode from URL
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token');

    function showMode(mode) {
        const loginVisible = mode === 'login';
        const forgotVisible = mode === 'forgot';
        const resetVisible = mode === 'reset';
        form.classList.toggle('hidden', !loginVisible);
        if (forgotLink) forgotLink.classList.toggle('hidden', !loginVisible);
        if (forgotForm) forgotForm.classList.toggle('hidden', !forgotVisible);
        if (resetForm) resetForm.classList.toggle('hidden', !resetVisible);
    }

    if (needsSetup) {
        subtitleEl.textContent = t('login.subtitleCreate');
        confirmGroup.classList.remove('hidden');
        confirmInput.required = true;
        submitBtn.textContent = t('login.createAccount');
        passwordInput.autocomplete = 'new-password';
        attachPasswordStrengthMeter(passwordInput, { getEmail: () => emailInput.value });
        showBreachCheckNote(document.getElementById('loginGateSetupBreachNote'));
    }
    if (resetToken && resetPassword) {
        attachPasswordStrengthMeter(resetPassword);
        showBreachCheckNote(document.getElementById('loginGateResetBreachNote'));
    }

    showMode(resetToken ? 'reset' : 'login');

    // #499: a fresh gate starts with no field marked invalid.
    for (const [field, err] of [[emailInput, errorEl], [passwordInput, errorEl], [confirmInput, errorEl],
        [forgotEmailInput, forgotError], [resetPassword, resetError], [resetConfirm, resetError]]) {
        clearFieldInvalid(field, err);
    }

    gate.classList.add('flex-visible');
    gate.classList.remove('hidden');
    // #464: nothing behind the gate is reachable by Tab or screen readers.
    const releaseBackground = makeBackgroundInert(gate);
    setTimeout(() => (resetToken ? resetPassword?.focus() : emailInput.focus()), 0);

    // Forgot-password toggle
    if (forgotBtn) {
        forgotBtn.addEventListener('click', () => {
            showMode('forgot');
            setTimeout(() => forgotEmailInput?.focus(), 0);
        });
    }
    if (forgotBack) {
        forgotBack.addEventListener('click', () => {
            showMode('login');
            setTimeout(() => emailInput.focus(), 0);
        });
    }

    // Forgot-password form submission — always shows confirmation, never reveals account existence
    if (forgotForm) {
        forgotForm.onsubmit = async (e) => {
            e.preventDefault();
            if (forgotError) forgotError.textContent = '';
            clearFieldInvalid(forgotEmailInput, forgotError);
            const email = forgotEmailInput?.value?.trim() || '';
            if (!email || !email.includes('@')) {
                if (forgotError) forgotError.textContent = t('login.invalidEmail');
                markFieldInvalid(forgotEmailInput, forgotError);
                return;
            }
            const submitBtn = forgotForm.querySelector('[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            let res;
            try {
                res = await fetch('/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
            } catch (_) { /* ignore network errors — always show success */ }
            if (res?.status === 429) {
                if (forgotError) forgotError.textContent = tooManyAttemptsMessage(res);
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
            const msg = document.createElement('p');
            msg.textContent = t('login.resetSent');
            forgotForm.replaceChildren(msg);
        };
    }

    // Reset-password form submission
    if (resetForm && resetToken) {
        resetForm.onsubmit = async (e) => {
            e.preventDefault();
            if (resetError) resetError.textContent = '';
            clearFieldInvalid(resetPassword, resetError);
            clearFieldInvalid(resetConfirm, resetError);
            const clientError = newPasswordError(resetPassword.value, resetConfirm.value);
            if (clientError) {
                if (resetError) resetError.textContent = clientError;
                markFieldInvalid(newPasswordErrorKind(resetPassword.value, resetConfirm.value) === 'mismatch'
                    ? resetConfirm : resetPassword, resetError);
                return;
            }
            const submitBtn = resetForm.querySelector('[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            let res;
            try {
                res = await fetch('/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: resetToken, newPassword: resetPassword.value })
                });
            } catch (_) {
                if (resetError) resetError.textContent = t('login.networkError');
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                if (resetError) {
                    resetError.textContent = res.status === 429
                        ? tooManyAttemptsMessage(res)
                        : passwordResponseMessage(body, 'login.resetFailed');
                    if (res.status !== 429 && body?.error?.reason) markFieldInvalid(resetPassword, resetError);
                }
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
            window.history.replaceState({}, '', window.location.pathname);
            const successMsg = document.createElement('p');
            successMsg.textContent = t('login.resetSuccess');
            resetForm.replaceChildren(successMsg);
            setTimeout(() => showMode('login'), 2000);
        };
    }

    await new Promise((resolve) => {
        form.onsubmit = async (event) => {
            event.preventDefault();
            errorEl.textContent = '';
            for (const field of [emailInput, passwordInput, confirmInput]) clearFieldInvalid(field, errorEl);
            submitBtn.disabled = true;

            if (needsSetup) {
                const clientError = newPasswordError(passwordInput.value, confirmInput.value, emailInput.value);
                if (clientError) {
                    errorEl.textContent = clientError;
                    markFieldInvalid(newPasswordErrorKind(passwordInput.value, confirmInput.value, emailInput.value) === 'mismatch'
                        ? confirmInput : passwordInput, errorEl);
                    submitBtn.disabled = false;
                    return;
                }
                let res;
                try {
                    res = await fetch('/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value })
                    });
                } catch (err) {
                    console.error('[loginGate] register fetch error:', err);
                    errorEl.textContent = t('login.networkError');
                    submitBtn.disabled = false;
                    return;
                }
                if (!res.ok) {
                    if (res.status === 429) {
                        errorEl.textContent = tooManyAttemptsMessage(res);
                    } else if (res.status === 409) {
                        errorEl.textContent = t('login.accountExists');
                        markFieldInvalid(emailInput, errorEl);
                    } else {
                        const body = await res.json().catch(() => ({}));
                        errorEl.textContent = passwordResponseMessage(body, 'login.createFailed');
                        if (body?.error?.reason) markFieldInvalid(passwordInput, errorEl);
                    }
                    submitBtn.disabled = false;
                    return;
                }
            } else {
                let res;
                try {
                    res = await fetch('/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value })
                    });
                } catch (err) {
                    console.error('[loginGate] fetch error:', err);
                    errorEl.textContent = t('login.networkError');
                    submitBtn.disabled = false;
                    return;
                }
                console.warn('[loginGate] /auth/login status:', res.status);
                if (!res.ok) {
                    if (res.status === 429) {
                        errorEl.textContent = tooManyAttemptsMessage(res);
                    } else {
                        errorEl.textContent = t('login.invalidCredentials');
                        // The message doesn't say which of the two was wrong
                        // (no account enumeration); the password is the field
                        // the user retypes.
                        markFieldInvalid(passwordInput, errorEl);
                    }
                    submitBtn.disabled = false;
                    return;
                }
            }

            form.onsubmit = null;
            for (const field of [emailInput, passwordInput, confirmInput]) clearFieldInvalid(field, errorEl);
            gate.classList.add('hidden');
            gate.classList.remove('flex-visible');
            releaseBackground();
            // Store the logged-in email so the account menu can display it
            if (app && emailInput.value) {
                app.userEmail = emailInput.value.trim();
                updateAccountMenuEmail(app);
            }
            resolve();
        };
    });
}
