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

    if (needsSetup) {
        subtitleEl.textContent = 'Create your account';
        confirmGroup.classList.remove('hidden');
        confirmInput.required = true;
        submitBtn.textContent = 'Create Account';
        passwordInput.autocomplete = 'new-password';
    }

    gate.classList.add('flex-visible');
    gate.classList.remove('hidden');
    setTimeout(() => emailInput.focus(), 30);

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
