export async function showLoginGate(app) {
    let needsSetup = false;
    try {
        const statusRes = await fetch('/auth/setup-status');
        if (statusRes.ok) {
            const data = await statusRes.json();
            needsSetup = data.needsSetup === true;
        }
    } catch (err) {
        console.error('[loginGate] setup-status fetch error:', err);
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
        subtitleEl.textContent = 'Create your account';
        confirmGroup.classList.remove('hidden');
        confirmInput.required = true;
        submitBtn.textContent = 'Create Account';
        passwordInput.autocomplete = 'new-password';
    }

    showMode(resetToken ? 'reset' : 'login');

    gate.classList.add('flex-visible');
    gate.classList.remove('hidden');
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
            try {
                await fetch('/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: forgotEmailInput?.value || '' })
                });
            } catch (_) { /* ignore network errors — always show success */ }
            const msg = document.createElement('p');
            msg.textContent = 'If that email has an account, a reset link is on its way. Check your inbox.';
            forgotForm.replaceChildren(msg);
        };
    }

    // Reset-password form submission
    if (resetForm && resetToken) {
        resetForm.onsubmit = async (e) => {
            e.preventDefault();
            if (resetError) resetError.textContent = '';
            if (resetPassword.value !== resetConfirm.value) {
                if (resetError) resetError.textContent = 'Passwords do not match.';
                return;
            }
            let res;
            try {
                res = await fetch('/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: resetToken, newPassword: resetPassword.value })
                });
            } catch (_) {
                if (resetError) resetError.textContent = 'Could not reach the server. Check your connection.';
                return;
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                if (resetError) resetError.textContent = body?.error?.message || 'Reset failed. The link may have expired.';
                return;
            }
            window.history.replaceState({}, '', window.location.pathname);
            const successMsg = document.createElement('p');
            successMsg.textContent = 'Password updated successfully. You can now sign in.';
            resetForm.replaceChildren(successMsg);
            setTimeout(() => showMode('login'), 2000);
        };
    }

    await new Promise((resolve) => {
        form.onsubmit = async (event) => {
            event.preventDefault();
            errorEl.textContent = '';

            if (needsSetup) {
                if (passwordInput.value.length < 12) {
                    errorEl.textContent = 'Password must be at least 12 characters.';
                    return;
                }
                if (passwordInput.value !== confirmInput.value) {
                    errorEl.textContent = 'Passwords do not match.';
                    return;
                }
                let res;
                try {
                    res = await fetch('/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: emailInput.value, password: passwordInput.value })
                    });
                } catch (err) {
                    console.error('[loginGate] register fetch error:', err);
                    errorEl.textContent = 'Could not reach the server. Check your connection.';
                    return;
                }
                if (!res.ok) {
                    if (res.status === 429) {
                        errorEl.textContent = 'Too many attempts. Try again later.';
                    } else if (res.status === 409) {
                        errorEl.textContent = 'An account already exists. Please sign in.';
                    } else {
                        const body = await res.json().catch(() => ({}));
                        errorEl.textContent = body?.error?.message || 'Account creation failed.';
                    }
                    return;
                }
            } else {
                let res;
                try {
                    res = await fetch('/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: emailInput.value, password: passwordInput.value })
                    });
                } catch (err) {
                    console.error('[loginGate] fetch error:', err);
                    errorEl.textContent = 'Could not reach the server. Check your connection.';
                    return;
                }
                console.warn('[loginGate] /auth/login status:', res.status);
                if (!res.ok) {
                    errorEl.textContent = res.status === 429
                        ? 'Too many attempts. Try again later.'
                        : 'Invalid email or password.';
                    return;
                }
            }

            form.onsubmit = null;
            gate.classList.add('hidden');
            gate.classList.remove('flex-visible');
            resolve();
        };
    });
}
