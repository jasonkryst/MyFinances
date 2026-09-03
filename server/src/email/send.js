import { getTransport, isEmailConfigured } from './transport.js';
import testEmail from './templates/testEmail.js';
import welcomeEmail from './templates/welcomeEmail.js';
import alertEmail from './templates/alertEmail.js';

const TEMPLATES = { testEmail, welcomeEmail, alertEmail };

export async function sendTemplatedEmail(to, templateName, data = {}) {
    if (!isEmailConfigured()) {
        throw new Error('SMTP is not configured');
    }
    const template = TEMPLATES[templateName];
    if (!template) {
        throw new Error(`Unknown email template: ${templateName}`);
    }
    const { subject, html, text } = template(data);
    const transport = getTransport();
    return transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html, text });
}
