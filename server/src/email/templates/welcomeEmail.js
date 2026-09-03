import { escapeHtml } from '../../sanitizers/index.js';

export default function welcomeEmail({ email } = {}) {
    const safeEmail = escapeHtml(email || '');
    return {
        subject: 'Welcome to MyFinances',
        html: `<p>Your MyFinances account (<strong>${safeEmail}</strong>) has been created. You can now log in and start tracking your finances.</p>`,
        text: `Your MyFinances account (${email || ''}) has been created. You can now log in and start tracking your finances.`
    };
}
