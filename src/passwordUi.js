// Password strength meter and localized password messages (issue #456).
// Used on the three forms that *set* a password: first-run setup and the
// reset link (loginGate.js), and Settings -> Security (securitySettings.js).
// Never attached to the sign-in form.
//
// The meter is advisory: it never blocks a submit (validatePasswordPolicy and
// the server do). It is readable without colour: the level is a sentence in a
// polite live region linked to the input via aria-describedby, and the bar is
// aria-hidden decoration. All DOM is built with createElement/textContent.
import { t } from './i18n.js';
import {
    estimatePasswordStrength, validatePasswordPolicy, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH
} from './passwordPolicy.js';

const REASON_KEYS = {
    PASSWORD_TOO_SHORT: 'password.reason.tooShort',
    PASSWORD_TOO_LONG: 'password.reason.tooLong',
    PASSWORD_REPETITIVE: 'password.reason.repetitive',
    PASSWORD_COMMON: 'password.reason.common',
    PASSWORD_CONTEXT: 'password.reason.context',
    PASSWORD_BREACHED: 'password.reason.breached',
    PASSWORD_UNCHANGED: 'password.reason.unchanged'
};

const LEVEL_KEYS = ['password.levelInvalid', 'password.levelWeak', 'password.levelFair', 'password.levelGood', 'password.levelStrong'];

// Localized text for a policy reason code, or null for an unknown code.
export function passwordReasonMessage(reason) {
    const key = REASON_KEYS[reason];
    return key ? t(key, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }) : null;
}

// Client-side pre-submit check for a new password + confirmation. Returns a
// localized message, or null when the form may be sent. The server re-checks
// everything (plus the common-password list and breach check).
export function newPasswordError(password, confirm, email) {
    const reason = validatePasswordPolicy(password, { email });
    if (reason) return passwordReasonMessage(reason);
    if (password !== confirm) return t('password.mismatch');
    return null;
}

// Localized message for a failed set-password response body, falling back to
// `fallbackKey` when the server sent no recognizable reason.
export function passwordResponseMessage(body, fallbackKey) {
    return passwordReasonMessage(body?.error?.reason) || t(fallbackKey);
}

function setText(el, text) {
    // Only touch the live region when the sentence changes, so a screen reader
    // announces level changes rather than every keystroke.
    if (el.textContent !== text) el.textContent = text;
}

function strengthHint(password, result) {
    if (!password) return t('password.hintEmpty', { min: PASSWORD_MIN_LENGTH });
    if (result.reason) return passwordReasonMessage(result.reason);
    return result.score >= 3 ? t('password.hintStrong') : t('password.hintMore');
}

// Inserts the meter right after `input`. getEmail() supplies the account email
// for the context-word rule. Returns { update, reset } for form code.
export function attachPasswordStrengthMeter(input, { getEmail = () => '' } = {}) {
    if (!input) return null;
    const existing = input.parentElement?.querySelector(`.pw-meter[data-for="${input.id}"]`);
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.className = 'pw-meter';
    wrap.dataset.for = input.id;
    const track = document.createElement('div');
    track.className = 'pw-meter-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('div');
    fill.className = 'pw-meter-fill';
    track.appendChild(fill);
    const label = document.createElement('p');
    label.className = 'pw-meter-label';
    label.id = `${input.id}Strength`;
    label.setAttribute('aria-live', 'polite');
    const hint = document.createElement('p');
    hint.className = 'pw-meter-hint';
    hint.id = `${input.id}StrengthHint`;
    wrap.append(track, label, hint);
    input.insertAdjacentElement('afterend', wrap);

    const describedBy = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    describedBy.add(label.id);
    describedBy.add(hint.id);
    input.setAttribute('aria-describedby', [...describedBy].join(' '));

    const update = () => {
        const password = input.value;
        const result = estimatePasswordStrength(password, { email: getEmail() });
        const score = password ? result.score : 0;
        for (let i = 0; i <= 4; i++) fill.classList.toggle(`pw-meter-fill--${i}`, i === score);
        fill.classList.toggle('pw-meter-fill--empty', !password);
        wrap.dataset.score = password ? String(score) : '';
        setText(label, password
            ? t('password.strengthLabel', { level: t(LEVEL_KEYS[score]) })
            : t('password.strengthEmpty'));
        setText(hint, strengthHint(password, result));
    };
    input.addEventListener('input', update);
    update();
    return { update, reset: () => { input.value = ''; update(); }, element: wrap };
}

// Shows the "checked against known breaches" note when the server has the
// check enabled. Best effort: any failure leaves the note hidden.
export async function showBreachCheckNote(noteEl) {
    if (!noteEl) return;
    try {
        const res = await fetch('/auth/password-policy');
        if (!res.ok) return;
        const policy = await res.json();
        noteEl.classList.toggle('hidden', policy?.breachedCheckEnabled !== true);
    } catch {
        /* no server, or offline: keep the note hidden */
    }
}
