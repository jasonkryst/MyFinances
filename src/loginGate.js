export function showLoginGate(app) {
    return new Promise((resolve) => {
        const gate = document.getElementById('loginGate');
        const form = document.getElementById('loginGateForm');
        const emailInput = document.getElementById('loginGateEmail');
        const passwordInput = document.getElementById('loginGatePassword');
        const errorEl = document.getElementById('loginGateError');

        gate.classList.add('flex-visible');
        gate.classList.remove('hidden');
        setTimeout(() => emailInput.focus(), 30);

        form.onsubmit = async (event) => {
            event.preventDefault();
            errorEl.textContent = '';
            let res;
            try {
                res = await fetch('/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: emailInput.value,
                        password: passwordInput.value
                    })
                });
            } catch {
                errorEl.textContent = 'Could not reach the server. Check your connection.';
                return;
            }
            if (!res.ok) {
                errorEl.textContent = res.status === 429
                    ? 'Too many attempts. Try again later.'
                    : 'Invalid email or password.';
                return;
            }
            form.onsubmit = null;
            gate.classList.add('hidden');
            gate.classList.remove('flex-visible');
            resolve();
        };
    });
}
