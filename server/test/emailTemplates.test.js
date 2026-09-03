import { test } from 'node:test';
import assert from 'node:assert/strict';
import testEmail from '../src/email/templates/testEmail.js';
import welcomeEmail from '../src/email/templates/welcomeEmail.js';
import alertEmail from '../src/email/templates/alertEmail.js';

test('testEmail renders a fixed subject and mentions the recipient', () => {
    const { subject, html, text } = testEmail({ to: 'user@example.com' });
    assert.equal(subject, 'MyFinances: SMTP test email');
    assert.ok(html.includes('user@example.com'));
    assert.ok(text.length > 0);
    assert.ok(!text.includes('<'));
});

test('testEmail works with no data at all', () => {
    const { subject, html } = testEmail();
    assert.equal(subject, 'MyFinances: SMTP test email');
    assert.ok(html.length > 0);
});

test('welcomeEmail includes the account email and escapes HTML-unsafe input', () => {
    const { subject, html, text } = welcomeEmail({ email: '<script>alert(1)</script>@example.com' });
    assert.equal(subject, 'Welcome to MyFinances');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(text.includes('<script>')); // plain text needs no escaping
});

test('alertEmail omits the CTA button when no ctaUrl is given', () => {
    const { html, text } = alertEmail({ heading: 'Low balance', body: 'Checking is under $50.' });
    assert.equal(html.includes('<a '), false);
    assert.ok(html.includes('Low balance'));
    assert.ok(text.includes('Checking is under $50.'));
});

test('alertEmail includes a CTA link when both ctaLabel and ctaUrl are given', () => {
    const { html, text } = alertEmail({
        heading: 'Low balance',
        body: 'Checking is under $50.',
        ctaLabel: 'View account',
        ctaUrl: 'https://example.com/accounts/1'
    });
    assert.ok(html.includes('https://example.com/accounts/1'));
    assert.ok(html.includes('View account'));
    assert.ok(text.includes('https://example.com/accounts/1'));
});
