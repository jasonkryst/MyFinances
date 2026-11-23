import { escapeHtml } from '../../sanitizers/index.js';

// #683: a sign-in from a browser/OS pair this account has not used before.
export default function newSignInEmail({ device, ip, when } = {}) {
    const d = device || 'Unknown browser';
    const where = ip ? ` from network ${ip}` : '';
    return {
        subject: 'New sign-in to MyFinances',
        html: `<p>Your MyFinances account was just signed in to on <strong>${escapeHtml(d)}</strong>${escapeHtml(where)} (${escapeHtml(when || '')}).</p>
               <p>If this was you, there is nothing to do. If not, open Settings &rarr; Security, sign out that session and change your password.</p>
               <p>You can turn these emails off in Settings &rarr; Notifications.</p>`,
        text: `Your MyFinances account was just signed in to on ${d}${where} (${when || ''}).\n\nIf this was you, there is nothing to do. If not, open Settings > Security, sign out that session and change your password.\n\nYou can turn these emails off in Settings > Notifications.`
    };
}
