// Focus management for full-screen overlays (#464, #491). A leaf module with
// no imports, so the gates (loginGate.js, serverUnreachableGate.js,
// pgMigrationModal.js) can use it without joining the ui.js/postgresSync.js
// import cycle.

// #464: while a gate or the legacy-data modal is up, every other child of
// <body> gets the `inert` attribute, so Tab and Shift+Tab never reach the app
// behind it and screen readers don't expose it either (aria-modal alone isn't
// honored reliably). Returns a release function that removes `inert` from the
// elements this call set it on, and only those: an element that was already
// inert (because an earlier overlay made it so) stays inert until that
// overlay releases it, so stacked overlays (a sign-in gate opened over the
// legacy-data modal by a 401) unwind correctly.
export function makeBackgroundInert(overlay) {
    if (!overlay || typeof document === 'undefined' || !document.body) return () => {};
    const changed = [];
    for (const el of Array.from(document.body.children)) {
        if (el === overlay || el.contains(overlay)) continue;
        if (el.tagName === 'SCRIPT' || el.tagName === 'TEMPLATE') continue;
        if (el.hasAttribute('inert')) continue;
        el.setAttribute('inert', '');
        changed.push(el);
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        for (const el of changed) el.removeAttribute('inert');
    };
}

// #491: the last element that had focus. When a save is submitted, withBusy()
// disables the submit button, and Chromium then moves focus to <body>, so
// document.activeElement alone would lose the control the user was on.
let lastFocused = null;
if (typeof document !== 'undefined') {
    document.addEventListener('focusin', (event) => {
        const target = event.target;
        if (target && target !== document.body && target.nodeType === 1) lastFocused = target;
    }, true);
}

function isFocusLost() {
    const active = document.activeElement;
    return !active || active === document.body || active === document.documentElement || !active.isConnected
        || !!(active.closest && active.closest('[inert], .hidden'));
}

// The control to return to once an overlay closes: the focused element, or the
// last one that had focus when focus has already dropped to <body>. Never an
// element inside `overlay`.
export function rememberFocus(overlay) {
    const active = document.activeElement;
    let candidate = (active && active !== document.body && active !== document.documentElement) ? active : lastFocused;
    if (candidate && overlay && overlay.contains(candidate)) candidate = null;
    return candidate && candidate.isConnected ? candidate : null;
}

const DEFAULT_WAIT_MS = 10000;

function isRendered(el) {
    return el.isConnected && el.getClientRects().length > 0;
}

// Where focus goes when `el` itself is hidden by the time it can take focus
// (an add form collapses after its retried save succeeds): the visible control
// that owns the collapsed region (aria-controls / data-collapse-toggle), else
// <main>.
function fallbackFor(el) {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (!node.id) continue;
        const id = CSS.escape(node.id);
        const owner = document.querySelector(`[aria-controls~="${id}"], [data-collapse-toggle="${id}"]`);
        if (owner && !owner.disabled && isRendered(owner)) return owner;
    }
    return document.getElementById('main');
}

// Puts focus back on `el` after an overlay closed, if focus has nowhere better
// to be. A control that is still disabled (its save is being retried) gets
// focus once it is re-enabled, within `waitMs`, and only if the user hasn't
// moved focus somewhere else meanwhile; if it is hidden by then, focus goes to
// fallbackFor(el). Resolves true when focus landed on `el` or its fallback.
export function restoreFocus(el, { waitMs = DEFAULT_WAIT_MS } = {}) {
    return new Promise((resolve) => {
        if (!el || !el.isConnected || typeof el.focus !== 'function') { resolve(false); return; }
        let target = el;
        const tryFocus = () => {
            if (!el.isConnected || !isFocusLost()) return true; // give up quietly
            if (el.disabled || el.closest('[inert]')) return false;
            target = isRendered(el) ? el : fallbackFor(el);
            if (target) target.focus({ preventScroll: !isRendered(el) && target.id === 'main' });
            return true;
        };
        const done = () => !!target && document.activeElement === target;
        if (tryFocus()) { resolve(done()); return; }
        const observer = new MutationObserver(() => {
            if (tryFocus()) { finish(); }
        });
        const timer = setTimeout(finish, waitMs);
        function finish() {
            observer.disconnect();
            clearTimeout(timer);
            resolve(done());
        }
        observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['disabled', 'inert'] });
    });
}
