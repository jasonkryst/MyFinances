import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';
import { sendTemplatedEmail } from '../src/email/send.js';

function createRecordingTransport() {
    const sent = [];
    return {
        sendMail: async (mailOptions) => {
            sent.push(mailOptions);
            return { messageId: 'test-message-id' };
        },
        sent
    };
}

let originalHost, originalFrom, transport;

before(() => {
    originalHost = process.env.SMTP_HOST;
    originalFrom = process.env.SMTP_FROM;
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    transport = createRecordingTransport();
    _setTransportOverride(transport);
});

after(() => {
    if (originalHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalHost;
    if (originalFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = originalFrom;
    _clearTransportOverride();
});

test('sendTemplatedEmail renders the named template and calls sendMail with it', async () => {
    await sendTemplatedEmail('user@example.com', 'testEmail', { to: 'user@example.com' });
    assert.equal(transport.sent.length, 1);
    const mail = transport.sent[0];
    assert.equal(mail.from, 'noreply@myfinances.test');
    assert.equal(mail.to, 'user@example.com');
    assert.equal(mail.subject, 'MyFinances: SMTP test email');
    assert.ok(mail.html.length > 0);
    assert.ok(mail.text.length > 0);
});

test('sendTemplatedEmail rejects an unknown template name', async () => {
    await assert.rejects(
        () => sendTemplatedEmail('user@example.com', 'nope', {}),
        /Unknown email template: nope/
    );
});

test('sendTemplatedEmail rejects when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    await assert.rejects(
        () => sendTemplatedEmail('user@example.com', 'testEmail', {}),
        /SMTP is not configured/
    );
    process.env.SMTP_HOST = 'smtp.example.com';
});
