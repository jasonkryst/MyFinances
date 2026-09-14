import { escapeHtml } from '../../sanitizers/index.js';

export default function passwordResetEmail({ resetUrl } = {}) {
    const safeUrl = escapeHtml(resetUrl || '');
    return {
        subject: 'Reset your MyFinances password',
        html: `<p>Click the link below to reset your MyFinances password. This link expires in 1 hour.</p>
               <p><a href="${safeUrl}">${safeUrl}</a></p>
               <p>If you did not request a password reset, ignore this email.</p>`,
        text: `Reset your MyFinances password (expires in 1 hour):\n\n${resetUrl || ''}\n\nIf you did not request this, ignore this email.`
    };
}
