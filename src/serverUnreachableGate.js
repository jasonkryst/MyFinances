// "Can't reach your server" gate (v7.0.0, spec §5 step 1). Full-page overlay
// shown by init() when the boot probe or the data load fails. It follows the
// #loginGate pattern: static markup in index.html (text via data-i18n),
// shown/hidden with classList, never inline styles.
import { probeServer } from './storage.js';
import { t } from './i18n.js';
import { makeBackgroundInert } from './overlayFocus.js';

// Resolves with the probe result once a Retry's probeServer() reports the
// server reachable. The caller (init()) reuses it for its next iteration
// instead of probing again (#468), then runs its auth/load sequence.
//
// No 429 loop here: probeServer() maps a rate-limited /auth/setup-status (429)
// to reachable, so Retry never keeps this gate up because of the limiter, and
// each Retry is one user click, never an automatic timer.
export function showServerUnreachable(app) {
    const gate = document.getElementById('serverUnreachableGate');
    const retryBtn = document.getElementById('serverUnreachableRetryBtn');
    const status = document.getElementById('serverUnreachableStatus');
    if (!gate || !retryBtn) return new Promise(() => {});

    if (status) status.textContent = '';
    retryBtn.disabled = false;
    // #731: other overlays (the phone More sheet) close first, before
    // makeBackgroundInert (see loginGate.js).
    document.dispatchEvent(new CustomEvent('mf:gate-shown'));
    gate.classList.add('flex-visible');
    gate.classList.remove('hidden');
    // #464: the app behind the gate can't be reached by Tab or screen readers.
    const releaseBackground = makeBackgroundInert(gate);
    setTimeout(() => retryBtn.focus(), 0);

    return new Promise((resolve) => {
        retryBtn.onclick = async () => {
            retryBtn.disabled = true;
            if (status) status.textContent = t('serverGate.retrying');
            const result = await probeServer();
            if (result.reachable) {
                retryBtn.onclick = null;
                if (status) status.textContent = '';
                gate.classList.add('hidden');
                gate.classList.remove('flex-visible');
                releaseBackground();
                resolve(result);
                return;
            }
            if (status) status.textContent = t('serverGate.stillUnreachable');
            retryBtn.disabled = false;
            retryBtn.focus();
        };
    });
}
