import { escapeHtml } from '../../sanitizers/index.js';

export default function testEmail({ to } = {}) {
    const safeTo = to ? escapeHtml(to) : '';
    return {
        subject: 'MyFinances: SMTP test email',
        html: `<p>This is a test email from your MyFinances server${safeTo ? ` to confirm delivery to <strong>${safeTo}</strong>` : ''}. If you received this, your SMTP configuration is working.</p>`,
        text: 'This is a test email from your MyFinances server. If you received this, your SMTP configuration is working.'
    };
}
